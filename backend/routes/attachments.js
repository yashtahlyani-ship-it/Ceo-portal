// routes/attachments.js — private file attachments on a task.
//
// ⚠ READ s3.js's header before changing anything here.
//
// This is the ONE place in the migration where an access rule moved out of
// Postgres. On Supabase, the storage bucket had its own RLS policy that parsed
// the object path back to a task id and ran `can_see_task()` on it, so the
// bytes were protected by exactly the same predicate as the metadata. S3 cannot
// consult Postgres, and a presigned URL is a bearer credential.
//
// The replacement: every route below re-reads the attachment row through
// `withUser` FIRST and acts only on what RLS returned. `at_select` is
// `using (can_see_task(task_id))` — the same function, one layer up. If you add
// a route that hands back a URL, it must do this too; skipping the read and
// presigning a path from the request body would make the bucket world-readable
// to anyone who can guess a task id.

import { Router } from 'express';
import multer from 'multer';
import { withUser } from '../db.js';
import { handle, HttpError } from '../errors.js';
import {
  attachmentKey, uploadAttachment, attachmentSignedUrl, removeObjects,
  MAX_ATTACHMENT_BYTES,
} from '../s3.js';

const router = Router();

// In-memory: files are capped at 10 MB and go straight to S3, so there is no
// reason to touch the container's disk (and on Fargate, no disk worth using).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ATTACHMENT_BYTES },
});

router.get('/tasks/:id/attachments', handle(async (req, res) => {
  const rows = await withUser(req.profile.id, c => c.query(
    `select a.*,
            (select json_build_object('id', p.id, 'name', p.name)
               from profiles p where p.id = a.uploaded_by) as uploader
       from task_attachments a
      where a.task_id = $1
      order by a.created_at`,
    [req.params.id]
  ));
  res.json(rows.rows);
}));

// Upload the bytes, then record the metadata row.
//
// Order matters and this order is deliberate: if the metadata insert fails
// (RLS refuses a non-executive, the task is gone), the orphaned object is
// removed so the bucket cannot drift from the table. The reverse order would
// leave a metadata row pointing at bytes that were never stored — a broken
// download link, which is worse than a missing one because it looks fine until
// somebody clicks it.
router.post('/tasks/:id/attachments', upload.single('file'), handle(async (req, res) => {
  if (!req.file) throw new HttpError(400, 'No file supplied');
  const taskId = req.params.id;

  const key = attachmentKey(taskId, req.file.originalname);
  await uploadAttachment(key, req.file.buffer, req.file.mimetype);

  try {
    const { rows } = await withUser(req.profile.id, c => c.query(
      `insert into task_attachments (task_id, storage_path, file_name, mime_type, size_bytes, uploaded_by)
       values ($1,$2,$3,$4,$5,$6)
       returning *`,
      [taskId, key, req.file.originalname, req.file.mimetype || null, req.file.size, req.profile.id]
    ));
    if (!rows[0]) throw new HttpError(403, 'FORBIDDEN: you cannot attach files to this task');

    res.status(201).json({
      ...rows[0],
      uploader: { id: req.profile.id, name: req.profile.name },
    });
  } catch (err) {
    await removeObjects([key]);
    throw err;
  }
}));

// Mint a short-lived URL for one attachment.
//
// The row is fetched by id through withUser — NOT by a path supplied by the
// caller. That is the whole check: if RLS did not return the row, the caller
// cannot see the task, and no URL is minted.
router.get('/attachments/:id/url', handle(async (req, res) => {
  const { rows } = await withUser(req.profile.id, c => c.query(
    'select storage_path from task_attachments where id = $1', [req.params.id]
  ));
  if (!rows[0]) throw new HttpError(404, 'Attachment not found');
  res.json({ url: await attachmentSignedUrl(rows[0].storage_path) });
}));

router.delete('/attachments/:id', handle(async (req, res) => {
  // `returning` gives us the key only if the DELETE policy allowed the row to
  // go — so an unauthorized caller cannot use this endpoint to erase bytes.
  const { rows } = await withUser(req.profile.id, c => c.query(
    'delete from task_attachments where id = $1 returning storage_path', [req.params.id]
  ));
  if (!rows[0]) throw new HttpError(403, 'FORBIDDEN: you cannot delete this attachment');
  await removeObjects([rows[0].storage_path]);
  res.json({ ok: true });
}));

export default router;
