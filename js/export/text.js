// Plain-text summaries built from read-only selectors (copyable/shareable). DOM-free.
import { fmtDayDate, weekLabel, fmtDM, MONTHS } from '../dates.js';
import { LOCATION_LABEL, INQUIRY_CATEGORY_LABEL } from '../data/schema.js';
import { effectiveDay } from '../engine/dayTemplates.js';
import { dayOccurrences } from '../engine/schedule.js';
import { periodReport } from '../engine/statistics.js';
import { carriedTasks, todaysTasks } from '../engine/taskCarryover.js';
import { pct } from '../engine/inquiries.js';

const ratio = (a, b) => (b ? `${a}/${b} (${pct(a, b)}%)` : `${a} (ללא יעד)`);

export function scheduleText(state, date) {
  const eff = effectiveDay(state, date);
  const lines = [`סדר היום · ${fmtDayDate(date)}`];
  lines.push(eff.isWorking ? `${LOCATION_LABEL[eff.location]} · ${eff.workStart}–${eff.workEnd}${eff.phoneDuty ? ` · תורנות טלפון ${eff.phoneStart}–${eff.phoneEnd}` : ''}` : (eff.label || 'לא יום עבודה'));
  lines.push('');
  for (const o of dayOccurrences(state, date)) if (o.status !== 'canceled') lines.push(`${o.start}–${o.end}  ${o.title}${o.status === 'done' ? ' ✓' : ''}`);
  const pri = (state.dailyPriorities[date] || []).map((id) => state.tasks.find((t) => t.id === id)).filter(Boolean);
  if (pri.length) { lines.push('', 'המשימות החשובות:'); pri.forEach((t, i) => lines.push(`${i + 1}. ${t.title}`)); }
  const carried = carriedTasks(state, date);
  if (carried.length) { lines.push('', 'משימות שלא הסתיימו עד היום:'); carried.forEach((x) => lines.push(`• ${x.task.title} (מ־${fmtDM(x.originalDate)})`)); }
  const today = todaysTasks(state, date).filter((t) => t.status !== 'done');
  if (today.length) { lines.push('', 'משימות להיום:'); today.forEach((t) => lines.push(`• ${t.title}`)); }
  return lines.join('\n');
}

export function reportText(state, from, to, asOf, label) {
  const r = periodReport(state, from, to, asOf);
  const L = [label];
  L.push('', `פניות שטופלו: ${ratio(r.inquiries.completed, r.inquiries.targetFull)}`);
  if (r.inquiries.inProgress) L.push(`עד היום: ${ratio(r.inquiries.completedElapsed, r.inquiries.targetElapsed)}`);
  L.push(`לפי סיווג: ${Object.entries(r.inquiries.completedByCategory).map(([k, v]) => `${INQUIRY_CATEGORY_LABEL[k]} ${v}`).join(', ')}`);
  L.push(`הוקצו למחר: ${r.inquiries.allocatedTomorrow} · הועברו: ${r.inquiries.transferred} · טיפול אחר: ${r.inquiries.other}`);
  const b = r.blocks;
  L.push('', `בלוקים: ${b.done} הושלמו, ${b.partial} חלקית, ${b.skipped} דולגו מתוך ${b.planned}`);
  L.push(`דקות בפועל שהוזנו: ${b.actualMinutes}${b.unknownActual ? ` (ל־${b.unknownActual} בלוקים לא הוזנו – לא ידוע)` : ''}`);
  L.push('', `משימות שהושלמו: ${r.tasksCompleted.length}`);
  r.tasksCompleted.slice(0, 30).forEach((t) => L.push(`• ${t.title}`));
  L.push(`משימות פתוחות לסוף התקופה (שחזור): ${r.tasksOpenAtEnd.length}`);
  L.push('', `שאלות שנענו: ${r.questionsAnswered.length} · החלטות: ${r.decisions.length} · פגישות: ${r.meetings.length}`);
  L.push(`נכון לעכשיו: ${r.live.openQuestions} שאלות פתוחות, ${r.live.waiting} פריטים ממתינים`);
  L.push(`ימים שנסגרו: ${r.days.closed} מתוך ${r.days.workdays} ימי עבודה`);
  return L.join('\n');
}

export const periodLabel = (period, from) => (period === 'day' ? `סיכום יומי · ${fmtDayDate(from)}` : period === 'week' ? `סיכום שבועי · ${weekLabel(from)}` : `סיכום חודשי · ${MONTHS[+from.slice(5, 7) - 1]} ${from.slice(0, 4)}`);
