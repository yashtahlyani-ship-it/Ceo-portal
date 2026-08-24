// Unit tests for the pure business/derivation logic. No network, no database —
// these guard the rules the UI reads to decide what to render. The SERVER's
// version of the same rules is covered by security.test.mjs; if these two ever
// disagree, the server is right and this file is the bug.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FORWARD_NEXT, allowedTargets, canReopen, canConfirmPromised, canProposePromised,
  canCreateTask, canEditTask, canArchive, canViewAudit, isTaskComplete,
  isSelfCreated, canEditOwnTask, createsForSelfOnly, EMPTY_FILTERS,
} from '../src/lib/rules.js';
import { applyFilters, isFiltered, friendlyMoveError } from '../src/lib/filters.js';
import { metrics, byStakeholder, toCards } from '../src/lib/derive.js';
import { initials, dueMeta, isExecutiveRole, roleLabel } from '../src/lib/format.js';

// Local calendar date, NOT toISOString() — that is UTC, and east of Greenwich it
// returns yesterday for most of the working day. daysUntil() compares local
// midnights, so the fixtures must be built the same way or every date-based
// assertion drifts by one day. (The Marketing Portal carries the same note.)
const iso = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/* ── Transition rules ────────────────────────────────────────────────────── */

test('the forward path is a single chain with no shortcuts', () => {
  assert.equal(FORWARD_NEXT.todo, 'in_progress');
  assert.equal(FORWARD_NEXT.in_progress, 'under_review');
  assert.equal(FORWARD_NEXT.under_review, 'done');
  assert.equal(FORWARD_NEXT.reopened, 'in_progress', 'rework rejoins at in_progress');
  assert.equal(FORWARD_NEXT.done, null, 'done is terminal for a stakeholder');
});

test('a stakeholder is offered exactly one next step, an executive every other status', () => {
  for (const status of ['todo', 'in_progress', 'under_review', 'reopened']) {
    const targets = allowedTargets('stakeholder', { status });
    assert.equal(targets.length, 1, `${status} offers one step`);
    assert.equal(targets[0], FORWARD_NEXT[status]);
  }
  assert.deepEqual(allowedTargets('stakeholder', { status: 'done' }), [], 'done offers nothing');

  for (const role of ['ea', 'ceo']) {
    const targets = allowedTargets(role, { status: 'todo' });
    assert.equal(targets.length, 4, `${role} may move anywhere else`);
    assert.ok(!targets.includes('todo'), 'never offers the current status');
    assert.ok(targets.includes('done'), 'including straight to done');
    assert.ok(targets.includes('reopened'));
  }
});

/* ── Permission predicates ───────────────────────────────────────────────── */

test('executive-only capabilities are closed to stakeholders', () => {
  for (const can of [canEditTask, canArchive, canViewAudit]) {
    assert.equal(can('ea'), true);
    assert.equal(can('ceo'), true);
    assert.equal(can('stakeholder'), false);
  }
});

test('only an executive reopens, and only a done assignment', () => {
  assert.equal(canReopen('ceo', { status: 'done' }), true);
  assert.equal(canReopen('ea', { status: 'done' }), true);
  assert.equal(canReopen('stakeholder', { status: 'done' }), false);
  assert.equal(canReopen('ceo', { status: 'under_review' }), false);
});

// A task the CEO's Office assigned, versus one a stakeholder raised themselves.
const EA_TASK = { creator: { id: 'ceo-1', role: 'ceo' } };
const SELF_TASK = { creator: { id: 'sh-1', role: 'stakeholder' }, created_by: 'sh-1' };

test('promised dates: the stakeholder proposes, the executive confirms, then it locks', () => {
  assert.equal(canProposePromised('stakeholder', { promised_state: 'none' }, true, EA_TASK), true);
  assert.equal(canProposePromised('stakeholder', { promised_state: 'proposed' }, true, EA_TASK), true,
    'a proposal may be revised until it is confirmed');
  assert.equal(canProposePromised('stakeholder', { promised_state: 'confirmed' }, true, EA_TASK), false,
    'a confirmed date is locked');
  assert.equal(canProposePromised('stakeholder', { promised_state: 'none' }, false, EA_TASK), false,
    'only the assignee proposes');
  assert.equal(canProposePromised('ceo', { promised_state: 'none' }, true, EA_TASK), false,
    'an executive does not propose on someone’s behalf');

  assert.equal(canConfirmPromised('ceo', { promised_state: 'proposed' }, EA_TASK), true);
  assert.equal(canConfirmPromised('stakeholder', { promised_state: 'proposed' }, EA_TASK), false);
  assert.equal(canConfirmPromised('ceo', { promised_state: 'none' }, EA_TASK), false,
    'there must be a proposal to confirm');
});

test('a task is complete only when every assignee is done', () => {
  assert.equal(isTaskComplete({ assignments: [{ status: 'done' }, { status: 'done' }] }), true);
  assert.equal(isTaskComplete({ assignments: [{ status: 'done' }, { status: 'in_progress' }] }), false);
  assert.equal(isTaskComplete({ assignments: [] }), false, 'an unassigned task is not complete');
});

