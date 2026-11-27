// Task selectors and the derived carryover view ("משימות שלא הסתיימו עד היום").
// Carryover is computed from dates and statuses every time it is read. Nothing is cloned,
// rescheduled or written by a nightly job: one task record is shown wherever it applies,
// and completing it anywhere removes it from every unfinished view.
import { addDays, diffDays, weekStart } from '../dates.js';
import { LIMITS } from '../config.js';
import { PRIORITY_RANK } from '../data/schema.js';
import { memo } from './cache.js';
import { dayInfoFor, workdaysBetween } from './dayTemplates.js';
import { matchesRecurrence } from './recurrence.js';

export const ACTIVE_STATUSES = new Set(['todo', 'inProgress']);
export const ruleOccKey = (ruleId, date) => `rr:${ruleId}@${date}`;

/** The date a task is due to be worked on: scheduled date, or resume date when deferred. */
export function dueDateOf(t) {
  if (t.status === 'deferred') return t.resumeOn || null;
  return t.scheduledDate || null;
}

/** Can this task appear as open work (carried or today)? */
export function isOpenWork(t) {
  return ACTIVE_STATUSES.has(t.status) || t.status === 'deferred';
}

function ruleIndex(state) {
  const c = memo(state, 'ruleIdx');
  if (c.has('x')) return c.get('x');
  const occ = new Map();
  for (const t of state.tasks) if (t.recurringRuleId && t.occurrenceDate) occ.set(ruleOccKey(t.recurringRuleId, t.occurrenceDate), t);
  const rules = new Map(state.recurringRules.map((r) => [r.id, r]));
  const res = { occ, rules };
  c.set('x', res);
  return res;
}

export function materializedOccurrence(state, ruleId, date) {
  return ruleIndex(state).occ.get(ruleOccKey(ruleId, date)) || null;
}

/** A not-yet-materialized recurring task occurrence, shown read-through from its rule. */
export function virtualOccurrence(rule, date) {
  return {
    id: ruleOccKey(rule.id, date), virtual: true, recurringRuleId: rule.id, occurrenceDate: date,
    title: rule.title, details: rule.details || '', categoryId: rule.categoryId, priority: rule.priority || 'medium',
    status: 'todo', scheduledDate: date, originalScheduledDate: date, deadline: null,
    estimateMinutes: rule.estimateMinutes ?? null, actualMinutes: null,
    subtasks: (rule.subtasks || []).map((title, i) => ({ id: `${rule.id}-s${i}`, title, done: false })),
    routine: !!rule.routine,
  };
}

/** Occurrence (materialized record or virtual) of a rule on a date, or null. */
export function ruleOccurrenceOn(state, rule, date) {
  if (rule.archived || !matchesRecurrence(rule.recurrence, date, dayInfoFor(state))) return null;
  return materializedOccurrence(state, rule.id, date) || virtualOccurrence(rule, date);
}

function carryPolicy(rule) {
  if (!rule) return 'none';
  if (rule.routine) return 'none';
  return rule.carryover || 'latest';
}

function decorate(state, t, date) {
  const original = t.originalScheduledDate || t.scheduledDate || dueDateOf(t);
  return {
    task: t,
    originalDate: original,
    ageDays: original ? diffDays(original, date) : 0,
    workdayAge: original ? workdaysBetween(state, original, date) : 0,
  };
}

const sortItems = (a, b) =>
  (a.originalDate || '') .localeCompare(b.originalDate || '') ||
  (PRIORITY_RANK[a.task.priority] ?? 1) - (PRIORITY_RANK[b.task.priority] ?? 1) ||
  String(a.task.createdAt || '').localeCompare(String(b.task.createdAt || '')) ||
  a.task.id.localeCompare(b.task.id);

/**
 * Unfinished actionable work from before `date`.
 * - Regular tasks: status todo/inProgress (or deferred whose resume date passed) with a due date earlier than `date`.
 * - Waiting, done, canceled, future and unscheduled tasks are excluded.
 * - Recurring occurrences follow their rule's carryover policy: routine/none never carry,
 *   'latest' carries only the most recent past occurrence if unfinished, 'all' carries each
 *   unfinished occurrence within a bounded look-back.
 */
export function carriedTasks(state, date) {
  const c = memo(state, 'carried');
  if (c.has(date)) return c.get(date);
  const { rules } = ruleIndex(state);
  const out = [];
  const seen = new Set();
  for (const t of state.tasks) {
    if (!isOpenWork(t)) continue;
    const due = dueDateOf(t);
    if (!due || due >= date) continue;
    if (t.recurringRuleId) continue; // handled per rule below
    out.push(decorate(state, t, date));
    seen.add(t.id);
  }
  const info = dayInfoFor(state);
  for (const rule of state.recurringRules) {
    const policy = carryPolicy(rule);
    if (policy === 'none' || rule.archived) continue;
    const from = addDays(date, -LIMITS.carryoverLookbackDays);
    const start = rule.recurrence.startDate > from ? rule.recurrence.startDate : from;
    const dates = [];
    for (let d = addDays(date, -1); d >= start; d = addDays(d, -1)) {
      if (!matchesRecurrence(rule.recurrence, d, info)) continue;
      dates.push(d);
      if (policy === 'latest') break;
    }
    for (const d of dates) {
      const real = materializedOccurrence(state, rule.id, d);
      const t = real || virtualOccurrence(rule, d);
      if (real && (!isOpenWork(real) || (dueDateOf(real) || d) >= date)) continue;
      out.push(decorate(state, t, date));
    }
  }
  // Materialized recurring occurrences whose rule was deleted keep ordinary behavior.
  for (const t of state.tasks) {
    if (!t.recurringRuleId || seen.has(t.id) || rules.has(t.recurringRuleId)) continue;
    const due = dueDateOf(t);
    if (isOpenWork(t) && due && due < date) out.push(decorate(state, t, date));
  }
  out.sort(sortItems);
  c.set(date, out);
  return out;
}

