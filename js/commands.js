// Validated commands. Each command mutates a draft copy of the state; the store validates
// the resulting document and commits atomically (or not at all). Commands that need the
// user's explicit approval return `needConfirm(...)` without changing anything.
// Commands flagged `automated` (plan import/undo) may never change a recurring activity;
// the store enforces that after the command runs (see store.js).
import { isValidDate, isValidTime, toMin, addDays, weekday } from './dates.js';
import { LIMITS } from './config.js';
import { TASK_STATUSES, PRIORITIES, BLOCK_STATUSES } from './data/schema.js';
import { findOccurrence, parseOccId } from './engine/schedule.js';
import { recurrenceErrors } from './engine/recurrence.js';
import { materializedOccurrence } from './engine/taskCarryover.js';
import { countFor } from './engine/inquiries.js';
import { applyPlanImport, applyUndoImport } from './data/importPlan.js';
import { ACTIVITY_CATEGORY } from './seed.js';

export class CommandError extends Error {
  constructor(code, messageHe) { super(messageHe || code); this.code = code; this.messageHe = messageHe || code; }
}
/** @param {Array<{code:string, message:string}>} reasons */
export const needConfirm = (reasons) => ({ confirmRequired: reasons });
const fail = (code, msg) => { throw new CommandError(code, msg); };

// ---------- helpers ----------
const cleanText = (v, max = LIMITS.text) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
function requireTitle(v) {
  const t = cleanText(v, LIMITS.title);
  if (!t) fail('title', 'יש להזין כותרת');
  return t;
}
const optDate = (v, label) => {
  if (v == null || v === '') return null;
  if (!isValidDate(v)) fail('date', `${label}: תאריך לא תקין`);
  return v;
};
const optTime = (v, label) => {
  if (v == null || v === '') return null;
  if (!isValidTime(v)) fail('time', `${label}: שעה לא תקינה`);
  return v;
};
function getTask(d, id) { return d.tasks.find((t) => t.id === id) || fail('not-found', 'המשימה לא נמצאה'); }
function touch(e, ctx) { e.updatedAt = ctx.nowIso; e.editedAt = ctx.nowIso; }

function newTask(d, p, ctx) {
  const scheduledDate = optDate(p.scheduledDate, 'תאריך ביצוע');
  return {
    id: ctx.uid(),
    title: requireTitle(p.title),
    details: cleanText(p.details),
    categoryId: null,
    priority: PRIORITIES.includes(p.priority) ? p.priority : 'medium',
    status: 'todo',
    originalScheduledDate: scheduledDate,
    scheduledDate,
    deadline: optDate(p.deadline, 'מועד יעד'),
    estimateMinutes: null,
    actualMinutes: null,
    subtasks: [],
    recurringRuleId: null,
    occurrenceDate: null,
    assignedBlock: null,
    assignmentManual: false,
    pinned: false,
    preferredRole: null,
    meetingId: null,
    questionId: null,
    waiting: null,
    resumeOn: null,
    source: p.source || { kind: 'manual' },
    scheduleHistory: [],
    createdAt: ctx.nowIso,
    updatedAt: ctx.nowIso,
    completedAt: null,
    completedOn: null,
    canceledOn: null,
  };
}

/** Materialize a legacy recurring task occurrence as a task record (idempotent). */
function materialize(d, ruleId, date, ctx) {
  const existing = materializedOccurrence(d, ruleId, date) || d.tasks.find((t) => t.recurringRuleId === ruleId && t.occurrenceDate === date);
  if (existing) return existing;
  const rule = d.recurringRules.find((r) => r.id === ruleId) || fail('not-found', 'המשימה החוזרת לא נמצאה');
  const t = newTask(d, { title: rule.title, details: rule.details, priority: rule.priority, scheduledDate: date, source: { kind: 'recurring', ruleId } }, ctx);
  t.categoryId = rule.categoryId ?? null;
  t.subtasks = (rule.subtasks || []).map((title) => ({ id: ctx.uid(), title, done: false }));
  t.recurringRuleId = ruleId;
  t.occurrenceDate = date;
  d.tasks.push(t);
  return t;
}

