// כלי עבודה – waiting/follow-up center, issue log, work notebook, inquiry history.
import { h, ic, ltr, btn, section, empty, input, select } from '../ui.js';
import { S, run } from '../app.js';
import { addDays, fmtDayShort, fmtDM } from '../dates.js';
import { ISSUE_STATUS_LABEL, REPORTED_TO_LABEL } from '../data/schema.js';
import { waitingCenter, sortedIssues, issueSummary, sortedNotes } from '../engine/workTools.js';
import { periodSummary } from '../engine/inquiries.js';
import { normalize } from '../engine/search.js';
import { openIssueEditor, openNoteEditor, openQuestionEditor, openTaskEditor } from '../editors.js';
import { exportInquiriesCsv } from '../export/exportUi.js';
import { catChip } from './common.js';

const TABS = [['waiting', 'ממתינים ומעקבים'], ['issues', 'יומן תקלות'], ['notes', 'מחברת עבודה'], ['inquiries', 'היסטוריית פניות']];

function waitingView(state, date) {
  const items = waitingCenter(state, date);
  const open = (w) => {
    if (w.type === 'task') openTaskEditor(state.tasks.find((t) => t.id === w.id));
    else if (w.type === 'question') openQuestionEditor(state.questions.find((q) => q.id === w.id));
    else openIssueEditor(state.issueLogs.find((i) => i.id === w.id));
  };
  const quick = (w) => {
    if (w.type === 'task') return btn('חזרה לביצוע', () => run('setTaskStatus', { id: w.id, status: 'todo' }, { success: 'המשימה חזרה לרשימה' }), 'small soft');
    if (w.type === 'question') return btn('נענתה', () => open(w), 'small soft');
    return btn('נפתרה', () => run('updateIssue', { id: w.id, patch: { status: 'resolved' } }, { success: 'התקלה סומנה כנפתרה' }), 'small soft');
  };
  return section('ממתינים ומעקבים', { count: items.length },
    items.length ? h('div.list', items.map((w) => h('div.item',
      ic(w.type === 'task' ? 'squareCheck' : w.type === 'question' ? 'question' : 'alert', 20),
      h('div.body', h('button.link', { type: 'button', onclick: () => open(w) }, h('div.title', w.title),
        h('div.meta', h('span.chip', { task: 'משימה', question: 'שאלה', issue: 'תקלה' }[w.type]), w.followUpOn ? h('span' + (w.due ? '.chip.warn' : ''), 'מעקב ', ltr(fmtDM(w.followUpOn))) : h('span', 'ללא מועד מעקב'), w.note ? h('span', w.note) : null))),
      quick(w)))) : empty('אין פריטים ממתינים'));
}

function issuesView(state) {
  const items = sortedIssues(state);
  return section('יומן תקלות', { count: items.filter((i) => i.status !== 'resolved').length, action: btn('תקלה חדשה', () => openIssueEditor(), 'small soft', 'plus') },
    h('p.muted.small', 'תיעוד מקומי של תקלות חוזרות (למשל בסנכרון) לצורך הסלמה למנהל או ל־IT. לא נפתחת פנייה חיצונית.'),
    items.length ? h('div.list', items.map((i) => {
      const s = issueSummary(i);
      return h('div.item', ic('alert', 20),
        h('div.body', h('button.link', { type: 'button', onclick: () => openIssueEditor(i) }, h('div.title', i.title),
          h('div.meta', h('span.chip' + (i.status === 'resolved' ? '.ok' : ''), ISSUE_STATUS_LABEL[i.status]), i.reportedTo ? h('span', 'דווח ל', REPORTED_TO_LABEL[i.reportedTo]) : null,
            h('span', `${s.count} הופעות`), s.first ? h('span', ltr(fmtDM(s.first)), ' – ', ltr(fmtDM(s.last))) : null, i.categoryId ? catChip(state, i.categoryId) : null))),
        i.status !== 'resolved' ? btn('+ הופעה', () => run('addIssueOccurrence', { id: i.id }, { success: 'נרשמה הופעה' }), 'small soft') : null);
    })) : empty('לא נרשמו תקלות'));
}

