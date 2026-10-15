/* =====================================================
   To-Do Pro — app logic
   - Works offline & local-only out of the box
   - Syncs across devices when Firebase is configured (cloud.js)
   ===================================================== */

const LS = {
  local: 'tasks-pro',            // local-only task list (same key as the old version)
  cachePrefix: 'tasks-cache-',   // per-user mirror of cloud data for instant/offline start
  lastUid: 'tp-last-uid',
  theme: 'theme',
  view: 'tp-view',
  collapsed: 'tp-collapsed',
  alarmSecs: 'tp-alarm-secs',   // how long the reminder sound rings (0 = until dismissed)
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
  view: ['all', 'today', 'upcoming', 'done'].includes(lsGet(LS.view)) ? lsGet(LS.view) : 'all',
  search: '',
  editingId: null,
  user: null,            // signed-in user (cloud) or null
  sync: 'local',         // local | syncing | synced | offline | error
  syncDetail: '',
  collapsed: new Set(parseJSON(lsGet(LS.collapsed, '[]'), [])),
  justAdded: null,
};
let cloud = null;
let unsubscribe = null;
let installEvent = null;

function normalize(t, i = 0) {
  return {
    id: String(t.id ?? newId()),
    title: String(t.title ?? '').slice(0, 200),
    heading: String(t.heading ?? ''),
    notes: String(t.notes ?? ''),
    date: t.date || '',
    priority: ['low', 'medium', 'high'].includes(t.priority) ? t.priority : 'medium',
    completed: !!t.completed,
    completedAt: t.completedAt || null,
    createdAt: t.createdAt || new Date().toISOString(),
    updatedAt: Number(t.updatedAt) || Date.now(),
    order: typeof t.order === 'number' ? t.order : i,
    alarm: t.alarm || null,
    alarmRepeat: ['daily', 'weekly'].includes(t.alarmRepeat) ? t.alarmRepeat : 'none',
    alarmFired: !!t.alarmFired,
  };
}
const byOrder = (a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt);
const loadList = (key) => {
  const arr = parseJSON(lsGet(key, '[]'), []);
  return Array.isArray(arr) ? arr.map(normalize) : [];
};
const cacheKey = () => (state.user ? LS.cachePrefix + state.user.uid : LS.local);
const persist = () => lsSet(cacheKey(), JSON.stringify(state.tasks));
const cloudOn = () => !!(cloud && state.user);

/* ---------- mutations ---------- */
function upsert(task, { silent = false } = {}) {
  task.updatedAt = Date.now();
  const i = state.tasks.findIndex((t) => t.id === task.id);
  if (i >= 0) state.tasks[i] = task; else state.tasks.push(task);
  persist();
  if (cloudOn()) {
    setSync('syncing');
    cloud.save(state.user.uid, task).catch(onCloudError);
  }
  if (!silent) render();
}
function removeTask(id) {
  state.tasks = state.tasks.filter((t) => t.id !== id);
  persist();
  if (cloudOn()) {
    setSync('syncing');
    cloud.remove(state.user.uid, id).catch(onCloudError);
  }
  render();
}
function topOrder() {
  return state.tasks.length ? Math.min(...state.tasks.map((t) => t.order)) - 1 : 0;
}
function createTask(fields) {
  const t = normalize({ ...fields, id: newId(), order: topOrder(), createdAt: new Date().toISOString() });
  state.justAdded = t.id;
  upsert(t);
  return t;
}
function toggleComplete(id) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return;
  const was = { ...t };
  const copy = { ...t, completed: !t.completed };
  copy.completedAt = copy.completed ? new Date().toISOString() : null;
  upsert(copy);
  toast(copy.completed ? 'Task completed' : 'Marked as pending', { action: { label: 'Undo', fn: () => upsert(was) } });
}
function deleteWithUndo(id) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return;
  const backup = { ...t };
  removeTask(id);
  toast('Task deleted', { action: { label: 'Undo', fn: () => upsert(backup) } });
}

