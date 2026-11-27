// `luma-work-plan` import pipeline (v2, with v1 files accepted and normalized):
// parse as data -> structural validation -> semantic validation -> normalize -> detect
// existing records and possible duplicates -> read-only preview -> user selection and
// resolution -> atomic apply (in a store command) with import history.
//
// Imports are additive: they add activities and tasks next to the existing schedule.
// Overlaps are allowed and never block an import; both activities keep their times.
// Recurring activities are never touched by an import (also enforced by the store).
// Nothing here mutates state except applyPlanImport/applyUndoImport, which only run on a
// store draft inside a transaction.
import { PLAN_FORMAT, PLAN_SCHEMA_VERSION, PLAN_LEGACY_VERSIONS, LIMITS } from '../config.js';
import { isValidDate, isValidTime, toMin, fromMin, weekday, addDays, fmtDayDate } from '../dates.js';
import { PRIORITIES, LOCATIONS, QUESTION_AUDIENCES, QUESTION_DIRECTIONS, MEETING_TYPES, TEMPLATE_ROLES } from './schema.js';
import { parseJsonSafe, isPlainObject, fingerprint } from './safeJson.js';
import { normalize } from '../engine/search.js';
import { dayOccurrences } from '../engine/schedule.js';
import { ACTIVITY_CATEGORY } from '../seed.js';

export const PLAN_COLLECTIONS = ['activities', 'tasks'];
export const PLAN_KINDS = ['weekly', 'dailyPatch'];
export const COLLECTION_LABEL = { activities: 'פעילויות', tasks: 'משימות' };

/** Exact v2 field contract (kept aligned with schemas/weekly-plan.schema.json by tests). */
export const PLAN_FIELDS = {
  envelope: { required: ['format', 'schemaVersion', 'kind', 'planId'], optional: ['weekStart', 'activities', 'tasks'] },
  activities: { required: ['externalId', 'date', 'title'], optional: ['start', 'end', 'durationMinutes', 'notes'] },
  tasks: { required: ['externalId', 'title'], optional: ['scheduledDate', 'deadline', 'priority', 'notes'] },
};

/** The v1 contract, still accepted on import (obsolete parts are reported, not imported). */
export const PLAN_FIELDS_V1 = {
  envelope: { required: ['format', 'schemaVersion', 'kind', 'planId'], optional: ['weekStart', 'days', 'blocks', 'meetings', 'tasks', 'questions'] },
  days: { required: ['externalId', 'date'], optional: ['isWorking', 'location', 'phoneDuty', 'phoneStart', 'phoneEnd', 'workStart', 'workEnd', 'inquiryTarget', 'templateId'] },
  blocks: { required: ['externalId', 'date', 'title'], optional: ['start', 'end', 'durationMinutes', 'categoryId', 'role', 'notes', 'pinned', 'taskRefs'] },
  meetings: { required: ['externalId', 'title', 'meetingType'], optional: ['date', 'start', 'end', 'durationMinutes', 'agendaRefs', 'notes'] },
  tasks: { required: ['externalId', 'title'], optional: ['scheduledDate', 'deadline', 'priority', 'categoryId', 'estimateMinutes', 'subtasks', 'notes', 'preferredRole'] },
  questions: { required: ['externalId', 'title', 'audience'], optional: ['direction', 'priority', 'followUpOn', 'notes', 'meetingRef'] },
};
const V1_COLLECTIONS = ['days', 'blocks', 'meetings', 'tasks', 'questions'];
const DROPPED_LABEL = {
  categoryId: 'קטגוריה', role: 'סוג בלוק', pinned: 'נעיצה', taskRefs: 'שיוך משימות', estimateMinutes: 'הערכת זמן',
  preferredRole: 'בלוק מועדף', meetingType: 'סוג פגישה', agendaRefs: 'נושאים לפגישה',
};

const ID_RE = /^[\p{L}\p{N}][\p{L}\p{N}._:-]{0,99}$/u;
const str = (max) => (v) => (typeof v === 'string' && v.trim().length > 0 && v.length <= max ? null : `טקסט באורך 1-${max}`);
const optText = (max) => (v) => (typeof v === 'string' && v.length <= max ? null : `טקסט עד ${max} תווים`);
const oneOf = (list) => (v) => (list.includes(v) ? null : `ערך מותר: ${list.join(' / ')}`);
const date = (v) => (isValidDate(v) ? null : 'תאריך YYYY-MM-DD תקין');
const time = (v) => (isValidTime(v) ? null : 'שעה HH:MM תקינה');
const bool = (v) => (typeof v === 'boolean' ? null : 'true/false');
const int = (min, max) => (v) => (Number.isInteger(v) && v >= min && v <= max ? null : `מספר שלם ${min}-${max}`);
const idRef = (v) => (typeof v === 'string' && ID_RE.test(v) ? null : 'מזהה תקין');
const idList = (v) => (Array.isArray(v) && v.length <= 100 && v.every((x) => !idRef(x)) ? null : 'רשימת מזהים');
const strList = (v) => (Array.isArray(v) && v.length <= LIMITS.subtasks && v.every((x) => typeof x === 'string' && x.trim() && x.length <= LIMITS.title) ? null : `רשימת טקסטים (עד ${LIMITS.subtasks})`);

