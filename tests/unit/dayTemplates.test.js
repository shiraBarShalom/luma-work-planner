import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshState, makeStore, must } from '../helpers.js';
import { effectiveDay, routineBlocks, closingWindow, nextWorkday } from '../../js/engine/dayTemplates.js';
import { dayOccurrences } from '../../js/engine/schedule.js';
import { effectiveTarget } from '../../js/engine/inquiries.js';
import { markUncached } from '../../js/engine/cache.js';

const SUN = '2026-11-29', THU = '2026-12-03', FRI = '2026-12-04', SAT = '2026-12-05';

test('defaults: Sun–Wed office, Thu home with same routine, Fri/Sat off', () => {
  const s = freshState();
  for (const d of ['2026-11-29', '2026-11-30', '2026-12-01', '2026-12-02']) {
    const e = effectiveDay(s, d);
    assert.equal(e.isWorking, true); assert.equal(e.location, 'office');
  }
  const thu = effectiveDay(s, THU);
  assert.equal(thu.isWorking, true); assert.equal(thu.location, 'home');
  const sunBlocks = routineBlocks(s, SUN).blocks.map((b) => [b.role, b.start, b.end]);
  const thuBlocks = routineBlocks(s, THU).blocks.map((b) => [b.role, b.start, b.end]);
  assert.deepEqual(thuBlocks, sunBlocks, 'Thursday keeps the same schedule');
  assert.equal(effectiveDay(s, FRI).isWorking, false);
  assert.equal(routineBlocks(s, SAT).blocks.length, 0);
});

test('phone duty 09:00–12:00 on all default workdays; opening inside coverage; inquiries from 09:15', () => {
  const s = freshState();
  for (const d of ['2026-11-29', '2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03']) {
    const e = effectiveDay(s, d);
    assert.equal(e.phoneDuty, true); assert.equal(e.phoneStart, '09:00'); assert.equal(e.phoneEnd, '12:00');
  }
  const b = Object.fromEntries(routineBlocks(s, SUN).blocks.map((x) => [x.role, x]));
  assert.deepEqual([b.opening.start, b.opening.end], ['09:00', '09:15']);
  assert.deepEqual([b.inquiries.start, b.inquiries.end], ['09:15', '12:00']);
  assert.deepEqual([b.closing.start, b.closing.end], ['16:00', '16:30']);
  assert.equal(b.break.protected, true);
  // Duty is a day-level window, not a duplicate blocking event.
  assert.ok(!dayOccurrences(s, SUN).some((o) => /תורנות/.test(o.title)));
});

test('no seeded meetings, target 10, editable closing via day hours', () => {
  const s = freshState();
  markUncached(s);
  assert.equal(s.meetings.length, 0);
  assert.equal(s.tasks.length, 0);
  assert.equal(effectiveTarget(s, SUN).target, 10);
  assert.equal(effectiveTarget(s, SAT).target, 0);
  s.dayOverrides[THU] = { workEnd: '14:00' };
  const cw = closingWindow(s, THU);
  assert.deepEqual(cw, { start: '13:30', end: '14:00' }, 'closing moves with the schedule');
  const rb = routineBlocks(s, THU);
  assert.ok(rb.suppressed.some((x) => x.role === 'email2'), 'blocks that no longer fit are reported');
  assert.ok(rb.blocks.every((x) => x.end <= '14:00'));
});

test('override precedence: settings < week override < day override; location and duty independent', () => {
  const s = freshState();
  markUncached(s); // this test mutates the document directly between reads
  s.weekOverrides[SUN] = { days: { 1: { location: 'home', phoneDuty: false } } };
  assert.equal(effectiveDay(s, '2026-11-30').location, 'home');
  assert.equal(effectiveDay(s, '2026-11-30').phoneDuty, false);
  s.dayOverrides['2026-11-30'] = { location: 'office' };
  const e = effectiveDay(s, '2026-11-30');
  assert.equal(e.location, 'office');
  assert.equal(e.phoneDuty, false, 'duty from week override kept');
  s.dayOverrides['2026-12-01'] = { isWorking: false, label: 'חופשה' };
  assert.equal(effectiveDay(s, '2026-12-01').isWorking, false);
  assert.equal(nextWorkday(s, '2026-11-30'), '2026-12-02', 'time off skipped');
  assert.equal(nextWorkday(s, THU), '2026-12-06', 'weekend skipped');
});

test('template change for future does not rewrite past days', async () => {
  const { store, clock } = await makeStore({ date: '2026-12-01' });
  const before = routineBlocks(store.state, '2026-11-30').blocks.find((b) => b.role === 'email2');
  const occ = routineBlocks(store.state, '2026-12-01').blocks.find((b) => b.role === 'email2');
  await must(store.dispatch('updateOccurrence', { occId: occ.id, changes: { start: '15:30', end: '15:50' }, scope: 'future' }));
  assert.equal(routineBlocks(store.state, '2026-11-30').blocks.find((b) => b.role === 'email2').end, before.end);
  assert.equal(routineBlocks(store.state, '2026-12-01').blocks.find((b) => b.role === 'email2').end, '15:50');
  assert.equal(routineBlocks(store.state, '2026-12-08').blocks.find((b) => b.role === 'email2').end, '15:50');
  // Retroactive template edits are rejected.
  const past = routineBlocks(store.state, '2026-11-30').blocks.find((b) => b.role === 'email2');
  const r = await store.dispatch('updateOccurrence', { occId: past.id, changes: { end: '15:45' }, scope: 'future', confirm: true });
  assert.equal(r.ok, false);
  clock.set('2026-12-01');
});

test('closing window and default target are editable configuration', async () => {
  const { store } = await makeStore({ date: '2026-11-30' });
  await must(store.dispatch('setWorkWindows', { workHours: { start: '08:30', end: '17:00' } }));
  assert.deepEqual(closingWindow(store.state, '2026-12-01'), { start: '16:30', end: '17:00' });
  await must(store.dispatch('setDefaultTarget', { target: 12 }));
  assert.equal(effectiveTarget(store.state, '2026-11-30').target, 12);
  assert.equal(effectiveTarget(store.state, '2026-11-29').target, 10, 'yesterday keeps its historical target');
});
