/* =====================================================
   shares.js — shared tasks and group tasks (sharing, phase 2)
   Loaded on demand by script.js. Three screens:
     renderPeople   the "People" tab of the Share sheet (who can open a task, stop sharing)
     openSharedTask the editor for a task somebody shares with you (or one you share), with the activity log
     openGroup      the task board of one group (progress, filters, new group task)
   ===================================================== */
const $ = (s, r = document) => r.querySelector(s);
const initial = (n) => String(n || '?').trim().charAt(0).toUpperCase() || '?';
const rid = () => Math.random().toString(36).slice(2, 10);
const ago = (ms) => {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + ' min ago';
  if (s < 86400) return Math.floor(s / 3600) + ' h ago';
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};
const when = (iso) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const friendly = (e) => (e && e.code === 'permission-denied' ? 'Not allowed. Publish the latest Firestore rules, then try again.' : (e && e.message) || 'Something went wrong. Please try again.');

/* ---------------------------------------------------------
   People tab (inside the Share sheet)
   --------------------------------------------------------- */
const P = { group: null, ctx: null, el: null, uid: null, friends: [], groups: [], people: new Map(), existing: null, msg: null, busy: false, log: [], offLog: null, wired: false };

const once = (sub) => new Promise((res) => { let un = null, done = false; const fin = (v) => { if (done) return; done = true; setTimeout(() => un && un(), 0); res(v); }; un = sub((l) => fin(l), () => fin([])); if (done) un(); });

async function loadPeople(ctx) {
  const me = ctx.user.uid;
  const fs = await ctx.cloud.listFriendships(me).catch(() => once((ok, bad) => ctx.cloud.subscribeFriendships(me, ok, bad)));
  const ids = fs.filter((f) => f.status === 'accepted').map((f) => f.members.find((m) => m !== me)).filter(Boolean);
  P.friends = await Promise.all(ids.map(async (uid) => { const p = await ctx.cloud.getProfile(uid); return { uid, name: p ? p.name : 'Friend' }; }));
  P.groups = await ctx.cloud.listGroups(me).catch(() => once((ok, bad) => ctx.cloud.subscribeGroups(me, ok, bad)));
  P.uid = me;
}

export async function renderPeople(el, ctx) {
  P.ctx = ctx; P.el = el; P.msg = null;
  el.innerHTML = '<p class="muted">Loading…</p>';
  try { await loadPeople(ctx); } catch (err) { P.msg = { t: friendly(err), ok: false }; }
  const sh = ctx.tasks.length === 1 ? ctx.shareOf(ctx.tasks[0]) : null;
  P.existing = sh || null;
  P.people = new Map(); P.group = sh && sh.groupId ? { id: sh.groupId, name: sh.groupName || 'Group' } : null;
  if (sh) sh.members.filter((m) => m !== ctx.user.uid).forEach((uid) => P.people.set(uid, { name: (sh.names && sh.names[uid]) || 'Friend', view: (sh.viewers || []).includes(uid) }));
  watchLog(sh);
  if (!P.wired) { P.wired = true; el.addEventListener('click', onPeopleClick); el.addEventListener('change', onPeopleChange); }
  drawPeople();
}
function watchLog(sh) {
  if (P.offLog) { P.offLog(); P.offLog = null; }
  P.log = [];
  if (sh) P.offLog = P.ctx.cloud.subscribeActivity(sh.id, (l) => { P.log = l; const box = $('#sp-log'); if (box) box.innerHTML = logHTML(l); }, () => {});
}
const logHTML = (l) => (l.length ? l.map((x) => `<div class="sh-log"><span class="sh-av sm" aria-hidden="true">${P.ctx.esc(initial(x.name))}</span><div><strong>${P.ctx.esc(x.name)}</strong> ${P.ctx.esc(x.text)} <span class="muted">· ${ago(x.at)}</span></div></div>`).join('') : '<p class="muted">Nothing has happened yet.</p>');