const CHECKS = {
  activities: { externalId: idRef, date, title: str(LIMITS.title), start: time, end: time, durationMinutes: int(1, 720), notes: optText(2000) },
  tasks: { externalId: idRef, title: str(LIMITS.title), scheduledDate: date, deadline: date, priority: oneOf(PRIORITIES), notes: optText(2000) },
};
const CHECKS_V1 = {
  days: { externalId: idRef, date, isWorking: bool, location: oneOf(LOCATIONS), phoneDuty: bool, phoneStart: time, phoneEnd: time, workStart: time, workEnd: time, inquiryTarget: int(0, 200), templateId: str(80) },
  blocks: { externalId: idRef, date, title: str(LIMITS.title), start: time, end: time, durationMinutes: int(1, 720), categoryId: str(60), role: oneOf(TEMPLATE_ROLES), notes: optText(2000), pinned: bool, taskRefs: idList },
  meetings: { externalId: idRef, title: str(LIMITS.title), meetingType: oneOf(MEETING_TYPES), date, start: time, end: time, durationMinutes: int(1, 720), agendaRefs: idList, notes: optText(2000) },
  tasks: { externalId: idRef, title: str(LIMITS.title), scheduledDate: date, deadline: date, priority: oneOf(PRIORITIES), categoryId: str(60), estimateMinutes: int(1, 1440), subtasks: strList, notes: optText(2000), preferredRole: oneOf(TEMPLATE_ROLES) },
  questions: { externalId: idRef, title: str(LIMITS.title), audience: oneOf(QUESTION_AUDIENCES), direction: oneOf(QUESTION_DIRECTIONS), priority: oneOf(PRIORITIES), followUpOn: date, notes: optText(2000), meetingRef: idRef },
};

export class PlanError extends Error {
  constructor(code, message, errors = []) { super(message); this.code = code; this.errors = errors; }
}

/** ChatGPT often wraps JSON in a Markdown code fence; strip one surrounding fence only. */
export function stripCodeFence(text) {
  if (typeof text !== 'string') return text;
  const m = /^\s*```(?:json|JSON)?[ \t]*\r?\n([\s\S]*?)\r?\n```\s*$/.exec(text);
  return m ? m[1] : text;
}

/** Parse text and run structural + semantic validation. Throws PlanError with all errors. */
export function parsePlan(text) {
  let obj;
  try {
    obj = parseJsonSafe(stripCodeFence(text), { maxBytes: LIMITS.planBytes, maxDepth: 12 });
  } catch (e) {
    throw new PlanError(e.code || 'parse', e.message);
  }
  return validatePlan(obj);
}

