// Shared view components: the canonical task row and its menu, and date navigation.
import { h, ic, ltr, iconBtn, choose, empty, openSheet, btn, field, dateInput, confirmDialog } from '../ui.js';
import { S, run, nowCtx } from '../app.js';
import { fmtDM, addDays, isValidDate } from '../dates.js';
import { PRIORITY_LABEL } from '../data/schema.js';

const CHECK_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
export const checkBox = (pressed, label, onclick) => h('button.cb', { type: 'button', 'aria-pressed': String(!!pressed), 'aria-label': label, onclick }, h('span.box', { svg: CHECK_SVG }));

const STATUS_NOTE = { waiting: 'ממתינה לתשובה', deferred: 'נדחתה', canceled: 'בוטלה' };

/** Date picker sheet → ISO date or null. */
export function pickDate(title, value) {
  return new Promise((resolve) => {
    let res = null;
    const d = dateInput(value || nowCtx().date, { label: title });
    const sh = openSheet({
      title, onClose: () => resolve(res), body: [field('תאריך', d)],
      footer: [btn('בחירה', () => { if (isValidDate(d.value)) { res = d.value; sh.close(true); } }, 'primary')],
    });
  });
}

/** Actions for a task (real id or virtual recurring occurrence). */
export async function taskMenu(t, date = nowCtx().date) {
  const open = t.status === 'todo' || t.status === 'inProgress';
  const tomorrow = addDays(date, 1);
  const v = await choose(t.title, [
    open && t.scheduledDate !== tomorrow && { value: 'tomorrow', label: 'העברה למחר', icon: 'right' },
    open && { value: 'date', label: 'תאריך אחר…', icon: 'calendar' },
    open && { value: 'waiting', label: 'ממתינה לתשובה', icon: 'hourglass' },
    open && { value: 'defer', label: 'דחייה עד…', icon: 'clock' },
    !open && { value: 'today', label: 'החזרה למשימות של היום', icon: 'undo' },
    t.status !== 'canceled' && { value: 'cancel', label: 'ביטול המשימה', icon: 'x', danger: true },
    t.recurringRuleId && { value: 'stop', label: 'הפסקת החזרה', icon: 'repeat', danger: true },
  ]);
  if (!v) return;
  const id = t.id;
  if (v === 'tomorrow') return run('rescheduleTask', { id, date: tomorrow }, { success: 'הועברה למחר' });
  if (v === 'today') return run('rescheduleTask', { id, date }, { success: 'הוחזרה להיום' });
  if (v === 'date') { const d = await pickDate('תאריך ביצוע', t.scheduledDate); if (d) return run('rescheduleTask', { id, date: d }, { success: `הועברה ל-${fmtDM(d)}` }); return; }
  if (v === 'defer') { const d = await pickDate('דחייה עד', tomorrow); if (d) return run('setTaskStatus', { id, status: 'deferred', resumeOn: d }, { success: `נדחתה עד ${fmtDM(d)}` }); return; }
  if (v === 'waiting') return run('setTaskStatus', { id, status: 'waiting' }, { success: 'סומנה כממתינה לתשובה' });
  if (v === 'cancel') return run('setTaskStatus', { id, status: 'canceled' }, { success: 'המשימה בוטלה' });
  if (v === 'stop' && await confirmDialog(`להפסיק את החזרה של ״${t.title}״? הפעמים הקודמות נשמרות.`, { ok: 'הפסקה', danger: true })) {
    return run('archiveRecurringRule', { id: t.recurringRuleId }, { success: 'החזרה הופסקה' });
  }
}

/** One canonical task row. `info` carries carryover provenance when shown as unfinished. */
export function taskRow(t, { date = nowCtx().date, info = null, showDue = true } = {}) {
  const state = S();
  const done = t.status === 'done';
  const meta = [];
  if (info?.originalDate) meta.push(h('span', 'מ-', ltr(fmtDM(info.originalDate))));
  else if (showDue && !done) {
    const due = t.status === 'deferred' ? t.resumeOn : t.scheduledDate;
    if (due && due !== date) meta.push(h('span', ltr(fmtDM(due))));
    else if (!due) meta.push(h('span', 'ללא תאריך'));
  }
  if (done && t.completedOn) meta.push(h('span', ltr(fmtDM(t.completedOn))));
  if (t.deadline && !done) meta.push(h('span' + (t.deadline < date ? '.late' : ''), 'יעד ', ltr(fmtDM(t.deadline))));
  if (STATUS_NOTE[t.status]) meta.push(h('span', STATUS_NOTE[t.status]));
  if (t.recurringRuleId) meta.push(h('span.row', ic('repeat', 14), 'חוזרת'));
  const openEditor = async () => (await import('../editors.js')).openTaskEditor(t.virtual ? t : state.tasks.find((x) => x.id === t.id) || t, { date });
  return h('div.item' + (done ? '.done' : ''), { dataset: { taskId: t.id } },
    checkBox(done, done ? `סימון ״${t.title}״ כלא הושלמה` : `סימון ״${t.title}״ כהושלמה`, () => run('toggleTaskDone', { id: t.id }, { success: done ? 'סומנה כפתוחה' : 'הושלמה' })),
    h('span.prio.' + (t.priority || 'medium'), { title: `עדיפות ${PRIORITY_LABEL[t.priority] || ''}`, 'aria-hidden': 'true' }),
    h('div.body', h('button.link', { type: 'button', onclick: openEditor, 'aria-label': `עריכת ${t.title}` }, h('div.title', t.title), meta.length ? h('div.meta', meta) : null)),
    done ? null : iconBtn('more', `אפשרויות עבור ${t.title}`, () => taskMenu(t, date)));
}

export function taskList(items, opts = {}) {
  if (!items.length) return opts.emptyText ? empty(opts.emptyText, opts.emptyIcon) : null;
  return h('div.list', items.map((x) => (x.task ? taskRow(x.task, { ...opts, info: x }) : taskRow(x, opts))));
}

/** Previous / date (tap to pick) / next. The formatted date is the only date shown. */
export function dateNav(date, hrefFor, { step = 1, label = null, unit = 'day' } = {}) {
  const names = { day: ['היום הקודם', 'היום הבא'], week: ['השבוע הקודם', 'השבוע הבא'] }[unit];
  const picker = dateInput(date, { label: 'בחירת תאריך', short: true, onchange: (v) => { if (isValidDate(v)) location.hash = hrefFor(v); } });
  if (label) picker.querySelector('.date-text').textContent = label;
  picker.classList.add('nav-date');
  return h('nav.datenav', { 'aria-label': unit === 'week' ? 'ניווט בין שבועות' : 'ניווט בין ימים' },
    h('a.icon-btn', { href: hrefFor(addDays(date, -step)), 'aria-label': names[0], svg: '<svg class="ic" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>' }),
    picker,
    h('a.icon-btn', { href: hrefFor(addDays(date, step)), 'aria-label': names[1], svg: '<svg class="ic" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>' }));
}

/** Navigation to today, shown only when another date is displayed. */
export const todayLink = (date, today, href) => (date === today ? null : h('a.btn.small.soft.today-link', { href }, 'היום'));