/* =====================================================
   THEME
   ===================================================== */
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  $('#theme-icon use').setAttribute('href', theme === 'dark' ? '#i-sun' : '#i-moon');
  $('#theme-icon').parentElement.setAttribute('aria-label', theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
  $('#meta-theme').setAttribute('content', theme === 'dark' ? '#0b0d12' : '#f5f6fb');
}
$('#btn-theme').addEventListener('click', () => {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  lsSet(LS.theme, next);
  applyTheme(next);
});

/* =====================================================
   RENDER
   ===================================================== */
const listEl = $('#list');
const VIEW_META = {
  all:      { title: 'All tasks',  empty: ['Nothing here yet', 'Add a task above to get started.'] },
  today:    { title: 'Today',      empty: ['You’re all clear', 'Nothing is due today. Enjoy your day!'] },
  upcoming: { title: 'Upcoming',   empty: ['Nothing upcoming', 'Tasks with a future due date show up here.'] },
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
  };

  let tasks, mode, title;
  if (q) {
    tasks = sorted.filter((t) => [t.title, t.notes, t.heading].some((x) => x.toLowerCase().includes(q)));
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
  } else {
    tasks = pending;
    mode = 'headings'; title = VIEW_META.all.title;
  }

  const groups = [];
  const bucket = new Map();
  const add = (key, label, extra = {}) => {
    if (!bucket.has(key)) { const g = { key, label, tasks: [], ...extra }; bucket.set(key, g); groups.push(g); }
    return bucket.get(key);
  };
  if (mode === 'headings' || mode === 'search') tasks.forEach((t) => add(t.heading, t.heading || 'General', { heading: t.heading }).tasks.push(t));
  else if (mode === 'dates') tasks.forEach((t) => add(t.date, dateLabel(t.date)).tasks.push(t));
  else add('', 'Completed').tasks = tasks;

  return { tasks, groups, counts, mode, title, td };
}

function taskHTML(t, td) {
  const overdue = !t.completed && t.date && t.date < td;
  const chips = [];
  if (t.date) {
    const cls = overdue ? 'overdue' : t.date === td ? 'today' : '';
    chips.push(`<span class="chip ${cls}">${icon('calendar')}${overdue ? 'Overdue · ' : ''}${esc(dateLabel(t.date))}</span>`);
  }
  if (t.alarm && !t.completed) {
    chips.push(`<span class="chip alarm">${icon('bell')}${esc(whenLabel(t.alarm))}${t.alarmRepeat !== 'none' ? ` ${icon('repeat')}${t.alarmRepeat}` : ''}</span>`);
  }
  return `
  <li class="task${t.completed ? ' done' : ''}${state.justAdded === t.id ? ' enter' : ''}" data-id="${esc(t.id)}" data-priority="${t.priority}" tabindex="0">
    <span class="grip" aria-hidden="true" title="Drag to reorder">${icon('grip')}</span>
    <button class="check" type="button" role="checkbox" aria-checked="${t.completed}" aria-label="${t.completed ? 'Mark as pending' : 'Mark as complete'}">${icon('check')}</button>
    <div class="t-body">
      <div class="t-title">${esc(t.title)}</div>
      ${t.notes ? `<div class="t-notes">${esc(t.notes)}</div>` : ''}
      ${chips.length ? `<div class="t-meta">${chips.join('')}</div>` : ''}
    </div>
    <div class="t-actions">
      <button class="icon-btn sm edit" type="button" aria-label="Edit task">${icon('pencil')}</button>
      <button class="icon-btn sm del" type="button" aria-label="Delete task">${icon('trash')}</button>
    </div>
  </li>`;
}

