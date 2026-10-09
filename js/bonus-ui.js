/* ============================================================
   NORDIC CRYPTO — BONUS-UI.JS v2.0
   ============================================================
   v2.0 CHANGES (2026-10-09):
   • 🛡️ Универсальная карточка для banking И exchange
   • 🎁 Tabs в модалке: History / Earn / Referral
   • 🎁 Referral link — копирование + кнопка Share
   • 🎁 Enable notifications кнопка прямо в модалке
   • 🛡️ Retry: 1.5s / 4s / 8s
   • 🛡️ Слушатели: account:typechange, dashboard:rendered, menu click
   • 📊 Tier breakdown — stats по типам в модалке
   • 🎨 Пульсация badge если клиент ни разу не открывал
   • 🎁 Smooth animations без мигания
   • 🛡️ Уникальные SVG ID (без коллизий)
   • 🛡️ Cleanup при logout
   • 📈 Кэш getTotalNC (500ms) для performance
   ============================================================ */

(function () {
  'use strict';

  var BUI_VERSION = '2.0.0';

  // ============================================================
  // 🎯 CACHE
  // ============================================================
  var _totalNCCache = null;
  var _totalNCTs = 0;
  var _CACHE_TTL = 500;

  function getTotalNC(force) {
    var now = Date.now();
    if (!force && _totalNCCache !== null && (now - _totalNCTs) < _CACHE_TTL) {
      return _totalNCCache;
    }
    if (typeof window.NC_BONUS !== 'object') return 0;
    var history = window.NC_BONUS.history() || [];
    var total = history.reduce(function (sum, e) {
      return sum + (Number(e.amount) || 0);
    }, 0);
    _totalNCCache = total;
    _totalNCTs = now;
    return total;
  }

  function invalidateNCCache() {
    _totalNCCache = null;
    _totalNCTs = 0;
  }

  // ============================================================
  // 🎯 SVG (с уникальными ID)
  // ============================================================
  var _svgIdCounter = 0;
  function uid(prefix) {
    _svgIdCounter++;
    return prefix + '_' + _svgIdCounter + '_' + Math.random().toString(36).slice(2, 7);
  }

  function getCoinSVG(size) {
    size = size || 20;
    var gradId = uid('ncCoinGrad');
    return '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '" style="display:block">' +
      '<defs>' +
        '<radialGradient id="' + gradId + '" cx="30%" cy="30%">' +
          '<stop offset="0%" stop-color="#ffe17a"/>' +
          '<stop offset="55%" stop-color="#f59e0b"/>' +
          '<stop offset="100%" stop-color="#b45309"/>' +
        '</radialGradient>' +
      '</defs>' +
      '<circle cx="12" cy="12" r="11" fill="url(#' + gradId + ')" stroke="rgba(255,255,255,.3)" stroke-width="1"/>' +
      '<circle cx="12" cy="12" r="9" fill="none" stroke="rgba(255,255,255,.25)" stroke-width="0.5" stroke-dasharray="1.5 2"/>' +
      '<text x="12" y="16.5" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-size="12" font-weight="900" fill="#fff">N</text>' +
    '</svg>';
  }

  function getLevelSVG(levelName, size) {
    size = size || 14;
    var colors = {
      'Bronze':   { bg: '#cd7f32', shadow: '#8b5a2b', letter: 'B' },
      'Silver':   { bg: '#c0c0c0', shadow: '#808080', letter: 'S' },
      'Gold':     { bg: '#ffd700', shadow: '#b8860b', letter: 'G' },
      'Platinum': { bg: '#e5e4e2', shadow: '#a8a8a8', letter: 'P' }
    };
    var c = colors[levelName] || colors['Bronze'];
    var gradId = uid('ncLvl_' + c.letter);
    return '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '" style="display:inline-block;vertical-align:middle">' +
      '<defs>' +
        '<radialGradient id="' + gradId + '" cx="30%" cy="30%">' +
          '<stop offset="0%" stop-color="' + c.bg + '" stop-opacity="1"/>' +
          '<stop offset="100%" stop-color="' + c.shadow + '" stop-opacity="1"/>' +
        '</radialGradient>' +
      '</defs>' +
      '<circle cx="12" cy="12" r="11" fill="url(#' + gradId + ')" stroke="rgba(255,255,255,.4)" stroke-width="1"/>' +
      '<text x="12" y="17" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-size="12" font-weight="900" fill="#fff" opacity=".95">' + c.letter + '</text>' +
    '</svg>';
  }

  // ============================================================
  // 🎯 LEVELS
  // ============================================================
  var LEVELS = [
    { name: 'Bronze',   min: 0,    max: 500,      color: '#cd7f32', next: 500 },
    { name: 'Silver',   min: 500,  max: 2000,     color: '#c0c0c0', next: 2000 },
    { name: 'Gold',     min: 2000, max: 5000,     color: '#ffd700', next: 5000 },
    { name: 'Platinum', min: 5000, max: Infinity, color: '#e5e4e2', next: Infinity }
  ];

  function getLevel(totalNC) {
    for (var i = 0; i < LEVELS.length; i++) {
      if (totalNC >= LEVELS[i].min && totalNC < LEVELS[i].max) return LEVELS[i];
    }
    return LEVELS[LEVELS.length - 1];
  }

  // ============================================================
  // 🎯 EMOJI для notifications (не SVG)
  // ============================================================
  function getBonusEmoji(type) {
    var e = {
      welcome: '🎁', minor: '🐛', medium: '⚡', major: '💥',
      critical: '🚨', bug: '🐞', loyalty: '🔥', referral: '👥',
      firstDeposit: '💰', firstTrade: '📈', kycBonus: '🪪', bigDeposit: '💎'
    };
    return e[type] || '🎁';
  }

  // ============================================================
  // 🎯 SVG icons для модалки
  // ============================================================
  function getBonusIcon(type) {
    var map = {
      welcome:      getIcon('gift',    '#ec4899'),
      minor:        getIcon('bug',     '#94a3b8'),
      medium:       getIcon('zap',     '#f59e0b'),
      major:        getIcon('flame',   '#ef4444'),
      critical:     getIcon('alert',   '#dc2626'),
      bug:          getIcon('bug',     '#22c55e'),
      loyalty:      getIcon('flame',   '#f97316'),
      referral:     getIcon('users',   '#8b5cf6'),
      firstDeposit: getIcon('dollar',  '#10b981'),
      firstTrade:   getIcon('chart',   '#06b6d4'),
      kycBonus:     getIcon('id',      '#3b82f6'),
      bigDeposit:   getIcon('diamond', '#a78bfa')
    };
    return map[type] || map.welcome;
  }

  function getIcon(name, color) {
    var paths = {
      gift:   'M20 12v10H4V12M2 7h20v5H2zM12 22V7M12 7H7.5a2.5 2.5 0 010-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 000-5C13 2 12 7 12 7z',
      bug:    'M8 2v4M16 2v4M9 5h6a3 3 0 013 3v6a5 5 0 01-5 5h-2a5 5 0 01-5-5V8a3 3 0 013-3zM4 11h2M18 11h2M4 16h2M18 16h2',
      zap:    'M13 2L3 14h9l-1 8 10-12h-9l1-8z',
      flame:  'M12 2s4 5 4 9a4 4 0 11-8 0c0-4 4-9 4-9zM12 14a2 2 0 100 4 2 2 0 000-4z',
      alert:  'M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0zM12 9v4M12 17h.01',
      users:  'M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75',
      dollar: 'M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6',
      chart:  'M3 17l6-6 4 4 8-8M17 7h4v4',
      id:     'M20 4H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V6a2 2 0 00-2-2zM9 9a2 2 0 100 4 2 2 0 000-4zM15 13H9M15 17H9M15 9h4M15 13h4',
      diamond:'M12 2l4 6-4 14-4-14 4-6zM2 8h20M6 8l6 14M18 8l-6 14',
      link:   'M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71',
      bell:   'M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0',
      check:  'M20 6L9 17l-5-5'
    };
    return '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="' + color + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block">' +
      '<path d="' + (paths[name] || paths.gift) + '"/>' +
    '</svg>';
  }

  // ============================================================
  // 🎯 CSS
  // ============================================================
  function injectCSS() {
    if (document.getElementById('ncBonusStyles')) return;
    var style = document.createElement('style');
    style.id = 'ncBonusStyles';
    style.textContent = `
      /* ===== NC BADGE ===== */
      .nc-badge {
        display: flex; align-items: center; gap: 8px;
        padding: 7px 14px;
        background: linear-gradient(135deg, rgba(245,158,11,.15), rgba(236,72,153,.12));
        border: 1px solid rgba(245,158,11,.4);
        border-radius: 999px;
        color: #f59e0b; font-weight: 800; font-size: .82rem;
        cursor: pointer; position: relative; user-select: none;
        transition: all .25s cubic-bezier(.34,1.56,.64,1);
      }
      .nc-badge:hover {
        transform: translateY(-2px) scale(1.03);
        box-shadow: 0 10px 24px -8px rgba(245,158,11,.6);
      }
      .nc-badge-icon {
        display: inline-flex; align-items: center; justify-content: center;
        animation: ncCoinSpin 3s linear infinite;
        transform-style: preserve-3d;
      }
      @keyframes ncCoinSpin {
        0%   { transform: rotateY(0deg); }
        50%  { transform: rotateY(180deg); }
        100% { transform: rotateY(360deg); }
      }
      @keyframes ncBadgeAttention {
        0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(245,158,11,.6); }
        50% { transform: scale(1.08); box-shadow: 0 0 0 12px rgba(245,158,11,0); }
      }
      @keyframes ncBadgePulse {
        0%, 100% { transform: scale(1); }
        50% { transform: scale(1.15); }
      }
      .nc-badge-amount {
        font-family: ui-monospace, monospace; color: #fff; font-size: .88rem;
      }
      .nc-badge-level {
        display: inline-flex; align-items: center; gap: 4px;
        font-size: .68rem; opacity: .95; padding: 3px 8px;
        background: rgba(255,255,255,.08); border-radius: 6px; font-weight: 800;
      }
      .nc-badge-level svg { vertical-align: middle; }

      /* ===== REWARDS CARD ===== */
      .nc-rewards-card {
        background:
          radial-gradient(500px 250px at 100% 0%, rgba(245,158,11,.15), transparent 60%),
          linear-gradient(145deg, rgba(16,23,36,.96), rgba(9,14,23,.96));
        border: 1px solid rgba(245,158,11,.25);
        border-radius: 20px; padding: 24px;
        box-shadow: 0 20px 50px -20px rgba(245,158,11,.4);
        position: relative; overflow: hidden; margin-top: 24px;
      }
      .nc-rewards-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; }
      .nc-rewards-kicker {
        font-size: .68rem; color: #f59e0b; text-transform: uppercase;
        letter-spacing: 1.5px; font-weight: 800; margin-bottom: 6px;
      }
      .nc-rewards-title { font-size: 1.4rem; font-weight: 800; color: #fff; margin: 0; }
      .nc-rewards-icon {
        width: 56px; height: 56px; border-radius: 16px;
        background: linear-gradient(135deg, #f59e0b, #ec4899);
        display: flex; align-items: center; justify-content: center;
        box-shadow: 0 12px 30px -10px rgba(245,158,11,.6);
        animation: ncRewardsPulse 3s ease-in-out infinite;
      }
      @keyframes ncRewardsPulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.08); } }
      .nc-rewards-balance { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; flex-wrap: wrap; }
      .nc-rewards-count {
        font-size: 2.5rem; font-weight: 800;
        font-family: ui-monospace, monospace;
        background: linear-gradient(110deg, #fff, #f59e0b 60%, #ec4899);
        -webkit-background-clip: text; background-clip: text;
        color: transparent; letter-spacing: -0.03em;
      }
      .nc-rewards-unit { font-size: 1rem; color: #8b95a5; font-weight: 700; }
      .nc-rewards-level {
        display: inline-flex; align-items: center; gap: 6px;
        padding: 6px 12px; background: rgba(255,255,255,.05);
        border: 1px solid currentColor; border-radius: 999px;
        font-size: .78rem; font-weight: 800;
      }
      .nc-rewards-level svg { vertical-align: middle; }
      .nc-rewards-progress { margin-top: 16px; }
      .nc-rewards-progress-label {
        display: flex; justify-content: space-between;
        font-size: .72rem; color: #8b95a5; margin-bottom: 8px;
      }
      .nc-rewards-progress-bar {
        height: 8px; background: rgba(255,255,255,.06);
        border-radius: 4px; overflow: hidden;
      }
      .nc-rewards-progress-fill {
        height: 100%; background: linear-gradient(90deg, #f59e0b, #ec4899);
        border-radius: 4px; transition: width .8s cubic-bezier(.34,1.56,.64,1);
        box-shadow: 0 0 16px rgba(245,158,11,.6);
      }
      .nc-rewards-actions { display: flex; gap: 10px; margin-top: 20px; flex-wrap: wrap; }
      .nc-rewards-btn {
        flex: 1; min-width: 130px; padding: 12px 18px; border: none; border-radius: 12px;
        font-weight: 800; font-size: .85rem; cursor: pointer; font-family: inherit;
        transition: all .25s cubic-bezier(.34,1.56,.64,1);
        display: inline-flex; align-items: center; justify-content: center; gap: 6px;
      }
      .nc-rewards-btn svg { width: 16px; height: 16px; }
      .nc-rewards-btn-primary {
        background: linear-gradient(135deg, #f59e0b, #ec4899); color: #fff;
        box-shadow: 0 10px 24px -8px rgba(245,158,11,.6);
      }
      .nc-rewards-btn-primary:hover { transform: translateY(-2px); box-shadow: 0 14px 30px -8px rgba(245,158,11,.8); }
      .nc-rewards-btn-ghost {
        background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.1); color: #b6c1d1;
      }
      .nc-rewards-btn-ghost:hover { background: rgba(245,158,11,.08); border-color: rgba(245,158,11,.4); color: #f59e0b; }

      /* ===== BONUS MODAL ===== */
      .nc-bonus-modal {
        position: fixed; inset: 0; background: rgba(3,6,11,.9);
        backdrop-filter: blur(20px); display: flex; align-items: center;
        justify-content: center; z-index: 99999; padding: 20px;
        opacity: 0; transition: opacity .3s ease;
      }
      .nc-bonus-modal.nc-on { opacity: 1; }
      .nc-bonus-card {
        width: 100%; max-width: 560px; max-height: 90vh;
        background: linear-gradient(165deg, #0f1720 0%, #0a0e15 100%);
        border: 1px solid rgba(245,158,11,.3); border-radius: 24px;
        padding: 32px 28px 24px; color: #e7edf5;
        position: relative; overflow: hidden;
        box-shadow: 0 40px 100px -20px rgba(0,0,0,.9), 0 0 80px -20px rgba(245,158,11,.3);
        transform: translateY(20px) scale(.96);
        transition: transform .4s cubic-bezier(.34,1.56,.64,1);
        display: flex; flex-direction: column;
      }
      .nc-bonus-modal.nc-on .nc-bonus-card { transform: translateY(0) scale(1); }
      .nc-bonus-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; }
      .nc-bonus-title {
        font-size: 1.5rem; font-weight: 800;
        background: linear-gradient(100deg, #fff, #f59e0b);
        -webkit-background-clip: text; background-clip: text;
        color: transparent; margin: 0 0 4px;
      }
      .nc-bonus-sub { font-size: .82rem; color: #8b95a5; }
      .nc-bonus-close {
        width: 36px; height: 36px; border-radius: 10px;
        background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.08);
        color: #8b95a5; font-size: 20px; cursor: pointer;
        font-family: inherit; transition: all .2s;
      }
      .nc-bonus-close:hover { background: rgba(255,84,112,.15); border-color: rgba(255,84,112,.4); color: #ff5470; }

      /* Tabs */
      .nc-bonus-tabs {
        display: flex; gap: 4px; margin-bottom: 20px;
        background: rgba(255,255,255,.03); padding: 4px; border-radius: 12px;
        border: 1px solid rgba(255,255,255,.06);
      }
      .nc-bonus-tab {
        flex: 1; padding: 10px 12px; border-radius: 8px; border: none;
        background: transparent; color: #8b95a5; font-size: .82rem;
        font-weight: 800; cursor: pointer; font-family: inherit;
        transition: all .2s;
      }
      .nc-bonus-tab:hover { color: #e7edf5; }
      .nc-bonus-tab.nc-on {
        background: linear-gradient(135deg, rgba(245,158,11,.2), rgba(236,72,153,.15));
        color: #f59e0b;
      }
      .nc-bonus-tab-content { display: none; flex: 1; flex-direction: column; overflow: hidden; }
      .nc-bonus-tab-content.nc-on { display: flex; }

      /* Stats */
      .nc-bonus-stats {
        display: grid; grid-template-columns: 1fr 1fr 1fr;
        gap: 10px; margin-bottom: 20px;
      }
      .nc-bonus-stat {
        padding: 14px; background: rgba(245,158,11,.06);
        border: 1px solid rgba(245,158,11,.15); border-radius: 12px; text-align: center;
      }
      .nc-bonus-stat-label {
        font-size: .68rem; color: #8b95a5; text-transform: uppercase;
        letter-spacing: 1px; margin-bottom: 4px; font-weight: 700;
      }
      .nc-bonus-stat-value {
        font-size: 1.15rem; font-weight: 800; color: #f59e0b;
        font-family: ui-monospace, monospace;
      }
      .nc-bonus-stat-value svg { vertical-align: middle; }

      /* List */
      .nc-bonus-list {
        flex: 1; overflow-y: auto; display: flex; flex-direction: column;
        gap: 8px; margin-bottom: 16px; padding-right: 4px;
        max-height: 400px;
      }
      .nc-bonus-list::-webkit-scrollbar { width: 6px; }
      .nc-bonus-list::-webkit-scrollbar-thumb { background: rgba(245,158,11,.3); border-radius: 3px; }
      .nc-bonus-item {
        display: flex; align-items: center; gap: 14px;
        padding: 14px 16px; background: rgba(255,255,255,.03);
        border: 1px solid rgba(255,255,255,.06); border-radius: 12px;
        transition: all .2s;
      }
      .nc-bonus-item:hover {
        background: rgba(245,158,11,.06); border-color: rgba(245,158,11,.25);
        transform: translateX(4px);
      }
      .nc-bonus-item-icon {
        width: 42px; height: 42px; border-radius: 12px;
        display: flex; align-items: center; justify-content: center;
        flex-shrink: 0;
        background: linear-gradient(135deg, rgba(245,158,11,.15), rgba(236,72,153,.15));
        border: 1px solid rgba(245,158,11,.25);
      }
      .nc-bonus-item-body { flex: 1; min-width: 0; }
      .nc-bonus-item-label { font-weight: 700; font-size: .9rem; color: #fff; margin-bottom: 3px; }
      .nc-bonus-item-time { font-size: .72rem; color: #7c9cbb; }
      .nc-bonus-item-amount {
        font-family: ui-monospace, monospace; font-size: 1rem;
        font-weight: 800; color: #10b981;
        text-shadow: 0 0 20px rgba(16,185,129,.4); flex-shrink: 0;
      }
      .nc-bonus-empty { text-align: center; padding: 60px 20px; color: #7c9cbb; }
      .nc-bonus-empty-icon { font-size: 3rem; margin-bottom: 12px; opacity: .5; }

      /* ===== EARN TAB — Tasks list ===== */
      .nc-earn-list { display: flex; flex-direction: column; gap: 10px; overflow-y: auto; max-height: 400px; padding-right: 4px; }
      .nc-earn-list::-webkit-scrollbar { width: 6px; }
      .nc-earn-list::-webkit-scrollbar-thumb { background: rgba(245,158,11,.3); border-radius: 3px; }
      .nc-earn-item {
        display: flex; align-items: center; gap: 14px;
        padding: 14px 16px; background: rgba(255,255,255,.03);
        border: 1px solid rgba(255,255,255,.06); border-radius: 12px;
        transition: all .2s;
      }
      .nc-earn-item:hover {
        background: rgba(245,158,11,.06); border-color: rgba(245,158,11,.25);
      }
      .nc-earn-item-icon {
        width: 42px; height: 42px; border-radius: 12px;
        display: flex; align-items: center; justify-content: center;
        flex-shrink: 0;
        background: linear-gradient(135deg, rgba(245,158,11,.15), rgba(236,72,153,.15));
        border: 1px solid rgba(245,158,11,.25);
      }
      .nc-earn-item-body { flex: 1; min-width: 0; }
      .nc-earn-item-label { font-weight: 700; font-size: .9rem; color: #fff; margin-bottom: 3px; }
      .nc-earn-item-desc { font-size: .72rem; color: #7c9cbb; }
      .nc-earn-item-bonus {
        font-family: ui-monospace, monospace; font-size: .95rem;
        font-weight: 800; color: #10b981; flex-shrink: 0;
      }
      .nc-earn-item-done {
        font-size: .72rem; color: #10b981; font-weight: 800;
        padding: 4px 8px; background: rgba(16,185,129,.12);
        border-radius: 6px; flex-shrink: 0;
      }

      /* ===== REFERRAL TAB ===== */
      .nc-referral-content { padding: 8px 0; overflow-y: auto; max-height: 400px; }
      .nc-referral-big-icon {
        width: 72px; height: 72px; margin: 0 auto 16px;
        border-radius: 20px;
        background: linear-gradient(135deg, #8b5cf6, #ec4899);
        display: flex; align-items: center; justify-content: center;
        box-shadow: 0 20px 40px -10px rgba(139,92,246,.6);
        animation: ncRewardsPulse 3s ease-in-out infinite;
      }
      .nc-referral-title {
        font-size: 1.2rem; font-weight: 800; color: #fff;
        text-align: center; margin-bottom: 8px;
      }
      .nc-referral-desc {
        font-size: .85rem; color: #8b95a5; text-align: center;
        margin-bottom: 20px; line-height: 1.5;
      }
      .nc-referral-bonus-big {
        text-align: center; font-size: 1.6rem; font-weight: 800;
        color: #f59e0b; margin-bottom: 20px;
        font-family: ui-monospace, monospace;
      }
      .nc-referral-link-box {
        display: flex; gap: 8px; margin-bottom: 16px;
        padding: 12px 14px; background: rgba(0,0,0,.3);
        border: 1px solid rgba(245,158,11,.2); border-radius: 12px;
        align-items: center;
      }
      .nc-referral-link-input {
        flex: 1; background: transparent; border: none; outline: none;
        color: #f59e0b; font-family: ui-monospace, monospace;
        font-size: .82rem; font-weight: 700;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .nc-referral-copy-btn {
        padding: 8px 14px; border-radius: 8px; border: none;
        background: linear-gradient(135deg, #f59e0b, #ec4899);
        color: #fff; font-weight: 800; font-size: .78rem;
        cursor: pointer; font-family: inherit;
        transition: all .2s;
        flex-shrink: 0;
      }
      .nc-referral-copy-btn:hover { transform: translateY(-1px); box-shadow: 0 8px 20px -6px rgba(245,158,11,.7); }
      .nc-referral-share-btn {
        width: 100%; padding: 12px; border-radius: 12px; border: none;
        background: rgba(139,92,246,.15); border: 1px solid rgba(139,92,246,.3);
        color: #c4b5fd; font-weight: 800; font-size: .85rem;
        cursor: pointer; font-family: inherit;
        display: flex; align-items: center; justify-content: center; gap: 8px;
        transition: all .2s;
        margin-bottom: 16px;
      }
      .nc-referral-share-btn:hover { background: rgba(139,92,246,.25); }
      .nc-referral-stats {
        display: grid; grid-template-columns: 1fr 1fr; gap: 10px;
      }
      .nc-referral-stat {
        padding: 14px; background: rgba(139,92,246,.06);
        border: 1px solid rgba(139,92,246,.15); border-radius: 12px;
        text-align: center;
      }
      .nc-referral-stat-label {
        font-size: .68rem; color: #8b95a5; text-transform: uppercase;
        letter-spacing: 1px; margin-bottom: 4px; font-weight: 700;
      }
      .nc-referral-stat-value {
        font-size: 1.15rem; font-weight: 800; color: #c4b5fd;
        font-family: ui-monospace, monospace;
      }

      @media (max-width: 540px) {
        .nc-bonus-card { padding: 24px 20px 20px; }
        .nc-bonus-stats { grid-template-columns: 1fr; }
        .nc-bonus-list, .nc-earn-list, .nc-referral-content { max-height: 50vh; }
        .nc-rewards-actions { flex-direction: column; }
        .nc-rewards-btn { width: 100%; }
      }
    `;
    document.head.appendChild(style);
  }

  // ============================================================
  // 🎯 NC BADGE
  // ============================================================
  function injectBadge() {
    if (document.getElementById('ncBadge')) return;

    var topBar = document.querySelector('.top > div:last-child');
    if (!topBar) return;

    var total = getTotalNC();
    var level = getLevel(total);

    var badge = document.createElement('div');
    badge.id = 'ncBadge';
    badge.className = 'nc-badge';
    badge.title = 'View your rewards and bonus history';
    badge.innerHTML =
      '<span class="nc-badge-icon">' + getCoinSVG(20) + '</span>' +
      '<span class="nc-badge-amount">' + total + ' NC</span>' +
      '<span class="nc-badge-level" style="color:' + level.color + '">' +
        getLevelSVG(level.name, 14) + ' ' + level.name +
      '</span>';

    var notifBell = document.getElementById('notifBell');
    if (notifBell && notifBell.parentNode) {
      notifBell.parentNode.insertBefore(badge, notifBell);
    } else {
      topBar.insertBefore(badge, topBar.firstChild);
    }

    badge.onclick = openBonusModal;

    // 🎨 Пульсация если клиент ни разу не открывал
    setTimeout(function () {
      var opened = localStorage.getItem('nc_bonus_opened_' + (window.currentUser && window.currentUser.id));
      if (!opened) {
        badge.style.animation = 'ncBadgeAttention 2s ease-in-out infinite';
      }
    }, 500);
  }

  function updateBadge() {
    var badge = document.getElementById('ncBadge');
    if (!badge) return;
    var total = getTotalNC(true);
    var level = getLevel(total);
    var amtEl  = badge.querySelector('.nc-badge-amount');
    var lvlEl  = badge.querySelector('.nc-badge-level');
    var iconEl = badge.querySelector('.nc-badge-icon');

    if (iconEl) iconEl.innerHTML = getCoinSVG(20);
    if (amtEl) amtEl.textContent = total + ' NC';
    if (lvlEl) {
      lvlEl.style.color = level.color;
      lvlEl.innerHTML = getLevelSVG(level.name, 14) + ' ' + level.name;
    }
  }

  // ============================================================
  // 🎯 REWARDS CARD — универсальная для banking + exchange
  // ============================================================
  function injectRewardsCard() {
    // 🛡️ Уже есть
    if (document.getElementById('ncRewardsCard')) return;

    // 🛡️ ОПРЕДЕЛЯЕМ АКТИВНЫЙ DASHBOARD
    var dash   = document.getElementById('dash');
    var exDash = document.getElementById('exchangeDash');
    var accountType = (window.st && window.st.user && window.st.user.accountType) || null;
    var isExchange = accountType === 'exchange';

    var targetDash = null;
    var targetSelector = '';

    if (isExchange && exDash) {
      targetDash = exDash;
      targetSelector = '.ex-tx-section';
    } else if (dash) {
      targetDash = dash;
      targetSelector = '.nc3-bottom-row';
    } else if (exDash) {
      targetDash = exDash;
      targetSelector = '.ex-tx-section';
    }

    // 🛡️ Fallback: retry
    if (!targetDash) {
      console.warn('[bonus-ui] ⏳ No dashboard yet, retry in 2s...');
      setTimeout(injectRewardsCard, 2000);
      return;
    }

    var total = getTotalNC();
    var level = getLevel(total);
    var progress = 0;
    if (level.next !== Infinity) {
      var range = level.next - level.min;
      var inLevel = total - level.min;
      progress = Math.min(100, (inLevel / range) * 100);
    } else {
      progress = 100;
    }

    var card = document.createElement('div');
    card.id = 'ncRewardsCard';
    card.className = 'nc-rewards-card';
    card.innerHTML =
      '<div class="nc-rewards-header">' +
        '<div>' +
          '<div class="nc-rewards-kicker">Loyalty & Rewards</div>' +
          '<h2 class="nc-rewards-title">Nordic Coins</h2>' +
        '</div>' +
        '<div class="nc-rewards-icon" style="padding:12px">' + getCoinSVG(32) + '</div>' +
      '</div>' +
      '<div class="nc-rewards-balance">' +
        '<span class="nc-rewards-count">' + total + '</span>' +
        '<span class="nc-rewards-unit">NC</span>' +
        '<span class="nc-rewards-level" style="color:' + level.color + '">' +
          getLevelSVG(level.name, 16) + ' ' + level.name +
        '</span>' +
      '</div>' +
      (level.next !== Infinity
        ? '<div class="nc-rewards-progress">' +
            '<div class="nc-rewards-progress-label">' +
              '<span>Progress to next level</span>' +
              '<span>' + total + ' / ' + level.next + ' NC</span>' +
            '</div>' +
            '<div class="nc-rewards-progress-bar">' +
              '<div class="nc-rewards-progress-fill" style="width:' + progress + '%"></div>' +
            '</div>' +
          '</div>'
        : '<div class="nc-rewards-progress-label" style="justify-content:center;color:' + level.color + ';font-weight:800;">🎉 You reached the highest level!</div>'
      ) +
      '<div class="nc-rewards-actions">' +
        '<button class="nc-rewards-btn nc-rewards-btn-primary" onclick="window.__ncOpenBonusModal && window.__ncOpenBonusModal()">' +
          '📜 View history' +
        '</button>' +
        '<button class="nc-rewards-btn nc-rewards-btn-ghost" onclick="window.__ncOpenBonusModal && window.__ncOpenBonusModal(\'referral\')">' +
          '👥 Refer a friend' +
        '</button>' +
        '<button class="nc-rewards-btn nc-rewards-btn-ghost" onclick="window.__ncReportBug && window.__ncReportBug()">' +
          '🐞 Report bug (+50 NC)' +
        '</button>' +
      '</div>';

    // 🛡️ ВСТАВЛЯЕМ в нужный dashboard
    var lastSection = targetDash.querySelector(targetSelector);

    if (lastSection && lastSection.parentNode) {
      lastSection.parentNode.insertBefore(card, lastSection.nextSibling);
      console.log('[bonus-ui] ✅ Card injected into',
        isExchange ? 'exchangeDash' : 'dash',
        '| after', targetSelector);
    } else {
      targetDash.appendChild(card);
      console.log('[bonus-ui] ✅ Card appended to',
        isExchange ? 'exchangeDash' : 'dash',
        '| no section found');
    }
  }

  function refreshRewardsCard() {
    var card = document.getElementById('ncRewardsCard');
    if (!card) {
      injectRewardsCard();
      return;
    }
    var total = getTotalNC(true);
    var level = getLevel(total);
    var countEl       = card.querySelector('.nc-rewards-count');
    var levelEl       = card.querySelector('.nc-rewards-level');
    var progressFill  = card.querySelector('.nc-rewards-progress-fill');
    var progressLabel = card.querySelector('.nc-rewards-progress-label span:last-child');
    var iconEl        = card.querySelector('.nc-rewards-icon');

    if (iconEl) iconEl.innerHTML = getCoinSVG(32);
    if (countEl) countEl.textContent = total;
    if (levelEl) {
      levelEl.style.color = level.color;
      levelEl.innerHTML = getLevelSVG(level.name, 16) + ' ' + level.name;
    }
    if (level.next !== Infinity) {
      var range = level.next - level.min;
      var inLevel = total - level.min;
      var progress = Math.min(100, (inLevel / range) * 100);
      if (progressFill) progressFill.style.width = progress + '%';
      if (progressLabel) progressLabel.textContent = total + ' / ' + level.next + ' NC';
    }
  }

  // ============================================================
  // 🎯 BONUS MODAL — с табами
  // ============================================================
  var _activeTab = 'history';

  function openBonusModal(startTab) {
    _activeTab = startTab || 'history';

    var existing = document.querySelector('.nc-bonus-modal');
    if (existing) existing.remove();

    injectCSS();

    // Помечаем что клиент открыл
    if (window.currentUser && window.currentUser.id) {
      localStorage.setItem('nc_bonus_opened_' + window.currentUser.id, '1');
    }

    // Убираем пульсацию badge
    var badge = document.getElementById('ncBadge');
    if (badge) badge.style.animation = '';

    var history = (typeof window.NC_BONUS === 'object') ? window.NC_BONUS.history() : [];
    var total = history.reduce(function (s, e) { return s + (Number(e.amount) || 0); }, 0);
    var level = getLevel(total);

    var today = new Date().toISOString().slice(0, 10);
    var todayEarned = history
      .filter(function (e) { return e.day === today; })
      .reduce(function (s, e) { return s + (Number(e.amount) || 0); }, 0);

    var modal = document.createElement('div');
    modal.className = 'nc-bonus-modal';
    modal.innerHTML =
      '<div class="nc-bonus-card" onclick="event.stopPropagation()">' +
        '<div class="nc-bonus-header">' +
          '<div>' +
            '<h2 class="nc-bonus-title">NC Rewards</h2>' +
            '<div class="nc-bonus-sub">Your loyalty program</div>' +
          '</div>' +
          '<button class="nc-bonus-close" onclick="window.__ncCloseBonusModal()">×</button>' +
        '</div>' +

        // Stats
        '<div class="nc-bonus-stats">' +
          '<div class="nc-bonus-stat">' +
            '<div class="nc-bonus-stat-label">Total earned</div>' +
            '<div class="nc-bonus-stat-value">' + total + '</div>' +
          '</div>' +
          '<div class="nc-bonus-stat">' +
            '<div class="nc-bonus-stat-label">Today</div>' +
            '<div class="nc-bonus-stat-value">+' + todayEarned + '</div>' +
          '</div>' +
          '<div class="nc-bonus-stat">' +
            '<div class="nc-bonus-stat-label">Level</div>' +
            '<div class="nc-bonus-stat-value" style="color:' + level.color + '">' +
              getLevelSVG(level.name, 16) + ' ' + level.name +
            '</div>' +
          '</div>' +
        '</div>' +

        // Tabs
        '<div class="nc-bonus-tabs">' +
          '<button class="nc-bonus-tab ' + (_activeTab === 'history' ? 'nc-on' : '') + '" onclick="window.__ncBonusTab(\'history\')">📜 History</button>' +
          '<button class="nc-bonus-tab ' + (_activeTab === 'earn' ? 'nc-on' : '') + '" onclick="window.__ncBonusTab(\'earn\')">🎯 Earn NC</button>' +
          '<button class="nc-bonus-tab ' + (_activeTab === 'referral' ? 'nc-on' : '') + '" onclick="window.__ncBonusTab(\'referral\')">👥 Refer</button>' +
        '</div>' +

        // Tab contents
        '<div class="nc-bonus-tab-content ' + (_activeTab === 'history' ? 'nc-on' : '') + '" data-tab="history">' +
          buildHistoryHTML(history) +
        '</div>' +
        '<div class="nc-bonus-tab-content ' + (_activeTab === 'earn' ? 'nc-on' : '') + '" data-tab="earn">' +
          buildEarnHTML() +
        '</div>' +
        '<div class="nc-bonus-tab-content ' + (_activeTab === 'referral' ? 'nc-on' : '') + '" data-tab="referral">' +
          buildReferralHTML() +
        '</div>' +
      '</div>';

    document.body.appendChild(modal);
    requestAnimationFrame(function () { modal.classList.add('nc-on'); });
    modal.onclick = function (e) {
      if (e.target === modal) window.__ncCloseBonusModal();
    };
  }

  // ============================================================
  // 🎯 TAB CONTENT BUILDERS
  // ============================================================
  function buildHistoryHTML(history) {
    if (!history || history.length === 0) {
      return '<div class="nc-bonus-empty">' +
        '<div class="nc-bonus-empty-icon">🎁</div>' +
        '<div>No bonuses yet</div>' +
        '<div style="margin-top:8px;font-size:.8rem;color:#5a6673">' +
          'Sign in daily, make deposits, trade, or report bugs to earn NC' +
        '</div>' +
      '</div>';
    }

    var html = '<div class="nc-bonus-list">';
    history.forEach(function (e) {
      var d = new Date(e.ts);
      var dateStr = d.toLocaleDateString('en-GB', {
        day: '2-digit', month: 'short', year: 'numeric'
      }) + ' · ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      html +=
        '<div class="nc-bonus-item">' +
          '<div class="nc-bonus-item-icon">' + getBonusIcon(e.type) + '</div>' +
          '<div class="nc-bonus-item-body">' +
            '<div class="nc-bonus-item-label">' + (e.label || e.type) + '</div>' +
            '<div class="nc-bonus-item-time">' + dateStr + '</div>' +
          '</div>' +
          '<div class="nc-bonus-item-amount">+' + (e.amount || 0) + ' NC</div>' +
        '</div>';
    });
    html += '</div>';
    return html;
  }

  function buildEarnHTML() {
    var tasks = [
      { icon: '🎁', label: 'Welcome bonus',     desc: 'On your first sign-in', bonus: '+10 NC',  done: !!localStorage.getItem('nc_welcome_bonus_' + (window.currentUser && window.currentUser.id)) },
      { icon: '💰', label: 'First deposit',     desc: 'Make your first deposit', bonus: '+50 NC',  done: !!localStorage.getItem('nc_bonus_ot_firstDeposit_' + (window.currentUser && window.currentUser.id)) },
      { icon: '💎', label: 'VIP deposit',       desc: 'Deposit $1000 or more', bonus: '+500 NC', done: false },
      { icon: '📈', label: 'First trade',       desc: 'Execute your first trade', bonus: '+100 NC', done: !!localStorage.getItem('nc_bonus_ot_firstTrade_' + (window.currentUser && window.currentUser.id)) },
      { icon: '🪪', label: 'KYC verification',  desc: 'Complete identity verification', bonus: '+200 NC', done: !!(window.st && window.st.verification && window.st.verification.status === 'approved') },
      { icon: '🔥', label: '7-day loyalty',     desc: 'Sign in 7 days in a row', bonus: '+100 NC', done: !!localStorage.getItem('nc_loyalty_ts_' + (window.currentUser && window.currentUser.id)) },
      { icon: '👥', label: 'Refer a friend',    desc: 'Invite someone to NordicCrypto', bonus: '+250 NC', done: !!localStorage.getItem('nc_referral_used_' + (window.currentUser && window.currentUser.id)) },
      { icon: '🐞', label: 'Report a bug',      desc: 'Help us fix an issue', bonus: '+50 NC',  done: false }
    ];

    var html = '<div class="nc-earn-list">';
    tasks.forEach(function (t) {
      html +=
        '<div class="nc-earn-item">' +
          '<div class="nc-earn-item-icon" style="font-size:20px">' + t.icon + '</div>' +
          '<div class="nc-earn-item-body">' +
            '<div class="nc-earn-item-label">' + t.label + '</div>' +
            '<div class="nc-earn-item-desc">' + t.desc + '</div>' +
          '</div>' +
          (t.done
            ? '<div class="nc-earn-item-done">✓ Done</div>'
            : '<div class="nc-earn-item-bonus">' + t.bonus + '</div>') +
        '</div>';
    });
    html += '</div>';
    return html;
  }

  function buildReferralHTML() {
    var userId = (window.currentUser && (window.currentUser.id || window.currentUser.email)) || '';
    var refLink = window.location.origin + window.location.pathname + '?ref=' + encodeURIComponent(userId);
    var refCount = Number(localStorage.getItem('nc_referral_count_' + userId) || 0);

    return '<div class="nc-referral-content">' +
      '<div class="nc-referral-big-icon" style="font-size:32px">👥</div>' +
      '<div class="nc-referral-title">Invite friends, earn NC</div>' +
      '<div class="nc-referral-desc">Share your link — when a friend signs up, you both get rewarded.</div>' +
      '<div class="nc-referral-bonus-big">+250 NC</div>' +
      '<div class="nc-referral-link-box">' +
        '<input type="text" class="nc-referral-link-input" value="' + refLink + '" readonly id="ncRefLink">' +
        '<button class="nc-referral-copy-btn" onclick="window.__ncCopyReferralLink()">📋 Copy</button>' +
      '</div>' +
      '<button class="nc-referral-share-btn" onclick="window.__ncShareReferral()">' +
        '📤 Share via...' +
      '</button>' +
      '<div class="nc-referral-stats">' +
        '<div class="nc-referral-stat">' +
          '<div class="nc-referral-stat-label">Invited</div>' +
          '<div class="nc-referral-stat-value">' + refCount + '</div>' +
        '</div>' +
        '<div class="nc-referral-stat">' +
          '<div class="nc-referral-stat-label">Earned</div>' +
          '<div class="nc-referral-stat-value">' + (refCount * 250) + '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  // ============================================================
  // 🎯 TABS SWITCHER
  // ============================================================
  window.__ncBonusTab = function (tabName) {
    var tabs = document.querySelectorAll('.nc-bonus-tab');
    var contents = document.querySelectorAll('.nc-bonus-tab-content');

    tabs.forEach(function (t) { t.classList.remove('nc-on'); });
    contents.forEach(function (c) { c.classList.remove('nc-on'); });

    var activeTab = document.querySelector('.nc-bonus-tab[onclick*="' + tabName + '"]');
    if (activeTab) activeTab.classList.add('nc-on');

    var activeContent = document.querySelector('.nc-bonus-tab-content[data-tab="' + tabName + '"]');
    if (activeContent) activeContent.classList.add('nc-on');
  };

  // ============================================================
  // 🎯 REFERRAL ACTIONS
  // ============================================================
  window.__ncCopyReferralLink = function () {
    var input = document.getElementById('ncRefLink');
    if (!input) return;
    input.select();
    input.setSelectionRange(0, 99999);
    try {
      document.execCommand('copy');
      if (typeof window.toast === 'function') window.toast('✅ Referral link copied');
    } catch (e) {
      if (navigator.clipboard) {
        navigator.clipboard.writeText(input.value).then(function () {
          if (typeof window.toast === 'function') window.toast('✅ Referral link copied');
        });
      }
    }
  };

  window.__ncShareReferral = function () {
    var input = document.getElementById('ncRefLink');
    if (!input) return;
    var text = 'Join NordicCrypto and get 250 NC bonus!';

    if (navigator.share) {
      navigator.share({
        title: 'NordicCrypto',
        text: text,
        url: input.value
      }).catch(function () {});
    } else {
      window.__ncCopyReferralLink();
    }
  };

  window.__ncOpenBonusModal = openBonusModal;

  window.__ncCloseBonusModal = function () {
    var m = document.querySelector('.nc-bonus-modal');
    if (m) {
      m.classList.remove('nc-on');
      setTimeout(function () { m.remove(); }, 300);
    }
  };

  // ============================================================
  // 🎯 BONUS GRANTED — плавное обновление
  // ============================================================
  document.addEventListener('nc:bonus:granted', function (ev) {
    var d = ev.detail || {};
    var amount = d.amount || 0;
    var label = d.label || d.type || 'Bonus';
    var type = d.type || 'welcome';

    invalidateNCCache();
    updateBadge();
    refreshRewardsCard();

    if (typeof window.addNotification === 'function') {
      window.addNotification('+' + amount + ' NC — ' + label, getBonusEmoji(type));
    }

    var badge = document.getElementById('ncBadge');
    if (badge) {
      badge.style.animation = 'none';
      void badge.offsetWidth;
      badge.style.animation = 'ncBadgePulse 0.6s ease';
    }
  });

  // ============================================================
  // 🎯 LOGOUT — cleanup
  // ============================================================
  document.addEventListener('nc:auth:logout', function () {
    invalidateNCCache();
    var b = document.getElementById('ncBadge');
    var c = document.getElementById('ncRewardsCard');
    if (b) b.remove();
    if (c) c.remove();
    var m = document.querySelector('.nc-bonus-modal');
    if (m) m.remove();
    console.log('[bonus-ui] cleaned up on logout');
  });

  // ============================================================
  // 🎯 REPORT BUG
  // ============================================================
  window.__ncReportBug = function () {
    if (!window.currentUser) {
      if (typeof window.toast === 'function') window.toast('Please sign in first');
      return;
    }
    var text = prompt(
      'Describe the bug you found:\n\n' +
      'Examples:\n' +
      '• "Deposit button doesn\'t work"\n' +
      '• "Layout broken on mobile"\n' +
      '• "Wrong balance shown"\n\n' +
      'You will receive +50 NC for a valid report.'
    );
    if (!text || text.length < 5) return;

    if (typeof window.NC_BONUS === 'object' && typeof window.NC_BONUS.grant === 'function') {
      window.NC_BONUS.grant(window.currentUser.id, 'bug');
      if (typeof window.toast === 'function') window.toast('🐞 Bug reported! Thank you.');
      if (typeof window.sendChatMsg === 'function') {
        var input = document.getElementById('chatInput');
        if (input) {
          input.value = '[BUG REPORT] ' + text;
          window.sendChatMsg();
        }
      }
    }
  };

  // ============================================================
  // 🎯 FIRST DEPOSIT bonus (событие от deposit-flow)
  // ============================================================
  document.addEventListener('nc:deposit:confirmed', function () {
    if (typeof window.NC_BONUS === 'object' &&
        typeof window.NC_BONUS.grantFirstDeposit === 'function') {
      window.NC_BONUS.grantFirstDeposit();
    }
  });

  // ============================================================
  // 🎯 INIT
  // ============================================================
  function init() {
    injectCSS();
    injectBadge();
    injectRewardsCard();

    setTimeout(function () {
      injectBadge();
      if (!document.getElementById('ncRewardsCard')) injectRewardsCard();
    }, 1500);

    setTimeout(function () {
      injectBadge();
      if (!document.getElementById('ncRewardsCard')) injectRewardsCard();
    }, 4000);

    setTimeout(function () {
      if (!document.getElementById('ncRewardsCard')) {
        console.log('[bonus-ui] 🔄 Late retry inject rewards card');
        injectRewardsCard();
      }
    }, 8000);

    console.log('%c[NordicCrypto] 🎁 bonus-ui.js v' + BUI_VERSION + ' loaded',
      'color:#f59e0b;font-weight:bold;font-size:13px');
  }

  // ============================================================
  // 🛡️ СЛУШАТЕЛИ переинжекта
  // ============================================================
  document.addEventListener('nc:account:typechange', function () {
    setTimeout(function () {
      var old = document.getElementById('ncRewardsCard');
      if (old) old.remove();
      console.log('[bonus-ui] 🔄 Account type changed — reinjecting');
      injectRewardsCard();
    }, 300);
  });

  document.addEventListener('click', function (e) {
    var mi = e.target.closest('.mi');
    if (!mi) return;
    setTimeout(function () {
      if (!document.getElementById('ncRewardsCard')) {
        injectRewardsCard();
      }
    }, 500);
  }, true);

  document.addEventListener('nc:dashboard:rendered', function () {
    setTimeout(function () {
      if (!document.getElementById('ncRewardsCard')) {
        injectRewardsCard();
      }
    }, 200);
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  document.addEventListener('nc:auth:login', function () {
    invalidateNCCache();
    setTimeout(function () {
      injectBadge();
      injectRewardsCard();
    }, 2000);
  });

  // ============================================================
  // 🎯 EXPORT
  // ============================================================
  window.__ncBonusUI = {
    version: BUI_VERSION,
    updateBadge: updateBadge,
    injectBadge: injectBadge,
    injectRewardsCard: injectRewardsCard,
    refreshRewardsCard: refreshRewardsCard,
    openModal: openBonusModal,
    getTotalNC: getTotalNC,
    getLevel: getLevel,
    levels: LEVELS,
    invalidate: invalidateNCCache
  };

})();
