import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  X, Lock, RotateCcw, Archive as ArchiveIcon, Send, ArrowRight, Check,
  Paperclip, FileText, Download, Trash2, UserPlus,
} from 'lucide-react';
import { api, ACCEPTED_TYPES } from '../lib/api.js';
import { STATUS } from '../lib/styles.js';
import { fmtDate, fmtDateTime, roleLabel, isExecutiveRole } from '../lib/format.js';
import {
  FORWARD_NEXT, canReopen, canConfirmPromised, canProposePromised, canEditTask, canArchive,
  canViewAudit, isSelfCreated, canEditOwnTask, canDeleteTask, canDeleteOwnTask,
} from '../lib/rules.js';
import { Avatar, PriorityBadge, StatusBadge, Empty, Skeleton } from './ui.jsx';

const AUDIT_LABEL = {
  task_created: 'created the task', field_edited: 'edited', status_changed: 'moved status',
  task_reopened: 'reopened', promised_proposed: 'proposed a promised date',
  promised_confirmed: 'confirmed the promised date', stakeholder_added: 'added stakeholder',
  stakeholder_removed: 'removed stakeholder', comment_added: 'commented',
  attachment_added: 'added an attachment', attachment_removed: 'removed an attachment',
  task_archived: 'archived the task', task_restored: 'restored the task',
  task_deleted: 'permanently deleted',
};

