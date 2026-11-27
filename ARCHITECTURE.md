# Luma (לומה) - Product and Technical Architecture

Status: Target specification, v2.0 (simplified product)
Audience: implementation agents and maintainers
Scope: an independent, Hebrew, RTL, mobile-first, offline-first personal work planner.

This document defines the product and its invariants. `CLAUDE.md` defines implementation and maintenance rules. `design/DESIGN.md` and the UI JSON references define the visual direction; this architecture governs behavior and data. All example records below are fictional.

## 1. Product intent

Luma is a calm, minimal planner for one person's working day: see what is happening now, count handled inquiries, keep three important tasks in view, follow a fixed weekly schedule, and carry unfinished tasks forward without reconstructing them from memory. It is a personal organization aid, not a CRM, team-management tool, mail client or monitoring system.

Simplicity is the primary success criterion. Each screen has one clear purpose and communicates through structure, not instructions:

- Minimal visible information, one clear hierarchy, no duplicate titles or dates.
- No explanatory paragraphs for obvious interactions, no technical terms, no status badges that do not change a decision, no duplicate buttons, no nested cards, no metrics dashboards.
- Keep necessary validation errors, destructive-action confirmations, accessibility labels and genuine limitations (e.g. storage or notification limits).

Product constraints:

- Hebrew interface, RTL, Sunday-first calendar, mobile-first (including the installed iPhone PWA); usable on desktop.
- Gregorian dates only in the interface, formatted naturally in Hebrew (e.g. `יום שישי, 27 בנובמבר`); the year appears only where it adds context (week ranges, editors).
- No account, server-side logic, cloud database, synchronization, AI API, secret keys, tracking or automatic submission to other services.
- Everything works offline after the app has been cached once. External ChatGPT planning is optional; importing its output is local.
- Local data belongs to the user and can be exported and restored. Browser storage is not a permanent backup.
- No motivational content, gamification or unrelated personal-life features.

## 2. Fixed weekly schedule

Luma ships with a permanent recurring schedule, every Sunday-Thursday, indefinitely. It is never generated on Friday or Saturday.

| Start | End | Title | Note |
|---|---|---|---|
| 08:45 | 09:00 | פתיחת יום | בלי מייל. בחירת שלושה דברים שחייבים להיגמר היום. |
| 09:00 | 13:00 | מענה לטלפונים ולפניות ב-CRM | |
| 13:00 | 14:00 | הפסקה | |
| 14:00 | 14:15 | זמן קבלה לשאלות של הצוות | |
| 14:15 | 14:30 | חזרה טלפונית לפונים | |
| 14:30 | 15:45 | טיפול במיילים | |
| 15:45 | 16:15 | הקצאת פניות לצוות למחר | |
| 16:15 | 16:30 | סגירת יום | רשימת מה שנשאר פתוח. |

These are ordinary recurring activities (eight weekly series with stable IDs `default-<key>`), with the same completion checkbox and editing as any activity. "זמן קבלה לשאלות של הצוות" and "סגירת יום" are calendar activities, not features. Fresh installs start the schedule on the first day of use; existing installs receive it through the v1→v2 migration (§9.3). Seeding and migration are idempotent: starting the app any number of times never duplicates the schedule.

Working days for task carryover are Sunday-Thursday. This is internal configuration (`settings.weekly`) with no settings screen.

### 2.1 Recurring activities are protected

Any recurring activity (the weekly schedule and any activity the user sets to repeat) is protected from automated change. No automated process - planning import, undo of an import, or any future automation - may delete, move, resize, shorten, split, replace, cancel or change the recurrence of a recurring activity. Only an explicit manual edit by the user may change it; there is no "pinned" checkbox because protection is automatic.

Enforcement is at the domain level: commands that are automated are flagged `automated`, and the store rejects the whole command if the canonical signature of recurring data (recurring blocks, legacy routine templates and their cut-off, per-occurrence overrides of recurring activities) differs before and after it. The import pipeline additionally refuses to target a recurring block.

### 2.2 Overlaps are allowed

Activities may overlap. Neither the user nor an import has to resolve an ordinary overlap; nothing is moved into a free slot and nothing is shortened to make room. Both activities keep their times, completion states and editing independently. Timeline views lay simultaneous activities side by side; the agenda list shows them as separate entries in chronological order; Home lists every current activity compactly.

