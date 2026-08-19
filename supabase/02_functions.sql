-- ════════════════════════════════════════════════════════════════════════════
--  CEO OFFICE TASK PLATFORM · 02_functions.sql
--  Centralized business logic. NOTHING here is duplicated in the client as an
--  authority — the app mirrors these rules for UX only; the server is the judge.
--
--  Two layers:
--   1. Helpers used by RLS (is_executive, owns_assignment, can_see_task).
--   2. RPCs (SECURITY DEFINER) that perform every controlled mutation a
--      stakeholder is allowed to make, with the rule checked inside. Direct
--      UPDATEs on assignments are reserved for executives via RLS.
--   3. Triggers that write the append-only audit log on every path.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Identity helpers (SECURITY DEFINER so they can read profiles under RLS) ──
create or replace function app_role()
returns user_role
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid()
$$;

create or replace function is_executive()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('ea','ceo') from profiles where id = auth.uid()), false)
$$;

create or replace function owns_assignment(p_assignment_id bigint)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from task_assignments
    where id = p_assignment_id and stakeholder_id = auth.uid()
  )
$$;

-- Can the current user see this task at all? Executive: yes. Stakeholder: only
-- if they hold an assignment on it. Used by RLS on tasks/attachments.
create or replace function can_see_task(p_task_id bigint)
returns boolean
language sql stable security definer set search_path = public as $$
  select is_executive()
      or exists (
        select 1 from task_assignments
        where task_id = p_task_id and stakeholder_id = auth.uid()
      )
$$;

-- ── updated_at touch ─────────────────────────────────────────────────────────
create or replace function touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

drop trigger if exists trg_touch_tasks on tasks;
create trigger trg_touch_tasks before update on tasks
  for each row execute function touch_updated_at();
drop trigger if exists trg_touch_assign on task_assignments;
create trigger trg_touch_assign before update on task_assignments
  for each row execute function touch_updated_at();
drop trigger if exists trg_touch_profiles on profiles;
create trigger trg_touch_profiles before update on profiles
  for each row execute function touch_updated_at();
drop trigger if exists trg_touch_views on saved_views;
create trigger trg_touch_views before update on saved_views
  for each row execute function touch_updated_at();

-- ── New auth user → profile safety net ───────────────────────────────────────
-- Accounts are created by the admin script with role/name in user metadata.
-- This trigger guarantees a profile row exists even if that metadata is absent.
create or replace function handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, email, name, role, title)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email,'@',1)),
    coalesce((new.raw_user_meta_data->>'role')::user_role, 'stakeholder'),
    new.raw_user_meta_data->>'title'
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists trg_new_auth_user on auth.users;
create trigger trg_new_auth_user after insert on auth.users
  for each row execute function handle_new_auth_user();

-- ════════════════════════════════════════════════════════════════════════════
--  AUDIT TRIGGERS — append-only, capture every path
-- ════════════════════════════════════════════════════════════════════════════
create or replace function _audit(
  p_task bigint, p_assignment bigint, p_action text,
  p_field text, p_old text, p_new text)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into audit_log (task_id, assignment_id, actor_id, actor_role, action, field, old_value, new_value)
  values (p_task, p_assignment, auth.uid(), app_role(), p_action, p_field, p_old, p_new);
end $$;

-- tasks
create or replace function fn_tasks_audit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform _audit(new.id, null, 'task_created', 'title', null, new.title);
    return new;
  end if;
  -- UPDATE: one audit row per meaningful field change
  if new.title            is distinct from old.title            then perform _audit(new.id,null,'field_edited','title',old.title,new.title); end if;
  if new.description       is distinct from old.description       then perform _audit(new.id,null,'field_edited','description','(changed)','(changed)'); end if;
  if new.priority          is distinct from old.priority          then perform _audit(new.id,null,'field_edited','priority',old.priority::text,new.priority::text); end if;
  if new.expected_date     is distinct from old.expected_date     then perform _audit(new.id,null,'field_edited','expected_date',old.expected_date::text,new.expected_date::text); end if;
  if new.next_followup_date is distinct from old.next_followup_date then perform _audit(new.id,null,'field_edited','next_followup_date',old.next_followup_date::text,new.next_followup_date::text); end if;
  if new.archived = true  and old.archived = false then perform _audit(new.id,null,'task_archived',null,null,null); end if;
  if new.archived = false and old.archived = true  then perform _audit(new.id,null,'task_restored',null,null,null); end if;
  return new;
end $$;

drop trigger if exists trg_tasks_audit on tasks;
create trigger trg_tasks_audit after insert or update on tasks
  for each row execute function fn_tasks_audit();

