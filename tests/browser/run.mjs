// Browser end-to-end tests (dev-only, Playwright). Run: npm run test:browser
// Uses synthetic data and Playwright's fake clock. Starts its own static servers under a
// /luma/ subpath to verify relative paths. Chromium (bundled, else system Chrome) runs the
// full suite; WebKit, when installed (`npx playwright install webkit`), runs the mobile
// layout checks too. Set LUMA_ENGINES=chromium to skip WebKit.
import { chromium, webkit } from 'playwright';
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

/** Instant for a Jerusalem wall time (winter, UTC+2). */
const jlm = (date, time) => new Date(`${date}T${time}:00+02:00`);
const MON = '2026-11-30';

async function test(name, fn) {
  const t0 = Date.now();
  try { await fn(); results.push({ name, ok: true, ms: Date.now() - t0 }); console.log(`✔ ${name}`); }
  catch (e) { results.push({ name, ok: false, err: e }); console.log(`✖ ${name}\n   ${e.stack?.split('\n').slice(0, 4).join('\n   ')}`); }
}

async function newPage(browser, base, { time = jlm(MON, '10:20'), viewport = { width: 390, height: 844 }, colorScheme = 'light', serviceWorkers = 'block', hash = '#/home' } = {}) {
  const ctx = await browser.newContext({ viewport, locale: 'he-IL', timezoneId: 'Europe/London', colorScheme, serviceWorkers, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  if (time) await page.clock.install({ time });
  await page.goto(base + hash);
  await page.waitForSelector('.page');
  return { ctx, page, errors };
}

const go = async (page, base, hash, sel = '.page') => { await page.goto(base + hash); await page.waitForSelector(sel); };
const dispatch = (page, name, payload) => page.evaluate(async ([n, p]) => (await import('./js/app.js')).store.dispatch(n, p).then((r) => r.result ?? r.ok), [name, payload]);
const stateOf = (page) => page.evaluate(async () => (await import('./js/app.js')).store.state);
const sectionTitles = (page, which) => page.locator(`[data-section="${which}"] .item .title`).allTextContents();
const visibleText = (page) => page.evaluate(() => document.body.innerText);

async function addTaskViaUi(page, base, title, { priority = null } = {}) {
  await go(page, base, '#/tasks/today');
  await page.getByRole('button', { name: 'הוספה', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'הוספת משימה' }).click();
  await page.getByLabel('תיאור המשימה').fill(title);
  if (priority) await page.getByRole('radio', { name: priority }).click();
  await page.locator('.sheet-foot').getByRole('button', { name: 'הוספה' }).click();
  await page.waitForSelector('.backdrop', { state: 'detached' });
}

const base = await serve(ROOT, 8731);
const browser = await launch();

await test('boot: Hebrew RTL shell, five tabs, Home shows only date, activity, counter and priorities', async () => {
  const { page, errors, ctx } = await newPage(browser, base);
  assert.equal(await page.getAttribute('html', 'dir'), 'rtl');
  assert.equal(await page.getAttribute('html', 'lang'), 'he');
  assert.deepEqual(await page.locator('nav.nav a').allTextContents(), ['היום שלי', 'סדר היום', 'משימות', 'יומן', 'הגדרות']);
  const blocks = await page.locator('.page.home > *').evaluateAll((els) => els.map((e) => e.className || e.tagName));
  assert.deepEqual(blocks, ['today-date', 'card activity', 'card counter', 'section'], 'approved content only, in order');
  const text = await visibleText(page);
  assert.equal((text.match(/30 בנובמבר/g) || []).length, 1, 'date shown once');
  assert.doesNotMatch(text, /תשפ״|תורנות|במשרד|מהבית|שעות עבודה|התקדמות|קיצורים|התראות פעילות|לא הסתיימו/);
  assert.equal(await page.locator('header [aria-label="חיפוש"], a[href="#/search"]').count(), 0, 'no global search');
  assert.equal(await page.locator('header').getByRole('link', { name: 'התראות' }).count(), 1, 'bell kept');
  assert.match(await page.locator('.activity').textContent(), /מענה לטלפונים ולפניות ב-CRM[\s\S]*נותרו/);
  assert.match(await page.locator('.activity').textContent(), /אחר כך: הפסקה/);
  assert.deepEqual(errors, []);
  await ctx.close();
});

await test('home: outside activity hours shows a concise neutral state; overlapping activities both shown', async () => {
  const { page, ctx } = await newPage(browser, base, { time: jlm(MON, '19:00') });
  assert.equal((await page.locator('.activity').innerText()).trim().replace(/\s+/g, ' '), 'עכשיו אין עוד פעילויות היום');
  await page.clock.setSystemTime(jlm(MON, '10:15'));
  await dispatch(page, 'addBlock', { date: MON, start: '10:00', end: '11:00', title: 'ישיבת צוות' });
  await page.reload(); await page.waitForSelector('.activity');
  assert.deepEqual(await page.locator('.activity h2').allTextContents(), ['מענה לטלפונים ולפניות ב-CRM', 'ישיבת צוות']);
  await ctx.close();
});

await test('header banner + greeting follow Jerusalem time boundaries', async () => {
  const { page, ctx } = await newPage(browser, base, { time: jlm(MON, '07:59') });
  assert.equal(await page.getAttribute('header.hdr', 'data-banner'), 'dawn');
  assert.equal((await page.locator('.greeting').textContent()).trim(), 'בוקר טוב', 'no name is hardcoded');
  await page.clock.runFor(2 * 60 * 1000);
  await page.waitForFunction(() => document.querySelector('header.hdr')?.dataset.banner === 'day');
  for (const [t, img] of [['12:00', 'day'], ['17:00', 'sunset'], ['20:00', 'night']]) {
    await page.clock.setSystemTime(jlm('2026-12-01', t));
    await page.reload(); await page.waitForSelector('.greeting');
    assert.equal(await page.getAttribute('header.hdr', 'data-banner'), img, t);
  }
  await ctx.close();
});

await test('inquiry counter: plus, minus, never below zero, reset with undo, persists', async () => {
  const { page, ctx } = await newPage(browser, base);
  const value = () => page.locator('.ring-val').textContent().then((t) => t.split('/')[0]);
  assert.equal(await page.getByRole('button', { name: 'הפחתת פנייה' }).isDisabled(), true, 'minus disabled at zero');
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'הוספת פנייה' }).click();
  await page.getByRole('button', { name: 'הפחתת פנייה' }).click();
  await page.waitForFunction(() => document.querySelector('.ring-val')?.textContent.startsWith('2/'));
  await page.reload(); await page.waitForSelector('.counter-value');
  assert.equal(await value(), '2');
  assert.match(await page.locator('.counter-value').textContent(), /\/\s*10/);
  await page.locator('.counter .link-btn').click();
  await page.waitForFunction(() => document.querySelector('.ring-val')?.textContent.startsWith('0/'));
  assert.equal(await page.locator('.sheet').count(), 0, 'reversible: no confirmation dialog');
  await page.locator('.toast').getByRole('button', { name: 'ביטול' }).click();
  await page.waitForFunction(() => document.querySelector('.ring-val')?.textContent.startsWith('2/'));
  assert.equal(await value(), '2', 'undo restores the count');
  await page.locator('.counter .link-btn').click();
  await page.waitForFunction(() => document.querySelector('.ring-val')?.textContent.startsWith('0/'));
  const st = await stateOf(page);
  assert.equal(st.inquiryLogs.length, 0, 'no per-tap records');
  await ctx.close();
});

