/* =====================================================
   To-Do Pro — app logic
   - Works offline & local-only out of the box
   - Syncs across devices when Firebase is configured (cloud.js)
   ===================================================== */

import { parseQuick, fmtDay, fmtTime } from './quickparse.js';
import { isHabit, completeHabit, streakOf, weekStats } from './habits.js';
import * as ph from './photos.js';

const LS = {
  local: 'tasks-pro',           // local-only task list (same key as the old version)
  cachePrefix: 'tasks-cache-',   // per-user mirror of cloud data for instant/offline start
  lastUid: 'tp-last-uid',
  theme: 'theme',
  view: 'tp-view',
  collapsed: 'tp-collapsed',
  alarmSecs: 'tp-alarm-secs',   // how long the reminder sound rings (0 = until dismissed)
  accent: 'tp-accent',
  goal: 'tp-goal',               // weekly goal: tasks to finish in 7 days (0 = off)
  groupBy: 'tp-groupby',         // All view: 'date' (Overdue / Today / Later / No date) or 'section'
  calMode: 'tp-cal-mode',
  preMin: 'tp-pre-min',          // pre-reminder: minutes before the alarm (0 = off)
  tourDone: 'tp-tour-done',      // set once the first-time tour was finished or skipped
  seenUpdate: 'tp-seen-update',  // which What's new announcement this device has already seen
  echo: 'tp-echo',               // backup push 90 s later if you have not reacted ('0' = off)
};

/* ---------- helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const todayStr = () => ymd(new Date());
const shiftDay = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return ymd(d); };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const track = (name) => { try { window.track?.(name); } catch { /* analytics is optional */ } };
const icon = (n) => `<svg class="i" aria-hidden="true"><use href="#i-${n}"/></svg>`;
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
const lsGet = (k, fb) => { try { const v = localStorage.getItem(k); return v === null ? fb : v; } catch { return fb; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } };
const parseJSON = (s, fb) => { try { return JSON.parse(s); } catch { return fb; } };

function dateLabel(s) {
  if (!s) return '';
  if (s === todayStr()) return 'Today';
  if (s === shiftDay(1)) return 'Tomorrow';
  if (s === shiftDay(-1)) return 'Yesterday';
  const d = new Date(s + 'T00:00:00');
  const opts = { weekday: 'short', month: 'short', day: 'numeric' };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString('en-US', opts);
}
function whenLabel(iso) {
  const d = new Date(iso);
  const t = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const day = ymd(d);
  if (day === todayStr()) return `Today ${t}`;
  if (day === shiftDay(1)) return `Tomorrow ${t}`;
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${t}`;
}

/* ---------- state ---------- */
const state = {
  tasks: [],
  trash: [],             // soft-deleted tasks (kept 30 days)
  view: ['all', 'today', 'upcoming', 'calendar', 'done'].includes(lsGet(LS.view)) ? lsGet(LS.view) : 'all',
  search: '',
  tag: '',                // active tag filter
  groupBy: lsGet(LS.groupBy, 'date') === 'section' ? 'section' : 'date',
  editingId: null,
  user: null,            // signed-in user (cloud) or null
  sync: 'local',         // local | syncing | synced | offline | error
  syncDetail: '',
  pending: new Set(),    // task ids saved on this device but not yet confirmed by the server
  collapsed: new Set(parseJSON(lsGet(LS.collapsed, '[]'), [])),
  justAdded: null,
  selecting: false,      // bulk-select mode
  sel: new Set(),
  cal: { mode: lsGet(LS.calMode, 'month') === 'week' ? 'week' : 'month', cursor: new Date(), day: '' },
};
let cloud = null;
let unsubscribe = null;
let installEvent = null;

const MAX_SUBS = 50, MAX_PHOTOS = 10, MAX_STEP_PHOTOS = 3;
function cleanPhotos(list, max) { // photo references: { id, cap }; the pictures themselves live in photos.js
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  return list.slice(0, max).map((p) => ({ id: String(p?.id ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40), cap: String(p?.cap ?? '').slice(0, 200) }))
    .filter((p) => p.id && !seen.has(p.id) && seen.add(p.id));
}
function cleanSubs(list) { // checklist steps: { id, text, done, photos }
  if (!Array.isArray(list)) return [];
  return list.slice(0, MAX_SUBS).map((x) => ({
    id: String(x?.id ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || newId().slice(0, 12),
    text: String(x?.text ?? '').trim().slice(0, 200),
    done: !!x?.done,
    photos: cleanPhotos(x?.photos, MAX_STEP_PHOTOS),
  })).filter((x) => x.text);
}
const MAX_TAGS = 10;
function cleanTags(v) {
  const raw = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[,\s]+/) : [];
  const out = [];
  for (const x of raw) {
    const t = String(x ?? '').replace(/^#+|^@+/, '').trim().toLowerCase().replace(/[^\p{L}\p{N}_-]/gu, '').slice(0, 24);
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}
const validDate = (v) => { const d = new Date(v); return v && !isNaN(d) ? d : null; };
function normalize(t, i = 0) {
  t = t && typeof t === 'object' ? t : {};
  const id = String(t.id ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 100) || newId(); // ids end up in database paths
  const created = validDate(t.createdAt);
  const alarm = validDate(t.alarm);
  return {
    id,
    title: String(t.title ?? '').slice(0, 200),
    heading: String(t.heading ?? '').slice(0, 100),
    notes: String(t.notes ?? '').slice(0, 20000),
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(t.date || '')) ? t.date : '',
    priority: ['low', 'medium', 'high'].includes(t.priority) ? t.priority : 'medium',
    completed: !!t.completed,
    completedAt: validDate(t.completedAt) ? t.completedAt : null,
    createdAt: created ? created.toISOString() : new Date().toISOString(),
    updatedAt: Number(t.updatedAt) || Date.now(),
    order: Number.isFinite(t.order) ? t.order : i,
    alarm: alarm ? alarm.toISOString() : null,
    alarmRepeat: ['daily', 'weekly'].includes(t.alarmRepeat) ? t.alarmRepeat : 'none',
    alarmFired: !!t.alarmFired,
    deletedAt: Number(t.deletedAt) || 0,   // set while the task sits in Trash
    subtasks: cleanSubs(t.subtasks),
    tags: cleanTags(t.tags),
    photos: cleanPhotos(t.photos, MAX_PHOTOS),
    doneDates: Array.isArray(t.doneDates) ? t.doneDates.filter((x) => typeof x === 'string').slice(-400) : [], // habit check-ins (repeating tasks)
  };
}
const byOrder = (a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt);
const loadList = (key) => {
  const arr = parseJSON(lsGet(key, '[]'), []);
  return Array.isArray(arr) ? arr.map(normalize) : [];
};
const cacheKey = () => (state.user ? LS.cachePrefix + state.user.uid : LS.local);
const persist = () => lsSet(cacheKey(), JSON.stringify([...state.tasks, ...state.trash]));
function setAll(list) { // split a stored/synced list into live tasks and Trash
  state.tasks = list.filter((t) => !t.deletedAt);
  state.trash = list.filter((t) => t.deletedAt);
}
const TRASH_MS = 30 * 24 * 3600e3;
const UNDO_MS = 5000;
const cloudOn = () => !!(cloud && state.user);

/* ---------- mutations ---------- */
function upsert(task, { silent = false } = {}) {
  task.updatedAt = Date.now();
  const i = state.tasks.findIndex((t) => t.id === task.id);
  task.deletedAt = 0;
  state.trash = state.trash.filter((t) => t.id !== task.id);
  if (i >= 0) state.tasks[i] = task; else state.tasks.push(task);
  persist();
  if (cloudOn()) {
    setSync('syncing');
    cloud.save(state.user.uid, task).catch(onCloudError);
    mirrorReminder(task);
  }
  if (!silent) render();
}
/* Delete = move to Trash (kept 30 days, synced to all devices). Its reminder is cancelled. */
function removeTask(id, { silent = false } = {}) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return;
  const gone = { ...t, deletedAt: Date.now(), updatedAt: Date.now() };
  state.tasks = state.tasks.filter((x) => x.id !== id);
  state.trash.push(gone);
  persist();
  if (cloudOn()) {
    setSync('syncing');
    cloud.save(state.user.uid, gone).catch(onCloudError);
    cloud.deleteReminder(id).catch(() => {});
    cloud.deleteReminder(id + '_echo').catch(() => {});
  }
  if (!silent) render();
}
const photoIdsOf = (t) => [...(t.photos || []), ...(t.subtasks || []).flatMap((x) => x.photos || [])].map((p) => p.id);
function purgeTask(id, { silent = false } = {}) { // permanent
  const gone = state.trash.find((t) => t.id === id);
  if (gone) photoIdsOf(gone).forEach((p) => ph.removePhoto(p));
  state.trash = state.trash.filter((t) => t.id !== id);
  persist();
  if (cloudOn()) { setSync('syncing'); cloud.remove(state.user.uid, id).catch(onCloudError); }
  if (!silent) render();
}
function restoreTask(id) {
  const t = state.trash.find((x) => x.id === id);
  if (!t) return;
  upsert({ ...t, deletedAt: 0 });
  toast('Task restored');
}
function purgeExpired() {
  const old = state.trash.filter((t) => Date.now() - t.deletedAt > TRASH_MS);
  if (!old.length) return;
  old.forEach((t) => purgeTask(t.id, { silent: true }));
  render();
}

/* Mirror upcoming alarms to reminders/{taskId} so the push worker can find them */
const preMin = () => { const n = Number(lsGet(LS.preMin, '0')); return [0, 5, 10, 30].includes(n) ? n : 0; };
const echoOn = () => lsGet(LS.echo, '1') !== '0';
function mirrorReminder(t) {
  if (!cloudOn() || !window.FIREBASE_VAPID_KEY) return;
  const warn = (e) => console.warn('reminder mirror failed', e?.message || e);
  if (t.alarm && !t.completed && !t.alarmFired) {
    const pre = preMin();
    const preAt = new Date(t.alarm).getTime() - pre * 60e3;
    const early = pre > 0 && preAt > Date.now() + 60e3; // only if the early time is still ahead
    cloud.saveReminder({
      id: t.id, uid: state.user.uid, title: t.title.slice(0, 120),
      body: (t.notes || '').slice(0, 140), alarm: t.alarm, repeat: t.alarmRepeat,
      fireAt: early ? new Date(preAt).toISOString() : t.alarm, stage: early ? 'pre' : 'main', pre, echo: echoOn(),
    }).catch(warn);
    cloud.deleteReminder(t.id + '_echo').catch(() => {}); // a new/changed alarm resets any pending backup push
  } else {
    cloud.deleteReminder(t.id).catch(() => {});
    if (t.completed) cloud.deleteReminder(t.id + '_echo').catch(() => {});
  }
}
/* "Seen" means this app is really in front of you; a hidden/background tab ringing must not cancel the backup push for your phone */
const seenNow = () => document.visibilityState === 'visible' && document.hasFocus();
/* Pre-reminder / backup choices are shared by all devices. The first mirror after sign-in waits until
   both the tasks and the shared choices arrived from the server, so one device can never overwrite
   another device's setting with its own default. */
let mirrorBoot = { prefs: false, tasks: false, done: false };
function bootMirror() { if (!mirrorBoot.done && mirrorBoot.prefs && mirrorBoot.tasks) { mirrorBoot.done = true; state.tasks.forEach(mirrorReminder); } }
/* You have seen a fired reminder on some device: cancel its backup push */
function ackEchoes() {
  if (!cloudOn() || !window.FIREBASE_VAPID_KEY || !seenNow()) return;
  const now = Date.now();
  state.tasks.filter((t) => t.alarm && !t.completed && new Date(t.alarm).getTime() <= now && now - new Date(t.alarm).getTime() < 10 * 60e3)
    .forEach((t) => cloud.deleteReminder(t.id + '_echo').catch(() => {}));
}
function topOrder() {
  return state.tasks.length ? Math.min(...state.tasks.map((t) => t.order)) - 1 : 0;
}
function createTask(fields) {
  track(fields.alarm ? 'task-added-with-alarm' : 'task-added');
  const t = normalize({ ...fields, id: newId(), order: topOrder(), createdAt: new Date().toISOString() });
  state.justAdded = t.id;
  upsert(t);
  return t;
}
/* Finishing a repeating task checks it in for today and moves it to the next occurrence (a habit);
   any other task is simply closed. */
const finishTask = (t) => (isHabit(t) && !t.completed ? completeHabit(t) : { ...t, completed: true, completedAt: new Date().toISOString() });
function toggleComplete(id) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return;
  const was = { ...t };
  if (!t.completed) track('task-completed');
  const undo = { action: { label: 'Undo', fn: () => upsert(was) } };
  if (t.completed) { upsert({ ...t, completed: false, completedAt: null }); toast('Marked as pending', undo); return; }
  const copy = finishTask(t);
  upsert(copy);
  if (isHabit(copy)) {
    const n = streakOf(copy.doneDates, copy.alarmRepeat).cur, unit = copy.alarmRepeat === 'weekly' ? 'week' : 'day';
    toast(`Done \u00b7 \u{1F525} ${n} ${unit}${n === 1 ? '' : 's'} streak`, undo);
  } else toast('Task completed', undo);
}
function deleteWithUndo(id) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return;
  const backup = { ...t };
  removeTask(id);
  toast('Moved to Trash', { duration: UNDO_MS, action: { label: 'Undo', fn: () => upsert(backup) } });
}

/* =====================================================
   THEME
   ===================================================== */
const ACCENTS = ['indigo', 'violet', 'blue', 'teal', 'green', 'orange', 'rose'];
const prefTheme = () => { const p = lsGet(LS.theme, 'auto'); return p === 'light' || p === 'dark' ? p : 'auto'; };
const resolveTheme = () => { const p = prefTheme(); return p === 'auto' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : p; };
const goalN = () => { const n = Math.floor(Number(lsGet(LS.goal, '0'))); return Number.isFinite(n) && n > 0 ? Math.min(500, n) : 0; };
const prefAccent = () => { const a = lsGet(LS.accent, 'teal'); return ACCENTS.includes(a) ? a : 'teal'; };
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  $('#theme-icon use').setAttribute('href', theme === 'dark' ? '#i-sun' : '#i-moon');
  $('#theme-icon').parentElement.setAttribute('aria-label', theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
}
function applyAppearance() {
  applyTheme(resolveTheme());
  document.documentElement.setAttribute('data-accent', prefAccent());
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  if (bg) $('#meta-theme').setAttribute('content', bg);
  $$('#f-theme button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.themePref === prefTheme())));
  $$('#f-accent button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.accentPick === prefAccent())));
}
const shareLook = () => { try { if (cloudOn()) cloud.savePrefs(state.user.uid, { accent: prefAccent(), theme: prefTheme() }).catch(() => {}); } catch { /* not signed in */ } };
$('#btn-theme').addEventListener('click', () => {
  lsSet(LS.theme, resolveTheme() === 'dark' ? 'light' : 'dark');
  applyAppearance(); shareLook();
});
$$('#f-theme button').forEach((b) => b.addEventListener('click', () => { lsSet(LS.theme, b.dataset.themePref); applyAppearance(); shareLook(); }));
$$('#f-accent button').forEach((b) => b.addEventListener('click', () => { lsSet(LS.accent, b.dataset.accentPick); applyAppearance(); shareLook(); }));
try { matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { if (prefTheme() === 'auto') applyAppearance(); }); } catch { /* old browsers */ }

/* =====================================================
   RENDER
   ===================================================== */
const listEl = $('#list');
const VIEW_META = {
  all:      { title: 'All tasks',  empty: ['Nothing here yet', 'Add a task above to get started.'] },
  today:    { title: 'Today',      empty: ['You’re all clear', 'Nothing is due today. Enjoy your day!'] },
  upcoming: { title: 'Upcoming',   empty: ['Nothing upcoming', 'Tasks with a future due date show up here.'] },
  calendar: { title: 'Calendar',   empty: ['', ''] },
  trash:    { title: 'Trash',      empty: ['Trash is empty', 'Deleted tasks stay here for 30 days before they are removed for good.'] },
  done:     { title: 'Completed',  empty: ['No completed tasks', 'Finished tasks will be listed here.'] },
};

function compute() {
  const td = todayStr();
  const q = state.search.trim().toLowerCase();
  const sorted = [...state.tasks].sort(byOrder);
  const pending = sorted.filter((t) => !t.completed);
  const isToday = (t) => (t.date && t.date <= td) || (t.alarm && ymd(new Date(t.alarm)) === td);
  const counts = {
    all: pending.length,
    today: pending.filter(isToday).length,
    upcoming: pending.filter((t) => t.date > td).length,
    done: sorted.length - pending.length,
    reminders: pending.filter((t) => t.alarm).length,
    trash: state.trash.length,
  };

  let tasks, mode, title;
  if (state.view === 'trash' && !q) {
    tasks = [...state.trash].sort((a, b) => b.deletedAt - a.deletedAt);
    mode = 'trash'; title = VIEW_META.trash.title;
  } else if (q) {
    tasks = sorted.filter((t) => [t.title, t.notes, t.heading, (t.tags || []).join(' ')].some((x) => x.toLowerCase().includes(q)));
    mode = 'search'; title = 'Search results';
  } else if (state.view === 'done') {
    tasks = sorted.filter((t) => t.completed).sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || ''));
    mode = 'flat'; title = VIEW_META.done.title;
  } else if (state.view === 'upcoming') {
    tasks = pending.filter((t) => t.date > td).sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order);
    mode = 'dates'; title = VIEW_META.upcoming.title;
  } else if (state.view === 'today') {
    tasks = pending.filter(isToday);
    mode = 'headings'; title = VIEW_META.today.title;
  } else if (state.groupBy === 'date') {
    tasks = pending;
    mode = 'status'; title = VIEW_META.all.title;
  } else {
    tasks = pending;
    mode = 'headings'; title = VIEW_META.all.title;
  }

  if (state.tag && mode !== 'trash') tasks = tasks.filter((t) => t.tags.includes(state.tag));
  const groups = [];
  const bucket = new Map();
  const add = (key, label, extra = {}) => {
    if (!bucket.has(key)) { const g = { key, label, tasks: [], ...extra }; bucket.set(key, g); groups.push(g); }
    return bucket.get(key);
  };
  if (mode === 'headings' || mode === 'search') tasks.forEach((t) => add(t.heading, t.heading || 'General', { heading: t.heading }).tasks.push(t));
  else if (mode === 'status') {
    const ST = [['overdue', 'Overdue'], ['today', 'Today'], ['later', 'Later'], ['none', 'No date']];
    const kind = (t) => (t.date && t.date < td && !isHabit(t) ? 'overdue' : isToday(t) ? 'today' : t.date ? 'later' : 'none');
    const by = { overdue: [], today: [], later: [], none: [] };
    tasks.forEach((t) => by[kind(t)].push(t));
    by.later.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order);
    ST.forEach(([k, l]) => { if (by[k].length) add('st:' + k, l, { tone: k }).tasks = by[k]; });
  }
  else if (mode === 'dates') tasks.forEach((t) => add(t.date, dateLabel(t.date)).tasks.push(t));
  else if (mode === 'trash') add('', 'Trash').tasks = tasks;
  else add('', 'Completed').tasks = tasks;

  return { tasks, groups, counts, mode, title, td };
}

function taskHTML(t, td) {
  const overdue = !t.completed && t.date && t.date < td && !isHabit(t);
  const chips = [];
  if (t.date) {
    const cls = overdue ? 'overdue' : t.date === td ? 'today' : '';
    chips.push(`<span class="chip ${cls}">${icon('calendar')}${overdue ? 'Overdue · ' : ''}${esc(dateLabel(t.date))}</span>`);
  }
  if (t.alarm && !t.completed) {
    chips.push(`<span class="chip alarm">${icon('bell')}${esc(whenLabel(t.alarm))}${t.alarmRepeat !== 'none' ? ` ${icon('repeat')}${t.alarmRepeat}` : ''}</span>`);
  }
  if (cloudOn() && state.pending.has(t.id)) chips.push(`<span class="chip unsynced" title="Saved on this device. Waiting to upload to your account.">${state.sync === 'offline' ? 'Offline · not uploaded' : 'Syncing…'}</span>`);
  if (t.subtasks?.length) {
    const d = t.subtasks.filter((x) => x.done).length, all = d === t.subtasks.length;
    chips.push(`<span class="chip subs${all ? ' all' : ''}" title="Checklist progress">${icon('listcheck')}${d}/${t.subtasks.length}</span>`);
  }
  const nPh = photoIdsOf(t).length;
  if (nPh) chips.push(`<span class="chip photos" title="Photos">${icon('image')}${nPh}</span>`);
  (t.tags || []).forEach((g) => chips.push(`<button type="button" class="chip tag${state.tag === g ? ' on' : ''}" data-tag="${esc(g)}" title="Filter by #${esc(g)}">#${esc(g)}</button>`));
  if (t.completed) chips.push(`<span class="chip finished" title="Completed">\u2714 Completed</span>`);
  if (isHabit(t) && !t.completed) {
    const n = streakOf(t.doneDates, t.alarmRepeat).cur;
    if (n > 0) chips.push(`<span class="chip streak" title="Current streak">\u{1F525} ${n}</span>`);
  }
  return `
  <li class="task${t.completed ? ' done' : ''}${state.justAdded === t.id ? ' enter' : ''}${state.sel.has(t.id) ? ' selected' : ''}" data-id="${esc(t.id)}" data-priority="${t.priority}" tabindex="0">
    <div class="swipe-tray tray-l" aria-hidden="true">${icon('check')}<span>${t.completed ? 'Reopen' : 'Done'}</span></div>
    <div class="swipe-tray tray-r"><button class="sw-snooze" type="button" tabindex="-1">${icon('snooze')}<span>Snooze</span></button><button class="sw-del" type="button" tabindex="-1">${icon('trash')}<span>Delete</span></button></div>
    <span class="sel-box" aria-hidden="true">${icon('check')}</span>
    <span class="grip" aria-hidden="true" title="Drag to reorder">${icon('grip')}</span>
    <button class="check" type="button" role="checkbox" aria-checked="${t.completed}" aria-label="${t.completed ? 'Mark as pending' : 'Mark as complete'}">${icon('check')}</button>
    <div class="t-body">
      <div class="t-title">${esc(t.title)}</div>
      ${t.notes ? `<div class="t-notes">${esc(t.notes)}</div>` : ''}
      ${t.subtasks?.length ? `<ul class="t-subs">${t.subtasks.slice(0, 8).map((x) => `<li class="t-sub${x.done ? ' done' : ''}" data-sid="${esc(x.id)}"><button type="button" class="t-sub-check" role="checkbox" aria-checked="${x.done}" aria-label="${x.done ? 'Mark step as not done' : 'Mark step as done'}">${icon('check')}</button><span>${esc(x.text)}</span>${x.photos?.length ? `<button type="button" class="t-sub-photo" aria-label="Show photos of this step">${icon('image')}${x.photos.length}</button>` : ''}</li>`).join('')}${t.subtasks.length > 8 ? `<li class="t-sub-more">+${t.subtasks.length - 8} more</li>` : ''}</ul>` : ''}
      ${t.photos?.length ? `<div class="t-photos">${t.photos.slice(0, 4).map((p, i) => `<button type="button" class="t-photo" data-i="${i}" aria-label="Open photo ${i + 1}"><img data-pid="${esc(p.id)}" alt="${esc(p.cap || 'Photo')}"></button>`).join('')}${t.photos.length > 4 ? `<span class="t-photo-more">+${t.photos.length - 4}</span>` : ''}</div>` : ''}
      ${chips.length ? `<div class="t-meta">${chips.join('')}</div>` : ''}
    </div>
    <div class="t-actions">
      <button class="icon-btn sm edit" type="button" aria-label="Edit task">${icon('pencil')}</button>
      <button class="icon-btn sm del" type="button" aria-label="Delete task">${icon('trash')}</button>
    </div>
  </li>`;
}

