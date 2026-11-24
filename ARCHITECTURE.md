# Luma (לומה) — Product and Technical Architecture

Status: Target specification, v1.1  
Audience: implementation agents and maintainers  
Scope: an independent, Hebrew, RTL, mobile-first, offline-first work planner.

This document defines the desired product and its invariants. `CLAUDE.md` defines implementation and maintenance rules. `design/DESIGN.md` and the accompanying UI JSON and local assets define the visual direction; this architecture governs behavior and data. Functional, accessible UI is required. All example records below are fictional and are not user data.

## 1. Product intent

Luma helps one person run a structured working day: see what to do now, focus on inquiries, handle team and manager questions, close the day, and carry open work forward without reconstructing it from memory. It is a personal organization aid, not an organizational CRM, mail client, or employee monitoring system.

Core workflow: open the day → select three priorities → execute time blocks and count inquiries → handle questions and follow-ups in appropriate blocks → review open work → close the day → prepare tomorrow. Weekly planning can be entered manually or generated externally with ChatGPT and imported as structured data.

Product constraints:

- Hebrew interface, RTL, Sunday-first calendar, mobile-first (including installed iPhone PWA); usable on desktop.
- Gregorian and Hebrew dates where useful, with Gregorian ISO dates as the canonical machine representation.
- No account, server-side application logic, cloud database, synchronization, external AI API, secret keys, tracking, or automatic submission to other services.
- Everything required for ordinary use is available offline after successful initial installation/cache population. External ChatGPT planning is optional and requires its own connectivity; importing the resulting data is local.
- Local data is the user's, and can be exported/restored. Browser storage is not a permanent backup.
- Quick task/question entry and one-tap completion matter more than the number of visible controls. Advanced functionality should be progressively disclosed.
- Do not introduce motivational quotes, unrelated personal-life features, project management, or gamification. Reports describe work; they do not score the person.

## 2. Default work configuration

The following is editable seed configuration, not fixed business logic. It is based on the supplied daily schedule and the approved clarifications.

### 2.1 Work calendar and phone coverage

| Day | Default location | Work status |
|---|---|---|
| Sunday–Wednesday | Office | Workday |
| Thursday | Home | Workday, same schedule as office |
| Friday–Saturday | — | Non-workday |

Default work window: 09:00–16:30. Phone-duty coverage: 09:00–12:00, seeded on all default workdays; the actual duty assignment can be overridden per day or week. The 09:00–09:15 opening routine takes place within the coverage window; the main inquiry focus block begins at 09:15. Coverage is a separate day-level window, not a duplicate blocking event. The user can edit the window and duty status independently of location and the time grid. If a day is not a phone-duty day, the inquiry block favors complex research-intensive inquiries rather than simple inquiries using frequently asked answers. No assumption about actual external phone availability or team roster is made.

The ordinary weekly schedule, locations, work hours, non-working days, public-holiday/time-off overrides, and default targets are configurable. Do not assume automatic holiday closure: allow explicit non-working overrides. Support shortened days and custom days. A home workday does not automatically change the schedule or target.

### 2.2 Default daily template

| Stable role | Time | Hebrew default label | Operational intent |
|---|---|---|---|
| `opening` | 09:00–09:15 | פתיחת יום | No email; choose three essential tasks. |
| `inquiries` | 09:15–12:00 | מענה לפניות | Phone-duty days: simple inquiries using approved FAQ; otherwise complex inquiries requiring research. |
| `email1` | 12:00–13:00 | בלוק מייל ראשון | Outlook, WhatsApp, telephone follow-ups; batch CRM transfers near the end. |
| `break` | 13:00–14:00 | הפסקה | Protected break by default. |
| `teamReception` | 14:00–14:15 | שעת קבלה לצוות ופגישה עם המנהל | Collect team questions and discuss manager topics in this window; routine manager touchpoint may be configured separately. |
| `followup` | 14:15–15:30 | השלמת פניות וטיפול במייל | Finish inquiry target or handle documents, remaining inquiries and follow-ups. |
| `email2` | 15:30–16:00 | בלוק מייל שני | Complete email-related work and follow-ups. |
| `closing` | 16:00–16:30 | סגירת יום | Allocate tomorrow's inquiries, review open work, record accomplishments. |

Every block supports completion. A block and its tasks are distinct: marking a block done does not silently complete its associated tasks. The team-reception window is a routine template block; formal team meetings are NOT pre-created or assumed to recur. Add meetings when scheduled. The closing window, workday end, breaks and all other hours are editable, and reminders/closing UI derive from the effective schedule, never from a hard-coded 16:00 check.

