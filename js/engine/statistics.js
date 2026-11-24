// Reports for a day, week or month. Each metric documents its population and date basis.
// Live values (current open items) are distinguished from historical snapshots.
import { datesBetween, zonedParts } from '../dates.js';
import { effectiveDay } from './dayTemplates.js';
import { dayOccurrences } from './schedule.js';
import { periodSummary } from './inquiries.js';
import { OPEN_Q } from './team.js';
import { waitingCenter } from './workTools.js';

export const METRIC_NOTES = [
  'פניות: נספרות מאירועי ספירה ותיקונים לפי תאריך העבודה. הוקצו למחר / הועברו / טיפול אחר אינם נספרים כפניות שטופלו.',
  'יעד: סכום היעדים היומיים של ימי העבודה בתקופה, לפי היעד שהיה בתוקף בכל יום (או התמונה שנשמרה בסגירת היום).',
  'בלוקים: בלוקים מתוכננים מול סטטוס סיום. דקות בפועל נספרות רק כשהוזנו; בלוק ללא דקות בפועל מוצג כ״לא ידוע״, לא כאפס.',
  'משימות שהושלמו: לפי תאריך הסיום. משימה שהועברה מיום ליום נספרת פעם אחת בלבד.',
  'משימות פתוחות לסוף התקופה: שחזור לפי תאריכי יצירה, תזמון וסיום. ערכים חיים (שאלות פתוחות, ממתינים) מסומנים כ״נכון לעכשיו״.',
];

export const localDateOf = (iso) => (iso ? zonedParts(new Date(iso)).date : null);

function blockStats(state, dates) {
  let planned = 0, done = 0, partial = 0, skipped = 0, canceled = 0, plannedMinutes = 0, actualMinutes = 0, unknownActual = 0;
  for (const d of dates) {
    for (const o of dayOccurrences(state, d)) {
      if (o.kind === 'meeting') continue;
      if (o.status === 'canceled') { canceled++; continue; }
      planned++;
      plannedMinutes += o.e - o.s;
      if (o.status === 'done') done++;
      if (o.status === 'partial') partial++;
      if (o.status === 'skipped') skipped++;
      if (o.status === 'done' || o.status === 'partial') {
        if (Number.isInteger(o.actualMinutes)) actualMinutes += o.actualMinutes; else unknownActual++;
      }
    }
  }
  return { planned, done, partial, skipped, canceled, plannedMinutes, actualMinutes, unknownActual };
}

/** Distinct tasks open at the end of `asOf` (reconstructed from dates). */
export function openTasksAsOf(state, asOf) {
  return state.tasks.filter((t) => {
    const created = localDateOf(t.createdAt);
    if (created && created > asOf) return false;
    const due = t.scheduledDate || t.resumeOn;
    if (!due || due > asOf) return false;
    if (t.status === 'done') return !t.completedOn || t.completedOn > asOf;
    if (t.status === 'canceled') return !!(t.canceledOn && t.canceledOn > asOf);
    return t.status !== 'waiting';
  });
}

export function periodReport(state, from, to, asOf) {
  const dates = datesBetween(from, to);
  const inquiries = periodSummary(state, from, to, asOf);
  const inRange = (d) => d && d >= from && d <= to;
  const tasksCompleted = state.tasks.filter((t) => t.status === 'done' && inRange(t.completedOn));
  const questionsAnswered = state.questions.filter((q) => inRange(q.answeredOn));
  const decisions = state.meetingDecisions.filter((d) => inRange(localDateOf(d.createdAt)));
  const meetingsHeld = state.meetings.filter((m) => inRange(m.date) && m.status !== 'canceled');
  const reportEnd = to < asOf ? to : asOf;
  const closedDays = dates.filter((d) => state.dailyReports[d]?.closedAt);
  const workdays = dates.filter((d) => effectiveDay(state, d).isWorking);
  return {
    from, to, asOf,
    inquiries,
    blocks: blockStats(state, dates),
    tasksCompleted,
    tasksOpenAtEnd: openTasksAsOf(state, reportEnd),
    questionsAnswered,
    decisions,
    meetings: meetingsHeld,
    live: {
      openQuestions: state.questions.filter((q) => OPEN_Q.has(q.status)).length,
      waiting: waitingCenter(state, asOf).length,
    },
    days: { workdays: workdays.length, closed: closedDays.length, notClosed: workdays.filter((d) => d <= asOf && !state.dailyReports[d]?.closedAt) },
    snapshots: dates.filter((d) => state.dailyReports[d]?.snapshot).map((d) => ({ date: d, ...state.dailyReports[d] })),
    notes: METRIC_NOTES,
  };
}

/** Compare a closed day's snapshot with live values to disclose later edits. */
export function snapshotDrift(state, date) {
  const r = state.dailyReports[date];
  if (!r?.snapshot) return null;
  const live = periodSummary(state, date, date, date).days[0];
  const diffs = [];
  if (live.completed !== r.snapshot.completed) diffs.push({ field: 'completed', snapshot: r.snapshot.completed, live: live.completed });
  return diffs.length ? diffs : null;
}
