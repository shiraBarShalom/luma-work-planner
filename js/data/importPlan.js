// `luma-work-plan` v1 import pipeline:
// parse as data -> structural validation -> semantic validation -> normalize -> detect
// existing records, conflicts and possible duplicates -> read-only preview -> user
// selection and resolution -> atomic apply (in a store command) with import history.
// Nothing in this module mutates state except applyPlanImport/applyUndoImport, which only
// run on a store draft inside a transaction.
import { PLAN_FORMAT, PLAN_SCHEMA_VERSION, LIMITS } from '../config.js';
import { isValidDate, isValidTime, toMin, fromMin, weekday, addDays } from '../dates.js';
import { TEMPLATE_ROLES, PRIORITIES, LOCATIONS, QUESTION_AUDIENCES, QUESTION_DIRECTIONS, MEETING_TYPES } from './schema.js';
import { parseJsonSafe, isPlainObject, fingerprint } from './safeJson.js';
import { normalize } from '../engine/search.js';
import { dayOccurrences } from '../engine/schedule.js';
import { effectiveDay } from '../engine/dayTemplates.js';

export const PLAN_COLLECTIONS = ['days', 'blocks', 'meetings', 'tasks', 'questions'];
export const PLAN_KINDS = ['weekly', 'dailyPatch'];
export const COLLECTION_LABEL = { days: 'ימים', blocks: 'בלוקים', meetings: 'פגישות', tasks: 'משימות', questions: 'שאלות' };

/** Exact v1 field contract (kept aligned with schemas/weekly-plan.schema.json by tests). */
export const PLAN_FIELDS = {
  envelope: { required: ['format', 'schemaVersion', 'kind', 'planId'], optional: ['weekStart', 'days', 'blocks', 'meetings', 'tasks', 'questions'] },
  days: { required: ['externalId', 'date'], optional: ['isWorking', 'location', 'phoneDuty', 'phoneStart', 'phoneEnd', 'workStart', 'workEnd', 'inquiryTarget', 'templateId'] },
  blocks: { required: ['externalId', 'date', 'title'], optional: ['start', 'end', 'durationMinutes', 'categoryId', 'role', 'notes', 'pinned', 'taskRefs'] },
  meetings: { required: ['externalId', 'title', 'meetingType'], optional: ['date', 'start', 'end', 'durationMinutes', 'agendaRefs', 'notes'] },
  tasks: { required: ['externalId', 'title'], optional: ['scheduledDate', 'deadline', 'priority', 'categoryId', 'estimateMinutes', 'subtasks', 'notes', 'preferredRole'] },
  questions: { required: ['externalId', 'title', 'audience'], optional: ['direction', 'priority', 'followUpOn', 'notes', 'meetingRef'] },
};

const ID_RE = /^[\p{L}\p{N}][\p{L}\p{N}._:-]{0,99}$/u;
const str = (max) => (v) => (typeof v === 'string' && v.trim().length > 0 && v.length <= max ? null : `טקסט באורך 1–${max}`);
const optText = (max) => (v) => (typeof v === 'string' && v.length <= max ? null : `טקסט עד ${max} תווים`);
const oneOf = (list) => (v) => (list.includes(v) ? null : `ערך מותר: ${list.join(' / ')}`);
const date = (v) => (isValidDate(v) ? null : 'תאריך YYYY-MM-DD תקין');
const time = (v) => (isValidTime(v) ? null : 'שעה HH:MM תקינה');
const bool = (v) => (typeof v === 'boolean' ? null : 'true/false');
const int = (min, max) => (v) => (Number.isInteger(v) && v >= min && v <= max ? null : `מספר שלם ${min}–${max}`);
const idRef = (v) => (typeof v === 'string' && ID_RE.test(v) ? null : 'מזהה תקין');
const idList = (v) => (Array.isArray(v) && v.length <= 100 && v.every((x) => !idRef(x)) ? null : 'רשימת מזהים');
const strList = (v) => (Array.isArray(v) && v.length <= LIMITS.subtasks && v.every((x) => typeof x === 'string' && x.trim() && x.length <= LIMITS.title) ? null : `רשימת טקסטים (עד ${LIMITS.subtasks})`);

const CHECKS = {
  days: { externalId: idRef, date, isWorking: bool, location: oneOf(LOCATIONS), phoneDuty: bool, phoneStart: time, phoneEnd: time, workStart: time, workEnd: time, inquiryTarget: int(0, 200), templateId: str(80) },
  blocks: { externalId: idRef, date, title: str(LIMITS.title), start: time, end: time, durationMinutes: int(1, 720), categoryId: str(60), role: oneOf(TEMPLATE_ROLES), notes: optText(2000), pinned: bool, taskRefs: idList },
  meetings: { externalId: idRef, title: str(LIMITS.title), meetingType: oneOf(MEETING_TYPES), date, start: time, end: time, durationMinutes: int(1, 720), agendaRefs: idList, notes: optText(2000) },
  tasks: { externalId: idRef, title: str(LIMITS.title), scheduledDate: date, deadline: date, priority: oneOf(PRIORITIES), categoryId: str(60), estimateMinutes: int(1, 1440), subtasks: strList, notes: optText(2000), preferredRole: oneOf(TEMPLATE_ROLES) },
  questions: { externalId: idRef, title: str(LIMITS.title), audience: oneOf(QUESTION_AUDIENCES), direction: oneOf(QUESTION_DIRECTIONS), priority: oneOf(PRIORITIES), followUpOn: date, notes: optText(2000), meetingRef: idRef },
};

export class PlanError extends Error {
  constructor(code, message, errors = []) { super(message); this.code = code; this.errors = errors; }
}

