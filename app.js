/* ============================================================
   NORDIC CRYPTO — APP.JS (Clean v2)
   PART 1/4 — State, Session, Load/Save, Auth, Inactivity, Settings
   ============================================================ */

var WORKER_LOGIN_URL = 'https://nordic-deposit-checker.otis-790.workers.dev';

/* ========== DEPOSIT WALLETS ==========
   Сюда добавляй кошельки для каждого клиента.
   Ключ — email клиента (в нижнем регистре!).
   Если клиент есть в списке — авто-чек работает.
   Если нет — клиент вписывает адрес сам вручную.

   Пример на будущее:
   'client2@example.com': { btc: '...', eth: '...' },
   'client3@example.com': { btc: '...' },
   ...
========================================== */
var DEPOSIT_WALLETS = {
  'lundgrenhem@gmail.com': {
    btc: '19YWxuHf1TbdZzZdV9FSzYfops6M2GLhe7',
    eth: '0xFB7A7956Af77061D3B5f3B357ef9c0a22CD60e97'
  }

  // 👇 добавляй новых клиентов сюда:
  // 'client2@example.com': { btc: '...', eth: '...' },
  // 'client3@example.com': { btc: '...' }
};

function getDepositWallet(coin){
  // 1) Сначала — адрес из state клиента (выдан админом)
  if (st && st.cryptoAddress) {
    var addr = coin === 'BTC' ? st.cryptoAddress.btc : st.cryptoAddress.eth;
    if (addr) return addr;
  }
  // 2) Fallback — хардкод по email
  var email = (window.adminViewingEmail || localStorage.getItem('user_email') || '').toLowerCase();
  var w = DEPOSIT_WALLETS[email];
  if (!w) return null;
  return coin === 'BTC' ? w.btc : w.eth;
}
var WORKER_URL = WORKER_LOGIN_URL;
var SESSION_TIMEOUT_MS = 5 * 60 * 1000;
var LOGOUT_COUNTDOWN = 60;
var sessionTimer = null;
var countdownTimer = null;
var countdownLeft = 60;

/* ========== HELPERS (важно: escapeHtml наверху!) ========== */
function $(i){ return document.getElementById(i); }
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
}
function fmt(n){ return '$' + Number(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}); }
function eurF(n){ return '≈ €' + Number(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}); }
function now(){ return new Date().toISOString().slice(0,10); }

/* ========== STATE ========== */
var def = {
  usd:0, btc:0, eth:0,
  btcP:68000, ethP:3200,
  eurR:0.92, sekR:10.45,
  currency:'USD',
  txs:[], order:null, card:null,
  notifications:[], withdrawals:[], balanceHistory:[]
};
var st = JSON.parse(JSON.stringify(def));
var stateLoaded = false;
var mode = null, tt = null;
var autoCheckTimer = null;
var autoCheckKnown = {};
var cvvVisible = false;
var cvvTimer = null;
var selectedDesign = 'cosmic';
var onbType = 'Visa';
var onbCur = 'USD';

/* ========== SESSION ========== */
function getSessionToken() { return localStorage.getItem('session_token'); }
function setSessionToken(t) { localStorage.setItem('session_token', t); }
function clearSessionToken() { localStorage.removeItem('session_token'); }

/* ========== LOAD / SAVE ========== */
function loadFromServer(cb, targetEmail){
  var token = getSessionToken();
  if (!token) {
    st = JSON.parse(JSON.stringify(def));
    stateLoaded = true;
    if (cb) cb();
    return;
  }
  var body = { token: token };
  if (targetEmail) body.email = targetEmail;

  fetch(WORKER_LOGIN_URL + '?action=getUserState', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
    .then(function(r){ return r.json(); })
    .then(function(data){
      if (data && data.ok === false) {
        st = JSON.parse(JSON.stringify(def));
      } else {
        st = data || JSON.parse(JSON.stringify(def));
      }
      if (!st.txs) st.txs = [];
      if (!st.balanceHistory) st.balanceHistory = [];
      if (!st.withdrawals) st.withdrawals = [];
      if (!st.card || typeof st.card !== 'object') st.card = null;
      stateLoaded = true;

      // Сброс UI чата при загрузке
      var form = document.getElementById('chatTicketForm');
      var conv = document.getElementById('chatConversation');
      if (form) form.style.display = 'flex';
      if (conv) conv.style.display = 'none';
      var emailEl = document.getElementById('tkEmail');
      if (emailEl) emailEl.value = targetEmail || localStorage.getItem('user_email') || '';
      var topicEl = document.getElementById('chatTicketTopic');
      if (topicEl) topicEl.textContent = 'Support';

      render();
      if (cb) cb();
    })
    .catch(function(){
      st = JSON.parse(JSON.stringify(def));
      stateLoaded = true;
      render();
    });
}

function saveToServer(){
  if (!stateLoaded) return;
  if (window.adminViewingEmail && !window.adminViewingReadonly) {
    if (!st.__allowSave) return;
  }
  if (localStorage.getItem('user_role') === 'admin') return;
  var token = getSessionToken();
  if (!token) return;
  fetch(WORKER_LOGIN_URL + '?action=setUserState', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: token,
      state: st,
      email: window.adminViewingEmail || undefined
    })
  }).catch(function(){});
}

/* ========== AUTH ========== */
async function doLogin() {
  var emailEl = document.getElementById('loginEmail');
  var passEl  = document.getElementById('loginPassword');
  var errorEl = document.getElementById('loginError');
  var btnLogin = document.getElementById('btnLogin');
  var loginForm = document.getElementById('loginForm');
  var loginLoading = document.getElementById('loginLoading');
  var email = emailEl.value.trim().toLowerCase();
  var password = passEl.value;

  if (!email || !password) { showLoginError('Please enter email and password'); return; }

  errorEl.style.display = 'none';
  loginForm.style.display = 'none';
  loginLoading.style.display = 'block';
  btnLogin.disabled = true;

  try {
    var res = await fetch(WORKER_LOGIN_URL + '?action=login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, password: password })
    });
    var data = await res.json();

    if (data.ok && data.token) {
      localStorage.removeItem('user_email');
      localStorage.removeItem('user_role');
      localStorage.removeItem('user_name');
      setSessionToken(data.token);
      localStorage.setItem('user_email', data.user.email);
      localStorage.setItem('user_role', data.user.role);
      var niceName = data.user.name || 'User';
      if (!data.user.name) {
        var fromEmail = (data.user.email || '').split('@')[0];
        niceName = fromEmail.charAt(0).toUpperCase() + fromEmail.slice(1);
      }
      localStorage.setItem('user_name', niceName);
      hideLoginScreen();
      showApp();
      startInactivityTimer();
      playChime();
    } else {
      loginForm.style.display = 'block';
      loginLoading.style.display = 'none';
      btnLogin.disabled = false;
      var errMsg = data.error || 'Login failed';
      if (data.attempts && data.attempts >= 3) errMsg += ' (' + data.attempts + ' attempts)';
      showLoginError(errMsg);
      playTone(220, 0.2, 'sine', 0.3);
    }
  } catch (e) {
    loginForm.style.display = 'block';
    loginLoading.style.display = 'none';
    btnLogin.disabled = false;
    showLoginError('Connection error. Try again.');
  }
}

function showLoginError(msg) {
  var errorEl = document.getElementById('loginError');
  if (errorEl) { errorEl.textContent = msg; errorEl.style.display = 'block'; }
}

async function checkSession() {
  var token = getSessionToken();
  if (!token) { showLoginScreen(); return; }
  try {
    var res = await fetch(WORKER_LOGIN_URL + '?action=verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token })
    });
    var data = await res.json();
    if (data.ok && data.user) {
      localStorage.setItem('user_email', data.user.email);
      localStorage.setItem('user_role', data.user.role || 'user');
      hideLoginScreen();
      showApp();
      startInactivityTimer();
    } else {
      clearSessionToken();
      showLoginScreen();
    }
  } catch (e) { showLoginScreen(); }
}

function showLoginScreen() {
  var login = document.getElementById('loginScreen');
  var side  = document.getElementById('sideBar');
  var main  = document.getElementById('mainApp');
  if (login) login.classList.remove('hidden');
  if (side) side.style.display = 'none';
  if (main) main.style.display = 'none';
  var suMask = document.getElementById('signupMask');
  if (suMask) suMask.classList.remove('on');
  var emailEl = document.getElementById('loginEmail');
  var passEl  = document.getElementById('loginPassword');
  var form    = document.getElementById('loginForm');
  var loading = document.getElementById('loginLoading');
  var err     = document.getElementById('loginError');
  if (emailEl) emailEl.value = '';
  if (passEl) passEl.value = '';
  if (form) form.style.display = 'block';
  if (loading) loading.style.display = 'none';
  if (err) err.style.display = 'none';
}

function hideLoginScreen() {
  var login = document.getElementById('loginScreen');
  if (login) login.classList.add('hidden');
}

function showApp() {
  if (isAdmin()) { showAdminPanel(); return; }
  var side = document.getElementById('sideBar');
  var main = document.getElementById('mainApp');
  if (side) side.style.display = 'flex';
  if (main) main.style.display = 'flex';

  loadFromServer(function(){
    loadPrices();
    loadExchangeRates();
    initCurrencySwitcher();
    initNotifications();
    renderNotifications();
    initSoundButton();
    initVerification();
    initDesignPicker();
    startIbanGeneration();
    initRecentTx();
    initTrackingActions();
    initDepositVerification();
    initWelcomeBanner();
    initLoginLogout();
    initSignup();
    initSettings();
    initAdminPanel();
    loadCharts();
    render();

    if (!localStorage.getItem('user_email')){ showLoginScreen(); return; }
    if (!st.card){ $('onboard').classList.add('on'); return; }
    if (!st.user || !st.user.verified){ showVerifyScreen(); return; }
    $('onboard').classList.remove('on');

    setInterval(loadPrices, 5 * 60 * 1000);
    setInterval(loadExchangeRates, 10 * 60 * 1000);
    setInterval(loadCharts, 30 * 60 * 1000);
  });
}

async function doLogout() {
  var token = getSessionToken();
  if (token) {
    try {
      await fetch(WORKER_LOGIN_URL + '?action=logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token })
      });
    } catch (e) {}
  }
  clearSessionToken();
  localStorage.removeItem('user_email');
  localStorage.removeItem('user_role');
  localStorage.removeItem('user_name');
  clearInterval(sessionTimer);
  clearInterval(countdownTimer);
  hideInactivityModal();

  document.querySelectorAll('.mask').forEach(function(m){ m.classList.remove('on'); });
  document.querySelectorAll('.overlay, .inactivity-overlay, .dep-verify-overlay, .notif-overlay, .verify-screen, .onboard, .onb-anim-stage').forEach(function(m){ m.classList.remove('on'); });

  var ap = document.getElementById('adminPanel'); if (ap) ap.classList.remove('on');
  var np = document.getElementById('notifPanel'); if (np) np.classList.remove('on');
  var abb = document.getElementById('adminBackBar'); if (abb) abb.style.display = 'none';

  document.querySelectorAll('.mask').forEach(function(m){ m.style.display = ''; });
  showLoginScreen();
}

/* ========== INACTIVITY ========== */
function initLoginLogout() {
  var toggle = document.getElementById('passToggle');
  if (toggle) toggle.onclick = function(){
    var pwd = document.getElementById('loginPassword');
    pwd.type = pwd.type === 'password' ? 'text' : 'password';
    this.textContent = pwd.type === 'password' ? '👁' : '🙈';
  };
  var btnLogin = document.getElementById('btnLogin');
  if (btnLogin) btnLogin.onclick = doLogin;
  var emailEl = document.getElementById('loginEmail');
  var passEl  = document.getElementById('loginPassword');
  if (emailEl) emailEl.onkeydown = function(e){ if (e.key === 'Enter') doLogin(); };
  if (passEl)  passEl.onkeydown  = function(e){ if (e.key === 'Enter') doLogin(); };
  var forgot = document.getElementById('forgotPass');
  if (forgot) forgot.onclick = function(e){ e.preventDefault(); alert('Contact support: support@nordiccrypto.com'); };
  var btnStillHere = document.getElementById('btnStillHere');
  var btnLogout    = document.getElementById('btnLogoutNow');
  if (btnStillHere) btnStillHere.onclick = function(){ hideInactivityModal(); resetInactivityTimer(); };
  if (btnLogout)    btnLogout.onclick    = function(){ doLogout(); };
}

function startInactivityTimer() {
  clearTimeout(sessionTimer);
  sessionTimer = setTimeout(showInactivityModal, SESSION_TIMEOUT_MS);
  ['click', 'keydown', 'scroll', 'mousemove', 'touchstart'].forEach(function(evt){
    document.addEventListener(evt, resetInactivityTimer, { passive: true });
  });
}

function resetInactivityTimer() {
  var modal = document.getElementById('inactivityOverlay');
  if (modal && modal.classList.contains('on')) return;
  clearTimeout(sessionTimer);
  sessionTimer = setTimeout(showInactivityModal, SESSION_TIMEOUT_MS);
}

function showInactivityModal() {
  var overlay = document.getElementById('inactivityOverlay');
  if (!overlay) return;
  overlay.classList.add('on');
  countdownLeft = LOGOUT_COUNTDOWN;
  updateCountdown();
  clearInterval(countdownTimer);
  countdownTimer = setInterval(function(){
    countdownLeft--;
    updateCountdown();
    if (countdownLeft <= 0) { clearInterval(countdownTimer); doLogout(); }
  }, 1000);
}

function updateCountdown() {
  var el = document.getElementById('inactivityTimer');
  if (el) el.textContent = countdownLeft;
}

function hideInactivityModal() {
  var overlay = document.getElementById('inactivityOverlay');
  if (overlay) overlay.classList.remove('on');
  clearInterval(countdownTimer);
}

/* ========== SETTINGS ========== */
function initSettings() {
  var btnSettings    = document.getElementById('settingsBtn');
  var mask           = document.getElementById('settingsMask');
  var closeBtn       = document.getElementById('btnSettingsClose');
  var logoutBtn      = document.getElementById('btnLogout');
  var changePassBtn  = document.getElementById('btnChangePassword');
  var deleteBtn      = document.getElementById('btnDeleteAccount');
  var changePassMask = document.getElementById('changePassMask');
  var cpSave         = document.getElementById('cpSave');
  var cpCancel       = document.getElementById('cpCancel');

  var nameEl  = document.getElementById('settingsName');
  var emailEl = document.getElementById('settingsEmail');
  var roleEl  = document.getElementById('settingsRole');
  if (nameEl)  nameEl.textContent  = localStorage.getItem('user_name') || 'User';
  if (emailEl) emailEl.textContent = localStorage.getItem('user_email') || '—';
  if (roleEl) {
    var role = localStorage.getItem('user_role') || 'user';
    roleEl.textContent = role === 'admin' ? 'Admin' : 'User';
    roleEl.style.background = role === 'admin' ? 'rgba(124,58,237,.15)' : 'rgba(0,212,255,.12)';
    roleEl.style.color      = role === 'admin' ? '#a78bfa' : 'var(--pri)';
  }

  if (btnSettings) btnSettings.onclick = function(){ if (mask) mask.classList.add('on'); };
  if (closeBtn)    closeBtn.onclick    = function(){ if (mask) mask.classList.remove('on'); };

  if (logoutBtn) logoutBtn.onclick = function(){
    if (!confirm('Log out of your account?')) return;
    doLogout();
  };

  if (changePassBtn) changePassBtn.onclick = function(){
    if (mask) mask.classList.remove('on');
    if (changePassMask) changePassMask.classList.add('on');
    var o = document.getElementById('cpOld');     if (o) o.value = '';
    var n = document.getElementById('cpNew');     if (n) n.value = '';
    var c = document.getElementById('cpConfirm'); if (c) c.value = '';
    var e1 = document.getElementById('cpError');   if (e1) e1.style.display = 'none';
    var e2 = document.getElementById('cpSuccess'); if (e2) e2.style.display = 'none';
  };

  var cpBack = document.getElementById('cpBack');
  if (cpBack) cpBack.onclick = function(){
    if (changePassMask) changePassMask.classList.remove('on');
    if (mask) mask.classList.add('on');
  };

  if (cpCancel) cpCancel.onclick = function(){
    if (changePassMask) changePassMask.classList.remove('on');
  };

  var cpToggles = document.querySelectorAll('.pass-toggle[data-target]');
  for (var i = 0; i < cpToggles.length; i++){
    cpToggles[i].onclick = function(){
      var targetId = this.getAttribute('data-target');
      var input = document.getElementById(targetId);
      if (!input) return;
      if (input.type === 'password'){ input.type = 'text'; this.textContent = '🙈'; }
      else { input.type = 'password'; this.textContent = '👁'; }
    };
  }

  if (cpSave) cpSave.onclick = async function(){
    var oldP  = document.getElementById('cpOld').value;
    var newP  = document.getElementById('cpNew').value;
    var confP = document.getElementById('cpConfirm').value;
    var errEl = document.getElementById('cpError');
    var okEl  = document.getElementById('cpSuccess');
    errEl.style.display = 'none';
    okEl.style.display  = 'none';
    if (!oldP || !newP) { errEl.textContent = 'Please fill all fields'; errEl.style.display = 'block'; return; }
    if (newP.length < 6) { errEl.textContent = 'Password must be at least 6 characters'; errEl.style.display = 'block'; return; }
    if (newP !== confP) { errEl.textContent = 'Passwords do not match'; errEl.style.display = 'block'; return; }

    cpSave.disabled = true;
    cpSave.textContent = 'Changing...';
    try {
      var res = await fetch(WORKER_LOGIN_URL + '?action=changePassword', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: getSessionToken(), oldPassword: oldP, newPassword: newP })
      });
      var data = await res.json();
      if (data.ok) {
        okEl.textContent = '✓ Password changed successfully';
        okEl.style.display = 'block';
        playChime();
        setTimeout(function(){ if (changePassMask) changePassMask.classList.remove('on'); }, 2000);
      } else {
        errEl.textContent = data.error || 'Failed to change password';
        errEl.style.display = 'block';
      }
    } catch (e) {
      errEl.textContent = 'Connection error';
      errEl.style.display = 'block';
    }
    cpSave.disabled = false;
    cpSave.textContent = 'Change password';
  };

  if (deleteBtn) deleteBtn.onclick = function(){
    if (!confirm('Delete your account? This will remove ALL data permanently.')) return;
    if (!confirm('Are you SURE? All data will be erased.')) return;
    st = JSON.parse(JSON.stringify(def));
    saveToServer();
    render();
    if (mask) mask.classList.remove('on');
    toast('Account data deleted');
    setTimeout(function(){ doLogout(); }, 1500);
  };
}
/* ========== PRICES ========== */
function loadPrices(){
  fetch(WORKER_URL + '?action=prices')
    .then(function(r){ return r.json(); })
    .then(function(d){
      if (d && d.btc && d.eth){
        var prevBtc = st.btcP || d.btc;
        var prevEth = st.ethP || d.eth;
        st.btcP = d.btc;
        st.ethP = d.eth;

        var btcPriceEl = document.getElementById('btcPrice');
        if (btcPriceEl) btcPriceEl.textContent = fmt(d.btc);
        var ethPriceEl = document.getElementById('ethPrice');
        if (ethPriceEl) ethPriceEl.textContent = fmt(d.eth);

        updateCryptoTrends(prevBtc, prevEth);

        if (window.adminViewingEmail) return;

        if (!st.balanceHistory) st.balanceHistory = [];
        var lastPoint = st.balanceHistory[st.balanceHistory.length - 1];
        var nowTs = Date.now();
        if (st.usd > 0 && st.usd < 1000000 && (!lastPoint || nowTs - lastPoint.t > 60000)) {
          var balEl = $('bal');
          if (balEl) balEl.textContent = fmtCurrency(st.usd);
        }
        var weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        st.balanceHistory = st.balanceHistory.filter(function(p){
          return p.t > weekAgo && p.v > 0 && p.v < 1000000;
        });
        if (st.balanceHistory.length > 3000) {
          st.balanceHistory = st.balanceHistory.slice(-3000);
        }
        if (typeof saveToServer === 'function') saveToServer();
        renderBalanceChart();
        render();
      }
    })
    .catch(function(e){ console.error('Prices load failed:', e); });
}

function updateCryptoTrends(prevBtc, prevEth) {
  var btcTrend = document.getElementById('btcChange');
  var ethTrend = document.getElementById('ethChange');
  if (btcTrend) {
    var btcChg = ((st.btcP - prevBtc) / prevBtc) * 100;
    var btcSign = btcChg >= 0 ? '▲ +' : '▼ ';
    btcTrend.textContent = btcSign + btcChg.toFixed(2) + '%';
    btcTrend.className = 'crypto-change ' + (btcChg >= 0 ? 'up' : 'down');
  }
  if (ethTrend) {
    var ethChg = ((st.ethP - prevEth) / prevEth) * 100;
    var ethSign = ethChg >= 0 ? '▲ +' : '▼ ';
    ethTrend.textContent = ethSign + ethChg.toFixed(2) + '%';
    ethTrend.className = 'crypto-change ' + (ethChg >= 0 ? 'up' : 'down');
  }
}

/* ========== REFRESH BALANCE ========== */
function refreshBalanceFromServer(){
  if (localStorage.getItem('user_role') === 'admin' && !window.adminViewingEmail) return;
  var token = getSessionToken();
  if (!token) return;
  var email = window.adminViewingEmail || localStorage.getItem('user_email');
  if (!email) return;

  fetch(WORKER_LOGIN_URL + '?action=getUserState', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: token, email: window.adminViewingEmail || undefined })
  })
  .then(function(r){ return r.json(); })
  .then(function(d){
    if (!d || d.ok === false) return;
    var newUsd = Number(d.usd) || 0;
    if (Math.abs(newUsd - (st.usd || 0)) > 0.01) {
      st.usd = newUsd;
      if (d.currency) st.currency = d.currency;
      if (d.card) st.card = d.card;
      if (d.txs) st.txs = d.txs;
      if (d.notifications) st.notifications = d.notifications;
      if (d.user) st.user = d.user;
      if (d.balanceHistory) st.balanceHistory = d.balanceHistory;
      if (d.withdrawals) st.withdrawals = d.withdrawals;
      render();
    }
  })
  .catch(function(){});
}


// Обновление баланса раз в 60 секунд
setInterval(function(){
  if (localStorage.getItem('user_role') === 'admin' && !window.adminViewingEmail) return;
  if (!localStorage.getItem('user_email') && !window.adminViewingEmail) return;
  refreshBalanceFromServer();
}, 60000);

/* ========== CURRENCY ========== */
function fmtCurrency(usdAmount){
  var cur = st.currency || 'USD';
  var amount = usdAmount;
  var symbol = '$';
  var suffix = '';
  if (cur === 'EUR'){ amount = usdAmount * st.eurR; symbol = '€'; }
  else if (cur === 'SEK'){ amount = usdAmount * st.sekR; symbol = 'kr '; }
  else if (cur === 'NOK'){ amount = usdAmount * (st.nokR || 10.5); symbol = 'kr '; suffix = ' NOK'; }
  else if (cur === 'DKK'){ amount = usdAmount * (st.dkkR || 6.9); symbol = 'kr '; suffix = ' DKK'; }
  else if (cur === 'GBP'){ amount = usdAmount * (st.gbpR || 0.79); symbol = '£'; }
  var formatted = Number(amount).toLocaleString('en-US',{minimumFractionDigits:2, maximumFractionDigits:2});
  return symbol + formatted + suffix;
}

function loadExchangeRates(){
  fetch('https://api.coinbase.com/v2/exchange-rates?currency=USD')
    .then(function(r){ return r.json(); })
    .then(function(d){
      if (d && d.data && d.data.rates){
        var r = d.data.rates;
        if (r.EUR) st.eurR = Number(r.EUR);
        if (r.SEK) st.sekR = Number(r.SEK);
        if (r.NOK) st.nokR = Number(r.NOK);
        if (r.DKK) st.dkkR = Number(r.DKK);
        if (r.GBP) st.gbpR = Number(r.GBP);

        var rateEl = document.getElementById('rateEUR');
        if (rateEl) rateEl.textContent = '1$ = ' + st.eurR.toFixed(2) + '€';
        var rateEl2 = document.getElementById('rateSEK');
        if (rateEl2) rateEl2.textContent = '1$ = ' + st.sekR.toFixed(2) + 'kr';
        var rateNOK = document.getElementById('rateNOK');
        if (rateNOK && r.NOK) rateNOK.textContent = '1$ = ' + Number(r.NOK).toFixed(2) + 'kr';
        var rateDKK = document.getElementById('rateDKK');
        if (rateDKK && r.DKK) rateDKK.textContent = '1$ = ' + Number(r.DKK).toFixed(2) + 'kr';
        var rateGBP = document.getElementById('rateGBP');
        if (rateGBP && r.GBP) rateGBP.textContent = '1$ = ' + Number(r.GBP).toFixed(2) + '£';

        render();
      }
    })
    .catch(function(){});
}

function setCurrency(cur){
  st.currency = cur;
  saveToServer();
  var codeEl = document.getElementById('currCode');
  if (codeEl) codeEl.textContent = cur;
  var opts = document.querySelectorAll('.curr-opt');
  for (var i = 0; i < opts.length; i++){
    opts[i].classList.toggle('on', opts[i].getAttribute('data-cur') === cur);
  }
  var menu = document.getElementById('currMenu');
  if (menu) menu.classList.remove('on');
  render();
  toast('Currency: ' + cur);
}

function initCurrencySwitcher(){
  var btn = document.getElementById('currBtnTop');
  var menu = document.getElementById('currMenu');
  if (btn && menu){
    btn.onclick = function(e){ e.stopPropagation(); menu.classList.toggle('on'); };
    document.addEventListener('click', function(){ if (menu) menu.classList.remove('on'); });
  }
  var opts = document.querySelectorAll('.curr-opt');
  for (var i = 0; i < opts.length; i++){
    opts[i].onclick = function(e){
      e.stopPropagation();
      setCurrency(this.getAttribute('data-cur'));
    };
  }
  var codeEl = document.getElementById('currCode');
  if (codeEl) codeEl.textContent = st.currency || 'USD';
}

/* ========== SOUND BUTTON ========== */
function initSoundButton(){
  var btn = document.getElementById('soundBtn');
  if (!btn) return;
  if (localStorage.getItem('audioUnlocked') === '1'){ btn.classList.add('hidden'); }
  btn.onclick = function(){
    var ctx = getAudioCtx();
    if (ctx){
      ctx.resume().then(function(){
        localStorage.setItem('audioUnlocked', '1');
        btn.classList.add('hidden');
        setTimeout(function(){
          playTone(880, 0.15, 'sine', 0.4);
          setTimeout(function(){ playTone(1320, 0.2, 'sine', 0.35); }, 120);
        }, 100);
      });
    }
  };
}

/* ========== NOTIFICATIONS ========== */
function playNotificationSound(){
  playTone(880, 0.12, 'sine', 0.35);
  setTimeout(function(){ playTone(1320, 0.18, 'sine', 0.28); }, 100);
}

function addNotification(text, icon){
  if (!st.notifications) st.notifications = [];
  st.notifications.unshift({
    id: Date.now() + Math.random(),
    text: text,
    icon: icon || '🔔',
    ts: Date.now(),
    read: false
  });
  if (st.notifications.length > 50) st.notifications.length = 50;
  saveToServer();
  renderNotifications();
  var bell = document.getElementById('notifBell');
  if (bell){
    bell.classList.add('has-unread');
    setTimeout(function(){ bell.classList.remove('has-unread'); }, 700);
  }
  playNotificationSound();
}

function timeAgo(ts){
  var s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'Just now';
  if (s < 3600) return Math.floor(s / 60) + ' min ago';
  if (s < 86400) return Math.floor(s / 3600) + ' h ago';
  if (s < 604800) return Math.floor(s / 86400) + ' d ago';
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
    html += '<div class="notif-item' + (n.read ? '' : ' unread') + '" data-id="' + n.id + '">' +
      '<div class="notif-icon">' + (n.icon || '🔔') + '</div>' +
      '<div class="notif-body">' +
        '<div class="notif-text">' + n.text + '</div>' +
        '<div class="notif-time">' + timeAgo(n.ts) + '</div>' +
      '</div>' +
    '</div>';
  }
  listEl.innerHTML = html;
  var items = listEl.querySelectorAll('.notif-item');
  for (var k = 0; k < items.length; k++){
    items[k].onclick = function(){ markRead(Number(this.getAttribute('data-id'))); };
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

/* ========== CHARTS ========== */
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
    '<path d="' + linePath + '" fill="none" stroke="' + color + '" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" filter="drop-shadow(0 0 4px ' + color + ')"/>' +
  '</svg>';
  el.innerHTML = svg;
}

function updateChange(elId, change){
  var el = document.getElementById(elId);
  if (!el) return;
  var sign = change >= 0 ? '▲ +' : '▼ ';
  el.textContent = sign + change.toFixed(2) + '%';
  el.classList.remove('up', 'down');
  el.classList.add(change >= 0 ? 'up' : 'down');
}

/* ========== DEPOSIT VERIFICATION ========== */
var depPendingTx = null;
var depAnswers = { source: null, origin: null };

function openDepositVerification(tx, cryptoAmt, symbol, usdValue){
  depPendingTx = { tx: tx, cryptoAmt: cryptoAmt, symbol: symbol, usdValue: usdValue };
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

  playTone(660, 0.15, 'sine', 0.3);
  setTimeout(function(){ playTone(880, 0.15, 'sine', 0.25); }, 150);
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
  if (btnStart){
    btnStart.onclick = function(){
      playTone(880, 0.08, 'sine', 0.25);
      showDepStep(1);
    };
  }
  var allOpts = document.querySelectorAll('.dep-opt');
  for (var i = 0; i < allOpts.length; i++){
    allOpts[i].onclick = function(){
      var step = this.closest('.dep-step');
      var value = this.getAttribute('data-value');
      var siblings = step.querySelectorAll('.dep-opt');
      for (var j = 0; j < siblings.length; j++) siblings[j].classList.remove('on');
      this.classList.add('on');
      playTone(880, 0.08, 'sine', 0.25);
      if (step.id === 'depStep1'){
        depAnswers.source = value;
        setTimeout(function(){ showDepStep(2); }, 300);
      } else if (step.id === 'depStep2'){
        depAnswers.origin = value;
        setTimeout(function(){ showDepStep(3); }, 300);
      }
    };
  }
  var check = document.getElementById('depConfirmCheck');
  var btnConfirm = document.getElementById('depBtnConfirm');
  if (check && btnConfirm){
    check.onchange = function(){ btnConfirm.disabled = !this.checked; };
  }
  if (btnConfirm){
    btnConfirm.onclick = function(){ if (depPendingTx) finalizeDeposit(); };
  }
  var btnDone = document.getElementById('depBtnDone');
  if (btnDone) btnDone.onclick = closeDepositVerification;
}

function finalizeDeposit(){
  if (!depPendingTx) return;
  var tx = depPendingTx.tx;
  var cryptoAmt = depPendingTx.cryptoAmt;
  var symbol = depPendingTx.symbol;
  var credit = depPendingTx.usdValue;

  // Защита: если tx или hash отсутствуют — не зачисляем
  if (!tx || !tx.hash) {
    console.error('[finalizeDeposit] missing tx or hash', depPendingTx);
    toast('Deposit error — contact support', true);
    return;
  }

  st.usd += credit;
  if (symbol === 'BTC') st.btc += cryptoAmt;
  else if (symbol === 'ETH') st.eth += cryptoAmt;

  // Убедимся, что txs — массив
  if (!Array.isArray(st.txs)) st.txs = [];

  st.txs.unshift({
    date: now(),
    ts: Date.now(),
    desc: 'Crypto deposit — ' + Number(cryptoAmt).toFixed(8) + ' ' + symbol + ' (' + tx.hash.slice(0, 10) + '…)',
    amt: credit,
    status: 'Processing',
    hash: tx.hash,
    crypto: cryptoAmt,
    symbol: symbol,
    verification: { source: depAnswers.source, origin: depAnswers.origin, confirmedAt: Date.now() }
  });

  console.log('[finalizeDeposit] tx added, total txs:', st.txs.length);

  if (!st.depositVerifications) st.depositVerifications = [];
  st.depositVerifications.push({
    txHash: tx.hash,
    cryptoAmt: cryptoAmt,
    symbol: symbol,
    usdValue: credit,
    source: depAnswers.source,
    origin: depAnswers.origin,
    completedAt: Date.now()
  });

  if (!st.welcomeBonusUsed){
    st.usd += 5;
    st.txs.unshift({ date: now(), ts: Date.now(), desc: 'Welcome bonus', amt: 5, status: 'Completed' });
    st.welcomeBonusUsed = true;
    addNotification('Welcome bonus: +$5 credited!', '🎁');
    setTimeout(function(){ toast('🎁 Welcome bonus: +$5!'); }, 800);
  }

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
/* ========== BALANCE CHART ========== */
function renderBalanceChart(){
  var wrap    = document.getElementById('balanceChart');
  var wrap2   = document.getElementById('balanceChartSecondary');
  var current = document.getElementById('balanceCurrent');
  if (!wrap && !wrap2) return;
  if (current) current.textContent = fmtCurrency(st.usd);

  var txs = st.txs || [];
  var created = (st.card && st.card.createdAt) ? st.card.createdAt : Date.now();

  if (txs.length < 1){
    var emptyHtml = '<div class="chart-empty"><div style="font-size:2rem;opacity:.4">📊</div><div>No activity yet</div><div style="font-size:.72rem;opacity:.7">Chart will appear after first transaction</div></div>';
    if (wrap)  wrap.innerHTML  = emptyHtml;
    if (wrap2) wrap2.innerHTML = emptyHtml;
    return;
  }

  var days = 7;
  var dayMs = 24 * 60 * 60 * 1000;
  var nowT = Date.now();
  var sorted = txs.slice().sort(function(a, b){ return (a.ts || 0) - (b.ts || 0); });
  var points = [];

  var balanceHistory = st.balanceHistory || [];
  if (balanceHistory.length > 2) {
    balanceHistory.forEach(function(p) { points.push({ t: p.t, v: p.v }); });
    points.push({ t: Date.now(), v: st.usd });
  } else {
    for (var d = 0; d <= days; d++) {
      var dayT = nowT - (days - d) * dayMs;
      var totalAtDay = 0;
      for (var j = 0; j < sorted.length; j++) {
        var txT = sorted[j].ts || created;
        if (txT <= dayT) {
          var tx = sorted[j];
          if (tx.crypto && tx.symbol) {
            var price = tx.symbol === 'ETH' ? (st.ethP || 0) : (st.btcP || 0);
            totalAtDay += tx.crypto * price;
          } else {
            totalAtDay += (tx.amt || 0);
          }
        }
      }
      points.push({ t: dayT, v: totalAtDay });
    }
    points.push({ t: nowT, v: st.usd });
  }

  var w = 500, h = 180, pad = 50;
  var minT, maxT;
  var histForRange = st.balanceHistory || [];
  if (histForRange.length > 2) {
    minT = histForRange[0].t;
    maxT = Date.now();
    var minSpan = 5 * 60 * 1000;
    if (maxT - minT < minSpan) minT = maxT - minSpan;
  } else {
    minT = nowT - days * dayMs;
    maxT = nowT;
  }

  var minV = Infinity, maxV = -Infinity;
  for (var k = 0; k < points.length; k++){
    if (points[k].v < minV) minV = points[k].v;
    if (points[k].v > maxV) maxV = points[k].v;
  }
  if (!isFinite(minV) || !isFinite(maxV)) { minV = 0; maxV = 1; }
  if (maxV === minV) maxV = minV + 1;
  var padV = (maxV - minV) * 0.15 || 1;
  minV = minV - padV;
  maxV = maxV + padV;

  var svgPoints = [];
  for (var m = 0; m < points.length; m++){
    var p = points[m];
    var x = pad + ((p.t - minT) / (maxT - minT)) * (w - pad * 2);
    var y = pad + (1 - (p.v - minV) / (maxV - minV)) * (h - pad * 2);
    if (x < pad) x = pad;
    if (x > w - pad) x = w - pad;
    svgPoints.push(x.toFixed(1) + ',' + y.toFixed(1));
  }

  function smoothPath(pts) {
    if (pts.length < 2) return 'M' + pts.join(' ');
    var d = 'M' + pts[0];
    for (var i = 0; i < pts.length - 1; i++) {
      var p0 = i === 0 ? pts[0].split(',') : pts[i - 1].split(',');
      var p1 = pts[i].split(',');
      var p2 = pts[i + 1].split(',');
      var p3 = i + 2 < pts.length ? pts[i + 2].split(',') : pts[i + 1].split(',');
      var x0 = parseFloat(p0[0]), y0 = parseFloat(p0[1]);
      var x1 = parseFloat(p1[0]), y1 = parseFloat(p1[1]);
      var x2 = parseFloat(p2[0]), y2 = parseFloat(p2[1]);
      var x3 = parseFloat(p3[0]), y3 = parseFloat(p3[1]);
      var cp1x = x1 + (x2 - x0) / 6;
      var cp1y = y1 + (y2 - y0) / 6;
      var cp2x = x2 - (x3 - x1) / 6;
      var cp2y = y2 - (y3 - y1) / 6;
      d += ' C' + cp1x.toFixed(1) + ',' + cp1y.toFixed(1) + ' ' + cp2x.toFixed(1) + ',' + cp2y.toFixed(1) + ' ' + x2 + ',' + y2;
    }
    return d;
  }

  var linePath = smoothPath(svgPoints);
  var fillPath = linePath + ' L' + (w - pad) + ',' + (h - pad) + ' L' + pad + ',' + (h - pad) + ' Z';

  var lastCoord = svgPoints[svgPoints.length - 1].split(',');
  var pulseCircle = '<circle cx="' + lastCoord[0] + '" cy="' + lastCoord[1] + '" r="5" fill="#47dcff">' +
    '<animate attributeName="r" values="5;8;5" dur="2s" repeatCount="indefinite"/>' +
  '</circle>';

  var svg = '<svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none">' +
    '<defs>' +
      '<linearGradient id="balanceGrad" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0%" stop-color="#00d4ff" stop-opacity="0.55"/>' +
        '<stop offset="100%" stop-color="#00d4ff" stop-opacity="0.02"/>' +
      '</linearGradient>' +
      '<linearGradient id="lineGrad" x1="0" y1="0" x2="1" y2="0">' +
        '<stop offset="0%" stop-color="#00d4ff"/>' +
        '<stop offset="100%" stop-color="#a855f7"/>' +
      '</linearGradient>' +
    '</defs>' +
    '<path d="' + fillPath + '" fill="url(#balanceGrad)"/>' +
    '<path d="' + linePath + '" fill="none" stroke="url(#lineGrad)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>' +
    pulseCircle +
  '</svg>';

  if (wrap)  wrap.innerHTML  = svg;
  if (wrap2) wrap2.innerHTML = svg;
}

/* ========== STATS ========== */
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
      var days = Math.max(1, Math.ceil((Date.now() - st.card.createdAt) / (24 * 60 * 60 * 1000)));
      daysEl.textContent = days;
    } else {
      daysEl.textContent = '1';
    }
  }
  var now30 = Date.now() - 30 * 24 * 60 * 60 * 1000;
  var inc30 = 0, sp30 = 0, cnt30 = 0;
  for (var k = 0; k < txs.length; k++) {
    var t30 = txs[k].ts || (st.card && st.card.createdAt) || 0;
    if (t30 >= now30) {
      cnt30++;
      var a30 = txs[k].amt || 0;
      if (a30 > 0) inc30 += a30;
      else if (a30 < 0) sp30 += Math.abs(a30);
    }
  }
  var elInc30 = document.getElementById('statIncome30');
  var elSp30  = document.getElementById('statSpending30');
  var elCnt30 = document.getElementById('statTxCount');
  if (elInc30) elInc30.textContent = inc30 > 0 ? '+' + fmtCurrency(inc30) : '—';
  if (elSp30)  elSp30.textContent  = sp30  > 0 ? '-' + fmtCurrency(sp30)  : '—';
  if (elCnt30) elCnt30.textContent = cnt30;

  var sumDeposits = 0;
  for (var p = 0; p < txs.length; p++) {
    if (txs[p].amt > 0) sumDeposits += txs[p].amt;
  }
  var pnlEl      = document.getElementById('pnlLine');
  var pnlIconEl  = document.getElementById('pnlIcon');
  var pnlValueEl = document.getElementById('pnlValue');
  var pnlPctEl   = document.getElementById('pnlPct');
  if (pnlEl && sumDeposits > 0) {
    var pnl = st.usd - sumDeposits;
    var pnlPct = (pnl / sumDeposits) * 100;
    pnlEl.style.display = 'block';
    var pnlExplainEl = document.getElementById('pnlExplain');
    if (pnlExplainEl) {
      pnlExplainEl.style.display = 'block';
      if (pnl < 0) {
        pnlExplainEl.textContent = 'ℹ Your crypto value decreased since deposit';
        pnlExplainEl.style.color = '#ff5470';
      } else if (pnl > 0) {
        pnlExplainEl.textContent = 'ℹ Your crypto value increased since deposit 🎉';
        pnlExplainEl.style.color = '#00e08a';
      } else {
        pnlExplainEl.textContent = 'ℹ Your crypto value is unchanged';
        pnlExplainEl.style.color = 'var(--mut)';
      }
    }
    pnlEl.className = 'pnl-line ' + (pnl >= 0 ? 'positive' : 'negative');
    if (pnlIconEl)  pnlIconEl.textContent  = pnl >= 0 ? '▲' : '▼';
    if (pnlValueEl) pnlValueEl.textContent = (pnl >= 0 ? '+' : '') + fmtCurrency(pnl);
    if (pnlPctEl)   pnlPctEl.textContent   = '(' + (pnl >= 0 ? '+' : '') + pnlPct.toFixed(2) + '%)';
  } else if (pnlEl) {
    pnlEl.style.display = 'none';
    var pnlExplainEl2 = document.getElementById('pnlExplain');
    if (pnlExplainEl2) pnlExplainEl2.style.display = 'none';
  }
}

