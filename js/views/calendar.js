// יומן – month / week / day. Sunday-first, RTL, Hebrew dates, unbounded navigation with
// buttons and selectors (no swipe required), markers for meetings, days off, home days,
// deadlines and duty. Week view: hourly grid with cross-day drag and a week-pattern editor.
import { h, ic, ltr, btn, iconBtn, seg, section, empty, openSheet, check, input, select } from '../ui.js';
import { S, run } from '../app.js';
import { monthGrid, MONTHS, DAY_LETTERS, DAY_NAMES, weekStart, addDays, addMonths, weekLabel, fmtDayDate, hebrewDay, isValidDate, weekDates, fmtDM } from '../dates.js';
import { LOCATION_LABEL } from '../data/schema.js';
import { effectiveDay } from '../engine/dayTemplates.js';
import { dayOccurrences } from '../engine/schedule.js';
import { openDeadlines, weekTasks } from '../engine/taskCarryover.js';
import { periodSummary } from '../engine/inquiries.js';
import { timeGrid } from '../timegrid.js';
import { openBlockEditor, openMeetingEditor, openTaskEditor } from '../editors.js';
import { moveFromGrid } from './agenda.js';
import { openPlannerPreview } from './plannerSheets.js';
import { taskList } from './common.js';

const MODES = [{ value: 'month', label: 'חודש' }, { value: 'week', label: 'שבוע' }, { value: 'day', label: 'יום' }];

function monthView(state, date, ctx) {
  const y = +date.slice(0, 4), m = +date.slice(5, 7);
  const days = monthGrid(y, m);
  const deadlines = new Map();
  for (const t of openDeadlines(state)) { if (!deadlines.has(t.deadline)) deadlines.set(t.deadline, []); deadlines.get(t.deadline).push(t); }
  const catColor = (id) => state.settings.categories.find((c) => c.id === id)?.color || '#526273';
  const monthSel = select(MONTHS.map((n, i) => ({ value: String(i + 1), label: n })), String(m), { 'aria-label': 'חודש', style: { maxWidth: '130px' } });
  const yearInp = input('number', y, { min: 1900, max: 2200, 'aria-label': 'שנה', style: { maxWidth: '96px' }, inputmode: 'numeric' });
  const go = () => { const yy = Number(yearInp.value); if (yy >= 1900 && yy <= 2200) location.hash = `#/calendar/month/${yy}-${String(monthSel.value).padStart(2, '0')}-01`; };
  monthSel.addEventListener('change', go);
  yearInp.addEventListener('change', go);
  const grid = h('div.month', { role: 'grid', 'aria-label': `${MONTHS[m - 1]} ${y}` },
    DAY_LETTERS.map((l, i) => h('div.dow', { role: 'columnheader', 'aria-label': DAY_NAMES[i] }, l)),
    days.map((d) => {
      const eff = effectiveDay(state, d);
      const occ = dayOccurrences(state, d).filter((o) => o.kind !== 'routine' && o.status !== 'canceled');
      const dots = [];
      for (const o of occ.slice(0, 3)) dots.push(h('i', { style: { '--c': o.kind === 'meeting' ? catColor('meeting') : catColor(o.categoryId) } }));
      if (deadlines.has(d)) dots.push(h('i', { style: { '--c': 'var(--danger)' } }));
      if (eff.phoneDuty) dots.push(h('i', { style: { '--c': 'var(--champagne)' } }));
      const labels = [eff.isWorking ? LOCATION_LABEL[eff.location] : (eff.label || 'לא יום עבודה'), eff.phoneDuty ? 'תורנות' : '', occ.filter((o) => o.kind === 'meeting').length ? `${occ.filter((o) => o.kind === 'meeting').length} פגישות` : '', deadlines.has(d) ? `${deadlines.get(d).length} מועדי יעד` : ''].filter(Boolean).join(', ');
      return h('button.mday' + (d.slice(5, 7) !== date.slice(5, 7) ? '.out' : '') + (!eff.isWorking ? '.off' : '') + (d === ctx.date ? '.today' : ''), {
        type: 'button', role: 'gridcell', 'aria-selected': String(d === date), 'aria-label': `${fmtDayDate(d)}. ${labels}`,
        onclick: () => { location.hash = `#/calendar/month/${d}`; },
        ondblclick: () => { location.hash = `#/agenda/${d}`; },
      }, h('span.n', String(+d.slice(8))), h('span.heb', hebrewDay(d)), h('span.dots', dots), eff.isWorking && eff.location === 'home' ? h('span.heb', 'בית') : null);
    }));
  const sel = dayOccurrences(state, date).filter((o) => o.status !== 'canceled');
  const eff = effectiveDay(state, date);
  return [
    h('nav.datenav', { 'aria-label': 'ניווט בין חודשים' },
      iconBtn('right', 'החודש הקודם', () => { location.hash = `#/calendar/month/${addMonths(date, -1)}`; }),
      h('div.grow.row', { style: { justifyContent: 'center' } }, monthSel, yearInp),
      iconBtn('left', 'החודש הבא', () => { location.hash = `#/calendar/month/${addMonths(date, 1)}`; })),
    h('div.card', grid),
    h('p.small.muted', 'מקרא: נקודה צבעונית – פעילות/פגישה לפי קטגוריה · אדומה – מועד יעד · שמפניה – תורנות. לחיצה בוחרת יום; לחיצה כפולה פותחת את סדר היום.'),
    section(fmtDayDate(date), { action: h('a.btn.ghost.small', { href: `#/agenda/${date}` }, 'לסדר היום') },
      h('p.small.muted', eff.isWorking ? `${LOCATION_LABEL[eff.location]}${eff.phoneDuty ? ' · תורנות טלפון' : ''}` : (eff.label || 'לא יום עבודה')),
      sel.length ? h('div.list', sel.map((o) => h('button.item', { type: 'button', onclick: () => openBlockEditor(o.id), style: { width: '100%', border: '0', background: 'none', textAlign: 'start', cursor: 'pointer' } },
        h('span.chip.dot', { style: { '--c': o.kind === 'meeting' ? catColor('meeting') : catColor(o.categoryId) } }, ltr(`${o.start}–${o.end}`)), h('div.body', h('div.title', o.title))))) : empty('אין פעילויות'),
      deadlines.has(date) ? h('div.stack', h('h3', 'מועדי יעד'), taskList(deadlines.get(date), { date })) : null,
      h('div.row.wrap', btn('הוספת אירוע', () => openBlockEditor(null, { date }), 'primary', 'plus'), btn('פגישה', () => openMeetingEditor(null, { date }), 'soft', 'users'))),
  ];
}

