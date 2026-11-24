// Sequential, deterministic state migrations. Source is validated by format, migrated one
// version at a time on a copy, and the output is validated before anyone may persist it.
// Unknown newer versions fail safely; nothing is overwritten.
import { STATE_FORMAT, SCHEMA_VERSION } from '../config.js';
import { validateState } from './validation.js';

export class DataError extends Error {
  constructor(code, message, details = null) { super(message); this.code = code; this.details = details; }
}

/**
 * Registry: MIGRATIONS[n] upgrades a document from schemaVersion n to n + 1.
 * Schema v1 is the first released version, so the registry is currently empty.
 * Add entries here (never edit released ones) when the schema changes.
 * @type {Record<number, (doc: any) => any>}
 */
export const MIGRATIONS = {};

export function migrateState(doc, { migrations = MIGRATIONS, target = SCHEMA_VERSION } = {}) {
  if (!doc || typeof doc !== 'object' || !doc.metadata || doc.metadata.format !== STATE_FORMAT) {
    throw new DataError('foreign', 'המידע אינו בפורמט של Luma');
  }
  const from = doc.metadata.schemaVersion;
  if (!Number.isInteger(from) || from < 1) throw new DataError('bad-version', 'גרסת נתונים לא תקינה');
  if (from > target) throw new DataError('newer', `הנתונים נוצרו בגרסה חדשה יותר (${from}) של Luma. יש לעדכן את האפליקציה לפני השימוש בהם.`);
  let cur = structuredClone(doc);
  for (let v = from; v < target; v++) {
    const step = migrations[v];
    if (typeof step !== 'function') throw new DataError('no-migration', `אין מסלול שדרוג מגרסה ${v}`);
    cur = step(structuredClone(cur));
    cur.metadata.schemaVersion = v + 1;
  }
  const res = validateState(cur);
  if (!res.ok) throw new DataError('invalid', 'הנתונים אינם תקינים', res.errors);
  return { state: cur, migrated: from !== target, from, to: target };
}
