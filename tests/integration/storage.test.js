import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeStore, must, fakeClock, testUid } from '../helpers.js';
import { createStore } from '../../js/store.js';
import { createMemoryAdapter, createLocalStorageAdapter } from '../../js/db.js';
import { createBackup, parseBackup } from '../../js/data/backup.js';
import { migrateState } from '../../js/data/migrations.js';
import { createInitialState } from '../../js/seed.js';
import { carriedTasks } from '../../js/engine/taskCarryover.js';
import { LS_FALLBACK_KEY, IDB_NAME, CACHE_PREFIX, LS_PREFIX } from '../../js/config.js';

test('critical commands persist promptly; reload restores identical state', async () => {
  const adapter = createMemoryAdapter();
  const { store } = await makeStore({ adapter });
  const r = await store.dispatch('addTask', { title: 'x', scheduledDate: '2026-11-30' });
  assert.equal(await r.saved, true);
  assert.equal(store.status.save, 'saved');
  const clock = fakeClock('2026-12-01');
  const s2 = createStore({ adapter, now: clock.now, uid: testUid });
  await s2.init();
  assert.deepEqual(s2.state, store.state);
  assert.equal(carriedTasks(s2.state, '2026-12-01').length, 1, 'carryover after reload');
});

test('write failure is reported, not hidden; quota error does not pretend success', async () => {
  const adapter = createMemoryAdapter();
  const { store } = await makeStore({ adapter });
  adapter.failWith = 'quota';
  const r = await store.dispatch('addInquiry', { date: '2026-11-30' });
  assert.equal(r.ok, true);
  assert.equal(await r.saved, false);
  assert.equal(store.status.save, 'error');
  adapter.failWith = null;
  assert.equal(await store.retrySave(), true);
  assert.equal(store.status.save, 'saved');
});

test('stale tab cannot silently overwrite newer state (revision check)', async () => {
  const adapter = createMemoryAdapter();
  const { store } = await makeStore({ adapter });
  const other = structuredClone(store.state);
  other.metadata.revision += 5;
  other.tasks.push({ ...structuredClone(createInitialState('2026-11-30T08:00:00Z')).tasks });
  other.tasks = [];
  adapter._externalWrite(other);
  const r = await store.dispatch('addTask', { title: 'stale' });
  assert.equal(await r.saved, false);
  assert.equal(store.status.conflict, true);
  assert.equal((await adapter.load()).metadata.revision, other.metadata.revision, 'newer data untouched');
  const blocked = await store.dispatch('addTask', { title: 'more' });
  assert.equal(blocked.ok, false, 'further edits blocked until resolved');
  await store.reloadFromStorage();
  assert.equal(store.state.metadata.revision, other.metadata.revision);
  assert.equal(store.status.conflict, false);
});

test('external change with no local edits reloads automatically', async () => {
  const adapter = createMemoryAdapter();
  const { store } = await makeStore({ adapter });
  const other = structuredClone(store.state);
  other.metadata.revision += 1;
  other.settings.displayName = 'אחר';
  adapter._externalWrite(other);
  assert.equal(await store.checkExternal(), true);
  assert.equal(store.state.settings.displayName, 'אחר');
});

test('rejected commands leave state unchanged; invariants enforced', async () => {
  const { store } = await makeStore();
  const before = JSON.stringify(store.state);
  for (const [n, p] of [['addTask', { title: '   ' }], ['setPriorities', { date: '2026-11-30', ids: ['nope'] }], ['addInquiry', { date: '2026-11-30', quantity: 0 }], ['setDayOverride', { date: '2026-11-30', patch: { workStart: '17:00', workEnd: '09:00' } }]]) {
    const r = await store.dispatch(n, p);
    assert.equal(r.ok, false, n);
  }
  assert.equal(JSON.stringify(store.state), before);
});

