/* ============================================================
   NORDIC CRYPTO — POLLING HUB v2.0
   ============================================================
   v2.0 changes:
   • Убрано дублирование syncPendingDeposits (это делает deposit-flow.js)
   • Централизован ТОЛЬКО: chat, balance, withdraw statuses
   • 1 tick раз в 10 сек
   • Пауза когда открыта любая модалка
   ============================================================ */

(function () {
  'use strict';

  var HUB_VERSION = '2.0.0';
  var TICK_INTERVAL = 10000;
  var FAST_INTERVAL = 3000;
  var MODAL_PAUSE_MS = 60000;

  var _busy = false;
  var _modalPauseUntil = 0;
  var _lastAddrPoll = 0;
  var _lastBalanceRefresh = 0;

  function isModalOpen() {
    if (document.querySelector('.nc-df-modal')) return true;
    if (document.getElementById('verifyScreen') && document.getElementById('verifyScreen').classList.contains('on')) return true;
    if (document.getElementById('pendingScreen') && document.getElementById('pendingScreen').classList.contains('on')) return true;
    if (document.getElementById('onboard') && document.getElementById('onboard').classList.contains('on')) return true;
    var wd = document.getElementById('withdrawModal');
    if (wd && wd.style.display === 'flex') return true;
    var mask = document.getElementById('mask');
    if (mask && mask.classList.contains('on')) return true;
    if (document.getElementById('settingsMask') && document.getElementById('settingsMask').classList.contains('on')) return true;
    if (document.getElementById('changePassMask') && document.getElementById('changePassMask').classList.contains('on')) return true;
    var tt = document.getElementById('tradeTerminal');
    if (tt && tt.classList.contains('on')) return true;
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

  async function tick() {
    if (_busy) return;
    if (!window.st) return;
    if (!localStorage.getItem('user_email') && !window.adminViewingEmail) return;
    if (Date.now() < _modalPauseUntil) return;

    var modalOpen = isModalOpen();
    if (modalOpen && !isAddFundsOpen()) {
      if (isChatOpen()) runChatPollSafe();
      return;
    }

    _busy = true;
    var now = Date.now();

    try {
      // 1. Chat (только если открыт)
      if (isChatOpen()) runChatPollSafe();

      // 2. Crypto address sync (только в Add Funds)
      if (isAddFundsOpen() && (now - _lastAddrPoll) > 15000) {
        _lastAddrPoll = now;
        runAddrSyncSafe();
      }

      // 3. Balance refresh (раз в 30 сек)
      if (now - _lastBalanceRefresh > 30000) {
        _lastBalanceRefresh = now;
        runBalanceRefreshSafe();
      }

      // 4. Withdraw statuses (только если есть pending)
      var hasPendingWithdrawals = (window.st.withdrawals || []).some(function (w) { return w.status === 'pending'; });
      if (hasPendingWithdrawals) runWithdrawSyncSafe();

    } catch (e) {
      console.warn('[polling-hub] tick error:', e);
    } finally {
      _busy = false;
    }
  }

  function runChatPollSafe() {
    try { if (typeof window.__ncChatPoll === 'function') window.__ncChatPoll(); } catch (e) {}
  }
  function runAddrSyncSafe() {
    try { if (typeof window.__ncSyncCryptoAddress === 'function') window.__ncSyncCryptoAddress(); } catch (e) {}
  }
  function runWithdrawSyncSafe() {
    try { if (typeof window.__ncSyncWithdrawStatuses === 'function') window.__ncSyncWithdrawStatuses(); } catch (e) {}
  }
  function runBalanceRefreshSafe() {
    try { if (typeof window.refreshBalanceFromServer === 'function') window.refreshBalanceFromServer(); } catch (e) {}
  }

  window.__ncPausePolling = function (ms) {
    _modalPauseUntil = Date.now() + (ms || MODAL_PAUSE_MS);
    console.log('[Polling] ⏸ paused for ' + (ms || MODAL_PAUSE_MS) + 'ms');
  };
  window.__ncResumePolling = function () {
    _modalPauseUntil = 0;
    console.log('[Polling] ▶ resumed');
  };

  function start() {
    setInterval(tick, TICK_INTERVAL);
    setTimeout(tick, 2000);

    // Fast tick для Add Funds
    setInterval(function () {
      if (isAddFundsOpen()) {
        var now = Date.now();
        if (now - _lastAddrPoll > FAST_INTERVAL) {
          _lastAddrPoll = now;
          runAddrSyncSafe();
        }
      }
    }, FAST_INTERVAL);

    // Авто-пауза при появлении депозитной модалки
    var observer = new MutationObserver(function () {
      if (document.querySelector('.nc-df-modal') && Date.now() > _modalPauseUntil) {
        window.__ncPausePolling(120000);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    console.log(
      '%c[NordicCrypto] 🎯 polling-hub.js v' + HUB_VERSION + ' loaded — 1 tick / 10s',
      'color:#22d3ee;font-weight:bold;font-size:13px'
    );
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  window.__ncPollingHub = { tick: tick, pause: window.__ncPausePolling };
})();