function structural(obj, fields, checks, collections, add) {
  const env = fields.envelope;
  for (const k of Object.keys(obj)) if (!env.required.includes(k) && !env.optional.includes(k)) add(k, 'שדה לא מוכר ברמת התוכנית');
  if (!PLAN_KINDS.includes(obj.kind)) add('kind', 'kind חייב להיות weekly או dailyPatch');
  if (typeof obj.planId !== 'string' || !ID_RE.test(obj.planId)) add('planId', 'planId חסר או לא תקין');
  if (obj.weekStart != null && (!isValidDate(obj.weekStart) || weekday(obj.weekStart) !== 0)) add('weekStart', 'weekStart חייב להיות תאריך של יום ראשון');
  if (obj.kind === 'weekly' && obj.weekStart == null) add('weekStart', 'בתוכנית שבועית חובה weekStart');
  let total = 0;
  for (const c of collections) {
    const arr = obj[c];
    if (arr == null) continue;
    if (!Array.isArray(arr)) { add(c, 'נדרש מערך'); continue; }
    total += arr.length;
  }
  if (total > LIMITS.planItems) throw new PlanError('too-many', `יותר מדי פריטים בתוכנית (${total}). המגבלה היא ${LIMITS.planItems}.`);
  if (total === 0) add('', 'התוכנית אינה כוללת פעילויות או משימות');
  for (const c of collections) {
    const arr = Array.isArray(obj[c]) ? obj[c] : [];
    const spec = fields[c];
    const seen = new Set();
    arr.forEach((item, i) => {
      const p = `${c}[${i}]`;
      if (!isPlainObject(item)) { add(p, 'נדרש אובייקט'); return; }
      for (const k of Object.keys(item)) if (!spec.required.includes(k) && !spec.optional.includes(k)) add(`${p}.${k}`, 'שדה לא מוכר');
      for (const k of spec.required) if (item[k] == null) add(`${p}.${k}`, 'שדה חובה חסר');
      for (const [k, check] of Object.entries(checks[c])) {
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
}

function checkInterval(p, it, add) {
  if (it.start && it.end && toMin(it.end) <= toMin(it.start)) add(`${p}.end`, 'שעת הסיום חייבת להיות אחרי שעת ההתחלה');
  if (it.start && it.end && Number.isInteger(it.durationMinutes) && toMin(it.end) - toMin(it.start) !== it.durationMinutes) add(`${p}.durationMinutes`, 'המשך אינו תואם לשעות ההתחלה והסיום');
  if (!it.start && it.end) add(`${p}.start`, 'שעת סיום ללא שעת התחלה');
  if (it.start && Number.isInteger(it.durationMinutes) && toMin(it.start) + it.durationMinutes > 24 * 60 - 1) add(`${p}.durationMinutes`, 'המשך חוצה את חצות');
}

export function validatePlan(obj) {
  const errors = [];
  const add = (path, message) => { if (errors.length < 100) errors.push({ path, message }); };
  if (!isPlainObject(obj)) throw new PlanError('shape', 'התוכן אינו אובייקט JSON של תוכנית', [{ path: '', message: 'נדרש אובייקט' }]);
  if (obj.format === 'luma-work-backup') throw new PlanError('backup-file', 'זהו קובץ גיבוי ולא תוכנית. לשחזור גיבוי: הגדרות ← גיבוי ושחזור.');
  if (obj.format !== PLAN_FORMAT) throw new PlanError('format', `השדה format חייב להיות "${PLAN_FORMAT}"`, [{ path: 'format', message: 'פורמט לא מוכר' }]);
  const legacy = PLAN_LEGACY_VERSIONS.includes(obj.schemaVersion);
  if (obj.schemaVersion !== PLAN_SCHEMA_VERSION && !legacy) throw new PlanError('version', `גרסת סכמה לא נתמכת (${String(obj.schemaVersion)}). הגרסה הנתמכת היא ${PLAN_SCHEMA_VERSION}.`, [{ path: 'schemaVersion', message: 'גרסה לא נתמכת' }]);
  if (legacy) structural(obj, PLAN_FIELDS_V1, CHECKS_V1, V1_COLLECTIONS, add);
  else structural(obj, PLAN_FIELDS, CHECKS, PLAN_COLLECTIONS, add);
  if (errors.length) throw new PlanError('invalid', 'התוכנית אינה עומדת בסכמה', errors);
  for (const c of legacy ? ['blocks', 'meetings'] : ['activities']) (obj[c] || []).forEach((it, i) => checkInterval(`${c}[${i}]`, it, add));
  if (legacy) (obj.meetings || []).forEach((m, i) => { if (!m.date && (m.start || m.end)) add(`meetings[${i}].date`, 'שעה ללא תאריך'); });
  if (errors.length) throw new PlanError('invalid', 'נמצאו שגיאות תוכן בתוכנית', errors);
  return legacy ? normalizeV1(obj) : normalizePlan(obj);
}

function clean(item) {
  const out = {};
  for (const [k, v] of Object.entries(item)) {
    if (v == null) continue;
    out[k] = typeof v === 'string' ? v.trim() : Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x.trim() : x)) : v;
  }
  return out;
}

function finishPlan(obj, items, legacyVersion = null) {
  const plan = { format: PLAN_FORMAT, schemaVersion: PLAN_SCHEMA_VERSION, sourceVersion: legacyVersion || PLAN_SCHEMA_VERSION, kind: obj.kind, planId: obj.planId, weekStart: obj.weekStart || null, items, range: planRange(obj.weekStart, items) };
  plan.fingerprint = fingerprint({ kind: plan.kind, planId: plan.planId, weekStart: plan.weekStart, items: items.map((i) => [i.key, i.fp]) });
  return plan;
}

/** Normalized v2 plan: nulls removed (null = unknown), strings trimmed, items keyed. */
export function normalizePlan(obj) {
  const items = [];
  for (const c of PLAN_COLLECTIONS) {
    for (const raw of obj[c] || []) {
      const { externalId, ...content } = clean(raw);
      items.push({ collection: c, origin: c, externalId, key: `${c}:${externalId}`, data: content, fp: fingerprint(content), dropped: [] });
    }
  }
  return finishPlan(obj, items);
}

/**
 * v1 → normalized v2 items. Blocks and timed meetings become activities; tasks keep their
 * supported fields (subtasks are appended to the note so nothing is lost); day settings,
 * team questions and undated meetings are listed as not imported. Fingerprints are taken
 * from the original v1 content so replays of already-imported v1 plans are recognized.
 */
function normalizeV1(obj) {
  const items = [];
  for (const raw of obj.blocks || []) {
    const d = clean(raw);
    const { externalId, ...content } = d;
    items.push({ collection: 'activities', origin: 'blocks', externalId, key: `blocks:${externalId}`, fp: fingerprint(content),
      data: pick(d, ['date', 'title', 'start', 'end', 'durationMinutes', 'notes']), dropped: droppedOf(d, ['categoryId', 'role', 'pinned', 'taskRefs']) });
  }
  for (const raw of obj.meetings || []) {
    const d = clean(raw);
    const { externalId, ...content } = d;
    const base = { origin: 'meetings', externalId, key: `meetings:${externalId}`, fp: fingerprint(content) };
    if (d.date && d.start) items.push({ ...base, collection: 'activities', data: pick(d, ['date', 'title', 'start', 'end', 'durationMinutes', 'notes']), dropped: droppedOf(d, ['meetingType', 'agendaRefs']) });
    else items.push({ ...base, collection: 'unsupported', data: { title: d.title }, reason: 'פגישה ללא מועד - אפשר להוסיף אותה כפעילות כשהמועד ידוע', dropped: [] });
  }
  for (const raw of obj.tasks || []) {
    const d = clean(raw);
    const { externalId, ...content } = d;
    const data = pick(d, ['title', 'scheduledDate', 'deadline', 'priority', 'notes']);
    if (d.subtasks?.length) data.notes = [data.notes, ...d.subtasks.map((s) => `• ${s}`)].filter(Boolean).join('\n').slice(0, 2000);
    items.push({ collection: 'tasks', origin: 'tasks', externalId, key: `tasks:${externalId}`, fp: fingerprint(content), data, dropped: droppedOf(d, ['categoryId', 'estimateMinutes', 'preferredRole']) });
  }
  for (const raw of obj.days || []) {
    const d = clean(raw);
    items.push({ collection: 'unsupported', origin: 'days', externalId: d.externalId, key: `days:${d.externalId}`, fp: '', data: { title: d.date }, reason: 'הגדרות יום (שעות, מיקום, תורנות) אינן נתמכות עוד', dropped: [] });
  }
  for (const raw of obj.questions || []) {
    const d = clean(raw);
    items.push({ collection: 'unsupported', origin: 'questions', externalId: d.externalId, key: `questions:${d.externalId}`, fp: '', data: { title: d.title }, reason: 'שאלות לצוות ולמנהל אינן נתמכות עוד', dropped: [] });
  }
  return finishPlan(obj, items, 1);
}
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
const droppedOf = (o, keys) => keys.filter((k) => o[k] !== undefined && !(Array.isArray(o[k]) && !o[k].length));

function planRange(weekStartDate, items) {
  if (weekStartDate) return { from: weekStartDate, to: addDays(weekStartDate, 6) };
  const dates = items.map((i) => (i.collection === 'activities' ? i.data.date : i.collection === 'tasks' ? i.data.scheduledDate : null)).filter(Boolean).sort();
  return dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null;
}

// ---------------- detection & preview ----------------

const ENTITY = { activities: 'calendarBlocks', blocks: 'calendarBlocks', meetings: 'meetings', tasks: 'tasks', questions: 'questions' };

function importIndex(state) {
  const applied = new Map(); // planId|origin|externalId -> {entityId, fingerprint, collection}
  const excluded = new Map();
  for (const h of state.importHistory) {
    if (h.undoneAt && !h.partialUndo) continue;
    for (const it of h.items) {
      if (it.reverted) continue;
      applied.set(`${h.planId}|${it.origin || it.collection}|${it.externalId}`, { entityId: it.entityId, fingerprint: it.fingerprint, collection: it.collection });
    }
    for (const it of h.excluded || []) excluded.set(`${h.planId}|${it.origin || it.collection}|${it.externalId}`, it);
  }
  return { applied, excluded };
}

function findEntity(state, collection, id) {
  if (collection === 'days') return state.dayOverrides[id] || null;
  return state[ENTITY[collection]]?.find((x) => x.id === id) || null;
}

/** The calendar block an applied history item now corresponds to (legacy meetings were migrated to activities). */
function appliedBlock(state, prev) {
  if (prev.collection === 'meetings') {
    const m = state.meetings.find((x) => x.id === prev.entityId);
    return m?.migratedToBlockId ? state.calendarBlocks.find((b) => b.id === m.migratedToBlockId) || null : null;
  }
  return state.calendarBlocks.find((b) => b.id === prev.entityId) || null;
}

const wasManuallyEdited = (entity) => !!(entity && entity.editedAt && (!entity.importRef?.at || entity.editedAt > entity.importRef.at));

function endOf(it) {
  if (it.end) return it.end;
  if (it.start && Number.isInteger(it.durationMinutes)) return fromMin(toMin(it.start) + it.durationMinutes);
  return null;
}

function summaryOf(item) {
  const d = item.data;
  if (item.collection === 'activities') return { title: d.title, sub: `${fmtDayDate(d.date)}${d.start ? ` · ${d.start}-${endOf(d) || '?'}` : ''}` };
  if (item.collection === 'tasks') return { title: d.title, sub: [d.scheduledDate && fmtDayDate(d.scheduledDate), d.deadline && `יעד ${fmtDayDate(d.deadline)}`].filter(Boolean).join(' · ') };
  return { title: d.title || item.externalId, sub: '' };
}

/**
 * Build a read-only preview of a validated, normalized plan against the current state.
 * @returns {Object} preview (pure data)
 */
export function buildPreview(state, plan, { allowOutsideWeek = false } = {}) {
  const idx = importIndex(state);
  const items = [];
  const inWeek = (x) => !plan.weekStart || (x >= plan.weekStart && x <= addDays(plan.weekStart, 6));
  for (const it of plan.items) {
    const d = it.data;
    const sum = summaryOf(it);
    if (it.collection === 'unsupported') {
      items.push({ ...pick(it, ['key', 'collection', 'origin', 'externalId', 'fp', 'data']), action: 'unsupported', entityId: null, before: null, title: sum.title, sub: it.reason, issues: [], dropped: [], defaultSelected: false });
      continue;
    }
    const issues = [];
    const prev = idx.applied.get(`${plan.planId}|${it.origin}|${it.externalId}`);
    let action = 'add', entityId = null, before = null;
    if (prev) {
      const existing = it.collection === 'activities' ? appliedBlock(state, prev) : findEntity(state, it.collection, prev.entityId);
      if (!existing) issues.push({ type: 'previouslyRemoved', blocking: false, message: 'יובא בעבר והוסר מאז. אפשר להוסיף שוב.' });
      else if (prev.fingerprint === it.fp) { action = 'unchanged'; entityId = existing.id; }
      else {
        action = 'update'; entityId = existing.id; before = summarizeBefore(existing);
        if (existing.recurrence) issues.push({ type: 'protected', blocking: true, message: 'פעילות חוזרת אינה משתנה בייבוא.' });
        else if (wasManuallyEdited(existing)) issues.push({ type: 'manualEdited', blocking: true, message: 'נערך ידנית אחרי הייבוא. העדכון ידרוס את השינוי רק באישור.' });
      }
    } else if (idx.excluded.has(`${plan.planId}|${it.origin}|${it.externalId}`)) {
      issues.push({ type: 'previouslyExcluded', blocking: false, message: 'לא נבחר בייבוא קודם של אותה תוכנית.' });
    }
    const when = it.collection === 'activities' ? d.date : d.scheduledDate;
    if (plan.kind === 'weekly' && when && !inWeek(when)) {
      issues.push({ type: 'outsideWeek', blocking: !allowOutsideWeek, message: allowOutsideWeek ? 'מחוץ לשבוע (הורחב)' : 'התאריך מחוץ לשבוע של התוכנית' });
    }
    if (it.collection === 'activities') {
      if (!d.start) issues.push({ type: 'needsTime', blocking: true, field: 'start', message: 'חסרה שעת התחלה' });
      else if (!endOf(d)) issues.push({ type: 'needsTime', blocking: true, field: 'end', message: 'חסרה שעת סיום' });
    }
    if (action === 'add') {
      const dup = findDuplicate(state, it);
      if (dup) issues.push({ type: 'possibleDuplicate', blocking: false, message: `ייתכן שכבר קיים: ״${dup}״`, duplicateOf: dup });
    }
    const defaultSelected = action !== 'unchanged' && !issues.some((x) => ['possibleDuplicate', 'previouslyExcluded', 'previouslyRemoved', 'manualEdited', 'protected'].includes(x.type));
    items.push({
      key: it.key, collection: it.collection, origin: it.origin, externalId: it.externalId, fp: it.fp, data: d, action, entityId, before,
      title: sum.title, sub: sum.sub, issues, dropped: it.dropped.map((k) => DROPPED_LABEL[k] || k), defaultSelected,
    });
  }
  // Overlaps are informational only: imported and existing activities keep their own times.
  const timed = items.filter((x) => x.collection === 'activities' && x.data.start && endOf(x.data));
  for (const x of timed) {
    const s = toMin(x.data.start), e = toMin(endOf(x.data));
    const parallel = dayOccurrences(state, x.data.date).filter((o) => o.status !== 'canceled' && o.s < e && s < o.e && !(x.entityId && o.sourceId === x.entityId));
    if (parallel.length) x.issues.push({ type: 'overlap', blocking: false, message: `במקביל ל-${parallel.map((o) => `״${o.title}״`).join(', ')}` });
  }
  const live = items.filter((i) => i.action !== 'unsupported');
  const counts = {
    total: items.length,
    add: live.filter((i) => i.action === 'add').length,
    update: live.filter((i) => i.action === 'update').length,
    unchanged: live.filter((i) => i.action === 'unchanged').length,
    unsupported: items.length - live.length,
    duplicates: live.filter((i) => i.issues.some((x) => x.type === 'possibleDuplicate')).length,
  };
  return {
    planId: plan.planId, kind: plan.kind, weekStart: plan.weekStart, range: plan.range, fingerprint: plan.fingerprint, sourceVersion: plan.sourceVersion,
    stateRevision: state.metadata.revision, allowOutsideWeek, items, counts,
    exactReplay: live.length > 0 && live.every((i) => i.action === 'unchanged'),
    plan,
  };
}

function summarizeBefore(e) {
  const keys = ['title', 'date', 'start', 'end', 'scheduledDate', 'deadline', 'priority'];
  return Object.fromEntries(keys.filter((k) => e[k] !== undefined && e[k] !== null).map((k) => [k, e[k]]));
}

function findDuplicate(state, it) {
  const d = it.data;
  const n = normalize(d.title || '');
  if (it.collection === 'tasks') {
    const t = state.tasks.find((x) => x.status !== 'canceled' && x.status !== 'done' && normalize(x.title) === n);
    return t ? t.title : null;
  }
  const o = dayOccurrences(state, d.date).find((x) => x.status !== 'canceled' && normalize(x.title) === n && (!d.start || x.start === d.start));
  return o ? o.title : null;
}

/**
 * Apply the user's selection and resolutions to a preview.
 * @param {Object} preview
 * @param {Record<string, boolean>} selection  key -> include
 * @param {Record<string, Object>} resolutions key -> {start,end,durationMinutes,overwriteManual}
 * @returns {{ok:boolean, errors:Array<{key:string,message:string}>, items:Array}}
 */
export function resolveSelection(preview, selection, resolutions = {}) {
  const errors = [];
  const chosen = preview.items.filter((i) => i.action !== 'unchanged' && i.action !== 'unsupported' && (selection[i.key] ?? i.defaultSelected));
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
      } else if (iss.type === 'manualEdited') {
        if (!r.overwriteManual) errors.push({ key: i.key, message: `${i.title}: נדרש אישור לדריסת השינוי הידני` });
      } else if (iss.type === 'protected') {
        errors.push({ key: i.key, message: `${i.title}: ${iss.message}` });
      } else if (iss.type === 'outsideWeek' && iss.blocking) {
        errors.push({ key: i.key, message: `${i.title}: ${iss.message}` });
      }
    }
    out.push({ ...i, data, overwriteManual: !!r.overwriteManual });
  }
  if (!out.length) errors.push({ key: '', message: 'לא נבחרו פריטים לייבוא' });
  return { ok: errors.length === 0, errors, items: out };
}

