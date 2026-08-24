// ════════════════════════════════════════════════════════════════════════════
//  SECURITY + WORKFLOW INTEGRATION TESTS
//
//  These run against the REAL Supabase project using the anon key and real
//  sign-ins — exactly the surface a browser has. Nothing here uses the service
//  role, so every pass is evidence that the server itself refuses, not that the
//  UI hid a button.
//
//    node --test tests/
//
//  Requires .env at the project root (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY,
//  SUPABASE_SERVICE_ROLE_KEY) and a seeded database (cd scripts && npm run seed).
// ════════════════════════════════════════════════════════════════════════════
import test from 'node:test';
import assert from 'node:assert/strict';
import { anonClient, signIn, admin, DEMO_PASSWORD, freshTask, cleanup, profileIdFor } from './helpers.mjs';

const EA = 'ea@demo.gyftr.net';
const CEO = 'ceo@demo.gyftr.net';
const ALICE = 'neha@demo.gyftr.net';   // stakeholder A
const BOB = 'saurabh@demo.gyftr.net';      // stakeholder B

test.after(cleanup);

/* ── Authentication ──────────────────────────────────────────────────────── */

test('EA, CEO and stakeholder can all sign in', async () => {
  for (const email of [EA, CEO, ALICE]) {
    const c = anonClient();
    const { error } = await c.auth.signInWithPassword({ email, password: DEMO_PASSWORD });
    assert.equal(error, null, `${email} should sign in`);
  }
});

test('a wrong password is rejected', async () => {
  const c = anonClient();
  const { error } = await c.auth.signInWithPassword({ email: ALICE, password: 'not-the-password' });
  assert.ok(error, 'sign-in should fail');
});

test('an anonymous caller reads no tasks at all', async () => {
  const c = anonClient();                       // never signed in
  const { data } = await c.from('tasks').select('*');
  assert.deepEqual(data ?? [], [], 'RLS must return nothing to an unauthenticated caller');
});

/* ── Role permissions ────────────────────────────────────────────────────── */

test('EA and CEO can create a task; a stakeholder cannot', async () => {
  for (const email of [EA, CEO]) {
    const c = await signIn(email);
    const { data, error } = await c.rpc('create_task', {
      p_title: `perm probe ${email}`, p_description: '', p_priority: 'low',
      p_expected_date: null, p_followup_date: null, p_stakeholders: [],
    });
    assert.equal(error, null, `${email} should create a task`);
    assert.ok(data, 'should return the new task id');
  }

  const c = await signIn(ALICE);
  const { error } = await c.rpc('create_task', {
    p_title: 'stakeholder should not manage this', p_description: '', p_priority: 'low',
    p_expected_date: null, p_followup_date: null, p_stakeholders: [],
  });
  assert.ok(error, 'a stakeholder must not be able to create a task');
  assert.match(error.message, /FORBIDDEN/i);
});

test('a stakeholder cannot edit task details', async () => {
  const { taskId } = await freshTask({ assignees: [ALICE] });
  const c = await signIn(ALICE);
  await c.from('tasks').update({ title: 'hijacked', priority: 'high' }).eq('id', taskId);

  // RLS makes the UPDATE affect zero rows rather than erroring. Verify via the
  // service role that the row is genuinely untouched.
  const { data } = await admin.from('tasks').select('title, priority').eq('id', taskId).single();
  assert.notEqual(data.title, 'hijacked', 'title must be unchanged');
  assert.notEqual(data.priority, 'high', 'priority must be unchanged');
});

test('a stakeholder cannot archive a task', async () => {
  const { taskId } = await freshTask({ assignees: [ALICE] });
  const c = await signIn(ALICE);
  const { error } = await c.rpc('archive_task', { p_task_id: taskId });
  assert.ok(error, 'archive must be refused');

  const { data } = await admin.from('tasks').select('archived').eq('id', taskId).single();
  assert.equal(data.archived, false, 'task must still be active');
});

/* ── State transitions ───────────────────────────────────────────────────── */

