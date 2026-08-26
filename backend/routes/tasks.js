// routes/tasks.js — the board.
//
// Every handler runs its queries through `withUser`, so Row-Level Security
// decides what comes back. Note what you will NOT find below: any `where`
// clause about who may see what. `select * from tasks` returns the whole board
// to an executive and only their own assigned tasks to a stakeholder, because
// the policy in sql/03_policies.sql says so. Adding a hand-written visibility
// filter here would not make it safer — it would create a second, weaker copy
// of the rule that can drift.

import { Router } from 'express';
import { withUser } from '../db.js';
import { handle, HttpError } from '../errors.js';
import { removeObjects } from '../s3.js';

const router = Router();

// ── The board read ───────────────────────────────────────────────────────────
// Replaces the PostgREST embed the frontend used to request. The shape of the
// response is deliberately identical to what PostgREST returned, so the React
// components needed no change.
//
// The sub-selects are the interesting part: they run under the SAME RLS as the
// outer query, so a stakeholder's `assignments` array contains only their own
// row and `comment_count` counts only their own thread. That is what lets a
// card show "3 comments" without leaking that a co-assignee wrote twelve —
// the isolation is in the count itself, not in what the component renders.
const TASK_SELECT = `
  select
    t.*,
    (select json_build_object('id', p.id, 'name', p.name, 'role', p.role)
       from profiles p where p.id = t.created_by) as creator,
    (select count(*)::int from task_attachments a where a.task_id = t.id) as attachment_count,
    coalesce((
      select json_agg(a order by a.created_at)
      from (
        select
          ta.*,
          (select json_build_object('id', p.id, 'name', p.name, 'title', p.title, 'color', p.color)
             from profiles p where p.id = ta.stakeholder_id) as stakeholder,
          (select count(*)::int from task_comments c where c.assignment_id = ta.id) as comment_count
        from task_assignments ta
        where ta.task_id = t.id
      ) a
    ), '[]'::json) as assignments
  from tasks t
`;

router.get('/tasks', handle(async (req, res) => {
  const includeArchived = req.query.includeArchived === 'true';
  const rows = await withUser(req.profile.id, c => c.query(
    `${TASK_SELECT}
      ${includeArchived ? '' : 'where t.archived = false'}
      order by t.created_at desc`
  ));
  res.json(rows.rows);
}));

router.get('/tasks/archived', handle(async (req, res) => {
  const rows = await withUser(req.profile.id, c => c.query(
    `${TASK_SELECT} where t.archived = true order by t.archived_at desc`
  ));
  res.json(rows.rows);
}));

router.get('/tasks/:id/audit', handle(async (req, res) => {
  const rows = await withUser(req.profile.id, c => c.query(
    `select l.*,
            (select json_build_object('id', p.id, 'name', p.name)
               from profiles p where p.id = l.actor_id) as actor
       from audit_log l
      where l.task_id = $1
      order by l.created_at desc`,
    [req.params.id]
  ));
  res.json(rows.rows);
}));

// ── Mutations ────────────────────────────────────────────────────────────────
// These call the SECURITY DEFINER RPCs unchanged. The rule lives inside each
// function, which is why the route bodies are this thin — there is nothing to
// check here that SQL is not already checking, and duplicating it would just
// create somewhere for the two copies to disagree.

router.post('/tasks', handle(async (req, res) => {
  const t = req.body || {};
  const { rows } = await withUser(req.profile.id, c => c.query(
    'select create_task($1,$2,$3,$4,$5,$6) as id',
    [t.title, t.description || '', t.priority || 'medium',
     t.expected_date || null, t.next_followup_date || null, t.stakeholders || []]
  ));
  res.status(201).json({ id: rows[0].id });
}));

// CR-01 #6. A separate, narrower RPC on purpose: it takes no assignee list, so
// a stakeholder can never route a self-raised task to somebody else.
router.post('/tasks/self', handle(async (req, res) => {
  const t = req.body || {};
  const { rows } = await withUser(req.profile.id, c => c.query(
    'select create_self_task($1,$2,$3,$4) as id',
    [t.title, t.description || '', t.priority || 'medium', t.expected_date || null]
  ));
  res.status(201).json({ id: rows[0].id });
}));

