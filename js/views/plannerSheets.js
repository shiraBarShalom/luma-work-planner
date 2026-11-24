// Planner preview, delay handling and "move unfinished" sheets. Previews never mutate;
// only the explicit approve button dispatches a command (undoable).
import { h, ic, ltr, btn, openSheet, field, input, seg, select, empty, check } from '../ui.js';
import { S, run, nowCtx } from '../app.js';
import { fmtDM, fmtDayShort } from '../dates.js';
import { proposePlan, proposeDelay, proposeMoveUnfinished } from '../engine/planner.js';
import { dayOccurrences, currentAndNext } from '../engine/schedule.js';

export function openPlannerPreview(dates, title = 'הצעת תכנון') {
  const state = S();
  const now = nowCtx();
  const p = proposePlan(state, { now, dates: dates.filter((d) => d >= now.date) });
  const chosen = new Set(p.assignments.map((a) => a.taskId));
  const rows = p.assignments.map((a) => h('div.item',
    check('', true, (v) => (v ? chosen.add(a.taskId) : chosen.delete(a.taskId)), { 'aria-label': `לכלול: ${a.title}` }),
    h('div.body', h('div.title', a.title), h('div.meta', fmtDayShort(a.date), ' · ', a.blockTitle, ' · ', ltr(`${a.estimate}`), ' דק׳', a.assumed ? h('span.chip.warn', 'הערכה משוערת') : null), h('div.small.muted', a.reason))));
  const sh = openSheet({
    title,
    body: [
      h('p.muted.small', 'זו הצעה בלבד. שום דבר לא משתנה עד האישור. משימות ששובצו ידנית ובלוקים נעוצים נשמרים.'),
      h('div.stats', h('div.stat', h('b', String(p.assignments.length)), h('span', 'שיבוצים מוצעים')), h('div.stat', h('b', ltr(String(p.totals.free))), h('span', 'דק׳ פנויות אחרי השיבוץ')), h('div.stat', h('b', String(p.unallocated.length)), h('span', 'לא שובצו'))),
      p.totals.assumedCount ? h('div.banner', ic('alert'), h('div.grow', `${p.totals.assumedCount} משימות ללא הערכת זמן שובצו לפי הנחה של ${state.settings.planner.assumedEstimateMinutes} דק׳ (ניתן לשנות בהגדרות).`)) : null,
      h('h3', 'שיבוצים'), rows.length ? h('div.list', rows) : empty('אין שיבוצים מוצעים'),
      p.conflicts.length ? [h('h3', 'התנגשויות'), h('ul', p.conflicts.map((c) => h('li', h('b', c.title), ' – ', c.detail)))] : null,
      p.unallocated.length ? [h('h3', 'לא שובץ'), h('ul', p.unallocated.map((u) => h('li', h('b', u.title), ' – ', u.reason)))] : null,
      p.capacity.length ? h('details.more', h('summary', 'קיבולת לפי בלוקים'), h('table.data', h('thead', h('tr', h('th', 'יום'), h('th', 'בלוק'), h('th', 'משך'), h('th', 'פנוי'))),
        h('tbody', p.capacity.map((c) => h('tr', h('td', fmtDayShort(c.date)), h('td', c.title), h('td', ltr(String(c.length))), h('td', ltr(String(c.free)))))))) : null,
    ],
    footer: [btn('ביטול', () => sh.close(), 'ghost'), btn('אישור השיבוצים שנבחרו', async () => {
      const sel = p.assignments.filter((a) => chosen.has(a.taskId));
      if (!sel.length) { sh.close(); return; }
      if (await run('applyPlannerAssignments', { assignments: sel }, { success: `${sel.length} משימות שובצו` })) sh.close(true);
    }, 'primary', null, { disabled: !p.assignments.length })],
  });
}

