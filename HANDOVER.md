# Handover

Everything a new maintainer needs on day one. Read this first; the other docs go
deeper once you know where things are.

---

## 1 · Where everything lives

| Thing | Location |
|---|---|
| **Code** | https://github.com/yashtahlyani-ship-it/Ceo-portal (branch `main`) |
| **Live app** | https://ceo.gyftr.net |
| **API** | https://ceo-api.gyftr.net |
| **Hosting** | AWS — two ECS Fargate services (arm64) behind an ALB, `ap-south-1` |
| **Database** | RDS PostgreSQL 16, database `gyftr_ceo` |
| **Auth** | AWS Cognito user pool |
| **Attachments** | Private S3 bucket |
| **Design source of truth** | The Marketing Portal, `gyftr-portal` — do not restyle this app independently |

> ⚠️ **The GitHub repository is PUBLIC.** No secret may ever be committed.
> `.gitignore` covers `.env*`; keep it that way. If a key is ever pasted into a
> file, rotate it — deleting the commit is not enough.

---

## 2 · Get it running in five minutes

```bash
git clone https://github.com/yashtahlyani-ship-it/Ceo-portal.git
cd Ceo-portal
npm run install:all           # frontend + scripts

cp .env.example .env          # fill in all four values (see below)
cp frontend/.env.example frontend/.env.local   # the two VITE_ vars only

npm run dev:frontend          # → http://localhost:5173
```

The repository is laid out like the Marketing and Legal portals: `frontend/`,
`backend/`, and a root holding orchestration and docs. As of August 2026 the
architecture matches them too — see §0 below if you worked on this before then.

### The environment values

| Variable | Where to get it | Who uses it |
|---|---|---|
| `VITE_API_URL` | the API hostname | Browser. Compiled into the bundle at build time |
| `VITE_COGNITO_USER_POOL_ID` | Cognito → User pools | Browser. **Public by design** |
| `VITE_COGNITO_CLIENT_ID` | Cognito → App clients | Browser. **Must have no client secret** |
| `AWS_SECRET_NAME` *or* `DB_*` | Secrets Manager / RDS | **Backend only** |
| `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID` | Cognito | Backend — token verification |
| `ATTACHMENTS_BUCKET` | S3 | Backend only |
| `FRONTEND_URL` | the site hostname | Backend — the CORS allow-list |
| `DEMO_PASSWORD` | Ask the CEO's Office | `npm run seed` |

The three `VITE_` values are public: an address and two identifiers, shipped in a
file every visitor downloads. They grant nothing on their own. Everything else is
server-side. All `.env` files are gitignored.

---

## 0 · If you knew this app before August 2026

It used Supabase for data, auth and storage, and deployed to Vercel. **Both are
gone.** It now runs on ECS, RDS, Cognito and S3 like its siblings.

One thing did **not** converge, and it is the most important thing to understand
before you touch a route:

> **Authorization is enforced by PostgreSQL Row-Level Security, not by Express
> middleware.** Marketing and Legal do it the other way round.

That is not Supabase residue. RLS is a PostgreSQL feature; it moved to RDS
untouched, because this product's central requirement is that a stakeholder can
never see a co-assignee's status, promised date or comments — and a row predicate
holds on every query path, including ones nobody has written yet.

The practical consequence, and the one way to break this system badly:

```js
// Correct. RLS decides what comes back — note the absence of any WHERE clause
// about who may see what.
await withUser(req.profile.id, c => c.query('select * from tasks'));

// WRONG. Runs as the table owner and bypasses EVERY policy in the schema.
await query('select * from tasks');
```

They are one word apart. The wrong one still works, still returns data, still
passes every functional test — and quietly serves one stakeholder another
stakeholder's private thread. `npm run test:unit` fails the build if a route does
it. Read [`backend/sql/00_compat.sql`](backend/sql/00_compat.sql) first: it is
thirty lines and explains the whole mechanism.

---

## 3 · Commands

