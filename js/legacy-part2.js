
/* === PART B START === */

/* ---------- NOTIFICATIONS ---------- */
function playNotificationSound(){
  playTone(880, 0.12, 'sine', 0.35);
  setTimeout(function(){ playTone(1320, 0.18, 'sine', 0.28); }, 100);
}

function addNotification(text, icon){
  if (!st.notifications) st.notifications = [];
  st.notifications.unshift({
    id: Date.now() + Math.random(), text, icon: icon || '🔔',
    ts: Date.now(), read: false
  });
  if (st.notifications.length > 50) st.notifications.length = 50;
  saveToServer();
  renderNotifications();
  playNotificationSound();
}

function timeAgo(ts){
  var s = Math.floor((Date.now() - ts) / 1000);
  if (s < 30) return 'Just now';
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.floor(s / 60) + ' min ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  if (s < 604800) return Math.floor(s / 86400) + 'd ago';
  return new Date(ts).toLocaleDateString('en-GB', { day:'2-digit', month:'short' });
}

function renderNotifications(){
  var listEl = document.getElementById('notifList');
  var badge  = document.getElementById('notifBadge');
  var sub    = document.getElementById('notifSub');
  if (!listEl) return;
  var notifs = st.notifications || [];
  var unread = 0;
  for (var i = 0; i < notifs.length; i++) if (!notifs[i].read) unread++;

  if (badge){
    if (unread > 0){ badge.style.display = 'flex'; badge.textContent = unread > 9 ? '9+' : unread; }
    else { badge.style.display = 'none'; }
  }
  if (sub) sub.textContent = unread > 0 ? (unread + ' unread') : 'All read';

  if (notifs.length === 0){
    listEl.innerHTML = '<div class="notif-empty"><div style="font-size:2.5rem;opacity:.4;margin-bottom:8px">🔔</div><div>No notifications yet</div></div>';
    return;
  }
  var html = '';
  for (var j = 0; j < notifs.length; j++){
    var n = notifs[j];
    var safeId = String(n.id).replace(/'/g, "\\'");
    var safeText = escapeHtml(n.text);
    html += '<div class="notif-item' + (n.read ? '' : ' unread') + '" data-id="' + n.id + '">' +
      '<div class="notif-icon">' + (n.icon || '🔔') + '</div>' +
      '<div class="notif-body">' +
        '<div class="notif-text">' + safeText + '</div>' +
        '<div class="notif-time">' + timeAgo(n.ts) + '</div>' +
      '</div>' +
      '<button onclick="event.stopPropagation(); deleteNotification(\'' + safeId + '\')" style="position:absolute;top:10px;right:10px;width:26px;height:26px;border-radius:6px;background:rgba(255,80,80,.15);border:1px solid rgba(255,80,80,.3);color:#ff6b6b;cursor:pointer;font-size:14px;line-height:1;">×</button>' +
    '</div>';
  }
  listEl.innerHTML = html;
  var items = listEl.querySelectorAll('.notif-item');
  for (var k = 0; k < items.length; k++){
    items[k].onclick = function(){ markRead(Number(this.getAttribute('data-id'))); };
  }
}

function deleteNotification(id){
  if (!st.notifications) return;
  var before = st.notifications.length;
  st.notifications = st.notifications.filter(function(n){ return String(n.id) !== String(id); });
  if (st.notifications.length < before){
    var token = getSessionToken();
    if (token && stateLoaded){
      fetch(WORKER_URL + '?action=setUserState', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, state: st, email: window.adminViewingEmail || undefined, force: true, wipeNotifs: true })
      }).catch(function(){});
    }
    renderNotifications();
  }
}

function markRead(id){
  if (!st.notifications) return;
  for (var i = 0; i < st.notifications.length; i++){
    if (st.notifications[i].id === id){ st.notifications[i].read = true; break; }
  }
  saveToServer();
  renderNotifications();
}

function markAllRead(){
  if (!st.notifications) return;
  for (var i = 0; i < st.notifications.length; i++) st.notifications[i].read = true;
  saveToServer();
  renderNotifications();
}

function initNotifications(){
  var bell     = document.getElementById('notifBell');
  var panel    = document.getElementById('notifPanel');
  var overlay  = document.getElementById('notifOverlay');
  var closeBtn = document.getElementById('notifClose');

  if (bell) bell.onclick = function(){
    if (panel) panel.classList.add('on');
    if (overlay) overlay.classList.add('on');
    setTimeout(markAllRead, 1500);
  };

  function closePanel(){
    if (panel) panel.classList.remove('on');
    if (overlay) overlay.classList.remove('on');
  }
  if (overlay) overlay.onclick = closePanel;
  if (closeBtn) closeBtn.onclick = closePanel;
}

/* ---------- CHARTS ---------- */
function loadCharts(){
  fetch('https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=7')
    .then(function(r){ return r.json(); })
    .then(function(d){
      if (d && d.prices && d.prices.length){
        var prices = d.prices.map(function(p){ return p[1]; });
        drawChart('btcChart', prices, '#f7931a');
        var change = ((prices[prices.length - 1] - prices[0]) / prices[0]) * 100;
        updateChange('btcChange', change);
        renderBalanceChart();
      }
    })
    .catch(function(){});

  fetch('https://api.coingecko.com/api/v3/coins/ethereum/market_chart?vs_currency=usd&days=7')
    .then(function(r){ return r.json(); })
    .then(function(d){
      if (d && d.prices && d.prices.length){
        var prices = d.prices.map(function(p){ return p[1]; });
        drawChart('ethChart', prices, '#627eea');
        var change = ((prices[prices.length - 1] - prices[0]) / prices[0]) * 100;
        updateChange('ethChange', change);
        renderBalanceChart();
      }
    })
    .catch(function(){});
}

