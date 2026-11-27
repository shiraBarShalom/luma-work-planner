# Luma - Visual implementation handoff

Companion to the normative `ARCHITECTURE.md` and `CLAUDE.md`. The architecture controls behavior; this document and the JSON references in `ui/` control appearance. Since v2 the product is deliberately minimal: the visual goal is a calm, native-feeling iPhone productivity app, not a dashboard.

## 1. Identity and design language

Brand: Luma. Hebrew, RTL, mobile-first, calm, elegant, personal and professional. Cream/off-white surfaces, muted blue, dark navy text, restrained champagne accents, subtle separators, gentle radii and quiet shadows. Tokens: `ui/00-design-system.json` (implemented in `css/luma.css`). Bundled Noto Sans Hebrew (OFL); no network fonts. Times, ratios and numeric dates are LTR-isolated inside RTL text. 44px minimum touch targets, visible focus, reduced-motion support, light and dark themes. Never render a fake device bezel or status bar.

Simplicity rules (apply to every screen, sheet and component):

- One purpose per screen, one clear hierarchy. One title per screen (the header) - no repeated headings.
- A date appears once per screen, in natural Hebrew (`יום שני, 30 בנובמבר`). No Hebrew-calendar dates.
- No instructional text for obvious interactions (dragging, keyboard shortcuts, autosave). No technical words. Keep validation errors, destructive confirmations, accessibility labels and genuine limitations.
- No decorative badges, counters, statistics or nested cards. Empty states are one short line, or just the add control.
- Prefer one obvious control over several equivalent ones.
- Typography: user-facing text uses only the standard short hyphen (-) - never the em dash (U+2014), en dash (U+2013) or Hebrew maqaf (U+05BE). This covers titles, labels, default schedule titles and notes, date and time ranges (`09:00-13:00`), buttons, menus, notifications, settings, dialogs, validation messages and the generated ChatGPT instructions. Do not rewrite user-entered data. `tests/unit/typography.test.js` and the browser layout checks enforce it.

## 2. Header and assets

The asset inventory is `ui/08-assets-manifest.json`. Runtime banners live in `assets/banners/` (from `design/assets/*.webp`); originals are kept byte-for-byte.

| Local Jerusalem time | Banner | Greeting |
|---|---|---|
| 05:00-08:00 | dawn | בוקר טוב, כרמית |
| 08:00-12:00 | day | בוקר טוב, כרמית |
| 12:00-17:00 | day | צהריים טובים, כרמית |
| 17:00-20:00 | sunset | ערב טוב, כרמית |
| 20:00-05:00 | night | לילה טוב, כרמית |

Fixed clock intervals (start-inclusive, end-exclusive, overnight wrap), re-evaluated at boot, resume and boundaries. Home header ≈176 CSS px plus the top safe area: edge-to-edge image, small Luma wordmark at the upper right, the greeting underneath, and on the left the notification bell and the add (+) button - nothing else (no search). Secondary screens use a ≈108px header with the screen title. Header controls sit below the status bar / Dynamic Island (`safe-area-inset-top`).

## 3. Screens

Bottom navigation (RTL): היום שלי, סדר היום, משימות, יומן, הגדרות. References: `ui/01a-home-approved.json` (canonical home), `02-agenda.json`, `03-calendar.json`, `04-tasks.json`, `07-add-task.json` (both editors), `09-coverage.json` (coverage list). Example data in the JSON files is illustrative only.

- **Home:** date line; current-activity card (label עכשיו / הפעילות הבאה, title, time range, remaining time, "אחר כך" line; several current activities listed compactly; otherwise one quiet line); inquiry counter card (פניות היום, large count / target, round − and + buttons, a thin progress bar, a small "איפוס" text button); `3 המשימות החשובות שלי להיום` list with checkboxes and an add-row button. No other content.
- **Agenda:** date navigation (arrows, the date itself opens the picker); segmented רשימה / ציר שעות; list cards with time, title, optional one-or-two-line note, checkbox and ⋯; timeline with side-by-side lanes for overlaps and one `הוספת פעילות` button; one notes field at the end.
- **Tasks:** segmented היום / הושלמו with a ⋯ button for more views; search field and priority-sort select in one row; on היום, the sections `משימות שלא הסתיימו עד היום` and `משימות להיום`. Rows: checkbox, priority color bar, title, small meta (original date, deadline), ⋯. A full-width soft `+ הוספת משימה` button closes the screen.
- **Calendar:** segmented חודש / שבוע / יום. Month: arrows + month select + year field, then the grid only (today filled in blue; small dots for one-off activities and deadlines; the recurring schedule is not marked). Week: date-range navigation + grid. Day: date navigation + grid + `הוספת פעילות`.
- **Settings:** small sections (daily target with inline save and a collapsed `היסטוריית פניות` disclosure: a total line and a plain list of date and count; notifications, appearance) and a short list of links (backup and restore, planning import, updates/storage/privacy).
- **Sheets:** bottom sheets with a grab handle, title, close button, one short form and a sticky footer (primary action; a red text "מחיקה" when editing). Dates show as Hebrew text with the native picker overlaid.

## 4. Verification

Check 320/390/430 CSS px and desktop, light/dark, long Hebrew titles, overlaps, keyboard, reduced motion and offline assets. Confirm no horizontal overflow, no clipped labels, no `null`/`undefined`, no repeated dates or titles. Physical iPhone checks must be reported separately from emulation.
