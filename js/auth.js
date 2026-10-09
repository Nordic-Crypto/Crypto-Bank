/* ============================================================
   NORDIC CRYPTO — AUTH.JS v2.1
   ============================================================
   FIXES v2.1:
   - ✅ Emits nc:auth:login / nc:auth:logout
   - ✅ Fallback when showApp() is missing
   - ✅ checkSession does not enter app before verify
   - ✅ Auto-bootstraps initLoginLogout / initSignup / initPasswordConfirm
   - ✅ Race-safe password confirm
   - ✅ addEventListener instead of onclick (no legacy overwrite)
   - ✅ Throttled mousemove
   - ✅ Welcome bonus on first signup / login
   - ✅ All client-facing strings in ENGLISH
   ============================================================ */

(function () {
  'use strict';

  // ---------- Fallback constants ----------
  function WURL()      { return window.WORKER_LOGIN_URL   || 'https://nordic-deposit-checker.otis-790.workers.dev'; }
  function SESSION_MS(){ return window.SESSION_TIMEOUT_MS || 15 * 60 * 1000; }
  function LOGOUT_S()  { return window.LOGOUT_COUNTDOWN   || 60; }

  // ---------- Local state ----------
  var __nc_sessionTimer    = null;
  var __nc_countdownTimer  = null;
  var __nc_countdownLeft   = 60;
  var __nc_inactivityOn    = false;
  var __nc_pwCallback      = null;
  var __nc_pwBusy          = false;
  var __nc_lastMove        = 0;

  // ============================================================
  // HELPER: safe app reveal with fallback
  // ============================================================
  function showAppSafe() {
    if (typeof window.showApp === 'function') {
      window.showApp();
      return;
    }
    console.warn('[Auth] showApp() missing — using fallback reveal');
    var login = document.getElementById('loginScreen');
    var side  = document.getElementById('sideBar');
    var main  = document.getElementById('mainApp');
    if (login) login.classList.add('hidden');
    if (side)  side.style.display = '';
    if (main)  main.style.display = '';
    document.body.classList.add('app-active');
  }

  // ============================================================
  // HELPER: auth events
  // ============================================================
  function emitLogin(user, token, restored) {
    try {
      document.dispatchEvent(new CustomEvent('nc:auth:login', {
        detail: { user: user, token: token, restored: !!restored, ts: Date.now() }
      }));
    } catch (e) { console.warn('[Auth] emit login failed', e); }
  }
  function emitLogout() {
    try {
      document.dispatchEvent(new CustomEvent('nc:auth:logout', { detail: { ts: Date.now() } }));
    } catch (e) { console.warn('[Auth] emit logout failed', e); }
  }

  // ============================================================
  // HELPER: welcome bonus (once per user)
  // ============================================================
  function tryWelcomeBonus(user) {
    if (!user || !user.id) return;
    var key = 'nc_welcome_bonus_' + user.id;
    if (localStorage.getItem(key)) return;
    if (typeof window.NC_BONUS !== 'object') return;
    window.NC_BONUS.grant(user.id, 'welcome', 10);
    localStorage.setItem(key, String(Date.now()));
  }

  // ============================================================
  // LOGIN
  // ============================================================
  window.doLogin = async function () {
    var emailEl   = document.getElementById('loginEmail');
    var passEl    = document.getElementById('loginPassword');
    var errorEl   = document.getElementById('loginError');
    var btnLogin  = document.getElementById('btnLogin');
    var loginForm = document.getElementById('loginForm');
    var loginLoad = document.getElementById('loginLoading');

    if (!emailEl || !passEl) { console.error('[Auth] login inputs not found'); return; }

    var email    = emailEl.value.trim().toLowerCase();
    var password = passEl.value;

    if (!email || !password) { window.showLoginError('Please enter email and password'); return; }

    if (errorEl)   errorEl.style.display   = 'none';
    if (loginForm) loginForm.style.display = 'none';
    if (loginLoad) loginLoad.style.display = 'block';
    if (btnLogin)  btnLogin.disabled = true;

    try {
      var res  = await fetch(WURL() + '?action=login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email, password: password })
      });
      var data = await res.json();

      if (data.ok && data.token) {
        window.setSessionToken(data.token);
        localStorage.setItem('user_email', data.user.email);
        localStorage.setItem('user_role',  data.user.role || 'user');

        var niceName = data.user.name || 'User';
        if (!data.user.name) {
          var fromEmail = (data.user.email || '').split('@')[0];
          niceName = fromEmail.charAt(0).toUpperCase() + fromEmail.slice(1);
        }
        localStorage.setItem('user_name', niceName);

        window.hideLoginScreen();
        showAppSafe();
        emitLogin(data.user, data.token, false);
        window.startInactivityTimer();
        tryWelcomeBonus(data.user);

        if (typeof window.playChime === 'function') window.playChime();

      } else {
        if (loginForm) loginForm.style.display = 'block';
        if (loginLoad) loginLoad.style.display = 'none';
        if (btnLogin)  btnLogin.disabled = false;
        window.showLoginError(data.error || 'Login failed. Please check your credentials.');
        if (typeof window.playTone === 'function') window.playTone(220, 0.2, 'sine', 0.3);
      }
    } catch (e) {
      if (loginForm) loginForm.style.display = 'block';
      if (loginLoad) loginLoad.style.display = 'none';
      if (btnLogin)  btnLogin.disabled = false;
      window.showLoginError('Connection error. Please try again.');
    }
  };

  window.showLoginError = function (msg) {
    var errorEl = document.getElementById('loginError');
    if (errorEl) { errorEl.textContent = msg; errorEl.style.display = 'block'; }
  };

  // ============================================================
  // SESSION CHECK — verify before entering app
  // ============================================================
  window.checkSession = async function () {
    var token = window.getSessionToken();
    if (!token) { window.showLoginScreen(); return; }

    try {
      var res  = await fetch(WURL() + '?action=verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token })
      });
      var data = await res.json();

      if (!data.ok || !data.user) {
        window.clearSessionToken();
        localStorage.removeItem('user_email');
        localStorage.removeItem('user_role');
        localStorage.removeItem('user_name');
        window.showLoginScreen();
        return;
      }

      localStorage.setItem('user_email', data.user.email);
      localStorage.setItem('user_role',  data.user.role || 'user');

      window.hideLoginScreen();
      showAppSafe();
      emitLogin(data.user, token, true);
      window.startInactivityTimer();

    } catch (e) {
      console.warn('[session] verify failed:', e);
      window.showLoginScreen();
    }
  };

  // ============================================================
  // SHOW / HIDE LOGIN SCREEN
  // ============================================================
  window.showLoginScreen = function () {
    var login = document.getElementById('loginScreen');
    var side  = document.getElementById('sideBar');
    var main  = document.getElementById('mainApp');
    if (login) login.classList.remove('hidden');
    if (side)  side.style.display = 'none';
    if (main)  main.style.display = 'none';

    var suMask = document.getElementById('signupMask');
    if (suMask) suMask.classList.remove('on');

    ['loginEmail', 'loginPassword'].forEach(function (id) {
      var el = document.getElementById(id); if (el) el.value = '';
    });
    var form    = document.getElementById('loginForm');
    var loading = document.getElementById('loginLoading');
    var err     = document.getElementById('loginError');
    if (form)    form.style.display    = 'block';
    if (loading) loading.style.display = 'none';
    if (err)     err.style.display     = 'none';
  };

  window.hideLoginScreen = function () {
    var login = document.getElementById('loginScreen');
    if (login) login.classList.add('hidden');
  };

  // ============================================================
  // LOGOUT — emits event
  // ============================================================
  window.doLogout = async function () {
    var token = window.getSessionToken();
    if (token) {
      try {
        await fetch(WURL() + '?action=logout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: token })
        });
      } catch (e) {}
    }

    emitLogout();

    window.clearSessionToken();
    localStorage.removeItem('user_email');
    localStorage.removeItem('user_role');
    localStorage.removeItem('user_name');

    clearInterval(__nc_sessionTimer);
    clearInterval(__nc_countdownTimer);
    window.hideInactivityModal();

    window.adminViewingEmail = null;
    window._exPricesCache    = null;

    document.querySelectorAll('.mask').forEach(function (m) { m.classList.remove('on'); });
    document.querySelectorAll(
      '.inactivity-overlay, .dep-verify-overlay, .notif-overlay, .verify-screen, .onboard, .onb-anim-stage'
    ).forEach(function (m) { m.classList.remove('on'); });

    var ap  = document.getElementById('adminPanel');  if (ap)  ap.classList.remove('on');
    var np  = document.getElementById('notifPanel');  if (np)  np.classList.remove('on');
    var abb = document.getElementById('adminBackBar');if (abb) abb.style.display = 'none';

    document.querySelectorAll('.mask').forEach(function (m) { m.style.display = ''; });
    window.showLoginScreen();
  };

  // ============================================================
  // INIT LOGIN / LOGOUT
  // ============================================================
  window.initLoginLogout = function () {
    var toggle = document.getElementById('passToggle');
    if (toggle) {
      toggle.onclick = function () {
        var pwd = document.getElementById('loginPassword');
        if (!pwd) return;
        pwd.type = pwd.type === 'password' ? 'text' : 'password';
        this.textContent = pwd.type === 'password' ? '👁' : '🙈';
      };
    }

    var btnLogin = document.getElementById('btnLogin');
    if (btnLogin) {
      btnLogin.onclick = null;
      btnLogin.addEventListener('click', window.doLogin);
    }

    var emailEl = document.getElementById('loginEmail');
    var passEl  = document.getElementById('loginPassword');
    if (emailEl) emailEl.onkeydown = function (e) { if (e.key === 'Enter') window.doLogin(); };
    if (passEl)  passEl.onkeydown  = function (e) { if (e.key === 'Enter') window.doLogin(); };

    var forgot = document.getElementById('forgotPass');
    if (forgot) forgot.onclick = function (e) {
      e.preventDefault();
      var msg = 'Contact support: support@nordiccrypto.com';
      if (typeof window.toast === 'function') window.toast(msg);
      else alert(msg);
    };

    var btnStillHere = document.getElementById('btnStillHere');
    var btnLogout    = document.getElementById('btnLogoutNow');
    if (btnStillHere) btnStillHere.onclick = function () {
      window.hideInactivityModal();
      window.resetInactivityTimer();
    };
    if (btnLogout) btnLogout.onclick = function () { window.doLogout(); };
  };

  // ============================================================
  // INACTIVITY
  // ============================================================
  window.startInactivityTimer = function () {
    clearTimeout(__nc_sessionTimer);
    __nc_sessionTimer = setTimeout(window.showInactivityModal, SESSION_MS());

    if (__nc_inactivityOn) return;
    __nc_inactivityOn = true;

    ['click', 'keydown', 'scroll', 'touchstart'].forEach(function (evt) {
      document.addEventListener(evt, window.resetInactivityTimer, { passive: true });
    });
    document.addEventListener('mousemove', function () {
      var now = Date.now();
      if (now - __nc_lastMove < 5000) return;
      __nc_lastMove = now;
      window.resetInactivityTimer();
    }, { passive: true });
  };

  window.resetInactivityTimer = function () {
    var modal = document.getElementById('inactivityOverlay');
    if (modal && modal.classList.contains('on')) return;
    clearTimeout(__nc_sessionTimer);
    __nc_sessionTimer = setTimeout(window.showInactivityModal, SESSION_MS());
  };

  window.showInactivityModal = function () {
    var overlay = document.getElementById('inactivityOverlay');
    if (!overlay) return;
    overlay.classList.add('on');
    __nc_countdownLeft = LOGOUT_S();
    window.updateCountdown();
    clearInterval(__nc_countdownTimer);
    __nc_countdownTimer = setInterval(function () {
      __nc_countdownLeft--;
      window.updateCountdown();
      if (__nc_countdownLeft <= 0) {
        clearInterval(__nc_countdownTimer);
        window.doLogout();
      }
    }, 1000);
  };

  window.updateCountdown = function () {
    var el = document.getElementById('inactivityTimer');
    if (el) el.textContent = __nc_countdownLeft;
  };

  window.hideInactivityModal = function () {
    var overlay = document.getElementById('inactivityOverlay');
    if (overlay) overlay.classList.remove('on');
    clearInterval(__nc_countdownTimer);
  };

  // ============================================================
  // SIGNUP
  // ============================================================
  window.initSignup = function () {
    var btnGoToSignup = document.getElementById('btnGoToSignup');
    var mask          = document.getElementById('signupMask');
    if (!btnGoToSignup || !mask) return;

    var cancelBtn = document.getElementById('suCancel');
    var submitBtn = document.getElementById('suSubmit');
    var goToLogin = document.getElementById('suGoToLogin');
    var nameEl    = document.getElementById('suName');
    var emailEl   = document.getElementById('suEmail');
    var passEl    = document.getElementById('suPassword');
    var confirmEl = document.getElementById('suConfirm');
    var errEl     = document.getElementById('signupError');
    var formEl    = document.getElementById('signupForm');
    var loadingEl = document.getElementById('signupLoading');

    btnGoToSignup.addEventListener('click', function () {
      [nameEl, emailEl, passEl, confirmEl].forEach(function (el) { if (el) el.value = ''; });
      if (errEl)     errEl.style.display     = 'none';
      if (formEl)    formEl.style.display    = 'block';
      if (loadingEl) loadingEl.style.display = 'none';
      mask.classList.add('on');
      setTimeout(function () { if (nameEl) nameEl.focus(); }, 100);
    });

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
      if (!name)                                return showSignupError('Please enter your full name');
      if (!email || email.indexOf('@') === -1)  return showSignupError('Please enter a valid email address');
      if (!password || password.length < 6)     return showSignupError('Password must be at least 6 characters');
      if (password !== confirm)                 return showSignupError('Passwords do not match');

      if (formEl)    formEl.style.display    = 'none';
      if (loadingEl) loadingEl.style.display = 'block';
      if (submitBtn) submitBtn.disabled = true;

      fetch(WURL() + '?action=register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name, email: email, password: password })
      })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (data.ok && data.token) {
            window.setSessionToken(data.token);
            localStorage.setItem('user_email', data.user.email);
            localStorage.setItem('user_role',  data.user.role || 'user');
            localStorage.setItem('user_name',  data.user.name || name);

            if (mask) mask.classList.remove('on');
            window.hideLoginScreen();
            showAppSafe();
            emitLogin(data.user, data.token, false);
            window.startInactivityTimer();
            tryWelcomeBonus(data.user);

            if (typeof window.playChime === 'function') window.playChime();
            if (typeof window.toast === 'function')
              window.toast('Welcome, ' + name.split(' ')[0] + '! You received 10 NC bonus.');
          } else {
            if (formEl)    formEl.style.display    = 'block';
            if (loadingEl) loadingEl.style.display = 'none';
            if (submitBtn) submitBtn.disabled = false;
            showSignupError(data.error || 'Registration failed. Please try again.');
          }
        })
        .catch(function () {
          if (formEl)    formEl.style.display    = 'block';
          if (loadingEl) loadingEl.style.display = 'none';
          if (submitBtn) submitBtn.disabled = false;
          showSignupError('Connection error. Please try again.');
        });
    }

    function showSignupError(msg) {
      if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; }
    }
  };

  // ============================================================
  // PASSWORD CONFIRM — race-safe
  // ============================================================
  window.openPasswordConfirm = function (message, callback) {
    __nc_pwCallback = callback;
    var mask  = document.getElementById('passwordConfirmMask');
    var desc  = document.getElementById('passwordConfirmDesc');
    var input = document.getElementById('passwordConfirmInput');
    var errEl = document.getElementById('passwordConfirmError');
    if (desc)  desc.textContent = message;
    if (input) input.value = '';
    if (errEl) errEl.style.display = 'none';
    if (mask)  mask.classList.add('on');
    setTimeout(function () { if (input) input.focus(); }, 100);
  };

  window.initPasswordConfirm = function () {
    var mask      = document.getElementById('passwordConfirmMask');
    var okBtn     = document.getElementById('passwordConfirmOk');
    var cancelBtn = document.getElementById('passwordConfirmCancel');
    var toggle    = document.getElementById('passwordConfirmToggle');
    var input     = document.getElementById('passwordConfirmInput');
    var errEl     = document.getElementById('passwordConfirmError');

    if (cancelBtn) cancelBtn.onclick = function () {
      if (mask) mask.classList.remove('on');
      __nc_pwCallback = null;
    };
    if (mask) mask.onclick = function (e) {
      if (e.target === mask) { mask.classList.remove('on'); __nc_pwCallback = null; }
    };
    if (toggle) toggle.onclick = function () {
      if (!input) return;
      input.type = input.type === 'password' ? 'text' : 'password';
      this.textContent = input.type === 'password' ? '👁' : '🙈';
    };
    if (input) input.onkeydown = function (e) { if (e.key === 'Enter') doPasswordConfirm(); };
    if (okBtn) okBtn.onclick = doPasswordConfirm;

    function doPasswordConfirm() {
      if (__nc_pwBusy) return;
      var password = input ? input.value : '';
      if (!password) {
        if (errEl) { errEl.textContent = 'Please enter your password'; errEl.style.display = 'block'; }
        return;
      }
      __nc_pwBusy = true;
      if (errEl) errEl.style.display = 'none';
      if (okBtn) { okBtn.disabled = true; okBtn.textContent = 'Verifying...'; }

      fetch(WURL() + '?action=verifyPassword', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: window.getSessionToken(), password: password })
      })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          __nc_pwBusy = false;
          if (okBtn) { okBtn.disabled = false; okBtn.textContent = 'Confirm'; }
          if (data.ok) {
            if (mask) mask.classList.remove('on');
            if (__nc_pwCallback) __nc_pwCallback();
            __nc_pwCallback = null;
          } else {
            if (errEl) { errEl.textContent = data.error || 'Incorrect password'; errEl.style.display = 'block'; }
          }
        })
        .catch(function () {
          __nc_pwBusy = false;
          if (okBtn) { okBtn.disabled = false; okBtn.textContent = 'Confirm'; }
          if (errEl) { errEl.textContent = 'Connection error'; errEl.style.display = 'block'; }
        });
    }
  };

  // ============================================================
  // BOOTSTRAP
  // ============================================================
  function __nc_auth_bootstrap() {
    if (typeof window.initLoginLogout     === 'function') window.initLoginLogout();
    if (typeof window.initSignup          === 'function') window.initSignup();
    if (typeof window.initPasswordConfirm === 'function') window.initPasswordConfirm();
    if (typeof window.checkSession        === 'function') window.checkSession();

    console.log('%c[NordicCrypto] 🔐 auth.js v2.1 ready',
      'color:#f472b6;font-weight:bold');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', __nc_auth_bootstrap);
  } else {
    __nc_auth_bootstrap();
  }

})();