test('a stakeholder walks todo → in_progress → under_review → done', async () => {
  const { assignmentFor } = await freshTask({ assignees: [ALICE] });
  const id = assignmentFor(ALICE);
  const c = await signIn(ALICE);

  for (const target of ['in_progress', 'under_review', 'done']) {
    const { error } = await c.rpc('advance_status', { p_assignment_id: id, p_target: target });
    assert.equal(error, null, `should move to ${target}`);
  }
  const { data } = await admin.from('task_assignments').select('status').eq('id', id).single();
  assert.equal(data.status, 'done');
});

test('a stakeholder cannot skip a stage', async () => {
  const { assignmentFor } = await freshTask({ assignees: [ALICE] });
  const id = assignmentFor(ALICE);
  const c = await signIn(ALICE);

  const { error } = await c.rpc('advance_status', { p_assignment_id: id, p_target: 'done' });
  assert.ok(error, 'todo → done must be refused');
  assert.match(error.message, /INVALID_TRANSITION/);

  const { data } = await admin.from('task_assignments').select('status').eq('id', id).single();
  assert.equal(data.status, 'todo', 'status must not have moved');
});

test('a stakeholder cannot move backward', async () => {
  const { assignmentFor } = await freshTask({ assignees: [ALICE] });
  const id = assignmentFor(ALICE);
  const c = await signIn(ALICE);

  await c.rpc('advance_status', { p_assignment_id: id, p_target: 'in_progress' });
  const { error } = await c.rpc('advance_status', { p_assignment_id: id, p_target: 'todo' });
  assert.ok(error, 'in_progress → todo must be refused');
  assert.match(error.message, /INVALID_TRANSITION/);
});

test('a stakeholder cannot move someone else’s assignment', async () => {
  const { assignmentFor } = await freshTask({ assignees: [ALICE, BOB] });
  const bobsAssignment = assignmentFor(BOB);
  const c = await signIn(ALICE);

  const { error } = await c.rpc('advance_status', { p_assignment_id: bobsAssignment, p_target: 'in_progress' });
  assert.ok(error, 'moving another person’s assignment must be refused');
  assert.match(error.message, /FORBIDDEN/);
});

test('EA and CEO can override to any status, including backward', async () => {
  for (const email of [EA, CEO]) {
    const { assignmentFor } = await freshTask({ assignees: [ALICE] });
    const id = assignmentFor(ALICE);
    const c = await signIn(email);

    // Straight to done, skipping every stage.
    let r = await c.rpc('advance_status', { p_assignment_id: id, p_target: 'done' });
    assert.equal(r.error, null, `${email} should jump straight to done`);
    // And back again.
    r = await c.rpc('advance_status', { p_assignment_id: id, p_target: 'todo' });
    assert.equal(r.error, null, `${email} should move backward`);
  }
});

/* ── Reopening ───────────────────────────────────────────────────────────── */

test('only EA/CEO can reopen a done assignment, and a stakeholder cannot jump back to done', async () => {
  const { assignmentFor } = await freshTask({ assignees: [ALICE] });
  const id = assignmentFor(ALICE);

  const alice = await signIn(ALICE);
  for (const t of ['in_progress', 'under_review', 'done']) {
    await alice.rpc('advance_status', { p_assignment_id: id, p_target: t });
  }

  // Stakeholder may not reopen their own completed work.
  const selfReopen = await alice.rpc('reopen_assignment', { p_assignment_id: id });
  assert.ok(selfReopen.error, 'a stakeholder must not reopen');
  assert.match(selfReopen.error.message, /FORBIDDEN/);

  // The CEO can.
  const ceo = await signIn(CEO);
  const { error } = await ceo.rpc('reopen_assignment', { p_assignment_id: id });
  assert.equal(error, null, 'CEO should reopen');

  let { data } = await admin.from('task_assignments').select('status').eq('id', id).single();
  assert.equal(data.status, 'reopened');

  // From reopened the stakeholder must walk the path again, not jump to done.
  const jump = await alice.rpc('advance_status', { p_assignment_id: id, p_target: 'done' });
  assert.ok(jump.error, 'reopened → done must be refused');
  assert.match(jump.error.message, /INVALID_TRANSITION/);

  const step = await alice.rpc('advance_status', { p_assignment_id: id, p_target: 'in_progress' });
  assert.equal(step.error, null, 'reopened → in_progress is the legal step');
});

