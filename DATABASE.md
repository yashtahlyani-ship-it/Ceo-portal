# Database

PostgreSQL 16 on RDS. Eight migrations, applied by `backend/db.js` in filename
order on every boot — every statement is idempotent, so there is no separate
migration step and re-applying is a no-op.

`00_compat.sql` runs first and recreates the two things the policies depend on
that are not part of core Postgres: `auth.uid()` and the `authenticated` role.
Read it before anything else here. There is no `04_` — that file created the
Supabase Storage bucket, which S3 replaced; the gap is deliberate, since
renumbering would have changed the reviewed filenames of everything after it.

```
01_schema.sql     tables, enums, indexes
02_functions.sql  helpers, RPCs, audit triggers
03_policies.sql   row-level security
04_storage.sql    private attachment bucket + policies
05_cr01.sql       CR-01: stakeholder-raised tasks, created_at index
06_cr01_delete.sql CR-01: permanent delete
07_cr02.sql       CR-02: notifications, reject flow; drops saved_views
```

---

## The one invariant that shapes everything

> **A task has no status.**

Status, promised date and comments belong to a **`task_assignment`** — one row per
(task, stakeholder). This is what makes multi-stakeholder independence and
isolation *expressible* rather than something the application has to remember to
enforce.

```
tasks ──1:N──> task_assignments ──1:N──> task_comments
  │                   │
  │                   ├── status
  │                   ├── promised_proposed / promised_date / promised_state
  │                   └── promised_confirmed_by / _at
  │
  ├──1:N──> task_attachments
  └──1:N──> audit_log
```

A stakeholder's RLS predicate is simply `stakeholder_id = auth.uid()`. Because
comments hang off the assignment, the same shape isolates them for free. Had
status lived on `tasks`, isolation would have required filtering columns rather
than rows — which RLS cannot do.

**Overall task completion** is therefore derived, never stored: a task is
complete when *every* assignment is `done`.

---

## Enums

| Type | Values |
|---|---|
| `user_role` | `ea`, `ceo`, `stakeholder` |
| `task_priority` | `high`, `medium`, `low` |
| `assignment_status` | `todo`, `in_progress`, `under_review`, `done`, `reopened` |
| `promised_status` | `none`, `proposed`, `confirmed` |

`reopened` is a real state a stakeholder must work *out of* — not a permanent
column. The board renders that column only while something occupies it.

---

## Tables

### `profiles`
Mirrors `auth.users` (`id = auth.uid()`). Created by the admin scripts / Edge
Function, with a trigger on `auth.users` as a safety net that always defaults to
`stakeholder`.

`id` · `email` (unique) · `name` · `role` · `title` · `color` · `active` ·
`created_at` · `updated_at`

Indexes: `role`, `active`

### `tasks`
The executive request. **No status column, by design.**

`id` · `title` (non-empty) · `description` · `priority` · `expected_date` ·
`next_followup_date` · `created_by` · `archived` · `archived_at` · `archived_by` ·
`created_at` · `updated_at`

Indexes: `archived`, `priority`, `expected_date`, `next_followup_date`,
`created_at` (added by CR-01 for the created-date range filter)

