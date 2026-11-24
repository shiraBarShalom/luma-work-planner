// משימות – grouped task views over the same canonical records as Home.
import { h, ic, ltr, btn, iconBtn, seg, section, empty, input, select, openSheet, field, confirmDialog } from '../ui.js';
import { S, run } from '../app.js';
import { PRIORITY_LABEL, CARRYOVER_LABEL } from '../data/schema.js';
import { carriedTasks, todaysTasks, weekTasks, completedTasks, upcomingTasks, waitingTasks, deferredTasks, backlogTasks, canceledTasks } from '../engine/taskCarryover.js';
import { recurrenceLabel } from '../engine/recurrence.js';
import { normalize } from '../engine/search.js';
import { taskList, catChip } from './common.js';
import { openTaskEditor, openRecurringRuleEditor } from '../editors.js';
import { loadUi, saveUi } from '../uiPrefs.js';

const MAIN = [{ value: 'today', label: 'היום' }, { value: 'week', label: 'השבוע' }, { value: 'done', label: 'הושלם' }];
const MORE = [
  ['unfinished', 'לא הסתיימו'], ['upcoming', 'עתידיות'], ['waiting', 'ממתינות לתשובה'], ['deferred', 'נדחו'],
  ['backlog', 'ללא תאריך'], ['canceled', 'בוטלו'], ['recurring', 'חוזרות'], ['templates', 'תבניות'],
];

function filterText(list, q, cat) {
  const n = normalize(q);
  return list.filter((x) => {
    const t = x.task || x;
    return (!n || normalize(`${t.title} ${t.details || ''}`).includes(n)) && (!cat || t.categoryId === cat);
  });
}

function templatesView(state, date) {
  const tpls = state.settings.taskTemplates || [];
  const add = () => {
    const title = input('text', '', { maxlength: 300, autofocus: true });
    const cat = select(state.settings.categories.filter((c) => !c.archived).map((c) => ({ value: c.id, label: c.label })), 'admin');
    const pr = select(['high', 'medium', 'low'].map((p) => ({ value: p, label: PRIORITY_LABEL[p] })), 'medium');
    const est = input('number', '', { min: 1, max: 1440 });
    const subs = input('text', '', { placeholder: 'מופרדות בפסיק' });
    const sh = openSheet({ title: 'תבנית משימה', body: [field('כותרת', title), field('קטגוריה', cat), field('עדיפות', pr), field('הערכת זמן (דק׳)', est), field('תתי־משימות', subs)],
      footer: [btn('שמירה', async () => {
        if (!title.value.trim()) return;
        const next = [...tpls, { title: title.value, categoryId: cat.value, priority: pr.value, estimateMinutes: est.value ? Number(est.value) : null, subtasks: subs.value.split(',').map((x) => x.trim()).filter(Boolean) }];
        if (await run('updateSettings', { patch: { taskTemplates: next } }, { success: 'התבנית נשמרה' })) sh.close(true);
      }, 'primary')] });
  };
  return section('תבניות משימה', { action: btn('תבנית חדשה', add, 'small soft', 'plus') },
    tpls.length ? h('div.list', tpls.map((t) => h('div.item',
      h('div.body', h('div.title', t.title), h('div.meta', catChip(state, t.categoryId), t.estimateMinutes ? h('span', ltr(String(t.estimateMinutes)), ' דק׳') : null, t.subtasks.length ? `${t.subtasks.length} תתי־משימות` : '')),
      btn('יצירה להיום', () => run('addTask', { title: t.title, categoryId: t.categoryId, priority: t.priority, estimateMinutes: t.estimateMinutes, subtasks: t.subtasks, scheduledDate: date }, { success: 'נוצרה משימה מהתבנית' }), 'small soft'),
      iconBtn('trash', `מחיקת התבנית ${t.title}`, async () => { if (await confirmDialog(`למחוק את התבנית ״${t.title}״? משימות שנוצרו ממנה לא יושפעו.`, { danger: true, ok: 'מחיקה' })) run('updateSettings', { patch: { taskTemplates: tpls.filter((x) => x.id !== t.id) } }, { success: 'התבנית נמחקה' }); })))) : empty('אין תבניות. תבנית חוסכת הקלדה למשימות שחוזרות באופן לא קבוע.'));
}

