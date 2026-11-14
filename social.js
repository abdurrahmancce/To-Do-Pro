/* =====================================================
   social.js — Friends and groups (sharing, phase 1)
   - Your friend code, add a friend by code, accept or decline requests
   - Create a group, invite people with a link, manage members
   Loaded on demand by script.js (Account, Friends and groups).
   All data lives in Firestore (see cloud.js and firestore.rules); only names and codes are public.
   ===================================================== */
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let C, U, say = () => {}, track = () => {};
const S = { me: null, friendships: [], groups: [], names: new Map(), readable: new Map(), msg: null, openGid: null, members: [], pendingJoin: null, prefill: '', loading: true, off: [], busy: false };

const link = (q) => location.origin + location.pathname + '?' + q;
const friendly = (e) => {
  const c = e && e.code;
  if (c === 'permission-denied') return 'That is not allowed. Check the code and try again.';
  if (c === 'unavailable' || c === 'failed-precondition' || !navigator.onLine) return 'You seem to be offline. Try again when you are connected.';
  return (e && e.message) || 'Something went wrong. Please try again.';
};

export async function openSocial(ctx) {
  C = ctx.cloud; U = ctx.user; say = ctx.toast || say; track = ctx.track || track;
  const dlg = $('#social'); if (!dlg) return;
  S.loading = true; S.msg = null; S.openGid = null; S.pendingJoin = null; S.prefill = '';
  render();
  if (!dlg.open) dlg.showModal();
  if (!dlg.__wired) {
    dlg.__wired = true;
    dlg.addEventListener('click', onClick);
    dlg.addEventListener('close', () => { S.off.forEach((f) => { try { f(); } catch { /* ignore */ } }); S.off = []; });
  }
  track('social-opened');
  try {
    S.me = await C.ensureProfile(U.uid, U.name || (U.email || '').split('@')[0]);
  } catch (e) { S.loading = false; S.msg = { t: friendly(e), ok: false }; render(); return; }
  S.loading = false;
  S.off.forEach((f) => { try { f(); } catch { /* ignore */ } });
  S.off = [
    C.subscribeFriendships(U.uid, onFriendships, () => {}),
    C.subscribeGroups(U.uid, onGroups, () => {}),
  ];
  await takeDeepLink();
  render();
}

async function takeDeepLink() {
  let dl = null;
  try { dl = JSON.parse(sessionStorage.getItem('tp-deeplink') || 'null'); sessionStorage.removeItem('tp-deeplink'); } catch { /* none */ }
  if (!dl) return;
  if (dl.f) { S.prefill = C.cleanCode(dl.f); S.msg = { t: 'Press "Send request" to add this friend.', ok: true }; }
  if (dl.j) {
    try {
      const inv = await C.previewInvite(dl.j);
      if (inv) S.pendingJoin = { code: inv.code, name: inv.gname };
      else S.msg = { t: 'This invite is not valid or was turned off.', ok: false };
    } catch (e) { S.msg = { t: friendly(e), ok: false }; }
  }
}

function onFriendships(list) {
  S.friendships = list;
  list.forEach((f) => {
    const other = f.members.find((m) => m !== U.uid);
    if (other && !S.names.has(other)) { S.names.set(other, '…'); C.getProfile(other).then((p) => { S.names.set(other, p ? p.name : 'Friend'); render(); }); }
  });
  render();
}
function onGroups(list, meta) {
  S.groups = list;
  list.forEach((g) => {
    // wait until the server has confirmed the write: a group I just created or joined is not readable before that
    if (meta && meta.pending) return;
    if (S.readable.has(g.id)) return;
    S.readable.set(g.id, true);
    C.groupReadable(g.id).then((ok) => { if (!ok) { S.readable.set(g.id, false); C.dropGroupIndex(U.uid, g.id).catch(() => {}); if (S.openGid === g.id) S.openGid = null; } render(); });
  });
  render();
}

const nameOf = (uid) => S.names.get(uid) || 'Friend';
const friends = () => S.friendships.filter((f) => f.status === 'accepted');
const incoming = () => S.friendships.filter((f) => f.status === 'pending' && f.requester !== U.uid);
const outgoing = () => S.friendships.filter((f) => f.status === 'pending' && f.requester === U.uid);
const myGroups = () => S.groups.filter((g) => S.readable.get(g.id) !== false);