test('backup round-trip, foreign/plan/newer rejection, restore with recovery snapshot', async () => {
  const adapter = createMemoryAdapter();
  const { store } = await makeStore({ adapter });
  await must(store.dispatch('addTask', { title: 'גיבוי', scheduledDate: '2026-11-30', subtasks: ['א'] }));
  await must(store.dispatch('addInquiry', { date: '2026-11-30', quantity: 3 }));
  await must(store.dispatch('addQuestion', { title: 'ש', audience: 'team' }));
  const text = JSON.stringify(createBackup(store.state, '2026-11-30T10:00:00Z'));
  const parsed = parseBackup(text);
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.state, store.state, 'lossless round-trip');
  assert.equal(parsed.info.counts.tasks, 1);
  assert.equal(parseBackup('{"format":"something-else"}').ok, false);
  assert.equal(parseBackup('{"format":"luma-work-plan","schemaVersion":1}').code, 'plan-file');
  assert.equal(parseBackup(JSON.stringify({ ...JSON.parse(text), backupVersion: 99 })).code, 'newer');
  const future = JSON.parse(text); future.data.metadata.schemaVersion = 99;
  assert.equal(parseBackup(JSON.stringify(future)).code, 'newer');
  const broken = JSON.parse(text); broken.data.tasks[0].status = 'weird';
  assert.equal(parseBackup(JSON.stringify(broken)).ok, false);
  const lifePlanner = JSON.stringify({ series: [], tasks: [], settings: {}, categories: [] });
  assert.equal(parseBackup(lifePlanner).code, 'foreign', 'other apps\' backups are rejected');
  // Restore an older backup after more edits.
  await must(store.dispatch('addTask', { title: 'אחרי הגיבוי' }));
  const rev = store.state.metadata.revision;
  const res = await store.replaceState(parsed.state, 'לפני שחזור גיבוי');
  assert.ok(res.ok);
  assert.equal(store.state.tasks.length, 1);
  assert.ok(store.state.metadata.revision > rev, 'revision stays monotonic');
  const rec = await store.listRecovery();
  assert.ok(rec.some((r) => r.reason === 'לפני שחזור גיבוי'));
  const snap = await store.getRecovery(rec.find((r) => r.reason === 'לפני שחזור גיבוי').id);
  assert.equal(snap.state.tasks.length, 2, 'pre-restore state recoverable');
});

test('migrations: newer versions fail safely; registry runs sequentially and validates output', () => {
  const s = createInitialState('2026-11-30T08:00:00Z');
  assert.throws(() => migrateState({ ...s, metadata: { ...s.metadata, schemaVersion: 2 } }), (e) => e.code === 'newer');
  assert.throws(() => migrateState({ foo: 1 }), (e) => e.code === 'foreign');
  const old = structuredClone(s); old.metadata.schemaVersion = 1; delete old.dayNotes;
  const migrations = { 1: (d) => { d.dayNotes = {}; return d; } };
  const out = migrateState(old, { migrations, target: 2 });
  assert.equal(out.state.metadata.schemaVersion, 2);
  assert.deepEqual(out.state.dayNotes, {});
  assert.throws(() => migrateState(old, { migrations: { 1: (d) => d }, target: 2 }), (e) => e.code === 'invalid', 'invalid output rejected');
});

test('init never seeds over unreadable data', async () => {
  const adapter = createMemoryAdapter();
  adapter._externalWrite({ metadata: { format: 'luma-work-state', schemaVersion: 7, revision: 3 } });
  const clock = fakeClock();
  const s = createStore({ adapter, now: clock.now, uid: testUid });
  await assert.rejects(s.init(), (e) => e.code === 'newer');
  assert.equal((await adapter.load()).metadata.schemaVersion, 7, 'data untouched');
});

test('degraded localStorage adapter is namespaced and revision-checked', async () => {
  const mem = new Map();
  const ls = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  const a = createLocalStorageAdapter(ls);
  const clock = fakeClock();
  const s = createStore({ adapter: a, now: clock.now, uid: testUid, mode: 'degraded' });
  await s.init();
  await (await s.dispatch('addTask', { title: 'x' })).saved;
  assert.ok(mem.has(LS_FALLBACK_KEY));
  assert.ok([...mem.keys()].every((k) => k.startsWith(LS_PREFIX)));
  assert.equal(s.status.mode, 'degraded');
});

test('storage namespaces are unique to Luma', () => {
  for (const v of [IDB_NAME, CACHE_PREFIX, LS_PREFIX]) assert.match(v, /^luma-work-planner/);
  for (const v of [IDB_NAME, CACHE_PREFIX, LS_PREFIX]) assert.ok(!/^life-planner|^planner-shell-|^lp:/.test(v));
});
