# AWS provisioning — CEO Office Portal

First-time setup only. For a routine release see [`../DEPLOY.md`](../DEPLOY.md).

This now mirrors the Marketing and Legal portals almost exactly. If you have
provisioned either of those, this will feel familiar and you can move quickly —
the differences are called out in boxes.

---

## What you are deploying

```
        browser
           │
           ├──► ALB ──► ECS (Fargate, arm64) ──► frontend :7868
           │              serves the built React bundle.
           │              No secrets, no database, no state.
           │
           └──► ALB ──► ECS (Fargate, arm64) ──► backend :7869
                          │
                          ├──► RDS Postgres      all data + ALL authorization
                          ├──► Cognito           token verification
                          ├──► S3 (private)      attachment bytes
                          └──► Secrets Manager   database credentials
```

> **The difference from Marketing and Legal.** Those two decide permissions in
> Express. This one decides them in Postgres Row-Level Security, and the backend
> binds a verified identity to each transaction instead.
>
> For provisioning, this changes exactly one thing, in §3: **the database user
> the backend connects as must not be a superuser.** Everything else is the
> same. See [`../backend/sql/00_compat.sql`](../backend/sql/00_compat.sql).

---

## 1. ECR

Two repositories:

```bash
for repo in gyftr-ceo-portal-frontend gyftr-ceo-portal-backend; do
  aws ecr create-repository \
    --repository-name $repo \
    --region $AWS_DEFAULT_REGION \
    --image-scanning-configuration scanOnPush=true
done
```

Both builds pull the shared ARM base image from the platform account:

```
653380732738.dkr.ecr.ap-south-1.amazonaws.com/node-24.18.0-alpine3.24-arm
```

The CodeBuild role needs `ecr:GetAuthorizationToken` plus pull permission on
that account — the same grant the Marketing and Legal builds already use. If a
build fails at `pre_build` with a login error, this is why.

---

## 2. RDS

- **Engine:** PostgreSQL 16
- **Instance:** `db.t4g.micro` is ample — the working set is a few thousand rows
- **Database name:** `gyftr_ceo`
- **Public access:** no. Only the backend's security group reaches 5432
- Store the credentials in **Secrets Manager** (e.g. `gyftr/ceo/db`) with the
  standard RDS shape: `host`, `port`, `dbname`, `username`, `password`

**No migration step.** The backend applies `backend/sql/*.sql` on every boot and
every statement is idempotent, so the database builds itself the first time the
service starts.

> ### Which database user the backend connects as
>
> **It must own the schema — use the RDS master user, or the owner of the
> `gyftr_ceo` database.** Not a restricted application user.
>
> This is not laziness about permissions; it is what the design requires:
>
>  - `00_compat.sql` creates a role and a schema, which needs `CREATEROLE` and
>    `CREATE` on the database.
>  - `08_grants.sql` grants privileges on every table to `authenticated`, which
>    only the owner can do.
>  - `db.js` re-applies all migrations on every boot, so these are not one-time
>    needs that can be dropped afterwards.
>
> Row-level security is **not** weakened by connecting as the owner. Owners do
> bypass RLS — which is exactly why every request runs `SET LOCAL ROLE
> authenticated` first, switching to a non-owning role for the transaction. The
> owner connection exists to *maintain* the schema; the `authenticated` role is
> what serves requests. See `backend/sql/00_compat.sql`.
>
> If you point the backend at a restricted user, expect it to fail at boot with
> `permission denied to create role`. The migration now tells you the two
> statements a superuser must run, but the simpler fix is to use the owner.
>
> ### The one genuinely different thing on this portal
>
> Authorization is enforced by RLS, and **PostgreSQL exempts a table's owner
> from row-level security.** If the backend connects as a superuser (or as the
> role that owns the tables *and* has `BYPASSRLS`), every policy in the schema
> silently stops applying. Nothing errors. Every query still returns data — just
> more of it than the caller should see.
>
> The RDS master user created by `create-db-instance` is **not** a superuser and
> does **not** have `BYPASSRLS`, so the default configuration is correct and you
> do not need to do anything. The protection comes from `SET LOCAL ROLE
> authenticated` on every request, which switches to a non-owning role.
>
> What to avoid: do not grant the backend's user `rds_superuser` beyond what
> RDS gives the master by default, and do not add `BYPASSRLS`. If you ever point
> the backend at a *different* user from the one that ran the migrations, grant
> it membership first, or every request fails on `SET ROLE`:
>
> ```sql
> grant authenticated to <the_backend_user>;
> ```
>
> To confirm RLS is genuinely on in a deployed environment, run
> `npm run test:security` against it. That suite exists precisely to answer this
> question and takes a few seconds.

---

## 3. Cognito

- **User pool:** one, e.g. `gyftr-ceo-portal`
- **Sign-in:** email
- **App client:** **no client secret.** A browser cannot keep one, and
  `amazon-cognito-identity-js` will not authenticate against a client that has
  one. The symptom is an opaque `NotAuthorizedException` that looks exactly like
  a wrong password — this costs an afternoon if you do not know it
- **Auth flows:** enable `ALLOW_USER_PASSWORD_AUTH` and `ALLOW_REFRESH_TOKEN_AUTH`
- **Password policy:** the default (8+, upper, lower, digit, symbol) is what the
  temporary passwords the code generates are built to satisfy
- **Email:** configure SES, and **take the account out of the SES sandbox**
  before onboarding real people. In the sandbox only verified addresses receive
  mail, so invitations silently fail for everyone else

