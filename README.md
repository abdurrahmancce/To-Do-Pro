# To-Do Pro

An installable to-do app (PWA) for phone, laptop and PC. Tasks sync across devices, reminders ring even when the app is closed, and the whole stack runs on free services.

**Live app:** https://abdurrahmancce.github.io/To-Do-Pro/
**User guide (English and Bangla):** open `help.html`, or *Account → Help* inside the app.

---

## Contents
1. [Features](#features)
2. [Release status](#release-status)
3. [Architecture](#architecture)
4. [Project history](#project-history)
5. [Security](#security)
6. [Testing](#testing)
7. [Quick start for users](#quick-start-for-users)
8. [Setup for the owner](#setup-for-the-owner-one-time)
9. [Deploying updates](#deploying-updates)
10. [Repository layout](#repository-layout)
11. [Known limitations and recommendations](#known-limitations-and-recommendations)

---

## Features

**Tasks**
- Quick add with natural language: `Call mom tomorrow 6pm !high #family`. Understands dates, times, priority (`!high`) and sections (`#family`). Also recognises common Bangla and Banglish time words.
- Priorities, due dates, sections, notes, repeating tasks (daily / weekly) with streak tracking.
- Views: All, Today, Upcoming, Calendar (month and week), Completed, Trash, Reminders, Weekly summary.
- Search, swipe actions, drag to reorder, bulk select (done, move to tomorrow, delete) with undo.
- Keyboard shortcuts: `n` new task, `/` or `Ctrl+K` search, `Ctrl+Enter` save in the editor.

**Safety net for your data**
- **Autosave** on every change, online and offline. Closing the editor, switching apps or leaving the page also saves.
- **Undo** for 5 seconds after any delete.
- **Trash** keeps deleted tasks for 30 days; restore, delete forever, or empty the trash. Trash syncs across devices. Items older than 30 days are removed automatically.
- Export and import of tasks as JSON (import is size-limited and validated).

**Accounts and sync**
- Email + password sign-in, account creation and password reset (minimum 6 characters live, 8 after the pending update). Optional Google sign-in. Optional guest mode (data stays on that device).
- Firebase Firestore sync across devices with offline cache; edits made offline sync when the connection returns.
- Animated login screen shown in English and Bangla side by side.

**Reminders**
- In-app alarm popup with sound (custom length), Done and Snooze.
- Background push reminders that arrive when the app is closed (Firebase Cloud Messaging + Cloudflare Worker).
- Heads-up reminder before the alarm (optional) and a backup reminder 90 seconds later if you have not responded.
- Done and Snooze buttons directly on the notification. Handling a reminder on one device dismisses the notification on the others.

**Look and feel**
- Light and dark themes, accent colours, responsive layout from 320px phones to desktop.
- English-only app interface; Bangla and English appear together only on the login screen and the user guide.
- Installable on Android, iPhone, Windows and Mac.

---

## Release status

| Area | Status |
|---|---|
| Core app, sync, Trash, autosave, bilingual login and guide, background push reminders | Live |
| Spellcheck turned off in text fields (Bangla typing no longer underlined) | Live |
| Security hardening: `worker/index.js`, `firestore.rules`, `cloud.js` sign-out cache clearing, `auth.js` 8-character password minimum, `SETUP.md` / `PUSH-SETUP.md` updates | Prepared and tested, **not yet deployed** |
| Usage analytics (GoatCounter) | Planned, not added |

Until the pending hardening update is deployed, the live app still accepts 6-character passwords and the previous Firestore rules and worker remain in use. Sections below describe the full repository state, and each item is marked where it depends on the pending update.

---

## Architecture

```
 Browser / installed PWA                          Google Firebase                  Cloudflare
 ┌──────────────────────────────┐   sync    ┌───────────────────────────┐        ┌───────────────────────┐
 │ index.html  style.css        │◄─────────►│ Auth (email / Google)     │        │ Worker (cron, 1 min)  │
 │ script.js  (app + alarms)    │           │ Firestore                 │◄──────►│  - reads due reminders│
 │ auth.js    (login screen)    │           │   users/{uid}/tasks       │  REST  │  - sends FCM push     │
 │ cloud.js   (Firebase layer)  │           │   users/{uid}/devices     │        │  - /act endpoint for  │
 │ quickparse.js, habits.js     │           │   users/{uid}/settings    │        │    Done / Snooze      │
 │ sw.js (offline, push)        │◄──push────│   reminders/{id} (queue)  │        └───────────────────────┘
 └──────────────────────────────┘   (FCM)   └───────────────────────────┘
```

- **Hosting:** GitHub Pages (static files only, no server to maintain).
- **Offline:** `sw.js` precaches the app shell and handles push events; a local cache keeps tasks available without a connection.
- **Data model:** every task is a Firestore document; deleted tasks carry a `deletedAt` timestamp (soft delete) which is how Trash syncs.
- **Reminders:** when a task has an alarm, the app writes a small mirror document in `reminders/`. The worker runs every minute, sends the push for due items to all registered devices of that user, then marks the task as fired or schedules the next repeat. Notification buttons call the worker's `/act` endpoint with an HMAC signature, so no login is needed on the notification itself.
- **Cost:** Firebase free tier, Cloudflare Workers free plan, GitHub Pages. No paid services.

---

## Project history

The app was built in stages. Each stage was tested and confirmed working before the next began.

### Stage 1: Core app
- Task list with title, notes, due date, section and priority (low, medium, high).
- Views: All, Today, Upcoming, Calendar (month and week), Completed.
- Search, swipe actions, drag to reorder, bulk select, undo, weekly summary with progress ring.
- Light and dark themes with selectable accent colours.
- JSON export and import.
- Installable PWA with an offline cache (`sw.js`, `manifest.webmanifest`).

### Stage 2: Smart input
- Quick-add parser that reads dates, times, priority (`!high`) and sections (`#family`) from one sentence, including common Bangla and Banglish time words.
- Saved quick-add draft so half-typed tasks survive a reload.

### Stage 3: Cloud sync
- Firebase Authentication (Google) and Firestore sync across devices.
- Per-user data (`users/{uid}/tasks`), offline persistence, instant start from a local cache.
- Guest mode for use without an account.

### Stage 4: Reminders
- In-app alarm engine with popup, sound of configurable length, Done and Snooze.
- Repeating alarms (daily, weekly) with habit-style streak tracking.
- Background push reminders with Firebase Cloud Messaging and a Cloudflare Worker that runs every minute.
- Heads-up reminder before the alarm, and a backup reminder 90 seconds after the main one if you have not responded.
- Done and Snooze directly on the notification, authenticated with a signed request to the worker.
- Handling a reminder on one device dismisses the notification on the other devices (tested on a real phone and PC).
- Push-token self-healing and automatic removal of dead tokens.

### Stage 5: Email and password login
- Animated login screen: sign in, create account, reset password, show/hide password, clear error messages.
- Google sign-in kept as an option.
- Guest mode kept as an option.
- Firebase setup documented (enable Email/Password, authorized domain).

### Stage 6: Documentation
- Bilingual user guide (`help.html`) with working navigation in both languages.
- Owner setup guides: `SETUP.md` (Firebase) and `PUSH-SETUP.md` (push worker).
- Login page and guide shown in English and Bangla; the app itself uses English only.

### Stage 7: Data safety and polish
- **Trash:** deleted tasks stay for 30 days, restore or delete forever, empty trash; synced across devices; 5-second undo after delete.
- **Autosave:** every change is saved automatically while the editor is open, online or offline, with a visible save status.
- English-only interface text; restyled dropdown; account dialog closes on sign-out; bell animation fixed; Bangla guide links fixed.

### Stage 8: Review, testing and hardening
- Full project post-mortem and bug hunt.
- Automated browser test suite (34 checks, all passing).
- Security fixes for the worker, client data handling, sign-out privacy, password length and database rules (see [Security](#security)). Prepared and tested, pending deployment.
- Spellcheck turned off in text fields, and the autosave status text no longer rewrites the page when unchanged, so Bangla typing is clean and the mobile keyboard stays steady (deployed).

### Problems found and fixed along the way
- Stale downloaded files overwriting repository files (resolved with rename steps).
- Duplicate element ids that broke the Bangla guide links.
- An alarm bell animation clashing with an existing style.
- Push tokens going stale across sessions.
- Autosave racing with the editor's close event.
- Account dialog staying open above the login screen after sign-out.
- A task coming back after delete when autosave was still pending (found in review, fix pending deployment).

---

## Security

A full review was done in stage 8. Findings and fixes below are prepared in the repository files and are pending deployment (see [Release status](#release-status)):

| ID | Severity | Finding | Fix |
|---|---|---|---|
| W1 | High | Worker used user and task ids inside database paths without validation, allowing a crafted reminder to point at another user's data. | All ids must match `^[A-Za-z0-9_-]{1,128}$`; invalid reminders are discarded. |
| W2 | Medium | `/act` requested a Google token before checking the signature, so spam could burn the free quota. | Signature is verified first, body limited to 2 KB, access token cached. |
| W3 | Low | Non constant-time signature compare. | Constant-time compare. |
| W4 | Low | CORS open to all origins; error text leaked internals. | CORS limited to the app's origin; generic error response. |
| W5 | Low | Task titles written to worker logs. | Titles removed from logs. |
| C1 | Medium | Malformed or hostile task data (bad dates, oversized text, odd ids, 20,000-item import) could crash rendering or the browser. | Every task is normalised on load/import: ids sanitised, dates validated, lengths capped (title 200, notes 2000, section 100); import limited to 2,000 tasks / 5 MB. |
| C2 | Medium | Deleting a task right after typing in the editor could bring it back (autosave race). | Pending autosave is cancelled on delete. |
| C3 | Medium | Task data stayed in the browser after sign-out. | Sign-out waits for pending writes, then clears local and Firestore caches. |
| C4 | Low | Minimum password length 6. | Raised to 8. |
| R1 | Medium | Firestore rules had no field validation. | New `firestore.rules`: owner-only access, size and type limits on tasks and reminders. |

Also verified: all user text is HTML-escaped before display; XSS payloads in title, notes and section never execute in any view.

---

## Testing

An automated Playwright suite (headless Chromium) runs the real app with an in-memory stand-in for Firebase. **34 of 34 checks pass.** It covers:

- Boot with no console errors; quick add (including Banglish phrases); complete, edit, delete, Trash, restore, delete forever, empty trash
- Search, calendar, weekly summary, account and reminders dialogs, keyboard shortcuts, bulk select with undo
- Autosave: no duplicate task creation, no resurrection after delete, past alarms not stored until confirmed
- XSS payloads across every view; corrupt and malicious stored data; valid, malformed and oversized import files
- Alarm popup rings when due; cloud add / soft-delete flow; sign-out clears the local cache
- Layout at 320, 375 and 768 px (no horizontal overflow) and the login screen at 360 px
- Every file referenced by the HTML, manifest and service worker exists, and the service worker caches all app modules
- Worker `/act` endpoint: traversal ids, bad signatures, bad actions, oversized and malformed bodies are all rejected before any Google call

Real Firebase, Google sign-in, FCM delivery and the new Firestore rules cannot be run in the test sandbox, so they are verified manually after each deploy (see [Deploying updates](#deploying-updates)).

---

## Quick start for users

1. Open the app and tap **Create account**. Enter name, email and a password (8+ characters after the pending update, 6+ today).
2. Add tasks with **+**. Set a date, time and **Alarm** for reminders.
3. Sign in with the same email on your other devices to see the same tasks.
4. Turn on **Account → Background notifications** on each device for reminders when the app is closed.
5. Install the app from the browser menu (Add to Home screen / Install app).

---

## Setup for the owner (one time)

1. **Firebase:** follow `SETUP.md`, then paste the config into `firebase-config.js`.
2. **Enable email login:** Firebase Console → *Authentication* → *Sign-in method* → **Email/Password** → Enable → Save. Add **Google** there too if you want the Google button.
3. **Authorized domain:** *Authentication* → *Settings* → *Authorized domains* must include `abdurrahmancce.github.io`.
4. **Firestore rules:** paste the contents of `firestore.rules` into Firestore → *Rules* → Publish.
5. **Background push:** follow `PUSH-SETUP.md` (Cloudflare Worker, service account secret, `WORKER_URL`).
6. **Publish** with GitHub Pages.

---

## Deploying updates

1. Replace the changed files in the project folder, then:
   ```
   git add .
   git commit -m "Describe the change"
   git push
   ```
2. Bump `VERSION` in `sw.js` on every release so installed apps refresh.
3. If `worker/index.js` changed: `cd worker` then `npx wrangler deploy`.
4. If `firestore.rules` changed: paste it in the Firebase console. Keep the previous rules somewhere for rollback.
5. Wait 1-2 minutes, then reload the app twice (or close and reopen the installed app).
6. Smoke test: sign in, add a task with an alarm, confirm a document appears in the `reminders` collection, sign out and sign back in.

---

## Repository layout

| File | Purpose |
|---|---|
| `index.html`, `style.css`, `script.js` | App UI and logic |
| `auth.js` | Animated bilingual email/password login screen |
| `cloud.js` | Firebase Auth, Firestore sync, push registration |
| `quickparse.js` | Natural-language quick-add parser |
| `habits.js` | Repeat and streak helpers |
| `help.html` | User guide (English and Bangla) |
| `sw.js`, `manifest.webmanifest`, `icons/` | Offline cache, push handling, install metadata |
| `firebase-config.js` | Firebase web config and worker URL |
| `firestore.rules` | Database security rules |
| `worker/` | Cloudflare Worker that sends scheduled push reminders |
| `SETUP.md`, `PUSH-SETUP.md` | Owner setup guides |

---

## Known limitations and recommendations

- **Open sign-up:** anyone can create an account, and an account can queue reminders for the shared worker. After your own accounts exist, disable new sign-ups: Firebase → Authentication → Settings → User actions.
- **Restrict the Firebase API key** to `abdurrahmancce.github.io` in Google Cloud Console (APIs & Services → Credentials). Enable the Firebase password policy and email-enumeration protection.
- Rotate the service-account key if it was ever shared or committed.
- Push reminders on iPhone require the app to be installed to the Home screen.
- The worker runs every minute and sends at most 5 reminders per run to stay inside the free plan.
- A Content Security Policy is not yet set; add one only after testing Google and email sign-in on the live site.
- Usage analytics are not included. A privacy-friendly option such as GoatCounter can be added.

---