export default function TaskDrawer({ task, me, onClose, refresh }) {
  const isExec = isExecutiveRole(me.role);
  const [tab, setTab] = useState('overview');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const run = async (fn) => {
    setErr(''); setBusy(true);
    try { await fn(); await refresh(); }
    catch (e) { setErr(friendlyError(e)); }
    finally { setBusy(false); }
  };

  // Escape closes the drawer, matching the Modal in components/ui.jsx.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const tabs = [['overview', 'Overview'], ['progress', 'Progress'], ['comments', 'Comments'], ['files', 'Attachments']];
  if (canViewAudit(me.role)) tabs.push(['activity', 'Activity']);

  return (
    <>
      <div className="gx-scrim" onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(21,36,27,.28)', zIndex: 50 }} />
      <aside className="gx-drawer" role="dialog" aria-modal="true" aria-label={task.title}
        style={{ position: 'fixed', top: 0, right: 0, height: '100vh', width: 620, maxWidth: '100%',
        background: 'var(--surface)', borderLeft: '1px solid var(--line)', zIndex: 51, display: 'flex', flexDirection: 'column' }}>
        {/* header */}
        <div style={{ padding: '16px 22px', borderBottom: '1px solid var(--line)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <PriorityBadge value={task.priority} />
            <span className="gx-mono" style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>#{task.id}</span>
            {/* CR-01 #6 */}
            {isSelfCreated(task) && (
              <span className="gx-chip" style={{ background: '#EFE7FF', color: '#6A3BD1', cursor: 'default' }}>
                <UserPlus size={11} /> Self-created by {task.creator?.name}
              </span>
            )}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              {canArchive(me.role) && !task.archived && (
                <button className="gx-btn gx-btn-ghost gx-focusable" onClick={() => run(() => api.archiveTask(task.id).then(onClose))}><ArchiveIcon size={15} /> Archive</button>
              )}
              {/* CR-01 #6: the creator may withdraw a task they raised — the
                  reversible option, offered first. */}
              {canEditOwnTask(me.role, task, me.id) && !task.archived && (
                <button className="gx-btn gx-btn-ghost gx-focusable"
                  onClick={() => {
                    if (window.confirm(`Withdraw “${task.title}”? It leaves your board; the CEO’s Office can restore it.`)) {
                      run(() => api.archiveSelfTask(task.id).then(onClose));
                    }
                  }}><ArchiveIcon size={15} /> Withdraw</button>
              )}

              {/* CR-01 #6: permanent delete. Irreversible, so the confirmation
                  names what is destroyed rather than asking "are you sure?". */}
              {(canDeleteTask(me.role) || canDeleteOwnTask(me.role, task, me.id)) && (
                <button className="gx-btn gx-btn-ghost gx-focusable" style={{ color: '#C42424' }}
                  title="Delete permanently"
                  onClick={() => {
                    const n = task.assignments?.length || 0;
                    if (window.confirm(
                      `Delete “${task.title}” permanently?\n\n`
                      + `This destroys the task, its ${n} assignment${n === 1 ? '' : 's'}, `
                      + `every comment and every attachment. It cannot be undone — `
                      + `use Archive instead if you may want it back.\n\n`
                      + `The activity log keeps a record that you deleted it.`
                    )) {
                      run(() => (canDeleteTask(me.role)
                        ? api.deleteTask(task.id)
                        : api.deleteSelfTask(task.id)).then(onClose));
                    }
                  }}><Trash2 size={15} /> Delete</button>
              )}
              <button className="gx-btn gx-btn-ghost gx-focusable" onClick={onClose} aria-label="Close"><X size={17} /></button>
            </div>
          </div>
          <h2 className="gx-disp" style={{ fontSize: 20, fontWeight: 800, margin: '10px 0 0' }}>{task.title}</h2>
        </div>

        {/* tabs — real ARIA tabs, with arrow-key roving focus */}
        <div role="tablist" aria-label="Task details"
          style={{ display: 'flex', padding: '0 22px', borderBottom: '1px solid var(--line)' }}>
          {tabs.map(([id, label], i) => (
            <button key={id} role="tab" id={`tab-${id}`} aria-controls={`panel-${id}`}
              aria-selected={tab === id} tabIndex={tab === id ? 0 : -1}
              className={`gx-tab gx-focusable${tab === id ? ' on' : ''}`}
              style={{ background: 'none', border: 'none', borderBottom: '2px solid transparent' }}
              onClick={() => setTab(id)}
              onKeyDown={(e) => {
                if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
                e.preventDefault();
                const next = (i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
                setTab(tabs[next][0]);
                document.getElementById(`tab-${tabs[next][0]}`)?.focus();
              }}>
              {label}
            </button>
          ))}
        </div>

        {err && <div style={{ margin: '12px 22px 0', fontSize: 12.5, color: '#C42424', background: '#FDE2E2', padding: '8px 11px', borderRadius: 9 }}>{err}</div>}

        <div style={{ flex: 1, overflow: 'auto', padding: 22 }}
          role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} tabIndex={0}>
          {tab === 'overview' && <Overview task={task} me={me} run={run} busy={busy} />}
          {tab === 'progress' && <Progress task={task} me={me} isExec={isExec} run={run} busy={busy} />}
          {tab === 'comments' && <Comments task={task} isExec={isExec} />}
          {tab === 'files' && <Attachments task={task} isExec={isExec} refresh={refresh} />}
          {tab === 'activity' && <Activity task={task} />}
        </div>
      </aside>
    </>
  );
}

// ── Overview ─────────────────────────────────────────────────────────────────
function Overview({ task, me, run, busy }) {
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState({ title: task.title, description: task.description, priority: task.priority, expected_date: task.expected_date || '', next_followup_date: task.next_followup_date || '' });
  useEffect(() => { setF({ title: task.title, description: task.description, priority: task.priority, expected_date: task.expected_date || '', next_followup_date: task.next_followup_date || '' }); }, [task]);

  // Two routes into edit mode. An executive may edit any task via updateTask.
  // CR-01 #6 adds a second: the stakeholder who RAISED a task may edit that one,
  // through update_self_task — which the server scopes to the creator, so this
  // never becomes a way to edit work assigned to them.
  const asExec = canEditTask(me.role);
  const asCreator = canEditOwnTask(me.role, task, me.id);
  const mayEdit = asExec || asCreator;
  const selfCreated = isSelfCreated(task);

  if (edit && mayEdit) {
    return (
      <div>
        <label className="gx-th" style={{ background: 'transparent', padding: 0 }}>Title</label>
        <input className="gx-input" style={{ margin: '4px 0 12px' }} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        <label className="gx-th" style={{ background: 'transparent', padding: 0 }}>Description</label>
        <textarea className="gx-input" rows={4} style={{ margin: '4px 0 12px', fontFamily: 'var(--font-b)' }} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        <div style={{ display: 'grid', gridTemplateColumns: asExec ? '1fr 1fr' : '1fr', gap: 12 }}>
          <div><label className="gx-th" style={{ background: 'transparent', padding: 0 }}>{asExec ? 'Expected' : 'Due date'}</label>
            <input className="gx-input" type="date" style={{ marginTop: 4 }} value={f.expected_date || ''} onChange={(e) => setF({ ...f, expected_date: e.target.value })} /></div>
          {/* Follow-up dates are the CEO Office's chase mechanism, not the
              stakeholder's — kept out of the self-created edit form. */}
          {asExec && (
            <div><label className="gx-th" style={{ background: 'transparent', padding: 0 }}>Follow-up</label>
              <input className="gx-input" type="date" style={{ marginTop: 4 }} value={f.next_followup_date || ''} onChange={(e) => setF({ ...f, next_followup_date: e.target.value })} /></div>
          )}
        </div>
        <div style={{ marginTop: 16, textAlign: 'right' }}>
          <button className="gx-btn gx-btn-ghost" onClick={() => setEdit(false)}>Cancel</button>
          <button className="gx-btn gx-btn-dark gx-focusable" disabled={busy}
            onClick={() => run(() => (asExec
              ? api.updateTask(task.id, { title: f.title, description: f.description, priority: f.priority, expected_date: f.expected_date || null, next_followup_date: f.next_followup_date || null })
              : api.updateSelfTask(task.id, { title: f.title, description: f.description, priority: f.priority, expected_date: f.expected_date || null })
            )).then(() => setEdit(false))}>Save changes</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Summary is optional as of CR-01 #1, so an empty one is normal now
          rather than a gap someone forgot to fill. */}
      <p style={{ fontSize: 13.5, lineHeight: 1.6, whiteSpace: 'pre-wrap', marginTop: 0,
        color: task.description ? 'var(--ink)' : 'var(--ink-soft)',
        fontStyle: task.description ? 'normal' : 'italic' }}>
        {task.description || 'No summary.'}
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 18 }}>
        <Meta label={selfCreated ? 'Due date' : 'Expected date'} value={fmtDate(task.expected_date)} />
        <Meta label="Next follow-up" value={fmtDate(task.next_followup_date)} />
        <Meta label="Assignees" value={`${task.assignments?.length || 0}`} />
        <Meta label="Created" value={fmtDateTime(task.created_at)} />
        <Meta label="Raised by"
          value={task.creator?.name ? `${task.creator.name}${selfCreated ? ' (self)' : ''}` : '—'} />
      </div>
      {mayEdit && (
        <button className="gx-btn gx-btn-line gx-focusable" style={{ marginTop: 18 }} onClick={() => setEdit(true)}>Edit details</button>
      )}
    </div>
  );
}
const Meta = ({ label, value }) => (
  <div>
    <div className="gx-th" style={{ background: 'transparent', padding: 0, marginBottom: 3 }}>{label}</div>
    <div style={{ fontSize: 13.5, fontWeight: 600 }}>{value}</div>
  </div>
);

