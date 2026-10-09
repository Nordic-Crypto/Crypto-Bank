/* ============================================================
   NORDIC CRYPTO — APP.JS v6.0 — LOADER
   ============================================================
   Порядок загрузки оптимизирован:
   1. core.js        — утилиты
   2. auth.js        — login/logout (не перезаписывается legacy)
   3. app.legacy.js  — весь функционал
   4. legacy-fix.js  — торговля + portfolio
   5. session-fix.js — очистка сессии
   6. deposit-flow.js — депозиты (без дублирования polling)
   7. withdraw-flow.js + confirmations
   8. fixes.js       — onboarding + withdrawals
   9. chat-fix.js    — быстрый чат
   10. trade-terminal.js
   11. polling-hub.js  — централизованный polling
   12. bonus-system.js — бонусы
   ============================================================ */

(function () {
  'use strict';

  var APP_VERSION = '6.0.0';

  var MODULES = [
    'js/core.js?v=' + APP_VERSION,
    'js/auth.js?v=' + APP_VERSION,
    'app.legacy.js?v=' + APP_VERSION,
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

  window.addEventListener('error', function (e) {
    console.error('[NordicCrypto] 💥 Runtime error:',
      e.message, '\n  File:', e.filename, '\n  Line:', e.lineno);
  });
  window.addEventListener('unhandledrejection', function (e) {
    console.error('[NordicCrypto] 💥 Unhandled promise:', e.reason);
  });

  function loadModules(index) {
    if (index >= MODULES.length) {
      console.log('%c[NordicCrypto] ✅ All modules loaded',
        'color:#10b981;font-weight:bold');
      window.__NC_LEGACY_LOADED = true;

      // Финальный refresh
      setTimeout(function () {
        if (window.currentUser) {
          document.dispatchEvent(new CustomEvent('nc:auth:login', {
            detail: { user: window.currentUser, restored: true }
          }));
        }
        if (window.NC && typeof window.NC.refreshUI === 'function') {
          window.NC.refreshUI();
        }
      }, 500);
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
      loadModules(index + 1);
    };
    document.head.appendChild(script);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { loadModules(0); });
  } else {
    loadModules(0);
  }
})();