Default inquiry target: 10 completed inquiries per working day, editable globally or for a specific date. Days off do not contribute a target unless explicitly made working days. No automatic target increase after a shortfall.

### 2.3 Work habits represented as operational guidance

The source routine calls for checking Outlook and the personal phone in designated email windows, keeping the phone out of reach when appropriate, batching Outlook-to-CRM copying, collecting questions for reception, moving repeated questions into the FAQ, and escalating recurring sync issues to the manager or IT. Represent these as concise optional contextual instructions/checklists, not motivational text or technical enforcement. Actual duty coverage and urgent responsibilities override focus guidance; never imply a PWA can block other apps or configure the phone's DND mode.

## 3. Information architecture and required screens

Implement the visual direction in `design/DESIGN.md` and `design/ui/00-design-system.json`. Build semantic, accessible functional UI. Fixed primary navigation (RTL): היום שלי, סדר היום, משימות, יומן, הגדרות. Team, questions, reports, inquiry history and work tools are secondary routes with discoverable home shortcuts and navigation. Global search and direct task/question creation must be easy to reach. Screen composition may be refined without changing the domain contract.

| Screen | Required functionality |
|---|---|
| Today / היום שלי | Date, work location, duty status, work hours, current/next block, editable daily target and fast inquiry counter, three priorities, schedule/completion, new tasks, overdue/unfinished tasks, waiting follow-ups, actionable alerts and closing entry point. |
| Day | Timeline or list; add/edit/drag/resize blocks, task associations, completion states, estimated/actual durations, notes and optional accomplishments/reflection; move unfinished work and handle delays. |
| Week | Sunday-first hourly timetable, editable day patterns, duty/location and hours, time-off overrides, cross-day drag/drop and resize, weekly task and inquiry context, planning preview, export. |
| Month | Unbounded month/year navigation, date selection, Hebrew dates, colored category indicators, deadlines, meetings and workday status; tap opens day; navigation also accessible without swiping. |
| Tasks | Today's/new, unfinished, upcoming, waiting, completed and canceled views; search/filter, subtasks, recurrence, scheduling, templates and edits. |
| Team | Incoming team questions, questions/topics for manager, upcoming and past meetings, unscheduled agenda queues, decisions/follow-ups, searchable frequently asked answers. |
| Work tools | Waiting/follow-up center, issue log, work notebook, inquiry history; may be surfaced via relevant screens instead of extra main navigation tabs. |
| Reports | Daily, weekly and monthly inquiry counts/targets, work blocks, tasks, answered questions, open follow-ups, day history, export/copy actions. |
| Settings | Work calendar, location/duty defaults, editable templates and categories, targets, planner preferences, backup/restore, import, prompt generation, theme, accessibility preferences where appropriate. |

Quick-add should require only a title/text; all other fields are optional unless necessary to disambiguate an actual action. Show empty states, non-destructive error states and accessible confirmations for destructive actions. No mandatory daily reflection or elaborate form before starting work.

## 4. Scheduling, templates and calendar domain

### 4.1 Effective day computation

Resolve work-calendar defaults → applicable versioned daily template → weekly overrides → date-specific overrides → explicit per-day event/block edits. A more specific override wins. Location and duty are independent fields. An explicit non-working day suppresses generated routine blocks but must not silently delete manually scheduled events; show a conflict or retain them for review.

Generate routine blocks lazily for date ranges, with stable occurrence identity based on template series/role and date. Store completion/actual records and explicit overrides, not infinite copies. Version template changes with effective dates; never rewrite completed or past day history retroactively. For historical dates with no captured activity, identify reconstructed plans as such if necessary.

### 4.2 Block editing and recurrence

Support create, edit, drag across days, resize, duplicate, split, merge, move to another day, cancel/delete, mark complete/partial/skipped, and enter actual minutes. Preserve or explicitly reassign linked tasks when blocks split/merge; never drop references. Moving a generated block creates a source exclusion plus one destination occurrence, preserving identity/completion and preventing duplicates. If the destination already has an analogous routine block, present the conflict rather than silently merging. Protect completed history against unintended editing.

Recurring edits: this occurrence, this week (where meaningful), this and future occurrences, or change template for future applicable days; support all occurrences for ordinary recurring series only with explicit confirmation and a clear history policy. Distinguish an occurrence edit from a template change. Preserve manually edited blocks during automated planning.

