const store = new Map(); const prefs = { v: null };
const listeners = new Set();
let cb = null;
const USER = __USER__;
const emit = () => { const docs = [...store.values()].map((d) => JSON.parse(JSON.stringify(d))); listeners.forEach((f) => setTimeout(() => f(docs, { fromCache: false, hasPendingWrites: false }), 10)); };
window.__fake = { tasks: () => [...store.values()] };
export function init() {}
export function onAuth(f) { cb = f; setTimeout(() => f(USER && !sessionStorage.__out ? { uid: 'u1', name: 'Tester', email: 't@t.com', photo: '' } : null), 30); return () => {}; }
export async function emailSignIn() {} export async function emailSignUp() {} export async function resetPassword() {} export async function signIn() {}
export const logout = async () => { try { sessionStorage.__out = 1; } catch {} cb && cb(null); };
export const subscribe = (u, f) => { listeners.add(f); emit(); return () => listeners.delete(f); };
export const subscribePrefs = (u, f) => { setTimeout(() => f(null, { fromCache: false }), 10); return () => {}; };
export const save = async (u, t) => { store.set(t.id, JSON.parse(JSON.stringify(t))); emit(); };
export const remove = async (u, id) => { store.delete(id); emit(); };
export const saveMany = async (u, ts) => { ts.forEach((t) => store.set(t.id, t)); emit(); };
export const pushSupported = async () => false, enablePush = async () => 't', disablePush = async () => {}, dropDevice = async () => {}, saveReminder = async () => {}, deleteReminder = async () => {}, savePrefs = async () => {};
const photoStore = new Map();
window.__photos = photoStore;
export const savePhoto = async (u, id, rec) => { photoStore.set(id, JSON.parse(JSON.stringify(rec))); };
export const getPhoto = async (u, id) => photoStore.get(id) || null;
export const deletePhoto = async (u, id) => { photoStore.delete(id); };

/* ---------- friends and groups (in-memory) ---------- */
const prof = new Map([['u2', { name: 'Rafi', code: 'RAFI2345' }]]);
const codes = new Map([['RAFI2345', 'u2']]);
const fships = new Map(); const grp = new Map(); const gm = new Map(); const invs = new Map();
const myIdx = new Map(); const fsL = new Set(); const grL = new Set();
let seq = 0; const rn = (n) => { const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s = ''; for (let i = 0; i < n; i++) s += A[(seq++ * 7 + i * 3) % 32]; return s; };
const fsEmit = () => fsL.forEach((f) => setTimeout(() => f([...fships].map(([id, d]) => ({ id, ...d }))), 5));
const grEmit = () => grL.forEach((f) => setTimeout(() => f([...myIdx].map(([id, d]) => ({ id, ...d }))), 5));
window.__social = { fships, grp, gm, invs, profs: prof, joinAsRafi: (code) => { const inv = invs.get(code); gm.get(inv.gid).set('u2', { name: 'Rafi', role: 'member', joinedAt: 2 }); grEmit(); }, rafiAsks: () => { fships.set('u1_u2', { members: ['u1', 'u2'], requester: 'u2', status: 'pending' }); fsEmit(); } };
export const cleanCode = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
export const fmtCode = (c) => String(c || '').replace(/^(.{4})(.+)$/, '$1-$2');
export async function ensureProfile(uid, name) { if (!prof.has(uid)) { const code = 'TEST' + rn(4); prof.set(uid, { name, code }); codes.set(code, uid); } return { ...prof.get(uid) }; }
export const getProfile = async (uid) => prof.get(uid) || null;
export const lookupCode = async (c) => { const uid = codes.get(cleanCode(c)); return uid ? { uid, name: prof.get(uid).name } : null; };
export const subscribeFriendships = (u, f) => { fsL.add(f); fsEmit(); return () => fsL.delete(f); };
export async function sendRequest(me, other) { const id = [me, other].sort().join('_'), d = fships.get(id); if (d) { if (d.status === 'accepted') return 'friends'; if (d.requester === me) return 'waiting'; d.status = 'accepted'; fsEmit(); return 'accepted'; } fships.set(id, { members: [me, other].sort(), requester: me, status: 'pending' }); fsEmit(); return 'sent'; }
export const acceptFriend = async (id) => { fships.get(id).status = 'accepted'; fsEmit(); };
export const removeFriendship = async (id) => { fships.delete(id); fsEmit(); };
export const subscribeGroups = (u, f) => { grL.add(f); grEmit(); return () => grL.delete(f); };
export const groupReadable = async (gid) => grp.has(gid);
export const dropGroupIndex = async (u, gid) => { myIdx.delete(gid); grEmit(); };
export async function createGroup(uid, myName, name) { const id = 'g' + (++seq); grp.set(id, { name, ownerUid: uid }); gm.set(id, new Map([[uid, { name: myName, role: 'owner', joinedAt: 1 }]])); myIdx.set(id, { name, role: 'owner' }); grEmit(); return id; }
export const groupMembers = async (gid) => [...gm.get(gid)].map(([uid, d]) => ({ uid, ...d }));
export async function createInvite(uid, gid, gname, old) { if (old) invs.delete(old); const code = 'INV' + rn(7); invs.set(code, { gid, gname }); myIdx.set(gid, { name: gname, role: 'owner', invite: code }); grEmit(); return code; }
export async function revokeInvite(uid, gid, gname, code) { invs.delete(code); myIdx.set(gid, { name: gname, role: 'owner' }); grEmit(); }
export const previewInvite = async (c) => { const k = cleanCode(c), i = invs.get(k); return i ? { code: k, ...i } : null; };
export async function joinGroup(uid, myName, code) { const inv = await previewInvite(code); if (!inv) throw new Error('This invite is not valid or was turned off.'); if (myIdx.has(inv.gid)) return { gid: inv.gid, already: true, name: inv.gname }; gm.get(inv.gid).set(uid, { name: myName, role: 'member', joinedAt: 3 }); myIdx.set(inv.gid, { name: inv.gname, role: 'member' }); grEmit(); return { gid: inv.gid, already: false, name: inv.gname }; }
export const removeMember = async (gid, uid) => { gm.get(gid).delete(uid); };
export async function leaveGroup(uid, gid) { gm.get(gid).delete(uid); myIdx.delete(gid); grEmit(); }
export async function deleteGroup(uid, gid, code) { if (code) invs.delete(code); grp.delete(gid); gm.delete(gid); myIdx.delete(gid); grEmit(); }
