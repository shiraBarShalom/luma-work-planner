# Phone notifications - what works today and what reliable reminders would need

Status: proposal for discussion. Nothing in sections 3-4 is implemented, and none of it will be without explicit approval.

## 1. What Luma does now (implemented)

Luma is a static, offline PWA (GitHub Pages, no server). Within that architecture it supports:

| Capability | Behavior |
|---|---|
| Detection | On iPhone/iPad, web notifications exist only for a web app **added to the Home Screen** on iOS/iPadOS 16.4 or later. In Safari tabs, or on older iOS, Settings shows a one-line explanation instead of controls. |
| Permission | Requested only when the user taps `הפעלת התראות`. Denied permission is shown honestly; the app never asks again on its own. |
| Test notification | `התראת בדיקה` shows a real system notification through the service worker. |
| Activity reminders | While Luma is open (foreground, or in the background but not yet suspended), a timer shows a notification when an activity starts. Each occurrence is announced once (notification tag + a per-day local record). |
| Privacy on the lock screen | Default text is generic (`Luma - פעילות מתחילה עכשיו`). Activity titles appear only if the user enables `להציג את שם הפעילות בהתראה`. |

Limitation (stated in the app): **reminders are sent only while Luma is open.** iOS suspends a backgrounded PWA within seconds to minutes and does not run its JavaScript timers or service worker on a schedule. There is no supported way for a web app to schedule a local notification in advance (the Notification Triggers proposal was abandoned and is not available in Safari or Chrome). In-app alerts behind the bell are not phone notifications.

## 2. Why background reminders need a server

The only web mechanism that wakes a closed PWA on iOS is **Web Push**: a server sends an encrypted message through Apple's push service (`web.push.apple.com`) at the right time, and the service worker shows it. Something outside the phone must therefore know *when* to send. Luma currently has nothing outside the phone.

## 3. Option A - the smallest possible Web Push setup

**Components**

1. In Luma: a `push` handler in `sw.js`, a "subscribe" step after permission (`pushManager.subscribe` with a VAPID public key), and an upload of the reminder schedule.
2. A tiny scheduler service, e.g. one Cloudflare Worker with a Cron Trigger (every minute) and Workers KV (or a Deno Deploy / Vercel cron function with a small KV store). It stores the push subscription and a list of `{time, tag}` items and sends due pushes signed with the VAPID private key (kept as a secret in the service, never in the app).

**What would leave the device**

- The push subscription (an opaque endpoint URL at Apple + encryption keys).
- Reminder times. To minimize exposure, send only times and opaque tags (e.g. `2026-12-01T09:00 / occ-hash`), and keep titles on the device: the service worker would show the generic text, or look up the title locally in IndexedDB when the push arrives.
- No tasks, notes, counts or backups would be sent.

**Privacy and operations**

- A third party (the hosting provider) and Apple's push service see that a device receives pushes at certain times. Payloads are end-to-end encrypted to the device.
- Needs a deploy step, a secret key, monitoring, and a way to delete the subscription (unsubscribe button + server delete).
- Offline: reminders keep working if the schedule was uploaded while online; changes made offline sync next time the app is online.
- Delivery is best effort: Apple may delay or drop pushes (e.g. Low Power Mode, Focus modes).

**Cost**

For one user, free tiers are enough (Cloudflare Workers free plan: 100k requests/day, cron triggers and KV included). Expected cost: 0. Effort: roughly a day to build and test, plus ongoing maintenance of a small service.

This conflicts with the current rule "no application server" in `CLAUDE.md`; it requires your explicit approval of the new component and of the data listed above leaving the device.

## 4. Option B - no backend: Apple Calendar

Apple Calendar fires reliable alerts on iPhone even when nothing else is running. Luma could export the schedule as an **.ics file** (or a `webcal` subscription, which would need hosting) with an alarm on each event:

- One-time export of the recurring weekly schedule as recurring events (`RRULE:FREQ=WEEKLY;BYDAY=SU,MO,TU,WE,TH`) with `VALARM` at the start time; additional one-off activities could be exported per week.
- Works fully offline and needs no server or account; nothing leaves the device except the file the user chooses to open.
- Trade-offs: the calendar copy does not update automatically when the schedule changes in Luma (the user re-exports); edits are not synced back; it duplicates the schedule in a second app.

Apple Reminders cannot be written to from a web app; a Shortcuts-based import is possible but more fragile than an .ics file.

## 5. Recommendation

If reminders while the phone is locked are essential, the backend-free **calendar export (Option B)** is the lowest-risk first step and fits Luma's privacy and offline rules. Web Push (Option A) gives in-app control but adds a server, a secret and data leaving the device; it should be considered only if Option B is not good enough.
