// היום שלי – the approved home layout: context strip, current/next activity, inquiry ring
// and quick +1, workday progress, three priorities, the mandatory carried-task section,
// today's new tasks, due follow-ups, actionable alerts, closing entry point and shortcuts.
import { h, ic, ltr, btn, iconBtn, ring, progress, section, empty, choose, promptText } from '../ui.js';
import { S, run } from '../app.js';
import { fmtDayDate, hebrewDate, fmtDM, hm, relDay } from '../dates.js';
import { LOCATION_LABEL } from '../data/schema.js';
import { effectiveDay, nextWorkday, closingWindow } from '../engine/dayTemplates.js';
import { currentAndNext, blockProgress } from '../engine/schedule.js';
import { carriedTasks, todaysTasks, backlogTasks, upcomingTasks } from '../engine/taskCarryover.js';
import { dayTotals, effectiveTarget } from '../engine/inquiries.js';
import { computeAlerts } from '../engine/conflicts.js';
import { dueFollowUps } from '../engine/workTools.js';
import { upcomingMeetings, agendaQueue } from '../engine/team.js';
import { isInClosingWindow, closingDue } from '../engine/dayClosing.js';
import { taskList, taskRow } from './common.js';
import { openTaskEditor, openDaySettings, openQuestionEditor } from '../editors.js';

export function contextStrip(state, date) {
  const eff = effectiveDay(state, date);
  return h('div.context-strip',
    h('span.date', fmtDayDate(date)), h('span.muted.small', hebrewDate(date)),
    eff.isWorking ? h('span.chip', ic(eff.location === 'home' ? 'home' : 'building', 16), LOCATION_LABEL[eff.location]) : h('span.chip.warn', eff.label || 'לא יום עבודה'),
    eff.phoneDuty ? h('span.chip.duty', ic('phone', 16), 'תורנות ', ltr(`${eff.phoneStart}–${eff.phoneEnd}`)) : null,
    eff.isWorking ? h('span.chip', ic('clock', 16), ltr(`${eff.workStart}–${eff.workEnd}`)) : null,
    iconBtn('edit', 'עריכת הגדרות היום', () => openDaySettings(date)));
}

export function activityCard(state, date, minute) {
  const eff = effectiveDay(state, date);
  const cn = currentAndNext(state, date, minute);
  const nextLine = cn.next ? h('p.next', 'הבא: ', cn.next.title, ' | ', ltr(cn.next.start)) : null;
  let content;
  if (cn.phase === 'off' && !cn.current) {
    const nw = nextWorkday(state, date);
    content = [h('div.label', 'היום אינו יום עבודה'), h('h2', eff.label || 'יום חופשי'), nw ? h('p.next', 'יום העבודה הבא: ', fmtDayDate(nw)) : null];
  } else if (cn.phase === 'before') {
    content = [h('div.label', 'לפני תחילת יום העבודה'), h('h2', cn.next ? cn.next.title : 'יום העבודה'), h('div.remaining', 'בעוד ', ltr(hm(cn.untilNext ?? 0))), nextLine];
  } else if (cn.phase === 'after') {
    content = [h('div.label', 'יום העבודה הסתיים'), h('h2', state.dailyReports[date]?.closedAt ? 'היום נסגר' : 'אפשר לסגור את היום'), nextLine];
  } else if (cn.current) {
    const o = cn.current;
    content = [
      h('div.label', 'עכשיו', cn.overlapping.length ? h('span.chip.warn', ` · ${cn.overlapping.length} פעילויות חופפות`) : null),
      h('h2', o.title), h('div.muted', ltr(`${o.start}–${o.end}`)),
      h('div.remaining', { 'aria-label': `נותרו ${hm(cn.remaining)}` }, ltr(hm(cn.remaining)), h('span.small.muted', ' נותרו')), nextLine,
      h('div.row.wrap', { style: { marginTop: '8px' } },
        h('a.btn.primary.small', { href: '#/focus' }, ic('focus', 18), 'מצב ריכוז'),
        o.kind !== 'meeting' && o.status === 'planned' ? btn('סיום הבלוק', () => run('setBlockStatus', { occId: o.id, status: 'done' }, { success: 'הבלוק סומן כהושלם' }), 'small soft', 'check') : null),
    ];
  } else {
    content = [h('div.label', 'זמן פנוי בין פעילויות'), h('h2', cn.next ? `עד ${cn.next.title}` : 'אין פעילות מתוכננת'), cn.next ? h('div.remaining', ltr(hm(cn.untilNext))) : null, nextLine];
  }
  return h('section.card.activity', { 'aria-label': 'הפעילות הנוכחית' }, content);
}

