// הגדרות – every configurable rule from the architecture is editable here.
import { h, ic, ltr, btn, iconBtn, seg, section, input, select, check, field, textarea, openSheet, confirmDialog, toast } from '../ui.js';
import { S, run, store, nowCtx } from '../app.js';
import { DAY_NAMES, fmtDM, toMin, isValidDate } from '../dates.js';
import { LOCATION_LABEL, TEMPLATE_ROLES, ROLE_LABEL } from '../data/schema.js';
import { templateVersionFor } from '../engine/dayTemplates.js';
import { headerRuleErrors, BANNERS } from '../engine/header.js';
import { defaultTargetAt } from '../engine/inquiries.js';
import { parseBackup } from '../data/backup.js';
import { exportBackup, PRIVACY_NOTE } from '../export/exportUi.js';
import { APP_VERSION } from '../config.js';
import { storageInfo, requestPersistence } from '../platform.js';

const SECTIONS = [
  ['calendar', 'לוח עבודה ושעות', 'calendar'], ['template', 'תבנית יום', 'list'], ['targets', 'יעד פניות', 'headset'],
  ['categories', 'קטגוריות', 'dot'], ['planner', 'מתכנן', 'wand'], ['closing', 'סגירת יום', 'checkCircle'],
  ['header', 'כותרת וברכה', 'image'], ['appearance', 'תצוגה ונגישות', 'moon'], ['backup', 'גיבוי ושחזור', 'download'],
  ['import', 'ייבוא תוכנית ו־ChatGPT', 'upload'], ['about', 'התקנה, אחסון ופרטיות', 'question'],
];

function calendarSection(state) {
  const st = state.settings;
  const rows = st.weekly.map((d, i) => {
    const working = check('יום עבודה', d.isWorking, (v) => run('setWeeklyDay', { weekday: i, patch: { isWorking: v } }, { success: 'עודכן' }));
    const loc = select(['office', 'home', 'other'].map((v) => ({ value: v, label: LOCATION_LABEL[v] })), d.location || 'office', { 'aria-label': `מיקום ביום ${DAY_NAMES[i]}`, disabled: !d.isWorking });
    loc.addEventListener('change', () => run('setWeeklyDay', { weekday: i, patch: { location: loc.value } }, { success: 'עודכן' }));
    const duty = check('תורנות טלפון', d.phoneDuty, (v) => run('setWeeklyDay', { weekday: i, patch: { phoneDuty: v } }, { success: 'עודכן' }), { disabled: !d.isWorking });
    const s = input('time', d.workStart || '', { 'aria-label': `התחלה ביום ${DAY_NAMES[i]} (ריק = ברירת מחדל)`, disabled: !d.isWorking });
    const e = input('time', d.workEnd || '', { 'aria-label': `סיום ביום ${DAY_NAMES[i]} (ריק = ברירת מחדל)`, disabled: !d.isWorking });
    const saveHours = () => run('setWeeklyDay', { weekday: i, patch: { workStart: s.value || null, workEnd: e.value || null } }, { success: 'עודכן' });
    s.addEventListener('change', saveHours); e.addEventListener('change', saveHours);
    return h('div.card.flat.stack', h('b', DAY_NAMES[i]), h('div.row.wrap', working, duty), h('div.grid3', loc, s, e));
  });
  const ws = input('time', st.workHours.start), we = input('time', st.workHours.end), ps = input('time', st.phoneDutyWindow.start), pe = input('time', st.phoneDutyWindow.end);
  return [
    section('שעות ברירת מחדל', {},
      h('div.grid2', field('תחילת יום עבודה', ws), field('סוף יום עבודה', we)),
      h('div.grid2', field('תחילת תורנות טלפון', ps), field('סוף תורנות טלפון', pe)),
      btn('שמירת שעות', () => {
        if (toMin(we.value) <= toMin(ws.value) || toMin(pe.value) <= toMin(ps.value)) { toast('שעת הסיום חייבת להיות אחרי ההתחלה', { error: true }); return; }
        run('setWorkWindows', { workHours: { start: ws.value, end: we.value }, phoneDutyWindow: { start: ps.value, end: pe.value } }, { success: 'השעות נשמרו' });
      }, 'primary'),
      h('p.muted.small', 'חלון הסגירה ותבנית היום מתאימים את עצמם לסוף יום העבודה. תורנות הטלפון היא חלון מקביל, לא בלוק בלו״ז.')),
    section('ימים בשבוע', {}, h('p.muted.small', 'שעות ריקות = שעות ברירת המחדל. חגים, חופשות וימים מקוצרים מוגדרים לכל תאריך מתוך סדר היום (כפתור העריכה ליד התאריך) או בדפוס שבוע ביומן.'), rows),
  ];
}

