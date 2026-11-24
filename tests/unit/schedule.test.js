import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeStore, must } from '../helpers.js';
import { dayOccurrences, currentAndNext, findOccurrence } from '../../js/engine/schedule.js';
import { matchesRecurrence } from '../../js/engine/recurrence.js';
import { headerFor, minutesToNextBoundary, headerRuleErrors } from '../../js/engine/header.js';
import { defaultSettings } from '../../js/seed.js';

const MON = '2026-11-30', TUE = '2026-12-01';
const occ = (s, d, role) => dayOccurrences(s, d).find((o) => o.role === role);

test('moving a generated occurrence to another day leaves no duplicate and keeps completion/tasks', async () => {
  const { store } = await makeStore({ date: MON });
  const src = occ(store.state, MON, 'email2');
  await must(store.dispatch('setBlockStatus', { occId: src.id, status: 'partial', actualMinutes: 10 }));
  const tid = await must(store.dispatch('addTask', { title: 'מייל', scheduledDate: MON }));
  await must(store.dispatch('assignTaskToBlock', { taskId: tid, occId: src.id }));
  // Destination has the analogous routine block → explicit confirmation required.
  const r = await store.dispatch('updateOccurrence', { occId: src.id, changes: { date: TUE, start: '17:00', end: '17:30' } });
  assert.ok(r.confirm.some((c) => c.code === 'analogous'));
  const nid = await must(store.dispatch('updateOccurrence', { occId: src.id, changes: { date: TUE, start: '16:30', end: '17:00' }, confirm: true }));
  assert.ok(!dayOccurrences(store.state, MON).some((o) => o.role === 'email2'), 'source excluded');
  const moved = dayOccurrences(store.state, TUE).filter((o) => o.role === 'email2');
  assert.equal(moved.length, 2, 'destination routine + the moved one (conflict presented, not merged)');
  const m = findOccurrence(store.state, nid);
  assert.equal(m.status, 'partial'); assert.equal(m.actualMinutes, 10);
  assert.deepEqual(m.taskIds, [tid]);
  assert.equal(store.state.tasks[0].scheduledDate, TUE);
});

test('drag within day overrides the occurrence; overlap with protected break needs confirmation', async () => {
  const { store } = await makeStore({ date: MON });
  const o = occ(store.state, MON, 'email1');
  const r = await store.dispatch('updateOccurrence', { occId: o.id, changes: { start: '12:30', end: '13:30' } });
  assert.ok(r.confirm.some((c) => c.code === 'protectedOverlap'));
  await must(store.dispatch('updateOccurrence', { occId: o.id, changes: { start: '12:00', end: '12:45' } }));
  assert.equal(occ(store.state, MON, 'email1').end, '12:45');
  assert.equal(occ(store.state, TUE, 'email1').end, '13:00', 'other days untouched');
  const bad = await store.dispatch('updateOccurrence', { occId: o.id, changes: { start: '12:45', end: '12:30' } });
  assert.equal(bad.ok, false, 'end must be after start');
});

test('week scope and series edit scopes', async () => {
  const { store } = await makeStore({ date: MON });
  const o = occ(store.state, MON, 'teamReception');
  await must(store.dispatch('updateOccurrence', { occId: o.id, changes: { title: 'קבלת צוות' }, scope: 'week' }));
  assert.equal(occ(store.state, '2026-12-02', 'teamReception').title, 'קבלת צוות');
  assert.notEqual(occ(store.state, '2026-11-29', 'teamReception').title, 'קבלת צוות', 'earlier days in week unaffected');
  assert.notEqual(occ(store.state, '2026-12-07', 'teamReception').title, 'קבלת צוות');
  const sid = await must(store.dispatch('addBlock', { date: MON, start: '07:30', end: '08:00', title: 'סדרה', recurrence: { kind: 'weekly', weekdays: [1] }, confirm: true }));
  const later = dayOccurrences(store.state, '2026-12-14').find((x) => x.title === 'סדרה');
  await must(store.dispatch('updateOccurrence', { occId: later.id, changes: { title: 'סדרה חדשה' }, scope: 'future', confirm: true }));
  assert.ok(dayOccurrences(store.state, '2026-12-07').some((x) => x.title === 'סדרה'));
  assert.ok(dayOccurrences(store.state, '2026-12-21').some((x) => x.title === 'סדרה חדשה'));
  assert.ok(sid);
});

