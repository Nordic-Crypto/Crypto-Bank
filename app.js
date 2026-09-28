/* ========== SETTINGS ========== */
function initSettings() {
  var btnSettings = document.getElementById('settingsBtn');
  var mask = document.getElementById('settingsMask');
  var closeBtn = document.getElementById('btnSettingsClose');
  var logoutBtn = document.getElementById('btnLogout');
  var changePassBtn = document.getElementById('btnChangePassword');
  var deleteBtn = document.getElementById('btnDeleteAccount');
  var changePassMask = document.getElementById('changePassMask');
  var cpSave = document.getElementById('cpSave');
  var cpCancel = document.getElementById('cpCancel');

  var nameEl = document.getElementById('settingsName');
  var emailEl = document.getElementById('settingsEmail');
  var roleEl = document.getElementById('settingsRole');
  if (nameEl) nameEl.textContent = localStorage.getItem('user_name') || 'User';
  if (emailEl) emailEl.textContent = localStorage.getItem('user_email') || '—';
  if (roleEl) {
    var role = localStorage.getItem('user_role') || 'user';
    roleEl.textContent = role === 'admin' ? 'Admin' : 'User';
    roleEl.style.background = role === 'admin' ? 'rgba(124,58,237,.15)' : 'rgba(0,212,255,.12)';
    roleEl.style.color = role === 'admin' ? '#a78bfa' : 'var(--pri)';
  }

  if (btnSettings) btnSettings.onclick = function(){
    if (mask) mask.classList.add('on');
  };
  if (closeBtn) closeBtn.onclick = function(){
    if (mask) mask.classList.remove('on');
  };

  if (logoutBtn) logoutBtn.onclick = function(){
    if (!confirm('Log out of your account?')) return;
    doLogout();
  };

  if (changePassBtn) changePassBtn.onclick = function(){
    if (mask) mask.classList.remove('on');
    if (changePassMask) changePassMask.classList.add('on');
    var o = document.getElementById('cpOld'); if (o) o.value = '';
    var n = document.getElementById('cpNew'); if (n) n.value = '';
    var c = document.getElementById('cpConfirm'); if (c) c.value = '';
    var e1 = document.getElementById('cpError'); if (e1) e1.style.display = 'none';
    var e2 = document.getElementById('cpSuccess'); if (e2) e2.style.display = 'none';
  };

  // ← Back button
  var cpBack = document.getElementById('cpBack');
  if (cpBack) cpBack.onclick = function(){
    if (changePassMask) changePassMask.classList.remove('on');
    if (mask) mask.classList.add('on');
  };

  // Close — закрывает всё
  if (cpCancel) cpCancel.onclick = function(){
    if (changePassMask) changePassMask.classList.remove('on');
  };

  // Глазки в полях пароля
  var cpToggles = document.querySelectorAll('.pass-toggle[data-target]');
  for (var i = 0; i < cpToggles.length; i++){
    cpToggles[i].onclick = function(){
      var targetId = this.getAttribute('data-target');
      var input = document.getElementById(targetId);
      if (!input) return;
      if (input.type === 'password'){
        input.type = 'text';
        this.textContent = '🙈';
      } else {
        input.type = 'password';
        this.textContent = '👁';
      }
    };
  }

  if (cpSave) cpSave.onclick = async function(){
    var oldP = document.getElementById('cpOld').value;
    var newP = document.getElementById('cpNew').value;
    var confP = document.getElementById('cpConfirm').value;
    var errEl = document.getElementById('cpError');
    var okEl = document.getElementById('cpSuccess');

    errEl.style.display = 'none';
    okEl.style.display = 'none';

    if (!oldP || !newP) {
      errEl.textContent = 'Please fill all fields';
      errEl.style.display = 'block';
      return;
    }
    if (newP.length < 6) {
      errEl.textContent = 'Password must be at least 6 characters';
      errEl.style.display = 'block';
      return;
    }
    if (newP !== confP) {
      errEl.textContent = 'Passwords do not match';
      errEl.style.display = 'block';
      return;
    }

    cpSave.disabled = true;
    cpSave.textContent = 'Changing...';

    try {
      var res = await fetch(WORKER_LOGIN_URL + '?action=changePassword', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: getSessionToken(),
          oldPassword: oldP,
          newPassword: newP
        })
      });
      var data = await res.json();

      if (data.ok) {
        okEl.textContent = '✓ Password changed successfully';
        okEl.style.display = 'block';
        playChime();
        setTimeout(function(){
          if (changePassMask) changePassMask.classList.remove('on');
        }, 2000);
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
    if (!confirm('Delete your account? This will remove ALL data permanently. This cannot be undone.')) return;
    if (!confirm('Are you SURE? All your funds, cards, and transactions will be erased.')) return;
    st = {
      usd: 0, btc: 0, eth: 0,
      btcP: 68000, ethP: 3200, eurR: 0.92, sekR: 10.45,
      currency: 'USD',
      txs: [], order: null, card: null, notifications: []
    };
    saveToServer();
    render();
    if (mask) mask.classList.remove('on');
    toast('Account data deleted');
    setTimeout(function(){ doLogout(); }, 1500);
  };
}

/* ========== AUTHENTICATION ========== */
var WORKER_LOGIN_URL = 'https://nordic-deposit-checker.otis-790.workers.dev';
var SESSION_TIMEOUT_MS = 5 * 60 * 1000; // 5 минут
var LOGOUT_COUNTDOWN = 60; // 60 секунд
var sessionTimer = null;
var countdownTimer = null;
var countdownLeft = 60;

function getSessionToken() {
  return localStorage.getItem('session_token');
}

function setSessionToken(token) {
  localStorage.setItem('session_token', token);
}

function clearSessionToken() {
  localStorage.removeItem('session_token');
}

async function doLogin() {
  var emailEl = document.getElementById('loginEmail');
  var passEl = document.getElementById('loginPassword');
  var errorEl = document.getElementById('loginError');
  var btnLogin = document.getElementById('btnLogin');
  var loginForm = document.getElementById('loginForm');
  var loginLoading = document.getElementById('loginLoading');

  var email = emailEl.value.trim().toLowerCase();
  var password = passEl.value;

  if (!email || !password) {
    showLoginError('Please enter email and password');
    return;
  }

  // Показать загрузку
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
      // Сначала ОЧИЩАЕМ старые данные
      localStorage.removeItem('user_email');
      localStorage.removeItem('user_role');
      localStorage.removeItem('user_name');

      // Потом записываем свежие
      setSessionToken(data.token);
      localStorage.setItem('user_email', data.user.email);
      localStorage.setItem('user_role', data.user.role);
      localStorage.setItem('user_name', data.user.name || 'User');

      // Скрыть логин, показать приложение
      hideLoginScreen();
      showApp();
      startInactivityTimer();
      playChime();
      return;
    } else {
      // Ошибка
      loginForm.style.display = 'block';
      loginLoading.style.display = 'none';
      btnLogin.disabled = false;
      var errMsg = data.error || 'Login failed';
      if (data.attempts && data.attempts >= 3) {
        errMsg += ' (' + data.attempts + ' attempts)';
      }
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
  if (errorEl) {
    errorEl.textContent = msg;
    errorEl.style.display = 'block';
  }
}

async function checkSession() {
  var token = getSessionToken();
  if (!token) {
    showLoginScreen();
    return;
  }

  try {
    var res = await fetch(WORKER_LOGIN_URL + '?action=verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token })
    });
    var data = await res.json();

    if (data.ok && data.user) {
      // Session valid
      localStorage.setItem('user_email', data.user.email);
      localStorage.setItem('user_role', data.user.role || 'user');
      hideLoginScreen();
      showApp();
      startInactivityTimer();
    } else {
      // Session invalid
      clearSessionToken();
      showLoginScreen();
    }
  } catch (e) {
    // Если Worker недоступен — показываем логин
    showLoginScreen();
  }
}

function showLoginScreen() {
  var login = document.getElementById('loginScreen');
  var side = document.getElementById('sideBar');
  var main = document.getElementById('mainApp');
  if (login) login.classList.remove('hidden');
  if (side) side.style.display = 'none';
  if (main) main.style.display = 'none';
  
  // Закрыть модалку Sign Up, если она вдруг открыта
  var suMask = document.getElementById('signupMask');
  if (suMask) suMask.classList.remove('on');
  
  // Сброс формы
  var emailEl = document.getElementById('loginEmail');
  var passEl = document.getElementById('loginPassword');
  var form = document.getElementById('loginForm');
  var loading = document.getElementById('loginLoading');
  var err = document.getElementById('loginError');
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
  // Проверка роли — если admin, показываем админ-панель
  if (isAdmin()) {
    showAdminPanel();
    return;
  }

  var side = document.getElementById('sideBar');
  var main = document.getElementById('mainApp');
  if (side) side.style.display = 'flex';
  if (main) main.style.display = 'flex';

  // Загружаем state и инициализируем всё
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
    setInterval(loadPrices, 5 * 60 * 1000);
    setInterval(loadExchangeRates, 10 * 60 * 1000);
    setInterval(loadCharts, 15 * 60 * 1000);
    setTimeout(function(){
      if (!checkOnboarding()){
        checkVerificationNeeded();
      }
    }, 1000);
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

// Закрыть ВСЕ модалки и оверлеи
document.querySelectorAll('.mask').forEach(function(m){ m.classList.remove('on'); });
document.querySelectorAll('.overlay, .inactivity-overlay, .dep-verify-overlay, .notif-overlay, .verify-screen, .onboard, .onb-anim-stage').forEach(function(m){ m.classList.remove('on'); });

// Закрыть админ-панель
var ap = document.getElementById('adminPanel');
if (ap) ap.classList.remove('on');

// Закрыть панель уведомлений
var np = document.getElementById('notifPanel');
if (np) np.classList.remove('on');

// Скрыть админ-бар
var abb = document.getElementById('adminBackBar');
if (abb) abb.style.display = 'none';

// Сбросить inline-стили, если есть
document.querySelectorAll('.mask').forEach(function(m){ m.style.display = ''; });

showLoginScreen();
}

function initLoginLogout() {
  // Eye toggle
  var toggle = document.getElementById('passToggle');
  if (toggle) {
    toggle.onclick = function(){
      var pwd = document.getElementById('loginPassword');
      pwd.type = pwd.type === 'password' ? 'text' : 'password';
      this.textContent = pwd.type === 'password' ? '👁' : '🙈';
    };
  }

  // Кнопка Sign in
  var btnLogin = document.getElementById('btnLogin');
  if (btnLogin) btnLogin.onclick = doLogin;

  // Enter в полях
  var emailEl = document.getElementById('loginEmail');
  var passEl = document.getElementById('loginPassword');
  if (emailEl) emailEl.onkeydown = function(e){ if (e.key === 'Enter') doLogin(); };
  if (passEl) passEl.onkeydown = function(e){ if (e.key === 'Enter') doLogin(); };

  // Забыли пароль
  var forgot = document.getElementById('forgotPass');
  if (forgot) forgot.onclick = function(e){
    e.preventDefault();
    alert('Contact support: support@nordiccrypto.com');
  };

  // Кнопки в модалке неактивности
  var btnStillHere = document.getElementById('btnStillHere');
  var btnLogout = document.getElementById('btnLogoutNow');
  if (btnStillHere) btnStillHere.onclick = function(){
    hideInactivityModal();
    resetInactivityTimer();
  };
  if (btnLogout) btnLogout.onclick = function(){
    doLogout();
  };
}

