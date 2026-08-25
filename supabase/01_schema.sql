-- ════════════════════════════════════════════════════════════════════════════
--  CEO OFFICE TASK PLATFORM · 01_schema.sql
--  Tables, enums, indexes. Idempotent-ish (guarded with IF NOT EXISTS where
--  Postgres allows). Run order: 01_schema → 02_functions → 03_policies → 04_seed.
--
--  Design invariants encoded here:
--   • A task has NO global status. Status, promised date and comments live on
--     task_assignments — one row per (task, stakeholder) — so multiple
--     stakeholders progress INDEPENDENTLY and in isolation.
--   • "Executive" = a profile whose role is 'ea' or 'ceo'. Everyone else is a
--     'stakeholder'. Isolation and forward-only movement are for stakeholders.
--   • Audit is append-only and written by triggers (see 02_functions.sql), so
--     it captures every path, not just the app's happy path.
-- ════════════════════════════════════════════════════════════════════════════

create extension if not exists "pgcrypto";  -- gen_random_uuid()

-- ── Enums ────────────────────────────────────────────────────────────────────
do $$ begin
  create type user_role as enum ('ea', 'ceo', 'stakeholder');
exception when duplicate_object then null; end $$;

do $$ begin
  create type task_priority as enum ('high', 'medium', 'low');
exception when duplicate_object then null; end $$;

-- Note: 'reopened' is a real state a stakeholder must work OUT of; it is not a
-- permanent column. It only exists after an executive reopens a 'done' assignment.
do $$ begin
  create type assignment_status as enum ('todo', 'in_progress', 'under_review', 'done', 'reopened');
exception when duplicate_object then null; end $$;

do $$ begin
  create type promised_status as enum ('none', 'proposed', 'confirmed');
exception when duplicate_object then null; end $$;

-- ── profiles ────────────────────────────────────────────────────────────────
-- Mirrors auth.users (id = auth.uid()). Rows are created for stakeholders by the
-- admin script (scripts/create-stakeholder.mjs) and, as a safety net, by a
-- trigger on auth.users (see 02_functions.sql). There is NO public signup.
create table if not exists profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null unique,
  name        text not null,
  role        user_role not null default 'stakeholder',
  title       text,                         -- e.g. "Head of Marketing"
  color       text,                         -- avatar colour
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists profiles_role_idx   on profiles(role);
create index if not exists profiles_active_idx on profiles(active);

-- ── tasks ───────────────────────────────────────────────────────────────────
-- The executive request. No status column by design (see invariants above).
create table if not exists tasks (
  id                bigint generated always as identity primary key,
  title             text not null check (length(btrim(title)) > 0),
  description       text not null default '',
  priority          task_priority not null default 'medium',
  expected_date     date,                   -- set by EA/CEO
  next_followup_date date,                  -- set by EA/CEO
  created_by        uuid not null references profiles(id),
  archived          boolean not null default false,
  archived_at       timestamptz,
  archived_by       uuid references profiles(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists tasks_archived_idx    on tasks(archived);
create index if not exists tasks_priority_idx     on tasks(priority);
create index if not exists tasks_expected_idx     on tasks(expected_date);
create index if not exists tasks_followup_idx     on tasks(next_followup_date);

-- ── task_assignments ────────────────────────────────────────────────────────
-- THE critical table. One row per stakeholder on a task; each carries its own
-- status, promised date and (via task_comments) comment thread.
create table if not exists task_assignments (
  id                    bigint generated always as identity primary key,
  task_id               bigint not null references tasks(id) on delete cascade,
  stakeholder_id        uuid   not null references profiles(id),
  status                assignment_status not null default 'todo',
  -- Promised date workflow: stakeholder proposes → executive confirms → locked.
  promised_proposed     date,
  promised_date         date,                       -- the confirmed, locked value
  promised_state        promised_status not null default 'none',
  promised_confirmed_by uuid references profiles(id),
  promised_confirmed_at timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (task_id, stakeholder_id)
);
create index if not exists ta_task_idx        on task_assignments(task_id);
create index if not exists ta_stakeholder_idx on task_assignments(stakeholder_id);
create index if not exists ta_status_idx      on task_assignments(status);

-- ── task_comments ───────────────────────────────────────────────────────────
-- Comments belong to an ASSIGNMENT (a specific stakeholder's thread) so that
-- isolation is expressible in RLS. Immutable: no UPDATE/DELETE policy exists.
-- author_role is a snapshot taken at write time (role may change later).
create table if not exists task_comments (
  id            bigint generated always as identity primary key,
  task_id       bigint not null references tasks(id) on delete cascade,
  assignment_id bigint not null references task_assignments(id) on delete cascade,
  author_id     uuid   not null references profiles(id),
  author_role   user_role not null,
  body          text not null check (length(btrim(body)) > 0),
  created_at    timestamptz not null default now()
);
create index if not exists tc_task_idx       on task_comments(task_id);
create index if not exists tc_assignment_idx on task_comments(assignment_id);

-- ── task_attachments ────────────────────────────────────────────────────────
-- Metadata only; bytes live in the private Storage bucket 'task-attachments'.
create table if not exists task_attachments (
  id            bigint generated always as identity primary key,
  task_id       bigint not null references tasks(id) on delete cascade,
  storage_path  text not null,
  file_name     text not null,
  mime_type     text,
  size_bytes    bigint,
  uploaded_by   uuid not null references profiles(id),
  created_at    timestamptz not null default now()
);
create index if not exists at_task_idx on task_attachments(task_id);

-- ── audit_log ───────────────────────────────────────────────────────────────
-- Append-only. No UPDATE/DELETE policy is ever granted (see 03_policies.sql).
-- Written by triggers so it cannot be bypassed by talking to the DB directly.
create table if not exists audit_log (
  id            bigint generated always as identity primary key,
  task_id       bigint references tasks(id) on delete set null,
  assignment_id bigint references task_assignments(id) on delete set null,
  actor_id      uuid references profiles(id),
  actor_role    user_role,
  action        text not null,              -- e.g. 'status_changed', 'task_created'
  field         text,                       -- for field edits
  old_value     text,
  new_value     text,
  created_at    timestamptz not null default now()
);
create index if not exists audit_task_idx    on audit_log(task_id);
create index if not exists audit_created_idx  on audit_log(created_at desc);

-- ── saved_views ─────────────────────────────────────────────────────────────
-- WITHDRAWN by CR-02 #1 (see supabase/07_cr02.sql), which removed the saved-view
-- feature and its custom-filter builder. The table is deliberately no longer
-- created here: leaving it would mean re-applying this file resurrects a table
-- the application has no code for. The board's own filter bar is unrelated and
-- unaffected.
