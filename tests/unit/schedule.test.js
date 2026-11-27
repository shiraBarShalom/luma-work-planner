// Fixed weekly schedule, recurring-activity protection, overlaps and activity editing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeStore, must } from '../helpers.js';
import { v1Document } from '../fixtures.js';
import { dayOccurrences, currentAndNext, findOccurrence, recurringSignature } from '../../js/engine/schedule.js';
import { matchesRecurrence } from '../../js/engine/recurrence.js';
import { headerFor } from '../../js/engine/header.js';
import { migrateState } from '../../js/data/migrations.js';
import { createMemoryAdapter } from '../../js/db.js';
import { WEEKLY_SCHEDULE } from '../../js/seed.js';
import { addDays } from '../../js/dates.js';
import { COMMANDS } from '../../js/commands.js';

const EXPECTED = [
  ['08:45', '09:00', 'פתיחת יום'], ['09:00', '13:00', 'מענה לטלפונים ולפניות ב-CRM'], ['13:00', '14:00', 'הפסקה'],
  ['14:00', '14:15', 'זמן קבלה לשאלות של הצוות'], ['14:15', '14:30', 'חזרה טלפונית לפונים'], ['14:30', '15:45', 'טיפול במיילים'],
  ['15:45', '16:15', 'הקצאת פניות לצוות למחר'], ['16:15', '16:30', 'סגירת יום'],
];
const shape = (state, d) => dayOccurrences(state, d).map((o) => [o.start, o.end, o.title]);
const SUN = '2026-11-29', MON = '2026-11-30', FRI = '2026-12-04', SAT = '2026-12-05';

test('all eight recurring activities appear Sunday-Thursday, none on Friday/Saturday', async () => {
  const { store } = await makeStore({ date: SUN });
  for (let i = 0; i < 5; i++) assert.deepEqual(shape(store.state, addDays(SUN, i)), EXPECTED, addDays(SUN, i));
  assert.deepEqual(shape(store.state, FRI), []);
  assert.deepEqual(shape(store.state, SAT), []);
  assert.equal(dayOccurrences(store.state, MON)[0].notes, 'בלי מייל. בחירת שלושה דברים שחייבים להיגמר היום.');
  assert.equal(dayOccurrences(store.state, MON)[7].notes, 'רשימת מה שנשאר פתוח.');
  assert.ok(dayOccurrences(store.state, MON).every((o) => o.recurring && o.kind === 'series'));
});

test('the schedule continues across months and years without materializing records', async () => {
  const { store } = await makeStore({ date: SUN });
  assert.deepEqual(shape(store.state, '2027-01-03'), EXPECTED, 'Sunday in a new year');
  assert.deepEqual(shape(store.state, '2028-02-29'), EXPECTED, 'leap day (Tuesday)');
  assert.deepEqual(shape(store.state, '2030-06-07'), [], 'Friday years later');
  assert.equal(store.state.calendarBlocks.length, WEEKLY_SCHEDULE.length, 'eight series, not one record per day');
});

test('repeated startup never duplicates the schedule', async () => {
  const adapter = createMemoryAdapter();
  const { store } = await makeStore({ date: SUN, adapter });
  const n = store.state.calendarBlocks.length;
  for (let i = 0; i < 3; i++) {
    const { store: again } = await makeStore({ date: addDays(SUN, i), adapter });
    assert.equal(again.state.calendarBlocks.length, n);
    assert.deepEqual(shape(again.state, MON), EXPECTED);
  }
});

