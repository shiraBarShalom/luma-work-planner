// Shared application context for views: the store instance, the clock and a command
// runner that handles confirmation prompts, errors and honest save feedback uniformly.
import { today, nowMin } from './dates.js';
import { confirmDialog, toast } from './ui.js';

/** @type {ReturnType<import('./store.js').createStore>} */
export let store = null;
export function bindStore(s) { store = s; }

export const nowCtx = () => ({ date: today(), minute: nowMin() });
export const S = () => store.state;

/**
 * Dispatch a command. Asks for explicit confirmation when the command requires it.
 * @returns {Promise<any|null>} the command result, or null if canceled/failed
 */
export async function run(name, payload = {}, { success = null, undo = true, silent = false } = {}) {
  let r = await store.dispatch(name, payload);
  if (!r.ok && r.confirm) {
    const ok = await confirmDialog(r.confirm.map((c) => c.message).join('\n'), { title: 'נדרש אישור', ok: 'כן, להמשיך' });
    if (!ok) return null;
    r = await store.dispatch(name, { ...payload, confirm: true });
  }
  if (!r.ok) {
    if (r.confirm) return null;
    toast(r.error || 'הפעולה נכשלה', { error: true, timeout: 6000 });
    return null;
  }
  r.saved.then((saved) => { if (!saved) toast('השינוי לא נשמר באחסון. ראו הודעה בראש המסך.', { error: true, timeout: 7000 }); });
  if (success && !silent) toast(success, undo && store.canUndo ? { action: { label: 'ביטול', fn: () => store.undo() } } : {});
  return r.result === undefined ? true : r.result;
}