Touch: long-press to initiate drag, visible resize handle, no accidental scrolling traps. Desktop: pointer drag and keyboard-accessible alternatives (e.g. Alt+Up/Down to move, Shift modifier to resize) plus ordinary edit controls; provide accessible equivalents on all devices. Validate start/end, day boundaries and overlapping intervals; end must be later than start. Meeting or protected-break conflicts require explicit resolution/confirmation. Default scheduling is within working hours; warn before extending beyond them. Never silently shift a fixed event, phone coverage, protected break, or end of workday.

### 4.3 Planner and disruption handling

Use deterministic local rules, not an LLM in the app. Compute availability from effective blocks, meetings, assigned task estimates, protected windows and work hours. Match categories to roles: inquiries → inquiry/follow-up; email/CRM → email windows (CRM batch at end); team/manager questions → reception or corresponding meeting; documents → follow-up; tomorrow prep → closing. Rank by overdue/deadline risk, priority, dependencies, age and editable category preferences. Missing estimates are flagged or given an explicit configurable planning assumption in the preview; never pretend they were user-provided. Do not schedule waiting tasks unless a follow-up is due. Allow manual selection/override and one-tap proposal to schedule a task in the first suitable free slot.

Planner outputs a proposed diff with reasons, conflicts, unallocated work and estimated capacity. No change until approval; preserve pinned/manual blocks and existing completed history. A task assignment within a routine block consumes that block's capacity rather than creating an overlapping top-level block. Use a deterministic tie-breaker.

For a delayed activity, offer: shift eligible later activities; shorten flexible activities (respect minimums); move eligible unfinished tasks to the next workday; manual edit. Show before/after preview, remaining conflicts and anything that will not fit. Fixed meetings remain fixed; do not silently erase lunch or extend work. The user can explicitly approve exceptions. All edits are undoable while safe.

Alerts: overlaps, tasks exceeding remaining block/day capacity, upcoming/overdue deadlines, clustered deadlines, overdue waiting follow-ups, work beyond configured end, missing day close (informational), and backup reminder. Avoid noisy repeats; show unresolved alerts at appropriate context. No off-device delivery or guaranteed background execution.

## 5. Task lifecycle and carryover

### 5.1 Task model and behavior

A task has a stable ID, title, optional details, category, priority, status, original planned date, current scheduled date (optional), deadline (optional), estimate/actual minutes (optional), subtasks, recurrence reference (optional), block/meeting/question links, waiting details, creation/update/completion timestamps, and explicit manual edits. Statuses: `todo`, `inProgress`, `waiting`, `deferred`, `done`, `canceled`. Display Hebrew labels. Deferral has a `resumeOn` date; waiting has optional `followUpOn` and non-sensitive dependency note. When due, show a waiting follow-up separately, not as an ordinary task silently reopened. Completion timestamp is independent from scheduling. Editing a completion or reopening is explicit and recalculates dependent reports.

Three daily priorities reference existing task IDs; inline entry may create a task. At most three active slots per date, no duplicate IDs. They may be fewer than three. Subtasks have stable IDs and completion state; completing a task with incomplete subtasks requires a deliberate choice. No silent completion of unrelated records.

Recurring tasks: daily, weekly, every N weeks, monthly, and by day type; allow an end date, optional exceptions and occurrence/future/all editing. Define monthly overflow policy explicitly (default skip nonexistent date; allow configured last-day behavior). Distinguish routine checklist occurrences (no carryover) from actionable recurring work (carryover policy explicit per rule; default no accumulating missed routine occurrences). Each occurrence has unique identity. Do not generate unbounded future records.

### 5.2 Carryover is a derived view, not a cloning job

- Any actionable, incomplete task whose scheduled work date is earlier than the effective current workday appears under `משימות שלא הסתיימו עד היום` without changing its original planned date or deadline. Use original/current scheduled date and status; future/deferred tasks stay out until due. Unscheduled tasks remain in backlog unless explicitly selected for the day. Waiting records appear in the waiting section; done/canceled records do not carry over.
- The dedicated section `משימות שלא הסתיימו עד היום` is required on both Today and Tasks, separate from today's new tasks and not an optional widget. A task scheduled Monday and left unchecked appears there on Tuesday; it remains there on subsequent workdays until completed, canceled, deliberately deferred or moved to waiting. Finishing it in any view removes it from the carried section everywhere. If the next day is non-working, it surfaces on the next workday. The original date and deadline remain intact. Today's newly scheduled work is shown separately from carried work. Preserve provenance and age (calendar days since first scheduled or a clearly labeled working-day measure). Carryover is not a duplicate entry or implicit permanent reschedule. Explicit scheduling moves update `scheduledDate` with history and never erase `originalScheduledDate`.
- Workdays come from effective calendar configuration. On a non-working date, show open work in read-only overview if desired; the next actionable day is the next configured working day. No creation of daily debt for holidays/weekends or routine template blocks.
- Recompute on initial load, resume/visibility change, date boundary while visible, relevant edits and calendar changes. Do not rely on a service worker, background timer or a successful day-closing action. Opening the app repeatedly or after several missed days is idempotent.
- A task remains one record across calendar, tasks, priority cards and reports. Reopening a historical task does not fabricate a second copy.

