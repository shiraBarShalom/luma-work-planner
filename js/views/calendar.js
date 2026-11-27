// יומן - month / week / day. Sunday-first, RTL, unbounded navigation with buttons and
// selectors (no swipe required). The calendar itself is the content.
import { h, btn, iconBtn, seg, input, select } from '../ui.js';
import { S } from '../app.js';
import { monthGrid, MONTHS, DAY_LETTERS, DAY_NAMES, weekStart, addMonths, weekLabel, fmtDayDate, isValidDate, weekDates, monthLabel } from '../dates.js';
import { dayOccurrences } from '../engine/schedule.js';
import { openDeadlines } from '../engine/taskCarryover.js';
import { timeGrid } from '../timegrid.js';
import { openBlockEditor } from '../editors.js';
import { moveFromGrid } from './agenda.js';
import { dateNav, todayLink } from './common.js';

const MODES = [{ value: 'month', label: 'חודש' }, { value: 'week', label: 'שבוע' }, { value: 'day', label: 'יום' }];

function monthView(state, date, ctx) {
  const y = +date.slice(0, 4), m = +date.slice(5, 7);
  const deadlines = new Set(openDeadlines(state).map((t) => t.deadline));
  const catColor = (id) => state.settings.categories.find((c) => c.id === id)?.color || '#286C96';
  const monthSel = select(MONTHS.map((n, i) => ({ value: String(i + 1), label: n })), String(m), { 'aria-label': 'חודש' });
  const yearInp = input('number', y, { min: 1900, max: 2200, 'aria-label': 'שנה', inputmode: 'numeric', class: 'year-input' });
  const go = () => { const yy = Number(yearInp.value); if (yy >= 1900 && yy <= 2200) location.hash = `#/calendar/month/${yy}-${String(monthSel.value).padStart(2, '0')}-01`; };
  monthSel.addEventListener('change', go);
  yearInp.addEventListener('change', go);
  const grid = h('div.month', { role: 'grid', 'aria-label': monthLabel(y, m) },
    DAY_LETTERS.map((l, i) => h('div.dow', { role: 'columnheader', 'aria-label': DAY_NAMES[i] }, l)),
    monthGrid(y, m).map((d) => {
      // One-off activities are marked; the recurring weekly schedule is not, to keep the month calm.
      const oneOff = dayOccurrences(state, d).filter((o) => !o.recurring && o.status !== 'canceled');
      const dots = oneOff.slice(0, 3).map((o) => h('i', { style: { '--c': catColor(o.categoryId) } }));
      if (deadlines.has(d)) dots.push(h('i', { style: { '--c': 'var(--danger)' } }));
      const parts = [oneOff.length ? `${oneOff.length} פעילויות` : '', deadlines.has(d) ? 'מועד יעד' : ''].filter(Boolean).join(', ');
      return h('a.mday' + (d.slice(5, 7) !== date.slice(5, 7) ? '.out' : '') + (d === ctx.date ? '.today' : ''), {
        href: `#/calendar/day/${d}`, role: 'gridcell', 'aria-label': `${fmtDayDate(d)}${parts ? '. ' + parts : ''}`, 'aria-current': d === ctx.date ? 'date' : null,
      }, h('span.n', String(+d.slice(8))), h('span.dots', dots));
    }));
  return [
    h('nav.datenav', { 'aria-label': 'ניווט בין חודשים' },
      iconBtn('right', 'החודש הקודם', () => { location.hash = `#/calendar/month/${addMonths(date, -1)}`; }),
      h('div.month-pick', monthSel, yearInp),
      iconBtn('left', 'החודש הבא', () => { location.hash = `#/calendar/month/${addMonths(date, 1)}`; })),
    h('div.card.month-card', grid),
  ];
}

const grid = (state, days, ctx) => timeGrid(state, days, { today: ctx.date, nowMinute: ctx.minute, onTap: (id) => openBlockEditor(id), onEmpty: (d, m) => openBlockEditor(null, { date: d, start: m }), onChange: moveFromGrid });

function weekView(state, date, ctx) {
  const ws = weekStart(date);
  return [
    dateNav(ws, (d) => `#/calendar/week/${weekStart(d)}`, { step: 7, unit: 'week', label: weekLabel(ws) }),
    grid(state, weekDates(ws), ctx),
  ];
}

function dayView(state, date, ctx) {
  return [
    dateNav(date, (d) => `#/calendar/day/${d}`),
    grid(state, [date], ctx),
    btn('הוספת פעילות', () => openBlockEditor(null, { date }), 'soft block', 'plus'),
  ];
}

export function render(main, args, ctx) {
  const state = S();
  const mode = MODES.some((m) => m.value === args[0]) ? args[0] : 'month';
  const date = isValidDate(args[1]) ? args[1] : ctx.date;
  const content = mode === 'month' ? monthView(state, date, ctx) : mode === 'week' ? weekView(state, date, ctx) : dayView(state, date, ctx);
  const showToday = mode === 'month' ? date.slice(0, 7) !== ctx.date.slice(0, 7) : mode === 'week' ? weekStart(date) !== weekStart(ctx.date) : date !== ctx.date;
  main.replaceChildren(h('div.page',
    h('div.nav-row', seg(MODES, mode, (v) => { location.hash = `#/calendar/${v}/${date}`; }, 'תצוגת יומן'), showToday ? todayLink('', ctx.date, `#/calendar/${mode}/${ctx.date}`) : null),
    content));
}
