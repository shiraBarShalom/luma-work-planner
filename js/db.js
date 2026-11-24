// Storage adapters. All are fallible and report failures; none pretends to have saved.
//  - IndexedDB (primary): one versioned state document + bounded recovery snapshots.
//    Writes check the stored revision inside the same transaction (stale-tab protection).
//  - localStorage (degraded mode only): explicitly identified, used when IndexedDB is
//    unavailable; never silently seeded over an inaccessible primary database.
//  - memory: tests and "nothing can be stored" mode.
import { IDB_NAME, IDB_VERSION, IDB_STORES, STATE_KEY, LS_FALLBACK_KEY, LIMITS } from './config.js';

export class StorageError extends Error {
  constructor(code, message, cause) { super(message); this.code = code; this.cause = cause; }
}
export class ConflictError extends StorageError {
  constructor(stored) { super('conflict', 'הנתונים עודכנו בחלון אחר', null); this.storedRevision = stored; }
}

function classify(e) {
  const name = e && (e.name || e.code);
  if (name === 'QuotaExceededError' || name === 22 || name === 1014) return new StorageError('quota', 'אין מספיק מקום אחסון במכשיר', e);
  if (name === 'VersionError') return new StorageError('version', 'מסד הנתונים נוצר בגרסה חדשה יותר של Luma', e);
  if (name === 'InvalidStateError') return new StorageError('closed', 'מסד הנתונים נסגר', e);
  return new StorageError('write', 'שמירת הנתונים נכשלה', e);
}

const req2p = (req) => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });

export function createIdbAdapter(idb = globalThis.indexedDB) {
  let dbp = null;
  let blockedHandler = null;
  const open = () => {
    if (!idb) return Promise.reject(new StorageError('unsupported', 'הדפדפן אינו תומך ב־IndexedDB'));
    if (!dbp) {
      dbp = new Promise((resolve, reject) => {
        let req;
        try { req = idb.open(IDB_NAME, IDB_VERSION); } catch (e) { reject(classify(e)); return; }
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(IDB_STORES.state)) db.createObjectStore(IDB_STORES.state);
          if (!db.objectStoreNames.contains(IDB_STORES.recovery)) db.createObjectStore(IDB_STORES.recovery, { keyPath: 'id' });
        };
        req.onsuccess = () => {
          const db = req.result;
          db.onversionchange = () => { db.close(); dbp = null; blockedHandler && blockedHandler('versionchange'); };
          resolve(db);
        };
        req.onerror = () => { dbp = null; reject(classify(req.error)); };
        req.onblocked = () => { blockedHandler && blockedHandler('blocked'); };
      });
    }
    return dbp;
  };
  const tx = async (stores, mode, fn) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      let t, result;
      try { t = db.transaction(stores, mode); } catch (e) { reject(classify(e)); return; }
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error instanceof StorageError ? t.error : classify(t.error));
      t.onabort = () => reject(t._luma || classify(t.error));
      Promise.resolve(fn(t)).then((r) => { result = r; }, (e) => { t._luma = e; try { t.abort(); } catch { reject(e); } });
    });
  };
  return {
    kind: 'indexeddb',
    onBlocked(fn) { blockedHandler = fn; },
    async probe() { await open(); return true; },
    async load() {
      return tx([IDB_STORES.state], 'readonly', (t) => req2p(t.objectStore(IDB_STORES.state).get(STATE_KEY)));
    },
    async readRevision() {
      const doc = await this.load();
      return doc ? doc.metadata?.revision ?? null : null;
    },
    /** Write if the stored revision equals expectedBase (null = nothing stored yet). */
    async save(doc, expectedBase) {
      return tx([IDB_STORES.state], 'readwrite', async (t) => {
        const st = t.objectStore(IDB_STORES.state);
        const cur = await req2p(st.get(STATE_KEY));
        const curRev = cur ? cur.metadata?.revision ?? null : null;
        if (expectedBase !== undefined && curRev !== expectedBase) throw new ConflictError(curRev);
        await req2p(st.put(doc, STATE_KEY));
        return true;
      });
    },
    async saveRecovery(snap) {
      return tx([IDB_STORES.recovery], 'readwrite', async (t) => {
        const st = t.objectStore(IDB_STORES.recovery);
        await req2p(st.put(snap));
        const all = await req2p(st.getAll());
        all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        for (const old of all.slice(LIMITS.recoverySnapshots)) await req2p(st.delete(old.id));
        return true;
      });
    },
    async listRecovery() {
      const all = await tx([IDB_STORES.recovery], 'readonly', (t) => req2p(t.objectStore(IDB_STORES.recovery).getAll()));
      return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(({ state, ...meta }) => meta);
    },
    async getRecovery(id) {
      return tx([IDB_STORES.recovery], 'readonly', (t) => req2p(t.objectStore(IDB_STORES.recovery).get(id)));
    },
  };
}

export function createLocalStorageAdapter(ls = globalThis.localStorage) {
  const read = () => {
    const raw = ls.getItem(LS_FALLBACK_KEY);
    return raw ? JSON.parse(raw) : null;
  };
  return {
    kind: 'localstorage',
    async probe() { const k = LS_FALLBACK_KEY + ':probe'; ls.setItem(k, '1'); ls.removeItem(k); return true; },
    async load() { try { return read()?.state || null; } catch (e) { throw new StorageError('read', 'קריאת הגיבוי הזמני נכשלה', e); } },
    async readRevision() { return (await this.load())?.metadata?.revision ?? null; },
    async save(doc, expectedBase) {
      const cur = await this.load();
      const curRev = cur ? cur.metadata?.revision ?? null : null;
      if (expectedBase !== undefined && curRev !== expectedBase) throw new ConflictError(curRev);
      try { ls.setItem(LS_FALLBACK_KEY, JSON.stringify({ savedAt: new Date().toISOString(), state: doc })); } catch (e) { throw classify(e); }
      return true;
    },
    async saveRecovery() { return false; },
    async listRecovery() { return []; },
    async getRecovery() { return null; },
    clear() { ls.removeItem(LS_FALLBACK_KEY); },
    exists() { try { return !!ls.getItem(LS_FALLBACK_KEY); } catch { return false; } },
  };
}

export function createMemoryAdapter({ failWith = null } = {}) {
  let doc = null;
  const rec = [];
  return {
    kind: 'memory',
    failWith,
    async probe() { return true; },
    async load() { return doc ? structuredClone(doc) : null; },
    async readRevision() { return doc ? doc.metadata.revision : null; },
    async save(d, expectedBase) {
      if (this.failWith) throw new StorageError(this.failWith, 'שמירה נכשלה (בדיקה)');
      const cur = doc ? doc.metadata.revision : null;
      if (expectedBase !== undefined && cur !== expectedBase) throw new ConflictError(cur);
      doc = structuredClone(d);
      return true;
    },
    async saveRecovery(s) { rec.unshift(structuredClone(s)); rec.length = Math.min(rec.length, LIMITS.recoverySnapshots); return true; },
    async listRecovery() { return rec.map(({ state, ...m }) => m); },
    async getRecovery(id) { return structuredClone(rec.find((r) => r.id === id) || null); },
    /** test helper: simulate another tab writing */
    _externalWrite(d) { doc = structuredClone(d); },
  };
}