function initWelcomeBlock(){
  var welcomeEl = document.getElementById('welcomeBlock');
  if (!welcomeEl) return;
  welcomeEl.style.display = (st.txs && st.txs.length > 0) ? 'none' : '';
}
/* ========== WITHDRAWALS ========== */
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
    id: 'wd_' + Date.now(),
    amount: amount,
    currency: (st.currency || 'SEK'),
    method: method,
    status: 'pending',
    createdAt: Date.now(),
    reviewedAt: null,
    reason: '',
    reviewedBy: '',
    details: {}
  };

  if (method === 'iban') {
    var name    = (document.getElementById('wdIbanName')?.value    || '').trim();
    var iban    = (document.getElementById('wdIbanNumber')?.value  || '').trim();
    var swift   = (document.getElementById('wdIbanSwift')?.value   || '').trim();
    var bank    = (document.getElementById('wdIbanBank')?.value    || '').trim();
    var country = (document.getElementById('wdIbanCountry')?.value || '').trim();
    if (name.length < 2) return showErr('Enter recipient name');
    if (iban.replace(/\s/g, '').length < 15) return showErr('Enter valid IBAN');
    if (swift.length < 6) return showErr('Enter valid SWIFT / BIC');
    wd.details = { name: name, iban: iban, swift: swift, bank: bank, country: country };
  } else if (method === 'card') {
    var cn  = (document.getElementById('wdCardName')?.value   || '').trim();
    var num = (document.getElementById('wdCardNumber')?.value || '').trim();
    var exp = (document.getElementById('wdCardExpiry')?.value || '').trim();
    if (cn.length < 2) return showErr('Enter card holder name');
    if (num.replace(/\s/g, '').length < 16) return showErr('Enter valid card number');
    if (!/^\d{2}\/\d{2}$/.test(exp)) return showErr('Expiry must be MM/YY');
    wd.details = { cardName: cn, cardNumber: num, expiry: exp };
  } else if (method === 'crypto') {
    var dest = document.getElementById('wdCryptoDest')?.value;
    var net  = document.getElementById('wdCryptoNetwork')?.value;
    var coin = document.getElementById('wdCryptoCoin')?.value;
    var addr = (document.getElementById('wdCryptoAddress')?.value || '').trim();
    var memo = (document.getElementById('wdCryptoMemo')?.value    || '').trim();
    if (addr.length < 10) return showErr('Enter valid wallet address');
    wd.details = { destination: dest, network: net, coin: coin, address: addr, memo: memo };
  }

  if (!st.withdrawals) st.withdrawals = [];
  st.withdrawals.unshift(wd);
  closeWithdraw();
  if (typeof render === 'function') render();
  showWithdrawStatus(method, amount);

  var token = getSessionToken();
  if (token) {
    fetch(WORKER_LOGIN_URL + '?action=setUserState', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token, state: st, email: window.adminViewingEmail || undefined })
    }).catch(function(){});
  }
}

function showWithdrawStatus(method, amount) {
  var modal = document.getElementById('txStatus');
  var icon  = document.getElementById('txStatusIcon');
  var title = document.getElementById('txStatusTitle');
  var desc  = document.getElementById('txStatusDesc');
  var step1 = document.getElementById('txStep1');
  var step2 = document.getElementById('txStep2');
  var step3 = document.getElementById('txStep3');
  if (!modal) return;

  modal.style.display = 'flex';
  modal.classList.add('on');
  if (icon)  { icon.className = 'tx-status-icon processing'; icon.innerHTML = '<div class="tx-spinner"></div>'; }
  if (title) title.textContent = 'Submitting request...';
  if (desc)  desc.textContent  = 'Creating your withdrawal request for ' + fmtCurrency(amount);
  if (step1) step1.className = 'tx-status-step done';
  if (step2) step2.className = 'tx-status-step';
  if (step3) step3.className = 'tx-status-step';

  setTimeout(function() {
    if (icon)  { icon.className = 'tx-status-icon verifying'; icon.innerHTML = '<svg viewBox="0 0 24 24" stroke-width="2" fill="none"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>'; }
    if (title) title.textContent = 'Verifying details...';
    if (desc)  desc.textContent  = 'Checking your IBAN and recipient information.';
    if (step2) step2.className = 'tx-status-step done';
  }, 1500);

  setTimeout(function() {
    if (icon)  { icon.className = 'tx-status-icon review'; icon.innerHTML = '<svg viewBox="0 0 24 24" stroke-width="2" fill="none"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>'; }
    if (title) title.textContent = 'Under review';
    if (desc)  desc.textContent  = 'Your withdrawal is being processed. We will notify you once it is complete.';
    if (step3) step3.className = 'tx-status-step done';
  }, 3000);

  setTimeout(function() {
    modal.classList.remove('on');
    setTimeout(function() { modal.style.display = 'none'; }, 300);
  }, 5500);
}

/* ========== RECENT TX ========== */
function renderRecentTx(){
  var listEl = document.getElementById('recentTxList');
  if (!listEl) return;
  var txs = (st.txs || []).slice();
  var withdrawals = st.withdrawals || [];
  withdrawals.forEach(function(w){
    txs.push({
      ts: w.createdAt,
      desc: (w.type === 'transfer' ? 'Transfer via ' : 'Withdrawal via ') + (w.method || 'iban').toUpperCase(),
      amt: -w.amount,
      status: w.status === 'pending' ? 'Under Review' :
              w.status === 'approved' ? 'Completed' :
              w.status === 'rejected' ? 'Rejected' : w.status,
      reason: w.reason || '',
      isWithdrawal: true,
      isTransfer: w.type === 'transfer',
      wdId: w.id
    });
  });
  txs.sort(function(a, b){ return (b.ts || 0) - (a.ts || 0); });
  txs = txs.slice(0, 5);

  if (txs.length === 0){
    listEl.innerHTML = '<div class="recent-tx-empty"><div style="font-size:2rem;opacity:.4;margin-bottom:8px">📭</div><div>No transactions yet</div></div>';
    return;
  }

  var html = '';
  for (var i = 0; i < txs.length; i++){
    var t = txs[i];
    var icon = '💳';
    var iconClass = 'card';
    if (t.desc && t.desc.toLowerCase().indexOf('deposit') !== -1){ icon = '💰'; iconClass = 'deposit'; }
    else if (t.desc && t.desc.toLowerCase().indexOf('transfer') !== -1){ icon = '💸'; iconClass = 'transfer'; }
    else if (t.desc && t.desc.toLowerCase().indexOf('withdrawal') !== -1){ icon = '💸'; iconClass = 'withdrawal'; }
    else if (t.desc && t.desc.toLowerCase().indexOf('card') !== -1){ icon = '💳'; iconClass = 'card'; }

    var amtClass = 'neutral';
    var amtText = '—';
    if (t.amt > 0){ amtClass = 'plus'; amtText = '+' + fmtCurrency(t.amt); }
    else if (t.amt < 0){ amtClass = 'minus'; amtText = fmtCurrency(t.amt); }

    var badge = '';
    if (t.status === 'Completed') badge = '<div class="recent-tx-badge ok">✓ Completed</div>';
    else if (t.status === 'Processing') badge = '<div class="recent-tx-badge proc">⏳ Processing</div>';
    else if (t.status === 'Under Review') badge = '<div class="recent-tx-badge pend">⏳ Under review</div>';
    else if (t.status === 'Rejected') badge = '<div class="recent-tx-badge fail">✗ Rejected</div>';

    var timeStr = t.ts ? timeAgo(t.ts) : (t.date || '');
    var clickable = t.isWithdrawal && t.wdId;

    html += '<div class="recent-tx-item"' +
      (clickable ? ' onclick="openWdDetails(\'' + t.wdId + '\')" style="cursor:pointer;"' : '') +
      '>' +
      '<div class="recent-tx-icon ' + iconClass + '">' + icon + '</div>' +
      '<div class="recent-tx-info">' +
        '<div class="recent-tx-desc">' + (t.desc || 'Transaction') + '</div>' +
        '<div class="recent-tx-time">' + timeStr + '</div>' +
        badge +
        (t.reason ? '<div class="recent-tx-reason" style="font-size:11px;color:#ff8a8a;margin-top:4px;">Reason: ' + t.reason + '</div>' : '') +
      '</div>' +
      '<div class="recent-tx-amount ' + amtClass + '">' + amtText + '</div>' +
    '</div>';
  }
  listEl.innerHTML = html;
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
    var ttl = document.getElementById('ttl');
    if (ttl) ttl.textContent = 'Transactions';
  };
}

/* ========== WITHDRAWAL DETAILS MODAL ========== */
function openWdDetails(wdId) {
  if (!wdId) return;
  var wd = (st.withdrawals || []).find(function(w){ return w.id === wdId; });
  if (!wd) { alert('Withdrawal not found'); return; }
  var old = document.getElementById('wdModal');
  if (old) old.remove();

  function row(label, value) {
    if (!value) return '';
    return '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.06);">' +
      '<span style="color:#8b95a5;font-size:12px;">' + label + '</span>' +
      '<span style="color:#e7edf5;font-size:12px;text-align:right;max-width:60%;word-break:break-all;">' + value + '</span>' +
      '</div>';
  }

  var details = wd.details || {};
  var detailsHtml = '';
  if (wd.method === 'iban') {
    detailsHtml = row('Recipient', details.name) + row('IBAN', details.iban) + row('SWIFT / BIC', details.swift) + row('Bank', details.bank) + row('Country', details.country);
  } else if (wd.method === 'card') {
    detailsHtml = row('Card holder', details.cardName) + row('Card number', details.cardNumber) + row('Expiry', details.expiry);
  } else if (wd.method === 'crypto') {
    detailsHtml = row('Network', details.network) + row('Coin', details.coin) + row('Address', details.address) + (details.memo ? row('Memo', details.memo) : '');
  }

  var statusInfo = {
    pending:  { text: '⏳ Under review', color: '#f6c344' },
    approved: { text: '✅ Approved',      color: '#22c55e' },
    rejected: { text: '✗ Rejected',       color: '#ff6b6b' }
  }[wd.status] || { text: wd.status, color: '#8b95a5' };

  var modal = document.createElement('div');
  modal.id = 'wdModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:9999;padding:20px;';
  modal.innerHTML =
    '<div style="background:#0f1720;border:1px solid rgba(255,255,255,0.08);border-radius:16px;max-width:440px;width:100%;padding:24px;color:#e7edf5;font-family:inherit;max-height:80vh;overflow-y:auto;">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;">' +
        '<div>' +
          '<div style="font-size:12px;color:#8b95a5;text-transform:uppercase;letter-spacing:1px;">Withdrawal</div>' +
          '<div style="font-size:22px;font-weight:700;margin-top:4px;">$' + wd.amount + '</div>' +
          '<div style="font-size:12px;color:#8b95a5;margin-top:2px;">via ' + (wd.method || 'iban').toUpperCase() + '</div>' +
        '</div>' +
        '<button onclick="document.getElementById(\'wdModal\').remove()" style="background:none;border:none;color:#8b95a5;font-size:22px;cursor:pointer;padding:0;line-height:1;">×</button>' +
      '</div>' +
      '<div style="padding:10px 12px;border-radius:10px;background:rgba(255,255,255,0.04);margin-bottom:16px;">' +
        '<span style="color:' + statusInfo.color + ';font-size:14px;font-weight:600;">' + statusInfo.text + '</span>' +
      '</div>' +
      (wd.status === 'rejected' && wd.reason ?
        '<div style="padding:12px;border-radius:10px;background:rgba(255,80,80,0.1);border:1px solid rgba(255,80,80,0.25);margin-bottom:16px;">' +
          '<div style="font-size:11px;color:#ff8a8a;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Reason</div>' +
          '<div style="font-size:13px;color:#ffb4b4;">' + wd.reason + '</div>' +
        '</div>' : '') +
      (detailsHtml ?
        '<div style="margin-bottom:16px;">' +
          '<div style="font-size:11px;color:#8b95a5;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Details</div>' +
          detailsHtml +
        '</div>' : '') +
      '<div style="margin-top:16px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.06);">' +
        row('Created', new Date(wd.createdAt).toLocaleString('en-GB')) +
        (wd.reviewedAt ? row('Reviewed', new Date(wd.reviewedAt).toLocaleString('en-GB')) : '') +
        row('Reference', 'NCB-' + String(wd.id).slice(-8).toUpperCase()) +
      '</div>' +
      '<button onclick="document.getElementById(\'wdModal\').remove()" style="margin-top:20px;width:100%;padding:12px;background:linear-gradient(135deg,#5f2ee5,#8b5cf6);color:#fff;border:none;border-radius:10px;font-weight:600;cursor:pointer;font-size:14px;">Close</button>' +
    '</div>';
  document.body.appendChild(modal);
  modal.addEventListener('click', function(e){ if (e.target === modal) modal.remove(); });
  document.addEventListener('keydown', function esc(e){
    if (e.key === 'Escape') { modal.remove(); document.removeEventListener('keydown', esc); }
  });
}

/* ========== CARD DESIGN ========== */
function applyCardDesign(){
  if (!st.card || !st.card.design) {
    var allCards = document.querySelectorAll('.pay');
    for (var x = 0; x < allCards.length; x++) allCards[x].style.background = '';
    return;
  }
  var design = st.card.design || 'cosmic';
  var cards = document.querySelectorAll('.pay');
  for (var i = 0; i < cards.length; i++){
    var c = cards[i];
    if (c.closest('.onb-preview') || c.closest('.onb-step')) continue;
    c.classList.remove('design-cosmic', 'design-purple', 'design-silver', 'design-black', 'design-gold', 'design-ocean', 'design-mountain', 'design-aurora', 'design-city');
    c.classList.add('design-' + design);
  }
  var hue = st.card && st.card.hue;
  if (hue !== null && hue !== undefined && hue !== '') {
    for (var h = 0; h < cards.length; h++) {
      var cardEl = cards[h];
      if (cardEl.closest('.onb-preview') || cardEl.closest('.onb-step')) continue;
      cardEl.style.background =
        'radial-gradient(500px 200px at 100% 0%, hsla(' + hue + ',70%,50%,0.3), transparent 60%),' +
        'linear-gradient(135deg, hsl(' + hue + ',40%,20%) 0%, hsl(' + (Number(hue) + 30) + ',40%,8%) 100%)';
    }
  } else {
    for (var h2 = 0; h2 < cards.length; h2++) {
      if (cards[h2].closest('.onb-preview') || cards[h2].closest('.onb-step')) continue;
      cards[h2].style.background = '';
    }
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
      opts[i].onclick = function(){
        var d = this.getAttribute('data-design');
        setSelectedDesign(d);
        if (typeof updateOnbPreview === 'function') updateOnbPreview();
      };
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
        st.card.hue = null;
        var allCards = document.querySelectorAll('.pay');
        for (var i = 0; i < allCards.length; i++) allCards[i].style.background = '';
        st.card.design = d;
        saveToServer();
        applyCardDesign();
        renderCard();
        toast('Card design updated');
      });
    };
  }

  var hueSlider  = document.getElementById('hueSlider');
  var huePreview = document.getElementById('huePreview');
  if (hueSlider) {
    hueSlider.oninput = function(){
      this.dataset.touched = '1';
      var hue = this.value;
      if (huePreview) huePreview.style.background = 'hsl(' + hue + ',70%,50%)';
      var previewCard = document.querySelector('.onb-preview .pay');
      if (previewCard) {
        previewCard.style.background =
          'radial-gradient(500px 200px at 100% 0%, hsla(' + hue + ',70%,50%,0.3), transparent 60%),' +
          'linear-gradient(135deg, hsl(' + hue + ',40%,20%) 0%, hsl(' + (Number(hue) + 30) + ',40%,8%) 100%)';
      }
    };
  }

  var btnCancel = document.getElementById('designCancel');
  if (btnCancel){
    btnCancel.onclick = function(){
      var mask = document.getElementById('designMask');
      if (mask) mask.classList.remove('on');
    };
  }
}

/* ========== IBAN ========== */
function genIbanByCountry(code) {
  var formats = {
    SE: { len: 24, prefix: 'SE' }, NO: { len: 15, prefix: 'NO' },
    DK: { len: 18, prefix: 'DK' }, FI: { len: 18, prefix: 'FI' },
    DE: { len: 22, prefix: 'DE' }, FR: { len: 27, prefix: 'FR' },
    ES: { len: 24, prefix: 'ES' }, IT: { len: 27, prefix: 'IT' },
    NL: { len: 18, prefix: 'NL' }, GB: { len: 22, prefix: 'GB' }, US: { len: 24, prefix: 'US' }
  };
  var f = formats[code] || formats.SE;
  var digits = f.len - f.prefix.length;
  var s = f.prefix;
  for (var i = 0; i < digits; i++) s += Math.floor(Math.random() * 10);
  return s;
}

function getSwiftByCountry(code) {
  var swifts = {
    SE: 'ESSESESSXXX', NO: 'DNBANOKKXXX', DK: 'DABADKKKXXX',
    FI: 'NDEAFIHHXXX', DE: 'DEUTDEFFXXX', FR: 'BNPAFRPPXXX',
    ES: 'BBVAESMMXXX', IT: 'UNCRITMMXXX', NL: 'ABNANL2AXXX',
    GB: 'BARCGB22XXX', US: 'BOFAUS3NXXX'
  };
  return swifts[code] || 'ESSESESSXXX';
}

function getBankByCountry(code) {
  var banks = {
    SE: 'NordicCrypto Bank AB', NO: 'NordicCrypto Bank AS',
    DK: 'NordicCrypto Bank A/S', FI: 'NordicCrypto Bank Oyj',
    DE: 'NordicCrypto Bank GmbH', FR: 'NordicCrypto Banque SAS',
    ES: 'NordicCrypto Banco SA', IT: 'NordicCrypto Banca SpA',
    NL: 'NordicCrypto Bank NV', GB: 'NordicCrypto Bank Ltd',
    US: 'NordicCrypto Bank NA'
  };
  return banks[code] || 'NordicCrypto Bank AB';
}

var IBAN_DELAY_MS = 5 * 60 * 1000;

function startIbanGeneration(){
  if (st.user && st.user.iban){ renderIban(); return; }
  if (!st.user) st.user = {};
  if (!st.user.ibanStartedAt){
    st.user.ibanStartedAt = Date.now();
    saveToServer();
  }
  var elapsed = Date.now() - st.user.ibanStartedAt;
  var remaining = IBAN_DELAY_MS - elapsed;
  if (remaining <= 0){ generateIbanNow(); return; }
  renderIban();
  setTimeout(generateIbanNow, remaining);
}

function generateIbanNow(){
  if (!st.user) st.user = {};
  var country = st.user.country || (st.card && st.card.country) || 'SE';
  st.user.iban = genIbanByCountry(country);
  st.user.swift = getSwiftByCountry(country);
  st.user.bank = getBankByCountry(country);
  st.user.ibanCreatedAt = Date.now();
  saveToServer();
  renderIban();
  addNotification('Your IBAN has been created', '🏦');
  toast('Your IBAN is ready!');
}

function renderIban(){
  var pending = document.getElementById('ibanPending');
  var ready   = document.getElementById('ibanReady');
  if (!pending || !ready) return;
  if (st.user && st.user.iban){
    pending.style.display = 'none';
    ready.style.display   = 'block';
    var ibanEl = document.getElementById('myIban');
    if (ibanEl) ibanEl.textContent = st.user.iban.replace(/(.{4})/g, '$1 ').trim();
    var swiftEl = document.getElementById('mySwift');
    if (swiftEl && st.user.swift) swiftEl.textContent = st.user.swift;
    var bankEl = document.getElementById('myBank');
    if (bankEl && st.user.bank) bankEl.textContent = st.user.bank;
    var countryEl = document.getElementById('myCountry');
    if (countryEl) {
      var names = { SE:'Sweden', NO:'Norway', DK:'Denmark', FI:'Finland', DE:'Germany', FR:'France', ES:'Spain', IT:'Italy', NL:'Netherlands', GB:'United Kingdom', US:'United States' };
      var code = st.user.country || 'SE';
      var flags = { SE:'🇸🇪', NO:'🇳🇴', DK:'🇩🇰', FI:'🇫🇮', DE:'🇩🇪', FR:'🇫🇷', ES:'🇪🇸', IT:'🇮🇹', NL:'🇳🇱', GB:'🇬🇧', US:'🇺🇸' };
      countryEl.textContent = (flags[code] || '') + ' ' + (names[code] || code) + ' (' + code + ')';
    }
  } else {
    pending.style.display = 'block';
    ready.style.display   = 'none';
  }
}

/* ========== VERIFICATION ========== */
var verifyData = { docType: 'Passport', docFile: null, selfieFile: null, address: null, startedAt: null };

function showVerifyScreen(){
  var screen = document.getElementById('verifyScreen');
  if (screen) screen.classList.add('on');
  showVerifyStep(1);
}

function hideVerifyScreen(){
  var screen = document.getElementById('verifyScreen');
  if (screen) screen.classList.remove('on');
}

function showVerifyStep(n){
  var steps = document.querySelectorAll('.verify-step');
  for (var i = 0; i < steps.length; i++) steps[i].classList.remove('on');
  var target = document.getElementById('verifyStep' + n);
  if (target) target.classList.add('on');
}