export function openDelaySheet(date) {
  const state = S();
  const now = nowCtx();
  const occs = dayOccurrences(state, date).filter((o) => o.status !== 'canceled' && o.status !== 'skipped' && o.kind !== 'meeting');
  if (!occs.length) return;
  const cn = date === now.date ? currentAndNext(state, date, now.minute) : null;
  const occSel = select(occs.map((o) => ({ value: o.id, label: `${o.start}–${o.end} ${o.title}` })), cn?.current?.id || occs[0].id);
  const mins = input('number', 15, { min: 5, max: 240, step: 5, inputmode: 'numeric' });
  const strat = seg([{ value: 'shift', label: 'הזזת הבאים' }, { value: 'shorten', label: 'קיצור גמישים' }, { value: 'moveTasks', label: 'העברת משימות' }], 'shift', () => preview(), 'אסטרטגיה');
  const out = h('div.stack');
  let current = null;
  const preview = () => {
    current = proposeDelay(S(), date, occSel.value, Number(mins.value), strat.value);
    if (current.error) { out.replaceChildren(h('p.form-error', 'נתונים לא תקינים')); return; }
    out.replaceChildren(
      h('h3', 'לפני ← אחרי'),
      current.changes.length ? h('ul', current.changes.map((c) => h('li', c.title, ': ', ltr(`${c.before[0]}–${c.before[1]}`), ' ← ', ltr(`${c.after[0]}–${c.after[1]}`)))) : h('p.muted', 'אין שינויי שעות'),
      current.moves.length ? [h('h3', `משימות שיעברו ל־${fmtDM(current.nextWorkday)}`), h('ul', current.moves.map((m) => h('li', m.title)))] : null,
      current.notFitting.length ? [h('h3', 'לא נכנס'), h('ul', current.notFitting.map((n) => h('li', n.title, ' – ', n.detail)))] : null,
      current.conflicts.length ? [h('h3', 'נשאר לטיפול'), h('ul', current.conflicts.map((c) => h('li', c.detail)))] : null,
      h('p.muted.small', 'פגישות והפסקה מוגנת לא זזות, וסוף יום העבודה לא מתארך.'));
  };
  occSel.addEventListener('change', preview);
  mins.addEventListener('input', preview);
  preview();
  const sh = openSheet({
    title: 'הפעילות מתעכבת',
    body: [field('איזו פעילות', occSel), field('עיכוב בדקות', mins), field('מה לעשות', strat), out],
    footer: [btn('ביטול', () => sh.close(), 'ghost'), btn('אישור השינויים', async () => {
      if (!current || current.error) return;
      if (!current.changes.length && !current.moves.length) { sh.close(); return; }
      if (await run('applyDelay', { proposal: current }, { success: 'הלו״ז עודכן' })) sh.close(true);
    }, 'primary')],
  });
}

export function openMoveUnfinished(date) {
  const p = proposeMoveUnfinished(S(), date);
  const chosen = new Set(p.tasks.map((t) => t.taskId));
  const sh = openSheet({
    title: 'העברת משימות פתוחות',
    body: [h('p.muted.small', 'משימות פתוחות מופיעות ממילא ב״משימות שלא הסתיימו עד היום״. כאן אפשר לתזמן אותן מחדש במפורש; התאריך המקורי נשמר.'),
      p.tasks.length ? h('div.list', p.tasks.map((t) => h('div.item', check(t.title, true, (v) => (v ? chosen.add(t.taskId) : chosen.delete(t.taskId)))))) : h('p.muted', 'אין משימות פתוחות לתאריך הזה'),
      p.to ? h('p', 'יעד: ', fmtDM(p.to)) : h('p.form-error', 'לא נמצא יום עבודה בטווח הקרוב')],
    footer: [btn('ביטול', () => sh.close(), 'ghost'), btn('העברה', async () => {
      if (!p.to || !chosen.size) { sh.close(); return; }
      if (await run('moveUnfinished', { taskIds: [...chosen], to: p.to }, { success: `הועברו ל־${fmtDM(p.to)}` })) sh.close(true);
    }, 'primary', null, { disabled: !p.tasks.length || !p.to })],
  });
}