## 6. Inquiry tracking and target history

Quick counter: increment one completed inquiry, add a batch, undo accidental count, optionally tag simple/complex/unspecified. Counts beyond 10 are allowed. Provide separate counts for assigned to tomorrow, transferred/escalated and other non-completion dispositions; none count as completed unless explicitly recorded as such. This is aggregate tracking, not a case database. No person, case identifier, email body or document is needed.

Store stable local counter events (kind, quantity, category, work date, timestamp, optional correction reference). Corrections must not create negative aggregates; undo operates on an existing event or a validated adjustment. Derive daily totals and category breakdowns from these records; do not maintain a second mutable total. Per-day targets have versioned defaults and date overrides; preserve the effective historical target on captured/closed days. Changing today's/default target must not alter yesterday's reports unintentionally. Weekly/monthly targets are the sum of eligible daily targets, not a fixed 50 or 200. For an in-progress period distinguish elapsed-day performance from full-period planned target. Zero targets show an appropriate no-target state, never divide by zero. Shortfalls are reported, not automatically added to the next day's target.

Tomorrow allocation counts are distinct from completed inquiries. A user may set a generic follow-up task if useful, but the app must not automatically assign real cases or write to CRM.

## 7. Team, manager, meetings, knowledge and follow-up

### 7.1 Questions and agenda queues

Maintain one canonical question record with audience (`team`, `manager`), direction if applicable (`incoming`, `outgoing`), title, optional safe detail, created date, priority/category, status (`open`, `waiting`, `answered`, `archived`), answer, recurrence indicator, optional follow-up date and meeting links. An unscheduled agenda is a queue of references, not a fake calendar event. Open questions remain visible for the next appropriate reception/meeting until answered or archived. Answered questions go to history; reopening is explicit. Provide direct question creation from relevant screens.

### 7.2 Meetings

Create formal team meetings and manager meetings manually or via imported plans, with date, start/end or duration, title, type, location/note if safe, agenda references, decisions and status. No formal team meeting is seeded or pre-scheduled. If date/time is not known, keep the agenda unscheduled; missing duration of a timed imported meeting needs completion before scheduling. Link existing questions without duplicating them. Capture answers and decisions; a decision can produce a linked task with optional deadline/owner label (only non-sensitive personal reference if permitted). Cancel/reschedule preserves decisions/questions and releases time without deleting unrelated tasks. Meeting calendar representation is a reference to the meeting or a synchronized projection, never independently editable duplicate time data.

### 7.3 Knowledge and waiting center

FAQ: searchable titles, keywords/tags, approved non-sensitive answer text, related question references, creation/update timestamps, edit/archive/copy/export; promote a repeated answered question with explicit user confirmation. No auto-reading of external FAQ or CRM. Work notebook: searchable local notes, categories, optional pinning and conversion to tasks; safe plain text only. Issue log: generic issue title/category, first/last occurrence, occurrence records/count, status, reported-to role (manager/IT), resolution/follow-up and optional linked task. Do not create a ticket externally. Waiting center unifies waiting tasks, questions and issue follow-ups by references; review date and quick mark/reopen/edit actions.

## 8. Focus mode

Focus mode presents the current block, actual time remaining (or an honest gap/overrun state), relevant tasks, inquiry counter when applicable, and controls to complete or leave the block. Provide direct add-task or add-question actions only when relevant. Do not control other apps. Derive current/next from the effective schedule and local clock; handle gaps, before/after work and overlapping conflicts honestly. All edits use the same canonical commands as other screens.

## 9. Closing, history and reporting

Default checklist (editable): `הקציתי את הפניות למחר`, `רשמתי מה נשאר פתוח`, `סימנתי מה הצלחתי היום`. Enter the closing view from Today or from the closing block; highlight it during the configured closing window. Show completed inquiries vs target, completed/partial blocks, task completion/open work, waiting questions and tomorrow preview. Allow a brief optional accomplishment/note. Completing the checklist does not imply every open task is complete. Allow closing with incomplete items after explicit confirmation; preserve which were not done. If missed, carryover still works and report shows not explicitly closed. Reopening or amending a day is explicit, and prior historical target/template context is preserved.

