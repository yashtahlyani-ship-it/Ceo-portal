// Shared plumbing for the integration tests.
//
// Two kinds of client here, and the distinction is the whole point:
//
//   • signIn(email)  — bound to a profile, running with `set local role
//     authenticated` and `app.user_id` set. This is EXACTLY the path a real
//     request takes through backend/db.js withUser(), so everything under test
//     is exercised through the same enforcement the live app uses.
//
//   • admin          — unbound: no identity, table owner, RLS does not apply.
//     The equivalent of the old service-role key. Used ONLY to build fixtures
//     and to independently verify what actually landed in the table. Never used
//     to perform the action being tested.
//
// ── What changed in the AWS migration ────────────────────────────────────────
//
// Before: these tests used the Supabase anon key over HTTPS — a browser's exact
// surface. Now they speak to Postgres directly through tests/pg-shim.mjs.
//
// That is a real change in what is covered, and it is worth being precise about
// it rather than pretending otherwise:
//
//   • UNCHANGED — every assertion about whether the SERVER refuses. RLS
//     policies, the SECURITY DEFINER RPCs, the forward-only state machine, the
//     promised-date lock, the append-only audit log. All of it runs here
//     exactly as it runs in production.
//
//   • NEWLY UNCOVERED — the HTTP layer between the browser and those policies:
//     whether every route actually uses withUser() rather than the unrestricted
//     query(). Nothing in this file can see that, so it is covered separately
//     and statically by tests/routes.test.mjs, which fails if a route reaches
//     for the RLS-bypassing client.
//
//   • MOVED — Cognito sign-in, S3 attachments and the invite endpoint cannot be
//     tested against a bare database. They live in tests/api.test.mjs, which
//     runs against a deployed API and skips itself when one is not configured.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import dotenv from 'dotenv';
import { createPool, createClient } from './pg-shim.mjs';

const here = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(here, '..', '.env') });

const config = {
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT || '5442', 10),
  database: process.env.DB_NAME     || 'gyftr_ceo',
  user:     process.env.DB_USER     || 'gyftr_admin',
  password: process.env.DB_PASSWORD,
  ssl:      process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
};

if (!config.password) {
  console.error('Missing DB_PASSWORD in ../.env — the integration tests connect to Postgres directly.');
  console.error('For a local run: `docker compose up -d postgres backend`, then copy .env.example → .env.');
  process.exit(1);
}

const pool = createPool(config);

// The service-role equivalent: no identity, so no RLS.
export const admin = createClient(pool, null);

// A signed-in, browser-equivalent client for one person. Cached so two
// identities can be held at once without one clobbering the other.
const clients = new Map();
export async function signIn(email) {
  if (clients.has(email)) return clients.get(email);
  const id = await profileIdFor(email);
  const c = createClient(pool, id);
  clients.set(email, c);
  return c;
}

// An unauthenticated caller: role `authenticated` but no app.user_id, so
// auth.uid() is NULL and every policy comparison fails. This is the shape of a
// request that got past the token check but carries no identity — which should
// be impossible, and returns nothing if it ever happens.
export function anonClient() {
  return createClient(pool, null, { anon: true });
}

export async function profileIdFor(email) {
  const rows = await admin.sql('select id from profiles where email = $1', [email]);
  if (!rows[0]) throw new Error(`no profile for ${email} — run \`npm run seed\` first`);
  return rows[0].id;
}

/* Which accounts the tests run as.
   Resolved FROM THE DATABASE rather than hard-coded, for two reasons: the real
   roster is gitignored (this repo is public, so real addresses must never be
   committed), and the demo roster can be swapped without editing tests.

   Picks the EA, a CEO if one exists (falling back to the EA, since the two
   roles have identical powers), and the first two stakeholders alphabetically
   so runs are deterministic. */
let _accounts = null;
export async function accounts() {
  if (_accounts) return _accounts;
  const data = await admin.sql(
    'select email, role from profiles where active = true order by email'
  );
  const ea  = data.find((p) => p.role === 'ea');
  const ceo = data.find((p) => p.role === 'ceo') || ea;
  const sh  = data.filter((p) => p.role === 'stakeholder');
  if (!ea || sh.length < 2) {
    throw new Error('Need one EA and at least two stakeholders — run `npm run seed` first.');
  }
  _accounts = { EA: ea.email, CEO: ceo.email, ALICE: sh[0].email, BOB: sh[1].email };
  return _accounts;
}

// Tasks created by tests, torn down in cleanup().
const created = [];

/**
 * Build a fresh task with the given assignees, as the service role so the test
 * starts from a known state regardless of what the seed produced.
 * Returns the task id plus a lookup from assignee email → assignment id.
 */
export async function freshTask({ assignees = [], title = 'test fixture task', priority = 'medium',
  expectedDate = null, followupDate = null } = {}) {
  const creator = await profileIdFor((await accounts()).CEO);
  const [task] = await admin.sql(
    `insert into tasks (title, description, priority, expected_date, next_followup_date, created_by)
     values ($1, 'created by the integration tests', $2, $3, $4, $5) returning *`,
    [title, priority, expectedDate, followupDate, creator]
  );
  created.push(task.id);

  const byEmail = {};
  for (const email of assignees) {
    const sid = await profileIdFor(email);
    const [a] = await admin.sql(
      'insert into task_assignments (task_id, stakeholder_id) values ($1,$2) returning *',
      [task.id, sid]
    );
    byEmail[email] = a.id;
  }

  return {
    taskId: task.id,
    assignments: byEmail,
    assignmentFor: (email) => {
      const id = byEmail[email];
      if (!id) throw new Error(`${email} is not assigned to this fixture`);
      return id;
    },
  };
}

// Remove every fixture task. Cascades take the assignments, comments and
// attachments with them; audit rows survive by design (task_id is set null),
// which is exactly the append-only behaviour the tests assert.
export async function cleanup() {
  if (created.length) {
    await admin.sql('delete from tasks where id = any($1)', [created]);
  }
  // Probe tasks created through the RPC in the permissions test.
  await admin.sql("delete from tasks where title like 'perm probe %'");
  await pool.end();
}