```bash
npm run dev:frontend    # dev server
npm run build:frontend  # production build
npm run lint            # eslint  (expect 0 errors, ~9 warnings — see §8)
npm run dev:backend     # API with --watch
npm run docker:up       # the whole stack: frontend :7868, backend :7869, postgres :5442
npm test                # everything
npm run test:unit       # 28 tests — pure logic + route safety. Needs no database
npm run test:security   # 41 tests against a REAL database
npm run test:api        # Cognito/S3/onboarding against a DEPLOYED stack
npm run seed            # (re)create demo accounts + demo tasks
```

Admin scripts live in `scripts/` and talk to Cognito and the database directly:
`seed.mjs`, `onboard.mjs`, `create-stakeholder.mjs`, `force-password-reset.mjs`
(§7).

**Run `npm run test:unit` before every push** — it needs nothing, takes a
second, and catches the one migration-specific way to break this codebase.
Run `test:security` before every release. See §6.

---

## 4 · Deploying

Two CodeBuild projects → two ECR repositories → two ECS services. See
[DEPLOY.md](DEPLOY.md) for the runbook and
[infra/aws-setup.md](infra/aws-setup.md) for first-time provisioning.

**Roll the two services back together.** They are versioned independently but
released as a pair, and a frontend expecting an endpoint an older backend does
not serve fails in ways that look like a data problem.

---

## 5 · Running the database

**There is no migration step.** `backend/db.js` applies `backend/sql/*.sql` in
filename order on every boot, and every statement is idempotent — so the database
builds itself the first time the backend starts, and deploying is just a restart.

```
backend/sql/00_compat.sql      auth.uid() + the `authenticated` role  ← first
backend/sql/01_schema.sql      tables, enums, indexes
backend/sql/02_functions.sql   business logic, RPCs, audit triggers
backend/sql/03_policies.sql    row-level security
backend/sql/05_cr01.sql        CR-01: stakeholder-raised tasks
backend/sql/06_cr01_delete.sql CR-01: permanent delete
backend/sql/07_cr02.sql        CR-02: promised-date approval, notifications
backend/sql/08_grants.sql      privileges for `authenticated`  ← last
```

Order is load-bearing. There is deliberately no `04_`: that file created the
Supabase Storage bucket, which S3 replaced. Renumbering would have changed the
reviewed filenames of everything after it, so the gap was left.

**Changing a business rule?** It lives in `backend/sql/02_functions.sql` (and
`05_cr01.sql` for the stakeholder-raised-task rules), not in the React code. `frontend/src/lib/rules.js` is a *mirror* for deciding which buttons to show
and has no enforcement value. Change the SQL, re-apply it, then update the mirror
to match — and let `npm run test:security` confirm they agree.

---

## 6 · How this codebase is tested (and why it's unusual)

`npm test` → **69 tests.**

- **23 unit tests** (`tests/logic.test.mjs`) — pure functions, no network.
- **5 route-safety tests** (`tests/routes.test.mjs`) — static analysis of
  `backend/routes/`. No network either.
- **41 integration tests** (`tests/security.test.mjs`) — against a **real**
  Postgres database.
- **API tests** (`tests/api.test.mjs`) — against a **deployed** stack. These skip
  themselves when not configured, so a laptop off the VPN gets a clean run rather
  than a red one people learn to ignore.

The integration tests run every statement through
`set local role authenticated` with `app.user_id` set — byte for byte the path
`withUser()` takes on a live request. The owner connection is used *only* to
build fixtures and to independently check what actually landed in the table —
**never** to perform the action under test.

The route-safety suite is new, and it covers something that did not exist before
the AWS migration: there is now application code between the user and the
policies, and a route calling `query()` instead of `withUser()` would bypass all
of them while every other test stayed green. It runs in milliseconds and needs
nothing, which is why it belongs in `test:unit` and in CI on every push.

That distinction is the whole point: a passing test means **the server refused**,
not that the UI hid a button. They cover skipping a workflow stage, moving
backward, touching a co-assignee's assignment, reading someone else's comment
thread, editing a comment, clearing the audit log, and minting a signed URL for
an attachment you shouldn't see.

If you change permissions, RLS or the state machine, these tests are your safety
net. Do not delete them to make a change pass.

---

## 7 · Routine operations

### Add a stakeholder
In the app: **Stakeholders → Invite Stakeholder** (Name, Email, Designation).
With SMTP configured they get an email link to set their own password. Without
it, the modal shows a temporary password to pass on instead — see §8.

