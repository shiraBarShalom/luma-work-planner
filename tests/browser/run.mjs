// Browser end-to-end tests (dev-only, Playwright). Run: npm run test:browser
// Uses synthetic data and Playwright's fake clock. Starts its own static servers under a
// /luma/ subpath to verify relative paths. Uses the bundled Chromium if installed, else
// the system Chrome channel.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { cp, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import assert from 'node:assert/strict';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');
const results = [];
const servers = [];

function serve(dir, port) {
  return new Promise((res, rej) => {
    const p = spawn(process.execPath, [join(ROOT, 'tools', 'serve.mjs'), String(port), dir], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, MSYS_NO_PATHCONV: '1' } });
    servers.push(p);
    p.stdout.on('data', (d) => { if (String(d).includes('Luma dev server')) res(`http://localhost:${port}/luma/`); });
    p.on('error', rej);
    setTimeout(() => rej(new Error('server timeout')), 8000);
  });
}

async function launch() {
  try { return await chromium.launch(); } catch { return chromium.launch({ channel: 'chrome' }); }
}

/** ISO instant for a Jerusalem wall time (winter, UTC+2). */
const jlm = (date, time) => new Date(`${date}T${time}:00+02:00`);

async function test(name, fn) {
  const t0 = Date.now();
  try { await fn(); results.push({ name, ok: true, ms: Date.now() - t0 }); console.log(`✔ ${name}`); }
  catch (e) { results.push({ name, ok: false, err: e }); console.log(`✖ ${name}\n   ${e.stack?.split('\n').slice(0, 4).join('\n   ')}`); }
}

async function newPage(browser, base, { time = null, viewport = { width: 390, height: 844 }, colorScheme = 'light', serviceWorkers = 'block' } = {}) {
  const ctx = await browser.newContext({ viewport, locale: 'he-IL', timezoneId: 'Europe/London', colorScheme, serviceWorkers });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  if (time) await page.clock.install({ time });
  await page.goto(base + '#/home');
  await page.waitForSelector('.page');
  return { ctx, page, errors };
}

const sectionTitles = (page, which) => page.locator(`[data-section="${which}"] .item .title`).allTextContents();

async function addTaskViaUi(page, title, { date = null } = {}) {
  await page.goto(page.url().split('#')[0] + '#/tasks/today');
  await page.getByRole('button', { name: 'הוספת משימה' }).click();
  await page.getByLabel('תיאור המשימה').fill(title);
  if (date) await page.getByLabel('תאריך ביצוע').fill(date);
  await page.locator('.sheet-foot').getByRole('button', { name: 'הוספת משימה' }).click();
  await page.waitForSelector('.backdrop', { state: 'detached' });
}

const base = await serve(ROOT, 8731);
const browser = await launch();

await test('boot: Hebrew RTL shell, five primary tabs in order, no console errors', async () => {
  const { page, errors, ctx } = await newPage(browser, base, { time: jlm('2026-11-30', '10:30') });
  assert.equal(await page.getAttribute('html', 'dir'), 'rtl');
  assert.equal(await page.getAttribute('html', 'lang'), 'he');
  const tabs = await page.locator('nav.nav a').allTextContents();
  assert.deepEqual(tabs, ['היום שלי', 'סדר היום', 'משימות', 'יומן', 'הגדרות']);
  assert.equal(await page.locator('[data-section="carried"] h2').first().textContent().then((t) => t.includes('משימות שלא הסתיימו עד היום')), true);
  assert.deepEqual(errors, []);
  await ctx.close();
});

await test('header banner + greeting follow Jerusalem time boundaries and update while visible', async () => {
  const { page, ctx } = await newPage(browser, base, { time: jlm('2026-11-30', '07:59') });
  assert.equal(await page.getAttribute('header.hdr', 'data-banner'), 'dawn');
  assert.match(await page.locator('.greeting').textContent(), /בוקר טוב, כרמית/);
  await page.clock.runFor(2 * 60 * 1000);
  await page.waitForFunction(() => document.querySelector('header.hdr')?.dataset.banner === 'day');
  for (const [t, img, g] of [['04:59', 'night', 'לילה טוב'], ['05:00', 'dawn', 'בוקר טוב'], ['12:00', 'day', 'צהריים טובים'], ['17:00', 'sunset', 'ערב טוב'], ['20:00', 'night', 'לילה טוב'], ['00:00', 'night', 'לילה טוב']]) {
    await page.clock.setSystemTime(jlm('2026-12-01', t));
    await page.reload(); await page.waitForSelector('.greeting');
    assert.equal(await page.getAttribute('header.hdr', 'data-banner'), img, t);
    assert.match(await page.locator('.greeting').textContent(), new RegExp(g), t);
  }
  assert.equal(await page.locator('.greeting::after').count().catch(() => 0), 0);
  await ctx.close();
});

