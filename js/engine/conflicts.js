// Actionable alerts: overlaps, capacity, deadlines, clustered deadlines, due follow-ups,
// work beyond configured hours, blocks on non-working days, unresolved meetings, missing
// day close (informational) and backup reminder. Each alert has a stable key so a
// dismissal hides it for that date only (no noisy repeats, nothing silently lost).
import { addDays, diffDays, fmtDM, toMin } from '../dates.js';
import { effectiveDay, routineBlocks, prevWorkday } from './dayTemplates.js';
import { dayOccurrences, overlapPairs } from './schedule.js';
import { carriedTasks, todaysTasks, openDeadlines } from './taskCarryover.js';
import { dueFollowUps } from './workTools.js';
import { unscheduledMeetings } from './team.js';

/** Minutes a block can still hold after subtracting assigned task estimates. */
export function blockCapacity(state, occ) {
  const byId = new Map(state.tasks.map((t) => [t.id, t]));
  const assigned = occ.taskIds.map((id) => byId.get(id)).filter((t) => t && t.status !== 'done' && t.status !== 'canceled');
  const used = assigned.reduce((a, t) => a + (Number.isInteger(t.estimateMinutes) ? t.estimateMinutes : 0), 0);
  return { length: occ.e - occ.s, used, free: occ.e - occ.s - used, unknown: assigned.filter((t) => !Number.isInteger(t.estimateMinutes)).length };
}

/** Free work minutes on a date from `fromMinute`, excluding protected blocks and meetings. */
export function remainingWorkMinutes(state, date, fromMinute = 0) {
  const eff = effectiveDay(state, date);
  if (!eff.isWorking) return 0;
  const occs = dayOccurrences(state, date).filter((o) => o.status !== 'canceled' && o.status !== 'skipped');
  const start = Math.max(toMin(eff.workStart), fromMinute), end = toMin(eff.workEnd);
  let mins = 0;
  for (let m = start; m < end; m += 5) {
    const busy = occs.some((o) => (o.protected || o.kind === 'meeting' || o.status === 'done') && o.s <= m && m < o.e);
    if (!busy) mins += 5;
  }
  return mins;
}

