/* ============================================================
   NORDIC CRYPTO — APP.JS v5.0 — LOADER (FIXED)
   ============================================================ */

(function () {
  'use strict';

  var APP_VERSION = '5.0.0';

  // ВАЖНО: все пути относительно корня, app.legacy.js лежит в js/
  var MODULES = [
    'js/core.js',
    'js/auth.js',
    'js/app.legacy.js?v=' + APP_VERSION,   // ← ИСПРАВЛЕНО: был корень, стал js/
    'js/legacy-fix.js',
    'js/session-fix.js',                    // ← перенесён ВЫШЕ, чтобы переопределить logout ДО остальных
    'js/deposit-flow.js',
    'js/withdraw-flow.js',
    'js/withdraw-confirmations.js',
    'js/fixes.js',
    'js/chat-fix.js',
    'js/trade-terminal.js',
    'js/polling-hub.js',
    'js/bonus-system.js'                    // ← НОВЫЙ: бонусы за косяки
  ];

  console.log('%c[NordicCrypto] 🚀 Loader v' + APP_VERSION,
    'color:#00d4ff;font-weight:bold;font-size:14px');

  window.__NC_LOADER_VERSION = APP_VERSION;
  window.__NC_MODULES_LOADED = [];
  window.__NC_MODULES_FAILED = [];

  function loadModules(index) {
    if (index >= MODULES.length) {
      console.log('%c[NordicCrypto] ✅ All modules loaded',
        'color:#10b981;font-weight:bold');
      window.__NC_LEGACY_LOADED = true;

      // Принудительный ре-рендер после загрузки всех модулей
      if (window.NC && typeof window.NC.refreshUI === 'function') {
        window.NC.refreshUI();
      } else if (window.currentUser) {
        document.dispatchEvent(new CustomEvent('nc:auth:login', {
          detail: { user: window.currentUser }
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
      console.log('%c[NordicCrypto] ✅ ' + src, 'color:#10b981');
      loadModules(index + 1);
    };

    script.onerror = function () {
      window.__NC_MODULES_FAILED.push(src);
      console.error('[NordicCrypto] ❌ FAILED: ' + src);

      // НЕ прерываем цепочку — пробуем следующий модуль
      loadModules(index + 1);
    };

    document.head.appendChild(script);
  }

  // Глобальный перехватчик ошибок — чтобы видеть, что падает
  window.addEventListener('error', function (e) {
    console.error('[NordicCrypto] 💥 Runtime error:', e.message,
      '\n  File:', e.filename, '\n  Line:', e.lineno);
  });

  window.addEventListener('unhandledrejection', function (e) {
    console.error('[NordicCrypto] 💥 Unhandled promise:', e.reason);
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { loadModules(0); });
  } else {
    loadModules(0);
  }
})();