await test('three priorities reference real tasks; completing one updates the Tasks screen', async () => {
  const { page, ctx } = await newPage(browser, base);
  await addTaskViaUi(page, base, 'משימה חשובה');
  await go(page, base, '#/home');
  await page.getByRole('button', { name: 'בחירת משימה' }).click();
  await page.locator('.choice', { hasText: 'משימה חשובה' }).click();
  await page.waitForSelector('[data-section="priorities"] .item');
  await page.locator('[data-section="priorities"] .cb').click();
  await page.waitForSelector('[data-section="priorities"] .item.done');
  await go(page, base, '#/tasks/today', '[data-section="today"]');
  assert.deepEqual(await sectionTitles(page, 'today'), [], 'gone from open sections');
  await go(page, base, '#/tasks/done', '[data-section="done"]');
  assert.deepEqual(await page.locator('[data-section="done"] .title').allTextContents(), ['משימה חשובה']);
  assert.equal((await stateOf(page)).tasks.length, 1, 'one record');
  await ctx.close();
});

await test('carryover: unchecked Monday task appears Tuesday under "לא הסתיימו" on Tasks (not Home), no clone, weekend skipped', async () => {
  const { page, ctx } = await newPage(browser, base, { time: jlm(MON, '10:00') });
  await addTaskViaUi(page, base, 'משימת בדיקה א');
  assert.deepEqual(await sectionTitles(page, 'today'), ['משימת בדיקה א']);
  assert.deepEqual(await sectionTitles(page, 'carried'), []);
  await page.clock.setSystemTime(jlm('2026-12-01', '09:05'));
  await page.reload(); await page.waitForSelector('[data-section="carried"]');
  assert.deepEqual(await sectionTitles(page, 'carried'), ['משימת בדיקה א']);
  assert.deepEqual(await sectionTitles(page, 'today'), []);
  assert.match(await page.locator('[data-section="carried"] .meta').first().textContent(), /30 בנובמבר/);
  await go(page, base, '#/home');
  assert.equal(await page.locator('[data-section="carried"]').count(), 0, 'not on Home');
  await page.clock.setSystemTime(jlm('2026-12-06', '09:05'));
  await go(page, base, '#/tasks/today', '[data-section="carried"]');
  await page.reload(); await page.waitForSelector('[data-section="carried"]');
  assert.deepEqual(await sectionTitles(page, 'carried'), ['משימת בדיקה א'], 'still there after days closed');
  assert.equal((await stateOf(page)).tasks.length, 1, 'no duplicate records');
  await page.locator('[data-section="carried"] .cb').first().click();
  await page.waitForFunction(() => !document.querySelector('[data-section="carried"] .item'));
  await ctx.close();
});

await test('tasks: search by title and note, priority sort both ways, filters behind the menu', async () => {
  const { page, ctx } = await newPage(browser, base);
  await dispatch(page, 'addTask', { title: 'נמוכה', priority: 'low', scheduledDate: MON });
  await dispatch(page, 'addTask', { title: 'גבוהה', priority: 'high', scheduledDate: MON, details: 'מילת חיפוש' });
  await dispatch(page, 'addTask', { title: 'בינונית', priority: 'medium', scheduledDate: MON });
  await dispatch(page, 'addTask', { title: 'מחר', scheduledDate: '2026-12-01' });
  await go(page, base, '#/tasks/today', '[data-section="today"]');
  assert.deepEqual(await page.getByRole('radiogroup', { name: 'תצוגת משימות' }).getByRole('radio').allTextContents(), ['היום', 'הושלמו']);
  assert.deepEqual(await sectionTitles(page, 'today'), ['גבוהה', 'בינונית', 'נמוכה']);
  await page.getByLabel('מיון לפי עדיפות').selectOption('low');
  assert.deepEqual(await sectionTitles(page, 'today'), ['נמוכה', 'בינונית', 'גבוהה']);
  await page.getByLabel('חיפוש במשימות').fill('מילת');
  assert.deepEqual(await sectionTitles(page, 'today'), ['גבוהה'], 'note is searched');
  await page.getByLabel('חיפוש במשימות').fill('');
  await page.getByRole('button', { name: 'מסננים נוספים' }).click();
  const options = await page.locator('.choice').allTextContents();
  assert.deepEqual(options, ['כל המשימות של השבוע', 'משימות למחר', 'לא הסתיימו', 'עתידיות', 'ממתינות לתשובה', 'נדחו', 'בוטלו']);
  await page.locator('.choice', { hasText: 'משימות למחר' }).click();
  await page.waitForSelector('h2.filter-title');
  assert.deepEqual(await page.locator('.tasks-content .title').allTextContents(), ['מחר']);
  assert.equal(await page.locator('text=קטגוריה').count(), 0, 'no category filter');
  await ctx.close();
});

await test('tasks: dedicated add button at the bottom opens the task editor', async () => {
  const { page, ctx } = await newPage(browser, base, { hash: '#/tasks/today' });
  const last = await page.locator('.page > *').last().textContent();
  assert.equal(last.trim(), 'הוספת משימה', 'button is the last element of the screen');
  await page.locator('.page > button', { hasText: 'הוספת משימה' }).click();
  assert.deepEqual(await page.locator('.sheet .field-label').allTextContents(), ['תיאור המשימה', 'עדיפות', 'תאריך ביצוע', 'מועד יעד', 'הערה']);
  await page.getByLabel('תיאור המשימה').fill('נוספה מהכפתור');
  await page.locator('.sheet-foot').getByRole('button', { name: 'הוספה' }).click();
  await page.waitForSelector('[data-section="today"] .title:has-text("נוספה מהכפתור")');
  assert.equal(await page.locator('header').getByRole('button', { name: 'הוספה', exact: true }).count(), 1, 'global + unchanged');
  await ctx.close();
});

