# Handover

Everything a new maintainer needs on day one. Read this first; the other docs go
deeper once you know where things are.

---

## 1 · Where everything lives

| Thing | Location |
|---|---|
| **Code** | https://github.com/yashtahlyani-ship-it/Ceo-portal (branch `main`) |
| **Live app** | https://gyftr-ceo-portal.vercel.app |
| **Hosting** | Vercel, project `gyftr-ceo-portal` (account `yashtahlyani8-7712`) |
| **Database / Auth / Storage** | Supabase project ref `yorvxmtrdpuuadeloqxw`, region `ap-northeast-1` |
| **Design source of truth** | The Marketing Portal, `gyftr-portal` — do not restyle this app independently |

> ⚠️ **The GitHub repository is PUBLIC.** No secret may ever be committed.
> `.gitignore` covers `.env*`; keep it that way. If a key is ever pasted into a
> file, rotate it — deleting the commit is not enough.

---

## 2 · Get it running in five minutes

```bash
git clone https://github.com/yashtahlyani-ship-it/Ceo-portal.git
cd Ceo-portal
npm install

cp .env.example .env          # fill in all four values (see below)
cp .env .env.local            # the browser only needs the two VITE_ vars

npm run dev                    # → http://localhost:5173
```

### The four environment values

| Variable | Where to get it | Who uses it |
|---|---|---|
| `VITE_SUPABASE_URL` | Supabase → Project Settings → API | Browser |
| `VITE_SUPABASE_ANON_KEY` | same page | Browser. **Public by design** — security is RLS, not secrecy |
| `SUPABASE_SERVICE_ROLE_KEY` | same page | **Server only.** Bypasses RLS. Never let this reach the browser |
| `DEMO_PASSWORD` | Ask the CEO's Office | `npm run seed` and the tests |

`.env` is server-side (all four). `.env.local` is what Vite reads (the two
`VITE_` ones). Both are gitignored.

---

## 3 · Commands

```bash
npm run dev             # dev server
npm run build           # production build
npm run preview         # serve the production build locally
npm run lint            # eslint  (expect 0 errors, ~9 warnings — see §8)
npm test                # all 64 tests
npm run test:unit       # 23 pure-logic tests, no network
npm run test:security   # 41 tests against the REAL database
npm run seed            # (re)create demo accounts + demo tasks
```

**Run `npm test` before every push.** The security tests are the ones that
matter — see §6.

---

## 4 · Deploying

Vercel builds from `main`. To ship manually:

```bash
vercel deploy --prod
```

Environment variables are already set on Vercel for Production, Preview and
Development. If you rotate the Supabase keys, update them there too:

```bash
vercel env add VITE_SUPABASE_ANON_KEY production --force
```

---

## 5 · Running the database

Seven migrations, **run in this order** against a fresh project:

```
supabase/01_schema.sql      tables, enums, indexes
supabase/02_functions.sql   business logic, RPCs, audit triggers
supabase/03_policies.sql    row-level security
supabase/04_storage.sql     private attachment bucket + policies
supabase/05_cr01.sql        CR-01: stakeholder-raised tasks
supabase/06_cr01_delete.sql CR-01: permanent delete
supabase/07_cr02.sql        CR-02: promised-date approval, notifications
```

They are idempotent (`create or replace`, `drop policy if exists`), so
re-applying after an edit is safe.

Then deploy the Edge Function that lets the EA/CEO add people from inside the app:

```bash
supabase functions deploy create-stakeholder
```

**Changing a business rule?** It lives in `supabase/02_functions.sql` (and
`05_cr01.sql` for the stakeholder-raised-task rules), not in the React code. `src/lib/rules.js` is a *mirror* for deciding which buttons to show
and has no enforcement value. Change the SQL, re-apply it, then update the mirror
to match — and let `npm run test:security` confirm they agree.

---

## 6 · How this codebase is tested (and why it's unusual)

`npm test` → **64 tests, all passing.**

- **23 unit tests** (`tests/logic.test.mjs`) — pure functions, no network.
- **41 integration tests** (`tests/security.test.mjs`) — against the **real**
  Supabase project.

The integration tests sign in as real users using the **anon key**, which is
exactly the surface a browser has. The service-role key is used *only* to build
fixtures and to independently check what actually landed in the table — **never**
to perform the action under test.

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
comment in `eslint.config.js`. Fixing them is a deliberate cross-product change,
not a drive-by.

