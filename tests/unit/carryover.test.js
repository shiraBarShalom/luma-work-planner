// Mandatory carryover behavior ("משימות שלא הסתיימו עד היום").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeStore, must } from '../helpers.js';
import { carriedTasks, todaysTasks, waitingTasks, sortByPriority } from '../../js/engine/taskCarryover.js';

/** Legacy data (records that older versions created and that may still exist). */
function withLegacy(store, mutate) { const s = structuredClone(store.state); mutate(s); store._setState(s); }
const rule = (id, title, recurrence, extra = {}) => ({ id, title, details: '', categoryId: 'admin', priority: 'medium', estimateMinutes: null, subtasks: [], preferredRole: null, recurrence: { interval: 1, weekdays: [], exceptions: [], endDate: null, ...recurrence }, routine: false, carryover: 'latest', archived: false, createdAt: '2026-11-30T08:00:00.000Z', updatedAt: '2026-11-30T08:00:00.000Z', ...extra });

const MON = '2026-11-30', TUE = '2026-12-01', WED = '2026-12-02', THU = '2026-12-03', FRI = '2026-12-04', SUN = '2026-12-06';
const ids = (items) => items.map((x) => (x.task ? x.task.id : x.id));

test('task left unchecked on Monday appears Tuesday in the carried section, not as new, same ID, no clone', async () => {
  const { store } = await makeStore({ date: MON });
  const id = await must(store.dispatch('addTask', { title: 'בדיקת מסמכים', scheduledDate: MON, deadline: '2026-12-10' }));
  assert.deepEqual(ids(todaysTasks(store.state, MON)), [id]);
  assert.deepEqual(ids(carriedTasks(store.state, MON)), []);
  // Next day: no commands, no closing, nothing run overnight.
  const tue = carriedTasks(store.state, TUE);
  assert.deepEqual(ids(tue), [id]);
  assert.ok(!ids(todaysTasks(store.state, TUE)).includes(id), 'distinct from new tasks');
  assert.equal(store.state.tasks.length, 1, 'no duplicate record');
  const t = tue[0].task;
  assert.equal(t.scheduledDate, MON, 'original scheduled date preserved');
  assert.equal(t.originalScheduledDate, MON);
  assert.equal(t.deadline, '2026-12-10', 'deadline preserved');
  assert.equal(tue[0].ageDays, 1);
});

test('keeps appearing on subsequent workdays and after several days closed; skips weekend', async () => {
  const { store, clock } = await makeStore({ date: THU });
  const id = await must(store.dispatch('addTask', { title: 'משימה', scheduledDate: THU }));
  assert.ok(ids(carriedTasks(store.state, FRI)).includes(id)); // read-only overview on non-working day
  assert.deepEqual(ids(carriedTasks(store.state, SUN)), [id], 'surfaces on next workday after the weekend');
  const s = carriedTasks(store.state, SUN)[0];
  assert.equal(s.ageDays, 3);
  assert.equal(s.workdayAge, 1, 'working-day age skips Fri/Sat');
  clock.set('2026-12-09');
  assert.deepEqual(ids(carriedTasks(store.state, '2026-12-09')), [id], 'app closed for days: still there');
  // Idempotent: reading repeatedly changes nothing.
  const rev = store.state.metadata.revision;
  carriedTasks(store.state, '2026-12-09'); carriedTasks(store.state, '2026-12-09');
  assert.equal(store.state.metadata.revision, rev);
  assert.equal(store.state.tasks.length, 1);
});

test('time-off days are skipped like weekends', async () => {
  const { store } = await makeStore({ date: MON });
  withLegacy(store, (st) => { st.dayOverrides[TUE] = { isWorking: false, label: 'חופשה' }; });
  const id = await must(store.dispatch('addTask', { title: 'x', scheduledDate: MON }));
  assert.ok(carriedTasks(store.state, WED).some((x) => x.task.id === id));
  assert.equal(carriedTasks(store.state, WED)[0].workdayAge, 1);
});

