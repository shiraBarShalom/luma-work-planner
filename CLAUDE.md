# CLAUDE.md - Luma Engineering Instructions

## 1. Project contract

Luma (לומה) is a Hebrew, RTL, mobile-first, offline-first personal work planner. Since v2 it is deliberately minimal: Home (date, current activity, inquiry counter, three important tasks), Agenda, Tasks, Calendar and a short Settings screen. Simplicity is the primary success criterion: no explanatory text for obvious interactions, no duplicate dates/titles/buttons, no dashboards. `ARCHITECTURE.md` in the repository root is the normative product and technical specification. Read it in full before making substantive changes. This file defines durable engineering rules for implementing, testing, and maintaining that product.

Follow explicit user requirements first, then the architecture and this file. If a material conflict exists, surface it rather than silently inventing a new requirement. Keep this file and the architecture current when an approved decision changes the contract. Implement the visual handoff in `design/DESIGN.md`, `design/ui/` and `design/assets/`. The architecture is authoritative for behavior; the visual references are authoritative for approved appearance only. Keep domain logic independent from styling. Code, internal documentation, tests and comments should be in English; the user-facing interface, error messages, instructions and exports should be natural Hebrew with correct RTL behavior.

## 2. Operating procedure

For every substantial task:

1. Read the applicable architecture sections and inspect the actual repository, current git status, module dependencies, data contracts and existing tests. Do not infer implementation from filenames or documentation alone.
2. Identify the smallest coherent implementation path, affected invariants, compatibility risks and test coverage. Establish a baseline before edits whenever feasible.
3. Implement the full requested behavior in coherent vertical slices: domain, persistence, UI, validation and tests together. Prefer existing proven mechanisms where they satisfy the contract. Refactor only where it improves correctness, maintainability or the required functionality.
4. Exercise the changed flows with unit/integration/browser tests. Fix failures attributable to the work, rerun regressions, and inspect the diff for data leaks, dead code and unintended changes.
5. Update relevant documentation, schemas, prompt templates and cache/version identifiers. End with a concise factual report: what changed, exact test commands/results, known limitations, unverified assumptions and remaining work.

Do not stop after writing a plan, a mock screen, a checklist of TODOs or a partial implementation if the user requested a complete feature. Work autonomously on reversible local implementation decisions; ask only when a missing decision would materially change product behavior, privacy, or create destructive risk. If blocked, implement independent parts and report the exact blocker. Do not claim tests or physical-device checks that were not run.

## 3. Non-negotiable constraints

- Plain HTML, CSS and JavaScript ES modules; no required build step, no production framework or runtime dependency unless explicitly approved. Development-only test tooling is acceptable and must not be required by the deployed app.
- No application server, cloud data store, account/auth requirement, cloud sync, AI API, secret keys, telemetry, external runtime font dependency, or automatic submission to other systems. Static hosting over HTTPS is allowed.
- All ordinary app features, including JSON plan import, backup and recovery, must work locally after successful initial app caching. External ChatGPT dictation/formatting is optional and outside the app's offline guarantee.
- Store personal application state in IndexedDB, not Service Worker Cache Storage. Handle persistence errors without pretending success. A localStorage fallback is degraded mode, not an independent competing source of truth.
- No real personal records, confidential material, backups, case identifiers or credentials in code, test fixtures, screenshots, commits, prompts or logs. Use fictional examples and aggregate counts. Do not inspect unrelated private files to create test data.
- The fixed weekly schedule is seed data made of ordinary recurring activities (stable IDs, editable by the user), never hard-coded logic. The daily target is configuration read through selectors. Do not reintroduce phone duty, office/home locations, day templates, categories, team/manager questions, a notebook, day closing, reports, global search or a planner as user-facing features without an approved requirement.
- No motivational quotes, unrelated personal-life features, project management, or forced gamification. Do not invent organizational procedures or integrations.
- Recurring activities are automatically protected: no automated process (import, undo of import, future automation) may move, resize, remove, replace, cancel or change the recurrence of one. Flag such commands `automated`; the store rejects them if the recurring signature changes. Only explicit manual edits change recurring activities.
- Activity overlaps are allowed and never require resolution; never move or shorten an activity to make room.
- No false offline, security, browser-storage permanence, notification or iPhone capability guarantees. Local storage is not encryption and does not survive every reset/eviction.