Reports for a chosen date/week/month: completed inquiry counts and targets, categories and dispositions, blocks planned vs completed/actual minutes (missing actuals not zero), tasks completed in period and tasks open as of report date where reconstructable, open and answered questions, decisions, waiting follow-ups. Clearly distinguish current open items from historical snapshots; preserve closure snapshots and disclose if live edits change a report. Avoid double counting a carried task across daily denominators; document each metric's population and date basis. No employee ranking or hidden telemetry.

Exports: any day/tomorrow schedule as designed 1080×1920 PNG (no quotes, paginate long schedules without clipping, correct RTL); weekly plan as image or print layout; daily/weekly/monthly summaries as copyable text and printable layouts, daily summary optionally image; meeting agenda/decisions as text; tasks and inquiry history as CSV; FAQ as JSON/CSV; complete backup as JSON. Support share sheet if file sharing is supported by the browser; otherwise download/copy with an honest fallback. Print-to-PDF via browser is acceptable; do not promise native PDF generation. Use local fonts/assets and prevent CSV formula injection; export only selected scope, with a privacy warning for external sharing. Do not count an export as successful until the browser action actually succeeds or the file is prepared, as applicable.

## 10. External ChatGPT planning and import contract

Provide a settings/planning action `העתקת הנחיות ל־ChatGPT` that generates a versioned, copyable prompt including the current schema contract, workday conventions, editable template roles, category IDs, timezone, and explicit requested planning date/week context. Include no private tasks or notes by default; a user may manually provide permitted non-sensitive information. User speaks/types in ChatGPT, receives JSON, pastes it into the app or selects a JSON file. No AI SDK, API key, hidden upload, microphone permission or automatic ChatGPT integration is required. Import is local and can work offline.

### 10.1 Plan schema v1 (normative contract to implement as JSON Schema + runtime validator)

Envelope: `format: "luma-work-plan"`, `schemaVersion: 1`, `planId` (nonempty stable identifier supplied in the plan; derive a deterministic canonical fingerprint locally as an additional defense), `weekStart` (ISO Sunday for weekly plans, optional for a dated daily patch), `days`, `blocks`, `meetings`, `tasks`, `questions` arrays (optional, default empty). `kind` is `weekly` or `dailyPatch`. At least one change is required. Each item has a unique `externalId` within its collection; repeat import retains it. Use references only within the plan or explicitly mapped existing records. No arbitrary commands, URLs to execute, script, HTML, or deletion operations. Reject unsupported schema versions/unknown semantic fields (or clearly report them and require a corrected plan); validate size and collection limits before expensive processing. Define reasonable documented limits, e.g. 1 MiB and 500 total items for a planning import, separate from full backup limits.

| Collection | Required fields beyond `externalId` | Optional fields |
|---|---|---|
| days | `date` | `isWorking`, `location` (`office`/`home`/`other`), `phoneDuty` (boolean), `phoneStart`, `phoneEnd`, `workStart`, `workEnd`, `inquiryTarget`, `templateId` |
| blocks | `date`, `title` | `start`, `end`, `durationMinutes`, `categoryId`, `role`, `notes`, `pinned`, `taskRefs` |
| meetings | `title`, `meetingType` (`team`/`manager`/`other`) | `date`, `start`, `end`, `durationMinutes`, `agendaRefs`, `notes` |
| tasks | `title` | `scheduledDate`, `deadline`, `priority`, `categoryId`, `estimateMinutes`, `subtasks` (array of strings), `notes`, `preferredRole` |
| questions | `title`, `audience` | `direction`, `priority`, `followUpOn`, `notes`, `meetingRef` |

All dates/times are local wall-clock strings. Unknown optional values are omitted or `null` where the schema explicitly allows null; null means unknown, never deletion or zero. Relative dates must be resolved using the supplied planning context or left for clarification. `weekly` date overrides and scheduled events must be within the requested week unless user explicitly changes the import scope in preview; deadlines and future follow-ups may be outside it. Do not invent durations, deadlines, duty assignments, titles, or priority from vague input; omit unknowns. Untimed work can remain a task/agenda; timed blocks and meetings with missing end/duration require manual completion before calendar commit. If both end and duration are provided they must agree. Explicitly distinguish planned tasks from already completed work; plan import must not fabricate completion events, inquiry counts, or historical outcomes. Use allowed enumerations and known categories/templates or prompt mapping before commit.

