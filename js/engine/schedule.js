// Effective schedule for a date: legacy routine template blocks, recurring and one-off
// calendar activities, with occurrence overrides, completion records and overlaps.
// Overlapping activities are allowed and each keeps its own time. Pure and DOM-free.
import { toMin } from '../dates.js';
import { memo } from './cache.js';
import { routineBlocks, dayInfoFor } from './dayTemplates.js';
import { matchesRecurrence } from './recurrence.js';

export const seriesOccId = (blockId, date) => `${blockId}@${date}`;

/** Parse an occurrence id into its source. */
export function parseOccId(id) {
  if (typeof id !== 'string') return null;
  if (id.startsWith('r:')) {
    const at = id.lastIndexOf('@');
    const [, templateId, role] = id.slice(0, at).split(':');
    return { kind: 'routine', templateId, role, date: id.slice(at + 1) };
  }
  const at = id.lastIndexOf('@');
  if (at > 0) return { kind: 'series', blockId: id.slice(0, at), date: id.slice(at + 1) };
  return { kind: 'block', blockId: id };
}

/**
 * All occurrences for a date, sorted by start. `conflicts` lists overlapping occurrence
 * IDs (used only for side-by-side layout; overlaps are allowed).
 * @returns {Array<Object>}
 */
export function dayOccurrences(state, date) {
  const c = memo(state, 'occ');
  if (c.has(date)) return c.get(date);
  const ov = state.occurrenceOverrides;
  const comp = state.blockCompletions;
  const info = dayInfoFor(state);
  const out = [];
  const push = (o) => {
    const done = comp[o.id];
    o.status = done ? done.status : 'planned';
    o.actualMinutes = done && Number.isInteger(done.actualMinutes) ? done.actualMinutes : null;
    o.s = toMin(o.start);
    o.e = toMin(o.end);
    o.conflicts = [];
    o.recurring = o.kind === 'routine' || o.kind === 'series';
    out.push(o);
  };
  const applyOverride = (o) => {
    const x = ov[o.id];
    if (!x) return o;
    if (x.excluded) return null;
    for (const f of ['start', 'end', 'title', 'notes', 'categoryId']) if (x[f] !== undefined) o[f] = x[f];
    o.manual = !!x.manual;
    o.overridden = true;
    return o;
  };

  for (const rb of routineBlocks(state, date).blocks) {
    const o = applyOverride({ ...rb, notes: '', manual: false, overridden: false, movedFrom: null });
    if (o) push(o);
  }
  for (const b of state.calendarBlocks) {
    if (b.recurrence) {
      if (!matchesRecurrence(b.recurrence, date, info)) continue;
      const o = applyOverride({
        id: seriesOccId(b.id, date), kind: 'series', sourceId: b.id, date, title: b.title,
        start: b.start, end: b.end, categoryId: b.categoryId, notes: b.notes || '', manual: true,
        recurrence: b.recurrence, overridden: false, movedFrom: null,
      });
      if (o) push(o);
    } else if (b.date === date) {
      push({
        id: b.id, kind: 'block', sourceId: b.id, date, title: b.title, start: b.start, end: b.end,
        categoryId: b.categoryId, notes: b.notes || '', manual: b.source !== 'import',
        overridden: false, movedFrom: b.movedFrom || null, source: b.source || 'manual', importRef: b.importRef || null,
      });
    }
  }
  out.sort((a, b) => a.s - b.s || a.e - b.e || a.id.localeCompare(b.id));
  const active = out.filter((o) => o.status !== 'canceled' && o.status !== 'skipped');
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length && active[j].s < active[i].e; j++) {
      active[i].conflicts.push(active[j].id);
      active[j].conflicts.push(active[i].id);
    }
  }
  c.set(date, out);
  return out;
}

export function findOccurrence(state, occId) {
  const p = parseOccId(occId);
  if (!p) return null;
  let date = p.date;
  if (p.kind === 'block') date = state.calendarBlocks.find((b) => b.id === p.blockId)?.date;
  if (!date) return null;
  return dayOccurrences(state, date).find((o) => o.id === occId) || null;
}

/**
 * Current and next activities relative to a wall-clock minute. Several activities may be
 * current at once; `all` lists every one of them.
 * phase: 'now' (something is happening), 'next' (nothing now, something later today),
 *        'done' (nothing left today), 'none' (no activities on the date).
 */
export function currentAndNext(state, date, minute) {
  const occs = dayOccurrences(state, date).filter((o) => o.status !== 'canceled' && o.status !== 'skipped');
  const all = occs.filter((o) => o.s <= minute && minute < o.e);
  const next = occs.find((o) => o.s > minute) || null;
  const phase = all.length ? 'now' : next ? 'next' : occs.length ? 'done' : 'none';
  const current = all[0] || null;
  return { phase, current, all, next, remaining: current ? current.e - minute : null, untilNext: next ? next.s - minute : null };
}


/**
 * Canonical signature of everything that defines recurring activities: recurring blocks,
 * legacy routine templates, their cut-off date and per-occurrence overrides. Automated
 * commands must leave it unchanged (enforced by the store).
 */
export function recurringSignature(state) {
  const blocks = state.calendarBlocks.filter((b) => b.recurrence).sort((a, b) => a.id.localeCompare(b.id));
  const overrides = Object.keys(state.occurrenceOverrides).filter((k) => { const p = parseOccId(k); return p?.kind === 'series' || p?.kind === 'routine'; })
    .sort().map((k) => [k, state.occurrenceOverrides[k]]);
  return JSON.stringify({ blocks, overrides, templates: state.dayTemplates, endsOn: state.settings.routineEndsOn ?? null });
}
