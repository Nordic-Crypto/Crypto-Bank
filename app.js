/* ============================================================
   NORDIC CRYPTO — APP.JS v4.2 — LOADER
   ============================================================
   Загружает модули по порядку:
     1. js/core.js      (утилиты)
     2. js/auth.js      (логин, регистрация, сессия)
     3. app.legacy.js   (основной код v3.2)

   Backward compat: все глобальные функции остаются доступны
   в window, потому что app.legacy.js их регистрирует.
   ============================================================ */

(function () {
  'use strict';

  var APP_VERSION = '4.2.0';
  var MODULES = [
    'js/core.js',
    'js/auth.js',
    'app.legacy.js?v=' + APP_VERSION
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
        alert('Не удалось загрузить модуль: ' + src + '\nОбновите страницу.');
      }
    };

    document.head.appendChild(script);
  }

  window.__NC_RELOAD = function () {
    var newVersion = prompt('Введите версию (например, 4.3.0):');
    if (newVersion) {
      localStorage.setItem('nc_force_version', newVersion);
      location.reload();
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { loadModules(0); });
  } else {
    loadModules(0);
  }

})();