function drawPeople() {
  const { ctx, el } = P, e = ctx.esc, n = ctx.tasks.length, ex = P.existing;
  const rows = [...P.people].map(([uid, p]) => `<div class="sh-person"><span class="sh-av" aria-hidden="true">${e(initial(p.name))}</span><span class="sh-pname">${e(p.name)}</span>
    <select data-role="${e(uid)}" aria-label="What ${e(p.name)} can do"><option value="edit"${p.view ? '' : ' selected'}>Can edit</option><option value="view"${p.view ? ' selected' : ''}>View only</option></select>
    <button type="button" class="btn btn-ghost sm" data-rm="${e(uid)}" aria-label="Remove ${e(p.name)}">Remove</button></div>`).join('');
  const fr = P.friends.filter((f) => !P.people.has(f.uid));
  const gr = P.groups;
  const msg = P.msg ? `<div class="soc-msg ${P.msg.ok ? 'ok' : 'bad'}" role="status">${e(P.msg.t)}</div>` : '';
  el.innerHTML = `${msg}
    <p class="muted">${n === 1 ? 'People you add can open this task, tick its steps, add steps and edit it.' : `The ${n} selected tasks are shared with the people you add.`} A reminder on a shared task rings on everyone's phone.</p>
    <h4 class="sh-h">Who can open ${n === 1 ? 'this task' : 'these tasks'}</h4>
    ${rows || '<p class="muted">Nobody yet. Add friends or a group below.</p>'}
    <h4 class="sh-h">Add friends</h4>
    <div class="sh-chips">${fr.length ? fr.map((f) => `<button type="button" class="sh-chip" data-addf="${e(f.uid)}">+ ${e(f.name)}</button>`).join('') : `<span class="muted">${P.friends.length ? 'All your friends are added.' : 'No friends yet. Add them in Account, Friends and groups.'}</span>`}</div>
    ${P.group ? `<div class="sh-ongroup"><span>On the task board of <strong>${e(P.group.name)}</strong></span><button type="button" class="btn btn-ghost sm" data-rmg="1">Remove from board</button></div>` : ''}
    ${gr.length ? `<h4 class="sh-h">Add a group</h4><div class="sh-chips">${gr.map((g) => `<button type="button" class="sh-chip" data-addg="${e(g.id)}" data-gname="${e(g.name)}">+ ${e(g.name)}</button>`).join('')}</div><p class="muted sh-small">A group adds the people who are in it today and puts the task on that group\u2019s task board. People who join later are not added automatically.</p>` : ''}
    <div class="sh-actions">
      <button type="button" class="btn btn-primary" data-apply="1" ${P.busy ? 'disabled' : ''}>${ex ? 'Save changes' : `Share ${n} task${n === 1 ? '' : 's'}`}</button>
      ${ex ? '<button type="button" class="btn btn-ghost danger" data-stop="1">Stop sharing</button>' : ''}
    </div>
    ${ex ? `<h4 class="sh-h">Activity</h4><div id="sp-log">${logHTML(P.log)}</div>` : ''}`;
}
function onPeopleChange(e) {
  const s = e.target.closest('[data-role]'); if (!s) return;
  const p = P.people.get(s.dataset.role); if (p) p.view = s.value === 'view';
}
async function onPeopleClick(e) {
  const b = e.target.closest('button'); if (!b || P.busy) return;
  const { ctx } = P, me = ctx.user.uid;
  if (b.dataset.addf) { const f = P.friends.find((x) => x.uid === b.dataset.addf); if (f) P.people.set(f.uid, { name: f.name, view: false }); P.msg = null; return drawPeople(); }
  if (b.dataset.rm) { P.people.delete(b.dataset.rm); return drawPeople(); }
  if (b.dataset.rmg) { P.group = null; return drawPeople(); }
  if (b.dataset.addg) {
    P.group = { id: b.dataset.addg, name: b.dataset.gname || 'Group' };
    try {
      const ms = await ctx.cloud.groupMembers(b.dataset.addg);
      ms.filter((m) => m.uid !== me).forEach((m) => { if (!P.people.has(m.uid)) P.people.set(m.uid, { name: m.name, view: false }); });
      P.msg = null;
    } catch (err) { P.msg = { t: friendly(err), ok: false }; }
    return drawPeople();
  }
  if (b.dataset.apply || b.dataset.stop) {
    P.busy = true; b.disabled = true;
    try {
      const arr = [...P.people].map(([uid, p]) => ({ uid, name: p.name })), viewers = [...P.people].filter(([, p]) => p.view).map(([u]) => u);
      if (b.dataset.stop || (P.existing && !arr.length)) {
        await ctx.cloud.stopShare(P.existing.id); ctx.detach(ctx.tasks[0]); ctx.toast('Sharing stopped'); ctx.track('share-stopped');
      } else {
        if (!arr.length) throw new Error('Add at least one person first.');
        for (const t of ctx.tasks) {
          const cur = ctx.shareOf(t);
          if (cur) await ctx.cloud.updateShareMembers(cur.id, me, arr, viewers, P.group);
          else { const id = await ctx.cloud.createShare(me, ctx.myName, t, arr, viewers, P.group ? { groupId: P.group.id, groupName: P.group.name } : {}); ctx.attach(t, id); }
        }
        ctx.toast(`Shared with ${arr.length} ${arr.length === 1 ? 'person' : 'people'}`); ctx.track('share-people');
      }
      P.busy = false;
      ctx.close();
      return;
    } catch (err) { P.msg = { t: friendly(err), ok: false }; }
    P.busy = false; drawPeople();
  }
}

