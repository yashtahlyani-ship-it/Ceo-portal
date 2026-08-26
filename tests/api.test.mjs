// ════════════════════════════════════════════════════════════════════════════
//  API-LEVEL TESTS — Cognito sign-in, S3 attachments, invite onboarding
//
//  These are the four things security.test.mjs used to cover but no longer can,
//  because they stopped being database behaviour when the platform moved to AWS:
//
//    · password sign-in            Supabase Auth  → Cognito
//    · the invite flow             Edge Function  → POST /api/admin/stakeholders
//    · attachment byte round-trip  Storage RLS    → S3 presigned URL
//    · a non-assignee being refused a download URL
//
//  The last one is the important one. On Supabase, the bucket enforced access
//  itself with `can_see_task(storage_task_id(name))`, so the bytes were covered
//  by the same predicate as the metadata. S3 cannot consult Postgres, so that
//  check now lives in routes/attachments.js — and a check that lives in
//  application code needs a test that exercises the application.
//
//  ── Running these ───────────────────────────────────────────────────────────
//
//  They need a REACHABLE, DEPLOYED stack: the API, a Cognito pool, and the S3
//  bucket. That is more than a laptop usually has, so they SKIP THEMSELVES when
//  not configured rather than failing — a red suite that just means "you are
//  not on the VPN" teaches people to ignore red suites.
//
//  Set these in .env to run them:
//
//    TEST_API_URL=https://ceo-api.gyftr.net
//    TEST_EA_EMAIL / TEST_EA_PASSWORD          an executive account
//    TEST_STAKEHOLDER_EMAIL / TEST_STAKEHOLDER_PASSWORD
//    TEST_OTHER_STAKEHOLDER_EMAIL / TEST_OTHER_STAKEHOLDER_PASSWORD
//    COGNITO_USER_POOL_ID / COGNITO_CLIENT_ID
//
//  Run them against UAT after any change to auth, attachments or onboarding.
//  DEPLOY.md lists them in the release checklist.
// ════════════════════════════════════════════════════════════════════════════

import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import dotenv from 'dotenv';
import {
  CognitoUserPool, CognitoUser, AuthenticationDetails,
} from 'amazon-cognito-identity-js';

const here = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(here, '..', '.env') });

const API        = process.env.TEST_API_URL;
const POOL_ID    = process.env.COGNITO_USER_POOL_ID;
const CLIENT_ID  = process.env.COGNITO_CLIENT_ID;

const PEOPLE = {
  EA:    [process.env.TEST_EA_EMAIL,                  process.env.TEST_EA_PASSWORD],
  ALICE: [process.env.TEST_STAKEHOLDER_EMAIL,         process.env.TEST_STAKEHOLDER_PASSWORD],
  BOB:   [process.env.TEST_OTHER_STAKEHOLDER_EMAIL,   process.env.TEST_OTHER_STAKEHOLDER_PASSWORD],
};

const configured = Boolean(
  API && POOL_ID && CLIENT_ID && Object.values(PEOPLE).every(([e, p]) => e && p)
);

const skip = configured
  ? false
  : 'set TEST_API_URL, COGNITO_* and the TEST_* accounts in .env to run the API suite';

const pool = configured ? new CognitoUserPool({ UserPoolId: POOL_ID, ClientId: CLIENT_ID }) : null;

function token(email, password) {
  return new Promise((resolve, reject) => {
    const user = new CognitoUser({ Username: email, Pool: pool });
    user.authenticateUser(new AuthenticationDetails({ Username: email, Password: password }), {
      onSuccess: (s) => resolve(s.getIdToken().getJwtToken()),
      onFailure: reject,
      newPasswordRequired: () => reject(new Error(
        `${email} is still in FORCE_CHANGE_PASSWORD — set a permanent password before running these tests`
      )),
    });
  });
}

const tokens = new Map();
async function as(who) {
  if (!tokens.has(who)) tokens.set(who, await token(...PEOPLE[who]));
  return tokens.get(who);
}

async function call(who, path, options = {}) {
  const jwt = await as(who);
  const isForm = options.body instanceof FormData;
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      ...(isForm ? {} : { 'Content-Type': 'application/json' }),
      Authorization: `Bearer ${jwt}`,
      ...(options.headers || {}),
    },
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

/* ── Authentication ──────────────────────────────────────────────────────── */

test('an executive and a stakeholder can both sign in', { skip }, async () => {
  for (const who of ['EA', 'ALICE']) {
    const jwt = await as(who);
    assert.ok(jwt && jwt.split('.').length === 3, `${who} should receive an ID token`);
  }
});

test('a wrong password is rejected', { skip }, async () => {
  await assert.rejects(
    () => token(PEOPLE.ALICE[0], 'not-the-password'),
    'Cognito must refuse a bad password'
  );
});

test('the API refuses a request with no token', { skip }, async () => {
  const res = await fetch(`${API}/api/tasks`);
  assert.equal(res.status, 401, 'unauthenticated requests must be refused');
});

test('the API refuses a forged token', { skip }, async () => {
  // A syntactically valid JWT that nothing signed. If this ever returns 200,
  // aws-jwt-verify is not actually verifying and every account is open.
  const forged = [
    Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify({ sub: 'whoever', email: 'attacker@example.invalid' })).toString('base64url'),
    '',
  ].join('.');

  const res = await fetch(`${API}/api/tasks`, { headers: { Authorization: `Bearer ${forged}` } });
  assert.equal(res.status, 401, 'an unsigned token must be refused');
});

