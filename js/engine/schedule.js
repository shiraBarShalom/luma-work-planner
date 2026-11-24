// Effective schedule for a date: routine template blocks, recurring and one-off calendar
// blocks and meeting projections, with occurrence overrides, completion records, task
// links and conflicts. Pure and DOM-free.
import { toMin, fromMin } from '../dates.js';
import { memo } from './cache.js';
import { effectiveDay, routineBlocks, dayInfoFor } from './dayTemplates.js';
import { matchesRecurrence } from './recurrence.js';

export const seriesOccId = (blockId, date) => `${blockId}@${date}`;
export const meetingOccId = (meetingId) => `mtg:${meetingId}`;

/** Parse an occurrence id into its source. */
export function parseOccId(id) {
  if (typeof id !== 'string') return null;
  if (id.startsWith('mtg:')) return { kind: 'meeting', meetingId: id.slice(4) };
  if (id.startsWith('r:')) {
    const at = id.lastIndexOf('@');
    const [, templateId, role] = id.slice(0, at).split(':');
    return { kind: 'routine', templateId, role, date: id.slice(at + 1) };
  }
  const at = id.lastIndexOf('@');
  if (at > 0) return { kind: 'series', blockId: id.slice(0, at), date: id.slice(at + 1) };
  return { kind: 'block', blockId: id };
}

export function meetingTimes(m) {
  if (!m.date || !m.start) return null;
  let end = m.end;
  if (!end && Number.isInteger(m.durationMinutes) && m.durationMinutes > 0) end = fromMin(toMin(m.start) + m.durationMinutes);
  if (!end || toMin(end) <= toMin(m.start)) return null;
  return { start: m.start, end };
}

function tasksByBlock(state) {
  const c = memo(state, 'tasksByBlock');
  if (c.has('x')) return c.get('x');
  const map = new Map();
  for (const t of state.tasks) {
    if (!t.assignedBlock || t.status === 'canceled') continue;
    if (!map.has(t.assignedBlock)) map.set(t.assignedBlock, []);
    map.get(t.assignedBlock).push(t.id);
  }
  c.set('x', map);
  return map;
}

/**
 * All occurrences for a date, sorted by start.
 * @returns {Array<Object>}
 */