test('existing v1 installations receive the schedule without losing data; migration is idempotent', () => {
  const { state, migrated } = migrateState(v1Document(), { today: '2026-11-27', nowIso: '2026-11-27T08:00:00.000Z' });
  assert.ok(migrated);
  assert.equal(state.metadata.schemaVersion, 2);
  const past = dayOccurrences(state, '2026-11-24');
  assert.deepEqual([past[0].title, past[0].start, past[0].status], ['פתיחת יום', '09:00', 'done'], 'past days keep legacy routine and its record');
  assert.deepEqual(shape(state, SUN), EXPECTED, 'from the migration date on: the new schedule only');
  assert.deepEqual(shape(state, '2026-12-01').find(([, , t]) => t === 'ישיבת צוות לדוגמה'), ['10:30', '11:00', 'ישיבת צוות לדוגמה'], 'timed meeting became an activity');
  assert.equal(state.inquiryCounts['2026-11-24'], 4, 'count derived from completed events only (3 + 2 − 1)');
  assert.equal(state.inquiryLogs.length, 4, 'legacy events kept');
  assert.equal(state.questions.length, 1);
  assert.equal(state.meetings.length, 2);
  assert.equal(state.meetings[0].migratedToBlockId, 'meeting-m1');
  assert.equal(state.workNotes.length, 1);
  assert.ok(state.dailyReports['2026-11-24']);
  assert.equal(state.dayNotes['2026-11-24'].accomplishments, 'הישג');
  assert.equal(state.tasks[0].assignedBlock, 'meeting-m1', 'task link follows the meeting');
  assert.equal(state.tasks[0].subtasks.length, 1, 'subtasks preserved');
  assert.equal(state.tasks[0].estimateMinutes, 45);
  const again = migrateState({ ...structuredClone(state), metadata: { ...state.metadata, schemaVersion: 1 } }, { today: '2026-12-10', nowIso: '2026-12-10T08:00:00.000Z' }).state;
  assert.equal(again.calendarBlocks.length, state.calendarBlocks.length, 're-running adds nothing');
  assert.equal(again.settings.routineEndsOn, state.settings.routineEndsOn);
});

test('migration on a workday with routine records starts the new schedule the next day', () => {
  const { state } = migrateState(v1Document(), { today: '2026-11-24', nowIso: '2026-11-24T12:00:00.000Z' });
  assert.equal(state.settings.routineEndsOn, '2026-11-25');
  assert.equal(dayOccurrences(state, '2026-11-24')[0].status, 'done');
  assert.deepEqual(shape(state, '2026-11-25'), EXPECTED);
});

test('overlapping manual activities are allowed and keep their own times and completion', async () => {
  const { store } = await makeStore({ date: MON, minute: 10 * 60 + 15 });
  const id = await must(store.dispatch('addBlock', { date: MON, start: '10:00', end: '11:00', title: 'ישיבת צוות' }));
  const occs = dayOccurrences(store.state, MON);
  const phones = occs.find((o) => o.title.startsWith('מענה'));
  const meeting = occs.find((o) => o.id === id);
  assert.deepEqual([phones.start, phones.end, meeting.start, meeting.end], ['09:00', '13:00', '10:00', '11:00']);
  assert.ok(phones.conflicts.includes(id) && meeting.conflicts.includes(phones.id), 'laid out side by side');
  const cn = currentAndNext(store.state, MON, 10 * 60 + 15);
  assert.deepEqual(cn.all.map((o) => o.title), ['מענה לטלפונים ולפניות ב-CRM', 'ישיבת צוות'], 'home shows both current activities');
  await must(store.dispatch('setBlockStatus', { occId: id, status: 'done' }));
  assert.equal(findOccurrence(store.state, id).status, 'done');
  assert.equal(findOccurrence(store.state, phones.id).status, 'planned', 'completing one does not complete the other');
});

