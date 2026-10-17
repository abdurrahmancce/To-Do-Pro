/* =====================================================
   To-Do Pro — reminder push worker (Cloudflare Workers, free plan)
   Every minute:
     1. read due docs from Firestore  reminders/{taskId}  (alarm <= now)
     2. send a push to every device in users/{uid}/devices (FCM HTTP v1)
     3. mark the task fired (or move a repeating alarm to its next time)
   Secret required:  SERVICE_ACCOUNT_JSON  (Firebase service account key, whole JSON)
   ===================================================== */

const MAX_PER_RUN = 5; // stay under the free-plan subrequest limit (50 per run)

const ECHO_DELAY = 90e3; // backup push this long after the main one (cancelled if you act on it)

export default {
  async scheduled(_event, env, ctx) { ctx.waitUntil(run(env)); },
  async fetch(req, env) {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (req.method === 'POST' && new URL(req.url).pathname === '/act') {
      try { return new Response(JSON.stringify(await act(req, env)), { headers: { ...cors, 'Content-Type': 'application/json' } }); }
      catch (e) { console.error('[act] failed', e); return new Response(JSON.stringify({ ok: false, error: String(e.message || e) }), { status: 400, headers: cors }); }
    }
    return new Response('To-Do Pro reminder worker is running.', { headers: cors });
  },
};

/* ---------- Google auth (service account -> access token) ---------- */
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const enc = (o) => b64url(new TextEncoder().encode(JSON.stringify(o)));

async function accessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const head = enc({ alg: 'RS256', typ: 'JWT' });
  const claim = enc({
    iss: sa.client_email, sub: sa.client_email, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
    scope: 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/firebase.messaging',
  });
  const pem = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${head}.${claim}`));
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claim}.${b64url(sig)}` }),
  });
  if (!res.ok) throw new Error('Token exchange failed: ' + res.status + ' ' + (await res.text()));
  return (await res.json()).access_token;
}

/* ---------- shared helpers ---------- */
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

// Signs "uid.taskId" so a notification button can act on that one task without a login.
async function sign(sa, uid, id) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(sa.private_key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${uid}.${id}`))).slice(0, 40);
}

async function makeCtx(env) {
  const sa = JSON.parse(env.SERVICE_ACCOUNT_JSON);
  const pid = sa.project_id;
  const token = await accessToken(sa);
  const fs = `https://firestore.googleapis.com/v1/projects/${pid}/databases/(default)/documents`;
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const call = (url, opt = {}) => fetch(url, { ...opt, headers: { ...auth, ...(opt.headers || {}) } });
  const str = (f, k) => f?.[k]?.stringValue ?? '';
  const mask = (names) => names.map((n) => `updateMask.fieldPaths=${n}`).join('&');
  const patch = (url, names, fields) => call(`${url}?${mask(names)}`, { method: 'PATCH', body: JSON.stringify({ fields }) });
  return { sa, pid, fs, call, str, patch };
}

/* when does the next push for an alarm go out? (10 min early if a pre-reminder is on) */
function schedule(alarmISO, pre) {
  const preAt = new Date(alarmISO).getTime() - pre * 60e3;
  return pre > 0 && preAt > Date.now() + 60e3 ? { stage: 'pre', fireAt: new Date(preAt).toISOString() } : { stage: 'main', fireAt: alarmISO };
}

