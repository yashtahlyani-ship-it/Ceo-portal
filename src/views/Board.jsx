import { useMemo, useState } from 'react';
import { MessageSquare, Paperclip, Lock, KanbanSquare, ArrowRight, MoreHorizontal, Loader2, X, UserPlus } from 'lucide-react';
import { STATUS, PRIORITY } from '../lib/styles.js';
import { toCards } from '../lib/derive.js';
import { dueMeta, isExecutiveRole } from '../lib/format.js';
import { FORWARD_NEXT, allowedTargets, EMPTY_FILTERS, isSelfCreated } from '../lib/rules.js';
import { applyFilters, isFiltered, friendlyMoveError } from '../lib/filters.js';
import { api } from '../lib/api.js';
import { Avatar, PriorityBadge, DueChip, Empty, Dropdown } from '../components/ui.jsx';

const BASE_COLS = ['todo', 'in_progress', 'under_review', 'done'];

const DUE_BUCKET_LABEL = { overdue: 'Overdue', today: 'Due today', next7: 'Due in 7 days' };

/* The cross-stakeholder executive board and the stakeholder's own board are the
   same component. They differ only in what the server returned: RLS gives a
   stakeholder their own assignment rows and nothing else, so no role branch is
   needed to keep the boards separate — only to decide which controls to render. */