/** Parse text and run structural + semantic validation. Throws PlanError with all errors. */
/** ChatGPT often wraps JSON in a Markdown code fence; strip one surrounding fence only. */
export function stripCodeFence(text) {
  if (typeof text !== 'string') return text;
  const m = /^\s*```(?:json|JSON)?[ \t]*\r?\n([\s\S]*?)\r?\n```\s*$/.exec(text);
  return m ? m[1] : text;
}

export function parsePlan(text) {
  let obj;
  try {
    obj = parseJsonSafe(stripCodeFence(text), { maxBytes: LIMITS.planBytes, maxDepth: 12 });
  } catch (e) {
    throw new PlanError(e.code || 'parse', e.message);
  }
  return validatePlan(obj);
}

export function validatePlan(obj) {
  const errors = [];
  const add = (path, message) => { if (errors.length < 100) errors.push({ path, message }); };
  if (!isPlainObject(obj)) throw new PlanError('shape', 'התוכן אינו אובייקט JSON של תוכנית', [{ path: '', message: 'נדרש אובייקט' }]);
  if (obj.format === 'luma-work-backup') throw new PlanError('backup-file', 'זהו קובץ גיבוי מלא ולא תוכנית. לשחזור גיבוי יש להשתמש בהגדרות ← גיבוי ושחזור.');
  if (obj.format !== PLAN_FORMAT) throw new PlanError('format', `השדה format חייב להיות "${PLAN_FORMAT}"`, [{ path: 'format', message: 'פורמט לא מוכר' }]);
  if (obj.schemaVersion !== PLAN_SCHEMA_VERSION) throw new PlanError('version', `גרסת סכמה לא נתמכת (${String(obj.schemaVersion)}). הגרסה הנתמכת היא ${PLAN_SCHEMA_VERSION}.`, [{ path: 'schemaVersion', message: 'גרסה לא נתמכת' }]);
  const env = PLAN_FIELDS.envelope;
  for (const k of Object.keys(obj)) if (!env.required.includes(k) && !env.optional.includes(k)) add(k, 'שדה לא מוכר ברמת התוכנית');
  if (!PLAN_KINDS.includes(obj.kind)) add('kind', 'kind חייב להיות weekly או dailyPatch');
  if (typeof obj.planId !== 'string' || !ID_RE.test(obj.planId)) add('planId', 'planId חסר או לא תקין');
  if (obj.weekStart != null && (!isValidDate(obj.weekStart) || weekday(obj.weekStart) !== 0)) add('weekStart', 'weekStart חייב להיות תאריך של יום ראשון');
  if (obj.kind === 'weekly' && obj.weekStart == null) add('weekStart', 'בתוכנית שבועית חובה weekStart');
  let total = 0;
  for (const c of PLAN_COLLECTIONS) {
    const arr = obj[c];
    if (arr == null) continue;
    if (!Array.isArray(arr)) { add(c, 'נדרש מערך'); continue; }
    total += arr.length;
  }
  if (total > LIMITS.planItems) throw new PlanError('too-many', `יותר מדי פריטים בתוכנית (${total}). המגבלה היא ${LIMITS.planItems}.`);
  if (total === 0) add('', 'התוכנית אינה כוללת שינויים');
  for (const c of PLAN_COLLECTIONS) {
    const arr = Array.isArray(obj[c]) ? obj[c] : [];
    const spec = PLAN_FIELDS[c];
    const seen = new Set();
    arr.forEach((item, i) => {
      const p = `${c}[${i}]`;
      if (!isPlainObject(item)) { add(p, 'נדרש אובייקט'); return; }
      for (const k of Object.keys(item)) if (!spec.required.includes(k) && !spec.optional.includes(k)) add(`${p}.${k}`, 'שדה לא מוכר');
      for (const k of spec.required) if (item[k] == null) add(`${p}.${k}`, 'שדה חובה חסר');
      for (const [k, check] of Object.entries(CHECKS[c])) {
        if (item[k] == null) continue;
        const m = check(item[k]);
        if (m) add(`${p}.${k}`, m);
      }
      if (typeof item.externalId === 'string') {
        if (seen.has(item.externalId)) add(`${p}.externalId`, 'externalId כפול באותו אוסף');
        seen.add(item.externalId);
      }
    });
  }
  if (errors.length) throw new PlanError('invalid', 'התוכנית אינה עומדת בסכמה', errors);
  semanticChecks(obj, add);
  if (errors.length) throw new PlanError('invalid', 'נמצאו שגיאות תוכן בתוכנית', errors);
  return normalizePlan(obj);
}

