# Architecture

```
Browser (React 19 + Vite)
   │  a Cognito ID token — no other credential exists client-side
   ▼
Express API (ECS Fargate, arm64)
   ├── requireAuth ....... verifies the token signature (aws-jwt-verify)
   ├── loadIdentity ...... resolves `sub` → a profiles row
   └── withUser(id, fn) .. opens a transaction, sets auth.uid(), SET ROLE
        │
        ▼
   RDS Postgres  ← EVERY access decision is made here
   ├── RLS .......... reads and direct writes, gated by row predicates
   ├── RPC .......... every controlled mutation, rule checked inside
   └── triggers ..... append-only audit on every path

   S3 (private) ..... attachment bytes, 60-second presigned URLs
   Cognito .......... accounts, first-login password challenge
```

The client is a rendering layer with **no authority**, and so, unusually, is the
API. The backend authenticates and then gets out of the way: it does not decide
who may see what. That decision is a row predicate in Postgres, which is why it
holds on query paths nobody has written yet.

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
    http.js                transport: fetch + Cognito token refresh
    cognito.js             sign-in, first-login challenge, session restore
    api.js                 the only module that talks to the API
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

Express is a thin, deliberately unopinionated layer; **Postgres is where the
backend's decisions are made.** See `backend/sql/00_compat.sql` for the
mechanism and `tests/routes.test.mjs` for the guard that keeps it true.

### Three layers in `backend/sql/02_functions.sql` (extended by `05_cr01.sql`)

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

AWS Cognito, email/password — the same pool pattern as the Marketing and Legal
portals. No public signup: accounts are created only by
`POST /api/admin/stakeholders` or the admin scripts, both of which check the
caller is an executive first.

**First login:** a new account is created in `FORCE_CHANGE_PASSWORD`, so Cognito
answers `authenticateUser` with a `NEW_PASSWORD_REQUIRED` challenge **instead of
a session**.

That is worth dwelling on, because it fixed a real bug rather than just moving
one. The Supabase implementation stamped `must_set_password` in user metadata
and trusted the React app to honour it — and the app once did not, letting every
new user walk straight past the screen while a test asserting the flag was set
went on passing. The gate now lives in the token issuer: there is no token until
the password is set, so a client that forgets to render the screen has nothing
to render the board with either. The bug class is gone, not fixed.

`profiles.cognito_sub` links an account to a profile, and
`backend/middleware/identity.js` establishes that link on first sign-in. It will
only claim a profile whose `cognito_sub` is null and whose email Cognito has
**verified** — an unverified email claim is attacker-controllable in a federated
pool, and trusting one would let somebody sign up with the CEO's address and
inherit the CEO's role. There is deliberately no auto-create: a profile carries a
role, so someone in the pool without one is someone the EA has not onboarded.

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
