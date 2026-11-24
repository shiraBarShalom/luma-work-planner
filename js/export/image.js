// Designed 1080×1920 PNG exports on Canvas (RTL Hebrew, local font, no quotes).
// Content is laid out as measured items and paginated – long schedules continue on
// additional images instead of being clipped. Adapted from the planner's canvas exporter.
import { fmtDayDate, hebrewDate, weekLabel, weekDates, fmtDM, DAY_NAMES, weekday } from '../dates.js';
import { LOCATION_LABEL } from '../data/schema.js';
import { effectiveDay } from '../engine/dayTemplates.js';
import { dayOccurrences } from '../engine/schedule.js';
import { carriedTasks, todaysTasks } from '../engine/taskCarryover.js';
import { dayTotals, effectiveTarget } from '../engine/inquiries.js';
import { closingSummary } from '../engine/dayClosing.js';

const W = 1080, H = 1920, M = 80, TOP = 330, BOTTOM = H - 130;
const FONT = '"Noto Sans Hebrew", Arial, sans-serif';
const T = { bg: '#F4F0EF', card: '#FAF7F5', ink: '#102746', muted: '#526273', primary: '#286C96', soft: '#D2E5F4', line: '#E5E4E7', champagne: '#F0D9B8' };

async function ensureFonts() {
  if (!document.fonts) return;
  try {
    await Promise.race([Promise.all(['400', '600', '700'].map((w) => document.fonts.load(`${w} 40px ${FONT}`, 'אבג 0123'))), new Promise((r) => setTimeout(r, 2500))]);
  } catch { /* system fallback */ }
}

function rr(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r);
  c.closePath();
}
function fit(c, text, max) {
  text = String(text);
  if (c.measureText(text).width <= max) return text;
  let lo = 0, hi = text.length;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (c.measureText(text.slice(0, mid) + '…').width <= max) lo = mid; else hi = mid - 1; }
  return text.slice(0, lo) + '…';
}
function txt(c, s, x, y, font, color, align = 'right') {
  c.font = font; c.fillStyle = color; c.textAlign = align;
  c.fillText(s, x, y);
}

const section = (title) => ({ h: 96, keep: true, draw: (c, y) => {
  txt(c, title, W - M, y + 62, `700 40px ${FONT}`, T.primary);
  c.fillStyle = T.champagne; rr(c, W - M - 90, y + 78, 90, 6, 3); c.fill();
} });
const line = (text, { right = '', left = '', color = T.ink, bold = false, h = 66, dot = null } = {}) => ({ h, draw: (c, y) => {
  const mid = y + h / 2 + 12;
  let x = W - M;
  if (dot) { c.fillStyle = dot; c.beginPath(); c.arc(x - 9, mid - 11, 9, 0, Math.PI * 2); c.fill(); x -= 34; }
  if (right) { txt(c, right, x, mid, `600 32px ${FONT}`, T.primary); c.font = `600 32px ${FONT}`; x -= c.measureText(right).width + 26; }
  c.font = `400 26px ${FONT}`;
  const lw = left ? c.measureText(left).width + 24 : 0;
  if (left) txt(c, left, M, mid, `400 26px ${FONT}`, T.muted, 'left');
  c.font = `${bold ? 600 : 400} 33px ${FONT}`;
  txt(c, fit(c, text, x - M - lw), x, mid, `${bold ? 600 : 400} 33px ${FONT}`, color);
  c.strokeStyle = T.line; c.lineWidth = 2; c.beginPath(); c.moveTo(W - M, y + h); c.lineTo(M, y + h); c.stroke();
} });

async function paint(header, items, sub = '') {
  await ensureFonts();
  const pages = [];
  let cur = [], y = TOP;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const need = it.keep && items[i + 1] ? it.h + items[i + 1].h : it.h;
    if (y + need > BOTTOM && cur.length) { pages.push(cur); cur = []; y = TOP; }
    cur.push({ it, y });
    y += it.h;
  }
  if (cur.length || !pages.length) pages.push(cur);
  const blobs = [];
  for (let p = 0; p < pages.length; p++) {
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const c = cv.getContext('2d');
    try { c.direction = 'rtl'; } catch { /* older engines */ }
    c.fillStyle = T.bg; c.fillRect(0, 0, W, H);
    c.fillStyle = T.card; rr(c, 40, 40, W - 80, H - 80, 44); c.fill();
    c.fillStyle = T.soft; rr(c, 40, 40, W - 80, 230, 44); c.fill(); c.fillRect(40, 200, W - 80, 70);
    c.save(); c.direction = 'ltr'; txt(c, 'Luma', M, 130, `600 44px ${FONT}`, T.primary, 'left'); c.restore();
    txt(c, header, W - M, 150, `700 54px ${FONT}`, T.ink);
    if (sub) txt(c, fit(c, sub, W - 2 * M), W - M, 222, `400 30px ${FONT}`, T.muted);
    for (const row of pages[p]) row.it.draw(c, row.y);
    if (!pages[p].length) txt(c, 'אין פריטים להצגה', W / 2, TOP + 120, `400 34px ${FONT}`, T.muted, 'center');
    if (pages.length > 1) txt(c, `עמוד ${p + 1} מתוך ${pages.length}`, W / 2, H - 76, `400 26px ${FONT}`, T.muted, 'center');
    blobs.push(await new Promise((r) => cv.toBlob(r, 'image/png')));
  }
  return blobs;
}