function semanticChecks(obj, add) {
  const ids = Object.fromEntries(PLAN_COLLECTIONS.map((c) => [c, new Set((obj[c] || []).map((x) => x.externalId))]));
  const checkInterval = (p, it) => {
    if (it.start && it.end && toMin(it.end) <= toMin(it.start)) add(`${p}.end`, 'שעת הסיום חייבת להיות אחרי שעת ההתחלה');
    if (it.start && it.end && Number.isInteger(it.durationMinutes) && toMin(it.end) - toMin(it.start) !== it.durationMinutes) add(`${p}.durationMinutes`, 'המשך אינו תואם לשעות ההתחלה והסיום');
    if (!it.start && it.end) add(`${p}.start`, 'שעת סיום ללא שעת התחלה');
    if (it.start && Number.isInteger(it.durationMinutes) && toMin(it.start) + it.durationMinutes > 24 * 60 - 1) add(`${p}.durationMinutes`, 'המשך חוצה את חצות');
  };
  (obj.days || []).forEach((d, i) => {
    const p = `days[${i}]`;
    if (d.workStart && d.workEnd && toMin(d.workEnd) <= toMin(d.workStart)) add(`${p}.workEnd`, 'סוף יום העבודה חייב להיות אחרי תחילתו');
    if (d.phoneStart && d.phoneEnd && toMin(d.phoneEnd) <= toMin(d.phoneStart)) add(`${p}.phoneEnd`, 'סוף התורנות חייב להיות אחרי תחילתה');
    if (Object.keys(d).filter((k) => k !== 'externalId' && k !== 'date' && d[k] != null).length === 0) add(p, 'אין שינוי ביום הזה');
  });
  const dayDates = new Set();
  (obj.days || []).forEach((d, i) => { if (dayDates.has(d.date)) add(`days[${i}].date`, 'אותו תאריך מופיע פעמיים'); dayDates.add(d.date); });
  (obj.blocks || []).forEach((b, i) => {
    checkInterval(`blocks[${i}]`, b);
    for (const r of b.taskRefs || []) if (!ids.tasks.has(r)) add(`blocks[${i}].taskRefs`, `הפניה למשימה לא קיימת: ${r}`);
  });
  (obj.meetings || []).forEach((m, i) => {
    checkInterval(`meetings[${i}]`, m);
    if (!m.date && (m.start || m.end)) add(`meetings[${i}].date`, 'שעה ללא תאריך');
    for (const r of m.agendaRefs || []) if (!ids.questions.has(r)) add(`meetings[${i}].agendaRefs`, `הפניה לשאלה לא קיימת: ${r}`);
  });
  (obj.questions || []).forEach((q, i) => {
    if (q.meetingRef && !ids.meetings.has(q.meetingRef)) add(`questions[${i}].meetingRef`, `הפניה לפגישה לא קיימת: ${q.meetingRef}`);
  });
}

function clean(item) {
  const out = {};
  for (const [k, v] of Object.entries(item)) {
    if (v == null) continue;
    out[k] = typeof v === 'string' ? v.trim() : Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x.trim() : x)) : v;
  }
  return out;
}

/** Normalized plan: nulls removed (null = unknown), strings trimmed, items keyed. */
export function normalizePlan(obj) {
  const items = [];
  for (const c of PLAN_COLLECTIONS) {
    for (const raw of obj[c] || []) {
      const data = clean(raw);
      const { externalId, ...content } = data;
      items.push({ collection: c, externalId, key: `${c}:${externalId}`, data, fp: fingerprint(content) });
    }
  }
  const range = planRange(obj);
  const plan = { format: PLAN_FORMAT, schemaVersion: PLAN_SCHEMA_VERSION, kind: obj.kind, planId: obj.planId, weekStart: obj.weekStart || null, items, range };
  plan.fingerprint = fingerprint({ kind: plan.kind, planId: plan.planId, weekStart: plan.weekStart, items: items.map((i) => [i.key, i.fp]) });
  return plan;
}

function planRange(obj) {
  if (obj.weekStart) return { from: obj.weekStart, to: addDays(obj.weekStart, 6) };
  const dates = [];
  for (const d of obj.days || []) dates.push(d.date);
  for (const b of obj.blocks || []) dates.push(b.date);
  for (const m of obj.meetings || []) if (m.date) dates.push(m.date);
  for (const t of obj.tasks || []) if (t.scheduledDate) dates.push(t.scheduledDate);
  dates.sort();
  return dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null;
}

// ---------------- detection & preview ----------------

const ENTITY = { blocks: 'calendarBlocks', meetings: 'meetings', tasks: 'tasks', questions: 'questions' };

function importIndex(state) {
  const applied = new Map(); // key planId|collection|externalId -> {entityId, fingerprint, at}
  const excluded = new Map();
  for (const h of state.importHistory) {
    if (h.undoneAt && !h.partialUndo) continue;
    for (const it of h.items) {
      if (it.reverted) continue;
      applied.set(`${h.planId}|${it.collection}|${it.externalId}`, { entityId: it.entityId, fingerprint: it.fingerprint, at: h.appliedAt });
    }
    for (const it of h.excluded || []) excluded.set(`${h.planId}|${it.collection}|${it.externalId}`, it);
  }
  return { applied, excluded };
}

function findEntity(state, collection, id) {
  if (collection === 'days') return state.dayOverrides[id] || null;
  return state[ENTITY[collection]].find((x) => x.id === id) || null;
}

const wasManuallyEdited = (entity) => !!(entity && entity.editedAt && (!entity.importRef?.at || entity.editedAt > entity.importRef.at));

function endOf(it) {
  if (it.end) return it.end;
  if (it.start && Number.isInteger(it.durationMinutes)) return fromMin(toMin(it.start) + it.durationMinutes);
  return null;
}

function summaryOf(item) {
  const d = item.data;
  switch (item.collection) {
    case 'days': {
      const parts = [];
      if (d.isWorking === false) parts.push('יום ללא עבודה');
      if (d.isWorking === true) parts.push('יום עבודה');
      if (d.location) parts.push({ office: 'משרד', home: 'בית', other: 'מיקום אחר' }[d.location]);
      if (d.workStart || d.workEnd) parts.push(`שעות ${d.workStart || '…'}–${d.workEnd || '…'}`);
      if (d.phoneDuty != null) parts.push(d.phoneDuty ? 'תורנות טלפון' : 'ללא תורנות');
      if (d.phoneStart || d.phoneEnd) parts.push(`תורנות ${d.phoneStart || '…'}–${d.phoneEnd || '…'}`);
      if (d.inquiryTarget != null) parts.push(`יעד ${d.inquiryTarget}`);
      if (d.templateId) parts.push(`תבנית ${d.templateId}`);
      return { title: d.date, sub: parts.join(' · ') };
    }
    case 'blocks': return { title: d.title, sub: `${d.date}${d.start ? ` · ${d.start}–${endOf(d) || '?'}` : ' · ללא שעה'}` };
    case 'meetings': return { title: d.title, sub: d.date ? `${d.date}${d.start ? ` · ${d.start}–${endOf(d) || '?'}` : ''}` : 'ללא מועד – תישאר בתור הנושאים' };
    case 'tasks': return { title: d.title, sub: [d.scheduledDate && `לביצוע ${d.scheduledDate}`, d.deadline && `יעד ${d.deadline}`, d.estimateMinutes && `${d.estimateMinutes} דק׳`].filter(Boolean).join(' · ') || 'ללא תאריך' };
    case 'questions': return { title: d.title, sub: d.audience === 'manager' ? 'למנהל' : 'לצוות' };
    default: return { title: item.key, sub: '' };
  }
}

