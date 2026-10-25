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
