/* ============================================================
   NORDIC CRYPTO — ADMIN MAINTENANCE BUTTONS v1.0
   ============================================================ */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }

  function waitForMaintenance(cb, tries) {
    tries = tries || 0;
    if (window.__ncMaintenance) { cb(); return; }
    if (tries > 30) { console.warn('[admin-maint] maintenance-mode.js not loaded'); return; }
    setTimeout(function () { waitForMaintenance(cb, tries + 1); }, 200);
  }

  function refreshStatus() {
    var st = $('adminMaintStatus');
    if (!st) return;
    var m = window.__ncMaintenance && window.__ncMaintenance.get();
    if (m && m.until && Date.now() < m.until) {
      var until = new Date(m.until).toLocaleTimeString('en-GB');
      st.textContent = 'ACTIVE until ' + until;
      st.style.color = '#fbbf24';
    } else {
      st.textContent = 'Inactive';
      st.style.color = '#94a3b8';
    }
  }

  waitForMaintenance(function () {
    var startBtn = $('adminStartMaint');
    if (startBtn && !startBtn._bound) {
      startBtn._bound = true;
      startBtn.onclick = async function () {
        var mins = prompt('Сколько минут показывать экран обновления? (1-120)', '5');
        if (mins === null) return;
        mins = parseInt(mins, 10);
        if (isNaN(mins) || mins < 1 || mins > 120) { alert('Введи число 1-120'); return; }
        var msg = prompt('Сообщение для клиентов:',
          'We are upgrading NordicCrypto with new features and security improvements.');
        if (msg === null) return;

        await window.__ncMaintenance.activate({
          duration: mins * 60 * 1000,
          message: msg || undefined,
          version: '5.0.0',
          byAdmin: localStorage.getItem('user_email') || 'admin'
        });
        if (typeof window.toast === 'function') window.toast('🚀 Update pushed for ' + mins + ' min.');
        refreshStatus();
        setTimeout(function () {
          if (confirm('Показать как видят клиенты?')) window.__ncMaintenance.show();
        }, 1500);
      };
    }

    var endBtn = $('adminEndMaint');
    if (endBtn && !endBtn._bound) {
      endBtn._bound = true;
      endBtn.onclick = async function () {
        if (!confirm('Завершить обновление? Клиенты смогут зайти.')) return;
        await window.__ncMaintenance.deactivate();
        if (typeof window.toast === 'function') window.toast('✅ Update complete. Clients can log in.');
        refreshStatus();
      };
    }

    var origShowAdminTab = window.showAdminTab;
    if (typeof origShowAdminTab === 'function') {
      window.showAdminTab = function (tab) {
        var result = origShowAdminTab.apply(this, arguments);
        if (tab === 'system') setTimeout(refreshStatus, 100);
        return result;
      };
    }

    setInterval(refreshStatus, 30000);
    refreshStatus();

    console.log('%c[NordicCrypto] 🎛️ admin-maintenance-buttons.js loaded',
      'color:#f59e0b;font-weight:bold');
  });
})();
