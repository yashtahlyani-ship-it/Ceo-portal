// Seed realistic demo data so the dashboard feels alive immediately.
//
//   cd scripts && npm install && npm run seed
//
// The roster uses REAL names/titles drawn from the sibling Gyftr portals
// (Marketing, Tech, Legal) so the CEO Office directory reflects the real
// organisation. Login emails are kept on @demo.gyftr.net (NOT real corporate
// mailboxes) because every demo account shares one password — the names are
// real, the credentials are throwaway. Change the password and remove these
// accounts before any real use.
//
// This script RESETS first (clears demo data + @demo.gyftr.net accounts), so it
// is deterministic and safe to re-run. It connects as the database owner, so
// Row-Level Security does not apply.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { db, ensureUser, deleteUser, hasCognito } from './lib.mjs';

// Read from .env (gitignored), never hard-coded — this repository is public and
// these accounts are live on a publicly reachable deployment. See HANDOVER.md.
const DEMO_PASSWORD = process.env.DEMO_PASSWORD;
if (!DEMO_PASSWORD) {
  console.error('Missing DEMO_PASSWORD in ../.env');
  console.error('Set it to the password you want every demo account to share, then re-run.');
  process.exit(1);
}

// Without a user pool, ensureUser() writes profile rows and silently creates no
// Cognito accounts — producing a database full of people who cannot sign in and
// a demo that looks broken for a reason nothing reports. The other three
// scripts already refuse this; so does this one.
if (!hasCognito) {
  console.error('COGNITO_USER_POOL_ID is not set in ../.env.');
  console.error('Seeding without it would create profiles with no accounts behind them,');
  console.error('and nobody could log in. Set it, then re-run.');
  process.exit(1);
}
// Relative to the day the seed RUNS, so "overdue" and "due today" stay true
// whenever someone demos this. A frozen date silently ages the whole dataset.
const today = new Date();
// Local calendar date, NOT toISOString() — that is UTC, and east of Greenwich it
// yields yesterday for most of the working day, seeding "due today" tasks that
// render as already overdue. See HANDOVER.md §9.
const iso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (n) => { const d = new Date(today); d.setDate(d.getDate() + n); return iso(d); };
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const some = (arr, n) => [...arr].sort(() => Math.random() - 0.5).slice(0, n);

// ── Who to seed ──────────────────────────────────────────────────────────────
// If scripts/roster.json exists, the REAL team is used — that file is gitignored
// because this repository is public and a directory of working corporate
// addresses is what gets scraped for phishing.
//
// Without it, the fallback roster below is used, so a fresh clone still produces
// a working demo. The fallback names come from the sibling Gyftr portals and are
// deliberately on @demo.gyftr.net, never real mailboxes.
const FALLBACK = [
  ['Neha', 'Head of Business'],
  ['Saurabh', 'Head of Product'],
  ['Rajneesh', 'Chief Technology Officer'],
  ['Anandita', 'Head of Technology Delivery'],
  ['Karan', 'Head of Quality'],
  ['Deepankar Hemnani', 'Head of Content'],
  ['Ajay Kumar', 'Head of Creative'],
  ['Nitin', 'Head of Legal'],
  ['Nikhil', 'Head of Compliance'],
  ['Nikunj Kanodia', 'Head of Finance'],
  ['Anirudh Motwani', 'Head of Strategy'],
  ['Rahul Joshi', 'Head of Partnerships'],
  ['Priya Sharma', 'Head of Marketing'],
  ['Kushagra', 'Head of Legal Operations'],
  ['Pankaj Mehta', 'Head of Operations'],
].map(([name, title]) => ({
  name, title, role: 'stakeholder',
  email: name.toLowerCase().replace(/[^a-z]+/g, '.').replace(/^\.|\.$/g, '') + '@demo.gyftr.net',
}));

const ROSTER_PATH = join(dirname(fileURLToPath(import.meta.url)), 'roster.json');
const USING_REAL = existsSync(ROSTER_PATH);
const ROSTER = USING_REAL
  ? JSON.parse(readFileSync(ROSTER_PATH, 'utf8')).people
  : [
      { name: 'Anushka Mishra', email: 'ea@demo.gyftr.net', title: "CEO's Office · Executive Assistant", role: 'ea' },
      { name: 'Chief Executive', email: 'ceo@demo.gyftr.net', title: 'Chief Executive Officer', role: 'ceo' },
      ...FALLBACK,
    ];

