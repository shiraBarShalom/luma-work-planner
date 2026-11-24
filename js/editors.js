// Sheets for creating and editing records. All writes go through store commands via run().
import { h, ic, ltr, btn, iconBtn, openSheet, field, input, textarea, select, seg, check, dayPicker, choose, confirmDialog, promptText, toast, empty } from './ui.js';
import { S, run, nowCtx, store } from './app.js';
import { fmtDM, fmtDayDate, toMin, fromMin, weekday, addDays, isValidDate, isValidTime, dur } from './dates.js';
import {
  PRIORITY_LABEL, TASK_STATUS_LABEL, LOCATION_LABEL, BLOCK_STATUS_LABEL, ROLE_LABEL, TEMPLATE_ROLES, AUDIENCE_LABEL, QUESTION_STATUS_LABEL, MEETING_TYPE_LABEL, ISSUE_STATUS_LABEL, REPORTED_TO_LABEL, CARRYOVER_LABEL, DAY_TYPE_LABEL, QUESTION_KIND_LABEL,
} from './data/schema.js';
import { effectiveDay, baseDay } from './engine/dayTemplates.js';
import { materializedOccurrence } from './engine/taskCarryover.js';

/** Keep a region of an open sheet in sync with the store until the sheet closes. */
function live(box, render) {
  box.replaceChildren(render());
  const off = store.subscribe(() => { if (box.isConnected) box.replaceChildren(render()); else off(); });
  return off;
}
import { findOccurrence, dayOccurrences, parseOccId } from './engine/schedule.js';
import { recurrenceLabel } from './engine/recurrence.js';
import { effectiveTarget } from './engine/inquiries.js';
import { upcomingMeetings, meetingAgenda } from './engine/team.js';
import { catChip } from './views/common.js';

const catOptions = (state, withNone = false) => [
  ...(withNone ? [{ value: '', label: '— ללא —' }] : []),
  ...state.settings.categories.filter((c) => !c.archived).map((c) => ({ value: c.id, label: c.label })),
];
const prioOptions = () => ['high', 'medium', 'low'].map((p) => ({ value: p, label: PRIORITY_LABEL[p] }));
const formError = () => h('p.form-error', { role: 'alert', 'aria-live': 'assertive' });

// ---------------- recurrence fields (shared) ----------------
function recurrenceFields(initial, startDate) {
  const r = initial || { kind: 'none' };
  const kind = select([
    { value: 'none', label: 'ללא חזרה' }, { value: 'daily', label: 'יומי' }, { value: 'weekly', label: 'שבועי / כל כמה שבועות' },
    { value: 'monthly', label: 'חודשי' }, { value: 'dayType', label: 'לפי סוג יום' },
  ], r.kind || 'none');
  const interval = input('number', r.interval || 1, { min: 1, max: 52, inputmode: 'numeric' });
  const workdaysOnly = check('רק בימי עבודה', r.workdaysOnly ?? true);
  const days = dayPicker(r.weekdays || [weekday(startDate)]);
  const monthDay = input('number', r.monthDay || +startDate.slice(8), { min: 1, max: 31, inputmode: 'numeric' });
  const overflow = select([{ value: 'skip', label: 'לדלג בחודש בלי היום הזה' }, { value: 'lastDay', label: 'ביום האחרון בחודש' }], r.monthOverflow || 'skip');
  const dayType = select(Object.entries(DAY_TYPE_LABEL).map(([value, label]) => ({ value, label })), r.dayType || 'workday');
  const endDate = input('date', r.endDate || '');
  const wrap = h('div.stack');
  const render = () => {
    const k = kind.value;
    wrap.replaceChildren(
      field('חזרה', kind),
      k === 'daily' ? h('div.stack', field('כל כמה ימים', interval), workdaysOnly) : null,
      k === 'weekly' ? h('div.stack', field('ימים', days), field('כל כמה שבועות', interval)) : null,
      k === 'monthly' ? h('div.grid2', field('יום בחודש', monthDay), field('כשהיום לא קיים', overflow)) : null,
      k === 'dayType' ? field('סוג יום', dayType) : null,
      k !== 'none' ? field('עד תאריך (לא חובה)', endDate) : null,
    );
  };
  kind.addEventListener('change', render);
  render();
  wrap.read = () => {
    const k = kind.value;
    if (k === 'none') return null;
    return {
      kind: k, interval: Number(interval.value) || 1, weekdays: days.value, workdaysOnly: workdaysOnly.querySelector('input').checked,
      monthDay: Number(monthDay.value) || 1, monthOverflow: overflow.value, dayType: dayType.value, endDate: endDate.value || null,
    };
  };
  return wrap;
}

// ---------------- tasks ----------------
let taskDraft = null;

