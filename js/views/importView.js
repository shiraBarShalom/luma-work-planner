// ייבוא תוכנית – ChatGPT instructions, paste/file input, validation, read-only preview,
// explicit resolution and approval, atomic apply, import history and safe undo.
import { h, ic, ltr, btn, seg, section, empty, input, textarea, select, check, openSheet } from '../ui.js';
import { S, run } from '../app.js';
import { weekStart, addDays, fmtDM, weekday, isValidDate, isValidTime } from '../dates.js';
import { parsePlan, buildPreview, resolveSelection, previewUndoImport, PlanError, COLLECTION_LABEL } from '../data/importPlan.js';
import { buildPlanningPrompt } from '../data/prompt.js';
import { copyText } from '../export/share.js';
import { LIMITS } from '../config.js';

let session = { text: '', plan: null, preview: null, selection: {}, resolutions: {}, ackOverlaps: false, allowOutsideWeek: false, errors: null, done: null };
const ACTION = { add: 'חדש', update: 'עדכון', unchanged: 'כבר יובא' };

function promptCard(ctx) {
  const defDate = weekday(ctx.date) >= 4 ? addDays(weekStart(ctx.date), 7) : weekStart(ctx.date);
  const kind = seg([{ value: 'weekly', label: 'תכנון שבועי' }, { value: 'dailyPatch', label: 'תכנון ליום' }], 'weekly', () => { date.value = kind.value === 'weekly' ? defDate : addDays(ctx.date, 1); }, 'סוג תכנון');
  const date = input('date', defDate, { 'aria-label': 'תאריך בשבוע / היום המתוכנן' });
  const preview = h('pre.code.card.flat', { style: { maxHeight: '260px', overflow: 'auto' } });
  return section('1. הנחיות ל־ChatGPT', {},
    h('p.small', 'מעתיקים את ההנחיות, מדביקים ב־ChatGPT, מתארים בדיבור או בהקלדה את השבוע או היום, ומקבלים JSON. האפליקציה לא מתחברת ל־ChatGPT ולא שולחת אליו דבר.'),
    h('p.small.muted', 'ההנחיות כוללות רק הגדרות כלליות (ימי עבודה, שעות, תבנית, קטגוריות) – בלי משימות, הערות או היסטוריה. גם בהכתבה ל־ChatGPT לא לכלול פרטים מזהים או מידע סודי.'),
    kind, h('div.row.wrap', date, btn('העתקת הנחיות ל־ChatGPT', () => {
      if (!isValidDate(date.value)) return;
      copyText(buildPlanningPrompt(S(), { kind: kind.value, date: date.value }));
    }, 'primary', 'copy')),
    h('details.more', { ontoggle: (e) => { if (e.target.open) preview.textContent = buildPlanningPrompt(S(), { kind: kind.value, date: date.value }); } }, h('summary', 'הצגת ההנחיות'), preview));
}

function inputCard() {
  const area = textarea(session.text, { rows: 8, dir: 'ltr', class: 'code', 'aria-label': 'JSON של התוכנית', placeholder: '{ "format": "luma-work-plan", ... }' });
  const file = h('input', { type: 'file', accept: '.json,application/json', 'aria-label': 'בחירת קובץ JSON' });
  file.addEventListener('change', async () => {
    const f = file.files[0];
    if (!f) return;
    if (f.size > LIMITS.planBytes) { session.errors = [{ path: '', message: `הקובץ גדול מדי (${Math.round(f.size / 1024)} KB)` }]; rerender(); return; }
    area.value = await f.text();
    check2();
  });
  const check2 = () => {
    session.text = area.value;
    session.errors = null; session.preview = null; session.plan = null; session.done = null;
    try {
      session.plan = parsePlan(area.value);
      session.selection = {}; session.resolutions = {}; session.ackOverlaps = false; session.allowOutsideWeek = false;
      session.preview = buildPreview(S(), session.plan, { allowOutsideWeek: false });
    } catch (e) {
      session.errors = e instanceof PlanError ? [{ path: '', message: e.message }, ...(e.errors || [])] : [{ path: '', message: 'שגיאה בקריאת התוכנית' }];
    }
    rerender();
  };
  return section('2. הדבקת התוכנית', {},
    area, h('div.row.wrap', h('label.btn.ghost', ic('upload', 18), 'בחירת קובץ', h('span.sr-only', 'JSON'), file), btn('בדיקה ותצוגה מקדימה', check2, 'primary'),
      session.text ? btn('ניקוי', () => { session = { ...session, text: '', plan: null, preview: null, errors: null, done: null }; rerender(); }, 'ghost') : null),
    h('p.muted.small', 'הבדיקה לא משנה שום נתון. שינויים נכנסים רק אחרי אישור מפורש בשלב הבא.'));
  function rerender() { document.dispatchEvent(new CustomEvent('luma:rerender')); }
}

