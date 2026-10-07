/* ============================================================
   NORDIC CRYPTO — CORE.JS v1.0
   ============================================================
   Чистые утилиты без состояния.
   Все функции доступны глобально (window.*), чтобы
   app.legacy.js и app.js могли их использовать.
   ============================================================ */

(function () {
  'use strict';

  // ---------- DOM ----------
  window.$ = function (i) { return document.getElementById(i); };

  window.escapeHtml = function (s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  // ---------- Форматирование ----------
  window.fmt = function (n) {
    return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  window.eurF = function (n) {
    return '≈ €' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  window.now = function () {
    return new Date().toISOString().slice(0, 10);
  };

  // ---------- Session token ----------
  window.getSessionToken = function () { return localStorage.getItem('session_token'); };
  window.setSessionToken = function (t) { localStorage.setItem('session_token', t); };
  window.clearSessionToken = function () { localStorage.removeItem('session_token'); };

  // ---------- Время ----------
  window.timeAgo = function (ts) {
    var s = Math.floor((Date.now() - ts) / 1000);
    if (s < 30) return 'Just now';
    if (s < 60) return s + 's ago';
    if (s < 3600) return Math.floor(s / 60) + ' min ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    if (s < 604800) return Math.floor(s / 86400) + 'd ago';
    return new Date(ts).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
  };

  // ---------- Файлы ----------
  window.fileSizeStr = function (bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  };

  // ---------- Карта ----------
  window.genCardNumber = function (prefix) {
    var s = prefix;
    for (var i = 0; i < 12; i++) s += Math.floor(Math.random() * 10);
    return s;
  };

  window.fmtCard = function (num) {
    return String(num).replace(/(.{4})/g, '$1 ').trim();
  };

  window.genCvv = function () {
    var s = '';
    for (var i = 0; i < 3; i++) s += Math.floor(Math.random() * 10);
    return s;
  };

  window.genExpiry = function () {
    var d = new Date();
    var y = d.getFullYear() + 3;
    var m = d.getMonth() + 1;
    var mm = m < 10 ? '0' + m : '' + m;
    return mm + '/' + String(y).slice(2);
  };

  // ---------- Tracking ----------
  window.genTrackId = function () {
    var s = 'NC-' + new Date().getFullYear() + '-';
    var ch = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    for (var i = 0; i < 6; i++) s += ch[Math.floor(Math.random() * ch.length)];
    return s;
  };

  window.stepIndexFor = function (createdAt) {
    var STEPS_DAYS = [0, 3, 6, 14, 25, 30];
    var elapsedDays = (Date.now() - createdAt) / (24 * 60 * 60 * 1000);
    var idx = 0;
    for (var i = 0; i < STEPS_DAYS.length; i++) { if (elapsedDays >= STEPS_DAYS[i]) idx = i; }
    return idx;
  };

  // ---------- Inputs ----------
  window._val = function (id) {
    var el = document.getElementById(id);
    return el ? el.value : '';
  };

  // ---------- Clipboard ----------
  window.copyText = function (txt, okMsg) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(function () { window.toast && window.toast(okMsg); })
        .catch(function () { window.toast && window.toast(okMsg); });
    } else {
      window.toast && window.toast(okMsg);
    }
  };

  // ---------- Badge ----------
  window.badgeClass = function (s) {
    if (s === 'Completed') return 'badge ok';
    if (s === 'Under Review') return 'badge pend';
    if (s === 'Processing') return 'badge proc';
    if (s === 'Failed') return 'badge fail';
    return 'badge';
  };

  window.txStatusLabel = function (s) {
    if (s === 'Completed')    return { text: '✓ Completed',    bg: 'rgba(0,224,138,.14)',  color: '#00e08a' };
    if (s === 'Processing')   return { text: '⏳ Processing',   bg: 'rgba(0,212,255,.14)',  color: '#47dcff' };
    if (s === 'Under Review') return { text: '⏳ Under review', bg: 'rgba(255,176,32,.14)', color: '#ffb020' };
    if (s === 'Rejected')     return { text: '✗ Rejected',     bg: 'rgba(255,84,112,.14)', color: '#ff5470' };
    return { text: s || '—', bg: 'rgba(255,255,255,.06)', color: '#94a3b8' };
  };

  window.txdRow = function (label, value, mono) {
    return '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:10px 14px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:10px">' +
      '<span style="color:#94a3b8;font-size:.78rem;text-transform:uppercase;letter-spacing:.06em;flex-shrink:0">' + window.escapeHtml(label) + '</span>' +
      '<b style="' + (mono ? 'font-family:ui-monospace,monospace;' : '') + 'font-size:.85rem;text-align:right;word-break:break-all;max-width:65%">' + value + '</b>' +
      '</div>';
  };

  // ---------- Crypto/Transfer helpers ----------
  window.destHint = function (method) {
    if (method === 'Bank Transfer (SEPA)')  return { show: true, label: 'Recipient IBAN', ph: 'XX00 0000 0000 0000 0000 00' };
    if (method === 'Bank Transfer (SWIFT)') return { show: false };
    if (method === 'Credit Card')           return { show: false };
    if (method === 'Bitcoin (BTC)')         return { show: true, label: 'Recipient BTC Address', ph: 'bc1q...' };
    if (method === 'Ethereum (ETH)')        return { show: true, label: 'Recipient ETH Address', ph: '0x...' };
    return { show: false };
  };

  window.isCrypto = function (m) {
    return m === 'Bitcoin (BTC)' || m === 'Ethereum (ETH)';
  };

  // ---------- Onboarding preview ----------
  window.updateOnbPreview = function () {
    var typeEl = window.$('prevType');
    var nameEl = window.$('prevName');
    var curEl  = window.$('prevCur');
    if (typeEl) typeEl.textContent = 'VIRTUAL ' + (window.onbType || 'Visa').toUpperCase();
    if (nameEl) {
      var full = window.getFullName ? window.getFullName() : '';
      nameEl.textContent = (full || 'YOUR NAME').toUpperCase();
    }
    if (curEl) curEl.textContent = window.onbCur || 'USD';
  };

  console.log('%c[NordicCrypto] 📦 core.js v1.0 loaded (24 utils)',
    'color:#a78bfa;font-weight:bold');

})();