function templateSection(state) {
  const ctx = nowCtx();
  const tplId = state.settings.defaultTemplateId;
  const tpl = state.dayTemplates.find((t) => t.id === tplId);
  const ver = templateVersionFor(state, tplId, ctx.date);
  const cats = state.settings.categories.filter((c) => !c.archived).map((c) => ({ value: c.id, label: c.label }));
  const rows = ver.blocks.map((b) => ({ ...structuredClone(b) }));
  const list = h('div.stack');
  const draw = () => list.replaceChildren(...rows.map((b, i) => {
    const title = input('text', b.title, { 'aria-label': 'כותרת', maxlength: 300 });
    const s = input('time', b.start, { 'aria-label': `התחלה – ${b.title}` }), e = input('time', b.end, { 'aria-label': `סיום – ${b.title}` });
    const cat = select(cats, b.categoryId, { 'aria-label': `קטגוריה – ${b.title}` });
    const anchor = select([{ value: '', label: 'גמיש למסגרת' }, { value: 'start', label: 'צמוד לתחילת היום' }, { value: 'end', label: 'צמוד לסוף היום' }], b.anchor || '', { 'aria-label': 'עיגון' });
    const min = input('number', b.minMinutes || 0, { min: 0, max: 600, 'aria-label': 'משך מינימלי בדקות' });
    const instr = textarea((b.instructions || []).join('\n'), { rows: 2, 'aria-label': 'הנחיות (שורה לכל הנחיה)' });
    title.addEventListener('input', () => { b.title = title.value; });
    s.addEventListener('change', () => { b.start = s.value; }); e.addEventListener('change', () => { b.end = e.value; });
    cat.addEventListener('change', () => { b.categoryId = cat.value; }); anchor.addEventListener('change', () => { b.anchor = anchor.value || null; });
    min.addEventListener('change', () => { b.minMinutes = Number(min.value) || 0; }); instr.addEventListener('change', () => { b.instructions = instr.value.split('\n').map((x) => x.trim()).filter(Boolean); });
    return h('div.card.flat.stack',
      h('div.row.between', h('b', TEMPLATE_ROLES.includes(b.role) ? ROLE_LABEL[b.role] : 'בלוק מותאם'), iconBtn('trash', `הסרת ${b.title}`, () => { rows.splice(i, 1); draw(); })),
      field('כותרת', title), h('div.grid2', field('התחלה', s), field('סיום', e)), h('div.grid2', field('קטגוריה', cat), field('עיגון', anchor)),
      h('div.row.wrap', check('מוגן (לא יידרס בתכנון)', b.protected, (v) => { b.protected = v; }), check('גמיש (אפשר לקצר)', b.flexible, (v) => { b.flexible = v; })),
      field('משך מינימלי (דק׳)', min), field('הנחיות קצרות', instr));
  }));
  draw();
  const from = input('date', ctx.date, { min: ctx.date });
  return [section(`תבנית: ${tpl.name}`, {},
    h('p.muted.small', 'שינוי התבנית חל מתאריך התחולה והלאה. ימים שעברו ונסגרו נשמרים כפי שהיו. שינוי חד־פעמי ליום מסוים נעשה מסדר היום.'),
    list,
    btn('הוספת בלוק', () => { rows.push({ role: `custom-${Date.now().toString(36)}`, title: 'בלוק חדש', start: '16:00', end: '16:15', categoryId: 'admin', protected: false, flexible: true, minMinutes: 0, anchor: null, instructions: [] }); draw(); }, 'soft', 'plus'),
    field('תאריך תחולה', from),
    btn('שמירת התבנית', async () => {
      if (!isValidDate(from.value)) return;
      if (await confirmDialog(`לשמור את התבנית החל מ־${fmtDM(from.value)}?`, { ok: 'שמירה' })) run('saveTemplateVersion', { templateId: tplId, effectiveFrom: from.value, blocks: rows }, { success: 'התבנית נשמרה' });
    }, 'primary'),
    h('details.more', h('summary', `גרסאות (${tpl.versions.length})`), h('ul.small', tpl.versions.map((v) => h('li', 'מ־', ltr(v.effectiveFrom === '2000-01-01' ? 'ההתחלה' : v.effectiveFrom), ` · ${v.blocks.length} בלוקים`))))),
  section('תבניות נוספות', {},
    h('p.muted.small', 'למשל תבנית ליום מקוצר. בוחרים תבנית לתאריך מסוים מתוך הגדרות היום.'),
    h('div.list', state.dayTemplates.map((t) => h('div.item', h('div.body', h('div.title', t.name), h('div.meta', t.id === tplId ? 'ברירת מחדל' : '')),
      t.id !== tplId ? iconBtn('trash', `מחיקת ${t.name}`, async () => { if (await confirmDialog(`למחוק את התבנית ״${t.name}״?`, { danger: true, ok: 'מחיקה' })) run('deleteTemplate', { templateId: t.id }, { success: 'נמחקה' }); }) : null))),
    btn('תבנית חדשה (העתק של ברירת המחדל)', async () => {
      const { promptText } = await import('../ui.js');
      const name = await promptText('שם התבנית', { label: 'שם' });
      if (name) run('addTemplate', { name }, { success: 'התבנית נוצרה. אפשר לבחור אותה לתאריך מסוים.' });
    }, 'ghost', 'plus'))];
}

