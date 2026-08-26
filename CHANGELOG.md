# Changelog

## v2.0.0 — AWS migration (25 Aug 2026)

**Supabase and Vercel are gone.** The platform now runs entirely on AWS, in the
same shape as the Marketing and Legal portals: two ECS Fargate services (arm64)
behind an ALB, RDS PostgreSQL, Cognito, and a private S3 bucket.

| Was | Is |
|---|---|
| Supabase Postgres | **RDS PostgreSQL 16** |
| Supabase Auth | **AWS Cognito** |
| Supabase Storage | **S3 + presigned URLs** |
| PostgREST (browser → database) | **Express API** (`backend/`, port 7869) |
| `create-stakeholder` Edge Function | `POST /api/admin/stakeholders` |
| Vercel | **ECS Fargate behind an ALB** |

### The decision that shaped this

Marketing and Legal enforce authorization in Express middleware. **This portal
keeps enforcing it in PostgreSQL Row-Level Security**, and the backend's job is
to bind a verified identity to each transaction rather than to decide anything.

That is not Supabase residue. RLS is a PostgreSQL feature and it moved to RDS
untouched — the same 19 policies, the same 25 functions, the same 41 security
tests. The alternative was to re-express the entire security boundary as
middleware during an infrastructure migration, and re-prove all 41 tests against
new code: real risk, taken to gain consistency. The isolation guarantee this
product exists to provide is that one stakeholder never sees a co-assignee's
status, promised date or comments, and a row predicate holds that on every query
path — including ones nobody has written yet.

What Supabase actually supplied was two conveniences the policies lean on:
`auth.uid()` and the `authenticated` role. Both are recreated in about thirty
lines by [`backend/sql/00_compat.sql`](backend/sql/00_compat.sql), which is the
best-commented file in the repository and the right place to start reading.
Every request runs:

```sql
begin;
  select set_config('app.user_id', '<uuid from the verified Cognito token>', true);
  set local role authenticated;
  ...
commit;
```

which is the same mechanism PostgREST used. `SET LOCAL ROLE` matters: Postgres
exempts a table's *owner* from RLS, so querying as the connecting user would
silently disable every policy in the schema.

### The new failure mode, and how it is covered

There is now application code between the user and the policies, and
`backend/db.js` exports two functions one word apart:

```js
await withUser(req.profile.id, c => c.query('select * from tasks'));  // RLS ON
await query('select * from tasks');                                    // RLS OFF
```

A route that reaches for the second still works, still returns data, and still
passes every functional test — while serving one stakeholder another
stakeholder's private thread. Nothing goes red.

Added [`tests/routes.test.mjs`](tests/routes.test.mjs): five static checks that
fail the build if a route imports the RLS-bypassing `query` without a written
exemption, if `withUser` is passed anything other than `req.profile.id`, if a
route hand-rolls a visibility filter that duplicates a policy, or if an `/api`
router is mounted above the authentication middleware. No database, milliseconds,
runs in CI on every push.

### What got better, not just different

- **The first-login gate moved into the token issuer.** Accounts are created in
  `FORCE_CHANGE_PASSWORD`, so Cognito answers with a `NEW_PASSWORD_REQUIRED`
  challenge *instead of a session*. The previous design stamped a flag in user
  metadata and trusted the app to honour it — and the app once did not, letting
  every new user walk straight past the screen while the test asserting the flag
  kept passing. There is now no token to render the board with. The bug class is
  gone rather than fixed.
- **Ambiguous-embed bugs are gone.** Three tables have two foreign keys into
  `profiles`, which broke queries three separate times under PostgREST. The
  backend writes its joins in SQL, where the choice is explicit.
- **Bundle is ~117 kB smaller** (~381 kB / 113 kB gzipped), a side effect of
  dropping `@supabase/supabase-js`.
- **No third-party bill.** The Supabase plan sat outside the AWS invoice; this
  system's cost now appears in one place.
- **Security response headers were preserved.** `X-Content-Type-Options`,
  `X-Frame-Options`, `Referrer-Policy` and `Permissions-Policy` were set by
  `vercel.json`. Retiring that file would have dropped them silently, so they
  moved into `frontend/public/serve.json` and now travel with the container.
  Verified served on `GET /`.

### Honest notes

