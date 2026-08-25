import { CalendarClock } from 'lucide-react';
import { daysUntil, fmtDate } from '../lib/format.js';
import { Avatar, PriorityBadge, DueChip, Empty } from '../components/ui.jsx';
import { dueMeta } from '../lib/format.js';

/* Executive-only. Every task carrying a Next Follow-up date, split into what is
   due now (today or overdue) and what is coming up — so the EA can work the
   follow-up list top to bottom without hunting across the board. */
export default function Followups({ tasks, onOpen }) {
  const rows = (tasks || [])
    .filter((t) => t.next_followup_date)
    .map((t) => ({ t, d: daysUntil(t.next_followup_date) }))
    .sort((a, b) => a.d - b.d);

  const dueNow = rows.filter((x) => x.d <= 0);
  const upcoming = rows.filter((x) => x.d > 0 && x.d <= 14);

  return (
    <div className="gx-fade">
      <h1 className="gx-disp" style={{ fontSize: 24, fontWeight: 800, margin: '0 0 3px' }}>Follow-ups</h1>
      <p style={{ color: 'var(--ink-soft)', marginTop: 0, marginBottom: 20, fontSize: 13.5 }}>
        Tasks the CEO's Office has flagged to chase, soonest first.
      </p>

      {rows.length === 0 ? (
        <div className="gx-card">
          <Empty icon={CalendarClock} title="No follow-ups scheduled"
            hint="Set a Next Follow-up date on a task and it will appear here." />
        </div>
      ) : (
        <>
          <Group title="Due now" caption="Today or overdue" rows={dueNow} onOpen={onOpen}
            emptyHint="Nothing needs chasing today." />
          <Group title="Upcoming" caption="Next 14 days" rows={upcoming} onOpen={onOpen}
            emptyHint="No follow-ups coming up." />
        </>
      )}
    </div>
  );
}

function Group({ title, caption, rows, onOpen, emptyHint }) {
  return (
    <section className="gx-card" style={{ padding: 0, overflow: 'hidden', marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, padding: '13px 16px' }}>
        <span style={{ fontWeight: 700, fontSize: 13.5 }}>{title}</span>
        <span style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>{caption}</span>
        <span className="gx-mono" style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--ink-soft)' }}>{rows.length}</span>
      </div>
      {rows.length === 0 ? (
        <div style={{ padding: '2px 16px 16px', fontSize: 12.5, color: 'var(--ink-soft)' }}>{emptyHint}</div>
      ) : rows.map(({ t }) => (
        <button key={t.id} className="gx-row gx-focusable" onClick={() => onOpen(t.id)}
          style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left',
            padding: '11px 16px', borderTop: '1px solid var(--line-soft)', background: 'transparent', border: 'none', cursor: 'pointer' }}>
          <PriorityBadge value={t.priority} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.title}</div>
            <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 2 }}>Follow-up {fmtDate(t.next_followup_date)}</div>
          </div>
          <div style={{ display: 'flex', marginRight: 4 }}>
            {(t.assignments || []).slice(0, 4).map((a, i) => (
              <span key={a.id} style={{ marginLeft: i ? -7 : 0, border: '2px solid var(--surface)', borderRadius: 999 }}>
                <Avatar name={a.stakeholder?.name} color={a.stakeholder?.color} size={22} />
              </span>
            ))}
          </div>
          <DueChip meta={dueMeta(t.next_followup_date)} />
        </button>
      ))}
    </section>
  );
}
