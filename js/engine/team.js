// Team questions, manager topics, meetings, agenda queues and FAQ selectors.
// A question is one canonical record; meetings reference questions by ID. An unscheduled
// agenda is a derived queue of open questions, never a fake calendar event.
import { meetingTimes } from './schedule.js';
import { normalize } from './search.js';

export const OPEN_Q = new Set(['open', 'waiting']);

export function isUpcomingMeeting(m, date) {
  return m.status === 'planned' && (!m.date || m.date >= date);
}

export function upcomingMeetings(state, date) {
  return state.meetings
    .filter((m) => isUpcomingMeeting(m, date))
    .sort((a, b) => String(a.date || '9999').localeCompare(String(b.date || '9999')) || String(a.start || '').localeCompare(String(b.start || '')));
}

export function pastMeetings(state, date) {
  return state.meetings
    .filter((m) => !isUpcomingMeeting(m, date))
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(b.start || '').localeCompare(String(a.start || '')));
}

/** Meetings that cannot be placed on the calendar yet (missing date/time/duration). */
export function unscheduledMeetings(state, date) {
  return upcomingMeetings(state, date).filter((m) => !meetingTimes(m));
}

export function questionsFor(state, { audience = null, kind = null, statuses = null } = {}) {
  return state.questions.filter((q) =>
    (!audience || q.audience === audience) && (!kind || (q.kind || 'question') === kind) && (!statuses || statuses.includes(q.status)));
}

/** Open questions not linked to any upcoming meeting: the queue for the next reception/meeting. */
export function agendaQueue(state, date, audience = null) {
  const linked = new Set();
  for (const m of state.meetings) if (isUpcomingMeeting(m, date)) for (const id of m.agenda || []) linked.add(id);
  return state.questions
    .filter((q) => OPEN_Q.has(q.status) && (!audience || q.audience === audience) && !linked.has(q.id))
    .sort(questionSort);
}

const PR = { high: 0, medium: 1, low: 2 };
export function questionSort(a, b) {
  return (PR[a.priority] ?? 1) - (PR[b.priority] ?? 1) || String(a.createdDate).localeCompare(String(b.createdDate)) || a.id.localeCompare(b.id);
}

export function meetingAgenda(state, meeting) {
  const byId = new Map(state.questions.map((q) => [q.id, q]));
  return (meeting.agenda || []).map((id) => byId.get(id)).filter(Boolean);
}

export function meetingDecisions(state, meetingId) {
  return state.meetingDecisions.filter((d) => d.meetingId === meetingId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function meetingsForQuestion(state, questionId) {
  return state.meetings.filter((m) => (m.agenda || []).includes(questionId));
}

/** Answered questions that recur and are not yet in the FAQ: candidates for promotion. */
export function faqCandidates(state) {
  return state.questions.filter((q) => q.status === 'answered' && q.recurring && !q.faqId && q.answer);
}

export function searchFaq(state, text, { includeArchived = false } = {}) {
  const q = normalize(text || '');
  return state.faqEntries
    .filter((f) => (includeArchived || !f.archived) && (!q || normalize([f.title, f.answer, ...(f.keywords || [])].join(' ')).includes(q)))
    .sort((a, b) => a.title.localeCompare(b.title, 'he'));
}

export function followUpTasks(state) {
  return state.tasks.filter((t) => t.source && (t.source.kind === 'decision' || t.source.kind === 'question'));
}

/** Plain-text agenda for copying/sharing (no private notes beyond question titles/details). */
export function agendaText(state, meeting, { fmtDate = (d) => d } = {}) {
  const t = meetingTimes(meeting);
  const lines = [`${meeting.title}`];
  if (meeting.date) lines.push(`${fmtDate(meeting.date)}${t ? ` · ${t.start}–${t.end}` : ''}`);
  const agenda = meetingAgenda(state, meeting);
  lines.push('', 'סדר יום:');
  if (!agenda.length) lines.push('—');
  agenda.forEach((q, i) => {
    lines.push(`${i + 1}. ${q.title}`);
    if (q.answer) lines.push(`   תשובה: ${q.answer}`);
  });
  const decisions = meetingDecisions(state, meeting.id);
  if (decisions.length) {
    lines.push('', 'החלטות:');
    decisions.forEach((d, i) => lines.push(`${i + 1}. ${d.text}${d.owner ? ` (${d.owner})` : ''}`));
  }
  return lines.join('\n');
}