await test('counter: resets at Jerusalem midnight while open and after days closed; history in Settings collapsed by default', async () => {
  const { page, ctx } = await newPage(browser, base, { time: jlm(MON, '23:58') });
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'הוספת פנייה' }).click();
  await page.waitForFunction(() => document.querySelector('.ring-val')?.textContent.startsWith('3/'));
  await page.clock.runFor(3 * 60 * 1000); // past midnight, app left open
  await page.waitForFunction(() => document.querySelector('.ring-val')?.textContent.startsWith('0/'), null, { timeout: 10000 });
  await page.getByRole('button', { name: 'הוספת פנייה' }).click();
  await page.clock.setSystemTime(jlm('2026-12-04', '09:00')); // closed for days
  await page.reload(); await page.waitForSelector('.counter-value');
  assert.equal(await page.locator('.ring-val').textContent(), '0/10');
  assert.deepEqual((await stateOf(page)).inquiryCounts, { [MON]: 3, '2026-12-01': 1 }, 'final counts kept, nothing reset twice');
  await go(page, base, '#/settings');
  const details = page.locator('details.history');
  assert.equal(await details.getAttribute('open'), null, 'collapsed by default');
  assert.equal(await page.locator('.history-row').isVisible().catch(() => false), false);
  await page.getByText('היסטוריית פניות').click();
  assert.match(await page.locator('.history-total').textContent(), /סה״כ עד היום:\s*4/);
  assert.deepEqual(await page.locator('.history-row').evaluateAll((rows) => rows.map((r) => r.innerText.replace(/\s+/g, ' ').trim())),
    ['יום שלישי, 1 בדצמבר 2026 1', 'יום שני, 30 בנובמבר 2026 3']);
  await ctx.close();
});

await test('task editor: only description, priority, execution date, deadline, note', async () => {
  const { page, ctx } = await newPage(browser, base);
  await go(page, base, '#/tasks/today');
  await page.getByRole('button', { name: 'הוספה', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'הוספת משימה' }).click();
  assert.deepEqual(await page.locator('.sheet .field-label').allTextContents(), ['תיאור המשימה', 'עדיפות', 'תאריך ביצוע', 'מועד יעד', 'הערה']);
  assert.match(await page.locator('.sheet .date-text').first().textContent(), /יום שני, 30 בנובמבר/);
  await page.getByLabel('תיאור המשימה').fill('עם מועד');
  await page.getByLabel('מועד יעד', { exact: true }).fill('2026-12-03');
  await page.getByLabel('הערה').fill('קצר');
  await page.locator('.sheet-foot').getByRole('button', { name: 'הוספה' }).click();
  await page.waitForSelector('.backdrop', { state: 'detached' });
  const t = (await stateOf(page)).tasks[0];
  assert.deepEqual([t.title, t.scheduledDate, t.deadline, t.details, t.priority], ['עם מועד', MON, '2026-12-03', 'קצר', 'medium']);
  await ctx.close();
});

await test('agenda: list and timeline share data and notes; list menu has exactly four actions', async () => {
  const { page, ctx, errors } = await newPage(browser, base, { hash: `#/agenda/${MON}` });
  assert.equal((await visibleText(page)).match(/30 בנובמבר/g).length, 1, 'date once');
  assert.equal(await page.locator('input[type="date"]').evaluateAll((els) => els.filter((e) => getComputedStyle(e).opacity !== '0').length), 0, 'no separate visible date input (the picker sits invisibly over the date text)');
  await page.getByRole('radio', { name: 'ציר שעות' }).click();
  await page.getByRole('button', { name: 'הוספת פעילות' }).click();
  assert.deepEqual(await page.locator('.sheet .field-label').allTextContents(), ['כותרת', 'תאריך', 'התחלה', 'סיום', 'הערות', 'חזרה']);
  assert.doesNotMatch(await page.locator('.sheet').innerText(), /null|undefined/);
  await page.getByLabel('כותרת').fill('ישיבת צוות');
  await page.getByLabel('התחלה').fill('10:00');
  await page.getByLabel('סיום').fill('11:00');
  await page.locator('.sheet-foot').getByRole('button', { name: 'הוספה' }).click();
  await page.waitForSelector('.tg-blk:has-text("ישיבת צוות")');
  // Side by side: the meeting and the phone block do not cover each other.
  const a = await page.locator('.tg-blk', { hasText: 'ישיבת צוות' }).boundingBox();
  const b = await page.locator('.tg-blk', { hasText: 'מענה לטלפונים' }).boundingBox();
  assert.ok(a.x + a.width <= b.x + 1 || b.x + b.width <= a.x + 1, 'overlapping activities are laid out side by side');
  await page.getByLabel('הערות ליום').fill('הערה משותפת');
  await page.getByRole('radio', { name: 'רשימה' }).click();
  await page.waitForSelector('.tl-card:has-text("ישיבת צוות")');
  assert.equal(await page.getByLabel('הערות ליום').inputValue(), 'הערה משותפת', 'notes shared and saved');
  await page.getByRole('button', { name: 'סימון ״ישיבת צוות״ כהושלם' }).click();
  await page.getByRole('button', { name: 'פעולות עבור הפסקה' }).click();
  assert.deepEqual(await page.locator('.choice').allTextContents(), ['הושלם חלקית', 'דילוג', 'ביטול הפעילות', 'עריכה']);
  await page.locator('.choice', { hasText: 'דילוג' }).click();
  await page.waitForSelector('.tl-card.skipped');
  assert.equal(await page.locator('.tl-card [aria-label^="הוספת משימה"]').count(), 0, 'no add-task inside cards');
  await page.getByRole('radio', { name: 'ציר שעות' }).click();
  await page.waitForSelector('.tg-blk.done:has-text("ישיבת צוות")');
  const text = await visibleText(page);
  assert.doesNotMatch(text, /עיכוב|הצעת תכנון|הדפסה|תמונה של היום|הישגים|גרירה|Alt/);
  assert.deepEqual(errors, []);
  await ctx.close();
});

await test('recurring activity editor: Sun-Thu shown as custom days; changing it asks this time / from now on', async () => {
  const { page, ctx } = await newPage(browser, base, { hash: `#/agenda/${MON}` });
  await page.getByRole('radio', { name: 'רשימה' }).click();
  await page.getByRole('button', { name: 'פעולות עבור טיפול במיילים' }).click();
  await page.locator('.choice', { hasText: 'עריכה' }).click();
  await page.waitForSelector('.sheet .daypick');
  assert.deepEqual(await page.locator('.daypick [aria-pressed="true"]').allTextContents(), ['א', 'ב', 'ג', 'ד', 'ה']);
  await page.getByLabel('התחלה').fill('14:40');
  await page.locator('.sheet-foot').getByRole('button', { name: 'שמירה' }).click();
  await page.locator('.choice', { hasText: 'רק הפעם' }).click();
  await page.waitForSelector('.tl-card:has-text("14:40-15:45")');
  const st = await stateOf(page);
  assert.equal(st.calendarBlocks.find((b) => b.id === 'default-email').start, '14:30', 'series unchanged');
  await ctx.close();
});

await test('grid: keyboard Alt+ArrowDown moves an activity 15 min (accessible drag alternative)', async () => {
  const { page, ctx } = await newPage(browser, base, { time: jlm(MON, '08:00'), viewport: { width: 1280, height: 900 }, hash: `#/calendar/day/${MON}` });
  const blk = page.locator('.tg-blk', { hasText: 'טיפול במיילים' });
  await blk.focus();
  await page.keyboard.press('Alt+ArrowDown');
  await page.waitForFunction(() => [...document.querySelectorAll('.tg-blk')].some((b) => b.textContent.includes('טיפול במיילים') && b.dataset.s === String(14 * 60 + 45)));
  await ctx.close();
});

