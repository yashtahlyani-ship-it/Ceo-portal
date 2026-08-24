# Security

## Principle

**The client is never the authority.** `src/lib/rules.js` exists so the right
buttons appear; it has no enforcement value. Every rule it describes is
re-checked by Postgres. If the two ever disagree, the server wins and the person
sees a translated message.

A useful way to read this document: for each control below, ask *"what happens if
someone skips the UI entirely and calls the API with a valid stakeholder token?"*
That is the case each control is written for, and the case the tests exercise.

---

## Authentication

- Supabase email/password. **No public signup** — accounts are created only by
  the `create-stakeholder` Edge Function or the admin scripts, both of which use
  the service role *after* verifying the caller is EA or CEO.
- New accounts are stamped `must_set_password: true`. The app holds them on the
  password-set step until they choose their own; the flag is cleared in the same
  `updateUser` call that sets the password, so a refresh mid-flow cannot strand
  them.
- A trigger on `auth.users` guarantees a `profiles` row exists, defaulting to
  `stakeholder`. Absent or tampered metadata can never mint an executive.
- The **anon key is public by design**. It identifies the project, it does not
  grant anything. Security comes from RLS. The **service-role key** bypasses RLS
  and lives only in `.env` (gitignored), used by `scripts/` and the tests.

---

## Authorization

Three layers, each independently sufficient for what it covers:

**1. Row-Level Security** — the real boundary. Enabled on all seven tables, 19
policies. Full matrix in [DATABASE.md](DATABASE.md). Reads return only what the
caller may see, so even a hand-built query returns nothing extra.

**2. `SECURITY DEFINER` RPCs** — every controlled mutation checks its rule before
writing. Stakeholders have no direct write policy on any table; their changes
happen only through these functions.

CR-01 added a second task-creation path for stakeholders. It is a **separate,
narrower RPC** (`create_self_task`) rather than a loosened `create_task`: it
accepts no assignee list, so a stakeholder-raised task can only ever assign its
own creator. `create_task` remains executive-only, and `add_stakeholder` still
refuses stakeholders — including on a task they raised themselves. Row-level
security was not changed by CR-01.

**3. Impossible operations** — where no policy exists, the operation cannot be
performed by anyone authenticated, including the CEO:

| Operation | Why it is impossible |
|---|---|
| Edit or delete a comment | no `UPDATE`/`DELETE` policy on `task_comments` |
| Edit or delete an audit row | no `UPDATE`/`DELETE` policy on `audit_log` |
| Hard-delete a task | no `DELETE` policy on `tasks` |
| Overwrite a stored object | no `UPDATE` policy on `storage.objects` |

---

## Data isolation

The isolation requirement — a stakeholder must not see a co-assignee's status,
promised date or comments — is met **structurally**, not by filtering in the UI.

Because status and promised dates live on `task_assignments` (one row per person)
rather than on `tasks`, isolation is a row predicate:

```sql
using ( is_executive() or stakeholder_id = auth.uid() )
```

Consequences, all verified:

- A stakeholder querying a shared task receives **one** assignment row — their own.
- Requesting a co-assignee's assignment by id returns **empty**, not an error.
- Comments hang off the assignment, so the same predicate isolates them.
- Comment **counts** on the board ride the same RLS as the rows, so a card cannot
  leak that someone else wrote twelve comments.
- `add_comment()` refuses a thread the caller does not own.

---

## Workflow integrity

The state machine is a single function, `_is_forward(from, to)`, with exactly
four legal stakeholder edges:

```
todo → in_progress → under_review → done
reopened → in_progress
```

Anything else raises `INVALID_TRANSITION`. A stakeholder therefore cannot skip a
stage, move backward, move a Done assignment, or jump from Re-opened to Done — no
matter what they send. Executives may move any assignment to any status; every
such override writes an audit event.

Promised dates: the stakeholder proposes (own assignment only), an executive
confirms, and confirmation **locks** it — a further proposal raises `LOCKED`. A
stakeholder cannot confirm their own promise.

---

## Attachment security

- Bucket `task-attachments` is **private** (`public = false`). There is no
  anonymous URL for any object.
- Reading requires a signed URL, valid 60 seconds, mintable only by a caller who
  passes the read policy.
