// ייבוא תוכנית - copy ChatGPT instructions, paste or choose the JSON, review a read-only
// preview, approve explicitly, apply atomically; history with safe undo.
import { h, ic, btn, seg, section, textarea, check, openSheet, input, dateInput, timeInput, setChildren } from '../ui.js';
import { S, run } from '../app.js';
import { weekStart, addDays, weekday, isValidDate, isValidTime } from '../dates.js';
import { parsePlan, buildPreview, resolveSelection, previewUndoImport, PlanError, COLLECTION_LABEL } from '../data/importPlan.js';
import { buildPlanningPrompt } from '../data/prompt.js';
import { copyText } from '../export/share.js';
import { LIMITS } from '../config.js';

let session = { text: '', plan: null, preview: null, selection: {}, resolutions: {}, allowOutsideWeek: false, errors: null, done: null };
const ACTION = { add: 'חדש', update: 'עדכון', unchanged: 'כבר יובא' };
const rerender = () => document.dispatchEvent(new CustomEvent('luma:rerender'));

function promptCard(ctx) {
  const defDate = weekday(ctx.date) >= 4 ? addDays(weekStart(ctx.date), 7) : weekStart(ctx.date);
  const date = dateInput(defDate, { label: 'תאריך לתכנון' });
  const kind = seg([{ value: 'weekly', label: 'שבוע' }, { value: 'dailyPatch', label: 'יום' }], 'weekly', (v) => { date.value = v === 'weekly' ? defDate : addDays(ctx.date, 1); }, 'סוג תכנון');
  return section('1. הנחיות ל-ChatGPT', {},
    kind, date,
    btn('העתקת הנחיות ל-ChatGPT', () => { if (isValidDate(date.value)) copyText(buildPlanningPrompt(S(), { kind: kind.value, date: date.value })); }, 'primary', 'copy'));
}

function inputCard() {
  const area = textarea(session.text, { rows: 6, dir: 'ltr', class: 'code', 'aria-label': 'JSON של התוכנית', placeholder: '{ "format": "luma-work-plan", … }' });
  const file = h('input', { type: 'file', accept: '.json,application/json', 'aria-label': 'בחירת קובץ JSON' });
  const check2 = () => {
    session.text = area.value;
    session.errors = null; session.preview = null; session.plan = null; session.done = null;
    try {
      session.plan = parsePlan(area.value);
      session.selection = {}; session.resolutions = {}; session.allowOutsideWeek = false;
      session.preview = buildPreview(S(), session.plan, { allowOutsideWeek: false });
    } catch (e) {
      session.errors = e instanceof PlanError ? [{ path: '', message: e.message }, ...(e.errors || [])] : [{ path: '', message: 'לא ניתן לקרוא את התוכנית' }];
    }
    rerender();
  };
  file.addEventListener('change', async () => {
    const f = file.files[0];
    if (!f) return;
    if (f.size > LIMITS.planBytes) { session.errors = [{ path: '', message: `הקובץ גדול מדי (${Math.round(f.size / 1024)} KB)` }]; rerender(); return; }
    area.value = await f.text();
    check2();
  });
  return section('2. הדבקת התוכנית', {},
    area,
    h('div.row.wrap', btn('בדיקה', check2, 'primary'), h('label.btn.ghost', ic('upload', 18), 'בחירת קובץ', file),
      session.text ? btn('ניקוי', () => { session = { ...session, text: '', plan: null, preview: null, errors: null, done: null }; rerender(); }, 'ghost') : null));
}

