// routes/profiles.js — the people directory.
//
// Reads go through RLS. profiles_select is:
//     using ( is_executive() or id = auth.uid() or role in ('ea','ceo') )
// so a stakeholder sees themselves and the executives — the latter because
// comment threads and audit entries have to render an author name — and never
// another stakeholder. `select * from profiles` therefore returns a different
// directory depending on who asks, which is the intended behaviour.

import { Router } from 'express';
import { withUser } from '../db.js';
import { handle } from '../errors.js';

const router = Router();

// The signed-in person. Served from req.profile, which identity.js already
// resolved from the verified token — no query needed, and no way for a caller
// to ask for somebody else's.
router.get('/me', handle(async (req, res) => {
  res.json(req.profile);
}));

router.get('/profiles', handle(async (req, res) => {
  const rows = await withUser(req.profile.id, c => c.query(
    'select * from profiles order by name'
  ));
  res.json(rows.rows);
}));

router.get('/stakeholders', handle(async (req, res) => {
  const rows = await withUser(req.profile.id, c => c.query(
    "select * from profiles where role = 'stakeholder' and active = true order by name"
  ));
  res.json(rows.rows);
}));

// Activate / deactivate someone. Executive-only, enforced by the profiles_write
// policy (`using (is_executive())`) rather than by a check here — a non-executive
// gets zero rows back and the 403 below.
//
// Only `active` is writable. Role is deliberately not editable through the API:
// promoting someone to 'ea' or 'ceo' hands them the whole board plus executive
// override, which is a decision to make deliberately against the database, not
// something to expose on a directory screen next to a toggle.
router.patch('/profiles/:id', handle(async (req, res) => {
  if (typeof req.body?.active !== 'boolean') {
    return res.status(400).json({ error: 'Only `active` can be changed here.' });
  }
  const { rows } = await withUser(req.profile.id, c => c.query(
    'update profiles set active = $2 where id = $1 returning *',
    [req.params.id, req.body.active]
  ));
  if (!rows[0]) return res.status(403).json({ error: 'FORBIDDEN: you cannot change this profile' });
  res.json(rows[0]);
}));

export default router;
