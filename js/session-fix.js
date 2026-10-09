/* ============================================================
   NORDIC CRYPTO — SESSION-FIX.JS v2.1
   ============================================================
   v2.1 FIXES:
   • 🛡️ sessionStorage очищается ТОЛЬКО для чата/KYC (не inflight)
   • 🛡️ resetGlobalState сбрасывает __ncSurveyOpen / __ncIncomingOpen
   • 🛡️ Убран двойной вызов __ncHardLogout
   • 🛡️ НЕ трогает nc_loyalty_ts_* / nc_bonus_* / nc_welcome_bonus_*
   • 🛡️ НЕ трогает nc_loyalty_inflight_* (защита от race)
   • 🎁 Команды в консоли: __logout, __reset, __whoami, __bonus
   ============================================================ */

(function () {
  'use strict';

  var SF_VERSION = '2.1.0';
  function log(msg, color) {
    console.log('%c[session-fix] ' + msg, 'color:' + (color || '#22d3ee') + ';font-weight:bold');
  }

  // ============================================================
  // 🛡️ КЛЮЧИ, КОТОРЫЕ НЕ ТРОГАЕМ (долговременные)
  // ============================================================
  var PRESERVE_PREFIXES = [
    'nc_loyalty_',          // loyalty timestamps + inflight
    'nc_bonus_',            // вся история бонусов
    'nc_welcome_bonus_',    // welcome флаги
    'nc_referral_used_'     // referral флаги
  ];

  function shouldPreserve(key) {
    for (var i = 0; i < PRESERVE_PREFIXES.length; i++) {
      if (key.indexOf(PRESERVE_PREFIXES[i]) === 0) return true;
    }
    return false;
  }

  // ============================================================
  // 1. Полная очистка localStorage (только сессионные ключи)
  // ============================================================
  function fullLocalStorageClear() {
    try {
      var keysToRemove = [];
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (!key) continue;

        // 🛡️ НЕ трогаем долговременные ключи
        if (shouldPreserve(key)) continue;

        if (
          key === 'session_token' ||
          key === 'user_email' ||
          key === 'user_role' ||
          key === 'user_name' ||
          key.indexOf('nc_seen_pd_') === 0 ||
          key.indexOf('nc_receipt_') === 0
        ) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(function (k) {
        try { localStorage.removeItem(k); } catch (e) {}
      });
      log('✅ localStorage: очищено ' + keysToRemove.length + ' ключей', '#4edca9');
    } catch (e) {}
  }

  // ============================================================
  // 2. sessionStorage — только сессионные ключи чата/KYC
  // ============================================================
  function fullSessionStorageClear() {
    try {
      var keysToRemove = [];
      for (var i = 0; i < sessionStorage.length; i++) {
        var key = sessionStorage.key(i);
        if (!key) continue;

        // 🛡️ НЕ трогаем loyalty inflight (защита от race)
        if (key.indexOf('nc_loyalty_inflight_') === 0) continue;

        // Удаляем только то, что связано с текущей сессией
        if (
          key.indexOf('nc_seen_pd_') === 0 ||
          key.indexOf('nc_chat_') === 0 ||
          key.indexOf('nc_admin_prev_') === 0
        ) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(function (k) {
        try { sessionStorage.removeItem(k); } catch (e) {}
      });
      log('✅ sessionStorage: очищено ' + keysToRemove.length + ' ключей', '#4edca9');
    } catch (e) {}
  }

  // ============================================================
  // 3. Сброс state + глобальных флагов
  // ============================================================
  function resetGlobalState() {
    try {
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

      // 🛡️ Сбрасываем глобальные флаги модалок
      window.adminViewingEmail     = null;
      window._exPricesCache        = null;
      window._adminTyping          = false;
      window._lastChatPoll         = 0;
      window._balanceChartHash     = '';
      window._lastAppliedAccountType = undefined;

      // 🛡️ Флаги deposit-flow
      window.__ncSurveyOpen   = false;
      window.__ncIncomingOpen = false;

      // 🛡️ Флаг auth (чтобы login эмитился заново)
      window.__ncLoginEmitted = false;

      log('✅ window.st + флаги сброшены', '#4edca9');
    } catch (e) {
      console.warn('[session-fix] resetGlobalState error:', e);
    }
  }

  // ============================================================
  // 4. Закрытие всех модалок
  // ============================================================
  function closeAllModals() {
    try {
      var selectors = [
        '.mask', '.notif-overlay', '.notif-panel',
        '.inactivity-overlay', '.dep-verify-overlay',
        '.verify-screen', '.onboard', '.onb-anim-stage',
        '.nc-df-modal', '.wd-modal', '.tx-status',
        '.trade-mask', '.nc-bonus-modal',
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
  // 5. Hard logout (единственная точка)
  // ============================================================
  window.__ncHardLogout = function (silent) {
    if (!silent) log('🚪 Hard logout...', '#ffb020');

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

    // Убираем bonus UI
    var b = document.getElementById('ncBadge');
    var c = document.getElementById('ncRewardsCard');
    if (b) b.remove();
    if (c) c.remove();

    var login = document.getElementById('loginScreen');
    if (login) {
      login.classList.remove('hidden');
      login.style.display = 'flex';
    }

    var emailEl = document.getElementById('loginEmail');
    var passEl  = document.getElementById('loginPassword');
    if (emailEl) emailEl.value = '';
    if (passEl)  passEl.value  = '';

    var form    = document.getElementById('loginForm');
    var loading = document.getElementById('loginLoading');
    var err     = document.getElementById('loginError');
    if (form)    form.style.display    = 'block';
    if (loading) loading.style.display = 'none';
    if (err)     err.style.display     = 'none';

    if (!silent) log('✅ Logout завершён', '#4edca9');
  };

  // ============================================================
  // 6. Переопределяем doLogout — БЕЗ двойного вызова
  // ============================================================
  window.doLogout = async function () {
    var token = localStorage.getItem('session_token');
    if (token) {
      try {
        await fetch((window.WORKER_URL || 'https://nordic-deposit-checker.otis-790.workers.dev') + '?action=logout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: token })
        });
      } catch (e) {}
    }
    // 🛡️ Один вызов — он делает всё
    window.__ncHardLogout(true);
  };

  // ============================================================
  // 7. Команды в консоли
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
    console.log('%c[whoami]', 'color:#00e5ff;font-weight:bold', {
      token: t ? t.slice(0, 20) + '…' : null,
      email: e,
      role: r,
      currentUser: window.currentUser,
      st_usd: window.st && window.st.usd
    });
  };

  // 🎁 НОВАЯ КОМАНДА — показать все бонусы
  window.__bonus = function () {
    if (typeof window.NC_BONUS !== 'object') {
      console.warn('❌ NC_BONUS не загружен');
      return;
    }
    var history = window.NC_BONUS.history();
    var stats   = window.NC_BONUS.stats && window.NC_BONUS.stats();
    console.log('%c[Bonus] 🎁 Total: ' + (stats ? stats.total : '?'),
      'color:#f59e0b;font-weight:bold');
    console.table(history.map(function (e) {
      return {
        type: e.type,
        label: e.label,
        amount: e.amount,
        date: new Date(e.ts).toLocaleString()
      };
    }));
  };

  log('✅ session-fix.js v' + SF_VERSION + ' loaded', '#22d3ee');
  console.log('%c  Commands: __logout() __reset() __whoami() __bonus()',
    'color:#8b95a5;font-size:11px');
})();
