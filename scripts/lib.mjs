// Shared service-role client for admin scripts. The service role key bypasses
// RLS — it must NEVER ship to the browser. These scripts run on your machine only.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

// These scripts run from scripts/, but the env file lives at the project root —
// load it explicitly rather than relying on the working directory.
dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), '..', '.env') });

const url = process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in ../.env');
  console.error('Copy ../.env.example to ../.env and fill both in.');
  process.exit(1);
}

export const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Create (or fetch) an auth user + profile with a given role. Returns profile id.
//
// mustSetPassword stamps the first-login flag that hooks/useAuth.jsx reads. Real
// onboarding passes true (the person is on a temporary password); the demo seed
// passes false so the demo accounts sign straight in.
export async function ensureUser({ email, password, name, role, title, mustSetPassword = true }) {
  // Create the auth user with metadata the handle_new_auth_user() trigger reads.
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name, role, title, must_set_password: mustSetPassword },
  });
  if (error) {
    if (String(error.message).toLowerCase().includes('already')) {
      const { data: list } = await admin.auth.admin.listUsers();
      const found = list.users.find((u) => u.email === email);
      if (found) return found.id;
    }
    throw error;
  }
  const id = data.user.id;
  // Make sure the profile reflects the intended role/title (trigger may have
  // defaulted before metadata was read on some stacks).
  await admin.from('profiles').upsert({ id, email, name, role, title, active: true });
  return id;
}