function drawChart(elId, prices, color){
  var el = document.getElementById(elId);
  if (!el || !prices || prices.length < 2) return;
  var w = 200, h = 42, pad = 4;
  var min = Math.min.apply(null, prices);
  var max = Math.max.apply(null, prices);
  var range = max - min || 1;
  var points = [];
  for (var i = 0; i < prices.length; i++){
    var x = pad + (i / (prices.length - 1)) * (w - pad * 2);
    var y = pad + (1 - (prices[i] - min) / range) * (h - pad * 2);
    points.push(x.toFixed(1) + ',' + y.toFixed(1));
  }
  var linePath = 'M' + points.join(' L');
  var lastPoint = points[points.length - 1];
  var lastX = lastPoint.split(',')[0];
  var firstPoint = points[0];
  var firstX = firstPoint.split(',')[0];
  var fillPath = linePath + ' L' + lastX + ',' + (h - pad) + ' L' + firstX + ',' + (h - pad) + ' Z';
  var svg = '<svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none">' +
    '<defs><linearGradient id="grad_' + elId + '" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="' + color + '" stop-opacity="0.55"/>' +
      '<stop offset="100%" stop-color="' + color + '" stop-opacity="0"/>' +
    '</linearGradient></defs>' +
    '<path d="' + fillPath + '" fill="url(#grad_' + elId + ')"/>' +
    '<path d="' + linePath + '" fill="none" stroke="' + color + '" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>' +
  '</svg>';
  el.innerHTML = svg;
}

function updateChange(elId, change){
  var el = document.getElementById(elId);
  if (!el) return;
  var sign = change >= 0 ? '▲ +' : '▼ ';
  el.textContent = sign + change.toFixed(2) + '%';
}

/* ---------- DEPOSIT VERIFICATION MODAL ---------- */
var depPendingTx = null;
var depAnswers = { source: null, origin: null };

function openDepositVerification(tx, cryptoAmt, symbol, usdValue){
  depPendingTx = { tx, cryptoAmt, symbol, usdValue };
  depAnswers = { source: null, origin: null };

  var cryptoEl = document.getElementById('depAmountCrypto');
  var usdEl    = document.getElementById('depAmountUsd');
  if (cryptoEl) cryptoEl.textContent = '+ ' + cryptoAmt.toFixed(8) + ' ' + symbol;
  if (usdEl)    usdEl.textContent    = '≈ ' + fmtCurrency(usdValue);

  var check = document.getElementById('depConfirmCheck');
  if (check) check.checked = false;
  var btnConfirm = document.getElementById('depBtnConfirm');
  if (btnConfirm) btnConfirm.disabled = true;

  showDepStep(0);
  var overlay = document.getElementById('depVerifyOverlay');
  if (overlay) overlay.classList.add('on');
}

function closeDepositVerification(){
  var overlay = document.getElementById('depVerifyOverlay');
  if (overlay) overlay.classList.remove('on');
  depPendingTx = null;
  depAnswers = { source: null, origin: null };
}

function showDepStep(n){
  var steps = document.querySelectorAll('.dep-step');
  for (var i = 0; i < steps.length; i++) steps[i].classList.remove('on');
  var target = document.getElementById('depStep' + n);
  if (target) target.classList.add('on');
}

function initDepositVerification(){
  var btnStart = document.getElementById('depBtnStart');
  if (btnStart) btnStart.onclick = function(){ showDepStep(1); };
  var allOpts = document.querySelectorAll('.dep-opt');
  for (var i = 0; i < allOpts.length; i++){
    allOpts[i].onclick = function(){
      var step = this.closest('.dep-step');
      var value = this.getAttribute('data-value');
      var siblings = step.querySelectorAll('.dep-opt');
      for (var j = 0; j < siblings.length; j++) siblings[j].classList.remove('on');
      this.classList.add('on');
      if (step.id === 'depStep1'){ depAnswers.source = value; setTimeout(function(){ showDepStep(2); }, 300); }
      else if (step.id === 'depStep2'){ depAnswers.origin = value; setTimeout(function(){ showDepStep(3); }, 300); }
    };
  }
  var check = document.getElementById('depConfirmCheck');
  var btnConfirm = document.getElementById('depBtnConfirm');
  if (check && btnConfirm) check.onchange = function(){ btnConfirm.disabled = !this.checked; };
  if (btnConfirm) btnConfirm.onclick = function(){ if (depPendingTx) finalizeDeposit(); };
  var btnDone = document.getElementById('depBtnDone');
  if (btnDone) btnDone.onclick = closeDepositVerification;
}