/* ---------------------------------------------------------
   The shared task editor (also used for the owner)
   --------------------------------------------------------- */
const D = { ctx: null, id: null, gid: null, log: [], off: null, wired: false, mode: 'task', g: null };

function dlg() { return $('#shared-task'); }
function wire() {
  if (D.wired) return; D.wired = true;
  const body = $('#st-body');
  body.addEventListener('click', onClick);
  body.addEventListener('change', onChange);
  body.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'st-newstep') { e.preventDefault(); addStep(); } });
  dlg().addEventListener('close', () => { if (D.off) { D.off(); D.off = null; } D.id = null; D.gid = null; });
}
function watchTaskLog(id) {
  if (D.off) { D.off(); D.off = null; }
  D.log = [];
  D.off = D.ctx.cloud.subscribeActivity(id, (l) => { D.log = l; const box = $('#st-log'); if (box) box.innerHTML = logHTML2(l); }, () => {});
}
const logHTML2 = (l) => (l.length ? l.map((x) => `<div class="sh-log"><span class="sh-av sm" aria-hidden="true">${D.ctx.esc(initial(x.name))}</span><div><strong>${D.ctx.esc(x.name)}</strong> ${D.ctx.esc(x.text)} <span class="muted">· ${ago(x.at)}</span></div></div>`).join('') : '<p class="muted">Nothing has happened yet.</p>');

