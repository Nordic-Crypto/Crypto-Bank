/* ============================================================
   NORDIC CRYPTO — BONUS-UI.JS v3.0 (PERFORMANCE EDITION)
   ============================================================
   v3.0 CHANGES:
   • 🔴 КРИТИЧНЫЙ ФИКС: карточка для exchanger (auto-detect by .on)
   • 🎨 Спокойный дизайн — меньше gradient, нет filter/blur
   • ⚡ Оптимизация для слабых ПК:
     - Кэш 2 сек (было 500ms)
     - Убраны тяжёлые SVG filter
     - Retry только 3 раза
     - Один MutationObserver убран
     - GPU-friendly анимации (transform, не width)
   • 🎁 Новые бонусы: dailyLogin, profileComplete
   • 🎨 Обновлены цвета уровней (мягче)
   • 📊 Progress bar показывает "до Silver"
   • 🛡️ Auto-refresh badge каждые 30 сек
   ============================================================ */

(function () {
  'use strict';

  var BUI_VERSION = '3.0.0';

  // ============================================================
  // ⚡ CACHE — 2 секунды (для слабых ПК)
  // ============================================================
  var _totalNCCache = null;
  var _totalNCTs = 0;
  var _CACHE_TTL = 2000;

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
  // ⚡ SVG — БЕЗ filter/blur (легче для GPU)
  // ============================================================
  var _svgIdCounter = 0;
  function uid(prefix) {
    _svgIdCounter++;
    return prefix + '_' + _svgIdCounter;
  }

  function getCoinSVG(size) {
    size = size || 20;
    var id = uid('cg');
    return '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '" style="display:block">' +
      '<defs>' +
        '<linearGradient id="' + id + '" x1="0%" y1="0%" x2="100%" y2="100%">' +
          '<stop offset="0%" stop-color="#fbbf24"/>' +
          '<stop offset="100%" stop-color="#b45309"/>' +
        '</linearGradient>' +
      '</defs>' +
      '<circle cx="12" cy="12" r="11" fill="url(#' + id + ')"/>' +
      '<text x="12" y="16.5" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-size="12" font-weight="900" fill="#fff">N</text>' +
    '</svg>';
  }

  // 🎨 МЯГКИЕ ЦВЕТА УРОВНЕЙ
  var LEVEL_COLORS = {
    'Bronze':   { bg: '#a86d3f', text: '#e8b585' },
    'Silver':   { bg: '#8a93a0', text: '#c9d1dc' },
    'Gold':     { bg: '#d4a017', text: '#ffd970' },
    'Platinum': { bg: '#b8c4d0', text: '#e8eef5' }
  };

  function getLevelSVG(levelName, size) {
    size = size || 14;
    var c = LEVEL_COLORS[levelName] || LEVEL_COLORS['Bronze'];
    var id = uid('lg');
    return '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '" style="display:inline-block;vertical-align:middle">' +
      '<defs>' +
        '<linearGradient id="' + id + '" x1="0%" y1="0%" x2="100%" y2="100%">' +
          '<stop offset="0%" stop-color="' + c.text + '"/>' +
          '<stop offset="100%" stop-color="' + c.bg + '"/>' +
        '</linearGradient>' +
      '</defs>' +
      '<circle cx="12" cy="12" r="11" fill="url(#' + id + ')" stroke="rgba(255,255,255,.25)" stroke-width="1"/>' +
      '<text x="12" y="17" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-size="12" font-weight="900" fill="#fff">' + levelName.charAt(0) + '</text>' +
    '</svg>';
  }

  // ============================================================
  // 🎯 LEVELS
  // ============================================================
  var LEVELS = [
    { name: 'Bronze',   min: 0,    max: 500,      color: '#a86d3f', text: '#e8b585', next: 500 },
    { name: 'Silver',   min: 500,  max: 2000,     color: '#8a93a0', text: '#c9d1dc', next: 2000 },
    { name: 'Gold',     min: 2000, max: 5000,     color: '#d4a017', text: '#ffd970', next: 5000 },
    { name: 'Platinum', min: 5000, max: Infinity, color: '#b8c4d0', text: '#e8eef5', next: Infinity }
  ];

  function getLevel(totalNC) {
    for (var i = 0; i < LEVELS.length; i++) {
      if (totalNC >= LEVELS[i].min && totalNC < LEVELS[i].max) return LEVELS[i];
    }
    return LEVELS[LEVELS.length - 1];
  }

  // ============================================================
  // 🎯 ICONS (emoji-based — легче и понятнее)
  // ============================================================
  function getBonusEmoji(type) {
    var e = {
      welcome: '🎁', minor: '🐛', medium: '⚡', major: '💥',
      critical: '🚨', bug: '🐞', loyalty: '🔥', referral: '👥',
      firstDeposit: '💰', firstTrade: '📈', kycBonus: '🪪', bigDeposit: '💎',
      dailyLogin: '📅', profileComplete: '👤'
    };
    return e[type] || '🎁';
  }

  // ============================================================
  // 🎨 CSS — ОПТИМИЗИРОВАН ДЛЯ СЛАБЫХ ПК
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
        background: rgba(245,158,11,.1);
        border: 1px solid rgba(245,158,11,.35);
        border-radius: 999px;
        color: #f59e0b; font-weight: 800; font-size: .82rem;
        cursor: pointer; user-select: none;
        transition: transform .2s, background .2s;
        will-change: transform;
      }
      .nc-badge:hover {
        transform: translateY(-2px);
        background: rgba(245,158,11,.18);
      }
      .nc-badge-icon {
        display: inline-flex; align-items: center; justify-content: center;
      }
      .nc-badge-icon svg {
        animation: ncCoinSpin 4s linear infinite;
        transform-origin: center;
      }
      @keyframes ncCoinSpin {
        0%   { transform: rotateY(0deg); }
        100% { transform: rotateY(360deg); }
      }
      .nc-badge-amount {
        font-family: ui-monospace, monospace; color: #fff; font-size: .88rem;
      }
      .nc-badge-level {
        display: inline-flex; align-items: center; gap: 4px;
        font-size: .68rem; padding: 3px 8px;
        background: rgba(255,255,255,.06); border-radius: 6px; font-weight: 800;
      }
      .nc-badge-level svg { vertical-align: middle; }

      /* ===== REWARDS CARD ===== */
      .nc-rewards-card {
        background: linear-gradient(145deg, rgba(16,23,36,.96), rgba(9,14,23,.96));
        border: 1px solid rgba(245,158,11,.2);
        border-radius: 20px; padding: 24px;
        box-shadow: 0 10px 30px -15px rgba(0,0,0,.5);
        margin-top: 24px;
      }
      .nc-rewards-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; }
      .nc-rewards-kicker {
        font-size: .68rem; color: #f59e0b; text-transform: uppercase;
        letter-spacing: 1.5px; font-weight: 800; margin-bottom: 6px;
      }
      .nc-rewards-title { font-size: 1.4rem; font-weight: 800; color: #fff; margin: 0; }
      .nc-rewards-icon {
        width: 56px; height: 56px; border-radius: 16px;
        background: rgba(245,158,11,.15);
        display: flex; align-items: center; justify-content: center;
      }
      .nc-rewards-balance { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; flex-wrap: wrap; }
      .nc-rewards-count {
        font-size: 2.5rem; font-weight: 800;
        font-family: ui-monospace, monospace;
        color: #fbbf24;
        letter-spacing: -0.03em;
      }
      .nc-rewards-unit { font-size: 1rem; color: #8b95a5; font-weight: 700; }
      .nc-rewards-level {
        display: inline-flex; align-items: center; gap: 6px;
        padding: 6px 12px; background: rgba(255,255,255,.05);
        border: 1px solid currentColor; border-radius: 999px;
        font-size: .78rem; font-weight: 800;
      }
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
        height: 100%;
        background: linear-gradient(90deg, #f59e0b, #ec4899);
        border-radius: 4px;
        transition: width .4s ease;
        transform: translateZ(0);
      }
      .nc-rewards-actions { display: flex; gap: 10px; margin-top: 20px; flex-wrap: wrap; }
      .nc-rewards-btn {
        flex: 1; min-width: 130px; padding: 12px 18px;
        border: none; border-radius: 12px;
        font-weight: 800; font-size: .85rem; cursor: pointer; font-family: inherit;
        transition: transform .15s, background .15s;
        will-change: transform;
      }
      .nc-rewards-btn:hover { transform: translateY(-2px); }
      .nc-rewards-btn-primary {
        background: linear-gradient(135deg, #f59e0b, #ec4899); color: #fff;
      }
      .nc-rewards-btn-ghost {
        background: rgba(255,255,255,.04);
        border: 1px solid rgba(255,255,255,.1);
        color: #b6c1d1;
      }
      .nc-rewards-btn-ghost:hover {
        background: rgba(245,158,11,.08);
        border-color: rgba(245,158,11,.4);
        color: #f59e0b;
      }

      /* ===== BONUS MODAL ===== */
      .nc-bonus-modal {
        position: fixed; inset: 0; background: rgba(3,6,11,.9);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        display: flex; align-items: center;
        justify-content: center; z-index: 99999; padding: 20px;
        opacity: 0; transition: opacity .25s ease;
      }
      .nc-bonus-modal.nc-on { opacity: 1; }
      .nc-bonus-card {
        width: 100%; max-width: 560px; max-height: 90vh;
        background: linear-gradient(165deg, #0f1720 0%, #0a0e15 100%);
        border: 1px solid rgba(245,158,11,.3); border-radius: 24px;
        padding: 32px 28px 24px; color: #e7edf5;
        overflow: hidden;
        box-shadow: 0 20px 60px -20px rgba(0,0,0,.8);
        transform: translateY(20px) scale(.96);
        transition: transform .3s cubic-bezier(.34,1.56,.64,1);
        display: flex; flex-direction: column;
      }
      .nc-bonus-modal.nc-on .nc-bonus-card { transform: translateY(0) scale(1); }
      .nc-bonus-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; }
      .nc-bonus-title {
        font-size: 1.5rem; font-weight: 800;
        color: #f59e0b; margin: 0 0 4px;
      }
      .nc-bonus-sub { font-size: .82rem; color: #8b95a5; }
      .nc-bonus-close {
        width: 36px; height: 36px; border-radius: 10px;
        background: rgba(255,255,255,.04);
        border: 1px solid rgba(255,255,255,.08);
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
        transition: color .15s, background .15s;
      }
      .nc-bonus-tab:hover { color: #e7edf5; }
      .nc-bonus-tab.nc-on {
        background: rgba(245,158,11,.15);
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
        transition: background .2s, transform .2s;
        will-change: transform;
      }
      .nc-bonus-item:hover {
        background: rgba(245,158,11,.06);
        border-color: rgba(245,158,11,.25);
        transform: translateX(4px);
      }
      .nc-bonus-item-icon {
        width: 42px; height: 42px; border-radius: 12px;
        display: flex; align-items: center; justify-content: center;
        flex-shrink: 0; font-size: 20px;
        background: rgba(245,158,11,.1);
        border: 1px solid rgba(245,158,11,.2);
      }
      .nc-bonus-item-body { flex: 1; min-width: 0; }
      .nc-bonus-item-label { font-weight: 700; font-size: .9rem; color: #fff; margin-bottom: 3px; }
      .nc-bonus-item-time { font-size: .72rem; color: #7c9cbb; }
      .nc-bonus-item-amount {
        font-family: ui-monospace, monospace; font-size: 1rem;
        font-weight: 800; color: #10b981;
        flex-shrink: 0;
      }
      .nc-bonus-empty { text-align: center; padding: 60px 20px; color: #7c9cbb; }
      .nc-bonus-empty-icon { font-size: 3rem; margin-bottom: 12px; opacity: .5; }

      /* ===== EARN TAB ===== */
      .nc-earn-list { display: flex; flex-direction: column; gap: 10px; overflow-y: auto; max-height: 400px; padding-right: 4px; }
      .nc-earn-list::-webkit-scrollbar { width: 6px; }
      .nc-earn-list::-webkit-scrollbar-thumb { background: rgba(245,158,11,.3); border-radius: 3px; }
      .nc-earn-item {
        display: flex; align-items: center; gap: 14px;
        padding: 14px 16px; background: rgba(255,255,255,.03);
        border: 1px solid rgba(255,255,255,.06); border-radius: 12px;
        transition: background .15s;
      }
      .nc-earn-item:hover { background: rgba(245,158,11,.06); }
      .nc-earn-item-icon {
        width: 42px; height: 42px; border-radius: 12px;
        display: flex; align-items: center; justify-content: center;
        flex-shrink: 0; font-size: 20px;
        background: rgba(245,158,11,.1);
        border: 1px solid rgba(245,158,11,.2);
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
        font-size: 32px;
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
        flex-shrink: 0;
      }
      .nc-referral-share-btn {
        width: 100%; padding: 12px; border-radius: 12px;
        background: rgba(139,92,246,.15);
        border: 1px solid rgba(139,92,246,.3);
        color: #c4b5fd; font-weight: 800; font-size: .85rem;
        cursor: pointer; font-family: inherit;
        display: flex; align-items: center; justify-content: center; gap: 8px;
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

      /* ⚡ Reduce motion для слабых ПК */
      @media (prefers-reduced-motion: reduce) {
        .nc-badge-icon svg,
        .nc-rewards-progress-fill {
          animation: none !important;
          transition: none !important;
        }
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
    badge.title = 'View your rewards';
    badge.innerHTML =
      '<span class="nc-badge-icon">' + getCoinSVG(20) + '</span>' +
      '<span class="nc-badge-amount">' + total + ' NC</span>' +
      '<span class="nc-badge-level" style="color:' + level.text + '">' +
        getLevelSVG(level.name, 14) + ' ' + level.name +
      '</span>';

    var notifBell = document.getElementById('notifBell');
    if (notifBell && notifBell.parentNode) {
      notifBell.parentNode.insertBefore(badge, notifBell);
    } else {
      topBar.insertBefore(badge, topBar.firstChild);
    }

    badge.onclick = openBonusModal;
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
      lvlEl.style.color = level.text;
      lvlEl.innerHTML = getLevelSVG(level.name, 14) + ' ' + level.name;
    }
  }

  // ============================================================
  // 🔴 REWARDS CARD — ГЛАВНЫЙ ФИКС
  // ============================================================
  function injectRewardsCard() {
    if (document.getElementById('ncRewardsCard')) return;

    // 🔴 КРИТИЧНЫЙ ФИКС: выбираем dashboard по ВИДИМОСТИ, а не по accountType
    var dash   = document.getElementById('dash');
    var exDash = document.getElementById('exchangeDash');

    var targetDash = null;
    var targetSelector = '';

    // Приоритет 1: ВИДИМЫЙ exchange dashboard
    if (exDash && exDash.classList.contains('on') && exDash.querySelector('.ex-tx-section')) {
      targetDash = exDash;
      targetSelector = '.ex-tx-section';
      console.log('[bonus-ui] ✅ Target: exchangeDash (visible)');
    }
    // Приоритет 2: ВИДИМЫЙ banking dashboard
    else if (dash && dash.classList.contains('on') && dash.querySelector('.nc3-bottom-row')) {
      targetDash = dash;
      targetSelector = '.nc3-bottom-row';
      console.log('[bonus-ui] ✅ Target: dash (visible)');
    }
    // Приоритет 3: exchange существует (но не видим — например, switching)
    else if (exDash && exDash.querySelector('.ex-tx-section')) {
      targetDash = exDash;
      targetSelector = '.ex-tx-section';
      console.log('[bonus-ui] ✅ Target: exchangeDash (exists)');
    }
    // Приоритет 4: banking существует
    else if (dash) {
      targetDash = dash;
      targetSelector = '.nc3-bottom-row';
      console.log('[bonus-ui] ✅ Target: dash (exists)');
    }

    // Fallback
    if (!targetDash) {
      console.warn('[bonus-ui] ⏳ No dashboard yet, retry in 2s');
      setTimeout(injectRewardsCard, 2000);
      return;
    }

    var total = getTotalNC();
    var level = getLevel(total);
    var progress = 0;
    var progressText = '';

    if (level.next !== Infinity) {
      var range = level.next - level.min;
      var inLevel = total - level.min;
      progress = Math.min(100, (inLevel / range) * 100);
      progressText = total + ' / ' + level.next + ' NC';
    } else {
      progress = 100;
      progressText = 'MAX';
    }

    // 🎁 Следующий уровень
    var nextLevelName = '';
    for (var i = 0; i < LEVELS.length; i++) {
      if (LEVELS[i].name === level.name && i < LEVELS.length - 1) {
        nextLevelName = LEVELS[i + 1].name;
        break;
      }
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
        '<div class="nc-rewards-icon">' + getCoinSVG(32) + '</div>' +
      '</div>' +
      '<div class="nc-rewards-balance">' +
        '<span class="nc-rewards-count">' + total + '</span>' +
        '<span class="nc-rewards-unit">NC</span>' +
        '<span class="nc-rewards-level" style="color:' + level.text + '">' +
          getLevelSVG(level.name, 16) + ' ' + level.name +
        '</span>' +
      '</div>' +
      (level.next !== Infinity
        ? '<div class="nc-rewards-progress">' +
            '<div class="nc-rewards-progress-label">' +
              '<span>' + (nextLevelName ? 'Progress to ' + nextLevelName : 'Progress') + '</span>' +
              '<span>' + progressText + '</span>' +
            '</div>' +
            '<div class="nc-rewards-progress-bar">' +
              '<div class="nc-rewards-progress-fill" style="width:' + progress + '%"></div>' +
            '</div>' +
          '</div>'
        : '<div class="nc-rewards-progress-label" style="justify-content:center;color:' + level.text + ';font-weight:800;">🎉 Highest level reached!</div>'
      ) +
      '<div class="nc-rewards-actions">' +
        '<button class="nc-rewards-btn nc-rewards-btn-primary" onclick="window.__ncOpenBonusModal && window.__ncOpenBonusModal()">' +
          '📜 View history' +
        '</button>' +
        '<button class="nc-rewards-btn nc-rewards-btn-ghost" onclick="window.__ncOpenBonusModal && window.__ncOpenBonusModal(\'referral\')">' +
          '👥 Refer a friend' +
        '</button>' +
        '<button class="nc-rewards-btn nc-rewards-btn-ghost" onclick="window.__ncReportBug && window.__ncReportBug()">' +
          '🐞 Report bug' +
        '</button>' +
      '</div>';

    // Вставляем
    var lastSection = targetDash.querySelector(targetSelector);

    if (lastSection && lastSection.parentNode) {
      lastSection.parentNode.insertBefore(card, lastSection.nextSibling);
      console.log('[bonus-ui] ✅ Card injected after', targetSelector);
    } else {
      targetDash.appendChild(card);
      console.log('[bonus-ui] ✅ Card appended');
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
      levelEl.style.color = level.text;
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
  // 🎯 BONUS MODAL
  // ============================================================
  var _activeTab = 'history';

  function openBonusModal(startTab) {
    _activeTab = startTab || 'history';

    var existing = document.querySelector('.nc-bonus-modal');
    if (existing) existing.remove();

    injectCSS();

    if (window.currentUser && window.currentUser.id) {
      localStorage.setItem('nc_bonus_opened_' + window.currentUser.id, '1');
    }

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
            '<div class="nc-bonus-stat-value" style="color:' + level.text + '">' +
              getLevelSVG(level.name, 16) + ' ' + level.name +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="nc-bonus-tabs">' +
          '<button class="nc-bonus-tab ' + (_activeTab === 'history' ? 'nc-on' : '') + '" onclick="window.__ncBonusTab(\'history\')">📜 History</button>' +
          '<button class="nc-bonus-tab ' + (_activeTab === 'earn' ? 'nc-on' : '') + '" onclick="window.__ncBonusTab(\'earn\')">🎯 Earn NC</button>' +
          '<button class="nc-bonus-tab ' + (_activeTab === 'referral' ? 'nc-on' : '') + '" onclick="window.__ncBonusTab(\'referral\')">👥 Refer</button>' +
        '</div>' +
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
  // 🎯 TAB CONTENT
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
        day: '2-digit', month: 'short'
      }) + ' · ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      html +=
        '<div class="nc-bonus-item">' +
          '<div class="nc-bonus-item-icon">' + getBonusEmoji(e.type) + '</div>' +
          '<div class="nc-bonus-item-body">' +
            '<div class="nc-bonus-item-label">' + (e.label || e.type) + '</div>' +
            '<div class="nc-bonus-item-time">' + dateStr + '</div>' +
          '</div>' +
          '<div class="nc-bonus-item-amount">+' + (e.amount || 0) + '</div>' +
        '</div>';
    });
    html += '</div>';
    return html;
  }

  function buildEarnHTML() {
    var uid_ = (window.currentUser && window.currentUser.id) || '';
    var tasks = [
      { icon: '🎁', label: 'Welcome bonus',     desc: 'On first sign-in',         bonus: '+10 NC',  done: !!localStorage.getItem('nc_welcome_bonus_' + uid_) },
      { icon: '📅', label: 'Daily login',       desc: 'Sign in every day',        bonus: '+5 NC',   done: false },
      { icon: '💰', label: 'First deposit',     desc: 'Make your first deposit',  bonus: '+50 NC',  done: !!localStorage.getItem('nc_bonus_ot_firstDeposit_' + uid_) },
      { icon: '💎', label: 'VIP deposit',       desc: 'Deposit $1000 or more',    bonus: '+500 NC', done: false },
      { icon: '📈', label: 'First trade',       desc: 'Execute your first trade', bonus: '+100 NC', done: !!localStorage.getItem('nc_bonus_ot_firstTrade_' + uid_) },
      { icon: '🪪', label: 'KYC verification',  desc: 'Complete ID verification', bonus: '+200 NC', done: !!(window.st && window.st.verification && window.st.verification.status === 'approved') },
      { icon: '🔥', label: '7-day loyalty',     desc: 'Sign in 7 days in a row',  bonus: '+100 NC', done: !!localStorage.getItem('nc_loyalty_ts_' + uid_) },
      { icon: '👤', label: 'Complete profile',  desc: 'Add name & phone',         bonus: '+25 NC',  done: false },
      { icon: '👥', label: 'Refer a friend',    desc: 'Invite someone',           bonus: '+250 NC', done: !!localStorage.getItem('nc_referral_used_' + uid_) },
      { icon: '🐞', label: 'Report a bug',      desc: 'Help us fix an issue',     bonus: '+50 NC',  done: false }
    ];

    var html = '<div class="nc-earn-list">';
    tasks.forEach(function (t) {
      html +=
        '<div class="nc-earn-item">' +
          '<div class="nc-earn-item-icon">' + t.icon + '</div>' +
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
      '<div class="nc-referral-big-icon">👥</div>' +
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
  // 🎯 TABS + REFERRAL
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
      navigator.share({ title: 'NordicCrypto', text: text, url: input.value }).catch(function () {});
    } else {
      window.__ncCopyReferralLink();
    }
  };

  window.__ncOpenBonusModal = openBonusModal;
  window.__ncCloseBonusModal = function () {
    var m = document.querySelector('.nc-bonus-modal');
    if (m) {
      m.classList.remove('nc-on');
      setTimeout(function () { m.remove(); }, 250);
    }
  };

  // ============================================================
  // 🎯 BONUS GRANTED
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
  });

  // ============================================================
  // 🎯 LOGOUT
  // ============================================================
  document.addEventListener('nc:auth:logout', function () {
    invalidateNCCache();
    var b = document.getElementById('ncBadge');
    var c = document.getElementById('ncRewardsCard');
    if (b) b.remove();
    if (c) c.remove();
    var m = document.querySelector('.nc-bonus-modal');
    if (m) m.remove();
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
      '• "Layout broken on mobile"\n\n' +
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
  // 🎯 FIRST DEPOSIT
  // ============================================================
  document.addEventListener('nc:deposit:confirmed', function () {
    if (typeof window.NC_BONUS === 'object' &&
        typeof window.NC_BONUS.grantFirstDeposit === 'function') {
      window.NC_BONUS.grantFirstDeposit();
    }
  });

  // ============================================================
  // 🎯 INIT — 3 попытки, потом стоп (для слабых ПК)
  // ============================================================
  function init() {
    injectCSS();
    injectBadge();
    injectRewardsCard();

    var attempts = 0;
    var maxAttempts = 3;

    function tryInjectCard() {
      if (document.getElementById('ncRewardsCard')) return;
      if (attempts >= maxAttempts) return;
      attempts++;
      console.log('[bonus-ui] Retry #' + attempts);
      injectRewardsCard();
      if (attempts < maxAttempts) setTimeout(tryInjectCard, 3000);
    }

    setTimeout(tryInjectCard, 3000);

    console.log('%c[NordicCrypto] 🎁 bonus-ui.js v' + BUI_VERSION + ' loaded',
      'color:#f59e0b;font-weight:bold;font-size:13px');
  }

  // ============================================================
  // 🛡️ LISTENERS
  // ============================================================
  document.addEventListener('nc:account:typechange', function () {
    setTimeout(function () {
      var old = document.getElementById('ncRewardsCard');
      if (old) old.remove();
      injectRewardsCard();
    }, 400);
  });

  // Auto-refresh badge каждые 30 сек (для актуальности)
  setInterval(function () {
    if (document.getElementById('ncBadge')) {
      invalidateNCCache();
      updateBadge();
    }
  }, 30000);

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
