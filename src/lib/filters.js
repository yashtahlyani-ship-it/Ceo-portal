// Board filtering — pure functions, deliberately kept out of the JSX so they can
// be unit-tested directly and reused by Saved Views.
//
// These filter only rows the SERVER already returned. They are a convenience for
// the person looking at the board, never a security boundary: a stakeholder's
// task list was trimmed by RLS long before it reached this file.
import { daysUntil } from './format.js';

export const isFiltered = (f) =>
  !!(f && (f.stakeholder || f.priority || f.status || f.from || f.to || f.followupsDue));

export function applyFilters(cards, f) {
  if (!f) return cards;
  return cards.filter(({ task, a }) => {
    if (f.stakeholder && a.stakeholder_id !== f.stakeholder) return false;
    if (f.priority && task.priority !== f.priority) return false;
    if (f.status && a.status !== f.status) return false;
    // A task with no expected date is excluded by any date bound, rather than
    // silently passing through a "due between" filter.
    if (f.from && (!task.expected_date || task.expected_date < f.from)) return false;
    if (f.to && (!task.expected_date || task.expected_date > f.to)) return false;
    if (f.followupsDue) {
      const d = daysUntil(task.next_followup_date);
      if (d === null || d > 0) return false;
    }
    return true;
  });
}

/* The server speaks in error codes; the person needs a sentence. */
export function friendlyMoveError(e) {
  const m = (e?.message || '').toUpperCase();
  if (m.includes('INVALID_TRANSITION')) {
    return 'This task cannot be moved there directly. Complete the workflow step by step.';
  }
  if (m.includes('FORBIDDEN')) return 'You don’t have permission to perform this action.';
  if (m.includes('LOCKED')) {
    return 'This Promised Date has been confirmed and locked. Contact the EA or CEO to change it.';
  }
  return e?.message || 'Could not move the task. Try again.';
}