/** Add or edit a task. Only the title is required. */
export function openTaskEditor(task = null, { date = nowCtx().date, defaults = {}, onSaved } = {}) {
  const state = S();
  const isNew = !task;
  const virtual = task?.virtual;
  const src = task || { ...(taskDraft || {}), ...defaults };
  const title = input('text', src.title || '', { maxlength: 300, autocomplete: 'off', required: true, autofocus: true, 'aria-required': 'true' });
  const priority = select(prioOptions(), src.priority || 'medium');
  const scheduled = input('date', src.scheduledDate ?? (isNew && !('scheduledDate' in defaults) ? date : '') ?? '');
  const deadline = input('date', src.deadline || '');
  const cat = select(catOptions(state), src.categoryId || 'admin');
  const estimate = input('number', src.estimateMinutes ?? '', { min: 1, max: 1440, inputmode: 'numeric', placeholder: 'לא ידוע' });
  const actual = input('number', src.actualMinutes ?? '', { min: 0, max: 1440, inputmode: 'numeric', placeholder: 'לא ידוע' });
  const details = textarea(src.details || '', { maxlength: 5000, placeholder: 'פרטים כלליים בלבד – בלי פרטים מזהים של פונים' });
  const role = select([{ value: '', label: 'לפי הקטגוריה' }, ...TEMPLATE_ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] }))], src.preferredRole || '');
  const subtasksNew = textarea('', { rows: 2, placeholder: 'תת־משימה בכל שורה' });
  const rec = isNew ? recurrenceFields(null, scheduled.value || date) : null;
  const routine = isNew ? check('שגרה (רשימת בדיקה) – לא עוברת ליום הבא', false) : null;
  const err = formError();
  const more = h('details.more', h('summary', 'פרטים נוספים'), h('div.stack',
    h('div.grid2', field('מועד יעד', deadline), field('הערכת זמן (דק׳)', estimate)),
    !isNew ? field('זמן בפועל (דק׳)', actual, 'ריק = לא ידוע') : null,
    field('קטגוריה', cat), field('בלוק מועדף', role), field('פרטים', details),
    isNew ? field('תתי־משימות', subtasksNew) : null,
    isNew ? h('div.card.flat', rec, routine) : null));
  if (!isNew && (src.deadline || src.estimateMinutes || src.details)) more.open = true;

  const body = [field('תיאור המשימה', title), h('div.grid2', field('עדיפות', priority), field('תאריך ביצוע', scheduled, 'ריק = ללא תאריך (רשימת המתנה)')), more, err];
  let sh;
  if (!isNew) {
    const box = h('div');
    const current = () => {
      const st = S();
      if (task.virtual) return materializedOccurrence(st, task.recurringRuleId, task.occurrenceDate) || task;
      return st.tasks.find((x) => x.id === task.id) || null;
    };
    live(box, () => { const t = current(); return t ? existingTaskPanel(t, date, () => sh.close(true)) : h('p.muted', 'המשימה נמחקה'); });
    body.unshift(box);
  }

  const save = async () => {
    if (!title.value.trim()) { err.textContent = 'יש להזין תיאור למשימה'; title.setAttribute('aria-invalid', 'true'); title.focus(); return; }
    if (deadline.value && !isValidDate(deadline.value)) { err.textContent = 'מועד יעד לא תקין'; return; }
    const payload = {
      title: title.value, priority: priority.value, scheduledDate: scheduled.value || null, deadline: deadline.value || null,
      categoryId: cat.value, estimateMinutes: estimate.value ? Number(estimate.value) : null, details: details.value, preferredRole: role.value || null,
    };
    let res;
    if (isNew) {
      const recurrence = rec.read();
      res = await run('addTask', { ...payload, ...defaults.extra, subtasks: subtasksNew.value.split('\n').map((x) => x.trim()).filter(Boolean), recurrence: recurrence ? { ...recurrence, startDate: payload.scheduledDate || date } : null, routine: routine.querySelector('input').checked, priorityFor: defaults.priorityFor }, { success: recurrence ? 'המשימה החוזרת נוספה' : 'המשימה נוספה' });
    } else {
      res = await run('updateTask', { id: task.id, patch: { ...payload, actualMinutes: actual.value === '' ? null : Number(actual.value) } }, { success: 'המשימה עודכנה' });
    }
    if (res) { taskDraft = null; sh.close(true); onSaved && onSaved(res); }
  };
  title.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
  sh = openSheet({
    title: isNew ? 'הוספת משימה' : virtual ? 'משימה חוזרת' : 'עריכת משימה',
    body, footer: [btn(isNew ? 'הוספת משימה' : 'שמירה', save, 'primary')],
    onClose: (r) => { if (isNew && r === undefined && title.value.trim()) taskDraft = { title: title.value, priority: priority.value, scheduledDate: scheduled.value, deadline: deadline.value, categoryId: cat.value, details: details.value }; },
  });
  return sh;
}

