// Onboard the REAL team from scripts/roster.json.
//
//   cd scripts && node onboard.mjs           # dry run — shows what would happen
//   cd scripts && node onboard.mjs --apply   # actually create the accounts
//
// This is NOT the demo seed. Differences that matter:
//
//   · It never touches tasks. It only creates or updates people, so it is safe
//     to run against a database that already holds real work.
//   · Every person gets their OWN random password, never a shared one. The demo
//     accounts share Default@123; real accounts must not.
//   · Everyone is stamped must_set_password, so the temporary value is dead the
//     moment they choose their own.
//   · It tries an email invite first and falls back to a printed password only
//     when mail cannot be sent — and says which happened, per person.
//
// The roster lives in scripts/roster.json, which is gitignored: this repository
// is public, and a real directory of names and working addresses is what gets
// scraped for phishing. See roster.example.json.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  db, cognito, USER_POOL_ID, hasCognito,
} from './lib.mjs';
import {
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  AdminGetUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';

const here = dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes('--apply');
// --shared-password uses DEMO_PASSWORD for everyone instead of a unique random
// one each. NOT the default, and not what you want once this holds real work:
// one password across the whole company means one leak exposes every account.
// It exists because evaluation is easier when everyone can just get in.
const SHARED = process.argv.includes('--shared-password');
const ROSTER = join(here, 'roster.json');

if (!existsSync(ROSTER)) {
  console.error('No scripts/roster.json found.');
  console.error('Copy scripts/roster.example.json to scripts/roster.json and fill it in.');
  console.error('Do NOT commit it — this repository is public.');
  process.exit(1);
}

const { people } = JSON.parse(readFileSync(ROSTER, 'utf8'));
if (!Array.isArray(people) || people.length === 0) {
  console.error('roster.json has no "people" array.');
  process.exit(1);
}

// Strong, unique, and satisfying the project's password policy (upper, lower,
// digit, symbol, 8+). Only ever needed when the invite email cannot be sent.
function tempPassword() {
  const pick = (s) => s[randomBytes(1)[0] % s.length];
  const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '!@#$%^&*'];
  const all = sets.join('');
  const out = sets.map(pick);
  while (out.length < 16) out.push(pick(all));
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomBytes(1)[0] % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.join('');
}

// ── Validate before touching anything ────────────────────────────────────────
const problems = [];
const byEmail = new Map();
for (const [i, p] of people.entries()) {
  const row = `row ${i + 1} (${p.name || 'unnamed'})`;
  if (!p.name?.trim()) problems.push(`${row}: missing name`);
  if (!p.email?.trim()) problems.push(`${row}: missing email`);
  if (!['ea', 'ceo', 'stakeholder'].includes(p.role)) {
    problems.push(`${row}: role must be ea | ceo | stakeholder, got ${JSON.stringify(p.role)}`);
  }
  const key = p.email?.trim().toLowerCase();
  if (key && byEmail.has(key)) {
    problems.push(`${row}: duplicate email ${key} — already used by ${byEmail.get(key)}. `
      + `Emails are unique, so one of these rows must change.`);
  } else if (key) byEmail.set(key, p.name);
}
const eas = people.filter((p) => p.role === 'ea').length;
const ceos = people.filter((p) => p.role === 'ceo').length;
const warnings = [];
if (eas !== 1) problems.push(`expected exactly one 'ea', found ${eas}`);
// Not an error: 'ea' and 'ceo' have identical powers in this tool, so a roster
// with only an EA is workable. Worth saying out loud, though — nobody is
// holding the CEO login.
if (ceos === 0) warnings.push("no 'ceo' in the roster — the EA carries every executive permission, so this works, but add the CEO when you have their address");
if (ceos > 1) problems.push(`expected at most one 'ceo', found ${ceos}`);

if (warnings.length) {
  console.warn(String.fromCharCode(10) + 'Notes:');
  warnings.forEach((w) => console.warn('  ·', w));
}

if (problems.length) {
  console.error('\nRoster has problems — nothing was changed:\n');
  problems.forEach((p) => console.error('  ·', p));
  process.exit(1);
}

// Does this person already have a Cognito account? Asked per person rather than
// by listing the whole pool: ListUsers pages at 60 and the old supabase-js call
// silently assumed one page of 1000 would cover everyone, which would have
// started mis-reporting people as "new" — and resetting their password — the
// moment the pool outgrew a page.
async function cognitoSubFor(email) {
  if (!hasCognito) return null;
  try {
    const res = await cognito.send(new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: email }));
    return res.UserAttributes?.find(a => a.Name === 'sub')?.Value ?? null;
  } catch (err) {
    if (err.name === 'UserNotFoundException') return null;
    throw err;
  }
}