function recurringView(state, date) {
  const rules = state.recurringRules.slice().sort((a, b) => a.archived - b.archived || a.title.localeCompare(b.title, 'he'));
  return section('משימות חוזרות', { count: rules.filter((r) => !r.archived).length, action: btn('חדשה', () => openTaskEditor(null, { date }), 'small soft', 'plus') },
    rules.length ? h('div.list', rules.map((r) => h('button.item', { type: 'button', onclick: () => openRecurringRuleEditor(r, date), style: { width: '100%', border: '0', background: 'none', textAlign: 'start', cursor: 'pointer', opacity: r.archived ? '0.6' : '1' } },
      ic('repeat', 20), h('div.body', h('div.title', r.title), h('div.meta', recurrenceLabel(r.recurrence), ' · ', CARRYOVER_LABEL[r.routine ? 'none' : r.carryover], r.archived ? ' · הסתיימה' : ''))))) : empty('אין משימות חוזרות. בהוספת משימה אפשר לבחור חזרה תחת ״פרטים נוספים״.'));
}

export function render(main, args, ctx) {
  const state = S();
  const date = ctx.date;
  const filter = [...MAIN.map((m) => m.value), ...MORE.map((m) => m[0])].includes(args[0]) ? args[0] : 'today';
  const q = loadUi('taskSearch', '');
  const cat = loadUi('taskCat', '');
  const search = input('search', q, { placeholder: 'חיפוש במשימות', 'aria-label': 'חיפוש במשימות' });
  const catSel = select([{ value: '', label: 'כל הקטגוריות' }, ...state.settings.categories.filter((c) => !c.archived).map((c) => ({ value: c.id, label: c.label }))], cat, { 'aria-label': 'סינון לפי קטגוריה' });
  const content = h('div.stack');
  const draw = () => {
    const qq = search.value, cc = catSel.value;
    let parts;
    switch (filter) {
      case 'today': {
        const carried = filterText(carriedTasks(state, date), qq, cc);
        const today = filterText(todaysTasks(state, date), qq, cc);
        parts = [
          section('משימות שלא הסתיימו עד היום', { count: carried.length, attrs: { 'data-section': 'carried' } }, taskList(carried, { date, emptyText: 'אין משימות פתוחות מימים קודמים' })),
          section('משימות להיום', { count: today.filter((t) => t.status !== 'done').length, attrs: { 'data-section': 'today' } }, taskList(today, { date, emptyText: 'אין משימות חדשות להיום' })),
        ];
        break;
      }
      case 'week': parts = [section('משימות השבוע', {}, taskList(filterText(weekTasks(state, date), qq, cc), { date, emptyText: 'אין משימות פתוחות השבוע' }))]; break;
      case 'done': parts = [section('הושלמו', {}, taskList(filterText(completedTasks(state), qq, cc).slice(0, 200), { date, emptyText: 'עדיין אין משימות שהושלמו' }))]; break;
      case 'unfinished': parts = [section('משימות שלא הסתיימו עד היום', {}, taskList(filterText(carriedTasks(state, date), qq, cc), { date, emptyText: 'אין' }))]; break;
      case 'upcoming': parts = [section('עתידיות', {}, taskList(filterText(upcomingTasks(state, date), qq, cc), { date, emptyText: 'אין משימות עתידיות' }))]; break;
      case 'waiting': parts = [section('ממתינות לתשובה', {}, taskList(filterText(waitingTasks(state, date).map((w) => w.task), qq, cc), { date, emptyText: 'אין משימות ממתינות' }))]; break;
      case 'deferred': parts = [section('נדחו', {}, taskList(filterText(deferredTasks(state), qq, cc), { date, emptyText: 'אין משימות שנדחו' }))]; break;
      case 'backlog': parts = [section('ללא תאריך', {}, taskList(filterText(backlogTasks(state), qq, cc), { date, emptyText: 'אין משימות ללא תאריך' }))]; break;
      case 'canceled': parts = [section('בוטלו', {}, taskList(filterText(canceledTasks(state), qq, cc), { date, emptyText: 'אין משימות שבוטלו' }))]; break;
      case 'recurring': parts = [recurringView(state, date)]; break;
      case 'templates': parts = [templatesView(state, date)]; break;
      default: parts = [];
    }
    content.replaceChildren(...parts);
  };
  search.addEventListener('input', () => { saveUi('taskSearch', search.value); draw(); });
  catSel.addEventListener('change', () => { saveUi('taskCat', catSel.value); draw(); });
  draw();
  main.replaceChildren(h('div.page',
    seg(MAIN, MAIN.some((m) => m.value === filter) ? filter : null, (v) => { location.hash = `#/tasks/${v}`; }, 'תצוגת משימות'),
    h('div.filters', { role: 'group', 'aria-label': 'סינונים נוספים' }, MORE.map(([v, l]) => h('button', { type: 'button', 'aria-pressed': String(filter === v), onclick: () => { location.hash = `#/tasks/${v}`; } }, l))),
    h('div.grid2', search, catSel),
    content,
    h('button.fab', { type: 'button', 'aria-label': 'הוספת משימה', onclick: () => openTaskEditor(null, { date }), svg: '<svg class="ic" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>' })));
}

