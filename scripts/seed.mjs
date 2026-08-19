// Seed realistic synthetic demo data so the dashboard feels alive immediately.
// Safe to re-run: accounts are reused, and tasks are only seeded when the table
// is empty so repeat runs cannot pile up duplicates.
//
//   cd scripts && npm install && npm run seed
//
// The service role bypasses RLS, so rows are inserted directly. NO REAL EMPLOYEE
// DATA is used — every name below is invented and every address is @demo.gyftr.net.
// All demo accounts share the password below; change it before any real use.
import { admin, ensureUser } from './lib.mjs';

const DEMO_PASSWORD = 'Gyftr@Demo1!';

// Dates are relative to the day the seed runs, so "overdue" and "due today"
// stay true no matter when someone demos this.
const today = new Date();
// Local calendar date, not toISOString() — that is UTC, and for IST (and every
// zone east of Greenwich) it yields yesterday for most of the working day, which
// would seed "due today" tasks that render as already overdue.
const iso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (n) => { const d = new Date(today); d.setDate(d.getDate() + n); return iso(d); };
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const some = (arr, n) => [...arr].sort(() => Math.random() - 0.5).slice(0, n);
const chance = (p) => Math.random() < p;

const slug = (name) => name.trim().toLowerCase().replace(/[^a-z]+/g, '.').replace(/^\.|\.$/g, '');

const STAKEHOLDERS = [
  ['Aarav Mehta', 'Head of Marketing'],   ['Priya Nair', 'Head of Product'],
  ['Rohan Gupta', 'Head of Business'],    ['Sana Kapoor', 'Head of Engineering'],
  ['Vikram Rao', 'Head of Finance'],      ['Neha Verma', 'Head of Operations'],
  ['Karan Shah', 'Head of Sales'],        ['Isha Reddy', 'Head of Design'],
  ['Arjun Iyer', 'Head of Data'],         ['Meera Joshi', 'Head of People'],
  ['Dev Malhotra', 'Head of Partnerships'], ['Tara Singh', 'Head of Legal'],
  ['Nikhil Bose', 'Head of Support'],     ['Ananya Das', 'Head of Content'],
  ['Kabir Anand', 'Head of Growth'],
].map(([name, title]) => ({ name: name.trim(), title, email: `${slug(name)}@demo.gyftr.net` }));

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

const STAKEHOLDER_NOTES = [
  'Started reviewing the brief — will share a plan shortly.',
  'Blocked on numbers from Finance; chasing today.',
  'First draft ready, moving it into review.',
  'Need one more day on the annexures.',
  'Reworked per the last round of feedback.',
];
const EXEC_NOTES = [
  'Thanks. Please confirm your promised date by end of week.',
  'Noted — keep the board deck angle in mind.',
  'Let us discuss this in the Monday review.',
  'Please prioritise this one over the vendor work.',
];

