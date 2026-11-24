// מצב ריכוז, סגירת יום, חיפוש והתראות.
import { h, ic, ltr, btn, section, empty, input, check, textarea } from '../ui.js';
import { S, run } from '../app.js';
import { hm, fmtDayDate, fmtDM, isValidDate } from '../dates.js';
import { effectiveDay, closingWindow } from '../engine/dayTemplates.js';
import { currentAndNext } from '../engine/schedule.js';
import { carriedTasks, todaysTasks } from '../engine/taskCarryover.js';
import { dayTotals, effectiveTarget } from '../engine/inquiries.js';
import { closingSummary } from '../engine/dayClosing.js';
import { globalSearch } from '../engine/search.js';
import { computeAlerts } from '../engine/conflicts.js';
import { taskList } from './common.js';
import { openTaskEditor, openQuestionEditor, openFaqEditor, openNoteEditor, openIssueEditor } from '../editors.js';
import { rolesForTask } from '../engine/planner.js';

export function renderFocus(main, args, ctx) {
  const state = S();
  const { date, minute } = ctx;
  const cn = currentAndNext(state, date, minute);
  const o = cn.current;
  if (!o) {
    main.replaceChildren(h('div.page.focus',
      h('h1', 'מצב ריכוז'),
      h('div.card.stack', h('p', cn.phase === 'before' ? 'יום העבודה עוד לא התחיל.' : cn.phase === 'after' ? 'יום העבודה הסתיים.' : cn.phase === 'off' ? 'היום אינו יום עבודה.' : 'אין פעילות מתוכננת עכשיו.'),
        cn.next ? h('p', 'הפעילות הבאה: ', h('b', cn.next.title), ' בשעה ', ltr(cn.next.start), ' (בעוד ', ltr(hm(cn.untilNext)), ')') : null),
      h('a.btn', { href: '#/home' }, 'חזרה להיום שלי')));
    return;
  }
  const isInquiries = o.role === 'inquiries' || o.role === 'followup' || o.categoryId === 'inquiries';
  const assigned = o.taskIds.map((id) => state.tasks.find((t) => t.id === id)).filter((t) => t && t.status !== 'canceled');
  const related = [...carriedTasks(state, date).map((x) => x.task), ...todaysTasks(state, date)]
    .filter((t) => t.status !== 'done' && !o.taskIds.includes(t.id) && o.role && rolesForTask(state, t).includes(o.role)).slice(0, 8);
  const t = dayTotals(state, date), tg = effectiveTarget(state, date);
  const eff = effectiveDay(state, date);
  main.replaceChildren(h('div.page.focus',
    h('div.row.between', h('h1', o.title), h('a.btn.ghost.small', { href: '#/home' }, 'יציאה')),
    h('div.card.activity.stack', { 'aria-live': 'polite' },
      h('div.muted', ltr(`${o.start}–${o.end}`), cn.overlapping.length ? h('span.chip.warn', ' חפיפה עם פעילות נוספת') : null),
      h('div.big-time', ltr(hm(cn.remaining))), h('p.muted', { style: { textAlign: 'center' } }, 'נותרו בפעילות הזו'),
      cn.next ? h('p.small', 'הבא: ', cn.next.title, ' · ', ltr(cn.next.start)) : null),
    o.instructions?.length ? h('ul.guidance', o.instructions.map((x) => h('li', x)), o.role === 'inquiries' ? h('li', eff.phoneDuty ? 'היום יש תורנות טלפון – פניות פשוטות בעזרת התשובות הנפוצות' : 'היום אין תורנות – זמן לפניות מורכבות שדורשות בירור') : null) : null,
    h('p.muted.small', 'האפליקציה לא חוסמת אפליקציות אחרות ולא משנה מצב ״נא לא להפריע״. תורנות ודחיפויות קודמות להנחיות.'),
    isInquiries ? h('div.card.row.between', h('div', h('div.muted.small', 'פניות היום'), h('b', { style: { fontSize: '1.5rem' } }, ltr(tg.target ? `${t.completed}/${tg.target}` : String(t.completed)))),
      btn('+1 פנייה', () => run('addInquiry', { date }, { success: 'נספרה פנייה' }), 'primary', null, { 'aria-label': 'פנייה טופלה, הוספת 1' }), h('a.btn.ghost.small', { href: `#/counter/${date}` }, 'מונה מלא')) : null,
    section('משימות בפעילות הזו', { count: assigned.length }, taskList(assigned, { date, emptyText: 'אין משימות משויכות' })),
    related.length ? section('משימות מתאימות לבלוק', {}, taskList(related, { date })) : null,
    h('div.row.wrap',
      o.kind !== 'meeting' ? btn('סיום הפעילות', () => run('setBlockStatus', { occId: o.id, status: 'done' }, { success: 'הפעילות הושלמה' }).then((r) => { if (r) location.hash = '#/home'; }), 'primary', 'check') : null,
      o.kind !== 'meeting' ? btn('הושלמה חלקית', () => run('setBlockStatus', { occId: o.id, status: 'partial' }, { success: 'סומנה כחלקית' }), 'soft') : null,
      btn('משימה', () => openTaskEditor(null, { date, defaults: { scheduledDate: date }, onSaved: (id) => run('assignTaskToBlock', { taskId: id, occId: o.id }) }), 'ghost', 'plus'),
      o.role === 'teamReception' || o.kind === 'meeting' ? btn('שאלה', () => openQuestionEditor(), 'ghost', 'question') : null)));
}