/* ── Filters ─────────────────────────────────────────────────────────────── */

const card = (over = {}) => ({
  task: { id: 1, priority: 'medium', expected_date: iso(3), next_followup_date: null, ...over.task },
  a: { id: 1, stakeholder_id: 'sh-1', status: 'todo', ...over.a },
});

test('an empty filter set matches everything and reads as not filtered', () => {
  const cards = [card(), card({ a: { status: 'done' } })];
  const empty = EMPTY_FILTERS;
  assert.equal(isFiltered(empty), false);
  assert.equal(applyFilters(cards, empty).length, 2);
});

test('filters narrow by stakeholder, priority and status', () => {
  const cards = [
    card({ a: { stakeholder_id: 'sh-1', status: 'todo' }, task: { priority: 'high' } }),
    card({ a: { stakeholder_id: 'sh-2', status: 'done' }, task: { priority: 'low' } }),
  ];
  assert.equal(applyFilters(cards, { stakeholder: 'sh-1' }).length, 1);
  assert.equal(applyFilters(cards, { priority: 'low' }).length, 1);
  assert.equal(applyFilters(cards, { status: 'done' }).length, 1);
  assert.equal(applyFilters(cards, { stakeholder: 'sh-1', priority: 'low' }).length, 0,
    'filters combine with AND');
});

test('the date range filters on when a task was RAISED, not when it is due', () => {
  // CR-01 #3/#4. Both are due far in the future; only creation date differs.
  const old = card({ task: { created_at: `${iso(-40)}T09:00:00+05:30`, expected_date: iso(30) } });
  const recent = card({ task: { created_at: `${iso(-2)}T09:00:00+05:30`, expected_date: iso(30) } });
  const undated = card({ task: { created_at: null, expected_date: iso(30) } });

  const out = applyFilters([old, recent, undated], { createdFrom: iso(-7), createdTo: iso(0) });
  assert.equal(out.length, 1, 'only the recently raised task matches');
  assert.equal(out[0].task.expected_date, iso(30), 'expected date is irrelevant to this filter');
});

test('a created-date bound uses the local calendar day, not the UTC slice', () => {
  // 09:00 IST on day X is still day X-1 in UTC. Filtering "created on X"
  // must keep it, or every morning's tasks vanish from their own day.
  const morningIST = card({ task: { created_at: `${iso(0)}T09:00:00+05:30` } });
  const out = applyFilters([morningIST], { createdFrom: iso(0), createdTo: iso(0) });
  assert.equal(out.length, 1);
});

test('the dashboard due-date buckets survive the filter swap', () => {
  // CR-4 changes the manual control only; these buckets still key off expected
  // date, and are how the Overdue / Due today / Next 7 tiles drill through.
  const overdue = card({ task: { expected_date: iso(-3) }, a: { status: 'todo' } });
  const today = card({ task: { expected_date: iso(0) }, a: { status: 'todo' } });
  const soon = card({ task: { expected_date: iso(4) }, a: { status: 'todo' } });
  const lateDone = card({ task: { expected_date: iso(-9) }, a: { status: 'done' } });
  const all = [overdue, today, soon, lateDone];

  assert.equal(applyFilters(all, { dueBucket: 'overdue' }).length, 1, 'a completed late task is not overdue');
  assert.equal(applyFilters(all, { dueBucket: 'today' }).length, 1);
  assert.equal(applyFilters(all, { dueBucket: 'next7' }).length, 1);
});

test('CR-01 #6: everyone can raise a task, but only executives assign to others', () => {
  assert.equal(canCreateTask('ea'), true);
  assert.equal(canCreateTask('ceo'), true);
  assert.equal(canCreateTask('stakeholder'), true, 'stakeholders may now raise their own');
  assert.equal(createsForSelfOnly('stakeholder'), true);
  assert.equal(createsForSelfOnly('ea'), false);
  assert.equal(createsForSelfOnly('ceo'), false);
});

test('CR-01 #6: a self-created task has no propose/confirm handshake', () => {
  assert.equal(isSelfCreated(SELF_TASK), true);
  assert.equal(isSelfCreated(EA_TASK), false);
  assert.equal(isSelfCreated(undefined), false, 'missing creator is not self-created');

  assert.equal(canProposePromised('stakeholder', { promised_state: 'none' }, true, SELF_TASK), false,
    'the creator already set the date');
  assert.equal(canConfirmPromised('ceo', { promised_state: 'proposed' }, SELF_TASK), false,
    'there is nothing for an executive to confirm');
});

test('CR-01 #6: a stakeholder may edit the task they raised, and only that one', () => {
  assert.equal(canEditOwnTask('stakeholder', SELF_TASK, 'sh-1'), true);
  assert.equal(canEditOwnTask('stakeholder', SELF_TASK, 'sh-2'), false, 'not someone else’s self-raised task');
  assert.equal(canEditOwnTask('stakeholder', EA_TASK, 'sh-1'), false, 'not work assigned to them');
  assert.equal(canEditOwnTask('ceo', SELF_TASK, 'sh-1'), false, 'executives use the executive path');
});

