/* ─── components/Login.jsx ───
   Ported from the Marketing Portal's components/Login.jsx: same Shell (radial
   wash behind a 380px card), same GyftrLogo lockup, same reveal-able password
   field, same live rules checklist, same hidden username input for password
   managers. Only the product subtitle and the error vocabulary differ. */
import { useState } from 'react';
import { useAuth } from '../hooks/useAuth.jsx';
import { GyftrLogo } from './GyftrLogo.jsx';

/* Supabase's raw messages are terse and occasionally misleading. Translate the
   ones people actually hit; pass anything else through unchanged. */
function friendlyAuthError(err) {
  const raw = err?.message || 'Sign in failed';
  const m = raw.toLowerCase();
  if (m.includes('invalid login credentials')) return 'Incorrect email or password.';
  if (m.includes('email not confirmed')) return 'This account is not active yet. Contact the CEO’s Office.';
  if (m.includes('too many requests') || m.includes('rate limit')) {
    return 'Too many attempts. Wait a few minutes and try again.';
  }
  if (m.includes('should be different from the old password')) {
    return 'Choose a password different from your temporary one.';
  }
  if (m.includes('failed to fetch') || m.includes('networkerror')) {
    return 'Could not reach the server. Check your connection and try again.';
  }
  return raw;
}

/* Mirrors the Supabase project's password policy so the user is told what is
   wrong before the request round-trips. */
const RULES = [
  { label: 'At least 8 characters', test: (p) => p.length >= 8 },
  { label: 'One uppercase letter',  test: (p) => /[A-Z]/.test(p) },
  { label: 'One lowercase letter',  test: (p) => /[a-z]/.test(p) },
  { label: 'One number',            test: (p) => /[0-9]/.test(p) },
  { label: 'One symbol',            test: (p) => /[^A-Za-z0-9]/.test(p) },
];

function PasswordField({ label, value, onChange, name, autoComplete, autoFocus }) {
  const [shown, setShown] = useState(false);
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <label htmlFor={name} style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-soft)' }}>{label}</label>
        <button type="button" onClick={() => setShown((v) => !v)} className="gx-focusable"
          style={{ fontSize: 11, fontWeight: 700, color: 'var(--pop)', cursor: 'pointer', userSelect: 'none',
            background: 'none', border: 'none', padding: 0 }}>
          {shown ? 'Hide' : 'Show'}
        </button>
      </div>
      <input className="gx-input" style={{ margin: '6px 0 14px' }}
        id={name} name={name} type={shown ? 'text' : 'password'} value={value}
        placeholder="••••••••" autoComplete={autoComplete} autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)} />
    </>
  );
}

const Shell = ({ children }) => (
  <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center',
    background: 'radial-gradient(120% 120% at 80% 0%, #E9F4D5 0%, #F3F6F2 42%)' }}>
    <div className="gx-fade" style={{ width: 380, maxWidth: '92vw' }}>
      <div style={{ marginBottom: 26 }}>
        <GyftrLogo fs={28} />
        <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', fontWeight: 600, marginTop: 8, paddingLeft: 2 }}>
          CEO Office · Task Platform
        </div>
      </div>
      {children}
    </div>
  </div>
);