test('completing anywhere removes it from every unfinished view; reopening restores it without copies', async () => {
  const { store, clock } = await makeStore({ date: MON });
  const id = await must(store.dispatch('addTask', { title: 'x', scheduledDate: MON }));
  clock.set(TUE);
  await must(store.dispatch('setPriorities', { date: TUE, ids: [id] }));
  await must(store.dispatch('toggleTaskDone', { id }));
  assert.deepEqual(ids(carriedTasks(store.state, TUE)), []);
  assert.deepEqual(ids(carriedTasks(store.state, WED)), []);
  const t = store.state.tasks[0];
  assert.equal(t.completedOn, TUE);
  assert.equal(t.scheduledDate, MON, 'completion does not rewrite schedule');
  assert.equal(store.state.dailyPriorities[TUE], undefined, 'completing frees the important-task slot (same task ID kept)');
  await must(store.dispatch('toggleTaskDone', { id }));
  assert.deepEqual(ids(carriedTasks(store.state, WED)), [id]);
  assert.equal(store.state.tasks.length, 1);
});

test('waiting, deferred, canceled, future and unscheduled tasks do not carry as ordinary work', async () => {
  const { store } = await makeStore({ date: MON });
  const w = await must(store.dispatch('addTask', { title: 'waiting', scheduledDate: MON }));
  await must(store.dispatch('setTaskStatus', { id: w, status: 'waiting' }));
  const d = await must(store.dispatch('addTask', { title: 'deferred', scheduledDate: MON }));
  await must(store.dispatch('setTaskStatus', { id: d, status: 'deferred', resumeOn: THU }));
  const c = await must(store.dispatch('addTask', { title: 'canceled', scheduledDate: MON }));
  await must(store.dispatch('setTaskStatus', { id: c, status: 'canceled' }));
  await must(store.dispatch('addTask', { title: 'future', scheduledDate: '2026-12-10' }));
  await must(store.dispatch('addTask', { title: 'backlog' }));
  assert.deepEqual(ids(carriedTasks(store.state, TUE)), []);
  assert.equal(waitingTasks(store.state, TUE)[0].task.id, w);
  assert.ok(ids(todaysTasks(store.state, THU)).includes(d), 'deferred returns on its resume date');
  assert.ok(ids(carriedTasks(store.state, '2026-12-06')).includes(d), 'and carries after it if still open');
});

test('explicit reschedule moves the due date with history and keeps the original date', async () => {
  const { store } = await makeStore({ date: MON });
  const id = await must(store.dispatch('addTask', { title: 'x', scheduledDate: MON }));
  await must(store.dispatch('rescheduleTask', { id, date: WED }));
  const t = store.state.tasks[0];
  assert.equal(t.scheduledDate, WED);
  assert.equal(t.originalScheduledDate, MON);
  assert.equal(t.scheduleHistory.length, 1);
  assert.deepEqual(ids(carriedTasks(store.state, TUE)), []);
  assert.ok(ids(todaysTasks(store.state, WED)).includes(id));
});