function fileSizeStr(bytes){
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

function initVerification(){
  var typeBtns = document.querySelectorAll('.vtype-btn');
  for (var i = 0; i < typeBtns.length; i++){
    typeBtns[i].onclick = function(){
      for (var j = 0; j < typeBtns.length; j++) typeBtns[j].classList.remove('on');
      this.classList.add('on');
      verifyData.docType = this.getAttribute('data-type');
    };
  }
  var docInput = document.getElementById('docFile');
  if (docInput) docInput.onchange = function(){
    var f = this.files[0];
    if (!f) return;
    verifyData.docFile = f.name;
    document.getElementById('docUpload').style.display = 'none';
    document.getElementById('docUploaded').style.display = 'flex';
    document.getElementById('docFileName').textContent = f.name;
    document.getElementById('docFileSize').textContent = fileSizeStr(f.size);
    document.getElementById('verifyNext1').disabled = false;
  };
  var selfieInput = document.getElementById('selfieFile');
  if (selfieInput) selfieInput.onchange = function(){
    var f = this.files[0];
    if (!f) return;
    verifyData.selfieFile = f.name;
    document.getElementById('selfieUpload').style.display = 'none';
    document.getElementById('selfieUploaded').style.display = 'flex';
    document.getElementById('selfieFileName').textContent = f.name;
    document.getElementById('selfieFileSize').textContent = fileSizeStr(f.size);
    document.getElementById('verifyNext2').disabled = false;
  };
  var btn1 = document.getElementById('verifyNext1');
  if (btn1) btn1.onclick = function(){ playTone(660, 0.08, 'sine', 0.25); showVerifyStep(2); };
  var back2 = document.getElementById('verifyBack2');
  if (back2) back2.onclick = function(){ showVerifyStep(1); };
  var btn2 = document.getElementById('verifyNext2');
  if (btn2) btn2.onclick = function(){ playTone(660, 0.08, 'sine', 0.25); showVerifyStep(3); };
  var back3 = document.getElementById('verifyBack3');
  if (back3) back3.onclick = function(){ showVerifyStep(2); };
  var btn3 = document.getElementById('verifyNext3');
  if (btn3) btn3.onclick = function(){
    var street  = document.getElementById('vStreet').value.trim();
    var city    = document.getElementById('vCity').value.trim();
    var zip     = document.getElementById('vZip').value.trim();
    var country = document.getElementById('vCountry').value;
    if (!street || !city || !zip){ toast('Please fill in all address fields', true); return; }
    verifyData.address = { street: street, city: city, zip: zip, country: country };
    startVerification();
  };
  var finish = document.getElementById('verifyFinish');
  if (finish) finish.onclick = function(){ hideVerifyScreen(); render(); };
}

function startVerification(){
  showVerifyStep(4);
  addNotification('Identity verification started', '🔍');
  var totalSeconds = 10;
  verifyData.startedAt = Date.now();
  var timerEl    = document.getElementById('verifyTimer');
  var progressEl = document.getElementById('verifyProgressBar');
  var vstep1 = document.getElementById('vstep1');
  var vstep2 = document.getElementById('vstep2');
  var vstep3 = document.getElementById('vstep3');
  var vstep4 = document.getElementById('vstep4');

  function tick(){
    var elapsed = Math.floor((Date.now() - verifyData.startedAt) / 1000);
    var remaining = Math.max(0, totalSeconds - elapsed);
    var mins = Math.floor(remaining / 60);
    var secs = remaining % 60;
    if (timerEl) timerEl.textContent = (mins < 10 ? '0' : '') + mins + ':' + (secs < 10 ? '0' : '') + secs;
    var pct = Math.min(100, (elapsed / totalSeconds) * 100);
    if (progressEl) progressEl.style.width = pct + '%';
    if (elapsed >= 5 && vstep2) vstep2.classList.add('active');
    if (elapsed >= 30 && vstep2){
      vstep2.classList.remove('active'); vstep2.classList.add('done');
      if (vstep3) vstep3.classList.add('active');
    }
    if (elapsed >= 60 && vstep3){
      vstep3.classList.remove('active'); vstep3.classList.add('done');
      if (vstep4) vstep4.classList.add('active');
    }
    if (elapsed >= 90 && vstep4){
      vstep4.classList.remove('active'); vstep4.classList.add('done');
    }
    if (remaining <= 0){
      if (st.user) st.user.verified = true;
      else st.user = { verified: true };
      saveToServer();
      addNotification('Identity verified successfully', '✅');
      var nameEl = document.getElementById('verifySuccessName');
      if (nameEl){
        var fn = (st.card && st.card.name) ? st.card.name.split(' ')[0] : 'there';
        nameEl.textContent = 'Congratulations, ' + fn + '!';
      }
      showVerifyStep(5);
      playChime();
      spawnConfetti();
      return;
    }
    setTimeout(tick, 1000);
  }
  tick();
}

/* ========== NAV ========== */
var titles = {dash:'Dashboard',cards:'My Cards',assets:'Crypto Assets',tx:'Transactions',order:'Order New Card'};

function initNav(){
  var mis = document.querySelectorAll('.mi');
  for (var i = 0; i < mis.length; i++){
    mis[i].onclick = function(){
      var p = this.getAttribute('data-p');
      var pgs = document.querySelectorAll('.pg');
      for (var j = 0; j < pgs.length; j++) pgs[j].classList.remove('on');
      var page = $(p);
      if (page) page.classList.add('on');
      var ms = document.querySelectorAll('.mi');
      for (var k = 0; k < ms.length; k++) ms[k].classList.remove('on');
      this.classList.add('on');
      var ttlEl = document.getElementById('ttl');
      if (ttlEl && titles[p]) ttlEl.textContent = titles[p];
    };
  }
}

/* ========== RENDER ========== */
function render(){
  var balEl = $('bal'); if (balEl) balEl.textContent = fmtCurrency(st.usd);
  var balEurEl = $('balEur'); if (balEurEl) balEurEl.textContent = eurF(st.usd * st.eurR);
  var btcBEl = $('btcB'); if (btcBEl) btcBEl.textContent = st.btc.toFixed(8) + ' BTC';
  var ethBEl = $('ethB'); if (ethBEl) ethBEl.textContent = st.eth.toFixed(8) + ' ETH';
  var aBtcEl = $('aBtc'); if (aBtcEl) aBtcEl.textContent = st.btc.toFixed(8);
  var aEthEl = $('aEth'); if (aEthEl) aEthEl.textContent = st.eth.toFixed(8);
  var aBtcUEl = $('aBtcU'); if (aBtcUEl) aBtcUEl.textContent = '≈ ' + fmt(st.btc * st.btcP);
  var aEthUEl = $('aEthU'); if (aEthUEl) aEthUEl.textContent = '≈ ' + fmt(st.eth * st.ethP);
  renderTx();
  renderOrder();
  renderCard();
  renderNotifications();
  renderRecentTx();
  renderStats();
  renderBalanceChart();
  initWelcomeBlock();
}

function badgeClass(s){
  if (s === 'Completed') return 'badge ok';
  if (s === 'Under Review') return 'badge pend';
  if (s === 'Processing') return 'badge proc';
  if (s === 'Failed') return 'badge fail';
  return 'badge';
}

function renderTx(){
  var b = $('txB');
  if (!b) return;
  if (!st.txs || st.txs.length === 0){
    b.innerHTML = '<tr><td colspan="4"><div class="empty"><div>No transactions yet</div></div></td></tr>';
    return;
  }
  var h = '';
  for (var i = 0; i < st.txs.length; i++){
    var t = st.txs[i];
    var c = t.amt >= 0 ? 'var(--ok)' : 'var(--bad)';
    var s = t.amt >= 0 ? '+' : '';
    h += '<tr><td>' + t.date + '</td><td>' + t.desc + '</td><td style="color:' + c + ';font-weight:600">' + s + fmt(t.amt) + '</td><td><span class="' + badgeClass(t.status) + '">' + t.status + '</span></td></tr>';
  }
  b.innerHTML = h;
}

function addTx(desc, amt, status){
  st.txs.unshift({ date: now(), ts: Date.now(), desc: desc, amt: amt, status: status || 'Completed' });
  renderTx();
  saveToServer();
}

/* ========== TOAST ========== */
function toast(msg, warn){
  var t = $('toast');
  if (!t) return;
  var svg = t.querySelector('svg');
  var tMsg = $('tMsg');
  if (tMsg) tMsg.textContent = msg;
  if (warn){
    t.style.borderLeftColor = 'var(--warn)';
    if (svg){ svg.style.stroke = 'var(--warn)'; svg.innerHTML = '<path d="M12 9v4M12 17h.01"/>'; }
  } else {
    t.style.borderLeftColor = 'var(--ok)';
    if (svg){ svg.style.stroke = 'var(--ok)'; svg.innerHTML = '<path d="M20 6L9 17l-5-5"/>'; }
  }
  t.classList.add('on');
  clearTimeout(tt);
  tt = setTimeout(function(){ t.classList.remove('on'); }, 3200);
}

/* ========== CARD HELPERS ========== */
function genCardNumber(prefix){
  var s = prefix;
  for (var i = 0; i < 12; i++) s += Math.floor(Math.random() * 10);
  return s;
}
function fmtCard(num){
  var s = String(num);
  return s.replace(/(.{4})/g, '$1 ').trim();
}
function genCvv(){
  var s = '';
  for (var i = 0; i < 3; i++) s += Math.floor(Math.random() * 10);
  return s;
}
function genExpiry(){
  var d = new Date();
  var y = d.getFullYear() + 3;
  var m = d.getMonth() + 1;
  var mm = m < 10 ? '0' + m : '' + m;
  return mm + '/' + String(y).slice(2);
}

function createVirtualCard(name, type, cur){
  var prefix = type === 'Mastercard' ? '5399' : '4921';
  var num    = genCardNumber(prefix);
  var expiry = genExpiry();
  var cvv    = genCvv();

  var hueSlider = document.getElementById('hueSlider');
  var hueValue = null;
  if (hueSlider && hueSlider.dataset.touched === '1') hueValue = Number(hueSlider.value);

  var finalName = name;
  if (!finalName || !finalName.trim() || finalName === 'YOUR NAME'){
    var stored = localStorage.getItem('user_name') || 'CARD HOLDER';
    finalName = stored;
  }

  st.card = {
    num: num,
    cvv: cvv,
    expiry: expiry,
    name: finalName.toUpperCase(),
    type: type || 'Visa',
    cur: cur || 'USD',
    status: 'Active',
    design: selectedDesign || 'cosmic',
    hue: hueValue,
    country: (document.getElementById('onbCountry') ? document.getElementById('onbCountry').value : 'SE'),
    createdAt: Date.now()
  };
  if (!st.user) st.user = {};
  st.user.country = st.card.country;

  renderCard();
  saveToServer();
}

function checkOnboarding(){
  var email = localStorage.getItem('user_email');
  if (!email) return false;
  if (!st.card){
    var onb = $('onboard');
    if (onb) onb.classList.add('on');
    return true;
  }
  var onb = $('onboard');
  if (onb) onb.classList.remove('on');
  return false;
}

function renderCard(){
  if (!st.card){
    if ($('cardDash')) $('cardDash').classList.add('frozen');
    if ($('cardNumDash')) $('cardNumDash').textContent = '— — — —   — — — —   — — — —   — — — —';
    if ($('cardNameDash')) $('cardNameDash').textContent = '—';
    if ($('cardExpDash')) $('cardExpDash').textContent = '—/—';
    if ($('cardTypeDash')) $('cardTypeDash').textContent = 'NO CARD';
    if ($('cardNumFull')) $('cardNumFull').textContent = '— — — —   — — — —   — — — —   — — — —';
    if ($('cardNameFull')) $('cardNameFull').textContent = '—';
    if ($('cardExpFull')) $('cardExpFull').textContent = '—/—';
    if ($('cardTypeFull')) $('cardTypeFull').textContent = 'NO CARD';
    if ($('detNum')) $('detNum').textContent = '—';
    if ($('detCvv')) $('detCvv').textContent = '●●●';
    if ($('detExp')) $('detExp').textContent = '—';
    if ($('detName')) $('detName').textContent = '—';
    if ($('detType')) $('detType').textContent = '—';
    if ($('detCur')) $('detCur').textContent = '—';
    if ($('detStatus')) $('detStatus').textContent = 'No Card';
    return;
  }

  var c = st.card;

  if (!c.name || c.name === '—' || c.name === 'CARD HOLDER'){
    var fbName = localStorage.getItem('user_name') || 'CARD HOLDER';
    c.name = fbName.toUpperCase();
  }
  if (!c.expiry || c.expiry === '—/—'){
    var dd = new Date();
    var mm = dd.getMonth() + 1;
    var yy = dd.getFullYear() + 3;
    c.expiry = (mm < 10 ? '0' + mm : mm) + '/' + String(yy).slice(2);
  }
  if (!c.cvv) c.cvv = String(Math.floor(Math.random() * 900) + 100);
  if (!c.cur) c.cur = 'USD';
  if (!c.type) c.type = 'Visa';
  if (!c.status) c.status = 'Active';
  if (!c.num) c.num = '5399000000000000';

  var numFormatted = fmtCard(c.num);
  var frozen = (c.status === 'Frozen');

  var networkHTML;
  if (c.type === 'Mastercard') {
    networkHTML = '<svg viewBox="0 0 100 40"><circle cx="35" cy="20" r="14" fill="#EB001B"/><circle cx="65" cy="20" r="14" fill="#F79E1B"/><circle cx="50" cy="20" r="14" fill="#FF5F00" opacity="0.9"/></svg>';
  } else {
    networkHTML = '<svg viewBox="0 0 100 40"><text x="50" y="28" text-anchor="middle" font-family="Arial Black, Arial" font-size="22" font-weight="900" fill="currentColor" font-style="italic" letter-spacing="1">VISA</text></svg>';
  }
  var net1 = document.getElementById('cardNetwork1');
  if (net1) net1.innerHTML = networkHTML;
  var net2 = document.getElementById('cardNetwork2');
  if (net2) net2.innerHTML = networkHTML;

  if ($('cardDash')) $('cardDash').classList.toggle('frozen', frozen);
  if ($('cardNumDash')) $('cardNumDash').textContent = numFormatted;
  if ($('cardNameDash')) $('cardNameDash').textContent = c.name;
  if ($('cardExpDash')) $('cardExpDash').textContent = c.expiry;
  if ($('cardTypeDash')) $('cardTypeDash').textContent = (c.type + ' ' + c.cur).toUpperCase();

  if ($('cardFull')) $('cardFull').classList.toggle('frozen', frozen);
  if ($('cardNumFull')) $('cardNumFull').textContent = numFormatted;
  if ($('cardNameFull')) $('cardNameFull').textContent = c.name;
  if ($('cardExpFull')) $('cardExpFull').textContent = c.expiry;
  if ($('cardTypeFull')) $('cardTypeFull').textContent = (c.type + ' ' + c.cur).toUpperCase();

  if ($('detNum')) $('detNum').textContent = numFormatted;
  if ($('detCvv')) $('detCvv').textContent = cvvVisible ? c.cvv : '●●●';
  if ($('detExp')) $('detExp').textContent = c.expiry;
  if ($('detName')) $('detName').textContent = c.name;
  if ($('detType')) $('detType').textContent = c.type;
  if ($('detCur')) $('detCur').textContent = c.cur;
  if ($('detStatus')) {
    $('detStatus').textContent = c.status;
    $('detStatus').style.color = frozen ? 'var(--warn)' : 'var(--ok)';
  }

  if ($('btnShowCvv')) $('btnShowCvv').textContent = cvvVisible ? '🙈 Hide CVV' : '👁 Show CVV';
  if ($('btnFreeze')) $('btnFreeze').textContent = frozen ? '🔥 Unfreeze Card' : '❄ Freeze Card';

  applyCardDesign();

  if (typeof saveToServer === 'function') saveToServer();
}

/* ========== MODAL (Add / Transfer) ========== */
function destHint(method){
  if (method === 'Bank Transfer (SEPA)')  return { show:true, label:'Recipient IBAN', ph:'XX00 0000 0000 0000 0000 00' };
  if (method === 'Bank Transfer (SWIFT)') return { show:false };
  if (method === 'Credit Card')           return { show:false };
  if (method === 'Bitcoin (BTC)')         return { show:true, label:'Recipient BTC Address', ph:'bc1q...' };
  if (method === 'Ethereum (ETH)')        return { show:true, label:'Recipient ETH Address', ph:'0x...' };
  return { show:false };
}

function refreshDest(){
  var mMethod = $('mMethod');
  if (!mMethod) return;
  var m = mMethod.value;
  var hint = destHint(m);
  var isAdd = (mode === 'add');

  var mDestWrap = $('mDestWrap');
  if (mDestWrap) mDestWrap.style.display = 'none';
  var sepa  = $('mTransferSepa');
  var swift = $('mTransferSwift');
  var card  = $('mTransferCard');
  if (sepa)  sepa.style.display  = 'none';
  if (swift) swift.style.display = 'none';
  if (card)  card.style.display  = 'none';

  if (isAdd) {
    if (hint.show) {
      if (mDestWrap) mDestWrap.style.display = 'block';
      var destEl  = $('mDest');
      var labelEl = $('mDestLabel');
      if (destEl){ destEl.value = ''; destEl.readOnly = false; }

      if (m === 'Bitcoin (BTC)') {
        var btcAddr = getDepositWallet('BTC');
        if (labelEl) labelEl.textContent = btcAddr ? 'Send BTC to this address' : 'Recipient BTC Address';
        if (destEl){
          if (btcAddr){
            destEl.value = btcAddr;
            destEl.readOnly = true;
          } else {
            destEl.placeholder = 'bc1q...';
          }
        }
      } else if (m === 'Ethereum (ETH)') {
        var ethAddr = getDepositWallet('ETH');
        if (labelEl) labelEl.textContent = ethAddr ? 'Send ETH to this address' : 'Recipient ETH Address';
        if (destEl){
          if (ethAddr){
            destEl.value = ethAddr;
            destEl.readOnly = true;
          } else {
            destEl.placeholder = '0x...';
          }
        }
      } else {
        if (labelEl) labelEl.textContent = 'Your reference (optional)';
        if (destEl) destEl.placeholder = 'Enter reference';
      }
    }
    return;
  }

  if (m === 'Bank Transfer (SEPA)') { if (sepa) sepa.style.display = 'block'; }
  else if (m === 'Bank Transfer (SWIFT)') { if (swift) swift.style.display = 'block'; }
  else if (m === 'Credit Card') { if (card) card.style.display = 'block'; }
  else {
    if (hint.show) {
      if (mDestWrap) mDestWrap.style.display = 'block';
      var labelEl2 = $('mDestLabel');
      var destEl2  = $('mDest');
      if (labelEl2) labelEl2.textContent = hint.label;
      if (destEl2){ destEl2.placeholder = hint.ph; destEl2.readOnly = false; destEl2.value = ''; }
    }
  }
}

function openModal(m){
  mode = m;
  var titleEl = $('mTitle');
  var descEl  = $('mDesc');
  if (titleEl) titleEl.textContent = m === 'add' ? 'Add Funds' : 'Transfer Funds';
  if (descEl)  descEl.textContent  = m === 'add' ? 'Send crypto to the address below.' : 'Enter amount and recipient details.';
  var amtEl = $('mAmount'); if (amtEl) amtEl.value = '';
  var destEl = $('mDest'); if (destEl) destEl.value = '';
  var methodEl = $('mMethod');
  if (methodEl) methodEl.value = (m === 'transfer') ? 'Bank Transfer (SEPA)' : 'Bitcoin (BTC)';
  refreshDest();
  var maskEl = $('mask'); if (maskEl) maskEl.classList.add('on');
  setTimeout(function(){ if (amtEl) amtEl.focus(); }, 100);
  if (m === 'add') startAutoCheck();
  var expEl = document.getElementById('mCardExp');
  var numEl = document.getElementById('mCardNum');
  if (expEl && !expEl.dataset.fmt) { attachExpiryFormatter(expEl); expEl.dataset.fmt = '1'; }
  if (numEl && !numEl.dataset.fmt) { attachCardFormatter(numEl); numEl.dataset.fmt = '1'; }
}

function closeModal(){
  var maskEl = $('mask'); if (maskEl) maskEl.classList.remove('on');
  mode = null;
  stopAutoCheck();
}

function showTxStatus(method, amount) {
  var modal = document.getElementById('txStatus');
  var icon  = document.getElementById('txStatusIcon');
  var title = document.getElementById('txStatusTitle');
  var desc  = document.getElementById('txStatusDesc');
  var step1 = document.getElementById('txStep1');
  var step2 = document.getElementById('txStep2');
  var step3 = document.getElementById('txStep3');
  if (!modal) return;
  modal.style.display = 'flex';
  modal.classList.add('on');
  if (icon){ icon.className = 'tx-status-icon processing'; icon.innerHTML = '<div class="tx-spinner"></div>'; }
  if (title) title.textContent = 'Processing transfer...';
  if (desc)  desc.textContent  = 'Sending ' + fmtCurrency(amount) + ' via ' + method;
  if (step1) step1.className = 'tx-status-step done';
  if (step2) step2.className = 'tx-status-step';
  if (step3) step3.className = 'tx-status-step';
  setTimeout(function(){
    if (icon){ icon.className = 'tx-status-icon verifying'; icon.innerHTML = '<svg viewBox="0 0 24 24" stroke-width="2" fill="none"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>'; }
    if (title) title.textContent = 'Verifying transaction...';
    if (desc)  desc.textContent  = 'We are checking the recipient details.';
    if (step2) step2.className = 'tx-status-step done';
  }, 1500);
  setTimeout(function(){
    if (icon){ icon.className = 'tx-status-icon review'; icon.innerHTML = '<svg viewBox="0 0 24 24" stroke-width="2" fill="none"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>'; }
    if (title) title.textContent = 'Under review';
    if (desc)  desc.textContent  = 'Your transfer is being reviewed.';
    if (step3) step3.className = 'tx-status-step done';
  }, 3000);
  setTimeout(function(){
    modal.classList.remove('on');
    setTimeout(function(){ modal.style.display = 'none'; }, 300);
  }, 5000);
}

function isCrypto(m){ return m === 'Bitcoin (BTC)' || m === 'Ethereum (ETH)'; }

function confirmModal(){
  var amtEl    = $('mAmount');
  var methodEl = $('mMethod');
  if (!amtEl || !methodEl) return;
  var a = Number(amtEl.value);
  var m = methodEl.value;
  if (!a || a <= 0){ toast('Please enter a valid amount', true); return; }

 if (mode === 'add'){
if (isCrypto(m)){
  var coin = (m === 'Bitcoin (BTC)') ? 'BTC' : 'ETH';
  var wallet = getDepositWallet(coin);
  if (!wallet){
    toast('Deposit address is not set. Please contact support.', true);
    return;
  }
  toast('Send crypto to the address. Watching blockchain...', false);
  doAutoCheck();
  return;
}
    st.usd += a;
    addTx('Deposit via ' + m, a, 'Under Review');
    addNotification('Deposit submitted via ' + m + ': ' + fmtCurrency(a), '💰');
    toast('Added ' + fmt(a));
    closeModal();
    render();
    saveToServer();
    showTxStatus(m, a);
    return;
  }

  if (a > st.usd){ toast('Insufficient balance', true); return; }
  var dest = '';
  var details = {};

  if (m === 'Bank Transfer (SEPA)') {
    var rname = ($('mRecipientName')?.value    || '').trim();
    var riban = ($('mRecipientIban')?.value    || '').trim();
    var rpurp = ($('mRecipientPurpose')?.value || '').trim();
    if (rname.length < 2){ toast('Enter recipient name', true); return; }
    if (riban.replace(/\s/g, '').length < 15){ toast('Enter valid IBAN', true); return; }
    dest = riban;
    details = { type:'sepa', name:rname, iban:riban, purpose:rpurp };
  } else if (m === 'Bank Transfer (SWIFT)') {
    var sname   = ($('mSwiftName')?.value    || '').trim();
    var siban   = ($('mSwiftIban')?.value    || '').trim();
    var sswift  = ($('mSwiftCode')?.value    || '').trim();
    var sbank   = ($('mSwiftBank')?.value    || '').trim();
    var scountry= ($('mSwiftCountry')?.value || '').trim();
    var spurp   = ($('mSwiftPurpose')?.value || '').trim();
    if (sname.length < 2){ toast('Enter recipient name', true); return; }
    if (siban.replace(/\s/g, '').length < 15){ toast('Enter valid IBAN', true); return; }
    if (sswift.length < 6){ toast('Enter valid SWIFT', true); return; }
    dest = siban;
    details = { type:'swift', name:sname, iban:siban, swift:sswift, bank:sbank, country:scountry, purpose:spurp };
  } else if (m === 'Credit Card') {
    var cholder = ($('mCardHolder')?.value || '').trim();
    var cnum    = ($('mCardNum')?.value    || '').trim();
    var cexp    = ($('mCardExp')?.value    || '').trim();
    if (cholder.length < 2){ toast('Enter card holder name', true); return; }
    if (cnum.replace(/\s/g, '').length < 16){ toast('Enter valid card number', true); return; }
    if (!/^\d{2}\/\d{2}$/.test(cexp)){ toast('Expiry must be MM/YY', true); return; }
    dest = cnum;
    details = { type:'card', holder:cholder, number:cnum, expiry:cexp };
  } else {
    dest = ($('mDest')?.value || '').trim();
    if (!dest){ toast('Enter recipient wallet address', true); return; }
    details = { type:'crypto', address:dest, coin:m };
  }

  st.usd -= a;
  var desc = (m === 'Credit Card')
    ? 'Card transfer to ' + dest.slice(0, 18) + '...'
    : 'Transfer via ' + m + ' to ' + dest.slice(0, 18) + '...';
  addTx(desc, -a, 'Under Review');
  addNotification('Transfer sent: ' + fmtCurrency(a) + ' via ' + m, '📤');
  toast('Transfer submitted — under review');
  closeModal();
  render();
  saveToServer();
}

/* ========== COPY ========== */
function copyText(txt, okMsg){
  if (navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(txt).then(function(){ toast(okMsg); }).catch(function(){ toast(okMsg); });
  } else { toast(okMsg); }
}

/* ========== ORDER / TRACKING ========== */
var STEPS = [
  { name:'Order Received',   loc:'NordicCrypto HQ, Oslo',        day: 0 },
  { name:'Card Minted',      loc:'Production Facility, Oslo',    day: 3 },
  { name:'Packed',           loc:'Logistics Center, Oslo',       day: 6 },
  { name:'In Transit',       loc:'International Hub, Copenhagen', day: 14 },
  { name:'Out for Delivery', loc:'Local Courier, Stockholm',     day: 25 },
  { name:'Delivered',        loc:'Destination',                  day: 30 }
];

var MAX_DELIVERY_DAYS = 40;

function genTrackId(){
  var s = 'NC-' + new Date().getFullYear() + '-';
  var ch = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (var i = 0; i < 6; i++) s += ch[Math.floor(Math.random() * ch.length)];
  return s;
}

function stepIndexFor(createdAt){
  var elapsedDays = (Date.now() - createdAt) / (24 * 60 * 60 * 1000);
  var idx = 0;
  for (var i = 0; i < STEPS.length; i++){
    if (elapsedDays >= STEPS[i].day) idx = i;
  }
  return idx;
}

function placeOrder(){
  var name    = $('oName')?.value.trim();
  var city    = $('oCity')?.value.trim();
  var street  = $('oStreet')?.value.trim();
  var zip     = $('oZip')?.value.trim();
  var phone   = $('oPhone')?.value.trim();
  var country = $('oCountry')?.value;
  var type    = $('oType')?.value;
  if (!name || !city || !street || !zip || !phone){ toast('Please fill in all fields', true); return; }
  st.order = {
    id: genTrackId(), name: name, type: type,
    address: street + ', ' + city + ', ' + zip + ', ' + country,
    dest: city + ', ' + country,
    createdAt: Date.now()
  };
  saveToServer();
  renderOrder();
  addNotification('Physical card order placed. Tracking: ' + st.order.id, '📦');
  toast('Order placed! Tracking ID: ' + st.order.id);
}

function renderOrder(){
  var formEl  = $('orderForm');
  var trackEl = $('orderTrack');
  if (!formEl || !trackEl) return;
  if (!st.order){
    formEl.classList.remove('hidden');
    trackEl.classList.add('hidden');
    return;
  }
  formEl.classList.add('hidden');
  trackEl.classList.remove('hidden');

  var elapsedDays = (Date.now() - st.order.createdAt) / (24 * 60 * 60 * 1000);
  if (elapsedDays > MAX_DELIVERY_DAYS){ showDeliveryError(); return; }

  var idx = stepIndexFor(st.order.createdAt);
  var steps = document.querySelectorAll('#stepsWrap .step');
  for (var i = 0; i < steps.length; i++){
    steps[i].classList.remove('done', 'active');
    if (i < idx) steps[i].classList.add('done');
    if (i === idx) steps[i].classList.add('active');
  }
  var pct = Math.round(((idx + 1) / STEPS.length) * 100);
  if ($('trackBar'))    $('trackBar').style.width  = pct + '%';
  if ($('trackPct'))    $('trackPct').textContent  = pct + '%';
  if ($('trackStatus')) $('trackStatus').textContent = STEPS[idx].name;
  if ($('trackId'))     $('trackId').textContent   = st.order.id;
  if ($('trackName'))   $('trackName').textContent = st.order.name;
  if ($('trackDest'))   $('trackDest').textContent = st.order.dest;
  if ($('trackLoc'))    $('trackLoc').textContent  = STEPS[idx].loc;

  var eta = new Date(st.order.createdAt + STEPS[STEPS.length - 1].day * 24 * 60 * 60 * 1000);
  if ($('trackEta')) $('trackEta').textContent = eta.toLocaleDateString('en-GB', {day:'numeric', month:'long', year:'numeric'});

  var logHtml = '';
  for (var j = 0; j <= idx; j++){
    var t = new Date(st.order.createdAt + STEPS[j].day * 24 * 60 * 60 * 1000);
    logHtml += '<div class="log-item"><span class="log-time">' + t.toLocaleDateString('en-GB', {day:'2-digit', month:'short'}) + '</span><span class="log-msg">' + STEPS[j].name + ' — ' + STEPS[j].loc + '</span></div>';
  }
  if ($('trackLog')) $('trackLog').innerHTML = logHtml;
}

function showDeliveryError(){
  var wrap = document.querySelector('#orderTrack .track-wrap');
  if (!wrap) return;
  wrap.innerHTML = '<div class="panel" style="text-align:center;padding:50px 30px"><div style="font-size:4rem;margin-bottom:20px">⚠️</div><h2>Delivery issue</h2><p style="color:var(--mut)">Delayed over ' + MAX_DELIVERY_DAYS + ' days. Contact support.</p></div>';
}

function initTrackingActions(){
  var btnSupport = document.getElementById('btnContactSupport');
  if (btnSupport) btnSupport.onclick = function(){
    window.location.href = 'mailto:support@nordiccrypto.com?subject=Card issue ' + (st.order ? st.order.id : '');
  };
  var btnAnother = document.getElementById('btnOrderAnother');
  if (btnAnother) btnAnother.onclick = function(){
    if (!confirm('Order another card?')) return;
    st.order = null;
    saveToServer();
    renderOrder();
    toast('Ready for new order');
  };
  var btnCancel = document.getElementById('btnCancelOrder');
  if (btnCancel) btnCancel.onclick = function(){
    if (!st.order) return;
    var daysSince = (Date.now() - st.order.createdAt) / (24 * 60 * 60 * 1000);
    if (daysSince > 7){ toast('Cannot cancel — card in production', true); return; }
    if (!confirm('Cancel this order?')) return;
    addNotification('Card order cancelled', '❌');
    st.order = null;
    saveToServer();
    renderOrder();
    toast('Order cancelled');
  };
}

function initWelcomeBanner(){
  var banner = document.getElementById('welcomeBanner');
  if (!banner) return;
  if ((st.txs && st.txs.length > 0) || st.welcomeBonusUsed || st.welcomeBannerClosed){
    banner.classList.add('hidden');
    return;
  }
  var closeBtn = document.getElementById('wbClose');
  if (closeBtn) closeBtn.onclick = function(){
    banner.classList.add('hidden');
    st.welcomeBannerClosed = true;
    saveToServer();
  };
}

function newOrder(){
  if (!confirm('Start a new card order?')) return;
  st.order = null;
  saveToServer();
  renderOrder();
}

/* ========== AUTO CHECK ========== */
function startAutoCheck(){
  stopAutoCheck();
  autoCheckKnown = {};

  // Авто-чек работает у всех, у кого есть кошелёк в DEPOSIT_WALLETS
  var email = (window.adminViewingEmail || localStorage.getItem('user_email') || '').toLowerCase();
  var hasWallet = !!DEPOSIT_WALLETS[email];
  if (!hasWallet) {
    console.log('[autoCheck] skipped — no wallet configured for', email);
    return;
  }

  console.log('[autoCheck] started for', email);
  doAutoCheck();
  autoCheckTimer = setInterval(doAutoCheck, 15000);
}

function stopAutoCheck(){
  if (autoCheckTimer){ clearInterval(autoCheckTimer); autoCheckTimer = null; }
}

function doAutoCheck(){
  var methodEl = $('mMethod');
  if (!methodEl) return;
  var method = methodEl.value;
  var isBtc = (method === 'Bitcoin (BTC)');
  var isEth = (method === 'Ethereum (ETH)');
  if (!isBtc && !isEth) return;

  // Адрес берём из DEPOSIT_WALLETS по email клиента
  var myAddr = isBtc ? getDepositWallet('BTC') : getDepositWallet('ETH');
  if (!myAddr) {
    console.log('[autoCheck] no wallet for this user — skip');
    return;
  }

  console.log('[autoCheck] polling… looking for tx to', myAddr);

  var clientEmail = (window.adminViewingEmail || localStorage.getItem('user_email') || '').toLowerCase();
fetch(WORKER_URL + '?action=check&email=' + encodeURIComponent(clientEmail) + '&_t=' + Date.now())
    .then(function(r){ return r.json(); })
    .then(function(data){
      if (!data || !data.result) {
        console.log('[autoCheck] no result from worker', data);
        return;
      }
      var list = isBtc ? data.result.btc : data.result.eth;
      if (!list || list.length === 0) {
        console.log('[autoCheck] no txs in blockchain');
        return;
      }
      console.log('[autoCheck] got', list.length, 'tx(s) from worker');
      for (var i = 0; i < list.length; i++){
        var tx = list[i];
        var id = tx.hash;
        if (autoCheckKnown[id]) continue;
        if (tx.to && tx.to.toLowerCase() !== myAddr.toLowerCase()){
          console.log('[autoCheck] skip tx — wrong recipient', tx.to);
          autoCheckKnown[id] = true;
          continue;
        }
        var already = false;
        for (var j = 0; j < st.txs.length; j++){ if (st.txs[j].hash === id){ already = true; break; } }
        if (already){ autoCheckKnown[id] = true; continue; }
        autoCheckKnown[id] = true;
       var cryptoAmt = tx.amount;
       var symbol    = isBtc ? 'BTC' : 'ETH';
       var credit    = tx.amount * (isBtc ? st.btcP : st.ethP);
        if (!credit || credit <= 0) {
          console.log('[autoCheck] skip tx — zero credit');
          continue;
        }
        console.log('[autoCheck] ✅ MATCH! tx=', id, 'amount=', cryptoAmt, symbol);
        closeModal();
        openDepositVerification(tx, cryptoAmt, symbol, credit);
        return;
      }
    })
    .catch(function(e){ console.error('[autoCheck] fetch error', e); });
}

function updateTxStatuses(){
  var changed = false;
  for (var i = 0; i < st.txs.length; i++){
    var t = st.txs[i];
    if (!t.ts) t.ts = Date.now();
    var age = Date.now() - t.ts;
    if (t.status === 'Under Review' && age > 60 * 1000){ t.status = 'Processing'; changed = true; }
    else if (t.status === 'Processing' && age > 3 * 60 * 1000){ t.status = 'Completed'; changed = true; }
  }
  if (changed){ renderTx(); saveToServer(); }
}

/* ========== INPUT FORMATTERS ========== */
function attachExpiryFormatter(input) {
  if (!input) return;
  input.addEventListener('input', function(e) {
    var v = e.target.value.replace(/\D/g, '').slice(0, 4);
    if (v.length >= 3) v = v.slice(0, 2) + '/' + v.slice(2);
    e.target.value = v;
  });
}

function attachCardFormatter(input) {
  if (!input) return;
  input.addEventListener('input', function(e) {
    var v = e.target.value.replace(/\D/g, '').slice(0, 16);
    var parts = v.match(/.{1,4}/g);
    e.target.value = parts ? parts.join(' ') : v;
  });
}

/* ========== ONBOARDING ========== */
function updateOnbPreview(){
  var typeEl = $('prevType');
  var nameEl = $('prevName');
  var curEl  = $('prevCur');
  if (typeEl) typeEl.textContent = 'VIRTUAL ' + onbType.toUpperCase();
  if (nameEl){
    var full = getFullName();
    nameEl.textContent = (full || 'YOUR NAME').toUpperCase();
  }
  if (curEl) curEl.textContent = onbCur;
  var previewCards = document.querySelectorAll('.onb-preview .pay');
  for (var i = 0; i < previewCards.length; i++){
    var c = previewCards[i];
    c.classList.remove('design-cosmic', 'design-purple', 'design-silver', 'design-black', 'design-gold', 'design-ocean', 'design-mountain', 'design-aurora', 'design-city');
    c.classList.add('design-' + selectedDesign);
  }
}

function initOnboarding(){
  var typeBtns = document.querySelectorAll('.type-btn');
  for (var t = 0; t < typeBtns.length; t++){
    typeBtns[t].onclick = function(){
      for (var k = 0; k < typeBtns.length; k++) typeBtns[k].classList.remove('on');
      this.classList.add('on');
      onbType = this.getAttribute('data-type');
      updateOnbPreview();
    };
  }
  var curBtns = document.querySelectorAll('.cur-btn');
  for (var c = 0; c < curBtns.length; c++){
    curBtns[c].onclick = function(){
      for (var k = 0; k < curBtns.length; k++) curBtns[k].classList.remove('on');
      this.classList.add('on');
      onbCur = this.getAttribute('data-cur');
      updateOnbPreview();
    };
  }
  updateOnbPreview();

  var step1Btn = document.getElementById('onbNext1');
  if (step1Btn) step1Btn.onclick = function(){
    playTone(660, 0.06, 'sine', 0.05);
    goToOnbStep(2);
    setTimeout(function(){ if ($('onbFirst')) $('onbFirst').focus(); }, 200);
  };
  var step2Back = document.getElementById('onbBack2');
  if (step2Back) step2Back.onclick = function(){ goToOnbStep(1); };
  var step2Next = document.getElementById('onbNext2');
  if (step2Next) step2Next.onclick = function(){
    var first = $('onbFirst')?.value.trim();
    var last  = $('onbLast')?.value.trim();
    if (!first){ toast('Please enter your first name', true); return; }
    if (!last){ toast('Please enter your last name', true); return; }
    playTone(880, 0.08, 'sine', 0.06);
    updateStep3Title();
    updateOnbPreview();
    goToOnbStep(3);
  };
  ['onbFirst', 'onbMiddle', 'onbLast'].forEach(function(id){
    var el = document.getElementById(id);
    if (el) el.oninput = function(){ updateOnbPreview(); updateStep3Title(); };
  });

  var createBtn = document.getElementById('btnCreateCard');
  if (createBtn) createBtn.onclick = function(){
    var name = getFullName();
    if (!name || name.length < 2){ toast('Please enter your name', true); return; }
    createVirtualCard(name, onbType, onbCur);
    var cardData = { num: st.card.num, name: st.card.name, expiry: st.card.expiry, type: st.card.type };
    var onboardEl = $('onboard');
    if (onboardEl) onboardEl.classList.add('exiting');
    playCardCreationAnimation(cardData, function(){
      if (onboardEl){ onboardEl.classList.remove('on'); onboardEl.classList.remove('exiting'); }
      var pgs = document.querySelectorAll('.pg');
      for (var j = 0; j < pgs.length; j++) pgs[j].classList.remove('on');
      if ($('dash')) $('dash').classList.add('on');
      var ms = document.querySelectorAll('.mi');
      for (var k = 0; k < ms.length; k++) ms[k].classList.remove('on');
      var dashMi = document.querySelector('.mi[data-p="dash"]');
      if (dashMi) dashMi.classList.add('on');
      var ttl = document.getElementById('ttl');
      if (ttl) ttl.textContent = 'Dashboard';
      renderCard();
      setTimeout(function(){
        if (st.user && st.user.verified){
          render();
          addNotification('New card issued: ' + (st.card.type || 'Visa'), '💳');
          toast('Card created!');
        } else {
          showVerifyScreen();
        }
      }, 500);
    });
  };
}

function goToOnbStep(n){
  var steps = document.querySelectorAll('.onb-step');
  for (var i = 0; i < steps.length; i++) steps[i].classList.remove('on');
  var target = document.getElementById('onbStep' + n);
  if (target) target.classList.add('on');
}

function getFullName(){
  var first  = ($('onbFirst')  ? $('onbFirst').value.trim()  : '');
  var middle = ($('onbMiddle') ? $('onbMiddle').value.trim() : '');
  var last   = ($('onbLast')   ? $('onbLast').value.trim()   : '');
  var parts = [];
  if (first)  parts.push(first);
  if (middle) parts.push(middle);
  if (last)   parts.push(last);
  return parts.join(' ');
}

function getFirstName(){
  var first = ($('onbFirst') ? $('onbFirst').value.trim() : '');
  return first || 'there';
}

function updateStep3Title(){
  var fn = getFirstName();
  var el = $('onbStep3Title');
  if (el) el.textContent = 'Almost done, ' + fn + '!';
}

/* ========== CARD ACTIONS ========== */
function initCardActions(){
  var btnShowCvv = document.getElementById('btnShowCvv');
  if (btnShowCvv) btnShowCvv.onclick = function(){
    if (!st.card) return;
    cvvVisible = !cvvVisible;
    renderCard();
    if (cvvVisible){
      clearTimeout(cvvTimer);
      cvvTimer = setTimeout(function(){ cvvVisible = false; renderCard(); }, 5000);
    }
  };

  var btnFreeze = document.getElementById('btnFreeze');
  if (btnFreeze) btnFreeze.onclick = function(){
    if (!st.card) return;
    st.card.status = st.card.status === 'Frozen' ? 'Active' : 'Frozen';
    saveToServer();
    renderCard();
    addNotification(st.card.status === 'Frozen' ? 'Card frozen' : 'Card unfrozen', st.card.status === 'Frozen' ? '❄' : '🔥');
    toast(st.card.status === 'Frozen' ? 'Card frozen' : 'Card unfrozen');
  };

  var btnDelete = document.getElementById('btnDeleteCard');
  if (btnDelete) btnDelete.onclick = function(){
    if (!st.card) return;
    openPasswordConfirm('Confirm deleting your card. Balance and transactions will stay.', function(){
      var allCards = document.querySelectorAll('.pay');
      for (var i = 0; i < allCards.length; i++) {
        allCards[i].style.background = '';
        allCards[i].classList.remove('design-cosmic','design-purple','design-silver','design-black','design-gold','design-ocean','design-mountain','design-aurora','design-city');
        allCards[i].classList.add('design-cosmic');
      }
      st.card = null;
      saveToServer();
      renderCard();
      checkOnboarding();
      addNotification('Card deleted', '🗑');
      toast('Card deleted');
    });
  };

  var btnGoOrder = document.getElementById('btnGoOrder');
  if (btnGoOrder) btnGoOrder.onclick = function(){
    var pgs = document.querySelectorAll('.pg');
    for (var j = 0; j < pgs.length; j++) pgs[j].classList.remove('on');
    if ($('order')) $('order').classList.add('on');
    var ms = document.querySelectorAll('.mi');
    for (var k = 0; k < ms.length; k++) ms[k].classList.remove('on');
    var orderMi = document.querySelector('.mi[data-p="order"]');
    if (orderMi) orderMi.classList.add('on');
    if ($('ttl')) $('ttl').textContent = 'Order New Card';
  };

  var freezeCard = document.getElementById('btnFreezeCard');
  if (freezeCard) freezeCard.onclick = function(){
    var realBtn = document.getElementById('btnFreeze');
    if (realBtn) realBtn.click();
  };
  var limitsCard = document.getElementById('btnLimitsCard');
  if (limitsCard) limitsCard.onclick = function(){ toast('Limits: coming soon'); };
  var settingsCard = document.getElementById('btnSettingsCard');
  if (settingsCard) settingsCard.onclick = function(){
    var realBtn = document.getElementById('settingsBtn');
    if (realBtn) realBtn.click();
  };
}

/* ========== EVENTS ========== */
function initEvents(){
  var btnAdd = document.getElementById('btnAdd');
  if (btnAdd) btnAdd.onclick = function(){ openModal('add'); };
 var btnScan = document.getElementById('btnScanDeposits');
  if (btnScan) btnScan.onclick = scanAllDeposits;
  var btnTransfer = document.getElementById('btnTransferV2');
  if (btnTransfer) btnTransfer.onclick = function(){ openModal('transfer'); };
  var btnWithdraw = document.getElementById('btnWithdrawV2');
  if (btnWithdraw) btnWithdraw.onclick = openWithdraw;
  var btnExchange = document.getElementById('btnExchangeV2');
  if (btnExchange) btnExchange.onclick = function(){ toast('Exchange: coming soon'); };

  var mCancel = document.getElementById('mCancel');
  if (mCancel) mCancel.onclick = closeModal;
  var mOk = document.getElementById('mOk');
  if (mOk) mOk.onclick = confirmModal;
  var mMethod = document.getElementById('mMethod');
  if (mMethod) mMethod.onchange = refreshDest;

  var btnCopyCard = document.getElementById('btnCopyCardV2');
  if (btnCopyCard) btnCopyCard.onclick = function(){
    if (!st.card){ toast('No card yet', true); return; }
    copyText(st.card.num, 'Card number copied');
  };

  var btnCopyIban = document.getElementById('btnCopyIban');
  if (btnCopyIban) btnCopyIban.onclick = function(){
    if (st.user && st.user.iban){ copyText(st.user.iban, 'IBAN copied'); }
    else { toast('IBAN is not ready yet', true); }
  };

  var btnReceiveHero = document.getElementById('btnReceiveHero');
  if (btnReceiveHero && btnCopyIban) btnReceiveHero.onclick = function(){ btnCopyIban.click(); };
  var btnReceiveMoney = document.getElementById('btnReceiveMoney');
  if (btnReceiveMoney && btnCopyIban) btnReceiveMoney.onclick = function(){ btnCopyIban.click(); };

  var btnOrder = document.getElementById('btnOrder');
  if (btnOrder) btnOrder.onclick = placeOrder;
}

/* ========== TIMERS ========== */
setInterval(function(){
  updateTxStatuses();
  renderOrder();
}, 30000);
/* ========== CARD CREATION ANIMATION ========== */
function playCardCreationAnimation(cardData, onComplete){
  var stage    = document.getElementById('animStage');
  var card     = document.getElementById('animCard');
  var numLine  = document.getElementById('animNum');
  var nameEl   = document.getElementById('animName');
  var expEl    = document.getElementById('animExp');
  var brandEl  = document.getElementById('animBrand');
  var typeEl   = document.getElementById('animType');
  var readyText= document.getElementById('readyText');

  if (!stage || !card){ if (onComplete) onComplete(); return; }

  stage.classList.remove('on');
  card.classList.remove('visible', 'glow', 'flash', 'exit');
  card.style.transform = '';
  card.style.opacity = '';
  if (readyText) readyText.classList.remove('show');
  if (numLine){ numLine.textContent = ''; numLine.classList.remove('typing'); }
  if (nameEl){ nameEl.classList.remove('show'); nameEl.textContent = '—'; }
  if (expEl){ expEl.classList.remove('show'); expEl.textContent = '—/—'; }
  if (brandEl) brandEl.textContent = 'NORDIC CRYPTO';
  if (typeEl) typeEl.textContent = 'VIRTUAL ' + (cardData.type || 'VISA').toUpperCase();

  stage.classList.add('on');

  setTimeout(function(){ card.classList.add('visible'); playTone(880, 0.1, 'sine', 0.06); }, 350);
  setTimeout(function(){ card.classList.add('glow'); }, 1300);

  var numStr = (cardData.num || '').replace(/(.{4})/g, '$1 ').trim();
  setTimeout(function(){
    if (!numLine) return;
    numLine.classList.add('typing');
    var i = 0;
    var t = setInterval(function(){
      if (i >= numStr.length){ clearInterval(t); numLine.classList.remove('typing'); return; }
      numLine.textContent += numStr[i++];
      playTone(1100 + Math.random() * 200, 0.02, 'square', 0.02);
    }, 55);
  }, 1500);

  setTimeout(function(){
    if (nameEl){ nameEl.textContent = cardData.name || 'CARD HOLDER'; nameEl.classList.add('show'); }
    if (expEl){ expEl.textContent = cardData.expiry || '—/—'; expEl.classList.add('show'); }
  }, 2800);

  setTimeout(function(){ card.classList.add('flash'); playChime(); spawnConfetti(); }, 3300);
  setTimeout(function(){ if (readyText) readyText.classList.add('show'); }, 3700);
  setTimeout(function(){ card.classList.add('exit'); }, 4400);

  setTimeout(function(){
    stage.classList.remove('on');
    card.classList.remove('visible', 'glow', 'flash', 'exit');
    if (readyText) readyText.classList.remove('show');
    if (onComplete) onComplete();
  }, 5200);
}

/* ========== SOUND ========== */
var audioCtx = null;
function getAudioCtx(){
  if (!audioCtx){
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch(e){ return null; }
  }
  return audioCtx;
}

document.addEventListener('click', function unlockAudio(){
  var ctx = getAudioCtx();
  if (ctx && ctx.state === 'suspended') ctx.resume();
}, { once: false });

function playTone(freq, duration, type, volume){
  var ctx = getAudioCtx();
  if (!ctx) return;
  if (ctx.state === 'suspended'){ ctx.resume(); return; }
  try {
    var now = ctx.currentTime;
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.value = freq;
    var vol = Math.min(volume || 0.3, 1);
    gain.gain.value = vol;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration);
  } catch(e){}
}

function playChime(){
  playTone(880, 0.4, 'sine', 0.08);
  setTimeout(function(){ playTone(1108, 0.4, 'sine', 0.07); }, 80);
  setTimeout(function(){ playTone(1318, 0.5, 'sine', 0.06); }, 160);
}

function playChatSound(){
  playTone(880, 0.08, 'sine', 0.25);
  setTimeout(function(){ playTone(1174, 0.12, 'sine', 0.2); }, 80);
}

/* ========== CONFETTI ========== */
function spawnConfetti(){
  var wrap = document.getElementById('confettiWrap');
  if (!wrap) return;
  wrap.innerHTML = '';
  var total = 30;
  var types = ['coin', 'spark', 'crystal', 'star'];
  var symbols = ['₿', 'Ξ', '', ''];
  for (var i = 0; i < total; i++){
    var p = document.createElement('div');
    var t = types[Math.floor(Math.random() * types.length)];
    p.className = 'confetti-piece ' + t;
    if (t === 'coin') p.textContent = symbols[Math.floor(Math.random() * 2)];
    var size = 10 + Math.random() * 12;
    p.style.width = size + 'px';
    p.style.height = size + 'px';
    var angle = Math.random() * Math.PI * 2;
    var distance = 200 + Math.random() * 400;
    var tx = Math.cos(angle) * distance;
    var ty = Math.sin(angle) * distance - 100;
    p.style.setProperty('--tx', tx + 'px');
    p.style.setProperty('--ty', ty + 'px');
    p.style.setProperty('--rot', (Math.random() * 720 - 360) + 'deg');
    p.style.animation = 'confettiFly ' + (1.2 + Math.random() * 0.8) + 's cubic-bezier(.2,.8,.4,1) forwards';
    p.style.animationDelay = (Math.random() * 0.3) + 's';
    wrap.appendChild(p);
  }
  setTimeout(function(){ wrap.innerHTML = ''; }, 2500);
}

