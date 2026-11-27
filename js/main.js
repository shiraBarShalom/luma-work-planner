// Boot, storage selection, application shell, router, live header and lifecycle.
import { h, ic, icon, toast, closeAllSheets, sheetOpen, btn, confirmDialog, openSheet } from './ui.js';
import { createStore } from './store.js';
import { createIdbAdapter, createLocalStorageAdapter, createMemoryAdapter } from './db.js';
import { bindStore, store } from './app.js';
import { clock } from './clock.js';
import { uid } from './ids.js';
import { today, zonedParts } from './dates.js';
import { headerFor, minutesToNextBoundary } from './engine/header.js';
import { computeAlerts } from './engine/alerts.js';
import { migrateState } from './data/migrations.js';
import { parseBackup } from './data/backup.js';
import { applyTheme, registerServiceWorker, requestPersistence } from './platform.js';
import { scheduleReminders } from './notifications.js';
import { quickAdd, openTaskEditor } from './editors.js';
import { downloadBlob } from './export/share.js';
import * as today_ from './views/today.js';
import * as agenda from './views/agenda.js';
import * as tasks from './views/tasks.js';
import * as calendar from './views/calendar.js';
import * as settings from './views/settings.js';
import * as alertsView from './views/alerts.js';
import * as importView from './views/importView.js';

const ROUTES = {
  home: { view: today_.render, title: 'היום שלי', nav: 'home', header: 'home', live: true },
  agenda: { view: agenda.render, title: 'סדר היום', nav: 'agenda', live: true },
  tasks: { view: tasks.render, title: 'משימות', nav: 'tasks' },
  task: { view: (m, a, c) => { tasks.render(m, ['today'], c); const t = store.state.tasks.find((x) => x.id === a[0]); if (t) openTaskEditor(t); }, title: 'משימות', nav: 'tasks' },
  calendar: { view: calendar.render, title: 'יומן', nav: 'calendar', live: true },
  settings: { view: settings.render, title: 'הגדרות', nav: 'settings' },
  import: { view: importView.render, title: 'ייבוא תוכנית', nav: 'settings' },
  alerts: { view: alertsView.render, title: 'התראות', back: true },
};
const NAV = [
  { id: 'home', label: 'היום שלי', icon: 'house', href: '#/home' },
  { id: 'agenda', label: 'סדר היום', icon: 'list', href: '#/agenda' },
  { id: 'tasks', label: 'משימות', icon: 'squareCheck', href: '#/tasks/today' },
  { id: 'calendar', label: 'יומן', icon: 'calendar', href: '#/calendar/month' },
  { id: 'settings', label: 'הגדרות', icon: 'settings', href: '#/settings' },
];

let headerEl, mainEl, bannerEl, lastKey = '', lastDate = null, headerTimer = null;