function finalizeDeposit(){
  if (!depPendingTx) return;
  var tx = depPendingTx.tx;
  var cryptoAmt = depPendingTx.cryptoAmt;
  var symbol = depPendingTx.symbol;
  var credit = depPendingTx.usdValue;

  if (!tx || !tx.hash) { toast('Deposit error — contact support', true); return; }

  var isDup = false;
  (st.txs || []).forEach(function(t){ if (t.hash === tx.hash) isDup = true; });
  if (isDup) { toast('Deposit already credited', true); closeDepositVerification(); return; }

  st.usd += credit;
  if (symbol === 'BTC') st.btc += cryptoAmt;
  else if (symbol === 'ETH') st.eth += cryptoAmt;

  if (!Array.isArray(st.txs)) st.txs = [];
  st.txs.unshift({
    date: now(), ts: Date.now(),
    desc: 'Crypto deposit — ' + Number(cryptoAmt).toFixed(8) + ' ' + symbol,
    amt: credit, status: 'Processing', hash: tx.hash,
    crypto: cryptoAmt, symbol,
    verification: { source: depAnswers.source, origin: depAnswers.origin }
  });

  if (!st.depositVerifications) st.depositVerifications = [];
  st.depositVerifications.push({
    txHash: tx.hash, cryptoAmt, symbol, usdValue: credit,
    source: depAnswers.source, origin: depAnswers.origin, completedAt: Date.now()
  });

  saveToServer();
  render();

  var cryptoEl = document.getElementById('depSuccessCrypto');
  var usdEl = document.getElementById('depSuccessUsd');
  var balEl = document.getElementById('depNewBalance');
  if (cryptoEl) cryptoEl.textContent = '+ ' + cryptoAmt.toFixed(8) + ' ' + symbol;
  if (usdEl) usdEl.textContent = '≈ ' + fmtCurrency(credit) + ' credited';
  if (balEl) balEl.textContent = fmtCurrency(st.usd);

  showDepStep(4);
  playChime();
  spawnConfetti();
  addNotification('Deposit verified: ' + cryptoAmt.toFixed(8) + ' ' + symbol, '✅');
}

/* ---------- BALANCE CHART ---------- */
 function renderBalanceChart(){
  var wrap2   = document.getElementById('balanceChartSecondary');
  var current = document.getElementById('balanceCurrent');
  if (!wrap2) return;

  // 🚀 ПАТЧ 2 — кэш (вставлено здесь)
  var chartHash = (st.usd || 0) + '|' + (st.txs || []).length + '|' + ((st.balanceHistory || []).length);
  if (window._balanceChartHash === chartHash && wrap2.querySelector('svg')) return;
  window._balanceChartHash = chartHash;
  if (current) current.textContent = fmtCurrency(st.usd);

  var txs = st.txs || [];
  if (txs.length < 1){
    wrap2.innerHTML = '<div style="text-align:center;padding:60px 20px;color:#94a3b8;font-size:.88rem"><div style="font-size:2rem;opacity:.4">📊</div><div>No activity yet</div></div>';
    return;
  }

  var days = 7, dayMs = 24 * 60 * 60 * 1000, nowT = Date.now();
  var points = [];
  var balanceHistory = st.balanceHistory || [];
  if (balanceHistory.length > 2) {
    balanceHistory.forEach(function(p) { points.push({ t: p.t, v: p.v }); });
    points.push({ t: Date.now(), v: st.usd });
  } else {
    for (var d = 0; d <= days; d++) {
      var dayT = nowT - (days - d) * dayMs;
      var totalAtDay = 0;
      for (var j = 0; j < txs.length; j++) {
        var txT = txs[j].ts || Date.now();
        if (txT <= dayT) totalAtDay += (txs[j].amt || 0);
      }
      points.push({ t: dayT, v: totalAtDay });
    }
    points.push({ t: nowT, v: st.usd });
  }

  var w = 500, h = 180, pad = 50;
  var minT, maxT;
  if (balanceHistory.length > 2) {
    minT = balanceHistory[0].t; maxT = Date.now();
    if (maxT - minT < 5 * 60 * 1000) minT = maxT - 5 * 60 * 1000;
  } else {
    minT = nowT - days * dayMs; maxT = nowT;
  }

  var minV = Infinity, maxV = -Infinity;
  for (var k = 0; k < points.length; k++){
    if (points[k].v < minV) minV = points[k].v;
    if (points[k].v > maxV) maxV = points[k].v;
  }
  if (!isFinite(minV) || !isFinite(maxV)) { minV = 0; maxV = 1; }
  if (maxV === minV) maxV = minV + 1;
  var padV = (maxV - minV) * 0.15 || 1;
  minV -= padV; maxV += padV;

  var svgPoints = [];
  for (var m = 0; m < points.length; m++){
    var p = points[m];
    var x = pad + ((p.t - minT) / (maxT - minT)) * (w - pad * 2);
    var y = pad + (1 - (p.v - minV) / (maxV - minV)) * (h - pad * 2);
    if (x < pad) x = pad;
    if (x > w - pad) x = w - pad;
    svgPoints.push(x.toFixed(1) + ',' + y.toFixed(1));
  }

  var linePath = 'M' + svgPoints.join(' L');
  var fillPath = linePath + ' L' + (w - pad) + ',' + (h - pad) + ' L' + pad + ',' + (h - pad) + ' Z';

  var svg = '<svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none">' +
  '<defs>' +
    '<linearGradient id="balanceGrad" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="#47dcff" stop-opacity="0.6"/>' +
      '<stop offset="60%" stop-color="#47dcff" stop-opacity="0.15"/>' +
      '<stop offset="100%" stop-color="#a855f7" stop-opacity="0"/>' +
    '</linearGradient>' +
    '<linearGradient id="lineGrad" x1="0" y1="0" x2="1" y2="0">' +
      '<stop offset="0%" stop-color="#47dcff"/>' +
      '<stop offset="50%" stop-color="#8b5cf6"/>' +
      '<stop offset="100%" stop-color="#ec4899"/>' +
    '</linearGradient>' +
    '<filter id="lineGlow" x="-50%" y="-50%" width="200%" height="200%">' +
      '<feGaussianBlur stdDeviation="3" result="blur"/>' +
      '<feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>' +
    '</filter>' +
  '</defs>' +
  '<path d="' + fillPath + '" fill="url(#balanceGrad)"/>' +
  '<path d="' + linePath + '" fill="none" stroke="url(#lineGrad)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" filter="url(#lineGlow)"/>' +
'</svg>';
  wrap2.innerHTML = svg;
}

