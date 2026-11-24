// סדר היום – live agenda for a date: list or hourly timeline, independent phone-duty strip,
// block states (current/future/completed/partial/overrun/canceled/has open tasks), editing
// through sheets (drag/resize alternative), delay handling, planning, notes and export.
import { h, ic, ltr, btn, iconBtn, seg, section, empty, textarea, choose } from '../ui.js';
import { S, run } from '../app.js';
import { fmtDayDate, fromMin, isValidDate, hebrewDate, fmtDM } from '../dates.js';
import { BLOCK_STATUS_LABEL } from '../data/schema.js';
import { effectiveDay, routineBlocks } from '../engine/dayTemplates.js';
import { dayOccurrences } from '../engine/schedule.js';
import { dateNav } from './common.js';
import { contextStrip } from './today.js';
import { openBlockEditor, openDaySettings, openTaskEditor } from '../editors.js';
import { openPlannerPreview, openDelaySheet, openMoveUnfinished } from './plannerSheets.js';
import { timeGrid } from '../timegrid.js';
import { loadUi, saveUi } from '../uiPrefs.js';

export async function moveFromGrid(id, date, s, e) {
  const res = await run('updateOccurrence', { occId: id, changes: { date, start: fromMin(s), end: fromMin(e) }, scope: 'this' }, { success: 'הפעילות הוזזה' });
  requestAnimationFrame(() => { const b = document.querySelector(`.tg-blk[data-id="${CSS.escape(typeof res === 'string' ? res : id)}"]`); b && b.focus(); });
}

