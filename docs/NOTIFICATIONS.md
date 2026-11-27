# Phone notifications

**Decision (27 November 2026):** Luma stays entirely local-first. No push server, no Cloudflare, no external APIs and no remote storage, even for notifications. Privacy and security take priority over background notifications.

## 1. What Luma does (implemented)

| Capability | Behavior |
|---|---|
| Detection | On iPhone, web notifications exist only for Luma added to the Home Screen (iOS 16.4+). Otherwise Settings shows one line. |
| Permission | Requested only from a tap on `הפעלת התראות`. |
| Test | `התראת בדיקה` shows a real system notification. |
| Reminders | When an activity starts, **only while Luma is open**. iOS does not run web apps in the background, and web apps cannot schedule notifications in advance. |
| Privacy | Generic lock-screen text by default (`פעילות מתחילה עכשיו`); activity titles only if enabled. Each occurrence is announced once. |

Notifications while Luma is closed need something that iOS itself runs. Without a server, that means Apple's own apps on the phone.

## 2. Local options for the fixed Sunday-Thursday schedule

Both options below run entirely on the iPhone, work offline, cost nothing and send nothing anywhere. Neither updates automatically when the schedule changes in Luma, but the fixed schedule rarely changes. Additional one-off activities and imports are not covered and keep using the in-app reminders.

### Option A - Shortcuts time-of-day automations (recommended)

Shortcuts app → Automation → New Automation → Time of Day: set the time, Repeat: Weekly, days Sunday-Thursday, "Run Immediately". Action: **Show Notification** with the text below. One automation per change of activity:

| Time | Notification text |
|---|---|
| 08:45 | עכשיו פתיחת יום |
| 09:00 | הסתיימה פתיחת יום - עכשיו מענה לטלפונים ולפניות ב-CRM |
| 13:00 | הסתיים זמן המענה לפניות - עכשיו הפסקה |
| 14:00 | הסתיימה ההפסקה - עכשיו זמן קבלה לשאלות הצוות |
| 14:15 | הפעילות הבאה - חזרה טלפונית לפונים |
| 14:30 | עכשיו טיפול במיילים |
| 15:45 | עכשיו הקצאת פניות לצוות למחר |
| 16:15 | עכשיו סגירת יום |

- Works when Luma is closed, the phone is locked or another app is open; works without internet.
- Recurring: yes (weekdays). Duplicates: none; each automation fires once at its time.
- Outdated reminders: if the fixed schedule changes, edit the matching automations by hand.
- Manual work: creating 8 automations once (about 10 minutes).
- Privacy: the text stays on the phone. It appears on the lock screen as written, so use generic wording if the phone is often visible to others.
- Limits: Israeli holidays and days off still fire unless the automations are paused; Focus modes can silence them.

### Option B - Apple Calendar events with alerts

Create the 8 activities in Calendar as events repeating weekly on Sunday-Thursday, each with an alert "At time of event". A calendar stored "On My iPhone" stays on the device; an iCloud calendar is synced to Apple's servers.

- Works closed, locked and offline; recurring; no duplicates once created.
- Manual work: creating 8 recurring events once; editing them if the schedule changes. A holiday can be handled by deleting that day's events.
- The notification shows the event title and time, not a combined "ended - now" sentence (unless the event is titled that way).

**Possible later feature (not implemented, needs approval):** a button in Luma that saves the fixed schedule as a calendar file (`.ics`, weekly Sunday-Thursday events with alerts), created on the phone without any network. The user opens it once to add the events. Re-importing after a change would add a second copy, so old events must be deleted first.

## 3. Recommendation

Use **Option A (Shortcuts)**. It matches the requested notification text exactly, runs reliably with Luma closed, and keeps everything on the phone. Keep Luma's in-app reminders on for anything added during the day. Reconsider the calendar-file button only if setting up the automations by hand proves too tedious.

## 4. Options not taken

- **Web Push via a small scheduler (e.g. Cloudflare Worker):** would update automatically, but requires a server and sends a push address and activity times off the device. Rejected by decision.
- **Apple Reminders:** no web API; Shortcuts-based imports create duplicates and are fragile.
- **Native iPhone app with local notifications:** requires a Mac, Xcode and a paid Apple Developer membership, and leaves the PWA architecture.