await test('week grid: mouse drag moves an activity to another day without duplicating it', async () => {
  const { page, ctx } = await newPage(browser, base, { time: jlm('2026-11-29', '08:00'), viewport: { width: 1280, height: 1000 } });
  await dispatch(page, 'addBlock', { date: MON, start: '07:00', end: '07:30', title: 'בלוק לגרירה' });
  await go(page, base, '#/calendar/week/2026-11-29', '.tg-blk');
  const box = await page.locator('.tg-blk', { hasText: 'בלוק לגרירה' }).boundingBox();
  const target = await page.locator('.tg-col[data-date="2026-12-01"]').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 8);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 10, box.y + 12, { steps: 3 });
  await page.mouse.move(target.x + target.width / 2, box.y + 8, { steps: 8 });
  await page.mouse.up();
  await page.waitForFunction(async () => (await import('./js/app.js')).store.state.calendarBlocks.some((b) => b.title === 'בלוק לגרירה' && b.date === '2026-12-01'));
  const n = (await stateOf(page)).calendarBlocks.filter((b) => b.title === 'בלוק לגרירה').map((b) => b.date);
  assert.deepEqual(n, ['2026-12-01']);
  await ctx.close();
});

await test('calendar: month navigation and day tap; week and day show only navigation and grid', async () => {
  const { page, ctx } = await newPage(browser, base, { hash: `#/calendar/month/${MON}` });
  await page.getByRole('button', { name: 'החודש הבא' }).click();
  await page.waitForFunction(() => location.hash.includes('2026-12-30'));
  await page.waitForSelector('.month[aria-label="דצמבר 2026"]');
  assert.equal(await page.getByLabel('חודש', { exact: true }).inputValue(), '12');
  await page.getByRole('button', { name: 'החודש הקודם' }).click();
  await page.waitForFunction(() => location.hash.includes('2026-11-30'));
  await page.waitForSelector('.month[aria-label="נובמבר 2026"]');
  await page.getByLabel('שנה', { exact: true }).fill('2027'); await page.getByLabel('שנה', { exact: true }).dispatchEvent('change');
  await page.waitForFunction(() => location.hash.includes('2027-11-01'));
  await go(page, base, `#/calendar/month/${MON}`);
  assert.equal(await page.locator('.month-card ~ *').count(), 0, 'nothing below the month');
  await page.locator('.mday.out', { hasText: /^3$/ }).click();
  await page.waitForFunction(() => location.hash.startsWith('#/calendar/day/2026-12-03'));
  await page.waitForSelector('.tg.single');
  await go(page, base, '#/calendar/week/2026-11-29', '.tg');
  assert.deepEqual(await page.locator('.page > *').evaluateAll((els) => els.map((e) => e.className)), ['nav-row', 'datenav', 'tg'], 'week: navigation + calendar only');
  assert.doesNotMatch(await visibleText(page), /פניות:|ימי עבודה|משימות השבוע|ייבוא תוכנית|גרירה/);
  await ctx.close();
});

await test('settings: only target, notifications, appearance and links; target saves', async () => {
  const { page, ctx } = await newPage(browser, base, { hash: '#/settings' });
  assert.deepEqual(await page.locator('.section-head h2').allTextContents(), ['יעד פניות יומי', 'התראות', 'תצוגה ונגישות']);
  assert.deepEqual(await page.locator('a.link-row .title').allTextContents(), ['גיבוי ושחזור', 'ייבוא תוכנית מ-ChatGPT', 'עדכונים, אחסון ופרטיות']);
  assert.doesNotMatch(await visibleText(page), /תורנות|קטגוריות|תבנית יום|מתכנן|סגירת יום|כותרת וברכה|מחושבות במכשיר/);
  await page.getByRole('spinbutton', { name: 'יעד פניות יומי' }).fill('12');
  await page.locator('.inline-form').getByRole('button', { name: 'שמירה' }).click();
  await go(page, base, '#/home');
  assert.match(await page.locator('.counter-value').textContent(), /\/\s*12/);
  await ctx.close();
});

await test('notifications: honest state when blocked; when allowed, settings and test notification work through the service worker', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'allow' });
  const page = await ctx.newPage();
  // Record what the app asks the service worker to show (headless browsers do not keep a notification list).
  await page.addInitScript(() => {
    window.__shown = [];
    const orig = ServiceWorkerRegistration.prototype.showNotification;
    ServiceWorkerRegistration.prototype.showNotification = function (title, opts) { window.__shown.push({ title, body: opts.body, tag: opts.tag }); return orig.call(this, title, opts); };
  });
  await page.goto(base + '#/settings'); await page.waitForSelector('.page');
  await page.evaluate(() => navigator.serviceWorker.ready);
  const perm = await page.evaluate(() => Notification.permission);
  if (perm === 'denied') assert.match(await page.locator('.section', { hasText: 'התראות' }).innerText(), /ההתראות חסומות/);
  if (perm === 'default') assert.equal(await page.getByRole('button', { name: 'הפעלת התראות' }).count(), 1, 'permission is requested only from this button');
  await ctx.grantPermissions(['notifications']);
  await page.reload(); await page.waitForSelector('.page');
  await page.getByText('תזכורת בתחילת כל פעילות').click();
  await page.waitForFunction(async () => (await import('./js/app.js')).store.state.settings.notifications.activityStart === true);
  assert.equal((await stateOf(page)).settings.notifications.showDetails, false, 'lock-screen details off by default');
  await page.getByRole('button', { name: 'התראת בדיקה' }).click();
  await page.waitForFunction(() => window.__shown.length > 0);
  assert.deepEqual(await page.evaluate(() => window.__shown), [{ title: 'Luma', body: 'התראת בדיקה', tag: 'luma-test' }]);
  assert.equal(await page.locator('.toast.error').count(), 0, 'no failure reported');
  // Activity-start reminder while open: generic lock-screen text, sent once per occurrence.
  await page.clock.install({ time: jlm(MON, '13:59') });
  await page.reload(); await page.waitForSelector('.page');
  await page.evaluate(() => { window.__shown = []; });
  await page.clock.runFor(70 * 1000);
  await page.waitForFunction(() => window.__shown.length > 0);
  const sent = await page.evaluate(() => window.__shown);
  assert.deepEqual(sent, [{ title: 'Luma', body: 'פעילות מתחילה עכשיו', tag: `luma-default-team@${'2026-11-30'}` }]);
  await page.reload(); await page.waitForSelector('.page'); await page.clock.runFor(5000);
  assert.equal(await page.evaluate(() => window.__shown.length), 0, 'not repeated after reload');
  await ctx.close();
});

