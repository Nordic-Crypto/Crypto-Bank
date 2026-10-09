/* ============================================================
   NORDIC CRYPTO — ADMIN-WITHDRAWALS-FIX v1.0
   ============================================================
   Переопределяет loadAdminWithdrawals и showAdminTab ПОВЕРХ
   app.legacy.js / legacy-part1 / legacy-part2.

   FIX:
   • Убирает мерцание "Loading..." при polling
   • Hash-проверка — не перерисовывает если данные не изменились
   • Promise.all вместо последовательных await (быстрее)
   • Silent refresh — не показывает Loading при обновлении
   ============================================================ */

(function () {
  'use strict';

  var AWF_VERSION = '1.0.0';

  function waitForLegacy(cb, tries) {
    tries = tries || 0;
    if (typeof window.getSessionToken === 'function' &&
        typeof window.WORKER_URL === 'string' &&
        typeof window.renderAdminWithdrawalCard === 'function') {
      cb();
      return;
    }
    if (tries > 50) {
      console.warn('[admin-withdrawals-fix] legacy not ready after 5s, proceeding');
      cb();
      return;
    }
    setTimeout(function () { waitForLegacy(cb, tries + 1); }, 100);
  }

  waitForLegacy(function () {

    var _lastHash = null;
    var _lastRendered = false;

    window.loadAdminWithdrawals = async function (opts) {
      opts = opts || {};
      var silent = opts.silent === true;

      var listEl  = document.getElementById('adminWithdrawalsList');
      var countEl = document.getElementById('adminWithdrawalsCount');
      if (!listEl) return;

      if (!_lastRendered && !silent) {
        listEl.innerHTML = '<div class="admin-empty">Loading...</div>';
        if (countEl) countEl.textContent = 'Loading...';
      }

      try {
        var token = window.getSessionToken();
        if (!token) {
          if (!silent) listEl.innerHTML = '<div class="admin-empty">No token</div>';
          return;
        }

        var res = await fetch(window.WORKER_URL + '?action=listUsers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: token })
        });
        var data = await res.json();
        if (!data.ok || !data.users) {
          if (!silent) listEl.innerHTML = '<div class="admin-empty">Failed to load</div>';
          return;
        }

        var statePromises = data.users.map(function (u) {
          return fetch(window.WORKER_URL + '?action=getUserState', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: token, email: u.email })
          })
          .then(function (r) { return r.json(); })
          .then(function (d) { return { user: u, state: d }; })
          .catch(function () { return { user: u, state: null }; });
        });
        var results = await Promise.all(statePromises);

        var allWd = [];
        results.forEach(function (r) {
          if (r.state && Array.isArray(r.state.withdrawals)) {
            r.state.withdrawals.forEach(function (w) {
              if (w) {
                w.userEmail = r.user.email;
                w.userName = r.user.name || r.user.email;
                allWd.push(w);
              }
            });
          }
        });
        allWd.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });

        var newHash = allWd.map(function (w) {
          return w.id + '|' + w.status + '|' + (w.reviewedAt || 0);
        }).join(',');
        var pending = allWd.filter(function (w) { return w.status === 'pending'; }).length;

        if (countEl) countEl.textContent = pending + ' pending • ' + allWd.length + ' total';

        if (newHash === _lastHash && _lastRendered) return;
        _lastHash = newHash;
        _lastRendered = true;

        if (!allWd.length) {
          listEl.innerHTML = '<div class="admin-empty"><div style="font-size:2.5rem;opacity:.4;margin-bottom:12px">📭</div><div>No withdrawal requests</div></div>';
          return;
        }

        var html = '';
        for (var k = 0; k < allWd.length; k++) {
          html += window.renderAdminWithdrawalCard(allWd[k]);
        }
        listEl.innerHTML = html;

      } catch (e) {
        if (!silent && !_lastRendered) {
          var esc = window.escapeHtml || function (s) { return String(s); };
          listEl.innerHTML = '<div class="admin-empty">Error: ' + esc(e.message) + '</div>';
        }
      }
    };

    window.showAdminTab = function (tab) {
      document.querySelectorAll('.admin-nav-item').forEach(function (el) {
        el.classList.toggle('active', el.getAttribute('data-tab') === tab);
      });
      document.querySelectorAll('.admin-section').forEach(function (el) {
        el.classList.toggle('active', el.getAttribute('data-section') === tab);
      });

      if (window._adminTabInterval) {
        clearInterval(window._adminTabInterval);
        window._adminTabInterval = null;
      }

      var _firstCall = true;

      function refreshCurrentTab() {
        if (document.querySelector('#adminBalanceMask.on, #adminMsgMask.on, #kycApproveModal, #kycDocsModal, #adminChatModal')) return;

        var isSilent = !_firstCall;

        if (tab === 'chats' && typeof window.loadAdminChats === 'function') window.loadAdminChats(isSilent);
        if (tab === 'withdrawals' && typeof window.loadAdminWithdrawals === 'function') window.loadAdminWithdrawals({ silent: isSilent });
        if (tab === 'deposits' && typeof window.loadAdminPendingDeposits === 'function') window.loadAdminPendingDeposits({ silent: isSilent });
        if (tab === 'clients' && typeof window.loadAdminUsers === 'function') window.loadAdminUsers({ silent: isSilent });
        if (tab === 'deleted' && typeof window.loadDeletedUsers === 'function') window.loadDeletedUsers(isSilent);
        if (tab === 'verifications' && typeof window.loadAdminVerifications === 'function') window.loadAdminVerifications();

        _firstCall = false;
      }

      refreshCurrentTab();
      window._adminTabInterval = setInterval(refreshCurrentTab, 8000);
      localStorage.setItem('adminTab', tab);
    };

    console.log('%c[NordicCrypto] 🛡️ admin-withdrawals-fix.js v' + AWF_VERSION + ' loaded',
      'color:#8b5cf6;font-weight:bold;font-size:13px');
  });

})();
