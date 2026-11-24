# Luma — Visual implementation handoff

This is the companion visual specification to the normative `ARCHITECTURE.md` and permanent `CLAUDE.md` in the repository root. Use the supplied JSON descriptions and actual local artwork. They describe the desired visual language, not hard-coded data or replacement business rules. The architecture controls functionality; the approved home reference controls visual hierarchy. Every architecture feature must have a working, discoverable UI even if no individual mockup was supplied.

## 1. Identity and design language

Product brand: Luma. The Hebrew work planner is mobile-first, RTL, calm, elegant, personal and professional. Use cream/off-white surfaces, muted blue, dark navy text, restrained champagne accents, subtle separators, gentle corner radii and quiet shadows. Avoid busy dashboards, excessive card nesting, decorative clutter, motivational messages, personal goals and project management. Use the supplied light/dark palettes, typography scale, touch targets and spacing in `ui/00-design-system.json` as the starting tokens; adjust contrast and density where needed. Prefer a licensed bundled Hebrew font or system fallback; no network fonts. Numeric dates, ratios and times need LTR isolation within RTL text. Use consistent icons, 44px minimum touch targets, visible focus, semantic controls and reduced-motion support. Never render a fake iPhone bezel, clock or status bar.

## 2. Local assets and dynamic header

The asset inventory is `ui/08-assets-manifest.json`. All paths in it are relative to `design/ui/`. Original JPEGs in `assets/originals/` are retained byte-for-byte; optimized WebP banners are included in `assets/`. Copy the runtime assets to an appropriate relative app asset path, update the worker precache list, and keep the source-to-runtime mapping documented. Do not depend on chat attachment IDs, remote URLs or generated imagery.

| Local Jerusalem time | Active banner | Hebrew greeting |
|---|---|---|
| 05:00–08:00 | `banner-dawn.webp` | בוקר טוב, כרמית |
| 08:00–12:00 | `banner-day.webp` | בוקר טוב, כרמית |
| 12:00–17:00 | `banner-day.webp` | צהריים טובים, כרמית |
| 17:00–20:00 | `banner-sunset.webp` | ערב טוב, כרמית |
| 20:00–05:00 | `banner-night.webp` | לילה טוב, כרמית |

These are configurable fixed clock intervals, not a live astronomical calculation. Use `Asia/Jerusalem`, the same clock abstraction as the architecture. Intervals are start-inclusive/end-exclusive, including overnight wrap. Re-evaluate at boot, resume, visibility changes and time boundaries while visible. No background execution or network is necessary. The extra `banner-dawn-alternate.webp` is an optional visual alternative; no automatic random rotation. Test the five boundary times and midnight with a fake clock. Respect reduced motion for any subtle crossfade.

Home: edge-to-edge desk/window image, small upper-right Luma wordmark, dynamic live greeting underneath, search/alerts at the left, no decorative line or wave below greeting. Use approximately 190 CSS px at the 390px reference width, responsive image cropping, sufficient safe-area space and contrasting text (especially on the night image). A subtle scrim is acceptable. Keep text separate from image pixels. Secondary pages can use a shorter header (~108px), consistent with the reference descriptions, without the large greeting. A live text Luma wordmark is the fallback: a separate transparent sunrise wordmark was not supplied. Do not invent or claim to have that artwork. The square L monogram artwork is provided as `assets/originals/luma-app-icon-reference.jpg`. Prepare production full-bleed 192/512 and Apple touch icons from that reference, trimming surrounding mockup margin and preserving the monogram, then verify the maskable safe area or omit unsupported maskable claims. Do not use a stretched square icon as a header wordmark.

## 3. Screen references and navigation

Use `01a-home-approved.json` as the canonical home layout. `01-home.json` is supplementary only. The remaining JSON files provide layout and component references: agenda, calendar, tasks, team/meetings, pending questions, add-task sheet. They are not actual screenshot binaries. Example numbers, dates, meeting times, labels and workplace content are illustrative only. Use neutral starter data and real persisted selectors; no literal example task records, fake counters or technical workplace examples in production.

Keep the fixed primary bottom navigation in this RTL order: היום שלי, סדר היום, משימות, יומן, הגדרות. Keep the active style consistent. Team/meetings, pending questions, reports, inquiry history, focus, and work tools are accessible through home shortcuts, appropriate context actions, and secondary routes. Preserve back navigation. Use a responsive desktop layout without losing any route. Home shortcuts should include direct add-task, inquiry completion, meetings, questions and reports; only actual completed inquiry actions increment the counter.

### Home and tasks: mandatory separation

Home should retain current/next activity, live remaining time, workday context (date, location, duty), inquiry ring and quick increment, workday progress, three priorities, and concise action shortcuts. Add a mandatory section titled `משימות שלא הסתיימו עד היום` distinct from today's new task list. The same section must be visible in the Today filter of Tasks. Render the same canonical task IDs and completion state in both locations; retain original dates and deadlines, label age where helpful, and use a quiet empty state when none are outstanding. This is not an optional configurable widget. It must appear automatically on the next effective workday after a task is left unchecked, regardless of whether closing was done or the app was opened in between. Keep waiting, deferred, future and routine checklist rules aligned with the architecture. Do not invent duplicate records.

### Other screens

- Agenda: live timeline, real editable schedule, overlapping phone-duty indicator independent from the grid, completed/current/partial/future/overrun/canceled states and non-drag editing alternatives.
- Calendar: correct Sunday-first Hebrew RTL month grid, week hourly layout, day view, actual date markers and accessible navigation. No copied mockup date errors.
- Tasks: clear grouping, status, priority, deadlines, subtasks, recurrence, waiting and history; add/edit bottom sheet with only title required for ordinary quick entry, advanced fields progressively disclosed.
- Team/meetings and questions: shared records, direct question and topic entry, questions without a scheduled meeting, incoming/team and manager views, ad hoc meeting scheduling, answers, decisions, task conversion and archive; separate answered from open. No pre-created formal team meetings.
- All remaining screens in `ui/09-coverage.json`: design with the same tokens and component rules, implement their full architecture requirements (counter, reports, settings, focus, closing, import, exports, week/day calendar, work tools). No fabricated screenshot claims.
- Exports: coherent Luma typography/colors, print-friendly, no fake device chrome, Hebrew RTL; avoid clipped content. Schedule PNG should paginate as specified in the architecture.

## 4. Interaction and verification

Use accessible sheets/dialogs, safe-area-aware sticky actions and keyboard-safe layouts. Show actual empty/loading/error/offline/save states, never imply persistence or an action succeeded if it did not. Use real controls for counter corrections, checkboxes, search, navigation, import, scheduling and exports. Validate responsive layouts at 320/390/430 CSS px and desktop; test dark/light, Hebrew strings, long content, contrast, reduced motion, and keyboard interactions. Check all assets load offline and the header updates after resuming. Physical iPhone checks must be reported separately from emulation. Do not compromise business invariants to match an illustrative visual layout.
