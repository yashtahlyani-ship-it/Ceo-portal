// cognito.js — authentication. Replaces supabase.auth.*
//
// Adapted from the Legal portal's auth-cognito.js, including the parts that
// exist because of specific production failures. Read the comments before
// simplifying anything here.
//
// ── How the first-login gate works now, and why it is better ─────────────────
//
// On Supabase, a new account was stamped `must_set_password: true` in user
// metadata and the React app was trusted to hold them on a set-password screen.
// That is a client-side gate, and it failed exactly the way client-side gates
// fail: the flag was set correctly, a test asserted it was set, and App.jsx
// still rendered the board because it only checked for a missing session. Every
// new user walked straight past it.
//
// Cognito puts the gate in the token issuer. A fresh account is in
// FORCE_CHANGE_PASSWORD, and authenticateUser answers with a
// NEW_PASSWORD_REQUIRED challenge instead of a session. There is no token until
// the person sets a password, so a client that forgets to render the screen has
// nothing to render the board with either. The bug class is gone rather than
// fixed.

import { CognitoUserPool, CognitoUser, AuthenticationDetails } from 'amazon-cognito-identity-js';
import { setAuthToken, setAuthTokenProvider } from './http.js';

// Built without VITE_COGNITO_* (a missing .env at build time), this constructor
// throws "Both UserPoolId and ClientId are required" while the module is still
// loading — before anything renders. The result is a blank page with no clue
// why, produced by a build that succeeded silently. Fail into a readable
// message instead, so the sign-in screen can say what is wrong.
function createUserPool() {
  const UserPoolId = import.meta.env.VITE_COGNITO_USER_POOL_ID;
  const ClientId   = import.meta.env.VITE_COGNITO_CLIENT_ID;
  if (!UserPoolId || !ClientId) return null;
  try {
    return new CognitoUserPool({ UserPoolId, ClientId });
  } catch (err) {
    console.error('[cognito] pool could not be created:', err.message);
    return null;
  }
}

const userPool = createUserPool();

export const AUTH_CONFIG_ERROR = userPool
  ? null
  : 'This build is missing its Cognito configuration (VITE_COGNITO_USER_POOL_ID / VITE_COGNITO_CLIENT_ID). Rebuild the frontend with those values set.';

// Holds the in-progress challenge between signIn() returning
// { mustChangePassword: true } and the caller submitting a new password.
let _pendingChallenge = null;

// Returns a currently-valid ID token, or null if the session cannot be renewed.
// getSession() mints a new ID token from the refresh token when the current one
// has expired — this is what stops the portal breaking after an hour of use.
function freshIdToken() {
  return new Promise((resolve) => {
    if (!userPool) return resolve(null);
    const user = userPool.getCurrentUser();
    if (!user) return resolve(null);
    user.getSession((err, session) => {
      if (err || !session?.isValid()) return resolve(null);
      resolve(session.getIdToken().getJwtToken());
    });
  });
}

function adopt(session) {
  setAuthToken(session.getIdToken().getJwtToken());
  setAuthTokenProvider(freshIdToken);
}

/**
 * signIn(email, password)
 *   → resolves { mustChangePassword: true }  if this is a first login
 *   → resolves { ok: true }                  once a session exists
 *
 * Callers MUST check for mustChangePassword before treating the result as a
 * successful sign-in.
 */
export function signIn(email, password) {
  return new Promise((resolve, reject) => {
    if (!userPool) return reject(new Error(AUTH_CONFIG_ERROR));
    const user = new CognitoUser({ Username: email, Pool: userPool });
    const details = new AuthenticationDetails({ Username: email, Password: password });

    user.authenticateUser(details, {
      onSuccess: (session) => {
        _pendingChallenge = null;
        adopt(session);
        resolve({ ok: true });
      },
      onFailure: reject,
      newPasswordRequired: (userAttributes, requiredAttributes) => {
        // Send back ONLY attributes Cognito says are still required, and never
        // a standard attribute that is already set. `userAttributes` is the
        // account's CURRENT values, not a to-do list — echoing `email` back
        // makes Cognito fail the challenge with "Cannot modify an already
        // provided email", which blocks every first login on the platform.
        const NEVER_SEND = new Set([
          'email', 'email_verified',
          'phone_number', 'phone_number_verified',
          'sub',
        ]);
        const payload = {};
        for (const name of requiredAttributes || []) {
          if (!NEVER_SEND.has(name) && userAttributes?.[name] !== undefined) {
            payload[name] = userAttributes[name];
          }
        }
        _pendingChallenge = { user, userAttributes: payload };
        resolve({ mustChangePassword: true });
      },
    });
  });
}

/** Completes a first login. Resolves once a real session exists. */
export function completeNewPassword(newPassword) {
  return new Promise((resolve, reject) => {
    if (!_pendingChallenge) {
      return reject(new Error('No password challenge in progress — sign in again.'));
    }
    const { user, userAttributes } = _pendingChallenge;
    user.completeNewPasswordChallenge(newPassword, userAttributes, {
      onSuccess: (session) => {
        _pendingChallenge = null;
        adopt(session);
        resolve({ ok: true });
      },
      onFailure: reject,
    });
  });
}

/** Change password while already signed in. */
export function changePassword(oldPassword, newPassword) {
  return new Promise((resolve, reject) => {
    const user = userPool?.getCurrentUser();
    if (!user) return reject(new Error('Not signed in.'));
    user.getSession((err) => {
      if (err) return reject(err);
      user.changePassword(oldPassword, newPassword, (e) => (e ? reject(e) : resolve({ ok: true })));
    });
  });
}

export function signOut() {
  userPool?.getCurrentUser()?.signOut();
  setAuthToken(null);
  setAuthTokenProvider(null);
}

/**
 * Restores a session from local storage on page load, so people are not asked
 * to sign in on every visit. Resolves true if a valid session was adopted.
 */
export function restoreSession() {
  return new Promise((resolve) => {
    if (!userPool) return resolve(false);
    const user = userPool.getCurrentUser();
    if (!user) return resolve(false);
    user.getSession((err, session) => {
      if (err || !session?.isValid()) return resolve(false);
      adopt(session);
      resolve(true);
    });
  });
}
