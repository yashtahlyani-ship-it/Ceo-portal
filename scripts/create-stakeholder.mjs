// Create a single stakeholder account from the command line.
//   node create-stakeholder.mjs "Priya Nair" priya@example.com "Head of Product"
//
// Cognito emails them an invitation with a temporary password; they set their
// own on first login. Mirrors how the sibling portals onboard people.
//
// Prefer the in-app "Invite Stakeholder" button for routine onboarding — it
// does the same thing and leaves the EA in control. This exists for bulk work
// and for when the UI is not reachable.
import { ensureUser, db, hasCognito } from './lib.mjs';

const [, , name, email, title] = process.argv;
if (!name || !email) {
  console.error('Usage: node create-stakeholder.mjs "<Name>" <email> ["<Title>"]');
  process.exit(1);
}

if (!hasCognito) {
  console.error('COGNITO_USER_POOL_ID is not set — this would create a profile row with no');
  console.error('account behind it, and the person could never sign in. Set it in ../.env.');
  process.exit(1);
}

const id = await ensureUser({ email, name, role: 'stakeholder', title });

console.log('✓ Stakeholder invited');
console.log('  name :', name);
console.log('  email:', email);
console.log('  id   :', id);
console.log('');
console.log('  Cognito has emailed them a temporary password. They will be asked to');
console.log('  choose their own before they can reach the board.');

await db.end();
process.exit(0);
