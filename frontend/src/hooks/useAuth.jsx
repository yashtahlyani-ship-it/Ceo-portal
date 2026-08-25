import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase.js';
import { api } from '../lib/api.js';

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

// A freshly created stakeholder is stamped with must_set_password:true in their
// auth user_metadata (see scripts/create-stakeholder.mjs). Their first sign-in
// succeeds, but the app holds them on the "set your password" step until they
// choose their own — the same shape as the Marketing and Legal portals' Cognito
// NEW_PASSWORD_REQUIRED challenge, expressed in Supabase terms.
const needsPassword = (sess) => !!sess?.user?.user_metadata?.must_set_password;

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined); // undefined = still resolving
  const [profile, setProfile] = useState(null);
  const [mustSetPassword, setMustSetPassword] = useState(false);

  const loadProfile = useCallback(async () => {
    try { setProfile(await api.me()); } catch { setProfile(null); }
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session) { setMustSetPassword(needsPassword(data.session)); loadProfile(); }
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, sess) => {
      setSession(sess);
      if (sess) {
        // PASSWORD_RECOVERY fires when someone follows an invite or reset link;
        // the metadata flag covers the admin-created temporary-password case.
        if (event === 'PASSWORD_RECOVERY' || needsPassword(sess)) setMustSetPassword(true);
        loadProfile();
      } else {
        setProfile(null);
        setMustSetPassword(false);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [loadProfile]);

  const signIn = async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  };

  // Sets the password AND clears the first-login flag in one call, so a refresh
  // mid-flow cannot strand someone on the set-password screen forever.
  const setPassword = async (newPassword) => {
    const { error } = await supabase.auth.updateUser({
      password: newPassword,
      data: { must_set_password: false },
    });
    if (error) throw error;
    setMustSetPassword(false);
    await loadProfile();
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setProfile(null);
    setMustSetPassword(false);
  };

  return (
    <AuthCtx.Provider value={{
      session, profile, mustSetPassword, setMustSetPassword,
      signIn, setPassword, signOut, reloadProfile: loadProfile,
    }}>
      {children}
    </AuthCtx.Provider>
  );
}