-- assignments
create or replace function fn_assign_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare who text;
begin
  if tg_op = 'INSERT' then
    select name into who from profiles where id = new.stakeholder_id;
    perform _audit(new.task_id, new.id, 'stakeholder_added', null, null, who);
    return new;
  elsif tg_op = 'DELETE' then
    -- Only audit a stakeholder being removed from a task that still exists.
    -- When the parent task row is itself being deleted the cascade fires this
    -- trigger too, and audit_log.task_id would point at a row that is already
    -- gone — a foreign-key violation that would abort the delete. Nothing is
    -- lost by skipping it: the task's whole audit trail goes with the task.
    if exists (select 1 from tasks where id = old.task_id) then
      select name into who from profiles where id = old.stakeholder_id;
      perform _audit(old.task_id, old.id, 'stakeholder_removed', null, who, null);
    end if;
    return old;
  end if;
  -- UPDATE
  if new.status is distinct from old.status then
    perform _audit(new.task_id, new.id,
      case when new.status = 'reopened' then 'task_reopened' else 'status_changed' end,
      'status', old.status::text, new.status::text);
  end if;
  if new.promised_state = 'proposed' and old.promised_state is distinct from 'proposed' then
    perform _audit(new.task_id, new.id, 'promised_proposed', 'promised_date', null, new.promised_proposed::text);
  end if;
  if new.promised_state = 'confirmed' and old.promised_state is distinct from 'confirmed' then
    perform _audit(new.task_id, new.id, 'promised_confirmed', 'promised_date', new.promised_proposed::text, new.promised_date::text);
  end if;
  return new;
end $$;

drop trigger if exists trg_assign_audit on task_assignments;
create trigger trg_assign_audit after insert or update or delete on task_assignments
  for each row execute function fn_assign_audit();

-- comments & attachments
create or replace function fn_comment_audit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform _audit(new.task_id, new.assignment_id, 'comment_added', null, null, null);
  return new;
end $$;
drop trigger if exists trg_comment_audit on task_comments;
create trigger trg_comment_audit after insert on task_comments
  for each row execute function fn_comment_audit();

create or replace function fn_attach_audit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform _audit(new.task_id, null, 'attachment_added', null, null, new.file_name);
  -- As with assignments: skip the audit when the parent task is itself going
  -- away, or the cascade would fail on audit_log's foreign key.
  elsif exists (select 1 from tasks where id = old.task_id) then
    perform _audit(old.task_id, null, 'attachment_removed', null, old.file_name, null);
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists trg_attach_audit on task_attachments;
create trigger trg_attach_audit after insert or delete on task_attachments
  for each row execute function fn_attach_audit();

-- ════════════════════════════════════════════════════════════════════════════
--  STATE MACHINE + CONTROLLED MUTATIONS (RPCs)
-- ════════════════════════════════════════════════════════════════════════════

-- The only legal stakeholder moves. Executives bypass this (any → any).
create or replace function _is_forward(p_from assignment_status, p_to assignment_status)
returns boolean language sql immutable as $$
  select (p_from, p_to) in (
    ('todo','in_progress'),
    ('in_progress','under_review'),
    ('under_review','done'),
    ('reopened','in_progress')
  )
$$;

-- Advance (or, for executives, override) an assignment's status.
create or replace function advance_status(p_assignment_id bigint, p_target assignment_status)
returns task_assignments
language plpgsql security definer set search_path = public as $$
declare a task_assignments; r user_role;
begin
  select * into a from task_assignments where id = p_assignment_id;
  if not found then raise exception 'Assignment not found'; end if;
  r := app_role();
  if r is null then raise exception 'No profile for current user'; end if;

  if r in ('ea','ceo') then
    null;  -- executive override: any status → any status (audited by trigger)
  elsif a.stakeholder_id = auth.uid() then
    if not _is_forward(a.status, p_target) then
      raise exception 'INVALID_TRANSITION: % cannot move directly to % — complete the workflow one step at a time', a.status, p_target
        using errcode = 'check_violation';
    end if;
  else
    raise exception 'FORBIDDEN: not your assignment' using errcode = 'insufficient_privilege';
  end if;

  update task_assignments set status = p_target where id = p_assignment_id returning * into a;
  return a;
end $$;

-- Stakeholder proposes their promised date. Blocked once confirmed (locked).
create or replace function propose_promised_date(p_assignment_id bigint, p_date date)
returns task_assignments
language plpgsql security definer set search_path = public as $$
declare a task_assignments;
begin
  select * into a from task_assignments where id = p_assignment_id;
  if not found then raise exception 'Assignment not found'; end if;
  if a.stakeholder_id <> auth.uid() then
    raise exception 'FORBIDDEN: not your assignment' using errcode = 'insufficient_privilege';
  end if;
  if a.promised_state = 'confirmed' then
    raise exception 'LOCKED: this promised date has been confirmed and locked' using errcode = 'check_violation';
  end if;
  update task_assignments
     set promised_proposed = p_date, promised_state = 'proposed'
   where id = p_assignment_id returning * into a;
  return a;
