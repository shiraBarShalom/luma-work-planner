// Sequential, deterministic state migrations. Source is validated by format, migrated one
// version at a time on a copy, and the output is validated before anyone may persist it.
// Unknown newer versions fail safely; nothing is overwritten. Migrations never delete
// user records: retired features keep their data in the document (and in backups).
import { STATE_FORMAT, SCHEMA_VERSION } from '../config.js';
import { validateState } from './validation.js';
import { addDays, today as zonedToday, toMin, fromMin } from '../dates.js';
import { clock } from '../clock.js';
import { weeklyScheduleBlocks, defaultCategories, defaultNotificationSettings, ACTIVITY_CATEGORY } from '../seed.js';

export class DataError extends Error {
  constructor(code, message, details = null) { super(message); this.code = code; this.details = details; }
}

/**
 * v1 → v2: the simplified product.
 *  - Inquiry counter: one number per date (`inquiryCounts`), derived once from the legacy
 *    completed-count events. The events stay in `inquiryLogs` untouched.
 *  - Scheduled meetings become ordinary one-off activities (meeting records are kept and
 *    point to the new activity via `migratedToBlockId`).
 *  - The fixed weekly schedule (Sunday-Thursday) is added as protected recurring
 *    activities starting on the migration date; legacy routine templates stop generating
 *    from that date, so past days keep their history and nothing is duplicated.
 *  - Notification settings are added. Questions, FAQ, notes, issues, day reports and all
 *    other legacy records are preserved as-is (no visible screen).
 * @param {Object} doc  a v1 document (copy)
 * @param {{today:string, nowIso:string}} env
 */
function v1to2(doc, { today, nowIso }) {
  doc.inquiryCounts = doc.inquiryCounts && typeof doc.inquiryCounts === 'object' ? doc.inquiryCounts : {};
  const sums = {};
  for (const ev of doc.inquiryLogs || []) {
    if (ev.kind !== 'completed') continue;
    sums[ev.workDate] = (sums[ev.workDate] || 0) + (Number(ev.quantity) || 0);
  }
  for (const [date, n] of Object.entries(sums)) if (n > 0 && doc.inquiryCounts[date] == null) doc.inquiryCounts[date] = n;

  const st = doc.settings;
  const known = new Set(st.categories.map((c) => c.id));
  for (const c of defaultCategories()) if (c.id === ACTIVITY_CATEGORY || c.id === 'meeting') if (!known.has(c.id)) { st.categories.push(c); known.add(c.id); }
  st.notifications = { ...defaultNotificationSettings(), ...(st.notifications || {}) };

  // Meetings → ordinary activities.
  const blockIds = new Set(doc.calendarBlocks.map((b) => b.id));
  for (const m of doc.meetings || []) {
    if (m.status === 'canceled' || m.migratedToBlockId || !m.date || !m.start) continue;
    let end = m.end;
    if (!end && Number.isInteger(m.durationMinutes) && m.durationMinutes > 0) end = fromMin(toMin(m.start) + m.durationMinutes);
    if (!end || toMin(end) <= toMin(m.start)) continue;
    const id = `meeting-${m.id}`;
    if (!blockIds.has(id)) {
      doc.calendarBlocks.push({
        id, date: m.date, start: m.start, end, title: m.title, categoryId: 'meeting', role: null, notes: m.notes || '', pinned: false,
        recurrence: null, source: 'migrated', migratedFrom: { kind: 'meeting', id: m.id }, movedFrom: null, protected: false,
        flexible: true, minMinutes: 0, instructions: [], createdAt: nowIso, updatedAt: nowIso,
      });
      blockIds.add(id);
      if (m.status === 'held' && !doc.blockCompletions[id]) doc.blockCompletions[id] = { status: 'done', actualMinutes: null, updatedAt: nowIso };
    }
    for (const t of doc.tasks) if (t.assignedBlock === `mtg:${m.id}`) t.assignedBlock = id;
    m.migratedToBlockId = id;
  }

  // Fixed weekly schedule. Start today unless today's legacy routine already has records.
  const todayHasRoutineRecords = [...Object.keys(doc.blockCompletions), ...Object.keys(doc.occurrenceOverrides)]
    .some((k) => k.startsWith('r:') && k.endsWith(`@${today}`));
  const start = todayHasRoutineRecords ? addDays(today, 1) : today;
  if (!st.routineEndsOn) st.routineEndsOn = start;
  for (const b of weeklyScheduleBlocks(start, nowIso)) if (!blockIds.has(b.id)) { doc.calendarBlocks.push(b); blockIds.add(b.id); }
  return doc;
}

/**
 * Registry: MIGRATIONS[n] upgrades a document from schemaVersion n to n + 1.
 * Never edit a released entry; add a new one when the schema changes.
 * @type {Record<number, (doc: any, env: {today:string, nowIso:string}) => any>}
 */
export const MIGRATIONS = { 1: v1to2 };

/**
 * @param {Object} doc
 * @param {{migrations?:Object, target?:number, today?:string, nowIso?:string}} [opts]
 *   `today`/`nowIso` make the migration deterministic for a given input and clock.
 */
export function migrateState(doc, { migrations = MIGRATIONS, target = SCHEMA_VERSION, today = null, nowIso = null } = {}) {
  if (!doc || typeof doc !== 'object' || !doc.metadata || doc.metadata.format !== STATE_FORMAT) {
    throw new DataError('foreign', 'המידע אינו בפורמט של Luma');
  }
  const from = doc.metadata.schemaVersion;
  if (!Number.isInteger(from) || from < 1) throw new DataError('bad-version', 'גרסת נתונים לא תקינה');
  if (from > target) throw new DataError('newer', `הנתונים נוצרו בגרסה חדשה יותר (${from}) של Luma. יש לעדכן את האפליקציה לפני השימוש בהם.`);
  const env = { today: today || zonedToday(), nowIso: nowIso || clock.iso() };
  let cur = structuredClone(doc);
  for (let v = from; v < target; v++) {
    const step = migrations[v];
    if (typeof step !== 'function') throw new DataError('no-migration', `אין מסלול שדרוג מגרסה ${v}`);
    cur = step(structuredClone(cur), env);
    cur.metadata.schemaVersion = v + 1;
  }
  const res = validateState(cur);
  if (!res.ok) throw new DataError('invalid', 'הנתונים אינם תקינים', res.errors);
  return { state: cur, migrated: from !== target, from, to: target };
}
