// Store: owns the canonical state document, runs validated commands atomically, keeps a
// monotonically increasing revision, bounded undo, persistence status and stale-tab
// conflict detection. Views read `store.state` and call `store.dispatch(...)`.
import { COMMANDS, CommandError } from './commands.js';
import { validateState } from './data/validation.js';
import { migrateState, DataError } from './data/migrations.js';
import { createInitialState } from './seed.js';
import { markUncached } from './engine/cache.js';
import { recurringSignature } from './engine/schedule.js';
import { ConflictError } from './db.js';
import { LIMITS, BROADCAST_CHANNEL } from './config.js';

/**
 * @param {Object} opts
 * @param {Object} opts.adapter  storage adapter (db.js)
 * @param {() => {nowIso:string, today:string, minute:number}} opts.now
 * @param {() => string} opts.uid
 * @param {'primary'|'degraded'|'memory'} [opts.mode]
 */
export function createStore({ adapter, now, uid, mode = 'primary' }) {
  let state = null;
  let persistedRevision = null;
  let saveTimer = null;
  let writing = Promise.resolve();
  let lastSnapshotDay = null;
  const undoStack = [];
  const subs = new Set();
  const statusSubs = new Set();
  const status = { mode, save: 'saved', error: null, conflict: false, pending: false };

  const setStatus = (patch) => { Object.assign(status, patch); statusSubs.forEach((fn) => fn({ ...status })); };
  const notify = () => subs.forEach((fn) => fn(state));
  const ctx = () => ({ ...now(), uid });

  async function writeNow() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (status.conflict) return false;
    const doc = state;
    if (doc.metadata.revision === persistedRevision) { setStatus({ save: 'saved', pending: false }); return true; }
    setStatus({ save: 'saving', pending: true });
    try {
      await adapter.save(doc, persistedRevision);
      persistedRevision = doc.metadata.revision;
      const c = now();
      if (lastSnapshotDay !== c.today && adapter.saveRecovery) {
        lastSnapshotDay = c.today;
        adapter.saveRecovery({ id: uid(), createdAt: c.nowIso, reason: 'עותק יומי אוטומטי', revision: doc.metadata.revision, state: doc }).catch(() => {});
      }
      const clean = state.metadata.revision === persistedRevision;
      setStatus({ save: clean ? 'saved' : 'saving', error: null, pending: !clean });
      try { channel?.postMessage({ type: 'revision', revision: persistedRevision }); } catch { /* ignore */ }
      return true;
    } catch (e) {
      if (e instanceof ConflictError) setStatus({ save: 'conflict', conflict: true, error: 'הנתונים עודכנו בחלון אחר של Luma. השינויים בחלון הזה לא נשמרו.' });
      else setStatus({ save: 'error', error: e.message || 'שמירה נכשלה' });
      return false;
    }
  }
  const persist = () => (writing = writing.then(writeNow, writeNow));
  function schedule(kind) {
    setStatus({ pending: true, save: 'saving' });
    if (kind === 'debounced') {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(persist, 700);
      return Promise.resolve(true);
    }
    return persist();
  }

  let channel = null;
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel(BROADCAST_CHANNEL);
      if (typeof channel.unref === 'function') channel.unref(); // never keep a Node test process alive
      channel.onmessage = (ev) => { if (ev.data?.type === 'revision') api.checkExternal(); };
    }
  } catch { channel = null; }

  function commitDraft(draft, label) {
    const prev = state;
    state = draft;
    undoStack.push({ label, before: prev, revision: draft.metadata.revision });
    if (undoStack.length > LIMITS.undoDepth) undoStack.shift();
    notify();
  }

  function prepareDraft(base, c) {
    const draft = structuredClone(base);
    markUncached(draft, true);
    draft.metadata.revision = base.metadata.revision + 1;
    draft.metadata.updatedAt = c.nowIso;
    return draft;
  }

  const api = {
    get state() { return state; },
    get status() { return { ...status }; },
    get canUndo() { return undoStack.length > 0 && !status.conflict; },
    get undoLabel() { return undoStack.length ? undoStack[undoStack.length - 1].label : null; },

    /** Load (or seed) the state. Throws DataError on unreadable/foreign/newer data; never seeds over it. */
    async init() {
      const doc = await adapter.load();
      if (!doc) {
        const c = now();
        state = createInitialState(c.nowIso);
        const v = validateState(state);
        if (!v.ok) throw new DataError('seed', 'seed invalid', v.errors);
        await adapter.save(state, null);
        persistedRevision = state.metadata.revision;
        return { fresh: true };
      }
      const c = now();
      const { state: migrated, migrated: didMigrate, from } = migrateState(doc, { today: c.today, nowIso: c.nowIso });
      if (didMigrate) {
        await adapter.saveRecovery?.({ id: uid(), createdAt: c.nowIso, reason: `לפני שדרוג נתונים מגרסה ${from}`, revision: doc.metadata.revision, state: doc });
        migrated.metadata.revision = doc.metadata.revision + 1;
        await adapter.save(migrated, doc.metadata.revision);
      }
      state = migrated;
      persistedRevision = state.metadata.revision;
      return { fresh: false, migrated: didMigrate };
    },

    /** Use an already-validated state (tests, degraded handoff). */
    _setState(s, persisted = s.metadata.revision) { state = s; persistedRevision = persisted; },

    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
    onStatus(fn) { statusSubs.add(fn); fn({ ...status }); return () => statusSubs.delete(fn); },

    /**
     * Run a command. Resolves to {ok:true,result,saved} | {ok:false,confirm} | {ok:false,error,code}.
     * State is unchanged unless ok:true.
     */
    async dispatch(name, payload = {}) {
      const cmd = COMMANDS[name];
      if (!cmd) return { ok: false, code: 'unknown', error: `פקודה לא מוכרת: ${name}` };
      if (status.conflict) return { ok: false, code: 'conflict', error: status.error };
      const c = { ...ctx(), baseRevision: state.metadata.revision };
      const draft = prepareDraft(state, c);
      let result;
      try {
        result = cmd.run(draft, payload, c);
      } catch (e) {
        if (e instanceof CommandError) return { ok: false, code: e.code, error: e.messageHe };
        console.error(e);
        return { ok: false, code: 'exception', error: 'הפעולה נכשלה בגלל שגיאה פנימית. לא בוצע שינוי.' };
      }
      if (result && result.confirmRequired) return { ok: false, confirm: result.confirmRequired };
      // Recurring activities are protected: an automated command (plan import/undo) may
      // add other records but can never move, resize, replace or remove a recurring one.
      if (cmd.automated && recurringSignature(state) !== recurringSignature(draft)) {
        return { ok: false, code: 'protected', error: 'הפעולה נדחתה כי הייתה משנה פעילות חוזרת. פעילויות חוזרות משתנות רק בעריכה ידנית. לא בוצע שינוי.' };
      }
      const v = validateState(draft);
      if (!v.ok) {
        console.error('invariant violation', name, v.errors);
        return { ok: false, code: 'invariant', error: 'הפעולה נדחתה כי הייתה פוגעת בשלמות הנתונים. לא בוצע שינוי.', details: v.errors };
      }
      if (cmd.snapshot && adapter.saveRecovery && status.mode === 'primary') {
        try {
          await adapter.saveRecovery({ id: uid(), createdAt: c.nowIso, reason: cmd.snapshot, revision: state.metadata.revision, state });
        } catch (e) {
          return { ok: false, code: 'snapshot', error: 'לא ניתן היה לשמור עותק שחזור לפני הפעולה, ולכן היא לא בוצעה: ' + e.message };
        }
      }
      markUncached(draft, false);
      commitDraft(draft, cmd.label);
      const saved = schedule(cmd.persist || 'immediate');
      return { ok: true, result, saved };
    },

    /** Revert the most recent command as a new revision. */
    async undo() {
      const u = undoStack.pop();
      if (!u || status.conflict) return null;
      if (u.revision !== state.metadata.revision) { undoStack.length = 0; return null; }
      const c = now();
      const restored = structuredClone(u.before);
      restored.metadata.revision = state.metadata.revision + 1;
      restored.metadata.updatedAt = c.nowIso;
      state = restored;
      notify();
      await schedule('immediate');
      return u.label;
    },

    /** Replace the whole document (backup restore / recovery). Snapshot first; validate; then save. */
    async replaceState(newState, reason) {
      const v = validateState(newState);
      if (!v.ok) return { ok: false, error: 'הנתונים אינם תקינים', details: v.errors };
      const c = now();
      if (adapter.saveRecovery && status.mode === 'primary') {
        try { await adapter.saveRecovery({ id: uid(), createdAt: c.nowIso, reason, revision: state.metadata.revision, state }); }
        catch (e) { return { ok: false, error: 'לא ניתן לשמור עותק שחזור של הנתונים הנוכחיים, ולכן השחזור בוטל: ' + e.message }; }
      }
      const next = structuredClone(newState);
      next.metadata.revision = Math.max(state.metadata.revision, newState.metadata.revision) + 1;
      next.metadata.updatedAt = c.nowIso;
      const prevState = state;
      state = next;
      undoStack.length = 0;
      const ok = await persist();
      if (!ok) { state = prevState; notify(); return { ok: false, error: status.error || 'השמירה נכשלה; הנתונים הקודמים נשארו' }; }
      notify();
      return { ok: true };
    },

    async listRecovery() { return adapter.listRecovery ? adapter.listRecovery() : []; },
    async getRecovery(id) { return adapter.getRecovery ? adapter.getRecovery(id) : null; },

    /** Flush pending debounced writes (best effort on page hide). */
    flush() { return saveTimer ? persist() : writing; },
    retrySave() { return persist(); },

    /** Another tab saved: reload if we have nothing unsaved; otherwise flag a conflict. */
    async checkExternal() {
      try {
        const rev = await adapter.readRevision();
        if (rev == null || rev === persistedRevision) return false;
        if (state.metadata.revision === persistedRevision && !saveTimer) {
          const doc = await adapter.load();
          const c = now();
          const { state: s } = migrateState(doc, { today: c.today, nowIso: c.nowIso });
          state = s;
          persistedRevision = s.metadata.revision;
          undoStack.length = 0;
          notify();
          return true;
        }
        setStatus({ save: 'conflict', conflict: true, error: 'הנתונים עודכנו בחלון אחר של Luma בזמן שבחלון הזה היו שינויים שלא נשמרו.' });
      } catch { /* storage unavailable: status already reflects it */ }
      return false;
    },

    /** Conflict resolution: discard this tab's unsaved changes and load the stored document. */
    async reloadFromStorage() {
      const doc = await adapter.load();
      const c = now();
      const { state: s } = migrateState(doc, { today: c.today, nowIso: c.nowIso });
      state = s;
      persistedRevision = s.metadata.revision;
      undoStack.length = 0;
      setStatus({ conflict: false, save: 'saved', error: null, pending: false });
      notify();
    },

    /** Conflict resolution: keep this tab's version (after snapshotting the stored one). */
    async overwriteStorage() {
      const doc = await adapter.load();
      const c = now();
      if (doc && adapter.saveRecovery) await adapter.saveRecovery({ id: uid(), createdAt: c.nowIso, reason: 'גרסה מחלון אחר שנדרסה', revision: doc.metadata.revision, state: doc });
      persistedRevision = doc ? doc.metadata.revision : null;
      state = { ...state, metadata: { ...state.metadata, revision: Math.max(state.metadata.revision, (persistedRevision ?? 0)) + 1 } };
      setStatus({ conflict: false, error: null });
      return persist();
    },
  };
  return api;
}
