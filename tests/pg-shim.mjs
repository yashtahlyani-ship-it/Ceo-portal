// ════════════════════════════════════════════════════════════════════════════
//  tests/pg-shim.mjs — a small PostgREST-shaped query builder over `pg`.
//
//  ── Why this exists ─────────────────────────────────────────────────────────
//
//  The 41 security tests are the most valuable artifact in this repository.
//  They are the reason anyone can believe the isolation guarantee, and they
//  were written, reviewed and argued over against Supabase.
//
//  Rewriting all 829 lines of them by hand as part of the AWS migration would
//  have meant re-deriving 41 assertions under time pressure — and a security
//  test that is subtly weakened still passes. The failure mode of that mistake
//  is silent and permanent.
//
//  So the tests keep their exact text, and this file recreates the substrate
//  they were written against: the small slice of the Supabase query-builder API
//  they actually use, executed as SQL against Postgres. Same reasoning as
//  backend/sql/00_compat.sql, applied to the test suite instead of the schema.
//
//  ── What this is NOT ────────────────────────────────────────────────────────
//
//  Not a general PostgREST implementation, and it must never grow into one. It
//  supports precisely the surface the tests use:
//
//      from · rpc · select · insert · update · delete
//      eq · in · like · gte · filter · order · limit · single
//      two specific embed shapes (see parseSelect)
//
//  Anything else throws loudly rather than returning a wrong answer, because a
//  shim that quietly mis-handles a filter would turn a real security failure
//  into a green test. If you need another operator, add it here explicitly.
//
//  ── The important part ──────────────────────────────────────────────────────
//
//  A client is bound to a profile id (a signed-in browser) or to nobody (the
//  service role). A bound client runs every statement inside:
//
//      begin; set_config('app.user_id', <id>, true); set local role authenticated;
//
//  which is byte-for-byte what backend/db.js `withUser` does in production. So
//  these tests exercise the SAME enforcement path the live app does — a pass
//  still means the server refused, not that a button was hidden.
// ════════════════════════════════════════════════════════════════════════════

import pg from 'pg';

const { Pool } = pg;

// Match backend/db.js: int8 as a JS number, not a string. Without this the
// tests would compare ids against a different type than production returns,
// which is the sort of divergence that makes a suite quietly stop testing the
// thing it claims to.
pg.types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10)));

export function createPool(config) {
  return new Pool({ ...config, max: 8 });
}

const ident = (s) => {
  // Column and table names come from test source, never from user input, but a
  // typo silently producing invalid SQL is worse than a clear throw.
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s)) throw new Error(`pg-shim: unsafe identifier ${JSON.stringify(s)}`);
  return s;
};

/**
 * Translate a PostgREST `select` string into SQL.
 *
 * Supports:
 *   '*'                                          → t.*
 *   'a, b, c'                                    → t.a, t.b, t.c
 *   'alias:child_table(cols)'                    → correlated json_agg array
 *   'alias:profiles!<table>_<col>_fkey(cols)'    → correlated json_build_object
 *
 * The FK form derives its join column from the constraint name, which is
 * exactly the information the constraint name encodes — and naming it is what
 * the production code has to do too, because three tables here have two
 * foreign keys into `profiles` and an unqualified embed is ambiguous.
 */
