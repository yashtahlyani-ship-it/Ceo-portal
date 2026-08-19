import { AlertTriangle, Users, ArrowRight } from 'lucide-react';
import { metrics, byStakeholder, toCards } from '../lib/derive.js';
import { daysUntil, dueMeta } from '../lib/format.js';
import { EMPTY_FILTERS } from '../lib/rules.js';
import { Metric, Avatar, PriorityBadge, StatusBadge, DueChip, Empty } from '../components/ui.jsx';

// The executive Overview — "what needs my attention right now?"
//
// Every metric is a link, not a readout: clicking one sets the board filters and
// jumps there, so the number and the work behind it are never more than a click
// apart. This is an operations screen, deliberately not an analytics dashboard.
export default function Dashboard({ tasks, onOpen, setView, setFilters }) {
  const m = metrics(tasks);
  const rows = byStakeholder(tasks);

  const today = localISO(0);

  // Focus the board on a slice and navigate to it.
  const drill = (patch) => { setFilters({ ...EMPTY_FILTERS, ...patch }); setView('board'); };

  // Priority attention: active work that is overdue, due today, high priority
  // or reopened — soonest first, so the top of the list is the most urgent.
  const attention = toCards(tasks)
    .filter(({ task, a }) => {
      if (a.status === 'done') return false;
      const d = daysUntil(task.expected_date);
      return a.status === 'reopened' || task.priority === 'high' || (d !== null && d <= 0);
    })
    .sort((x, y) => (daysUntil(x.task.expected_date) ?? 1e9) - (daysUntil(y.task.expected_date) ?? 1e9))
    .slice(0, 12);

  return (
    <div className="gx-fade">
      <h1 className="gx-disp" style={{ fontSize: 24, fontWeight: 800, margin: '0 0 3px' }}>Overview</h1>
      <p style={{ color: 'var(--ink-soft)', marginTop: 0, marginBottom: 20, fontSize: 13.5 }}>
        What requires executive attention right now.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 22 }}>
        <Metric n={m.overdue} label="Overdue" tone="overdue"
          onClick={() => drill({ to: localISO(-1) })} />
        <Metric n={m.today} label="Due today" tone="today"
          onClick={() => drill({ from: today, to: today })} />
        <Metric n={m.next7} label="Next 7 days" tone="soon"
          onClick={() => drill({ from: today, to: localISO(7) })} />
        <Metric n={m.followups} label="Follow-ups due"
          onClick={() => drill({ followupsDue: true })} />
        <Metric n={m.reopened} label="Re-opened" tone="overdue"
          onClick={() => setView('reopened')} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 18, alignItems: 'start' }}>
        {/* Priority attention */}
        <section className="gx-card" style={{ padding: 0, overflow: 'hidden' }}>
          <SectionHead icon={AlertTriangle} title="Priority attention"
            action={attention.length > 0 && (
              <button className="gx-btn gx-btn-ghost gx-focusable" style={{ fontSize: 12 }}
                onClick={() => drill({})}>Open board <ArrowRight size={13} /></button>
            )} />
          {attention.length === 0 ? (
            <Empty title="Everything is on track"
              hint="Nothing overdue, high-priority or reopened needs attention." />
          ) : attention.map(({ task, a }) => (
            <button key={a.id} className="gx-row gx-focusable" onClick={() => onOpen(task.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left',
                padding: '11px 16px', borderTop: '1px solid var(--line-soft)',
                background: 'transparent', border: 'none', cursor: 'pointer' }}>
              <PriorityBadge value={task.priority} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {task.title}
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 2 }}>{a.stakeholder?.name}</div>
              </div>
              <StatusBadge value={a.status} short />
              <DueChip meta={dueMeta(task.expected_date)} />
            </button>
          ))}
        </section>

        {/* Stakeholder overview */}
        <section className="gx-card" style={{ padding: 0, overflow: 'hidden' }}>
          <SectionHead icon={Users} title="Stakeholder overview" />
          {rows.length === 0 ? (
            <Empty title="No stakeholders yet" hint="Add stakeholders to start assigning work." />
          ) : rows.map((r) => (
            <button key={r.stakeholder.id} className="gx-row gx-focusable"
              onClick={() => drill({ stakeholder: r.stakeholder.id })}
              title={`Show ${r.stakeholder.name}'s board`}
              style={{ display: 'flex', alignItems: 'center', gap: 11, width: '100%', textAlign: 'left',
                padding: '10px 16px', borderTop: '1px solid var(--line-soft)',
                background: 'transparent', border: 'none', cursor: 'pointer' }}>
              <Avatar name={r.stakeholder.name} color={r.stakeholder.color} size={28} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{r.stakeholder.name}</div>
                <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>{r.stakeholder.title || 'Stakeholder'}</div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <Pill n={r.activeN} label="active" />
                {r.overdue > 0 && <Pill n={r.overdue} label="overdue" tone="overdue" />}
                {r.reopened > 0 && <Pill n={r.reopened} label="reopened" tone="warn" />}
              </div>
            </button>
          ))}
        </section>
      </div>
    </div>
  );
}

const SectionHead = ({ icon: Icon, title, action }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 16px', fontWeight: 700, fontSize: 13.5 }}>
    <Icon size={16} style={{ color: 'var(--ink-soft)' }} aria-hidden="true" /> {title}
    <span style={{ marginLeft: 'auto' }}>{action}</span>
  </div>
);

function Pill({ n, label, tone }) {
  const c = tone === 'overdue' ? { bg: '#FDE2E2', fg: '#C42424' }
    : tone === 'warn' ? { bg: '#FBE0EC', fg: '#B01457' }
      : { bg: '#EEF4EF', fg: '#586860' };
  return (
    <span className="gx-chip" style={{ background: c.bg, color: c.fg, cursor: 'inherit' }}>
      <b className="gx-mono">{n}</b> {label}
    </span>
  );
}

// Local calendar date, not toISOString() — see the note in lib/format.js. Using
// UTC here would make "due today" resolve to yesterday for most of an IST day.
function localISO(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
