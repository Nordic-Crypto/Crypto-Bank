/* ============================================================
   NORDIC CRYPTO — SESSION-FIX.JS v2.0
   ============================================================
   ВНИМАНИЕ v2.0:
   • Убран автоматический "dead session" detection — он выбивал
     активных пользователей через 30 сек если state пустой
   • Убрано __ncPausePolling из logout (функция из polling-hub)
   • Оставлены только: ручной logout, команды в консоли
   • Кнопка logout теперь работает через emitLogout без сюрпризов
   ============================================================ */

(function () {
  'use strict';

  var SF_VERSION = '2.0.0';
  function log(msg, color) {
    console.log('%c[session-fix] ' + msg, 'color:' + (color || '#22d3ee') + ';font-weight:bold');
  }

  // ============================================================
  // 1. Полная очистка localStorage (только наши ключи)
  // ============================================================
  function fullLocalStorageClear() {
    try {
      var keysToRemove = [];
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (!key) continue;
        if (
          key === 'session_token' ||
          key === 'user_email' ||
          key === 'user_role' ||
          key === 'user_name' ||
          key.indexOf('nc_seen_pd_') === 0 ||   // sessionStorage, не критично
          key.indexOf('nc_receipt_') === 0
        ) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(function (k) {
        try { localStorage.removeItem(k); } catch (e) {}
      });
      log('✅ localStorage очищен: ' + keysToRemove.length + ' ключей', '#4edca9');
    } catch (e) {}
  }

  function fullSessionStorageClear() {
    try {
      sessionStorage.clear();
      log('✅ sessionStorage очищен', '#4edca9');
    } catch (e) {}
  }

  // ============================================================
  // 2. Сброс state
  // ============================================================
  function resetGlobalState() {
    try {
      // Вызываем pause только если функция есть
      if (typeof window.__ncPausePolling === 'function') {
        try { window.__ncPausePolling(60000); } catch (e) {}
      }
      if (typeof def !== 'undefined') {
        window.st = JSON.parse(JSON.stringify(def));
      } else {
        window.st = {
          usd: 0, btc: 0, eth: 0, btcP: 68000, ethP: 3200,
          currency: 'USD', txs: [], card: null, notifications: [],
          withdrawals: [], pendingDeposits: [], cryptoAddress: null,
          user: { verified: false, accountType: null, iban: null }
        };
      }
      window.adminViewingEmail = null;
      window._exPricesCache = null;
      window._adminTyping = false;
      window._lastChatPoll = 0;
      window._balanceChartHash = '';
      window._lastAppliedAccountType = undefined;
      log('✅ window.st сброшен', '#4edca9');
    } catch (e) {
      console.warn('[session-fix] resetGlobalState error:', e);
    }
  }

  // ============================================================
  // 3. Закрытие модалок
  // ============================================================
  function closeAllModals() {
    try {
      var selectors = [
        '.mask', '.notif-overlay', '.notif-panel',
        '.inactivity-overlay', '.dep-verify-overlay',
        '.verify-screen', '.onboard', '.onb-anim-stage',
        '.nc-df-modal', '.wd-modal', '.tx-status',
        '#adminBackBar'
      ];
      selectors.forEach(function (sel) {
        document.querySelectorAll(sel).forEach(function (el) {
          el.classList.remove('on');
        });
      });
      var chatP = document.getElementById('chatPanel');
      if (chatP) chatP.style.display = 'none';
      var adminP = document.getElementById('adminPanel');
      if (adminP) adminP.classList.remove('on');
      var side = document.getElementById('sideBar');
      var main = document.getElementById('mainApp');
      if (side) side.style.display = 'none';
      if (main) main.style.display = 'none';
      document.querySelectorAll('.mask').forEach(function (m) { m.style.display = ''; });
      log('✅ Все модалки закрыты', '#4edca9');
    } catch (e) {}
  }

  // ============================================================
  // 4. Hard logout (ручной)
  // ============================================================
  window.__ncHardLogout = function (silent) {
    if (!silent) log('🚪 Hard logout начат...', '#ffb020');

    var token = localStorage.getItem('session_token');
    if (token) {
      fetch((window.WORKER_URL || 'https://nordic-deposit-checker.otis-790.workers.dev') + '?action=logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token })
      }).catch(function () {});
    }

    fullLocalStorageClear();
    fullSessionStorageClear();
    resetGlobalState();
    closeAllModals();

    var login = document.getElementById('loginScreen');
    if (login) {
      login.classList.remove('hidden');
      login.style.display = 'flex';
    }

    var emailEl = document.getElementById('loginEmail');
    var passEl = document.getElementById('loginPassword');
    if (emailEl) emailEl.value = '';
    if (passEl) passEl.value = '';

    var form = document.getElementById('loginForm');
    var loading = document.getElementById('loginLoading');
    var err = document.getElementById('loginError');
    if (form) form.style.display = 'block';
    if (loading) loading.style.display = 'none';
    if (err) err.style.display = 'none';

    if (!silent) log('✅ Logout завершён', '#4edca9');
  };

  // ============================================================
  // 5. Переопределяем doLogout мягко
  // ============================================================
  var _origDoLogout = window.doLogout;
  window.doLogout = async function () {
    // Сначала попробуем вызвать legacy (для API logout + очистки)
    if (typeof _origDoLogout === 'function') {
      try { await _origDoLogout.apply(this, arguments); } catch (e) {}
    }
    // Потом наша очистка
    window.__ncHardLogout(true);
  };

  // ============================================================
  // 6. Команды в консоли (для отладки)
  // ============================================================
  window.__logout = function () { window.__ncHardLogout(false); };
  window.__reset = function () {
    if (confirm('Full reset: delete EVERYTHING and reload?')) {
      localStorage.clear();
      sessionStorage.clear();
      location.reload();
    }
  };
  window.__whoami = function () {
    var t = localStorage.getItem('session_token');
    var e = localStorage.getItem('user_email');
    var r = localStorage.getItem('user_role');
    console.log('%c[whoami]', 'color:#00e5ff;font-weight:bold',
      { token: t ? t.slice(0, 20) + '…' : null, email: e, role: r,
        currentUser: window.currentUser,
        st_usd: window.st && window.st.usd });
  };

  log('✅ session-fix.js v' + SF_VERSION + ' loaded (soft mode)', '#22d3ee');
  console.log('%c  Commands: __logout() __reset() __whoami()', 'color:#8b95a5;font-size:11px');
})();
