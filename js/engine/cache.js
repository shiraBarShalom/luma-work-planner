// Per-state memoization for derived selectors. States are treated as immutable once
// committed, so caches are keyed by the state object. A draft that is being mutated by
// a command is marked uncached so reads inside the command are always fresh.
const caches = new WeakMap();
const uncached = new WeakSet();

/** @returns {Map<string, any>} */
export function memo(state, bucket) {
  if (uncached.has(state)) return new Map();
  let c = caches.get(state);
  if (!c) { c = {}; caches.set(state, c); }
  return (c[bucket] ||= new Map());
}

export function markUncached(state, on = true) {
  if (on) { uncached.add(state); caches.delete(state); } else uncached.delete(state);
}
