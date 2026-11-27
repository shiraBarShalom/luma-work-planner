// Application identifiers, storage namespaces, formats and limits.
// Every storage surface uses the dedicated `luma-work-planner` namespace so Luma never
// reads or writes data that belongs to another app served from the same origin.

export const APP_ID = 'luma-work-planner';
export const APP_VERSION = '2.0.2';

export const IDB_NAME = 'luma-work-planner';
export const IDB_VERSION = 1;
export const IDB_STORES = { state: 'state', recovery: 'recovery' };
export const STATE_KEY = 'current';
export const LS_PREFIX = 'luma-work-planner:';
export const LS_FALLBACK_KEY = LS_PREFIX + 'fallback-state';
export const LS_UI_KEY = LS_PREFIX + 'ui';
export const CACHE_PREFIX = 'luma-work-planner-shell-';
export const BROADCAST_CHANNEL = 'luma-work-planner';

export const STATE_FORMAT = 'luma-work-state';
export const SCHEMA_VERSION = 2;
export const BACKUP_FORMAT = 'luma-work-backup';
export const BACKUP_VERSION = 1;
export const PLAN_FORMAT = 'luma-work-plan';
export const PLAN_SCHEMA_VERSION = 2;
/** Older plan versions that are still accepted and normalized on import. */
export const PLAN_LEGACY_VERSIONS = [1];
export const PROMPT_VERSION = '2.0';

export const TIMEZONE = 'Asia/Jerusalem';

export const LIMITS = Object.freeze({
  planBytes: 1024 * 1024,
  planItems: 500,
  backupBytes: 30 * 1024 * 1024,
  jsonDepth: 40,
  title: 300,
  text: 5000,
  noteBody: 20000,
  subtasks: 50,
  tags: 30,
  recoverySnapshots: 5,
  importHistory: 50,
  undoDepth: 30,
  carryoverLookbackDays: 60,
  recurrenceScanDays: 800,
});
