/* To-Do Pro: optional visitor statistics with GoatCounter (https://www.goatcounter.com).
   Privacy friendly: no cookies, no personal data, and task text is never sent.
   Set your GoatCounter site code below (the part before ".goatcounter.com"). Leave it empty to keep analytics off. */
window.GOATCOUNTER_CODE = '';

(function () {
  var code = window.GOATCOUNTER_CODE;
  window.track = function () {}; // no-op until analytics is on
  if (!code || !/^[a-z0-9-]{2,40}$/i.test(code)) return;
  if (navigator.doNotTrack === '1') return; // respect Do Not Track
  window.goatcounter = { allow_local: false };
  var s = document.createElement('script');
  s.async = true;
  s.src = 'https://gc.zgo.at/count.js';
  s.setAttribute('data-goatcounter', 'https://' + code + '.goatcounter.com/count');
  document.head.appendChild(s);
  var queue = [];
  window.track = function (name) { // feature usage, e.g. track('task-added')
    var send = function () { try { window.goatcounter.count({ path: 'event/' + name, title: name, event: true }); } catch (e) { /* blocked */ } };
    if (window.goatcounter && typeof window.goatcounter.count === 'function') send(); else queue.push(send);
  };
  s.addEventListener('load', function () { queue.splice(0).forEach(function (f) { f(); }); });
})();