/** Resolve a task reference: real id, or `rr:<ruleId>@<date>` virtual occurrence. */
function resolveTask(d, idOrKey, ctx) {
  if (typeof idOrKey === 'string' && idOrKey.startsWith('rr:')) {
    const at = idOrKey.lastIndexOf('@');
    return materialize(d, idOrKey.slice(3, at), idOrKey.slice(at + 1), ctx);
  }
  return getTask(d, idOrKey);
}

function setScheduled(t, date, ctx, by = 'user') {
  if (t.scheduledDate === date) return;
  t.scheduleHistory.push({ from: t.scheduledDate, to: date, at: ctx.nowIso, by });
  t.scheduledDate = date;
  if (!t.originalScheduledDate && date) t.originalScheduledDate = date;
  if (t.assignedBlock) {
    const occDate = parseOccId(t.assignedBlock)?.date || null;
    if (!occDate || occDate !== date) { t.assignedBlock = null; t.assignmentManual = false; }
  }
}

function removeFromPriorities(d, taskId) {
  for (const [date, ids] of Object.entries(d.dailyPriorities)) {
    const next = ids.filter((x) => x !== taskId);
    if (next.length) d.dailyPriorities[date] = next; else delete d.dailyPriorities[date];
  }
}

// ---------- schedule helpers ----------
function checkInterval(s, e) {
  if (!(e > s)) fail('interval', 'שעת הסיום חייבת להיות אחרי שעת ההתחלה');
  if (s < 0 || e > 24 * 60) fail('interval', 'הפעילות חייבת להיות בתוך היום');
}

/**
 * Normalize a recurrence choice from the editor or from stored data.
 * Supported: daily, every workday (dayType 'workday'), weekly on chosen weekdays.
 */
function normRecurrence(r, startDate) {
  if (r == null) return null;
  if (typeof r !== 'object') fail('recurrence', 'הגדרת חזרה לא תקינה');
  const rec = {
    kind: r.kind, interval: Number.isInteger(r.interval) && r.interval > 0 ? r.interval : 1,
    weekdays: Array.isArray(r.weekdays) ? [...new Set(r.weekdays)].sort() : [],
    workdaysOnly: !!r.workdaysOnly, monthDay: r.monthDay ?? null, monthOverflow: r.monthOverflow === 'lastDay' ? 'lastDay' : 'skip',
    dayType: r.dayType || null, startDate: r.startDate || startDate, endDate: r.endDate || null, exceptions: Array.isArray(r.exceptions) ? r.exceptions : [],
  };
  if (rec.kind === 'weekly' && !rec.weekdays.length) rec.weekdays = [weekday(startDate)];
  const errs = recurrenceErrors(rec, isValidDate);
  if (errs.length) fail('recurrence', errs.join(', '));
  return rec;
}

function setOverride(d, occId, fields, ctx) {
  const prev = d.occurrenceOverrides[occId] || {};
  d.occurrenceOverrides[occId] = { ...prev, ...fields, manual: true, updatedAt: ctx.nowIso };
}

function newBlock(d, p, ctx) {
  return {
    id: ctx.uid(), date: p.date, start: p.start, end: p.end, title: requireTitle(p.title),
    categoryId: p.categoryId && d.settings.categories.some((c) => c.id === p.categoryId) ? p.categoryId : ACTIVITY_CATEGORY,
    role: null, notes: cleanText(p.notes), pinned: false, recurrence: p.recurrence || null,
    source: p.source || 'manual', movedFrom: p.movedFrom || null, protected: false, flexible: true,
    minMinutes: 0, instructions: [], createdAt: ctx.nowIso, updatedAt: ctx.nowIso,
  };
}

function reassignTasks(d, fromOcc, toOcc, ctx) {
  for (const t of d.tasks) if (t.assignedBlock === fromOcc) { t.assignedBlock = toOcc; t.updatedAt = ctx.nowIso; }
}
function moveKey(obj, from, to) {
  if (obj[from] !== undefined) { obj[to] = obj[from]; delete obj[from]; }
}
/** Remove completion/override records of a series from `fromDate` on (future occurrences). */
function dropSeriesRecordsFrom(d, blockId, fromDate) {
  for (const coll of [d.blockCompletions, d.occurrenceOverrides]) {
    for (const k of Object.keys(coll)) { const p = parseOccId(k); if (p?.kind === 'series' && p.blockId === blockId && p.date >= fromDate) delete coll[k]; }
  }
  for (const t of d.tasks) { const p = parseOccId(t.assignedBlock); if (p?.kind === 'series' && p.blockId === blockId && p.date >= fromDate) { t.assignedBlock = null; t.assignmentManual = false; } }
}

