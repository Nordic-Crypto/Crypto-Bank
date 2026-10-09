/* ============================================================
   NORDIC CRYPTO — APP.JS v4.7 — LOADER
   ============================================================ */

(function () {
  'use strict';

  var APP_VERSION = '4.7.0';
  var MODULES = [
    'js/core.js',
    'js/auth.js',
    'app.legacy.js?v=' + APP_VERSION,
    'js/legacy-fix.js',
    'js/withdraw-flow.js',
    'js/withdraw-confirmations.js',
    'js/deposit-flow.js',
    'js/fixes.js',
    'js/chat-fix.js',
    'js/trade-terminal.js'
  ];

  console.log('%c[NordicCrypto] 🚀 Loader v' + APP_VERSION + ' starting...',
    'color:#00d4ff;font-weight:bold;font-size:14px');

  window.__NC_LOADER_VERSION = APP_VERSION;

  function loadModules(index) {
    if (index >= MODULES.length) {
      console.log('%c[NordicCrypto] ✅ All modules loaded', 'color:#10b981;font-weight:bold');
      window.__NC_LEGACY_LOADED = true;
      return;
    }
    var src = MODULES[index];
    var script = document.createElement('script');
    script.src = src;
    script.async = false;
    script.onload = function () {
      console.log('%c[NordicCrypto] ✅ Loaded: ' + src, 'color:#10b981');
      loadModules(index + 1);
    };
    script.onerror = function () {
      console.error('[NordicCrypto] ❌ Failed to load: ' + src);
    };
    document.head.appendChild(script);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { loadModules(0); });
  } else {
    loadModules(0);
  }
})();
