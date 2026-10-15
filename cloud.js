/* =====================================================
   cloud.js — Firebase (Auth + Firestore) sync layer
   Loaded lazily by script.js only when firebase-config.js is filled in.
   Data path:  users/{uid}/tasks/{taskId}
   ===================================================== */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithRedirect, signOut,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  initializeFirestore, getFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, setDoc, deleteDoc, onSnapshot, writeBatch,
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

export const logout = () => signOut(auth);

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