test('recurring routine checklists never accrue; actionable recurring carries only per policy', async () => {
  const { store } = await makeStore({ date: MON });
  const [routine, latest, all] = ['r-routine', 'r-latest', 'r-all'];
  withLegacy(store, (st) => st.recurringRules.push(
    rule(routine, 'בדיקת תיבה', { kind: 'dayType', dayType: 'workday', startDate: MON }, { routine: true, carryover: 'none' }),
    rule(latest, 'דוח יומי', { kind: 'dayType', dayType: 'workday', startDate: MON }),
    rule(all, 'מעקב', { kind: 'weekly', weekdays: [1, 2], startDate: MON }, { carryover: 'all' })));
  assert.equal(store.state.tasks.length, 0, 'no records materialized ahead of time');
  const carried = carriedTasks(store.state, THU);
  const byRule = (r) => carried.filter((x) => x.task.recurringRuleId === r);
  assert.equal(byRule(routine).length, 0, 'routine never carried');
  assert.equal(byRule(latest).length, 1, 'only the latest missed occurrence');
  assert.equal(byRule(latest)[0].task.occurrenceDate, WED);
  assert.deepEqual(byRule(all).map((x) => x.task.occurrenceDate), [MON, TUE].reverse().sort(), 'each missed occurrence (bounded)');
  // Completing a virtual carried occurrence materializes exactly one record and removes it.
  const key = byRule(latest)[0].task.id;
  await must(store.dispatch('toggleTaskDone', { id: key }));
  await store.dispatch('toggleTaskDone', { id: key });
  const recs = store.state.tasks.filter((t) => t.recurringRuleId === latest);
  assert.equal(recs.length, 1, 'one record per occurrence');
  assert.ok(todaysTasks(store.state, THU).some((t) => t.recurringRuleId === routine), 'routine shows on its day');
});

test('multiple missed days and a non-closed day still carry', async () => {
  const { store } = await makeStore({ date: MON });
  const a = await must(store.dispatch('addTask', { title: 'a', scheduledDate: MON }));
  const b = await must(store.dispatch('addTask', { title: 'b', scheduledDate: TUE }));
  const c = carriedTasks(store.state, '2026-12-07');
  assert.deepEqual(ids(c), [a, b], 'ordered by original date');
  assert.equal(store.state.dailyReports[MON], undefined);
});

test('stopping a legacy recurring task keeps earlier occurrences', async () => {
  const { store } = await makeStore({ date: MON });
  withLegacy(store, (st) => st.recurringRules.push(rule('r1', 'דוח', { kind: 'dayType', dayType: 'workday', startDate: MON })));
  await must(store.dispatch('toggleTaskDone', { id: `rr:r1@${MON}` }));
  await must(store.dispatch('archiveRecurringRule', { id: 'r1' }));
  assert.ok(!todaysTasks(store.state, THU).some((t) => t.recurringRuleId === 'r1'));
  assert.equal(store.state.tasks.filter((t) => t.recurringRuleId === 'r1').length, 1, 'completed occurrence kept');
});

test('priority sort: high→low and low→high, stable within a priority', () => {
  const t = (id, priority) => ({ id, priority });
  const list = [t('a', 'low'), t('b', 'high'), t('c', 'medium'), t('d', 'high')];
  assert.deepEqual(sortByPriority(list, 'high').map((x) => x.id), ['b', 'd', 'c', 'a']);
  assert.deepEqual(sortByPriority(list, 'low').map((x) => x.id), ['a', 'c', 'b', 'd']);
  assert.deepEqual(sortByPriority([{ task: t('x', 'low') }, { task: t('y', 'high') }]).map((x) => x.task.id), ['y', 'x'], 'carryover items');
});

test('task fields: description, priority, execution date, deadline, note; legacy fields survive edits', async () => {
  const { store } = await makeStore({ date: MON });
  const id = await must(store.dispatch('addTask', { title: 'משימה', priority: 'high', scheduledDate: MON, deadline: WED, details: 'הערה' }));
  withLegacy(store, (st) => { const x = st.tasks[0]; x.estimateMinutes = 30; x.subtasks = [{ id: 's', title: 'שלב', done: false }]; x.categoryId = 'admin'; });
  await must(store.dispatch('updateTask', { id, patch: { title: 'משימה חדשה', priority: 'low', deadline: null, details: '' } }));
  const x = store.state.tasks[0];
  assert.deepEqual([x.title, x.priority, x.deadline, x.details], ['משימה חדשה', 'low', null, '']);
  assert.equal(x.estimateMinutes, 30); assert.equal(x.subtasks.length, 1); assert.equal(x.categoryId, 'admin');
  await must(store.dispatch('toggleTaskDone', { id }));
  assert.equal(store.state.tasks[0].status, 'done', 'hidden subtasks never block completion');
});