Illustrative valid weekly plan with an unresolved meeting duration (preview must request completion or exclude that meeting):

```json
{
  "format": "luma-work-plan",
  "schemaVersion": 1,
  "kind": "weekly",
  "planId": "example-2026-11-29-v1",
  "weekStart": "2026-11-29",
  "days": [
    {"externalId":"day-thu","date":"2026-12-03","workEnd":"14:00"}
  ],
  "meetings": [
    {"externalId":"meeting-1","title":"ישיבת צוות","meetingType":"team","date":"2026-11-30","start":"10:30","durationMinutes":null}
  ],
  "tasks": [
    {"externalId":"task-1","title":"השלמת בדיקת המסמכים","deadline":"2026-12-02","categoryId":"documents","priority":"high"}
  ],
  "questions": [
    {"externalId":"q-1","audience":"manager","title":"בירור לגבי תקלה בסנכרון"}
  ]
}
```

### 10.2 Import pipeline

Parse as data → structural validation → semantic validation (date/time, range, references, known categories, enum, counts) → normalize → detect existing records/conflicts/possible duplicates → preview additions and proposed edits → resolve missing values or explicitly exclude invalid items → approve exact diff → transactional commit with pre-import snapshot and import history → refresh views. No state changes on parse/preview/error. Validation of included changes must succeed before atomic commit; a failed commit leaves prior state unchanged. Preview includes date range, counts, shifts/overlaps, unresolved references, duplicates, and any manual data affected. Respect manually edited items; suggested updates require explicit approval and conflict resolution. Excluding an item with dependent references requires resolving those dependencies.

Use `(planId, collection, externalId)` and canonical content fingerprint to recognize exact replay; changed imports with same identifiers preview updates, not duplicates. For different IDs with likely matching content, show possible duplicates, never silently merge/delete. Track applied/excluded IDs; re-import can explicitly add previously excluded items without duplicating committed ones. Undo last import when safe; if newer edits exist, offer a previewed inverse of unaffected changes or an explicit recovery restore with warning. Keep bounded recovery snapshots. Plan import is a patch and never replaces the full database. Backup restore is a different command/format and must be explicitly confirmed.

## 11. Data model, invariants and architecture

Use plain HTML/CSS/ES modules, no required build step and no runtime dependencies. Dev-only tooling is permitted where beneficial. Static hosting over HTTPS, relative asset paths. Use a single versioned JSON document in IndexedDB with logical collections; this is a modular monolith in the browser, not microservices.

### 11.1 Logical entities

Field names here describe the stable domain contract; document final exact types/schema in code. Use opaque stable IDs (e.g. UUIDs), explicit references, safe defaults, and `createdAt`/`updatedAt` timestamps on mutable records as appropriate. Distinguish ISO timestamp instants from wall-clock calendar fields.

| Collection | Key data/invariants |
|---|---|
| `metadata` | product/backup discriminator, schemaVersion, revision, timestamps; device-local ID if needed. |
| `settings` | locale/timezone, weekly work defaults, duty/coverage, target defaults, category IDs and labels/colors, planner configuration, theme, backup preferences. |
| `dayTemplates` | versioned templates/effective dates, stable roles/series IDs, default intervals, protected/flexible flags, work instructions/checklists. |
| `weekOverrides`, `dayOverrides` | dated schedule/location/duty/target/template overrides; unique keys. |
| `calendarBlocks`, `occurrenceOverrides`, `blockCompletions` | explicit events, recurrence exceptions and completion/actual records; no duplicate generated occurrence IDs. |
| `tasks`, `recurringRules` | canonical tasks and rules, status, dates, estimates, subtasks, recurrence and reference links; occurrence IDs stable. |
| `dailyPriorities` | date + ordered unique task IDs, max three. |
| `inquiryLogs`, `targetHistory` | stable count/correction events and target versions/snapshots. |
| `questions`, `meetings`, `meetingDecisions` | canonical questions, meeting schedule/agenda links, decisions and task references. |
| `faqEntries`, `issueLogs`, `workNotes` | safe local knowledge, issues, notes and provenance links. |
| `dailyReports` | closure checklist status, historical context, summaries/snapshot and amendments. |
| `importHistory` | applied patch/item fingerprints, result metadata and bounded undo/recovery links; avoid redundant copies of sensitive raw input. |

A derived view (current/next block, unfinished queue, total counts, alerts, reports, search index) is not a second mutable source of truth. Entity removal must preserve references or explicitly unlink/archive affected data; no orphaned foreign keys. Use atomic commands for conversions and multi-entity edits. Keep manual/pinned/provenance flags and change history where required. Historical values should not depend solely on today's mutable settings. Implement migrations sequentially, validate migrated output before replacing persisted state and preserve a recovery copy. Unknown newer schema versions fail safely without overwriting data.