function prioritiesSection(state, date) {
  const ids = state.dailyPriorities[date] || [];
  const tasks = ids.map((id) => state.tasks.find((t) => t.id === id)).filter(Boolean);
  const move = (i, dir) => { const n = ids.slice(); const j = i + dir; [n[i], n[j]] = [n[j], n[i]]; run('setPriorities', { date, ids: n }); };
  const rows = tasks.map((t, i) => {
    const row = taskRow(t, { date });
    row.prepend(h('span.num', { 'aria-hidden': 'true' }, String(i + 1)));
    row.append(h('div.row', { style: { gap: '0' } },
      i > 0 ? iconBtn('up', `הזזת ״${t.title}״ למעלה`, () => move(i, -1)) : null,
      i < tasks.length - 1 ? iconBtn('down', `הזזת ״${t.title}״ למטה`, () => move(i, 1)) : null,
      iconBtn('x', `הסרת ״${t.title}״ מהמשימות החשובות`, () => run('setPriorities', { date, ids: ids.filter((x) => x !== t.id) }))));
    return row;
  });
  const add = ids.length < 3 ? btn('בחירה', () => pickPriority(state, date, ids), 'small soft', 'plus', { 'aria-label': 'בחירת משימה חשובה' }) : null;
  return section('3 המשימות החשובות היום', { count: `${tasks.length}/3`, action: add },
    rows.length ? h('div.list', rows) : empty('עדיין לא נבחרו משימות חשובות. בפתיחת היום בוחרים עד שלוש.', 'flag'));
}

async function pickPriority(state, date, ids) {
  const pool = [...carriedTasks(state, date).map((x) => x.task), ...todaysTasks(state, date).filter((t) => t.status !== 'done'), ...backlogTasks(state), ...upcomingTasks(state, date).slice(0, 10)]
    .filter((t, i, a) => !t.virtual && !ids.includes(t.id) && a.findIndex((x) => x.id === t.id) === i);
  const v = await choose('בחירת משימה חשובה', [
    { value: '__new', label: 'משימה חדשה…', icon: 'plus' },
    ...pool.slice(0, 40).map((t) => ({ value: t.id, label: t.title, sub: t.scheduledDate ? relDay(t.scheduledDate, date) : 'ללא תאריך' })),
  ]);
  if (!v) return;
  if (v === '__new') {
    const title = await promptText('משימה חשובה חדשה', { label: 'תיאור המשימה' });
    if (title) run('addTask', { title, scheduledDate: date, priority: 'high', priorityFor: date }, { success: 'נוספה למשימות החשובות' });
    return;
  }
  run('setPriorities', { date, ids: [...ids, v] }, { success: 'נוספה למשימות החשובות' });
}

export function alertsSection(state, date, minute, nowIso, limit = 4) {
  const alerts = computeAlerts(state, date, { minute, nowIso });
  if (!alerts.length) return null;
  return section('התראות', { count: alerts.length },
    h('div.list', alerts.slice(0, limit).map((a) => h('div.item',
      ic(a.level === 'danger' ? 'alert' : a.level === 'warn' ? 'alert' : 'bell', 20),
      h('div.body', h('a', { href: a.route, style: { color: 'inherit', textDecoration: 'none' } }, h('div.title', a.title), h('div.meta', a.detail))),
      iconBtn('x', `הסתרת ההתראה להיום: ${a.title}`, () => run('dismissAlert', { key: a.key, date }, { silent: true }))))),
    alerts.length > limit ? h('a.btn.ghost.small', { href: '#/alerts' }, `כל ההתראות (${alerts.length})`) : null);
}

