import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import * as cognito from '../lib/cognito.js';
import { setOnSessionExpired } from '../lib/http.js';
import { api } from '../lib/api.js';

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

// ── The first-login gate ─────────────────────────────────────────────────────
//
// This used to read a `must_set_password` flag out of Supabase user metadata
// and trust the app to act on it. That is a client-side gate, and it failed the
// way client-side gates fail: the server stamped the flag correctly, a test
// asserted it was stamped, and App.jsx rendered the board anyway because it
// only checked for a missing session. Every new user walked straight past it.
//
// With Cognito the gate is in the token issuer. A fresh account is in
// FORCE_CHANGE_PASSWORD and authenticateUser answers with a challenge INSTEAD
// of a session, so `mustSetPassword` below is not a flag we choose to honour —
// it is the report that no token exists yet. Forgetting to render the
// set-password screen now leaves nothing to render the board with either.
//
// The exported shape is unchanged from the Supabase version on purpose, so
// Login.jsx and App.jsx did not have to change.

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined); // undefined = still resolving
  const [profile, setProfile] = useState(null);
  const [mustSetPassword, setMustSetPassword] = useState(false);

  const loadProfile = useCallback(async () => {
    try {
      const me = await api.me();
      setProfile(me);
      return me;
    } catch (err) {
      // A valid Cognito token with no linked profile is a real state — someone
      // in the user pool the CEO Office has not onboarded. Surfacing it beats
      // an empty board that looks like a loading failure.
      console.warn('[auth] could not load profile:', err.message);
      setProfile(null);
      return null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    // A 401 from any request means the refresh token is gone or revoked. Drop
    // the session so the app falls back to the sign-in screen rather than
    // showing a board that can no longer load anything.
    setOnSessionExpired(() => {
      if (cancelled) return;
      setSession(null);
      setProfile(null);
    });

    cognito.restoreSession().then(async (ok) => {
      if (cancelled) return;
      if (ok) {
        setSession({ active: true });
        await loadProfile();
      } else {
        setSession(null);
      }
    });

    return () => { cancelled = true; setOnSessionExpired(null); };
  }, [loadProfile]);

  const signIn = async (email, password) => {
    const result = await cognito.signIn(email, password);
    if (result.mustChangePassword) {
      // No session exists yet — deliberately not setting one. Login.jsx shows
      // the set-password step off the back of this flag.
      setMustSetPassword(true);
      return;
    }
    setSession({ active: true });
    setMustSetPassword(false);
    await loadProfile();
  };

  // Completes the Cognito challenge AND establishes the session in one call, so
  // a refresh mid-flow cannot strand somebody on the set-password screen.
  const setPassword = async (newPassword) => {
    await cognito.completeNewPassword(newPassword);
    setMustSetPassword(false);
    setSession({ active: true });
    await loadProfile();
  };

  const signOut = async () => {
    cognito.signOut();
    setSession(null);
    setProfile(null);
    setMustSetPassword(false);
  };

  return (
    <AuthCtx.Provider value={{
      session, profile, mustSetPassword, setMustSetPassword,
      signIn, setPassword, signOut, reloadProfile: loadProfile,
      authConfigError: cognito.AUTH_CONFIG_ERROR,
    }}>
      {children}
    </AuthCtx.Provider>
  );
}