test('health is reachable without a token, and reports the database', { skip }, async () => {
  const live = await fetch(`${API}/health`);
  assert.equal(live.status, 200, '/health must answer for the load balancer');

  const deep = await fetch(`${API}/health/deep`);
  const body = await deep.json();
  assert.equal(deep.status, 200, `/health/deep says the database is unreachable: ${body.error ?? ''}`);
  assert.equal(body.database, 'reachable');
});

/* ── Onboarding ──────────────────────────────────────────────────────────── */

test('only an executive can invite a stakeholder', { skip }, async () => {
  const refused = await call('ALICE', '/api/admin/stakeholders', {
    method: 'POST',
    body: JSON.stringify({ name: 'Should Not Exist', email: `reject-${Date.now()}@example.invalid` }),
  });
  assert.equal(refused.status, 403, 'a stakeholder must not create accounts');
});

test('an invited stakeholder is created inactive of executive powers and must set a password',
  { skip }, async () => {
    const email = `probe-${Date.now()}@example.invalid`;
    const { status, body } = await call('EA', '/api/admin/stakeholders', {
      method: 'POST',
      body: JSON.stringify({ name: 'Probe Head', email, title: 'Head of Probe' }),
    });

    assert.equal(status, 201, `the EA should create a stakeholder: ${body?.error ?? ''}`);
    assert.equal(body.profile.role, 'stakeholder', 'never created as an executive');
    assert.equal(body.profile.active, true);
    assert.equal(body.profile.must_set_password, true,
      'the account is stamped for the first-login password step');

    // Whichever path was taken, the account is in FORCE_CHANGE_PASSWORD, so a
    // temporary password is single-use. When email delivery fails the API says
    // so explicitly rather than claiming an invite went out.
    if (body.method === 'temp_password') {
      assert.ok(body.tempPassword?.length >= 12, 'a usable temporary password is returned');
      assert.ok(body.reason, 'the EA is told why they are relaying a password by hand');
    }

    // NOTE: unlike the Supabase version, the first-login gate is no longer a
    // flag the client is trusted to honour — Cognito issues a challenge instead
    // of a session, so there is no token to reach the board with. The
    // must_set_password column above is for the admin views, not the gate.
  });

/* ── Attachments: the guarantee that left the database ───────────────────── */

test('a file round-trips, and only someone assigned to the task can download it',
  { skip }, async () => {
    // Create a task assigned to Alice but not Bob.
    const created = await call('EA', '/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ title: `api probe ${Date.now()}`, priority: 'low', stakeholders: [] }),
    });
    assert.equal(created.status, 201, 'the EA should create a task');
    const taskId = created.body.id;

    const people = await call('EA', '/api/stakeholders');
    const alice = people.body.find(p => p.email === PEOPLE.ALICE[0]);
    assert.ok(alice, 'the Alice test account must be an active stakeholder');
    await call('EA', `/api/tasks/${taskId}/stakeholders`, {
      method: 'POST', body: JSON.stringify({ stakeholder_id: alice.id }),
    });

    // Upload a genuine (tiny) PDF as the executive.
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a]);
    const form = new FormData();
    form.append('file', new Blob([bytes], { type: 'application/pdf' }), 'brief.pdf');

    const up = await call('EA', `/api/tasks/${taskId}/attachments`, { method: 'POST', body: form });
    assert.equal(up.status, 201, `an executive can upload: ${up.body?.error ?? ''}`);
    const attachmentId = up.body.id;

    // The assignee can mint a URL and actually read the bytes back.
    const signed = await call('ALICE', `/api/attachments/${attachmentId}/url`);
    assert.equal(signed.status, 200, 'an assignee can mint a signed URL');

    const res = await fetch(signed.body.url);
    assert.equal(res.ok, true, 'the presigned URL actually serves the file');
    assert.deepEqual(new Uint8Array(await res.arrayBuffer()), bytes, 'the bytes round-trip unchanged');

    // Bob holds no assignment on this task. THIS is the assertion that replaces
    // the storage RLS policy: the API must refuse to presign for him.
    const foreign = await call('BOB', `/api/attachments/${attachmentId}/url`);
    assert.equal(foreign.status, 404, 'a non-assignee must not be able to mint a URL');
    assert.ok(!foreign.body?.url, 'and must certainly not receive one');

    // A stakeholder cannot upload at all.
    const shForm = new FormData();
    shForm.append('file', new Blob([bytes], { type: 'application/pdf' }), 'nope.pdf');
    const shUpload = await call('ALICE', `/api/tasks/${taskId}/attachments`, { method: 'POST', body: shForm });
    assert.equal(shUpload.status, 403, 'a stakeholder must not upload');

    await call('EA', `/api/tasks/${taskId}`, { method: 'DELETE' });
  });

test('the attachments bucket is not publicly readable', { skip }, async () => {
  // A presigned URL works; the same object WITHOUT the signature must not. If
  // this passes an unsigned fetch, Block Public Access is off and every
  // attachment in the system is world-readable to anyone who learns a key.
  const bucket = process.env.ATTACHMENTS_BUCKET;
  const region = process.env.AWS_REGION || 'ap-south-1';
  if (!bucket) return; // nothing to check without the bucket name

  const res = await fetch(`https://${bucket}.s3.${region}.amazonaws.com/task/1/anything.pdf`);
  assert.ok(
    res.status === 403 || res.status === 404,
    `unsigned bucket access returned ${res.status} — Block Public Access must be enabled`
  );
});