export function dayItems(state, date) {
  const items = [];
  const eff = effectiveDay(state, date);
  const cat = (id) => state.settings.categories.find((c) => c.id === id)?.color || T.muted;
  const occ = dayOccurrences(state, date).filter((o) => o.status !== 'canceled');
  items.push(section('סדר היום'));
  if (!occ.length) items.push(line(eff.isWorking ? 'אין פעילויות מתוכננות' : 'לא יום עבודה', { color: T.muted }));
  for (const o of occ) items.push(line(o.title + (o.status === 'done' ? ' ✓' : ''), { right: `${o.start}–${o.end}`, dot: o.kind === 'meeting' ? cat('meeting') : cat(o.categoryId), bold: o.kind === 'meeting' }));
  const pri = (state.dailyPriorities[date] || []).map((id) => state.tasks.find((t) => t.id === id)).filter(Boolean);
  if (pri.length) { items.push(section('3 המשימות החשובות')); pri.forEach((t, i) => items.push(line(t.title, { right: `${i + 1}.`, bold: true }))); }
  const carried = carriedTasks(state, date);
  if (carried.length) { items.push(section('משימות שלא הסתיימו עד היום')); carried.forEach((x) => items.push(line(x.task.title, { left: `מ־${fmtDM(x.originalDate)}` }))); }
  const today = todaysTasks(state, date).filter((t) => t.status !== 'done');
  if (today.length) { items.push(section('משימות להיום')); today.forEach((t) => items.push(line(t.title, { left: t.deadline ? `יעד ${fmtDM(t.deadline)}` : '' }))); }
  return items;
}

export function renderDayImages(state, date, { tomorrow = false } = {}) {
  const eff = effectiveDay(state, date);
  const sub = [hebrewDate(date), eff.isWorking ? LOCATION_LABEL[eff.location] : (eff.label || 'לא יום עבודה'), eff.phoneDuty ? `תורנות ${eff.phoneStart}–${eff.phoneEnd}` : ''].filter(Boolean).join(' · ');
  return paint(`${tomorrow ? 'מחר · ' : ''}${fmtDayDate(date)}`, dayItems(state, date), sub);
}

export function renderWeekImages(state, ws) {
  const items = [];
  const cat = (id) => state.settings.categories.find((c) => c.id === id)?.color || T.muted;
  for (const d of weekDates(ws)) {
    const eff = effectiveDay(state, d);
    items.push(section(`${DAY_NAMES[weekday(d)]} ${fmtDM(d)}${eff.isWorking ? ` · ${LOCATION_LABEL[eff.location]}` : ''}`));
    const occ = dayOccurrences(state, d).filter((o) => o.status !== 'canceled');
    if (!eff.isWorking && !occ.length) { items.push(line(eff.label || 'לא יום עבודה', { color: T.muted, h: 56 })); continue; }
    for (const o of occ) items.push(line(o.title, { right: `${o.start}–${o.end}`, dot: o.kind === 'meeting' ? cat('meeting') : cat(o.categoryId), h: 58 }));
  }
  return paint(`השבוע · ${weekLabel(ws)}`, items);
}

export function renderSummaryImage(state, date) {
  const s = closingSummary(state, date);
  const t = dayTotals(state, date), tg = effectiveTarget(state, date);
  const items = [section('פניות'), line(`${t.completed}${tg.target ? ` מתוך ${tg.target}` : ' (ללא יעד)'}`, { bold: true }),
    line(`הוקצו למחר ${t.allocatedTomorrow} · הועברו ${t.transferred}`, { color: T.muted }),
    section('בלוקים'), line(`${s.blocks.done} הושלמו · ${s.blocks.partial} חלקית מתוך ${s.blocks.total}`),
    section('משימות שהושלמו')];
  if (!s.tasks.completedToday.length) items.push(line('—', { color: T.muted }));
  s.tasks.completedToday.forEach((x) => items.push(line(x.title)));
  const open = s.tasks.openCarried.length + s.tasks.openToday.length;
  items.push(section('עבודה פתוחה'), line(`${open} משימות פתוחות יעברו ליום העבודה הבא`, { color: T.muted }));
  return paint(`סיכום יום · ${fmtDayDate(date)}`, items, hebrewDate(date));
}
