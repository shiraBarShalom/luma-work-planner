// Planning import (v2 additive; v1 files normalized), recurring protection, replay, undo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeStore, must } from '../helpers.js';
import { parsePlan, buildPreview, resolveSelection, previewUndoImport, PLAN_FIELDS, PlanError } from '../../js/data/importPlan.js';
import { buildPlanningPrompt } from '../../js/data/prompt.js';
import { dayOccurrences, recurringSignature } from '../../js/engine/schedule.js';

const WS = '2026-11-29', MON = '2026-11-30';
const plan = (over = {}) => ({
  format: 'luma-work-plan', schemaVersion: 2, kind: 'weekly', planId: 'test-week-v1', weekStart: WS,
  activities: [{ externalId: 'a-1', title: 'ישיבת צוות', date: MON, start: '10:00', end: '11:00' }],
  tasks: [{ externalId: 't-1', title: 'השלמת בדיקת המסמכים', scheduledDate: MON, deadline: '2026-12-02', priority: 'high', notes: 'כללי' }],
  ...over,
});
const txt = (o) => JSON.stringify(o);
const setup = async () => makeStore({ date: WS });
async function importPlanObj(store, obj, { selection = {}, resolutions = {}, allowOutsideWeek = false } = {}) {
  const p = parsePlan(txt(obj));
  return store.dispatch('importPlan', { plan: p, selection, resolutions, allowOutsideWeek, expectedRevision: store.state.metadata.revision });
}

test('invalid JSON, schema, version, unknown fields, dates/times are rejected', () => {
  const bad = [
    '{not json', txt({ ...plan(), format: 'other' }), txt({ ...plan(), schemaVersion: 9 }), txt({ ...plan(), extra: 1 }),
    txt(plan({ tasks: [{ externalId: 't', title: 'x', status: 'done' }] })),
    txt(plan({ activities: [{ externalId: 'a', title: 'x', date: '2026-02-30', start: '10:00', end: '11:00' }] })),
    txt(plan({ activities: [{ externalId: 'a', title: 'x', date: MON, start: '11:00', end: '10:00' }] })),
    txt(plan({ activities: [{ externalId: 'a', title: 'x', date: MON, start: '10:00', end: '11:00', durationMinutes: 30 }] })),
    txt(plan({ activities: [], tasks: [] })),
    txt({ ...plan(), weekStart: '2026-11-30' }),
    txt({ format: 'luma-work-backup' }),
  ];
  for (const b of bad) assert.throws(() => parsePlan(b), PlanError, b.slice(0, 60));
  assert.doesNotThrow(() => parsePlan('```json\n' + txt(plan()) + '\n```'));
});

test('import is additive: overlapping activities keep their original times; recurring schedule untouched', async () => {
  const { store } = await setup();
  const before = recurringSignature(store.state);
  const p = parsePlan(txt(plan()));
  const prev = buildPreview(store.state, p);
  const act = prev.items.find((i) => i.key === 'activities:a-1');
  assert.ok(act.issues.some((x) => x.type === 'overlap' && !x.blocking), 'overlap shown as information only');
  assert.ok(resolveSelection(prev, {}).ok, 'no resolution needed for ordinary overlaps');
  const r = await must(importPlanObj(store, plan()));
  assert.equal(r.added, 2);
  assert.equal(recurringSignature(store.state), before, 'every recurring activity preserved exactly');
  const occs = dayOccurrences(store.state, MON);
  const phones = occs.find((o) => o.title.startsWith('מענה'));
  const meeting = occs.find((o) => o.title === 'ישיבת צוות');
  assert.deepEqual([phones.start, phones.end, meeting.start, meeting.end], ['09:00', '13:00', '10:00', '11:00']);
  assert.equal(occs.length, 9, 'both remain on the day');
});

