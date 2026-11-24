// Deterministic local planner and disruption handling. Every function here is read-only:
// it returns a proposal (diff + reasons + conflicts + unallocated work). Nothing changes
// until the user approves and a store command applies the selected parts.
import { addDays, diffDays, toMin, fromMin } from '../dates.js';
import { PRIORITY_RANK } from '../data/schema.js';
import { effectiveDay, nextWorkday } from './dayTemplates.js';
import { dayOccurrences, findOccurrence } from './schedule.js';
import { carriedTasks, dueDateOf, ACTIVE_STATUSES } from './taskCarryover.js';

const DEFAULT_ROLES = ['followup'];

function categoryOf(state, id) {
  return state.settings.categories.find((c) => c.id === id) || null;
}

/** Block roles a task may be placed in. */
export function rolesForTask(state, task) {
  if (task.preferredRole) return [task.preferredRole];
  const cat = categoryOf(state, task.categoryId);
  if (cat && Array.isArray(cat.roles) && cat.roles.length) return cat.roles;
  return DEFAULT_ROLES;
}

function deadlineBucket(task, date) {
  if (!task.deadline) return 5;
  const n = diffDays(date, task.deadline);
  if (n < 0) return 0;
  if (n <= 1) return 1;
  if (n <= 3) return 2;
  if (n <= 7) return 3;
  return 4;
}

/** Deterministic ranking: deadline risk, priority, category preference, age, creation, id. */
export function rankTasks(state, tasks, date) {
  return tasks.slice().sort((a, b) =>
    deadlineBucket(a, date) - deadlineBucket(b, date) ||
    (PRIORITY_RANK[a.priority] ?? 1) - (PRIORITY_RANK[b.priority] ?? 1) ||
    (categoryOf(state, b.categoryId)?.plannerWeight ?? 0) - (categoryOf(state, a.categoryId)?.plannerWeight ?? 0) ||
    String(a.originalScheduledDate || a.createdAt || '').localeCompare(String(b.originalScheduledDate || b.createdAt || '')) ||
    String(a.createdAt || '').localeCompare(String(b.createdAt || '')) ||
    a.id.localeCompare(b.id));
}

function usedMinutes(state, occ, excludeIds) {
  const byId = new Map(state.tasks.map((t) => [t.id, t]));
  return occ.taskIds
    .map((id) => byId.get(id))
    .filter((t) => t && !excludeIds.has(t.id) && t.status !== 'done' && t.status !== 'canceled')
    .reduce((a, t) => a + (Number.isInteger(t.estimateMinutes) ? t.estimateMinutes : 0), 0);
}

/** Capacity slots (eligible blocks) for the given dates. */
export function capacityFor(state, dates, now, excludeIds = new Set()) {
  const out = [];
  for (const date of dates) {
    const eff = effectiveDay(state, date);
    if (!eff.isWorking || date < now.date) continue;
    for (const o of dayOccurrences(state, date)) {
      if (o.kind === 'meeting' || o.protected || o.status === 'done' || o.status === 'canceled' || o.status === 'skipped' || !o.role) continue;
      const start = date === now.date ? Math.max(o.s, now.minute) : o.s;
      if (start >= o.e) continue;
      const length = o.e - start;
      const used = usedMinutes(state, o, excludeIds);
      out.push({ occId: o.id, date, role: o.role, title: o.title, start: fromMin(start), end: o.end, length, used, free: length - used });
    }
  }
  return out;
}

/**
 * Propose task assignments to blocks for a set of dates.
 * @param {Object} opts
 * @param {{date:string, minute:number}} opts.now
 * @param {string[]} opts.dates
 * @param {string[]} [opts.taskIds] restrict to these tasks
 */
