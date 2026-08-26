# Deploying the CEO Office Portal

Release runbook. For first-time AWS provisioning see
[`infra/aws-setup.md`](infra/aws-setup.md); for architecture and access levels
see [`HANDOVER.md`](HANDOVER.md).

---

## Read this first — the shape of the system

The three portals now share a repository shape, a design system, a base image,
a CodeBuild pattern **and an architecture.**

| | Marketing | Legal | **CEO Office** |
|---|---|---|---|
| Frontend container | ✅ port 7867 | ✅ port 7979 | ✅ **port 7868** |
| Backend container | ✅ Express, 7878 | ✅ Express, 7978 | ✅ **Express, 7869** |
| Database | RDS Postgres | RDS Postgres | **RDS Postgres** |
| Auth | AWS Cognito | AWS Cognito | **AWS Cognito** |
| File storage | — | S3 | **S3** |

**Two images to build, two services to run.** If you worked on this repository
before August 2026 you may remember a single container and a Supabase
dependency — that is gone. There is no Supabase project, no Vercel deployment
and no service-role key anywhere in this system.

### The one way this differs from its siblings

Marketing and Legal enforce authorization in Express middleware. **This one
enforces it in Postgres Row-Level Security**, and the backend's job is to bind
a verified identity to each transaction rather than to decide anything itself.

That is not a leftover from Supabase — RLS is a PostgreSQL feature and it moved
across untouched. It was kept because this product's central requirement is
that one stakeholder can never see a co-assignee's status, promised date or
comments. Expressed as a row predicate, that holds on every query path,
including ones nobody has written yet.

What it means in practice, for anyone adding an endpoint:

```js
// Correct. RLS decides what comes back.
const tasks = await withUser(req.profile.id, c => c.query('select * from tasks'));

// WRONG. Runs as the table owner and bypasses every policy in the schema.
const tasks = await query('select * from tasks');
```

`npm run test:unit` fails the build if a route reaches for the second one. See
[`tests/routes.test.mjs`](tests/routes.test.mjs), and
[`backend/sql/00_compat.sql`](backend/sql/00_compat.sql) for how it works.

---

## What each image needs, and when

### Frontend — build time

Vite **compiles these into the JavaScript bundle**. They must be passed as
`--build-arg` / CodeBuild environment variables. Setting them on the running
task does nothing; the bundle is already built.

| Variable | Example |
|---|---|
| `VITE_API_URL` | `https://ceo-api.gyftr.net` |
| `VITE_COGNITO_USER_POOL_ID` | `ap-south-1_XXXXXXXXX` |
| `VITE_COGNITO_CLIENT_ID` | the app client id — **created without a secret** |

> All three are **public by design**: an address and two identifiers. They ship
> in a file every visitor downloads and grant nothing on their own. Security is
> the Cognito signature check on every request and the RLS policies behind it.
>
> The app client for the browser **must have no client secret**. A browser
> cannot keep one, and `amazon-cognito-identity-js` will not authenticate
> against a client that has one. Both the buildspec and CI grep `dist/` for
> `CLIENT_SECRET`, AWS keys and database passwords, and fail the build.

The build **fails fast** if any of the three is missing, rather than shipping an
app that loads and then cannot sign anybody in.

### Backend — run time

The backend takes **all** of its configuration at runtime, so the image is
environment-agnostic: the same artifact runs in UAT and production.

| Variable | Notes |
|---|---|
| `AWS_SECRET_NAME` | **preferred.** Secrets Manager id, e.g. `gyftr/ceo/db` |
| `DB_HOST` / `DB_PORT` / `DB_NAME` / `DB_USER` / `DB_PASSWORD` | used only when `AWS_SECRET_NAME` is unset |
| `COGNITO_USER_POOL_ID` / `COGNITO_CLIENT_ID` / `COGNITO_REGION` | required — the process exits at boot without the first two |
| `ATTACHMENTS_BUCKET` | private S3 bucket |
| `FRONTEND_URL` | the CORS allow-list. Never `*` |
| `NODE_ENV=production` | enables TLS to RDS |

Prefer `AWS_SECRET_NAME`: a password in a task definition is readable by anyone
holding `ecs:DescribeTaskDefinition`.

---

## 1. Build and deploy

Two CodeBuild projects, same pattern as the siblings:

| | Buildspec | Project variables |
|---|---|---|
| Frontend | `frontend/buildspec.yml` | `FRONTEND_IMAGE_REPO_NAME`, `FRONTEND_ECS_CONTAINER`, the three `VITE_*` |
| Backend | `backend/buildspec.yml` | `BACKEND_IMAGE_REPO_NAME`, `BACKEND_ECS_CONTAINER` |

Both must be **ARM / Graviton** and **privileged**. Each writes
`imagedefinitions.json` for its ECS deploy stage.

Locally, the whole stack including a throwaway Postgres:

```bash
cp .env.example .env       # fill in the Cognito values
docker compose up --build  # → frontend :7868, backend :7869, postgres :5442
```

Health checks: `GET /` on 7868, `GET /health` on 7869.

---

## 2. Database