/* ---------- focus rail (desktop right panel): ring, up next, last 10 days ---------- */
function renderRail(td, pct, done, total) {
  const rail = $('#rail'); if (!rail) return;
  const pending = state.tasks.filter((t) => !t.completed);
  const isDueToday = (t) => (t.date && t.date <= td) || (t.alarm && ymd(new Date(t.alarm)) === td);
  const overdue = pending.filter((t) => t.date && t.date < td && !isHabit(t)).length;
  const dueToday = pending.filter(isDueToday).length - overdue;
  const key = (t) => (t.alarm ? new Date(t.alarm).getTime() : new Date(t.date + 'T23:59:00').getTime());
  const up = pending.filter((t) => (t.alarm && new Date(t.alarm).getTime() >= Date.now() - 6e4) || (t.date && t.date >= td))
    .sort((a, b) => key(a) - key(b)).slice(0, 4);
  const counts = new Map();
  const bump = (d) => counts.set(d, (counts.get(d) || 0) + 1);
  state.tasks.forEach((t) => {
    if (t.completed && t.completedAt) bump(ymd(new Date(t.completedAt)));
    else if (isHabit(t) && Array.isArray(t.doneDates)) t.doneDates.forEach(bump);
  });
  const days = [];
  for (let i = 9; i >= 0; i--) { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - i); const k = ymd(d); days.push({ k, n: counts.get(k) || 0, d }); }
  const max = Math.max(1, ...days.map((x) => x.n)), sum = days.reduce((a, x) => a + x.n, 0);
  rail.innerHTML = `
    <section class="rail-card rail-progress" id="rail-progress" role="button" tabindex="0" aria-label="Progress. Open weekly summary">
      <div class="ring big" style="--p:${pct}"><span><b>${pct}%</b><small>done</small></span></div>
      <div class="rail-prog-text"><strong>${done} of ${total} tasks completed</strong>
        <small>${overdue ? `<i class="dot-red"></i>${overdue} overdue · ` : ''}${dueToday > 0 ? dueToday : 0} due today</small></div>
    </section>
    ${(() => { const g = goalN(), n = weekStats(state.tasks).total; return g
      ? `<section class="rail-card rail-goal" id="rail-goal" role="button" tabindex="0" aria-label="Weekly goal. Open weekly summary"><h3>Weekly goal <small>${Math.min(n, g)} / ${g}</small></h3><div class="goal-bar"><i style="width:${Math.min(100, Math.round((n / g) * 100))}%"></i></div></section>`
      : `<section class="rail-card rail-goal" id="rail-goal" role="button" tabindex="0"><h3>Weekly goal <small>not set</small></h3><p class="rail-empty">Set a target for the week. Open the summary to choose one.</p></section>`; })()}
    <section class="rail-card"><h3>Up next</h3>
      ${up.length ? `<ul class="up-list">${up.map((t) => `<li><button type="button" class="up-item" data-open="${esc(t.id)}"><span class="up-title">${esc(t.title)}</span><span class="up-when">${esc(t.alarm ? whenLabel(t.alarm) : dateLabel(t.date))}</span></button></li>`).join('')}</ul>` : '<p class="rail-empty">Nothing scheduled. Add a due date or reminder to see it here.</p>'}
    </section>
    <section class="rail-card"><h3>Last 10 days <small>${sum} completed</small></h3>
      <div class="bars" role="img" aria-label="Tasks completed per day over the last 10 days: ${sum} in total">
        ${days.map((x, i) => `<div class="bar-col${i === 9 ? ' now' : ''}" title="${x.n} completed · ${esc(x.d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }))}"><span class="bar-n">${x.n || ''}</span><span class="bar" style="height:${Math.max(x.n ? 8 : 3, Math.round((x.n / max) * 84))}px"></span><span class="bar-l">${x.d.toLocaleDateString('en-US', { weekday: 'narrow' })}</span></div>`).join('')}
      </div>
    </section>`;
}

let renderPending = false;
function render() {
  if (dragState || swipe?.locked) { renderPending = true; return; } // never rebuild the list mid-gesture
  renderPending = false;
  const { tasks, groups, counts, mode, title, td } = compute();
  const isCal = state.view === 'calendar' && !state.search;
  $('#btn-select').hidden = state.view === 'trash' && !state.search;

  // nav + counts
  $$('[data-view]').forEach((b) => {
    const on = b.dataset.view === state.view && !state.search;
    b.classList.toggle('active', on);
    if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  $$('[data-count]').forEach((el) => {
    const k = el.dataset.count;
    if (k === 'reminders-badge') { el.textContent = counts.reminders; el.hidden = !counts.reminders; return; }
    el.textContent = counts[k] ?? 0;
    el.dataset.zero = counts[k] ? '0' : '1';
  });

  // header
  const hr = new Date().getHours(), first = String(state.user?.name || '').trim().split(/\s+/)[0];
  const greet = (hr < 5 ? 'Working late' : hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening') + (first ? ', ' + first : '');
  $('#view-title').textContent = isCal ? 'Calendar' : (state.view === 'all' && !state.search) ? greet : title;
  const subDate = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  $('#view-sub').textContent = state.search
    ? `${tasks.length} result${tasks.length === 1 ? '' : 's'} for “${state.search.trim()}”`
    : isCal ? calSub()
    : state.view === 'trash' ? `${tasks.length} deleted task${tasks.length === 1 ? '' : 's'}`
    : state.view === 'all' ? (() => { const td0 = todayStr(); const od = state.tasks.filter((t) => !t.completed && t.date && t.date < td0 && !isHabit(t)).length; const open = state.tasks.filter((t) => !t.completed).length; return `${subDate} · ${open} open${od ? ` · ${od} overdue` : ''}`; })()
    : `${subDate} · ${tasks.length} task${tasks.length === 1 ? '' : 's'}`;

  // stats
  const total = state.tasks.length;
  const done = state.tasks.filter((t) => t.completed).length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  $('#stat-total').textContent = total;
  $('#stat-done').textContent = done;
  $('#pct').textContent = pct + '%';
  $('#ring').style.setProperty('--p', pct);

  const tagCount = new Map();
  state.tasks.filter((t) => !t.completed).forEach((t) => (t.tags || []).forEach((g) => tagCount.set(g, (tagCount.get(g) || 0) + 1)));
  if (state.tag && !tagCount.has(state.tag)) state.tag = '';
  renderSyncBar();
  const tb = $('#tag-bar');
  tb.hidden = !tagCount.size || isCal || mode === 'trash';
  tb.innerHTML = tb.hidden ? '' : [...tagCount].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([g, n]) => `<button type="button" class="tag-pill${state.tag === g ? ' on' : ''}" data-tag="${esc(g)}" aria-pressed="${state.tag === g}">#${esc(g)}<em>${n}</em></button>`).join('')
    + (state.tag ? '<button type="button" class="tag-clear" data-tag="">Clear filter</button>' : '');
  const gt = $('#group-toggle');
  gt.hidden = !(state.view === 'all' && !state.search);
  $$('button', gt).forEach((b) => b.setAttribute('aria-checked', String(b.dataset.group === state.groupBy)));
  renderRail(td, pct, done, total);

  $('.content').classList.toggle('selecting', state.selecting);
  $('#quick-form').hidden = isCal; $('#calendar').hidden = !isCal; listEl.hidden = isCal;
  if (isCal) qaPreview.hidden = true; else if (qaPreview.innerHTML) qaPreview.hidden = false;
  if (isCal) { renderCalendar(); $('#empty').hidden = true; renderReminders(counts); updateBulk(); return; }

  // Trash view
  if (mode === 'trash') {
    state.selecting = false; state.sel.clear();
    $('.content').classList.remove('selecting');
    $('#quick-form').hidden = true; $('#calendar').hidden = true; listEl.hidden = false;
    qaPreview.hidden = true; listEl.classList.add('no-drag');
    const DAY = 864e5;
    listEl.innerHTML = tasks.length ? `<div class="trash-bar"><span>Deleted tasks stay here for 30 days, then they are removed for good.</span><button class="btn btn-ghost sm" type="button" data-empty-trash>Empty trash</button></div>
      <ul class="group-list trash-list">${tasks.map((t) => {
        const age = Math.floor((Date.now() - t.deletedAt) / DAY), left = Math.max(0, 30 - age);
        const when = age < 1 ? 'Deleted today' : `Deleted ${age} day${age === 1 ? '' : 's'} ago`;
        return `<li class="trash-row" data-id="${esc(t.id)}"><div class="tr-main"><div class="tr-title">${esc(t.title || 'Untitled')}</div>
          <div class="tr-meta">${when} · ${left} day${left === 1 ? '' : 's'} left</div></div>
          <div class="tr-actions"><button class="btn btn-ghost sm" type="button" data-restore>Restore</button><button class="btn btn-danger-ghost sm" type="button" data-purge>Delete forever</button></div></li>`;
      }).join('')}</ul>` : '';
    $('#empty').hidden = !!tasks.length;
    if (!tasks.length) { $('#empty-title').textContent = VIEW_META.trash.empty[0]; $('#empty-sub').textContent = VIEW_META.trash.empty[1]; }
    renderReminders(counts); updateBulk();
    return;
  }

  // list
  const showHeads = (mode === 'headings' || mode === 'search') ? !(groups.length === 1 && groups[0].key === '') : (mode === 'dates' || mode === 'status');
  const draggable = mode === 'headings';
  listEl.classList.toggle('no-drag', !draggable);
  listEl.innerHTML = groups.map((g) => {
    const collapsed = showHeads && state.collapsed.has(g.key || '__general');
    const body = `<ul class="group-list" data-heading="${esc(g.heading ?? '')}">${g.tasks.map((t) => taskHTML(t, td)).join('')}</ul>`;
    if (!showHeads) return `<section class="group">${body}</section>`;
    return `<section class="group${collapsed ? ' collapsed' : ''}${g.tone ? ' tone-' + g.tone : ''}" data-key="${esc(g.key || '__general')}">
      <button class="group-head" type="button" aria-expanded="${!collapsed}">${icon('chevron')}<span>${esc(g.label)}</span><span class="count">${g.tasks.length}</span></button>${body}</section>`;
  }).join('');
  state.justAdded = null;
  hydratePhotos(listEl);

  const empty = !tasks.length;
  $('#empty').hidden = !empty;
  if (empty) {
    const [t, s] = state.search ? ['No matches', 'Try a different search term.'] : VIEW_META[state.view].empty;
    $('#empty-title').textContent = t; $('#empty-sub').textContent = s;
  }

  renderReminders(counts);
  updateBulk();
}

/* ---------- list interactions (event delegation) ---------- */
function onListClick(e) {
  const tg = e.target.closest('.chip.tag'); if (tg) { state.tag = state.tag === tg.dataset.tag ? '' : tg.dataset.tag; render(); return; }
  const trow = e.target.closest('.trash-row');
  if (trow) {
    const id = trow.dataset.id;
    if (e.target.closest('[data-restore]')) restoreTask(id);
    else if (e.target.closest('[data-purge]') && confirm('Delete this task forever? This cannot be undone.')) { purgeTask(id); toast('Deleted forever'); }
    return;
  }
  if (e.target.closest('[data-empty-trash]')) {
    if (state.trash.length && confirm(`Delete all ${state.trash.length} task${state.trash.length === 1 ? '' : 's'} in Trash forever? This cannot be undone.`)) {
      const n = state.trash.length; [...state.trash].forEach((t) => purgeTask(t.id, { silent: true })); render(); toast(`Trash emptied (${n})`);
    }
    return;
  }
  const thumb = e.target.closest('.t-photo');
  if (thumb) { const li = thumb.closest('.task'); const t = li && state.tasks.find((x) => x.id === li.dataset.id); if (t) { e.stopPropagation(); openViewer(t.photos, +thumb.dataset.i || 0); } return; }
  const stepPh = e.target.closest('.t-sub-photo');
  if (stepPh) { const li = stepPh.closest('.task'); const t = li && state.tasks.find((x) => x.id === li.dataset.id); const st = t?.subtasks.find((x) => x.id === stepPh.closest('.t-sub').dataset.sid); if (st) { e.stopPropagation(); openViewer(st.photos, 0); } return; }
  const stepRow = e.target.closest('.t-sub[data-sid]');
  if (stepRow) { // tick a checklist step without opening the task
    const li = stepRow.closest('.task'); const t = li && state.tasks.find((x) => x.id === li.dataset.id);
    if (t) { e.stopPropagation(); upsert({ ...t, subtasks: t.subtasks.map((x) => (x.id === stepRow.dataset.sid ? { ...x, done: !x.done } : x)) }); track('checklist-step'); }
    return;
  }
  const head = e.target.closest('.group-head');
  if (head) {
    const sec = head.parentElement; const key = sec.dataset.key;
    const c = sec.classList.toggle('collapsed');
    head.setAttribute('aria-expanded', String(!c));
    c ? state.collapsed.add(key) : state.collapsed.delete(key);
    lsSet(LS.collapsed, JSON.stringify([...state.collapsed]));
    return;
  }
  const li = e.target.closest('.task'); if (!li) return;
  if (Date.now() - swipedAt < 450) return; // the click that ends a swipe / long-press
  const id = li.dataset.id;
  if (e.target.closest('.sw-del')) { closeOpenRow(); return deleteWithUndo(id); }
  if (e.target.closest('.sw-snooze')) return snoozeTask(id);
  if (e.target.closest('.swipe-tray')) return;
  if (state.selecting) return toggleSel(id, li);
  if (li.classList.contains('open')) return closeOpenRow();
  if (e.target.closest('.check')) return toggleComplete(id);
  if (e.target.closest('.del')) return deleteWithUndo(id);
  if (e.target.closest('.grip')) return;
  openEditor(id);
}
listEl.addEventListener('click', onListClick);
listEl.addEventListener('keydown', (e) => {
  const li = e.target.closest('.task'); if (!li || e.target !== li) return;
  if (e.key === 'Enter') { e.preventDefault(); openEditor(li.dataset.id); }
  else if (e.key === ' ') { e.preventDefault(); toggleComplete(li.dataset.id); }
  else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); const n = li.nextElementSibling || li.previousElementSibling; deleteWithUndo(li.dataset.id); if (n) $(`.task[data-id="${CSS.escape(n.dataset.id)}"]`)?.focus(); }
});