export function proposePlan(state, { now, dates, taskIds = null }) {
  const first = dates[0], last = dates[dates.length - 1];
  const st = state.settings.planner;
  const carriedIds = new Set(carriedTasks(state, now.date).map((x) => x.task.id));
  const candidates = [];
  const skipped = [];
  for (const t of state.tasks) {
    if (taskIds && !taskIds.includes(t.id)) continue;
    const due = dueDateOf(t);
    if (t.status === 'waiting') {
      const f = t.waiting?.followUpOn;
      if (f && f <= last) candidates.push({ task: t, followUp: true });
      else if (taskIds) skipped.push({ taskId: t.id, title: t.title, reason: 'ממתינה – אין מעקב שהגיע מועדו' });
      continue;
    }
    if (!(ACTIVE_STATUSES.has(t.status) || (t.status === 'deferred' && due && due <= last))) continue;
    if (t.pinned || t.assignmentManual) { if (taskIds) skipped.push({ taskId: t.id, title: t.title, reason: 'שובצה ידנית ולכן נשמרת' }); continue; }
    const inRange = due && due >= first && due <= last;
    const carried = carriedIds.has(t.id);
    const deadlineSoon = !due && t.deadline && t.deadline <= addDays(last, 7);
    if (!(inRange || carried || deadlineSoon || taskIds)) continue;
    if (t.assignedBlock && !taskIds) {
      // Already placed in an existing block: keep it unless that block is gone.
      if (findOccurrence(state, t.assignedBlock)) continue;
    }
    candidates.push({ task: t, followUp: false });
  }
  const ranked = rankTasks(state, candidates.map((c) => c.task), now.date);
  const followUpIds = new Set(candidates.filter((c) => c.followUp).map((c) => c.task.id));
  const exclude = new Set(ranked.map((t) => t.id));
  const slots = capacityFor(state, dates, now, exclude);
  const assignments = [], unallocated = [...skipped], conflicts = [];
  for (const t of ranked) {
    let estimate = Number.isInteger(t.estimateMinutes) ? t.estimateMinutes : null;
    let assumed = false;
    if (estimate == null) {
      if (st.useAssumedEstimate && Number.isInteger(st.assumedEstimateMinutes) && st.assumedEstimateMinutes > 0) { estimate = st.assumedEstimateMinutes; assumed = true; }
      else { unallocated.push({ taskId: t.id, title: t.title, reason: 'חסרה הערכת זמן' }); continue; }
    }
    const roles = followUpIds.has(t.id) ? ['email1', 'email2', 'followup'] : rolesForTask(state, t);
    const due = dueDateOf(t);
    const earliest = due && due > first && !carriedIds.has(t.id) ? due : first;
    const cat = categoryOf(state, t.categoryId);
    let eligible = slots.filter((s) => s.date >= earliest && roles.includes(s.role));
    if (cat?.batchAtEnd) eligible = eligible.slice().sort((a, b) => a.date.localeCompare(b.date) || toMin(b.start) - toMin(a.start));
    const slot = eligible.find((s) => s.free >= estimate);
    if (!slot) {
      const reason = eligible.length ? 'אין מספיק זמן פנוי בבלוקים המתאימים' : 'אין בלוק מתאים בטווח';
      unallocated.push({ taskId: t.id, title: t.title, reason, estimate, assumed });
      if (t.deadline && t.deadline <= last) conflicts.push({ taskId: t.id, title: t.title, type: 'deadline', detail: `לא נמצא מקום לפני מועד היעד (${t.deadline})` });
      continue;
    }
    if (t.deadline && slot.date > t.deadline) conflicts.push({ taskId: t.id, title: t.title, type: 'deadline', detail: `השיבוץ (${slot.date}) אחרי מועד היעד (${t.deadline})` });
    slot.free -= estimate;
    slot.used += estimate;
    const reasons = [];
    if (deadlineBucket(t, now.date) === 0) reasons.push('מועד היעד עבר');
    else if (t.deadline) reasons.push(`מועד יעד ${t.deadline}`);
    if (carriedIds.has(t.id)) reasons.push('לא הסתיימה בימים קודמים');
    if (followUpIds.has(t.id)) reasons.push('מעקב שהגיע מועדו');
    if (t.priority === 'high') reasons.push('עדיפות גבוהה');
    reasons.push(`מתאים ל״${slot.title}״`);
    if (cat?.batchAtEnd) reasons.push('ריכוז לקראת סוף בלוק המייל');
    assignments.push({ taskId: t.id, title: t.title, occId: slot.occId, date: slot.date, blockTitle: slot.title, blockStart: slot.start, estimate, assumed, reason: reasons.join(' · '), taskUpdatedAt: t.updatedAt });
  }
  const capacity = slots.map((s) => ({ ...s }));
  return {
    dates, assignments, unallocated, conflicts, capacity,
    totals: {
      free: capacity.reduce((a, s) => a + Math.max(0, s.free), 0),
      planned: assignments.reduce((a, x) => a + x.estimate, 0),
      assumedCount: assignments.filter((a) => a.assumed).length,
    },
  };
}

/** One-tap: the first suitable free slot for a single task from `now`. */
export function firstFreeSlot(state, taskId, now, horizonDays = 14) {
  const dates = [];
  for (let i = 0; i < horizonDays; i++) dates.push(addDays(now.date, i));
  const p = proposePlan(state, { now, dates, taskIds: [taskId] });
  return { assignment: p.assignments[0] || null, reason: p.unallocated[0]?.reason || null, conflicts: p.conflicts };
}

/**
 * Disruption handling for a delayed/overrunning activity.
 * strategy: 'shift' | 'shorten' | 'moveTasks'. Fixed meetings and protected breaks never move;
 * the end of the workday is never extended. Returns before/after and what does not fit.
 */
