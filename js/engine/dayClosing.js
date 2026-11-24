// Day closing: window derived from the effective schedule, summary, and closure snapshot.
// Closing never completes tasks and carryover never depends on it.
import { toMin } from '../dates.js';
import { effectiveDay, closingWindow, nextWorkday, routineBlocks } from './dayTemplates.js';
import { dayOccurrences } from './schedule.js';
import { dayTotals, effectiveTarget } from './inquiries.js';
import { carriedTasks, todaysTasks, ACTIVE_STATUSES } from './taskCarryover.js';
import { OPEN_Q } from './team.js';

export function isInClosingWindow(state, date, minute) {
  const w = closingWindow(state, date);
  return !!w && minute >= toMin(w.start) && minute < toMin(w.end);
}

/** After the closing window started (or the workday ended) and the day is not closed. */
export function closingDue(state, date, minute) {
  const w = closingWindow(state, date);
  return !!w && minute >= toMin(w.start) && !state.dailyReports[date]?.closedAt;
}

export function closingSummary(state, date) {
  const eff = effectiveDay(state, date);
  const occs = dayOccurrences(state, date).filter((o) => o.kind !== 'meeting');
  const totals = dayTotals(state, date);
  const target = effectiveTarget(state, date);
  const openCarried = carriedTasks(state, date);
  const today = todaysTasks(state, date);
  const completedToday = state.tasks.filter((t) => t.status === 'done' && t.completedOn === date);
  const next = nextWorkday(state, date);
  const tomorrow = next ? {
    date: next,
    eff: effectiveDay(state, next),
    blocks: dayOccurrences(state, next).length,
    routine: routineBlocks(state, next).blocks.length,
    meetings: dayOccurrences(state, next).filter((o) => o.kind === 'meeting'),
    tasks: todaysTasks(state, next).filter((t) => t.status !== 'done'),
  } : null;
  return {
    date, eff,
    inquiries: { completed: totals.completed, target: target.target, allocatedTomorrow: totals.allocatedTomorrow, transferred: totals.transferred, other: totals.other },
    blocks: {
      total: occs.filter((o) => o.status !== 'canceled').length,
      done: occs.filter((o) => o.status === 'done').length,
      partial: occs.filter((o) => o.status === 'partial').length,
      skipped: occs.filter((o) => o.status === 'skipped').length,
      planned: occs.filter((o) => o.status === 'planned').length,
    },
    tasks: {
      completedToday,
      openToday: today.filter((t) => t.status !== 'done'),
      openCarried: openCarried.map((x) => x.task),
    },
    waitingQuestions: state.questions.filter((q) => OPEN_Q.has(q.status)),
    tomorrow,
  };
}

/** Immutable snapshot stored with a closed day (historical context survives later edits). */
export function closureSnapshot(state, date) {
  const s = closingSummary(state, date);
  const eff = s.eff;
  return {
    target: s.inquiries.target,
    completed: s.inquiries.completed,
    allocatedTomorrow: s.inquiries.allocatedTomorrow,
    transferred: s.inquiries.transferred,
    other: s.inquiries.other,
    blocks: s.blocks,
    tasksCompleted: s.tasks.completedToday.map((t) => t.id),
    tasksOpen: [...s.tasks.openCarried, ...s.tasks.openToday].filter((t) => !t.virtual).map((t) => t.id),
    tasksOpenCount: s.tasks.openCarried.length + s.tasks.openToday.length,
    openQuestions: s.waitingQuestions.length,
    context: { isWorking: eff.isWorking, location: eff.location, phoneDuty: eff.phoneDuty, workStart: eff.workStart, workEnd: eff.workEnd, templateId: eff.templateId, versionId: routineBlocks(state, date).versionId },
  };
}

export const isOpenTask = (t) => ACTIVE_STATUSES.has(t.status);
