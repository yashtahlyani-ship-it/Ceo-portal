-- ════════════════════════════════════════════════════════════════════════════
--  CEO OFFICE TASK PLATFORM · 07_cr02.sql
--  Change Request CR-02 (25 Aug 2026).
--
--  Three server-side pieces:
--    · reject_promised_date()  — the missing half of the approval workflow
--    · notifications           — scoped to the promised-date workflow ONLY
--    · saved_views removed     — CR-02 #1 retires the feature entirely
-- ════════════════════════════════════════════════════════════════════════════

-- ── CR-02 #1: Saved Views is withdrawn ──────────────────────────────────────
-- The CR removes the tab AND the underlying custom-filter-building capability.
-- The board's own filter bar (CR-01) is a different thing and stays.
-- Dropping the table takes its policies and grants with it, so nothing dead is
-- left behind for a future reader to wonder about.
drop table if exists saved_views cascade;

-- ════════════════════════════════════════════════════════════════════════════
--  NOTIFICATIONS
--  Deliberately narrow. PRD §10 put notifications out of scope and CR-02 opens
--  the door only for the three promised-date events — not comments, not edits,
--  not column moves. Keeping the table generic but the WRITERS few is what
--  stops this quietly growing into a firehose.
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists notifications (
  id            bigint generated always as identity primary key,
  recipient_id  uuid not null references profiles(id) on delete cascade,
  actor_id      uuid references profiles(id),
  task_id       bigint references tasks(id) on delete cascade,
  assignment_id bigint references task_assignments(id) on delete cascade,
  kind          text not null check (kind in (
                  'promised_proposed', 'promised_confirmed', 'promised_rejected')),
  body          text,                       -- the rejection reason, when there is one
  read_at       timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists notif_recipient_idx on notifications (recipient_id, read_at);
create index if not exists notif_created_idx   on notifications (created_at desc);

alter table notifications enable row level security;

-- You may read and dismiss only your own. There is no INSERT policy: rows are
-- written exclusively by the SECURITY DEFINER functions below, so nobody can
-- fabricate a notification for someone else.
drop policy if exists notif_select on notifications;
create policy notif_select on notifications for select to authenticated
  using ( recipient_id = auth.uid() );

drop policy if exists notif_update on notifications;
create policy notif_update on notifications for update to authenticated
  using ( recipient_id = auth.uid() ) with check ( recipient_id = auth.uid() );

-- Internal writer. Never notifies someone about their own action — an EA who
-- confirms a date does not need telling that she confirmed it.
create or replace function _notify(
  p_recipient uuid, p_task bigint, p_assignment bigint, p_kind text, p_body text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_recipient is null or p_recipient = auth.uid() then return; end if;
  insert into notifications (recipient_id, actor_id, task_id, assignment_id, kind, body)
  values (p_recipient, auth.uid(), p_task, p_assignment, p_kind, p_body);
end $$;

create or replace function mark_notifications_read(p_ids bigint[] default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  update notifications set read_at = now()
   where recipient_id = auth.uid() and read_at is null
     and (p_ids is null or id = any(p_ids));
end $$;

-- ════════════════════════════════════════════════════════════════════════════
--  PROMISED-DATE WORKFLOW
-- ════════════════════════════════════════════════════════════════════════════

-- ── Propose: unchanged rules, now also notifies every executive ─────────────
create or replace function propose_promised_date(p_assignment_id bigint, p_date date)
returns task_assignments
language plpgsql security definer set search_path = public as $$
declare a task_assignments; ex record;
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

  -- CR-02 #5: the proposal lands in the EA/CEO queue, so tell them it is there.
  for ex in select id from profiles where role in ('ea','ceo') and active loop
    perform _notify(ex.id, a.task_id, a.id, 'promised_proposed', null);
  end loop;
  return a;
end $$;

-- ── Confirm & lock: unchanged rules, now notifies the stakeholder ───────────
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

  perform _notify(a.stakeholder_id, a.task_id, a.id, 'promised_confirmed', null);
  return a;
end $$;

-- ── CR-02 #4: Reject, with a mandatory reason ───────────────────────────────
-- The reason is not an optional note. A rejection without one leaves the
-- stakeholder guessing what to propose instead, so the function refuses to
-- proceed without it — enforced here, not just in the form.
--
-- The reason is written into the task's existing comment thread, which is
-- permanent and immutable (PRD §6), so the reasoning survives as part of the
-- record rather than living only in a notification the person may dismiss.
--
-- State returns to 'none' (pending), NOT to the previously proposed date: the
-- proposal was rejected, so it should not linger as though still under review.
-- The task leaves the queue and returns when a new date is proposed.
create or replace function reject_promised_date(p_assignment_id bigint, p_reason text)
returns task_assignments
language plpgsql security definer set search_path = public as $$
declare a task_assignments; rejected date;
begin
  if not is_executive() then
    raise exception 'FORBIDDEN: executive only' using errcode = 'insufficient_privilege';
  end if;
  select * into a from task_assignments where id = p_assignment_id;
  if not found then raise exception 'Assignment not found'; end if;
  if a.promised_state <> 'proposed' then
    raise exception 'NOT_PROPOSED: there is no proposed date awaiting a decision here'
      using errcode = 'check_violation';
  end if;
  if length(btrim(coalesce(p_reason,''))) = 0 then
    raise exception 'REASON_REQUIRED: say why the date was rejected'
      using errcode = 'check_violation';
  end if;

  rejected := a.promised_proposed;

  -- Permanent, timestamped, attributed — same thread the stakeholder reads.
  insert into task_comments (task_id, assignment_id, author_id, author_role, body)
  values (a.task_id, a.id, auth.uid(), app_role(),
          'Promised date ' || to_char(rejected, 'DD Mon YYYY') || ' was not accepted. ' || btrim(p_reason));

  update task_assignments
     set promised_proposed = null,
         promised_state = 'none',
         promised_date = null,
         promised_confirmed_by = null,
         promised_confirmed_at = null
   where id = p_assignment_id returning * into a;

  perform _audit(a.task_id, a.id, 'promised_rejected', 'promised_date',
                 rejected::text, null);
  perform _notify(a.stakeholder_id, a.task_id, a.id, 'promised_rejected', btrim(p_reason));
  return a;
end $$;

grant execute on function
  reject_promised_date(bigint, text),
  mark_notifications_read(bigint[])
to authenticated;