// ── Progress (status + promised date) ────────────────────────────────────────
function Progress({ task, me, isExec, run, busy }) {
  const rows = task.assignments || [];
  if (rows.length === 0) return <div style={{ color: 'var(--ink-soft)', fontSize: 13 }}>No assignees.</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {rows.map((a) => <AssignmentRow key={a.id} a={a} task={task} me={me} isExec={isExec} run={run} busy={busy} />)}
    </div>
  );
}

function AssignmentRow({ a, task, me, isExec, run, busy }) {
  const isOwner = a.stakeholder_id === me.id;
  const next = FORWARD_NEXT[a.status];
  const [pdate, setPdate] = useState(a.promised_proposed || '');

  return (
    <div className="gx-card" style={{ padding: 15 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <Avatar name={a.stakeholder?.name} color={a.stakeholder?.color} size={28} />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 13.5 }}>{a.stakeholder?.name}{isOwner ? ' · You' : ''}</div>
          <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>{a.stakeholder?.title || 'Stakeholder'}</div>
        </div>
        <StatusBadge value={a.status} />
      </div>

      {/* status controls */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {!isExec && isOwner && next && (
          <button className="gx-btn gx-btn-dark gx-focusable" disabled={busy} onClick={() => run(() => api.advanceStatus(a.id, next))}>
            Move to {STATUS[next].label} <ArrowRight size={14} />
          </button>
        )}
        {!isExec && isOwner && !next && a.status === 'done' && (
          <span style={{ fontSize: 12.5, color: 'var(--pop-deep)', fontWeight: 600 }}><Check size={13} style={{ verticalAlign: -2 }} /> Completed</span>
        )}
        {isExec && (
          <>
            <select className="gx-input" style={{ width: 'auto' }} value={a.status} disabled={busy}
              onChange={(e) => run(() => api.advanceStatus(a.id, e.target.value))}>
              {Object.keys(STATUS).map((s) => <option key={s} value={s}>{STATUS[s].label}</option>)}
            </select>
            {canReopen(me.role, a) && (
              <button className="gx-btn gx-btn-line gx-focusable" disabled={busy} onClick={() => run(() => api.reopen(a.id))}><RotateCcw size={13} /> Reopen</button>
            )}
          </>
        )}
      </div>

      {/* promised date */}
      <div style={{ marginTop: 13, paddingTop: 13, borderTop: '1px solid var(--line-soft)' }}>
        <div className="gx-th" style={{ background: 'transparent', padding: 0, marginBottom: 7 }}>Promised date</div>
        {a.promised_state === 'confirmed' ? (
          <span className="gx-lock"><Lock size={12} /> {fmtDate(a.promised_date)} · confirmed</span>
        ) : a.promised_state === 'proposed' ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
            <span className="gx-chip" style={{ background: '#FFEFD6', color: '#9A5B00', cursor: 'default' }}>Proposed {fmtDate(a.promised_proposed)} · awaiting confirmation</span>
            {canConfirmPromised(me.role, a, task) && (
              <button className="gx-btn gx-btn-dark gx-focusable" disabled={busy} onClick={() => run(() => api.confirmPromised(a.id))}>Confirm & lock</button>
            )}
          </div>
        ) : canProposePromised(me.role, a, isOwner, task) ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input className="gx-input" type="date" style={{ width: 'auto' }} value={pdate} onChange={(e) => setPdate(e.target.value)} />
            <button className="gx-btn gx-btn-line gx-focusable" disabled={busy || !pdate} onClick={() => run(() => api.proposePromised(a.id, pdate))}>Propose date</button>
          </div>
        ) : isSelfCreated(task) ? (
          // CR-01 #6: no propose → confirm handshake here. Say why, rather than
          // leaving an empty slot that looks like something is missing.
          <span style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>
            Not applicable — {fmtDate(task.expected_date)} was set by the person who raised this task.
          </span>
        ) : (
          <span style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>Not yet proposed.</span>
        )}
      </div>
    </div>
  );
}