function targetsSection(state) {
  const ctx = nowCtx();
  const t = input('number', defaultTargetAt(state, ctx.date), { min: 0, max: 1000, inputmode: 'numeric' });
  const from = input('date', ctx.date, { min: ctx.date });
  return [section('יעד יומי ברירת מחדל', {},
    h('div.grid2', field('פניות ביום עבודה', t), field('בתוקף מ־', from)),
    btn('שמירה', () => run('setDefaultTarget', { target: Number(t.value), effectiveFrom: from.value }, { success: 'היעד עודכן מהתאריך שנבחר והלאה' }), 'primary'),
    h('p.muted.small', 'שינוי היעד לא משנה ימים קודמים. ימים שאינם ימי עבודה הם ללא יעד. אין הגדלה אוטומטית אחרי ימים שבהם היעד לא הושג. יעד ליום מסוים נקבע ממונה הפניות.'),
    h('h3', 'היסטוריה'), h('ul', state.targetHistory.defaults.slice().reverse().map((v) => h('li', ltr(String(v.target)), ' – מ־', v.effectiveFrom === '2000-01-01' ? 'ההתחלה' : ltr(fmtDM(v.effectiveFrom))))))];
}

function categoriesSection(state) {
  return [section('קטגוריות', { action: btn('קטגוריה חדשה', () => run('saveCategory', { label: 'קטגוריה חדשה', color: '#526273', roles: [] }, { success: 'נוספה' }), 'small soft', 'plus') },
    h('p.muted.small', 'התפקידים קובעים לאיזה בלוק בתבנית המתכנן משבץ משימות מהקטגוריה. משקל גבוה יותר = עדיפות בתכנון.'),
    state.settings.categories.map((c) => {
      const label = input('text', c.label, { maxlength: 80, 'aria-label': 'שם' });
      const color = input('color', c.color, { 'aria-label': 'צבע', style: { maxWidth: '70px' } });
      const weight = select([0, 1, 2, 3].map((n) => ({ value: String(n), label: `משקל ${n}` })), String(c.plannerWeight || 0), { 'aria-label': 'משקל בתכנון' });
      const roles = h('div.row.wrap', TEMPLATE_ROLES.map((r) => check(ROLE_LABEL[r], (c.roles || []).includes(r), (v) => run('saveCategory', { id: c.id, roles: v ? [...(c.roles || []), r] : (c.roles || []).filter((x) => x !== r) }, { silent: true }))));
      label.addEventListener('change', () => run('saveCategory', { id: c.id, label: label.value }, { success: 'עודכן' }));
      color.addEventListener('change', () => run('saveCategory', { id: c.id, color: color.value }, { success: 'עודכן' }));
      weight.addEventListener('change', () => run('saveCategory', { id: c.id, plannerWeight: Number(weight.value) }, { success: 'עודכן' }));
      return h('div.card.flat.stack' + (c.archived ? '.muted' : ''), h('div.row.wrap', color, label, weight,
        btn(c.archived ? 'שחזור' : 'לארכיון', () => run('saveCategory', { id: c.id, archived: !c.archived }, { success: 'עודכן' }), 'small ghost')),
      h('details.more', h('summary', 'תפקידי בלוקים'), roles, check('ריכוז בסוף בלוק (למשל העברות CRM)', c.batchAtEnd, (v) => run('saveCategory', { id: c.id, batchAtEnd: v }, { silent: true }))));
    }))];
}

