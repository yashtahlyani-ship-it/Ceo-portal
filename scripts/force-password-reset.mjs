/**
 * force-password-reset.mjs — require people to set a new password.
 *
 * Mirrors scripts/force-password-reset.js in the Marketing and Legal portals,
 * with one addition specific to this product (see "Two systems, one truth").
 *
 * Sets a TEMPORARY password on each Cognito account, which moves it to
 * FORCE_CHANGE_PASSWORD. Next sign-in, Cognito answers with a
 * NEW_PASSWORD_REQUIRED challenge instead of a session, so the portal shows the
 * "Set a new password" screen and there is no token to reach the board with
 * until they choose their own.
 *
 * Existing sessions are NOT killed by default — someone already signed in keeps
 * working until their token expires (up to an hour). Pass --signout to revoke
 * refresh tokens too, which forces the change immediately rather than at next
 * login. Use that when you are resetting *because* something leaked.
 *
 *   cd scripts && npm install
 *   node force-password-reset.mjs --dry-run           # show who would be reset
 *   node force-password-reset.mjs                     # reset everyone
 *   node force-password-reset.mjs --all               # include accounts already pending
 *   node force-password-reset.mjs --signout           # ...and end active sessions
 *   node force-password-reset.mjs --only=a@gyftr.com,b@gyftr.com
 *
 * Env (from ../.env, loaded by lib.mjs):
 *   COGNITO_USER_POOL_ID, AWS_REGION      — which pool
 *   DB_*                                  — to keep profiles in step
 *   TEMP_PASSWORD or DEMO_PASSWORD        — the temporary value. REQUIRED.
 *
 * IAM: cognito-idp:ListUsers, AdminSetUserPassword,
 *      AdminUserGlobalSignOut (only with --signout)
 *
 * ── Two systems, one truth ───────────────────────────────────────────────────
 *
 * The siblings only touch Cognito, because Cognito is the only place they track
 * this. This portal also has `profiles.must_set_password`, which the Stakeholders
 * screen reads to show who has not onboarded yet.
 *
 * Resetting Cognito without updating that column would leave the directory
 * quietly lying — showing people as settled when they are actually sitting on a
 * temporary password. So this script writes both, and reports if the two ever
 * disagree.
 *
 * The column is NOT the gate. The gate is Cognito's challenge, which cannot be
 * skipped by a client that forgets to check a flag — that distinction is the
 * whole reason the AWS migration was an improvement here, and it is worth not
 * eroding. This column is for humans reading the directory.
 */

