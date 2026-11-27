# Phone notifications - options and recommendation

Status: recommendation awaiting approval. Only section 1 is implemented. Nothing in sections 3-5 will be built without explicit approval.

Goal: when one activity ends and the next begins, the iPhone shows a notification such as `13:00 הסתיים זמן המענה לפניות - עכשיו הפסקה`, even when Luma is closed, the phone is locked or another app is open. The user should set this up once, and schedule edits and JSON imports should update the notifications automatically.

## 1. What Luma does today

| Capability | Behavior |
|---|---|
| Detection | Web notifications exist on iPhone only for a web app added to the Home Screen (iOS 16.4+). Otherwise Settings shows one line instead of controls. |
| Permission | Requested only from a tap on `הפעלת התראות`. |
| Test | `התראת בדיקה` shows a real system notification through the service worker. |
| Reminders | Activity-start reminders run on timers **only while Luma is open**. iOS suspends a backgrounded web app and runs no timers or service worker on a schedule, and there is no web API to schedule a local notification in advance. |

So the requirement cannot be met with the current local-only code. Something outside the app has to fire at the right time.

## 2. The options

### A. Apple Calendar (.ics)

Luma would export the schedule as calendar events, each with an alert at its start time ("הסתיים X - עכשיו Y" can be the event title).

- **One-time file import:** the user opens an exported .ics file and adds the events to Calendar.
- **Subscription (webcal):** Calendar polls a URL. Luma has no server, so this would need a hosted, per-user, always-current file, which means a server anyway. A static file on GitHub Pages would be public and only change on deploys.

| Question | Answer |
|---|---|
| Works when Luma is closed | Yes. Calendar alerts are delivered by iOS itself. |
| Works without internet | Yes (file import). |
| Schedule changes and imports update automatically | No for a file import: every change needs a new export and import. A subscription refreshes on iOS's own schedule (not under our control) and needs a server. |
| Recurring activities | Yes (`RRULE` weekly Sun-Thu). |
| Duplicates and outdated alerts | Not preventable from Luma: re-importing a file adds events again, and old events must be deleted by hand in Calendar. |
| Manual actions | Export and import after every schedule change; delete outdated events. Check that alerts are not disabled for that calendar. |
| Privacy | Excellent for file import: nothing leaves the phone. The schedule also appears in Calendar (and in iCloud if that calendar syncs). |
| Infrastructure / cost | None / free. |
| Complexity / reliability | Low to build; very reliable delivery; poor maintenance experience. |

### B. Apple Reminders

There is no web API to create reminders. It would go through a Shortcuts shortcut that reads a file exported by Luma and creates reminders.

| Question | Answer |
|---|---|
| Works when closed / offline | Yes / yes, once the reminders exist. |
| Updates automatically | No. The shortcut must be run again after changes, and it cannot reliably find and replace earlier reminders. |
| Recurring | Partly (Shortcuts can set repeats, but mapping Sun-Thu rules is awkward). |
| Duplicates | Likely on every re-run unless old reminders are deleted manually. |
| Manual actions | Install a shortcut, run it after every change, clean up old reminders. |
| Privacy / cost | Local, free. |
| Complexity / reliability | Fragile; depends on Shortcuts behavior across iOS versions. Not recommended. |

### C. Shortcuts time-of-day automations

One personal automation per transition time ("At 13:00 on weekdays, show notification"). Runs without confirmation on current iOS.

| Question | Answer |
|---|---|
| Works when closed / offline | Yes / yes. |
| Updates automatically | No. Each automation is created and edited by hand; imports and edits are not reflected. |
| Recurring | Yes, by weekday. |
| Duplicates | None, but outdated automations stay until edited. |
| Manual actions | Create about 8 automations, maintain them by hand. |
| Privacy / cost | Local, free. |
| Complexity / reliability | Nothing to build; reliable; high manual effort. A good stopgap only. |

### D. Web Push with one tiny free scheduler (recommended)

Apple's push service is the only mechanism that wakes a closed Home Screen web app. Something must send the push at the right moment, so this needs one small always-on function. The design keeps almost everything on the phone:

