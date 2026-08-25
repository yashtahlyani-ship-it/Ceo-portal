import { RotateCcw } from 'lucide-react';
import { toCards } from '../lib/derive.js';
import { dueMeta } from '../lib/format.js';
import { Avatar, PriorityBadge, DueChip, Empty } from '../components/ui.jsx';

// Executive view: all reopened assignments, grouped by stakeholder, so rework is
// immediately visible.
export default function Reopened({ tasks, onOpen }) {
  const reopened = toCards(tasks).filter((c) => c.a.status === 'reopened');
  const groups = new Map();
  for (const c of reopened) {
    const k = c.a.stakeholder?.id || '—';
    if (!groups.has(k)) groups.set(k, { stakeholder: c.a.stakeholder, items: [] });
    groups.get(k).items.push(c);
  }

  return (
    <div className="gx-fade">
      <h1 className="gx-disp" style={{ fontSize: 24, fontWeight: 800, margin: '0 0 3px' }}>Re-opened Tasks</h1>
      <p style={{ color: 'var(--ink-soft)', marginTop: 0, marginBottom: 20, fontSize: 13.5 }}>Completed work sent back for rework, grouped by stakeholder.</p>
      {groups.size === 0
        ? <Empty icon={RotateCcw} title="No reopened tasks" hint="When you reopen a completed task, it will show here until it's done again." />
        : [...groups.values()].map((g) => (
          <section key={g.stakeholder?.id} className="gx-card" style={{ padding: 0, overflow: 'hidden', marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px' }}>
              <Avatar name={g.stakeholder?.name} color={g.stakeholder?.color} size={26} />
              <div style={{ fontWeight: 700, fontSize: 13.5 }}>{g.stakeholder?.name}</div>
              <span className="gx-mono" style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--ink-soft)' }}>{g.items.length} reopened</span>
            </div>
            {g.items.map(({ task }) => (
              <button key={task.id} className="gx-row gx-focusable" onClick={() => onOpen(task.id)}
                style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left',
                  padding: '11px 16px', borderTop: '1px solid var(--line-soft)', background: 'transparent', border: 'none', cursor: 'pointer' }}>
                <PriorityBadge value={task.priority} />
                <div style={{ flex: 1, fontWeight: 700, fontSize: 13 }}>{task.title}</div>
                <DueChip meta={dueMeta(task.expected_date)} />
              </button>
            ))}
          </section>
        ))}
    </div>
  );
}
