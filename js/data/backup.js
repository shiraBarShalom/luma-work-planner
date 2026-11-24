// Full backup format `luma-work-backup`: an independent versioned envelope around the
// complete validated state. Separate from the `luma-work-plan` planning import.
import { BACKUP_FORMAT, BACKUP_VERSION, APP_ID, APP_VERSION, LIMITS, PLAN_FORMAT, STATE_FORMAT } from '../config.js';
import { COLLECTIONS } from './schema.js';
import { parseJsonSafe, SafeJsonError } from './safeJson.js';
import { migrateState, DataError } from './migrations.js';

export function collectionCounts(state) {
  const out = {};
  for (const c of COLLECTIONS) {
    const v = state[c];
    if (Array.isArray(v)) out[c] = v.length;
    else if (v && typeof v === 'object' && c !== 'settings' && c !== 'targetHistory') out[c] = Object.keys(v).length;
  }
  return out;
}

export function createBackup(state, nowIso) {
  return {
    format: BACKUP_FORMAT,
    backupVersion: BACKUP_VERSION,
    exportedAt: nowIso,
    app: { id: APP_ID, version: APP_VERSION },
    schemaVersion: state.metadata.schemaVersion,
    revision: state.metadata.revision,
    counts: collectionCounts(state),
    data: state,
  };
}

export const backupFileName = (date) => `luma-work-backup-${date}.json`;

/**
 * Parse and validate a backup file without touching any state.
 * @returns {{ok:true, state:Object, info:Object} | {ok:false, code:string, message:string, details?:string[]}}
 */
export function parseBackup(text) {
  let obj;
  try {
    obj = parseJsonSafe(text, { maxBytes: LIMITS.backupBytes, maxDepth: 64 });
  } catch (e) {
    return { ok: false, code: e instanceof SafeJsonError ? e.code : 'parse', message: e.message };
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false, code: 'foreign', message: 'הקובץ אינו גיבוי של Luma' };
  if (obj.format === PLAN_FORMAT) return { ok: false, code: 'plan-file', message: 'זהו קובץ תוכנית עבודה ולא גיבוי. לייבוא תוכנית יש להשתמש במסך ״ייבוא תוכנית״.' };
  if (obj.format !== BACKUP_FORMAT) return { ok: false, code: 'foreign', message: 'הקובץ אינו גיבוי של Luma (פורמט לא מוכר)' };
  if (!Number.isInteger(obj.backupVersion) || obj.backupVersion < 1) return { ok: false, code: 'bad-version', message: 'גרסת גיבוי לא תקינה' };
  if (obj.backupVersion > BACKUP_VERSION) return { ok: false, code: 'newer', message: 'הגיבוי נוצר בגרסה חדשה יותר של Luma. יש לעדכן את האפליקציה.' };
  if (!obj.data || obj.data.metadata?.format !== STATE_FORMAT) return { ok: false, code: 'foreign', message: 'תוכן הגיבוי אינו נתוני Luma' };
  try {
    const { state, migrated, from } = migrateState(obj.data);
    return {
      ok: true, state,
      info: { exportedAt: obj.exportedAt || null, schemaVersion: from, migrated, revision: obj.data.metadata.revision, counts: collectionCounts(state) },
    };
  } catch (e) {
    if (e instanceof DataError) return { ok: false, code: e.code, message: e.message, details: e.details || undefined };
    return { ok: false, code: 'invalid', message: 'הגיבוי אינו תקין' };
  }
}
