// Home rules: completing an important task frees its slot (undo restores both), earlier days
// keep their selection, and the greeting name is validated local data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeStore, must } from '../helpers.js';
import { validateState } from '../../js/data/validation.js';
import { headerFor } from '../../js/engine/header.js';

test('completing an important task removes it from today\'s selection; undo restores task and selection', async () => {
  const { store } = await makeStore({ date: '2026-11-30' });
  const a = await must(store.dispatch('addTask', { title: 'א', scheduledDate: '2026-11-30' }));
  const b = await must(store.dispatch('addTask', { title: 'ב', scheduledDate: '2026-11-30' }));
  store.state.dailyPriorities['2026-11-27'] = [a]; // an earlier day: history
  await must(store.dispatch('setPriorities', { date: '2026-11-30', ids: [a, b] }));
  await must(store.dispatch('setTaskStatus', { id: a, status: 'done' }));
  assert.deepEqual(store.state.dailyPriorities['2026-11-30'], [b], 'slot freed, no replacement chosen');
  assert.deepEqual(store.state.dailyPriorities['2026-11-27'], [a], 'past selection kept');
  const done = store.state.tasks.find((t) => t.id === a);
  assert.equal(done.status, 'done'); assert.equal(done.completedOn, '2026-11-30');
  assert.ok(await store.undo());
  assert.deepEqual(store.state.dailyPriorities['2026-11-30'], [a, b], 'undo restores the selection');
  assert.equal(store.state.tasks.find((t) => t.id === a).status, 'todo');
  await must(store.dispatch('setTaskStatus', { id: b, status: 'canceled' }));
  assert.deepEqual(store.state.dailyPriorities['2026-11-30'], [a]);
  await must(store.dispatch('setTaskStatus', { id: a, status: 'done' }));
  assert.equal(store.state.dailyPriorities['2026-11-30'], undefined, 'empty selection removed');
  assert.ok(validateState(store.state).ok);
});

test('greeting name: set, trimmed, bounded, removable, rejected when not text', async () => {
  const { store } = await makeStore({ date: '2026-11-30' });
  await must(store.dispatch('updateSettings', { patch: { displayName: '  נועה ' } }));
  assert.equal(store.state.settings.displayName, 'נועה');
  assert.equal(headerFor(store.state.settings, 480).greeting, 'בוקר טוב, נועה');
  await must(store.dispatch('updateSettings', { patch: { displayName: 'א'.repeat(80) } }));
  assert.equal(store.state.settings.displayName.length, 40);
  await must(store.dispatch('updateSettings', { patch: { displayName: '' } }));
  assert.equal(headerFor(store.state.settings, 480).greeting, 'בוקר טוב');
  assert.equal((await store.dispatch('updateSettings', { patch: { displayName: { x: 1 } } })).ok, false);
  const bad = structuredClone(store.state); bad.settings.displayName = 42;
  assert.equal(validateState(bad).ok, false, 'a crafted backup cannot store a non-text name');
});