// ── Comments (per assignment thread, isolated) ───────────────────────────────
// A stakeholder receives exactly one assignment from the server, so `threads`
// has a single entry and the picker never renders. An executive gets one thread
// per assignee and switches between them.
function Comments({ task, isExec }) {
  const threads = useMemo(() => task.assignments || [], [task.assignments]);
  const [active, setActive] = useState(threads[0]?.id || null);
  const [items, setItems] = useState(null);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const activeAssignment = useMemo(() => threads.find((t) => t.id === active), [threads, active]);

  const load = useCallback(() => {
    if (!active) return;
    setItems(null);
    api.comments(active).then(setItems).catch(() => setItems([]));
  }, [active]);

  useEffect(() => { load(); }, [load]);

  const post = async () => {
    if (!body.trim()) return;
    setBusy(true); setErr('');
    try { await api.addComment(active, body.trim()); setBody(''); load(); }
    catch (e) { setErr(friendlyError(e)); }
    finally { setBusy(false); }
  };

  if (!active) return <div style={{ color: 'var(--ink-soft)', fontSize: 13 }}>No assignees to comment on.</div>;

  return (
    <div>
      {isExec && threads.length > 1 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
          {threads.map((t) => (
            <span key={t.id} className="gx-chip gx-focusable" onClick={() => setActive(t.id)}
              style={{ background: active === t.id ? 'var(--pop)' : 'var(--surface)', color: active === t.id ? '#fff' : 'var(--ink)', border: '1px solid var(--line)' }}>
              {t.stakeholder?.name?.split(' ')[0]}
            </span>
          ))}
        </div>
      )}
      {isExec && <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginBottom: 12 }}>Thread with {activeAssignment?.stakeholder?.name}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
        {items === null ? <span style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>Loading…</span>
          : items.length === 0 ? <span style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>No comments yet.</span>
            : items.map((c) => (
              <div key={c.id} style={{ display: 'flex', gap: 10 }}>
                <Avatar name={c.author?.name} size={26} />
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}>
                    <span style={{ fontWeight: 700, fontSize: 12.5 }}>{c.author?.name}</span>
                    <span className="gx-chip" style={{ background: '#EEF4EF', color: '#586860', cursor: 'default', padding: '1px 7px', fontSize: 10 }}>{roleLabel(c.author_role)}</span>
                    <span style={{ fontSize: 11, color: 'var(--ink-soft)', marginLeft: 'auto' }}>{fmtDateTime(c.created_at)}</span>
                  </div>
                  <div style={{ fontSize: 13, marginTop: 3, lineHeight: 1.5 }}>{c.body}</div>
                </div>
              </div>
            ))}
      </div>

      {err && <div role="alert" style={{ fontSize: 12, color: '#C42424', marginBottom: 8, fontWeight: 600 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <input className="gx-input" placeholder="Write a comment…" aria-label="Write a comment"
          value={body} onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && post()} />
        <button className="gx-btn gx-btn-dark gx-focusable" disabled={busy || !body.trim()}
          onClick={post} aria-label="Post comment"><Send size={15} /></button>
      </div>
      <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 7 }}>Comments are permanent and cannot be edited or deleted.</div>
    </div>
  );
}

