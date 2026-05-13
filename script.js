/* ================================================================
   TO-DO APP PRO — script.js
   Vanilla JS · localStorage · Drag & Drop · Keyboard Shortcuts
   ✦ New: task heading, notes/paragraph, multi-line support
   ================================================================ */

'use strict';

// ——— State ———
let tasks         = [];
let currentFilter = 'all';
let searchQuery   = '';
let editingId     = null;
let selectedId    = null;
let addPriority   = 'medium';
let editPriority  = 'medium';
let dragSrcIdx    = null;

// ——— DOM References ———
const taskList          = document.getElementById('task-list');
const taskInput         = document.getElementById('task-input');
const taskHeadingInput  = document.getElementById('task-heading');   // ✦ NEW
const taskNotesInput    = document.getElementById('task-notes');     // ✦ NEW
const taskDateInput     = document.getElementById('task-date');
const addBtn            = document.getElementById('add-btn');
const searchInput       = document.getElementById('search-input');
const clearSearchBtn    = document.getElementById('clear-search');
const filterTabs        = document.querySelectorAll('.filter-tab');
const clearCompletedBtn = document.getElementById('clear-completed-btn');
const emptyState        = document.getElementById('empty-state');
const themeToggle       = document.getElementById('theme-toggle');
const themeIcon         = document.getElementById('theme-icon');
const statTotal         = document.getElementById('stat-total');
const statCompleted     = document.getElementById('stat-completed');
const statPending       = document.getElementById('stat-pending');
const progressFill      = document.getElementById('progress-fill');
const progressPct       = document.getElementById('progress-pct');
const modalOverlay      = document.getElementById('modal-overlay');
const editInput         = document.getElementById('edit-input');
const editHeadingInput  = document.getElementById('edit-heading');   // ✦ NEW
const editNotesInput    = document.getElementById('edit-notes');     // ✦ NEW
const editDateInput     = document.getElementById('edit-date');
const editPriorityBtns  = document.getElementById('edit-priority-btns');
const modalClose        = document.getElementById('modal-close');
const modalCancel       = document.getElementById('modal-cancel');
const modalSave         = document.getElementById('modal-save');
const toastContainer    = document.getElementById('toast-container');
const headerDate        = document.getElementById('header-date');
const addPriorityBtns   = document.querySelectorAll('.add-panel .priority-btn');

// ================================================================
//  INITIALISATION
// ================================================================
function init() {
  loadFromStorage();
  applyStoredTheme();
  renderDateHeader();
  bindEvents();
  renderAll();
}

// ================================================================
//  STORAGE
// ================================================================
function loadFromStorage() {
  try {
    const stored = localStorage.getItem('tdp_tasks');
    tasks = stored ? JSON.parse(stored) : getSampleTasks();
  } catch {
    tasks = getSampleTasks();
  }
}

function saveToStorage() {
  localStorage.setItem('tdp_tasks', JSON.stringify(tasks));
}

function getSampleTasks() {
  const today = new Date().toISOString().split('T')[0];
  return [
    {
      id: uid(), title: 'Review project requirements', completed: false,
      priority: 'high', dueDate: today, createdAt: Date.now(),
      heading: 'Planning',                                          // ✦ NEW
      notes: 'Check the client brief carefully.\nNote any blockers before the standup.' // ✦ NEW
    },
    {
      id: uid(), title: 'Design the UI wireframes', completed: true,
      priority: 'medium', dueDate: '', createdAt: Date.now() - 1000,
      heading: '', notes: ''
    },
    {
      id: uid(), title: 'Set up project repository', completed: false,
      priority: 'low', dueDate: '', createdAt: Date.now() - 2000,
      heading: 'Dev Setup',
      notes: 'Use the standard folder structure.\nAdd a README and .gitignore on day one.'
    },
  ];
}

// ================================================================
//  UTILITY
// ================================================================
function uid() {
  return Math.random().toString(36).slice(2, 11) + Date.now().toString(36);
}

function formatDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function isOverdue(iso) {
  if (!iso) return false;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return new Date(iso) < today;
}

function renderDateHeader() {
  headerDate.textContent = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
  });
}

// ================================================================
//  THEME
// ================================================================
function applyStoredTheme() {
  const stored = localStorage.getItem('tdp_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', stored);
  themeIcon.className = stored === 'dark' ? 'fa-solid fa-moon' : 'fa-solid fa-sun';
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  themeIcon.className = next === 'dark' ? 'fa-solid fa-moon' : 'fa-solid fa-sun';
  localStorage.setItem('tdp_theme', next);
  toast(next === 'light' ? 'Light mode on ☀️' : 'Dark mode on 🌙', 'info');
}

// ================================================================
//  TOAST NOTIFICATIONS
// ================================================================
function toast(message, type = 'info', duration = 2800) {
  const icons = { success: 'fa-circle-check', error: 'fa-circle-xmark', info: 'fa-circle-info', warning: 'fa-triangle-exclamation' };
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `<i class="fa-solid ${icons[type] || icons.info}"></i><span>${message}</span>`;
  toastContainer.appendChild(el);
  setTimeout(() => {
    el.classList.add('removing');
    setTimeout(() => el.remove(), 280);
  }, duration);
}

// ================================================================
//  STATS & PROGRESS
// ================================================================
function updateStats() {
  const total     = tasks.length;
  const completed = tasks.filter(t => t.completed).length;
  const pending   = total - completed;
  const pct       = total > 0 ? Math.round((completed / total) * 100) : 0;
  statTotal.textContent     = total;
  statCompleted.textContent = completed;
  statPending.textContent   = pending;
  progressFill.style.width  = pct + '%';
  progressPct.textContent   = pct + '%';
}

// ================================================================
//  RENDER
// ================================================================
function getFilteredTasks() {
  return tasks.filter(t => {
    const matchFilter =
      currentFilter === 'all'       ? true :
      currentFilter === 'completed' ? t.completed : !t.completed;
    const q = searchQuery.toLowerCase().trim();
    // ✦ Also search through heading and notes
    const matchSearch = !q ||
      t.title.toLowerCase().includes(q) ||
      (t.heading && t.heading.toLowerCase().includes(q)) ||
      (t.notes  && t.notes.toLowerCase().includes(q));
    return matchFilter && matchSearch;
  });
}

function renderAll() {
  const filtered = getFilteredTasks();
  taskList.innerHTML = '';
  if (filtered.length === 0) {
    emptyState.classList.add('visible');
    emptyState.setAttribute('aria-hidden', 'false');
  } else {
    emptyState.classList.remove('visible');
    emptyState.setAttribute('aria-hidden', 'true');
    filtered.forEach(task => taskList.appendChild(buildTaskEl(task)));
    bindDragEvents();
  }
  updateStats();
}

