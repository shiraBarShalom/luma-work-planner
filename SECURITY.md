# Luma security and privacy

Audit of the deployed application (v2.0.1, audited 27 November 2026; fixes shipped in v2.0.2). Luma is a static, local-only PWA: no backend, no account, no analytics, no remote storage, no runtime third-party code. That decision is permanent unless explicitly changed by the owner.

## What Luma guarantees

- **No data leaves the device through the app.** The CSP allows network requests only to Luma's own origin (`connect-src 'self'`), there is no runtime third-party code, no telemetry, no fonts or images from other hosts, and a browser test fails if any outside request is made. The only ways data leaves are actions the user takes: exporting a backup, copying the ChatGPT instructions (which contain only the fixed schedule's titles and times), and notifications shown on the device.
- **No script injection from content.** All user, imported and restored text is inserted with `textContent`. The only `innerHTML` writes static icon markup chosen in code. The CSP forbids inline scripts, `eval`, inline styles, plugins and frames, and tests check for policy violations on every screen.
- **Untrusted files are treated as data.** Plan imports and backups are parsed with `JSON.parse` only, after size limits (plan 1 MiB / 500 items, backup 30 MiB) and a nesting-depth limit. Prototype-pollution keys are rejected. Every field is type-, length- and enum-checked. Unknown fields are rejected in plans, and the full document is validated before a restore. Nothing changes until the user approves, and a recovery copy is saved first.
- **Recurring activities cannot be changed by automated code** (store-level check).
- **Updates never touch user data.** The service worker caches only the app's own files, never stores network responses, deletes only Luma's own caches, and never touches IndexedDB.

## What browser storage does not guarantee (limitations)

- **Not encrypted by Luma.** IndexedDB holds the data in plain form inside the browser profile. On an iPhone with a passcode, iOS encrypts app data at rest, and that is the protection that applies. Anyone who can unlock the phone, or a computer profile, can read the data.
- **Shared origin.** Luma runs at `https://shirabarshalom.github.io/luma-work-planner/`. Browsers isolate storage per origin (scheme + host), not per path. Every site published from the same GitHub account shares this origin: today Life Planner (`/life-planner/`) and Gemini-Quote-Reply (`/Gemini-Quote-Reply/`). Code running in any of them can technically read or delete Luma's IndexedDB and localStorage. Luma's unique names prevent accidental collisions, but they are not a security boundary. See finding 1.
- **Can be lost.** Clearing website data, removing the Home Screen app, iOS storage eviction, private browsing or a new phone can delete local data. Exported backups are the only copy outside the device.
- **Backups are plain JSON.** Whoever gets the file can read it. Files saved to iCloud Drive follow iCloud's protection.
- **Deleted items linger for a while.** Up to 5 automatic recovery copies (daily, and before imports, restores and upgrades) can still contain recently deleted tasks until they rotate out. There is no in-app "erase everything"; Safari's website-data settings remove it all.
- **Notifications.** When shown, they appear on the lock screen and in Notification Center. By default the text is generic (`פעילות מתחילה עכשיו`); activity titles appear only if the user enables that option.
- **Clickjacking header.** GitHub Pages cannot send `frame-ancestors` and a `<meta>` CSP cannot set it, so another site could frame Luma. A framed copy runs with partitioned storage in current Safari, Chrome and Firefox, so it does not see the user's data.

## Findings

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | Luma shares its origin with every other GitHub Pages site of the account (Life Planner, Gemini-Quote-Reply). A compromised or buggy same-origin app could read or delete Luma's data. A future repository named `shiraBarShalom.github.io` would serve the site root and could register a root-scoped service worker. | Medium | **Open; needs an owner decision.** Options: publish Luma from a free GitHub organization (its own `<org>.github.io` origin), or a custom domain. Moving origin requires exporting a backup and restoring it on the new address, because browser data is per origin. Until then, do not create a `shiraBarShalom.github.io` repository and keep the other sites free of untrusted code. |
| 2 | The deploy workflow used third-party Actions by movable tags, gave Pages-write and OIDC permissions to every job, and left the checkout token in the workspace. A compromised action could have altered the published app. | Medium | **Fixed:** all Actions pinned to full commit SHAs (same versions), least-privilege permissions per job, `persist-credentials: false`. |
| 3 | The task search text was saved in localStorage, outside the app's data store and outside backups, and stayed there after the tasks were deleted. | Low | **Fixed:** search text is kept in memory only. Values left by earlier versions (`taskSearch`, `taskCat`) are deleted on startup. |
| 4 | The CSP allowed inline styles (`'unsafe-inline'`) and `blob:` images, neither of which is needed. | Low | **Fixed:** `style-src 'self'`, `img-src 'self' data:`, plus `frame-src 'none'` and `media-src 'none'`. Tests fail on any CSP violation in Chromium and WebKit. |
| 5 | A crafted backup could store non-text values in activity notes, occurrence titles/notes or day notes. No script could run, but screens could misrender. | Low | **Fixed:** these fields are type- and length-checked on restore. Existing data was verified to remain valid. |
| 6 | After approving an import, a pending preview refresh threw an uncaught error. No data impact. | Low (bug) | **Fixed.** |
| 7 | The development server listened on all network interfaces. It serves app files only, never data. | Low (dev only) | **Fixed:** binds to `127.0.0.1` unless `HOST` is set. |
| 8 | Public repository: git commit metadata shows the author's email, and the default greeting contains a first name (`כרמית`) in `js/seed.js` and the design files. The fixed schedule describes the work routine. | Informational | Open, owner choice: GitHub's no-reply commit email for future commits; change the default name (a visible UI change). History was not rewritten (destructive). |
| 9 | Data at rest is not encrypted by the app; backups are plain JSON; recovery copies retain deleted items briefly. | Limitation | Documented above. Possible future features, each only with approval: password-protected backups (WebCrypto AES-GCM), an "erase all data on this device" action. |

Verified without findings: no secrets, tokens or keys in any commit; no runtime dependencies, dev dependencies `npm audit` 0 vulnerabilities; no HTML injection paths; no runtime network origins; JSON import and backup restore reject polluted, oversized, too-deep, unknown-field and wrong-type input without changing data; the service worker serves only same-origin GET requests in its scope and cannot be taken over by the other same-origin apps (they cannot serve files under `/luma-work-planner/`); notifications default to generic text; Life Planner's live code uses its own storage names and deletes only its own caches.

Regression tests: `tests/unit/security.test.js`, `tests/unit/typography.test.js`, the security and layout checks in `tests/browser/run.mjs`.
