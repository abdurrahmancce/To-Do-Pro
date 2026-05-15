/* =============================================
   TO-DO PRO — script.js (with Alarm System)
   ============================================= */

// ─── STATE ────────────────────────────────────
let tasks = JSON.parse(localStorage.getItem('tasks-pro') || '[]');
let filter = 'all';
let searchQuery = '';
let selectedTaskId = null;
let editingTaskId = null;
let selectedPriority = 'medium';
let dragSrcIndex = null;

// Alarm state
let alarmQueue = [];      // fired alarms waiting to display
let activeAlarm = null;   // alarm currently shown in popup
let snoozeTimers = {};    // taskId -> snoozeTimeout

// ─── DOM REFS ──────────────────────────────────
const taskList       = document.getElementById('task-list');
const taskInput      = document.getElementById('task-input');
const taskHeading    = document.getElementById('task-heading');
const taskNotes      = document.getElementById('task-notes');
const taskDate       = document.getElementById('task-date');
const taskAlarmDate  = document.getElementById('task-alarm-date');
const taskAlarmTime  = document.getElementById('task-alarm-time');
const taskAlarmRepeat= document.getElementById('task-alarm-repeat');
const addBtn         = document.getElementById('add-btn');
const emptyState     = document.getElementById('empty-state');
const statTotal      = document.getElementById('stat-total');
const statCompleted  = document.getElementById('stat-completed');
const statPending    = document.getElementById('stat-pending');
const progressFill   = document.getElementById('progress-fill');
const progressPct    = document.getElementById('progress-pct');
const searchInput    = document.getElementById('search-input');
const clearSearch    = document.getElementById('clear-search');
const clearCompletedBtn = document.getElementById('clear-completed-btn');
const filterTabs     = document.querySelectorAll('.filter-tab');
const priorityBtns   = document.querySelectorAll('.add-panel .priority-btn');
const themeToggle    = document.getElementById('theme-toggle');
const themeIcon      = document.getElementById('theme-icon');
const modalOverlay   = document.getElementById('modal-overlay');
const editInput      = document.getElementById('edit-input');
const editHeading    = document.getElementById('edit-heading');
const editNotes      = document.getElementById('edit-notes');
const editDate       = document.getElementById('edit-date');
const editAlarmDate  = document.getElementById('edit-alarm-date');
const editAlarmTime  = document.getElementById('edit-alarm-time');
const editAlarmRepeat= document.getElementById('edit-alarm-repeat');
const modalSave      = document.getElementById('modal-save');
const modalCancel    = document.getElementById('modal-cancel');
const modalClose     = document.getElementById('modal-close');
const headerDate     = document.getElementById('header-date');

// Alarm UI
const alarmPopup      = document.getElementById('alarm-popup');
const alarmPopupTask  = document.getElementById('alarm-popup-task');
const alarmPopupNote  = document.getElementById('alarm-popup-note');
const alarmSnoozeBtn  = document.getElementById('alarm-snooze-btn');
const alarmDismissBtn = document.getElementById('alarm-dismiss-btn');
const alarmBadge      = document.getElementById('alarm-badge');
const alarmPanelToggle= document.getElementById('alarm-panel-toggle');
const alarmPanel      = document.getElementById('alarm-panel');
const alarmPanelClose = document.getElementById('alarm-panel-close');
const alarmListEl     = document.getElementById('alarm-list');

// ─── INIT ──────────────────────────────────────
function init() {
  renderHeaderDate();
  loadTheme();
  renderTasks();
  updateStats();
  renderAlarmPanel();
  startAlarmEngine();
  requestNotificationPermission();
}

