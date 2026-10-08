/* ============================================================
   NORDIC CRYPTO — TRADE TERMINAL v1.0
   ============================================================
   Professional trading terminal (Binance Spot style).
   
   All market data is realistic but synthetic:
     • Prices    — from live CoinGecko feed (_exPricesCache)
     • Candles   — generated from price + volatility
     • Order book — generated around current price
     • Trades    — generated stream
   
   Real operations:
     • Buy / Sell / Convert — via Worker ?action=trade
     • Limit orders — saved to state.openOrders
     • Balance & P&L — tracked from server
   ============================================================ */

(function () {
  'use strict';

  // ============================================================
  // SECTION 1: STATE
  // ============================================================

  var TT = {
    open: false,
    coin: 'BTC',
    timeframe: '4h',
    candles: [],
    bids: [],
    asks: [],
    recentTrades: [],
    hoverX: -1,
    hoverY: -1,
    viewStart: 0,
    viewCount: 60,
    maxCandles: 200,
    priceDirection: 'flat', // 'up' | 'down' | 'flat'
    lastPrice: 0,
    indicators: { ma: true, ema: true, vol: true },
    intervals: []
  };

  var COINS = ['BTC', 'ETH', 'USDT', 'SOL', 'BNB'];
  var FEE_RATE = 0.001; // 0.1%

  // ============================================================
  // SECTION 2: HELPERS
  // ============================================================

  function $(id) { return document.getElementById(id); }

  function fmtMoney(n) {
    return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function fmtPrice(n) {
    if (n >= 1000) return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (n >= 1) return '$' + Number(n).toFixed(4);
    return '$' + Number(n).toFixed(8);
  }

  function fmtCrypto(n, symbol) {
    var d = (symbol === 'USDT') ? 2 : 8;
    return Number(n).toFixed(d);
  }

  function fmtVolume(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(2) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(2) + 'K';
    return Number(n).toFixed(2);
  }

  function getCoinPrice(symbol) {
    if (window._exPricesCache && window._exPricesCache.length) {
      var coin = window._exPricesCache.find(function (c) { return c.symbol === symbol; });
      if (coin) return Number(coin.usd) || 0;
    }
    if (!window.st) return 0;
    if (symbol === 'BTC') return Number(window.st.btcP) || 80000;
    if (symbol === 'ETH') return Number(window.st.ethP) || 2500;
    if (symbol === 'USDT') return 1;
    if (symbol === 'SOL') return 115;
    if (symbol === 'BNB') return 767;
    return 0;
  }

  function getCoinBalance(symbol) {
    if (!window.st) return 0;
    return Number(window.st[symbol.toLowerCase()]) || 0;
  }

  function getUsdBalance() {
    if (!window.st) return 0;
    return Number(window.st.usd) || 0;
  }

  // ============================================================
  // SECTION 3: OPEN / CLOSE
  // ============================================================

  window.openTradeTerminalFull = function () {
    var term = $('tradeTerminal');
    if (!term) {
      console.warn('[TT] #tradeTerminal not found in DOM');
      return;
    }

    term.classList.add('on');
    TT.open = true;

    // Initialize everything
    initTerminal();
    selectCoin('BTC');
    selectTimeframe('4h');
    startLiveUpdates();
  };

  window.closeTradeTerminalFull = function () {
    var term = $('tradeTerminal');
    if (term) term.classList.remove('on');
    TT.open = false;

    // Stop intervals
    TT.intervals.forEach(function (id) { clearInterval(id); });
    TT.intervals = [];
  };

  // ============================================================
  // SECTION 4: INIT
  // ============================================================

  function initTerminal() {
    bindHeader();
    bindTabs();
    bindFormInputs();
    bindOrderType();
    bindQuickPct();
    bindChartMouse();
    bindMaskClick();
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
  }

  // ============================================================
  // SECTION 5: HEADER BINDINGS
  // ============================================================

  function bindHeader() {
    // Coin selector
    document.querySelectorAll('.tt-coin-selector button').forEach(function (btn) {
      btn.onclick = function () {
        selectCoin(this.getAttribute('data-coin'));
      };
    });

    // Close
    var closeBtn = document.querySelector('.tt-close');
    if (closeBtn) closeBtn.onclick = closeTradeTerminalFull;

    // Timeframes
    document.querySelectorAll('.tt-timeframes button').forEach(function (btn) {
      btn.onclick = function () {
        selectTimeframe(this.getAttribute('data-tf'));
      };
    });

    // Indicators
    document.querySelectorAll('.tt-indicators button').forEach(function (btn) {
      btn.onclick = function () {
        var ind = this.getAttribute('data-ind');
        TT.indicators[ind] = !TT.indicators[ind];
        this.classList.toggle('on', TT.indicators[ind]);
        drawChart();
      };
    });
  }

  function selectCoin(coin) {
    TT.coin = coin;
    document.querySelectorAll('.tt-coin-selector button').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-coin') === coin);
    });

    // Update labels
    updateFormLabels();
    // Generate fresh candles + order book
    generateCandles();
    generateOrderBook();
    generateRecentTrades();
    renderOrderBook();
    renderRecentTrades();
    drawChart();
    updateHeader();
    updatePreview();
  }

  function selectTimeframe(tf) {
    TT.timeframe = tf;
    document.querySelectorAll('.tt-timeframes button').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-tf') === tf);
    });
    generateCandles();
    drawChart();
  }

  // ============================================================
  // SECTION 6: TABS
  // ============================================================

  function bindTabs() {
    document.querySelectorAll('.tt-form-tabs button').forEach(function (btn) {
      btn.onclick = function () {
        var tab = this.getAttribute('data-tab');
        document.querySelectorAll('.tt-form-tabs button').forEach(function (b) { b.classList.remove('on'); });
        this.classList.add('on');
        document.querySelectorAll('.tt-form').forEach(function (f) {
          f.classList.toggle('on', f.getAttribute('data-form') === tab);
        });
        updatePreview();
      };
    });
  }

  function bindOrderType() {
    document.querySelectorAll('.tt-order-type button').forEach(function (btn) {
      btn.onclick = function () {
        var type = this.getAttribute('data-type');
        var parent = this.closest('.tt-order-type');
        parent.querySelectorAll('button').forEach(function (b) { b.classList.remove('on'); });
        this.classList.add('on');

        var form = this.closest('.tt-form');
        var limitWrap = form.querySelector('.tt-limit-price');
        if (limitWrap) limitWrap.classList.toggle('on', type === 'limit');
      };
    });
  }

  // ============================================================
  // SECTION 7: QUICK % BUTTONS
  // ============================================================

  function bindQuickPct() {
    document.querySelectorAll('.tt-quick button').forEach(function (btn) {
      btn.onclick = function () {
        var pct = parseInt(this.getAttribute('data-pct'), 10) / 100;
        var form = this.closest('.tt-form');
        if (!form) return;
        var formType = form.getAttribute('data-form');

        if (formType === 'buy') {
          var amount = getUsdBalance() * pct;
          var input = $('ttBuyAmount');
          if (input) input.value = amount.toFixed(2);
        } else if (formType === 'sell') {
          var amount2 = getCoinBalance(TT.coin) * pct;
          var input2 = $('ttSellAmount');
          if (input2) input2.value = amount2.toFixed(8);
        } else if (formType === 'convert') {
          var from = $('ttConvertFrom').value;
          var amount3 = getCoinBalance(from) * pct;
          var input3 = $('ttConvertAmount');
          if (input3) input3.value = amount3.toFixed(8);
        }
        updatePreview();
      };
    });
  }

  // ============================================================
  // SECTION 8: FORM INPUTS
  // ============================================================

  function bindFormInputs() {
    ['ttBuyAmount', 'ttBuyLimitPrice', 'ttSellAmount', 'ttSellLimitPrice', 'ttConvertAmount'].forEach(function (id) {
      var el = $(id);
      if (el) el.addEventListener('input', updatePreview);
    });

    var convFrom = $('ttConvertFrom');
    var convTo = $('ttConvertTo');
    if (convFrom) convFrom.addEventListener('change', updatePreview);
    if (convTo) convTo.addEventListener('change', updatePreview);

    // Submit buttons
    var buySubmit = $('ttBuySubmit');
    if (buySubmit) buySubmit.onclick = submitBuy;

    var sellSubmit = $('ttSellSubmit');
    if (sellSubmit) sellSubmit.onclick = submitSell;

    var convertSubmit = $('ttConvertSubmit');
    if (convertSubmit) convertSubmit.onclick = submitConvert;
  }

  // ============================================================
  // SECTION 9: UPDATE PREVIEW
  // ============================================================

  function updatePreview() {
    var price = getCoinPrice(TT.coin);

    // BUY
    var buyAmt = parseFloat(($('ttBuyAmount') || {}).value) || 0;
    var buyReceived = price > 0 ? buyAmt / price : 0;
    var buyFee = buyAmt * FEE_RATE;
    var buyReceiveEl = $('ttBuyReceive');
    if (buyReceiveEl) buyReceiveEl.textContent = fmtCrypto(buyReceived, TT.coin) + ' ' + TT.coin;
    var buyRateEl = $('ttBuyRate');
    if (buyRateEl) buyRateEl.textContent = '1 ' + TT.coin + ' = ' + fmtPrice(price);
    var buyFeeEl = $('ttBuyFee');
    if (buyFeeEl) buyFeeEl.textContent = fmtMoney(buyFee);
    var buyBalEl = $('ttBuyBalance');
    if (buyBalEl) buyBalEl.textContent = fmtMoney(getUsdBalance());
    var buyBtnEl = $('ttBuySubmit');
    if (buyBtnEl) buyBtnEl.textContent = 'Buy ' + TT.coin;

    // SELL
    var sellAmt = parseFloat(($('ttSellAmount') || {}).value) || 0;
    var sellReceived = sellAmt * price;
    var sellFee = sellReceived * FEE_RATE;
    var sellReceiveEl = $('ttSellReceive');
    if (sellReceiveEl) sellReceiveEl.textContent = fmtMoney(sellReceived - sellFee);
    var sellRateEl = $('ttSellRate');
    if (sellRateEl) sellRateEl.textContent = '1 ' + TT.coin + ' = ' + fmtPrice(price);
    var sellBalEl = $('ttSellBalance');
    if (sellBalEl) sellBalEl.textContent = fmtCrypto(getCoinBalance(TT.coin), TT.coin) + ' ' + TT.coin;
    var sellBtnEl = $('ttSellSubmit');
    if (sellBtnEl) sellBtnEl.textContent = 'Sell ' + TT.coin;

    // CONVERT
    var convFromEl = $('ttConvertFrom');
    var convToEl = $('ttConvertTo');
    var convAmtEl = $('ttConvertAmount');
    if (convFromEl && convToEl && convAmtEl) {
      var fromCoin = convFromEl.value;
      var toCoin = convToEl.value;
      var convAmt = parseFloat(convAmtEl.value) || 0;
      var fromPrice = getCoinPrice(fromCoin);
      var toPrice = getCoinPrice(toCoin);
      var rate = toPrice > 0 ? fromPrice / toPrice : 0;
      var result = convAmt * rate;
      var convResultEl = $('ttConvertResult');
      if (convResultEl) convResultEl.value = result > 0 ? result.toFixed(8) : '';
      var convRateEl = $('ttConvertRate');
      if (convRateEl) convRateEl.textContent = '1 ' + fromCoin + ' = ' + rate.toFixed(8) + ' ' + toCoin;
      var convFromBalEl = $('ttConvertFromBalance');
      if (convFromBalEl) convFromBalEl.textContent = 'Balance: ' + fmtCrypto(getCoinBalance(fromCoin), fromCoin);
      var convToBalEl = $('ttConvertToBalance');
      if (convToBalEl) convToBalEl.textContent = 'Balance: ' + fmtCrypto(getCoinBalance(toCoin), toCoin);
    }
  }

  function updateFormLabels() {
    // Update all mentions of coin in labels
    var buyLabel = $('ttBuyLabel');
    if (buyLabel) buyLabel.textContent = 'Amount (USD)';
    var sellLabel = $('ttSellLabel');
    if (sellLabel) sellLabel.textContent = 'Amount (' + TT.coin + ')';
  }

  // ============================================================
  // SECTION 10: UPDATE HEADER
  // ============================================================

  function updateHeader() {
    var price = getCoinPrice(TT.coin);
    var priceEl = document.querySelector('.tt-price');
    if (priceEl) priceEl.textContent = fmtPrice(price);

    // Change % (fake, based on volatility)
    var change = TT.candles.length >= 2
      ? ((TT.candles[TT.candles.length - 1].c - TT.candles[0].o) / TT.candles[0].o) * 100
      : 0;
    var changeEl = document.querySelector('.tt-change');
    if (changeEl) {
      changeEl.textContent = (change >= 0 ? '+' : '') + change.toFixed(2) + '%';
      changeEl.classList.remove('up', 'down');
      changeEl.classList.add(change >= 0 ? 'up' : 'down');
    }

    // Stats
    var high = TT.candles.reduce(function (m, c) { return Math.max(m, c.h); }, 0);
    var low = TT.candles.reduce(function (m, c) { return Math.min(m, c.l); }, Infinity);
    var vol = TT.candles.reduce(function (s, c) { return s + c.v; }, 0);
    var statsEl = document.querySelector('.tt-stats');
    if (statsEl) {
      statsEl.innerHTML =
        '<div>24h High:<b>' + fmtPrice(high) + '</b></div>' +
        '<div>24h Low:<b>' + fmtPrice(low) + '</b></div>' +
        '<div>24h Vol:<b>' + fmtVolume(vol) + ' ' + TT.coin + '</b></div>';
    }
  }

  // ============================================================
  // SECTION 11: GENERATE CANDLES
  // ============================================================

      /**
   * Generate realistic OHLC candles for the chart.
   * 
   * Strategy:
   *   1. Start from the current live price (last candle close).
   *   2. Walk backwards in time — each earlier candle is derived
   *      from the next one with realistic volatility.
   *   3. Use mean reversion: price gently gravitates toward a
   *      long-term anchor (current price ± 3%) to avoid runaway.
   *   4. Result: smooth, realistic chart with no end-of-chart jumps.
   */
  function generateCandles() {
    var basePrice = getCoinPrice(TT.coin);
    if (basePrice <= 0) basePrice = 100;

    var tfMinutes = { '1h': 60, '4h': 240, '1d': 1440 };
    var minutes = tfMinutes[TT.timeframe] || 240;
    var now = Date.now();
    var N = TT.maxCandles;

    // Volatility per candle (scaled by timeframe)
    // 4h → ~1.2% swing; 1h → ~0.6%; 1d → ~3%
    var tfVolFactor = { '1h': 0.006, '4h': 0.012, '1d': 0.03 };
    var sigma = basePrice * (tfVolFactor[TT.timeframe] || 0.012);

    // Mean-reversion anchor: current price is the long-term center
    var anchor = basePrice;

    // Generate candles backwards: index 0 = oldest, N-1 = newest
    // We start with newest candle close = current price, then walk back.
    var closes = new Array(N);
    closes[N - 1] = basePrice;

    for (var i = N - 2; i >= 0; i--) {
      var next = closes[i + 1];
      // Random walk with mean reversion toward anchor
      var reversion = (anchor - next) * 0.03; // pull toward anchor
      var noise = (Math.random() - 0.5) * sigma * 2;
      var c = next + reversion + noise;
      // Clamp to ±15% from anchor (prevents runaway)
      var maxDev = anchor * 0.15;
      if (c < anchor - maxDev) c = anchor - maxDev;
      if (c > anchor + maxDev) c = anchor + maxDev;
      closes[i] = c;
    }

    // Build OHLC from closes
    var candles = [];
    for (var k = 0; k < N; k++) {
      var closePrice = closes[k];
      var openPrice = (k === 0) ? closePrice : closes[k - 1];

      // Wick size — small relative to body
      var wickSize = sigma * (0.3 + Math.random() * 0.7);
      var high = Math.max(openPrice, closePrice) + wickSize * Math.random();
      var low  = Math.min(openPrice, closePrice) - wickSize * Math.random();

      // Volume — higher on larger moves
      var movePct = Math.abs(closePrice - openPrice) / openPrice;
      var baseVol = basePrice * 80;
      var vol = baseVol * (0.5 + Math.random() * 1.0) * (1 + movePct * 20);

      candles.push({
        t: now - (N - 1 - k) * minutes * 60 * 1000,
        o: openPrice,
        h: high,
        l: low,
        c: closePrice,
        v: vol
      });
    }

    // Last candle close MUST equal live price exactly (no jump)
    if (candles.length) {
      var last = candles[candles.length - 1];
      last.c = basePrice;
      last.h = Math.max(last.h, basePrice);
      last.l = Math.min(last.l, basePrice);
      last.o = Math.max(0.001, Math.min(last.o, basePrice * 1.005));
    }

    TT.candles = candles;
    TT.viewStart = Math.max(0, candles.length - TT.viewCount);
  }
   
  // ============================================================
  // SECTION 12: GENERATE ORDER BOOK
  // ============================================================

  function generateOrderBook() {
    var midPrice = getCoinPrice(TT.coin);
    if (midPrice <= 0) midPrice = 100;

    var step = midPrice * 0.0002; // 0.02% step
    var bids = [];
    var asks = [];

    for (var i = 0; i < 20; i++) {
      var bidPrice = midPrice - step * (i + 1) * (0.9 + Math.random() * 0.2);
      var askPrice = midPrice + step * (i + 1) * (0.9 + Math.random() * 0.2);
      var bidAmt = (0.5 + Math.random() * 2) * (1 - i / 25);
      var askAmt = (0.5 + Math.random() * 2) * (1 - i / 25);
      bids.push({ price: bidPrice, amount: bidAmt, total: bidAmt * bidPrice });
      asks.push({ price: askPrice, amount: askAmt, total: askAmt * askPrice });
    }
    TT.bids = bids;
    TT.asks = asks.reverse(); // asks от высшей к низшей
  }

  function renderOrderBook() {
    var asksEl = document.querySelector('.tt-ob-asks');
    var bidsEl = document.querySelector('.tt-ob-bids');
    if (!asksEl || !bidsEl) return;

    var maxAskTotal = TT.asks.reduce(function (m, a) { return Math.max(m, a.total); }, 0);
    var maxBidTotal = TT.bids.reduce(function (m, b) { return Math.max(m, b.total); }, 0);

    var asksHtml = '';
    TT.asks.forEach(function (a) {
      var barW = (a.total / maxAskTotal) * 100;
      asksHtml += '<div class="tt-ob-row ask" data-price="' + a.price + '">' +
        '<span class="tt-ob-bar" style="width:' + barW + '%"></span>' +
        '<span class="tt-ob-price">' + fmtPrice(a.price) + '</span>' +
        '<span class="tt-ob-amount">' + a.amount.toFixed(4) + '</span>' +
        '<span class="tt-ob-total">' + a.total.toFixed(0) + '</span>' +
      '</div>';
    });
    asksEl.innerHTML = asksHtml;

    var bidsHtml = '';
    TT.bids.forEach(function (b) {
      var barW = (b.total / maxBidTotal) * 100;
      bidsHtml += '<div class="tt-ob-row bid" data-price="' + b.price + '">' +
        '<span class="tt-ob-bar" style="width:' + barW + '%"></span>' +
        '<span class="tt-ob-price">' + fmtPrice(b.price) + '</span>' +
        '<span class="tt-ob-amount">' + b.amount.toFixed(4) + '</span>' +
        '<span class="tt-ob-total">' + b.total.toFixed(0) + '</span>' +
      '</div>';
    });
    bidsEl.innerHTML = bidsHtml;

    // Spread
    var spread = TT.asks.length && TT.bids.length
      ? (TT.asks[TT.asks.length - 1].price - TT.bids[0].price)
      : 0;
    var spreadEl = document.querySelector('.tt-ob-spread-price');
    if (spreadEl) spreadEl.textContent = fmtPrice(spread);

    // Click on row → fill limit price
    document.querySelectorAll('.tt-ob-row').forEach(function (row) {
      row.onclick = function () {
        var price = parseFloat(this.getAttribute('data-price'));
        var limitBuy = $('ttBuyLimitPrice');
        if (limitBuy && limitBuy.closest('.tt-limit-price').classList.contains('on')) {
          limitBuy.value = price.toFixed(2);
        }
        var limitSell = $('ttSellLimitPrice');
        if (limitSell && limitSell.closest('.tt-limit-price').classList.contains('on')) {
          limitSell.value = price.toFixed(2);
        }
      };
    });
  }

  // ============================================================
  // SECTION 13: GENERATE RECENT TRADES
  // ============================================================

  function generateRecentTrades() {
    var midPrice = getCoinPrice(TT.coin);
    if (midPrice <= 0) midPrice = 100;
    var trades = [];
    for (var i = 0; i < 30; i++) {
      trades.push({
        price: midPrice * (1 + (Math.random() - 0.5) * 0.001),
        amount: Math.random() * 2 + 0.001,
        side: Math.random() > 0.5 ? 'buy' : 'sell',
        time: Date.now() - i * (500 + Math.random() * 2000)
      });
    }
    TT.recentTrades = trades;
  }

  function renderRecentTrades() {
    var el = document.querySelector('.tt-rt-list');
    if (!el) return;
    var html = '';
    TT.recentTrades.slice(0, 30).forEach(function (t) {
      var timeStr = new Date(t.time).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      html += '<div class="tt-rt-row ' + t.side + '">' +
        '<span class="tt-rt-price">' + fmtPrice(t.price) + '</span>' +
        '<span class="tt-rt-amount">' + t.amount.toFixed(4) + '</span>' +
        '<span class="tt-rt-time">' + timeStr + '</span>' +
      '</div>';
    });
    el.innerHTML = html;
  }

  // ============================================================
  // SECTION 14: CANVAS CHART
  // ============================================================

  var canvas, ctx;

  function resizeCanvas() {
    canvas = $('ttChart');
    if (!canvas) return;
    var rect = canvas.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';
    ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    drawChart();
  }

  function bindChartMouse() {
    canvas = $('ttChart');
    if (!canvas) return;

    canvas.addEventListener('mousemove', function (e) {
      var rect = canvas.getBoundingClientRect();
      TT.hoverX = e.clientX - rect.left;
      TT.hoverY = e.clientY - rect.top;
      drawChart();
    });

    canvas.addEventListener('mouseleave', function () {
      TT.hoverX = -1;
      TT.hoverY = -1;
      drawChart();
    });

    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      if (e.deltaY < 0) TT.viewCount = Math.max(20, TT.viewCount - 5);
      else TT.viewCount = Math.min(TT.maxCandles, TT.viewCount + 5);
      TT.viewStart = Math.max(0, TT.candles.length - TT.viewCount);
      drawChart();
    }, { passive: false });

    var isDragging = false, dragStartX = 0, dragStartView = 0;
    canvas.addEventListener('mousedown', function (e) {
      isDragging = true;
      dragStartX = e.clientX;
      dragStartView = TT.viewStart;
    });
    window.addEventListener('mouseup', function () { isDragging = false; });
    window.addEventListener('mousemove', function (e) {
      if (!isDragging || !TT.open) return;
      var dx = e.clientX - dragStartX;
      var cw = canvas.getBoundingClientRect().width;
      var perCandle = cw / TT.viewCount;
      var shift = Math.round(-dx / perCandle);
      var newStart = Math.max(0, Math.min(TT.candles.length - TT.viewCount, dragStartView + shift));
      if (newStart !== TT.viewStart) {
        TT.viewStart = newStart;
        drawChart();
      }
    });
  }

  function drawChart() {
    if (!ctx || !canvas) return;
    var w = canvas.getBoundingClientRect().width;
    var h = canvas.getBoundingClientRect().height;

    // Clear
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0a0e15';
    ctx.fillRect(0, 0, w, h);

    if (!TT.candles.length) return;

    // Visible candles
    var viewCandles = TT.candles.slice(TT.viewStart, TT.viewStart + TT.viewCount);
    if (!viewCandles.length) return;

    // Chart area
    var padTop = 20;
    var padBottom = TT.indicators.vol ? 70 : 30;
    var padLeft = 60;
    var padRight = 80;
    var chartW = w - padLeft - padRight;
    var chartH = h - padTop - padBottom;

    // Price range
    var minPrice = viewCandles.reduce(function (m, c) { return Math.min(m, c.l); }, Infinity);
    var maxPrice = viewCandles.reduce(function (m, c) { return Math.max(m, c.h); }, -Infinity);
    var priceRange = maxPrice - minPrice;
    if (priceRange <= 0) priceRange = 1;
    minPrice -= priceRange * 0.05;
    maxPrice += priceRange * 0.05;
    priceRange = maxPrice - minPrice;

    function priceToY(p) {
      return padTop + chartH * (1 - (p - minPrice) / priceRange);
    }

    function xToIndex(x) {
      return Math.floor((x - padLeft) / (chartW / viewCandles.length));
    }

    // ---- Grid + Y axis ----
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.fillStyle = '#7a8a9e';
    ctx.font = '10px ui-monospace, monospace';
    ctx.textAlign = 'right';
    ctx.lineWidth = 1;

    for (var i = 0; i <= 5; i++) {
      var y = padTop + (chartH / 5) * i;
      var price = maxPrice - (priceRange / 5) * i;
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(w - padRight, y);
      ctx.stroke();
      ctx.fillText(fmtPrice(price), padLeft - 8, y + 3);
    }

    // ---- Volume area ----
    var volAreaTop = padTop + chartH + 10;
    var volAreaH = padBottom - 30;
    var maxVol = viewCandles.reduce(function (m, c) { return Math.max(m, c.v); }, 0);

    if (TT.indicators.vol && maxVol > 0) {
      viewCandles.forEach(function (c, i) {
        var x = padLeft + i * (chartW / viewCandles.length);
        var cw = (chartW / viewCandles.length) * 0.7;
        var vh = (c.v / maxVol) * volAreaH;
        ctx.fillStyle = c.c >= c.o ? 'rgba(16,185,129,0.4)' : 'rgba(239,68,68,0.4)';
        ctx.fillRect(x + cw * 0.15, volAreaTop + volAreaH - vh, cw, vh);
      });
    }

    // ---- Candles ----
    var candleW = (chartW / viewCandles.length) * 0.7;
    var candleGap = (chartW / viewCandles.length) * 0.3;

    viewCandles.forEach(function (c, i) {
      var x = padLeft + i * (chartW / viewCandles.length) + candleGap / 2;
      var yO = priceToY(c.o);
      var yC = priceToY(c.c);
      var yH = priceToY(c.h);
      var yL = priceToY(c.l);
      var isUp = c.c >= c.o;
      var color = isUp ? '#10b981' : '#ef4444';

      // Wick
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + candleW / 2, yH);
      ctx.lineTo(x + candleW / 2, yL);
      ctx.stroke();

      // Body
      ctx.fillStyle = color;
      var bodyTop = Math.min(yO, yC);
      var bodyH = Math.max(1, Math.abs(yC - yO));
      ctx.fillRect(x, bodyTop, candleW, bodyH);
    });

    // ---- MA(7) ----
    if (TT.indicators.ma) drawMA(viewCandles, 7, '#fbbf24', padLeft, chartW, priceToY);
    if (TT.indicators.ma) drawMA(viewCandles, 25, '#47dcff', padLeft, chartW, priceToY);
    if (TT.indicators.ema) drawEMA(viewCandles, 12, '#a78bfa', padLeft, chartW, priceToY);

    // ---- Current price line ----
    var lastCandle = viewCandles[viewCandles.length - 1];
    var lastY = priceToY(lastCandle.c);
    ctx.strokeStyle = 'rgba(139,92,246,0.4)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(padLeft, lastY);
    ctx.lineTo(w - padRight, lastY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Current price badge
    ctx.fillStyle = '#8b5cf6';
    ctx.fillRect(w - padRight + 2, lastY - 9, padRight - 4, 18);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 10px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(fmtPrice(lastCandle.c), w - padRight / 2 - 2, lastY + 3);

    // ---- Crosshair ----
    if (TT.hoverX > padLeft && TT.hoverX < w - padRight && TT.hoverY > padTop && TT.hoverY < padTop + chartH) {
      ctx.strokeStyle = 'rgba(255,255,255,0.2)';
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(TT.hoverX, padTop);
      ctx.lineTo(TT.hoverX, padTop + chartH);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(padLeft, TT.hoverY);
      ctx.lineTo(w - padRight, TT.hoverY);
      ctx.stroke();
      ctx.setLineDash([]);

      // Price label at crosshair
      var hoverPrice = maxPrice - (TT.hoverY - padTop) / chartH * priceRange;
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fillRect(w - padRight + 2, TT.hoverY - 9, padRight - 4, 18);
      ctx.fillStyle = '#0a0e15';
      ctx.font = 'bold 10px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(fmtPrice(hoverPrice), w - padRight / 2 - 2, TT.hoverY + 3);
    }

    // ---- X axis time labels ----
    ctx.fillStyle = '#7a8a9e';
    ctx.font = '10px ui-monospace, monospace';
    ctx.textAlign = 'center';
    var labelCount = 6;
    for (var k = 0; k < labelCount; k++) {
      var idx = Math.floor((viewCandles.length / (labelCount - 1)) * k);
      if (idx >= viewCandles.length) idx = viewCandles.length - 1;
      var c = viewCandles[idx];
      var x = padLeft + idx * (chartW / viewCandles.length) + candleW / 2;
      var d = new Date(c.t);
      var label = d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0');
      if (TT.timeframe === '1d') {
        label = d.getDate() + '/' + (d.getMonth() + 1);
      }
      ctx.fillText(label, x, padTop + chartH + padBottom - 8);
    }
  }

  function drawMA(candles, period, color, padLeft, chartW, priceToY) {
    if (candles.length < period) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    var started = false;
    for (var i = period - 1; i < candles.length; i++) {
      var sum = 0;
      for (var j = i - period + 1; j <= i; j++) sum += candles[j].c;
      var ma = sum / period;
      var x = padLeft + i * (chartW / candles.length) + (chartW / candles.length) / 2;
      var y = priceToY(ma);
      if (!started) { ctx.moveTo(x, y); started = true; }
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  function drawEMA(candles, period, color, padLeft, chartW, priceToY) {
    if (candles.length < period) return;
    var k = 2 / (period + 1);
    var ema = candles[0].c;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    var started = false;
    for (var i = 0; i < candles.length; i++) {
      ema = candles[i].c * k + ema * (1 - k);
      var x = padLeft + i * (chartW / candles.length) + (chartW / candles.length) / 2;
      var y = priceToY(ema);
      if (!started) { ctx.moveTo(x, y); started = true; }
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // ============================================================
  // SECTION 15: SUBMIT TRADES
  // ============================================================

  async function submitBuy() {
    var amount = parseFloat(($('ttBuyAmount') || {}).value) || 0;
    var price = getCoinPrice(TT.coin);
    if (amount < 10) { alert('Minimum purchase is $10'); return; }
    if (amount > getUsdBalance()) { alert('Insufficient balance'); return; }
    if (price <= 0) { alert('Price unavailable'); return; }

    var limitWrap = document.querySelector('.tt-form[data-form="buy"] .tt-limit-price');
    var isLimit = limitWrap && limitWrap.classList.contains('on');
    var limitPrice = parseFloat(($('ttBuyLimitPrice') || {}).value) || price;

    await executeTrade('buy', TT.coin, amount, isLimit ? limitPrice : price, isLimit ? 'limit' : 'market');
  }

  async function submitSell() {
    var amount = parseFloat(($('ttSellAmount') || {}).value) || 0;
    var price = getCoinPrice(TT.coin);
    if (amount <= 0) { alert('Enter amount'); return; }
    if (amount > getCoinBalance(TT.coin)) { alert('Insufficient ' + TT.coin); return; }
    if (price <= 0) { alert('Price unavailable'); return; }

    var limitWrap = document.querySelector('.tt-form[data-form="sell"] .tt-limit-price');
    var isLimit = limitWrap && limitWrap.classList.contains('on');
    var limitPrice = parseFloat(($('ttSellLimitPrice') || {}).value) || price;

    await executeTrade('sell', TT.coin, amount, isLimit ? limitPrice : price, isLimit ? 'limit' : 'market');
  }

  async function submitConvert() {
    var amount = parseFloat(($('ttConvertAmount') || {}).value) || 0;
    var fromCoin = ($('ttConvertFrom') || {}).value;
    var toCoin = ($('ttConvertTo') || {}).value;
    if (fromCoin === toCoin) { alert('Choose different coins'); return; }
    if (amount <= 0) { alert('Enter amount'); return; }
    if (amount > getCoinBalance(fromCoin)) { alert('Insufficient ' + fromCoin); return; }

    var fromPrice = getCoinPrice(fromCoin);
    var toPrice = getCoinPrice(toCoin);
    if (fromPrice <= 0 || toPrice <= 0) { alert('Price unavailable'); return; }
    var rate = fromPrice / toPrice;

    var token = localStorage.getItem('session_token');
    if (!token) { alert('Not authenticated'); return; }

    try {
      var res = await fetch(window.WORKER_URL + '?action=trade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: token,
          clientTradeId: 'ct_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
          type: 'convert',
          symbol: toCoin,
          amount: amount,
          price: rate,
          orderType: 'market',
          sourceSymbol: fromCoin,
          targetSymbol: toCoin
        })
      });
      var data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Convert failed');

      // Update local state
      if (window.st) {
        window.st.usd = data.usd;
        window.st.btc = data.btc;
        window.st.eth = data.eth;
        if (data.usdt !== undefined) window.st.usdt = data.usdt;
        if (data.sol !== undefined) window.st.sol = data.sol;
        if (data.bnb !== undefined) window.st.bnb = data.bnb;
      }

      if (typeof window.render === 'function') window.render();
      if (typeof window.renderExchangeDash === 'function') window.renderExchangeDash();
      if (typeof window.playChime === 'function') window.playChime();
      if (typeof window.addNotification === 'function') {
        window.addNotification('Converted ' + amount.toFixed(6) + ' ' + fromCoin + ' → ' + toCoin, '🔄');
      }

      selectCoin(TT.coin); // refresh
      closeTradeTerminalFull();

      if (typeof window.toast === 'function') {
        window.toast('✅ Converted ' + amount.toFixed(6) + ' ' + fromCoin + ' → ' + toCoin);
      }
    } catch (e) {
      alert('Convert failed: ' + e.message);
    }
  }

    /**
   * Execute a market/limit trade via Worker ?action=trade.
   * This is the ONLY function that sends trades — no legacy overrides.
   */
  async function executeTrade(type, symbol, amount, price, orderType) {
    var token = localStorage.getItem('session_token');
    if (!token) { alert('Not authenticated'); return; }

    var clientTradeId = 'ct_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);

    try {
      var res = await fetch(window.WORKER_URL + '?action=trade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: token,
          clientTradeId: clientTradeId,
          type: type,
          symbol: symbol,
          amount: amount,
          price: price,
          orderType: orderType || 'market',
          limitPrice: orderType === 'limit' ? price : null
        })
      });
      var data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Trade failed');

      // Update local state
      if (window.st) {
        window.st.usd = data.usd;
        window.st.btc = data.btc;
        window.st.eth = data.eth;
        if (data.usdt !== undefined) window.st.usdt = data.usdt;
        if (data.sol !== undefined) window.st.sol = data.sol;
        if (data.bnb !== undefined) window.st.bnb = data.bnb;
      }

      // Re-render
      if (typeof window.render === 'function') window.render();
      if (typeof window.renderExchangeDash === 'function') window.renderExchangeDash();
      if (typeof window.playChime === 'function') window.playChime();

      var action = type === 'buy' ? 'Bought' : 'Sold';
      var amountStr = type === 'buy'
        ? (amount / price).toFixed(8) + ' ' + symbol
        : amount.toFixed(8) + ' ' + symbol;
      if (typeof window.addNotification === 'function') {
        window.addNotification(action + ' ' + amountStr + ' @ $' + price.toFixed(2), type === 'buy' ? '📈' : '📉');
      }

      // Record in history
      if (typeof window.recordTradeInHistory === 'function') {
        window.recordTradeInHistory({
          type: type,
          symbol: symbol,
          amount: amount,
          price: price
        });
      }

      // Refresh order history + open orders immediately
      if (typeof window.loadOrderHistory === 'function') window.loadOrderHistory();
      if (typeof window.refreshOpenOrders === 'function') window.refreshOpenOrders();

      if (typeof window.toast === 'function') {
        window.toast('✅ ' + action + ' ' + amountStr);
      }

      // For market orders: keep terminal OPEN (don't close)
      // The user can see their trade appear in Order History instantly.
      return data;

    } catch (e) {
      alert('Trade failed: ' + e.message);
      throw e;
    }
  }
  // ============================================================
  // SECTION 16: LIVE UPDATES
  // ============================================================

  function startLiveUpdates() {
    // Order book + recent trades every 2 sec
    var id1 = setInterval(function () {
      if (!TT.open) return;
      generateOrderBook();
      renderOrderBook();
      // Add fake trade to recent list
      var mid = getCoinPrice(TT.coin);
      TT.recentTrades.unshift({
        price: mid * (1 + (Math.random() - 0.5) * 0.001),
        amount: Math.random() * 0.5,
        side: Math.random() > 0.5 ? 'buy' : 'sell',
        time: Date.now()
      });
      if (TT.recentTrades.length > 30) TT.recentTrades.length = 30;
      renderRecentTrades();
    }, 2000);

    // Full update every 5 sec
    var id2 = setInterval(function () {
      if (!TT.open) return;
      updateHeader();
      updatePreview();
      drawChart();
    }, 5000);

    TT.intervals.push(id1, id2);
  }

  // ============================================================
  // SECTION 17: MASK CLICK
  // ============================================================

  function bindMaskClick() {
    var term = $('tradeTerminal');
    if (term) {
      term.addEventListener('click', function (e) {
        // Click outside panels → close
        if (e.target === term) closeTradeTerminalFull();
      });
    }

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && TT.open) closeTradeTerminalFull();
    });
  }

  // ============================================================
  // SECTION 18: PUBLIC API
  // ============================================================

  window.TT = TT;
  // ============================================================
  // SECTION 19: ORDER HISTORY
  // ============================================================

  var _ohCurrentFilter = 'all';

  /**
   * Fetch order history from Worker and render.
   */
  async function loadOrderHistory(filter) {
    var token = localStorage.getItem('session_token');
    if (!token) return;
    _ohCurrentFilter = filter || _ohCurrentFilter;

    try {
      var res = await fetch(window.WORKER_URL + '?action=getOrders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token, filter: _ohCurrentFilter })
      });
      var data = await res.json();
      if (!data.ok) return;
      renderOrderHistory(data.orders || []);
    } catch (e) {
      console.warn('[TT] Order history fetch failed:', e);
    }
  }

  /**
   * Render the order history list.
   */
  function renderOrderHistory(orders) {
    var el = document.querySelector('.tt-oh-list');
    if (!el) return;

    if (!orders.length) {
      el.innerHTML = '<div class="tt-empty">No orders yet</div>';
      return;
    }

    var html = '';
    orders.forEach(function (o) {
      var statusIcon, statusClass;
      if (o.status === 'filled') {
        statusIcon = '✓';
        statusClass = 'filled';
      } else if (o.status === 'open') {
        statusIcon = '⏳';
        statusClass = 'open';
      } else if (o.status === 'cancelled') {
        statusIcon = '✗';
        statusClass = 'cancelled';
      } else {
        statusIcon = '•';
        statusClass = 'cancelled';
      }

      var typeLabel = o.type === 'buy' ? 'BUY' : (o.type === 'sell' ? 'SELL' : 'CONV');
      var typeClass = o.type === 'buy' ? 'buy' : 'sell';

      // Amount formatting
      var amtStr;
      if (o.type === 'buy') {
        amtStr = (Number(o.amount) / Number(o.price)).toFixed(6) + ' ' + o.symbol;
      } else {
        amtStr = Number(o.amount).toFixed(6) + ' ' + o.symbol;
      }

      var priceStr = '$' + Number(o.price).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      });

      // Time
      var t = new Date(o.ts);
      var now = Date.now();
      var diff = now - o.ts;
      var timeStr;
      if (diff < 60000) timeStr = 'Just now';
      else if (diff < 3600000) timeStr = Math.floor(diff / 60000) + 'm';
      else if (diff < 86400000) timeStr = t.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      else timeStr = t.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });

      // Cancel button (only for open orders)
      var cancelBtn = (o.status === 'open')
        ? '<button class="tt-oh-cancel" data-order-id="' + o.id + '">Cancel</button>'
        : '';

      html += '<div class="tt-oh-row" data-order-id="' + o.id + '">' +
        '<span class="tt-oh-status-icon ' + statusClass + '">' + statusIcon + '</span>' +
        '<span class="tt-oh-type ' + typeClass + '">' + typeLabel + '</span>' +
        '<span class="tt-oh-symbol">' + o.symbol + '</span>' +
        '<span class="tt-oh-amount">' + amtStr + '</span>' +
        '<span class="tt-oh-price">' + priceStr + '</span>' +
        '<span class="tt-oh-time">' + timeStr + '</span>' +
      '</div>' + (cancelBtn ? '<div style="text-align:right;padding:0 16px 6px;">' + cancelBtn + '</div>' : '');
    });

    el.innerHTML = html;

    // Bind cancel buttons
    el.querySelectorAll('.tt-oh-cancel').forEach(function (btn) {
      btn.onclick = function (e) {
        e.stopPropagation();
        var orderId = this.getAttribute('data-order-id');
        cancelOrder(orderId);
      };
    });
  }

  /**
   * Cancel an open order.
   */
  async function cancelOrder(orderId) {
    var token = localStorage.getItem('session_token');
    if (!token) return;

    try {
      var res = await fetch(window.WORKER_URL + '?action=cancelOrder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token, orderId: orderId })
      });
      var data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Cancel failed');

      if (typeof window.toast === 'function') window.toast('✅ Order cancelled');
      loadOrderHistory();
      if (typeof window.refreshOpenOrders === 'function') window.refreshOpenOrders();
    } catch (e) {
      if (typeof window.toast === 'function') window.toast('❌ ' + e.message);
    }
  }

  /**
   * Bind filter buttons.
   */
  function bindOrderHistoryFilters() {
    document.querySelectorAll('.tt-oh-filters button').forEach(function (btn) {
      if (btn._bound) return;
      btn._bound = true;
      btn.onclick = function () {
        document.querySelectorAll('.tt-oh-filters button').forEach(function (b) { b.classList.remove('on'); });
        this.classList.add('on');
        var filter = this.getAttribute('data-filter');
        loadOrderHistory(filter);
      };
    });
  }

  /**
   * Refresh order history while terminal is open.
   */
  function startOrderHistoryRefresh() {
    setInterval(function () {
      if (window.TT && window.TT.open) {
        loadOrderHistory();
      }
    }, 5000);
  }

  // Expose for external use
  window.loadOrderHistory = loadOrderHistory;
  window.renderOrderHistory = renderOrderHistory;
  window.cancelOrder = cancelOrder;

  // Hook into terminal open
  var _origOpenTTFull = window.openTradeTerminalFull;
  if (typeof _origOpenTTFull === 'function') {
    window.openTradeTerminalFull = function () {
      _origOpenTTFull.apply(this, arguments);
      setTimeout(function () {
        bindOrderHistoryFilters();
        loadOrderHistory('all');
      }, 300);
    };
  }

  // Start periodic refresh
  startOrderHistoryRefresh();

  // Bind filters on load (in case terminal already open)
  setTimeout(bindOrderHistoryFilters, 1000);
  console.log('%c[NordicCrypto] 📊 Trade Terminal v1.0 loaded', 'color:#8b5cf6;font-weight:bold;font-size:13px');

})();
