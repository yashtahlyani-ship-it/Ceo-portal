// routes/admin.js — onboarding. Replaces the `create-stakeholder` Supabase
// Edge Function (supabase/functions/create-stakeholder/index.ts).
//
// The Edge Function existed for one reason: so the service-role key never
// reached a browser. It verified the caller's JWT and role server-side before
// creating anything. That reason is now structural rather than a special case —
// this is a backend, the AWS credentials live on the task role, and no
// privileged credential is reachable from the browser at all.
//
// ── Why the role check here is written by hand ───────────────────────────────
//
// Everywhere else in this codebase, authorization is a Postgres policy. This
// route is the exception, and deliberately so: it calls the Cognito Admin API,
// which is not a database operation and cannot be covered by RLS. So the
// executive check is explicit, at the top, before anything happens.
//
// The profile write that follows still goes through `withUser`, so the
// database independently refuses a non-executive via profiles_insert. Two
// gates, and the outer one exists only because AWS is outside Postgres's
// reach.

import { Router } from 'express';
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { withUser, query } from '../db.js';
import { handle, HttpError } from '../errors.js';

const router = Router();

const cognito = new CognitoIdentityProviderClient({
  region: process.env.COGNITO_REGION || process.env.AWS_REGION || 'ap-south-1',
});
const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID;

function requireExecutive(req) {
  if (req.profile.role !== 'ea' && req.profile.role !== 'ceo') {
    throw new HttpError(403, 'Only the EA or CEO may add stakeholders');
  }
}

// Cognito rejects passwords that miss its complexity policy, and a rejection
// here surfaces as a confusing 400 halfway through onboarding. Build one that
// always satisfies upper/lower/digit/symbol.
function temporaryPassword() {
  return 'Gyftr@' + crypto.randomUUID().replace(/-/g, '').slice(0, 10) + '1!';
}

router.post('/admin/stakeholders', handle(async (req, res) => {
  requireExecutive(req);
  if (!USER_POOL_ID) throw new HttpError(500, 'COGNITO_USER_POOL_ID is not configured');

  const name  = (req.body?.name  ?? '').trim();
  const email = (req.body?.email ?? '').trim().toLowerCase();
  const title = (req.body?.title ?? '').trim();   // Designation (CR-02 #6)
  if (!name || !email) throw new HttpError(400, 'Name and email are required');

  // ── 1. Preferred path: Cognito emails an invitation ────────────────────────
  //
  // AdminCreateUser with DesiredDeliveryMediums:['EMAIL'] sends the person a
  // temporary password and puts the account in FORCE_CHANGE_PASSWORD. On first
  // sign-in Cognito issues a NEW_PASSWORD_REQUIRED challenge and no usable
  // token exists until they choose their own password.
  //
  // That is strictly better than what this replaced. The Supabase version
  // stamped `must_set_password` in user metadata and relied on the React app to
  // honour it — and it once did not, which stranded every login until it was
  // caught by hand. Here the gate is in the token issuer: a client that forgets
  // to render the set-password screen simply has no session to render anything
  // else with.
  let result;
  try {
    result = await cognito.send(new AdminCreateUserCommand({
      UserPoolId: USER_POOL_ID,
      Username: email,
      DesiredDeliveryMediums: ['EMAIL'],
      UserAttributes: [
        { Name: 'email',          Value: email },
        { Name: 'email_verified', Value: 'true' },
        { Name: 'name',           Value: name },
      ],
    }));
  } catch (err) {
    if (err.name === 'UsernameExistsException') {
      throw new HttpError(409, `${email} already has an account.`);
    }
    // ── 2. Fallback ──────────────────────────────────────────────────────────
    // Sending mail can fail for reasons unrelated to this request — SES still
    // in the sandbox, no verified sender, a hit rate limit. Onboarding should
    // not be blocked by that, so create the account without the email and hand
    // the temporary password back for the EA to pass on out of band.
    //
    // The account is STILL in FORCE_CHANGE_PASSWORD, so the temporary value
    // dies the moment the person signs in. The EA is told exactly why they are
    // relaying a password instead of the system sending one, rather than the
    // app claiming an email went out that did not.
    console.warn(`[admin] invite email failed for ${email}: ${err.message}`);
    const tempPassword = temporaryPassword();
    result = await cognito.send(new AdminCreateUserCommand({
      UserPoolId: USER_POOL_ID,
      Username: email,
      MessageAction: 'SUPPRESS',
      TemporaryPassword: tempPassword,
      UserAttributes: [
        { Name: 'email',          Value: email },
        { Name: 'email_verified', Value: 'true' },
        { Name: 'name',           Value: name },
      ],
    }));
    result.__tempPassword = tempPassword;
    result.__reason = err.message;
  }

  const sub = result.User?.Attributes?.find(a => a.Name === 'sub')?.Value ?? null;

  // ── 3. The profile row ─────────────────────────────────────────────────────
  // Written through withUser, so profiles_insert (`with check (is_executive())`)
  // has the final say even though we already checked the role above.
  //
  // Matched on email rather than id: the EA may have created this person's
  // profile earlier, before they had a Cognito account at all.
  const { rows } = await withUser(req.profile.id, c => c.query(
    `insert into profiles (cognito_sub, email, name, title, role, active, must_set_password)
     values ($1, $2, $3, $4, 'stakeholder', true, true)
     on conflict (email) do update
        set name              = excluded.name,
            title             = excluded.title,
            active            = true,
            must_set_password = true,
            cognito_sub       = coalesce(profiles.cognito_sub, excluded.cognito_sub)
     returning *`,
    [sub, email, name, title || null]
  ));

  res.status(201).json({
    profile: rows[0],
    method: result.__tempPassword ? 'temp_password' : 'invite',
    ...(result.__tempPassword
      ? { tempPassword: result.__tempPassword, reason: result.__reason }
      : {}),
  });
}));

// Reset someone back to a temporary password — the "they never got the invite"
// path. Permanent:false keeps FORCE_CHANGE_PASSWORD, so the value handed over
// is single-use and the person still picks their own.
router.post('/admin/stakeholders/:id/reset-password', handle(async (req, res) => {
  requireExecutive(req);

  // Read as admin: the target may be a stakeholder this caller's own RLS view
  // would show, but the lookup is by internal id and the role check above has
  // already established the caller is an executive.
  const { rows } = await query('select email from profiles where id = $1', [req.params.id]);
  if (!rows[0]) throw new HttpError(404, 'No such person');

  const tempPassword = temporaryPassword();
  await cognito.send(new AdminSetUserPasswordCommand({
    UserPoolId: USER_POOL_ID,
    Username: rows[0].email,
    Password: tempPassword,
    Permanent: false,
  }));
  await query('update profiles set must_set_password = true where id = $1', [req.params.id]);

  res.json({ email: rows[0].email, tempPassword });
}));

export default router;