- That policy is `can_see_task(storage_task_id(name))` — **the identical predicate
  that governs the task**. Attachment visibility cannot drift from task
  visibility, because it is not a separate rule.
- `storage_task_id()` returns `null` for any path not shaped `task/<id>/…`, so
  the policy fails closed on a malformed name.
- Uploads and deletes are executive-only, at both the metadata table and the
  bucket.
- Server-side limits: 10 MB per file, MIME allow-list. The client checks size
  first only so the person gets a clear message before a large upload travels.

---

## Audit integrity

Audit rows are written by **database triggers**, not application code. That
matters: they capture every path, including a direct table write by an executive
and anything a future feature does. Application code cannot forget to log.

- Written only by the `SECURITY DEFINER` `_audit()` function.
- No `INSERT`, `UPDATE` or `DELETE` policy exists on `audit_log`, so no
  authenticated caller can write, edit or clear it.
- Readable by EA/CEO only. A stakeholder's query returns empty.
- Field edits record `old_value → new_value`, plus actor and actor role.
- `task_id` is `ON DELETE SET NULL`, so audit rows outlive their tasks.

---

## Input validation and injection

- All access goes through the Supabase client, which sends **parameterised**
  queries and RPC arguments. No string-concatenated SQL anywhere.
- Server-side constraints: non-empty title, non-empty comment body, enum-typed
  status/priority/role, unique `(task_id, stakeholder_id)`.
- React escapes all rendered text; there is no `dangerouslySetInnerHTML` in the
  codebase, so task titles and comments cannot inject markup.
- Uploaded filenames are sanitised before use in a storage path, and the path is
  prefixed with a UUID, so a crafted name cannot traverse or collide.

---

## Transport and headers

Supabase is HTTPS-only. `vercel.json` sets `X-Content-Type-Options: nosniff`,
`X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin` and a
`Permissions-Policy` denying camera, microphone and geolocation.

---

## Verification

`npm run test:security` — **33 integration tests against the live database.**

The methodology is the point: tests sign in as real users with the **anon key**,
the same surface a browser has. The service role is used *only* to build fixtures
and to independently confirm what actually landed in the table — never to perform
the action under test. So a passing test means the **server refused**, not that a
button was hidden.

Covered:

| Area | Assertions |
|---|---|
| Authentication | EA/CEO/stakeholder sign in; bad password rejected; anonymous caller reads nothing |
| Task permissions | executives create; stakeholder refused; stakeholder edit and archive have no effect |
| Transitions | full forward path; skipping refused; backward refused; another person's assignment refused; executive override both directions |
| Reopening | executive only; not from a non-done state; reopened→done refused; reopened→in_progress allowed |
| Promised dates | propose → confirm → lock; stakeholder cannot confirm; confirmed date immutable |
| Multi-assignee | independent status and dates; co-assignee's assignment, status and comments invisible; writing to their thread refused; completion only when all done |
| Comments | immutable against author *and* executive; blank refused |
| Audit | full lifecycle recorded with old→new, actor, role; invisible to stakeholders; cannot be edited or deleted |
| Archive | soft delete, restorable, and a task row survives a `DELETE` attempt |
| Saved views | private to owner; a stakeholder cannot create one |
| Attachments | visible to assignees, hidden from non-assignees; stakeholder upload refused; bucket private; non-assignee cannot mint a signed URL |
| Onboarding | stakeholder cannot call `create-stakeholder`; CEO can; new account is a stakeholder with the first-login flag set |
| Self-raised tasks (CR-01) | a stakeholder may raise one for themselves; it is invisible to other stakeholders; it cannot be routed to anyone else; only the creator may edit or withdraw it; work assigned *to* them stays read-only; the promised-date handshake is refused; executives keep full authority over it |

---

## Before real use

1. **Rotate the demo password** (`DEMO_PASSWORD` in `.env`) and remove or re-seed the
   `@demo.gyftr.net` accounts.
2. **Rotate the Supabase and Vercel access tokens** used to provision this
   project — they were shared in plaintext during setup.
3. Consider restricting the deployment behind Vercel authentication or an IP
   allow-list; the login page is currently publicly reachable (it grants nothing,
   but it is visible).
4. Confirm the Supabase project's password policy matches the rules shown on the
   set-password screen (8+ chars, upper, lower, number, symbol).