export async function openSharedTask(ctx, id, fromGroup) {
  D.ctx = ctx; D.id = id; D.mode = 'task'; D.back = fromGroup || null;
  wire();
  if (!dlg().open) dlg().showModal();
  watchTaskLog(id);
  drawTask();
}
export function refreshOpen() {
  if (!D.ctx || !dlg() || !dlg().open) return;
  const a = document.activeElement;
  if (a && (a.id === 'st-newstep' || a.id === 'st-title' || a.id === 'st-notes' || a.id === 'st-date')) return; // never rebuild under somebody typing
  if (D.mode === 'group' && D.g && D.g.form) return;
  if (D.mode === 'task' && D.id) drawTask(); else if (D.mode === 'group' && !D.formOpenTyping) drawGroup();
}
const MAX_PH = 10, MAX_STEP_PH = 3;
const thumbs = (e, list, owner, can) => (list || []).map((p, i) => `<span class="sh-thw"><button type="button" class="sh-th" data-act="photo" data-owner="${e(owner)}" data-i="${i}" aria-label="Open photo"><img data-pid="${e(p.id)}" alt=""></button>${can ? `<button type="button" class="sh-thx" data-act="delphoto" data-owner="${e(owner)}" data-pid="${e(p.id)}" aria-label="Remove photo">×</button>` : ''}</span>`).join('');
function hydrate(root) {
  const sh = D.ctx.getShare(D.id); if (!sh) return;
  root.querySelectorAll('img[data-pid]:not([src])').forEach(async (img) => {
    let d = null; try { d = await D.ctx.photo(sh, img.dataset.pid); } catch { /* shows as missing */ }
    if (d) img.src = d; else img.classList.add('missing');
  });
}
function drawTask() {
  const { ctx } = D, e = ctx.esc, sh = ctx.getShare(D.id), body = $('#st-body');
  if (!sh) { body.innerHTML = '<p class="muted">This shared task is no longer available. The owner may have stopped sharing it.</p>'; $('#st-title').textContent = 'Shared task'; return; }
  const me = ctx.user.uid, owner = sh.ownerUid === me, view = (sh.viewers || []).includes(me), can = !view, t = sh.task;
  const steps = t.subtasks || [], nDone = steps.filter((s) => s.done).length;
  $('#st-title').textContent = sh.groupName || 'Shared task';
  const who = sh.assignee ? ((sh.names && sh.names[sh.assignee]) || 'Someone') + (sh.assignee === me ? ' (you)' : '') : 'Everyone';
  const others = sh.members.filter((m) => m !== me).map((m) => (sh.names && sh.names[m]) || 'Someone');
  const pr = ['low', 'medium', 'high'];
  body.innerHTML = `
    ${D.back ? '<button type="button" class="btn btn-ghost sm" data-act="back">← Back to group</button>' : ''}
    <div class="sh-meta"><span class="sh-pill ${can ? 'ok' : ''}">${owner ? 'You own this task' : can ? 'You can edit' : 'View only'}</span>${owner ? `<span class="muted">Shared with ${e(others.join(', ') || 'nobody')}</span>` : `<span class="muted">Shared by ${e(sh.ownerName || 'a friend')}</span>`}${sh.groupId ? `<span class="muted">Assigned to ${e(who)}</span>` : ''}</div>
    ${can ? `<div><label class="sh-l" for="st-ttl">Task</label><input id="st-ttl" type="text" maxlength="200" value="${e(t.title)}"></div>` : `<h3 class="sh-ttl">${e(t.title)}</h3>`}
    ${t.alarm && !t.completed ? `<div class="sh-alarm"><strong>Reminder ${e(when(t.alarm))}</strong><span>${sh.ring === false ? 'Only the owner gets this alarm.' : "Rings on everyone's phone."}</span></div>` : ''}
    <div class="sh-row2">
      <div><label class="sh-l" for="st-date">Due date</label>${can ? `<input id="st-date" type="date" value="${e(t.date || '')}">` : `<div class="sh-ro">${t.date ? e(t.date) : 'No date'}</div>`}</div>
      <div><label class="sh-l" for="st-pri">Priority</label>${can ? `<select id="st-pri">${pr.map((x) => `<option value="${x}"${t.priority === x ? ' selected' : ''}>${x[0].toUpperCase() + x.slice(1)}</option>`).join('')}</select>` : `<div class="sh-ro">${e((t.priority || 'medium')[0].toUpperCase() + (t.priority || 'medium').slice(1))}</div>`}</div>
    </div>
    ${(t.tags || []).length ? `<div class="sh-chips">${t.tags.map((x) => `<span class="sh-pill">#${e(x)}</span>`).join('')}</div>` : ''}
    <div class="sh-donecol">${can ? `<button type="button" class="btn ${t.completed ? 'btn-ghost' : 'btn-primary'}" data-act="done">${t.completed ? 'Reopen task' : 'Mark as done'}</button>` : `<div class="sh-ro">${t.completed ? 'Done' : 'Not done yet'}</div>`}</div>
    <div><h4 class="sh-h">Steps <span class="muted">${steps.length ? `${nDone} of ${steps.length}` : ''}</span></h4>
    <div class="sh-steps">${steps.map((s) => `<div class="sh-stepw"><div class="sh-step${s.done ? ' done' : ''}"><button type="button" class="sh-box" role="checkbox" aria-checked="${s.done}" aria-label="${s.done ? 'Mark step as not done' : 'Mark step as done'}" data-act="tick" data-sid="${e(s.id)}" ${can ? '' : 'disabled'}>${s.done ? '✔' : ''}</button><span class="sh-st">${e(s.text)}</span>${can && (s.photos || []).length < MAX_STEP_PH ? `<button type="button" class="sh-x" aria-label="Add a photo to this step" data-act="addphoto" data-owner="${e(s.id)}">📷</button>` : ''}${can ? `<button type="button" class="sh-x" aria-label="Remove step" data-act="del" data-sid="${e(s.id)}">×</button>` : ''}</div>${(s.photos || []).length ? `<div class="sh-thumbs">${thumbs(e, s.photos, s.id, can)}</div>` : ''}</div>`).join('') || '<p class="muted">No steps yet.</p>'}</div>
    ${can ? '<div class="soc-form sh-add"><input id="st-newstep" type="text" maxlength="200" placeholder="Add a step" aria-label="Add a step"><button type="button" class="btn btn-ghost" data-act="addstep">Add</button></div>' : ''}</div>
    <div><h4 class="sh-h">Photos <span class="muted">${(t.photos || []).length ? (t.photos || []).length : ''}</span></h4>
    ${(t.photos || []).length ? `<div class="sh-thumbs">${thumbs(e, t.photos, 'task', can)}</div>` : '<p class="muted">No photos yet.</p>'}
    ${can && (t.photos || []).length < MAX_PH ? '<div class="sh-actions" style="margin-top:8px"><button type="button" class="btn btn-ghost sm" data-act="addphoto" data-owner="task">📷 Add photos</button></div>' : ''}
    <input type="file" id="st-file" accept="image/*" multiple hidden></div>
    <div><h4 class="sh-h">Notes</h4>
    ${can ? `<textarea id="st-notes" rows="6" maxlength="20000" aria-label="Notes">${e(t.notes || '')}</textarea>` : `<div class="sh-ro sh-notes">${t.notes ? e(t.notes) : 'No notes.'}</div>`}</div>
    <div><h4 class="sh-h">Activity</h4><div id="st-log">${logHTML2(D.log)}</div></div>
    <div class="sh-actions">${owner ? '<button type="button" class="btn btn-ghost" data-act="people">Manage people</button>' : '<button type="button" class="btn btn-ghost danger" data-act="leave">Leave this task</button>'}</div>`;
  hydrate(body);
}
function edit(mutate, picIds) {
  const { ctx } = D, sh = ctx.getShare(D.id);
  if (!sh) return;
  Promise.resolve(ctx.edit(sh, mutate, picIds || [])).catch((err) => { ctx.onError(err); ctx.toast(friendly(err)); });
}
function addStep() {
  const el = $('#st-newstep'); const v = el && el.value.trim(); if (!v) return;
  el.value = '';
  edit((x) => { x.subtasks = x.subtasks || []; if (x.subtasks.length < 50) x.subtasks.push({ id: rid(), text: v.slice(0, 200), done: false }); return x; });
}
async function addPhotos(input) {
  const { ctx } = D, sh = ctx.getShare(D.id), files = [...input.files]; input.value = '';
  if (!sh || !files.length) return;
  const target = D.target || 'task', cur = sh.task, room = target === 'task' ? MAX_PH - (cur.photos || []).length : MAX_STEP_PH - (((cur.subtasks || []).find((x) => x.id === target) || {}).photos || []).length;
  if (room <= 0) { ctx.toast('No more photos fit here'); return; }
  const added = [];
  for (const f of files.slice(0, room)) { try { added.push({ id: await ctx.addPhoto(sh, f), cap: '' }); } catch { ctx.toast('A picture could not be added'); } }
  if (!added.length) return;
  edit((x) => { if (target === 'task') x.photos = [...(x.photos || []), ...added].slice(0, MAX_PH); else { const st = (x.subtasks || []).find((y) => y.id === target); if (st) st.photos = [...(st.photos || []), ...added].slice(0, MAX_STEP_PH); } return x; }, added.map((p) => p.id));
  ctx.toast(added.length === 1 ? 'Photo added' : `${added.length} photos added`);
}
async function onClick(e) {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const a = b.dataset.act, { ctx } = D;
  if (a === 'photo') { const sh = ctx.getShare(D.id); const t = sh && sh.task; const list = b.dataset.owner === 'task' ? t.photos : ((t.subtasks || []).find((x) => x.id === b.dataset.owner) || {}).photos; ctx.openViewer(list || [], Number(b.dataset.i) || 0); }
  else if (a === 'addphoto') { D.target = b.dataset.owner; const f = $('#st-file'); if (f) f.click(); }
  else if (a === 'delphoto') edit((x) => { const pid = b.dataset.pid; if (b.dataset.owner === 'task') x.photos = (x.photos || []).filter((p) => p.id !== pid); else { const st = (x.subtasks || []).find((y) => y.id === b.dataset.owner); if (st) st.photos = (st.photos || []).filter((p) => p.id !== pid); } return x; });
  else if (a === 'tick') edit((x) => { const s = (x.subtasks || []).find((y) => y.id === b.dataset.sid); if (s) s.done = !s.done; return x; });
  else if (a === 'del') edit((x) => { x.subtasks = (x.subtasks || []).filter((y) => y.id !== b.dataset.sid); return x; });
  else if (a === 'addstep') addStep();
  else if (a === 'done') edit((x) => { x.completed = !x.completed; x.completedAt = x.completed ? new Date().toISOString() : null; return x; });
  else if (a === 'back') openGroup(ctx, D.back);
  else if (a === 'people') { const sh = ctx.getShare(D.id); dlg().close(); if (sh) ctx.managePeople(sh); }
  else if (a === 'leave') {
    if (!confirm('Leave this shared task? You will not see it any more.')) return;
    try { await ctx.cloud.leaveShare(D.id, ctx.user.uid); ctx.left(D.id); ctx.toast('You left the task'); ctx.track('share-left'); dlg().close(); } catch (err) { ctx.toast(friendly(err)); }
  }
}
function onChange(e) {
  const t = e.target;
  if (t.id === 'st-ttl') { const v = t.value.trim().slice(0, 200); if (v) edit((x) => { x.title = v; return x; }); }
  else if (t.id === 'st-notes') { const v = t.value.slice(0, 20000); edit((x) => { x.notes = v; return x; }); }
  else if (t.id === 'st-pri') { const v = ['low', 'medium', 'high'].includes(t.value) ? t.value : 'medium'; edit((x) => { x.priority = v; return x; }); }
  else if (t.id === 'st-file') addPhotos(t);
  else if (t.id === 'st-date') { const v = /^\d{4}-\d{2}-\d{2}$/.test(t.value) ? t.value : ''; edit((x) => { x.date = v; return x; }); }
}