/* ---------- drag to reorder (pointer based: mouse + touch) ---------- */
let dragState = null;
listEl.addEventListener('pointerdown', (e) => {
  const grip = e.target.closest('.grip');
  if (!grip || state.selecting || listEl.classList.contains('no-drag') || (e.pointerType === 'mouse' && e.button !== 0)) return;
  const li = grip.closest('.task');
  e.preventDefault();
  const r = li.getBoundingClientRect();
  const ph = document.createElement('li');
  ph.className = 'ph'; ph.style.height = r.height + 'px';
  ph.style.cssText += ';border:2px dashed var(--accent);border-radius:12px;background:var(--accent-soft);list-style:none';
  li.before(ph);
  li.classList.add('dragging');
  li.style.cssText = `position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;pointer-events:none;`;
  dragState = { li, ph, dy: e.clientY - r.top };
  document.addEventListener('pointermove', onDragMove);
  document.addEventListener('pointerup', onDragEnd);
  document.addEventListener('pointercancel', onDragEnd);
});
function onDragMove(e) {
  if (!dragState) return;
  const { li, ph, dy } = dragState;
  li.style.top = (e.clientY - dy) + 'px';
  const el = document.elementFromPoint(e.clientX, e.clientY);
  const over = el && el.closest('.task');
  if (over && over !== li && listEl.contains(over)) {
    const r = over.getBoundingClientRect();
    over.parentElement.insertBefore(ph, e.clientY > r.top + r.height / 2 ? over.nextElementSibling : over);
  } else if (el) {
    const gl = el.closest('.group-list');
    if (gl && !$('.task:not(.dragging)', gl)) gl.appendChild(ph);
  }
  if (e.clientY < 90) window.scrollBy(0, -14); else if (e.clientY > innerHeight - 90) window.scrollBy(0, 14);
}
function onDragEnd() {
  if (!dragState) return;
  const { li, ph } = dragState;
  document.removeEventListener('pointermove', onDragMove);
  document.removeEventListener('pointerup', onDragEnd);
  document.removeEventListener('pointercancel', onDragEnd);
  const sib = (el, dir) => { let n = el[dir]; while (n && (n === li || !n.classList.contains('task'))) n = n[dir]; return n; };
  const prev = sib(ph, 'previousElementSibling'), next = sib(ph, 'nextElementSibling');
  const heading = ph.parentElement.dataset.heading || '';
  ph.remove(); li.removeAttribute('style'); li.classList.remove('dragging');
  dragState = null;

  const task = state.tasks.find((t) => t.id === li.dataset.id);
  const ord = (el) => state.tasks.find((t) => t.id === el.dataset.id)?.order;
  if (task) {
    const a = prev ? ord(prev) : null, b = next ? ord(next) : null;
    let order = task.order;
    if (a !== null && b !== null) order = (a + b) / 2;
    else if (a !== null) order = a + 1;
    else if (b !== null) order = b - 1;
    if (order !== task.order || heading !== task.heading) {
      upsert({ ...task, order, heading });
      if (a !== null && b !== null && Math.abs(a - b) < 1e-6) renumber();
      return;
    }
  }
  render();
}
function renumber() {
  // Keep floats healthy after many reorders
  state.tasks.sort(byOrder).forEach((t, i) => { if (t.order !== i) upsert({ ...t, order: i }, { silent: true }); });
  render();
}

/* =====================================================
   NAVIGATION / SEARCH
   ===================================================== */
$$('[data-view]').forEach((b) => b.addEventListener('click', () => {
  state.selecting = false; state.sel.clear(); closeOpenRow();
  state.view = b.dataset.view; lsSet(LS.view, state.view);
  state.search = ''; $('#search').value = ''; $('#search-clear').hidden = true;
  render(); window.scrollTo({ top: 0 });
}));
const searchEl = $('#search');
searchEl.addEventListener('input', () => {
  state.search = searchEl.value;
  $('#search-clear').hidden = !state.search;
  render();
});
$('#search-clear').addEventListener('click', () => { searchEl.value = ''; state.search = ''; $('#search-clear').hidden = true; render(); searchEl.focus(); });

/* quick add — understands "tomorrow 5pm call mom", "every day 6am gym !high #health" */
let qaRaw = false; // "Keep as typed": skip smart parsing for the text currently in the box
const qaPreview = $('#q-preview');
const CHIP_ICON = { date: 'calendar', alarm: 'bell', repeat: 'repeat', priority: 'alert' };
function renderQuickPreview() {
  const text = $('#q-title').value.trim();
  const xt = text && !qaRaw ? extractTags(text) : { rest: text, tags: [] };
  const p = text && !qaRaw ? parseQuick(xt.rest) : null;
  if (qaRaw && text) {
    qaPreview.hidden = false;
    qaPreview.innerHTML = `<span class="qa-note">Keeping as typed</span><button type="button" class="qa-keep" data-qa="smart">Use smart parsing</button>`;
  } else if (p && (p.changed || xt.tags.length)) {
    qaPreview.hidden = false;
    qaPreview.innerHTML = xt.tags.map((g) => `<span class="qa-chip qa-tag">#${esc(g)}</span>`).join('') + (p.chips || []).map((c) => `<span class="qa-chip qa-${c.k}">${CHIP_ICON[c.k] ? icon(CHIP_ICON[c.k]) : ''}${esc(c.text)}</span>`).join('')
      + `<button type="button" class="qa-keep" data-qa="raw" title="Add the text exactly as typed">Keep as typed</button>`;
  } else { qaPreview.hidden = true; qaPreview.innerHTML = ''; }
}
qaPreview.addEventListener('click', (e) => {
  const b = e.target.closest('[data-qa]'); if (!b) return;
  qaRaw = b.dataset.qa === 'raw'; renderQuickPreview(); $('#q-title').focus();
});
const QA_DRAFT = 'tp-qa-draft';
$('#q-title').addEventListener('input', () => { if (!$('#q-title').value.trim()) qaRaw = false; renderQuickPreview(); lsSet(QA_DRAFT, $('#q-title').value); }); // saved on every keystroke
{ const d = lsGet(QA_DRAFT, ''); if (d) { $('#q-title').value = d; renderQuickPreview(); } }
const extractTags = (text) => {
  const tags = [];
  const rest = text.replace(/(^|\s)@([\p{L}\p{N}_-]{1,24})(?=\s|$)/gu, (m, sp, g) => { tags.push(g); return sp; }).replace(/\s{2,}/g, ' ').trim();
  return { rest: rest || text, tags: cleanTags(tags) };
};
const quickFields = (text0) => {
  const x = qaRaw ? { rest: text0, tags: [] } : extractTags(text0), text = x.rest;
  const p = qaRaw ? null : parseQuick(text);
  if (!p || !p.changed) return { title: text, date: state.view === 'today' ? todayStr() : '', ...(x.tags.length ? { tags: x.tags } : {}) };
  const f = { title: p.title, date: p.date || (state.view === 'today' ? todayStr() : '') };
  if (x.tags.length) f.tags = x.tags;
  if (p.alarm) { f.alarm = p.alarm; f.alarmRepeat = p.repeat; f.alarmFired = false; }
  if (p.priority) f.priority = p.priority;
  if (p.heading) f.heading = p.heading;
  return f;
};
const quickReset = () => { const input = $('#q-title'); input.value = ''; lsSet(QA_DRAFT, ''); qaRaw = false; renderQuickPreview(); input.focus(); };
$('#quick-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('#q-title'); const text = input.value.trim();
  if (!text) { input.focus(); return; }
  const f = quickFields(text);
  createTask(f);
  if (f.alarm) { ensureNotifyPermission(); toast(`Added · ${fmtDay(new Date(f.alarm))} ${fmtTime(new Date(f.alarm))} ⏰`); }
  quickReset();
});
$('#q-more').addEventListener('click', () => { const v = $('#q-title').value.trim(); const f = v ? quickFields(v) : {}; $('#q-title').value = ''; lsSet(QA_DRAFT, ''); qaRaw = false; renderQuickPreview(); openEditor(null, { ...f, title: f.title || v }); });

/* =====================================================
   EDITOR (create / edit)
   ===================================================== */
const editor = $('#editor');
const F = {
  title: $('#f-title'), notes: $('#f-notes'), date: $('#f-date'), heading: $('#f-heading'), tags: $('#f-tags'),
  aDate: $('#f-alarm-date'), aTime: $('#f-alarm-time'), repeat: $('#f-repeat'),
};
let editPriority = 'medium';
let editSubs = [];           // checklist of the task being edited
let editPhotos = [];         // photos of the task being edited
const openSteps = new Set(); // checklist steps whose photo panel is open
function renderSubs() {
  const done = editSubs.filter((x) => x.done).length;
  $('#subs-count').textContent = editSubs.length ? `${done}/${editSubs.length} done` : '';
  $('#subs-list').innerHTML = editSubs.map((x) => `<li data-sid="${esc(x.id)}" class="${x.done ? 'done' : ''}">
    <button type="button" class="sub-check" role="checkbox" aria-checked="${x.done}" aria-label="${x.done ? 'Mark step as not done' : 'Mark step as done'}">${icon('check')}</button>
    <input class="sub-text" type="text" value="${esc(x.text)}" maxlength="200" spellcheck="false" autocorrect="off" aria-label="Step" />
    <button type="button" class="icon-btn sm sub-photo${x.photos?.length ? ' has' : ''}" aria-label="Photos for this step" aria-expanded="${openSteps.has(x.id)}">${icon('image')}${x.photos?.length ? `<b>${x.photos.length}</b>` : ''}</button>
    <button type="button" class="icon-btn sm sub-del" aria-label="Remove step">${icon('x')}</button>
    ${openSteps.has(x.id) ? `<div class="step-photos" data-owner="${esc(x.id)}">${photoPanelHTML(x.photos || [], MAX_STEP_PHOTOS)}</div>` : ''}</li>`).join('');
  hydratePhotos($('#subs-list'));
}
function addSubs(text) {
  const lines = String(text).split(/\r?\n/).map((l) => l.replace(/^\s*(?:[-*\u2022]|\d+[.)])\s*/, '').trim()).filter(Bool);
  if (!lines.length) return;
  lines.forEach((l) => { if (editSubs.length < MAX_SUBS) editSubs.push({ id: newId().slice(0, 12), text: l.slice(0, 200), done: false }); });
  renderSubs(); autoSchedule();
}
const Bool = Boolean;
function setPriority(p) {
  editPriority = p;
  $$('#f-priority button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.priority === p)));
}
$$('#f-priority button').forEach((b) => b.addEventListener('click', () => setPriority(b.dataset.priority)));

function openEditor(id, preset = {}) {
  state.editingId = id;
  const t = id ? state.tasks.find((x) => x.id === id) : null;
  if (id && !t) return;
  const v = t || { title: '', notes: '', date: '', heading: '', priority: 'medium', alarm: null, alarmRepeat: 'none', ...preset };

  autoReset();
  $('#editor-title').textContent = t ? 'Edit task' : 'New task';
  $('#f-delete').hidden = !t;
  F.title.value = v.title; F.notes.value = v.notes; F.date.value = v.date; F.heading.value = v.heading; F.tags.value = (v.tags || []).join(', ');
  setPriority(v.priority);
  if (v.alarm) { const d = new Date(v.alarm); F.aDate.value = ymd(d); F.aTime.value = hm(d); } else { F.aDate.value = ''; F.aTime.value = ''; }
  F.repeat.value = v.alarmRepeat || 'none';
  editPhotos = cleanPhotos(v.photos, MAX_PHOTOS); openSteps.clear();
  editSubs = cleanSubs(v.subtasks); renderSubs(); renderTaskPhotos(); $('#subs-new').value = '';
  $('#headings-list').innerHTML = [...new Set(state.tasks.map((x) => x.heading).filter(Boolean))].map((h) => `<option value="${esc(h)}">`).join('');

  if (!editor.open) editor.showModal();
  if (!t && matchMedia('(pointer: fine)').matches) F.title.focus();
}
const closeDialog = (d) => d.open && d.close();
$$('[data-close]').forEach((b) => b.addEventListener('click', () => closeDialog(b.closest('dialog'))));
$$('dialog.sheet').forEach((d) => d.addEventListener('click', (e) => { if (e.target === d) d.close(); })); // backdrop click

$$('#editor [data-date]').forEach((b) => b.addEventListener('click', () => { F.date.value = shiftDay(Number(b.dataset.date)); }));
$$('#editor [data-alarm]').forEach((b) => b.addEventListener('click', () => {
  const k = b.dataset.alarm; let d = new Date();
  if (k === 'clear') { F.aDate.value = ''; F.aTime.value = ''; F.repeat.value = 'none'; return; }
  if (k === 'h1') d = new Date(Date.now() + 3600e3);
  if (k === 'eve') { d.setHours(18, 0, 0, 0); if (d <= new Date()) d.setDate(d.getDate() + 1); }
  if (k === 'tom') { d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); }
  F.aDate.value = ymd(d); F.aTime.value = hm(d);
}));


/* ---------- autosave: every change in the editor is stored right away (on this device, and in the cloud when online) ---------- */
let autoTimer = null, autoDirty = false;
function autoStatus(kind) {
  const el = $('#autosave-state'); if (!el) return;
  const offline = !navigator.onLine;
  el.dataset.s = kind;
  const next = kind === 'saving' ? 'Saving…'
    : kind === 'saved' ? (!cloudOn() ? 'Saved on this device' : offline ? 'Saved on this device · will sync when online' : 'All changes saved')
    : kind === 'idle' ? 'Changes save automatically' : '';
  if (el.textContent !== next) el.textContent = next; // untouched DOM while typing keeps the mobile keyboard steady
}
function autoReset() { clearTimeout(autoTimer); autoTimer = null; autoDirty = false; autoStatus('idle'); }
function readForm() {
  let aDate = F.aDate.value, aTime = F.aTime.value;
  if (aDate && !aTime) aTime = '09:00';
  if (aTime && !aDate) aDate = todayStr();
  const alarm = aDate && aTime ? new Date(`${aDate}T${aTime}`).toISOString() : null;
  return {
    title: F.title.value.trim(), notes: F.notes.value.trim(), date: F.date.value, heading: F.heading.value.trim(), tags: cleanTags(F.tags.value),
    priority: editPriority, alarm, alarmRepeat: alarm ? F.repeat.value : 'none', subtasks: cleanSubs(editSubs), photos: cleanPhotos(editPhotos, MAX_PHOTOS),
  };
}
function autoSave() {
  clearTimeout(autoTimer); autoTimer = null;
  if (!autoDirty) return;
  autoDirty = false;
  const f = readForm();
  const existing = state.editingId ? state.tasks.find((x) => x.id === state.editingId) : null;
  if (state.editingId && !existing) { autoStatus('idle'); return; } // task was deleted while the editor was open
  if (!existing && !f.title && !f.notes && !f.subtasks.length && !f.photos.length) { autoStatus('idle'); return; } // nothing to save yet
  if (!f.title) f.title = 'Untitled task';
  // an alarm in the past would ring immediately, so it is only stored when you press Done
  const alarmOk = !f.alarm || new Date(f.alarm).getTime() > Date.now() || (existing && existing.alarm === f.alarm);
  if (!alarmOk) { f.alarm = existing ? existing.alarm : null; f.alarmRepeat = existing ? existing.alarmRepeat : 'none'; }
  if (existing) {
    const changed = existing.alarm !== f.alarm;
    upsert({ ...existing, ...f, alarmFired: changed ? false : existing.alarmFired }, { silent: true });
  } else {
    const t = normalize({ ...f, id: newId(), order: topOrder(), createdAt: new Date().toISOString(), alarmFired: false });
    upsert(t, { silent: true });
    state.editingId = t.id;
    $('#editor-title').textContent = 'Edit task'; $('#f-delete').hidden = false;
  }
  autoStatus('saved');
}
function autoSchedule() { autoDirty = true; autoStatus('saving'); clearTimeout(autoTimer); autoTimer = setTimeout(autoSave, 350); }
['input', 'change'].forEach((ev) => $('#editor-form').addEventListener(ev, autoSchedule));

/* resizable notes box: the drag handle sits under the box, centred */
(() => {
  const ta = $('#f-notes'), grip = $('#notes-grip'); if (!ta || !grip) return;
  const MIN = 150, max = () => Math.round(innerHeight * 0.7);
  const setH = (h) => { ta.style.height = Math.max(MIN, Math.min(max(), Math.round(h))) + 'px'; };
  let startY = 0, startH = 0, drag = false;
  grip.addEventListener('pointerdown', (e) => { drag = true; startY = e.clientY; startH = ta.offsetHeight; grip.setPointerCapture(e.pointerId); e.preventDefault(); });
  grip.addEventListener('pointermove', (e) => { if (drag) setH(startH + e.clientY - startY); });
  const stop = () => { drag = false; };
  grip.addEventListener('pointerup', stop); grip.addEventListener('pointercancel', stop);
  grip.addEventListener('keydown', (e) => { // keyboard: arrow keys resize, Home resets
    if (e.key === 'ArrowDown') { e.preventDefault(); setH(ta.offsetHeight + 24); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setH(ta.offsetHeight - 24); }
    else if (e.key === 'Home') { e.preventDefault(); ta.style.height = ''; }
  });
  grip.addEventListener('dblclick', () => { ta.style.height = ''; });
})();
/* checklist editing */
$('#subs-list').addEventListener('click', (e) => {
  const li = e.target.closest('li[data-sid]'); if (!li) return;
  const i = editSubs.findIndex((x) => x.id === li.dataset.sid); if (i < 0) return;
  if (e.target.closest('.sub-check')) { editSubs[i].done = !editSubs[i].done; renderSubs(); autoSchedule(); }
  else if (e.target.closest('.sub-del')) { editSubs.splice(i, 1); renderSubs(); autoSchedule(); }
});
$('#subs-list').addEventListener('input', (e) => {
  const li = e.target.closest('li[data-sid]'); const x = li && editSubs.find((y) => y.id === li.dataset.sid);
  if (x && e.target.classList.contains('sub-text')) x.text = e.target.value;
});
$('#subs-list').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#subs-new').focus(); } });
$('#subs-new').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addSubs(e.target.value); e.target.value = ''; } });
$('#subs-new').addEventListener('paste', (e) => {
  const t = (e.clipboardData || window.clipboardData)?.getData('text') || '';
  if (/\r?\n/.test(t.trim())) { e.preventDefault(); addSubs(t); } // pasting a list makes one step per line
});
$('#subs-add').addEventListener('click', () => { const i = $('#subs-new'); addSubs(i.value); i.value = ''; i.focus(); });
$('#editor-form').addEventListener('click', (e) => { if (e.target.closest('[data-date], [data-alarm], #f-priority button')) setTimeout(autoSchedule, 0); });
editor.addEventListener('close', () => { autoSave(); render(); });
window.addEventListener('pagehide', autoSave);
document.addEventListener('visibilitychange', () => { if (document.hidden) autoSave(); });
window.addEventListener('online', () => autoStatus('saved'));

