# Deploying the CEO Office Portal

Release runbook. For first-time AWS provisioning see
[`infra/aws-setup.md`](infra/aws-setup.md); for architecture and access levels
see [`HANDOVER.md`](HANDOVER.md).

---

## Read this first — how this differs from Marketing and Legal

The three portals share a repository shape, a design system, a base image and a
CodeBuild pattern. They **do not** share a backend.

| | Marketing | Legal | **CEO Office** |
|---|---|---|---|
| Frontend container | ✅ port 7867 | ✅ port 7979 | ✅ **port 7868** |
| Backend container | ✅ Express, 7878 | ✅ Express, 7978 | ❌ **none** |
| Database | self-managed Postgres | self-managed Postgres | **Supabase (managed)** |
| Auth | AWS Cognito | AWS Cognito | **Supabase Auth** |
| File storage | — | S3 | **Supabase Storage** |

**There is one image to build and one service to run.** If you are looking for
`backend/`, `server.js` or a second ECS task definition, they do not exist and
nothing is missing. The API, authorisation, file storage and the entire
permission model live inside Postgres on Supabase — see
[`ARCHITECTURE.md`](ARCHITECTURE.md) and
[`PROJECT_PLAN.md`](PROJECT_PLAN.md#stack-decision) for why.

The practical consequence for AWS: **the app depends on a service outside your
VPC.** The browser talks to Supabase directly over HTTPS; the container never
does. So the container needs no database credentials, no security-group rule to
a database, and no secrets at runtime at all.

---

## What the frontend needs, and when

Both values are **baked into the JavaScript bundle at build time** by Vite. They
must be passed as `--build-arg` / CodeBuild environment variables. Setting them
on the running task does nothing — the bundle is already compiled.

| Variable | Value |
|---|---|
| `VITE_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | the project's **anon / publishable** key |

> The anon key is **public by design**. It identifies the project; it grants
> nothing on its own. Every access decision is made by Postgres Row-Level
> Security. Publishing it in a browser bundle is the intended design, not an
> oversight — see [`SECURITY.md`](SECURITY.md).
>
> The **service-role key** is a different thing entirely: it bypasses RLS. It
> must never be given to CodeBuild, never reach the container, and never appear
> in any `VITE_`-prefixed variable. Both the buildspec and CI fail the build if
> they find it in `dist/`.

---

## 1. Frontend

CodeBuild runs [`frontend/buildspec.yml`](frontend/buildspec.yml). It builds the
ARM image, pushes it to ECR and writes `imagedefinitions.json` for the ECS
deploy stage — the same shape as the sibling portals.

Set these on the CodeBuild project:

```
FRONTEND_IMAGE_REPO_NAME    ECR repo, e.g. gyftr-ceo-portal-frontend
FRONTEND_ECS_CONTAINER      container name in the ECS task definition
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

The build **fails fast** if either `VITE_` value is missing, rather than
shipping an app that loads and then cannot reach its database.

Locally, the same image:

```bash
cp .env.example .env       # fill in the two VITE_ values
docker compose up --build  # → http://localhost:7868
```

Health check is `GET /` on 7868. `serve -s` rewrites unknown paths to
`index.html`, which the SPA router needs — without it a refresh on any deep link
returns 404 from the container and the load balancer may mark the task
unhealthy.

---

## 2. Database

Supabase, applied in filename order. They are idempotent (`create or replace`,
`drop policy if exists`, `create table if not exists`), so re-applying is safe —
this was verified end to end.

```
supabase/01_schema.sql      tables, enums, indexes
supabase/02_functions.sql   business logic, RPCs, audit triggers
supabase/03_policies.sql    row-level security
supabase/04_storage.sql     private attachment bucket + policies
supabase/05_cr01.sql        CR-01: stakeholder-raised tasks
supabase/06_cr01_delete.sql CR-01: permanent delete
supabase/07_cr02.sql        CR-02: promised-date approval, notifications
```

Apply via the Supabase SQL editor, or the Management API:

```bash
curl -X POST "https://api.supabase.com/v1/projects/$REF/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary @<(python -c "import json,sys;print(json.dumps({'query':open(sys.argv[1]).read()}))" supabase/01_schema.sql)
```

**Order matters.** Later files depend on helpers defined earlier
(`is_executive()`, `_audit()`, `is_self_created()`). CI checks the numbering is
unique so two people cannot both add an `08_`.

### Edge Function

One function, for stakeholder invites. It exists so the service-role key never
reaches a browser: it verifies the caller's JWT and role server-side first.

```bash
supabase functions deploy create-stakeholder
```

---

## 3. Auth configuration

In **Supabase → Authentication → URL Configuration**, set the site URL and
redirect allow-list to the UAT/production hostname, or invite and
password-reset links will point at the wrong host:

```
Site URL:      https://ceo.gyftr.net
Redirect URLs: https://ceo.gyftr.net, https://ceo.gyftr.net/**
```

### SMTP — required before onboarding real people

**This is currently not configured, and it blocks real onboarding.** Supabase's
built-in sender is capped at roughly 2 emails per hour and only reliably
delivers to team members, so invite emails do not arrive.

The application degrades honestly rather than silently: when the invite cannot
be sent it creates the account with a temporary password and tells the EA
exactly why, instead of claiming an email went out. But that means passwords are
handed over by hand.

Configure SMTP in **Supabase → Authentication → Emails**, then:

```bash
cd scripts && node onboard.mjs --apply
```

Everyone receives an individual invite link and sets their own password.

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

`scripts/roster.json` is **gitignored** — this repository is public and a
directory of working corporate addresses is what gets scraped for phishing. See
`scripts/roster.example.json`.

---

## 5. Verify a release

```bash
npm run test:security   # 41 tests against the REAL database, using the anon key
```

These sign in as real users with the anon key — the same surface a browser has —
and assert the **server** refuses what it should. The service role appears only
to build fixtures and to check what actually landed. Run them against UAT after
any change to RLS, the RPCs or the migrations.

Then in a browser:

- [ ] Sign in as the EA; the dashboard loads with data
- [ ] Sign in as a stakeholder; they see only their own assignments
- [ ] A deep link (`/#task/123`) opens the drawer after a hard refresh — this is
      what proves `serve -s` is rewriting correctly
- [ ] The header is not clipped at 1280px wide (HANDOVER §9)

---

## Rollback

The image is immutable and tagged `v1.$CODEBUILD_BUILD_NUMBER`. Roll back by
pointing the ECS service at the previous task definition revision — no rebuild.

**Database migrations do not roll back.** They are additive and idempotent, but
`07_cr02.sql` drops the `saved_views` table, and `06_cr01_delete.sql` introduces
permanent deletion. If you need to revert past those, restore from a Supabase
backup rather than trying to undo them by hand.
