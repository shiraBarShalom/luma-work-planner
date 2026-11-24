import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeStore, must } from '../helpers.js';
import { parsePlan, buildPreview, resolveSelection, previewUndoImport, PLAN_FIELDS, PlanError } from '../../js/data/importPlan.js';
import { buildPlanningPrompt } from '../../js/data/prompt.js';
import { dayOccurrences } from '../../js/engine/schedule.js';
import { effectiveDay } from '../../js/engine/dayTemplates.js';

const WS = '2026-11-29';
const plan = (over = {}) => ({
  format: 'luma-work-plan', schemaVersion: 1, kind: 'weekly', planId: 'test-week-v1', weekStart: WS,
  days: [{ externalId: 'day-thu', date: '2026-12-03', workEnd: '14:00' }],
  meetings: [{ externalId: 'meeting-1', title: 'ישיבת צוות', meetingType: 'team', date: '2026-11-30', start: '10:30', durationMinutes: null, agendaRefs: ['q-1'] }],
  tasks: [{ externalId: 'task-1', title: 'השלמת בדיקת המסמכים', deadline: '2026-12-02', categoryId: 'documents', priority: 'high', scheduledDate: '2026-11-30', subtasks: ['שלב א'] }],
  questions: [{ externalId: 'q-1', audience: 'manager', title: 'בירור לגבי תקלה בסנכרון' }],
  blocks: [{ externalId: 'b-1', date: '2026-12-01', title: 'הכנת חומרים', start: '07:00', end: '07:30', taskRefs: ['task-1'] }],
  ...over,
});
const txt = (o) => JSON.stringify(o);

async function setup() {
  const { store, clock } = await makeStore({ date: '2026-11-29' });
  return { store, clock };
}
async function importAll(store, obj, { selection = {}, resolutions = {}, ackOverlaps = true } = {}) {
  const p = parsePlan(txt(obj));
  const prev = buildPreview(store.state, p);
  return store.dispatch('importPlan', { plan: p, selection, resolutions, ackOverlaps, expectedRevision: store.state.metadata.revision, allowOutsideWeek: false });
}

test('invalid JSON, schema, version, unknown fields, dates/times and references are rejected without state change', async () => {
  const bad = [
    ['{not json', 'syntax'],
    [txt({ ...plan(), schemaVersion: 2 }), 'version'],
    [txt({ ...plan(), format: 'other' }), 'format'],
    [txt({ ...plan(), extra: 1 }), 'invalid'],
    [txt(plan({ tasks: [{ externalId: 't', title: 'x', status: 'done' }] })), 'invalid'],
    [txt(plan({ tasks: [{ externalId: 't', title: 'x', deadline: '2026-02-30' }] })), 'invalid'],
    [txt(plan({ blocks: [{ externalId: 'b', date: '2026-11-30', title: 'x', start: '10:00', end: '09:00' }] })), 'invalid'],
    [txt(plan({ blocks: [{ externalId: 'b', date: '2026-11-30', title: 'x', start: '10:00', end: '10:30', durationMinutes: 45 }] })), 'invalid'],
    [txt(plan({ meetings: [{ externalId: 'm', title: 'x', meetingType: 'team', agendaRefs: ['nope'] }] })), 'invalid'],
    [txt({ ...plan(), weekStart: '2026-11-30' }), 'invalid'],
    [txt({ format: 'luma-work-plan', schemaVersion: 1, kind: 'weekly', planId: 'x', weekStart: WS }), 'invalid'],
    ['{"__proto__":{"x":1},"format":"luma-work-plan"}', 'forbidden-key'],
    [txt({ format: 'luma-work-backup' }), 'backup-file'],
  ];
  for (const [t, code] of bad) {
    assert.throws(() => parsePlan(t), (e) => e instanceof PlanError && e.code === code, `expected ${code} for ${t.slice(0, 60)}`);
  }
  const big = plan({ tasks: Array.from({ length: 501 }, (_, i) => ({ externalId: `t${i}`, title: 'x' })) });
  assert.throws(() => parsePlan(txt(big)), (e) => e.code === 'too-many');
});