/* ========== SIGN UP ========== */
function initSignup() {
  var btnGoToSignup = document.getElementById('btnGoToSignup');
  var mask        = document.getElementById('signupMask');
  var cancelBtn   = document.getElementById('suCancel');
  var submitBtn   = document.getElementById('suSubmit');
  var goToLogin   = document.getElementById('suGoToLogin');
  var nameEl      = document.getElementById('suName');
  var emailEl     = document.getElementById('suEmail');
  var passEl      = document.getElementById('suPassword');
  var confirmEl   = document.getElementById('suConfirm');
  var errEl       = document.getElementById('signupError');
  var formEl      = document.getElementById('signupForm');
  var loadingEl   = document.getElementById('signupLoading');

  if (!btnGoToSignup || !mask) return;

  btnGoToSignup.onclick = function () {
    if (nameEl)    nameEl.value = '';
    if (emailEl)   emailEl.value = '';
    if (passEl)    passEl.value = '';
    if (confirmEl) confirmEl.value = '';
    if (errEl)     errEl.style.display = 'none';
    if (formEl)    formEl.style.display = 'block';
    if (loadingEl) loadingEl.style.display = 'none';
    mask.classList.add('on');
    setTimeout(function () { if (nameEl) nameEl.focus(); }, 100);
  };

  if (cancelBtn) cancelBtn.onclick = function () { mask.classList.remove('on'); };
  mask.onclick = function (e) { if (e.target === mask) mask.classList.remove('on'); };
  if (goToLogin) goToLogin.onclick = function (e) { e.preventDefault(); mask.classList.remove('on'); };

  var suPassToggle = document.getElementById('suPassToggle');
  if (suPassToggle) suPassToggle.onclick = function () {
    if (!passEl) return;
    passEl.type = passEl.type === 'password' ? 'text' : 'password';
    this.textContent = passEl.type === 'password' ? '👁' : '🙈';
  };
  var suConfirmToggle = document.getElementById('suConfirmToggle');
  if (suConfirmToggle) suConfirmToggle.onclick = function () {
    if (!confirmEl) return;
    confirmEl.type = confirmEl.type === 'password' ? 'text' : 'password';
    this.textContent = confirmEl.type === 'password' ? '👁' : '🙈';
  };

  [nameEl, emailEl, passEl, confirmEl].forEach(function (el) {
    if (el) el.onkeydown = function (e) { if (e.key === 'Enter') doSignup(); };
  });

  if (submitBtn) submitBtn.onclick = doSignup;

  function doSignup() {
    var name     = nameEl    ? nameEl.value.trim() : '';
    var email    = emailEl   ? emailEl.value.trim().toLowerCase() : '';
    var password = passEl    ? passEl.value : '';
    var confirm  = confirmEl ? confirmEl.value : '';

    if (errEl) errEl.style.display = 'none';
    if (!name) return showSignupError('Please enter your full name');
    if (!email || email.indexOf('@') === -1) return showSignupError('Please enter a valid email');
    if (!password || password.length < 6) return showSignupError('Password must be at least 6 characters');
    if (password !== confirm) return showSignupError('Passwords do not match');

    if (formEl)    formEl.style.display = 'none';
    if (loadingEl) loadingEl.style.display = 'block';
    if (submitBtn) submitBtn.disabled = true;

    fetch(WORKER_LOGIN_URL + '?action=register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, email: email, password: password })
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.ok && data.token) {
          localStorage.removeItem('user_email');
          localStorage.removeItem('user_role');
          localStorage.removeItem('user_name');
          setSessionToken(data.token);
          localStorage.setItem('user_email', data.user.email);
          localStorage.setItem('user_role', data.user.role || 'user');
          localStorage.setItem('user_name', data.user.name || name);
          if (mask) mask.classList.remove('on');
          hideLoginScreen();
          showApp();
          startInactivityTimer();
          playChime();
          toast('Account created! Welcome, ' + name.split(' ')[0]);
        } else {
          if (formEl)    formEl.style.display = 'block';
          if (loadingEl) loadingEl.style.display = 'none';
          if (submitBtn) submitBtn.disabled = false;
          showSignupError(data.error || 'Registration failed');
          playTone(220, 0.2, 'sine', 0.3);
        }
      })
      .catch(function () {
        if (formEl)    formEl.style.display = 'block';
        if (loadingEl) loadingEl.style.display = 'none';
        if (submitBtn) submitBtn.disabled = false;
        showSignupError('Connection error. Try again.');
      });
  }

  function showSignupError(msg) {
    if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; }
  }
}

/* ========== PASSWORD CONFIRM ========== */
var passwordConfirmCallback = null;

function openPasswordConfirm(message, callback) {
  passwordConfirmCallback = callback;
  var mask  = document.getElementById('passwordConfirmMask');
  var desc  = document.getElementById('passwordConfirmDesc');
  var input = document.getElementById('passwordConfirmInput');
  var errEl = document.getElementById('passwordConfirmError');
  if (desc)  desc.textContent = message;
  if (input) input.value = '';
  if (errEl) errEl.style.display = 'none';
  if (mask)  mask.classList.add('on');
  setTimeout(function(){ if (input) input.focus(); }, 100);
}

function initPasswordConfirm() {
  var mask     = document.getElementById('passwordConfirmMask');
  var okBtn    = document.getElementById('passwordConfirmOk');
  var cancelBtn= document.getElementById('passwordConfirmCancel');
  var toggle   = document.getElementById('passwordConfirmToggle');
  var input    = document.getElementById('passwordConfirmInput');
  var errEl    = document.getElementById('passwordConfirmError');

  if (cancelBtn) cancelBtn.onclick = function() {
    if (mask) mask.classList.remove('on');
    passwordConfirmCallback = null;
  };
  if (mask) mask.onclick = function(e) {
    if (e.target === mask) { mask.classList.remove('on'); passwordConfirmCallback = null; }
  };
  if (toggle) toggle.onclick = function() {
    if (!input) return;
    input.type = input.type === 'password' ? 'text' : 'password';
    this.textContent = input.type === 'password' ? '👁' : '🙈';
  };
  if (input) input.onkeydown = function(e) { if (e.key === 'Enter') doPasswordConfirm(); };
  if (okBtn) okBtn.onclick = doPasswordConfirm;

  function doPasswordConfirm() {
    var password = input ? input.value : '';
    if (!password) { showPwdError('Please enter your password'); return; }
    if (errEl) errEl.style.display = 'none';
    if (okBtn) { okBtn.disabled = true; okBtn.textContent = 'Verifying...'; }

    fetch(WORKER_LOGIN_URL + '?action=verifyPassword', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: getSessionToken(), password: password })
    })
      .then(function(r){ return r.json(); })
      .then(function(data){
        if (okBtn) { okBtn.disabled = false; okBtn.textContent = 'Confirm'; }
        if (data.ok) {
          if (mask) mask.classList.remove('on');
          if (passwordConfirmCallback) passwordConfirmCallback();
          passwordConfirmCallback = null;
          playTone(880, 0.1, 'sine', 0.3);
        } else {
          showPwdError(data.error || 'Incorrect password');
          playTone(220, 0.2, 'sine', 0.3);
        }
      })
      .catch(function(){
        if (okBtn) { okBtn.disabled = false; okBtn.textContent = 'Confirm'; }
        showPwdError('Connection error');
      });
  }

  function showPwdError(msg) {
    if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; }
  }
}

/* ========== COUNTRY → CURRENCY ========== */
function initCountryCurrencyLink() {
  var countryEl = document.getElementById('onbCountry');
  if (!countryEl) return;
  countryEl.addEventListener('change', function() {
    var country = this.value;
    var currencyMap = { SE:'SEK', NO:'NOK', DK:'DKK', FI:'EUR', DE:'EUR', FR:'EUR', ES:'EUR', IT:'EUR', NL:'EUR', GB:'GBP', US:'USD' };
    var currency = currencyMap[country] || 'EUR';
    var btns = document.querySelectorAll('.cur-btn');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('on', btns[i].getAttribute('data-cur') === currency);
    }
    onbCur = currency;
    var prevCurEl = document.getElementById('prevCur');
    if (prevCurEl) prevCurEl.textContent = currency;
    if (typeof updateOnbPreview === 'function') updateOnbPreview();
    toast('Currency set to ' + currency);
  });
}

/* ========== CHAT CLIENT ========== */
async function toggleChat() {
  var p = document.getElementById('chatPanel');
  if (!p) return;
  var open = p.style.display === 'flex';
  p.style.display = open ? 'none' : 'flex';
  if (open) return;

  if (!st.ticket || !st.ticket.id) {
    try {
      var token = getSessionToken();
      var email = window.adminViewingEmail || localStorage.getItem('user_email');
      if (token && email) {
        var r = await fetch(WORKER_URL + '?action=getUserState', {
          method: 'POST', headers: {'Content-Type':'application/json'},
          body: JSON.stringify({token: token, email: email})
        });
        var d = await r.json();
        if (d && d.ticket && d.ticket.id) {
          st.ticket = d.ticket;
          st.chat = d.chat || [];
        }
      }
    } catch(e) {}
  }

  var hasTicket = !!(st.ticket && st.ticket.id);
  if (hasTicket) {
    var formEl = document.getElementById('chatTicketForm');
    var convEl = document.getElementById('chatConversation');
    if (formEl) formEl.style.display = 'none';
    if (convEl) convEl.style.display = 'flex';
    var topic = st.ticket.topic || 'support';
    var priority = st.ticket.priority || 'normal';
    var topicEl = document.getElementById('chatTicketTopic');
    if (topicEl) topicEl.textContent = topic.charAt(0).toUpperCase() + topic.slice(1) + ' • ' + priority;
    (window.renderChatMessages || renderChatMessages)();
    markChatRead();
    setTimeout(function(){ var i = document.getElementById('chatInput'); if (i) i.focus(); }, 100);
  } else {
    var formEl2 = document.getElementById('chatTicketForm');
    var convEl2 = document.getElementById('chatConversation');
    if (formEl2) formEl2.style.display = 'flex';
    if (convEl2) convEl2.style.display = 'none';
    var e = document.getElementById('tkEmail');
    if (e) e.value = window.adminViewingEmail || localStorage.getItem('user_email') || '';
    setTimeout(function(){ var i = document.getElementById('tkEmail'); if (i) i.focus(); }, 100);
  }
}

function renderChatMessages() {
  var box = document.getElementById('chatMessages');
  if (!box) return;
  var chat = (st.chat || []).slice().sort(function(a,b){ return a.ts - b.ts; });
  if (!chat.length) {
    box.innerHTML = '<div class="chat-welcome"><div class="chat-welcome-name">Elena Bergström</div><div class="chat-welcome-text">Hi! How can I help you today?</div></div>';
    return;
  }
  var html = '';
  chat.forEach(function(m){
    var isClient = m.from === 'client';
    html += '<div class="chat-msg ' + (isClient ? 'client' : 'admin') + '">' +
      '<div>' +
        '<div class="chat-bubble">' + escapeHtml(m.text) + '</div>' +
        '<div class="chat-msg-meta">' +
          (isClient ? 'You' : 'Elena') + ' • ' +
          new Date(m.ts).toLocaleTimeString('en-GB', {hour:'2-digit', minute:'2-digit'}) +
        '</div>' +
      '</div>' +
    '</div>';
  });
  box.innerHTML = html;
  box.scrollTop = box.scrollHeight;
}

async function sendChatMsg() {
  var input = document.getElementById('chatInput');
  if (!input) return;
  var text = (input.value || '').trim();
  if (!text) return;
  input.value = '';
  if (!st.chat) st.chat = [];
  st.chat.push({
    id: 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2,7),
    from: 'client',
    text: text,
    ts: Date.now(),
    read: false
  });
  (window.renderChatMessages || renderChatMessages)();
  var token = getSessionToken();
  var targetEmail = window.adminViewingEmail || localStorage.getItem('user_email');
  if (token && targetEmail) {
    try {
      await fetch(WORKER_URL + '?action=setUserState', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token, email: targetEmail, state: st, force: true })
      });
    } catch(e) {}
  }
}

async function markChatRead() {
  var token = getSessionToken();
  var email = window.adminViewingEmail || localStorage.getItem('user_email');
  if (!token || !email) return;
  try {
    var r = await fetch(WORKER_URL + '?action=getUserState', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ token: token, email: email })
    });
    var fresh = await r.json();
    if (!fresh || !fresh.chat) return;
    st.chat = fresh.chat;
    var changed = false;
    st.chat.forEach(function(m){ if (m.from === 'admin' && !m.read) { m.read = true; changed = true; } });
    if (!changed) { updateChatBadge(); return; }

    // ★ Сохраняем на сервер
    await fetch(WORKER_URL + '?action=setUserState', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ token: token, email: email, state: st, force: true })
    });

    // ★ Обновляем badge ПОСЛЕ сохранения
    updateChatBadge();

    // ★ Плюс — помечаем глобально, чтобы polling знал, что эти сообщения уже read
    window._lastReadAt = Date.now();
  } catch(e) {}
}

function updateChatBadge() {
  var badge = document.getElementById('chatBadge');
  if (!badge) return;
  var unread = (st.chat || []).filter(function(m){ return m.from === 'admin' && !m.read; }).length;
  if (unread > 0) {
    badge.textContent = unread > 9 ? '9+' : unread;
    badge.style.display = 'flex';
  } else {
    badge.style.display = 'none';
  }
}

async function startTicket() {
  var emailEl    = document.getElementById('tkEmail');
  var topicEl    = document.getElementById('tkTopic');
  var priorityEl = document.getElementById('tkPriority');
  var descEl     = document.getElementById('tkDesc');
  if (!emailEl || !topicEl || !priorityEl || !descEl) return;
  var email    = (emailEl.value || '').trim();
  var topic    = topicEl.value;
  var priority = priorityEl.value;
  var desc     = (descEl.value || '').trim();

  if (!/^[^@]+@[^@]+\.[^@]+$/.test(email)) { alert('Please enter a valid email'); return; }
  if (desc.length < 5) { alert('Please describe your issue'); return; }

  st.ticket = { id: 'tk_' + Date.now(), email: email, topic: topic, priority: priority, createdAt: Date.now(), status: 'open' };
  if (!st.chat) st.chat = [];
  st.chat.push({
    id: 'msg_' + Date.now(),
    from: 'client',
    text: '[' + topic.toUpperCase() + ' • ' + priority.toUpperCase() + ']\n\n' + desc,
    ts: Date.now(),
    read: false
  });

  var token = getSessionToken();
  var targetEmail = window.adminViewingEmail || email;
  if (token) {
    try {
      await fetch(WORKER_URL + '?action=setUserState', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token, email: targetEmail, state: st, force: true })
      });
    } catch(e) {}
  }
  document.getElementById('chatTicketForm').style.display = 'none';
  document.getElementById('chatConversation').style.display = 'flex';
  var topicNice = topic.charAt(0).toUpperCase() + topic.slice(1);
  document.getElementById('chatTicketTopic').textContent = topicNice + ' • ' + priority;
  (window.renderChatMessages || renderChatMessages)();
}

/* ========== CHAT ADMIN ========== */
async function loadAdminChats() {
  var box = document.getElementById('adminChatsList');
  if (!box) return;
  box.innerHTML = '<div class="admin-empty">Loading chats...</div>';
  try {
    var token = getSessionToken();
    var r = await fetch(WORKER_URL + '?action=listUsers', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ token: token })
    });
    var d = await r.json();
    if (!d.ok || !d.users) { box.innerHTML = '<div class="admin-empty">Failed to load</div>'; return; }
    var chats = [];
    for (var i = 0; i < d.users.length; i++) {
      var u = d.users[i];
      try {
        var r2 = await fetch(WORKER_URL + '?action=getUserState', {
          method: 'POST', headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ token: token, email: u.email })
        });
        var s = await r2.json();
        var msgs = s.chat || [];
        if (msgs.length) {
          var last = msgs[msgs.length - 1];
          var unread = msgs.filter(function(m){ return m.from === 'client' && !m.read; }).length;
          chats.push({ email: u.email, name: u.name || u.email, lastTs: last.ts, lastText: last.text, lastFrom: last.from, unread: unread });
        }
      } catch(e) {}
    }
    chats.sort(function(a, b){ return b.lastTs - a.lastTs; });
    if (!chats.length) { box.innerHTML = '<div class="admin-empty">No chats yet</div>'; return; }
    var html = '';
    chats.forEach(function(c){
      html += '<div onclick="openAdminChat(\'' + c.email + '\')" style="padding:14px 16px;border-bottom:1px solid rgba(255,255,255,0.06);cursor:pointer;display:flex;justify-content:space-between;align-items:center;">' +
        '<div style="display:flex;gap:12px;align-items:center;">' +
          '<div style="width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,#7c3aed,#a855f7);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;">E</div>' +
          '<div>' +
            '<div style="color:#e7edf5;font-weight:600;font-size:14px;">' + escapeHtml(c.name) +
              (c.unread ? ' <span style="background:#ff3b3b;color:#fff;font-size:10px;padding:2px 6px;border-radius:10px;">' + c.unread + ' new</span>' : '') +
            '</div>' +
            '<div style="color:#8b95a5;font-size:12px;margin-top:2px;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' +
              (c.lastFrom === 'admin' ? 'You: ' : '') + escapeHtml(c.lastText) +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div style="color:#8b95a5;font-size:11px;">' + new Date(c.lastTs).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}) + '</div>' +
      '</div>';
    });
    box.innerHTML = html;
  } catch(e) { box.innerHTML = '<div class="admin-empty">Error: ' + e.message + '</div>'; }
}

async function openAdminChat(email) {
  if (typeof window.openAdminChatLive === 'function') { window.openAdminChatLive(email); return; }
  var old = document.getElementById('adminChatModal'); if (old) old.remove();
  var token = getSessionToken();
  var r = await fetch(WORKER_URL + '?action=getUserState', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ token: token, email: email })
  });
  var state = await r.json();
  var msgs = state.chat || [];
  var changed = false;
  msgs.forEach(function(m){ if (m.from === 'client' && !m.read) { m.read = true; changed = true; } });
  if (changed) {
    state.chat = msgs;
    await fetch(WORKER_URL + '?action=setUserState', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ token: token, email: email, state: state, force: true })
    });
  }
  var messagesHtml = msgs.map(function(m){
    var isAdmin = m.from === 'admin';
    return '<div style="display:flex;margin-bottom:10px;' + (isAdmin ? 'justify-content:flex-end;' : '') + '">' +
      '<div style="max-width:70%;padding:10px 14px;border-radius:16px;font-size:13px;line-height:1.45;' +
        (isAdmin ? 'background:linear-gradient(135deg,#5f2ee5,#8b5cf6);color:#fff;' : 'background:rgba(255,255,255,0.06);color:#e7edf5;') + '">' +
        escapeHtml(m.text) +
        '<div style="font-size:10px;opacity:0.6;margin-top:4px;">' + new Date(m.ts).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}) + '</div>' +
      '</div>' +
    '</div>';
  }).join('');
  if (!messagesHtml) messagesHtml = '<div style="text-align:center;color:#8b95a5;padding:30px;">No messages</div>';
  var modal = document.createElement('div');
  modal.id = 'adminChatModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:9999;padding:20px;';
  modal.innerHTML =
    '<div style="background:#0f1720;border:1px solid rgba(139,92,246,0.2);border-radius:20px;width:100%;max-width:520px;height:600px;display:flex;flex-direction:column;overflow:hidden;">' +
      '<div style="padding:16px 20px;border-bottom:1px solid rgba(255,255,255,0.06);display:flex;justify-content:space-between;align-items:center;">' +
        '<div style="color:#e7edf5;font-weight:700;font-size:14px;">' + email + '</div>' +
        '<div style="display:flex;gap:6px;">' +
          '<button onclick="endAdminChat(\'' + email + '\')" style="background:rgba(255,80,80,0.15);border:none;color:#ff6b6b;padding:6px 10px;border-radius:8px;font-size:12px;cursor:pointer;font-weight:600;">End chat</button>' +
          '<button onclick="document.getElementById(\'adminChatModal\').remove()" style="background:none;border:none;color:#8b95a5;font-size:24px;cursor:pointer;">×</button>' +
        '</div>' +
      '</div>' +
      '<div id="adminChatMsgs" style="flex:1;overflow-y:auto;padding:16px;">' + messagesHtml + '</div>' +
      '<div style="padding:12px 14px;border-top:1px solid rgba(255,255,255,0.06);display:flex;gap:8px;">' +
        '<input id="adminChatInput" placeholder="Reply..." style="flex:1;padding:11px 14px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:12px;color:#e7edf5;font-size:13px;outline:none;" oninput="_notifyAdminTyping(\'' + email + '\')" onkeydown="if(event.key===\'Enter\')sendAdminChatMsg(\'' + email + '\')">' +
        '<button onclick="sendAdminChatMsg(\'' + email + '\')" style="width:42px;height:42px;border-radius:12px;border:none;background:linear-gradient(135deg,#5f2ee5,#8b5cf6);color:#fff;cursor:pointer;">→</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(modal);
  var mb = document.getElementById('adminChatMsgs'); if (mb) mb.scrollTop = mb.scrollHeight;
}

async function sendAdminChatMsg(email) {
  var input = document.getElementById('adminChatInput');
  if (!input) return;
  var text = (input.value || '').trim();
  if (!text) return;
  input.value = '';

  var token = getSessionToken();
  if (!token) { alert('No session'); return; }

  try {
    var r = await fetch(WORKER_URL + '?action=getUserState', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token, email: email })
    });
    var state = await r.json();
    if (!state || state.error) { alert('Failed to load'); return; }

    if (!state.chat) state.chat = [];
    state.chat.push({
      id: 'msg_' + Date.now(),
      from: 'admin',
      text: text,
      ts: Date.now(),
      read: false
    });

    await fetch(WORKER_URL + '?action=setUserState', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token, email: email, state: state, force: true })
    });

    var modal = document.getElementById('adminChatModal');
    if (modal) modal.remove();
    openAdminChat(email);

  } catch(e) {
    console.error('[sendAdminChatMsg] error:', e);
  }
}

async function endAdminChat(email) {
  if (!email) return;
  if (!confirm('End chat with this client?\nAll messages with ' + email + ' will be deleted.')) return;

  try {
    var token = getSessionToken();
    if (!token) { alert('No session'); return; }

    var r = await fetch(WORKER_URL + '?action=getUserState', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ token: token, email: email })
    });
    var state = await r.json();
    if (!state || state.error) { alert('Failed to load client state'); return; }

    state.chat = [];
    state.ticket = null;
    if (state.typing) state.typing = {};

    var saveResp = await fetch(WORKER_URL + '?action=setUserState', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ token: token, email: email, state: state, force: true })
    });
    var saveRes = await saveResp.json();
    if (!saveRes || !saveRes.ok) {
      alert('Failed to save: ' + (saveRes.error || 'unknown'));
      return;
    }

    alert('✅ Chat closed for ' + email);

    var modal = document.getElementById('adminChatModal');
    if (modal) modal.remove();

    if (typeof loadAdminChats === 'function') loadAdminChats();

  } catch(e) {
    console.error('[endAdminChat] Error:', e);
    alert('Error: ' + e.message);
  }
}

async function clearAllChats() {
  if (!confirm('Clear ALL chats?')) return;
  if (!confirm('Are you ABSOLUTELY sure?')) return;
  try {
    var token = getSessionToken();
    if (!token) return;
    var r = await fetch(WORKER_URL + '?action=listUsers', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ token: token })
    });
    var d = await r.json();
    if (!d.ok || !d.users) return;
    var cleared = 0, failed = 0;
    for (var i = 0; i < d.users.length; i++) {
      var u = d.users[i];
      try {
        var r2 = await fetch(WORKER_URL + '?action=getUserState', {
          method: 'POST', headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ token: token, email: u.email })
        });
        var s = await r2.json();
        if (!s || s.error) { failed++; continue; }
        if (!s.chat || !s.chat.length) { if (!s.ticket) continue; }
        s.chat = [];
        s.ticket = null;
        var r3 = await fetch(WORKER_URL + '?action=setUserState', {
          method: 'POST', headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ token: token, email: u.email, state: s, force: true })
        });
        var res = await r3.json();
        if (res && res.ok) cleared++;
        else failed++;
      } catch(e) { failed++; }
    }
    alert('✅ Cleared: ' + cleared + '\nErrors: ' + failed);
    loadAdminChats();
  } catch(e) { alert('Error: ' + e.message); }
}

/* ========== ADMIN PANEL ========== */
function isAdmin() {
  var role = localStorage.getItem('user_role');
  var email = localStorage.getItem('user_email');
  return role === 'admin' && email === 'admin@nordiccrypto.com';
}

function showAdminPanel() {
  var panel = document.getElementById('adminPanel');
  if (panel) panel.classList.add('on');
  var side = document.getElementById('sideBar');
  var main = document.getElementById('mainApp');
  if (side) side.style.display = 'none';
  if (main) main.style.display = 'none';

  var userEl = document.getElementById('adminUser');
  if (userEl) userEl.textContent = localStorage.getItem('user_email') || '';

  initAdminPanel();

  Promise.all([
    loadAdminUsers(),
    loadAdminStats(),
    loadDeletedUsers()
  ]).catch(function(){});

  setTimeout(function(){ showAdminTab('stats'); }, 100);
}
function hideAdminPanel() {
  var panel = document.getElementById('adminPanel');
  if (panel) panel.classList.remove('on');
}

async function loadAdminUsers() {
  var listEl = document.getElementById('adminClientsList');
  if (!listEl) return;
  if (!listEl.querySelector('.admin-client-card')) {
    listEl.innerHTML = '<div class="admin-empty">Loading...</div>';
  }

  try {
    var res = await fetch(WORKER_LOGIN_URL + '?action=listUsers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: getSessionToken() })
    });
    var data = await res.json();
    if (!data.ok) {
      listEl.innerHTML = '<div class="admin-empty">Error: ' + (data.error || 'Failed') + '</div>';
      return;
    }
    if (!data.users || data.users.length === 0) {
      listEl.innerHTML = '<div class="admin-empty"><div style="font-size:2.5rem;opacity:.4;margin-bottom:12px">📭</div><div>No clients yet</div></div>';
      return;
    }

    var html = '';
    for (var i = 0; i < data.users.length; i++) {
      var u = data.users[i];
      var initials = (u.name || 'U').split(' ').map(function(n){return n[0];}).join('').slice(0,2).toUpperCase();
      var cardInfo = u.card ? (u.card.type + ' •••• ' + String(u.card.num).slice(-4)) : 'No card';
      var statusBadge = u.card ? u.card.status : 'No card';
      var statusClass = (u.card && u.card.status === 'Active') ? '' : ' style="background:rgba(255,176,32,.14);color:#ffb020"';

      html += '<div class="admin-client-card">' +
        '<div class="admin-client-top">' +
          '<div class="admin-client-avatar">' + initials + '</div>' +
          '<div class="admin-client-info">' +
            '<div class="admin-client-name">' + u.name + '</div>' +
            '<div class="admin-client-email">' + u.email + '</div>' +
          '</div>' +
          '<div class="admin-client-badge"' + statusClass + '>' + statusBadge + '</div>' +
        '</div>' +
        '<div class="admin-client-grid">' +
          '<div class="admin-client-field"><div class="admin-client-field-label">Balance</div><div class="admin-client-field-value">' + fmtCurrency(u.balance) + '</div></div>' +
          '<div class="admin-client-field"><div class="admin-client-field-label">Card</div><div class="admin-client-field-value">' + cardInfo + '</div></div>' +
          '<div class="admin-client-field"><div class="admin-client-field-label">Transactions</div><div class="admin-client-field-value">' + u.txCount + '</div></div>' +
          '<div class="admin-client-field"><div class="admin-client-field-label">Last Tx</div><div class="admin-client-field-value">' + (u.lastTx || '—') + '</div></div>' +
        '</div>' +
        '<div class="admin-client-actions">' +
          '<button class="btn b1" onclick="adminAddBalance(\'' + u.email + '\', \'' + u.name + '\')">💰 Add balance</button>' +
          '<button class="btn b2" onclick="adminSendMessage()">📩 Send message</button>' +
         '<button class="btn b2" onclick="adminSetCryptoAddress(\'' + u.email + '\', \'' + u.name + '\')">🔑 Deposit address</button>' +
         '<button class="btn b2" onclick="adminSetIban(\'' + u.email + '\')">🏦 Issue IBAN</button>' +
          '<button class="btn b2" onclick="adminViewClient(\'' + u.email + '\')">👁 View</button>' +
          '<button class="btn b3" onclick="adminDeleteUser(\'' + u.email + '\', \'' + u.name + '\')">🗑 Delete</button>' +
        '</div>' +
      '</div>';
    }
    listEl.innerHTML = html;

    var cnt = document.getElementById('navClientsCount');
    if (cnt) cnt.textContent = data.users.length;

  } catch (e) {
    listEl.innerHTML = '<div class="admin-empty">Connection error</div>';
  }
}

async function loadAdminWithdrawals() {
  var listEl  = document.getElementById('adminWithdrawalsList');
  var countEl = document.getElementById('adminWithdrawalsCount');
  if (!listEl) return;
  listEl.innerHTML = '<div class="admin-empty">Loading...</div>';
  if (countEl) countEl.textContent = 'Loading...';

  try {
    var token = getSessionToken();
    if (!token) { listEl.innerHTML = '<div class="admin-empty">No token</div>'; return; }

    var res = await fetch(WORKER_URL + '?action=listUsers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token })
    });
    var data = await res.json();
    if (!data.ok || !data.users) {
      listEl.innerHTML = '<div class="admin-empty">Failed to load users</div>';
      return;
    }

    var promises = data.users.map(function(u) {
      return fetch(WORKER_URL + '?action=getUserState', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token, email: u.email })
      })
      .then(function(r){ return r.json(); })
      .then(function(d2){
        if (!d2 || !Array.isArray(d2.withdrawals)) return [];
        return d2.withdrawals.map(function(w){
          if (!w) return null;
          w.userEmail = u.email;
          w.userName = u.name || u.email;
          return w;
        }).filter(Boolean);
      })
      .catch(function(){ return []; });
    });

    var results = await Promise.all(promises);
    var allWd = [];
    results.forEach(function(arr){ allWd = allWd.concat(arr); });

    allWd.sort(function(a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });

    var pending = allWd.filter(function(w) { return w.status === 'pending'; }).length;
    if (countEl) countEl.textContent = pending + ' pending • ' + allWd.length + ' total';

    if (!allWd.length) {
      listEl.innerHTML = '<div class="admin-empty">No withdrawal requests</div>';
      return;
    }

    var html = '';
    for (var k = 0; k < allWd.length; k++) {
      html += renderAdminWithdrawalCard(allWd[k]);
    }
    listEl.innerHTML = html;

  } catch (e) {
    console.error('[loadAdminWithdrawals] FAILED:', e);
    listEl.innerHTML = '<div class="admin-empty">Error: ' + e.message + '</div>';
  }
}

function renderAdminWithdrawalCard(w) {
  var statusMap = {
    'pending':  { cls: 'pend', txt: '⏳ Pending' },
    'approved': { cls: 'ok',   txt: '✅ Approved' },
    'rejected': { cls: 'fail', txt: '❌ Rejected' }
  };
  var s = statusMap[w.status] || statusMap['pending'];
  var d = w.details || {};
  var details = '';
  if (w.method === 'iban') {
    details = '<div class="awd-row"><span>Name</span><b>' + (d.name || '—') + '</b></div>' +
      '<div class="awd-row"><span>IBAN</span><b>' + (d.iban || '—') + '</b></div>' +
      '<div class="awd-row"><span>SWIFT</span><b>' + (d.swift || '—') + '</b></div>' +
      '<div class="awd-row"><span>Bank</span><b>' + (d.bank || '—') + '</b></div>';
  } else if (w.method === 'card') {
    details = '<div class="awd-row"><span>Holder</span><b>' + (d.cardName || '—') + '</b></div>' +
      '<div class="awd-row"><span>Card</span><b>' + (d.cardNumber || '—') + '</b></div>';
  } else if (w.method === 'crypto') {
    details = '<div class="awd-row"><span>Destination</span><b>' + (d.destination || '—') + '</b></div>' +
      '<div class="awd-row"><span>Network</span><b>' + (d.network || '—') + '</b></div>' +
      '<div class="awd-row"><span>Address</span><b>' + (d.address || '—') + '</b></div>';
  }
  var actions = '';
  if (w.status === 'pending') {
    actions = '<div class="awd-actions">' +
      '<button class="awd-btn awd-approve" onclick="adminApproveWithdrawal(\'' + w.userEmail + '\',\'' + w.id + '\')">✅ Approve</button>' +
      '<button class="awd-btn awd-reject" onclick="adminRejectWithdrawal(\'' + w.userEmail + '\',\'' + w.id + '\')">❌ Reject</button>' +
    '</div>';
  }
  return '<div class="awd-card">' +
    '<div class="awd-head">' +
      '<div><b>' + (w.userName || w.userEmail) + '</b><br><span class="awd-email">' + w.userEmail + '</span></div>' +
      '<div class="awd-badge ' + s.cls + '">' + s.txt + '</div>' +
    '</div>' +
    '<div class="awd-amount">' + fmtCurrency(w.amount) + ' <span class="awd-method">via ' + (w.method || 'iban').toUpperCase() + '</span></div>' +
    '<div class="awd-details">' + details + '</div>' +
    '<div class="awd-date">' + new Date(w.createdAt).toLocaleString('en-GB') + '</div>' +
    actions +
  '</div>';
}

async function adminApproveWithdrawal(email, wdId) {
  if (!confirm('Approve this withdrawal?')) return;
  try {
    var token = getSessionToken();
    if (!token) return;
    var r = await fetch(WORKER_URL + '?action=getUserState', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token, email: email })
    });
    var state = await r.json();
    if (!state || state.error) throw new Error('State not found');
    if (!state.withdrawals) state.withdrawals = [];
    var wd = state.withdrawals.find(function(w){ return w.id === wdId; });
    if (!wd) throw new Error('Not found');
    if (wd.status !== 'pending') throw new Error('Already ' + wd.status);
    if ((state.usd || 0) < wd.amount) { alert('Insufficient balance'); return; }
    state.usd = (state.usd || 0) - wd.amount;
    if (!state.txs) state.txs = [];
    state.txs.unshift({
      date: new Date().toISOString().slice(0, 10),
      ts: Date.now(),
      desc: 'Withdrawal — ' + (wd.method || 'iban').toUpperCase(),
      amt: -wd.amount,
      status: 'Completed'
    });
    wd.status = 'approved';
    wd.reviewedAt = Date.now();
    wd.reviewedBy = 'Compliance Department';
    if (!state.notifications) state.notifications = [];
    state.notifications.unshift({
      id: 'n_' + Date.now(), ts: Date.now(),
      text: '✅ Withdrawal approved — $' + wd.amount + '. Ref: ' + wd.id,
      read: false
    });
    await fetch(WORKER_URL + '?action=setUserState', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token, email: email, state: state, force: true })
    });
    alert('✅ Withdrawal approved');
    loadAdminWithdrawals();
  } catch (e) { alert('Error: ' + e.message); }
}

async function adminRejectWithdrawal(email, wdId) {
  var reasons = ['1. Insufficient KYC data','2. Suspicious activity (AML)','3. Bank details mismatch','4. Limit exceeded','5. Technical issue','6. Other'];
  var pick = prompt('Reason:\n\n' + reasons.join('\n') + '\n\nEnter 1-6:');
  if (pick === null) return;
  var reasonMap = {
    '1': 'Insufficient KYC data. Please complete verification.',
    '2': 'Suspicious activity detected (AML). Contact support.',
    '3': 'Bank details do not match account holder.',
    '4': 'Withdrawal limit exceeded. Try smaller amount.',
    '5': 'Temporary technical issue. Please try again.',
    '6': null
  };
  var reason = reasonMap[pick];
  if (reason === null || !reason) {
    reason = prompt('Enter reason manually:');
    if (!reason) return;
  }
  try {
    var token = getSessionToken();
    if (!token) return;
    var r = await fetch(WORKER_URL + '?action=getUserState', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token, email: email })
    });
    var state = await r.json();
    if (!state || state.error) throw new Error('State not found');
    if (!state.withdrawals) state.withdrawals = [];
    var wd = state.withdrawals.find(function(w){ return w.id === wdId; });
    if (!wd) throw new Error('Not found');
    if (wd.status !== 'pending') throw new Error('Already ' + wd.status);
    wd.status = 'rejected';
    wd.reason = reason;
    wd.reviewedAt = Date.now();
    wd.reviewedBy = 'Compliance Department';
    if (!state.notifications) state.notifications = [];
    state.notifications.unshift({
      id: 'n_' + Date.now(), ts: Date.now(),
      text: '❌ Withdrawal rejected — $' + wd.amount + '. Reason: ' + reason,
      read: false
    });
    await fetch(WORKER_URL + '?action=setUserState', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token, email: email, state: state, force: true })
    });
    alert('✅ Rejected. Client notified.');
    loadAdminWithdrawals();
  } catch (e) { alert('Error: ' + e.message); }
}

async function loadAdminStats() {
  try {
    var res = await fetch(WORKER_LOGIN_URL + '?action=getStats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: getSessionToken() })
    });
    var data = await res.json();
    if (!data.ok) return;
    var s = data.stats;
    var clientsEl = document.getElementById('admnStatClients');
    var balEl = document.getElementById('admnStatBalance');
    var txEl = document.getElementById('admnStatTx');
    var cryptoEl = document.getElementById('admnStatCrypto');
    if (clientsEl) clientsEl.textContent = s.totalClients;
    if (balEl) balEl.textContent = fmtCurrency(s.totalBalance);
    if (txEl) txEl.textContent = s.totalTx;
    if (cryptoEl) cryptoEl.textContent = (s.totalCrypto.btc.toFixed(4) + ' / ' + s.totalCrypto.eth.toFixed(4));
  } catch (e) {}
}

var adminTargetEmail = null;
var adminTargetName = null;

function adminAddBalance(email, name) {
  adminTargetEmail = email;
  adminTargetName = name;
  var mask = document.getElementById('adminBalanceMask');
  var desc = document.getElementById('adminBalanceDesc');
  var amtEl = document.getElementById('adminBalanceAmount');
  var noteEl = document.getElementById('adminBalanceNote');
  if (desc) desc.textContent = name + ' (' + email + ')';
  if (amtEl) amtEl.value = '';
  if (noteEl) noteEl.value = '';
  if (mask) mask.classList.add('on');
}

/* ========== ADMIN: SET CRYPTO ADDRESS ========== */
function adminSetCryptoAddress(email, name) {
  if (!email) return;
  
  var old = document.getElementById('adminCryptoAddrModal');
  if (old) old.remove();
  
  var modal = document.createElement('div');
  modal.id = 'adminCryptoAddrModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:9999;padding:20px;';
  modal.innerHTML =
    '<div style="background:#0f1720;border:1px solid rgba(139,92,246,0.2);border-radius:20px;width:100%;max-width:460px;padding:24px;">' +
      '<h3 style="color:#e7edf5;margin:0 0 4px;font-size:18px;">🔑 Set deposit address</h3>' +
      '<p style="color:#8b95a5;font-size:13px;margin:0 0 20px;">' + escapeHtml(name || email) + ' · ' + escapeHtml(email) + '</p>' +
      '<label style="display:block;color:#8b95a5;font-size:11px;text-transform:uppercase;letter-spacing:1px;margin:14px 0 6px;">BTC address</label>' +
      '<input id="adminBtcAddr" type="text" placeholder="19YWxuHf..." style="width:100%;padding:11px 14px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:10px;color:#e7edf5;font-size:13px;outline:none;box-sizing:border-box;font-family:monospace;">' +
      '<label style="display:block;color:#8b95a5;font-size:11px;text-transform:uppercase;letter-spacing:1px;margin:14px 0 6px;">ETH address</label>' +
      '<input id="adminEthAddr" type="text" placeholder="0xFB7A..." style="width:100%;padding:11px 14px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:10px;color:#e7edf5;font-size:13px;outline:none;box-sizing:border-box;font-family:monospace;">' +
      '<div id="adminAddrErr" style="display:none;margin-top:12px;padding:8px 12px;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:8px;color:#f87171;font-size:12px;"></div>' +
      '<div style="display:flex;gap:8px;margin-top:20px;">' +
        '<button onclick="adminSaveCryptoAddress(\'' + email + '\')" style="flex:1;padding:12px;background:linear-gradient(135deg,#5f2ee5,#8b5cf6);color:#fff;border:none;border-radius:10px;font-weight:600;cursor:pointer;font-size:14px;">Save</button>' +
        '<button onclick="document.getElementById(\'adminCryptoAddrModal\').remove()" style="flex:1;padding:12px;background:rgba(255,255,255,0.05);color:#8b95a5;border:none;border-radius:10px;font-weight:600;cursor:pointer;font-size:14px;">Cancel</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(modal);
  
  var token = getSessionToken();
  if (token) {
    fetch(WORKER_URL + '?action=getUserState', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token, email: email })
    })
    .then(function(r){ return r.json(); })
    .then(function(state){
      if (state && state.cryptoAddress) {
        var btcEl = document.getElementById('adminBtcAddr');
        var ethEl = document.getElementById('adminEthAddr');
        if (btcEl && state.cryptoAddress.btc) btcEl.value = state.cryptoAddress.btc;
        if (ethEl && state.cryptoAddress.eth) ethEl.value = state.cryptoAddress.eth;
      }
    })
    .catch(function(){});
  }
  
  setTimeout(function(){
    var btcEl = document.getElementById('adminBtcAddr');
    if (btcEl) btcEl.focus();
  }, 100);
}