test('a not-yet-done assignment cannot be reopened', async () => {
  const { assignmentFor } = await freshTask({ assignees: [ALICE] });
  const ceo = await signIn(CEO);
  const { error } = await ceo.rpc('reopen_assignment', { p_assignment_id: assignmentFor(ALICE) });
  assert.ok(error, 'only a Done assignment may be reopened');
});

/* ── Promised date ───────────────────────────────────────────────────────── */

test('stakeholder proposes, executive confirms, the date then locks', async () => {
  const { assignmentFor } = await freshTask({ assignees: [ALICE] });
  const id = assignmentFor(ALICE);
  const alice = await signIn(ALICE);

  let r = await alice.rpc('propose_promised_date', { p_assignment_id: id, p_date: '2026-09-18' });
  assert.equal(r.error, null, 'stakeholder should propose');

  let { data } = await admin.from('task_assignments')
    .select('promised_state, promised_proposed, promised_date').eq('id', id).single();
  assert.equal(data.promised_state, 'proposed');
  assert.equal(data.promised_date, null, 'nothing is locked until an executive confirms');

  // A stakeholder cannot confirm their own promise.
  r = await alice.rpc('confirm_promised_date', { p_assignment_id: id });
  assert.ok(r.error, 'a stakeholder must not confirm');
  assert.match(r.error.message, /FORBIDDEN/);

  const ceo = await signIn(CEO);
  r = await ceo.rpc('confirm_promised_date', { p_assignment_id: id });
  assert.equal(r.error, null, 'CEO should confirm');

  ({ data } = await admin.from('task_assignments')
    .select('promised_state, promised_date, promised_confirmed_by, promised_confirmed_at').eq('id', id).single());
  assert.equal(data.promised_state, 'confirmed');
  assert.equal(data.promised_date, '2026-09-18');
  assert.ok(data.promised_confirmed_by, 'confirmer is recorded');
  assert.ok(data.promised_confirmed_at, 'confirmation time is recorded');

  // Locked: the stakeholder can no longer change it.
  r = await alice.rpc('propose_promised_date', { p_assignment_id: id, p_date: '2026-10-01' });
  assert.ok(r.error, 'a confirmed date must be locked');
  assert.match(r.error.message, /LOCKED/);
});

/* ── Multi-stakeholder isolation ─────────────────────────────────────────── */

test('two assignees on one task progress independently', async () => {
  const { assignmentFor } = await freshTask({ assignees: [ALICE, BOB] });
  const aliceA = assignmentFor(ALICE);
  const bobA = assignmentFor(BOB);

  const alice = await signIn(ALICE);
  await alice.rpc('advance_status', { p_assignment_id: aliceA, p_target: 'in_progress' });
  await alice.rpc('propose_promised_date', { p_assignment_id: aliceA, p_date: '2026-09-18' });

  const { data } = await admin.from('task_assignments')
    .select('id, status, promised_proposed').in('id', [aliceA, bobA]);
  const mine = data.find((r) => r.id === aliceA);
  const theirs = data.find((r) => r.id === bobA);

  assert.equal(mine.status, 'in_progress');
  assert.equal(theirs.status, 'todo', 'the other assignee is unaffected');
  assert.equal(theirs.promised_proposed, null, 'promised dates are per-assignee');
});

