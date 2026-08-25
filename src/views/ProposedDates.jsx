import { useCallback, useEffect, useState } from 'react';
import { CalendarCheck, Check, X, Loader2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { fmtDate, daysUntil } from '../lib/format.js';
import { Avatar, PriorityBadge, DueChip, Empty, Skeleton } from '../components/ui.jsx';
import { dueMeta } from '../lib/format.js';

/* CR-02 #3/#4 — the promised-date decision queue. Executive-only.
   Every assignment whose stakeholder has proposed a date and is waiting on an
   answer, oldest first: the person who has been waiting longest is the one to
   deal with first.

   Confirm locks the date. Reject requires a reason, which is written into the
   task's comment thread — permanent and visible to the stakeholder — rather
   than disappearing into a notification they may dismiss. */
export default function ProposedDates({ onOpen, refresh }) {
  const [rows, setRows] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [rejecting, setRejecting] = useState(null);   // assignment id
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');

  const load = useCallback(() => {
    api.proposedDates().then(setRows).catch((e) => { setErr(e.message); setRows([]); });
  }, []);
  useEffect(() => { load(); }, [load]);

  const run = async (id, fn) => {
    setErr(''); setBusyId(id);
    try { await fn(); load(); await refresh?.(); }
    catch (e) { setErr(friendly(e)); }
    finally { setBusyId(null); }
  };

  const confirm = (r) => run(r.id, () => api.confirmPromised(r.id));

  const submitReject = (r) => {
    if (!reason.trim()) { setErr('Say why the date was rejected — the stakeholder needs to know what to propose instead.'); return; }
    run(r.id, async () => {
      await api.rejectPromised(r.id, reason.trim());
      setRejecting(null); setReason('');
    });
  };

  return (
    <div className="gx-fade">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 3 }}>
        <h1 className="gx-disp" style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>Proposed Dates</h1>
        {rows && rows.length > 0 && (
          <span style={{ fontSize: 12.5, color: 'var(--ink-soft)', fontWeight: 600 }}>
            {rows.length} awaiting a decision
          </span>
        )}
      </div>
      <p style={{ color: 'var(--ink-soft)', marginTop: 0, marginBottom: 18, fontSize: 13.5 }}>
        Dates stakeholders have proposed, longest wait first. Confirming locks the date; rejecting
        asks them for a new one.
      </p>

      {err && (
        <div role="alert" style={{ fontSize: 12.5, color: '#C42424', background: '#FDE2E2',
          padding: '9px 12px', borderRadius: 10, marginBottom: 14, fontWeight: 600 }}>{err}</div>
      )}

      {rows === null ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[0, 1, 2].map((i) => <Skeleton key={i} h={78} />)}
        </div>
      ) : rows.length === 0 ? (
        <div className="gx-card">
          <Empty icon={CalendarCheck} title="Nothing awaiting a decision"
            hint="When a stakeholder proposes a promised date, it appears here for you to confirm or reject." />
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {rows.map((r) => {
            const waiting = -(daysUntil(r.updated_at?.slice(0, 10)) ?? 0);
            const isRejecting = rejecting === r.id;
            return (
              <div key={r.id} className="gx-card" style={{ padding: 15 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <Avatar name={r.stakeholder?.name} color={r.stakeholder?.color} size={32} />
                  <div style={{ flex: 1, minWidth: 180 }}>
                    <button className="gx-focusable" onClick={() => onOpen(r.task.id)}
                      style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                        font: 'inherit', fontWeight: 700, fontSize: 14, textAlign: 'left', color: 'var(--ink)' }}>
                      {r.task.title}
                    </button>
                    <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 2 }}>
                      {r.stakeholder?.name}{r.stakeholder?.title ? ` · ${r.stakeholder.title}` : ''}
                    </div>
                  </div>

                  <PriorityBadge value={r.task.priority} />

                  <div style={{ textAlign: 'right', minWidth: 150 }}>
                    <div className="gx-th" style={{ background: 'transparent', padding: 0 }}>Proposed</div>
                    <div style={{ fontWeight: 700, fontSize: 13.5 }}>{fmtDate(r.promised_proposed)}</div>
                  </div>
                  <div style={{ textAlign: 'right', minWidth: 130 }}>
                    <div className="gx-th" style={{ background: 'transparent', padding: 0 }}>Expected</div>
                    <DueChip meta={dueMeta(r.task.expected_date)} />
                  </div>
                </div>

                {/* A proposal later than the date the CEO's Office asked for is the
                    case this queue exists to catch, so it is called out rather than
                    left for someone to spot by comparing two dates. */}
                {r.task.expected_date && r.promised_proposed > r.task.expected_date && (
                  <div style={{ marginTop: 10, fontSize: 12.5, fontWeight: 600, color: '#9A5B00',
                    background: '#FFEFD6', padding: '7px 10px', borderRadius: 9 }}>
                    Later than the expected date of {fmtDate(r.task.expected_date)}.
                  </div>
                )}

                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12,
                  paddingTop: 12, borderTop: '1px solid var(--line-soft)', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginRight: 'auto' }}>
                    {waiting > 0 ? `Waiting ${waiting} day${waiting === 1 ? '' : 's'}` : 'Proposed today'}
                  </span>

                  {busyId === r.id ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5,
                      color: 'var(--ink-soft)', fontWeight: 600 }}>
                      <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Saving…
                    </span>
                  ) : isRejecting ? null : (
                    <>
                      <button className="gx-btn gx-btn-line gx-focusable" style={{ color: '#C42424' }}
                        onClick={() => { setRejecting(r.id); setReason(''); setErr(''); }}>
                        <X size={14} /> Reject
                      </button>
                      <button className="gx-btn gx-btn-dark gx-focusable" onClick={() => confirm(r)}>
                        <Check size={15} /> Confirm &amp; lock
                      </button>
                    </>
                  )}
                </div>

                {isRejecting && (
                  <div style={{ marginTop: 12 }}>
                    <label htmlFor={`reason-${r.id}`} className="gx-th"
                      style={{ background: 'transparent', padding: 0, display: 'block', marginBottom: 6 }}>
                      Why is this date not acceptable? <span style={{ color: '#C42424' }}>*</span>
                    </label>
                    <textarea id={`reason-${r.id}`} className="gx-input" rows={2} autoFocus value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="e.g. The board review is on the 15th — we need this before then."
                      style={{ resize: 'vertical', fontFamily: 'var(--font-b)' }} />
                    <div style={{ fontSize: 11, color: 'var(--ink-soft)', margin: '6px 0 10px' }}>
                      This is posted to the task&apos;s comment thread, so {r.stakeholder?.name?.split(' ')[0]} can
                      see it. Comments are permanent and cannot be edited or deleted.
                    </div>
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                      <button className="gx-btn gx-btn-ghost gx-focusable"
                        onClick={() => { setRejecting(null); setReason(''); setErr(''); }}>Cancel</button>
                      <button className="gx-btn gx-btn-dark gx-focusable" disabled={!reason.trim()}
                        style={{ background: '#C42424' }} onClick={() => submitReject(r)}>
                        Reject date
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function friendly(e) {
  const m = String(e?.message || e).toUpperCase();
  if (m.includes('REASON_REQUIRED')) return 'Say why the date was rejected — the stakeholder needs to know what to propose instead.';
  if (m.includes('NOT_PROPOSED')) return 'That proposal has already been decided. Refreshing the queue.';
  if (m.includes('SELF_CREATED')) return 'This task was raised by the stakeholder themselves, so its date is theirs to set.';
  if (m.includes('FORBIDDEN')) return 'You don’t have permission to perform this action.';
  return e?.message || 'Could not save that decision.';
}
