# Luma · לומה

Luma is a Hebrew, right-to-left, mobile-first personal work planner that runs entirely in the browser and works offline. It helps one person run a structured working day: see the current and next activity, choose three priorities, count handled inquiries against a daily target, handle team and manager questions, close the day, and carry unfinished work forward automatically.

There is no account, server, cloud database, synchronization, AI API, telemetry or secret key. All data stays on the device.

- Product and behavior specification: [`ARCHITECTURE.md`](ARCHITECTURE.md)
- Engineering rules: [`CLAUDE.md`](CLAUDE.md)
- Visual handoff: [`design/DESIGN.md`](design/DESIGN.md), [`design/ui/`](design/ui/), [`design/assets/`](design/assets/)

## Features

- **היום שלי (Home)** – time-of-day banner and greeting, date with Hebrew date, location, phone duty and hours; current/next activity with live remaining time (honest before/gap/after/off states); inquiry ring with one-tap +1; workday progress; three priorities (reorder, remove, pick or create); the mandatory **משימות שלא הסתיימו עד היום** section; today's new tasks; due follow-ups; actionable alerts; closing entry point; shortcuts.
- **סדר היום (Agenda/Day)** – list or hourly timeline; independent phone-duty strip; block states (current, completed, partial, skipped, canceled, overrun, open tasks, conflicts); complete/partial/skip/cancel and actual minutes; add, edit, move to another day, duplicate, split, merge, delete with scope choices; delay handling (shift / shorten / move tasks) with preview; day planning preview; move unfinished work; notes and accomplishments; PNG and print export.
- **יומן (Calendar)** – Sunday-first month grid with Hebrew dates and markers (meetings, deadlines, duty, home days, days off), month/year selectors; week hourly grid with drag across days and hours, resize handle, long-press on touch and Alt+Arrow keyboard alternatives; per-week pattern editor; week planning preview; week image and print.
- **משימות (Tasks)** – Today (carried section + new), Week, Completed, plus unfinished, upcoming, waiting, deferred, no-date, canceled, recurring and templates; search and category filter; subtasks, priorities, deadlines, estimates/actuals, recurrence (daily, weekly/every N weeks, monthly with overflow policy, by day type), explicit carryover policy per recurring rule, task templates.
- **Team & meetings / questions** – one canonical question record for team and manager, open/in-progress/answered/archived; unscheduled agenda queue; ad hoc meetings (no formal meetings are pre-created); agenda links, answers, decisions, decision→follow-up task and question→FAQ conversions without duplicates; searchable FAQ with copy and CSV/JSON export.
- **Work tools** – waiting/follow-up center, issue log with occurrence history (no external tickets), work notebook with note→task, inquiry history.
- **Inquiry counter** – +1, batch, simple/complex tagging, separate allocated-tomorrow / transferred / other counts, undo and corrections that never go negative, per-day target.
- **Focus mode**, **day closing** (editable checklist, partial close with confirmation, reopen/amend, tomorrow preview), **reports** (day/week/month with metric definitions, live vs. snapshot disclosure, copy/print/PNG/CSV), **global search**, **alerts**.
- **Planning import** – built-in ChatGPT instructions, paste or file, strict validation, read-only preview with duplicates/conflicts/missing data and resolutions, explicit approval, atomic apply, import history and safe undo.
- **Backup & restore** – full `luma-work-backup` export, preview and confirmed restore, bounded internal recovery snapshots, backup reminders.
- Light/dark themes, reduced motion, responsive desktop layout with a side rail.

## Defaults (all editable in Settings)

Sunday–Wednesday office, Thursday home with the same schedule, Friday–Saturday off; work 09:00–16:30; phone duty 09:00–12:00 on all default workdays; daily template: opening 09:00–09:15, inquiries 09:15–12:00, email 12:00–13:00, protected break 13:00–14:00, team reception 14:00–14:15, follow-up 14:15–15:30, email 15:30–16:00, closing 16:00–16:30; inquiry target 10. Template edits are versioned by effective date, so past days keep their schedule.

## Unfinished-task carryover

Carryover is a derived view computed from dates and statuses whenever a day is shown – not a nightly job. An actionable task (`todo`/`inProgress`, or deferred past its resume date) whose scheduled date is before the shown date appears under **משימות שלא הסתיימו עד היום** on Home and in the Tasks › Today view, separate from that day's new tasks. It keeps its ID, original scheduled date and deadline, shows its age, and keeps appearing on every following workday until completed, canceled, deferred or moved to waiting. Non-working days are skipped. It works even if the app was closed for days or the day was never closed. Waiting, deferred, future and unscheduled tasks are not carried; routine recurring checklists never accumulate; actionable recurring rules follow their explicit policy (latest occurrence only by default).

## Run locally

Requires Node.js 18+ for the dev server and tests (the app itself has no build step and no runtime dependencies).

```bash
npm install          # dev-only: Playwright for browser tests
npm start            # http://localhost:8080/luma/
```

The dev server serves the app under `/luma/` to prove that all paths work from a subdirectory. Service workers require `http://localhost` or HTTPS; opening `index.html` from `file://` will not work offline.