/**
 * Build a read-only preview of a validated, normalized plan against the current state.
 * @returns {Object} preview (pure data)
 */
export function buildPreview(state, plan, { allowOutsideWeek = false } = {}) {
  const idx = importIndex(state);
  const cats = new Set(state.settings.categories.filter((c) => !c.archived).map((c) => c.id));
  const tpls = new Set(state.dayTemplates.map((t) => t.id));
  const items = [];
  const planDates = plan.range;
  const inWeek = (d) => !plan.weekStart || (d >= plan.weekStart && d <= addDays(plan.weekStart, 6));
  for (const it of plan.items) {
    const d = it.data;
    const issues = [];
    const k = `${plan.planId}|${it.collection}|${it.externalId}`;
    const prev = idx.applied.get(k);
    let action = 'add', entityId = null, before = null, existing = null;
    if (it.collection === 'days') {
      existing = state.dayOverrides[d.date] || null;
      if (existing) { action = 'update'; entityId = d.date; before = { ...existing }; }
      if (prev && prev.fingerprint === it.fp && existing && existing.importRef?.planId === plan.planId && existing.importRef?.externalId === it.externalId) action = 'unchanged';
      if (existing && !existing.importRef) issues.push({ type: 'manualEdited', blocking: true, message: 'קיימת הגדרה ידנית ליום הזה. העדכון ידרוס אותה רק באישור מפורש.' });
      else if (existing && wasManuallyEdited(existing) && action === 'update') issues.push({ type: 'manualEdited', blocking: true, message: 'ההגדרה ליום נערכה ידנית אחרי ייבוא קודם.' });
    } else if (prev) {
      existing = findEntity(state, it.collection, prev.entityId);
      if (!existing) { action = 'add'; issues.push({ type: 'previouslyRemoved', blocking: false, message: 'הפריט יובא בעבר והוסר מאז. אפשר להוסיף אותו שוב במפורש.' }); }
      else if (prev.fingerprint === it.fp) { action = 'unchanged'; entityId = existing.id; }
      else {
        action = 'update'; entityId = existing.id; before = existing;
        if (wasManuallyEdited(existing)) issues.push({ type: 'manualEdited', blocking: true, message: 'הפריט נערך ידנית אחרי הייבוא. העדכון ידרוס את השינויים רק באישור מפורש.' });
      }
    } else if (idx.excluded.has(k)) {
      issues.push({ type: 'previouslyExcluded', blocking: false, message: 'הפריט הוחרג בייבוא קודם של אותה תוכנית.' });
    }
    // Scope.
    const dates = [it.collection === 'days' && d.date, it.collection === 'blocks' && d.date, it.collection === 'meetings' && d.date, it.collection === 'tasks' && d.scheduledDate].filter(Boolean);
    if (plan.kind === 'weekly' && dates.some((x) => !inWeek(x))) {
      issues.push({ type: 'outsideWeek', blocking: !allowOutsideWeek, message: allowOutsideWeek ? 'מחוץ לשבוע המבוקש (הורחב באישורך)' : 'התאריך מחוץ לשבוע המבוקש' });
    }
    // Mapping of categories/templates.
    if (d.categoryId && !cats.has(d.categoryId)) issues.push({ type: 'unknownCategory', blocking: true, message: `קטגוריה לא מוכרת: ${d.categoryId}. יש לבחור קטגוריה קיימת.` });
    if (d.templateId && !tpls.has(d.templateId)) issues.push({ type: 'unknownTemplate', blocking: true, message: `תבנית לא מוכרת: ${d.templateId}. יש לבחור תבנית קיימת או להתעלם.` });
    // Timing.
    if (it.collection === 'blocks') {
      if (!d.start) issues.push({ type: 'needsTime', blocking: true, field: 'start', message: 'לבלוק אין שעת התחלה. יש להשלים שעה או להחריג (אפשר לייבא את העבודה כמשימה).' });
      else if (!endOf(d)) issues.push({ type: 'needsTime', blocking: true, field: 'end', message: 'לבלוק אין שעת סיום או משך. יש להשלים לפני השיבוץ ביומן.' });
    }
    if (it.collection === 'meetings' && d.date && d.start && !endOf(d)) {
      issues.push({ type: 'needsTime', blocking: true, field: 'end', message: 'לפגישה אין משך או שעת סיום. יש להשלים, או להחריג אותה.' });
    }
    // Possible semantic duplicates (different IDs, similar content).
    if (action === 'add') {
      const dup = findDuplicate(state, it);
      if (dup) issues.push({ type: 'possibleDuplicate', blocking: false, message: `ייתכן שכבר קיים: ״${dup}״. הפריט לא יתווסף אלא אם תבחרי בו.`, duplicateOf: dup });
    }
    // Non-working day with existing manual blocks.
    if (it.collection === 'days' && d.isWorking === false) {
      const manual = dayOccurrences(state, d.date).filter((o) => o.kind !== 'routine');
      if (manual.length) issues.push({ type: 'nonWorkingWithBlocks', blocking: false, message: `ביום זה קיימות ${manual.length} פעילויות ידניות. הן יישמרו ויסומנו לבדיקה.` });
    }
    const sum = summaryOf(it);
    const defaultSelected = action !== 'unchanged' && !issues.some((x) => ['possibleDuplicate', 'previouslyExcluded', 'previouslyRemoved', 'manualEdited'].includes(x.type));
    items.push({
      key: it.key, collection: it.collection, externalId: it.externalId, fp: it.fp, data: d, action, entityId, before: before ? summarizeBefore(it.collection, before) : null,
      title: sum.title, sub: sum.sub, issues, defaultSelected,
      deps: depsOf(it),
    });
  }
  // Overlaps among timed blocks/meetings (warnings).
  const timed = items.filter((x) => (x.collection === 'blocks' || x.collection === 'meetings') && x.data.date && x.data.start && endOf(x.data));
  for (const x of timed) {
    const s = toMin(x.data.start), e = toMin(endOf(x.data));
    const existing = dayOccurrences(state, x.data.date).filter((o) => o.status !== 'canceled' && o.s < e && s < o.e && !(x.entityId && (o.sourceId === x.entityId)));
    for (const o of existing) {
      const severe = o.kind === 'meeting' || o.protected;
      x.issues.push({ type: severe ? 'protectedOverlap' : 'overlap', blocking: false, message: `חופף ל־״${o.title}״ (${o.start}–${o.end})${severe ? ' – נדרש אישור מפורש' : ''}` });
    }
    for (const y of timed) {
      if (y === x || y.data.date !== x.data.date) continue;
      const s2 = toMin(y.data.start), e2 = toMin(endOf(y.data));
      if (s < e2 && s2 < e) x.issues.push({ type: 'overlap', blocking: false, message: `חופף לפריט אחר בתוכנית: ״${y.title}״` });
    }
    const eff = effectiveDay(state, x.data.date);
    if (eff.isWorking && (s < toMin(eff.workStart) || e > toMin(eff.workEnd))) x.issues.push({ type: 'outsideHours', blocking: false, message: 'מחוץ לשעות העבודה המוגדרות' });
  }
  const counts = {
    total: items.length,
    add: items.filter((i) => i.action === 'add').length,
    update: items.filter((i) => i.action === 'update').length,
    unchanged: items.filter((i) => i.action === 'unchanged').length,
    duplicates: items.filter((i) => i.issues.some((x) => x.type === 'possibleDuplicate')).length,
    conflicts: items.filter((i) => i.issues.some((x) => ['overlap', 'protectedOverlap', 'manualEdited', 'nonWorkingWithBlocks'].includes(x.type))).length,
    needsCompletion: items.filter((i) => i.issues.some((x) => x.type === 'needsTime' || x.type === 'unknownCategory' || x.type === 'unknownTemplate')).length,
  };
  return {
    planId: plan.planId, kind: plan.kind, weekStart: plan.weekStart, range: planDates, fingerprint: plan.fingerprint,
    stateRevision: state.metadata.revision, allowOutsideWeek, items, counts,
    exactReplay: items.length > 0 && items.every((i) => i.action === 'unchanged'),
    plan,
  };
}