/** Move a generated occurrence to another date: source exclusion + one destination block. */
function moveOccToDate(d, o, date, start, end, ctx) {
  if (o.kind === 'block') {
    const b = d.calendarBlocks.find((x) => x.id === o.id);
    Object.assign(b, { date, start, end, updatedAt: ctx.nowIso });
    return o.id;
  }
  setOverride(d, o.id, { excluded: true }, ctx);
  const nb = newBlock(d, { date, start, end, title: o.title, categoryId: o.categoryId, notes: o.notes, source: 'moved', movedFrom: o.id }, ctx);
  d.calendarBlocks.push(nb);
  moveKey(d.blockCompletions, o.id, nb.id);
  reassignTasks(d, o.id, nb.id, ctx);
  return nb.id;
}

const FIELDS = ['start', 'end', 'title', 'notes'];
function normalizeChanges(ch) {
  const out = {};
  if (ch.title !== undefined) out.title = requireTitle(ch.title);
  if (ch.start !== undefined) out.start = optTime(ch.start, 'שעת התחלה') || fail('time', 'חסרה שעת התחלה');
  if (ch.end !== undefined) out.end = optTime(ch.end, 'שעת סיום') || fail('time', 'חסרה שעת סיום');
  if (ch.notes !== undefined) out.notes = cleanText(ch.notes);
  if (ch.date !== undefined) out.date = optDate(ch.date, 'תאריך') || fail('date', 'חסר תאריך');
  return out;
}
const pickFields = (ch) => Object.fromEntries(FIELDS.filter((f) => ch[f] !== undefined).map((f) => [f, ch[f]]));

/** Split a recurring series at `date`: the original ends the day before; returns the new series. */
function splitSeries(d, b, date, ctx) {
  const nb = { ...structuredClone(b), id: ctx.uid(), seedKey: undefined, recurrence: { ...b.recurrence, startDate: date, exceptions: (b.recurrence.exceptions || []).filter((x) => x >= date) }, createdAt: ctx.nowIso, updatedAt: ctx.nowIso };
  delete nb.seedKey;
  b.recurrence = { ...b.recurrence, endDate: addDays(date, -1), exceptions: (b.recurrence.exceptions || []).filter((x) => x < date) };
  b.updatedAt = ctx.nowIso;
  d.calendarBlocks.push(nb);
  for (const coll of [d.blockCompletions, d.occurrenceOverrides]) {
    for (const key of Object.keys(coll)) {
      const p = parseOccId(key);
      if (p?.kind === 'series' && p.blockId === b.id && p.date >= date) moveKey(coll, key, `${nb.id}@${p.date}`);
    }
  }
  for (const t of d.tasks) {
    const p = parseOccId(t.assignedBlock);
    if (p?.kind === 'series' && p.blockId === b.id && p.date >= date) t.assignedBlock = `${nb.id}@${p.date}`;
  }
  return nb;
}

