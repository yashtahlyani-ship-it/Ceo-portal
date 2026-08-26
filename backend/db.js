// db.js — RDS Postgres connection pool + the per-request RLS identity binding.
//
// Credentials come from env vars, or AWS Secrets Manager if AWS_SECRET_NAME is
// set. That half mirrors the Marketing and Legal siblings exactly.
//
// What is different here, and why: those two portals enforce authorization in
// Express middleware. This one enforces it in Postgres Row-Level Security,
// because its central requirement is that a stakeholder never sees a
// co-assignee's status, promised date or comments — and a row predicate holds
// on every query path, including ones nobody has written yet. See
// sql/00_compat.sql for the full argument and the mechanism.
//
// The practical consequence for anyone writing a route: use `withUser`, not
// `query`. See the comments on each below.

import pg from 'pg';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { readFile, readdir } from 'fs/promises';
import { fileURLToPath } from 'url';

const { Pool } = pg;
let pool;

// ── Type parsing ─────────────────────────────────────────────────────────────
// node-postgres returns int8 (bigint) as a STRING, because a Postgres bigint can
// exceed what a JS number holds exactly. PostgREST returned JSON numbers, and
// the React app was written against that: task ids, assignment ids and the
// `(count)` aggregates are all int8, and they are compared, keyed and used in
// URLs throughout the frontend.
//
// Left alone, `task.id === 12` would be false while `task.id === '12'` was true,
// which is exactly the kind of migration bug that shows up as one component
// mysteriously not highlighting the selected row. Parse them as numbers so the
// API emits the same JSON shape the frontend already expects.
//
// Safe here: these are identity columns on tables holding thousands of rows, so
// they will not approach 2^53. If a counter in this schema ever could, this
// decision needs revisiting rather than extending.
pg.types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10)));

async function getDbCredentials() {
  if (process.env.AWS_SECRET_NAME) {
    const client = new SecretsManagerClient({ region: process.env.AWS_REGION || 'ap-south-1' });
    const res = await client.send(new GetSecretValueCommand({ SecretId: process.env.AWS_SECRET_NAME }));
    const secret = JSON.parse(res.SecretString);
    return {
      host:     secret.host,
      port:     secret.port || 5432,
      database: secret.dbname,
      user:     secret.username,
      password: secret.password,
    };
  }
  return {
    host:     process.env.DB_HOST,
    port:     parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME,
    user:     process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  };
}

// ── Migrations ───────────────────────────────────────────────────────────────
// Applies sql/*.sql in filename order on every boot. Every statement is
// idempotent (create ... if not exists, create or replace, drop policy if
// exists), which was verified end to end against Supabase and is the property
// that makes deploying just a restart — nobody has to remember to run psql.
//
// Order is load-bearing: 00_compat defines auth.uid() and the `authenticated`
// role that everything after it references, and 08_grants needs every table to
// exist. Sorting by filename is what keeps that true, so the numeric prefixes
// are not decoration.
//
// Each file runs as ONE pool.query, so it is implicitly a single transaction —
// a syntax error halfway through a file rolls that whole file back rather than
// leaving the schema half-applied.
async function applyMigrations() {
  const dir = fileURLToPath(new URL('./sql/', import.meta.url));
  const files = (await readdir(dir)).filter(f => f.endsWith('.sql')).sort();

  for (const file of files) {
    const sql = await readFile(dir + file, 'utf8');
    try {
      await pool.query(sql);
      console.log(`[db] Applied ${file}`);
    } catch (err) {
      // Name the file. A bare Postgres error with no filename against ~1200
      // lines of migration is a genuinely miserable thing to debug.
      throw new Error(`Migration ${file} failed: ${err.message}`);
    }
  }
  console.log(`[db] ${files.length} migrations applied (idempotent)`);
}

// ── Init state, so the API can answer "why is this broken?" instead of dying ─
let _ready = false;
let _lastError = null;

export const isDbReady   = () => _ready;
export const dbLastError = () => (_lastError ? _lastError.message : null);

