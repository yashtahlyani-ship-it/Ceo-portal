import { useState } from 'react';
import { AlertTriangle, Users, ArrowRight, ArrowLeft } from 'lucide-react';
import { metrics, byStakeholder, toCards } from '../lib/derive.js';
import { daysUntil, dueMeta } from '../lib/format.js';
import { EMPTY_FILTERS } from '../lib/rules.js';
import { Metric, Avatar, PriorityBadge, StatusBadge, DueChip, Empty } from '../components/ui.jsx';
import Board from './Board.jsx';

const DASH_TABS = [['overview', 'Overview'], ['people', 'By stakeholder']];

// The executive Overview — "what needs my attention right now?"
//
// Every metric is a link, not a readout: clicking one sets the board filters and
// jumps there, so the number and the work behind it are never more than a click
// apart. This is an operations screen, deliberately not an analytics dashboard.
export default function Dashboard(props) {
  const { tasks, onOpen, setView, setFilters } = props;
  // CR-01 #5: a second way to read the same data — by person rather than by
  // urgency. Local to the dashboard rather than a new nav item, both because
  // the CR asks for "a tab/section" on the dashboard and because an eighth
  // header item would not fit (see the header note in lib/styles.js).
  const [tab, setTab] = useState('overview');
  const [who, setWho] = useState(null);

  const m = metrics(tasks);
  const rows = byStakeholder(tasks);

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
      <p style={{ color: 'var(--ink-soft)', marginTop: 0, marginBottom: 14, fontSize: 13.5 }}>
        What requires executive attention right now.
      </p>

      <div role="tablist" aria-label="Dashboard views"
        style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--line)', marginBottom: 20 }}>
        {/* Roving focus with arrow keys, matching the task drawer's tabs — one
            tab stop for the set, then left/right to move between them. */}
        {DASH_TABS.map(([k, label], i) => (
          <button key={k} role="tab" id={`dashtab-${k}`} aria-selected={tab === k}
            aria-controls={`dashpanel-${k}`} tabIndex={tab === k ? 0 : -1}
            className={`gx-tab gx-focusable${tab === k ? ' on' : ''}`}
            style={{ background: 'none', border: 'none', borderBottom: '2px solid transparent' }}
            onClick={() => { setTab(k); setWho(null); }}
            onKeyDown={(e) => {
              if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
              e.preventDefault();
              const n = (i + (e.key === 'ArrowRight' ? 1 : DASH_TABS.length - 1)) % DASH_TABS.length;
              setTab(DASH_TABS[n][0]); setWho(null);
              document.getElementById(`dashtab-${DASH_TABS[n][0]}`)?.focus();
            }}>{label}</button>
        ))}
      </div>

      <div role="tabpanel" id={`dashpanel-${tab}`} aria-labelledby={`dashtab-${tab}`}>
        {tab === 'people'
          ? <StakeholderView {...props} rows={rows} who={who} setWho={setWho} />
          : <Overview {...{ m, rows, drill, attention, onOpen, setView }} />}
      </div>
    </div>
  );
}

/* ── The urgency-first overview ── */
function Overview({ m, rows, drill, attention, onOpen, setView }) {
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 22 }}>
        <Metric n={m.overdue} label="Overdue" tone="overdue"
          onClick={() => drill({ dueBucket: 'overdue' })} />
        <Metric n={m.today} label="Due today" tone="today"
          onClick={() => drill({ dueBucket: 'today' })} />
        <Metric n={m.next7} label="Next 7 days" tone="soon"
          onClick={() => drill({ dueBucket: 'next7' })} />
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

/* ── CR-01 #5: browse by stakeholder ──────────────────────────────────────────
   Pick a person, see their whole board in one place — including tasks they
   raised themselves. This is the same Board component the Kanban view uses,
   pre-filtered to that stakeholder, so the cards, controls and audit behaviour
   are identical rather than a second implementation that can drift. */
function StakeholderView({ rows, who, setWho, ...boardProps }) {
  if (who) {
    const person = rows.find((r) => r.stakeholder.id === who)?.stakeholder;
    return (
      <div className="gx-fade">
        <button className="gx-btn gx-btn-ghost gx-focusable" style={{ marginBottom: 14 }}
          onClick={() => setWho(null)}>
          <ArrowLeft size={14} /> All stakeholders
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 16 }}>
          <Avatar name={person?.name} color={person?.color} size={38} />
          <div>
            <div className="gx-disp" style={{ fontSize: 18, fontWeight: 700 }}>{person?.name}</div>
            <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{person?.title || 'Stakeholder'}</div>
          </div>
        </div>
        {/* setFilters is a no-op here: the stakeholder is fixed by the person
            you picked, so the board's own stakeholder control would fight it. */}
        <Board {...boardProps} filters={{ ...EMPTY_FILTERS, stakeholder: who }} setFilters={() => {}} />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="gx-card">
        <Empty icon={Users} title="No stakeholders yet"
          hint="Add stakeholders to start assigning work." />
      </div>
    );
  }

  return (
    <div className="gx-stagger" style={{ display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
      {rows.map((r) => (
        <button key={r.stakeholder.id} className="gx-kcard gx-focusable"
          onClick={() => setWho(r.stakeholder.id)}
          aria-label={`Open ${r.stakeholder.name}'s board`}
          style={{ textAlign: 'left', border: '1px solid var(--line)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 11 }}>
            <Avatar name={r.stakeholder.name} color={r.stakeholder.color} size={32} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 13.5, whiteSpace: 'nowrap',
                overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.stakeholder.name}</div>
              <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>{r.stakeholder.title || 'Stakeholder'}</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <Pill n={r.activeN} label="active" />
            {r.overdue > 0 && <Pill n={r.overdue} label="overdue" tone="overdue" />}
            {r.reopened > 0 && <Pill n={r.reopened} label="reopened" tone="warn" />}
            {r.done > 0 && <Pill n={r.done} label="done" />}
          </div>
        </button>
      ))}
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