const TITLES = [
  'Prepare Q4 Growth Strategy', 'Finalize FY27 budget draft', 'Board deck for October review',
  'Vendor consolidation proposal', 'Customer churn deep-dive', 'New pricing model rollout plan',
  'Hiring plan for next quarter', 'Compliance audit readiness', 'Brand refresh proposal',
  'Partnership MOU with bank', 'Data warehouse migration plan', 'Support SLA improvement plan',
  'Annual offsite logistics', 'Competitor teardown report', 'NPS improvement initiative',
  'Regional expansion business case', 'Cost optimization review', 'Product roadmap alignment',
  'Investor update draft', 'Loyalty programme revamp', 'Cybersecurity posture review',
  'Marketing attribution overhaul', 'Warehouse automation study', 'Talent retention framework',
];
const STATUSES = ['todo', 'in_progress', 'under_review', 'done', 'reopened'];
const PRIORITIES = ['high', 'medium', 'low'];

// ── Reset: clear demo data + demo accounts so a re-run is deterministic ───────
const SEEDED_EMAILS = new Set(ROSTER.map((p) => p.email.trim().toLowerCase()));

async function reset() {
  console.log('Resetting existing demo data…');
  // saved_views is gone as of CR-02 #1. notifications cascade from tasks, but
  // clearing them explicitly keeps a re-seed from leaving stale bell items.
  //
  // Order matters: children before parents, because these are plain DELETEs
  // rather than a cascade from `tasks`, and audit_log holds references that
  // would otherwise block the tasks delete.
  for (const t of ['audit_log', 'notifications', 'task_comments', 'task_attachments', 'task_assignments', 'tasks']) {
    await db.query(`delete from ${t}`);
  }

  // Remove the accounts this script created, so a re-seed is deterministic.
  //
  // Driven by the roster rather than by listing the pool: only emails that ARE
  // in the roster in use are deleted, so a re-seed can never remove somebody
  // who was onboarded separately. (Listing and matching would give the same
  // result but reads as "delete everything that looks like ours", which is one
  // careless edit away from being true.)
  if (hasCognito) {
    for (const email of SEEDED_EMAILS) await deleteUser(email);
  }
  await db.query('delete from profiles where lower(email) = any($1)', [[...SEEDED_EMAILS]]);
}

