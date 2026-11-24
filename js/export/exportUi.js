// Export flows with previews and privacy notices. Exports read selectors only.
import { h, btn, openSheet, toast } from '../ui.js';
import { S, run, nowCtx } from '../app.js';
import { fmtDayDate, weekLabel, weekDates, DAY_NAMES, weekday, fmtDM, addDays } from '../dates.js';
import { renderDayImages, renderWeekImages, renderSummaryImage } from './image.js';
import { shareOrDownload, downloadBlob, copyText } from './share.js';
import { tasksCsv, inquiriesCsv, faqCsv, faqJson } from './csv.js';
import { scheduleText } from './text.js';
import { printContent, textBlock } from './print.js';
import { dayOccurrences } from '../engine/schedule.js';
import { effectiveDay } from '../engine/dayTemplates.js';
import { createBackup, backupFileName } from '../data/backup.js';
import { LOCATION_LABEL } from '../data/schema.js';

export const PRIVACY_NOTE = 'לפני שיתוף מחוץ למכשיר: לוודא שאין בקובץ פרטים מזהים, מידע על פונים או מידע ארגוני רגיש.';

async function imagePreview(title, blobs, baseName) {
  const urls = blobs.map((b) => URL.createObjectURL(b));
  const sh = openSheet({
    title,
    body: [h('p.muted.small', PRIVACY_NOTE), blobs.length > 1 ? h('p.small', `${blobs.length} תמונות (התוכן ארוך ולכן חולק לעמודים)`) : null,
      urls.map((u, i) => h('img', { src: u, alt: `${title} – עמוד ${i + 1}`, style: { width: '100%', borderRadius: '12px', border: '1px solid var(--border)' } }))],
    footer: [btn('שיתוף / שמירה', async () => {
      const r = await shareOrDownload(blobs.map((b, i) => ({ blob: b, name: `${baseName}${blobs.length > 1 ? `-${i + 1}` : ''}.png` })), { title });
      if (r === 'shared' || r === 'downloaded') sh.close(true);
    }, 'primary', 'share')],
    onClose: () => setTimeout(() => urls.forEach((u) => URL.revokeObjectURL(u)), 1000),
  });
}

export async function exportDayImage(date) {
  try {
    const blobs = await renderDayImages(S(), date, { tomorrow: date === addDays(nowCtx().date, 1) });
    if (blobs.some((b) => !b)) throw new Error('canvas');
    imagePreview(`סדר היום · ${fmtDayDate(date)}`, blobs, `luma-day-${date}`);
  } catch { toast('יצירת התמונה נכשלה בדפדפן הזה. אפשר להשתמש בהדפסה או בהעתקת טקסט.', { error: true }); }
}
export async function exportWeekImage(ws) {
  try { imagePreview(`השבוע · ${weekLabel(ws)}`, await renderWeekImages(S(), ws), `luma-week-${ws}`); }
  catch { toast('יצירת התמונה נכשלה', { error: true }); }
}
export async function exportSummaryImage(date) {
  try { imagePreview(`סיכום יום · ${fmtDayDate(date)}`, await renderSummaryImage(S(), date), `luma-summary-${date}`); }
  catch { toast('יצירת התמונה נכשלה', { error: true }); }
}

export function printDay(date) { printContent(`סדר היום · ${fmtDayDate(date)}`, textBlock(scheduleText(S(), date))); }
export function copyDay(date) { return copyText(scheduleText(S(), date)); }

export function printWeek(ws) {
  const state = S();
  const days = weekDates(ws);
  const max = Math.max(1, ...days.map((d) => dayOccurrences(state, d).filter((o) => o.status !== 'canceled').length));
  const table = h('table', h('thead', h('tr', days.map((d) => { const e = effectiveDay(state, d); return h('th', `${DAY_NAMES[weekday(d)]} ${fmtDM(d)}`, h('br'), e.isWorking ? LOCATION_LABEL[e.location] : (e.label || 'חופש')); }))),
    h('tbody', Array.from({ length: max }, (_, i) => h('tr', days.map((d) => { const o = dayOccurrences(state, d).filter((x) => x.status !== 'canceled')[i]; return h('td.avoid', o ? [h('b', `${o.start}–${o.end}`), h('br'), o.title] : ''); })))));
  printContent(`השבוע · ${weekLabel(ws)}`, table);
}

export function printReport(title, text) { printContent(title, textBlock(text)); }

const csvBlob = (s) => new Blob([s], { type: 'text/csv;charset=utf-8' });
export async function exportTasksCsv() { await shareOrDownload([{ blob: csvBlob(tasksCsv(S())), name: `luma-tasks-${nowCtx().date}.csv` }], { title: 'משימות' }); }
export async function exportInquiriesCsv() { await shareOrDownload([{ blob: csvBlob(inquiriesCsv(S())), name: `luma-inquiries-${nowCtx().date}.csv` }], { title: 'היסטוריית פניות' }); }
export async function exportFaqCsv() { await shareOrDownload([{ blob: csvBlob(faqCsv(S())), name: `luma-faq-${nowCtx().date}.csv` }], { title: 'תשובות נפוצות' }); }
export async function exportFaqJson() { await shareOrDownload([{ blob: new Blob([faqJson(S())], { type: 'application/json' }), name: `luma-faq-${nowCtx().date}.json` }], { title: 'תשובות נפוצות' }); }

/** Full backup. Records the export only once the file was shared or handed to the browser. */
export async function exportBackup() {
  const state = S();
  const text = JSON.stringify(createBackup(state, new Date().toISOString()), null, 1);
  const name = backupFileName(nowCtx().date);
  const r = await shareOrDownload([{ blob: new Blob([text], { type: 'application/json' }), name }], { title: 'גיבוי Luma' });
  if (r === 'shared' || r === 'downloaded') await run('markBackupExported', { kind: r }, { silent: true });
  return r;
}
export { downloadBlob };
