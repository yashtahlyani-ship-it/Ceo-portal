import { metrics } from '../lib/derive.js';
import { Metric } from '../components/ui.jsx';
import Board from './Board.jsx';

// The stakeholder dashboard — deliberately simple: my numbers, then my board.
// RLS guarantees `tasks` already contains only this stakeholder's assignments.
export default function StakeholderHome(props) {
  const { tasks, me } = props;
  const m = metrics(tasks);
  return (
    <div className="gx-fade">
      <h1 className="gx-disp" style={{ fontSize: 24, fontWeight: 800, margin: '0 0 3px' }}>My Tasks</h1>
      <p style={{ color: 'var(--ink-soft)', marginTop: 0, marginBottom: 20, fontSize: 13.5 }}>
        Welcome back, {me.name.split(' ')[0]}. Here's what you're responsible for.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24, maxWidth: 640 }}>
        <Metric n={m.overdue} label="Overdue" tone="overdue" />
        <Metric n={m.today} label="Due today" tone="today" />
        <Metric n={m.next7} label="Next 7 days" tone="soon" />
        <Metric n={m.done} label="Completed" tone="done" />
      </div>
      <Board {...props} />
    </div>
  );
}
