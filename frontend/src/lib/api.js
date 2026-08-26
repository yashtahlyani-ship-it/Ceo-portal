// Thin client over the CEO Office API (backend/). Every controlled mutation
// hits a route that calls a SECURITY DEFINER function whose rule is enforced in
// Postgres; reads rely on Row-Level Security to return only what the caller may
// see. The client mirrors rules for UX (disabling buttons) but is never the
// authority — see lib/rules.js.
//
// ── Migration note ───────────────────────────────────────────────────────────
// This file used to talk to Supabase directly via PostgREST. The response
// SHAPES below are unchanged on purpose — the backend builds the same nested
// JSON that PostgREST's embeds produced — so the views and components needed no
// changes when the data layer moved to RDS.
//
// One whole class of bug went away with PostgREST: three tables have two
// foreign keys into `profiles` (task_assignments, tasks, notifications), and an
// unqualified embed on any of them was ambiguous and rejected. That cost real
// time three separate times, once silently, because a bare `.catch(() => {})`
// on the notification poll turned the third instance into "no notifications
// yet". The backend now names those joins in SQL, where the choice is explicit
// and cannot be ambiguous.

import { get, post, patch, del, request } from './http.js';

// Kept in step with the limit the backend and the S3 upload path enforce.
// Checked here only so somebody gets a clear message before a 10 MB file
// travels the wire; the server enforces it regardless.
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const ACCEPTED_TYPES = '.pdf,.docx,.xlsx,.doc,.xls,.png,.jpg,.jpeg';

export const api = {
  // ── reads ──────────────────────────────────────────────────────────────────
  me:           ()  => get('/api/me'),
  profiles:     ()  => get('/api/profiles'),
  stakeholders: ()  => get('/api/stakeholders'),

  // Tasks with their assignments joined. RLS trims the assignments array to
  // what the caller may see, so a stakeholder receives only their own rows —
  // and the comment/attachment counts ride the same RLS, so a card can show
  // "3 comments" without leaking that a co-assignee wrote twelve.
  tasks: ({ includeArchived = false } = {}) =>
    get(`/api/tasks${includeArchived ? '?includeArchived=true' : ''}`),

  archivedTasks: ()             => get('/api/tasks/archived'),
  comments:      (assignmentId) => get(`/api/assignments/${assignmentId}/comments`),
  audit:         (taskId)       => get(`/api/tasks/${taskId}/audit`),
  attachments:   (taskId)       => get(`/api/tasks/${taskId}/attachments`),

  // CR-02 #3: the Proposed Date queue — every assignment awaiting an executive
  // decision, oldest first.
  proposedDates: () => get('/api/proposed-dates'),

  // ── CR-02 #5: notifications (promised-date workflow only) ──────────────────
  notifications:        ({ limit = 30 } = {}) => get(`/api/notifications?limit=${limit}`),
  markNotificationsRead: (ids)                => post('/api/notifications/read', { ids: ids ?? null }),

  // ── attachments ────────────────────────────────────────────────────────────
  async uploadAttachment(taskId, file) {
    if (file.size > MAX_ATTACHMENT_BYTES) {
      throw new Error(`${file.name} is larger than ${MAX_ATTACHMENT_BYTES / 1048576} MB.`);
    }
    const form = new FormData();
    form.append('file', file);
    // No Content-Type header: the browser must set the multipart boundary
    // itself, and http.js leaves FormData bodies alone for exactly this reason.
    return request(`/api/tasks/${taskId}/attachments`, { method: 'POST', body: form });
  },

  // A short-lived (60s) presigned URL. The bucket is private, so this is the
  // only way to read an attachment — and the server re-checks, through RLS,
  // that the caller can see the task before minting one.
  async attachmentUrl(attachmentId) {
    const { url } = await get(`/api/attachments/${attachmentId}/url`);
    return url;
  },

  deleteAttachment: (row) => del(`/api/attachments/${row.id}`),

  // ── mutations ──────────────────────────────────────────────────────────────
  createTask: (t) => post('/api/tasks', {
    title: t.title,
    description: t.description || '',
    priority: t.priority || 'medium',
    expected_date: t.expected_date || null,
    next_followup_date: t.next_followup_date || null,
    stakeholders: t.stakeholders || [],
  }),

  // CR-01 #6. A separate, narrower endpoint on purpose: it takes no assignee
  // list, so a stakeholder can never route a self-raised task to somebody else.
  createSelfTask: (t) => post('/api/tasks/self', {
    title: t.title,
    description: t.description || '',
    priority: t.priority || 'medium',
    expected_date: t.expected_date || null,
  }),
  updateSelfTask: (taskId, t) => patch(`/api/tasks/self/${taskId}`, {
    title: t.title,
    description: t.description || '',
    priority: t.priority || 'medium',
    expected_date: t.expected_date || null,
  }),
  // "Withdraw" archives — reversible, and the default action in the UI.
  archiveSelfTask: (taskId) => post(`/api/tasks/self/${taskId}/archive`),

  // ── Permanent delete (CR-01 #6) ────────────────────────────────────────────
  // Irreversible. The server records a `task_deleted` audit event before
  // removing the row, so the history survives, then clears the orphaned S3
  // objects. That cleanup used to happen here, in the browser; it belongs on
  // the server, which is the only side that can be trusted to do it and the
  // only side that still has credentials for the bucket.
  deleteTask:     (taskId) => del(`/api/tasks/${taskId}`),
  deleteSelfTask: (taskId) => del(`/api/tasks/self/${taskId}`),

  advanceStatus:   (assignmentId, target) => post(`/api/assignments/${assignmentId}/status`, { status: target }),
  proposePromised: (assignmentId, date)   => post(`/api/assignments/${assignmentId}/promise`, { date }),
  confirmPromised: (assignmentId)         => post(`/api/assignments/${assignmentId}/promise/confirm`),
  // CR-02 #4: the reason is mandatory server-side, not merely a required input.
  rejectPromised:  (assignmentId, reason) => post(`/api/assignments/${assignmentId}/promise/reject`, { reason }),
  reopen:          (assignmentId)         => post(`/api/assignments/${assignmentId}/reopen`),
  addComment:      (assignmentId, body)   => post(`/api/assignments/${assignmentId}/comments`, { body }),

  addStakeholder:    (taskId, stakeholderId) => post(`/api/tasks/${taskId}/stakeholders`, { stakeholder_id: stakeholderId }),
  removeStakeholder: (assignmentId)          => del(`/api/assignments/${assignmentId}`),

  archiveTask: (taskId) => post(`/api/tasks/${taskId}/archive`),
  restoreTask: (taskId) => post(`/api/tasks/${taskId}/restore`),

  // Executive-only direct field edits (RLS-gated, audited by trigger).
  updateTask: (taskId, fields) => patch(`/api/tasks/${taskId}`, fields),

  // CR-02 #6: invite a stakeholder. Replaces the Supabase Edge Function.
  createStakeholder: ({ name, email, title }) =>
    post('/api/admin/stakeholders', { name, email, title }),

  setProfileActive: (profileId, active) => patch(`/api/profiles/${profileId}`, { active }),
};
