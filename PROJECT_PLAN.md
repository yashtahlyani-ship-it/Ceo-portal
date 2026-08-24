# Project Plan — CEO Office Task Platform

## 1. The existing ecosystem, as found

Before any code was written, the surrounding products were read rather than
assumed.

### Marketing Portal (`../gyftr-portal`) — the design source of truth

- **Frontend:** React 19, Vite 8, `lucide-react`, `recharts`. ~4,200 lines.
- **Backend:** Node/Express (`backend/`) with AWS Cognito for auth, Postgres via `db.js`.
- **Design system:** a single exported template string, `src/lib/styles.js`,
  defining CSS custom properties and a `gx-` class vocabulary. No Tailwind, no
  component library, no CSS modules.
- **Layout:** a **58px top header** — logo, divider, inline nav items, a primary
  action button, user chip. **There is no sidebar.**
- **Notable:** the Marketing Portal is itself a task/board tool (Board, Drawer,
  CreateTaskModal, StatusChip, PriorityChip), so the component vocabulary maps
  onto this product almost one-to-one.

### Design inventory extracted

| Token | Value |
|---|---|
| Paper / surface | `#F3F6F2` / `#FFFFFF` |
| Ink / ink-soft | `#15241B` / `#586860` |
| Line / line-soft | `#E1EAE3` / `#EEF4EF` |
| Accent (pop) | `#62A92A`, deep `#4C8A1E`, soft `#EDF6D9` |
| Display font | Bricolage Grotesque |
| Body font | Hanken Grotesk |
| Mono font | JetBrains Mono |
| Radius | 16px cards, 10px buttons/inputs, 999px chips |
| Priority | High `#EDE4FF`/`#5B21B6`, Medium `#DBEAFE`/`#1D4ED8`, Low `#E0F2FE`/`#0369A1` |
| Danger | `#FDE2E2` / `#C42424` |
| Motion | `gxf` fade-up 0.4s, `gxd` drawer slide 0.32s, `cubic-bezier(.2,.7,.2,1)` |

Everything above is reused verbatim. `src/lib/styles.js` in this project is the
Marketing Portal's file plus a clearly-marked additions block that introduces
Kanban column/card classes **built only from existing tokens** — no new hues, no
new fonts, no gradients, no glassmorphism.

---

## 2. Two conflicts, surfaced rather than resolved silently

### Navigation: PRD information architecture vs. Marketing's layout

The brief says *"do not redesign the sidebar / navigation language."* The
Marketing Portal has **no sidebar** — navigation lives in the top header. But the
CEO Office IA needs six sections where Marketing needs three.

An earlier scaffold had resolved this by inventing a left sidebar with a generic
"G" circle in place of the GyFTR logo — a visible break from the sibling product.

**Resolved:** rebuilt as Marketing's exact top header, with the real logo
component, at the user's direction. Six items fit comfortably at desktop widths
(the product is explicitly desktop-first). `Follow-ups` and `Audit`, which the
PRD lists as candidate nav items, are reached instead through a dashboard metric
and the task drawer's Activity tab respectively — they are views onto tasks, not
separate collections.

### Stack: Supabase vs. Marketing's Express + Cognito {#stack-decision}

The brief says to reuse the existing stack where technically appropriate. The
Marketing Portal uses Express + Cognito + a hand-rolled `permissions.js`.

**Kept Supabase**, for one reason that outweighs stack symmetry: this product's
central requirement is **per-assignment data isolation** — a stakeholder must not
see a co-assignee's status, promised date or comments. Postgres row-level
security expresses that as a predicate on the table itself, so it holds for every
query path including any future one. Reimplementing it as middleware means every
new endpoint is a fresh chance to leak. The frontend stack, design system and
first-login password experience are unchanged from Marketing; only the data layer
differs, and the divergence is recorded here rather than made quietly.

---

## 3. What was built

The prior scaffold contributed a sound schema, RPC layer, audit triggers and RLS
policies, plus the design tokens. Those were reviewed, kept, and corrected. The
frontend was largely skeletal and was completed.

**Kept and verified:** `01_schema.sql`, `02_functions.sql`, `03_policies.sql`,
`lib/rules.js`, `lib/derive.js`, `lib/format.js`, `lib/api.js` shape.

**Built or rebuilt:**

- Top-header app shell with the real `GyftrLogo`, replacing the invented sidebar
- Login and first-login password flow ported from Marketing (radial wash, reveal
  toggle, live rules checklist, password-manager hints)
- Real first-login enforcement via a `must_set_password` metadata flag
- Kanban **movement controls** — the board previously had none
- Board filters (stakeholder, priority, status, date range, follow-up due)
- Dashboard metrics as click-through filters into the board
- Attachments tab: upload, signed-URL download, delete, with size/type errors
- Saved Views unified onto the board's own filter shape, plus rename
- Drawer accessibility: ARIA tablist with arrow-key roving focus, Escape to close
- `supabase/04_storage.sql` — the private bucket and its policies (did not exist)
- ESLint config matching Marketing's
- 61 tests (see §5)

