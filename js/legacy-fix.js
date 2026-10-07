/* ============================================================
   NORDIC CRYPTO — LEGACY-FIX.JS v1.0
   ============================================================
   Загружается ПОСЛЕ app.legacy.js.
   Патчит 3 функции, чтобы клики работали
   с applyAccountType() и inline display:none.
   ============================================================ */

(function () {
  'use strict';

    // ---------- FIX 1: initNav — навигация по сайдбару + account type awareness ----------
  window.initNav = function () {
    var mis = document.querySelectorAll('.mi');
    for (var i = 0; i < mis.length; i++) {
      mis[i].onclick = function () {
        var p = this.getAttribute('data-p');

        // 🎯 ГЛАВНЫЙ ФИКС: определяем тип аккаунта
        var accountType = (window.st && window.st.user && window.st.user.accountType) || null;
        var isExchange = (accountType === 'exchange');

        // Если клиент — exchange и клик на "Dashboard" → показываем exchangeDash
        if (isExchange && p === 'dash') {
          p = 'exchangeDash';
        }

        // Скрываем все .pg
        var pgs = document.querySelectorAll('.pg');
        for (var j = 0; j < pgs.length; j++) {
          pgs[j].classList.remove('on');
          pgs[j].style.display = 'none';
        }

        // Показываем нужную страницу
        var page = document.getElementById(p);
        if (page) {
          page.classList.add('on');
          page.style.display = 'block';
        }

        // Подсветка активного пункта меню
        var ms = document.querySelectorAll('.mi');
        for (var k = 0; k < ms.length; k++) ms[k].classList.remove('on');
        this.classList.add('on');

        // Если вернулись на dashboard — вызываем render + applyAccountType
        if (p === 'dash' || p === 'exchangeDash') {
          setTimeout(function () {
            if (typeof window.applyAccountType === 'function') window.applyAccountType();
            if (typeof window.render === 'function') window.render();
          }, 50);
        }
      };
    }


  // FIX 2: initRecentTx — кнопка "View all"
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

  // FIX 3: initCardActions — кнопка "Order Physical Card"
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

  // Перезапускаем с патчами (legacy уже вызвал их один раз)
    setTimeout(function () {
    if (typeof window.initNav === 'function') window.initNav();
    if (typeof window.initRecentTx === 'function') window.initRecentTx();
    if (typeof window.initCardActions === 'function') window.initCardActions();
    console.log('%c[NordicCrypto] 🔧 legacy-fix.js applied', 'color:#22d3ee;font-weight:bold');
  }, 100);

  // ============================================================
  // COUNT-UP АНИМАЦИЯ БАЛАНСА
  // ============================================================
  function animateNumber(el, targetText) {
    if (!el) return;
    var cleaned = targetText.replace(/[^0-9.]/g, '');
    var target = parseFloat(cleaned);
    if (!isFinite(target) || target === 0) {
      el.textContent = targetText;
      return;
    }
    var duration = 1200;
    var start = performance.now();
    var prefix = targetText.match(/^[^\d]*/)[0] || '';
    var suffix = targetText.match(/[^\d]*$/)[0] || '';
    function tick(now) {
      var progress = Math.min((now - start) / duration, 1);
      var eased = 1 - Math.pow(1 - progress, 3);
      var current = target * eased;
      var formatted = current.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      });
      el.textContent = prefix + formatted + suffix;
      if (progress < 1) requestAnimationFrame(tick);
      else el.textContent = targetText;
    }
    requestAnimationFrame(tick);
  }

  var _balanceObserver = null;
  function watchBalance() {
    var balEl = document.getElementById('bal');
    if (!balEl || _balanceObserver) return;
    var lastText = '';
    _balanceObserver = new MutationObserver(function () {
      var txt = balEl.textContent;
      if (txt === lastText) return;
      lastText = txt;
      if (/[\d]/.test(txt)) animateNumber(balEl, txt);
    });
    _balanceObserver.observe(balEl, { childList: true, characterData: true, subtree: true });
  }

  watchBalance();
  setTimeout(watchBalance, 1000);
  setTimeout(watchBalance, 2500);

  console.log('%c[NordicCrypto] 💫 count-up animation ready', 'color:#22d3ee');

})();     // ← это последняя строка, оставь её
  // ============================================================
  // FIX 4: EXCHANGE DASHBOARD BUTTONS
  // ============================================================
  // Кнопки в exchange dashboard биндятся в DOMContentLoaded,
  // который к моменту загрузки legacy уже прошёл. Перебиваем их.

  function bindExchangeButtons() {
    // Deposit — открывает ту же модалку, что и "Add funds"
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

    // Withdraw — открывает withdraw modal
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

    // Trade — заглушка + hint про терминал
    var btnExTrade = document.getElementById('exBtnTrade');
    if (btnExTrade) {
      btnExTrade.onclick = function (e) {
        e.preventDefault();
        openTradeTerminal();
      };
    }
  }

  // ----- Trade Terminal — премиум-заглушка -----
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

  // Запускаем бинды при загрузке и после переключения на exchange
  bindExchangeButtons();
  setTimeout(bindExchangeButtons, 500);
  setTimeout(bindExchangeButtons, 1500);
  setTimeout(bindExchangeButtons, 3000);

  // Плюс следим, чтобы кнопки были забанены после applyAccountType
  var _origApplyAccountType = window.applyAccountType;
  if (typeof _origApplyAccountType === 'function') {
    window.applyAccountType = function () {
      _origApplyAccountType.apply(this, arguments);
      setTimeout(bindExchangeButtons, 100);
    };
  }

  console.log('%c[NordicCrypto] 💱 exchange buttons bound', 'color:#22d3ee');