function plannerSection(state) {
  const p = state.settings.planner;
  const est = input('number', p.assumedEstimateMinutes, { min: 1, max: 480 });
  const soon = input('number', p.deadlineSoonDays, { min: 1, max: 30 });
  const cd = input('number', p.clusterDays, { min: 1, max: 30 }), cc = input('number', p.clusterCount, { min: 1, max: 30 });
  let use = p.useAssumedEstimate;
  return [section('מתכנן והתראות', {},
    check('לשבץ משימות ללא הערכת זמן לפי הנחה (מסומן בתצוגה המקדימה)', use, (v) => { use = v; }),
    field('הערכה משוערת (דק׳)', est), field('התראת מועד יעד קרוב (ימים)', soon),
    h('div.grid2', field('מועדים צפופים: חלון בימים', cd), field('מספר מועדים בחלון', cc)),
    btn('שמירה', () => run('updateSettings', { patch: { planner: { assumedEstimateMinutes: Number(est.value), useAssumedEstimate: use, deadlineSoonDays: Number(soon.value), clusterDays: Number(cd.value), clusterCount: Number(cc.value) } } }, { success: 'נשמר' }), 'primary'))];
}

function closingSection(state) {
  const items = state.settings.closingChecklist.map((x) => ({ ...x }));
  const list = h('div.stack');
  const draw = () => list.replaceChildren(...items.map((x, i) => {
    const inp = input('text', x.label, { maxlength: 300, 'aria-label': `פריט ${i + 1}` });
    inp.addEventListener('input', () => { x.label = inp.value; });
    return h('div.row', inp, iconBtn('trash', `הסרת ${x.label}`, () => { items.splice(i, 1); draw(); }));
  }));
  draw();
  return [section('רשימת סגירת יום', {}, list,
    btn('הוספת פריט', () => { items.push({ id: `c-${Date.now().toString(36)}`, label: '' }); draw(); }, 'soft', 'plus'),
    btn('שמירה', () => run('updateSettings', { patch: { closingChecklist: items.filter((x) => x.label.trim()) } }, { success: 'הרשימה נשמרה' }), 'primary'),
    h('p.muted.small', 'סגירת יום אינה מסמנת משימות כהושלמו. ימים שנסגרו שומרים את הרשימה כפי שהייתה.'))];
}