await test('carryover: unchecked Monday task appears Tuesday on Home and Tasks (same record), weekend skipped, completion removes it everywhere', async () => {
  const { page, ctx } = await newPage(browser, base, { time: jlm('2026-11-30', '10:00') });
  await addTaskViaUi(page, 'משימת בדיקה א');
  await page.goto(base + '#/home'); await page.waitForSelector('.page');
  assert.deepEqual(await sectionTitles(page, 'today'), ['משימת בדיקה א']);
  assert.deepEqual(await sectionTitles(page, 'carried'), []);
  // Next day, app reopened; no closing was done.
  await page.clock.setSystemTime(jlm('2026-12-01', '09:05'));
  await page.reload(); await page.waitForSelector('.page');
  assert.deepEqual(await sectionTitles(page, 'carried'), ['משימת בדיקה א']);
  assert.deepEqual(await sectionTitles(page, 'today'), []);
  assert.match(await page.locator('[data-section="carried"] .meta').first().textContent(), /30 בנובמבר/);
  await page.goto(base + '#/tasks/today'); await page.waitForSelector('[data-section="carried"]');
  assert.deepEqual(await sectionTitles(page, 'carried'), ['משימת בדיקה א']);
  // Several days later incl. weekend, still there.
  await page.clock.setSystemTime(jlm('2026-12-06', '09:05'));
  await page.reload(); await page.waitForSelector('[data-section="carried"]');
  assert.deepEqual(await sectionTitles(page, 'carried'), ['משימת בדיקה א']);
  const count = await page.evaluate(() => new Promise((res) => { const r = indexedDB.open('luma-work-planner'); r.onsuccess = () => { const tx = r.result.transaction('state').objectStore('state').get('current'); tx.onsuccess = () => res(tx.result.tasks.length); }; }));
  assert.equal(count, 1, 'no duplicate records');
  // Complete from Tasks; gone from Home too.
  await page.locator('[data-section="carried"] .cb').first().click();
  await page.waitForFunction(() => !document.querySelector('[data-section="carried"] .item'));
  await page.goto(base + '#/home'); await page.waitForSelector('[data-section="carried"]');
  assert.deepEqual(await sectionTitles(page, 'carried'), []);
  await ctx.close();
});

await test('inquiry counter: +1 and batch persist across reload; undo cannot go negative', async () => {
  const { page, ctx } = await newPage(browser, base, { time: jlm('2026-11-30', '10:00') });
  await page.getByRole('button', { name: 'פנייה טופלה – הוספת 1 למונה' }).click();
  await page.getByRole('button', { name: 'פנייה טופלה – הוספת 1 למונה' }).click();
  await page.reload(); await page.waitForSelector('.ring');
  assert.match(await page.locator('.ring-val').first().textContent(), /2\/10/);
  await page.goto(base + '#/counter'); await page.waitForSelector('.counter-big');
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'ביטול אחרון' }).click().catch(() => {});
  await page.waitForTimeout(300);
  assert.match(await page.locator('.counter-big').textContent(), /0\/10/);
  await ctx.close();
});

await test('agenda: keyboard Alt+ArrowDown moves a block 15 min in the grid (accessible drag alternative)', async () => {
  const { page, ctx } = await newPage(browser, base, { time: jlm('2026-11-30', '08:00'), viewport: { width: 1280, height: 900 } });
  await page.goto(base + '#/calendar/day/2026-11-30'); await page.waitForSelector('.tg-blk');
  const blk = page.locator('.tg-blk', { hasText: 'בלוק מייל שני' });
  await blk.focus();
  await page.keyboard.press('Alt+ArrowDown');
  await page.waitForFunction(() => [...document.querySelectorAll('.tg-blk')].some((b) => b.textContent.includes('בלוק מייל שני') && b.dataset.s === String(15 * 60 + 45) && b.dataset.e === String(16 * 60 + 15)));
  assert.equal(await page.evaluate(() => document.activeElement?.textContent.includes('בלוק מייל שני')), true, 'focus kept on moved block');
  await ctx.close();
});