## 4. Architecture boundaries

Keep the app a small modular monolith. Organize modules by responsibility, not artificially by file count:

- `views` and UI helpers render selectors and dispatch commands; they do not own canonical business state or write to persistence directly.
- Domain engines own deterministic rules for dates, schedules and recurrence, carryover, the inquiry counter and alerts. Keep these functions DOM-free and inject clock/configuration where useful.
- The store owns commands, state transitions, invariants, subscriptions, transactions/revisions and bounded undo. A multi-record conversion/import must commit atomically or not at all.
- Data modules own schema validation, migration, persistence, backup and import. Export modules consume read-only selectors. The service worker owns the static app shell only.
- Avoid circular imports, duplicated state, implicit globals and side effects during module import. Favor clear named exports, meaningful names, small pure helpers, consistent errors and JSDoc for non-obvious data shapes. Do not add generalized abstractions without a demonstrated need.

Use the suggested responsibility map in `ARCHITECTURE.md` as a guide. Do not create empty files purely to match a diagram. If a useful existing module already provides the correct boundary, keep it. Record deviations that matter.

## 5. State and domain invariants

All edits flow through validated commands. Each entity has a stable ID; relationships are ID references, not copied objects. Keep a versioned canonical state document, monotonically increasing revision and explicit update timestamps. Derived views/selectors are computed, not separate mutable copies.

- **Schedule:** occurrences come from recurring and one-off activities (and legacy routine templates only before `settings.routineEndsOn`). Past history is never rewritten by "from now on" edits. Legacy data (templates, day overrides) stays readable.
- **Dates:** canonical local dates are `YYYY-MM-DD`, times `HH:MM`, zone `Asia/Jerusalem`. Use explicit timezone formatting for now/today and UTC date-only arithmetic. Do not use `new Date('YYYY-MM-DD')` followed by local accessors as a calendar arithmetic shortcut. Use explicit UTC instants for audit timestamps. Validate leap days, invalid dates/times, week boundaries, DST and month/year changes.
- **Recurrence:** stable occurrence identifiers, explicit exceptions and future-series edits. Moving an occurrence must not leave a duplicate source occurrence. No infinite materialization. No retroactive destruction of completion history.
- **Carryover:** compute unfinished work from dates/statuses on open/resume/date change and relevant edits. Do not clone tasks nightly or depend on timers while the app is closed. Preserve original date and deadline. Respect workdays, waiting and deferral, and no carryover for routine checklists. Show the required `משימות שלא הסתיימו עד היום` section separately from `משימות להיום` on the Tasks screen (not on Home); completion updates all views consistently. Never make the section optional.
- **Inquiry counter:** one non-negative integer per local date in `inquiryCounts` (no record per tap); +1/−1/reset; never negative; over-target allowed; new date starts at zero; historical targets preserved. Legacy count events stay untouched.
- **Retired features:** questions, meetings, FAQ, issues, notes, day reports and count events remain in the document and backups as a recoverable archive; never delete them in a migration and never add a screen for them unless approved.
- **Notifications:** request permission only from a tap; never claim background delivery; reminders run only while the app is open, at most once per occurrence, with generic lock-screen text by default.

When deleting an entity, prevent orphan references through archival, explicit unlinking or deliberate validated cascade as appropriate. Never silently destroy independent records.

## 6. Persistence, revisions and migrations

Use a unique Luma namespace for IndexedDB, localStorage, Cache Storage, manifest ID, service worker scope and export format. Treat all persistence adapters as fallible. Handle blocked database, quota, write failure, unsupported versions and conflicting tabs explicitly. Do not replace unreadable or newer data with default data. On migration, validate the source, preserve recovery, migrate sequentially, validate output, then commit. Migrations must be deterministic and safe to rerun from a known version. Increment schema versions only when required and support known older versions.

