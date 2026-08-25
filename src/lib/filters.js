// Board filtering — pure functions, deliberately kept out of the JSX so they can
// be unit-tested directly.
//
// These filter only rows the SERVER already returned. They are a convenience for
// the person looking at the board, never a security boundary: a stakeholder's
// task list was trimmed by RLS long before it reached this file.
import { daysUntil } from './format.js';

export const isFiltered = (f) =>
  !!(f && (f.stakeholder || f.priority || f.status
    || f.createdFrom || f.createdTo || f.followupsDue || f.dueBucket));

// `created_at` is a timestamptz; the filter inputs are plain dates. Compare on
// the LOCAL calendar date, not the UTC slice — east of Greenwich a task raised
// at 09:00 IST is still "yesterday" in UTC, which would drop it from a range
// that clearly ought to include it.
export function localDateOf(ts) {
  if (!ts) return null;
  const d = new Date(ts);
  if (isNaN(d)) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function applyFilters(cards, f) {
  if (!f) return cards;
  return cards.filter(({ task, a }) => {
    if (f.stakeholder && a.stakeholder_id !== f.stakeholder) return false;
    if (f.priority && task.priority !== f.priority) return false;
    if (f.status && a.status !== f.status) return false;

    // CR-01 #3/#4: manual date range now filters on when the task was raised.
    if (f.createdFrom || f.createdTo) {
      const created = localDateOf(task.created_at);
      if (!created) return false;
      if (f.createdFrom && created < f.createdFrom) return false;
      if (f.createdTo && created > f.createdTo) return false;
    }

    if (f.followupsDue) {
      const d = daysUntil(task.next_followup_date);
      if (d === null || d > 0) return false;
    }

    // Not a user-facing control — this is how the dashboard's Overdue /
    // Due today / Next 7 days tiles drill through. CR-4 leaves those buckets
    // on expected date deliberately.
    if (f.dueBucket) {
      if (a.status === 'done') return false;
      const d = daysUntil(task.expected_date);
      if (d === null) return false;
      if (f.dueBucket === 'overdue' && d >= 0) return false;
      if (f.dueBucket === 'today' && d !== 0) return false;
      if (f.dueBucket === 'next7' && !(d > 0 && d <= 7)) return false;
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
  if (m.includes('SELF_CREATED')) {
    return 'You set the date on a task you raised yourself — edit the task instead.';
  }
  if (m.includes('LOCKED')) {
    return 'This Promised Date has been confirmed and locked. Contact the EA or CEO to change it.';
  }
  return e?.message || 'Could not move the task. Try again.';
}
