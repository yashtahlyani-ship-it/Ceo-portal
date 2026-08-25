# AWS provisioning — CEO Office Portal

First-time setup only. For a routine release see [`../DEPLOY.md`](../DEPLOY.md).

This mirrors the Marketing and Legal portals' setup, with one structural
difference that changes the work: **there is no backend service.** You are
provisioning a single static-serving container, not a two-tier app.

---

## What you are actually deploying

```
        browser
           │
           ├──────────────► ALB → ECS (Fargate, arm64) → frontend container :7868
           │                       serves the built React bundle. No secrets,
           │                       no database connection, no state.
           │
           └──────────────► Supabase (managed, outside the VPC) over HTTPS
                                   Postgres + Auth + Storage + Edge Functions.
                                   Every access decision is made here by
                                   Row-Level Security.
```

The container is a static file server. It holds no credentials and talks to
nothing. Two consequences worth planning around:

- **No security group rule to a database is needed**, because the container
  never opens one. The *browser* talks to Supabase, not the task.
- **Supabase is a third-party dependency in the request path.** If Supabase is
  unreachable the app loads and then shows an error, rather than failing to
  start. Decide whether that is acceptable before go-live; if not, the data
  layer would need to move to RDS, which is a rewrite, not a configuration
  change.

---

## 1. ECR

```bash
aws ecr create-repository \
  --repository-name gyftr-ceo-portal-frontend \
  --region $AWS_DEFAULT_REGION \
  --image-scanning-configuration scanOnPush=true
```

The build also pulls the shared ARM base image from the platform account:

```
653380732738.dkr.ecr.ap-south-1.amazonaws.com/node-24.18.0-alpine3.24-arm
```

The CodeBuild role needs `ecr:GetAuthorizationToken` plus pull permission on
that account — the same grant the Marketing and Legal builds already use. If the
build fails at `pre_build` with a login error, this is why.

---

## 2. CodeBuild

Create one project, **not two**.

| Setting | Value |
|---|---|
| Source | this repository, branch `main` |
| Buildspec | `frontend/buildspec.yml` |
| Environment type | **ARM / Graviton** — must match `BASE_IMAGE` |
| Privileged | **enabled** (it builds a Docker image) |
| Service role | needs ECR push + the cross-account pull above |

Environment variables:

```
FRONTEND_IMAGE_REPO_NAME = gyftr-ceo-portal-frontend
FRONTEND_ECS_CONTAINER   = <container name in the task definition>
VITE_SUPABASE_URL        = https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY   = <anon / publishable key>
```

> Do **not** add `SUPABASE_SERVICE_ROLE_KEY` here. It bypasses Row-Level
> Security, and anything reaching the build can end up in the public bundle.
> The buildspec greps `dist/` for it and fails the build as a backstop.

An x86 CodeBuild environment will fail confusingly — the image builds but will
not run on an arm64 task. Check this first if the task starts and immediately
dies with an exec-format error.

---

## 3. ECS

- **Launch type:** Fargate, `ARM64` architecture
- **Task size:** 0.25 vCPU / 0.5 GB is ample — it serves static files
- **Container port:** `7868`
- **Task role:** none needed; the container calls no AWS APIs
- **Execution role:** standard ECR pull + CloudWatch Logs
- **Environment variables on the task:** **none.** Everything the app needs was
  compiled into the bundle at build time. Adding `VITE_` variables here has no
  effect and misleads whoever reads the task definition next.

---

## 4. Load balancer

- Target group → port `7868`, protocol HTTP, target type `ip`
- **Health check path: `/`** — there is no `/health` endpoint; this is a static
  server, not an API
- Healthy threshold 2, interval 30s
- HTTPS listener with an ACM certificate for the chosen hostname

`serve -s` rewrites unknown paths to `index.html` so client-side routes resolve.
If deep links 404 while the home page works, that flag has been lost.

---

## 5. DNS

Point the hostname at the ALB, then set the **same** hostname in
**Supabase → Authentication → URL Configuration** (site URL and redirect
allow-list). Password-reset and invite links are generated from that value, so
if it still points at Vercel or localhost the links will work but land people on
the wrong host.

---

## 6. Before go-live

- [ ] SMTP configured in Supabase, and one invite verified end to end
      (until then invites fall back to hand-delivered passwords — DEPLOY.md §3)
- [ ] Demo accounts removed and the real roster onboarded
- [ ] `npm run test:security` passes against the UAT project
- [ ] The Supabase and Vercel access tokens used during development rotated
- [ ] Decide whether the Vercel deployment stays as a preview or is retired, so
      there is one obvious place people should be using

---

## Cost note

The container is small and idle-cheap. The meaningful cost is Supabase's plan,
which is billed outside AWS — worth flagging to whoever owns the budget, since
it will not appear in the AWS bill for this service.
