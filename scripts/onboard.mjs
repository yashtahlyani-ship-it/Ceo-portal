// Onboard the REAL team from scripts/roster.json.
//
//   cd scripts && node onboard.mjs           # dry run — shows what would happen
//   cd scripts && node onboard.mjs --apply   # actually create the accounts
//
// This is NOT the demo seed. Differences that matter:
//
//   · It never touches tasks. It only creates or updates people, so it is safe
//     to run against a database that already holds real work.
//   · Every person gets their OWN random password, never a shared one. The demo
//     accounts share Default@123; real accounts must not.
//   · Everyone is stamped must_set_password, so the temporary value is dead the
//     moment they choose their own.
//   · It tries an email invite first and falls back to a printed password only
//     when mail cannot be sent — and says which happened, per person.
//
// The roster lives in scripts/roster.json, which is gitignored: this repository
// is public, and a real directory of names and working addresses is what gets
// scraped for phishing. See roster.example.json.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { admin } from './lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes('--apply');
// --shared-password uses DEMO_PASSWORD for everyone instead of a unique random
// one each. NOT the default, and not what you want once this holds real work:
// one password across the whole company means one leak exposes every account.
// It exists because evaluation is easier when everyone can just get in.
const SHARED = process.argv.includes('--shared-password');
const ROSTER = join(here, 'roster.json');

if (!existsSync(ROSTER)) {
  console.error('No scripts/roster.json found.');
  console.error('Copy scripts/roster.example.json to scripts/roster.json and fill it in.');
  console.error('Do NOT commit it — this repository is public.');
  process.exit(1);
}

const { people } = JSON.parse(readFileSync(ROSTER, 'utf8'));
if (!Array.isArray(people) || people.length === 0) {
  console.error('roster.json has no "people" array.');
  process.exit(1);
}

// Strong, unique, and satisfying the project's password policy (upper, lower,
// digit, symbol, 8+). Only ever needed when the invite email cannot be sent.
function tempPassword() {
  const pick = (s) => s[randomBytes(1)[0] % s.length];
  const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '!@#$%^&*'];
  const all = sets.join('');
  const out = sets.map(pick);
  while (out.length < 16) out.push(pick(all));
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomBytes(1)[0] % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.join('');
}

// ── Validate before touching anything ────────────────────────────────────────
const problems = [];
const byEmail = new Map();
for (const [i, p] of people.entries()) {
  const row = `row ${i + 1} (${p.name || 'unnamed'})`;
  if (!p.name?.trim()) problems.push(`${row}: missing name`);
  if (!p.email?.trim()) problems.push(`${row}: missing email`);
  if (!['ea', 'ceo', 'stakeholder'].includes(p.role)) {
    problems.push(`${row}: role must be ea | ceo | stakeholder, got ${JSON.stringify(p.role)}`);
  }
  const key = p.email?.trim().toLowerCase();
  if (key && byEmail.has(key)) {
    problems.push(`${row}: duplicate email ${key} — already used by ${byEmail.get(key)}. `
      + `Emails are unique, so one of these rows must change.`);
  } else if (key) byEmail.set(key, p.name);
}
const eas = people.filter((p) => p.role === 'ea').length;
const ceos = people.filter((p) => p.role === 'ceo').length;
const warnings = [];
if (eas !== 1) problems.push(`expected exactly one 'ea', found ${eas}`);
// Not an error: 'ea' and 'ceo' have identical powers in this tool, so a roster
// with only an EA is workable. Worth saying out loud, though — nobody is
// holding the CEO login.
if (ceos === 0) warnings.push("no 'ceo' in the roster — the EA carries every executive permission, so this works, but add the CEO when you have their address");
if (ceos > 1) problems.push(`expected at most one 'ceo', found ${ceos}`);

if (warnings.length) {
  console.warn(String.fromCharCode(10) + 'Notes:');
  warnings.forEach((w) => console.warn('  ·', w));
}

if (problems.length) {
  console.error('\nRoster has problems — nothing was changed:\n');
  problems.forEach((p) => console.error('  ·', p));
  process.exit(1);
}

// ── Report, then (optionally) act ────────────────────────────────────────────
async function main() {
  const { data: existingList } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const existing = new Map(existingList.users.map((u) => [u.email?.toLowerCase(), u]));

  console.log(`\n${APPLY ? 'Onboarding' : 'DRY RUN —'} ${people.length} people\n`);
  const results = [];

  for (const p of people) {
    const email = p.email.trim().toLowerCase();
    const name = p.name.trim();
    const title = (p.title || '').trim();
    const already = existing.get(email);

    if (!APPLY) {
      console.log(`  ${already ? 'update' : 'create'}  ${email.padEnd(32)} ${name} · ${title || '—'} [${p.role}]`);
      continue;
    }

    if (already) {
      // Never reset a password for someone who already has an account — they may
      // already be using it. Only bring name/title/role up to date.
      await admin.from('profiles').upsert({ id: already.id, email, name, title, role: p.role, active: true });
      results.push({ email, name, outcome: 'updated (password untouched)' });
      continue;
    }

    const meta = { name, role: p.role, title };
    const invite = SHARED
      ? { error: { message: 'shared-password mode: no invite sent' } }
      : await admin.auth.admin.inviteUserByEmail(email, { data: meta });
    if (!invite.error && invite.data?.user) {
      await admin.from('profiles').upsert({
        id: invite.data.user.id, email, name, title, role: p.role, active: true,
      });
      results.push({ email, name, outcome: 'invited by email' });
      continue;
    }

    const pw = SHARED ? process.env.DEMO_PASSWORD : tempPassword();
    if (SHARED && !pw) { console.error('--shared-password needs DEMO_PASSWORD in ../.env'); process.exit(1); }
    const created = await admin.auth.admin.createUser({
      email, password: pw, email_confirm: true,
      user_metadata: { ...meta, must_set_password: !SHARED },
    });
    if (created.error) {
      results.push({ email, name, outcome: `FAILED: ${created.error.message}` });
      continue;
    }
    await admin.from('profiles').upsert({
      id: created.data.user.id, email, name, title, role: p.role, active: true,
    });
    results.push({
      email, name,
      outcome: SHARED ? 'created with the shared password' : 'temporary password (invite email failed)',
      password: SHARED ? null : pw, reason: invite.error?.message,
    });
  }

  if (!APPLY) {
    console.log('\nNothing was changed. Re-run with --apply to create these accounts.');
    return;
  }

  console.log('\n── Results ──');
  for (const r of results) console.log(`  ${r.email.padEnd(32)} ${r.outcome}`);

  const needPw = results.filter((r) => r.password);
  if (needPw.length) {
    console.log('\n── Temporary passwords — share each one privately, then delete this output ──');
    console.log(`   (the invite email could not be sent: ${needPw[0].reason})`);
    for (const r of needPw) console.log(`  ${r.email.padEnd(32)} ${r.password}`);
    console.log('\n   Each person must set their own password on first sign-in.');
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