function render() {
  if (dragState) return; // never rebuild the list while dragging
  const { tasks, groups, counts, mode, title, td } = compute();

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
  $('#view-title').textContent = title;
  const subDate = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  $('#view-sub').textContent = state.search
    ? `${tasks.length} result${tasks.length === 1 ? '' : 's'} for “${state.search.trim()}”`
    : `${subDate} · ${tasks.length} task${tasks.length === 1 ? '' : 's'}`;

  // stats
  const total = state.tasks.length;
  const done = state.tasks.filter((t) => t.completed).length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  $('#stat-total').textContent = total;
  $('#stat-done').textContent = done;
  $('#pct').textContent = pct + '%';
  $('#ring').style.setProperty('--p', pct);

  // list
  const showHeads = (mode === 'headings' || mode === 'search') ? !(groups.length === 1 && groups[0].key === '') : mode === 'dates';
  const draggable = mode === 'headings';
  listEl.classList.toggle('no-drag', !draggable);
  listEl.innerHTML = groups.map((g) => {
    const collapsed = showHeads && state.collapsed.has(g.key || '__general');
    const body = `<ul class="group-list" data-heading="${esc(g.heading ?? '')}">${g.tasks.map((t) => taskHTML(t, td)).join('')}</ul>`;
    if (!showHeads) return `<section class="group">${body}</section>`;
    return `<section class="group${collapsed ? ' collapsed' : ''}" data-key="${esc(g.key || '__general')}">
      <button class="group-head" type="button" aria-expanded="${!collapsed}">${icon('chevron')}<span>${esc(g.label)}</span><span class="count">${g.tasks.length}</span></button>${body}</section>`;
  }).join('');
  state.justAdded = null;

  const empty = !tasks.length;
  $('#empty').hidden = !empty;
  if (empty) {
    const [t, s] = state.search ? ['No matches', 'Try a different search term.'] : VIEW_META[state.view].empty;
    $('#empty-title').textContent = t; $('#empty-sub').textContent = s;
  }

  renderReminders(counts);
}

/* ---------- list interactions (event delegation) ---------- */
listEl.addEventListener('click', (e) => {
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
  const id = li.dataset.id;
  if (e.target.closest('.check')) return toggleComplete(id);
  if (e.target.closest('.del')) return deleteWithUndo(id);
  if (e.target.closest('.grip')) return;
  openEditor(id);
});
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
  if (!grip || listEl.classList.contains('no-drag') || (e.pointerType === 'mouse' && e.button !== 0)) return;
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

/* quick add */
$('#quick-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('#q-title'); const title = input.value.trim();
  if (!title) { input.focus(); return; }
  createTask({ title, date: state.view === 'today' ? todayStr() : '' });
  input.value = ''; input.focus();
});
$('#q-more').addEventListener('click', () => { const v = $('#q-title').value.trim(); $('#q-title').value = ''; openEditor(null, { title: v }); });

/* =====================================================
   EDITOR (create / edit)
   ===================================================== */
const editor = $('#editor');
const F = {
  title: $('#f-title'), notes: $('#f-notes'), date: $('#f-date'), heading: $('#f-heading'),
  aDate: $('#f-alarm-date'), aTime: $('#f-alarm-time'), repeat: $('#f-repeat'),
};
let editPriority = 'medium';
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

  $('#editor-title').textContent = t ? 'Edit task' : 'New task';
  $('#f-save').textContent = t ? 'Save changes' : 'Add task';
  $('#f-delete').hidden = !t;
  F.title.value = v.title; F.notes.value = v.notes; F.date.value = v.date; F.heading.value = v.heading;
  setPriority(v.priority);
  if (v.alarm) { const d = new Date(v.alarm); F.aDate.value = ymd(d); F.aTime.value = hm(d); } else { F.aDate.value = ''; F.aTime.value = ''; }
  F.repeat.value = v.alarmRepeat || 'none';
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

