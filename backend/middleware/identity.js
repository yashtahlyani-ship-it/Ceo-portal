// middleware/identity.js — resolves the verified Cognito token to a profile row.
//
// `req.profile.id` is the value that becomes auth.uid() for the rest of the
// request, so this file decides what every RLS policy in the schema sees. It is
// the single most security-sensitive function in the backend; the rules below
// are deliberate and each one is load-bearing.
//
// On Supabase this was a foreign key (profiles.id references auth.users) plus a
// trigger. Cognito is a separate service, so the link is `profiles.cognito_sub`
// and it is established here, once, on a person's first sign-in.

import { query } from '../db.js';

const COLUMNS = 'id, cognito_sub, email, name, role, title, color, active, must_set_password';

export async function loadIdentity(req, res, next) {
  try {
    // ── Fast path: this Cognito identity is already linked ───────────────────
    const linked = await query(
      `select ${COLUMNS} from profiles where cognito_sub = $1`,
      [req.user.sub]
    );

    if (linked.rows[0]) {
      const profile = linked.rows[0];
      // A deactivated person keeps a valid token until it expires. Checking
      // `active` here is what makes "deactivate" take effect immediately
      // instead of up to an hour later.
      if (!profile.active) {
        return res.status(403).json({ error: 'This account has been deactivated.' });
      }
      req.profile = profile;
      return next();
    }

    // ── First sign-in: claim the profile the EA created for this person ──────
    //
    // Two conditions, and neither is optional:
    //
    //  • email_verified — an unverified email claim is attacker-controllable in
    //    a federated pool. Trusting one would let somebody sign up with the
    //    CEO's address and inherit the CEO's profile, role and every task on
    //    the board. This is the whole reason the flag is plumbed through
    //    auth.js rather than being assumed.
    //
    //  • cognito_sub is null — the profile must be unclaimed. If it already
    //    points at a different Cognito identity, a second identity presenting
    //    the same email does NOT get to take it over; that is an account
    //    conflict for an admin to resolve, not something to resolve silently in
    //    favour of whoever asked most recently.
    if (req.user.email && req.user.email_verified) {
      const byEmail = await query(
        `select ${COLUMNS} from profiles where lower(email) = lower($1)`,
        [req.user.email]
      );
      const candidate = byEmail.rows[0];

      if (candidate && !candidate.cognito_sub) {
        if (!candidate.active) {
          return res.status(403).json({ error: 'This account has been deactivated.' });
        }
        await query('update profiles set cognito_sub = $1 where id = $2', [req.user.sub, candidate.id]);
        req.profile = { ...candidate, cognito_sub: req.user.sub };
        return next();
      }

      if (candidate && candidate.cognito_sub) {
        console.warn(
          `[identity] ${req.user.email} is already linked to a different Cognito identity ` +
          `(profile ${candidate.id}). Refusing to relink.`
        );
        return res.status(403).json({
          error: 'This email is already linked to a different sign-in. Contact the CEO Office.',
        });
      }
    }

    // ── No profile ───────────────────────────────────────────────────────────
    // There is deliberately NO auto-create here. On this platform a profile
    // carries a role and, for stakeholders, an assignment surface — it is not a
    // self-service artifact. Anyone in the Cognito pool without one is someone
    // the EA has not onboarded, and the correct answer is to say so rather than
    // to invent them a stakeholder account.
    return res.status(403).json({
      error: 'No profile is linked to this account yet. Ask the CEO Office to add you.',
    });
  } catch (err) {
    console.error('[identity]', err.message);
    res.status(500).json({ error: 'Failed to resolve your profile' });
  }
}