/* ---------- rendering ---------- */
function keepInputs() { const o = {}; ['#soc-add', '#soc-gname', '#soc-join'].forEach((q) => { const el = $(q); if (el) o[q] = el.value; }); return o; }
function restoreInputs(o) { Object.keys(o).forEach((q) => { const el = $(q); if (el && o[q]) el.value = o[q]; }); }

function render() {
  const body = $('#social-body'); if (!body) return;
  const saved = keepInputs(), focus = document.activeElement && document.activeElement.id;
  if (S.loading) { body.innerHTML = '<p class="muted">Loading…</p>'; return; }
  const code = S.me ? C.fmtCode(S.me.code) : '';
  const msg = S.msg ? `<div class="soc-msg ${S.msg.ok ? 'ok' : 'bad'}" role="status">${esc(S.msg.t)}</div>` : '';
  const reqIn = incoming(), reqOut = outgoing(), fr = friends(), gr = myGroups();
  body.innerHTML = `
    ${msg}
    ${S.pendingJoin ? `<div class="soc-card soc-join"><p>You were invited to join <strong>${esc(S.pendingJoin.name)}</strong>.</p>
      <div class="row"><button type="button" class="btn btn-primary" data-act="confirm-join">Join group</button><button type="button" class="btn btn-ghost" data-act="skip-join">Not now</button></div></div>` : ''}
    <section class="acc-section">
      <h3>Your friend code</h3>
      <p class="muted">Share this code with people you know. They send you a request and you choose whether to accept.</p>
      <div class="soc-code" aria-label="Your friend code">${esc(code)}</div>
      <div class="row">
        <button type="button" class="btn btn-ghost" data-act="copy-code">Copy code</button>
        <button type="button" class="btn btn-ghost" data-act="copy-link">Copy invite link</button>
      </div>
    </section>
    <section class="acc-section">
      <h3>Add a friend</h3>
      <div class="soc-form"><input id="soc-add" type="text" maxlength="12" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="Friend code, for example K7M2-QX9P" aria-label="Friend code" value="${esc(S.prefill)}"/>
      <button type="button" class="btn btn-primary" data-act="add-friend">Send request</button></div>
    </section>
    ${reqIn.length || reqOut.length ? `<section class="acc-section"><h3>Requests</h3>
      ${reqIn.map((f) => { const o = f.members.find((m) => m !== U.uid); return `<div class="soc-row"><div class="soc-av" aria-hidden="true">${esc(nameOf(o)[0] || '?')}</div><div class="soc-name"><strong>${esc(nameOf(o))}</strong><small>wants to be your friend</small></div>
        <button type="button" class="btn btn-primary sm" data-act="accept" data-id="${esc(f.id)}">Accept</button><button type="button" class="btn btn-ghost sm" data-act="decline" data-id="${esc(f.id)}">Decline</button></div>`; }).join('')}
      ${reqOut.map((f) => { const o = f.members.find((m) => m !== U.uid); return `<div class="soc-row"><div class="soc-av" aria-hidden="true">${esc(nameOf(o)[0] || '?')}</div><div class="soc-name"><strong>${esc(nameOf(o))}</strong><small>waiting for them to accept</small></div>
        <button type="button" class="btn btn-ghost sm" data-act="decline" data-id="${esc(f.id)}">Cancel</button></div>`; }).join('')}
    </section>` : ''}
    <section class="acc-section">
      <h3>Friends${fr.length ? ` (${fr.length})` : ''}</h3>
      ${fr.length ? fr.map((f) => { const o = f.members.find((m) => m !== U.uid); return `<div class="soc-row"><div class="soc-av" aria-hidden="true">${esc(nameOf(o)[0] || '?')}</div><div class="soc-name"><strong>${esc(nameOf(o))}</strong></div>
        <button type="button" class="btn btn-ghost sm" data-act="unfriend" data-id="${esc(f.id)}" aria-label="Remove ${esc(nameOf(o))} from friends">Remove</button></div>`; }).join('')
      : '<p class="muted">No friends yet. Add someone with their code above.</p>'}
    </section>
    <section class="acc-section">
      <h3>Groups${gr.length ? ` (${gr.length})` : ''}</h3>
      ${gr.map(groupHtml).join('')}
      <div class="soc-form"><input id="soc-gname" type="text" maxlength="60" autocomplete="off" placeholder="New group name, for example Study Group" aria-label="New group name"/>
      <button type="button" class="btn btn-primary" data-act="create-group">Create group</button></div>
      <div class="soc-form"><input id="soc-join" type="text" autocomplete="off" spellcheck="false" placeholder="Have an invite? Paste the link or code" aria-label="Invite link or code"/>
      <button type="button" class="btn btn-ghost" data-act="join-group">Join</button></div>
    </section>`;
  restoreInputs(saved);
  if (focus && $('#' + focus)) { const el = $('#' + focus); if (el.tagName === 'INPUT') el.focus(); }
}