$('#editor-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const title = F.title.value.trim();
  clearTimeout(autoTimer); autoDirty = false;
  if (!title) { if (state.editingId || F.notes.value.trim()) { F.title.value = 'Untitled task'; return $('#editor-form').requestSubmit(); } F.title.focus(); toast('Enter a task title'); return; }

  let aDate = F.aDate.value, aTime = F.aTime.value;
  if (aDate && !aTime) aTime = '09:00';
  if (aTime && !aDate) aDate = todayStr();
  const alarm = aDate && aTime ? new Date(`${aDate}T${aTime}`).toISOString() : null;
  const repeat = alarm ? F.repeat.value : 'none';
  const base = {
    title, notes: F.notes.value.trim(), date: F.date.value, heading: F.heading.value.trim(), tags: cleanTags(F.tags.value),
    priority: editPriority, alarm, alarmRepeat: repeat, subtasks: cleanSubs(editSubs), photos: cleanPhotos(editPhotos, MAX_PHOTOS),
  };

  if (state.editingId) {
    const t = state.tasks.find((x) => x.id === state.editingId);
    if (t) {
      const changed = t.alarm !== alarm;
      upsert({ ...t, ...base, alarmFired: changed ? false : t.alarmFired });
      toast('Saved');
    }
  } else {
    createTask({ ...base, alarmFired: false });
    toast(alarm ? 'Task added with reminder' : 'Task added');
  }
  if (alarm) ensureNotifyPermission();
  editor.close();
});
$('#f-delete').addEventListener('click', () => { const id = state.editingId; clearTimeout(autoTimer); autoTimer = null; autoDirty = false; editor.close(); if (id) deleteWithUndo(id); });
editor.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') $('#editor-form').requestSubmit(); });

['#btn-new-side', '#fab'].forEach((s) => $(s).addEventListener('click', () => openEditor(null)));

/* =====================================================
   PHOTOS — camera, gallery, pasted screenshots; caption on every picture
   Pictures are shrunk on this device, kept in IndexedDB and synced to your account (photos.js).
   ===================================================== */
function photoPanelHTML(arr, max) {
  return `<div class="ph-tools">
      <button type="button" class="btn btn-ghost sm ph-cam">${icon('camera')} Take photo</button>
      <button type="button" class="btn btn-ghost sm ph-gal">${icon('image')} Add photos</button>
      <span class="ph-count">${arr.length}/${max}</span>
    </div>${arr.length ? `<ul class="ph-grid">${arr.map((p, i) => `<li data-pid="${esc(p.id)}">
      <button type="button" class="ph-open" data-i="${i}" aria-label="View photo ${i + 1}"><img data-pid="${esc(p.id)}" alt=""></button>
      <button type="button" class="icon-btn sm ph-del" aria-label="Remove photo">${icon('x')}</button>
      <input class="ph-cap" type="text" maxlength="200" value="${esc(p.cap)}" placeholder="Add a description" spellcheck="false" autocorrect="off" aria-label="Photo description" />
    </li>`).join('')}</ul>` : ''}`;
}
function hydratePhotos(root) {
  root.querySelectorAll('img[data-pid]:not([src])').forEach(async (img) => {
    const d = await ph.photoURL(img.dataset.pid);
    if (d) img.src = d; else img.classList.add('missing');
  });
}
function renderTaskPhotos() {
  $('#task-photos').innerHTML = photoPanelHTML(editPhotos, MAX_PHOTOS);
  hydratePhotos($('#task-photos'));
}
const ownerList = (owner) => {
  if (owner === 'task') return editPhotos;
  const st = editSubs.find((x) => x.id === owner); if (!st) return null;
  return (st.photos = st.photos || []);
};
let photoOwner = 'task';
async function addFiles(files, owner = 'task') {
  const list = [...files].filter((f) => /^image\//.test(f.type || ''));
  if (!list.length) return;
  const arr = ownerList(owner); if (!arr) return;
  const max = owner === 'task' ? MAX_PHOTOS : MAX_STEP_PHOTOS;
  let added = 0, failed = 0;
  for (const f of list) {
    if (arr.length >= max) { toast(`You can add up to ${max} photos here`); break; }
    try {
      const rec = await ph.compress(f);
      const id = 'p' + newId().replace(/[^A-Za-z0-9]/g, '').slice(0, 20);
      await ph.savePhoto(id, rec);
      arr.push({ id, cap: '' }); added++;
    } catch { failed++; }
  }
  if (owner === 'task') renderTaskPhotos(); else { openSteps.add(owner); renderSubs(); }
  if (added) { autoSchedule(); track('photo-added'); toast(added === 1 ? 'Photo added' : `${added} photos added`); }
  if (failed) toast(failed === 1 ? 'One file could not be added' : `${failed} files could not be added`);
}
const camInput = $('#ph-cam-input'), galInput = $('#ph-gal-input');
camInput.addEventListener('change', () => { const f = [...camInput.files]; camInput.value = ''; addFiles(f, photoOwner); });
galInput.addEventListener('change', () => { const f = [...galInput.files]; galInput.value = ''; addFiles(f, photoOwner); });

/* Take photo: phones open the camera app; laptops open a live webcam preview. */
const camDlg = $('#cam-dialog'), camVideo = $('#cam-video');
let camStream = null, camOwner = 'task';
function stopCam() { if (camStream) camStream.getTracks().forEach((t) => t.stop()); camStream = null; camVideo.srcObject = null; }
async function takePhoto(owner) {
  const phone = matchMedia('(pointer: coarse)').matches;
  if (phone || !navigator.mediaDevices?.getUserMedia) { camInput.click(); return; }
  camOwner = owner;
  try {
    camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 } }, audio: false });
    camVideo.srcObject = camStream; await camVideo.play().catch(() => {});
    if (!camDlg.open) camDlg.showModal();
  } catch (e) {
    stopCam();
    toast(e?.name === 'NotAllowedError' ? 'Camera is blocked. Allow camera access in the browser address bar.' : 'No camera found on this device.');
  }
}
$('#cam-shot').addEventListener('click', () => {
  if (!camVideo.videoWidth) return;
  const c = document.createElement('canvas'); c.width = camVideo.videoWidth; c.height = camVideo.videoHeight;
  c.getContext('2d').drawImage(camVideo, 0, 0);
  c.toBlob((b) => { if (b) addFiles([new File([b], 'camera.jpg', { type: 'image/jpeg' })], camOwner); }, 'image/jpeg', 0.92);
  camDlg.close();
});
$('#cam-cancel').addEventListener('click', () => camDlg.close());
camDlg.addEventListener('close', stopCam);
editor.addEventListener('click', (e) => {
  const own = e.target.closest('[data-owner]')?.dataset.owner;
  if (e.target.closest('.ph-cam')) { photoOwner = own || 'task'; takePhoto(photoOwner); return; }
  if (e.target.closest('.ph-gal')) { photoOwner = own || 'task'; galInput.click(); return; }
  if (e.target.closest('.sub-photo')) {
    const id = e.target.closest('li[data-sid]').dataset.sid;
    if (openSteps.has(id)) openSteps.delete(id); else openSteps.add(id);
    renderSubs(); return;
  }
  const li = e.target.closest('.ph-grid li'); if (!li || !own) return;
  const arr = ownerList(own); const i = arr ? arr.findIndex((p) => p.id === li.dataset.pid) : -1; if (i < 0) return;
  if (e.target.closest('.ph-del')) {
    const [gone] = arr.splice(i, 1); ph.removePhoto(gone.id);
    if (own === 'task') renderTaskPhotos(); else renderSubs();
    autoSchedule();
  } else if (e.target.closest('.ph-open')) openViewer(arr, i);
});
editor.addEventListener('input', (e) => {
  if (!e.target.classList.contains('ph-cap')) return;
  const own = e.target.closest('[data-owner]')?.dataset.owner; const arr = own && ownerList(own);
  const p = arr && arr.find((x) => x.id === e.target.closest('li').dataset.pid); if (p) p.cap = e.target.value.slice(0, 200);
});
editor.addEventListener('paste', (e) => { // paste a screenshot with Ctrl+V
  const files = [...(e.clipboardData?.files || [])].filter((f) => /^image\//.test(f.type));
  if (files.length) { e.preventDefault(); addFiles(files, 'task'); }
});
const phField = $('#photos-field');
['dragover', 'dragenter'].forEach((ev) => phField.addEventListener(ev, (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); phField.classList.add('drop'); } }));
['dragleave', 'drop'].forEach((ev) => phField.addEventListener(ev, () => phField.classList.remove('drop')));
phField.addEventListener('drop', (e) => { if (e.dataTransfer?.files?.length) { e.preventDefault(); addFiles(e.dataTransfer.files, 'task'); } });

/* full-screen photo viewer */
const viewer = $('#viewer');
let vList = [], vI = 0;
async function showViewer() {
  const p = vList[vI]; if (!p) return;
  const img = $('#viewer-img'); img.removeAttribute('src'); img.alt = p.cap || 'Photo';
  $('#viewer-cap').textContent = p.cap || '';
  $('#viewer-cap').hidden = !p.cap;
  $('#viewer-count').textContent = vList.length > 1 ? `${vI + 1} / ${vList.length}` : '';
  $('#viewer-prev').hidden = $('#viewer-next').hidden = vList.length < 2;
  const d = await ph.photoURL(p.id);
  if (vList[vI] === p) {
    if (d) img.src = d;
    else { $('#viewer-cap').textContent = 'This photo is not available on this device. Open it once on the device that took it while online, and make sure the latest Firestore rules are published.'; $('#viewer-cap').hidden = false; }
  }
}
function openViewer(list, i = 0) {
  if (!list?.length) return;
  vList = list.slice(); vI = Math.min(Math.max(0, i), vList.length - 1); showViewer(); track('photo-viewed');
  if (!viewer.open) viewer.showModal();
}
const vStep = (n) => { if (vList.length < 2) return; vI = (vI + n + vList.length) % vList.length; showViewer(); };
$('#viewer-prev').addEventListener('click', () => vStep(-1));
$('#viewer-next').addEventListener('click', () => vStep(1));
$('#viewer-close').addEventListener('click', () => viewer.close());
viewer.addEventListener('click', (e) => { if (e.target === viewer || e.target.closest('figure') === null && !e.target.closest('button')) viewer.close(); });
viewer.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft') vStep(-1); else if (e.key === 'ArrowRight') vStep(1); });
let vX = null;
viewer.addEventListener('touchstart', (e) => { vX = e.touches[0].clientX; }, { passive: true });
viewer.addEventListener('touchend', (e) => { if (vX == null) return; const dx = e.changedTouches[0].clientX - vX; vX = null; if (Math.abs(dx) > 50) vStep(dx < 0 ? 1 : -1); }, { passive: true });

/* =====================================================
   REMINDERS PANEL
   ===================================================== */
const remDialog = $('#reminders');
function renderReminders() {
  const up = state.tasks.filter((t) => t.alarm && !t.completed).sort((a, b) => new Date(a.alarm) - new Date(b.alarm));
  $('#rem-list').innerHTML = up.length ? up.map((t) => `
    <li class="rem-item" data-id="${esc(t.id)}">
      ${icon('bell').replace('class="i"', 'class="i b"')}
      <div><strong>${esc(t.title)}</strong><small>${esc(whenLabel(t.alarm))}${t.alarmRepeat !== 'none' ? ` · repeats ${t.alarmRepeat}` : ''}</small></div>
      <button class="icon-btn sm del" type="button" aria-label="Remove reminder">${icon('x')}</button>
    </li>`).join('') : '<li class="rem-empty">No reminders yet.<br/>Add one from a task’s details.</li>';
}
$('#rem-list').addEventListener('click', (e) => {
  const li = e.target.closest('.rem-item'); if (!li) return;
  const t = state.tasks.find((x) => x.id === li.dataset.id); if (!t) return;
  if (e.target.closest('.del')) { upsert({ ...t, alarm: null, alarmRepeat: 'none', alarmFired: false }); toast('Reminder removed'); return; }
  remDialog.close(); openEditor(t.id);
});
['#btn-reminders-side', '#btn-reminders-top'].forEach((s) => $(s).addEventListener('click', () => remDialog.showModal()));

/* =====================================================
   SWIPE (touch) · LONG-PRESS SELECT · BULK ACTIONS
   ===================================================== */
const SWIPE = { open: 148, act: 84 };
let swipe = null;       // active touch gesture
let swipedAt = 0;       // timestamp of the last swipe / long-press (suppresses the trailing click)
let openRow = null;     // row left open showing Snooze / Delete
const haptic = () => { try { if (navigator.vibrate && navigator.userActivation?.hasBeenActive) navigator.vibrate(12); } catch { /* ignore */ } };

function rowReset(li) {
  li.classList.remove('swiping', 'open'); li.classList.add('snap');
  li.style.removeProperty('--sx');
  setTimeout(() => li.classList.remove('snap'), 260);
}
function closeOpenRow() { if (openRow) { rowReset(openRow); openRow = null; } }

function attachSwipe(container) {
  container.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch' || state.selecting) return;
    const li = e.target.closest('.task');
    if (!li || e.target.closest('.grip, .swipe-tray')) return;
    if (openRow && openRow !== li) closeOpenRow();
    swipe = {
      li, id: li.dataset.id, x0: e.clientX, y0: e.clientY, x: 0, locked: false, pid: e.pointerId,
      base: li.classList.contains('open') ? -SWIPE.open : 0, w: li.offsetWidth,
      timer: setTimeout(() => {          // long-press → bulk select
        if (!swipe || swipe.locked) return;
        const id = swipe.id; swipe = null; swipedAt = Date.now(); haptic(); setSelecting(true, id);
      }, 520),
    };
  });
}
document.addEventListener('pointermove', (e) => {
  if (!swipe || e.pointerId !== swipe.pid) return;
  const dx = e.clientX - swipe.x0, dy = e.clientY - swipe.y0;
  if (Math.hypot(dx, dy) > 8) clearTimeout(swipe.timer);
  if (!swipe.locked) {
    if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy) * 1.2) return; // vertical scroll wins
    swipe.locked = true; swipe.li.classList.remove('snap'); swipe.li.classList.add('swiping');
  }
  swipe.x = Math.max(-swipe.w, Math.min(swipe.w * 0.9, swipe.base + dx));
  swipe.li.style.setProperty('--sx', swipe.x + 'px');
});
function endSwipe(e) {
  if (!swipe || e.pointerId !== swipe.pid) return;
  clearTimeout(swipe.timer);
  const s = swipe; swipe = null;
  if (!s.locked) return;
  swipedAt = Date.now();
  const { li, x, w } = s;
  if (e.type === 'pointercancel') { rowReset(li); }
  else if (x > SWIPE.act) { haptic(); rowReset(li); toggleComplete(s.id); }
  else if (x < -w * 0.6) { haptic(); rowReset(li); deleteWithUndo(s.id); }
  else if (x < -SWIPE.act) {
    li.classList.remove('swiping'); li.classList.add('open', 'snap'); li.style.setProperty('--sx', -SWIPE.open + 'px');
    openRow = li; setTimeout(() => li.classList.remove('snap'), 260);
  } else { rowReset(li); if (openRow === li) openRow = null; }
  if (renderPending) render();
}
document.addEventListener('pointerup', endSwipe);
document.addEventListener('pointercancel', endSwipe);
document.addEventListener('pointerdown', (e) => { if (openRow && !e.target.closest('.task.open')) closeOpenRow(); }, true);
['contextmenu'].forEach((t) => listEl.addEventListener(t, (e) => { if (e.target.closest('.task') && matchMedia('(pointer: coarse)').matches) e.preventDefault(); }));

/* moving / snoozing */
function shiftToTomorrow(t) {
  const n = { ...t, date: shiftDay(1) };
  if (t.alarm && !t.completed) {
    const d = new Date(t.alarm), tm = new Date(); tm.setDate(tm.getDate() + 1);
    d.setFullYear(tm.getFullYear(), tm.getMonth(), tm.getDate());
    n.alarm = d.toISOString(); n.alarmFired = false;
  }
  return n;
}
function snoozeTask(id) {
  const t = state.tasks.find((x) => x.id === id); if (!t) return;
  const was = { ...t }; let n, msg;
  if (t.alarm && !t.completed) {
    const base = Math.max(Date.now(), new Date(t.alarm).getTime());
    n = { ...t, alarm: new Date(base + 3600e3).toISOString(), alarmFired: false }; msg = 'Reminder pushed by 1 hour';
  } else { n = shiftToTomorrow(t); msg = 'Moved to tomorrow'; }
  closeOpenRow(); upsert(n);
  toast(msg, { action: { label: 'Undo', fn: () => upsert(was) } });
}

/* bulk select */
function setSelecting(on, id) {
  state.selecting = on; state.sel = new Set(on && id ? [id] : []);
  closeOpenRow(); render();
}
function toggleSel(id, li) {
  state.sel.has(id) ? state.sel.delete(id) : state.sel.add(id);
  li?.classList.toggle('selected', state.sel.has(id));
  updateBulk();
}
function updateBulk() {
  $('#bulkbar').hidden = !state.selecting;
  document.body.classList.toggle('bulk-on', state.selecting);
  $('#btn-select span').textContent = state.selecting ? 'Cancel' : 'Select';
  const n = state.sel.size;
  $('#bulk-count').textContent = `${n} selected`;
  $$('#bulk-done, #bulk-tomorrow, #bulk-del, #bulk-share, #bulk-dl').forEach((b) => { b.disabled = !n; });
  $('#bulk-done span').textContent = state.view === 'done' ? 'Reopen' : 'Done';
}
const selTasks = () => state.tasks.filter((t) => state.sel.has(t.id));
$('#btn-select').addEventListener('click', () => setSelecting(!state.selecting));
$('#bulk-cancel').addEventListener('click', () => setSelecting(false));
$('#bulk-all').addEventListener('click', () => {
  const ids = $$('.content .task').map((li) => li.dataset.id);
  const all = ids.length && ids.every((id) => state.sel.has(id));
  state.sel = new Set(all ? [] : ids);
  $$('.content .task').forEach((li) => li.classList.toggle('selected', state.sel.has(li.dataset.id)));
  updateBulk();
});
function bulkApply(label, fn) {
  const list = selTasks(); if (!list.length) return;
  const before = list.map((t) => ({ ...t }));
  list.forEach((t) => fn(t));
  setSelecting(false);
  const n = before.length;
  toast(`${n} task${n === 1 ? '' : 's'} ${label}`, { duration: label === 'moved to Trash' ? UNDO_MS : undefined, action: { label: 'Undo', fn: () => { before.forEach((t) => upsert(t, { silent: true })); render(); } } });
}
$('#bulk-done').addEventListener('click', () => {
  const reopen = state.view === 'done';
  bulkApply(reopen ? 'reopened' : 'completed', (t) => upsert(reopen ? { ...t, completed: false, completedAt: null } : finishTask(t), { silent: true }));
});
$('#bulk-tomorrow').addEventListener('click', () => bulkApply('moved to tomorrow', (t) => upsert(shiftToTomorrow(t), { silent: true })));
$('#bulk-del').addEventListener('click', () => bulkApply('moved to Trash', (t) => removeTask(t.id, { silent: true })));

