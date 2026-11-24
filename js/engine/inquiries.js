// Inquiry counting from immutable count/correction events, and versioned daily targets.
// Totals are always derived from events; there is no second mutable counter.
import { INQUIRY_KINDS, INQUIRY_CATEGORIES } from '../data/schema.js';
import { datesBetween, weekStart, addDays, monthStart, monthEnd } from '../dates.js';
import { effectiveDay } from './dayTemplates.js';
import { memo } from './cache.js';

/**
 * @typedef {Object} InquiryEvent
 * @property {string} id
 * @property {string} workDate   YYYY-MM-DD
 * @property {'completed'|'allocatedTomorrow'|'transferred'|'other'} kind
 * @property {'simple'|'complex'|'unspecified'} category
 * @property {number} quantity   positive count, or negative for a correction
 * @property {string|null} correctsId
 * @property {string} at         ISO instant
 */

function emptyTotals() {
  const t = { byCategory: {} };
  for (const k of INQUIRY_KINDS) { t[k] = 0; t.byCategory[k] = Object.fromEntries(INQUIRY_CATEGORIES.map((c) => [c, 0])); }
  return t;
}

function logsByDate(state) {
  const c = memo(state, 'inqByDate');
  if (c.has('x')) return c.get('x');
  const m = new Map();
  for (const e of state.inquiryLogs) {
    if (!m.has(e.workDate)) m.set(e.workDate, []);
    m.get(e.workDate).push(e);
  }
  c.set('x', m);
  return m;
}

export function totalsFromEvents(events) {
  const t = emptyTotals();
  for (const e of events) {
    t[e.kind] += e.quantity;
    t.byCategory[e.kind][e.category] += e.quantity;
  }
  return t;
}

export function dayTotals(state, date) {
  return totalsFromEvents(logsByDate(state).get(date) || []);
}

export function eventsForDate(state, date) {
  return (logsByDate(state).get(date) || []).slice().sort((a, b) => a.at.localeCompare(b.at));
}

/** Would appending these events keep every aggregate non-negative? Returns error code or null. */
export function checkEvents(existing, added) {
  const t = totalsFromEvents([...existing, ...added]);
  for (const k of INQUIRY_KINDS) {
    if (t[k] < 0) return 'negative-total';
    for (const c of INQUIRY_CATEGORIES) if (t.byCategory[k][c] < 0) return 'negative-category';
  }
  return null;
}

/** Remaining (uncorrected) quantity of an event. */
export function remainingOf(state, eventId) {
  const e = state.inquiryLogs.find((x) => x.id === eventId);
  if (!e || e.quantity <= 0) return 0;
  const corrected = state.inquiryLogs.filter((x) => x.correctsId === eventId).reduce((a, x) => a + x.quantity, 0);
  return Math.max(0, e.quantity + corrected);
}

/** Latest positive event on a date (optionally of a kind) that still has uncorrected quantity. */
export function lastUndoable(state, date, kind = null) {
  const evs = eventsForDate(state, date).filter((e) => e.quantity > 0 && (!kind || e.kind === kind));
  for (let i = evs.length - 1; i >= 0; i--) if (remainingOf(state, evs[i].id) > 0) return evs[i];
  return null;
}

// ---------- targets ----------
export function defaultTargetAt(state, date) {
  let best = null;
  for (const v of state.targetHistory.defaults) if (v.effectiveFrom <= date && (!best || v.effectiveFrom > best.effectiveFrom || (v.effectiveFrom === best.effectiveFrom && v.setAt > best.setAt))) best = v;
  return best ? best.target : 0;
}

/**
 * Effective inquiry target for a date. Non-working days have no target unless a date
 * override explicitly sets one on a day made working. Explicit date overrides win, then a
 * closed day's snapshot, then the default version in force on that date.
 * @returns {{target:number, source:'day'|'week'|'snapshot'|'default'|'off'}}
 */
export function effectiveTarget(state, date) {
  const eff = effectiveDay(state, date);
  if (!eff.isWorking) return { target: 0, source: 'off' };
  if (eff.inquiryTargetOverride != null) return { target: eff.inquiryTargetOverride, source: eff.sources.inquiryTarget || 'day' };
  const snap = state.dailyReports[date]?.snapshot;
  if (snap && Number.isInteger(snap.target)) return { target: snap.target, source: 'snapshot' };
  return { target: defaultTargetAt(state, date), source: 'default' };
}

export function pct(value, target) {
  if (!target) return null;
  return Math.round((value / target) * 100);
}

/**
 * Aggregate for an inclusive date range. Targets are the sum of eligible daily targets.
 * For an in-progress period, `elapsedTarget` covers dates up to and including `asOf`.
 */
export function periodSummary(state, from, to, asOf) {
  const days = datesBetween(from, to).map((date) => {
    const t = dayTotals(state, date);
    const tg = effectiveTarget(state, date);
    return { date, isWorking: effectiveDay(state, date).isWorking, target: tg.target, targetSource: tg.source, ...t, closed: !!state.dailyReports[date]?.closedAt };
  });
  const sum = (k) => days.reduce((a, d) => a + d[k], 0);
  const elapsed = days.filter((d) => d.date <= asOf);
  const byCategory = Object.fromEntries(INQUIRY_CATEGORIES.map((c) => [c, days.reduce((a, d) => a + d.byCategory.completed[c], 0)]));
  return {
    from, to, asOf, days,
    completed: sum('completed'), allocatedTomorrow: sum('allocatedTomorrow'), transferred: sum('transferred'), other: sum('other'),
    completedByCategory: byCategory,
    targetFull: sum('target'),
    targetElapsed: elapsed.reduce((a, d) => a + d.target, 0),
    completedElapsed: elapsed.reduce((a, d) => a + d.completed, 0),
    workdays: days.filter((d) => d.isWorking).length,
    inProgress: asOf >= from && asOf < to,
  };
}

export const weekRange = (date) => { const ws = weekStart(date); return [ws, addDays(ws, 6)]; };
export const monthRange = (date) => [monthStart(date), monthEnd(date)];
