// Whole-document validation of the canonical state. Run on load, on restore/import, and
// after every command; a command that would produce an invalid document is rejected and
// the previous state stays in force.
import { STATE_FORMAT } from '../config.js';
import { isValidDate, isValidTime, toMin, weekday } from '../dates.js';
import {
  COLLECTIONS, TASK_STATUSES, PRIORITIES, LOCATIONS, BLOCK_STATUSES, INQUIRY_KINDS, INQUIRY_CATEGORIES,
  QUESTION_AUDIENCES, QUESTION_DIRECTIONS, QUESTION_STATUSES, QUESTION_KINDS, MEETING_TYPES, MEETING_STATUSES,
  ISSUE_STATUSES, REPORTED_TO, CARRYOVER_POLICIES,
} from './schema.js';
import { recurrenceErrors } from '../engine/recurrence.js';
import { headerRuleErrors } from '../engine/header.js';
import { LIMITS } from '../config.js';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v, max = LIMITS.text) => typeof v === 'string' && v.length <= max;
const optStr = (v, max) => v == null || isStr(v, max);
const optDate = (v) => v == null || isValidDate(v);
const optTime = (v) => v == null || isValidTime(v);
const isInt = (v, min = -Infinity, max = Infinity) => Number.isInteger(v) && v >= min && v <= max;
const optInt = (v, min, max) => v == null || isInt(v, min, max);
const isIso = (v) => typeof v === 'string' && !Number.isNaN(Date.parse(v));

