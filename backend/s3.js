// s3.js — task attachment storage (replaces the Supabase Storage
// `task-attachments` bucket, sql/04_storage.sql in the pre-migration tree).
//
// The old code shape was:
//   supabase.storage.from('task-attachments').upload(path, file)
//   supabase.storage.from('task-attachments').createSignedUrl(path, 60)
//   supabase.storage.from('task-attachments').remove(paths)
// which becomes PutObject, a presigned GetObject, and DeleteObjects — same
// operations, same private-bucket model, same 60-second URL lifetime.
//
// ── The part that did NOT survive the move, and what replaced it ─────────────
//
// Supabase enforced read access on the bucket with a storage RLS policy:
//
//     create policy att_read on storage.objects for select to authenticated
//       using ( can_see_task(storage_task_id(name)) )
//
// i.e. the object path `task/<id>/<file>` was parsed back into a task id and
// checked against the same can_see_task() every other policy used. S3 has no
// equivalent — a presigned URL is valid for whoever holds it, and the bucket
// cannot consult Postgres.
//
// So the check moved into the one place that mints URLs: routes/attachments.js
// re-reads the attachment row through `withUser` FIRST, and only presigns if
// RLS returned it. Same predicate, same function, enforced one layer up. The
// bucket must therefore be private with public access fully blocked — if it
// were readable, that check would be decorative.
//
// This is the single place in the migration where a guarantee moved out of the
// database, so it is the single place to be careful when adding a new route
// that hands back a URL.

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const BUCKET = process.env.ATTACHMENTS_BUCKET;
const s3 = new S3Client({ region: process.env.AWS_REGION || 'ap-south-1' });

// Mirrors the limit the Supabase bucket enforced via file_size_limit, and the
// value the frontend checks before starting an upload.
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

function requireBucket() {
  if (!BUCKET) throw new Error('ATTACHMENTS_BUCKET env var is not set');
  return BUCKET;
}

/**
 * Build the object key for a task attachment.
 *
 * The `task/<id>/` prefix is kept from the Supabase layout even though no
 * policy parses it any more. It is worth keeping: it makes the bucket
 * browsable by task, and it means the orphan-cleanup path after a task delete
 * can be reasoned about (and, if ever needed, done with a prefix listing).
 */
export function attachmentKey(taskId, fileName) {
  const safe = String(fileName).replace(/[^\w.-]+/g, '_');
  return `task/${taskId}/${crypto.randomUUID()}-${safe}`;
}

export async function uploadAttachment(key, buffer, contentType) {
  await s3.send(new PutObjectCommand({
    Bucket:      requireBucket(),
    Key:         key,
    Body:        buffer,
    ContentType: contentType || 'application/octet-stream',
  }));
  return key;
}

/**
 * A short-lived presigned GET URL.
 *
 * 60 seconds, matching what the Supabase implementation used. It is short
 * because the URL is a bearer credential: anyone holding it can read the object
 * until it expires, with no further authorization. Long enough to open a file,
 * short enough that a URL copied out of devtools or a shared screenshot is dead
 * before it is useful.
 */
export async function attachmentSignedUrl(key, expiresInSeconds = 60) {
  const command = new GetObjectCommand({ Bucket: requireBucket(), Key: key });
  return getSignedUrl(s3, command, { expiresIn: expiresInSeconds });
}

/**
 * Best-effort removal. Deliberately does not throw.
 *
 * Every caller reaches here AFTER the database row is already gone, so the
 * authoritative action has succeeded and cannot be undone by a storage
 * failure. A leftover object is unreachable anyway — no attachment row means
 * no route will ever presign it. Failing the request at this point would
 * report a successful delete as an error and invite someone to retry an
 * operation that already happened.
 */
export async function removeObjects(keys) {
  if (!keys?.length) return;
  try {
    // DeleteObjects caps at 1000 keys per call.
    for (let i = 0; i < keys.length; i += 1000) {
      await s3.send(new DeleteObjectsCommand({
        Bucket: requireBucket(),
        Delete: { Objects: keys.slice(i, i + 1000).map(Key => ({ Key })), Quiet: true },
      }));
    }
  } catch (err) {
    console.warn('[s3] could not remove orphaned attachments:', err.message);
  }
}
