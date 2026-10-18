# Background reminders (screen off or app closed) — free setup

With this setup, a reminder shows as a **notification** on your phone or computer even when the app is closed or the screen is off.
No card or paid plan is needed: Firebase **Spark (free)** plus Cloudflare **Workers Free**.

> **Limitation:** background reminders use the device's default notification sound, not the looping in-app alarm.
> When the app is open, the in-app alarm plays as usual. On iPhone this works only in an app added to the Home Screen (iOS 16.4 or later).

There are 6 steps.

---

## Step 1 — Update Firestore rules (2 minutes)

Firebase Console → **Firestore Database → Rules**. Replace everything with the rules below and choose **Publish**.

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // your tasks, devices (push tokens) and settings
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

## Step 2 — Web Push key (VAPID) (2 minutes)

1. Firebase Console → gear icon → **Project settings → Cloud Messaging**.
2. Scroll to **Web configuration → Web Push certificates → Generate key pair**.
3. Copy the long key and paste it into the last line of `firebase-config.js`:

```js
window.FIREBASE_VAPID_KEY = 'BPx...your-long-key...';
```

> If Cloud Messaging looks disabled, check that **Firebase Cloud Messaging API (V1)** is enabled in Project settings → Cloud Messaging. It is enabled by default.

## Step 3 — Service account key (2 minutes)

1. Firebase Console → gear icon → **Project settings → Service accounts**.
2. Choose **Generate new private key → Generate key**. A `.json` file downloads.
3. **Never upload this file to GitHub or share it with anyone.** It is the admin key of your project.

## Step 4 — Cloudflare account (free)

1. Create a free account at https://dash.cloudflare.com/sign-up (no card needed).
2. In PowerShell:

```powershell
npm install -g wrangler
wrangler login
```

Sign in and allow access in the browser.

## Step 5 — Deploy the worker

```powershell
cd S:\todo-pro\todo-pro\worker
wrangler deploy
```

If asked, choose a `workers.dev` subdomain name. Then store the service account key as a secret. Use the real path of the JSON file you downloaded:

```powershell
Get-Content "C:\path\to\your-service-account.json" -Raw | wrangler secret put SERVICE_ACCOUNT_JSON
```

Check it: Cloudflare dashboard → **Workers & Pages → todo-pro-reminders → Triggers** should show the cron `* * * * *`. Errors appear under **Logs**.

## Step 6 — Update the app and turn notifications on

```powershell
cd S:\todo-pro\todo-pro
git add -A
git commit -m "Background push reminders"
git push
```

Wait 1–2 minutes, then reload the site (close and reopen an installed app). On **every device**:

1. Sign in to your account.
2. Open **Account → Background notifications → Turn on for this device** and choose **Allow** in the browser prompt.
3. Choose **Send test** to confirm a notification appears.

## Test it

1. Create a task with a reminder 2 minutes from now.
2. Close the app or turn off the screen. Keep the internet connected.
3. A notification should arrive within 1–2 minutes.

The cron job runs every minute, so a reminder can arrive up to about a minute late. On Android, battery saver or Doze mode can delay Chrome notifications. Set Chrome (or the installed app) to **Unrestricted** battery use for best results.

## Troubleshooting

| Problem | Cause and fix |
|---|---|
| The "Background notifications" section is missing | `FIREBASE_VAPID_KEY` is not set, or you are not signed in |
| Error when turning on | Notifications are blocked. Allow them in the site settings |
| The test notification works but reminders do not | The worker or secret is wrong. Check Cloudflare → Worker → Logs |
| Worker log shows `permission denied` or `FAILED_PRECONDITION` | The service account key belongs to a different project |
| A reminder arrives twice (app open and push) | This can happen occasionally. It is harmless |
| A notification arrives without sound | Phone Settings → Apps → Chrome (or the installed app) → Notifications → turn sound on |