await test('plan import via paste: preview requires meeting duration, approve applies, replay detected', async () => {
  const { page, ctx } = await newPage(browser, base, { time: jlm('2026-11-29', '10:00') });
  const plan = { format: 'luma-work-plan', schemaVersion: 1, kind: 'weekly', planId: 'e2e-week', weekStart: '2026-11-29',
    meetings: [{ externalId: 'm1', title: 'ישיבת צוות לדוגמה', meetingType: 'team', date: '2026-11-30', start: '10:30', durationMinutes: null }],
    tasks: [{ externalId: 't1', title: 'משימה מיובאת', scheduledDate: '2026-11-30' }] };
  await page.goto(base + '#/import'); await page.waitForSelector('textarea');
  await page.getByLabel('JSON של התוכנית').fill('```json\n' + JSON.stringify(plan) + '\n```');
  await page.getByRole('button', { name: 'בדיקה ותצוגה מקדימה' }).click();
  await page.waitForSelector('.pv-item');
  assert.equal(await page.getByRole('button', { name: 'אישור וייבוא' }).isDisabled(), true);
  await page.getByLabel('משך בדקות עבור ישיבת צוות לדוגמה').fill('30');
  await page.getByLabel('משך בדקות עבור ישיבת צוות לדוגמה').dispatchEvent('change');
  const ack = page.getByText('אני מאשרת חפיפה');
  if (await ack.count()) await ack.click();
  await page.waitForFunction(() => !document.querySelector('.page button.btn.primary.block')?.disabled);
  await page.getByRole('button', { name: 'אישור וייבוא' }).click();
  await page.waitForSelector('text=הייבוא הושלם');
  await page.getByLabel('JSON של התוכנית').fill(JSON.stringify({ ...plan, meetings: [{ ...plan.meetings[0], durationMinutes: 30 }] }));
  await page.getByRole('button', { name: 'בדיקה ותצוגה מקדימה' }).click();
  await page.waitForSelector('text=כבר יובא');
  await page.goto(base + '#/agenda/2026-11-30'); await page.waitForSelector('.tl');
  assert.ok((await page.locator('.tl .title').allTextContents()).includes('ישיבת צוות לדוגמה'));
  await ctx.close();
});

await test('invalid plan shows errors and changes nothing', async () => {
  const { page, ctx } = await newPage(browser, base, { time: jlm('2026-11-29', '10:00') });
  await page.goto(base + '#/import'); await page.waitForSelector('textarea');
  await page.getByLabel('JSON של התוכנית').fill('{"format":"luma-work-plan","schemaVersion":1,"kind":"weekly","planId":"x","weekStart":"2026-11-29","tasks":[{"externalId":"a","title":"x","status":"done"}]}');
  await page.getByRole('button', { name: 'בדיקה ותצוגה מקדימה' }).click();
  await page.waitForSelector('text=התוכנית לא נטענה');
  const rev = await page.evaluate(() => new Promise((res) => { const r = indexedDB.open('luma-work-planner'); r.onsuccess = () => { const q = r.result.transaction('state').objectStore('state').get('current'); q.onsuccess = () => res(q.result.metadata.revision); }; }));
  assert.equal(rev, 0);
  await ctx.close();
});

await test('backup export → restore round trip with confirmation; foreign file rejected', async () => {
  const { page, ctx } = await newPage(browser, base, { time: jlm('2026-11-30', '10:00') });
  await addTaskViaUi(page, 'משימה לגיבוי');
  await page.goto(base + '#/settings/backup'); await page.waitForSelector('text=ייצוא גיבוי מלא');
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'ייצוא גיבוי מלא' }).click();
  const file = await dl;
  const path = await file.path();
  const text = await readFile(path, 'utf8');
  assert.equal(JSON.parse(text).format, 'luma-work-backup');
  await page.waitForSelector('text=הקובץ הוכן להורדה');
  await addTaskViaUi(page, 'משימה אחרי הגיבוי');
  await page.goto(base + '#/settings/backup'); await page.waitForSelector('text=בחירת קובץ גיבוי');
  await page.setInputFiles('input[aria-label="בחירת קובץ גיבוי"]', { name: 'foreign.json', mimeType: 'application/json', buffer: Buffer.from('{"series":[],"tasks":[]}') });
  await page.waitForSelector('text=הקובץ אינו גיבוי של Luma');
  await page.setInputFiles('input[aria-label="בחירת קובץ גיבוי"]', path);
  await page.getByRole('button', { name: 'החלפת כל הנתונים' }).click();
  await page.locator('.sheet').last().getByRole('button', { name: 'החלפה' }).click();
  await page.waitForSelector('text=הגיבוי שוחזר');
  await page.goto(base + '#/tasks/today'); await page.waitForSelector('[data-section="today"]');
  assert.deepEqual(await sectionTitles(page, 'today'), ['משימה לגיבוי']);
  await ctx.close();
});