Critical actions such as task completion, count changes and import/restore must have prompt durable persistence. Debounce only appropriate low-risk edits. Show saving/saved/error states based on actual outcomes. Page hide is best effort only. Use revision checks to prevent stale tabs from silently overwriting newer state. If degraded fallback is necessary, identify it and reconcile safely before switching back. Never clear user data during service worker activation or application updates.

Backup and plan import are separate formats and actions. Keep bounded recovery snapshots; do not claim those are a substitute for externally saved backup files. Undo must not blindly revert unrelated changes that happened later.

## 7. JSON import and ChatGPT prompt discipline

Keep the versioned JSON Schema, semantic validator, import engine, tests and generated ChatGPT instructions aligned. A schema change is incomplete until all corresponding contracts are updated. The exact v1 planning fields and import behavior are in `ARCHITECTURE.md`.

- Plan imports are additive (v2: `activities`, `tasks`). They never change recurring activities and never require resolving overlaps. v1 files stay accepted; their obsolete parts are listed in the preview, not silently dropped.
- Accept paste or local JSON file; validate types, bounded sizes, dates, enums, IDs, relationships, timing and unknown fields. Use safe JSON parsing and property handling; no eval, code execution, HTML injection or unrestricted deep merging.
- Treat unknown duration/deadline as unknown. Prompt templates must state that the fixed schedule already exists, ask only for additional activities and tasks, and instruct ChatGPT not to invent values and to output only schema-compatible JSON. Generate context from current non-sensitive settings and target planning date/week; do not automatically serialize private notes/tasks or historical records into a prompt.
- Produce a read-only preview with proposed additions/updates, duplicates, conflicts, missing data and exclusions. Require explicit approval. Apply validated changes in a transaction with recovery and import history. An error or cancellation before commit leaves the state untouched.
- Stable `planId` and external IDs, canonical fingerprints and replay handling must prevent exact duplicate imports. Changed same-ID content previews a proposed update; likely semantic duplicates with different IDs require review. Preserve manually changed records unless the user explicitly approves the overwrite.
- Do not let plan imports replace the database, issue delete commands, manufacture completed tasks/counts, execute commands or request external data. Full backup restore requires separate explicit replacement confirmation and migration/validation.

## 8. UI and accessibility

Build mobile-first in Hebrew using the supplied Luma design system and visual references. Set `lang="he"` and `dir="rtl"` appropriately. Use logical CSS properties for spacing and alignment, correct bidirectional handling for dates, times and English tokens, safe-area insets, scalable typography, sufficient contrast and visible focus. Keep primary controls touch-friendly (aim for at least 44 CSS px), keyboard-accessible, and properly labeled. Do not rely solely on color, drag gestures or hover. Supply edit controls as an alternative to dragging/resizing. Use accessible modal/sheet focus handling and Escape/close actions; restore focus. Prevent destructive actions from accidental taps.

Prioritize direct task and activity entry, one-tap count changes, easy completion and a clear current/next activity. Do not require optional fields on creation. Use `touch-action: manipulation` on controls (keep pinch zoom), ≥16px form text, safe-area insets and keyboard-aware sheets; nothing may overflow horizontally at 320-430 px. Never render `null`/`undefined` (use `setChildren`, never `replaceChildren` with possibly-null children). Show loading, empty, error, offline and storage-failure states honestly. Avoid excessive popups and unnecessary animations. Respect reduced motion and light/dark preferences. Do not represent a visual placeholder as a working feature. If a control is present it must work, or be explicitly labeled unavailable with a meaningful reason.

Typography: user-facing text uses only the standard short hyphen (-) - never the em dash (U+2014), en dash (U+2013) or Hebrew maqaf (U+05BE). This covers titles, labels, default schedule titles and notes, date and time ranges (`09:00-13:00`), buttons, menus, notifications, settings, dialogs, validation messages and the generated ChatGPT instructions. Do not rewrite user-entered data. `tests/unit/typography.test.js` and the browser layout checks enforce it.