export function renderClosing(main, args, ctx) {
  const state = S();
  const date = isValidDate(args[0]) ? args[0] : ctx.date;
  const s = closingSummary(state, date);
  const report = state.dailyReports[date];
  const cw = closingWindow(state, date);
  const items = state.settings.closingChecklist;
  const values = {};
  const checks = items.map((i) => check(i.label, report?.checklist?.[i.id] ?? false, (v) => { values[i.id] = v; }));
  items.forEach((i) => { values[i.id] = report?.checklist?.[i.id] ?? false; });
  const note = textarea(report?.note || state.dayNotes[date]?.accomplishments || '', { maxlength: 5000, 'aria-label': 'מה הצלחתי היום / הערה', placeholder: 'מה הצלחתי היום, מה נשאר פתוח (לא חובה)' });
  const open = [...s.tasks.openCarried, ...s.tasks.openToday];
  main.replaceChildren(h('div.page',
    h('h1', 'סגירת יום'), h('p.muted', fmtDayDate(date), cw ? h('span', ' · חלון הסגירה ', ltr(`${cw.start}–${cw.end}`)) : ' · לא יום עבודה'),
    report?.closedAt ? h('div.banner.info', ic('checkCircle'), h('div.grow', `היום נסגר${report.partial ? ' חלקית' : ''}. אפשר לעדכן ולסגור מחדש, או לפתוח אותו מחדש.`,
      h('div.banner-actions', btn('פתיחה מחדש', () => run('reopenDay', { date }, { success: 'היום נפתח מחדש' }), 'small soft')))) : null,
    !report?.closedAt && report?.reopenedAt ? h('div.banner', 'היום נפתח מחדש. תמונת הסגירה הקודמת נשמרה לצורך ההיסטוריה.') : null,
    h('div.stats',
      h('div.stat', h('b', ltr(s.inquiries.target ? `${s.inquiries.completed}/${s.inquiries.target}` : String(s.inquiries.completed))), h('span', 'פניות שטופלו')),
      h('div.stat', h('b', ltr(String(s.inquiries.allocatedTomorrow))), h('span', 'הוקצו למחר')),
      h('div.stat', h('b', ltr(`${s.blocks.done}/${s.blocks.total}`)), h('span', `בלוקים הושלמו${s.blocks.partial ? ` · ${s.blocks.partial} חלקית` : ''}`)),
      h('div.stat', h('b', ltr(String(s.tasks.completedToday.length))), h('span', 'משימות הושלמו')),
      h('div.stat', h('b', ltr(String(open.length))), h('span', 'משימות פתוחות'))),
    h('div.row.wrap', btn('+1 הוקצתה למחר', () => run('addInquiry', { date, kind: 'allocatedTomorrow' }, { success: 'נרשמה הקצאה למחר' }), 'soft', 'plus'), h('a.btn.ghost', { href: `#/counter/${date}` }, 'מונה פניות')),
    section('רשימת סגירה', {}, h('div.card.stack', checks)),
    section('עבודה פתוחה', { count: open.length }, taskList(open, { date, emptyText: 'אין משימות פתוחות' }), open.length ? h('p.small.muted', 'משימות פתוחות יופיעו אוטומטית ב״משימות שלא הסתיימו עד היום״ ביום העבודה הבא – גם בלי סגירה.') : null),
    s.waitingQuestions.length ? section('שאלות שעדיין פתוחות', { count: s.waitingQuestions.length }, h('ul', s.waitingQuestions.slice(0, 10).map((q) => h('li', q.title)))) : null,
    s.tomorrow ? section(`מחר · ${fmtDayDate(s.tomorrow.date)}`, {},
      h('p', s.tomorrow.eff.isWorking ? `${s.tomorrow.eff.location === 'home' ? 'מהבית' : 'במשרד'} · ${s.tomorrow.eff.workStart}–${s.tomorrow.eff.workEnd}${s.tomorrow.eff.phoneDuty ? ' · תורנות טלפון' : ''}` : ''),
      h('p.small', `${s.tomorrow.tasks.length} משימות מתוכננות · ${s.tomorrow.meetings.length} פגישות`),
      h('div.row.wrap', h('a.btn.ghost.small', { href: `#/agenda/${s.tomorrow.date}` }, 'סדר היום של מחר'),
        btn('תמונה של מחר', async () => (await import('../export/exportUi.js')).exportDayImage(s.tomorrow.date), 'small ghost', 'image'))) : null,
    section('מה הצלחתי היום', {}, note),
    btn(report?.closedAt ? 'עדכון הסגירה' : 'סגירת היום', async () => {
      const r = await run('closeDay', { date, checklist: values, note: note.value }, { success: 'היום נסגר. משימות פתוחות יעברו ליום העבודה הבא.' });
      if (r) location.hash = '#/home';
    }, 'primary block', 'checkCircle')));
}

