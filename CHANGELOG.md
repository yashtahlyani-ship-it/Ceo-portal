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

#### One deviation, flagged

The CR says the creator can **delete** their own task. This **archives** it
instead, and the button reads *Withdraw*.

The reason is a standing invariant: no task is ever destroyed in this system.
There is no `DELETE` policy on `tasks` for anyone, including the CEO — the audit
trail has to stay answerable, and "delete" already means "archive" everywhere
else in the tool. A withdrawn task leaves every board and the EA/CEO can restore
it. If a true hard delete is genuinely wanted for self-raised tasks, that is a
deliberate change to the audit model and worth a conversation first.

---

### Verification

- **55 tests passing** (22 unit, 33 integration) — up from 44. New coverage:
  the self-created creation/edit/withdraw boundaries, the "cannot assign to
  others" boundary, the suppressed promised-date handshake, executives retaining
  authority over self-raised tasks, the created-date filter including its
  timezone behaviour, and the due-bucket drill-through surviving the swap.
- Walked through in the browser on production as CEO, EA and stakeholder.
- 0 lint errors, clean build.