test('a stakeholder cannot see a co-assignee’s assignment, status or comments', async () => {
  const { taskId, assignmentFor } = await freshTask({ assignees: [ALICE, BOB] });
  const bobA = assignmentFor(BOB);

  // Bob comments in his own thread.
  const bob = await signIn(BOB);
  await bob.rpc('add_comment', { p_assignment_id: bobA, p_body: 'Bob private note' });
  await bob.rpc('advance_status', { p_assignment_id: bobA, p_target: 'in_progress' });

  const alice = await signIn(ALICE);

  // Alice sees the task (she is assigned) but only her own assignment row.
  const { data: tasks } = await alice.from('tasks')
    .select('*, assignments:task_assignments(*)').eq('id', taskId);
  assert.equal(tasks.length, 1, 'Alice can see the shared task');
  const visible = tasks[0].assignments;
  assert.equal(visible.length, 1, 'Alice sees exactly one assignment — her own');
  assert.notEqual(visible[0].id, bobA, 'and it is not Bob’s');

  // Directly requesting Bob's assignment yields nothing.
  const { data: direct } = await alice.from('task_assignments').select('*').eq('id', bobA);
  assert.deepEqual(direct ?? [], [], 'Bob’s assignment row must be invisible to Alice');

  // Bob's comment thread is invisible too.
  const { data: comments } = await alice.from('task_comments').select('*').eq('assignment_id', bobA);
  assert.deepEqual(comments ?? [], [], 'Bob’s comments must be invisible to Alice');

  // And she cannot write into his thread.
  const { error } = await alice.rpc('add_comment', { p_assignment_id: bobA, p_body: 'not mine' });
  assert.ok(error, 'commenting on another person’s assignment must be refused');
});

test('a task is only complete when every assignee is done', async () => {
  const { taskId, assignmentFor } = await freshTask({ assignees: [ALICE, BOB] });
  const ceo = await signIn(CEO);

  await ceo.rpc('advance_status', { p_assignment_id: assignmentFor(ALICE), p_target: 'done' });
  let { data } = await admin.from('task_assignments').select('status').eq('task_id', taskId);
  assert.equal(data.every((r) => r.status === 'done'), false, 'not complete with one assignee outstanding');

  await ceo.rpc('advance_status', { p_assignment_id: assignmentFor(BOB), p_target: 'done' });
  ({ data } = await admin.from('task_assignments').select('status').eq('task_id', taskId));
  assert.equal(data.every((r) => r.status === 'done'), true, 'complete once all assignees are done');
});

/* ── Comments ────────────────────────────────────────────────────────────── */

test('comments are immutable — no edit, no delete, by anyone', async () => {
  const { assignmentFor } = await freshTask({ assignees: [ALICE] });
  const id = assignmentFor(ALICE);
  const alice = await signIn(ALICE);
  await alice.rpc('add_comment', { p_assignment_id: id, p_body: 'original text' });

  const { data: before } = await admin.from('task_comments').select('*').eq('assignment_id', id).single();

  // Author tries to edit and delete.
  await alice.from('task_comments').update({ body: 'edited' }).eq('id', before.id);
  await alice.from('task_comments').delete().eq('id', before.id);
  // An executive tries the same.
  const ceo = await signIn(CEO);
  await ceo.from('task_comments').update({ body: 'exec edited' }).eq('id', before.id);
  await ceo.from('task_comments').delete().eq('id', before.id);

  const { data: after } = await admin.from('task_comments').select('*').eq('id', before.id).single();
  assert.equal(after.body, 'original text', 'comment body must be unchanged');
  assert.ok(after, 'comment must still exist');
});

test('an empty comment is rejected', async () => {
  const { assignmentFor } = await freshTask({ assignees: [ALICE] });
  const alice = await signIn(ALICE);
  const { error } = await alice.rpc('add_comment', { p_assignment_id: assignmentFor(ALICE), p_body: '   ' });
  assert.ok(error, 'blank comments must be refused');
});

/* ── Audit log ───────────────────────────────────────────────────────────── */