/* ---------------------------------------------------------
   One group's task board
   --------------------------------------------------------- */
export async function openGroup(ctx, gid, gname) {
  D.ctx = ctx; D.mode = 'group'; D.gid = gid; D.id = null;
  if (D.off) { D.off(); D.off = null; }
  D.g = D.g && D.g.gid === gid ? D.g : { gid, name: gname || '', members: [], filter: 'all', form: false, msg: null };
  if (gname) D.g.name = gname;
  wire();
  if (!dlg().open) dlg().showModal();
  drawGroup();
  try { D.g.members = await ctx.cloud.groupMembers(gid); } catch (err) { D.g.msg = { t: friendly(err), ok: false }; }
  if (D.mode === 'group' && D.gid === gid) drawGroup();
}
const groupShares = () => D.ctx.shares().filter((s) => s.groupId === D.g.gid);
function drawGroup() {
  const { ctx } = D, e = ctx.esc, g = D.g, me = ctx.user.uid, body = $('#st-body'), td = todayStr();
  const all = groupShares(), done = all.filter((s) => s.task.completed).length;
  const open = all.filter((s) => !s.task.completed);
  const list = (g.filter === 'done' ? all.filter((s) => s.task.completed) : open).filter((s) => (g.filter === 'mine' ? s.assignee === me : g.filter === 'today' ? s.task.date && s.task.date <= td : true))
    .sort((a, b) => (a.task.date || '9999').localeCompare(b.task.date || '9999') || (b.updatedAt || 0) - (a.updatedAt || 0));
  const pct = all.length ? Math.round((done / all.length) * 100) : 0;
  $('#st-title').textContent = g.name || 'Group';
  const nameOf = (s) => (s.assignee ? ((s.names && s.names[s.assignee]) || 'Someone') + (s.assignee === me ? ' (you)' : '') : 'Everyone');
  const msg = g.msg ? `<div class="soc-msg ${g.msg.ok ? 'ok' : 'bad'}" role="status">${e(g.msg.t)}</div>` : '';
  body.innerHTML = `${msg}
    <div class="sh-prog"><div class="muted">${g.members.length ? g.members.length + ' members' : 'Group'} · ${open.length} open task${open.length === 1 ? '' : 's'}</div>
      <div class="sh-prog-n"><strong>${done} of ${all.length}</strong> tasks done</div>
      <div class="sh-bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="Group progress"><i style="width:${pct}%"></i></div></div>
    <div class="sh-filters" role="group" aria-label="Filter tasks">${[['all', 'All'], ['mine', 'Mine'], ['today', 'Due today'], ['done', 'Done']].map(([k, l]) => `<button type="button" class="sh-chip${g.filter === k ? ' on' : ''}" aria-pressed="${g.filter === k}" data-gf="${k}">${l}</button>`).join('')}</div>
    <div class="sh-tasks">${list.map((s) => { const t = s.task, n = (t.subtasks || []).length, d = (t.subtasks || []).filter((x) => x.done).length;
      return `<button type="button" class="sh-trow" data-open="${e(s.id)}"><span class="sh-tt">${e(t.title)}</span><span class="sh-tm"><span class="sh-pill">${e(nameOf(s))}</span>${t.date ? `<span class="sh-pill${t.date < td ? ' bad' : ''}">${e(t.date)}</span>` : ''}${n ? `<span class="sh-pill">${d}/${n} steps</span>` : ''}${t.alarm ? '<span class="sh-pill warn">Reminder</span>' : ''}</span></button>`; }).join('') || `<p class="muted">${all.length ? 'No tasks match this filter.' : 'No tasks yet. Add the first one below.'}</p>`}</div>
        ${g.form ? formHTML() : '<div class="sh-actions"><button type="button" class="btn btn-primary" data-gnew="1">New group task</button></div>'}`;
  if (!body._gwired) { body._gwired = true; body.addEventListener('click', onGroupClick); }
}
function formHTML() {
  const e = D.ctx.esc, me = D.ctx.user.uid;
  return `<div class="soc-card sh-form"><h4 class="sh-h" style="margin-top:0">New group task</h4>
    <label class="sh-l" for="gt-title">Task</label><input id="gt-title" type="text" maxlength="200" placeholder="What needs to be done?">
    <label class="sh-l" for="gt-who">Assign to</label>
    <select id="gt-who"><option value="">Everyone</option>${D.g.members.map((m) => `<option value="${e(m.uid)}">${e(m.name)}${m.uid === me ? ' (you)' : ''}</option>`).join('')}</select>
    <div class="sh-row2"><div><label class="sh-l" for="gt-date">Due date</label><input id="gt-date" type="date"></div><div><label class="sh-l" for="gt-time">Reminder time</label><input id="gt-time" type="time"></div></div>
    <label class="share-opt"><input type="checkbox" id="gt-ring" checked> Ring on every member's phone</label>
    <label class="sh-l" for="gt-perm">Members can</label>
    <select id="gt-perm"><option value="edit">Edit the task</option><option value="view">View only</option></select>
    <div class="sh-actions"><button type="button" class="btn btn-primary" data-gcreate="1">Create task</button><button type="button" class="btn btn-ghost" data-gcancel="1">Cancel</button></div></div>`;
}
async function onGroupClick(e) {
  const b = e.target.closest('button'); if (!b) return;
  const { ctx } = D, g = D.g;
  if (b.dataset.gf) { g.filter = b.dataset.gf; return drawGroup(); }
  if (b.dataset.open) return openSharedTask(ctx, b.dataset.open, g.gid);
  if (b.dataset.gnew) { g.form = true; g.msg = null; drawGroup(); const i = $('#gt-title'); if (i) i.focus(); return; }
  if (b.dataset.gcancel) { g.form = false; return drawGroup(); }
  if (b.dataset.gcreate) {
    const title = ($('#gt-title').value || '').trim();
    if (!title) { g.msg = { t: 'Type a name for the task first.', ok: false }; g.form = true; drawGroup(); return; }
    const date = $('#gt-date').value, time = $('#gt-time').value;
    b.disabled = true;
    try {
      await ctx.createGroupTask({ gid: g.gid, gname: g.name, members: g.members, title, assignee: $('#gt-who').value, date, time, ring: $('#gt-ring').checked, view: $('#gt-perm').value === 'view' });
      g.form = false; g.msg = { t: 'Task created. Everyone in the group can see it now.', ok: true };
    } catch (err) { g.msg = { t: friendly(err), ok: false }; g.form = true; }
    drawGroup();
  }
}
