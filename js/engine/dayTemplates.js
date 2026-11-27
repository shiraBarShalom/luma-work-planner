// Effective day computation and lazy generation of legacy routine-template blocks.
// Since schema v2 the weekly schedule is made of ordinary recurring activities; legacy
// templates only render days before `settings.routineEndsOn`, so history is preserved.
// Precedence: work-calendar defaults -> applicable versioned template -> week override ->
// date override. Location, phone duty and hours are independent fields. Template versions
// carry effective dates, so editing a template never rewrites past days.
import { weekday, weekStart, toMin, fromMin, addDays } from '../dates.js';
import { memo } from './cache.js';

export const OVERRIDE_FIELDS = ['isWorking', 'location', 'phoneDuty', 'phoneStart', 'phoneEnd', 'workStart', 'workEnd', 'templateId', 'inquiryTarget', 'label', 'note'];

const cacheFor = (state) => ({ eff: memo(state, 'eff'), routine: memo(state, 'routine') });

/**
 * @returns {{date:string, weekday:number, isWorking:boolean, location:string|null, phoneDuty:boolean,
 *   phoneStart:string, phoneEnd:string, workStart:string, workEnd:string, templateId:string,
 *   inquiryTargetOverride:number|null, label:string|null, note:string|null, sources:Object, overridden:boolean}}
 */
export function effectiveDay(state, date) {
  const c = cacheFor(state);
  const hit = c.eff.get(date);
  if (hit) return hit;
  const st = state.settings;
  const wd = weekday(date);
  const base = st.weekly[wd] || { isWorking: false };
  const eff = {
    date, weekday: wd,
    isWorking: !!base.isWorking,
    location: base.isWorking ? (base.location || 'office') : null,
    phoneDuty: !!(base.isWorking && base.phoneDuty),
    phoneStart: st.phoneDutyWindow.start,
    phoneEnd: st.phoneDutyWindow.end,
    workStart: base.workStart || st.workHours.start,
    workEnd: base.workEnd || st.workHours.end,
    templateId: base.templateId || st.defaultTemplateId,
    inquiryTargetOverride: null,
    label: null,
    note: null,
    sources: {},
    overridden: false,
  };
  const apply = (patch, src) => {
    if (!patch) return;
    for (const f of OVERRIDE_FIELDS) {
      if (patch[f] === undefined || patch[f] === null) continue;
      if (f === 'inquiryTarget') eff.inquiryTargetOverride = patch[f];
      else eff[f] = patch[f];
      eff.sources[f] = src;
      eff.overridden = true;
    }
  };
  const wo = state.weekOverrides[weekStart(date)];
  if (wo && wo.days) apply(wo.days[String(wd)], 'week');
  apply(state.dayOverrides[date], 'day');
  if (!eff.isWorking) eff.phoneDuty = false;
  else if (!eff.location) eff.location = 'office';
  c.eff.set(date, eff);
  return eff;
}

export const isWorkday = (state, date) => effectiveDay(state, date).isWorking;

/** dayInfo adapter for recurrence matching. */
export const dayInfoFor = (state) => (date) => effectiveDay(state, date);

export function workdaysBetween(state, from, to) {
  // Count of workdays d with from < d <= to.
  let n = 0;
  for (let d = addDays(from, 1); d <= to; d = addDays(d, 1)) if (isWorkday(state, d)) n++;
  return n;
}

export function findTemplate(state, templateId) {
  return state.dayTemplates.find((t) => t.id === templateId) || state.dayTemplates.find((t) => t.id === state.settings.defaultTemplateId) || state.dayTemplates[0];
}

export function templateVersionFor(state, templateId, date) {
  const t = findTemplate(state, templateId);
  if (!t) return null;
  let best = null;
  for (const v of t.versions) if (v.effectiveFrom <= date && (!best || v.effectiveFrom > best.effectiveFrom)) best = v;
  return best || t.versions[0];
}

export const routineOccId = (templateId, role, date) => `r:${templateId}:${role}@${date}`;

/**
 * Routine blocks for a date, fitted to the effective work window.
 * End-anchored blocks (closing) follow the end of the workday, start-anchored blocks
 * follow its start; other blocks are clipped to the remaining window. Blocks that no
 * longer fit are reported in `suppressed`, never silently lost.
 */
export function routineBlocks(state, date) {
  const c = cacheFor(state);
  const hit = c.routine.get(date);
  if (hit) return hit;
  const eff = effectiveDay(state, date);
  const res = { blocks: [], suppressed: [], templateId: eff.templateId, versionId: null };
  const endsOn = state.settings.routineEndsOn;
  if (!eff.isWorking || (endsOn && date >= endsOn)) { c.routine.set(date, res); return res; }
  const tpl = findTemplate(state, eff.templateId);
  const ver = templateVersionFor(state, eff.templateId, date);
  if (!tpl || !ver) { c.routine.set(date, res); return res; }
  res.templateId = tpl.id;
  res.versionId = ver.id;
  const wS = toMin(eff.workStart), wE = toMin(eff.workEnd);
  const nS = toMin(ver.nominalStart || eff.workStart), nE = toMin(ver.nominalEnd || eff.workEnd);
  const placed = ver.blocks.map((b) => {
    let s = toMin(b.start), e = toMin(b.end);
    const len = e - s;
    if (b.anchor === 'end' && wE !== nE) { e = e + (wE - nE); s = e - len; }
    if (b.anchor === 'start' && wS !== nS) { s = s + (wS - nS); e = s + len; }
    return { b, s, e };
  });
  const startAnch = placed.filter((p) => p.b.anchor === 'start');
  const endAnch = placed.filter((p) => p.b.anchor === 'end');
  const low = Math.max(wS, ...startAnch.map((p) => p.e));
  const high = Math.min(wE, ...endAnch.map((p) => p.s));
  for (const p of placed) {
    let { s, e } = p;
    if (!p.b.anchor) { s = Math.max(s, low); e = Math.min(e, high); }
    else { s = Math.max(s, wS); e = Math.min(e, wE); }
    const item = {
      id: routineOccId(tpl.id, p.b.role, date), kind: 'routine', date, role: p.b.role, title: p.b.title,
      start: fromMin(s), end: fromMin(e), categoryId: p.b.categoryId, protected: !!p.b.protected,
      flexible: !!p.b.flexible, minMinutes: p.b.minMinutes || 0, instructions: p.b.instructions || [],
      templateId: tpl.id, versionId: ver.id,
    };
    if (e - s < 5) res.suppressed.push({ ...item, start: p.b.start, end: p.b.end });
    else res.blocks.push(item);
  }
  c.routine.set(date, res);
  return res;
}