// ── Attachments ──────────────────────────────────────────────────────────────
// The bucket is private. Files are opened through a short-lived signed URL that
// is minted on click and never stored, so nothing here is a durable public link.
// Anyone who can see the task can read its files; only EA/CEO can add or remove.
function Attachments({ task, isExec, refresh }) {
  const [items, setItems] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(() => {
    api.attachments(task.id).then(setItems).catch(() => setItems([]));
  }, [task.id]);
  useEffect(() => { load(); }, [load]);

  const upload = async (files) => {
    if (!files?.length) return;
    setBusy(true); setErr('');
    try {
      for (const f of files) await api.uploadAttachment(task.id, f);
      load();
      await refresh();
    } catch (e) {
      setErr(friendlyFileError(e));
    } finally { setBusy(false); }
  };

  const open = async (row) => {
    setErr('');
    try { window.open(await api.attachmentUrl(row.storage_path), '_blank', 'noopener'); }
    catch { setErr('That file could not be opened. It may have been removed.'); }
  };

  const remove = async (row) => {
    if (!window.confirm(`Remove ${row.file_name}?`)) return;
    setBusy(true); setErr('');
    try { await api.deleteAttachment(row); load(); await refresh(); }
    catch (e) { setErr(friendlyFileError(e)); }
    finally { setBusy(false); }
  };

  return (
    <div>
      {isExec && (
        <label className="gx-btn gx-btn-line gx-focusable"
          style={{ display: 'inline-flex', marginBottom: 16, opacity: busy ? 0.6 : 1, cursor: busy ? 'wait' : 'pointer' }}>
          <Paperclip size={14} /> {busy ? 'Uploading…' : 'Add files'}
          <input type="file" multiple hidden disabled={busy} accept={ACCEPTED_TYPES}
            onChange={(e) => { upload([...e.target.files]); e.target.value = ''; }} />
        </label>
      )}

      {err && (
        <div role="alert" style={{ fontSize: 12.5, color: '#C42424', background: '#FDE2E2',
          padding: '8px 11px', borderRadius: 9, marginBottom: 12, fontWeight: 600 }}>{err}</div>
      )}

      {items === null ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[0, 1].map((i) => <Skeleton key={i} h={46} />)}
        </div>
      ) : items.length === 0 ? (
        <Empty icon={Paperclip} title="No attachments"
          hint={isExec ? 'Add the brief, deck or working file for this request.'
            : 'Files added by the CEO’s Office will appear here.'} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {items.map((f) => (
            <div key={f.id} className="gx-card" style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '10px 13px' }}>
              <FileText size={17} style={{ color: 'var(--ink-soft)', flex: 'none' }} aria-hidden="true" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {f.file_name}
                </div>
                <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 2 }}>
                  {fmtBytes(f.size_bytes)} · {f.uploader?.name || 'Unknown'} · {fmtDateTime(f.created_at)}
                </div>
              </div>
              <button className="gx-btn gx-btn-ghost gx-focusable" onClick={() => open(f)}
                title={`Open ${f.file_name}`} aria-label={`Open ${f.file_name}`}>
                <Download size={15} />
              </button>
              {isExec && (
                <button className="gx-btn gx-btn-ghost gx-focusable" disabled={busy} onClick={() => remove(f)}
                  title={`Remove ${f.file_name}`} aria-label={`Remove ${f.file_name}`} style={{ color: '#C42424' }}>
                  <Trash2 size={15} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const fmtBytes = (n) => {
  if (!n && n !== 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
};

function friendlyFileError(e) {
  const m = String(e?.message || e).toLowerCase();
  if (m.includes('mime') || m.includes('not allowed') || m.includes('invalid_mime')) {
    return 'File could not be uploaded. Allowed types are PDF, DOCX, XLSX, PNG and JPG.';
  }
  if (m.includes('larger than') || m.includes('exceeded') || m.includes('too large') || m.includes('payload')) {
    return 'File could not be uploaded. Each file must be 10 MB or smaller.';
  }
  if (m.includes('row-level security') || m.includes('forbidden') || m.includes('violates')) {
    return 'You don’t have permission to change attachments on this task.';
  }
  return 'File could not be uploaded. Please check the file type and size.';
}

// ── Activity (audit) ─────────────────────────────────────────────────────────
function Activity({ task }) {
  const [items, setItems] = useState(null);
  useEffect(() => { api.audit(task.id).then(setItems).catch(() => setItems([])); }, [task.id]);
  if (items === null) return <span style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>Loading…</span>;
  if (items.length === 0) return <span style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>No activity yet.</span>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
        <button className="gx-btn gx-btn-line gx-focusable" onClick={() => exportAuditCsv(task, items)}>
          <Download size={14} /> Export CSV
        </button>
      </div>
      {items.map((e) => (
        <div key={e.id} style={{ display: 'flex', gap: 11, padding: '9px 0', borderBottom: '1px solid var(--line-soft)' }}>
          <div style={{ width: 6 }}><span className="gx-dot" style={{ background: 'var(--pop)', marginTop: 6 }} /></div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12.5 }}>
              <b>{e.actor?.name || 'System'}</b> {AUDIT_LABEL[e.action] || e.action}
              {e.field ? <> <span style={{ color: 'var(--ink-soft)' }}>{e.field}</span></> : null}
              {e.old_value != null || e.new_value != null ? (
                <span style={{ color: 'var(--ink-soft)' }}> {e.old_value ? `${e.old_value} → ` : ''}{e.new_value || ''}</span>
              ) : null}
            </div>
            <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 2 }}>{fmtDateTime(e.created_at)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// Download the audit trail as a CSV. Executive-only in practice (the Activity
// tab is), and a plain client-side blob — nothing leaves the browser.
function exportAuditCsv(task, items) {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = ['When', 'Actor', 'Role', 'Action', 'Field', 'Old value', 'New value'];
  const rows = items.map((e) => [
    fmtDateTime(e.created_at), e.actor?.name || 'System', e.actor_role || '',
    AUDIT_LABEL[e.action] || e.action, e.field || '', e.old_value ?? '', e.new_value ?? '',
  ]);
  const csv = [header, ...rows].map((r) => r.map(esc).join(',')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `task-${task.id}-audit.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function friendlyError(e) {
  const m = String(e?.message || e);
  if (m.includes('INVALID_TRANSITION')) return 'This task cannot be moved there directly. Complete the workflow one step at a time.';
  if (m.includes('LOCKED')) return 'This promised date has been confirmed and locked. Contact the EA or CEO to change it.';
  if (m.includes('FORBIDDEN') || m.includes('insufficient')) return "You don't have permission to perform this action.";
  return m;
}