export default function Board({ tasks, allTasks, role, me, onOpen, refresh, filters, setFilters }) {
  const isExec = isExecutiveRole(role);
  const [busyId, setBusyId] = useState(null);
  const [err, setErr] = useState('');

  const cards = useMemo(() => applyFilters(toCards(tasks), filters), [tasks, filters]);

  // Re-opened is not a permanent column. It appears only while something sits
  // in it, and slots in before Done so the rework path reads left-to-right.
  const hasReopened = cards.some((c) => c.a.status === 'reopened');
  const cols = hasReopened ? [...BASE_COLS.slice(0, 3), 'reopened', 'done'] : BASE_COLS;

  const move = async (assignmentId, target) => {
    setErr(''); setBusyId(assignmentId);
    try { await api.advanceStatus(assignmentId, target); await refresh(); }
    catch (e) { setErr(friendlyMoveError(e)); }
    finally { setBusyId(null); }
  };

  const stakeholderOptions = useMemo(() => {
    const m = new Map();
    for (const { a } of toCards(allTasks || [])) if (a.stakeholder) m.set(a.stakeholder.id, a.stakeholder);
    return [...m.values()].sort((x, y) => x.name.localeCompare(y.name));
  }, [allTasks]);

  return (
    <div className="gx-fade">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 3 }}>
        <h1 className="gx-disp" style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>
          {isExec ? 'Kanban' : 'My Board'}
        </h1>
        <span style={{ fontSize: 12.5, color: 'var(--ink-soft)', fontWeight: 600 }}>
          {cards.length} {cards.length === 1 ? 'card' : 'cards'}
        </span>
      </div>
      <p style={{ color: 'var(--ink-soft)', marginTop: 0, marginBottom: 16, fontSize: 13.5 }}>
        {isExec
          ? 'One card per stakeholder assignment. Move any card to any column.'
          : 'Move each card forward one stage at a time as you make progress.'}
      </p>

      <FilterBar filters={filters} setFilters={setFilters}
        stakeholders={isExec ? stakeholderOptions : []} />

      {err && (
        <div role="alert" style={{ margin: '0 0 14px', fontSize: 12.5, color: '#C42424', background: '#FDE2E2',
          padding: '9px 12px', borderRadius: 10, fontWeight: 600 }}>{err}</div>
      )}

      {cards.length === 0 ? (
        <div className="gx-card">
          <Empty icon={KanbanSquare}
            title={isFiltered(filters) ? 'No cards match these filters' : (isExec ? 'No tasks on the board' : 'No tasks assigned to you')}
            hint={isFiltered(filters)
              ? 'Try clearing a filter to widen the view.'
              : (isExec ? 'Create a task to start tracking what the CEO’s Office has asked for.'
                        : 'New tasks assigned by the CEO’s Office will appear here.')} />
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols.length}, minmax(236px, 1fr))`,
          gap: 14, alignItems: 'start' }}>
          {cols.map((col) => {
            const items = cards.filter((c) => c.a.status === col);
            const meta = STATUS[col];
            return (
              <section key={col} className="gx-col" aria-label={`${meta.label}, ${items.length} cards`}>
                <div className="gx-col-head">
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontWeight: 700, fontSize: 12.5 }}>
                    <span className="gx-dot" style={{ background: meta.dot }} /> {meta.label}
                  </span>
                  <span className="gx-mono" style={{ fontSize: 11, color: 'var(--ink-soft)' }}>{items.length}</span>
                </div>
                <div className="gx-stagger" style={{ display: 'flex', flexDirection: 'column', gap: 9, padding: '2px 9px 12px' }}>
                  {items.length === 0 && (
                    <div style={{ fontSize: 11.5, color: '#94a59b', textAlign: 'center', padding: '14px 4px' }}>
                      Nothing here
                    </div>
                  )}
                  {items.map(({ task, a }) => (
                    <KCard key={a.id} task={task} a={a} me={me} role={role} isExec={isExec}
                      busy={busyId === a.id} onOpen={onOpen} onMove={move} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── Card ── */
export function KCard({ task, a, me, role, isExec, busy, onOpen, onMove }) {
  const due = dueMeta(task.expected_date);
  const isMine = a.stakeholder_id === me?.id;
  const selfCreated = isSelfCreated(task);
  const next = FORWARD_NEXT[a.status];
  // A stakeholder gets exactly one forward step; an executive gets the full menu.
  const canStep = !isExec && isMine && !!next;

  return (
    <article className="gx-kcard gx-focusable" tabIndex={0} role="button"
      aria-label={`${task.title}, ${STATUS[a.status].label}`}
      onClick={() => onOpen(task.id)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(task.id); } }}>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <PriorityBadge value={task.priority} />
        <span className="gx-mono" style={{ fontSize: 10.5, color: 'var(--ink-soft)' }}>#{task.id}</span>
      </div>

      <div style={{ fontWeight: 700, fontSize: 13.5, lineHeight: 1.3, marginBottom: 9 }}>{task.title}</div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 9 }}>
        <Avatar name={a.stakeholder?.name} color={a.stakeholder?.color} size={22} />
        <span style={{ fontSize: 12, color: 'var(--ink-soft)', fontWeight: 600, overflow: 'hidden',
          textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.stakeholder?.name}</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
        <DueChip meta={due} />
        {a.promised_state === 'confirmed' && (
          <span className="gx-lock" title={`Promised date confirmed and locked`}>
            <Lock size={11} /> Promised
          </span>
        )}
        {a.promised_state === 'proposed' && (
          <span className="gx-chip" style={{ background: '#FFEFD6', color: '#9A5B00', cursor: 'default' }}>
            Awaiting confirmation
          </span>
        )}
        {/* CR-01 #6: tells the EA at a glance which tasks she assigned and
            which the stakeholder raised themselves. Only meaningful to an
            executive — a stakeholder already knows what they raised. */}
        {isExec && selfCreated && (
          <span className="gx-chip" style={{ background: '#EFE7FF', color: '#6A3BD1', cursor: 'default' }}
            title={`Raised by ${task.creator?.name} for themselves`}>
            <UserPlus size={11} /> Self-created
          </span>
        )}
        {a.comment_count > 0 && <Meta icon={MessageSquare} n={a.comment_count} label="comments" />}
        {task.attachment_count > 0 && <Meta icon={Paperclip} n={task.attachment_count} label="attachments" />}
      </div>

      {(canStep || isExec) && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--line-soft)' }}
          onClick={(e) => e.stopPropagation()}>
          {busy ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--ink-soft)', fontWeight: 600 }}>
              <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> Moving…
            </span>
          ) : canStep ? (
            <button className="gx-btn gx-focusable"
              onClick={() => onMove(a.id, next)}
              style={{ background: 'var(--pop-soft)', color: 'var(--pop-deep)', padding: '6px 11px',
                fontSize: 12, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              Move to {STATUS[next].label} <ArrowRight size={12} />
            </button>
          ) : (
            <MoveMenu a={a} role={role} onMove={onMove} />
          )}
        </div>
      )}
    </article>
  );
}

const Meta = ({ icon: Icon, n, label }) => (
  <span title={`${n} ${label}`} aria-label={`${n} ${label}`}
    style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11.5, color: 'var(--ink-soft)', fontWeight: 600 }}>
    <Icon size={12} aria-hidden="true" /> {n}
  </span>
);

/* Executive override — move an assignment to any other status. Every move here
   writes an audit event server-side, which is the point of keeping it explicit
   rather than a silent drag. */
function MoveMenu({ a, role, onMove }) {
  const targets = allowedTargets(role, a);
  if (targets.length === 0) return null;
  return (
    <Dropdown width={190} ariaLabel="Move this task to another status"
      label={<>Move <MoreHorizontal size={13} /></>}>
      {(close) => targets.map((t) => (
        <div key={t} role="menuitem" tabIndex={0} className="gx-menuitem"
          onClick={() => { close(); onMove(a.id, t); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); close(); onMove(a.id, t); }
          }}>
          <span className="gx-dot" style={{ background: STATUS[t].dot }} /> {STATUS[t].label}
        </div>
      ))}
    </Dropdown>
  );
}

/* ── Filters ── */
function FilterBar({ filters, setFilters, stakeholders }) {
  const set = (k, v) => setFilters({ ...filters, [k]: v || null });
  const dirty = isFiltered(filters);

  return (
    <div className="gx-card" style={{ padding: '11px 14px', marginBottom: 16, display: 'flex',
      alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      {stakeholders.length > 0 && (
        <Select label="Stakeholder" value={filters.stakeholder || ''} onChange={(v) => set('stakeholder', v)}
          options={[['', 'All stakeholders'], ...stakeholders.map((s) => [s.id, s.name])]} />
      )}
      <Select label="Priority" value={filters.priority || ''} onChange={(v) => set('priority', v)}
        options={[['', 'Any priority'], ...Object.entries(PRIORITY).map(([k, v]) => [k, v.label])]} />
      <Select label="Status" value={filters.status || ''} onChange={(v) => set('status', v)}
        options={[['', 'Any status'], ...Object.entries(STATUS).map(([k, v]) => [k, v.label])]} />

      {/* CR-01 #3/#4: the manual date range filters on when a task was RAISED.
          Expected date is no longer a manual filter — the dashboard's overdue /
          due-soon tiles still work off it, via filters.dueBucket. */}
      <DateBox label="Created from" value={filters.createdFrom}
        onChange={(v) => setFilters({ ...filters, createdFrom: v })} />
      <DateBox label="to" value={filters.createdTo}
        onChange={(v) => setFilters({ ...filters, createdTo: v })} />

      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600,
        color: 'var(--ink-soft)', cursor: 'pointer' }}>
        <input type="checkbox" checked={filters.followupsDue}
          onChange={(e) => setFilters({ ...filters, followupsDue: e.target.checked })} />
        Follow-up due
      </label>

      {/* Set by a dashboard tile rather than by a control here, so it is shown
          as a removable chip — otherwise the board would silently be filtered
          by something with no visible cause. */}
      {filters.dueBucket && (
        <span className="gx-chip" style={{ background: '#FDE2E2', color: '#C42424', gap: 6 }}>
          {DUE_BUCKET_LABEL[filters.dueBucket]}
          <button onClick={() => setFilters({ ...filters, dueBucket: null })}
            aria-label={`Remove ${DUE_BUCKET_LABEL[filters.dueBucket]} filter`}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', display: 'flex', padding: 0 }}>
            <X size={12} />
          </button>
        </span>
      )}

      {dirty && (
        <button className="gx-btn gx-btn-ghost gx-focusable" style={{ marginLeft: 'auto', fontSize: 12.5 }}
          onClick={() => setFilters(EMPTY_FILTERS)}>Clear filters</button>
      )}
    </div>
  );
}

const Select = ({ label, value, onChange, options }) => (
  <label style={{ display: 'inline-flex', flexDirection: 'column', gap: 3 }}>
    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.03em', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>{label}</span>
    <select className="gx-input" style={{ padding: '6px 9px', fontSize: 12.5, width: 'auto', cursor: 'pointer' }}
      value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  </label>
);

const DateBox = ({ label, value, onChange }) => (
  <label style={{ display: 'inline-flex', flexDirection: 'column', gap: 3 }}>
    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.03em', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>{label}</span>
    <input type="date" className="gx-input gx-mono"
      style={{ padding: '5px 8px', fontSize: 11.5, width: 'auto' }}
      value={value || ''} onChange={(e) => onChange(e.target.value)} />
  </label>
);

// Filtering and error copy live in lib/filters.js so they can be unit-tested
// without a JSX transform.
export { applyFilters, isFiltered, friendlyMoveError };
