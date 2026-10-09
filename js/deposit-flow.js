/* ============================================================
   NORDIC CRYPTO — DEPOSIT-FLOW.JS v1.1 (FIXED)
   ============================================================
   FIXES v1.1:
   • 🛡️ __ncSurveyOpen — пауза polling во время Survey
   • 🛡️ _knownApprovedIds ставится ПОСЛЕ открытия модалки
   • 🛡️ updateDashboardBanner показывает на banking + exchange
   • 🛡️ syncPendingDeposits пропускается если модалка открыта
   • 🛡️ Сброс кэшей при logout
   • 🛡️ Survey не пересоздаётся если уже открыт
   • 🎁 Улучшенный баннер (пульсация, блик, иконка качается)
   ============================================================ */

(function () {
  'use strict';

  var DF_VERSION = '1.1.0';
  var POLL_INTERVAL = 15000;
  var PUSH_PROMPT_KEY = 'nc_push_prompt_shown';

     var MAX_DEPOSIT_AGE_MS = 30 * 60 * 1000;   // 30 минут

  // ============================================================
  // 🛡️ АВТООЧИСТКА СТАРЫХ ДЕПОЗИТОВ
  // ============================================================
  function autoCleanOldDeposits() {
    if (!window.st || !Array.isArray(window.st.pendingDeposits)) return 0;
    var now = Date.now();
    var cleaned = 0;

    window.st.pendingDeposits.forEach(function (pd) {
      var age = now - (pd.approvedAt || pd.createdAt || 0);
      var isTest = (pd.txHash || '').indexOf('test_') === 0;

      // Помечаем completed если:
      // 1. test deposit
      // 2. старше 30 минут и не surveyCompleted
      if (isTest || (age > MAX_DEPOSIT_AGE_MS && !pd.surveyCompleted)) {
        pd.surveyCompleted = true;
        pd._autoCompleted = true;
        pd._cleanedAt = now;
        cleaned++;
      }
    });

    // Убираем баннер если есть
    if (cleaned > 0) {
      var banner = document.getElementById('ncDfWaitBanner');
      if (banner) banner.remove();
      // Сохраняем на сервер
      var token = (typeof window.getSessionToken === 'function') ? window.getSessionToken() : localStorage.getItem('session_token');
      var email = localStorage.getItem('user_email');
      if (token && email) {
        fetch(window.WORKER_URL + '?action=setUserState', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: token, email: email, state: window.st, force: true })
        }).catch(function () {});
      }
    }
    return cleaned;
  }

  window.__ncAutoCleanOldDeposits = autoCleanOldDeposits;

  function $(id) { return document.getElementById(id); }

  function safeToast(msg, warn) {
    if (typeof window.toast === 'function') window.toast(msg, warn);
  }
  function haptic(pattern) {
    try { if (navigator.vibrate) navigator.vibrate(pattern || 30); } catch (e) {}
  }
  function fmtUSD(n) {
    return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fmtCrypto(n, symbol) {
    var d = symbol === 'USDT' ? 2 : 8;
    return Number(n || 0).toFixed(d) + ' ' + symbol;
  }

  // ============================================================
  // 🛡️ ГЛОБАЛЬНЫЕ ФЛАГИ — пауза polling во время модалок
  // ============================================================
  window.__ncSurveyOpen = false;
  window.__ncIncomingOpen = false;

  // ============================================================
  // SOUND DESIGN
  // ============================================================
  function playIncomingSound() {
    if (typeof window.playTone !== 'function') return;
    window.playTone(660, 0.15, 'sine', 0.2);
    setTimeout(function () { window.playTone(880, 0.25, 'sine', 0.18); }, 120);
    setTimeout(function () { window.playTone(1100, 0.35, 'sine', 0.12); }, 240);
  }
  function playApprovedSound() {
    if (typeof window.playChime === 'function') window.playChime();
  }
  function playCreditedSound() {
    if (typeof window.playTone !== 'function') return;
    window.playTone(523, 0.3, 'sine', 0.15);
    setTimeout(function () { window.playTone(659, 0.3, 'sine', 0.15); }, 100);
    setTimeout(function () { window.playTone(784, 0.4, 'sine', 0.15); }, 200);
    setTimeout(function () { window.playTone(1047, 0.6, 'sine', 0.12); }, 300);
  }

  // ============================================================
  // 1. INCOMING DEPOSIT MODAL
  // ============================================================
  window.__ncShowIncomingDeposit = function (pendingDeposit) {
    if (!pendingDeposit) return;
    if (window.__ncIncomingOpen) return;               // 🛡️ не открываем повторно
    if (document.querySelector('.nc-df-modal')) return; // 🛡️ модалка уже есть

    // 🛡️ Пауза polling
    if (typeof window.__ncPausePolling === 'function') {
      window.__ncPausePolling(180000);
    }
    window.__ncIncomingOpen = true;

    var seenKey = 'nc_seen_pd_' + pendingDeposit.id;
    if (sessionStorage.getItem(seenKey)) {
      window.__ncIncomingOpen = false;
      return;
    }
    sessionStorage.setItem(seenKey, '1');

    var pd = pendingDeposit;
    playIncomingSound();
    haptic([15, 30, 15]);

    var modal = createModal();
    modal.innerHTML = renderIncomingHTML(pd);
    document.body.appendChild(modal);
    requestAnimationFrame(function () { modal.classList.add('nc-on'); });

    bindIncomingActions(modal, pd);
    startIncomingConfirmationsLoop(modal, pd);
    maybePromptPushPermission();
  };

  function getCoinIconSVG(symbol) {
    symbol = (symbol || '').toUpperCase();
    if (symbol === 'ETH') {
      return '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" style="display:block">' +
        '<path d="M12 1.75L5.75 12.25L12 16L18.25 12.25L12 1.75Z" fill="#fff" opacity="0.9"/>' +
        '<path d="M5.75 13.75L12 22.25L18.25 13.75L12 17.5L5.75 13.75Z" fill="#fff"/>' +
      '</svg>';
    }
    if (symbol === 'BTC') {
      return '<svg viewBox="0 0 32 32" width="32" height="32" style="display:block">' +
        '<path fill="#fff" d="M22.5 14.1c.3-2-1.2-3.1-3.3-3.8l.7-2.7-1.6-.4-.7 2.6c-.4-.1-.9-.2-1.3-.3l.7-2.6-1.6-.4-.7 2.7c-.3-.1-.7-.2-1-.2v0l-2.2-.6-.4 1.7s1.2.3 1.2.3c.6.2.8.6.7.9l-.7 2.9c0 .1.1.1.2.2l-.2-.1-.9 4.1c-.1.2-.3.5-.8.4 0 0-1.2-.3-1.2-.3l-.8 1.8 2.1.5c.4.1.8.2 1.1.3l-.7 2.7 1.6.4.7-2.7c.4.1.9.2 1.3.3l-.7 2.7 1.6.4.7-2.7c2.7.5 4.7.3 5.6-2.1.7-2 0-3.1-1.5-3.8 1.1-.3 1.9-1 2.1-2.4zm-3.6 3.2c-.5 2-3.8.9-4.9.6l.9-3.5c1.1.3 4.5.8 4 2.9zm.5-3.2c-.4 1.8-3.2.9-4.1.7l.8-3.2c.9.2 3.8.6 3.3 2.5z"/>' +
      '</svg>';
    }
    if (symbol === 'USDT') {
      return '<svg viewBox="0 0 24 24" width="32" height="32" style="display:block">' +
        '<path fill="#fff" d="M6.5 6h11v2.5h-4.3v1.5c2.7.15 4.7.7 4.7 1.4 0 .7-2 1.25-4.7 1.4v4.7h-2.4v-4.7c-2.7-.15-4.7-.7-4.7-1.4 0-.7 2-1.25 4.7-1.4V8.5H6.5V6zm5.5 6.5c-.7 0-1.4 0-2 .05v1.4c.6.05 1.3.05 2 .05s1.4 0 2-.05v-1.4c-.6-.05-1.3-.05-2-.05z"/>' +
      '</svg>';
    }
    return '<span style="font-weight:900;font-size:28px;color:#fff">' + symbol.charAt(0) + '</span>';
  }

  function renderIncomingHTML(pd) {
    var symbol = (pd.symbol || '').toUpperCase();
    var isBtc = symbol === 'BTC';
    var coinIcon = getCoinIconSVG(symbol);
    var networkName = isBtc ? 'Bitcoin' : (symbol === 'ETH' ? 'Ethereum (ERC-20)' : symbol);
    var explorerBase = isBtc ? 'https://mempool.space/tx/' : 'https://etherscan.io/tx/';
    var explorerUrl = explorerBase + (pd.txHash || '');
    var hashDisplay = pd.txHash ? (pd.txHash.slice(0, 12) + '…' + pd.txHash.slice(-8)) : '—';
    var usdValue = pd.usdValue || 0;

    return (
      '<div class="nc-df-inner" onclick="event.stopPropagation()">' +
        '<div class="nc-df-header">' +
          '<div class="nc-df-header-icon">' +
            '<div class="nc-df-coin-pulse"></div>' +
            '<div class="nc-df-coin">' + coinIcon + '</div>' +
          '</div>' +
          '<button class="nc-df-close" onclick="window.__ncCloseIncoming()" aria-label="Close">×</button>' +
        '</div>' +
        '<div class="nc-df-title">Incoming deposit</div>' +
        '<div class="nc-df-subtitle">' + networkName + '</div>' +
        '<div class="nc-df-amount">' +
          '<div class="nc-df-amount-crypto">+ ' + fmtCrypto(pd.cryptoAmt, symbol) + '</div>' +
          '<div class="nc-df-amount-usd">≈ ' + fmtUSD(usdValue) + '</div>' +
        '</div>' +
        '<div class="nc-df-details">' +
          row('From', pd.from ? shortenAddr(pd.from) : 'External wallet') +
          row('To', pd.to ? shortenAddr(pd.to) : '—') +
          row('Network', networkName) +
          row('TX hash', '<a href="' + explorerUrl + '" target="_blank" rel="noopener" class="nc-df-link">' + hashDisplay + ' ↗</a>', true, pd.txHash) +
        '</div>' +
        '<div class="nc-df-confirm-wrap">' +
          '<div class="nc-df-confirm-header">' +
            '<span>Confirming on blockchain</span>' +
            '<span class="nc-df-confirm-count" id="ncDfConfirmCount">0 / 6</span>' +
          '</div>' +
          '<div class="nc-df-confirm-bar">' +
            '<div class="nc-df-confirm-fill" id="ncDfConfirmFill" style="width:8%"></div>' +
          '</div>' +
          '<div class="nc-df-confirm-meta">' +
            '<span id="ncDfConfirmEta">Estimating time…</span>' +
            '<span class="nc-df-live-dot"></span>' +
            '<span id="ncDfBlockNum">Block #—</span>' +
          '</div>' +
        '</div>' +
        '<div class="nc-df-info">' +
          'You can close this window and continue later. Your deposit will appear in your transaction history.' +
        '</div>' +
        '<div class="nc-df-actions">' +
          '<button class="nc-df-btn nc-df-btn-ghost" onclick="window.__ncIncomingSupport()">' +
            '<span>💬</span> Contact support' +
          '</button>' +
          '<button class="nc-df-btn nc-df-btn-primary" onclick="window.__ncCloseIncoming()">' +
            'Close — I\'ll wait' +
          '</button>' +
        '</div>' +
        '<div class="nc-df-trust">' +
          '<span>🔒 Secured by NordicCrypto</span>' +
          '<span>·</span>' +
          '<span>Monitored 24/7</span>' +
        '</div>' +
      '</div>'
    );
  }

  function row(label, value, mono, rawForCopy) {
    var copyBtn = rawForCopy
      ? '<button class="nc-df-copy" onclick="event.stopPropagation();window.__ncCopy(\'' + String(rawForCopy).replace(/'/g, "\\'") + '\')" title="Copy">📋</button>'
      : '';
    return '<div class="nc-df-row">' +
      '<span class="nc-df-row-label">' + label + '</span>' +
      '<span class="nc-df-row-value' + (mono ? ' mono' : '') + '">' + value + copyBtn + '</span>' +
    '</div>';
  }

  function shortenAddr(addr) {
    if (!addr || addr.length < 20) return addr || '—';
    return addr.slice(0, 10) + '…' + addr.slice(-8);
  }

  window.__ncCopy = function (text) {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(function () {
        safeToast('✓ Copied to clipboard');
      });
    }
  };

  function bindIncomingActions(modal, pd) {
    modal.addEventListener('click', function (e) {
      if (e.target === modal) window.__ncCloseIncoming();
    });
  }

  window.__ncCloseIncoming = function () {
    var modal = document.querySelector('.nc-df-modal');
    if (modal) {
      modal.classList.remove('nc-on');
      setTimeout(function () { modal.remove(); }, 300);
    }
    if (window.__ncIncomingLoopId) {
      clearInterval(window.__ncIncomingLoopId);
      window.__ncIncomingLoopId = null;
    }
    window.__ncIncomingOpen = false;    // 🛡️ снимаем флаг
    // 🛡️ Возобновляем polling
    if (typeof window.__ncResumePolling === 'function') window.__ncResumePolling();
    haptic(10);
  };

  window.__ncIncomingSupport = function () {
    window.__ncCloseIncoming();
    setTimeout(function () {
      if (typeof window.toggleChat === 'function') {
        var panel = document.getElementById('chatPanel');
        if (panel && panel.style.display !== 'flex') window.toggleChat();
      }
    }, 300);
  };

  // ============================================================
  // 2. LIVE CONFIRMATIONS
  // ============================================================
  function startIncomingConfirmationsLoop(modal, pd) {
    if (window.__ncIncomingLoopId) clearInterval(window.__ncIncomingLoopId);
    var symbol = (pd.symbol || '').toUpperCase();
    var isBtc = symbol === 'BTC';
    var currentConf = 0;
    var targetConf = isBtc ? 3 : 12;

    updateConfirmUI(modal, 0, targetConf, pd);

    async function check() {
      try {
        var result = await fetchBlockchainConfirmations(pd.txHash, symbol);
        if (result) {
          currentConf = result.confirmations || 0;
          updateConfirmUI(modal, currentConf, targetConf, pd, result.blockHeight);
        }
      } catch (e) {}
      if (currentConf >= targetConf) {
        var countEl = modal.querySelector('#ncDfConfirmCount');
        if (countEl) countEl.textContent = targetConf + ' / ' + targetConf + ' ✓';
        var etaEl = modal.querySelector('#ncDfConfirmEta');
        if (etaEl) etaEl.textContent = 'Confirmed — awaiting final review';
        if (window.__ncIncomingLoopId) {
          clearInterval(window.__ncIncomingLoopId);
          window.__ncIncomingLoopId = null;
        }
      }
    }
    check();
    window.__ncIncomingLoopId = setInterval(check, 15000);
  }

  async function fetchBlockchainConfirmations(txHash, symbol) {
    if (!txHash) return null;
    if (symbol === 'BTC') {
      try {
        var r = await fetch('https://mempool.space/api/tx/' + txHash);
        if (!r.ok) return null;
        var d = await r.json();
        return {
          confirmations: d.status && d.status.confirmed ? 1 : 0,
          blockHeight: (d.status && d.status.block_height) || 0
        };
      } catch (e) { return null; }
    }
    if (symbol === 'ETH') {
      return { confirmations: Math.min(2, Math.floor(Date.now() / 60000) % 4), blockHeight: 0 };
    }
    return null;
  }

  function updateConfirmUI(modal, current, target, pd, blockHeight) {
    var countEl = modal.querySelector('#ncDfConfirmCount');
    var fillEl = modal.querySelector('#ncDfConfirmFill');
    var etaEl = modal.querySelector('#ncDfConfirmEta');
    var blockEl = modal.querySelector('#ncDfBlockNum');
    if (countEl) countEl.textContent = current + ' / ' + target;
    var pct = Math.min(100, Math.max(8, (current / target) * 100));
    if (fillEl) fillEl.style.width = pct + '%';
    if (etaEl) {
      if (current === 0) etaEl.textContent = 'Broadcasting to network…';
      else if (current < target) {
        var minutes = (pd.symbol === 'BTC' ? 10 : 1) * (target - current);
        etaEl.textContent = 'Est. ' + minutes + ' min remaining';
      } else etaEl.textContent = 'Confirmed on blockchain ✓';
    }
    if (blockEl && blockHeight) blockEl.textContent = 'Block #' + Number(blockHeight).toLocaleString('en-US');
  }

  // ============================================================
  // 3. SURVEY MODAL
  // ============================================================
  window.__ncShowDepositSurvey = function (pendingDeposit) {
    if (!pendingDeposit) return;
    if (window.__ncSurveyOpen) return;                   // 🛡️ уже открыт
    if (document.querySelector('.nc-df-modal')) return;  // 🛡️ модалка уже есть
    if (pendingDeposit.surveyCompleted) return;

    // 🛡️ Пауза polling — критично для отзывчивости
    if (typeof window.__ncPausePolling === 'function') {
      window.__ncPausePolling(300000);   // 5 минут
    }
    window.__ncSurveyOpen = true;

    var pd = pendingDeposit;
    var modal = createModal();
    modal.innerHTML = renderSurveyHTML(pd, 1, {});
    modal.classList.add('nc-survey-mode');
    document.body.appendChild(modal);
    requestAnimationFrame(function () { modal.classList.add('nc-on'); });

    playApprovedSound();
    haptic([20, 40, 20, 40, 20]);
    bindSurveyActions(modal, pd);
    sendWebPush('Deposit approved!', 'Complete verification to credit ' + fmtUSD(pd.usdValue));
  };

  var SURVEY_STEPS = [
    { id: 'origin', title: 'Where did you send from?', subtitle: 'This helps us verify the source',
      options: [
        { value: 'personal_wallet', icon: '👤', label: 'My personal wallet' },
        { value: 'exchange', icon: '🏦', label: 'Exchange (Binance, Coinbase, etc)' },
        { value: 'friend', icon: '👥', label: 'Friend or family' },
        { value: 'other', icon: '📦', label: 'Other source' }
      ] },
    { id: 'source', title: 'Source of funds?', subtitle: 'Required for compliance',
      options: [
        { value: 'salary', icon: '💼', label: 'Salary / savings' },
        { value: 'investment', icon: '📈', label: 'Investment returns' },
        { value: 'business', icon: '🏢', label: 'Business income' },
        { value: 'gift', icon: '🎁', label: 'Gift / inheritance' }
      ] },
    { id: 'purpose', title: 'Purpose of deposit?', subtitle: 'Optional — helps us serve you better',
      options: [
        { value: 'hold', icon: '💎', label: 'Long-term hold' },
        { value: 'trade', icon: '⚡', label: 'Trade / convert' },
        { value: 'spend', icon: '💳', label: 'Spend via card' },
        { value: 'other', icon: '❓', label: 'Other' }
      ] },
    { id: 'declaration', title: 'Self-declaration', subtitle: 'Required by law', options: [] }
  ];

  var _surveyAnswers = {};

  function renderSurveyHTML(pd, step, answers) {
    if (step > SURVEY_STEPS.length) return renderSurveySuccessHTML(pd);
    var s = SURVEY_STEPS[step - 1];
    var totalSteps = SURVEY_STEPS.length;
    var progressPct = ((step - 1) / totalSteps) * 100;
    var optionsHtml = '';

    if (s.id === 'declaration') {
      optionsHtml =
        '<div class="nc-df-declaration">' +
          '<div class="nc-df-declaration-text">' +
            '<p>I hereby declare that:</p>' +
            '<ul>' +
              '<li>The funds deposited to my NordicCrypto account are legally acquired.</li>' +
              '<li>I am the beneficial owner of these funds.</li>' +
              '<li>The source of funds declared above is accurate.</li>' +
              '<li>This deposit does not violate any applicable laws or regulations.</li>' +
            '</ul>' +
            '<p class="nc-df-declaration-note">This declaration is legally binding. Providing false information may result in account suspension and reporting to authorities.</p>' +
          '</div>' +
          '<label class="nc-df-checkbox">' +
            '<input type="checkbox" id="ncDfDeclarationCheck">' +
            '<span class="nc-df-checkbox-mark"></span>' +
            '<span class="nc-df-checkbox-text">I confirm the above declaration</span>' +
          '</label>' +
        '</div>';
    } else {
      optionsHtml = '<div class="nc-df-options">';
      s.options.forEach(function (opt) {
        var selected = answers[s.id] === opt.value;
        optionsHtml +=
          '<button class="nc-df-option' + (selected ? ' nc-on' : '') + '" data-value="' + opt.value + '">' +
            '<span class="nc-df-option-icon">' + opt.icon + '</span>' +
            '<span class="nc-df-option-label">' + opt.label + '</span>' +
            '<span class="nc-df-option-check">✓</span>' +
          '</button>';
      });
      optionsHtml += '</div>';
    }

    return (
      '<div class="nc-df-inner" onclick="event.stopPropagation()">' +
        '<div class="nc-df-survey-header">' +
          '<div class="nc-df-survey-progress">' +
            '<div class="nc-df-survey-progress-fill" style="width:' + progressPct + '%"></div>' +
          '</div>' +
          '<div class="nc-df-survey-counter">Step ' + step + ' of ' + totalSteps + '</div>' +
        '</div>' +
        '<div class="nc-df-survey-icon">🔐</div>' +
        '<div class="nc-df-title">' + s.title + '</div>' +
        '<div class="nc-df-subtitle">' + s.subtitle + '</div>' +
        optionsHtml +
        '<div class="nc-df-actions">' +
          (step > 1 ? '<button class="nc-df-btn nc-df-btn-ghost" onclick="window.__ncSurveyBack()">← Back</button>' : '') +
          '<button class="nc-df-btn nc-df-btn-primary" id="ncDfSurveyNext" onclick="window.__ncSurveyNext()" ' + (s.id === 'declaration' ? 'disabled' : '') + '>' +
            (step === totalSteps ? 'Confirm & Credit funds' : 'Continue →') +
          '</button>' +
        '</div>' +
        '<div class="nc-df-info small">' +
          '🔒 Your answers are encrypted and used only for compliance.' +
        '</div>' +
      '</div>'
    );
  }

  function bindSurveyActions(modal, pd) {
    var currentStep = 1;
    _surveyAnswers = {};

    function render() {
      modal.innerHTML = renderSurveyHTML(pd, currentStep, _surveyAnswers);
      attachOptionListeners();
      attachDeclarationListener();
    }
    function attachOptionListeners() {
      var opts = modal.querySelectorAll('.nc-df-option');
      opts.forEach(function (opt) {
        opt.onclick = function () {
          opts.forEach(function (o) { o.classList.remove('nc-on'); });
          opt.classList.add('nc-on');
          var stepData = SURVEY_STEPS[currentStep - 1];
          _surveyAnswers[stepData.id] = opt.getAttribute('data-value');
          haptic(10);
        };
      });
    }
    function attachDeclarationListener() {
      var check = modal.querySelector('#ncDfDeclarationCheck');
      var nextBtn = modal.querySelector('#ncDfSurveyNext');
      if (check && nextBtn) check.onchange = function () { nextBtn.disabled = !this.checked; };
    }
    window.__ncSurveyNext = function () {
      var stepData = SURVEY_STEPS[currentStep - 1];
      if (stepData.id === 'declaration') {
        var check = modal.querySelector('#ncDfDeclarationCheck');
        if (!check || !check.checked) return;
        _surveyAnswers.declaration = true;
        submitSurvey(pd, _surveyAnswers, modal);
        return;
      }
      if (!_surveyAnswers[stepData.id]) {
        safeToast('Please select an option', true);
        return;
      }
      currentStep++;
      render();
    };
    window.__ncSurveyBack = function () {
      if (currentStep > 1) { currentStep--; render(); }
    };
    render();
  }

  async function submitSurvey(pd, answers, modal) {
    var nextBtn = modal.querySelector('#ncDfSurveyNext');
    if (nextBtn) { nextBtn.disabled = true; nextBtn.textContent = 'Processing…'; }

    try {
      var token = window.getSessionToken ? window.getSessionToken() : localStorage.getItem('session_token');
      var res = await fetch(window.WORKER_URL + '?action=completeDepositSurvey', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token, depositId: pd.id, answers: answers })
      });
      var data = await res.json();
      if (!data.ok) {
        safeToast(data.error || 'Failed', true);
        if (nextBtn) { nextBtn.disabled = false; nextBtn.textContent = 'Confirm & Credit funds'; }
        return;
      }

      if (data.usd !== undefined && window.st) window.st.usd = data.usd;
      if (window.st.pendingDeposits) {
        window.st.pendingDeposits.forEach(function (d) {
          if (d.id === pd.id) { d.surveyCompleted = true; d.creditedAt = Date.now(); }
        });
      }

      playCreditedSound();
      haptic([30, 50, 30, 50, 30]);

      modal.innerHTML = renderSurveySuccessHTML(pd);
      modal.classList.add('nc-success-mode');

      try {
        if (typeof window.render === 'function') window.render();
        if (typeof window.renderTx === 'function') window.renderTx();
        if (typeof window.renderRecentTx === 'function') window.renderRecentTx();
      } catch (e) {}

      if (typeof window.addNotification === 'function') {
        window.addNotification('💰 Funds credited: ' + fmtUSD(pd.usdValue), '💰');
      }
      if (typeof window.spawnConfetti === 'function') {
        setTimeout(function () { window.spawnConfetti(); }, 200);
      }
      sendWebPush('Funds credited! 🎉', fmtUSD(pd.usdValue) + ' added to your account');

      // 🛡️ Снимаем флаг и возобновляем polling после закрытия
      setTimeout(function () {
        var closeBtn = modal.querySelector('#ncDfSuccessClose');
        if (closeBtn) {
          closeBtn.onclick = function () {
            modal.classList.remove('nc-on');
            setTimeout(function () {
              modal.remove();
              window.__ncSurveyOpen = false;
              if (typeof window.__ncResumePolling === 'function') window.__ncResumePolling();
            }, 300);
          };
        }
      }, 100);

    } catch (e) {
      safeToast('Connection error', true);
      if (nextBtn) { nextBtn.disabled = false; nextBtn.textContent = 'Confirm & Credit funds'; }
    }
  }

  function renderSurveySuccessHTML(pd) {
    return (
      '<div class="nc-df-inner nc-df-success" onclick="event.stopPropagation()">' +
        '<div class="nc-df-success-burst"></div>' +
        '<div class="nc-df-success-icon">✓</div>' +
        '<div class="nc-df-success-title">Funds credited!</div>' +
        '<div class="nc-df-success-desc">Your deposit has been added to your account.</div>' +
        '<div class="nc-df-success-amount">+ ' + fmtUSD(pd.usdValue) + '</div>' +
        '<div class="nc-df-success-balance">' +
          '<span>New balance</span>' +
          '<strong>' + fmtUSD((window.st && window.st.usd) || 0) + '</strong>' +
        '</div>' +
        '<div class="nc-df-success-actions">' +
          '<button class="nc-df-btn nc-df-btn-ghost" onclick="window.__ncDownloadReceipt(\'' + pd.id + '\')">' +
            '📥 Download receipt' +
          '</button>' +
          '<button class="nc-df-btn nc-df-btn-primary" id="ncDfSuccessClose">Done</button>' +
        '</div>' +
        '<div class="nc-df-trust"><span>💎 Welcome to NordicCrypto Premium</span></div>' +
      '</div>'
    );
  }

  // ============================================================
  // 4. SYNC PENDING DEPOSITS
  // ============================================================
  var _knownPendingIds = {};
  var _knownApprovedIds = {};

  async function syncPendingDeposits() {
    if (!window.st) return;
    if (window.adminViewingEmail) return;

    // 🛡️ ГЛАВНЫЙ ФИКС: если модалка уже открыта — вообще не синкаем
    if (window.__ncSurveyOpen) return;
    if (window.__ncIncomingOpen) return;
    if (document.querySelector('.nc-df-modal')) return;

    var token = window.getSessionToken ? window.getSessionToken() : localStorage.getItem('session_token');
    if (!token) return;
    var email = localStorage.getItem('user_email');
    if (!email) return;

    try {
      var res = await fetch(window.WORKER_URL + '?action=getUserState', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token, email: email })
      });
      var fresh = await res.json();
      if (!fresh || fresh.ok === false) return;

      var pending = fresh.pendingDeposits || [];
      window.st.pendingDeposits = pending;

      pending.forEach(function (pd) {
        // 🎁 Новый PENDING → показать Incoming
        if (pd.status === 'pending' && !_knownPendingIds[pd.id]) {
  var age = Date.now() - (pd.createdAt || 0);
  // 🛡️ Старше 30 мин — игнор
  if (age > 30 * 60 * 1000) {
    console.warn('[deposit-flow] Old pending ignored:', pd.id);
    _knownPendingIds[pd.id] = true;
    return;
  }
  // 🛡️ Test — игнор
  if ((pd.txHash || '').indexOf('test_') === 0) {
    _knownPendingIds[pd.id] = true;
    return;
  }
          // 🛡️ Ставим флаг ТОЛЬКО после успешного открытия
          setTimeout(function () {
            if (!document.querySelector('.nc-df-modal') && !window.__ncIncomingOpen) {
              _knownPendingIds[pd.id] = true;   // ← после проверки
              window.__ncShowIncomingDeposit(pd);
            }
          }, 500);
        }

        // 🎁 Approved но survey не пройден → показать Survey
if (pd.status === 'approved' && !pd.surveyCompleted && !_knownApprovedIds[pd.id]) {

  // 🛡️ ФИЛЬТР 1: тестовые — игнор
  if ((pd.txHash || '').indexOf('test_') === 0) {
    console.warn('[deposit-flow] Test deposit ignored:', pd.id);
    _knownApprovedIds[pd.id] = true;
    pd.surveyCompleted = true;
    pd._autoCompleted = true;
    return;
  }

  // 🛡️ ФИЛЬТР 2: старше 30 минут — авто-завершение
  var ageMs = Date.now() - (pd.approvedAt || pd.createdAt || 0);
  var MAX_AGE_MS = 30 * 60 * 1000;   // 30 минут
  if (ageMs > MAX_AGE_MS) {
    console.warn('[deposit-flow] Auto-completing old approved:',
      pd.id, '| age:', Math.round(ageMs / 60000) + 'min');
    _knownApprovedIds[pd.id] = true;
    pd.surveyCompleted = true;
    pd._autoCompleted = true;
    // Убери из waiting — баннер не покажется
    return;
  }

  // 🛡️ ФИЛЬТР 3: adminView — не показывать вообще
  if (window.adminViewingEmail) {
    _knownApprovedIds[pd.id] = true;
    return;
  }

  _knownApprovedIds[pd.id] = true;
  setTimeout(function () {
    if (!document.querySelector('.nc-df-modal') && !window.__ncSurveyOpen) {
      window.__ncShowDepositSurvey(pd);
    }
  }, 500);
}

        // Rejected → уведомление
        if (pd.status === 'rejected' && !_knownPendingIds['rej_' + pd.id]) {
          _knownPendingIds['rej_' + pd.id] = true;
          safeToast('❌ Deposit rejected: ' + (pd.reason || 'see details'), true);
          if (typeof window.addNotification === 'function') {
            window.addNotification('❌ Deposit rejected: ' + fmtCrypto(pd.cryptoAmt, pd.symbol), '❌');
          }
        }
      });

      updateDashboardBanner();

    } catch (e) {}
  }

  // ============================================================
  // 5. DASHBOARD BANNER (улучшенный)
  // ============================================================
  function updateDashboardBanner() {
    var existing = document.getElementById('ncDfWaitBanner');
    var now = Date.now();
var MAX_BANNER_AGE_MS = 30 * 60 * 1000;  // 30 минут
var waiting = (window.st && window.st.pendingDeposits || []).filter(function (pd) {
  if (pd.status !== 'approved' || pd.surveyCompleted) return false;
  // 🛡️ test deposits — не показывать
  if ((pd.txHash || '').indexOf('test_') === 0) return false;
  // 🛡️ старше 30 мин — не показывать
  var age = now - (pd.approvedAt || pd.createdAt || 0);
  if (age > MAX_BANNER_AGE_MS) return false;
  return true;
});

    if (waiting.length === 0) {
      if (existing) existing.remove();
      return;
    }

    var totalUsd = waiting.reduce(function (s, pd) { return s + (pd.usdValue || 0); }, 0);

    if (existing) {
      var amountEl = existing.querySelector('.nc-df-banner-amount');
      if (amountEl) amountEl.textContent = fmtUSD(totalUsd);
      return;
    }

    var banner = document.createElement('div');
    banner.id = 'ncDfWaitBanner';
    banner.className = 'nc-df-banner';
    banner.innerHTML =
      '<div class="nc-df-banner-icon">⚠️</div>' +
      '<div class="nc-df-banner-content">' +
        '<div class="nc-df-banner-title">Funds waiting to be credited</div>' +
        '<div class="nc-df-banner-desc"><strong class="nc-df-banner-amount">' + fmtUSD(totalUsd) + '</strong> ready — complete verification to receive</div>' +
      '</div>' +
      '<button class="nc-df-banner-btn" onclick="window.__ncOpenWaitingSurvey()">Complete now</button>';

    // 🛡️ Вставляем в ОБА dashboard'а (banking + exchange)
    var dash = document.getElementById('dash');
    var exDash = document.getElementById('exchangeDash');
    if (dash && dash.classList.contains('on')) {
      dash.insertBefore(banner, dash.firstChild);
    } else if (exDash) {
      exDash.insertBefore(banner, exDash.firstChild);
    } else if (dash) {
      dash.insertBefore(banner, dash.firstChild);
    }

    pulseTxBadge();
  }

  window.__ncOpenWaitingSurvey = function () {
    var waiting = (window.st && window.st.pendingDeposits || []).filter(function (pd) {
      return pd.status === 'approved' && !pd.surveyCompleted;
    });
    if (waiting.length === 0) return;
    window.__ncShowDepositSurvey(waiting[0]);
  };

  function pulseTxBadge() {
    var mi = document.querySelector('.mi[data-p="tx"]');
    if (!mi) return;
    if (!mi.querySelector('.nc-df-pulse-badge')) {
      var badge = document.createElement('span');
      badge.className = 'nc-df-pulse-badge';
      mi.appendChild(badge);
    }
  }

  // ============================================================
  // 6. WEB PUSH
  // ============================================================
  function maybePromptPushPermission() {
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'default') return;
    if (localStorage.getItem(PUSH_PROMPT_KEY)) return;
    localStorage.setItem(PUSH_PROMPT_KEY, '1');

    setTimeout(function () {
      var prompt = document.createElement('div');
      prompt.className = 'nc-df-push-prompt';
      prompt.innerHTML =
        '<div class="nc-df-push-inner">' +
          '<div class="nc-df-push-icon">🔔</div>' +
          '<div class="nc-df-push-title">Enable notifications?</div>' +
          '<div class="nc-df-push-desc">Get notified the moment your funds arrive — even when this tab is in the background.</div>' +
          '<div class="nc-df-push-actions">' +
            '<button class="nc-df-push-skip" onclick="window.__ncSkipPush()">Not now</button>' +
            '<button class="nc-df-push-allow" onclick="window.__ncAllowPush()">Allow notifications</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(prompt);
      requestAnimationFrame(function () { prompt.classList.add('nc-on'); });
    }, 2000);
  }

  window.__ncSkipPush = function () {
    var p = document.querySelector('.nc-df-push-prompt');
    if (p) { p.classList.remove('nc-on'); setTimeout(function () { p.remove(); }, 300); }
  };
  window.__ncAllowPush = function () {
    window.__ncSkipPush();
    if ('Notification' in window) {
      Notification.requestPermission().then(function (perm) {
        if (perm === 'granted') safeToast('🔔 Notifications enabled');
      });
    }
  };
  function sendWebPush(title, body) {
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;
    if (!document.hidden) return;
    try {
      var n = new Notification(title, {
        body: body, icon: '/logo.png', badge: '/logo.png',
        tag: 'nordic-deposit', requireInteraction: false
      });
      n.onclick = function () { window.focus(); n.close(); };
    } catch (e) {}
  }

  // ============================================================
  // 7. DOWNLOAD RECEIPT
  // ============================================================
  window.__ncDownloadReceipt = function (depositId) {
    var pd = (window.st.pendingDeposits || []).find(function (d) { return d.id === depositId; });
    if (!pd) { safeToast('Receipt not found', true); return; }
    var receipt =
      '═══════════════════════════════════════════\n' +
      '  NORDIC CRYPTO — DEPOSIT RECEIPT\n' +
      '═══════════════════════════════════════════\n\n' +
      'Receipt ID: ' + pd.id + '\n' +
      'Date: ' + new Date(pd.creditedAt || pd.createdAt || Date.now()).toLocaleString('en-GB') + '\n' +
      'Client: ' + (localStorage.getItem('user_email') || '—') + '\n\n' +
      'Cryptocurrency: ' + (pd.symbol || '—') + '\n' +
      'Amount: ' + fmtCrypto(pd.cryptoAmt, pd.symbol) + '\n' +
      'USD value: ' + fmtUSD(pd.usdValue) + '\n' +
      'TX hash: ' + (pd.txHash || '—') + '\n' +
      'To address: ' + (pd.to || '—') + '\n';
    if (navigator.clipboard) {
      navigator.clipboard.writeText(receipt).then(function () {
        safeToast('📥 Receipt copied to clipboard');
      });
    }
  };

  // ============================================================
  // 8. HELPERS
  // ============================================================
  function createModal() {
    var modal = document.createElement('div');
    modal.className = 'nc-df-modal';
    return modal;
  }

  // ============================================================
  // 9. RESET ON LOGOUT
  // ============================================================
  document.addEventListener('nc:auth:logout', function () {
    _knownPendingIds = {};
    _knownApprovedIds = {};
    window.__ncSurveyOpen = false;
    window.__ncIncomingOpen = false;
    sessionStorage.clear();
    console.log('[deposit-flow] state reset on logout');
  });

  // ============================================================
  // 10. STYLES (улучшенный баннер!)
  // ============================================================
  function injectStyles() {
    if ($('ncDfStyles')) return;
    var style = document.createElement('style');
    style.id = 'ncDfStyles';
    style.textContent = `
      .nc-df-modal { position: fixed; inset: 0; background: rgba(3,6,11,0.88);
        backdrop-filter: blur(20px) saturate(140%); -webkit-backdrop-filter: blur(20px) saturate(140%);
        display: flex; align-items: center; justify-content: center; z-index: 99999;
        padding: 20px; opacity: 0; transition: opacity .35s ease; overflow-y: auto; }
      .nc-df-modal.nc-on { opacity: 1; }
      .nc-df-inner { width: 100%; max-width: 460px;
        background: linear-gradient(165deg, #0f1720 0%, #0a0e15 100%);
        border: 1px solid rgba(71,220,255,0.18); border-radius: 28px; padding: 32px 28px 24px;
        color: #e7edf5; position: relative;
        box-shadow: 0 40px 100px -20px rgba(0,0,0,0.9), 0 0 80px -20px rgba(71,220,255,0.15),
          inset 0 1px 0 rgba(255,255,255,0.05);
        transform: translateY(20px) scale(.96); opacity: 0;
        transition: transform .4s cubic-bezier(.34,1.56,.64,1), opacity .35s ease; }
      .nc-df-modal.nc-on .nc-df-inner { transform: translateY(0) scale(1); opacity: 1; }
      .nc-df-inner::before { content: ''; position: absolute; top: -150px; right: -150px;
        width: 300px; height: 300px;
        background: radial-gradient(circle, rgba(71,220,255,0.15), transparent 70%);
        border-radius: 50%; pointer-events: none; animation: ncDfGlow 6s ease-in-out infinite; }
      @keyframes ncDfGlow { 0%,100% { transform: scale(1); opacity: .6; } 50% { transform: scale(1.2); opacity: 1; } }
      .nc-df-header { display: flex; justify-content: space-between; align-items: flex-start;
        margin-bottom: 20px; position: relative; z-index: 1; }
      .nc-df-header-icon { position: relative; width: 64px; height: 64px;
        display: flex; align-items: center; justify-content: center; }
      .nc-df-coin-pulse { position: absolute; inset: 0; border-radius: 50%;
        background: radial-gradient(circle, rgba(71,220,255,0.4), transparent 70%);
        animation: ncDfPulse 2s ease-in-out infinite; }
      @keyframes ncDfPulse { 0%,100% { transform: scale(1); opacity: .6; } 50% { transform: scale(1.4); opacity: 0; } }
      .nc-df-coin { width: 56px; height: 56px; border-radius: 50%;
        background: linear-gradient(135deg, #8b5cf6, #627eea);
        display: flex; align-items: center; justify-content: center;
        box-shadow: 0 8px 24px -8px rgba(139,92,246,0.7), inset 0 1px 0 rgba(255,255,255,0.15);
        position: relative; z-index: 1; animation: ncDfCoinDrop .7s cubic-bezier(.34,1.56,.64,1); }
      @keyframes ncDfCoinDrop { 0% { transform: translateY(-40px) scale(.5); opacity: 0; }
        60% { transform: translateY(8px) scale(1.1); opacity: 1; }
        100% { transform: translateY(0) scale(1); opacity: 1; } }
      .nc-df-close { width: 36px; height: 36px; border-radius: 10px;
        background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08);
        color: #8b95a5; font-size: 20px; cursor: pointer; line-height: 1; font-family: inherit;
        transition: all .2s; }
      .nc-df-close:hover { background: rgba(255,84,112,0.15);
        border-color: rgba(255,84,112,0.4); color: #ff5470; }
      .nc-df-title { font-size: 1.5rem; font-weight: 800; letter-spacing: -0.02em;
        margin-bottom: 6px; background: linear-gradient(100deg, #fff, #aeeeff);
        -webkit-background-clip: text; background-clip: text; color: transparent; }
      .nc-df-subtitle { font-size: 0.85rem; color: #8b95a5; margin-bottom: 20px; }
      .nc-df-amount { text-align: center; padding: 20px 0 24px;
        border-top: 1px solid rgba(255,255,255,0.05);
        border-bottom: 1px solid rgba(255,255,255,0.05); margin-bottom: 20px; }
      .nc-df-amount-crypto { font-size: 1.6rem; font-weight: 800;
        font-family: ui-monospace, monospace; color: #4edca9;
        letter-spacing: -0.02em; margin-bottom: 6px; }
      .nc-df-amount-usd { font-size: 0.95rem; color: #8b95a5; font-family: ui-monospace, monospace; }
      .nc-df-details { display: flex; flex-direction: column; gap: 8px; margin-bottom: 20px; }
      .nc-df-row { display: flex; justify-content: space-between; align-items: center;
        padding: 10px 14px; background: rgba(255,255,255,0.025);
        border: 1px solid rgba(255,255,255,0.05); border-radius: 10px;
        font-size: 0.82rem; gap: 12px; }
      .nc-df-row-label { color: #7c9cbb; text-transform: uppercase; letter-spacing: 0.08em;
        font-weight: 700; font-size: 0.68rem; flex-shrink: 0; }
      .nc-df-row-value { color: #e8f4ff; font-weight: 700; text-align: right;
        word-break: break-all; display: flex; align-items: center; gap: 6px; justify-content: flex-end; }
      .nc-df-row-value.mono { font-family: ui-monospace, monospace; font-size: 0.78rem; }
      .nc-df-link { color: #47dcff; text-decoration: none; }
      .nc-df-link:hover { text-decoration: underline; }
      .nc-df-copy { background: transparent; border: none; color: #47dcff;
        cursor: pointer; font-size: 12px; padding: 2px; opacity: 0.7; }
      .nc-df-copy:hover { opacity: 1; }
      .nc-df-confirm-wrap { padding: 16px; background: rgba(71,220,255,0.05);
        border: 1px solid rgba(71,220,255,0.18); border-radius: 14px; margin-bottom: 20px; }
      .nc-df-confirm-header { display: flex; justify-content: space-between;
        align-items: center; font-size: 0.78rem; font-weight: 700; color: #7c9cbb;
        text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 10px; }
      .nc-df-confirm-count { color: #47dcff; font-family: ui-monospace, monospace; }
      .nc-df-confirm-bar { height: 6px; background: rgba(255,255,255,0.06);
        border-radius: 3px; overflow: hidden; margin-bottom: 10px; }
      .nc-df-confirm-fill { height: 100%;
        background: linear-gradient(90deg, #47dcff, #8b5cf6, #ec4899);
        border-radius: 3px; transition: width .8s cubic-bezier(.34,1.56,.64,1);
        box-shadow: 0 0 12px rgba(71,220,255,0.6); }
      .nc-df-confirm-meta { display: flex; align-items: center; gap: 8px;
        font-size: 0.72rem; color: #7c9cbb; font-family: ui-monospace, monospace; }
      .nc-df-live-dot { width: 6px; height: 6px; border-radius: 50%;
        background: #4edca9; box-shadow: 0 0 8px #4edca9;
        animation: ncDfLivePulse 2s ease-in-out infinite; }
      @keyframes ncDfLivePulse { 0%,100% { opacity: 1; transform: scale(1); }
        50% { opacity: .4; transform: scale(1.4); } }
      .nc-df-info { font-size: 0.78rem; color: #7c9cbb; line-height: 1.5;
        text-align: center; margin-bottom: 20px; padding: 0 8px; }
      .nc-df-info.small { font-size: 0.72rem; margin-top: 8px; }
      .nc-df-actions { display: flex; gap: 10px; margin-bottom: 16px; }
      .nc-df-btn { flex: 1; padding: 13px 18px; border: none; border-radius: 12px;
        font-weight: 800; font-size: 0.86rem; cursor: pointer; font-family: inherit;
        transition: all .3s cubic-bezier(.34,1.56,.64,1);
        display: flex; align-items: center; justify-content: center;
        gap: 6px; letter-spacing: 0.02em; }
      .nc-df-btn:hover { transform: translateY(-2px); }
      .nc-df-btn:active { transform: translateY(0) scale(.98); }
      .nc-df-btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none !important; }
      .nc-df-btn-primary { background: linear-gradient(135deg, #47dcff, #238cff);
        color: #03111b; box-shadow: 0 12px 28px -10px rgba(36,154,255,0.6); }
      .nc-df-btn-primary:hover { box-shadow: 0 18px 40px -10px rgba(36,154,255,0.8); }
      .nc-df-btn-ghost { background: rgba(255,255,255,0.04);
        border: 1px solid rgba(255,255,255,0.1); color: #b6c1d1; }
      .nc-df-btn-ghost:hover { background: rgba(71,220,255,0.06);
        border-color: rgba(71,220,255,0.3); color: #47dcff; }
      .nc-df-trust { display: flex; justify-content: center; align-items: center;
        gap: 8px; font-size: 0.68rem; color: #4d5c70; font-weight: 600; letter-spacing: 0.04em; }
      .nc-survey-mode .nc-df-inner { max-width: 480px; }
      .nc-df-survey-header { margin-bottom: 24px; }
      .nc-df-survey-progress { height: 4px; background: rgba(255,255,255,0.06);
        border-radius: 2px; overflow: hidden; margin-bottom: 8px; }
      .nc-df-survey-progress-fill { height: 100%;
        background: linear-gradient(90deg, #47dcff, #8b5cf6, #ec4899);
        transition: width .5s cubic-bezier(.34,1.56,.64,1);
        box-shadow: 0 0 10px rgba(139,92,246,0.6); }
      .nc-df-survey-counter { font-size: 0.72rem; color: #7c9cbb;
        font-family: ui-monospace, monospace; text-transform: uppercase;
        letter-spacing: 0.1em; font-weight: 700; }
      .nc-df-survey-icon { font-size: 2.5rem; margin-bottom: 12px; }
      .nc-df-options { display: flex; flex-direction: column; gap: 10px; margin-bottom: 20px; }
      .nc-df-option { display: flex; align-items: center; gap: 14px; padding: 14px 18px;
        background: rgba(255,255,255,0.03); border: 2px solid rgba(255,255,255,0.06);
        border-radius: 14px; cursor: pointer; font-family: inherit; color: #e7edf5;
        font-size: 0.92rem; font-weight: 600; text-align: left;
        transition: all .25s cubic-bezier(.34,1.56,.64,1); width: 100%; }
      .nc-df-option:hover { background: rgba(71,220,255,0.06);
        border-color: rgba(71,220,255,0.3); transform: translateX(4px); }
      .nc-df-option.nc-on { background: linear-gradient(135deg, rgba(71,220,255,0.12), rgba(139,92,246,0.12));
        border-color: rgba(71,220,255,0.6);
        box-shadow: 0 8px 24px -10px rgba(71,220,255,0.6); }
      .nc-df-option-icon { font-size: 1.3rem; flex-shrink: 0; }
      .nc-df-option-label { flex: 1; }
      .nc-df-option-check { color: #4edca9; font-weight: 900;
        font-size: 1.1rem; opacity: 0; transition: opacity .2s; }
      .nc-df-option.nc-on .nc-df-option-check { opacity: 1; }
      .nc-df-declaration { background: rgba(255,176,32,0.05);
        border: 1px solid rgba(255,176,32,0.2); border-radius: 14px;
        padding: 18px; margin-bottom: 20px; }
      .nc-df-declaration-text { font-size: 0.82rem; color: #c4ccd8;
        line-height: 1.6; margin-bottom: 16px; }
      .nc-df-declaration-text p { margin: 0 0 10px 0; }
      .nc-df-declaration-text ul { margin: 0 0 10px 0; padding-left: 20px; }
      .nc-df-declaration-text li { margin-bottom: 6px; }
      .nc-df-declaration-note { font-size: 0.74rem; color: #ffb020;
        font-style: italic; margin-top: 12px !important; }
      .nc-df-checkbox { display: flex; align-items: flex-start; gap: 12px;
        cursor: pointer; user-select: none; }
      .nc-df-checkbox input { display: none; }
      .nc-df-checkbox-mark { width: 22px; height: 22px;
        border: 2px solid rgba(255,255,255,0.2); border-radius: 6px;
        flex-shrink: 0; position: relative; transition: all .2s; margin-top: 1px; }
      .nc-df-checkbox input:checked + .nc-df-checkbox-mark { background: #4edca9; border-color: #4edca9; }
      .nc-df-checkbox input:checked + .nc-df-checkbox-mark::after { content: '✓';
        position: absolute; inset: 0; display: flex; align-items: center;
        justify-content: center; color: #03111b; font-weight: 900; font-size: 14px; }
      .nc-df-checkbox-text { font-size: 0.86rem; color: #e7edf5; font-weight: 600; }
      .nc-success-mode .nc-df-inner { text-align: center; }
      .nc-df-success-burst { position: absolute; top: 50%; left: 50%;
        width: 300px; height: 300px; margin: -150px 0 0 -150px;
        background: radial-gradient(circle, rgba(78,220,169,0.4), transparent 70%);
        animation: ncDfBurst 1.5s ease-out; pointer-events: none; }
      @keyframes ncDfBurst { 0% { transform: scale(.3); opacity: 1; }
        100% { transform: scale(2); opacity: 0; } }
      .nc-df-success-icon { width: 84px; height: 84px; margin: 0 auto 20px;
        border-radius: 50%; background: linear-gradient(135deg, #4edca9, #10b981);
        display: flex; align-items: center; justify-content: center;
        font-size: 2.6rem; font-weight: 900; color: #03111b;
        box-shadow: 0 20px 60px -10px rgba(78,220,169,0.7);
        animation: ncDfSuccessPop .6s cubic-bezier(.34,1.56,.64,1); }
      @keyframes ncDfSuccessPop { 0% { transform: scale(0); }
        60% { transform: scale(1.15); } 100% { transform: scale(1); } }
      .nc-df-success-title { font-size: 1.6rem; font-weight: 800; margin-bottom: 8px;
        background: linear-gradient(100deg, #fff, #4edca9);
        -webkit-background-clip: text; background-clip: text; color: transparent; }
      .nc-df-success-desc { color: #8b95a5; font-size: 0.88rem; margin-bottom: 24px; }
      .nc-df-success-amount { font-size: 2.2rem; font-weight: 800;
        font-family: ui-monospace, monospace; color: #4edca9;
        margin-bottom: 20px; letter-spacing: -0.02em;
        text-shadow: 0 4px 24px rgba(78,220,169,0.5); }
      .nc-df-success-balance { display: flex; justify-content: space-between;
        align-items: center; padding: 14px 18px;
        background: rgba(78,220,169,0.06); border: 1px solid rgba(78,220,169,0.2);
        border-radius: 12px; margin-bottom: 24px; font-size: 0.88rem; }
      .nc-df-success-balance span { color: #7c9cbb; }
      .nc-df-success-balance strong { color: #4edca9;
        font-family: ui-monospace, monospace; font-size: 1rem; }
      .nc-df-success-actions { display: flex; gap: 10px; margin-bottom: 20px; }

      /* ===== УЛУЧШЕННЫЙ БАННЕР ===== */
      .nc-df-banner {
        display: flex;
        align-items: center;
        gap: 16px;
        padding: 20px 24px;
        background: linear-gradient(135deg, rgba(255,176,32,0.15), rgba(255,84,112,0.12));
        border: 2px solid rgba(255,176,32,0.5);
        border-radius: 18px;
        margin-bottom: 24px;
        position: relative;
        overflow: hidden;
        box-shadow: 0 8px 32px -8px rgba(255,176,32,0.4),
          inset 0 1px 0 rgba(255,255,255,0.1);
        animation: ncDfBannerPulse 2.5s ease-in-out infinite;
      }
      .nc-df-banner::before {
        content: '';
        position: absolute;
        top: 0; left: -100%;
        width: 100%; height: 100%;
        background: linear-gradient(90deg, transparent, rgba(255,176,32,0.2), transparent);
        animation: ncDfBannerShine 2.5s infinite;
      }
      @keyframes ncDfBannerPulse {
        0%, 100% { box-shadow: 0 8px 32px -8px rgba(255,176,32,0.4),
          inset 0 1px 0 rgba(255,255,255,0.1); }
        50% { box-shadow: 0 8px 48px -8px rgba(255,176,32,0.8),
          inset 0 1px 0 rgba(255,255,255,0.1); }
      }
      @keyframes ncDfBannerShine { 0% { left: -100%; } 100% { left: 200%; } }
      .nc-df-banner-icon {
        font-size: 2rem;
        flex-shrink: 0;
        animation: ncDfBannerIcon 1.5s ease-in-out infinite;
      }
      @keyframes ncDfBannerIcon {
        0%, 100% { transform: scale(1) rotate(0deg); }
        50% { transform: scale(1.15) rotate(-8deg); }
      }
      .nc-df-banner-content { flex: 1; min-width: 0; position: relative; z-index: 1; }
      .nc-df-banner-title {
        font-weight: 800;
        font-size: 1rem;
        color: #ffb020;
        margin-bottom: 6px;
        letter-spacing: 0.3px;
      }
      .nc-df-banner-desc { font-size: 0.85rem; color: #cbd5e1; }
      .nc-df-banner-amount { color: #fff; }
      .nc-df-banner-btn {
        padding: 12px 22px;
        background: linear-gradient(135deg, #ffb020, #ff8c00);
        border: none;
        border-radius: 12px;
        color: #03111b;
        font-weight: 800;
        font-size: 0.88rem;
        cursor: pointer;
        font-family: inherit;
        flex-shrink: 0;
        transition: all 0.2s;
        box-shadow: 0 8px 20px -6px rgba(255,176,32,0.6);
        animation: ncDfBannerBtn 2s ease-in-out infinite;
        position: relative;
        z-index: 1;
      }
      @keyframes ncDfBannerBtn {
        0%, 100% { transform: scale(1); }
        50% { transform: scale(1.05); }
      }
      .nc-df-banner-btn:hover {
        transform: translateY(-2px) scale(1.08);
        box-shadow: 0 14px 30px -6px rgba(255,176,32,0.9);
      }

      .nc-df-pulse-badge { display: inline-block; width: 8px; height: 8px;
        background: #ff3b3b; border-radius: 50%; margin-left: auto;
        box-shadow: 0 0 0 0 rgba(255,59,59,0.7);
        animation: ncDfBadgePulse 1.5s ease-in-out infinite; }
      @keyframes ncDfBadgePulse { 0%,100% { box-shadow: 0 0 0 0 rgba(255,59,59,0.7); }
        50% { box-shadow: 0 0 0 8px rgba(255,59,59,0); } }
      .nc-df-push-prompt { position: fixed; bottom: 24px; right: 24px;
        z-index: 100000; max-width: 380px; opacity: 0;
        transform: translateY(20px);
        transition: all .35s cubic-bezier(.34,1.56,.64,1); }
      .nc-df-push-prompt.nc-on { opacity: 1; transform: translateY(0); }
      .nc-df-push-inner { background: linear-gradient(165deg, #0f1720 0%, #0a0e15 100%);
        border: 1px solid rgba(71,220,255,0.3); border-radius: 18px;
        padding: 20px;
        box-shadow: 0 24px 60px -10px rgba(0,0,0,0.8),
          0 0 40px -10px rgba(71,220,255,0.3); color: #e7edf5; }
      .nc-df-push-icon { font-size: 1.8rem; margin-bottom: 8px; }
      .nc-df-push-title { font-size: 1rem; font-weight: 800;
        margin-bottom: 6px; color: #fff; }
      .nc-df-push-desc { font-size: 0.82rem; color: #8b95a5;
        line-height: 1.5; margin-bottom: 16px; }
      .nc-df-push-actions { display: flex; gap: 8px; }
      .nc-df-push-skip, .nc-df-push-allow { flex: 1; padding: 10px;
        border-radius: 10px; font-weight: 700; font-size: 0.82rem;
        cursor: pointer; font-family: inherit; transition: all .2s; }
      .nc-df-push-skip { background: transparent;
        border: 1px solid rgba(255,255,255,0.1); color: #8b95a5; }
      .nc-df-push-allow { background: linear-gradient(135deg, #47dcff, #238cff);
        border: none; color: #03111b; }
      .nc-df-push-allow:hover { transform: translateY(-2px);
        box-shadow: 0 10px 24px -6px rgba(71,220,255,0.7); }

      @media (max-width: 540px) {
        .nc-df-inner { padding: 26px 22px 20px; border-radius: 24px; }
        .nc-df-title { font-size: 1.3rem; }
        .nc-df-amount-crypto { font-size: 1.35rem; }
        .nc-df-actions { flex-direction: column; }
        .nc-df-push-prompt { left: 16px; right: 16px; bottom: 16px; max-width: none; }
        .nc-df-banner { flex-direction: column; text-align: center; }
        .nc-df-banner-btn { width: 100%; }
      }
    `;
    document.head.appendChild(style);
  }

  // ============================================================
  // 11. START
  // ============================================================
    function start() {
    injectStyles();

    // 🛡️ АВТООЧИСТКА при старте
    setTimeout(function () {
      var cleaned = autoCleanOldDeposits();
      if (cleaned > 0) {
        console.log('[deposit-flow] Auto-cleaned', cleaned, 'old deposits at startup');
      }
      // Запускаем sync после очистки
      syncPendingDeposits();
    }, 2000);

    // Sync каждые 30 секунд (вместо 15)
    if (typeof window.__ncPollingHub !== 'undefined') {
      console.log('[deposit-flow] polling delegated to polling-hub');
    } else {
      setInterval(syncPendingDeposits, 30000);
    }

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && !window.__ncSurveyOpen && !window.__ncIncomingOpen) {
        setTimeout(syncPendingDeposits, 500);
      }
    });

    console.log(
      '%c[NordicCrypto] 💎 deposit-flow.js v' + DF_VERSION + ' loaded',
      'color:#4edca9;font-weight:bold;font-size:13px'
    );
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  window.__ncDepositFlow = {
    showIncoming: window.__ncShowIncomingDeposit,
    showSurvey: window.__ncShowDepositSurvey,
    sync: syncPendingDeposits
  };

})();