### 11.2 Layers and suggested modules

```text
index.html
manifest.webmanifest
sw.js
icons/  fonts/  css/
js/
  main.js                 # boot, router, application shell
  store.js                # commands, subscriptions, transactions, undo
  db.js                   # storage adapter and recovery
  dates.js                # timezone and wall-clock primitives
  seed.js                 # neutral defaults and templates
  config.js               # identifiers and versioned configuration
  editors.js  timegrid.js # input and accessible calendar interactions
  engine/
    dayTemplates.js  recurrence.js  taskCarryover.js
    inquiries.js     team.js
    planner.js       conflicts.js   dayClosing.js  statistics.js
    issues.js        search.js
  data/
    schema.js  migrations.js  validation.js  importPlan.js  backup.js
  export/
    image.js  csv.js  text.js  print.js
  views/
    today.js  day.js  week.js  month.js  tasks.js
    team.js   reports.js  settings.js  workTools.js
schemas/
  weekly-plan.schema.json  backup.schema.json
prompts/
  weekly-planning.md
 tests/                   # unit, integration, browser/PWA tests
```

This is a responsibility map, not a mandate to create empty modules or over-fragment small ones. Views call store commands/selectors; domain functions are deterministic and DOM-independent; data adapters own persistence; exports use read-only selectors. Inject clock/configuration in domain tests. Avoid direct mutation of state from views, circular dependencies, and untrusted HTML insertion.

### 11.3 Dates, clock and recurrence

Canonical zone: `Asia/Jerusalem`, configurable only if a deliberate product decision adds timezone support. Use `Intl.DateTimeFormat` with explicit timezone for today's date and current wall time, and Hebrew calendar formatting for display. Calendar arithmetic uses UTC date-only primitives or equivalent integer day arithmetic; do not parse a local date string and accidentally apply host timezone/DST to it. Work intervals are wall-clock `HH:MM` values, not UTC instants. Use ISO UTC instants for event/audit timestamps. Validate dates (including leap days), times, Sunday week boundaries, month/year transitions and DST. Recompute when returning from background and across midnight. Never shift a 09:00 block due to DST or device timezone change.

## 12. Persistence, offline and installation

- IndexedDB is the primary store, with one versioned document and atomic transactions, including revision checks and bounded recovery copies. Use debouncing for noncritical rapid edits only; persist critical user actions promptly and report failures. Page hide/visibility flush is best effort, not sole durability. Avoid claiming data is saved until storage succeeds.
- A localStorage fallback may be used only as an explicitly identified degraded storage mode, with quota/error handling and validated handoff/reconciliation. Never silently seed an empty fallback over an inaccessible existing database. If neither works, expose unsaved state and allow export; avoid split-brain between adapters. Handle multiple tabs/windows using revision conflict detection and reload/resolve UI instead of last-writer-wins data loss.
- Service worker precaches same-origin app shell, JS/CSS, icons, bundled licensed fonts and necessary static assets. Cache Storage holds app assets, not personal records. No mandatory runtime external resources. Safe cache version changes; do not clear IndexedDB on app update. Remove only caches belonging to this app. Surface update availability and apply after pending writes are safe; handle failed cache installation/partial fetch without breaking the last working shell.
- Manifest: unique app ID, scope/start URL, Hebrew name, icons and standalone display. Static paths relative to deployment subdirectory. Support install instructions for Safari home-screen and browser use. Actual iOS behavior is device/browser-dependent; test installed and browser contexts when available. Request persistent storage only if supported, but never promise retention or background execution. Private browsing, eviction, uninstall/reset and device loss can remove local data.
- Use a unique app-specific storage namespace (IndexedDB, localStorage, Cache Storage, service-worker scope, manifest ID). Origin-based storage may be shared across subpaths; namespacing and correct service-worker scope are required even for separate deployments on the same host. No cross-app reads/writes. Static hosting is allowed; no application server or cloud sync.

## 13. Backup, recovery, privacy and security

Full backup format discriminator `luma-work-backup`, independent versioned envelope with export timestamp and complete validated state. Support export to files/share, explicit import/restore preview (record counts, version and date), confirmation before replacing, pre-restore recovery snapshot, migrations for known older versions, reject malformed/future/foreign formats without mutation. Round-trip all entities, settings, history and stable references; no silent data truncation. Backup reminders shown locally at configurable interval (default seven days); record last confirmed export/prepared file honestly, not a guaranteed copy in Files. Provide manual export any time. Keep internal snapshots bounded and explain they cannot recover data if device storage itself is lost.

