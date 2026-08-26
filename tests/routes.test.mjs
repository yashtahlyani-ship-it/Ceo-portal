// ════════════════════════════════════════════════════════════════════════════
//  ROUTE SAFETY TESTS — static analysis of backend/routes/
//
//  ── Why this file exists ────────────────────────────────────────────────────
//
//  On Supabase, the browser talked to PostgREST directly. There was no code
//  path between the user and Row-Level Security, so there was nothing in
//  between to get wrong: if the policies were right, the app was right.
//
//  The move to AWS put an Express server in that gap, and with it a new way to
//  fail that never previously existed. backend/db.js exports two functions:
//
//      withUser(id, fn)  — runs as `authenticated` with auth.uid() set. RLS ON.
//      query(sql, params) — runs as the table owner. RLS COMPLETELY BYPASSED.
//
//  They are one word apart. A route that reaches for `query` still works, still
//  returns data, still passes every functional test — and quietly serves one
//  stakeholder another stakeholder's status, promised date and comments. The
//  single guarantee this product exists to provide would be gone, with nothing
//  red anywhere.
//
//  The database-level suite in security.test.mjs cannot see this: it tests the
//  policies, and the policies would still be perfect. So this gap is covered
//  here instead, statically — no database, no network, runs in milliseconds and
//  on every CI run.
//
//  If you are adding a route that genuinely needs to bypass RLS, add it to
//  ALLOWED below WITH a justification. Making that deliberate and reviewable is
//  the entire point.
// ════════════════════════════════════════════════════════════════════════════

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const routesDir = join(here, '..', 'backend', 'routes');

const routeFiles = readdirSync(routesDir).filter(f => f.endsWith('.js'));

// Files permitted to import the RLS-bypassing `query`, and why.
const ALLOWED = {
  // Calls the Cognito Admin API, which no database policy can cover, so it
  // does its own executive check at the top of each handler. Its profile
  // WRITES still go through withUser — only the Cognito-side lookups use query.
  'admin.js': 'gated by an explicit requireExecutive() check; AWS calls are outside RLS reach',
};

test('every route file exists and is non-trivial', () => {
  assert.ok(routeFiles.length >= 6, `expected the six route modules, found ${routeFiles.length}`);
});

test('no route bypasses row-level security without a documented exemption', () => {
  const offenders = [];

  for (const file of routeFiles) {
    const src = readFileSync(join(routesDir, file), 'utf8');

    // Does it import `query` from db.js at all?
    const importsQuery = /import\s*\{[^}]*\bquery\b[^}]*\}\s*from\s*['"]\.\.\/db\.js['"]/.test(src);
    if (importsQuery && !ALLOWED[file]) {
      offenders.push(
        `${file} imports the RLS-bypassing query() from db.js. Use withUser(req.profile.id, ...) ` +
        `instead, or add ${file} to ALLOWED in this test with a written justification.`
      );
    }
  }

  assert.deepEqual(offenders, [], '\n' + offenders.join('\n'));
});

test('every withUser call is bound to the authenticated caller', () => {
  const offenders = [];

  for (const file of routeFiles) {
    const src = readFileSync(join(routesDir, file), 'utf8');

    // withUser must be called with req.profile.id — never a value from the
    // request body, query string or params. Passing a caller-supplied id would
    // let anyone impersonate anyone by editing one field, and RLS would
    // faithfully enforce the wrong person's permissions.
    for (const m of src.matchAll(/withUser\(\s*([^,]+?)\s*,/g)) {
      const arg = m[1].trim();
      if (arg !== 'req.profile.id') {
        offenders.push(`${file}: withUser(${arg}, …) — must be withUser(req.profile.id, …)`);
      }
    }
  }

  assert.deepEqual(offenders, [], '\n' + offenders.join('\n'));
});

test('routes do not hand-roll visibility filters that duplicate a policy', () => {
  // A `where stakeholder_id = <the caller>` in a route is a copy of the
  // ta_select policy. Two copies of one rule is one copy too many: the policy
  // is authoritative, and a route-level duplicate will eventually disagree
  // with it — usually by being the more permissive of the two.
  const offenders = [];

  for (const file of routeFiles) {
    const src = readFileSync(join(routesDir, file), 'utf8');
    if (/where[^`;]*stakeholder_id\s*=\s*\$/i.test(src)) {
      offenders.push(`${file}: filters on stakeholder_id by hand — the ta_select policy already does this`);
    }
    if (/where[^`;]*recipient_id\s*=\s*\$/i.test(src)) {
      offenders.push(`${file}: filters on recipient_id by hand — the notif_select policy already does this`);
    }
  }

  assert.deepEqual(offenders, [], '\n' + offenders.join('\n'));
});

test('the server mounts authentication before every /api route', () => {
  const src = readFileSync(join(here, '..', 'backend', 'server.js'), 'utf8');

  const authAt = src.indexOf("app.use('/api', requireAuth, loadIdentity)");
  assert.ok(authAt > -1, 'server.js must mount requireAuth + loadIdentity on /api');

  // Any /api router mounted BEFORE that line would be publicly reachable. This
  // is exactly the mistake the Legal portal made with its AI endpoint, where an
  // unauthenticated route sat above the auth middleware and let anyone on the
  // internet spend the company's OpenAI credits.
  const before = src.slice(0, authAt);

  // Take a window after each mount rather than trying to match a balanced
  // expression — an inline middleware body contains both `)` and `;`, so any
  // single-character delimiter stops in the wrong place. (It did: the first
  // version of this regex stopped at the `)` inside `(req, res, next)` and
  // reported the readiness guard as a public route.)
  const earlyMounts = [...before.matchAll(/app\.use\(\s*'\/api'/g)]
    .map(m => before.slice(m.index, m.index + 400))
    // The database-readiness guard is deliberately above auth: it answers 503
    // and calls next(), and reveals nothing about the data behind it.
    .filter(block => !block.includes('isDbReady'))
    .map(block => block.split('\n')[0]);

  assert.deepEqual(
    earlyMounts, [],
    'these /api routes are mounted before authentication and are publicly reachable:\n' +
    earlyMounts.join('\n')
  );
});