test('the audit log captures the full lifecycle and is executive-only', async () => {
  const { taskId, assignmentFor } = await freshTask({ assignees: [ALICE] });
  const id = assignmentFor(ALICE);

  const alice = await signIn(ALICE);
  await alice.rpc('propose_promised_date', { p_assignment_id: id, p_date: '2026-09-18' });
  const ceo = await signIn(CEO);
  await ceo.rpc('confirm_promised_date', { p_assignment_id: id });
  for (const t of ['in_progress', 'under_review', 'done']) {
    await alice.rpc('advance_status', { p_assignment_id: id, p_target: t });
  }
  await ceo.rpc('reopen_assignment', { p_assignment_id: id });
  await alice.rpc('add_comment', { p_assignment_id: id, p_body: 'back on it' });
  await ceo.rpc('archive_task', { p_task_id: taskId });

  const { data: events } = await ceo.from('audit_log').select('*').eq('task_id', taskId);
  const actions = events.map((e) => e.action);
  for (const expected of [
    'task_created', 'stakeholder_added', 'promised_proposed', 'promised_confirmed',
    'status_changed', 'task_reopened', 'comment_added', 'task_archived',
  ]) {
    assert.ok(actions.includes(expected), `audit should record ${expected}`);
  }

  // Old → new values are captured on a status change.
  const move = events.find((e) => e.action === 'status_changed' && e.new_value === 'under_review');
  assert.ok(move, 'a status change should be recorded');
  assert.equal(move.old_value, 'in_progress', 'with its previous value');
  assert.ok(move.actor_id, 'and its actor');
  assert.ok(move.actor_role, 'and the actor’s role');

  // A stakeholder sees none of it.
  const { data: hidden } = await alice.from('audit_log').select('*').eq('task_id', taskId);
  assert.deepEqual(hidden ?? [], [], 'stakeholders must not read the audit log');
});

test('the audit log cannot be edited or cleared, even by an executive', async () => {
  const { taskId } = await freshTask({ assignees: [ALICE] });
  const ceo = await signIn(CEO);
  const { data: rows } = await ceo.from('audit_log').select('*').eq('task_id', taskId);
  assert.ok(rows.length > 0, 'there is something to try to tamper with');

  await ceo.from('audit_log').update({ action: 'tampered' }).eq('task_id', taskId);
  await ceo.from('audit_log').delete().eq('task_id', taskId);

  const { data: after } = await admin.from('audit_log').select('*').eq('task_id', taskId);
  assert.equal(after.length, rows.length, 'no audit row may be deleted');
  assert.equal(after.some((r) => r.action === 'tampered'), false, 'no audit row may be edited');
});

/* ── Archive / restore ───────────────────────────────────────────────────── */

test('archive is a soft delete and is reversible; tasks are never hard-deleted', async () => {
  const { taskId } = await freshTask({ assignees: [ALICE] });
  const ceo = await signIn(CEO);

  await ceo.rpc('archive_task', { p_task_id: taskId });
  let { data } = await admin.from('tasks').select('archived, archived_by').eq('id', taskId).single();
  assert.equal(data.archived, true);
  assert.ok(data.archived_by, 'who archived it is recorded');

  await ceo.rpc('restore_task', { p_task_id: taskId });
  ({ data } = await admin.from('tasks').select('archived').eq('id', taskId).single());
  assert.equal(data.archived, false, 'restore brings it back');

  // Even an executive cannot DELETE a task row — there is no DELETE policy.
  await ceo.from('tasks').delete().eq('id', taskId);
  const { data: still } = await admin.from('tasks').select('id').eq('id', taskId);
  assert.equal(still.length, 1, 'the task row must survive a delete attempt');
});

/* ── Saved views ─────────────────────────────────────────────────────────── */

test('saved views are private to their owner and closed to stakeholders', async () => {
  const ea = await signIn(EA);
  const { data: mine, error } = await ea.from('saved_views')
    .insert({ owner_id: (await ea.auth.getUser()).data.user.id, name: 'probe view', filters: { priority: 'high' } })
    .select().single();
  assert.equal(error, null, 'an executive can save a view');

  // The CEO cannot see the EA's view.
  const ceo = await signIn(CEO);
  const { data: theirs } = await ceo.from('saved_views').select('*').eq('id', mine.id);
  assert.deepEqual(theirs ?? [], [], 'views are private to their owner');

  // A stakeholder cannot create one at all.
  const alice = await signIn(ALICE);
  const { data: uid } = await alice.auth.getUser();
  const r = await alice.from('saved_views').insert({ owner_id: uid.user.id, name: 'nope', filters: {} });
  assert.ok(r.error, 'a stakeholder must not create saved views');

  await admin.from('saved_views').delete().eq('id', mine.id);
});

/* ── CR-01 #6: stakeholder-raised tasks ──────────────────────────────────── */