**Palette correction:** the scaffold had invented a red/amber/green priority
scale. Replaced with Marketing's exact purple/blue/sky values, and CEO-specific
statuses mapped onto Marketing's existing status swatches rather than new hues.

---

## 4. Bugs found and fixed during the build

These were found by running the thing, not by reading it:

1. **Audit trigger blocked task deletion.** Deleting a task cascades to
   `task_assignments`; that table's `DELETE` trigger then wrote an audit row
   referencing the already-deleted task, violating the foreign key. Both the
   assignment and attachment audit triggers now skip the write when the parent
   task is itself going away.
2. **Ambiguous PostgREST embed.** `task_assignments` has two foreign keys into
   `profiles` (`stakeholder_id`, `promised_confirmed_by`), so `profiles(...)`
   was ambiguous and every task query failed. Now names the constraint.
3. **UTC date drift.** The seed generated dates with `toISOString()`. East of
   Greenwich that returns *yesterday* for most of the working day, so "due today"
   tasks rendered as overdue. The Marketing Portal carries an explicit note about
   this exact trap; the fix follows it. Caught by a failing unit test.
4. **Saved Views crashed the board.** It stored a different filter shape
   (`{priority, status, due}`) than the board consumed, and passed no `filters`
   prop. Unified on one shape.
5. **Header nav wrapped to two lines** at 1512px. Fixed with `nowrap` and
   `flex: none` on the fixed-width header elements.
6. **Account menu stayed open through sign-out.**
7. **The first-login password gate never rendered.** The server correctly stamped
   `must_set_password` and a test asserted it, but `App.jsx` only mounted
   `<Login/>` when there was no session — and a first-time account *has* a
   session. New stakeholders went straight to the board. The integration tests
   could not catch this: they verify the server, not what the client does with
   the answer.

---

## 4b. CR-01 (24 Aug 2026)

Six post-launch changes requested by the Executive Assistant, all shipped. Full
detail, including two flagged interpretations and one deviation, is in
[CHANGELOG.md](CHANGELOG.md).

The structurally significant one is CR-6 — stakeholders may now raise tasks for
themselves. It was implemented as a **separate, narrower RPC** rather than a
loosened `create_task`, so the "a stakeholder cannot assign work to anyone else"
guarantee is preserved by the shape of the function signature rather than by a
guard that could be forgotten. RLS was not changed.

---

## 5. Testing strategy

Two layers, with a deliberate split of responsibility.

**Unit (`tests/logic.test.mjs`, 23 tests)** — pure functions, no network.
Transition rules, permission predicates, filters, dashboard derivations, date
formatting, error copy.

**Integration (`tests/security.test.mjs`, 38 tests)** — against the **real**
Supabase project, signing in as real users with the **anon key**: exactly the
surface a browser has. The service role appears only to build fixtures and to
independently verify what actually landed in the table — never to perform the
action under test.

This distinction is the point. A passing test here means the *server* refused,
not that the UI hid a button. Coverage: authentication, role permissions, every
legal and illegal transition, reopening, promised-date locking, multi-assignee
independence and isolation, comment immutability, audit completeness and
tamper-resistance, archive/restore, saved-view privacy, attachment visibility,
bucket privacy, and stakeholder onboarding.

---

## 6. Risks and known limitations

| Risk | Assessment |
|---|---|
| **Demo password is shared and printed** | Fine for a demo; must be rotated before real use. Documented in DEMO.md. |
| **Two auth systems in the ecosystem** | Cognito (Marketing/Legal) and Supabase Auth (here). Users maintain two passwords. Acceptable at ~17 users; consolidating is a future call, not a v1 one. |
| **No drag-and-drop on the Kanban** | Movement is via explicit buttons and menus — keyboard-accessible, unambiguous, and every move is audited. Drag would be additive, not a replacement. |
| **Bundle is ~498 kB (139 kB gzipped)** | React DOM, the Supabase client and lucide icons. No obvious fat to cut. (An earlier revision of this row blamed Recharts — that was wrong; it was never imported, so Vite tree-shook it. The dependency has since been dropped.) |
| **9 lint warnings** | React-Compiler-era rules from `react-hooks` v7 that the Marketing Portal also violates (53 occurrences there). Kept as warnings, not disabled — see the note in `eslint.config.js`. Fixing them is a cross-product change. |
| **Attachment orphans** | If the metadata insert fails after an upload, the object is removed. If *that* cleanup fails, an unreferenced object remains — invisible to the app, but it consumes storage. |
| **No notifications** | Explicitly out of scope. The dashboard is the monitoring mechanism. |

---

## 7. Future enhancements (documented, not built)

- Email/in-app notifications for assignment, due dates and reopening
- Drag-and-drop as a progressive enhancement over the existing move controls
- Consolidating auth with the Cognito-based sibling portals
- Code-splitting the chart library
