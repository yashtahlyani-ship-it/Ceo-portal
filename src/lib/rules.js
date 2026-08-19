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
export const EMPTY_FILTERS = {
  stakeholder: null, priority: null, status: null, from: '', to: '', followupsDue: false,
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
export const canConfirmPromised = (role, assignment) => isExecutiveRole(role) && assignment.promised_state === 'proposed';
export const canProposePromised = (role, assignment, isOwner) =>
  !isExecutiveRole(role) && isOwner && assignment.promised_state !== 'confirmed';
export const canEditTask = (role) => isExecutiveRole(role);
export const canCreateTask = (role) => isExecutiveRole(role);
export const canArchive = (role) => isExecutiveRole(role);
export const canViewAudit = (role) => isExecutiveRole(role);

// Overall task completion = every assignment is done.
export const isTaskComplete = (task) =>
  (task.assignments?.length ?? 0) > 0 && task.assignments.every((a) => a.status === 'done');