router.patch('/tasks/self/:id', handle(async (req, res) => {
  const t = req.body || {};
  await withUser(req.profile.id, c => c.query(
    'select update_self_task($1,$2,$3,$4,$5)',
    [req.params.id, t.title, t.description || '', t.priority || 'medium', t.expected_date || null]
  ));
  res.json({ ok: true });
}));

router.post('/tasks/self/:id/archive', handle(async (req, res) => {
  await withUser(req.profile.id, c => c.query('select archive_self_task($1)', [req.params.id]));
  res.json({ ok: true });
}));

// Executive-only direct field edits. RLS gates the update (tasks_update is
// `using (is_executive())`) and a trigger writes one audit row per changed
// field, so this stays a plain UPDATE rather than another RPC.
//
// The column allow-list is not an authorization check — RLS already refused a
// non-executive before we get here. It exists so that a client cannot reach
// columns the workflow owns: `archived`, `created_by` and the promised-date
// fields all have their own audited paths, and letting a generic PATCH write
// them would route around the audit trail rather than around a permission.
const EDITABLE = ['title', 'description', 'priority', 'expected_date', 'next_followup_date'];

router.patch('/tasks/:id', handle(async (req, res) => {
  const fields = Object.keys(req.body || {}).filter(k => EDITABLE.includes(k));
  if (!fields.length) throw new HttpError(400, 'No editable fields supplied');

  const sets = fields.map((f, i) => `${f} = $${i + 2}`).join(', ');
  const values = fields.map(f => req.body[f]);

  const { rows } = await withUser(req.profile.id, c => c.query(
    `update tasks set ${sets} where id = $1 returning *`,
    [req.params.id, ...values]
  ));
  // RLS returning no row here means the policy refused the update, not that
  // the task is missing — either way the caller may not do this.
  if (!rows[0]) throw new HttpError(403, 'FORBIDDEN: you cannot edit this task');
  res.json(rows[0]);
}));

router.post('/tasks/:id/archive', handle(async (req, res) => {
  await withUser(req.profile.id, c => c.query('select archive_task($1)', [req.params.id]));
  res.json({ ok: true });
}));

router.post('/tasks/:id/restore', handle(async (req, res) => {
  await withUser(req.profile.id, c => c.query('select restore_task($1)', [req.params.id]));
  res.json({ ok: true });
}));

// ── Permanent delete (CR-01 #6) ──────────────────────────────────────────────
// Irreversible. The RPC records a `task_deleted` audit event BEFORE removing
// the row — audit_log.task_id is ON DELETE SET NULL, so the history outlives
// the task and still reads "X deleted 'Prepare Q4 Growth Strategy'". It then
// returns the storage keys its attachments orphaned, which SQL cannot reach.
//
// The S3 cleanup runs after the delete has already committed and is
// best-effort by design; see s3.js removeObjects.
async function deleteVia(rpc, req) {
  const { rows } = await withUser(req.profile.id, c => c.query(
    `select ${rpc}($1) as paths`, [req.params.id]
  ));
  await removeObjects(rows[0]?.paths || []);
}

router.delete('/tasks/:id', handle(async (req, res) => {
  await deleteVia('delete_task', req);
  res.json({ ok: true });
}));

router.delete('/tasks/self/:id', handle(async (req, res) => {
  await deleteVia('delete_self_task', req);
  res.json({ ok: true });
}));

// ── Stakeholders on a task ───────────────────────────────────────────────────
router.post('/tasks/:id/stakeholders', handle(async (req, res) => {
  const { rows } = await withUser(req.profile.id, c => c.query(
    'select row_to_json(add_stakeholder($1,$2)) as a', [req.params.id, req.body.stakeholder_id]
  ));
  res.status(201).json(rows[0].a);
}));

export default router;