export function validateState(s) {
  const e = [];
  const err = (path, msg) => { if (e.length < 200) e.push(`${path}: ${msg}`); };
  if (!isObj(s)) return { ok: false, errors: ['root: not an object'] };
  const m = s.metadata;
  if (!isObj(m) || m.format !== STATE_FORMAT) err('metadata.format', 'unknown format');
  else {
    if (!isInt(m.schemaVersion, 1)) err('metadata.schemaVersion', 'invalid');
    if (!isInt(m.revision, 0)) err('metadata.revision', 'invalid');
    if (!isIso(m.createdAt) || !isIso(m.updatedAt)) err('metadata', 'timestamps');
  }
  for (const c of COLLECTIONS) if (s[c] === undefined) err(c, 'missing collection');
  if (e.length) return { ok: false, errors: e };

  // settings
  const st = s.settings;
  if (!isObj(st)) err('settings', 'not object');
  else {
    if (!Array.isArray(st.weekly) || st.weekly.length !== 7) err('settings.weekly', 'needs 7 days');
    else st.weekly.forEach((d, i) => {
      if (!isObj(d) || typeof d.isWorking !== 'boolean') err(`settings.weekly[${i}]`, 'invalid');
      else if (d.isWorking && !LOCATIONS.includes(d.location)) err(`settings.weekly[${i}].location`, 'invalid');
      if (d && (!optTime(d.workStart) || !optTime(d.workEnd))) err(`settings.weekly[${i}]`, 'hours');
      if (d && d.workStart && d.workEnd && toMin(d.workEnd) <= toMin(d.workStart)) err(`settings.weekly[${i}]`, 'end before start');
    });
    for (const k of ['workHours', 'phoneDutyWindow']) {
      const w = st[k];
      if (!isObj(w) || !isValidTime(w.start) || !isValidTime(w.end) || toMin(w.end) <= toMin(w.start)) err(`settings.${k}`, 'invalid window');
    }
    if (!Array.isArray(st.categories) || !st.categories.length) err('settings.categories', 'required');
    else {
      const ids = new Set();
      for (const c of st.categories) {
        if (!isStr(c.id, 60) || !c.id || ids.has(c.id)) err('settings.categories', `bad id ${c.id}`);
        ids.add(c.id);
        if (!isStr(c.label, 80) || !c.label.trim()) err(`settings.categories.${c.id}`, 'label');
        if (!/^#[0-9a-fA-F]{6}$/.test(c.color || '')) err(`settings.categories.${c.id}`, 'color');
      }
    }
    if (!Array.isArray(st.closingChecklist)) err('settings.closingChecklist', 'array');
    if (!isObj(st.planner)) err('settings.planner', 'object');
    if (!isObj(st.backup) || !isInt(st.backup.reminderDays, 0, 365)) err('settings.backup', 'invalid');
    if (st.notifications != null && (!isObj(st.notifications) || typeof st.notifications.activityStart !== 'boolean' || typeof st.notifications.showDetails !== 'boolean')) err('settings.notifications', 'invalid');
    if (!optDate(st.routineEndsOn)) err('settings.routineEndsOn', 'invalid');
    if (st.displayName != null && !isStr(st.displayName, 40)) err('settings.displayName', 'invalid');
    const hr = headerRuleErrors(st.header?.rules);
    if (hr.length) err('settings.header', hr.join(', '));
    if (!s.dayTemplates.some?.((t) => t.id === st.defaultTemplateId)) err('settings.defaultTemplateId', 'unknown template');
  }
  const catIds = new Set((st.categories || []).map((c) => c.id));

  // templates
  if (!Array.isArray(s.dayTemplates) || !s.dayTemplates.length) err('dayTemplates', 'required');
  else for (const t of s.dayTemplates) {
    if (!isStr(t.id, 80) || !Array.isArray(t.versions) || !t.versions.length) { err('dayTemplates', `invalid template ${t.id}`); continue; }
    const vIds = new Set();
    for (const v of t.versions) {
      if (!isValidDate(v.effectiveFrom) || vIds.has(v.id)) err(`dayTemplates.${t.id}`, 'version');
      vIds.add(v.id);
      const roles = new Set();
      for (const b of v.blocks || []) {
        if (!isStr(b.role, 60) || roles.has(b.role)) err(`dayTemplates.${t.id}.${v.id}`, `role ${b.role}`);
        roles.add(b.role);
        if (!isValidTime(b.start) || !isValidTime(b.end) || toMin(b.end) <= toMin(b.start)) err(`dayTemplates.${t.id}.${v.id}.${b.role}`, 'times');
        if (!isStr(b.title, LIMITS.title) || !b.title.trim()) err(`dayTemplates.${t.id}.${v.id}.${b.role}`, 'title');
        if (!catIds.has(b.categoryId)) err(`dayTemplates.${t.id}.${v.id}.${b.role}`, 'category');
      }
    }
  }
  const tplIds = new Set((s.dayTemplates || []).map((t) => t.id));

  const checkPatch = (path, p) => {
    if (!isObj(p)) return err(path, 'not object');
    if (p.isWorking != null && typeof p.isWorking !== 'boolean') err(path, 'isWorking');
    if (p.location != null && !LOCATIONS.includes(p.location)) err(path, 'location');
    if (p.phoneDuty != null && typeof p.phoneDuty !== 'boolean') err(path, 'phoneDuty');
    for (const k of ['phoneStart', 'phoneEnd', 'workStart', 'workEnd']) if (!optTime(p[k])) err(path, k);
    if (p.workStart && p.workEnd && toMin(p.workEnd) <= toMin(p.workStart)) err(path, 'work end before start');
    if (p.phoneStart && p.phoneEnd && toMin(p.phoneEnd) <= toMin(p.phoneStart)) err(path, 'phone end before start');
    if (!optInt(p.inquiryTarget, 0, 1000)) err(path, 'inquiryTarget');
    if (p.templateId != null && !tplIds.has(p.templateId)) err(path, 'templateId');
    if (!optStr(p.label, 80) || !optStr(p.note, LIMITS.text)) err(path, 'text');
  };
  if (!isObj(s.dayOverrides)) err('dayOverrides', 'object');
  else for (const [d, p] of Object.entries(s.dayOverrides)) { if (!isValidDate(d)) err('dayOverrides', `key ${d}`); checkPatch(`dayOverrides.${d}`, p); }
  if (!isObj(s.weekOverrides)) err('weekOverrides', 'object');
  else for (const [d, w] of Object.entries(s.weekOverrides)) {
    if (!isValidDate(d) || weekday(d) !== 0) err('weekOverrides', `key ${d} must be a Sunday`);
    if (!isObj(w) || !isObj(w.days)) { err(`weekOverrides.${d}`, 'days'); continue; }
    for (const [wd, p] of Object.entries(w.days)) { if (!/^[0-6]$/.test(wd)) err(`weekOverrides.${d}`, `weekday ${wd}`); checkPatch(`weekOverrides.${d}.${wd}`, p); }
  }

  // calendar blocks
  const blockIds = new Set();
  if (!Array.isArray(s.calendarBlocks)) err('calendarBlocks', 'array');
  else for (const b of s.calendarBlocks) {
    const p = `calendarBlocks.${b.id}`;
    if (!isStr(b.id, 100) || blockIds.has(b.id) || b.id.includes('@') || b.id.startsWith('r:') || b.id.startsWith('mtg:')) err(p, 'id');
    blockIds.add(b.id);
    if (!isStr(b.title, LIMITS.title) || !b.title.trim()) err(p, 'title');
    if (!isValidTime(b.start) || !isValidTime(b.end) || toMin(b.end) <= toMin(b.start)) err(p, 'times');
    if (b.recurrence) { const re = recurrenceErrors(b.recurrence, isValidDate); if (re.length) err(p, re.join(',')); }
    else if (!isValidDate(b.date)) err(p, 'date');
    if (!catIds.has(b.categoryId)) err(p, 'category');
    if (!optStr(b.notes, LIMITS.noteBody)) err(p, 'notes');
  }
  if (!isObj(s.occurrenceOverrides)) err('occurrenceOverrides', 'object');
  else for (const [k, o] of Object.entries(s.occurrenceOverrides)) {
    if (!isObj(o)) { err(`occurrenceOverrides.${k}`, 'object'); continue; }
    if ((o.start !== undefined && !isValidTime(o.start)) || (o.end !== undefined && !isValidTime(o.end))) err(`occurrenceOverrides.${k}`, 'times');
    if (o.start && o.end && toMin(o.end) <= toMin(o.start)) err(`occurrenceOverrides.${k}`, 'end before start');
    if ((o.title !== undefined && !(isStr(o.title, LIMITS.title) && o.title.trim())) || !optStr(o.notes, LIMITS.noteBody)) err(`occurrenceOverrides.${k}`, 'text');
  }
  if (!isObj(s.blockCompletions)) err('blockCompletions', 'object');
  else for (const [k, c] of Object.entries(s.blockCompletions)) {
    if (!isObj(c) || !BLOCK_STATUSES.includes(c.status)) err(`blockCompletions.${k}`, 'status');
    else if (!optInt(c.actualMinutes, 0, 1440)) err(`blockCompletions.${k}`, 'actualMinutes');
  }

  // recurring rules + tasks
  const ruleIds = new Set();
  if (!Array.isArray(s.recurringRules)) err('recurringRules', 'array');
  else for (const r of s.recurringRules) {
    if (!isStr(r.id, 100) || ruleIds.has(r.id)) err('recurringRules', `id ${r.id}`);
    ruleIds.add(r.id);
    if (!isStr(r.title, LIMITS.title) || !r.title.trim()) err(`recurringRules.${r.id}`, 'title');
    const re = recurrenceErrors(r.recurrence, isValidDate);
    if (re.length) err(`recurringRules.${r.id}`, re.join(','));
    if (r.carryover != null && !CARRYOVER_POLICIES.includes(r.carryover)) err(`recurringRules.${r.id}`, 'carryover');
  }
  const taskIds = new Set();
  const occKeys = new Set();
  if (!Array.isArray(s.tasks)) err('tasks', 'array');
  else for (const t of s.tasks) {
    const p = `tasks.${t.id}`;
    if (!isStr(t.id, 100) || taskIds.has(t.id)) err(p, 'id');
    taskIds.add(t.id);
    if (!isStr(t.title, LIMITS.title) || !t.title.trim()) err(p, 'title');
    if (!optStr(t.details, LIMITS.text)) err(p, 'details');
    if (!TASK_STATUSES.includes(t.status)) err(p, 'status');
    if (!PRIORITIES.includes(t.priority)) err(p, 'priority');
    if (t.categoryId != null && !catIds.has(t.categoryId)) err(p, 'category');
    for (const k of ['scheduledDate', 'originalScheduledDate', 'deadline', 'resumeOn', 'completedOn', 'canceledOn']) if (!optDate(t[k])) err(p, k);
    if (t.status === 'deferred' && !isValidDate(t.resumeOn)) err(p, 'deferred needs resumeOn');
    if (!optInt(t.estimateMinutes, 1, 1440) || !optInt(t.actualMinutes, 0, 1440)) err(p, 'minutes');
    if (!Array.isArray(t.subtasks) || t.subtasks.length > LIMITS.subtasks) err(p, 'subtasks');
    else {
      const sids = new Set();
      for (const x of t.subtasks) { if (!isStr(x.id, 100) || sids.has(x.id) || !isStr(x.title, LIMITS.title) || typeof x.done !== 'boolean') err(p, 'subtask'); sids.add(x.id); }
    }
    if (t.recurringRuleId != null) {
      if (!ruleIds.has(t.recurringRuleId)) err(p, 'recurringRuleId');
      if (!isValidDate(t.occurrenceDate)) err(p, 'occurrenceDate');
      const k = `${t.recurringRuleId}@${t.occurrenceDate}`;
      if (occKeys.has(k)) err(p, 'duplicate recurring occurrence');
      occKeys.add(k);
    }
    if (t.waiting != null && (!isObj(t.waiting) || !optDate(t.waiting.followUpOn) || !optStr(t.waiting.note, LIMITS.text))) err(p, 'waiting');
    if (!Array.isArray(t.scheduleHistory)) err(p, 'scheduleHistory');
  }
  if (!isObj(s.dailyPriorities)) err('dailyPriorities', 'object');
  else for (const [d, ids] of Object.entries(s.dailyPriorities)) {
    if (!isValidDate(d)) err('dailyPriorities', `key ${d}`);
    if (!Array.isArray(ids) || ids.length > 3 || new Set(ids).size !== ids.length) err(`dailyPriorities.${d}`, 'max three unique');
    else for (const id of ids) if (!taskIds.has(id)) err(`dailyPriorities.${d}`, `unknown task ${id}`);
  }

  // inquiry counter (one number per date) and legacy count events
  if (!isObj(s.inquiryCounts)) err('inquiryCounts', 'object');
  else for (const [d, n] of Object.entries(s.inquiryCounts)) {
    if (!isValidDate(d)) err('inquiryCounts', `key ${d}`);
    if (!isInt(n, 0, 100000)) err(`inquiryCounts.${d}`, 'must be a non-negative integer');
  }
  const evIds = new Set();
  const totals = new Map();
  if (!Array.isArray(s.inquiryLogs)) err('inquiryLogs', 'array');
  else for (const ev of s.inquiryLogs) {
    const p = `inquiryLogs.${ev.id}`;
    if (!isStr(ev.id, 100) || evIds.has(ev.id)) err(p, 'id');
    evIds.add(ev.id);
    if (!isValidDate(ev.workDate) || !INQUIRY_KINDS.includes(ev.kind) || !INQUIRY_CATEGORIES.includes(ev.category)) err(p, 'fields');
    if (!isInt(ev.quantity, -1000, 1000) || ev.quantity === 0) err(p, 'quantity');
    if (!isIso(ev.at)) err(p, 'at');
    const k = `${ev.workDate}|${ev.kind}|${ev.category}`;
    totals.set(k, (totals.get(k) || 0) + (ev.quantity || 0));
  }
  for (const [k, v] of totals) if (v < 0) err('inquiryLogs', `negative total ${k}`);
  for (const ev of s.inquiryLogs || []) if (ev.correctsId != null && !evIds.has(ev.correctsId)) err(`inquiryLogs.${ev.id}`, 'correctsId');
  if (!isObj(s.targetHistory) || !Array.isArray(s.targetHistory.defaults) || !s.targetHistory.defaults.length) err('targetHistory', 'defaults');
  else for (const v of s.targetHistory.defaults) if (!isValidDate(v.effectiveFrom) || !isInt(v.target, 0, 1000)) err('targetHistory', 'version');

  // questions, meetings, decisions
  const qIds = new Set();
  if (!Array.isArray(s.questions)) err('questions', 'array');
  else for (const q of s.questions) {
    const p = `questions.${q.id}`;
    if (!isStr(q.id, 100) || qIds.has(q.id)) err(p, 'id');
    qIds.add(q.id);
    if (!isStr(q.title, LIMITS.title) || !q.title.trim()) err(p, 'title');
    if (!QUESTION_AUDIENCES.includes(q.audience) || !QUESTION_STATUSES.includes(q.status)) err(p, 'enums');
    if (q.direction != null && !QUESTION_DIRECTIONS.includes(q.direction)) err(p, 'direction');
    if (q.kind != null && !QUESTION_KINDS.includes(q.kind)) err(p, 'kind');
    if (!PRIORITIES.includes(q.priority)) err(p, 'priority');
    if (!isValidDate(q.createdDate) || !optDate(q.followUpOn) || !optDate(q.answeredOn)) err(p, 'dates');
    if (!optStr(q.detail, LIMITS.text) || !optStr(q.answer, LIMITS.text)) err(p, 'text');
  }
  const mIds = new Set();
  if (!Array.isArray(s.meetings)) err('meetings', 'array');
  else for (const mt of s.meetings) {
    const p = `meetings.${mt.id}`;
    if (!isStr(mt.id, 100) || mIds.has(mt.id)) err(p, 'id');
    mIds.add(mt.id);
    if (!isStr(mt.title, LIMITS.title) || !mt.title.trim()) err(p, 'title');
    if (!MEETING_TYPES.includes(mt.meetingType) || !MEETING_STATUSES.includes(mt.status)) err(p, 'enums');
    if (!optDate(mt.date) || !optTime(mt.start) || !optTime(mt.end)) err(p, 'date/time');
    if (mt.start && mt.end && toMin(mt.end) <= toMin(mt.start)) err(p, 'end before start');
    if (!optInt(mt.durationMinutes, 1, 1440)) err(p, 'duration');
    if (!Array.isArray(mt.agenda)) err(p, 'agenda');
    else for (const id of mt.agenda) if (!qIds.has(id)) err(p, `agenda ref ${id}`);
  }
  if (!Array.isArray(s.meetingDecisions)) err('meetingDecisions', 'array');
  else for (const d of s.meetingDecisions) {
    const p = `meetingDecisions.${d.id}`;
    if (!isStr(d.text, LIMITS.text) || !d.text.trim()) err(p, 'text');
    if (d.meetingId != null && !mIds.has(d.meetingId)) err(p, 'meetingId');
    if (d.questionId != null && !qIds.has(d.questionId)) err(p, 'questionId');
    if (d.taskId != null && !taskIds.has(d.taskId)) err(p, 'taskId');
  }

  // knowledge, issues, notes
  const faqIds = new Set();
  if (!Array.isArray(s.faqEntries)) err('faqEntries', 'array');
  else for (const f of s.faqEntries) {
    faqIds.add(f.id);
    if (!isStr(f.title, LIMITS.title) || !f.title.trim() || !isStr(f.answer, LIMITS.text)) err(`faqEntries.${f.id}`, 'text');
    if (!Array.isArray(f.keywords) || !Array.isArray(f.questionIds)) err(`faqEntries.${f.id}`, 'arrays');
    else for (const id of f.questionIds) if (!qIds.has(id)) err(`faqEntries.${f.id}`, `question ${id}`);
  }
  for (const q of s.questions || []) if (q.faqId != null && !faqIds.has(q.faqId)) err(`questions.${q.id}`, 'faqId');
  if (!Array.isArray(s.issueLogs)) err('issueLogs', 'array');
  else for (const i of s.issueLogs) {
    const p = `issueLogs.${i.id}`;
    if (!isStr(i.title, LIMITS.title) || !i.title.trim() || !ISSUE_STATUSES.includes(i.status)) err(p, 'fields');
    if (i.reportedTo != null && !REPORTED_TO.includes(i.reportedTo)) err(p, 'reportedTo');
    if (!Array.isArray(i.occurrences)) err(p, 'occurrences');
    else for (const o of i.occurrences) if (!isValidDate(o.date)) err(p, 'occurrence date');
    if (i.taskId != null && !taskIds.has(i.taskId)) err(p, 'taskId');
    if (!optDate(i.followUpOn)) err(p, 'followUpOn');
  }
  if (!Array.isArray(s.workNotes)) err('workNotes', 'array');
  else for (const n of s.workNotes) {
    if (!isStr(n.body, LIMITS.noteBody) || !optStr(n.title, LIMITS.title)) err(`workNotes.${n.id}`, 'text');
    if (n.taskId != null && !taskIds.has(n.taskId)) err(`workNotes.${n.id}`, 'taskId');
  }
  for (const t of s.tasks || []) {
    if (t.meetingId != null && !mIds.has(t.meetingId)) err(`tasks.${t.id}`, 'meetingId');
    if (t.questionId != null && !qIds.has(t.questionId)) err(`tasks.${t.id}`, 'questionId');
  }
  if (!isObj(s.dailyReports)) err('dailyReports', 'object');
  else for (const [d, r] of Object.entries(s.dailyReports)) if (!isValidDate(d) || !isObj(r)) err('dailyReports', `entry ${d}`);
  if (!Array.isArray(s.importHistory)) err('importHistory', 'array');
  if (!isObj(s.alertDismissals) || !isObj(s.dayNotes)) err('misc', 'objects');
  else for (const [d, n] of Object.entries(s.dayNotes)) {
    if (!isValidDate(d) || !isObj(n) || !optStr(n.notes, LIMITS.noteBody) || !optStr(n.accomplishments, LIMITS.noteBody)) err('dayNotes', `entry ${d}`);
  }
  return { ok: e.length === 0, errors: e };
}