export function proposeDelay(state, date, occId, delayMinutes, strategy) {
  const eff = effectiveDay(state, date);
  const occs = dayOccurrences(state, date).filter((o) => o.status !== 'canceled' && o.status !== 'skipped');
  const target = occs.find((o) => o.id === occId);
  if (!target || !(delayMinutes > 0)) return { error: 'invalid' };
  const workEnd = toMin(eff.workEnd);
  const isFixed = (o) => o.kind === 'meeting' || o.protected || o.pinned || o.status === 'done';
  const later = occs.filter((o) => o.id !== target.id && o.s >= target.s).sort((a, b) => a.s - b.s);
  const changes = [];
  const notFitting = [];
  const conflicts = [];
  const moves = [];
  const newTargetEnd = Math.min(target.e + delayMinutes, workEnd);
  if (target.e + delayMinutes > workEnd) conflicts.push({ occId: target.id, detail: 'ההארכה חורגת מסוף יום העבודה ולכן קוצרה עד סוף היום' });
  if (!isFixed(target) || target.kind !== 'meeting') changes.push({ occId: target.id, title: target.title, before: [target.start, target.end], after: [target.start, fromMin(newTargetEnd)] });
  const fixedBlocks = later.filter(isFixed);
  const hitsFixed = (s, e) => fixedBlocks.find((f) => s < f.e && f.s < e);
  let cursor = newTargetEnd;
  if (strategy === 'shift') {
    for (const o of later) {
      if (isFixed(o)) {
        if (cursor > o.s && cursor <= o.e) conflicts.push({ occId: o.id, detail: `${o.title} קבוע ואינו זז` });
        continue;
      }
      const len = o.e - o.s;
      let s = Math.max(o.s, cursor);
      let f;
      while ((f = hitsFixed(s, s + len))) s = f.e;
      const e = s + len;
      if (e > workEnd) { notFitting.push({ occId: o.id, title: o.title, detail: 'לא נכנס עד סוף יום העבודה' }); continue; }
      if (s !== o.s) changes.push({ occId: o.id, title: o.title, before: [o.start, o.end], after: [fromMin(s), fromMin(e)] });
      cursor = Math.max(cursor, e);
    }
  } else if (strategy === 'shorten') {
    for (const o of later) {
      if (cursor <= o.s) break;
      if (isFixed(o)) { conflicts.push({ occId: o.id, detail: `${o.title} קבוע ואינו מתקצר` }); cursor = Math.max(cursor, o.e); continue; }
      const min = Math.max(5, o.minMinutes || 10);
      if (!o.flexible) { conflicts.push({ occId: o.id, detail: `${o.title} אינו גמיש` }); continue; }
      if (o.e - cursor >= min) { changes.push({ occId: o.id, title: o.title, before: [o.start, o.end], after: [fromMin(cursor), o.end] }); cursor = o.e; break; }
      const s = cursor, e = cursor + min;
      if (e > workEnd || hitsFixed(s, e)) { notFitting.push({ occId: o.id, title: o.title, detail: 'אין מקום גם במשך המינימלי' }); continue; }
      changes.push({ occId: o.id, title: o.title, before: [o.start, o.end], after: [fromMin(s), fromMin(e)] });
      cursor = e;
    }
  } else if (strategy === 'moveTasks') {
    const next = nextWorkday(state, date);
    const byId = new Map(state.tasks.map((t) => [t.id, t]));
    // Tasks in later blocks squeezed by the extension move to the next workday.
    for (const o of later) {
      if (o.s >= newTargetEnd || isFixed(o)) continue;
      for (const id of o.taskIds) {
        const t = byId.get(id);
        if (t && ACTIVE_STATUSES.has(t.status)) moves.push({ taskId: t.id, title: t.title, from: date, to: next, fromBlock: o.title });
      }
    }
    for (const o of later) if (o.s < newTargetEnd) conflicts.push({ occId: o.id, detail: `${o.title} יחפוף להארכה – אפשר לערוך ידנית` });
  }
  return { date, occId, delayMinutes, strategy, changes, notFitting, conflicts, moves, nextWorkday: nextWorkday(state, date) };
}

/** Open tasks scheduled on `date` that could move to the next workday. */
export function proposeMoveUnfinished(state, date) {
  const next = nextWorkday(state, date);
  const tasks = state.tasks.filter((t) => ACTIVE_STATUSES.has(t.status) && dueDateOf(t) && dueDateOf(t) <= date && !t.recurringRuleId);
  return { from: date, to: next, tasks: tasks.map((t) => ({ taskId: t.id, title: t.title, scheduledDate: t.scheduledDate })) };
}