// ================================================================
//  BUILD TASK ELEMENT
// ================================================================
function buildTaskEl(task) {
  const li = document.createElement('li');
  li.className = `task-item${task.completed ? ' completed' : ''}`;
  li.dataset.id       = task.id;
  li.dataset.priority = task.priority;
  li.draggable        = true;
  li.setAttribute('tabindex', '0');
  li.setAttribute('aria-label', `Task: ${task.title}`);

  const overdue = !task.completed && isOverdue(task.dueDate);

  // ✦ Heading block — only rendered if heading exists
  const headingHtml = task.heading
    ? `<div class="task-heading">
         <i class="fa-solid fa-heading"></i>${escHtml(task.heading)}
       </div>`
    : '';

  // ✦ Notes block — only rendered if notes exist
  //   Long notes get an expand/collapse toggle
  const NOTES_LIMIT = 160; // characters before truncating
  let notesHtml = '';
  if (task.notes && task.notes.trim()) {
    const isLong = task.notes.length > NOTES_LIMIT;
    notesHtml = `
      <div class="task-notes${isLong ? ' overflowing' : ''}" id="notes-${task.id}">${escHtml(task.notes)}</div>
      ${isLong
        ? `<button class="notes-toggle" data-notes-id="${task.id}" aria-expanded="false">
             <i class="fa-solid fa-chevron-down"></i> Show more
           </button>`
        : ''}
    `;
  }

  li.innerHTML = `
    <span class="drag-handle" aria-hidden="true">
      <i class="fa-solid fa-grip-vertical"></i>
    </span>
    <input
      type="checkbox"
      class="task-check"
      ${task.completed ? 'checked' : ''}
      aria-label="Mark ${task.completed ? 'incomplete' : 'complete'}"
    />
    <div class="task-body">
      ${headingHtml}
      <span class="task-title">${escHtml(task.title)}</span>
      ${notesHtml}
      <div class="task-meta">
        ${task.priority ? `<span class="task-badge badge-${task.priority}"><i class="fa-solid fa-flag"></i>${task.priority}</span>` : ''}
        ${task.dueDate  ? `<span class="task-due${overdue ? ' overdue' : ''}">
          <i class="fa-regular fa-calendar"></i>${overdue ? 'Overdue · ' : ''}${formatDate(task.dueDate)}
        </span>` : ''}
      </div>
    </div>
    <div class="task-actions">
      <button class="action-btn edit"   title="Edit task (E)"   aria-label="Edit task">  <i class="fa-solid fa-pen"></i></button>
      <button class="action-btn delete" title="Delete task (Del)" aria-label="Delete task"><i class="fa-solid fa-trash"></i></button>
    </div>
  `;

  // ✦ Notes expand/collapse
  const toggle = li.querySelector('.notes-toggle');
  if (toggle) {
    toggle.addEventListener('click', () => {
      const notesEl = li.querySelector('.task-notes');
      const expanded = notesEl.classList.toggle('expanded');
      toggle.setAttribute('aria-expanded', expanded);
      toggle.innerHTML = expanded
        ? '<i class="fa-solid fa-chevron-up"></i> Show less'
        : '<i class="fa-solid fa-chevron-down"></i> Show more';
    });
  }

  // Checkbox toggle
  li.querySelector('.task-check').addEventListener('change', () => toggleComplete(task.id));
  // Edit
  li.querySelector('.action-btn.edit').addEventListener('click', () => openEditModal(task.id));
  // Delete
  li.querySelector('.action-btn.delete').addEventListener('click', () => deleteTask(task.id, li));
  // Keyboard select
  li.addEventListener('click', () => { selectedId = task.id; });
  li.addEventListener('keydown', e => {
    if (e.key === 'e' || e.key === 'E') openEditModal(task.id);
    if (e.key === 'Delete') deleteTask(task.id, li);
    if (e.key === 'Enter' || e.key === ' ') toggleComplete(task.id);
  });

  return li;
}

function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ================================================================
//  TASK CRUD
// ================================================================
function addTask() {
  const title = taskInput.value.trim();
  if (!title) {
    taskInput.classList.add('shake');
    taskInput.addEventListener('animationend', () => taskInput.classList.remove('shake'), { once: true });
    toast('Please enter a task title!', 'warning');
    taskInput.focus();
    return;
  }

  const task = {
    id:        uid(),
    title,
    heading:   taskHeadingInput.value.trim(),   // ✦ NEW
    notes:     taskNotesInput.value,             // ✦ NEW (preserve line breaks)
    completed: false,
    priority:  addPriority,
    dueDate:   taskDateInput.value,
    createdAt: Date.now(),
  };

  tasks.unshift(task);
  saveToStorage();

  // Clear all inputs
  taskInput.value        = '';
  taskHeadingInput.value = '';   // ✦ NEW
  taskNotesInput.value   = '';   // ✦ NEW
  taskDateInput.value    = '';

  renderAll();
  toast('Task added! 🎯', 'success');
  taskInput.focus();
}