await test('plan import via paste: additive with overlap, approve, recurring schedule intact, replay detected', async () => {
  const { page, ctx } = await newPage(browser, base, { time: jlm('2026-11-29', '10:00'), hash: '#/import' });
  const plan = { format: 'luma-work-plan', schemaVersion: 2, kind: 'weekly', planId: 'e2e-week', weekStart: '2026-11-29',
    activities: [{ externalId: 'a1', title: 'ישיבת צוות לדוגמה', date: MON, start: '10:00', end: '11:00' }],
    tasks: [{ externalId: 't1', title: 'משימה מיובאת', scheduledDate: MON, priority: 'high' }] };
  await page.getByLabel('JSON של התוכנית').fill('```json\n' + JSON.stringify(plan) + '\n```');
  await page.getByRole('button', { name: 'בדיקה' }).click();
  await page.waitForSelector('.pv-summary');
  assert.equal(await page.locator('.pv-summary').textContent(), 'משימה חדשה אחת · פעילות חדשה אחת');
  assert.equal(await page.locator('details.pv-details').getAttribute('open'), null, 'items collapsed when nothing needs attention');
  await page.getByText('הצגת הפריטים').click();
  assert.match(await page.locator('.pv-item').first().textContent(), /במקביל ל-״מענה לטלפונים/);
  await page.waitForFunction(() => !document.querySelector('button.btn.primary.block')?.disabled);
  await page.getByRole('button', { name: 'ייבוא', exact: true }).click();
  await page.waitForSelector('text=הייבוא הושלם');
  await page.getByLabel('JSON של התוכנית').fill(JSON.stringify(plan));
  await page.getByRole('button', { name: 'בדיקה' }).click();
  await page.waitForSelector('text=התוכנית הזו כבר יובאה');
  await go(page, base, `#/agenda/${MON}`);
  await page.getByRole('radio', { name: 'רשימה' }).click();
  const titles = await page.locator('.tl-card .title').allTextContents();
  assert.equal(titles.length, 9);
  assert.ok(titles.includes('ישיבת צוות לדוגמה') && titles.includes('מענה לטלפונים ולפניות ב-CRM'));
  await ctx.close();
});

await test('invalid plan shows errors and changes nothing', async () => {
  const { page, ctx } = await newPage(browser, base, { time: jlm('2026-11-29', '10:00'), hash: '#/import' });
  const rev = (await stateOf(page)).metadata.revision;
  await page.getByLabel('JSON של התוכנית').fill('{"format":"luma-work-plan","schemaVersion":2,"kind":"weekly","planId":"x","weekStart":"2026-11-29","tasks":[{"externalId":"a","title":"x","status":"done"}]}');
  await page.getByRole('button', { name: 'בדיקה' }).click();
  await page.waitForSelector('text=התוכנית לא נטענה');
  assert.equal((await stateOf(page)).metadata.revision, rev);
  await ctx.close();
});

await test('backup export → restore round trip with confirmation; foreign file rejected', async () => {
  const { page, ctx } = await newPage(browser, base);
  await addTaskViaUi(page, base, 'משימה לגיבוי');
  await go(page, base, '#/settings/backup');
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'ייצוא גיבוי' }).click();
  const path = await (await dl).path();
  const text = await readFile(path, 'utf8');
  assert.equal(JSON.parse(text).format, 'luma-work-backup');
  assert.equal(JSON.parse(text).data.metadata.schemaVersion, 2);
  await page.waitForSelector('text=הקובץ הוכן להורדה');
  await addTaskViaUi(page, base, 'משימה אחרי הגיבוי');
  await go(page, base, '#/settings/backup');
  await page.setInputFiles('input[aria-label="בחירת קובץ גיבוי"]', { name: 'foreign.json', mimeType: 'application/json', buffer: Buffer.from('{"series":[],"tasks":[]}') });
  await page.waitForSelector('text=הקובץ אינו גיבוי של Luma');
  await page.setInputFiles('input[aria-label="בחירת קובץ גיבוי"]', path);
  await page.getByRole('button', { name: 'החלפת כל הנתונים' }).click();
  await page.locator('.sheet').last().getByRole('button', { name: 'החלפה' }).click();
  await page.waitForSelector('text=הגיבוי שוחזר');
  await go(page, base, '#/tasks/today', '[data-section="today"]');
  assert.deepEqual(await sectionTitles(page, 'today'), ['משימה לגיבוי']);
  await ctx.close();
});

/** Synthetic one-finger swipe (Touch events) from (x0, y0) by (dx, dy) on an element. */
async function swipe(page, selector, { x0 = null, y0 = null, dx = 0, dy = 0, during = null } = {}) {
  await page.evaluate(async ({ selector, x0, y0, dx, dy, during }) => {
    const el = document.querySelector(selector);
    const r = el.getBoundingClientRect();
    const sx = x0 ?? r.left + r.width / 2, sy = y0 ?? r.top + Math.min(r.height / 2, 200);
    const target = document.elementFromPoint(sx, sy) || el;
    const touch = (x, y) => new Touch({ identifier: 1, target, clientX: x, clientY: y, pageX: x, pageY: y });
    const fire = (type, t) => target.dispatchEvent(new TouchEvent(type, { touches: type === 'touchend' ? [] : [t], changedTouches: [t], bubbles: true, cancelable: true }));
    fire('touchstart', touch(sx, sy));
    if (during === 'scrollGrid') { const g = document.querySelector('.tg'); g.scrollLeft = g.scrollLeft - 40; }
    fire('touchmove', touch(sx + dx / 2, sy + dy / 2));
    fire('touchend', touch(sx + dx, sy + dy));
  }, { selector, x0, y0, dx, dy, during });
  await page.waitForTimeout(120);
}

await test('agenda: current activities highlighted with "עכשיו" (all of them when overlapping); completed muted; follows the clock', async () => {
  const { page, ctx } = await newPage(browser, base, { time: jlm(MON, '10:20'), hash: `#/agenda/${MON}` });
  await dispatch(page, 'addBlock', { date: MON, start: '10:00', end: '11:00', title: 'ישיבת צוות' });
  await dispatch(page, 'setBlockStatus', { occId: `default-opening@${MON}`, status: 'done' });
  await page.getByRole('radio', { name: 'רשימה' }).click();
  await page.waitForSelector('.tl-card.current');
  assert.deepEqual(await page.locator('.tl-card.current .title').allTextContents(), ['מענה לטלפונים ולפניות ב-CRM', 'ישיבת צוות']);
  assert.equal(await page.locator('.tl-card.current .now-chip').count(), 2);
  assert.equal(await page.locator('.now-chip').count(), 2, 'only current activities carry the label');
  const done = page.locator('.tl-card.done .title').first();
  assert.equal(await done.evaluate((e) => getComputedStyle(e).textDecorationLine), 'none', 'completed stays readable');
  assert.notEqual(await done.evaluate((e) => getComputedStyle(e).color), await page.locator('.tl-card:not(.done) .title').first().evaluate((e) => getComputedStyle(e).color), 'completed is muted');
  await page.clock.runFor(3 * 60 * 60 * 1000); // 13:20, app left open
  await page.waitForFunction(() => [...document.querySelectorAll('.tl-card.current .title')].map((e) => e.textContent).join() === 'הפסקה', null, { timeout: 10000 });
  await ctx.close();
});

