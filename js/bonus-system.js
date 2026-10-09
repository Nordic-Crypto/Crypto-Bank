/* ============================================================
   NORDIC CRYPTO — BONUS-SYSTEM.JS v2.1
   ============================================================
   Bonus types:
     welcome   — 10 NC on first sign-in
     minor     — 5 NC  for a minor issue
     medium    — 25 NC for a medium issue
     major     — 100 NC for a major issue
     critical  — 500 NC for a critical failure
     bug       — 50 NC for a user-submitted bug report
     loyalty   — 100 NC for 7-day streak
   Anti-abuse: max 3 auto/hour, max 500 NC/day.
   All client-facing strings in ENGLISH.
   ============================================================ */

(function () {
  'use strict';

  var TIERS = {
    welcome:  { amount: 10,  label: 'Welcome bonus' },
    minor:    { amount: 5,   label: 'Minor issue' },
    medium:   { amount: 25,  label: 'Medium issue' },
    major:    { amount: 100, label: 'Major issue' },
    critical: { amount: 500, label: 'Critical failure' },
    bug:      { amount: 50,  label: 'Bug report' },
    loyalty:  { amount: 100, label: '7-day loyalty' }
  };

  var HISTORY_KEY = 'nc_bonus_history';
  var DAILY_KEY   = 'nc_bonus_daily';
  var HOURLY_KEY  = 'nc_bonus_hourly';

  function read(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) || fallback; }
    catch (e) { return fallback; }
  }
  function write(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
  }

  function today()    { return new Date().toISOString().slice(0, 10); }
  function thisHour() { return new Date().toISOString().slice(0, 13); }

  function checkLimits() {
    var d = read(DAILY_KEY,  { date: today(),    sum: 0, count: 0 });
    var h = read(HOURLY_KEY, { hour: thisHour(), count: 0 });
    if (d.date !== today())    { d = { date: today(),    sum: 0, count: 0 }; }
    if (h.hour !== thisHour()) { h = { hour: thisHour(), count: 0 }; }
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

  function pushHistory(entry) {
    var hist = read(HISTORY_KEY, []);
    hist.unshift(entry);
    if (hist.length > 100) hist.length = 100;
    write(HISTORY_KEY, hist);
  }

  window.NC_BONUS = {

    tiers: TIERS,

    grant: function (userId, type, customAmount) {
      if (!userId) { console.warn('[Bonus] no userId'); return null; }

      var tier   = TIERS[type] || { amount: Number(customAmount) || 0, label: String(type) };
      var amount = customAmount != null ? customAmount : tier.amount;

      var limits = checkLimits();
      if (!limits.ok && type !== 'welcome') {
        console.warn('[Bonus] limit reached, skipping', type);
        return null;
      }

      var payload = {
        userId: userId,
        type:   type,
        label:  tier.label,
        amount: amount,
        ts:     Date.now(),
        day:    today()
      };

      console.log('%c[Bonus] +' + amount + ' NC — ' + tier.label,
        'color:#f59e0b;font-weight:bold', payload);

      if (window.NC && window.NC.api && typeof window.NC.api.post === 'function') {
        window.NC.api.post('/api/bonus/grant', payload).catch(function (e) {
          console.warn('[Bonus] backend failed', e);
        });
      }

      bumpLimits(amount);
      pushHistory(payload);

      document.dispatchEvent(new CustomEvent('nc:bonus:granted', { detail: payload }));

      if (typeof window.toast === 'function') {
        // Client-facing — English only
        window.toast('+' + amount + ' NC — ' + tier.label);
      }

      return payload;
    },

    detectTier: function (issue) {
      if (!issue) return 'minor';
      var s = String(issue).toLowerCase();
      if (/critical|panic|out of memory/.test(s))                return 'critical';
      if (/major|timeout|deadlock|stack overflow/.test(s))       return 'major';
      if (/medium|retry|failed|reject/.test(s))                  return 'medium';
      return 'minor';
    },

    reportBug: function () {
      if (!window.currentUser) {
        if (typeof window.toast === 'function')
          window.toast('Please sign in to submit a bug report.');
        return null;
      }
      return window.NC_BONUS.grant(window.currentUser.id, 'bug');
    },

    checkLoyalty: function () {
      if (!window.currentUser) return false;
      var key  = 'nc_loyalty_' + window.currentUser.id;
      var last = localStorage.getItem(key);
      var now  = Date.now();
      if (last && now - Number(last) < 7 * 24 * 3600 * 1000) return false;
      window.NC_BONUS.grant(window.currentUser.id, 'loyalty');
      localStorage.setItem(key, String(now));
      return true;
    },

    history: function () { return read(HISTORY_KEY, []); },
    limits:  function () { return checkLimits(); }
  };

  // ---------- Auto-detect runtime errors ----------
  var __nc_lastAutoBonus = 0;
  function autoBonus(message) {
    if (!window.currentUser || !window.currentUser.id) return;
    var now = Date.now();
    if (now - __nc_lastAutoBonus < 60 * 1000) return;
    __nc_lastAutoBonus = now;
    var tier = window.NC_BONUS.detectTier(message);
    window.NC_BONUS.grant(window.currentUser.id, tier);
  }

  window.addEventListener('error', function (e) {
    autoBonus(e.message || 'unknown error');
  });
  window.addEventListener('unhandledrejection', function (e) {
    autoBonus((e.reason && e.reason.message) || 'unhandled rejection');
  });

  // ---------- Loyalty on login ----------
  document.addEventListener('nc:auth:login', function () {
    setTimeout(function () { window.NC_BONUS.checkLoyalty(); }, 2000);
  });

  console.log('%c[NordicCrypto] 🎁 bonus-system.js v2.1 ready',
    'color:#f59e0b;font-weight:bold');

})();