function parseSelect(sel, table) {
  if (!sel || sel.trim() === '*') return 't.*';

  // Split on commas that are not inside parentheses.
  const parts = [];
  let depth = 0, cur = '';
  for (const ch of sel) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur);

  return parts.map((raw) => {
    const part = raw.trim();

    const embed = part.match(/^(\w+):(\w+)(?:!(\w+))?\((.*)\)$/);
    if (!embed) return `t.${ident(part)}`;

    const [, alias, target, fkName, colsRaw] = embed;
    const cols = colsRaw.split(',').map(c => c.trim()).filter(Boolean);

    if (fkName) {
      // Many-to-one: tasks.created_by → profiles.id
      // 'tasks_created_by_fkey' → 'created_by'
      const col = fkName.replace(new RegExp(`^${table}_`), '').replace(/_fkey$/, '');
      const obj = cols.map(c => `'${c}', e.${ident(c)}`).join(', ');
      return `(select json_build_object(${obj}) from ${ident(target)} e where e.id = t.${ident(col)}) as ${ident(alias)}`;
    }

    // One-to-many: tasks.id → task_assignments.task_id.
    // Derived by convention from the parent table name; the shim only ever
    // needs `tasks` → `task_id`, and an unexpected shape throws below.
    const fkCol = table.replace(/s$/, '') + '_id';
    const proj = cols.length === 1 && cols[0] === '*'
      ? 'to_jsonb(e)'
      : `json_build_object(${cols.map(c => `'${c}', e.${ident(c)}`).join(', ')})`;
    return `(select coalesce(json_agg(${proj}), '[]'::json) from ${ident(target)} e where e.${ident(fkCol)} = t.id) as ${ident(alias)}`;
  }).join(', ');
}

class Query {
  constructor(run, table) {
    this._run = run;
    this._table = table;
    this._op = 'select';
    this._sel = '*';
    this._filters = [];
    this._order = null;
    this._limit = null;
    this._single = false;
    this._payload = null;
  }

  select(sel = '*') { this._sel = sel; if (this._op === 'select') this._op = 'select'; return this; }
  insert(rows)      { this._op = 'insert'; this._payload = Array.isArray(rows) ? rows : [rows]; return this; }
  update(obj)       { this._op = 'update'; this._payload = obj; return this; }
  delete()          { this._op = 'delete'; return this; }

  eq(col, val)  { this._filters.push({ col, op: '=',    val }); return this; }
  gte(col, val) { this._filters.push({ col, op: '>=',   val }); return this; }
  like(col, val){ this._filters.push({ col, op: 'like', val }); return this; }
  in(col, vals) { this._filters.push({ col, op: 'in',   val: vals }); return this; }

  filter(col, op, val) {
    const map = { eq: '=', gte: '>=', gt: '>', lte: '<=', lt: '<', like: 'like', neq: '<>' };
    if (!map[op]) throw new Error(`pg-shim: unsupported filter operator '${op}'`);
    this._filters.push({ col, op: map[op], val });
    return this;
  }

  order(col, { ascending = true } = {}) { this._order = `${ident(col)} ${ascending ? 'asc' : 'desc'}`; return this; }
  limit(n) { this._limit = n; return this; }
  single() { this._single = true; return this; }
  maybeSingle() { this._single = 'maybe'; return this; }

  _where(params) {
    if (!this._filters.length) return '';
    const clauses = this._filters.map(({ col, op, val }) => {
      if (op === 'in') {
        params.push(val);
        return `t.${ident(col)} = any($${params.length})`;
      }
      params.push(val);
      return `t.${ident(col)} ${op} $${params.length}`;
    });
    return ' where ' + clauses.join(' and ');
  }

  _build() {
    const params = [];
    const table = ident(this._table);

    if (this._op === 'insert') {
      const cols = Object.keys(this._payload[0]);
      const tuples = this._payload.map(row =>
        '(' + cols.map(c => { params.push(row[c]); return `$${params.length}`; }).join(', ') + ')'
      );
      return {
        text: `insert into ${table} as t (${cols.map(ident).join(', ')}) values ${tuples.join(', ')} returning ${parseSelect(this._sel, this._table)}`,
        params,
      };
    }

    if (this._op === 'update') {
      const cols = Object.keys(this._payload);
      const sets = cols.map(c => { params.push(this._payload[c]); return `${ident(c)} = $${params.length}`; });
      return {
        text: `update ${table} as t set ${sets.join(', ')}${this._where(params)} returning ${parseSelect(this._sel, this._table)}`,
        params,
      };
    }

    if (this._op === 'delete') {
      return {
        text: `delete from ${table} as t${this._where(params)} returning ${parseSelect(this._sel, this._table)}`,
        params,
      };
    }

    let text = `select ${parseSelect(this._sel, this._table)} from ${table} t${this._where(params)}`;
    if (this._order) text += ` order by ${this._order}`;
    if (this._limit != null) text += ` limit ${parseInt(this._limit, 10)}`;
    return { text, params };
  }