/* ---------- STATS ---------- */
function renderStats(){
  var txs = st.txs || [];
  var income = 0, spending = 0;
  for (var i = 0; i < txs.length; i++){
    var amt = txs[i].amt || 0;
    if (amt > 0) income += amt;
    else if (amt < 0) spending += Math.abs(amt);
  }
  var incomeEl = document.getElementById('statIncome');
  if (incomeEl) incomeEl.textContent = fmtCurrency(income);
  var spendEl = document.getElementById('statSpending');
  if (spendEl) spendEl.textContent = fmtCurrency(spending);
  var countEl = document.getElementById('statTxCount');
  if (countEl) countEl.textContent = txs.length;
  var daysEl = document.getElementById('statDays');
  if (daysEl){
    if (st.card && st.card.createdAt){
      daysEl.textContent = Math.max(1, Math.ceil((Date.now() - st.card.createdAt) / (24 * 60 * 60 * 1000)));
    } else { daysEl.textContent = '1'; }
  }
  var now30 = Date.now() - 30 * 24 * 60 * 60 * 1000;
  var inc30 = 0, sp30 = 0, cnt30 = 0;
  for (var k = 0; k < txs.length; k++) {
    var t30 = txs[k].ts || 0;
    if (t30 >= now30) {
      cnt30++;
      var a30 = txs[k].amt || 0;
      if (a30 > 0) inc30 += a30;
      else if (a30 < 0) sp30 += Math.abs(a30);
    }
  }
  var elInc30 = document.getElementById('statIncome30');
  var elSp30  = document.getElementById('statSpending30');
  var elCnt30 = document.getElementById('statTxCount2');
  if (elInc30) elInc30.textContent = inc30 > 0 ? '+' + fmtCurrency(inc30) : '—';
  if (elSp30)  elSp30.textContent  = sp30  > 0 ? '-' + fmtCurrency(sp30)  : '—';
  if (elCnt30) elCnt30.textContent = cnt30;

  var sumDeposits = 0;
  for (var p = 0; p < txs.length; p++) if (txs[p].amt > 0) sumDeposits += txs[p].amt;
  var pnlEl = document.getElementById('pnlLine');
  if (pnlEl && sumDeposits > 0) {
    var pnl = st.usd - sumDeposits;
    var pnlPct = (pnl / sumDeposits) * 100;
    pnlEl.style.display = 'block';
    var pnlIconEl  = document.getElementById('pnlIcon');
    var pnlValueEl = document.getElementById('pnlValue');
    var pnlPctEl   = document.getElementById('pnlPct');
    var pnlExplainEl = document.getElementById('pnlExplain');
    if (pnlExplainEl) {
      pnlExplainEl.style.display = 'block';
      if (pnl < 0) { pnlExplainEl.textContent = 'ℹ Your crypto value decreased since deposit'; pnlExplainEl.style.color = '#ff5470'; }
      else if (pnl > 0) { pnlExplainEl.textContent = 'ℹ Your crypto value increased since deposit 🎉'; pnlExplainEl.style.color = '#00e08a'; }
      else { pnlExplainEl.textContent = 'ℹ Your crypto value is unchanged'; pnlExplainEl.style.color = 'var(--mut)'; }
    }
    pnlEl.style.color = pnl >= 0 ? '#00ffa3' : '#ff5470';
    if (pnlIconEl)  pnlIconEl.textContent  = pnl >= 0 ? '▲' : '▼';
    if (pnlValueEl) pnlValueEl.textContent = (pnl >= 0 ? '+' : '') + fmtCurrency(pnl);
    if (pnlPctEl)   pnlPctEl.textContent   = '(' + (pnl >= 0 ? '+' : '') + pnlPct.toFixed(2) + '%)';
  } else if (pnlEl) {
    pnlEl.style.display = 'none';
    var pnlExplainEl2 = document.getElementById('pnlExplain');
    if (pnlExplainEl2) pnlExplainEl2.style.display = 'none';
  }
}

