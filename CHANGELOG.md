# Changelog

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
