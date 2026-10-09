/* ============================================================
   🛡️ IS ADMIN — проверка роли (added fix)
   ============================================================ */
window.isAdmin = function() {
  return localStorage.getItem('user_role') === 'admin' &&
         localStorage.getItem('user_email') === 'admin@nordiccrypto.com';
};
function isAdmin() {
  return window.isAdmin();
}

/* ============================================================
   NORDIC CRYPTO — APP.JS v3.2 — CLEAN REBUILD
   ============================================================ */

var WORKER_LOGIN_URL = 'https://nordic-deposit-checker.otis-790.workers.dev';
var WORKER_URL = WORKER_LOGIN_URL;

var DEPOSIT_WALLETS = {
  'lundgrenhem@gmail.com': {
    btc: '19YWxuHf1TbdZzZdV9FSzYfops6M2GLhe7',
    eth: '0xFB7A7956Af77061D3B5f3B357ef9c0a22CD60e97'
  }
};

var SESSION_TIMEOUT_MS = 5 * 60 * 1000;
var LOGOUT_COUNTDOWN = 60;
var sessionTimer = null, countdownTimer = null, countdownLeft = 60;

function $(i){ return document.getElementById(i); }
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
}
function fmt(n){ return '$' + Number(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}); }
function eurF(n){ return '≈ €' + Number(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}); }
function now(){ return new Date().toISOString().slice(0,10); }
function getSessionToken(){ return localStorage.getItem('session_token'); }
function setSessionToken(t){ localStorage.setItem('session_token', t); }
function clearSessionToken(){ localStorage.removeItem('session_token'); }

var def = {
  usd:0, btc:0, eth:0, btcP:68000, ethP:3200, eurR:0.92, sekR:10.45,
  currency:'USD', txs:[], order:null, card:null,
  notifications:[], withdrawals:[], balanceHistory:[],
  pendingDeposits:[], depositVerifications:[]
};
var st = JSON.parse(JSON.stringify(def));
var stateLoaded = false;
var mode = null, tt = null;
var autoCheckTimer = null, autoCheckKnown = {};
var cvvVisible = false, cvvTimer = null;
var selectedDesign = 'cosmic', onbType = 'Visa', onbCur = 'USD';

function getDepositWallet(coin){
  if (st && st.cryptoAddress){
    var addr = coin === 'BTC' ? st.cryptoAddress.btc : st.cryptoAddress.eth;
    if (addr) return addr;
  }
  var email = (window.adminViewingEmail || localStorage.getItem('user_email') || '').toLowerCase();
  var w = DEPOSIT_WALLETS[email];
  if (!w) return null;
  return coin === 'BTC' ? w.btc : w.eth;
}

/* ---------- SERVER SYNC ---------- */
function loadFromServer(cb, targetEmail){
  var token = getSessionToken();
  if (!token){ st = JSON.parse(JSON.stringify(def)); stateLoaded = true; if (cb) cb(); return; }
  var body = { token: token };
  if (targetEmail) body.email = targetEmail;
  fetch(WORKER_LOGIN_URL + '?action=getUserState', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
    .then(function(r){ return r.json(); })
    .then(function(data){
      st = (data && data.ok === false) ? JSON.parse(JSON.stringify(def)) : (data || JSON.parse(JSON.stringify(def)));
      if (!st.txs) st.txs = [];
      if (!st.balanceHistory) st.balanceHistory = [];
      if (!st.withdrawals) st.withdrawals = [];
      if (!st.pendingDeposits) st.pendingDeposits = [];
      if (!st.depositVerifications) st.depositVerifications = [];
      if (!st.card || typeof st.card !== 'object') st.card = null;
      if (!st.chat) st.chat = [];
      if (!st.ticket) st.ticket = null;
      if (!st.typing) st.typing = {};
      if (!st.verification) st.verification = null;
      if (!st.user) st.user = { verified: false, accountType: null, iban: null };
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
      if (cb) cb();
    })
    .catch(function(){
      st = JSON.parse(JSON.stringify(def));
      stateLoaded = true;
      render();
    });
}

function saveToServer(){
  if (window.adminViewingEmail) return;
  if (localStorage.getItem('user_role') === 'admin') return;
  var token = getSessionToken();
  if (!token) return;
  fetch(WORKER_LOGIN_URL + '?action=setUserState', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: token, state: st, email: window.adminViewingEmail || undefined })
  }).catch(function(){});
}

