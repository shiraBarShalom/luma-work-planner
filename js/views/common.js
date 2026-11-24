// Shared view components.
import { h, ic, ltr, iconBtn, choose, promptText, empty, toast, confirmDialog } from '../ui.js';
import { S, run, nowCtx } from '../app.js';
import { fmtDM, addDays, relDay, isValidDate } from '../dates.js';
import { PRIORITY_LABEL, TASK_STATUS_LABEL } from '../data/schema.js';
import { nextWorkday } from '../engine/dayTemplates.js';
import { firstFreeSlot } from '../engine/planner.js';

export function category(state, id) {
  return state.settings.categories.find((c) => c.id === id) || { id, label: 'כללי', color: '#526273' };
}
export function catChip(state, id) {
  const c = category(state, id);
  return h('span.chip.dot', { style: { '--c': c.color } }, c.label);
}

/** Date picker sheet → ISO date or null. */
export async function pickDate(title, value) {
  const v = await promptText(title, { type: 'date', value: value || nowCtx().date, ok: 'בחירה' });
  return v && isValidDate(v) ? v : null;
}

/** Reschedule / status menu for a task (real id or virtual recurring key). */
export async function taskMenu(t, date = nowCtx().date) {
  const state = S();
  const next = nextWorkday(state, date);
  const v = await choose(t.title, [
    { value: 'today', label: 'לבצע היום', icon: 'calendar', sub: fmtDM(date) },
    next && { value: 'next', label: 'ליום העבודה הבא', icon: 'right', sub: fmtDM(next) },
    { value: 'date', label: 'לתאריך אחר…', icon: 'calendar' },
    !t.virtual && { value: 'slot', label: 'לשבץ בחלון הפנוי הראשון', icon: 'wand', sub: 'הצעה לפי התבנית והזמן הפנוי' },
    { value: 'defer', label: 'לדחות עד…', icon: 'hourglass', sub: 'לא תופיע עד תאריך החזרה' },
    { value: 'waiting', label: 'ממתינה לתשובה / מעקב', icon: 'clock' },
    t.status !== 'inProgress' && { value: 'progress', label: 'בתהליך', icon: 'dot' },
    { value: 'cancel', label: 'ביטול המשימה', icon: 'x', danger: true },
  ]);
  if (!v) return;
  const id = t.id;
  if (v === 'today') return run('rescheduleTask', { id, date }, { success: 'תוזמנה להיום' });
  if (v === 'next') return run('rescheduleTask', { id, date: next }, { success: `הועברה ל־${fmtDM(next)}` });
  if (v === 'date') { const d = await pickDate('תאריך ביצוע', t.scheduledDate); if (d) return run('rescheduleTask', { id, date: d }, { success: `תוזמנה ל־${fmtDM(d)}` }); return; }
  if (v === 'defer') { const d = await pickDate('לדחות עד', addDays(date, 1)); if (d) return run('setTaskStatus', { id, status: 'deferred', resumeOn: d }, { success: `נדחתה עד ${fmtDM(d)}` }); return; }
  if (v === 'waiting') {
    const note = await promptText('ממתינה ל…', { label: 'למה ממתינה (כללי, בלי פרטים מזהים)', required: false, ok: 'המשך' });
    if (note === null) return;
    const f = await promptText('מועד מעקב (לא חובה)', { type: 'date', value: '', required: false, ok: 'שמירה' });
    if (f === null) return;
    return run('setTaskStatus', { id, status: 'waiting', waitingNote: note, followUpOn: f || null }, { success: 'הועברה לממתינים' });
  }
  if (v === 'progress') return run('setTaskStatus', { id, status: 'inProgress' }, { success: 'סומנה בתהליך' });
  if (v === 'cancel') return run('setTaskStatus', { id, status: 'canceled' }, { success: 'המשימה בוטלה' });
  if (v === 'slot') {
    const n = nowCtx();
    const res = firstFreeSlot(S(), id, n);
    if (!res.assignment) { toast(res.reason || 'לא נמצא חלון מתאים', { error: true }); return; }
    const a = res.assignment;
    const ok = await confirmDialog(`לשבץ ב״${a.blockTitle}״ ${relDay(a.date, n.date)} (${fmtDM(a.date)})?\n${a.reason}${a.assumed ? `\nהערכת זמן משוערת: ${a.estimate} דק׳ (לא הוזנה הערכה)` : ''}`, { title: 'הצעת שיבוץ', ok: 'לשבץ' });
    if (ok) return run('applyPlannerAssignments', { assignments: [a] }, { success: 'המשימה שובצה' });
  }
}

