/* =====================================================
   auth.js — animated email + password login screen
   Used by script.js:  const a = await import('./auth.js'); a.showLogin(cloud, { onSkip })
   ===================================================== */
const T = {
  en: {
    tagline: 'Your tasks, on every device.',
    sub: 'Sign in once. Your list, reminders and streaks follow you from phone to laptop.',
    signin: 'Sign in', signup: 'Create account', reset: 'Reset password',
    h_signin: 'Welcome back', h_signup: 'Create your account', h_reset: 'Reset your password',
    p_signin: 'Sign in with your email and password.', p_signup: 'It takes less than a minute and it is free.', p_reset: 'Enter your email and we will send a reset link.',
    name: 'Name', name_ph: 'Your name', email: 'Email', pass: 'Password', pass_new: 'Password (6+ characters)',
    show: 'Show password', hide: 'Hide password',
    forgot: 'Forgot password?', to_signup: 'New here? Create an account', to_signin: 'Have an account? Sign in', back: 'Back to sign in',
    send: 'Send reset link', skip: 'Continue without an account', skip_note: 'Tasks stay on this device only.',
    google: 'Continue with Google', or: 'or',
    s_weak: 'Weak', s_fair: 'Fair', s_good: 'Good', s_strong: 'Strong',
    sent: 'Reset link sent. Check your inbox (and spam folder).',
    done: 'Signed in',
    r1: 'Pay electricity bill', r2: 'Team call at 4:30', r3: 'Buy groceries', r4: 'Read 20 pages',
    streak: 'day streak', phone: 'Phone', laptop: 'Laptop', synced: 'Synced',
    e_email: 'Enter a valid email address.', e_pass: 'Enter your password.', e_short: 'Password must be at least 6 characters.',
    'auth/invalid-credential': 'Email or password is wrong. Check both and try again.',
    'auth/wrong-password': 'Email or password is wrong. Check both and try again.',
    'auth/user-not-found': 'No account with this email. Create one instead.',
    'auth/email-already-in-use': 'This email already has an account. Sign in instead.',
    'auth/weak-password': 'Password must be at least 6 characters.',
    'auth/invalid-email': 'Enter a valid email address.',
    'auth/too-many-requests': 'Too many attempts. Wait a few minutes, then try again.',
    'auth/network-request-failed': 'No internet connection. Connect and try again.',
    'auth/operation-not-allowed': 'Email/password sign-in is not turned on in Firebase yet (Authentication → Sign-in method).',
    'auth/unauthorized-domain': 'This domain is not authorized in Firebase → Authentication → Settings → Authorized domains.',
    other: 'Something went wrong. Try again.',
  },
  bn: {
    tagline: 'আপনার টাস্ক, সব ডিভাইসে।',
    sub: 'একবার সাইন ইন করুন। লিস্ট, রিমাইন্ডার আর স্ট্রিক ফোন থেকে ল্যাপটপে সাথে থাকবে।',
    signin: 'সাইন ইন', signup: 'অ্যাকাউন্ট খুলুন', reset: 'পাসওয়ার্ড রিসেট',
    h_signin: 'আবার স্বাগতম', h_signup: 'নতুন অ্যাকাউন্ট খুলুন', h_reset: 'পাসওয়ার্ড রিসেট করুন',
    p_signin: 'ইমেইল ও পাসওয়ার্ড দিয়ে সাইন ইন করুন।', p_signup: 'এক মিনিটের কম সময় লাগবে, সম্পূর্ণ ফ্রি।', p_reset: 'ইমেইল দিন, আমরা রিসেট লিংক পাঠাব।',
    name: 'নাম', name_ph: 'আপনার নাম', email: 'ইমেইল', pass: 'পাসওয়ার্ড', pass_new: 'পাসওয়ার্ড (কমপক্ষে ৬ অক্ষর)',
    show: 'পাসওয়ার্ড দেখুন', hide: 'পাসওয়ার্ড লুকান',
    forgot: 'পাসওয়ার্ড ভুলে গেছেন?', to_signup: 'নতুন? অ্যাকাউন্ট খুলুন', to_signin: 'অ্যাকাউন্ট আছে? সাইন ইন করুন', back: 'সাইন ইনে ফিরে যান',
    send: 'রিসেট লিংক পাঠান', skip: 'অ্যাকাউন্ট ছাড়া চালিয়ে যান', skip_note: 'টাস্ক শুধু এই ডিভাইসে থাকবে।',
    google: 'Google দিয়ে চালিয়ে যান', or: 'অথবা',
    s_weak: 'দুর্বল', s_fair: 'মোটামুটি', s_good: 'ভালো', s_strong: 'শক্তিশালী',
    sent: 'রিসেট লিংক পাঠানো হয়েছে। ইনবক্স (এবং স্প্যাম ফোল্ডার) দেখুন।',
    done: 'সাইন ইন হয়েছে',
    r1: 'বিদ্যুৎ বিল দেওয়া', r2: 'বিকেল ৪:৩০ এ টিম কল', r3: 'বাজার করা', r4: '২০ পৃষ্ঠা পড়া',
    streak: 'দিনের স্ট্রিক', phone: 'ফোন', laptop: 'ল্যাপটপ', synced: 'সিঙ্ক হয়েছে',
    e_email: 'সঠিক ইমেইল ঠিকানা দিন।', e_pass: 'পাসওয়ার্ড দিন।', e_short: 'পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।',
    'auth/invalid-credential': 'ইমেইল বা পাসওয়ার্ড ভুল। দুটোই আবার দেখে চেষ্টা করুন।',
    'auth/wrong-password': 'ইমেইল বা পাসওয়ার্ড ভুল। দুটোই আবার দেখে চেষ্টা করুন।',
    'auth/user-not-found': 'এই ইমেইলে কোনো অ্যাকাউন্ট নেই। নতুন অ্যাকাউন্ট খুলুন।',
    'auth/email-already-in-use': 'এই ইমেইলে আগেই অ্যাকাউন্ট আছে। সাইন ইন করুন।',
    'auth/weak-password': 'পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।',
    'auth/invalid-email': 'সঠিক ইমেইল ঠিকানা দিন।',
    'auth/too-many-requests': 'অনেকবার চেষ্টা হয়েছে। কয়েক মিনিট পরে আবার চেষ্টা করুন।',
    'auth/network-request-failed': 'ইন্টারনেট সংযোগ নেই। সংযোগ দিয়ে আবার চেষ্টা করুন।',
    'auth/operation-not-allowed': 'Firebase-এ Email/Password সাইন-ইন এখনো চালু করা হয়নি (Authentication → Sign-in method)।',
    'auth/unauthorized-domain': 'এই ডোমেইন Firebase → Authentication → Settings → Authorized domains-এ যোগ করা নেই।',
    other: 'কিছু একটা সমস্যা হয়েছে। আবার চেষ্টা করুন।',
  },
};

