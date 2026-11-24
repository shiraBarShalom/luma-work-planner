// צוות וישיבות, שאלות ממתינות, and meeting detail. Questions are one canonical record
// shared by all of these screens; agendas reference them by ID.
import { h, ic, ltr, btn, iconBtn, seg, section, empty, input, choose, confirmDialog } from '../ui.js';
import { S, run } from '../app.js';
import { fmtDM, fmtDayDate } from '../dates.js';
import { AUDIENCE_LABEL, QUESTION_STATUS_LABEL, MEETING_TYPE_LABEL, MEETING_STATUS_LABEL, PRIORITY_LABEL } from '../data/schema.js';
import { agendaQueue, upcomingMeetings, pastMeetings, meetingAgenda, meetingDecisions, faqCandidates, searchFaq, followUpTasks, agendaText, questionSort } from '../engine/team.js';
import { meetingTimes } from '../engine/schedule.js';
import { openQuestionEditor, openMeetingEditor, openDecisionEditor, answerQuestion, promoteToFaq, openFaqEditor } from '../editors.js';
import { taskList } from './common.js';
import { copyText } from '../export/share.js';
import { exportFaqCsv, exportFaqJson } from '../export/exportUi.js';

const TABS = [
  ['questions', 'שאלות לישיבה'], ['topics', 'נושאים לדיון'], ['answers', 'תשובות והחלטות'], ['followups', 'משימות המשך'], ['meetings', 'פגישות'], ['faq', 'תשובות נפוצות'],
];

export function questionCard(q) {
  const state = S();
  const meetings = state.meetings.filter((m) => (m.agenda || []).includes(q.id) && m.status === 'planned');
  const context = meetings.length ? `לפגישה: ${meetings[0].title}${meetings[0].date ? ' · ' + fmtDM(meetings[0].date) : ''}` : (q.status === 'open' || q.status === 'waiting') ? 'בתור לשעת הקבלה / לפגישה הבאה' : '';
  return h('div.item', { dataset: { questionId: q.id } },
    ic(q.kind === 'topic' ? 'flag' : 'question', 22),
    h('div.body', h('button.link', { type: 'button', onclick: () => openQuestionEditor(q) },
      h('div.title', q.title),
      h('div.meta', h('span.chip', AUDIENCE_LABEL[q.audience]), h('span.chip' + (q.status === 'answered' ? '.ok' : q.status === 'waiting' ? '.warn' : ''), QUESTION_STATUS_LABEL[q.status]),
        q.priority === 'high' ? h('span.chip.danger', 'דחוף') : null, h('span', ltr(fmtDM(q.createdDate))), context ? h('span', context) : null),
      q.answer ? h('div.small', 'תשובה: ', q.answer) : null)),
    q.status === 'open' || q.status === 'waiting'
      ? btn('תשובה', () => answerQuestion(q), 'small soft')
      : iconBtn('undo', `פתיחה מחדש של ${q.title}`, () => run('setQuestionStatus', { id: q.id, status: 'open' }, { success: 'נפתחה מחדש' })));
}

function meetingRow(m) {
  const t = meetingTimes(m);
  return h('a.item', { href: `#/meeting/${m.id}`, style: { color: 'inherit', textDecoration: 'none' } },
    ic('users', 22),
    h('div.body', h('div.title', m.title), h('div.meta', h('span.chip', MEETING_TYPE_LABEL[m.meetingType]), m.date ? h('span', fmtDayDate(m.date)) : h('span.chip.warn', 'ללא מועד'), t ? ltr(`${t.start}–${t.end}`) : m.start ? h('span.chip.warn', 'חסר משך') : null,
      m.status !== 'planned' ? h('span.chip', MEETING_STATUS_LABEL[m.status]) : null, h('span', `${(m.agenda || []).length} נושאים`))),
    ic('left', 18));
}

