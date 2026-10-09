/* ============================================================
   NORDIC CRYPTO — BONUS-UI.JS v1.0
   ============================================================
   UI для системы NC-коинов:
   • Счётчик NC в шапке
   • Карточка Rewards на dashboard
   • Модалка с полной историей
   • Level system (Bronze → Silver → Gold → Platinum)
   • Интеграция в notifications[]
   ============================================================ */

(function () {
  'use strict';

  var BUI_VERSION = '1.0.0';

     // ============================================================
  // 🎯 SVG-ИКОНКИ (замена эмодзи — работает везде)
  // ============================================================

  /** Монетка NC — золотой кружок с буквой N */
  function getCoinSVG(size) {
    size = size || 20;
    return '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '" style="display:block">' +
      '<defs>' +
        '<radialGradient id="ncCoinGrad" cx="30%" cy="30%">' +
          '<stop offset="0%" stop-color="#ffe17a"/>' +
          '<stop offset="55%" stop-color="#f59e0b"/>' +
          '<stop offset="100%" stop-color="#b45309"/>' +
        '</radialGradient>' +
      '</defs>' +
      '<circle cx="12" cy="12" r="11" fill="url(#ncCoinGrad)" stroke="rgba(255,255,255,.3)" stroke-width="1"/>' +
      '<circle cx="12" cy="12" r="9" fill="none" stroke="rgba(255,255,255,.25)" stroke-width="0.5" stroke-dasharray="1.5 2"/>' +
      '<text x="12" y="16.5" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-size="12" font-weight="900" fill="#fff">N</text>' +
    '</svg>';
  }

  /** Медаль уровня — цветной кружок с буквой (B/S/G/P) */
  function getLevelSVG(levelName, size) {
    size = size || 14;
    var colors = {
      'Bronze':   { bg: '#cd7f32', shadow: '#8b5a2b', letter: 'B' },
      'Silver':   { bg: '#c0c0c0', shadow: '#808080', letter: 'S' },
      'Gold':     { bg: '#ffd700', shadow: '#b8860b', letter: 'G' },
      'Platinum': { bg: '#e5e4e2', shadow: '#a8a8a8', letter: 'P' }
    };
    var c = colors[levelName] || colors['Bronze'];
    return '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '" style="display:inline-block;vertical-align:middle">' +
      '<defs>' +
        '<radialGradient id="ncLvl_' + c.letter + '" cx="30%" cy="30%">' +
          '<stop offset="0%" stop-color="' + c.bg + '" stop-opacity="1"/>' +
          '<stop offset="100%" stop-color="' + c.shadow + '" stop-opacity="1"/>' +
        '</radialGradient>' +
      '</defs>' +
      '<circle cx="12" cy="12" r="11" fill="url(#ncLvl_' + c.letter + ')" stroke="rgba(255,255,255,.4)" stroke-width="1"/>' +
      '<text x="12" y="17" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-size="12" font-weight="900" fill="#fff" opacity=".95">' + c.letter + '</text>' +
    '</svg>';
  }

  // ============================================================
  // 🎯 УРОВНИ (Level system)
  // ============================================================
  var LEVELS = [
    { name: 'Bronze',   min: 0,    max: 500,  icon: '🥉', color: '#cd7f32', next: 500 },
    { name: 'Silver',   min: 500,  max: 2000, icon: '🥈', color: '#c0c0c0', next: 2000 },
    { name: 'Gold',     min: 2000, max: 5000, icon: '🥇', color: '#ffd700', next: 5000 },
    { name: 'Platinum', min: 5000, max: Infinity, icon: '💎', color: '#e5e4e2', next: Infinity }
  ];

  function getLevel(totalNC) {
    for (var i = 0; i < LEVELS.length; i++) {
      if (totalNC >= LEVELS[i].min && totalNC < LEVELS[i].max) return LEVELS[i];
    }
    return LEVELS[LEVELS.length - 1];
  }

  // ============================================================
  // 🎯 Подсчёт общего NC
  // ============================================================
  function getTotalNC() {
    if (typeof window.NC_BONUS !== 'object') return 0;
    var history = window.NC_BONUS.history() || [];
    return history.reduce(function (sum, e) { return sum + (Number(e.amount) || 0); }, 0);
  }

  // ============================================================
  // 🎯 Инжект CSS
  // ============================================================
  function injectCSS() {
    if (document.getElementById('ncBonusStyles')) return;
    var style = document.createElement('style');
    style.id = 'ncBonusStyles';
    style.textContent = `
      /* ===== NC badge в шапке ===== */
      .nc-badge {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 7px 14px;
        background: linear-gradient(135deg, rgba(245,158,11,.15), rgba(236,72,153,.12));
        border: 1px solid rgba(245,158,11,.4);
        border-radius: 999px;
        color: #f59e0b;
        font-weight: 800;
        font-size: .82rem;
        cursor: pointer;
        transition: all .25s cubic-bezier(.34,1.56,.64,1);
        position: relative;
        user-select: none;
      }
      .nc-badge:hover {
        transform: translateY(-2px) scale(1.03);
        box-shadow: 0 10px 24px -8px rgba(245,158,11,.6);
        background: linear-gradient(135deg, rgba(245,158,11,.25), rgba(236,72,153,.2));
      }
      .nc-badge-icon {
        font-size: 1rem;
        animation: ncCoinSpin 3s linear infinite;
      }
      @keyframes ncCoinSpin {
        0% { transform: rotateY(0deg); }
        100% { transform: rotateY(360deg); }
      }
      .nc-badge-amount {
        font-family: ui-monospace, monospace;
        color: #fff;
        font-size: .88rem;
      }
      .nc-badge-level {
        font-size: .68rem;
        opacity: .8;
        padding: 2px 6px;
        background: rgba(255,255,255,.08);
        border-radius: 6px;
      }

      /* ===== Rewards card on dashboard ===== */
      .nc-rewards-card {
        background:
          radial-gradient(500px 250px at 100% 0%, rgba(245,158,11,.15), transparent 60%),
          linear-gradient(145deg, rgba(16,23,36,.96), rgba(9,14,23,.96));
        border: 1px solid rgba(245,158,11,.25);
        border-radius: 20px;
        padding: 24px;
        box-shadow: 0 20px 50px -20px rgba(245,158,11,.4);
        position: relative;
        overflow: hidden;
        margin-top: 24px;
      }
      .nc-rewards-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        margin-bottom: 20px;
      }
      .nc-rewards-kicker {
        font-size: .68rem;
        color: #f59e0b;
        text-transform: uppercase;
        letter-spacing: 1.5px;
        font-weight: 800;
        margin-bottom: 6px;
      }
      .nc-rewards-title {
        font-size: 1.4rem;
        font-weight: 800;
        color: #fff;
        margin: 0;
      }
      .nc-rewards-icon {
        width: 56px;
        height: 56px;
        border-radius: 16px;
        background: linear-gradient(135deg, #f59e0b, #ec4899);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 1.6rem;
        box-shadow: 0 12px 30px -10px rgba(245,158,11,.6);
        animation: ncRewardsPulse 3s ease-in-out infinite;
      }
      @keyframes ncRewardsPulse {
        0%, 100% { transform: scale(1); }
        50% { transform: scale(1.08); }
      }
      .nc-rewards-balance {
        display: flex;
        align-items: baseline;
        gap: 12px;
        margin-bottom: 20px;
      }
      .nc-rewards-count {
        font-size: 2.5rem;
        font-weight: 800;
        font-family: ui-monospace, monospace;
        background: linear-gradient(110deg, #fff, #f59e0b 60%, #ec4899);
        -webkit-background-clip: text;
        background-clip: text;
        color: transparent;
        letter-spacing: -0.03em;
      }
      .nc-rewards-unit {
        font-size: 1rem;
        color: #8b95a5;
        font-weight: 700;
      }
      .nc-rewards-level {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 6px 12px;
        background: rgba(255,255,255,.05);
        border: 1px solid currentColor;
        border-radius: 999px;
        font-size: .78rem;
        font-weight: 800;
      }
      .nc-rewards-progress {
        margin-top: 16px;
      }
      .nc-rewards-progress-label {
        display: flex;
        justify-content: space-between;
        font-size: .72rem;
        color: #8b95a5;
        margin-bottom: 8px;
      }
      .nc-rewards-progress-bar {
        height: 8px;
        background: rgba(255,255,255,.06);
        border-radius: 4px;
        overflow: hidden;
      }
      .nc-rewards-progress-fill {
        height: 100%;
        background: linear-gradient(90deg, #f59e0b, #ec4899);
        border-radius: 4px;
        transition: width .8s cubic-bezier(.34,1.56,.64,1);
        box-shadow: 0 0 16px rgba(245,158,11,.6);
      }
      .nc-rewards-actions {
        display: flex;
        gap: 10px;
        margin-top: 20px;
      }
      .nc-rewards-btn {
        flex: 1;
        padding: 12px 18px;
        border: none;
        border-radius: 12px;
        font-weight: 800;
        font-size: .85rem;
        cursor: pointer;
        font-family: inherit;
        transition: all .25s cubic-bezier(.34,1.56,.64,1);
      }
      .nc-rewards-btn-primary {
        background: linear-gradient(135deg, #f59e0b, #ec4899);
        color: #fff;
        box-shadow: 0 10px 24px -8px rgba(245,158,11,.6);
      }
      .nc-rewards-btn-primary:hover {
        transform: translateY(-2px);
        box-shadow: 0 14px 30px -8px rgba(245,158,11,.8);
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

      /* ===== Bonus history modal ===== */
      .nc-bonus-modal {
        position: fixed;
        inset: 0;
        background: rgba(3,6,11,.9);
        backdrop-filter: blur(20px);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 99999;
        padding: 20px;
        opacity: 0;
        transition: opacity .3s ease;
      }
      .nc-bonus-modal.nc-on { opacity: 1; }
      .nc-bonus-card {
        width: 100%;
        max-width: 560px;
        max-height: 90vh;
        background: linear-gradient(165deg, #0f1720 0%, #0a0e15 100%);
        border: 1px solid rgba(245,158,11,.3);
        border-radius: 24px;
        padding: 32px 28px 24px;
        color: #e7edf5;
        position: relative;
        overflow: hidden;
        box-shadow: 0 40px 100px -20px rgba(0,0,0,.9),
          0 0 80px -20px rgba(245,158,11,.3);
        transform: translateY(20px) scale(.96);
        transition: transform .4s cubic-bezier(.34,1.56,.64,1);
        display: flex;
        flex-direction: column;
      }
      .nc-bonus-modal.nc-on .nc-bonus-card {
        transform: translateY(0) scale(1);
      }
      .nc-bonus-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        margin-bottom: 20px;
      }
      .nc-bonus-title {
        font-size: 1.5rem;
        font-weight: 800;
        background: linear-gradient(100deg, #fff, #f59e0b);
        -webkit-background-clip: text;
        background-clip: text;
        color: transparent;
        margin: 0 0 4px;
      }
      .nc-bonus-sub {
        font-size: .82rem;
        color: #8b95a5;
      }
      .nc-bonus-close {
        width: 36px;
        height: 36px;
        border-radius: 10px;
        background: rgba(255,255,255,.04);
        border: 1px solid rgba(255,255,255,.08);
        color: #8b95a5;
        font-size: 20px;
        cursor: pointer;
        font-family: inherit;
        transition: all .2s;
      }
      .nc-bonus-close:hover {
        background: rgba(255,84,112,.15);
        border-color: rgba(255,84,112,.4);
        color: #ff5470;
      }
      .nc-bonus-stats {
        display: grid;
        grid-template-columns: 1fr 1fr 1fr;
        gap: 10px;
        margin-bottom: 20px;
      }
      .nc-bonus-stat {
        padding: 14px;
        background: rgba(245,158,11,.06);
        border: 1px solid rgba(245,158,11,.15);
        border-radius: 12px;
        text-align: center;
      }
      .nc-bonus-stat-label {
        font-size: .68rem;
        color: #8b95a5;
        text-transform: uppercase;
        letter-spacing: 1px;
        margin-bottom: 4px;
        font-weight: 700;
      }
      .nc-bonus-stat-value {
        font-size: 1.15rem;
        font-weight: 800;
        color: #f59e0b;
        font-family: ui-monospace, monospace;
      }
      .nc-bonus-list {
        flex: 1;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-bottom: 16px;
        padding-right: 4px;
      }
      .nc-bonus-list::-webkit-scrollbar { width: 6px; }
      .nc-bonus-list::-webkit-scrollbar-thumb {
        background: rgba(245,158,11,.3);
        border-radius: 3px;
      }
      .nc-bonus-item {
        display: flex;
        align-items: center;
        gap: 14px;
        padding: 14px 16px;
        background: rgba(255,255,255,.03);
        border: 1px solid rgba(255,255,255,.06);
        border-radius: 12px;
        transition: all .2s;
      }
      .nc-bonus-item:hover {
        background: rgba(245,158,11,.06);
        border-color: rgba(245,158,11,.25);
        transform: translateX(4px);
      }
      .nc-bonus-item-icon {
        width: 42px;
        height: 42px;
        border-radius: 12px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 1.3rem;
        flex-shrink: 0;
        background: linear-gradient(135deg, rgba(245,158,11,.15), rgba(236,72,153,.15));
        border: 1px solid rgba(245,158,11,.25);
      }
      .nc-bonus-item-body { flex: 1; min-width: 0; }
      .nc-bonus-item-label {
        font-weight: 700;
        font-size: .9rem;
        color: #fff;
        margin-bottom: 3px;
      }
      .nc-bonus-item-time {
        font-size: .72rem;
        color: #7c9cbb;
      }
      .nc-bonus-item-amount {
        font-family: ui-monospace, monospace;
        font-size: 1rem;
        font-weight: 800;
        color: #10b981;
        text-shadow: 0 0 20px rgba(16,185,129,.4);
        flex-shrink: 0;
      }
      .nc-bonus-empty {
        text-align: center;
        padding: 60px 20px;
        color: #7c9cbb;
      }
      .nc-bonus-empty-icon {
        font-size: 3rem;
        margin-bottom: 12px;
        opacity: .5;
      }

      @media (max-width: 540px) {
        .nc-bonus-card { padding: 24px 20px 20px; }
        .nc-bonus-stats { grid-template-columns: 1fr; }
        .nc-bonus-list { max-height: 50vh; }
      }
    `;
    document.head.appendChild(style);
  }

  // ============================================================
  // 🎯 Эмодзи для типа бонуса
  // ============================================================
  function getBonusIcon(type) {
    var icons = {
      welcome: '🎁',
      minor: '🐛',
      medium: '⚡',
      major: '💥',
      critical: '🚨',
      bug: '🐞',
      loyalty: '🔥',
      referral: '👥',
      firstDeposit: '💰',
      firstTrade: '📈',
      kycBonus: '🪪',
      bigDeposit: '💎'
    };
    return icons[type] || '🎁';
  }

  // ============================================================
  // 🎯 NC badge в шапке
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

    // Вставляем перед notifBell
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
    var total = getTotalNC();
    var level = getLevel(total);
    var amtEl = badge.querySelector('.nc-badge-amount');
    var lvlEl = badge.querySelector('.nc-badge-level');
    if (amtEl) amtEl.textContent = total + ' NC';
    if (lvlEl) {
      lvlEl.textContent = level.icon + ' ' + level.name;
      lvlEl.style.color = level.color;
    }
  }

  // ============================================================
  // 🎯 Rewards card на dashboard
  // ============================================================
  function injectRewardsCard() {
    if (document.getElementById('ncRewardsCard')) return;

    var dash = document.getElementById('dash');
    if (!dash) return;

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
        '<div class="nc-rewards-icon">🪙</div>' +
      '</div>' +
      '<div class="nc-rewards-balance">' +
        '<span class="nc-rewards-count">' + total + '</span>' +
        '<span class="nc-rewards-unit">NC</span>' +
        '<span class="nc-rewards-level" style="color:' + level.color + '">' +
          level.icon + ' ' + level.name +
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
        '<button class="nc-rewards-btn nc-rewards-btn-ghost" onclick="window.__ncReportBug && window.__ncReportBug()">' +
          '🐞 Report bug (+50 NC)' +
        '</button>' +
      '</div>';

    // Вставляем после последней секции в dashboard
    var lastSection = dash.querySelector('.nc3-bottom-row');
    if (lastSection && lastSection.parentNode) {
      lastSection.parentNode.insertBefore(card, lastSection.nextSibling);
    } else {
      dash.appendChild(card);
    }
  }

  // ============================================================
  // 🎯 Модалка Bonus History
  // ============================================================
  function openBonusModal() {
    var existing = document.querySelector('.nc-bonus-modal');
    if (existing) existing.remove();

    injectCSS();
    var history = (typeof window.NC_BONUS === 'object') ? window.NC_BONUS.history() : [];
    var total = history.reduce(function (s, e) { return s + (Number(e.amount) || 0); }, 0);
    var level = getLevel(total);

    // Группируем по типу для статистики
    var byType = {};
    history.forEach(function (e) {
      byType[e.type] = (byType[e.type] || 0) + (Number(e.amount) || 0);
    });

    var today = new Date().toISOString().slice(0, 10);
    var todayEarned = history
      .filter(function (e) { return e.day === today; })
      .reduce(function (s, e) { return s + (Number(e.amount) || 0); }, 0);

    var itemsHtml = '';
    if (history.length === 0) {
      itemsHtml =
        '<div class="nc-bonus-empty">' +
          '<div class="nc-bonus-empty-icon">🎁</div>' +
          '<div>No bonuses yet</div>' +
          '<div style="margin-top:8px;font-size:.8rem;color:#5a6673">' +
            'Sign in daily, make deposits, trade, or report bugs to earn NC' +
          '</div>' +
        '</div>';
    } else {
      history.forEach(function (e) {
        var d = new Date(e.ts);
        var dateStr = d.toLocaleDateString('en-GB', {
          day: '2-digit', month: 'short', year: 'numeric'
        }) + ' · ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
        itemsHtml +=
          '<div class="nc-bonus-item">' +
            '<div class="nc-bonus-item-icon">' + getBonusIcon(e.type) + '</div>' +
            '<div class="nc-bonus-item-body">' +
              '<div class="nc-bonus-item-label">' + (e.label || e.type) + '</div>' +
              '<div class="nc-bonus-item-time">' + dateStr + '</div>' +
            '</div>' +
            '<div class="nc-bonus-item-amount">+' + (e.amount || 0) + ' NC</div>' +
          '</div>';
      });
    }

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
            '<div class="nc-bonus-stat-value" style="color:' + level.color + '">' +
              level.icon + ' ' + level.name +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="nc-bonus-list">' + itemsHtml + '</div>' +
      '</div>';

    document.body.appendChild(modal);
    requestAnimationFrame(function () { modal.classList.add('nc-on'); });
    modal.onclick = function (e) {
      if (e.target === modal) window.__ncCloseBonusModal();
    };
  }

  window.__ncOpenBonusModal = openBonusModal;
  window.__ncCloseBonusModal = function () {
    var m = document.querySelector('.nc-bonus-modal');
    if (m) {
      m.classList.remove('nc-on');
      setTimeout(function () { m.remove(); }, 300);
    }
  };

  // ============================================================
  // 🎯 Hook into notifications при новом бонусе
  // ============================================================
  document.addEventListener('nc:bonus:granted', function (ev) {
    var d = ev.detail || {};
    var amount = d.amount || 0;
    var label = d.label || d.type || 'Bonus';

    // Перерисовываем UI
    updateBadge();
    if (document.getElementById('ncRewardsCard')) {
      document.getElementById('ncRewardsCard').remove();
      injectRewardsCard();
    }

    // Добавляем в notifications (если функция есть)
    if (typeof window.addNotification === 'function') {
      window.addNotification('+' + amount + ' NC — ' + label, getBonusIcon(d.type));
    }

    // Анимация badge — pulse
    var badge = document.getElementById('ncBadge');
    if (badge) {
      badge.style.animation = 'none';
      void badge.offsetWidth;
      badge.style.animation = 'ncBadgePulse 0.6s ease';
    }
  });

  // ============================================================
  // 🎯 Hook Report Bug
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
      if (typeof window.toast === 'function') {
        window.toast('🐞 Bug reported! Thank you.');
      }
      // Отправляем в чат админу
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
  // 🎯 Hook into deposit success — firstDeposit bonus
  // ============================================================
  document.addEventListener('nc:deposit:confirmed', function () {
    if (typeof window.NC_BONUS === 'object' &&
        typeof window.NC_BONUS.grantFirstDeposit === 'function') {
      window.NC_BONUS.grantFirstDeposit();
    }
  });

  // ============================================================
  // 🎯 Точка входа — ждём пока dashboard отрисуется
  // ============================================================
  function init() {
    injectCSS();

    // Первая попытка — сразу
    injectBadge();
    injectRewardsCard();

    // Повтор через 1.5 сек — если dashboard ещё не отрисован
    setTimeout(function () {
      injectBadge();
      injectRewardsCard();
    }, 1500);

    // Ещё раз через 4 сек — на случай поздней отрисовки
    setTimeout(function () {
      injectBadge();
      injectRewardsCard();
    }, 4000);

    console.log('%c[NordicCrypto] 🎁 bonus-ui.js v' + BUI_VERSION + ' loaded',
      'color:#f59e0b;font-weight:bold;font-size:13px');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Обновление при логине
  document.addEventListener('nc:auth:login', function () {
    setTimeout(function () {
      injectBadge();
      injectRewardsCard();
    }, 2000);
  });

  // Экспорт API
  window.__ncBonusUI = {
    updateBadge: updateBadge,
    injectBadge: injectBadge,
    injectRewardsCard: injectRewardsCard,
    openModal: openBonusModal,
    getTotalNC: getTotalNC,
    getLevel: getLevel,
    levels: LEVELS
  };

})();