function toggleComplete(id) {
  const t = tasks.find(t => t.id === id);
  if (!t) return;
  t.completed = !t.completed;
  saveToStorage();
  renderAll();
  toast(t.completed ? 'Task completed! ✅' : 'Marked as pending.', t.completed ? 'success' : 'info');
}

function deleteTask(id, el) {
  el.classList.add('removing');
  setTimeout(() => {
    tasks = tasks.filter(t => t.id !== id);
    saveToStorage();
    renderAll();
    if (selectedId === id) selectedId = null;
  }, 260);
  toast('Task deleted.', 'error');
}

function clearCompleted() {
  const count = tasks.filter(t => t.completed).length;
  if (count === 0) { toast('No completed tasks to clear.', 'info'); return; }
  tasks = tasks.filter(t => !t.completed);
  saveToStorage();
  renderAll();
  toast(`Cleared ${count} completed task${count > 1 ? 's' : ''}.`, 'success');
}

// ================================================================
//  EDIT MODAL
// ================================================================
function openEditModal(id) {
  const task = tasks.find(t => t.id === id);
  if (!task) return;
  editingId              = id;
  editInput.value        = task.title;
  editHeadingInput.value = task.heading || '';   // ✦ NEW
  editNotesInput.value   = task.notes   || '';   // ✦ NEW
  editDateInput.value    = task.dueDate || '';
  editPriority           = task.priority || 'medium';
  setActivePriority(editPriorityBtns.querySelectorAll('.priority-btn'), editPriority);
  modalOverlay.style.display = 'flex';
  setTimeout(() => editInput.focus(), 50);
}

function closeEditModal() {
  modalOverlay.style.display = 'none';
  editingId = null;
  editInput.value        = '';
  editHeadingInput.value = '';   // ✦ NEW
  editNotesInput.value   = '';   // ✦ NEW
}

function saveEdit() {
  const title = editInput.value.trim();
  if (!title) { toast('Title cannot be empty!', 'warning'); editInput.focus(); return; }
  const task = tasks.find(t => t.id === editingId);
  if (!task) return;
  task.title   = title;
  task.heading = editHeadingInput.value.trim();   // ✦ NEW
  task.notes   = editNotesInput.value;             // ✦ NEW
  task.dueDate = editDateInput.value;
  task.priority = editPriority;
  saveToStorage();
  renderAll();
  closeEditModal();
  toast('Task updated! ✏️', 'success');
}

// ================================================================
//  PRIORITY BUTTONS
// ================================================================
function setActivePriority(btns, value) {
  btns.forEach(b => {
    const active = b.dataset.priority === value;
    b.classList.toggle('active', active);
    b.setAttribute('aria-pressed', active);
  });
}

function bindPriorityBtns(btns, onChange) {
  btns.forEach(btn => {
    btn.addEventListener('click', () => {
      const p = btn.dataset.priority;
      onChange(p);
      setActivePriority(btns, p);
    });
  });
}

// ================================================================
//  FILTER & SEARCH
// ================================================================
function setFilter(filter) {
  currentFilter = filter;
  filterTabs.forEach(t => {
    const active = t.dataset.filter === filter;
    t.classList.toggle('active', active);
    t.setAttribute('aria-selected', active);
  });
  renderAll();
}

// ================================================================
//  DRAG & DROP
// ================================================================
function bindDragEvents() {
  const items = taskList.querySelectorAll('.task-item');
  items.forEach((item, idx) => {
    item.addEventListener('dragstart', e => {
      dragSrcIdx = idx;
      item.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', idx);
    });
    item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
      taskList.querySelectorAll('.task-item').forEach(i => i.classList.remove('drag-over'));
    });
    item.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      taskList.querySelectorAll('.task-item').forEach(i => i.classList.remove('drag-over'));
      item.classList.add('drag-over');
    });
    item.addEventListener('dragleave', () => item.classList.remove('drag-over'));
    item.addEventListener('drop', e => {
      e.preventDefault();
      item.classList.remove('drag-over');
      const targetIdx = idx;
      if (dragSrcIdx === null || dragSrcIdx === targetIdx) return;
      const filtered = getFilteredTasks();
      const srcTask  = filtered[dragSrcIdx];
      const tgtTask  = filtered[targetIdx];
      const srcReal  = tasks.findIndex(t => t.id === srcTask.id);
      const tgtReal  = tasks.findIndex(t => t.id === tgtTask.id);
      tasks.splice(srcReal, 1);
      tasks.splice(tgtReal, 0, srcTask);
      saveToStorage();
      renderAll();
      dragSrcIdx = null;
    });
  });
}