export function render(main, args, ctx) {
  const state = S();
  const tab = TABS.some((t) => t[0] === args[0]) ? args[0] : 'questions';
  const date = ctx.date;
  let content;
  if (tab === 'questions' || tab === 'topics') {
    const kind = tab === 'questions' ? 'question' : 'topic';
    const open = agendaQueue(state, date).filter((q) => (q.kind || 'question') === kind);
    const linked = state.questions.filter((q) => (q.kind || 'question') === kind && (q.status === 'open' || q.status === 'waiting') && !open.includes(q)).sort(questionSort);
    const team = open.filter((q) => q.audience === 'team'), mgr = open.filter((q) => q.audience === 'manager');
    const archived = state.questions.filter((q) => (q.kind || 'question') === kind && q.status === 'archived');
    content = [
      btn(kind === 'topic' ? 'הוספת נושא לדיון' : 'הוספת שאלה לישיבה', () => openQuestionEditor(null, { defaults: { kind, audience: kind === 'topic' ? 'manager' : 'team' } }), 'primary block', 'plus'),
      section('מהצוות / לצוות', { count: team.length }, team.length ? h('div.list', team.map(questionCard)) : empty('אין שאלות פתוחות בתור')),
      section('למנהל', { count: mgr.length }, mgr.length ? h('div.list', mgr.map(questionCard)) : empty('אין נושאים פתוחים למנהל')),
      linked.length ? section('משויכות לפגישה קרובה', { count: linked.length }, h('div.list', linked.map(questionCard))) : null,
      h('details.more', h('summary', `ארכיון (${archived.length})`), archived.length ? h('div.list', archived.map(questionCard)) : empty('הארכיון ריק')),
    ];
  } else if (tab === 'answers') {
    const answered = state.questions.filter((q) => q.status === 'answered').sort((a, b) => String(b.answeredOn).localeCompare(String(a.answeredOn)));
    const cands = faqCandidates(state);
    const decisions = state.meetingDecisions.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    content = [
      cands.length ? h('div.banner.info', ic('book'), h('div.grow', `${cands.length} שאלות חוזרות שנענו – אפשר להעביר לתשובות הנפוצות`, h('div.banner-actions', cands.slice(0, 3).map((q) => btn(q.title.slice(0, 30), () => promoteToFaq(q), 'small soft'))))) : null,
      section('החלטות', { count: decisions.length }, decisions.length ? h('div.list', decisions.map((d) => {
        const m = state.meetings.find((x) => x.id === d.meetingId);
        const t = d.taskId && state.tasks.find((x) => x.id === d.taskId);
        return h('div.item', ic('checkCircle', 20), h('div.body', h('div.title', d.text), h('div.meta', m ? h('a', { href: `#/meeting/${m.id}` }, m.title) : 'ללא פגישה', d.owner ? ` · ${d.owner}` : '', t ? ` · משימה: ${t.title}` : '')),
          !t ? btn('משימת המשך', () => run('decisionToTask', { decisionId: d.id }, { success: 'נוצרה משימת המשך' }), 'small soft') : null);
      })) : empty('עדיין לא נרשמו החלטות')),
      section('שאלות שנענו', { count: answered.length }, answered.length ? h('div.list', answered.map(questionCard)) : empty('אין עדיין שאלות שנענו')),
    ];
  } else if (tab === 'followups') {
    const tasks = followUpTasks(state).filter((t) => t.status !== 'canceled');
    content = [section('משימות המשך מהחלטות ושאלות', { count: tasks.filter((t) => t.status !== 'done').length }, taskList(tasks, { date, emptyText: 'אין משימות המשך' }))];
  } else if (tab === 'meetings') {
    const up = upcomingMeetings(state, date), past = pastMeetings(state, date);
    content = [
      btn('פגישה חדשה', () => openMeetingEditor(null, { date }), 'primary block', 'plus'),
      h('p.muted.small', 'ישיבות נוספות רק כשהן נקבעות בפועל. שאלות פתוחות נשארות בתור גם בלי פגישה מתוכננת.'),
      section('קרובות', { count: up.length }, up.length ? h('div.list', up.map(meetingRow)) : empty('אין פגישות מתוכננות')),
      section('קודמות', { count: past.length }, past.length ? h('div.list', past.slice(0, 50).map(meetingRow)) : empty('אין פגישות קודמות')),
    ];
  } else {
    const q = input('search', '', { placeholder: 'חיפוש בתשובות הנפוצות', 'aria-label': 'חיפוש בתשובות הנפוצות' });
    const list = h('div.stack');
    const draw = () => {
      const items = searchFaq(state, q.value, { includeArchived: false });
      list.replaceChildren(items.length ? h('div.list', items.map((f) => h('div.item', ic('book', 20),
        h('div.body', h('button.link', { type: 'button', onclick: () => openFaqEditor(f) }, h('div.title', f.title), h('div.small', f.answer.slice(0, 160)), f.keywords.length ? h('div.meta', f.keywords.map((k) => h('span.chip', k))) : null)),
        iconBtn('copy', `העתקת התשובה ${f.title}`, () => copyText(f.answer))))) : empty(q.value ? 'לא נמצאו תשובות' : 'אין עדיין תשובות נפוצות'));
    };
    q.addEventListener('input', draw);
    draw();
    const archived = state.faqEntries.filter((f) => f.archived);
    content = [
      h('div.row.wrap', btn('תשובה חדשה', () => openFaqEditor(), 'primary', 'plus'), btn('ייצוא CSV', () => exportFaqCsv(), 'ghost', 'download'), btn('ייצוא JSON', () => exportFaqJson(), 'ghost', 'download')),
      q, list,
      archived.length ? h('details.more', h('summary', `בארכיון (${archived.length})`), h('div.list', archived.map((f) => h('button.item', { type: 'button', onclick: () => openFaqEditor(f), style: { width: '100%', border: 0, background: 'none', textAlign: 'start' } }, h('div.body', h('div.title', f.title)))))) : null,
    ];
  }
  main.replaceChildren(h('div.page',
    h('div.filters', { role: 'tablist', 'aria-label': 'אזורי צוות' }, TABS.map(([v, l]) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(tab === v), 'aria-pressed': String(tab === v), onclick: () => { location.hash = `#/team/${v}`; } }, l))),
    content));
}

