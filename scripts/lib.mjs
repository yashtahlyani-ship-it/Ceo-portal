// Shared plumbing for the admin scripts.
//
// These connect DIRECTLY to Postgres as the owning user, so Row-Level Security
// does not apply — the equivalent of the old Supabase service-role key. They
// run on an operator's machine or a bastion, never in the app, and never in the
// browser.
//
// ── Migration note ───────────────────────────────────────────────────────────
// Before the AWS move these used supabase-js: one client for both the database
// and the auth admin API. Those are now two different services, so this file
// has two clients — `db` (pg) and `cognito` — and creating a person means
// touching both. ensureUser() below keeps that a single call.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import dotenv from 'dotenv';
import pg from 'pg';
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  AdminGetUserCommand,
  AdminDeleteUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';

// These scripts run from scripts/, but the env file lives at the project root —
// load it explicitly rather than relying on the working directory.
dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), '..', '.env') });

const { Pool } = pg;

const required = ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Missing ${missing.join(', ')} in ../.env`);
  console.error('Copy ../.env.example to ../.env and fill them in.');
  process.exit(1);
}

export const db = new Pool({
  host:     process.env.DB_HOST,
  port:     parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl:      process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  max: 4,
});

export const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID;

export const cognito = new CognitoIdentityProviderClient({
  region: process.env.COGNITO_REGION || process.env.AWS_REGION || 'ap-south-1',
});

// Some scripts (the demo seed against a local database) have no Cognito pool to
// talk to and only need profile rows. Let them say so explicitly rather than
// failing deep inside an AWS call with an unhelpful credentials error.
export const hasCognito = Boolean(USER_POOL_ID);

export function temporaryPassword() {
  // Must satisfy Cognito's complexity policy: upper, lower, digit, symbol.
  return 'Gyftr@' + Math.random().toString(36).slice(2, 12) + '1!';
}

/**
 * Create (or update) a person: a Cognito account plus a profile row.
 * Returns the profile id.
 *
 * `password`
 *   Given    → set as a PERMANENT password. Used by the demo seed so the
 *              accounts sign straight in.
 *   Omitted  → Cognito emails an invitation and the account stays in
 *              FORCE_CHANGE_PASSWORD, so the person sets their own.
 *
 * `mustSetPassword` mirrors that into the profiles table for the admin views.
 * It is NOT the gate any more — Cognito's challenge is, and it cannot be
 * bypassed by a client that forgets to check a flag. See backend/routes/admin.js.
 *
 * Idempotent: re-running never resets an existing person's password, which is
 * what makes onboard.mjs safe to run against a database holding real work.
 */
export async function ensureUser({ email, password, name, role, title, mustSetPassword = true }) {
  email = email.trim().toLowerCase();

  let sub = null;

  if (hasCognito) {
    try {
      const existing = await cognito.send(new AdminGetUserCommand({
        UserPoolId: USER_POOL_ID, Username: email,
      }));
      sub = existing.UserAttributes?.find(a => a.Name === 'sub')?.Value ?? null;
      // Deliberately does NOT touch the password of an account that already
      // exists. Re-running a roster import must never lock somebody out of an
      // account they have already set up.
    } catch (err) {
      if (err.name !== 'UserNotFoundException') throw err;

      const created = await cognito.send(new AdminCreateUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: email,
        ...(password
          ? { MessageAction: 'SUPPRESS', TemporaryPassword: password }
          : { DesiredDeliveryMediums: ['EMAIL'] }),
        UserAttributes: [
          { Name: 'email',          Value: email },
          { Name: 'email_verified', Value: 'true' },
          { Name: 'name',           Value: name },
        ],
      }));
      sub = created.User?.Attributes?.find(a => a.Name === 'sub')?.Value ?? null;

      if (password) {
        // Permanent: the demo accounts must sign straight in without a
        // first-login challenge, or every seeded login is a dead end.
        await cognito.send(new AdminSetUserPasswordCommand({
          UserPoolId: USER_POOL_ID, Username: email, Password: password, Permanent: true,
        }));
      }
    }
  }

  const { rows } = await db.query(
    `insert into profiles (cognito_sub, email, name, role, title, active, must_set_password)
     values ($1, $2, $3, $4, $5, true, $6)
     on conflict (email) do update
        set name              = excluded.name,
            role              = excluded.role,
            title             = excluded.title,
            active            = true,
            must_set_password = excluded.must_set_password,
            cognito_sub       = coalesce(excluded.cognito_sub, profiles.cognito_sub)
     returning id`,
    [sub, email, name, role, title ?? null, mustSetPassword]
  );

  return rows[0].id;
}

/** Remove a Cognito account. Used by tests and by undoing a mistaken invite. */
export async function deleteUser(email) {
  if (!hasCognito) return;
  try {
    await cognito.send(new AdminDeleteUserCommand({ UserPoolId: USER_POOL_ID, Username: email }));
  } catch (err) {
    if (err.name !== 'UserNotFoundException') throw err;
  }
}