function renderHeaderDate() {
  const now = new Date();
  headerDate.textContent = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

// ─── THEME ─────────────────────────────────────
function loadTheme() {
  const saved = localStorage.getItem('theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
  themeIcon.className = saved === 'dark' ? 'fa-solid fa-moon' : 'fa-solid fa-sun';
}
themeToggle.addEventListener('click', () => {
  const cur = document.documentElement.getAttribute('data-theme');
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
  themeIcon.className = next === 'dark' ? 'fa-solid fa-moon' : 'fa-solid fa-sun';
});

// ─── SAVE ──────────────────────────────────────
function saveTasks() {
  localStorage.setItem('tasks-pro', JSON.stringify(tasks));
}

// ─── ADD TASK ──────────────────────────────────
function getSelectedPriority() { return selectedPriority; }

function addTask() {
  const title = taskInput.value.trim();
  if (!title) { taskInput.focus(); showToast('Please enter a task title.'); return; }

  const alarmDateVal = taskAlarmDate.value;
  const alarmTimeVal = taskAlarmTime.value;
  let alarmISO = null;
  if (alarmDateVal && alarmTimeVal) {
    alarmISO = new Date(`${alarmDateVal}T${alarmTimeVal}`).toISOString();
  }

  const task = {
    id: Date.now().toString(),
    title,
    heading: taskHeading.value.trim(),
    notes: taskNotes.value.trim(),
    date: taskDate.value,
    priority: getSelectedPriority(),
    completed: false,
    createdAt: new Date().toISOString(),
    alarm: alarmISO,
    alarmRepeat: alarmDateVal && alarmTimeVal ? taskAlarmRepeat.value : 'none',
    alarmFired: false,
  };

  tasks.unshift(task);
  saveTasks();
  renderTasks();
  updateStats();
  renderAlarmPanel();
  showToast(`Task added${alarmISO ? ' with reminder 🔔' : ''}!`);

  // Reset
  taskInput.value = '';
  taskHeading.value = '';
  taskNotes.value = '';
  taskDate.value = '';
  taskAlarmDate.value = '';
  taskAlarmTime.value = '';
  taskAlarmRepeat.value = 'none';
  taskInput.focus();
}

addBtn.addEventListener('click', addTask);
taskInput.addEventListener('keydown', e => { if (e.key === 'Enter') addTask(); });
taskNotes.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addTask(); } });

// Priority buttons
priorityBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    priorityBtns.forEach(b => { b.classList.remove('active'); b.setAttribute('aria-pressed', 'false'); });
    btn.classList.add('active');
    btn.setAttribute('aria-pressed', 'true');
    selectedPriority = btn.dataset.priority;
  });
});

// ─── RENDER TASKS ──────────────────────────────
function getFilteredTasks() {
  return tasks.filter(t => {
    const matchFilter = filter === 'all' || (filter === 'completed' ? t.completed : !t.completed);
    const q = searchQuery.toLowerCase();
    const matchSearch = !q || t.title.toLowerCase().includes(q) || (t.notes || '').toLowerCase().includes(q) || (t.heading || '').toLowerCase().includes(q);
    return matchFilter && matchSearch;
  });
}