function groupHtml(g) {
  const open = S.openGid === g.id, owner = g.role === 'owner';
  let inner = '';
  if (open) {
    inner = `<div class="soc-detail">
      <h4>Members${S.members.length ? ` (${S.members.length})` : ''}</h4>
      ${S.members.length ? S.members.map((m) => `<div class="soc-row sm"><div class="soc-av" aria-hidden="true">${esc((m.name || '?')[0])}</div><div class="soc-name"><strong>${esc(m.name)}${m.uid === U.uid ? ' (you)' : ''}</strong><small>${m.role === 'owner' ? 'Owner' : 'Member'}</small></div>
        ${owner && m.uid !== U.uid ? `<button type="button" class="btn btn-ghost sm" data-act="kick" data-gid="${esc(g.id)}" data-uid="${esc(m.uid)}" aria-label="Remove ${esc(m.name)} from the group">Remove</button>` : ''}</div>`).join('') : '<p class="muted">Loading members…</p>'}
      ${owner ? `<h4>Invite link</h4>${g.invite ? `<div class="soc-link">${esc(link('join=' + g.invite))}</div>
        <div class="row"><button type="button" class="btn btn-ghost sm" data-act="copy-invite" data-code="${esc(g.invite)}">Copy link</button>
        <button type="button" class="btn btn-ghost sm" data-act="new-invite" data-gid="${esc(g.id)}">Make a new link</button>
        <button type="button" class="btn btn-ghost sm" data-act="off-invite" data-gid="${esc(g.id)}">Turn off</button></div>
        <p class="muted">Anyone with the link can join this group. Turn it off or make a new link at any time.</p>`
        : `<p class="muted">No invite link yet. Create one to let people join.</p><button type="button" class="btn btn-primary sm" data-act="new-invite" data-gid="${esc(g.id)}">Create invite link</button>`}`
      : ''}
      <div class="row soc-danger">${owner
        ? `<button type="button" class="btn btn-ghost sm danger" data-act="delete-group" data-gid="${esc(g.id)}">Delete group</button>`
        : `<button type="button" class="btn btn-ghost sm danger" data-act="leave-group" data-gid="${esc(g.id)}">Leave group</button>`}</div>
    </div>`;
  }
  return `<div class="soc-group"><button type="button" class="soc-grow" data-act="toggle-group" data-gid="${esc(g.id)}" aria-expanded="${open}">
    <span class="soc-av sq" aria-hidden="true">${esc((g.name || '?')[0])}</span><span class="soc-name"><strong>${esc(g.name)}</strong><small>${owner ? 'You are the owner' : 'Member'}</small></span><span class="soc-chev" aria-hidden="true">${open ? '▴' : '▾'}</span></button>${inner}</div>`;
}

/* ---------- actions ---------- */
async function run(fn, ok) {
  if (S.busy) return; S.busy = true;
  try { const r = await fn(); S.msg = ok ? { t: typeof ok === 'function' ? ok(r) : ok, ok: true } : null; }
  catch (e) { S.msg = { t: friendly(e), ok: false }; }
  S.busy = false; render();
}
const copy = async (text, doneMsg) => {
  try { await navigator.clipboard.writeText(text); } catch { const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); } catch { /* ignore */ } t.remove(); }
  say(doneMsg);
};
const codeFromLink = (s) => { const m = String(s).match(/[?&]join=([A-Za-z0-9]+)/); return C.cleanCode(m ? m[1] : s); };

