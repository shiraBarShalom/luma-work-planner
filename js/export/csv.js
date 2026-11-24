// CSV export with spreadsheet formula-injection protection. Pure; DOM-free.
import { TASK_STATUS_LABEL, PRIORITY_LABEL, INQUIRY_KIND_LABEL, INQUIRY_CATEGORY_LABEL } from '../data/schema.js';

const FORMULA = /^[=+\-@\t\r]/;

export function csvCell(v) {
  if (v == null) return '';
  let s = String(v);
  if (FORMULA.test(s)) s = "'" + s;
  if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

/** UTF-8 BOM so spreadsheet apps read Hebrew correctly; CRLF line endings. */
export function toCsv(header, rows) {
  return '﻿' + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
}

export function tasksCsv(state) {
  const cat = (id) => state.settings.categories.find((c) => c.id === id)?.label || '';
  return toCsv(
    ['כותרת', 'סטטוס', 'עדיפות', 'קטגוריה', 'תאריך ביצוע', 'תאריך מקורי', 'מועד יעד', 'הערכה (דק׳)', 'בפועל (דק׳)', 'תתי־משימות שהושלמו', 'הושלמה בתאריך'],
    state.tasks.map((t) => [t.title, TASK_STATUS_LABEL[t.status], PRIORITY_LABEL[t.priority], cat(t.categoryId), t.scheduledDate, t.originalScheduledDate, t.deadline, t.estimateMinutes, t.actualMinutes,
      t.subtasks.length ? `${t.subtasks.filter((s) => s.done).length}/${t.subtasks.length}` : '', t.completedOn]),
  );
}

/** Aggregate inquiry events only (no case data exists in Luma). */
export function inquiriesCsv(state) {
  const rows = state.inquiryLogs.slice().sort((a, b) => a.workDate.localeCompare(b.workDate) || a.at.localeCompare(b.at))
    .map((e) => [e.workDate, INQUIRY_KIND_LABEL[e.kind], INQUIRY_CATEGORY_LABEL[e.category], e.quantity, e.correctsId ? 'תיקון' : '', e.at]);
  return toCsv(['תאריך עבודה', 'סוג', 'סיווג', 'כמות', 'תיקון', 'נרשם (UTC)'], rows);
}

export function faqCsv(state) {
  return toCsv(['כותרת', 'תשובה', 'מילות מפתח', 'בארכיון', 'עודכן'],
    state.faqEntries.map((f) => [f.title, f.answer, f.keywords.join(', '), f.archived ? 'כן' : '', f.updatedAt]));
}

export function faqJson(state) {
  return JSON.stringify({ format: 'luma-faq-export', version: 1, entries: state.faqEntries.filter((f) => !f.archived).map((f) => ({ title: f.title, answer: f.answer, keywords: f.keywords })) }, null, 2);
}
