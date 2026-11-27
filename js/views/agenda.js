// סדר היום - the day's activities as a completion checklist (list) or an hourly timeline,
// over the same schedule data, with one shared notes field for the day.
import { h, ltr, btn, iconBtn, seg, textarea, choose } from '../ui.js';
import { S, run } from '../app.js';
import { fromMin, isValidDate } from '../dates.js';
import { BLOCK_STATUS_LABEL } from '../data/schema.js';
import { dayOccurrences } from '../engine/schedule.js';
import { dateNav, checkBox, todayLink } from './common.js';
import { openBlockEditor } from '../editors.js';
import { timeGrid } from '../timegrid.js';
import { loadUi, saveUi } from '../uiPrefs.js';

/** Commit a drag/resize from a time grid (same command as the editor, this occurrence only). */
export async function moveFromGrid(id, date, s, e) {
  const res = await run('updateOccurrence', { occId: id, changes: { date, start: fromMin(s), end: fromMin(e) }, scope: 'this' });
  requestAnimationFrame(() => { const b = document.querySelector(`.tg-blk[data-id="${CSS.escape(typeof res === 'string' ? res : id)}"]`); b && b.focus(); });
}

async function activityMenu(o) {
  const v = await choose(o.title, [
    { value: 'partial', label: 'הושלם חלקית', icon: 'dot' },
    { value: 'skipped', label: 'דילוג', icon: 'right' },
    { value: 'canceled', label: 'ביטול הפעילות', icon: 'x' },
    { value: 'edit', label: 'עריכה', icon: 'edit' },
  ]);
  if (!v) return;
  if (v === 'edit') openBlockEditor(o.id);
  else run('setBlockStatus', { occId: o.id, status: o.status === v ? 'planned' : v }, { success: o.status === v ? 'הסימון בוטל' : BLOCK_STATUS_LABEL[v] });
}

function activityCard(o, minute, isToday) {
  const done = o.status === 'done';
  const current = isToday && o.s <= minute && minute < o.e && o.status === 'planned';
  const cls = ['tl-card', o.status !== 'planned' ? o.status : '', current ? 'current' : ''].filter(Boolean).join('.');
  return h('div.' + cls, { dataset: { occ: o.id } },
    checkBox(done, done ? `ביטול סימון ״${o.title}״` : `סימון ״${o.title}״ כהושלם`, () => run('setBlockStatus', { occId: o.id, status: done ? 'planned' : 'done' })),
    h('div.body',
      h('div.tl-time', ltr(`${o.start}-${o.end}`)),
      h('div.title', o.title),
      o.notes ? h('div.note', o.notes) : null,
      o.status !== 'planned' && !done ? h('div.state', BLOCK_STATUS_LABEL[o.status]) : null),
    iconBtn('more', `פעולות עבור ${o.title}`, () => activityMenu(o)));
}

/** The day's notes, shared by both modes. Saved when the field is left (and on page hide). */
function notesField(state, date) {
  const area = textarea(state.dayNotes[date]?.notes || '', { maxlength: 5000, rows: 3, 'aria-label': 'הערות ליום', placeholder: 'הערות', class: 'day-notes' });
  area.addEventListener('change', () => run('saveDayNote', { date, notes: area.value }, { silent: true }));
  return area;
}

export function render(main, args, ctx) {
  const state = S();
  const date = isValidDate(args[0]) ? args[0] : ctx.date;
  const isToday = date === ctx.date;
  const mode = loadUi('agendaMode', 'list') === 'grid' ? 'grid' : 'list';
  const occs = dayOccurrences(state, date);
  const view = mode === 'grid'
    ? [timeGrid(state, [date], { today: ctx.date, nowMinute: ctx.minute, onTap: (id) => openBlockEditor(id), onEmpty: (d, m) => openBlockEditor(null, { date: d, start: m }), onChange: moveFromGrid }),
      btn('הוספת פעילות', () => openBlockEditor(null, { date }), 'soft block', 'plus')]
    : (occs.length ? h('div.timeline', occs.map((o) => activityCard(o, ctx.minute, isToday))) : h('p.quiet-empty', 'אין פעילויות'));
  main.replaceChildren(h('div.page',
    h('div.nav-row', dateNav(date, (d) => `#/agenda/${d}`), todayLink(date, ctx.date, `#/agenda/${ctx.date}`)),
    seg([{ value: 'list', label: 'רשימה' }, { value: 'grid', label: 'ציר שעות' }], mode, (v) => { saveUi('agendaMode', v); render(main, args, ctx); }, 'תצוגה'),
    view,
    notesField(state, date)));
}