## 3. Screens

Fixed primary navigation (RTL): היום שלי, סדר היום, משימות, יומן, הגדרות. The header keeps the time-of-day banner, the Luma wordmark, the greeting (Home only), the notification bell and the add (+) button, inside the safe area. There is no global search, no shortcut tiles and no secondary feature screens.

| Screen | Content (only) |
|---|---|
| Home / היום שלי | Weekday and date once; current activity (what, time, remaining, next; several if overlapping; a short neutral line when nothing is scheduled); inquiry counter (count, target, +, −, reset, progress); `3 המשימות החשובות שלי להיום` (up to three references to real tasks, completable). |
| Agenda / סדר היום | One date navigation (arrows; tap the date to pick another); modes רשימה / ציר שעות over the same data; one notes field for the day shared by both modes. Timeline: hourly grid, tap to edit, drag/long-press to move, handle to resize, Alt+arrows on a keyboard, `הוספת פעילות`. List: activity cards (start-end, title, short note, completion checkbox, ⋯ menu with exactly הושלם חלקית, דילוג, ביטול הפעילות, עריכה). |
| Tasks / משימות | Two tabs היום / הושלמו and a ⋯ menu with: all tasks this week, tomorrow, לא הסתיימו, עתידיות, ממתינות לתשובה, נדחו, בוטלו. Today has two separate sections: `משימות שלא הסתיימו עד היום` and `משימות להיום`. Search (title and note) and priority sort (high→low / low→high). |
| Calendar / יומן | חודש (month/year navigation, the grid; tapping a day opens it), שבוע (week navigation and the weekly grid), יום (day navigation, grid, `הוספת פעילות`). Nothing else. |
| Settings / הגדרות | Daily inquiry target; notifications; appearance and accessibility; links to backup and restore, planning import from ChatGPT, and updates/storage/privacy. |
| Alerts (bell) | Task deadlines that passed, are today or tomorrow; a backup reminder. |

Quick add (+): `הוספת משימה`, `הוספת פעילות` - the same editors used everywhere.

### 3.1 Editors

Activity editor (everywhere: agenda, calendar day/week, quick add, editing): כותרת, תאריך, התחלה, סיום, הערות, חזרה, save. Repeat options: ללא חזרה, כל יום, בכל יום עבודה, כל שבוע (the weekday of the date), חזרה מותאמת אישית (weekday buttons appear only for this option). A stored rule the editor cannot express (e.g. a legacy monthly rule) is shown by its description and kept unless changed. Editing a recurring activity asks `רק הפעם` / `גם בפעמים הבאות`; changing its date applies to this time only; changing its repeat rule applies from this occurrence on; choosing ללא חזרה keeps this occurrence as a one-off and ends the series. Deleting a recurring activity asks `רק הפעם` / `מהפעם הזו והלאה`, with confirmation. No category, type, pin or planning fields.

Task editor: תיאור המשימה, עדיפות (גבוהה / בינונית / נמוכה), תאריך ביצוע, מועד יעד (optional), הערה (optional), save. Existing tasks can be deleted from the editor with confirmation.

Dates in forms are shown as Hebrew text with the native picker laid over them, so they never overflow, never mix directions and never depend on the device locale.

## 4. Activities and the schedule

Occurrences are computed lazily per date from: legacy routine templates (only before `settings.routineEndsOn`), recurring calendar blocks (`recurrence` set) and one-off blocks. Identity: one-off `id`; recurring `<blockId>@<date>`; legacy routine `r:<template>:<role>@<date>`. Per-occurrence edits and exclusions live in `occurrenceOverrides`; completion states (`done`, `partial`, `skipped`, `canceled`; absent = planned) live in `blockCompletions`. Moving one occurrence to another date excludes the source occurrence and creates one destination activity, carrying its completion; there is never a duplicate. "From now on" edits split a series at the occurrence (the original ends the day before), moving later completions and overrides with it; past history is never rewritten. Recurrence never materializes future records.

Current/next: derived from the day's planned (not canceled/skipped) occurrences and the Jerusalem wall clock; phases `now` (one or more current), `next`, `done` (nothing left today), `none` (no activities that day).

