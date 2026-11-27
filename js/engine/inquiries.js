// Simple daily inquiry counter and the versioned default target.
// The count is one non-negative number per local date (Asia/Jerusalem) in
// `state.inquiryCounts`. Rollover: at local midnight a new date starts at 0; earlier dates
// keep their number. Reset sets the current date back to 0. No record is created per tap.
// Legacy count events (`inquiryLogs`, schema v1) are kept untouched for recovery only.

/** Current count for a date (0 when nothing was counted). */
export function countFor(state, date) {
  const n = state.inquiryCounts?.[date];
  return Number.isInteger(n) && n > 0 ? n : 0;
}

/** Default target version in force on a date. */
export function defaultTargetAt(state, date) {
  let best = null;
  for (const v of state.targetHistory.defaults) if (v.effectiveFrom <= date && (!best || v.effectiveFrom > best.effectiveFrom || (v.effectiveFrom === best.effectiveFrom && v.setAt > best.setAt))) best = v;
  return best ? best.target : 0;
}

/** Daily target shown next to the counter: a legacy per-date override wins, else the default. */
export function counterTarget(state, date) {
  const o = state.dayOverrides?.[date]?.inquiryTarget;
  return Number.isInteger(o) ? o : defaultTargetAt(state, date);
}

/** Progress ratio 0..1 for the indicator (the count itself may exceed the target). */
export function counterProgress(count, target) {
  if (!target) return count > 0 ? 1 : 0;
  return Math.min(1, count / target);
}
