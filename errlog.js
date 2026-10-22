/* To-Do Pro: tiny error recorder (no network, no task data).
   Keeps the last few errors on this device so "Report a bug" can include them. */
(function () {
  var KEY = 'tp-errors', MAX = 8;
  function read() { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { return []; } }
  function record(msg, src, stack) {
    msg = String(msg || '').slice(0, 200);
    if (!msg || /ResizeObserver loop|^Script error\.?$/i.test(msg)) return; // browser noise and cross-origin errors
    if (/^(chrome|moz|safari)-extension:/.test(String(src || ''))) return;
    var list = read();
    list.push({ t: new Date().toISOString(), m: msg, s: String(src || '').replace(location.origin, '').slice(0, 80), k: String(stack || '').split('\n').slice(0, 4).join(' | ').slice(0, 300) });
    try { localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX))); } catch (e) { /* storage full or blocked */ }
    try { window.dispatchEvent(new CustomEvent('tp-error')); } catch (e) { /* old browser */ }
  }
  window.addEventListener('error', function (e) { record(e.message, (e.filename || '') + ':' + (e.lineno || 0), e.error && e.error.stack); });
  window.addEventListener('unhandledrejection', function (e) { var r = e.reason; record((r && r.message) || r, 'promise', r && r.stack); });
  window.tpErrors = { read: read, clear: function () { try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ } } };
})();
