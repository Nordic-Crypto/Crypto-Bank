/* ============================================================
   NORDIC CRYPTO — CHAT-FIX.JS v1.0
   ============================================================
   Быстрый чат: optimistic UI + atomic endpoint + fast polling.
   
   Загружается ПОСЛЕ fixes.js.
   Переопределяет sendChatMsg, renderChatMessages, markChatRead.
   ============================================================ */

(function () {
  'use strict';

  var CHAT_VERSION = '1.0.0';
  var POLL_OPEN_MS = 1500;   // чат открыт
  var POLL_CLOSED_MS = 20000; // чат закрыт
  var _lastPollTs = 0;
  var _pending = [];          // сообщения в процессе отправки

  function $(id) { return document.getElementById(id); }

  function chatSound() {
    if (typeof window.playChatSound === 'function') window.playChatSound();
  }

  function escapeSafe(s) {
    if (typeof window.escapeHtml === 'function') return window.escapeHtml(s);
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ============================================================
  // 1. Override sendChatMsg — atomic endpoint + optimistic UI
  // ============================================================

  window.sendChatMsg = async function () {
    var input = $('chatInput');
    if (!input) return;
    var text = (input.value || '').trim();
    if (!text) return;

    // Ограничение длины (клиентский)
    if (text.length > 4000) {
      text = text.slice(0, 4000);
    }

    input.value = '';

    // Optimistic UI: сразу показываем сообщение
    var clientMsgId = 'c_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    if (!window.st.chat) window.st.chat = [];
    var optimistic = {
      id: 'local_' + clientMsgId,
      clientMsgId: clientMsgId,
      from: 'client',
      text: text,
      ts: Date.now(),
      read: false,
      _sending: true
    };
    window.st.chat.push(optimistic);
    renderChatMessages();

    // Скролл вниз
    var box = $('chatMessages');
    if (box) box.scrollTop = box.scrollHeight;

    // Типпинг
    sendTypingIndicator(true);

    var token = window.getSessionToken ? window.getSessionToken() : localStorage.getItem('session_token');
    var email = window.adminViewingEmail || localStorage.getItem('user_email');
    if (!token || !email) {
      optimistic._sending = false;
      optimistic._failed = true;
      optimistic._error = 'Not authenticated';
      renderChatMessages();
      return;
    }

    try {
      var res = await fetch(window.WORKER_URL + '?action=sendChatMessage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token, email: email, text: text, from: 'client', clientMsgId: clientMsgId })
      });
      var data = await res.json();

      if (data.ok && data.message) {
        // Заменяем optimistic на реальное сообщение
        var realMsg = data.message;
        for (var i = 0; i < window.st.chat.length; i++) {
          if (window.st.chat[i].clientMsgId === clientMsgId) {
            window.st.chat[i] = realMsg;
            break;
          }
        }
        renderChatMessages();
      } else {
        // Ошибка — помечаем как failed
        optimistic._sending = false;
        optimistic._failed = true;
        optimistic._error = data.error || 'Failed to send';
        renderChatMessages();
      }
    } catch (e) {
      optimistic._sending = false;
      optimistic._failed = true;
      optimistic._error = 'Connection error';
      renderChatMessages();
    } finally {
      sendTypingIndicator(false);
    }
  };

  // ============================================================
  // 2. Retry failed message
  // ============================================================

  window.__ncRetryChatMsg = async function (clientMsgId) {
    var msg = (window.st.chat || []).find(function (m) { return m.clientMsgId === clientMsgId; });
    if (!msg) return;

    msg._sending = true;
    msg._failed = false;
    renderChatMessages();

    var token = window.getSessionToken ? window.getSessionToken() : localStorage.getItem('session_token');
    var email = window.adminViewingEmail || localStorage.getItem('user_email');

    try {
      var res = await fetch(window.WORKER_URL + '?action=sendChatMessage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token, email: email, text: msg.text, from: 'client', clientMsgId: clientMsgId })
      });
      var data = await res.json();
      if (data.ok && data.message) {
        for (var i = 0; i < window.st.chat.length; i++) {
          if (window.st.chat[i].clientMsgId === clientMsgId) {
            window.st.chat[i] = data.message;
            break;
          }
        }
        renderChatMessages();
      } else {
        msg._sending = false;
        msg._failed = true;
        msg._error = data.error || 'Failed';
        renderChatMessages();
      }
    } catch (e) {
      msg._sending = false;
      msg._failed = true;
      msg._error = 'Connection error';
      renderChatMessages();
    }
  };

  // ============================================================
  // 3. Override renderChatMessages — с индикаторами отправки
  // ============================================================

  window.renderChatMessages = function () {
    var box = $('chatMessages');
    if (!box) return;
    var chat = (window.st.chat || []).slice().sort(function (a, b) { return a.ts - b.ts; });

    var html = '';
    if (!chat.length) {
      html = '<div class="chat-welcome"><div class="chat-welcome-name">Elena Bergström</div><div class="chat-welcome-text">Hi! How can I help you today?</div></div>';
    } else {
      var prevFrom = null;
      var prevTs = 0;
      chat.forEach(function (m) {
        var isClient = m.from === 'client';
        var sameAuthor = (prevFrom === m.from) && (m.ts - prevTs < 60000);
        var metaHtml = sameAuthor ? '' :
          '<div class="chat-msg-meta">' + (isClient ? 'You' : 'Elena') + ' • ' +
            new Date(m.ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) + '</div>';

        var statusIcon = '';
        if (m._sending) {
          statusIcon = ' <span class="chat-msg-status sending" title="Sending…">⏳</span>';
        } else if (m._failed) {
          statusIcon = ' <span class="chat-msg-status failed" title="' + escapeSafe(m._error || 'Failed') + '" onclick="window.__ncRetryChatMsg(\'' + m.clientMsgId + '\')" style="cursor:pointer">⚠️ retry</span>';
        } else if (isClient && m.id && !m._sending && !m._failed) {
          statusIcon = m.read ? ' <span class="chat-msg-status read" title="Read">✓✓</span>' : ' <span class="chat-msg-status sent" title="Sent">✓</span>';
        }

        var bubbleClass = 'chat-bubble';
        if (m._failed) bubbleClass += ' failed';

        html += '<div class="chat-msg ' + (isClient ? 'client' : 'admin') + (sameAuthor ? ' same-author' : '') + '">' +
          '<div><div class="' + bubbleClass + '">' + escapeSafe(m.text) + '</div>' +
          '<div class="chat-msg-meta">' + (metaHtml ? metaHtml.replace('</div>', statusIcon + '</div>') : (statusIcon ? '<div class="chat-msg-meta">' + statusIcon + '</div>' : '')) + '</div>' +
          '</div></div>';

        prevFrom = m.from;
        prevTs = m.ts;
      });
    }

    if (window._adminTyping) {
      html += '<div class="chat-msg admin chat-typing"><div><div class="chat-bubble"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span></div><div class="chat-msg-meta">Elena is typing...</div></div></div>';
    }

    box.innerHTML = html;
    box.scrollTop = box.scrollHeight;
  };

  // ============================================================
  // 4. Fast polling — getChat endpoint
  // ============================================================

  var _lastChatHash = '';

  async function pollChat() {
    var token = window.getSessionToken ? window.getSessionToken() : localStorage.getItem('session_token');
    if (!token) return;
    var email = window.adminViewingEmail || localStorage.getItem('user_email');
    if (!email) return;

    var panel = $('chatPanel');
    var chatOpen = panel && panel.style.display === 'flex';
    var now = Date.now();
    var interval = chatOpen ? POLL_OPEN_MS : POLL_CLOSED_MS;
    if (now - _lastPollTs < interval) return;
    if (!chatOpen && document.hidden) return;
    _lastPollTs = now;

    try {
      var res = await fetch(window.WORKER_URL + '?action=getChat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token, email: email })
      });
      var data = await res.json();
      if (!data.ok) return;

      var serverChat = data.chat || [];
      // Простой hash чтобы не перерисовывать если ничего не изменилось
      var hash = serverChat.length + '|' + (serverChat[serverChat.length - 1] ? serverChat[serverChat.length - 1].id : '');
      if (hash === _lastChatHash && !chatOpen) return;

      var prevLen = (window.st.chat || []).length;
      // Мержим с оптимистичными (которые ещё не подтверждены)
      var optimistic = (window.st.chat || []).filter(function (m) { return m._sending || m._failed; });
      var merged = serverChat.concat(optimistic);
      merged.sort(function (a, b) { return (a.ts || 0) - (b.ts || 0); });

      window.st.chat = merged;
      _lastChatHash = hash;

      if (data.typing && data.typing.admin === true) {
        var age = Date.now() - (data.typing.adminTs || 0);
        window._adminTyping = age < 3000;
      } else {
        window._adminTyping = false;
      }

      if (typeof window.updateChatBadge === 'function') window.updateChatBadge();

      // Если пришло новое сообщение от админа — звук + нотификация
      if (serverChat.length > prevLen) {
        var newMsgs = serverChat.slice(prevLen);
        var hasAdmin = newMsgs.some(function (m) { return m.from === 'admin'; });
        if (hasAdmin) {
          chatSound();
          if (typeof window.addNotification === 'function') {
            window.addNotification('New message from Elena', '💬');
          }
        }
      }

      if (chatOpen) renderChatMessages();
    } catch (e) {
      // silent
    }
  }

  // Запускаем polling — не блокирует UI
  setInterval(pollChat, 1000); // проверка интервала внутри pollChat
  setTimeout(pollChat, 500);

  // ============================================================
  // 5. Typing indicator (debounced)
  // ============================================================

  var _typingTimeout = null;
  var _lastTypingSent = 0;

  function sendTypingIndicator(isTyping) {
    var token = window.getSessionToken ? window.getSessionToken() : localStorage.getItem('session_token');
    if (!token) return;
    var email = window.adminViewingEmail || localStorage.getItem('user_email');
    if (!email) return;

    var now = Date.now();
    if (isTyping && now - _lastTypingSent < 2000) return; // throttle
    _lastTypingSent = now;

    fetch(window.WORKER_URL + '?action=setTyping', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token, email: email, who: 'client', typing: !!isTyping })
    }).catch(function () {});
  }

  // ============================================================
  // 6. Auto-scroll при вводе
  // ============================================================

  document.addEventListener('input', function (e) {
    if (e.target && e.target.id === 'chatInput') {
      sendTypingIndicator(true);
      clearTimeout(_typingTimeout);
      _typingTimeout = setTimeout(function () { sendTypingIndicator(false); }, 2000);
    }
  }, true);

  // ============================================================
  // 7. Styles для индикаторов
  // ============================================================

  function injectStyles() {
    if ($('ncChatStyles')) return;
    var style = document.createElement('style');
    style.id = 'ncChatStyles';
    style.textContent = `
      .chat-msg-status {
        font-size: 11px;
        opacity: 0.8;
        font-weight: 700;
      }
      .chat-msg-status.sending { color: #94a3b8; }
      .chat-msg-status.sent    { color: #94a3b8; }
      .chat-msg-status.read    { color: #47dcff; }
      .chat-msg-status.failed  { color: #ff5470; cursor: pointer; }
      .chat-msg-status.failed:hover { text-decoration: underline; }
      .chat-bubble.failed {
        background: rgba(255,84,112,0.15) !important;
        border: 1px solid rgba(255,84,112,0.4) !important;
      }
    `;
    document.head.appendChild(style);
  }

  injectStyles();

  // ============================================================
  // 8. Skip full setUserState при отправке чата
  // ============================================================

  // Патчим markChatRead — используем атомарный endpoint
  window.markChatRead = async function () {
    var token = window.getSessionToken ? window.getSessionToken() : localStorage.getItem('session_token');
    var email = window.adminViewingEmail || localStorage.getItem('user_email');
    if (!token || !email) return;

    try {
      // Оптимистично помечаем локально
      (window.st.chat || []).forEach(function (m) {
        if (m.from === 'admin' && !m.read) m.read = true;
      });
      if (typeof window.updateChatBadge === 'function') window.updateChatBadge();

      await fetch(window.WORKER_URL + '?action=markChatRead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token, email: email, from: 'admin' })
      });
    } catch (e) {}
  };

  console.log(
    '%c[NordicCrypto] 💬 chat-fix.js v' + CHAT_VERSION + ' loaded — fast chat enabled',
    'color:#00e5ff;font-weight:bold;font-size:13px'
  );

})();