async function adminSaveCryptoAddress(email) {
  var btc = (document.getElementById('adminBtcAddr') || {}).value || '';
  var eth = (document.getElementById('adminEthAddr') || {}).value || '';
  var errEl = document.getElementById('adminAddrErr');
  
  btc = btc.trim();
  eth = eth.trim();
  
  if (!btc && !eth) {
    if (errEl) { errEl.textContent = 'Enter at least one address'; errEl.style.display = 'block'; }
    return;
  }
  
  if (btc && !/^(1|3|bc1)[a-zA-Z0-9]{25,62}$/.test(btc)) {
    if (errEl) { errEl.textContent = 'Invalid BTC address'; errEl.style.display = 'block'; }
    return;
  }
  if (eth && !/^0x[a-fA-F0-9]{40}$/.test(eth)) {
    if (errEl) { errEl.textContent = 'Invalid ETH address (0x + 40 hex chars)'; errEl.style.display = 'block'; }
    return;
  }
  
  if (errEl) errEl.style.display = 'none';
  
  try {
    var token = getSessionToken();
    if (!token) { alert('No session'); return; }
    
    var r = await fetch(WORKER_URL + '?action=setCryptoAddress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token, email: email, btc: btc || null, eth: eth || null })
    });
    var data = await r.json();
    
    if (data.ok) {
      toast('✓ Deposit address saved');
      var modal = document.getElementById('adminCryptoAddrModal');
      if (modal) modal.remove();
      if (typeof loadAdminUsers === 'function') loadAdminUsers();
    } else {
      if (errEl) { errEl.textContent = data.error || 'Save failed'; errEl.style.display = 'block'; }
    }
  } catch (e) {
    if (errEl) { errEl.textContent = 'Connection error'; errEl.style.display = 'block'; }
  }
}


function adminDeleteUser(email, name) {
  if (!email) return;
  if (!confirm('Delete user: ' + name + '?')) return;
  fetch(WORKER_LOGIN_URL + '?action=deleteUser', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: getSessionToken(), email: email, permanent: false })
  })
    .then(function(r){ return r.json(); })
    .then(function(data){
      if (data.ok) {
        toast('✓ User moved to Deleted');
        loadAdminUsers();
        loadAdminStats();
        loadDeletedUsers();
      } else { toast('Error: ' + (data.error || 'failed'), true); }
    })
    .catch(function(){ toast('Connection error', true); });
}

function adminRestoreUser(email) {
  if (!confirm('Restore user ' + email + '?')) return;
  fetch(WORKER_LOGIN_URL + '?action=restoreUser', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: getSessionToken(), email: email })
  })
    .then(function(r){ return r.json(); })
    .then(function(data){
      if (data.ok) {
        toast('✓ User restored');
        loadAdminUsers();
        loadAdminStats();
        loadDeletedUsers();
      } else { toast('Error', true); }
    })
    .catch(function(){ toast('Connection error', true); });
}

function adminPermanentDelete(email, name) {
  if (!confirm('PERMANENTLY delete ' + name + '?')) return;
  if (!confirm('Are you ABSOLUTELY sure?')) return;
  fetch(WORKER_LOGIN_URL + '?action=deleteUser', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: getSessionToken(), email: email, permanent: true })
  })
    .then(function(r){ return r.json(); })
    .then(function(data){
      if (data.ok) {
        toast('✓ User deleted');
        loadAdminUsers();
        loadAdminStats();
        loadDeletedUsers();
      } else { toast('Error', true); }
    })
    .catch(function(){ toast('Connection error', true); });
}

async function loadDeletedUsers() {
  var listEl = document.getElementById('adminDeletedList');
  if (!listEl) return;
  try {
    var res = await fetch(WORKER_LOGIN_URL + '?action=listDeletedUsers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: getSessionToken() })
    });
    var data = await res.json();
    if (!data.ok || !data.users || data.users.length === 0) {
      listEl.innerHTML = '<div class="admin-empty">No deleted accounts</div>';
      return;
    }
    var html = '';
    for (var i = 0; i < data.users.length; i++) {
      var u = data.users[i];
      var date = new Date(u.deletedAt).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });
      html += '<div class="admin-client-card" style="opacity:.75">' +
        '<div class="admin-client-top">' +
          '<div class="admin-client-avatar" style="background:linear-gradient(135deg,#ff5470,#7c3aed)">🗑</div>' +
          '<div class="admin-client-info">' +
            '<div class="admin-client-name">' + u.name + '</div>' +
            '<div class="admin-client-email">' + u.email + '</div>' +
            '<div style="font-size:.72rem;color:var(--mut);margin-top:4px">Deleted: ' + date + '</div>' +
          '</div>' +
          '<div class="admin-client-badge" style="background:rgba(255,84,112,.14);color:#ff5470">DELETED</div>' +
        '</div>' +
        '<div class="admin-client-actions">' +
          '<button class="btn b1" onclick="adminRestoreUser(\'' + u.email + '\')">♻ Restore</button>' +
          '<button class="btn b3" onclick="adminPermanentDelete(\'' + u.email + '\', \'' + u.name + '\')">🗑 Delete forever</button>' +
        '</div>' +
      '</div>';
    }
    listEl.innerHTML = html;
  } catch (e) { listEl.innerHTML = '<div class="admin-empty">Connection error</div>'; }
}

function adminSendMessage() {
  var mask = document.getElementById('adminMsgMask');
  var textEl = document.getElementById('adminMsgText');
  var iconEl = document.getElementById('adminMsgIcon');
  if (textEl) textEl.value = '';
  if (iconEl) iconEl.value = '📩';
  if (mask) mask.classList.add('on');
}

function adminViewClient(email) {
  window.adminOriginalEmail = localStorage.getItem('user_email');
  window.adminOriginalRole = localStorage.getItem('user_role');
  window.adminViewingEmail = email;
  localStorage.setItem('user_email', email);
  localStorage.setItem('user_role', 'user');
  st = JSON.parse(JSON.stringify(def));
  stateLoaded = false;

  hideAdminPanel();
  var side = document.getElementById('sideBar');
  var main = document.getElementById('mainApp');
  if (side) side.style.display = 'flex';
  if (main) main.style.display = 'flex';

  var backBar = document.getElementById('adminBackBar');
  if (!backBar) {
    backBar = document.createElement('div');
    backBar.id = 'adminBackBar';
    backBar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:8000;background:linear-gradient(90deg,#7c3aed,#a855f7);padding:10px 20px;display:flex;justify-content:space-between;align-items:center;font-weight:700;font-size:.85rem;color:#fff';
    backBar.innerHTML = '<span>👁 Viewing as Admin — ' + (email || '') + '</span>' +
      '<button onclick="backToAdmin()" style="background:#fff;color:#7c3aed;border:none;padding:8px 16px;border-radius:8px;font-weight:700;cursor:pointer;font-family:inherit">← Back to Admin</button>';
    document.body.appendChild(backBar);
  } else {
    backBar.querySelector('span').textContent = '👁 Viewing as Admin — ' + (email || '');
  }
  backBar.style.display = 'flex';

  loadFromServer(function(){
    if (!st.usd || st.usd < 100) {
      fetch(WORKER_LOGIN_URL + '?action=listUsers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: getSessionToken() })
      })
      .then(function(r){ return r.json(); })
      .then(function(d){
        if (d && d.ok && d.users) {
          for (var i = 0; i < d.users.length; i++) {
            if (d.users[i].email === email) {
              st.usd = d.users[i].balance || 0;
              st.currency = d.users[i].currency || 'USD';
              st.btc = d.users[i].btc || 0;
              st.eth = d.users[i].eth || 0;
              st.card = d.users[i].card || null;
              if (!st.txs) st.txs = [];
              render();
              break;
            }
          }
        }
      });
    }
    loadPrices();
    loadExchangeRates();
    initCurrencySwitcher();
    initNotifications();
    renderNotifications();
    initSoundButton();
    initVerification();
    initDesignPicker();
    startIbanGeneration();
    initRecentTx();
    initTrackingActions();
    initDepositVerification();
    initWelcomeBanner();
    initSettings();

    var onboardEl = document.getElementById('onboard');
    if (onboardEl) onboardEl.classList.remove('on');

    var pgs = document.querySelectorAll('.pg');
    for (var j = 0; j < pgs.length; j++) pgs[j].classList.remove('on');
    var dash = document.getElementById('dash');
    if (dash) dash.classList.add('on');
    var ms = document.querySelectorAll('.mi');
    for (var k = 0; k < ms.length; k++) ms[k].classList.remove('on');
    var dashMi = document.querySelector('.mi[data-p="dash"]');
    if (dashMi) dashMi.classList.add('on');
    var ttl = document.getElementById('ttl');
    if (ttl) ttl.textContent = 'Dashboard';
  }, email);
}

function backToAdmin() {
  var side = document.getElementById('sideBar');
  var main = document.getElementById('mainApp');
  if (side) side.style.display = 'none';
  if (main) main.style.display = 'none';
  var backBar = document.getElementById('adminBackBar');
  if (backBar) backBar.style.display = 'none';

  if (window.adminOriginalEmail) {
    localStorage.setItem('user_email', window.adminOriginalEmail);
    localStorage.setItem('user_role', window.adminOriginalRole || 'admin');
    window.adminOriginalEmail = null;
    window.adminOriginalRole = null;
    window.adminViewingEmail = null;
  }
  st = JSON.parse(JSON.stringify(def));
  stateLoaded = false;
  showAdminPanel();
}

function initAdminPanel() {
  var refreshBtn    = document.getElementById('adminRefreshBtn');
  var logoutBtn     = document.getElementById('adminLogoutBtn');
  var pushUpdateBtn = document.getElementById('adminPushUpdate');
  var sendNotifBtn  = document.getElementById('adminSendNotif');
  var balanceSave   = document.getElementById('adminBalanceSave');
  var balanceCancel = document.getElementById('adminBalanceCancel');
  var msgSave       = document.getElementById('adminMsgSave');
  var msgCancel     = document.getElementById('adminMsgCancel');
  var refreshDeleted= document.getElementById('adminRefreshDeleted');

  if (refreshBtn) refreshBtn.onclick = function(){ loadAdminUsers(); loadAdminStats(); toast('Refreshed'); };
  if (refreshDeleted) refreshDeleted.onclick = function(){ loadDeletedUsers(); toast('Refreshed'); };
  if (logoutBtn) logoutBtn.onclick = function(){ if (confirm('Log out?')) doLogout(); };
  if (pushUpdateBtn) pushUpdateBtn.onclick = function(){
    toast('📢 Notified client');
    sendAdminMessage('🎉 New version 1.1 available!', '📢');
  };
  if (sendNotifBtn) sendNotifBtn.onclick = adminSendMessage;
  if (balanceCancel) balanceCancel.onclick = function(){ document.getElementById('adminBalanceMask').classList.remove('on'); };
  if (msgCancel) msgCancel.onclick = function(){ document.getElementById('adminMsgMask').classList.remove('on'); };

  if (balanceSave) balanceSave.onclick = async function(){
    var amount = Number(document.getElementById('adminBalanceAmount').value);
    var note   = document.getElementById('adminBalanceNote').value.trim();
    var typeEl = document.getElementById('adminBalanceType');
    var type   = typeEl ? typeEl.value : 'bonus';
    if (!amount || amount === 0) { toast('Enter valid amount', true); return; }
    var meta = {
      'bonus': { icon: '🎁', label: 'Bonus' },
      'bank': { icon: '🏦', label: 'Bank deposit' },
      'crypto': { icon: '₿', label: 'Crypto deposit' },
      'card': { icon: '💳', label: 'Card deposit' },
      'correction': { icon: '🔧', label: 'Correction' }
    };
    var m = meta[type] || meta['bonus'];
    try {
      var token = getSessionToken();
      var r = await fetch(WORKER_LOGIN_URL + '?action=updateUserBalance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token, email: adminTargetEmail, amount: amount, note: note || m.label })
      });
      var data = await r.json();
      if (!data.ok) { toast('Error: ' + (data.error || 'Failed'), true); return; }
      try {
        await fetch(WORKER_LOGIN_URL + '?action=sendMessage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: token, email: adminTargetEmail, text: m.icon + ' ' + m.label + ': +' + amount + ' USD', icon: m.icon })
        });
      } catch(e) {}
      toast('✓ Balance updated');
      document.getElementById('adminBalanceMask').classList.remove('on');
      loadAdminUsers();
      loadAdminStats();
    } catch (e) { toast('Connection error', true); }
  };

  if (msgSave) msgSave.onclick = async function(){
    var text = document.getElementById('adminMsgText').value.trim();
    var icon = document.getElementById('adminMsgIcon').value.trim() || '📩';
    if (!text) { toast('Enter message', true); return; }
    try {
      var res = await fetch(WORKER_LOGIN_URL + '?action=sendMessage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: getSessionToken(), email: adminTargetEmail, text: text, icon: icon })
      });
      var data = await res.json();
      if (data.ok) {
        toast('✓ Message sent');
        document.getElementById('adminMsgMask').classList.remove('on');
      } else { toast('Error', true); }
    } catch (e) { toast('Connection error', true); }
  };
}

async function sendAdminMessage(text, icon) {
  try {
    await fetch(WORKER_LOGIN_URL + '?action=sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: getSessionToken(), text: text, icon: icon || '📩' })
    });
  } catch (e) {}
}

/* ========== ADMIN TABS ========== */
function showAdminTab(tab) {
  document.querySelectorAll('.admin-nav-item').forEach(function(el){
    el.classList.toggle('active', el.getAttribute('data-tab') === tab);
  });
  document.querySelectorAll('.admin-section').forEach(function(el){
    el.classList.toggle('active', el.getAttribute('data-section') === tab);
  });
  if (tab === 'chats' && typeof loadAdminChats === 'function') loadAdminChats();
  if (tab === 'withdrawals' && typeof loadAdminWithdrawals === 'function') loadAdminWithdrawals();
  if (tab === 'clients' && typeof loadAdminUsers === 'function') loadAdminUsers();
  if (tab === 'deleted' && typeof loadDeletedUsers === 'function') loadDeletedUsers();
  localStorage.setItem('adminTab', tab);
}

function filterClients(query) {
  var q = (query || '').toLowerCase().trim();
  var cards = document.querySelectorAll('#adminClientsList .admin-client-card');
  cards.forEach(function(card){
    var text = (card.textContent || '').toLowerCase();
    card.style.display = (!q || text.indexOf(q) > -1) ? '' : 'none';
  });
}

async function updateAdminBadges(){
  try {
    var token = getSessionToken();
    if (!token) return;

    var r = await fetch(WORKER_URL + '?action=listUsers', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({token: token})
    });
    var d = await r.json();

    if (d.ok && d.users) {
      var cnt = document.getElementById('navClientsCount');
      if (cnt) cnt.textContent = d.users.length;

      var promises = d.users.map(function(u) {
        return fetch(WORKER_URL + '?action=getUserState', {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({token: token, email: u.email})
        })
        .then(function(r2){ return r2.json(); })
        .then(function(s){
          if (!s || !Array.isArray(s.withdrawals)) return {wdPending: 0, chatUnread: 0};
          var wdPending = s.withdrawals.filter(function(w){ return w.status === 'pending'; }).length;
          var chatUnread = (s.chat || []).filter(function(m){ return m.from === 'client' && !m.read; }).length;
          return {wdPending: wdPending, chatUnread: chatUnread};
        })
        .catch(function(){ return {wdPending: 0, chatUnread: 0}; });
      });

      var results = await Promise.all(promises);
      var totalWd = 0;
      var totalChats = 0;
      results.forEach(function(res){
        totalWd += res.wdPending;
        totalChats += res.chatUnread;
      });

      var wdsEl = document.getElementById('navWdsCount');
      if (wdsEl) {
        if (totalWd > 0) { wdsEl.textContent = totalWd; wdsEl.style.display = 'inline-block'; }
        else { wdsEl.style.display = 'none'; }
      }

      var chatsEl = document.getElementById('navChatsCount');
      if (chatsEl) {
        if (totalChats > 0) { chatsEl.textContent = totalChats; chatsEl.style.display = 'inline-block'; }
        else { chatsEl.style.display = 'none'; }
      }
    }
  } catch(e) {}
}

/* ========== INIT ========== */
initLoginLogout();
initSignup();
initPasswordConfirm();
initCountryCurrencyLink();
initVerification();
initCardActions();
initEvents();
initOnboarding();
initNav();

checkSession();

setTimeout(function(){
  var ctx = getAudioCtx();
  if (ctx && ctx.state === 'suspended') ctx.resume();
}, 500);

setInterval(function(){
  var ctx = getAudioCtx();
  if (ctx && ctx.state === 'suspended') ctx.resume();
}, 30000);

document.addEventListener('DOMContentLoaded', function(){
  var btn = document.getElementById('chatToggle');
  if (btn) btn.onclick = toggleChat;
  updateChatBadge();

  var saved = localStorage.getItem('adminTab') || 'stats';
  if (document.querySelector('.admin-nav-item')) {
    setTimeout(function(){ showAdminTab(saved); }, 300);
  }
});

setInterval(function(){
  if (document.querySelector('.admin-nav-item')) updateAdminBadges();
}, 60000);

/* ========== CARD DELETE ANIMATION ========== */
(function(){
  document.addEventListener('DOMContentLoaded', function(){
    var deleteBtn = document.getElementById('btnDeleteCard');
    if (deleteBtn){
      var origClick = deleteBtn.onclick;
      deleteBtn.onclick = function(e){
        var cardFull = document.getElementById('cardFull');
        var cardDash = document.getElementById('cardDash');
        if (cardFull) cardFull.classList.add('card-deleting');
        if (cardDash) cardDash.classList.add('card-deleting');
        if (typeof playTone === 'function'){
          playTone(220, 0.5, 'sine', 0.25);
          setTimeout(function(){ playTone(110, 0.6, 'sine', 0.2); }, 150);
        }
        setTimeout(function(){
          if (origClick) origClick.call(deleteBtn, e);
          if (cardFull) cardFull.classList.remove('card-deleting');
          if (cardDash) cardDash.classList.remove('card-deleting');
        }, 700);
      };
    }
  });
})();

/* ========== UPDATE USER UI ========== */
function updateUserUI(){
  var name = localStorage.getItem('user_name') || '';
  if (!name || name === 'User'){
    var em = localStorage.getItem('user_email') || '';
    if (em){
      var derived = em.split('@')[0];
      name = derived.charAt(0).toUpperCase() + derived.slice(1);
      localStorage.setItem('user_name', name);
    } else {
      name = 'User';
    }
  }
  var parts = name.trim().split(' ');
  var initials = parts.map(function(p){ return p.charAt(0); }).join('').slice(0, 2).toUpperCase();

  var nameEl = document.getElementById('userName');
  if (nameEl) nameEl.textContent = name;
  var avEl = document.getElementById('userAvatar');
  if (avEl) avEl.textContent = initials;

  var sName = document.getElementById('settingsName');
  if (sName) sName.textContent = name;
  var sEmail = document.getElementById('settingsEmail');
  if (sEmail) sEmail.textContent = localStorage.getItem('user_email') || '—';
  var sRole = document.getElementById('settingsRole');
  if (sRole){
    var role = localStorage.getItem('user_role') || 'user';
    sRole.textContent = role.charAt(0).toUpperCase() + role.slice(1);
  }
}

document.addEventListener('DOMContentLoaded', updateUserUI);
setInterval(updateUserUI, 5000);

/* ========== ADMIN: WITHDRAWALS AUTO-REFRESH ========== */
(function(){
  var intervalId = null;
  var lastCount = 0;

  function startWithdrawalsPolling(){
    if (intervalId) return;
    intervalId = setInterval(async function(){
      var panel = document.getElementById('adminPanel');
      if (!panel || !panel.classList.contains('on')) return;

      var section = document.querySelector('.admin-section[data-section="withdrawals"]');
      if (!section || !section.classList.contains('active')) return;

      if (window._wdLoading) return;
      window._wdLoading = true;

      try {
        var token = getSessionToken();
        if (!token) { window._wdLoading = false; return; }

        var res = await fetch(WORKER_URL + '?action=listUsers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: token })
        });
        var data = await res.json();
        if (!data.ok || !data.users) { window._wdLoading = false; return; }

        var promises = data.users.map(function(u) {
          return fetch(WORKER_URL + '?action=getUserState', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: token, email: u.email })
          })
          .then(function(r){ return r.json(); })
          .then(function(d2){
            if (!d2 || !Array.isArray(d2.withdrawals)) return [];
            return d2.withdrawals.map(function(w){
              if (!w) return null;
              w.userEmail = u.email;
              w.userName = u.name || u.email;
              return w;
            }).filter(Boolean);
          })
          .catch(function(){ return []; });
        });

        var results = await Promise.all(promises);
        var allWd = [];
        results.forEach(function(arr){ allWd = allWd.concat(arr); });
        allWd.sort(function(a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });

        var pending = allWd.filter(function(w) { return w.status === 'pending'; }).length;

        if (allWd.length !== lastCount) {
          lastCount = allWd.length;
          renderWithdrawalsList(allWd, pending);
          if (pending > 0 && typeof playTone === 'function') {
            playTone(660, 0.1, 'sine', 0.25);
            setTimeout(function(){ playTone(880, 0.15, 'sine', 0.2); }, 120);
          }
        }
      } catch(e) {}
      window._wdLoading = false;
    }, 8000);
  }

  function renderWithdrawalsList(allWd, pending){
    var listEl  = document.getElementById('adminWithdrawalsList');
    var countEl = document.getElementById('adminWithdrawalsCount');
    if (countEl) countEl.textContent = pending + ' pending • ' + allWd.length + ' total';

    if (!allWd.length) {
      if (listEl) listEl.innerHTML = '<div class="admin-empty">No withdrawal requests</div>';
      return;
    }

    var html = '';
    for (var k = 0; k < allWd.length; k++) {
      html += renderAdminWithdrawalCard(allWd[k]);
    }
    if (listEl) listEl.innerHTML = html;

    var badge = document.getElementById('navWdsCount');
    if (badge){
      if (pending > 0){
        badge.textContent = pending;
        badge.style.display = 'inline-block';
      } else {
        badge.style.display = 'none';
      }
    }
  }

  document.addEventListener('DOMContentLoaded', function(){
    setTimeout(startWithdrawalsPolling, 2000);
  });

  window.startWithdrawalsPolling = startWithdrawalsPolling;
})();

/* ============================================================
   LIVE CHAT V2 — авто-обновление + typing indicator
   ============================================================ */

// ========== CLIENT POLLING (каждые 1 сек) ==========
(function(){
  var _lastAdminTyping = null;
  var _lastChatHash = '';

  setInterval(async function(){
    var token = getSessionToken();
    if (!token) return;

    var targetEmail = window.adminViewingEmail || localStorage.getItem('user_email');
    if (!targetEmail) return;

    try {
      var r = await fetch(WORKER_URL + '?action=getUserState', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token, email: targetEmail })
      });
      var fresh = await r.json();
      if (!fresh || !fresh.chat) return;

      var prevLen = (st.chat || []).length;
      var newLen = fresh.chat.length;
      st.chat = fresh.chat;

      var adminTyping = false;
      if (fresh.typing && fresh.typing.admin === true) {
        var age = Date.now() - (fresh.typing.adminTs || 0);
        adminTyping = age < 3000;
      }
      window._adminTyping = adminTyping;

      // ★ ОБНОВЛЯЕМ BADGE — всегда, даже если чат закрыт
      if (typeof updateChatBadge === 'function') updateChatBadge();

      // ★ ЕСЛИ ПРИШЛО НОВОЕ СООБЩЕНИЕ ОТ АДМИНА — уведомление + звук
      if (newLen > prevLen) {
        var newMsgs = fresh.chat.slice(prevLen);
        var fromAdmin = newMsgs.some(function(m){ return m.from === 'admin'; });
        if (fromAdmin) {
          // Звук
          if (typeof playChatSound === 'function') playChatSound();
          // Всплывающая нотификация в панели (если у клиента есть система notif)
          var lastAdmin = newMsgs.filter(function(m){ return m.from === 'admin'; }).slice(-1)[0];
          if (lastAdmin && typeof addNotification === 'function') {
            addNotification('New message from Elena', '💬');
          }
        }
      }

      // ★ Рендер сообщений — только если чат открыт
      var panel = document.getElementById('chatPanel');
      var isOpen = panel && panel.style.display === 'flex';
      if (isOpen) {
        var chatHash = newLen + '_' + (fresh.chat[newLen-1] ? fresh.chat[newLen-1].id : '') + '_' + (adminTyping ? 1 : 0);
        if (chatHash !== _lastChatHash) {
          _lastChatHash = chatHash;
          if (typeof window.renderChatMessages === 'function') {
            window.renderChatMessages();
          } else if (typeof renderChatMessages === 'function') {
            renderChatMessages();
          }
        }
      }
    } catch(e) {}
  }, 1000);
})();

// ========== CLIENT TYPING NOTIFY ==========
(function(){
  var timer = null;
  function notifyTyping(){
    var token = getSessionToken();
    var email = window.adminViewingEmail || localStorage.getItem('user_email');
    if (!token || !email) return;
    if (timer) return;
    timer = setTimeout(function(){ timer = null; }, 2000);

    fetch(WORKER_URL + '?action=setTyping', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token, email: email, who: 'client', typing: true })
    }).catch(function(){});
  }

  document.addEventListener('DOMContentLoaded', function(){
    var input = document.getElementById('chatInput');
    if (input) input.addEventListener('input', notifyTyping);
  });
})();

// ========== ADMIN MODAL AUTO-REFRESH ==========
(function(){
  window._adminPollTimer = null;

  window.openAdminChatLive = async function(email){
    var old = document.getElementById('adminChatModal'); if (old) old.remove();
    var token = getSessionToken();
    window._currentAdminChatEmail = email;

    var r = await fetch(WORKER_URL + '?action=getUserState', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ token: token, email: email })
    });
    var state = await r.json();
    var msgs = state.chat || [];
    var typing = state.typing || {};

    _buildAdminModal(email, msgs, typing);

    if (window._adminPollTimer) clearInterval(window._adminPollTimer);
    window._adminPollTimer = setInterval(function(){
      _refreshAdminChat(email);
    }, 1000);
  };

  window._closeAdminModal = function(){
    var m = document.getElementById('adminChatModal');
    if (m) m.remove();
    if (window._adminPollTimer) { clearInterval(window._adminPollTimer); window._adminPollTimer = null; }
  };

  async function _refreshAdminChat(email){
    var token = getSessionToken();
    if (!token) return;
    try {
      var r = await fetch(WORKER_URL + '?action=getUserState', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ token: token, email: email })
      });
      var state = await r.json();
      if (!state) return;

      var msgs = state.chat || [];
      var typing = state.typing || {};

      var box = document.getElementById('adminChatMsgs');
      if (!box) { _closeAdminModal(); return; }

      var newHtml = _buildMsgs(msgs, typing);
      if (box.dataset.hash !== newHtml.length + '_' + msgs.length) {
        box.dataset.hash = newHtml.length + '_' + msgs.length;
        var atBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 20;
        box.innerHTML = newHtml;
        if (atBottom) box.scrollTop = box.scrollHeight;
      }
    } catch(e) {}
  }

  function _buildMsgs(msgs, typing){
    var html = '';
    msgs.forEach(function(m){
      var isAdmin = m.from === 'admin';
      html += '<div style="display:flex;margin-bottom:10px;' + (isAdmin ? 'justify-content:flex-end;' : '') + '">' +
        '<div style="max-width:70%;padding:10px 14px;border-radius:16px;font-size:13px;line-height:1.45;' +
          (isAdmin ? 'background:linear-gradient(135deg,#5f2ee5,#8b5cf6);color:#fff;' : 'background:rgba(255,255,255,0.06);color:#e7edf5;') + '">' +
          escapeHtml(m.text) +
          '<div style="font-size:10px;opacity:0.6;margin-top:4px;">' + new Date(m.ts).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}) + '</div>' +
        '</div>' +
      '</div>';
    });
    if (typing && typing.client === true){
      html += '<div style="display:flex;margin-bottom:10px;"><div style="padding:10px 14px;background:rgba(255,255,255,0.06);color:#e7edf5;border-radius:16px;font-size:13px;">' +
        '<span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span>' +
      '</div></div>';
    }
    if (!html) html = '<div style="text-align:center;color:#8b95a5;padding:30px;">No messages</div>';
    return html;
  }

  function _buildAdminModal(email, msgs, typing){
    var messagesHtml = _buildMsgs(msgs, typing);
    var modal = document.createElement('div');
    modal.id = 'adminChatModal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:9999;padding:20px;';
    modal.innerHTML =
      '<div style="background:#0f1720;border:1px solid rgba(139,92,246,0.2);border-radius:20px;width:100%;max-width:520px;height:600px;display:flex;flex-direction:column;overflow:hidden;">' +
        '<div style="padding:16px 20px;border-bottom:1px solid rgba(255,255,255,0.06);display:flex;justify-content:space-between;align-items:center;">' +
          '<div style="color:#e7edf5;font-weight:700;font-size:14px;">' + email + '</div>' +
          '<div style="display:flex;gap:6px;">' +
            '<button onclick="endAdminChat(\'' + email + '\')" style="background:rgba(255,80,80,0.15);border:none;color:#ff6b6b;padding:6px 10px;border-radius:8px;font-size:12px;cursor:pointer;font-weight:600;">End chat</button>' +
            '<button onclick="_closeAdminModal()" style="background:none;border:none;color:#8b95a5;font-size:24px;cursor:pointer;">×</button>' +
          '</div>' +
        '</div>' +
        '<div id="adminChatMsgs" data-hash="" style="flex:1;overflow-y:auto;padding:16px;">' + messagesHtml + '</div>' +
        '<div style="padding:12px 14px;border-top:1px solid rgba(255,255,255,0.06);display:flex;gap:8px;">' +
          '<input id="adminChatInput" placeholder="Reply..." style="flex:1;padding:11px 14px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:12px;color:#e7edf5;font-size:13px;outline:none;" onkeydown="if(event.key===\'Enter\')sendAdminChatMsg(\'' + email + '\')" oninput="_notifyAdminTyping(\'' + email + '\')">' +
          '<button onclick="sendAdminChatMsg(\'' + email + '\')" style="width:42px;height:42px;border-radius:12px;border:none;background:linear-gradient(135deg,#5f2ee5,#8b5cf6);color:#fff;cursor:pointer;">→</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(modal);
    var mb = document.getElementById('adminChatMsgs'); if (mb) mb.scrollTop = mb.scrollHeight;
  }

 var _admTimer = null;
var _admStopTimer = null;

window._notifyAdminTyping = function(email){
  var token = getSessionToken();
  if (!token) return;

  // Сброс "печатает" через 2.5 сек после последнего ввода
  clearTimeout(_admStopTimer);
  _admStopTimer = setTimeout(function(){
    fetch(WORKER_URL + '?action=setTyping', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token, email: email, who: 'admin', typing: false })
    }).catch(function(){});
  }, 2500);

  // Отправляем "печатает" не чаще раз в 2 сек
  if (_admTimer) return;
  _admTimer = setTimeout(function(){ _admTimer = null; }, 2000);

  fetch(WORKER_URL + '?action=setTyping', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: token, email: email, who: 'admin', typing: true })
  }).catch(function(){});
};
})();

/* ========== MERGE CONSECUTIVE MESSAGES ========== */
(function(){
  window.renderChatMessages = function(){
    var box = document.getElementById('chatMessages');
    if (!box) return;
    var chat = (st.chat || []).slice().sort(function(a,b){ return a.ts - b.ts; });

    var html = '';
    if (!chat.length){
      html = '<div class="chat-welcome">' +
        '<div class="chat-welcome-name">Elena Bergström</div>' +
        '<div class="chat-welcome-text">Hi! How can I help you today?</div>' +
      '</div>';
    } else {
      var prevFrom = null;
      var prevTs = 0;

      chat.forEach(function(m){
        var isClient = m.from === 'client';
        var sameAuthor = (prevFrom === m.from) && (m.ts - prevTs < 60000);

        var metaHtml = sameAuthor ? '' :
          '<div class="chat-msg-meta">' +
            (isClient ? 'You' : 'Elena') + ' • ' +
            new Date(m.ts).toLocaleTimeString('en-GB', {hour:'2-digit', minute:'2-digit'}) +
          '</div>';

        html += '<div class="chat-msg ' + (isClient ? 'client' : 'admin') + (sameAuthor ? ' same-author' : '') + '">' +
          '<div>' +
            '<div class="chat-bubble">' + escapeHtml(m.text) + '</div>' +
            metaHtml +
          '</div>' +
        '</div>';

        prevFrom = m.from;
        prevTs = m.ts;
      });
    }

    if (window._adminTyping){
      html += '<div class="chat-msg admin chat-typing">' +
        '<div>' +
          '<div class="chat-bubble">' +
            '<span class="typing-dot"></span>' +
            '<span class="typing-dot"></span>' +
            '<span class="typing-dot"></span>' +
          '</div>' +
          '<div class="chat-msg-meta">Elena is typing...</div>' +
        '</div>' +
      '</div>';
    }

    box.innerHTML = html;
    box.scrollTop = box.scrollHeight;
  };
})();

/* ========== SCAN ALL DEPOSITS (ручная проверка всех tx) ========== */
async function scanAllDeposits() {
  var email = (window.adminViewingEmail || localStorage.getItem('user_email') || '').toLowerCase();
  if (!email) { toast('Not logged in', true); return; }

  toast('Scanning blockchain…', false);

  try {
    var r = await fetch(WORKER_URL + '?action=check&email=' + encodeURIComponent(email) + '&_t=' + Date.now());
    var data = await r.json();
    if (!data || !data.ok || !data.result) {
      toast('Scan failed — try again', true);
      return;
    }

    var btcList = data.result.btc || [];
    var ethList = data.result.eth || [];
    var allTxs = [];

    btcList.forEach(function(tx) { tx._type = 'BTC'; allTxs.push(tx); });
    ethList.forEach(function(tx) { tx._type = 'ETH'; allTxs.push(tx); });

    if (allTxs.length === 0) {
      toast('No new deposits found', false);
      return;
    }

    // Фильтруем уже зачисленные
    var knownHashes = {};
    (st.txs || []).forEach(function(t) { if (t.hash) knownHashes[t.hash] = true; });
    // Учитываем и depositVerifications
    (st.depositVerifications || []).forEach(function(d) { if (d.txHash) knownHashes[d.txHash] = true; });

    var newTxs = allTxs.filter(function(tx) { return !knownHashes[tx.hash]; });

    if (newTxs.length === 0) {
      toast('All deposits already credited ✓', false);
      return;
    }

      // Build confirmation message
    var msg = 'Found ' + newTxs.length + ' new deposit' + (newTxs.length > 1 ? 's' : '') + ':\n\n';
    newTxs.forEach(function(tx, i) {
      var usd = tx.amount * (tx._type === 'BTC' ? st.btcP : st.ethP);
      msg += (i + 1) + '. ' + tx.amount.toFixed(8) + ' ' + tx._type + ' ≈ ' + fmtCurrency(usd) + '\n';
    });
    msg += '\nCredit all deposits?';

    if (!confirm(msg)) return;

    // Зачисляем все
    var totalUsd = 0;
    var totalBtc = 0;
    var totalEth = 0;

    newTxs.forEach(function(tx) {
      var price = tx._type === 'BTC' ? st.btcP : st.ethP;
      var credit = tx.amount * price;
      totalUsd += credit;
      if (tx._type === 'BTC') { st.btc += tx.amount; totalBtc += tx.amount; }
      else { st.eth += tx.amount; totalEth += tx.amount; }

      st.txs.unshift({
        date: now(),
        ts: tx.time ? tx.time * 1000 : Date.now(),
        desc: 'Crypto deposit — ' + tx.amount.toFixed(8) + ' ' + tx._type + ' (' + tx.hash.slice(0, 10) + '…)',
        amt: credit,
        status: 'Completed',
        hash: tx.hash,
        crypto: tx.amount,
        symbol: tx._type,
        verification: { source: 'manual_scan', origin: 'auto', confirmedAt: Date.now() }
      });

      if (!st.depositVerifications) st.depositVerifications = [];
      st.depositVerifications.push({
        txHash: tx.hash,
        cryptoAmt: tx.amount,
        symbol: tx._type,
        usdValue: credit,
        source: 'manual_scan',
        origin: 'auto',
        completedAt: Date.now()
      });
    });

    st.usd += totalUsd;

    saveToServer();
    render();

        addNotification('Credited ' + newTxs.length + ' deposit' + (newTxs.length > 1 ? 's' : '') + ': +' + fmtCurrency(totalUsd), '✅');
    playChime();
    spawnConfetti();

    toast('✓ Credited: +' + fmtCurrency(totalUsd), false);
        setTimeout(function() {
      alert('✅ Credited ' + newTxs.length + ' transaction' + (newTxs.length > 1 ? 's' : '') + '\n\n' +
        (totalBtc > 0 ? 'BTC: +' + totalBtc.toFixed(8) + '\n' : '') +
        (totalEth > 0 ? 'ETH: +' + totalEth.toFixed(8) + '\n' : '') +
        '\nTotal: +' + fmtCurrency(totalUsd));
    }, 400);

  } catch (e) {
    console.error('[scanAllDeposits]', e);
    toast('Scan error: ' + e.message, true);
  }
}
/* ============================================================
   ПАТЧ КРИТИЧНЫХ БАГОВ — вставлено в конец app.js
   Перезаписывает проблемные функции при загрузке
   ============================================================ */
