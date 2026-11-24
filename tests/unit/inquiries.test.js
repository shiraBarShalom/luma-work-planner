import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeStore, must } from '../helpers.js';
import { dayTotals, effectiveTarget, periodSummary, weekRange, monthRange, pct } from '../../js/engine/inquiries.js';

const MON = '2026-11-30';

test('batch increments, over-target, category totals, dispositions not counted as completed', async () => {
  const { store } = await makeStore({ date: MON });
  await must(store.dispatch('addInquiry', { date: MON }));
  await must(store.dispatch('addInquiry', { date: MON, quantity: 9, category: 'simple' }));
  await must(store.dispatch('addInquiry', { date: MON, quantity: 2, category: 'complex' }));
  await must(store.dispatch('addInquiry', { date: MON, kind: 'allocatedTomorrow', quantity: 4 }));
  await must(store.dispatch('addInquiry', { date: MON, kind: 'transferred', quantity: 1 }));
  const t = dayTotals(store.state, MON);
  assert.equal(t.completed, 12, 'counts beyond 10 allowed');
  assert.equal(t.byCategory.completed.simple, 9);
  assert.equal(t.byCategory.completed.complex, 2);
  assert.equal(t.byCategory.completed.unspecified, 1);
  assert.equal(t.allocatedTomorrow, 4);
  assert.equal(t.transferred, 1);
  assert.equal(pct(t.completed, effectiveTarget(store.state, MON).target), 120);
});

test('undo/correction never goes negative and references the original event', async () => {
  const { store } = await makeStore({ date: MON });
  const id = await must(store.dispatch('addInquiry', { date: MON, quantity: 2 }));
  await must(store.dispatch('undoInquiry', { date: MON }));
  assert.equal(dayTotals(store.state, MON).completed, 1);
  const corr = store.state.inquiryLogs.at(-1);
  assert.equal(corr.correctsId, id); assert.equal(corr.quantity, -1);
  await must(store.dispatch('undoInquiry', { date: MON }));
  assert.equal(dayTotals(store.state, MON).completed, 0);
  const r = await store.dispatch('undoInquiry', { date: MON });
  assert.equal(r.ok, false);
  assert.equal(dayTotals(store.state, MON).completed, 0);
  const r2 = await store.dispatch('correctInquiry', { eventId: id, quantity: 1 });
  assert.equal(r2.ok, false, 'cannot correct beyond remaining');
  assert.equal(store.state.inquiryLogs.length, 3, 'events are append-only');
});

test('historic targets stable; zero/off-day target; weekly/monthly sums of daily targets', async () => {
  const { store, clock } = await makeStore({ date: MON });
  await must(store.dispatch('addInquiry', { date: MON, quantity: 10 }));
  clock.set('2026-12-01');
  await must(store.dispatch('setDefaultTarget', { target: 8 }));
  assert.equal(effectiveTarget(store.state, MON).target, 10);
  assert.equal(effectiveTarget(store.state, '2026-12-01').target, 8);
  assert.equal(effectiveTarget(store.state, '2026-12-04').target, 0, 'Friday off');
  await must(store.dispatch('setDayOverride', { date: '2026-12-02', patch: { inquiryTarget: 0 } }));
  const [ws, we] = weekRange(MON);
  const w = periodSummary(store.state, ws, we, '2026-12-01');
  // Sun 10 + Mon 10 + Tue 8 + Wed 0 + Thu 8 = 36; elapsed (to Tue) = 28
  assert.equal(w.targetFull, 36);
  assert.equal(w.targetElapsed, 28);
  assert.equal(w.completed, 10);
  assert.equal(pct(0, 0), null, 'no divide by zero');
  const [ms, me] = monthRange('2026-12-15');
  const m = periodSummary(store.state, ms, me, '2026-12-15');
  assert.ok(m.targetFull > 0 && m.workdays === 23);
});

test('closed-day snapshot preserves target even if defaults change later', async () => {
  const { store, clock } = await makeStore({ date: MON, minute: 16 * 60 + 10 });
  await must(store.dispatch('closeDay', { date: MON, checklist: { allocate: true, 'open-work': true, accomplished: true } }));
  assert.equal(store.state.dailyReports[MON].snapshot.target, 10);
  clock.set(MON);
  await must(store.dispatch('setDefaultTarget', { target: 15 }));
  assert.equal(effectiveTarget(store.state, MON).target, 10, 'snapshot wins over a later same-day default change');
  assert.equal(effectiveTarget(store.state, '2026-12-01').target, 15);
});