test('recurring activities change only through explicit manual edits (this time / from now on)', async () => {
  const { store } = await makeStore({ date: SUN });
  const occ = `default-email@${MON}`;
  await must(store.dispatch('updateOccurrence', { occId: occ, changes: { start: '14:45' }, scope: 'this' }));
  assert.equal(findOccurrence(store.state, occ).start, '14:45');
  assert.equal(findOccurrence(store.state, 'default-email@2026-12-01').start, '14:30', 'other days unchanged');
  await must(store.dispatch('updateOccurrence', { occId: 'default-email@2026-12-02', changes: { title: 'מיילים' }, scope: 'future' }));
  assert.equal(findOccurrence(store.state, 'default-email@2026-12-01').title, 'טיפול במיילים', 'earlier days keep the old title');
  assert.equal(dayOccurrences(store.state, '2026-12-02').find((o) => o.start === '14:30').title, 'מיילים');
  assert.equal(dayOccurrences(store.state, '2026-12-09').find((o) => o.start === '14:30').title, 'מיילים');
  const r = await must(store.dispatch('updateOccurrence', { occId: 'default-closing@2026-12-01', changes: { date: FRI }, scope: 'this' }));
  assert.ok(!dayOccurrences(store.state, '2026-12-01').some((o) => o.title === 'סגירת יום'), 'no duplicate on the source day');
  assert.equal(dayOccurrences(store.state, FRI).filter((o) => o.id === r).length, 1);
});

test('recurrence options: daily, every workday, weekly, custom; stop repeating; one-off to repeating', async () => {
  const { store } = await makeStore({ date: MON });
  const daily = await must(store.dispatch('addBlock', { date: MON, start: '07:00', end: '07:30', title: 'יומי', recurrence: { kind: 'daily', interval: 1 } }));
  await must(store.dispatch('addBlock', { date: MON, start: '07:30', end: '08:00', title: 'ימי עבודה', recurrence: { kind: 'dayType', dayType: 'workday' } }));
  await must(store.dispatch('addBlock', { date: MON, start: '17:00', end: '17:30', title: 'שבועי', recurrence: { kind: 'weekly', weekdays: [1] } }));
  const has = (d, t) => dayOccurrences(store.state, d).some((o) => o.title === t);
  assert.ok(has(SAT, 'יומי') && !has(SAT, 'ימי עבודה') && has('2026-12-01', 'ימי עבודה') && has('2026-12-07', 'שבועי') && !has('2026-12-01', 'שבועי'));
  await must(store.dispatch('updateOccurrence', { occId: daily.replace(MON, '2026-12-02'), changes: {}, recurrence: null, scope: 'future' }));
  assert.ok(has(MON, 'יומי') && has('2026-12-01', 'יומי') && has('2026-12-02', 'יומי') && !has('2026-12-03', 'יומי'));
  assert.equal(store.state.calendarBlocks.filter((b) => b.title === 'יומי').length, 2);
  const one = await must(store.dispatch('addBlock', { date: MON, start: '18:00', end: '18:30', title: 'חד פעמי' }));
  await must(store.dispatch('updateOccurrence', { occId: one, changes: {}, recurrence: { kind: 'weekly', weekdays: [1, 3] } }));
  assert.ok(has('2026-12-02', 'חד פעמי') && has('2026-12-07', 'חד פעמי'));
  const before = JSON.stringify(store.state);
  assert.equal((await store.dispatch('addBlock', { date: MON, start: '10:00', end: '09:00', title: 'x' })).ok, false);
  assert.equal(JSON.stringify(store.state), before, 'rejected command changes nothing');
});

test('automated commands can never change recurring activities (store-level protection)', async () => {
  const { store } = await makeStore({ date: SUN });
  const before = recurringSignature(store.state);
  const evil = {
    __move: (d) => { d.calendarBlocks.find((b) => b.id === 'default-phones').start = '10:00'; },
    __exclude: (d) => { d.occurrenceOverrides[`default-break@${MON}`] = { excluded: true }; },
    __remove: (d) => { d.calendarBlocks = d.calendarBlocks.filter((b) => b.id !== 'default-closing'); },
    __rule: (d) => { d.calendarBlocks.find((b) => b.id === 'default-team').recurrence.weekdays = [0]; },
  };
  for (const [n, run] of Object.entries(evil)) COMMANDS[n] = { label: 'test', automated: true, run };
  try {
    for (const n of Object.keys(evil)) {
      const r = await store.dispatch(n, {});
      assert.equal(r.ok, false, n);
      assert.equal(r.code, 'protected', n);
    }
    assert.equal(recurringSignature(store.state), before, 'nothing changed');
    await must(store.dispatch('updateOccurrence', { occId: `default-phones@${MON}`, changes: { end: '12:30' }, scope: 'this' }));
    assert.notEqual(recurringSignature(store.state), before, 'manual edits are allowed');
  } finally { for (const n of Object.keys(evil)) delete COMMANDS[n]; }
});

