/* ============================================================
   NORDIC CRYPTO — ADMIN MAINTENANCE BUTTONS v2.0
   ============================================================ */
(function () {
  'use strict';

  var AMB_VERSION = '2.0.0';

  function $(id) { return document.getElementById(id); }

  function waitForMaintenance(cb, tries) {
    tries = tries || 0;
    if (window.__ncMaintenance) { cb(); return; }
    if (tries > 50) { console.warn('[admin-maint] timeout'); return; }
    setTimeout(function () { waitForMaintenance(cb, tries + 1); }, 100);
  }

  waitForMaintenance(function () {
    var pushBtn = $('adminPushUpdate');

    if (pushBtn && !pushBtn._bound) {
      pushBtn._bound = true;
      pushBtn.onclick = async function () {
        var mins = prompt('Сколько минут показывать экран обновления? (1-120)', '5');
        if (mins === null) return;
        mins = parseInt(mins, 10);
        if (isNaN(mins) || mins < 1 || mins > 120) {
          alert('Введи число 1-120');
          return;
        }
        var msg = prompt(
          'Сообщение для клиентов:',
          'We are upgrading NordicCrypto with new features and security improvements.'
        );
        if (msg === null) return;

        await window.__ncMaintenance.activate({
          duration: mins * 60 * 1000,
          message: msg || undefined,
          version: '5.0.0',
          byAdmin: localStorage.getItem('user_email') || 'admin'
        });

        if (typeof window.toast === 'function') {
          window.toast('🚀 Update ON — clients blocked for ' + mins + ' min');
        } else {
          alert('✅ Update ON for ' + mins + ' min');
        }

        // Обновляем статус если есть элемент
        updateStatusLabel();

        setTimeout(function () {
          if (confirm('Показать превью — как видят клиенты?')) {
            window.__ncMaintenance.show();
          }
        }, 800);
      };
    }

    // Кнопка "End Update"
    var endBtn = $('adminEndUpdate');
    if (endBtn && !endBtn._bound) {
      endBtn._bound = true;
      endBtn.onclick = async function () {
        if (!confirm('Завершить обновление? Все клиенты смогут зайти.')) return;
        await window.__ncMaintenance.deactivate();
        if (typeof window.toast === 'function') {
          window.toast('✅ Update complete. Clients can sign in now.');
        } else {
          alert('✅ Update complete');
        }
        updateStatusLabel();
      };
    }

    // Живой статус (если есть элемент)
    function updateStatusLabel() {
      var el = $('adminMaintStatus');
      if (!el) return;
      var m = window.__ncMaintenance.get();
      if (m && m.until > Date.now()) {
        var minsLeft = Math.ceil((m.until - Date.now()) / 60000);
        el.textContent = 'ACTIVE · ' + minsLeft + ' min left';
        el.style.color = '#fbbf24';
      } else {
        el.textContent = 'Inactive';
        el.style.color = '#94a3b8';
      }
    }

    updateStatusLabel();
    setInterval(updateStatusLabel, 30000);

    console.log('%c[NordicCrypto] 🎛️ admin-maintenance-buttons.js v' + AMB_VERSION + ' loaded',
      'color:#f59e0b;font-weight:bold;font-size:13px');
  });
})();