test('preview is read-only; missing times require completion; exact replay creates no duplicates', async () => {
  const { store } = await setup();
  const snapshot = JSON.stringify(store.state);
  const p = parsePlan(txt(plan({ activities: [{ externalId: 'a-2', title: 'פגישה', date: MON, start: '11:00' }] })));
  const prev = buildPreview(store.state, p);
  assert.equal(JSON.stringify(store.state), snapshot, 'preview never mutates');
  assert.equal(resolveSelection(prev, {}).ok, false, 'unknown duration needs completion');
  assert.ok(resolveSelection(prev, {}, { 'activities:a-2': { durationMinutes: 30 } }).ok);
  await must(store.dispatch('importPlan', { plan: p, selection: {}, resolutions: { 'activities:a-2': { durationMinutes: 30 } }, expectedRevision: store.state.metadata.revision }));
  const n = store.state.calendarBlocks.length, t = store.state.tasks.length;
  const again = buildPreview(store.state, parsePlan(txt(plan({ activities: [{ externalId: 'a-2', title: 'פגישה', date: MON, start: '11:00' }] }))));
  assert.ok(again.exactReplay);
  assert.equal((await importPlanObj(store, plan({ activities: [{ externalId: 'a-2', title: 'פגישה', date: MON, start: '11:00' }] }))).ok, false, 'nothing to import');
  assert.equal(store.state.calendarBlocks.length, n);
  assert.equal(store.state.tasks.length, t);
});

test('changed same-ID content previews an update; manual edits need approval; semantic duplicates need review', async () => {
  const { store } = await setup();
  await must(importPlanObj(store, plan()));
  const changed = plan({ tasks: [{ externalId: 't-1', title: 'השלמת בדיקת המסמכים', scheduledDate: '2026-12-01', priority: 'high' }] });
  let prev = buildPreview(store.state, parsePlan(txt(changed)));
  assert.equal(prev.items.find((i) => i.key === 'tasks:t-1').action, 'update');
  const tid = store.state.tasks[0].id;
  await must(store.dispatch('updateTask', { id: tid, patch: { title: 'נערך ידנית' } }));
  prev = buildPreview(store.state, parsePlan(txt(changed)));
  const item = prev.items.find((i) => i.key === 'tasks:t-1');
  assert.ok(item.issues.some((x) => x.type === 'manualEdited'));
  assert.equal(item.defaultSelected, false);
  const other = plan({ planId: 'other-plan', activities: [], tasks: [{ externalId: 'x', title: 'נערך ידנית' }] });
  const dup = buildPreview(store.state, parsePlan(txt(other))).items[0];
  assert.ok(dup.issues.some((x) => x.type === 'possibleDuplicate'));
  assert.equal(dup.defaultSelected, false);
  // Re-creating the fixed schedule in a plan is flagged as a duplicate, not added by default.
  const recreate = plan({ planId: 'recreate', tasks: [], activities: [{ externalId: 'o', title: 'פתיחת יום', date: MON, start: '08:45', end: '09:00' }] });
  assert.equal(buildPreview(store.state, parsePlan(txt(recreate))).items[0].defaultSelected, false);
});

test('an import can never update a recurring activity, even with tampered history', async () => {
  const { store } = await setup();
  await must(importPlanObj(store, plan()));
  const tampered = structuredClone(store.state);
  tampered.importHistory[0].items.find((i) => i.collection === 'activities').entityId = 'default-phones';
  store._setState(tampered);
  const before = recurringSignature(store.state);
  const changed = plan({ activities: [{ externalId: 'a-1', title: 'זז', date: MON, start: '15:00', end: '16:00' }] });
  const prev = buildPreview(store.state, parsePlan(txt(changed)));
  assert.ok(prev.items[0].issues.some((x) => x.type === 'protected'));
  const r = await importPlanObj(store, changed, { selection: { 'activities:a-1': true } });
  assert.equal(r.ok, false);
  assert.equal(recurringSignature(store.state), before);
});

