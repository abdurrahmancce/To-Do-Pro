/* =====================================================
   To-Do Pro — reminder push worker (Cloudflare Workers, free plan)
   Every minute:
     1. read due docs from Firestore  reminders/{taskId}  (alarm <= now)
     2. send a push to every device in users/{uid}/devices (FCM HTTP v1)
     3. mark the task fired (or move a repeating alarm to its next time)
   Secret required:  SERVICE_ACCOUNT_JSON  (Firebase service account key, whole JSON)
   ===================================================== */

const MAX_PER_RUN = 5; // stay under the free-plan subrequest limit (50 per run)

export default {
  async scheduled(_event, env, ctx) { ctx.waitUntil(run(env)); },
  async fetch() { return new Response('To-Do Pro reminder worker is running.'); },
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

/* ---------- main loop ---------- */
async function run(env) {
  const sa = JSON.parse(env.SERVICE_ACCOUNT_JSON);
  const pid = sa.project_id;
  const token = await accessToken(sa);
  const fs = `https://firestore.googleapis.com/v1/projects/${pid}/databases/(default)/documents`;
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const call = (url, opt = {}) => fetch(url, { ...opt, headers: { ...auth, ...(opt.headers || {}) } });
  const str = (f, k) => f?.[k]?.stringValue ?? '';

  const nowISO = new Date().toISOString();
  const qRes = await call(`${fs}:runQuery`, {
    method: 'POST',
    body: JSON.stringify({ structuredQuery: {
      from: [{ collectionId: 'reminders' }],
      where: { fieldFilter: { field: { fieldPath: 'alarm' }, op: 'LESS_THAN_OR_EQUAL', value: { stringValue: nowISO } } },
      orderBy: [{ field: { fieldPath: 'alarm' }, direction: 'ASCENDING' }],
      limit: MAX_PER_RUN,
    } }),
  });
  if (!qRes.ok) throw new Error('Query failed: ' + qRes.status + ' ' + (await qRes.text()));
  const due = (await qRes.json()).filter((r) => r.document).map((r) => r.document);
  console.log(`[run] ${nowISO} due reminders: ${due.length}`);

  for (const d of due) {
    try {
      const f = d.fields || {};
      const id = d.name.split('/').pop();
      const uid = str(f, 'uid'), alarm = str(f, 'alarm'), repeat = str(f, 'repeat') || 'none';
      const reminderUrl = `${fs}/reminders/${id}`;
      const taskUrl = `${fs}/users/${uid}/tasks/${id}`;

      // Skip stale mirrors (task deleted, completed, or alarm edited since)
      const tRes = await call(taskUrl);
      const task = tRes.ok ? (await tRes.json()).fields : null;
      const stale = !task || task.completed?.booleanValue || task.alarmFired?.booleanValue || str(task, 'alarm') !== alarm;
      if (stale) {
        console.log(`[skip] ${id} stale: task=${!!task} completed=${!!task?.completed?.booleanValue} fired=${!!task?.alarmFired?.booleanValue} taskAlarm=${task ? str(task, 'alarm') : '-'} reminderAlarm=${alarm}`);
        await call(reminderUrl, { method: 'DELETE' }); continue;
      }

      // Send to every registered device
      const dRes = await call(`${fs}/users/${uid}/devices?pageSize=20`);
      const devices = dRes.ok ? ((await dRes.json()).documents || []) : [];
      console.log(`[send] ${id} "${str(f, 'title')}" -> ${devices.length} device(s)`);
      for (const dev of devices) {
        const tok = str(dev.fields, 'token');
        if (!tok) continue;
        const r = await call(`https://fcm.googleapis.com/v1/projects/${pid}/messages:send`, {
          method: 'POST',
          body: JSON.stringify({ message: {
            token: tok,
            data: { taskId: id, title: str(f, 'title') || 'Reminder', body: str(f, 'body'), alarm },
            webpush: { headers: { Urgency: 'high', TTL: '3600' } },
          } }),
        });
        console.log(`[fcm] ${id} device ${dev.name.split('/').pop().slice(0, 8)}... status ${r.status}${r.ok ? '' : ' ' + (await r.clone().text()).slice(0, 200)}`);
        if (r.status === 404 || r.status === 400) await call(`${fs}/users/${uid}/devices/${dev.name.split('/').pop()}`, { method: 'DELETE' }); // dead token
      }

      // Mark fired, or schedule the next repeat
      const mask = (names) => names.map((n) => `updateMask.fieldPaths=${n}`).join('&');
      if (repeat === 'daily' || repeat === 'weekly') {
        const step = repeat === 'daily' ? 1 : 7;
        const next = new Date(alarm);
        do { next.setUTCDate(next.getUTCDate() + step); } while (next.getTime() <= Date.now());
        const nextISO = next.toISOString();
        await call(`${taskUrl}?${mask(['alarm', 'alarmFired', 'updatedAt'])}`, { method: 'PATCH', body: JSON.stringify({ fields: { alarm: { stringValue: nextISO }, alarmFired: { booleanValue: false }, updatedAt: { integerValue: String(Date.now()) } } }) });
        await call(`${reminderUrl}?${mask(['alarm'])}`, { method: 'PATCH', body: JSON.stringify({ fields: { alarm: { stringValue: nextISO } } }) });
      } else {
        await call(`${taskUrl}?${mask(['alarmFired', 'updatedAt'])}`, { method: 'PATCH', body: JSON.stringify({ fields: { alarmFired: { booleanValue: true }, updatedAt: { integerValue: String(Date.now()) } } }) });
        await call(reminderUrl, { method: 'DELETE' });
      }
    } catch (e) { console.error('reminder failed', d.name, e); }
  }
}