function headerSection(state) {
  const st = state.settings;
  const name = input('text', st.displayName, { maxlength: 40 });
  const rules = st.header.rules.map((r) => ({ ...r }));
  const imgOpts = Object.keys(BANNERS).map((k) => ({ value: k, label: { dawn: 'זריחה', dawnAlternate: 'זריחה (חלופי)', day: 'יום', sunset: 'שקיעה', night: 'לילה' }[k] }));
  const list = h('div.stack');
  const err = h('p.form-error', { role: 'alert' });
  const draw = () => list.replaceChildren(...rules.map((r, i) => {
    const f = input('time', r.from, { 'aria-label': 'מ־' }), t = input('time', r.to, { 'aria-label': 'עד' });
    const im = select(imgOpts, r.image, { 'aria-label': 'תמונה' });
    const g = input('text', r.greeting, { maxlength: 40, 'aria-label': 'ברכה' });
    f.addEventListener('change', () => { r.from = f.value; }); t.addEventListener('change', () => { r.to = t.value; });
    im.addEventListener('change', () => { r.image = im.value; }); g.addEventListener('input', () => { r.greeting = g.value; });
    return h('div.card.flat.stack', h('div.grid2', f, t), h('div.grid2', im, g), iconBtn('trash', 'הסרת הטווח', () => { rules.splice(i, 1); draw(); }));
  }));
  draw();
  let alt = st.header.useAlternateDawn;
  return [section('כותרת וברכה', {},
    field('שם בברכה', name),
    check('תמונת זריחה חלופית', alt, (v) => { alt = v; }),
    h('p.muted.small', 'טווחי שעות לפי שעון ישראל: ההתחלה כלולה והסיום לא. חייבים לכסות את כל היממה בלי חפיפה.'),
    list, btn('הוספת טווח', () => { rules.push({ from: '00:00', to: '00:00', image: 'day', greeting: 'שלום' }); draw(); }, 'soft', 'plus'), err,
    btn('שמירה', () => {
      const e = headerRuleErrors(rules);
      if (e.length) { err.textContent = e.join(' · '); return; }
      run('updateSettings', { patch: { displayName: name.value, header: { rules, useAlternateDawn: alt } } }, { success: 'נשמר' });
    }, 'primary'))];
}

function appearanceSection(state) {
  const st = state.settings;
  return [section('תצוגה ונגישות', {},
    field('ערכת צבעים', seg([{ value: 'auto', label: 'לפי המכשיר' }, { value: 'light', label: 'בהירה' }, { value: 'dark', label: 'כהה' }], st.theme, (v) => run('updateSettings', { patch: { theme: v } }, { silent: true }), 'ערכת צבעים')),
    field('תנועה', seg([{ value: 'auto', label: 'לפי המכשיר' }, { value: 'reduce', label: 'מופחתת' }], st.reducedMotion, (v) => run('updateSettings', { patch: { reducedMotion: v } }, { silent: true }), 'תנועה')),
    check('להציג הנחיות עבודה קצרות בבלוקים', st.showGuidance, (v) => run('updateSettings', { patch: { showGuidance: v } }, { silent: true })),
    h('p.muted.small', 'גודל הטקסט עוקב אחרי הגדרות הדפדפן/המכשיר.'))];
}