/* ---------- AUTH ---------- */
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
      method: 'POST', headers: { 'Content-Type': 'application/json' },
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
      showLoginError(data.error || 'Login failed');
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
  var email = localStorage.getItem('user_email');
  if (!token) { showLoginScreen(); return; }

  if (email) {
    hideLoginScreen();
    showApp();
    startInactivityTimer();
  }

  try {
    var res = await fetch(WORKER_LOGIN_URL + '?action=verify', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token })
    });
    var data = await res.json();
    if (data.ok && data.user) {
      localStorage.setItem('user_email', data.user.email);
      localStorage.setItem('user_role', data.user.role || 'user');
    } else {
      console.warn('[session] verify failed:', data);
    }
  } catch (e) { console.warn('[session] error:', e); }
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

  loadFromServer(function(){
    loadPrices();
    loadExchangeRates();
    initCurrencySwitcher();
    initNotifications();
    renderNotifications();
    initVerification();
    initDesignPicker();
    initRecentTx();
    initTrackingActions();
    initDepositVerification();
    initLoginLogout();
    initSignup();
    initSettings();
    initAdminPanel();
    loadCharts();
    render();

    if (!localStorage.getItem('user_email')){ showLoginScreen(); return; }

    var accountType = (st.user && st.user.accountType) || null;
    var vStatus = (st.verification && st.verification.status) || null;

    if (localStorage.getItem('user_role') !== 'admin' && !window.adminViewingEmail) {
      if (vStatus === 'pending') {
        if (side) side.style.display = 'none';
        if (main) main.style.display = 'none';
        showPendingScreen();
        return;
      }
      if (vStatus === 'rejected') {
        if (side) side.style.display = 'none';
        if (main) main.style.display = 'none';
        showRejectedScreen(st.verification.reason);
        return;
      }
      if (vStatus !== 'approved') {
        if (!st.card && accountType !== 'exchange') {
          if (side) side.style.display = 'none';
          if (main) main.style.display = 'none';
          document.getElementById('onboard').classList.add('on');
          return;
        }
        if (side) side.style.display = 'none';
        if (main) main.style.display = 'none';
        var vScreen = document.getElementById('verifyScreen');
        if (vScreen) { vScreen.classList.add('on'); vScreen.style.display = 'flex'; }
        showVerifyStep(1);
        return;
      }
    }

    if (side) side.style.display = 'flex';
    if (main) main.style.display = 'flex';

    if (!st.card && accountType !== 'exchange') {
      document.getElementById('onboard').classList.add('on');
      return;
    }

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
        method: 'POST', headers: { 'Content-Type': 'application/json' },
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
  window.adminViewingEmail = null;
  window._exPricesCache = null;

  document.querySelectorAll('.mask').forEach(function(m){ m.classList.remove('on'); });
  document.querySelectorAll('.inactivity-overlay, .dep-verify-overlay, .notif-overlay, .verify-screen, .onboard, .onb-anim-stage').forEach(function(m){ m.classList.remove('on'); });

  var ap = document.getElementById('adminPanel'); if (ap) ap.classList.remove('on');
  var np = document.getElementById('notifPanel'); if (np) np.classList.remove('on');
  var abb = document.getElementById('adminBackBar'); if (abb) abb.style.display = 'none';

  document.querySelectorAll('.mask').forEach(function(m){ m.style.display = ''; });
  showLoginScreen();
}

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

var _inactivityListenersAttached = false;
function startInactivityTimer() {
  clearTimeout(sessionTimer);
  sessionTimer = setTimeout(showInactivityModal, SESSION_TIMEOUT_MS);
  if (_inactivityListenersAttached) return;
  _inactivityListenersAttached = true;
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

/* ---------- SETTINGS ---------- */
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
        method: 'POST', headers: { 'Content-Type': 'application/json' },
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
    cpSave.textContent = 'Change';
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

/* ---------- RENDER (throttle) ---------- */
var _lastRender = 0;
function render(){
  var n = Date.now();
  if (n - _lastRender < 150) return;
  _lastRender = n;
  _renderAll();
}

function _renderAll(){
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
  renderIbanByAdmin();
  applyAccountType();
}

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
          st.balanceHistory.push({ t: nowTs, v: st.usd });
        }
        var weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        st.balanceHistory = st.balanceHistory.filter(function(p){
          return p.t > weekAgo && p.v > 0 && p.v < 1000000;
        });
        if (st.balanceHistory.length > 3000) st.balanceHistory = st.balanceHistory.slice(-3000);
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
  if (btcTrend && prevBtc) {
    var btcChg = ((st.btcP - prevBtc) / prevBtc) * 100;
    btcTrend.textContent = (btcChg >= 0 ? '▲ +' : '▼ ') + btcChg.toFixed(2) + '%';
  }
  if (ethTrend && prevEth) {
    var ethChg = ((st.ethP - prevEth) / prevEth) * 100;
    ethTrend.textContent = (ethChg >= 0 ? '▲ +' : '▼ ') + ethChg.toFixed(2) + '%';
  }
}

