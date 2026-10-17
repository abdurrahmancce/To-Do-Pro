/* =====================================================
   Firebase config for To-Do Pro (cloud sync).
   Web config values are not secret — access is protected by
   Firebase Authentication + Firestore security rules.
   Set `window.FIREBASE_CONFIG = null;` to go back to local-only mode.
   ===================================================== */
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyAJ-AK7VRbSYxyjLM1itOcDLI6Q2OTtGeE",
  authDomain: "todo-pro-c172f.firebaseapp.com",
  projectId: "todo-pro-c172f",
  storageBucket: "todo-pro-c172f.firebasestorage.app",
  messagingSenderId: "164487477381",
  appId: "1:164487477381:web:647543ca981ce595ae91ec"
};

/* Web Push certificate key (Firebase Console -> Project settings -> Cloud Messaging -> Web Push certificates -> Generate key pair).
   Paste the public key below to enable background notifications (see PUSH-SETUP.md). */
window.FIREBASE_VAPID_KEY = 'BLWu3H6Oic6FrS3TG4lzN8qF6dTRfX5pnA18t4kTFoUIKyTrVMZHaYaIi_1EVmj_lnXEr5UbLduOG3mexU0-LKI';

/* Reminder worker address (shown after `wrangler deploy`, like https://todo-pro-reminders.YOURNAME.workers.dev).
   With it, the Snooze / Done buttons on a notification work silently without opening the app. */
window.WORKER_URL = 'https://todo-pro-reminders.akash-abdur-2002.workers.dev';