function openWeekPattern(ws) {
  const state = S();
  const rows = weekDates(ws).map((d, i) => {
    const eff = effectiveDay(state, d);
    const working = check('יום עבודה', eff.isWorking);
    const loc = select(['office', 'home', 'other'].map((v) => ({ value: v, label: LOCATION_LABEL[v] })), eff.location || 'office', { 'aria-label': `מיקום ביום ${DAY_NAMES[i]}` });
    const duty = check('תורנות', eff.phoneDuty);
    const s = input('time', eff.workStart, { 'aria-label': `התחלה ביום ${DAY_NAMES[i]}` });
    const e = input('time', eff.workEnd, { 'aria-label': `סיום ביום ${DAY_NAMES[i]}` });
    return { i, d, working, loc, duty, s, e, el: h('div.card.flat.stack', h('b', `${DAY_NAMES[i]} · ${fmtDM(d)}`), h('div.row.wrap', working, duty), h('div.grid3', loc, s, e)) };
  });
  const sh = openSheet({
    title: `דפוס השבוע · ${weekLabel(ws)}`,
    body: [h('p.muted.small', 'שינוי כאן חל על השבוע הזה בלבד. הגדרה ליום ספציפי (מסדר היום) גוברת על דפוס השבוע.'), rows.map((r) => r.el)],
    footer: [btn('ביטול', () => sh.close(), 'ghost'), btn('שמירה', async () => {
      const base = state.settings;
      for (const r of rows) {
        const def = base.weekly[r.i];
        const isW = r.working.querySelector('input').checked;
        const patch = {
          isWorking: isW === def.isWorking ? null : isW,
          location: !isW || r.loc.value === (def.location || 'office') ? null : r.loc.value,
          phoneDuty: r.duty.querySelector('input').checked === !!(def.isWorking && def.phoneDuty) ? null : r.duty.querySelector('input').checked,
          workStart: r.s.value === (def.workStart || base.workHours.start) ? null : r.s.value,
          workEnd: r.e.value === (def.workEnd || base.workHours.end) ? null : r.e.value,
        };
        const ok = await run('setWeekOverride', { weekStart: ws, weekday: r.i, patch }, { silent: true });
        if (!ok) return;
      }
      sh.close(true);
    }, 'primary')],
  });
}