end $$;

-- Executive confirms → the date locks. Only EA/CEO.
create or replace function confirm_promised_date(p_assignment_id bigint)
returns task_assignments
language plpgsql security definer set search_path = public as $$
declare a task_assignments;
begin
  if not is_executive() then raise exception 'FORBIDDEN: executive only' using errcode = 'insufficient_privilege'; end if;
  select * into a from task_assignments where id = p_assignment_id;
  if not found then raise exception 'Assignment not found'; end if;
  if a.promised_proposed is null then raise exception 'No proposed date to confirm'; end if;
  update task_assignments
     set promised_date = a.promised_proposed,
         promised_state = 'confirmed',
         promised_confirmed_by = auth.uid(),
         promised_confirmed_at = now()
   where id = p_assignment_id returning * into a;
  return a;
end $$;

-- Executive reopens a completed assignment: done → reopened. Only EA/CEO.
create or replace function reopen_assignment(p_assignment_id bigint)
returns task_assignments
language plpgsql security definer set search_path = public as $$
declare a task_assignments;
begin
  if not is_executive() then raise exception 'FORBIDDEN: executive only' using errcode = 'insufficient_privilege'; end if;
  select * into a from task_assignments where id = p_assignment_id;
  if not found then raise exception 'Assignment not found'; end if;
  if a.status <> 'done' then raise exception 'Only a Done assignment can be reopened'; end if;
  update task_assignments set status = 'reopened' where id = p_assignment_id returning * into a;
  return a;
end $$;

-- Comment respecting isolation: executive → any assignment on the task;
-- stakeholder → only their own assignment.
create or replace function add_comment(p_assignment_id bigint, p_body text)
returns task_comments
language plpgsql security definer set search_path = public as $$
declare a task_assignments; r user_role; c task_comments;
begin
  if length(btrim(p_body)) = 0 then raise exception 'Comment cannot be empty'; end if;
  select * into a from task_assignments where id = p_assignment_id;
  if not found then raise exception 'Assignment not found'; end if;
  r := app_role();
  if r not in ('ea','ceo') and a.stakeholder_id <> auth.uid() then
    raise exception 'FORBIDDEN: not your assignment' using errcode = 'insufficient_privilege';
  end if;
  insert into task_comments (task_id, assignment_id, author_id, author_role, body)
  values (a.task_id, p_assignment_id, auth.uid(), r, btrim(p_body))
  returning * into c;
  return c;
end $$;

-- Executive creates a task and its assignments atomically.
create or replace function create_task(
  p_title text, p_description text, p_priority task_priority,
  p_expected_date date, p_followup_date date, p_stakeholders uuid[])
returns bigint
language plpgsql security definer set search_path = public as $$
declare new_id bigint; sid uuid;
begin
  if not is_executive() then raise exception 'FORBIDDEN: executive only' using errcode = 'insufficient_privilege'; end if;
  if length(btrim(p_title)) = 0 then raise exception 'Title is required'; end if;

  insert into tasks (title, description, priority, expected_date, next_followup_date, created_by)
  values (btrim(p_title), coalesce(p_description,''), coalesce(p_priority,'medium'),
          p_expected_date, p_followup_date, auth.uid())
  returning id into new_id;

  if p_stakeholders is not null then
    foreach sid in array p_stakeholders loop
      insert into task_assignments (task_id, stakeholder_id) values (new_id, sid)
      on conflict do nothing;
    end loop;
  end if;
  return new_id;
end $$;

create or replace function add_stakeholder(p_task_id bigint, p_stakeholder_id uuid)
returns task_assignments
language plpgsql security definer set search_path = public as $$
declare a task_assignments;
begin
  if not is_executive() then raise exception 'FORBIDDEN: executive only' using errcode = 'insufficient_privilege'; end if;
  insert into task_assignments (task_id, stakeholder_id) values (p_task_id, p_stakeholder_id)
  returning * into a;
  return a;
end $$;

create or replace function remove_stakeholder(p_assignment_id bigint)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_executive() then raise exception 'FORBIDDEN: executive only' using errcode = 'insufficient_privilege'; end if;
  delete from task_assignments where id = p_assignment_id;
end $$;

create or replace function archive_task(p_task_id bigint)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_executive() then raise exception 'FORBIDDEN: executive only' using errcode = 'insufficient_privilege'; end if;
  update tasks set archived = true, archived_at = now(), archived_by = auth.uid() where id = p_task_id;
end $$;

create or replace function restore_task(p_task_id bigint)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_executive() then raise exception 'FORBIDDEN: executive only' using errcode = 'insufficient_privilege'; end if;
  update tasks set archived = false, archived_at = null, archived_by = null where id = p_task_id;
end $$;
