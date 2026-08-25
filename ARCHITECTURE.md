# Architecture

```
Browser (React 19 + Vite)
   │  anon key only — never the service role
   ▼
Supabase
   ├── Auth ......... email/password, first-login password set
   ├── PostgREST .... reads, gated by Row-Level Security
   ├── RPC .......... every controlled mutation, rule checked inside
   ├── Storage ...... private bucket, RLS-gated signed URLs
   └── Edge Function  create-stakeholder (service role, server-side only)
```

The client is a rendering layer with **no authority**. Every rule it knows about
exists so the right buttons appear; the server re-checks all of them.

---

## Frontend

```
src/
  App.jsx                  header shell, nav, search, view routing
  main.jsx                 injects the design system once, mounts AuthProvider
  assets/logo.png          identical file to the Marketing Portal's
  components/
    GyftrLogo.jsx          identical component to Marketing's
    Login.jsx              sign-in + first-login password (ported from Marketing)
    ui.jsx                 Avatar, chips, Metric, Empty, Skeleton, Modal, Field
    TaskDrawer.jsx         Overview / Progress / Comments / Attachments / Activity
    NotificationBell.jsx   CR-02 in-app notifications (promised-date only)
    CreateTaskModal.jsx    task creation — executive (assign others) or self-raised
  views/
    Dashboard.jsx          executive overview + "By stakeholder" tab (CR-01 #5)
    StakeholderHome.jsx    the stakeholder's simpler dashboard
    Board.jsx              Kanban, filters, movement controls
    Reopened.jsx           rework grouped by stakeholder
    Followups.jsx          tasks flagged to chase
    Archive.jsx            soft-deleted tasks, restorable
    Stakeholders.jsx       directory + add/deactivate
    ProposedDates.jsx      CR-02 promised-date decision queue (admin-only)
  hooks/useAuth.jsx        session, profile, first-login gate
  lib/
    supabase.js            client
    api.js                 the only module that talks to Supabase
    rules.js               client mirror of the server's rules (UX only)
    filters.js             pure board filtering + error copy
    derive.js              tasks → dashboard numbers
    format.js              dates, initials, role labels
    styles.js              design system + semantic colour maps
```

### Design system

`lib/styles.js` is the Marketing Portal's `styles.js` verbatim, plus a block
marked `CEO OFFICE ADDITIONS` holding Kanban column/card, metric, lock, skeleton
and empty-state classes. Those additions use **only** existing custom properties.
`main.jsx` injects the stylesheet once into `<head>` and wraps the app in
`.gx-root`, which is where the tokens are defined.

Semantic maps (`PRIORITY`, `STATUS`, `TONE`, `AVATAR_COLORS`) live in the same
file. Their values are lifted from Marketing's `constants/index.js`. Where the
CEO Office needs a status Marketing does not have, it borrows Marketing's closest
existing swatch rather than adding a hue:

| CEO status | Marketing swatch reused |
|---|---|
| To-Do | Deferred (stone) |
| In Progress | Execution (violet) |
| Under Review | Review (amber) |
| Done | Completed (green) |
| Re-opened | Hold Due To Clarity (magenta) |

Colour is never the only signal — every chip carries its label as text.

### State

Deliberately plain: `useState` in `App.jsx` holds the task list, search string
and board filters, passed down as props. No state library. At ~17 users and a
few hundred rows this is the right amount of machinery. `App` refetches on mount
and on window focus — the same pattern as the Marketing Portal, and how an EA
watching the board sees a stakeholder's move appear.

---

## Backend

There is no bespoke server. Postgres is the backend.

### Three layers in `supabase/02_functions.sql` (extended by `05_cr01.sql`)

**1. Identity helpers** — `app_role()`, `is_executive()`, `owns_assignment()`,
`can_see_task()`. `SECURITY DEFINER` so they can read `profiles` from inside an
RLS policy without recursion. These are the vocabulary the policies are written in.

**2. RPCs** — every controlled mutation. Each is `SECURITY DEFINER` (so it may
write past RLS) and checks its own rule first:

