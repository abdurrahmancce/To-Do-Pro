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

/* ---------- shared tasks (in-memory) ---------- */
const shares = new Map(); const shL = new Set(); const acts = new Map(); const actL = new Map();
const clone = (x) => JSON.parse(JSON.stringify(x));
const shEmit = () => shL.forEach((f) => setTimeout(() => f([...shares].filter(([, d]) => d.members.includes('u1')).map(([id, d]) => ({ id, ...clone(d) })), { fromCache: false, hasPendingWrites: false }), 5));
const actEmit = (id) => (actL.get(id) || new Set()).forEach((f) => setTimeout(() => f([...(acts.get(id) || [])].sort((a, b) => b.at - a.at).map((x, i) => ({ id: 'a' + i, ...x }))), 5));
const log = (id, uid, name, text) => { if (!acts.has(id)) acts.set(id, []); acts.get(id).push({ uid, name, text, at: Date.now() + acts.get(id).length }); actEmit(id); };
export const shareFields = (t) => { const o = {}; for (const k of ['title', 'notes', 'date', 'priority', 'completed', 'completedAt', 'subtasks', 'alarm', 'alarmRepeat', 'tags', 'photos']) o[k] = t[k] === undefined ? null : t[k]; const refs = (l) => (Array.isArray(l) ? l : []).map((p) => ({ id: p.id, cap: p.cap || '' })); o.subtasks = (t.subtasks || []).map((x) => ({ id: x.id, text: x.text, done: !!x.done, photos: refs(x.photos) })); o.photos = refs(t.photos); o.tags = t.tags || []; return clone(o); };
export const subscribeShares = (u, f) => { shL.add(f); shEmit(); return () => shL.delete(f); };
export async function createShare(uid, ownerName, task, people, viewers, extra = {}) {
  const id = 'sh' + (++seq), names = { [uid]: ownerName }, members = [uid];
  people.forEach((p) => { if (!members.includes(p.uid)) { members.push(p.uid); names[p.uid] = p.name; } });
  shares.set(id, { ownerUid: uid, ownerName, sourceId: task.id, members, viewers: viewers.filter((v) => members.includes(v)), names, task: shareFields(task), rev: 1, updatedAt: Date.now(), updatedBy: uid, ...(extra.groupId ? { groupId: extra.groupId, groupName: extra.groupName, assignee: extra.assignee || '', ring: extra.ring !== false } : {}) });
  if (extra.groupId) idx(extra.groupId, id, uid, false);
  shEmit(); return id;
}
export async function updateShareMembers(id, uid, people, viewers, group) {
  const d = shares.get(id); const names = { [uid]: d.names[uid] }, members = [uid];
  people.forEach((p) => { if (!members.includes(p.uid)) { members.push(p.uid); names[p.uid] = p.name; } });
  Object.assign(d, { members, names, viewers: viewers.filter((v) => members.includes(v)) }); if (group) { if (d.groupId !== group.id) Object.assign(d, { groupId: group.id, groupName: group.name, assignee: '', ring: true }); } else if (group === null) { delete d.groupId; delete d.groupName; delete d.assignee; delete d.ring; } shEmit(); return { members, names };
}
export async function editShare(id, uid, name, mutate, describe, picIds = []) {
  const d = shares.get(id); if (!d) throw new Error('This shared task no longer exists.');
  const before = clone(d.task), after = mutate(clone(d.task)); d.task = after; d.rev++; d.updatedBy = uid; d.updatedAt = Date.now(); d.pics = [...new Set([...(d.pics || []), ...picIds])];
  (describe ? describe(before, after) : []).slice(0, 5).forEach((l) => log(id, uid, name, l)); shEmit(); return { before, after, rev: d.rev };
}
export const pushShareTask = (id, uid, name, task, describe, picIds = []) => editShare(id, uid, name, () => shareFields(task), describe, picIds);
const spics = new Map();
export const saveSharePhoto = async (id, uid, pid, rec) => { spics.set(id + '/' + pid, { d: rec.d, w: rec.w || 0, h: rec.h || 0, t: rec.t || 1, by: uid }); };
export const addSharePics = async (id, pids) => { const s = shares.get(id); if (s) { s.pics = [...new Set([...(s.pics || []), ...pids])]; shEmit(); } };
export const getSharePhoto = async (id, pid) => spics.get(id + '/' + pid) || null;
export const listGroups = async () => [...myIdx].map(([id, d]) => ({ id, ...d }));
export const listFriendships = async () => [...fships].map(([id, d]) => ({ id, ...d }));
export const subscribeActivity = (id, f) => { if (!actL.has(id)) actL.set(id, new Set()); actL.get(id).add(f); actEmit(id); return () => actL.get(id).delete(f); };
export const addActivity = async (id, uid, name, text) => log(id, uid, name, text);
export async function leaveShare(id, uid) { const d = shares.get(id); d.members = d.members.filter((m) => m !== uid); shEmit(); }
export async function stopShare(id) { shares.delete(id); acts.delete(id); shEmit(); }
const gidx = new Map(), coms = new Map(), comL = new Map(), notices = new Map();
const idx = (gid, sid, uid, view) => { if (!gidx.has(gid)) gidx.set(gid, new Map()); gidx.get(gid).set(sid, { ownerUid: uid, view: !!view }); };
export const indexGroupTask = async (gid, sid, uid, view) => idx(gid, sid, uid, view);
export const listGroupTasks = async (gid) => [...(gidx.get(gid) || [])].map(([id, d]) => ({ id, ...d }));
export const joinShare = async (sid, uid, name, view) => { const d = shares.get(sid); if (!d || d.members.includes(uid)) return; d.members.push(uid); d.names[uid] = name; if (view) d.viewers.push(uid); shEmit(); };
const comEmit = (id) => (comL.get(id) || new Set()).forEach((f) => setTimeout(() => f(clone(coms.get(id) || [])), 5));
export const subscribeComments = (id, f) => { if (!comL.has(id)) comL.set(id, new Set()); comL.get(id).add(f); comEmit(id); return () => comL.get(id).delete(f); };
export const addComment = async (id, uid, name, text) => { if (!coms.has(id)) coms.set(id, []); coms.get(id).push({ id: 'c' + (++seq), uid, name, text: String(text).trim().slice(0, 1000), at: Date.now() + seq }); comEmit(id); };
export const deleteComment = async (id, cid) => { coms.set(id, (coms.get(id) || []).filter((c) => c.id !== cid)); comEmit(id); };
export const sendNotice = async (sid, fromUid, fromName, toUid, kind, title, body, delay = 0) => { notices.set(kind === 'comment' ? toUid + '_' + sid + '_c' + (++seq) : toUid + '_' + sid + '_change', { toUid, fromUid, fromName, shareId: sid, kind, title, body, delay }); };
export const listReminderIds = async () => [];
window.__shares = {
  shares, acts, spics, gidx, coms, notices,
  rafiComment(id, text) { if (!coms.has(id)) coms.set(id, []); coms.get(id).push({ id: 'c' + (++seq), uid: 'u2', name: 'Rafi', text, at: Date.now() + seq }); comEmit(id); },
  /* a task on a group board that was created before I joined (I am not a member of it yet) */
  oldGroupTask(gid, gname, task, view = false) { const id = 'sh' + (++seq); shares.set(id, { ownerUid: 'u2', ownerName: 'Rafi', sourceId: 'r9', members: ['u2'], viewers: [], names: { u2: 'Rafi' }, task: shareFields({ title: 'x', notes: '', date: '', priority: 'medium', completed: false, subtasks: [], tags: [], alarm: null, alarmRepeat: 'none', ...task }), rev: 1, updatedAt: Date.now(), updatedBy: 'u2', groupId: gid, groupName: gname, assignee: '', ring: true, groupView: !!view }); idx(gid, id, 'u2', view); shEmit(); return id; },
  /* somebody else (Rafi, u2) changes a share, or shares something with me */
  rafiEdit(id, mutate) { const d = shares.get(id); d.task = mutate(clone(d.task)); d.rev++; d.updatedBy = 'u2'; shEmit(); },
  fromRafi(task, extra = {}, viewer = false) { const id = 'sh' + (++seq); shares.set(id, { ownerUid: 'u2', ownerName: 'Rafi', sourceId: 'r1', members: ['u2', 'u1'], viewers: viewer ? ['u1'] : [], names: { u2: 'Rafi', u1: 'Tester' }, task: shareFields({ title: 'x', notes: '', date: '', priority: 'medium', completed: false, subtasks: [], tags: [], alarm: null, alarmRepeat: 'none', ...task }), rev: 1, updatedAt: Date.now(), updatedBy: 'u2', ...extra }); shEmit(); return id; },
};
