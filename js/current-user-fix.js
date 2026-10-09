/* ============================================================
   NORDIC CRYPTO — CURRENT-USER-FIX v1.0
   ============================================================
   🛡️ КРИТИЧНЫЙ ФИКС: window.currentUser не устанавливался
   в app.legacy.js, из-за чего бонусы (welcome, loyalty,
   referral, firstDeposit, kycBonus) НИКОГДА не выдавались.

   Этот модуль:
   • Синхронизирует window.currentUser с localStorage
   • Диспатчит nc:auth:login после логина
   • Диспатчит nc:auth:logout при выходе
   ============================================================ */

(function () {
  'use strict';

  var CUF_VERSION = '1.0.0';

  function buildUser() {
    var email = localStorage.getItem('user_email');
    var name  = localStorage.getItem('user_name');
    var role  = localStorage.getItem('user_role');
    if (!email) return null;
    return {
      id: email,
      email: email,
      name: name || 'User',
      role: role || 'user'
    };
  }

  function syncCurrentUser() {
    var u = buildUser();
    if (u) {
      window.currentUser = u;
      return true;
    }
    window.currentUser = null;
    return false;
  }

  // Экспонируем
  window.__ncSyncCurrentUser = syncCurrentUser;

  // 1. При загрузке — синхронизируем
  syncCurrentUser();

  // 2. Слушаем storage events (другая вкладка залогинилась)
  window.addEventListener('storage', function (e) {
    if (e.key === 'user_email' || e.key === 'user_role' || e.key === 'user_name') {
      syncCurrentUser();
    }
  });

  // 3. Патчим doLogin — добавляем currentUser + dispatch
  var _origDoLogin = window.doLogin;
  if (typeof _origDoLogin === 'function') {
    window.doLogin = async function () {
      var result = await _origDoLogin.apply(this, arguments);
      // После doLogin — проверяем, есть ли email
      setTimeout(function () {
        if (syncCurrentUser()) {
          console.log('%c[NordicCrypto] 👤 currentUser set:', window.currentUser.email,
            'color:#10b981;font-weight:bold');
          document.dispatchEvent(new CustomEvent('nc:auth:login', {
            detail: { user: window.currentUser }
          }));
        }
      }, 200);
      return result;
    };
  }

  // 4. Патчим doLogout — очищаем currentUser + dispatch
  var _origDoLogout = window.doLogout;
  if (typeof _origDoLogout === 'function') {
    window.doLogout = async function () {
      var result = await _origDoLogout.apply(this, arguments);
      window.currentUser = null;
      document.dispatchEvent(new CustomEvent('nc:auth:logout'));
      return result;
    };
  }

  // 5. Периодическая проверка (на случай, если doLogin переопределился)
  setInterval(function () {
    if (!window.currentUser) syncCurrentUser();
  }, 5000);

  console.log('%c[NordicCrypto] 👤 current-user-fix.js v' + CUF_VERSION + ' loaded',
    'color:#10b981;font-weight:bold;font-size:13px');
})();
