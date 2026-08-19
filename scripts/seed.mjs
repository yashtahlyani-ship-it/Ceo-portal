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
// is deterministic and safe to re-run. Service role bypasses RLS.
import { admin, ensureUser } from './lib.mjs';

const DEMO_PASSWORD = 'Gyftr@Demo1!';
const today = new Date('2026-08-17');
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (n) => { const d = new Date(today); d.setDate(d.getDate() + n); return iso(d); };
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const some = (arr, n) => [...arr].sort(() => Math.random() - 0.5).slice(0, n);

// Real people from the Marketing / Tech / Legal portals, cast as CEO-Office
// department heads. (name, title)
const STAKEHOLDERS = [
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
  name, title,
  email: name.toLowerCase().replace(/[^a-z]+/g, '.').replace(/^\.|\.$/g, '') + '@demo.gyftr.net',
}));

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
async function reset() {
  console.log('Resetting existing demo data…');
  for (const t of ['audit_log', 'saved_views', 'task_comments', 'task_attachments', 'task_assignments', 'tasks']) {
    await admin.from(t).delete().gt('id', 0);
  }
  // Delete @demo.gyftr.net auth users (profiles cascade on delete).
  let page = 1;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error || !data || data.users.length === 0) break;
    for (const u of data.users) {
      if (u.email?.endsWith('@demo.gyftr.net')) await admin.auth.admin.deleteUser(u.id);
    }
    if (data.users.length < 200) break;
    page++;
  }
}

async function seedViews(ownerId) {
  const views = [
    ['Executive Priorities', { priority: 'high' }],
    ['Overdue Tasks', { to: addDays(-1) }],
    ['Due This Week', { from: addDays(0), to: addDays(7) }],
    ["Today's Follow-ups", { followupsDue: true }],
  ];
  for (const [name, filters] of views) {
    await admin.from('saved_views').insert({ owner_id: ownerId, name, filters });
  }
}

async function main() {
  await reset();

  console.log('Creating executive accounts…');
  const eaId = await ensureUser({ email: 'ea@demo.gyftr.net', password: DEMO_PASSWORD, name: 'Anushka Mishra', role: 'ea', title: "CEO's Office · Executive Assistant" });
  const ceoId = await ensureUser({ email: 'ceo@demo.gyftr.net', password: DEMO_PASSWORD, name: 'Chief Executive', role: 'ceo', title: 'Chief Executive Officer' });

  console.log('Creating 15 stakeholders (real names, demo logins)…');
  const sh = [];
  for (const s of STAKEHOLDERS) {
    const id = await ensureUser({ email: s.email, password: DEMO_PASSWORD, name: s.name, role: 'stakeholder', title: s.title });
    sh.push({ ...s, id });
  }

  console.log('Seeding saved views for EA and CEO…');
  await seedViews(eaId);
  await seedViews(ceoId);

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

    const { data: task } = await admin.from('tasks').insert({
      title: `${pick(TITLES)}${i >= TITLES.length ? ' · ' + i : ''}`,
      description: 'Executive request from the CEO Office. Detailed brief to follow in the attached documents.',
      priority, expected_date: expected, next_followup_date: followup, created_by: creator,
    }).select().single();

    const assignees = some(sh, 1 + Math.floor(Math.random() * 3));
    for (const a of assignees) {
      const status = pick(STATUSES);
      const row = { task_id: task.id, stakeholder_id: a.id, status };
      const pr = Math.random();
      if (pr < 0.3) { row.promised_proposed = addDays(2 + Math.floor(Math.random() * 10)); row.promised_state = 'proposed'; }
      else if (pr < 0.6) {
        const pd = addDays(2 + Math.floor(Math.random() * 10));
        row.promised_proposed = pd; row.promised_date = pd; row.promised_state = 'confirmed';
        row.promised_confirmed_by = creator; row.promised_confirmed_at = new Date().toISOString();
      }
      const { data: asg } = await admin.from('task_assignments').insert(row).select().single();
      if (asg && Math.random() < 0.5) {
        await admin.from('task_comments').insert({
          task_id: task.id, assignment_id: asg.id, author_id: a.id, author_role: 'stakeholder',
          body: 'Started reviewing the brief — will share a plan shortly.',
        });
        if (Math.random() < 0.5) {
          await admin.from('task_comments').insert({
            task_id: task.id, assignment_id: asg.id, author_id: creator, author_role: creator === ceoId ? 'ceo' : 'ea',
            body: 'Thanks. Please confirm your promised date by end of week.',
          });
        }
      }
    }
    if (Math.random() < 0.08) {
      await admin.from('tasks').update({ archived: true, archived_at: new Date().toISOString(), archived_by: creator }).eq('id', task.id);
    }
  }
  console.log('✓ Seed complete.');
  printLogins();
}

function printLogins() {
  console.log('\n── Demo logins (password for all: ' + DEMO_PASSWORD + ') ──');
  console.log('  EA  : ea@demo.gyftr.net   (Anushka Mishra · CEO\'s Office)');
  console.log('  CEO : ceo@demo.gyftr.net  (Chief Executive)');
  console.log('  Stakeholders: <first>.<last>@demo.gyftr.net — e.g. rajneesh@demo.gyftr.net, deepankar.hemnani@demo.gyftr.net');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
