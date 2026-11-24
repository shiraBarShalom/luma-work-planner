// Validated commands. Each command mutates a draft copy of the state; the store validates
// the resulting document and commits atomically (or not at all). Commands that need the
// user's explicit approval return `needConfirm(...)` without changing anything.
import { isValidDate, isValidTime, toMin, fromMin, addDays, weekStart, weekDates } from './dates.js';
import { LIMITS } from './config.js';
import { TASK_STATUSES, PRIORITIES, INQUIRY_KINDS, INQUIRY_CATEGORIES, QUESTION_AUDIENCES, QUESTION_STATUSES, MEETING_TYPES, MEETING_STATUSES, BLOCK_STATUSES, ISSUE_STATUSES, CARRYOVER_POLICIES } from './data/schema.js';
import { effectiveDay, routineBlocks, templateVersionFor, findTemplate, OVERRIDE_FIELDS } from './engine/dayTemplates.js';
import { dayOccurrences, findOccurrence, parseOccId, meetingTimes } from './engine/schedule.js';
import { recurrenceErrors } from './engine/recurrence.js';
import { materializedOccurrence, ruleOccKey, dueDateOf } from './engine/taskCarryover.js';
import { checkEvents, eventsForDate, lastUndoable, remainingOf } from './engine/inquiries.js';
import { closureSnapshot } from './engine/dayClosing.js';
import { applyPlanImport, applyUndoImport } from './data/importPlan.js';

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
const optMinutes = (v, label, min = 1) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > 1440) fail('minutes', `${label}: מספר דקות לא תקין`);
  return n;
};
function getTask(d, id) { return d.tasks.find((t) => t.id === id) || fail('not-found', 'המשימה לא נמצאה'); }
function getQuestion(d, id) { return d.questions.find((q) => q.id === id) || fail('not-found', 'השאלה לא נמצאה'); }
function getMeeting(d, id) { return d.meetings.find((m) => m.id === id) || fail('not-found', 'הפגישה לא נמצאה'); }
function touch(e, ctx) { e.updatedAt = ctx.nowIso; e.editedAt = ctx.nowIso; }
function catOrDefault(d, id, fallback = 'admin') {
  if (id && d.settings.categories.some((c) => c.id === id)) return id;
  if (id) fail('category', 'קטגוריה לא מוכרת');
  return d.settings.categories.some((c) => c.id === fallback) ? fallback : d.settings.categories[0].id;
}