function startInactivityTimer() {
  clearTimeout(sessionTimer);
  sessionTimer = setTimeout(showInactivityModal, SESSION_TIMEOUT_MS);

  // События, которые сбрасывают таймер
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
    if (countdownLeft <= 0) {
      clearInterval(countdownTimer);
      doLogout();
    }
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
/* ========== WORKER API ========== */
var WORKER_URL = 'https://nordic-deposit-checker.otis-790.workers.dev';
var def = { usd:0, btc:0, eth:0, btcP:68000, ethP:3200, eurR:0.92, sekR:10.45, currency:'USD', txs:[], order:null, card:null, notifications:[] };
var st = JSON.parse(JSON.stringify(def));
var mode = null, tt = null;
var autoCheckTimer = null;
var autoCheckKnown = {};
var cvvVisible = false;
var cvvTimer = null;

function $(i){ return document.getElementById(i); }
function fmt(n){ return '$' + Number(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}); }
function eurF(n){ return '≈ €' + Number(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}); }
function now(){ return new Date().toISOString().slice(0,10); }

function loadFromServer(cb, targetEmail){
  var token = getSessionToken();
  if (!token) {
    st = JSON.parse(JSON.stringify(def));
    stateLoaded = true;
    if (cb) cb();
    return;
  }

  var body = { token: token };
  if (targetEmail) body.email = targetEmail;   // ← НОВОЕ

  fetch(WORKER_LOGIN_URL + '?action=getUserState', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
    .then(function(r){ return r.json(); })
    .then(function(data){
      if (data && data.ok === false) {
        // Не авторизован
        console.warn('Load failed:', data.error);
        st = JSON.parse(JSON.stringify(def));
      } else {
        st = data || JSON.parse(JSON.stringify(def));
      }
      if (!st.txs) st.txs = [];
      if (!st.card || typeof st.card !== 'object') st.card = null;
      stateLoaded = true;
      render();
      setTimeout(function(){ checkOnboarding(); }, 50);
      if (cb) cb();
    })
    .catch(function(e){
      console.error('Load failed:', e);
      st = JSON.parse(JSON.stringify(def));
      stateLoaded = true;
      render();
      checkOnboarding();
    });
}

function saveToServer(){
  // 1. Не сохраняем если данные не загружены
  if (!stateLoaded) {
    console.log('[saveToServer] Skip — not loaded');
    return;
  }

  // 2. Admin не сохраняет
  if (localStorage.getItem('user_role') === 'admin') {
    console.log('[saveToServer] Skip — admin');
    return;
  }

  // 3. Проверяем токен
  var token = getSessionToken();
  if (!token) {
    console.log('[saveToServer] Skip — no token');
    return;
  }

  fetch(WORKER_LOGIN_URL + '?action=setUserState', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: token, state: st })
  }).catch(function(e){ console.error('Save failed:', e); });
}
/* ========== LIVE PRICES ========== */
function loadPrices(){
  fetch(WORKER_URL + '?action=prices')
    .then(function(r){ return r.json(); })
    .then(function(d){
      if (d && d.btc && d.eth){
        // Сохраняем предыдущие цены для расчёта движения
        var prevBtc = st.btcP || d.btc;
        var prevEth = st.ethP || d.eth;
        
        st.btcP = d.btc;
        st.ethP = d.eth;
        
        // Обновляем отображение цены
        var btcPriceEl = document.getElementById('btcPrice');
        if (btcPriceEl) btcPriceEl.textContent = fmt(d.btc);
        var ethPriceEl = document.getElementById('ethPrice');
        if (ethPriceEl) ethPriceEl.textContent = fmt(d.eth);
        
        // Обновляем % изменения за последние 24ч (или с последнего обновления)
        updateCryptoTrends(prevBtc, prevEth);
        
        // Пересчитываем баланс
        refreshBalanceFromCrypto();
        renderBalanceChart();
        
        // Перерисовываем всё
        render();
      }
    })
    .catch(function(e){ console.error('Prices load failed:', e); });
}

// Движение % (BTC/ETH)
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