export function dayOccurrences(state, date) {
  const c = memo(state, 'occ');
  if (c.has(date)) return c.get(date);
  const eff = effectiveDay(state, date);
  const ov = state.occurrenceOverrides;
  const comp = state.blockCompletions;
  const byBlock = tasksByBlock(state);
  const info = dayInfoFor(state);
  const out = [];
  const push = (o) => {
    const done = comp[o.id];
    o.status = done ? done.status : 'planned';
    o.actualMinutes = done && Number.isInteger(done.actualMinutes) ? done.actualMinutes : null;
    o.taskIds = byBlock.get(o.id) || [];
    o.s = toMin(o.start);
    o.e = toMin(o.end);
    o.offDay = !eff.isWorking && o.kind !== 'routine';
    o.outsideHours = eff.isWorking && (o.s < toMin(eff.workStart) || o.e > toMin(eff.workEnd));
    o.conflicts = [];
    out.push(o);
  };
  const applyOverride = (o) => {
    const x = ov[o.id];
    if (!x) return o;
    if (x.excluded) return null;
    for (const f of ['start', 'end', 'title', 'notes', 'categoryId']) if (x[f] !== undefined) o[f] = x[f];
    if (x.pinned !== undefined) o.pinned = x.pinned;
    o.manual = !!x.manual;
    o.overridden = true;
    return o;
  };

  for (const rb of routineBlocks(state, date).blocks) {
    const o = applyOverride({ ...rb, notes: '', pinned: false, manual: false, fixed: false, overridden: false, movedFrom: null });
    if (o) push(o);
  }
  for (const b of state.calendarBlocks) {
    if (b.recurrence) {
      if (!matchesRecurrence(b.recurrence, date, info)) continue;
      const o = applyOverride({
        id: seriesOccId(b.id, date), kind: 'series', sourceId: b.id, date, role: b.role || null, title: b.title,
        start: b.start, end: b.end, categoryId: b.categoryId, notes: b.notes || '', pinned: !!b.pinned, manual: true,
        protected: !!b.protected, flexible: b.flexible !== false, minMinutes: b.minMinutes || 0, fixed: false,
        instructions: [], recurrence: b.recurrence, overridden: false, movedFrom: null,
      });
      if (o) push(o);
    } else if (b.date === date) {
      push({
        id: b.id, kind: 'block', sourceId: b.id, date, role: b.role || null, title: b.title, start: b.start, end: b.end,
        categoryId: b.categoryId, notes: b.notes || '', pinned: !!b.pinned, manual: b.source !== 'planner' && b.source !== 'import',
        protected: !!b.protected, flexible: b.flexible !== false, minMinutes: b.minMinutes || 0, fixed: false,
        instructions: b.instructions || [], overridden: false, movedFrom: b.movedFrom || null, source: b.source || 'manual',
        importRef: b.importRef || null,
      });
    }
  }
  for (const m of state.meetings) {
    if (m.date !== date || m.status === 'canceled') continue;
    const t = meetingTimes(m);
    if (!t) continue;
    push({
      id: meetingOccId(m.id), kind: 'meeting', sourceId: m.id, date, role: null, title: m.title, start: t.start, end: t.end,
      categoryId: 'meeting', notes: '', pinned: true, manual: true, protected: false, flexible: false, minMinutes: 0, fixed: true,
      instructions: [], meetingType: m.meetingType, overridden: false, movedFrom: null,
    });
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
  if (p.kind === 'meeting') date = state.meetings.find((m) => m.id === p.meetingId)?.date;
  if (!date) return null;
  return dayOccurrences(state, date).find((o) => o.id === occId) || null;
}

/** Overlapping pairs on a date. */
export function overlapPairs(occs) {
  const byId = new Map(occs.map((o) => [o.id, o]));
  const pairs = [];
  const seen = new Set();
  for (const o of occs) for (const id of o.conflicts) {
    const k = [o.id, id].sort().join('|');
    if (seen.has(k)) continue;
    seen.add(k);
    pairs.push([o, byId.get(id)]);
  }
  return pairs;
}

/** Current and next occurrence relative to a wall-clock minute. Honest about gaps. */
export function currentAndNext(state, date, minute) {
  const eff = effectiveDay(state, date);
  const occs = dayOccurrences(state, date).filter((o) => o.status !== 'canceled' && o.status !== 'skipped');
  const current = occs.filter((o) => o.s <= minute && minute < o.e);
  const next = occs.find((o) => o.s > minute) || null;
  const wS = toMin(eff.workStart), wE = toMin(eff.workEnd);
  let phase = 'off';
  if (eff.isWorking) phase = minute < wS ? 'before' : minute >= wE ? 'after' : current.length ? 'block' : 'gap';
  if (!eff.isWorking && current.length) phase = 'block';
  const primary = current.find((o) => o.kind === 'meeting') || current[current.length - 1] || null;
  return {
    phase, current: primary, overlapping: current.length > 1 ? current : [], next,
    remaining: primary ? primary.e - minute : null,
    untilNext: next ? next.s - minute : null,
  };
}

/** Day completion progress over blocks that are not canceled. */
export function blockProgress(state, date) {
  const occs = dayOccurrences(state, date).filter((o) => o.status !== 'canceled' && o.kind !== 'meeting');
  const total = occs.length;
  const done = occs.filter((o) => o.status === 'done').length;
  const partial = occs.filter((o) => o.status === 'partial').length;
  const minutes = occs.reduce((a, o) => a + (o.e - o.s), 0);
  const doneMinutes = occs.reduce((a, o) => a + (o.status === 'done' ? o.e - o.s : o.status === 'partial' ? (o.e - o.s) / 2 : 0), 0);
  return { total, done, partial, pct: minutes ? Math.round((doneMinutes / minutes) * 100) : 0 };
}