await test('undo: completing, skipping, canceling and deleting restore the same record without duplicates; toast stays above the navigation', async () => {
  const { page, ctx } = await newPage(browser, base, { time: jlm(MON, '10:20'), hash: '#/tasks/today' });
  const tid = await dispatch(page, 'addTask', { title: 'משימה לבדיקת ביטול', scheduledDate: MON });
  await page.reload(); await page.waitForSelector('[data-section="today"] .item');
  const undo = async () => { await page.locator('.toast').getByRole('button', { name: 'ביטול' }).click(); await page.waitForSelector('text=בוטל'); };
  // Complete task -> undo.
  await page.locator('[data-section="today"] .cb').first().click();
  await page.waitForSelector('.toast:has-text("המשימה הושלמה")');
  const toast = await page.locator('.toast').boundingBox(), nav = await page.locator('nav.nav').boundingBox();
  assert.ok(toast.y + toast.height <= nav.y, 'toast above the bottom navigation');
  await undo();
  let st = await stateOf(page);
  assert.deepEqual(st.tasks.map((t) => [t.id, t.status]), [[tid, 'todo']]);
  // Delete task from the editor: no confirmation, undo restores the same record.
  await page.locator('[data-section="today"] button.link').first().click();
  await page.locator('.sheet-foot').getByRole('button', { name: 'מחיקה' }).click();
  await page.waitForSelector('.toast:has-text("המשימה נמחקה")');
  assert.equal((await stateOf(page)).tasks.length, 0);
  await undo();
  st = await stateOf(page);
  assert.deepEqual(st.tasks.map((t) => t.id), [tid], 'same ID, no duplicate');
  // Activities: complete, skip, cancel -> undo each.
  await go(page, base, `#/agenda/${MON}`);
  await page.getByRole('radio', { name: 'רשימה' }).click();
  const occ = `default-team@${MON}`;
  await page.getByRole('button', { name: 'סימון ״זמן קבלה לשאלות של הצוות״ כהושלם' }).click();
  await page.waitForSelector('.toast:has-text("הפעילות הושלמה")');
  await undo();
  assert.equal((await stateOf(page)).blockCompletions[occ], undefined);
  for (const [label, msg] of [['דילוג', 'הפעילות דולגה'], ['ביטול הפעילות', 'הפעילות בוטלה']]) {
    await page.getByRole('button', { name: 'פעולות עבור זמן קבלה לשאלות של הצוות' }).click();
    await page.locator('.choice', { hasText: label }).click();
    await page.waitForSelector(`.toast:has-text("${msg}")`);
    await undo();
    assert.equal((await stateOf(page)).blockCompletions[occ], undefined, label);
  }
  // Delete a one-off activity: undo restores it.
  const bid = await dispatch(page, 'addBlock', { date: MON, start: '17:00', end: '17:30', title: 'פעילות למחיקה' });
  await page.reload(); await page.waitForSelector('.tl-card');
  await page.getByRole('button', { name: 'פעולות עבור פעילות למחיקה' }).click();
  await page.locator('.choice', { hasText: 'עריכה' }).click();
  await page.locator('.sheet-foot').getByRole('button', { name: 'מחיקה' }).click();
  await page.waitForSelector('.toast:has-text("הפעילות נמחקה")');
  await undo();
  st = await stateOf(page);
  assert.deepEqual(st.calendarBlocks.filter((b) => b.title === 'פעילות למחיקה').map((b) => b.id), [bid]);
  assert.equal(st.calendarBlocks.filter((b) => b.id.startsWith('default-')).length, 8, 'schedule intact');
  await ctx.close();
});

await test('swipe: right = next, left = previous (RTL) in agenda and calendar; no navigation from drags, vertical moves, edges or a scrolled grid', async () => {
  const { page, ctx } = await newPage(browser, base, { time: jlm(MON, '10:20'), hash: `#/agenda/${MON}` });
  const hash = () => page.evaluate(() => location.hash);
  await page.getByRole('radio', { name: 'רשימה' }).click();
  await swipe(page, '.timeline', { dx: 120 });
  assert.equal(await hash(), '#/agenda/2026-12-01');
  await swipe(page, '.timeline', { dx: -120 });
  assert.equal(await hash(), `#/agenda/${MON}`);
  await swipe(page, '.timeline', { dx: 40, dy: 160 });
  assert.equal(await hash(), `#/agenda/${MON}`, 'vertical scroll is not a swipe');
  await swipe(page, '.timeline', { x0: 8, dx: 150 });
  assert.equal(await hash(), `#/agenda/${MON}`, 'edge gestures are left to iOS');
  await page.getByRole('radio', { name: 'ציר שעות' }).click();
  await swipe(page, '.tg-blk', { dx: 120 });
  assert.equal(await hash(), `#/agenda/${MON}`, 'touching an activity never navigates');
  await go(page, base, `#/calendar/month/${MON}`);
  await swipe(page, '.month', { dx: 140 });
  assert.match(await hash(), /#\/calendar\/month\/2026-12-30/);
  await go(page, base, '#/calendar/week/2026-11-29', '.tg');
  await swipe(page, '.tg-head', { dx: -140, during: 'scrollGrid' });
  assert.equal(await hash(), '#/calendar/week/2026-11-29', 'a swipe that scrolls the grid stays on the week');
  await swipe(page, '.tg-head', { dx: -140 });
  assert.equal(await hash(), '#/calendar/week/2026-11-22');
  await go(page, base, `#/calendar/day/${MON}`, '.tg');
  await swipe(page, '.datenav', { dx: 140 });
  assert.equal(await hash(), '#/calendar/day/2026-12-01');
  await ctx.close();
});

await test('ring counter, remembered modes, kept scroll position, reduced motion', async () => {
  const { page, ctx } = await newPage(browser, base, { time: jlm(MON, '10:20') });
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'הוספת פנייה' }).click();
  await page.waitForFunction(() => document.querySelector('.ring-val')?.textContent === '3/10');
  assert.equal(await page.locator('.counter .ring').getAttribute('aria-label'), '3 מתוך 10');
  const off = await page.locator('.ring-arc').evaluate((e) => [Number(e.getAttribute('stroke-dasharray')), Number(e.getAttribute('stroke-dashoffset'))]);
  assert.ok(Math.abs(off[1] / off[0] - 0.7) < 0.001, 'arc shows 30%');
  assert.equal(await page.locator('.counter .progress').count(), 0, 'no bar besides the ring');
  // Calendar tab reopens the last mode; agenda keeps its mode.
  await go(page, base, '#/calendar/week');
  await page.locator('nav.nav a[data-nav="home"]').click(); await page.waitForSelector('.page.home');
  await page.locator('nav.nav a[data-nav="calendar"]').click();
  await page.waitForFunction(() => location.hash.startsWith('#/calendar/week'));
  // Scroll position survives completing a task.
  for (let i = 0; i < 25; i++) await dispatch(page, 'addTask', { title: `משימה ${i}`, scheduledDate: MON });
  await go(page, base, '#/tasks/today', '[data-section="today"]');
  await page.evaluate(() => window.scrollTo(0, 900));
  const y0 = await page.evaluate(() => window.scrollY);
  await page.locator('[data-section="today"] .cb').nth(12).click();
  await page.waitForSelector('.toast');
  assert.ok(Math.abs((await page.evaluate(() => window.scrollY)) - y0) < 4, 'scroll kept');
  await ctx.close();
  const reduced = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const rp = await reduced.newPage();
  await rp.goto(base + '#/home'); await rp.waitForSelector('.page');
  await rp.goto(base + '#/tasks/today'); await rp.waitForSelector('.page.enter');
  assert.equal(await rp.locator('.page.enter').evaluate((e) => getComputedStyle(e).animationName), 'none');
  await reduced.close();
});