(function(){
  'use strict';
  console.log('[patch] применение фиксов...');

  /* ---------- FIX #1: refreshBalanceFromServer — не теряем чат ---------- */
  window.refreshBalanceFromServer = function(){
    if (localStorage.getItem('user_role') === 'admin' && !window.adminViewingEmail) return;
    var token = getSessionToken();
    if (!token) return;
    var email = window.adminViewingEmail || localStorage.getItem('user_email');
    if (!email) return;

    fetch(WORKER_URL + '?action=getUserState', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token, email: window.adminViewingEmail || undefined })
    })
    .then(function(r){ return r.json(); })
    .then(function(d){
      if (!d || d.ok === false) return;
      var newUsd = Number(d.usd) || 0;
      var changed = false;
      if (Math.abs(newUsd - (st.usd || 0)) > 0.01) { st.usd = newUsd; changed = true; }
      if (d.currency) st.currency = d.currency;
      if (d.card !== undefined) st.card = d.card;
      if (d.txs) st.txs = d.txs;
      if (d.notifications) st.notifications = d.notifications;
      if (d.user) st.user = d.user;
      if (d.balanceHistory) st.balanceHistory = d.balanceHistory;
      if (d.withdrawals) st.withdrawals = d.withdrawals;
      if (d.chat) st.chat = d.chat;
      if (d.ticket !== undefined) st.ticket = d.ticket;
      if (d.cryptoAddress) st.cryptoAddress = d.cryptoAddress;
      if (d.typing) st.typing = d.typing;
      if (d.depositVerifications) st.depositVerifications = d.depositVerifications;
      if (changed) render();
      if (typeof updateChatBadge === 'function') updateChatBadge();
    })
    .catch(function(){});
  };

  /* ---------- FIX #2: playTone — звук после resume ---------- */
  window.playTone = function(freq, duration, type, volume){
    var ctx = getAudioCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended'){
      ctx.resume().then(function(){
        window.playTone(freq, duration, type, volume);
      }).catch(function(){});
      return;
    }
    try {
      var now = ctx.currentTime;
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = type || 'sine';
      osc.frequency.value = freq;
      var vol = Math.min(volume || 0.3, 1);
      gain.gain.value = vol;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + duration);
    } catch(e){}
  };

  /* ---------- FIX #3: loadFromServer — сброс чата ---------- */
  window.loadFromServer = function(cb, targetEmail){
    var token = getSessionToken();
    if (!token) {
      st = JSON.parse(JSON.stringify(def));
      stateLoaded = true;
      if (cb) cb();
      return;
    }
    var body = { token: token };
    if (targetEmail) body.email = targetEmail;

    fetch(WORKER_URL + '?action=getUserState', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
      .then(function(r){ return r.json(); })
      .then(function(data){
        if (data && data.ok === false) {
          st = JSON.parse(JSON.stringify(def));
        } else {
          st = data || JSON.parse(JSON.stringify(def));
        }
        if (!st.txs) st.txs = [];
        if (!st.balanceHistory) st.balanceHistory = [];
        if (!st.withdrawals) st.withdrawals = [];
        if (!st.card || typeof st.card !== 'object') st.card = null;
        if (!st.chat) st.chat = [];
        if (!st.ticket) st.ticket = null;
        if (!st.typing) st.typing = {};
        if (!st.cryptoAddress) st.cryptoAddress = null;
        stateLoaded = true;

        var form = document.getElementById('chatTicketForm');
        var conv = document.getElementById('chatConversation');
        if (form) form.style.display = 'flex';
        if (conv) conv.style.display = 'none';
        var emailEl = document.getElementById('tkEmail');
        if (emailEl) emailEl.value = targetEmail || localStorage.getItem('user_email') || '';
        var topicEl = document.getElementById('chatTicketTopic');
        if (topicEl) topicEl.textContent = 'Support';

        render();
        if (typeof updateChatBadge === 'function') updateChatBadge();
        if (cb) cb();
      })
      .catch(function(){
        st = JSON.parse(JSON.stringify(def));
        stateLoaded = true;
        render();
      });
  };

  /* ---------- FIX #4: saveToServer — защита от админ-записи ---------- */
  window.saveToServer = function(){
    if (!stateLoaded) return;
    if (window.adminViewingEmail) return;
    if (localStorage.getItem('user_role') === 'admin') return;
    var token = getSessionToken();
    if (!token) return;
    fetch(WORKER_URL + '?action=setUserState', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: token,
        state: st,
        email: window.adminViewingEmail || undefined
      })
    }).catch(function(){});
  };

  /* ---------- FIX #5: markChatRead — merge ---------- */
  window.markChatRead = async function(){
    var token = getSessionToken();
    var email = window.adminViewingEmail || localStorage.getItem('user_email');
    if (!token || !email) return;
    try {
      var r = await fetch(WORKER_URL + '?action=getUserState', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ token: token, email: email })
      });
      var fresh = await r.json();
      if (!fresh || !fresh.chat) return;

      var seenIds = {};
      (st.chat || []).forEach(function(m){ seenIds[m.id] = true; });
      var changed = false;
      fresh.chat.forEach(function(m){
        if (m.from === 'admin' && seenIds[m.id] && !m.read) {
          m.read = true;
          changed = true;
        }
      });
      st.chat = fresh.chat;
      if (!changed) { if (typeof updateChatBadge === 'function') updateChatBadge(); return; }

      await fetch(WORKER_URL + '?action=setUserState', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ token: token, email: email, state: st, force: true })
      });
      if (typeof updateChatBadge === 'function') updateChatBadge();
      window._lastReadAt = Date.now();
    } catch(e) {}
  };

  /* ---------- FIX #6: finalizeDeposit — защита от дублей ---------- */
  window.finalizeDeposit = function(){
    if (!depPendingTx) return;
    var tx = depPendingTx.tx;
    var cryptoAmt = depPendingTx.cryptoAmt;
    var symbol = depPendingTx.symbol;
    var credit = depPendingTx.usdValue;

    if (!tx || !tx.hash) {
      console.error('[finalizeDeposit] missing tx or hash', depPendingTx);
      toast('Deposit error — contact support', true);
      return;
    }

    var isDup = false;
    (st.txs || []).forEach(function(t){ if (t.hash === tx.hash) isDup = true; });
    (st.depositVerifications || []).forEach(function(d){ if (d.txHash === tx.hash) isDup = true; });
    if (isDup) {
      console.warn('[finalizeDeposit] duplicate tx', tx.hash);
      toast('Deposit already credited', true);
      if (typeof closeDepositVerification === 'function') closeDepositVerification();
      return;
    }

    st.usd += credit;
    if (symbol === 'BTC') st.btc += cryptoAmt;
    else if (symbol === 'ETH') st.eth += cryptoAmt;

    if (!Array.isArray(st.txs)) st.txs = [];

    st.txs.unshift({
      date: now(),
      ts: Date.now(),
      desc: 'Crypto deposit — ' + Number(cryptoAmt).toFixed(8) + ' ' + symbol + ' (' + tx.hash.slice(0, 10) + '…)',
      amt: credit,
      status: 'Processing',
      hash: tx.hash,
      crypto: cryptoAmt,
      symbol: symbol,
      verification: { source: depAnswers.source, origin: depAnswers.origin, confirmedAt: Date.now() }
    });

    if (!st.depositVerifications) st.depositVerifications = [];
    st.depositVerifications.push({
      txHash: tx.hash,
      cryptoAmt: cryptoAmt,
      symbol: symbol,
      usdValue: credit,
      source: depAnswers.source,
      origin: depAnswers.origin,
      completedAt: Date.now()
    });

    if (!st.welcomeBonusUsed){
      st.usd += 5;
      st.txs.unshift({ date: now(), ts: Date.now(), desc: 'Welcome bonus', amt: 5, status: 'Completed' });
      st.welcomeBonusUsed = true;
      addNotification('Welcome bonus: +$5 credited!', '🎁');
      setTimeout(function(){ toast('🎁 Welcome bonus: +$5!'); }, 800);
    }

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
  };

  /* ---------- FIX #7: renderBalanceChart — стабильный расчёт ---------- */
  window.renderBalanceChart = function(){
    var wrap    = document.getElementById('balanceChart');
    var wrap2   = document.getElementById('balanceChartSecondary');
    var current = document.getElementById('balanceCurrent');
    if (!wrap && !wrap2) return;
    if (current) current.textContent = fmtCurrency(st.usd);

    var txs = st.txs || [];
    var created = (st.card && st.card.createdAt) ? st.card.createdAt : Date.now();

    if (txs.length < 1){
      var emptyHtml = '<div class="chart-empty"><div style="font-size:2rem;opacity:.4">📊</div><div>No activity yet</div><div style="font-size:.72rem;opacity:.7">Chart will appear after first transaction</div></div>';
      if (wrap)  wrap.innerHTML  = emptyHtml;
      if (wrap2) wrap2.innerHTML = emptyHtml;
      return;
    }

    var days = 7;
    var dayMs = 24 * 60 * 60 * 1000;
    var nowT = Date.now();
    var sorted = txs.slice().sort(function(a, b){ return (a.ts || 0) - (b.ts || 0); });
    var points = [];

    var balanceHistory = st.balanceHistory || [];
    if (balanceHistory.length > 2) {
      balanceHistory.forEach(function(p) { points.push({ t: p.t, v: p.v }); });
      points.push({ t: Date.now(), v: st.usd });
    } else {
      for (var d = 0; d <= days; d++) {
        var dayT = nowT - (days - d) * dayMs;
        var totalAtDay = 0;
        for (var j = 0; j < sorted.length; j++) {
          var txT = sorted[j].ts || created;
          if (txT <= dayT) {
            totalAtDay += (sorted[j].amt || 0);
          }
        }
        points.push({ t: dayT, v: totalAtDay });
      }
      points.push({ t: nowT, v: st.usd });
    }

    var w = 500, h = 180, pad = 50;
    var minT, maxT;
    var histForRange = st.balanceHistory || [];
    if (histForRange.length > 2) {
      minT = histForRange[0].t;
      maxT = Date.now();
      var minSpan = 5 * 60 * 1000;
      if (maxT - minT < minSpan) minT = maxT - minSpan;
    } else {
      minT = nowT - days * dayMs;
      maxT = nowT;
    }

    var minV = Infinity, maxV = -Infinity;
    for (var k = 0; k < points.length; k++){
      if (points[k].v < minV) minV = points[k].v;
      if (points[k].v > maxV) maxV = points[k].v;
    }
    if (!isFinite(minV) || !isFinite(maxV)) { minV = 0; maxV = 1; }
    if (maxV === minV) maxV = minV + 1;
    var padV = (maxV - minV) * 0.15 || 1;
    minV = minV - padV;
    maxV = maxV + padV;

    var svgPoints = [];
    for (var m = 0; m < points.length; m++){
      var p = points[m];
      var x = pad + ((p.t - minT) / (maxT - minT)) * (w - pad * 2);
      var y = pad + (1 - (p.v - minV) / (maxV - minV)) * (h - pad * 2);
      if (x < pad) x = pad;
      if (x > w - pad) x = w - pad;
      svgPoints.push(x.toFixed(1) + ',' + y.toFixed(1));
    }

    function smoothPath(pts) {
      if (pts.length < 2) return 'M' + pts.join(' ');
      var d = 'M' + pts[0];
      for (var i = 0; i < pts.length - 1; i++) {
        var p0 = i === 0 ? pts[0].split(',') : pts[i - 1].split(',');
        var p1 = pts[i].split(',');
        var p2 = pts[i + 1].split(',');
        var p3 = i + 2 < pts.length ? pts[i + 2].split(',') : pts[i + 1].split(',');
        var x0 = parseFloat(p0[0]), y0 = parseFloat(p0[1]);
        var x1 = parseFloat(p1[0]), y1 = parseFloat(p1[1]);
        var x2 = parseFloat(p2[0]), y2 = parseFloat(p2[1]);
        var x3 = parseFloat(p3[0]), y3 = parseFloat(p3[1]);
        var cp1x = x1 + (x2 - x0) / 6;
        var cp1y = y1 + (y2 - y0) / 6;
        var cp2x = x2 - (x3 - x1) / 6;
        var cp2y = y2 - (y3 - y1) / 6;
        d += ' C' + cp1x.toFixed(1) + ',' + cp1y.toFixed(1) + ' ' + cp2x.toFixed(1) + ',' + cp2y.toFixed(1) + ' ' + x2 + ',' + y2;
      }
      return d;
    }

    var linePath = smoothPath(svgPoints);
    var fillPath = linePath + ' L' + (w - pad) + ',' + (h - pad) + ' L' + pad + ',' + (h - pad) + ' Z';

    var lastCoord = svgPoints[svgPoints.length - 1].split(',');
    var pulseCircle = '<circle cx="' + lastCoord[0] + '" cy="' + lastCoord[1] + '" r="5" fill="#47dcff">' +
      '<animate attributeName="r" values="5;8;5" dur="2s" repeatCount="indefinite"/>' +
    '</circle>';

    var svg = '<svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none">' +
      '<defs>' +
        '<linearGradient id="balanceGrad" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0%" stop-color="#00d4ff" stop-opacity="0.55"/>' +
          '<stop offset="100%" stop-color="#00d4ff" stop-opacity="0.02"/>' +
        '</linearGradient>' +
        '<linearGradient id="lineGrad" x1="0" y1="0" x2="1" y2="0">' +
          '<stop offset="0%" stop-color="#00d4ff"/>' +
          '<stop offset="100%" stop-color="#a855f7"/>' +
        '</linearGradient>' +
      '</defs>' +
      '<path d="' + fillPath + '" fill="url(#balanceGrad)"/>' +
      '<path d="' + linePath + '" fill="none" stroke="url(#lineGrad)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>' +
      pulseCircle +
    '</svg>';

    if (wrap)  wrap.innerHTML  = svg;
    if (wrap2) wrap2.innerHTML = svg;
  };

  /* ---------- FIX #8: startInactivityTimer — без утечки ---------- */
  var _inactivityHandler = null;
  window.startInactivityTimer = function(){
    clearTimeout(sessionTimer);
    if (_inactivityHandler) {
      ['click', 'keydown', 'scroll', 'mousemove', 'touchstart'].forEach(function(evt){
        document.removeEventListener(evt, _inactivityHandler);
      });
    }
    _inactivityHandler = function(){ resetInactivityTimer(); };
    sessionTimer = setTimeout(showInactivityModal, SESSION_TIMEOUT_MS);
    ['click', 'keydown', 'scroll', 'mousemove', 'touchstart'].forEach(function(evt){
      document.addEventListener(evt, _inactivityHandler, { passive: true });
    });
  };

  /* ---------- FIX #9: showAdminPanel — сразу бейджи ---------- */
  window.showAdminPanel = function(){
    var panel = document.getElementById('adminPanel');
    if (panel) panel.classList.add('on');
    var side = document.getElementById('sideBar');
    var main = document.getElementById('mainApp');
    if (side) side.style.display = 'none';
    if (main) main.style.display = 'none';

    var userEl = document.getElementById('adminUser');
    if (userEl) userEl.textContent = localStorage.getItem('user_email') || '';

    initAdminPanel();

    Promise.all([
      loadAdminUsers(),
      loadAdminStats(),
      loadDeletedUsers()
    ]).catch(function(){});

    if (typeof updateAdminBadges === 'function') {
      setTimeout(updateAdminBadges, 500);
    }

    setTimeout(function(){ showAdminTab('stats'); }, 100);
  };

  /* ---------- FIX #10: scanAllDeposits — проверка tx.to ---------- */
  window.scanAllDeposits = async function(){
    var email = (window.adminViewingEmail || localStorage.getItem('user_email') || '').toLowerCase();
    if (!email) { toast('Not logged in', true); return; }

    toast('Scanning blockchain…', false);

    try {
      var r = await fetch(WORKER_URL + '?action=check&email=' + encodeURIComponent(email) + '&_t=' + Date.now());
      var data = await r.json();
      if (!data || !data.ok || !data.result) {
        toast('Scan failed — try again', true);
        return;
      }

      var btcList = data.result.btc || [];
      var ethList = data.result.eth || [];
      var allTxs = [];

      var myBtc = getDepositWallet('BTC');
      var myEth = getDepositWallet('ETH');

      btcList.forEach(function(tx) {
        if (tx.to && myBtc && tx.to.toLowerCase() !== myBtc.toLowerCase()) return;
        tx._type = 'BTC'; allTxs.push(tx);
      });
      ethList.forEach(function(tx) {
        if (tx.to && myEth && tx.to.toLowerCase() !== myEth.toLowerCase()) return;
        tx._type = 'ETH'; allTxs.push(tx);
      });

      if (allTxs.length === 0) {
        toast('No new deposits found', false);
        return;
      }

      var knownHashes = {};
      (st.txs || []).forEach(function(t) { if (t.hash) knownHashes[t.hash] = true; });
      (st.depositVerifications || []).forEach(function(d) { if (d.txHash) knownHashes[d.txHash] = true; });

      var newTxs = allTxs.filter(function(tx) { return !knownHashes[tx.hash]; });

      if (newTxs.length === 0) {
        toast('All deposits already credited ✓', false);
        return;
      }

      var msg = 'Found ' + newTxs.length + ' new deposit' + (newTxs.length > 1 ? 's' : '') + ':\n\n';
      newTxs.forEach(function(tx, i) {
        var usd = tx.amount * (tx._type === 'BTC' ? st.btcP : st.ethP);
        msg += (i + 1) + '. ' + tx.amount.toFixed(8) + ' ' + tx._type + ' ≈ ' + fmtCurrency(usd) + '\n';
      });
      msg += '\nCredit all deposits?';

      if (!confirm(msg)) return;

      var totalUsd = 0;
      var totalBtc = 0;
      var totalEth = 0;

      newTxs.forEach(function(tx) {
        var price = tx._type === 'BTC' ? st.btcP : st.ethP;
        var credit = tx.amount * price;
        totalUsd += credit;
        if (tx._type === 'BTC') { st.btc += tx.amount; totalBtc += tx.amount; }
        else { st.eth += tx.amount; totalEth += tx.amount; }

        st.txs.unshift({
          date: now(),
          ts: tx.time ? tx.time * 1000 : Date.now(),
          desc: 'Crypto deposit — ' + tx.amount.toFixed(8) + ' ' + tx._type + ' (' + tx.hash.slice(0, 10) + '…)',
          amt: credit,
          status: 'Completed',
          hash: tx.hash,
          crypto: tx.amount,
          symbol: tx._type,
          verification: { source: 'manual_scan', origin: 'auto', confirmedAt: Date.now() }
        });

        if (!st.depositVerifications) st.depositVerifications = [];
        st.depositVerifications.push({
          txHash: tx.hash,
          cryptoAmt: tx.amount,
          symbol: tx._type,
          usdValue: credit,
          source: 'manual_scan',
          origin: 'auto',
          completedAt: Date.now()
        });
      });

      st.usd += totalUsd;

      saveToServer();
      render();

      addNotification('Credited ' + newTxs.length + ' deposit' + (newTxs.length > 1 ? 's' : '') + ': +' + fmtCurrency(totalUsd), '✅');
      playChime();
      spawnConfetti();

      toast('✓ Credited: +' + fmtCurrency(totalUsd), false);
      setTimeout(function() {
        alert('✅ Credited ' + newTxs.length + ' transaction' + (newTxs.length > 1 ? 's' : '') + '\n\n' +
          (totalBtc > 0 ? 'BTC: +' + totalBtc.toFixed(8) + '\n' : '') +
          (totalEth > 0 ? 'ETH: +' + totalEth.toFixed(8) + '\n' : '') +
          '\nTotal: +' + fmtCurrency(totalUsd));
      }, 400);

    } catch (e) {
      console.error('[scanAllDeposits]', e);
      toast('Scan error: ' + e.message, true);
    }
  };

  console.log('[patch] ✅ Все фиксы применены');
   })();
/* ============================================================
   PREMIUM UI FINAL — единственный рабочий патч
   Кручение при hover + ripple + красиво, БЕЗ ломки layout
   ============================================================ */
(function(){
  'use strict';

  /* ---------- Удаляем все старые стили, чтобы не конфликтовали ---------- */
  ['icon-spin-style','premium-ui-style','premium-ui-style-v4',
   'premium-ui-style-v5','premium-ui-style-v6','premium-ui-style-v7',
   'premium-ui-final'].forEach(function(id){
    var el = document.getElementById(id);
    if (el) el.remove();
  });

  /* ============================================================
     CSS
     ============================================================ */
  var style = document.createElement('style');
  style.id = 'premium-final';
  style.textContent = `
    /* ИКОНКИ ВНУТРИ КНОПОК */
    .btn svg,
    .btn i,
    .btn img,
    .btn .icon,
    .btn .btn-icon,
    .nc3-ghost svg,
    .nc3-primary svg,
    .nc3-action svg,
    .nc3-card-action svg,
    .mi svg,
    .mi i,
    .mi .mi-icon,
    .nc3-copy-iban svg,
    .top-icon svg,
    .settings-btn svg,
    .notif-bell svg {
      transition: transform .3s ease;
      transform-origin: center center;
      display: inline-block;
      will-change: transform;
    }

    @keyframes spin360 {
      0%   { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }

    /* ★★★ КРУЧЕНИЕ ПРИ HOVER ★★★ */
    .btn:hover svg,
    .btn:hover i,
    .btn:hover img,
    .btn:hover .icon,
    .btn:hover .btn-icon,
    .nc3-ghost:hover svg,
    .nc3-primary:hover svg,
    .nc3-action:hover svg,
    .nc3-card-action:hover svg,
    .mi:hover svg,
    .mi:hover i,
    .mi:hover .mi-icon,
    .nc3-copy-iban:hover svg,
    .top-icon:hover svg,
    .settings-btn:hover svg {
      animation: spin360 .8s cubic-bezier(.4,0,.2,1);
    }

    /* data-no-spin отключает */
    .btn[data-no-spin="true"]:hover svg,
    .btn[data-no-spin="true"]:hover i,
    .btn[data-no-spin="true"]:hover .icon {
      animation: none;
    }

    /* Свечение кнопки БЕЗ движения */
    .btn, .nc3-ghost, .nc3-primary, .nc3-action, .nc3-card-action {
      transition: box-shadow .3s ease, background .25s ease;
    }
    .btn:hover, .nc3-ghost:hover, .nc3-primary:hover {
      box-shadow: 0 10px 24px rgba(0,212,255,.22),
                  inset 0 0 0 1px rgba(0,212,255,.20);
    }
    .nc3-action:hover, .nc3-card-action:hover {
      box-shadow: 0 10px 24px rgba(0,212,255,.15);
      background: rgba(0,212,255,.06);
    }

    /* Панели — свечение */
    .panel {
      transition: box-shadow .35s ease, border-color .3s ease;
    }
    .panel:hover {
      box-shadow: 0 14px 32px rgba(0,212,255,.10),
                  0 4px 14px rgba(0,0,0,.32);
      border-color: rgba(0,212,255,.22);
    }

    /* Stat-карточки — подъём */
    .stat-card, .crypto-card, .nc3-asset {
      transition: transform .3s ease, box-shadow .3s ease, border-color .3s ease;
    }
    .stat-card:hover, .crypto-card:hover, .nc3-asset:hover {
      transform: translateY(-2px);
      box-shadow: 0 12px 26px rgba(0,212,255,.10),
                  0 4px 12px rgba(0,0,0,.32);
      border-color: rgba(0,212,255,.22);
    }

    /* Карта — ТОЛЬКО свечение */
    .pay {
      transition: box-shadow .4s ease;
    }
    .pay:hover {
      box-shadow: 0 22px 46px rgba(0,212,255,.22),
                  0 8px 22px rgba(0,0,0,.42);
    }

    /* Меню слева */
    .mi {
      transition: transform .25s ease, background .25s ease;
    }
    .mi:hover {
      transform: translateX(3px);
      background: rgba(0,212,255,.06);
    }

    /* Транзакции */
    .recent-tx-item {
      transition: transform .25s ease, background .25s ease, border-color .25s ease;
    }
    .recent-tx-item:hover {
      transform: translateX(4px);
      background: rgba(0,212,255,.05);
      border-color: rgba(0,212,255,.20);
    }

    /* Уведомления */
    .notif-item {
      transition: transform .25s ease, background .25s ease;
    }
    .notif-item:hover {
      transform: translateX(3px);
      background: rgba(0,212,255,.05);
    }

    /* Админ-карточки */
    .admin-client-card {
      transition: transform .3s ease, box-shadow .3s ease;
    }
    .admin-client-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 14px 30px rgba(139,92,246,.15);
    }

    /* Баланс — пульс */
    @keyframes balanceGlow {
      0%   { text-shadow: 0 0 0 rgba(0,212,255,0); }
      50%  { text-shadow: 0 0 26px rgba(0,212,255,.75); }
      100% { text-shadow: 0 0 0 rgba(0,212,255,0); }
    }
    .balance-updating {
      animation: balanceGlow 1s ease;
      display: inline-block;
    }

    /* Busy — ТОЛЬКО opacity (без scale!) */
    @keyframes softPulse {
      0%, 100% { opacity: 1; }
      50%      { opacity: .7; }
    }
    .btn-busy {
      animation: softPulse 1.1s ease-in-out infinite;
      pointer-events: none;
    }

    /* Ripple */
    .btn, .nc3-action, .nc3-card-action { position: relative; overflow: hidden; }
    .ripple-fx {
      position: absolute;
      border-radius: 50%;
      background: rgba(255,255,255,.35);
      transform: scale(0);
      animation: rippleAnim .6s cubic-bezier(.4,0,.2,1) forwards;
      pointer-events: none;
      z-index: 1;
    }
    @keyframes rippleAnim {
      to { transform: scale(4); opacity: 0; }
    }

    /* Заголовок — shimmer */
    @keyframes shimmer {
      to { background-position: -200% center; }
    }
    #ttl {
      background: linear-gradient(90deg,
        #e7edf5 0%, #e7edf5 30%, #00d4ff 50%,
        #e7edf5 70%, #e7edf5 100%);
      background-size: 200% auto;
      -webkit-background-clip: text;
      background-clip: text;
      -webkit-text-fill-color: transparent;
      animation: shimmer 6s linear infinite;
    }

    /* Скроллбар */
    ::-webkit-scrollbar { width: 8px; height: 8px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb {
      background: rgba(0,212,255,.18);
      border-radius: 4px;
      transition: background .3s;
    }
    ::-webkit-scrollbar-thumb:hover {
      background: rgba(0,212,255,.42);
    }
  `;
  document.head.appendChild(style);

  /* ============================================================
     JS: Ripple + Refresh
     ============================================================ */
  function findIcon(el){
    if (!el) return null;
    return el.querySelector('svg, i.icon, i.btn-icon, img.icon, .btn-icon, .icon');
  }

  function playClickSound(){
    if (typeof playTone !== 'function') return;
    try { playTone(880, 0.05, 'sine', 0.08); } catch(e){}
  }

  function addRipple(el, e){
    var rect = el.getBoundingClientRect();
    var size = Math.max(rect.width, rect.height);
    var x = e ? (e.clientX - rect.left - size / 2) : (rect.width / 2 - size / 2);
    var y = e ? (e.clientY - rect.top - size / 2) : (rect.height / 2 - size / 2);

    var ripple = document.createElement('span');
    ripple.className = 'ripple-fx';
    ripple.style.width = ripple.style.height = size + 'px';
    ripple.style.left = x + 'px';
    ripple.style.top = y + 'px';

    el.appendChild(ripple);
    setTimeout(function(){ if (ripple.parentNode) ripple.remove(); }, 700);
  }

  var ACTION_IDS = [
    'btnRefreshBalance','btnWithdrawV2','btnAdd','btnTransferV2',
    'btnExchangeV2','btnScanDeposits','btnCopyIban','btnCopyCardV2',
    'btnReceiveHero','btnReceiveMoney','btnOrder',
    'btnShowCvv','btnFreeze','btnDeleteCard','btnGoOrder',
    'btnFreezeCard','btnLimitsCard','btnSettingsCard'
  ];

  function attachActions(){
    ACTION_IDS.forEach(function(id){
      var el = document.getElementById(id);
      if (!el || el._finalPatched) return;
      el._finalPatched = true;

      el.addEventListener('click', function(e){
        playClickSound();
        if (!findIcon(el)) addRipple(el, e);

        if (id === 'btnRefreshBalance'){
          el.classList.add('btn-busy');
          setTimeout(function(){ el.classList.remove('btn-busy'); }, 1200);

          var bal = document.getElementById('bal');
          if (bal){
            bal.classList.remove('balance-updating');
            void bal.offsetWidth;
            bal.classList.add('balance-updating');
            setTimeout(function(){ bal.classList.remove('balance-updating'); }, 1000);
          }

          if (typeof refreshBalanceFromServer === 'function'){
            refreshBalanceFromServer();
          }
        }
      }, true);
    });
  }

  function attachRipple(){
    document.querySelectorAll('.btn, .nc3-action, .nc3-card-action, .nc3-ghost, .nc3-primary').forEach(function(el){
      if (el._rippleFinalPatched) return;
      el._rippleFinalPatched = true;
      el.addEventListener('click', function(e){
        if (findIcon(el)) return;
        addRipple(el, e);
      });
    });
  }

  function applyAll(){
    attachActions();
    attachRipple();
  }

  document.addEventListener('DOMContentLoaded', applyAll);
  setTimeout(applyAll, 400);
  setTimeout(applyAll, 1500);
  setTimeout(applyAll, 4000);

  var observer = new MutationObserver(function(){ applyAll(); });
  observer.observe(document.body, { childList: true, subtree: true });

  console.log('%c[premium-final] ✅ ЕДИНСТВЕННЫЙ РАБОЧИЙ ПАТЧ ЗАГРУЖЕН','color:#00d4ff;font-weight:bold;font-size:13px');
})();

/* ============================================================
   ЧАТ — ПОЛНЫЙ ФИКС
   - Автообновление списка чатов каждые 2 сек
   - Badge у админа (непрочитанные)
   - Badge у клиента (непрочитанные)
   - Звук уведомления
   - Быстрая доставка сообщений (polling 1 сек)
   ============================================================ */
(function(){
  'use strict';

  /* ============================================================
     1. КЛИЕНТ: polling каждые 1 сек — сообщения от админа
     ============================================================ */
  setInterval(async function(){
    var token = getSessionToken();
    if (!token) return;

    var email = window.adminViewingEmail || localStorage.getItem('user_email');
    if (!email) return;

    // Если админ — пропускаем (у него свой polling)
    if (localStorage.getItem('user_role') === 'admin' && !window.adminViewingEmail) return;

    try {
      var r = await fetch(WORKER_URL + '?action=getUserState', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token, email: email })
      });
      var fresh = await r.json();
      if (!fresh || !fresh.chat) return;

      var prevLen = (st.chat || []).length;
      var newLen = fresh.chat.length;
      st.chat = fresh.chat;
      st.ticket = fresh.ticket || st.ticket;

      var adminTyping = false;
      if (fresh.typing && fresh.typing.admin === true) {
        var age = Date.now() - (fresh.typing.adminTs || 0);
        adminTyping = age < 3000;
      }
      window._adminTyping = adminTyping;

      // Badge
      if (typeof updateChatBadge === 'function') updateChatBadge();

      // Новое сообщение от админа
      if (newLen > prevLen) {
        var newMsgs = fresh.chat.slice(prevLen);
        var fromAdmin = newMsgs.some(function(m){ return m.from === 'admin'; });
        if (fromAdmin) {
          if (typeof playChatSound === 'function') playChatSound();
          if (typeof addNotification === 'function') {
            addNotification('New message from Elena', '💬');
          }
        }
      }

      // Обновить сообщения если панель открыта
      var panel = document.getElementById('chatPanel');
      var isOpen = panel && panel.style.display === 'flex';
      if (isOpen && typeof renderChatMessages === 'function') {
        renderChatMessages();
      }
    } catch(e) {}
  }, 1000);

  /* ============================================================
     2. КЛИЕНТ: badge — непрочитанные от админа
     ============================================================ */
  window.updateChatBadge = function(){
    var badge = document.getElementById('chatBadge');
    if (!badge) return;
    var unread = 0;
    (st.chat || []).forEach(function(m){
      if (m.from === 'admin' && !m.read) unread++;
    });
    if (unread > 0) {
      badge.textContent = unread > 9 ? '9+' : unread;
      badge.style.display = 'flex';
    } else {
      badge.style.display = 'none';
    }
  };

  /* ============================================================
     3. КЛИЕНТ: markChatRead — при открытии чата
     ============================================================ */
  window.markChatRead = async function(){
    var token = getSessionToken();
    var email = window.adminViewingEmail || localStorage.getItem('user_email');
    if (!token || !email) return;

    try {
      var r = await fetch(WORKER_URL + '?action=getUserState', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token, email: email })
      });
      var fresh = await r.json();
      if (!fresh || !fresh.chat) return;

      var changed = false;
      fresh.chat.forEach(function(m){
        if (m.from === 'admin' && !m.read) { m.read = true; changed = true; }
      });
      st.chat = fresh.chat;

      if (changed) {
        await fetch(WORKER_URL + '?action=setUserState', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: token, email: email, state: st, force: true })
        });
      }
      updateChatBadge();
    } catch(e) {}
  };

  /* ============================================================
     4. АДМИН: автообновление списка чатов каждые 2 сек
     ============================================================ */
  var _lastChatsHash = '';
  var _chatsLoading = false;

  async function refreshAdminChats(){
    var panel = document.getElementById('adminPanel');
    if (!panel || !panel.classList.contains('on')) return;

    var chatsSection = document.querySelector('.admin-section[data-section="chats"]');
    if (!chatsSection || !chatsSection.classList.contains('active')) return;

    if (_chatsLoading) return;
    _chatsLoading = true;

    try {
      var token = getSessionToken();
      if (!token) { _chatsLoading = false; return; }

      var r = await fetch(WORKER_URL + '?action=listUsers', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ token: token })
      });
      var d = await r.json();
      if (!d.ok || !d.users) { _chatsLoading = false; return; }

      // Параллельно тянем стейты
      var results = await Promise.all(d.users.map(function(u){
        return fetch(WORKER_URL + '?action=getUserState', {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ token: token, email: u.email })
        })
        .then(function(r2){ return r2.json(); })
        .then(function(s){ return { user: u, state: s || {} }; })
        .catch(function(){ return { user: u, state: {} }; });
      }));

      var chats = [];
      var totalUnread = 0;
      results.forEach(function(res){
        var msgs = res.state.chat || [];
        if (!msgs.length) return;
        var last = msgs[msgs.length - 1];
        var unread = msgs.filter(function(m){ return m.from === 'client' && !m.read; }).length;
        totalUnread += unread;
        chats.push({
          email: res.user.email,
          name: res.user.name || res.user.email,
          lastTs: last.ts,
          lastText: last.text,
          lastFrom: last.from,
          unread: unread
        });
      });
      chats.sort(function(a, b){ return b.lastTs - a.lastTs; });

      // Обновляем badge "Live chats" в сайдбаре
      var navBadge = document.getElementById('navChatsCount');
      if (navBadge) {
        if (totalUnread > 0) {
          navBadge.textContent = totalUnread > 99 ? '99+' : totalUnread;
          navBadge.style.display = 'inline-block';
        } else {
          navBadge.style.display = 'none';
        }
      }

      // Hash для отслеживания изменений
      var hash = chats.map(function(c){
        return c.email + ':' + c.lastTs + ':' + c.unread;
      }).join('|');
      if (hash === _lastChatsHash) { _chatsLoading = false; return; }
      _lastChatsHash = hash;

      var box = document.getElementById('adminChatsList');
      if (!box) { _chatsLoading = false; return; }

      if (!chats.length) {
        box.innerHTML = '<div class="admin-empty">No chats yet</div>';
        _chatsLoading = false;
        return;
      }

      var html = '';
      chats.forEach(function(c){
        var safeEmail = String(c.email).replace(/[&<>"']/g, function(ch){
          return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch];
        }).replace(/'/g, "\\'");
        var initials = (c.name || 'U').charAt(0).toUpperCase();
        html += '<div onclick="openAdminChatLive(\'' + safeEmail + '\')" style="padding:14px 16px;border-bottom:1px solid rgba(255,255,255,0.06);cursor:pointer;display:flex;justify-content:space-between;align-items:center;">' +
          '<div style="display:flex;gap:12px;align-items:center;">' +
            '<div style="width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,#7c3aed,#a855f7);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;">' + initials + '</div>' +
            '<div>' +
              '<div style="color:#e7edf5;font-weight:600;font-size:14px;">' + (c.name || '') +
                (c.unread ? ' <span style="background:#ff3b3b;color:#fff;font-size:10px;padding:2px 6px;border-radius:10px;">' + c.unread + ' new</span>' : '') +
              '</div>' +
              '<div style="color:#8b95a5;font-size:12px;margin-top:2px;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' +
                (c.lastFrom === 'admin' ? 'You: ' : '') + (c.lastText || '') +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div style="color:#8b95a5;font-size:11px;">' + new Date(c.lastTs).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}) + '</div>' +
        '</div>';
      });
      box.innerHTML = html;
    } catch(e) {
      console.error('[refreshAdminChats]', e);
    }
    _chatsLoading = false;
  }

  // Каждые 2 секунды обновляем список чатов (если админ на вкладке)
  setInterval(refreshAdminChats, 2000);

  // Экспорт для кнопки "Refresh"
  window.loadAdminChats = refreshAdminChats;

  /* ============================================================
     5. АДМИН: polling бейджей (wds + chats) каждые 3 сек
     ============================================================ */
  setInterval(async function(){
    var panel = document.getElementById('adminPanel');
    if (!panel || !panel.classList.contains('on')) return;

    try {
      var token = getSessionToken();
      if (!token) return;

      var r = await fetch(WORKER_URL + '?action=listUsers', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ token: token })
      });
      var d = await r.json();
      if (!d.ok || !d.users) return;

      var results = await Promise.all(d.users.map(function(u){
        return fetch(WORKER_URL + '?action=getUserState', {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ token: token, email: u.email })
        })
        .then(function(r2){ return r2.json(); })
        .catch(function(){ return {}; });
      }));

      var totalChats = 0;
      var totalWd = 0;
      results.forEach(function(s){
        totalChats += (s.chat || []).filter(function(m){ return m.from === 'client' && !m.read; }).length;
        totalWd += (s.withdrawals || []).filter(function(w){ return w.status === 'pending'; }).length;
      });

      var chatsEl = document.getElementById('navChatsCount');
      if (chatsEl) {
        if (totalChats > 0) { chatsEl.textContent = totalChats; chatsEl.style.display = 'inline-block'; }
        else { chatsEl.style.display = 'none'; }
      }

      var wdsEl = document.getElementById('navWdsCount');
      if (wdsEl) {
        if (totalWd > 0) { wdsEl.textContent = totalWd; wdsEl.style.display = 'inline-block'; }
        else { wdsEl.style.display = 'none'; }
      }
    } catch(e) {}
  }, 3000);

  /* ============================================================
     6. КЛИЕНТ: sendChatMsg — мгновенная отправка
     ============================================================ */
  var _origSendChatMsg = window.sendChatMsg;
  window.sendChatMsg = async function(){
    var input = document.getElementById('chatInput');
    if (!input) return;
    var text = (input.value || '').trim();
    if (!text) return;
    input.value = '';

    if (!st.chat) st.chat = [];
    st.chat.push({
      id: 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2,7),
      from: 'client',
      text: text,
      ts: Date.now(),
      read: false
    });

    if (typeof renderChatMessages === 'function') renderChatMessages();

    var token = getSessionToken();
    var email = window.adminViewingEmail || localStorage.getItem('user_email');
    if (token && email) {
      try {
        await fetch(WORKER_URL + '?action=setUserState', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: token, email: email, state: st, force: true })
        });
      } catch(e) {}
    }
  };

  console.log('%c[chat-fix] ✅ Чат исправлен — 2s обновление, badge, звук','color:#a855f7;font-weight:bold');
})();
/* ============================================================
   ЧАТ FIX v2 — typing indicator, badges, end chat
   ============================================================ */
