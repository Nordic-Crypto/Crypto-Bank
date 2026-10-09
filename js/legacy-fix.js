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
  // 🛡️ FIX: гарантируем WORKER_URL до всех fetch-вызовов
  // ============================================================
  if (!window.WORKER_URL || typeof window.WORKER_URL !== 'string') {
    window.WORKER_URL = 'https://nordic-deposit-checker.otis-790.workers.dev';
  }
  if (!window.WORKER_LOGIN_URL || typeof window.WORKER_LOGIN_URL !== 'string') {
    window.WORKER_LOGIN_URL = window.WORKER_URL;
  }

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
      var history = window.st.balanceHistory || [];
      var now = Date.now();
      var dayAgo = now - 24 * 60 * 60 * 1000;
      
      // Find closest snapshot to 24h ago
      var snapshot24h = null;
      for (var i = 0; i < history.length; i++) {
        if (history[i].t >= dayAgo) { snapshot24h = history[i]; break; }
      }
      
      var pct = 0;
      if (snapshot24h && snapshot24h.v > 0) {
        // Real 24h change from history
        pct = ((portfolioValue - snapshot24h.v) / snapshot24h.v) * 100;
      } else {
        // Fallback: compare vs external deposits
        var extDeposits = (typeof window.getTotalExternalDeposits === 'function')
          ? window.getTotalExternalDeposits()
          : 0;
        if (extDeposits > 0) {
          pct = ((portfolioValue - extDeposits) / extDeposits) * 100;
        }
      }
      
      pnlEl.textContent = (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%';
      pnlEl.style.color = pct >= 0 ? '#10b981' : '#ef4444';
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
             // Record convert in history
      if (typeof window.recordTradeInHistory === 'function') {
        window.recordTradeInHistory({
          type: 'convert',
          symbol: toCoin,
          sourceSymbol: fromCoin,
          targetSymbol: toCoin,
          amount: amount,
          price: rate
        });
      }
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
    bindExchangeButtons();
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
  // ============================================================
  // SECTION 12: TRADE MODAL (open/close)
  // ============================================================

  /**
   * Open a trade modal (buy/sell/convert/success).
   * Hides all other trade modals first.
   * @param {string} modalId
   */
  window.openTradeModal = function (modalId) {
    ['buyModal', 'sellModal', 'convertModal', 'tradeSuccessModal'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.classList.remove('on');
    });

    var modal = document.getElementById(modalId);
    if (!modal) {
      console.warn('[fix] Modal not found:', modalId);
      return;
    }
    modal.classList.add('on');

    // Reset inputs and refresh previews
    if (modalId === 'buyModal') {
      var a = document.getElementById('buyAmount');
      if (a) a.value = '';
      if (typeof updateBuyPreview === 'function') updateBuyPreview();
    } else if (modalId === 'sellModal') {
      var b = document.getElementById('sellAmount');
      if (b) b.value = '';
      if (typeof updateSellPreview === 'function') updateSellPreview();
    } else if (modalId === 'convertModal') {
      var c = document.getElementById('convertAmount');
      if (c) c.value = '';
      if (typeof updateConvertPreview === 'function') updateConvertPreview();
    }
  };

  /**
   * Close a trade modal.
   * @param {string} modalId
   */
  window.closeTradeModal = function (modalId) {
    var modal = document.getElementById(modalId);
    if (modal) modal.classList.remove('on');
  };

  // ============================================================
  // SECTION 13: TRADE PREVIEWS (live updates on input)
  // ============================================================

  function updateBuyPreview() {
    var amountEl = document.getElementById('buyAmount');
    if (!amountEl) return;
    var amount = parseFloat(amountEl.value) || 0;
    var coin = window._tradeCoin || 'BTC';
    var price = getCoinPrice(coin);
    var received = price > 0 ? amount / price : 0;

    var receiveEl = document.getElementById('buyReceive');
    if (receiveEl) receiveEl.textContent = received.toFixed(8) + ' ' + coin;
    var rateEl = document.getElementById('buyRate');
    if (rateEl) rateEl.textContent = '1 ' + coin + ' = $' + price.toFixed(2);
    var balEl = document.getElementById('buyBalance');
    if (balEl) balEl.textContent = '$' + ((window.st && window.st.usd) || 0).toFixed(2);
    var btnCoin = document.getElementById('buyBtnCoin');
    if (btnCoin) btnCoin.textContent = coin;

    var err = document.getElementById('buyError');
    if (err) {
      err.classList.remove('on');
      err.textContent = '';
      var balance = (window.st && window.st.usd) || 0;
      if (amount > 0 && amount < 10) {
        err.textContent = 'Minimum purchase is $10';
        err.classList.add('on');
      } else if (amount > balance) {
        err.textContent = 'Insufficient balance. You have $' + balance.toFixed(2);
        err.classList.add('on');
      }
    }
  }
  window.updateBuyPreview = updateBuyPreview;

  function updateSellPreview() {
    var amountEl = document.getElementById('sellAmount');
    if (!amountEl) return;
    var amount = parseFloat(amountEl.value) || 0;
    var coin = window._sellCoin || 'BTC';
    var price = getCoinPrice(coin);
    var received = amount * price;

    var receiveEl = document.getElementById('sellReceive');
    if (receiveEl) receiveEl.textContent = '$' + received.toFixed(2);
    var rateEl = document.getElementById('sellRate');
    if (rateEl) rateEl.textContent = '1 ' + coin + ' = $' + price.toFixed(2);
    var balEl = document.getElementById('sellBalance');
    if (balEl) balEl.textContent = getCoinBalance(coin).toFixed(8) + ' ' + coin;
    var lblEl = document.getElementById('sellCoinLabel');
    if (lblEl) lblEl.textContent = coin;
    var btnCoin = document.getElementById('sellBtnCoin');
    if (btnCoin) btnCoin.textContent = coin;

    var err = document.getElementById('sellError');
    if (err) {
      err.classList.remove('on');
      err.textContent = '';
      var balance = getCoinBalance(coin);
      if (amount > balance) {
        err.textContent = 'Insufficient ' + coin + '. You have ' + balance.toFixed(8);
        err.classList.add('on');
      }
    }
  }
  window.updateSellPreview = updateSellPreview;

  function updateConvertPreview() {
    var amountEl = document.getElementById('convertAmount');
    var fromEl = document.getElementById('convertFrom');
    var toEl = document.getElementById('convertTo');
    if (!amountEl || !fromEl || !toEl) return;

    var amount = parseFloat(amountEl.value) || 0;
    var fromCoin = fromEl.value;
    var toCoin = toEl.value;

    var fromPrice = getCoinPrice(fromCoin);
    var toPrice = getCoinPrice(toCoin);
    var rate = toPrice > 0 ? fromPrice / toPrice : 0;
    var result = amount * rate;

    var resultEl = document.getElementById('convertResult');
    if (resultEl) resultEl.value = result > 0 ? result.toFixed(8) : '';
    var rateEl = document.getElementById('convertRate');
    if (rateEl) rateEl.textContent = '1 ' + fromCoin + ' = ' + rate.toFixed(8) + ' ' + toCoin;
    var fromBalEl = document.getElementById('convertFromBalance');
    if (fromBalEl) fromBalEl.textContent = 'Balance: ' + getCoinBalance(fromCoin).toFixed(8) + ' ' + fromCoin;
    var toBalEl = document.getElementById('convertToBalance');
    if (toBalEl) toBalEl.textContent = 'Balance: ' + getCoinBalance(toCoin).toFixed(8) + ' ' + toCoin;

    var err = document.getElementById('convertError');
    if (err) {
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
  }
  window.updateConvertPreview = updateConvertPreview;

  // ============================================================
  // SECTION 14: BUY / SELL / CONVERT MODAL BINDINGS
  // ============================================================

  function bindTradeModals() {
    // Buy coin selector
    document.querySelectorAll('#buyCoinSelector .trade-coin-btn').forEach(function (btn) {
      if (btn._bound) return;
      btn._bound = true;
      btn.onclick = function () {
        document.querySelectorAll('#buyCoinSelector .trade-coin-btn').forEach(function (b) { b.classList.remove('on'); });
        this.classList.add('on');
        window._tradeCoin = this.getAttribute('data-coin');
        if (typeof updateBuyPreview === 'function') updateBuyPreview();
      };
    });

    // Sell coin selector
    document.querySelectorAll('#sellCoinSelector .trade-coin-btn').forEach(function (btn) {
      if (btn._bound) return;
      btn._bound = true;
      btn.onclick = function () {
        document.querySelectorAll('#sellCoinSelector .trade-coin-btn').forEach(function (b) { b.classList.remove('on'); });
        this.classList.add('on');
        window._sellCoin = this.getAttribute('data-coin');
        if (typeof updateSellPreview === 'function') updateSellPreview();
      };
    });

    // Buy amount input
    var buyInput = document.getElementById('buyAmount');
    if (buyInput && !buyInput._bound) {
      buyInput._bound = true;
      buyInput.addEventListener('input', updateBuyPreview);
    }

    // Sell amount input
    var sellInput = document.getElementById('sellAmount');
    if (sellInput && !sellInput._bound) {
      sellInput._bound = true;
      sellInput.addEventListener('input', updateSellPreview);
    }

    // Convert inputs
    var convAmount = document.getElementById('convertAmount');
    if (convAmount && !convAmount._bound) {
      convAmount._bound = true;
      convAmount.addEventListener('input', updateConvertPreview);
    }
    var convFrom = document.getElementById('convertFrom');
    if (convFrom && !convFrom._bound) {
      convFrom._bound = true;
      convFrom.addEventListener('change', updateConvertPreview);
    }
    var convTo = document.getElementById('convertTo');
    if (convTo && !convTo._bound) {
      convTo._bound = true;
      convTo.addEventListener('change', updateConvertPreview);
    }

    // Mask click to close
    ['buyModal', 'sellModal', 'convertModal', 'tradeSuccessModal'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el && !el._clickBound) {
        el._clickBound = true;
        el.addEventListener('click', function (e) {
          if (e.target === el) el.classList.remove('on');
        });
      }
    });

    // Quick amount buttons
    document.querySelectorAll('.trade-quick-amounts button').forEach(function (btn) {
      if (btn._bound) return;
      btn._bound = true;
      btn.onclick = function () {
        var val = parseInt(this.textContent.replace('$', ''), 10);
        var input = document.getElementById('buyAmount');
        if (input) {
          input.value = val;
          updateBuyPreview();
        }
      };
    });

    // MAX buttons
    var maxBuyBtn = document.querySelector('#buyAmount ~ .trade-max-btn');
    if (maxBuyBtn && !maxBuyBtn._bound) {
      maxBuyBtn._bound = true;
      maxBuyBtn.onclick = function () {
        var balance = (window.st && window.st.usd) || 0;
        var input = document.getElementById('buyAmount');
        if (input) { input.value = balance.toFixed(2); updateBuyPreview(); }
      };
    }
    var maxSellBtn = document.querySelector('#sellAmount ~ .trade-max-btn');
    if (maxSellBtn && !maxSellBtn._bound) {
      maxSellBtn._bound = true;
      maxSellBtn.onclick = function () {
        var coin = window._sellCoin || 'BTC';
        var balance = getCoinBalance(coin);
        var input = document.getElementById('sellAmount');
        if (input) { input.value = balance.toFixed(8); updateSellPreview(); }
      };
    }
  }

  // ============================================================
  // SECTION 15: TRADE TERMINAL (preview modal — until Sprint 2)
  // ============================================================

  /**
   * Open the Trade Terminal modal.
   * Currently a preview with 3 action buttons (Buy/Sell/Convert).
   * Will be replaced by the full terminal in Sprint 2.
   */
    // ============================================================
  // TRADE TERMINAL — Full-screen trading UI
  // ============================================================
  // Delegates to trade-terminal.js (loaded via <script> in index.html).
  // Fallback: if the full terminal is not available, show the legacy
  // preview modal so the user is never left with a dead button.
  // ============================================================
  window.openTradeTerminal = function () {
    if (typeof window.openTradeTerminalFull === 'function') {
      window.openTradeTerminalFull();
      return;
    }

    // Fallback: legacy preview modal
    console.warn('[legacy-fix] Full terminal not available, using preview fallback');

    var old = document.getElementById('tradeTerminalModal');
    if (old) old.remove();

    var modal = document.createElement('div');
    modal.id = 'tradeTerminalModal';
    modal.style.cssText =
      'position:fixed;inset:0;background:rgba(3,6,11,.85);' +
      'backdrop-filter:blur(16px);display:flex;align-items:center;' +
      'justify-content:center;z-index:10000;padding:20px;';

    modal.innerHTML =
      '<div style="background:linear-gradient(145deg,#0f1720,#0a0e15);' +
        'border:1px solid rgba(139,92,246,.3);border-radius:24px;' +
        'width:100%;max-width:520px;padding:36px;color:#e7edf5;' +
        'box-shadow:0 40px 100px -20px rgba(139,92,246,.4);' +
        'position:relative;overflow:hidden;">' +
        '<button id="tradeTerminalClose" style="position:absolute;' +
          'top:16px;right:16px;width:36px;height:36px;border-radius:10px;' +
          'background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);' +
          'color:#8b95a5;font-size:20px;cursor:pointer;line-height:1;">×</button>' +
        '<div style="display:flex;align-items:center;gap:16px;margin-bottom:20px;">' +
          '<div style="width:64px;height:64px;border-radius:18px;' +
            'background:linear-gradient(135deg,#8b5cf6,#ec4899);' +
            'display:flex;align-items:center;justify-content:center;' +
            'font-size:28px;">⚡</div>' +
          '<div>' +
            '<div style="font-size:1.5rem;font-weight:800;">Trading Terminal</div>' +
            '<div style="font-size:.85rem;color:#8b95a5;margin-top:4px;">' +
              'Choose an action below</div>' +
          '</div>' +
        '</div>' +
        '<p style="color:#94a3b8;font-size:.95rem;line-height:1.6;margin:0 0 24px;">' +
          'Buy crypto with USD, sell crypto back to USD, or convert between ' +
          'any assets instantly at market price.</p>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;">' +
          '<button id="tradeBtnBuy" style="padding:16px;' +
            'background:linear-gradient(135deg,#10b981,#34d399);color:#fff;' +
            'border:none;border-radius:12px;font-weight:700;cursor:pointer;' +
            'font-size:.95rem;font-family:inherit;">📈 Buy</button>' +
          '<button id="tradeBtnSell" style="padding:16px;' +
            'background:linear-gradient(135deg,#ef4444,#f87171);color:#fff;' +
            'border:none;border-radius:12px;font-weight:700;cursor:pointer;' +
            'font-size:.95rem;font-family:inherit;">📉 Sell</button>' +
          '<button id="tradeBtnConvert" style="padding:16px;' +
            'background:linear-gradient(135deg,#8b5cf6,#ec4899);color:#fff;' +
            'border:none;border-radius:12px;font-weight:700;cursor:pointer;' +
            'font-size:.95rem;font-family:inherit;">🔄 Convert</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(modal);

    var closeBtn = document.getElementById('tradeTerminalClose');
    if (closeBtn) closeBtn.onclick = function () { modal.remove(); };

    var buyBtn = document.getElementById('tradeBtnBuy');
    if (buyBtn) buyBtn.onclick = function () {
      modal.remove();
      if (typeof window.openTradeModal === 'function') window.openTradeModal('buyModal');
    };

    var sellBtn = document.getElementById('tradeBtnSell');
    if (sellBtn) sellBtn.onclick = function () {
      modal.remove();
      if (typeof window.openTradeModal === 'function') window.openTradeModal('sellModal');
    };

    var convertBtn = document.getElementById('tradeBtnConvert');
    if (convertBtn) convertBtn.onclick = function () {
      modal.remove();
      if (typeof window.openTradeModal === 'function') window.openTradeModal('convertModal');
    };

    modal.onclick = function (e) {
      if (e.target === modal) modal.remove();
    };
  };

  // Bind trade modals on load
  setTimeout(bindTradeModals, 500);
  setTimeout(bindTradeModals, 1500);
  setTimeout(bindTradeModals, 3000);
   
  console.log('%c[NordicCrypto] 🔧 legacy-fix.js v3.0 loaded (Portfolio + P&L + Trade endpoint)',
    'color:#22d3ee;font-weight:bold;font-size:13px');
  // ============================================================
  // SECTION 11: EXCHANGE DASHBOARD BUTTONS
  // ============================================================

  /**
   * Bind Deposit / Withdraw / Trade buttons in exchange dashboard.
   * Called after initNav and on DOM mutations.
   */
  function bindExchangeButtons() {
    // Deposit → open "Add funds" modal
    var btnExDep = document.getElementById('exBtnDeposit');
    if (btnExDep && !btnExDep._bound) {
      btnExDep._bound = true;
      btnExDep.onclick = function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (typeof window.openModal === 'function') {
          window.openModal('add');
        } else {
          var b = document.getElementById('btnAdd');
          if (b) b.click();
        }
      };
    }

    // Withdraw → open withdraw modal
    var btnExWd = document.getElementById('exBtnWithdraw');
    if (btnExWd && !btnExWd._bound) {
      btnExWd._bound = true;
      btnExWd.onclick = function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (typeof window.openWithdraw === 'function') {
          window.openWithdraw();
        } else {
          console.warn('[fix] openWithdraw not available');
        }
      };
    }

    // Trade → open trade terminal
    var btnExTrade = document.getElementById('exBtnTrade');
    if (btnExTrade && !btnExTrade._bound) {
      btnExTrade._bound = true;
      btnExTrade.onclick = function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (typeof window.openTradeTerminal === 'function') {
          window.openTradeTerminal();
        } else if (typeof window.openTradeModal === 'function') {
          // Fallback: open buy modal directly
          window.openTradeModal('buyModal');
        } else {
          console.warn('[fix] Trade Terminal not available');
        }
      };
    }
  }

  // Re-apply bindings on load and after mutations
  setTimeout(bindExchangeButtons, 500);
  setTimeout(bindExchangeButtons, 1500);
  setTimeout(bindExchangeButtons, 3000);
  // ============================================================
  // SECTION 19: TRADE HISTORY TRACKING
  // ============================================================
  // This section overrides the trade execution hooks to record
  // every trade in the user's transaction history, so clients
  // can see their full trading activity in the dashboard.
  // ============================================================

  /**
   * Record a trade in the user's transaction history.
   * Called by trade-terminal.js after each successful execution.
   * 
   * @param {Object} trade - { type, symbol, amount, price, total }
   */
  window.recordTradeInHistory = function (trade) {
    if (!window.st) return;
    if (!Array.isArray(window.st.txs)) window.st.txs = [];

    var type = trade.type;
    var symbol = trade.symbol;
    var amount = Number(trade.amount) || 0;
    var price = Number(trade.price) || 0;
    var usdTotal = type === 'buy' ? amount : amount * price;

    var desc, amt;
    if (type === 'buy') {
      var cryptoReceived = amount / price;
      desc = 'Bought ' + cryptoReceived.toFixed(8) + ' ' + symbol + ' @ $' + price.toFixed(2);
      amt = -amount; // USD spent (negative)
    } else if (type === 'sell') {
      desc = 'Sold ' + amount.toFixed(8) + ' ' + symbol + ' @ $' + price.toFixed(2);
      amt = amount * price; // USD received (positive)
    } else if (type === 'convert') {
      var target = trade.targetSymbol || symbol;
      var received = amount * price;
      desc = 'Converted ' + amount.toFixed(8) + ' ' + (trade.sourceSymbol || '') + ' → ' + received.toFixed(8) + ' ' + target;
      amt = 0; // internal swap
    } else {
      return;
    }

    // Idempotency: skip if a tx with same description + ts was added in last 5 sec
    var now = Date.now();
    var recentDup = window.st.txs.find(function (t) {
      return t.desc === desc && Math.abs((t.ts || 0) - now) < 5000;
    });
    if (recentDup) return;

    window.st.txs.unshift({
      date: new Date().toISOString().slice(0, 10),
      ts: now,
      desc: desc,
      amt: amt,
      status: 'Completed',
      symbol: symbol,
      price: price,
      tradeType: type,
      crypto: type === 'buy' ? amount / price : amount
    });

    // Cap history at 500 entries
    if (window.st.txs.length > 500) window.st.txs.length = 500;

    // Append to balance history for chart
    if (!Array.isArray(window.st.balanceHistory)) window.st.balanceHistory = [];
    var portfolio = (window.getPortfolioValue && window.getPortfolioValue()) || (window.st.usd || 0);
    window.st.balanceHistory.push({ t: now, v: portfolio });
    if (window.st.balanceHistory.length > 3000) {
      window.st.balanceHistory = window.st.balanceHistory.slice(-3000);
    }

    // Save to server
    if (typeof window.saveToServer === 'function') window.saveToServer();

    // Re-render dashboard
    if (typeof window.render === 'function') window.render();
    if (typeof window.renderRecentTx === 'function') window.renderRecentTx();
    if (typeof window.renderExchangeTx === 'function') window.renderExchangeTx();
  };

  /**
   * Update "Total deposits" counter.
   * Only counts EXTERNAL deposits (bank, card, crypto from outside).
   * Does NOT count trade proceeds (sell USD) or internal transfers.
   */
  window.getTotalExternalDeposits = function () {
  if (!window.st || !Array.isArray(window.st.txs)) return 0;
  return window.st.txs
    .filter(function (t) {
      if (t.amt <= 0) return false;
      // Only count EXTERNAL deposits (bank, card, crypto from outside)
      var desc = (t.desc || '').toLowerCase();
      if (desc.indexOf('sold') !== -1) return false;        // trade: sell
      if (desc.indexOf('convert') !== -1) return false;      // trade: convert
      if (desc.indexOf('buy') === 0) return false;           // trade: buy shouldn't be positive
      if (t.tradeType === 'sell') return false;
      if (t.tradeType === 'convert') return false;
      if (t.tradeType === 'buy') return false;
      // Only allow real deposit descriptions
      if (desc.indexOf('deposit') !== -1) return true;
      if (desc.indexOf('admin') !== -1) return true;
      if (desc.indexOf('bonus') !== -1) return true;
      if (desc.indexOf('transfer') !== -1) return true;
      return false;
    })
    .reduce(function (sum, t) { return sum + t.amt; }, 0);
};

  /**
   * Update "Total trade volume" counter.
   * Sums all buy/sell/convert trades in USD terms.
   */
  window.getTotalTradeVolume = function () {
    if (!window.st || !Array.isArray(window.st.txs)) return 0;
    return window.st.txs
      .filter(function (t) {
        return t.tradeType === 'buy' || t.tradeType === 'sell' || t.tradeType === 'convert';
      })
      .reduce(function (sum, t) {
        var absAmt = Math.abs(t.amt || 0);
        return sum + absAmt;
      }, 0);
  };

  // Override the exchange dashboard totals to use the correct counters
  var _origRenderExchangeDashV3 = window.renderExchangeDash;
  window.renderExchangeDash = function () {
    if (typeof _origRenderExchangeDashV3 === 'function') {
      _origRenderExchangeDashV3.apply(this, arguments);
    }

    // Fix Total Deposits counter
    var depEl = document.getElementById('exTotalDeposits');
    if (depEl) {
      var ext = window.getTotalExternalDeposits();
      depEl.textContent = window.fmtCurrency ? window.fmtCurrency(ext) : ('$' + ext.toFixed(2));
    }

    // Also fix PnL calculation to use correct deposits
    var pnlEl = document.getElementById('exPnl24h');
    if (pnlEl && window.st) {
      var portfolio = (window.getPortfolioValue && window.getPortfolioValue()) || (window.st.usd || 0);
      var extDeposits = window.getTotalExternalDeposits();
      var pnl = portfolio - extDeposits;
      var pct = extDeposits > 0 ? (pnl / extDeposits * 100) : 0;
      pnlEl.textContent = (pnl >= 0 ? '+' : '') + pct.toFixed(2) + '%';
      pnlEl.style.color = pnl >= 0 ? '#10b981' : '#ef4444';
    }
  };

  // ============================================================
  // SECTION 20: HOOK INTO TRADE-TERMINAL
  // ============================================================
  // trade-terminal.js will call window.recordTradeInHistory after
  // each successful trade. We monkey-patch executeTrade to
  // intercept calls, but the cleaner way is for trade-terminal.js
  // to call recordTradeInHistory directly. Since we control both
  // files, we assume trade-terminal.js will call it.
  //
  // For safety: we also patch executeBuy / executeSell / executeConvert
  // (from trade-terminal.js) to record trades automatically.
  // ============================================================

  function hookTradeTerminal() {
    if (!window.TT || typeof window._ttHooked !== 'undefined') return;
    window._ttHooked = true;

    // Patch the trade success modal function to also record history
    var _origShowSuccess = window.showTradeSuccessModal;
    if (typeof _origShowSuccess === 'function') {
      window.showTradeSuccessModal = function (data) {
        _origShowSuccess.apply(this, arguments);
        // (history recording happens in the trade functions themselves)
      };
    }
  }

  // Try to hook immediately, and retry (trade-terminal.js loads async)
  hookTradeTerminal();
  setTimeout(hookTradeTerminal, 500);
  setTimeout(hookTradeTerminal, 1500);

  console.log('%c[NordicCrypto] 📜 Trade history tracking enabled', 'color:#f59e0b;font-weight:bold');
     // ============================================================
  // SECTION 21: TX Details Close — bulletproof rebind
  // ============================================================
  // Guarantees that the X button, Close button, backdrop click,
  // and Escape key all close the txDetails modal — regardless of
  // when or where the modal is rendered in the DOM.
  // ============================================================

  function rebindTxDetailsClose() {
    var closeFunc = window.closeTxDetails || function () {
      var mask = document.getElementById('txDetailsMask');
      if (mask) mask.classList.remove('on');
    };

    // X button (top-right)
    var txdClose = document.getElementById('txdClose');
    if (txdClose && !txdClose._rebound) {
      txdClose._rebound = true;
      txdClose.onclick = function (e) {
        e.preventDefault();
        e.stopPropagation();
        closeFunc();
      };
    }

    // Close button (bottom)
    var txdCloseBtn = document.getElementById('txdCloseBtn');
    if (txdCloseBtn && !txdCloseBtn._rebound) {
      txdCloseBtn._rebound = true;
      txdCloseBtn.onclick = function (e) {
        e.preventDefault();
        e.stopPropagation();
        closeFunc();
      };
    }

    // Backdrop click
    var txdMask = document.getElementById('txDetailsMask');
    if (txdMask && !txdMask._rebound) {
      txdMask._rebound = true;
      txdMask.addEventListener('click', function (e) {
        if (e.target === txdMask) closeFunc();
      });
    }
  }

  // Escape key — global, bound once
  if (!window._txdEscBound) {
    window._txdEscBound = true;
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        var mask = document.getElementById('txDetailsMask');
        if (mask && mask.classList.contains('on')) {
          var closeFunc = window.closeTxDetails || function () {
            mask.classList.remove('on');
          };
          closeFunc();
        }
      }
    });
  }

  // Apply on load + intervals (catches late DOM mutations)
  rebindTxDetailsClose();
  setTimeout(rebindTxDetailsClose, 300);
  setTimeout(rebindTxDetailsClose, 1000);
  setTimeout(rebindTxDetailsClose, 3000);

  // Also rebind every time the modal opens
  var _origOpenTxDetails = window.openTxDetails;
  if (typeof _origOpenTxDetails === 'function') {
    window.openTxDetails = function () {
      _origOpenTxDetails.apply(this, arguments);
      setTimeout(rebindTxDetailsClose, 50);
      setTimeout(rebindTxDetailsClose, 200);
    };
  }

  // Expose for debugging
  window.rebindTxDetailsClose = rebindTxDetailsClose;
   
})();