/* ── Step 2: first login — set your own password ── */
function SetPassword({ email, setPassword, onCancel }) {
  const [p1, setP1] = useState('');
  const [p2, setP2] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const failed = RULES.filter((r) => !r.test(p1));
  const mismatch = p2.length > 0 && p1 !== p2;
  const ready = failed.length === 0 && p1 === p2 && p2.length > 0;

  const submit = async (e) => {
    e.preventDefault();
    if (!ready || busy) return;
    setErr(''); setBusy(true);
    try { await setPassword(p1); }
    catch (e2) { setErr(friendlyAuthError(e2)); }
    finally { setBusy(false); }
  };

  return (
    <Shell>
      <div className="gx-card" style={{ padding: 26 }}>
        <h1 className="gx-disp" style={{ fontSize: 23, fontWeight: 700, margin: '0 0 4px' }}>Set a new password</h1>
        <p style={{ fontSize: 13.5, color: 'var(--ink-soft)', margin: '0 0 20px' }}>
          Your account is on a temporary password. Choose your own to continue
          {email ? <> as <b style={{ color: 'var(--ink)' }}>{email}</b></> : null}.
        </p>

        <form onSubmit={submit}>
          {/* Tells the password manager which account this belongs to. */}
          <input type="text" name="username" autoComplete="username" value={email || ''}
            readOnly hidden aria-hidden="true" />

          <PasswordField label="New password" name="new-password" autoComplete="new-password"
            value={p1} onChange={setP1} autoFocus />
          <PasswordField label="Confirm new password" name="confirm-password" autoComplete="new-password"
            value={p2} onChange={setP2} />

          <div style={{ marginBottom: 14 }}>
            {RULES.map((r) => {
              const ok = r.test(p1);
              return (
                <div key={r.label} style={{ fontSize: 11.5, fontWeight: 600, display: 'flex', alignItems: 'center',
                  gap: 6, marginBottom: 3, color: ok ? '#15803D' : 'var(--ink-soft)' }}>
                  <span style={{ width: 13, display: 'inline-block' }}>{ok ? '✓' : '•'}</span>{r.label}
                </div>
              );
            })}
            {mismatch && (
              <div style={{ fontSize: 11.5, fontWeight: 600, color: '#C42424', marginTop: 5 }}>
                Both passwords must match
              </div>
            )}
          </div>

          {err && <div role="alert" style={{ fontSize: 12, color: '#C42424', marginBottom: 10, fontWeight: 600 }}>{err}</div>}

          <button type="submit" className="gx-btn gx-btn-dark gx-focusable" disabled={!ready || busy}
            style={{ width: '100%', justifyContent: 'center', padding: 11, opacity: (!ready || busy) ? 0.5 : 1 }}>
            {busy ? 'Saving…' : 'Set password & continue'}
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: 14 }}>
          <button type="button" onClick={onCancel} className="gx-focusable"
            style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-soft)', cursor: 'pointer',
              background: 'none', border: 'none' }}>
            Back to sign in
          </button>
        </div>
      </div>
    </Shell>
  );
}

/* ── Step 1: sign in ── */
export default function Login() {
  const { signIn, signOut, mustSetPassword, setPassword } = useAuth();
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr(''); setBusy(true);
    try { await signIn(email.trim(), pass); }
    catch (e2) { setErr(friendlyAuthError(e2)); }
    finally { setBusy(false); }
  };

  if (mustSetPassword) {
    return <SetPassword email={email} setPassword={setPassword}
      onCancel={() => { signOut(); setPass(''); }} />;
  }

  return (
    <Shell>
      <div className="gx-card" style={{ padding: 26 }}>
        <h1 className="gx-disp" style={{ fontSize: 23, fontWeight: 700, margin: '0 0 4px' }}>Welcome back</h1>
        <p style={{ fontSize: 13.5, color: 'var(--ink-soft)', margin: '0 0 22px' }}>
          Every request from the CEO&apos;s Office, who owns it, and what they promised.
        </p>
        <form onSubmit={submit}>
          <label htmlFor="username" style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-soft)' }}>Company email</label>
          <input className="gx-input" style={{ margin: '6px 0 14px' }} type="email"
            id="username" name="username" autoComplete="username" value={email}
            placeholder="enter your email address" onChange={(e) => setEmail(e.target.value)} />

          <PasswordField label="Password" name="current-password" autoComplete="current-password"
            value={pass} onChange={setPass} />

          {err && <div role="alert" style={{ fontSize: 12, color: '#C42424', marginBottom: 10, fontWeight: 600 }}>{err}</div>}

          <button type="submit" className="gx-btn gx-btn-dark gx-focusable" disabled={busy}
            style={{ width: '100%', justifyContent: 'center', padding: 11, opacity: busy ? 0.6 : 1 }}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14, fontSize: 12.5, fontWeight: 600 }}>
          <span style={{ color: 'var(--ink-soft)' }}>GyFTR staff only</span>
          <span style={{ color: 'var(--ink-soft)' }}>Contact the CEO&apos;s Office to reset</span>
        </div>
      </div>
    </Shell>
  );
}