| Function | Rule enforced |
|---|---|
| `create_task` | executive only; title required |
| `create_self_task` | stakeholder only; assigns the caller to themselves, and takes no assignee list |
| `update_self_task` | the creator of a self-created task, that task only |
| `archive_self_task` | the creator of a self-created task; archives, never destroys |
| `advance_status` | executive → any status; stakeholder → one forward step on their own assignment |
| `propose_promised_date` | own assignment only; refused once confirmed, and refused on self-created tasks |
| `confirm_promised_date` | executive only; a proposal must exist; refused on self-created tasks |
| `reopen_assignment` | executive only; only from `done` |
| `add_comment` | executive → any thread on the task; stakeholder → own thread only |
| `add_stakeholder` / `remove_stakeholder` | executive only |
| `archive_task` / `restore_task` | executive only |

The state machine is one function, `_is_forward(from, to)`, holding exactly four
legal stakeholder edges:

```
todo → in_progress → under_review → done
reopened → in_progress
```

Everything else is refused with `INVALID_TRANSITION`. There is no second copy of
this rule on the server.

**3. Audit triggers** — `AFTER` triggers on `tasks`, `task_assignments`,
`task_comments` and `task_attachments` write to `audit_log`. Being triggers
rather than application code, they capture **every** path — including a direct
table write by an executive, or anything a future feature does.

### Business logic placement

Server-side rules live only in `02_functions.sql`. `lib/rules.js` mirrors them
for UX and says so in its header comment. If the two disagree, the server wins
and the user sees a translated message from `lib/filters.js`. The unit tests
assert the mirror; the integration tests assert the server.

---

## Auth

Supabase email/password. No public signup — the anon key cannot create a user
because accounts are only created by the `create-stakeholder` Edge Function or
the admin scripts, both of which use the service role after checking the caller.

**First login:** a new account is stamped `must_set_password: true` in
`user_metadata`. `useAuth` reads that flag and holds the person on the
"set a new password" screen until they choose one; `setPassword()` sets the
password and clears the flag in a single `updateUser` call, so a mid-flow refresh
cannot strand them. This mirrors the Cognito `NEW_PASSWORD_REQUIRED` challenge
used by the Marketing and Legal portals, expressed in Supabase's terms.

A `handle_new_auth_user` trigger on `auth.users` guarantees a `profiles` row
exists for every auth user, defaulting to `stakeholder` — so a missing or
tampered metadata payload can never mint an executive.

---

## Storage

Bucket `task-attachments`, `public = false`, 10 MB per file, MIME allow-list of
PDF/DOCX/XLSX/DOC/XLS/PNG/JPEG.

Objects are named `task/<task_id>/<uuid>-<filename>`. `storage_task_id(name)`
parses the task id out of that path and returns `null` for any other shape, so
the policies fail closed on a malformed name. The read policy is
`can_see_task(storage_task_id(name))` — **the same predicate that governs the
task itself**, so attachment visibility can never drift from task visibility.
Writes and deletes are executive-only.

There is no public URL. Reading requires a signed URL minted for a caller who
passed the read policy, valid for 60 seconds.

---

## Edge Function

`create-stakeholder` exists so the EA/CEO can add people from the app without the
service-role key ever reaching a browser. It:

1. verifies the caller's JWT and loads their role **as the caller**;
2. rejects anyone who is not `ea` or `ceo`;
3. only then uses the service role to create the account, stamped
   `must_set_password: true` and `role: 'stakeholder'`.

---

## Performance

~17 users, a few hundred rows. Explicitly not over-engineered.

- Indexes on every filter and join column (see [DATABASE.md](DATABASE.md))
- One query loads tasks, assignments, assignee profiles and comment/attachment
  counts via PostgREST embeds — the board does not N+1
- Comment and attachment **counts** ride the same RLS as the rows they count, so
  a stakeholder's count reflects only their own thread
- Comments, attachments and audit rows load lazily, per drawer tab
- Refetch on focus rather than polling or realtime subscriptions

---

## Not built (deliberate)

Notifications of any kind. The PRD places them out of scope for v1 and names the
dashboard as the monitoring mechanism. If added later, the natural seam is a
Postgres trigger on `audit_log` feeding a queue — the audit trail already records
every event a notification would announce.