await test('security: hostile text from an import renders as text; search never reaches localStorage; retired keys purged', async () => {
  const { page, ctx, errors } = await newPage(browser, base, { hash: '#/import' });
  await page.addInitScript(() => { window.__pwned = 0; });
  await page.evaluate(() => { localStorage.setItem('luma-work-planner:ui', JSON.stringify({ taskSearch: 'old private query', taskSort: 'low' })); });
  const evil = '<img src=x onerror="window.__pwned=1">';
  const plan = { format: 'luma-work-plan', schemaVersion: 2, kind: 'dailyPatch', planId: 'xss', activities: [{ externalId: 'a', title: evil, date: MON, start: '15:00', end: '15:30', notes: '<script>window.__pwned=2</script>' }], tasks: [{ externalId: 't', title: evil, scheduledDate: MON, notes: '<svg onload="window.__pwned=3">' }] };
  await page.getByLabel('JSON של התוכנית').fill(JSON.stringify(plan));
  await page.getByRole('button', { name: 'בדיקה' }).click();
  await page.waitForSelector('.pv-summary');
  await page.getByRole('button', { name: 'ייבוא', exact: true }).click();
  await page.waitForSelector('text=הייבוא הושלם');
  for (const h of [`#/agenda/${MON}`, '#/tasks/today', '#/home']) { await page.reload(); await go(page, base, h); }
  await go(page, base, `#/agenda/${MON}`);
  await page.getByRole('radio', { name: 'רשימה' }).click();
  assert.ok((await page.locator('.tl-card .title').allTextContents()).includes(evil), 'shown literally');
  await go(page, base, '#/tasks/today', '[data-section="today"]');
  assert.deepEqual(await sectionTitles(page, 'today'), [evil]);
  assert.equal(await page.evaluate(() => document.querySelectorAll('main img, main script, main svg[onload]').length), 0, 'no injected elements');
  assert.equal(await page.evaluate(() => window.__pwned), 0, 'no script ran');
  await page.getByLabel('חיפוש במשימות').fill('מילה פרטית');
  const ls = await page.evaluate(() => JSON.stringify(localStorage));
  assert.doesNotMatch(ls, /מילה פרטית|old private query|taskSearch/);
  assert.match(ls, /taskSort/, 'harmless view preferences remain');
  assert.deepEqual(errors, [], JSON.stringify(errors));
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
    ls: localStorage.getItem('lp:state'), caches: await caches.keys(), dbs: (await indexedDB.databases()).map((d) => d.name).sort(),
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
  await addTaskViaUi(page, base, 'משימה לפני ניתוק');
  await ctx.setOffline(true);
  const page2 = await ctx.newPage();
  await page2.goto(base + '#/tasks/today'); await page2.waitForSelector('[data-section="today"]');
  assert.deepEqual(await sectionTitles(page2, 'today'), ['משימה לפני ניתוק']);
  await page2.goto(base + '#/calendar/week'); await page2.waitForSelector('.tg');
  await page2.goto(base + '#/import'); await page2.waitForSelector('textarea');
  const fontsOk = await page2.evaluate(async () => { await document.fonts.ready; return document.fonts.check('16px "Noto Sans Hebrew"', 'שלום'); });
  assert.ok(fontsOk, 'bundled font available offline');
  assert.ok(await page2.evaluate(() => { const i = document.querySelector('.hdr-img'); return i.complete && i.naturalWidth > 0; }), 'banner available offline');
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
  const oldCache = (await page.evaluate(() => caches.keys())).find((k) => k.startsWith('luma-work-planner-shell-'));
  await page.evaluate(() => caches.open('planner-shell-v1.0.0'));
  await addTaskViaUi(page, b2, 'נשמרת בעדכון');
  const sw = await readFile(join(dir, 'sw.js'), 'utf8');
  await writeFile(join(dir, 'sw.js'), sw.replace(/const VERSION = '[^']+'/, "const VERSION = '9.9.9-test'"));
  await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r.update()));
  await page.waitForSelector('text=גרסה חדשה של Luma מוכנה', { timeout: 20000 });
  await Promise.all([page.waitForEvent('load', { timeout: 20000 }), page.locator('.toast button').click()]);
  await page.waitForSelector('.page');
  const keys = await page.evaluate(() => caches.keys());
  assert.ok(keys.includes('luma-work-planner-shell-9.9.9-test'));
  assert.ok(!keys.includes(oldCache));
  assert.ok(keys.includes('planner-shell-v1.0.0'), 'foreign cache untouched');
  await page.goto(b2 + '#/tasks/today'); await page.waitForSelector('[data-section="today"]');
  assert.deepEqual(await sectionTitles(page, 'today'), ['נשמרת בעדכון']);
  await ctx.close();
  await rm(dir, { recursive: true, force: true });
});

await test('upgrade from an installed v1: existing IndexedDB data is migrated in the browser without loss', async () => {
  const { v1Document } = await import('../fixtures.js');
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.clock.install({ time: jlm('2026-11-27', '10:00') });
  await page.goto(base + 'manifest.webmanifest');
  await page.evaluate((doc) => new Promise((res) => {
    const r = indexedDB.open('luma-work-planner', 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('state'); r.result.createObjectStore('recovery', { keyPath: 'id' }); };
    r.onsuccess = () => { const tx = r.result.transaction('state', 'readwrite'); tx.objectStore('state').put(doc, 'current'); tx.oncomplete = () => { r.result.close(); res(); }; };
  }), v1Document());
  await page.goto(base + '#/tasks/unfinished'); await page.waitForSelector('.page');
  assert.deepEqual(await page.locator('.tasks-content .title').allTextContents(), ['משימה ישנה']);
  const st = await stateOf(page);
  assert.equal(st.metadata.schemaVersion, 2);
  assert.equal(st.questions.length, 1, 'legacy records kept');
  await go(page, base, '#/agenda/2026-11-29');
  assert.equal(await page.locator('.tl-card').count(), 8);
  await ctx.close();
});