function newTask(d, p, ctx) {
  const scheduledDate = optDate(p.scheduledDate, 'תאריך ביצוע');
  const subs = Array.isArray(p.subtasks) ? p.subtasks : [];
  if (subs.length > LIMITS.subtasks) fail('subtasks', 'יותר מדי תתי־משימות');
  return {
    id: ctx.uid(),
    title: requireTitle(p.title),
    details: cleanText(p.details),
    categoryId: catOrDefault(d, p.categoryId),
    priority: PRIORITIES.includes(p.priority) ? p.priority : 'medium',
    status: 'todo',
    originalScheduledDate: scheduledDate,
    scheduledDate,
    deadline: optDate(p.deadline, 'מועד יעד'),
    estimateMinutes: optMinutes(p.estimateMinutes, 'הערכת זמן'),
    actualMinutes: null,
    subtasks: subs.map((s) => (typeof s === 'string' ? s : s.title)).map((t) => cleanText(t, LIMITS.title)).filter(Boolean).map((title) => ({ id: ctx.uid(), title, done: false })),
    recurringRuleId: null,
    occurrenceDate: null,
    assignedBlock: null,
    assignmentManual: false,
    pinned: false,
    preferredRole: p.preferredRole || null,
    meetingId: p.meetingId || null,
    questionId: p.questionId || null,
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

/** Materialize a recurring occurrence as a task record (idempotent). */
function materialize(d, ruleId, date, ctx) {
  const existing = materializedOccurrence(d, ruleId, date) || d.tasks.find((t) => t.recurringRuleId === ruleId && t.occurrenceDate === date);
  if (existing) return existing;
  const rule = d.recurringRules.find((r) => r.id === ruleId) || fail('not-found', 'הכלל החוזר לא נמצא');
  const t = newTask(d, { title: rule.title, details: rule.details, categoryId: rule.categoryId, priority: rule.priority, estimateMinutes: rule.estimateMinutes, scheduledDate: date, subtasks: rule.subtasks, preferredRole: rule.preferredRole, source: { kind: 'recurring', ruleId } }, ctx);
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
    const p = parseOccId(t.assignedBlock);
    const occDate = p?.date || null;
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
function intervalChecks(d, date, s, e, ignore = new Set(), ctx) {
  const reasons = [];
  if (!(e > s)) fail('interval', 'שעת הסיום חייבת להיות אחרי שעת ההתחלה');
  if (s < 0 || e > 24 * 60) fail('interval', 'הפעילות חייבת להיות בתוך היום');
  const eff = effectiveDay(d, date);
  if (!eff.isWorking) reasons.push({ code: 'offDay', message: 'זה אינו יום עבודה מוגדר. לשבץ בכל זאת?' });
  else if (s < toMin(eff.workStart) || e > toMin(eff.workEnd)) reasons.push({ code: 'outsideHours', message: `הפעילות חורגת משעות העבודה (${eff.workStart}–${eff.workEnd}). להמשיך?` });
  for (const o of dayOccurrences(d, date)) {
    if (ignore.has(o.id) || o.status === 'canceled' || o.status === 'skipped') continue;
    if (o.s < e && s < o.e) {
      if (o.kind === 'meeting') reasons.push({ code: 'meetingOverlap', message: `חופף לפגישה ״${o.title}״ (${o.start}–${o.end}). לאשר חפיפה?` });
      else if (o.protected) reasons.push({ code: 'protectedOverlap', message: `חופף ל״${o.title}״ המוגן (${o.start}–${o.end}). לאשר חפיפה?` });
    }
  }
  if (ctx && date < ctx.today) reasons.push({ code: 'past', message: 'זה תאריך שעבר. לשנות את ההיסטוריה בכל זאת?' });
  return reasons;
}

function setOverride(d, occId, fields, ctx) {
  const prev = d.occurrenceOverrides[occId] || {};
  d.occurrenceOverrides[occId] = { ...prev, ...fields, manual: true, updatedAt: ctx.nowIso };
}

function newBlock(d, p, ctx) {
  return {
    id: ctx.uid(), date: p.date, start: p.start, end: p.end, title: requireTitle(p.title), categoryId: catOrDefault(d, p.categoryId),
    role: p.role || null, notes: cleanText(p.notes), pinned: !!p.pinned, recurrence: p.recurrence || null,
    source: p.source || 'manual', movedFrom: p.movedFrom || null, protected: !!p.protected, flexible: p.flexible !== false,
    minMinutes: p.minMinutes || 0, instructions: p.instructions || [], createdAt: ctx.nowIso, updatedAt: ctx.nowIso,
  };
}

function reassignTasks(d, fromOcc, toOcc, newDate, ctx) {
  for (const t of d.tasks) {
    if (t.assignedBlock !== fromOcc) continue;
    t.assignedBlock = toOcc;
    if (newDate && t.scheduledDate && t.scheduledDate !== newDate && t.status !== 'done') {
      t.scheduleHistory.push({ from: t.scheduledDate, to: newDate, at: ctx.nowIso, by: 'block-move' });
      t.scheduledDate = newDate;
    }
    t.updatedAt = ctx.nowIso;
  }
}

/** Move a generated occurrence to another date: source exclusion + one destination block. */
function moveOccToDate(d, o, date, start, end, ctx) {
  if (o.kind === 'block') {
    const b = d.calendarBlocks.find((x) => x.id === o.id);
    b.date = date; b.start = start; b.end = end; b.updatedAt = ctx.nowIso;
    reassignTasks(d, o.id, o.id, date, ctx);
    return o.id;
  }
  if (o.kind === 'meeting') {
    const m = getMeeting(d, o.sourceId);
    const len = toMin(end) - toMin(start);
    Object.assign(m, { date, start, end, durationMinutes: m.durationMinutes ? len : m.durationMinutes });
    touch(m, ctx);
    return o.id;
  }
  setOverride(d, o.id, { excluded: true }, ctx);
  const nb = newBlock(d, {
    date, start, end, title: o.title, categoryId: o.categoryId, role: o.role, notes: o.notes, pinned: o.pinned, source: 'moved', movedFrom: o.id,
    protected: o.protected, flexible: o.flexible, minMinutes: o.minMinutes, instructions: o.instructions,
  }, ctx);
  d.calendarBlocks.push(nb);
  if (d.blockCompletions[o.id]) { d.blockCompletions[nb.id] = d.blockCompletions[o.id]; delete d.blockCompletions[o.id]; }
  reassignTasks(d, o.id, nb.id, date, ctx);
  return nb.id;
}

function applyOccFields(d, o, ch, ctx) {
  if (o.kind === 'block') {
    const b = d.calendarBlocks.find((x) => x.id === o.id);
    for (const f of ['start', 'end', 'title', 'notes', 'categoryId', 'pinned']) if (ch[f] !== undefined) b[f] = ch[f];
    b.updatedAt = ctx.nowIso;
    b.editedAt = ctx.nowIso;
  } else if (o.kind === 'meeting') {
    const m = getMeeting(d, o.sourceId);
    if (ch.title !== undefined) m.title = ch.title;
    if (ch.start !== undefined) m.start = ch.start;
    if (ch.end !== undefined) { m.end = ch.end; m.durationMinutes = null; }
    touch(m, ctx);
  } else {
    const f = {};
    for (const k of ['start', 'end', 'title', 'notes', 'categoryId', 'pinned']) if (ch[k] !== undefined) f[k] = ch[k];
    setOverride(d, o.id, f, ctx);
  }
}

function normalizeChanges(d, ch) {
  const out = {};
  if (ch.title !== undefined) out.title = requireTitle(ch.title);
  if (ch.start !== undefined) out.start = optTime(ch.start, 'שעת התחלה');
  if (ch.end !== undefined) out.end = optTime(ch.end, 'שעת סיום');
  if (ch.notes !== undefined) out.notes = cleanText(ch.notes);
  if (ch.categoryId !== undefined) out.categoryId = catOrDefault(d, ch.categoryId);
  if (ch.pinned !== undefined) out.pinned = !!ch.pinned;
  if (ch.date !== undefined) out.date = optDate(ch.date, 'תאריך');
  return out;
}

function templateVersionCopyFrom(d, templateId, date, ctx) {
  const tpl = findTemplate(d, templateId);
  const base = templateVersionFor(d, tpl.id, date);
  let ver = tpl.versions.find((v) => v.effectiveFrom === date);
  if (!ver) {
    ver = { ...structuredClone(base), id: ctx.uid(), effectiveFrom: date };
    tpl.versions.push(ver);
  }
  return ver;
}

// ---------- commands ----------
/** @type {Record<string, {label:string, persist?:'immediate'|'debounced', snapshot?:string, run:(d:any, p:any, ctx:any)=>any}>} */
export const COMMANDS = {
  // ===== settings & calendar =====
  updateSettings: {
    label: 'עדכון הגדרות',
    run(d, p, ctx) {
      const allowed = ['displayName', 'theme', 'reducedMotion', 'showGuidance', 'planner', 'backup', 'header', 'taskTemplates', 'closingChecklist'];
      for (const [k, v] of Object.entries(p.patch || {})) {
        if (!allowed.includes(k)) fail('field', `שדה לא מוכר: ${k}`);
        if (k === 'displayName') d.settings.displayName = cleanText(v, 40);
        else if (k === 'theme') { if (!['auto', 'light', 'dark'].includes(v)) fail('theme', 'ערך לא תקין'); d.settings.theme = v; }
        else if (k === 'reducedMotion') { if (!['auto', 'reduce'].includes(v)) fail('motion', 'ערך לא תקין'); d.settings.reducedMotion = v; }
        else if (k === 'showGuidance') d.settings.showGuidance = !!v;
        else if (k === 'planner') {
          const pl = { ...d.settings.planner, ...v };
          if (!(Number.isInteger(pl.assumedEstimateMinutes) && pl.assumedEstimateMinutes > 0 && pl.assumedEstimateMinutes <= 480)) fail('planner', 'הערכת ברירת מחדל לא תקינה');
          for (const key of ['deadlineSoonDays', 'clusterDays', 'clusterCount']) if (!(Number.isInteger(pl[key]) && pl[key] >= 1 && pl[key] <= 30)) fail('planner', 'ערך לא תקין');
          d.settings.planner = pl;
        } else if (k === 'backup') {
          const b = { ...d.settings.backup, ...v };
          if (!(Number.isInteger(b.reminderDays) && b.reminderDays >= 0 && b.reminderDays <= 365)) fail('backup', 'תדירות תזכורת לא תקינה');
          d.settings.backup = b;
        } else if (k === 'header') d.settings.header = { ...d.settings.header, ...structuredClone(v) };
        else if (k === 'taskTemplates') {
          if (!Array.isArray(v) || v.length > 50) fail('templates', 'רשימת תבניות לא תקינה');
          d.settings.taskTemplates = v.map((t) => ({ id: t.id || ctx.uid(), title: requireTitle(t.title), categoryId: catOrDefault(d, t.categoryId), priority: PRIORITIES.includes(t.priority) ? t.priority : 'medium', estimateMinutes: optMinutes(t.estimateMinutes, 'הערכה'), subtasks: (t.subtasks || []).map((s) => cleanText(s, LIMITS.title)).filter(Boolean) }));
        } else if (k === 'closingChecklist') {
          if (!Array.isArray(v) || !v.length || v.length > 20) fail('checklist', 'נדרש לפחות פריט אחד');
          const ids = new Set();
          d.settings.closingChecklist = v.map((x) => {
            const id = cleanText(x.id, 60) || `c-${ids.size}`;
            if (ids.has(id)) fail('checklist', 'מזהה כפול');
            ids.add(id);
            return { id, label: requireTitle(x.label) };
          });
        }
      }
    },
  },
  setWeeklyDay: {
    label: 'עדכון לוח העבודה השבועי',
    run(d, { weekday, patch }) {
      if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) fail('weekday', 'יום לא תקין');
      const cur = { ...d.settings.weekly[weekday] };
      if (patch.isWorking !== undefined) cur.isWorking = !!patch.isWorking;
      if (patch.location !== undefined) cur.location = patch.location;
      if (patch.phoneDuty !== undefined) cur.phoneDuty = !!patch.phoneDuty;
      if (patch.workStart !== undefined) cur.workStart = optTime(patch.workStart, 'התחלה');
      if (patch.workEnd !== undefined) cur.workEnd = optTime(patch.workEnd, 'סיום');
      if (cur.isWorking && !cur.location) cur.location = 'office';
      if (!cur.isWorking) cur.phoneDuty = false;
      d.settings.weekly[weekday] = cur;
    },
  },
  setWorkWindows: {
    label: 'עדכון שעות עבודה ותורנות',
    run(d, { workHours, phoneDutyWindow }) {
      for (const [k, w] of [['workHours', workHours], ['phoneDutyWindow', phoneDutyWindow]]) {
        if (!w) continue;
        if (!isValidTime(w.start) || !isValidTime(w.end) || toMin(w.end) <= toMin(w.start)) fail('window', 'טווח שעות לא תקין');
        d.settings[k] = { start: w.start, end: w.end };
      }
    },
  },
  setDayOverride: {
    label: 'עדכון הגדרות יום',
    run(d, { date, patch }, ctx) {
      optDate(date, 'תאריך') || fail('date', 'חסר תאריך');
      const cur = { ...(d.dayOverrides[date] || {}) };
      for (const [k, v] of Object.entries(patch || {})) {
        if (!OVERRIDE_FIELDS.includes(k)) fail('field', `שדה לא מוכר: ${k}`);
        if (v === null || v === '') delete cur[k];
        else if (k === 'inquiryTarget') { const n = Number(v); if (!Number.isInteger(n) || n < 0 || n > 1000) fail('target', 'יעד לא תקין'); cur[k] = n; }
        else if (['workStart', 'workEnd', 'phoneStart', 'phoneEnd'].includes(k)) cur[k] = optTime(v, 'שעה');
        else if (k === 'label' || k === 'note') cur[k] = cleanText(v, k === 'label' ? 80 : LIMITS.text);
        else cur[k] = v;
      }
      const eff = { ...effectiveDay(d, date), ...cur };
      if (toMin(eff.workEnd) <= toMin(eff.workStart)) fail('hours', 'סוף יום העבודה חייב להיות אחרי תחילתו');
      if (toMin(eff.phoneEnd) <= toMin(eff.phoneStart)) fail('hours', 'סוף התורנות חייב להיות אחרי תחילתה');
      const keys = Object.keys(cur).filter((k) => k !== 'importRef' && k !== 'editedAt');
      if (!keys.length) delete d.dayOverrides[date];
      else d.dayOverrides[date] = { ...cur, editedAt: ctx.nowIso };
    },
  },
  setWeekOverride: {
    label: 'עדכון דפוס שבוע',
    run(d, { weekStart: ws, weekday, patch }) {
      if (!isValidDate(ws) || weekStart(ws) !== ws) fail('week', 'תחילת שבוע לא תקינה');
      const wo = d.weekOverrides[ws] || { days: {} };
      const cur = { ...(wo.days[String(weekday)] || {}) };
      for (const [k, v] of Object.entries(patch || {})) {
        if (!['isWorking', 'location', 'phoneDuty', 'workStart', 'workEnd', 'templateId'].includes(k)) fail('field', `שדה לא מוכר: ${k}`);
        if (v === null || v === '') delete cur[k]; else cur[k] = v;
      }
      if (Object.keys(cur).length) wo.days[String(weekday)] = cur; else delete wo.days[String(weekday)];
      if (Object.keys(wo.days).length) d.weekOverrides[ws] = wo; else delete d.weekOverrides[ws];
    },
  },
  setDefaultTarget: {
    label: 'עדכון יעד פניות',
    run(d, { target, effectiveFrom }, ctx) {
      const n = Number(target);
      if (!Number.isInteger(n) || n < 0 || n > 1000) fail('target', 'יעד לא תקין');
      const from = optDate(effectiveFrom, 'תאריך תחולה') || ctx.today;
      if (from < ctx.today) fail('past', 'אי אפשר לשנות יעד רטרואקטיבית. לשינוי יום שעבר יש לערוך את היום עצמו.');
      d.targetHistory.defaults = d.targetHistory.defaults.filter((v) => v.effectiveFrom !== from);
      d.targetHistory.defaults.push({ effectiveFrom: from, target: n, setAt: ctx.nowIso });
      d.targetHistory.defaults.sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
    },
  },
  saveTemplateVersion: {
    label: 'עדכון תבנית יום',
    run(d, { templateId, effectiveFrom, blocks, nominalStart, nominalEnd, name }, ctx) {
      const tpl = findTemplate(d, templateId);
      if (!tpl || tpl.id !== templateId) fail('not-found', 'התבנית לא נמצאה');
      const from = optDate(effectiveFrom, 'תאריך תחולה') || ctx.today;
      if (from < ctx.today) fail('past', 'שינוי תבנית חל מהיום והלאה בלבד; ימים שעברו נשמרים כפי שהיו.');
      if (d.dailyReports[from]?.closedAt) fail('closed', 'היום הזה כבר נסגר. יש לבחור תאריך תחולה מאוחר יותר.');
      if (!Array.isArray(blocks) || !blocks.length) fail('blocks', 'התבנית חייבת לכלול לפחות בלוק אחד');
      const roles = new Set();
      const clean = blocks.map((b) => {
        const role = cleanText(b.role, 60) || `custom-${ctx.uid().slice(0, 8)}`;
        if (roles.has(role)) fail('role', 'תפקיד בלוק כפול');
        roles.add(role);
        if (!isValidTime(b.start) || !isValidTime(b.end) || toMin(b.end) <= toMin(b.start)) fail('time', `שעות לא תקינות ב״${b.title}״`);
        return {
          role, title: requireTitle(b.title), start: b.start, end: b.end, categoryId: catOrDefault(d, b.categoryId),
          protected: !!b.protected, flexible: !!b.flexible, minMinutes: Math.max(0, Math.min(600, Number(b.minMinutes) || 0)),
          anchor: ['start', 'end'].includes(b.anchor) ? b.anchor : null,
          instructions: (b.instructions || []).map((x) => cleanText(x, 200)).filter(Boolean).slice(0, 10),
        };
      }).sort((a, b) => toMin(a.start) - toMin(b.start));
      for (let i = 1; i < clean.length; i++) if (toMin(clean[i].start) < toMin(clean[i - 1].end)) fail('overlap', `בלוקים חופפים בתבנית: ${clean[i - 1].title} / ${clean[i].title}`);
      const ns = optTime(nominalStart, 'התחלה') || clean[0].start;
      const ne = optTime(nominalEnd, 'סיום') || clean[clean.length - 1].end;
      const existing = tpl.versions.find((v) => v.effectiveFrom === from);
      if (existing) Object.assign(existing, { blocks: clean, nominalStart: ns, nominalEnd: ne });
      else tpl.versions.push({ id: ctx.uid(), effectiveFrom: from, nominalStart: ns, nominalEnd: ne, blocks: clean });
      tpl.versions.sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
      if (name) tpl.name = requireTitle(name);
    },
  },
  addTemplate: {
    label: 'יצירת תבנית יום',
    run(d, { name, copyFrom }, ctx) {
      const src = findTemplate(d, copyFrom || d.settings.defaultTemplateId);
      const ver = templateVersionFor(d, src.id, ctx.today);
      const id = `tpl-${ctx.uid().slice(0, 8)}`;
      d.dayTemplates.push({ id, name: requireTitle(name), versions: [{ ...structuredClone(ver), id: 'v1', effectiveFrom: '2000-01-01' }] });
      return id;
    },
  },
  deleteTemplate: {
    label: 'מחיקת תבנית יום',
    run(d, { templateId }) {
      if (templateId === d.settings.defaultTemplateId) fail('default', 'אי אפשר למחוק את תבנית ברירת המחדל');
      const used = Object.values(d.dayOverrides).some((o) => o.templateId === templateId) ||
        Object.values(d.weekOverrides).some((w) => Object.values(w.days).some((x) => x.templateId === templateId)) ||
        d.settings.weekly.some((w) => w.templateId === templateId);
      if (used) fail('in-use', 'התבנית בשימוש בימים מסוימים. יש להסיר את השימוש לפני המחיקה.');
      const closedWith = Object.values(d.dailyReports).some((r) => r.snapshot?.context?.templateId === templateId);
      if (closedWith) fail('history', 'התבנית שימשה בימים שנסגרו ונשמרת לצורך ההיסטוריה.');
      d.dayTemplates = d.dayTemplates.filter((t) => t.id !== templateId);
    },
  },
  saveCategory: {
    label: 'עדכון קטגוריה',
    run(d, { id, label, color, roles, plannerWeight, batchAtEnd, archived }, ctx) {
      if (color != null && !/^#[0-9a-fA-F]{6}$/.test(color)) fail('color', 'צבע לא תקין');
      let c = id ? d.settings.categories.find((x) => x.id === id) : null;
      if (!c) {
        c = { id: id || `cat-${ctx.uid().slice(0, 8)}`, label: '', color: color || '#526273', roles: [], plannerWeight: 0, archived: false };
        d.settings.categories.push(c);
      }
      if (label !== undefined) c.label = requireTitle(label).slice(0, 80);
      if (color !== undefined) c.color = color;
      if (roles !== undefined) c.roles = (roles || []).filter((r) => typeof r === 'string').slice(0, 10);
      if (plannerWeight !== undefined) c.plannerWeight = Math.max(0, Math.min(3, Number(plannerWeight) || 0));
      if (batchAtEnd !== undefined) c.batchAtEnd = !!batchAtEnd;
      if (archived !== undefined) {
        if (archived && d.settings.categories.filter((x) => !x.archived).length <= 1) fail('last', 'נדרשת לפחות קטגוריה פעילה אחת');
        c.archived = !!archived;
      }
      return c.id;
    },
  },

  // ===== schedule blocks =====
  addBlock: {
    label: 'הוספת פעילות',
    run(d, p, ctx) {
      const date = optDate(p.date, 'תאריך') || fail('date', 'חסר תאריך');
      const start = optTime(p.start, 'שעת התחלה') || fail('time', 'חסרה שעת התחלה');
      const end = optTime(p.end, 'שעת סיום') || fail('time', 'חסרה שעת סיום');
      if (p.recurrence) {
        const errs = recurrenceErrors({ ...p.recurrence, startDate: p.recurrence.startDate || date }, isValidDate);
        if (errs.length) fail('recurrence', errs.join(', '));
      }
      const reasons = intervalChecks(d, date, toMin(start), toMin(end), new Set(), ctx);
      if (reasons.length && !p.confirm) return needConfirm(reasons);
      const b = newBlock(d, { ...p, date, start, end, recurrence: p.recurrence ? { ...p.recurrence, startDate: p.recurrence.startDate || date } : null }, ctx);
      d.calendarBlocks.push(b);
      return b.recurrence ? `${b.id}@${date}` : b.id;
    },
  },
  updateOccurrence: {
    label: 'עריכת פעילות',
    run(d, { occId, changes, scope = 'this', confirm }, ctx) {
      const o = findOccurrence(d, occId) || fail('not-found', 'הפעילות לא נמצאה');
      const ch = normalizeChanges(d, changes || {});
      const date = ch.date || o.date;
      const start = ch.start || o.start, end = ch.end || o.end;
      const reasons = intervalChecks(d, date, toMin(start), toMin(end), new Set([o.id]), ctx);
      if (o.status !== 'planned' && o.date < ctx.today) reasons.push({ code: 'history', message: 'הפעילות כבר סומנה בעבר. לשנות את הרשומה ההיסטורית?' });
      if (date !== o.date && o.kind === 'routine') {
        const analog = routineBlocks(d, date).blocks.find((b) => b.role === o.role);
        if (analog && !d.occurrenceOverrides[analog.id]?.excluded) reasons.push({ code: 'analogous', message: `ביום היעד כבר קיים ״${analog.title}״. להוסיף בכל זאת (ללא מיזוג)?` });
      }
      if (reasons.length && !confirm) return needConfirm(reasons);
      if (date !== o.date) {
        if (scope !== 'this') fail('scope', 'העברה ליום אחר אפשרית למופע הזה בלבד');
        const nid = moveOccToDate(d, o, date, start, end, ctx);
        const rest = { ...ch }; delete rest.date; delete rest.start; delete rest.end;
        if (Object.keys(rest).length) applyOccFields(d, findOccurrence(d, nid), rest, ctx);
        return nid;
      }
      if (scope === 'this' || o.kind === 'block' || o.kind === 'meeting') { applyOccFields(d, o, ch, ctx); return o.id; }
      if (o.kind === 'routine') {
        if (scope === 'week') {
          for (const day of weekDates(weekStart(o.date))) {
            if (day < o.date) continue;
            const rb = routineBlocks(d, day).blocks.find((b) => b.role === o.role);
            if (rb) setOverride(d, rb.id, ch, ctx);
          }
          return o.id;
        }
        if (scope === 'future') {
          if (o.date < ctx.today) fail('past', 'שינוי תבנית חל מהיום והלאה בלבד');
          const ver = templateVersionCopyFrom(d, o.templateId, o.date, ctx);
          const b = ver.blocks.find((x) => x.role === o.role) || fail('role', 'הבלוק לא נמצא בתבנית');
          for (const f of ['start', 'end', 'title', 'categoryId']) if (ch[f] !== undefined) b[f] = ch[f];
          ver.blocks.sort((a, c) => toMin(a.start) - toMin(c.start));
          delete d.occurrenceOverrides[o.id];
          return o.id;
        }
        fail('scope', 'שינוי ״כל המופעים״ אינו זמין לתבנית; ימים שעברו נשמרים כפי שהיו');
      }
      // user recurring series
      const b = d.calendarBlocks.find((x) => x.id === o.sourceId);
      if (scope === 'week') {
        for (const day of weekDates(weekStart(o.date))) {
          if (day < o.date) continue;
          const occ = dayOccurrences(d, day).find((x) => x.sourceId === b.id);
          if (occ) setOverride(d, occ.id, ch, ctx);
        }
        return o.id;
      }
      if (scope === 'future' && o.date > b.recurrence.startDate) {
        const nb = { ...structuredClone(b), id: ctx.uid(), recurrence: { ...b.recurrence, startDate: o.date, exceptions: (b.recurrence.exceptions || []).filter((x) => x >= o.date) }, createdAt: ctx.nowIso, updatedAt: ctx.nowIso };
        b.recurrence = { ...b.recurrence, endDate: addDays(o.date, -1), exceptions: (b.recurrence.exceptions || []).filter((x) => x < o.date) };
        for (const f of ['start', 'end', 'title', 'notes', 'categoryId']) if (ch[f] !== undefined) nb[f] = ch[f];
        d.calendarBlocks.push(nb);
        // Keep completion and task links of future occurrences with the new series.
        for (const key of Object.keys(d.blockCompletions)) {
          const p = parseOccId(key);
          if (p?.kind === 'series' && p.blockId === b.id && p.date >= o.date) { d.blockCompletions[`${nb.id}@${p.date}`] = d.blockCompletions[key]; delete d.blockCompletions[key]; }
        }
        for (const key of Object.keys(d.occurrenceOverrides)) {
          const p = parseOccId(key);
          if (p?.kind === 'series' && p.blockId === b.id && p.date >= o.date) { d.occurrenceOverrides[`${nb.id}@${p.date}`] = d.occurrenceOverrides[key]; delete d.occurrenceOverrides[key]; }
        }
        for (const t of d.tasks) {
          const p = parseOccId(t.assignedBlock);
          if (p?.kind === 'series' && p.blockId === b.id && p.date >= o.date) t.assignedBlock = `${nb.id}@${p.date}`;
        }
        return `${nb.id}@${o.date}`;
      }
      for (const f of ['start', 'end', 'title', 'notes', 'categoryId']) if (ch[f] !== undefined) b[f] = ch[f];
      b.updatedAt = ctx.nowIso;
      return o.id;
    },
  },
  setBlockStatus: {
    label: 'עדכון סטטוס בלוק',
    run(d, { occId, status, actualMinutes }, ctx) {
      const o = findOccurrence(d, occId) || fail('not-found', 'הפעילות לא נמצאה');
      if (!BLOCK_STATUSES.includes(status)) fail('status', 'סטטוס לא תקין');
      if (o.kind === 'meeting') fail('meeting', 'סטטוס פגישה מתעדכן במסך הפגישה');
      const act = actualMinutes === undefined ? d.blockCompletions[occId]?.actualMinutes ?? null : optMinutes(actualMinutes, 'דקות בפועל', 0);
      if (status === 'planned' && act == null) delete d.blockCompletions[occId];
      else d.blockCompletions[occId] = { status, actualMinutes: act, updatedAt: ctx.nowIso };
    },
  },
  deleteOccurrence: {
    label: 'מחיקת פעילות',
    run(d, { occId, scope = 'this', confirm }, ctx) {
      const o = findOccurrence(d, occId) || fail('not-found', 'הפעילות לא נמצאה');
      if (o.kind === 'meeting') fail('meeting', 'ביטול פגישה נעשה במסך הפגישה');
      if (o.status !== 'planned' && !confirm) return needConfirm([{ code: 'history', message: 'לפעילות יש רישום ביצוע. למחוק בכל זאת?' }]);
      const unlink = (id) => { for (const t of d.tasks) if (t.assignedBlock === id) { t.assignedBlock = null; t.assignmentManual = false; t.updatedAt = ctx.nowIso; } };
      if (o.kind === 'block') {
        d.calendarBlocks = d.calendarBlocks.filter((b) => b.id !== o.id);
        delete d.blockCompletions[o.id];
        unlink(o.id);
        return;
      }
      if (scope === 'this') {
        setOverride(d, o.id, { excluded: true }, ctx);
        delete d.blockCompletions[o.id];
        unlink(o.id);
        return;
      }
      if (o.kind === 'routine') {
        if (scope !== 'future') fail('scope', 'אפשרות לא זמינה לתבנית');
        if (o.date < ctx.today) fail('past', 'שינוי תבנית חל מהיום והלאה בלבד');
        const ver = templateVersionCopyFrom(d, o.templateId, o.date, ctx);
        if (ver.blocks.length <= 1) fail('last', 'התבנית חייבת לכלול לפחות בלוק אחד');
        ver.blocks = ver.blocks.filter((b) => b.role !== o.role);
        return;
      }
      const b = d.calendarBlocks.find((x) => x.id === o.sourceId);
      const hasHistory = Object.keys(d.blockCompletions).some((k) => parseOccId(k)?.blockId === b.id && parseOccId(k).date < o.date);
      if (scope === 'all' && hasHistory) fail('history', 'לסדרה יש היסטוריית ביצוע. אפשר למחוק ״מהמופע הזה והלאה״ כדי לשמור את ההיסטוריה.');
      if (scope === 'all' || o.date <= b.recurrence.startDate) {
        d.calendarBlocks = d.calendarBlocks.filter((x) => x.id !== b.id);
        for (const k of Object.keys(d.occurrenceOverrides)) if (parseOccId(k)?.blockId === b.id) delete d.occurrenceOverrides[k];
        for (const k of Object.keys(d.blockCompletions)) if (parseOccId(k)?.blockId === b.id) delete d.blockCompletions[k];
        for (const t of d.tasks) if (parseOccId(t.assignedBlock)?.blockId === b.id) { t.assignedBlock = null; t.assignmentManual = false; }
      } else {
        b.recurrence = { ...b.recurrence, endDate: addDays(o.date, -1) };
        for (const k of Object.keys(d.blockCompletions)) { const p = parseOccId(k); if (p?.blockId === b.id && p.date >= o.date) delete d.blockCompletions[k]; }
        for (const t of d.tasks) { const p = parseOccId(t.assignedBlock); if (p?.blockId === b.id && p.date >= o.date) { t.assignedBlock = null; t.assignmentManual = false; } }
      }
    },
  },
  duplicateOccurrence: {
    label: 'שכפול פעילות',
    run(d, { occId, date, confirm }, ctx) {
      const o = findOccurrence(d, occId) || fail('not-found', 'הפעילות לא נמצאה');
      const len = o.e - o.s;
      const target = date || o.date;
      const s = Math.min(target === o.date ? o.e : o.s, 24 * 60 - 1 - len);
      const reasons = intervalChecks(d, target, s, s + len, new Set(), ctx);
      if (reasons.length && !confirm) return needConfirm(reasons);
      const b = newBlock(d, { date: target, start: fromMin(s), end: fromMin(s + len), title: o.title, categoryId: o.categoryId, role: o.role, notes: o.notes, source: 'duplicate', flexible: o.flexible, minMinutes: o.minMinutes }, ctx);
      d.calendarBlocks.push(b);
      return b.id;
    },
  },
  splitOccurrence: {
    label: 'פיצול פעילות',
    run(d, { occId, at, secondTaskIds = [] }, ctx) {
      const o = findOccurrence(d, occId) || fail('not-found', 'הפעילות לא נמצאה');
      if (o.kind === 'meeting') fail('meeting', 'אי אפשר לפצל פגישה');
      const m = typeof at === 'string' ? toMin(at) : at;
      if (!(m >= o.s + 5 && m <= o.e - 5)) fail('at', 'נקודת הפיצול חייבת להיות בתוך הפעילות');
      const second = newBlock(d, { date: o.date, start: fromMin(m), end: o.end, title: o.title, categoryId: o.categoryId, role: o.role, notes: o.notes, source: 'split', flexible: o.flexible, minMinutes: 0, instructions: o.instructions }, ctx);
      d.calendarBlocks.push(second);
      applyOccFields(d, o, { end: fromMin(m) }, ctx);
      for (const t of d.tasks) if (t.assignedBlock === o.id && secondTaskIds.includes(t.id)) { t.assignedBlock = second.id; t.updatedAt = ctx.nowIso; }
      return second.id;
    },
  },
  mergeWithNext: {
    label: 'מיזוג עם הפעילות הבאה',
    run(d, { occId }, ctx) {
      const o = findOccurrence(d, occId) || fail('not-found', 'הפעילות לא נמצאה');
      const next = dayOccurrences(d, o.date).find((x) => x.id !== o.id && x.kind !== 'meeting' && x.s >= o.e && x.s <= o.e + 30 && x.status !== 'canceled');
      if (!next) fail('no-next', 'אין פעילות צמודה למיזוג');
      if (o.kind === 'meeting') fail('meeting', 'אי אפשר למזג פגישה');
      if (next.protected) fail('protected', `״${next.title}״ מוגן ואינו ממוזג`);
      if (next.status !== 'planned') fail('history', 'לפעילות הבאה יש רישום ביצוע ולכן אינה ממוזגת');
      reassignTasks(d, next.id, o.id, null, ctx);
      if (next.kind === 'block') d.calendarBlocks = d.calendarBlocks.filter((b) => b.id !== next.id);
      else setOverride(d, next.id, { excluded: true }, ctx);
      applyOccFields(d, o, { end: next.end }, ctx);
      return o.id;
    },
  },
  applyDelay: {
    label: 'טיפול בעיכוב',
    run(d, { proposal }, ctx) {
      for (const c of proposal.changes) {
        const o = findOccurrence(d, c.occId);
        if (!o) fail('stale', 'הלו״ז השתנה מאז ההצעה. יש לבנות אותה מחדש.');
        if (o.start !== c.before[0] || o.end !== c.before[1]) fail('stale', 'הלו״ז השתנה מאז ההצעה. יש לבנות אותה מחדש.');
        if (o.kind === 'meeting') continue;
        applyOccFields(d, o, { start: c.after[0], end: c.after[1] }, ctx);
      }
      for (const mv of proposal.moves || []) {
        const t = d.tasks.find((x) => x.id === mv.taskId);
        if (!t || t.status === 'done' || t.status === 'canceled') continue;
        setScheduled(t, mv.to, ctx, 'delay');
        t.assignedBlock = null;
        t.updatedAt = ctx.nowIso;
      }
    },
  },

  // ===== tasks =====
  addTask: {
    label: 'הוספת משימה',
    run(d, p, ctx) {
      if (p.recurrence) return COMMANDS.addRecurringRule.run(d, p, ctx);
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
      if (p.categoryId !== undefined) t.categoryId = catOrDefault(d, p.categoryId);
      if (p.priority !== undefined) { if (!PRIORITIES.includes(p.priority)) fail('priority', 'עדיפות לא תקינה'); t.priority = p.priority; }
      if (p.deadline !== undefined) t.deadline = optDate(p.deadline, 'מועד יעד');
      if (p.estimateMinutes !== undefined) t.estimateMinutes = optMinutes(p.estimateMinutes, 'הערכת זמן');
      if (p.actualMinutes !== undefined) t.actualMinutes = optMinutes(p.actualMinutes, 'זמן בפועל', 0);
      if (p.scheduledDate !== undefined) setScheduled(t, optDate(p.scheduledDate, 'תאריך ביצוע'), ctx);
      if (p.preferredRole !== undefined) t.preferredRole = p.preferredRole || null;
      if (p.pinned !== undefined) t.pinned = !!p.pinned;
      if (p.waitingNote !== undefined || p.followUpOn !== undefined) {
        t.waiting = { note: cleanText(p.waitingNote ?? t.waiting?.note ?? ''), followUpOn: optDate(p.followUpOn ?? t.waiting?.followUpOn, 'מועד מעקב') };
      }
      if (p.resumeOn !== undefined && t.status === 'deferred') t.resumeOn = optDate(p.resumeOn, 'תאריך חזרה') || fail('resume', 'נדרש תאריך חזרה');
      touch(t, ctx);
      return t.id;
    },
  },
  setTaskStatus: {
    label: 'עדכון סטטוס משימה',
    run(d, { id, status, resumeOn, waitingNote, followUpOn, confirm }, ctx) {
      if (!TASK_STATUSES.includes(status)) fail('status', 'סטטוס לא תקין');
      const t = resolveTask(d, id, ctx);
      if (status === 'done' && t.subtasks.some((s) => !s.done) && !confirm) {
        return needConfirm([{ code: 'subtasks', message: 'יש תתי־משימות שלא סומנו. לסמן את המשימה כהושלמה בכל זאת? (תתי־המשימות יישארו כפי שהן)' }]);
      }
      const prev = t.status;
      t.status = status;
      if (status === 'done') { t.completedAt = ctx.nowIso; t.completedOn = ctx.today; }
      else if (prev === 'done') { t.completedAt = null; t.completedOn = null; }
      if (status === 'canceled') t.canceledOn = ctx.today; else t.canceledOn = null;
      if (status === 'deferred') {
        t.resumeOn = optDate(resumeOn, 'תאריך חזרה') || fail('resume', 'לדחייה נדרש תאריך חזרה');
        t.assignedBlock = null;
      } else t.resumeOn = null;
      if (status === 'waiting') {
        t.waiting = { note: cleanText(waitingNote ?? t.waiting?.note ?? ''), followUpOn: optDate(followUpOn ?? t.waiting?.followUpOn, 'מועד מעקב') };
      }
      if (status !== 'waiting' && prev === 'waiting' && status !== 'done') t.waiting = t.waiting ? { ...t.waiting } : null;
      t.updatedAt = ctx.nowIso;
      return t.id;
    },
  },
  toggleTaskDone: {
    label: 'סימון משימה',
    run(d, { id, confirm }, ctx) {
      const t = resolveTask(d, id, ctx);
      if (t.status === 'done') return COMMANDS.setTaskStatus.run(d, { id: t.id, status: 'todo' }, ctx);
      return COMMANDS.setTaskStatus.run(d, { id: t.id, status: 'done', confirm }, ctx);
    },
  },
  rescheduleTask: {
    label: 'תזמון משימה',
    run(d, { id, date }, ctx) {
      const t = resolveTask(d, id, ctx);
      const nd = optDate(date, 'תאריך');
      if (t.status === 'deferred' && nd) { t.status = 'todo'; t.resumeOn = null; }
      setScheduled(t, nd, ctx);
      t.updatedAt = ctx.nowIso;
      return t.id;
    },
  },
  deleteTask: {
    label: 'מחיקת משימה',
    run(d, { id }, ctx) {
      const t = getTask(d, id);
      if (t.recurringRuleId) fail('recurring', 'מופע של משימה חוזרת: אפשר לבטל אותו או לדלג עליו');
      removeFromPriorities(d, id);
      for (const x of d.meetingDecisions) if (x.taskId === id) x.taskId = null;
      for (const x of d.issueLogs) if (x.taskId === id) { x.taskId = null; x.updatedAt = ctx.nowIso; }
      for (const x of d.workNotes) if (x.taskId === id) { x.taskId = null; x.updatedAt = ctx.nowIso; }
      d.tasks = d.tasks.filter((x) => x.id !== id);
    },
  },
  addSubtask: {
    label: 'הוספת תת־משימה',
    run(d, { taskId, title }, ctx) {
      const t = resolveTask(d, taskId, ctx);
      if (t.subtasks.length >= LIMITS.subtasks) fail('subtasks', 'יותר מדי תתי־משימות');
      t.subtasks.push({ id: ctx.uid(), title: requireTitle(title), done: false });
      touch(t, ctx);
    },
  },
  updateSubtask: {
    label: 'עדכון תת־משימה',
    run(d, { taskId, subtaskId, title, done, remove }, ctx) {
      const t = resolveTask(d, taskId, ctx);
      const s = t.subtasks.find((x) => x.id === subtaskId) || fail('not-found', 'תת־המשימה לא נמצאה');
      if (remove) t.subtasks = t.subtasks.filter((x) => x !== s);
      else {
        if (title !== undefined) s.title = requireTitle(title);
        if (done !== undefined) s.done = !!done;
      }
      touch(t, ctx);
    },
  },
  assignTaskToBlock: {
    label: 'שיוך משימה לבלוק',
    run(d, { taskId, occId }, ctx) {
      const t = resolveTask(d, taskId, ctx);
      if (!occId) { t.assignedBlock = null; t.assignmentManual = false; t.updatedAt = ctx.nowIso; return; }
      const o = findOccurrence(d, occId) || fail('not-found', 'הפעילות לא נמצאה');
      t.assignedBlock = o.id;
      t.assignmentManual = true;
      setScheduled(t, o.date, ctx);
      t.assignedBlock = o.id;
      t.updatedAt = ctx.nowIso;
    },
  },
  applyPlannerAssignments: {
    label: 'החלת הצעת תכנון',
    run(d, { assignments }, ctx) {
      if (!Array.isArray(assignments) || !assignments.length) fail('empty', 'לא נבחרו שיבוצים');
      for (const a of assignments) {
        const t = getTask(d, a.taskId);
        if (a.taskUpdatedAt && t.updatedAt !== a.taskUpdatedAt) fail('stale', `המשימה ״${t.title}״ השתנתה מאז ההצעה. יש לבנות אותה מחדש.`);
        if (t.pinned || t.assignmentManual) fail('manual', `המשימה ״${t.title}״ שובצה ידנית ולא תשתנה`);
        findOccurrence(d, a.occId) || fail('stale', 'בלוק בהצעה כבר אינו קיים. יש לבנות את ההצעה מחדש.');
        setScheduled(t, a.date, ctx, 'planner');
        t.assignedBlock = a.occId;
        t.assignmentManual = false;
        t.updatedAt = ctx.nowIso;
      }
      return assignments.length;
    },
  },
  moveUnfinished: {
    label: 'העברת משימות פתוחות',
    run(d, { taskIds, to }, ctx) {
      const date = optDate(to, 'תאריך') || fail('date', 'חסר תאריך יעד');
      let n = 0;
      for (const id of taskIds || []) {
        const t = d.tasks.find((x) => x.id === id);
        if (!t || !['todo', 'inProgress', 'deferred'].includes(t.status)) continue;
        if (t.status === 'deferred') { t.status = 'todo'; t.resumeOn = null; }
        setScheduled(t, date, ctx, 'move-unfinished');
        t.updatedAt = ctx.nowIso;
        n++;
      }
      return n;
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
  addRecurringRule: {
    label: 'הוספת משימה חוזרת',
    run(d, p, ctx) {
      const r = p.recurrence || fail('recurrence', 'חסרה הגדרת חזרה');
      const rec = { kind: r.kind, interval: r.interval ? Number(r.interval) : 1, weekdays: r.weekdays || [], workdaysOnly: !!r.workdaysOnly, monthDay: r.monthDay ? Number(r.monthDay) : null, monthOverflow: r.monthOverflow === 'lastDay' ? 'lastDay' : 'skip', dayType: r.dayType || null, startDate: r.startDate || p.scheduledDate || ctx.today, endDate: r.endDate || null, exceptions: [] };
      const errs = recurrenceErrors(rec, isValidDate);
      if (errs.length) fail('recurrence', errs.join(', '));
      const policy = p.routine ? 'none' : (CARRYOVER_POLICIES.includes(p.carryover) ? p.carryover : 'latest');
      const rule = {
        id: ctx.uid(), title: requireTitle(p.title), details: cleanText(p.details), categoryId: catOrDefault(d, p.categoryId),
        priority: PRIORITIES.includes(p.priority) ? p.priority : 'medium', estimateMinutes: optMinutes(p.estimateMinutes, 'הערכת זמן'),
        subtasks: (p.subtasks || []).map((s) => cleanText(typeof s === 'string' ? s : s.title, LIMITS.title)).filter(Boolean),
        preferredRole: p.preferredRole || null, recurrence: rec, routine: !!p.routine, carryover: policy, archived: false,
        createdAt: ctx.nowIso, updatedAt: ctx.nowIso,
      };
      d.recurringRules.push(rule);
      return rule.id;
    },
  },
  updateRecurringRule: {
    label: 'עריכת משימה חוזרת',
    run(d, { id, patch, scope = 'all', fromDate }, ctx) {
      const r = d.recurringRules.find((x) => x.id === id) || fail('not-found', 'הכלל לא נמצא');
      const apply = (rule) => {
        if (patch.title !== undefined) rule.title = requireTitle(patch.title);
        if (patch.details !== undefined) rule.details = cleanText(patch.details);
        if (patch.categoryId !== undefined) rule.categoryId = catOrDefault(d, patch.categoryId);
        if (patch.priority !== undefined && PRIORITIES.includes(patch.priority)) rule.priority = patch.priority;
        if (patch.estimateMinutes !== undefined) rule.estimateMinutes = optMinutes(patch.estimateMinutes, 'הערכה');
        if (patch.routine !== undefined) rule.routine = !!patch.routine;
        if (patch.carryover !== undefined) { if (!CARRYOVER_POLICIES.includes(patch.carryover)) fail('carryover', 'מדיניות לא תקינה'); rule.carryover = patch.carryover; }
        if (rule.routine) rule.carryover = 'none';
        if (patch.recurrence) {
          const rec = { ...rule.recurrence, ...patch.recurrence };
          const errs = recurrenceErrors(rec, isValidDate);
          if (errs.length) fail('recurrence', errs.join(', '));
          rule.recurrence = rec;
        }
        rule.updatedAt = ctx.nowIso;
      };
      if (scope === 'future') {
        const from = optDate(fromDate, 'מתאריך') || ctx.today;
        if (from <= r.recurrence.startDate) { apply(r); return r.id; }
        const nr = { ...structuredClone(r), id: ctx.uid(), recurrence: { ...r.recurrence, startDate: from, exceptions: (r.recurrence.exceptions || []).filter((x) => x >= from) }, createdAt: ctx.nowIso };
        r.recurrence = { ...r.recurrence, endDate: addDays(from, -1), exceptions: (r.recurrence.exceptions || []).filter((x) => x < from) };
        apply(nr);
        d.recurringRules.push(nr);
        for (const t of d.tasks) if (t.recurringRuleId === r.id && t.occurrenceDate >= from) t.recurringRuleId = nr.id;
        return nr.id;
      }
      apply(r);
      return r.id;
    },
  },
  skipRecurringOccurrence: {
    label: 'דילוג על מופע',
    run(d, { ruleId, date }, ctx) {
      const r = d.recurringRules.find((x) => x.id === ruleId) || fail('not-found', 'הכלל לא נמצא');
      const t = materializedOccurrence(d, ruleId, date);
      if (t && t.status === 'done') fail('done', 'המופע כבר הושלם');
      r.recurrence.exceptions = [...new Set([...(r.recurrence.exceptions || []), date])].sort();
      if (t) { t.status = 'canceled'; t.canceledOn = ctx.today; t.updatedAt = ctx.nowIso; }
      r.updatedAt = ctx.nowIso;
    },
  },
  archiveRecurringRule: {
    label: 'סיום משימה חוזרת',
    run(d, { id, archived = true }, ctx) {
      const r = d.recurringRules.find((x) => x.id === id) || fail('not-found', 'הכלל לא נמצא');
      r.archived = !!archived;
      if (archived && !r.recurrence.endDate) r.recurrence.endDate = addDays(ctx.today, -1) >= r.recurrence.startDate ? addDays(ctx.today, -1) : r.recurrence.startDate;
      if (!archived) r.recurrence.endDate = null;
      r.updatedAt = ctx.nowIso;
    },
  },

  // ===== inquiries =====
  addInquiry: {
    label: 'ספירת פנייה',
    run(d, { date, kind = 'completed', category = 'unspecified', quantity = 1 }, ctx) {
      optDate(date, 'תאריך') || fail('date', 'חסר תאריך');
      if (!INQUIRY_KINDS.includes(kind) || !INQUIRY_CATEGORIES.includes(category)) fail('kind', 'סוג לא תקין');
      const q = Number(quantity);
      if (!Number.isInteger(q) || q < 1 || q > 500) fail('quantity', 'כמות לא תקינה');
      const ev = { id: ctx.uid(), workDate: date, kind, category, quantity: q, correctsId: null, at: ctx.nowIso };
      d.inquiryLogs.push(ev);
      return ev.id;
    },
  },
  undoInquiry: {
    label: 'ביטול ספירה',
    run(d, { date, kind = 'completed', quantity = 1 }, ctx) {
      const ev = lastUndoable(d, date, kind) || fail('nothing', 'אין ספירה לביטול');
      const q = Math.min(Number(quantity) || 1, remainingOf(d, ev.id));
      const corr = { id: ctx.uid(), workDate: date, kind: ev.kind, category: ev.category, quantity: -q, correctsId: ev.id, at: ctx.nowIso };
      if (checkEvents(eventsForDate(d, date), [corr])) fail('negative', 'הספירה לא יכולה לרדת מתחת לאפס');
      d.inquiryLogs.push(corr);
      return corr.id;
    },
  },
  correctInquiry: {
    label: 'תיקון ספירה',
    run(d, { eventId, quantity }, ctx) {
      const ev = d.inquiryLogs.find((x) => x.id === eventId) || fail('not-found', 'האירוע לא נמצא');
      if (ev.quantity < 0) fail('correction', 'אי אפשר לתקן תיקון');
      const q = Number(quantity);
      if (!Number.isInteger(q) || q < 1 || q > remainingOf(d, ev.id)) fail('quantity', 'כמות התיקון גדולה מהכמות שנותרה');
      const corr = { id: ctx.uid(), workDate: ev.workDate, kind: ev.kind, category: ev.category, quantity: -q, correctsId: ev.id, at: ctx.nowIso };
      if (checkEvents(eventsForDate(d, ev.workDate), [corr])) fail('negative', 'הספירה לא יכולה לרדת מתחת לאפס');
      d.inquiryLogs.push(corr);
    },
  },

  // ===== questions, meetings, decisions, FAQ =====
  addQuestion: {
    label: 'הוספת שאלה',
    run(d, p, ctx) {
      if (!QUESTION_AUDIENCES.includes(p.audience)) fail('audience', 'יש לבחור צוות או מנהל');
      const q = {
        id: ctx.uid(), kind: p.kind === 'topic' ? 'topic' : 'question', audience: p.audience, direction: p.direction || (p.audience === 'team' ? 'incoming' : 'outgoing'),
        title: requireTitle(p.title), detail: cleanText(p.detail), priority: PRIORITIES.includes(p.priority) ? p.priority : 'medium', categoryId: null,
        status: 'open', answer: '', answeredOn: null, recurring: !!p.recurring, followUpOn: optDate(p.followUpOn, 'מועד מעקב'), faqId: null,
        createdDate: ctx.today, createdAt: ctx.nowIso, updatedAt: ctx.nowIso,
      };
      d.questions.push(q);
      if (p.meetingId) { const m = getMeeting(d, p.meetingId); m.agenda.push(q.id); m.updatedAt = ctx.nowIso; }
      return q.id;
    },
  },
  updateQuestion: {
    label: 'עריכת שאלה',
    run(d, { id, patch }, ctx) {
      const q = getQuestion(d, id);
      if (patch.title !== undefined) q.title = requireTitle(patch.title);
      if (patch.detail !== undefined) q.detail = cleanText(patch.detail);
      if (patch.audience !== undefined) { if (!QUESTION_AUDIENCES.includes(patch.audience)) fail('audience', 'ערך לא תקין'); q.audience = patch.audience; }
      if (patch.direction !== undefined) q.direction = patch.direction || null;
      if (patch.kind !== undefined) q.kind = patch.kind === 'topic' ? 'topic' : 'question';
      if (patch.priority !== undefined && PRIORITIES.includes(patch.priority)) q.priority = patch.priority;
      if (patch.followUpOn !== undefined) q.followUpOn = optDate(patch.followUpOn, 'מועד מעקב');
      if (patch.recurring !== undefined) q.recurring = !!patch.recurring;
      if (patch.answer !== undefined) q.answer = cleanText(patch.answer);
      touch(q, ctx);
    },
  },
  setQuestionStatus: {
    label: 'עדכון סטטוס שאלה',
    run(d, { id, status, answer, recurring }, ctx) {
      const q = getQuestion(d, id);
      if (!QUESTION_STATUSES.includes(status)) fail('status', 'סטטוס לא תקין');
      if (status === 'answered') {
        const a = answer !== undefined ? cleanText(answer) : q.answer;
        q.answer = a;
        q.answeredOn = ctx.today;
        if (recurring !== undefined) q.recurring = !!recurring;
      } else if (status === 'open' || status === 'waiting') {
        if (q.status === 'answered' || q.status === 'archived') q.answeredOn = q.status === 'answered' ? null : q.answeredOn;
      }
      q.status = status;
      touch(q, ctx);
    },
  },
  addMeeting: {
    label: 'הוספת פגישה',
    run(d, p, ctx) {
      if (!MEETING_TYPES.includes(p.meetingType)) fail('type', 'סוג פגישה לא תקין');
      const m = {
        id: ctx.uid(), title: requireTitle(p.title), meetingType: p.meetingType, date: optDate(p.date, 'תאריך'), start: optTime(p.start, 'שעת התחלה'),
        end: optTime(p.end, 'שעת סיום'), durationMinutes: optMinutes(p.durationMinutes, 'משך'), location: cleanText(p.location, 200), notes: cleanText(p.notes),
        agenda: [], status: 'planned', createdAt: ctx.nowIso, updatedAt: ctx.nowIso,
      };
      if (m.start && !m.date) fail('date', 'לשעה נדרש תאריך');
      if (m.start && m.end && toMin(m.end) <= toMin(m.start)) fail('time', 'שעת הסיום חייבת להיות אחרי ההתחלה');
      const t = meetingTimes(m);
      if (t) {
        const reasons = intervalChecks(d, m.date, toMin(t.start), toMin(t.end), new Set(), ctx);
        const overlaps = dayOccurrences(d, m.date).filter((o) => o.status !== 'canceled' && o.s < toMin(t.end) && toMin(t.start) < o.e && o.kind !== 'routine');
        for (const o of overlaps) if (!reasons.some((r) => r.message.includes(o.title))) reasons.push({ code: 'overlap', message: `חופף ל״${o.title}״ (${o.start}–${o.end}). לאשר?` });
        if (reasons.length && !p.confirm) return needConfirm(reasons);
      }
      for (const qid of p.agenda || []) { getQuestion(d, qid); if (!m.agenda.includes(qid)) m.agenda.push(qid); }
      d.meetings.push(m);
      return m.id;
    },
  },
  updateMeeting: {
    label: 'עריכת פגישה',
    run(d, { id, patch, confirm }, ctx) {
      const m = getMeeting(d, id);
      const next = { ...m };
      if (patch.title !== undefined) next.title = requireTitle(patch.title);
      if (patch.meetingType !== undefined) { if (!MEETING_TYPES.includes(patch.meetingType)) fail('type', 'סוג לא תקין'); next.meetingType = patch.meetingType; }
      if (patch.date !== undefined) next.date = optDate(patch.date, 'תאריך');
      if (patch.start !== undefined) next.start = optTime(patch.start, 'שעת התחלה');
      if (patch.end !== undefined) next.end = optTime(patch.end, 'שעת סיום');
      if (patch.durationMinutes !== undefined) next.durationMinutes = optMinutes(patch.durationMinutes, 'משך');
      if (patch.location !== undefined) next.location = cleanText(patch.location, 200);
      if (patch.notes !== undefined) next.notes = cleanText(patch.notes);
      if (next.start && !next.date) fail('date', 'לשעה נדרש תאריך');
      if (next.start && next.end && toMin(next.end) <= toMin(next.start)) fail('time', 'שעת הסיום חייבת להיות אחרי ההתחלה');
      if (next.start && next.end && next.durationMinutes && toMin(next.end) - toMin(next.start) !== next.durationMinutes) next.durationMinutes = toMin(next.end) - toMin(next.start);
      const t = meetingTimes(next);
      const moved = t && (next.date !== m.date || next.start !== m.start || meetingTimes(m)?.end !== t.end);
      if (moved && next.status === 'planned') {
        const reasons = intervalChecks(d, next.date, toMin(t.start), toMin(t.end), new Set([`mtg:${m.id}`]), ctx);
        if (reasons.length && !confirm) return needConfirm(reasons);
      }
      Object.assign(m, next);
      touch(m, ctx);
    },
  },
  setMeetingStatus: {
    label: 'עדכון סטטוס פגישה',
    run(d, { id, status }, ctx) {
      const m = getMeeting(d, id);
      if (!MEETING_STATUSES.includes(status)) fail('status', 'סטטוס לא תקין');
      // Cancel/reschedule releases calendar time; questions and decisions are preserved.
      m.status = status;
      touch(m, ctx);
    },
  },
  linkQuestion: {
    label: 'שיוך שאלה לפגישה',
    run(d, { meetingId, questionId, unlink }, ctx) {
      const m = getMeeting(d, meetingId);
      getQuestion(d, questionId);
      if (unlink) m.agenda = m.agenda.filter((x) => x !== questionId);
      else if (!m.agenda.includes(questionId)) m.agenda.push(questionId);
      touch(m, ctx);
    },
  },
  addDecision: {
    label: 'רישום החלטה',
    run(d, { meetingId = null, questionId = null, text, owner, createTask }, ctx) {
      if (meetingId) getMeeting(d, meetingId);
      if (questionId) getQuestion(d, questionId);
      const dec = { id: ctx.uid(), meetingId, questionId, text: requireTitle(text).slice(0, LIMITS.text), owner: cleanText(owner, 80), taskId: null, createdAt: ctx.nowIso, updatedAt: ctx.nowIso };
      d.meetingDecisions.push(dec);
      if (createTask) {
        const t = newTask(d, { title: createTask.title || dec.text.slice(0, LIMITS.title), deadline: createTask.deadline, scheduledDate: createTask.scheduledDate, categoryId: createTask.categoryId || 'team', meetingId, questionId, source: { kind: 'decision', id: dec.id } }, ctx);
        d.tasks.push(t);
        dec.taskId = t.id;
      }
      return dec.id;
    },
  },
  decisionToTask: {
    label: 'משימת המשך מהחלטה',
    run(d, { decisionId, title, deadline, scheduledDate }, ctx) {
      const dec = d.meetingDecisions.find((x) => x.id === decisionId) || fail('not-found', 'ההחלטה לא נמצאה');
      if (dec.taskId && d.tasks.some((t) => t.id === dec.taskId)) return dec.taskId; // no duplicate action
      const t = newTask(d, { title: title || dec.text.slice(0, LIMITS.title), deadline, scheduledDate, categoryId: 'team', meetingId: dec.meetingId, questionId: dec.questionId, source: { kind: 'decision', id: dec.id } }, ctx);
      d.tasks.push(t);
      dec.taskId = t.id;
      dec.updatedAt = ctx.nowIso;
      return t.id;
    },
  },
  updateDecision: {
    label: 'עריכת החלטה',
    run(d, { id, text, owner, remove }, ctx) {
      const dec = d.meetingDecisions.find((x) => x.id === id) || fail('not-found', 'ההחלטה לא נמצאה');
      if (remove) {
        if (dec.taskId && d.tasks.some((t) => t.id === dec.taskId)) fail('linked', 'להחלטה יש משימת המשך. המשימה נשמרת – יש למחוק אותה קודם אם רוצים.');
        d.meetingDecisions = d.meetingDecisions.filter((x) => x !== dec);
        return;
      }
      if (text !== undefined) dec.text = requireTitle(text).slice(0, LIMITS.text);
      if (owner !== undefined) dec.owner = cleanText(owner, 80);
      dec.updatedAt = ctx.nowIso;
    },
  },
  questionToTask: {
    label: 'משימה משאלה',
    run(d, { questionId, title, scheduledDate }, ctx) {
      const q = getQuestion(d, questionId);
      const existing = d.tasks.find((t) => t.questionId === q.id && t.source?.kind === 'question' && t.status !== 'canceled');
      if (existing) return existing.id;
      const t = newTask(d, { title: title || q.title, scheduledDate, categoryId: 'team', questionId: q.id, source: { kind: 'question', id: q.id } }, ctx);
      d.tasks.push(t);
      return t.id;
    },
  },
  questionToFaq: {
    label: 'העברה לתשובות נפוצות',
    run(d, { questionId, title, answer, keywords }, ctx) {
      const q = getQuestion(d, questionId);
      if (q.faqId && d.faqEntries.some((f) => f.id === q.faqId)) return q.faqId;
      const ans = cleanText(answer ?? q.answer);
      if (!ans) fail('answer', 'לתשובה נפוצה נדרש נוסח תשובה');
      const f = { id: ctx.uid(), title: requireTitle(title || q.title), answer: ans, keywords: (keywords || []).map((k) => cleanText(k, 60)).filter(Boolean).slice(0, LIMITS.tags), questionIds: [q.id], archived: false, createdAt: ctx.nowIso, updatedAt: ctx.nowIso };
      d.faqEntries.push(f);
      q.faqId = f.id;
      if (q.status === 'open' || q.status === 'waiting') { q.status = 'answered'; q.answer = ans; q.answeredOn = ctx.today; }
      touch(q, ctx);
      return f.id;
    },
  },
  saveFaq: {
    label: 'שמירת תשובה נפוצה',
    run(d, { id, title, answer, keywords, archived }, ctx) {
      let f = id ? d.faqEntries.find((x) => x.id === id) : null;
      if (id && !f) fail('not-found', 'התשובה לא נמצאה');
      if (!f) {
        f = { id: ctx.uid(), title: '', answer: '', keywords: [], questionIds: [], archived: false, createdAt: ctx.nowIso, updatedAt: ctx.nowIso };
        d.faqEntries.push(f);
      }
      if (title !== undefined) f.title = requireTitle(title);
      if (answer !== undefined) f.answer = cleanText(answer);
      if (keywords !== undefined) f.keywords = (keywords || []).map((k) => cleanText(k, 60)).filter(Boolean).slice(0, LIMITS.tags);
      if (archived !== undefined) f.archived = !!archived;
      if (!f.title) fail('title', 'יש להזין כותרת');
      f.updatedAt = ctx.nowIso;
      return f.id;
    },
  },

  // ===== issues & notes =====
  addIssue: {
    label: 'רישום תקלה',
    run(d, { title, categoryId, reportedTo, note, date, followUpOn }, ctx) {
      const occDate = optDate(date, 'תאריך') || ctx.today;
      const i = {
        id: ctx.uid(), title: requireTitle(title), categoryId: categoryId ? catOrDefault(d, categoryId) : null, status: reportedTo ? 'reported' : 'open',
        reportedTo: reportedTo || null, resolution: '', followUpOn: optDate(followUpOn, 'מועד מעקב'), taskId: null,
        occurrences: [{ id: ctx.uid(), date: occDate, note: cleanText(note, 500), at: ctx.nowIso }],
        createdAt: ctx.nowIso, updatedAt: ctx.nowIso,
      };
      d.issueLogs.push(i);
      return i.id;
    },
  },
  addIssueOccurrence: {
    label: 'הופעה נוספת של תקלה',
    run(d, { id, date, note }, ctx) {
      const i = d.issueLogs.find((x) => x.id === id) || fail('not-found', 'התקלה לא נמצאה');
      i.occurrences.push({ id: ctx.uid(), date: optDate(date, 'תאריך') || ctx.today, note: cleanText(note, 500), at: ctx.nowIso });
      if (i.status === 'resolved') i.status = 'open';
      i.updatedAt = ctx.nowIso;
    },
  },
  updateIssue: {
    label: 'עדכון תקלה',
    run(d, { id, patch }, ctx) {
      const i = d.issueLogs.find((x) => x.id === id) || fail('not-found', 'התקלה לא נמצאה');
      if (patch.title !== undefined) i.title = requireTitle(patch.title);
      if (patch.status !== undefined) { if (!ISSUE_STATUSES.includes(patch.status)) fail('status', 'סטטוס לא תקין'); i.status = patch.status; }
      if (patch.reportedTo !== undefined) i.reportedTo = patch.reportedTo || null;
      if (patch.resolution !== undefined) i.resolution = cleanText(patch.resolution);
      if (patch.followUpOn !== undefined) i.followUpOn = optDate(patch.followUpOn, 'מועד מעקב');
      if (patch.categoryId !== undefined) i.categoryId = patch.categoryId ? catOrDefault(d, patch.categoryId) : null;
      if (patch.removeOccurrence) {
        if (i.occurrences.length <= 1) fail('last', 'לתקלה נדרשת לפחות הופעה אחת');
        i.occurrences = i.occurrences.filter((o) => o.id !== patch.removeOccurrence);
      }
      i.updatedAt = ctx.nowIso;
    },
  },
  issueToTask: {
    label: 'משימה מתקלה',
    run(d, { id }, ctx) {
      const i = d.issueLogs.find((x) => x.id === id) || fail('not-found', 'התקלה לא נמצאה');
      if (i.taskId && d.tasks.some((t) => t.id === i.taskId)) return i.taskId;
      const t = newTask(d, { title: `מעקב תקלה: ${i.title}`.slice(0, LIMITS.title), categoryId: i.categoryId || 'followups', scheduledDate: i.followUpOn || ctx.today, source: { kind: 'issue', id: i.id } }, ctx);
      d.tasks.push(t);
      i.taskId = t.id;
      i.updatedAt = ctx.nowIso;
      return t.id;
    },
  },
  saveNote: {
    label: 'שמירת רשומה',
    persist: 'debounced',
    run(d, { id, title, body, categoryId, pinned, archived }, ctx) {
      let n = id ? d.workNotes.find((x) => x.id === id) : null;
      if (id && !n) fail('not-found', 'הרשומה לא נמצאה');
      if (!n) {
        n = { id: ctx.uid(), title: '', body: '', categoryId: null, pinned: false, archived: false, taskId: null, createdAt: ctx.nowIso, updatedAt: ctx.nowIso };
        d.workNotes.push(n);
      }
      if (title !== undefined) n.title = cleanText(title, LIMITS.title);
      if (body !== undefined) n.body = cleanText(body, LIMITS.noteBody);
      if (categoryId !== undefined) n.categoryId = categoryId ? catOrDefault(d, categoryId) : null;
      if (pinned !== undefined) n.pinned = !!pinned;
      if (archived !== undefined) n.archived = !!archived;
      if (!n.title && !n.body) fail('empty', 'רשומה ריקה');
      n.updatedAt = ctx.nowIso;
      return n.id;
    },
  },
  noteToTask: {
    label: 'משימה מרשומה',
    run(d, { id }, ctx) {
      const n = d.workNotes.find((x) => x.id === id) || fail('not-found', 'הרשומה לא נמצאה');
      if (n.taskId && d.tasks.some((t) => t.id === n.taskId)) return n.taskId;
      const t = newTask(d, { title: (n.title || n.body.split('\n')[0]).slice(0, LIMITS.title), details: n.body.slice(0, LIMITS.text), categoryId: n.categoryId, source: { kind: 'note', id: n.id } }, ctx);
      d.tasks.push(t);
      n.taskId = t.id;
      n.updatedAt = ctx.nowIso;
      return t.id;
    },
  },

  // ===== day notes, closing, alerts =====
  saveDayNote: {
    label: 'שמירת הערות יום',
    persist: 'debounced',
    run(d, { date, notes, accomplishments }, ctx) {
      optDate(date, 'תאריך') || fail('date', 'חסר תאריך');
      const cur = { ...(d.dayNotes[date] || {}) };
      if (notes !== undefined) cur.notes = cleanText(notes);
      if (accomplishments !== undefined) cur.accomplishments = cleanText(accomplishments);
      cur.updatedAt = ctx.nowIso;
      if (!cur.notes && !cur.accomplishments) delete d.dayNotes[date]; else d.dayNotes[date] = cur;
    },
  },
  closeDay: {
    label: 'סגירת יום',
    run(d, { date, checklist = {}, note, confirm }, ctx) {
      optDate(date, 'תאריך') || fail('date', 'חסר תאריך');
      if (date > ctx.today) fail('future', 'אי אפשר לסגור יום עתידי');
      const items = d.settings.closingChecklist;
      const missing = items.filter((i) => !checklist[i.id]);
      const snap = closureSnapshot(d, date);
      const reasons = [];
      if (missing.length) reasons.push({ code: 'checklist', message: `לא סומנו: ${missing.map((i) => i.label).join(', ')}. לסגור בכל זאת? (הפריטים יישמרו כלא בוצעו)` });
      if (snap.tasksOpenCount) reasons.push({ code: 'openTasks', message: `${snap.tasksOpenCount} משימות עדיין פתוחות. הן יעברו אוטומטית ליום העבודה הבא. לסגור?` });
      if (reasons.length && !confirm) return needConfirm(reasons);
      const prev = d.dailyReports[date];
      d.dailyReports[date] = {
        closedAt: ctx.nowIso,
        checklist: Object.fromEntries(items.map((i) => [i.id, !!checklist[i.id]])),
        checklistLabels: Object.fromEntries(items.map((i) => [i.id, i.label])),
        note: cleanText(note ?? prev?.note ?? ''),
        snapshot: snap,
        partial: missing.length > 0,
        amendments: [...(prev?.amendments || []), ...(prev ? [{ at: ctx.nowIso, kind: 'reclosed' }] : [])],
        reopenedAt: null,
      };
    },
  },
  reopenDay: {
    label: 'פתיחה מחדש של יום',
    run(d, { date }, ctx) {
      const r = d.dailyReports[date] || fail('not-closed', 'היום לא נסגר');
      r.amendments = [...(r.amendments || []), { at: ctx.nowIso, kind: 'reopened' }];
      r.reopenedAt = ctx.nowIso;
      r.closedAt = null;
      // The snapshot is kept so the historical target and context remain available.
    },
  },
  dismissAlert: {
    label: 'הסתרת התראה',
    run(d, { key, date }) {
      d.alertDismissals[key] = date;
      // Bounded: drop dismissals older than 30 entries.
      const keys = Object.keys(d.alertDismissals);
      if (keys.length > 300) for (const k of keys.slice(0, keys.length - 300)) delete d.alertDismissals[k];
    },
  },
  markBackupExported: {
    label: 'רישום גיבוי',
    run(d, { kind }, ctx) {
      d.settings.backup = { ...d.settings.backup, lastExportAt: ctx.nowIso, lastExportKind: kind || 'download' };
    },
  },

  // ===== import =====
  importPlan: {
    label: 'ייבוא תוכנית',
    snapshot: 'לפני ייבוא תוכנית',
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

export const ruleKey = ruleOccKey;
export const taskDue = dueDateOf;
