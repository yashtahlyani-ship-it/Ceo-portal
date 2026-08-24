// Client mirror of the server rules (02_functions.sql). For UX ONLY — to show
// the right buttons and next-step. The server re-checks every one of these; if
// this file and the server ever disagree, the server wins and the user sees a
// clear error. Keep in sync with _is_forward / the RPC guards by hand.
import { isExecutiveRole } from './format.js';

// The single forward step a stakeholder may take from each status.
export const FORWARD_NEXT = {
  todo: 'in_progress',
  in_progress: 'under_review',
  under_review: 'done',
  reopened: 'in_progress',
  done: null,
};

export const KANBAN_COLUMNS = ['todo', 'in_progress', 'under_review', 'done'];

// A board filter set. `null` on a list filter means "no restriction". Lives here
// rather than in App.jsx so Board can import it without a circular reference.
//
// CR-01 #3/#4: the manual date-range control filters on CREATED date, not
// expected date. `dueBucket` is deliberately NOT a user-facing control — it is
// how the dashboard's Overdue / Due today / Next 7 days tiles drill through to
// the board. CR-4 changes the manual filter only; those buckets keep working
// off expected date exactly as before.
export const EMPTY_FILTERS = {
  stakeholder: null, priority: null, status: null,
  createdFrom: '', createdTo: '',
  followupsDue: false, dueBucket: null,
};

// What status may this user move this assignment to (for rendering controls)?
export function allowedTargets(role, assignment) {
  if (isExecutiveRole(role)) {
    // Executive override: any status → any other status.
    return ['todo', 'in_progress', 'under_review', 'done', 'reopened'].filter((s) => s !== assignment.status);
  }
  const next = FORWARD_NEXT[assignment.status];
  return next ? [next] : [];
}

export const canReopen = (role, assignment) => isExecutiveRole(role) && assignment.status === 'done';

// CR-01 #6: a task the stakeholder raised for themselves has no propose →
// confirm handshake. The date they set is final, so neither end of that flow
// applies. Mirrors the SELF_CREATED guards in supabase/05_cr01.sql.
export const isSelfCreated = (task) => task?.creator?.role === 'stakeholder';

export const canConfirmPromised = (role, assignment, task) =>
  isExecutiveRole(role) && assignment.promised_state === 'proposed' && !isSelfCreated(task);
export const canProposePromised = (role, assignment, isOwner, task) =>
  !isExecutiveRole(role) && isOwner && assignment.promised_state !== 'confirmed' && !isSelfCreated(task);

export const canEditTask = (role) => isExecutiveRole(role);
export const canArchive = (role) => isExecutiveRole(role);
export const canViewAudit = (role) => isExecutiveRole(role);

// CR-01 #6: everyone can now raise a task. Executives assign to others;
// a stakeholder may only raise one for themselves.
export const canCreateTask = () => true;
export const createsForSelfOnly = (role) => !isExecutiveRole(role);

// CR-01 #6: the creator of a self-created task may edit or withdraw that task —
// and only that task. A task assigned to them by the CEO's Office stays
// read-only, exactly as before.
export const canEditOwnTask = (role, task, meId) =>
  !isExecutiveRole(role) && isSelfCreated(task) && task?.created_by === meId;

// Overall task completion = every assignment is done.
export const isTaskComplete = (task) =>
  (task.assignments?.length ?? 0) > 0 && task.assignments.every((a) => a.status === 'done');