test('a stakeholder can raise a task for themselves, and it lands only on their board', async () => {
  const alice = await signIn(ALICE);
  const { data: taskId, error } = await alice.rpc('create_self_task', {
    p_title: 'CR6 self task', p_description: '', p_priority: 'high', p_expected_date: '2026-09-30',
  });
  assert.equal(error, null, 'a stakeholder may raise their own task');

  const aliceId = await profileIdFor(ALICE);
  const { data: asg } = await admin.from('task_assignments').select('stakeholder_id').eq('task_id', taskId);
  assert.equal(asg.length, 1, 'exactly one assignment');
  assert.equal(asg[0].stakeholder_id, aliceId, 'and it is the creator');

  // Another stakeholder cannot see it at all.
  const bob = await signIn(BOB);
  const { data: hidden } = await bob.from('tasks').select('id').eq('id', taskId);
  assert.deepEqual(hidden ?? [], [], 'invisible to other stakeholders');

  // The CEO's Office sees it, and can tell it was self-raised.
  const ceo = await signIn(CEO);
  const { data: visible } = await ceo.from('tasks')
    .select('id, creator:profiles!tasks_created_by_fkey(name,role)').eq('id', taskId).single();
  assert.equal(visible.creator.role, 'stakeholder', 'the creator marks it as self-created');

  await admin.from('tasks').delete().eq('id', taskId);
});

test('the self-created path cannot be used to assign work to anyone else', async () => {
  // The RPC takes no assignee list at all, so the only way to test the boundary
  // is to confirm the executive path stays closed to stakeholders.
  const alice = await signIn(ALICE);
  const bobId = await profileIdFor(BOB);

  const viaCreate = await alice.rpc('create_task', {
    p_title: 'should not exist', p_description: '', p_priority: 'low',
    p_expected_date: null, p_followup_date: null, p_stakeholders: [bobId],
  });
  assert.ok(viaCreate.error, 'a stakeholder still cannot use create_task');

  const { data: selfId } = await alice.rpc('create_self_task', {
    p_title: 'CR6 assign probe', p_description: '', p_priority: 'low', p_expected_date: null,
  });
  // Nor bolt someone else onto a task they raised.
  const viaAdd = await alice.rpc('add_stakeholder', { p_task_id: selfId, p_stakeholder_id: bobId });
  assert.ok(viaAdd.error, 'a stakeholder cannot add assignees to their own task either');

  await admin.from('tasks').delete().eq('id', selfId);
});

test('only the creator may edit or withdraw a self-raised task, and withdrawal archives', async () => {
  const alice = await signIn(ALICE);
  const { data: taskId } = await alice.rpc('create_self_task', {
    p_title: 'CR6 edit probe', p_description: '', p_priority: 'medium', p_expected_date: null,
  });

  // Another stakeholder is refused both operations.
  const bob = await signIn(BOB);
  const bobEdit = await bob.rpc('update_self_task', {
    p_task_id: taskId, p_title: 'hijacked', p_description: '', p_priority: 'high', p_expected_date: null,
  });
  assert.ok(bobEdit.error, 'not your task to edit');
  const bobDrop = await bob.rpc('archive_self_task', { p_task_id: taskId });
  assert.ok(bobDrop.error, 'not your task to withdraw');

  // The creator can edit it.
  const edit = await alice.rpc('update_self_task', {
    p_task_id: taskId, p_title: 'CR6 edit probe v2', p_description: 'added later',
    p_priority: 'low', p_expected_date: '2026-10-01',
  });
  assert.equal(edit.error, null, 'the creator may edit');
  const { data: after } = await admin.from('tasks').select('title, description').eq('id', taskId).single();
  assert.equal(after.title, 'CR6 edit probe v2');
  assert.equal(after.description, 'added later', 'a summary can be added after the fact (CR-01 #1)');

  // Withdrawing archives rather than destroys.
  const drop = await alice.rpc('archive_self_task', { p_task_id: taskId });
  assert.equal(drop.error, null, 'the creator may withdraw');
  const { data: arch } = await admin.from('tasks').select('archived').eq('id', taskId).single();
  assert.equal(arch.archived, true, 'archived, not destroyed');

  await admin.from('tasks').delete().eq('id', taskId);
});

