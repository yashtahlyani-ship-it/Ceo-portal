# Demo

**Live:** https://gyftr-ceo-portal.vercel.app
**Local:** `npm run dev:frontend`

---

## Accounts

Every account signs in with:

> **`Default@123`**

> ⚠️ **Shared password on a public URL — change this before the tool carries
> real work.** These are now **real `@gyftr.com` addresses**, and one password
> across the whole company means one leak exposes every account. It is set this
> way so the team can evaluate without friction, nothing more.
>
> The fix is already built: configure SMTP in **Supabase → Authentication →
> Emails**, then run `cd scripts && node onboard.mjs --apply`. Everyone gets an
> individual email invite and sets their own password; no shared secret survives.

### Who is in the tool

**19 people**, loaded from `scripts/roster.json` — which is **gitignored**,
because this repository is public and a directory of working corporate addresses
is what gets scraped for phishing. The roster is not reproduced here for the same
reason: open the **Stakeholders** tab in the app to see it.

| Role | Who |
|---|---|
| Executive Assistant (Super Admin) | Anushka Mishra — address is in `roster.json` / the Stakeholders tab |
| CEO (Admin) | *none yet* — Anushka holds every executive permission, so the tool works without one. Add the CEO to `roster.json` when you have their address. |
| Stakeholders | 18, across Marketing, Operations, CS, HR, Product, BA, IT, Legal, Finance and Business |

Two notes on the roster as supplied:

- **Nitin Kumar appeared twice** on the same address under both Legal and
  Finance. Emails are unique, so the Finance row was dropped and Legal kept.
- **`CS` and `BA` are left verbatim** as designations. `Mkt`, `Ops` and `Prod`
  were expanded to Marketing / Operations / Product; the other two are ambiguous
  and were not guessed. Edit them in the app if they should read differently.

The seed creates ~67 tasks across these people — overdue, due today, due this
week, follow-ups due, reopened work, promised dates in all three states,
multi-assignee tasks and comment threads — so the dashboard is alive on first
load. `npm run seed` resets everything cleanly.

> **Restoring the anonymous demo roster:** delete `scripts/roster.json` and
> re-run the seed. It falls back to a built-in `@demo.gyftr.net` cast, so a fresh
> clone still works without any real data.

---

## The walkthrough

This is the full lifecycle. It demonstrates the product's actual point:
**controlled delegation with executive accountability.**

### 1 · CEO creates a task

Sign in as the EA → **Create task**.

| Field | Value |
|---|---|
| Title | Prepare Q4 Growth Strategy |
| Description | Consolidated growth plan for the Q4 board review. |
| Priority | High |
| Expected date | 20 Sep 2026 |
| Assign to | any three stakeholders — e.g. Marketing, Product and Business |

The task appears on the Kanban as **three separate cards** — one per assignee.
That is the multi-assignment model, visible immediately.

### 2 · Marketing sees only their own work

Sign out, sign in as one of the assignees you picked.

Notice what is *absent*: no Stakeholders, Proposed Date, Re-opened or Archive nav;
no Create task button; no stakeholder filter. The board shows their assignment
only — **not** Saurabh's or Neha's, and not their statuses or promised dates.

Open the task → **Progress** → propose a **Promised date** of `18 Sep 2026`.
It reads *awaiting confirmation*. Nothing is locked yet.

> Try to skip ahead: the only control offered is **Move to In Progress**. There
> is no path to Done, and the API refuses one — see `npm run test:security`.

### 3 · CEO confirms the promise

Back as the CEO, open the task → **Progress**.

All three assignees are listed with independent statuses and promised dates.
Click **Confirm & lock** on their proposal.

It becomes `18 Sep 2026 · confirmed` with a lock. they can no longer change it —
attempting to raises *"This Promised Date has been confirmed and locked."*

### 4 · Marketing works the task forward

As that person, move the card one stage at a time:

**To-Do → In Progress → Under Review → Done**

Each step is a single button. There is no way to jump.

Meanwhile the other two assignees are untouched — the executive board shows the task
partially complete. **A task is only complete when every assignee is done.**

### 5 · CEO sends it back

As the CEO, open their assignment → **Reopen**.

Status becomes **Re-opened**. The Re-opened column appears on the board (it is
not a permanent column — it exists only while something occupies it), and the
task now shows in the **Re-opened** view, grouped by stakeholder.

### 6 · Marketing reworks it

As that person, the card sits in Re-opened. The only move offered is **Move to In
Progress** — rework rejoins the workflow, it does not shortcut to Done.

Walk it forward again: **Re-opened → In Progress → Under Review → Done**.

### 7 · CEO reads the whole history

As the CEO, open the task → **Activity**.

The complete lifecycle, append-only, with actor, role and timestamp:

```
task created
stakeholder added          the assignee
stakeholder added          Saurabh
stakeholder added          Neha
promised date proposed     → 18 Sep 2026
promised date confirmed    18 Sep 2026, by CEO
status changed             todo → in_progress
status changed             in_progress → under_review
status changed             under_review → done
task reopened              done → reopened
status changed             reopened → in_progress
...
```