async function upsertProfile({ sub, email, name, title, role, mustSetPassword }) {
  await db.query(
    `insert into profiles (cognito_sub, email, name, title, role, active, must_set_password)
     values ($1,$2,$3,$4,$5,true,$6)
     on conflict (email) do update
        set name              = excluded.name,
            title             = excluded.title,
            role              = excluded.role,
            active            = true,
            must_set_password = excluded.must_set_password,
            cognito_sub       = coalesce(excluded.cognito_sub, profiles.cognito_sub)`,
    [sub, email, name, title || null, role, mustSetPassword]
  );
}

// ── Report, then (optionally) act ────────────────────────────────────────────
async function main() {
  if (!hasCognito) {
    console.error('COGNITO_USER_POOL_ID is not set — this would create profile rows with no');
    console.error('accounts behind them, and nobody could sign in. Set it in ../.env.');
    process.exit(1);
  }

  console.log(`\n${APPLY ? 'Onboarding' : 'DRY RUN —'} ${people.length} people\n`);
  const results = [];

  for (const p of people) {
    const email = p.email.trim().toLowerCase();
    const name = p.name.trim();
    const title = (p.title || '').trim();
    const existingSub = await cognitoSubFor(email);
    let inviteError = null;   // set if the email path was tried and failed

    if (!APPLY) {
      console.log(`  ${existingSub ? 'update' : 'create'}  ${email.padEnd(32)} ${name} · ${title || '—'} [${p.role}]`);
      continue;
    }

    if (existingSub) {
      // Never reset a password for someone who already has an account — they may
      // already be using it. Only bring name/title/role up to date.
      await upsertProfile({ sub: existingSub, email, name, title, role: p.role, mustSetPassword: false });
      results.push({ email, name, outcome: 'updated (password untouched)' });
      continue;
    }

    // Preferred path: Cognito emails the invitation itself and the account
    // stays in FORCE_CHANGE_PASSWORD, so the temporary value is single-use.
    if (!SHARED) {
      try {
        const created = await cognito.send(new AdminCreateUserCommand({
          UserPoolId: USER_POOL_ID,
          Username: email,
          DesiredDeliveryMediums: ['EMAIL'],
          UserAttributes: [
            { Name: 'email',          Value: email },
            { Name: 'email_verified', Value: 'true' },
            { Name: 'name',           Value: name },
          ],
        }));
        const sub = created.User?.Attributes?.find(a => a.Name === 'sub')?.Value ?? null;
        await upsertProfile({ sub, email, name, title, role: p.role, mustSetPassword: true });
        results.push({ email, name, outcome: 'invited by email' });
        continue;
      } catch (err) {
        // Fall through to a printed password. Onboarding should not be blocked
        // because SES is still in the sandbox or a sender is unverified — but
        // the person running this is told which happened, per person, rather
        // than the script claiming an email went out that did not.
        inviteError = err.message;
      }
    }

    const pw = SHARED ? process.env.DEMO_PASSWORD : tempPassword();
    if (SHARED && !pw) { console.error('--shared-password needs DEMO_PASSWORD in ../.env'); process.exit(1); }

    try {
      const created = await cognito.send(new AdminCreateUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: email,
        MessageAction: 'SUPPRESS',
        TemporaryPassword: pw,
        UserAttributes: [
          { Name: 'email',          Value: email },
          { Name: 'email_verified', Value: 'true' },
          { Name: 'name',           Value: name },
        ],
      }));
      const sub = created.User?.Attributes?.find(a => a.Name === 'sub')?.Value ?? null;

      if (SHARED) {
        // Permanent, so the shared password signs straight in with no
        // first-login challenge. This is the evaluation-only path.
        await cognito.send(new AdminSetUserPasswordCommand({
          UserPoolId: USER_POOL_ID, Username: email, Password: pw, Permanent: true,
        }));
      }

      await upsertProfile({ sub, email, name, title, role: p.role, mustSetPassword: !SHARED });
      results.push({
        email, name,
        outcome: SHARED ? 'created with the shared password' : 'temporary password (invite email failed)',
        password: SHARED ? null : pw,
        reason: inviteError ?? undefined,
      });
    } catch (err) {
      results.push({ email, name, outcome: `FAILED: ${err.message}` });
    }
  }

  if (!APPLY) {
    console.log('\nNothing was changed. Re-run with --apply to create these accounts.');
    return;
  }

  console.log('\n── Results ──');
  for (const r of results) console.log(`  ${r.email.padEnd(32)} ${r.outcome}`);

  const needPw = results.filter((r) => r.password);
  if (needPw.length) {
    console.log('\n── Temporary passwords — share each one privately, then delete this output ──');
    console.log(`   (the invite email could not be sent: ${needPw[0].reason})`);
    for (const r of needPw) console.log(`  ${r.email.padEnd(32)} ${r.password}`);
    console.log('\n   Each person must set their own password on first sign-in.');
  }
}

main()
  .then(async () => { await db.end(); process.exit(0); })
  .catch(async (e) => { console.error(e); await db.end().catch(() => {}); process.exit(1); });