/** Work newly scheduled for `date` (not carried). Includes done items so they can be unchecked. */
export function todaysTasks(state, date) {
  const c = memo(state, 'today');
  if (c.has(date)) return c.get(date);
  const out = [];
  const shownOn = (t) => (t.status === 'done' ? (t.scheduledDate || null) : dueDateOf(t));
  const { rules } = ruleIndex(state);
  for (const t of state.tasks) {
    if (t.status === 'canceled' || t.status === 'waiting') continue;
    // A materialized recurring occurrence is listed by its rule on its own date; here only
    // when it was explicitly moved to another date.
    if (t.recurringRuleId && t.occurrenceDate && rules.has(t.recurringRuleId) && t.occurrenceDate === date) continue;
    if (shownOn(t) === date) out.push(t);
  }
  for (const rule of state.recurringRules) {
    const occ = ruleOccurrenceOn(state, rule, date);
    if (!occ || occ.status === 'canceled' || occ.status === 'waiting') continue;
    if (!occ.virtual && shownOn(occ) !== date) continue;
    out.push(occ);
  }
  out.sort((a, b) => (a.status === 'done') - (b.status === 'done') || (PRIORITY_RANK[a.priority] ?? 1) - (PRIORITY_RANK[b.priority] ?? 1) || String(a.createdAt || '').localeCompare(String(b.createdAt || '')) || a.id.localeCompare(b.id));
  c.set(date, out);
  return out;
}

/** Waiting tasks, with follow-up due flag. */
export function waitingTasks(state, date) {
  return state.tasks
    .filter((t) => t.status === 'waiting')
    .map((t) => ({ task: t, followUpOn: t.waiting?.followUpOn || null, due: !!(t.waiting?.followUpOn && t.waiting.followUpOn <= date) }))
    .sort((a, b) => (b.due - a.due) || String(a.followUpOn || '9999').localeCompare(String(b.followUpOn || '9999')));
}

export function upcomingTasks(state, date) {
  return state.tasks
    .filter((t) => isOpenWork(t) && dueDateOf(t) && dueDateOf(t) > date)
    .sort((a, b) => dueDateOf(a).localeCompare(dueDateOf(b)) || (PRIORITY_RANK[a.priority] ?? 1) - (PRIORITY_RANK[b.priority] ?? 1));
}

export function backlogTasks(state) {
  return state.tasks
    .filter((t) => ACTIVE_STATUSES.has(t.status) && !t.scheduledDate)
    .sort((a, b) => String(a.deadline || '9999').localeCompare(String(b.deadline || '9999')) || (PRIORITY_RANK[a.priority] ?? 1) - (PRIORITY_RANK[b.priority] ?? 1));
}

export function deferredTasks(state) {
  return state.tasks.filter((t) => t.status === 'deferred').sort((a, b) => String(a.resumeOn || '').localeCompare(String(b.resumeOn || '')));
}

export function completedTasks(state) {
  return state.tasks.filter((t) => t.status === 'done').sort((a, b) => String(b.completedAt || '').localeCompare(String(a.completedAt || '')));
}

export function canceledTasks(state) {
  return state.tasks.filter((t) => t.status === 'canceled').sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

/** Open tasks due in the week containing `date`, plus deadlines falling in it. */
export function weekTasks(state, date) {
  const ws = weekStart(date), we = addDays(ws, 6);
  return state.tasks
    .filter((t) => isOpenWork(t) && ((dueDateOf(t) && dueDateOf(t) >= ws && dueDateOf(t) <= we) || (t.deadline && t.deadline >= ws && t.deadline <= we)))
    .sort((a, b) => String(dueDateOf(a) || a.deadline).localeCompare(String(dueDateOf(b) || b.deadline)));
}

/** Open tasks with a deadline (any schedule state), for alerts and calendar markers. */
export function openDeadlines(state) {
  return state.tasks.filter((t) => t.deadline && (ACTIVE_STATUSES.has(t.status) || t.status === 'deferred' || t.status === 'waiting'));
}

/**
 * Stable priority sort ('high' = high→low, 'low' = low→high). Items keep their existing
 * (date) order within the same priority. Accepts tasks or carryover items ({task}).
 */
export function sortByPriority(list, dir = 'high') {
  const rank = (x) => PRIORITY_RANK[(x.task || x).priority] ?? 1;
  return list.map((x, i) => [x, i]).sort((a, b) => (dir === 'low' ? rank(b[0]) - rank(a[0]) : rank(a[0]) - rank(b[0])) || a[1] - b[1]).map((p) => p[0]);
}
