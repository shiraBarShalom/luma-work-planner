// Recurrence matching for recurring tasks and recurring calendar blocks.
// Occurrences are never materialized ahead of time: callers test dates lazily within
// bounded ranges. An occurrence's identity is (seriesId, date).
import { weekday, weekStart, diffDays, daysInMonth } from '../dates.js';

/**
 * @typedef {Object} Recurrence
 * @property {'daily'|'weekly'|'monthly'|'dayType'} kind
 * @property {number} [interval]        every N days (daily) or N weeks (weekly)
 * @property {number[]} [weekdays]       0 = Sunday (weekly)
 * @property {boolean} [workdaysOnly]    daily: only effective workdays
 * @property {number} [monthDay]         1..31 (monthly)
 * @property {'skip'|'lastDay'} [monthOverflow]
 * @property {string} [dayType]          workday|office|home|phoneDuty|nonWorking
 * @property {string} startDate
 * @property {string|null} [endDate]
 * @property {string[]} [exceptions]     dates explicitly removed from the series
 */

/**
 * @param {Recurrence} r
 * @param {string} date
 * @param {(date:string)=>{isWorking:boolean,location:string|null,phoneDuty:boolean}} dayInfo
 */
export function matchesRecurrence(r, date, dayInfo) {
  if (!r || !r.startDate || date < r.startDate) return false;
  if (r.endDate && date > r.endDate) return false;
  if (r.exceptions && r.exceptions.includes(date)) return false;
  const interval = Math.max(1, r.interval || 1);
  switch (r.kind) {
    case 'daily': {
      if (diffDays(r.startDate, date) % interval !== 0) return false;
      return r.workdaysOnly ? !!dayInfo(date).isWorking : true;
    }
    case 'weekly': {
      if (!(r.weekdays || []).includes(weekday(date))) return false;
      const weeks = Math.floor(diffDays(weekStart(r.startDate), weekStart(date)) / 7);
      return weeks % interval === 0;
    }
    case 'monthly': {
      const y = +date.slice(0, 4), m = +date.slice(5, 7), d = +date.slice(8, 10);
      const want = r.monthDay || 1;
      const last = daysInMonth(y, m);
      if (want <= last) return d === want;
      return r.monthOverflow === 'lastDay' && d === last;
    }
    case 'dayType': {
      const info = dayInfo(date);
      switch (r.dayType) {
        case 'workday': return !!info.isWorking;
        case 'office': return !!info.isWorking && info.location === 'office';
        case 'home': return !!info.isWorking && info.location === 'home';
        case 'phoneDuty': return !!info.isWorking && !!info.phoneDuty;
        case 'nonWorking': return !info.isWorking;
        default: return false;
      }
    }
    default:
      return false;
  }
}

/** Validation errors (Hebrew) for a recurrence definition; [] when valid. */
export function recurrenceErrors(r, isValidDate) {
  const errs = [];
  if (!r || typeof r !== 'object') return ['הגדרת חזרה חסרה'];
  if (!['daily', 'weekly', 'monthly', 'dayType'].includes(r.kind)) errs.push('סוג חזרה לא מוכר');
  if (!isValidDate(r.startDate)) errs.push('תאריך התחלה לא תקין');
  if (r.endDate != null && (!isValidDate(r.endDate) || r.endDate < r.startDate)) errs.push('תאריך סיום לא תקין');
  if (r.interval != null && (!Number.isInteger(r.interval) || r.interval < 1 || r.interval > 52)) errs.push('מרווח חזרה לא תקין');
  if (r.kind === 'weekly' && (!Array.isArray(r.weekdays) || !r.weekdays.length || r.weekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6))) errs.push('יש לבחור לפחות יום אחד בשבוע');
  if (r.kind === 'monthly' && (!Number.isInteger(r.monthDay) || r.monthDay < 1 || r.monthDay > 31)) errs.push('יום בחודש לא תקין');
  if (r.kind === 'dayType' && !['workday', 'office', 'home', 'phoneDuty', 'nonWorking'].includes(r.dayType)) errs.push('סוג יום לא מוכר');
  return errs;
}

export function recurrenceLabel(r) {
  if (!r) return 'חד-פעמי';
  const DN = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
  const DT = { workday: 'כל יום עבודה', office: 'ימי משרד', home: 'ימי עבודה מהבית', phoneDuty: 'ימי תורנות', nonWorking: 'ימים ללא עבודה' };
  switch (r.kind) {
    case 'daily': return (r.interval > 1 ? `כל ${r.interval} ימים` : 'כל יום') + (r.workdaysOnly ? ' (ימי עבודה)' : '');
    case 'weekly': {
      const days = (r.weekdays || []).map((d) => DN[d]).join(' ');
      return (r.interval > 1 ? `כל ${r.interval} שבועות` : 'שבועי') + `: ${days}`;
    }
    case 'monthly': return `חודשי: ב-${r.monthDay} לחודש${r.monthOverflow === 'lastDay' ? ' (או היום האחרון)' : ''}`;
    case 'dayType': return DT[r.dayType] || 'לפי סוג יום';
    default: return '';
  }
}
