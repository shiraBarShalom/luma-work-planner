// Time-of-day header: banner and greeting from configurable fixed clock intervals in
// Asia/Jerusalem. Intervals are start-inclusive / end-exclusive and may wrap midnight.
import { toMin } from '../dates.js';

export const BANNERS = {
  dawn: 'assets/banners/banner-dawn.webp',
  dawnAlternate: 'assets/banners/banner-dawn-alternate.webp',
  day: 'assets/banners/banner-day.webp',
  sunset: 'assets/banners/banner-sunset.webp',
  night: 'assets/banners/banner-night.webp',
};

function inRule(rule, minute) {
  const a = toMin(rule.from), b = toMin(rule.to);
  if (a === b) return true;
  return a < b ? minute >= a && minute < b : minute >= a || minute < b;
}

/** @returns {{image:string, src:string, greeting:string, rule:Object|null}} */
export function headerFor(settings, minute) {
  const rules = settings.header?.rules || [];
  const rule = rules.find((r) => inRule(r, minute)) || null;
  let image = rule ? rule.image : 'day';
  if (image === 'dawn' && settings.header?.useAlternateDawn) image = 'dawnAlternate';
  const name = (settings.displayName || '').trim();
  const base = rule ? rule.greeting : 'שלום';
  return { image, src: BANNERS[image] || BANNERS.day, greeting: name ? `${base}, ${name}` : base, rule, dark: image === 'night' };
}

/** Minutes until the next rule boundary (1..1440). */
export function minutesToNextBoundary(settings, minute) {
  const bounds = new Set();
  for (const r of settings.header?.rules || []) { bounds.add(toMin(r.from)); bounds.add(toMin(r.to)); }
  let best = 1440;
  for (const b of bounds) {
    const d = (b - minute + 1440) % 1440 || 1440;
    if (d < best) best = d;
  }
  return best;
}

/** Validation errors for header rules (Hebrew). Rules must cover the whole day without overlap. */
export function headerRuleErrors(rules) {
  const errs = [];
  const re = /^([01]\d|2[0-3]):([0-5]\d)$/;
  if (!Array.isArray(rules) || !rules.length) return ['נדרש לפחות טווח אחד'];
  for (const r of rules) {
    if (!re.test(r.from) || !re.test(r.to)) errs.push('שעה לא תקינה');
    if (!BANNERS[r.image]) errs.push('תמונה לא מוכרת');
    if (typeof r.greeting !== 'string' || !r.greeting.trim()) errs.push('חסרה ברכה');
  }
  if (errs.length) return errs;
  const covered = new Array(1440).fill(0);
  for (const r of rules) for (let m = 0; m < 1440; m++) if (inRule(r, m)) covered[m]++;
  if (covered.some((c) => c === 0)) errs.push('יש שעות שאינן מכוסות');
  if (covered.some((c) => c > 1)) errs.push('יש טווחים חופפים');
  return errs;
}
