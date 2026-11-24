// סיכומים – daily/weekly/monthly reports, and the inquiry counter screen.
import { h, ic, ltr, btn, iconBtn, seg, section, empty, choose, promptText } from '../ui.js';
import { S, run } from '../app.js';
import { addDays, addMonths, weekStart, monthStart, monthEnd, isValidDate, fmtDayDate, fmtDayShort, fmtDM } from '../dates.js';
import { INQUIRY_KIND_LABEL, INQUIRY_CATEGORY_LABEL } from '../data/schema.js';
import { periodReport, snapshotDrift } from '../engine/statistics.js';
import { dayTotals, effectiveTarget, eventsForDate, pct, remainingOf, defaultTargetAt } from '../engine/inquiries.js';
import { reportText, periodLabel } from '../export/text.js';
import { copyText } from '../export/share.js';
import { printReport, exportSummaryImage, exportTasksCsv, exportInquiriesCsv, PRIVACY_NOTE } from '../export/exportUi.js';
import { contextStrip } from './today.js';

const PERIODS = [{ value: 'day', label: 'יום' }, { value: 'week', label: 'שבוע' }, { value: 'month', label: 'חודש' }];

function rangeFor(period, date) {
  if (period === 'day') return [date, date];
  if (period === 'week') { const ws = weekStart(date); return [ws, addDays(ws, 6)]; }
  return [monthStart(date), monthEnd(date)];
}
const stat = (value, label) => h('div.stat', h('b', ltr(String(value))), h('span', label));
const ratio = (a, b) => (b ? `${a}/${b}` : `${a}`);

