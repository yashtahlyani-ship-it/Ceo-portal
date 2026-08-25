import { useEffect, useMemo, useState } from 'react';
import { Check, Search, X } from 'lucide-react';
import { api } from '../lib/api.js';
import { Modal, Field, Avatar, Empty } from './ui.jsx';
import { PRIORITY } from '../lib/styles.js';
import { createsForSelfOnly } from '../lib/rules.js';

/* Task creation, in two modes.
   EA/CEO: assign to any number of stakeholders, with an expected date the
   assignees will later promise against.
   Stakeholder (CR-01 #6): raises a task for THEMSELVES only. No assignee
   picker exists in this mode — not hidden, not disabled, absent — and the
   server RPC it calls takes no assignee list either, so there is no route by
   which a self-raised task can land on someone else's board. The date they set
   is final; there is no propose-then-confirm step because there is nobody to
   propose to. */
export default function CreateTaskModal({ me, onClose, onCreated }) {
  const selfOnly = createsForSelfOnly(me.role);

  const [people, setPeople] = useState([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('medium');
  const [expected, setExpected] = useState('');
  const [followup, setFollowup] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (selfOnly) return;
    api.stakeholders().then(setPeople).catch(() => setPeople([]));
  }, [selfOnly]);

  const toggle = (id) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  // CR-01 #2: filter the assignee list as you type. Matches name or title, so
  // "marketing" finds the Head of Marketing without knowing their name.
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return people;
    return people.filter((p) =>
      p.name.toLowerCase().includes(s) || (p.title || '').toLowerCase().includes(s));
  }, [people, q]);

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    if (!title.trim()) return setErr('A task title is required.');
    // CR-01 #1: summary is optional — deliberately not validated.
    if (!selfOnly && selected.size === 0) return setErr('Assign at least one stakeholder.');
    setBusy(true);
    try {
      const payload = {
        title, description, priority,
        expected_date: expected || null,
      };
      const id = selfOnly
        ? await api.createSelfTask(payload)
        : await api.createTask({ ...payload, next_followup_date: followup || null, stakeholders: [...selected] });
      onCreated(id);
    } catch (e2) {
      setErr(e2.message || 'Could not create the task.');
    } finally { setBusy(false); }
  };

  return (
    <Modal title={selfOnly ? 'New task for yourself' : 'New Task'} onClose={onClose} width={600}>
      <form onSubmit={submit}>
        {selfOnly && (
          <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', background: 'var(--line-soft)',
            padding: '9px 12px', borderRadius: 10, marginBottom: 15 }}>
            This lands on your board only. The CEO&apos;s Office can see it, but you own the date
            you set — there is nothing to confirm.
          </div>
        )}

        <Field label="Task title" required>
          <input className="gx-input" value={title} onChange={(e) => setTitle(e.target.value)}
            autoFocus placeholder="e.g. Prepare Q4 Growth Strategy" />
        </Field>

        {/* CR-01 #1: no longer required. */}
        <Field label="Summary / description">
          <textarea className="gx-input" rows={4} value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional — what is being asked, and why."
            style={{ resize: 'vertical', fontFamily: 'var(--font-b)' }} />
        </Field>

        <div style={{ display: 'grid', gridTemplateColumns: selfOnly ? '1fr 1fr' : '1fr 1fr 1fr', gap: 12 }}>
          <Field label="Priority">
            <div style={{ display: 'flex', gap: 6 }}>
              {Object.entries(PRIORITY).map(([k, p]) => (
                <button type="button" key={k} onClick={() => setPriority(k)}
                  aria-pressed={priority === k} className="gx-chip gx-focusable"
                  style={{ background: priority === k ? p.bg : 'transparent',
                    color: priority === k ? p.fg : 'var(--ink-soft)',
                    border: `1px solid ${priority === k ? p.dot : 'var(--line)'}`,
                    flex: 1, justifyContent: 'center' }}>
                  {p.label}
                </button>
              ))}
            </div>
          </Field>
          <Field label={selfOnly ? 'Due date' : 'Expected date'}>
            <input className="gx-input" type="date" value={expected}
              onChange={(e) => setExpected(e.target.value)} />
          </Field>
          {!selfOnly && (
            <Field label="Next follow-up">
              <input className="gx-input" type="date" value={followup}
                onChange={(e) => setFollowup(e.target.value)} />
            </Field>
          )}
        </div>

        {!selfOnly && (
          <Field label={`Assign to${selected.size ? ` · ${selected.size} selected` : ''}`} required>
            {/* CR-01 #2 */}
            <div style={{ position: 'relative', marginBottom: 8 }}>
              <Search size={14} aria-hidden="true"
                style={{ position: 'absolute', left: 11, top: 11, color: '#94a59b', pointerEvents: 'none' }} />
              <input className="gx-input" style={{ paddingLeft: 31, paddingRight: q ? 28 : 12 }}
                placeholder="Search by name or title…" aria-label="Search stakeholders"
                value={q} onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); setQ(''); } }} />
              {q && (
                <button type="button" onClick={() => setQ('')} aria-label="Clear stakeholder search"
                  style={{ position: 'absolute', right: 7, top: 8, background: 'none', border: 'none',
                    cursor: 'pointer', color: '#94a59b', padding: 2 }}>
                  <X size={14} />
                </button>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6,
              maxHeight: 200, overflow: 'auto', padding: 2 }}>
              {shown.map((p) => {
                const on = selected.has(p.id);
                return (
                  <button type="button" key={p.id} onClick={() => toggle(p.id)} className="gx-focusable"
                    aria-pressed={on} aria-label={`${p.name}, ${p.title || 'Stakeholder'}`}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
                      borderRadius: 10, cursor: 'pointer',
                      background: on ? 'var(--pop-soft)' : 'var(--surface)',
                      border: `1px solid ${on ? 'var(--pop)' : 'var(--line)'}`, textAlign: 'left' }}>
                    <Avatar name={p.name} color={p.color} size={24} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap',
                        overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</div>
                      <div style={{ fontSize: 10.5, color: 'var(--ink-soft)' }}>{p.title || 'Stakeholder'}</div>
                    </div>
                    {on && <Check size={15} style={{ color: 'var(--pop-deep)' }} />}
                  </button>
                );
              })}
            </div>

            {people.length > 0 && shown.length === 0 && (
              <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', padding: '10px 2px' }}>
                No stakeholder matches “{q}”.
              </div>
            )}
            {people.length === 0 && (
              <Empty title="No stakeholders yet" hint="Add someone before assigning work." />
            )}
          </Field>
        )}

        {err && (
          <div role="alert" style={{ fontSize: 12.5, color: '#C42424', background: '#FDE2E2',
            padding: '8px 11px', borderRadius: 9, marginBottom: 12 }}>{err}</div>
        )}
        <div style={{ textAlign: 'right' }}>
          <button type="button" className="gx-btn gx-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="gx-btn gx-btn-dark gx-focusable" disabled={busy}>
            {busy ? 'Creating…' : 'Create Task'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