const LANG_KEY = 'tp-auth-lang';
const ls = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const GOOGLE = '<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.7 6c4.5-4.2 6.9-10.3 6.9-17.7z"/><path fill="#FBBC05" d="M10.5 28.7c-.5-1.4-.8-3-.8-4.7s.3-3.2.8-4.7l-7.9-6.1C.9 16.5 0 20.1 0 24s.9 7.5 2.6 10.8l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.7-6c-2.1 1.4-4.9 2.3-8.2 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/></svg>';
const CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const EYE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18M10.6 5.1A9.6 9.6 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.6 6.6A16.6 16.6 0 0 0 2 12s3.6 7 10 7a9.7 9.7 0 0 0 4.4-1.1M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';

let root = null, cloudApi = null, opts = {}, lang = 'en', mode = 'signin', busy = false, timer = null;
const t = (k) => T[lang][k] ?? T.en[k] ?? k;

function stageHTML() {
  const rows = ['r1', 'r2', 'r3', 'r4'].map((k, i) =>
    `<li class="ax-row" data-i="${i}"><span class="ax-box">${CHECK}</span><span class="ax-txt" data-t="${k}">${esc(t(k))}</span></li>`).join('');
  return `
  <div class="ax-aurora" aria-hidden="true"><i></i><i></i><i></i></div>
  <div class="ax-brand"><svg class="ax-logo" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><path d="m8.5 12.5 2.5 2.5 4.5-5"/></svg><b>To-Do Pro</b></div>
  <div class="ax-copy"><h1 data-t="tagline">${esc(t('tagline'))}</h1><p data-t="sub">${esc(t('sub'))}</p></div>
  <div class="ax-scene" aria-hidden="true">
    <div class="ax-card">
      <ul class="ax-list">${rows}</ul>
      <div class="ax-foot"><span class="ax-flame">🔥</span><b class="ax-n">3</b><span data-t="streak">${esc(t('streak'))}</span></div>
    </div>
    <div class="ax-bell"><svg viewBox="0 0 24 24"><path d="M6 9a6 6 0 1 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg><span class="ax-wave"></span><span class="ax-wave w2"></span></div>
    <div class="ax-dev d1"><span data-t="phone">${esc(t('phone'))}</span><i></i></div>
    <div class="ax-dev d2"><span data-t="laptop">${esc(t('laptop'))}</span><i></i></div>
  </div>`;
}

