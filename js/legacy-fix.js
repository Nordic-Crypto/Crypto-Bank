/* ============================================================
   NORDIC CRYPTO — LEGACY-FIX.JS v2.0
   ============================================================
   Loaded AFTER app.legacy.js.
   
   Provides safe monkey-patches for functions that break with
   applyAccountType() and inline display:none.
   
   Fixes included:
     • FIX 1: initNav       — account-type-aware navigation
     • FIX 2: initRecentTx  — "View all" button
     • FIX 3: initCardActions → btnGoOrder
     • FIX 4: Exchange dashboard buttons (Deposit/Withdraw/Trade)
   
   v2.0 changes:
     • Removed count-up animation (was corrupting balance)
     • Fixed IIFE closing brace (was mid-file → FIX 4 never ran)
     • Removed applyAccountType wrapper (caused render loops)
     • All comments now in English
   ============================================================ */

(function () {
  'use strict';

  /* ============================================================
     FIX 1: initNav — account-type-aware sidebar navigation
     ============================================================ */
  window.initNav = function () {
    var mis = document.querySelectorAll('.mi');
    for (var i = 0; i < mis.length; i++) {
      mis[i].onclick = function () {
        var p = this.getAttribute('data-p');

        // Determine account type
        var accountType = (window.st && window.st.user && window.st.user.accountType) || null;
        var isExchange = (accountType === 'exchange');

        // Exchange clients → "Dashboard" maps to exchangeDash
        var targetPage = p;
        if (isExchange && p === 'dash') {
          targetPage = 'exchangeDash';
        }

        // Hide all .pg pages
        var pgs = document.querySelectorAll('.pg');
        for (var j = 0; j < pgs.length; j++) {
          pgs[j].classList.remove('on');
          pgs[j].style.display = 'none';
        }

        // Show target page
        var page = document.getElementById(targetPage);
        if (page) {
          page.classList.add('on');
          page.style.display = 'block';
        }

        // Highlight active menu item
        var ms = document.querySelectorAll('.mi');
        for (var k = 0; k < ms.length; k++) ms[k].classList.remove('on');
        this.classList.add('on');

        // Refresh data when returning to a dashboard
        if (targetPage === 'dash' || targetPage === 'exchangeDash') {
          setTimeout(function () {
            if (typeof window.render === 'function') window.render();
          }, 50);
        }
      };
    }
  };

  /* ============================================================
     FIX 2: initRecentTx — "View all" button
     ============================================================ */
  window.initRecentTx = function () {
    var viewAll = document.getElementById('viewAllTx');
    if (viewAll) viewAll.onclick = function (e) {
      e.preventDefault();
      var pgs = document.querySelectorAll('.pg');
      for (var i = 0; i < pgs.length; i++) {
        pgs[i].classList.remove('on');
        pgs[i].style.display = 'none';
      }
      var txPg = document.getElementById('tx');
      if (txPg) {
        txPg.classList.add('on');
        txPg.style.display = 'block';
      }
      var ms = document.querySelectorAll('.mi');
      for (var j = 0; j < ms.length; j++) ms[j].classList.remove('on');
      var txMi = document.querySelector('.mi[data-p="tx"]');
      if (txMi) txMi.classList.add('on');
    };
  };

  /* ============================================================
     FIX 3: initCardActions → btnGoOrder ("Order Physical Card")
     ============================================================ */
  var _origInitCardActions = window.initCardActions;
  window.initCardActions = function () {
    if (typeof _origInitCardActions === 'function') {
      try { _origInitCardActions(); } catch (e) { console.warn('[fix] initCardActions error:', e); }
    }

    var btnGoOrder = document.getElementById('btnGoOrder');
    if (btnGoOrder) {
      btnGoOrder.onclick = function () {
        var pgs = document.querySelectorAll('.pg');
        for (var j = 0; j < pgs.length; j++) {
          pgs[j].classList.remove('on');
          pgs[j].style.display = 'none';
        }
        var orderPg = document.getElementById('order');
        if (orderPg) {
          orderPg.classList.add('on');
          orderPg.style.display = 'block';
        }
        var ms = document.querySelectorAll('.mi');
        for (var k = 0; k < ms.length; k++) ms[k].classList.remove('on');
        var orderMi = document.querySelector('.mi[data-p="order"]');
        if (orderMi) orderMi.classList.add('on');
      };
    }
  };

  /* ============================================================
     FIX 4: Exchange dashboard buttons (Deposit / Withdraw / Trade)
     ============================================================ */
  function bindExchangeButtons() {
    // Deposit → same modal as "Add funds"
    var btnExDep = document.getElementById('exBtnDeposit');
    if (btnExDep) {
      btnExDep.onclick = function (e) {
        e.preventDefault();
        if (typeof window.openModal === 'function') {
          window.openModal('add');
        } else {
          var b = document.getElementById('btnAdd');
          if (b) b.click();
        }
      };
    }

    // Withdraw → withdraw modal
    var btnExWd = document.getElementById('exBtnWithdraw');
    if (btnExWd) {
      btnExWd.onclick = function (e) {
        e.preventDefault();
        if (typeof window.openWithdraw === 'function') {
          window.openWithdraw();
        } else {
          alert('Withdraw modal not available');
        }
      };
    }

    // Trade → terminal preview modal
    var btnExTrade = document.getElementById('exBtnTrade');
    if (btnExTrade) {
      btnExTrade.onclick = function (e) {
        e.preventDefault();
        openTradeTerminal();
      };
    }
  }

  /* ============================================================
     Trade Terminal — premium preview modal (v5.0 placeholder)
     ============================================================ */
  function openTradeTerminal() {
    var old = document.getElementById('tradeTerminalModal');
    if (old) { old.remove(); return; }

    var modal = document.createElement('div');
    modal.id = 'tradeTerminalModal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(3,6,11,.85);backdrop-filter:blur(16px);display:flex;align-items:center;justify-content:center;z-index:10000;padding:20px;animation:fadeIn .3s ease;';

    modal.innerHTML =
      '<div style="background:linear-gradient(145deg,#0f1720,#0a0e15);border:1px solid rgba(139,92,246,.3);border-radius:24px;width:100%;max-width:560px;padding:36px;color:#e7edf5;box-shadow:0 40px 100px -20px rgba(139,92,246,.4);position:relative;overflow:hidden;">' +

        '<div style="position:absolute;top:-100px;right:-100px;width:300px;height:300px;background:radial-gradient(circle,rgba(139,92,246,.2),transparent 70%);pointer-events:none;animation:pulse 3s ease-in-out infinite;"></div>' +

        '<button onclick="document.getElementById(\'tradeTerminalModal\').remove()" style="position:absolute;top:16px;right:16px;width:36px;height:36px;border-radius:10px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);color:#8b95a5;font-size:20px;cursor:pointer;line-height:1;">×</button>' +

        '<div style="display:flex;align-items:center;gap:16px;margin-bottom:20px;position:relative;z-index:1;">' +
          '<div style="width:64px;height:64px;border-radius:18px;background:linear-gradient(135deg,#8b5cf6,#ec4899);display:flex;align-items:center;justify-content:center;font-size:28px;box-shadow:0 12px 30px -8px rgba(139,92,246,.7);">⚡</div>' +
          '<div>' +
            '<div style="font-size:1.5rem;font-weight:800;background:linear-gradient(100deg,#fff,#c4b5fd);-webkit-background-clip:text;background-clip:text;color:transparent;">Trading Terminal</div>' +
            '<div style="font-size:.85rem;color:#8b95a5;margin-top:4px;">Coming in v5.0</div>' +
          '</div>' +
        '</div>' +

        '<p style="color:#94a3b8;font-size:.95rem;line-height:1.6;margin:0 0 24px;position:relative;z-index:1;">' +
          'Full-featured spot terminal for crypto trading: limit orders, market orders, stop-losses, and live TradingView charts.' +
        '</p>' +

        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:28px;position:relative;z-index:1;">' +
          '<div style="padding:14px 16px;background:rgba(71,220,255,.05);border:1px solid rgba(71,220,255,.2);border-radius:12px;">' +
            '<div style="font-size:22px;margin-bottom:6px;">📈</div>' +
            '<div style="font-weight:700;font-size:.85rem;color:#fff;">Live charts</div>' +
            '<div style="font-size:.72rem;color:#7c9cbb;margin-top:2px;">TradingView integration</div>' +
          '</div>' +
          '<div style="padding:14px 16px;background:rgba(139,92,246,.05);border:1px solid rgba(139,92,246,.2);border-radius:12px;">' +
            '<div style="font-size:22px;margin-bottom:6px;">📊</div>' +
            '<div style="font-weight:700;font-size:.85rem;color:#fff;">Order book</div>' +
            '<div style="font-size:.72rem;color:#7c9cbb;margin-top:2px;">Depth + spread</div>' +
          '</div>' +
          '<div style="padding:14px 16px;background:rgba(16,185,129,.05);border:1px solid rgba(16,185,129,.2);border-radius:12px;">' +
            '<div style="font-size:22px;margin-bottom:6px;">💹</div>' +
            '<div style="font-weight:700;font-size:.85rem;color:#fff;">Limit / Market</div>' +
            '<div style="font-size:.72rem;color:#7c9cbb;margin-top:2px;">Stop-loss too</div>' +
          '</div>' +
          '<div style="padding:14px 16px;background:rgba(236,72,153,.05);border:1px solid rgba(236,72,153,.2);border-radius:12px;">' +
            '<div style="font-size:22px;margin-bottom:6px;">⚡</div>' +
            '<div style="font-weight:700;font-size:.85rem;color:#fff;">Instant fills</div>' +
            '<div style="font-size:.72rem;color:#7c9cbb;margin-top:2px;">Sub-second settlement</div>' +
          '</div>' +
        '</div>' +

        '<div style="display:flex;gap:10px;position:relative;z-index:1;">' +
          '<button onclick="document.getElementById(\'tradeTerminalModal\').remove(); if(typeof toast===\'function\') toast(\'We will notify you when Trade launches 🚀\');" style="flex:1;padding:14px;background:linear-gradient(135deg,#8b5cf6,#ec4899);color:#fff;border:none;border-radius:12px;font-weight:700;cursor:pointer;font-size:.9rem;font-family:inherit;">Notify me when live</button>' +
          '<button onclick="document.getElementById(\'tradeTerminalModal\').remove()" style="flex:1;padding:14px;background:rgba(255,255,255,.05);color:#8b95a5;border:1px solid rgba(255,255,255,.1);border-radius:12px;font-weight:700;cursor:pointer;font-size:.9rem;font-family:inherit;">Close</button>' +
        '</div>' +

        '<style>@keyframes pulse{0%,100%{opacity:.5;transform:scale(1)}50%{opacity:1;transform:scale(1.1)}}@keyframes fadeIn{from{opacity:0}to{opacity:1}}</style>' +
      '</div>';

    document.body.appendChild(modal);

    modal.onclick = function (e) {
      if (e.target === modal) modal.remove();
    };
    document.addEventListener('keydown', function escClose(e) {
      if (e.key === 'Escape') {
        modal.remove();
        document.removeEventListener('keydown', escClose);
      }
    });
  }
  window.openTradeTerminal = openTradeTerminal;

  /* ============================================================
     INIT — Apply all patches
     ============================================================ */
  function applyAllPatches() {
    if (typeof window.initNav === 'function') window.initNav();
    if (typeof window.initRecentTx === 'function') window.initRecentTx();
    if (typeof window.initCardActions === 'function') window.initCardActions();
    bindExchangeButtons();
  }

  // Apply on load, then re-apply a few times to catch late DOM mutations
  applyAllPatches();
  setTimeout(applyAllPatches, 500);
  setTimeout(applyAllPatches, 1500);
  setTimeout(applyAllPatches, 3000);

  console.log('%c[NordicCrypto] 🔧 legacy-fix.js v2.0 applied', 'color:#22d3ee;font-weight:bold');

})();