- **The 41 security tests keep their exact text.** They now run against Postgres
  through [`tests/pg-shim.mjs`](tests/pg-shim.mjs), a small PostgREST-shaped
  query builder over `pg`. Rewriting 829 lines of security assertions by hand
  during an infrastructure migration is how a security test gets quietly
  weakened while still passing — so the substrate was recreated instead of the
  tests. Same reasoning as `00_compat.sql`, applied to the test suite.
- **Four tests genuinely had to move**, because they tested Supabase products
  rather than this schema: password sign-in, the invite Edge Function, and the
  two that pushed real bytes through Supabase Storage. They are now in
  [`tests/api.test.mjs`](tests/api.test.mjs), which runs against a deployed
  stack and skips itself when one is not configured.
- **One guarantee left the database, and this is the thing to watch.** Supabase
  protected attachment *bytes* with a storage RLS policy —
  `can_see_task(storage_task_id(name))` — so the same predicate covered the
  metadata and the file. S3 cannot consult Postgres, and a presigned URL is a
  bearer credential. The check now lives in `backend/routes/attachments.js`,
  which re-reads the attachment row through `withUser()` and presigns only what
  RLS returned. **This makes S3 Block Public Access load-bearing:** if the
  bucket were readable, that check would be decorative.
- **`backend/sql/` has no `04_`.** That file created the Supabase Storage bucket.
  Renumbering would have changed the reviewed filenames of everything after it,
  so the gap was left deliberately.
- **Migrations now apply on every boot.** `backend/db.js` runs `sql/*.sql` in
  filename order at startup; every statement is idempotent, so deploying is just
  a restart. CI applies the whole set **twice** against a scratch database to
  prove that property, because a non-idempotent migration would now break every
  restart rather than failing once at deploy time.
- **The old Supabase and Vercel access tokens are still unrotated.** They were
  shared in plaintext during development. Both services are gone from this
  system, but a live token is a live token until it is revoked — and a Supabase
  access token still reaches every project that account owns. See HANDOVER §10.

---

## CR-01 — Post-launch enhancements (24 Aug 2026)

Implements *Change Request — CEO's Office Task Management Tool, CR-01 v1.0*,
prepared by the Executive Assistant. All six changes are live.

| # | Change | Where |
|---|---|---|
| 1 | Summary is optional | `CreateTaskModal.jsx`, `create_self_task` |
| 2 | Search in "Assign to" | `CreateTaskModal.jsx` |
| 3 | Created-date (from–to) filter, EA **and** stakeholder boards | `filters.js`, `Board.jsx` |
| 4 | Expected-date filter removed, replaced by created date | `rules.js`, `filters.js`, `SavedViews.jsx` |
| 5 | Stakeholder View on the dashboard | `Dashboard.jsx` |
| 6 | Stakeholders can raise tasks for themselves | `05_cr01.sql`, `rules.js`, `CreateTaskModal.jsx`, `TaskDrawer.jsx` |
| 6b | Permanent delete | `06_cr01_delete.sql`, `TaskDrawer.jsx`, `Archive.jsx` |

---

### 1 · Summary optional

The field no longer blocks submission, on both the executive and the
stakeholder form. An empty summary renders as *"No summary."* in the drawer
rather than as blank space, so it reads as a deliberate state rather than
something that failed to load. A summary can be added later by editing.

### 2 · Search in "Assign to"

A search input sits above the assignee grid and filters as you type. It matches
**name or title**, so "legal" finds both the Head of Legal and the Head of Legal
Operations without knowing either name — which is the case that gets harder as
the list grows past 15.

### 3 · Created-date range filter

Present on the executive Kanban and on each stakeholder's own board, as the CR
confirms it should be.

One subtlety worth knowing: `created_at` is a timestamp, and the filter inputs
are plain dates. The comparison uses the **local** calendar day. Using the UTC
slice would drop every task raised before ~05:30 IST out of its own day — the
same timezone trap already documented in HANDOVER §9.

### 4 · Filter swap

Expected date is gone as a manual filter control everywhere, including the saved-view
builder. Created date replaces it.

**The Overdue / Due Today / Next 7 Days buckets are untouched**, exactly as the
CR requires. Those tiles now drill through using an internal `dueBucket` filter
rather than a date range — it is not a user-facing control, so the manual filter
set is clean, while the tiles keep working off expected date. When a tile applies
one, the board shows a removable chip, so the board is never silently filtered by
something with no visible cause.

