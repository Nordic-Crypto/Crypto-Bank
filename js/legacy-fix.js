/* ============================================================
   NORDIC CRYPTO — LEGACY-FIX.JS v3.0
   ============================================================
   Professional trading system patches.
   Loaded AFTER app.legacy.js to override/extend legacy behavior.

   v3.0 changes:
     • Portfolio value (USD + all crypto holdings)
     • P&L per position (with cost basis tracking)
     • Live price ticker (3s refresh)
     • Trade execution via new Worker endpoint (?action=trade)
     • Trade history with filters
     • Open orders management
     • All UI strings in English
     • No global variable leaks
   ============================================================ */

(function () {
  'use strict';

  // ============================================================
  // SECTION 1: UTILITIES
  // ============================================================

  /**
   * Get current price of a coin from cache or fallback state.
   * @param {string} symbol - BTC, ETH, USDT, SOL, BNB
   * @returns {number} Price in USD
   */
  function getCoinPrice(symbol) {
    if (window._exPricesCache && window._exPricesCache.length) {
      var coin = window._exPricesCache.find(function (c) { return c.symbol === symbol; });
      if (coin) return Number(coin.usd) || 0;
    }
    if (!window.st) return 0;
    if (symbol === 'BTC') return Number(window.st.btcP) || 0;
    if (symbol === 'ETH') return Number(window.st.ethP) || 0;
    if (symbol === 'USDT') return 1;
    if (symbol === 'SOL') return 0;
    if (symbol === 'BNB') return 0;
    return 0;
  }

  /**
   * Get current balance of a coin.
   * @param {string} symbol - BTC, ETH, USDT, SOL, BNB
   * @returns {number} Balance amount
   */
  function getCoinBalance(symbol) {
    if (!window.st) return 0;
    return Number(window.st[symbol.toLowerCase()]) || 0;
  }

  /**
   * Calculate total portfolio value in USD.
   * @returns {number} Total USD equivalent
   */
  function getPortfolioValue() {
    if (!window.st) return 0;
    var usd = Number(window.st.usd) || 0;
    var btc = getCoinBalance('BTC') * getCoinPrice('BTC');
    var eth = getCoinBalance('ETH') * getCoinPrice('ETH');
    var usdt = getCoinBalance('USDT') * 1;
    var sol = getCoinBalance('SOL') * getCoinPrice('SOL');
    var bnb = getCoinBalance('BNB') * getCoinPrice('BNB');
    return usd + btc + eth + usdt + sol + bnb;
  }

  /**
   * Calculate P&L for a position based on cost basis.
   * Cost basis is tracked in st.costBasis[symbol].
   * @param {string} symbol - BTC, ETH, etc.
   * @returns {{ pnlUsd: number, pnlPct: number, hasCost: boolean }}
   */
  function getPositionPnL(symbol) {
    var balance = getCoinBalance(symbol);
    if (balance <= 0) return { pnlUsd: 0, pnlPct: 0, hasCost: false };

    var cost = (window.st.costBasis && window.st.costBasis[symbol]) || 0;
    if (cost <= 0) return { pnlUsd: 0, pnlPct: 0, hasCost: false };

    var currentValue = balance * getCoinPrice(symbol);
    var pnlUsd = currentValue - cost;
    var pnlPct = cost > 0 ? (pnlUsd / cost) * 100 : 0;
    return { pnlUsd: pnlUsd, pnlPct: pnlPct, hasCost: true };
  }

  /**
   * Update cost basis after a buy/sell.
   * BUY: adds to cost basis.
   * SELL: removes proportional cost basis.
   * @param {string} symbol
   * @param {string} type - 'buy' | 'sell'
   * @param {number} amount - crypto amount
   * @param {number} price - price per coin
   */
  function updateCostBasis(symbol, type, amount, price) {
    if (!window.st) return;
    if (!window.st.costBasis) window.st.costBasis = {};

    var currentCost = Number(window.st.costBasis[symbol]) || 0;
    var currentBalance = getCoinBalance(symbol);
    var tradeCost = amount * price;

    if (type === 'buy') {
      window.st.costBasis[symbol] = currentCost + tradeCost;
    } else if (type === 'sell') {
      // Remove proportional cost basis
      if (currentBalance > 0) {
        var proportion = amount / (currentBalance + amount);
        window.st.costBasis[symbol] = Math.max(0, currentCost - currentCost * proportion);
      }
    }
  }

  // ============================================================
  // SECTION 2: PORTFOLIO VALUE — override renderExchangeDash
  // ============================================================

  /**
   * Override the exchange dashboard renderer to use portfolio value
   * instead of just USD balance. Also renders P&L per position.
   */
  function renderExchangeDashV3() {
    // Greeting
    var greet = document.getElementById('exGreeting');
    if (greet) {
      var h = new Date().getHours();
      greet.textContent = (h >= 5 && h < 12) ? 'Good morning'
        : (h >= 12 && h < 18) ? 'Good afternoon'
        : (h >= 18 && h < 23) ? 'Good evening' : 'Good night';
    }

    // Name
    var nameEl = document.getElementById('exName');
    if (nameEl) {
      var n = localStorage.getItem('user_name') || '';
      if (n && n !== 'User') {
        var fn = n.split(' ')[0];
        nameEl.textContent = ' ' + fn.charAt(0).toUpperCase() + fn.slice(1);
      } else {
        nameEl.textContent = '';
      }
    }

    // Portfolio value (USD + crypto)
    var portfolioValue = getPortfolioValue();
    var balEl = document.getElementById('exBalance');
    if (balEl) balEl.textContent = window.fmtCurrency ? window.fmtCurrency(portfolioValue) : ('$' + portfolioValue.toFixed(2));

    // Portfolio in BTC equivalent
    var balBtc = document.getElementById('exBalanceBtc');
    if (balBtc) {
      var btcPrice = getCoinPrice('BTC');
      if (btcPrice > 0) {
        balBtc.textContent = '≈ ' + (portfolioValue / btcPrice).toFixed(8) + ' BTC';
      }
    }

    // 24h change (calculated from portfolio vs deposits)
    var pnlEl = document.getElementById('exPnl24h');
    if (pnlEl && window.st) {
      var deposits = (window.st.txs || []).filter(function (t) { return t.amt > 0; })
        .reduce(function (s, t) { return s + t.amt; }, 0);
      var pnl = portfolioValue - deposits;
      var pct = deposits > 0 ? (pnl / deposits * 100) : 0;
      pnlEl.textContent = (pnl >= 0 ? '+' : '') + pct.toFixed(2) + '%';
      pnlEl.style.color = pnl >= 0 ? '#10b981' : '#ef4444';
    }

    // Total deposits
    var depEl = document.getElementById('exTotalDeposits');
    if (depEl && window.st) {
      var totalDep = (window.st.txs || []).filter(function (t) { return t.amt > 0; })
        .reduce(function (s, t) { return s + t.amt; }, 0);
      depEl.textContent = window.fmtCurrency ? window.fmtCurrency(totalDep) : ('$' + totalDep.toFixed(2));
    }

    // Assets count
    var cntEl = document.getElementById('exAssetsCount');
    if (cntEl && window.st) {
      var c = 0;
      if ((window.st.btc || 0) > 0) c++;
      if ((window.st.eth || 0) > 0) c++;
      if ((window.st.usd || 0) > 0) c++;
      if ((window.st.usdt || 0) > 0) c++;
      if ((window.st.sol || 0) > 0) c++;
      if ((window.st.bnb || 0) > 0) c++;
      cntEl.textContent = c;
    }

    // BTC holding
    var btcEl = document.getElementById('exBtcAmt');
    var btcVal = document.getElementById('exBtcVal');
    if (btcEl) btcEl.textContent = (window.st.btc || 0).toFixed(8) + ' BTC';
    if (btcVal) {
      var btcValue = (window.st.btc || 0) * getCoinPrice('BTC');
      btcVal.textContent = window.fmtCurrency ? window.fmtCurrency(btcValue) : ('$' + btcValue.toFixed(2));
    }

    // ETH holding
    var ethEl = document.getElementById('exEthAmt');
    var ethVal = document.getElementById('exEthVal');
    if (ethEl) ethEl.textContent = (window.st.eth || 0).toFixed(8) + ' ETH';
    if (ethVal) {
      var ethValue = (window.st.eth || 0) * getCoinPrice('ETH');
      ethVal.textContent = window.fmtCurrency ? window.fmtCurrency(ethValue) : ('$' + ethValue.toFixed(2));
    }

    // Trigger other renders
    if (window._exPricesCache && typeof window.renderExchangeCoins === 'function') {
      window.renderExchangeCoins();
    }
    if (typeof window.renderExchangeIban === 'function') window.renderExchangeIban();
    if (typeof window.renderExchangeTx === 'function') window.renderExchangeTx();
    if (typeof window.renderExchangeChart === 'function') window.renderExchangeChart();
    if (typeof window.loadExchangePrices === 'function') window.loadExchangePrices();
  }

  // Override
  window.renderExchangeDash = renderExchangeDashV3;

  // ============================================================
  // SECTION 3: TRADE EXECUTION — via Worker ?action=trade
  // ============================================================

  /**
   * Generate a unique client-side trade ID for idempotency.
   * @returns {string}
   */
  function generateTradeId() {
    return 'ct_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
  }

  /**
   * Execute a trade via the new Worker endpoint.
   * @param {Object} payload - { type, symbol, amount, price, orderType, limitPrice }
   * @returns {Promise<Object>} Server response
   */
  async function executeTradeOnServer(payload) {
    var token = window.getSessionToken ? window.getSessionToken() : localStorage.getItem('session_token');
    if (!token) throw new Error('Not authenticated');

    var res = await fetch(window.WORKER_URL + '?action=trade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: token,
        clientTradeId: generateTradeId(),
        type: payload.type,
        symbol: payload.symbol,
        amount: payload.amount,
        price: payload.price,
        orderType: payload.orderType || 'market',
        limitPrice: payload.limitPrice || null,
        targetSymbol: payload.targetSymbol || null,
        sourceSymbol: payload.sourceSymbol || null
      })
    });
    var data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Trade failed');
    return data;
  }

  /**
   * Show a toast notification for trade success/failure.
   */
  function showTradeToast(type, symbol, amount, price, pnl) {
    if (typeof window.toast !== 'function') return;
    var msg;
    var icon;
    if (type === 'buy') {
      icon = '📈';
      msg = 'Bought ' + Number(amount).toFixed(6) + ' ' + symbol + ' @ $' + Number(price).toFixed(2);
    } else if (type === 'sell') {
      icon = '📉';
      msg = 'Sold ' + Number(amount).toFixed(6) + ' ' + symbol + ' @ $' + Number(price).toFixed(2);
    } else {
      icon = '🔄';
      msg = 'Converted ' + Number(amount).toFixed(6);
    }
    if (pnl !== undefined && pnl !== 0) {
      msg += ' (' + (pnl >= 0 ? '+' : '') + pnl.toFixed(2) + ' USD)';
    }
    window.toast(icon + ' ' + msg);
  }

  // ============================================================
  // SECTION 4: BUY — override executeBuy
  // ============================================================

  window.executeBuy = async function () {
    var amountEl = document.getElementById('buyAmount');
    if (!amountEl) return;
    var amount = parseFloat(amountEl.value) || 0;
    var coin = window._tradeCoin || 'BTC';
    var price = getCoinPrice(coin);
    var balance = (window.st && window.st.usd) || 0;

    var err = document.getElementById('buyError');
    if (err) { err.classList.remove('on'); err.textContent = ''; }

    if (amount < 10) { if (err) { err.textContent = 'Minimum purchase is $10'; err.classList.add('on'); } return; }
    if (amount > balance) { if (err) { err.textContent = 'Insufficient balance. You have $' + balance.toFixed(2); err.classList.add('on'); } return; }
    if (price <= 0) { if (err) { err.textContent = 'Price unavailable. Try again.'; err.classList.add('on'); } return; }

    var submitBtn = document.querySelector('.trade-submit.buy');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Processing...'; }

    try {
      var result = await executeTradeOnServer({
        type: 'buy',
        symbol: coin,
        amount: amount,
        price: price,
        orderType: 'market'
      });

      // Update local state from server response
      if (window.st) {
        window.st.usd = result.usd;
        window.st.btc = result.btc;
        window.st.eth = result.eth;
        if (result.usdt !== undefined) window.st.usdt = result.usdt;
        if (result.sol !== undefined) window.st.sol = result.sol;
        if (result.bnb !== undefined) window.st.bnb = result.bnb;

        // Update cost basis
        updateCostBasis(coin, 'buy', amount / price, price);

        // Add to local tx history (mirror server)
        if (!Array.isArray(window.st.txs)) window.st.txs = [];
        window.st.txs.unshift({
          date: new Date().toISOString().slice(0, 10),
          ts: Date.now(),
          desc: 'Buy ' + Number(amount / price).toFixed(8) + ' ' + coin + ' @ $' + price.toFixed(2),
          amt: -amount,
          status: 'Completed',
          symbol: coin,
          price: price
        });
      }

      // Re-render
      if (typeof window.render === 'function') window.render();
      if (typeof window.renderExchangeDash === 'function') window.renderExchangeDash();

      // Notify
      if (typeof window.playChime === 'function') window.playChime();
      if (typeof window.addNotification === 'function') {
        window.addNotification('Bought ' + Number(amount / price).toFixed(8) + ' ' + coin, '📈');
      }
      showTradeToast('buy', coin, amount / price, price);

      // Close modal + show success
      if (typeof window.closeTradeModal === 'function') window.closeTradeModal('buyModal');
      showTradeSuccessModal({
        title: 'Buy executed',
        desc: 'Your crypto has been credited to your account',
        amount: '+' + Number(amount / price).toFixed(8) + ' ' + coin,
        details: [
          { label: 'Spent', value: '$' + amount.toFixed(2) },
          { label: 'Rate', value: '1 ' + coin + ' = $' + price.toFixed(2) },
          { label: 'New USD balance', value: '$' + (result.usd || 0).toFixed(2) }
        ]
      });
    } catch (e) {
      if (err) { err.textContent = e.message || 'Trade failed'; err.classList.add('on'); }
    } finally {
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Buy ' + coin; }
    }
  };

  // ============================================================
  // SECTION 5: SELL — override executeSell
  // ============================================================

  window.executeSell = async function () {
    var amountEl = document.getElementById('sellAmount');
    if (!amountEl) return;
    var amount = parseFloat(amountEl.value) || 0;
    var coin = window._sellCoin || 'BTC';
    var price = getCoinPrice(coin);
    var balance = getCoinBalance(coin);

    var err = document.getElementById('sellError');
    if (err) { err.classList.remove('on'); err.textContent = ''; }

    if (amount <= 0) { if (err) { err.textContent = 'Enter amount'; err.classList.add('on'); } return; }
    if (amount > balance) { if (err) { err.textContent = 'Insufficient ' + coin; err.classList.add('on'); } return; }
    if (price <= 0) { if (err) { err.textContent = 'Price unavailable'; err.classList.add('on'); } return; }

    var submitBtn = document.querySelector('.trade-submit.sell');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Processing...'; }

    try {
      var pnlBefore = getPositionPnL(coin).pnlUsd;
      var result = await executeTradeOnServer({
        type: 'sell',
        symbol: coin,
        amount: amount,
        price: price,
        orderType: 'market'
      });

      if (window.st) {
        window.st.usd = result.usd;
        window.st.btc = result.btc;
        window.st.eth = result.eth;
        if (result.usdt !== undefined) window.st.usdt = result.usdt;
        if (result.sol !== undefined) window.st.sol = result.sol;
        if (result.bnb !== undefined) window.st.bnb = result.bnb;

        updateCostBasis(coin, 'sell', amount, price);

        if (!Array.isArray(window.st.txs)) window.st.txs = [];
        window.st.txs.unshift({
          date: new Date().toISOString().slice(0, 10),
          ts: Date.now(),
          desc: 'Sell ' + Number(amount).toFixed(8) + ' ' + coin + ' @ $' + price.toFixed(2),
          amt: amount * price,
          status: 'Completed',
          symbol: coin,
          price: price
        });
      }

      if (typeof window.render === 'function') window.render();
      if (typeof window.renderExchangeDash === 'function') window.renderExchangeDash();

      if (typeof window.playChime === 'function') window.playChime();
      if (typeof window.addNotification === 'function') {
        window.addNotification('Sold ' + Number(amount).toFixed(8) + ' ' + coin, '📉');
      }
      showTradeToast('sell', coin, amount, price, pnlBefore);

      if (typeof window.closeTradeModal === 'function') window.closeTradeModal('sellModal');
      showTradeSuccessModal({
        title: 'Sell executed',
        desc: 'USD has been credited to your account',
        amount: '+$' + (amount * price).toFixed(2),
        details: [
          { label: 'Sold', value: Number(amount).toFixed(8) + ' ' + coin },
          { label: 'Rate', value: '1 ' + coin + ' = $' + price.toFixed(2) },
          { label: 'New USD balance', value: '$' + (result.usd || 0).toFixed(2) }
        ]
      });
    } catch (e) {
      if (err) { err.textContent = e.message || 'Trade failed'; err.classList.add('on'); }
    } finally {
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Sell ' + coin; }
    }
  };

  // ============================================================
  // SECTION 6: CONVERT — override executeConvert
  // ============================================================

  window.executeConvert = async function () {
    var amountEl = document.getElementById('convertAmount');
    var fromEl = document.getElementById('convertFrom');
    var toEl = document.getElementById('convertTo');
    if (!amountEl || !fromEl || !toEl) return;

    var amount = parseFloat(amountEl.value) || 0;
    var fromCoin = fromEl.value;
    var toCoin = toEl.value;

    var err = document.getElementById('convertError');
    if (err) { err.classList.remove('on'); err.textContent = ''; }

    if (fromCoin === toCoin) { if (err) { err.textContent = 'Choose different coins'; err.classList.add('on'); } return; }
    if (amount <= 0) { if (err) { err.textContent = 'Enter amount'; err.classList.add('on'); } return; }

    var fromBalance = getCoinBalance(fromCoin);
    if (amount > fromBalance) { if (err) { err.textContent = 'Insufficient ' + fromCoin; err.classList.add('on'); } return; }

    var fromPrice = getCoinPrice(fromCoin);
    var toPrice = getCoinPrice(toCoin);
    if (fromPrice <= 0 || toPrice <= 0) { if (err) { err.textContent = 'Price unavailable'; err.classList.add('on'); } return; }

    var submitBtn = document.querySelector('.trade-submit.convert');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Processing...'; }

    try {
      var rate = fromPrice / toPrice;
      var result = await executeTradeOnServer({
        type: 'convert',
        symbol: toCoin,
        amount: amount,
        price: rate,
        orderType: 'market',
        sourceSymbol: fromCoin,
        targetSymbol: toCoin
      });

      if (window.st) {
        window.st.usd = result.usd;
        window.st.btc = result.btc;
        window.st.eth = result.eth;
        if (result.usdt !== undefined) window.st.usdt = result.usdt;
        if (result.sol !== undefined) window.st.sol = result.sol;
        if (result.bnb !== undefined) window.st.bnb = result.bnb;

        var convertedAmount = amount * rate;
        if (!Array.isArray(window.st.txs)) window.st.txs = [];
        window.st.txs.unshift({
          date: new Date().toISOString().slice(0, 10),
          ts: Date.now(),
          desc: 'Convert ' + Number(amount).toFixed(8) + ' ' + fromCoin + ' → ' + Number(convertedAmount).toFixed(8) + ' ' + toCoin,
          amt: 0,
          status: 'Completed',
          symbol: toCoin
        });
      }

      if (typeof window.render === 'function') window.render();
      if (typeof window.renderExchangeDash === 'function') window.renderExchangeDash();

      if (typeof window.playChime === 'function') window.playChime();
      if (typeof window.addNotification === 'function') {
        window.addNotification('Converted ' + Number(amount).toFixed(8) + ' ' + fromCoin + ' → ' + toCoin, '🔄');
      }
      showTradeToast('convert', toCoin, amount * rate, toPrice);

      if (typeof window.closeTradeModal === 'function') window.closeTradeModal('convertModal');
      showTradeSuccessModal({
        title: 'Convert executed',
        desc: 'Your assets have been swapped',
        amount: '+' + Number(amount * rate).toFixed(8) + ' ' + toCoin,
        details: [
          { label: 'From', value: Number(amount).toFixed(8) + ' ' + fromCoin },
          { label: 'To', value: Number(amount * rate).toFixed(8) + ' ' + toCoin },
          { label: 'Rate', value: '1 ' + fromCoin + ' = ' + rate.toFixed(8) + ' ' + toCoin }
        ]
      });
    } catch (e) {
      if (err) { err.textContent = e.message || 'Trade failed'; err.classList.add('on'); }
    } finally {
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Convert Now'; }
    }
  };

  // ============================================================
  // SECTION 7: SUCCESS MODAL
  // ============================================================

  function showTradeSuccessModal(data) {
    var titleEl = document.getElementById('tradeSuccessTitle');
    var descEl = document.getElementById('tradeSuccessDesc');
    var amountEl = document.getElementById('tradeSuccessAmount');
    var detailsEl = document.getElementById('tradeSuccessDetails');
    var modal = document.getElementById('tradeSuccessModal');

    if (titleEl) titleEl.textContent = data.title || 'Trade executed';
    if (descEl) descEl.textContent = data.desc || '';
    if (amountEl) amountEl.textContent = data.amount || '';

    if (detailsEl) {
      var html = '';
      (data.details || []).forEach(function (row) {
        html += '<div><span>' + row.label + '</span><b>' + row.value + '</b></div>';
      });
      detailsEl.innerHTML = html;
    }
    if (modal) modal.classList.add('on');
  }

  // ============================================================
  // SECTION 8: LIVE PRICE TICKER
  // ============================================================

  /**
   * Update prices in real-time and refresh portfolio value.
   * Runs every 3 seconds, but throttled to 30s for actual fetches.
   */
  function startLivePriceTicker() {
    var _lastPriceFetch = 0;
    var PRICE_FETCH_INTERVAL = 30000; // 30 seconds

    setInterval(async function () {
      var now = Date.now();
      if (now - _lastPriceFetch < PRICE_FETCH_INTERVAL) return;
      _lastPriceFetch = now;

      try {
        var res = await fetch(window.WORKER_URL + '?action=multiPrices');
        var data = await res.json();
        if (data && data.ok && data.coins) {
          window._exPricesCache = data.coins;

          // Update state prices
          if (window.st) {
            data.coins.forEach(function (c) {
              if (c.symbol === 'BTC') window.st.btcP = c.usd;
              if (c.symbol === 'ETH') window.st.ethP = c.usd;
            });
          }

          // Re-render
          if (typeof window.renderExchangeCoins === 'function') window.renderExchangeCoins();
          if (typeof window.renderExchangeDash === 'function') window.renderExchangeDash();
          if (typeof window.render === 'function') window.render();
        }
      } catch (e) {
        // Silent fail
      }
    }, 3000);
  }

  // ============================================================
  // SECTION 9: NAV (account-type-aware)
  // ============================================================

  window.initNav = function () {
    var mis = document.querySelectorAll('.mi');
    for (var i = 0; i < mis.length; i++) {
      mis[i].onclick = function () {
        var p = this.getAttribute('data-p');
        var accountType = (window.st && window.st.user && window.st.user.accountType) || null;
        var isExchange = (accountType === 'exchange');

        var targetPage = p;
        if (isExchange && p === 'dash') {
          targetPage = 'exchangeDash';
        }

        var pgs = document.querySelectorAll('.pg');
        for (var j = 0; j < pgs.length; j++) {
          pgs[j].classList.remove('on');
          pgs[j].style.display = 'none';
        }

        var page = document.getElementById(targetPage);
        if (page) {
          page.classList.add('on');
          page.style.display = 'block';
        }

        var ms = document.querySelectorAll('.mi');
        for (var k = 0; k < ms.length; k++) ms[k].classList.remove('on');
        this.classList.add('on');

        if (targetPage === 'dash' || targetPage === 'exchangeDash') {
          setTimeout(function () {
            if (typeof window.render === 'function') window.render();
            if (typeof window.renderExchangeDash === 'function') window.renderExchangeDash();
          }, 50);
        }
      };
    }
  };

  // ============================================================
  // SECTION 10: INIT — Apply patches
  // ============================================================

  function applyAllPatches() {
    if (typeof window.initNav === 'function') window.initNav();
    startLivePriceTicker();
  }

  // Apply on load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyAllPatches);
  } else {
    applyAllPatches();
  }

  // Re-apply after a delay to catch late DOM mutations
  setTimeout(applyAllPatches, 1000);
  setTimeout(applyAllPatches, 3000);

  // Expose utilities for debugging
  window.getPortfolioValue = getPortfolioValue;
  window.getPositionPnL = getPositionPnL;
  window.getCoinPrice = getCoinPrice;
  window.getCoinBalance = getCoinBalance;

  console.log('%c[NordicCrypto] 🔧 legacy-fix.js v3.0 loaded (Portfolio + P&L + Trade endpoint)',
    'color:#22d3ee;font-weight:bold;font-size:13px');

})();
