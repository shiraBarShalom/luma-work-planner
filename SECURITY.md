# Luma security and privacy

Audit of the deployed application (v2.0.1, 27 November 2026), with fixes shipped in v2.1.0. Luma is a static, local-only PWA: no backend, no account, no analytics, no remote storage, no runtime third-party code. This is a design decision and stays unless the owner changes it.

This document describes protections and how they are checked. Tests show that known attack paths are closed. They cannot prove that no flaw exists, and they do not cover the browser, the operating system, or code on the same origin that Luma does not control (see "Shared origin").

## Protections and how they are verified

| Protection | How it is checked |
|---|---|
| The app makes no network requests to other origins; user data is not sent anywhere by Luma's code. Data leaves the device only through user actions: exporting a backup, copying the ChatGPT instructions (fixed-schedule titles and times only), or notifications shown on the device. | CSP `connect-src 'self'` with no other origins; no third-party scripts, fonts or images; a browser test records every request during use and offline and fails on any outside request. |
| User, imported and restored text is displayed as text, never as HTML or script. | Code review: only static icon markup uses `innerHTML`, and a check fails the build on any other use. Browser test: a plan with `<img onerror>`, `<script>` and `<svg onload>` in titles and notes is imported and shown literally, with no element created and no script run. CSP without `'unsafe-inline'` or `'unsafe-eval'`; tests fail on any CSP violation on every screen in Chromium and WebKit. |
| Plan and backup files are handled as untrusted data. | `JSON.parse` only; size limits (plan 1 MiB / 500 items, backup 30 MiB) and nesting limit checked first; `__proto__`, `constructor`, `prototype` keys rejected; strict field, type, length and enum checks; the whole document validated before a restore. Unit tests cover polluted, oversized, too-deep, unknown-field and wrong-type files. Nothing changes until the user approves; a recovery copy is saved first. |
| Automated changes cannot alter recurring activities. | Store-level check on every automated command; unit tests with deliberately faulty commands. |
| App updates do not touch user data. | The service worker caches only the app's own files, never stores network responses, deletes only Luma's own caches and never touches IndexedDB. Browser tests and a live check updated an installed v1 app and v2.0.0 through to the current version with the data intact. |
| Work text is not copied into secondary storage. | Task search is kept in memory; older stored search text is deleted on startup; localStorage holds only view preferences. Browser test. |
| The deploy pipeline cannot be changed through a moved Action tag. | Actions pinned to commit SHAs, least privilege per job, no persisted token. |

## Limitations of browser-based local storage

- **Not encrypted by Luma.** IndexedDB data is stored in plain form inside the browser profile. On an iPhone with a passcode, iOS encrypts stored data at rest, and that is the protection that applies. Anyone who can unlock the phone, or open the browser profile on a computer, can read the data.
- **Shared origin.** Luma runs at `https://shirabarshalom.github.io/luma-work-planner/`. Browsers separate storage per origin (scheme + host), not per path. Every site published from the same GitHub account shares this origin: today Life Planner and Gemini-Quote-Reply. Code running in any of them can technically read or delete Luma's IndexedDB and localStorage. Unique storage names prevent accidental collisions, not deliberate access. A move to a separate origin is planned (`docs/ORIGIN-MIGRATION.md`).
- **Can be lost.** Clearing website data, removing the Home Screen app, iOS storage eviction, private browsing or a new phone can delete local data. Exported backups are the only copy outside the device.
- **Backups are plain JSON.** Whoever gets the file can read it. Files saved to iCloud Drive follow iCloud's protection.
- **Deleted items linger briefly.** Up to 5 automatic recovery copies can still contain recently deleted items until they rotate out. There is no in-app "erase everything"; Safari's website-data settings remove all of it.
- **Notifications** appear on the lock screen and in Notification Center. The default text is generic; activity titles appear only if the user turns that on.
- **Framing.** GitHub Pages cannot send `frame-ancestors`, and a `<meta>` CSP cannot set it, so another site could embed Luma in a frame. Current Safari, Chrome and Firefox give a third-party frame separate storage, so it does not see the user's data.

## Findings

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | Shared origin with the account's other GitHub Pages sites (see above). A future repository named `shiraBarShalom.github.io` would serve the site root and could register a root-scoped service worker. | Medium | **Open; migration to `https://luma-workspace.github.io/` approved and in progress (organization to be created by the owner).** Until then, do not create a `shiraBarShalom.github.io` repository and keep the other sites free of untrusted code. |
| 2 | Deploy workflow: Actions by movable tags, broad permissions for every job, token left in the workspace. | Medium | Fixed (v2.1.0). |
| 3 | Task search text stored in localStorage outside the app's data store. | Low | Fixed (v2.1.0); old values deleted on startup. |
| 4 | CSP allowed inline styles and `blob:` images. | Low | Fixed (v2.1.0). |
| 5 | A crafted backup could store non-text values in some text fields (display glitches only). | Low | Fixed (v2.1.0). |
| 6 | Uncaught error after approving an import. | Low (bug) | Fixed (v2.1.0). |
| 7 | Development server reachable from the local network. | Low (dev only) | Fixed (v2.1.0). |
| 8 | Personal information in the public repository. Current files: no names (fixed in v2.1.0: the greeting name now comes only from local data). Git history: the first name appears in files of 4 earlier commits (design handoff, seed, tests) and is retrievable from history. The author's name and email appear in every commit's metadata. No other personal data was found in any commit: no phone numbers, addresses, employer names, credentials or keys. | Low | Current files fixed. History unchanged: removing it requires rewriting history and force-pushing, which needs the owner's approval. GitHub's no-reply address can be used for future commits. |
| 9 | Data at rest not encrypted by the app; backups plain JSON; recovery copies keep deleted items briefly. | Limitation | Documented. Possible future features, each only with approval: password-protected backups, an "erase all data on this device" action. |

Checked without findings: no secrets, tokens or keys in any commit; no runtime dependencies, and `npm audit` reports 0 vulnerabilities in the development dependencies; the service worker serves only same-origin GET requests in its scope and the other same-origin apps cannot place a worker in Luma's scope; Life Planner's live code uses its own storage names and deletes only its own caches.

Regression tests: `tests/unit/security.test.js`, `tests/unit/typography.test.js`, and the security, CSP and layout checks in `tests/browser/run.mjs`.