test('deleting this occurrence excludes only it; from now on ends the series and keeps history', async () => {
  const { store } = await makeStore({ date: SUN });
  await must(store.dispatch('setBlockStatus', { occId: `default-team@${SUN}`, status: 'done' }));
  await must(store.dispatch('deleteOccurrence', { occId: `default-team@${MON}`, scope: 'this' }));
  assert.ok(!dayOccurrences(store.state, MON).some((o) => o.sourceId === 'default-team'));
  assert.ok(dayOccurrences(store.state, '2026-12-01').some((o) => o.sourceId === 'default-team'));
  await must(store.dispatch('deleteOccurrence', { occId: 'default-team@2026-12-02', scope: 'future' }));
  assert.ok(dayOccurrences(store.state, '2026-12-01').some((o) => o.sourceId === 'default-team'));
  assert.ok(!dayOccurrences(store.state, '2026-12-03').some((o) => o.sourceId === 'default-team'));
  assert.equal(store.state.blockCompletions[`default-team@${SUN}`].status, 'done', 'completion history kept');
});

test('activity completion states: done, partial, skipped, canceled; planned again', async () => {
  const { store } = await makeStore({ date: MON });
  const occ = `default-opening@${MON}`;
  for (const s of ['done', 'partial', 'skipped', 'canceled', 'planned']) {
    await must(store.dispatch('setBlockStatus', { occId: occ, status: s }));
    assert.equal(findOccurrence(store.state, occ).status, s);
  }
  assert.equal(store.state.blockCompletions[occ], undefined);
  assert.equal((await store.dispatch('setBlockStatus', { occId: occ, status: 'weird' })).ok, false);
});

test('current/next: now, next, done, none', async () => {
  const { store } = await makeStore({ date: MON });
  assert.equal(currentAndNext(store.state, MON, 8 * 60).phase, 'next');
  assert.equal(currentAndNext(store.state, MON, 8 * 60).next.title, 'פתיחת יום');
  const now = currentAndNext(store.state, MON, 9 * 60 + 30);
  assert.equal(now.phase, 'now'); assert.equal(now.remaining, 210); assert.equal(now.next.title, 'הפסקה');
  assert.equal(currentAndNext(store.state, MON, 17 * 60).phase, 'done');
  assert.equal(currentAndNext(store.state, FRI, 10 * 60).phase, 'none');
});

test('recurrence matcher kinds incl. monthly overflow and every N weeks', () => {
  const info = () => ({ isWorking: true });
  assert.ok(matchesRecurrence({ kind: 'monthly', monthDay: 31, monthOverflow: 'lastDay', startDate: '2026-01-01' }, '2026-02-28', info));
  assert.ok(!matchesRecurrence({ kind: 'monthly', monthDay: 31, startDate: '2026-01-01' }, '2026-02-28', info));
  assert.ok(matchesRecurrence({ kind: 'weekly', interval: 2, weekdays: [1], startDate: MON }, '2026-12-14', info));
  assert.ok(!matchesRecurrence({ kind: 'weekly', interval: 2, weekdays: [1], startDate: MON }, '2026-12-07', info));
});

test('header banner boundaries (start-inclusive, end-exclusive, overnight wrap)', async () => {
  const { store } = await makeStore();
  const st = store.state.settings;
  assert.equal(headerFor(st, 4 * 60 + 59).image, 'night');
  assert.equal(headerFor(st, 5 * 60).image, 'dawn');
  assert.equal(headerFor(st, 12 * 60).greeting, 'צהריים טובים, כרמית');
  assert.equal(headerFor(st, 0).image, 'night');
});