async function onClick(e) {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const a = b.dataset.act, id = b.dataset.id, gid = b.dataset.gid;
  const g = gid && S.groups.find((x) => x.id === gid);
  if (a === 'copy-code') return copy(C.fmtCode(S.me.code), 'Friend code copied');
  if (a === 'copy-link') return copy(link('friend=' + S.me.code), 'Invite link copied');
  if (a === 'copy-invite') return copy(link('join=' + b.dataset.code), 'Group link copied');
  if (a === 'add-friend') {
    const code = C.cleanCode($('#soc-add').value);
    if (code.length !== 8) { S.msg = { t: 'Enter the 8-character code (letters and numbers).', ok: false }; return render(); }
    if (code === S.me.code) { S.msg = { t: 'That is your own code.', ok: false }; return render(); }
    return run(async () => {
      const f = await C.lookupCode(code);
      if (!f) throw new Error('No one has this code. Check it and try again.');
      S.names.set(f.uid, f.name); S.prefill = '';
      const r = await C.sendRequest(U.uid, f.uid); track('friend-request');
      const el = $('#soc-add'); if (el) el.value = '';
      return { r, name: f.name };
    }, (x) => ({ sent: `Request sent to ${x.name}. They need to accept it.`, accepted: `You and ${x.name} are now friends.`, friends: `You are already friends with ${x.name}.`, waiting: `You already asked ${x.name}. Waiting for them to accept.` }[x.r]));
  }
  if (a === 'accept') return run(() => C.acceptFriend(id), 'Friend added.');
  if (a === 'decline') return run(() => C.removeFriendship(id), 'Done.');
  if (a === 'unfriend') { if (!confirm('Remove this friend? You can add them again later.')) return; return run(() => C.removeFriendship(id), 'Friend removed.'); }
  if (a === 'create-group') {
    const name = $('#soc-gname').value.trim();
    if (!name) { S.msg = { t: 'Type a name for the group.', ok: false }; return render(); }
    return run(async () => { const gidNew = await C.createGroup(U.uid, S.me.name, name); track('group-created'); S.openGid = gidNew; S.members = []; refreshMembers(gidNew); $('#soc-gname').value = ''; }, 'Group created. Open it to invite people.');
  }
  if (a === 'join-group' || a === 'confirm-join') {
    const code = a === 'confirm-join' ? S.pendingJoin.code : codeFromLink($('#soc-join').value);
    if (code.length < 8) { S.msg = { t: 'Paste the invite link or code.', ok: false }; return render(); }
    return run(async () => { const r = await C.joinGroup(U.uid, S.me.name, code); S.pendingJoin = null; track('group-joined'); const el = $('#soc-join'); if (el) el.value = ''; return r; }, (r) => (r.already ? `You are already in ${r.name}.` : `You joined ${r.name}.`));
  }
  if (a === 'skip-join') { S.pendingJoin = null; return render(); }
  if (a === 'toggle-group') {
    S.openGid = S.openGid === gid ? null : gid; S.members = []; render();
    if (S.openGid) refreshMembers(gid);
    return;
  }
  if (a === 'kick') { if (!confirm('Remove this person from the group?')) return; return run(async () => { await C.removeMember(gid, b.dataset.uid); await refreshMembers(gid); }, 'Member removed.'); }
  if (a === 'new-invite') return run(() => C.createInvite(U.uid, gid, g.name, g.invite), 'New invite link created.');
  if (a === 'off-invite') return run(() => C.revokeInvite(U.uid, gid, g.name, g.invite), 'Invite link turned off.');
  if (a === 'leave-group') { if (!confirm('Leave this group?')) return; return run(async () => { await C.leaveGroup(U.uid, gid); S.openGid = null; }, 'You left the group.'); }
  if (a === 'delete-group') { if (!confirm('Delete this group for everyone? This cannot be undone.')) return; return run(async () => { await C.deleteGroup(U.uid, gid, g.invite); S.openGid = null; }, 'Group deleted.'); }
}

async function refreshMembers(gid) {
  try { const m = await C.groupMembers(gid); if (S.openGid === gid) { S.members = m; render(); } } catch { /* shown as loading until retry */ }
}