function parseRoute() {
  const parts = (location.hash || '#/home').replace(/^#\/?/, '').split('/').filter(Boolean).map((p) => decodeURIComponent(p));
  const name = ROUTES[parts[0]] ? parts[0] : 'home';
  return { name, args: parts.slice(1) };
}

function ctxNow() {
  const p = zonedParts(clock.now());
  return { date: p.date, minute: p.min, nowIso: clock.iso() };
}

// ---------- header ----------
function renderHeader(route, ctx) {
  const state = store.state;
  const hd = headerFor(state.settings, ctx.minute);
  const isHome = (ROUTES[route.name].header || 'secondary') === 'home';
  const alerts = computeAlerts(state, ctx.date, { nowIso: ctx.nowIso }).filter((a) => a.level !== 'info').length;
  const st = store.status;
  const savePill = st.save === 'saved' ? null : h('span.save-pill' + (st.save === 'error' || st.save === 'conflict' ? '.error' : ''), { role: 'status' }, st.save === 'saving' ? 'שומר…' : st.save === 'conflict' ? 'התנגשות' : 'לא נשמר');
  const actions = h('div.hdr-actions',
    savePill,
    h('a.hdr-btn', { href: '#/alerts', 'aria-label': alerts ? `התראות (${alerts})` : 'התראות' }, h('span', { svg: icon('bell', 22) }), alerts ? h('span.badge', { 'aria-hidden': 'true' }, String(alerts)) : null),
    h('button.hdr-btn', { type: 'button', 'aria-label': 'הוספה', onclick: () => quickAdd(ctx.date), svg: icon('plus', 22) }));
  const brand = h('div.wordmark', { 'aria-label': 'Luma' }, 'Luma');
  const back = ROUTES[route.name].back ? h('button.hdr-btn', { type: 'button', 'aria-label': 'חזרה', onclick: () => (history.length > 1 ? history.back() : (location.hash = '#/home')), svg: icon('right', 22) }) : null;
  const img = h('img.hdr-img', { src: hd.src, alt: '', decoding: 'async', 'aria-hidden': 'true' });
  bannerEl = hd.image;
  headerEl.className = `hdr ${isHome ? 'home' : 'secondary'}${hd.dark ? ' night' : ''}`;
  headerEl.dataset.banner = hd.image;
  headerEl.replaceChildren(img, h('div.hdr-in',
    h('div.hdr-top', h('div.row', back, brand), actions),
    isHome ? h('p.greeting', { 'aria-live': 'polite' }, hd.greeting) : h('h1.hdr-title', ROUTES[route.name].title)));
  scheduleHeaderBoundary();
}

function scheduleHeaderBoundary() {
  clearTimeout(headerTimer);
  const ctx = ctxNow();
  const mins = minutesToNextBoundary(store.state.settings, ctx.minute);
  const sec = zonedParts(clock.now()).sec;
  headerTimer = setTimeout(() => { if (document.visibilityState === 'visible') render({ force: true }); }, Math.max(1000, (mins * 60 - sec) * 1000 + 500));
}

// ---------- focus restoration across re-renders ----------
function focusKey() {
  const a = document.activeElement;
  if (!a || a === document.body || !mainEl.contains(a)) return null;
  return { label: a.getAttribute('aria-label'), text: a.textContent?.trim().slice(0, 40), tag: a.tagName };
}
function restoreFocus(k) {
  if (!k) return;
  let el = null;
  if (k.label) el = mainEl.querySelector(`[aria-label="${CSS.escape(k.label)}"]`);
  if (!el && k.text) el = [...mainEl.querySelectorAll(k.tag)].find((x) => x.textContent?.trim().slice(0, 40) === k.text);
  el?.focus({ preventScroll: true });
}

// ---------- render ----------
// A re-render while a finger/mouse is down would replace the element being tapped and
// swallow the click (e.g. a field saved on blur by the same tap). Such renders wait until
// the click has been delivered.
let queued = false, pointerDown = false, deferred = false;
document.addEventListener('pointerdown', () => { pointerDown = true; }, true);
const release = () => {
  pointerDown = false;
  if (deferred) { deferred = false; setTimeout(() => render(), 0); }
};
document.addEventListener('pointerup', release, true);
document.addEventListener('pointercancel', release, true);
function scheduleRender() {
  if (queued) return;
  queued = true;
  queueMicrotask(() => {
    queued = false;
    if (pointerDown) { deferred = true; return; }
    render();
  });
}

function render({ force = false } = {}) {
  const route = parseRoute();
  const ctx = ctxNow();
  const key = route.name + '/' + route.args.join('/');
  const same = key === lastKey;
  const y = window.scrollY;
  const fk = focusKey();
  lastDate = ctx.date;
  renderHeader(route, ctx);
  try {
    ROUTES[route.name].view(mainEl, route.args, ctx);
  } catch (e) {
    console.error(e);
    mainEl.replaceChildren(h('div.page', h('div.banner.danger', { role: 'alert' }, ic('alert'), h('div.grow', h('b', 'אירעה שגיאה בתצוגה הזו.'), h('p.small', 'הנתונים לא השתנו. אפשר לחזור למסך הבית.'))), h('a.btn.primary', { href: '#/home' }, 'למסך הבית')));
  }
  renderStatusBanner();
  document.title = `${ROUTES[route.name].title} · Luma`;
  const navId = ROUTES[route.name].nav || null;
  document.querySelectorAll('[data-nav]').forEach((a) => { if (a.dataset.nav === navId) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  if (same) { window.scrollTo(0, y); restoreFocus(fk); }
  else {
    window.scrollTo(0, 0);
    lastKey = key;
    if (!force) mainEl.focus({ preventScroll: true });
  }
}

// ---------- status banner (storage honesty) ----------
let statusBox;
function renderStatusBanner() {
  const st = store.status;
  const parts = [];
  if (st.mode === 'degraded') parts.push(h('div.banner', { role: 'status' }, ic('alert'), h('div.grow', h('b', 'אחסון מוגבל'), h('p.small', 'הדפדפן לא מאפשר את האחסון הרגיל. כדאי לגבות בקביעות.'), h('div.banner-actions', h('a.btn.small.soft', { href: '#/settings/backup' }, 'גיבוי')))));
  if (st.mode === 'memory') parts.push(h('div.banner.danger', { role: 'alert' }, ic('alert'), h('div.grow', h('b', 'הנתונים אינם נשמרים'), h('p.small', 'לא נמצא אחסון זמין (ייתכן גלישה פרטית או חסימה). שינויים יאבדו בסגירה. אפשר לייצא גיבוי.'), h('div.banner-actions', h('a.btn.small.soft', { href: '#/settings/backup' }, 'ייצוא גיבוי')))));
  if (st.save === 'error') parts.push(h('div.banner.danger', { role: 'alert' }, ic('alert'), h('div.grow', h('b', 'השמירה נכשלה'), h('p.small', st.error || ''), h('p.small', 'השינויים נשמרים כרגע רק בחלון הזה.'),
    h('div.banner-actions', btn('ניסיון חוזר', () => store.retrySave(), 'small soft'), h('a.btn.small.ghost', { href: '#/settings/backup' }, 'ייצוא גיבוי')))));
  if (st.conflict) parts.push(h('div.banner.danger', { role: 'alert' }, ic('alert'), h('div.grow', h('b', 'הנתונים עודכנו בחלון אחר'), h('p.small', st.error || ''),
    h('div.banner-actions',
      btn('טעינת הגרסה העדכנית', () => store.reloadFromStorage().then(() => toast('נטענה הגרסה העדכנית')), 'small soft'),
      btn('שמירת הגרסה מהחלון הזה', async () => { if (await confirmDialog('לשמור את הגרסה מהחלון הזה על פני הגרסה מהחלון האחר? הגרסה האחרת תישמר כעותק שחזור.', { danger: true, ok: 'שמירה' })) store.overwriteStorage(); }, 'small ghost')))));
  statusBox.replaceChildren(...parts);
  statusBox.hidden = !parts.length;
}

// ---------- shell ----------
function buildShell() {
  const app = document.getElementById('app');
  headerEl = h('header.hdr');
  mainEl = h('main.main#main', { tabIndex: -1 });
  statusBox = h('div.stack', { style: { padding: '12px 16px 0', maxWidth: '760px', margin: '0 auto' } });
  const nav = h('nav.nav', { 'aria-label': 'ניווט ראשי' }, NAV.map((n) => h('a', { href: n.href, dataset: { nav: n.id } }, ic(n.icon, 22), h('span', n.label))));
  const rail = h('nav.rail', { 'aria-label': 'ניווט' }, h('div.rail-brand', 'Luma'),
    NAV.map((n) => h('a', { href: n.href, dataset: { nav: n.id, href: n.href } }, ic(n.icon, 20), h('span', n.label))));
  app.replaceChildren(h('a.skip-link', { href: '#main', onclick: (e) => { e.preventDefault(); mainEl.focus(); } }, 'דילוג לתוכן'), rail, h('div.shell', headerEl, statusBox, mainEl), nav);
}

// ---------- boot ----------
async function chooseAdapter() {
  const idb = createIdbAdapter();
  try {
    await idb.probe();
    idb.onBlocked?.(() => toast('Luma פתוחה בחלון אחר עם גרסה אחרת. כדאי לסגור חלונות ישנים.', { error: true, timeout: 8000 }));
    return { adapter: idb, mode: 'primary' };
  } catch (e) {
    console.warn('IndexedDB unavailable', e);
    if (e.code === 'version') throw Object.assign(new Error(e.message), { code: 'newer' });
  }
  try {
    const ls = createLocalStorageAdapter();
    await ls.probe();
    return { adapter: ls, mode: 'degraded' };
  } catch { /* nothing persistent */ }
  return { adapter: createMemoryAdapter(), mode: 'memory' };
}

function bootError(e, adapter) {
  const app = document.getElementById('app');
  const download = async () => {
    try {
      const raw = await adapter.load();
      downloadBlob(new Blob([JSON.stringify(raw)], { type: 'application/json' }), `luma-raw-data-${today()}.json`);
    } catch { toast('לא ניתן היה לקרוא את הנתונים הגולמיים', { error: true }); }
  };
  const restore = h('input', { type: 'file', accept: '.json,application/json', 'aria-label': 'שחזור מקובץ גיבוי' });
  restore.addEventListener('change', async () => {
    const f = restore.files[0];
    if (!f) return;
    const res = parseBackup(await f.text());
    if (!res.ok) { toast(res.message, { error: true }); return; }
    if (!(await confirmDialog(`לשחזר את הגיבוי (${res.info.counts.tasks || 0} משימות) במקום הנתונים שלא נקראו? הנתונים הקיימים יורדו קודם כקובץ.`, { danger: true, ok: 'שחזור' }))) return;
    await download();
    try {
      await adapter.saveRecovery?.({ id: uid(), createdAt: clock.iso(), reason: 'לפני שחזור במצב שגיאה', revision: 0, state: await adapter.load() });
      const st = res.state;
      await adapter.save(st);
      location.reload();
    } catch (err) { toast('השחזור נכשל: ' + err.message, { error: true }); }
  });
  const newer = e.code === 'newer';
  app.replaceChildren(h('main.main', h('div.page',
    h('div.wordmark', { style: { color: 'var(--primary)', textShadow: 'none', fontSize: '2rem' } }, 'Luma'),
    h('div.banner.danger', { role: 'alert' }, ic('alert'), h('div.grow',
      h('b', newer ? 'הנתונים במכשיר נוצרו בגרסה חדשה יותר של Luma' : 'לא ניתן היה לקרוא את הנתונים השמורים'),
      h('p.small', newer ? 'כדי לא לפגוע בנתונים האפליקציה לא תשנה אותם. יש לטעון מחדש כשהגרסה העדכנית זמינה.' : 'הנתונים לא נמחקו ולא הוחלפו בנתוני ברירת מחדל.'),
      e.details ? h('details.more', h('summary', 'פרטים טכניים'), h('ul.small.code', e.details.slice(0, 10).map((d) => h('li', d)))) : null)),
    btn('הורדת הנתונים הגולמיים לשמירה', download, 'soft', 'download'),
    !newer ? h('label.btn.ghost', ic('upload', 18), 'שחזור מקובץ גיבוי…', restore) : null,
    btn('טעינה מחדש', () => location.reload(), 'ghost'))));
}

async function reconcileFallback(mode) {
  if (mode !== 'primary') return;
  const ls = createLocalStorageAdapter();
  if (!ls.exists()) return;
  let doc;
  try { doc = migrateState(await ls.load()).state; } catch { return; }
  const cur = store.state;
  const sh = openSheet({
    title: 'נמצאו נתונים ממצב אחסון זמני',
    body: [h('p', 'בעבר Luma שמרה נתונים במצב זמני כי האחסון הראשי לא היה זמין. עכשיו האחסון הראשי עובד.'),
      h('table.data', h('tbody', h('tr', h('th', ''), h('th', 'זמני'), h('th', 'ראשי')),
        h('tr', h('td', 'עודכן'), h('td', new Date(doc.metadata.updatedAt).toLocaleString('he-IL')), h('td', new Date(cur.metadata.updatedAt).toLocaleString('he-IL'))),
        h('tr', h('td', 'משימות'), h('td', String(doc.tasks.length)), h('td', String(cur.tasks.length))))),
      h('p.small.muted', 'הגרסה שלא תיבחר תישמר כעותק שחזור.')],
    footer: [
      btn('להשאיר את הראשי', async () => { await createIdbAdapter().saveRecovery({ id: uid(), createdAt: clock.iso(), reason: 'נתוני מצב זמני', revision: doc.metadata.revision, state: doc }); ls.clear(); sh.close(true); toast('הנתונים הזמניים נשמרו כעותק שחזור'); }, 'ghost'),
      btn('להעביר את הזמני לראשי', async () => { const r = await store.replaceState(doc, 'לפני העברת נתוני מצב זמני'); if (r.ok) { ls.clear(); sh.close(true); toast('הנתונים הועברו'); } else toast(r.error, { error: true }); }, 'primary'),
    ],
  });
}

async function boot() {
  let adapter, mode;
  try { ({ adapter, mode } = await chooseAdapter()); } catch (e) { bootError(e, createMemoryAdapter()); return; }
  const s = createStore({ adapter, now: () => { const c = ctxNow(); return { nowIso: c.nowIso, today: c.date, minute: c.minute }; }, uid, mode });
  try {
    await s.init();
  } catch (e) {
    console.error(e);
    bootError(e, adapter);
    return;
  }
  bindStore(s);
  applyTheme(s.state.settings);
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => applyTheme(store.state.settings));
  buildShell();
  s.subscribe(() => { applyTheme(store.state.settings); scheduleRender(); scheduleReminders(() => store.state); });
  scheduleReminders(() => store.state);
  s.onStatus(() => { if (headerEl) { renderStatusBanner(); renderHeader(parseRoute(), ctxNow()); } });
  window.addEventListener('hashchange', () => { closeAllSheets(); render(); });
  document.addEventListener('luma:rerender', () => render());
  render();
  document.getElementById('splash')?.remove();

  // Live time: re-render time-sensitive screens each minute while visible; date rollover re-renders all.
  setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    const c = ctxNow();
    if (c.date !== lastDate) { render({ force: true }); return; }
    if (sheetOpen() || document.activeElement?.matches?.('input,textarea,select')) return;
    if (ROUTES[parseRoute().name].live) render({ force: true });
  }, 30000);
  // A field that is still being edited (e.g. the day notes) is committed before the page hides.
  const commitFocused = () => { const a = document.activeElement; if (a && mainEl.contains(a) && a.matches?.('textarea, input')) a.dispatchEvent(new Event('change')); };
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible') { await store.checkExternal(); render({ force: true }); scheduleReminders(() => store.state); }
    else { commitFocused(); store.flush(); }
  });
  window.addEventListener('pagehide', () => { commitFocused(); store.flush(); });
  window.addEventListener('pageshow', (e) => { if (e.persisted) render({ force: true }); });
  addEventListener('online', () => renderHeader(parseRoute(), ctxNow()));

  if (mode === 'primary') requestPersistence();
  reconcileFallback(mode);
  registerServiceWorker({
    onUpdate: (apply) => toast('גרסה חדשה של Luma מוכנה', { action: { label: 'עדכון', fn: apply }, timeout: 15000 }),
    beforeApply: async () => {
      await store.flush();
      if (store.status.save !== 'saved') { toast('יש שינויים שלא נשמרו. העדכון ימתין עד שהשמירה תצליח.', { error: true }); return false; }
      return true;
    },
  });
}

boot();
