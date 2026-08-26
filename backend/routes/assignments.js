// routes/assignments.js — the isolation core.
//
// An assignment is one stakeholder's slice of a task: their status, their
// promised date, their comment thread. The product's central guarantee is that
// a stakeholder can never see a co-assignee's slice, and it is enforced by a
// single row predicate — `stakeholder_id = auth.uid()` in the ta_select policy.
//
// Every controlled mutation here goes through a SECURITY DEFINER RPC that
// checks its own rule: the forward-only state machine, the promised-date lock,
// executive override, the mandatory rejection reason. None of that is
// re-implemented in this file, and none of it should be.

import { Router } from 'express';
import { withUser } from '../db.js';
import { handle } from '../errors.js';

const router = Router();

// ── Reads ────────────────────────────────────────────────────────────────────

router.get('/assignments/:id/comments', handle(async (req, res) => {
  const rows = await withUser(req.profile.id, c => c.query(
    `select tc.*,
            (select json_build_object('id', p.id, 'name', p.name)
               from profiles p where p.id = tc.author_id) as author
       from task_comments tc
      where tc.assignment_id = $1
      order by tc.created_at`,
    [req.params.id]
  ));
  // No ownership check here on purpose. tc_select already restricts the thread
  // to the executive or the assignment's own stakeholder, so a stakeholder
  // guessing another assignment's id gets an empty array rather than a thread.
  res.json(rows.rows);
}));

// CR-02 #3: the Proposed Date queue — everything awaiting an executive
// decision, oldest first, so nothing sits unanswered.
router.get('/proposed-dates', handle(async (req, res) => {
  const rows = await withUser(req.profile.id, c => c.query(
    `select ta.*,
            (select json_build_object('id', p.id, 'name', p.name, 'title', p.title, 'color', p.color)
               from profiles p where p.id = ta.stakeholder_id) as stakeholder,
            (select json_build_object('id', t.id, 'title', t.title, 'priority', t.priority,
                                      'expected_date', t.expected_date, 'archived', t.archived)
               from tasks t where t.id = ta.task_id) as task
       from task_assignments ta
      where ta.promised_state = 'proposed'
      order by ta.updated_at asc`
  ));
  // Archived tasks are off every board, so they should not sit in a queue
  // either. Filtered here rather than in SQL because the embedded `task` is
  // itself RLS-scoped and may be null.
  res.json(rows.rows.filter(r => r.task && !r.task.archived));
}));

// ── Mutations ────────────────────────────────────────────────────────────────

// Forward-only for stakeholders (todo → in_progress → under_review → done, and
// reopened → in_progress); any-to-any for executives. Enforced by _is_forward()
// inside the RPC, which raises INVALID_TRANSITION.
router.post('/assignments/:id/status', handle(async (req, res) => {
  const { rows } = await withUser(req.profile.id, c => c.query(
    'select row_to_json(advance_status($1,$2)) as a', [req.params.id, req.body.status]
  ));
  res.json(rows[0].a);
}));

router.post('/assignments/:id/promise', handle(async (req, res) => {
  const { rows } = await withUser(req.profile.id, c => c.query(
    'select row_to_json(propose_promised_date($1,$2)) as a', [req.params.id, req.body.date]
  ));
  res.json(rows[0].a);
}));

router.post('/assignments/:id/promise/confirm', handle(async (req, res) => {
  const { rows } = await withUser(req.profile.id, c => c.query(
    'select row_to_json(confirm_promised_date($1)) as a', [req.params.id]
  ));
  res.json(rows[0].a);
}));

// CR-02 #4. The reason is mandatory in SQL (REASON_REQUIRED), not merely a
// required form input — and it is written into the stakeholder's comment
// thread, so a rejection always arrives with its explanation attached.
router.post('/assignments/:id/promise/reject', handle(async (req, res) => {
  const { rows } = await withUser(req.profile.id, c => c.query(
    'select row_to_json(reject_promised_date($1,$2)) as a', [req.params.id, req.body.reason]
  ));
  res.json(rows[0].a);
}));

router.post('/assignments/:id/reopen', handle(async (req, res) => {
  const { rows } = await withUser(req.profile.id, c => c.query(
    'select row_to_json(reopen_assignment($1)) as a', [req.params.id]
  ));
  res.json(rows[0].a);
}));

router.post('/assignments/:id/comments', handle(async (req, res) => {
  const { rows } = await withUser(req.profile.id, c => c.query(
    'select row_to_json(add_comment($1,$2)) as c', [req.params.id, req.body.body]
  ));
  res.status(201).json(rows[0].c);
}));

router.delete('/assignments/:id', handle(async (req, res) => {
  await withUser(req.profile.id, c => c.query('select remove_stakeholder($1)', [req.params.id]));
  res.json({ ok: true });
}));

export default router;
