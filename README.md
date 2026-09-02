# GyFTR CEO Office — Task Platform

An internal task-management platform for the CEO's Office. It answers, at a glance:
**what has the CEO asked for, who owns it, what did they promise, what is overdue,
and what has been sent back for rework?**

This is a sibling product to the **GyFTR Marketing Portal** (`../gyftr-portal`). It
reuses that portal's design system verbatim — same fonts, same palette, same
`gx-` component classes, same header shell, same logo — while implementing an
information architecture and workflow built for executive delegation rather than
creative production.

**Live:** https://ceo.gyftr.net · **API:** https://ceo-api.gyftr.net

> **August 2026 — this platform moved to AWS.** Supabase and Vercel are gone;
> it now runs on ECS, RDS, Cognito and S3 alongside the Marketing and Legal
> portals. See [the migration note](#the-aws-migration) below.

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
| **Stakeholder view** | A dashboard tab that browses workload person by person |
| **Proposed Date queue** | One screen for the EA/CEO to confirm-and-lock or reject-with-reason every proposed date |
| **Notifications** | In-app, scoped to the promised-date workflow only |
| **Invite-based onboarding** | Name, email and designation; an email invite link, with a temporary-password fallback |
| **Private attachments** | PDF/DOCX/XLSX/PNG/JPG in a private bucket, reachable only via short-lived signed URLs |

Notifications exist only for the promised-date workflow (CR-02 #5) — not task
edits, comments or column moves. The dashboard remains the monitoring mechanism
for everything else.

---

## Repository layout

Laid out like the Marketing (`../gyftr-portal`) and Legal (`../gyftr-legal`)
portals, so anyone who has worked on those can navigate this without a tour.

```
frontend/          React + Vite app, its Dockerfile and CodeBuild buildspec
backend/           Express API, its Dockerfile and buildspec
backend/sql/       the data layer — schema, RLS policies, RPCs, audit triggers
scripts/           admin scripts: seed, onboard, invite, force-password-reset
tests/             unit, route-safety, database and API integration tests
infra/             first-time AWS provisioning
.github/workflows/ CI
docker-compose.yml frontend + backend + a local Postgres
```

---

## The AWS migration

Until August 2026 this product used Supabase for its data layer and deployed to
Vercel — the one deliberate divergence in the portal family. It now matches its
siblings: ECS Fargate, RDS Postgres, Cognito, S3.

**One thing did not converge, and it was kept on purpose.** Marketing and Legal
enforce authorization in Express middleware. This product enforces it in
PostgreSQL **Row-Level Security**, because its central requirement is that one
stakeholder can never see a co-assignee's status, promised date or comments.
Expressed as a row predicate, that holds on every query path — including ones
nobody has written yet.

RLS is a PostgreSQL feature, not a Supabase one, so it moved across untouched:
the same 19 policies, the same 25 functions, the same 41 security tests. What
had to be recreated was the two Supabase-specific things they lean on —
`auth.uid()` and the `authenticated` role — and that is what
[`backend/sql/00_compat.sql`](backend/sql/00_compat.sql) does, in about thirty
lines. It is the best-commented file in the repository and the right place to
start reading.

The practical rule for anyone adding an endpoint:

```js
// Correct — RLS decides what comes back.
await withUser(req.profile.id, c => c.query('select * from tasks'));

// WRONG — runs as the table owner and bypasses every policy in the schema.
await query('select * from tasks');
```

`npm run test:unit` fails if a route does the second one.

---

## Stack

Chosen to match the existing internal ecosystem rather than by preference:

- **React 19 + Vite 8** — same as the Marketing Portal frontend
- **lucide-react** icons — same library, same version
  (the Marketing Portal also uses Recharts; this product renders no charts, so
  the dependency is not carried. Add it back if a chart view lands.)
- **Express + pg** on ECS Fargate (arm64) — same shape as both siblings
- **RDS PostgreSQL 16**, **AWS Cognito**, **private S3 bucket**

---

## Running locally

The whole stack, including a throwaway Postgres, exactly as it ships:

```bash
cp .env.example .env          # fill in the Cognito values
docker compose up --build     # frontend :7868 · backend :7869 · postgres :5442
```

Or the frontend alone against a running API:

```bash
npm run install:all
cp frontend/.env.example frontend/.env.local
npm run dev:frontend          # http://localhost:5173
```

### Environment variables

| Variable | Where | Purpose |
|---|---|---|
| `VITE_API_URL` | frontend build | Where the browser sends requests |
| `VITE_COGNITO_USER_POOL_ID` | frontend build | Which pool to authenticate against |
| `VITE_COGNITO_CLIENT_ID` | frontend build | App client — **must have no client secret** |
| `AWS_SECRET_NAME` *or* `DB_*` | backend runtime | Database credentials |
| `COGNITO_USER_POOL_ID` / `COGNITO_CLIENT_ID` | backend runtime | Token verification |
| `ATTACHMENTS_BUCKET` | backend runtime | Private S3 bucket |
| `FRONTEND_URL` | backend runtime | CORS allow-list — never `*` |

The three `VITE_` values are **public by design**: an address and two
identifiers, shipped in a file every visitor downloads. They grant nothing.
Security is the Cognito signature check and the RLS policies behind it. A client
*secret*, an AWS key or a database password must never appear among them — CI
greps the built bundle and fails if one does.

All `.env` files are gitignored.

### First-time database setup

**There isn't one.** `backend/db.js` applies `backend/sql/*.sql` in filename
order on every boot, and every statement is idempotent — so the database builds
itself the first time the backend starts and re-applying is a no-op. Deploying
is just a restart.

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
npm run dev:frontend    # frontend dev server
npm run dev:backend     # API with --watch
npm run build:frontend  # production build
npm run lint            # eslint
npm run docker:up       # the whole stack on :7868 / :7869
npm test                # everything
npm run test:unit       # pure logic + route safety — no database, runs in CI
npm run test:security   # permission/workflow tests against a real database
npm run test:api        # Cognito, S3 and onboarding against a deployed stack
npm run seed            # demo data
```

Admin scripts (`scripts/`, direct Cognito + database access):

```bash
node seed.mjs                     # demo/UAT data — destructive, resets accounts
node onboard.mjs [--apply]        # the real roster; never resets a password
node create-stakeholder.mjs …     # one person
node force-password-reset.mjs     # force everyone to choose a new password
```

The suites, and what each is actually for:

| Suite | Needs | Covers |
|---|---|---|
| `test:unit` | nothing | 23 tests over the pure rules the UI reads, plus 5 **route-safety** tests that fail if a handler bypasses RLS |
| `test:security` | a Postgres database | 41 tests run through the same `set local role authenticated` path a live request takes — a pass means the **server** refused |
| `test:api` | a deployed stack | sign-in, forged tokens, the invite flow, and the attachment byte round trip. **Skips itself** when not configured |

See [SECURITY.md](SECURITY.md).

---

## Adding a stakeholder

Two ways, both server-authorised:

1. **In the app** — Stakeholders → *Invite Stakeholder*. Calls
   `POST /api/admin/stakeholders`, which checks the caller is EA/CEO before
   creating anything, and whose profile write is independently refused by RLS
   for anyone else.
2. **From the CLI** —
   `cd scripts && node create-stakeholder.mjs "Priya Nair" priya@gyftr.net "Head of Product"`

Either way the Cognito account is created in `FORCE_CHANGE_PASSWORD`, so the
person chooses their own password before reaching the board. **That gate is in
the token issuer, not the app** — there is no session at all until the password
is set, so a client that forgets to render the screen has nothing to render the
board with either. Nothing hard-codes the number of stakeholders.

---

## Deployment

Two ECS Fargate services behind an ALB, built by two CodeBuild projects. See
[DEPLOY.md](DEPLOY.md) for the runbook and
[infra/aws-setup.md](infra/aws-setup.md) for first-time provisioning.

---

## Documentation

| File | Contents |
|---|---|
| **[DEPLOY.md](DEPLOY.md)** | **Release runbook** — what AWS needs and how this differs from the siblings |
| [infra/aws-setup.md](infra/aws-setup.md) | First-time AWS provisioning |
| [CHANGELOG.md](CHANGELOG.md) | What changed and when — CR-01 onwards |
| **[HANDOVER.md](HANDOVER.md)** | **Start here if you are new** — setup, operations, known state, traps |
| [PROJECT_PLAN.md](PROJECT_PLAN.md) | What existed, what was built, decisions, risks, testing strategy |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Frontend, backend, auth, storage, where business logic lives |
| [DATABASE.md](DATABASE.md) | Entities, relationships, indexes, RLS |
| [SECURITY.md](SECURITY.md) | Authorization model, data isolation, attachment security, audit integrity |
| [DEMO.md](DEMO.md) | Demo accounts and the end-to-end walkthrough |