// Attachment METADATA only. No bytes are uploaded, so nothing here is fetchable
// — it exists to make the drawer's Attachments tab look real in a demo.
const FILES = [
  ['Q4-brief.pdf', 'application/pdf', 284_115],
  ['budget-draft.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 71_420],
  ['board-notes.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 38_902],
  ['dashboard-mock.png', 'image/png', 512_338],
];

async function main() {
  console.log('Creating executive accounts…');
  const eaId = await ensureUser({
    email: 'ea@demo.gyftr.net', password: DEMO_PASSWORD, name: 'Executive Assistant',
    role: 'ea', title: "CEO's Office — EA", mustSetPassword: false,
  });
  const ceoId = await ensureUser({
    email: 'ceo@demo.gyftr.net', password: DEMO_PASSWORD, name: 'Chief Executive',
    role: 'ceo', title: 'CEO', mustSetPassword: false,
  });

  console.log(`Creating ${STAKEHOLDERS.length} stakeholders…`);
  const sh = [];
  for (const s of STAKEHOLDERS) {
    const id = await ensureUser({
      email: s.email, password: DEMO_PASSWORD, name: s.name,
      role: 'stakeholder', title: s.title, mustSetPassword: false,
    });
    sh.push({ ...s, id });
  }

  const { count } = await admin.from('tasks').select('id', { count: 'exact', head: true });
  if (count && count > 0) {
    console.log(`Tasks already present (${count}). Skipping task seed; accounts are ready.`);
    return printLogins();
  }

  console.log('Creating 72 tasks with assignments, promises, comments, attachments…');
  for (let i = 0; i < 72; i++) {
    const priority = pick(PRIORITIES);
    // Spread expected dates across overdue / today / this week / later so every
    // dashboard metric has something in it.
    const b = Math.random();
    const expected = b < 0.20 ? addDays(-1 - Math.floor(Math.random() * 20))
      : b < 0.30 ? addDays(0)
      : b < 0.60 ? addDays(1 + Math.floor(Math.random() * 7))
      : addDays(8 + Math.floor(Math.random() * 30));
    const followup = chance(0.5) ? addDays(-2 + Math.floor(Math.random() * 10)) : null;
    const creator = chance(0.5) ? eaId : ceoId;

    const { data: task, error: tErr } = await admin.from('tasks').insert({
      title: i < TITLES.length ? TITLES[i] : `${pick(TITLES)} · ${i}`,
      description: 'Executive request from the CEO Office. Detailed brief to follow in the attached documents.',
      priority, expected_date: expected, next_followup_date: followup, created_by: creator,
    }).select().single();
    if (tErr) throw tErr;

    for (const a of some(sh, 1 + Math.floor(Math.random() * 3))) {
      const row = { task_id: task.id, stakeholder_id: a.id, status: pick(STATUSES) };
      const pr = Math.random();
      if (pr < 0.3) {
        row.promised_proposed = addDays(2 + Math.floor(Math.random() * 10));
        row.promised_state = 'proposed';
      } else if (pr < 0.6) {
        const pd = addDays(2 + Math.floor(Math.random() * 10));
        row.promised_proposed = pd;
        row.promised_date = pd;
        row.promised_state = 'confirmed';
        row.promised_confirmed_by = creator;
        row.promised_confirmed_at = new Date().toISOString();
      }
      const { data: asg, error: aErr } = await admin.from('task_assignments').insert(row).select().single();
      if (aErr) throw aErr;

      // Comments live in the assignee's own thread, which is exactly how the
      // isolation works at runtime.
      if (asg && chance(0.5)) {
        await admin.from('task_comments').insert({
          task_id: task.id, assignment_id: asg.id, author_id: a.id,
          author_role: 'stakeholder', body: pick(STAKEHOLDER_NOTES),
        });
        if (chance(0.5)) {
          await admin.from('task_comments').insert({
            task_id: task.id, assignment_id: asg.id, author_id: creator,
            author_role: creator === ceoId ? 'ceo' : 'ea', body: pick(EXEC_NOTES),
          });
        }
      }
    }

    if (chance(0.25)) {
      const [file_name, mime_type, size_bytes] = pick(FILES);
      await admin.from('task_attachments').insert({
        task_id: task.id,
        storage_path: `task/${task.id}/seed-${file_name}`,
        file_name, mime_type, size_bytes, uploaded_by: creator,
      });
    }

    if (chance(0.08)) {
      await admin.from('tasks').update({
        archived: true, archived_at: new Date().toISOString(), archived_by: creator,
      }).eq('id', task.id);
    }
  }

  console.log('Creating starter saved views for the EA and CEO…');
  const VIEWS = [
    ['Executive Priorities', { priority: 'high', status: null }],
    ['Overdue Tasks', { to: addDays(-1) }],
    ['Due This Week', { from: addDays(0), to: addDays(7) }],
    ["Today's Follow-ups", { followupsDue: true }],
  ];
  for (const owner of [eaId, ceoId]) {
    for (const [name, filters] of VIEWS) {
      await admin.from('saved_views').insert({ owner_id: owner, name, filters });
    }
  }

  console.log('✓ Seed complete.');
  printLogins();
}

function printLogins() {
  console.log(`\n── Demo logins (password for all: ${DEMO_PASSWORD}) ──`);
  console.log('  EA  : ea@demo.gyftr.net');
  console.log('  CEO : ceo@demo.gyftr.net');
  console.log('  Stakeholders:');
  for (const s of STAKEHOLDERS) console.log(`    ${s.email.padEnd(34)} ${s.title}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
