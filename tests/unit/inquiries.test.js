// Simple daily inquiry counter: +1, −1 (never below zero), reset, persistence, rollover.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeStore, must, fakeClock, testUid } from '../helpers.js';
import { createStore } from '../../js/store.js';
import { createMemoryAdapter } from '../../js/db.js';
import { countFor, counterTarget, counterProgress, defaultTargetAt, counterHistory } from '../../js/engine/inquiries.js';

const MON = '2026-11-30', TUE = '2026-12-01';

test('increment, decrement, over-target; no record per tap', async () => {
  const { store } = await makeStore({ date: MON });
  for (let i = 0; i < 12; i++) await must(store.dispatch('changeCount', { date: MON, delta: 1 }));
  assert.equal(countFor(store.state, MON), 12, 'counts beyond the target are allowed');
  assert.equal(counterTarget(store.state, MON), 10);
  assert.equal(counterProgress(12, 10), 1);
  assert.deepEqual(Object.keys(store.state.inquiryCounts), [MON], 'one number per date, not one record per tap');
  assert.equal(store.state.inquiryLogs.length, 0);
  await must(store.dispatch('changeCount', { date: MON, delta: -1 }));
  assert.equal(countFor(store.state, MON), 11);
});

test('the count can never become negative', async () => {
  const { store } = await makeStore({ date: MON });
  await must(store.dispatch('changeCount', { date: MON, delta: 1 }));
  await must(store.dispatch('changeCount', { date: MON, delta: -1 }));
  const r = await store.dispatch('changeCount', { date: MON, delta: -1 });
  assert.equal(r.ok, false);
  assert.equal(countFor(store.state, MON), 0);
  assert.equal((await store.dispatch('changeCount', { date: MON, delta: 5 })).ok, false, 'only ±1');
  // A corrupted negative value is rejected by validation.
  const bad = structuredClone(store.state); bad.inquiryCounts[MON] = -2;
  const { validateState } = await import('../../js/data/validation.js');
  assert.equal(validateState(bad).ok, false);
});

test('reset sets the current date to zero and leaves other dates', async () => {
  const { store } = await makeStore({ date: MON });
  await must(store.dispatch('changeCount', { date: MON, delta: 1 }));
  await must(store.dispatch('changeCount', { date: TUE, delta: 1 }));
  await must(store.dispatch('resetCount', { date: TUE }));
  assert.equal(countFor(store.state, TUE), 0);
  assert.equal(countFor(store.state, MON), 1);
});

test('persists across restart; a new local date starts at zero (daily rollover)', async () => {
  const adapter = createMemoryAdapter();
  const { store } = await makeStore({ date: MON, adapter });
  const r = await store.dispatch('changeCount', { date: MON, delta: 1 });
  assert.equal(await r.saved, true, 'persisted immediately');
  const clock = fakeClock(TUE);
  const s2 = createStore({ adapter, now: clock.now, uid: testUid });
  await s2.init();
  assert.equal(countFor(s2.state, MON), 1);
  assert.equal(countFor(s2.state, TUE), 0);
});

test('target: default 10, changes apply from today, earlier days keep theirs', async () => {
  const { store, clock } = await makeStore({ date: MON });
  assert.equal(defaultTargetAt(store.state, MON), 10);
  clock.set(TUE);
  await must(store.dispatch('setDefaultTarget', { target: 12 }));
  assert.equal(counterTarget(store.state, TUE), 12);
  assert.equal(counterTarget(store.state, MON), 10, 'history preserved');
  assert.equal((await store.dispatch('setDefaultTarget', { target: -1 })).ok, false);
  assert.equal(counterProgress(0, 0), 0, 'zero target never divides by zero');
});

test('daily rollover keeps each final count; closed for days; manual reset only today; history and total', async () => {
  const { store, clock } = await makeStore({ date: '2026-11-29' });
  const plus = async (d, n) => { for (let i = 0; i < n; i++) await must(store.dispatch('changeCount', { date: d, delta: 1 })); };
  await plus('2026-11-29', 7);
  clock.set('2026-11-30');
  assert.equal(countFor(store.state, '2026-11-30'), 0, 'new day starts at zero');
  assert.equal(countFor(store.state, '2026-11-29'), 7, 'previous final count kept');
  await plus('2026-11-30', 12);
  // App closed for several days: no job ran; the next open starts the day at zero.
  clock.set('2026-12-06');
  const rev = store.state.metadata.revision;
  assert.equal(countFor(store.state, '2026-12-06'), 0);
  countFor(store.state, '2026-12-06'); counterHistory(store.state, '2026-12-06');
  assert.equal(store.state.metadata.revision, rev, 'reading never writes: nothing can reset twice');
  await plus('2026-12-06', 2);
  await must(store.dispatch('resetCount', { date: '2026-12-06' }));
  assert.equal(countFor(store.state, '2026-12-06'), 0);
  assert.deepEqual([countFor(store.state, '2026-11-29'), countFor(store.state, '2026-11-30')], [7, 12], 'manual reset leaves earlier days');
  await plus('2026-12-06', 3);
  const h = counterHistory(store.state, '2026-12-06');
  assert.equal(h.total, 22);
  assert.deepEqual(h.days, [{ date: '2026-12-06', count: 3 }, { date: '2026-11-30', count: 12 }, { date: '2026-11-29', count: 7 }]);
});
