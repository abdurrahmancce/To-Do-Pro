/* =====================================================
   cloud.js — Firebase (Auth + Firestore) sync layer
   Loaded lazily by script.js only when firebase-config.js is filled in.
   Data path:  users/{uid}/tasks/{taskId}
   ===================================================== */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithRedirect, signOut,
  createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail, updateProfile,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  initializeFirestore, getFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, setDoc, getDoc, deleteDoc, onSnapshot, writeBatch, terminate, clearIndexedDbPersistence, waitForPendingWrites,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

let app, auth, db;

export function init(config) {
  app = initializeApp(config);
  auth = getAuth(app);
  try {
    // Offline-first: data is cached in IndexedDB and synced when back online
    db = initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch (e) {
    console.warn('Persistent cache unavailable, using memory cache', e);
    db = getFirestore(app);
  }
}

export function onAuth(cb) {
  return onAuthStateChanged(auth, (u) =>
    cb(u ? { uid: u.uid, name: u.displayName || '', email: u.email || '', photo: u.photoURL || '' } : null)
  );
}

export async function signIn() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    const fallback = ['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment', 'auth/web-storage-unsupported'];
    if (fallback.includes(e.code)) return signInWithRedirect(auth, provider);
    if (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request') return;
    throw e;
  }
}

export async function emailSignIn(email, password) {
  await signInWithEmailAndPassword(auth, email, password);
}
export async function emailSignUp(name, email, password) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  if (name) { try { await updateProfile(cred.user, { displayName: name }); } catch { /* name is optional */ } }
  return { uid: cred.user.uid };
}
export const resetPassword = (email) => sendPasswordResetEmail(auth, email);

/* Sign out and wipe the offline copy of the account's data from this browser (shared-device privacy). */
export async function logout() {
  try { await Promise.race([waitForPendingWrites(db), new Promise((r) => setTimeout(r, 4000))]); } catch { /* offline: best effort */ }
  await signOut(auth);
  try { await terminate(db); await clearIndexedDbPersistence(db); } catch { /* cache cleared on next start at the latest */ }
}

const tasksCol = (uid) => collection(db, 'users', uid, 'tasks');

export function subscribe(uid, onData, onError) {
  return onSnapshot(
    tasksCol(uid),
    { includeMetadataChanges: true },
    (snap) =>
      onData(
        snap.docs.map((d) => d.data()),
        { fromCache: snap.metadata.fromCache, hasPendingWrites: snap.metadata.hasPendingWrites }
      ),
    onError
  );
}

// NOTE: these promises only resolve once the server acknowledges the write,
// so callers should not await them for UI updates (offline writes are queued).
export const save = (uid, task) => setDoc(doc(db, 'users', uid, 'tasks', task.id), task);
export const remove = (uid, id) => deleteDoc(doc(db, 'users', uid, 'tasks', id));

export async function saveMany(uid, tasks) {
  for (let i = 0; i < tasks.length; i += 400) {
    const batch = writeBatch(db);
    tasks.slice(i, i + 400).forEach((t) => batch.set(doc(db, 'users', uid, 'tasks', t.id), t));
    await batch.commit();
  }
}

/* =====================================================
   Background push (Firebase Cloud Messaging)
   - reminders/{taskId}  : mirror of upcoming alarms, read by the Cloudflare Worker
   - users/{uid}/devices : FCM tokens of the devices that enabled notifications
   Messaging SDK is imported lazily so a failure here never breaks task sync.
   ===================================================== */
const MSG_URL = 'https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js';

export async function pushSupported() {
  try {
    if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) return false;
    const m = await import(MSG_URL);
    return await m.isSupported();
  } catch { return false; }
}

export async function enablePush(uid, vapidKey) {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notification permission was not granted');
  const m = await import(MSG_URL);
  const reg = await navigator.serviceWorker.ready;
  const token = await m.getToken(m.getMessaging(app), { vapidKey, serviceWorkerRegistration: reg });
  if (!token) throw new Error('Could not get a push token');
  await setDoc(doc(db, 'users', uid, 'devices', token), { token, ua: navigator.userAgent.slice(0, 140), createdAt: Date.now() });
  return token;
}

export async function disablePush(uid, token) {
  try {
    const m = await import(MSG_URL);
    await m.deleteToken(m.getMessaging(app));
  } catch { /* ignore */ }
  if (token) await deleteDoc(doc(db, 'users', uid, 'devices', token));
}

/* Reminder preferences shared by every device of the account: users/{uid}/settings/prefs */
export const savePrefs = (uid, p) => setDoc(doc(db, 'users', uid, 'settings', 'prefs'), p, { merge: true });
export function subscribePrefs(uid, onData) {
  return onSnapshot(
    doc(db, 'users', uid, 'settings', 'prefs'),
    { includeMetadataChanges: true },
    (s) => onData(s.exists() ? s.data() : null, { fromCache: s.metadata.fromCache }),
    () => {}
  );
}

export const dropDevice = (uid, token) => deleteDoc(doc(db, 'users', uid, 'devices', token));
export const saveReminder = (r) => setDoc(doc(db, 'reminders', r.id), r);
export const deleteReminder = (id) => deleteDoc(doc(db, 'reminders', id));

/* Photos attached to tasks and checklist steps: users/{uid}/photos/{id} = { d: dataURL, w, h, t } */
export const savePhoto = (uid, id, rec) => setDoc(doc(db, 'users', uid, 'photos', id), { d: rec.d, w: rec.w || 0, h: rec.h || 0, t: rec.t || Date.now() });
export async function getPhoto(uid, id) { const s = await getDoc(doc(db, 'users', uid, 'photos', id)); return s.exists() ? s.data() : null; }
export const deletePhoto = (uid, id) => deleteDoc(doc(db, 'users', uid, 'photos', id));
