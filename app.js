/* ============================================================
   NORDIC CRYPTO — APP.JS v5.0.0 — LOADER
   ============================================================
   FIXES v5.0.0:
   - app.legacy.js path corrected (it lives in ROOT, not js/)
   - Continues loading chain even if one module fails
   - Global runtime error trap
   - Bonus system loaded last
   - Forces UI refresh after all modules are ready
   ============================================================ */

(function () {
  'use strict';

  var APP_VERSION = '5.0.0';

  var MODULES = [
    'js/core.js',
    'js/auth.js?v=' + APP_VERSION,
    'app.legacy.js?v=' + APP_VERSION,             // ⚠️ ROOT — no js/ prefix
    'js/legacy-fix.js?v=' + APP_VERSION,
    'js/session-fix.js?v=' + APP_VERSION,
    'js/deposit-flow.js?v=' + APP_VERSION,
    'js/withdraw-flow.js?v=' + APP_VERSION,
    'js/withdraw-confirmations.js?v=' + APP_VERSION,
    'js/fixes.js?v=' + APP_VERSION,
    'js/chat-fix.js?v=' + APP_VERSION,
    'js/trade-terminal.js?v=' + APP_VERSION,
    'js/polling-hub.js?v=' + APP_VERSION,
    'js/bonus-system.js?v=' + APP_VERSION
  ];

  console.log('%c[NordicCrypto] 🚀 Loader v' + APP_VERSION + ' starting...',
    'color:#00d4ff;font-weight:bold;font-size:14px');

  window.__NC_LOADER_VERSION = APP_VERSION;
  window.__NC_MODULES_LOADED = [];
  window.__NC_MODULES_FAILED = [];

  // Global error trap
  window.addEventListener('error', function (e) {
    console.error('[NordicCrypto] 💥 Runtime error:',
      e.message, '\n  File:', e.filename, '\n  Line:', e.lineno);
  });

  window.addEventListener('unhandledrejection', function (e) {
    console.error('[NordicCrypto] 💥 Unhandled promise rejection:', e.reason);
  });

  function loadModules(index) {
    if (index >= MODULES.length) {
      console.log('%c[NordicCrypto] ✅ All modules loaded',
        'color:#10b981;font-weight:bold');
      window.__NC_LEGACY_LOADED = true;

      // Force UI refresh once everything is ready
      if (window.NC && typeof window.NC.refreshUI === 'function') {
        window.NC.refreshUI();
      } else if (window.currentUser) {
        document.dispatchEvent(new CustomEvent('nc:auth:login', {
          detail: { user: window.currentUser, restored: true }
        }));
      }
      return;
    }

    var src = MODULES[index];
    var script = document.createElement('script');
    script.src = src;
    script.async = false;

    script.onload = function () {
      window.__NC_MODULES_LOADED.push(src);
      console.log('%c[NordicCrypto] ✅ Loaded: ' + src, 'color:#10b981');
      loadModules(index + 1);
    };

    script.onerror = function () {
      window.__NC_MODULES_FAILED.push(src);
      console.error('[NordicCrypto] ❌ FAILED: ' + src);
      loadModules(index + 1);            // keep going
    };

    document.head.appendChild(script);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { loadModules(0); });
  } else {
    loadModules(0);
  }

})();
