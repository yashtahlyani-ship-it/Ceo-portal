// Thin client over Supabase. Every controlled mutation calls an RPC whose rule
// is enforced server-side (02_functions.sql); reads rely on RLS to return only
// what the caller may see. The client mirrors rules for UX (disabling buttons)
// but is never the authority — see lib/rules.js.
import { supabase } from './supabase.js';

const BUCKET = 'task-attachments';

// task_assignments has TWO foreign keys into profiles — stakeholder_id and
// promised_confirmed_by — so an unqualified `profiles(...)` embed is ambiguous
// and PostgREST refuses it. Name the constraint to pick the assignee.
const FK_STAKEHOLDER = 'task_assignments_stakeholder_id_fkey';
// tasks likewise has two (created_by, archived_by). The creator's role is what
// makes a task "self-created" (CR-01 #6), so it is embedded on every read.
const FK_CREATOR = 'tasks_created_by_fkey';
// notifications is the third table with two FKs into profiles (recipient_id,
// actor_id). Same rule: name the constraint or PostgREST refuses the embed.
const FK_NOTIF_ACTOR = 'notifications_actor_id_fkey';
// Kept in step with the bucket's own file_size_limit (supabase/04_storage.sql).
// Checked here only so the person gets a clear message before a 10 MB upload
// travels the wire; the bucket enforces it regardless.
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const ACCEPTED_TYPES = '.pdf,.docx,.xlsx,.doc,.xls,.png,.jpg,.jpeg';

// Best-effort bucket cleanup after a task row is destroyed. Deliberately does
// not throw: the delete already succeeded server-side, and an object with no
// surviving task is unreachable regardless.
async function removeOrphanedObjects(paths) {
  if (!paths?.length) return;
  try { await supabase.storage.from(BUCKET).remove(paths); }
  catch (e) { console.warn('[api] could not remove orphaned attachments:', e.message); }
}

const rpc = async (fn, args) => {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data;
};

// PostgREST returns an aggregate embed as [{ count: n }] (or [] when zero).
// Flatten those to plain numbers so components never handle the array shape.
const countOf = (v) => (Array.isArray(v) ? (v[0]?.count ?? 0) : (v?.count ?? 0));

function normalizeCounts(task) {
  return {
    ...task,
    attachment_count: countOf(task.attachments),
    assignments: (task.assignments || []).map((a) => ({
      ...a,
      comment_count: countOf(a.comments),
    })),
  };
}