/* ---------- WITHDRAW ---------- */
function openWithdraw() {
  var modal = document.getElementById('withdrawModal');
  if (!modal) return;
  var avail = document.getElementById('wdAvailable');
  if (avail) avail.textContent = fmtCurrency(st.usd);
  var amtIn = document.getElementById('wdAmount');
  if (amtIn) amtIn.value = '';
  var errIn = document.getElementById('wdError');
  if (errIn) errIn.style.display = 'none';
  var mIn = document.getElementById('wdMethod');
  if (mIn) mIn.value = 'iban';
  wdSwitchMethod();
  modal.style.display = 'flex';

  var expEl = document.getElementById('wdCardExpiry');
  var numEl = document.getElementById('wdCardNumber');
  if (expEl && !expEl.dataset.fmt) { attachExpiryFormatter(expEl); expEl.dataset.fmt = '1'; }
  if (numEl && !numEl.dataset.fmt) { attachCardFormatter(numEl); numEl.dataset.fmt = '1'; }
}

function closeWithdraw() {
  var modal = document.getElementById('withdrawModal');
  if (modal) modal.style.display = 'none';
}

function wdSwitchMethod() {
  var mEl = document.getElementById('wdMethod');
  if (!mEl) return;
  var m = mEl.value;
  var f1 = document.getElementById('wdFieldsIban');
  var f2 = document.getElementById('wdFieldsCard');
  var f3 = document.getElementById('wdFieldsCrypto');
  if (f1) f1.style.display = (m === 'iban') ? 'block' : 'none';
  if (f2) f2.style.display = (m === 'card') ? 'block' : 'none';
  if (f3) f3.style.display = (m === 'crypto') ? 'block' : 'none';
  if (m === 'crypto') wdSwitchCryptoDest();
}

function wdSwitchCryptoDest() {
  var dEl = document.getElementById('wdCryptoDest');
  if (!dEl) return;
  var mEl = document.getElementById('wdMemoWrap');
  if (mEl) mEl.style.display = (dEl.value === 'external') ? 'block' : 'none';
}

function _val(id){ var el = document.getElementById(id); return el ? el.value : ''; }

function submitWithdraw() {
  var amountEl = document.getElementById('wdAmount');
  var methodEl = document.getElementById('wdMethod');
  var errEl    = document.getElementById('wdError');
  if (!amountEl || !methodEl || !errEl) return;

  var amount = parseFloat(amountEl.value) || 0;
  var method = methodEl.value;
  function showErr(msg) { errEl.textContent = msg; errEl.style.display = 'block'; }
  errEl.style.display = 'none';

  if (amount <= 0) return showErr('Enter a valid amount');
  if (amount > st.usd) return showErr('Amount exceeds available balance');

  var wd = {
    id: 'wd_' + Date.now(), amount, currency: (st.currency || 'USD'),
    method, status: 'pending', createdAt: Date.now(),
    reviewedAt: null, reason: '', reviewedBy: '', details: {}
  };

  if (method === 'iban') {
    var name    = _val('wdIbanName').trim();
    var iban    = _val('wdIbanNumber').trim();
    var swift   = _val('wdIbanSwift').trim();
    var bank    = _val('wdIbanBank').trim();
    var country = _val('wdIbanCountry').trim();
    if (name.length < 2) return showErr('Enter recipient name');
    if (iban.replace(/\s/g, '').length < 15) return showErr('Enter valid IBAN');
    if (swift.length < 6) return showErr('Enter valid SWIFT / BIC');
    wd.details = { name, iban, swift, bank, country };
  } else if (method === 'card') {
    var cn  = _val('wdCardName').trim();
    var num = _val('wdCardNumber').trim();
    var exp = _val('wdCardExpiry').trim();
    if (cn.length < 2) return showErr('Enter card holder name');
    if (num.replace(/\s/g, '').length < 16) return showErr('Enter valid card number');
    if (!/^\d{2}\/\d{2}$/.test(exp)) return showErr('Expiry must be MM/YY');
    wd.details = { cardName: cn, cardNumber: num, expiry: exp };
  } else if (method === 'crypto') {
    var dest = _val('wdCryptoDest');
    var net  = _val('wdCryptoNetwork');
    var coin = _val('wdCryptoCoin');
    var addr = _val('wdCryptoAddress').trim();
    var memo = _val('wdCryptoMemo').trim();
    if (addr.length < 10) return showErr('Enter valid wallet address');
    wd.details = { destination: dest, network: net, coin, address: addr, memo };
  }

  if (!st.withdrawals) st.withdrawals = [];
  st.withdrawals.unshift(wd);
  closeWithdraw();
  render();
  showWithdrawStatus(method, amount);
  saveToServer();
}

function showWithdrawStatus(method, amount) {
  var modal = document.getElementById('txStatus');
  var title = document.getElementById('txStatusTitle');
  var desc  = document.getElementById('txStatusDesc');
  var step1 = document.getElementById('txStep1');
  var step2 = document.getElementById('txStep2');
  var step3 = document.getElementById('txStep3');
  if (!modal) return;

  modal.style.display = 'flex';
  modal.classList.add('on');
  if (title) title.textContent = 'Submitting request...';
  if (desc)  desc.textContent  = 'Creating your withdrawal request for ' + fmtCurrency(amount);
  if (step1) step1.style.background = '#47dcff';
  if (step2) step2.style.background = 'rgba(255,255,255,.1)';
  if (step3) step3.style.background = 'rgba(255,255,255,.1)';

  setTimeout(function() {
    if (title) title.textContent = 'Verifying details...';
    if (desc)  desc.textContent  = 'Checking your IBAN and recipient information.';
    if (step2) step2.style.background = '#47dcff';
  }, 1500);
  setTimeout(function() {
    if (title) title.textContent = 'Under review';
    if (desc)  desc.textContent  = 'Your withdrawal is being processed. We will notify you once it is complete.';
    if (step3) step3.style.background = '#47dcff';
  }, 3000);
  setTimeout(function() {
    modal.classList.remove('on');
    setTimeout(function() { modal.style.display = 'none'; }, 300);
  }, 5500);
}

