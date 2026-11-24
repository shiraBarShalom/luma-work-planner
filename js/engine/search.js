// Local global search across tasks, questions, meetings, decisions, FAQ, notes and issues.
// Derived on demand; nothing is indexed persistently.

const NIQQUD = /[֑-ׇ]/g;
const FINALS = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };

/** Lower-case, strip niqqud/cantillation, unify final letters and punctuation. */
export function normalize(s) {
  return String(s || '')
    .normalize('NFKC')
    .replace(NIQQUD, '')
    .replace(/[ךםןףץ]/g, (c) => FINALS[c])
    .replace(/[׳״'"`׳״\-_.,:;!?()[\]{}]/g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function matches(text, tokens) {
  const n = normalize(text);
  return tokens.every((t) => n.includes(t));
}

/**
 * @returns {Array<{type:string, id:string, title:string, sub:string, date:string|null, ref:Object}>}
 */
export function globalSearch(state, query, limit = 80) {
  const tokens = normalize(query).split(' ').filter(Boolean);
  if (!tokens.length) return [];
  const out = [];
  const add = (type, id, title, sub, date, text, ref = {}) => { if (matches(text, tokens)) out.push({ type, id, title, sub, date, ref }); };
  for (const t of state.tasks) add('task', t.id, t.title, t.status, t.scheduledDate || t.deadline || null, [t.title, t.details, ...(t.subtasks || []).map((s) => s.title)].join(' '));
  for (const q of state.questions) add('question', q.id, q.title, q.status, q.createdDate, [q.title, q.detail, q.answer].join(' '));
  for (const m of state.meetings) add('meeting', m.id, m.title, m.status, m.date, [m.title, m.notes].join(' '));
  for (const d of state.meetingDecisions) add('decision', d.id, d.text, '', null, [d.text, d.owner].join(' '), { meetingId: d.meetingId });
  for (const f of state.faqEntries) add('faq', f.id, f.title, f.archived ? 'archived' : '', null, [f.title, f.answer, ...(f.keywords || [])].join(' '));
  for (const n of state.workNotes) add('note', n.id, n.title || n.body.slice(0, 60), '', null, [n.title, n.body].join(' '));
  for (const i of state.issueLogs) add('issue', i.id, i.title, i.status, i.lastOccurredOn || null, [i.title, i.resolution].join(' '));
  for (const b of state.calendarBlocks) add('block', b.id, b.title, '', b.date, [b.title, b.notes].join(' '));
  return out.slice(0, limit);
}