function existingTaskPanel(t, date, close) {
  const state = S();
  const statusBtns = h('div.row.wrap',
    ['todo', 'inProgress', 'done'].map((st) => btn(TASK_STATUS_LABEL[st], () => run('setTaskStatus', { id: t.id, status: st }, { success: `סטטוס: ${TASK_STATUS_LABEL[st]}` }), 'small' + (t.status === st ? ' primary' : ''), null, { 'aria-pressed': String(t.status === st) })),
    btn('אפשרויות נוספות…', async () => { const { taskMenu } = await import('./views/common.js'); taskMenu(t, date); }, 'small ghost'));
  const subs = h('div.stack', t.subtasks.length ? h('div.list', t.subtasks.map((s) => h('div.item',
    h('button.cb', { type: 'button', 'aria-pressed': String(s.done), 'aria-label': `תת־משימה: ${s.title}`, onclick: () => run('updateSubtask', { taskId: t.id, subtaskId: s.id, done: !s.done }) }, h('span.box', { svg: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>' })),
    h('div.body', h('div.title', s.title)),
    iconBtn('trash', `מחיקת ${s.title}`, () => run('updateSubtask', { taskId: t.id, subtaskId: s.id, remove: true }))))) : null,
  btn('הוספת תת־משימה', async () => { const v = await promptText('תת־משימה חדשה', { label: 'כותרת' }); if (v) run('addSubtask', { taskId: t.id, title: v }); }, 'small soft', 'plus'));
  const info = [];
  if (t.originalScheduledDate && t.originalScheduledDate !== t.scheduledDate) info.push(h('div', 'תוכננה במקור ל־', ltr(fmtDM(t.originalScheduledDate))));
  if (t.recurringRuleId) {
    const rule = state.recurringRules.find((r) => r.id === t.recurringRuleId);
    if (rule) info.push(h('div.row.wrap', ic('repeat', 16), recurrenceLabel(rule.recurrence), btn('עריכת הסדרה', () => openRecurringRuleEditor(rule, t.occurrenceDate), 'small ghost'), btn('דילוג על המופע', () => run('skipRecurringOccurrence', { ruleId: rule.id, date: t.occurrenceDate }, { success: 'המופע דולג' }), 'small ghost')));
  }
  if (t.waiting && t.status === 'waiting') info.push(h('div', 'ממתינה: ', t.waiting.note || '—', t.waiting.followUpOn ? h('span', ' · מעקב ', ltr(fmtDM(t.waiting.followUpOn))) : null));
  if (t.status === 'deferred') info.push(h('div', 'נדחתה עד ', ltr(fmtDM(t.resumeOn))));
  if (t.completedOn) info.push(h('div', 'הושלמה ב־', ltr(fmtDM(t.completedOn))));
  if (t.assignedBlock) { const o = findOccurrence(state, t.assignedBlock); if (o) info.push(h('div', 'משובצת ב״', o.title, '״ ', ltr(`${o.start}–${o.end}`))); }
  if (t.source?.kind && t.source.kind !== 'manual') info.push(h('div.muted.small', 'מקור: ', { decision: 'החלטה בפגישה', question: 'שאלה', import: 'ייבוא תוכנית', issue: 'יומן תקלות', note: 'מחברת', recurring: 'משימה חוזרת' }[t.source.kind] || t.source.kind));
  if (t.scheduleHistory?.length) info.push(h('details.more', h('summary', `היסטוריית תזמון (${t.scheduleHistory.length})`), h('ul.small', t.scheduleHistory.map((x) => h('li', ltr(x.from || '—'), ' ← ', ltr(x.to || '—'))))));
  const del = !t.virtual && !t.recurringRuleId ? btn('מחיקת המשימה', async () => {
    if (await confirmDialog(`למחוק את ״${t.title}״? ההפניות אליה יוסרו (החלטות, תקלות ורשומות יישארו).`, { danger: true, ok: 'מחיקה' })) {
      const ok = await run('deleteTask', { id: t.id }, { success: 'המשימה נמחקה' });
      if (ok) close();
    }
  }, 'small ghost', 'trash') : null;
  return h('div.stack', h('div.row.wrap', h('span.chip', TASK_STATUS_LABEL[t.status]), t.categoryId ? catChip(state, t.categoryId) : null), statusBtns, info.length ? h('div.card.flat.stack.small', info) : null, h('h3', 'תתי־משימות'), subs, del, h('div.divider'));
}

export function openRecurringRuleEditor(rule, fromDate = nowCtx().date) {
  const state = S();
  const title = input('text', rule.title, { maxlength: 300 });
  const cat = select(catOptions(state), rule.categoryId);
  const priority = select(prioOptions(), rule.priority);
  const estimate = input('number', rule.estimateMinutes ?? '', { min: 1, max: 1440 });
  const carry = select(Object.entries(CARRYOVER_LABEL).map(([value, label]) => ({ value, label })), rule.routine ? 'none' : rule.carryover || 'latest');
  const rec = recurrenceFields(rule.recurrence, rule.recurrence.startDate);
  const scope = seg([{ value: 'all', label: 'כל הסדרה' }, { value: 'future', label: `מ־${fmtDM(fromDate)} והלאה` }], 'future', null, 'היקף השינוי');
  const sh = openSheet({
    title: 'משימה חוזרת',
    body: [field('כותרת', title), h('div.grid2', field('קטגוריה', cat), field('עדיפות', priority)), field('הערכת זמן (דק׳)', estimate), field('העברה כשלא בוצעה', carry, 'שגרה לא נצברת; משימה חוזרת לביצוע עוברת לפי הבחירה'), rec,
      field('היקף', scope, 'שינוי ״מתאריך והלאה״ שומר את ההיסטוריה של מופעים קודמים'),
      h('p.muted.small', 'כרגע: ', recurrenceLabel(rule.recurrence))],
    footer: [
      btn('סיום הסדרה', async () => { if (await confirmDialog('לסיים את הסדרה? מופעים קודמים והיסטוריית הביצוע נשמרים.', { ok: 'סיום' })) { await run('archiveRecurringRule', { id: rule.id }, { success: 'הסדרה הסתיימה' }); sh.close(true); } }, 'ghost'),
      btn('שמירה', async () => {
        const r = rec.read();
        if (!r) { toast('לביטול החזרה יש לבחור ״סיום הסדרה״', { error: true }); return; }
        const patch = { title: title.value, categoryId: cat.value, priority: priority.value, estimateMinutes: estimate.value ? Number(estimate.value) : null, carryover: carry.value, routine: carry.value === 'none', recurrence: { ...r, startDate: rule.recurrence.startDate } };
        if (await run('updateRecurringRule', { id: rule.id, patch, scope: scope.value, fromDate }, { success: 'הסדרה עודכנה' })) sh.close(true);
      }, 'primary'),
    ],
  });
}

// ---------------- day settings ----------------
export function openDaySettings(date) {
  const state = S();
  const eff = effectiveDay(state, date);
  const ov = state.dayOverrides[date] || {};
  const working = check('יום עבודה', eff.isWorking);
  const loc = seg(['office', 'home', 'other'].map((v) => ({ value: v, label: LOCATION_LABEL[v] })), eff.location || 'office', null, 'מיקום');
  const duty = check('תורנות טלפון', eff.phoneDuty);
  const ps = input('time', eff.phoneStart), pe = input('time', eff.phoneEnd);
  const ws = input('time', eff.workStart), we = input('time', eff.workEnd);
  const target = input('number', effectiveTarget(state, date).target, { min: 0, max: 1000, inputmode: 'numeric' });
  const label = input('text', ov.label || '', { maxlength: 80, placeholder: 'למשל: חופשה, יום מקוצר' });
  const templ = select(state.dayTemplates.map((t) => ({ value: t.id, label: t.name })), eff.templateId);
  const err = formError();
  const sh = openSheet({
    title: `הגדרות ל${fmtDayDate(date)}`,
    body: [
      h('p.muted.small', 'שינוי כאן חל על התאריך הזה בלבד. ברירות המחדל נמצאות בהגדרות ← לוח עבודה.'),
      working, field('מיקום', loc), h('div.card.flat.stack', duty, h('div.grid2', field('תחילת תורנות', ps), field('סוף תורנות', pe))),
      h('div.grid2', field('תחילת יום', ws), field('סוף יום', we)), field('יעד פניות', target), field('תבנית יום', templ), field('תווית', label), err,
    ],
    footer: [
      Object.keys(ov).length ? btn('חזרה לברירת המחדל', async () => {
        const patch = Object.fromEntries(['isWorking', 'location', 'phoneDuty', 'phoneStart', 'phoneEnd', 'workStart', 'workEnd', 'templateId', 'inquiryTarget', 'label', 'note'].map((k) => [k, null]));
        if (await run('setDayOverride', { date, patch }, { success: 'ההגדרות לתאריך אופסו' })) sh.close(true);
      }, 'ghost') : null,
      btn('שמירה', async () => {
        if (toMin(we.value) <= toMin(ws.value)) { err.textContent = 'סוף היום חייב להיות אחרי תחילתו'; return; }
        const isW = working.querySelector('input').checked;
        const def = baseDay(state, date);
        const patch = {};
        const setIf = (k, v, d) => { patch[k] = v === d ? null : v; };
        setIf('isWorking', isW, def.isWorking);
        setIf('location', isW ? loc.value : null, def.location);
        setIf('phoneDuty', duty.querySelector('input').checked, def.phoneDuty);
        setIf('phoneStart', ps.value, def.phoneStart); setIf('phoneEnd', pe.value, def.phoneEnd);
        setIf('workStart', ws.value, def.workStart); setIf('workEnd', we.value, def.workEnd);
        setIf('templateId', templ.value, def.templateId);
        const tgt = Number(target.value);
        const unchanged = tgt === effectiveTarget(state, date).target && ov.inquiryTarget == null;
        if (!Number.isInteger(tgt) || tgt < 0) { err.textContent = 'יעד לא תקין'; return; }
        patch.inquiryTarget = unchanged ? null : tgt;
        patch.label = label.value || null;
        if (await run('setDayOverride', { date, patch }, { success: 'הגדרות היום נשמרו' })) sh.close(true);
      }, 'primary'),
    ],
  });
}

// ---------------- blocks ----------------
async function askScope(o) {
  if (o.kind === 'routine') {
    return choose('על מה להחיל את השינוי?', [
      { value: 'this', label: 'רק על המופע הזה', sub: fmtDM(o.date) },
      { value: 'week', label: 'על השבוע הזה', sub: 'מהיום הזה עד סוף השבוע' },
      { value: 'future', label: 'שינוי התבנית מהיום הזה והלאה', sub: 'ימים שעברו נשארים כפי שהיו' },
    ]);
  }
  if (o.kind === 'series') {
    const v = await choose('על מה להחיל את השינוי?', [
      { value: 'this', label: 'רק על המופע הזה' }, { value: 'week', label: 'על השבוע הזה' },
      { value: 'future', label: 'מהמופע הזה והלאה' }, { value: 'all', label: 'כל המופעים', sub: 'כולל עבר; רישומי ביצוע נשמרים' },
    ]);
    if (v === 'all' && !(await confirmDialog('לשנות את כל המופעים של הסדרה, כולל מופעים קודמים? רישומי הביצוע נשמרים.', { ok: 'כל המופעים' }))) return null;
    return v;
  }
  return 'this';
}

/** Add a block, or view/edit an occurrence (routine, recurring, one-off or meeting projection). */
export function openBlockEditor(occId = null, { date = nowCtx().date, start = null } = {}) {
  const state = S();
  const o = occId ? findOccurrence(state, occId) : null;
  if (o && o.kind === 'meeting') { location.hash = `#/meeting/${o.sourceId}`; return; }
  const isNew = !o;
  const s0 = start ?? 10 * 60;
  const title = input('text', o?.title || '', { maxlength: 300, required: true, autofocus: isNew });
  const d = input('date', o?.date || date);
  const st = input('time', o?.start || fromMin(s0));
  const en = input('time', o?.end || fromMin(Math.min(s0 + 60, 23 * 60 + 59)));
  const cat = select(catOptions(state), o?.categoryId || 'admin');
  const notes = textarea(o?.notes || '', { maxlength: 5000 });
  const pinned = check('נעוץ – המתכנן לא יזיז', o?.pinned);
  const rec = isNew ? recurrenceFields(null, date) : null;
  const err = formError();
  const body = [];
  if (o) {
    const statusSeg = seg(['planned', 'done', 'partial', 'skipped', 'canceled'].map((v) => ({ value: v, label: BLOCK_STATUS_LABEL[v] })), o.status, null, 'סטטוס הבלוק');
    const actual = input('number', o.actualMinutes ?? '', { min: 0, max: 1440, inputmode: 'numeric', placeholder: 'לא ידוע' });
    const tasks = o.taskIds.map((id) => state.tasks.find((t) => t.id === id)).filter(Boolean);
    body.push(h('div.card.flat.stack',
      h('div.row.wrap', h('b', ltr(`${o.start}–${o.end}`)), h('span.muted', dur(o.e - o.s)), o.kind === 'routine' ? h('span.chip', 'תבנית') : o.kind === 'series' ? h('span.chip', 'חוזר') : null, o.protected ? h('span.chip.duty', 'מוגן') : null),
      field('סטטוס', statusSeg), field('דקות בפועל (לא חובה)', actual, 'ריק = לא ידוע (לא נספר כאפס)'),
      btn('עדכון סטטוס', () => run('setBlockStatus', { occId: o.id, status: statusSeg.value, actualMinutes: actual.value === '' ? null : Number(actual.value) }, { success: 'הסטטוס עודכן' }).then((r) => r && sh.close(true)), 'soft small'),
      h('p.muted.small', 'סימון בלוק אינו מסמן את המשימות שבו.')));
    if (o.instructions?.length && state.settings.showGuidance) body.push(h('ul.guidance', o.instructions.map((x) => h('li', x))));
    body.push(h('h3', `משימות בבלוק (${tasks.length})`), tasks.length ? h('ul', tasks.map((t) => h('li', t.title, t.status === 'done' ? ' ✓' : ''))) : h('p.muted.small', 'אין משימות משויכות'),
      btn('שיוך משימה לבלוק', () => assignTaskSheet(o), 'small soft', 'plus'));
    body.push(h('div.divider'), h('h3', 'עריכה'));
  }
  body.push(field('כותרת', title), field('תאריך', d), h('div.grid2', field('התחלה', st), field('סיום', en)), field('קטגוריה', cat), field('הערות', notes), pinned);
  if (rec) body.push(h('div.card.flat', rec));
  body.push(err);
  if (o) body.push(h('div.row.wrap',
    btn('שכפול', () => run('duplicateOccurrence', { occId: o.id }, { success: 'הבלוק שוכפל' }).then((r) => r && sh.close(true)), 'small ghost', 'dup'),
    btn('פיצול', async () => {
      const at = await promptText('פיצול בשעה', { type: 'time', value: fromMin(Math.round((o.s + o.e) / 2 / 15) * 15) });
      if (at) { const r = await run('splitOccurrence', { occId: o.id, at }, { success: 'הבלוק פוצל; המשימות נשארו בחלק הראשון' }); if (r) sh.close(true); }
    }, 'small ghost', 'scissors'),
    btn('מיזוג עם הבא', () => run('mergeWithNext', { occId: o.id }, { success: 'הבלוקים מוזגו' }).then((r) => r && sh.close(true)), 'small ghost', 'merge'),
    btn('מחיקה', async () => {
      const scope = o.kind === 'block' ? 'this' : await choose('מה למחוק?', [
        { value: 'this', label: 'רק את המופע הזה' },
        { value: 'future', label: o.kind === 'routine' ? 'להסיר מהתבנית מהיום הזה והלאה' : 'מהמופע הזה והלאה' },
        o.kind === 'series' ? { value: 'all', label: 'את כל הסדרה', danger: true } : null,
      ]);
      if (!scope) return;
      if (!(await confirmDialog(`למחוק את ״${o.title}״${scope === 'this' ? ' ביום הזה' : ''}? משימות משויכות לא יימחקו – רק השיוך יוסר.`, { danger: true, ok: 'מחיקה' }))) return;
      if (await run('deleteOccurrence', { occId: o.id, scope }, { success: 'נמחק' })) sh.close(true);
    }, 'small ghost', 'trash')));

  const save = async () => {
    if (!title.value.trim()) { err.textContent = 'יש להזין כותרת'; return; }
    if (!isValidTime(st.value) || !isValidTime(en.value) || toMin(en.value) <= toMin(st.value)) { err.textContent = 'שעת הסיום חייבת להיות אחרי שעת ההתחלה'; return; }
    if (isNew) {
      const r = rec.read();
      const res = await run('addBlock', { date: d.value, start: st.value, end: en.value, title: title.value, categoryId: cat.value, notes: notes.value, pinned: pinned.querySelector('input').checked, recurrence: r ? { ...r, startDate: d.value } : null }, { success: 'הפעילות נוספה' });
      if (res) sh.close(true);
      return;
    }
    const changes = {};
    if (title.value !== o.title) changes.title = title.value;
    if (st.value !== o.start) changes.start = st.value;
    if (en.value !== o.end) changes.end = en.value;
    if (cat.value !== o.categoryId) changes.categoryId = cat.value;
    if (notes.value !== (o.notes || '')) changes.notes = notes.value;
    if (pinned.querySelector('input').checked !== !!o.pinned) changes.pinned = pinned.querySelector('input').checked;
    if (d.value !== o.date) changes.date = d.value;
    if (!Object.keys(changes).length) { sh.close(true); return; }
    const scope = changes.date ? 'this' : await askScope(o);
    if (!scope) return;
    if (await run('updateOccurrence', { occId: o.id, changes, scope }, { success: 'הפעילות עודכנה' })) sh.close(true);
  };
  const sh = openSheet({ title: isNew ? 'הוספת פעילות' : o.title, body, footer: [btn(isNew ? 'הוספה' : 'שמירת שינויים', save, 'primary')] });
}

function assignTaskSheet(o) {
  const state = S();
  const candidates = state.tasks.filter((t) => ['todo', 'inProgress'].includes(t.status) && t.assignedBlock !== o.id);
  const sh = openSheet({
    title: `שיוך משימה ל״${o.title}״`,
    body: candidates.length ? h('div.choice-list', candidates.slice(0, 60).map((t) => h('button.choice', { type: 'button', onclick: async () => { if (await run('assignTaskToBlock', { taskId: t.id, occId: o.id }, { success: 'המשימה שויכה' })) sh.close(true); } }, h('span', h('b', t.title), h('small', t.scheduledDate ? fmtDM(t.scheduledDate) : 'ללא תאריך'))))) : empty('אין משימות פתוחות לשיוך'),
    footer: [btn('משימה חדשה בבלוק', () => { sh.close(true); openTaskEditor(null, { date: o.date, defaults: { scheduledDate: o.date }, onSaved: (id) => run('assignTaskToBlock', { taskId: id, occId: o.id }) }); }, 'soft', 'plus')],
  });
}

// ---------------- questions ----------------
export function openQuestionEditor(q = null, { defaults = {} } = {}) {
  const state = S();
  const isNew = !q;
  const src = q || defaults;
  const title = input('text', src.title || '', { maxlength: 300, autofocus: true, required: true });
  const audience = seg([{ value: 'team', label: 'מהצוות / לצוות' }, { value: 'manager', label: 'למנהל' }], src.audience || 'team', null, 'קהל');
  const kind = seg([{ value: 'question', label: QUESTION_KIND_LABEL.question }, { value: 'topic', label: QUESTION_KIND_LABEL.topic }], src.kind || 'question', null, 'סוג');
  const priority = select(prioOptions(), src.priority || 'medium');
  const detail = textarea(src.detail || '', { maxlength: 5000, placeholder: 'פרטים כלליים בלבד' });
  const follow = input('date', src.followUpOn || '');
  const meetings = upcomingMeetings(state, nowCtx().date);
  const meeting = isNew ? select([{ value: '', label: 'ללא – לתור הנושאים הבא' }, ...meetings.map((m) => ({ value: m.id, label: `${m.title}${m.date ? ' · ' + fmtDM(m.date) : ''}` }))], defaults.meetingId || '') : null;
  const recurring = check('שאלה שחוזרת על עצמה', src.recurring);
  const err = formError();
  const body = [field('השאלה / הנושא', title), field('עבור', audience), field('סוג', kind),
    h('details.more', h('summary', 'פרטים נוספים'), h('div.stack', field('עדיפות', priority), field('פרטים', detail), field('מועד מעקב', follow), meeting ? field('לפגישה', meeting) : null, recurring)), err];
  if (q) {
    const box = h('div');
    live(box, () => { const fresh = S().questions.find((x) => x.id === q.id); return fresh ? questionPanel(fresh) : h('p.muted', 'השאלה הוסרה'); });
    body.unshift(box);
  }
  const save = async () => {
    if (!title.value.trim()) { err.textContent = 'יש להזין שאלה'; return; }
    const p = { title: title.value, audience: audience.value, kind: kind.value, priority: priority.value, detail: detail.value, followUpOn: follow.value || null, recurring: recurring.querySelector('input').checked };
    const r = isNew ? await run('addQuestion', { ...p, meetingId: meeting.value || null }, { success: 'השאלה נוספה' }) : await run('updateQuestion', { id: q.id, patch: p }, { success: 'השאלה עודכנה' });
    if (r) sh.close(true);
  };
  title.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
  const sh = openSheet({ title: isNew ? 'הוספת שאלה' : 'שאלה', body, footer: [btn(isNew ? 'הוספה' : 'שמירה', save, 'primary')] });
}

function questionPanel(q) {
  const state = S();
  const linked = state.meetings.filter((m) => (m.agenda || []).includes(q.id));
  return h('div.stack',
    h('div.row.wrap', h('span.chip', QUESTION_STATUS_LABEL[q.status]), h('span.chip', AUDIENCE_LABEL[q.audience]), q.faqId ? h('span.chip.ok', 'בתשובות הנפוצות') : null),
    q.answer ? h('div.card.flat', h('b', 'תשובה: '), q.answer) : null,
    linked.length ? h('p.small.muted', 'בפגישות: ', linked.map((m) => m.title).join(', ')) : null,
    h('div.row.wrap',
      q.status !== 'answered' ? btn('רישום תשובה', () => answerQuestion(q), 'small primary') : btn('פתיחה מחדש', () => run('setQuestionStatus', { id: q.id, status: 'open' }, { success: 'השאלה נפתחה מחדש' }), 'small soft'),
      q.status === 'open' ? btn('בטיפול', () => run('setQuestionStatus', { id: q.id, status: 'waiting' }, { success: 'סומנה בטיפול' }), 'small ghost') : null,
      btn('שיוך לפגישה', () => assignMeetingSheet(q), 'small ghost', 'users'),
      btn('משימת המשך', () => run('questionToTask', { questionId: q.id, scheduledDate: nowCtx().date }, { success: 'נוצרה משימה (או נמצאה קיימת)' }), 'small ghost', 'squareCheck'),
      q.status === 'answered' && !q.faqId ? btn('לתשובות הנפוצות', () => promoteToFaq(q), 'small ghost', 'book') : null,
      q.status !== 'archived' ? btn('לארכיון', () => run('setQuestionStatus', { id: q.id, status: 'archived' }, { success: 'הועברה לארכיון' }), 'small ghost', 'archive') : null),
    h('div.divider'));
}

export async function answerQuestion(q) {
  const ans = textarea(q.answer || '', { maxlength: 5000, autofocus: true });
  const rec = check('שאלה שחוזרת – כדאי להעביר לתשובות נפוצות', q.recurring);
  const sh = openSheet({
    title: 'רישום תשובה', body: [h('p', h('b', q.title)), field('התשובה', ans), rec],
    footer: [btn('שמירה', async () => {
      const r = await run('setQuestionStatus', { id: q.id, status: 'answered', answer: ans.value, recurring: rec.querySelector('input').checked }, { success: 'התשובה נרשמה' });
      if (r) { sh.close(true); if (rec.querySelector('input').checked && !q.faqId && ans.value.trim()) { const fresh = S().questions.find((x) => x.id === q.id); promoteToFaq(fresh); } }
    }, 'primary')],
  });
}

export async function promoteToFaq(q) {
  const title = input('text', q.title, { maxlength: 300 });
  const ans = textarea(q.answer || '', { maxlength: 5000 });
  const kw = input('text', '', { placeholder: 'מילות מפתח מופרדות בפסיק' });
  const sh = openSheet({
    title: 'העברה לתשובות הנפוצות',
    body: [h('p.muted.small', 'רק נוסח מאושר וכללי, בלי פרטים מזהים.'), field('כותרת', title), field('תשובה', ans), field('מילות מפתח', kw)],
    footer: [btn('ביטול', () => sh.close(), 'ghost'), btn('אישור והעברה', async () => {
      if (await run('questionToFaq', { questionId: q.id, title: title.value, answer: ans.value, keywords: kw.value.split(',').map((x) => x.trim()) }, { success: 'נוספה לתשובות הנפוצות' })) sh.close(true);
    }, 'primary')],
  });
}

function assignMeetingSheet(q) {
  const state = S();
  const ms = upcomingMeetings(state, nowCtx().date);
  const sh = openSheet({
    title: 'שיוך לפגישה',
    body: ms.length ? h('div.choice-list', ms.map((m) => {
      const on = (m.agenda || []).includes(q.id);
      return h('button.choice', { type: 'button', onclick: async () => { if (await run('linkQuestion', { meetingId: m.id, questionId: q.id, unlink: on }, { success: on ? 'השיוך הוסר' : 'שויכה לפגישה' })) sh.close(true); } },
        ic(on ? 'checkCircle' : 'users'), h('span', h('b', m.title), h('small', m.date ? fmtDM(m.date) : 'ללא מועד', on ? ' · משויכת – לחיצה להסרה' : '')));
    })) : empty('אין פגישות קרובות. השאלה תישאר בתור הנושאים.'),
    footer: [btn('פגישה חדשה', () => { sh.close(true); openMeetingEditor(null, { agenda: [q.id] }); }, 'soft', 'plus')],
  });
}

// ---------------- meetings ----------------
export function openMeetingEditor(m = null, { agenda = [], date = null } = {}) {
  const isNew = !m;
  const title = input('text', m?.title || '', { maxlength: 300, autofocus: true });
  const type = select(Object.entries(MEETING_TYPE_LABEL).map(([value, label]) => ({ value, label })), m?.meetingType || 'team');
  const d = input('date', m?.date || date || '');
  const st = input('time', m?.start || '');
  const en = input('time', m?.end || '');
  const durM = input('number', m?.durationMinutes ?? '', { min: 1, max: 720, placeholder: 'דקות' });
  const loc = input('text', m?.location || '', { maxlength: 200 });
  const notes = textarea(m?.notes || '', { maxlength: 5000 });
  const err = formError();
  const sh = openSheet({
    title: isNew ? 'פגישה חדשה' : 'עריכת פגישה',
    body: [field('כותרת', title), field('סוג', type), field('תאריך', d, 'אפשר להשאיר ריק אם המועד לא ידוע'), h('div.grid2', field('התחלה', st), field('סיום', en)), field('או משך בדקות', durM),
      field('מיקום / הערה', loc), field('הערות', notes), err],
    footer: [btn(isNew ? 'יצירה' : 'שמירה', async () => {
      if (!title.value.trim()) { err.textContent = 'יש להזין כותרת'; return; }
      if (st.value && !d.value) { err.textContent = 'לשעה נדרש תאריך'; return; }
      if (st.value && en.value && toMin(en.value) <= toMin(st.value)) { err.textContent = 'שעת הסיום חייבת להיות אחרי ההתחלה'; return; }
      const p = { title: title.value, meetingType: type.value, date: d.value || null, start: st.value || null, end: en.value || null, durationMinutes: durM.value ? Number(durM.value) : null, location: loc.value, notes: notes.value };
      const r = isNew ? await run('addMeeting', { ...p, agenda }, { success: 'הפגישה נוצרה' }) : await run('updateMeeting', { id: m.id, patch: p }, { success: 'הפגישה עודכנה' });
      if (r) { sh.close(true); if (isNew) location.hash = `#/meeting/${r}`; }
    }, 'primary')],
  });
}

export function openDecisionEditor(meetingId, { questionId = null } = {}) {
  const state = S();
  const m = state.meetings.find((x) => x.id === meetingId);
  const text = textarea('', { maxlength: 5000, autofocus: true });
  const owner = input('text', '', { maxlength: 80, placeholder: 'תפקיד כללי, לא חובה' });
  const qSel = select([{ value: '', label: '— ללא —' }, ...meetingAgenda(state, m).map((q) => ({ value: q.id, label: q.title }))], questionId || '');
  const mkTask = check('ליצור משימת המשך', false);
  const deadline = input('date', '');
  const sh = openSheet({
    title: 'רישום החלטה', body: [field('ההחלטה', text), field('בעניין', qSel), field('אחראי (לא חובה)', owner), mkTask, field('מועד יעד למשימה', deadline)],
    footer: [btn('שמירה', async () => {
      if (!text.value.trim()) return;
      const r = await run('addDecision', { meetingId, questionId: qSel.value || null, text: text.value, owner: owner.value, createTask: mkTask.querySelector('input').checked ? { deadline: deadline.value || null } : null }, { success: 'ההחלטה נרשמה' });
      if (r) sh.close(true);
    }, 'primary')],
  });
}

// ---------------- issues / notes / FAQ ----------------
export function openIssueEditor(issue = null) {
  const state = S();
  const isNew = !issue;
  const title = input('text', issue?.title || '', { maxlength: 300, autofocus: true, placeholder: 'תיאור כללי של התקלה' });
  const cat = select(catOptions(state, true), issue?.categoryId || '');
  const status = select(Object.entries(ISSUE_STATUS_LABEL).map(([value, label]) => ({ value, label })), issue?.status || 'open');
  const to = select([{ value: '', label: '— לא דווח —' }, ...Object.entries(REPORTED_TO_LABEL).map(([value, label]) => ({ value, label }))], issue?.reportedTo || '');
  const follow = input('date', issue?.followUpOn || '');
  const resolution = textarea(issue?.resolution || '', { maxlength: 5000 });
  const note = input('text', '', { maxlength: 500, placeholder: 'הערה קצרה להופעה (לא חובה)' });
  const body = [field('תקלה', title), h('div.grid2', field('סטטוס', status), field('דווח ל', to)), field('קטגוריה', cat), field('מעקב בתאריך', follow), field('פתרון / מה נעשה', resolution)];
  if (isNew) body.push(field('הערה להופעה הראשונה', note));
  else {
    body.push(h('h3', `הופעות (${issue.occurrences.length})`), h('ul', issue.occurrences.slice().sort((a, b) => b.date.localeCompare(a.date)).map((o) => h('li', ltr(fmtDM(o.date)), o.note ? ` – ${o.note}` : ''))),
      h('div.row.wrap', btn('הופעה נוספת היום', () => run('addIssueOccurrence', { id: issue.id }, { success: 'נרשמה הופעה נוספת' }).then((r) => r && sh.close(true)), 'small soft', 'plus'),
        btn('משימת מעקב', () => run('issueToTask', { id: issue.id }, { success: 'נוצרה משימת מעקב (או נמצאה קיימת)' }), 'small ghost', 'squareCheck')));
  }
  body.push(h('p.muted.small', 'הרישום מקומי בלבד – לא נפתחת פנייה במערכת חיצונית.'));
  const sh = openSheet({
    title: isNew ? 'תקלה חדשה' : 'תקלה', body,
    footer: [btn('שמירה', async () => {
      if (!title.value.trim()) return;
      const r = isNew
        ? await run('addIssue', { title: title.value, categoryId: cat.value || null, reportedTo: to.value || null, followUpOn: follow.value || null, note: note.value }, { success: 'התקלה נרשמה' })
        : await run('updateIssue', { id: issue.id, patch: { title: title.value, categoryId: cat.value || null, status: status.value, reportedTo: to.value || null, followUpOn: follow.value || null, resolution: resolution.value } }, { success: 'התקלה עודכנה' });
      if (r) sh.close(true);
    }, 'primary')],
  });
}

export function openNoteEditor(note = null) {
  const state = S();
  const title = input('text', note?.title || '', { maxlength: 300, placeholder: 'כותרת (לא חובה)' });
  const body = textarea(note?.body || '', { rows: 8, maxlength: 20000, autofocus: true });
  const cat = select(catOptions(state, true), note?.categoryId || '');
  const sh = openSheet({
    title: note ? 'רשומה' : 'רשומה חדשה',
    body: [field('כותרת', title), field('תוכן', body, 'טקסט פשוט בלבד; בלי מידע מזהה או סודי'), field('קטגוריה', cat),
      note ? h('div.row.wrap', btn(note.pinned ? 'ביטול נעיצה' : 'נעיצה', () => run('saveNote', { id: note.id, pinned: !note.pinned }).then(() => sh.close(true)), 'small ghost', 'pin'),
        btn('המרה למשימה', () => run('noteToTask', { id: note.id }, { success: 'נוצרה משימה (או נמצאה קיימת)' }), 'small ghost', 'squareCheck'),
        btn(note.archived ? 'שחזור מהארכיון' : 'לארכיון', () => run('saveNote', { id: note.id, archived: !note.archived }, { success: 'עודכן' }).then(() => sh.close(true)), 'small ghost', 'archive')) : null],
    footer: [btn('שמירה', async () => {
      if (!title.value.trim() && !body.value.trim()) return;
      if (await run('saveNote', { id: note?.id, title: title.value, body: body.value, categoryId: cat.value || null }, { success: 'הרשומה נשמרה' })) sh.close(true);
    }, 'primary')],
  });
}

export function openFaqEditor(f = null) {
  const title = input('text', f?.title || '', { maxlength: 300, autofocus: true });
  const ans = textarea(f?.answer || '', { rows: 6, maxlength: 5000 });
  const kw = input('text', (f?.keywords || []).join(', '), { placeholder: 'מופרדות בפסיק' });
  const sh = openSheet({
    title: f ? 'תשובה נפוצה' : 'תשובה נפוצה חדשה',
    body: [field('כותרת / שאלה', title), field('נוסח התשובה המאושר', ans), field('מילות מפתח', kw), h('p.muted.small', 'רק תוכן מאושר ולא רגיש.'),
      f ? h('div.row.wrap', btn('העתקת התשובה', async () => { const { copyText } = await import('./export/share.js'); copyText(f.answer); }, 'small ghost', 'copy'),
        btn(f.archived ? 'שחזור' : 'לארכיון', () => run('saveFaq', { id: f.id, archived: !f.archived }, { success: 'עודכן' }).then(() => sh.close(true)), 'small ghost', 'archive')) : null],
    footer: [btn('שמירה', async () => {
      if (!title.value.trim()) return;
      if (await run('saveFaq', { id: f?.id, title: title.value, answer: ans.value, keywords: kw.value.split(',').map((x) => x.trim()).filter(Boolean) }, { success: 'נשמר' })) sh.close(true);
    }, 'primary')],
  });
}

/** Quick add chooser (header/FAB). */
export async function quickAdd(date = nowCtx().date) {
  const v = await choose('הוספה מהירה', [
    { value: 'task', label: 'משימה', icon: 'squareCheck' },
    { value: 'question', label: 'שאלה לצוות / למנהל', icon: 'question' },
    { value: 'block', label: 'פעילות ביומן', icon: 'calendar' },
    { value: 'meeting', label: 'פגישה', icon: 'users' },
    { value: 'issue', label: 'תקלה', icon: 'alert' },
    { value: 'note', label: 'רשומה במחברת', icon: 'note' },
  ]);
  if (v === 'task') openTaskEditor(null, { date });
  if (v === 'question') openQuestionEditor();
  if (v === 'block') openBlockEditor(null, { date });
  if (v === 'meeting') openMeetingEditor(null, { date });
  if (v === 'issue') openIssueEditor();
  if (v === 'note') openNoteEditor();
}

export { parseOccId, dayOccurrences, addDays };