/* ---------- RECENT TX ---------- */
/* ============================================================
   🎁 TX DETAILS MODAL — открывает окно с деталями транзакции
   ============================================================ */

function txStatusLabel(s) {
  if (s === 'Completed')   return { text: '✓ Completed',    bg: 'rgba(0,224,138,.14)',  color: '#00e08a' };
  if (s === 'Processing')  return { text: '⏳ Processing',   bg: 'rgba(0,212,255,.14)',  color: '#47dcff' };
  if (s === 'Under Review')return { text: '⏳ Under review', bg: 'rgba(255,176,32,.14)', color: '#ffb020' };
  if (s === 'Rejected')    return { text: '✗ Rejected',     bg: 'rgba(255,84,112,.14)', color: '#ff5470' };
  return { text: s || '—', bg: 'rgba(255,255,255,.06)', color: '#94a3b8' };
}

function txdRow(label, value, mono) {
  return '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:10px 14px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:10px">' +
    '<span style="color:#94a3b8;font-size:.78rem;text-transform:uppercase;letter-spacing:.06em;flex-shrink:0">' + escapeHtml(label) + '</span>' +
    '<b style="' + (mono ? 'font-family:ui-monospace,monospace;' : '') + 'font-size:.85rem;text-align:right;word-break:break-all;max-width:65%">' + value + '</b>' +
  '</div>';
}

function openTxDetails(tx) {
  var mask = document.getElementById('txDetailsMask');
  if (!mask) {
    console.warn('[txd] txDetailsMask not found in DOM');
    toast(tx.desc + ' — ' + fmtCurrency(tx.amt) + ' (' + tx.status + ')');
    return;
  }

  var isWithdrawal = !!tx.isWithdrawal;
  var amount = tx.amt || 0;
  var status = tx.status || '—';
  var badge = txStatusLabel(status);

  // Kicker
  var kicker = document.getElementById('txdKicker');
  if (kicker) {
    if (isWithdrawal) kicker.textContent = '📤 Withdrawal';
    else if ((tx.desc || '').toLowerCase().indexOf('deposit') !== -1) kicker.textContent = '💰 Deposit';
    else if ((tx.desc || '').toLowerCase().indexOf('transfer') !== -1) kicker.textContent = '🔁 Transfer';
    else kicker.textContent = '💳 Transaction';
  }

  // Amount
  var amtEl = document.getElementById('txdAmount');
  if (amtEl) {
    amtEl.textContent = (amount > 0 ? '+' : '') + fmtCurrency(amount);
    amtEl.style.color = amount >= 0 ? '#00e08a' : '#ff5470';
  }

  // Badge
  var badgeEl = document.getElementById('txdStatusBadge');
  if (badgeEl) {
    badgeEl.textContent = badge.text;
    badgeEl.style.background = badge.bg;
    badgeEl.style.color = badge.color;
  }

  // Body
  var body = document.getElementById('txdBody');
  if (!body) return;
  var rows = '';

  rows += txdRow('Date', new Date(tx.ts || Date.now()).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
  }));
  rows += txdRow('Description', escapeHtml(tx.desc || '—'));

  if (isWithdrawal) {
    var wd = (st.withdrawals || []).find(function(w){ return w.id === tx.wdId; });
    if (wd) {
      rows += txdRow('Method', (wd.method || 'iban').toUpperCase());
      if (wd.details) {
        var d = wd.details;
        if (d.name)       rows += txdRow('Recipient', escapeHtml(d.name));
        if (d.iban)       rows += txdRow('IBAN', escapeHtml(d.iban), true);
        if (d.swift)      rows += txdRow('SWIFT / BIC', escapeHtml(d.swift), true);
        if (d.bank)       rows += txdRow('Bank', escapeHtml(d.bank));
        if (d.country)    rows += txdRow('Country', escapeHtml(d.country));
        if (d.cardName)   rows += txdRow('Card holder', escapeHtml(d.cardName));
        if (d.cardNumber) rows += txdRow('Card number', escapeHtml(d.cardNumber), true);
        if (d.expiry)     rows += txdRow('Card expiry', escapeHtml(d.expiry));
        if (d.network)    rows += txdRow('Network', escapeHtml(d.network));
        if (d.coin)       rows += txdRow('Coin', escapeHtml(d.coin));
        if (d.address)    rows += txdRow('Wallet', escapeHtml(d.address), true);
        if (d.memo)       rows += txdRow('Memo', escapeHtml(d.memo));
      }
      if (wd.status === 'rejected' && wd.reason) {
        rows += '<div style="padding:12px 14px;background:rgba(255,84,112,.08);border:1px solid rgba(255,84,112,.3);border-radius:10px;color:#ff8a8a;font-size:.85rem;margin-top:4px">' +
          '<b>❌ Rejection reason:</b><br>' + escapeHtml(wd.reason) + '</div>';
      }
    } else {
      rows += txdRow('Method', 'IBAN');
    }
  } else {
    if (tx.hash) {
      var explorer = '';
      var symbol = (tx.symbol || '').toUpperCase();
      if (symbol === 'BTC') explorer = 'https://mempool.space/tx/' + tx.hash;
      else if (symbol === 'ETH') explorer = 'https://etherscan.io/tx/' + tx.hash;

      var hashDisplay = tx.hash.slice(0, 14) + '…' + tx.hash.slice(-10);
      var hashHtml = explorer
        ? '<a href="' + explorer + '" target="_blank" rel="noopener" style="color:#47dcff;text-decoration:none">' + escapeHtml(hashDisplay) + ' ↗</a>'
        : escapeHtml(hashDisplay);

      rows += '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:10px 14px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:10px">' +
        '<span style="color:#94a3b8;font-size:.78rem;text-transform:uppercase;letter-spacing:.06em">TX hash</span>' +
        '<span style="text-align:right;max-width:65%">' +
          '<b style="font-family:ui-monospace;font-size:.85rem;word-break:break-all">' + hashHtml + '</b>' +
          '<button onclick="event.stopPropagation();copyText(\'' + tx.hash + '\',\'TX hash copied\')" style="margin-left:6px;background:transparent;border:none;color:#47dcff;cursor:pointer;font-size:14px" title="Copy">📋</button>' +
        '</span>' +
      '</div>';
    }
    if (tx.symbol) rows += txdRow('Symbol', escapeHtml(tx.symbol));
    if (tx.crypto) rows += txdRow('Crypto amount', Number(tx.crypto).toFixed(8) + ' ' + escapeHtml(tx.symbol || ''));
    if (tx.to)     rows += txdRow('To address', escapeHtml(tx.to), true);
  }

  var txId = tx.hash || tx.wdId || ('tx_' + (tx.ts || Date.now()));
  rows += txdRow('Transaction ID', '#' + String(txId).slice(0, 24) + (String(txId).length > 24 ? '…' : ''));

  body.innerHTML = rows;
  mask.classList.add('on');
}