Four seeded saved views were migrated off the removed keys: *Overdue Tasks* and
*Due This Week* now use `dueBucket`; a new *Raised This Month* view demonstrates
the created-date filter.

### 5 · Stakeholder View

Implemented as a **tab on the dashboard** ("Overview" / "By stakeholder"), which
matches the CR's "a tab/section" wording and avoids an eighth header nav item —
the header does not fit one at 1280px (HANDOVER §9).

It lists every stakeholder as a workload card (active / overdue / reopened /
done). Selecting one opens their full board, including tasks they raised
themselves. That board is the *same* `Board` component the Kanban uses,
pre-filtered — not a second implementation that could drift.

> The CR asked us to flag this interpretation. We read "Stakeholder View" as
> *browse by stakeholder*, not *preview the app as a stakeholder sees it*. If the
> latter was intended, say so — it is a different (and smaller) piece of work.

### 6 · Stakeholder-raised tasks

The structurally significant one. A **separate, narrower RPC** rather than
loosening the existing `create_task`:

```
create_self_task(title, description, priority, expected_date)
```

It takes **no assignee list at all**. There is therefore no route — not a
disabled control, not a hidden field, but no route — by which a self-raised task
can land on someone else's board. `create_task` stays executive-only, and a
stakeholder is still refused `add_stakeholder` on their own task.

Also added: `update_self_task` and `archive_self_task`, both scoped to
*the creator of a self-created task*. A stakeholder can edit or withdraw what
they raised, and still cannot touch work assigned to them.

Row-level security is **unchanged**. Every one of these is `SECURITY DEFINER`
and checks its own rule, so the direct-table policies stay deny-by-default.

**Self-created is derived, not stored** — a task is self-created when its creator
is a stakeholder. No boolean column to drift out of step with reality.

#### Assumptions the CR asked us to confirm

| Assumption | Status |
|---|---|
| The date on a self-created task is final — no propose/confirm step | **Implemented as stated.** Both `propose_promised_date` and `confirm_promised_date` now refuse self-created tasks with a `SELF_CREATED` error rather than allowing a meaningless "awaiting confirmation" state. |
| The creator has edit/delete rights over that task only | **Implemented as stated.** |
| Self-created tasks carry a visible tag for the EA | **Implemented.** "Self-created" on the card, "Self-created by [Name]" in the drawer, plus a "Raised by" field. |
| EA/CEO retain full edit and delete rights, no special protection | **Implemented as stated.** |

#### Permanent delete

The CR asks for **delete**, and delete is what it now does. This was initially
shipped as archive-only, with the deviation flagged; on instruction it is now a
real, irreversible delete (`06_cr01_delete.sql`).

| Who | May permanently delete |
|---|---|
| EA / CEO | any task |
| Stakeholder | only a task they raised themselves |

This reverses a standing invariant — until now nothing in this system could be
destroyed. Three things keep it from becoming a hole:

1. **The audit trail survives.** `audit_log.task_id` is `ON DELETE SET NULL`, so
   its rows outlive the task — but they would be anchored to nothing. So the RPC
   writes a `task_deleted` event **before** removing the row, recording the title
   and the actor. The history still reads *"Priya Sharma permanently deleted
   'Draft my Q4 team plan'"* after the task is gone.
2. **No `DELETE` policy was added to `tasks`.** Deletion is reachable only
   through the two `SECURITY DEFINER` functions, each checking its own rule. A
   direct `delete from tasks` over the REST API is still refused for everyone,
   including the CEO — verified by test.
3. **Archive still exists and is still the default.** The drawer offers
   *Withdraw* (reversible) before *Delete* (permanent), and the confirmation
   names exactly what will be destroyed rather than asking "are you sure?".

Attachment bytes live in storage, which SQL cannot reach, so the RPC returns the
orphaned paths and the client removes them. That cleanup is best-effort and does
not throw: with no task row, no storage policy grants access to those objects
anyway.

Delete is also available from the **Archive** view, which is where you decide
something is genuinely finished with.

---

### Verification

- **61 tests passing** (23 unit, 38 integration) — up from 44. New coverage:
  the self-created creation/edit/withdraw boundaries, the "cannot assign to
  others" boundary, the suppressed promised-date handshake, executives retaining
  authority over self-raised tasks, the created-date filter including its
  timezone behaviour, the due-bucket drill-through surviving the swap, and for
  permanent delete: creator-only scoping, assigned work staying undeletable,
  cascade behaviour, the audit trail surviving with the title recorded, and a
  direct REST delete still being refused for everyone.