**Bundle is ~498 kB (139 kB gzipped).** It is React DOM, the Supabase client and
lucide icons — there is no obvious fat to cut. (An earlier note here claimed
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

**Email is not actually configured.** The invite flow (CR-02 #6) calls
`inviteUserByEmail`, but this project has **no custom SMTP**, and Supabase's
built-in sender is capped at ~2 emails/hour and only reliably reaches team
members. So invites usually fall back to a temporary password, which the UI
says plainly rather than claiming an email was sent. **Configure SMTP in
Supabase → Authentication → Emails before onboarding real people.**

**Two auth systems in the family.** Marketing and Legal use AWS Cognito; this app
uses Supabase Auth. People maintain two passwords. Acceptable at ~17 users;
consolidating is a future decision, not a bug. The reasoning is in
[PROJECT_PLAN.md](PROJECT_PLAN.md#stack-decision).

---

## 9 · Traps that have already bitten this codebase

Real bugs, all fixed — but the shapes recur. Watch for them.

1. **Never build a date with `toISOString()`.** It is UTC. In IST it returns
   *yesterday* for most of the working day, so "due today" renders as overdue.
   Use local date parts (`getFullYear`/`getMonth`/`getDate`). The Marketing
   Portal carries the same warning.
2. **Three tables now have TWO foreign keys into `profiles`.** Any PostgREST
   embed against them must name the constraint or the query fails as ambiguous
   — and this has broken something three separate times.

   | Table | The two FKs | Embed as |
   |---|---|---|
   | `task_assignments` | `stakeholder_id`, `promised_confirmed_by` | `profiles!task_assignments_stakeholder_id_fkey` |
   | `tasks` | `created_by`, `archived_by` | `profiles!tasks_created_by_fkey` |
   | `notifications` | `recipient_id`, `actor_id` | `profiles!notifications_actor_id_fkey` |

   Before adding a `profiles(...)` embed anywhere, check the target's FK count.
   **And never swallow the error** — the third occurrence shipped looking like
   "no notifications yet" because the poll had a bare `.catch(() => {})`. If a
   background fetch can fail quietly, at minimum `console.warn` it.
3. **Audit triggers must tolerate a vanishing parent.** Deleting a task cascades
   to its assignments, whose delete-trigger would otherwise write an audit row
   pointing at the already-deleted task and abort the whole delete.
4. **Do not wrap multiple controls in a `<label>`.** A label binds to exactly one
   control; wrapping three buttons made clicking the caption silently select the
   first. Use `role="group"` + `aria-label` (see `Field` in `src/components/ui.jsx`).
5. **A server-side flag is useless if the client never checks it.** The
   `create-stakeholder` function correctly stamped `must_set_password: true`,
   and an integration test asserted it — but `App.jsx` only rendered `<Login/>`
   when there was *no* session. A first-time account signs in successfully, so
   it had a session, and the "set a new password" screen could never mount. The
   gate now lives in `App.jsx`'s render guard alongside the session check.
   **The integration tests cannot catch this class of bug** — they verify the
   server, not what the client does with the answer. Anything that gates the UI
   on server state needs a real browser pass.
6. **A withdrawn feature must leave the base migrations too.** CR-02 dropped
   `saved_views` in `07`, but `01`–`03` still created it and its policies. Since
   this file tells you migrations are safe to re-apply, re-running `01`–`03`
   after `07` would have resurrected a table the app has no code for. The
   definition is now gone from the base files, and re-applying all seven in
   order was verified to leave it dropped. **When you withdraw something, remove
   its DDL — do not just add a drop at the end.**
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
   below that `src/lib/styles.js` sheds the user's name (≤1430) then the nav
   labels (≤1300). Search absorbs the first ~100px on its own.

   **Do not reason about this arithmetically — measure it.** After any header
   change, at each of 1024 / 1152 / 1280 / 1366 / 1440 / 1536:
   ```js
   const h = document.querySelector('header');
   h.scrollWidth - h.clientWidth;                    // must be 0
   h.lastElementChild.getBoundingClientRect().right <= innerWidth;  // must be true
   ```
   Verified at all six after CR-02.

---

## 10 · Before this tool carries real work

- [ ] **Rotate the Supabase and Vercel access tokens** that were used to
      provision this project — they were shared in plaintext during setup.
- [ ] **Delete the `@demo.gyftr.net` accounts** and seed data, then create real
      accounts through the app.
- [ ] **Decide whether the repo should stay public.** It contains a real org
      chart (names and titles) in `scripts/seed.mjs` and `DEMO.md`. No
      credentials remain in it, but the roster is real.
- [ ] **Consider gating the deployment** behind Vercel authentication or an IP
      allow-list. The login page is publicly reachable; it grants nothing, but it
      is visible.
- [ ] Confirm Supabase's password policy matches the rules shown on the
      set-password screen (8+ chars, upper, lower, number, symbol).

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