export const api = {
  // ── reads ──────────────────────────────────────────────────────────────────
  async me() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data } = await supabase.from('profiles').select('*').eq('id', user.id).single();
    return data;
  },
  async profiles() {
    const { data, error } = await supabase.from('profiles').select('*').order('name');
    if (error) throw error; return data || [];
  },
  async stakeholders() {
    const { data, error } = await supabase.from('profiles').select('*').eq('role', 'stakeholder').eq('active', true).order('name');
    if (error) throw error; return data || [];
  },
  // Tasks with their assignments joined. RLS trims assignments to what the
  // caller may see, so a stakeholder receives only their own assignment rows.
  //
  // The two `(count)` aggregates ride the same RLS as the rows they count, so a
  // stakeholder's comment count reflects only their own thread — the card can
  // show "3 comments" without leaking that another assignee wrote twelve.
  async tasks({ includeArchived = false } = {}) {
    let q = supabase
      .from('tasks')
      .select(`*,
        creator:profiles!${FK_CREATOR}(id,name,role),
        attachments:task_attachments(count),
        assignments:task_assignments(*,
          stakeholder:profiles!${FK_STAKEHOLDER}(id,name,title,color),
          comments:task_comments(count))`)
      .order('created_at', { ascending: false });
    if (!includeArchived) q = q.eq('archived', false);
    const { data, error } = await q;
    if (error) throw error;
    return (data || []).map(normalizeCounts);
  },
  async archivedTasks() {
    const { data, error } = await supabase
      .from('tasks').select(`*, assignments:task_assignments(*, stakeholder:profiles!${FK_STAKEHOLDER}(id,name))`)
      .eq('archived', true).order('archived_at', { ascending: false });
    if (error) throw error; return data || [];
  },
  async comments(assignmentId) {
    const { data, error } = await supabase
      .from('task_comments').select('*, author:profiles(id,name)')
      .eq('assignment_id', assignmentId).order('created_at');
    if (error) throw error; return data || [];
  },
  async audit(taskId) {
    const { data, error } = await supabase
      .from('audit_log').select('*, actor:profiles(id,name)')
      .eq('task_id', taskId).order('created_at', { ascending: false });
    if (error) throw error; return data || [];
  },
  async attachments(taskId) {
    const { data, error } = await supabase
      .from('task_attachments').select('*, uploader:profiles(id,name)')
      .eq('task_id', taskId).order('created_at');
    if (error) throw error; return data || [];
  },

  // Upload bytes to the PRIVATE bucket, then record the metadata row. The path
  // shape 'task/<id>/…' is what the storage policies parse to decide who may
  // read the object — see supabase/04_storage.sql. If the metadata insert fails
  // the orphaned object is removed so the bucket cannot drift from the table.
  async uploadAttachment(taskId, file) {
    if (file.size > MAX_ATTACHMENT_BYTES) {
      throw new Error(`${file.name} is larger than ${MAX_ATTACHMENT_BYTES / 1048576} MB.`);
    }
    const safe = file.name.replace(/[^\w.-]+/g, '_');
    const path = `task/${taskId}/${crypto.randomUUID()}-${safe}`;

    const { error: upErr } = await supabase.storage
      .from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
    if (upErr) throw upErr;

    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase.from('task_attachments').insert({
      task_id: taskId, storage_path: path, file_name: file.name,
      mime_type: file.type || null, size_bytes: file.size, uploaded_by: user.id,
    }).select('*, uploader:profiles(id,name)').single();

    if (error) {
      await supabase.storage.from(BUCKET).remove([path]);
      throw error;
    }
    return data;
  },

  // A short-lived signed URL. The bucket is private, so this is the only way to
  // read an attachment, and minting one requires passing the storage RLS policy.
  async attachmentUrl(storagePath) {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, 60);
    if (error) throw error;
    return data.signedUrl;
  },

  async deleteAttachment(row) {
    const { error } = await supabase.from('task_attachments').delete().eq('id', row.id);
    if (error) throw error;
    await supabase.storage.from(BUCKET).remove([row.storage_path]);
  },
  // CR-02 #3: the Proposed Date queue — every assignment awaiting an executive
  // decision. RLS still applies, but only executives can reach this view at all.
  async proposedDates() {
    const { data, error } = await supabase
      .from('task_assignments')
      .select(`*,
        stakeholder:profiles!${FK_STAKEHOLDER}(id,name,title,color),
        task:tasks(id,title,priority,expected_date,archived)`)
      .eq('promised_state', 'proposed')
      .order('updated_at', { ascending: true });
    if (error) throw error;
    // Archived tasks are off every board, so they should not sit in a queue either.
    return (data || []).filter((r) => r.task && !r.task.archived);
  },

  // ── CR-02 #5: notifications (promised-date workflow only) ──────────────────
  async notifications({ limit = 30 } = {}) {
    const { data, error } = await supabase
      .from('notifications')
      .select(`*, actor:profiles!${FK_NOTIF_ACTOR}(id,name), task:tasks(id,title)`)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error; return data || [];
  },
  markNotificationsRead: (ids) => rpc('mark_notifications_read', { p_ids: ids ?? null }),

  // ── mutations (RPC) ─────────────────────────────────────────────────────────
  createTask: (t) => rpc('create_task', {
    p_title: t.title, p_description: t.description || '', p_priority: t.priority || 'medium',
    p_expected_date: t.expected_date || null, p_followup_date: t.next_followup_date || null,
    p_stakeholders: t.stakeholders || [],
  }),

  // CR-01 #6. A separate, narrower RPC on purpose: it takes no assignee list,
  // so a stakeholder can never route a self-raised task to somebody else.
  createSelfTask: (t) => rpc('create_self_task', {
    p_title: t.title, p_description: t.description || '',
    p_priority: t.priority || 'medium', p_expected_date: t.expected_date || null,
  }),
  updateSelfTask: (taskId, t) => rpc('update_self_task', {
    p_task_id: taskId, p_title: t.title, p_description: t.description || '',
    p_priority: t.priority || 'medium', p_expected_date: t.expected_date || null,
  }),
  // "Withdraw" archives — reversible, and the default action in the UI.
  archiveSelfTask: (taskId) => rpc('archive_self_task', { p_task_id: taskId }),

  // ── Permanent delete (CR-01 #6) ────────────────────────────────────────────
  // Irreversible. The RPC records a `task_deleted` audit event before removing
  // the row, so the history survives, then returns the storage paths its
  // attachments orphaned — removed here, because SQL cannot reach the bucket.
  // A failure to clean the bucket is not fatal: with no task row, no storage
  // policy grants access to those objects anyway.
  async deleteTask(taskId) {
    const paths = await rpc('delete_task', { p_task_id: taskId });
    await removeOrphanedObjects(paths);
  },
  async deleteSelfTask(taskId) {
    const paths = await rpc('delete_self_task', { p_task_id: taskId });
    await removeOrphanedObjects(paths);
  },

  advanceStatus: (assignmentId, target) => rpc('advance_status', { p_assignment_id: assignmentId, p_target: target }),
  proposePromised: (assignmentId, date) => rpc('propose_promised_date', { p_assignment_id: assignmentId, p_date: date }),
  confirmPromised: (assignmentId) => rpc('confirm_promised_date', { p_assignment_id: assignmentId }),
  // CR-02 #4: the reason is mandatory server-side, not merely a required input.
  rejectPromised: (assignmentId, reason) =>
    rpc('reject_promised_date', { p_assignment_id: assignmentId, p_reason: reason }),
  reopen: (assignmentId) => rpc('reopen_assignment', { p_assignment_id: assignmentId }),
  addComment: (assignmentId, body) => rpc('add_comment', { p_assignment_id: assignmentId, p_body: body }),
  addStakeholder: (taskId, stakeholderId) => rpc('add_stakeholder', { p_task_id: taskId, p_stakeholder_id: stakeholderId }),
  removeStakeholder: (assignmentId) => rpc('remove_stakeholder', { p_assignment_id: assignmentId }),
  archiveTask: (taskId) => rpc('archive_task', { p_task_id: taskId }),
  restoreTask: (taskId) => rpc('restore_task', { p_task_id: taskId }),

  // Executive-only direct field edits (RLS-gated, audited by trigger).
  async updateTask(taskId, fields) {
    const { data, error } = await supabase.from('tasks').update(fields).eq('id', taskId).select().single();
    if (error) throw error; return data;
  },
};