- Walked through in the browser on production as CEO, EA and stakeholder.
- 0 lint errors, clean build.

---

## CR-02 — Promised-date approval, navigation, notifications, invites (25 Aug 2026)

| # | Change | Where |
|---|---|---|
| 1 | Saved Views removed entirely | `07_cr02.sql` (table dropped), nav, `api.js` |
| 2 | Re-opened as a top-level tab | already shipped — CR-02 frees the slot |
| 3 | New Proposed Date tab (admin-only) | `ProposedDates.jsx` |
| 4 | Confirm-and-lock / reject-with-comment | `reject_promised_date()` |
| 5 | Notifications, promised-date workflow only | `notifications` table, `NotificationBell.jsx` |
| 6 | Invite-based onboarding with Designation | `create-stakeholder` Edge Function v2 |

### 1–2 · Navigation

Saved Views is withdrawn, table and all — the CR removes the underlying
custom-filter-building capability, so leaving a dormant table and its policies
behind would just puzzle the next reader. **The board's own filter bar (CR-01) is
untouched**; that is a different thing.

Re-opened was already a top-level tab in this build, so #2 needed no work beyond
freeing the slot Saved Views occupied. Nav is still seven items and still fits at
1280px.

### 3–4 · Proposed Date queue

Admin-only. Every assignment awaiting a decision, **oldest first** — whoever has
been waiting longest is dealt with first. A proposal later than the task's
expected date is flagged in amber, since that is precisely the case the queue
exists to catch.

**Reject requires a reason, enforced in the database.** `reject_promised_date()`
raises `REASON_REQUIRED` on an empty one, so the rule holds even if the form is
bypassed. The reason is written into the task's existing comment thread —
permanent, timestamped, attributed (PRD §6) — rather than living only in a
notification the stakeholder might dismiss.

On rejection the state returns to **pending**, not to the rejected date: a
proposal that was turned down should not linger looking like it is still under
review. The item leaves the queue and returns when a new date is proposed.

### 5 · Notifications

Three events only — proposed, confirmed, rejected. Not comments, not edits, not
column moves; the dashboard remains the monitoring mechanism for everything else,
as PRD §10 intended.

The table is generic but the **writers are few**: `_notify()` is the only way in,
there is no INSERT policy, and it skips the actor so nobody is told about their
own action. That is what keeps this from quietly becoming a firehose.

> **Answering the assumption flagged in §5:** implemented as **in-app only**, as
> the CR proposed. Adding email later is a small change — `_notify()` is the
> single seam — but see the note on SMTP below before promising it.

Polling every 60s rather than a realtime subscription: at ~17 users and three
event types, a subscription's reconnect and auth-refresh handling costs more than
it buys.

### 6 · Invite flow

`inviteUserByEmail` with Name, Email and **Designation**. Designation was already
stored as `profiles.title` and already surfaced by CR-01's assignee search and
Stakeholder View, so this names the field rather than adding one.

**The honest caveat:** this project has **no custom SMTP**, and Supabase's
built-in sender is capped at ~2 emails/hour and only reliably reaches team
members. So the function tries the invite and, when the mail cannot be sent,
falls back to creating the account with a temporary password — returning the
real reason, which the UI shows rather than claiming an email went out.
Onboarding never hard-blocks on mail delivery.

**Configure SMTP in Supabase → Authentication → Emails before onboarding real
people.** `site_url` and the redirect allow-list have been pointed at the live
app, so invite links will resolve correctly once mail works.

### Bug found while verifying

The notification bell showed "Nothing yet" while rows sat in the table.
`notifications` is the **third** table with two foreign keys into `profiles`
(`recipient_id`, `actor_id`), so `actor:profiles(...)` was ambiguous and
PostgREST refused the query — and a `.catch(() => {})` in the poll swallowed the
error whole. Both fixed: the embed names its constraint, and a failed poll now
warns instead of vanishing.

### Verification

- **64 tests** (23 unit, 41 integration), up from 61. New: reject requires a
  reason and is executive-only; state resets to pending; the reason lands in the
  comment thread and the audit log; a decided proposal cannot be decided twice;
  notifications reach the right people and not the actor; a stakeholder reads
  only their own and cannot forge one; `saved_views` is gone.
- Walked through on production as EA and stakeholder, including the full
  reject → notification → reason loop.
