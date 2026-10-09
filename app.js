/* ============================================================
   NORDIC CRYPTO — APP.JS v7.0 — LOADER
   ============================================================
   Порядок загрузки:
   1. core.js            — утилиты
   2. auth.js            — login/logout
   3. app.legacy.js      — основной функционал (Part A + B)
   4. legacy-part1.js    — продолжение (loadAdminWithdrawals и др.)
   5. legacy-part2.js    — продолжение (initNav, toast, ...)
   6. legacy-fix.js      — торговля + portfolio
   7. session-fix.js     — очистка сессии
   8. deposit-flow.js    — депозиты
   9. withdraw-flow.js   — анимация вывода
   10. withdraw-confirmations.js
   11. admin-withdrawals-fix.js   🆕 фикс мерцания
   12. fixes.js          — onboarding + фиксы
   13. chat-fix.js       — чат
   14. trade-terminal.js
   15. polling-hub.js
   16. bonus-system.js
   17. bonus-ui.js
   18. maintenance-mode.js  🆕 Push Update
   19. current-user-fix.js  🆕 window.currentUser
   ============================================================ */

(function () {
  'use strict';

  var APP_VERSION = '7.0.1';   // ← было 7.0.0

    var MODULES = [
    'js/core.js?v=' + APP_VERSION,
    'js/auth.js?v=' + APP_VERSION,
    'app.legacy.js?v=' + APP_VERSION,
    'js/legacy-part1.js?v=' + APP_VERSION,
    'js/legacy-part2.js?v=' + APP_VERSION,
    'js/legacy-fix.js?v=' + APP_VERSION,
    'js/session-fix.js?v=' + APP_VERSION,
    'js/deposit-flow.js?v=' + APP_VERSION,
    'js/withdraw-flow.js?v=' + APP_VERSION,
    'js/withdraw-confirmations.js?v=' + APP_VERSION,
    'js/fixes.js?v=' + APP_VERSION,
    'js/chat-fix.js?v=' + APP_VERSION,
    'js/trade-terminal.js?v=' + APP_VERSION,
    'js/polling-hub.js?v=' + APP_VERSION,
    'js/bonus-system.js?v=' + APP_VERSION,
    'js/bonus-ui.js?v=' + APP_VERSION,
    'js/current-user-fix.js?v=' + APP_VERSION,
    'js/maintenance-mode.js?v=' + APP_VERSION,
    'js/admin-maintenance-buttons.js?v=' + APP_VERSION
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
