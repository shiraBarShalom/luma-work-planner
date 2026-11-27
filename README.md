# Luma · לומה

Luma is a calm, Hebrew, right-to-left, mobile-first personal work planner that runs entirely in the browser and works offline. It shows what is happening now, counts handled inquiries, keeps three important tasks in view, follows a fixed weekly schedule and carries unfinished tasks forward automatically.

There is no account, server, cloud database, synchronization, AI API, telemetry or secret key. All data stays on the device.

- Product and behavior specification: [`ARCHITECTURE.md`](ARCHITECTURE.md)
- Engineering rules: [`CLAUDE.md`](CLAUDE.md)
- Visual handoff: [`design/DESIGN.md`](design/DESIGN.md), [`design/ui/`](design/ui/)
- Notifications - capabilities, limits and options: [`docs/NOTIFICATIONS.md`](docs/NOTIFICATIONS.md)

## Screens

- **היום שלי** - the date, the current activity (time, remaining time, what's next; all of them if several overlap), the inquiry counter (a ring with count/target, +, −, reset) and `3 המשימות החשובות שלי להיום`.
- **סדר היום** - the day as a checklist (רשימה) or an hourly timeline (ציר שעות) over the same data, with one notes field. List cards: time, title, short note, checkbox and a menu (הושלם חלקית, דילוג, ביטול הפעילות, עריכה). Timeline: tap to edit, long-press/drag to move, handle to resize, Alt+arrows on a keyboard.
- **משימות** - היום (with `משימות שלא הסתיימו עד היום` and `משימות להיום`) and הושלמו, plus a menu for this week, tomorrow, unfinished, upcoming, waiting for an answer, deferred and canceled. Search covers title and note; sort by priority either way. `הוספת משימה` at the bottom adds a task directly.
- **יומן** - month, week and day.
- **הגדרות** - daily inquiry target, notifications, appearance, backup and restore, planning import from ChatGPT, updates/storage/privacy.

Swipe left or right to change the date in the agenda and calendar. Completing, skipping, canceling or deleting shows a short "ביטול" toast to undo.

Header: time-of-day banner, greeting (with a name only if one is stored in your local data), the bell (deadline and backup reminders) and + (add a task or an activity). Both editors are short: a task has description, priority, execution date, optional deadline and note; an activity has title, date, start, end, notes and repeat.

## The weekly schedule

Every Sunday-Thursday: פתיחת יום 08:45-09:00, מענה לטלפונים ולפניות ב-CRM 09:00-13:00, הפסקה 13:00-14:00, זמן קבלה לשאלות של הצוות 14:00-14:15, חזרה טלפונית לפונים 14:15-14:30, טיפול במיילים 14:30-15:45, הקצאת פניות לצוות למחר 15:45-16:15, סגירת יום 16:15-16:30. Nothing on Friday or Saturday.

These are ordinary recurring activities: complete them, edit them (this time or from now on), or delete an occurrence. **Recurring activities are protected:** plan imports and any other automated change can never move, resize, replace or remove them - only your own edits can. **Overlaps are allowed:** an added or imported activity keeps its time next to the schedule, and both are shown side by side.

## Unfinished tasks

Carryover is computed from dates and statuses whenever a day is shown - never a nightly job. An open task scheduled before today appears under **משימות שלא הסתיימו עד היום** on the Tasks screen, keeping its ID, original date, deadline and priority, until it is completed, canceled, deferred or marked as waiting. It works even if the app was closed for days. Completing it anywhere moves it to הושלמו.

## Inquiry counter

One number per day (Asia/Jerusalem). + adds one, − removes one (never below zero), איפוס resets today after confirmation. A new day starts at zero; earlier days are kept. The count may exceed the target (default 10, editable in Settings from today on). Settings › יעד פניות יומי › היסטוריית פניות (collapsed) shows the total to date and each day's count.

## Notifications

On iPhone, notifications are available after adding Luma to the Home Screen (iOS 16.4+). After you tap `הפעלת התראות`, Luma can remind you when each activity starts - **only while Luma is open**; iOS does not run web apps in the background, and by design Luma uses no push server. Reminders are sent once per activity and show generic text on the lock screen unless you choose to show titles. For reminders while Luma is closed, set up the fixed schedule once in Shortcuts or Calendar on the phone: see [`docs/NOTIFICATIONS.md`](docs/NOTIFICATIONS.md).

## Run locally

Requires Node.js 18+ for the dev server and tests (the app itself has no build step and no runtime dependencies).

```bash
npm install          # dev-only: Playwright for browser tests
npm start            # http://localhost:8080/luma/ (this computer only; HOST=0.0.0.0 to allow the local network)
```

The dev server serves the app under `/luma/` to prove that all paths work from a subdirectory. Service workers require `http://localhost` or HTTPS.

## Install

- **iPhone (Safari):** Share → **Add to Home Screen**.
- **Android / desktop Chrome or Edge:** browser menu → **Install app**.

After the first complete load the app works offline.

## Tests

```bash
npm test               # unit + integration (node:test)
npm run test:browser   # Playwright end-to-end: Chromium, plus WebKit layout checks if installed
npm run check          # service-worker precache list vs. shipped files, imports, no innerHTML, no network URLs
npm run test:all       # all of the above
```

WebKit (Safari engine) checks run when `npx playwright install webkit` has been done; `LUMA_ENGINES=chromium` skips them. Tests use synthetic data and fake clocks. Browser tests start their own static servers on ports 8731/8732.

## Data, storage and privacy

- One versioned state document (schema v2) in IndexedDB `luma-work-planner`, with a revision checked on every write so a stale tab cannot overwrite newer data. Critical actions persist immediately; notes are saved when you leave the field (and when the app is hidden). Save failures are shown, never hidden.
- If IndexedDB is unavailable, Luma runs in a labeled limited mode (`localStorage`). Unreadable, foreign or newer-version data is never replaced with defaults.
- Upgrading from 1.x migrates the data automatically on first start and keeps a recovery copy of the old version. Features removed in 2.0 (team and manager questions, meetings, FAQ, notebook, issue log, day closing, detailed inquiry log) keep their records in the data and in backups; they are just not shown.
- Namespaces: IndexedDB `luma-work-planner`, localStorage prefix `luma-work-planner:`, Cache Storage prefix `luma-work-planner-shell-`, service-worker scope `./`, manifest id `./?app=luma-work-planner`.
- Moving Luma to its own origin (planned, not done): [`docs/ORIGIN-MIGRATION.md`](docs/ORIGIN-MIGRATION.md).
- Security protections, limitations and the latest audit: [`SECURITY.md`](SECURITY.md). Note that browser storage is per origin and Luma's GitHub Pages origin is shared with the account's other Pages sites.
- Browser storage is not encryption and not a backup. Export backups regularly and keep them off the device. Store only generic work descriptions and counts.

## Formats

- **Plan import** - `luma-work-plan` v2 (`activities`, `tasks`): [`schemas/weekly-plan.schema.json`](schemas/weekly-plan.schema.json), validator `js/data/importPlan.js`, prompt template [`prompts/weekly-planning.md`](prompts/weekly-planning.md). Additive only; v1 files are still accepted and their obsolete parts are listed as not imported. Limits: 1 MiB, 500 items.
- **Backup** - `luma-work-backup` v1 envelope containing the state document (schema v1 or v2; v1 is migrated on restore): [`schemas/backup.schema.json`](schemas/backup.schema.json). Limit: 30 MiB.

## Project structure

```
index.html  manifest.webmanifest  sw.js
css/luma.css                      design tokens and components
fonts/  icons/  assets/banners/   bundled font, PWA icons, header banners
js/main.js                        boot, storage selection, shell, router, header, lifecycle
js/store.js  js/commands.js       validated commands, revisions, undo, recurring protection
js/db.js                          IndexedDB / limited localStorage / memory adapters
js/notifications.js               capability detection, permission, foreground reminders
js/engine/                        DOM-free engines: schedule, recurrence, carryover, counter, alerts, header
js/data/                          schema enums, validation, migrations, backup, plan import, prompt
js/views/                         screens
docs/  schemas/  prompts/  tests/  tools/
```

## Deployment (static hosting)

Copy `index.html`, `manifest.webmanifest`, `sw.js`, `css/`, `js/`, `fonts/`, `icons/`, `assets/` to any HTTPS static host (any subdirectory). Whenever a shipped file changes, bump `VERSION` in `sw.js` and keep its `SHELL` list in sync (`npm run check` verifies). Installed apps show "גרסה חדשה של Luma מוכנה"; the update is applied only after pending saves succeed, and data in IndexedDB is never cleared by an update.
