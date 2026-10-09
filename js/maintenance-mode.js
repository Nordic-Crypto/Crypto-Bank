/* ============================================================
   NORDIC CRYPTO — MAINTENANCE MODE v1.0
   ============================================================ */

(function () {
  'use strict';

  var MM_VERSION = '1.0.0';
  var STORAGE_KEY = 'nc_maintenance';

  function $(id) { return document.getElementById(id); }

  function getMaintenance() {
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

  function isActive() { return !!getMaintenance(); }

  async function activate(opts) {
    opts = opts || {};
    var duration = opts.duration || 5 * 60 * 1000;
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
      if (token && window.WORKER_URL) {
        await fetch(window.WORKER_URL + '?action=setMaintenance', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token: token, active: true,
            duration: duration, message: message, version: version
          })
        });
      }
    } catch (e) { console.warn('[maintenance] server sync failed', e); }

    try { new BroadcastChannel('nc_maintenance').postMessage({ type: 'activated', data: data }); } catch (e) {}
    return data;
  }

  async function deactivate() {
    localStorage.removeItem(STORAGE_KEY);
    try {
      var token = localStorage.getItem('session_token');
      if (token && window.WORKER_URL) {
        await fetch(window.WORKER_URL + '?action=setMaintenance', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: token, active: false })
        });
      }
    } catch (e) {}
    try { new BroadcastChannel('nc_maintenance').postMessage({ type: 'deactivated' }); } catch (e) {}
  }

  function showMaintenanceScreen(data) {
    if ($('ncMaintenanceScreen')) return;

    var isLoggedIn = !!localStorage.getItem('user_email') &&
                     $('mainApp') && $('mainApp').style.display !== 'none';

    if (isLoggedIn) { showMaintenanceBanner(data); return; }

    injectCSS();
    var screen = document.createElement('div');
    screen.id = 'ncMaintenanceScreen';
    screen.innerHTML = buildScreenHTML(data);
    document.body.appendChild(screen);
    requestAnimationFrame(function () { screen.classList.add('nc-mm-on'); });

    startCountdown(data.until);

    var iv = setInterval(function () {
      if (!isActive()) {
        clearInterval(iv);
        hideMaintenanceScreen();
        if (typeof window.toast === 'function') window.toast('✅ Update complete. You can now sign in.');
      }
    }, 5000);
  }

  function hideMaintenanceScreen() {
    var s = $('ncMaintenanceScreen');
    if (s) { s.classList.remove('nc-mm-on'); setTimeout(function () { s.remove(); }, 400); }
    var b = $('ncMaintenanceBanner');
    if (b) b.remove();
  }

  function showMaintenanceBanner(data) {
    if ($('ncMaintenanceBanner')) return;
    injectCSS();
    var b = document.createElement('div');
    b.id = 'ncMaintenanceBanner';
    b.className = 'nc-mm-banner';
    b.innerHTML =
      '<div class="nc-mm-banner-icon">⚙️</div>' +
      '<div class="nc-mm-banner-body">' +
        '<div class="nc-mm-banner-title">System update in progress</div>' +
        '<div class="nc-mm-banner-text">Some features may be temporarily unavailable.</div>' +
      '</div>' +
      '<button class="nc-mm-banner-close" onclick="this.parentNode.remove()">×</button>';
    document.body.appendChild(b);
  }

  function startCountdown(untilTs) {
    var el = $('ncMmCountdown');
    if (!el) return;
    (function tick() {
      var left = untilTs - Date.now();
      if (left <= 0) { el.textContent = '00:00'; hideMaintenanceScreen(); return; }
      var min = Math.floor(left / 60000);
      var sec = Math.floor((left % 60000) / 1000);
      el.textContent = String(min).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
      setTimeout(tick, 1000);
    })();
  }

  function buildScreenHTML(data) {
    return '<div class="nc-mm-bg"></div>' +
      '<div class="nc-mm-content">' +
        '<div class="nc-mm-logo"><div class="nc-mm-logo-icon">⚙️</div><div class="nc-mm-logo-text">Nordic<span>Crypto</span></div></div>' +
        '<div class="nc-mm-spinner"><div class="nc-mm-spinner-ring"></div><div class="nc-mm-spinner-ring"></div><div class="nc-mm-spinner-ring"></div></div>' +
        '<h1 class="nc-mm-title">System upgrade in progress</h1>' +
        '<p class="nc-mm-sub">' + esc(data.message) + '</p>' +
        '<div class="nc-mm-progress">' +
          '<div class="nc-mm-progress-bar"><div class="nc-mm-progress-fill"></div></div>' +
          '<div class="nc-mm-progress-text"><span>Deploying version ' + esc(data.version) + '</span><span id="ncMmCountdown">--:--</span></div>' +
        '</div>' +
        '<div class="nc-mm-steps">' +
          '<div class="nc-mm-step nc-mm-step-done"><span class="nc-mm-step-icon">✓</span> Database migration</div>' +
          '<div class="nc-mm-step nc-mm-step-active"><span class="nc-mm-step-icon">⟳</span> Deploying new code</div>' +
          '<div class="nc-mm-step"><span class="nc-mm-step-icon">3</span> Cache refresh & restart</div>' +
          '<div class="nc-mm-step"><span class="nc-mm-step-icon">4</span> Health check & launch</div>' +
        '</div>' +
        '<div class="nc-mm-footer"><span>🔒 Your data and funds are safe.</span>' +
        '<button class="nc-mm-retry" onclick="location.reload()">🔄 Check again</button></div>' +
      '</div>';
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function injectCSS() {
    if ($('ncMmStyles')) return;
    var style = document.createElement('style');
    style.id = 'ncMmStyles';
    style.textContent = `
      #ncMaintenanceScreen{position:fixed;inset:0;z-index:999999;display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .5s ease;padding:24px;font-family:-apple-system,"Segoe UI",Roboto,sans-serif}
      #ncMaintenanceScreen.nc-mm-on{opacity:1}
      .nc-mm-bg{position:absolute;inset:0;background:radial-gradient(900px 600px at 20% 10%,rgba(0,229,255,.12),transparent 60%),radial-gradient(800px 600px at 80% 90%,rgba(139,92,246,.15),transparent 60%),linear-gradient(135deg,#060912 0%,#0a0f1a 100%)}
      .nc-mm-content{position:relative;z-index:1;max-width:520px;width:100%;text-align:center;animation:ncMmIn .6s cubic-bezier(.34,1.56,.64,1)}
      @keyframes ncMmIn{from{opacity:0;transform:translateY(30px) scale(.95)}to{opacity:1;transform:translateY(0) scale(1)}}
      .nc-mm-logo{display:inline-flex;align-items:center;gap:12px;margin-bottom:32px;font-size:1.4rem;font-weight:800;color:#fff}
      .nc-mm-logo-icon{width:48px;height:48px;border-radius:14px;background:linear-gradient(135deg,#00e5ff,#8b5cf6);display:flex;align-items:center;justify-content:center;font-size:24px;animation:ncMmSpin 3s linear infinite}
      @keyframes ncMmSpin{0%,100%{transform:rotate(0deg)}50%{transform:rotate(180deg)}}
      .nc-mm-logo-text span{background:linear-gradient(100deg,#00e5ff,#8b5cf6,#ec4899);-webkit-background-clip:text;background-clip:text;color:transparent}
      .nc-mm-spinner{position:relative;width:100px;height:100px;margin:0 auto 32px}
      .nc-mm-spinner-ring{position:absolute;inset:0;border-radius:50%;border:2px solid transparent;border-top-color:#00e5ff;animation:ncMmSpinRing 1.5s linear infinite}
      .nc-mm-spinner-ring:nth-child(2){inset:12px;border-top-color:#8b5cf6;animation-duration:2s;animation-direction:reverse}
      .nc-mm-spinner-ring:nth-child(3){inset:24px;border-top-color:#ec4899;animation-duration:2.5s}
      @keyframes ncMmSpinRing{to{transform:rotate(360deg)}}
      .nc-mm-title{font-size:1.9rem;font-weight:800;letter-spacing:-.03em;color:#fff;margin:0 0 12px}
      .nc-mm-sub{font-size:.95rem;color:#94a3b8;line-height:1.6;margin:0 0 32px}
      .nc-mm-progress{margin-bottom:28px}
      .nc-mm-progress-bar{height:6px;background:rgba(255,255,255,.06);border-radius:3px;overflow:hidden;margin-bottom:10px}
      .nc-mm-progress-fill{height:100%;width:0;background:linear-gradient(90deg,#00e5ff,#8b5cf6,#ec4899);border-radius:3px;animation:ncMmProgress 30s ease-out forwards}
      @keyframes ncMmProgress{0%{width:5%}100%{width:95%}}
      .nc-mm-progress-text{display:flex;justify-content:space-between;font-size:.78rem;color:#64748b;font-family:ui-monospace,monospace}
      .nc-mm-steps{text-align:left;display:flex;flex-direction:column;gap:10px;padding:20px;background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.05);border-radius:16px;margin-bottom:24px}
      .nc-mm-step{display:flex;align-items:center;gap:14px;font-size:.88rem;color:#64748b;padding:6px 0}
      .nc-mm-step-icon{width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);flex-shrink:0}
      .nc-mm-step-done{color:#10b981}
      .nc-mm-step-done .nc-mm-step-icon{background:rgba(16,185,129,.15);border-color:rgba(16,185,129,.4);color:#10b981}
      .nc-mm-step-active{color:#fff;font-weight:600}
      .nc-mm-step-active .nc-mm-step-icon{background:rgba(0,229,255,.15);border-color:rgba(0,229,255,.4);color:#00e5ff;animation:ncMmPulse 1.5s ease-in-out infinite}
      @keyframes ncMmPulse{0%,100%{box-shadow:0 0 0 0 rgba(0,229,255,.5)}50%{box-shadow:0 0 0 8px rgba(0,229,255,0)}}
      .nc-mm-footer{display:flex;flex-direction:column;align-items:center;gap:14px;font-size:.82rem;color:#64748b}
      .nc-mm-retry{padding:12px 24px;border-radius:12px;border:1px solid rgba(0,229,255,.3);background:rgba(0,229,255,.08);color:#00e5ff;font-size:.85rem;font-weight:700;cursor:pointer;font-family:inherit}
      .nc-mm-banner{position:fixed;top:80px;right:20px;max-width:380px;z-index:99998;display:flex;gap:12px;padding:16px;background:linear-gradient(135deg,rgba(245,158,11,.15),rgba(239,68,68,.1));border:1px solid rgba(245,158,11,.35);border-radius:14px;box-shadow:0 20px 40px -15px rgba(0,0,0,.8);backdrop-filter:blur(10px)}
      .nc-mm-banner-icon{font-size:24px;flex-shrink:0}
      .nc-mm-banner-body{flex:1}
      .nc-mm-banner-title{font-weight:700;color:#fff;font-size:.9rem;margin-bottom:4px}
      .nc-mm-banner-text{font-size:.78rem;color:#94a3b8;line-height:1.4}
      .nc-mm-banner-close{width:24px;height:24px;border-radius:6px;border:none;background:rgba(255,255,255,.06);color:#94a3b8;cursor:pointer;flex-shrink:0;font-size:16px;line-height:1}
    `;
    document.head.appendChild(style);
  }

  async function checkServerMaintenance() {
    try {
      if (!window.WORKER_URL) return;
      var r = await fetch(window.WORKER_URL + '?action=getMaintenanceStatus');
      var d = await r.json();
      if (d && d.ok && d.maintenance && d.maintenance.active) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(d.maintenance));
        showMaintenanceScreen(d.maintenance);
      } else if (d && d.ok && d.maintenance && !d.maintenance.active) {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch (e) {}
  }

  window.__ncMaintenance = {
    version: MM_VERSION,
    isActive: isActive,
    get: getMaintenance,
    activate: activate,
    deactivate: deactivate,
    show: function () { var d = getMaintenance(); if (d) showMaintenanceScreen(d); },
    hide: hideMaintenanceScreen,
    checkServer: checkServerMaintenance
  };

  function init() {
    checkServerMaintenance();
    setInterval(checkServerMaintenance, 30000);
    var local = getMaintenance();
    if (local) showMaintenanceScreen(local);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  try {
    var bc = new BroadcastChannel('nc_maintenance');
    bc.onmessage = function (ev) {
      if (ev.data && ev.data.type === 'activated') { var d = getMaintenance(); if (d) showMaintenanceScreen(d); }
      else if (ev.data && ev.data.type === 'deactivated') { hideMaintenanceScreen(); }
    };
  } catch (e) {}

  console.log('%c[NordicCrypto] ⚙️ maintenance-mode.js v' + MM_VERSION + ' loaded',
    'color:#8b5cf6;font-weight:bold;font-size:13px');
})();