export function renderSearch(main, args) {
  const state = S();
  const q = input('search', decodeURIComponent(args[0] || ''), { placeholder: 'חיפוש במשימות, שאלות, פגישות, תשובות, רשומות ותקלות', 'aria-label': 'חיפוש', autofocus: true });
  const out = h('div.stack', { 'aria-live': 'polite' });
  const LABEL = { task: 'משימה', question: 'שאלה', meeting: 'פגישה', decision: 'החלטה', faq: 'תשובה נפוצה', note: 'רשומה', issue: 'תקלה', block: 'פעילות' };
  const ICON = { task: 'squareCheck', question: 'question', meeting: 'users', decision: 'checkCircle', faq: 'book', note: 'note', issue: 'alert', block: 'calendar' };
  const open = (r) => {
    if (r.type === 'task') openTaskEditor(state.tasks.find((t) => t.id === r.id));
    else if (r.type === 'question') openQuestionEditor(state.questions.find((x) => x.id === r.id));
    else if (r.type === 'meeting') location.hash = `#/meeting/${r.id}`;
    else if (r.type === 'decision') location.hash = r.ref.meetingId ? `#/meeting/${r.ref.meetingId}` : '#/team/answers';
    else if (r.type === 'faq') openFaqEditor(state.faqEntries.find((x) => x.id === r.id));
    else if (r.type === 'note') openNoteEditor(state.workNotes.find((x) => x.id === r.id));
    else if (r.type === 'issue') openIssueEditor(state.issueLogs.find((x) => x.id === r.id));
    else if (r.type === 'block') location.hash = `#/agenda/${r.date}`;
  };
  const draw = () => {
    const res = globalSearch(state, q.value);
    out.replaceChildren(q.value.trim() ? (res.length ? h('div.list', res.map((r) => h('button.item', { type: 'button', onclick: () => open(r), style: { width: '100%', border: 0, background: 'none', textAlign: 'start', cursor: 'pointer' } },
      ic(ICON[r.type], 20), h('div.body', h('div.title', r.title), h('div.meta', LABEL[r.type], r.date ? h('span', ' · ', ltr(fmtDM(r.date))) : null))))) : empty('לא נמצאו תוצאות', 'search')) : h('p.muted', 'החיפוש מקומי בלבד, במכשיר.'));
  };
  q.addEventListener('input', () => { history.replaceState(null, '', `#/search/${encodeURIComponent(q.value)}`); draw(); });
  draw();
  main.replaceChildren(h('div.page', q, out));
  setTimeout(() => q.focus(), 30);
}

export function renderAlerts(main, args, ctx) {
  const state = S();
  const alerts = computeAlerts(state, ctx.date, { minute: ctx.minute, nowIso: ctx.nowIso });
  main.replaceChildren(h('div.page',
    h('h1', 'התראות'),
    h('p.muted.small', 'ההתראות מחושבות במכשיר בזמן השימוש. אין שליחה מחוץ למכשיר ואין הרצה ברקע כשהאפליקציה סגורה.'),
    alerts.length ? h('div.list', alerts.map((a) => h('div.item', ic(a.level === 'info' ? 'bell' : 'alert', 20),
      h('div.body', h('a', { href: a.route, style: { color: 'inherit', textDecoration: 'none' } }, h('div.title', a.title), h('div.meta', a.detail))),
      btn('הסתרה להיום', () => run('dismissAlert', { key: a.key, date: ctx.date }, { silent: true }), 'small ghost')))) : empty('אין התראות פעילות')));
}

