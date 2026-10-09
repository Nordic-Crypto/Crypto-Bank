/* ============================================================
   NORDIC CRYPTO — APP.JS v4.4 — LOADER
   ============================================================ */

(function () {
  'use strict';

  var APP_VERSION = '4.4.0';
  var MODULES = [
    'js/core.js',
    'js/auth.js',
    'app.legacy.js?v=' + APP_VERSION,
    'js/legacy-fix.js',
    'js/fixes.js',              // ← НОВОЕ: фиксы + бонусы
    'js/withdraw-flow.js',      // ← перемещено ПОСЛЕ fixes (чтобы наш submitWithdraw переопределил старый)
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
      if (typeof window.alert === 'function') {
        alert('Не удалось загрузить модуль: ' + src);
      }
    };
    document.head.appendChild(script);
  }

  window.__NC_RELOAD = function () {
    var v = prompt('Введите версию:');
    if (v) { localStorage.setItem('nc_force_version', v); location.reload(); }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { loadModules(0); });
  } else {
    loadModules(0);
  }

})();