attachSwipe(listEl);

/* =====================================================
   CALENDAR (month + week)
   ===================================================== */
const WEEK_START = 0; // 0 = Sunday … 6 = Saturday
const calEl = $('#calendar');
const dayOf = (t) => t.date || (t.alarm ? ymd(new Date(t.alarm)) : '');
const startOfWeek = (d) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() - WEEK_START + 7) % 7)); return x; };
const addDays = (d, n) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; };
const fromYmd = (s) => new Date(s + 'T00:00:00');
function calSub() {
  const c = state.cal;
  if (c.mode === 'month') return c.cursor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const a = startOfWeek(c.cursor), b = addDays(a, 6), o = { month: 'short', day: 'numeric' };
  return `${a.toLocaleDateString('en-US', o)} – ${b.toLocaleDateString('en-US', o)}, ${b.getFullYear()}`;
}
function dayTasks(map, day) {
  return (map.get(day) || []).slice().sort((a, b) => (a.completed - b.completed) || byOrder(a, b));
}
function dayBlock(map, day, td) {
  const list = dayTasks(map, day);
  const d = fromYmd(day);
  const full = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const label = day === td ? `Today · ${full}` : full;
  return `<div class="cal-daylist">
    <div class="cal-dayhead"><strong>${esc(label)}</strong><span class="count">${list.length}</span><span class="spacer"></span>
      <button class="btn btn-ghost sm" type="button" data-cal-add="${day}">${icon('plus')} Add</button></div>
    ${list.length ? `<ul class="group-list">${list.map((t) => taskHTML(t, td)).join('')}</ul>` : '<p class="muted cal-empty">No tasks on this day.</p>'}
  </div>`;
}
function renderCalendar() {
  const c = state.cal, td = todayStr();
  if (!c.day) c.day = td;
  const map = new Map();
  state.tasks.forEach((t) => { const d = dayOf(t); if (d) { if (!map.has(d)) map.set(d, []); map.get(d).push(t); } });
  const undated = state.tasks.filter((t) => !dayOf(t) && !t.completed).length;

  const head = `<div class="cal-head">
    <div class="seg" role="radiogroup" aria-label="Calendar mode">
      <button type="button" role="radio" data-cal-mode="month" aria-checked="${c.mode === 'month'}">Month</button>
      <button type="button" role="radio" data-cal-mode="week" aria-checked="${c.mode === 'week'}">Week</button>
    </div>
    <span class="spacer"></span>
    <button class="icon-btn" type="button" data-cal-nav="-1" aria-label="Previous">${icon('chevl')}</button>
    <button class="btn btn-ghost sm" type="button" data-cal-nav="0">Today</button>
    <button class="icon-btn" type="button" data-cal-nav="1" aria-label="Next">${icon('chevr')}</button>
  </div>`;

  let body;
  if (c.mode === 'week') {
    const a = startOfWeek(c.cursor);
    body = `<div class="cal-week">${Array.from({ length: 7 }, (_, i) => dayBlock(map, ymd(addDays(a, i)), td)).join('')}</div>`;
  } else {
    const first = new Date(c.cursor.getFullYear(), c.cursor.getMonth(), 1);
    const gs = startOfWeek(first);
    const names = Array.from({ length: 7 }, (_, i) => `<span>${addDays(gs, i).toLocaleDateString('en-US', { weekday: 'short' })}</span>`).join('');
    const cells = Array.from({ length: 42 }, (_, i) => {
      const d = addDays(gs, i), key = ymd(d), list = map.get(key) || [];
      const pend = list.filter((t) => !t.completed);
      const dots = pend.slice(0, 3).map((t) => `<i class="dot ${t.priority}"></i>`).join('') || (list.length ? '<i class="dot done"></i>' : '');
      const more = pend.length > 3 ? `<em>+${pend.length - 3}</em>` : '';
      const cls = ['cal-day', d.getMonth() !== first.getMonth() ? 'out' : '', key === td ? 'today' : '', key === c.day ? 'sel' : ''].filter(Boolean).join(' ');
      return `<button type="button" class="${cls}" data-day="${key}" aria-label="${esc(d.toDateString())}, ${pend.length} pending"><span class="n">${d.getDate()}</span><span class="dots">${dots}${more}</span></button>`;
    }).join('');
    body = `<div class="cal-grid"><div class="cal-names">${names}</div><div class="cal-cells">${cells}</div></div>${dayBlock(map, c.day, td)}`;
  }
  calEl.innerHTML = head + body + (undated ? `<p class="muted cal-note">${undated} task${undated === 1 ? ' has' : 's have'} no date or reminder, so ${undated === 1 ? 'it isn’t' : 'they aren’t'} shown here.</p>` : '');
}
calEl.addEventListener('click', (e) => {
  const c = state.cal;
  const mode = e.target.closest('[data-cal-mode]');
  if (mode) { c.mode = mode.dataset.calMode; lsSet(LS.calMode, c.mode); return render(); }
  const nav = e.target.closest('[data-cal-nav]');
  if (nav) {
    const n = Number(nav.dataset.calNav), td = new Date();
    if (n === 0) { c.cursor = td; c.day = todayStr(); }
    else if (c.mode === 'week') { c.cursor = addDays(c.cursor, 7 * n); }
    else {
      c.cursor = new Date(c.cursor.getFullYear(), c.cursor.getMonth() + n, 1);
      c.day = c.cursor.getMonth() === td.getMonth() && c.cursor.getFullYear() === td.getFullYear() ? todayStr() : ymd(c.cursor);
    }
    return render();
  }
  const add = e.target.closest('[data-cal-add]');
  if (add) return openEditor(null, { date: add.dataset.calAdd });
  const day = e.target.closest('.cal-day');
  if (day) {
    c.day = day.dataset.day;
    const d = fromYmd(c.day);
    if (day.classList.contains('out')) c.cursor = new Date(d.getFullYear(), d.getMonth(), 1);
    return render();
  }
  onListClick(e);
});
attachSwipe(calEl);

/* =====================================================
   ALARM ENGINE
   ===================================================== */
const alarmQueue = [];
let activeAlarm = null;
const popup = $('#alarm-popup');

/* Alarm engine
   - Local-only mode: the app rings and settles the task itself (as before).
   - Cloud + push mode: the app only RINGS locally. The Cloudflare worker pushes to every device and
     marks the task fired / advances the repeat, so a device that is open can no longer cancel the
     push meant for your other devices. If the worker has not settled the task within GRACE, the app
     settles it itself as a fallback. */
const GRACE = 3 * 60e3;
const RUNG_KEY = 'tp-rung';
const rung = new Set(); // `${taskId}|${alarmISO}` already shown on this device (dedupes push vs in-app)
const pushMode = () => cloudOn() && !!window.FIREBASE_VAPID_KEY;
function wasRung(key) {
  if (rung.has(key)) return true;
  try { return !!JSON.parse(lsGet(RUNG_KEY, '{}'))[key]; } catch { return false; }
}
function markRung(key) {
  rung.add(key);
  try {
    const m = JSON.parse(lsGet(RUNG_KEY, '{}')); const cut = Date.now() - 2 * 864e5;
    for (const k of Object.keys(m)) if (m[k] < cut) delete m[k];
    m[key] = Date.now(); lsSet(RUNG_KEY, JSON.stringify(m));
  } catch { /* ignore */ }
}
const isDue = (t, now) => t.alarm && !t.completed && !t.alarmFired && new Date(t.alarm).getTime() <= now;
function checkAlarms() {
  const now = Date.now();
  state.tasks.filter((t) => isDue(t, now)).forEach((t) => {
    if (!pushMode()) return fireAlarm(t);
    const key = `${t.id}|${t.alarm}`;
    if (!wasRung(key)) ringAlarm(t);
    if (now - new Date(t.alarm).getTime() > GRACE) settleAlarm(t);
  });
}
function settleAlarm(task) {
  const next = { ...task };
  if (task.alarmRepeat === 'daily' || task.alarmRepeat === 'weekly') {
    const step = task.alarmRepeat === 'daily' ? 1 : 7;
    const d = new Date(task.alarm);
    do { d.setDate(d.getDate() + step); } while (d.getTime() <= Date.now());
    next.alarm = d.toISOString(); next.alarmFired = false;
    if (task.date) next.date = ymd(d);
  } else {
    next.alarmFired = true;
  }
  upsert(next);
}
function ringAlarm(task) {
  markRung(`${task.id}|${task.alarm}`);
  if (cloudOn() && seenNow()) cloud.deleteReminder(task.id + '_echo').catch(() => {});
  alarmQueue.push(task);
  if (!activeAlarm) showNextAlarm();
  notify(task);
}
function fireAlarm(task) { settleAlarm(task); ringAlarm(task); }
function showNextAlarm() {
  activeAlarm = alarmQueue.shift() || null;
  if (!activeAlarm) { popup.hidden = true; return; }
  $('#alarm-title').textContent = activeAlarm.title;
  const n = $('#alarm-note'); n.textContent = activeAlarm.notes ? activeAlarm.notes.slice(0, 90) : ''; n.hidden = !activeAlarm.notes;
  popup.hidden = false;
  playAlarmSound();
}
const closeAlarm = () => { if (cloudOn() && activeAlarm) cloud.deleteReminder(activeAlarm.id + '_echo').catch(() => {}); stopAlarmSound(); popup.hidden = true; activeAlarm = null; setTimeout(showNextAlarm, 400); };
$('#alarm-dismiss').addEventListener('click', closeAlarm);
$('#alarm-snooze').addEventListener('click', () => {
  const t = activeAlarm && state.tasks.find((x) => x.id === activeAlarm.id);
  if (t) { upsert({ ...t, alarm: new Date(Date.now() + 5 * 60e3).toISOString(), alarmFired: false }); toast('Snoozed for 5 minutes'); }
  closeAlarm();
});
$('#alarm-done').addEventListener('click', () => {
  const t = activeAlarm && state.tasks.find((x) => x.id === activeAlarm.id);
  if (t && !t.completed) toggleComplete(t.id);
  closeAlarm();
});

let audioCtx, master = null, alarmTimer = null, alarmEnd = 0;
const alarmSecs = () => { const n = Number(lsGet(LS.alarmSecs, '5')); return [0, 3, 5, 10].includes(n) ? n : 5; };

function beepCycle() {
  const t0 = audioCtx.currentTime;
  [880, 660, 880, 660, 880].forEach((f, i) => {
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = 'sine'; o.frequency.value = f; o.connect(g); g.connect(master);
    const t = t0 + i * 0.2;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.5, t + 0.02); g.gain.exponentialRampToValueAtTime(0.001, t + 0.17);
    o.start(t); o.stop(t + 0.18);
  });
}
/* Rings in repeating cycles for the chosen duration, until stopAlarmSound() */
function startAlarmSound(secs = alarmSecs()) {
  stopAlarmSound();
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    master = audioCtx.createGain(); master.gain.value = 1; master.connect(audioCtx.destination);
  } catch { return; /* audio unavailable */ }
  alarmEnd = secs ? Date.now() + secs * 1000 : Infinity;
  const tick = () => {
    if (Date.now() >= alarmEnd) { alarmTimer = null; return; }
    try { beepCycle(); } catch { /* ignore */ }
    if (navigator.vibrate && navigator.userActivation?.hasBeenActive) navigator.vibrate([200, 100, 200]);
    alarmTimer = setTimeout(tick, 1100);
  };
  tick();
}
function stopAlarmSound() {
  clearTimeout(alarmTimer); alarmTimer = null; alarmEnd = 0;
  if (master) { try { master.gain.cancelScheduledValues(0); master.gain.value = 0; master.disconnect(); } catch { /* ignore */ } master = null; }
  if (navigator.vibrate && navigator.userActivation?.hasBeenActive) navigator.vibrate(0);
}
const playAlarmSound = startAlarmSound;
function ensureNotifyPermission() {
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
}
async function notify(task) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const opts = { body: task.notes ? task.notes.slice(0, 100) : 'Time to get this done!', icon: 'icons/icon-192.png', badge: 'icons/favicon-32.png', tag: 'task-' + task.id };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) return reg.showNotification('⏰ ' + task.title, opts); // works on Android / installed PWA
    new Notification('⏰ ' + task.title, opts);
  } catch { /* ignore */ }
}

/* A notification button was tapped but the worker could not do it (no worker URL / offline): do it here */
let pendingAct = null;
function runAct(act, id) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return false;
  if (act === 'done') { if (!t.completed) toggleComplete(id); }
  else if (act === 'snooze') { upsert({ ...t, alarm: new Date(Date.now() + 10 * 60e3).toISOString(), alarmFired: false }); toast('Snoozed for 10 minutes'); }
  return true;
}
function flushPendingAct() { if (pendingAct && runAct(pendingAct.act, pendingAct.id)) pendingAct = null; }

/* A push arrived while the app is open: show the in-app popup + sound */
navigator.serviceWorker?.addEventListener('message', (e) => {
  if (e.data?.type === 'act') { runAct(e.data.act, e.data.id); return; }
  if (e.data?.type === 'dismiss') { // handled on another device: drop it from the queue and close its popup here
    const id = e.data.id;
    for (let i = alarmQueue.length - 1; i >= 0; i--) if (alarmQueue[i].id === id) alarmQueue.splice(i, 1);
    if (activeAlarm?.id === id) closeAlarm();
    return;
  }
  if (e.data?.type !== 'reminder') return;
  const d = e.data.data || {};
  if (d.kind === 'pre') { toast(`\u23f3 Coming up: ${d.title || 'reminder'}`, { duration: 7000 }); return; }
  const key = `${d.taskId}|${d.alarm}`;
  if (wasRung(key)) return;
  markRung(key);
  alarmQueue.push(state.tasks.find((x) => x.id === d.taskId) || { id: d.taskId, title: d.title || 'Reminder', notes: d.body || '' });
  if (!activeAlarm) showNextAlarm();
});

/* =====================================================
   TOASTS
   ===================================================== */