// ================================================================
//  KEYBOARD SHORTCUTS
// ================================================================
function handleGlobalKeys(e) {
  if (e.ctrlKey && e.key === 'n') { e.preventDefault(); taskInput.focus(); }
  if (e.ctrlKey && e.key === 'k') { e.preventDefault(); searchInput.focus(); }
  if (e.key === 'Escape') {
    if (modalOverlay.style.display === 'flex') closeEditModal();
    else document.activeElement?.blur();
  }
  if (e.key === 'Delete' && !['INPUT','TEXTAREA'].includes(document.activeElement.tagName)) {
    if (selectedId) {
      const el = taskList.querySelector(`[data-id="${selectedId}"]`);
      if (el) deleteTask(selectedId, el);
    }
  }
}

// ================================================================
//  EVENT BINDING
// ================================================================
function bindEvents() {
  // Add task — Enter in title input (but NOT in notes textarea — Shift+Enter is newline there)
  addBtn.addEventListener('click', addTask);
  taskInput.addEventListener('keydown', e => { if (e.key === 'Enter') addTask(); });
  // ✦ NEW: notes textarea — Enter = new line naturally, no submit
  //        but if user somehow wants submit via keyboard, they use the button
  taskNotesInput.addEventListener('keydown', e => {
    // Ctrl+Enter submits from anywhere in the form
    if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); addTask(); }
  });

  themeToggle.addEventListener('click', toggleTheme);
  bindPriorityBtns(addPriorityBtns, p => { addPriority = p; });
  bindPriorityBtns(editPriorityBtns.querySelectorAll('.priority-btn'), p => { editPriority = p; });

  filterTabs.forEach(tab => tab.addEventListener('click', () => setFilter(tab.dataset.filter)));

  searchInput.addEventListener('input', () => {
    searchQuery = searchInput.value;
    clearSearchBtn.style.display = searchQuery ? 'block' : 'none';
    renderAll();
  });
  clearSearchBtn.addEventListener('click', () => {
    searchInput.value = ''; searchQuery = '';
    clearSearchBtn.style.display = 'none';
    renderAll(); searchInput.focus();
  });

  clearCompletedBtn.addEventListener('click', clearCompleted);

  modalClose.addEventListener('click', closeEditModal);
  modalCancel.addEventListener('click', closeEditModal);
  modalSave.addEventListener('click', saveEdit);
  editInput.addEventListener('keydown', e => { if (e.key === 'Enter') saveEdit(); });
  // ✦ NEW: Ctrl+Enter also saves from the edit notes textarea
  editNotesInput.addEventListener('keydown', e => {
    if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); saveEdit(); }
  });
  modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) closeEditModal(); });

  document.addEventListener('keydown', handleGlobalKeys);
}

// ================================================================
//  Shake animation (inline)
// ================================================================
const shakeStyle = document.createElement('style');
shakeStyle.textContent = `
  @keyframes shake {
    0%, 100% { transform: translateX(0); }
    20%       { transform: translateX(-6px); }
    40%       { transform: translateX(6px); }
    60%       { transform: translateX(-4px); }
    80%       { transform: translateX(4px); }
  }
  .shake { animation: shake 0.35s ease; border-color: var(--red) !important; box-shadow: 0 0 0 3px var(--red-soft) !important; }
`;
document.head.appendChild(shakeStyle);

// ================================================================
//  BOOT
// ================================================================
init();