function formHTML() {
  const su = mode === 'signup', rs = mode === 'reset';
  return `
  <div class="ax-top">
    <div class="ax-lang" role="group" aria-label="Language">
      <button type="button" data-lang="en" aria-pressed="${lang === 'en'}">EN</button>
      <button type="button" data-lang="bn" aria-pressed="${lang === 'bn'}">বাং</button>
    </div>
  </div>
  <div class="ax-formwrap">
    <h2 id="ax-h">${esc(t('h_' + mode))}</h2>
    <p class="ax-p">${esc(t('p_' + mode))}</p>
    <form id="ax-form" novalidate autocomplete="on">
      ${su ? `<label class="ax-f"><span>${esc(t('name'))}</span><input name="name" type="text" autocomplete="name" placeholder="${esc(t('name_ph'))}" maxlength="60"></label>` : ''}
      <label class="ax-f"><span>${esc(t('email'))}</span><input name="email" type="email" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false" required></label>
      ${rs ? '' : `<label class="ax-f"><span>${esc(t(su ? 'pass_new' : 'pass'))}</span>
        <span class="ax-pw"><input name="password" type="password" autocomplete="${su ? 'new-password' : 'current-password'}" required minlength="6">
        <button type="button" class="ax-eye" aria-label="${esc(t('show'))}" aria-pressed="false">${EYE}</button></span></label>
        ${su ? `<div class="ax-meter" aria-hidden="true"><i></i><i></i><i></i><i></i><em></em></div>` : ''}`}
      <div class="ax-msg" id="ax-msg" role="alert" aria-live="polite"></div>
      <button type="submit" class="ax-submit"><span class="ax-lbl">${esc(t(rs ? 'send' : mode))}</span><span class="ax-spin"></span><span class="ax-ok">${CHECK}</span></button>
    </form>
    ${mode === 'signin' ? `<button type="button" class="ax-link-btn" data-go="reset">${esc(t('forgot'))}</button>` : ''}
    ${rs ? `<button type="button" class="ax-link-btn" data-go="signin">${esc(t('back'))}</button>` : ''}
    ${rs ? '' : `<div class="ax-or"><span>${esc(t('or'))}</span></div>
      <button type="button" class="ax-google" data-google>${GOOGLE}<span>${esc(t('google'))}</span></button>
      <button type="button" class="ax-link-btn strong" data-go="${su ? 'signin' : 'signup'}">${esc(t(su ? 'to_signin' : 'to_signup'))}</button>`}
    <div class="ax-skip"><button type="button" data-skip>${esc(t('skip'))}</button><small>${esc(t('skip_note'))}</small></div>
  </div>`;
}

function build() {
  root = document.createElement('div');
  root.id = 'auth-screen'; root.className = 'ax';
  root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-labelledby', 'ax-h');
  root.innerHTML = `<section class="ax-stage">${stageHTML()}</section><section class="ax-panel"></section>`;
  document.body.appendChild(root);
  root.addEventListener('click', onClick);
  renderForm();
  startStage();
}

function renderForm(focus = true) {
  const panel = root.querySelector('.ax-panel');
  panel.innerHTML = formHTML();
  const form = panel.querySelector('#ax-form');
  form.addEventListener('submit', onSubmit);
  const pw = form.elements.password;
  if (pw && mode === 'signup') pw.addEventListener('input', () => meter(pw.value));
  if (focus && matchMedia('(hover: hover)').matches) (form.elements.name || form.elements.email).focus();
}

function meter(v) {
  let s = 0;
  if (v.length >= 6) s++;
  if (v.length >= 10) s++;
  if (/[A-Z]/.test(v) && /[a-z]/.test(v)) s++;
  if (/\d/.test(v) && /[^A-Za-z0-9]/.test(v) || v.length >= 14) s++;
  if (!v) s = 0;
  const m = root.querySelector('.ax-meter');
  if (!m) return;
  m.dataset.s = s;
  m.querySelector('em').textContent = s ? t(['', 's_weak', 's_fair', 's_good', 's_strong'][s]) : '';
}

function setMsg(text, ok = false) {
  const el = root.querySelector('#ax-msg');
  el.textContent = text || ''; el.className = 'ax-msg' + (text ? (ok ? ' ok' : ' err') : '');
}
const errText = (e) => (e?.code && T[lang][e.code]) || t('other');

function setBusy(b) {
  busy = b;
  const btn = root.querySelector('.ax-submit');
  if (btn) { btn.classList.toggle('busy', b); btn.disabled = b; }
}