// ---------- commands ----------
/** @type {Record<string, {label:string, persist?:'immediate'|'debounced', snapshot?:string, automated?:boolean, run:(d:any, p:any, ctx:any)=>any}>} */
export const COMMANDS = {
  // ===== settings =====
  updateSettings: {
    label: 'עדכון הגדרות',
    run(d, p) {
      for (const [k, v] of Object.entries(p.patch || {})) {
        if (k === 'displayName') {
          if (typeof v !== 'string') fail('name', 'שם לא תקין');
          d.settings.displayName = cleanText(v, 40);
        } else if (k === 'theme') { if (!['auto', 'light', 'dark'].includes(v)) fail('theme', 'ערך לא תקין'); d.settings.theme = v; }
        else if (k === 'reducedMotion') { if (!['auto', 'reduce'].includes(v)) fail('motion', 'ערך לא תקין'); d.settings.reducedMotion = v; }
        else if (k === 'backup') {
          const b = { ...d.settings.backup, ...v };
          if (!(Number.isInteger(b.reminderDays) && b.reminderDays >= 0 && b.reminderDays <= 365)) fail('backup', 'תדירות תזכורת לא תקינה');
          d.settings.backup = b;
        } else if (k === 'notifications') {
          const n = { ...d.settings.notifications, ...v };
          d.settings.notifications = { activityStart: !!n.activityStart, showDetails: !!n.showDetails };
        } else fail('field', `שדה לא מוכר: ${k}`);
      }
    },
  },
  setDefaultTarget: {
    label: 'עדכון יעד פניות',
    run(d, { target }, ctx) {
      const n = Number(target);
      if (!Number.isInteger(n) || n < 0 || n > 1000) fail('target', 'יש להזין מספר שלם בין 0 ל-1000');
      // Takes effect from today; earlier days keep the target that applied to them.
      const from = ctx.today;
      d.targetHistory.defaults = d.targetHistory.defaults.filter((v) => v.effectiveFrom !== from);
      d.targetHistory.defaults.push({ effectiveFrom: from, target: n, setAt: ctx.nowIso });
      d.targetHistory.defaults.sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
    },
  },

  // ===== activities =====
  addBlock: {
    label: 'הוספת פעילות',
    run(d, p, ctx) {
      const date = optDate(p.date, 'תאריך') || fail('date', 'חסר תאריך');
      const start = optTime(p.start, 'שעת התחלה') || fail('time', 'חסרה שעת התחלה');
      const end = optTime(p.end, 'שעת סיום') || fail('time', 'חסרה שעת סיום');
      checkInterval(toMin(start), toMin(end));
      // Overlaps with other activities are allowed: both keep their own times.
      const b = newBlock(d, { ...p, date, start, end, recurrence: normRecurrence(p.recurrence, date) }, ctx);
      d.calendarBlocks.push(b);
      return b.recurrence ? `${b.id}@${date}` : b.id;
    },
  },
  updateOccurrence: {
    label: 'עריכת פעילות',
    /**
     * @param {{occId:string, changes:Object, recurrence?:Object|null, scope?:'this'|'future', confirm?:boolean}} p
     *   recurrence: undefined = unchanged; null = stop repeating; object = new rule.
     *   scope (recurring only): 'this' = this occurrence; 'future' = this and later ones.
     */
    run(d, { occId, changes, recurrence, scope = 'this', confirm }, ctx) {
      const o = findOccurrence(d, occId) || fail('not-found', 'הפעילות לא נמצאה');
      const ch = normalizeChanges(changes || {});
      const date = ch.date || o.date;
      const start = ch.start || o.start, end = ch.end || o.end;
      checkInterval(toMin(start), toMin(end));
      if (o.status !== 'planned' && o.date < ctx.today && !confirm) return needConfirm([{ code: 'history', message: 'הפעילות כבר סומנה בעבר. לשנות אותה?' }]);
      const fields = pickFields(ch);
      const recChange = recurrence !== undefined;

      if (o.kind === 'block') {
        const b = d.calendarBlocks.find((x) => x.id === o.id);
        Object.assign(b, fields, { date, updatedAt: ctx.nowIso, editedAt: ctx.nowIso });
        if (recChange && recurrence) {
          b.recurrence = normRecurrence({ ...recurrence, startDate: date }, date);
          moveKey(d.blockCompletions, b.id, `${b.id}@${date}`);
          reassignTasks(d, b.id, `${b.id}@${date}`, ctx);
          return `${b.id}@${date}`;
        }
        return b.id;
      }
      if (o.kind === 'routine' || scope === 'this') {
        if (date !== o.date) {
          const nid = moveOccToDate(d, o, date, start, end, ctx);
          const { start: _s, end: _e, ...rest } = fields;
          Object.assign(d.calendarBlocks.find((x) => x.id === nid), rest);
          return nid;
        }
        if (Object.keys(fields).length) setOverride(d, o.id, fields, ctx);
        return o.id;
      }
      // Recurring series, this and future occurrences.
      if (date !== o.date) fail('scope', 'שינוי תאריך אפשרי רק עבור הפעם הזו');
      const b = d.calendarBlocks.find((x) => x.id === o.sourceId) || fail('not-found', 'הפעילות לא נמצאה');
      const atStart = o.date <= b.recurrence.startDate;
      if (recChange && recurrence === null) {
        // Stop repeating: this occurrence stays as a one-off activity; later ones are removed.
        if (atStart) {
          moveKey(d.blockCompletions, o.id, b.id);
          reassignTasks(d, o.id, b.id, ctx);
          dropSeriesRecordsFrom(d, b.id, o.date);
          Object.assign(b, fields, { recurrence: null, date: o.date, updatedAt: ctx.nowIso, editedAt: ctx.nowIso });
          return b.id;
        }
        const one = newBlock(d, { date: o.date, start, end, title: fields.title ?? o.title, notes: fields.notes ?? o.notes, categoryId: b.categoryId }, ctx);
        d.calendarBlocks.push(one);
        moveKey(d.blockCompletions, o.id, one.id);
        reassignTasks(d, o.id, one.id, ctx);
        dropSeriesRecordsFrom(d, b.id, o.date);
        b.recurrence = { ...b.recurrence, endDate: addDays(o.date, -1) };
        b.updatedAt = ctx.nowIso;
        return one.id;
      }
      const target = atStart ? b : splitSeries(d, b, o.date, ctx);
      Object.assign(target, fields, { updatedAt: ctx.nowIso, editedAt: ctx.nowIso });
      if (recChange) target.recurrence = normRecurrence({ ...recurrence, startDate: target.recurrence.startDate, exceptions: target.recurrence.exceptions }, target.recurrence.startDate);
      // Per-occurrence time/title edits from this date on are superseded by the new values.
      for (const key of Object.keys(d.occurrenceOverrides)) {
        const p = parseOccId(key);
        if (p?.kind === 'series' && p.blockId === target.id && p.date >= o.date && !d.occurrenceOverrides[key].excluded) {
          const rest = { ...d.occurrenceOverrides[key] };
          for (const f of Object.keys(fields)) delete rest[f];
          d.occurrenceOverrides[key] = rest;
        }
      }
      return `${target.id}@${o.date}`;
    },
  },
  setBlockStatus: {
    label: 'עדכון סטטוס פעילות',
    run(d, { occId, status }, ctx) {
      findOccurrence(d, occId) || fail('not-found', 'הפעילות לא נמצאה');
      if (!BLOCK_STATUSES.includes(status)) fail('status', 'סטטוס לא תקין');
      const act = d.blockCompletions[occId]?.actualMinutes ?? null;
      if (status === 'planned' && act == null) delete d.blockCompletions[occId];
      else d.blockCompletions[occId] = { status, actualMinutes: act, updatedAt: ctx.nowIso };
    },
  },
  deleteOccurrence: {
    label: 'מחיקת פעילות',
    run(d, { occId, scope = 'this' }, ctx) {
      const o = findOccurrence(d, occId) || fail('not-found', 'הפעילות לא נמצאה');
      const unlink = (id) => { for (const t of d.tasks) if (t.assignedBlock === id) { t.assignedBlock = null; t.assignmentManual = false; t.updatedAt = ctx.nowIso; } };
      if (o.kind === 'block') {
        d.calendarBlocks = d.calendarBlocks.filter((b) => b.id !== o.id);
        delete d.blockCompletions[o.id];
        unlink(o.id);
        return;
      }
      if (scope === 'this' || o.kind === 'routine') {
        setOverride(d, o.id, { excluded: true }, ctx);
        delete d.blockCompletions[o.id];
        unlink(o.id);
        return;
      }
      const b = d.calendarBlocks.find((x) => x.id === o.sourceId);
      if (o.date <= b.recurrence.startDate) {
        d.calendarBlocks = d.calendarBlocks.filter((x) => x.id !== b.id);
        dropSeriesRecordsFrom(d, b.id, '0000-00-00');
      } else {
        b.recurrence = { ...b.recurrence, endDate: addDays(o.date, -1) };
        b.updatedAt = ctx.nowIso;
        dropSeriesRecordsFrom(d, b.id, o.date);
      }
    },
  },

  // ===== tasks =====
  addTask: {
    label: 'הוספת משימה',
    run(d, p, ctx) {
      const t = newTask(d, p, ctx);
      d.tasks.push(t);
      if (p.priorityFor) {
        const ids = d.dailyPriorities[p.priorityFor] || [];
        if (ids.length >= 3) fail('priorities', 'כבר נבחרו שלוש משימות חשובות ליום');
        d.dailyPriorities[p.priorityFor] = [...ids, t.id];
        if (!t.scheduledDate) { t.scheduledDate = p.priorityFor; t.originalScheduledDate = p.priorityFor; }
      }
      return t.id;
    },
  },
  updateTask: {
    label: 'עריכת משימה',
    run(d, { id, patch }, ctx) {
      const t = resolveTask(d, id, ctx);
      const p = patch || {};
      if (p.title !== undefined) t.title = requireTitle(p.title);
      if (p.details !== undefined) t.details = cleanText(p.details);
      if (p.priority !== undefined) { if (!PRIORITIES.includes(p.priority)) fail('priority', 'עדיפות לא תקינה'); t.priority = p.priority; }
      if (p.deadline !== undefined) t.deadline = optDate(p.deadline, 'מועד יעד');
      if (p.scheduledDate !== undefined) {
        const nd = optDate(p.scheduledDate, 'תאריך ביצוע');
        if (t.status === 'deferred' && nd) { t.status = 'todo'; t.resumeOn = null; }
        setScheduled(t, nd, ctx);
      }
      touch(t, ctx);
      return t.id;
    },
  },
  setTaskStatus: {
    label: 'עדכון סטטוס משימה',
    run(d, { id, status, resumeOn }, ctx) {
      if (!TASK_STATUSES.includes(status)) fail('status', 'סטטוס לא תקין');
      const t = resolveTask(d, id, ctx);
      const prev = t.status;
      t.status = status;
      if (status === 'done') { t.completedAt = ctx.nowIso; t.completedOn = ctx.today; }
      else if (prev === 'done') { t.completedAt = null; t.completedOn = null; }
      t.canceledOn = status === 'canceled' ? ctx.today : null;
      if (status === 'deferred') {
        t.resumeOn = optDate(resumeOn, 'תאריך') || fail('resume', 'לדחייה נדרש תאריך');
        t.assignedBlock = null;
      } else t.resumeOn = null;
      if (status === 'waiting') t.waiting = { note: t.waiting?.note || '', followUpOn: t.waiting?.followUpOn || null };
      // A finished task frees its "three important tasks" slot from today on (earlier days
      // keep their selection as history). Undo restores the task and the selection together.
      if (status === 'done' || status === 'canceled') {
        for (const [date, ids] of Object.entries(d.dailyPriorities)) {
          if (date < ctx.today || !ids.includes(t.id)) continue;
          const rest = ids.filter((x) => x !== t.id);
          if (rest.length) d.dailyPriorities[date] = rest; else delete d.dailyPriorities[date];
        }
      }
      t.updatedAt = ctx.nowIso;
      return t.id;
    },
  },
  toggleTaskDone: {
    label: 'סימון משימה',
    run(d, { id }, ctx) {
      const t = resolveTask(d, id, ctx);
      return COMMANDS.setTaskStatus.run(d, { id: t.id, status: t.status === 'done' ? 'todo' : 'done' }, ctx);
    },
  },
  rescheduleTask: {
    label: 'תזמון משימה',
    run(d, { id, date }, ctx) {
      const t = resolveTask(d, id, ctx);
      const nd = optDate(date, 'תאריך');
      if (['deferred', 'waiting', 'canceled'].includes(t.status) && nd) { t.status = 'todo'; t.resumeOn = null; t.canceledOn = null; }
      setScheduled(t, nd, ctx);
      t.updatedAt = ctx.nowIso;
      return t.id;
    },
  },
  deleteTask: {
    label: 'מחיקת משימה',
    run(d, { id }, ctx) {
      const t = getTask(d, id);
      if (t.recurringRuleId) fail('recurring', 'זו משימה חוזרת: אפשר לבטל את הפעם הזו או להפסיק את החזרה');
      removeFromPriorities(d, id);
      // Legacy records that referenced the task keep existing, only the link is removed.
      for (const x of d.meetingDecisions) if (x.taskId === id) x.taskId = null;
      for (const x of d.issueLogs) if (x.taskId === id) { x.taskId = null; x.updatedAt = ctx.nowIso; }
      for (const x of d.workNotes) if (x.taskId === id) { x.taskId = null; x.updatedAt = ctx.nowIso; }
      d.tasks = d.tasks.filter((x) => x.id !== id);
    },
  },
  setPriorities: {
    label: 'עדכון שלוש המשימות החשובות',
    run(d, { date, ids }, ctx) {
      optDate(date, 'תאריך') || fail('date', 'חסר תאריך');
      const list = [];
      for (const raw of ids || []) {
        const t = resolveTask(d, raw, ctx);
        if (!list.includes(t.id)) list.push(t.id);
      }
      if (list.length > 3) fail('max', 'אפשר לבחור עד שלוש משימות חשובות ליום');
      for (const id of list) {
        const t = getTask(d, id);
        if (!t.scheduledDate && ['todo', 'inProgress'].includes(t.status)) setScheduled(t, date, ctx, 'priority');
      }
      if (list.length) d.dailyPriorities[date] = list; else delete d.dailyPriorities[date];
    },
  },
  archiveRecurringRule: {
    label: 'הפסקת משימה חוזרת',
    run(d, { id }, ctx) {
      const r = d.recurringRules.find((x) => x.id === id) || fail('not-found', 'המשימה החוזרת לא נמצאה');
      r.archived = true;
      if (!r.recurrence.endDate) r.recurrence.endDate = addDays(ctx.today, -1) >= r.recurrence.startDate ? addDays(ctx.today, -1) : r.recurrence.startDate;
      r.updatedAt = ctx.nowIso;
    },
  },

  // ===== inquiry counter =====
  changeCount: {
    label: 'מונה פניות',
    run(d, { date, delta }) {
      optDate(date, 'תאריך') || fail('date', 'חסר תאריך');
      if (delta !== 1 && delta !== -1) fail('delta', 'שינוי לא תקין');
      const next = countFor(d, date) + delta;
      if (next < 0) fail('negative', 'המונה כבר באפס');
      if (next === 0) delete d.inquiryCounts[date]; else d.inquiryCounts[date] = next;
      return next;
    },
  },
  resetCount: {
    label: 'איפוס מונה הפניות',
    run(d, { date }) {
      optDate(date, 'תאריך') || fail('date', 'חסר תאריך');
      delete d.inquiryCounts[date];
      return 0;
    },
  },

  // ===== day notes, backup =====
  saveDayNote: {
    label: 'שמירת הערות',
    persist: 'debounced',
    run(d, { date, notes }, ctx) {
      optDate(date, 'תאריך') || fail('date', 'חסר תאריך');
      const cur = { ...(d.dayNotes[date] || {}) };
      cur.notes = cleanText(notes);
      cur.updatedAt = ctx.nowIso;
      // Legacy `accomplishments` text is kept untouched.
      if (!cur.notes && !cur.accomplishments) delete d.dayNotes[date]; else d.dayNotes[date] = cur;
    },
  },
  markBackupExported: {
    label: 'רישום גיבוי',
    run(d, { kind }, ctx) {
      d.settings.backup = { ...d.settings.backup, lastExportAt: ctx.nowIso, lastExportKind: kind || 'download' };
    },
  },

  // ===== import (automated: may never change recurring activities) =====
  importPlan: {
    label: 'ייבוא תוכנית',
    snapshot: 'לפני ייבוא תוכנית',
    automated: true,
    run(d, p, ctx) {
      try {
        return applyPlanImport(d, p, ctx);
      } catch (e) {
        if (e.messageHe) fail(e.code, e.messageHe);
        throw e;
      }
    },
  },
  undoImport: {
    label: 'ביטול ייבוא',
    snapshot: 'לפני ביטול ייבוא',
    automated: true,
    run(d, p, ctx) {
      try {
        return applyUndoImport(d, p, ctx);
      } catch (e) {
        if (e.messageHe) fail(e.code, e.messageHe);
        throw e;
      }
    },
  },
};