/* ========== CURRENCY SWITCHER ========== */
function fmtCurrency(usdAmount){
  var cur = st.currency || 'USD';
  var amount = usdAmount;
  var symbol = '$';
  var suffix = '';
  if (cur === 'EUR'){
    amount = usdAmount * st.eurR;
    symbol = '€';
  } else if (cur === 'SEK'){
    amount = usdAmount * st.sekR;
    symbol = 'kr ';
  } else if (cur === 'NOK'){
    amount = usdAmount * (st.nokR || 10.5);
    symbol = 'kr ';
    suffix = ' NOK';
  } else if (cur === 'DKK'){
    amount = usdAmount * (st.dkkR || 6.9);
    symbol = 'kr ';
    suffix = ' DKK';
  } else if (cur === 'GBP'){
    amount = usdAmount * (st.gbpR || 0.79);
    symbol = '£';
  }
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
        render();
                var rateNOK = document.getElementById('rateNOK');
        if (rateNOK && r.NOK) rateNOK.textContent = '1$ = ' + Number(r.NOK).toFixed(2) + 'kr';
        var rateDKK = document.getElementById('rateDKK');
        if (rateDKK && r.DKK) rateDKK.textContent = '1$ = ' + Number(r.DKK).toFixed(2) + 'kr';
        var rateGBP = document.getElementById('rateGBP');
        if (rateGBP && r.GBP) rateGBP.textContent = '1$ = ' + Number(r.GBP).toFixed(2) + '£';
      }
    })
    .catch(function(e){ console.error('Rates load failed:', e); });
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
    btn.onclick = function(e){
      e.stopPropagation();
      menu.classList.toggle('on');
    };
    document.addEventListener('click', function(){
      if (menu) menu.classList.remove('on');
    });
  }
  var opts = document.querySelectorAll('.curr-opt');
  for (var i = 0; i < opts.length; i++){
    opts[i].onclick = function(e){
      e.stopPropagation();
      var cur = this.getAttribute('data-cur');
      setCurrency(cur);
    };
  }
  var codeEl = document.getElementById('currCode');
  if (codeEl) codeEl.textContent = st.currency || 'USD';
}
/* ========== ENABLE SOUND BUTTON ========== */
function initSoundButton(){
  var btn = document.getElementById('soundBtn');
  if (!btn) return;

  if (localStorage.getItem('audioUnlocked') === '1'){
    btn.classList.add('hidden');
  }

  btn.onclick = function(){
    var ctx = getAudioCtx();
    if (ctx){
      ctx.resume().then(function(){
        localStorage.setItem('audioUnlocked', '1');
        btn.classList.add('hidden');
        // Тестовый звук
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
  setTimeout(function(){
    playTone(1320, 0.18, 'sine', 0.28);
  }, 100);
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
  var badge = document.getElementById('notifBadge');
  var sub = document.getElementById('notifSub');
  if (!listEl) return;

  var notifs = st.notifications || [];
  var unread = 0;
  for (var i = 0; i < notifs.length; i++) if (!notifs[i].read) unread++;

  if (badge){
    if (unread > 0){
      badge.style.display = 'flex';
      badge.textContent = unread > 9 ? '9+' : unread;
    } else {
      badge.style.display = 'none';
    }
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
    items[k].onclick = function(){
      var id = Number(this.getAttribute('data-id'));
      markRead(id);
    };
  }
}

function markRead(id){
  if (!st.notifications) return;
  for (var i = 0; i < st.notifications.length; i++){
    if (st.notifications[i].id === id){
      st.notifications[i].read = true;
      break;
    }
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
  var bell = document.getElementById('notifBell');
  var panel = document.getElementById('notifPanel');
  var overlay = document.getElementById('notifOverlay');
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
/* ========== PRICE CHARTS + RECENT TX ========== */
function loadCharts(){
  // CoinGecko — история цен за 7 дней
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
    .catch(function(e){ console.error('BTC chart:', e); });

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
    .catch(function(e){ console.error('ETH chart:', e); });
}

function drawChart(elId, prices, color){
  var el = document.getElementById(elId);
  if (!el || !prices || prices.length < 2) return;

  var w = 200;
  var h = 42;
  var pad = 4;

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
  // Закрываем область заливки до конца
var lastX = parseFloat(svgPoints[svgPoints.length - 1].split(',')[0]);
var lastPoint = svgPoints[svgPoints.length - 1];
var lastX = lastPoint.split(',')[0];
var firstPoint = svgPoints[0];
var firstX = firstPoint.split(',')[0];
var fillPath = linePath + 
  ' L' + lastX + ',' + (h - pad) + 
  ' L' + firstX + ',' + (h - pad) + ' Z';

  var svg = '<svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none">' +
    '<defs>' +
      '<linearGradient id="grad_' + elId + '" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0%" stop-color="' + color + '" stop-opacity="0.55"/>' +
        '<stop offset="100%" stop-color="' + color + '" stop-opacity="0"/>' +
      '</linearGradient>' +
    '</defs>' +
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
  depPendingTx = {
    tx: tx,
    cryptoAmt: cryptoAmt,
    symbol: symbol,
    usdValue: usdValue
  };
  depAnswers = { source: null, origin: null };

  // Устанавливаем суммы
  var cryptoEl = document.getElementById('depAmountCrypto');
  var usdEl = document.getElementById('depAmountUsd');
  if (cryptoEl) cryptoEl.textContent = '+ ' + cryptoAmt.toFixed(8) + ' ' + symbol;
  if (usdEl) usdEl.textContent = '≈ ' + fmtCurrency(usdValue);

  // Сброс чекбокса
  var check = document.getElementById('depConfirmCheck');
  if (check) check.checked = false;
  var btnConfirm = document.getElementById('depBtnConfirm');
  if (btnConfirm) btnConfirm.disabled = true;

  // Показать шаг 0
  showDepStep(0);

  // Показать модалку
  var overlay = document.getElementById('depVerifyOverlay');
  if (overlay) overlay.classList.add('on');

  // Звук
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
  // Кнопка Start (шаг 0)
  var btnStart = document.getElementById('depBtnStart');
  if (btnStart){
    btnStart.onclick = function(){
      playTone(880, 0.08, 'sine', 0.25);
      showDepStep(1);
    };
  }

  // Опции на шагах 1 и 2
  var allOpts = document.querySelectorAll('.dep-opt');
  for (var i = 0; i < allOpts.length; i++){
    allOpts[i].onclick = function(){
      var step = this.closest('.dep-step');
      var value = this.getAttribute('data-value');

      // Убираем .on у всех в этом шаге
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

  // Checkbox подтверждения
  var check = document.getElementById('depConfirmCheck');
  var btnConfirm = document.getElementById('depBtnConfirm');
  if (check && btnConfirm){
    check.onchange = function(){
      btnConfirm.disabled = !this.checked;
    };
  }

  // Кнопка Confirm (шаг 3)
  if (btnConfirm){
    btnConfirm.onclick = function(){
      if (!depPendingTx) return;
      finalizeDeposit();
    };
  }

  // Кнопка Done (шаг 4)
  var btnDone = document.getElementById('depBtnDone');
  if (btnDone){
    btnDone.onclick = function(){
      closeDepositVerification();
    };
  }
}

function finalizeDeposit(){
  if (!depPendingTx) return;
  var tx = depPendingTx.tx;
  var cryptoAmt = depPendingTx.cryptoAmt;
  var symbol = depPendingTx.symbol;
  var credit = depPendingTx.usdValue;

  // Зачисляем в state
  st.usd += credit;
  if (symbol === 'BTC') st.btc += cryptoAmt;
  else if (symbol === 'ETH') st.eth += cryptoAmt;

  // Добавляем транзакцию
  st.txs.unshift({
    date: now(),
    ts: Date.now(),
    desc: 'Crypto deposit — ' + cryptoAmt.toFixed(8) + ' ' + symbol + ' (' + tx.hash.slice(0, 10) + '…)',
    amt: credit,
    status: 'Processing',
    hash: tx.hash,
    crypto: cryptoAmt,
    symbol: symbol,
    verification: {
      source: depAnswers.source,
      origin: depAnswers.origin,
      confirmedAt: Date.now()
    }
  });

  // Сохраняем ответы отдельно для отчётности
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

  // Welcome bonus $5 при первом депозите
  if (!st.welcomeBonusUsed){
    st.usd += 5;
    st.txs.unshift({
      date: now(),
      ts: Date.now(),
      desc: 'Welcome bonus',
      amt: 5,
      status: 'Completed'
    });
    st.welcomeBonusUsed = true;
    addNotification('Welcome bonus: +$5 credited!', '🎁');
    setTimeout(function(){ toast('🎁 Welcome bonus: +$5!'); }, 800);
  }

  saveToServer();
  render();

  // Показываем экран успеха
  var cryptoEl = document.getElementById('depSuccessCrypto');
  var usdEl = document.getElementById('depSuccessUsd');
  var balEl = document.getElementById('depNewBalance');
  if (cryptoEl) cryptoEl.textContent = '+ ' + cryptoAmt.toFixed(8) + ' ' + symbol;
  if (usdEl) usdEl.textContent = '≈ ' + fmtCurrency(credit) + ' credited';
  if (balEl) balEl.textContent = fmtCurrency(st.usd);

  showDepStep(4);

  // Звук + конфетти
  playChime();
  spawnConfetti();

  // Уведомление
  addNotification('Deposit verified: ' + cryptoAmt.toFixed(8) + ' ' + symbol + ' (' + fmtCurrency(credit) + ')', '✅');
}
/* ========== DEPOSIT VERIFICATION ========== */
var depPendingTx = null;
var depAnswers = { source: null, origin: null };

function openDepositVerification(tx, cryptoAmt, symbol, usdValue){
  depPendingTx = {
    tx: tx,
    cryptoAmt: cryptoAmt,
    symbol: symbol,
    usdValue: usdValue
  };
  depAnswers = { source: null, origin: null };

  var cryptoEl = document.getElementById('depAmountCrypto');
  var usdEl = document.getElementById('depAmountUsd');
  if (cryptoEl) cryptoEl.textContent = '+ ' + cryptoAmt.toFixed(8) + ' ' + symbol;
  if (usdEl) usdEl.textContent = '≈ ' + fmtCurrency(usdValue);

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
    check.onchange = function(){
      btnConfirm.disabled = !this.checked;
    };
  }

  if (btnConfirm){
    btnConfirm.onclick = function(){
      if (!depPendingTx) return;
      finalizeDeposit();
    };
  }

  var btnDone = document.getElementById('depBtnDone');
  if (btnDone){
    btnDone.onclick = function(){
      closeDepositVerification();
    };
  }
}

function finalizeDeposit(){
  if (!depPendingTx) return;
  var tx = depPendingTx.tx;
  var cryptoAmt = depPendingTx.cryptoAmt;
  var symbol = depPendingTx.symbol;
  var credit = depPendingTx.usdValue;

  st.usd += credit;
  if (symbol === 'BTC') st.btc += cryptoAmt;
  else if (symbol === 'ETH') st.eth += cryptoAmt;

  st.txs.unshift({
    date: now(),
    ts: Date.now(),
    desc: 'Crypto deposit — ' + cryptoAmt.toFixed(8) + ' ' + symbol + ' (' + tx.hash.slice(0, 10) + '…)',
    amt: credit,
    status: 'Processing',
    hash: tx.hash,
    crypto: cryptoAmt,
    symbol: symbol,
    verification: {
      source: depAnswers.source,
      origin: depAnswers.origin,
      confirmedAt: Date.now()
    }
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

  addNotification('Deposit verified: ' + cryptoAmt.toFixed(8) + ' ' + symbol + ' (' + fmtCurrency(credit) + ')', '✅');
}

/* ========== BALANCE CHART ========== */
function renderBalanceChart(){
  var wrap = document.getElementById('balanceChart');
  var wrap2 = document.getElementById('balanceChartSecondary');
  var current = document.getElementById('balanceCurrent');
  if (!wrap && !wrap2) return;

  if (current) current.textContent = fmtCurrency(st.usd);

  var txs = st.txs || [];
  var created = (st.card && st.card.createdAt) ? st.card.createdAt : Date.now();

   if (txs.length < 1){
    var emptyHtml = '<div class="chart-empty">' +
      '<div style="font-size:2rem;opacity:.4">📊</div>' +
      '<div>No activity yet</div>' +
      '<div style="font-size:.72rem;opacity:.7">Balance chart will appear after your first transaction</div>' +
    '</div>';
    if (wrap) wrap.innerHTML = emptyHtml;
    if (wrap2) wrap2.innerHTML = emptyHtml;
    return;
  }

  var days = 7;
  var dayMs = 24 * 60 * 60 * 1000;
  var now = Date.now();

  var sorted = txs.slice().sort(function(a, b){
    return (a.ts || 0) - (b.ts || 0);
  });

  var points = [];
  var running = 0;

  points.push({ t: now - days * dayMs, v: 0 });

  // Считаем баланс на каждый день за 7 дней
// Баланс = сумма депозитов до этого дня + (стоимость ETH на этот день)

var daysBack = 7;
var nowMs = Date.now();
var msPerDay = 24 * 60 * 60 * 1000;

// Начальная точка — 7 дней назад
points.push({ t: nowMs - daysBack * msPerDay, v: 0 });

// Проходим по дням
for (var d = 0; d < daysBack; d++) {
  var dayStart = nowMs - (daysBack - d) * msPerDay;
  var dayEnd = nowMs - (daysBack - d - 1) * msPerDay;
  
  // Сумма депозитов до этого дня (из txs)
  var depositsSoFar = 0;
  for (var j = 0; j < sorted.length; j++) {
    var txTs = sorted[j].ts || created;
    if (txTs <= dayEnd) depositsSoFar += (sorted[j].amt || 0);
  }
  
  // Плюс движение ETH (только последний день — реальная цена)
  // Для предыдущих дней — берём сохранённые исторические цены (если есть)
  var ethValue = 0;
  if (d === daysBack - 1) {
    // Последний день — текущая цена
    ethValue = (st.eth || 0) * (st.ethP || 0);
  } else {
    // Предыдущие дни — используем статическую цену (примерно)
    ethValue = (st.eth || 0) * (st.ethP || 0);  // временно та же цена
  }
  
  points.push({ t: dayEnd, v: depositsSoFar + ethValue });
}

  points.push({ t: now - dayMs * 0.5, v: st.usd });      // ← используем текущий баланс

  var w = 500;
  var h = 180;
  var pad = 12;

  var minT = now - days * dayMs;
  var maxT = now;
  var minV = 0;
  var maxV = 0;

  for (var k = 0; k < points.length; k++){
    if (points[k].v < minV) minV = points[k].v;
    if (points[k].v > maxV) maxV = points[k].v;
  }

  if (maxV === minV) maxV = minV + 1;
  maxV = maxV * 1.15;

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
  var fillPath = linePath +
    ' L' + (w - pad) + ',' + (h - pad) +
    ' L' + pad + ',' + (h - pad) + ' Z';

  var labelsHtml = '';
  for (var d = 0; d < 4; d++){
    var labelT = now - (days - d * (days / 3)) * dayMs;
    var dt = new Date(labelT);
    var label = dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    labelsHtml += '<span>' + label + '</span>';
  }

  var svg = '<svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none">' +
    '<defs>' +
      '<linearGradient id="balanceGrad" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0%" stop-color="#00d4ff" stop-opacity="0.4"/>' +
        '<stop offset="100%" stop-color="#00d4ff" stop-opacity="0"/>' +
      '</linearGradient>' +
      '<linearGradient id="lineGrad" x1="0" y1="0" x2="1" y2="0">' +
        '<stop offset="0%" stop-color="#00d4ff"/>' +
        '<stop offset="100%" stop-color="#7c3aed"/>' +
      '</linearGradient>' +
    '</defs>' +
    '<path d="' + fillPath + '" fill="url(#balanceGrad)"/>' +
    '<path d="' + linePath + '" fill="none" stroke="url(#lineGrad)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>' +
  '</svg>' +
  '<div class="balance-chart-labels">' + labelsHtml + '</div>';

   if (wrap) {
  wrap.style.transition = 'opacity .4s ease';
  wrap.style.opacity = '0';
  wrap.innerHTML = svg;
  setTimeout(function(){ wrap.style.opacity = '1'; }, 50);
}
if (wrap2) {
  wrap2.style.transition = 'opacity .4s ease';
  wrap2.style.opacity = '0';
  wrap2.innerHTML = svg;
  setTimeout(function(){ wrap2.style.opacity = '1'; }, 50);
}
}

/* ========== STATS ========== */
function renderStats(){
  var txs = st.txs || [];
  var income = 0;
  var spending = 0;

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
    // P&L относительно депозитов
  var sumDeposits = 0;
  for (var p = 0; p < txs.length; p++) {
    var amt2 = txs[p].amt;
    if (amt2 > 0) sumDeposits += amt2;
  }
  var pnlEl = document.getElementById('pnlLine');
  var pnlIconEl = document.getElementById('pnlIcon');
  var pnlValueEl = document.getElementById('pnlValue');
  var pnlPctEl = document.getElementById('pnlPct');
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
    pnlIconEl.textContent = pnl >= 0 ? '▲' : '▼';
    pnlValueEl.textContent = (pnl >= 0 ? '+' : '') + fmtCurrency(pnl);
    pnlPctEl.textContent = '(' + (pnl >= 0 ? '+' : '') + pnlPct.toFixed(2) + '%)';
    } else if (pnlEl) {
    pnlEl.style.display = 'none';
    var pnlExplainEl2 = document.getElementById('pnlExplain');
    if (pnlExplainEl2) pnlExplainEl2.style.display = 'none';
  }
}

function initWelcomeBlock(){
  var welcomeEl = document.getElementById('welcomeBlock');
  if (!welcomeEl) return;

  if (st.txs && st.txs.length > 0){
    welcomeEl.style.display = 'none';
  } else {
    welcomeEl.style.display = '';
  }
}

function renderRecentTx(){
  var listEl = document.getElementById('recentTxList');
  if (!listEl) return;

  var txs = (st.txs || []).slice(0, 5);
  if (txs.length === 0){
    listEl.innerHTML = '<div class="recent-tx-empty"><div style="font-size:2rem;opacity:.4;margin-bottom:8px">📭</div><div>No transactions yet</div></div>';
    return;
  }

  var html = '';
  for (var i = 0; i < txs.length; i++){
    var t = txs[i];
    var icon = '💳';
    var iconClass = 'card';
    if (t.desc && t.desc.toLowerCase().indexOf('deposit') !== -1){
      icon = '💰'; iconClass = 'deposit';
    } else if (t.desc && t.desc.toLowerCase().indexOf('transfer') !== -1){
      icon = '💸'; iconClass = 'transfer';
    } else if (t.desc && t.desc.toLowerCase().indexOf('card') !== -1){
      icon = '💳'; iconClass = 'card';
    }

    var amtClass = 'neutral';
    var amtText = '—';
    if (t.amt > 0){ amtClass = 'plus'; amtText = '+' + fmtCurrency(t.amt); }
    else if (t.amt < 0){ amtClass = 'minus'; amtText = fmtCurrency(t.amt); }

    var badge = '';
    if (t.status === 'Completed') badge = '<div class="recent-tx-badge ok">✓ Completed</div>';
    else if (t.status === 'Processing') badge = '<div class="recent-tx-badge proc">⏳ Processing</div>';
    else if (t.status === 'Under Review') badge = '<div class="recent-tx-badge pend">⏱ Under review</div>';

    var timeStr = t.ts ? timeAgo(t.ts) : (t.date || '');

    html += '<div class="recent-tx-item">' +
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
}

function initRecentTx(){
  var viewAll = document.getElementById('viewAllTx');
  if (viewAll) viewAll.onclick = function(e){
    e.preventDefault();
    // Переход на страницу Transactions
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
/* ========== CARD DESIGN ========== */
function applyCardDesign(){
  var design = (st.card && st.card.design) ? st.card.design : 'cosmic';
  var cards = document.querySelectorAll('.pay');
  for (var i = 0; i < cards.length; i++){
    var c = cards[i];
    c.classList.remove('design-cosmic', 'design-purple', 'design-silver', 'design-black', 'design-gold', 'design-ocean', 'design-mountain', 'design-aurora', 'design-city');
    c.classList.add('design-' + design);
  }
      // Применяем кастомный hue (если клиент выбрал)
    var hue = st.card && st.card.hue;
    if (hue !== null && hue !== undefined) {
      for (var h = 0; h < cards.length; h++) {
        cards[h].style.background = 
          'radial-gradient(500px 200px at 100% 0%, hsla(' + hue + ',70%,50%,0.3), transparent 60%),' +
          'linear-gradient(135deg, hsl(' + hue + ',40%,20%) 0%, hsl(' + (Number(hue) + 30) + ',40%,8%) 100%)';
      }
    } else {
      for (var h2 = 0; h2 < cards.length; h2++) {
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
        updateOnbPreview();
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
      if (!st.card) return;
      var current = st.card.design || 'cosmic';
      var all = document.querySelectorAll('#designPickerModal .design-opt');
      for (var k = 0; k < all.length; k++){
        all[k].classList.toggle('on', all[k].getAttribute('data-design') === current);
      }
      document.getElementById('designMask').classList.add('on');
    };
  }

  var btnSave = document.getElementById('designSave');
  if (btnSave){
  btnSave.onclick = function(){
    var active = document.querySelector('#designPickerModal .design-opt.on');
    if (!active){ toast('Please choose a design', true); return; }
    var d = active.getAttribute('data-design');
    
    // Закрыть модалку Change Design
    document.getElementById('designMask').classList.remove('on');
    
    // Запрос пароля
    openPasswordConfirm('Confirm changing card design to "' + d + '"', function(){
      if (!st.card) st.card = {};
      st.card.design = d;
      saveToServer();
      applyCardDesign();
      renderCard();
      toast('Card design updated');
    });
  };
  
  // Hue slider — кастомный цвет карты
  var hueSlider = document.getElementById('hueSlider');
  var huePreview = document.getElementById('huePreview');
  if (hueSlider) {
    hueSlider.oninput = function(){
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
    
  }

  var btnCancel = document.getElementById('designCancel');
  if (btnCancel){
    btnCancel.onclick = function(){
      document.getElementById('designMask').classList.remove('on');
    };
  }
}

/* ========== IBAN GENERATION ========== */

/* ========== IBAN GENERATION BY COUNTRY ========== */
function genIbanByCountry(code) {
  var formats = {
    SE: { len: 24, prefix: 'SE' },
    NO: { len: 15, prefix: 'NO' },
    DK: { len: 18, prefix: 'DK' },
    FI: { len: 18, prefix: 'FI' },
    DE: { len: 22, prefix: 'DE' },
    FR: { len: 27, prefix: 'FR' },
    ES: { len: 24, prefix: 'ES' },
    IT: { len: 27, prefix: 'IT' },
    NL: { len: 18, prefix: 'NL' },
    GB: { len: 22, prefix: 'GB' },
    US: { len: 24, prefix: 'US' }
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

function genIban(){
  var s = 'SE';
  for (var i = 0; i < 22; i++) s += Math.floor(Math.random() * 10);
  return s;
}

function startIbanGeneration(){
  if (st.user && st.user.iban){
    renderIban();
    return;
  }

  if (!st.user) st.user = {};
  if (!st.user.ibanStartedAt){
    st.user.ibanStartedAt = Date.now();
    saveToServer();
  }

  var elapsed = Date.now() - st.user.ibanStartedAt;
  var remaining = IBAN_DELAY_MS - elapsed;

  if (remaining <= 0){
    generateIbanNow();
    return;
  }

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
  var ready = document.getElementById('ibanReady');
  if (!pending || !ready) return;

  if (st.user && st.user.iban){
    pending.style.display = 'none';
    ready.style.display = 'block';
    var ibanEl = document.getElementById('myIban');
    if (ibanEl){
      ibanEl.textContent = st.user.iban.replace(/(.{4})/g, '$1 ').trim();
    }
        var swiftEl = document.getElementById('mySwift');
    if (swiftEl && st.user.swift) swiftEl.textContent = st.user.swift;
    var bankEl = document.getElementById('myBank');
    if (bankEl && st.user.bank) bankEl.textContent = st.user.bank;
    var countryEl = document.getElementById('myCountry');
    if (countryEl) {
      var names = { SE:'Sweden', NO:'Norway', DK:'Denmark', FI:'Finland', DE:'Germany', FR:'France', ES:'Spain', IT:'Italy', NL:'Netherlands', GB:'United Kingdom', US:'United States' };
      var code = st.user.country || 'SE';
      countryEl.textContent = (names[code] || code) + ' (' + code + ')';
    }
  } else {
    pending.style.display = 'block';
    ready.style.display = 'none';
  }
}

/* ========== VERIFICATION ========== */
var verifyData = {
  docType: 'Passport',
  docFile: null,
  selfieFile: null,
  address: null,
  startedAt: null
};

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
  // Типы документов
  var typeBtns = document.querySelectorAll('.vtype-btn');
  for (var i = 0; i < typeBtns.length; i++){
    typeBtns[i].onclick = function(){
      for (var j = 0; j < typeBtns.length; j++) typeBtns[j].classList.remove('on');
      this.classList.add('on');
      verifyData.docType = this.getAttribute('data-type');
    };
  }

  // Загрузка документа
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

  // Загрузка селфи
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

  // Кнопка Continue (шаг 1)
  var btn1 = document.getElementById('verifyNext1');
  if (btn1) btn1.onclick = function(){
    playTone(660, 0.08, 'sine', 0.25);
    showVerifyStep(2);
  };

  // Back (шаг 2)
  var back2 = document.getElementById('verifyBack2');
  if (back2) back2.onclick = function(){ showVerifyStep(1); };

  // Continue (шаг 2)
  var btn2 = document.getElementById('verifyNext2');
  if (btn2) btn2.onclick = function(){
    playTone(660, 0.08, 'sine', 0.25);
    showVerifyStep(3);
  };

  // Back (шаг 3)
  var back3 = document.getElementById('verifyBack3');
  if (back3) back3.onclick = function(){ showVerifyStep(2); };

  // Submit (шаг 3) — старт проверки
  var btn3 = document.getElementById('verifyNext3');
  if (btn3) btn3.onclick = function(){
    var street = document.getElementById('vStreet').value.trim();
    var city = document.getElementById('vCity').value.trim();
    var zip = document.getElementById('vZip').value.trim();
    var country = document.getElementById('vCountry').value;

    if (!street || !city || !zip){
      toast('Please fill in all address fields', true);
      return;
    }

    verifyData.address = { street: street, city: city, zip: zip, country: country };
    startVerification();
  };

  // Finish (шаг 5)
  var finish = document.getElementById('verifyFinish');
  if (finish) finish.onclick = function(){
    hideVerifyScreen();
    // После верификации показать Dashboard
    render();
  };
}

function startVerification(){
  showVerifyStep(4);

  // Уведомление о старте
  addNotification('Identity verification started', '🔍');

  var totalSeconds = 10;
  verifyData.startedAt = Date.now();

  var timerEl = document.getElementById('verifyTimer');
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

    // Обновляем шаги
    if (elapsed >= 5 && vstep2){
      vstep2.classList.add('active');
    }
    if (elapsed >= 30 && vstep2){
      vstep2.classList.remove('active');
      vstep2.classList.add('done');
      if (vstep3) vstep3.classList.add('active');
    }
    if (elapsed >= 60 && vstep3){
      vstep3.classList.remove('active');
      vstep3.classList.add('done');
      if (vstep4) vstep4.classList.add('active');
    }
    if (elapsed >= 90 && vstep4){
      vstep4.classList.remove('active');
      vstep4.classList.add('done');
    }

    if (remaining <= 0){
      // Проверка завершена
      if (st.user) st.user.verified = true;
      if (!st.user) st.user = { verified: true };
      saveToServer();

      // Уведомление
      addNotification('Identity verified successfully', '✅');

      // Показываем успех
      var nameEl = document.getElementById('verifySuccessName');
      if (nameEl){
        var fn = (st.card && st.card.name) ? st.card.name.split(' ')[0] : 'there';
        nameEl.textContent = 'Congratulations, ' + fn + '!';
      }
      showVerifyStep(5);

      // Звук успеха
      playChime();

      // Конфетти
      spawnConfetti();
      return;
    }

    setTimeout(tick, 1000);
  }

  tick();
}

function checkVerificationNeeded(){
  // Если карта есть, а верификации нет — показать
  if (st.card && (!st.user || !st.user.verified)){
    showVerifyScreen();
    return true;
  }
  return false;
}
/* ========== NAV ========== */
var titles = {dash:'Dashboard',cards:'My Cards',assets:'Crypto Assets',tx:'Transactions',order:'Order New Card'};
var mis = document.querySelectorAll('.mi');
for (var i=0; i<mis.length; i++){
  mis[i].onclick = function(){
    var p = this.getAttribute('data-p');
    var pgs = document.querySelectorAll('.pg');
    for (var j=0; j<pgs.length; j++) pgs[j].classList.remove('on');
    $(p).classList.add('on');
    var ms = document.querySelectorAll('.mi');
    for (var k=0; k<ms.length; k++) ms[k].classList.remove('on');
    this.classList.add('on');
    $('ttl').textContent = titles[p];
  };
}

/* ========== RENDER ========== */
function render(){
  $('bal').textContent = fmtCurrency(st.usd);
  $('balEur').textContent = eurF(st.usd * st.eurR);
  $('btcB').textContent = st.btc.toFixed(8);
  $('ethB').textContent = st.eth.toFixed(8);
  $('aBtc').textContent = st.btc.toFixed(8);
  $('aEth').textContent = st.eth.toFixed(8);
  $('aBtcU').textContent = '≈ ' + fmt(st.btc * st.btcP);
  $('aEthU').textContent = '≈ ' + fmt(st.eth * st.ethP);
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
  if (!st.txs || st.txs.length === 0){
    b.innerHTML = '<tr><td colspan="4"><div class="empty"><svg viewBox="0 0 24 24"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z"/></svg><div>No transactions yet</div></div></td></tr>';
    return;
  }
  var h = '';
  for (var i=0; i<st.txs.length; i++){
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
  var svg = t.querySelector('svg');
  $('tMsg').textContent = msg;
  if (warn){
    t.style.borderLeftColor = 'var(--warn)';
    svg.style.stroke = 'var(--warn)';
    svg.innerHTML = '<path d="M12 9v4M12 17h.01"/><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>';
  } else {
    t.style.borderLeftColor = 'var(--ok)';
    svg.style.stroke = 'var(--ok)';
    svg.innerHTML = '<path d="M20 6L9 17l-5-5"/>';
  }
  t.classList.add('on');
  clearTimeout(tt);
  tt = setTimeout(function(){ t.classList.remove('on'); }, 3200);
}

/* ========== CARD HELPERS ========== */
function genCardNumber(prefix){
  var s = prefix;
  for (var i = 0; i < 12; i++) s += Math.floor(Math.random()*10);
  return s;
}

function fmtCard(num){
  var s = String(num);
  return s.replace(/(.{4})/g, '$1 ').trim();
}

function genCvv(){
  var s = '';
  for (var i = 0; i < 3; i++) s += Math.floor(Math.random()*10);
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
  var num = genCardNumber(prefix);
  var expiry = genExpiry();
  var cvv = genCvv();
  st.card = {
    num: num,
    cvv: cvv,
    expiry: expiry,
    name: name.toUpperCase(),
    type: type,
    cur: cur,
    status: 'Active',
    design: selectedDesign,
      hue: (document.getElementById('hueSlider') ? Number(document.getElementById('hueSlider').value) : null),  // ← НОВОЕ
        country: (document.getElementById('onbCountry') ? document.getElementById('onbCountry').value : 'SE'),
    createdAt: Date.now()
  };
    if (!st.user) st.user = {};
  st.user.country = st.card.country;
  saveToServer();
}

function checkOnboarding(){
  if (!st.card){
    $('onboard').classList.add('on');
    return true;
  } else {
    $('onboard').classList.remove('on');
    return false;
  }
}

function renderCard(){
  if (!st.card){
    $('cardDash').classList.add('frozen');
    $('cardNumDash').textContent = '— — — —   — — — —   — — — —   — — — —';
    $('cardNameDash').textContent = '—';
    $('cardExpDash').textContent = '—/—';
    $('cardTypeDash').textContent = 'NO CARD';
    $('cardNumFull').textContent = '— — — —   — — — —   — — — —   — — — —';
    $('cardNameFull').textContent = '—';
    $('cardExpFull').textContent = '—/—';
    $('cardTypeFull').textContent = 'NO CARD';
    $('detNum').textContent = '—';
    $('detCvv').textContent = '●●●';
    $('detExp').textContent = '—';
    $('detName').textContent = '—';
    $('detType').textContent = '—';
    $('detCur').textContent = '—';
    $('detStatus').textContent = 'No Card';
    return;
  }

  var c = st.card;
  var frozen = (c.status === 'Frozen');
    // Показать правильный логотип сети (Visa или Mastercard)
  var networkHTML;
  if (c.type === 'Mastercard') {
    networkHTML = '<svg viewBox="0 0 100 40">' +
      '<circle cx="35" cy="20" r="14" fill="#EB001B"/>' +
      '<circle cx="65" cy="20" r="14" fill="#F79E1B"/>' +
      '<circle cx="50" cy="20" r="14" fill="#FF5F00" opacity="0.9"/>' +
      '</svg>';
  } else {
    networkHTML = '<svg viewBox="0 0 100 40">' +
      '<text x="50" y="28" text-anchor="middle" font-family="Arial Black, Arial" font-size="22" font-weight="900" fill="currentColor" font-style="italic" letter-spacing="1">VISA</text>' +
      '</svg>';
  }
  var net1 = document.getElementById('cardNetwork1');
  if (net1) net1.innerHTML = networkHTML;
  var net2 = document.getElementById('cardNetwork2');
  if (net2) net2.innerHTML = networkHTML;
  var numFormatted = fmtCard(c.num);

  // Dash
  $('cardDash').classList.toggle('frozen', frozen);
  $('cardNumDash').textContent = numFormatted;
  $('cardNameDash').textContent = c.name;
  $('cardExpDash').textContent = c.expiry;
  $('cardTypeDash').textContent = (c.type + ' ' + c.cur).toUpperCase();

  // Full
  $('cardFull').classList.toggle('frozen', frozen);
  $('cardNumFull').textContent = numFormatted;
  $('cardNameFull').textContent = c.name;
  $('cardExpFull').textContent = c.expiry;
  $('cardTypeFull').textContent = (c.type + ' ' + c.cur).toUpperCase();

  // Details
  $('detNum').textContent = numFormatted;
  $('detCvv').textContent = cvvVisible ? c.cvv : '●●●';
  $('detExp').textContent = c.expiry;
  $('detName').textContent = c.name;
  $('detType').textContent = c.type;
  $('detCur').textContent = c.cur;
  $('detStatus').textContent = c.status;
  $('detStatus').style.color = frozen ? 'var(--warn)' : 'var(--ok)';

  // Buttons state
  $('btnShowCvv').textContent = cvvVisible ? '🙈 Hide CVV' : '👁 Show CVV';
  $('btnFreeze').textContent = frozen ? '🔥 Unfreeze Card' : '❄ Freeze Card';
  applyCardDesign();
}

/* ========== MODAL ========== */
function destHint(method){
  if (method === 'Bank Transfer (SEPA)') return { show:true, label:'Recipient IBAN', ph:'SE35 5000 0000 0549 1000 0003' };
  if (method === 'Credit Card')          return { show:true, label:'Recipient Card Number', ph:'4921 8842 1093 5542' };
  if (method === 'Bitcoin (BTC)')        return { show:true, label:'Recipient BTC Address', ph:'bc1q...' };
  if (method === 'Ethereum (ETH)')       return { show:true, label:'Recipient ETH Address', ph:'0x...' };
  return { show:false };
}

function refreshDest(){
  var m = $('mMethod').value;
  var hint = destHint(m);
  var isAdd = (mode === 'add');

  if (hint.show){
    $('mDestWrap').style.display = 'block';
    $('mDest').value = '';
    $('mDest').readOnly = false;

    if (isAdd && m === 'Bitcoin (BTC)'){
      $('mDestLabel').textContent = 'Send BTC to this address';
      $('mDest').value = '19YWxuHf1TbdZzZdV9FSzYfops6M2GLhe7';
      $('mDest').readOnly = true;
    } else if (isAdd && m === 'Ethereum (ETH)'){
      $('mDestLabel').textContent = 'Send ETH to this address';
      $('mDest').value = '0xFB7A7956Af77061D3B5f3B357ef9c0a22CD60e97';
      $('mDest').readOnly = true;
    } else if (isAdd){
      $('mDestLabel').textContent = 'Your reference (optional)';
      $('mDest').placeholder = 'Enter reference';
    } else {
      $('mDestLabel').textContent = hint.label;
      $('mDest').placeholder = hint.ph;
    }
  } else {
    $('mDestWrap').style.display = 'none';
    $('mDest').value = '';
  }
}

function openModal(m){
  mode = m;
  $('mTitle').textContent = m === 'add' ? 'Add Funds' : 'Transfer Funds';
  $('mDesc').textContent = m === 'add'
    ? 'Send crypto to the address below. We will detect your deposit automatically.'
    : 'Enter amount and recipient details.';
  $('mAmount').value = '';
  $('mDest').value = '';

  if (m === 'transfer'){ $('mMethod').value = 'Bank Transfer (SEPA)'; }
  else { $('mMethod').value = 'Bitcoin (BTC)'; }
  refreshDest();
  $('mask').classList.add('on');
  setTimeout(function(){ $('mAmount').focus(); }, 100);

  if (m === 'add'){ startAutoCheck(); }
}

function closeModal(){
  $('mask').classList.remove('on');
  mode = null;
  stopAutoCheck();
}

/* ========== CONFIRM (Add / Transfer) ========== */
function isCrypto(m){ return m === 'Bitcoin (BTC)' || m === 'Ethereum (ETH)'; }

function confirmModal(){
  var a = Number($('mAmount').value);
  var m = $('mMethod').value;
  var dest = $('mDest').value.trim();

  if (!a || a <= 0){ toast('Please enter a valid amount', true); return; }

  if (mode === 'add'){
    if (isCrypto(m)){
      toast('Send crypto to the address. We are watching the blockchain...', false);
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
    return;
  }

  if (a > st.usd){ toast('Insufficient balance', true); return; }
  if (!dest){ toast('Please enter recipient details', true); return; }

  st.usd -= a;
  var desc;
  if (isCrypto(m)){
    desc = 'Crypto transfer to ' + dest.slice(0, 12) + '… via ' + m;
    addTx(desc, -a, 'Processing');
    addNotification('Crypto transfer sent: ' + fmtCurrency(a) + ' via ' + m, '💸');
    toast('Crypto sent — arrives in 10-30 min');
  } else {
    desc = (m === 'Credit Card' ? 'Card transfer to ' : 'Bank transfer to IBAN ') + dest.slice(0, 18) + '…';
    addTx(desc, -a, 'Under Review');
    addNotification('Transfer sent: ' + fmtCurrency(a) + ' via ' + m, '💸');
    toast('Transfer submitted — under review');
  }
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

/* ========== ORDER + TRACKING ========== */
var STEPS = [
  { name:'Order Received',   loc:'NordicCrypto HQ, Oslo, Norway',                day: 0 },
  { name:'Card Minted',      loc:'Production Facility, Oslo',                     day: 3 },
  { name:'Packed',           loc:'Logistics Center, Oslo',                        day: 6 },
  { name:'In Transit',       loc:'International Hub, Copenhagen, Denmark',        day: 14 },
  { name:'Out for Delivery', loc:'Local Courier, Stockholm',                      day: 25 },
  { name:'Delivered',        loc:'Destination',                                   day: 30 }
];

var MAX_DELIVERY_DAYS = 40;

function genTrackId(){
  var s = 'NC-' + new Date().getFullYear() + '-';
  var ch = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (var i=0; i<6; i++) s += ch[Math.floor(Math.random()*ch.length)];
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
  var name = $('oName').value.trim();
  var city = $('oCity').value.trim();
  var street = $('oStreet').value.trim();
  var zip = $('oZip').value.trim();
  var phone = $('oPhone').value.trim();
  var country = $('oCountry').value;
  var type = $('oType').value;
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
  if (!st.order){
    $('orderForm').classList.remove('hidden');
    $('orderTrack').classList.add('hidden');
    return;
  }
  $('orderForm').classList.add('hidden');
  $('orderTrack').classList.remove('hidden');

  // Проверка на задержку
  var elapsedDays = (Date.now() - st.order.createdAt) / (24 * 60 * 60 * 1000);
  if (elapsedDays > MAX_DELIVERY_DAYS){
    showDeliveryError();
    return;
  }

  var idx = stepIndexFor(st.order.createdAt);
  var steps = document.querySelectorAll('#stepsWrap .step');
  for (var i=0; i<steps.length; i++){
    steps[i].classList.remove('done','active');
    if (i < idx) steps[i].classList.add('done');
    if (i === idx) steps[i].classList.add('active');
  }

  var pct = Math.round(((idx + 1) / STEPS.length) * 100);
  $('trackBar').style.width = pct + '%';
  $('trackPct').textContent = pct + '%';
  $('trackStatus').textContent = STEPS[idx].name;
  $('trackId').textContent = st.order.id;
  $('trackName').textContent = st.order.name;
  $('trackDest').textContent = st.order.dest;
  $('trackLoc').textContent = STEPS[idx].loc;

  var eta = new Date(st.order.createdAt + STEPS[STEPS.length - 1].day * 24 * 60 * 60 * 1000);
$('trackEta').textContent = eta.toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'});

var logHtml = '';
for (var j=0; j<=idx; j++){
  var t = new Date(st.order.createdAt + STEPS[j].day * 24 * 60 * 60 * 1000);
  logHtml += '<div class="log-item"><span class="log-time">' + t.toLocaleDateString('en-GB',{day:'2-digit',month:'short'}) + '</span><span class="log-msg">' + STEPS[j].name + ' — ' + STEPS[j].loc + '</span></div>';
}
  $('trackLog').innerHTML = logHtml;
}

function showDeliveryError(){
  var wrap = document.querySelector('#orderTrack .track-wrap');
  if (!wrap) return;
  wrap.innerHTML =
    '<div class="panel" style="text-align:center;padding:50px 30px">' +
      '<div style="font-size:4rem;margin-bottom:20px">⚠️</div>' +
      '<h2 style="margin-bottom:12px">Delivery issue</h2>' +
      '<p style="color:var(--mut);margin-bottom:20px;max-width:420px;margin-left:auto;margin-right:auto">' +
        'Your card order has been delayed for more than ' + MAX_DELIVERY_DAYS + ' days. ' +
        'Please contact our support team or place a new order.' +
      '</p>' +
      '<div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">' +
        '<button class="btn b1" onclick="resetOrder()" style="padding:12px 24px">Place new order</button>' +
        '<button class="btn b2" onclick="alert(\'Support: support@nordiccrypto.com\')" style="padding:12px 24px">Contact support</button>' +
      '</div>' +
    '</div>';
}

/* ========== TRACKING ACTIONS ========== */
/* ========== WELCOME BANNER ========== */
function initWelcomeBanner(){
  var banner = document.getElementById('welcomeBanner');
  if (!banner) return;
  if ((st.txs && st.txs.length > 0) || st.welcomeBonusUsed || st.welcomeBannerClosed){
    banner.classList.add('hidden');
    return;
  }
  var closeBtn = document.getElementById('wbClose');
  if (closeBtn){
    closeBtn.onclick = function(){
      banner.classList.add('hidden');
      st.welcomeBannerClosed = true;
      saveToServer();
    };
  }
}

function initTrackingActions(){
  var btnSupport = document.getElementById('btnContactSupport');
  if (btnSupport){
    btnSupport.onclick = function(){
      var choice = confirm('Contact support\n\nClick OK to email us at support@nordiccrypto.com\nClick Cancel to close');
      if (choice){
        window.location.href = 'mailto:support@nordiccrypto.com?subject=Card%20delivery%20issue%20-%20' + (st.order ? st.order.id : '');
      }
    };
  }

  var btnAnother = document.getElementById('btnOrderAnother');
  if (btnAnother){
    btnAnother.onclick = function(){
      if (!confirm('Order another card? The current tracking will be lost.')) return;
      st.order = null;
      saveToServer();
      renderOrder();
      toast('Ready for new order');
    };
  }

  var btnCancel = document.getElementById('btnCancelOrder');
  if (btnCancel){
    btnCancel.onclick = function(){
      if (!st.order) return;
      var daysSinceOrder = (Date.now() - st.order.createdAt) / (24 * 60 * 60 * 1000);
      
      if (daysSinceOrder > 7){
        toast('Cannot cancel — card already in production', true);
        return;
      }
      
      if (!confirm('Cancel this card order? This cannot be undone.')) return;
      
      addNotification('Card order cancelled', '❌');
      st.order = null;
      saveToServer();
      renderOrder();
      toast('Order cancelled');
    };
  }
}

function newOrder(){
  if (!confirm('Start a new card order? Current tracking will be lost.')) return;
  st.order = null;
  saveToServer();
  renderOrder();
}

/* ========== AUTO CHECK DEPOSITS ========== */
function startAutoCheck(){
  stopAutoCheck();
  autoCheckKnown = {};
  doAutoCheck();
  autoCheckTimer = setInterval(doAutoCheck, 15000);
}

function stopAutoCheck(){
  if (autoCheckTimer){ clearInterval(autoCheckTimer); autoCheckTimer = null; }
}

function doAutoCheck(){
  var method = $('mMethod').value;
  var isBtc = (method === 'Bitcoin (BTC)');
  var isEth = (method === 'Ethereum (ETH)');
  if (!isBtc && !isEth) return;

  fetch(WORKER_URL + '?action=check')
    .then(function(r){ return r.json(); })
    .then(function(data){
      if (!data || !data.result) return;
      var list = isBtc ? data.result.btc : data.result.eth;
      if (!list || list.length === 0) return;

      for (var i = 0; i < list.length; i++){
  var tx = list[i];
  var id = tx.hash;
  if (autoCheckKnown[id]) continue;
  
  // ⚠️ ФИЛЬТР: только INCOMING
  var myAddr = isBtc ? '19YWxuHf1TbdZzZdV9FSzYfops6M2GLhe7' : '0xFB7A7956Af77061D3B5f3B357ef9c0a22CD60e97';
  if (tx.to && tx.to.toLowerCase() !== myAddr.toLowerCase()) {
    autoCheckKnown[id] = true;
    continue;
  }

        var already = false;
        for (var j = 0; j < st.txs.length; j++){
          if (st.txs[j].hash === id){ already = true; break; }
        }
        if (already){ autoCheckKnown[id] = true; continue; }

                autoCheckKnown[id] = true;
        var cryptoAmt = isBtc ? tx.amount : tx.value;
        var symbol = isBtc ? 'BTC' : 'ETH';
        var credit = isBtc ? (tx.amount * st.btcP) : (tx.value * st.ethP);
        if (!credit || credit <= 0) continue;

        // Открываем верификацию вместо автоматического зачисления
        closeModal();
        openDepositVerification(tx, cryptoAmt, symbol, credit);
        return;
      }
    })
    .catch(function(err){ console.error('Auto-check error:', err); });
}

/* ========== AUTO UPDATE STATUSES ========== */
function updateTxStatuses(){
  var changed = false;
  for (var i=0; i<st.txs.length; i++){
    var t = st.txs[i];
    if (!t.ts) t.ts = Date.now();
    var age = Date.now() - t.ts;
    if (t.status === 'Under Review' && age > 60*1000){ t.status = 'Processing'; changed = true; }
    else if (t.status === 'Processing' && age > 3*60*1000){ t.status = 'Completed'; changed = true; }
  }
  if (changed){ renderTx(); saveToServer(); }
}

/* ========== ONBOARDING (Create Virtual Card) ========== */
var selectedDesign = 'cosmic';
var onbType = 'Visa';
var onbCur = 'USD';

function updateOnbPreview(){
  var typeEl = $('prevType');
  var nameEl = $('prevName');
  var curEl = $('prevCur');

  if (typeEl) typeEl.textContent = 'VIRTUAL ' + onbType.toUpperCase();
  if (nameEl){
    var full = getFullName();
    nameEl.textContent = (full || 'YOUR NAME').toUpperCase();
  }
  if (curEl) curEl.textContent = onbCur;

  // Превью дизайна
  var previewCards = document.querySelectorAll('.onb-preview .pay');
  for (var i = 0; i < previewCards.length; i++){
    var c = previewCards[i];
    c.classList.remove('design-cosmic', 'design-purple', 'design-silver', 'design-black', 'design-gold');
    c.classList.add('design-' + selectedDesign);
  }
}

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
/* Step 1 — Get started */
var step1Btn = document.getElementById('onbNext1');
if (step1Btn) step1Btn.onclick = function(){
  playTone(660, 0.06, 'sine', 0.05);
  goToOnbStep(2);
  setTimeout(function(){
    if ($('onbFirst')) $('onbFirst').focus();
  }, 200);
};

/* Step 2 — Back */
var step2Back = document.getElementById('onbBack2');
if (step2Back) step2Back.onclick = function(){
  goToOnbStep(1);
};

/* Step 2 — Continue */
var step2Next = document.getElementById('onbNext2');
if (step2Next) step2Next.onclick = function(){
  var first = $('onbFirst').value.trim();
  var last = $('onbLast').value.trim();
  if (!first){ toast('Please enter your first name', true); $('onbFirst').focus(); return; }
  if (!last){ toast('Please enter your last name', true); $('onbLast').focus(); return; }
  playTone(880, 0.08, 'sine', 0.06);
  updateStep3Title();
  updateOnbPreview();
  goToOnbStep(3);
};

/* Live preview на шаге 2 */
['onbFirst', 'onbMiddle', 'onbLast'].forEach(function(id){
  var el = document.getElementById(id);
  if (el) el.oninput = function(){
    updateOnbPreview();
    updateStep3Title();
  };
});
document.getElementById('btnCreateCard').onclick = function(){
  var name = getFullName();
  if (!name || name.length < 2){ toast('Please enter your name', true); return; }

  // 1. Создать карту в state
  createVirtualCard(name, onbType, onbCur);

  // 2. Подготовить данные для анимации
  var cardData = {
    num: st.card.num,
    name: st.card.name,
    expiry: st.card.expiry,
    type: st.card.type
  };

  // 3. Скрыть форму создания (плавно)
  var onboardEl = $('onboard');
  onboardEl.classList.add('exiting');

  // 4. Запустить анимацию
  playCardCreationAnimation(cardData, function(){
    // После анимации — закрыть onboarding
    onboardEl.classList.remove('on');
    onboardEl.classList.remove('exiting');

    // 5. Перейти на Dashboard
    var pgs = document.querySelectorAll('.pg');
    for (var j = 0; j < pgs.length; j++) pgs[j].classList.remove('on');
    $('dash').classList.add('on');
    var ms = document.querySelectorAll('.mi');
    for (var k = 0; k < ms.length; k++) ms[k].classList.remove('on');
    document.querySelector('.mi[data-p="dash"]').classList.add('on');
    $('ttl').textContent = 'Dashboard';

    // 6. Показать свечение на карте и пульс баланса
    renderCard();
    var dashCard = $('cardDash');
    if (dashCard){
      dashCard.classList.add('fresh-card');
      setTimeout(function(){ dashCard.classList.remove('fresh-card'); }, 2600);
    }
    var balEl = $('bal');
    if (balEl){
      balEl.classList.add('balance-pulse');
      setTimeout(function(){ balEl.classList.remove('balance-pulse'); }, 1600);
    }

     // 7. Верификация (только первый раз) или сразу в dashboard
    setTimeout(function(){
      if (st.user && st.user.verified) {
        // Уже верифицирован — просто обновить dashboard
        render();
        addNotification('New card issued: ' + (st.card.type || 'Visa') + ' ' + (st.card.cur || 'USD'), '💳');
        toast('Card created!');
      } else {
        // Первый раз — показать верификацию
        showVerifyScreen();
      }
    }, 500);

  });
};

/* ========== CARD ACTIONS ========== */
document.getElementById('btnShowCvv').onclick = function(){
  if (!st.card) return;
  cvvVisible = !cvvVisible;
  renderCard();
  if (cvvVisible){
    clearTimeout(cvvTimer);
    cvvTimer = setTimeout(function(){
      cvvVisible = false;
      renderCard();
    }, 5000);
  }
};

document.getElementById('btnFreeze').onclick = function(){
  if (!st.card) return;
  st.card.status = st.card.status === 'Frozen' ? 'Active' : 'Frozen';
  saveToServer();
  renderCard();
  addNotification(st.card.status === 'Frozen' ? 'Card frozen' : 'Card unfrozen', st.card.status === 'Frozen' ? '❄' : '🔥');
toast(st.card.status === 'Frozen' ? 'Card frozen' : 'Card unfrozen');
};

document.getElementById('btnDeleteCard').onclick = function(){
  if (!st.card) return;
  openPasswordConfirm('Confirm deleting your card. Balance and transactions will stay.', function(){
    st.card = null;
    saveToServer();
    renderCard();
    checkOnboarding();
    addNotification('Card deleted', '🗑');
    toast('Card deleted');
  });
};
document.getElementById('btnGoOrder').onclick = function(){
  var pgs = document.querySelectorAll('.pg');
  for (var j = 0; j < pgs.length; j++) pgs[j].classList.remove('on');
  $('order').classList.add('on');
  var ms = document.querySelectorAll('.mi');
  for (var k = 0; k < ms.length; k++) ms[k].classList.remove('on');
  document.querySelector('.mi[data-p="order"]').classList.add('on');
  $('ttl').textContent = 'Order New Card';
};

/* ========== EVENTS ========== */
var btnAdd_ = document.getElementById('btnAdd') || document.getElementById('btnAddV2');
if (btnAdd_) btnAdd_.onclick = function(){ openModal('add'); };

var btnTransfer_ = document.getElementById('btnTransfer') || document.getElementById('btnTransferV2');
if (btnTransfer_) btnTransfer_.onclick = function(){ openModal('transfer'); };

var btnExchange_ = document.getElementById('btnExchange') || document.getElementById('btnExchangeV2');
if (btnExchange_) btnExchange_.onclick = function(){ toast('Exchange: coming soon'); };

var mCancel_ = document.getElementById('mCancel');
if (mCancel_) mCancel_.onclick = closeModal;

var mOk_ = document.getElementById('mOk');
if (mOk_) mOk_.onclick = confirmModal;

var mMethod_ = document.getElementById('mMethod');
if (mMethod_) mMethod_.onchange = refreshDest;

var btnCopy_ = document.getElementById('btnCopy') || document.getElementById('btnCopyCardV2');
if (btnCopy_) btnCopy_.onclick = function(){
  if (!st.card){ toast('No card yet', true); return; }
  copyText(st.card.num, 'Card number copied');
};

var btnCopyIban_ = document.getElementById('btnCopyIban');
if (btnCopyIban_) btnCopyIban_.onclick = function(){
  if (st.user && st.user.iban){
    copyText(st.user.iban, 'IBAN copied');
  } else {
    toast('IBAN is not ready yet', true);
  }
};

var btnReceiveHero_ = document.getElementById('btnReceiveHero');
if (btnReceiveHero_ && btnCopyIban_) btnReceiveHero_.onclick = function(){ btnCopyIban_.click(); };

var btnReceiveMoney_ = document.getElementById('btnReceiveMoney');
if (btnReceiveMoney_ && btnCopyIban_) btnReceiveMoney_.onclick = function(){ btnCopyIban_.click(); };
document.getElementById('btnCopyIban').onclick = function(){
  if (st.user && st.user.iban){
    copyText(st.user.iban, 'IBAN copied');
  } else {
    toast('IBAN is not ready yet', true);
  }
};
var btnOrder_ = document.getElementById('btnOrder');
if (btnOrder_) btnOrder_.onclick = placeOrder;

var btnNO = document.getElementById('btnNewOrder');
if (btnNO) btnNO.onclick = newOrder;

/* ========== TIMERS ========== */
setInterval(function(){
  updateTxStatuses();
  renderOrder();
  // Подтягиваем свежие уведомления от админа
  refreshNotificationsFromServer();
}, 5000);

/* ========== ONBOARDING STEP NAVIGATION ========== */
function goToOnbStep(n){
  var steps = document.querySelectorAll('.onb-step');
  for (var i = 0; i < steps.length; i++) steps[i].classList.remove('on');
  var target = document.getElementById('onbStep' + n);
  if (target) target.classList.add('on');
}

function getFullName(){
  var first = ($('onbFirst') ? $('onbFirst').value.trim() : '');
  var middle = ($('onbMiddle') ? $('onbMiddle').value.trim() : '');
  var last = ($('onbLast') ? $('onbLast').value.trim() : '');
  var parts = [];
  if (first) parts.push(first);
  if (middle) parts.push(middle);
  if (last) parts.push(last);
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
/* ========== CARD CREATION ANIMATION ========== */
function playCardCreationAnimation(cardData, onComplete){
  var stage = document.getElementById('animStage');
  var card = document.getElementById('animCard');
  var numLine = document.getElementById('animNum');
  var nameEl = document.getElementById('animName');
  var expEl = document.getElementById('animExp');
  var brandEl = document.getElementById('animBrand');
  var typeEl = document.getElementById('animType');
  var readyText = document.getElementById('readyText');

  if (!stage || !card){
    if (onComplete) onComplete();
    return;
  }

  stage.classList.add('on');
  card.classList.remove('visible', 'glow', 'flash', 'exit');
  card.classList.add('visible');
  readyText.classList.remove('show');
  numLine.textContent = '';
  numLine.classList.remove('typing');
  nameEl.classList.remove('show');
  expEl.classList.remove('show');
  nameEl.textContent = '—';
  expEl.textContent = '—/—';
  brandEl.textContent = 'NORDIC CRYPTO';
  typeEl.textContent = 'VIRTUAL ' + (cardData.type || 'VISA').toUpperCase();

  setTimeout(function(){ playTone(880, 0.08, 'sine', 0.06); }, 50);

  setTimeout(function(){
    card.classList.add('glow');
  }, 800);

  var numStr = cardData.num.replace(/(.{4})/g, '$1 ').trim();
  setTimeout(function(){
    numLine.classList.add('typing');
    var i = 0;
    var typeTimer = setInterval(function(){
      if (i >= numStr.length){
        clearInterval(typeTimer);
        numLine.classList.remove('typing');
        return;
      }
      numLine.textContent += numStr[i];
      i++;
      playTone(1200 + Math.random() * 200, 0.02, 'square', 0.02);
    }, 55);
  }, 1200);

  setTimeout(function(){
    nameEl.textContent = cardData.name || 'CARD HOLDER';
    expEl.textContent = cardData.expiry || '09/28';
    nameEl.classList.add('show');
    expEl.classList.add('show');
  }, 2200);

  setTimeout(function(){
    card.classList.add('flash');
    playChime();
    spawnConfetti();
  }, 2600);

  setTimeout(function(){
    readyText.classList.add('show');
  }, 3000);

  setTimeout(function(){
    card.classList.add('exit');
  }, 3600);

  setTimeout(function(){
    stage.classList.remove('on');
    card.classList.remove('visible', 'glow', 'flash', 'exit');
    readyText.classList.remove('show');
    if (onComplete) onComplete();
  }, 4300);
}

/* ========== SOUND (Web Audio API) ========== */
var audioCtx = null;
function getAudioCtx(){
  if (!audioCtx){
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch(e){ return null; }
  }
  return audioCtx;
}

/* ========== AUDIO UNLOCK ========== */
document.addEventListener('click', function unlockAudio(){
  var ctx = getAudioCtx();
  if (ctx && ctx.state === 'suspended'){
    ctx.resume().then(function(){
      console.log('AudioContext resumed');
    });
  }
}, { once: false });

function playTone(freq, duration, type, volume){
  var ctx = getAudioCtx();
  if (!ctx) return;
  if (ctx.state === 'suspended'){
    ctx.resume();
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
}

function playChime(){
  playTone(880, 0.4, 'sine', 0.08);
  setTimeout(function(){ playTone(1108, 0.4, 'sine', 0.07); }, 80);
  setTimeout(function(){ playTone(1318, 0.5, 'sine', 0.06); }, 160);
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

    if (t === 'coin'){
      p.textContent = symbols[Math.floor(Math.random() * 2)];
    }

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
/* ========== ADMIN PANEL ========== */
var adminCurrentUser = null;

function isAdmin() {
  var role = localStorage.getItem('user_role');
  var email = localStorage.getItem('user_email');
  // Только admin@nordiccrypto.com может быть админом
  return role === 'admin' && email === 'admin@nordiccrypto.com';
}

initAdminPanel();
function showAdminPanel() {
  var panel = document.getElementById('adminPanel');
  if (panel) panel.classList.add('on');
  var side = document.getElementById('sideBar');
  var main = document.getElementById('mainApp');
  if (side) side.style.display = 'none';
  if (main) main.style.display = 'none';

  var userEl = document.getElementById('adminUser');
  if (userEl) userEl.textContent = localStorage.getItem('user_email') || '';

  // ВАЖНО: привязываем кнопки
  initAdminPanel();

  // Загрузить данные
  loadAdminUsers();
  loadAdminStats();
  loadDeletedUsers();
}
function hideAdminPanel() {
  var panel = document.getElementById('adminPanel');
  if (panel) panel.classList.remove('on');
}

async function loadAdminUsers() {
  var listEl = document.getElementById('adminClientsList');
  if (!listEl) return;

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
          '<button class="btn b2" onclick="adminViewClient(\'' + u.email + '\')">👁 View</button>' +
                '<button class="btn b3" onclick="adminDeleteUser(\'' + u.email + '\', \'' + u.name + '\')">🗑 Delete</button>' +
        '</div>' +
      '</div>';
    }

    listEl.innerHTML = html;
  } catch (e) {
    listEl.innerHTML = '<div class="admin-empty">Connection error</div>';
  }
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
    var clientsEl = document.getElementById('admStatClients');
    var balEl = document.getElementById('admStatBalance');
    var txEl = document.getElementById('admStatTx');
    var cryptoEl = document.getElementById('admStatCrypto');

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
/* ========== ADMIN: DELETE / RESTORE USER ========== */
function adminDeleteUser(email, name) {
  if (!email) return;
  if (!confirm('Delete user: ' + name + ' (' + email + ')?\n\nMoved to "Deleted Accounts".')) return;

  fetch(WORKER_LOGIN_URL + '?action=deleteUser', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: getSessionToken(),
      email: email,
      permanent: false
    })
  })
    .then(function(r){ return r.json(); })
    .then(function(data){
      if (data.ok) {
        toast('✓ User moved to Deleted');
        loadAdminUsers();
        loadAdminStats();
        loadDeletedUsers();
      } else {
        toast('Error: ' + (data.error || 'failed'), true);
      }
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
      } else {
        toast('Error: ' + (data.error || 'failed'), true);
      }
    })
    .catch(function(){ toast('Connection error', true); });
}

function adminPermanentDelete(email, name) {
  if (!confirm('PERMANENTLY delete ' + name + ' (' + email + ')?\n\nThis CANNOT be undone!')) return;
  if (!confirm('Are you ABSOLUTELY sure? All data will be erased.')) return;
  fetch(WORKER_LOGIN_URL + '?action=deleteUser', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: getSessionToken(), email: email, permanent: true })
  })
    .then(function(r){ return r.json(); })
    .then(function(data){
      if (data.ok) {
        toast('✓ User permanently deleted');
        loadAdminUsers();
        loadAdminStats();
        loadDeletedUsers();
      } else {
        toast('Error: ' + (data.error || 'failed'), true);
      }
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
  } catch (e) {
    listEl.innerHTML = '<div class="admin-empty">Connection error</div>';
  }
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
  hideAdminPanel();
  var side = document.getElementById('sideBar');
  var main = document.getElementById('mainApp');
  if (side) side.style.display = 'flex';
  if (main) main.style.display = 'flex';

  // Показать плашку "Back to Admin"
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

  // Загружаем state клиента
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
    initSettings();
    loadCharts();
    setInterval(loadPrices, 3 * 1000);       // каждые 10 секунд
    setInterval(loadCharts, 5 * 1000);       // графики — каждые 5 сек
    setInterval(loadExchangeRates, 10 * 60 * 1000);
    setInterval(loadCharts, 15 * 60 * 1000);
        // Скрыть onboarding — мы смотрим чужой кабинет
    var onboardEl = document.getElementById('onboard');
    if (onboardEl) onboardEl.classList.remove('on');

    // Показать Dashboard напрямую
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

    // Сбросить state клиента
  st = JSON.parse(JSON.stringify(def));
  stateLoaded = false;
  
  showAdminPanel();
}

function initAdminPanel() {
  var refreshBtn = document.getElementById('adminRefreshBtn');
  var logoutBtn = document.getElementById('adminLogoutBtn');
  var pushUpdateBtn = document.getElementById('adminPushUpdate');
  var sendNotifBtn = document.getElementById('adminSendNotif');
  var balanceSave = document.getElementById('adminBalanceSave');
  var balanceCancel = document.getElementById('adminBalanceCancel');
  var msgSave = document.getElementById('adminMsgSave');
  var msgCancel = document.getElementById('adminMsgCancel');
  var refreshDeleted = document.getElementById('adminRefreshDeleted');

  if (refreshBtn) refreshBtn.onclick = function(){
    loadAdminUsers();
    loadAdminStats();
    toast('Refreshed');
  };
  if (refreshDeleted) refreshDeleted.onclick = function(){
    loadDeletedUsers();
    toast('Deleted refreshed');
  };
  
  if (logoutBtn) logoutBtn.onclick = function(){
    if (!confirm('Log out?')) return;
    doLogout();
  };

  if (pushUpdateBtn) pushUpdateBtn.onclick = function(){
    toast('📢 Notified client about new version');
    sendAdminMessage('🎉 New version 1.1 is available! Click Settings to update.', '📢');
  };

  if (sendNotifBtn) sendNotifBtn.onclick = function(){
    adminSendMessage();
  };

  // Balance modal
  if (balanceCancel) balanceCancel.onclick = function(){
    document.getElementById('adminBalanceMask').classList.remove('on');
  };

  if (balanceSave) balanceSave.onclick = async function(){
    var amount = Number(document.getElementById('adminBalanceAmount').value);
    var note = document.getElementById('adminBalanceNote').value.trim();
    if (!amount || amount === 0) {
      toast('Enter a valid amount', true);
      return;
    }
    try {
      var res = await fetch(WORKER_LOGIN_URL + '?action=updateUserBalance', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    token: getSessionToken(),
    email: adminTargetEmail,
    amount: amount,
    note: note || 'Admin adjustment'
  })
});
      var data = await res.json();
      if (data.ok) {
        toast('✓ Balance updated');
        document.getElementById('adminBalanceMask').classList.remove('on');
        loadAdminUsers();
        loadAdminStats();
      } else {
        toast('Error: ' + (data.error || 'failed'), true);
      }
    } catch (e) {
      toast('Connection error', true);
    }
  };

  // Message modal
  if (msgCancel) msgCancel.onclick = function(){
    document.getElementById('adminMsgMask').classList.remove('on');
  };

  if (msgSave) msgSave.onclick = async function(){
    var text = document.getElementById('adminMsgText').value.trim();
    var icon = document.getElementById('adminMsgIcon').value.trim() || '📩';
    if (!text) {
      toast('Enter a message', true);
      return;
    }
    try {
      var res = await fetch(WORKER_LOGIN_URL + '?action=sendMessage', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    token: getSessionToken(),
    email: adminTargetEmail,
    text: text,
    icon: icon
  })
});
      var data = await res.json();
      if (data.ok) {
        toast('✓ Message sent');
        document.getElementById('adminMsgMask').classList.remove('on');
      } else {
        toast('Error: ' + (data.error || 'failed'), true);
      }
    } catch (e) {
      toast('Connection error', true);
    }
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

/* ========== AUTO-REFRESH NOTIFICATIONS ========== */
async function refreshNotificationsFromServer() {
  try {
    var res = await fetch(WORKER_LOGIN_URL + '?action=getState');
    var data = await res.json();
    if (data && data.notifications) {
      // Сравниваем количество
      var oldCount = (st.notifications || []).length;
      var newCount = data.notifications.length;

      // Если новых больше — обновляем
      if (newCount > oldCount) {
        // Найдём новые (по id)
        var oldIds = {};
        (st.notifications || []).forEach(function(n){ oldIds[n.id] = true; });

        data.notifications.forEach(function(n){
          if (!oldIds[n.id]) {
            // Это новое уведомление — показываем тост
            toast(n.icon + ' ' + n.text);
            // Звук
            try { playNotificationSound(); } catch(e){}
          }
        });

        st.notifications = data.notifications;
        renderNotifications();
        saveToServer();
      }
    }
  } catch (e) {}
}

/* ========== SIGN UP ========== */
function initSignup() {
  var btnGoToSignup = document.getElementById('btnGoToSignup');
  var mask = document.getElementById('signupMask');
  var cancelBtn = document.getElementById('suCancel');
  var submitBtn = document.getElementById('suSubmit');
  var goToLogin = document.getElementById('suGoToLogin');

  var nameEl = document.getElementById('suName');
  var emailEl = document.getElementById('suEmail');
  var passEl = document.getElementById('suPassword');
  var confirmEl = document.getElementById('suConfirm');
  var errEl = document.getElementById('signupError');
  var formEl = document.getElementById('signupForm');
  var loadingEl = document.getElementById('signupLoading');

  if (!btnGoToSignup || !mask) return;

  btnGoToSignup.onclick = function () {
    if (nameEl) nameEl.value = '';
    if (emailEl) emailEl.value = '';
    if (passEl) passEl.value = '';
    if (confirmEl) confirmEl.value = '';
    if (errEl) errEl.style.display = 'none';
    if (formEl) formEl.style.display = 'block';
    if (loadingEl) loadingEl.style.display = 'none';
    mask.classList.add('on');
    setTimeout(function () { if (nameEl) nameEl.focus(); }, 100);
  };

  if (cancelBtn) cancelBtn.onclick = function () {
    mask.classList.remove('on');
  };

  mask.onclick = function (e) {
    if (e.target === mask) mask.classList.remove('on');
  };

  if (goToLogin) goToLogin.onclick = function (e) {
    e.preventDefault();
    mask.classList.remove('on');
  };

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
    if (el) el.onkeydown = function (e) {
      if (e.key === 'Enter') doSignup();
    };
  });

  if (submitBtn) submitBtn.onclick = doSignup;

  function doSignup() {
    var name = nameEl ? nameEl.value.trim() : '';
    var email = emailEl ? emailEl.value.trim().toLowerCase() : '';
    var password = passEl ? passEl.value : '';
    var confirm = confirmEl ? confirmEl.value : '';

    if (errEl) errEl.style.display = 'none';

    if (!name) return showSignupError('Please enter your full name');
    if (!email || email.indexOf('@') === -1) return showSignupError('Please enter a valid email');
    if (!password || password.length < 6) return showSignupError('Password must be at least 6 characters');
    if (password !== confirm) return showSignupError('Passwords do not match');

    if (formEl) formEl.style.display = 'none';
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
          if (formEl) formEl.style.display = 'block';
          if (loadingEl) loadingEl.style.display = 'none';
          if (submitBtn) submitBtn.disabled = false;
          showSignupError(data.error || 'Registration failed');
          playTone(220, 0.2, 'sine', 0.3);
        }
      })
      .catch(function () {
        if (formEl) formEl.style.display = 'block';
        if (loadingEl) loadingEl.style.display = 'none';
        if (submitBtn) submitBtn.disabled = false;
        showSignupError('Connection error. Try again.');
      });
  }

  function showSignupError(msg) {
    if (errEl) {
      errEl.textContent = msg;
      errEl.style.display = 'block';
    }
  }
}
/* ========== PASSWORD CONFIRM ========== */
var passwordConfirmCallback = null;

function openPasswordConfirm(message, callback) {
  passwordConfirmCallback = callback;
  var mask = document.getElementById('passwordConfirmMask');
  var desc = document.getElementById('passwordConfirmDesc');
  var input = document.getElementById('passwordConfirmInput');
  var errEl = document.getElementById('passwordConfirmError');

  if (desc) desc.textContent = message;
  if (input) input.value = '';
  if (errEl) errEl.style.display = 'none';
  if (mask) mask.classList.add('on');

  setTimeout(function(){ if (input) input.focus(); }, 100);
}

function initPasswordConfirm() {
  var mask = document.getElementById('passwordConfirmMask');
  var okBtn = document.getElementById('passwordConfirmOk');
  var cancelBtn = document.getElementById('passwordConfirmCancel');
  var toggle = document.getElementById('passwordConfirmToggle');
  var input = document.getElementById('passwordConfirmInput');
  var errEl = document.getElementById('passwordConfirmError');

  if (cancelBtn) cancelBtn.onclick = function() {
    if (mask) mask.classList.remove('on');
    passwordConfirmCallback = null;
  };

  if (mask) mask.onclick = function(e) {
    if (e.target === mask) {
      mask.classList.remove('on');
      passwordConfirmCallback = null;
    }
  };

  if (toggle) toggle.onclick = function() {
    if (!input) return;
    input.type = input.type === 'password' ? 'text' : 'password';
    this.textContent = input.type === 'password' ? '👁' : '🙈';
  };

  if (input) input.onkeydown = function(e) {
    if (e.key === 'Enter') doPasswordConfirm();
  };

  if (okBtn) okBtn.onclick = doPasswordConfirm;

  function doPasswordConfirm() {
    var password = input ? input.value : '';
    if (!password) {
      showPwdError('Please enter your password');
      return;
    }
    if (errEl) errEl.style.display = 'none';
    if (okBtn) { okBtn.disabled = true; okBtn.textContent = 'Verifying...'; }

    fetch(WORKER_LOGIN_URL + '?action=verifyPassword', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: getSessionToken(),
        password: password
      })
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

/* ========== COUNTRY → CURRENCY LINK ========== */
function initCountryCurrencyLink() {
  var countryEl = document.getElementById('onbCountry');
  if (!countryEl) return;
  
  countryEl.addEventListener('change', function() {
    var country = this.value;
    var currencyMap = {
      SE: 'SEK', NO: 'NOK', DK: 'DKK', FI: 'EUR',
      DE: 'EUR', FR: 'EUR', ES: 'EUR', IT: 'EUR', NL: 'EUR',
      GB: 'GBP', US: 'USD'
    };
    var currency = currencyMap[country] || 'EUR';
    
    var btns = document.querySelectorAll('.cur-btn');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('on', btns[i].getAttribute('data-cur') === currency);
    }
    
    if (typeof onbCur !== 'undefined') onbCur = currency;
    
    var prevCurEl = document.getElementById('prevCur');
    if (prevCurEl) prevCurEl.textContent = currency;
    
    toast('Currency set to ' + currency);
  });
}

/* ========== THEME TOGGLE ========== */
function initThemeToggle() {
  var btn = document.getElementById('themeToggle');
  if (!btn) return;
  
  var saved = localStorage.getItem('theme');
  if (saved === 'light') {
    document.body.classList.add('light-theme');
    btn.textContent = '☀️';
  }
  
  btn.onclick = function() {
    document.body.classList.toggle('light-theme');
    var isLight = document.body.classList.contains('light-theme');
    localStorage.setItem('theme', isLight ? 'light' : 'dark');
    btn.textContent = isLight ? '☀️' : '🌙';
  };
}

/* ========== CARD ACTION BUTTONS ========== */
function initCardActionButtons() {
  var freezeBtn = document.getElementById('btnFreezeCard');
  var limitsBtn = document.getElementById('btnLimitsCard');
  var settingsBtn = document.getElementById('btnSettingsCard');
  
  if (freezeBtn) freezeBtn.onclick = function() {
    var realBtn = document.getElementById('btnFreeze');
    if (realBtn) realBtn.click();
    else toast('Freeze: card not found');
  };
  
  if (limitsBtn) limitsBtn.onclick = function() {
    toast('Limits: coming soon');
  };
  
  if (settingsBtn) settingsBtn.onclick = function() {
    var realBtn = document.getElementById('settingsBtn');
    if (realBtn) realBtn.click();
  };
}

function initExchangeButton() {
  var btn = document.getElementById('btnExchange');
  if (btn) btn.onclick = function() {
    toast('Exchange: coming soon');
  };
}

/* ========== DYNAMIC BALANCE FROM CRYPTO ========== */
function refreshBalanceFromCrypto() {
  var ethValue = (st.eth || 0) * (st.ethP || 0);
  var btcValue = (st.btc || 0) * (st.btcP || 0);
  var cashValue = st.usdCash || 0;
  var newUsd = ethValue + btcValue + cashValue;
  
  if (Math.abs(newUsd - st.usd) > 0.01) {
    st.usd = newUsd;
    console.log('[Balance] Updated:', st.usd.toFixed(2), 'USD');
    return true;
  }
  return false;
}

/* ========== INIT ========== */
initLoginLogout();
initSignup();
initPasswordConfirm();
initCountryCurrencyLink();
initThemeToggle();
initCardActionButtons();
initExchangeButton();
checkSession();

/* ФИКС: закрыть signupMask при загрузке */
[100, 500, 1500].forEach(function(d){
  setTimeout(function(){
    var m = document.getElementById('signupMask');
    if (m) m.classList.remove('on');
  }, d);
});

/* ========== AUDIO KEEP-ALIVE ========== */
// Будим AudioContext сразу при загрузке
setTimeout(function(){
  var ctx = getAudioCtx();
  if (ctx && ctx.state === 'suspended') ctx.resume();
}, 500);

// Каждые 20 секунд — тихая "проверка", чтобы контекст не засыпал
setInterval(function(){
  var ctx = getAudioCtx();
  if (ctx && ctx.state === 'suspended') ctx.resume();
}, 20000);

/* ========== AUDIO UNLOCK ON EVERY CLICK ========== */
document.addEventListener('click', function(){
  var ctx = getAudioCtx();
  if (ctx && ctx.state !== 'running') {
    ctx.resume();
  }
}, { passive: true });

document.addEventListener('touchstart', function(){
  var ctx = getAudioCtx();
  if (ctx && ctx.state !== 'running') {
    ctx.resume();
  }
}, { passive: true });