/**
 * Apply a resolved selection to a store draft. Re-validates the preview against the draft
 * so a stale preview can never be committed. Only adds records or updates records this
 * plan created earlier; never touches recurring activities.
 */
export function applyPlanImport(draft, { plan, selection, resolutions, allowOutsideWeek, expectedRevision }, ctx) {
  const baseRevision = ctx.baseRevision ?? draft.metadata.revision;
  if (baseRevision !== expectedRevision) {
    throw Object.assign(new Error('stale'), { code: 'stale-preview', messageHe: 'הנתונים השתנו מאז התצוגה המקדימה. יש לבדוק שוב.' });
  }
  const preview = buildPreview(draft, plan, { allowOutsideWeek });
  const res = resolveSelection(preview, selection, resolutions);
  if (!res.ok) throw Object.assign(new Error('unresolved'), { code: 'unresolved', messageHe: res.errors.map((e) => e.message).join('\n') });
  const now = ctx.nowIso;
  const ref = (it) => ({ planId: plan.planId, externalId: it.externalId, fingerprint: it.fp, at: now });
  const history = { id: ctx.uid(), planId: plan.planId, planFingerprint: plan.fingerprint, kind: plan.kind, range: plan.range, appliedAt: now, items: [], excluded: [], undoneAt: null, revisionAfter: null };
  for (const it of res.items) {
    const d = it.data;
    let entityId = it.entityId, before = null;
    if (it.collection === 'tasks') {
      const fields = { title: d.title, scheduledDate: d.scheduledDate || null, deadline: d.deadline || null, priority: d.priority || 'medium', details: d.notes || '' };
      if (it.action === 'add') {
        entityId = ctx.uid();
        draft.tasks.push({
          id: entityId, ...fields, categoryId: null, status: 'todo', originalScheduledDate: fields.scheduledDate, estimateMinutes: null, actualMinutes: null,
          subtasks: [], recurringRuleId: null, occurrenceDate: null, assignedBlock: null, assignmentManual: false, pinned: false, preferredRole: null,
          meetingId: null, questionId: null, waiting: null, resumeOn: null, source: { kind: 'import', planId: plan.planId }, scheduleHistory: [],
          createdAt: now, updatedAt: now, completedAt: null, completedOn: null, canceledOn: null, importRef: ref(it),
        });
      } else {
        const t = draft.tasks.find((x) => x.id === entityId);
        before = pickKeys(t, Object.keys(fields));
        if (fields.scheduledDate !== t.scheduledDate) t.scheduleHistory.push({ from: t.scheduledDate, to: fields.scheduledDate, at: now, by: 'import' });
        Object.assign(t, fields, { updatedAt: now, importRef: ref(it) });
        if (!t.originalScheduledDate) t.originalScheduledDate = fields.scheduledDate;
      }
    } else {
      const fields = { title: d.title, date: d.date, start: d.start, end: endOf(d), notes: d.notes || '' };
      if (it.action === 'add') {
        entityId = ctx.uid();
        draft.calendarBlocks.push({
          id: entityId, ...fields, categoryId: ACTIVITY_CATEGORY, role: null, pinned: false, recurrence: null, source: 'import', movedFrom: null,
          protected: false, flexible: true, minMinutes: 0, instructions: [], createdAt: now, updatedAt: now, importRef: ref(it),
        });
      } else {
        const b = draft.calendarBlocks.find((x) => x.id === entityId);
        if (!b || b.recurrence) throw Object.assign(new Error('protected'), { code: 'protected', messageHe: 'פעילות חוזרת אינה משתנה בייבוא.' });
        before = pickKeys(b, Object.keys(fields));
        Object.assign(b, fields, { updatedAt: now, importRef: ref(it) });
      }
    }
    history.items.push({ collection: it.collection === 'tasks' ? 'tasks' : 'activities', origin: it.origin, externalId: it.externalId, fingerprint: it.fp, entityId, action: it.action === 'add' ? 'added' : 'updated', before });
  }
  const chosenKeys = new Set(res.items.map((i) => i.key));
  history.excluded = preview.items.filter((i) => i.action !== 'unchanged' && i.action !== 'unsupported' && !chosenKeys.has(i.key))
    .map((i) => ({ collection: i.collection, origin: i.origin, externalId: i.externalId, fingerprint: i.fp }));
  history.revisionAfter = expectedRevision + 1;
  draft.importHistory.unshift(history);
  if (draft.importHistory.length > LIMITS.importHistory) draft.importHistory.length = LIMITS.importHistory;
  return { historyId: history.id, added: history.items.filter((x) => x.action === 'added').length, updated: history.items.filter((x) => x.action === 'updated').length, excluded: history.excluded.length };
}

