// Pure helpers that turn the task list into the numbers the dashboards show.
import { daysUntil } from './format.js';

// Flatten tasks → one card per (visible) assignment. RLS already trimmed the
// assignments a stakeholder receives to their own, so this is correct for both
// roles without extra checks.
export function toCards(tasks) {
  const cards = [];
  for (const t of tasks || []) {
    for (const a of t.assignments || []) cards.push({ task: t, a });
  }
  return cards;
}

const active = (a) => a.status !== 'done';

export function metrics(tasks) {
  const cards = toCards(tasks);
  let overdue = 0, today = 0, next7 = 0, followups = 0, reopened = 0, done = 0;
  for (const { task, a } of cards) {
    if (a.status === 'done') { done++; continue; }
    if (a.status === 'reopened') reopened++;
    const d = daysUntil(task.expected_date);
    if (d !== null && active(a)) {
      if (d < 0) overdue++;
      else if (d === 0) today++;
      else if (d <= 7) next7++;
    }
  }
  // Follow-ups are a task-level date; count tasks whose follow-up is due (<= today)
  for (const t of tasks || []) {
    const d = daysUntil(t.next_followup_date);
    if (d !== null && d <= 0) followups++;
  }
  return { overdue, today, next7, followups, reopened, done, total: cards.length };
}

// Per-stakeholder rollup for the executive "Stakeholder Overview".
export function byStakeholder(tasks) {
  const map = new Map();
  for (const { task, a } of toCards(tasks)) {
    const s = a.stakeholder;
    if (!s) continue;
    if (!map.has(s.id)) map.set(s.id, { stakeholder: s, activeN: 0, overdue: 0, reopened: 0, done: 0 });
    const row = map.get(s.id);
    if (a.status === 'done') row.done++;
    else {
      row.activeN++;
      if (a.status === 'reopened') row.reopened++;
      const d = daysUntil(task.expected_date);
      if (d !== null && d < 0) row.overdue++;
    }
  }
  return [...map.values()].sort((x, y) => y.overdue - x.overdue || y.activeN - x.activeN);
}