function renderTasks() {
  const filtered = getFilteredTasks();
  taskList.innerHTML = '';
  emptyState.classList.toggle('visible', filtered.length === 0);

  filtered.forEach((task, idx) => {
    const li = document.createElement('li');
    li.className = `task-item${task.completed ? ' completed' : ''}${task.id === selectedTaskId ? ' selected' : ''}${task.alarm && !task.completed ? ' has-alarm' : ''}`;
    li.draggable = true;
    li.dataset.id = task.id;

    // Format due date
    let dateHtml = '';
    if (task.date) {
      const d = new Date(task.date + 'T00:00:00');
      const today = new Date(); today.setHours(0,0,0,0);
      const isOverdue = d < today && !task.completed;
      dateHtml = `<span class="task-date${isOverdue ? ' overdue' : ''}"><i class="fa-regular fa-calendar"></i>${d.toLocaleDateString('en-US',{month:'short',day:'numeric'})}${isOverdue ? ' · Overdue' : ''}</span>`;
    }

    // Format alarm tag
    let alarmHtml = '';
    if (task.alarm && !task.completed) {
      const alarmDate = new Date(task.alarm);
      const now = new Date();
      const diffMin = Math.round((alarmDate - now) / 60000);
      let timeStr = '';
      if (diffMin < 0) timeStr = 'Overdue';
      else if (diffMin < 60) timeStr = `in ${diffMin}m`;
      else if (diffMin < 1440) timeStr = `in ${Math.round(diffMin/60)}h`;
      else timeStr = alarmDate.toLocaleDateString('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
      alarmHtml = `<span class="task-alarm-tag"><i class="fa-solid fa-bell"></i>${timeStr}${task.alarmRepeat !== 'none' ? ` · ${task.alarmRepeat}` : ''}</span>`;
    }

    li.innerHTML = `
      <button class="task-check${task.completed ? ' checked' : ''}" aria-label="Toggle complete" data-id="${task.id}"></button>
      <div class="task-body">
        ${task.heading ? `<span class="task-heading-label">${escHtml(task.heading)}</span>` : ''}
        <span class="task-title">${escHtml(task.title)}</span>
        ${task.notes ? `<span class="task-notes-preview">${escHtml(task.notes.slice(0,120))}${task.notes.length>120?'…':''}</span>` : ''}
        <div class="task-meta">
          <span class="priority-dot ${task.priority}"></span>
          ${dateHtml}
          ${alarmHtml}
        </div>
      </div>
      <div class="task-actions">
        <button class="task-action-btn edit" data-id="${task.id}" title="Edit task" aria-label="Edit task"><i class="fa-solid fa-pen"></i></button>
        <button class="task-action-btn delete" data-id="${task.id}" title="Delete task" aria-label="Delete task"><i class="fa-solid fa-xmark"></i></button>
      </div>
    `;

    // Drag events
    li.addEventListener('dragstart', e => { dragSrcIndex = tasks.findIndex(t => t.id === task.id); li.classList.add('dragging'); });
    li.addEventListener('dragend', () => li.classList.remove('dragging'));
    li.addEventListener('dragover', e => { e.preventDefault(); li.classList.add('drag-over'); });
    li.addEventListener('dragleave', () => li.classList.remove('drag-over'));
    li.addEventListener('drop', e => {
      e.preventDefault(); li.classList.remove('drag-over');
      const destIndex = tasks.findIndex(t => t.id === task.id);
      if (dragSrcIndex !== null && dragSrcIndex !== destIndex) {
        const [moved] = tasks.splice(dragSrcIndex, 1);
        tasks.splice(destIndex, 0, moved);
        saveTasks(); renderTasks(); updateStats();
      }
      dragSrcIndex = null;
    });

    // Select
    li.addEventListener('click', e => {
      if (e.target.closest('.task-check') || e.target.closest('.task-action-btn')) return;
      selectedTaskId = selectedTaskId === task.id ? null : task.id;
      renderTasks();
    });

    taskList.appendChild(li);
  });

  // Check/uncheck
  taskList.querySelectorAll('.task-check').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const t = tasks.find(t => t.id === id);
      if (t) { t.completed = !t.completed; saveTasks(); renderTasks(); updateStats(); renderAlarmPanel(); }
    });
  });

  // Edit
  taskList.querySelectorAll('.task-action-btn.edit').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); openModal(btn.dataset.id); });
  });

  // Delete
  taskList.querySelectorAll('.task-action-btn.delete').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      tasks = tasks.filter(t => t.id !== btn.dataset.id);
      saveTasks(); renderTasks(); updateStats(); renderAlarmPanel();
      showToast('Task removed.');
    });
  });
}

function escHtml(str) {
  const d = document.createElement('div'); d.textContent = str; return d.innerHTML;
}

// ─── STATS ─────────────────────────────────────
function updateStats() {
  const total = tasks.length;
  const done = tasks.filter(t => t.completed).length;
  const pending = total - done;
  statTotal.textContent = total;
  statCompleted.textContent = done;
  statPending.textContent = pending;
  const pct = total ? Math.round((done / total) * 100) : 0;
  progressFill.style.width = pct + '%';
  progressPct.textContent = pct + '%';
}

// ─── FILTER ────────────────────────────────────
filterTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    filterTabs.forEach(t => { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
    tab.classList.add('active'); tab.setAttribute('aria-selected', 'true');
    filter = tab.dataset.filter;
    renderTasks();
  });
});

// ─── SEARCH ────────────────────────────────────
searchInput.addEventListener('input', () => {
  searchQuery = searchInput.value;
  clearSearch.style.display = searchQuery ? 'block' : 'none';
  renderTasks();
});
clearSearch.addEventListener('click', () => {
  searchInput.value = ''; searchQuery = '';
  clearSearch.style.display = 'none';
  renderTasks(); searchInput.focus();
});

// ─── CLEAR COMPLETED ───────────────────────────
clearCompletedBtn.addEventListener('click', () => {
  const before = tasks.length;
  tasks = tasks.filter(t => !t.completed);
  if (tasks.length < before) { saveTasks(); renderTasks(); updateStats(); renderAlarmPanel(); showToast('Completed tasks cleared.'); }
  else showToast('No completed tasks to clear.');
});