test('a stakeholder still cannot edit a task the CEO’s Office assigned to them', async () => {
  const { taskId } = await freshTask({ assignees: [ALICE], title: 'assigned, not self-raised' });
  const alice = await signIn(ALICE);

  const r = await alice.rpc('update_self_task', {
    p_task_id: taskId, p_title: 'hijacked', p_description: '', p_priority: 'high', p_expected_date: null,
  });
  assert.ok(r.error, 'update_self_task is scoped to tasks they raised');

  const { data } = await admin.from('tasks').select('title').eq('id', taskId).single();
  assert.equal(data.title, 'assigned, not self-raised', 'unchanged');
});

test('the promised-date handshake does not apply to a self-raised task', async () => {
  const alice = await signIn(ALICE);
  const { data: taskId } = await alice.rpc('create_self_task', {
    p_title: 'CR6 promise probe', p_description: '', p_priority: 'low', p_expected_date: '2026-09-20',
  });
  const { data: asg } = await admin.from('task_assignments').select('id').eq('task_id', taskId).single();

  const propose = await alice.rpc('propose_promised_date', { p_assignment_id: asg.id, p_date: '2026-09-25' });
  assert.ok(propose.error, 'there is nobody to promise to');
  assert.match(propose.error.message, /SELF_CREATED/);

  const ceo = await signIn(CEO);
  const confirm = await ceo.rpc('confirm_promised_date', { p_assignment_id: asg.id });
  assert.ok(confirm.error, 'and nothing for an executive to confirm');

  await admin.from('tasks').delete().eq('id', taskId);
});

test('an executive can still archive and edit a self-raised task', async () => {
  const alice = await signIn(ALICE);
  const { data: taskId } = await alice.rpc('create_self_task', {
    p_title: 'CR6 exec authority', p_description: '', p_priority: 'low', p_expected_date: null,
  });

  const ceo = await signIn(CEO);
  const { error: upErr } = await ceo.from('tasks').update({ priority: 'high' }).eq('id', taskId);
  assert.equal(upErr, null);
  const { error: arErr } = await ceo.rpc('archive_task', { p_task_id: taskId });
  assert.equal(arErr, null, 'no special protection because a stakeholder raised it');

  const { data } = await admin.from('tasks').select('priority, archived').eq('id', taskId).single();
  assert.equal(data.priority, 'high');
  assert.equal(data.archived, true);

  await admin.from('tasks').delete().eq('id', taskId);
});

/* ── Stakeholder onboarding (Edge Function) ──────────────────────────────── */

test('only an executive can add a stakeholder, and the new account must set a password', async () => {
  // A stakeholder calling the function directly is refused server-side.
  const alice = await signIn(ALICE);
  const refused = await alice.functions.invoke('create-stakeholder', {
    body: { name: 'Should Not Exist', email: `reject-${Date.now()}@demo.gyftr.net` },
  });
  assert.ok(refused.error || refused.data?.error, 'a stakeholder must not create accounts');

  // The CEO can.
  const email = `probe-${Date.now()}@demo.gyftr.net`;
  const ceo = await signIn(CEO);
  const { data, error } = await ceo.functions.invoke('create-stakeholder', {
    body: { name: 'Probe Head', email, title: 'Head of Probe' },
  });
  assert.equal(error, null, 'the CEO should create a stakeholder');
  assert.equal(data.email, email);
  assert.ok(data.tempPassword?.length >= 12, 'a temporary password is issued');

  const { data: users } = await admin.auth.admin.listUsers();
  const created = users.users.find((u) => u.email === email);
  assert.ok(created, 'the auth user exists');
  // NOTE: this asserts the server SETS the flag. Whether the app actually holds
  // the person on the set-password screen is a client-side render guard in
  // App.jsx that no test here can reach — it shipped broken once precisely
  // because this assertion passed while the UI let people straight through.
  // Re-verify that path in a browser when touching auth. See HANDOVER.md §9.
  assert.equal(created.user_metadata.must_set_password, true,
    'the account is stamped for the first-login password step');

  const { data: profile } = await admin.from('profiles').select('role, title, active').eq('id', created.id).single();
  assert.equal(profile.role, 'stakeholder', 'never created as an executive');
  assert.equal(profile.active, true);

  await admin.auth.admin.deleteUser(created.id);
});