function summarizeBefore(collection, e) {
  if (collection === 'days') return { ...e };
  const pick = ['title', 'date', 'start', 'end', 'durationMinutes', 'scheduledDate', 'deadline', 'priority', 'categoryId', 'estimateMinutes', 'audience', 'status', 'meetingType'];
  return Object.fromEntries(pick.filter((k) => e[k] !== undefined).map((k) => [k, e[k]]));
}

function depsOf(it) {
  const d = it.data;
  if (it.collection === 'blocks') return (d.taskRefs || []).map((r) => `tasks:${r}`);
  if (it.collection === 'meetings') return (d.agendaRefs || []).map((r) => `questions:${r}`);
  if (it.collection === 'questions') return d.meetingRef ? [`meetings:${d.meetingRef}`] : [];
  return [];
}

function findDuplicate(state, it) {
  const d = it.data;
  const n = normalize(d.title || '');
  switch (it.collection) {
    case 'tasks': {
      const t = state.tasks.find((x) => x.status !== 'canceled' && normalize(x.title) === n && (!d.scheduledDate || !x.scheduledDate || x.scheduledDate === d.scheduledDate || x.status !== 'done'));
      return t ? t.title : null;
    }
    case 'questions': {
      const q = state.questions.find((x) => (x.status === 'open' || x.status === 'waiting') && normalize(x.title) === n);
      return q ? q.title : null;
    }
    case 'meetings': {
      const m = state.meetings.find((x) => x.status !== 'canceled' && ((normalize(x.title) === n && (x.date || null) === (d.date || null)) || (d.date && x.date === d.date && d.start && x.start === d.start && x.meetingType === d.meetingType)));
      return m ? m.title : null;
    }
    case 'blocks': {
      const o = dayOccurrences(state, d.date).find((x) => normalize(x.title) === n && (!d.start || x.start === d.start));
      return o ? o.title : null;
    }
    default: return null;
  }
}

/**
 * Apply the user's selection and resolutions to a preview.
 * @param {Object} preview
 * @param {Record<string, boolean>} selection  key -> include
 * @param {Record<string, Object>} resolutions key -> {start,end,durationMinutes,categoryId,templateId,dropRefs,overwriteManual}
 * @param {{ackOverlaps?: boolean}} opts
 * @returns {{ok:boolean, errors:Array<{key:string,message:string}>, items:Array}}
 */
