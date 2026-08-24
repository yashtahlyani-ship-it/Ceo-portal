# GyFTR CEO Office — Task Platform

An internal task-management platform for the CEO's Office. It answers, at a glance:
**what has the CEO asked for, who owns it, what did they promise, what is overdue,
and what has been sent back for rework?**

This is a sibling product to the **GyFTR Marketing Portal** (`../gyftr-portal`). It
reuses that portal's design system verbatim — same fonts, same palette, same
`gx-` component classes, same header shell, same logo — while implementing an
information architecture and workflow built for executive delegation rather than
creative production.

**Live:** https://gyftr-ceo-portal.vercel.app

---

## What it does

| Capability | Behaviour |
|---|---|
| **Roles** | Super Admin = Executive Assistant, Admin = CEO, Stakeholder = Department Head |
| **No public signup** | Only the EA/CEO create accounts; new people set their own password at first sign-in |
| **Multi-stakeholder tasks** | One task, many assignees — each with an *independent* status, promised date and comment thread |
| **Forward-only workflow** | A stakeholder moves To-Do → In Progress → Under Review → Done, one step at a time |
| **Executive override** | EA/CEO move any assignment to any status; every override is audited |
| **Reopening** | Only EA/CEO reopen a Done assignment; the stakeholder must then walk the path again |
| **Promised dates** | Stakeholder proposes → executive confirms → the date locks |
| **Immutable audit** | Every mutation is recorded append-only, readable by EA/CEO only |
| **Archive & delete** | Archive is reversible and the default; permanent delete is available to EA/CEO on any task, and to a stakeholder on one they raised. Deletion is always recorded in the audit trail |
| **Stakeholder-raised tasks** | A stakeholder can raise a task for themselves only; the CEO's Office sees it tagged as self-created |
| **Saved views** | Executives save reusable filtered slices of the board |
| **Stakeholder view** | A dashboard tab that browses workload person by person |
| **Private attachments** | PDF/DOCX/XLSX/PNG/JPG in a private bucket, reachable only via short-lived signed URLs |

Notifications are deliberately **out of scope for v1** — the dashboard is the
monitoring mechanism. See [ARCHITECTURE.md](ARCHITECTURE.md) for the note on
adding them later.

---

## Stack

Chosen to match the existing internal ecosystem rather than by preference:

- **React 19 + Vite 8** — same as the Marketing Portal frontend
- **lucide-react** icons — same library, same version
  (the Marketing Portal also uses Recharts; this product renders no charts, so
  the dependency is not carried. Add it back if a chart view lands.)
- **Supabase** (Postgres + Auth + Storage + Edge Functions) for the backend

> **Why Supabase and not the Marketing Portal's Express + Cognito backend?**
> See [PROJECT_PLAN.md](PROJECT_PLAN.md#stack-decision) — this is the one place
> the two products deliberately diverge, and the reasoning is recorded there.

---

## Running locally

```bash
npm install
cp .env.example .env          # fill in from Supabase → Project Settings → API
npm run dev                    # http://localhost:5173
```

### Environment variables

| Variable | Where | Purpose |
|---|---|---|
| `VITE_SUPABASE_URL` | `.env.local` (browser) | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | `.env.local` (browser) | Anon key. Safe to expose — **security is enforced by RLS, never by hiding this key** |
| `SUPABASE_SERVICE_ROLE_KEY` | `.env` (server only) | Bypasses RLS. Used **only** by `scripts/` and the integration tests. Never ships to the browser |

Both files are gitignored.

### First-time database setup

Run the migrations in order against your Supabase project (SQL Editor, or the
Management API):

```
supabase/01_schema.sql      tables, enums, indexes
supabase/02_functions.sql   business logic, RPCs, audit triggers
supabase/03_policies.sql    row-level security
supabase/04_storage.sql     private attachment bucket + its policies
supabase/05_cr01.sql        CR-01: stakeholder-raised tasks (see CHANGELOG)
supabase/06_cr01_delete.sql CR-01: permanent delete
```

Then deploy the Edge Function that lets the EA/CEO add stakeholders from inside
the app without the service-role key ever reaching a browser:

```bash
supabase functions deploy create-stakeholder
```

### Demo data

```bash
cd scripts && npm install && npm run seed
```

Creates 1 EA, 1 CEO, 15 stakeholders and ~72 tasks with realistic spread —
overdue work, follow-ups, reopened items, promised dates in every state,
multi-assignee tasks, comments and attachment metadata. All synthetic; no real
employee data. See [DEMO.md](DEMO.md) for logins and the walkthrough.

---

## Commands

```bash
npm run dev             # dev server
npm run build           # production build
npm run preview         # serve the production build
npm run lint            # eslint
npm test                # all tests (unit + live integration)
npm run test:unit       # pure logic only, no network
npm run test:security   # permission/workflow tests against the real database
npm run seed            # demo data
```

`npm test` runs **61 tests**: 23 unit tests over the pure rules, and 38
integration tests that sign in as real users with the anon key and assert that
the *server* refuses what it should. See [SECURITY.md](SECURITY.md).

---

## Adding a stakeholder

Two ways, both server-authorised:

1. **In the app** — Stakeholders → *Add Stakeholder*. Calls the
   `create-stakeholder` Edge Function, which verifies the caller is EA/CEO before
   creating anything. A temporary password is shown once.
2. **From the CLI** —
   `cd scripts && node create-stakeholder.mjs "Priya Nair" priya@gyftr.net "Head of Product"`

Either way the account is stamped `must_set_password`, so the person chooses
their own password at first sign-in. Nothing hard-codes the number of
stakeholders.

---

## Deployment

Hosted on Vercel, built from `vercel.json` (SPA rewrites plus a small set of
security headers). Environment variables are set for Production, Preview and
Development.

```bash
vercel deploy --prod
```

---

## Documentation

| File | Contents |
|---|---|
| [CHANGELOG.md](CHANGELOG.md) | What changed and when — CR-01 onwards |
| **[HANDOVER.md](HANDOVER.md)** | **Start here if you are new** — setup, operations, known state, traps |
| [PROJECT_PLAN.md](PROJECT_PLAN.md) | What existed, what was built, decisions, risks, testing strategy |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Frontend, backend, auth, storage, where business logic lives |
| [DATABASE.md](DATABASE.md) | Entities, relationships, indexes, RLS |
| [SECURITY.md](SECURITY.md) | Authorization model, data isolation, attachment security, audit integrity |
| [DEMO.md](DEMO.md) | Demo accounts and the end-to-end walkthrough |
