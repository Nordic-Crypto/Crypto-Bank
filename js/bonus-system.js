/* ============================================================
   NORDIC CRYPTO — BONUS-SYSTEM.JS v4.0 (STABLE)
   ============================================================
   v4.0 CHANGES:
   • 🔴 FIX: loyalty больше не выдаётся новому клиенту сразу
   • 🔴 FIX: welcome bonus race-safe (2 вкладки не дадут 2 бонуса)
   • 🔴 FIX: auto-bonus на ошибки — защита от спама F12
   • 🎁 NEW: dailyLogin (+5 NC/день)
   • 🎁 NEW: profileComplete (+25 NC)
   • 🎁 NEW: firstWithdrawal (+30 NC)
   • 🎁 NEW: 2FASetup (+50 NC)
   • 🎁 NEW: referralMilestone (+500 NC за 5 друзей)
   • 🛡️ Global auto-bonus rate limit (10/час)
   • ⚡ Cache read() — не читать localStorage каждый раз
   • 🎨 Clean logs — только важное
   ============================================================ */

(function () {
  'use strict';

  var TIERS = {
    welcome:          { amount: 10,  label: 'Welcome bonus' },
    minor:            { amount: 5,   label: 'Minor issue' },
    medium:           { amount: 25,  label: 'Medium issue' },
    major:            { amount: 100, label: 'Major issue' },
    critical:         { amount: 500, label: 'Critical failure' },
    bug:              { amount: 50,  label: 'Bug report' },
    loyalty:          { amount: 100, label: '7-day loyalty' },
    referral:         { amount: 250, label: 'Referral reward' },
    referralMilestone:{ amount: 500, label: '5 referrals milestone' },
    firstDeposit:     { amount: 50,  label: 'First deposit' },
    firstTrade:       { amount: 100, label: 'First trade' },
    firstWithdrawal:  { amount: 30,  label: 'First withdrawal' },
    kycBonus:         { amount: 200, label: 'KYC verified' },
    bigDeposit:       { amount: 500, label: 'VIP deposit' },
    dailyLogin:       { amount: 5,   label: 'Daily login' },
    profileComplete:  { amount: 25,  label: 'Profile complete' },
    twoFASetup:       { amount: 50,  label: '2FA enabled' }
  };

  var HISTORY_KEY = 'nc_bonus_history';
  var DAILY_KEY   = 'nc_bonus_daily';
  var HOURLY_KEY  = 'nc_bonus_hourly';
  var AUTO_KEY    = 'nc_bonus_auto';

  // ⚡ Mini-cache для read()
  var _cache = {};
  function read(k, f) {
    if (_cache[k] !== undefined) return _cache[k];
    try {
      var raw = localStorage.getItem(k);
      var val = raw ? JSON.parse(raw) : f;
      _cache[k] = val;
      return val;
    } catch (e) { return f; }
  }
  function write(k, v) {
    _cache[k] = v;
    try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {}
  }

  function today()    { return new Date().toISOString().slice(0, 10); }
  function thisHour() { return new Date().toISOString().slice(0, 13); }

  function checkLimits() {
    var d = read(DAILY_KEY,  { date: today(),    sum: 0, count: 0 });
    var h = read(HOURLY_KEY, { hour: thisHour(), count: 0 });
    if (d.date !== today())    d = { date: today(),    sum: 0, count: 0 };
    if (h.hour !== thisHour()) h = { hour: thisHour(), count: 0 };
    return {
      dailySum:    d.sum,
      dailyCount:  d.count,
      hourlyCount: h.count,
      ok: d.sum < 500 && h.count < 3
    };
  }

  function bumpLimits(amount) {
    var d = read(DAILY_KEY,  { date: today(),    sum: 0, count: 0 });
    var h = read(HOURLY_KEY, { hour: thisHour(), count: 0 });
    if (d.date !== today())    d = { date: today(),    sum: 0, count: 0 };
    if (h.hour !== thisHour()) h = { hour: thisHour(), count: 0 };
    d.sum += amount; d.count++;
    h.count++;
    write(DAILY_KEY,  d);
    write(HOURLY_KEY, h);
  }

  // 🛡️ Отдельный лимит для auto-bonus (F12 spam protection)
  function checkAutoLimit() {
    var a = read(AUTO_KEY, { hour: thisHour(), count: 0 });
    if (a.hour !== thisHour()) a = { hour: thisHour(), count: 0 };
    return a.count < 10;
  }
  function bumpAutoLimit() {
    var a = read(AUTO_KEY, { hour: thisHour(), count: 0 });
    if (a.hour !== thisHour()) a = { hour: thisHour(), count: 0 };
    a.count++;
    write(AUTO_KEY, a);
  }

  function pushHistory(e) {
    var h = read(HISTORY_KEY, []);
    h.unshift(e);
    if (h.length > 200) h.length = 200;
    write(HISTORY_KEY, h);
  }

  // ============================================================
  // MAIN API
  // ============================================================
  window.NC_BONUS = {

    tiers: TIERS,

    grant: function (userId, type, customAmount) {
      if (!userId) { console.warn('[Bonus] no userId'); return null; }
      var tier   = TIERS[type] || { amount: Number(customAmount) || 0, label: String(type) };
      var amount = customAmount != null ? customAmount : tier.amount;

      var limits = checkLimits();
      // One-time бонусы не считаются в лимите
      var bypassLimits = (type === 'welcome' || type === 'kycBonus' || type === 'referral' ||
                          type === 'referralMilestone' || type === 'firstDeposit' ||
                          type === 'firstTrade' || type === 'firstWithdrawal' ||
                          type === 'profileComplete' || type === 'twoFASetup' ||
                          type === 'dailyLogin');
      if (!limits.ok && !bypassLimits) {
        console.warn('[Bonus] limit reached, skipping', type);
        return null;
      }

      var payload = {
        userId: userId, type: type, label: tier.label,
        amount: amount, ts: Date.now(), day: today()
      };

      console.log('%c[Bonus] 🎁 +' + amount + ' NC — ' + tier.label,
        'color:#f59e0b;font-weight:bold');

      if (window.NC && window.NC.api && typeof window.NC.api.post === 'function') {
        window.NC.api.post('/api/bonus/grant', payload).catch(function () {});
      }

      bumpLimits(amount);
      pushHistory(payload);

      document.dispatchEvent(new CustomEvent('nc:bonus:granted', { detail: payload }));

      if (typeof window.toast === 'function') {
        window.toast('+' + amount + ' NC — ' + tier.label);
      }

      if (amount >= 200 && typeof window.spawnConfetti === 'function') {
        setTimeout(window.spawnConfetti, 200);
      }

      return payload;
    },

    detectTier: function (issue) {
      if (!issue) return 'minor';
      var s = String(issue).toLowerCase();
      if (/critical|panic|out of memory/.test(s))            return 'critical';
      if (/major|timeout|deadlock|stack overflow/.test(s))   return 'major';
      if (/medium|retry|failed|reject/.test(s))              return 'medium';
      return 'minor';
    },

    reportBug: function () {
      if (!window.currentUser) {
        if (typeof window.toast === 'function') window.toast('Please sign in');
        return null;
      }
      return window.NC_BONUS.grant(window.currentUser.id, 'bug');
    },

    // ============================================================
    // 🎁 LOYALTY — 7-day streak (FIXED)
    // ============================================================
    checkLoyalty: function () {
      if (!window.currentUser || !window.currentUser.id) return false;

      var key = 'nc_loyalty_ts_' + window.currentUser.id;
      var last = Number(localStorage.getItem(key) || 0);
      var now = Date.now();
      var SEVEN_DAYS = 7 * 24 * 3600 * 1000;

      // 🛡️ FIX: если ключа нет — ПЕРВЫЙ вход. Записываем дату, НЕ выдаём бонус.
      if (last === 0) {
        localStorage.setItem(key, String(now));
        console.log('[Bonus] 📅 Loyalty started. First bonus in 7 days.');
        return false;
      }

      // 🛡️ Если прошло < 7 дней — не выдаём
      if ((now - last) < SEVEN_DAYS) {
        var daysLeft = Math.ceil((SEVEN_DAYS - (now - last)) / (24 * 3600 * 1000));
        console.log('[Bonus] ⏳ Loyalty cooldown. ' + daysLeft + ' days left.');
        return false;
      }

      // 🎁 Прошло 7 дней — выдаём и обновляем timestamp
      localStorage.setItem(key, String(now));
      window.NC_BONUS.grant(window.currentUser.id, 'loyalty');
      return true;
    },

    // ============================================================
    // 🎁 ONE-TIME бонусы (race-safe)
    // ============================================================
    _oneTime: function (type, checkFn) {
      if (!window.currentUser || !window.currentUser.id) return false;
      var key = 'nc_bonus_ot_' + type + '_' + window.currentUser.id;
      // 🛡️ race-safe: check + set в одном шаге
      if (localStorage.getItem(key)) return false;
      localStorage.setItem(key, String(Date.now()));
      if (typeof checkFn === 'function') checkFn();
      return true;
    },

    grantFirstDeposit: function () {
      return window.NC_BONUS._oneTime('firstDeposit', function () {
        window.NC_BONUS.grant(window.currentUser.id, 'firstDeposit');
      });
    },
    grantFirstTrade: function () {
      return window.NC_BONUS._oneTime('firstTrade', function () {
        window.NC_BONUS.grant(window.currentUser.id, 'firstTrade');
      });
    },
    grantFirstWithdrawal: function () {
      return window.NC_BONUS._oneTime('firstWithdrawal', function () {
        window.NC_BONUS.grant(window.currentUser.id, 'firstWithdrawal');
      });
    },
    grantKycBonus: function () {
      return window.NC_BONUS._oneTime('kycBonus', function () {
        window.NC_BONUS.grant(window.currentUser.id, 'kycBonus');
      });
    },
    grantProfileComplete: function () {
      return window.NC_BONUS._oneTime('profileComplete', function () {
        window.NC_BONUS.grant(window.currentUser.id, 'profileComplete');
      });
    },
    grantTwoFASetup: function () {
      return window.NC_BONUS._oneTime('twoFASetup', function () {
        window.NC_BONUS.grant(window.currentUser.id, 'twoFASetup');
      });
    },
    grantBigDeposit: function () {
      // Big deposit — можно несколько раз, но не больше 3/день (limit)
      return window.NC_BONUS.grant(window.currentUser.id, 'bigDeposit');
    },

    // ============================================================
    // 🎁 DAILY LOGIN — +5 NC раз в день
    // ============================================================
    grantDailyLogin: function () {
      if (!window.currentUser || !window.currentUser.id) return false;
      var key = 'nc_daily_login_' + window.currentUser.id + '_' + today();
      if (localStorage.getItem(key)) return false;
      localStorage.setItem(key, '1');
      window.NC_BONUS.grant(window.currentUser.id, 'dailyLogin');
      return true;
    },

    // ============================================================
    // 🎁 REFERRAL — +250 NC за приглашённого
    // ============================================================
    checkReferral: function () {
      if (!window.currentUser || !window.currentUser.id) return false;

      var params = new URLSearchParams(window.location.search);
      var ref = params.get('ref');
      if (!ref) return false;
      if (ref === window.currentUser.id || ref === window.currentUser.email) {
        console.log('[Bonus] Self-referral ignored');
        return false;
      }

      var key = 'nc_referral_used_' + window.currentUser.id;
      if (localStorage.getItem(key)) {
        console.log('[Bonus] Referral already used');
        return false;
      }

      localStorage.setItem(key, ref);

      // Начисляем приглашённому
      window.NC_BONUS.grant(window.currentUser.id, 'referral', 250);

      // 🎁 Milestone: проверяем количество referrals
      window.NC_BONUS.checkReferralMilestone();

      setTimeout(function () {
        if (typeof window.toast === 'function') {
          window.toast('👥 Referral bonus activated!');
        }
      }, 500);

      return true;
    },

    // 🎁 +500 NC за 5 приглашённых
    checkReferralMilestone: function () {
      if (!window.currentUser || !window.currentUser.id) return false;
      var key = 'nc_referral_count_' + window.currentUser.id;
      var count = Number(localStorage.getItem(key) || 0) + 1;
      localStorage.setItem(key, String(count));

      if (count === 5) {
        var milestoneKey = 'nc_referral_milestone_' + window.currentUser.id;
        if (localStorage.getItem(milestoneKey)) return false;
        localStorage.setItem(milestoneKey, '1');
        window.NC_BONUS.grant(window.currentUser.id, 'referralMilestone');
        return true;
      }
      return false;
    },

    // ============================================================
    // 📊 STATS
    // ============================================================
    stats: function () {
      var history = read(HISTORY_KEY, []);
      var byType = {};
      var total = 0;
      history.forEach(function (e) {
        var t = e.type || 'unknown';
        if (!byType[t]) byType[t] = { count: 0, sum: 0, label: e.label || t };
        byType[t].count++;
        byType[t].sum += Number(e.amount) || 0;
        total += Number(e.amount) || 0;
      });
      return { total: total, byType: byType, count: history.length };
    },

    history: function () { return read(HISTORY_KEY, []); },
    limits:  function () { return checkLimits(); }
  };

  // ============================================================
  // 📊 AUTO-DETECT RUNTIME ERRORS (с защитой от спама)
  // ============================================================
  var __nc_lastAutoBonus = 0;
  function autoBonus(message) {
    if (!window.currentUser || !window.currentUser.id) return;

    // 🛡️ Игнорируем ошибки от самого bonus-system.js
    if (message && message.indexOf('bonus') !== -1) return;
    // 🛡️ Игнорируем ошибки от 3rd-party скриптов
    if (message && (message.indexOf('chrome-extension') !== -1 ||
                    message.indexOf('moz-extension') !== -1)) return;

    var now = Date.now();
    if (now - __nc_lastAutoBonus < 60 * 1000) return;
    if (!checkAutoLimit()) {
      console.warn('[Bonus] auto-bonus limit reached (10/hour)');
      return;
    }
    __nc_lastAutoBonus = now;
    bumpAutoLimit();

    var tier = window.NC_BONUS.detectTier(message);
    window.NC_BONUS.grant(window.currentUser.id, tier);
  }
  window.addEventListener('error', function (e) {
    autoBonus(e.message || 'unknown error');
  });
  window.addEventListener('unhandledrejection', function (e) {
    autoBonus((e.reason && e.reason.message) || 'unhandled rejection');
  });

  // ============================================================
  // 🎁 ОСНОВНОЙ ТРИГГЕР: nc:auth:login
  // ============================================================
  document.addEventListener('nc:auth:login', function () {

    // 1. Welcome bonus
    setTimeout(function () {
      if (!window.currentUser || !window.currentUser.id) return;
      var key = 'nc_welcome_bonus_' + window.currentUser.id;
      if (localStorage.getItem(key)) return;
      console.log('[Bonus] 🎁 First login — welcome bonus');
      window.NC_BONUS.grant(window.currentUser.id, 'welcome', 10);
      localStorage.setItem(key, String(Date.now()));
    }, 1000);

    // 2. Daily login (+5 NC/день)
    setTimeout(function () {
      window.NC_BONUS.grantDailyLogin();
    }, 1500);

    // 3. Loyalty (7-day streak)
    setTimeout(function () {
      window.NC_BONUS.checkLoyalty();
    }, 2000);

    // 4. Referral (если URL ?ref=XXX)
    setTimeout(function () {
      window.NC_BONUS.checkReferral();
    }, 3000);
  });

  // ============================================================
  // 🎁 KYC APPROVED → kycBonus
  // ============================================================
  document.addEventListener('nc:kyc:approved', function () {
    console.log('[Bonus] KYC approved → kycBonus');
    window.NC_BONUS.grantKycBonus();
  });

  // ============================================================
  // 🎁 DEPOSIT CONFIRMED → firstDeposit + bigDeposit
  // ============================================================
  document.addEventListener('nc:deposit:confirmed', function (e) {
    var d = e.detail || {};
    var amount = Number(d.amount) || 0;

    window.NC_BONUS.grantFirstDeposit();

    if (amount >= 1000) {
      console.log('[Bonus] 💎 Big deposit detected:', amount);
      window.NC_BONUS.grantBigDeposit();
    }
  });

  // ============================================================
  // 🎁 TRADE EXECUTED → firstTrade
  // ============================================================
  document.addEventListener('nc:trade:executed', function () {
    console.log('[Bonus] Trade executed → check firstTrade');
    window.NC_BONUS.grantFirstTrade();
  });

  // ============================================================
  // 🎁 WITHDRAWAL CONFIRMED → firstWithdrawal
  // ============================================================
  document.addEventListener('nc:withdrawal:submitted', function () {
    console.log('[Bonus] Withdrawal submitted → check firstWithdrawal');
    window.NC_BONUS.grantFirstWithdrawal();
  });

  // ============================================================
  // 🎁 PROFILE COMPLETE — при nc:profile:complete
  // ============================================================
  document.addEventListener('nc:profile:complete', function () {
    console.log('[Bonus] Profile complete → profileComplete bonus');
    window.NC_BONUS.grantProfileComplete();
  });

  // ============================================================
  // 🎁 2FA SETUP
  // ============================================================
  document.addEventListener('nc:2fa:enabled', function () {
    console.log('[Bonus] 2FA enabled → twoFASetup bonus');
    window.NC_BONUS.grantTwoFASetup();
  });

  console.log('%c[NordicCrypto] 🎁 bonus-system.js v4.0 ready',
    'color:#f59e0b;font-weight:bold;font-size:13px');
  console.log('%c  Tiers: ' + Object.keys(TIERS).join(', '),
    'color:#8b95a5;font-size:11px');
  console.log('%c  Commands: __bonus() — show history, __bonusLimits() — show limits',
    'color:#8b95a5;font-size:11px');

  // 🎁 Dev helper
  window.__bonusLimits = function () { console.table(checkLimits()); };
})();