// ─── MODAL ─────────────────────────────────────
function openModal(id) {
  editingTaskId = id;
  const task = tasks.find(t => t.id === id);
  if (!task) return;

  editInput.value = task.title;
  editHeading.value = task.heading || '';
  editNotes.value = task.notes || '';
  editDate.value = task.date || '';

  // Alarm
  if (task.alarm) {
    const d = new Date(task.alarm);
    editAlarmDate.value = d.toISOString().slice(0,10);
    editAlarmTime.value = d.toTimeString().slice(0,5);
  } else {
    editAlarmDate.value = '';
    editAlarmTime.value = '';
  }
  editAlarmRepeat.value = task.alarmRepeat || 'none';

  // Priority
  const editPriorityBtns = document.querySelectorAll('#edit-priority-btns .priority-btn');
  editPriorityBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.priority === task.priority);
    btn.setAttribute('aria-pressed', String(btn.dataset.priority === task.priority));
  });

  modalOverlay.style.display = 'flex';
  editInput.focus();
}

function closeModal() { modalOverlay.style.display = 'none'; editingTaskId = null; }
modalClose.addEventListener('click', closeModal);
modalCancel.addEventListener('click', closeModal);
modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) closeModal(); });

// Edit priority
document.querySelectorAll('#edit-priority-btns .priority-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#edit-priority-btns .priority-btn').forEach(b => {
      b.classList.remove('active'); b.setAttribute('aria-pressed','false');
    });
    btn.classList.add('active'); btn.setAttribute('aria-pressed','true');
  });
});

modalSave.addEventListener('click', () => {
  const task = tasks.find(t => t.id === editingTaskId);
  if (!task) return;

  const title = editInput.value.trim();
  if (!title) { showToast('Title cannot be empty.'); return; }

  const activePriority = document.querySelector('#edit-priority-btns .priority-btn.active');

  const alarmDateVal = editAlarmDate.value;
  const alarmTimeVal = editAlarmTime.value;
  let alarmISO = null;
  if (alarmDateVal && alarmTimeVal) {
    alarmISO = new Date(`${alarmDateVal}T${alarmTimeVal}`).toISOString();
  }

  task.title = title;
  task.heading = editHeading.value.trim();
  task.notes = editNotes.value.trim();
  task.date = editDate.value;
  task.priority = activePriority ? activePriority.dataset.priority : task.priority;
  task.alarm = alarmISO;
  task.alarmRepeat = alarmDateVal && alarmTimeVal ? editAlarmRepeat.value : 'none';
  task.alarmFired = false; // reset so updated alarm re-fires

  saveTasks(); renderTasks(); updateStats(); renderAlarmPanel();
  closeModal(); showToast('Task updated!');
});

// ─── TOAST ─────────────────────────────────────
function showToast(msg, duration = 2800) {
  const toast = document.createElement('div');
  toast.className = 'toast'; toast.textContent = msg;
  document.getElementById('toast-container').appendChild(toast);
  setTimeout(() => toast.remove(), duration);
}

// ─── KEYBOARD SHORTCUTS ────────────────────────
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'n') { e.preventDefault(); taskInput.focus(); }
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); searchInput.focus(); }
  if (e.key === 'Delete' && selectedTaskId && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
    tasks = tasks.filter(t => t.id !== selectedTaskId);
    selectedTaskId = null; saveTasks(); renderTasks(); updateStats(); renderAlarmPanel();
    showToast('Task removed.');
  }
  if (e.key === 'Escape') { closeModal(); selectedTaskId = null; renderTasks(); }
});

// ─── ALARM ENGINE ──────────────────────────────
function startAlarmEngine() {
  checkAlarms();
  setInterval(checkAlarms, 15000); // check every 15 seconds
}

function checkAlarms() {
  const now = new Date();
  tasks.forEach(task => {
    if (!task.alarm || task.completed || task.alarmFired) return;
    const alarmTime = new Date(task.alarm);
    if (now >= alarmTime) {
      fireAlarm(task);
    }
  });
}

function fireAlarm(task) {
  // Mark as fired (to avoid repeat firing immediately)
  task.alarmFired = true;

  // Handle repeat: advance next alarm time
  if (task.alarmRepeat === 'daily') {
    const next = new Date(task.alarm);
    next.setDate(next.getDate() + 1);
    task.alarm = next.toISOString();
    task.alarmFired = false;
  } else if (task.alarmRepeat === 'weekly') {
    const next = new Date(task.alarm);
    next.setDate(next.getDate() + 7);
    task.alarm = next.toISOString();
    task.alarmFired = false;
  }

  saveTasks();
  renderTasks();
  renderAlarmPanel();

  // Queue and show
  alarmQueue.push(task);
  if (!activeAlarm) showNextAlarm();

  // Browser notification
  sendBrowserNotification(task);
}

