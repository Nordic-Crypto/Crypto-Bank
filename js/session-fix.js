/* ============================================================
   NORDIC CRYPTO — SESSION-FIX.JS v1.0
   ============================================================
   Чистый logout + детект мёртвых сессий + hard reset.

   Проблемы которые решает:
     • Остаются nc_* ключи от старой сессии
     • window.st не сбрасывается при logout
     • Фоновые polling'и продолжают работать
     • При истёкшем токене — пустой state (null, null, null)
     • Онбординг показывается для незалогиненных
   ============================================================ */

(function () {
  'use strict';

  var SF_VERSION = '1.0.0';

  function $(id) { return document.getElementById(id); }

  function log(msg, color) {
    console.log('%c[session-fix] ' + msg, 'color:' + (color || '#22d3ee') + ';font-weight:bold');
  }

  // ============================================================
  // 1. ПОЛНАЯ ОЧИСТКА LOCALSTORAGE
  // ============================================================

  function fullLocalStorageClear() {
    try {
      // Удаляем всё что начинается с наших префиксов
      var keysToRemove = [];
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (!key) continue;
        if (
          key === 'session_token' ||
          key === 'user_email' ||
          key === 'user_role' ||
          key === 'user_name' ||
          key.indexOf('nc_') === 0 ||
          key.indexOf('session_') === 0 ||
          key.indexOf('user_') === 0
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
      var keysToRemove = [];
      for (var i = 0; i < sessionStorage.length; i++) {
        var key = sessionStorage.key(i);
        if (!key) continue;
        if (key.indexOf('nc_') === 0 || key.indexOf('session_') === 0) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(function (k) {
        try { sessionStorage.removeItem(k); } catch (e) {}
      });
      log('✅ sessionStorage очищен: ' + keysToRemove.length + ' ключей', '#4edca9');
    } catch (e) {}
  }

  // ============================================================
  // 2. СБРОС ГЛОБАЛЬНОГО STATE
  // ============================================================

  function resetGlobalState() {
    try {
      // Останавливаем все polling-циклы
      if (typeof window.__ncPausePolling === 'function') {
        window.__ncPausePolling(999999999); // навсегда
      }
      
      // Сбрасываем state в дефолт
      if (typeof def !== 'undefined') {
        window.st = JSON.parse(JSON.stringify(def));
      } else {
        // Fallback — минимальный пустой state
        window.st = {
          usd: 0, btc: 0, eth: 0, btcP: 68000, ethP: 3200,
          currency: 'USD', txs: [], card: null, notifications: [],
          withdrawals: [], pendingDeposits: [], cryptoAddress: null,
          user: { verified: false, accountType: null, iban: null }
        };
      }
      
      // Сбрасываем флаги
      window.adminViewingEmail = null;
      window._exPricesCache = null;
      window._adminTyping = false;
      window._lastChatPoll = 0;
      window._lastAddrSync = 0;
      window._balanceChartHash = '';
      window._lastAppliedAccountType = undefined;
      
      log('✅ window.st сброшен', '#4edca9');
    } catch (e) {
      console.warn('[session-fix] resetGlobalState error:', e);
    }
  }

  // ============================================================
  // 3. ЗАКРЫТИЕ ВСЕХ МОДАЛОК И ОВЕРЛЕЕВ
  // ============================================================

  function closeAllModals() {
    try {
      var selectors = [
        '.mask', '.notif-overlay', '.notif-panel',
        '.inactivity-overlay', '.dep-verify-overlay',
        '.verify-screen', '.onboard', '.onb-anim-stage',
        '.nc-df-modal', '.wd-modal', '.tx-status',
        '#chatPanel', '#adminPanel', '#adminBackBar'
      ];
      selectors.forEach(function (sel) {
        document.querySelectorAll(sel).forEach(function (el) {
          el.classList.remove('on');
          if (el.style && el.id === 'chatPanel') el.style.display = 'none';
          if (el.style && el.id === 'adminPanel') el.style.display = 'none';
        });
      });
      
      // Скрываем sidebar и main
      var side = document.getElementById('sideBar');
      var main = document.getElementById('mainApp');
      if (side) side.style.display = 'none';
      if (main) main.style.display = 'none';
      
      // Сбрасываем inline-стили масок
      document.querySelectorAll('.mask').forEach(function (m) { m.style.display = ''; });
      
      log('✅ Все модалки закрыты', '#4edca9');
    } catch (e) {}
  }

  // ============================================================
  // 4. ПОЛНЫЙ LOGOUT (переопределяет legacy)
  // ============================================================

  window.__ncHardLogout = function (silent) {
    if (!silent) log('🚪 Hard logout начат...', '#ffb020');
    
    // 1. Останавливаем polling
    if (typeof window.__ncPausePolling === 'function') {
      window.__ncPausePolling(999999999);
    }
    
    // 2. Отправляем API logout (best-effort)
    var token = localStorage.getItem('session_token');
    if (token) {
      fetch((window.WORKER_URL || '') + '?action=logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token })
      }).catch(function () {});
    }
    
    // 3. Чистим хранилища
    fullLocalStorageClear();
    fullSessionStorageClear();
    
    // 4. Сбрасываем state
    resetGlobalState();
    
    // 5. Закрываем модалки
    closeAllModals();
    
    // 6. Показываем login screen
    var login = document.getElementById('loginScreen');
    if (login) {
      login.classList.remove('hidden');
      login.style.display = 'flex';
    }
    
    // 7. Очищаем поля логина
    var emailEl = document.getElementById('loginEmail');
    var passEl = document.getElementById('loginPassword');
    if (emailEl) emailEl.value = '';
    if (passEl) passEl.value = '';
    
    // 8. Показываем форму логина (скрываем loading)
    var form = document.getElementById('loginForm');
    var loading = document.getElementById('loginLoading');
    var err = document.getElementById('loginError');
    if (form) form.style.display = 'block';
    if (loading) loading.style.display = 'none';
    if (err) err.style.display = 'none';
    
    if (!silent) log('✅ Logout завершён. Страница готова к новому логину.', '#4edca9');
  };

  // Переопределяем legacy doLogout
  var _origDoLogout = window.doLogout;
  window.doLogout = async function () {
    // Пытаемся вызвать legacy (для API logout)
    if (typeof _origDoLogout === 'function') {
      try {
        await _origDoLogout.apply(this, arguments);
      } catch (e) {}
    }
    // Потом наша жёсткая очистка
    window.__ncHardLogout(true);
  };

    // ============================================================
  // 5. ДЕТЕКТ МЁРТВОЙ СЕССИИ (обновлённый — безопасный)
  // ============================================================

  function checkForDeadSession() {
    var token = localStorage.getItem('session_token');
    var email = localStorage.getItem('user_email');
    
    // Если токена нет — не наш случай, страница сама покажет login
    if (!token) return;
    
    // Если email нет — полусостояние, чистим
    if (token && !email) {
      log('⚠️ Мёртвая сессия: токен есть, email нет → logout', '#ffb020');
      window.__ncHardLogout(true);
      return;
    }
    
    // 🛡️ БЕЗОПАСНЫЙ ДЕТЕКТ: проверяем что роль админа — не трогаем
    var role = localStorage.getItem('user_role');
    if (role === 'admin') {
      log('👑 Admin session — skipping dead-session check', '#8b5cf6');
      return;
    }
    
    // 🛡️ Проверяем есть ли pending deposit — тогда не мешаем
    // (пользователь может быть в процессе)
    // Проверяем только через 30 секунд (было 8)
    setTimeout(function () {
      var stillToken = localStorage.getItem('session_token');
      if (!stillToken) return;
      
      // Проверяем, грузится ли что-то до сих пор
      // (например, pending deposit модалка открыта)
      if (document.querySelector('.nc-df-modal')) {
        log('⏸ Skip dead-session: Incoming modal open', '#22d3ee');
        return;
      }
      
      // Проверяем есть ли вообще активность
      var hasAnyState = window.st && (
        window.st.usd > 0 ||
        (window.st.txs && window.st.txs.length > 0) ||
        window.st.card ||
        (window.st.user && window.st.user.accountType) ||
        (window.st.pendingDeposits && window.st.pendingDeposits.length > 0) ||
        (window.st.verification && window.st.verification.status)
      );
      
      if (!hasAnyState) {
        log('⚠️ Мёртвая сессия: state пуст через 30 сек → logout', '#ffb020');
        window.__ncHardLogout(true);
      } else {
        log('✅ Session OK', '#4edca9');
      }
    }, 30000);  // ← 30 секунд вместо 8
  }

  // ============================================================
  // 6. КНОПКА HARD LOGOUT (опционально — можно вешать вручную)
  // ============================================================

  window.__ncForceLogout = function () {
    if (confirm('Полный выход и очистка данных? Это решит любые проблемы со старой сессией.')) {
      window.__ncHardLogout(false);
    }
  };

  // ============================================================
  // 7. СЛУШАЕМ СОБЫТИЯ СТРАНИЦЫ
  // ============================================================

  // При загрузке — проверяем сессию
  window.addEventListener('load', function () {
    setTimeout(checkForDeadSession, 1000);
  });

  // При возврате во вкладку — тоже проверяем
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) {
      var token = localStorage.getItem('session_token');
      var email = localStorage.getItem('user_email');
      if (token && !email) {
        log('⚠️ Мёртвая сессия при возврате → logout', '#ffb020');
        window.__ncHardLogout(true);
      }
    }
  });

  // ============================================================
  // 8. КОМАНДЫ В КОНСОЛИ (для отладки)
  // ============================================================

  // Просто введи __logout() — и всё очистится
  window.__logout = function () { window.__ncHardLogout(false); };
  
  // Или __reset() — полный сброс
  window.__reset = function () {
    if (confirm('Полный сброс: удалить ВСЁ и перезагрузить страницу?')) {
      localStorage.clear();
      sessionStorage.clear();
      location.reload();
    }
  };

  log('✅ session-fix.js v' + SF_VERSION + ' loaded', '#22d3ee');
  console.log('%c  Команды: __logout() — полный выход, __reset() — сброс всего', 'color:#8b95a5;font-size:11px');
})();
