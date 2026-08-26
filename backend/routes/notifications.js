// routes/notifications.js — CR-02 #5. Promised-date workflow events only.
//
// Deliberately narrow: three kinds, no comments, no edits, no column moves.
// The table is generic but the writers are few, which is what stops this
// growing into a firehose nobody reads.
//
// notif_select is `using (recipient_id = auth.uid())`, so this endpoint cannot
// return somebody else's notifications even by accident — there is no
// `where recipient_id = ...` below because there does not need to be.

import { Router } from 'express';
import { withUser } from '../db.js';
import { handle } from '../errors.js';

const router = Router();

router.get('/notifications', handle(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '30', 10) || 30, 100);
  const rows = await withUser(req.profile.id, c => c.query(
    `select n.*,
            (select json_build_object('id', p.id, 'name', p.name)
               from profiles p where p.id = n.actor_id) as actor,
            (select json_build_object('id', t.id, 'title', t.title)
               from tasks t where t.id = n.task_id) as task
       from notifications n
      order by n.created_at desc
      limit $1`,
    [limit]
  ));
  res.json(rows.rows);
}));

// ids omitted (or null) marks everything read — the "mark all" affordance.
router.post('/notifications/read', handle(async (req, res) => {
  await withUser(req.profile.id, c => c.query(
    'select mark_notifications_read($1)', [req.body?.ids ?? null]
  ));
  res.json({ ok: true });
}));

export default router;