$('#editor-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const title = F.title.value.trim();
  if (!title) { F.title.focus(); toast('Please enter a task title'); return; }

  let aDate = F.aDate.value, aTime = F.aTime.value;
  if (aDate && !aTime) aTime = '09:00';
  if (aTime && !aDate) aDate = todayStr();
  const alarm = aDate && aTime ? new Date(`${aDate}T${aTime}`).toISOString() : null;
  const repeat = alarm ? F.repeat.value : 'none';
  const base = {
    title, notes: F.notes.value.trim(), date: F.date.value, heading: F.heading.value.trim(),
    priority: editPriority, alarm, alarmRepeat: repeat,
  };

  if (state.editingId) {
    const t = state.tasks.find((x) => x.id === state.editingId);
    if (t) {
      const changed = t.alarm !== alarm;
      upsert({ ...t, ...base, alarmFired: changed ? false : t.alarmFired });
      toast('Task updated');
    }
  } else {
    createTask({ ...base, alarmFired: false });
    toast(alarm ? 'Task added with reminder' : 'Task added');
  }
  if (alarm) ensureNotifyPermission();
  editor.close();
});
$('#f-delete').addEventListener('click', () => { const id = state.editingId; editor.close(); if (id) deleteWithUndo(id); });
editor.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') $('#editor-form').requestSubmit(); });

['#btn-new-side', '#fab'].forEach((s) => $(s).addEventListener('click', () => openEditor(null)));

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
   ALARM ENGINE
   ===================================================== */
const alarmQueue = [];
let activeAlarm = null;
const popup = $('#alarm-popup');

function checkAlarms() {
  const now = Date.now();
  state.tasks.filter((t) => t.alarm && !t.completed && !t.alarmFired && new Date(t.alarm).getTime() <= now).forEach(fireAlarm);
}
function fireAlarm(task) {
  const next = { ...task };
  if (task.alarmRepeat === 'daily' || task.alarmRepeat === 'weekly') {
    const step = task.alarmRepeat === 'daily' ? 1 : 7;
    const d = new Date(task.alarm);
    do { d.setDate(d.getDate() + step); } while (d.getTime() <= Date.now());
    next.alarm = d.toISOString(); next.alarmFired = false;
  } else {
    next.alarmFired = true;
  }
  upsert(next);
  alarmQueue.push(task);
  if (!activeAlarm) showNextAlarm();
  notify(task);
}
function showNextAlarm() {
  activeAlarm = alarmQueue.shift() || null;
  if (!activeAlarm) { popup.hidden = true; return; }
  $('#alarm-title').textContent = activeAlarm.title;
  const n = $('#alarm-note'); n.textContent = activeAlarm.notes ? activeAlarm.notes.slice(0, 90) : ''; n.hidden = !activeAlarm.notes;
  popup.hidden = false;
  playAlarmSound();
}
const closeAlarm = () => { stopAlarmSound(); popup.hidden = true; activeAlarm = null; setTimeout(showNextAlarm, 400); };
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
  if (navigator.vibrate) navigator.vibrate(0);
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
}
function onCloudError(err) {
  console.error('Sync error', err);
  setSync('error', err?.message || String(err));
}
window.addEventListener('online', () => cloudOn() && setSync('syncing'));
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
    box.innerHTML = `<p>Sign in to sync your tasks across your phone, laptop and PC. Your existing local tasks will be uploaded automatically.</p>
      <button type="button" class="btn btn-google" id="btn-signin">${GOOGLE_SVG} Continue with Google</button>
      ${state.sync === 'error' ? `<div class="note">${esc(state.syncDetail)}</div>` : ''}`;
    $('#btn-signin').onclick = signInClick;
  } else {
    box.innerHTML = `<div class="acc-user"><span class="avatar">${u.photo ? `<img src="${esc(u.photo)}" alt="" referrerpolicy="no-referrer"/>` : esc((u.name || u.email)[0].toUpperCase())}</span>
      <div><strong>${esc(u.name || 'Signed in')}</strong><small>${esc(u.email)}</small></div></div>
      <div class="acc-status"><span class="sync-dot" data-s="${state.sync}"></span> ${SYNC_TEXT[state.sync]}</div>
      ${state.sync === 'error' ? `<div class="note">${esc(state.syncDetail)}</div>` : ''}
      <button type="button" class="btn btn-ghost" id="btn-signout">${icon('logout')} Sign out</button>`;
    $('#btn-signout').onclick = async () => { await cloud.logout(); toast('Signed out'); };
  }
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  $('#install-section').hidden = standalone || (!installEvent && !isIOS);
  $('#install-text').textContent = installEvent ? 'Install To-Do Pro as an app on this device.' : 'On iPhone/iPad: tap the Share button, then “Add to Home Screen”.';
}
async function signInClick() {
  try { await cloud.signIn(); }
  catch (e) {
    const msg = e.code === 'auth/unauthorized-domain' ? 'This domain is not authorized in Firebase → Authentication → Settings → Authorized domains.' : (e.message || String(e));
    setSync('error', msg); toast('Sign-in failed'); renderAccount();
  }
}
$$('[data-open-account]').forEach((b) => b.addEventListener('click', () => { renderAccount(); $('#account').showModal(); }));

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
$('#btn-export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(state.tasks, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = `todo-pro-backup-${todayStr()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});
$('#btn-import').addEventListener('click', () => $('#import-file').click());
$('#import-file').addEventListener('change', async (e) => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    const arr = Array.isArray(data) ? data : data.tasks;
    if (!Array.isArray(arr)) throw new Error('bad file');
    const list = arr.filter((t) => t && t.title).map((t, i) => normalize(t, i));
    list.forEach((t) => upsert(t, { silent: true }));
    render(); toast(`Imported ${list.length} task${list.length === 1 ? '' : 's'}`);
  } catch { toast('That file could not be imported'); }
});

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

