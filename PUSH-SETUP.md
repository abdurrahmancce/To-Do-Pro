# Background reminders (screen off / app closed) — Free setup

Ei setup korle reminder er somoy phone e **notification** ashbe, app bondho thakleo, screen off thakleo.
Kono card ba paid plan lagbe na: Firebase **Spark (free)** + Cloudflare **Workers Free**.

> **Limitation:** awaaj hobe phone er default notification sound (3/5 sec looping alarm na).
> App khola thakle ager moto in-app alarm (3/5/10 sec) bajbe. iPhone e shudhu Home Screen e install kora app e kaj kore (iOS 16.4+).

Kaj gulo 6 ti step e:

---

## Step 1 — Firestore rules update (2 min)

Firebase Console → **Firestore Database → Rules** → puro text muche eta paste kore **Publish**:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // your tasks + your devices (push tokens)
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }

    // mirror of upcoming reminders (read by the worker with a service account)
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

## Step 2 — Web Push key (VAPID) (2 min)

1. Firebase Console → ⚙️ **Project settings → Cloud Messaging** tab.
2. Niche scroll kore **Web configuration → Web Push certificates → Generate key pair**.
3. Je lomba key ta dekhabe seta copy kore `firebase-config.js` er shesh line e paste korun:

```js
window.FIREBASE_VAPID_KEY = 'BPx...your-long-key...';
```

> Jodi "Cloud Messaging API" disabled dekhay, Project settings → Cloud Messaging e **Firebase Cloud Messaging API (V1)** Enabled ache kina dekhun (default e Enabled thake).

## Step 3 — Service account key (2 min)

1. Firebase Console → ⚙️ **Project settings → Service accounts** tab.
2. **Generate new private key → Generate key**. Ekta `.json` file download hobe.
3. **Ei file kokhono GitHub e upload korben na, kauke dibenao na.** (eta apnar project er admin chabi.)

## Step 4 — Cloudflare account (free)

1. https://dash.cloudflare.com/sign-up e free account banan (card lage na).
2. Terminal (PowerShell) e:

```powershell
npm install -g wrangler
wrangler login
```

Browser e login/allow korun.

## Step 5 — Worker deploy

```powershell
cd S:\todo-pro\todo-pro\worker
wrangler deploy
```

Prothom bar e kichu choose korte bolle `workers.dev` subdomain er naam din. Tarpor service account key ta secret hisebe din (download kora JSON file er path din):

```powershell
Get-Content "C:\path\to\your-service-account.json" -Raw | wrangler secret put SERVICE_ACCOUNT_JSON
```

(`C:\path\to\...` er jaygay apnar downloaded `.json` er asol path.)

Check korun: Cloudflare dashboard → **Workers & Pages → todo-pro-reminders → Triggers** e cron `* * * * *` thakbe. **Logs** e error dekha jay.

## Step 6 — App update + phone e on korun

```powershell
cd S:\todo-pro\todo-pro
git add .
git commit -m "Background push reminders"
git push
```

1-2 minute por site reload korun (installed app bondho kore abar kholen), tarpor **prottek device e**:

1. Account → login kora thakte hobe.
2. **Background notifications → Turn on for this device** → browser permission **Allow**.
3. **Send test** chepe dekhun notification ashe kina.

## Test

1. Ekta task banan, Reminder **2 minute por** set korun.
2. App bondho korun / screen off korun / airplane mode na (net lagbe).
3. 1-2 minute er moddhe notification asha uchit.

Delay: cron prottek minute chole, tai reminder er shomoy theke ~1 minute porjonto deri hote pare. Android battery saver / "Doze" mode e Chrome er notification kokhono kokhono deri kore; Chrome ke "Unrestricted" battery e rakhle bhalo.

## Kaj na korle

| Samossha | Karon / Fix |
|---|---|
| "Background notifications" section dekhay na | `FIREBASE_VAPID_KEY` boshano hoyni, ba login kora nei |
| Turn on e error | Notification permission block; site settings e Allow korun |
| Test notification ashe, kintu reminder ashe na | Worker deploy / secret thik na. Cloudflare → Worker → Logs dekhun |
| Worker log e `permission denied` / `FAILED_PRECONDITION` | Service account key thik project er na |
| Reminder duibar bajche (app open + push) | Normal na, kintu kokhono hote pare; amake janan |
| Notification ashe kintu awaaj nei | Phone er Settings → Apps → Chrome (ba installed app) → Notifications → Sound on |