async function restoreFromFile(file) {
  const text = await file.text();
  const res = parseBackup(text);
  if (!res.ok) { toast(res.message, { error: true, timeout: 8000 }); return; }
  const c = res.info.counts;
  const sh = openSheet({
    title: 'שחזור מגיבוי',
    body: [
      h('div.banner.danger', ic('alert'), h('div.grow', h('b', 'השחזור מחליף את כל הנתונים במכשיר.'), h('p.small', 'לפני ההחלפה נשמר עותק שחזור של המצב הנוכחי.'))),
      h('table.data', h('tbody',
        h('tr', h('th', 'נוצר'), h('td', res.info.exportedAt ? ltr(new Date(res.info.exportedAt).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' })) : 'לא ידוע')),
        h('tr', h('th', 'גרסת נתונים'), h('td', String(res.info.schemaVersion), res.info.migrated ? ' (ישודרג)' : '')),
        ...[['tasks', 'משימות'], ['questions', 'שאלות'], ['meetings', 'פגישות'], ['inquiryLogs', 'אירועי ספירה'], ['faqEntries', 'תשובות נפוצות'], ['workNotes', 'רשומות'], ['issueLogs', 'תקלות'], ['dailyReports', 'ימים שנסגרו']].map(([k, l]) => h('tr', h('th', l), h('td', String(c[k] ?? 0)))))),
    ],
    footer: [btn('ביטול', () => sh.close(), 'ghost'), btn('החלפת כל הנתונים', async () => {
      if (!(await confirmDialog('לאשר החלפה מלאה של הנתונים בתוכן הגיבוי?', { danger: true, ok: 'החלפה' }))) return;
      const r = await store.replaceState(res.state, 'לפני שחזור מגיבוי');
      if (r.ok) { toast('הגיבוי שוחזר'); sh.close(true); } else toast(r.error, { error: true, timeout: 8000 });
    }, 'danger')],
  });
}

function backupSection(state) {
  const b = state.settings.backup;
  const file = h('input', { type: 'file', accept: '.json,application/json', 'aria-label': 'בחירת קובץ גיבוי' });
  file.addEventListener('change', () => { if (file.files[0]) restoreFromFile(file.files[0]); file.value = ''; });
  const days = input('number', b.reminderDays, { min: 0, max: 365 });
  days.addEventListener('change', () => run('updateSettings', { patch: { backup: { reminderDays: Number(days.value) } } }, { success: 'נשמר' }));
  const recBox = h('div.stack', h('p.muted.small', 'טוען…'));
  store.listRecovery().then((list) => recBox.replaceChildren(list.length ? h('div.list', list.map((r) => h('div.item', h('div.body', h('div.title', r.reason), h('div.meta', ltr(new Date(r.createdAt).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' })))),
    btn('שחזור', async () => {
      if (!(await confirmDialog(`לשחזר את העותק ״${r.reason}״? כל השינויים מאז יוחלפו (המצב הנוכחי יישמר כעותק נוסף).`, { danger: true, ok: 'שחזור' }))) return;
      const snap = await store.getRecovery(r.id);
      const res = await store.replaceState(snap.state, 'לפני שחזור עותק פנימי');
      toast(res.ok ? 'העותק שוחזר' : res.error, { error: !res.ok });
    }, 'small ghost')))) : h('p.muted.small', 'אין עותקי שחזור')))
    .catch(() => recBox.replaceChildren(h('p.muted.small', 'עותקי שחזור אינם זמינים במצב האחסון הנוכחי')));
  return [section('גיבוי', {},
    h('p', 'הגיבוי האחרון שהוכן: ', b.lastExportAt ? ltr(new Date(b.lastExportAt).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' })) : 'עדיין לא'),
    h('p.muted.small', 'הרישום מתעד שהקובץ הוכן או שותף – לא שהוא נשמר בפועל בתיקייה. כדאי לשמור עותק מחוץ למכשיר.'),
    btn('ייצוא גיבוי מלא', () => exportBackup(), 'primary', 'download'),
    h('p.muted.small', PRIVACY_NOTE, ' קובץ הגיבוי אינו מוצפן.'),
    field('תזכורת גיבוי כל (ימים, 0 = ללא)', days)),
  section('שחזור מגיבוי', {}, h('label.btn.soft', ic('upload', 18), 'בחירת קובץ גיבוי', file), h('p.muted.small', 'קובצי luma-work-backup בלבד. קובץ תוכנית או קובץ של אפליקציה אחרת יידחו בלי לשנות נתונים.')),
  section('עותקי שחזור פנימיים', {}, h('p.muted.small', 'נשמרים אוטומטית (עד 5) לפני ייבוא, שחזור ושדרוג נתונים, ופעם ביום. הם נמצאים באותו מכשיר ולא יעזרו אם האחסון עצמו יימחק.'), recBox)];
}

function aboutSection() {
  const info = h('div.stack', h('p.muted.small', 'בודק…'));
  storageInfo().then((s) => info.replaceChildren(
    h('p', 'מצב אחסון: ', h('b', store.status.mode === 'primary' ? 'IndexedDB (רגיל)' : store.status.mode === 'degraded' ? 'זמני (localStorage) – מצב מוגבל' : 'ללא אחסון')),
    s.usage != null ? h('p.small', 'בשימוש: ', ltr(`${Math.round(s.usage / 1024)} KB`), s.quota ? h('span', ' מתוך כ־', ltr(`${Math.round(s.quota / 1024 / 1024)} MB`)) : null) : null,
    h('p.small', 'אחסון מתמיד: ', s.persisted == null ? 'לא נתמך בדפדפן' : s.persisted ? 'אושר על ידי הדפדפן' : 'לא אושר'),
    s.persisted === false ? btn('בקשת אחסון מתמיד', async () => { const ok = await requestPersistence(); toast(ok ? 'הדפדפן אישר אחסון מתמיד' : 'הדפדפן לא אישר. אין בכך כדי למנוע שימוש, אבל חשוב לגבות.'); }, 'small soft') : null));
  return [section('התקנה', {},
    h('ul.small', h('li', 'iPhone: לפתוח ב־Safari ← שיתוף ← ״הוספה למסך הבית״.'), h('li', 'Android / מחשב: בתפריט הדפדפן ← ״התקנת האפליקציה״.'), h('li', 'אחרי טעינה ראשונה מלאה האפליקציה עובדת גם בלי אינטרנט.'))),
  section('אחסון', {}, info),
  section('פרטיות', {},
    h('ul.small',
      h('li', 'כל הנתונים נשמרים רק במכשיר הזה. אין חשבון, שרת, סנכרון או שליחת נתונים.'),
      h('li', 'אחסון הדפדפן אינו הצפנה ואינו גיבוי. מחיקת נתוני אתר, גלישה פרטית או החלפת מכשיר עלולות למחוק את הנתונים.'),
      h('li', 'לשמור רק תיאורי עבודה כלליים וספירות מצטברות – בלי שמות פונים, מזהים, פרטי תיקים, תוכן מיילים או מסמכים.'),
      h('li', 'אין חיבור ל־CRM, Outlook או WhatsApp.')),
    h('p.small.muted', `Luma · גרסה ${APP_VERSION}`))];
}

export function render(main, args) {
  const state = S();
  const sec = SECTIONS.some((s) => s[0] === args[0]) ? args[0] : null;
  if (!sec) {
    main.replaceChildren(h('div.page', h('div.list', SECTIONS.map(([id, label, icn]) => h('a.item', { href: id === 'import' ? '#/import' : `#/settings/${id}`, style: { color: 'inherit', textDecoration: 'none' } }, ic(icn, 22), h('div.body', h('div.title', label)), ic('left', 18))))));
    return;
  }
  const map = { calendar: calendarSection, template: templateSection, targets: targetsSection, categories: categoriesSection, planner: plannerSection, closing: closingSection, header: headerSection, appearance: appearanceSection, backup: backupSection, about: aboutSection };
  main.replaceChildren(h('div.page', h('a.btn.ghost.small', { href: '#/settings', style: { alignSelf: 'flex-start' } }, ic('arrowBack', 18), 'כל ההגדרות'), map[sec](state)));
}