await test('two tabs: a tab without local edits picks up the other tab\'s change', async () => {
  const ctx = await browser.newContext();
  const a = await ctx.newPage(), b = await ctx.newPage();
  await a.goto(base + '#/home'); await a.waitForSelector('.counter-value');
  await b.goto(base + '#/home'); await b.waitForSelector('.counter-value');
  await a.getByRole('button', { name: 'הוספת פנייה' }).click();
  await b.waitForFunction(() => document.querySelector('.ring-val')?.textContent.startsWith('1/'), null, { timeout: 5000 });
  await ctx.close();
});

await test('dark theme renders without errors', async () => {
  const { page, errors, ctx } = await newPage(browser, base, { colorScheme: 'dark' });
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(18, 28, 41)');
  for (const h of [`#/agenda/${MON}`, '#/tasks/today', '#/calendar/week', '#/settings']) await go(page, base, h);
  assert.deepEqual(errors, []);
  await ctx.close();
});

/** Layout checks on all major screens for one engine and width. */
async function layoutChecks(engineName, br, width) {
  await test(`${engineName} ${width}px: no horizontal overflow, no null/undefined text, touch-action on controls, forms fit`, async () => {
    const ctx = await br.newContext({ viewport: { width, height: 780 }, locale: 'he-IL', hasTouch: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(() => { window.__csp = []; document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`)); });
    await page.clock.install({ time: jlm(MON, '10:20') });
    await page.goto(base + '#/home'); await page.waitForSelector('.page');
    await dispatch(page, 'addTask', { title: 'משימה עם כותרת ארוכה במיוחד כדי לבדוק שבירת שורות במסך צר', scheduledDate: MON, deadline: '2026-12-03' });
    await dispatch(page, 'addBlock', { date: MON, start: '10:00', end: '11:00', title: 'ישיבת צוות' });
    const routes = ['#/home', `#/agenda/${MON}`, '#/tasks/today', '#/tasks/done', `#/calendar/month/${MON}`, '#/calendar/week/2026-11-29', `#/calendar/day/${MON}`, '#/settings', '#/settings/backup', '#/settings/about', '#/import', '#/alerts'];
    for (const r of routes) {
      await go(page, base, r);
      const res = await page.evaluate(() => {
        const over = document.documentElement.scrollWidth - document.documentElement.clientWidth;
        const bad = /\bnull\b|\bundefined\b|NaN/.test(document.body.innerText);
        const dash = /[\u2013\u2014\u05BE]/.test(document.body.innerText + document.title);
        const ctl = [...document.querySelectorAll('button, a')].filter((e) => e.offsetParent).find((e) => !['manipulation', 'none'].includes(getComputedStyle(e).touchAction));
        return { over, bad, dash, ctl: ctl ? ctl.outerHTML.slice(0, 80) : null };
      });
      assert.ok(res.over <= 0, `${r}: horizontal overflow ${res.over}px`);
      assert.equal(res.bad, false, `${r}: null/undefined text`);
      assert.equal(res.dash, false, `${r}: em dash, en dash or maqaf in visible text`);
      assert.equal(res.ctl, null, `${r}: control without touch-action`);
      assert.deepEqual(await page.evaluate(() => window.__csp), [], `${r}: Content-Security-Policy violation`);
    }
    // Both editors: every field stays inside the sheet; inputs use ≥16px text (no focus zoom).
    for (const [hash, open] of [[`#/agenda/${MON}`, async () => { await page.getByRole('radio', { name: 'ציר שעות' }).click(); await page.getByRole('button', { name: 'הוספת פעילות' }).click(); }],
      ['#/tasks/today', async () => { await page.getByRole('button', { name: 'הוספה', exact: true }).click(); await page.getByRole('dialog').getByRole('button', { name: 'הוספת משימה' }).click(); }]]) {
      await go(page, base, hash);
      await open();
      await page.waitForSelector('.sheet .field');
      await page.waitForTimeout(300);
      const fit = await page.evaluate(() => {
        const sheet = document.querySelector('.sheet').getBoundingClientRect();
        const body = document.querySelector('.sheet-body');
        const out = [...document.querySelectorAll('.sheet .input, .sheet .date-field, .sheet .seg')].filter((e) => { const r = e.getBoundingClientRect(); return r.left < sheet.left - 0.5 || r.right > sheet.right + 0.5; }).length;
        const small = [...document.querySelectorAll('.sheet input, .sheet textarea, .sheet select')].filter((e) => parseFloat(getComputedStyle(e).fontSize) < 16).length;
        return { out, small, hscroll: body.scrollWidth > body.clientWidth };
      });
      assert.deepEqual(fit, { out: 0, small: 0, hscroll: false }, `${hash} editor`);
      await page.keyboard.press('Escape');
      await page.waitForSelector('.backdrop', { state: 'detached' });
    }
    // Safe areas: header and bottom navigation are padded with the device insets.
    const css = await page.evaluate(() => ({ hdr: getComputedStyle(document.querySelector('.hdr-in')).paddingTop, nav: getComputedStyle(document.querySelector('.nav')).paddingBottom }));
    assert.ok(parseFloat(css.hdr) >= 8 && parseFloat(css.nav) >= 6);
    assert.deepEqual(errors, []);
    await ctx.close();
  });
}
for (const w of [320, 390, 430]) await layoutChecks('chromium', browser, w);
await test('viewport allows pinch zoom (no maximum-scale / user-scalable=no)', async () => {
  const html = await readFile(join(ROOT, 'index.html'), 'utf8');
  const vp = /<meta name="viewport" content="([^"]+)"/.exec(html)[1];
  assert.doesNotMatch(vp, /user-scalable\s*=\s*no|maximum-scale/);
  assert.match(vp, /viewport-fit=cover/);
});

let wk = null;
if (process.env.LUMA_ENGINES !== 'chromium') {
  try { wk = await webkit.launch(); } catch { console.log('- WebKit not installed: WebKit layout checks skipped (npx playwright install webkit)'); }
}
if (wk) {
  for (const w of [320, 390]) await layoutChecks('webkit', wk, w);
  await test('webkit: a first install never offers an "update" (even when navigating during installation)', async () => {
    for (let i = 0; i < 3; i++) {
      const ctx = await wk.newContext({ viewport: { width: 390, height: 844 } });
      const page = await ctx.newPage();
      await page.goto(base + '#/home'); await page.waitForSelector('.page');
      await page.goto(base + '#/tasks/today'); await page.waitForSelector('.page');
      await page.waitForTimeout(2000);
      assert.equal(await page.locator('text=גרסה חדשה של Luma מוכנה').count(), 0, `run ${i + 1}`);
      assert.ok(await page.evaluate(() => !!navigator.serviceWorker.controller), 'installed and controlling');
      await ctx.close();
    }
  });
  await wk.close();
}

await browser.close();
for (const s of servers) s.kill();
const failed = results.filter((r) => !r.ok);
console.log(`\nbrowser tests: ${results.length - failed.length} passed, ${failed.length} failed, ${results.length} total`);
process.exit(failed.length ? 1 : 0);
