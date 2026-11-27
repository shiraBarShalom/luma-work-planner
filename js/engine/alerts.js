// In-app reminders listed behind the bell: task deadlines that passed, are today or
// tomorrow, and a backup reminder. Derived on demand; nothing is stored.
import { diffDays, fmtDM } from '../dates.js';
import { openDeadlines } from './taskCarryover.js';

/** @returns {Array<{key:string, level:'danger'|'warn'|'info', title:string, detail:string, route:string}>} */
export function computeAlerts(state, date, { nowIso = null } = {}) {
  const out = [];
  for (const t of openDeadlines(state)) {
    const n = diffDays(date, t.deadline);
    if (n < 0) out.push({ key: `overdue:${t.id}`, level: 'danger', title: t.title, detail: `מועד היעד עבר · ${fmtDM(t.deadline)}`, route: `#/task/${t.id}` });
    else if (n <= 1) out.push({ key: `deadline:${t.id}`, level: 'warn', title: t.title, detail: n === 0 ? 'מועד יעד היום' : 'מועד יעד מחר', route: `#/task/${t.id}` });
  }
  const days = state.settings.backup.reminderDays;
  if (days > 0 && nowIso) {
    const last = state.settings.backup.lastExportAt;
    const hasData = state.tasks.length > 0 || Object.keys(state.inquiryCounts || {}).length > 0;
    const age = last ? Math.floor((Date.parse(nowIso) - Date.parse(last)) / 86400000) : null;
    if (hasData && (age === null || age >= days)) {
      out.push({ key: 'backup', level: 'info', title: 'כדאי לשמור גיבוי', detail: last ? `הגיבוי האחרון לפני ${age} ימים` : 'עדיין לא נשמר גיבוי', route: '#/settings/backup' });
    }
  }
  const rank = { danger: 0, warn: 1, info: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}