test('v1 plans are still accepted: blocks and timed meetings become activities, obsolete parts are listed', async () => {
  const { store } = await setup();
  const v1 = {
    format: 'luma-work-plan', schemaVersion: 1, kind: 'weekly', planId: 'old-week', weekStart: WS,
    days: [{ externalId: 'd', date: '2026-12-03', isWorking: false, phoneDuty: false }],
    meetings: [{ externalId: 'm', title: 'ישיבה', meetingType: 'team', date: MON, start: '10:30', durationMinutes: 30 }, { externalId: 'm2', title: 'פגישה בלי מועד', meetingType: 'manager' }],
    blocks: [{ externalId: 'b', date: '2026-12-01', title: 'הכנה', start: '07:00', end: '07:30', categoryId: 'documents', pinned: true }],
    tasks: [{ externalId: 't', title: 'משימה', scheduledDate: MON, estimateMinutes: 30, subtasks: ['שלב א'], categoryId: 'documents' }],
    questions: [{ externalId: 'q', audience: 'team', title: 'שאלה' }],
  };
  const prev = buildPreview(store.state, parsePlan(txt(v1)));
  assert.deepEqual(prev.items.filter((i) => i.action === 'unsupported').map((i) => i.origin).sort(), ['days', 'meetings', 'questions']);
  assert.ok(prev.items.find((i) => i.key === 'blocks:b').dropped.includes('קטגוריה'));
  const before = recurringSignature(store.state);
  const r = await must(importPlanObj(store, v1));
  assert.equal(r.added, 3);
  assert.equal(recurringSignature(store.state), before, 'v1 day settings never suppress the schedule');
  assert.equal(dayOccurrences(store.state, '2026-12-03').length, 8);
  const task = store.state.tasks.find((t) => t.title === 'משימה');
  assert.match(task.details, /• שלב א/, 'subtasks kept as note lines');
  assert.equal(task.estimateMinutes, null);
  assert.ok(buildPreview(store.state, parsePlan(txt(v1))).exactReplay, 'v1 replay recognized');
});

test('stale preview leaves state unchanged; undo import is safe', async () => {
  const { store } = await setup();
  const p = parsePlan(txt(plan()));
  const rev = store.state.metadata.revision;
  await must(store.dispatch('changeCount', { date: MON, delta: 1 }));
  const before = JSON.stringify(store.state);
  const stale = await store.dispatch('importPlan', { plan: p, selection: {}, resolutions: {}, expectedRevision: rev });
  assert.equal(stale.ok, false);
  assert.equal(JSON.stringify(store.state), before);
  const r = await must(importPlanObj(store, plan()));
  const u = previewUndoImport(store.state, r.historyId);
  assert.equal(u.revert.length, 2);
  await must(store.dispatch('undoImport', { historyId: r.historyId, expectedRevision: store.state.metadata.revision }));
  assert.equal(store.state.tasks.length, 0);
  assert.ok(!dayOccurrences(store.state, MON).some((o) => o.title === 'ישיבת צוות'));
  assert.equal(dayOccurrences(store.state, MON).length, 8, 'undo leaves the schedule intact');
});

test('daily patch; schema file and prompt aligned with the v2 contract', async () => {
  const { store } = await setup();
  const daily = { format: 'luma-work-plan', schemaVersion: 2, kind: 'dailyPatch', planId: 'day-1', tasks: [{ externalId: 't', title: 'x', scheduledDate: '2026-12-08' }] };
  await must(importPlanObj(store, daily));
  const schema = JSON.parse(readFileSync(new URL('../../schemas/weekly-plan.schema.json', import.meta.url), 'utf8'));
  assert.equal(schema.properties.schemaVersion.const, 2);
  for (const c of ['activities', 'tasks']) {
    const def = schema.properties[c].items.properties;
    assert.deepEqual(Object.keys(def).sort(), [...PLAN_FIELDS[c].required, ...PLAN_FIELDS[c].optional].sort(), c);
  }
  const prompt = buildPlanningPrompt(store.state, { kind: 'weekly', date: WS });
  assert.match(prompt, /schemaVersion: 2/);
  assert.match(prompt, /09:00-13:00 מענה לטלפונים ולפניות ב-CRM/, 'prompt lists the existing schedule');
  assert.match(prompt, /לא ליצור מחדש את הפעילויות הקבועות/);
  assert.match(prompt, /מותר שפעילות נוספת תחפוף/);
  assert.doesNotMatch(prompt, /תורנות|categoryId|questions|meetings/);
  assert.doesNotMatch(prompt, /השלמת בדיקת|כללי"/, 'no private tasks serialized');
});