export function resolveSelection(preview, selection, resolutions = {}, { ackOverlaps = false } = {}) {
  const errors = [];
  const chosen = preview.items.filter((i) => i.action !== 'unchanged' && (selection[i.key] ?? i.defaultSelected));
  const chosenKeys = new Set(chosen.map((i) => i.key));
  const existingKeys = new Set(preview.items.filter((i) => i.action === 'unchanged' && i.entityId).map((i) => i.key));
  const out = [];
  for (const i of chosen) {
    const r = resolutions[i.key] || {};
    const data = { ...i.data };
    for (const iss of i.issues) {
      if (iss.type === 'needsTime') {
        if (iss.field === 'start' && r.start && isValidTime(r.start)) data.start = r.start;
        if (r.end && isValidTime(r.end)) data.end = r.end;
        if (Number.isInteger(r.durationMinutes) && r.durationMinutes > 0) data.durationMinutes = r.durationMinutes;
        if (!data.start || !endOf(data) || toMin(endOf(data)) <= toMin(data.start)) { errors.push({ key: i.key, message: `${i.title}: ${iss.message}` }); continue; }
        if (data.end && Number.isInteger(data.durationMinutes) && toMin(data.end) - toMin(data.start) !== data.durationMinutes) delete data.durationMinutes;
      } else if (iss.type === 'unknownCategory') {
        if (r.categoryId) data.categoryId = r.categoryId; else errors.push({ key: i.key, message: `${i.title}: יש לבחור קטגוריה` });
      } else if (iss.type === 'unknownTemplate') {
        if (r.templateId === null || r.templateId === '') delete data.templateId;
        else if (r.templateId) data.templateId = r.templateId;
        else errors.push({ key: i.key, message: `${i.title}: יש לבחור תבנית או להתעלם ממנה` });
      } else if (iss.type === 'manualEdited') {
        if (!r.overwriteManual) errors.push({ key: i.key, message: `${i.title}: נדרש אישור לדריסת עריכה ידנית` });
      } else if (iss.type === 'outsideWeek' && iss.blocking) {
        errors.push({ key: i.key, message: `${i.title}: ${iss.message}` });
      } else if (iss.type === 'protectedOverlap' && !ackOverlaps) {
        errors.push({ key: i.key, message: `${i.title}: ${iss.message}` });
      }
    }
    const missing = i.deps.filter((k) => !chosenKeys.has(k) && !existingKeys.has(k));
    if (missing.length && !r.dropRefs) errors.push({ key: i.key, message: `${i.title}: מפנה לפריטים שהוחרגו (${missing.join(', ')}). יש להסיר את ההפניה או לכלול אותם.` });
    out.push({ ...i, data, dropRefs: missing, overwriteManual: !!r.overwriteManual });
  }
  if (!out.length) errors.push({ key: '', message: 'לא נבחרו שינויים לייבוא' });
  return { ok: errors.length === 0, errors, items: out };
}

/**
 * Apply a resolved selection to a store draft. Re-validates the preview against the draft
 * so a stale preview can never be committed.
 */