const QFILTERS = [{ value: 'all', label: 'הכול' }, { value: 'meeting', label: 'לישיבה' }, { value: 'progress', label: 'בטיפול' }, { value: 'done', label: 'טופל' }];

export function renderQuestions(main, args, ctx) {
  const state = S();
  const f = QFILTERS.some((x) => x.value === args[0]) ? args[0] : 'all';
  const aud = args[1] === 'team' || args[1] === 'manager' ? args[1] : '';
  const list = state.questions.filter((q) => {
    if (aud && q.audience !== aud) return false;
    if (f === 'all') return q.status !== 'archived';
    if (f === 'meeting') return q.status === 'open';
    if (f === 'progress') return q.status === 'waiting';
    return q.status === 'answered';
  }).sort((a, b) => (a.status === 'answered') - (b.status === 'answered') || questionSort(a, b));
  main.replaceChildren(h('div.page',
    btn('הוספת שאלה', () => openQuestionEditor(null, { defaults: { audience: aud || 'team' } }), 'primary block', 'plus'),
    seg(QFILTERS, f, (v) => { location.hash = `#/questions/${v}${aud ? '/' + aud : ''}`; }, 'סינון שאלות'),
    h('div.filters', { role: 'group', 'aria-label': 'קהל' }, [['', 'כולם'], ['team', 'צוות'], ['manager', 'מנהל']].map(([v, l]) => h('button', { type: 'button', 'aria-pressed': String(aud === v), onclick: () => { location.hash = `#/questions/${f}${v ? '/' + v : ''}`; } }, l))),
    list.length ? h('div.list', list.map(questionCard)) : empty(f === 'done' ? 'אין שאלות שטופלו' : 'אין שאלות ממתינות'),
    h('p.muted.small', 'סימון ״בטיפול״ אינו סוגר שאלה. שאלה נסגרת רק עם רישום תשובה או העברה לארכיון.'),
    h('a.btn.ghost', { href: '#/team/questions' }, 'לצוות וישיבות')));
}

