# To-Do Pro — Setup Guide

To-Do Pro is a **PWA** (installable on laptop, PC and mobile) that uses **Firebase** to sync the same data across all your devices.
The Firebase free plan (Spark) is enough for personal use.

---

## 1. Run locally (test)

Open the folder in VS Code and run `index.html` with **Live Server** (port 5502). The app also works without cloud setup, but data then stays on that one device.

---

## 2. Create the Firebase project (about 5 minutes)

1. Go to https://console.firebase.google.com, choose **Add project**, enter a name (for example `todo-pro`). Google Analytics can stay off.
2. Open **Build → Authentication → Get started → Sign-in method**, choose **Email/Password**, enable it and save. (For the optional Google button, also enable **Google** and enter a support email.)
3. Open **Build → Firestore Database → Create database**, choose *Production mode* and pick a location (for example `asia-south1`).
4. In Firestore, open the **Rules** tab, paste the rules below and choose **Publish**. They let each user read and write only their own data.

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
    match /reminders/{id} {
      allow create, update: if request.auth != null
        && request.resource.data.uid == request.auth.uid
        && (resource == null || resource.data.uid == request.auth.uid);
      allow read: if request.auth != null && resource.data.uid == request.auth.uid;
      allow delete: if request.auth != null && (resource == null || resource.data.uid == request.auth.uid);
    }
  }
}
```

## 3. Add the config to the app

1. In Firebase, open **Project settings (gear) → General → Your apps → Web (`</>`)** and register an app. Hosting is not needed.
2. Copy the values from the `firebaseConfig` object into `firebase-config.js`:

```js
window.FIREBASE_CONFIG = {
  apiKey: "...",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project",
  storageBucket: "...",
  messagingSenderId: "...",
  appId: "..."
};
```

3. Reload the page. The sign-in screen appears. Choose **Create account** and enter your email and a password. `localhost` is authorized by default, so local testing works.

> On the first sign-in, tasks stored only on this device are uploaded automatically. A backup copy stays in the browser.

---

## 4. Host the app online

To use the app on a phone, host it on an HTTPS site (this is also required for installing it). GitHub Pages, Firebase Hosting, Netlify, Vercel and Cloudflare Pages all work.

Firebase Hosting example:

```bash
npm install -g firebase-tools
firebase login
cd todo-pro
firebase init hosting      # public directory: .  |  single-page app: No  |  overwrite index.html: No
firebase deploy
```

If you host on any other domain, add it in Firebase under **Authentication → Settings → Authorized domains**.

---

## 5. Install as an app

| Device | How |
|---|---|
| Windows / Mac / Linux (Chrome, Edge) | Click the **Install** icon at the right of the address bar, or use **Install app** in the Account dialog |
| Android (Chrome) | Menu ⋮ → **Install app** |
| iPhone / iPad (Safari) | Share → **Add to Home Screen** |

---

## How sync works

- Data lives in `users/{uid}/tasks/{id}`. A change on one device appears on the others within seconds.
- The app works offline. Changes are saved on the device immediately and sync when the internet returns. The dot in the sidebar shows the state: green synced, amber syncing, grey offline or local, red error.
- If the same task is edited on two devices at the same time, the last write wins.
- Deleted tasks stay in Trash for 30 days and are then removed permanently.

## Reminders

In-app alarms ring while the app is open. For reminders when the app is closed or the screen is off, follow `PUSH-SETUP.md`.

## Files

| File | Purpose |
|---|---|
| `index.html`, `style.css`, `script.js` | UI and app logic |
| `auth.js` | Login screen |
| `cloud.js` | Firebase Auth, Firestore sync and push |
| `firebase-config.js` | Your Firebase config |
| `help.html` | User guide |
| `manifest.webmanifest`, `sw.js`, `icons/` | PWA (install and offline) |

After every code update, increase the `VERSION` value in `sw.js` (for example `'v16'` to `'v17'`) so installed apps load the new files.