export function applyPlanImport(draft, { plan, selection, resolutions, ackOverlaps, allowOutsideWeek, expectedRevision }, ctx) {
  const baseRevision = ctx.baseRevision ?? draft.metadata.revision;
  if (baseRevision !== expectedRevision) {
    throw Object.assign(new Error('stale'), { code: 'stale-preview', messageHe: 'הנתונים השתנו מאז התצוגה המקדימה. יש לבנות אותה מחדש.' });
  }
  const preview = buildPreview(draft, plan, { allowOutsideWeek });
  const res = resolveSelection(preview, selection, resolutions, { ackOverlaps });
  if (!res.ok) throw Object.assign(new Error('unresolved'), { code: 'unresolved', messageHe: res.errors.map((e) => e.message).join('\n') });
  const now = ctx.nowIso;
  const idFor = new Map();
  for (const i of preview.items) if (i.entityId && i.collection !== 'days') idFor.set(i.key, i.entityId);
  for (const i of res.items) if (i.action === 'add' && i.collection !== 'days') idFor.set(i.key, ctx.uid());
  const ref = (it) => ({ planId: plan.planId, externalId: it.externalId, fingerprint: it.fp, at: now });
  const history = { id: ctx.uid(), planId: plan.planId, planFingerprint: plan.fingerprint, kind: plan.kind, range: plan.range, appliedAt: now, items: [], excluded: [], undoneAt: null, revisionAfter: null };
  const order = ['questions', 'tasks', 'meetings', 'blocks', 'days'];
  const byCollection = (c) => res.items.filter((i) => i.collection === c);
  const resolveRefs = (refs, coll, dropped) => (refs || []).map((r) => `${coll}:${r}`).filter((k) => !dropped.includes(k)).map((k) => idFor.get(k)).filter(Boolean);
  for (const c of order) {
    for (const it of byCollection(c)) {
      const d = it.data;
      const entityId = c === 'days' ? d.date : idFor.get(it.key);
      let before = null;
      if (c === 'questions') {
        const fields = { title: d.title, audience: d.audience, direction: d.direction || null, priority: d.priority || 'medium', followUpOn: d.followUpOn || null, detail: d.notes || '' };
        if (it.action === 'add') {
          draft.questions.push({ id: entityId, kind: 'question', ...fields, status: 'open', answer: '', answeredOn: null, recurring: false, faqId: null, categoryId: null, createdDate: ctx.today, createdAt: now, updatedAt: now, importRef: ref(it) });
        } else {
          const q = draft.questions.find((x) => x.id === entityId);
          before = pickKeys(q, Object.keys(fields));
          Object.assign(q, fields, { updatedAt: now, importRef: ref(it) });
        }
      } else if (c === 'tasks') {
        const fields = {
          title: d.title, scheduledDate: d.scheduledDate || null, deadline: d.deadline || null, priority: d.priority || 'medium',
          categoryId: d.categoryId || 'admin', estimateMinutes: d.estimateMinutes ?? null, details: d.notes || '', preferredRole: d.preferredRole || null,
        };
        if (it.action === 'add') {
          draft.tasks.push({
            id: entityId, ...fields, status: 'todo', originalScheduledDate: fields.scheduledDate, actualMinutes: null,
            subtasks: (d.subtasks || []).map((title) => ({ id: ctx.uid(), title, done: false })), recurringRuleId: null, occurrenceDate: null,
            assignedBlock: null, assignmentManual: false, pinned: false, meetingId: null, questionId: null, waiting: null, resumeOn: null,
            source: { kind: 'import', planId: plan.planId }, scheduleHistory: [], createdAt: now, updatedAt: now, completedAt: null, completedOn: null, canceledOn: null, importRef: ref(it),
          });
        } else {
          const t = draft.tasks.find((x) => x.id === entityId);
          before = pickKeys(t, [...Object.keys(fields), 'subtasks']);
          if (fields.scheduledDate !== t.scheduledDate) t.scheduleHistory.push({ from: t.scheduledDate, to: fields.scheduledDate, at: now, by: 'import' });
          Object.assign(t, fields, { updatedAt: now, importRef: ref(it) });
          if (!t.originalScheduledDate) t.originalScheduledDate = fields.scheduledDate;
          if (d.subtasks) {
            const existing = new Map(t.subtasks.map((s) => [normalize(s.title), s]));
            t.subtasks = d.subtasks.map((title) => existing.get(normalize(title)) || { id: ctx.uid(), title, done: false });
          }
        }
      } else if (c === 'meetings') {
        const agenda = resolveRefs(d.agendaRefs, 'questions', it.dropRefs);
        const fields = { title: d.title, meetingType: d.meetingType, date: d.date || null, start: d.start || null, end: d.end || null, durationMinutes: d.durationMinutes ?? null, notes: d.notes || '' };
        if (fields.start && !fields.end && fields.durationMinutes) fields.end = fromMin(toMin(fields.start) + fields.durationMinutes);
        if (it.action === 'add') {
          draft.meetings.push({ id: entityId, ...fields, location: '', agenda, status: 'planned', createdAt: now, updatedAt: now, importRef: ref(it) });
        } else {
          const m = draft.meetings.find((x) => x.id === entityId);
          before = pickKeys(m, [...Object.keys(fields), 'agenda']);
          Object.assign(m, fields, { agenda: [...new Set([...(m.agenda || []), ...agenda])], updatedAt: now, importRef: ref(it) });
        }
      } else if (c === 'blocks') {
        const end = endOf(d);
        const fields = { title: d.title, date: d.date, start: d.start, end, categoryId: d.categoryId || roleCategory(draft, d.role) || 'admin', role: d.role || null, notes: d.notes || '', pinned: !!d.pinned };
        if (it.action === 'add') {
          draft.calendarBlocks.push({ id: entityId, ...fields, recurrence: null, source: 'import', movedFrom: null, protected: false, flexible: true, minMinutes: 0, createdAt: now, updatedAt: now, importRef: ref(it) });
        } else {
          const b = draft.calendarBlocks.find((x) => x.id === entityId);
          before = pickKeys(b, Object.keys(fields));
          Object.assign(b, fields, { updatedAt: now, importRef: ref(it) });
        }
        for (const taskId of resolveRefs(d.taskRefs, 'tasks', it.dropRefs)) {
          const t = draft.tasks.find((x) => x.id === taskId);
          if (t && !t.assignmentManual && t.status !== 'done' && t.status !== 'canceled') {
            t.assignedBlock = entityId;
            if (!t.scheduledDate) { t.scheduledDate = d.date; t.originalScheduledDate ||= d.date; }
            t.updatedAt = now;
          }
        }
      } else if (c === 'days') {
        const patch = pickKeys(d, ['isWorking', 'location', 'phoneDuty', 'phoneStart', 'phoneEnd', 'workStart', 'workEnd', 'inquiryTarget', 'templateId']);
        const prevOverride = draft.dayOverrides[d.date] || null;
        before = prevOverride ? structuredClone(prevOverride) : null;
        // Plan fields replace the same fields only; other manual settings for the day stay.
        draft.dayOverrides[d.date] = { ...(prevOverride || {}), ...patch, importRef: ref(it) };
        delete draft.dayOverrides[d.date].editedAt;
      }
      history.items.push({ collection: c, externalId: it.externalId, fingerprint: it.fp, entityId, action: it.action === 'add' ? 'added' : 'updated', before });
    }
  }
  // Questions linked to meetings via meetingRef.
  for (const it of byCollection('questions')) {
    if (!it.data.meetingRef || it.dropRefs.includes(`meetings:${it.data.meetingRef}`)) continue;
    const mId = idFor.get(`meetings:${it.data.meetingRef}`);
    const m = mId && draft.meetings.find((x) => x.id === mId);
    const qId = idFor.get(it.key);
    if (m && qId && !m.agenda.includes(qId)) m.agenda.push(qId);
  }
  const chosenKeys = new Set(res.items.map((i) => i.key));
  history.excluded = preview.items.filter((i) => i.action !== 'unchanged' && !chosenKeys.has(i.key)).map((i) => ({ collection: i.collection, externalId: i.externalId, fingerprint: i.fp }));
  history.revisionAfter = expectedRevision + 1;
  draft.importHistory.unshift(history);
  if (draft.importHistory.length > LIMITS.importHistory) draft.importHistory.length = LIMITS.importHistory;
  return { historyId: history.id, added: history.items.filter((x) => x.action === 'added').length, updated: history.items.filter((x) => x.action === 'updated').length, excluded: history.excluded.length };
}

function roleCategory(state, role) {
  if (!role) return null;
  const c = state.settings.categories.find((x) => (x.roles || []).includes(role) && !x.archived);
  return c ? c.id : null;
}

function pickKeys(o, keys) {
  const out = {};
  for (const k of keys) if (o && o[k] !== undefined) out[k] = structuredClone(o[k]);
  return out;
}

// ---------------- undo ----------------

/**
 * Inverse of an applied import. If nothing changed since, the inverse is exact. Otherwise
 * only unaffected changes are reverted; affected ones are kept and listed.
 */
