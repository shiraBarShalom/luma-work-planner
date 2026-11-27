// Phone notifications within what a static, offline PWA can honestly do.
//  - Capability detection (iPhone needs Luma added to the Home Screen, iOS 16.4+).
//  - Permission is requested only from an explicit tap.
//  - A test notification, shown through the service worker when available.
//  - Activity-start reminders scheduled with timers *while Luma is open*. When the app is
//    closed or suspended in the background, the system does not run these timers, so no
//    reminder is sent then. Reliable background delivery needs Web Push from a server,
//    which Luma does not use (see docs/NOTIFICATIONS.md).
//  - Each reminder is sent at most once per occurrence (tag + local record), and the
//    lock-screen text is generic unless the user chose to show activity titles.
import { LS_PREFIX } from './config.js';
import { zonedParts } from './dates.js';
import { clock } from './clock.js';
import { dayOccurrences } from './engine/schedule.js';

const SENT_KEY = LS_PREFIX + 'notified';
const LATE_GRACE_MIN = 2; // a reminder missed while suspended is dropped, not sent late

/** @returns {{status:'granted'|'default'|'denied'|'needsInstall'|'unsupported', ios:boolean, standalone:boolean}} */
export function notificationSupport() {
  const ua = navigator.userAgent || '';
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = !!(window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true);
  if (!('Notification' in window)) return { status: ios && !standalone ? 'needsInstall' : 'unsupported', ios, standalone };
  return { status: Notification.permission, ios, standalone };
}

/** Must be called from a user gesture. Resolves to the resulting permission. */
export async function requestNotificationPermission() {
  if (!('Notification' in window)) return 'unsupported';
  try { return await Notification.requestPermission(); } catch { return Notification.permission; }
}

/** Show a notification now. Resolves true only if the browser accepted it. */
export async function showNotification(title, body, tag) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return false;
  const opts = { body, tag, lang: 'he', dir: 'rtl', icon: 'icons/icon-192.png', badge: 'icons/favicon-32.png' };
  try {
    const reg = await navigator.serviceWorker?.getRegistration?.();
    if (reg?.showNotification) { await reg.showNotification(title, opts); return true; }
    new Notification(title, opts);
    return true;
  } catch { return false; }
}

function sentLog() {
  try { return JSON.parse(localStorage.getItem(SENT_KEY) || '{}') || {}; } catch { return {}; }
}
function markSent(date, occId) {
  const log = sentLog();
  for (const d of Object.keys(log)) if (d < date) delete log[d]; // keep only today
  (log[date] ||= []).includes(occId) || log[date].push(occId);
  try { localStorage.setItem(SENT_KEY, JSON.stringify(log)); } catch { /* best effort */ }
}
const wasSent = (date, occId) => (sentLog()[date] || []).includes(occId);

/** The text shown for an activity reminder (generic unless details are enabled). */
export function reminderText(o, showDetails) {
  return showDetails ? { title: o.title, body: `מתחילה עכשיו · ${o.start}-${o.end}` } : { title: 'Luma', body: 'פעילות מתחילה עכשיו' };
}

let timer = null;
/**
 * (Re)schedule the next activity-start reminder for today. Safe to call often.
 * @param {() => Object} getState
 */
export function scheduleReminders(getState) {
  clearTimeout(timer);
  timer = null;
  const state = getState();
  const prefs = state?.settings?.notifications;
  if (!prefs?.activityStart || !('Notification' in window) || Notification.permission !== 'granted') return;
  const now = zonedParts(clock.now());
  const occs = dayOccurrences(state, now.date).filter((o) => o.status === 'planned' && !wasSent(now.date, o.id));
  // Something that started a moment ago (e.g. the page just resumed) is still announced once.
  const due = occs.find((o) => o.s <= now.min && now.min - o.s <= LATE_GRACE_MIN);
  if (due) {
    markSent(now.date, due.id);
    const t = reminderText(due, prefs.showDetails);
    showNotification(t.title, t.body, `luma-${due.id}`);
  }
  const next = occs.find((o) => o.s > now.min);
  if (!next) return;
  const ms = ((next.s - now.min) * 60 - now.sec) * 1000;
  timer = setTimeout(() => scheduleReminders(getState), Math.max(1000, ms));
}
