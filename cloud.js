/* =====================================================
   cloud.js — Firebase (Auth + Firestore) sync layer
   Loaded lazily by script.js only when firebase-config.js is filled in.
   Data path:  users/{uid}/tasks/{taskId}
   Friends and groups: profiles, codes, friendships, groups, invites (see the social section at the end)
   ===================================================== */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithRedirect, signOut,
  createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail, updateProfile,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  initializeFirestore, getFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, setDoc, getDoc, getDocs, updateDoc, deleteDoc, onSnapshot, writeBatch, query, where, terminate, clearIndexedDbPersistence, waitForPendingWrites,
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
        snap.docs.map((d) => ({ ...d.data(), __pending: d.metadata.hasPendingWrites })), // __pending: saved here, not yet confirmed by the server
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

/* =====================================================
   Friends and groups (sharing, phase 1)
   profiles/{uid}                  { name, code, createdAt }   public name + friend code, readable one by one, never listed
   codes/{CODE}                    { uid }                      lookup: friend code -> person (create-only, cannot be hijacked)
   friendships/{uidA_uidB}         { members:[a,b], requester, status:'pending'|'accepted', createdAt }
   groups/{gid}                    { name, ownerUid, createdAt }
   groups/{gid}/members/{uid}      { name, role:'owner'|'member', joinedAt, code? }
   invites/{CODE10}                { gid, gname, createdBy, createdAt }   revocable group invite
   users/{uid}/groups/{gid}        { name, role, invite? }      my own index of groups (convenience only)
   ===================================================== */
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 characters: no I, O, 0 or 1
const rnd = (n) => { const b = new Uint8Array(n); crypto.getRandomValues(b); return [...b].map((x) => ALPHA[x & 31]).join(''); };
export const cleanCode = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
export const fmtCode = (c) => String(c || '').replace(/^(.{4})(.+)$/, '$1-$2');
const cleanName = (n, fb = 'Friend') => String(n || '').replace(/\s+/g, ' ').trim().slice(0, 60) || fb;
const pairOf = (a, b) => [a, b].sort();

export async function ensureProfile(uid, name) {
  const ref = doc(db, 'profiles', uid), nm = cleanName(name);
  const s = await getDoc(ref);
  if (s.exists()) {
    const d = s.data();
    if (name && d.name !== nm) await setDoc(ref, { name: nm, code: d.code, createdAt: d.createdAt || Date.now() });
    return { name: name ? nm : d.name, code: d.code };
  }
  for (let i = 0; i < 6; i++) {
    const code = rnd(8), b = writeBatch(db);
    b.set(doc(db, 'codes', code), { uid });
    b.set(ref, { name: nm, code, createdAt: Date.now() });
    try { await b.commit(); return { name: nm, code }; } catch (e) { if (e.code !== 'permission-denied') throw e; } // code already taken: try another
  }
  throw new Error('Could not create your friend code. Please try again.');
}
export async function getProfile(uid) { try { const s = await getDoc(doc(db, 'profiles', uid)); return s.exists() ? s.data() : null; } catch { return null; } }
export async function lookupCode(code) {
  const c = await getDoc(doc(db, 'codes', cleanCode(code)));
  if (!c.exists()) return null;
  const uid = c.data().uid, p = await getProfile(uid);
  return { uid, name: p ? p.name : 'Friend' };
}

export function subscribeFriendships(uid, onData, onError) {
  return onSnapshot(query(collection(db, 'friendships'), where('members', 'array-contains', uid)),
    (snap) => onData(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), onError);
}
/* Returns 'sent' | 'accepted' (they had already asked you) | 'friends' | 'waiting' */
export async function sendRequest(me, other) {
  const [a, b] = pairOf(me, other), id = a + '_' + b, ref = doc(db, 'friendships', id);
  const s = await getDoc(ref);
  if (s.exists()) {
    const d = s.data();
    if (d.status === 'accepted') return 'friends';
    if (d.requester === me) return 'waiting';
    await updateDoc(ref, { status: 'accepted' }); return 'accepted';
  }
  await setDoc(ref, { members: [a, b], requester: me, status: 'pending', createdAt: Date.now() });
  return 'sent';
}
export const acceptFriend = (id) => updateDoc(doc(db, 'friendships', id), { status: 'accepted' });
export const removeFriendship = (id) => deleteDoc(doc(db, 'friendships', id));

