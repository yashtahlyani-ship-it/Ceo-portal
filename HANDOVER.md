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
npm test                # all 55 tests
npm run test:unit       # 22 pure-logic tests, no network
npm run test:security   # 33 tests against the REAL database
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

Five migrations, **run in this order** against a fresh project:

```
supabase/01_schema.sql      tables, enums, indexes
supabase/02_functions.sql   business logic, RPCs, audit triggers
supabase/03_policies.sql    row-level security
supabase/04_storage.sql     private attachment bucket + policies
supabase/05_cr01.sql        CR-01: stakeholder-raised tasks
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

`npm test` → **55 tests, all passing.**

- **22 unit tests** (`tests/logic.test.mjs`) — pure functions, no network.
- **33 integration tests** (`tests/security.test.mjs`) — against the **real**
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
In the app: **Stakeholders → Add Stakeholder**. A temporary password is shown
once. They set their own at first sign-in.

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
`npm run seed` is safe to re-run. Accounts are reused; tasks are only seeded when
the table is empty. To fully reset, clear `tasks`, `saved_views` and `audit_log`
in Supabase first, then re-seed.

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

**No notifications.** Explicitly out of scope for v1 — the dashboard is the
monitoring mechanism. If you add them later, the natural seam is a trigger on
`audit_log`, which already records every event a notification would announce.

**Two auth systems in the family.** Marketing and Legal use AWS Cognito; this app
uses Supabase Auth. People maintain two passwords. Acceptable at ~17 users;
consolidating is a future decision, not a bug. The reasoning is in
[PROJECT_PLAN.md](PROJECT_PLAN.md#stack-decision).

---

## 9 · Traps that have already bitten this codebase

Four real bugs, all fixed — but the shapes recur. Watch for them.

1. **Never build a date with `toISOString()`.** It is UTC. In IST it returns
   *yesterday* for most of the working day, so "due today" renders as overdue.
   Use local date parts (`getFullYear`/`getMonth`/`getDate`). The Marketing
   Portal carries the same warning.
2. **`task_assignments` has two foreign keys into `profiles`** (`stakeholder_id`
   and `promised_confirmed_by`). Any PostgREST embed must name the constraint —
   `profiles!task_assignments_stakeholder_id_fkey` — or the query fails as
   ambiguous.
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
6. **Adding a nav item can push the user chip off-screen.** The header holds a
   logo, seven nav items, search, a primary button and the user chip — it does
   not fit at 1280 without help. `src/lib/styles.js` has breakpoints that shed
   gaps, then the user's name text, then the nav labels, in that order.
   **After adding a nav item, check the header at 1280px**:
   ```js
   const h = document.querySelector('header');
   h.scrollWidth - h.clientWidth   // must be 0
   ```

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
