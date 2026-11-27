// משימות - two primary views (today, completed) and a compact menu with more filters, over
// the same canonical task records used by Home. Search covers title and note.
import { h, btn, iconBtn, seg, section, input, select, choose } from '../ui.js';
import { S } from '../app.js';
import { addDays } from '../dates.js';
import { carriedTasks, todaysTasks, weekTasks, completedTasks, upcomingTasks, waitingTasks, deferredTasks, backlogTasks, canceledTasks, sortByPriority } from '../engine/taskCarryover.js';
import { taskMatches } from '../engine/search.js';
import { taskList } from './common.js';
import { openTaskEditor } from '../editors.js';
import { loadUi, saveUi } from '../uiPrefs.js';

const MAIN = [{ value: 'today', label: 'היום' }, { value: 'done', label: 'הושלמו' }];
const MORE = [
  ['week', 'כל המשימות של השבוע'], ['tomorrow', 'משימות למחר'], ['unfinished', 'לא הסתיימו'], ['upcoming', 'עתידיות'],
  ['waiting', 'ממתינות לתשובה'], ['deferred', 'נדחו'], ['canceled', 'בוטלו'],
];
const FILTERS = new Set([...MAIN.map((m) => m.value), ...MORE.map((m) => m[0])]);
// The search text is kept in memory for this session only: it may contain work details
// and must not be copied outside the app's own data store.
let searchText = '';

const SORTS = [{ value: 'high', label: 'עדיפות: מהגבוהה לנמוכה' }, { value: 'low', label: 'עדיפות: מהנמוכה לגבוהה' }];

export function render(main, args, ctx) {
  const state = S();
  const date = ctx.date;
  const filter = FILTERS.has(args[0]) ? args[0] : 'today';
  const search = input('search', searchText, { placeholder: 'חיפוש', 'aria-label': 'חיפוש במשימות', enterkeyhint: 'search' });
  const sort = select(SORTS, loadUi('taskSort', 'high'), { 'aria-label': 'מיון לפי עדיפות' });
  const content = h('div.stack.tasks-content');
  const draw = () => {
    const q = search.value;
    const prep = (list) => sortByPriority(list.filter((x) => taskMatches(x.task || x, q)), sort.value);
    const list = (items, emptyText) => taskList(prep(items), { date, emptyText });
    let parts;
    switch (filter) {
      case 'today':
        parts = [
          section('משימות שלא הסתיימו עד היום', { attrs: { 'data-section': 'carried' } }, list(carriedTasks(state, date), 'הכול הושלם')),
          section('משימות להיום', { attrs: { 'data-section': 'today' } }, list(todaysTasks(state, date).filter((t) => t.status !== 'done'), 'אין משימות להיום')),
        ];
        break;
      case 'done': parts = [h('div', { dataset: { section: 'done' } }, taskList(completedTasks(state).filter((t) => taskMatches(t, q)).slice(0, 300), { date, emptyText: 'עדיין אין' }))]; break;
      case 'week': parts = [list(weekTasks(state, date), 'אין משימות השבוע')]; break;
      case 'tomorrow': parts = [list(todaysTasks(state, addDays(date, 1)).filter((t) => t.status !== 'done'), 'אין משימות למחר')]; break;
      case 'unfinished': parts = [list(carriedTasks(state, date), 'אין')]; break;
      case 'upcoming': parts = [list([...upcomingTasks(state, date), ...backlogTasks(state)], 'אין')]; break;
      case 'waiting': parts = [list(waitingTasks(state, date).map((w) => w.task), 'אין')]; break;
      case 'deferred': parts = [list(deferredTasks(state), 'אין')]; break;
      case 'canceled': parts = [list(canceledTasks(state), 'אין')]; break;
      default: parts = [];
    }
    content.replaceChildren(...parts.filter(Boolean));
  };
  search.addEventListener('input', () => { searchText = search.value; draw(); });
  sort.addEventListener('change', () => { saveUi('taskSort', sort.value); draw(); });
  draw();
  const more = iconBtn('more', 'מסננים נוספים', async () => {
    const v = await choose('הצגה', MORE.map(([value, label]) => ({ value, label: filter === value ? `${label} ✓` : label })));
    if (v) location.hash = `#/tasks/${v}`;
  }, 'tabs-more');
  const extraTitle = MORE.find((m) => m[0] === filter)?.[1];
  main.replaceChildren(h('div.page',
    h('div.tabs-row', seg(MAIN, MAIN.some((m) => m.value === filter) ? filter : null, (v) => { location.hash = `#/tasks/${v}`; }, 'תצוגת משימות'), more),
    extraTitle ? h('h2.filter-title', extraTitle) : null,
    h('div.task-tools', search, sort),
    content,
    btn('הוספת משימה', () => openTaskEditor(null, { date: filter === 'tomorrow' ? addDays(date, 1) : date }), 'soft block', 'plus')));
}