function resolutionControls(item, onChange) {
  const st = S();
  const r = session.resolutions[item.key] ||= {};
  const out = [];
  for (const iss of item.issues) {
    if (iss.type === 'needsTime') {
      if (iss.field === 'start') {
        const s = input('time', r.start || '', { 'aria-label': `שעת התחלה עבור ${item.title}` });
        s.addEventListener('change', () => { r.start = isValidTime(s.value) ? s.value : undefined; onChange(); });
        out.push(h('label.row.small', 'התחלה: ', s));
      }
      const e = input('time', r.end || '', { 'aria-label': `שעת סיום עבור ${item.title}` });
      const d = input('number', r.durationMinutes || '', { min: 1, max: 720, placeholder: 'דקות', 'aria-label': `משך בדקות עבור ${item.title}`, style: { maxWidth: '110px' } });
      e.addEventListener('change', () => { r.end = isValidTime(e.value) ? e.value : undefined; onChange(); });
      d.addEventListener('change', () => { r.durationMinutes = d.value ? Number(d.value) : undefined; onChange(); });
      out.push(h('div.row.wrap.small', 'סיום: ', e, ' או משך: ', d));
    } else if (iss.type === 'unknownCategory') {
      const s = select([{ value: '', label: 'בחירת קטגוריה…' }, ...st.settings.categories.filter((c) => !c.archived).map((c) => ({ value: c.id, label: c.label }))], r.categoryId || '', { 'aria-label': `קטגוריה עבור ${item.title}` });
      s.addEventListener('change', () => { r.categoryId = s.value || undefined; onChange(); });
      out.push(s);
    } else if (iss.type === 'unknownTemplate') {
      const s = select([{ value: '', label: 'בחירה…' }, { value: '__ignore', label: 'להתעלם מהתבנית' }, ...st.dayTemplates.map((t) => ({ value: t.id, label: t.name }))], r.templateId === null ? '__ignore' : r.templateId || '', { 'aria-label': `תבנית עבור ${item.title}` });
      s.addEventListener('change', () => { r.templateId = s.value === '__ignore' ? null : s.value || undefined; onChange(); });
      out.push(s);
    } else if (iss.type === 'manualEdited') {
      out.push(check('לאשר דריסה של העריכה הידנית', r.overwriteManual, (v) => { r.overwriteManual = v; onChange(); }));
    }
  }
  if (item.deps.length) out.push(check('להסיר הפניות לפריטים שהוחרגו', r.dropRefs, (v) => { r.dropRefs = v; onChange(); }));
  return out;
}

