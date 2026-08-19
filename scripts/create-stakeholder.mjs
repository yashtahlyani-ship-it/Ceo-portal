// Create a single stakeholder account from the command line.
//   node create-stakeholder.mjs "Priya Nair" priya@example.com "Head of Product"
// The person receives a temporary password (printed once) and is prompted to
// set their own on first login. Mirrors how the sibling tools onboard users.
import { ensureUser } from './lib.mjs';

const [, , name, email, title] = process.argv;
if (!name || !email) {
  console.error('Usage: node create-stakeholder.mjs "<Name>" <email> ["<Title>"]');
  process.exit(1);
}

const tempPassword = 'Gyftr@' + Math.random().toString(36).slice(2, 10) + '1!';

const id = await ensureUser({ email, password: tempPassword, name, role: 'stakeholder', title });
console.log('✓ Stakeholder created');
console.log('  name :', name);
console.log('  email:', email);
console.log('  id   :', id);
console.log('  temp password (share securely, they reset on first login):', tempPassword);
process.exit(0);