export function previewUndoImport(state, historyId, baseRevision = state.metadata.revision) {
  const h = state.importHistory.find((x) => x.id === historyId);
  if (!h || h.undoneAt) return { ok: false, message: 'אין ייבוא לביטול' };
  const clean = baseRevision === h.revisionAfter;
  const removedTasks = new Set(), removedQuestions = new Set(), removedMeetings = new Set(), removedBlocks = new Set();
  const revert = [], keep = [];
  const editedSince = (e) => e && String(e.updatedAt || '') > h.appliedAt;
  for (const it of h.items) {
    if (it.reverted) continue;
    const label = `${COLLECTION_LABEL[it.collection]}: ${it.externalId}`;
    if (it.collection === 'days') {
      const cur = state.dayOverrides[it.entityId];
      if (!cur) { keep.push({ ...it, label, reason: 'ההגדרה ליום כבר הוסרה' }); continue; }
      if (cur.editedAt || cur.importRef?.at !== h.appliedAt) { keep.push({ ...it, label, reason: 'ההגדרה ליום נערכה מאז' }); continue; }
      revert.push({ ...it, label });
      continue;
    }
    const e = findEntity(state, it.collection, it.entityId);
    if (!e) { keep.push({ ...it, label, reason: 'הפריט כבר הוסר' }); continue; }
    if (!clean && editedSince(e)) { keep.push({ ...it, label: `${label} (${e.title})`, reason: 'נערך מאז הייבוא' }); continue; }
    if (it.action === 'added') {
      if (it.collection === 'tasks') removedTasks.add(e.id);
      if (it.collection === 'questions') removedQuestions.add(e.id);
      if (it.collection === 'meetings') removedMeetings.add(e.id);
      if (it.collection === 'blocks') removedBlocks.add(e.id);
    }
    revert.push({ ...it, label: `${label} (${e.title})` });
  }
  // Removing an added record must not orphan references held by records that stay.
  const blocked = (it) => {
    const id = it.entityId;
    if (it.action !== 'added') return null;
    if (it.collection === 'tasks') {
      if (Object.values(state.dailyPriorities).some((ids) => ids.includes(id))) return 'נבחרה כמשימה חשובה ליום';
      if (state.meetingDecisions.some((d) => d.taskId === id) || state.issueLogs.some((i) => i.taskId === id) || state.workNotes.some((n) => n.taskId === id)) return 'מקושרת לרשומה אחרת';
      const t = state.tasks.find((x) => x.id === id);
      if (t && t.status !== 'todo') return 'הסטטוס שלה השתנה';
    }
    if (it.collection === 'questions') {
      if (state.meetings.some((m) => !removedMeetings.has(m.id) && (m.agenda || []).includes(id) && !(m.importRef && m.importRef.at === h.appliedAt))) return 'משויכת לפגישה קיימת';
      if (state.meetingDecisions.some((d) => d.questionId === id) || state.faqEntries.some((f) => f.questionIds.includes(id))) return 'מקושרת להחלטה או לתשובה נפוצה';
      const q = state.questions.find((x) => x.id === id);
      if (q && q.status !== 'open') return 'הסטטוס שלה השתנה';
    }
    if (it.collection === 'meetings' && state.meetingDecisions.some((d) => d.meetingId === id)) return 'נרשמו בה החלטות';
    if (it.collection === 'blocks') {
      if (state.blockCompletions[id]) return 'סומן כבוצע';
      if (state.tasks.some((t) => t.assignedBlock === id && !removedTasks.has(t.id))) return 'משויכות אליו משימות';
    }
    return null;
  };
  const finalRevert = [];
  for (const it of revert) {
    const reason = blocked(it);
    if (reason) keep.push({ ...it, reason }); else finalRevert.push(it);
  }
  return { ok: true, clean: clean && keep.length === 0, historyId, planId: h.planId, appliedAt: h.appliedAt, revert: finalRevert, keep };
}

export function applyUndoImport(draft, { historyId, expectedRevision }, ctx) {
  const baseRevision = ctx.baseRevision ?? draft.metadata.revision;
  if (baseRevision !== expectedRevision) throw Object.assign(new Error('stale'), { code: 'stale-preview', messageHe: 'הנתונים השתנו. יש לפתוח מחדש את תצוגת הביטול.' });
  const p = previewUndoImport(draft, historyId, baseRevision);
  if (!p.ok) throw Object.assign(new Error('noop'), { code: 'noop', messageHe: p.message });
  const h = draft.importHistory.find((x) => x.id === historyId);
  for (const it of p.revert) {
    const c = it.collection;
    if (c === 'days') {
      if (it.before) draft.dayOverrides[it.entityId] = structuredClone(it.before);
      else delete draft.dayOverrides[it.entityId];
    } else if (it.action === 'added') {
      const coll = ENTITY[c];
      draft[coll] = draft[coll].filter((x) => x.id !== it.entityId);
      if (c === 'questions') for (const m of draft.meetings) m.agenda = (m.agenda || []).filter((id) => id !== it.entityId);
      if (c === 'blocks') {
        for (const t of draft.tasks) if (t.assignedBlock === it.entityId) t.assignedBlock = null;
        delete draft.blockCompletions[it.entityId];
      }
      if (c === 'meetings') for (const t of draft.tasks) if (t.meetingId === it.entityId) t.meetingId = null;
    } else {
      const e = findEntity(draft, c, it.entityId);
      if (e && it.before) Object.assign(e, structuredClone(it.before), { updatedAt: ctx.nowIso });
    }
    const hi = h.items.find((x) => x.collection === it.collection && x.externalId === it.externalId);
    if (hi) hi.reverted = true;
  }
  h.undoneAt = ctx.nowIso;
  h.partialUndo = p.keep.length > 0;
  return { reverted: p.revert.length, kept: p.keep.length };
}
