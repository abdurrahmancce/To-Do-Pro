/* =====================================================
   photos.js — photo attachments for tasks and checklist steps
   - compress():  shrinks a picture (camera, gallery, screenshot) to a small JPEG
   - local store: IndexedDB on this device, so photos open instantly and offline
   - remote:      script.js plugs in Firestore (users/{uid}/photos/{id}) when signed in
   ===================================================== */
const DB_NAME = 'tp-photos', STORE = 'p';
export const MAX_DATA_CHARS = 380000;          // must match firestore.rules (d.size() <= 400000)
export const validPhotoId = (id) => /^[A-Za-z0-9_-]{1,40}$/.test(String(id || ''));
export const validPhotoData = (d) => typeof d === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(d.slice(0, 40)) && d.length <= MAX_DATA_CHARS;

let dbp = null;
function open() {
  if (!dbp) dbp = new Promise((res, rej) => {
    try {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    } catch (e) { rej(e); }
  });
  return dbp;
}
const tx = async (mode, fn) => {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction(STORE, mode); const out = fn(t.objectStore(STORE));
    t.oncomplete = () => res(out && 'result' in out ? out.result : undefined);
    t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
  });
};

const mem = new Map();                           // id -> data URL (this tab)
let remote = null;                               // { get(id), put(id, rec), del(id) } while signed in
export const setRemote = (r) => { remote = r; };

export async function putLocal(id, rec) { mem.set(id, rec.d); try { await tx('readwrite', (s) => s.put(rec, id)); } catch { /* memory copy still works */ } }
export async function delLocal(id) { mem.delete(id); try { await tx('readwrite', (s) => s.delete(id)); } catch { /* ignore */ } }
export async function clearLocal() { mem.clear(); try { await tx('readwrite', (s) => s.clear()); } catch { /* ignore */ } }
async function getLocal(id) { try { return await tx('readonly', (s) => s.get(id)); } catch { return null; } }

/* Save a new picture on this device and, when signed in, in the account. */
export async function savePhoto(id, rec) {
  await putLocal(id, rec);
  if (remote) remote.put(id, rec).catch(() => {}); // not awaited: offline writes wait in the queue
}
export async function removePhoto(id) {
  await delLocal(id);
  if (remote) remote.del(id).catch(() => {});
}

/* Data URL of a picture: memory, then this device, then the account (and cache it). */
const inflight = new Map();
export function photoURL(id) {
  if (!validPhotoId(id)) return Promise.resolve(null);
  if (mem.has(id)) return Promise.resolve(mem.get(id));
  if (inflight.has(id)) return inflight.get(id);
  const p = (async () => {
    const local = await getLocal(id);
    if (local?.d && validPhotoData(local.d)) { mem.set(id, local.d); return local.d; }
    if (remote) {
      try {
        const rec = await remote.get(id);
        if (rec?.d && validPhotoData(rec.d)) { await putLocal(id, { d: rec.d, w: rec.w || 0, h: rec.h || 0, t: rec.t || Date.now() }); return rec.d; }
      } catch { /* offline: try again next time */ }
    }
    return null;
  })().finally(() => inflight.delete(id));
  inflight.set(id, p);
  return p;
}
export async function allLocal(ids) { // for backups: { id: dataURL }
  const out = {};
  for (const id of ids) { const d = await photoURL(id); if (d) out[id] = d; }
  return out;
}

/* ---------- compression ---------- */
async function decode(file) {
  if (window.createImageBitmap) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* fall back to <img> */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image(); img.src = url; await img.decode();
    return img;
  } finally { setTimeout(() => URL.revokeObjectURL(url), 5000); }
}
/* Resize to at most `max` px on the long side and re-encode as JPEG until it fits the size limit. */
export async function compress(file, max = 1280) {
  if (!file || !/^image\//.test(file.type || '')) throw new Error('not an image');
  const src = await decode(file);
  let w = src.width || src.naturalWidth, h = src.height || src.naturalHeight;
  if (!w || !h) throw new Error('bad image');
  let scale = Math.min(1, max / Math.max(w, h));
  const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d');
  for (let round = 0; round < 6; round++) {
    canvas.width = Math.max(1, Math.round(w * scale)); canvas.height = Math.max(1, Math.round(h * scale));
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); // screenshots with transparency
    ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
    for (const q of [0.8, 0.68, 0.56, 0.46]) {
      const d = canvas.toDataURL('image/jpeg', q);
      if (d.length <= MAX_DATA_CHARS - 20000) { if (src.close) src.close(); return { d, w: canvas.width, h: canvas.height, t: Date.now() }; }
    }
    scale *= 0.8;
  }
  throw new Error('image too large');
}
