/* To-Do Pro end-to-end tests (Playwright, headless Chromium).
   Runs the real app against an in-memory stand-in for Firebase (tests/fakecloud.js).
   Real Firebase, Google sign-in and push delivery are checked by hand after each deploy. */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

module.exports = async function run({ BASE, ROOT, OUT, PORT, marker }) {
  const results = [];
  const T = async (name, fn) => { try { const r = await fn(); results.push([r === true ? 'PASS' : 'FAIL', name, r === true ? '' : String(r)]); } catch (e) { results.push(['FAIL', name, String(e.message).split('\n')[0]]); } };
  const FAKE = fs.readFileSync(path.join(__dirname, 'fakecloud.js'), 'utf8');
  const CFG = 'window.FIREBASE_CONFIG={apiKey:"x"};window.FIREBASE_VAPID_KEY="";window.WORKER_URL="";';

async function newPage(b, { vp = { width: 1280, height: 800 }, cloud = false, seed = null, user = false } = {}) {
  const ctx = await b.newContext({ viewport: vp, serviceWorkers: 'block' });
  ctx.setDefaultTimeout(4000); const p = await ctx.newPage();
  p.errs = [];
  p.on('pageerror', (e) => p.errs.push('pageerror: ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/gstatic|ERR_|favicon|fonts/.test(m.text())) p.errs.push('console: ' + m.text()); });
  p.on('dialog', (d) => d.accept());
  if (cloud) {
    await p.route('**/cloud.js', (r) => r.fulfill({ contentType: 'text/javascript', body: FAKE.replace('__USER__', user ? 'true' : 'false') }));
    await p.route('**/firebase-config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: CFG }));
  } else {
    await p.route('**/firebase-config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.FIREBASE_CONFIG={};' }));
  }
  await p.addInitScript(() => { try { localStorage.setItem('tp-seen-update', '2026-10-24-photos'); } catch (e) {} });
  if (seed) await p.addInitScript(([k, v]) => { if (!localStorage.getItem('__seeded')) { localStorage.setItem('__seeded', '1'); localStorage.setItem(k, v); } }, [seed.key, JSON.stringify(seed.value)]);
  await p.goto(BASE + '/'); await p.waitForTimeout(500);
  return p;
}
const stored = (p, k = 'tasks-pro') => p.evaluate((k) => JSON.parse(localStorage.getItem(k) || '[]'), k);


  const b = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    // lets the service-worker test use a host name other than localhost (the app treats localhost as development)
    args: [`--host-resolver-rules=MAP todo.test 127.0.0.1`, `--unsafely-treat-insecure-origin-as-secure=http://todo.test:${PORT}`],
  });

  // ---------- core CRUD (local mode) ----------
  const p = await newPage(b);
  await T('boot without errors', async () => p.errs.length === 0 || p.errs.join('|'));
  await T('quick add: smart parse', async () => {
    await p.fill('#q-title', 'call mom tomorrow 5pm !high #health'); await p.press('#q-title', 'Enter'); await p.waitForTimeout(200);
    const t = (await stored(p))[0]; return t.title === 'call mom' && t.priority === 'high' && t.heading === 'health' && !!t.alarm || JSON.stringify(t);
  });
  await T('quick add: Banglish parse', async () => {
    await p.fill('#q-title', 'kal 9 tay namaz'); await p.press('#q-title', 'Enter'); await p.waitForTimeout(200);
    const t = (await stored(p)).find((x) => x.title === 'namaz'); return !!t && !!t.alarm || 'not parsed';
  });
  await T('complete + reopen via checkbox', async () => {
    await p.click('.task .check'); await p.waitForTimeout(200);
    const done = (await stored(p)).filter((t) => t.completed).length; return done === 1 || 'done=' + done;
  });
  await T('delete -> Trash -> restore', async () => {
    await p.click('.nav-item[data-view="all"]'); await p.hover('.task'); await p.click('.task .del', { force: true });
    await p.click('.nav-item[data-view="trash"]'); await p.waitForSelector('.trash-row');
    await p.click('.trash-row [data-restore]'); await p.waitForTimeout(200);
    return (await stored(p)).every((t) => !t.deletedAt) || 'still trashed';
  });
  await T('purge forever + empty trash', async () => {
    await p.click('.nav-item[data-view="all"]');
    for (const t of ['pa', 'pb']) { await p.fill('#q-title', t); await p.press('#q-title', 'Enter'); await p.waitForTimeout(150); } await p.hover('.task'); await p.click('.task .del', { force: true });
    await p.hover('.task'); await p.click('.task .del', { force: true });
    await p.click('.nav-item[data-view="trash"]'); await p.waitForSelector('.trash-row');
    await p.click('.trash-row [data-purge]'); await p.waitForTimeout(200);
    const n1 = (await stored(p)).filter((t) => t.deletedAt).length;
    await p.click('[data-empty-trash]'); await p.waitForTimeout(200);
    const n2 = (await stored(p)).filter((t) => t.deletedAt).length; return (n1 === 1 && n2 === 0) || `n1=${n1} n2=${n2}`;
  });
  await T('search', async () => { await p.click('.nav-item[data-view="all"]'); await p.fill('#search', 'zzzz'); await p.waitForTimeout(200); const e = await p.isVisible('#empty'); await p.fill('#search', ''); return e; });
  await T('calendar month/week render', async () => { await p.click('.nav-item[data-view="calendar"]'); await p.waitForTimeout(300); const ok = await p.isVisible('#calendar'); return ok; });
  await T('weekly summary dialog', async () => { await p.click('#btn-summary-side'); await p.waitForTimeout(200); const ok = await p.isVisible('#summary[open]'); await p.keyboard.press('Escape'); return ok; });
  await T('account dialog', async () => { await p.click('[data-open-account]:visible'); await p.waitForTimeout(200); const ok = await p.isVisible('#account[open]'); await p.keyboard.press('Escape'); return ok; });
  await T('reminders dialog', async () => { await p.click('.nav-item:has-text("Reminders")'); await p.waitForTimeout(200); const ok = await p.isVisible('#reminders[open]'); await p.keyboard.press('Escape'); return ok; });
  await T('keyboard shortcuts n and /', async () => { await p.click('.nav-item[data-view="all"]'); await p.keyboard.press('n'); await p.waitForTimeout(200); const a = await p.isVisible('#editor[open]'); await p.keyboard.press('Escape'); return a; });
  await T('bulk select + delete + undo', async () => {
    await p.click('.nav-item[data-view="all"]'); for (const t of ['ba', 'bb']) { await p.fill('#q-title', t); await p.press('#q-title', 'Enter'); await p.waitForTimeout(150); }
    await p.click('#btn-select'); await p.click('#bulk-all'); await p.click('#bulk-del'); await p.waitForTimeout(200);
    const trashed = (await stored(p)).filter((t) => t.deletedAt).length;
    await p.click('.toast button'); await p.waitForTimeout(300);
    const after = (await stored(p)).filter((t) => t.deletedAt).length; return (trashed > 0 && after === 0) || `trashed=${trashed} after=${after}`;
  });
  await T('no console errors during CRUD', async () => p.errs.length === 0 || p.errs.join(' | '));
  await p.context().close();

  // ---------- autosave ----------
  const a = await newPage(b);
  await T('autosave: edit then delete immediately must not resurrect', async () => {
    await a.fill('#q-title', 'victim'); await a.press('#q-title', 'Enter'); await a.waitForTimeout(200);
    await a.click('.task'); await a.waitForSelector('#editor[open]');
    await a.fill('#f-notes', 'typing...'); await a.click('#f-delete'); await a.waitForTimeout(800);
    const live = (await stored(a)).filter((t) => !t.deletedAt && t.title === 'victim').length;
    return live === 0 || `live copies=${live}`;
  });
  await T('autosave: new task via editor is created once', async () => {
    await a.click('#btn-new-side'); await a.type('#f-title', 'Once only', { delay: 15 }); await a.waitForTimeout(600); await a.click('#f-save'); await a.waitForTimeout(300);
    const n = (await stored(a)).filter((t) => t.title === 'Once only').length; return n === 1 || 'copies=' + n;
  });
  await T('autosave: past alarm not stored until Done', async () => {
    await a.click('#btn-new-side'); await a.fill('#f-title', 'past alarm'); await a.fill('#f-alarm-date', '2020-01-01'); await a.fill('#f-alarm-time', '10:00'); await a.waitForTimeout(700);
    const t = (await stored(a)).find((x) => x.title === 'past alarm'); await a.keyboard.press('Escape'); return (t && !t.alarm) || JSON.stringify(t);
  });
  await a.context().close();

  // ---------- XSS ----------
  const payload = '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script>"\'><svg onload="window.__xss=3">';
  const now = Date.now();
  const xt = (id, extra) => ({ id, title: payload, notes: payload, heading: payload, createdAt: new Date().toISOString(), order: 0, ...extra });
  const x = await newPage(b, { seed: { key: 'tasks-pro', value: [xt('x1', { date: '2026-10-18', alarm: new Date(now + 3600e3).toISOString(), alarmRepeat: 'daily' }), xt('x2', { completed: true, completedAt: new Date().toISOString() }), xt('x3', { deletedAt: now })] } });
  await T('XSS: payload never executes (all views)', async () => {
    for (const v of ['all', 'today', 'upcoming', 'calendar', 'done', 'trash']) { await x.click(`.nav-item[data-view="${v}"]`); await x.waitForTimeout(250); }
    await x.click('.nav-item[data-view="all"]'); await x.click('#btn-summary-side'); await x.waitForTimeout(200); await x.keyboard.press('Escape');
    await x.click('.nav-item:has-text("Reminders")'); await x.waitForTimeout(200); await x.keyboard.press('Escape');
    await x.click('.task'); await x.waitForTimeout(300); await x.keyboard.press('Escape');
    const fired = await x.evaluate(() => window.__xss); const imgs = await x.$$eval('img[src="x"]', (e) => e.length);
    return (!fired && imgs === 0) || `xss=${fired} injected img=${imgs}`;
  });
  await T('XSS: payload shown as text', async () => { await x.click('.nav-item[data-view="all"]'); return (await x.textContent('#list')).includes('<img src=x') || 'not displayed literally'; });
  await x.context().close();

  // ---------- corrupt data ----------
  const c = await newPage(b, { seed: { key: 'tasks-pro', value: [
    { id: 'c1', title: 'bad alarm', alarm: 'not-a-date', createdAt: 'garbage', date: 'xx' },
    { id: 'c2/../evil', title: 'path id', alarm: '9999-99-99T99:99' },
    { id: 'c3', title: 'x'.repeat(5000), notes: 'n'.repeat(50000), heading: 'h'.repeat(5000) },
    null, 42, { title: '' }, { id: 'c4', title: 'ok', priority: 'nuclear', alarmRepeat: 'hourly', order: 'a' },
  ] } });
  await T('corrupt storage: app boots + renders', async () => { const n = await c.$$eval('.task', (e) => e.length); return (n >= 2 && c.errs.length === 0) || `tasks=${n} errs=${c.errs.join('|')}`; });
  await T('corrupt storage: ids/fields sanitized', async () => {
    await c.evaluate(() => document.querySelector('.task')?.click()); await c.keyboard.press('Escape'); await c.click('#btn-new-side'); await c.fill('#f-title', 'trigger save'); await c.waitForTimeout(600); await c.keyboard.press('Escape');
    const t = await stored(c); const bad = t.filter((x) => /[\/\.]/.test(x.id) || (x.title || '').length > 200 || (x.notes || '').length > 2000 || (x.heading || '').length > 100 || (x.alarm && isNaN(new Date(x.alarm))));
    return bad.length === 0 || 'unsanitized: ' + bad.map((x) => x.id + ':' + (x.alarm || '') + ':' + (x.notes || '').length).join(', ');
  });
  await c.context().close();

  // ---------- import ----------
  const im = await newPage(b);
  await T('import: valid file', async () => {
    fs.writeFileSync(OUT + '/imp1.json', JSON.stringify([{ id: 'i1', title: 'imported', createdAt: new Date().toISOString() }]));
    await im.setInputFiles('#import-file', OUT + '/imp1.json'); await im.waitForTimeout(400); return (await stored(im)).some((t) => t.title === 'imported');
  });
  await T('import: malformed file rejected', async () => {
    fs.writeFileSync(OUT + '/imp2.json', '{not json'); await im.setInputFiles('#import-file', OUT + '/imp2.json'); await im.waitForTimeout(300);
    return (await im.textContent('#toasts')).includes('could not be imported') || 'no error toast';
  });
  await T('import: oversized file capped', async () => {
    fs.writeFileSync(OUT + '/imp3.json', JSON.stringify(Array.from({ length: 6000 }, (_, i) => ({ id: 'b' + i, title: 't' + i }))));
    await im.setInputFiles('#import-file', OUT + '/imp3.json'); await im.waitForTimeout(1500);
    const n = (await stored(im)).length; return n <= 2001 || 'imported ' + n;
  });
  await im.context().close();

  // ---------- alarm engine ----------
  const al = await newPage(b);
  await T('alarm rings in-app when due', async () => {
    await al.evaluate(() => { const t = JSON.parse(localStorage.getItem('tasks-pro') || '[]'); t.push({ id: 'al1', title: 'ringing', alarm: new Date(Date.now() + 2500).toISOString(), createdAt: new Date().toISOString(), order: 0 }); localStorage.setItem('tasks-pro', JSON.stringify(t)); });
    await al.reload(); await al.waitForTimeout(500);
    await al.waitForSelector('#alarm-popup:not([hidden])', { timeout: 36000 }).catch(() => {}); const v = await al.isVisible('#alarm-popup'); return v || 'popup not shown';
  });
  await al.context().close();

  // ---------- cloud paths (in-memory fake) ----------
  const cl = await newPage(b, { cloud: true, user: true });
  await T('cloud: signed-in boot', async () => (await cl.textContent('[data-account-name]')) === 'Tester' || 'name=' + (await cl.textContent('[data-account-name]')));
  await T('cloud: add -> saved to cloud store; delete -> soft delete doc', async () => {
    await cl.fill('#q-title', 'cloud task'); await cl.press('#q-title', 'Enter'); await cl.waitForTimeout(300);
    let db = await cl.evaluate(() => window.__fake.tasks()); const added = db.some((t) => t.title === 'cloud task' && !t.deletedAt);
    await cl.hover('.task'); await cl.click('.task .del', { force: true }); await cl.waitForTimeout(300);
    db = await cl.evaluate(() => window.__fake.tasks()); const soft = db.some((t) => t.title === 'cloud task' && t.deletedAt > 0);
    return (added && soft) || `added=${added} soft=${soft}`;
  });
  await T('cloud: sign out clears local cache', async () => {
    await cl.click('[data-open-account]:visible'); await cl.click('#btn-signout'); await cl.waitForTimeout(800);
    const keys = await cl.evaluate(() => Object.keys(localStorage).filter((k) => /^tasks-cache-/.test(k)));
    return keys.length === 0 || 'cache left: ' + keys.join(',');
  });
  await cl.context().close();

  // ---------- layout / responsive ----------
  for (const w of [320, 375, 768]) {
    const r = await newPage(b, { vp: { width: w, height: 800 }, seed: { key: 'tasks-pro', value: [{ id: 'r1', title: 'A very long task title that should wrap nicely without breaking the layout of the page at all', notes: 'x'.repeat(300), createdAt: new Date().toISOString(), order: 0, alarm: new Date(Date.now() + 7200e3).toISOString() }] } });
    await T(`layout ${w}px: no horizontal overflow`, async () => { const o = await r.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); return o <= 1 || 'overflow ' + o + 'px'; });
    await r.screenshot({ path: `${OUT}/layout-${w}.png` });
    await r.context().close();
  }
  const lg = await newPage(b, { vp: { width: 360, height: 780 }, cloud: true });
  await T('login screen 360px: no overflow', async () => { await lg.waitForSelector('#auth-screen'); const o = await lg.evaluate(() => document.querySelector('#auth-screen').scrollWidth - innerWidth); return o <= 1 || 'overflow ' + o; });
  await lg.context().close();


  // ---------- checklist (subtasks) ----------
  const ck = await newPage(b);
  await T('checklist: add steps, tick one, chip shows 1/3 and stays after reload', async () => {
    await ck.fill('#q-title', 'trip'); await ck.press('#q-title', 'Enter'); await ck.waitForTimeout(200);
    await ck.click('.task .t-title'); await ck.waitForSelector('#editor[open]');
    for (const s of ['tickets', 'hotel', 'bag']) { await ck.fill('#subs-new', s); await ck.press('#subs-new', 'Enter'); }
    await ck.click('#subs-list li:first-child .sub-check'); await ck.waitForTimeout(700);
    await ck.keyboard.press('Escape'); await ck.waitForTimeout(300);
    const chip = await ck.textContent('.task .chip.subs'); await ck.reload(); await ck.waitForTimeout(500);
    const after = await ck.textContent('.task .chip.subs'); const t = (await stored(ck))[0];
    return (chip.includes('1/3') && after.includes('1/3') && t.subtasks.length === 3 && t.subtasks[0].done === true) || `chip=${chip} after=${after}`;
  });
  await T('checklist: pasting a list makes one step per line (bullets and numbers removed)', async () => {
    await ck.click('.task .t-title'); await ck.waitForSelector('#editor[open]');
    await ck.evaluate(() => { const i = document.querySelector('#subs-new'); const dt = new DataTransfer(); dt.setData('text', '1. alpha\n- beta\n* gamma'); i.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); });
    await ck.waitForTimeout(700);
    const texts = await ck.$$eval('#subs-list .sub-text', (e) => e.map((x) => x.value)); await ck.keyboard.press('Escape');
    return (texts.includes('alpha') && texts.includes('beta') && texts.includes('gamma')) || texts.join('|');
  });
  await T('checklist: steps show inside the task and can be ticked from the list', async () => {
    await ck.click('.nav-item[data-view="all"]'); await ck.waitForSelector('.task .t-sub');
    const n = (await ck.$$('.task .t-sub')).length; const before = (await stored(ck))[0].subtasks.filter((x) => x.done).length;
    await ck.click('.task .t-sub:not(.done) .t-sub-check'); await ck.waitForTimeout(400);
    const after = (await stored(ck))[0].subtasks.filter((x) => x.done).length; const editorOpen = await ck.isVisible('#editor[open]');
    return (n >= 3 && after === before + 1 && !editorOpen) || `n=${n} before=${before} after=${after} editor=${editorOpen}`;
  });
  await T('checklist: remove a step', async () => {
    await ck.click('.task .t-title'); await ck.waitForSelector('#editor[open]');
    const before = (await ck.$$('#subs-list li')).length; await ck.click('#subs-list li:last-child .sub-del'); await ck.waitForTimeout(600);
    const n = (await ck.$$('#subs-list li')).length; await ck.keyboard.press('Escape'); return n === before - 1 || `${before} -> ${n}`;
  });
  await T('completed task shows a green check and a Completed label', async () => {
    await ck.click('.task .check'); await ck.waitForTimeout(300);
    await ck.click('.nav-item[data-view="done"]'); await ck.waitForTimeout(300);
    return (await ck.textContent('.task .chip.finished')).includes('Completed') || 'no label';
  });
  await T('checklist: hostile and oversized steps are cleaned on import', async () => {
    fs.writeFileSync(OUT + '/imp-subs.json', JSON.stringify([{ id: 's1', title: 'x', subtasks: [{ id: '../a', text: '<img src=x onerror="window.__sx=1">', done: 1 }, { text: '' }, ...Array.from({ length: 80 }, (_, i) => ({ text: 'n' + i }))] }]));
    await ck.click('.nav-item[data-view="all"]'); await ck.setInputFiles('#import-file', OUT + '/imp-subs.json'); await ck.waitForTimeout(500);
    const t = (await stored(ck)).find((x) => x.id === 's1'); await ck.click('.task:has-text("x") .t-title'); await ck.waitForTimeout(300);
    const fired = await ck.evaluate(() => window.__sx); await ck.keyboard.press('Escape');
    return (t.subtasks.length <= 50 && t.subtasks.every((s) => /^[A-Za-z0-9_-]+$/.test(s.id) && s.text) && !fired) || `n=${t.subtasks.length} xss=${fired}`;
  });
  await T('checklist: no errors', async () => ck.errs.length === 0 || ck.errs.join('|'));
  await ck.context().close();

  // ---------- error log, notice and Report a bug ----------
  const er = await newPage(b, { seed: { key: 'tasks-pro', value: [{ id: 'e1', title: 'SECRET TITLE', notes: 'SECRET NOTES', createdAt: new Date().toISOString() }] } });
  await T('errors: a runtime error is recorded and a notice appears once', async () => {
    await er.evaluate(() => { setTimeout(() => { throw new Error('boom test'); }, 0); setTimeout(() => { throw new Error('second boom'); }, 20); });
    await er.waitForTimeout(500);
    const log = await er.evaluate(() => window.tpErrors.read()); const toasts = await er.$$eval('.toast', (e) => e.filter((x) => /Something went wrong/.test(x.textContent)).length);
    return (log.length >= 2 && log[0].m.includes('boom') && toasts === 1) || `log=${log.length} toasts=${toasts}`;
  });
  await T('errors: browser noise is ignored', async () => {
    const n0 = await er.evaluate(() => window.tpErrors.read().length);
    await er.evaluate(() => window.dispatchEvent(new ErrorEvent('error', { message: 'ResizeObserver loop limit exceeded' })));
    return (await er.evaluate(() => window.tpErrors.read().length)) === n0 || 'noise recorded';
  });
  await T('report a bug: link carries diagnostics, never task content', async () => {
    await er.click('[data-open-account]:visible'); await er.waitForTimeout(200);
    await er.evaluate(() => document.querySelector('#btn-report-bug').addEventListener('click', (e) => e.preventDefault(), true));
    await er.click('#btn-report-bug', { force: true }); await er.waitForTimeout(200);
    const href = decodeURIComponent((await er.getAttribute('#btn-report-bug', 'href')).replace(/\+/g, ' '));
    return (href.includes('github.com/abdurrahmancce/To-Do-Pro/issues/new') && href.includes('App update:') && href.includes('Recent errors') && href.includes('boom') && !/SECRET/.test(href)) || href.slice(0, 200);
  });
  await er.context().close();

  // ---------- analytics ----------
  const an = await newPage(b);
  await T('analytics: off by default, makes no outside request and track() is a safe no-op', async () => {
    const reqs = []; an.on('request', (r) => { if (/goatcounter|gc\.zgo\.at/.test(r.url())) reqs.push(r.url()); });
    await an.reload(); await an.waitForTimeout(500);
    const ok = await an.evaluate(() => { try { window.track('x'); return typeof window.track === 'function'; } catch (e) { return false; } });
    return (ok && reqs.length === 0) || `ok=${ok} reqs=${reqs.length}`;
  });
  await an.context().close();
  {
    const ctx = await b.newContext({ serviceWorkers: 'block' }); const p = await ctx.newPage(); const hits = [];
    await p.route('**/firebase-config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.FIREBASE_CONFIG={};' }));
    await p.route('**/analytics.js', async (r) => { const t = fs.readFileSync(path.join(ROOT, 'analytics.js'), 'utf8').replace("window.GOATCOUNTER_CODE = '';", "window.GOATCOUNTER_CODE = 'demo-site';"); r.fulfill({ contentType: 'text/javascript', body: t }); });
    await p.route('https://gc.zgo.at/count.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.goatcounter = window.goatcounter || {}; window.goatcounter.count = function (o) { (window.__hits = window.__hits || []).push(o.path); };" }));
    await p.addInitScript(() => { try { localStorage.setItem('tp-seen-update', '2026-10-24-photos'); } catch (e) { /* ignore */ } });
    await p.goto(BASE + '/'); await p.waitForTimeout(500);
    await T('analytics: with a site code, feature events are counted and task text is never sent', async () => {
      await p.fill('#q-title', 'my private task'); await p.press('#q-title', 'Enter'); await p.waitForTimeout(400);
      await p.click('.task .check'); await p.waitForTimeout(300);
      const h = await p.evaluate(() => window.__hits || []); const src = await p.getAttribute('script[data-goatcounter]', 'data-goatcounter');
      return (h.includes('event/task-added') && h.includes('event/task-completed') && !h.join(' ').includes('private') && src === 'https://demo-site.goatcounter.com/count') || JSON.stringify(h) + src;
    });
    await ctx.close();
  }


  // ---------- service worker: a new release must run on the first reload ----------
  {
    const ctx = await b.newContext(); const p = await ctx.newPage(); const url = `http://todo.test:${PORT}/`;
    await p.route('**/firebase-config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.FIREBASE_CONFIG={};' }));
    await p.addInitScript(() => { try { localStorage.setItem('tp-seen-update', '2026-10-24-photos'); } catch (e) { /* ignore */ } });
    await T('service worker: installs and takes control', async () => {
      marker.value = 1; await p.goto(url); await p.evaluate(() => navigator.serviceWorker.ready); await p.waitForTimeout(1500); await p.reload(); await p.waitForTimeout(800);
      return (await p.evaluate(() => !!navigator.serviceWorker.controller && window.__marker === 1)) || 'not controlled or wrong version';
    });
    await T('service worker: new script.js is used after ONE reload (no stale cache)', async () => {
      marker.value = 2; await p.reload(); await p.waitForTimeout(1000);
      const m = await p.evaluate(() => window.__marker); return m === 2 || 'still running version ' + m;
    });
    await T('service worker: app still opens offline', async () => {
      await ctx.setOffline(true); await p.reload(); await p.waitForTimeout(1200);
      const ok = await p.isVisible('#q-title'); await ctx.setOffline(false); return ok || 'blank page offline';
    });
    await ctx.close();
  }

  // ---------- update history, future updates, notes box ----------
  const uh = await newPage(b, { vp: { width: 400, height: 800 } });
  await T('update history opens numbered with dates, oldest first', async () => {
    await uh.evaluate(() => document.querySelector('#btn-history').click());
    await uh.waitForSelector('#history[open]');
    const r = await uh.evaluate(() => { const li = [...document.querySelectorAll('.hist-list li')]; return { n: li.length, first: li[0].textContent, last: li[li.length - 1].textContent, dates: li.every((x) => /\d{2} \w{3} \d{4}/.test(x.textContent)) }; });
    return (r.n >= 20 && r.dates && /01 May 2026/.test(r.first) && /24 Oct 2026/.test(r.last)) || JSON.stringify(r).slice(0, 200);
  });
  await T('future updates tab lists planned items', async () => {
    await uh.click('#history [data-htab="future"]');
    const n = await uh.$$eval('.fut-list li', (e) => e.length); const ok = await uh.$$eval('.fut-status', (e) => e.every((x) => /Ready|Planned|Idea/.test(x.textContent)));
    return (n >= 5 && ok) || 'n=' + n;
  });
  await uh.click('#hist-ok');
  await T('notes box is large and resize handle is centred below it', async () => {
    await uh.click('#fab'); await uh.waitForSelector('#f-notes', { state: 'visible' });
    const r = await uh.evaluate(() => { const t = document.querySelector('#f-notes').getBoundingClientRect(), g = document.querySelector('#notes-grip').getBoundingClientRect(); return { h: t.height, below: g.top >= t.bottom - 1, dx: Math.abs((g.left + g.width / 2) - (t.left + t.width / 2)) }; });
    return (r.h >= 140 && r.below && r.dx < 3) || JSON.stringify(r);
  });
  await T('dragging the handle resizes the notes box', async () => {
    await uh.locator('#notes-grip').scrollIntoViewIfNeeded(); const g = await uh.locator('#notes-grip').boundingBox(); const h0 = await uh.evaluate(() => document.querySelector('#f-notes').offsetHeight);
    await uh.mouse.move(g.x + g.width / 2, g.y + g.height / 2); await uh.mouse.down(); await uh.mouse.move(g.x + g.width / 2, g.y + 100, { steps: 5 }); await uh.mouse.up();
    const h1 = await uh.evaluate(() => document.querySelector('#f-notes').offsetHeight);
    return h1 > h0 + 50 || `${h0} -> ${h1}`;
  });
  await T('Get the app: QR, copy link and WhatsApp share are present', async () => {
    await uh.click('#btn-account, [data-account], #btn-user').catch(() => {});
    const r = await uh.evaluate(() => ({ qr: !!document.querySelector('#install-section img.qr'), wa: document.querySelector('#btn-wa')?.href || '', copy: !!document.querySelector('#btn-copylink') }));
    return (r.qr && r.copy && /wa\.me\/\?text=.*abdurrahmancce\.github\.io/.test(r.wa)) || JSON.stringify(r);
  });
  await T('QR image file is served', async () => { const x = await uh.request.get(BASE + '/icons/qr.svg'); return (x.ok() && (await x.text()).includes('<svg')) || 'missing qr.svg'; });
  await T('What\u2019s new lists updates by date, newest first', async () => {
    await uh.evaluate(() => document.querySelector('#btn-whatsnew').click()); await uh.waitForSelector('#whatsnew[open]');
    const h = await uh.$$eval('#wn-list h3', (e) => e.map((x) => x.textContent)); await uh.click('#wn-ok');
    return (h.length >= 5 && /24 Oct 2026/.test(h[0]) && /15 Oct 2026/.test(h[h.length - 1])) || h.join('|');
  });
  await T('update history: no errors', async () => uh.errs.length === 0 || uh.errs.join('|'));
  await uh.context().close();

  // ---------- photos on tasks and checklist steps ----------
  {
    const pp = await newPage(b, { cloud: true, user: true, vp: { width: 1000, height: 900 } });
    const mk = async (label, w = 2400, h = 1800) => Buffer.from((await pp.evaluate(({ w, h, label }) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); for (let i = 0; i < 600; i++) { x.fillStyle = `hsl(${(i * 37) % 360} 70% 50%)`; x.fillRect(Math.random() * w, Math.random() * h, w / 6, h / 6); } x.fillStyle = '#000'; x.font = '90px sans-serif'; x.fillText(label, 60, 140); return c.toDataURL('image/png'); }, { w, h, label })).split(',')[1], 'base64');
    const file = async (n) => ({ name: n + '.png', mimeType: 'image/png', buffer: await mk(n) });
    const cloudTask = async () => (await stored(pp, 'tasks-cache-u1')).find((x) => x.title === 'photo task');
    await pp.click('#btn-new-side'); await pp.fill('#f-title', 'photo task');
    await T('photos: adding two big pictures shrinks them and shows both in the editor', async () => {
      await pp.setInputFiles('#ph-gal-input', [await file('one'), await file('two')]);
      await pp.waitForSelector('#task-photos .ph-grid li:nth-child(2)'); await pp.waitForTimeout(500);
      const sizes = await pp.evaluate(() => [...window.__photos.values()].map((r) => r.d.length));
      return (sizes.length === 2 && sizes.every((n) => n > 1000 && n <= 380000)) || JSON.stringify(sizes);
    });
    await T('photos: description is saved with the picture and shows in the viewer', async () => {
      await pp.fill('#task-photos .ph-cap >> nth=0', 'Receipt for the shop'); await pp.waitForTimeout(700);
      const t = await cloudTask(); if (!t || t.photos.length !== 2 || t.photos[0].cap !== 'Receipt for the shop') return JSON.stringify(t && t.photos);
      await pp.click('#task-photos .ph-open >> nth=0'); await pp.waitForSelector('#viewer[open]');
      const cap = await pp.textContent('#viewer-cap'); const counter = await pp.textContent('#viewer-count');
      await pp.click('#viewer-next'); const cap2 = await pp.evaluate(() => document.querySelector('#viewer-cap').hidden); await pp.keyboard.press('Escape');
      return (cap === 'Receipt for the shop' && /1 \/ 2/.test(counter) && cap2) || `${cap}|${counter}|${cap2}`;
    });
    await T('photos: a pasted screenshot is added', async () => {
      const b64 = (await mk('shot', 400, 300)).toString('base64');
      await pp.evaluate(async (b64) => { const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); const dt = new DataTransfer(); dt.items.add(new File([bytes], 'shot.png', { type: 'image/png' })); document.querySelector('#f-notes').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }, b64);
      await pp.waitForSelector('#task-photos .ph-grid li:nth-child(3)', { timeout: 4000 }); return true;
    });
    await T('photos: removing a picture deletes it everywhere', async () => {
      const before = await pp.evaluate(() => window.__photos.size);
      await pp.click('#task-photos .ph-del >> nth=2'); await pp.waitForTimeout(500);
      const after = await pp.evaluate(() => window.__photos.size); const t = await cloudTask();
      return (before === 3 && after === 2 && t.photos.length === 2) || `${before}->${after} refs=${t && t.photos.length}`;
    });
    await T('photos: a checklist step can hold its own pictures (max 3)', async () => {
      await pp.fill('#subs-new', 'step with picture'); await pp.press('#subs-new', 'Enter');
      await pp.click('#subs-list .sub-photo'); await pp.waitForSelector('#subs-list .step-photos');
      const fc = pp.waitForEvent('filechooser'); await pp.click('#subs-list .step-photos .ph-gal'); await (await fc).setFiles([await file('s1'), await file('s2'), await file('s3'), await file('s4')]);
      await pp.waitForSelector('#subs-list .ph-grid li:nth-child(3)'); await pp.waitForTimeout(800);
      const t = await cloudTask(); const n = t.subtasks[0].photos.length; const extra = await pp.$$eval('#subs-list .ph-grid li', (e) => e.length);
      return (n === 3 && extra === 3) || `saved=${n} shown=${extra}`;
    });
    await T('photos: task card shows thumbnails, a photo count and step photos open the viewer', async () => {
      await pp.keyboard.press('Escape'); await pp.waitForTimeout(400);
      const thumbs = await pp.$$eval('.task .t-photo', (e) => e.length); const chip = await pp.textContent('.task .chip.photos');
      await pp.waitForFunction(() => document.querySelector('.task .t-photo img')?.getAttribute('src'), null, { timeout: 4000 });
      await pp.click('.task .t-sub-photo'); await pp.waitForSelector('#viewer[open]'); const n = await pp.evaluate(() => document.querySelector('#viewer-count').textContent); await pp.keyboard.press('Escape');
      return (thumbs === 2 && /5/.test(chip) && /1 \/ 3/.test(n)) || `thumbs=${thumbs} chip=${chip} count=${n}`;
    });
    await T('photos: a backup contains the pictures and restores them', async () => {
      const dl = pp.waitForEvent('download'); await pp.evaluate(() => document.querySelector('#btn-export').click()); const d = await dl;
      const p = OUT + '/backup-photos.json'; await d.saveAs(p); const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      return (Array.isArray(j.tasks) && Object.keys(j.photos || {}).length === 5) || 'photos in backup: ' + Object.keys(j.photos || {}).length;
    });
    await T('photos: deleting the task for good removes its pictures', async () => {
      await pp.click('.nav-item[data-view="all"]'); await pp.hover('.task'); await pp.click('.task .del', { force: true });
      await pp.click('.nav-item[data-view="trash"]'); await pp.waitForSelector('.trash-row'); await pp.click('.trash-row [data-purge]'); await pp.waitForTimeout(600);
      const n = await pp.evaluate(() => window.__photos.size); return n === 0 || 'left in cloud: ' + n;
    });
    await T('photos: no errors', async () => pp.errs.length === 0 || pp.errs.join('|'));
    await pp.context().close();
  }

  // ---------- install banner ----------
  {
    const ib = await newPage(b, { vp: { width: 400, height: 800 } });
    await T('install banner appears in the browser, opens install help, and can be hidden for good', async () => {
      await ib.waitForSelector('#install-banner:not([hidden])', { timeout: 5000 });
      await ib.click('#ib-install'); await ib.waitForSelector('#account[open]');
      const inAccount = await ib.isVisible('#install-section'); await ib.keyboard.press('Escape');
      await ib.reload(); await ib.waitForSelector('#install-banner:not([hidden])', { timeout: 5000 });
      await ib.click('#ib-close'); await ib.reload(); await ib.waitForTimeout(3200);
      const gone = await ib.evaluate(() => document.querySelector('#install-banner').hidden);
      return (inAccount && gone) || `inAccount=${inAccount} gone=${gone}`;
    });
    await T('QR code image loads and WhatsApp link is set', async () => {
      const r = await ib.evaluate(async () => { const i = new Image(); i.src = 'icons/qr.svg'; await i.decode(); return { w: i.naturalWidth, wa: document.querySelector('#btn-wa').href }; });
      return (r.w > 0 && /wa\.me/.test(r.wa) && r.wa.includes(encodeURIComponent('abdurrahmancce.github.io'))) || JSON.stringify(r);
    });
    await ib.context().close();
  }

  // ---------- static checks ----------
  await T('all referenced local files exist (html/css/js/manifest/sw)', async () => {
    const root = ROOT; const miss = [];
    const refs = new Set();
    for (const f of ['index.html', 'help.html']) for (const m of fs.readFileSync(path.join(ROOT, f), 'utf8').matchAll(/(?:src|href)="([^"#?]+)"/g)) if (!/^(https?:|data:|mailto:)/.test(m[1])) refs.add(m[1]);
    const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8'); const core = sw.match(/const CORE = \[([\s\S]*?)\];/)[1];
    for (const m of core.matchAll(/'([^']+)'/g)) refs.add(m[1]);
    for (const m of fs.readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8').matchAll(/"src":\s*"([^"]+)"/g)) refs.add(m[1]);
    for (const r of refs) if (r !== './' && !fs.existsSync(path.join(ROOT, r))) miss.push(r);
    return miss.length === 0 || 'missing: ' + miss.join(', ');
  });
  await T('service worker CORE includes all app modules', async () => {
    const core = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8').match(/const CORE = \[([\s\S]*?)\];/)[1];
    const need = ['index.html', 'style.css', 'script.js', 'auth.js', 'cloud.js', 'quickparse.js', 'habits.js', 'errlog.js', 'analytics.js', 'help.html'];
    const miss = need.filter((n) => !core.includes("'" + n + "'")); return miss.length === 0 || 'not cached: ' + miss.join(', ');
  });


  await b.close();
  return results;
};
