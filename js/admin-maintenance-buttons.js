/* ============================================================
   NORDIC CRYPTO — ADMIN MAINTENANCE BUTTONS v4.0
   ============================================================
   3 кнопки:
   • 🚀 Quick Update — 5-15 мин
   • 🌙 Maintenance — 1-6 часов
   • 🏖 Weekend Off — 1-7 дней (полное отключение)
   ============================================================ */
(function () {
  'use strict';

  var AMB_VERSION = '4.0.0';

  function $(id) { return document.getElementById(id); }

  function waitForMaintenance(cb, tries) {
    tries = tries || 0;
    if (window.__ncMaintenance) { cb(); return; }
    if (tries > 50) { console.warn('[admin-maint] timeout'); return; }
    setTimeout(function () { waitForMaintenance(cb, tries + 1); }, 100);
  }

  // Универсальная активация
  async function activateFor(minutes, presetMessage) {
    var msg = prompt('Сообщение для клиентов:', presetMessage || 'We are upgrading NordicCrypto with new features and security improvements.');
    if (msg === null) return false;

    await window.__ncMaintenance.activate({
      duration: minutes * 60 * 1000,
      message: msg || undefined,
      version: '5.0.0',
      byAdmin: localStorage.getItem('user_email') || 'admin'
    });

    var label = minutes < 60 ? (minutes + ' min')
              : minutes < 1440 ? (Math.round(minutes / 60) + ' h')
              : (Math.round(minutes / 1440) + ' day(s)');

    if (typeof window.toast === 'function') {
      window.toast('🚀 Update ON for ' + label);
    } else {
      alert('✅ Update ON for ' + label);
    }
    return true;
  }

  waitForMaintenance(function () {

    // ============================================================
    // 🚀 QUICK UPDATE — 5-15 минут
    // ============================================================
    var quickBtn = $('adminPushUpdate');
    if (quickBtn && !quickBtn._bound) {
      quickBtn._bound = true;
      quickBtn.onclick = async function () {
        var mins = prompt('Quick Update — сколько минут? (1-60)', '5');
        if (mins === null) return;
        mins = parseInt(mins, 10);
        if (isNaN(mins) || mins < 1 || mins > 60) {
          alert('Введи число 1-60');
          return;
        }
        await activateFor(mins);
      };
    }

    // ============================================================
    // 🌙 MAINTENANCE — 1-6 часов
    // ============================================================
    var maintBtn = $('adminMaintenance');
    if (maintBtn && !maintBtn._bound) {
      maintBtn._bound = true;
      maintBtn.onclick = async function () {
        var hours = prompt('Maintenance — сколько часов? (1-24)', '2');
        if (hours === null) return;
        hours = parseInt(hours, 10);
        if (isNaN(hours) || hours < 1 || hours > 24) {
          alert('Введи число 1-24');
          return;
        }
        await activateFor(hours * 60);
      };
    }

    // ============================================================
    // 🏖 WEEKEND OFF — 1-7 дней
    // ============================================================
    var weekendBtn = $('adminWeekendOff');
    if (weekendBtn && !weekendBtn._bound) {
      weekendBtn._bound = true;
      weekendBtn.onclick = async function () {
        var days = prompt(
          '🏖 Weekend Off — сколько дней отключить?\n\n' +
          '• 1 — сутки\n' +
          '• 2 — выходные (суббота-воскресенье)\n' +
          '• 3 — длинные выходные\n' +
          '• 7 — неделя',
          '2'
        );
        if (days === null) return;
        days = parseInt(days, 10);
        if (isNaN(days) || days < 1 || days > 7) {
          alert('Введи число 1-7');
          return;
        }

        var confirmed = confirm(
          '⚠️ ВНИМАНИЕ!\n\n' +
          'Все клиенты (' + days + ' дн.) будут видеть экран обновления.\n' +
          'Они НЕ смогут зайти, зарегаться, посмотреть баланс.\n\n' +
          'Админ (ты) — можешь заходить всегда.\n\n' +
          'Продолжить?'
        );
        if (!confirmed) return;

        await activateFor(days * 24 * 60, 'Scheduled maintenance. We will be back soon. Thank you for your patience.');
      };
    }

    // ============================================================
    // ⏹ END UPDATE — выключить всё
    // ============================================================
    var endBtn = $('adminEndUpdate');
    if (endBtn && !endBtn._bound) {
      endBtn._bound = true;
      endBtn.onclick = async function () {
        if (!confirm('Завершить обновление? Все клиенты СРАЗУ увидят сайт.')) return;
        await window.__ncMaintenance.deactivate();
        if (typeof window.toast === 'function') {
          window.toast('✅ Update complete. Clients can sign in now.');
        } else {
          alert('✅ Update complete');
        }
      };
    }

    // Живой статус
    function updateStatus() {
      var el = $('adminMaintStatus');
      if (!el) return;
      var m = window.__ncMaintenance.get();
      if (m && m.until > Date.now()) {
        var leftMs = m.until - Date.now();
        var leftMin = Math.round(leftMs / 60000);
        var label = leftMin < 60 ? (leftMin + ' min left')
                  : leftMin < 1440 ? (Math.round(leftMin / 60) + ' h left')
                  : (Math.round(leftMin / 1440) + ' d left');
        el.textContent = '🔴 ACTIVE · ' + label;
        el.style.color = '#ef4444';
        el.style.fontWeight = '800';
      } else {
        el.textContent = '🟢 Inactive';
        el.style.color = '#10b981';
      }
    }

    updateStatus();
    setInterval(updateStatus, 30000);

    console.log('%c[NordicCrypto] 🎛️ admin-maintenance-buttons.js v' + AMB_VERSION + ' loaded (3 кнопки)',
      'color:#f59e0b;font-weight:bold;font-size:13px');
  });
})();