This tab is invisible to stakeholders, and nobody — CEO included — can edit or
clear it.

---

## CR-01 additions (24 Aug 2026)

Six changes shipped after launch. The ones worth demonstrating:

**A stakeholder raising their own work.** Sign in as any stakeholder — there is
now a **New task** button. The form has *no assignee picker at all*: a self-raised
task can only ever land on their own board. Notice the summary is optional now,
and the date is labelled **Due date**, not Expected date — the creator owns it,
so there is no propose-then-confirm step.

Three already exist in the seed, so you can see this without creating one:
**Draft my Q4 team plan**, **Vendor renewal shortlist** (deliberately with no
summary) and **Refresh onboarding checklist** — each raised by a different
stakeholder. Search for them, or look for the *Self-created* tag on the board.

Sign in as the **EA** and find one: it carries a **Self-created** tag on the card,
and *"Self-created by [Name]"* in the drawer — so Anushka can tell at a glance
what she assigned versus what people raised themselves. She keeps full edit,
archive and delete rights over it.

**Archive vs Delete.** The drawer offers both. *Withdraw* (or *Archive*, for the
EA) is reversible — it leaves the boards and can be restored. *Delete* is
permanent: it destroys the task, its assignments, comments and attachments, and
the confirmation says so. A stakeholder can only delete a task they raised
themselves; the EA/CEO can delete any. Either way the **activity log keeps a
record of the deletion** — open any task's Activity tab and you will see
`permanently deleted` entries with the title and who did it, even though the task
itself is gone. Delete is also available per-row in the **Archive** view.

**Search in "Assign to".** As EA/CEO → Create task → type `legal` in the assignee
search. Fifteen stakeholders narrow to two. It matches **title as well as name**,
so you can find the Head of Legal without knowing they are called Nitin.

**Created-date filter.** On the Kanban, the date range now filters by *when a task
was raised*, not when it is due — "show me everything raised between 1 and 15
Aug". It is on each stakeholder's own board too.

**The due-date tiles still work.** Overdue / Due today / Next 7 days were
deliberately left alone by the filter swap. Click **Overdue** on the Overview: the
board opens showing exactly that many cards, with a removable **Overdue** chip so
you can see why it is filtered.

**Stakeholder View.** On the Overview, switch to the **By stakeholder** tab: every
stakeholder as a workload card (active / overdue / reopened / done). Click one to
open their whole board in place, including anything they raised themselves.

---

## CR-02 additions (25 Aug 2026)

**Proposed Date queue.** As the EA/CEO, open **Proposed Date** — every promised
date awaiting a decision, longest wait first. Proposals later than the expected
date are called out in amber, which is the case the queue exists to catch.

*Confirm & lock* fixes the date. *Reject* requires a reason, and the button stays
disabled until you write one — that rule is enforced by the database, not just
the form. The reason is posted into the task's comment thread, so it is permanent
and the stakeholder can see it. The item then leaves the queue and returns only
when a new date is proposed.

**Notifications.** The bell in the header, scoped to the promised-date workflow
only — nothing for comments, edits or column moves. Reject a date as the EA, then
sign in as that stakeholder: the bell shows an unread badge, and the item carries
the rejection reason in quotes. Opening the panel marks them read.

**Saved Views is gone.** Withdrawn by CR-02 #1, along with the underlying
custom-filter builder. The board's own filter bar (from CR-01) is unaffected.

---

## Other things worth showing

**Dashboard drill-through.** On the executive Overview, every metric is a link.
Click **Overdue**, **Due today**, **Next 7 days** or **Follow-ups due** and the
board opens pre-filtered. Click any row in **Stakeholder overview** to filter the
board to that person.

**Inviting a stakeholder.** Stakeholders → *Invite Stakeholder* (Name, Email,
Designation). With SMTP configured they get an email link; without it the modal
hands you a temporary password instead and says why. Either way, signing in as
that person holds them on **Set a new password** before the board.

**Archive.** Archive a task from its drawer; find it under Archive; restore it.
Nothing is ever destroyed — a `DELETE` against `tasks` is refused even for the CEO.

**Attachments.** Open any task → Attachments. Executives can add files
(PDF/DOCX/XLSX/PNG/JPG, 10 MB each); everyone assigned can open them. Files live
in a private bucket and open through a 60-second signed URL, so a copied link
goes stale.

---

## Proving the boundaries

The interesting claims are not visual. To see them enforced at the server:

```bash
npm run test:security
```

41 tests that sign in as real users with the anon key — the same surface a
browser has — and assert the database refuses. Skipping a stage, moving
backward, touching a co-assignee's assignment, reading another person's comment
thread, editing a comment, clearing the audit log, minting a signed URL for
someone else's attachment, routing a self-raised task onto another person's
board: all refused, with no help from the UI.
