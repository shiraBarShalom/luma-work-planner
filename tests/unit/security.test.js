// Security regressions: untrusted JSON (plans and backups), prototype pollution, size and
// depth limits, crafted backup fields, and recurring-activity protection under import.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeStore, must } from '../helpers.js';
import { v1Document } from '../fixtures.js';
import { parsePlan, PlanError } from '../../js/data/importPlan.js';
import { parseBackup, createBackup } from '../../js/data/backup.js';
import { validateState } from '../../js/data/validation.js';
import { migrateState } from '../../js/data/migrations.js';
import { LIMITS } from '../../js/config.js';

const plan = (over = {}) => ({ format: 'luma-work-plan', schemaVersion: 2, kind: 'dailyPatch', planId: 'p1', tasks: [{ externalId: 't', title: 'x' }], ...over });

test('plan import: prototype-pollution keys, oversized, too deep and executable-looking content', () => {
  for (const evil of [
    '{"__proto__":{"polluted":1},"format":"luma-work-plan"}',
    JSON.stringify(plan()).replace('"tasks"', '"constructor":{"prototype":{"x":1}},"tasks"'),
    JSON.stringify(plan({ tasks: [{ externalId: 't', title: 'x', __proto__: null, prototype: 1 }] })),
  ]) assert.throws(() => parsePlan(evil), PlanError);
  assert.equal({}.polluted, undefined, 'Object.prototype untouched');
  assert.throws(() => parsePlan('{"a":' + '['.repeat(50) + ']'.repeat(50) + '}'), (e) => e.code === 'too-deep');
  assert.throws(() => parsePlan(' '.repeat(10) + JSON.stringify(plan({ tasks: [{ externalId: 't', title: 'x', notes: 'a'.repeat(LIMITS.planBytes) }] }))), (e) => e.code === 'too-large');
  assert.throws(() => parsePlan(JSON.stringify(plan({ tasks: Array.from({ length: 501 }, (_, i) => ({ externalId: `t${i}`, title: 'x' })) }))), (e) => e.code === 'too-many');
  assert.throws(() => parsePlan(JSON.stringify(plan({ tasks: [{ externalId: 'javascript:alert(1)', title: 'x' }] }))), PlanError, 'IDs are restricted to a safe alphabet');
  assert.throws(() => parsePlan(JSON.stringify(plan({ tasks: [{ externalId: 't', title: 'x', run: 'fetch()' }] }))), PlanError, 'unknown fields rejected');
  // Markup is accepted only as plain text data (rendered with textContent).
  const ok = parsePlan(JSON.stringify(plan({ tasks: [{ externalId: 't', title: '<img src=x onerror=alert(1)>' }] })));
  assert.equal(ok.items[0].data.title, '<img src=x onerror=alert(1)>');
});

test('backup restore: foreign, crafted and polluted backups are rejected without changes', async () => {
  const { store } = await makeStore();
  const good = createBackup(store.state, '2026-11-30T10:00:00Z');
  const variant = (mutate) => { const b = structuredClone(good); mutate(b.data); return JSON.stringify(b); };
  const rejected = [
    variant((d) => { d.calendarBlocks[0].notes = { html: '<script>' }; }),
    variant((d) => { d.occurrenceOverrides['default-break@2026-11-30'] = { title: ['<b>x</b>'] }; }),
    variant((d) => { d.dayNotes['2026-11-30'] = { notes: 42 }; }),
    variant((d) => { d.dayNotes['not-a-date'] = { notes: 'x' }; }),
    variant((d) => { d.settings.categories[0].color = 'url(https://example.invalid/track)'; }),
    variant((d) => { d.settings.header.rules[0].image = 'https://example.invalid/x.png'; }),
    variant((d) => { d.inquiryCounts['2026-11-30'] = -5; }),
    JSON.stringify(good).replace('"settings":{', '"settings":{"__proto__":{"x":1},'),
  ];
  for (const text of rejected) assert.equal(parseBackup(text).ok, false, text.slice(0, 0));
  assert.equal({}.x, undefined);
  assert.equal(parseBackup(JSON.stringify(good)).ok, true, 'a genuine backup still restores');
});

test('stricter validation still accepts every record shape written by this and earlier versions', async () => {
  const { store } = await makeStore({ date: '2026-11-30' });
  await must(store.dispatch('addBlock', { date: '2026-11-30', start: '10:00', end: '11:00', title: 'פגישה', notes: 'הערה' }));
  await must(store.dispatch('updateOccurrence', { occId: 'default-break@2026-11-30', changes: { title: 'הפסקה קצרה', notes: 'x' }, scope: 'this' }));
  await must(store.dispatch('saveDayNote', { date: '2026-11-30', notes: 'הערות היום' }));
  assert.ok(validateState(store.state).ok);
  assert.ok(migrateState(v1Document(), { today: '2026-11-27', nowIso: '2026-11-27T08:00:00.000Z' }).state, 'v1 data with accomplishments migrates and validates');
});

test('shipped app has no runtime network origins and a strict CSP', () => {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)[1];
  for (const d of ["default-src 'self'", "script-src 'self'", "style-src 'self';", "connect-src 'self'", "object-src 'none'", "frame-src 'none'", "base-uri 'self'", "form-action 'none'"]) assert.ok(csp.includes(d), d);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval|https?:|\*/);
  assert.match(html, /name="referrer" content="no-referrer"/);
});