export function subscribeGroups(uid, onData, onError) {
  return onSnapshot(collection(db, 'users', uid, 'groups'), (snap) => onData(snap.docs.map((d) => ({ id: d.id, ...d.data() })), { pending: snap.metadata.hasPendingWrites }), onError);
}
/* A group I am still allowed to read (false when I was removed or it was deleted) */
/* false only when the group is really gone or I am no longer a member; a network hiccup keeps it */
export async function groupReadable(gid) { try { const s = await getDoc(doc(db, 'groups', gid)); return s.exists(); } catch (e) { return e && e.code === 'permission-denied' ? false : true; } }
export const dropGroupIndex = (uid, gid) => deleteDoc(doc(db, 'users', uid, 'groups', gid));

export async function createGroup(uid, myName, name) {
  const gref = doc(collection(db, 'groups')), nm = cleanName(name, 'My group'), now = Date.now(), b = writeBatch(db);
  b.set(gref, { name: nm, ownerUid: uid, createdAt: now });
  b.set(doc(gref, 'members', uid), { name: cleanName(myName), role: 'owner', joinedAt: now });
  b.set(doc(db, 'users', uid, 'groups', gref.id), { name: nm, role: 'owner' });
  await b.commit(); return gref.id;
}
export async function groupMembers(gid) {
  const s = await getDocs(collection(db, 'groups', gid, 'members'));
  return s.docs.map((d) => ({ uid: d.id, ...d.data() })).sort((x, y) => (x.role === 'owner' ? -1 : y.role === 'owner' ? 1 : (x.joinedAt || 0) - (y.joinedAt || 0)));
}
export async function createInvite(uid, gid, gname, oldCode) {
  const code = rnd(10), b = writeBatch(db);
  if (oldCode) b.delete(doc(db, 'invites', oldCode));
  b.set(doc(db, 'invites', code), { gid, gname, createdBy: uid, createdAt: Date.now() });
  b.set(doc(db, 'users', uid, 'groups', gid), { name: gname, role: 'owner', invite: code });
  await b.commit(); return code;
}
export async function revokeInvite(uid, gid, gname, code) {
  const b = writeBatch(db);
  b.delete(doc(db, 'invites', code));
  b.set(doc(db, 'users', uid, 'groups', gid), { name: gname, role: 'owner' });
  await b.commit();
}
export async function previewInvite(code) {
  const s = await getDoc(doc(db, 'invites', cleanCode(code)));
  return s.exists() ? { code: cleanCode(code), ...s.data() } : null;
}
export async function joinGroup(uid, myName, code) {
  const inv = await previewInvite(code);
  if (!inv) throw new Error('This invite is not valid or was turned off.');
  const mine = await getDoc(doc(db, 'users', uid, 'groups', inv.gid));
  if (mine.exists()) return { gid: inv.gid, already: true, name: inv.gname };
  const b = writeBatch(db);
  b.set(doc(db, 'groups', inv.gid, 'members', uid), { name: cleanName(myName), role: 'member', joinedAt: Date.now(), code: inv.code });
  b.set(doc(db, 'users', uid, 'groups', inv.gid), { name: inv.gname, role: 'member' });
  await b.commit(); return { gid: inv.gid, already: false, name: inv.gname };
}
export const removeMember = (gid, uid) => deleteDoc(doc(db, 'groups', gid, 'members', uid));
export async function leaveGroup(uid, gid) {
  const b = writeBatch(db);
  b.delete(doc(db, 'groups', gid, 'members', uid));
  b.delete(doc(db, 'users', uid, 'groups', gid));
  await b.commit();
}
export async function deleteGroup(uid, gid, inviteCode) {
  const members = await groupMembers(gid), b = writeBatch(db);
  members.forEach((m) => b.delete(doc(db, 'groups', gid, 'members', m.uid)));
  if (inviteCode) b.delete(doc(db, 'invites', inviteCode));
  b.delete(doc(db, 'groups', gid));
  b.delete(doc(db, 'users', uid, 'groups', gid));
  await b.commit();
}