/* ---------- notification buttons: POST /act  {uid,id,act:'done'|'snooze'|'ack',min,sig} ---------- */
async function act(req, env) {
  const b = JSON.parse(await req.text());
  const { uid, id } = b;
  if (!uid || !id || !['done', 'snooze', 'ack'].includes(b.act)) throw new Error('bad request');
  const c = await makeCtx(env);
  if (b.sig !== (await sign(c.sa, uid, id))) throw new Error('bad signature');
  const taskUrl = `${c.fs}/users/${uid}/tasks/${id}`;
  const rem = (suffix = '') => `${c.fs}/reminders/${id}${suffix}`;
  const now = Date.now();

  if (b.act === 'ack') { await c.call(rem('_echo'), { method: 'DELETE' }); return { ok: true }; } // you saw it: no backup push

  if (b.act === 'done') {
    const dRes = await c.call(taskUrl);
    const dt = dRes.ok ? (await dRes.json()).fields || {} : {};
    const rep = c.str(dt, 'alarmRepeat') || 'none', curAlarm = c.str(dt, 'alarm');
    if ((rep === 'daily' || rep === 'weekly') && curAlarm) {
      // Repeating task = habit: check in for today and move on to the next occurrence instead of closing it.
      const tzo = Number.isFinite(Number(b.tzo)) ? Number(b.tzo) : 0; // device offset in minutes (JS getTimezoneOffset: UTC+6 -> -360)
      const local = (ms) => new Date(ms - tzo * 60e3).toISOString().slice(0, 10);
      const today = local(now);
      const origMs = new Date(curAlarm).getTime();
      let next = origMs;
      while (next <= now || local(next) === today) next += (rep === 'weekly' ? 7 : 1) * 864e5;
      const nextISO = new Date(next).toISOString();
      const old = (dt.doneDates?.arrayValue?.values || []).map((v) => v.stringValue).filter(Boolean);
      const done = [...new Set([...old, today])].sort().slice(-400);
      await c.patch(taskUrl, ['doneDates', 'alarm', 'alarmFired', 'date', 'completed', 'completedAt', 'updatedAt'], {
        doneDates: { arrayValue: { values: done.map((x) => ({ stringValue: x })) } },
        alarm: { stringValue: nextISO }, alarmFired: { booleanValue: false }, date: { stringValue: local(next) },
        completed: { booleanValue: false }, completedAt: { stringValue: new Date(now).toISOString() }, updatedAt: { integerValue: String(now) },
      });
      if (next !== origMs) { // done early (e.g. from the pre-reminder): re-arm the reminder for the new time
        const rr = await c.call(rem());
        const pre = rr.ok ? Number(((await rr.json()).fields || {}).pre?.integerValue || 0) : 0;
        const sch = schedule(nextISO, pre);
        await c.patch(rem(), ['id', 'uid', 'title', 'body', 'alarm', 'repeat', 'fireAt', 'stage', 'pre', 'echo'], {
          id: { stringValue: id }, uid: { stringValue: uid }, title: { stringValue: c.str(dt, 'title') }, body: { stringValue: (c.str(dt, 'notes') || '').slice(0, 140) },
          alarm: { stringValue: nextISO }, repeat: { stringValue: rep }, fireAt: { stringValue: sch.fireAt }, stage: { stringValue: sch.stage },
          pre: { integerValue: String(pre) }, echo: { booleanValue: b.echo !== '0' && b.echo !== false },
        });
      }
      await c.call(rem('_echo'), { method: 'DELETE' });
      console.log(`[act] habit done ${id} streak day ${today} -> next ${nextISO}`);
      return { ok: true, habit: true, alarm: nextISO };
    }
    await c.patch(taskUrl, ['completed', 'completedAt', 'updatedAt'], {
      completed: { booleanValue: true }, completedAt: { stringValue: new Date(now).toISOString() }, updatedAt: { integerValue: String(now) },
    });
    await c.call(rem(), { method: 'DELETE' }); await c.call(rem('_echo'), { method: 'DELETE' });
    console.log(`[act] done ${id}`);
    return { ok: true };
  }
  const min = Math.min(120, Math.max(1, Number(b.min) || 10));
  const alarm = new Date(now + min * 60e3).toISOString();
  const tRes = await c.call(taskUrl);
  if (!tRes.ok) throw new Error('task not found');
  const t = (await tRes.json()).fields || {};
  await c.patch(taskUrl, ['alarm', 'alarmFired', 'updatedAt'], { alarm: { stringValue: alarm }, alarmFired: { booleanValue: false }, updatedAt: { integerValue: String(now) } });
  await c.patch(rem(), ['id', 'uid', 'title', 'body', 'alarm', 'repeat', 'fireAt', 'stage', 'pre', 'echo'], {
    id: { stringValue: id }, uid: { stringValue: uid }, title: { stringValue: c.str(t, 'title') }, body: { stringValue: (c.str(t, 'notes') || '').slice(0, 140) },
    alarm: { stringValue: alarm }, repeat: { stringValue: c.str(t, 'alarmRepeat') || 'none' }, fireAt: { stringValue: alarm }, stage: { stringValue: 'main' },
    pre: { integerValue: '0' }, echo: { booleanValue: b.echo !== '0' && b.echo !== false },
  });
  await c.call(rem('_echo'), { method: 'DELETE' });
  console.log(`[act] snooze ${id} ${min}min -> ${alarm}`);
  return { ok: true, alarm };
}

