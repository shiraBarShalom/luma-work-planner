// Wall-clock date/time primitives.
// Calendar dates are 'YYYY-MM-DD' strings in Asia/Jerusalem and times are 'HH:MM'.
// "Today"/"now" are computed with Intl in the explicit zone; calendar arithmetic uses UTC
// midnights only, so DST or a device timezone change can never shift a date or a block.
import { TIMEZONE } from './config.js';
import { clock } from './clock.js';

export const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
export const DAY_LETTERS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];
export const DAY_SHORT = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
export const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

export const pad = (n) => String(n).padStart(2, '0');

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Strict calendar validation (rejects 2026-02-30, accepts 2028-02-29). */
export function isValidDate(v) {
  if (typeof v !== 'string') return false;
  const m = DATE_RE.exec(v);
  if (!m) return false;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (y < 1900 || y > 2200 || mo < 1 || mo > 12 || d < 1) return false;
  return d <= daysInMonth(y, mo);
}
export const isValidTime = (v) => typeof v === 'string' && TIME_RE.test(v);

export function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

let partsFmt;
/** Wall-clock parts of an instant in Asia/Jerusalem. */
export function zonedParts(date = clock.now()) {
  partsFmt ||= new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  const p = {};
  for (const x of partsFmt.formatToParts(date)) p[x.type] = x.value;
  const hour = Number(p.hour) % 24;
  return { date: `${p.year}-${p.month}-${p.day}`, min: hour * 60 + Number(p.minute), sec: Number(p.second) };
}
export const today = () => zonedParts().date;
export const nowMin = () => zonedParts().min;

export function toUTC(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
export function fromUTC(dt) {
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}
export function addDays(iso, n) {
  const d = toUTC(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return fromUTC(d);
}
/** Whole days from a to b (b - a). */
export const diffDays = (a, b) => Math.round((toUTC(b) - toUTC(a)) / 86400000);
export const weekday = (iso) => toUTC(iso).getUTCDay();
/** Sunday that starts the week containing iso. */
export const weekStart = (iso) => addDays(iso, -weekday(iso));
export const range = (from, n) => Array.from({ length: n }, (_, i) => addDays(from, i));
export const weekDates = (ws) => range(ws, 7);
export function addMonths(iso, n) {
  let y = +iso.slice(0, 4), m = +iso.slice(5, 7) + n;
  y += Math.floor((m - 1) / 12);
  m = ((m - 1) % 12 + 12) % 12 + 1;
  const d = Math.min(+iso.slice(8, 10), daysInMonth(y, m));
  return `${y}-${pad(m)}-${pad(d)}`;
}
/** Sunday-first grid covering the month (whole weeks). */
export function monthGrid(y, m) {
  const first = `${y}-${pad(m)}-01`;
  const last = `${y}-${pad(m)}-${pad(daysInMonth(y, m))}`;
  const end = addDays(weekStart(last), 6);
  const days = [];
  for (let d = weekStart(first); d <= end; d = addDays(d, 1)) days.push(d);
  return days;
}

export function toMin(t) {
  if (!t) return 0;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
}
export function fromMin(n) {
  n = Math.max(0, Math.min(23 * 60 + 59, Math.round(n)));
  return `${pad(Math.floor(n / 60))}:${pad(n % 60)}`;
}

// ---------- formatting (Hebrew) ----------
export function fmtLong(iso) {
  const d = toUTC(iso);
  return `יום ${DAY_NAMES[d.getUTCDay()]}, ${d.getUTCDate()} ב${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
export function fmtDayDate(iso) {
  const d = toUTC(iso);
  return `יום ${DAY_NAMES[d.getUTCDay()]}, ${d.getUTCDate()} ב${MONTHS[d.getUTCMonth()]}`;
}
export function fmtDM(iso) {
  const d = toUTC(iso);
  return `${d.getUTCDate()} ב${MONTHS[d.getUTCMonth()]}`;
}
export function fmtShort(iso) {
  const d = toUTC(iso);
  return `${d.getUTCDate()}.${d.getUTCMonth() + 1}`;
}
export const monthLabel = (y, m) => `${MONTHS[m - 1]} ${y}`;
export function weekLabel(ws) {
  const we = addDays(ws, 6);
  const a = toUTC(ws), b = toUTC(we);
  if (a.getUTCMonth() === b.getUTCMonth()) return `${a.getUTCDate()}-${b.getUTCDate()} ב${MONTHS[a.getUTCMonth()]} ${a.getUTCFullYear()}`;
  return `${fmtDM(ws)} - ${fmtDM(we)} ${b.getUTCFullYear()}`;
}

export function relDay(iso, base) {
  const n = diffDays(base, iso);
  if (n === 0) return 'היום';
  if (n === 1) return 'מחר';
  if (n === -1) return 'אתמול';
  if (n === 2) return 'מחרתיים';
  if (n > 0) return `בעוד ${n} ימים`;
  return `לפני ${-n} ימים`;
}

/** H:MM countdown string. */
export function hm(min) {
  min = Math.max(0, Math.round(min));
  return `${Math.floor(min / 60)}:${pad(min % 60)}`;
}