Treat all imported content as untrusted. JSON only; no eval, script execution, HTML interpolation, unsafe prototype merging, unbounded recursive objects, or dynamic code. Reject or sanitize prototype pollution keys; render plain text through safe DOM APIs, validate references and content lengths; use safe clipboard/export logic and CSV escaping including formula prefixes. No third-party telemetry, ads, tracking, external fonts at runtime, automatic uploads, secrets, or credentials. Use a restrictive compatible CSP where deployment allows it; do not invent security guarantees for static hosting.

Data policy: use only non-sensitive generic work tasks, aggregate counts, permitted questions and notes. Do not store names of inquiry subjects, identifiers, case details, email bodies, documents or confidential organizational data. FAQ and notes are allowed only where policy permits. The same restriction applies to external ChatGPT dictation and exports. Device-local storage is not encryption, authentication, or organizational approval; backups are sensitive to whoever accesses the device/file. Do not implement CRM/Outlook/WhatsApp integration or request access to them. Add a concise warning at import, backup and sharing points. No actual private seed data, real case samples, private backups, or secrets in version control.

## 14. Acceptance criteria and test matrix

Implementation is complete only when all required capabilities have real behavior, persistent data and usable UI paths (not placeholder cards). Minimum automated coverage and manual verification:

| Area | Required scenarios |
|---|---|
| Defaults | Thu home with same routine; all default workdays have editable 09–12 phone coverage; opening/main inquiry interval correct; no seeded formal team meetings; editable closing time, target 10. |
| Calendar | Sunday week, Hebrew dates, month/year navigation, DST/zone and leap/month transitions; short day/off day, weekly/day overrides, recurrence edit scopes, moved generated occurrence not duplicated, drag/resize and keyboard/editor alternatives. |
| Tasks | Add/edit/subtasks/recurrence, statuses, priorities linked by ID, incomplete task visible automatically in a dedicated section on both Today and Tasks next workday, distinct from new tasks, without clone, skipped weekends/time off, multiple missed days, waiting/deferred not ordinary carryover, recurring routines not accrued, original date/deadline retained, reopen/completion consistency. |
| Counters | Batch increments, undo/correction, no negative values, > target, zero/off-day target, historic target stable, category totals and weekly/monthly aggregation, allocation/transfers excluded. |
| Team/tools | Unscheduled question queue, ad hoc meeting, agenda links, answer/history, decision→task, repeated question→FAQ, issue occurrence tracking, notes/search/waiting follow-up. |
| Planner | Deadline/capacity conflicts, manual/pinned preservation, no auto-commit, missing estimate, fixed meeting/break and short day, delay preview, approve/undo. |
| Closing/reports | Closing time moves with schedule, partial close, missed close, history and metric semantics, exports match selector data. |
| Import | Valid daily/weekly patch; invalid JSON/schema/version/date/time/refs; unknown duration; repeated exact import; changed same-ID plan; semantic duplicate; exclusion/dependency; manual edit conflict; canceled preview/failed commit leaves state unchanged; safe undo. |
| Storage | Reload/resume, quota/blocked DB, fallback reconciliation, simultaneous stale revision, interrupted write, migrations, foreign backup rejection, restore round-trip, no cross-app namespace collision. |
| PWA/export | Initial cache and offline cold start after installation; no outbound runtime dependence; update preserves state; relative subpath; long Hebrew PNG pagination; CSV escaping; share/download fallback; iPhone safe-area/touch/keyboard, RTL and dark/light accessibility. |

Use fake clocks and synthetic data; test state transitions and invariants at unit level, then integrated UI flows. Browser emulation does not prove physical iPhone behavior; report actual device validation separately. Record limitations and failed/skipped tests honestly.

## 15. Delivery order and configurable decisions

Suggested sequence: foundation and data contracts → day/calendar → tasks/carryover/inquiries → team and work tools → planner/closing/reports → import/backup/export → PWA hardening and end-to-end verification. Implement the whole agreed scope, not just a mockup or first phase. Document meaningful architectural decisions and any incomplete requirement.

The visual language is specified in `design/DESIGN.md` and the supplied UI references. Implement the approved home and consistent styling across every required screen, including screens without individual references. Use configurable categories. Defaults above are intentionally editable, especially actual duty assignments, working days, meeting times, location and closing window. Visual refinements must not require changes to the data model or business rules.
