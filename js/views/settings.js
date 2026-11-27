// הגדרות - inquiry target, notifications, appearance, and links to backup, planning import
// and updates/storage/privacy.
import { h, ic, ltr, btn, seg, section, input, check, openSheet, confirmDialog, toast, setChildren } from '../ui.js';
import { S, run, store, nowCtx } from '../app.js';
import { counterTarget } from '../engine/inquiries.js';
import { parseBackup } from '../data/backup.js';
import { exportBackup, PRIVACY_NOTE } from '../export/backupExport.js';
import { APP_VERSION } from '../config.js';
import { storageInfo, requestPersistence, checkForUpdate } from '../platform.js';
import { notificationSupport, requestNotificationPermission, showNotification, scheduleReminders } from '../notifications.js';

const when = (iso) => ltr(new Date(iso).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }));

function targetSection(state) {
  const t = input('number', counterTarget(state, nowCtx().date), { min: 0, max: 1000, inputmode: 'numeric', 'aria-label': 'יעד פניות יומי', class: 'target-input' });
  const save = () => run('setDefaultTarget', { target: Number(t.value) }, { success: 'היעד נשמר' });
  t.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
  return section('יעד פניות יומי', {}, h('div.inline-form', t, btn('שמירה', save, 'primary')));
}

function notificationsSection(state) {
  const box = h('div.stack');
  const prefs = state.settings.notifications || { activityStart: false, showDetails: false };
  const draw = () => {
    const sup = notificationSupport();
    if (sup.status === 'unsupported') return setChildren(box, h('p.muted', 'הדפדפן הזה לא תומך בהתראות.'));
    if (sup.status === 'needsInstall') return setChildren(box, h('p.muted', 'ב-iPhone ההתראות זמינות אחרי הוספת Luma למסך הבית.'));
    if (sup.status === 'denied') return setChildren(box, h('p.muted', 'ההתראות חסומות. אפשר לאשר אותן בהגדרות המכשיר.'));
    if (sup.status === 'default') {
      return setChildren(box, btn('הפעלת התראות', async () => {
        const p = await requestNotificationPermission();
        if (p === 'granted') await run('updateSettings', { patch: { notifications: { activityStart: true } } }, { silent: true });
        draw();
      }, 'soft', 'bell'));
    }
    setChildren(box,
      check('תזכורת בתחילת כל פעילות', prefs.activityStart, (v) => run('updateSettings', { patch: { notifications: { activityStart: v } } }, { silent: true }).then(() => scheduleReminders(S))),
      check('להציג את שם הפעילות בהתראה', prefs.showDetails, (v) => run('updateSettings', { patch: { notifications: { showDetails: v } } }, { silent: true })),
      h('p.muted.small', 'התזכורות נשלחות רק כש-Luma פתוחה.'),
      btn('התראת בדיקה', async () => { if (!(await showNotification('Luma', 'התראת בדיקה', 'luma-test'))) toast('ההתראה לא הוצגה', { error: true }); }, 'ghost small'));
  };
  draw();
  return section('התראות', {}, box);
}

function appearanceSection(state) {
  const st = state.settings;
  return section('תצוגה ונגישות', {},
    seg([{ value: 'auto', label: 'לפי המכשיר' }, { value: 'light', label: 'בהירה' }, { value: 'dark', label: 'כהה' }], st.theme, (v) => run('updateSettings', { patch: { theme: v } }, { silent: true }), 'ערכת צבעים'),
    check('הפחתת תנועה', st.reducedMotion === 'reduce', (v) => run('updateSettings', { patch: { reducedMotion: v ? 'reduce' : 'auto' } }, { silent: true })));
}

const LINKS = [
  ['#/settings/backup', 'גיבוי ושחזור', 'download'],
  ['#/import', 'ייבוא תוכנית מ-ChatGPT', 'upload'],
  ['#/settings/about', 'עדכונים, אחסון ופרטיות', 'question'],
];

// ---------- backup ----------
async function restoreFromFile(file) {
  const res = parseBackup(await file.text());
  if (!res.ok) { toast(res.message, { error: true, timeout: 8000 }); return; }
  const c = res.info.counts;
  const sh = openSheet({
    title: 'שחזור מגיבוי',
    body: [
      h('p', 'השחזור מחליף את כל הנתונים במכשיר. לפני ההחלפה נשמר עותק של המצב הנוכחי.'),
      h('p.muted.small', 'גיבוי מ-', res.info.exportedAt ? when(res.info.exportedAt) : 'תאריך לא ידוע', ` · ${c.tasks ?? 0} משימות · ${c.calendarBlocks ?? 0} פעילויות`),
    ],
    footer: [btn('ביטול', () => sh.close(), 'ghost'), btn('החלפת כל הנתונים', async () => {
      if (!(await confirmDialog('לאשר החלפה מלאה של הנתונים בתוכן הגיבוי?', { danger: true, ok: 'החלפה' }))) return;
      const r = await store.replaceState(res.state, 'לפני שחזור מגיבוי');
      if (r.ok) { toast('הגיבוי שוחזר'); sh.close(true); } else toast(r.error, { error: true, timeout: 8000 });
    }, 'danger')],
  });
}