async function handleAuth(user) {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  if (!user) {
    state.user = null; lsSet(LS.lastUid, '');
    state.tasks = loadList(LS.local);
    renderAvatar(); setSync('local'); render();
    return;
  }
  state.user = user; lsSet(LS.lastUid, user.uid);
  state.tasks = loadList(cacheKey());
  renderAvatar(); setSync('syncing'); render();

  // First sign-in on this device: upload any local-only tasks, keep a backup copy
  const local = loadList(LS.local);
  if (local.length) {
    const backup = lsGet(LS.local);
    lsSet('tasks-pro-uploaded-backup', backup);
    lsSet(LS.local, '[]');
    cloud.saveMany(user.uid, local).then(() => toast(`${local.length} local task${local.length === 1 ? '' : 's'} uploaded to your account`)).catch((e) => {
      lsSet(LS.local, backup); onCloudError(e);
    });
  }

  unsubscribe = cloud.subscribe(user.uid, (docs, meta) => {
    state.tasks = docs.map((d, i) => normalize(d, i));
    persist();
    setSync(!navigator.onLine ? 'offline' : meta.hasPendingWrites || meta.fromCache ? 'syncing' : 'synced');
    render(); checkAlarms();
  }, onCloudError);
}

/* =====================================================
   SHORTCUTS
   ===================================================== */
document.addEventListener('keydown', (e) => {
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
  applyTheme(document.documentElement.getAttribute('data-theme') || 'dark');
  const lastUid = lsGet(LS.lastUid, '');
  state.tasks = loadList(window.FIREBASE_CONFIG?.apiKey && lastUid ? LS.cachePrefix + lastUid : LS.local);
  renderAvatar();
  render();
  checkAlarms();
  setInterval(() => { checkAlarms(); if (!document.hidden && !dragState && !document.querySelector('dialog[open]')) render(); }, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { checkAlarms(); render(); } });
  initCloud();

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW registration failed', e));
  }
  if (new URLSearchParams(location.search).get('action') === 'new') { openEditor(null); history.replaceState(null, '', location.pathname); }
}
boot();