**There is no migration step.** `backend/db.js` applies `backend/sql/*.sql` in
filename order on every boot. Every statement is idempotent, so this is a no-op
against an already-current database — deploying is just a restart, and nobody
has to remember to run `psql`.

```
backend/sql/00_compat.sql      auth.uid() + the `authenticated` role  ← run first
backend/sql/01_schema.sql      tables, enums, indexes
backend/sql/02_functions.sql   business logic, RPCs, audit triggers
backend/sql/03_policies.sql    row-level security
backend/sql/05_cr01.sql        CR-01: stakeholder-raised tasks
backend/sql/06_cr01_delete.sql CR-01: permanent delete
backend/sql/07_cr02.sql        CR-02: promised-date approval, notifications
backend/sql/08_grants.sql      privileges for `authenticated`  ← run last
```

**Order is load-bearing.** `00_compat` defines the identity function and the
role that everything after it references; `08_grants` needs every table to
exist. CI checks the numbering is unique so two people cannot both add an `09_`,
and applies every file **twice** against a scratch database to prove the
idempotence this design depends on.

> There is no `04_`. That file created the Supabase Storage bucket and its
> policies; S3 replaced it. The gap is deliberate — renumbering would have
> changed the reviewed filenames of everything after it.

### The database user

The account the backend connects as must be able to `SET ROLE authenticated`.
`00_compat.sql` grants that to whoever applies it, which is the same account, so
this normally takes care of itself. If you later point the backend at a
*different* user from the one that ran the migrations, grant it explicitly:

```sql
grant authenticated to <the_backend_user>;
```

Without it, every request fails with a permission error on `SET ROLE`.

---

## 3. Cognito

Two things to get right, and both have a failure mode that looks like something
else:

1. **The app client must have no client secret.** With one, sign-in fails with
   an opaque `NotAuthorizedException` that looks like a wrong password.
2. **Email delivery must be configured** (SES out of the sandbox, or the pool's
   built-in sender) before onboarding real people. Without it, invitations do
   not arrive.

The app degrades honestly rather than silently: when the invitation cannot be
sent, `POST /api/admin/stakeholders` creates the account with a temporary
password and tells the EA exactly why, instead of claiming an email went out.
But that means passwords are handed over by hand.

New accounts are created in `FORCE_CHANGE_PASSWORD`, so the temporary value is
single-use and everyone picks their own password before reaching the board.
**This gate is in the token issuer, not the app** — there is no session at all
until the password is set, which is a real improvement on what it replaced.

---

## 4. Data

```bash
cd scripts && npm install

npm run seed        # demo/UAT data — RESETS tasks and the seeded accounts
node onboard.mjs    # dry run against scripts/roster.json — shows, changes nothing
node onboard.mjs --apply
```

`seed` is destructive by design and is for demo/UAT only. `onboard` never
touches tasks and never resets an existing person's password, so it is the safe
one to run against a database that already holds real work.

`scripts/roster.json` is **gitignored** — this repository is public, and a
directory of working corporate addresses is what gets scraped for phishing. See
`scripts/roster.example.json`.

---

## 5. Verify a release

```bash
npm run test:unit       # 28 tests — no database needed, runs in CI on every push
npm run test:security   # 41 tests against a REAL database, through the RLS path
npm run test:api        # Cognito, S3 and onboarding against a DEPLOYED stack
```

`test:security` runs every statement through `set local role authenticated` with
`app.user_id` set — byte for byte what `withUser()` does in production. A pass
means the **server** refused, not that a button was hidden. Run it against UAT
after any change to the policies, the RPCs or the migrations.

`test:api` needs a reachable API, Cognito pool and bucket, and **skips itself**
when those are not configured. It covers the four things the database suite
cannot: sign-in, forged tokens, the invite flow, and the attachment byte round
trip — including that a non-assignee is refused a download URL, which is the one
guarantee that left the database when Supabase Storage became S3.

Then in a browser:

- [ ] Sign in as the EA; the dashboard loads with data
- [ ] Sign in as a stakeholder; they see only their own assignments
- [ ] A brand-new account is forced to set a password before reaching the board
- [ ] A deep link (`/#task/123`) opens the drawer after a hard refresh — this is
      what proves `serve -s` is rewriting correctly
- [ ] The header is not clipped at 1280px wide (HANDOVER §9)

---

## Rollback

Images are immutable and tagged `v1.$CODEBUILD_BUILD_NUMBER`. Roll back by
pointing the ECS service at the previous task definition revision — no rebuild.

**Roll the two services back together.** They are versioned independently but
released as a pair, and a frontend expecting an endpoint an older backend does
not serve will fail in ways that look like a data problem.

**Database migrations do not roll back.** They are additive and idempotent, but
`07_cr02.sql` drops the `saved_views` table and `06_cr01_delete.sql` introduces
permanent deletion. To revert past those, restore from an RDS snapshot rather
than trying to undo them by hand.

Note that rolling the backend image back also rolls `backend/sql/` back, and the
old image re-applies its own migrations on boot. That is safe for additive
changes and is **not** safe for a change that dropped something. Take a snapshot
before any release that touches `backend/sql/`.
