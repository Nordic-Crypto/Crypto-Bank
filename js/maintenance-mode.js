/* ============================================================
   NORDIC CRYPTO — MAINTENANCE MODE v6.1 (SSE LIVE)
   ============================================================
   v6.1:
   • ⚡ SSE — мгновенная реакция (<1 сек)
   • ⚡ Без F5 — экран появляется/исчезает сам
   • ⚡ Мгновенный показ из localStorage до ответа сервера
   • 🔄 Fallback polling (15 сек) если SSE недоступен
   • 🔴 Полный экран для всех кроме админа
   ============================================================ */

(function () {
  'use strict';

  var MM_VERSION = '6.1.0';
  var STORAGE_KEY = 'nc_maintenance';
  var FALLBACK_POLL_MS = 15000;
  var _screenShown = false;
  var _lastServerData = null;
  var _eventSource = null;
  var _pollTimer = null;

  function $(id) { return document.getElementById(id); }

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

  function isAdmin() {
    var role = localStorage.getItem('user_role') || '';
    var email = localStorage.getItem('user_email') || '';
    return role === 'admin' || email === 'admin@nordiccrypto.com';
  }

  function getWorker() {
    return window.WORKER_URL || 'https://nordic-deposit-checker.otis-790.workers.dev';
  }

  // ============================================================
  // ACTIVATE / DEACTIVATE (вызывается из админки)
  // ============================================================
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
    try { bcPost({ type: 'activated' }); } catch (e) {}

    try {
      var token = localStorage.getItem('session_token');
      if (token) {
        await fetch(getWorker() + '?action=setMaintenance', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token: token, active: true,
            duration: duration, message: message, version: version
          })
        });
      }
    } catch (e) {}

    return data;
  }

  async function deactivate() {
    localStorage.removeItem(STORAGE_KEY);
    try { bcPost({ type: 'deactivated' }); } catch (e) {}
    try {
      var token = localStorage.getItem('session_token');
      if (token) {
        await fetch(getWorker() + '?action=setMaintenance', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: token, active: false })
        });
      }
    } catch (e) {}
    hideScreen();
  }

  // ============================================================
  // 🖥️ SCREEN
  // ============================================================
  function showScreen(data) {
    if (isAdmin()) return;
    if (_screenShown && $('ncMaintenanceScreen')) return;

    injectCSS();
    var screen = document.createElement('div');
    screen.id = 'ncMaintenanceScreen';
    screen.innerHTML = buildHTML(data);
    document.body.appendChild(screen);
    requestAnimationFrame(function () { screen.classList.add('nc-on'); });

    hideAllUI();
    startCountdown(data.until);
    startProgressUpdate(data);
    _screenShown = true;
  }

  function hideAllUI() {
    var side = $('sideBar');
    var main = $('mainApp');
    var login = $('loginScreen');
    if (side) side.style.display = 'none';
    if (main) main.style.display = 'none';
    if (login) login.style.display = 'none';
    document.querySelectorAll('.mask, .notif-overlay, .dep-verify-overlay, .verify-screen, .onboard, .onb-anim-stage')
      .forEach(function (m) { m.classList.remove('on'); m.style.display = 'none'; });
  }

  function hideScreen() {
    var s = $('ncMaintenanceScreen');
    if (s) {
      s.classList.remove('nc-on');
      setTimeout(function () { s.remove(); }, 400);
    }
    var wasShown = _screenShown;
    _screenShown = false;

    // Возвращаем UI
    var login = $('loginScreen');
    if (login) login.style.display = '';

    if (localStorage.getItem('user_email')) {
      var side = $('sideBar');
      var main = $('mainApp');
      if (side) side.style.display = 'flex';
      if (main) main.style.display = 'flex';
      if (typeof window.render === 'function') {
        try { window.render(); } catch (e) {}
      }
    }

    if (wasShown) {
      if (typeof window.spawnConfetti === 'function') {
        setTimeout(function () { window.spawnConfetti(); }, 200);
      }
      if (typeof window.toast === 'function') {
        window.toast('✅ We\'re back! Thanks for your patience');
      }
    }
  }

  function startCountdown(untilTs) {
    var el = $('ncMmCountdown');
    if (!el) return;
    (function tick() {
      if (!el) return;
      var left = untilTs - Date.now();
      if (left <= 0) { el.textContent = '00:00'; return; }
      var hr = Math.floor(left / 3600000);
      var min = Math.floor((left % 3600000) / 60000);
      var sec = Math.floor((left % 60000) / 1000);
      var txt = hr > 0
        ? (String(hr).padStart(2, '0') + ':' + String(min).padStart(2, '0') + ':' + String(sec).padStart(2, '0'))
        : (String(min).padStart(2, '0') + ':' + String(sec).padStart(2, '0'));
      el.textContent = txt;
      setTimeout(tick, 1000);
    })();
  }

  function startProgressUpdate(data) {
    var totalMs = data.until - data.started;
    if (totalMs <= 0) return;
    function update() {
      var fill = document.querySelector('.nc-mm-progress-fill');
      var pctEl = $('ncMmPercent');
      if (!fill || !pctEl) return;
      var elapsed = Date.now() - data.started;
      var pct = Math.min(95, Math.max(5, (elapsed / totalMs) * 100));
      fill.style.width = pct + '%';
      pctEl.textContent = Math.round(pct) + '%';
      if (pct < 95) setTimeout(update, 1000);
    }
    update();
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
            '<span>Deploying <b>v' + esc(data.version) + '</b> · <span id="ncMmPercent">5%</span></span>' +
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

  // ============================================================
  // ⚡ SSE LIVE — мгновенная реакция
  // ============================================================
  function connectSSE() {
    if (_eventSource) {
      try { _eventSource.close(); } catch (e) {}
      _eventSource = null;
    }

    if (typeof EventSource === 'undefined') {
      console.warn('[maintenance] EventSource not supported — polling only');
      return;
    }

    try {
      var url = getWorker() + '?action=maintenanceStream&_t=' + Date.now();
      _eventSource = new EventSource(url);

      _eventSource.onopen = function () {
        console.log('[maintenance] ⚡ SSE connected');
      };

      _eventSource.onmessage = function (event) {
        try {
          var data = JSON.parse(event.data);
          if (data && data.type === 'status') {
            handleServerStatus(data.maintenance);
          }
        } catch (e) {}
      };

      _eventSource.onerror = function () {
        console.warn('[maintenance] SSE error — reconnect in 3s');
        try { _eventSource.close(); } catch (e) {}
        _eventSource = null;
        setTimeout(connectSSE, 3000);
      };
    } catch (e) {
      console.warn('[maintenance] SSE init failed, polling only');
    }
  }

  function handleServerStatus(maintenance) {
    if (maintenance && maintenance.active) {
      if (maintenance.until && Date.now() > maintenance.until) {
        localStorage.removeItem(STORAGE_KEY);
        if (_screenShown) hideScreen();
        return;
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(maintenance));
      _lastServerData = maintenance;
      showScreen(maintenance);
    } else {
      localStorage.removeItem(STORAGE_KEY);
      _lastServerData = null;
      if (_screenShown) hideScreen();
    }
  }

  // ============================================================
  // 🔄 FALLBACK POLLING
  // ============================================================
  async function checkServer() {
    try {
      var r = await fetch(getWorker() + '?action=getMaintenanceStatus&_t=' + Date.now() + '&_r=' + Math.random(), {
        method: 'GET',
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache'
        }
      });
      var d = await r.json();
      if (d && d.ok && d.maintenance && d.maintenance.active) {
        _lastServerData = d.maintenance;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(d.maintenance));
        return d.maintenance;
      } else {
        _lastServerData = null;
        localStorage.removeItem(STORAGE_KEY);
        return null;
      }
    } catch (e) {
      return _lastServerData;
    }
  }

  function startPolling() {
    if (_pollTimer) clearInterval(_pollTimer);
    _pollTimer = setInterval(function () {
      checkServer().then(function (data) {
        if (data) showScreen(data);
        else if (_screenShown) hideScreen();
      });
    }, FALLBACK_POLL_MS);
  }

  // ============================================================
  // BroadcastChannel — между вкладками
  // ============================================================
  var _bc = null;
  function bcPost(msg) {
    if (_bc) { try { _bc.postMessage(msg); } catch (e) {} }
  }
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      _bc = new BroadcastChannel('nc_maintenance');
      _bc.onmessage = function (ev) {
        if (!ev || !ev.data) return;
        if (ev.data.type === 'activated') {
          var d = get();
          if (d) showScreen(d);
        } else if (ev.data.type === 'deactivated') {
          hideScreen();
        }
      };
    }
  } catch (e) {}

  // ============================================================
  // 🎯 INIT
  // ============================================================
  function autoCheck() {
    // 1. Мгновенно из localStorage — если уже есть, показываем сразу
    var local = get();
    if (local && !isAdmin()) showScreen(local);

    // 2. Запускаем SSE (живые обновления)
    connectSSE();

    // 3. Первая проверка сервера — сразу, чтобы синхронизироваться
    checkServer().then(function (data) {
      if (data) showScreen(data);
      else if (_screenShown) hideScreen();
    });

    // 4. Fallback polling
    startPolling();

    // 5. При возврате на вкладку
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) {
        checkServer().then(function (data) {
          if (data) showScreen(data);
          else if (_screenShown) hideScreen();
        });
      }
    });
  }

  window.__ncMaintenance = {
    version: MM_VERSION,
    isActive: isActive,
    get: get,
    activate: activate,
    deactivate: deactivate,
    show: function () { var d = get(); if (d) showScreen(d); },
    hide: hideScreen,
    checkServer: checkServer,
    reconnectSSE: connectSSE
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoCheck);
  } else {
    autoCheck();
  }

  console.log('%c[NordicCrypto] ⚙️ maintenance-mode.js v' + MM_VERSION + ' (SSE LIVE) loaded',
    'color:#8b5cf6;font-weight:bold;font-size:13px');
})();