function refreshBalanceFromServer(){
  if (localStorage.getItem('user_role') === 'admin' && !window.adminViewingEmail) return;
  var token = getSessionToken();
  if (!token) return;
  var email = window.adminViewingEmail || localStorage.getItem('user_email');
  if (!email) return;

  fetch(WORKER_LOGIN_URL + '?action=getUserState', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
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
    if (d.verification) st.verification = d.verification;
    if (d.pendingDeposits) st.pendingDeposits = d.pendingDeposits;
    if (changed) render();
    if (typeof updateChatBadge === 'function') updateChatBadge();
  })
  .catch(function(){});
}

setInterval(function(){
  if (localStorage.getItem('user_role') === 'admin' && !window.adminViewingEmail) return;
  if (!localStorage.getItem('user_email') && !window.adminViewingEmail) return;
  refreshBalanceFromServer();
}, 60000);

function fmtCurrency(usdAmount){
  var cur = st.currency || 'USD';
  var amount = usdAmount, symbol = '$', suffix = '';
  if (cur === 'EUR'){ amount = usdAmount * st.eurR; symbol = '€'; }
  else if (cur === 'SEK'){ amount = usdAmount * st.sekR; symbol = 'kr '; suffix = ' SEK'; }
  else if (cur === 'NOK'){ amount = usdAmount * (st.nokR || 10.5); symbol = 'kr '; suffix = ' NOK'; }
  else if (cur === 'DKK'){ amount = usdAmount * (st.dkkR || 6.9); symbol = 'kr '; suffix = ' DKK'; }
  else if (cur === 'GBP'){ amount = usdAmount * (st.gbpR || 0.79); symbol = '£'; }
  var formatted = Number(amount).toLocaleString('en-US',{minimumFractionDigits:2, maximumFractionDigits:2});
  return symbol + formatted + suffix;
}

function loadExchangeRates(){
  fetch(WORKER_URL + '?action=rates')
    .then(function(r){ return r.json(); })
    .then(function(d){
      if (d && d.rates){
        var r = d.rates;
        if (r.EUR) st.eurR = Number(r.EUR);
        if (r.SEK) st.sekR = Number(r.SEK);
        if (r.NOK) st.nokR = Number(r.NOK);
        if (r.DKK) st.dkkR = Number(r.DKK);
        if (r.GBP) st.gbpR = Number(r.GBP);

        var rateEUR = document.getElementById('rateEUR');
        if (rateEUR) rateEUR.textContent = '1$ = ' + st.eurR.toFixed(2) + '€';
        var rateSEK = document.getElementById('rateSEK');
        if (rateSEK) rateSEK.textContent = '1$ = ' + st.sekR.toFixed(2) + 'kr';
        var rateNOK = document.getElementById('rateNOK');
        if (rateNOK && r.NOK) rateNOK.textContent = '1$ = ' + Number(r.NOK).toFixed(2) + 'kr';
        var rateDKK = document.getElementById('rateDKK');
        if (rateDKK && r.DKK) rateDKK.textContent = '1$ = ' + Number(r.DKK).toFixed(2) + 'kr';
        var rateGBP = document.getElementById('rateGBP');
        if (rateGBP && r.GBP) rateGBP.textContent = '1$ = ' + Number(r.GBP).toFixed(2) + '£';

        render();
      }
    })
    .catch(function(e){ console.warn('Rates failed', e); });
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
  if (typeof renderExchangeDash === 'function' && st.user && st.user.accountType === 'exchange') {
    renderExchangeDash();
  }
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

/* === END OF PART A === */
