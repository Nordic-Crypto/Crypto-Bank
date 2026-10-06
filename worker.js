// ============================================================
// NordicCrypto Worker — v2.2 — FULL (chat-wipe-fix)
// ============================================================

export default {
  async fetch(request, env) {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Content-Type': 'application/json'
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    const url = new URL(request.url);
    const action = url.searchParams.get('action');

    // ============ ??? ?????? ============
    async function sha256(text) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    // ============ ??? ???????????? ============
    async function getUsers() {
      const users = await env.NORDIC_KV.get('users', 'json');
      return users || {};
    }
    async function saveUsers(users) {
      await env.NORDIC_KV.put('users', JSON.stringify(users));
    }

    // ============ ????????????? ADMIN ============
    async function ensureAdmin() {
      const users = await getUsers();
      if (!users['admin@nordiccrypto.com']) {
        users['admin@nordiccrypto.com'] = {
          email: 'admin@nordiccrypto.com',
          name: 'Admin',
          role: 'admin',
          passwordHash: await sha256('Admin2026!'),
          createdAt: Date.now()
        };
        await saveUsers(users);
      }
      return users;
    }

    // ============ ????????? ???? ============
    function genCode() {
      return Math.floor(100000 + Math.random() * 900000).toString();
    }

    // ============ ???????? EMAIL ============
    async function sendEmail(to, subject, htmlBody) {
      try {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + env.RESEND_API_KEY,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            from: 'NordicCrypto <onboarding@resend.dev>',
            to: [to],
            subject: subject,
            html: htmlBody
          })
        });
        const data = await res.json();
        return { ok: res.ok, data: data };
      } catch (e) {
        return { ok: false, error: String(e) };
      }
    }

    // ============ ??????: ??????? ??? ?????? ???????????? ============
    async function killUserSessions(email) {
      try {
        const list = await env.NORDIC_KV.list({ prefix: 'session_' });
        for (const key of list.keys) {
          const sess = await env.NORDIC_KV.get(key.name, 'json');
          if (sess && sess.email === email) {
            await env.NORDIC_KV.delete(key.name);
          }
        }
      } catch (e) {}
    }

    // ============ SEND CODE ============
    if (action === 'sendCode' && request.method === 'POST') {
      try {
        const body = await request.json();
        const { email } = body;
        if (!email || !email.includes('@')) {
          return new Response(JSON.stringify({ ok: false, error: 'Invalid email' }), { headers: cors });
        }
        const users = await ensureAdmin();
        if (users[email.toLowerCase()]) {
          return new Response(JSON.stringify({ ok: false, error: 'Email already registered' }), { headers: cors });
        }
        const code = genCode();
        await env.NORDIC_KV.put('verify_' + email.toLowerCase(), JSON.stringify({
          code: code,
          email: email.toLowerCase(),
          createdAt: Date.now(),
          expiresAt: Date.now() + 15 * 60 * 1000
        }), { expirationTtl: 900 });
        const html = `
          <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;padding:30px;background:#0a0e15;color:#eef4ff;border-radius:16px">
            <h1 style="color:#00d4ff;margin-bottom:20px">NordicCrypto</h1>
            <p style="font-size:16px;line-height:1.6">Your verification code:</p>
            <div style="font-size:36px;font-weight:900;letter-spacing:8px;color:#00d4ff;text-align:center;padding:24px;background:rgba(0,212,255,.08);border-radius:12px;margin:20px 0">${code}</div>
            <p style="color:#7d8ba3;font-size:14px">This code is valid for 15 minutes.</p>
          </div>
        `;
        const result = await sendEmail(email, 'Your NordicCrypto verification code', html);
        if (!result.ok) {
          return new Response(JSON.stringify({ ok: false, error: 'Failed to send email' }), { headers: cors });
        }
        return new Response(JSON.stringify({ ok: true, message: 'Code sent' }), { headers: cors });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: String(e) }), { headers: cors });
      }
    }

    // ============ REGISTER ============
    if (action === 'register' && request.method === 'POST') {
      try {
        const body = await request.json();
        const { email, password, name } = body;
        if (!email || !password) {
          return new Response(JSON.stringify({ ok: false, error: 'Email and password required' }), { headers: cors });
        }
        if (password.length < 6) {
          return new Response(JSON.stringify({ ok: false, error: 'Password must be at least 6 characters' }), { headers: cors });
        }
        const emailLower = email.toLowerCase();
        const users = await ensureAdmin();
        if (users[emailLower]) {
          return new Response(JSON.stringify({ ok: false, error: 'Email already registered' }), { headers: cors });
        }
        users[emailLower] = {
          email: emailLower,
          name: name || 'User',
          role: 'user',
          passwordHash: await sha256(password),
          createdAt: Date.now(),
          verified: true
        };
        await saveUsers(users);

        const emptyState = {
          usd: 0, btc: 0, eth: 0,
          btcP: 68000, ethP: 3200, eurR: 0.92, sekR: 10.45,
          currency: 'USD',
          txs: [], order: null, card: null, notifications: [],
          cryptoAddress: null, iban: null, user: null,
          chat: [], ticket: null, typing: { client: false, admin: false },
          depositVerifications: []
        };
        await env.NORDIC_KV.put('user_state_' + emailLower, JSON.stringify(emptyState));

        const token = crypto.randomUUID() + '-' + crypto.randomUUID();
        const session = {
          token: token,
          email: emailLower,
          role: 'user',
          createdAt: Date.now(),
          expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000
        };
        await env.NORDIC_KV.put('session_' + token, JSON.stringify(session), { expirationTtl: 7 * 24 * 60 * 60 });

        return new Response(JSON.stringify({
          ok: true,
          token: token,
          user: { email: emailLower, name: users[emailLower].name, role: 'user' }
        }), { headers: cors });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: String(e) }), { headers: cors });
      }
    }

    // ============ LOGIN ============
    if (action === 'login' && request.method === 'POST') {
      try {
        const body = await request.json();
        const { email, password } = body;
        if (!email || !password) {
          return new Response(JSON.stringify({ ok: false, error: 'Email and password required' }), { headers: cors });
        }
        await ensureAdmin();
        const users = await getUsers();
        const user = users[email.toLowerCase()];
        if (!user) {
          return new Response(JSON.stringify({ ok: false, error: 'User not found' }), { headers: cors });
        }
        const hash = await sha256(password);
        if (hash !== user.passwordHash) {
          return new Response(JSON.stringify({ ok: false, error: 'Invalid password' }), { headers: cors });
        }
        const token = crypto.randomUUID() + '-' + crypto.randomUUID();
        const session = {
          token: token,
          email: user.email,
          role: user.role,
          createdAt: Date.now(),
          expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000
        };
        await env.NORDIC_KV.put('session_' + token, JSON.stringify(session), { expirationTtl: 7 * 24 * 60 * 60 });
        return new Response(JSON.stringify({
          ok: true,
          token: token,
          user: { email: user.email, name: user.name, role: user.role }
        }), { headers: cors });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: String(e) }), { headers: cors });
      }
    }

    // ============ VERIFY TOKEN ============
    if (action === 'verify' && request.method === 'POST') {
      try {
        const body = await request.json();
        const { token } = body;
        if (!token) return new Response(JSON.stringify({ ok: false }), { headers: cors });
        const session = await env.NORDIC_KV.get('session_' + token, 'json');
        if (!session) return new Response(JSON.stringify({ ok: false, error: 'Session not found' }), { headers: cors });
        if (session.expiresAt < Date.now()) {
          await env.NORDIC_KV.delete('session_' + token);
          return new Response(JSON.stringify({ ok: false, error: 'Session expired' }), { headers: cors });
        }
        return new Response(JSON.stringify({ ok: true, user: { email: session.email, role: session.role } }), { headers: cors });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: String(e) }), { headers: cors });
      }
    }
    // ============ SET TYPING ============
    if (action === 'setTyping' && request.method === 'POST') {
      try {
        const body = await request.json();
        const { token, email, who, typing } = body;
        const session = await env.NORDIC_KV.get('session_' + token, 'json');
        if (!session) {
          return new Response(JSON.stringify({ ok: false, error: 'Not authenticated' }), { headers: cors });
        }
        const targetEmail = (email || session.email).toLowerCase().trim();
        const state = await env.NORDIC_KV.get('user_state_' + targetEmail, 'json') || {};
        
        if (!state.typing) state.typing = {};
        if (who === 'client') {
          state.typing.client = !!typing;
          state.typing.clientTs = Date.now();
        } else if (who === 'admin') {
          state.typing.admin = !!typing;
          state.typing.adminTs = Date.now();
        }
        
        await env.NORDIC_KV.put('user_state_' + targetEmail, JSON.stringify(state));
        return new Response(JSON.stringify({ ok: true }), { headers: cors });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: String(e) }), { headers: cors });
      }
    }

    // ============ LOGOUT ============
    if (action === 'logout' && request.method === 'POST') {
      try {
        const body = await request.json();
        const { token } = body;
        if (token) await env.NORDIC_KV.delete('session_' + token);
        return new Response(JSON.stringify({ ok: true }), { headers: cors });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: String(e) }), { headers: cors });
      }
    }

    // ============ CHANGE PASSWORD ============
    if (action === 'changePassword' && request.method === 'POST') {
      try {
        const body = await request.json();
        const { token, oldPassword, newPassword } = body;
        const session = await env.NORDIC_KV.get('session_' + token, 'json');
        if (!session) return new Response(JSON.stringify({ ok: false, error: 'Not authenticated' }), { headers: cors });
        const users = await getUsers();
        const user = users[session.email];
        if (!user) return new Response(JSON.stringify({ ok: false, error: 'User not found' }), { headers: cors });
        const oldHash = await sha256(oldPassword);
        if (oldHash !== user.passwordHash) {
          return new Response(JSON.stringify({ ok: false, error: 'Old password is incorrect' }), { headers: cors });
        }
        user.passwordHash = await sha256(newPassword);
        await saveUsers(users);
        return new Response(JSON.stringify({ ok: true }), { headers: cors });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: String(e) }), { headers: cors });
      }
    }

    // ============ VERIFY PASSWORD ============
    if (action === 'verifyPassword' && request.method === 'POST') {
      try {
        const body = await request.json();
        const { token, password } = body;
        const session = await env.NORDIC_KV.get('session_' + token, 'json');
        if (!session) return new Response(JSON.stringify({ ok: false, error: 'Not authenticated' }), { headers: cors });
        const users = await getUsers();
        const user = users[session.email];
        if (!user) return new Response(JSON.stringify({ ok: false, error: 'User not found' }), { headers: cors });
        const hash = await sha256(password);
        if (hash !== user.passwordHash) {
          return new Response(JSON.stringify({ ok: false, error: 'Incorrect password' }), { headers: cors });
        }
        return new Response(JSON.stringify({ ok: true }), { headers: cors });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: String(e) }), { headers: cors });
      }
    }

    // ============ GET USER STATE ============
    if (action === 'getUserState' && request.method === 'POST') {
      try {
        const body = await request.json();
        const { token, email } = body;
        const session = await env.NORDIC_KV.get('session_' + token, 'json');
        if (!session) return new Response(JSON.stringify({ ok: false, error: 'Not authenticated' }), { headers: cors });
        const targetEmail = (email || session.email).toLowerCase().trim();
        if (session.role !== 'admin' && targetEmail !== session.email) {
          return new Response(JSON.stringify({ ok: false, error: 'Access denied' }), { headers: cors });
        }
        let state = await env.NORDIC_KV.get('user_state_' + targetEmail, 'json');
        if (!state) {
          state = {
            usd: 0, btc: 0, eth: 0,
            btcP: 68000, ethP: 3200, eurR: 0.92, sekR: 10.45,
            currency: 'USD',
            txs: [], order: null, card: null, notifications: [],
            cryptoAddress: null, iban: null, user: null,
            chat: [], ticket: null, typing: { client: false, admin: false },
            depositVerifications: []
          };
          await env.NORDIC_KV.put('user_state_' + targetEmail, JSON.stringify(state));
        }
        return new Response(JSON.stringify(state), { headers: cors });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: String(e) }), { headers: cors });
      }
    }

    // ============ SET USER STATE (? ??????? ?? ?????????) ============
    if (action === 'setUserState' && request.method === 'POST') {
      try {
        const body = await request.json();
        const { token, state, email, force, wipeChat } = body;
        const session = await env.NORDIC_KV.get('session_' + token, 'json');
        if (!session) {
          return new Response(JSON.stringify({ ok: false, error: 'Not authenticated' }), { headers: cors });
        }

        let targetEmail = session.email;
        if (session.role === 'admin' && email) {
          targetEmail = email.toLowerCase().trim();
        } else if (session.role === 'admin' && !email) {
          return new Response(JSON.stringify({ ok: true, skipped: 'admin without email' }), { headers: cors });
        }

        const serverState = await env.NORDIC_KV.get('user_state_' + targetEmail, 'json') || {};
        const serverUsd = Number(serverState.usd) || 0;
        const clientUsd = Number(state.usd) || 0;

        // ?????? 1: ?????? ?? ?????? ?????????? (??? force)
        if (!force && serverUsd > clientUsd + 0.01) {
          state.usd = serverUsd;
        }

        // ? ?????? 2: ???? wipeChat — ??????? ???, ticket, typing ?????????
        if (wipeChat) {
          state.chat = [];
          state.ticket = null;
          state.typing = {};
        } else {
          // ??????? merge
          const serverChat = serverState.chat || [];
          const clientChat = state.chat || [];
          const merged = {};
          serverChat.forEach(m => { if (m && m.id) merged[m.id] = m; });
          clientChat.forEach(m => { if (m && m.id) merged[m.id] = m; });
          state.chat = Object.values(merged).sort((a, b) => (a.ts || 0) - (b.ts || 0));

          // ticket: ???? ? ??????? null, ? ? ??????? ???? — ????? ?????????
          if (state.ticket === undefined) state.ticket = serverState.ticket || null;
        }

        // ?????? 3: typing — ????? ?????? (?????? ???? ?? wipeChat)
        if (!wipeChat) {
          const st = serverState.typing || {};
          const ct = state.typing || {};
          state.typing = {
            client: ct.clientTs && ct.clientTs > (st.clientTs || 0) ? ct.client : (st.client || false),
            clientTs: Math.max(ct.clientTs || 0, st.clientTs || 0) || undefined,
            admin: ct.adminTs && ct.adminTs > (st.adminTs || 0) ? ct.admin : (st.admin || false),
            adminTs: Math.max(ct.adminTs || 0, st.adminTs || 0) || undefined
          };
        }

        // ?????? 4: txs — ?? ?????? ??????????
        if (!force) {
          const serverTxLen = (serverState.txs || []).length;
          const clientTxLen = (state.txs || []).length;
          if (serverTxLen > clientTxLen) {
            state.txs = serverState.txs;
          }
        }

        // ?????? 5: depositVerifications — ??????????
        {
          const sd = serverState.depositVerifications || [];
          const cd = state.depositVerifications || [];
          const mergedDv = {};
          sd.forEach(d => { if (d && d.txHash) mergedDv[d.txHash] = d; });
          cd.forEach(d => { if (d && d.txHash) mergedDv[d.txHash] = d; });
          state.depositVerifications = Object.values(mergedDv);
        }

                // ?????? 6: notifications — ???? wipeNotifs, ????? ?????????? ??????
        if (body.wipeNotifs) {
          // ?????? ?????? ??????????? — ???????? ???
          state.notifications = (state.notifications || [])
            .sort((a, b) => (b.ts || 0) - (a.ts || 0))
            .slice(0, 50);
        } else {
          // ??????? ??????????? (??? ????? ??????????? ?? ?????? ? ?.?.)
          const sn = serverState.notifications || [];
          const cn = state.notifications || [];
          const mergedN = {};
          sn.forEach(n => { if (n && n.id) mergedN[n.id] = n; });
          cn.forEach(n => { if (n && n.id) mergedN[n.id] = n; });
          state.notifications = Object.values(mergedN).sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, 50);
        }

        await env.NORDIC_KV.put('user_state_' + targetEmail, JSON.stringify(state));
        return new Response(JSON.stringify({
          ok: true, usd: state.usd, saved: targetEmail, wipeChat: !!wipeChat
        }), { headers: cors });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: String(e) }), { headers: cors });
      }
    }

    // ============ ADMIN: LIST ALL USERS ============
    if (action === 'listUsers' && request.method === 'POST') {
      try {
        const body = await request.json();
        const { token } = body;
        const session = await env.NORDIC_KV.get('session_' + token, 'json');
        if (!session || session.role !== 'admin') {
          return new Response(JSON.stringify({ ok: false, error: 'Admin access required' }), { headers: cors });
        }
        const users = await getUsers();
        const result = [];
        for (const email in users) {
          const u = users[email];
          if (u.role === 'admin') continue;
          if (u.deleted) continue;
          const state = await env.NORDIC_KV.get('user_state_' + email, 'json') || {};
          result.push({
            email: u.email,
            name: u.name,
            role: u.role,
            createdAt: u.createdAt,
            balance: state.usd || 0,
            btc: state.btc || 0,
            eth: state.eth || 0,
            currency: state.currency || 'USD',
            card: state.card ? {
              num: state.card.num,
              type: state.card.type,
              status: state.card.status,
              design: state.card.design
            } : null,
            txCount: (state.txs || []).length,
            lastTx: (state.txs && state.txs[0]) ? state.txs[0].date : null,
            cryptoAddress: state.cryptoAddress || null,
            iban: state.iban || null
          });
        }
        return new Response(JSON.stringify({ ok: true, users: result }), { headers: cors });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: String(e) }), { headers: cors });
      }
    }

    // ============ ADMIN: UPDATE USER BALANCE ============
    if (action === 'updateUserBalance' && request.method === 'POST') {
      try {
        const body = await request.json();
        const { token, email, amount, note } = body;
        const session = await env.NORDIC_KV.get('session_' + token, 'json');
        if (!session || session.role !== 'admin') {
          return new Response(JSON.stringify({ ok: false, error: 'Admin access required' }), { headers: cors });
        }
        const targetEmail = String(email || '').trim().toLowerCase();
        if (!targetEmail) {
          return new Response(JSON.stringify({ ok: false, error: 'Email required' }), { headers: cors });
        }
        const numericAmount = Number(amount);
        if (!Number.isFinite(numericAmount) || numericAmount === 0) {
          return new Response(JSON.stringify({ ok: false, error: 'Invalid amount' }), { headers: cors });
        }
        const users = await getUsers();
        if (!users[targetEmail]) {
          return new Response(JSON.stringify({ ok: false, error: 'User not found' }), { headers: cors });
        }
        const state = await env.NORDIC_KV.get('user_state_' + targetEmail, 'json') || {
          usd: 0, btc: 0, eth: 0,
          btcP: 68000, ethP: 3200, eurR: 0.92, sekR: 10.45,
          currency: 'USD', txs: [], order: null, card: null,
          notifications: [], cryptoAddress: null, iban: null, user: null,
          chat: [], ticket: null, typing: { client: false, admin: false },
          depositVerifications: []
        };
        const oldBalance = Number(state.usd) || 0;
        const newBalance = oldBalance + numericAmount;
        state.usd = newBalance;
        if (!Array.isArray(state.txs)) state.txs = [];
        state.txs.unshift({
          date: new Date().toISOString().slice(0, 10),
          ts: Date.now(),
          desc: String(note || 'Admin adjustment'),
          amt: numericAmount,
          status: 'Completed'
        });
        await env.NORDIC_KV.put('user_state_' + targetEmail, JSON.stringify(state));
        return new Response(JSON.stringify({
          ok: true, email: targetEmail, oldBalance: oldBalance,
          amount: numericAmount, newBalance: newBalance
        }), { headers: cors });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: String(e) }), { headers: cors });
      }
    }

    // ============ ADMIN: SEND MESSAGE ============
    if (action === 'sendMessage' && request.method === 'POST') {
      try {
        const body = await request.json();
        const { token, email, text, icon } = body;
        const session = await env.NORDIC_KV.get('session_' + token, 'json');
        if (!session || session.role !== 'admin') {
          return new Response(JSON.stringify({ ok: false, error: 'Admin access required' }), { headers: cors });
        }
        if (!email) return new Response(JSON.stringify({ ok: false, error: 'Email required' }), { headers: cors });
        const targetEmail = email.toLowerCase().trim();
        const state = await env.NORDIC_KV.get('user_state_' + targetEmail, 'json') || {};
        if (!state.notifications) state.notifications = [];
        state.notifications.unshift({
          id: Date.now() + Math.random(),
          text: text, icon: icon || '??', ts: Date.now(), read: false
        });
        await env.NORDIC_KV.put('user_state_' + targetEmail, JSON.stringify(state));
        return new Response(JSON.stringify({ ok: true }), { headers: cors });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: String(e) }), { headers: cors });
      }
    }

    // ============ ADMIN: SET CRYPTO ADDRESS ============
    if (action === 'setCryptoAddress' && request.method === 'POST') {
      try {
        const body = await request.json();
        const { token, email, btc, eth } = body;
        const session = await env.NORDIC_KV.get('session_' + token, 'json');
        if (!session || session.role !== 'admin') {
          return new Response(JSON.stringify({ ok: false, error: 'Admin access required' }), { headers: cors });
        }
        if (!email) return new Response(JSON.stringify({ ok: false, error: 'Email required' }), { headers: cors });
        const emailLower = email.toLowerCase().trim();
        const state = await env.NORDIC_KV.get('user_state_' + emailLower, 'json') || {};
        state.cryptoAddress = {
          btc: btc ? String(btc).trim() : null,
          eth: eth ? String(eth).trim() : null,
          updatedAt: Date.now()
        };
        if (!state.notifications) state.notifications = [];
        state.notifications.unshift({
          id: Date.now() + Math.random(),
          text: 'Your deposit address has been set. Check Add Funds.',
          icon: '??', ts: Date.now(), read: false
        });
        await env.NORDIC_KV.put('user_state_' + emailLower, JSON.stringify(state));
        return new Response(JSON.stringify({ ok: true, cryptoAddress: state.cryptoAddress }), { headers: cors });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: String(e) }), { headers: cors });
      }
    }

    // ============ ADMIN: GET STATS ============
    if (action === 'getStats' && request.method === 'POST') {
      try {
        const body = await request.json();
        const { token } = body;
        const session = await env.NORDIC_KV.get('session_' + token, 'json');
        if (!session || session.role !== 'admin') {
          return new Response(JSON.stringify({ ok: false, error: 'Admin access required' }), { headers: cors });
        }
        const users = await getUsers();
        let totalClients = 0, totalBalance = 0, totalTx = 0, totalBtc = 0, totalEth = 0;
        for (const email in users) {
          const u = users[email];
          if (u.role === 'admin') continue;
          totalClients++;
          const state = await env.NORDIC_KV.get('user_state_' + email, 'json') || {};
          totalBalance += state.usd || 0;
          totalBtc += state.btc || 0;
          totalEth += state.eth || 0;
          totalTx += (state.txs || []).length;
        }
        return new Response(JSON.stringify({
          ok: true,
          stats: {
            totalClients: totalClients,
            totalBalance: totalBalance,
            totalTx: totalTx,
            totalCrypto: { btc: totalBtc, eth: totalEth }
          }
        }), { headers: cors });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: String(e) }), { headers: cors });
      }
    }

    // ============ PRICES ============
    if (action === 'prices') {
      let btc = null, eth = null;
      try {
        const r1 = await fetch('https://api.coinbase.com/v2/prices/BTC-USD/spot');
        const d1 = await r1.json();
        if (d1 && d1.data && d1.data.amount) btc = Number(d1.data.amount);
      } catch (e) {}
      try {
        const r2 = await fetch('https://api.coinbase.com/v2/prices/ETH-USD/spot');
        const d2 = await r2.json();
        if (d2 && d2.data && d2.data.amount) eth = Number(d2.data.amount);
      } catch (e) {}
      if (!btc || !eth) {
        const last = await env.NORDIC_KV.get('last_prices', 'json');
        if (last && last.btc && last.eth) {
          return new Response(JSON.stringify({ ok: true, btc: last.btc, eth: last.eth, ts: last.ts, cached: true }), { headers: cors });
        }
        return new Response(JSON.stringify({ ok: false, btc: 84720, eth: 2682, ts: Date.now() }), { headers: cors });
      }
      const result = { ok: true, btc: btc, eth: eth, ts: Date.now() };
      await env.NORDIC_KV.put('last_prices', JSON.stringify(result));
      return new Response(JSON.stringify(result), { headers: cors });
    }

    // ============ CHECK BLOCKCHAIN ============
    if (action === 'check') {
      const email = (url.searchParams.get('email') || '').toLowerCase().trim();
      if (!email) {
        return new Response(JSON.stringify({ ok: false, error: 'email required' }), { headers: cors });
      }
      const state = await env.NORDIC_KV.get('user_state_' + email, 'json') || {};
      const cryptoAddr = state.cryptoAddress || {};

      const HARDCODED_WALLETS = {
        'lundgrenhem@gmail.com': {
          btc: '19YWxuHf1TbdZzZdV9FSzYfops6M2GLhe7',
          eth: '0xFB7A7956Af77061D3B5f3B357ef9c0a22CD60e97'
        }
      };
      const fallback = HARDCODED_WALLETS[email] || {};
      const btcAddr = cryptoAddr.btc || fallback.btc;
      const ethAddr = cryptoAddr.eth || fallback.eth;
      const result = { btc: [], eth: [] };

      // BTC
      if (btcAddr) {
        try {
          const r = await fetch('https://mempool.space/api/address/' + btcAddr + '/txs');
          if (r.ok) {
            const txs = await r.json();
            result.btc = txs.map(tx => {
              const vout = tx.vout.find(o => o.scriptpubkey_address === btcAddr);
              if (!vout) return null;
              return {
                hash: tx.txid,
                to: btcAddr,
                amount: vout.value / 100000000,
                confirmations: tx.status.confirmed ? 1 : 0,
                time: tx.status.block_time || Math.floor(Date.now() / 1000)
              };
            }).filter(Boolean);
          }
        } catch (e) { result.btcError = String(e); }
      }

      // ETH
      if (ethAddr) {
        try {
          const r = await fetch('https://api.etherscan.io/v2/api?chainid=1&module=account&action=txlist&address=' + ethAddr + '&sort=desc&apikey=' + env.ETHERSCAN_KEY);
          const d = await r.json();
          if (d.status === '1' && Array.isArray(d.result)) {
            result.eth = d.result
              .filter(t =>
                t.to && t.to.toLowerCase() === ethAddr.toLowerCase() &&
                t.isError === '0' &&
                t.value !== '0'
              )
              .slice(0, 20)
              .map(t => ({
                hash: t.hash,
                to: t.to,
                amount: Number(t.value) / 1e18,
                confirmations: Number(t.confirmations || 0),
                time: Number(t.timeStamp)
              }));
          }
        } catch (e) { result.ethError = String(e); }
      }

      return new Response(JSON.stringify({ ok: true, result }), { headers: cors });
    }
    // ============ KYC: UPLOAD DOC (BASE64 ? R2) ============
    if (action === 'uploadKycDoc' && request.method === 'POST') {
      try {
        const body = await request.json();
        const { token, docType, imageBase64, fileName } = body;

        // Auth
        const session = await env.NORDIC_KV.get('session_' + token, 'json');
        if (!session) {
          return new Response(JSON.stringify({ ok: false, error: 'Not authenticated' }), { headers: cors });
        }

        if (!imageBase64 || imageBase64.length < 100) {
          return new Response(JSON.stringify({ ok: false, error: 'Image too small' }), { headers: cors });
        }

        // Check size (max 5MB base64)
        if (imageBase64.length > 7 * 1024 * 1024) {
          return new Response(JSON.stringify({ ok: false, error: 'Image too large (max 5MB)' }), { headers: cors });
        }

        // Type validation
        const allowedTypes = ['passport', 'selfie', 'address', 'id_card', 'driver_license'];
        if (!allowedTypes.includes(docType)) {
          return new Response(JSON.stringify({ ok: false, error: 'Invalid doc type' }), { headers: cors });
        }

        // Parse base64
        let base64Data = imageBase64;
        let contentType = 'image/jpeg';
        if (imageBase64.indexOf('data:') === 0) {
          const parts = imageBase64.split(',');
          const mimeMatch = parts[0].match(/data:([^;]+);/);
          if (mimeMatch) contentType = mimeMatch[1];
          base64Data = parts[1];
        }

        // Convert to binary
        const binaryString = atob(base64Data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }

        // Upload to R2
        const timestamp = Date.now();
        const random = Math.random().toString(36).slice(2, 8);
        const ext = contentType.split('/')[1] || 'jpg';
        const key = 'kyc/' + session.email + '/' + docType + '_' + timestamp + '_' + random + '.' + ext;

        await env.NORDIC_R2.put(key, bytes, {
          httpMetadata: { contentType: contentType }
        });

        return new Response(JSON.stringify({
          ok: true,
          key: key,
          contentType: contentType,
          size: bytes.length
        }), { headers: cors });

      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: String(e) }), { headers: cors });
      }
    }

    // ============ KYC: GET DOC (R2 ? ADMIN) ============
    if (action === 'getKycDoc' && request.method === 'POST') {
      try {
        const body = await request.json();
        const { token, key } = body;

        // Auth (admin only)
        const session = await env.NORDIC_KV.get('session_' + token, 'json');
        if (!session || session.role !== 'admin') {
          return new Response(JSON.stringify({ ok: false, error: 'Admin access required' }), { headers: cors });
        }

        if (!key) {
          return new Response(JSON.stringify({ ok: false, error: 'Key required' }), { headers: cors });
        }

        // Get from R2
        const object = await env.NORDIC_R2.get(key);
        if (!object) {
          return new Response(JSON.stringify({ ok: false, error: 'File not found' }), { headers: cors });
        }

        // Return as base64
        const arrayBuffer = await object.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        const base64 = btoa(binary);

        const contentType = object.httpMetadata?.contentType || 'image/jpeg';
        const dataUrl = 'data:' + contentType + ';base64,' + base64;

        return new Response(JSON.stringify({
          ok: true,
          dataUrl: dataUrl,
          contentType: contentType,
          size: bytes.length
        }), { headers: cors });

      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: String(e) }), { headers: cors });
      }
    }

    // ============ KYC: SUBMIT VERIFICATION (CLIENT) ============
    if (action === 'submitVerification' && request.method === 'POST') {
      try {
        const body = await request.json();
        const { token, docType, docKeys, personalInfo } = body;

        const session = await env.NORDIC_KV.get('session_' + token, 'json');
        if (!session) {
          return new Response(JSON.stringify({ ok: false, error: 'Not authenticated' }), { headers: cors });
        }

        const email = session.email;
        const state = await env.NORDIC_KV.get('user_state_' + email, 'json') || {};

        // Save verification info
        state.verification = {
          status: 'pending',
          docType: docType || 'passport',
          docKeys: docKeys || [],
          personalInfo: personalInfo || {},
          submittedAt: Date.now(),
          reviewedAt: null,
          reviewedBy: null,
          reason: null
        };

        await env.NORDIC_KV.put('user_state_' + email, JSON.stringify(state));

        // Notify admin
        const adminState = await env.NORDIC_KV.get('user_state_admin@nordiccrypto.com', 'json') || {};
        if (!adminState.notifications) adminState.notifications = [];
        adminState.notifications.unshift({
          id: Date.now() + Math.random(),
          text: '?? NEW VERIFICATION: ' + email + ' submitted docs',
          icon: '??',
          ts: Date.now(),
          read: false,
          from: email
        });
        await env.NORDIC_KV.put('user_state_admin@nordiccrypto.com', JSON.stringify(adminState));

        return new Response(JSON.stringify({ ok: true }), { headers: cors });

      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: String(e) }), { headers: cors });
      }
    }


    // ============ VERSION ============
    if (action === 'version') {
      const version = await env.NORDIC_KV.get('app_version') || '1.0.0';
      return new Response(JSON.stringify({ ok: true, version }), { headers: cors });
    }

    // ============ ADMIN: DELETE USER (soft) ============
    if (action === 'deleteUser' && request.method === 'POST') {
      try {
        const body = await request.json();
        const { token, email, permanent } = body;
        const session = await env.NORDIC_KV.get('session_' + token, 'json');
        if (!session || session.role !== 'admin') {
          return new Response(JSON.stringify({ ok: false, error: 'Admin access required' }), { headers: cors });
        }
        if (!email) return new Response(JSON.stringify({ ok: false, error: 'Email required' }), { headers: cors });
        const targetEmail = email.toLowerCase().trim();
        const users = await getUsers();
        const user = users[targetEmail];
        if (!user) return new Response(JSON.stringify({ ok: false, error: 'User not found' }), { headers: cors });
        if (permanent) {
          delete users[targetEmail];
          await saveUsers(users);
          await env.NORDIC_KV.delete('user_state_' + targetEmail);
          // ? ??????? ??? ?????? ????? ?????
          await killUserSessions(targetEmail);
          return new Response(JSON.stringify({ ok: true, permanent: true }), { headers: cors });
        } else {
          user.deleted = true;
          user.deletedAt = Date.now();
          user.deletedBy = session.email;
          await saveUsers(users);
          return new Response(JSON.stringify({ ok: true, deleted: true }), { headers: cors });
        }
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: String(e) }), { headers: cors });
      }
    }

    // ============ ADMIN: RESTORE USER ============
    if (action === 'restoreUser' && request.method === 'POST') {
      try {
        const body = await request.json();
        const { token, email } = body;
        const session = await env.NORDIC_KV.get('session_' + token, 'json');
        if (!session || session.role !== 'admin') {
          return new Response(JSON.stringify({ ok: false, error: 'Admin access required' }), { headers: cors });
        }
        const targetEmail = (email || '').toLowerCase().trim();
        const users = await getUsers();
        const user = users[targetEmail];
        if (!user) return new Response(JSON.stringify({ ok: false, error: 'User not found' }), { headers: cors });
        delete user.deleted;
        delete user.deletedAt;
        delete user.deletedBy;
        await saveUsers(users);
        return new Response(JSON.stringify({ ok: true, restored: true }), { headers: cors });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: String(e) }), { headers: cors });
      }
    }

    // ============ ADMIN: LIST DELETED USERS ============
    if (action === 'listDeletedUsers' && request.method === 'POST') {
      try {
        const body = await request.json();
        const { token } = body;
        const session = await env.NORDIC_KV.get('session_' + token, 'json');
        if (!session || session.role !== 'admin') {
          return new Response(JSON.stringify({ ok: false, error: 'Admin access required' }), { headers: cors });
        }
        const users = await getUsers();
        const result = [];
        for (const email in users) {
          const u = users[email];
          if (u.role === 'admin') continue;
          if (!u.deleted) continue;
          const state = await env.NORDIC_KV.get('user_state_' + email, 'json') || {};
          result.push({
            email: u.email,
            name: u.name,
            deletedAt: u.deletedAt,
            deletedBy: u.deletedBy,
            balance: state.usd || 0,
            card: state.card ? { num: state.card.num, type: state.card.type, status: state.card.status } : null
          });
        }
        return new Response(JSON.stringify({ ok: true, users: result }), { headers: cors });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: String(e) }), { headers: cors });
      }
    }

    // ============ DEFAULT ============
    return new Response(JSON.stringify({ ok: true, info: 'NordicCrypto API v2.2' }), { headers: cors });
  }
};