export function renderMeeting(main, args) {
  const state = S();
  const m = state.meetings.find((x) => x.id === args[0]);
  if (!m) { main.replaceChildren(h('div.page', empty('הפגישה לא נמצאה'), h('a.btn', { href: '#/team/meetings' }, 'לפגישות'))); return; }
  const t = meetingTimes(m);
  const agenda = meetingAgenda(state, m);
  const decisions = meetingDecisions(state, m.id);
  const queue = agendaQueue(state, '0000-01-01').filter((q) => !(m.agenda || []).includes(q.id) && (m.meetingType === 'other' || q.audience === (m.meetingType === 'manager' ? 'manager' : 'team')));
  main.replaceChildren(h('div.page',
    h('div.card.stack',
      h('h1', m.title),
      h('div.row.wrap', h('span.chip', MEETING_TYPE_LABEL[m.meetingType]), h('span.chip', MEETING_STATUS_LABEL[m.status]), m.date ? h('span', fmtDayDate(m.date)) : h('span.chip.warn', 'ללא מועד'), t ? ltr(`${t.start}–${t.end}`) : m.start ? h('span.chip.warn', 'חסר משך – יש להשלים כדי לשבץ ביומן') : null),
      m.location ? h('p', m.location) : null, m.notes ? h('p.small', m.notes) : null,
      h('div.row.wrap',
        btn('עריכה', () => openMeetingEditor(m), 'small soft', 'edit'),
        m.status === 'planned' ? btn('סימון שהתקיימה', () => run('setMeetingStatus', { id: m.id, status: 'held' }, { success: 'סומנה כהתקיימה' }), 'small soft', 'check') : btn('החזרה למתוכננת', () => run('setMeetingStatus', { id: m.id, status: 'planned' }), 'small ghost', 'undo'),
        m.status !== 'canceled' ? btn('ביטול הפגישה', async () => { if (await confirmDialog('לבטל את הפגישה? הזמן ביומן ישתחרר; השאלות וההחלטות נשמרות.', { ok: 'ביטול הפגישה', danger: true })) run('setMeetingStatus', { id: m.id, status: 'canceled' }, { success: 'הפגישה בוטלה' }); }, 'small ghost', 'x') : null,
        btn('העתקת סדר היום', () => copyText(agendaText(state, m, { fmtDate: fmtDayDate })), 'small ghost', 'copy'))),
    section('סדר היום', { count: agenda.length, action: queue.length ? btn('הוספה מהתור', async () => {
      const v = await choose('הוספת שאלה לסדר היום', queue.map((q) => ({ value: q.id, label: q.title, sub: `${AUDIENCE_LABEL[q.audience]} · ${PRIORITY_LABEL[q.priority]}` })));
      if (v) run('linkQuestion', { meetingId: m.id, questionId: v }, { success: 'נוספה לסדר היום' });
    }, 'small soft', 'plus') : null },
    agenda.length ? h('div.list', agenda.map((q) => {
      const row = questionCard(q);
      row.append(iconBtn('x', `הסרת ${q.title} מסדר היום`, () => run('linkQuestion', { meetingId: m.id, questionId: q.id, unlink: true }, { success: 'הוסרה מסדר היום (השאלה נשמרת)' })));
      return row;
    })) : empty('אין נושאים בסדר היום'),
    btn('שאלה חדשה לפגישה', () => openQuestionEditor(null, { defaults: { meetingId: m.id, audience: m.meetingType === 'manager' ? 'manager' : 'team' } }), 'small ghost', 'plus')),
    section('החלטות', { count: decisions.length, action: btn('רישום החלטה', () => openDecisionEditor(m.id), 'small soft', 'plus') },
      decisions.length ? h('div.list', decisions.map((d) => {
        const task = d.taskId && state.tasks.find((x) => x.id === d.taskId);
        return h('div.item', ic('checkCircle', 20), h('div.body', h('div.title', d.text), h('div.meta', d.owner || '', task ? h('a', { href: `#/task/${task.id}` }, `משימה: ${task.title}`) : '')),
          !task ? btn('משימת המשך', () => run('decisionToTask', { decisionId: d.id }, { success: 'נוצרה משימת המשך' }), 'small soft') : null,
          iconBtn('trash', `מחיקת ההחלטה`, async () => { if (await confirmDialog('למחוק את ההחלטה?', { danger: true, ok: 'מחיקה' })) run('updateDecision', { id: d.id, remove: true }, { success: 'ההחלטה נמחקה' }); }));
      })) : empty('לא נרשמו החלטות')),
    h('a.btn.ghost', { href: '#/team/meetings' }, 'לכל הפגישות')));
}
