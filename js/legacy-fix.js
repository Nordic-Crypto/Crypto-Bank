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

        '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;position:relative;z-index:1;">' +
  '<button onclick="document.getElementById(\'tradeTerminalModal\').remove(); window.openTradeModal(\'buyModal\');" style="padding:14px;background:linear-gradient(135deg,#10b981,#34d399);color:#fff;border:none;border-radius:12px;font-weight:700;cursor:pointer;font-size:.9rem;font-family:inherit;box-shadow:0 12px 30px -8px rgba(16,185,129,.6);">📈 Buy</button>' +
  '<button onclick="document.getElementById(\'tradeTerminalModal\').remove(); window.openTradeModal(\'sellModal\');" style="padding:14px;background:linear-gradient(135deg,#ef4444,#f87171);color:#fff;border:none;border-radius:12px;font-weight:700;cursor:pointer;font-size:.9rem;font-family:inherit;box-shadow:0 12px 30px -8px rgba(239,68,68,.6);">📉 Sell</button>' +
  '<button onclick="document.getElementById(\'tradeTerminalModal\').remove(); window.openTradeModal(\'convertModal\');" style="padding:14px;background:linear-gradient(135deg,#8b5cf6,#ec4899);color:#fff;border:none;border-radius:12px;font-weight:700;cursor:pointer;font-size:.9rem;font-family:inherit;box-shadow:0 12px 30px -8px rgba(139,92,246,.6);">🔄 Convert</button>' +
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
  /* ============================================================
     FIX 5: TX Details Modal — гарантированное закрытие
     ============================================================ */
  function ensureTxDetailsClose() {
    // Гарантируем, что closeTxDetails работает
    if (typeof window.closeTxDetails !== 'function') {
      window.closeTxDetails = function () {
        var mask = document.getElementById('txDetailsMask');
        if (mask) mask.classList.remove('on');
      };
    }

    // Привязываем кнопки каждый раз (перебиваем возможные конфликты)
    var txdClose = document.getElementById('txdClose');
    if (txdClose) {
      txdClose.onclick = function (e) {
        e.preventDefault();
        e.stopPropagation();
        window.closeTxDetails();
      };
    }

    var txdCloseBtn = document.getElementById('txdCloseBtn');
    if (txdCloseBtn) {
      txdCloseBtn.onclick = function (e) {
        e.preventDefault();
        e.stopPropagation();
        window.closeTxDetails();
      };
    }

    // Закрытие по клику на фон
    var txdMask = document.getElementById('txDetailsMask');
    if (txdMask && !txdMask._clickBound) {
      txdMask._clickBound = true;
      txdMask.onclick = function (e) {
        if (e.target === txdMask) window.closeTxDetails();
      };
    }

    // Закрытие по Esc — глобальный обработчик (один раз)
    if (!window._txdEscBound) {
      window._txdEscBound = true;
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
          var mask = document.getElementById('txDetailsMask');
          if (mask && mask.classList.contains('on')) {
            window.closeTxDetails();
          }
        }
      });
    }
  }

  // Применяем при загрузке + перепроверяем через интервалы
  ensureTxDetailsClose();
  setTimeout(ensureTxDetailsClose, 500);
  setTimeout(ensureTxDetailsClose, 1500);
  setTimeout(ensureTxDetailsClose, 3000);
  setTimeout(ensureTxDetailsClose, 5000);

  // Перепроверяем перед каждым открытием модалки
  var _origOpenTxDetails = window.openTxDetails;
  if (typeof _origOpenTxDetails === 'function') {
    window.openTxDetails = function () {
      _origOpenTxDetails.apply(this, arguments);
      setTimeout(ensureTxDetailsClose, 100);
    };
  }

  console.log('%c[NordicCrypto] 🎯 TX details close fix applied', 'color:#22d3ee');
  /* ============================================================
     TRADE TERMINAL — Buy / Sell / Convert logic
     ============================================================ */

  // State
  window._tradeCoin = 'BTC';
  window._sellCoin = 'BTC';

  // ---------- Price + balance helpers ----------
  function getCoinPrice(symbol) {
    if (!window._exPricesCache || !window._exPricesCache.length) {
      // fallback from state
      if (symbol === 'BTC') return (window.st && window.st.btcP) || 83000;
      if (symbol === 'ETH') return (window.st && window.st.ethP) || 2550;
      if (symbol === 'USDT') return 1;
      if (symbol === 'SOL') return 115;
      if (symbol === 'BNB') return 767;
      return 0;
    }
    var coin = window._exPricesCache.find(function (c) { return c.symbol === symbol; });
    return coin ? Number(coin.usd) || 0 : 0;
  }

  function getCoinBalance(symbol) {
    if (!window.st) return 0;
    if (symbol === 'BTC') return window.st.btc || 0;
    if (symbol === 'ETH') return window.st.eth || 0;
    if (symbol === 'USDT') return window.st.usdt || 0;
    if (symbol === 'SOL') return window.st.sol || 0;
    if (symbol === 'BNB') return window.st.bnb || 0;
    return 0;
  }

  function setCoinBalance(symbol, value) {
    if (!window.st) return;
    if (symbol === 'BTC') window.st.btc = value;
    else if (symbol === 'ETH') window.st.eth = value;
    else if (symbol === 'USDT') window.st.usdt = value;
    else if (symbol === 'SOL') window.st.sol = value;
    else if (symbol === 'BNB') window.st.bnb = value;
  }

  function fmtMoney(n) {
    return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function fmtCrypto(n, symbol) {
    var decimals = (symbol === 'USDT') ? 2 : 8;
    return Number(n).toFixed(decimals) + ' ' + symbol;
  }

  // ---------- MODAL OPEN / CLOSE ----------
  window.openTradeModal = function (modalId) {
    // Close all others
    ['buyModal', 'sellModal', 'convertModal', 'tradeSuccessModal'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.classList.remove('on');
    });

    var modal = document.getElementById(modalId);
    if (!modal) return;
    modal.classList.add('on');

    // Reset + refresh
    if (modalId === 'buyModal') {
      document.getElementById('buyAmount').value = '';
      updateBuyPreview();
    } else if (modalId === 'sellModal') {
      document.getElementById('sellAmount').value = '';
      updateSellPreview();
    } else if (modalId === 'convertModal') {
      document.getElementById('convertAmount').value = '';
      updateConvertPreview();
    }
  };

  window.closeTradeModal = function (modalId) {
    var modal = document.getElementById(modalId);
    if (modal) modal.classList.remove('on');
  };

  // ---------- BUY ----------
  window.setBuyAmount = function (amount) {
    document.getElementById('buyAmount').value = amount;
    updateBuyPreview();
  };

  window.setMaxBuy = function () {
    var balance = (window.st && window.st.usd) || 0;
    document.getElementById('buyAmount').value = balance.toFixed(2);
    updateBuyPreview();
  };

  function updateBuyPreview() {
    var amountEl = document.getElementById('buyAmount');
    if (!amountEl) return;
    var amount = parseFloat(amountEl.value) || 0;
    var coin = window._tradeCoin;
    var price = getCoinPrice(coin);
    var received = price > 0 ? amount / price : 0;

    document.getElementById('buyReceive').textContent = fmtCrypto(received, coin);
    document.getElementById('buyRate').textContent = '1 ' + coin + ' = ' + fmtMoney(price);
    document.getElementById('buyBalance').textContent = fmtMoney((window.st && window.st.usd) || 0);
    document.getElementById('buyBtnCoin').textContent = coin;

    var err = document.getElementById('buyError');
    err.classList.remove('on');
    err.textContent = '';

    var balance = (window.st && window.st.usd) || 0;
    if (amount > 0 && amount < 10) {
      err.textContent = 'Minimum purchase is $10';
      err.classList.add('on');
    } else if (amount > balance) {
      err.textContent = 'Insufficient balance. You have ' + fmtMoney(balance);
      err.classList.add('on');
    }
  }

  window.executeBuy = function () {
    var amount = parseFloat(document.getElementById('buyAmount').value) || 0;
    var coin = window._tradeCoin;
    var price = getCoinPrice(coin);
    var balance = (window.st && window.st.usd) || 0;

    var err = document.getElementById('buyError');
    err.classList.remove('on');
    err.textContent = '';

    if (amount < 10) { err.textContent = 'Minimum purchase is $10'; err.classList.add('on'); return; }
    if (amount > balance) { err.textContent = 'Insufficient balance'; err.classList.add('on'); return; }
    if (price <= 0) { err.textContent = 'Price unavailable. Try again.'; err.classList.add('on'); return; }

    var received = amount / price;

    // Update balances
    window.st.usd = balance - amount;
    setCoinBalance(coin, getCoinBalance(coin) + received);

    // Add transaction
    if (!Array.isArray(window.st.txs)) window.st.txs = [];
    window.st.txs.unshift({
      date: new Date().toISOString().slice(0, 10),
      ts: Date.now(),
      desc: 'Buy ' + fmtCrypto(received, coin) + ' @ ' + fmtMoney(price),
      amt: -amount,
      status: 'Completed',
      symbol: coin,
      crypto: received,
      price: price,
      tradeType: 'buy'
    });

    if (!Array.isArray(window.st.trades)) window.st.trades = [];
    window.st.trades.unshift({
      ts: Date.now(),
      type: 'buy',
      symbol: coin,
      amount: received,
      price: price,
      total: amount
    });

    // Save + re-render
    if (typeof window.saveToServer === 'function') window.saveToServer();
    if (typeof window.render === 'function') window.render();

    // Success modal
    closeTradeModal('buyModal');
    showTradeSuccess({
      title: 'Buy successful',
      desc: 'Your crypto has been credited',
      amount: '+' + fmtCrypto(received, coin),
      details: [
        { label: 'Spent', value: fmtMoney(amount) },
        { label: 'Rate', value: '1 ' + coin + ' = ' + fmtMoney(price) },
        { label: 'New balance', value: fmtMoney(window.st.usd) }
      ]
    });

    // Sound + notification
    if (typeof window.playChime === 'function') window.playChime();
    if (typeof window.addNotification === 'function') {
      window.addNotification('Bought ' + fmtCrypto(received, coin), '📈');
    }
  };

  // ---------- SELL ----------
  window.setMaxSell = function () {
    var coin = window._sellCoin;
    var balance = getCoinBalance(coin);
    document.getElementById('sellAmount').value = balance.toFixed(8);
    updateSellPreview();
  };

  function updateSellPreview() {
    var amountEl = document.getElementById('sellAmount');
    if (!amountEl) return;
    var amount = parseFloat(amountEl.value) || 0;
    var coin = window._sellCoin;
    var price = getCoinPrice(coin);
    var received = amount * price;

    document.getElementById('sellReceive').textContent = fmtMoney(received);
    document.getElementById('sellRate').textContent = '1 ' + coin + ' = ' + fmtMoney(price);
    document.getElementById('sellBalance').textContent = fmtCrypto(getCoinBalance(coin), coin);
    document.getElementById('sellCoinLabel').textContent = coin;
    document.getElementById('sellBtnCoin').textContent = coin;

    var err = document.getElementById('sellError');
    err.classList.remove('on');
    err.textContent = '';

    var balance = getCoinBalance(coin);
    if (amount > balance) {
      err.textContent = 'Insufficient ' + coin + '. You have ' + fmtCrypto(balance, coin);
      err.classList.add('on');
    }
  }

  window.executeSell = function () {
    var amount = parseFloat(document.getElementById('sellAmount').value) || 0;
    var coin = window._sellCoin;
    var price = getCoinPrice(coin);
    var balance = getCoinBalance(coin);

    var err = document.getElementById('sellError');
    err.classList.remove('on');
    err.textContent = '';

    if (amount <= 0) { err.textContent = 'Enter amount'; err.classList.add('on'); return; }
    if (amount > balance) { err.textContent = 'Insufficient ' + coin; err.classList.add('on'); return; }
    if (price <= 0) { err.textContent = 'Price unavailable'; err.classList.add('on'); return; }

    var received = amount * price;

    // Update balances
    setCoinBalance(coin, balance - amount);
    window.st.usd = (window.st.usd || 0) + received;

    // Add transaction
    if (!Array.isArray(window.st.txs)) window.st.txs = [];
    window.st.txs.unshift({
      date: new Date().toISOString().slice(0, 10),
      ts: Date.now(),
      desc: 'Sell ' + fmtCrypto(amount, coin) + ' @ ' + fmtMoney(price),
      amt: received,
      status: 'Completed',
      symbol: coin,
      crypto: amount,
      price: price,
      tradeType: 'sell'
    });

    if (!Array.isArray(window.st.trades)) window.st.trades = [];
    window.st.trades.unshift({
      ts: Date.now(),
      type: 'sell',
      symbol: coin,
      amount: amount,
      price: price,
      total: received
    });

    // Save + re-render
    if (typeof window.saveToServer === 'function') window.saveToServer();
    if (typeof window.render === 'function') window.render();

    closeTradeModal('sellModal');
    showTradeSuccess({
      title: 'Sell successful',
      desc: 'USD has been credited to your balance',
      amount: '+' + fmtMoney(received),
      details: [
        { label: 'Sold', value: fmtCrypto(amount, coin) },
        { label: 'Rate', value: '1 ' + coin + ' = ' + fmtMoney(price) },
        { label: 'New USD balance', value: fmtMoney(window.st.usd) }
      ]
    });

    if (typeof window.playChime === 'function') window.playChime();
    if (typeof window.addNotification === 'function') {
      window.addNotification('Sold ' + fmtCrypto(amount, coin), '📉');
    }
  };

  // ---------- CONVERT ----------
  window.swapConvert = function () {
    var from = document.getElementById('convertFrom');
    var to = document.getElementById('convertTo');
    var tmp = from.value;
    from.value = to.value;
    to.value = tmp;
    updateConvertPreview();
  };

  window.setMaxConvert = function () {
    var coin = document.getElementById('convertFrom').value;
    var balance = getCoinBalance(coin);
    document.getElementById('convertAmount').value = balance.toFixed(8);
    updateConvertPreview();
  };

  function updateConvertPreview() {
    var amountEl = document.getElementById('convertAmount');
    if (!amountEl) return;
    var amount = parseFloat(amountEl.value) || 0;
    var fromCoin = document.getElementById('convertFrom').value;
    var toCoin = document.getElementById('convertTo').value;

    var fromPrice = getCoinPrice(fromCoin);
    var toPrice = getCoinPrice(toCoin);

    var rate = (toPrice > 0) ? (fromPrice / toPrice) : 0;
    var result = amount * rate;

    document.getElementById('convertResult').value = result > 0 ? result.toFixed(8) : '';
    document.getElementById('convertRate').textContent = '1 ' + fromCoin + ' = ' + rate.toFixed(8) + ' ' + toCoin;
    document.getElementById('convertFromBalance').textContent = 'Balance: ' + fmtCrypto(getCoinBalance(fromCoin), fromCoin);
    document.getElementById('convertToBalance').textContent = 'Balance: ' + fmtCrypto(getCoinBalance(toCoin), toCoin);

    var err = document.getElementById('convertError');
    err.classList.remove('on');
    err.textContent = '';

    if (fromCoin === toCoin) {
      err.textContent = 'Choose different coins';
      err.classList.add('on');
    } else if (amount > getCoinBalance(fromCoin)) {
      err.textContent = 'Insufficient ' + fromCoin;
      err.classList.add('on');
    }
  }

  window.executeConvert = function () {
    var amount = parseFloat(document.getElementById('convertAmount').value) || 0;
    var fromCoin = document.getElementById('convertFrom').value;
    var toCoin = document.getElementById('convertTo').value;

    var err = document.getElementById('convertError');
    err.classList.remove('on');
    err.textContent = '';

    if (fromCoin === toCoin) { err.textContent = 'Choose different coins'; err.classList.add('on'); return; }
    if (amount <= 0) { err.textContent = 'Enter amount'; err.classList.add('on'); return; }

    var fromBalance = getCoinBalance(fromCoin);
    if (amount > fromBalance) { err.textContent = 'Insufficient ' + fromCoin; err.classList.add('on'); return; }

    var fromPrice = getCoinPrice(fromCoin);
    var toPrice = getCoinPrice(toCoin);
    if (fromPrice <= 0 || toPrice <= 0) { err.textContent = 'Price unavailable'; err.classList.add('on'); return; }

    var rate = fromPrice / toPrice;
    var result = amount * rate;

    // Update balances
    setCoinBalance(fromCoin, fromBalance - amount);
    setCoinBalance(toCoin, getCoinBalance(toCoin) + result);

    // Add transaction
    if (!Array.isArray(window.st.txs)) window.st.txs = [];
    window.st.txs.unshift({
      date: new Date().toISOString().slice(0, 10),
      ts: Date.now(),
      desc: 'Convert ' + fmtCrypto(amount, fromCoin) + ' → ' + fmtCrypto(result, toCoin),
      amt: 0,
      status: 'Completed',
      symbol: toCoin,
      crypto: result,
      tradeType: 'convert'
    });

    if (!Array.isArray(window.st.trades)) window.st.trades = [];
    window.st.trades.unshift({
      ts: Date.now(),
      type: 'convert',
      from: fromCoin,
      to: toCoin,
      amount: amount,
      result: result,
      rate: rate
    });

    if (typeof window.saveToServer === 'function') window.saveToServer();
    if (typeof window.render === 'function') window.render();

    closeTradeModal('convertModal');
    showTradeSuccess({
      title: 'Convert successful',
      desc: 'Your assets have been swapped',
      amount: '+' + fmtCrypto(result, toCoin),
      details: [
        { label: 'From', value: fmtCrypto(amount, fromCoin) },
        { label: 'To', value: fmtCrypto(result, toCoin) },
        { label: 'Rate', value: '1 ' + fromCoin + ' = ' + rate.toFixed(8) + ' ' + toCoin }
      ]
    });

    if (typeof window.playChime === 'function') window.playChime();
    if (typeof window.addNotification === 'function') {
      window.addNotification('Converted ' + fmtCrypto(amount, fromCoin) + ' → ' + fmtCrypto(result, toCoin), '🔄');
    }
  };

  // ---------- SUCCESS MODAL ----------
  function showTradeSuccess(data) {
    document.getElementById('tradeSuccessTitle').textContent = data.title || 'Trade executed';
    document.getElementById('tradeSuccessDesc').textContent = data.desc || '';
    document.getElementById('tradeSuccessAmount').textContent = data.amount || '';
    var detailsEl = document.getElementById('tradeSuccessDetails');
    var html = '';
    (data.details || []).forEach(function (row) {
      html += '<div><span>' + row.label + '</span><b>' + row.value + '</b></div>';
    });
    detailsEl.innerHTML = html;
    document.getElementById('tradeSuccessModal').classList.add('on');
  }

  // ---------- BINDINGS ----------
  // Coin selector for Buy
  document.querySelectorAll('#buyCoinSelector .trade-coin-btn').forEach(function (btn) {
    btn.onclick = function () {
      document.querySelectorAll('#buyCoinSelector .trade-coin-btn').forEach(function (b) { b.classList.remove('on'); });
      this.classList.add('on');
      window._tradeCoin = this.getAttribute('data-coin');
      updateBuyPreview();
    };
  });

  // Coin selector for Sell
  document.querySelectorAll('#sellCoinSelector .trade-coin-btn').forEach(function (btn) {
    btn.onclick = function () {
      document.querySelectorAll('#sellCoinSelector .trade-coin-btn').forEach(function (b) { b.classList.remove('on'); });
      this.classList.add('on');
      window._sellCoin = this.getAttribute('data-coin');
      updateSellPreview();
    };
  });

  // Input listeners
  var _buyInput = document.getElementById('buyAmount');
  if (_buyInput) _buyInput.addEventListener('input', updateBuyPreview);

  var _sellInput = document.getElementById('sellAmount');
  if (_sellInput) _sellInput.addEventListener('input', updateSellPreview);

  // Mask click → close
  ['buyModal', 'sellModal', 'convertModal', 'tradeSuccessModal'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) {
      el.addEventListener('click', function (e) {
        if (e.target === el) el.classList.remove('on');
      });
    }
  });

  // Esc close
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      ['buyModal', 'sellModal', 'convertModal', 'tradeSuccessModal'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el && el.classList.contains('on')) el.classList.remove('on');
      });
    }
  });

  console.log('%c[NordicCrypto] 💱 Trade Terminal ready (Buy/Sell/Convert)', 'color:#22d3ee;font-weight:bold');
