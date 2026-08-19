import { useEffect, useState } from 'react';
import { UserPlus, Users, Check, Copy } from 'lucide-react';
import { supabase } from '../lib/supabase.js';
import { api } from '../lib/api.js';
import { roleLabel } from '../lib/format.js';
import { Avatar, Modal, Field, Empty, Skeleton } from '../components/ui.jsx';

// Executive-only. Directory + add stakeholder (via the create-stakeholder Edge
// Function) + activate/deactivate. New people are addable without code changes.
export default function Stakeholders() {
  const [rows, setRows] = useState(null);
  const [adding, setAdding] = useState(false);

  const load = () => api.profiles().then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, []);

  const toggleActive = async (p) => {
    await supabase.from('profiles').update({ active: !p.active }).eq('id', p.id);
    load();
  };

  return (
    <div className="gx-fade">
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h1 className="gx-disp" style={{ fontSize: 24, fontWeight: 800, margin: '0 0 3px' }}>Stakeholders</h1>
          <p style={{ color: 'var(--ink-soft)', margin: 0, fontSize: 13.5 }}>Everyone who can be assigned work by the CEO's Office.</p>
        </div>
        <button className="gx-btn gx-btn-dark gx-focusable" onClick={() => setAdding(true)}><UserPlus size={16} /> Add Stakeholder</button>
      </div>

      {rows === null
        ? <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{[0, 1, 2].map((i) => <Skeleton key={i} h={52} />)}</div>
        : rows.length === 0
          ? <Empty icon={Users} title="No people yet" hint="Add your first stakeholder to start assigning tasks." />
          : (
            <div className="gx-card" style={{ padding: 0, overflow: 'hidden' }}>
              {rows.map((p) => (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 16px', borderTop: '1px solid var(--line-soft)', opacity: p.active ? 1 : 0.5 }}>
                  <Avatar name={p.name} color={p.color} size={30} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{p.name}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>{p.title || '—'} · {p.email}</div>
                  </div>
                  <span className="gx-chip" style={{ background: '#EEF4EF', color: '#586860', cursor: 'default' }}>{roleLabel(p.role)}</span>
                  {p.role === 'stakeholder' && (
                    <button className="gx-btn gx-btn-line gx-focusable" onClick={() => toggleActive(p)}>{p.active ? 'Deactivate' : 'Activate'}</button>
                  )}
                </div>
              ))}
            </div>
          )}

      {adding && <AddModal onClose={() => setAdding(false)} onAdded={() => { setAdding(false); load(); }} />}
    </div>
  );
}

function AddModal({ onClose, onAdded }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);

  const submit = async (e) => {
    e.preventDefault(); setErr(''); setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke('create-stakeholder', { body: { name: name.trim(), email: email.trim(), title: title.trim() } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setResult(data);
    } catch (e) { setErr(e.message || 'Could not create the account.'); }
    finally { setBusy(false); }
  };

  if (result) {
    return (
      <Modal title="Stakeholder added" onClose={() => { onAdded(); }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 12, color: 'var(--pop-deep)', fontWeight: 700 }}>
          <Check size={18} /> {result.email} is ready.
        </div>
        <p style={{ fontSize: 13, color: 'var(--ink-soft)' }}>Share this temporary password securely. They'll set their own on first sign-in.</p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <code className="gx-mono" style={{ flex: 1, background: 'var(--line-soft)', padding: '10px 12px', borderRadius: 9, fontSize: 13 }}>{result.tempPassword}</code>
          <button className="gx-btn gx-btn-line gx-focusable" onClick={() => { navigator.clipboard?.writeText(result.tempPassword); setCopied(true); }}>
            {copied ? <Check size={14} /> : <Copy size={14} />}{copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <div style={{ marginTop: 18, textAlign: 'right' }}>
          <button className="gx-btn gx-btn-dark gx-focusable" onClick={() => onAdded()}>Done</button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Add stakeholder" onClose={onClose}>
      <form onSubmit={submit}>
        <Field label="Full name" required><input className="gx-input" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
        <Field label="Work email" required><input className="gx-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Title"><input className="gx-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Head of Product" /></Field>
        {err && <div style={{ fontSize: 12.5, color: '#C42424', background: '#FDE2E2', padding: '8px 11px', borderRadius: 9, marginBottom: 12 }}>{err}</div>}
        <div style={{ textAlign: 'right' }}>
          <button type="button" className="gx-btn gx-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="gx-btn gx-btn-dark gx-focusable" disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button>
        </div>
      </form>
    </Modal>
  );
}
