// Test harness: synthetic data only, fake clock, in-memory storage.
import { createStore } from '../js/store.js';
import { createMemoryAdapter } from '../js/db.js';
import { createInitialState } from '../js/seed.js';
import { setClockSource } from '../js/clock.js';

let n = 0;
export const testUid = () => `id-${(++n).toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

/** Mutable fake clock in Jerusalem wall time. */
export function fakeClock(date = '2026-11-30', minute = 10 * 60) {
  const c = {
    date, minute, seq: 0,
    set(d, m = c.minute) { c.date = d; c.minute = m; },
    now: () => {
      c.seq++;
      const hh = String(Math.floor(c.minute / 60)).padStart(2, '0'), mm = String(c.minute % 60).padStart(2, '0');
      // Israel winter = UTC+2; the exact offset only matters for audit timestamps in tests.
      const iso = new Date(Date.parse(`${c.date}T${hh}:${mm}:00+02:00`) + c.seq).toISOString();
      return { nowIso: iso, today: c.date, minute: c.minute };
    },
  };
  setClockSource(() => Date.parse(c.now().nowIso));
  return c;
}

export async function makeStore({ date = '2026-11-30', minute = 600, adapter = createMemoryAdapter() } = {}) {
  const clock = fakeClock(date, minute);
  const store = createStore({ adapter, now: clock.now, uid: testUid });
  await store.init();
  return { store, clock, adapter };
}

export async function must(p) {
  const r = await p;
  if (!r.ok) throw new Error(`command failed: ${r.error || JSON.stringify(r.confirm)}`);
  return r.result;
}

export function freshState(nowIso = '2026-11-30T08:00:00.000Z') {
  return createInitialState(nowIso);
}
