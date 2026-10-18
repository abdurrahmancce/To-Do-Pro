# To-Do Pro

An installable to-do app (PWA) that works on phone, laptop and PC. Tasks sync across devices, reminders ring even when the app is closed, and everything runs on free services.

**Live app:** https://abdurrahmancce.github.io/To-Do-Pro/
**User guide:** open `help.html` or *Account → Help* inside the app.

## Features
- Email + password login (sign in, create account, reset password), optional Google sign-in, optional guest mode
- Autosave on every change (online and offline), Trash with 30-day restore and 5-second undo
- Multi-device sync (Firebase Firestore) and offline support
- Smart quick-add (`Call mom tomorrow 6pm !high #family`), priorities, repeat, calendar, search
- Swipe actions, undo, bulk select, streaks, weekly summary, light/dark themes and accent colors
- Alarm sound with custom length, background push reminders (Firebase Cloud Messaging + Cloudflare Worker), heads-up and backup reminders, Done/Snooze from the notification
- Installable on Android, iPhone, Windows and Mac

## Quick start for users
1. Open the app and tap **Create account**. Enter name, email and a password (6+ characters).
2. Add tasks with **+**. Set a date, time and **Alarm** for reminders.
3. Sign in with the same email on your other devices to see the same tasks.
4. Turn on **Account → Background notifications** on each device for reminders when the app is closed.

## Setup for the owner (one time)
1. **Firebase:** follow `SETUP.md`, then paste the config into `firebase-config.js`.
2. **Enable email login:** Firebase Console → *Authentication* → *Sign-in method* → **Email/Password** → Enable → Save. (Add **Google** there too if you want the Google button.)
3. **Authorized domain:** *Authentication* → *Settings* → *Authorized domains* must include `abdurrahmancce.github.io`.
4. **Background push:** follow `PUSH-SETUP.md` (Cloudflare Worker).
5. Publish with GitHub Pages. After each update, bump `VERSION` in `sw.js` so installed apps refresh.

## Files
| File | Purpose |
|---|---|
| `index.html`, `style.css`, `script.js` | App UI and logic |
| `auth.js` | Animated email/password login screen  |
| `cloud.js` | Firebase Auth, Firestore sync and push |
| `help.html` | User guide |
| `sw.js`, `manifest.webmanifest` | Offline cache, push, install |
| `worker/` | Cloudflare Worker that sends scheduled push reminders |