(function(){
  'use strict';

  /* ============================================================
     1. КЛИЕНТ: уведомлять что печатает
     ============================================================ */
  function notifyClientTyping(){
    var token = getSessionToken();
    var email = window.adminViewingEmail || localStorage.getItem('user_email');
    if (!token || !email) return;

    // Отправляем "печатает: true"
    fetch(WORKER_URL + '?action=setTyping', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token, email: email, who: 'client', typing: true })
    }).catch(function(){});

    // Через 2.5 сек — "печатает: false"
    clearTimeout(window._clientTypingTimer);
    window._clientTypingTimer = setTimeout(function(){
      fetch(WORKER_URL + '?action=setTyping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token, email: email, who: 'client', typing: false })
      }).catch(function(){});
    }, 2500);
  }

  // Привязываем к input чата
  document.addEventListener('DOMContentLoaded', function(){
    var input = document.getElementById('chatInput');
    if (input && !input._typingBound) {
      input._typingBound = true;
      input.addEventListener('input', notifyClientTyping);
    }
  });
  setTimeout(function(){
    var input = document.getElementById('chatInput');
    if (input && !input._typingBound) {
      input._typingBound = true;
      input.addEventListener('input', notifyClientTyping);
    }
  }, 2000);

  /* ============================================================
     2. АДМИН: уведомлять что печатает (уже есть, но фиксим имя)
     ============================================================ */
  window._notifyAdminTyping = function(email){
    var token = getSessionToken();
    if (!token) return;

    fetch(WORKER_URL + '?action=setTyping', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token, email: email, who: 'admin', typing: true })
    }).catch(function(){});

    clearTimeout(window._admTypingTimer);
    window._admTypingTimer = setTimeout(function(){
      fetch(WORKER_URL + '?action=setTyping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token, email: email, who: 'admin', typing: false })
      }).catch(function(){});
    }, 2500);
  };

  /* ============================================================
     3. BADGE У КЛИЕНТА (chatBadge)
     ============================================================ */
  window.updateChatBadge = function(){
    var badge = document.getElementById('chatBadge');
    if (!badge) return;

    var unread = 0;
    (st.chat || []).forEach(function(m){
      if (m.from === 'admin' && !m.read) unread++;
    });

    if (unread > 0){
      badge.textContent = unread > 9 ? '9+' : unread;
      badge.style.display = 'flex';
    } else {
      badge.style.display = 'none';
    }
  };

  /* ============================================================
     4. BADGE У АДМИНА (navChatsCount в сайдбаре)
     ============================================================ */
  async function updateAdminChatsBadge(){
    var panel = document.getElementById('adminPanel');
    if (!panel || !panel.classList.contains('on')) return;

    var badge = document.getElementById('navChatsCount');
    if (!badge) return;

    try {
      var token = getSessionToken();
      if (!token) return;

      var r = await fetch(WORKER_URL + '?action=listUsers', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ token: token })
      });
      var d = await r.json();
      if (!d.ok || !d.users) return;

      var results = await Promise.all(d.users.map(function(u){
        return fetch(WORKER_URL + '?action=getUserState', {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ token: token, email: u.email })
        })
        .then(function(r2){ return r2.json(); })
        .catch(function(){ return {}; });
      }));

      var totalUnread = 0;
      results.forEach(function(s){
        totalUnread += (s.chat || []).filter(function(m){
          return m.from === 'client' && !m.read;
        }).length;
      });

      if (totalUnread > 0){
        badge.textContent = totalUnread > 99 ? '99+' : totalUnread;
        badge.style.display = 'inline-block';
      } else {
        badge.style.display = 'none';
      }
    } catch(e) {}
  }

  // Обновляем badge админа каждые 3 сек
  setInterval(updateAdminChatsBadge, 3000);

  /* ============================================================
     5. АДМИН: показывать "печатает" в модалке
     ============================================================ */
  // Патчим openAdminChatLive — добавляем показ typing
  var _origOpenAdminChatLive = window.openAdminChatLive;
  window.openAdminChatLive = async function(email){
    if (typeof _origOpenAdminChatLive === 'function'){
      await _origOpenAdminChatLive(email);
    }
    // Запускаем отдельный polling для typing клиента
    if (window._adminTypingPoll) clearInterval(window._adminTypingPoll);
    window._adminTypingPoll = setInterval(async function(){
      var modal = document.getElementById('adminChatModal');
      if (!modal) {
        clearInterval(window._adminTypingPoll);
        return;
      }
      var token = getSessionToken();
      if (!token) return;
      try {
        var r = await fetch(WORKER_URL + '?action=getUserState', {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ token: token, email: email })
        });
        var state = await r.json();
        var typing = state.typing || {};
        var clientTyping = typing.client === true;
        // Обновляем placeholder в input
        var inp = document.getElementById('adminChatInput');
        if (inp){
          inp.placeholder = clientTyping ? 'Client is typing...' : 'Reply...';
        }
      } catch(e) {}
    }, 1500);
  };

  /* ============================================================
     6. END CHAT — жёсткая очистка с повтором
     ============================================================ */
  window.endAdminChat = async function(email){
    if (!email) return;
    if (!confirm('End chat with ' + email + '?\nAll messages will be deleted.')) return;

    var token = getSessionToken();
    if (!token) { alert('No session'); return; }

    async function wipeOnce(silent){
      try {
        var r = await fetch(WORKER_URL + '?action=getUserState', {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ token: token, email: email })
        });
        var state = await r.json();
        if (!state || state.error) return false;

        state.chat = [];
        state.ticket = null;
        state.typing = {};

        var r2 = await fetch(WORKER_URL + '?action=setUserState', {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({
            token: token,
            email: email,
            state: state,
            force: true,
            wipeChat: true
          })
        });
        var res = await r2.json();
        if (!silent) console.log('[endAdminChat] wipe result:', res);
        return res && res.ok;
      } catch(e){
        console.error('[endAdminChat]', e);
        return false;
      }
    }

    // Тройной удар — сразу, через 1.5 сек, через 4 сек
    await wipeOnce(false);
    setTimeout(function(){ wipeOnce(true); }, 1500);
    setTimeout(function(){ wipeOnce(true); }, 4000);

    alert('✅ Chat closed for ' + email);

    var modal = document.getElementById('adminChatModal');
    if (modal) modal.remove();
    if (window._adminTypingPoll) clearInterval(window._adminTypingPoll);

    if (typeof loadAdminChats === 'function') loadAdminChats();
  };

  /* ============================================================
     7. КЛИЕНТ: если чат очищен — сброс UI (проверяем каждые 3 сек)
     ============================================================ */
  setInterval(async function(){
    var token = getSessionToken();
    if (!token) return;

    var email = window.adminViewingEmail || localStorage.getItem('user_email');
    if (!email) return;

    if (localStorage.getItem('user_role') === 'admin' && !window.adminViewingEmail) return;

    try {
      var r = await fetch(WORKER_URL + '?action=getUserState', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ token: token, email: email })
      });
      var fresh = await r.json();
      if (!fresh) return;

      var serverHasChat = (fresh.chat || []).length > 0 || (fresh.ticket && fresh.ticket.id);
      var localHasChat = (st.chat || []).length > 0 || (st.ticket && st.ticket.id);

      // ★ АДМИН УДАЛИЛ ЧАТ — но у клиента он ещё есть
      if (!serverHasChat && localHasChat){
        console.log('[chat-sync] админ удалил чат — очищаю локально');
        st.chat = [];
        st.ticket = null;
        st.typing = {};

        if (typeof updateChatBadge === 'function') updateChatBadge();
        if (typeof renderChatMessages === 'function') renderChatMessages();

        // Показываем форму подачи тикета
        var formEl = document.getElementById('chatTicketForm');
        var convEl = document.getElementById('chatConversation');
        if (formEl) formEl.style.display = 'flex';
        if (convEl) convEl.style.display = 'none';

        if (typeof toast === 'function') toast('Chat closed by support', true);
      }
    } catch(e) {}
  }, 3000);

  /* ============================================================
     8. КЛИЕНТ: markChatRead при открытии чата
     ============================================================ */
  window.markChatRead = async function(){
    var token = getSessionToken();
    var email = window.adminViewingEmail || localStorage.getItem('user_email');
    if (!token || !email) return;

    try {
      var r = await fetch(WORKER_URL + '?action=getUserState', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ token: token, email: email })
      });
      var fresh = await r.json();
      if (!fresh || !fresh.chat) return;

      var changed = false;
      fresh.chat.forEach(function(m){
        if (m.from === 'admin' && !m.read){ m.read = true; changed = true; }
      });
      st.chat = fresh.chat;

      if (changed){
        await fetch(WORKER_URL + '?action=setUserState', {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ token: token, email: email, state: st, force: true })
        });
      }
      if (typeof updateChatBadge === 'function') updateChatBadge();
    } catch(e) {}
  };

  console.log('%c[chat-fix-v2] ✅ Typing + Badges + End chat','color:#00e08a;font-weight:bold');
})();
/* ============================================================
   ЧАТ: БЕЗ МИГАНИЯ — обновляем только при изменениях
   ============================================================ */
(function(){
  'use strict';

  /* ---------- Клиент: кэш последнего рендера ---------- */
  var _lastClientHash = '';

  var _origRender = window.renderChatMessages;
  window.renderChatMessages = function(force){
    var box = document.getElementById('chatMessages');
    if (!box) return;

    var chat = (st.chat || []).slice().sort(function(a,b){ return a.ts - b.ts; });

    // Уникальный хеш состояния чата
    var hash = chat.length + '|' +
               chat.map(function(m){
                 return m.id + ':' + (m.read ? 1 : 0);
               }).join(',') + '|' +
               (window._adminTyping ? '1' : '0');

    // Если ничего не изменилось — НЕ перерисовываем
    if (!force && hash === _lastClientHash) return;
    _lastClientHash = hash;

    var html = '';
    if (!chat.length){
      html = '<div class="chat-welcome">' +
        '<div class="chat-welcome-name">Elena Bergström</div>' +
        '<div class="chat-welcome-text">Hi! How can I help you today?</div>' +
      '</div>';
    } else {
      var prevFrom = null;
      var prevTs = 0;
      chat.forEach(function(m){
        var isClient = m.from === 'client';
        var sameAuthor = (prevFrom === m.from) && (m.ts - prevTs < 60000);

        var metaHtml = sameAuthor ? '' :
          '<div class="chat-msg-meta">' +
            (isClient ? 'You' : 'Elena') + ' • ' +
            new Date(m.ts).toLocaleTimeString('en-GB', {hour:'2-digit', minute:'2-digit'}) +
          '</div>';

        html += '<div class="chat-msg ' + (isClient ? 'client' : 'admin') + (sameAuthor ? ' same-author' : '') + '">' +
          '<div>' +
            '<div class="chat-bubble">' + (typeof escapeHtml === 'function' ? escapeHtml(m.text) : m.text) + '</div>' +
            metaHtml +
          '</div>' +
        '</div>';

        prevFrom = m.from;
        prevTs = m.ts;
      });
    }

    if (window._adminTyping){
      html += '<div class="chat-msg admin chat-typing">' +
        '<div>' +
          '<div class="chat-bubble">' +
            '<span class="typing-dot"></span>' +
            '<span class="typing-dot"></span>' +
            '<span class="typing-dot"></span>' +
          '</div>' +
          '<div class="chat-msg-meta">Elena is typing...</div>' +
        '</div>' +
      '</div>';
    }

    // Запоминаем позицию скролла
    var wasAtBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 40;
    var oldScrollTop = box.scrollTop;

    box.innerHTML = html;

    // Восстанавливаем скролл
    if (wasAtBottom) {
      box.scrollTop = box.scrollHeight;
    } else {
      box.scrollTop = oldScrollTop;
    }
  };

  /* ---------- Убираем агрессивные вызовы renderChatMessages ---------- */
  // В client polling — рендерим только при реальных изменениях
  // Перезапишем client polling (1 сек)
  setInterval(async function(){
    var token = getSessionToken();
    if (!token) return;

    var email = window.adminViewingEmail || localStorage.getItem('user_email');
    if (!email) return;

    // Если это админ — пропускаем
    if (localStorage.getItem('user_role') === 'admin' && !window.adminViewingEmail) return;

    // Проверяем, открыт ли чат
    var panel = document.getElementById('chatPanel');
    var isOpen = panel && panel.style.display === 'flex';
    if (!isOpen) return; // Не делаем fetch если чат закрыт

    try {
      var r = await fetch(WORKER_URL + '?action=getUserState', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token, email: email })
      });
      var fresh = await r.json();
      if (!fresh) return;

      var prevLen = (st.chat || []).length;
      var newLen = (fresh.chat || []).length;
      var prevTyping = window._adminTyping;
      var newTyping = false;

      if (fresh.typing && fresh.typing.admin === true){
        var age = Date.now() - (fresh.typing.adminTs || 0);
        newTyping = age < 3000;
      }

      st.chat = fresh.chat || [];
      window._adminTyping = newTyping;

      // ★ Перерисовываем ТОЛЬКО если изменилось
      var changed = (newLen !== prevLen) || (newTyping !== prevTyping);
      if (changed){
        window.renderChatMessages();
      }

      // Badge
      if (typeof updateChatBadge === 'function') updateChatBadge();

      // Звук при новом сообщении
      if (newLen > prevLen){
        var newMsgs = st.chat.slice(prevLen);
        var fromAdmin = newMsgs.some(function(m){ return m.from === 'admin'; });
        if (fromAdmin){
          if (typeof playChatSound === 'function') playChatSound();
          if (typeof addNotification === 'function') addNotification('New message from Elena', '💬');
        }
      }
    } catch(e) {}
  }, 500);

  /* ---------- Админ: то же самое для модалки ---------- */
  // Патчим _refreshAdminChat — не перерисовывать если не изменилось
  window._lastAdminRenderHash = '';

  var _origOpenAdminChatLive = window.openAdminChatLive;
  window.openAdminChatLive = async function(email){
    if (typeof _origOpenAdminChatLive === 'function'){
      await _origOpenAdminChatLive(email);
    }

    // Свой polling — только при изменениях
    if (window._adminPollCleaner) clearInterval(window._adminPollCleaner);
    window._adminPollCleaner = setInterval(async function(){
      var modal = document.getElementById('adminChatModal');
      if (!modal) { clearInterval(window._adminPollCleaner); return; }

      var token = getSessionToken();
      if (!token) return;

      try {
        var r = await fetch(WORKER_URL + '?action=getUserState', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: token, email: email })
        });
        var state = await r.json();
        if (!state) return;

        var msgs = state.chat || [];
        var typing = state.typing || {};
        var clientTyping = typing.client === true && (Date.now() - (typing.clientTs || 0) < 3000);

        var hash = msgs.length + '|' +
                   msgs.map(function(m){ return m.id; }).join(',') + '|' +
                   (clientTyping ? '1' : '0');

        // Обновляем placeholder если печатает
        var inp = document.getElementById('adminChatInput');
        if (inp){
          var newPlaceholder = clientTyping ? 'Client is typing...' : 'Reply...';
          if (inp.placeholder !== newPlaceholder) inp.placeholder = newPlaceholder;
        }

        // Обновляем сообщения только если изменилось
        if (hash === window._lastAdminRenderHash) return;
        window._lastAdminRenderHash = hash;

        var box = document.getElementById('adminChatMsgs');
        if (!box) return;

        var wasAtBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 40;

        var html = '';
        msgs.forEach(function(m){
          var isAdmin = m.from === 'admin';
          html += '<div style="display:flex;margin-bottom:10px;' + (isAdmin ? 'justify-content:flex-end;' : '') + '">' +
            '<div style="max-width:70%;padding:10px 14px;border-radius:16px;font-size:13px;line-height:1.45;' +
              (isAdmin ? 'background:linear-gradient(135deg,#5f2ee5,#8b5cf6);color:#fff;' : 'background:rgba(255,255,255,0.06);color:#e7edf5;') + '">' +
              (typeof escapeHtml === 'function' ? escapeHtml(m.text) : m.text) +
              '<div style="font-size:10px;opacity:0.6;margin-top:4px;">' +
                new Date(m.ts).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}) +
              '</div>' +
            '</div>' +
          '</div>';
        });
        if (!html) html = '<div style="text-align:center;color:#8b95a5;padding:30px;">No messages</div>';

        box.innerHTML = html;
        if (wasAtBottom) box.scrollTop = box.scrollHeight;
      } catch(e) {}
    }, 500);
  };

  console.log('%c[chat-no-flicker] ✅ Чат без мигания','color:#00e08a;font-weight:bold');
})();
/* ============================================================
   NOTIFICATIONS: кнопка удаления + clear all
   ============================================================ */
(function(){
  'use strict';

  /* ============================================================
     1. CSS для кнопки × на уведомлениях
     ============================================================ */
  var style = document.createElement('style');
  style.id = 'notif-delete-style';
  style.textContent = `
    /* Позиционирование .notif-item относительно */
    .notif-item {
      position: relative;
      padding-right: 44px !important;
    }

    /* Кнопка × — скрыта по умолчанию */
    .notif-delete-btn {
      position: absolute;
      top: 10px;
      right: 10px;
      width: 28px;
      height: 28px;
      border-radius: 8px;
      background: rgba(255, 80, 80, 0.12);
      border: 1px solid rgba(255, 80, 80, 0.25);
      color: #ff6b6b;
      font-size: 16px;
      line-height: 1;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      opacity: 0;
      transition: opacity .2s ease, background .2s ease, transform .2s ease;
      font-family: inherit;
      padding: 0;
      z-index: 5;
    }

    /* Показываем кнопку при наведении */
    .notif-item:hover .notif-delete-btn {
      opacity: 1;
    }

    /* Hover эффект на кнопке */
    .notif-delete-btn:hover {
      background: rgba(255, 80, 80, 0.25);
      transform: scale(1.1);
    }

    /* На мобильных — всегда показываем */
    @media (max-width: 768px) {
      .notif-delete-btn { opacity: 1; }
    }

    /* Кнопка Clear all в хедере */
    .notif-clear-all {
      padding: 7px 12px;
      background: rgba(255, 80, 80, 0.1);
      border: 1px solid rgba(255, 80, 80, 0.25);
      border-radius: 8px;
      color: #ff6b6b;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: background .2s;
      font-family: inherit;
      margin-left: 8px;
    }
    .notif-clear-all:hover {
      background: rgba(255, 80, 80, 0.2);
    }
  `;
  document.head.appendChild(style);

  /* ============================================================
     2. Функция: удалить одно уведомление
     ============================================================ */
   window.deleteNotification = function(id){
    if (!st.notifications) return;

    var before = st.notifications.length;
    st.notifications = st.notifications.filter(function(n){
      return String(n.id) !== String(id);
    });

    if (st.notifications.length < before){
      // ★ ОТПРАВЛЯЕМ НА СЕРВЕР С ФЛАГОМ wipeNotifs
      var token = getSessionToken();
      if (token && typeof stateLoaded !== 'undefined' && stateLoaded){
        fetch(WORKER_URL + '?action=setUserState', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token: token,
            state: st,
            email: window.adminViewingEmail || undefined,
            force: true,
            wipeNotifs: true
          })
        }).catch(function(){});
      }

      if (typeof renderNotifications === 'function') renderNotifications();
      console.log('[notif] deleted', id);
    }
  };

  /* ============================================================
     3. Функция: удалить все уведомления
     ============================================================ */
   window.clearAllNotifications = function(){
    if (!st.notifications || !st.notifications.length) {
      if (typeof toast === 'function') toast('No notifications to clear', true);
      return;
    }
    if (!confirm('Clear all notifications?')) return;

    st.notifications = [];

    // ★ ОТПРАВЛЯЕМ НА СЕРВЕР С ФЛАГОМ wipeNotifs
    var token = getSessionToken();
    if (token && typeof stateLoaded !== 'undefined' && stateLoaded){
      fetch(WORKER_URL + '?action=setUserState', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: token,
          state: st,
          email: window.adminViewingEmail || undefined,
          force: true,
          wipeNotifs: true
        })
      }).catch(function(){});
    }

    if (typeof renderNotifications === 'function') renderNotifications();
    if (typeof toast === 'function') toast('All notifications cleared');
  };

  /* ============================================================
     4. Перезаписываем renderNotifications с кнопками ×
     ============================================================ */
  window.renderNotifications = function(){
    var listEl = document.getElementById('notifList');
    var badge  = document.getElementById('notifBadge');
    var sub    = document.getElementById('notifSub');
    if (!listEl) return;

    var notifs = st.notifications || [];
    var unread = 0;
    for (var i = 0; i < notifs.length; i++) {
      if (!notifs[i].read) unread++;
    }

    // Badge
    if (badge){
      if (unread > 0){
        badge.style.display = 'flex';
        badge.textContent = unread > 9 ? '9+' : unread;
      } else {
        badge.style.display = 'none';
      }
    }

    // Subtitle
    if (sub) sub.textContent = unread > 0 ? (unread + ' unread') : 'All read';

    // Пусто
    if (notifs.length === 0){
      listEl.innerHTML = '<div class="notif-empty"><div style="font-size:2.5rem;opacity:.4;margin-bottom:8px">🔔</div><div>No notifications yet</div></div>';
      return;
    }

    // Render
    var html = '';
    for (var j = 0; j < notifs.length; j++){
      var n = notifs[j];
      var safeId = String(n.id).replace(/'/g, "\\'");
      var safeText = (n.text || '').replace(/[&<>"']/g, function(c){
        return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
      });
      html += '<div class="notif-item' + (n.read ? '' : ' unread') + '" data-id="' + n.id + '">' +
        '<div class="notif-icon">' + (n.icon || '🔔') + '</div>' +
        '<div class="notif-body">' +
          '<div class="notif-text">' + safeText + '</div>' +
          '<div class="notif-time">' + (typeof timeAgo === 'function' ? timeAgo(n.ts) : '') + '</div>' +
        '</div>' +
        '<button class="notif-delete-btn" onclick="event.stopPropagation(); deleteNotification(\'' + safeId + '\')" title="Delete notification">×</button>' +
      '</div>';
    }
    listEl.innerHTML = html;

    // Клик по уведомлению — только mark as read (НЕ удаляет)
    var items = listEl.querySelectorAll('.notif-item');
    for (var k = 0; k < items.length; k++){
      items[k].addEventListener('click', function(e){
        if (e.target.classList.contains('notif-delete-btn')) return;
        var id = this.getAttribute('data-id');
        if (typeof markRead === 'function') markRead(Number(id));
      });
    }
  };

  /* ============================================================
     5. Добавляем кнопку "Clear all" в header панели
     ============================================================ */
  document.addEventListener('DOMContentLoaded', function(){
    var header = document.querySelector('.notif-header');
    if (!header) return;
    if (header.querySelector('.notif-clear-all')) return;

    var btn = document.createElement('button');
    btn.className = 'notif-clear-all';
    btn.textContent = 'Clear all';
    btn.onclick = function(){ window.clearAllNotifications(); };

    // Вставляем перед close кнопкой
    var closeBtn = header.querySelector('.notif-close');
    if (closeBtn){
      closeBtn.parentNode.insertBefore(btn, closeBtn);
      btn.style.marginRight = '8px';
    } else {
      header.appendChild(btn);
    }
  });

  /* ============================================================
     6. Перерисовываем уведомления при старте
     ============================================================ */
  setTimeout(function(){
    if (typeof renderNotifications === 'function') renderNotifications();
  }, 500);

  console.log('%c[notif-delete] ✅ Кнопка × на уведомлениях + Clear all','color:#00e08a;font-weight:bold');
})();
/* ============================================================
   FINAL FIX — auto-deposit + notifications + English chat text
   Silent auto-credit every 15s. No modals. English UI.
   ============================================================ */
(function(){
  'use strict';

  if (typeof WORKER_URL === 'undefined') {
    console.error('[final-fix] WORKER_URL not found');
    return;
  }

  /* Fix Russian typing text to English */
  setInterval(function(){
    var inp = document.getElementById('adminChatInput');
    if (inp && inp.placeholder && inp.placeholder.indexOf('печ') !== -1) {
      inp.placeholder = 'Client is typing...';
    }
  }, 500);

  var _origRenderChatMessages = window.renderChatMessages;
  window.renderChatMessages = function(){
    if (typeof _origRenderChatMessages === 'function') {
      _origRenderChatMessages.apply(this, arguments);
    }
    var box = document.getElementById('chatMessages');
    if (!box) return;
    var html = box.innerHTML;
    if (html.indexOf('печ') !== -1) {
      html = html.replace(/Elena печатает\.\.\./g, 'Elena is typing...');
      html = html.replace(/печатает\.\.\./g, 'is typing...');
      box.innerHTML = html;
    }
  };

  /* AUTO-DEPOSIT — silent credit every 15s */
  var CHECK_INTERVAL = 15000;
  var processedHashes = {};

  try {
    var saved = localStorage.getItem('_autoDepositProcessed');
    if (saved) processedHashes = JSON.parse(saved);
  } catch(e) {}

  function saveProcessed() {
    try {
      var weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      Object.keys(processedHashes).forEach(function(h) {
        if (processedHashes[h] < weekAgo) delete processedHashes[h];
      });
      localStorage.setItem('_autoDepositProcessed', JSON.stringify(processedHashes));
    } catch(e) {}
  }

   async function checkDeposits() {
    var role = localStorage.getItem('user_role');
    if (role === 'admin') return;

    var email = (window.adminViewingEmail || localStorage.getItem('user_email') || '').toLowerCase();
    if (!email) return;

    // ★ Always sync fresh state from server (get new wallet from admin)
    try {
      var token = getSessionToken();
      if (token) {
        var freshR = await fetch(WORKER_URL + '?action=getUserState', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: token, email: email })
        });
        var fresh = await freshR.json();
        if (fresh && !fresh.error) {
          if (fresh.cryptoAddress) st.cryptoAddress = fresh.cryptoAddress;
          if (fresh.txs) st.txs = fresh.txs;
          if (fresh.depositVerifications) st.depositVerifications = fresh.depositVerifications;
        }
      }
    } catch(e) {
      console.warn('[final-fix] sync error:', e);
    }

    var hasWallet = false;
    try {
      hasWallet = !!(
        (window.DEPOSIT_WALLETS && window.DEPOSIT_WALLETS[email]) ||
        (st.cryptoAddress && (st.cryptoAddress.btc || st.cryptoAddress.eth))
      );
    } catch(e) {}
    if (!hasWallet) return;

    try {
      var r = await fetch(WORKER_URL + '?action=check&email=' + encodeURIComponent(email) + '&_t=' + Date.now());
      var data = await r.json();
      if (!data || !data.ok || !data.result) return;

      var btcList = data.result.btc || [];
      var ethList = data.result.eth || [];
      var allTxs = [];

      btcList.forEach(function(tx) { tx._type = 'BTC'; allTxs.push(tx); });
      ethList.forEach(function(tx) { tx._type = 'ETH'; allTxs.push(tx); });

      var knownHashes = {};
      (st.txs || []).forEach(function(t) { if (t.hash) knownHashes[t.hash] = true; });
      (st.depositVerifications || []).forEach(function(d) { if (d.txHash) knownHashes[d.txHash] = true; });

      var newTxs = allTxs.filter(function(tx) {
        if (knownHashes[tx.hash]) return false;
        if (processedHashes[tx.hash]) return false;
        return true;
      });

      if (newTxs.length === 0) return;

      console.log('[final-fix] Found ' + newTxs.length + ' new deposit(s)');

      var totalUsd = 0, totalBtc = 0, totalEth = 0;

      newTxs.forEach(function(tx) {
        var price = tx._type === 'BTC' ? (st.btcP || 90000) : (st.ethP || 3000);
        var credit = tx.amount * price;
        if (credit <= 0) return;

        st.usd = (st.usd || 0) + credit;
        if (tx._type === 'BTC') {
          st.btc = (st.btc || 0) + tx.amount;
          totalBtc += tx.amount;
        } else {
          st.eth = (st.eth || 0) + tx.amount;
          totalEth += tx.amount;
        }
        totalUsd += credit;

        if (!Array.isArray(st.txs)) st.txs = [];
        st.txs.unshift({
          date: new Date().toISOString().slice(0, 10),
          ts: Date.now(),
          desc: 'Crypto deposit — ' + tx.amount.toFixed(8) + ' ' + tx._type +
                ' (' + tx.hash.slice(0, 10) + '…)',
          amt: credit,
          status: 'Completed',
          hash: tx.hash,
          crypto: tx.amount,
          symbol: tx._type
        });

        if (!st.depositVerifications) st.depositVerifications = [];
        st.depositVerifications.push({
          txHash: tx.hash,
          cryptoAmt: tx.amount,
          symbol: tx._type,
          usdValue: credit,
          source: 'auto',
          origin: 'auto',
          completedAt: Date.now()
        });

        processedHashes[tx.hash] = Date.now();
      });

      saveProcessed();

      var token = getSessionToken();
      if (token) {
        await fetch(WORKER_URL + '?action=setUserState', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: token, state: st, force: true })
        }).catch(function(e){ console.error('[final-fix] save error:', e); });
      }

      if (typeof render === 'function') render();

      var msg = '💰 Deposit received: +' + totalBtc.toFixed(8) + ' BTC' +
                (totalEth > 0 ? ' +' + totalEth.toFixed(8) + ' ETH' : '') +
                ' ≈ $' + totalUsd.toFixed(2);

      if (typeof addNotification === 'function') addNotification(msg, '💰');
      if (typeof toast === 'function') toast('💰 +' + totalBtc.toFixed(8) + ' BTC received!');
      if (typeof playChime === 'function') playChime();
      if (typeof spawnConfetti === 'function') spawnConfetti();

      try {
        await fetch(WORKER_URL + '?action=notifyAdmin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token: token,
            text: '💰 NEW DEPOSIT from ' + email + ': ' +
                  totalBtc.toFixed(8) + ' BTC' +
                  (totalEth > 0 ? ' +' + totalEth.toFixed(8) + ' ETH' : '') +
                  ' ≈ $' + totalUsd.toFixed(2),
            icon: '💰'
          })
        });
      } catch(e) {}

    } catch(e) {
      console.error('[final-fix] error:', e);
    }
  }

  setTimeout(checkDeposits, 5000);
  setInterval(checkDeposits, CHECK_INTERVAL);

  console.log('%c[final-fix] ✅ Auto-deposit + English chat + notifications',
    'color:#00e08a;font-weight:bold');
})();
/* ============================================================
   KYC VERIFICATION FLOW — реальная загрузка + pending/rejected
   ============================================================ */

/* ---------- Чтение файла в base64 ---------- */
function fileToBase64(file) {
  return new Promise(function(resolve, reject){
    var reader = new FileReader();
    reader.onload = function(){ resolve(reader.result); };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* ---------- Загрузка одного дока в R2 ---------- */
async function uploadKycFile(file, docType) {
  var token = getSessionToken();
  if (!token) throw new Error('Not authenticated');
  var base64 = await fileToBase64(file);
  var r = await fetch(WORKER_URL + '?action=uploadKycDoc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: token,
      docType: docType,
      imageBase64: base64,
      fileName: file.name
    })
  });
  var data = await r.json();
  if (!data.ok) throw new Error(data.error || 'Upload failed');
  return data.key;
}

/* ---------- Отправка верификации ---------- */
window.submitRealVerification = async function() {
  var btn = document.getElementById('verifyNext3');
  if (btn) { btn.disabled = true; btn.textContent = 'Uploading...'; }

  try {
    var token = getSessionToken();
    if (!token) throw new Error('Not authenticated');

    var docFile    = document.getElementById('docFile').files[0];
    var selfieFile = document.getElementById('selfieFile').files[0];
    var street     = document.getElementById('vStreet').value.trim();
    var city       = document.getElementById('vCity').value.trim();
    var zip        = document.getElementById('vZip').value.trim();
    var country    = document.getElementById('vCountry').value;

    if (!docFile)    throw new Error('Please upload document');
    if (!selfieFile) throw new Error('Please upload selfie');
    if (!street || !city || !zip) throw new Error('Please fill address');

    var docType = verifyData.docType || 'Passport';
    var docKey    = await uploadKycFile(docFile, 'passport');
    var selfieKey = await uploadKycFile(selfieFile, 'selfie');

    var r = await fetch(WORKER_URL + '?action=submitVerification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: token,
        docType: docType,
        docKeys: [docKey, selfieKey],
        personalInfo: { street: street, city: city, zip: zip, country: country }
      })
    });
    var data = await r.json();
    if (!data.ok) throw new Error(data.error || 'Submit failed');

    hideVerifyScreen();
    showPendingScreen();
    if (typeof toast === 'function') toast('Documents submitted! Waiting for approval.');
  } catch(e) {
    if (typeof toast === 'function') toast(e.message, true);
    if (btn) { btn.disabled = false; btn.textContent = 'Submit →'; }
  }
};

/* ---------- Показать экран "pending" ---------- */
function showPendingScreen() {
  var s = document.getElementById('pendingScreen');
  if (s) s.classList.add('on');
  var r = document.getElementById('rejectedScreen');
  if (r) r.classList.remove('on');
  var v = document.getElementById('verifyScreen');
  if (v) v.classList.remove('on');

  var bar = document.getElementById('pendingBar');
  if (bar) {
    var p = 15;
    setInterval(function(){
      p = Math.min(95, p + Math.random() * 8);
      bar.style.width = p + '%';
    }, 4000);
  }

  var btnLogout = document.getElementById('btnLogoutPending');
  if (btnLogout && !btnLogout._bound) {
    btnLogout._bound = true;
    btnLogout.onclick = function(){ doLogout(); };
  }
}

/* ---------- Показать экран "rejected" ---------- */
function showRejectedScreen(reason) {
  var s = document.getElementById('rejectedScreen');
  if (s) s.classList.add('on');
  var p = document.getElementById('pendingScreen');
  if (p) p.classList.remove('on');
  var v = document.getElementById('verifyScreen');
  if (v) v.classList.remove('on');

  var rEl = document.getElementById('rejectedReason');
  if (rEl) rEl.textContent = reason || 'Documents not accepted';

  var btnRetry = document.getElementById('btnRetryVerification');
  if (btnRetry && !btnRetry._bound) {
    btnRetry._bound = true;
    btnRetry.onclick = function(){
      document.getElementById('rejectedScreen').classList.remove('on');
      showVerifyScreen();
      showVerifyStep(1);
    };
  }
  var btnLogout = document.getElementById('btnLogoutRejected');
  if (btnLogout && !btnLogout._bound) {
    btnLogout._bound = true;
    btnLogout.onclick = function(){ doLogout(); };
  }
}

/* ---------- Проверка статуса верификации ---------- */
async function checkVerificationStatus() {
  var token = getSessionToken();
  if (!token) return null;
  try {
    var r = await fetch(WORKER_URL + '?action=getUserState', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token })
    });
    var data = await r.json();
    if (!data || data.error) return null;
    return data.verification || null;
  } catch(e) { return null; }
}

/* ---------- Главная проверка при загрузке ---------- */
async function gateByVerification() {
  if (localStorage.getItem('user_role') === 'admin') return false;
  if (window.adminViewingEmail) return false;

  var token = getSessionToken();
  if (!token) return false;

  var v = await checkVerificationStatus();
  if (!v) {
    // нет верификации — показать экран верификации
    showVerifyScreen();
    showVerifyStep(1);
    return true;
  }
  if (v.status === 'pending') {
    showPendingScreen();
    return true;
  }
  if (v.status === 'rejected') {
    showRejectedScreen(v.reason);
    return true;
  }
  if (v.status === 'approved') {
    // ок — пускаем в интерфейс
    var p = document.getElementById('pendingScreen');
    if (p) p.classList.remove('on');
    var rr = document.getElementById('rejectedScreen');
    if (rr) rr.classList.remove('on');
    var vs = document.getElementById('verifyScreen');
    if (vs) vs.classList.remove('on');
    return false;
  }
  return false;
}
window.gateByVerification = gateByVerification;

/* ---------- Периодическая проверка статуса (пока pending) ---------- */
setInterval(async function(){
  var p = document.getElementById('pendingScreen');
  if (!p || !p.classList.contains('on')) return;
  var v = await checkVerificationStatus();
  if (!v) return;
  if (v.status === 'approved') {
    if (typeof toast === 'function') toast('✅ Verification approved!');
    if (typeof playChime === 'function') playChime();
    p.classList.remove('on');
    // обновим state и пустим в интерфейс
    if (typeof loadFromServer === 'function') {
      loadFromServer(function(){
        if (typeof render === 'function') render();
      });
    }
  } else if (v.status === 'rejected') {
    showRejectedScreen(v.reason);
  }
}, 8000);

/* ---------- Навешиваем submit на кнопку шага 3 ---------- */
(function(){
  var tryBind = function(){
    var btn = document.getElementById('verifyNext3');
    if (btn && !btn._realBound) {
      btn._realBound = true;
      btn.onclick = function(e){
        e.preventDefault();
        window.submitRealVerification();
      };
    }
  };
  document.addEventListener('DOMContentLoaded', tryBind);
  setTimeout(tryBind, 500);
  setTimeout(tryBind, 2000);
})();

/* ============================================================
   ADMIN: VERIFICATIONS TAB
   ============================================================ */

window.loadAdminVerifications = async function() {
  var box = document.getElementById('adminVerifsList');
  if (!box) return;
  box.innerHTML = '<div class="admin-empty">Loading...</div>';

  try {
    var token = getSessionToken();
    if (!token) { box.innerHTML = '<div class="admin-empty">No token</div>'; return; }

    var r = await fetch(WORKER_URL + '?action=listVerifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token })
    });
    var data = await r.json();
    if (!data.ok) { box.innerHTML = '<div class="admin-empty">Error: ' + (data.error || 'Failed') + '</div>'; return; }

    var list = data.verifications || [];
    var pendingCount = list.filter(function(v){ return v.status === 'pending'; }).length;
    var navBadge = document.getElementById('navVerifCount');
    if (navBadge) {
      if (pendingCount > 0) { navBadge.textContent = pendingCount; navBadge.style.display = 'inline-block'; }
      else { navBadge.style.display = 'none'; }
    }

    if (!list.length) {
      box.innerHTML = '<div class="admin-empty">No verifications yet</div>';
      return;
    }

    var html = '';
    list.forEach(function(v){
      var statusColor = v.status === 'approved' ? '#34d399' : v.status === 'rejected' ? '#f87171' : '#fbbf24';
      var statusLabel = v.status === 'approved' ? '✅ Approved' : v.status === 'rejected' ? '❌ Rejected' : '⏳ Pending';
      var safeEmail = String(v.email).replace(/'/g, "\\'");

      html += '<div class="admin-client-card" style="margin-bottom:14px;">' +
        '<div class="admin-client-top">' +
          '<div class="admin-client-avatar">🪪</div>' +
          '<div class="admin-client-info">' +
            '<div class="admin-client-name">' + (v.name || v.email) + '</div>' +
            '<div class="admin-client-email">' + v.email + '</div>' +
            '<div style="font-size:11px;color:#8b95a5;margin-top:4px">Doc: ' + (v.docType || '—') + ' • Submitted: ' + (v.submittedAt ? new Date(v.submittedAt).toLocaleString('en-GB') : '—') + '</div>' +
          '</div>' +
          '<div class="admin-client-badge" style="background:rgba(255,255,255,0.05);color:' + statusColor + '">' + statusLabel + '</div>' +
        '</div>' +
        (v.personalInfo && (v.personalInfo.street || v.personalInfo.city) ?
          '<div style="font-size:12px;color:#8b95a5;margin:8px 0;padding:8px 12px;background:rgba(255,255,255,0.03);border-radius:8px;">' +
            '📍 ' + [v.personalInfo.street, v.personalInfo.city, v.personalInfo.zip, v.personalInfo.country].filter(Boolean).join(', ') +
          '</div>' : '') +
        (v.status === 'rejected' && v.reason ?
          '<div style="font-size:12px;color:#ff8a8a;margin:8px 0;">Reason: ' + v.reason + '</div>' : '') +
        '<div class="admin-client-actions" style="margin-top:12px;flex-wrap:wrap;">' +
          '<button class="btn b2" onclick="viewKycDocs(\'' + safeEmail + '\')">👁 View docs</button>' +
          (v.status !== 'approved' ?
            '<button class="btn b1" onclick="approveKyc(\'' + safeEmail + '\')">✅ Approve</button>' : '') +
          (v.status !== 'rejected' ?
            '<button class="btn b3" onclick="rejectKyc(\'' + safeEmail + '\')">❌ Reject</button>' : '') +
        '</div>' +
      '</div>';
    });
    box.innerHTML = html;

  } catch(e) {
    box.innerHTML = '<div class="admin-empty">Error: ' + e.message + '</div>';
  }
};

