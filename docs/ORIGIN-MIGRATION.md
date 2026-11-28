# Moving Luma to its own origin

Status: approved in principle (organization `luma-workspace`). Steps are carried out one at a time; the current address keeps working until the new one is verified and the owner decides to retire it.

## Why

Browsers keep IndexedDB, localStorage and caches per origin (`https://host`), not per path. Luma currently shares `https://shirabarshalom.github.io` with the account's other GitHub Pages sites. A GitHub organization has its own `<org>.github.io` host, so Luma becomes the only app on that origin. Free; no domain, server or paid plan.

## Addresses

| | Address |
|---|---|
| Current (stays until retired) | `https://shirabarshalom.github.io/luma-work-planner/` |
| New | `https://luma-workspace.github.io/` |

The new repository is `luma-workspace/luma-workspace.github.io`, which GitHub serves at the organization's root. Luma uses only relative paths, so the code runs there unchanged. Keep the organization dedicated to Luma: any other Pages site in it would share the origin again.

## Ownership

- You create the organization and are its only owner; the repository belongs to the organization and you control it through the organization. Free organizations publish GitHub Pages from public repositories, so the repository stays public, as today.
- The approach is **copy, verify, then retire**: the new repository receives the same code and history; the personal repository is not changed, transferred or deleted.
- "Transfer repository" is not used: it would move the current site immediately and cut off the installed app before its data is backed up.

## Step 1 - create the organization (you, about 3 minutes)

GitHub does not let tools create organizations for a personal account; this step is yours.

1. Open https://github.com/organizations/plan (or profile picture → Settings → Organizations → New organization).
2. Choose **Free**.
3. Organization name: `luma-workspace`. Contact email: your own (GitHub keeps it private by default). "This organization belongs to": **My personal account**.
4. Skip inviting members. Finish.

Then tell me it exists. Everything after this I can do with the access the GitHub CLI already has (no new token, no secrets).

## Step 2 - publish the new copy (me, about 5 minutes)

1. Create the public repository `luma-workspace/luma-workspace.github.io` (empty).
2. Push the current `main` with its history. No code changes.
3. Enable Pages with source "GitHub Actions"; the existing pinned, least-privilege workflow runs the full test suite and deploys.
4. Verify `https://luma-workspace.github.io/`: HTTPS, the strict CSP, every screen, offline after first load, the update mechanism, and that no request leaves the origin.

Nothing about the current address changes in this step.

## Step 3 - move the iPhone app (you, about 5 minutes)

**Important: Safari and the Home Screen app keep separate data on iPhone.** The app you open from the Home Screen icon is the one holding your work data. Make the backup there, not in Safari.

1. Open Luma **from the Home Screen icon** (the current one).
2. Check it shows your real tasks and counter history.
3. הגדרות → גיבוי ושחזור → **ייצוא גיבוי** → save the file to Files (On My iPhone or iCloud Drive). Note the file name.
4. Open **Safari** and go to `https://luma-workspace.github.io/`.
5. Share button → **Add to Home Screen** → name it Luma → Add. You now have two Luma icons; the new one is usually the last icon on the last page.
6. Open the **new** icon. It starts empty: this is expected.
7. In the new app: הגדרות → גיבוי ושחזור → **בחירת קובץ גיבוי** → pick the file from step 3 → review → confirm the replacement.
8. Check in the new app: today's tasks and the unfinished ones, the schedule, the counter and its history, the import history, and the greeting name (restored from the backup; if it is missing, tap the greeting and type the name).
9. Allow notifications again in the new app if you use them (permission belongs to the address). Shortcuts automations need no change.
10. Use the new icon from now on. Keep the old icon untouched for a few days as a fallback. Changes made in one app do not appear in the other.
11. When satisfied, long-press the old icon → Delete App. This removes the old copy of the data from the phone.

If anything looks wrong at step 8, stop and keep using the old icon; nothing in it has changed.

## Step 4 - retire the old address (only on your separate approval)

After you have used the new app for a while:

1. Replace the old site with a single page saying Luma moved, with a link to the new address (or disable Pages for the old repository).
2. Archive the old repository (read-only). Deleting it is optional and needs separate approval; history rewriting is not part of this plan.

## What changes and what does not

- Changes: the address and Home Screen icon (new install), notification permission, small view preferences (list or timeline, calendar mode, the once-a-day celebration flag) start fresh.
- Unchanged: the code, data format, backups, offline behavior, security protections, cost (0).
- Data never passes through any server: the backup file goes from the old app to Files to the new app on the same phone.