## 5. Tasks and carryover

A task has a stable ID, title, note (`details`), priority, status, original and current scheduled date, optional deadline, timestamps and schedule history. Internal statuses: `todo`, `inProgress` (legacy; shown as open), `waiting`, `deferred` (with `resumeOn`), `done`, `canceled`. User-facing concepts: לא הסתיימו and עתידיות are derived from dates; ממתינות לתשובה, נדחו, בוטלו, הושלמו are statuses. Older fields (category, estimates, subtasks, preferred block, waiting note) are preserved in data but not shown; hidden subtasks never block completion.

Carryover is a derived view, never a cloning job:

- An open task (`todo`/`inProgress`, or `deferred` past its resume date) whose scheduled date is earlier than the shown date appears under `משימות שלא הסתיימו עד היום` on the Tasks screen, separate from `משימות להיום`. It keeps its ID, original date, deadline and priority, and keeps appearing on later days until completed, canceled, deferred or set to waiting. It works after the app was closed for several days. Opening the app repeatedly is idempotent.
- Waiting, deferred-until-later, future, done and canceled tasks never carry. Legacy recurring task rules keep their policy (routine checklists never accrue; actionable rules carry the latest missed occurrence by default) and can be stopped from the task menu.
- Completing a task anywhere removes it from both open sections everywhere and moves it to הושלמו. The same record is referenced by the three priorities.

Three priorities: up to three unique task IDs per date (`dailyPriorities`); picking a task without a date schedules it for that day; a new task can be created from the picker.

## 6. Inquiry counter

A simple counter, not an inquiry-management system. `inquiryCounts` holds one non-negative integer per local date (Asia/Jerusalem). Tapping + adds one, − subtracts one (never below zero; the button is disabled at zero), reset sets the day to zero after confirmation. No record is created per tap. The count may exceed the target. Rollover: at local midnight a new date starts at zero; earlier dates keep their numbers. The target is the default target version in force on the date (default 10; changes in Settings apply from today on, so earlier days keep theirs). A legacy per-date target override, if present in old data, still applies to that date. Legacy count events (`inquiryLogs`) are kept unchanged for recovery and are not shown.

## 7. Notifications

Luma uses only capabilities that work with a static, offline PWA:

- Capability detection: on iPhone, web notifications exist only for a PWA added to the Home Screen (iOS/iPadOS 16.4+). Otherwise the settings show a one-line explanation.
- Permission is requested only from an explicit tap (`הפעלת התראות`).
- A test notification (`התראת בדיקה`) is shown through the service worker registration.
- Activity-start reminders are scheduled with timers **only while Luma is open**. When the app is closed or suspended, the system does not run them and no reminder is sent; the setting says so in one line. A reminder missed while suspended is dropped (not sent late, beyond a two-minute grace on resume).
- Each occurrence is announced at most once (notification tag plus a per-day local record). Lock-screen text is generic (`פעילות מתחילה עכשיו`) unless the user enables showing activity titles.
- In-app alerts behind the bell are not presented as phone notifications.

Reliable background delivery needs Web Push from a server, which Luma does not use. `docs/NOTIFICATIONS.md` describes the smallest possible push design, its privacy implications and costs, and the backend-free calendar alternative; none of it is implemented without explicit approval.

## 8. External ChatGPT planning and import

Settings → `ייבוא תוכנית מ-ChatGPT`: copy generated instructions, describe the week or day in ChatGPT, paste the JSON (or choose a file), review a read-only preview, approve. Import is local and works offline.

### 8.1 Plan schema v2 (normative)

Envelope: `format: "luma-work-plan"`, `schemaVersion: 2`, `kind` (`weekly` | `dailyPatch`), `planId` (stable), `weekStart` (Sunday; required for weekly), `activities`, `tasks` (optional arrays; at least one item overall). Each item has an `externalId` unique within its collection. Unknown fields are rejected. Limits: 1 MiB, 500 items.

| Collection | Required beyond `externalId` | Optional |
|---|---|---|
| activities | `date`, `title` | `start`, `end`, `durationMinutes`, `notes` |
| tasks | `title` | `scheduledDate`, `deadline`, `priority` (`high`/`medium`/`low`), `notes` |