function closeTxDetails() {
  var mask = document.getElementById('txDetailsMask');
  if (mask) mask.classList.remove('on');
}
function renderRecentTx(){
  var listEl = document.getElementById('recentTxList');
  if (!listEl) return;
  var txs = (st.txs || []).slice();
  var withdrawals = st.withdrawals || [];
  withdrawals.forEach(function(w){
    txs.push({
      ts: w.createdAt,
      desc: 'Withdrawal via ' + (w.method || 'iban').toUpperCase(),
      amt: -w.amount,
      status: w.status === 'pending' ? 'Under Review' : w.status === 'approved' ? 'Completed' : w.status === 'rejected' ? 'Rejected' : w.status,
      reason: w.reason || '', isWithdrawal: true, wdId: w.id
    });
  });
  txs.sort(function(a, b){ return (b.ts || 0) - (a.ts || 0); });
  txs = txs.slice(0, 5);

  if (txs.length === 0){
    listEl.innerHTML = '<div class="recent-tx-empty">No transactions yet</div>';
    return;
  }

  var html = '';
  for (var i = 0; i < txs.length; i++){
    var t = txs[i];
    var icon = '💳', iconClass = 'card';
    if (t.desc && t.desc.toLowerCase().indexOf('deposit') !== -1){ icon = '💰'; iconClass = 'deposit'; }
    else if (t.desc && t.desc.toLowerCase().indexOf('withdrawal') !== -1){ icon = '💸'; iconClass = 'withdrawal'; }

    var amtClass = 'neutral', amtText = '—';
    if (t.amt > 0){ amtClass = 'plus'; amtText = '+' + fmtCurrency(t.amt); }
    else if (t.amt < 0){ amtClass = 'minus'; amtText = fmtCurrency(t.amt); }

    var badge = '';
    if (t.status === 'Completed') badge = '<div class="recent-tx-badge ok">✓ Completed</div>';
    else if (t.status === 'Processing') badge = '<div class="recent-tx-badge proc">⏳ Processing</div>';
    else if (t.status === 'Under Review') badge = '<div class="recent-tx-badge pend">⏳ Under review</div>';
    else if (t.status === 'Rejected') badge = '<div class="recent-tx-badge fail">✗ Rejected</div>';

    var timeStr = t.ts ? timeAgo(t.ts) : (t.date || '');

    html += '<div class="recent-tx-item" data-tx-i="' + i + '" style="cursor:pointer" title="Click for details">' +
      '<div class="recent-tx-icon ' + iconClass + '">' + icon + '</div>' +
      '<div class="recent-tx-info">' +
        '<div class="recent-tx-desc">' + (t.desc || 'Transaction') + '</div>' +
        '<div class="recent-tx-time">' + timeStr + '</div>' +
        badge +
      '</div>' +
      '<div class="recent-tx-amount ' + amtClass + '">' + amtText + '</div>' +
    '</div>';
  }
  listEl.innerHTML = html;

  // 🎁 Клик по карточкам
  var items = listEl.querySelectorAll('.recent-tx-item[data-tx-i]');
  for (var k = 0; k < items.length; k++) {
    (function(idx){
      items[k].onclick = function(){
        var t = txs[idx];
        if (!t) return;
        if (typeof openTxDetails === 'function') openTxDetails(t);
        else toast(t.desc + ' — ' + fmtCurrency(t.amt) + ' (' + t.status + ')');
      };
    })(k);
  }
}