export function render(main, args, ctx) {
  const state = S();
  const period = PERIODS.some((p) => p.value === args[0]) ? args[0] : 'day';
  const date = isValidDate(args[1]) ? args[1] : ctx.date;
  const [from, to] = rangeFor(period, date);
  const r = periodReport(state, from, to, ctx.date);
  const label = periodLabel(period, from);
  const step = (n) => (period === 'day' ? addDays(date, n) : period === 'week' ? addDays(date, 7 * n) : addMonths(date, n));
  const inq = r.inquiries;
  const b = r.blocks;
  const drift = period === 'day' ? snapshotDrift(state, date) : null;
  const closed = state.dailyReports[date];
  main.replaceChildren(h('div.page',
    seg(PERIODS, period, (v) => { location.hash = `#/reports/${v}/${date}`; }, 'תקופה'),
    h('nav.datenav', iconBtn('right', 'התקופה הקודמת', () => { location.hash = `#/reports/${period}/${step(-1)}`; }), h('div.grow', label), iconBtn('left', 'התקופה הבאה', () => { location.hash = `#/reports/${period}/${step(1)}`; })),
    section('פניות', {},
      h('div.stats',
        stat(ratio(inq.completed, inq.targetFull), inq.targetFull ? `טופלו מול יעד (${pct(inq.completed, inq.targetFull)}%)` : 'טופלו (ללא יעד)'),
        inq.inProgress ? stat(ratio(inq.completedElapsed, inq.targetElapsed), 'עד היום מול היעד עד היום') : null,
        stat(inq.allocatedTomorrow, 'הוקצו למחר'), stat(inq.transferred, 'הועברו / הוסלמו'), stat(inq.other, 'טיפול אחר')),
      h('p.small', 'לפי סיווג: ', Object.entries(inq.completedByCategory).map(([k, v]) => `${INQUIRY_CATEGORY_LABEL[k]} ${v}`).join(' · ')),
      period !== 'day' ? h('details.more', h('summary', 'לפי ימים'), h('table.data', h('thead', h('tr', h('th', 'יום'), h('th', 'טופלו'), h('th', 'יעד'), h('th', 'נסגר'))),
        h('tbody', inq.days.filter((d) => d.isWorking || d.completed).map((d) => h('tr', h('td', fmtDayShort(d.date)), h('td', ltr(String(d.completed))), h('td', ltr(String(d.target)), d.targetSource === 'snapshot' ? ' *' : ''), h('td', d.closed ? '✓' : d.date <= ctx.date ? 'לא' : '')))))) : null),
    section('בלוקים', {},
      h('div.stats', stat(ratio(b.done, b.planned), 'הושלמו'), stat(b.partial, 'חלקית'), stat(b.skipped, 'דולגו'), stat(`${b.actualMinutes}`, 'דקות בפועל שהוזנו')),
      b.unknownActual ? h('p.small.muted', `ל־${b.unknownActual} בלוקים שסומנו לא הוזנו דקות בפועל – מוצג כ״לא ידוע״ ולא כאפס.`) : null),
    section('משימות', {},
      h('div.stats', stat(r.tasksCompleted.length, 'הושלמו בתקופה'), stat(r.tasksOpenAtEnd.length, 'פתוחות לסוף התקופה (שחזור)')),
      r.tasksCompleted.length ? h('details.more', h('summary', 'משימות שהושלמו'), h('ul', r.tasksCompleted.map((t) => h('li', t.title, ' · ', ltr(fmtDM(t.completedOn)))))) : null),
    section('צוות ומעקבים', {},
      h('div.stats', stat(r.questionsAnswered.length, 'שאלות שנענו'), stat(r.decisions.length, 'החלטות'), stat(r.meetings.length, 'פגישות'), stat(r.live.openQuestions, 'שאלות פתוחות (נכון לעכשיו)'), stat(r.live.waiting, 'ממתינים (נכון לעכשיו)'))),
    section('סגירת ימים', {},
      h('p', `${r.days.closed} מתוך ${r.days.workdays} ימי עבודה נסגרו.`),
      period === 'day' && closed?.snapshot ? h('p.small.muted', `נסגר${closed.partial ? ' חלקית' : ''}; יעד היום שנשמר: ${closed.snapshot.target}.`) : null,
      drift ? h('div.banner', ic('alert'), h('div.grow', 'הנתונים השתנו אחרי סגירת היום: ', drift.map((d) => `${d.field === 'completed' ? 'פניות' : d.field} – בסגירה ${d.snapshot}, עכשיו ${d.live}`).join(', '))) : null,
      r.days.notClosed.length && period !== 'day' ? h('p.small.muted', 'לא נסגרו: ', r.days.notClosed.map((d) => fmtDM(d)).join(', ')) : null),
    h('div.row.wrap',
      btn('העתקת סיכום', () => copyText(reportText(state, from, to, ctx.date, label)), 'soft', 'copy'),
      btn('הדפסה', () => printReport(label, reportText(state, from, to, ctx.date, label)), 'ghost', 'printer'),
      period === 'day' ? btn('תמונת סיכום', () => exportSummaryImage(date), 'ghost', 'image') : null,
      btn('משימות CSV', () => exportTasksCsv(), 'ghost', 'download'),
      btn('פניות CSV', () => exportInquiriesCsv(), 'ghost', 'download')),
    h('p.small.muted', PRIVACY_NOTE),
    h('details.more', h('summary', 'איך מחושבים הנתונים'), h('ul.small', r.notes.map((n) => h('li', n))), h('p.small.muted', '* יעד מתמונת סגירת היום.'))));
}

