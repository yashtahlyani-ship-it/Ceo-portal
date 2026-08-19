-- ════════════════════════════════════════════════════════════════════════════
--  CEO OFFICE TASK PLATFORM · 04_storage.sql
--  Private attachment storage.
--
--  The bucket is PRIVATE (public = false), so there is no anonymous URL for any
--  object. The only way to read bytes is a signed URL minted for a caller who
--  passed the SELECT policy below — which reuses can_see_task(), the exact same
--  predicate that governs the task itself. A stakeholder therefore cannot read
--  an attachment on a task they hold no assignment on, even with the object path.
--
--  Object naming convention (enforced by the app, relied on here):
--      task/<task_id>/<uuid>-<filename>
--  so the owning task id is always the second path segment.
-- ════════════════════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'task-attachments', 'task-attachments', false,
  10485760,  -- 10 MB per file
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', -- docx
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',        -- xlsx
    'application/msword',
    'application/vnd.ms-excel',
    'image/png',
    'image/jpeg'
  ]
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Pull the task id out of 'task/<id>/<file>'. Returns null for any other shape,
-- which makes the policies below fail closed on a malformed path.
create or replace function storage_task_id(p_name text)
returns bigint
language sql immutable as $$
  select case
    when p_name ~ '^task/[0-9]+/' then split_part(p_name, '/', 2)::bigint
    else null
  end
$$;

-- ── Read: anyone who may see the owning task ────────────────────────────────
drop policy if exists att_read on storage.objects;
create policy att_read on storage.objects for select to authenticated
  using (
    bucket_id = 'task-attachments'
    and storage_task_id(name) is not null
    and can_see_task(storage_task_id(name))
  );

-- ── Write / delete: executives only, matching task_attachments' own policies ──
drop policy if exists att_write on storage.objects;
create policy att_write on storage.objects for insert to authenticated
  with check (
    bucket_id = 'task-attachments'
    and storage_task_id(name) is not null
    and is_executive()
  );

drop policy if exists att_delete on storage.objects;
create policy att_delete on storage.objects for delete to authenticated
  using ( bucket_id = 'task-attachments' and is_executive() );

-- No UPDATE policy: an uploaded object is never rewritten in place.

grant execute on function storage_task_id(text) to authenticated;
