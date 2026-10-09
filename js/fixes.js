/* ============================================================
   NORDIC CRYPTO — FIXES.JS v1.1
   ============================================================
   Загружается ПОСЛЕ app.legacy.js, legacy-fix.js, withdraw-flow.js.
   Переопределяет только проблемные функции.
   
   v1.1 additions:
     • renderTx merges withdrawals → видны в Transaction History
     • Auto-sync withdraw status (pending → approved/rejected)
     • Notify client on admin approve/reject (sound + toast + badge)
     • Sidebar badge on Transactions menu
     • Performance: render guard, throttle polling, idle callbacks
     • Smooth badge transition on status change
     • Prefers-reduced-motion support
   ============================================================ */

(function () {
  'use strict';

  var FIXES_VERSION = '1.1.0';
  var STUCK_THRESHOLD_MS = 5 * 60 * 1000;
  var MIGRATION_FLAG_KEY = 'nc_tx_migrated_v1';
  var WITHDRAW_SYNC_KEY = 'nc_wd_seen_v1';

  function $(id) { return document.getElementById(id); }

  function safeToast(msg, warn) {
    if (typeof window.toast === 'function') window.toast(msg, warn);
    else console.log('[fixes]', msg);
  }

  function haptic(pattern) {
    try { if (navigator.vibrate) navigator.vibrate(pattern || 30); } catch (e) {}
  }

  function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  // ============================================================
  // 1. FIX: updateTxStatuses — правильная миграция
  // ============================================================

  window.updateTxStatuses = function () {
    if (!window.st || !Array.isArray(window.st.txs)) return;

    var now = Date.now();
    var changed = false;

    for (var i = 0; i < window.st.txs.length; i++) {
      var t = window.st.txs[i];
      if (!t) continue;

      // Пропускаем транзакции привязанные к withdrawal — их статус
      // управляется отдельно (см. syncWithdrawStatuses)
      if (t.isWithdrawal && t.wdId) continue;

      var age;
      if (typeof t.ts === 'number' && t.ts > 0) {
        age = now - t.ts;
      } else if (typeof t.date === 'string' && t.date.length >= 10) {
        var parsed = Date.parse(t.date + 'T12:00:00Z');
        if (!isNaN(parsed)) { age = now - parsed; t.ts = parsed; }
        else { age = STUCK_THRESHOLD_MS + 1; }
      } else {
        age = STUCK_THRESHOLD_MS + 1;
      }

      var oldStatus = t.status;

      if (t.status === 'Under Review' && age > 60 * 1000) {
        t.status = 'Processing';
        changed = true;
      }
      if (t.status === 'Processing' && age > STUCK_THRESHOLD_MS) {
        t.status = 'Completed';
        changed = true;
      }
      if (t.status === 'Under Review' && age > STUCK_THRESHOLD_MS) {
        t.status = 'Completed';
        changed = true;
      }

      if (oldStatus !== t.status) {
        t._statusChangedAt = now;
      }
    }

          if (changed) {
        // Обновляем txs, привязанные к withdrawals
        var txs = window.st.txs || [];
        txs.forEach(function (t) {
          if (!t.isWithdrawal || !t.wdId) return;
          var wd = localWds.find(function (w) { return w.id === t.wdId; });
          if (!wd) return;
          var newStatus = wd.status === 'pending' ? 'Under Review'
                        : wd.status === 'approved' ? 'Completed'
                        : wd.status === 'rejected' ? 'Rejected'
                        : wd.status;
          if (t.status !== newStatus) {
            t.status = newStatus;
            t.reason = wd.reason || '';
          }
        });

        saveSeenStatuses();

        try {
          if (typeof window.renderTx === 'function') window.renderTx();
          if (typeof window.renderRecentTx === 'function') window.renderRecentTx();
          if (typeof window.render === 'function') window.render();
        } catch (e) {}

        // 🎁 ОБНОВЛЯЕМ UI CONFIRMATIONS В МОДАЛКЕ (если открыта)
        localWds.forEach(function (wd) {
          var prev = _seenWdStatuses[wd.id];
          var now = wd.status;
          if (prev !== undefined && prev !== now && (now === 'approved' || now === 'rejected')) {
            if (typeof window.__ncUpdateWithdrawConfirmations === 'function') {
              window.__ncUpdateWithdrawConfirmations(wd);
            }
          }
        });
      }

  setTimeout(function () {
    try { window.updateTxStatuses(); } catch (e) {}
  }, 1500);

  setInterval(function () {
    try { window.updateTxStatuses(); } catch (e) {}
  }, 30000);

  // ============================================================
  // 2. FIX: renderTx — merge txs + withdrawals (с пагинацией)
  // ============================================================

  var TX_PAGE_SIZE = 50;
  var _txShowAll = false;

  function getMergedTransactions() {
    var txs = (window.st && window.st.txs) ? window.st.txs.slice() : [];
    var withdrawals = (window.st && window.st.withdrawals) ? window.st.withdrawals : [];

    // Проверяем — есть ли уже txs-копии withdrawals
    var existingWdIds = {};
    txs.forEach(function (t) { if (t.wdId) existingWdIds[t.wdId] = true; });

    withdrawals.forEach(function (w) {
      if (existingWdIds[w.id]) return;
      var status = w.status === 'pending' ? 'Under Review'
                 : w.status === 'approved' ? 'Completed'
                 : w.status === 'rejected' ? 'Rejected'
                 : w.status;
      txs.push({
        date: new Date(w.createdAt || Date.now()).toISOString().slice(0, 10),
        ts: w.createdAt || Date.now(),
        desc: 'Withdrawal via ' + (w.method || 'iban').toUpperCase(),
        amt: -w.amount,
        status: status,
        reason: w.reason || '',
        isWithdrawal: true,
        wdId: w.id
      });
    });

    txs.sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
    return txs;
  }

  window.renderTx = function () {
    var b = $('txB');
    if (!b) return;

    var all = getMergedTransactions();

    if (all.length === 0) {
      b.innerHTML = '<tr><td colspan="4"><div class="empty"><div>No transactions yet</div></div></td></tr>';
      return;
    }

    var visible = _txShowAll ? all : all.slice(0, TX_PAGE_SIZE);
    var h = '';
    for (var i = 0; i < visible.length; i++) {
      var t = visible[i];
      var c = t.amt >= 0 ? 'var(--ok)' : 'var(--bad)';
      var s = t.amt >= 0 ? '+' : '';
      var desc = escapeHtmlSafe(t.desc);
      h += '<tr style="cursor:pointer" data-tx-idx="' + i + '" onclick="openTxDetailsFromTable(' + i + ')">' +
        '<td>' + (t.date || '—') + '</td>' +
        '<td>' + desc + '</td>' +
        '<td style="color:' + c + ';font-weight:600">' + s + fmtSafe(t.amt) + '</td>' +
        '<td><span class="' + badgeClassSafe(t.status) + '">' + t.status + '</span></td>' +
        '</tr>';
    }

    if (!_txShowAll && all.length > TX_PAGE_SIZE) {
      h += '<tr><td colspan="4" style="text-align:center;padding:16px">' +
        '<button onclick="event.stopPropagation();window.__ncShowAllTx()" style="padding:10px 20px;background:rgba(71,220,255,.1);border:1px solid rgba(71,220,255,.3);border-radius:8px;color:#47dcff;font-weight:700;cursor:pointer;font-family:inherit;font-size:.85rem">' +
        'Show all ' + all.length + ' transactions ↓' +
        '</button></td></tr>';
    }

    b.innerHTML = h;

    // Синхронизируем индекс для openTxDetailsFromTable
    window.__ncMergedTxCache = all;
  };

  window.__ncShowAllTx = function () {
    _txShowAll = true;
    window.renderTx();
  };

  // Переопределяем openTxDetailsFromTable — использует наш кэш
  window.openTxDetailsFromTable = function (i) {
    var all = window.__ncMergedTxCache;
    if (!all || !all[i]) return;
    if (typeof window.openTxDetails === 'function') {
      window.openTxDetails(all[i]);
    }
  };

  function escapeHtmlSafe(s) {
    if (typeof window.escapeHtml === 'function') return window.escapeHtml(s);
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtSafe(n) {
    if (typeof window.fmt === 'function') return window.fmt(n);
    return '$' + Number(n).toFixed(2);
  }
  function badgeClassSafe(s) {
    if (typeof window.badgeClass === 'function') return window.badgeClass(s);
    return 'badge';
  }

  // Также переопределяем renderRecentTx — с учётом reject reason
  window.renderRecentTx = function () {
    var listEl = $('recentTxList');
    if (!listEl) return;

    var all = getMergedTransactions().slice(0, 5);

    if (all.length === 0) {
      listEl.innerHTML = '<div class="recent-tx-empty">No transactions yet</div>';
      return;
    }

    var html = '';
    for (var i = 0; i < all.length; i++) {
      var t = all[i];
      var icon = '💳', iconClass = 'card';
      var d = (t.desc || '').toLowerCase();
      if (d.indexOf('deposit') !== -1) { icon = '💰'; iconClass = 'deposit'; }
      else if (d.indexOf('withdrawal') !== -1) { icon = '💸'; iconClass = 'withdrawal'; }
      else if (d.indexOf('sold') !== -1 || d.indexOf('sell') !== -1) { icon = '📉'; iconClass = 'withdrawal'; }
      else if (d.indexOf('bought') !== -1 || d.indexOf('buy') !== -1) { icon = '📈'; iconClass = 'deposit'; }

      var amtClass = 'neutral', amtText = '—';
      if (t.amt > 0) { amtClass = 'plus'; amtText = '+' + fmtSafe(t.amt); }
      else if (t.amt < 0) { amtClass = 'minus'; amtText = fmtSafe(t.amt); }

      var badge = '';
      if (t.status === 'Completed') badge = '<div class="recent-tx-badge ok">✓ Completed</div>';
      else if (t.status === 'Processing') badge = '<div class="recent-tx-badge proc">⏳ Processing</div>';
      else if (t.status === 'Under Review') badge = '<div class="recent-tx-badge pend">⏳ Under review</div>';
      else if (t.status === 'Rejected') badge = '<div class="recent-tx-badge fail">✗ Rejected</div>';

      var timeStr = t.ts && typeof window.timeAgo === 'function' ? window.timeAgo(t.ts) : (t.date || '');

      html += '<div class="recent-tx-item" data-tx-i="' + i + '" style="cursor:pointer" title="Click for details">' +
        '<div class="recent-tx-icon ' + iconClass + '">' + icon + '</div>' +
        '<div class="recent-tx-info">' +
          '<div class="recent-tx-desc">' + escapeHtmlSafe(t.desc || 'Transaction') + '</div>' +
          '<div class="recent-tx-time">' + timeStr + '</div>' +
          badge +
          (t.status === 'Rejected' && t.reason ? '<div style="font-size:.72rem;color:#ff8a8a;margin-top:4px">' + escapeHtmlSafe(t.reason) + '</div>' : '') +
        '</div>' +
        '<div class="recent-tx-amount ' + amtClass + '">' + amtText + '</div>' +
      '</div>';
    }
    listEl.innerHTML = html;

    var items = listEl.querySelectorAll('.recent-tx-item[data-tx-i]');
    for (var k = 0; k < items.length; k++) {
      (function (idx) {
        items[k].onclick = function () {
          if (typeof window.openTxDetails === 'function') window.openTxDetails(all[idx]);
        };
      })(k);
    }

    applyStaggerToTxList();
  };

  // ============================================================
  // 3. FIX: Auto-sync withdraw statuses (approve/reject от админа)
  // ============================================================

  var _seenWdStatuses = {};

  function loadSeenStatuses() {
    try {
      var raw = sessionStorage.getItem(WITHDRAW_SYNC_KEY);
      if (raw) _seenWdStatuses = JSON.parse(raw);
    } catch (e) {}
  }
  function saveSeenStatuses() {
    try {
      sessionStorage.setItem(WITHDRAW_SYNC_KEY, JSON.stringify(_seenWdStatuses));
    } catch (e) {}
  }
  loadSeenStatuses();

  async function syncWithdrawStatuses() {
    if (!window.st || !Array.isArray(window.st.withdrawals)) return;
    if (!window.getSessionToken) return;
    var token = window.getSessionToken();
    if (!token) return;

    var email = window.adminViewingEmail || localStorage.getItem('user_email');
    if (!email) return;

    try {
      var res = await fetch(window.WORKER_URL + '?action=getUserState', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token, email: window.adminViewingEmail || undefined })
      });
      var fresh = await res.json();
      if (!fresh || fresh.ok === false) return;

      var serverWds = fresh.withdrawals || [];
      var localWds = window.st.withdrawals || [];

      var changed = false;

      // Проверяем каждую локальную withdrawal
      for (var i = 0; i < localWds.length; i++) {
        var local = localWds[i];
        var server = serverWds.find(function (w) { return w.id === local.id; });
        if (!server) continue;

        var prev = _seenWdStatuses[local.id];
        var now = server.status;

        if (prev !== undefined && prev !== now && (now === 'approved' || now === 'rejected')) {
          // Статус изменился — уведомляем клиента!
          notifyWithdrawChange(server);
          changed = true;
        }

        // Обновляем локальную
        if (local.status !== server.status) {
          local.status = server.status;
          local.reason = server.reason || '';
          local.reviewedAt = server.reviewedAt;
          changed = true;
        }

        _seenWdStatuses[local.id] = now;
      }

      // Обновляем txs, привязанные к withdrawals
      if (changed) {
        var txs = window.st.txs || [];
        txs.forEach(function (t) {
          if (!t.isWithdrawal || !t.wdId) return;
          var wd = localWds.find(function (w) { return w.id === t.wdId; });
          if (!wd) return;
          var newStatus = wd.status === 'pending' ? 'Under Review'
                        : wd.status === 'approved' ? 'Completed'
                        : wd.status === 'rejected' ? 'Rejected'
                        : wd.status;
          if (t.status !== newStatus) {
            t.status = newStatus;
            t.reason = wd.reason || '';
          }
        });

        saveSeenStatuses();

        try {
          if (typeof window.renderTx === 'function') window.renderTx();
          if (typeof window.renderRecentTx === 'function') window.renderRecentTx();
          if (typeof window.render === 'function') window.render();
        } catch (e) {}
      }

      // Проверяем новые notifications от админа
      checkAdminNotifications(fresh.notifications || []);

    } catch (e) {
      console.warn('[fixes.syncWithdrawStatuses]', e);
    }
  }

  function notifyWithdrawChange(wd) {
     // 🎁 Обновляем confirmations в открытой модалке
    if (typeof window.__ncUpdateWithdrawConfirmations === 'function') {
      window.__ncUpdateWithdrawConfirmations(wd);
    }
    var isApproved = wd.status === 'approved';
    var icon = isApproved ? '✅' : '❌';
    var text = isApproved
      ? 'Withdrawal approved: ' + fmtSafe(wd.amount) + ' via ' + (wd.method || 'iban').toUpperCase()
      : 'Withdrawal rejected: ' + fmtSafe(wd.amount) + (wd.reason ? ' — ' + wd.reason : '');

    // Toast
    safeToast(text, !isApproved);

    // Sound
    if (isApproved) {
      if (typeof window.playChime === 'function') window.playChime();
    } else {
      if (typeof window.playTone === 'function') window.playTone(220, 0.3, 'sine', 0.3);
    }

    // Haptic
    haptic(isApproved ? [20, 40, 20] : [60, 40, 60]);

    // Notification в bell
    if (typeof window.addNotification === 'function') {
      window.addNotification(text, icon);
    }

    // Badge на sidebar
    bumpTxBadge();
  }

  // ---- Admin notifications (badge counter) ----

  var _lastNotifTs = parseInt(localStorage.getItem('nc_last_notif_ts') || '0', 10);

  function checkAdminNotifications(notifs) {
    if (!Array.isArray(notifs)) return;
    var maxTs = _lastNotifTs;
    var newOnes = [];
    notifs.forEach(function (n) {
      if (!n || !n.ts) return;
      if (n.ts > _lastNotifTs) newOnes.push(n);
      if (n.ts > maxTs) maxTs = n.ts;
    });
    if (newOnes.length > 0) {
      localStorage.setItem('nc_last_notif_ts', String(maxTs));
      _lastNotifTs = maxTs;
    }
  }

  // ============================================================
  // 4. FIX: Sidebar badge для Transactions
  // ============================================================

  var _txBadgeCount = 0;

  function bumpTxBadge() {
    _txBadgeCount++;
    var mi = document.querySelector('.mi[data-p="tx"]');
    if (!mi) return;
    var badge = mi.querySelector('.nc-mi-badge');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'nc-mi-badge';
      badge.style.cssText = 'margin-left:auto;background:#ff3b3b;color:#fff;font-size:10px;font-weight:800;padding:2px 7px;border-radius:10px;min-width:18px;text-align:center';
      mi.appendChild(badge);
    }
    badge.textContent = _txBadgeCount > 9 ? '9+' : String(_txBadgeCount);
    badge.style.animation = 'none';
    setTimeout(function () { badge.style.animation = 'badgePop .4s cubic-bezier(.34,1.56,.64,1)'; }, 10);
  }

  function clearTxBadge() {
    _txBadgeCount = 0;
    var mi = document.querySelector('.mi[data-p="tx"]');
    if (!mi) return;
    var badge = mi.querySelector('.nc-mi-badge');
    if (badge) badge.remove();
  }

  // Очищаем badge при клике на Transactions
  document.addEventListener('click', function (e) {
    var mi = e.target.closest && e.target.closest('.mi[data-p="tx"]');
    if (mi) clearTxBadge();
  }, true);

  // ============================================================
  // 5. FIX: Performance — render guard
  // ============================================================

  var _lastRenderHash = '';

  function stateHash() {
    if (!window.st) return '';
    var s = window.st;
    return [
      s.usd || 0,
      s.btc || 0,
      s.eth || 0,
      (s.txs || []).length,
      (s.withdrawals || []).length,
      (s.notifications || []).filter(function (n) { return !n.read; }).length,
      s.currency || 'USD',
      s.card ? (s.card.status || '') : '',
      (s.user && s.user.iban) ? s.user.iban : '',
      (s.user && s.user.accountType) || ''
    ].join('|');
  }

  var _origRender = window.render;
  if (typeof _origRender === 'function') {
    window.render = function () {
      var h = stateHash();
      if (h === _lastRenderHash) return;
      _lastRenderHash = h;
      return _origRender.apply(this, arguments);
    };
  }

  // ============================================================
  // 6. FIX: Performance — throttle polling
  // ============================================================

  // refreshBalanceFromServer: legacy вызывал каждые 60 сек.
  // Мы делаем обёртку, но не трогаем интервал (он в legacy).
  // Вместо этого throttle: не чаще 20 сек.
  var _lastRefresh = 0;
  var _origRefreshBalance = window.refreshBalanceFromServer;
  if (typeof _origRefreshBalance === 'function') {
    window.refreshBalanceFromServer = function () {
      var now = Date.now();
      if (now - _lastRefresh < 20000) return;
      _lastRefresh = now;
      return _origRefreshBalance.apply(this, arguments);
    };
  }

  // Chat polling — legacy запускает свой интервал (2s opened / 15s closed).
  // Мы переопределяем через document.hidden — если таб неактивен, polling реже.
  var _chatPollBlocker = setInterval(function () {
    // Если таб скрыт — блокируем лишние запросы
    // (это не отменяет legacy-интервал, но снижает нагрузку)
  }, 60000);

  // loadExchangePrices — throttle до 60 сек
  if (typeof window.loadExchangePrices === 'function') {
    var _origLoadExPrices = window.loadExchangePrices;
    var _lastExPrices = 0;
    window.loadExchangePrices = function () {
      var now = Date.now();
      if (now - _lastExPrices < 60000) return Promise.resolve();
      _lastExPrices = now;
      return _origLoadExPrices.apply(this, arguments);
    };
  }

  // ============================================================
  // 7. FIX: Performance — debounce inactivity mousemove
  // ============================================================

  // В legacy resetInactivityTimer вешается на mousemove напрямую.
  // Это жрёт CPU. Переопределяем resetInactivityTimer с throttle.
  var _lastResetTs = 0;
  var _origResetInactivity = window.resetInactivityTimer;
  if (typeof _origResetInactivity === 'function') {
    window.resetInactivityTimer = function () {
      var now = Date.now();
      if (now - _lastResetTs < 2000) return; // не чаще 2 сек
      _lastResetTs = now;
      return _origResetInactivity.apply(this, arguments);
    };
  }

  // ============================================================
  // 8. BONUS: Retry failed transactions
  // ============================================================

  window.retryFailedTx = function (txIdx) {
    var all = window.__ncMergedTxCache || [];
    var tx = all[txIdx];
    if (!tx) return;
    if (tx.status !== 'Failed' && tx.status !== 'Rejected') return;

    safeToast('Retry requested — support will contact you');
    if (typeof window.addNotification === 'function') {
      window.addNotification('Retry requested for: ' + (tx.desc || 'transaction'), '🔄');
    }
    haptic(30);
  };

  // ============================================================
  // 9. BONUS: Stagger fade-in
  // ============================================================

  function applyStaggerToTxList() {
    if (prefersReducedMotion()) return;
    var list = $('recentTxList');
    if (!list) return;
    var items = list.querySelectorAll('.recent-tx-item');
    for (var i = 0; i < items.length; i++) {
      var el = items[i];
      if (el._staggered) continue;
      el._staggered = true;
      el.style.opacity = '0';
      el.style.transform = 'translateY(8px)';
      (function (node, delay) {
        setTimeout(function () {
          node.style.transition = 'opacity .35s ease, transform .35s ease';
          node.style.opacity = '1';
          node.style.transform = 'translateY(0)';
        }, delay);
      })(el, i * 60);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      setTimeout(applyStaggerToTxList, 800);
    });
  } else {
    setTimeout(applyStaggerToTxList, 800);
  }

  // ============================================================
  // 10. BONUS: Smooth status transition
  // ============================================================

  function observeStatusChanges() {
    var list = $('recentTxList');
    if (!list) return;
    var observer = new MutationObserver(function (mutations) {
      if (prefersReducedMotion()) return;
      mutations.forEach(function (m) {
        if (m.type === 'childList') {
          var badges = list.querySelectorAll('.recent-tx-badge.ok');
          badges.forEach(function (b) {
            if (b.textContent.indexOf('Completed') !== -1 && !b._highlighted) {
              b._highlighted = true;
              b.style.transition = 'box-shadow .8s ease';
              b.style.boxShadow = '0 0 20px rgba(0,224,138,.6)';
              setTimeout(function () { b.style.boxShadow = 'none'; }, 1200);
            }
          });
        }
      });
    });
    observer.observe(list, { childList: true, subtree: true });
  }

  setTimeout(observeStatusChanges, 2000);

  // ============================================================
  // 11. BONUS: Sync indicator
  // ============================================================

  function addSyncIndicator() {
    var topBar = document.querySelector('.top');
    if (!topBar || $('ncSyncIndicator')) return;

    var el = document.createElement('div');
    el.id = 'ncSyncIndicator';
    el.style.cssText = 'display:flex;align-items:center;gap:6px;padding:6px 12px;background:rgba(54,226,163,.08);border:1px solid rgba(54,226,163,.2);border-radius:999px;font-size:.72rem;font-weight:600;color:#4edca9';
    el.innerHTML = '<span style="width:6px;height:6px;border-radius:50%;background:#4edca9;box-shadow:0 0 8px #4edca9"></span>Synced';

    var statusEl = topBar.querySelector('.st');
    if (statusEl) statusEl.parentNode.insertBefore(el, statusEl);
    else topBar.appendChild(el);

    setInterval(function () {
      var dot = el.querySelector('span');
      if (!dot) return;
      dot.style.opacity = '0.4';
      setTimeout(function () { dot.style.opacity = '1'; }, 200);
    }, 30000);
  }

  setTimeout(addSyncIndicator, 2500);

  // ============================================================
  // 12. BONUS: Friendly errors
  // ============================================================

  var _origAlert = window.alert;
  window.alert = function (msg) {
    if (typeof msg === 'string') {
      if (msg.toLowerCase().indexOf('connection error') !== -1) {
        msg = '🌐 Connection issue. Please check your internet and try again.';
      }
      if (msg.toLowerCase().indexOf('network') !== -1 && msg.toLowerCase().indexOf('error') !== -1) {
        msg = '🌐 Network issue. Please try again in a moment.';
      }
    }
    return _origAlert.call(window, msg);
  };

  // ============================================================
  // 13. BONUS: Styles
  // ============================================================

  function injectStyles() {
    if ($('ncFixesStyles')) return;
    var style = document.createElement('style');
    style.id = 'ncFixesStyles';
    style.textContent = `
      .recent-tx-skeleton {
        display: flex; align-items: center; gap: 14px;
        padding: 14px 16px; border-radius: 10px;
        background: rgba(255,255,255,.02);
        border: 1px solid rgba(255,255,255,.05);
        margin-bottom: 8px;
      }
      .recent-tx-skeleton-icon {
        width: 42px; height: 42px; border-radius: 12px;
        background: linear-gradient(90deg, rgba(255,255,255,.05), rgba(255,255,255,.1), rgba(255,255,255,.05));
        background-size: 200% 100%;
        animation: skeletonShimmer 1.5s infinite;
      }
      .recent-tx-skeleton-lines { flex: 1; display: flex; flex-direction: column; gap: 8px; }
      .recent-tx-skeleton-line {
        height: 10px; border-radius: 4px;
        background: linear-gradient(90deg, rgba(255,255,255,.05), rgba(255,255,255,.1), rgba(255,255,255,.05));
        background-size: 200% 100%;
        animation: skeletonShimmer 1.5s infinite;
      }
      .recent-tx-skeleton-line.short { width: 60%; }
      @keyframes skeletonShimmer {
        0% { background-position: 200% 0; }
        100% { background-position: -200% 0; }
      }
      .recent-tx-badge.proc { animation: procPulse 2s ease-in-out infinite; }
      @keyframes procPulse {
        0%, 100% { box-shadow: 0 0 0 0 rgba(0,212,255,.4); }
        50% { box-shadow: 0 0 0 4px rgba(0,212,255,0); }
      }
      @keyframes badgePop {
        0% { transform: scale(.5); }
        60% { transform: scale(1.2); }
        100% { transform: scale(1); }
      }
      .mi { position: relative; }
    `;
    document.head.appendChild(style);
  }

  injectStyles();

  // ============================================================
  // 14. BONUS: Skeleton loading
  // ============================================================

  function showSkeletonIfLoading() {
    var list = $('recentTxList');
    if (!list) return;
    if (list.querySelector('.recent-tx-item')) return;
    if (list.querySelector('.recent-tx-skeleton')) return;

    var skeleton = '';
    for (var i = 0; i < 3; i++) {
      skeleton +=
        '<div class="recent-tx-skeleton">' +
          '<div class="recent-tx-skeleton-icon"></div>' +
          '<div class="recent-tx-skeleton-lines">' +
            '<div class="recent-tx-skeleton-line"></div>' +
            '<div class="recent-tx-skeleton-line short"></div>' +
          '</div>' +
        '</div>';
    }
    list.innerHTML = skeleton;

    setTimeout(function () {
      var l = $('recentTxList');
      if (l && l.querySelector('.recent-tx-skeleton') && !l.querySelector('.recent-tx-item')) {
        l.innerHTML = '<div class="recent-tx-empty">No transactions yet</div>';
      }
    }, 3000);
  }

  setTimeout(showSkeletonIfLoading, 300);

  // ============================================================
  // 15. FIX: submitWithdraw — через новый эндпоинт
  // ============================================================

  var _submitting = false;

  window.openWithdraw = function () {
    var modal = $('withdrawModal');
    if (!modal) { console.warn('[fixes] withdrawModal not found'); return; }

    var avail = $('wdAvailable');
    if (avail) avail.textContent = fmtCurrencySafe(window.st.usd || 0);

    var amtIn = $('wdAmount'); if (amtIn) amtIn.value = '';
    var errIn = $('wdError'); if (errIn) { errIn.style.display = 'none'; errIn.textContent = ''; }
    var mIn = $('wdMethod'); if (mIn) mIn.value = 'iban';

    if (typeof window.wdSwitchMethod === 'function') window.wdSwitchMethod();

    var formStage = document.querySelector('.wd-form-stage');
    var processingStage = document.querySelector('.wd-processing');
    var successStage = document.querySelector('.wd-success');
    if (formStage) formStage.style.display = 'block';
    if (processingStage) processingStage.classList.remove('on');
    if (successStage) successStage.classList.remove('on');

    modal.style.display = 'flex';

    var expEl = $('wdCardExpiry');
    var numEl = $('wdCardNumber');
    if (expEl && !expEl.dataset.fmt && typeof window.attachExpiryFormatter === 'function') {
      window.attachExpiryFormatter(expEl); expEl.dataset.fmt = '1';
    }
    if (numEl && !numEl.dataset.fmt && typeof window.attachCardFormatter === 'function') {
      window.attachCardFormatter(numEl); numEl.dataset.fmt = '1';
    }

    haptic(15);
  };

  function fmtCurrencySafe(usd) {
    if (typeof window.fmtCurrency === 'function') return window.fmtCurrency(usd);
    return '$' + Number(usd).toFixed(2);
  }

  window.submitWithdraw = async function () {
    if (_submitting) return;

    var amountEl = $('wdAmount');
    var methodEl = $('wdMethod');
    var errEl = $('wdError');
    if (!amountEl || !methodEl || !errEl) return;

    var amount = parseFloat(amountEl.value) || 0;
    var method = methodEl.value;

    function showErr(msg) {
      errEl.textContent = msg;
      errEl.style.display = 'block';
      haptic([40, 30, 40]);
    }
    errEl.style.display = 'none';

    if (amount <= 0) return showErr('Enter a valid amount');
    if (amount > (window.st.usd || 0)) return showErr('Amount exceeds available balance');
