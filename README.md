<div align="center">

# ✅ To-Do Pro

**An installable to-do app that syncs across your devices and reminds you even when the app is closed.**

[![Live app](https://img.shields.io/badge/🌐_Live_app-open-2ea44f?style=for-the-badge)](https://abdurrahmancce.github.io/To-Do-Pro/)
![PWA](https://img.shields.io/badge/PWA-installable-5a0fc8?style=flat-square)
![Firebase](https://img.shields.io/badge/Firebase-Auth_%2B_Firestore-ffca28?style=flat-square&logo=firebase&logoColor=black)
![Cloudflare](https://img.shields.io/badge/Cloudflare-Workers-f38020?style=flat-square&logo=cloudflare&logoColor=white)
![Tests](https://img.shields.io/badge/tests-34%2F34_passing-2ea44f?style=flat-square)
![Cost](https://img.shields.io/badge/cost-free_tier-blue?style=flat-square)

📱 Phone · 💻 Laptop · 🖥️ PC &nbsp;|&nbsp; 📖 User guide (English and Bangla): `help.html` or **Account → Help** inside the app

</div>

---

## 📑 Contents

| | | |
|---|---|---|
| [✨ Features](#-features) | [🚦 Release status](#-release-status) | [🏗️ Architecture](#️-architecture) |
| [🧭 Project history](#-project-history) | [🔐 Security](#-security) | [🧪 Testing](#-testing) |
| [🚀 Quick start](#-quick-start-for-users) | [🛠️ Owner setup](#️-setup-for-the-owner-one-time) | [📦 Deploying updates](#-deploying-updates) |
| [🗂️ Repository layout](#️-repository-layout) | [⚠️ Limitations](#️-known-limitations-and-recommendations) | [👨‍💻 Contact developer](#-contact-developer) |

---

## ✨ Features

### 📝 Tasks
- ⚡ **Smart quick add**: type `Call mom tomorrow 6pm !high #family` and the date, time, priority and section are filled in for you. Common Bangla and Banglish time words are understood too.
- 🎯 Priorities (low, medium, high), due dates, sections, notes
- ✅ **Checklist (subtasks):** break a task into steps, tick each with a ✔ right from the task list, see progress like `3/4`. Paste a list to add one step per line. Up to 50 steps per task.
- 🔁 Repeating tasks (daily, weekly) with 🔥 streak tracking
- 👀 Views: **All · Today · Upcoming · Calendar (month and week) · Completed · Trash · Reminders · Weekly summary**
- 🔎 Search, 👆 swipe actions, ↕️ drag to reorder, ☑️ bulk select (done, tomorrow, delete) with undo
- ⌨️ Shortcuts: `n` new task · `/` or `Ctrl+K` search · `Ctrl+Enter` save in the editor

### 🛡️ Your data stays safe
| Feature | What it does |
|---|---|
| 💾 **Autosave** | Every change is saved as you type, online or offline. Closing the editor or switching apps saves too. |
| ↩️ **Undo** | 5 seconds to undo any delete. |
| 🗑️ **Trash** | Deleted tasks stay 30 days. Restore, delete forever or empty the trash. Syncs across devices. |
| 📤 **Export / Import** | Back up tasks as JSON. Import is validated and size-limited. |

### 🔄 Accounts and sync
- 📧 Email and password: sign in, create account, reset password
- 🔑 Optional Google sign-in · 👤 optional guest mode (data stays on that device)
- ☁️ Firebase Firestore sync with offline cache. Edits made offline sync when you reconnect.
- 🎬 Animated login screen shown in English and Bangla side by side

### 🔔 Reminders
- 🔊 In-app alarm popup with sound (custom length), **Done** and **Snooze**
- 📲 **Background push** reminders when the app is closed (Firebase Cloud Messaging + Cloudflare Worker)
- ⏰ Optional **heads-up** reminder before the alarm
- 🔁 **Backup reminder** 90 seconds later if you have not responded
- 🎛️ **Done / Snooze buttons on the notification** itself
- 🔕 Handle a reminder on one device and the notification disappears on your other devices

### 📣 Updates and support
- 🐞 **Report a bug:** one tap opens a ready-to-send GitHub report with technical details filled in (browser, screen, recent errors). Task content is never included. A short notice also appears if the app hits an error.
- 🆕 **What's new announcement:** after each update the app shows a short summary of what is new, improved and fixed. It appears once per device and can be reopened any time from **Account → See what's new**.
- 👨‍💻 **Contact developer:** Account dialog and user guide include the developer's portfolio, GitHub and a bug-report link.

### 🎨 Look and feel
- 🌗 Light and dark themes, 🎨 accent colours
- 📐 Responsive from 320px phones to desktop
- 🌍 App interface in English only; Bangla and English appear together on the login screen and in the user guide
- 📲 Installable on Android, iPhone, Windows and Mac

---

## 🚦 Release status

| Area | Status |
|---|---|
| Core app, sync, Trash, autosave, bilingual login and guide, background push | 🟢 **Live** |
| Spellcheck off in text fields (no red lines under Bangla typing) | 🟢 **Live** |
| Contact developer (Account dialog and user guide) | 🟢 **Live** |
| What's new announcement (popup once per update, reopen from Account) | 🟢 **Live** |
| Security hardening: `worker/index.js`, `firestore.rules`, sign-out cache clearing in `cloud.js`, 8-character password minimum in `auth.js`, updated `SETUP.md` and `PUSH-SETUP.md` | 🟡 **Prepared and tested, not yet deployed** |
| Checklist, Report a bug, error notice, faster updates (network-first service worker), tests folder | 🟡 **Ready, deploy with the next push** |
| Usage analytics (GoatCounter) | 🟡 **Built, off until you add a site code** in `analytics.js` |
| Shared lists | ⚪ Design stage |

> 💡 Until the pending hardening update is deployed, the live app still accepts 6-character passwords, and the previous Firestore rules and worker stay in use. Sections below describe the full repository state and mark items that depend on the pending update.

---

## 🏗️ Architecture

```
 📱 Browser / installed PWA                       ☁️ Google Firebase                 ⚙️ Cloudflare
 ┌──────────────────────────────┐   sync    ┌───────────────────────────┐        ┌───────────────────────┐
 │ index.html  style.css        │◄─────────►│ Auth (email / Google)     │        │ Worker (cron, 1 min)  │
 │ script.js  (app + alarms)    │           │ Firestore                 │◄──────►│  - reads due reminders│
 │ auth.js    (login screen)    │           │   users/{uid}/tasks       │  REST  │  - sends FCM push     │
 │ cloud.js   (Firebase layer)  │           │   users/{uid}/devices     │        │  - /act endpoint for  │
 │ quickparse.js, habits.js     │           │   users/{uid}/settings    │        │    Done / Snooze      │
 │ sw.js (offline, push)        │◄──push────│   reminders/{id} (queue)  │        └───────────────────────┘
 └──────────────────────────────┘   (FCM)   └───────────────────────────┘
```

| Layer | Choice | Why |
|---|---|---|
| 🌐 Hosting | GitHub Pages | Static files only, nothing to maintain |
| 📴 Offline | Service worker + local cache | App opens and tasks stay editable without internet |
| 🗄️ Data | Firestore, one document per task | Real-time multi-device sync. Deleted tasks carry a `deletedAt` time, which is how Trash syncs. |
| 🔔 Reminders | Firestore queue + Cloudflare Worker + FCM | Push works with the app closed, on the free plan |
| 💸 Cost | Free tiers only | Firebase, Cloudflare Workers, GitHub Pages |

<details>
<summary><b>🔍 How a background reminder works</b></summary>

1. You set an alarm on a task. The app writes a small mirror document in `reminders/`.
2. Every minute the worker looks for reminders that are due.
3. It checks the task is still valid (not deleted, completed or edited), then sends a push to every registered device of that user.
4. It marks the task as fired, or schedules the next repeat.
5. A backup reminder is queued 90 seconds later and cancelled if you act on the first one.
6. The notification's **Done** and **Snooze** buttons call the worker's `/act` endpoint with an HMAC signature, so no login is needed on the notification.

</details>

---

## 🧭 Project history

The app was built in stages. Each stage was tested and confirmed working before the next began.

| # | Stage | Highlights |
|---|---|---|
| 1️⃣ | **Core app** | Task list, priorities, due dates, sections, calendar, search, swipe, bulk select, undo, weekly summary, themes, export/import, installable PWA with offline cache |
| 2️⃣ | **Smart input** | Natural-language quick add (dates, times, `!priority`, `#section`, Bangla and Banglish words), saved quick-add draft |
| 3️⃣ | **Cloud sync** | Firebase Auth (Google), Firestore sync across devices, offline persistence, per-user data, guest mode |
| 4️⃣ | **Reminders** | In-app alarm engine, repeat alarms with streaks, FCM push with a Cloudflare Worker, heads-up and backup reminders, Done/Snooze on notifications, dismiss on other devices, push token self-healing |
| 5️⃣ | **Email login** | Animated sign in / create account / reset password screen, friendly errors, Google and guest kept as options |
| 6️⃣ | **Documentation** | Bilingual user guide with working navigation, Firebase and push setup guides |
| 7️⃣ | **Data safety and polish** | Trash (5-second undo, 30-day restore, synced), autosave for every field, English-only app text, dropdown restyle, bell animation and dialog fixes |
| 8️⃣ | **Review and hardening** | Full post-mortem, automated browser tests, security fixes, spellcheck off for Bangla typing |
| 🔟 | **Checklists, reporting, analytics, tests** | Checklist (subtasks) with ✔ on the task list, error recorder with Report a bug, optional GoatCounter analytics, network-first service worker, `tests/` folder with 49 automated checks |
| 9️⃣ | **Communication** | Professional README, Contact developer section in the app and guide, What's new announcement shown to users after each update |

<details>
<summary><b>🐞 Problems found and fixed along the way</b></summary>

- Stale downloaded files overwriting repository files (resolved with rename steps)
- Duplicate element ids that broke the Bangla guide links
- An alarm bell animation clashing with an existing style
- Push tokens going stale across sessions
- Autosave racing with the editor's close event
- Account dialog staying open above the login screen after sign-out
- A task coming back after delete while autosave was pending (found in review, fix pending deployment)
- Red spellcheck lines under Bangla text making editing hard on mobile (fixed and live)
- Updates appearing one reload late: the service worker served a cached `script.js` next to a fresh `index.html`, so a new button could appear before its code. Reloading twice resolves it; a network-first strategy for app code is being evaluated

</details>

---

## 🔐 Security

A full review was done in stage 8. The fixes below are in the repository files and are pending deployment (see [Release status](#-release-status)).

| ID | Severity | Finding | Fix |
|---|---|---|---|
| W1 | 🔴 High | Worker used user and task ids in database paths without validation, so a crafted reminder could point at another user's data | Ids must match `^[A-Za-z0-9_-]{1,128}$`; invalid reminders are discarded |
| W2 | 🟠 Medium | `/act` asked Google for a token before checking the signature, so spam could burn the free quota | Signature checked first, body limited to 2 KB, token cached |
| W3 | 🟡 Low | Signature compared in non-constant time | Constant-time compare |
| W4 | 🟡 Low | CORS open to all origins, error text leaked internals | CORS limited to the app's origin, generic error |
| W5 | 🟡 Low | Task titles written to worker logs | Titles removed from logs |
| C1 | 🟠 Medium | Hostile or corrupt task data (bad dates, huge text, odd ids, 20,000-item import) could crash the app or browser | Every task is normalised: ids sanitised, dates validated, lengths capped (title 200, notes 2000, section 100); import limited to 2,000 tasks and 5 MB |
| C2 | 🟠 Medium | Deleting right after typing could bring the task back | Pending autosave cancelled on delete |
| C3 | 🟠 Medium | Task data stayed in the browser after sign-out | Sign-out waits for pending writes, then clears local and Firestore caches |
| C4 | 🟡 Low | Password minimum was 6 | Raised to 8 |
| R1 | 🟠 Medium | Firestore rules had no validation | New `firestore.rules`: owner-only access, type and size limits on tasks and reminders |

✅ Also verified: all user text is HTML-escaped before display, and XSS payloads in title, notes and section never run in any view.

---

## 🧪 Testing

An automated **Playwright** suite (headless Chromium) runs the real app against an in-memory stand-in for Firebase. It lives in the [`tests/`](tests) folder: `cd tests && npm install && npx playwright install chromium && npm test`.

**🎯 Result: 49 of 49 checks pass.**

| Area | What is checked |
|---|---|
| 🚀 Boot | App starts with no console errors |
| 📝 Tasks | Quick add (including Banglish), complete, edit, delete, Trash, restore, delete forever, empty trash, search, bulk select with undo |
| 🗓️ Views | Calendar, weekly summary, account and reminders dialogs, keyboard shortcuts |
| 💾 Autosave | No duplicates, no task coming back after delete, past alarms not stored until confirmed |
| 🕷️ Security | XSS payloads across every view, corrupt stored data, valid / malformed / oversized import files |
| 🔔 Alarms | Popup rings when due |
| ☁️ Cloud flow | Add, soft delete, sign-out clears local cache |
| 📐 Layout | No horizontal overflow at 320, 375 and 768 px; login screen at 360 px |
| ✅ Checklist | Add, tick, remove and paste steps, steps shown and ticked from the list, hostile step text cleaned |
| 🐞 Reporting | Errors recorded, notice shown once, Report a bug link has diagnostics and no task content |
| 📊 Analytics | Off by default with no outside requests; with a code, events are counted and task text is never sent |
| 📴 Service worker | New release runs after one reload; app opens offline |
| 📦 Assets | Every file referenced by HTML, manifest and service worker exists; all app modules are cached |
| ⚙️ Worker | Traversal ids, bad signatures, bad actions, oversized and malformed bodies are rejected before any Google call |

> ℹ️ Real Firebase, Google sign-in, FCM delivery and the new Firestore rules cannot run in the test sandbox, so they are checked by hand after each deploy (see [Deploying updates](#-deploying-updates)).

---

## 🚀 Quick start for users

1. 🌐 Open the app and tap **Create account**. Enter name, email and a password (6+ characters today, 8+ after the pending update).
2. ➕ Add tasks with **+**. Set a date, time and **Alarm** for reminders.
3. 🔄 Sign in with the same email on your other devices to see the same tasks.
4. 🔔 Turn on **Account → Background notifications** on each device for reminders when the app is closed.
5. 📲 Install the app from the browser menu (**Add to Home screen** or **Install app**).

---

## 🛠️ Setup for the owner (one time)

- [ ] 🔥 **Firebase:** follow `SETUP.md`, then paste the config into `firebase-config.js`
- [ ] 📧 **Email login:** Firebase Console → *Authentication* → *Sign-in method* → **Email/Password** → Enable → Save. Add **Google** there too for the Google button.
- [ ] 🌍 **Authorized domain:** *Authentication* → *Settings* → *Authorized domains* must include `abdurrahmancce.github.io`
- [ ] 📜 **Firestore rules:** paste `firestore.rules` into Firestore → *Rules* → Publish
- [ ] 📲 **Background push:** follow `PUSH-SETUP.md` (Cloudflare Worker, service account secret, `WORKER_URL`)
- [ ] 🚢 **Publish** with GitHub Pages

---

## 📦 Deploying updates

1. 📂 Replace the changed files in the project folder, then:
   ```bash
   git add .
   git commit -m "Describe the change"
   git push
   ```
2. 🔢 Bump `VERSION` in `sw.js` on every release so installed apps refresh.
   📣 Update `APP_UPDATE` and `WHATS_NEW` in `script.js` so users see the new announcement.
3. ⚙️ If `worker/index.js` changed: `cd worker` then `npx wrangler deploy`.
4. 📜 If `firestore.rules` changed: paste it in the Firebase console and **keep the previous rules for rollback**.
5. ⏳ Wait 1-2 minutes, then reload the app twice (or close and reopen the installed app). The first reload fetches the new files, the second runs them.
6. 🧪 **Smoke test:** sign in, add a task with an alarm, confirm a document appears in the `reminders` collection, sign out and sign back in.

---

## 🗂️ Repository layout

| File | Purpose |
|---|---|
| 🧱 `index.html`, `style.css`, `script.js` | App UI and logic |
| 🔑 `auth.js` | Animated bilingual email and password login screen |
| ☁️ `cloud.js` | Firebase Auth, Firestore sync, push registration |
| 💬 `quickparse.js` | Natural-language quick-add parser |
| 🔥 `habits.js` | Repeat and streak helpers |
| 🩺 `errlog.js` | Records recent errors on the device for Report a bug (no network, no task data) |
| 📊 `analytics.js` | Optional GoatCounter loader and feature counters (off until a site code is set) |
| 🧪 `tests/` | Automated end-to-end tests (`npm test`) |
| 📖 `help.html` | User guide (English and Bangla) |
| 📴 `sw.js`, `manifest.webmanifest`, `icons/` | Offline cache, push handling, install metadata |
| ⚙️ `firebase-config.js` | Firebase web config and worker URL |
| 📜 `firestore.rules` | Database security rules |
| 🤖 `worker/` | Cloudflare Worker that sends scheduled push reminders |
| 📘 `SETUP.md`, `PUSH-SETUP.md` | Owner setup guides |

---

## ⚠️ Known limitations and recommendations

- 🚪 **Open sign-up:** anyone can create an account, and an account can queue reminders for the shared worker. After your own accounts exist, disable new sign-ups: Firebase → Authentication → Settings → User actions.
- 🗝️ **Restrict the Firebase API key** to `abdurrahmancce.github.io` in Google Cloud Console (APIs & Services → Credentials). Enable the Firebase password policy and email-enumeration protection.
- 🔄 Rotate the service-account key if it was ever shared or committed.
- 🍎 Push reminders on iPhone need the app installed to the Home screen.
- ⏱️ The worker runs every minute and sends at most 5 reminders per run to stay inside the free plan.
- 🛡️ A Content Security Policy is not set yet. Add one only after testing Google and email sign-in on the live site.
- 📊 **Analytics:** built but off. To turn it on, create a free site at goatcounter.com, put its code in `analytics.js` (`window.GOATCOUNTER_CODE = 'yourcode'`) and push. It uses no cookies, sends no task text, and respects Do Not Track.
- 🤝 **Shared lists** (family or team) are not built yet; they need a new data structure and security rules.

---

## 👨‍💻 Contact developer

<div align="center">

### Abdur Rahman
**Developer of To-Do Pro**

Questions, bug reports, feature ideas or collaboration? Reach out through any of the links below, or open **Account → Contact developer** inside the app.

[![Portfolio](https://img.shields.io/badge/🌐_Portfolio-abdurrahmancce.github.io-2ea44f?style=for-the-badge)](https://abdurrahmancce.github.io/Personal-Portfolio/)
[![GitHub](https://img.shields.io/badge/GitHub-abdurrahmancce-181717?style=for-the-badge&logo=github&logoColor=white)](https://github.com/abdurrahmancce)

</div>

| | How to reach me | Best for |
|---|---|---|
| 🌐 | [Portfolio website](https://abdurrahmancce.github.io/Personal-Portfolio/) | My work, projects and contact details |
| 💻 | [GitHub profile](https://github.com/abdurrahmancce) | Other projects and code |
| 🐞 | [Open an issue](https://github.com/abdurrahmancce/To-Do-Pro/issues/new) | Bug reports and feature requests for To-Do Pro |
| ⭐ | [Star the repository](https://github.com/abdurrahmancce/To-Do-Pro) | Show support if the app is useful to you |

> 💬 **Reporting a bug?** Please include your device and browser, what you expected, what happened, and a screenshot if you can. This helps fix it faster.

---

<div align="center">

Built step by step, tested at every stage.

</div>