export function render(main, args, ctx) {
  const state = S();
  const { date, minute, nowIso } = ctx;
  const eff = effectiveDay(state, date);
  const totals = dayTotals(state, date);
  const target = effectiveTarget(state, date);
  const prog = blockProgress(state, date);
  const carried = carriedTasks(state, date);
  const todays = todaysTasks(state, date);
  const follow = dueFollowUps(state, date);
  const meetings = upcomingMeetings(state, date);
  const openQs = agendaQueue(state, date).length;
  const inClosing = isInClosingWindow(state, date, minute);
  const cw = closingWindow(state, date);

  const counter = h('div.card.widget', { 'aria-label': 'מונה פניות' },
    h('a', { href: `#/counter/${date}`, style: { textDecoration: 'none', color: 'inherit' }, 'aria-label': `מונה פניות: ${totals.completed}${target.target ? ' מתוך ' + target.target : ''}. פתיחת המונה` }, h('div.label', 'מונה פניות'), ring(totals.completed, target.target)),
    btn('+1', () => run('addInquiry', { date }, { success: `נספרה פנייה (${totals.completed + 1})` }), 'primary small', null, { 'aria-label': 'פנייה טופלה – הוספת 1 למונה' }));
  const workday = h('div.card.widget',
    h('div.label', 'התקדמות יום העבודה'),
    h('div', { style: { fontSize: '1.75rem', fontWeight: '600', color: 'var(--primary)' } }, ltr(`${prog.pct}%`)),
    progress(prog.pct, 'התקדמות יום העבודה'),
    h('div.small.muted', ltr(`${prog.done}/${prog.total}`), ' בלוקים הושלמו', prog.partial ? ` · ${prog.partial} חלקית` : ''));

  const tiles = h('nav.tiles', { 'aria-label': 'קיצורי דרך' },
    h('button.tile', { type: 'button', onclick: () => run('addInquiry', { date }, { success: `נספרה פנייה (${totals.completed + 1})` }) }, ic('headset', 26), 'פנייה טופלה'),
    h('button.tile', { type: 'button', onclick: () => openTaskEditor(null, { date }) }, ic('squareCheck', 26), 'הוספת משימה'),
    h('button.tile', { type: 'button', onclick: () => openQuestionEditor() }, ic('question', 26), 'שאלה חדשה'),
    h('a.tile', { href: '#/team/meetings' }, ic('users', 26), 'פגישות', meetings.length ? h('span.tcount', String(meetings.length)) : null),
    h('a.tile', { href: '#/questions' }, ic('question', 26), 'שאלות', openQs ? h('span.tcount', String(openQs)) : null),
    h('a.tile', { href: `#/reports/day/${date}` }, ic('chart', 26), 'סיכומים'));
  const moreLinks = h('div.row.wrap', h('a.btn.ghost.small', { href: '#/tools/waiting' }, ic('hourglass', 18), 'ממתינים'), h('a.btn.ghost.small', { href: '#/tools/notes' }, ic('note', 18), 'מחברת'), h('a.btn.ghost.small', { href: '#/tools/issues' }, ic('alert', 18), 'תקלות'), h('a.btn.ghost.small', { href: '#/import' }, ic('upload', 18), 'ייבוא תוכנית'));

  const closed = !!state.dailyReports[date]?.closedAt;
  const due = closingDue(state, date, minute);
  const closingCard = eff.isWorking
    ? h('a.card.row' + (inClosing || due ? '.cool' : '.flat'), { href: `#/closing/${date}`, style: { textDecoration: 'none', color: 'inherit' } },
      ic('checkCircle', 26), h('div.body', h('b', closed ? 'היום נסגר – אפשר לעיין או לתקן' : inClosing ? 'זמן סגירת היום' : due ? 'היום עוד לא נסגר' : 'סגירת יום'), h('div.small.muted', cw ? h('span', 'חלון הסגירה ', ltr(`${cw.start}–${cw.end}`)) : '')), ic('left', 20))
    : null;

  main.replaceChildren(h('div.page',
    contextStrip(state, date),
    !eff.isWorking ? h('div.banner.info', ic('calendar'), h('div.grow', h('b', eff.label || 'היום אינו יום עבודה מוגדר'), h('p.small', 'משימות פתוחות מוצגות לעיון. הן יופיעו ביום העבודה הבא: ', nextWorkday(state, date) ? fmtDM(nextWorkday(state, date)) : '—'))) : null,
    activityCard(state, date, minute),
    h('div.grid2', counter, workday),
    closingCard,
    prioritiesSection(state, date),
    section('משימות שלא הסתיימו עד היום', { count: carried.length, attrs: { id: 'carried', 'data-section': 'carried' } },
      taskList(carried, { date, emptyText: 'אין משימות פתוחות מימים קודמים' })),
    section('משימות להיום', { count: todays.filter((t) => t.status !== 'done').length, action: btn('הוספה', () => openTaskEditor(null, { date }), 'small soft', 'plus'), attrs: { 'data-section': 'today' } },
      taskList(todays, { date, emptyText: 'אין משימות חדשות להיום' })),
    follow.length ? section('מעקבים להיום', { count: follow.length }, h('div.list', follow.map((w) => h('a.item', { href: w.type === 'task' ? `#/task/${w.id}` : w.type === 'question' ? `#/questions` : '#/tools/issues', style: { color: 'inherit', textDecoration: 'none' } },
      ic('hourglass', 20), h('div.body', h('div.title', w.title), h('div.meta', w.followUpOn < date ? 'באיחור · ' : '', ltr(fmtDM(w.followUpOn)), w.note ? ` · ${w.note}` : '')))))) : null,
    alertsSection(state, date, minute, nowIso),
    section('קיצורים', {}, tiles, moreLinks)));
}