test('the follow-up filter keeps only follow-ups that are due or overdue', () => {
  const overdue = card({ task: { next_followup_date: iso(-2) } });
  const todayDue = card({ task: { next_followup_date: iso(0) } });
  const future = card({ task: { next_followup_date: iso(4) } });
  const none = card({ task: { next_followup_date: null } });
  const out = applyFilters([overdue, todayDue, future, none], { followupsDue: true });
  assert.equal(out.length, 2, 'overdue and due-today only');
});

/* ── Derived dashboard numbers ───────────────────────────────────────────── */

test('metrics bucket work by urgency and ignore completed assignments', () => {
  const tasks = [
    { id: 1, expected_date: iso(-3), next_followup_date: null, assignments: [{ id: 1, status: 'todo' }] },
    { id: 2, expected_date: iso(0), next_followup_date: null, assignments: [{ id: 2, status: 'in_progress' }] },
    { id: 3, expected_date: iso(4), next_followup_date: null, assignments: [{ id: 3, status: 'under_review' }] },
    { id: 4, expected_date: iso(-9), next_followup_date: null, assignments: [{ id: 4, status: 'done' }] },
    { id: 5, expected_date: iso(2), next_followup_date: iso(-1), assignments: [{ id: 5, status: 'reopened' }] },
  ];
  const m = metrics(tasks);
  assert.equal(m.overdue, 1, 'the done-but-late task is not overdue');
  assert.equal(m.today, 1);
  assert.equal(m.next7, 2, 'the reopened task due in 2 days counts');
  assert.equal(m.reopened, 1);
  assert.equal(m.followups, 1);
  assert.equal(m.done, 1);
  assert.equal(m.total, 5, 'one card per assignment');
});

test('one task with three assignees yields three cards', () => {
  const tasks = [{
    id: 1, expected_date: null,
    assignments: [{ id: 1, status: 'done' }, { id: 2, status: 'todo' }, { id: 3, status: 'under_review' }],
  }];
  assert.equal(toCards(tasks).length, 3);
});

test('the stakeholder rollup counts active, overdue and reopened, worst first', () => {
  const sh1 = { id: 'a', name: 'Aarav' };
  const sh2 = { id: 'b', name: 'Priya' };
  const tasks = [
    { id: 1, expected_date: iso(-2), assignments: [{ id: 1, status: 'todo', stakeholder: sh1 }] },
    { id: 2, expected_date: iso(-5), assignments: [{ id: 2, status: 'reopened', stakeholder: sh1 }] },
    { id: 3, expected_date: iso(5), assignments: [{ id: 3, status: 'todo', stakeholder: sh2 }] },
    { id: 4, expected_date: iso(-1), assignments: [{ id: 4, status: 'done', stakeholder: sh2 }] },
  ];
  const rows = byStakeholder(tasks);
  assert.equal(rows[0].stakeholder.name, 'Aarav', 'the most overdue person sorts first');
  assert.equal(rows[0].overdue, 2);
  assert.equal(rows[0].reopened, 1);
  assert.equal(rows[1].activeN, 1);
  assert.equal(rows[1].overdue, 0, 'a done assignment is never overdue');
  assert.equal(rows[1].done, 1);
});

/* ── Formatting ──────────────────────────────────────────────────────────── */

test('due-date labels carry an urgency tier as well as text', () => {
  assert.equal(dueMeta(null).tier, 'none');
  assert.equal(dueMeta(iso(-3)).tier, 'overdue');
  assert.match(dueMeta(iso(-3)).label, /3d overdue/);
  assert.equal(dueMeta(iso(0)).tier, 'today');
  assert.equal(dueMeta(iso(4)).tier, 'soon');
  assert.equal(dueMeta(iso(40)).tier, 'later');
});

test('initials handle one name, many names and nothing at all', () => {
  assert.equal(initials('Aarav Mehta'), 'AM');
  assert.equal(initials('Priya'), 'P');
  assert.equal(initials('Dev Kumar Malhotra'), 'DK', 'at most two');
  assert.equal(initials(''), '?');
  assert.equal(initials(), '?');
});

test('role helpers name the three roles and identify executives', () => {
  assert.equal(isExecutiveRole('ea'), true);
  assert.equal(isExecutiveRole('ceo'), true);
  assert.equal(isExecutiveRole('stakeholder'), false);
  assert.equal(roleLabel('ea'), 'Executive Assistant');
  assert.equal(roleLabel('ceo'), 'CEO');
  assert.equal(roleLabel('stakeholder'), 'Stakeholder');
});

/* ── Error copy ──────────────────────────────────────────────────────────── */

test('server error codes become sentences a person can act on', () => {
  assert.match(friendlyMoveError({ message: 'INVALID_TRANSITION: todo cannot move to done' }),
    /step by step/);
  assert.match(friendlyMoveError({ message: 'FORBIDDEN: not your assignment' }),
    /permission/);
  assert.match(friendlyMoveError({ message: 'LOCKED: this promised date has been confirmed' }),
    /confirmed and locked/);
  assert.equal(friendlyMoveError({ message: 'something else entirely' }), 'something else entirely',
    'anything unrecognised passes through unchanged');
});