async function onSubmit(ev) {
  ev.preventDefault();
  if (busy) return;
  const f = ev.target.elements;
  const email = f.email.value.trim(), password = f.password ? f.password.value : '';
  setMsg('');
  if (!/^\S+@\S+\.\S+$/.test(email)) { setMsg(t('e_email')); f.email.focus(); return shake(); }
  if (mode !== 'reset') {
    if (!password) { setMsg(t('e_pass')); f.password.focus(); return shake(); }
    if (mode === 'signup' && password.length < 6) { setMsg(t('e_short')); f.password.focus(); return shake(); }
  }
  setBusy(true);
  try {
    if (mode === 'reset') { await cloudApi.resetPassword(email); setBusy(false); setMsg(t('sent'), true); return; }
    if (mode === 'signup') await cloudApi.emailSignUp((f.name?.value || '').trim(), email, password);
    else await cloudApi.emailSignIn(email, password);
    const btn = root.querySelector('.ax-submit'); btn.classList.remove('busy'); btn.classList.add('ok');
    root.querySelector('.ax-lbl').textContent = t('done');
    // script.js hides this screen from handleAuth() once Firebase reports the user
  } catch (e) {
    console.warn('auth error', e?.code || e);
    setBusy(false); setMsg(errText(e)); shake();
  }
}

function shake() {
  const w = root.querySelector('.ax-formwrap');
  w.classList.remove('shake'); void w.offsetWidth; w.classList.add('shake');
}

async function onClick(ev) {
  const b = ev.target.closest('button'); if (!b) return;
  if (b.dataset.lang) { lang = b.dataset.lang; ls.set(LANG_KEY, lang); applyLang(); return; }
  if (b.dataset.go) { mode = b.dataset.go; renderForm(); return; }
  if (b.classList.contains('ax-eye')) {
    const inp = b.parentElement.querySelector('input'); const show = inp.type === 'password';
    inp.type = show ? 'text' : 'password'; b.innerHTML = show ? EYE_OFF : EYE;
    b.setAttribute('aria-pressed', String(show)); b.setAttribute('aria-label', t(show ? 'hide' : 'show')); return;
  }
  if (b.dataset.skip !== undefined) { ls.set('tp-guest', '1'); hideLogin(); opts.onSkip?.(); return; }
  if (b.dataset.google !== undefined) {
    if (busy) return; setMsg('');
    try { await cloudApi.signIn(); } catch (e) { setMsg(errText(e)); shake(); }
  }
}

function applyLang() {
  const keep = root.querySelector('#ax-form') ? { email: root.querySelector('[name=email]')?.value || '' } : {};
  root.lang = lang;
  root.querySelectorAll('.ax-stage [data-t]').forEach((el) => { el.textContent = t(el.dataset.t); });
  renderForm(false);
  const em = root.querySelector('[name=email]'); if (em) em.value = keep.email;
}

/* ---- live stage: tasks tick themselves off, streak counts up, bell rings ---- */
function startStage() {
  const rows = [...root.querySelectorAll('.ax-row')];
  const n = root.querySelector('.ax-n');
  const bell = root.querySelector('.ax-bell');
  let i = 0, streak = 3;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) { rows[0].classList.add('done'); rows[2].classList.add('done'); return; }
  const tick = () => {
    if (!root) return;
    const r = rows[i % rows.length];
    if (i % rows.length === 0) rows.forEach((x) => x.classList.remove('done'));
    r.classList.add('done');
    bell.classList.remove('ringing'); void bell.offsetWidth; bell.classList.add('ringing');
    if (i % rows.length === rows.length - 1) { streak++; n.textContent = String(streak); n.classList.remove('pop'); void n.offsetWidth; n.classList.add('pop'); }
    i++;
    timer = setTimeout(tick, i % rows.length === 0 ? 2200 : 1250);
  };
  timer = setTimeout(tick, 900);
}

export function showLogin(cloud, o = {}) {
  cloudApi = cloud; opts = o;
  if (root) { root.hidden = false; root.classList.remove('leaving'); return; }
  lang = ls.get(LANG_KEY) || ((navigator.language || '').toLowerCase().startsWith('bn') ? 'bn' : 'en');
  mode = o.mode || 'signin';
  build();
  root.lang = lang;
  document.documentElement.classList.add('ax-lock');
}

export function hideLogin() {
  document.documentElement.classList.remove('ax-lock');
  if (!root) return;
  const el = root; root = null; clearTimeout(timer);
  el.classList.add('leaving');
  setTimeout(() => el.remove(), 380);
}
export const isGuest = () => ls.get('tp-guest') === '1';
export const clearGuest = () => ls.set('tp-guest', '');
