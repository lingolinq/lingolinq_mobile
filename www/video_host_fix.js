/**
 * Prod-packaged app.js sets window.default_host = "app.lingolinq.com" (no scheme).
 * Under Capacitor (https://localhost) that makes video iframes resolve as
 * https://localhost/app.lingolinq.com/videos/... → local asset 404 →
 * "player never initialized". Normalize after app.js loads (before Ember boots UI).
 */
(function() {
  try {
    if (window.default_host && !/^https?:\/\//i.test(String(window.default_host))) {
      window.default_host = 'https://' + String(window.default_host).replace(/^\/+/, '');
      console.log('LINGOLINQ: normalized default_host to', window.default_host);
    }
  } catch (e) {}
})();