function toast(msg, { action, duration = 4200 } = {}) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span>${esc(msg)}</span>`;
  const remove = () => { el.classList.add('out'); setTimeout(() => el.remove(), 260); };
  if (action) {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = action.label;
    b.addEventListener('click', () => { action.fn(); remove(); });
    el.appendChild(b);
  }
  $('#toasts').appendChild(el);
  setTimeout(remove, duration);
}

/* =====================================================
   SYNC STATUS + ACCOUNT
   ===================================================== */
const SYNC_TEXT = { local: 'Local only', syncing: 'Syncing…', synced: 'Synced', offline: 'Offline · will sync later', error: 'Sync error' };
function setSync(s, detail = '') {
  state.sync = s; state.syncDetail = detail;
  $$('[data-sync-text]').forEach((el) => { el.textContent = SYNC_TEXT[s]; });
  $$('[data-sync-dot]').forEach((el) => { el.dataset.s = s; });
  if ($('#account').open) renderAccount();
  renderSyncBar();
}
function renderSyncBar() {
  const bar = $('#sync-bar'); if (!bar) return;
  const n = cloudOn() ? state.tasks.filter((t) => state.pending.has(t.id)).length : 0;
  const s = state.sync, plural = n === 1 ? 'change' : 'changes';
  let msg = '', kind = '';
  if (!cloudOn()) msg = '';
  else if (s === 'offline') { kind = 'off'; msg = n ? `You’re offline. ${n} ${plural} saved on this device and will upload when you’re back online.` : 'You’re offline. Everything you add is saved here and will sync later.'; }
  else if (s === 'error') { kind = 'err'; msg = 'Sync problem: ' + (state.syncDetail || 'could not reach your account') + '. Your tasks are safe on this device.'; }
  else if (n && s !== 'synced') { kind = 'syn'; msg = `Syncing ${n} ${plural}…`; }
  bar.hidden = !msg; bar.dataset.k = kind; bar.textContent = msg;
}
function onCloudError(err) {
  console.error('Sync error', err);
  setSync('error', err?.message || String(err));
}
window.addEventListener('online', () => { if (cloudOn()) { setSync('syncing'); ph.syncAll(state.tasks.flatMap(photoIdsOf)).catch(() => {}); } });
window.addEventListener('offline', () => cloudOn() && setSync('offline'));

function renderAvatar() {
  const u = state.user;
  $$('[data-avatar]').forEach((el) => {
    el.innerHTML = u ? (u.photo ? `<img src="${esc(u.photo)}" alt="" referrerpolicy="no-referrer"/>` : esc((u.name || u.email || '?')[0].toUpperCase())) : icon('user');
  });
  $$('[data-account-name]').forEach((el) => { el.textContent = u ? (u.name || u.email) : 'Guest'; });
}

const GOOGLE_SVG = '<svg viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.7 6c4.5-4.2 6.9-10.3 6.9-17.7z"/><path fill="#FBBC05" d="M10.5 28.7c-.5-1.4-.8-3-.8-4.7s.3-3.2.8-4.7l-7.9-6.1C.9 16.5 0 20.1 0 24s.9 7.5 2.6 10.8l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.7-6c-2.1 1.4-4.9 2.3-8.2 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/></svg>';

function renderAccount() {
  const box = $('#acc-box'); const u = state.user;
  if (!window.FIREBASE_CONFIG?.apiKey) {
    box.innerHTML = `<p><strong>Cloud sync is not set up yet.</strong></p>
      <p>Your tasks are saved on this device only. To see and edit the same tasks on all your devices, set up Firebase (free) — it takes about 10 minutes.</p>
      <div class="note">Open <b>SETUP.md</b> in the project folder and follow the steps, then paste your config into <b>firebase-config.js</b>.</div>`;
  } else if (!u) {
    box.innerHTML = `<p>Sign in with your email and password to sync your tasks across your phone, laptop and PC. Your existing local tasks will be uploaded automatically.</p>
      <button type="button" class="btn btn-primary" id="btn-signin">Sign in or create account</button>
      ${state.sync === 'error' ? `<div class="note">${esc(state.syncDetail)}</div>` : ''}`;
    $('#btn-signin').onclick = () => { $('#account').close(); showLoginScreen(true); };
  } else {
    box.innerHTML = `<div class="acc-user"><span class="avatar">${u.photo ? `<img src="${esc(u.photo)}" alt="" referrerpolicy="no-referrer"/>` : esc((u.name || u.email)[0].toUpperCase())}</span>
      <div><strong>${esc(u.name || 'Signed in')}</strong><small>${esc(u.email)}</small></div></div>
      <div class="acc-status"><span class="sync-dot" data-s="${state.sync}"></span> ${SYNC_TEXT[state.sync]}</div>
      ${state.sync === 'error' ? `<div class="note">${esc(state.syncDetail)}</div>` : ''}
      <button type="button" class="btn btn-ghost" id="btn-signout">${icon('logout')} Sign out</button>`;
    $('#btn-signout').onclick = async () => {
      await cloud.logout();
      await ph.clearLocal();
      try { Object.keys(localStorage).filter((k) => k.startsWith(LS.cachePrefix) || k === 'tp-last-uid').forEach((k) => localStorage.removeItem(k)); } catch { /* ignore */ }
      location.reload(); // restart with a clean in-memory state
    };
  }
  renderPush();
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  $('#install-text').textContent = standalone ? 'You are using the installed app.'
    : installEvent ? 'Install To-Do Pro as an app on this device.'
    : isIOS ? 'On iPhone/iPad: tap the Share button, then \u201cAdd to Home Screen\u201d.'
    : 'Open the menu of your browser and choose \u201cInstall app\u201d or \u201cAdd to Home screen\u201d.';
  $$('[data-install]').forEach((x) => (x.hidden = !installEvent || standalone));
}
/* ---------- background push (account dialog) ---------- */
const PUSH_KEY = 'tp-push-token';
let pushOK = null;
async function renderPush() {
  const sec = $('#push-section');
  const configured = !!(window.FIREBASE_VAPID_KEY && cloud && state.user);
  sec.hidden = !configured;
  if (!configured) return;
  if (pushOK === null) pushOK = await cloud.pushSupported();
  const iosBrowser = /iphone|ipad|ipod/i.test(navigator.userAgent) && !(matchMedia('(display-mode: standalone)').matches || navigator.standalone);
  const on = !!lsGet(PUSH_KEY, '') && Notification.permission === 'granted';
  const btn = $('#btn-push'), txt = $('#push-text');
  $('#btn-push-test').hidden = !on;
  if (iosBrowser) { txt.textContent = 'On iPhone/iPad, first add this app to your Home Screen (Share \u2192 Add to Home Screen), then open it from there.'; btn.hidden = true; return; }
  if (!pushOK) { txt.textContent = 'This browser does not support background notifications.'; btn.hidden = true; return; }
  if (typeof Notification !== 'undefined' && Notification.permission === 'denied') { txt.textContent = 'Notifications are blocked for this site. Allow them in your browser/site settings, then try again.'; btn.hidden = true; return; }
  btn.hidden = false;
  txt.textContent = on ? 'On: you will get reminders on this device even when the app is closed or the screen is off.' : 'Get reminders on this device even when the app is closed or the screen is off.';
  btn.textContent = on ? 'Turn off' : 'Turn on for this device';
}
$('#btn-push').addEventListener('click', async () => {
  const btn = $('#btn-push'); btn.disabled = true;
  try {
    if (lsGet(PUSH_KEY, '')) {
      await cloud.disablePush(state.user.uid, lsGet(PUSH_KEY, '')); lsSet(PUSH_KEY, ''); toast('Background notifications turned off');
    } else {
      const token = await cloud.enablePush(state.user.uid, window.FIREBASE_VAPID_KEY);
      lsSet(PUSH_KEY, token); toast('Background notifications turned on');
      state.tasks.forEach(mirrorReminder);
    }
  } catch (e) { console.error(e); toast(e.message || 'Could not change notification setting'); }
  btn.disabled = false; renderPush();
});
$('#btn-push-test').addEventListener('click', async () => {
  try {
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification('\u23f0 Test notification', { body: 'If you can see this, notifications work on this device.', icon: 'icons/icon-192.png', vibrate: [400, 200, 400] });
  } catch { toast('Could not show a test notification'); }
});

async function signInClick() {
  try { await cloud.signIn(); }
  catch (e) {
    const msg = e.code === 'auth/unauthorized-domain' ? 'This domain is not authorized in Firebase → Authentication → Settings → Authorized domains.' : (e.message || String(e));
    setSync('error', msg); toast('Sign-in failed'); renderAccount();
  }
}
$$('[data-open-account]').forEach((b) => b.addEventListener('click', () => { renderAccount(); $('#account').showModal(); }));

/* reminder extras: pre-reminder + backup push */
const preSel = $('#pre-min'), echoChk = $('#echo-on');
preSel.value = String(preMin()); echoChk.checked = echoOn();
const remirrorAll = () => state.tasks.forEach(mirrorReminder);
preSel.addEventListener('change', () => {
  lsSet(LS.preMin, preSel.value);
  if (cloudOn()) cloud.savePrefs(state.user.uid, { pre: preMin() }).catch(() => {});
  remirrorAll();
  toast(Number(preSel.value) ? `Heads-up ${preSel.value} min before each alarm (all your devices)` : 'Pre-reminder off');
});
echoChk.addEventListener('change', () => {
  lsSet(LS.echo, echoChk.checked ? '1' : '0');
  if (cloudOn()) cloud.savePrefs(state.user.uid, { echo: echoOn() }).catch(() => {});
  remirrorAll();
});
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') ackEchoes(); });
let unsubPrefs = null;

/* reminder sound setting */
const soundSel = $('#sound-secs');
soundSel.value = String(alarmSecs());
soundSel.addEventListener('change', () => { lsSet(LS.alarmSecs, soundSel.value); });
$('#btn-test-sound').addEventListener('click', () => {
  if (alarmTimer) { stopAlarmSound(); return; }
  startAlarmSound(Number(soundSel.value) || 5); // "until dismissed" previews for 5s
});
$('#account').addEventListener('close', stopAlarmSound);

/* backup */
$('#btn-export').addEventListener('click', async () => {
  track('export');
  const pics = await ph.allLocal(state.tasks.flatMap(photoIdsOf)); // photos travel inside the backup
  const payload = Object.keys(pics).length ? { app: 'to-do-pro', version: 2, tasks: state.tasks, photos: pics } : state.tasks;
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = `todo-pro-backup-${todayStr()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});
function downloadCsv(list, name) {
  const cell = (v) => { let x = String(v ?? ''); if (/^[=+\-@\t\r]/.test(x)) x = "'" + x; return '"' + x.replace(/"/g, '""') + '"'; };
  const head = ['Title', 'Status', 'Section', 'Tags', 'Priority', 'Due date', 'Reminder', 'Repeat', 'Completed at', 'Checklist', 'Notes'];
  const rows = [...list].sort(byOrder).map((t) => [
    t.title, t.completed ? 'Done' : 'Pending', t.heading, (t.tags || []).join(' '), t.priority, t.date,
    t.alarm ? new Date(t.alarm).toLocaleString('en-GB') : '', t.alarmRepeat === 'none' ? '' : t.alarmRepeat,
    t.completedAt ? new Date(t.completedAt).toLocaleString('en-GB') : '',
    (t.subtasks || []).map((x) => (x.done ? '[x] ' : '[ ] ') + x.text).join('\n'), t.notes,
  ]);
  const csv = '\uFEFF' + [head, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
  saveBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `${name}-${todayStr()}.csv`);
  toast(`Exported ${rows.length} task${rows.length === 1 ? '' : 's'}`);
}
function saveBlob(blob, filename) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
$('#btn-csv').addEventListener('click', () => { track('export-csv'); downloadCsv(state.tasks, 'todo-pro-tasks'); });
/* printable list: Ctrl+P and the Account button both print a clean task list (choose "Save as PDF") */
let printSel = null; // when set, the print sheet lists exactly these tasks (Share, Download, PDF)
function buildPrintSheet() {
  const td = todayStr();
  const list = state.tasks.filter((t) => !t.completed && (!state.tag || t.tags.includes(state.tag))).sort(byOrder);
  const isTd = (t) => (t.date && t.date <= td) || (t.alarm && ymd(new Date(t.alarm)) === td);
  const kind = (t) => (t.date && t.date < td && !isHabit(t) ? 0 : isTd(t) ? 1 : t.date ? 2 : 3);
  const names = ['Overdue', 'Today', 'Later', 'No date'];
  const by = [[], [], [], []]; list.forEach((t) => by[kind(t)].push(t));
  by[2].sort((a, b) => a.date.localeCompare(b.date));
  const row = (t) => {
    const meta = [t.date ? dateLabel(t.date) : '', t.alarm ? whenLabel(t.alarm) : '', t.priority === 'high' ? 'High priority' : t.priority === 'low' ? 'Low priority' : '', t.heading, (t.tags || []).map((g) => '#' + g).join(' ')].filter(Boolean).join('  ·  ');
    const subs = (t.subtasks || []).map((x) => `<li class="${x.done ? 'd' : ''}"><span class="bx">${x.done ? '\u2713' : ''}</span>${esc(x.text)}</li>`).join('');
    const notes = t.notes ? `<p class="pn">${esc(t.notes.length > 400 ? t.notes.slice(0, 400) + '…' : t.notes)}</p>` : '';
    return `<li class="pt"><span class="bx"></span><div><b>${esc(t.title)}</b>${meta ? `<small>${esc(meta)}</small>` : ''}${subs ? `<ul class="ps">${subs}</ul>` : ''}${notes}</div></li>`;
  };
  if (printSel) {
    const rowSel = (t) => row(t).replace('<span class="bx"></span>', `<span class="bx">${t.completed ? '\u2713' : ''}</span>`);
    $('#print-sheet').innerHTML = `<h1>To-Do Pro</h1><p class="pm">${printSel.length} shared task${printSel.length === 1 ? '' : 's'} · ${esc(new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))}</p><ul class="pl">${printSel.map(rowSel).join('')}</ul>`;
    return;
  }
  $('#print-sheet').innerHTML = `<h1>To-Do Pro</h1><p class="pm">${list.length} open task${list.length === 1 ? '' : 's'}${state.tag ? ' tagged #' + esc(state.tag) : ''} · printed ${esc(new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))}</p>`
    + (list.length ? by.map((g, i) => g.length ? `<h2>${names[i]} <span>${g.length}</span></h2><ul class="pl">${g.map(row).join('')}</ul>` : '').join('') : '<p>No open tasks. Nice work!</p>');
}
window.addEventListener('beforeprint', buildPrintSheet);
window.addEventListener('afterprint', () => { $('#print-sheet').innerHTML = ''; printSel = null; });
$('#btn-print').addEventListener('click', () => {
  track('export-print'); $('#account').close();
  toast('In the print window, choose “Save as PDF”');
  setTimeout(() => window.print(), 700);
});
$('#btn-import').addEventListener('click', () => $('#import-file').click());
$('#import-file').addEventListener('change', async (e) => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    if (f.size > 40e6) throw new Error('too large');
    const data = JSON.parse(await f.text());
    const arr = Array.isArray(data) ? data : data.tasks;
    if (!Array.isArray(arr)) throw new Error('bad file');
    if (f.size > 5e6 && !(data && !Array.isArray(data) && data.photos)) throw new Error('too large'); // only photo backups may be larger
    const pics = data && !Array.isArray(data) && data.photos && typeof data.photos === 'object' ? Object.entries(data.photos).slice(0, 300) : [];
    for (const [id, d] of pics) if (ph.validPhotoId(id) && ph.validPhotoData(d)) await ph.savePhoto(id, { d, w: 0, h: 0, t: Date.now() });
    const list = arr.slice(0, 2000).filter((t) => t && typeof t === 'object' && t.title).map((t, i) => normalize(t, i));
    list.forEach((t) => upsert(t, { silent: true }));
    render(); toast(`Imported ${list.length} task${list.length === 1 ? '' : 's'}`);
  } catch { toast('That file could not be imported'); }
});

/* share: copy link + WhatsApp */
const APP_LINK = 'https://abdurrahmancce.github.io/To-Do-Pro/';
$('#btn-wa').href = 'https://wa.me/?text=' + encodeURIComponent('Try To-Do Pro, a free to-do app with reminders that works on your phone: ' + APP_LINK);
$('#btn-wa').addEventListener('click', () => track('share-whatsapp'));
$('#btn-copylink').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(APP_LINK); toast('Link copied'); }
  catch { toast('Copy failed. Link: ' + APP_LINK); }
  track('share-copy');
});


/* install banner: shown once in the browser until installed or hidden */
(() => {
  const bar = $('#install-banner'); if (!bar) return;
  const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const hidden = () => { try { return localStorage.getItem('tp-install-hide') === '1'; } catch { return false; } };
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const show = () => { if (!standalone() && !hidden() && matchMedia('(max-width: 899px)').matches) bar.hidden = false; };
  if (isIOS) $('#ib-sub').textContent = 'Tap Share, then \u201cAdd to Home Screen\u201d.';
  $('#ib-install').addEventListener('click', async () => {
    track('install-banner');
    if (installEvent) { installEvent.prompt(); await installEvent.userChoice; installEvent = null; bar.hidden = true; return; }
    bar.hidden = true; renderAccount(); $('#account').showModal(); $('#install-section').scrollIntoView({ block: 'center' });
  });
  $('#ib-close').addEventListener('click', () => { bar.hidden = true; try { localStorage.setItem('tp-install-hide', '1'); } catch { /* ignore */ } });
  window.addEventListener('appinstalled', () => { bar.hidden = true; });
  setTimeout(show, 2500);
})();
/* share sheet on phones */
if (navigator.share) {
  const sb = $('#btn-sharelink'); sb.hidden = false;
  sb.addEventListener('click', () => { track('share-native'); navigator.share({ title: 'To-Do Pro', text: 'A free to-do app with reminders that works on your phone.', url: APP_LINK }).catch(() => {}); });
}
/* install prompt */
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); installEvent = e;
  $$('[data-install]').forEach((b) => (b.hidden = false));
  if ($('#account').open) renderAccount();
});
window.addEventListener('appinstalled', () => { installEvent = null; $$('[data-install]').forEach((b) => (b.hidden = true)); toast('App installed'); });
$$('[data-install]').forEach((b) => b.addEventListener('click', async () => {
  if (!installEvent) return;
  installEvent.prompt(); await installEvent.userChoice; installEvent = null;
  $$('[data-install]').forEach((x) => (x.hidden = true));
}));

/* =====================================================
   CLOUD (Firebase) — optional
   ===================================================== */
async function initCloud() {
  const cfg = window.FIREBASE_CONFIG;
  if (!cfg || !cfg.apiKey) { setSync('local'); return; }
  setSync('syncing');
  try {
    cloud = await import('./cloud.js');
    cloud.init(cfg);
    cloud.onAuth(handleAuth);
  } catch (e) {
    console.error(e); cloud = null;
    setSync(navigator.onLine ? 'error' : 'offline', 'Could not load the sync module. ' + (e.message || ''));
  }
}

async function showLoginScreen(force = false) {
  try {
    const a = await import('./auth.js');
    if (!force && a.isGuest()) return;
    document.querySelectorAll('dialog[open]').forEach((d) => d.close());
    if (force) a.clearGuest();
    a.showLogin(cloud, { onSkip: () => { const d = $('#account'); if (d?.open) d.close(); } });
  } catch (e) { console.error('login screen failed', e); }
}

let photoSyncT = null;
async function handleAuth(user) {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  if (unsubPrefs) { unsubPrefs(); unsubPrefs = null; }
  mirrorBoot = { prefs: false, tasks: false, done: false };
  if (!user) {
    state.user = null; lsSet(LS.lastUid, '');
    ph.setRemote(null);
    setAll(loadList(LS.local));
    renderAvatar(); setSync('local'); render();
    showLoginScreen();
    return;
  }
  state.user = user; lsSet(LS.lastUid, user.uid);
  ph.setErrorHandler((e) => { console.warn('[photos] upload failed', e?.code || e); if (e?.code === 'permission-denied') toast('Photos cannot sync yet: publish the latest Firestore rules.'); });
  ph.setRemote({ get: (id) => cloud.getPhoto(user.uid, id), put: (id, rec) => cloud.savePhoto(user.uid, id, rec), del: (id) => cloud.deletePhoto(user.uid, id) });
  import('./auth.js').then((a) => { a.clearGuest(); a.hideLogin(); }).catch(() => {});
  setAll(loadList(cacheKey()));
  renderAvatar(); setSync('syncing'); render(); maybeOpenDeepLink();

  // First sign-in on this device: upload any local-only tasks, keep a backup copy
  const local = loadList(LS.local);
  if (local.length) {
    const backup = lsGet(LS.local);
    lsSet('tasks-pro-uploaded-backup', backup);
    lsSet(LS.local, '[]');
    local.flatMap(photoIdsOf).forEach((id) => ph.photoURL(id).then((d) => d && cloud.savePhoto(user.uid, id, { d }).catch(() => {})));
    cloud.saveMany(user.uid, local).then(() => toast(`${local.length} local task${local.length === 1 ? '' : 's'} uploaded to your account`)).catch((e) => {
      lsSet(LS.local, backup); onCloudError(e);
    });
  }

  unsubPrefs = cloud.subscribePrefs(user.uid, (p, meta) => {
    if (meta.fromCache) return;
    if (p) {
      const pre = [0, 5, 10, 30].includes(Number(p.pre)) ? Number(p.pre) : 0, echo = p.echo !== false;
      const changed = pre !== preMin() || echo !== echoOn();
      lsSet(LS.preMin, String(pre)); lsSet(LS.echo, echo ? '1' : '0');
      preSel.value = String(pre); echoChk.checked = echo;
      // look & goal follow the account on every device
      if (ACCENTS.includes(p.accent) && p.accent !== prefAccent()) lsSet(LS.accent, p.accent);
      if (['dark', 'light', 'auto'].includes(p.theme) && p.theme !== prefTheme()) lsSet(LS.theme, p.theme);
      if (Number.isFinite(p.goal) && p.goal >= 0 && p.goal !== goalN()) lsSet(LS.goal, String(Math.min(500, Math.floor(p.goal))));
      if (p.accent === undefined && !mirrorBoot.prefs) shareLook(); // first device to open shares its look
      if (p.goal === undefined && goalN() && !mirrorBoot.prefs) cloud.savePrefs(user.uid, { goal: goalN() }).catch(() => {});
      applyAppearance(); render();
      if (changed && mirrorBoot.done) remirrorAll();
    } else if (!mirrorBoot.prefs) {
      cloud.savePrefs(user.uid, { pre: preMin(), echo: echoOn(), accent: prefAccent(), theme: prefTheme(), goal: goalN() }).catch(() => {}); // nothing shared yet: share this device's choice
    }
    mirrorBoot.prefs = true; bootMirror();
  });
  unsubscribe = cloud.subscribe(user.uid, (docs, meta) => {
    state.pending = new Set(docs.filter((d) => d.__pending).map((d) => String(d.id)));
    setAll(docs.map((d, i) => normalize(d, i)));
    persist(); purgeExpired();
    if (!meta.fromCache) { mirrorBoot.tasks = true; bootMirror(); }
    setSync(!navigator.onLine ? 'offline' : meta.hasPendingWrites || meta.fromCache ? 'syncing' : 'synced');
    if (!meta.fromCache) { flushPendingAct(); ackEchoes(); clearTimeout(photoSyncT); photoSyncT = setTimeout(() => ph.syncAll(state.tasks.flatMap(photoIdsOf)).catch(() => {}), 1500); }
    render(); checkAlarms();
  }, onCloudError);
  refreshPush();
}

/* Self-heal: the worker deletes a device whose push token Google reports as dead, and Chrome can also rotate the token.
   While this device is "on", quietly re-register its current token (no permission prompt: it is already granted)
   so it never silently drops off the list. At most once every 20 minutes. */
