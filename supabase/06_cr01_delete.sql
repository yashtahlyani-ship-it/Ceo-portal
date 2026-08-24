-- ════════════════════════════════════════════════════════════════════════════
--  CEO OFFICE TASK PLATFORM · 06_cr01_delete.sql
--  CR-01 #6 — permanent delete, as the change request literally asks for.
--
--  This reverses a standing invariant. Until now nothing in this system could
--  be destroyed: `tasks` had no DELETE policy for anyone, including the CEO,
--  and "delete" meant archive everywhere. That was a deliberate choice about
--  auditability, and it has been overridden on instruction.
--
--  What is preserved, and how:
--
--   • The audit trail SURVIVES a delete. audit_log.task_id is ON DELETE SET
--     NULL, so its rows outlive the task — but they would be left anchored to
--     nothing. So both functions below write a `task_deleted` event FIRST,
--     recording the title and the actor, which means the history still reads
--     "X deleted 'Prepare Q4 Growth Strategy'" after the row is gone.
--
--   • Assignments, comments and attachment METADATA cascade away with the task.
--     That is the point of a hard delete, and it is irreversible.
--
--   • Attachment BYTES live in storage, which SQL cannot reach. Each function
--     returns the storage paths it orphaned so the caller can remove the
--     objects; lib/api.js does exactly that. If that cleanup fails the objects
--     are unreachable anyway — no task row means no policy grants access.
--
--  Archive still exists and is still the default action in the UI. Delete is
--  the deliberate, confirmed, irreversible one.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Shared: record the deletion, then destroy the row ───────────────────────
-- Returns the storage paths that are now orphaned.
create or replace function _delete_task_recording_audit(p_task_id bigint)
returns text[]
language plpgsql security definer set search_path = public as $$
declare t tasks; paths text[];
begin
  select * into t from tasks where id = p_task_id;
  if not found then raise exception 'Task not found'; end if;

  select coalesce(array_agg(storage_path), '{}')
    into paths from task_attachments where task_id = p_task_id;

  -- Written while the task still exists, so the FK holds. The row survives the
  -- delete with task_id set to null, carrying the title so it stays readable.
  perform _audit(p_task_id, null, 'task_deleted', 'title', t.title, null);

  delete from tasks where id = p_task_id;
  return paths;
end $$;

-- ── Executive: delete any task ──────────────────────────────────────────────
create or replace function delete_task(p_task_id bigint)
returns text[]
language plpgsql security definer set search_path = public as $$
begin
  if not is_executive() then
    raise exception 'FORBIDDEN: executive only' using errcode = 'insufficient_privilege';
  end if;
  return _delete_task_recording_audit(p_task_id);
end $$;

-- ── Creator: delete a task they raised themselves ───────────────────────────
-- Same scoping as update_self_task: the caller must BE the creator AND the task
-- must be self-created, so this can never reach work assigned to them.
create or replace function delete_self_task(p_task_id bigint)
returns text[]
language plpgsql security definer set search_path = public as $$
declare t tasks;
begin
  select * into t from tasks where id = p_task_id;
  if not found then raise exception 'Task not found'; end if;
  if t.created_by <> auth.uid() or not is_self_created(p_task_id) then
    raise exception 'FORBIDDEN: you can only delete a task you raised yourself'
      using errcode = 'insufficient_privilege';
  end if;
  return _delete_task_recording_audit(p_task_id);
end $$;

grant execute on function
  delete_task(bigint),
  delete_self_task(bigint)
to authenticated;

-- NOTE: no DELETE *policy* is added to `tasks`. Deletion happens only through
-- these two SECURITY DEFINER functions, each of which checks its own rule. A
-- direct `delete from tasks` over the REST API is still refused for everyone,
-- so the blast radius stays exactly these two entry points.
