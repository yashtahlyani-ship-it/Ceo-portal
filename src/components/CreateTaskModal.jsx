import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { api } from '../lib/api.js';
import { Modal, Field, Avatar } from './ui.jsx';
import { PRIORITY } from '../lib/styles.js';

// Executive task creation. Fast and focused — only the fields the PRD asks for.
export default function CreateTaskModal({ onClose, onCreated }) {
  const [people, setPeople] = useState([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('medium');
  const [expected, setExpected] = useState('');
  const [followup, setFollowup] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => { api.stakeholders().then(setPeople).catch(() => setPeople([])); }, []);

  const toggle = (id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const submit = async (e) => {
    e.preventDefault(); setErr('');
    if (!title.trim()) return setErr('A task title is required.');
    if (!description.trim()) return setErr('A summary is required — say what is being asked, and why.');
    if (selected.size === 0) return setErr('Assign at least one stakeholder.');
    setBusy(true);
    try {
      const id = await api.createTask({
        title, description, priority,
        expected_date: expected || null, next_followup_date: followup || null,
        stakeholders: [...selected],
      });
      onCreated(id);
    } catch (e) { setErr(e.message || 'Could not create the task.'); }
    finally { setBusy(false); }
  };

  return (
    <Modal title="New Task" onClose={onClose} width={600}>
      <form onSubmit={submit}>
        <Field label="Task title" required>
          <input className="gx-input" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus placeholder="e.g. Prepare Q4 Growth Strategy" />
        </Field>
        <Field label="Summary / description" required>
          <textarea className="gx-input" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is being asked, and why." style={{ resize: 'vertical', fontFamily: 'var(--font-b)' }} />
        </Field>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          <Field label="Priority">
            <div style={{ display: 'flex', gap: 6 }}>
              {Object.entries(PRIORITY).map(([k, p]) => (
                <button type="button" key={k} onClick={() => setPriority(k)}
                  aria-pressed={priority === k} className="gx-chip gx-focusable"
                  style={{ background: priority === k ? p.bg : 'transparent', color: priority === k ? p.fg : 'var(--ink-soft)', border: `1px solid ${priority === k ? p.dot : 'var(--line)'}`, flex: 1, justifyContent: 'center' }}>
                  {p.label}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Expected date"><input className="gx-input" type="date" value={expected} onChange={(e) => setExpected(e.target.value)} /></Field>
          <Field label="Next follow-up"><input className="gx-input" type="date" value={followup} onChange={(e) => setFollowup(e.target.value)} /></Field>
        </div>

        <Field label={`Assign to${selected.size ? ` · ${selected.size} selected` : ''}`} required>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, maxHeight: 200, overflow: 'auto', padding: 2 }}>
            {people.map((p) => {
              const on = selected.has(p.id);
              return (
                <button type="button" key={p.id} onClick={() => toggle(p.id)} className="gx-focusable"
                  aria-pressed={on} aria-label={`${p.name}, ${p.title || 'Stakeholder'}`}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 10, cursor: 'pointer',
                    background: on ? 'var(--pop-soft)' : 'var(--surface)', border: `1px solid ${on ? 'var(--pop)' : 'var(--line)'}`, textAlign: 'left' }}>
                  <Avatar name={p.name} color={p.color} size={24} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</div>
                    <div style={{ fontSize: 10.5, color: 'var(--ink-soft)' }}>{p.title || 'Stakeholder'}</div>
                  </div>
                  {on && <Check size={15} style={{ color: 'var(--pop-deep)' }} />}
                </button>
              );
            })}
          </div>
        </Field>

        {err && <div style={{ fontSize: 12.5, color: '#C42424', background: '#FDE2E2', padding: '8px 11px', borderRadius: 9, marginBottom: 12 }}>{err}</div>}
        <div style={{ textAlign: 'right' }}>
          <button type="button" className="gx-btn gx-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="gx-btn gx-btn-dark gx-focusable" disabled={busy}>{busy ? 'Creating…' : 'Create Task'}</button>
        </div>
      </form>
    </Modal>
  );
}