function notesView(state) {
  const q = input('search', '', { placeholder: 'חיפוש במחברת', 'aria-label': 'חיפוש במחברת' });
  const cat = select([{ value: '', label: 'כל הקטגוריות' }, ...state.settings.categories.map((c) => ({ value: c.id, label: c.label }))], '', { 'aria-label': 'קטגוריה' });
  const showArch = input('checkbox', '', { 'aria-label': 'הצגת ארכיון' });
  const list = h('div.stack');
  const draw = () => {
    const n = normalize(q.value);
    const notes = sortedNotes(state, { includeArchived: showArch.checked, categoryId: cat.value || null }).filter((x) => !n || normalize(`${x.title} ${x.body}`).includes(n));
    list.replaceChildren(notes.length ? h('div.list', notes.map((x) => h('button.item', { type: 'button', onclick: () => openNoteEditor(x), style: { width: '100%', border: 0, background: 'none', textAlign: 'start', cursor: 'pointer' } },
      ic(x.pinned ? 'pin' : 'note', 20), h('div.body', h('div.title', x.title || x.body.split('\n')[0].slice(0, 80)), h('div.meta', x.title ? x.body.slice(0, 100) : '', x.archived ? ' · בארכיון' : '', x.taskId ? ' · הומרה למשימה' : ''))))) : empty(n ? 'לא נמצאו רשומות' : 'המחברת ריקה'));
  };
  q.addEventListener('input', draw); cat.addEventListener('change', draw); showArch.addEventListener('change', draw);
  draw();
  return section('מחברת עבודה', { action: btn('רשומה חדשה', () => openNoteEditor(), 'small soft', 'plus') },
    h('div.grid2', q, cat), h('label.check', showArch, h('span', 'להציג גם רשומות בארכיון')), list,
    h('p.muted.small', 'טקסט פשוט בלבד. בלי פרטים מזהים של פונים, מספרי תיקים או מידע ארגוני רגיש.'));
}

function inquiriesView(state, date) {
  const from = addDays(date, -59);
  const s = periodSummary(state, from, date, date);
  const days = s.days.filter((d) => d.isWorking || d.completed || d.allocatedTomorrow || d.transferred || d.other).reverse();
  return section('היסטוריית פניות · 60 ימים אחרונים', { action: btn('CSV', () => exportInquiriesCsv(), 'small ghost', 'download') },
    h('div.stats', h('div.stat', h('b', ltr(String(s.completed))), h('span', 'טופלו')), h('div.stat', h('b', ltr(String(s.targetElapsed))), h('span', 'סכום יעדים'))),
    days.length ? h('table.data', h('thead', h('tr', h('th', 'יום'), h('th', 'טופלו'), h('th', 'יעד'), h('th', 'למחר'), h('th', 'הועברו'))),
      h('tbody', days.map((d) => h('tr', h('td', h('a', { href: `#/counter/${d.date}` }, fmtDayShort(d.date))), h('td', ltr(String(d.completed))), h('td', ltr(String(d.target))), h('td', ltr(String(d.allocatedTomorrow))), h('td', ltr(String(d.transferred))))))) : empty('אין נתונים'));
}

export function render(main, args, ctx) {
  const state = S();
  const tab = TABS.some((t) => t[0] === args[0]) ? args[0] : 'waiting';
  const content = tab === 'waiting' ? waitingView(state, ctx.date) : tab === 'issues' ? issuesView(state) : tab === 'notes' ? notesView(state) : inquiriesView(state, ctx.date);
  main.replaceChildren(h('div.page',
    h('div.filters', { role: 'tablist', 'aria-label': 'כלי עבודה' }, TABS.map(([v, l]) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(tab === v), 'aria-pressed': String(tab === v), onclick: () => { location.hash = `#/tools/${v}`; } }, l))),
    content, h('a.btn.ghost', { href: '#/team/faq' }, ic('book', 18), 'תשובות נפוצות')));
}