/**
 * Connect, retrying in the background forever.
 *
 * Taken from the Legal sibling, which learned it the hard way: awaiting the
 * connection at startup and exiting on failure meant a transient RDS problem
 * crash-looped the container, emptied the target group, and left the ALB
 * serving a bare 503 with no surface left to ask what was wrong. A broken
 * deploy and a brief database blip looked identical.
 *
 * Now the API stays up, says exactly what is wrong at /health/deep, and
 * recovers on its own when the database comes back.
 */
export async function initDbWithRetry({ intervalMs = 10000 } = {}) {
  let attempt = 0;
  for (;;) {
    attempt++;
    try {
      await initDb();
      _ready = true;
      _lastError = null;
      console.log(`[db] Ready (attempt ${attempt}).`);
      return;
    } catch (err) {
      _ready = false;
      _lastError = err;
      console.error(`[db] Not ready (attempt ${attempt}): ${err.message}`);
      if (attempt === 1) {
        console.error('[db] The API is up and will keep retrying. GET /health/deep for the current reason.');
      }
      await new Promise(r => setTimeout(r, intervalMs));
    }
  }
}

export async function initDb() {
  const creds = await getDbCredentials();

  if (!creds.host || !creds.database || !creds.user || !creds.password) {
    throw new Error(
      'Database not configured. Set DB_HOST, DB_NAME, DB_USER, DB_PASSWORD ' +
      '(or AWS_SECRET_NAME for Secrets Manager).'
    );
  }

  pool = new Pool({
    ...creds,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

  const client = await pool.connect();
  console.log('[db] Connected to RDS Postgres:', creds.host);
  client.release();

  await applyMigrations();
}

/**
 * Run a query with NO user identity and NO row-level security.
 *
 * This is the equivalent of Supabase's service-role key: it runs as the
 * connecting user, who owns the tables and therefore bypasses every policy in
 * this schema. It is the right tool for exactly three things:
 *
 *   • health checks
 *   • resolving a verified Cognito token to a profile (middleware/identity.js),
 *     which by definition happens before there is an identity to run as
 *   • admin/onboarding operations that are already gated by a role check in
 *     the route
 *
 * For anything that serves data to a user, use `withUser` instead. Reaching
 * for `query` in a route handler is how a portal that enforces isolation in
 * the database quietly stops enforcing it.
 */
export function query(sql, params) {
  if (!pool) throw new Error('DB not initialized — call initDb() first');
  return pool.query(sql, params);
}

/**
 * Run a function's queries AS a given user, with row-level security applied.
 *
 * This is the workhorse. Every route that reads or writes on behalf of a
 * signed-in person goes through it.
 *
 *   const tasks = await withUser(req.profile.id, c =>
 *     c.query('select * from tasks order by created_at desc')
 *   );
 *
 * Note what the caller does NOT write: any `where` clause about who may see
 * what. `select * from tasks` returns every task to an executive and only the
 * caller's own to a stakeholder, because the policy decides. That is the whole
 * design — see sql/00_compat.sql.
 *
 * Three details that matter:
 *
 *  • SET LOCAL ROLE authenticated switches to a NON-OWNER role. Table owners
 *    bypass RLS in Postgres, so without this the policies would silently do
 *    nothing while every query still appeared to work correctly.
 *
 *  • Both `set_config(..., true)` and SET LOCAL are transaction-scoped, so the
 *    identity cannot leak to the next request that borrows this pooled
 *    connection. COMMIT and ROLLBACK both clear them.
 *
 *  • userId is passed as a bind parameter, never interpolated. It arrives from
 *    a signature-verified token so it is not attacker-controlled today, but
 *    string-building a session variable that every policy trusts is not a
 *    thing to leave lying around for the next person to copy.
 */
export async function withUser(userId, fn) {
  if (!pool) throw new Error('DB not initialized — call initDb() first');
  if (!userId) throw new Error('withUser requires a profile id — refusing to run a query with no identity');

  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query("select set_config('app.user_id', $1, true)", [userId]);
    await client.query('set local role authenticated');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Admin-privileged transaction — no identity, no RLS, but atomic.
 * Used by onboarding, where several profile writes must land together.
 */
export async function withTransaction(fn) {
  if (!pool) throw new Error('DB not initialized — call initDb() first');
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