function previewCard() {
  const p = session.preview;
  const st = S();
  if (p.stateRevision !== st.metadata.revision) {
    session.preview = buildPreview(st, session.plan, { allowOutsideWeek: session.allowOutsideWeek });
    return previewCard();
  }
  const status = h('div', { 'aria-live': 'polite' });
  const approve = btn('אישור וייבוא', () => apply(), 'primary block', 'check');
  const refresh = () => {
    const r = resolveSelection(session.preview, session.selection, session.resolutions, { ackOverlaps: session.ackOverlaps });
    approve.disabled = !r.ok;
    status.replaceChildren(r.ok ? h('p.small', `ייובאו ${r.items.length} פריטים.`) : h('div.banner.danger', ic('alert'), h('div.grow', h('b', 'יש להשלים לפני האישור:'), h('ul.small', r.errors.map((e) => h('li', e.message))))));
  };
  const groups = ['days', 'blocks', 'meetings', 'tasks', 'questions'].map((c) => {
    const items = p.items.filter((i) => i.collection === c);
    if (!items.length) return null;
    return section(COLLECTION_LABEL[c], { count: items.length }, h('div.list', items.map((i) => {
      const selected = i.action !== 'unchanged' && (session.selection[i.key] ?? i.defaultSelected);
      const box = h('input', { type: 'checkbox', 'aria-label': `לכלול: ${i.title}`, disabled: i.action === 'unchanged' });
      box.checked = selected;
      box.addEventListener('change', () => { session.selection[i.key] = box.checked; refresh(); });
      const beforeLine = i.before && i.action === 'update' ? h('div.small.muted', 'קיים כעת: ', Object.entries(i.before).filter(([k]) => !['importRef', 'editedAt'].includes(k)).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ')) : null;
      return h('div.pv-item', h('label', box),
        h('div.body', h('div.row.wrap', h('b', i.title), h('span.chip' + (i.action === 'update' ? '.warn' : i.action === 'unchanged' ? '' : '.ok'), ACTION[i.action])),
          i.sub ? h('div.small.muted', i.sub) : null, beforeLine,
          i.issues.length ? h('div.issues', i.issues.map((x) => h('div.pv-issue' + (x.blocking ? '.blocking' : ['overlap', 'protectedOverlap', 'possibleDuplicate', 'outsideHours', 'nonWorkingWithBlocks'].includes(x.type) ? '.warn' : ''), x.message))) : null,
          h('div.stack', resolutionControls(i, refresh))));
    })));
  });
  const hasProtected = p.items.some((i) => i.issues.some((x) => x.type === 'protectedOverlap'));
  const hasOutside = p.items.some((i) => i.issues.some((x) => x.type === 'outsideWeek'));
  setTimeout(refresh, 0);
  return h('div.stack',
    section('3. תצוגה מקדימה', {},
      h('div.card.cool.stack',
        h('div.row.wrap', h('b', p.planId), h('span.chip', p.kind === 'weekly' ? 'שבועי' : 'עדכון יומי'), p.range ? h('span', ltr(fmtDM(p.range.from)), ' – ', ltr(fmtDM(p.range.to))) : null),
        h('div.stats', h('div.stat', h('b', String(p.counts.add)), h('span', 'חדשים')), h('div.stat', h('b', String(p.counts.update)), h('span', 'עדכונים')),
          h('div.stat', h('b', String(p.counts.unchanged)), h('span', 'כבר יובאו')), h('div.stat', h('b', String(p.counts.duplicates)), h('span', 'כפילויות אפשריות')),
          h('div.stat', h('b', String(p.counts.conflicts)), h('span', 'התנגשויות')), h('div.stat', h('b', String(p.counts.needsCompletion)), h('span', 'דורשים השלמה')))),
      p.exactReplay ? h('div.banner.info', ic('checkCircle'), h('div.grow', 'התוכנית הזו כבר יובאה במלואה. אין מה לייבא שוב.')) : null,
      hasOutside ? check('להרחיב את הייבוא גם לתאריכים מחוץ לשבוע המבוקש', session.allowOutsideWeek, (v) => { session.allowOutsideWeek = v; session.preview = buildPreview(S(), session.plan, { allowOutsideWeek: v }); document.dispatchEvent(new CustomEvent('luma:rerender')); }) : null,
      hasProtected ? check('אני מאשרת חפיפה עם פגישות או הפסקה מוגנת', session.ackOverlaps, (v) => { session.ackOverlaps = v; refresh(); }) : null,
      ...groups.filter(Boolean)),
    h('p.small.muted', 'הייבוא מוסיף ומעדכן בלבד – לא מוחק, לא מסמן משימות כהושלמו ולא מוסיף ספירות פניות. נשמר עותק שחזור לפני הייבוא.'),
    status, approve);
}

async function apply() {
  const st = S();
  const r = await run('importPlan', { plan: session.plan, selection: session.selection, resolutions: session.resolutions, ackOverlaps: session.ackOverlaps, allowOutsideWeek: session.allowOutsideWeek, expectedRevision: st.metadata.revision }, { success: 'התוכנית יובאה' });
  if (r) {
    session = { text: '', plan: null, preview: null, selection: {}, resolutions: {}, ackOverlaps: false, allowOutsideWeek: false, errors: null, done: r };
    document.dispatchEvent(new CustomEvent('luma:rerender'));
  }
}

function openUndo(entry) {
  const st = S();
  const p = previewUndoImport(st, entry.id);
  if (!p.ok) return;
  const sh = openSheet({
    title: 'ביטול ייבוא',
    body: [
      p.clean ? h('p', 'לא היו שינויים מאז הייבוא – הביטול יחזיר את המצב בדיוק כפי שהיה.') : h('div.banner', ic('alert'), h('div.grow', 'היו שינויים מאז הייבוא. יבוטלו רק השינויים שלא הושפעו; פריטים שנערכו או קושרו יישארו.')),
      h('h3', `יבוטלו (${p.revert.length})`), p.revert.length ? h('ul.small', p.revert.map((x) => h('li', x.label))) : h('p.muted', 'אין'),
      p.keep.length ? [h('h3', `יישארו (${p.keep.length})`), h('ul.small', p.keep.map((x) => h('li', x.label, ' – ', x.reason)))] : null,
      h('p.small.muted', 'לחזרה מלאה למצב שלפני הייבוא אפשר גם לשחזר את עותק השחזור בהגדרות ← גיבוי ושחזור (בזהירות: זה מבטל גם שינויים מאוחרים יותר).'),
    ],
    footer: [btn('סגירה', () => sh.close(), 'ghost'), btn('ביטול הייבוא', async () => {
      if (!p.revert.length) { sh.close(); return; }
      if (await run('undoImport', { historyId: entry.id, expectedRevision: S().metadata.revision }, { success: 'הייבוא בוטל' })) sh.close(true);
    }, 'primary', null, { disabled: !p.revert.length })],
  });
}

function historyCard() {
  const hist = S().importHistory;
  return section('היסטוריית ייבוא', { count: hist.length },
    hist.length ? h('div.list', hist.map((e) => h('div.item', ic('upload', 20),
      h('div.body', h('div.title', e.planId), h('div.meta', ltr(new Date(e.appliedAt).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' })), ` · ${e.items.filter((i) => i.action === 'added').length} נוספו, ${e.items.filter((i) => i.action === 'updated').length} עודכנו, ${e.excluded.length} הוחרגו`, e.undoneAt ? (e.partialUndo ? ' · בוטל חלקית' : ' · בוטל') : '')),
      !e.undoneAt ? btn('ביטול', () => openUndo(e), 'small ghost', 'undo') : null))) : empty('עדיין לא יובאו תוכניות'));
}

export function render(main, args, ctx) {
  const parts = [h('h1', 'ייבוא תוכנית עבודה'), promptCard(ctx), inputCard()];
  if (session.errors) parts.push(h('div.banner.danger', { role: 'alert' }, ic('alert'), h('div.grow', h('b', 'התוכנית לא נטענה. לא בוצע שום שינוי.'), h('ul.small', session.errors.slice(0, 30).map((e) => h('li', e.path ? h('span', h('bdi.ltr', e.path), ': ') : null, e.message))),
    h('p.small', 'אפשר לבקש מ־ChatGPT לתקן לפי השגיאות ולהחזיר JSON בלבד באותו planId.'))));
  if (session.done) parts.push(h('div.banner.info', ic('checkCircle'), h('div.grow', `הייבוא הושלם: ${session.done.added} נוספו, ${session.done.updated} עודכנו, ${session.done.excluded} הוחרגו.`, h('div.banner-actions', h('a.btn.small.soft', { href: '#/calendar/week' }, 'ליומן השבועי'), h('a.btn.small.ghost', { href: '#/tasks/upcoming' }, 'למשימות')))));
  if (session.preview) parts.push(previewCard());
  parts.push(historyCard(), h('p.small.muted', 'קובץ תוכנית אינו גיבוי. לשחזור גיבוי מלא: הגדרות ← גיבוי ושחזור.'));
  main.replaceChildren(h('div.page', parts));
}

