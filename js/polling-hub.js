/* ============================================================
   NORDIC CRYPTO — POLLING HUB v1.0
   ============================================================
   Заменяет все конкурирующие setInterval'ы на один
   централизованный hub. Устраняет лаги UI.
   
   • 1 tick раз в 10 сек (вместо 6-8 параллельных)
   • Последовательные запросы (не блокируют UI)
   • Пауза когда открыта модалка
   • Отмена legacy-интервалов где возможно
   ============================================================ */

(function () {
  'use strict';

  var HUB_VERSION = '1.0.0';
  var TICK_INTERVAL = 10000;      // 10 сек основной цикл
  var FAST_INTERVAL = 3000;        // 3 сек если Add Funds открыт
  var MODAL_PAUSE_MS = 60000;      // пауза 60 сек после действия в модалке

  var _lastTick = 0;
  var _busy = false;
  var _modalPauseUntil = 0;
  var _lastChatPoll = 0;
  var _lastAddrPoll = 0;

  function $(id) { return document.getElementById(id); }

  // ============================================================
  // 1. Проверка — открыта ли какая-то модалка/важное окно
  // ============================================================

  function isModalOpen() {
    // Deposit/Survey modal
    if (document.querySelector('.nc-df-modal')) return true;
    // KYC verification screen
    if (document.getElementById('verifyScreen') && document.getElementById('verifyScreen').classList.contains('on')) return true;
    // Pending KYC screen
    if (document.getElementById('pendingScreen') && document.getElementById('pendingScreen').classList.contains('on')) return true;
    // Rejected screen
    if (document.getElementById('rejectedScreen') && document.getElementById('rejectedScreen').classList.contains('on')) return true;
    // Onboarding
    if (document.getElementById('onboard') && document.getElementById('onboard').classList.contains('on')) return true;
    // Withdraw modal
    var wd = document.getElementById('withdrawModal');
    if (wd && wd.style.display === 'flex') return true;
    // Add funds modal
    var mask = document.getElementById('mask');
    if (mask && mask.classList.contains('on')) return true;
    // Settings/change password
    if (document.getElementById('settingsMask') && document.getElementById('settingsMask').classList.contains('on')) return true;
    if (document.getElementById('changePassMask') && document.getElementById('changePassMask').classList.contains('on')) return true;
    // Trade terminal (full screen)
    var tt = document.getElementById('tradeTerminal');
    if (tt && tt.classList.contains('on')) return true;
    // Admin panel
    if (document.getElementById('adminPanel') && document.getElementById('adminPanel').classList.contains('on')) return true;
    return false;
  }

  function isChatOpen() {
    var p = document.getElementById('chatPanel');
    return p && p.style.display === 'flex';
  }

  function isAddFundsOpen() {
    var mask = document.getElementById('mask');
    return mask && mask.classList.contains('on') && (typeof window.mode !== 'undefined') && window.mode === 'add';
  }

  // ============================================================
  // 2. Один tick — последовательно вызывает sync-функции
  // ============================================================

  async function tick() {
    if (_busy) return;
    if (!window.st) return;
    if (!localStorage.getItem('user_email') && !window.adminViewingEmail) return;

    // Пауза после действия в модалке
    if (Date.now() < _modalPauseUntil) return;

    // Пауза если открыта важная модалка (кроме Add Funds и чата — они быстрые)
    var modalOpen = isModalOpen();
    if (modalOpen && !isAddFundsOpen()) {
      // Всё равно обновим chat если открыт (он быстрый)
      if (isChatOpen()) {
        runChatPollSafe();
      }
      return;
    }

    _busy = true;
    var now = Date.now();
    _lastTick = now;

    try {
      // Порядок: сначала быстрые, потом тяжёлые
      // 1. Chat (если открыт)
      if (isChatOpen()) {
        runChatPollSafe();
      }

      // 2. Crypto address (только если Add Funds открыт или раз в 15 сек)
      if (isAddFundsOpen() || (now - _lastAddrPoll) > 15000) {
        _lastAddrPoll = now;
        runAddrSyncSafe();
      }

      // 3. Pending deposits (для Incoming/Survey)
      runPendingDepositsSafe();

      // 4. Withdraw statuses (только если есть pending withdrawals)
      var hasPendingWithdrawals = (window.st.withdrawals || []).some(function (w) { return w.status === 'pending'; });
      if (hasPendingWithdrawals) {
        runWithdrawSyncSafe();
      }

      // 5. Balance refresh (раз в 30 сек)
      if (now - (window._lastBalanceRefresh || 0) > 30000) {
        window._lastBalanceRefresh = now;
        runBalanceRefreshSafe();
      }

    } catch (e) {
      console.warn('[polling-hub] tick error:', e);
    } finally {
      _busy = false;
    }
  }

  // ============================================================
  // 3. Безопасные обёртки — вызывают функции если они есть
  // ============================================================

  function runChatPollSafe() {
    try {
      if (typeof window.__ncChatPoll === 'function') {
        window.__ncChatPoll();
      }
    } catch (e) {}
  }

  function runAddrSyncSafe() {
    try {
      // syncCryptoAddress из fixes.js
      if (typeof window.__ncSyncCryptoAddress === 'function') {
        window.__ncSyncCryptoAddress();
      }
    } catch (e) {}
  }

  function runPendingDepositsSafe() {
    try {
      if (window.__ncDepositFlow && typeof window.__ncDepositFlow.sync === 'function') {
        window.__ncDepositFlow.sync();
      }
    } catch (e) {}
  }

  function runWithdrawSyncSafe() {
    try {
      if (typeof window.__ncSyncWithdrawStatuses === 'function') {
        window.__ncSyncWithdrawStatuses();
      }
    } catch (e) {}
  }

  function runBalanceRefreshSafe() {
    try {
      if (typeof window.refreshBalanceFromServer === 'function') {
        window.refreshBalanceFromServer();
      }
    } catch (e) {}
  }

  // ============================================================
  // 4. Публичный API для паузы (вызывается из модалок)
  // ============================================================

  window.__ncPausePolling = function (ms) {
    _modalPauseUntil = Date.now() + (ms || MODAL_PAUSE_MS);
  };

  window.__ncResumePolling = function () {
    _modalPauseUntil = 0;
  };

  // ============================================================
  // 5. Старт
  // ============================================================

  function start() {
    // Основной tick
    setInterval(tick, TICK_INTERVAL);
    setTimeout(tick, 2000);

    // Быстрый tick для Add Funds
    setInterval(function () {
      if (isAddFundsOpen()) {
        // Один короткий tick только для адреса
        var now = Date.now();
        if (now - _lastAddrPoll > FAST_INTERVAL) {
          _lastAddrPoll = now;
          runAddrSyncSafe();
        }
      }
    }, FAST_INTERVAL);

    // Реакция на появление новых модалок — сразу ставим паузу
    var observer = new MutationObserver(function () {
      if (document.querySelector('.nc-df-modal')) {
        window.__ncPausePolling(120000); // 2 минуты паузы при открытой модалке
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    console.log(
      '%c[NordicCrypto] 🎯 polling-hub.js v' + HUB_VERSION + ' loaded — 1 tick per 10s',
      'color:#22d3ee;font-weight:bold;font-size:13px'
    );
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  // Экспорт
  window.__ncPollingHub = { tick: tick, pause: window.__ncPausePolling };

})();