## Install

- **iPhone (Safari):** open the site → Share → **Add to Home Screen**.
- **Android / desktop Chrome or Edge:** browser menu → **Install app**.

After the first complete load the app works offline. Behavior of installed PWAs on iOS depends on the device and iOS version.

## Tests

```bash
npm test               # unit + integration (node:test): engines, store, import, backup, storage
npm run test:browser   # Playwright end-to-end flows (uses installed Chromium, else system Chrome)
npm run check          # SW precache list vs. shipped files, imports, no innerHTML, no network URLs
npm run test:all       # all of the above
```

Tests use synthetic data and fake clocks. Browser tests start their own static servers on ports 8731/8732.

## Data, storage and privacy

- One versioned state document in **IndexedDB** database `luma-work-planner` (stores `state`, `recovery`), with a monotonically increasing revision checked on every write (a stale tab cannot overwrite newer data). Critical actions persist immediately; only note typing is debounced. Save failures are shown, never hidden.
- If IndexedDB is unavailable, Luma runs in an explicitly labeled **degraded mode** using `localStorage` key `luma-work-planner:fallback-state`; when IndexedDB works again it offers a reconciliation (the unchosen copy is kept as a recovery snapshot). If nothing can be stored, a banner says so.
- Unreadable, foreign or newer-version data is never replaced with defaults; the app offers raw export and restore instead.
- Namespaces: IndexedDB `luma-work-planner`, localStorage prefix `luma-work-planner:`, Cache Storage prefix `luma-work-planner-shell-`, service-worker scope `./`, manifest id `./?app=luma-work-planner`, formats `luma-work-state`, `luma-work-backup`, `luma-work-plan`. Luma never reads or deletes other apps' storage.
- Browser storage is not encryption and not a backup. Export backups regularly and keep them off the device. Store only generic work descriptions and aggregate counts – no names of inquiry subjects, identifiers, case details, email bodies or documents.

## Formats

- **Plan import** – `luma-work-plan` v1: [`schemas/weekly-plan.schema.json`](schemas/weekly-plan.schema.json), validator `js/data/importPlan.js`, prompt template [`prompts/weekly-planning.md`](prompts/weekly-planning.md). Limits: 1 MiB, 500 items. A plan only adds/updates; it never deletes, completes tasks or adds counts.
- **Backup** – `luma-work-backup` v1: [`schemas/backup.schema.json`](schemas/backup.schema.json), deep validation in `js/data/validation.js`, migrations in `js/data/migrations.js`. Limit: 30 MiB.

## Project structure

```
index.html  manifest.webmanifest  sw.js
css/luma.css                      design tokens and components
fonts/                            Noto Sans Hebrew (OFL, see fonts/OFL.txt), Hebrew + Latin subsets
icons/                            PWA/Apple icons generated by tools/make_icons.py
assets/banners/                   runtime banners (from design/assets/*.webp)
js/main.js                        boot, storage selection, shell, router, live header, lifecycle
js/store.js  js/commands.js       validated commands, revisions, undo, persistence status
js/db.js                          IndexedDB / degraded localStorage / memory adapters
js/engine/                        DOM-free domain engines (day templates, schedule, recurrence,
                                  carryover, inquiries, team, planner, conflicts, closing,
                                  statistics, search, header, work tools)
js/data/                          schema enums, validation, migrations, backup, plan import, prompt
js/export/                        PNG, CSV, text, print, share/download/copy
js/views/                         screens
schemas/  prompts/  tests/  tools/
```

## Asset mapping

| Source (design package) | Runtime file | Use |
|---|---|---|
| `design/assets/banner-dawn.webp` | `assets/banners/banner-dawn.webp` | 05:00–08:00 |
| `design/assets/banner-day.webp` | `assets/banners/banner-day.webp` | 08:00–17:00 (greeting changes at 12:00) |
| `design/assets/banner-sunset.webp` | `assets/banners/banner-sunset.webp` | 17:00–20:00 |
| `design/assets/banner-night.webp` | `assets/banners/banner-night.webp` | 20:00–05:00 |
| `design/assets/banner-dawn-alternate.webp` | `assets/banners/banner-dawn-alternate.webp` | optional dawn alternative (Settings › כותרת) |
| `design/assets/originals/luma-app-icon-reference.jpg` | `icons/*.png` | cropped full-bleed 192/512/180/32 icons and a maskable 512 icon (`python tools/make_icons.py`) |

Intervals are configurable in Settings and evaluated in `Asia/Jerusalem` at startup, on resume and at each boundary while visible. No transparent wordmark artwork was supplied, so the header uses a live text "Luma" wordmark.

## Deployment (static hosting)

Copy `index.html`, `manifest.webmanifest`, `sw.js`, `css/`, `js/`, `fonts/`, `icons/`, `assets/` to any HTTPS static host (any subdirectory). Whenever a shipped file changes, bump `VERSION` in `sw.js` and keep its `SHELL` list in sync (`npm run check` verifies). Installed apps show "גרסה חדשה של Luma מוכנה"; the update is applied only after pending saves succeed, and user data in IndexedDB is never cleared by an update.