import {
  ListUsersCommand,
  AdminSetUserPasswordCommand,
  AdminUserGlobalSignOutCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { db, cognito, USER_POOL_ID, hasCognito } from './lib.mjs';

const args    = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const SIGNOUT = args.includes('--signout');
const ALL     = args.includes('--all');
const onlyArg = args.find(a => a.startsWith('--only='));
const ONLY    = onlyArg
  ? new Set(onlyArg.slice('--only='.length).split(',').map(s => s.trim().toLowerCase()).filter(Boolean))
  : null;

// Deliberately no hard-coded fallback, unlike the sibling scripts which default
// to a password literal.
//
// That default is fine in their private repositories. This one is public, and a
// password literal in a public file is a password literal — it gets indexed,
// and it is the first thing anyone tries against a login page they find. The
// same reasoning already keeps it out of seed.mjs and the test suite, and it is
// why this comment does not name the value the siblings use either.
//
// It still ends up being one shared temporary value for everyone in a single
// run, which is expected: each account is forced to change it before it can do
// anything, so it is a delivery mechanism, not a credential.
const TEMP_PASSWORD = process.env.TEMP_PASSWORD || process.env.DEMO_PASSWORD;

async function listAllUsers() {
  const out = [];
  let token;
  do {
    // Limit 60 is Cognito's maximum for ListUsers. Paginate properly: a hard-
    // coded single page silently starts missing people the moment the pool
    // outgrows it, and "missing" here means someone keeps a password you
    // believed you had reset.
    const res = await cognito.send(new ListUsersCommand({
      UserPoolId: USER_POOL_ID, Limit: 60, PaginationToken: token,
    }));
    for (const u of res.Users || []) {
      const attr  = Object.fromEntries((u.Attributes || []).map(a => [a.Name, a.Value]));
      const email = (attr.email || u.Username || '').toLowerCase();
      if (email) out.push({ email, username: u.Username, status: u.UserStatus, enabled: u.Enabled !== false });
    }
    token = res.PaginationToken;
  } while (token);
  return out;
}

async function main() {
  if (!hasCognito) {
    console.error('COGNITO_USER_POOL_ID is not set in ../.env — nothing to reset.');
    process.exit(1);
  }
  if (!TEMP_PASSWORD && !DRY_RUN) {
    console.error('Set TEMP_PASSWORD (or DEMO_PASSWORD) in ../.env — this script will not');
    console.error('invent a password, and will not fall back to a literal in a public repo.');
    process.exit(1);
  }

  let users = await listAllUsers();

  // Report a roster mismatch before doing anything. A Cognito account with no
  // profile cannot sign in past middleware/identity.js anyway, so resetting it
  // achieves nothing — but its presence usually means somebody was removed from
  // the directory without being removed from the pool, which is worth knowing.
  const { rows } = await db.query('select lower(email) as email from profiles');
  const known = new Set(rows.map(r => r.email));
  const orphans = users.filter(u => !known.has(u.email));

  if (ONLY) {
    const missing = [...ONLY].filter(e => !users.some(u => u.email === e));
    if (missing.length) {
      console.error(`No Cognito account for: ${missing.join(', ')}`);
      process.exit(1);
    }
    users = users.filter(u => ONLY.has(u.email));
  }

  console.log(`\n=== force-password-reset — pool ${USER_POOL_ID} ===`);
  console.log(DRY_RUN ? 'Mode: DRY RUN — nothing will change\n' : 'Mode: LIVE\n');

  let done = 0, skipped = 0, failed = 0;

  for (const u of users) {
    process.stdout.write(`  ${u.email.padEnd(34)} ${String(u.status).padEnd(22)}`);

    if (!u.enabled) {
      console.log('disabled — left alone');
      skipped++;
      continue;
    }
    // Already pending: resetting achieves nothing except replacing one unknown
    // temporary password with the shared one. --all is for exactly that case,
    // e.g. putting freshly invited accounts onto a value you can hand out.
    if (u.status === 'FORCE_CHANGE_PASSWORD' && !ALL) {
      console.log('already must change — skipped (--all to include)');
      skipped++;
      continue;
    }
    if (DRY_RUN) { console.log('would reset'); done++; continue; }

    try {
      await cognito.send(new AdminSetUserPasswordCommand({
        UserPoolId: USER_POOL_ID,
        Username:   u.username,
        Password:   TEMP_PASSWORD,
        Permanent:  false,        // ← the whole point: false is what forces the change
      }));

      if (SIGNOUT) {
        await cognito.send(new AdminUserGlobalSignOutCommand({
          UserPoolId: USER_POOL_ID, Username: u.username,
        }));
      }

      // Keep the directory honest — see the header. Matched on lowercased email
      // because Cognito usernames and profile emails are not guaranteed to agree
      // on case. A missing profile is not an error here; it was already reported
      // as an orphan above.
      await db.query(
        'update profiles set must_set_password = true where lower(email) = $1',
        [u.email]
      );

      console.log(SIGNOUT ? 'reset + signed out' : 'reset');
      done++;
    } catch (err) {
      console.log(`FAILED — ${err.message}`);
      failed++;
    }
  }

  console.log(`\nDone. Reset: ${done}   Skipped: ${skipped}   Failed: ${failed}`);

  if (orphans.length) {
    console.log(`\n⚠  ${orphans.length} Cognito account(s) have no profile in this database:`);
    for (const o of orphans) console.log(`     ${o.email}`);
    console.log('   They cannot sign in regardless. Remove them from the pool, or add');
    console.log('   the profile — see scripts/onboard.mjs.');
  }

  if (!DRY_RUN && done > 0) {
    console.log('\nShare the temporary password privately with each person, then delete');
    console.log('this output. Everyone is forced to choose their own before they can');
    console.log('reach the board.');
    if (!SIGNOUT) {
      console.log('\nNote: anyone currently signed in keeps working until their token');
      console.log('expires (up to an hour). Re-run with --signout to cut them off now.');
    }
  }
}

main()
  .then(async () => { await db.end(); process.exit(0); })
  .catch(async (err) => {
    console.error('force-password-reset failed:', err.message);
    await db.end().catch(() => {});
    process.exit(1);
  });