1. When notifications are enabled, Luma subscribes to push (one tap, already part of the existing permission flow).
2. Whenever the schedule changes (an edit, an import, opening the app on a new day) and the phone is online, Luma computes the transition times for the next 30 days and uploads **only the list of times** to the scheduler, replacing the previous list. No titles, notes or tasks are sent.
3. A free Cloudflare Worker with a once-a-minute cron trigger sends an **empty** push (no payload, nothing to read) when a stored time is due.
4. The push wakes Luma's service worker, which reads the current schedule from IndexedDB on the phone, builds the text ("הסתיים X - עכשיו Y"), and shows the notification. Because the text is built at that moment from local data, it is never out of date.

| Question | Answer |
|---|---|
| Works when Luma is closed, phone locked, other app open | Yes. This is what Web Push is for on iOS 16.4+ Home Screen apps. |
| Works without internet | The app itself stays fully offline-first. Delivery needs the phone to be online at that moment (any Wi-Fi or mobile data). Pushes use a short time-to-live, so a notification missed while offline is dropped instead of arriving late. |
| Schedule changes and imports update automatically | Yes. Every change re-uploads the time list automatically when online. Changes made offline are uploaded at the next online moment; until then the notification text is still correct because it is built on the phone. |
| Recurring activities | Yes. The phone expands the Sun-Thu schedule into times for the next 30 days and tops the list up every time the app is opened. If the app is not opened for over 30 days, notifications stop until it is. |
| Duplicates and outdated notifications | Each upload replaces the whole list for that device (no accumulation). Each notification has a stable tag per transition, so a repeat replaces instead of stacking. A time removed on the phone but not yet uploaded can still wake the phone once; the service worker then shows the correct current activity from local data. |
| Manual actions | Once: Luma on the Home Screen (already done), tap `הפעלת התראות`. Nothing after that. |
| Privacy | Leaves the phone: an opaque Apple push address for this device and a list of times. Not sent: titles, notes, tasks, counts. The push itself carries no content. Cloudflare and Apple can see that this device receives pushes at those times. Nothing else changes: no account, no login, data stays in IndexedDB. |
| Infrastructure | One Cloudflare Worker (free plan: 5 cron triggers, 100,000 requests and 100,000 KV reads per day, 1,000 KV writes per day; one user uses a tiny fraction). A VAPID key pair; the private key is stored as a Worker secret, never in the app. GitHub Pages hosting is unchanged. |
| Cost | Initial and ongoing: 0 at this scale. |
| Complexity / reliability | About a day to build and test: subscribe/upload code and a `push` handler in Luma, about 100 lines of Worker code, deployment of the Worker. Delivery is as reliable as Apple's push service (generally seconds; Low Power Mode and Focus settings can delay or silence it). Timing is to the minute. |

Small rule change needed: `CLAUDE.md` currently says "no application server". This adds one scheduler that only knows times and push addresses; the rule would be updated to allow exactly that and nothing else.

### E. Native iPhone app

A small native wrapper (e.g. Capacitor) could schedule local notifications on the phone: no server, works offline. It needs a Mac, Xcode and an Apple Developer membership (99 USD per year) to install beyond 7-day test builds, a 64-pending-notification limit managed by a rolling window, and it leaves the PWA architecture. Not a fit for "no paid services, minimal complexity".

## 3. Recommendation

**Option D, Web Push with an empty "wake-up" push from one free Cloudflare Worker.** It is the only option that meets every requirement at once: notifications arrive with Luma closed, the user sets it up once, and edits and imports update the notifications automatically. It keeps Luma offline-first and local: the only information leaving the phone is a list of times and a push address, never schedule content, and the notification text is still built on the phone. It costs nothing at this scale and adds one small, isolated component.

If any server is unacceptable, the best no-server alternative is Option C (about 8 Shortcuts automations created once by hand, kept in sync manually), or Option A for a one-off calendar export. Both lose the "update automatically" property.

## 4. If approved: implementation outline

1. Worker: `PUT /schedule/:deviceId` (subscription + list of UTC instants, max a few hundred), `DELETE /schedule/:deviceId`, cron every minute sends due empty pushes with VAPID and a 2-minute TTL, then removes them; removes subscriptions that Apple reports as gone.
2. Luma: subscribe after permission; compute transition instants (Asia/Jerusalem wall time to UTC) for 30 days; upload on change and on open when online (debounced); store the plan in IndexedDB for the service worker; `push` handler builds "הסתיים X - עכשיו Y" from local data; unsubscribe and delete when the user turns notifications off.
3. CSP `connect-src` gains the Worker origin only. Tests for instant computation, DST, replacement without duplicates, and the service worker text.
