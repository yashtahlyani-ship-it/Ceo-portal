// Shared plumbing for the integration tests.
//
// Two kinds of client here, and the distinction is the whole point:
//   • anonClient() / signIn()  — the anon key, exactly what a browser holds.
//     Everything under test is exercised through these.
//   • admin                    — the service role, which bypasses RLS. Used ONLY
//     to set up fixtures and to independently verify what actually landed in the
//     table. Never used to perform the action being tested.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const here = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(here, '..', '.env') });

const url = process.env.VITE_SUPABASE_URL;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anonKey || !serviceKey) {
  console.error('Missing Supabase env. Expected VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY');
  console.error('and SUPABASE_SERVICE_ROLE_KEY in ../.env');
  process.exit(1);
}

// The demo password is NOT hard-coded here. This repository is public, and a
// literal would be a working CEO login for a live, publicly reachable site.
// It lives in .env (gitignored) and is set on the accounts by the seed.
export const DEMO_PASSWORD = process.env.DEMO_PASSWORD;

if (!DEMO_PASSWORD) {
  console.error('Missing DEMO_PASSWORD in ../.env — the integration tests sign in');
  console.error('as the seeded demo accounts and need it. See HANDOVER.md.');
  process.exit(1);
}

const noPersist = { auth: { autoRefreshToken: false, persistSession: false } };

export const anonClient = () => createClient(url, anonKey, noPersist);
export const admin = createClient(url, serviceKey, noPersist);

// A signed-in browser-equivalent client. Each call gets its own client so two
// identities can be held at once without one clobbering the other's session.
const sessions = new Map();
export async function signIn(email, password = DEMO_PASSWORD) {
  if (sessions.has(email)) return sessions.get(email);
  const c = anonClient();
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`could not sign in ${email}: ${error.message}`);
  sessions.set(email, c);
  return c;
}

export async function profileIdFor(email) {
  const { data, error } = await admin.from('profiles').select('id').eq('email', email).single();
  if (error) throw error;
  return data.id;
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
  const { data, error } = await admin.from('profiles')
    .select('email, role').eq('active', true).order('email');
  if (error) throw error;
  const ea = data.find((p) => p.role === 'ea');
  const ceo = data.find((p) => p.role === 'ceo') || ea;
  const sh = data.filter((p) => p.role === 'stakeholder');
  if (!ea || sh.length < 2) {
    throw new Error('Need one EA and at least two stakeholders — run `npm run seed` first.');
  }
  _accounts = { EA: ea.email, CEO: ceo.email, ALICE: sh[0].email, BOB: sh[1].email };
  return _accounts;
}

// Tasks created by tests, torn down in cleanup().
const created = [];

/**
 * Build a fresh task with the given assignees, via the service role so the test
 * starts from a known state regardless of what the seed produced.
 * Returns the task id plus a lookup from assignee email → assignment id.
 */
export async function freshTask({ assignees = [], title = 'test fixture task', priority = 'medium',
  expectedDate = null, followupDate = null } = {}) {
  const creator = await profileIdFor((await accounts()).CEO);
  const { data: task, error } = await admin.from('tasks').insert({
    title, description: 'created by the integration tests', priority,
    expected_date: expectedDate, next_followup_date: followupDate, created_by: creator,
  }).select().single();
  if (error) throw error;
  created.push(task.id);

  const byEmail = {};
  for (const email of assignees) {
    const sid = await profileIdFor(email);
    const { data: a, error: aErr } = await admin.from('task_assignments')
      .insert({ task_id: task.id, stakeholder_id: sid }).select().single();
    if (aErr) throw aErr;
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
  if (created.length) await admin.from('tasks').delete().in('id', created);
  // Probe tasks created through the RPC in the permissions test.
  await admin.from('tasks').delete().like('title', 'perm probe %');
}