function blockCard(state, o, date, minute, isToday) {
  const tasks = o.taskIds.map((id) => state.tasks.find((t) => t.id === id)).filter(Boolean);
  const openTasks = tasks.filter((t) => t.status !== 'done' && t.status !== 'canceled');
  const current = isToday && o.s <= minute && minute < o.e && o.status === 'planned';
  const overrun = isToday && minute >= o.e && o.status === 'planned' && o.kind !== 'meeting';
  const cls = ['tl-card', o.status !== 'planned' ? o.status : '', current ? 'current' : '', overrun ? 'overrun' : ''].filter(Boolean).join('.');
  const color = state.settings.categories.find((c) => c.id === o.categoryId)?.color || '#526273';
  const states = [];
  if (current) states.push(h('span.chip.ok', 'עכשיו'));
  if (o.status !== 'planned') states.push(h('span.chip', BLOCK_STATUS_LABEL[o.status]));
  if (overrun) states.push(h('span.chip.warn', 'עבר הזמן – לא סומן'));
  if (openTasks.length) states.push(h('span.chip', `${openTasks.length} משימות פתוחות`));
  if (o.conflicts.length) states.push(h('span.chip.warn', 'חפיפה'));
  if (o.offDay) states.push(h('span.chip.warn', 'ביום ללא עבודה'));
  if (o.kind === 'meeting') states.push(h('span.chip.duty', 'פגישה'));
  if (o.actualMinutes != null) states.push(h('span.chip', 'בפועל ', ltr(String(o.actualMinutes)), ' דק׳'));
  const quickDone = o.kind !== 'meeting'
    ? h('button.cb', { type: 'button', 'aria-pressed': String(o.status === 'done'), 'aria-label': o.status === 'done' ? `ביטול סימון ״${o.title}״` : `סימון ״${o.title}״ כהושלם`, onclick: () => run('setBlockStatus', { occId: o.id, status: o.status === 'done' ? 'planned' : 'done' }, { success: o.status === 'done' ? 'הסימון בוטל' : 'הבלוק הושלם' }) },
      h('span.box', { svg: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>' }))
    : null;
  return h('div.tl', { dataset: { occ: o.id } },
    h('div.tl-time', h('b', ltr(o.start)), ltr(o.end)),
    h('div.' + cls, { style: { '--c': color } },
      quickDone,
      h('div.body',
        h('button.link', { type: 'button', onclick: () => openBlockEditor(o.id), style: { all: 'unset', cursor: 'pointer', display: 'block' } },
          h('div.title', o.title), states.length ? h('div.meta', states) : null),
        tasks.length ? h('ul.guidance', tasks.map((t) => h('li', t.title, t.status === 'done' ? ' ✓' : ''))) : null,
        o.instructions?.length && state.settings.showGuidance && (current || !isToday) ? h('ul.guidance', o.instructions.map((x) => h('li', x))) : null),
      h('div.stack', { style: { gap: '0' } },
        current ? h('a.icon-btn', { href: '#/focus', 'aria-label': 'מצב ריכוז', title: 'מצב ריכוז', svg: '<svg class="ic" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4"/></svg>' }) : null,
        iconBtn('plus', `הוספת משימה ל״${o.title}״`, () => openTaskEditor(null, { date, defaults: { scheduledDate: date }, onSaved: (id) => run('assignTaskToBlock', { taskId: id, occId: o.id }) })),
        iconBtn('more', `פעולות עבור ${o.title}`, async () => {
          if (o.kind === 'meeting') { location.hash = `#/meeting/${o.sourceId}`; return; }
          const v = await choose(o.title, [
            { value: 'partial', label: 'הושלם חלקית', icon: 'dot' }, { value: 'skipped', label: 'דילוג', icon: 'right' }, { value: 'canceled', label: 'ביטול לבלוק הזה', icon: 'x' },
            { value: 'planned', label: 'החזרה למתוכנן', icon: 'undo' }, { value: 'edit', label: 'עריכה / העברה / פיצול', icon: 'edit' },
          ]);
          if (!v) return;
          if (v === 'edit') openBlockEditor(o.id);
          else run('setBlockStatus', { occId: o.id, status: v }, { success: `סטטוס: ${BLOCK_STATUS_LABEL[v]}` });
        }))));
}

export function render(main, args, ctx) {
  const state = S();
  const date = isValidDate(args[0]) ? args[0] : ctx.date;
  const isToday = date === ctx.date;
  const eff = effectiveDay(state, date);
  const occs = dayOccurrences(state, date);
  const sup = routineBlocks(state, date).suppressed;
  const mode = loadUi('agendaMode', 'list');
  const noteVal = state.dayNotes[date] || {};
  const notes = textarea(noteVal.notes || '', { maxlength: 5000, 'aria-label': 'הערות ליום', placeholder: 'הערות כלליות ליום (לא חובה)' });
  const acc = textarea(noteVal.accomplishments || '', { maxlength: 5000, 'aria-label': 'מה הצלחתי היום', placeholder: 'מה הצלחתי היום (לא חובה)' });
  const saveNotes = () => run('saveDayNote', { date, notes: notes.value, accomplishments: acc.value }, { silent: true });
  notes.addEventListener('change', saveNotes);
  acc.addEventListener('change', saveNotes);

  const view = mode === 'grid'
    ? timeGrid(state, [date], { today: ctx.date, nowMinute: ctx.minute, onTap: (id) => openBlockEditor(id), onEmpty: (d, m) => openBlockEditor(null, { date: d, start: m }), onChange: moveFromGrid })
    : (occs.length ? h('div.timeline', occs.map((o) => blockCard(state, o, date, ctx.minute, isToday))) : empty(eff.isWorking ? 'אין פעילויות ביום הזה' : 'היום אינו יום עבודה – אין בלוקים קבועים', 'calendar'));

  main.replaceChildren(h('div.page',
    dateNav(date, (d) => `#/agenda/${d}`, h('span', fmtDayDate(date), h('span.small.muted', ' · ', hebrewDate(date)))),
    contextStrip(state, date),
    eff.phoneDuty ? h('div.duty-strip', { role: 'note' }, ic('phone', 18), h('span', 'תורנות טלפון ', ltr(`${eff.phoneStart}–${eff.phoneEnd}`), ' – במקביל ללו״ז'), h('button.btn.ghost.small', { type: 'button', onclick: () => openDaySettings(date) }, 'עריכה')) : null,
    seg([{ value: 'list', label: 'רשימה' }, { value: 'grid', label: 'ציר שעות' }], mode, (v) => { saveUi('agendaMode', v); render(main, args, ctx); }, 'תצוגה'),
    mode === 'grid' ? h('p.muted.small', 'גרירה: לחיצה ארוכה במגע או גרירה בעכבר; שינוי משך מהידית התחתונה; במקלדת Alt+חצים (Shift לשינוי משך). אפשר גם לפתוח פעילות ולערוך שעות.') : null,
    view,
    sup.length ? h('div.banner.info', ic('clock'), h('div.grow', 'ביום המקוצר לא נכנסו: ', sup.map((b) => b.title).join(', '))) : null,
    h('div.row.wrap',
      btn('הוספת פעילות', () => openBlockEditor(null, { date }), 'primary', 'plus'),
      btn('עיכוב בלו״ז', () => openDelaySheet(date), 'soft', 'clock', { disabled: !occs.length }),
      btn('הצעת תכנון ליום', () => openPlannerPreview([date], `הצעת תכנון · ${fmtDM(date)}`), 'soft', 'wand'),
      btn('משימות פתוחות ליום אחר', () => openMoveUnfinished(date), 'ghost', 'right'),
      btn('תמונה של היום', async () => (await import('../export/exportUi.js')).exportDayImage(date), 'ghost', 'image'),
      btn('הדפסה', async () => (await import('../export/exportUi.js')).printDay(date), 'ghost', 'printer')),
    section('הערות והישגים', {}, notes, acc, h('p.muted.small', 'נשמר אוטומטית ביציאה מהשדה. לא חובה.'))));
}