export function computeAlerts(state, date, { minute = 0, nowIso = null } = {}) {
  const out = [];
  const st = state.settings;
  const add = (a) => { if (state.alertDismissals[a.key] !== date) out.push(a); };
  const eff = effectiveDay(state, date);

  // Schedule conflicts for today and the coming week.
  for (let i = 0; i < 7; i++) {
    const d = addDays(date, i);
    const occs = dayOccurrences(state, d);
    for (const [a, b] of overlapPairs(occs)) {
      const severe = a.kind === 'meeting' || b.kind === 'meeting' || a.protected || b.protected;
      add({ key: `overlap:${a.id}|${b.id}`, level: severe ? 'danger' : 'warn', type: 'overlap', date: d,
        title: `חפיפה בלו״ז · ${fmtDM(d)}`, detail: `${a.title} (${a.start}–${a.end}) חופף ל־${b.title} (${b.start}–${b.end})`, route: `#/agenda/${d}` });
    }
    for (const o of occs) {
      if (o.offDay && o.status !== 'canceled') add({ key: `offday:${o.id}`, level: 'warn', type: 'offDay', date: d, title: `פעילות ביום שאינו יום עבודה · ${fmtDM(d)}`, detail: `${o.title} נשמרה לבדיקה`, route: `#/agenda/${d}` });
      else if (o.outsideHours && o.status !== 'canceled' && i < 2) add({ key: `outside:${o.id}`, level: 'info', type: 'outsideHours', date: d, title: 'פעילות מחוץ לשעות העבודה', detail: `${o.title} (${o.start}–${o.end})`, route: `#/agenda/${d}` });
      if (i === 0 && o.taskIds.length) {
        const cap = blockCapacity(state, o);
        if (cap.free < 0) add({ key: `blockcap:${o.id}`, level: 'warn', type: 'blockCapacity', date: d, title: `המשימות ב״${o.title}״ חורגות מהזמן`, detail: `${cap.used} דק׳ משימות בבלוק של ${cap.length} דק׳`, route: `#/agenda/${d}` });
      }
    }
    const sup = routineBlocks(state, d).suppressed;
    if (sup.length && i < 7) add({ key: `suppressed:${d}`, level: 'info', type: 'suppressed', date: d, title: `יום מקוצר · ${fmtDM(d)}`, detail: `לא נכנסו: ${sup.map((b) => b.title).join(', ')}`, route: `#/agenda/${d}` });
  }

  // Day capacity.
  if (eff.isWorking) {
    const open = [...carriedTasks(state, date).map((x) => x.task), ...todaysTasks(state, date).filter((t) => t.status !== 'done')];
    const est = open.reduce((a, t) => a + (Number.isInteger(t.estimateMinutes) ? t.estimateMinutes : 0), 0);
    const free = remainingWorkMinutes(state, date, minute);
    if (est > free) add({ key: `daycap:${date}`, level: 'warn', type: 'dayCapacity', date, title: 'יותר משימות מהזמן שנותר היום', detail: `הערכה ${est} דק׳ מול כ־${free} דק׳ פנויות`, route: '#/tasks/today' });
  }

  // Deadlines.
  const dl = openDeadlines(state);
  const soon = st.planner.deadlineSoonDays ?? 2;
  for (const t of dl) {
    const n = diffDays(date, t.deadline);
    if (n < 0) add({ key: `overdue:${t.id}`, level: 'danger', type: 'deadlineOverdue', date, title: 'מועד יעד עבר', detail: `${t.title} · ${fmtDM(t.deadline)}`, route: `#/task/${t.id}` });
    else if (n <= soon) add({ key: `deadline:${t.id}:${date}`, level: 'warn', type: 'deadlineSoon', date, title: n === 0 ? 'מועד יעד היום' : n === 1 ? 'מועד יעד מחר' : `מועד יעד בעוד ${n} ימים`, detail: t.title, route: `#/task/${t.id}` });
  }
  const window = st.planner.clusterDays ?? 3, count = st.planner.clusterCount ?? 3;
  const upcoming = dl.filter((t) => t.deadline >= date && diffDays(date, t.deadline) <= 14).map((t) => t.deadline).sort();
  for (let i = 0; i + count - 1 < upcoming.length; i++) {
    if (diffDays(upcoming[i], upcoming[i + count - 1]) < window) {
      add({ key: `cluster:${upcoming[i]}`, level: 'warn', type: 'deadlineCluster', date, title: 'כמה מועדי יעד צפופים', detail: `${count}+ מועדים בין ${fmtDM(upcoming[i])} ל־${fmtDM(upcoming[i + count - 1])}`, route: '#/tasks/upcoming' });
      break;
    }
  }

  // Waiting follow-ups.
  for (const w of dueFollowUps(state, date)) {
    add({ key: `followup:${w.type}:${w.id}:${date}`, level: w.followUpOn < date ? 'warn' : 'info', type: 'followUp', date, title: w.followUpOn < date ? 'מעקב באיחור' : 'מעקב להיום', detail: w.title, route: '#/tools/waiting' });
  }

  // Meetings missing date/time/duration.
  for (const m of unscheduledMeetings(state, date)) {
    if (m.date && m.start) add({ key: `meeting-incomplete:${m.id}`, level: 'warn', type: 'meetingIncomplete', date, title: 'לפגישה חסר משך', detail: `${m.title} · יש להשלים שעת סיום או משך כדי לשבץ ביומן`, route: `#/meeting/${m.id}` });
  }

  // Missing day close (informational only; carryover never depends on it).
  const prev = prevWorkday(state, date, 14);
  const since = String(state.metadata.createdAt || '').slice(0, 10);
  if (prev && prev >= since && !state.dailyReports[prev]?.closedAt && diffDays(prev, date) <= 7) {
    add({ key: `unclosed:${prev}`, level: 'info', type: 'unclosed', date, title: 'יום העבודה הקודם לא נסגר', detail: `${fmtDM(prev)} · אפשר לסגור בדיעבד. משימות פתוחות הועברו בכל מקרה.`, route: `#/closing/${prev}` });
  }

  // Backup reminder.
  const days = st.backup.reminderDays;
  if (days > 0 && nowIso) {
    const last = st.backup.lastExportAt;
    const hasData = state.tasks.length + state.inquiryLogs.length + state.questions.length > 0;
    const age = last ? Math.floor((Date.parse(nowIso) - Date.parse(last)) / 86400000) : null;
    if (hasData && (age === null || age >= days)) {
      add({ key: `backup:${date}`, level: 'info', type: 'backup', date, title: 'כדאי לשמור גיבוי', detail: last ? `הגיבוי האחרון הוכן לפני ${age} ימים` : 'עדיין לא הוכן קובץ גיבוי', route: '#/settings/backup' });
    }
  }

  const rank = { danger: 0, warn: 1, info: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}