> `tasks` also has **two** foreign keys into `profiles` (`created_by`,
> `archived_by`), so the creator embed must name its constraint too:
> `profiles!tasks_created_by_fkey`. The creator's *role* is what marks a task as
> self-created (CR-01 #6) — there is no stored flag to drift.

### `task_assignments`
The critical table.

`id` · `task_id` · `stakeholder_id` · `status` · `promised_proposed` ·
`promised_date` · `promised_state` · `promised_confirmed_by` ·
`promised_confirmed_at` · `created_at` · `updated_at`

Constraint: `unique (task_id, stakeholder_id)` — one assignment per person per task.

Indexes: `task_id`, `stakeholder_id`, `status`

> Note: this table has **two** foreign keys into `profiles` — `stakeholder_id` and
> `promised_confirmed_by`. PostgREST embeds must name the constraint
> (`profiles!task_assignments_stakeholder_id_fkey`) or the query is ambiguous and
> fails.

### `task_comments`
Belongs to an **assignment**, not a task, so isolation is a row predicate.
`author_role` is snapshotted at write time — a later role change does not rewrite
history.

`id` · `task_id` · `assignment_id` · `author_id` · `author_role` · `body`
(non-empty) · `created_at`

Indexes: `task_id`, `assignment_id`

Immutable: there is **no** `UPDATE` or `DELETE` policy. Rows are written only by
`add_comment()`.

### `task_attachments`
Metadata only; bytes live in the private bucket.

`id` · `task_id` · `storage_path` · `file_name` · `mime_type` · `size_bytes` ·
`uploaded_by` · `created_at`

Index: `task_id`

### `audit_log`
Append-only. Written exclusively by the `SECURITY DEFINER` `_audit()` function,
called from triggers.

`id` · `task_id` · `assignment_id` · `actor_id` · `actor_role` · `action` ·
`field` · `old_value` · `new_value` · `created_at`

Indexes: `task_id`, `created_at DESC`

`task_id` is `ON DELETE SET NULL` — audit rows outlive the tasks they describe.

Actions recorded: `task_created`, `field_edited`, `status_changed`,
`task_reopened`, `promised_proposed`, `promised_confirmed`, `stakeholder_added`,
`stakeholder_removed`, `comment_added`, `attachment_added`, `attachment_removed`,
`task_archived`, `task_restored`, `task_deleted`.

`task_deleted` carries the title in `old_value`, written *before* the row is
destroyed — otherwise the surviving audit row would point at nothing.

### `notifications`
CR-02 #5. Deliberately narrow: only the three promised-date events write here.

`id` · `recipient_id` · `actor_id` · `task_id` · `assignment_id` ·
`kind` (`promised_proposed` | `promised_confirmed` | `promised_rejected`) ·
`body` (the rejection reason) · `read_at` · `created_at`

Indexes: `(recipient_id, read_at)`, `created_at DESC`

There is **no INSERT policy** — rows come only from `_notify()`, so a
notification cannot be fabricated for someone else. `_notify()` also skips the
actor, so nobody is told about their own action.

> This is the **third** table with two foreign keys into `profiles`
> (`recipient_id`, `actor_id`). Embeds must name the constraint —
> `profiles!notifications_actor_id_fkey`.

> `saved_views` was **dropped** by CR-02 #1, which withdrew the feature.

---

## Row-Level Security

RLS is enabled on all seven tables. 19 policies.

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `profiles` | self + executives + all executives' rows | executive | executive | — |
| `tasks` | `can_see_task(id)` | executive | executive | **none** (delete only via RPC) |
| `task_assignments` | executive **or** `stakeholder_id = auth.uid()` | executive | executive | executive |
| `task_comments` | executive **or** own assignment | **none** | **none** | **none** |
| `task_attachments` | `can_see_task(task_id)` | executive | — | executive |
| `audit_log` | executive | **none** | **none** | **none** |
| `notifications` | own rows only | **none** (written by `_notify()`) | own rows only | — |
| `storage.objects` | `can_see_task(storage_task_id(name))` | executive | **none** | executive |

Where a cell says **none**, no policy exists at all — the operation is impossible
for every authenticated caller, including the CEO. That is how comment and audit
immutability are enforced.

`tasks` still has **no DELETE policy**, so a direct `delete from tasks` is refused
for everyone. CR-01 added permanent deletion, but only through two
`SECURITY DEFINER` RPCs (`delete_task`, `delete_self_task`) that check their own
rule — so the entry points stay exactly those two. Both record a `task_deleted`
audit event before removing the row, and `audit_log.task_id` is
`ON DELETE SET NULL`, so the history outlives the task.

Stakeholder mutations reach the tables only through the `SECURITY DEFINER` RPCs,
which check the rule and then write past RLS. This is why the direct-table
policies can stay deny-by-default and tight.

`profiles.SELECT` deliberately lets a stakeholder see executives' rows — comment
authorship has to render — but never other stakeholders.

---

## Verification

Every claim above is asserted by `tests/security.test.mjs`, which signs in with
the **anon key** as real users and checks the server refuses. See
[SECURITY.md](SECURITY.md).