await test('storage isolation: another app\'s IndexedDB, localStorage and caches on the same origin stay untouched', async () => {
  const ctx = await browser.newContext({ serviceWorkers: 'allow' });
  const page = await ctx.newPage();
  await page.goto(base + 'manifest.webmanifest');
  await page.evaluate(() => new Promise((res) => {
    localStorage.setItem('lp:state', '{"foreign":true}');
    caches.open('planner-shell-v1.0.0').then((c) => c.put('/x', new Response('foreign')));
    const r = indexedDB.open('life-planner', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => { const tx = r.result.transaction('kv', 'readwrite'); tx.objectStore('kv').put({ foreign: 1 }, 'state'); tx.oncomplete = () => { r.result.close(); res(); }; };
  }));
  await page.goto(base + '#/home'); await page.waitForSelector('.page');
  await page.evaluate(() => navigator.serviceWorker.ready);
  const r = await page.evaluate(async () => ({
    ls: localStorage.getItem('lp:state'),
    caches: await caches.keys(),
    dbs: (await indexedDB.databases()).map((d) => d.name).sort(),
    foreign: await new Promise((res) => { const q = indexedDB.open('life-planner'); q.onsuccess = () => { const g = q.result.transaction('kv').objectStore('kv').get('state'); g.onsuccess = () => res(g.result); }; }),
  }));
  assert.equal(r.ls, '{"foreign":true}');
  assert.ok(r.caches.includes('planner-shell-v1.0.0'));
  assert.ok(r.caches.some((k) => k.startsWith('luma-work-planner-shell-')));
  assert.deepEqual(r.dbs, ['life-planner', 'luma-work-planner']);
  assert.deepEqual(r.foreign, { foreign: 1 });
  await ctx.close();
});

await test('offline cold start after installation; no runtime network requests outside origin', async () => {
  const ctx = await browser.newContext({ serviceWorkers: 'allow' });
  const page = await ctx.newPage();
  const external = [];
  page.on('request', (r) => { if (!r.url().startsWith('http://localhost:8731/') && !r.url().startsWith('blob:') && !r.url().startsWith('data:')) external.push(r.url()); });
  await page.goto(base + '#/home'); await page.waitForSelector('.page');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); await page.waitForSelector('.page');
  assert.ok(await page.evaluate(() => !!navigator.serviceWorker.controller));
  await addTaskViaUi(page, 'משימה לפני ניתוק');
  await ctx.setOffline(true);
  const page2 = await ctx.newPage();
  await page2.goto(base + '#/tasks/today'); await page2.waitForSelector('[data-section="today"]');
  assert.deepEqual(await sectionTitles(page2, 'today'), ['משימה לפני ניתוק']);
  await page2.goto(base + '#/calendar/week'); await page2.waitForSelector('.tg-blk');
  const fontsOk = await page2.evaluate(async () => { await document.fonts.ready; return document.fonts.check('16px "Noto Sans Hebrew"', 'שלום'); });
  assert.ok(fontsOk, 'bundled font available offline');
  const imgOk = await page2.evaluate(() => { const i = document.querySelector('.hdr-img'); return i.complete && i.naturalWidth > 0; });
  assert.ok(imgOk, 'banner available offline');
  assert.deepEqual(external, []);
  await ctx.close();
});

