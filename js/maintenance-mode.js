/* ============================================================
   NORDIC CRYPTO — MAINTENANCE MODE v3.0 (PRODUCTION)
   ============================================================
   Профессиональный экран обновления + жёсткая блокировка.
   Активация: кнопка "Push Update" в админке.
   Деактивация: автоматически через N мин ИЛИ вручную.
   ============================================================ */

(function () {
  'use strict';

  var MM_VERSION = '3.0.0';
  var STORAGE_KEY = 'nc_maintenance';

  // ============================================================
  // API
  // ============================================================
  function get() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (data.until && Date.now() > data.until) {
        localStorage.removeItem(STORAGE_KEY);
        return null;
      }
      return data;
    } catch (e) { return null; }
  }

  function isActive() { return !!get(); }

  async function activate(opts) {
    opts = opts || {};
    var duration = opts.duration || (5 * 60 * 1000);
    var message = opts.message || 'We are upgrading NordicCrypto with new features and security improvements.';
    var version = opts.version || '5.0.0';

    var data = {
      started: Date.now(),
      until: Date.now() + duration,
      message: message,
      version: version,
      byAdmin: opts.byAdmin || 'admin'
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));

    try {
      var token = localStorage.getItem('session_token');
      var WORKER = window.WORKER_URL || 'https://nordic-deposit-checker.otis-790.workers.dev';
      if (token) {
        await fetch(WORKER + '?action=setMaintenance', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token: token, active: true,
            duration: duration, message: message, version: version
          })
        });
      }
    } catch (e) {}

    try {
      new BroadcastChannel('nc_maintenance').postMessage({ type: 'activated', data: data });
    } catch (e) {}

    return data;
  }

  async function deactivate() {
    localStorage.removeItem(STORAGE_KEY);
    try {
      var token = localStorage.getItem('session_token');
      var WORKER = window.WORKER_URL || 'https://nordic-deposit-checker.otis-790.workers.dev';
      if (token) {
        await fetch(WORKER + '?action=setMaintenance', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: token, active: false })
        });
      }
    } catch (e) {}
    try {
      new BroadcastChannel('nc_maintenance').postMessage({ type: 'deactivated' });
    } catch (e) {}
    hideScreen();
  }

  // ============================================================
  // Проверка — залогинен ли клиент (не админ)
  // ============================================================
  function isLoggedInClient() {
    var email = localStorage.getItem('user_email') || '';
    var role = localStorage.getItem('user_role') || '';
    if (!email) return false;
    if (role === 'admin') return false;
    if (email === 'admin@nordiccrypto.com') return false;
    return true;
  }

  // ============================================================
  // Профессиональный экран
  // ============================================================
  function showScreen(data) {
    if (document.getElementById('ncMaintenanceScreen')) return;

    // Админ всегда проходит
    var role = localStorage.getItem('user_role') || '';
    var email = localStorage.getItem('user_email') || '';
    if (role === 'admin' || email === 'admin@nordiccrypto.com') return;

    // Уже залогиненные клиенты — только баннер
    if (isLoggedInClient()) {
      showBanner(data);
      return;
    }

    // Новые входы — полный экран
    injectCSS();
    var screen = document.createElement('div');
    screen.id = 'ncMaintenanceScreen';
    screen.innerHTML = buildHTML(data);
    document.body.appendChild(screen);
    requestAnimationFrame(function () { screen.classList.add('nc-on'); });

    // Блокируем login/register формы
    blockLoginForms();

    startCountdown(data.until);

    var iv = setInterval(function () {
      if (!isActive()) {
        clearInterval(iv);
        hideScreen();
        unblockLoginForms();
        if (typeof window.toast === 'function') {
          window.toast('✅ Update complete. You can now sign in.');
        }
      }
    }, 3000);
  }

  function hideScreen() {
    var s = document.getElementById('ncMaintenanceScreen');
    if (s) {
      s.classList.remove('nc-on');
      setTimeout(function () { s.remove(); }, 400);
    }
    var b = document.getElementById('ncMaintenanceBanner');
    if (b) b.remove();
    unblockLoginForms();
  }

  function blockLoginForms() {
    // Скрываем форму логина и signup
    var loginForm = document.getElementById('loginForm');
    if (loginForm) loginForm.style.visibility = 'hidden';
    var signupMask = document.getElementById('signupMask');
    if (signupMask) signupMask.classList.remove('on');
  }

  function unblockLoginForms() {
    var loginForm = document.getElementById('loginForm');
    if (loginForm) loginForm.style.visibility = 'visible';
  }

  function showBanner(data) {
    if (document.getElementById('ncMaintenanceBanner')) return;
    injectCSS();
    var until = new Date(data.until);
    var minutesLeft = Math.max(0, Math.round((data.until - Date.now()) / 60000));
    var b = document.createElement('div');
    b.id = 'ncMaintenanceBanner';
    b.className = 'nc-mm-banner';
    b.innerHTML =
      '<div class="nc-mm-banner-icon">⚙️</div>' +
      '<div class="nc-mm-banner-body">' +
        '<div class="nc-mm-banner-title">System update in progress</div>' +
        '<div class="nc-mm-banner-text">Some features may be temporarily unavailable. We\'ll be back in ~' + minutesLeft + ' min.</div>' +
      '</div>' +
      '<button class="nc-mm-banner-close" onclick="this.parentNode.remove()">×</button>';
    document.body.appendChild(b);
  }

  function startCountdown(untilTs) {
    var el = document.getElementById('ncMmCountdown');
    if (!el) return;
    (function tick() {
      var left = untilTs - Date.now();
      if (left <= 0) { el.textContent = '00:00'; hideScreen(); return; }
      var min = Math.floor(left / 60000);
      var sec = Math.floor((left % 60000) / 1000);
      el.textContent = String(min).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
      setTimeout(tick, 1000);
    })();
  }

  function buildHTML(data) {
    return '' +
      '<div class="nc-mm-bg"></div>' +
      '<div class="nc-mm-content">' +
        '<div class="nc-mm-brand">' +
          '<div class="nc-mm-brand-icon">⚙️</div>' +
          '<div class="nc-mm-brand-text">Nordic<span>Crypto</span></div>' +
        '</div>' +
        '<div class="nc-mm-status">' +
          '<div class="nc-mm-status-dot"></div>' +
          '<span>System maintenance</span>' +
        '</div>' +
        '<h1 class="nc-mm-title">We\'ll be right back</h1>' +
        '<p class="nc-mm-sub">' + esc(data.message) + '</p>' +
        '<div class="nc-mm-illustration">' +
          '<div class="nc-mm-orbit">' +
            '<div class="nc-mm-orbit-ring"></div>' +
            '<div class="nc-mm-orbit-ring nc-mm-orbit-ring-2"></div>' +
            '<div class="nc-mm-orbit-core">' +
              '<svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
                '<path d="M12 2L2 7l10 5 10-5-10-5z"/>' +
                '<path d="M2 17l10 5 10-5"/>' +
                '<path d="M2 12l10 5 10-5"/>' +
              '</svg>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="nc-mm-progress-wrap">' +
          '<div class="nc-mm-progress-bar"><div class="nc-mm-progress-fill"></div></div>' +
          '<div class="nc-mm-progress-meta">' +
            '<span>Deploying <b>v' + esc(data.version) + '</b></span>' +
            '<span class="nc-mm-countdown"><span id="ncMmCountdown">--:--</span> left</span>' +
          '</div>' +
        '</div>' +
        '<div class="nc-mm-checklist">' +
          '<div class="nc-mm-check nc-mm-check-done">' +
            '<span class="nc-mm-check-icon">✓</span>' +
            '<div><b>Database migration</b><span>Completed</span></div>' +
          '</div>' +
          '<div class="nc-mm-check nc-mm-check-active">' +
            '<span class="nc-mm-check-icon"><span class="nc-mm-spinner-dot"></span></span>' +
            '<div><b>Deploying new code</b><span>In progress</span></div>' +
          '</div>' +
          '<div class="nc-mm-check">' +
            '<span class="nc-mm-check-icon">3</span>' +
            '<div><b>Cache refresh</b><span>Pending</span></div>' +
          '</div>' +
          '<div class="nc-mm-check">' +
            '<span class="nc-mm-check-icon">4</span>' +
            '<div><b>Health check</b><span>Pending</span></div>' +
          '</div>' +
        '</div>' +
        '<div class="nc-mm-trust">' +
          '<div class="nc-mm-trust-item">' +
            '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>' +
            '<span>Your funds are safe</span>' +
          '</div>' +
          '<div class="nc-mm-trust-item">' +
            '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>' +
            '<span>No data will be lost</span>' +
          '</div>' +
        '</div>' +
        '<div class="nc-mm-footer">' +
          '<button class="nc-mm-retry" onclick="location.reload()">' +
            '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10"/><path d="M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>' +
            'Check again' +
          '</button>' +
          '<div class="nc-mm-support">Questions? <a href="mailto:support@nordiccrypto.com">Contact support</a></div>' +
        '</div>' +
      '</div>';
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function injectCSS() {
    if (document.getElementById('ncMmStyles')) return;
    var style = document.createElement('style');
    style.id = 'ncMmStyles';
    style.textContent = `
      #ncMaintenanceScreen {
        position: fixed; inset: 0; z-index: 999999;
        display: flex; align-items: center; justify-content: center;
        opacity: 0; transition: opacity .5s ease;
        padding: 24px; overflow-y: auto;
        font-family: -apple-system, 'Segoe UI', Roboto, sans-serif;
      }
      #ncMaintenanceScreen.nc-on { opacity: 1; }

      .nc-mm-bg {
        position: absolute; inset: 0;
        background:
          radial-gradient(900px 600px at 20% 10%, rgba(0,229,255,.14), transparent 60%),
          radial-gradient(800px 600px at 80% 90%, rgba(139,92,246,.18), transparent 60%),
          linear-gradient(135deg, #060912 0%, #0a0f1a 100%);
      }
      .nc-mm-bg::before {
        content: ''; position: absolute; inset: 0;
        background-image:
          radial-gradient(2px 2px at 15% 25%, rgba(0,229,255,.4), transparent),
          radial-gradient(2px 2px at 85% 70%, rgba(139,92,246,.4), transparent),
          radial-gradient(1.5px 1.5px at 40% 80%, rgba(236,72,153,.35), transparent),
          radial-gradient(1px 1px at 70% 15%, rgba(0,229,255,.3), transparent);
        animation: ncMmFloat 25s ease-in-out infinite alternate;
      }
      @keyframes ncMmFloat {
        0%   { transform: translate(0, 0); opacity: .7; }
        100% { transform: translate(-30px, -20px); opacity: 1; }
      }

      .nc-mm-content {
        position: relative; z-index: 1;
        max-width: 520px; width: 100%;
        text-align: center;
        animation: ncMmIn .7s cubic-bezier(.34,1.56,.64,1);
      }
      @keyframes ncMmIn {
        from { opacity: 0; transform: translateY(30px) scale(.95); }
        to   { opacity: 1; transform: translateY(0) scale(1); }
      }

      .nc-mm-brand {
        display: inline-flex; align-items: center; gap: 12px;
        margin-bottom: 24px;
        font-size: 1.5rem; font-weight: 800;
      }
      .nc-mm-brand-icon {
        width: 52px; height: 52px; border-radius: 15px;
        background: linear-gradient(135deg, #00e5ff, #8b5cf6);
        display: flex; align-items: center; justify-content: center;
        font-size: 26px;
        animation: ncMmIconSpin 4s linear infinite;
        box-shadow: 0 12px 30px -8px rgba(0,229,255,.6);
      }
      @keyframes ncMmIconSpin {
        0%, 100% { transform: rotate(0deg); }
        50%      { transform: rotate(180deg); }
      }
      .nc-mm-brand-text {
        color: #fff;
        background: linear-gradient(90deg, #F8FAFC 0%, #00D4FF 25%, #A855F7 50%, #00D4FF 75%, #F8FAFC 100%);
        background-size: 200% auto;
        -webkit-background-clip: text; background-clip: text;
        -webkit-text-fill-color: transparent;
        animation: ncMmShimmer 5s linear infinite;
      }
      @keyframes ncMmShimmer { to { background-position: -200% center; } }

      .nc-mm-status {
        display: inline-flex; align-items: center; gap: 8px;
        padding: 8px 16px;
        background: rgba(0,229,255,.08);
        border: 1px solid rgba(0,229,255,.25);
        border-radius: 999px;
        font-size: .78rem; color: #7dd3fc;
        font-weight: 700;
        margin-bottom: 20px;
        text-transform: uppercase;
        letter-spacing: 1.2px;
      }
      .nc-mm-status-dot {
        width: 8px; height: 8px; border-radius: 50%;
        background: #00e5ff;
        box-shadow: 0 0 12px #00e5ff;
        animation: ncMmStatusPulse 1.5s ease-in-out infinite;
      }
      @keyframes ncMmStatusPulse {
        0%, 100% { opacity: 1; transform: scale(1); }
        50%      { opacity: .4; transform: scale(1.4); }
      }

      .nc-mm-title {
        font-size: 2.2rem; font-weight: 800;
        letter-spacing: -.03em;
        color: #fff;
        margin: 0 0 12px;
        line-height: 1.15;
      }
      .nc-mm-sub {
        font-size: 1rem; color: #94a3b8;
        line-height: 1.6;
        margin: 0 0 32px;
        max-width: 420px; margin-left: auto; margin-right: auto;
      }

      /* Orbit animation */
      .nc-mm-illustration {
        position: relative;
        height: 140px;
        margin-bottom: 32px;
        display: flex; align-items: center; justify-content: center;
      }
      .nc-mm-orbit {
        position: relative;
        width: 120px; height: 120px;
      }
      .nc-mm-orbit-ring {
        position: absolute; inset: 0;
        border-radius: 50%;
        border: 1.5px dashed rgba(0,229,255,.4);
        animation: ncMmOrbit 8s linear infinite;
      }
      .nc-mm-orbit-ring-2 {
        inset: 20px;
        border-color: rgba(139,92,246,.5);
        animation-duration: 5s;
        animation-direction: reverse;
      }
      @keyframes ncMmOrbit { to { transform: rotate(360deg); } }
      .nc-mm-orbit-core {
        position: absolute; inset: 30px;
        border-radius: 50%;
        background: linear-gradient(135deg, #00e5ff, #8b5cf6);
        display: flex; align-items: center; justify-content: center;
        box-shadow: 0 20px 40px -10px rgba(0,229,255,.6), inset 0 1px 0 rgba(255,255,255,.3);
        animation: ncMmCorePulse 3s ease-in-out infinite;
      }
      @keyframes ncMmCorePulse {
        0%, 100% { transform: scale(1); box-shadow: 0 20px 40px -10px rgba(0,229,255,.6), inset 0 1px 0 rgba(255,255,255,.3); }
        50%      { transform: scale(1.06); box-shadow: 0 25px 50px -10px rgba(0,229,255,.9), inset 0 1px 0 rgba(255,255,255,.3); }
      }

      /* Progress */
      .nc-mm-progress-wrap {
        background: rgba(255,255,255,.03);
        border: 1px solid rgba(255,255,255,.06);
        border-radius: 14px;
        padding: 16px 18px;
        margin-bottom: 20px;
      }
      .nc-mm-progress-bar {
        height: 6px;
        background: rgba(255,255,255,.06);
        border-radius: 3px;
        overflow: hidden;
        margin-bottom: 10px;
      }
      .nc-mm-progress-fill {
        height: 100%; width: 0;
        background: linear-gradient(90deg, #00e5ff, #8b5cf6, #ec4899);
        border-radius: 3px;
        animation: ncMmProgress 30s ease-out forwards;
        box-shadow: 0 0 12px rgba(0,229,255,.6);
      }
      @keyframes ncMmProgress { 0% { width: 5%; } 100% { width: 95%; } }
      .nc-mm-progress-meta {
        display: flex; justify-content: space-between;
        font-size: .78rem;
        color: #64748b;
      }
      .nc-mm-progress-meta b { color: #00e5ff; }
      .nc-mm-countdown {
        font-family: ui-monospace, monospace;
        color: #94a3b8;
      }
      .nc-mm-countdown span { color: #fff; font-weight: 700; }

      /* Checklist */
      .nc-mm-checklist {
        display: flex; flex-direction: column; gap: 8px;
        padding: 16px;
        background: rgba(255,255,255,.02);
        border: 1px solid rgba(255,255,255,.05);
        border-radius: 14px;
        margin-bottom: 24px;
        text-align: left;
      }
      .nc-mm-check {
        display: flex; align-items: center; gap: 14px;
        padding: 10px 12px;
        border-radius: 10px;
        background: rgba(255,255,255,.02);
        opacity: .55;
        transition: all .3s ease;
      }
      .nc-mm-check-done { opacity: 1; background: rgba(16,185,129,.06); }
      .nc-mm-check-active {
        opacity: 1;
        background: rgba(0,229,255,.06);
        border: 1px solid rgba(0,229,255,.2);
      }
      .nc-mm-check-icon {
        width: 30px; height: 30px; border-radius: 50%;
        display: flex; align-items: center; justify-content: center;
        font-size: 13px; font-weight: 800;
        flex-shrink: 0;
        background: rgba(255,255,255,.05);
        color: #94a3b8;
      }
      .nc-mm-check-done .nc-mm-check-icon {
        background: rgba(16,185,129,.15);
        color: #10b981;
        border: 1px solid rgba(16,185,129,.4);
      }
      .nc-mm-check-active .nc-mm-check-icon {
        background: rgba(0,229,255,.15);
        color: #00e5ff;
        border: 1px solid rgba(0,229,255,.4);
      }
      .nc-mm-check div b {
        display: block;
        font-size: .88rem;
        color: #fff;
        font-weight: 700;
        margin-bottom: 2px;
      }
      .nc-mm-check div span {
        display: block;
        font-size: .72rem;
        color: #64748b;
      }
      .nc-mm-check-done div span { color: #10b981; }
      .nc-mm-check-active div span { color: #00e5ff; }

      .nc-mm-spinner-dot {
        width: 12px; height: 12px;
        border: 2px solid rgba(0,229,255,.2);
        border-top-color: #00e5ff;
        border-radius: 50%;
        animation: ncMmSpin 1s linear infinite;
      }
      @keyframes ncMmSpin { to { transform: rotate(360deg); } }

      /* Trust */
      .nc-mm-trust {
        display: flex; justify-content: center; gap: 24px;
        margin-bottom: 24px;
        flex-wrap: wrap;
      }
      .nc-mm-trust-item {
        display: flex; align-items: center; gap: 8px;
        font-size: .82rem;
        color: #94a3b8;
        font-weight: 600;
      }
      .nc-mm-trust-item svg { color: #10b981; }

      /* Footer */
      .nc-mm-footer {
        display: flex; flex-direction: column;
        align-items: center; gap: 16px;
      }
      .nc-mm-retry {
        display: inline-flex; align-items: center; gap: 8px;
        padding: 14px 28px;
        border-radius: 14px;
        border: 1px solid rgba(0,229,255,.3);
        background: rgba(0,229,255,.08);
        color: #00e5ff;
        font-size: .9rem; font-weight: 700;
        cursor: pointer;
        font-family: inherit;
        transition: all .3s cubic-bezier(.34,1.56,.64,1);
      }
      .nc-mm-retry:hover {
        background: rgba(0,229,255,.15);
        transform: translateY(-2px);
        box-shadow: 0 12px 30px -10px rgba(0,229,255,.5);
      }
      .nc-mm-support {
        font-size: .78rem;
        color: #64748b;
      }
      .nc-mm-support a {
        color: #00e5ff;
        text-decoration: none;
        font-weight: 600;
      }
      .nc-mm-support a:hover { text-decoration: underline; }

      /* Banner для залогиненных */
      .nc-mm-banner {
        position: fixed; top: 80px; right: 20px;
        max-width: 380px; z-index: 99998;
        display: flex; gap: 12px;
        padding: 16px;
        background: linear-gradient(135deg, rgba(245,158,11,.15), rgba(239,68,68,.1));
        border: 1px solid rgba(245,158,11,.35);
        border-radius: 14px;
        box-shadow: 0 20px 40px -15px rgba(0,0,0,.8);
        backdrop-filter: blur(10px);
        animation: ncMmBannerIn .4s cubic-bezier(.34,1.56,.64,1);
      }
      @keyframes ncMmBannerIn {
        from { opacity: 0; transform: translateX(100%); }
        to   { opacity: 1; transform: translateX(0); }
      }
      .nc-mm-banner-icon { font-size: 24px; flex-shrink: 0; }
      .nc-mm-banner-body { flex: 1; }
      .nc-mm-banner-title { font-weight: 700; color: #fff; font-size: .9rem; margin-bottom: 4px; }
      .nc-mm-banner-text { font-size: .78rem; color: #94a3b8; line-height: 1.4; }
      .nc-mm-banner-close {
        width: 24px; height: 24px; border-radius: 6px;
        border: none; background: rgba(255,255,255,.06);
        color: #94a3b8; cursor: pointer;
        flex-shrink: 0; font-size: 16px; line-height: 1;
      }
      .nc-mm-banner-close:hover { background: rgba(255,84,112,.2); color: #ff5470; }

      @media (max-width: 540px) {
        .nc-mm-title { font-size: 1.6rem; }
        .nc-mm-sub { font-size: .9rem; }
        .nc-mm-brand { font-size: 1.3rem; }
        .nc-mm-brand-icon { width: 44px; height: 44px; font-size: 22px; }
        .nc-mm-banner { top: 70px; right: 12px; left: 12px; max-width: none; }
      }

      @media (prefers-reduced-motion: reduce) {
        .nc-mm-brand-icon, .nc-mm-orbit-ring, .nc-mm-orbit-core,
        .nc-mm-status-dot, .nc-mm-spinner-dot, .nc-mm-progress-fill {
          animation: none !important;
        }
      }
    `;
    document.head.appendChild(style);
  }

  // ============================================================
  // Проверка при загрузке
  // ============================================================
  function autoCheck() {
    var data = get();
    if (data) {
      // Небольшая задержка чтобы app.legacy.js успел отрисовать login
      setTimeout(function () { showScreen(data); }, 300);
      setTimeout(function () { showScreen(data); }, 1500);
    }
  }

  window.__ncMaintenance = {
    version: MM_VERSION,
    isActive: isActive,
    get: get,
    activate: activate,
    deactivate: deactivate,
    show: function () { var d = get(); if (d) showScreen(d); },
    hide: hideScreen
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoCheck);
  } else {
    autoCheck();
  }

  // Синхронизация между вкладками
  try {
    var bc = new BroadcastChannel('nc_maintenance');
    bc.onmessage = function (ev) {
      if (ev.data && ev.data.type === 'activated') {
        var d = get();
        if (d) showScreen(d);
      } else if (ev.data && ev.data.type === 'deactivated') {
        hideScreen();
      }
    };
  } catch (e) {}

  console.log('%c[NordicCrypto] ⚙️ maintenance-mode.js v' + MM_VERSION + ' loaded',
    'color:#8b5cf6;font-weight:bold;font-size:13px');
})();