Accounts are created in `FORCE_CHANGE_PASSWORD`, so a temporary password is
single-use and every person chooses their own before reaching the board.

---

## 4. S3

```bash
aws s3api create-bucket \
  --bucket gyftr-ceo-portal-attachments \
  --region $AWS_DEFAULT_REGION \
  --create-bucket-configuration LocationConstraint=$AWS_DEFAULT_REGION

aws s3api put-public-access-block \
  --bucket gyftr-ceo-portal-attachments \
  --public-access-block-configuration \
    "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"
```

> **This bucket must never be public, and the reason is specific to this
> portal.**
>
> Attachments are served through 60-second presigned URLs that the API mints
> only after re-reading the attachment row through RLS — so only somebody
> assigned to the task can obtain one. That check is the *entire* access control
> on attachment bytes. If Block Public Access were off, the check would be
> decorative: anyone who learned an object key could read it directly.
>
> `npm run test:api` asserts an unsigned request to the bucket is refused.

The backend's **task role** needs, scoped to this bucket only:

```
s3:PutObject, s3:GetObject, s3:DeleteObject   on arn:aws:s3:::gyftr-ceo-portal-attachments/*
```

Plus `secretsmanager:GetSecretValue` on the database secret, and
`cognito-idp:AdminCreateUser`, `AdminSetUserPassword`, `AdminGetUser` on the
user pool (these back the in-app "Invite Stakeholder" flow).

---

## 5. CodeBuild

Two projects — **one per image**.

| Setting | Frontend | Backend |
|---|---|---|
| Buildspec | `frontend/buildspec.yml` | `backend/buildspec.yml` |
| Environment type | **ARM / Graviton** | **ARM / Graviton** |
| Privileged | enabled | enabled |

Frontend environment variables:

```
FRONTEND_IMAGE_REPO_NAME  = gyftr-ceo-portal-frontend
FRONTEND_ECS_CONTAINER    = <container name in the task definition>
VITE_API_URL              = https://ceo-api.gyftr.net
VITE_COGNITO_USER_POOL_ID = ap-south-1_XXXXXXXXX
VITE_COGNITO_CLIENT_ID    = <app client id, no secret>
```

Backend environment variables:

```
BACKEND_IMAGE_REPO_NAME = gyftr-ceo-portal-backend
BACKEND_ECS_CONTAINER   = <container name in the task definition>
```

> The backend build takes **no** application configuration. It is deliberately
> environment-agnostic — the same image runs in UAT and production, and nothing
> secret is ever baked into it. The frontend needs its three because Vite
> compiles them into the bundle.

An x86 CodeBuild environment fails confusingly: the image builds but will not
run on an arm64 task. Check this first if a task starts and immediately dies
with an exec-format error.

---

## 6. ECS

Two services in one cluster.

| | Frontend | Backend |
|---|---|---|
| Launch type | Fargate, ARM64 | Fargate, ARM64 |
| Task size | 0.25 vCPU / 0.5 GB | 0.5 vCPU / 1 GB |
| Container port | `7868` | `7869` |
| Task role | none needed | S3 + Secrets Manager + Cognito (§4) |
| Execution role | ECR pull + CloudWatch Logs | same |
| Environment | **none** — baked in at build | the runtime table in DEPLOY.md |

Adding `VITE_` variables to the frontend task has no effect and misleads whoever
reads the task definition next. The bundle was compiled at build time.

The backend's security group must reach RDS on 5432, and RDS's must allow it.

---

## 7. Load balancer

| | Frontend | Backend |
|---|---|---|
| Target port | 7868 | 7869 |
| Health check | `/` | `/health` |
| Target type | ip | ip |

Healthy threshold 2, interval 30s, HTTPS listeners with ACM certificates.

Two details worth knowing before they cost you time:

- `serve -s` rewrites unknown paths to `index.html`, which the SPA router needs.
  If deep links 404 while the home page works, that flag has been lost.
- The backend health check is **`/health`, not `/health/deep`.** `/health` is
  liveness and deliberately does not touch the database. Pointing the target
  group at `/health/deep` means a brief RDS blip deregisters every task at once
  and turns a degraded service into a total outage. `/health/deep` is for
  humans and scripts diagnosing a problem.

---

## 8. DNS

```
ceo.gyftr.net       → frontend ALB
ceo-api.gyftr.net   → backend ALB
```

Then make sure these agree, or the app will load and fail in confusing ways:

- `VITE_API_URL` on the **frontend build** = the API hostname
- `FRONTEND_URL` on the **backend task** = the site hostname (this is the CORS
  allow-list; a mismatch shows up as a blocked preflight, which fetch reports
  only as an unhelpful "Failed to fetch")

---

## 9. Before go-live

- [ ] SES out of the sandbox, and one invitation verified end to end
- [ ] The app client confirmed to have **no client secret**
- [ ] S3 Block Public Access confirmed on all four settings
- [ ] `npm run test:security` passes against UAT — this is what proves RLS is
      actually applying and is worth doing before you trust anything else here
- [ ] `npm run test:api` passes against UAT
- [ ] Demo accounts removed and the real roster onboarded
- [ ] RDS automated backups on, with a retention period somebody has agreed to
- [ ] The old Supabase project and Vercel deployment decommissioned, so there is
      one obvious place people should be using

---

## Cost note

Both containers are small and idle-cheap; the meaningful line items are RDS and
the ALB. Unlike the previous architecture, **there is no third-party bill** —
the Supabase plan that used to sit outside the AWS invoice is gone, and this
system's cost now appears in one place.