export function renderCounter(main, args, ctx) {
  const state = S();
  const date = isValidDate(args[0]) ? args[0] : ctx.date;
  const t = dayTotals(state, date);
  const tg = effectiveTarget(state, date);
  const events = eventsForDate(state, date).slice().reverse();
  const add = (p, msg) => run('addInquiry', { date, ...p }, { success: msg });
  const batch = async (kind = 'completed') => {
    const v = await promptText('כמה להוסיף?', { type: 'number', value: '2', attrs: { min: 1, max: 500, inputmode: 'numeric' } });
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1) return;
    const category = kind === 'completed' ? await choose('סיווג (לא חובה)', [{ value: 'unspecified', label: 'ללא סיווג' }, { value: 'simple', label: 'פשוטות' }, { value: 'complex', label: 'מורכבות' }]) : 'unspecified';
    if (!category) return;
    add({ kind, quantity: n, category }, `נוספו ${n}`);
  };
  main.replaceChildren(h('div.page',
    contextStrip(state, date),
    h('div.card.stack', { 'aria-live': 'polite' },
      h('div.counter-big', ltr(tg.target ? `${t.completed}/${tg.target}` : String(t.completed))),
      h('p.muted', { style: { textAlign: 'center' } }, tg.target ? (t.completed >= tg.target ? `היעד הושג${t.completed > tg.target ? ` (+${t.completed - tg.target})` : ''}` : `עוד ${tg.target - t.completed} ליעד`) : 'אין יעד לתאריך הזה',
        tg.source === 'snapshot' ? ' · יעד מתמונת הסגירה' : tg.source !== 'default' && tg.source !== 'off' ? ' · יעד מותאם ליום' : ''),
      h('div.counter-actions',
        btn('+1', () => add({}, 'נספרה פנייה'), 'primary', null, { 'aria-label': 'פנייה טופלה, הוספת 1' }),
        btn('+1 פשוטה', () => add({ category: 'simple' }, 'נספרה פנייה פשוטה'), 'soft'),
        btn('+1 מורכבת', () => add({ category: 'complex' }, 'נספרה פנייה מורכבת'), 'soft'),
        btn('הוספת כמות', () => batch(), 'ghost', 'plus'),
        btn('ביטול אחרון', () => run('undoInquiry', { date }, { success: 'הספירה האחרונה בוטלה', undo: false }), 'ghost', 'undo', { disabled: !t.completed }),
        btn('שינוי יעד ליום', async () => {
          const v = await promptText('יעד ליום הזה', { type: 'number', value: String(tg.target), attrs: { min: 0, max: 1000 } });
          if (v != null && v !== '') run('setDayOverride', { date, patch: { inquiryTarget: Number(v) } }, { success: 'היעד ליום עודכן' });
        }, 'ghost', 'edit'))),
    section('לא נספרות כפניות שטופלו', {},
      h('div.grid3',
        ['allocatedTomorrow', 'transferred', 'other'].map((k) => h('div.card.widget', h('div.label', INQUIRY_KIND_LABEL[k]), h('b', { style: { fontSize: '1.5rem' } }, ltr(String(t[k]))),
          h('div.row', btn('+1', () => add({ kind: k }, `${INQUIRY_KIND_LABEL[k]}: +1`), 'small soft', null, { 'aria-label': `${INQUIRY_KIND_LABEL[k]} – הוספת 1` }), iconBtn('undo', `ביטול ${INQUIRY_KIND_LABEL[k]}`, () => run('undoInquiry', { date, kind: k }, { success: 'בוטל', undo: false }))))))),
    h('p.small', 'סיווג היום: ', Object.entries(t.byCategory.completed).map(([k, v]) => `${INQUIRY_CATEGORY_LABEL[k]} ${v}`).join(' · '), ' · יעד ברירת מחדל: ', String(defaultTargetAt(state, date))),
    section('רישום היום', { count: events.length },
      events.length ? h('div.list', events.map((e) => h('div.item',
        h('div.body', h('div.title', `${INQUIRY_KIND_LABEL[e.kind]} · ${e.quantity > 0 ? '+' : ''}${e.quantity}`), h('div.meta', INQUIRY_CATEGORY_LABEL[e.category], ' · ', ltr(new Date(e.at).toLocaleTimeString('he-IL', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit' })), e.correctsId ? ' · תיקון' : '')),
        e.quantity > 0 && remainingOf(state, e.id) > 0 ? btn('תיקון', async () => {
          const v = await promptText('כמה להפחית?', { type: 'number', value: String(remainingOf(state, e.id)), attrs: { min: 1, max: remainingOf(state, e.id) } });
          if (v) run('correctInquiry', { eventId: e.id, quantity: Number(v) }, { success: 'הספירה תוקנה' });
        }, 'small ghost') : null))) : empty('עדיין לא נספרו פניות היום', 'headset'),
      h('p.muted.small', 'זהו מונה מצטבר בלבד – בלי פרטי פונים, מספרי תיקים או תוכן פניות.')),
    h('div.row.wrap', h('a.btn.ghost', { href: `#/reports/week/${date}` }, 'סיכום שבועי'), h('a.btn.ghost', { href: '#/tools/inquiries' }, 'היסטוריית פניות'),
      h('a.btn.ghost', { href: `#/counter/${addDays(date, -1)}` }, 'יום קודם'), date !== ctx.date ? h('a.btn.ghost', { href: `#/counter/${ctx.date}` }, 'להיום') : null),
    h('p.small.muted', fmtDayDate(date))));
}
