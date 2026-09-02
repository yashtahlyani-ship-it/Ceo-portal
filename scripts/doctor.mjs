/**
 * doctor.mjs — check everything the CEO portal needs, and report it ALL at once.
 *
 * Mirrors scripts/doctor.js in the Marketing and Legal portals.
 *
 *   cd scripts && node doctor.mjs
 *
 * The problem this solves: the backend applies its migrations on boot and stops
 * at the FIRST failure, so a misconfigured database is discovered one
 * permission error per deploy — fix, redeploy, wait, hit the next one. That
 * costs a round trip between whoever runs the deploy and whoever owns the
 * database, every single time.
 *
 * This runs every check independently and prints one complete list, so the
 * whole thing can be fixed in a single pass.
 *
 * Exit code is 0 only if nothing is broken, so it is safe in a pipeline.
 */

import { db, USER_POOL_ID, hasCognito, cognito } from './lib.mjs';
import { ListUsersCommand } from '@aws-sdk/client-cognito-identity-provider';

const PASS = '  \x1b[32m✓\x1b[0m';
const FAIL = '  \x1b[31m✗\x1b[0m';
const WARN = '  \x1b[33m!\x1b[0m';

const problems = [];
const warnings = [];

function ok(msg)            { console.log(`${PASS} ${msg}`); }
function bad(msg, fix)      { console.log(`${FAIL} ${msg}`); problems.push({ msg, fix }); }
function warn(msg, fix)     { console.log(`${WARN} ${msg}`); warnings.push({ msg, fix }); }

const TABLES = [
  'profiles', 'tasks', 'task_assignments', 'task_comments',
  'task_attachments', 'audit_log', 'notifications',
];

async function q(sql, params) {
  const { rows } = await db.query(sql, params);
  return rows;
}

// Each check is wrapped so one failure never hides the rest — that is the whole
// point of this script.
async function check(label, fn) {
  try { await fn(); }
  catch (err) { bad(`${label} — ${err.message}`, null); }
}