function showNextAlarm() {
  if (alarmQueue.length === 0) { activeAlarm = null; return; }
  activeAlarm = alarmQueue.shift();
  alarmPopupTask.textContent = activeAlarm.title;
  alarmPopupNote.textContent = activeAlarm.notes ? activeAlarm.notes.slice(0, 80) + (activeAlarm.notes.length > 80 ? '…' : '') : '';
  alarmPopupNote.style.display = activeAlarm.notes ? 'block' : 'none';
  alarmPopup.style.display = 'block';
  playAlarmSound();
}

function dismissAlarm() {
  alarmPopup.style.display = 'none';
  activeAlarm = null;
  // Show next queued alarm if any
  setTimeout(showNextAlarm, 500);
}

function snoozeAlarm() {
  if (!activeAlarm) return;
  const task = tasks.find(t => t.id === activeAlarm.id);
  if (task) {
    const snoozeTime = new Date(Date.now() + 5 * 60 * 1000);
    task.alarm = snoozeTime.toISOString();
    task.alarmFired = false;
    saveTasks(); renderTasks(); renderAlarmPanel();
    showToast('Reminder snoozed for 5 minutes 💤');
  }
  dismissAlarm();
}

alarmDismissBtn.addEventListener('click', dismissAlarm);
alarmSnoozeBtn.addEventListener('click', snoozeAlarm);

// Alarm sound using Web Audio API
function playAlarmSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const notes = [880, 660, 880, 660, 880];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = freq;
      osc.type = 'sine';
      const t = ctx.currentTime + i * 0.18;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.18, t + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
      osc.start(t); osc.stop(t + 0.15);
    });
  } catch(e) { /* silent */ }
}

// Browser Notifications
function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

function sendBrowserNotification(task) {
  if ('Notification' in window && Notification.permission === 'granted') {
    const n = new Notification(`⏰ Reminder: ${task.title}`, {
      body: task.notes ? task.notes.slice(0, 100) : 'Time to get this done!',
      icon: 'https://fonts.gstatic.com/s/i/materialiconsoutlined/alarm/v12/24px.svg',
    });
    setTimeout(() => n.close(), 8000);
  }
}

// ─── ALARM PANEL ───────────────────────────────
function renderAlarmPanel() {
  const upcoming = tasks.filter(t => t.alarm && !t.completed).sort((a,b) => new Date(a.alarm) - new Date(b.alarm));
  
  // Badge
  if (upcoming.length > 0) {
    alarmBadge.style.display = 'flex';
    alarmBadge.textContent = upcoming.length;
  } else {
    alarmBadge.style.display = 'none';
  }

  // List
  alarmListEl.innerHTML = '';
  if (upcoming.length === 0) {
    alarmListEl.innerHTML = '<li class="alarm-empty-msg">No reminders set yet.</li>';
    return;
  }
  upcoming.forEach(task => {
    const li = document.createElement('li');
    li.className = 'alarm-list-item';
    const d = new Date(task.alarm);
    const timeStr = d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    li.innerHTML = `
      <i class="fa-solid fa-bell alarm-icon"></i>
      <div class="alarm-info">
        <div class="alarm-task-name">${escHtml(task.title)}</div>
        <div class="alarm-time-str"><i class="fa-regular fa-clock"></i> ${timeStr}</div>
      </div>
      ${task.alarmRepeat !== 'none' ? `<span class="alarm-repeat-badge">${task.alarmRepeat}</span>` : ''}
      <button class="alarm-delete-btn" data-id="${task.id}" title="Remove reminder" aria-label="Remove reminder"><i class="fa-solid fa-xmark"></i></button>
    `;
    alarmListEl.appendChild(li);
  });

  alarmListEl.querySelectorAll('.alarm-delete-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const task = tasks.find(t => t.id === btn.dataset.id);
      if (task) {
        task.alarm = null; task.alarmRepeat = 'none'; task.alarmFired = false;
        saveTasks(); renderTasks(); renderAlarmPanel();
        showToast('Reminder removed.');
      }
    });
  });
}

alarmPanelToggle.addEventListener('click', () => {
  const isVisible = alarmPanel.style.display !== 'none';
  alarmPanel.style.display = isVisible ? 'none' : 'block';
});
alarmPanelClose.addEventListener('click', () => { alarmPanel.style.display = 'none'; });

// ─── START ─────────────────────────────────────
init();