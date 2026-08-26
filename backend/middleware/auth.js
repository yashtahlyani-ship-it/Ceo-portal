// middleware/auth.js — verifies the Cognito ID token on every protected request.
// Same pattern and same library as the Marketing and Legal portals.
//
// This replaces Supabase Auth. What Supabase did inside the database (verify a
// JWT, expose its `sub` as auth.uid()) now happens here, and the verified id is
// handed to Postgres by db.js `withUser`. The trust chain is unchanged in
// shape: a signature this process checked decides what auth.uid() returns.

import { CognitoJwtVerifier } from 'aws-jwt-verify';

const userPoolId = process.env.COGNITO_USER_POOL_ID;
const clientId   = process.env.COGNITO_CLIENT_ID;

if (!userPoolId || !clientId) {
  // Exit rather than start: an API that accepts requests it cannot authenticate
  // is worse than one that is visibly down, and this is a config error that
  // will not fix itself by retrying.
  console.error(
    '[auth] Missing COGNITO_USER_POOL_ID or COGNITO_CLIENT_ID — set both on the container.'
  );
  process.exit(1);
}

const verifier = CognitoJwtVerifier.create({
  userPoolId,
  tokenUse: 'id',
  clientId,
});

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing token' });

  try {
    const payload = await verifier.verify(token);
    req.user = {
      sub:   payload.sub,
      email: payload.email,
      // Federated tokens carry this as a real boolean, hosted-UI ones as a
      // string. Be liberal about the shape — identity.js uses this as the gate
      // before trusting `email` enough to link a session to an existing
      // profile, so reading it wrongly would either lock people out or, worse,
      // attach them to the wrong account.
      email_verified: payload.email_verified === true || payload.email_verified === 'true',
    };
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}
