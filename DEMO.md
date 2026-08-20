# Demo

**Live:** https://gyftr-ceo-portal.vercel.app
**Local:** `npm run dev`

---

## Accounts

Every account below signs in with:

> **`Default@123`**

> ⚠️ **MVP demo credential — change it before this tool carries real work.**
> This repository is public and the deployment is publicly reachable, so this
> password is effectively an open door to the demo data. It exists so the team
> can evaluate the product without friction, nothing more. Before real use:
> delete these `@demo.gyftr.net` accounts entirely and create real ones through
> the app (each person then sets their own password at first sign-in).

The value lives in `DEMO_PASSWORD` in `.env` (gitignored) — that is what
`npm run seed` applies to every account and what the integration tests sign in
with. To change it everywhere: edit `.env`, then `npm run seed`.

> **Names are real, credentials are throwaway.** The directory uses real names
> and titles drawn from the sibling Gyftr portals (Marketing, Tech, Legal) so it
> mirrors the actual organisation. Login emails are on `@demo.gyftr.net` — NOT
> real corporate mailboxes — because every account shares one password. Remove
> these accounts entirely before the tool carries real work.

| Role | Name | Email |
|---|---|---|
| **Executive Assistant** (Super Admin) | Anushka Mishra | `ea@demo.gyftr.net` |
| **CEO** (Admin) | Chief Executive | `ceo@demo.gyftr.net` |

Stakeholders (15) — login is `<first>.<last>@demo.gyftr.net` (single-name people
use just the first name, e.g. `rajneesh@demo.gyftr.net`):

| Name | Title | Email |
|---|---|---|
| Neha | Head of Business | `neha@demo.gyftr.net` |
| Saurabh | Head of Product | `saurabh@demo.gyftr.net` |
| Rajneesh | Chief Technology Officer | `rajneesh@demo.gyftr.net` |
| Anandita | Head of Technology Delivery | `anandita@demo.gyftr.net` |
| Karan | Head of Quality | `karan@demo.gyftr.net` |
| Deepankar Hemnani | Head of Content | `deepankar.hemnani@demo.gyftr.net` |
| Ajay Kumar | Head of Creative | `ajay.kumar@demo.gyftr.net` |
| Nitin | Head of Legal | `nitin@demo.gyftr.net` |
| Nikhil | Head of Compliance | `nikhil@demo.gyftr.net` |
| Nikunj Kanodia | Head of Finance | `nikunj.kanodia@demo.gyftr.net` |
| Anirudh Motwani | Head of Strategy | `anirudh.motwani@demo.gyftr.net` |
| Rahul Joshi | Head of Partnerships | `rahul.joshi@demo.gyftr.net` |
| Priya Sharma | Head of Marketing | `priya.sharma@demo.gyftr.net` |
| Kushagra | Head of Legal Operations | `kushagra@demo.gyftr.net` |
| Pankaj Mehta | Head of Operations | `pankaj.mehta@demo.gyftr.net` |

The seed creates ~64 tasks with a deliberate spread — overdue, due today, due
this week, follow-ups due, reopened work, promised dates in all three states,
multi-assignee tasks and comment threads — plus four starter saved views — so the
dashboard is alive on first load. Re-running `npm run seed` resets cleanly.

---

## The walkthrough

This is the full lifecycle. It demonstrates the product's actual point:
**controlled delegation with executive accountability.**

### 1 · CEO creates a task

Sign in as `ceo@demo.gyftr.net` → **Create task**.

| Field | Value |
|---|---|
| Title | Prepare Q4 Growth Strategy |
| Description | Consolidated growth plan for the Q4 board review. |
| Priority | High |
| Expected date | 20 Sep 2026 |
| Assign to | Priya Sharma (Marketing), Saurabh (Product), Neha (Business) |

The task appears on the Kanban as **three separate cards** — one per assignee.
That is the multi-assignment model, visible immediately.

### 2 · Marketing sees only their own work

Sign out, sign in as `priya.sharma@demo.gyftr.net`.

Notice what is *absent*: no Stakeholders, Saved Views, Re-opened or Archive nav;
no Create task button; no stakeholder filter. The board shows Priya's assignment
only — **not** Saurabh's or Neha's, and not their statuses or promised dates.

Open the task → **Progress** → propose a **Promised date** of `18 Sep 2026`.
It reads *awaiting confirmation*. Nothing is locked yet.

> Try to skip ahead: the only control offered is **Move to In Progress**. There
> is no path to Done, and the API refuses one — see `npm run test:security`.

### 3 · CEO confirms the promise

Back as the CEO, open the task → **Progress**.

All three assignees are listed with independent statuses and promised dates.
Click **Confirm & lock** on Priya's proposal.

It becomes `18 Sep 2026 · confirmed` with a lock. Priya can no longer change it —
attempting to raises *"This Promised Date has been confirmed and locked."*

### 4 · Marketing works the task forward

As Priya, move the card one stage at a time:

**To-Do → In Progress → Under Review → Done**

Each step is a single button. There is no way to jump.

Meanwhile Saurabh and Neha are untouched — the executive board shows the task
partially complete. **A task is only complete when every assignee is done.**

### 5 · CEO sends it back

As the CEO, open Priya's assignment → **Reopen**.

Status becomes **Re-opened**. The Re-opened column appears on the board (it is
not a permanent column — it exists only while something occupies it), and the
task now shows in the **Re-opened** view, grouped by stakeholder.

### 6 · Marketing reworks it

As Priya, the card sits in Re-opened. The only move offered is **Move to In
Progress** — rework rejoins the workflow, it does not shortcut to Done.

Walk it forward again: **Re-opened → In Progress → Under Review → Done**.

### 7 · CEO reads the whole history

As the CEO, open the task → **Activity**.

The complete lifecycle, append-only, with actor, role and timestamp:

```
task created
stakeholder added          Priya Sharma
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

## Other things worth showing

**Dashboard drill-through.** On the executive Overview, every metric is a link.
Click **Overdue**, **Due today**, **Next 7 days** or **Follow-ups due** and the
board opens pre-filtered. Click any row in **Stakeholder overview** to filter the
board to that person.

**Saved Views.** Four starter views ship with the seed — *Executive Priorities*,
*Overdue Tasks*, *Due This Week*, *Today's Follow-ups*. They are private to their
owner: the EA cannot see the CEO's views. Create, rename and delete are all
inline.

**Adding a stakeholder.** Stakeholders → *Add Stakeholder*. A temporary password
is shown once. Sign in as that person and the app holds them on **Set a new
password** before letting them anywhere near the board.

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

26 tests that sign in as real users with the anon key — the same surface a
browser has — and assert the database refuses. Skipping a stage, moving
backward, touching a co-assignee's assignment, reading another person's comment
thread, editing a comment, clearing the audit log, minting a signed URL for
someone else's attachment: all refused, with no help from the UI.
