/* ============================================================
   NORDIC CRYPTO — AUTH.JS v1.1 (FIXED)
   ============================================================
   Логин, регистрация, сессия, inactivity.

   v1.1 FIX:
   - Не перезаписывает функции, если они уже определены
     (app.legacy.js имеет приоритет — backward compat)
   - Все локальные переменные с префиксом __nc_auth_*
   - Убран 'use strict' (конфликт с legacy var hoisting)
   - Каждая функция обёрнута в if (!window.X)
   ============================================================ */

(function () {

  // ---------- Fallback-константы ----------
  function WURL() { return window.WORKER_LOGIN_URL || 'https://nordic-deposit-checker.otis-790.workers.dev'; }
  function SESSION_MS() { return window.SESSION_TIMEOUT_MS || 5 * 60 * 1000; }
  function LOGOUT_S() { return window.LOGOUT_COUNTDOWN || 60; }

  // ---------- Локальные таймеры (уникальные имена) ----------
  var __nc_auth_sessionTimer = null;
  var __nc_auth_countdownTimer = null;
  var __nc_auth_countdownLeft = 60;
  var __nc_auth_inactivityAttached = false;
  var __nc_auth_pwConfirmCallback = null;

  // ============================================================
  // LOGIN
  // ============================================================
  if (typeof window.doLogin !== 'function') {
    window.doLogin = async function () {
      var emailEl = document.getElementById('loginEmail');
      var passEl  = document.getElementById('loginPassword');
      var errorEl = document.getElementById('loginError');
      var btnLogin = document.getElementById('btnLogin');
      var loginForm = document.getElementById('loginForm');
      var loginLoading = document.getElementById('loginLoading');
      var email = emailEl.value.trim().toLowerCase();
      var password = passEl.value;

      if (!email || !password) { window.showLoginError('Please enter email and password'); return; }

      errorEl.style.display = 'none';
      loginForm.style.display = 'none';
      loginLoading.style.display = 'block';
      btnLogin.disabled = true;

      try {
        var res = await fetch(WURL() + '?action=login', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email, password: password })
        });
        var data = await res.json();

        if (data.ok && data.token) {
          localStorage.removeItem('user_email');
          localStorage.removeItem('user_role');
          localStorage.removeItem('user_name');
          window.setSessionToken(data.token);
          localStorage.setItem('user_email', data.user.email);
          localStorage.setItem('user_role', data.user.role);
          var niceName = data.user.name || 'User';
          if (!data.user.name) {
            var fromEmail = (data.user.email || '').split('@')[0];
            niceName = fromEmail.charAt(0).toUpperCase() + fromEmail.slice(1);
          }
          localStorage.setItem('user_name', niceName);
          window.hideLoginScreen();
          if (typeof window.showApp === 'function') window.showApp();
          window.startInactivityTimer();
          if (typeof window.playChime === 'function') window.playChime();
        } else {
          loginForm.style.display = 'block';
          loginLoading.style.display = 'none';
          btnLogin.disabled = false;
          window.showLoginError(data.error || 'Login failed');
          if (typeof window.playTone === 'function') window.playTone(220, 0.2, 'sine', 0.3);
        }
      } catch (e) {
        loginForm.style.display = 'block';
        loginLoading.style.display = 'none';
        btnLogin.disabled = false;
        window.showLoginError('Connection error. Try again.');
      }
    };
  }

  if (typeof window.showLoginError !== 'function') {
    window.showLoginError = function (msg) {
      var errorEl = document.getElementById('loginError');
      if (errorEl) { errorEl.textContent = msg; errorEl.style.display = 'block'; }
    };
  }

  if (typeof window.checkSession !== 'function') {
    window.checkSession = async function () {
      var token = window.getSessionToken();
      var email = localStorage.getItem('user_email');
      if (!token) { window.showLoginScreen(); return; }

      if (email) {
        window.hideLoginScreen();
        if (typeof window.showApp === 'function') window.showApp();
        window.startInactivityTimer();
      }

      try {
        var res = await fetch(WURL() + '?action=verify', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: token })
        });
        var data = await res.json();
        if (data.ok && data.user) {
          localStorage.setItem('user_email', data.user.email);
          localStorage.setItem('user_role', data.user.role || 'user');
        }
      } catch (e) { console.warn('[session] error:', e); }
    };
  }

  if (typeof window.showLoginScreen !== 'function') {
    window.showLoginScreen = function () {
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
    };
  }

  if (typeof window.hideLoginScreen !== 'function') {
    window.hideLoginScreen = function () {
      var login = document.getElementById('loginScreen');
      if (login) login.classList.add('hidden');
    };
  }

  if (typeof window.doLogout !== 'function') {
    window.doLogout = async function () {
      var token = window.getSessionToken();
      if (token) {
        try {
          await fetch(WURL() + '?action=logout', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: token })
          });
        } catch (e) {}
      }
      window.clearSessionToken();
      localStorage.removeItem('user_email');
      localStorage.removeItem('user_role');
      localStorage.removeItem('user_name');
      clearInterval(__nc_auth_sessionTimer);
      clearInterval(__nc_auth_countdownTimer);
      window.hideInactivityModal();
      window.adminViewingEmail = null;
      window._exPricesCache = null;

      document.querySelectorAll('.mask').forEach(function (m) { m.classList.remove('on'); });
      document.querySelectorAll('.inactivity-overlay, .dep-verify-overlay, .notif-overlay, .verify-screen, .onboard, .onb-anim-stage').forEach(function (m) { m.classList.remove('on'); });

      var ap = document.getElementById('adminPanel'); if (ap) ap.classList.remove('on');
      var np = document.getElementById('notifPanel'); if (np) np.classList.remove('on');
      var abb = document.getElementById('adminBackBar'); if (abb) abb.style.display = 'none';

      document.querySelectorAll('.mask').forEach(function (m) { m.style.display = ''; });
      window.showLoginScreen();
    };
  }

  if (typeof window.initLoginLogout !== 'function') {
    window.initLoginLogout = function () {
      var toggle = document.getElementById('passToggle');
      if (toggle) toggle.onclick = function () {
        var pwd = document.getElementById('loginPassword');
        pwd.type = pwd.type === 'password' ? 'text' : 'password';
        this.textContent = pwd.type === 'password' ? '👁' : '🙈';
      };
      var btnLogin = document.getElementById('btnLogin');
      if (btnLogin) btnLogin.onclick = window.doLogin;
      var emailEl = document.getElementById('loginEmail');
      var passEl  = document.getElementById('loginPassword');
      if (emailEl) emailEl.onkeydown = function (e) { if (e.key === 'Enter') window.doLogin(); };
      if (passEl)  passEl.onkeydown  = function (e) { if (e.key === 'Enter') window.doLogin(); };
      var forgot = document.getElementById('forgotPass');
      if (forgot) forgot.onclick = function (e) { e.preventDefault(); alert('Contact support: support@nordiccrypto.com'); };
      var btnStillHere = document.getElementById('btnStillHere');
      var btnLogout    = document.getElementById('btnLogoutNow');
      if (btnStillHere) btnStillHere.onclick = function () { window.hideInactivityModal(); window.resetInactivityTimer(); };
      if (btnLogout)    btnLogout.onclick    = function () { window.doLogout(); };
    };
  }

  // ============================================================
  // INACTIVITY
  // ============================================================
  if (typeof window.startInactivityTimer !== 'function') {
    window.startInactivityTimer = function () {
      clearTimeout(__nc_auth_sessionTimer);
      __nc_auth_sessionTimer = setTimeout(window.showInactivityModal, SESSION_MS());
      if (__nc_auth_inactivityAttached) return;
      __nc_auth_inactivityAttached = true;
      ['click', 'keydown', 'scroll', 'mousemove', 'touchstart'].forEach(function (evt) {
        document.addEventListener(evt, window.resetInactivityTimer, { passive: true });
      });
    };
  }

  if (typeof window.resetInactivityTimer !== 'function') {
    window.resetInactivityTimer = function () {
      var modal = document.getElementById('inactivityOverlay');
      if (modal && modal.classList.contains('on')) return;
      clearTimeout(__nc_auth_sessionTimer);
      __nc_auth_sessionTimer = setTimeout(window.showInactivityModal, SESSION_MS());
    };
  }

  if (typeof window.showInactivityModal !== 'function') {
    window.showInactivityModal = function () {
      var overlay = document.getElementById('inactivityOverlay');
      if (!overlay) return;
      overlay.classList.add('on');
      __nc_auth_countdownLeft = LOGOUT_S();
      window.updateCountdown();
      clearInterval(__nc_auth_countdownTimer);
      __nc_auth_countdownTimer = setInterval(function () {
        __nc_auth_countdownLeft--;
        window.updateCountdown();
        if (__nc_auth_countdownLeft <= 0) { clearInterval(__nc_auth_countdownTimer); window.doLogout(); }
      }, 1000);
    };
  }

  if (typeof window.updateCountdown !== 'function') {
    window.updateCountdown = function () {
      var el = document.getElementById('inactivityTimer');
      if (el) el.textContent = __nc_auth_countdownLeft;
    };
  }

  if (typeof window.hideInactivityModal !== 'function') {
    window.hideInactivityModal = function () {
      var overlay = document.getElementById('inactivityOverlay');
      if (overlay) overlay.classList.remove('on');
      clearInterval(__nc_auth_countdownTimer);
    };
  }

  // ============================================================
  // SIGNUP
  // ============================================================
  if (typeof window.initSignup !== 'function') {
    window.initSignup = function () {
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

        if (formEl) formEl.style.display = 'none';
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
              localStorage.removeItem('user_email');
              localStorage.removeItem('user_role');
              localStorage.removeItem('user_name');
              window.setSessionToken(data.token);
              localStorage.setItem('user_email', data.user.email);
              localStorage.setItem('user_role', data.user.role || 'user');
              localStorage.setItem('user_name', data.user.name || name);
              if (mask) mask.classList.remove('on');
              window.hideLoginScreen();
              if (typeof window.showApp === 'function') window.showApp();
              window.startInactivityTimer();
              if (typeof window.playChime === 'function') window.playChime();
              if (typeof window.toast === 'function') window.toast('Account created! Welcome, ' + name.split(' ')[0]);
            } else {
              if (formEl) formEl.style.display = 'block';
              if (loadingEl) loadingEl.style.display = 'none';
              if (submitBtn) submitBtn.disabled = false;
              showSignupError(data.error || 'Registration failed');
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
        if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; }
      }
    };
  }

  // ============================================================
  // PASSWORD CONFIRM
  // ============================================================
  if (typeof window.openPasswordConfirm !== 'function') {
    window.openPasswordConfirm = function (message, callback) {
      __nc_auth_pwConfirmCallback = callback;
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
  }

  if (typeof window.initPasswordConfirm !== 'function') {
    window.initPasswordConfirm = function () {
      var mask     = document.getElementById('passwordConfirmMask');
      var okBtn    = document.getElementById('passwordConfirmOk');
      var cancelBtn = document.getElementById('passwordConfirmCancel');
      var toggle   = document.getElementById('passwordConfirmToggle');
      var input    = document.getElementById('passwordConfirmInput');
      var errEl    = document.getElementById('passwordConfirmError');

      if (cancelBtn) cancelBtn.onclick = function () {
        if (mask) mask.classList.remove('on');
        __nc_auth_pwConfirmCallback = null;
      };
      if (mask) mask.onclick = function (e) {
        if (e.target === mask) { mask.classList.remove('on'); __nc_auth_pwConfirmCallback = null; }
      };
      if (toggle) toggle.onclick = function () {
        if (!input) return;
        input.type = input.type === 'password' ? 'text' : 'password';
        this.textContent = input.type === 'password' ? '👁' : '🙈';
      };
      if (input) input.onkeydown = function (e) { if (e.key === 'Enter') doPasswordConfirm(); };
      if (okBtn) okBtn.onclick = doPasswordConfirm;

      function doPasswordConfirm() {
        var password = input ? input.value : '';
        if (!password) {
          if (errEl) { errEl.textContent = 'Please enter your password'; errEl.style.display = 'block'; }
          return;
        }
        if (errEl) errEl.style.display = 'none';
        if (okBtn) { okBtn.disabled = true; okBtn.textContent = 'Verifying...'; }

        fetch(WURL() + '?action=verifyPassword', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: window.getSessionToken(), password: password })
        })
          .then(function (r) { return r.json(); })
          .then(function (data) {
            if (okBtn) { okBtn.disabled = false; okBtn.textContent = 'Confirm'; }
            if (data.ok) {
              if (mask) mask.classList.remove('on');
              if (__nc_auth_pwConfirmCallback) __nc_auth_pwConfirmCallback();
              __nc_auth_pwConfirmCallback = null;
            } else {
              if (errEl) { errEl.textContent = data.error || 'Incorrect password'; errEl.style.display = 'block'; }
            }
          })
          .catch(function () {
            if (okBtn) { okBtn.disabled = false; okBtn.textContent = 'Confirm'; }
            if (errEl) { errEl.textContent = 'Connection error'; errEl.style.display = 'block'; }
          });
      }
    };
  }

  console.log('%c[NordicCrypto] 🔐 auth.js v1.1 loaded (passive mode — legacy has priority)',
    'color:#f472b6;font-weight:bold');

})();