Use safe DOM APIs (`textContent`, safe element creation); do not render user/import strings with `innerHTML`. Sanitize file names and support browser share/download/copy fallbacks without false success notifications.

## 9. PWA and deployment rules

- Keep runtime assets local and paths relative to the deployment subdirectory. No production network requirement after successful installation/cache population. Use licensed local fonts or system fallback. Do not add CDN dependencies.
- Maintain a coherent cache manifest/version and safe service worker update lifecycle. Bump `VERSION` (or its documented equivalent) whenever shipped app-shell assets change. Precache new shell successfully before retiring obsolete app-owned caches. Never delete another app's caches or databases. Protect pending saves before an update reload.
- Validate manifest name/id/start URL/scope/icons, worker scope, offline navigation and static hosting assumptions. Service worker requires HTTPS or localhost; document the local run command. Test both browser and installed-style layouts where possible.
- Do not deploy, publish, push, merge, change repository visibility or alter hosting settings unless the user explicitly authorizes that action. Do not create secrets or request credentials. Local implementation and verification do not imply authorization to publish.

## 10. Testing and definition of done

The test matrix in `ARCHITECTURE.md` is mandatory coverage guidance. Use dependency-light automated unit tests for deterministic engines, integration tests for store/import/migrations, and browser tests for important UI, offline, backup and import workflows. Use the repository's existing test runner when practical; otherwise document a reproducible dev-only runner. Use fake clocks and synthetic fixtures; do not depend on today's real date or external services for tests.

Minimum quality gates before declaring a feature complete:

1. Required behavior implemented end-to-end with actual controls, validation and persistent state.
2. Appropriate unit/integration tests for normal cases, errors, idempotency, time boundaries and affected invariants; existing relevant tests rerun.
3. Mobile/desktop browser flows checked, including RTL, touch alternatives and keyboard access where relevant.
4. Offline, reload, update, storage failure and backup/restore regression checked when relevant; no user-data loss or namespace collision.
5. Docs, schemas, generated prompts and cache/version updates consistent with the implementation. No accidental files, private data, unused code, false metrics or misleading claims.
6. Actual commands, passed/failed/skipped counts and unverified physical-device behavior reported. A passing unit suite does not prove iOS PWA behavior; state explicitly if real hardware was unavailable.

For broad product implementation, follow the complete acceptance matrix rather than stopping at the first milestone. If a test cannot run, explain the environmental blocker and what was independently verified. Do not remove, weaken, skip or rewrite tests merely to make a suite green.

## 11. Git and change safety

Before edits, inspect `git status` and current branch. Preserve all user changes and untracked work. Never reset hard, clean untracked files, force-push, rewrite history, delete branches, or discard local changes without explicit authorization. Do not overwrite unrelated changes or assume a dirty file belongs to you. Work in the user-authorized branch. Keep diffs reviewable; do not commit unless requested, and never publish without authorization. Review `git diff --check` and tracked/untracked files before completion. Keep backup samples, private data, generated local artifacts, credentials and environment secrets out of version control.

## 12. Documentation and reporting

Maintain accurate setup, local run, install, offline limitations, backup/restore, import contract, test commands and deployment guidance. Document actual supported features, not future promises. Make major domain decisions explicit and update `ARCHITECTURE.md` only when the user has approved a changed requirement or when documenting a compatible implementation detail. Do not expose sensitive information in logs or reports.

At the end of a substantial task, report:

- Implemented behavior and major files/modules affected.
- Decisions made without explicit direction, and why they preserve the specification.
- Test commands with actual outcomes, failures and skipped/manual checks.
- Any remaining gap, risk, blocker, or action requiring user authorization.
- Git branch and working-tree status; whether anything was committed or published.

Keep the report precise. Never call the work complete if required functionality is still a placeholder or a known correctness issue remains unresolved.