Dates/times are wall-clock `YYYY-MM-DD` / `HH:MM`. Null or missing means unknown, never zero or deletion. An activity needs a start and an end or duration before import (the preview asks for missing times); if both end and duration are given they must agree. Weekly plans keep activity dates and task execution dates inside the week unless the user widens the scope in the preview. Recurrence is not supported in imports. Plans contain no deletions, completion states, counts or commands.

Version 1 files remain accepted: blocks and timed meetings become activities; tasks keep their supported fields and subtasks are appended to the note; categories, estimates, block roles, pins, references and meeting types are listed in the preview as "לא ייובא"; day settings, team/manager questions and undated meetings are listed as not imported. Nothing is dropped silently.

### 8.2 Import pipeline

Parse as data → structural validation → semantic validation → normalize → detect previous imports and likely duplicates → read-only preview → selection and missing-time completion → explicit approval → atomic commit with a pre-import recovery snapshot and import history. Errors or cancellation leave the state untouched.

- Additive: new activities and tasks are added next to the existing schedule. Overlaps are shown as information (`במקביל ל-…`) and never block. Imported activities are never moved to free time; existing activities are never changed to make room.
- Recurring activities are never updated, replaced or removed by an import (§2.1). A plan that would recreate the fixed schedule shows each item as a likely duplicate, not selected by default.
- `(planId, origin collection, externalId)` plus a content fingerprint recognizes exact replays (nothing to import); changed content with the same IDs is previewed as an update; an update to a record the user edited manually after import needs explicit approval. Likely duplicates with different IDs are not selected by default.
- Undo of an import is safe: exact when nothing changed since; otherwise only unaffected items are reverted and the rest are listed with reasons. Plan import never replaces the database; backup restore is separate.

The generated prompt (`js/data/prompt.js`) states the existing fixed schedule (titles and times of recurring activities for the target dates), tells ChatGPT to return only additional activities and tasks, never recreate, cancel or reschedule the routine, keep the times the user said even when they overlap, never invent values, and output only schema-valid JSON. It contains no private tasks, notes or history.

## 9. Data model, persistence and migrations

Plain HTML/CSS/ES modules, no build step, no runtime dependencies; one versioned JSON document in IndexedDB.

### 9.1 Collections (schema v2)

| Collection | Contents |
|---|---|
| `metadata` | format `luma-work-state`, schemaVersion, revision, timestamps |
| `settings` | theme, reduced motion, backup reminder, notifications, internal working-day calendar, internal categories (colors only), legacy settings kept for compatibility, `routineEndsOn` |
| `calendarBlocks`, `occurrenceOverrides`, `blockCompletions` | activities (one-off and recurring), per-occurrence edits/exclusions, completion states |
| `tasks`, `recurringRules`, `dailyPriorities` | tasks, legacy recurring task rules, three priorities per date |
| `inquiryCounts`, `targetHistory` | daily counter values, versioned default target |
| `dayNotes` | the day's notes (plus legacy accomplishments text) |
| `importHistory` | applied plan items with fingerprints and undo data |
| Legacy (kept, not shown) | `dayTemplates`, `weekOverrides`, `dayOverrides`, `inquiryLogs`, `questions`, `meetings`, `meetingDecisions`, `faqEntries`, `issueLogs`, `workNotes`, `dailyReports`, `alertDismissals` |

Retired features keep their records in the document and in backups as a recoverable archive; there is no screen for them. Derived views (current/next, carryover, alerts) are never stored. Removing an entity never leaves dangling references.

### 9.2 Persistence

- IndexedDB primary store with revision checks (a stale tab cannot overwrite newer data), immediate persistence of critical actions (task completion, counter changes, imports, restores), debounced notes, honest saving/saved/error states, bounded recovery snapshots, degraded localStorage mode that is labeled as such, never seeding defaults over unreadable or newer data.
- Namespaces: IndexedDB `luma-work-planner`, localStorage prefix `luma-work-planner:`, Cache Storage prefix `luma-work-planner-shell-`, service-worker scope `./`, manifest id `./?app=luma-work-planner`, formats `luma-work-state`, `luma-work-backup`, `luma-work-plan`.
- Service worker precaches the app shell only; a new version installs completely before it is offered, is applied only after pending saves succeed, removes only Luma's obsolete caches and never touches IndexedDB.

