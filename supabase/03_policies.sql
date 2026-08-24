-- ════════════════════════════════════════════════════════════════════════════
--  CEO OFFICE TASK PLATFORM · 03_policies.sql
--  Row-Level Security. This is the real authorization boundary. The frontend
--  hides what a role cannot do; THESE POLICIES are what actually stop a hand-
--  crafted request. Stakeholder mutations happen only through the SECURITY
--  DEFINER RPCs in 02_functions.sql (which bypass RLS after checking the rule),
--  so the direct-table policies below can stay deny-by-default and tight.
-- ════════════════════════════════════════════════════════════════════════════

alter table profiles          enable row level security;
alter table tasks             enable row level security;
alter table task_assignments  enable row level security;
alter table task_comments     enable row level security;
alter table task_attachments  enable row level security;
alter table audit_log         enable row level security;
alter table saved_views       enable row level security;

-- ── profiles ─────────────────────────────────────────────────────────────────
-- A stakeholder sees themselves and the executives (needed to render comment
-- authors), never other stakeholders. Executives see the whole directory.
drop policy if exists profiles_select on profiles;
create policy profiles_select on profiles for select to authenticated
  using ( is_executive() or id = auth.uid() or role in ('ea','ceo') );

drop policy if exists profiles_write on profiles;
create policy profiles_write on profiles for update to authenticated
  using ( is_executive() ) with check ( is_executive() );

drop policy if exists profiles_insert on profiles;
create policy profiles_insert on profiles for insert to authenticated
  with check ( is_executive() );

-- ── tasks ────────────────────────────────────────────────────────────────────
drop policy if exists tasks_select on tasks;
create policy tasks_select on tasks for select to authenticated
  using ( can_see_task(id) );

drop policy if exists tasks_insert on tasks;
create policy tasks_insert on tasks for insert to authenticated
  with check ( is_executive() );

drop policy if exists tasks_update on tasks;
create policy tasks_update on tasks for update to authenticated
  using ( is_executive() ) with check ( is_executive() );
-- No DELETE policy anywhere, so a direct `delete from tasks` is refused for
-- every authenticated caller including the CEO. CR-01 later added permanent
-- deletion, but ONLY through the SECURITY DEFINER RPCs in 06_cr01_delete.sql,
-- which check their own rule and record a task_deleted audit event first.
-- Do not add a DELETE policy here: it would widen the entry points.

-- ── task_assignments — the isolation core ────────────────────────────────────
-- A stakeholder can read ONLY their own assignment rows. They therefore cannot
-- see another assignee's status or promised date at all. Writes are executive-
-- only here; stakeholder status/promise changes flow through the RPCs.
drop policy if exists ta_select on task_assignments;
create policy ta_select on task_assignments for select to authenticated
  using ( is_executive() or stakeholder_id = auth.uid() );

drop policy if exists ta_insert on task_assignments;
create policy ta_insert on task_assignments for insert to authenticated
  with check ( is_executive() );

drop policy if exists ta_update on task_assignments;
create policy ta_update on task_assignments for update to authenticated
  using ( is_executive() ) with check ( is_executive() );

drop policy if exists ta_delete on task_assignments;
create policy ta_delete on task_assignments for delete to authenticated
  using ( is_executive() );

-- ── task_comments — isolated by assignment, immutable ────────────────────────
-- Read: executive sees all; stakeholder sees only their own assignment's thread.
-- No INSERT/UPDATE/DELETE policies: comments are written only via add_comment()
-- and can never be edited or removed by anyone.
drop policy if exists tc_select on task_comments;
create policy tc_select on task_comments for select to authenticated
  using (
    is_executive()
    or exists (
      select 1 from task_assignments a
      where a.id = task_comments.assignment_id and a.stakeholder_id = auth.uid()
    )
  );

-- ── task_attachments — visible to anyone who can see the task; exec writes ────
drop policy if exists at_select on task_attachments;
create policy at_select on task_attachments for select to authenticated
  using ( can_see_task(task_id) );

drop policy if exists at_insert on task_attachments;
create policy at_insert on task_attachments for insert to authenticated
  with check ( is_executive() );

drop policy if exists at_delete on task_attachments;
create policy at_delete on task_attachments for delete to authenticated
  using ( is_executive() );

-- ── audit_log — executive read only, never mutable ───────────────────────────
-- Read: executives only. No INSERT/UPDATE/DELETE policies exist, so rows can be
-- written ONLY by the SECURITY DEFINER _audit() function and never altered.
drop policy if exists audit_select on audit_log;
create policy audit_select on audit_log for select to authenticated
  using ( is_executive() );

-- ── saved_views — an executive's own views ───────────────────────────────────
drop policy if exists sv_select on saved_views;
create policy sv_select on saved_views for select to authenticated
  using ( is_executive() and owner_id = auth.uid() );

drop policy if exists sv_insert on saved_views;
create policy sv_insert on saved_views for insert to authenticated
  with check ( is_executive() and owner_id = auth.uid() );

drop policy if exists sv_update on saved_views;
create policy sv_update on saved_views for update to authenticated
  using ( is_executive() and owner_id = auth.uid() )
  with check ( is_executive() and owner_id = auth.uid() );

drop policy if exists sv_delete on saved_views;
create policy sv_delete on saved_views for delete to authenticated
  using ( is_executive() and owner_id = auth.uid() );

-- ── Grants: expose the RPCs to logged-in users (the rule lives inside each) ──
grant execute on function
  advance_status(bigint, assignment_status),
  propose_promised_date(bigint, date),
  confirm_promised_date(bigint),
  reopen_assignment(bigint),
  add_comment(bigint, text),
  create_task(text, text, task_priority, date, date, uuid[]),
  add_stakeholder(bigint, uuid),
  remove_stakeholder(bigint),
  archive_task(bigint),
  restore_task(bigint),
  app_role(), is_executive(), owns_assignment(bigint), can_see_task(bigint)
to authenticated;