function backupPage(state) {
  const b = state.settings.backup;
  const file = h('input', { type: 'file', accept: '.json,application/json', 'aria-label': 'בחירת קובץ גיבוי' });
  file.addEventListener('change', () => { if (file.files[0]) restoreFromFile(file.files[0]); file.value = ''; });
  const recBox = h('div.stack');
  store.listRecovery().then((list) => setChildren(recBox, list.length ? h('div.list', list.map((r) => h('div.item',
    h('div.body', h('div.title', r.reason), h('div.meta', when(r.createdAt))),
    btn('שחזור', async () => {
      if (!(await confirmDialog(`לשחזר את העותק ״${r.reason}״? כל השינויים מאז יוחלפו (המצב הנוכחי יישמר כעותק נוסף).`, { danger: true, ok: 'שחזור' }))) return;
      const snap = await store.getRecovery(r.id);
      const res = await store.replaceState(snap.state, 'לפני שחזור עותק פנימי');
      toast(res.ok ? 'העותק שוחזר' : res.error, { error: !res.ok });
    }, 'small ghost')))) : null)).catch(() => {});
  return [
    section('גיבוי', {},
      h('p', 'הגיבוי האחרון: ', b.lastExportAt ? when(b.lastExportAt) : 'עדיין לא'),
      btn('ייצוא גיבוי', () => exportBackup(), 'primary', 'download'),
      h('p.muted.small', PRIVACY_NOTE)),
    section('שחזור', {}, h('label.btn.soft', ic('upload', 18), 'בחירת קובץ גיבוי', file)),
    h('details.more', h('summary', 'עותקים אוטומטיים במכשיר'), h('p.muted.small', 'נשמרים לפני ייבוא, שחזור ועדכון נתונים. הם לא מחליפים גיבוי מחוץ למכשיר.'), recBox),
  ];
}

// ---------- updates, storage, privacy ----------
function aboutPage() {
  const info = h('div.stack');
  storageInfo().then((s) => setChildren(info,
    store.status.mode !== 'primary' ? h('p', store.status.mode === 'degraded' ? 'האחסון במכשיר מוגבל כרגע - כדאי לגבות בקביעות.' : 'הנתונים אינם נשמרים בדפדפן הזה.') : null,
    s.usage != null ? h('p.small', 'בשימוש: ', ltr(`${Math.round(s.usage / 1024)} KB`)) : null,
    s.persisted === false ? btn('בקשה לשמירה קבועה של הנתונים', async () => { const ok = await requestPersistence(); toast(ok ? 'הדפדפן אישר' : 'הדפדפן לא אישר. חשוב לגבות.'); }, 'small soft') : null,
    s.persisted ? h('p.small', 'הדפדפן אישר שמירה קבועה.') : null));
  const upd = h('div.row.wrap', h('span', `גרסה ${APP_VERSION}`), btn('בדיקת עדכונים', async () => {
    const r = await checkForUpdate();
    toast(r === 'available' ? 'עדכון נמצא ויוצע להתקנה' : r === 'none' ? 'זו הגרסה העדכנית' : 'אי אפשר לבדוק עדכונים כרגע', { error: r === 'error' });
  }, 'small ghost'));
  return [
    section('עדכונים', {}, upd),
    section('אחסון', {}, info),
    section('פרטיות', {},
      h('ul.small.plain',
        h('li', 'הנתונים נשמרים רק במכשיר הזה. אין חשבון, שרת או סנכרון.'),
        h('li', 'אחסון הדפדפן אינו הצפנה ואינו גיבוי. מחיקת נתוני אתר או החלפת מכשיר עלולות למחוק אותם.'),
        h('li', 'לשמור רק תיאורי עבודה כלליים - בלי פרטים מזהים של פונים.'))),
    section('התקנה ב-iPhone', {}, h('p.small', 'ב-Safari: שיתוף ← ״הוספה למסך הבית״.')),
  ];
}

export function render(main, args) {
  const state = S();
  const sub = args[0];
  if (sub === 'backup' || sub === 'about') {
    main.replaceChildren(h('div.page', h('a.btn.ghost.small.back-link', { href: '#/settings' }, ic('right', 18), 'הגדרות'), sub === 'backup' ? backupPage(state) : aboutPage()));
    return;
  }
  main.replaceChildren(h('div.page',
    targetSection(state),
    notificationsSection(state),
    appearanceSection(state),
    h('div.list', LINKS.map(([href, label, icn]) => h('a.item.link-row', { href }, ic(icn, 22), h('div.body', h('div.title', label)), ic('left', 18))))));
}
