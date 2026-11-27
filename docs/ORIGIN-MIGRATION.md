# Moving Luma to its own origin (plan - not executed)

Status: proposal awaiting approval. Nothing here has been done. The current address keeps working until the owner approves each step.

## Why

Browsers keep IndexedDB, localStorage and caches per origin (`https://host`), not per path. Luma currently shares `https://shirabarshalom.github.io` with every other GitHub Pages site of the account. A GitHub organization has its own `<org>.github.io` host, so Luma would be the only app on that origin. Free; no domain, server or paid plan needed.

## Choices to make first

1. **Organization name.** It becomes part of the address and is public. Use a neutral name with no personal name, e.g. `luma-planner` (availability is checked when creating it).
2. **Address shape.**
   - Recommended: a repository named `<org>.github.io` gives `https://<org>.github.io/`. Luma uses relative paths, so it runs at the root unchanged. Keep the organization dedicated to Luma: any other Pages site in it would share this origin again.
   - Alternative: keep the repository name `luma-work-planner` → `https://<org>.github.io/luma-work-planner/`.

## Ownership

- You create the organization and are its only owner. The repository belongs to the organization; you keep full control through it. A free organization supports public repositories with GitHub Pages; Pages from a private repository needs a paid plan, so the repository stays public.
- Recommended approach: **copy, verify, then retire**. A second repository in the organization gets the same code and history. The existing personal repository stays untouched until the move is verified, so the current app keeps working throughout.
- Not recommended as the first step: "Transfer repository". It moves the repository and history immediately, and the old Pages address stops working at once, which would cut off the installed app before its data is backed up.

## Steps (each only after approval)

On GitHub (about 10 minutes):

1. github.com → profile picture → Your organizations → New organization → **Free** plan → name, your email as contact.
2. In the organization, create an empty public repository (`<org>.github.io`).
3. I push the current `main` with its full history to the new repository, and change nothing else in the code. The deploy workflow is already included.
4. New repository → Settings → Pages → Source: **GitHub Actions**. Run the workflow and verify the new address (HTTPS, offline cache, all tests).

On the iPhone (about 5 minutes; nothing is lost if it is interrupted):

5. In the **current** Luma: Settings → גיבוי ושחזור → ייצוא גיבוי → save to Files.
6. Open the **new** address in Safari → Share → Add to Home Screen.
7. In the new app: Settings → גיבוי ושחזור → בחירת קובץ גיבוי → choose the file → confirm. Tasks, schedule changes, counts and history, notes, the greeting name and import history are restored.
8. Check the new app: today's tasks, the schedule, the counter history, the greeting.
9. Grant notifications again in the new app (permission is per origin). Shortcuts automations are not affected.
10. Keep the old icon for a few days. Then delete the old Home Screen icon, which removes the old copy of the data from the phone.

Retiring the old address (only after approval, once the new one is in use):

11. Replace the old site with a one-line "Luma moved" page (or disable Pages for the old repository), then archive the old repository. Deleting it is optional and needs separate approval.

## What changes and what does not

- Changes: the address and Home Screen icon (new install), notification permission, view preferences (list or timeline, sort order) start fresh.
- Does not change: the code, the data format, backups, offline behavior, security protections, cost (0).
- Data never passes through any server: the backup file goes from the old app to Files to the new app on the same phone.