From the CLI:
```bash
cd scripts
node create-stakeholder.mjs "Full Name" name@gyftr.net "Head of Something"
```

### Remove someone
**Stakeholders → Deactivate.** This preserves their history. Deleting the auth
user would orphan their assignments — deactivate instead.

Deactivation takes effect on the **next request**, not the next login:
`middleware/identity.js` checks `active` on every call, so a deactivated person
with a still-valid token is refused immediately rather than up to an hour later.

### Force everyone to set a new password
The same script Marketing and Legal have. Use it after a shared password has
been handed around, or if one is suspected of leaking.

```bash
cd scripts
node force-password-reset.mjs --dry-run      # show who would be reset
node force-password-reset.mjs                # reset everyone
node force-password-reset.mjs --signout      # ...and end active sessions now
node force-password-reset.mjs --only=a@gyftr.com,b@gyftr.com
```

It sets a temporary password (`TEMP_PASSWORD`, or `DEMO_PASSWORD`, from `.env` —
there is deliberately no hard-coded default in this public repo), which puts the
account into `FORCE_CHANGE_PASSWORD`. Cognito then answers the next sign-in with
a challenge instead of a session, so nobody reaches the board without choosing
their own password.

**Without `--signout`, anyone already signed in keeps working until their token
expires** — up to an hour. If you are resetting *because* something leaked, that
is not what you want; pass `--signout`.

It also sets `profiles.must_set_password` so the Stakeholders screen matches
reality, and warns about Cognito accounts that have no profile in the database
(they cannot sign in anyway, but their presence usually means someone was
removed from the directory and not from the pool).

### Rotate the demo password
```bash
# 1. put the new value in .env
# 2. apply it to every live demo account:
cd scripts && npm run seed        # existing accounts are updated in place
```

### Reset the demo data
`npm run seed` RESETS first — it clears demo data and the `@demo.gyftr.net`
accounts, then rebuilds them, so it is deterministic. Note that it deletes and
recreates the accounts, so any open browser session goes stale: sign out and
back in afterwards rather than assuming something broke.

---

## 8 · Known state — read before you panic

**`npm run lint` reports 0 errors and ~9 warnings.** The warnings are
React-Compiler-era rules from `eslint-plugin-react-hooks` v7 (`set-state-in-effect`,
`only-export-components`). The Marketing Portal violates the same rules 53 times.
They are kept as *warnings, not disabled*, so the advice stays visible — see the
comment in `frontend/eslint.config.js`. Fixing them is a deliberate cross-product change,
not a drive-by.

**Bundle is ~381 kB (113 kB gzipped).** It is React DOM,
`amazon-cognito-identity-js` and lucide icons — there is no obvious fat to cut.
It shed ~117 kB when the Supabase client went, which was a side effect of the
migration rather than a goal of it. (An earlier note here claimed
Recharts dominated it; that was wrong. Recharts was never imported, so Vite
tree-shook it entirely, and the dependency has since been removed. If a chart
view is ever added, `npm i recharts` matches the Marketing Portal.)

**No drag-and-drop on the Kanban.** Movement is explicit buttons and menus:
keyboard-accessible, unambiguous, and every move writes an audit event. Drag
would be additive, not a replacement.

**Notifications are narrow on purpose.** CR-02 opened the door only for the
three promised-date events; task edits, comments and column moves stay
notification-free, and the dashboard is still the monitoring mechanism for
everything else. The table is generic but the WRITERS are few — that is what
stops it becoming a firehose. Widen it deliberately, not by reflex.

