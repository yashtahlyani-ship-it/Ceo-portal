-- ════════════════════════════════════════════════════════════════════════════
--  CEO OFFICE TASK PLATFORM · 05_cr01.sql
--  Change Request CR-01 (24 Aug 2026) — post-launch enhancements.
--
--  Only CR-6 needs server work; the rest (optional summary, assignee search,
--  created-date filter, stakeholder view) are presentation changes.
--
--  CR-6 introduces a SECOND path for task creation. Until now `create_task`
--  was executive-only and that was the whole story. A stakeholder may now
--  raise a task, but only ever for themselves — so rather than loosening
--  `create_task`'s guard (which would also let a stakeholder assign work to
--  other people), this adds a separate, deliberately narrower RPC.
--
--  Row-level security is UNCHANGED. Every function here is SECURITY DEFINER
--  and checks its own rule, so the direct-table policies stay deny-by-default
--  exactly as they were.
-- ════════════════════════════════════════════════════════════════════════════

-- Created-date range filtering replaces expected-date filtering across the
-- tool (CR-3, CR-4), so created_at now carries a filter index.
create index if not exists tasks_created_at_idx on tasks (created_at);

-- ── Is this task one a stakeholder raised for themselves? ────────────────────
-- Derived, not stored: a task is self-created when its creator is a
-- stakeholder. There is no separate flag to drift out of step with reality.
create or replace function is_self_created(p_task_id bigint)
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select p.role = 'stakeholder'
    from tasks t join profiles p on p.id = t.created_by
    where t.id = p_task_id
  ), false)
$$;

-- ── CR-6: a stakeholder raises a task for themselves ────────────────────────
-- Note what this function CANNOT do: there is no stakeholder-list parameter,
-- so a self-created task can never land on anyone else's board. The single
-- assignment is always auth.uid().
--
-- The date the creator sets is final: it goes straight into expected_date and
-- the assignment's promised_date is left alone, because there is nobody to
-- propose to. See confirm_promised_date below, which now refuses these.
create or replace function create_self_task(
  p_title text, p_description text, p_priority task_priority, p_expected_date date)
returns bigint
language plpgsql security definer set search_path = public as $$
declare new_id bigint; r user_role;
begin
  r := app_role();
  if r is null then raise exception 'No profile for current user'; end if;
  if r <> 'stakeholder' then
    raise exception 'FORBIDDEN: executives create tasks with create_task()'
      using errcode = 'insufficient_privilege';
  end if;
  if length(btrim(coalesce(p_title,''))) = 0 then raise exception 'Title is required'; end if;

  -- Summary is optional as of CR-1; coalesce keeps the column non-null.
  insert into tasks (title, description, priority, expected_date, created_by)
  values (btrim(p_title), coalesce(p_description,''), coalesce(p_priority,'medium'),
          p_expected_date, auth.uid())
  returning id into new_id;

  insert into task_assignments (task_id, stakeholder_id) values (new_id, auth.uid());
  return new_id;
end $$;

-- ── CR-6: the creator may edit their own self-created task ──────────────────
-- Scoped hard: the caller must be the creator AND the task must be
-- self-created. A stakeholder therefore still cannot touch a task the EA or
-- CEO assigned to them, which is the rule CR-6 explicitly preserves.
create or replace function update_self_task(
  p_task_id bigint, p_title text, p_description text,
  p_priority task_priority, p_expected_date date)
returns tasks
language plpgsql security definer set search_path = public as $$
declare t tasks;
begin
  select * into t from tasks where id = p_task_id;
  if not found then raise exception 'Task not found'; end if;
  if t.created_by <> auth.uid() or not is_self_created(p_task_id) then
    raise exception 'FORBIDDEN: you can only edit a task you raised yourself'
      using errcode = 'insufficient_privilege';
  end if;
  if length(btrim(coalesce(p_title,''))) = 0 then raise exception 'Title is required'; end if;

  update tasks
     set title = btrim(p_title),
         description = coalesce(p_description,''),
         priority = coalesce(p_priority,'medium'),
         expected_date = p_expected_date
   where id = p_task_id
  returning * into t;
  return t;
end $$;

-- ── CR-6: the creator may withdraw their own self-created task ──────────────
-- Withdrawing ARCHIVES: reversible, and the default action offered in the UI.
-- Permanent deletion also exists as of 06_cr01_delete.sql (delete_self_task);
-- this is the softer of the two, kept because most "I raised this by mistake"
-- cases want a restore path rather than destruction.
create or replace function archive_self_task(p_task_id bigint)
returns void
language plpgsql security definer set search_path = public as $$
declare t tasks;
begin
  select * into t from tasks where id = p_task_id;
  if not found then raise exception 'Task not found'; end if;
  if t.created_by <> auth.uid() or not is_self_created(p_task_id) then
    raise exception 'FORBIDDEN: you can only withdraw a task you raised yourself'
      using errcode = 'insufficient_privilege';
  end if;
  update tasks set archived = true, archived_at = now(), archived_by = auth.uid()
   where id = p_task_id;
end $$;

-- ── The promised-date flow does not apply to self-created tasks ─────────────
-- On an EA-assigned task the stakeholder proposes and an executive confirms.
-- A self-created task has no such handshake — the creator's date is final —
-- so both ends of that flow now refuse these tasks rather than silently
-- producing a meaningless "awaiting confirmation" state.
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
  if is_self_created(a.task_id) then
    raise exception 'SELF_CREATED: you set the date on a task you raised yourself — edit the task instead'
      using errcode = 'check_violation';
  end if;
  update task_assignments
     set promised_proposed = p_date, promised_state = 'proposed'
   where id = p_assignment_id returning * into a;
  return a;
end $$;

create or replace function confirm_promised_date(p_assignment_id bigint)
returns task_assignments
language plpgsql security definer set search_path = public as $$
declare a task_assignments;
begin
  if not is_executive() then raise exception 'FORBIDDEN: executive only' using errcode = 'insufficient_privilege'; end if;
  select * into a from task_assignments where id = p_assignment_id;
  if not found then raise exception 'Assignment not found'; end if;
  if is_self_created(a.task_id) then
    raise exception 'SELF_CREATED: this date was set by the person who raised the task'
      using errcode = 'check_violation';
  end if;
  if a.promised_proposed is null then raise exception 'No proposed date to confirm'; end if;
  update task_assignments
     set promised_date = a.promised_proposed,
         promised_state = 'confirmed',
         promised_confirmed_by = auth.uid(),
         promised_confirmed_at = now()
   where id = p_assignment_id returning * into a;
  return a;
end $$;

-- ── Grants ──────────────────────────────────────────────────────────────────
grant execute on function
  create_self_task(text, text, task_priority, date),
  update_self_task(bigint, text, text, task_priority, date),
  archive_self_task(bigint),
  is_self_created(bigint)
to authenticated;