test('preview is read-only, flags unknown duration, overlaps and dependencies', async () => {
  const { store } = await setup();
  const rev = store.state.metadata.revision;
  const p = parsePlan(txt(plan()));
  const prev = buildPreview(store.state, p);
  assert.equal(store.state.metadata.revision, rev);
  const meeting = prev.items.find((i) => i.key === 'meetings:meeting-1');
  assert.ok(meeting.issues.some((x) => x.type === 'needsTime'), 'missing meeting duration must be completed');
  const block = prev.items.find((i) => i.key === 'blocks:b-1');
  assert.ok(block.issues.some((x) => x.type === 'outsideHours'));
  let r = resolveSelection(prev, {});
  assert.equal(r.ok, false);
  // Exclude the meeting: the question referenced by it is fine; resolve.
  r = resolveSelection(prev, { 'meetings:meeting-1': false });
  assert.equal(r.ok, true);
  // Exclude the task referenced by the block: dependency must be resolved.
  r = resolveSelection(prev, { 'meetings:meeting-1': false, 'tasks:task-1': false });
  assert.equal(r.ok, false);
  r = resolveSelection(prev, { 'meetings:meeting-1': false, 'tasks:task-1': false }, { 'blocks:b-1': { dropRefs: true } });
  assert.equal(r.ok, true);
});

test('apply is atomic, keeps provenance, then exact replay is recognized and changed same-ID previews an update', async () => {
  const { store } = await setup();
  const res = await importAll(store, plan(), { resolutions: { 'meetings:meeting-1': { durationMinutes: 30 } } });
  assert.ok(res.ok, res.error);
  const s = store.state;
  assert.equal(s.tasks.length, 1); assert.equal(s.questions.length, 1); assert.equal(s.meetings.length, 1); assert.equal(s.calendarBlocks.length, 1);
  assert.equal(s.meetings[0].end, '11:00');
  assert.deepEqual(s.meetings[0].agenda, [s.questions[0].id]);
  assert.equal(s.tasks[0].assignedBlock, s.calendarBlocks[0].id);
  assert.equal(s.tasks[0].status, 'todo', 'no completion fabricated');
  assert.equal(s.inquiryLogs.length, 0, 'no counts fabricated');
  assert.equal(effectiveDay(s, '2026-12-03').workEnd, '14:00');
  assert.equal(s.importHistory.length, 1);
  assert.ok(!JSON.stringify(s.importHistory).includes('השלמת בדיקת'), 'history does not store raw plan content');
  // Exact replay.
  const prev2 = buildPreview(store.state, parsePlan(txt(plan({ meetings: [{ externalId: 'meeting-1', title: 'ישיבת צוות', meetingType: 'team', date: '2026-11-30', start: '10:30', durationMinutes: 30, agendaRefs: ['q-1'] }] }))));
  assert.ok(prev2.items.filter((i) => i.collection !== 'meetings').every((i) => i.action === 'unchanged'));
  // Changed content with same IDs → update proposal, not duplicate.
  const changed = plan({ tasks: [{ externalId: 'task-1', title: 'השלמת בדיקת המסמכים', deadline: '2026-12-03', categoryId: 'documents', priority: 'high', scheduledDate: '2026-11-30', subtasks: ['שלב א'] }] });
  const prev3 = buildPreview(store.state, parsePlan(txt(changed)));
  assert.equal(prev3.items.find((i) => i.key === 'tasks:task-1').action, 'update');
  const r3 = await importAll(store, changed, { selection: { 'meetings:meeting-1': false, 'questions:q-1': false, 'blocks:b-1': false, 'days:day-thu': false } });
  assert.ok(r3.ok, r3.error);
  assert.equal(store.state.tasks.length, 1);
  assert.equal(store.state.tasks[0].deadline, '2026-12-03');
});

test('semantic duplicates with different IDs require review; manual edits are protected', async () => {
  const { store } = await setup();
  await must(store.dispatch('addTask', { title: 'השלמת בדיקת המסמכים', scheduledDate: '2026-11-30' }));
  const prev = buildPreview(store.state, parsePlan(txt(plan())));
  const t = prev.items.find((i) => i.key === 'tasks:task-1');
  assert.ok(t.issues.some((x) => x.type === 'possibleDuplicate'));
  assert.equal(t.defaultSelected, false, 'not silently added');
  // Manual day override protected.
  await must(store.dispatch('setDayOverride', { date: '2026-12-03', patch: { location: 'office' } }));
  const prev2 = buildPreview(store.state, parsePlan(txt(plan())));
  const day = prev2.items.find((i) => i.key === 'days:day-thu');
  assert.ok(day.issues.some((x) => x.type === 'manualEdited' && x.blocking));
  const r = resolveSelection(prev2, { 'days:day-thu': true, 'meetings:meeting-1': false, 'blocks:b-1': false });
  assert.equal(r.ok, false);
  const r2 = resolveSelection(prev2, { 'days:day-thu': true, 'meetings:meeting-1': false, 'blocks:b-1': false }, { 'days:day-thu': { overwriteManual: true } });
  assert.equal(r2.ok, true);
});

