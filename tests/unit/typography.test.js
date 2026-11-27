// Typography rule: user-facing text uses only the short hyphen (-), never an em dash,
// en dash or Hebrew maqaf. Checks every shipped text file and the generated prompt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { makeStore } from '../helpers.js';
import { buildPlanningPrompt } from '../../js/data/prompt.js';
import { WEEKLY_SCHEDULE } from '../../js/seed.js';
import { weekLabel } from '../../js/dates.js';

const FORBIDDEN = /[\u2013\u2014\u05BE]/;
const root = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const walk = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });

test('no em dash, en dash or maqaf in any shipped text file', () => {
  const files = [...walk(join(root, 'js')), join(root, 'css', 'luma.css'), join(root, 'index.html'), join(root, 'manifest.webmanifest'), join(root, 'sw.js')];
  const bad = [];
  for (const f of files) readFileSync(f, 'utf8').split('\n').forEach((line, i) => { if (FORBIDDEN.test(line)) bad.push(`${f}:${i + 1}`); });
  assert.deepEqual(bad, []);
});

test('default schedule, date ranges and ChatGPT instructions use the short hyphen', async () => {
  for (const s of WEEKLY_SCHEDULE) assert.doesNotMatch(`${s.title} ${s.notes}`, FORBIDDEN, s.title);
  assert.equal(WEEKLY_SCHEDULE[1].title, 'מענה לטלפונים ולפניות ב-CRM');
  assert.equal(weekLabel('2026-11-29'), '29 בנובמבר - 5 בדצמבר 2026');
  const { store } = await makeStore({ date: '2026-11-29' });
  const prompt = buildPlanningPrompt(store.state, { kind: 'weekly', date: '2026-11-29' });
  assert.doesNotMatch(prompt, FORBIDDEN);
  assert.match(prompt, /09:00-13:00 מענה לטלפונים ולפניות ב-CRM/);
});