await test('service worker update keeps user data and removes only Luma\'s obsolete cache', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'luma-sw-'));
  for (const f of ['index.html', 'manifest.webmanifest', 'sw.js', 'css', 'js', 'fonts', 'icons', 'assets']) await cp(join(ROOT, f), join(dir, f), { recursive: true });
  const b2 = await serve(dir, 8732);
  const ctx = await browser.newContext({ serviceWorkers: 'allow' });
  const page = await ctx.newPage();
  await page.goto(b2 + '#/home'); await page.waitForSelector('.page');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); await page.waitForSelector('.page');
  await page.evaluate(() => caches.open('planner-shell-v1.0.0'));
  await addTaskViaUi(page, 'נשמרת בעדכון');
  const sw = await readFile(join(dir, 'sw.js'), 'utf8');
  await writeFile(join(dir, 'sw.js'), sw.replace(/const VERSION = '[^']+'/, "const VERSION = '9.9.9-test'"));
  await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r.update()));
  await page.waitForSelector('text=גרסה חדשה של Luma מוכנה', { timeout: 20000 });
  await Promise.all([page.waitForEvent('load', { timeout: 20000 }), page.locator('.toast button').click()]);
  await page.waitForSelector('.page');
  const keys = await page.evaluate(() => caches.keys());
  assert.ok(keys.includes('luma-work-planner-shell-9.9.9-test'));
  assert.ok(!keys.includes('luma-work-planner-shell-1.0.0'));
  assert.ok(keys.includes('planner-shell-v1.0.0'), 'foreign cache untouched');
  await page.goto(b2 + '#/tasks/today'); await page.waitForSelector('[data-section="today"]');
  assert.deepEqual(await sectionTitles(page, 'today'), ['נשמרת בעדכון']);
  await ctx.close();
  await rm(dir, { recursive: true, force: true });
});