test('stale preview or failed validation leaves state unchanged; undo import is safe', async () => {
  const { store } = await setup();
  const p = parsePlan(txt(plan()));
  const rev = store.state.metadata.revision;
  await must(store.dispatch('addTask', { title: 'אחר' }));
  const stale = await store.dispatch('importPlan', { plan: p, selection: { 'meetings:meeting-1': false }, resolutions: {}, ackOverlaps: true, expectedRevision: rev });
  assert.equal(stale.ok, false);
  assert.equal(store.state.tasks.length, 1);
  const ok = await importAll(store, plan(), { selection: { 'meetings:meeting-1': false } });
  assert.ok(ok.ok, ok.error);
  const h = store.state.importHistory[0];
  const pu = previewUndoImport(store.state, h.id);
  assert.equal(pu.clean, true);
  await must(store.dispatch('undoImport', { historyId: h.id, expectedRevision: store.state.metadata.revision }));
  assert.equal(store.state.tasks.length, 1, 'only the pre-existing task remains');
  assert.equal(store.state.questions.length, 0);
  assert.equal(store.state.dayOverrides['2026-12-03'], undefined);
  // Re-import after newer edits: partial undo keeps edited items.
  await importAll(store, plan(), { selection: { 'meetings:meeting-1': false } });
  const h2 = store.state.importHistory[0];
  const imported = store.state.tasks.find((t) => t.importRef);
  await must(store.dispatch('updateTask', { id: imported.id, patch: { title: 'נערך ידנית' } }));
  const pu2 = previewUndoImport(store.state, h2.id);
  assert.equal(pu2.clean, false);
  assert.ok(pu2.keep.some((k) => k.entityId === imported.id));
  await must(store.dispatch('undoImport', { historyId: h2.id, expectedRevision: store.state.metadata.revision }));
  assert.ok(store.state.tasks.some((t) => t.id === imported.id), 'edited item kept');
  assert.equal(store.state.questions.length, 0);
});

test('daily patch, code fences tolerated by caller, schema/prompt alignment', async () => {
  const { store } = await setup();
  const daily = { format: 'luma-work-plan', schemaVersion: 1, kind: 'dailyPatch', planId: 'd-1', tasks: [{ externalId: 'a', title: 'פריט-פרטי-7391', scheduledDate: '2026-12-01', estimateMinutes: null }] };
  assert.equal(parsePlan('```json\n' + JSON.stringify(daily) + '\n```').planId, 'd-1', 'code fence tolerated');
  const r = await importAll(store, daily);
  assert.ok(r.ok, r.error);
  assert.equal(store.state.tasks[0].estimateMinutes, null, 'null stays unknown');
  const schema = JSON.parse(readFileSync(new URL('../../schemas/weekly-plan.schema.json', import.meta.url), 'utf8'));
  const keys = (o) => Object.keys(o.properties).sort();
  assert.deepEqual(keys(schema), [...PLAN_FIELDS.envelope.required, ...PLAN_FIELDS.envelope.optional].sort());
  for (const c of ['days', 'blocks', 'meetings', 'tasks', 'questions']) {
    const item = schema.$defs[c];
    assert.deepEqual(Object.keys(item.properties).sort(), [...PLAN_FIELDS[c].required, ...PLAN_FIELDS[c].optional].sort(), c);
    assert.deepEqual(item.required.slice().sort(), PLAN_FIELDS[c].required.slice().sort(), c);
    assert.equal(item.additionalProperties, false);
  }
  const prompt = buildPlanningPrompt(store.state, { kind: 'weekly', date: '2026-12-01' });
  for (const c of ['days', 'blocks', 'meetings', 'tasks', 'questions']) for (const f of PLAN_FIELDS[c].optional) assert.ok(prompt.includes(f), `prompt mentions ${f}`);
  assert.ok(prompt.includes('"weekStart": "2026-11-29"'));
  assert.ok(!prompt.includes('פריט-פרטי-7391'), 'no private tasks in prompt');
});