### 9.3 Migration v1 → v2

Sequential, deterministic for a given input and clock, validated before commit, with a recovery copy of the v1 document saved first:

- `inquiryCounts[date]` = sum of the legacy completed-count events (positive and corrections) for each date with a positive total.
- Scheduled, non-canceled meetings become one-off activities (`meeting-<id>`); meeting records stay and point to them; task links follow.
- The weekly schedule is added from the migration date (or the next day if the current day already has legacy routine records); `routineEndsOn` stops legacy routine generation from that date, so past days keep their schedule and completion history and nothing is duplicated.
- Notification settings and the activity category are added. No record is deleted.

Re-running the step on its own output adds nothing. Unknown newer versions fail safely without overwriting data.

### 9.4 Dates

Canonical zone `Asia/Jerusalem`. "Today" and "now" use `Intl` with the explicit zone; calendar arithmetic uses UTC date-only primitives. Times are wall-clock `HH:MM`; audit timestamps are UTC instants. Validate leap days, week and month/year boundaries and DST.

## 10. Backup, privacy and security

Full backup `luma-work-backup` (envelope version 1, any known state schema version inside; older versions are migrated on restore). Export via share sheet or download; the export is recorded only after the browser accepted the file. Restore shows the file date and counts, requires explicit replacement confirmation and saves a recovery snapshot first. Foreign, plan and newer files are rejected without changes.

All imported content is untrusted: JSON only, no eval, no HTML injection, prototype-pollution keys rejected, bounded sizes. User text is rendered with safe DOM APIs. No telemetry, external fonts, CDNs or network calls at runtime. Store only generic work descriptions and counts - no identifying details of members of the public, case identifiers, email bodies or documents. Local storage is not encryption.

## 11. Mobile behavior

- Interactive controls use `touch-action: manipulation` (no double-tap zoom); pinch zoom stays available (no restrictive viewport). The time grid keeps long-press drag, resize handle, vertical scrolling and horizontal week scrolling.
- Header, content and the bottom navigation respect `safe-area-inset-*`. Bottom sheets stay above the on-screen keyboard (visualViewport) and keep the save button reachable; focused fields scroll into view.
- Form text is at least 16px (no focus zoom); inputs never exceed their containers; no horizontal scrolling at 320-430 CSS px.
- A re-render requested while a finger is down waits until the tap has been delivered, so a field saved on blur never swallows the tap that caused the blur.

## 12. Acceptance criteria and test matrix

| Area | Required scenarios |
|---|---|
| Schedule | Eight activities Sun-Thu, none Fri/Sat, across months/years and leap days; no duplicates on repeated start; v1 installs receive it without data loss; idempotent migration. |
| Protection | Automated commands that would move, remove, exclude or change the recurrence of a recurring activity are rejected; imports never update a recurring activity even with tampered history; manual edits work. |
| Overlaps | Manual and imported overlaps allowed; both keep times; independent completion; side-by-side in timelines; Home shows all current activities. |
| Activities | Add/edit through the one editor; repeat options; this time / from now on; stop repeating; move to another date without duplicates; completion states; no `null`/`undefined` in the UI. |
| Tasks | Carryover on Tasks › Today only, separate sections, same record, several days closed, weekends; completion moves to הושלמו; priority sort both ways; search title and note; simplified editor; legacy fields preserved. |
| Counter | +, −, never negative, reset with confirmation, over target, persistence, daily rollover, target history. |
| Home | Only date, current activity, counter, three priorities; date once; no search, shortcuts or duty/office text. |
| Import | v2 valid/invalid; v1 normalization with explicit not-imported list; additive overlaps; replay; manual-edit protection; duplicates; stale preview; undo; prompt aligned with schema. |
| Storage/PWA | Reload, quota/write failure, stale tab, two tabs, backup round trip (including v1 backups), app update migration with recovery copy, namespace isolation, offline cold start, service-worker update keeps data. |
| Mobile | 320/390/430 px in Chromium and WebKit: no horizontal overflow, editors fit, ≥16px inputs, touch-action on controls, safe-area padding, pinch zoom allowed. |

Use fake clocks and synthetic data. Browser emulation does not prove physical iPhone behavior; report device validation separately.
