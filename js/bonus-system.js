/* ============================================================
   NORDIC CRYPTO — BONUS SYSTEM (за косяки)
   ============================================================ */
(function () {
  'use strict';

  var BONUS_TIERS = [
    { code: 'MINOR',    label: 'Мелкий косяк',      amount: 5    },
    { code: 'MEDIUM',   label: 'Средний косяк',     amount: 25   },
    { code: 'MAJOR',    label: 'Крупный косяк',     amount: 100  },
    { code: 'CRITICAL', label: 'Критический сбой',  amount: 500  }
  ];

  function detectTier(issue) {
    if (!issue) return BONUS_TIERS[0];
    var s = String(issue).toLowerCase();
    if (s.indexOf('critical') !== -1 || s.indexOf('критич') !== -1) return BONUS_TIERS[3];
    if (s.indexOf('major')    !== -1 || s.indexOf('крупн')  !== -1) return BONUS_TIERS[2];
    if (s.indexOf('medium')   !== -1 || s.indexOf('средн')  !== -1) return BONUS_TIERS[1];
    return BONUS_TIERS[0];
  }

  window.NC_BONUS = {
    grant: function (userId, issue, customAmount) {
      var tier = detectTier(issue);
      var amount = customAmount || tier.amount;

      var payload = {
        userId: userId,
        issue: issue,
        tier: tier.code,
        amount: amount,
        ts: Date.now()
      };

      console.log('%c[Bonus] 🎁 Granted ' + amount + ' (' + tier.label + ')',
        'color:#f59e0b;font-weight:bold', payload);

      // Отправка на бэкенд
      if (window.NC && window.NC.api && typeof window.NC.api.post === 'function') {
        window.NC.api.post('/api/bonus/grant', payload).catch(function (e) {
          console.warn('[Bonus] backend grant failed', e);
        });
      }

      // Локальный fallback — чтобы UI сразу показал
      document.dispatchEvent(new CustomEvent('nc:bonus:granted', { detail: payload }));
      return payload;
    },

    tiers: BONUS_TIERS
  };

  // Авто-детект косяков из глобальных ошибок
  window.addEventListener('error', function (e) {
    if (!window.currentUser || !window.currentUser.id) return;
    window.NC_BONUS.grant(window.currentUser.id, e.message);
  });
})();