/* ---------- Модалка просмотра фото ---------- */
window.viewKycDocs = async function(email) {
  var token = getSessionToken();
  if (!token) return;

  var old = document.getElementById('kycDocsModal'); if (old) old.remove();

  var modal = document.createElement('div');
  modal.id = 'kycDocsModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);display:flex;align-items:center;justify-content:center;z-index:10000;padding:20px;overflow-y:auto;';
  modal.innerHTML = '<div style="background:#0f1720;border:1px solid rgba(255,255,255,0.08);border-radius:16px;max-width:700px;width:100%;padding:24px;color:#e7edf5;max-height:90vh;overflow-y:auto;">' +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">' +
      '<div style="font-weight:700;font-size:16px;">🪪 Documents — ' + email + '</div>' +
      '<button onclick="document.getElementById(\'kycDocsModal\').remove()" style="background:none;border:none;color:#8b95a5;font-size:24px;cursor:pointer;">×</button>' +
    '</div>' +
    '<div id="kycDocsContent" style="text-align:center;color:#8b95a5;">Loading...</div>' +
  '</div>';
  document.body.appendChild(modal);

  try {
    var r = await fetch(WORKER_URL + '?action=listVerifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token })
    });
    var data = await r.json();
    var v = (data.verifications || []).find(function(x){ return x.email === email; });
    if (!v || !v.docKeys || !v.docKeys.length) {
      document.getElementById('kycDocsContent').innerHTML = '<div style="padding:40px;">No documents uploaded</div>';
      return;
    }

    var imgsHtml = '';
    for (var i = 0; i < v.docKeys.length; i++) {
      var kr = await fetch(WORKER_URL + '?action=getKycDoc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token, key: v.docKeys[i] })
      });
      var kd = await kr.json();
      if (kd.ok && kd.dataUrl) {
        var label = v.docKeys[i].indexOf('selfie') !== -1 ? '🤳 Selfie' : '📘 Document';
        imgsHtml += '<div style="margin-bottom:16px;">' +
          '<div style="font-size:12px;color:#8b95a5;margin-bottom:6px;">' + label + '</div>' +
          '<img src="' + kd.dataUrl + '" style="max-width:100%;border-radius:12px;border:1px solid rgba(255,255,255,0.08);cursor:zoom-in;" onclick="window.open(this.src)">' +
        '</div>';
      }
    }
    document.getElementById('kycDocsContent').innerHTML = imgsHtml || '<div style="padding:40px;">No images</div>';
  } catch(e) {
    document.getElementById('kycDocsContent').innerHTML = '<div style="padding:40px;color:#ff8a8a;">Error: ' + e.message + '</div>';
  }
};

/* ---------- Approve с выбором типа ---------- */
window.approveKyc = function(email) {
  var old = document.getElementById('kycApproveModal'); if (old) old.remove();

  var modal = document.createElement('div');
  modal.id = 'kycApproveModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.8);display:flex;align-items:center;justify-content:center;z-index:10001;padding:20px;';
  modal.innerHTML = '<div style="background:#0f1720;border:1px solid rgba(255,255,255,0.08);border-radius:16px;max-width:420px;width:100%;padding:24px;color:#e7edf5;">' +
    '<div style="font-weight:700;font-size:16px;margin-bottom:6px;">Approve verification</div>' +
    '<div style="font-size:12px;color:#8b95a5;margin-bottom:16px;">' + email + '</div>' +
    '<div style="font-size:12px;color:#8b95a5;margin-bottom:10px;text-transform:uppercase;letter-spacing:1px;">Choose account type</div>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:20px;">' +
      '<button id="kycTypeBanking" onclick="_kycPickType(\'banking\')" style="padding:18px 12px;border-radius:12px;border:2px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.03);color:#e7edf5;cursor:pointer;text-align:center;font-family:inherit;">' +
        '<div style="font-size:28px;margin-bottom:6px;">💼</div>' +
        '<div style="font-weight:700;">Banking</div>' +
        '<div style="font-size:10px;color:#8b95a5;margin-top:4px;">Card + IBAN + spending</div>' +
      '</button>' +
      '<button id="kycTypeExchange" onclick="_kycPickType(\'exchange\')" style="padding:18px 12px;border-radius:12px;border:2px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.03);color:#e7edf5;cursor:pointer;text-align:center;font-family:inherit;">' +
        '<div style="font-size:28px;margin-bottom:6px;">🪙</div>' +
        '<div style="font-weight:700;">Exchange</div>' +
        '<div style="font-size:10px;color:#8b95a5;margin-top:4px;">Crypto only, like Binance</div>' +
      '</button>' +
    '</div>' +
    '<div style="display:flex;gap:8px;">' +
      '<button id="kycApproveOk" onclick="_kycDoApprove(\'' + email + '\')" disabled style="flex:1;padding:12px;background:linear-gradient(135deg,#10b981,#34d399);color:#fff;border:none;border-radius:10px;font-weight:600;cursor:not-allowed;opacity:0.4;font-family:inherit;">Approve</button>' +
      '<button onclick="document.getElementById(\'kycApproveModal\').remove()" style="flex:1;padding:12px;background:rgba(255,255,255,0.05);color:#8b95a5;border:none;border-radius:10px;font-weight:600;cursor:pointer;font-family:inherit;">Cancel</button>' +
    '</div>' +
  '</div>';
  document.body.appendChild(modal);
  window._kycPickedType = null;
};

window._kycPickType = function(type) {
  window._kycPickedType = type;
  var b = document.getElementById('kycTypeBanking');
  var e = document.getElementById('kycTypeExchange');
  var ok = document.getElementById('kycApproveOk');
  [b, e].forEach(function(el){
    if (el) { el.style.borderColor = 'rgba(255,255,255,0.08)'; el.style.background = 'rgba(255,255,255,0.03)'; }
  });
  var picked = type === 'banking' ? b : e;
  if (picked) { picked.style.borderColor = '#10b981'; picked.style.background = 'rgba(16,185,129,0.1)'; }
  if (ok) { ok.disabled = false; ok.style.opacity = '1'; ok.style.cursor = 'pointer'; }
};

window._kycDoApprove = async function(email) {
  if (!window._kycPickedType) return;
  var ok = document.getElementById('kycApproveOk');
  if (ok) { ok.disabled = true; ok.textContent = 'Approving...'; }

  try {
    var token = getSessionToken();
    var r = await fetch(WORKER_URL + '?action=approveVerification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token, email: email, accountType: window._kycPickedType })
    });
    var data = await r.json();
    if (data.ok) {
      if (typeof toast === 'function') toast('✅ Approved: ' + email);
      document.getElementById('kycApproveModal').remove();
      loadAdminVerifications();
    } else {
      alert('Error: ' + (data.error || 'Failed'));
      if (ok) { ok.disabled = false; ok.textContent = 'Approve'; }
    }
  } catch(e) {
    alert('Connection error: ' + e.message);
    if (ok) { ok.disabled = false; ok.textContent = 'Approve'; }
  }
};

/* ---------- Reject с причиной ---------- */
window.rejectKyc = function(email) {
  var reason = prompt('Reason for rejection:\n\n1. Documents unclear\n2. Documents expired\n3. Selfie does not match\n4. Address not confirmed\n5. Other (enter manually)');
  if (reason === null) return;
  var map = {
    '1': 'Documents are unclear. Please upload higher quality photos.',
    '2': 'Your documents have expired. Please provide valid documents.',
    '3': 'The selfie does not match the document photo.',
    '4': 'We could not confirm your address. Please provide proof of address.',
    '5': null
  };
  var finalReason = map[reason];
  if (finalReason === null || finalReason === undefined) {
    finalReason = prompt('Enter reason manually:');
    if (!finalReason) return;
  }
  (async function(){
    try {
      var token = getSessionToken();
      var r = await fetch(WORKER_URL + '?action=rejectVerification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token, email: email, reason: finalReason })
      });
      var data = await r.json();
      if (data.ok) {
        if (typeof toast === 'function') toast('❌ Rejected: ' + email, true);
        loadAdminVerifications();
      } else {
        alert('Error: ' + (data.error || 'Failed'));
      }
    } catch(e) { alert('Connection error'); }
  })();
};

/* ---------- Обновляем showAdminTab чтобы подгружать верификации ---------- */
(function(){
  var _orig = window.showAdminTab;
  window.showAdminTab = function(tab) {
    if (typeof _orig === 'function') _orig(tab);
    if (tab === 'verifications' && typeof loadAdminVerifications === 'function') {
      loadAdminVerifications();
    }
  };
})();

/* ---------- Обновляем gate при showApp ---------- */
(function(){
  var _origShowApp = window.showApp;
  window.showApp = function() {
    if (typeof _origShowApp === 'function') _origShowApp();
    setTimeout(function(){
      if (typeof gateByVerification === 'function') gateByVerification();
    }, 300);
  };
})();
/* ============================================================
   ACCOUNT TYPE: banking vs exchange
   ============================================================ */

/* ---------- Умный applyAccountType: переключает banking ⇄ exchange ---------- */
function applyAccountType() {
  var accountType = (st.user && st.user.accountType) || null;
  var isExchange = accountType === 'exchange';

  var dash   = document.getElementById('dash');
  var exDash = document.getElementById('exchangeDash');

  if (isExchange) {
    if (dash) dash.style.display = 'none';
    if (exDash) {
      exDash.style.display = '';
      if (!exDash.classList.contains('on')) exDash.classList.add('on');
    }
    var cardsMenu = document.querySelector('.mi[data-p="cards"]');
    if (cardsMenu) cardsMenu.style.display = 'none';
    var orderMenu = document.querySelector('.mi[data-p="order"]');
    if (orderMenu) orderMenu.style.display = 'none';

    renderExchangeDash();
  } else {
    if (dash) dash.style.display = '';
    if (exDash) {
      exDash.style.display = 'none';
      exDash.classList.remove('on');
    }
    var cardsMenu2 = document.querySelector('.mi[data-p="cards"]');
    if (cardsMenu2) cardsMenu2.style.display = '';
    var orderMenu2 = document.querySelector('.mi[data-p="order"]');
    if (orderMenu2) orderMenu2.style.display = '';

    var cardWrap = document.querySelector('.nc3-card-wrap');
    if (cardWrap) cardWrap.style.display = '';
  }
}

window.applyAccountType = applyAccountType;

/* ---------- Рендер IBAN: pending vs ready ---------- */
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
    // обновим подпись
    var textEl = pending.querySelector('.iban-pending-text');
    if (textEl) textEl.textContent = 'Your IBAN is being generated...';
    var subEl = pending.querySelector('.iban-pending-sub');
    if (subEl) subEl.textContent = 'This usually takes a few minutes';
  }
}
window.renderIbanByAdmin = renderIbanByAdmin;

/* ---------- Перезаписываем startIbanGeneration чтобы НЕ генерил автоматом ---------- */
window.startIbanGeneration = function() {
  // Ничего не делаем — IBAN выдаёт админ вручную
  renderIbanByAdmin();
};

/* ---------- Перезаписываем renderIban (старую функцию) ---------- */
window.renderIban = renderIbanByAdmin;

/* ---------- Патчим render: применяем тип аккаунта + IBAN ---------- */
(function(){
  var _origRender = window.render;
  window.render = function() {
    if (typeof _origRender === 'function') _origRender.apply(this, arguments);
    try {
      applyAccountType();
      renderIbanByAdmin();
    } catch(e) {}
  };
})();

/* ---------- Вызываем при старте ---------- */
setTimeout(function(){
  applyAccountType();
  renderIbanByAdmin();
}, 1000);
setTimeout(function(){
  applyAccountType();
  renderIbanByAdmin();
}, 3000);

/* ---------- Polling IBAN каждые 10 сек (пока pending) ---------- */
setInterval(async function(){
  // только для не-админа
  if (localStorage.getItem('user_role') === 'admin' && !window.adminViewingEmail) return;
  if (window.adminViewingEmail) return;

  var pending = document.getElementById('ibanPending');
  if (!pending || pending.style.display === 'none') return;

  var token = getSessionToken();
  if (!token) return;
  try {
    var r = await fetch(WORKER_URL + '?action=getUserState', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token })
    });
    var data = await r.json();
    if (data && data.user && data.user.iban) {
      st.user = st.user || {};
      st.user.iban = data.user.iban;
      st.user.swift = data.user.swift;
      st.user.bank = data.user.bank;
      st.user.country = data.user.country;
      renderIbanByAdmin();
      if (typeof toast === 'function') toast('🏦 Your IBAN is ready!');
    }
  } catch(e) {}
}, 10000);

/* ============================================================
   ADMIN: SET IBAN UI
   ============================================================ */

window.adminSetIban = function(email) {
  if (!email) return;
  var old = document.getElementById('adminIbanModal'); if (old) old.remove();

  var modal = document.createElement('div');
  modal.id = 'adminIbanModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.8);display:flex;align-items:center;justify-content:center;z-index:10000;padding:20px;';
  modal.innerHTML =
    '<div style="background:#0f1720;border:1px solid rgba(139,92,246,0.2);border-radius:20px;width:100%;max-width:460px;padding:24px;color:#e7edf5;">' +
      '<div style="font-weight:700;font-size:18px;margin-bottom:4px;">🏦 Issue IBAN</div>' +
      '<div style="font-size:13px;color:#8b95a5;margin-bottom:20px;">' + email + '</div>' +
      '<label style="display:block;color:#8b95a5;font-size:11px;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">IBAN</label>' +
      '<input id="adminIbanInput" type="text" placeholder="SE1234567890123456789012" style="width:100%;padding:11px 14px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:10px;color:#e7edf5;font-size:13px;outline:none;box-sizing:border-box;font-family:monospace;">' +
      '<label style="display:block;color:#8b95a5;font-size:11px;text-transform:uppercase;letter-spacing:1px;margin:14px 0 6px;">SWIFT / BIC</label>' +
      '<input id="adminSwiftInput" type="text" placeholder="ESSESESSXXX" value="ESSESESSXXX" style="width:100%;padding:11px 14px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:10px;color:#e7edf5;font-size:13px;outline:none;box-sizing:border-box;font-family:monospace;">' +
      '<label style="display:block;color:#8b95a5;font-size:11px;text-transform:uppercase;letter-spacing:1px;margin:14px 0 6px;">Bank name</label>' +
      '<input id="adminBankInput" type="text" placeholder="NordicCrypto Bank AB" value="NordicCrypto Bank AB" style="width:100%;padding:11px 14px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:10px;color:#e7edf5;font-size:13px;outline:none;box-sizing:border-box;">' +
      '<label style="display:block;color:#8b95a5;font-size:11px;text-transform:uppercase;letter-spacing:1px;margin:14px 0 6px;">Country code</label>' +
      '<input id="adminCountryInput" type="text" placeholder="SE" value="SE" maxlength="2" style="width:100%;padding:11px 14px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:10px;color:#e7edf5;font-size:13px;outline:none;box-sizing:border-box;font-family:monospace;text-transform:uppercase;">' +
      '<div id="adminIbanErr" style="display:none;margin-top:12px;padding:8px 12px;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:8px;color:#f87171;font-size:12px;"></div>' +
      '<div style="display:flex;gap:8px;margin-top:20px;">' +
        '<button id="adminIbanSave" onclick="adminSaveIban(\'' + email + '\')" style="flex:1;padding:12px;background:linear-gradient(135deg,#5f2ee5,#8b5cf6);color:#fff;border:none;border-radius:10px;font-weight:600;cursor:pointer;font-family:inherit;">Save</button>' +
        '<button onclick="document.getElementById(\'adminIbanModal\').remove()" style="flex:1;padding:12px;background:rgba(255,255,255,0.05);color:#8b95a5;border:none;border-radius:10px;font-weight:600;cursor:pointer;font-family:inherit;">Cancel</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(modal);
  setTimeout(function(){ var el = document.getElementById('adminIbanInput'); if (el) el.focus(); }, 100);
};

window.adminSaveIban = async function(email) {
  var iban = (document.getElementById('adminIbanInput') || {}).value || '';
  var swift = (document.getElementById('adminSwiftInput') || {}).value || '';
  var bank = (document.getElementById('adminBankInput') || {}).value || '';
  var country = (document.getElementById('adminCountryInput') || {}).value || '';
  var errEl = document.getElementById('adminIbanErr');

  iban = iban.trim().replace(/\s/g, '').toUpperCase();
  if (!iban || iban.length < 15) {
    if (errEl) { errEl.textContent = 'Enter valid IBAN (min 15 chars)'; errEl.style.display = 'block'; }
    return;
  }
  if (errEl) errEl.style.display = 'none';

  var btn = document.getElementById('adminIbanSave');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }

  try {
    var token = getSessionToken();
    var r = await fetch(WORKER_URL + '?action=setIban', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token, email: email, iban: iban, swift: swift, bank: bank, country: country })
    });
    var data = await r.json();
    if (data.ok) {
      if (typeof toast === 'function') toast('✓ IBAN saved');
      document.getElementById('adminIbanModal').remove();
      if (typeof loadAdminUsers === 'function') loadAdminUsers();
    } else {
      if (errEl) { errEl.textContent = data.error || 'Failed'; errEl.style.display = 'block'; }
      if (btn) { btn.disabled = false; btn.textContent = 'Save'; }
    }
  } catch(e) {
    if (errEl) { errEl.textContent = 'Connection error'; errEl.style.display = 'block'; }
    if (btn) { btn.disabled = false; btn.textContent = 'Save'; }
  }
};
/* ============================================================
   EXCHANGE DASHBOARD — рендер
   ============================================================ */
var _exPricesCache = null;

async function loadExchangePrices() {
  try {
    var r = await fetch(WORKER_URL + '?action=multiPrices');
    var d = await r.json();
    if (d && d.ok && d.coins) {
      _exPricesCache = d.coins;
      renderExchangeCoins();
      renderExchangeAssets();
    }
  } catch(e) {}
}

function renderExchangeCoins() {
  var box = document.getElementById('exCoinsList');
  if (!box || !_exPricesCache) return;
  var html = '';
  _exPricesCache.forEach(function(c){
    var up = c.change24h >= 0;
    var arrow = up ? '▲' : '▼';
    html += '<div class="ex-coin-row">' +
      '<div class="ex-coin-icon" style="background:linear-gradient(135deg,' + c.icon + ',rgba(255,255,255,.2))">' + c.symbol.charAt(0) + '</div>' +
      '<div>' +
        '<div class="ex-coin-name">' + c.name + '</div>' +
        '<div class="ex-coin-symbol">' + c.symbol + ' / USD</div>' +
      '</div>' +
      '<div class="ex-coin-price">' +
        '<strong>$' + Number(c.usd).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2}) + '</strong>' +
        '<span class="ex-coin-change ' + (up ? 'up' : 'down') + '">' + arrow + ' ' + Math.abs(c.change24h).toFixed(2) + '%</span>' +
      '</div>' +
    '</div>';
  });
  box.innerHTML = html;
}

function renderExchangeAssets() {
  var btcEl = document.getElementById('exBtcAmt');
  var ethEl = document.getElementById('exEthAmt');
  var btcVal = document.getElementById('exBtcVal');
  var ethVal = document.getElementById('exEthVal');
  if (btcEl) btcEl.textContent = (st.btc || 0).toFixed(8) + ' BTC';
  if (ethEl) ethEl.textContent = (st.eth || 0).toFixed(8) + ' ETH';
  if (btcVal) btcVal.textContent = '$' + ((st.btc || 0) * (st.btcP || 0)).toLocaleString('en-US',{minimumFractionDigits:2, maximumFractionDigits:2});
  if (ethVal) ethVal.textContent = '$' + ((st.eth || 0) * (st.ethP || 0)).toLocaleString('en-US',{minimumFractionDigits:2, maximumFractionDigits:2});
}

function renderExchangeDash() {
  // Приветствие
  var greet = document.getElementById('exGreeting');
  if (greet) {
    var h = new Date().getHours();
    greet.textContent = (h >= 5 && h < 12) ? 'Good morning' :
                        (h >= 12 && h < 18) ? 'Good afternoon' :
                        (h >= 18 && h < 23) ? 'Good evening' : 'Good night';
  }
  var nameEl = document.getElementById('exName');
  if (nameEl) {
    var n = localStorage.getItem('user_name') || '';
    nameEl.textContent = n && n !== 'User' ? n.split(' ')[0] : '';
  }

  // Балансы
  var balEl = document.getElementById('exBalance');
  if (balEl) balEl.textContent = '$' + (st.usd || 0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});

  var balBtc = document.getElementById('exBalanceBtc');
  if (balBtc && st.btcP) {
    var btcEquiv = (st.usd || 0) / st.btcP;
    balBtc.textContent = '≈ ' + btcEquiv.toFixed(8) + ' BTC';
  }

  // Stats
  var pnlEl = document.getElementById('exPnl24h');
  if (pnlEl) {
    var deposits = (st.txs || []).filter(function(t){ return t.amt > 0; }).reduce(function(s,t){ return s + t.amt; }, 0);
    var pnl = (st.usd || 0) - deposits;
    var pct = deposits > 0 ? (pnl / deposits * 100) : 0;
    var up = pnl >= 0;
    pnlEl.textContent = (up ? '+' : '') + pct.toFixed(2) + '%';
    pnlEl.style.color = up ? '#10b981' : '#ef4444';
  }

  var depEl = document.getElementById('exTotalDeposits');
  if (depEl) {
    var totalDep = (st.txs || []).filter(function(t){ return t.amt > 0; }).reduce(function(s,t){ return s + t.amt; }, 0);
    depEl.textContent = '$' + totalDep.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  }

  var cntEl = document.getElementById('exAssetsCount');
  if (cntEl) {
    var cnt = 0;
    if ((st.btc || 0) > 0) cnt++;
    if ((st.eth || 0) > 0) cnt++;
    if ((st.usd || 0) > 0) cnt++;
    cntEl.textContent = cnt;
  }

  // IBAN
  renderExchangeIban();

  // Recent tx
  renderExchangeTx();

  // Chart
  renderExchangeChart('1');

  // Prices
  loadExchangePrices();
}

function renderExchangeIban() {
  var pending = document.getElementById('exIbanPending');
  var ready   = document.getElementById('exIbanReady');
  if (!pending || !ready) return;

  var iban = st.user && st.user.iban;
  if (iban) {
    pending.style.display = 'none';
    ready.style.display = 'flex';
    var el;
    el = document.getElementById('exMyIban');    if (el) el.textContent = iban.replace(/(.{4})/g, '$1 ').trim();
    el = document.getElementById('exMySwift');   if (el) el.textContent = st.user.swift || '—';
    el = document.getElementById('exMyBank');    if (el) el.textContent = st.user.bank || '—';
    el = document.getElementById('exMyCountry'); if (el) el.textContent = (st.user.country || '—') + ' ' + (st.user.country === 'SE' ? '🇸🇪' : '');
  } else {
    pending.style.display = 'block';
    ready.style.display = 'none';
  }
}

function renderExchangeTx() {
  var box = document.getElementById('exRecentTx');
  if (!box) return;
  var txs = (st.txs || []).slice().sort(function(a,b){ return (b.ts||0) - (a.ts||0); }).slice(0, 5);
  if (!txs.length) {
    box.innerHTML = '<div class="ex-empty">No transactions yet</div>';
    return;
  }
  var html = '';
  txs.forEach(function(t){
    var amt = t.amt || 0;
    var cls = amt >= 0 ? 'plus' : 'minus';
    var sym = amt >= 0 ? '+' : '';
    var badge = '';
    if (t.status === 'Completed') badge = '<div class="recent-tx-badge ok">✓ Completed</div>';
    else if (t.status === 'Processing') badge = '<div class="recent-tx-badge proc">⏳ Processing</div>';
    else if (t.status === 'Under Review') badge = '<div class="recent-tx-badge pend">⏳ Under review</div>';
    else if (t.status === 'Rejected') badge = '<div class="recent-tx-badge fail">✗ Rejected</div>';

    html += '<div class="recent-tx-item">' +
      '<div class="recent-tx-icon ' + (amt >= 0 ? 'deposit' : 'withdrawal') + '">' + (amt >= 0 ? '💰' : '💸') + '</div>' +
      '<div class="recent-tx-info">' +
        '<div class="recent-tx-desc">' + (t.desc || 'Transaction') + '</div>' +
        '<div class="recent-tx-time">' + (typeof timeAgo === 'function' ? timeAgo(t.ts || Date.now()) : '') + '</div>' +
        badge +
      '</div>' +
      '<div class="recent-tx-amount ' + cls + '">' + sym + '$' + Math.abs(amt).toFixed(2) + '</div>' +
    '</div>';
  });
  box.innerHTML = html;
}

function renderExchangeChart(range) {
  var box = document.getElementById('exPortfolioChart');
  if (!box) return;
  var labels = document.getElementById('exChartStart');
  var labelsEnd = document.getElementById('exChartEnd');

  // Строим точки из balanceHistory
  var hist = st.balanceHistory || [];
  var points = [];

  if (hist.length > 2) {
    points = hist.slice(-100).map(function(p){ return { t: p.t, v: p.v }; });
  } else {
    // fallback: последние 24 точки
    for (var i = 0; i < 24; i++) {
      points.push({ t: Date.now() - (24 - i) * 3600 * 1000, v: st.usd * (0.6 + Math.random() * 0.4) });
    }
  }

  if (points.length < 2) {
    box.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#7a8a9e;font-size:.85rem">No chart data yet</div>';
    return;
  }

  var w = 600, h = 180, pad = 12;
  var minT = points[0].t, maxT = points[points.length-1].t;
  var minV = Infinity, maxV = -Infinity;
  points.forEach(function(p){ if (p.v < minV) minV = p.v; if (p.v > maxV) maxV = p.v; });
  if (maxV === minV) maxV = minV + 1;
  var padV = (maxV - minV) * 0.15;
  minV -= padV; maxV += padV;

  var coords = points.map(function(p){
    var x = pad + ((p.t - minT) / (maxT - minT)) * (w - pad * 2);
    var y = pad + (1 - (p.v - minV) / (maxV - minV)) * (h - pad * 2);
    return x.toFixed(1) + ',' + y.toFixed(1);
  });

  var linePath = 'M' + coords.join(' L');
  var last = coords[coords.length-1].split(',');
  var fillPath = linePath + ' L' + last[0] + ',' + (h - pad) + ' L' + pad + ',' + (h - pad) + ' Z';

  var svg = '<svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none">' +
    '<defs>' +
      '<linearGradient id="exGrad" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0%" stop-color="#a78bfa" stop-opacity="0.5"/>' +
        '<stop offset="100%" stop-color="#a78bfa" stop-opacity="0"/>' +
      '</linearGradient>' +
      '<linearGradient id="exLine" x1="0" y1="0" x2="1" y2="0">' +
        '<stop offset="0%" stop-color="#8b5cf6"/>' +
        '<stop offset="100%" stop-color="#ec4899"/>' +
      '</linearGradient>' +
    '</defs>' +
    '<path d="' + fillPath + '" fill="url(#exGrad)"/>' +
    '<path d="' + linePath + '" fill="none" stroke="url(#exLine)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<circle cx="' + last[0] + '" cy="' + last[1] + '" r="5" fill="#ec4899"><animate attributeName="r" values="5;8;5" dur="2s" repeatCount="indefinite"/></circle>' +
  '</svg>';
  box.innerHTML = svg;

  if (labels) labels.textContent = new Date(minT).toLocaleDateString('en-GB', {day:'2-digit', month:'short'});
  if (labelsEnd) labelsEnd.textContent = new Date(maxT).toLocaleDateString('en-GB', {day:'2-digit', month:'short'});
}

/* ---------- Табы графика ---------- */
document.addEventListener('DOMContentLoaded', function(){
  document.querySelectorAll('.ex-tab').forEach(function(tab){
    tab.onclick = function(){
      document.querySelectorAll('.ex-tab').forEach(function(t){ t.classList.remove('on'); });
      this.classList.add('on');
      renderExchangeChart(this.getAttribute('data-range'));
    };
  });

  var btnCopyIban = document.getElementById('exCopyIban');
  if (btnCopyIban) {
    btnCopyIban.onclick = function(){
      if (st.user && st.user.iban) {
        navigator.clipboard.writeText(st.user.iban).then(function(){
          if (typeof toast === 'function') toast('IBAN copied');
        });
      } else {
        if (typeof toast === 'function') toast('IBAN not ready yet', true);
      }
    };
  }

  // Кнопки Deposit/Withdraw/Trade
  var btnDep = document.getElementById('exBtnDeposit');
  if (btnDep) btnDep.onclick = function(){
    var b = document.getElementById('btnAdd');
    if (b) b.click();
    else if (typeof openModal === 'function') openModal('add');
  };
  var btnWd = document.getElementById('exBtnWithdraw');
  if (btnWd) btnWd.onclick = function(){
    if (typeof openWithdraw === 'function') openWithdraw();
  };
  var btnTrade = document.getElementById('exBtnTrade');
  if (btnTrade) btnTrade.onclick = function(){
    if (typeof toast === 'function') toast('Trading terminal: coming soon');
  };
});

/* ---------- Обновление цен каждые 60 сек ---------- */
setInterval(function(){
  var exDash = document.getElementById('exchangeDash');
  if (exDash && exDash.style.display !== 'none' && exDash.classList.contains('on')) {
    loadExchangePrices();
  }
}, 60000);

/* ---------- Патчим render() чтобы Exchange обновлялся ---------- */
(function(){
  var _origRender = window.render;
  window.render = function() {
    if (typeof _origRender === 'function') _origRender.apply(this, arguments);
    try {
      var accountType = (st.user && st.user.accountType) || null;
      if (accountType === 'exchange') {
        renderExchangeDash();
      }
    } catch(e) { console.warn('[exchange render]', e); }
  };
})();

console.log('%c[exchange-dash] ✅ Exchange dashboard loaded','color:#a78bfa;font-weight:bold;font-size:13px');
/* ============================================================
   ⚠️ FINAL OVERRIDE — жёстко отключает старую имитацию верификации
   и подключает новую реальную систему. ВСТАВЛЯТЬ В КОНЕЦ app.js
   ============================================================ */
(function(){
  'use strict';
  console.log('[FINAL-OVERRIDE] запуск...');

  /* ---------- 1. Отключаем старую startVerification ---------- */
  window.startVerification = function() {
    console.log('[FINAL-OVERRIDE] старая startVerification ЗАБЛОКИРОВАНА');
    // Вместо старой имитации — вызываем реальную отправку
    if (typeof window.submitRealVerification === 'function') {
      window.submitRealVerification();
    }
  };

  /* ---------- 2. Намертво перепривязываем кнопку verifyNext3 ---------- */
  function rebindSubmit() {
    var btn = document.getElementById('verifyNext3');
    if (!btn) return;
    // Полностью клонируем кнопку чтобы снять ВСЕ старые обработчики
    var fresh = btn.cloneNode(true);
    btn.parentNode.replaceChild(fresh, btn);
    fresh.onclick = function(e) {
      e.preventDefault();
      e.stopPropagation();
      console.log('[FINAL-OVERRIDE] Submit нажата → реальная верификация');
      if (typeof window.submitRealVerification === 'function') {
        window.submitRealVerification();
      } else {
        alert('submitRealVerification not found');
      }
    };
    console.log('[FINAL-OVERRIDE] ✓ Кнопка verifyNext3 перепривязана');
  }

  /* ---------- 3. Жёсткий gate: проверка верификации при входе ---------- */
  window._strictGate = async function() {
    if (localStorage.getItem('user_role') === 'admin') return false;
    if (window.adminViewingEmail) return false;

    var token = getSessionToken();
    if (!token) return false;

    try {
      var r = await fetch(WORKER_URL + '?action=getUserState', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token })
      });
      var data = await r.json();
      if (!data || data.error) return false;

      var v = data.verification || null;
      var side = document.getElementById('sideBar');
      var main = document.getElementById('mainApp');

      // ❌ Нет верификации — показать верификацию
      if (!v) {
        console.log('[GATE] нет верификации → показать экран верификации');
        if (side) side.style.display = 'none';
        if (main) main.style.display = 'none';
        var onb = document.getElementById('onboard'); if (onb) onb.classList.remove('on');
        var vScreen = document.getElementById('verifyScreen');
        if (vScreen) vScreen.classList.add('on');
        if (typeof showVerifyStep === 'function') showVerifyStep(1);
        return true;
      }

      // ⏳ Pending
      if (v.status === 'pending') {
        console.log('[GATE] pending → показать wait screen');
        if (side) side.style.display = 'none';
        if (main) main.style.display = 'none';
        var p = document.getElementById('pendingScreen');
        if (p) p.classList.add('on');
        var vS = document.getElementById('verifyScreen'); if (vS) vS.classList.remove('on');
        var onb2 = document.getElementById('onboard'); if (onb2) onb2.classList.remove('on');
        return true;
      }

      // ❌ Rejected
      if (v.status === 'rejected') {
        console.log('[GATE] rejected → показать rejected screen');
        if (side) side.style.display = 'none';
        if (main) main.style.display = 'none';
        var rS = document.getElementById('rejectedScreen');
        if (rS) rS.classList.add('on');
        var rEl = document.getElementById('rejectedReason');
        if (rEl) rEl.textContent = v.reason || 'Documents not accepted';
        var vS2 = document.getElementById('verifyScreen'); if (vS2) vS2.classList.remove('on');
        var onb3 = document.getElementById('onboard'); if (onb3) onb3.classList.remove('on');
        return true;
      }

      // ✅ Approved — пускаем
      if (v.status === 'approved') {
        console.log('[GATE] approved → пускаем в интерфейс');
        // скрываем все гейт-экраны
        ['pendingScreen','rejectedScreen','verifyScreen'].forEach(function(id){
          var el = document.getElementById(id);
          if (el) el.classList.remove('on');
        });
        // НЕ трогаем onboarding здесь — он отдельно
        return false;
      }

      return false;
    } catch(e) {
      console.warn('[GATE] error', e);
      return false;
    }
  };

  /* ---------- 4. Патчим showApp: после него ставим строгий gate ---------- */
  var _origShowApp = window.showApp;
  window.showApp = function() {
    if (typeof _origShowApp === 'function') _origShowApp.apply(this, arguments);
    setTimeout(function(){
      window._strictGate();
    }, 500);
    setTimeout(function(){
      window._strictGate();
    }, 2000);
  };

  /* ---------- 5. Обновляем applyAccountType: banking ⇄ exchange ---------- */
  window.applyAccountType = function() {
    var accountType = (st.user && st.user.accountType) || null;
    var isExchange = accountType === 'exchange';

    var dash   = document.getElementById('dash');
    var exDash = document.getElementById('exchangeDash');

    if (isExchange) {
      if (dash) dash.style.display = 'none';
      if (exDash) {
        exDash.style.display = '';
        if (!exDash.classList.contains('on')) exDash.classList.add('on');
      }
      var cm = document.querySelector('.mi[data-p="cards"]'); if (cm) cm.style.display = 'none';
      var om = document.querySelector('.mi[data-p="order"]'); if (om) om.style.display = 'none';
      if (typeof renderExchangeDash === 'function') renderExchangeDash();
    } else {
      if (dash) dash.style.display = '';
      if (exDash) { exDash.style.display = 'none'; exDash.classList.remove('on'); }
      var cm2 = document.querySelector('.mi[data-p="cards"]'); if (cm2) cm2.style.display = '';
      var om2 = document.querySelector('.mi[data-p="order"]'); if (om2) om2.style.display = '';
      var cw = document.querySelector('.nc3-card-wrap'); if (cw) cw.style.display = '';
    }
  };

  /* ---------- 6. Рендер Exchange-дашборда ---------- */
  window.renderExchangeDash = function() {
    var greet = document.getElementById('exGreeting');
    if (greet) {
      var h = new Date().getHours();
      greet.textContent = (h >= 5 && h < 12) ? 'Good morning' :
                          (h >= 12 && h < 18) ? 'Good afternoon' :
                          (h >= 18 && h < 23) ? 'Good evening' : 'Good night';
    }
    var nameEl = document.getElementById('exName');
    if (nameEl) {
      var n = localStorage.getItem('user_name') || '';
      nameEl.textContent = n && n !== 'User' ? n.split(' ')[0] : '';
    }

    var balEl = document.getElementById('exBalance');
    if (balEl) balEl.textContent = '$' + (st.usd || 0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});

    var balBtc = document.getElementById('exBalanceBtc');
    if (balBtc && st.btcP) balBtc.textContent = '≈ ' + ((st.usd || 0) / st.btcP).toFixed(8) + ' BTC';

    var pnlEl = document.getElementById('exPnl24h');
    if (pnlEl) {
      var deposits = (st.txs || []).filter(function(t){ return t.amt > 0; }).reduce(function(s,t){ return s + t.amt; }, 0);
      var pnl = (st.usd || 0) - deposits;
      var pct = deposits > 0 ? (pnl / deposits * 100) : 0;
      pnlEl.textContent = (pnl >= 0 ? '+' : '') + pct.toFixed(2) + '%';
      pnlEl.style.color = pnl >= 0 ? '#10b981' : '#ef4444';
    }

    var depEl = document.getElementById('exTotalDeposits');
    if (depEl) {
      var tD = (st.txs || []).filter(function(t){ return t.amt > 0; }).reduce(function(s,t){ return s + t.amt; }, 0);
      depEl.textContent = '$' + tD.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
    }

    var cntEl = document.getElementById('exAssetsCount');
    if (cntEl) {
      var c = 0;
      if ((st.btc || 0) > 0) c++;
      if ((st.eth || 0) > 0) c++;
      if ((st.usd || 0) > 0) c++;
      cntEl.textContent = c;
    }

    // IBAN
    var pending = document.getElementById('exIbanPending');
    var ready   = document.getElementById('exIbanReady');
    var iban = st.user && st.user.iban;
    if (pending && ready) {
      if (iban) {
        pending.style.display = 'none';
        ready.style.display = 'flex';
        var el;
        el = document.getElementById('exMyIban');    if (el) el.textContent