test('split keeps tasks, merge reassigns them; delete this occurrence excludes only it', async () => {
  const { store } = await makeStore({ date: MON });
  const f = occ(store.state, MON, 'followup');
  const t1 = await must(store.dispatch('addTask', { title: 'a', scheduledDate: MON }));
  await must(store.dispatch('assignTaskToBlock', { taskId: t1, occId: f.id }));
  const second = await must(store.dispatch('splitOccurrence', { occId: f.id, at: '15:00' }));
  assert.equal(occ(store.state, MON, 'followup').end, '15:00');
  assert.equal(store.state.tasks[0].assignedBlock, f.id, 'never drops references');
  const t2 = await must(store.dispatch('addTask', { title: 'b', scheduledDate: MON }));
  await must(store.dispatch('assignTaskToBlock', { taskId: t2, occId: second }));
  await must(store.dispatch('mergeWithNext', { occId: f.id }));
  assert.equal(occ(store.state, MON, 'followup').end, '15:30');
  assert.equal(store.state.tasks.find((t) => t.id === t2).assignedBlock, f.id);
  await must(store.dispatch('deleteOccurrence', { occId: occ(store.state, MON, 'email2').id }));
  assert.ok(!occ(store.state, MON, 'email2'));
  assert.ok(occ(store.state, TUE, 'email2'));
});

test('block completion is distinct from task completion', async () => {
  const { store } = await makeStore({ date: MON });
  const o = occ(store.state, MON, 'inquiries');
  const t = await must(store.dispatch('addTask', { title: 'a', scheduledDate: MON }));
  await must(store.dispatch('assignTaskToBlock', { taskId: t, occId: o.id }));
  await must(store.dispatch('setBlockStatus', { occId: o.id, status: 'done' }));
  assert.equal(store.state.tasks[0].status, 'todo');
});

test('current/next derived honestly: before, gap, overrun-free, after', async () => {
  const { store } = await makeStore({ date: MON });
  assert.equal(currentAndNext(store.state, MON, 8 * 60).phase, 'before');
  const c = currentAndNext(store.state, MON, 10 * 60);
  assert.equal(c.current.role, 'inquiries'); assert.equal(c.remaining, 120); assert.equal(c.next.role, 'email1');
  await must(store.dispatch('deleteOccurrence', { occId: occ(store.state, MON, 'email1').id }));
  assert.equal(currentAndNext(store.state, MON, 12 * 60 + 10).phase, 'gap');
  assert.equal(currentAndNext(store.state, MON, 17 * 60).phase, 'after');
  assert.equal(currentAndNext(store.state, '2026-12-05', 600).phase, 'off');
});

test('recurrence kinds incl. monthly overflow and every N weeks', () => {
  const info = () => ({ isWorking: true, location: 'office', phoneDuty: true });
  const m = { kind: 'monthly', monthDay: 31, startDate: '2026-01-01' };
  assert.ok(!matchesRecurrence(m, '2026-02-28', info));
  assert.ok(matchesRecurrence({ ...m, monthOverflow: 'lastDay' }, '2026-02-28', info));
  assert.ok(matchesRecurrence({ ...m, monthOverflow: 'lastDay' }, '2028-02-29', info));
  const w = { kind: 'weekly', weekdays: [0], interval: 2, startDate: '2026-11-29' };
  assert.ok(matchesRecurrence(w, '2026-11-29', info));
  assert.ok(!matchesRecurrence(w, '2026-12-06', info));
  assert.ok(matchesRecurrence(w, '2026-12-13', info));
  assert.ok(!matchesRecurrence({ ...w, endDate: '2026-12-12' }, '2026-12-13', info));
  assert.ok(!matchesRecurrence({ ...w, exceptions: ['2026-12-13'] }, '2026-12-13', info));
  assert.ok(matchesRecurrence({ kind: 'daily', interval: 3, startDate: '2026-01-01' }, '2026-01-07', info));
});

test('header banner boundaries (start-inclusive, end-exclusive, overnight wrap)', () => {
  const s = defaultSettings();
  const at = (h, m = 0) => headerFor(s, h * 60 + m);
  assert.equal(at(4, 59).image, 'night');
  assert.equal(at(5).image, 'dawn');
  assert.equal(at(7, 59).image, 'dawn');
  assert.equal(at(8).image, 'day');
  assert.equal(at(8).greeting, 'בוקר טוב, כרמית');
  assert.equal(at(12).greeting, 'צהריים טובים, כרמית');
  assert.equal(at(16, 59).image, 'day');
  assert.equal(at(17).image, 'sunset');
  assert.equal(at(20).image, 'night');
  assert.equal(at(0).image, 'night');
  assert.equal(at(0).greeting, 'לילה טוב, כרמית');
  assert.equal(minutesToNextBoundary(s, 7 * 60 + 50), 10);
  assert.equal(minutesToNextBoundary(s, 23 * 60), 6 * 60);
  assert.deepEqual(headerRuleErrors(s.header.rules), []);
  assert.ok(headerRuleErrors([{ from: '05:00', to: '08:00', image: 'dawn', greeting: 'x' }]).length);
  assert.equal(headerFor({ ...s, header: { ...s.header, useAlternateDawn: true } }, 6 * 60).image, 'dawnAlternate');
});
