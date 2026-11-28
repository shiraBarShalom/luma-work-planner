// היום שלי - a short overview of today: the date, what is happening now and next, the
// inquiry counter and the three important tasks. Nothing else.
import { h, ltr, btn, iconBtn, section, choose, ring } from '../ui.js';
import { S, run } from '../app.js';
import { fmtDayDate, hm, relDay } from '../dates.js';
import { currentAndNext } from '../engine/schedule.js';
import { carriedTasks, todaysTasks, upcomingTasks } from '../engine/taskCarryover.js';
import { countFor, counterTarget } from '../engine/inquiries.js';
import { checkBox } from './common.js';
import { celebrateOnce } from '../celebrate.js';
import { openTaskEditor } from '../editors.js';

function activityCard(state, date, minute) {
  const cn = currentAndNext(state, date, minute);
  const nextLine = cn.next ? h('p.next', 'אחר כך: ', cn.next.title, ' · ', ltr(cn.next.start)) : null;
  let content;
  if (cn.phase === 'now') {
    const many = cn.all.length > 1;
    content = [
      h('div.label', 'עכשיו'),
      cn.all.map((o) => h('div.now-item' + (many ? '.compact' : ''),
        h('h2', o.title),
        h('div.now-meta', h('span.muted', ltr(`${o.start}-${o.end}`)), h('span.remaining', { 'aria-label': `נותרו ${hm(o.e - minute)}` }, 'נותרו ', ltr(hm(o.e - minute)))))),
      nextLine,
    ];
  } else if (cn.phase === 'next') {
    content = [h('div.label', 'הפעילות הבאה'), h('h2', cn.next.title), h('div.now-meta', h('span.muted', ltr(`${cn.next.start}-${cn.next.end}`)), h('span.remaining', 'בעוד ', ltr(hm(cn.untilNext))))];
  } else {
    content = [h('div.label', 'עכשיו'), h('h2.quiet', cn.phase === 'done' ? 'אין עוד פעילויות היום' : 'אין פעילויות היום')];
  }
  return h('section.card.activity', { 'aria-label': 'הפעילות הנוכחית' }, content);
}

function counterCard(state, date) {
  const count = countFor(state, date);
  const target = counterTarget(state, date);
  // Reset is reversible: the toast offers "ביטול" instead of a confirmation dialog.
  const reset = () => run('resetCount', { date }, { success: 'המונה אופס' });
  return h('section.card.counter', { 'aria-label': 'מונה פניות' },
    h('div.counter-head', h('span.label', 'פניות היום'), count > 0 ? h('button.link-btn', { type: 'button', onclick: reset }, 'איפוס') : null),
    h('div.counter-row',
      Object.assign(iconBtn('minus', 'הפחתת פנייה', () => run('changeCount', { date, delta: -1 }), 'round'), { disabled: count === 0 }),
      h('div.counter-value', { role: 'status', 'aria-live': 'polite' }, ring(count, target)),
      iconBtn('plus', 'הוספת פנייה', async () => {
        const before = countFor(S(), date);
        if (!(await run('changeCount', { date, delta: 1 }))) return;
        if (target > 0 && before < target && countFor(S(), date) >= target) celebrateOnce(date);
      }, 'round primary')));
}

function prioritiesSection(state, date) {
  const ids = state.dailyPriorities[date] || [];
  // Only unfinished important tasks are shown; completing one frees its slot (see setTaskStatus).
  const tasks = ids.map((id) => state.tasks.find((t) => t.id === id)).filter((t) => t && t.status !== 'done' && t.status !== 'canceled');
  const active = tasks.map((t) => t.id);
  const rows = tasks.map((t) => h('div.item', { dataset: { taskId: t.id } },
    checkBox(false, `סימון ״${t.title}״ כהושלמה`, () => run('setTaskStatus', { id: t.id, status: 'done' }, { success: 'המשימה הושלמה' }), t.id),
    h('div.body', h('div.title', t.title)),
    iconBtn('x', `הסרת ״${t.title}״ מהמשימות החשובות`, () => run('setPriorities', { date, ids: active.filter((x) => x !== t.id) }))));
  const add = tasks.length < 3 ? btn('בחירת משימה', () => pickPriority(S(), date, active), 'add-row', 'plus') : null;
  return section('3 המשימות החשובות שלי להיום', { attrs: { 'data-section': 'priorities' } },
    rows.length ? h('div.list', rows) : null, add);
}

async function pickPriority(state, date, ids) {
  const pool = [...carriedTasks(state, date).map((x) => x.task), ...todaysTasks(state, date).filter((t) => t.status !== 'done'), ...upcomingTasks(state, date).slice(0, 15)]
    .filter((t, i, a) => !t.virtual && !ids.includes(t.id) && a.findIndex((x) => x.id === t.id) === i);
  const v = await choose('בחירת משימה חשובה', [
    { value: '__new', label: 'משימה חדשה', icon: 'plus' },
    ...pool.slice(0, 40).map((t) => ({ value: t.id, label: t.title, sub: t.scheduledDate && t.scheduledDate !== date ? relDay(t.scheduledDate, date) : null })),
  ]);
  if (!v) return;
  if (v === '__new') { openTaskEditor(null, { date, defaults: { priority: 'high', priorityFor: date } }); return; }
  run('setPriorities', { date, ids: [...ids, v] });
}

export function render(main, args, ctx) {
  const state = S();
  const { date, minute } = ctx;
  main.replaceChildren(h('div.page.home',
    h('p.today-date', fmtDayDate(date)),
    activityCard(state, date, minute),
    counterCard(state, date),
    prioritiesSection(state, date)));
}