  // Thenable: awaiting the builder runs it. Always resolves to
  // { data, error } — never rejects — matching what the tests expect, because
  // `assert.ok(error)` is how most of them assert a refusal.
  then(resolve, reject) {
    const { text, params } = this._build();
    return this._run(text, params).then(
      (rows) => {
        if (this._single) {
          if (rows.length !== 1 && this._single !== 'maybe') {
            return resolve({ data: null, error: new Error(`expected exactly one row, got ${rows.length}`) });
          }
          return resolve({ data: rows[0] ?? null, error: null });
        }
        return resolve({ data: rows, error: null });
      },
      (err) => resolve({ data: null, error: err })
    ).catch(reject);
  }
}

/**
 * Build a client.
 *
 * @param pool      a pg Pool
 * @param profileId the signed-in profile, or null for the service-role
 *                  equivalent (no identity, no RLS)
 */
export function createClient(pool, profileId = null, { anon = false } = {}) {
  // Three modes:
  //   profileId set  → a signed-in person. RLS applies, auth.uid() = profileId.
  //   anon: true     → role `authenticated` but NO identity, so auth.uid() is
  //                    NULL and every policy comparison fails. This is the
  //                    shape of a request that reached the database carrying no
  //                    identity, and it must see nothing.
  //   neither        → the service-role equivalent. Table owner, RLS bypassed.
  //                    Fixtures and verification only.
  const bound = Boolean(profileId) || anon;

  async function run(text, params) {
    const client = await pool.connect();
    try {
      if (bound) {
        // EXACTLY what backend/db.js withUser() does. If these two ever drift,
        // the tests stop testing the thing that runs in production — so if you
        // change one, change the other.
        await client.query('begin');
        if (profileId) {
          await client.query("select set_config('app.user_id', $1, true)", [profileId]);
        }
        await client.query('set local role authenticated');
        try {
          const res = await client.query(text, params);
          await client.query('commit');
          return res.rows;
        } catch (err) {
          await client.query('rollback').catch(() => {});
          throw err;
        }
      }
      const res = await client.query(text, params);
      return res.rows;
    } finally {
      client.release();
    }
  }

  return {
    profileId,
    from: (table) => new Query(run, table),

    // RPC: `select fn(...)`. Named `=>` notation is used so the tests'
    // `{ p_task_id: 1 }` shape works regardless of parameter order in the
    // function signature — matching how Supabase's .rpc() behaved.
    //
    // `to_jsonb` is not cosmetic. Seven of these functions return a composite
    // row type (`returns task_assignments`), and node-postgres has no parser
    // for composites — it hands back the raw Postgres literal, `(12,todo,...)`,
    // as a string. Tests reading `.data.status` would get undefined rather than
    // a failure, which is worse than an error. to_jsonb is used rather than
    // row_to_json because it also handles the scalar returns (bigint, void,
    // text[]) uniformly, and this one call site sees all of them.
    async rpc(fn, args = {}) {
      const names = Object.keys(args);
      const params = names.map(n => args[n]);
      const call = names.length
        ? names.map((n, i) => `${ident(n)} => $${i + 1}`).join(', ')
        : '';
      try {
        const rows = await run(`select to_jsonb(${ident(fn)}(${call})) as result`, params);
        return { data: rows[0]?.result ?? null, error: null };
      } catch (err) {
        return { data: null, error: err };
      }
    },

    // Escape hatch for assertions that are easier to express directly.
    async sql(text, params = []) {
      return run(text, params);
    },
  };
}