const PUSH_CHECK_KEY = 'tp-push-checked';
async function refreshPush(force = false) {
  try {
    const old = lsGet(PUSH_KEY, '');
    if (!old || !cloudOn() || !window.FIREBASE_VAPID_KEY || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    if (!force && Date.now() - Number(lsGet(PUSH_CHECK_KEY, '0')) < 20 * 60e3) return;
    lsSet(PUSH_CHECK_KEY, String(Date.now()));
    const uid = state.user.uid;
    const token = await cloud.enablePush(uid, window.FIREBASE_VAPID_KEY); // re-writes users/{uid}/devices/{token}
    if (token && token !== old) { lsSet(PUSH_KEY, token); cloud.dropDevice(uid, old).catch(() => {}); console.info('[push] token refreshed'); }
  } catch (e) { console.warn('[push] refresh failed', e?.message || e); }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshPush(); });

/* =====================================================
   WEEKLY SUMMARY (last 7 days) + habit streaks
   ===================================================== */
const sumDialog = $('#summary');
function renderSummary() {
  const s = weekStats(state.tasks);
  const max = Math.max(1, ...s.bars.map((b) => b.count));
  const md = (d) => fromYmd(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const delta = s.delta === 0 ? ['flat', 'Same as the week before'] : s.delta > 0 ? ['up', `▲ ${s.delta} more than the week before`] : ['down', `▼ ${-s.delta} fewer than the week before`];
  const stat = (label, value, hint = '') => `<div class="sum-stat"><strong>${value}</strong><span>${label}</span>${hint ? `<small>${hint}</small>` : ''}</div>`;
  const habits = s.habits.length ? `
    <div class="sum-sec"><h3>Habit streaks</h3>
      <ul class="sum-habits">${s.habits.slice(0, 6).map((h) => `<li><span class="fl">\u{1F525} ${h.cur}</span><span class="nm">${esc(h.title)}</span><small>${h.repeat === 'weekly' ? 'weekly' : 'daily'} · best ${h.best}</small></li>`).join('')}</ul>
      <p class="muted sum-note">Mark a repeating task done to keep its streak alive. It comes back at its next time.</p>
    </div>` : '';
  $('#sum-body').innerHTML = `
    <div class="sum-hero">
      <div class="sum-num">${s.total}</div>
      <div class="sum-hero-t"><strong>task${s.total === 1 ? '' : 's'} completed</strong><small>${md(s.range[0])} – ${md(s.range[1])}</small></div>
      <span class="sum-delta ${delta[0]}">${delta[1]}</span>
    </div>
    <div class="sum-bars" role="img" aria-label="Tasks completed per day">${s.bars.map((b) => `
      <div class="sum-bar${b.today ? ' today' : ''}"><span class="n">${b.count || ''}</span><i style="height:${b.count ? Math.max(8, Math.round((b.count / max) * 100)) : 3}%"></i><em>${b.label}</em></div>`).join('')}</div>
    <div class="sum-goal">
      <label for="goal-input">Weekly goal <small>tasks to finish in 7 days</small></label>
      <div class="goal-row"><input id="goal-input" type="number" inputmode="numeric" min="0" max="500" step="1" placeholder="e.g. 20" value="${goalN() || ''}" /><button type="button" class="btn btn-ghost sm" id="goal-save">Set</button></div>
      ${goalN() ? `<div class="goal-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${goalN()}" aria-valuenow="${Math.min(s.total, goalN())}"><i style="width:${Math.min(100, Math.round((s.total / goalN()) * 100))}%"></i></div><p class="goal-note">${s.total >= goalN() ? `Goal reached! ${s.total} of ${goalN()} done \u{1F389}` : `${s.total} of ${goalN()} done · ${goalN() - s.total} to go`}</p>` : '<p class="goal-note">Set a number to see your progress here and on the dashboard.</p>'}
    </div>
    <div class="sum-grid">
      ${stat('Created', s.created)}
      ${stat('Overdue now', s.overdue)}
      ${stat('Done on time', s.onTimePct == null ? '–' : s.onTimePct + '%')}
      ${stat('Best day', s.best ? s.best.label : '–', s.best ? `${s.best.count} done` : '')}
    </div>
    ${s.total === 0 ? '<p class="muted sum-note">Complete a few tasks and your week will show up here.</p>' : ''}
    ${habits}`;
}
function saveGoal() {
  const n = Math.max(0, Math.min(500, Math.floor(Number($('#goal-input').value) || 0)));
  lsSet(LS.goal, String(n));
  if (cloudOn()) cloud.savePrefs(state.user.uid, { goal: n }).catch(() => {});
  renderSummary(); render(); toast(n ? `Weekly goal: ${n} tasks` : 'Weekly goal off');
}
$('#sum-body').addEventListener('click', (e) => { if (e.target.closest('#goal-save')) saveGoal(); });
$('#sum-body').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'goal-input') { e.preventDefault(); saveGoal(); } });
function openSummary() { renderSummary(); if (!sumDialog.open) sumDialog.showModal(); }
['#btn-summary-side', '#progress-card'].forEach((sel) => { const el = $(sel); if (el) el.addEventListener('click', openSummary); });
$('#rail').addEventListener('click', (e) => {
  const o = e.target.closest('[data-open]'); if (o) { openEditor(o.dataset.open); return; }
  if (e.target.closest('#rail-progress, #rail-goal')) openSummary();
});
$('#rail').addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && (e.target.id === 'rail-progress' || e.target.id === 'rail-goal')) { e.preventDefault(); openSummary(); } });
$('#tag-bar').addEventListener('click', (e) => { const b = e.target.closest('[data-tag]'); if (!b) return; state.tag = b.dataset.tag === state.tag ? '' : b.dataset.tag; render(); });
$$('#group-toggle button').forEach((b) => b.addEventListener('click', () => { state.groupBy = b.dataset.group; lsSet(LS.groupBy, state.groupBy); render(); }));
$$('.sidebar .nav-item').forEach((b) => { const sp = $('span', b); if (sp) b.title = sp.textContent; });
$('#progress-card').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openSummary(); } });

/* =====================================================
   SHORTCUTS
   ===================================================== */
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.selecting && !document.querySelector('dialog[open]')) { setSelecting(false); return; }
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); searchEl.focus(); searchEl.select(); return; }
  if (typing || e.ctrlKey || e.metaKey || e.altKey || document.querySelector('dialog[open]')) {
    if (e.key === 'Escape' && document.activeElement === searchEl) { searchEl.value = ''; state.search = ''; $('#search-clear').hidden = true; render(); searchEl.blur(); }
    return;
  }
  if (e.key === 'n') { e.preventDefault(); openEditor(null); }
  else if (e.key === '/') { e.preventDefault(); searchEl.focus(); }
});

/* =====================================================
   BOOT
   ===================================================== */
function boot() {
  const qp = new URLSearchParams(location.search);
  if (['all', 'today', 'upcoming', 'calendar', 'done', 'trash'].includes(qp.get('view'))) { state.view = qp.get('view'); lsSet(LS.view, state.view); }
  applyAppearance();
  const lastUid = lsGet(LS.lastUid, '');
  setAll(loadList(window.FIREBASE_CONFIG?.apiKey && lastUid ? LS.cachePrefix + lastUid : LS.local));
  purgeExpired();
  renderAvatar();
  render();
  checkAlarms();
  setInterval(() => { checkAlarms(); purgeExpired(); if (!document.hidden && !dragState && !swipe && !openRow && !document.querySelector('dialog[open]')) render(); }, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { checkAlarms(); ackEchoes(); render(); } });
  initCloud();

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW registration failed', e));
  }
  if (['done', 'snooze'].includes(qp.get('do')) && qp.get('id')) { pendingAct = { act: qp.get('do'), id: qp.get('id') }; flushPendingAct(); }
  navigator.serviceWorker?.ready.then((r) => r.active?.postMessage({ type: 'cfg', workerUrl: window.WORKER_URL || '' })).catch(() => {});
  const act = qp.get('action');
  if (act === 'new') openEditor(null);
  else if (act === 'search') { searchEl.focus(); }
  if (act || qp.get('view') || qp.get('do')) history.replaceState(null, '', location.pathname);
}


/* ---------- Report a bug and error notice ---------- */
function bugReportURL() {
  const errs = window.tpErrors?.read() || [];
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const lines = [
    '**What happened?**', '', '', '**What did you expect?**', '', '', '**Steps to reproduce**', '1. ', '',
    '---', '_Diagnostics (no task content is included):_',
    `- App update: ${APP_UPDATE.id}`,
    `- Browser: ${navigator.userAgent}`,
    `- Screen: ${innerWidth}x${innerHeight}, installed app: ${standalone ? 'yes' : 'no'}, online: ${navigator.onLine ? 'yes' : 'no'}`,
    `- Signed in: ${state.user ? 'yes' : 'no'}, sync: ${state.sync}`,
    `- Tasks: ${state.tasks.length}, in Trash: ${state.trash.length}`,
    errs.length ? '- Recent errors:' : '- Recent errors: none',
    ...errs.slice(-4).map((e) => `  - ${e.t.slice(0, 19)} ${e.m} (${e.s})`),
  ];
  const q = new URLSearchParams({ title: 'Bug: ', body: lines.join('\n'), labels: 'bug' });
  return `https://github.com/abdurrahmancce/To-Do-Pro/issues/new?${q}`.slice(0, 7000);
}
$('#btn-report-bug')?.addEventListener('click', (e) => { e.currentTarget.href = bugReportURL(); track('report-bug'); });
let errToastShown = false;
window.addEventListener('tp-error', () => {
  if (errToastShown) return; errToastShown = true; // once per visit, so it never nags
  toast('Something went wrong. If it keeps happening, open Account \u2192 Report a bug.', { duration: 7000 });
});