function timeResolution(item, onChange) {
  const r = session.resolutions[item.key] ||= {};
  const out = [];
  for (const iss of item.issues) {
    if (iss.type === 'needsTime') {
      if (iss.field === 'start') {
        const s = timeInput(r.start || '', { 'aria-label': `שעת התחלה עבור ${item.title}` });
        s.addEventListener('change', () => { r.start = isValidTime(s.value) ? s.value : undefined; onChange(); });
        out.push(h('label.row.small', 'התחלה ', s));
      }
      const e = timeInput(r.end || '', { 'aria-label': `שעת סיום עבור ${item.title}` });
      const d = input('number', r.durationMinutes || '', { min: 1, max: 720, placeholder: 'דקות', inputmode: 'numeric', 'aria-label': `משך בדקות עבור ${item.title}`, class: 'minutes-input' });
      e.addEventListener('change', () => { r.end = isValidTime(e.value) ? e.value : undefined; onChange(); });
      d.addEventListener('change', () => { r.durationMinutes = d.value ? Number(d.value) : undefined; onChange(); });
      out.push(h('div.row.wrap.small', 'סיום ', e, ' או ', d));
    } else if (iss.type === 'manualEdited') {
      out.push(check('לעדכן בכל זאת', r.overwriteManual, (v) => { r.overwriteManual = v; onChange(); }));
    }
  }
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
    const r = resolveSelection(session.preview, session.selection, session.resolutions);
    approve.disabled = !r.ok;
    setChildren(status, r.ok ? h('p.small', `ייובאו ${r.items.length} פריטים.`) : h('ul.small.form-error', r.errors.map((e) => h('li', e.message))));
  };
  const groups = ['activities', 'tasks'].map((c) => {
    const items = p.items.filter((i) => i.collection === c);
    if (!items.length) return null;
    return section(COLLECTION_LABEL[c], {}, h('div.list', items.map((i) => {
      const box = h('input', { type: 'checkbox', 'aria-label': `לכלול: ${i.title}`, disabled: i.action === 'unchanged' });
      box.checked = i.action !== 'unchanged' && (session.selection[i.key] ?? i.defaultSelected);
      box.addEventListener('change', () => { session.selection[i.key] = box.checked; refresh(); });
      const notes = [...i.issues.map((x) => h('div.pv-issue' + (x.blocking ? '.blocking' : ''), x.message)), i.dropped.length ? h('div.pv-issue', 'לא ייובא: ', i.dropped.join(', ')) : null];
      return h('div.pv-item', h('label.pv-check', box),
        h('div.body', h('div.row.wrap', h('b', i.title), h('span.chip' + (i.action === 'update' ? '.warn' : i.action === 'add' ? '.ok' : ''), ACTION[i.action])),
          i.sub ? h('div.small.muted', i.sub) : null, ...notes, ...timeResolution(i, refresh)));
    })));
  });
  const unsupported = p.items.filter((i) => i.action === 'unsupported');
  const hasOutside = p.items.some((i) => i.issues.some((x) => x.type === 'outsideWeek'));
  setTimeout(refresh, 0);
  return h('div.stack',
    section('3. בדיקה ואישור', {},
      p.exactReplay ? h('p', 'התוכנית הזו כבר יובאה.') : h('p.small.muted', `${p.counts.add} חדשים · ${p.counts.update} עדכונים · ${p.counts.unchanged} כבר יובאו`),
      hasOutside ? check('לכלול גם תאריכים מחוץ לשבוע', session.allowOutsideWeek, (v) => { session.allowOutsideWeek = v; session.preview = buildPreview(S(), session.plan, { allowOutsideWeek: v }); rerender(); }) : null,
      ...groups.filter(Boolean),
      unsupported.length ? section('לא ייובאו', {}, h('ul.small.plain', unsupported.map((i) => h('li', h('b', i.title), ' - ', i.sub)))) : null),
    status, approve);
}

async function apply() {
  const r = await run('importPlan', { plan: session.plan, selection: session.selection, resolutions: session.resolutions, allowOutsideWeek: session.allowOutsideWeek, expectedRevision: S().metadata.revision }, { success: 'התוכנית יובאה' });
  if (r) {
    session = { text: '', plan: null, preview: null, selection: {}, resolutions: {}, allowOutsideWeek: false, errors: null, done: r };
    rerender();
  }
}

function openUndo(entry) {
  const p = previewUndoImport(S(), entry.id);
  if (!p.ok) return;
  const sh = openSheet({
    title: 'ביטול ייבוא',
    body: [
      p.revert.length ? h('ul.small', p.revert.map((x) => h('li', x.label))) : h('p.muted', 'אין מה לבטל'),
      p.keep.length ? [h('p.small', 'יישארו:'), h('ul.small', p.keep.map((x) => h('li', x.label, ' - ', x.reason)))] : null,
    ],
    footer: [btn('סגירה', () => sh.close(), 'ghost'), btn('ביטול הייבוא', async () => {
      if (await run('undoImport', { historyId: entry.id, expectedRevision: S().metadata.revision }, { success: 'הייבוא בוטל' })) sh.close(true);
    }, 'primary', null, { disabled: !p.revert.length })],
  });
}

function historyCard() {
  const hist = S().importHistory;
  if (!hist.length) return null;
  return h('details.more', h('summary', 'ייבואים קודמים'), h('div.list', hist.map((e) => h('div.item',
    h('div.body', h('div.title', e.planId), h('div.meta', `${e.items.filter((i) => i.action === 'added').length} נוספו`, e.undoneAt ? ' · בוטל' : '')),
    !e.undoneAt ? btn('ביטול', () => openUndo(e), 'small ghost', 'undo') : null))));
}

export function render(main, args, ctx) {
  const parts = [h('a.btn.ghost.small.back-link', { href: '#/settings' }, ic('right', 18), 'הגדרות'), promptCard(ctx), inputCard()];
  if (session.errors) parts.push(h('div.banner.danger', { role: 'alert' }, ic('alert'), h('div.grow', h('b', 'התוכנית לא נטענה. לא בוצע שינוי.'), h('ul.small', session.errors.slice(0, 30).map((e) => h('li', e.path ? h('bdi.ltr', e.path) : null, e.path ? ': ' : null, e.message))))));
  if (session.done) parts.push(h('div.banner.info', { role: 'status' }, ic('checkCircle'), h('div.grow', `הייבוא הושלם: ${session.done.added} נוספו${session.done.updated ? `, ${session.done.updated} עודכנו` : ''}.`)));
  if (session.preview) parts.push(previewCard());
  parts.push(historyCard());
  main.replaceChildren(h('div.page', parts.filter(Boolean)));
}