function pickKeys(o, keys) {
  const out = {};
  for (const k of keys) if (o && o[k] !== undefined) out[k] = structuredClone(o[k]);
  return out;
}

// ---------------- undo ----------------

const UNDO_LABEL = { activities: 'פעילות', blocks: 'פעילות', meetings: 'פגישה', tasks: 'משימה', questions: 'שאלה', days: 'הגדרת יום' };

/**
 * Inverse of an applied import. If nothing changed since, the inverse is exact. Otherwise
 * only unaffected changes are reverted; affected ones are kept and listed. Also handles the
 * history of v1 imports (questions, meetings, day settings).
 */
export function previewUndoImport(state, historyId, baseRevision = state.metadata.revision) {
  const h = state.importHistory.find((x) => x.id === historyId);
  if (!h || h.undoneAt) return { ok: false, message: 'אין ייבוא לביטול' };
  const clean = baseRevision === h.revisionAfter;
  const revert = [], keep = [];
  const editedSince = (e) => e && String(e.updatedAt || '') > h.appliedAt;
  for (const it of h.items) {
    if (it.reverted) continue;
    const c = it.collection;
    if (c === 'days') {
      const cur = state.dayOverrides[it.entityId];
      const label = `${UNDO_LABEL.days}: ${it.entityId}`;
      if (!cur) { keep.push({ ...it, label, reason: 'כבר הוסרה' }); continue; }
      if (cur.editedAt || cur.importRef?.at !== h.appliedAt) { keep.push({ ...it, label, reason: 'נערכה מאז' }); continue; }
      revert.push({ ...it, label });
      continue;
    }
    const e = findEntity(state, c, it.entityId);
    const label = `${UNDO_LABEL[c] || c}: ${e?.title || it.externalId}`;
    if (!e) { keep.push({ ...it, label, reason: 'כבר הוסר' }); continue; }
    if (!clean && editedSince(e)) { keep.push({ ...it, label, reason: 'נערך מאז הייבוא' }); continue; }
    const reason = undoBlocked(state, it, e);
    if (reason) { keep.push({ ...it, label, reason }); continue; }
    revert.push({ ...it, label });
  }
  return { ok: true, clean: clean && keep.length === 0, historyId, planId: h.planId, appliedAt: h.appliedAt, revert, keep };
}