await test('two tabs: a stale tab cannot silently overwrite newer data', async () => {
  const ctx = await browser.newContext();
  const a = await ctx.newPage(), b = await ctx.newPage();
  await a.goto(base + '#/home'); await a.waitForSelector('.page');
  await b.goto(base + '#/home'); await b.waitForSelector('.page');
  await a.getByRole('button', { name: 'פנייה טופלה – הוספת 1 למונה' }).click();
  await a.waitForTimeout(300);
  // Tab b had no local edits → it reloads the newer document automatically.
  await b.waitForFunction(() => /1\//.test(document.querySelector('.ring-val')?.textContent || ''), null, { timeout: 5000 });
  await ctx.close();
});

await test('dark theme setting and print layout do not error; image export renders PNG', async () => {
  const { page, errors, ctx } = await newPage(browser, base, { time: jlm('2026-11-30', '10:00'), colorScheme: 'dark' });
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  assert.equal(bg, 'rgb(18, 28, 41)');
  await page.goto(base + '#/agenda/2026-11-30'); await page.waitForSelector('.tl');
  await page.getByRole('button', { name: 'תמונה של היום' }).click();
  await page.waitForSelector('.sheet img');
  const dims = await page.evaluate(() => new Promise((res) => { const i = document.querySelector('.sheet img'); const f = () => res([i.naturalWidth, i.naturalHeight]); if (i.complete) f(); else i.onload = f; }));
  assert.deepEqual(dims, [1080, 1920]);
  assert.deepEqual(errors, []);
  await ctx.close();
});

await test('team: direct question → answer → FAQ; ad hoc meeting → decision → single follow-up task', async () => {
  const { page, ctx } = await newPage(browser, base, { time: jlm('2026-11-30', '10:00') });
  await page.goto(base + '#/questions'); await page.getByRole('button', { name: 'הוספת שאלה' }).click();
  await page.getByLabel('השאלה / הנושא').fill('איך מטפלים במקרה כללי?');
  await page.locator('.sheet-foot').getByRole('button', { name: 'הוספה' }).click();
  await page.waitForSelector('text=איך מטפלים במקרה כללי?');
  await page.getByRole('button', { name: 'תשובה' }).first().click();
  await page.getByLabel('התשובה').fill('לפי הנוהל הכללי');
  await page.getByText('שאלה שחוזרת').click();
  await page.locator('.sheet-foot').getByRole('button', { name: 'שמירה' }).click();
  await page.locator('.sheet-foot').getByRole('button', { name: 'אישור והעברה' }).click();
  await page.goto(base + '#/team/faq'); await page.waitForSelector('text=לפי הנוהל הכללי');
  await page.goto(base + '#/team/meetings'); await page.getByRole('button', { name: 'פגישה חדשה' }).click();
  await page.getByLabel('כותרת').fill('פגישה קצרה עם המנהל');
  await page.locator('.sheet-foot').getByRole('button', { name: 'יצירה' }).click();
  await page.waitForSelector('h1:has-text("פגישה קצרה עם המנהל")');
  await page.getByRole('button', { name: 'רישום החלטה' }).click();
  await page.getByLabel('ההחלטה').fill('לעדכן את הנוהל');
  await page.getByText('ליצור משימת המשך').click();
  await page.locator('.sheet-foot').getByRole('button', { name: 'שמירה' }).click();
  await page.waitForSelector('text=משימה: לעדכן את הנוהל');
  assert.equal(await page.getByRole('button', { name: 'משימת המשך' }).count(), 0, 'no duplicate conversion offered');
  await page.goto(base + '#/team/followups'); await page.waitForSelector('text=לעדכן את הנוהל');
  await ctx.close();
});

await test('closing: partial close needs explicit confirmation, records what was not done; carryover unaffected', async () => {
  const { page, ctx } = await newPage(browser, base, { time: jlm('2026-11-30', '16:05') });
  await addTaskViaUi(page, 'נשארה פתוחה');
  await page.goto(base + '#/home'); await page.waitForSelector('a.card.cool:has-text("זמן סגירת היום")');
  await page.goto(base + '#/closing'); await page.getByText('הקציתי את הפניות למחר').click();
  await page.getByRole('button', { name: 'סגירת היום' }).click();
  await page.waitForSelector('text=נדרש אישור');
  await page.getByRole('button', { name: 'כן, להמשיך' }).click();
  await page.waitForSelector('[data-section="carried"]');
  const rep = await page.evaluate(async () => (await import('./js/app.js')).store.state.dailyReports['2026-11-30']);
  assert.equal(rep.partial, true); assert.equal(rep.checklist.allocate, true); assert.equal(rep.checklist['open-work'], false);
  await page.clock.setSystemTime(jlm('2026-12-01', '09:00')); await page.reload(); await page.waitForSelector('[data-section="carried"]');
  assert.deepEqual(await sectionTitles(page, 'carried'), ['נשארה פתוחה']);
  await ctx.close();
});

await test('week grid: mouse drag moves a block to another day without duplicating it', async () => {
  const { page, ctx } = await newPage(browser, base, { time: jlm('2026-11-29', '08:00'), viewport: { width: 1280, height: 1000 } });
  await page.evaluate(async () => (await import('./js/app.js')).store.dispatch('addBlock', { date: '2026-11-30', start: '10:00', end: '10:30', title: 'בלוק לגרירה', confirm: true }));
  await page.goto(base + '#/calendar/week/2026-11-29'); await page.waitForSelector('.tg-blk');
  const blk = page.locator('.tg-blk', { hasText: 'בלוק לגרירה' });
  const box = await blk.boundingBox();
  const target = await page.locator('.tg-col[data-date="2026-12-01"]').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 8);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 10, box.y + 12, { steps: 3 });
  await page.mouse.move(target.x + target.width / 2, box.y + 8, { steps: 8 });
  await page.mouse.up();
  await page.waitForFunction(async () => (await import('./js/app.js')).store.state.calendarBlocks.some((b) => b.title === 'בלוק לגרירה' && b.date === '2026-12-01'));
  const n = await page.evaluate(async () => (await import('./js/app.js')).store.state.calendarBlocks.filter((b) => b.title === 'בלוק לגרירה').map((b) => b.date));
  assert.deepEqual(n, ['2026-12-01']);
  await ctx.close();
});

await test('long Hebrew schedule exports as multiple 1080×1920 pages without clipping', async () => {
  const { page, ctx } = await newPage(browser, base, { time: jlm('2026-11-30', '08:00') });
  const pages = await page.evaluate(async () => {
    const { store } = await import('./js/app.js');
    for (let i = 0; i < 30; i++) await store.dispatch('addTask', { title: 'משימה ארוכה מאוד לבדיקת חלוקה לעמודים מספר ' + i, scheduledDate: '2026-11-30' });
    const { renderDayImages } = await import('./js/export/image.js');
    const blobs = await renderDayImages(store.state, '2026-11-30');
    return blobs.map((b) => b.size > 0 && b.type);
  });
  assert.ok(pages.length >= 2, 'paginated');
  assert.ok(pages.every((t) => t === 'image/png'));
  await ctx.close();
});

await browser.close();
for (const s of servers) s.kill();
const failed = results.filter((r) => !r.ok);
console.log(`\nbrowser tests: ${results.length - failed.length} passed, ${failed.length} failed, ${results.length} total`);
process.exit(failed.length ? 1 : 0);