function initRecentTx(){
  var viewAll = document.getElementById('viewAllTx');
  if (viewAll) viewAll.onclick = function(e){
    e.preventDefault();
    var pgs = document.querySelectorAll('.pg');
    for (var i = 0; i < pgs.length; i++) pgs[i].classList.remove('on');
    var txPg = document.getElementById('tx');
    if (txPg) txPg.classList.add('on');
    var ms = document.querySelectorAll('.mi');
    for (var j = 0; j < ms.length; j++) ms[j].classList.remove('on');
    var txMi = document.querySelector('.mi[data-p="tx"]');
    if (txMi) txMi.classList.add('on');
  };
}

/* ---------- CARD DESIGN ---------- */
function applyCardDesign(){
  if (!st.card || !st.card.design) return;
  var design = st.card.design || 'cosmic';
  var cards = document.querySelectorAll('.pay');
  for (var i = 0; i < cards.length; i++){
    var c = cards[i];
    if (c.closest('.onb-preview') || c.closest('.onb-step')) continue;
    c.classList.remove('design-cosmic', 'design-purple', 'design-silver', 'design-black', 'design-gold', 'design-ocean', 'design-mountain', 'design-aurora', 'design-city');
    c.classList.add('design-' + design);
  }
}

function setSelectedDesign(design){
  selectedDesign = design;
  var opts = document.querySelectorAll('.design-opt');
  for (var i = 0; i < opts.length; i++){
    opts[i].classList.toggle('on', opts[i].getAttribute('data-design') === design);
  }
}

function initDesignPicker(){
  var picker = document.getElementById('designPicker');
  if (picker){
    var opts = picker.querySelectorAll('.design-opt');
    for (var i = 0; i < opts.length; i++){
      opts[i].onclick = function(){ setSelectedDesign(this.getAttribute('data-design')); };
    }
  }
  var modalPicker = document.getElementById('designPickerModal');
  if (modalPicker){
    var mopts = modalPicker.querySelectorAll('.design-opt');
    for (var j = 0; j < mopts.length; j++){
      mopts[j].onclick = function(){
        var all = modalPicker.querySelectorAll('.design-opt');
        for (var k = 0; k < all.length; k++) all[k].classList.remove('on');
        this.classList.add('on');
      };
    }
  }
  var btnChange = document.getElementById('btnChangeDesign');
  if (btnChange){
    btnChange.onclick = function(){
      if (!st.card){ toast('No card yet', true); return; }
      var current = st.card.design || 'cosmic';
      var all = document.querySelectorAll('#designPickerModal .design-opt');
      for (var k = 0; k < all.length; k++){
        all[k].classList.toggle('on', all[k].getAttribute('data-design') === current);
      }
      var mask = document.getElementById('designMask');
      if (mask) mask.classList.add('on');
    };
  }
  var btnSave = document.getElementById('designSave');
  if (btnSave){
    btnSave.onclick = function(){
      var active = document.querySelector('#designPickerModal .design-opt.on');
      if (!active){ toast('Please choose a design', true); return; }
      var d = active.getAttribute('data-design');
      var mask = document.getElementById('designMask');
      if (mask) mask.classList.remove('on');
      openPasswordConfirm('Confirm changing card design to "' + d + '"', function(){
        if (!st.card) st.card = {};
        st.card.design = d;
        saveToServer();
        applyCardDesign();
        renderCard();
        toast('Card design updated');
      });
    };
  }
  var btnCancel = document.getElementById('designCancel');
  if (btnCancel) btnCancel.onclick = function(){
    var mask = document.getElementById('designMask');
    if (mask) mask.classList.remove('on');
  };
}

/* ---------- IBAN ---------- */
function renderIbanByAdmin() {
  var pending = document.getElementById('ibanPending');
  var ready   = document.getElementById('ibanReady');
  if (!pending || !ready) return;

  var iban = st.user && st.user.iban;
  if (iban) {
    pending.style.display = 'none';
    ready.style.display   = 'block';
    var ibanEl = document.getElementById('myIban');
    if (ibanEl) ibanEl.textContent = iban.replace(/(.{4})/g, '$1 ').trim();
    var swiftEl = document.getElementById('mySwift');
    if (swiftEl && st.user.swift) swiftEl.textContent = st.user.swift;
    var bankEl = document.getElementById('myBank');
    if (bankEl && st.user.bank) bankEl.textContent = st.user.bank;
    var countryEl = document.getElementById('myCountry');
    if (countryEl) {
      var names = { SE:'Sweden', NO:'Norway', DK:'Denmark', FI:'Finland', DE:'Germany', FR:'France', ES:'Spain', IT:'Italy', NL:'Netherlands', GB:'United Kingdom', US:'United States' };
      var flags = { SE:'🇸🇪', NO:'🇳🇴', DK:'🇩🇰', FI:'🇫🇮', DE:'🇩🇪', FR:'🇫🇷', ES:'🇪🇸', IT:'🇮🇹', NL:'🇳🇱', GB:'🇬🇧', US:'🇺🇸' };
      var code = st.user.country || 'SE';
      countryEl.textContent = (flags[code] || '') + ' ' + (names[code] || code) + ' (' + code + ')';
    }
  } else {
    pending.style.display = 'block';
    ready.style.display   = 'none';
  }
}

/* === END OF PART B === */