/** Removing an added record must not orphan references held by records that stay. */
function undoBlocked(state, it, e) {
  if (it.action !== 'added') return null;
  const id = e.id;
  if (it.collection === 'tasks') {
    if (Object.values(state.dailyPriorities).some((ids) => ids.includes(id))) return 'נבחרה כמשימה חשובה';
    if (state.meetingDecisions.some((x) => x.taskId === id) || state.issueLogs.some((x) => x.taskId === id) || state.workNotes.some((x) => x.taskId === id)) return 'מקושרת לרשומה אחרת';
    if (e.status !== 'todo') return 'הסטטוס שלה השתנה';
  }
  if (it.collection === 'activities' || it.collection === 'blocks') {
    if (e.recurrence) return 'פעילות חוזרת';
    if (state.blockCompletions[id]) return 'סומנה כבוצעה';
    if (state.tasks.some((t) => t.assignedBlock === id)) return 'משויכות אליה משימות';
  }
  if (it.collection === 'meetings') {
    if (e.migratedToBlockId) return 'הפכה לפעילות ביומן';
    if (state.meetingDecisions.some((x) => x.meetingId === id)) return 'נרשמו בה החלטות';
  }
  if (it.collection === 'questions') {
    if (state.meetings.some((m) => (m.agenda || []).includes(id)) || state.meetingDecisions.some((x) => x.questionId === id) || state.faqEntries.some((f) => f.questionIds.includes(id))) return 'מקושרת לרשומה אחרת';
    if (e.status !== 'open') return 'הסטטוס שלה השתנה';
  }
  return null;
}

export function applyUndoImport(draft, { historyId, expectedRevision }, ctx) {
  const baseRevision = ctx.baseRevision ?? draft.metadata.revision;
  if (baseRevision !== expectedRevision) throw Object.assign(new Error('stale'), { code: 'stale-preview', messageHe: 'הנתונים השתנו. יש לפתוח שוב את הביטול.' });
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
      if (coll === 'calendarBlocks') delete draft.blockCompletions[it.entityId];
      if (c === 'meetings') for (const t of draft.tasks) if (t.meetingId === it.entityId) t.meetingId = null;
    } else {
      const e = findEntity(draft, c, it.entityId);
      if (e && it.before) Object.assign(e, structuredClone(it.before), { updatedAt: ctx.nowIso });
    }
    const hi = h.items.find((x) => x.collection === it.collection && x.externalId === it.externalId && (x.origin || x.collection) === (it.origin || it.collection));
    if (hi) hi.reverted = true;
  }
  h.undoneAt = ctx.nowIso;
  h.partialUndo = p.keep.length > 0;
  return { reverted: p.revert.length, kept: p.keep.length };
}