async function main() {
  console.log('\n=== CEO Office portal — doctor ===\n');

  // ── Connection ────────────────────────────────────────────────────────────
  let me;
  try {
    [{ current_user: me }] = await q('select current_user');
    const [{ v }] = await q('select version() as v');
    ok(`connected as "${me}"`);
    ok(v.split(',')[0]);
  } catch (err) {
    bad(`cannot connect to the database — ${err.message}`,
        'Check DB_HOST/DB_NAME/DB_USER/DB_PASSWORD in ../.env, and the RDS security group.');
    return report();
  }

  console.log('\n── Prerequisites (infra/dba-setup.sql) ──');

  await check('pgcrypto', async () => {
    const r = await q("select 1 from pg_extension where extname = 'pgcrypto'");
    r.length ? ok('pgcrypto installed')
             : bad('pgcrypto is NOT installed',
                   'Run as the RDS master:  CREATE EXTENSION pgcrypto;');
  });

  await check('authenticated role', async () => {
    const r = await q("select 1 from pg_roles where rolname = 'authenticated'");
    r.length ? ok('role "authenticated" exists')
             : bad('role "authenticated" does NOT exist',
                   'Run as the RDS master:  CREATE ROLE authenticated NOLOGIN;');
  });

  await check('role membership', async () => {
    const [{ member }] = await q("select pg_has_role(current_user, 'authenticated', 'member') as member");
    member ? ok(`"${me}" is a member of "authenticated"`)
           : bad(`"${me}" is NOT a member of "authenticated"`,
                 `Run as the RDS master:  GRANT authenticated TO ${me};`);
  });

  // The single most important check: can we actually switch role? Everything
  // the app does at request time depends on this one statement working.
  await check('SET ROLE', async () => {
    const c = await db.connect();
    try {
      await c.query('begin');
      await c.query('set local role authenticated');
      await c.query('rollback');
      ok('SET LOCAL ROLE authenticated works');
    } catch (err) {
      await c.query('rollback').catch(() => {});
      bad(`SET LOCAL ROLE authenticated FAILS — ${err.message}`,
          `Run as the RDS master:  GRANT authenticated TO ${me};`);
    } finally { c.release(); }
  });

  console.log('\n── Schema (applied by the backend on boot) ──');

  await check('auth.uid', async () => {
    const r = await q(`select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                        where n.nspname = 'auth' and p.proname = 'uid'`);
    if (!r.length) {
      return bad('auth.uid() is missing',
                 'The backend has not applied 00_compat.sql yet — check its logs.');
    }
    // Prove it actually reads the session variable, not just that it exists.
    const [{ uid }] = await q(
      "select (select auth.uid() from (select set_config('app.user_id','11111111-1111-1111-1111-111111111111',true)) _) as uid");
    uid === '11111111-1111-1111-1111-111111111111'
      ? ok('auth.uid() reads app.user_id correctly')
      : bad(`auth.uid() returned ${uid} instead of the value set`, null);
  });

  for (const t of TABLES) {
    await check(t, async () => {
      const r = await q(
        `select c.relrowsecurity as rls, pg_get_userbyid(c.relowner) as owner,
                (select count(*) from pg_policy p where p.polrelid = c.oid)::int as policies
           from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relname = $1`, [t]);

      if (!r.length) {
        return bad(`table "${t}" is missing`,
                   'The backend has not applied its migrations — check its logs.');
      }
      const { rls, owner, policies } = r[0];

      if (!rls) {
        bad(`"${t}" does NOT have row-level security enabled`,
            `Owner is "${owner}". If that is not "${me}", run infra/dba-setup.sql.`);
      } else if (policies === 0) {
        bad(`"${t}" has RLS on but NO policies — it will return nothing to anyone`, null);
      } else {
        const note = owner === me ? '' : `  (owner: ${owner} — not the app user)`;
        ok(`"${t}": RLS on, ${policies} polic${policies === 1 ? 'y' : 'ies'}${note}`);
        if (owner !== me) {
          warn(`"${t}" is owned by "${owner}", not "${me}"`,
               'The backend re-applies policies on every boot and will fail. Run infra/dba-setup.sql.');
        }
      }
    });
  }

  await check('grants', async () => {
    const missing = [];
    for (const t of TABLES) {
      const [{ has }] = await q(
        `select has_table_privilege('authenticated', $1, 'SELECT') as has`, [t]);
      if (!has) missing.push(t);
    }
    missing.length
      ? bad(`"authenticated" cannot SELECT: ${missing.join(', ')}`,
            'The backend has not applied 08_grants.sql, or it lacks ownership. Run infra/dba-setup.sql.')
      : ok('"authenticated" has table privileges');
  });

  console.log('\n── Data ──');

  await check('profiles', async () => {
    const rows = await q(`select role, count(*)::int as n from profiles where active group by role`);
    if (!rows.length) {
      return warn('no active profiles — nobody can sign in',
                  'Run:  npm run seed   (demo)  or  node onboard.mjs --apply  (real roster)');
    }
    const by = Object.fromEntries(rows.map(r => [r.role, r.n]));
    ok(`profiles: ${rows.map(r => `${r.n} ${r.role}`).join(', ')}`);
    if (!by.ea && !by.ceo) {
      bad('no EA or CEO — nobody can create tasks or approve dates', null);
    }
    const [{ n: unlinked }] = await q(
      'select count(*)::int as n from profiles where cognito_sub is null and active');
    if (unlinked > 0) {
      warn(`${unlinked} active profile(s) have no Cognito link yet`,
           'Normal before first sign-in — they link automatically on first login.');
    }
  });

  await check('tasks', async () => {
    const [{ n }] = await q('select count(*)::int as n from tasks');
    ok(`${n} task(s)`);
  });

  // ── RLS actually working, end to end ──────────────────────────────────────
  // The check that matters most: does a stakeholder genuinely see less than an
  // executive? Everything above can pass while this fails.
  await check('RLS isolation', async () => {
    const execs = await q("select id, email from profiles where role in ('ea','ceo') and active limit 1");
    const stake = await q("select id, email from profiles where role = 'stakeholder' and active limit 1");
    if (!execs.length || !stake.length) {
      return warn('not enough profiles to test isolation', 'Seed or onboard first.');
    }

    const seen = async (id) => {
      const c = await db.connect();
      try {
        await c.query('begin');
        await c.query("select set_config('app.user_id', $1, true)", [id]);
        await c.query('set local role authenticated');
        const { rows } = await c.query('select count(*)::int as n from tasks');
        await c.query('rollback');
        return rows[0].n;
      } finally { c.release(); }
    };

    const total = (await q('select count(*)::int as n from tasks'))[0].n;
    const asExec  = await seen(execs[0].id);
    const asStake = await seen(stake[0].id);

    if (asStake > asExec) {
      return bad(`a stakeholder sees MORE tasks (${asStake}) than an executive (${asExec})`, null);
    }
    if (total > 0 && asExec === 0) {
      return bad('an executive sees 0 tasks — policies are refusing everything', null);
    }
    if (total > 0 && asStake === total && asExec === total) {
      return bad(`a stakeholder sees ALL ${total} tasks — RLS is NOT isolating`,
                 'Check the backend connects as a non-superuser without BYPASSRLS.');
    }
    ok(`isolation holds: executive sees ${asExec}/${total}, stakeholder sees ${asStake}/${total}`);
  });

  // ── Cognito ───────────────────────────────────────────────────────────────
  console.log('\n── Cognito ──');
  if (!hasCognito) {
    bad('COGNITO_USER_POOL_ID is not set', 'Set it in ../.env (and on the ECS task).');
  } else {
    await check('pool', async () => {
      const res = await cognito.send(new ListUsersCommand({ UserPoolId: USER_POOL_ID, Limit: 60 }));
      const n = (res.Users || []).length;
      ok(`pool ${USER_POOL_ID} reachable — ${n}${res.PaginationToken ? '+' : ''} account(s)`);

      const emails = new Set((res.Users || []).map(u =>
        (u.Attributes?.find(a => a.Name === 'email')?.Value || u.Username || '').toLowerCase()));
      const profiles = await q('select lower(email) as email from profiles where active');
      const noAccount = profiles.filter(p => !emails.has(p.email));
      if (noAccount.length && !res.PaginationToken) {
        warn(`${noAccount.length} active profile(s) have no Cognito account`,
             'They cannot sign in. Run node onboard.mjs --apply, or create-stakeholder.mjs.');
      }
    });
  }

  report();
}

function report() {
  console.log('');
  if (!problems.length && !warnings.length) {
    console.log('\x1b[32mEverything checks out.\x1b[0m\n');
    return 0;
  }
  if (problems.length) {
    console.log(`\x1b[31m${problems.length} problem(s) to fix:\x1b[0m`);
    problems.forEach((p, i) => {
      console.log(`  ${i + 1}. ${p.msg}`);
      if (p.fix) console.log(`     → ${p.fix}`);
    });
    console.log('');
  }
  if (warnings.length) {
    console.log(`\x1b[33m${warnings.length} warning(s):\x1b[0m`);
    warnings.forEach((w, i) => {
      console.log(`  ${i + 1}. ${w.msg}`);
      if (w.fix) console.log(`     → ${w.fix}`);
    });
    console.log('');
  }
  return problems.length ? 1 : 0;
}

main()
  .then(async () => {
    const code = problems.length ? 1 : 0;
    await db.end();
    process.exit(code);
  })
  .catch(async (err) => {
    console.error('\ndoctor failed:', err.message);
    await db.end().catch(() => {});
    process.exit(1);
  });