/* ---------- main loop ---------- */
async function run(env) {
  const c = await makeCtx(env);
  const { sa, pid, fs, call, str, patch } = c;
  const int = (f, k) => Number(f?.[k]?.integerValue ?? 0);
  const bool = (f, k) => !!f?.[k]?.booleanValue;

  const nowISO = new Date().toISOString();
  const qRes = await call(`${fs}:runQuery`, {
    method: 'POST',
    body: JSON.stringify({ structuredQuery: {
      from: [{ collectionId: 'reminders' }],
      where: { fieldFilter: { field: { fieldPath: 'fireAt' }, op: 'LESS_THAN_OR_EQUAL', value: { stringValue: nowISO } } },
      orderBy: [{ field: { fieldPath: 'fireAt' }, direction: 'ASCENDING' }],
      limit: MAX_PER_RUN,
    } }),
  });
  if (!qRes.ok) throw new Error('Query failed: ' + qRes.status + ' ' + (await qRes.text()));
  const due = (await qRes.json()).filter((r) => r.document).map((r) => r.document);
  console.log(`[run] ${nowISO} due: ${due.length}`);

  for (const d of due) {
    try {
      const f = d.fields || {};
      const docId = d.name.split('/').pop();
      const id = str(f, 'taskId') || docId;
      const stage = str(f, 'stage') || 'main';
      const uid = str(f, 'uid'), alarm = str(f, 'alarm'), repeat = str(f, 'repeat') || 'none';
      const pre = int(f, 'pre'), echo = bool(f, 'echo');
      const reminderUrl = `${fs}/reminders/${docId}`;
      const taskUrl = `${fs}/users/${uid}/tasks/${id}`;

      // Skip stale mirrors (task deleted, completed, or alarm edited since)
      const tRes = await call(taskUrl);
      const task = tRes.ok ? (await tRes.json()).fields : null;
      const moved = !task || str(task, 'alarm') !== alarm;
      const stale = !task || bool(task, 'completed') ||
        (stage === 'echo' ? (repeat === 'none' && moved) : (bool(task, 'alarmFired') || moved));
      if (stale) {
        console.log(`[skip] ${docId} (${stage}) stale: task=${!!task} completed=${bool(task, 'completed')} fired=${bool(task, 'alarmFired')} moved=${moved}`);
        await call(reminderUrl, { method: 'DELETE' }); continue;
      }

      // Send to every registered device
      const dRes = await call(`${fs}/users/${uid}/devices?pageSize=20`);
      const devices = dRes.ok ? ((await dRes.json()).documents || []) : [];
      console.log(`[send] ${docId} ${stage} "${str(f, 'title')}" -> ${devices.length} device(s)`);

      // Backup push is created BEFORE sending so an open device cancelling it can never lose the race.
      if (stage === 'main' && echo) {
        await patch(`${fs}/reminders/${id}_echo`, ['id', 'taskId', 'uid', 'title', 'body', 'alarm', 'repeat', 'fireAt', 'stage', 'pre', 'echo'], {
          id: { stringValue: `${id}_echo` }, taskId: { stringValue: id }, uid: { stringValue: uid }, title: { stringValue: str(f, 'title') }, body: { stringValue: str(f, 'body') },
          alarm: { stringValue: alarm }, repeat: { stringValue: repeat }, fireAt: { stringValue: new Date(Date.now() + ECHO_DELAY).toISOString() },
          stage: { stringValue: 'echo' }, pre: { integerValue: '0' }, echo: { booleanValue: false },
        });
      }

      const data = {
        taskId: id, title: str(f, 'title') || 'Reminder', body: str(f, 'body'), alarm, kind: stage, uid, echo: echo ? '1' : '0',
        sig: await sign(sa, uid, id),
      };
      for (const dev of devices) {
        const tok = str(dev.fields, 'token');
        if (!tok) continue;
        const r = await call(`https://fcm.googleapis.com/v1/projects/${pid}/messages:send`, {
          method: 'POST',
          body: JSON.stringify({ message: { token: tok, data, webpush: { headers: { Urgency: 'high', TTL: '3600' } } } }),
        });
        const ua = str(dev.fields, 'ua'), kind = /Android/i.test(ua) ? 'Android' : /Windows/i.test(ua) ? 'Windows' : /iPhone|iPad|Mac/i.test(ua) ? 'Apple' : ua.slice(0, 20) || '?';
        console.log(`[fcm] ${docId} ${stage} ${kind} device ${dev.name.split('/').pop().slice(0, 8)}... status ${r.status}${r.ok ? '' : ' ' + (await r.clone().text()).slice(0, 200)}`);
        if (r.status === 404 || r.status === 400) await call(`${fs}/users/${uid}/devices/${dev.name.split('/').pop()}`, { method: 'DELETE' }); // dead token
      }

      if (stage === 'echo') { await call(reminderUrl, { method: 'DELETE' }); continue; }
      if (stage === 'pre') { await patch(reminderUrl, ['stage', 'fireAt'], { stage: { stringValue: 'main' }, fireAt: { stringValue: alarm } }); continue; }

      // main: mark fired, or schedule the next repeat
      if (repeat === 'daily' || repeat === 'weekly') {
        const step = repeat === 'daily' ? 1 : 7;
        const next = new Date(alarm);
        do { next.setUTCDate(next.getUTCDate() + step); } while (next.getTime() <= Date.now());
        const nextISO = next.toISOString();
        const sch = schedule(nextISO, pre);
        await patch(taskUrl, ['alarm', 'alarmFired', 'updatedAt'], { alarm: { stringValue: nextISO }, alarmFired: { booleanValue: false }, updatedAt: { integerValue: String(Date.now()) } });
        await patch(reminderUrl, ['alarm', 'fireAt', 'stage'], { alarm: { stringValue: nextISO }, fireAt: { stringValue: sch.fireAt }, stage: { stringValue: sch.stage } });
      } else {
        await patch(taskUrl, ['alarmFired', 'updatedAt'], { alarmFired: { booleanValue: true }, updatedAt: { integerValue: String(Date.now()) } });
        await call(reminderUrl, { method: 'DELETE' });
      }
    } catch (e) { console.error('reminder failed', d.name, e); }
  }
}