function weekView(state, date, ctx) {
  const ws = weekStart(date);
  const days = weekDates(ws);
  const inq = periodSummary(state, ws, addDays(ws, 6), ctx.date);
  const tasks = weekTasks(state, date);
  return [
    h('nav.datenav', { 'aria-label': 'ניווט בין שבועות' },
      iconBtn('right', 'השבוע הקודם', () => { location.hash = `#/calendar/week/${addDays(ws, -7)}`; }),
      h('div.grow', weekLabel(ws)),
      iconBtn('left', 'השבוע הבא', () => { location.hash = `#/calendar/week/${addDays(ws, 7)}`; })),
    h('div.row.wrap', h('span.chip', 'פניות: ', ltr(`${inq.completed}/${inq.targetFull}`)), h('span.chip', `ימי עבודה: ${inq.workdays}`), h('span.chip', `משימות פתוחות בשבוע: ${tasks.length}`)),
    timeGrid(state, days, { today: ctx.date, nowMinute: ctx.minute, onTap: (id) => openBlockEditor(id), onEmpty: (d, m) => openBlockEditor(null, { date: d, start: m }), onChange: moveFromGrid }),
    h('p.muted.small', 'גרירה בין ימים ושעות: לחיצה ארוכה במגע או גרירה בעכבר. במקלדת: Alt+חצים להזזה, Alt+Shift לשינוי משך. אפשר גם לפתוח כל פעילות ולערוך.'),
    h('div.row.wrap',
      btn('דפוס השבוע', () => openWeekPattern(ws), 'soft', 'calendar'),
      btn('הצעת תכנון לשבוע', () => openPlannerPreview(days, `הצעת תכנון · ${weekLabel(ws)}`), 'soft', 'wand'),
      h('a.btn.ghost', { href: '#/import' }, ic('upload', 18), 'ייבוא תוכנית'),
      btn('תמונה של השבוע', async () => (await import('../export/exportUi.js')).exportWeekImage(ws), 'ghost', 'image'),
      btn('הדפסת השבוע', async () => (await import('../export/exportUi.js')).printWeek(ws), 'ghost', 'printer'),
      btn('הוספת משימה לשבוע', () => openTaskEditor(null, { date }), 'ghost', 'plus')),
    section('משימות השבוע', { count: tasks.length }, taskList(tasks, { date: ctx.date, emptyText: 'אין משימות פתוחות לשבוע הזה' })),
  ];
}

function dayView(state, date, ctx) {
  return [
    h('nav.datenav', { 'aria-label': 'ניווט בין ימים' },
      iconBtn('right', 'היום הקודם', () => { location.hash = `#/calendar/day/${addDays(date, -1)}`; }),
      h('div.grow', fmtDayDate(date)),
      iconBtn('left', 'היום הבא', () => { location.hash = `#/calendar/day/${addDays(date, 1)}`; })),
    timeGrid(state, [date], { today: ctx.date, nowMinute: ctx.minute, onTap: (id) => openBlockEditor(id), onEmpty: (d, m) => openBlockEditor(null, { date: d, start: m }), onChange: moveFromGrid }),
    h('div.row.wrap', btn('הוספת פעילות', () => openBlockEditor(null, { date }), 'primary', 'plus'), h('a.btn.soft', { href: `#/agenda/${date}` }, 'סדר היום המלא')),
  ];
}

export function render(main, args, ctx) {
  const state = S();
  const mode = MODES.some((m) => m.value === args[0]) ? args[0] : 'month';
  const date = isValidDate(args[1]) ? args[1] : ctx.date;
  const content = mode === 'month' ? monthView(state, date, ctx) : mode === 'week' ? weekView(state, date, ctx) : dayView(state, date, ctx);
  main.replaceChildren(h('div.page',
    seg(MODES, mode, (v) => { location.hash = `#/calendar/${v}/${date}`; }, 'תצוגת יומן'),
    h('div.row', btn('היום', () => { location.hash = `#/calendar/${mode}/${ctx.date}`; }, 'small ghost', 'calendar')),
    content));
}