async function main() {
  await reset();

  console.log(`Creating ${ROSTER.length} accounts from ${USING_REAL ? 'roster.json (REAL team)' : 'the built-in demo roster'}…`);
  // mustSetPassword:false — every seeded account shares DEMO_PASSWORD and must
  // sign straight in. ensureUser defaults it to TRUE (correct for real
  // onboarding), so omitting it here strands every login on "Set a new password".
  const ids = new Map();
  for (const p of ROSTER) {
    const id = await ensureUser({
      email: p.email.trim().toLowerCase(), password: DEMO_PASSWORD,
      name: p.name.trim(), role: p.role, title: (p.title || '').trim(),
      mustSetPassword: false,
    });
    ids.set(p.email.trim().toLowerCase(), id);
  }
  const execs = ROSTER.filter((p) => p.role === 'ea' || p.role === 'ceo')
    .map((p) => ids.get(p.email.trim().toLowerCase()));
  const sh = ROSTER.filter((p) => p.role === 'stakeholder')
    .map((p) => ({ ...p, id: ids.get(p.email.trim().toLowerCase()) }));
  // Tasks are raised by whoever holds an executive role. With only an EA on the
  // roster, that is her — the tool does not require a separate CEO.
  const eaId = execs[0];
  const ceoId = execs[1] ?? execs[0];

  console.log('Creating ~64 tasks with assignments, promises, comments…');
  for (let i = 0; i < 64; i++) {
    const priority = pick(PRIORITIES);
    const bucket = Math.random();
    const expected = bucket < 0.22 ? addDays(-1 - Math.floor(Math.random() * 20))
      : bucket < 0.32 ? addDays(0)
      : bucket < 0.6 ? addDays(1 + Math.floor(Math.random() * 7))
      : addDays(8 + Math.floor(Math.random() * 30));
    const followup = Math.random() < 0.5 ? addDays(-2 + Math.floor(Math.random() * 10)) : null;
    const creator = Math.random() < 0.5 ? eaId : ceoId;

    const { rows: [task] } = await db.query(
      `insert into tasks (title, description, priority, expected_date, next_followup_date, created_by)
       values ($1,$2,$3,$4,$5,$6) returning id`,
      [
        `${pick(TITLES)}${i >= TITLES.length ? ' · ' + i : ''}`,
        'Executive request from the CEO Office. Detailed brief to follow in the attached documents.',
        priority, expected, followup, creator,
      ]
    );

    const assignees = some(sh, 1 + Math.floor(Math.random() * 3));
    for (const a of assignees) {
      const status = pick(STATUSES);
      let proposed = null, promised = null, state = 'none', confirmedBy = null, confirmedAt = null;
      const pr = Math.random();
      if (pr < 0.3) {
        proposed = addDays(2 + Math.floor(Math.random() * 10));
        state = 'proposed';
      } else if (pr < 0.6) {
        proposed = promised = addDays(2 + Math.floor(Math.random() * 10));
        state = 'confirmed';
        confirmedBy = creator;
        confirmedAt = new Date().toISOString();
      }

      const { rows: [asg] } = await db.query(
        `insert into task_assignments
           (task_id, stakeholder_id, status, promised_proposed, promised_date,
            promised_state, promised_confirmed_by, promised_confirmed_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
        [task.id, a.id, status, proposed, promised, state, confirmedBy, confirmedAt]
      );

      if (asg && Math.random() < 0.5) {
        await db.query(
          `insert into task_comments (task_id, assignment_id, author_id, author_role, body)
           values ($1,$2,$3,'stakeholder',$4)`,
          [task.id, asg.id, a.id, 'Started reviewing the brief — will share a plan shortly.']
        );
        if (Math.random() < 0.5) {
          await db.query(
            `insert into task_comments (task_id, assignment_id, author_id, author_role, body)
             values ($1,$2,$3,$4,$5)`,
            [task.id, asg.id, creator, creator === ceoId ? 'ceo' : 'ea',
             'Thanks. Please confirm your promised date by end of week.']
          );
        }
      }
    }
    if (Math.random() < 0.08) {
      await db.query(
        'update tasks set archived = true, archived_at = now(), archived_by = $2 where id = $1',
        [task.id, creator]
      );
    }
  }
  // CR-01 #6: a few tasks stakeholders raised for themselves, so a fresh
  // install can demonstrate the Self-created tag without anyone having to
  // create one by hand first. `created_by` is a stakeholder, which is exactly
  // what makes a task self-created — the app derives it, nothing is stored.
  console.log('Creating self-raised tasks (CR-01 #6)…');
  const SELF_RAISED = [
    ['Draft my Q4 team plan', 'Headcount, budget and hiring sequence for the quarter.'],
    ['Vendor renewal shortlist', ''],                       // deliberately no summary (CR-01 #1)
    ['Refresh onboarding checklist', 'Ours is a year out of date.'],
  ];
  for (let i = 0; i < SELF_RAISED.length; i++) {
    const owner = sh[i % sh.length];
    const [title, description] = SELF_RAISED[i];
    const { rows: [task] } = await db.query(
      `insert into tasks (title, description, priority, expected_date, created_by)
       values ($1,$2,$3,$4,$5) returning id`,
      // created_by is a stakeholder, which is exactly what makes a task
      // self-created — the app derives it, nothing is stored.
      [title, description, pick(PRIORITIES), addDays(5 + i * 4), owner.id]
    );
    // Exactly one assignment, to the person who raised it.
    await db.query(
      'insert into task_assignments (task_id, stakeholder_id) values ($1,$2)',
      [task.id, owner.id]
    );
  }

  console.log('✓ Seed complete.');
  printLogins();
}

function printLogins() {
  console.log(`${String.fromCharCode(10)}── Logins (password for all: the DEMO_PASSWORD in your .env) ──`);
  for (const p of ROSTER) {
    const tag = p.role === 'stakeholder' ? '' : `  [${p.role.toUpperCase()}]`;
    console.log(`  ${p.email.padEnd(32)} ${p.name} · ${p.title || '—'}${tag}`);
  }
  if (USING_REAL) {
    console.log(`${String.fromCharCode(10)}  These are REAL addresses sharing one password, on a public URL.`);
    console.log('  Configure SMTP and move to per-person invites before this holds real work.');
  }
}

main()
  .then(async () => { await db.end(); process.exit(0); })
  .catch(async (e) => { console.error(e); await db.end().catch(() => {}); process.exit(1); });
