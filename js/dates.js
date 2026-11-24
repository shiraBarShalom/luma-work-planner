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
export const monthKey = (iso) => iso.slice(0, 7);
export function monthStart(iso) { return iso.slice(0, 8) + '01'; }
export function monthEnd(iso) {
  const y = +iso.slice(0, 4), m = +iso.slice(5, 7);
  return `${iso.slice(0, 8)}${pad(daysInMonth(y, m))}`;
}
export function addMonths(iso, n) {
  let y = +iso.slice(0, 4), m = +iso.slice(5, 7) + n;
  y += Math.floor((m - 1) / 12);
  m = ((m - 1) % 12 + 12) % 12 + 1;
  const d = Math.min(+iso.slice(8, 10), daysInMonth(y, m));
  return `${y}-${pad(m)}-${pad(d)}`;
}
export function datesBetween(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
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
export function fmtNumeric(iso) {
  const d = toUTC(iso);
  return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
}
export const fmtDayShort = (iso) => `${DAY_SHORT[weekday(iso)]} ${fmtShort(iso)}`;
export const monthLabel = (y, m) => `${MONTHS[m - 1]} ${y}`;
export function weekLabel(ws) {
  const we = addDays(ws, 6);
  const a = toUTC(ws), b = toUTC(we);
  if (a.getUTCMonth() === b.getUTCMonth()) return `${a.getUTCDate()}–${b.getUTCDate()} ב${MONTHS[a.getUTCMonth()]} ${a.getUTCFullYear()}`;
  return `${fmtDM(ws)} – ${fmtDM(we)} ${b.getUTCFullYear()}`;
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

export function dur(min) {
  min = Math.round(min);
  if (min < 60) return `${min} דק׳`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h}:${pad(m)} שע׳` : `${h} שע׳`;
}
/** H:MM countdown string. */
export function hm(min) {
  min = Math.max(0, Math.round(min));
  return `${Math.floor(min / 60)}:${pad(min % 60)}`;
}

// ---------- Hebrew calendar ----------
export function gematria(n) {
  n = Number(n) % 1000;
  const H = ['', 'ק', 'ר', 'ש', 'ת'], T = ['', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע', 'פ', 'צ'], O = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'];
  let s = '';
  let h = Math.floor(n / 100);
  while (h > 4) { s += 'ת'; h -= 4; }
  s += H[h];
  const r = n % 100;
  if (r === 15) s += 'טו';
  else if (r === 16) s += 'טז';
  else s += T[Math.floor(r / 10)] + O[r % 10];
  return s.length === 1 ? s + '׳' : s.slice(0, -1) + '״' + s.slice(-1);
}

let hebFmt;
function hebParts(iso) {
  hebFmt ||= new Intl.DateTimeFormat('he-IL-u-ca-hebrew', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' });
  const p = {};
  for (const x of hebFmt.formatToParts(toUTC(iso))) p[x.type] = x.value;
  let month = p.month || '';
  if (month.startsWith('ב') && month.length > 3) month = month.slice(1);
  return { day: parseInt(p.day, 10), month, year: parseInt(p.year || p.relatedYear, 10) };
}
export function hebrewDate(iso) {
  try {
    const { day, month, year } = hebParts(iso);
    if (!day || !month) return '';
    return `${gematria(day)} ב${month}${year ? ' ' + gematria(year) : ''}`;
  } catch {
    return '';
  }
}
export function hebrewDay(iso) {
  try {
    const d = hebParts(iso).day;
    return d ? gematria(d) : '';
  } catch {
    return '';
  }
}
