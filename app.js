/* ============================================================
   NORDIC CRYPTO — APP.JS v4.0 — LOADER
   ============================================================
   Тонкий загрузчик. Загружает app.legacy.js с реальным кодом,
   но с префиксом version для кэш-контроля.
   
   Backward compat: все глобальные функции (doLogin, render,
   showAdminPanel, и т.д.) остаются доступны в window,
   потому что app.legacy.js их регистрирует.
   ============================================================ */

(function () {
  'use strict';

  var APP_VERSION = '4.0.0';
  var LEGACY_FILE = 'app.legacy.js?v=' + APP_VERSION;

  console.log('%c[NordicCrypto] 🚀 Loader v' + APP_VERSION + ' starting...',
    'color:#00d4ff;font-weight:bold;font-size:14px');

  // Метка: если что-то пойдёт не так — можно быстро откатить на старый app.js
  window.__NC_LOADER_VERSION = APP_VERSION;

  // Загружаем legacy-код асинхронно, но с гарантией порядка
  function loadLegacy() {
    var script = document.createElement('script');
    script.src = LEGACY_FILE;
    script.async = false;
    script.onload = function () {
      console.log('%c[NordicCrypto] ✅ Legacy code loaded',
        'color:#10b981;font-weight:bold');
      // Legacy сам вызывает init при загрузке.
      // Ничего не делаем — просто фиксируем, что всё загрузилось.
      window.__NC_LEGACY_LOADED = true;
    };
    script.onerror = function () {
      console.error('[NordicCrypto] ❌ Failed to load app.legacy.js');
      // Аварийный алерт — если legacy не загрузился, фронт не работает
      if (typeof window.alert === 'function') {
        alert('Не удалось загрузить приложение. Обновите страницу.');
      }
    };
    document.head.appendChild(script);
  }

  // Функция для ручного обновления при деплое новой версии
  window.__NC_RELOAD = function () {
    var newVersion = prompt('Введите версию (например, 4.0.1):');
    if (newVersion) {
      localStorage.setItem('nc_force_version', newVersion);
      location.reload();
    }
  };

  // Запускаем загрузку
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadLegacy);
  } else {
    loadLegacy();
  }

})();