/* ---------- Update history and future updates (Account \u2192 Update history) ---------- */
const UPDATE_HISTORY = [ // [date, title, detail], oldest first
  ["2026-05-01", "Project started", "First version of the to-do app and its README published on GitHub."],
  ["2026-05-13", "App files updated", "Updated app files uploaded."],
  ["2026-05-15", "App and README updated", "Another round of app and README improvements."],
  ["2026-10-06", "MIT License added", "The project now ships with an open-source MIT License."],
  ["2026-10-15", "To-Do Pro: new interface, installable app and cloud sync", "Redesigned interface, installable PWA, Firebase sign-in and Firestore sync across devices, with offline support."],
  ["2026-10-15", "Reminder sound length", "Choose how long the alarm rings: 3 seconds, 5 seconds, 10 seconds or until dismissed."],
  ["2026-10-15", "Background push reminders", "Reminders arrive even when the app is closed (Firebase Cloud Messaging with a Cloudflare Worker)."],
  ["2026-10-15", "Push fix for multiple devices", "Reminders now reach every device correctly when the app is open on another one."],
  ["2026-10-15", "Touch gestures and productivity tools", "Swipe actions, undo, bulk select, calendar view, keyboard shortcuts and accent colours."],
  ["2026-10-16", "Smarter reminders and quick add", "Done and Snooze on notifications, quick add from one sentence, repeating tasks with streaks and a weekly summary."],
  ["2026-10-17", "Settings and push reliability", "Reminder settings shared across devices, automatic repair of expired push tokens and worker setup."],
  ["2026-10-17", "Dismiss on other devices", "Handling a reminder on one device removes the notification on your other devices."],
  ["2026-10-18", "Email and password sign-in", "New animated login page with sign in, create account and password reset, plus English and Bangla documentation."],
  ["2026-10-18", "Dropdown and dialog polish", "Restyled reminder dropdowns, and dialogs close when the login screen opens."],
  ["2026-10-18", "Trash and Undo", "Deleted tasks stay in Trash for 30 days and can be restored; every delete has a 5-second Undo."],
  ["2026-10-18", "Autosave and English interface", "Everything you type is saved automatically, online or offline. All app text is now English."],
  ["2026-10-18", "Bangla and English on login and guide", "The login page and user guide show both languages clearly."],
  ["2026-10-18", "Guide links fixed", "Navigation links in the Bangla user guide now work."],
  ["2026-10-19", "Typing and data safety", "No red spellcheck lines under Bangla text, steadier keyboard while editing, safer import files, cleaner stored data, fix for deleted tasks coming back, and sign out clears saved tasks from the browser."],
  ["2026-10-19", "Project README", "Complete English README with features, architecture, security, testing and setup guides."],
  ["2026-10-19", "Contact developer", "Developer card with portfolio, GitHub and bug-report links in the app and the user guide."],
  ["2026-10-19", "What's new announcement", "A short summary of each update appears once after you update, and can be reopened from Account."],
  ["2026-10-22", "Checklist, bug reports and tests", "Checklist steps with a tick on every task, Report a bug with technical details, a notice when something goes wrong, optional visitor statistics, faster updates and an automated test suite."],
  ["2026-10-23", "Bigger notes box, update history and roadmap", "Larger description box with a centred drag handle, a dated update history and a Future updates list."],
  ["2026-10-23", "Easy install and sharing", "A Get the app section in Account with an Install button, a QR code, Copy link and a WhatsApp invite."],
  ["2026-10-24", "Install banner and Share button", "Phones now offer to install the app with a banner, a Share button opens your phone\u2019s share sheet, and the QR code image is fixed."],
  ["2026-10-25", "New app logo", "A new To Do logo on the home-screen icon, the browser tab, the login page and the app header."],
  ["2026-10-25", "Photos on tasks and checklist steps", "Take a photo, pick several from your gallery or paste a screenshot. Every picture can have a description, opens full screen, syncs across your devices and is included in backups."],
  ["2026-10-25", "Photo sync, laptop camera and viewer fixes", "Photos now upload in the background and retry until they reach your account, so they open on every device. Take photo opens the webcam on a laptop, and the full-screen viewer is centred."],
  ["2026-11-04", "Focus Dashboard redesign", "A slim icon sidebar, tasks grouped into Overdue, Today, Later and No date, and a right panel with a big progress ring, Up next and a 10-day completion chart. Teal accent and a deeper navy dark theme. Switch to By section any time to use your own sections."],
  ["2026-11-08", "Tags, spreadsheet export, weekly goal and synced look", "Add tags to any task (type @work in quick add) and filter by them. Export your tasks as a CSV for Excel or Google Sheets. Set a weekly goal and track it in the weekly summary and on the dashboard. Your accent colour, theme and goal now follow your account on every device."],
  ["2026-11-08", "Printable PDF list and sync status", "Print or save your open tasks as a clean PDF (Account, Backup, or Ctrl+P). A banner tells you when you are offline or syncing, and each task shows if it has not been uploaded yet."],
  ["2026-11-10", "Midnight Calm polish", "A greeting header with your name, a cleaner task card with clearer overdue accents, softer chips and photo thumbnails, and a refined right panel. The layout adapts smoothly from desktop to tablet and phone."],
  ["2026-11-11", "First-time tour and visitor statistics", "New users get a short guided tour of the essentials, and anyone can replay it from Account, Show tour. Privacy-friendly visitor statistics are now switched on: no cookies, no personal data, and Do Not Track is respected."],
  ["2026-11-12", "Share and download selected tasks", "Select tasks, then Share or Download. Send them as text through your phone\u2019s share sheet, WhatsApp, email or copy, or save them as a PDF, a spreadsheet (CSV), a PNG image or a task file another To-Do Pro user can import."],
  ["2026-11-12", "Labelled sidebar and screenshots", "On laptops and desktops every sidebar icon now shows its name (All tasks, Today, Upcoming, Calendar, Completed, Trash, Reminders, Weekly summary), just like the phone tab bar. The README now includes screenshots of the app."],
  ["2026-11-13", "Friends and groups", "Add friends with a private friend code or invite link, accept or decline requests, create groups and invite people with a link you can turn off at any time. Find it under Account, Friends and groups. Sharing tasks with them comes next."],
];
const FUTURE_UPDATES = [ // [status, title, detail]
  ["Planned", "Shared lists", "Share a list with family or a team using an invite link or code, with view-only or edit access."],
  ["Planned", "Share with people and groups", "Send selected tasks straight to a friend or group inside the app, with view or comment access."],
  ["Planned", "Shared tasks you can edit", "Share a task with a friend or group so they can tick, add and update steps, with an activity log and an owner-only alarm."],
  ["Planned", "Comments and notifications", "Discuss a shared task in comments, get push notifications for changes and remove someone's access at any time."],
  ["Planned", "Notices and announcements", "Group admins post notices that reach members by notification and email, with read receipts."],
  ["Planned", "More snooze choices", "Snooze from the notification until tomorrow or next week."],
  ["Planned", "Flexible repeat schedules", "Repeat on chosen weekdays, monthly or every few days, with an end date."],
  ["Planned", "Focus timer", "A built-in Pomodoro timer linked to a task, with a daily focus-time total."],
  ["Planned", "Command palette", "Press Ctrl+K to search, jump to a view or run any action from the keyboard."],
  ["Planned", "Home screen shortcuts", "Jump straight to Today or a new task from the app icon."],
  ["Idea", "Calendar sync", "Export tasks with due dates to Google Calendar, Outlook or Apple Calendar (.ics)."],
  ["Idea", "Voice quick add", "Dictate a task and let the quick-add parser pick up the date, time and tags."],
  ["Idea", "Photo gallery", "A shared photo gallery for a group, with reactions and comments."],
  ["Idea", "Birthday and event reminders", "A yearly reminder for birthdays and anniversaries, with a gentle heads-up the day before."],
  ["Idea", "Crash reports dashboard", "See errors from all devices in one place."],
];
const fmtDate = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
function renderHistory(tab) {
  const t = tab === 'future' ? 'future' : 'history';
  $$('#history [data-htab]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.htab === t)));
  $('#hist-intro').textContent = t === 'history'
    ? `${UPDATE_HISTORY.length} updates since the project started, oldest first.`
    : 'What is coming next. Plans can change.';
  $('#hist-body').innerHTML = t === 'history'
    ? `<ol class="hist-list">${UPDATE_HISTORY.map(([d, ti, de]) => `<li><span class="hist-date">${esc(fmtDate(d))}</span><div><b>${esc(ti)}</b><span>${esc(de)}</span></div></li>`).join('')}</ol>`
    : `<ul class="fut-list">${FUTURE_UPDATES.map(([s, ti, de]) => `<li><span class="fut-status s-${esc(s.toLowerCase())}">${esc(s)}</span><div><b>${esc(ti)}</b><span>${esc(de)}</span></div></li>`).join('')}</ul>`;
}
function openHistory(tab) {
  renderHistory(tab); track('history-opened');
  const d = $('#history'); if (!d.open) d.showModal();
  $('#hist-body').scrollTop = 0;
}
$('#btn-history').addEventListener('click', () => { $('#account').close(); openHistory('history'); });
$('#btn-future').addEventListener('click', () => { $('#account').close(); openHistory('future'); });
$$('#history [data-htab]').forEach((b) => b.addEventListener('click', () => renderHistory(b.dataset.htab)));
$('#hist-ok').addEventListener('click', () => $('#history').close());

/* ---------- What's new (announcement shown once per update) ---------- */
const APP_UPDATE = { id: '2026-11-13-friends-groups', label: 'Latest update: 13 November 2026' };
function renderWhatsNew() {
  $('#wn-ver').textContent = APP_UPDATE.label;
  const since = '2026-10-15', days = new Map();
  UPDATE_HISTORY.filter(([d]) => d >= since).forEach(([d, t, de]) => { if (!days.has(d)) days.set(d, []); days.get(d).push([t, de]); });
  $('#wn-list').innerHTML = [...days.keys()].sort().reverse().map((d) => `<section class="wn-group"><h3>${esc(fmtDate(d))}</h3><ul>${
    days.get(d).map(([t, de]) => `<li><b>${esc(t)}</b><span>${esc(de)}</span></li>`).join('')}</ul></section>`).join('');
}
function openWhatsNew() {
  track('whatsnew-opened');
  renderWhatsNew();
  lsSet(LS.seenUpdate, APP_UPDATE.id);
  const d = $('#whatsnew'); if (!d.open) d.showModal();
}
$('#btn-whatsnew').addEventListener('click', () => { $('#account').close(); openWhatsNew(); });
$('#wn-ok').addEventListener('click', () => $('#whatsnew').close());
$('#wn-all').addEventListener('click', () => { $('#whatsnew').close(); openHistory('history'); });
function maybeShowWhatsNew() {
  const seen = lsGet(LS.seenUpdate, '');
  if (seen === APP_UPDATE.id) return;
  if (!seen && !state.tasks.length && !state.trash.length) { lsSet(LS.seenUpdate, APP_UPDATE.id); return; } // brand-new visitor: nothing to announce
  setTimeout(() => {
    if (document.querySelector('dialog[open], #auth-screen')) return; // not now: try again on the next visit
    openWhatsNew();
  }, 2500);
}

/* ---------- First-time tour (auto-runs once for new users; Account → Show tour) ---------- */
const TOUR_STEPS = [
  { title: 'Welcome to To-Do Pro', body: 'Take a 30-second tour of the essentials. You can skip it at any time.' },
  { sel: ['#quick-form'], title: 'Add a task in one line', body: 'Type a sentence such as “tomorrow 9am call mom @family” and press Enter. The date, time and tag are picked up for you.' },
  { sel: ['#btn-new-side', '#fab'], title: 'Open the full editor', body: 'Add notes, a checklist, photos, tags, a due date and a reminder. On a keyboard, press N.' },
  { sel: ['.sidebar .nav', '.tabbar'], title: 'Switch between views', body: 'See everything, only Today, what is Upcoming, or what you have Completed. Deleted tasks wait in Trash for 30 days.' },
  { sel: ['.search'], title: 'Find anything fast', body: 'Search titles, notes and tags. On a keyboard, press / to jump here.' },
  { sel: ['#rail'], title: 'Your focus panel', body: 'Track today’s progress, see what is up next and follow your weekly goal.' },
  { sel: ['.account-card', '.account-mini'], title: 'Reminders, sync and backup', body: 'Turn on reminders, sign in to keep every device in sync, or export a backup. You can reopen this tour from here at any time.' },
  { title: 'You are all set', body: 'Add your first task and the rest will follow. To see this tour again, open Account and choose Show tour.' },
];
const tourState = { i: 0, steps: [], root: null, auto: false, onKey: null, onResize: null, prevFocus: null };
const tourTarget = (sels) => {
  for (const q of sels || []) {
    const el = document.querySelector(q);
    if (el) { const r = el.getBoundingClientRect(); if (r.width > 4 && r.height > 4 && getComputedStyle(el).visibility !== 'hidden') return el; }
  }
  return null;
};
function tourPlace() {
  const root = tourState.root; if (!root) return;
  const step = tourState.steps[tourState.i], spot = root.querySelector('.tour-spot'), card = root.querySelector('.tour-card');
  const el = step.el, vw = window.innerWidth, vh = window.innerHeight, gap = 14;
  if (!el) { // centred step with no target
    spot.style.cssText = 'left:50%;top:50%;width:0;height:0';
    card.style.left = Math.max(12, (vw - card.offsetWidth) / 2) + 'px';
    card.style.top = Math.max(12, (vh - card.offsetHeight) / 2) + 'px';
    return;
  }
  const r = el.getBoundingClientRect(), pad = 6;
  spot.style.cssText = `left:${r.left - pad}px;top:${r.top - pad}px;width:${r.width + pad * 2}px;height:${r.height + pad * 2}px`;
  const cw = card.offsetWidth, ch = card.offsetHeight;
  const below = vh - r.bottom, above = r.top;
  let top = below >= ch + gap + pad || below >= above ? r.bottom + pad + gap : r.top - pad - gap - ch;
  if (top + ch > vh - 12 || top < 12) { // target is very large: float the card over its lower part
    top = Math.min(Math.max(12, r.bottom - ch - 16), vh - ch - 12);
  }
  let left = r.left + r.width / 2 - cw / 2;
  left = Math.min(Math.max(12, left), vw - cw - 12);
  card.style.left = left + 'px'; card.style.top = top + 'px';
}
function tourRender() {
  const { root, steps, i } = tourState, step = steps[i], last = i === steps.length - 1;
  step.el = tourTarget(step.sel);
  if (step.el) step.el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  root.querySelector('.tour-count').textContent = `Step ${i + 1} of ${steps.length}`;
  root.querySelector('.tour-title').textContent = step.title;
  root.querySelector('.tour-body').textContent = step.body;
  root.querySelector('.tour-dots').innerHTML = steps.map((_, k) => `<i class="${k === i ? 'on' : ''}"></i>`).join('');
  const back = root.querySelector('[data-tour=back]'), next = root.querySelector('[data-tour=next]'), skip = root.querySelector('[data-tour=skip]');
  back.hidden = i === 0; skip.hidden = last;
  next.textContent = last ? 'Start using the app' : (i === 0 ? 'Start tour' : 'Next');
  tourPlace(); next.focus({ preventScroll: true });
}
function tourStep(d) {
  const n = tourState.i + d; if (n < 0) return;
  if (n >= tourState.steps.length) return endTour(true);
  tourState.i = n; tourRender();
}
function endTour(finished) {
  const { root } = tourState; if (!root) return;
  lsSet(LS.tourDone, '1');
  track(finished ? 'tour-completed' : 'tour-skipped');
  document.removeEventListener('keydown', tourState.onKey, true);
  window.removeEventListener('resize', tourState.onResize);
  root.remove(); tourState.root = null;
  try { tourState.prevFocus && tourState.prevFocus.focus({ preventScroll: true }); } catch { /* ignore */ }
}
function startTour({ auto = false } = {}) {
  if (tourState.root) return;
  tourState.steps = TOUR_STEPS.map((s) => ({ ...s })).filter((s, k, a) => !s.sel || k === 0 || tourTarget(s.sel)); // skip steps whose target is not on screen
  tourState.i = 0; tourState.auto = auto; tourState.prevFocus = document.activeElement;
  const root = document.createElement('div');
  root.id = 'tour'; root.className = 'tour'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-labelledby', 'tour-title');
  root.innerHTML = `<div class="tour-spot" aria-hidden="true"></div>
    <div class="tour-card">
      <div class="tour-count" aria-live="polite"></div>
      <h2 class="tour-title" id="tour-title"></h2>
      <p class="tour-body"></p>
      <div class="tour-dots" aria-hidden="true"></div>
      <div class="tour-actions">
        <button type="button" class="btn btn-ghost sm" data-tour="skip">Skip tour</button>
        <span class="tour-gap"></span>
        <button type="button" class="btn btn-ghost sm" data-tour="back">Back</button>
        <button type="button" class="btn btn-primary sm" data-tour="next">Next</button>
      </div>
    </div>`;
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tour]'); if (!b) return;
    if (b.dataset.tour === 'next') tourStep(1); else if (b.dataset.tour === 'back') tourStep(-1); else endTour(false);
  });
  tourState.onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); endTour(false); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); tourStep(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); tourStep(-1); }
    else if (e.key === 'Tab') { // keep focus inside the tour card
      const f = [...root.querySelectorAll('button:not([hidden])')]; if (!f.length) return;
      const first = f[0], lastB = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); lastB.focus(); }
      else if (!e.shiftKey && document.activeElement === lastB) { e.preventDefault(); first.focus(); }
      else if (!root.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    } else { e.stopPropagation(); } // app shortcuts (N, /, Ctrl+P ...) stay off while the tour is open; buttons still activate
  };
  tourState.onResize = () => tourPlace();
  document.addEventListener('keydown', tourState.onKey, true);
  window.addEventListener('resize', tourState.onResize);
  document.body.appendChild(root); tourState.root = root;
  track('tour-started'); tourRender();
}
/* Friends and groups (loaded on demand) */
async function openSocial() {
  if (!cloudOn()) { toast('Sign in to use friends and groups.'); return; }
  $('#account').close();
  try {
    const m = await import('./social.js');
    await m.openSocial({ cloud, user: state.user, toast, track });
  } catch (e) { console.error(e); toast('Could not open friends and groups.'); }
}
$('#btn-social').addEventListener('click', openSocial);
/* ?friend=CODE and ?join=CODE links: remember them, open the panel once signed in */
(function captureDeepLink() {
  try {
    const q = new URLSearchParams(location.search), f = q.get('friend'), j = q.get('join');
    if (!f && !j) return;
    sessionStorage.setItem('tp-deeplink', JSON.stringify({ f, j }));
    history.replaceState(null, '', location.pathname + location.hash);
  } catch { /* ignore */ }
})();
function maybeOpenDeepLink() { try { if (sessionStorage.getItem('tp-deeplink') && cloudOn()) setTimeout(openSocial, 600); } catch { /* ignore */ } }
$('#btn-tour').addEventListener('click', () => { $('#account').close(); setTimeout(() => startTour(), 120); });
function maybeShowTour() {
  if (lsGet(LS.tourDone, '')) return;
  let tries = 0;
  const t = setInterval(() => {
    if (++tries > 30 || lsGet(LS.tourDone, '')) { clearInterval(t); return; }
    if (tries < 2 || document.querySelector('dialog[open], #auth-screen, #tour')) return; // wait for sign-in, sync and other dialogs
    clearInterval(t);
    if (state.tasks.length || state.trash.length) { lsSet(LS.tourDone, '1'); return; } // people who already use the app do not need it
    startTour({ auto: true });
  }, 1500);
}

/* ---------- Share or download the selected tasks (Select, then Share or Download) ---------- */
const shareAbs = (d) => new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const shareMeta = (t) => [
  t.completed ? 'Done' : '',
  t.date ? 'Due ' + shareAbs(t.date) : '',
  t.alarm ? 'Reminder ' + new Date(t.alarm).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '',
  t.priority === 'high' ? 'High priority' : '',
  (t.tags || []).map((g) => '#' + g).join(' '),
].filter(Boolean).join(' · ');
function shareText(list, detail) {
  const lines = [`To-Do Pro: ${list.length} task${list.length === 1 ? '' : 's'}`, ''];
  list.forEach((t, i) => {
    lines.push(`${i + 1}. ${t.title}`);
    const m = shareMeta(t); if (m) lines.push(`   ${m}`);
    if (detail) {
      (t.subtasks || []).forEach((x) => lines.push(`   ${x.done ? '[x]' : '[ ]'} ${x.text}`));
      if (t.notes) lines.push('   ' + t.notes.trim().replace(/\n+/g, '\n   ').slice(0, 600));
    }
    lines.push('');
  });
  lines.push('Made with To-Do Pro: ' + location.origin + location.pathname);
  return lines.join('\n');
}
function shareImage(list, detail) {
  const W = 900, P = 44, S = 2, TX = P + 38, TW = W - TX - P, MAXH = 7000;
  const F = (w, px) => `${w} ${px}px Inter, "Noto Sans Bengali", system-ui, -apple-system, "Segoe UI", sans-serif`;
  const cv = document.createElement('canvas'), ctx = cv.getContext('2d');
  const wrap = (txt, font, maxW, maxLines) => {
    ctx.font = font; const out = [];
    for (const para of String(txt).split('\n')) {
      let line = '';
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const test = line ? line + ' ' + word : word;
        if (ctx.measureText(test).width > maxW && line) { out.push(line); line = word; } else line = test;
      }
      out.push(line);
    }
    if (out.length > maxLines) { out.length = maxLines; out[maxLines - 1] = out[maxLines - 1].replace(/\s*\S*$/, '') + '…'; }
    return out;
  };
  const run = (draw) => {
    let y = P, shown = 0;
    const put = (s, font, color, x, lh) => { if (draw) { ctx.font = font; ctx.fillStyle = color; ctx.textBaseline = 'top'; ctx.fillText(s, x, y); } y += lh; };
    const box = (x, yy, done) => {
      if (!draw) return;
      ctx.lineWidth = 2; ctx.strokeStyle = done ? '#0d9488' : '#94a3b8'; ctx.fillStyle = done ? '#0d9488' : '#fff';
      ctx.beginPath(); ctx.roundRect(x, yy, 22, 22, 6); ctx.fill(); ctx.stroke();
      if (done) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.6; ctx.beginPath(); ctx.moveTo(x + 5, yy + 11.5); ctx.lineTo(x + 9.5, yy + 16); ctx.lineTo(x + 17, yy + 6.5); ctx.stroke(); }
    };
    put('To-Do Pro', F(700, 30), '#0f172a', P, 40);
    put(`${list.length} task${list.length === 1 ? '' : 's'} · ${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`, F(400, 16), '#64748b', P, 34);
    for (const t of list) {
      const titleL = wrap(t.title, F(600, 24), TW, 3), meta = shareMeta(t);
      const subs = detail ? (t.subtasks || []).slice(0, 12) : [];
      const noteL = detail && t.notes ? wrap(t.notes.trim().replace(/\n\s*\n+/g, '\n'), F(400, 17), TW, 6) : [];
      const h = 18 + titleL.length * 32 + (meta ? 28 : 0) + subs.length * 30 + (noteL.length ? 8 + noteL.length * 26 : 0) + 18;
      if (y + h > MAXH) break;
      if (draw) { ctx.fillStyle = '#e2e8f0'; ctx.fillRect(P, y, W - P * 2, 1); }
      y += 18; box(P, y + 3, t.completed);
      titleL.forEach((l) => put(l, F(600, 24), t.completed ? '#64748b' : '#0f172a', TX, 32));
      if (meta) put(meta, F(500, 15), '#0d9488', TX, 28);
      subs.forEach((x) => { if (draw) box(TX, y - 1, x.done); const l = wrap(x.text, F(400, 17), TW - 34, 1)[0] || ''; put(l, F(400, 17), x.done ? '#94a3b8' : '#334155', TX + 34, 30); });
      if (noteL.length) { y += 8; noteL.forEach((l) => put(l, F(400, 17), '#64748b', TX, 26)); }
      y += 18; shown++;
    }
    if (shown < list.length) put(`+ ${list.length - shown} more task${list.length - shown === 1 ? '' : 's'} not shown`, F(500, 15), '#64748b', P, 30);
    y += 6; put('Made with To-Do Pro', F(500, 14), '#94a3b8', P, 28);
    return y + P / 2;
  };
  const H = Math.ceil(run(false));
  cv.width = W * S; cv.height = H * S; ctx.scale(S, S);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
  run(true);
  return new Promise((res) => cv.toBlob(res, 'image/png'));
}
const shareState = { tab: 'send' };
function shareList() { return selTasks().sort(byOrder); }
function shareRefresh() {
  const list = shareList(), detail = $('#share-detail').checked, txt = shareText(list, detail);
  $('#share-sum').textContent = `${list.length} task${list.length === 1 ? '' : 's'} selected`;
  $('#share-title').textContent = `Share ${list.length} task${list.length === 1 ? '' : 's'}`;
  $('#share-text').value = txt;
  $('#share-note').textContent = 'Photos are not included in text. Use Download or Image to share a picture of the list.';
  $$('#share [data-stab]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.stab === shareState.tab)));
  $('#share-send').hidden = shareState.tab !== 'send'; $('#share-dl').hidden = shareState.tab !== 'download';
}
function openShare(tab) {
  if (!state.sel.size) return;
  shareState.tab = tab; $('#share-native').hidden = !navigator.share;
  track(tab === 'send' ? 'tasks-share-open' : 'tasks-download-open'); shareRefresh();
  const d = $('#share'); if (!d.open) d.showModal();
}
$('#bulk-share').addEventListener('click', () => openShare('send'));
$('#bulk-dl').addEventListener('click', () => openShare('download'));
$$('#share [data-stab]').forEach((b) => b.addEventListener('click', () => { shareState.tab = b.dataset.stab; shareRefresh(); }));
$('#share-detail').addEventListener('change', shareRefresh);
$('#share-native').addEventListener('click', async () => {
  track('tasks-share-native');
  try { await navigator.share({ title: 'To-Do Pro tasks', text: $('#share-text').value }); } catch { /* cancelled */ }
});
$('#share-wa').addEventListener('click', () => {
  track('tasks-share-whatsapp');
  window.open('https://wa.me/?text=' + encodeURIComponent($('#share-text').value.slice(0, 3500)), '_blank', 'noopener');
});
$('#share-mail').addEventListener('click', () => {
  track('tasks-share-email');
  const n = shareList().length;
  let body = $('#share-text').value; if (body.length > 1800) body = body.slice(0, 1800).replace(/\s+\S*$/, '') + '\n…';
  location.href = `mailto:?subject=${encodeURIComponent(`To-Do Pro: ${n} task${n === 1 ? '' : 's'}`)}&body=${encodeURIComponent(body)}`;
});
$('#share-copy').addEventListener('click', async () => {
  track('tasks-share-copy');
  const t = $('#share-text');
  try { await navigator.clipboard.writeText(t.value); } catch { t.select(); document.execCommand('copy'); }
  toast('Copied. Paste it into any chat or email.');
});
$$('#share [data-dl]').forEach((b) => b.addEventListener('click', async () => {
  const list = shareList(), detail = $('#share-detail').checked, kind = b.dataset.dl; track('tasks-download-' + kind);
  if (kind === 'csv') { downloadCsv(list, 'todo-pro-selected'); }
  else if (kind === 'json') { saveBlob(new Blob([JSON.stringify(list, null, 2)], { type: 'application/json' }), `todo-pro-selected-${todayStr()}.json`); toast(`Saved ${list.length} task${list.length === 1 ? '' : 's'}`); }
  else if (kind === 'image') {
    try { saveBlob(await shareImage(list, detail), `todo-pro-tasks-${todayStr()}.png`); toast('Image saved'); } catch { toast('Could not create the image on this device.'); }
  } else if (kind === 'pdf') {
    printSel = detail ? list : list.map((t) => ({ ...t, notes: '', subtasks: [] }));
    $('#share').close(); toast('In the print window, choose “Save as PDF”'); setTimeout(() => window.print(), 700);
  }
}));

boot();
maybeShowWhatsNew();
maybeShowTour();
