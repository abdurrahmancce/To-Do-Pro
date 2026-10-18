# To-Do Pro — Setup Guide

Ei app ta ekhon **PWA** (laptop, PC, mobile e app er moto install kora jay) ar **Firebase** diye sob device e same data sync kore.
Firebase free plan (Spark) e personal use er jonno enough.

---

## 1. Local e chalano (test)

VS Code te folder open kore **Live Server** diye `index.html` chalan (port 5502). Cloud setup chhara-o app kaj korbe (data shudhu ei device e thakbe).

---

## 2. Firebase project banano (≈ 5 min)

1. https://console.firebase.google.com e jan → **Add project** → naam din (e.g. `todo-pro`) → Analytics off rakhte paren.
2. **Build → Authentication → Get started → Sign-in method** → **Email/Password → Enable → Save**. (Google button chaile **Google → Enable** → support email din → Save.)
3. **Build → Firestore Database → Create database** → *Production mode* → location nin (e.g. `asia-south1`).
4. Firestore er **Rules** tab e giye eta paste kore **Publish** korun (shudhu nijer data nijei dekhte/edit korte parbe):

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/tasks/{taskId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

## 3. Config paste kora

1. Firebase → **Project settings (gear) → General → Your apps → Web (`</>`)** → app register korun (Hosting tick lagbe na).
2. Je `firebaseConfig = { ... }` dekhabe, oi value gulo `firebase-config.js` e paste korun:

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

3. Live Server reload korun → login screen asbe → **Create account** diye email + password din.
   (`localhost` Firebase e default authorized, tai local test e kaj korbe.)

> Prothom sign-in e ei device er local task gulo automatic cloud e upload hobe (backup copy browser e theke jabe).

---

## 4. Online host kora (jate mobile ar onno device theke open kora jay)

Phone theke use korte hole app ta internet e host korte hobe (HTTPS lagbe, PWA install er jonno-o). Sobcheye shohoj: **Firebase Hosting** (free).

```bash
npm install -g firebase-tools
firebase login
cd todo-pro
firebase init hosting      # public directory: .   |  single-page app: No  |  overwrite index.html: No
firebase deploy
```

Deploy er por URL pabe: `https://your-project.web.app`.
Onno option: Netlify / Vercel / Cloudflare Pages / GitHub Pages — folder ta drag-drop ba push korlei hoy.
**Jodi Firebase Hosting chhara onno domain e host koren**, Firebase → Authentication → Settings → **Authorized domains** e oi domain add korte hobe.

---

## 5. App er moto install kora

| Device | Kivabe |
|---|---|
| **Windows / Mac / Linux (Chrome, Edge)** | Address bar er right e **Install** icon, ba sidebar/Account e **Install app** button |
| **Android (Chrome)** | ⋮ menu → **Install app** (ba app er Account dialog e Install button) |
| **iPhone / iPad (Safari)** | Share → **Add to Home Screen** |

Install er por alada window e, offline-o khule, desktop/home screen e icon thake.

---

## Kivabe sync kaj kore

- Data thake `users/{uid}/tasks/{id}` e. Ek device e add/edit/delete korle onno device e **sathe sathe** dekha jay.
- **Offline e-o** kaj kore: change gulo device e save thake, net ashle auto sync hoy. Sidebar/top-bar er dot: 🟢 synced · 🟡 syncing · ⚪ offline/local · 🔴 error.
- Ek-i task duita device e ek-i somoy edit korle **shesh write jite** (last-write-wins).

## Reminder / alarm er limitation (khub important)

Reminder tokhon-i bajbe jokhon app **khola ache** (browser tab ba installed app background e cholche). App puro bondho thakle web app alarm dite pare na — eta web platform er limit. Always-on push notification lagle alada server (Firebase Cloud Messaging + Cloud Functions) lagbe; chaile pore add kora jabe.
Ek-i reminder duita device e khola thakle je device age dhorbe sheta bajabe.

## Files

| File | Kaj |
|---|---|
| `index.html`, `style.css`, `script.js` | UI + app logic |
| `cloud.js` | Firebase Auth + Firestore sync |
| `firebase-config.js` | **Apnar Firebase config ekhane** |
| `manifest.webmanifest`, `sw.js`, `icons/` | PWA (install + offline) |

Code update dile `sw.js` er `VERSION = 'v1'` bariye `'v2'` korun, jate installed app notun file pay.