/**
 * One canonical task row. `info` carries carryover provenance when shown in the carried list.
 */
export function taskRow(t, { date = nowCtx().date, info = null, onOpen = null, showDue = true } = {}) {
  const state = S();
  const done = t.status === 'done';
  const meta = [];
  if (info) {
    meta.push(h('span', 'תוכננה ל־', ltr(fmtDM(info.originalDate))));
    meta.push(h('span', info.ageDays === 1 ? 'מאתמול' : `לפני ${info.ageDays} ימים`));
  } else if (showDue && t.scheduledDate && t.scheduledDate !== date) meta.push(h('span', relDay(t.scheduledDate, date)));
  if (t.deadline) meta.push(h('span' + (t.deadline < date && !done ? '.chip.danger' : ''), 'יעד ', ltr(fmtDM(t.deadline))));
  if (t.status !== 'todo' && t.status !== 'done') meta.push(h('span.chip', TASK_STATUS_LABEL[t.status]));
  if (t.subtasks?.length) meta.push(h('span', ltr(`${t.subtasks.filter((s) => s.done).length}/${t.subtasks.length}`), ' תתי־משימות'));
  if (t.recurringRuleId) meta.push(h('span.row', ic('repeat', 14), 'חוזרת'));
  if (t.estimateMinutes) meta.push(h('span', ltr(`${t.estimateMinutes}`), ' דק׳'));
  if (t.categoryId) meta.push(catChip(state, t.categoryId));
  const open = onOpen || (async () => (await import('../editors.js')).openTaskEditor(t.virtual ? t : state.tasks.find((x) => x.id === t.id) || t, { date }));
  return h('div.item' + (done ? '.done' : ''), { dataset: { taskId: t.id } },
    h('button.cb', {
      type: 'button', 'aria-pressed': String(done), 'aria-label': done ? `סימון ״${t.title}״ כלא הושלמה` : `סימון ״${t.title}״ כהושלמה`,
      onclick: () => run('toggleTaskDone', { id: t.id }, { success: done ? 'סומנה כפתוחה' : 'כל הכבוד – הושלמה' }),
    }, h('span.box', { svg: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>' })),
    h('span.prio.' + (t.priority || 'medium'), { title: `עדיפות ${PRIORITY_LABEL[t.priority] || ''}` }),
    h('div.body', h('button.link', { type: 'button', onclick: open }, h('div.title', t.title), meta.length ? h('div.meta', meta) : null)),
    done ? null : iconBtn('more', `אפשרויות עבור ${t.title}`, () => taskMenu(t, date)));
}

export function taskList(items, opts = {}) {
  if (!items.length) return empty(opts.emptyText || 'אין משימות', opts.emptyIcon);
  return h('div.list', items.map((x) => (x.task ? taskRow(x.task, { ...opts, info: x }) : taskRow(x, opts))));
}

export function dateNav(date, hrefFor, label) {
  const prev = addDays(date, -1), next = addDays(date, 1);
  const picker = h('input.input', { type: 'date', value: date, 'aria-label': 'בחירת תאריך', onchange: (e) => { if (isValidDate(e.target.value)) location.hash = hrefFor(e.target.value); } });
  return h('nav.datenav', { 'aria-label': 'ניווט בין ימים' },
    h('a.icon-btn', { href: hrefFor(prev), 'aria-label': 'היום הקודם', svg: '<svg class="ic" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>' }),
    h('div.grow', label), picker,
    h('a.icon-btn', { href: hrefFor(next), 'aria-label': 'היום הבא', svg: '<svg class="ic" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>' }));
}