/* ── Attachments ─────────────────────────────────────────────────────────── */

test('attachment metadata follows task visibility; stakeholders cannot upload', async () => {
  const { taskId } = await freshTask({ assignees: [ALICE] });
  await admin.from('task_attachments').insert({
    task_id: taskId, storage_path: `task/${taskId}/probe.pdf`, file_name: 'probe.pdf',
    mime_type: 'application/pdf', size_bytes: 1234,
    uploaded_by: (await admin.from('profiles').select('id').eq('email', CEO).single()).data.id,
  });

  // Alice is assigned, so she may see it.
  const alice = await signIn(ALICE);
  const { data: visible } = await alice.from('task_attachments').select('*').eq('task_id', taskId);
  assert.equal(visible.length, 1, 'an assignee can see the task’s attachments');

  // Bob is not assigned to this task, so he may not.
  const bob = await signIn(BOB);
  const { data: hidden } = await bob.from('task_attachments').select('*').eq('task_id', taskId);
  assert.deepEqual(hidden ?? [], [], 'a non-assignee sees no attachments');

  // And a stakeholder cannot add one.
  const r = await alice.from('task_attachments').insert({
    task_id: taskId, storage_path: `task/${taskId}/nope.pdf`, file_name: 'nope.pdf',
    uploaded_by: (await alice.auth.getUser()).data.user.id,
  });
  assert.ok(r.error, 'a stakeholder must not upload attachments');
});

test('a real file round-trips: executive uploads bytes, assignee downloads them, nobody else can', async () => {
  const { taskId } = await freshTask({ assignees: [ALICE], title: 'attachment round-trip' });

  // A genuine (tiny) PDF, pushed through the same anon-key path the browser uses.
  const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a]);
  const file = new Blob([bytes], { type: 'application/pdf' });
  const path = `task/${taskId}/${crypto.randomUUID()}-brief.pdf`;

  const ceo = await signIn(CEO);
  const up = await ceo.storage.from('task-attachments')
    .upload(path, file, { contentType: 'application/pdf' });
  assert.equal(up.error, null, 'an executive can upload');

  // The assignee can mint a signed URL and actually read the bytes back.
  const alice = await signIn(ALICE);
  const signed = await alice.storage.from('task-attachments').createSignedUrl(path, 60);
  assert.equal(signed.error, null, 'an assignee can mint a signed URL');

  const res = await fetch(signed.data.signedUrl);
  assert.equal(res.ok, true, 'the signed URL actually serves the file');
  const back = new Uint8Array(await res.arrayBuffer());
  assert.deepEqual(back, bytes, 'the bytes round-trip unchanged');

  // Bob holds no assignment on this task.
  const bob = await signIn(BOB);
  const foreign = await bob.storage.from('task-attachments').createSignedUrl(path, 60);
  assert.ok(foreign.error || !foreign.data?.signedUrl, 'a non-assignee cannot mint a URL');

  // And a stakeholder cannot upload at all.
  const shUpload = await alice.storage.from('task-attachments')
    .upload(`task/${taskId}/nope.pdf`, file, { contentType: 'application/pdf' });
  assert.ok(shUpload.error, 'a stakeholder must not upload');

  await admin.storage.from('task-attachments').remove([path]);
});

test('the attachments bucket is private and refuses a foreign task’s object', async () => {
  const { data: bucket } = await admin.storage.getBucket('task-attachments');
  assert.equal(bucket.public, false, 'the bucket must not be public');

  // A task Bob is NOT assigned to.
  const { taskId } = await freshTask({ assignees: [ALICE] });
  const bob = await signIn(BOB);
  const { data, error } = await bob.storage.from('task-attachments')
    .createSignedUrl(`task/${taskId}/anything.pdf`, 60);
  assert.ok(error || !data?.signedUrl, 'a non-assignee must not mint a signed URL for that task');
});