**Email delivery still needs configuring.** The invite flow (CR-02 #6) asks
Cognito to email an invitation. If SES is still in its sandbox — the default —
only verified addresses receive mail, so invitations silently fail for everyone
else. The app degrades honestly: when the send fails it creates the account with
a temporary password and tells the EA exactly why, rather than claiming an email
went out. **Take SES out of the sandbox before onboarding real people.**

Note this is a smaller problem than it was. Whichever path is taken, the account
is created in `FORCE_CHANGE_PASSWORD`, so a hand-delivered password is
single-use and the person still chooses their own.

**~~Two auth systems in the family.~~ Resolved (Aug 2026).** All three portals
now use AWS Cognito; people maintain one password. The reasoning behind the
original divergence, and what survived the migration, is in
[PROJECT_PLAN.md](PROJECT_PLAN.md#stack-decision).

---

## 9 · Traps that have already bitten this codebase

Real bugs, all fixed — but the shapes recur. Watch for them.

1. **Never build a date with `toISOString()`.** It is UTC. In IST it returns
   *yesterday* for most of the working day, so "due today" renders as overdue.
   Use local date parts (`getFullYear`/`getMonth`/`getDate`). The Marketing
   Portal carries the same warning.
2. **Three tables have TWO foreign keys into `profiles`.** This bit three
   separate times under PostgREST, where an unqualified embed was ambiguous and
   the query simply failed.

   | Table | The two FKs |
   |---|---|
   | `task_assignments` | `stakeholder_id`, `promised_confirmed_by` |
   | `tasks` | `created_by`, `archived_by` |
   | `notifications` | `recipient_id`, `actor_id` |

   The AWS migration removed the sharp edge — the backend writes its joins in
   SQL, where the choice is explicit and cannot be ambiguous. The general lesson
   survives it, though: **never swallow the error.** The third occurrence
   shipped looking like "no notifications yet" because the poll had a bare
   `.catch(() => {})`. If a background fetch can fail quietly, at minimum
   `console.warn` it.
3. **Audit triggers must tolerate a vanishing parent.** Deleting a task cascades
   to its assignments, whose delete-trigger would otherwise write an audit row
   pointing at the already-deleted task and abort the whole delete.
4. **Do not wrap multiple controls in a `<label>`.** A label binds to exactly one
   control; wrapping three buttons made clicking the caption silently select the
   first. Use `role="group"` + `aria-label` (see `Field` in `frontend/src/components/ui.jsx`).
5. **A server-side flag is useless if the client never checks it.** The invite
   path correctly stamped `must_set_password: true`, and an integration test
   asserted it — but `App.jsx` only rendered `<Login/>` when there was *no*
   session. A first-time account signs in successfully, so it had a session, and
   the "set a new password" screen could never mount. Every new stakeholder
   walked straight onto the board.

   **The integration tests cannot catch this class of bug** — they verify the
   server, not what the client does with the answer. Anything that gates the UI
   on server state needs a real browser pass.

   The AWS migration removed this particular instance rather than re-fixing it:
   Cognito issues a `NEW_PASSWORD_REQUIRED` challenge *instead of* a session, so
   there is no token to render the board with. When you can move a gate from
   "the client is trusted to check a flag" to "the credential does not exist
   yet", do it — that is a different quality of guarantee.
6. **A withdrawn feature must leave the base migrations too.** CR-02 dropped
   `saved_views` in `07`, but `01`–`03` still created it and its policies. Since
   migrations are safe to re-apply, re-running `01`–`03` after `07` would have
   resurrected a table the app has no code for. The definition is now gone from
   the base files. **When you withdraw something, remove its DDL — do not just
   add a drop at the end.**

   This matters more now than it did: `backend/db.js` re-applies every migration
   on **every boot**, so a non-idempotent or self-resurrecting migration breaks
   every restart rather than failing once at deploy time. CI applies the whole
   set twice against a scratch database to catch exactly this.
7. **`position: fixed` is not fixed to the viewport if any ancestor has a
   `transform`.** The Kanban cards carry one from the entrance animation and
   from `:hover`, so an anchored menu was painted 485px off. Portal it to
   `<body>` — and then remember that `<body>` is outside `.gx-root`, so the
   design tokens will not resolve unless the portal content is wrapped in
   `.gx-root`. Both traps are documented in `Dropdown` in `ui.jsx`; reuse that
   component rather than rediscovering them.
8. **Changing the header creates a dead zone unless you re-measure.** It holds a
   logo, seven nav items, search, a primary button, the notification bell and the
   user chip. CR-02 added a long nav label and the bell, which pushed the natural
   width past the old thresholds — so between roughly 1440 and 1560 nothing
   degraded and nothing fitted, and the user chip was clipped off the right edge.
   That is what "top panel khisak gya hai" looked like.

   The base sizes are tuned so **everything shows at 1440 with nothing hidden**;
   below that `frontend/src/lib/styles.js` sheds the user's name (≤1430) then the nav
   labels (≤1300). Search absorbs the first ~100px on its own.

   **Do not reason about this arithmetically — measure it.** After any header
   change, at each of 1024 / 1152 / 1280 / 1366 / 1440 / 1536:
   ```js
   const h = document.querySelector('header');
   h.scrollWidth - h.clientWidth;                    // must be 0
   h.lastElementChild.getBoundingClientRect().right <= innerWidth;  // must be true
   ```
   Verified at all six after CR-02.
9. **`query()` and `withUser()` are one word apart, and one of them turns off
   every security policy in the schema.** This is the trap the AWS migration
   introduced, and it is the worst one in this list because nothing goes red:
   the route works, returns data, and passes every functional test — while
   serving one stakeholder another stakeholder's status, promised date and
   comment thread.

   ```js
   await withUser(req.profile.id, c => c.query('select * from tasks'));  // RLS ON
   await query('select * from tasks');                                   // RLS OFF
   ```

   `tests/routes.test.mjs` fails the build if a route file imports `query`
   without a written exemption. Do not add an exemption to make a test pass;
   add one only when a route genuinely cannot be covered by a policy (the
   Cognito Admin API is the only current case), and say why in the ALLOW list.
10. **Postgres exempts a table's owner from row-level security.** If the backend
   ever connects in a way that leaves it running as the owner, every policy
   silently stops applying — no error, just more rows than the caller should
   see. The protection is `SET LOCAL ROLE authenticated` inside `withUser`,
   which switches to a non-owning role for the transaction.

   Two consequences: do not grant the backend's database user `BYPASSRLS`, and
   if you point it at a different user from the one that ran the migrations,
   `grant authenticated to <that_user>` first or every request fails on
   `SET ROLE`. **`npm run test:security` against the environment is the fastest
   way to confirm RLS is actually on** — that is largely what it exists for.

---

## 10 · Before this tool carries real work

- [ ] **Rotate the Supabase and Vercel access tokens** that were used during
      development — they were shared in plaintext during setup. Both services
      are gone from this system, but a live token is a live token until it is
      revoked, and a Supabase access token still reaches every project that
      account owns. **This is outstanding.**
- [ ] **Decommission the old Supabase project and Vercel deployment**, so there
      is one obvious place people should be using.
- [ ] **Confirm S3 Block Public Access** is on for all four settings. Attachment
      bytes are protected *only* by the presigned-URL check in
      `backend/routes/attachments.js`; a readable bucket makes it decorative.
- [ ] **Confirm the Cognito app client has no client secret.** With one, sign-in
      fails with an opaque error that looks exactly like a wrong password.
- [ ] **Take SES out of the sandbox** and verify one invitation end to end.
- [ ] **Delete the `@demo.gyftr.net` accounts** and seed data, then create real
      accounts through the app.
- [ ] **Decide whether the repo should stay public.** It contains a real org
      chart (names and titles) in `scripts/seed.mjs` and `DEMO.md`. No
      credentials remain in it, but the roster is real.
- [ ] **Consider gating the deployment** behind a WAF or an IP allow-list. The
      login page is publicly reachable; it grants nothing, but it is visible.
- [ ] Confirm the Cognito pool's password policy matches the rules shown on the
      set-password screen (8+ chars, upper, lower, number, symbol).
- [ ] **Run `npm run test:security` against UAT.** It is the fastest way to
      confirm RLS is genuinely applying in a deployed environment — which is the
      assumption the entire authorization model rests on.

---

## 11 · Where to read next

| Question | File |
|---|---|
| What is this product and how do I run it? | [README.md](README.md) |
| How does it work internally? | [ARCHITECTURE.md](ARCHITECTURE.md) |
| What is the data model and why? | [DATABASE.md](DATABASE.md) |
| How is access actually enforced? | [SECURITY.md](SECURITY.md) |
| How do I demo it? | [DEMO.md](DEMO.md) |
| Why was it built this way? What was rejected? | [PROJECT_PLAN.md](PROJECT_PLAN.md) |
