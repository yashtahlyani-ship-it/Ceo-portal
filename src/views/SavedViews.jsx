import { useEffect, useState } from 'react';
import { Bookmark, Plus, Trash2, Pencil, Check, X } from 'lucide-react';
import { api } from '../lib/api.js';
import { supabase } from '../lib/supabase.js';
import { EMPTY_FILTERS } from '../lib/rules.js';
import { PRIORITY, STATUS } from '../lib/styles.js';
import { Modal, Field, Empty } from '../components/ui.jsx';
import Board from './Board.jsx';

/* Executive-only saved slices of the board.
   A view stores exactly the board's own filter object, so "save this view" and
   "filter the board" are the same operation and there is only one filter shape
   in the product to reason about. Applying a view hands those filters straight
   to Board, which renders and filters them exactly as it always does. */
export default function SavedViews(props) {
  // `props` is forwarded wholesale to Board (tasks, role, me, onOpen, refresh…).
  const [views, setViews] = useState(null);
  const [activeId, setActiveId] = useState(null);
  const [editing, setEditing] = useState(false);
  const [renaming, setRenaming] = useState(null);
  const [err, setErr] = useState('');

  const load = () => api.savedViews().then(setViews).catch(() => setViews([]));
  useEffect(() => { load(); }, []);

  const active = (views || []).find((v) => v.id === activeId) || null;

  const remove = async (v) => {
    if (!window.confirm(`Delete the view “${v.name}”?`)) return;
    setErr('');
    try {
      await api.deleteView(v.id);
      if (activeId === v.id) setActiveId(null);
      load();
    } catch (e) { setErr(e.message || 'Could not delete that view.'); }
  };

  const rename = async (v, name) => {
    setErr('');
    try { await api.saveView({ ...v, name: name.trim() || v.name }); setRenaming(null); load(); }
    catch (e) { setErr(e.message || 'Could not rename that view.'); }
  };

  return (
    <div className="gx-fade">
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 18 }}>
        <div>
          <h1 className="gx-disp" style={{ fontSize: 24, fontWeight: 800, margin: '0 0 3px' }}>Saved Views</h1>
          <p style={{ color: 'var(--ink-soft)', margin: 0, fontSize: 13.5 }}>Reusable filtered slices of the board.</p>
        </div>
        <button className="gx-btn gx-btn-dark gx-focusable" onClick={() => setEditing(true)}>
          <Plus size={16} /> New view
        </button>
      </div>

      {err && (
        <div role="alert" style={{ fontSize: 12.5, color: '#C42424', background: '#FDE2E2',
          padding: '9px 12px', borderRadius: 10, marginBottom: 14, fontWeight: 600 }}>{err}</div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20, alignItems: 'center' }}>
        {views === null && <span style={{ fontSize: 13, color: 'var(--ink-soft)' }}>Loading views…</span>}
        {views?.length === 0 && <span style={{ fontSize: 13, color: 'var(--ink-soft)' }}>No saved views yet.</span>}
        {(views || []).map((v) => renaming === v.id ? (
          <RenameChip key={v.id} view={v} onCancel={() => setRenaming(null)} onSave={(n) => rename(v, n)} />
        ) : (
          <span key={v.id} className="gx-chip" style={{
            background: activeId === v.id ? 'var(--pop)' : 'var(--surface)',
            color: activeId === v.id ? '#fff' : 'var(--ink)',
            border: '1px solid var(--line)', padding: '6px 10px', gap: 7,
          }}>
            <button className="gx-focusable" onClick={() => setActiveId(activeId === v.id ? null : v.id)}
              aria-pressed={activeId === v.id}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit',
                font: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 6, padding: 0 }}>
              <Bookmark size={13} /> {v.name}
            </button>
            <IconBtn label={`Rename ${v.name}`} onClick={() => setRenaming(v.id)}><Pencil size={12} /></IconBtn>
            <IconBtn label={`Delete ${v.name}`} onClick={() => remove(v)}><Trash2 size={12} /></IconBtn>
          </span>
        ))}
      </div>

      {active ? (
        <Board {...props} filters={{ ...EMPTY_FILTERS, ...(active.filters || {}) }}
          setFilters={() => {}} />
      ) : (
        <div className="gx-card">
          <Empty icon={Bookmark} title="Pick a view"
            hint="Select a saved view above to filter the board, or create a new one." />
        </div>
      )}

      {editing && (
        <EditModal onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); load(); }} onError={setErr} />
      )}
    </div>
  );
}

const IconBtn = ({ label, onClick, children }) => (
  <button className="gx-focusable" title={label} aria-label={label} onClick={onClick}
    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit',
      opacity: 0.7, display: 'inline-flex', padding: 0 }}>
    {children}
  </button>
);

function RenameChip({ view, onCancel, onSave }) {
  const [name, setName] = useState(view.name);
  return (
    <span className="gx-chip" style={{ background: 'var(--surface)', border: '1px solid var(--pop)', padding: '4px 8px', gap: 6 }}>
      <input className="gx-cellinput" value={name} autoFocus aria-label="View name"
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') onSave(name); if (e.key === 'Escape') onCancel(); }}
        style={{ width: 150, fontSize: 12.5 }} />
      <IconBtn label="Save name" onClick={() => onSave(name)}><Check size={13} /></IconBtn>
      <IconBtn label="Cancel rename" onClick={onCancel}><X size={13} /></IconBtn>
    </span>
  );
}

function EditModal({ onClose, onSaved, onError }) {
  const [name, setName] = useState('');
  const [f, setF] = useState(EMPTY_FILTERS);
  const [busy, setBusy] = useState(false);

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      await api.saveView({ owner_id: user.id, name: name.trim() || 'Untitled view', filters: f });
      onSaved();
    } catch (e2) {
      onError(e2.message || 'Could not save that view.');
      onClose();
    } finally { setBusy(false); }
  };

  const sel = (key, anyLabel, opts) => (
    <select className="gx-input" value={f[key] || ''} onChange={(e) => setF({ ...f, [key]: e.target.value || null })}>
      <option value="">{anyLabel}</option>
      {Object.entries(opts).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
    </select>
  );

  return (
    <Modal title="New saved view" onClose={onClose}>
      <form onSubmit={save}>
        <Field label="Name" required>
          <input className="gx-input" value={name} onChange={(e) => setName(e.target.value)}
            placeholder="High priority — this week" autoFocus />
        </Field>
        <Field label="Priority">{sel('priority', 'Any priority', PRIORITY)}</Field>
        <Field label="Status">{sel('status', 'Any status', STATUS)}</Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Expected from">
            <input className="gx-input" type="date" value={f.from}
              onChange={(e) => setF({ ...f, from: e.target.value })} />
          </Field>
          <Field label="Expected to">
            <input className="gx-input" type="date" value={f.to}
              onChange={(e) => setF({ ...f, to: e.target.value })} />
          </Field>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, marginBottom: 16 }}>
          <input type="checkbox" checked={f.followupsDue}
            onChange={(e) => setF({ ...f, followupsDue: e.target.checked })} />
          Only tasks whose follow-up is due
        </label>
        <div style={{ textAlign: 'right' }}>
          <button type="button" className="gx-btn gx-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="gx-btn gx-btn-dark gx-focusable" disabled={busy}>
            {busy ? 'Saving…' : 'Save view'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
