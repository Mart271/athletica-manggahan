/* ==========================================================================
   ATHLETICA MANGGAHAN — client
   Renders from the view the server sends back (V) and never decides prices,
   eligibility or permissions itself. Talks to server.js when it is running;
   otherwise runs core.js in this browser as a clearly labelled demo.
   ========================================================================== */
(function () {
  'use strict';
  const Core = window.AthleticaCore;

  /* ---------- Helpers ---------- */
  const $ = s => document.querySelector(s);
  const pad = n => String(n).padStart(2, '0');
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const peso = n => '₱' + Math.round(n).toLocaleString('en-PH');
  const peso2 = n => '₱' + Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
  const parseDate = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (s, n) => Core.util.addDays(s, n);
  const fac = () => Core.util.local(Date.now());
  const today = () => fac().date;
  const fmtHour = h => (h % 12 === 0 ? 12 : h % 12) + (h < 12 ? ' AM' : ' PM');
  const fmtRange = (a, b) => fmtHour(a) + ' to ' + fmtHour(b);
  const fmtDate = s => parseDate(s).toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric' });
  const fmtLong = s => parseDate(s).toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const fmtStamp = ts => new Date(ts).toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const fmtClock = ts => new Date(ts).toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' });
  const fmtDayStamp = ts => new Date(ts).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', month: 'long', day: 'numeric', year: 'numeric' });
  const mmss = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ':' + pad(s % 60); };
  const msUntil = ts => (ts ? Date.parse(ts) - Date.now() : 0);
  const isPast = (date, h) => { const f = fac(); return date < f.date || (date === f.date && h <= f.hour); };
  const reduceMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const isRail = () => !!(window.matchMedia && window.matchMedia('(min-width: 1200px)').matches);
  const mq = window.matchMedia ? window.matchMedia('(max-width: 720px)') : null;
  const isNarrow = () => !!(mq && mq.matches);
  const normPhone = v => { let x = String(v || '').replace(/[\s\-().]/g, ''); if (/^\+?63\d{10}$/.test(x)) x = '0' + x.replace(/^\+?63/, ''); return x; };

  /* ---------- Connection: the real server, or core.js in this browser ---------- */
  const DEMO_DB = 'athletica-demo-db', DEMO_SESS = 'athletica-demo-sessions', DEMO_TOKEN = 'athletica-demo-token';
  let MODE = 'server', demo = null;
  const ls = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }, del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } } };
  const hex = a => Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
  const randomHex = n => hex(crypto.getRandomValues(new Uint8Array(n)));
  async function derive(pw, salt) {
    if (!(window.crypto && crypto.subtle)) return 'weak-' + Core.util.hash(salt + '|' + pw).toString(16);
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode(salt), iterations: 100000, hash: 'SHA-256' }, key, 256);
    return hex(new Uint8Array(bits));
  }
  const webHasher = {
    async hash(pw) { const salt = randomHex(16); return 'pbkdf2$' + salt + '$' + await derive(pw, salt); },
    async verify(pw, stored) { const [k, salt, h] = String(stored).split('$'); return k === 'pbkdf2' && (await derive(pw, salt)) === h; }
  };
  async function startDemo() {
    let mem = null;
    try { mem = JSON.parse(ls.get(DEMO_DB) || 'null'); } catch (e) { mem = null; }
    if (!mem || !mem.meta || mem.meta.schema !== 1) { mem = await Core.buildSeed(webHasher, Date.now()); ls.set(DEMO_DB, JSON.stringify(mem)); }
    let sess = {};
    try { sess = JSON.parse(ls.get(DEMO_SESS) || '{}') || {}; } catch (e) { sess = {}; }
    const store = { load: () => mem, save(db) { mem = db; if (!ls.set(DEMO_DB, JSON.stringify(db))) S.storageFull = true; } };
    const sessions = {
      get: t => sess[t] || null, set(t, u) { sess[t] = u; ls.set(DEMO_SESS, JSON.stringify(sess)); },
      del(t) { delete sess[t]; ls.set(DEMO_SESS, JSON.stringify(sess)); },
      dropUser(uid) { Object.keys(sess).forEach(k => { if (sess[k] === uid) delete sess[k]; }); ls.set(DEMO_SESS, JSON.stringify(sess)); }
    };
    // No email in demo mode: a sent message is handed back so the page can show it in a labelled demo mailbox.
    const mailer = msg => Object.assign({ sentAt: new Date().toISOString() }, msg);
    demo = { service: Core.createService({ store, hasher: webHasher, sessions, mailer, random: () => randomHex(24) }), reload() { try { mem = JSON.parse(ls.get(DEMO_DB)); } catch (e) { /* keep memory */ } } };
  }
  async function detectMode() {
    if (/[?&]demo\b/.test(location.search) || location.protocol === 'file:') return 'demo';
    try {
      const r = await fetch('api/ping', { credentials: 'same-origin' });
      if (r.ok) { const j = await r.json(); if (j && j.ok) return 'server'; }
    } catch (e) { /* no server here */ }
    return 'demo';
  }
  async function api(action, payload) {
    if (MODE === 'demo') {
      const out = await demo.service.handle(action, payload || {}, ls.get(DEMO_TOKEN));
      if (out.token) ls.set(DEMO_TOKEN, out.token); else if (out.token === null) ls.del(DEMO_TOKEN);
      return out;
    }
    try {
      const res = await fetch('api/' + action, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload || {}) });
      return await res.json();
    } catch (e) {
      return { ok: false, error: { code: 'offline', message: 'Can’t reach the server. Check that it is running and try again.' } };
    }
  }
  // Every call returns the fresh view, so the page always renders what the database now says.
  async function act(action, payload) {
    const out = await api(action, payload);
    if (out.view) setView(out.view);
    return out;
  }

  /* ---------- State ---------- */
  let V = null; // the view from the server
  const IX = {};
  const S = {
    view: 'home', sport: 'basketball', date: today(), adminDate: today(),
    sel: { court: null, hours: [] }, notice: '', errors: {},
    form: { type: 'INDIVIDUAL', phone: '', teamName: '', headcount: '' },
    co: null, drafts: { res: null, cart: null }, cx: null, focusKey: null, focusSel: null, countUp: true, pending: null, next: null, loginNotice: '',
    login: { username: '', password: '', err: '', busy: false }, profile: null, profileErr: {},
    signup: blankSignup(), reset: blankReset(),
    shopCat: 'all', shopQ: '', shopSort: 'featured', shopQty: {}, lastOrder: null,
    adminTab: 'schedule', payFilter: 'review', refundFilter: 'review', logFilter: '', custQ: '', q: '', setErr: {}, setDraft: null, courtErr: {}
  };
  function setView(v) {
    const was = V && V.me ? V.me.id : null;
    V = v;
    index();
    const now = V.me ? V.me.id : null;
    if (was !== now) { S.drafts = { res: blankDraft(), cart: blankDraft() }; S.form.phone = V.me ? V.me.phone : ''; }
  }
  function index() {
    const by = (list, k) => Object.fromEntries((list || []).map(x => [x[k || 'id'], x]));
    IX.sport = by(V.sports); IX.court = by(V.courts); IX.product = by(V.products); IX.cat = by(V.categories);
    IX.courtsBySport = {};
    V.courts.forEach(c => { (IX.courtsBySport[c.sportId] = IX.courtsBySport[c.sportId] || []).push(c); });
    IX.res = by(V.reservations); IX.pay = by(V.payments); IX.order = by(V.orders);
    IX.can = by(V.cancellations || (V.reservations || []).map(r => r.cancellation).filter(Boolean));
    IX.user = by(V.users);
  }
  const me = () => (V && V.me) || null;
  const isAdmin = () => !!(me() && me().role === 'ADMIN');
  const isPlayer = () => !!(me() && me().role === 'USER');
  function blankSignup() { return { firstName: '', lastName: '', username: '', email: '', phone: '', password: '', confirmPassword: '', err: {}, busy: false, show: false }; }
  function blankReset() { return { step: 'request', identifier: '', code: '', newPassword: '', confirmPassword: '', err: {}, busy: false, show: false, message: '', devMail: null, sentAt: 0 }; }
  function blankDraft() { return { method: '', ref: '', proof: '', proofName: '', err: {}, busy: false, name: me() ? me().firstName + ' ' + me().lastName : '', mobile: me() ? me().phone : '' }; }
  S.drafts = { res: blankDraft(), cart: blankDraft() };
  const sportsList = () => V.sports.filter(s => (IX.courtsBySport[s.id] || []).length);
  const courtName = c => IX.sport[c.sportId].name + ' ' + c.name;
  const courtLabel = id => (IX.court[id] ? courtName(IX.court[id]) : id);
  const sportRate = sid => Math.min(...(IX.courtsBySport[sid] || []).map(c => c.hourlyRate));
  const depositPct = c => (c.depositPercentage != null ? c.depositPercentage : V.settings.depositPercentage);
  const hoursList = () => { const s = V.settings, out = []; for (let h = s.openHour; h < s.closeHour; h++) out.push(h); return out; };
  const cellOf = (date, courtId, h) => { const d = V.occupancy[date]; return (d && d[courtId] && d[courtId][h]) || null; };
  const PLAYER_TYPES = Core.PLAYER_TYPES;

  /* ---------- Labels and badges: text plus shape, never colour alone ---------- */
  const RES_LABEL = { PENDING_PAYMENT: 'Pending payment', PAYMENT_VERIFICATION: 'Payment verification', CONFIRMED: 'Confirmed', CHECKED_IN: 'Checked in', COMPLETED: 'Completed', CANCELLED: 'Cancelled', EXPIRED: 'Expired' };
  const RES_BADGE = { PENDING_PAYMENT: 'b-warn', PAYMENT_VERIFICATION: 'b-info', CONFIRMED: 'b-ok', CHECKED_IN: 'b-ok', COMPLETED: 'b-mute', CANCELLED: 'b-bad', EXPIRED: 'b-mute' };
  const PAY_LABEL = { UNPAID: 'Unpaid', PENDING: 'Cash due', AWAITING_VERIFICATION: 'Awaiting verification', PAID: 'Paid', FAILED: 'Failed', REFUNDED: 'Refunded', PARTIALLY_REFUNDED: 'Partly refunded' };
  const PAY_BADGE = { UNPAID: 'b-mute', PENDING: 'b-warn', AWAITING_VERIFICATION: 'b-info', PAID: 'b-ok', FAILED: 'b-bad', REFUNDED: 'b-info', PARTIALLY_REFUNDED: 'b-info' };
  const REFUND_LABEL = { PENDING_REVIEW: 'Refund pending review', APPROVED: 'Refund approved', COMPLETED: 'Refund completed', DENIED: 'Refund denied', NOT_ELIGIBLE: 'No refund', NOT_APPLICABLE: 'Nothing to refund' };
  const REFUND_BADGE = { PENDING_REVIEW: 'b-warn', APPROVED: 'b-info', COMPLETED: 'b-ok', DENIED: 'b-bad', NOT_ELIGIBLE: 'b-mute', NOT_APPLICABLE: 'b-mute' };
  const ORD_LABEL = { PENDING_COUNTER_PAYMENT: 'Pay at counter', AWAITING_VERIFICATION: 'Awaiting verification', READY_FOR_PICKUP: 'Ready for pickup', COLLECTED: 'Collected', CANCELLED: 'Cancelled', PAYMENT_REJECTED: 'Payment rejected' };
  const ORD_BADGE = { PENDING_COUNTER_PAYMENT: 'b-warn', AWAITING_VERIFICATION: 'b-info', READY_FOR_PICKUP: 'b-ok', COLLECTED: 'b-mute', CANCELLED: 'b-mute', PAYMENT_REJECTED: 'b-bad' };
  const METHOD = {
    GCASH: { label: 'GCash', mark: 'GC', kind: 'wallet', note: 'E-wallet transfer', refHint: 'The 13-digit reference number on your GCash receipt.' },
    MAYA: { label: 'Maya', mark: 'MY', kind: 'wallet', note: 'E-wallet transfer', refHint: 'The reference ID on your Maya receipt.' },
    QRPH: { label: 'QR Ph', mark: 'QR', kind: 'qr', note: 'Scan with any bank app', refHint: 'The transaction or reference number your bank app shows after paying.' },
    CASH: { label: 'Cash over the counter', mark: '₱', kind: 'counter', note: 'Pay at the front desk' }
  };
  const badge = (cls, label) => `<span class="badge ${cls}"><i aria-hidden="true"></i>${esc(label)}</span>`;
  function resLabel(r) {
    if (r.status === 'PENDING_PAYMENT') return r.paymentStatus === 'PENDING' ? 'Awaiting cash deposit' : r.paymentStatus === 'FAILED' ? 'Payment required' : 'Pending payment';
    return RES_LABEL[r.status] || r.status;
  }
  const resBadge = r => badge(RES_BADGE[r.status] || 'b-mute', resLabel(r));
  const payBadge = st => badge(PAY_BADGE[st] || 'b-mute', PAY_LABEL[st] || st);
  const refundBadge = st => badge(REFUND_BADGE[st] || 'b-mute', REFUND_LABEL[st] || st);
  const ordBadge = o => badge(ORD_BADGE[o.status] || 'b-mute', ORD_LABEL[o.status] || o.status);
  const btn = (action, label, cls, data) => `<button type="button" class="btn btn-sm ${cls || ''}" data-action="${action}"${Object.entries(data || {}).map(([k, v]) => ` data-${k}="${esc(v)}"`).join('')}>${label}</button>`;
  const placeholderNote = t => `<p class="placeholder"><b>Sample</b><span>${t}</span></p>`;

  /* ---------- Icons ---------- */
  const ICON = {
    home: '<path d="M3 11 12 3l9 8v10H3z"/><path d="M9 21v-6h6v6"/>',
    book: '<rect x="3" y="5" width="18" height="16"/><path d="M3 10h18M8 3v4M16 3v4M7 14h4v3H7z"/>',
    shop: '<path d="M4 8h16l-1.5 13h-13z"/><path d="M8 8V6a4 4 0 0 1 8 0v2"/>',
    cart: '<path d="M2 4h3l2.4 11h11.1L21 7H6.2"/><path d="M9 20h.01M17 20h.01" stroke-width="3.4"/>',
    mine: '<path d="M3 6h18v4a2 2 0 0 0 0 4v4H3v-4a2 2 0 0 0 0-4z"/><path d="M14 6v12"/>',
    admin: '<rect x="5" y="4" width="14" height="17"/><path d="M9 2h6v4H9zM8 11h8M8 15h8M8 19h4"/>',
    bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 3H4z"/><path d="M10 21h4"/>',
    user: '<rect x="8" y="3" width="8" height="8"/><path d="M4 21v-4a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v4"/>',
    opts: '<path d="M3 7h11M19 7h2M3 17h3M11 17h10"/><rect x="14" y="4.5" width="5" height="5"/><rect x="6" y="14.5" width="5" height="5"/>',
    signin: '<path d="M14 4h6v16h-6M3 12h12M11 8l4 4-4 4"/>'
  };
  const icon = k => `<svg class="ni" viewBox="0 0 24 24" aria-hidden="true">${ICON[k]}</svg>`;

  /* ---------- Chrome: navigation depends on who is signed in ---------- */
  function navItems() {
    if (isAdmin()) return [['home', 'Home'], ['book', 'Availability'], ['admin', 'Front desk'], ['shop', 'Shop']];
    if (isPlayer()) return [['home', 'Home'], ['book', 'Book'], ['shop', 'Shop'], ['cart', 'Cart'], ['mine', 'My reservations']];
    return [['home', 'Home'], ['book', 'Book'], ['shop', 'Shop'], ['login', 'Sign in']];
  }
  const ICON_OF = { home: 'home', book: 'book', shop: 'shop', cart: 'cart', mine: 'mine', admin: 'admin', login: 'signin' };
  const SHORT = { 'My reservations': 'Bookings', Availability: 'Book', 'Front desk': 'Desk', 'Sign in': 'Sign in' };
  function renderChrome() {
    const items = navItems(), nav = $('#mainnav');
    nav.innerHTML = '<span class="nav-ind" aria-hidden="true"></span>' + items.map(([v, l]) =>
      `<button type="button" data-action="view" data-view="${v}">${icon(ICON_OF[v])}${l}${v === 'cart' ? '<b class="cart-count" data-cart-count hidden>0</b>' : ''}</button>`).join('');
    $('#bnav').innerHTML = items.slice(0, 5).map(([v, l]) =>
      `<button type="button" data-action="view" data-view="${v}">${icon(ICON_OF[v])}${SHORT[l] || l}${v === 'cart' ? '<b class="cart-count" data-cart-count hidden>0</b>' : ''}</button>`).join('');
    $('#bnav').style.gridTemplateColumns = `repeat(${Math.min(5, items.length)},1fr)`;
    const u = me(), unread = unreadCount();
    $('#tools').innerHTML = (u ? `<button type="button" class="opt-btn tool-bell" data-action="notif" aria-expanded="false" aria-controls="notif" aria-label="Notifications${unread ? ', ' + unread + ' unread' : ''}">${icon('bell')}<span>Alerts</span>${unread ? `<b class="cart-count">${unread}</b>` : ''}</button>` : '') +
      `<button type="button" class="opt-btn" data-action="options" aria-expanded="false" aria-controls="opts">${icon(u ? 'user' : 'opts')}<span>${u ? esc(u.firstName) : 'Options'}</span></button>`;
    $('#modeNote').textContent = MODE === 'demo' ? 'Demo mode: data is stored in this browser only' : 'Connected to the Athletica server (data/db.json)';
  }
  function syncChrome(bump) {
    const n = cartCount();
    document.querySelectorAll('[data-cart-count]').forEach(el => {
      el.textContent = n; el.hidden = !n;
      if (bump && n && !reduceMotion()) { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
    });
    const navView = { checkout: 'book', profile: isPlayer() ? 'mine' : 'home', signup: 'login', reset: 'login' }[S.view] || S.view;
    document.querySelectorAll('#mainnav button, #bnav button').forEach(b => {
      if (b.dataset.view === navView) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
  }
  function unreadCount() { return me() ? (V.notifications || []).filter(n => !n.read).length : 0; }

  /* ---------- Theme ---------- */
  const THEME_KEY = 'msc-theme';
  function themePref() { const t = ls.get(THEME_KEY); return t === 'light' || t === 'dark' ? t : 'system'; }
  function applyTheme(mode, animate) {
    const root = document.documentElement;
    if (animate && !reduceMotion()) { root.classList.add('theming'); setTimeout(() => root.classList.remove('theming'), 360); }
    if (mode === 'light' || mode === 'dark') root.setAttribute('data-theme', mode); else root.removeAttribute('data-theme');
    if (mode === 'system') ls.del(THEME_KEY); else ls.set(THEME_KEY, mode);
  }

  /* ---------- Account + options panel ---------- */
  function optsHTML() {
    const m = themePref(), u = me();
    const desc = { system: 'Follows your device setting.', light: 'Always light: bone paper, ink type.', dark: 'Always dark: soft charcoal, muted type.' }[m];
    return `<p class="hud"><span class="tick"></span>${u ? 'Account' : 'Options'}</p>
      ${u ? `<div class="acct-card"><strong>${esc(u.firstName + ' ' + u.lastName)}</strong><span>${esc(u.username)} · ${u.role === 'ADMIN' ? 'Front desk' : 'Player'}</span></div>
        <div class="acct-actions">${u.role === 'USER' ? '<button type="button" class="btn btn-sm" data-action="view" data-view="profile">Profile</button>' : '<button type="button" class="btn btn-sm" data-action="view" data-view="admin">Front desk</button>'}
          <button type="button" class="btn btn-sm btn-ghost" data-action="logout">Sign out</button></div>`
        : '<div class="acct-actions"><button type="button" class="btn btn-sm btn-primary" data-action="view" data-view="login">Sign in</button><button type="button" class="btn btn-sm" data-action="view" data-view="signup">Create account</button></div>'}
      <fieldset class="opt-group"><legend>Appearance</legend>
        <div class="seg">${['system', 'light', 'dark'].map(k => `<button type="button" data-action="theme" data-mode="${k}" aria-pressed="${m === k}">${k[0].toUpperCase() + k.slice(1)}</button>`).join('')}</div>
        <p class="hint">${desc}</p>
      </fieldset>
      <div class="opt-group"><p class="opt-l">Motion</p><p class="hint">${reduceMotion() ? 'Reduced. Your device asks for less motion, so animations are off.' : 'Standard. Turn on reduce motion in your device settings to switch animations off.'}</p></div>
      <div class="opt-group"><p class="opt-l">Data</p><p class="hint">${MODE === 'demo' ? 'Demo mode: the database lives in this browser, seeded from core.js. Run <code>node server.js</code> to use data/db.json.' : 'Connected to the Athletica server. Changes are saved to data/db.json.'}</p>
        ${MODE === 'demo' ? (S.pending === 'reset-demo' ? '<div class="acct-actions">' + btn('reset-demo-confirm', 'Reset demo data', 'btn-danger') + btn('keep', 'Keep', 'btn-ghost') + '</div>' : btn('reset-demo', 'Reset demo data', 'btn-ghost')) : ''}</div>`;
  }
  function togglePanel(id, open) {
    const p = document.getElementById(id), trigger = document.querySelector(`[aria-controls="${id}"]`);
    ['opts', 'notif'].forEach(o => { if (o !== id) { document.getElementById(o).hidden = true; const t = document.querySelector(`[aria-controls="${o}"]`); if (t) t.setAttribute('aria-expanded', 'false'); } });
    if (open == null) open = p.hidden;
    if (open) {
      p.innerHTML = id === 'opts' ? optsHTML() : notifHTML();
      p.hidden = false;
      const f = p.querySelector('[aria-pressed="true"], button, [href]');
      if (f) f.focus();
    } else p.hidden = true;
    if (trigger) trigger.setAttribute('aria-expanded', String(open));
  }
  function closePanels() { ['opts', 'notif'].forEach(id => { if (!document.getElementById(id).hidden) togglePanel(id, false); }); }

  /* ---------- Notifications ---------- */
  const NOTIF_TAG = {
    RESERVATION_CANCELLED: 'Cancelled', CANCELLATION_REQUEST: 'Cancellation', PAYMENT_SUBMITTED: 'Payment', PAYMENT_VERIFIED: 'Confirmed', PAYMENT_REJECTED: 'Action needed',
    REFUND_APPROVED: 'Refund', REFUND_DENIED: 'Refund', REFUND_COMPLETED: 'Refund', HOLD_EXPIRED: 'Expired', WELCOME: 'Welcome', PASSWORD_CHANGED: 'Security', ORDER_READY: 'Order', ORDER_PLACED: 'Order', ORDER_CANCELLED: 'Order'
  };
  function notifHTML() {
    const list = V.notifications || [];
    return `<div class="notif-head"><p class="hud"><span class="tick"></span>Notifications</p>${list.some(n => !n.read) ? btn('notif-read-all', 'Mark all read', 'btn-ghost') : ''}</div>
      ${list.length ? `<ul class="notif-list">${list.slice(0, 30).map(n => `<li class="${n.read ? '' : 'unread'}">
        <button type="button" data-action="notif-open" data-id="${esc(n.id)}" data-type="${esc(n.type)}" data-target="${esc(n.targetId || '')}">
          <span class="n-top"><span class="n-tag">${esc(NOTIF_TAG[n.type] || 'Update')}</span>${n.read ? '' : '<span class="n-new">New</span>'}<time>${esc(fmtStamp(n.createdAt))}</time></span>
          <strong>${esc(n.title)}</strong><span class="n-msg">${esc(n.message)}</span></button></li>`).join('')}</ul>`
        : '<p class="hint flush">No notifications yet. Booking, payment and refund updates show up here.</p>'}`;
  }

  /* ---------- Cart helpers (cart lives on the server) ---------- */
  const cartLines = () => (V.cart || []).filter(l => IX.product[l.productId]);
  const cartQty = id => { const l = cartLines().find(x => x.productId === id); return l ? l.qty : 0; };
  const cartCount = () => cartLines().reduce((n, l) => n + l.qty, 0);
  const cartTotal = () => cartLines().reduce((n, l) => n + IX.product[l.productId].price * l.qty, 0);
  const LOW = 8;
  function stockBadge(p) {
    const n = p.stock;
    return n <= 0 ? '<span class="stock out">Out of stock</span>' : n <= LOW ? `<span class="stock low">Low stock, ${n} left</span>` : '<span class="stock in">In stock</span>';
  }

  /* ---------- Artwork (visual only; all data comes from the view) ---------- */
  const ART = {
    basketball: '<rect class="d" pathLength="1" x="10" y="10" width="180" height="100" rx="2"/><line class="d" pathLength="1" x1="100" y1="10" x2="100" y2="110"/><circle class="d" pathLength="1" cx="100" cy="60" r="14"/><rect class="d" pathLength="1" x="10" y="42" width="34" height="36"/><rect class="d" pathLength="1" x="156" y="42" width="34" height="36"/><path class="d" pathLength="1" d="M10 22 H30 A40 40 0 0 1 30 98 H10"/><path class="d" pathLength="1" d="M190 22 H170 A40 40 0 0 0 170 98 H190"/>',
    volleyball: '<rect class="d" pathLength="1" x="10" y="20" width="180" height="80" rx="2"/><line class="d net" pathLength="1" x1="100" y1="8" x2="100" y2="112"/><line class="d" pathLength="1" x1="70" y1="20" x2="70" y2="100"/><line class="d" pathLength="1" x1="130" y1="20" x2="130" y2="100"/>',
    badminton: '<rect class="d" pathLength="1" x="10" y="15" width="180" height="90" rx="2"/><line class="d" pathLength="1" x1="10" y1="24" x2="190" y2="24"/><line class="d" pathLength="1" x1="10" y1="96" x2="190" y2="96"/><line class="d net" pathLength="1" x1="100" y1="10" x2="100" y2="110"/><line class="d" pathLength="1" x1="76" y1="15" x2="76" y2="105"/><line class="d" pathLength="1" x1="124" y1="15" x2="124" y2="105"/><line class="d" pathLength="1" x1="22" y1="15" x2="22" y2="105"/><line class="d" pathLength="1" x1="178" y1="15" x2="178" y2="105"/><line class="d" pathLength="1" x1="22" y1="60" x2="76" y2="60"/><line class="d" pathLength="1" x1="124" y1="60" x2="178" y2="60"/>',
    tennis: '<rect class="d" pathLength="1" x="10" y="10" width="180" height="100" rx="2"/><line class="d" pathLength="1" x1="10" y1="24" x2="190" y2="24"/><line class="d" pathLength="1" x1="10" y1="96" x2="190" y2="96"/><line class="d net" pathLength="1" x1="100" y1="4" x2="100" y2="116"/><line class="d" pathLength="1" x1="55" y1="24" x2="55" y2="96"/><line class="d" pathLength="1" x1="145" y1="24" x2="145" y2="96"/><line class="d" pathLength="1" x1="55" y1="60" x2="145" y2="60"/>',
    swimming: '<rect class="d" pathLength="1" x="10" y="10" width="180" height="100" rx="6"/><line class="d" pathLength="1" x1="10" y1="35" x2="190" y2="35"/><line class="d" pathLength="1" x1="10" y1="60" x2="190" y2="60"/><line class="d" pathLength="1" x1="10" y1="85" x2="190" y2="85"/><line class="d" pathLength="1" x1="32" y1="10" x2="32" y2="110"/><line class="d" pathLength="1" x1="168" y1="10" x2="168" y2="110"/>',
    futsal: '<rect class="d" pathLength="1" x="10" y="10" width="180" height="100" rx="2"/><line class="d" pathLength="1" x1="100" y1="10" x2="100" y2="110"/><circle class="d" pathLength="1" cx="100" cy="60" r="16"/><path class="d" pathLength="1" d="M10 30 A30 30 0 0 1 10 90"/><path class="d" pathLength="1" d="M190 30 A30 30 0 0 0 190 90"/><line class="d net" pathLength="1" x1="6" y1="50" x2="6" y2="70"/><line class="d net" pathLength="1" x1="194" y1="50" x2="194" y2="70"/>'
  };
  const PART = {
    bottle: '<rect x="42" y="34" width="36" height="72"/><rect x="50" y="18" width="20" height="16"/><rect class="pa-f" x="42" y="58" width="36" height="22"/>',
    squeeze: '<rect x="40" y="40" width="40" height="66"/><path d="M50 40V28h20v12"/><rect x="55" y="14" width="10" height="14"/><rect class="pa-f" x="40" y="62" width="40" height="14"/><line x1="40" y1="90" x2="80" y2="90"/>',
    water: '<rect x="46" y="32" width="28" height="74"/><rect x="52" y="18" width="16" height="14"/><line x1="46" y1="48" x2="74" y2="48"/><line x1="46" y1="56" x2="74" y2="56"/><rect class="pa-f" x="46" y="72" width="28" height="16"/>',
    can: '<rect x="36" y="26" width="48" height="80"/><line x1="36" y1="38" x2="84" y2="38"/><line x1="36" y1="94" x2="84" y2="94"/><rect class="pa-f" x="36" y="54" width="48" height="24"/>',
    bar: '<rect x="18" y="42" width="84" height="36"/><rect class="pa-f" x="42" y="42" width="36" height="36"/><path d="M18 42l-6 4 6 5-6 4 6 5-6 4 6 5-6 4 6 3"/><path d="M102 42l6 4-6 5 6 4-6 5 6 4-6 5 6 4-6 3"/>',
    slab: '<rect x="22" y="36" width="76" height="48"/><line x1="22" y1="60" x2="98" y2="60"/><rect class="pa-f" x="22" y="36" width="20" height="48"/><line x1="60" y1="36" x2="60" y2="84"/>',
    banana: '<path d="M22 38c10 42 48 60 80 40-28 2-56-10-68-42z"/><path class="pa-f" d="M16 30l10 2-2 10z"/>',
    pouch: '<path d="M30 32h60l6 74H24z"/><path d="M30 32l5-8 5 8 5-8 5 8 5-8 5 8 5-8 5 8 5-8 5 8 5-8 5 8"/><rect class="pa-f" x="40" y="58" width="40" height="22"/>',
    flask: '<rect x="40" y="36" width="40" height="70"/><rect x="48" y="22" width="24" height="14"/><path d="M72 26h12v16"/><rect class="pa-f" x="40" y="70" width="40" height="10"/>',
    towel: '<rect x="22" y="28" width="76" height="62"/><line x1="22" y1="44" x2="98" y2="44"/><path d="M22 90l8 12h76l-8-12"/><rect class="pa-f" x="22" y="76" width="76" height="8"/>',
    tape: '<circle cx="56" cy="58" r="34"/><circle cx="56" cy="58" r="13"/><path class="pa-f" d="M56 92h46v12H56z"/>',
    band: '<rect x="20" y="40" width="80" height="40"/><rect x="34" y="52" width="52" height="16"/><rect class="pa-f" x="20" y="40" width="12" height="40"/>',
    shuttle: '<path d="M42 24h36l-10 54H52z"/><circle cx="60" cy="90" r="13"/><line x1="54" y1="24" x2="57" y2="78"/><line x1="66" y1="24" x2="63" y2="78"/><rect class="pa-f" x="47" y="83" width="26" height="6"/>',
    pump: '<rect x="50" y="30" width="20" height="68"/><line x1="60" y1="16" x2="60" y2="30"/><rect x="38" y="10" width="44" height="8"/><path d="M70 88h20v14"/><rect class="pa-f" x="50" y="58" width="20" height="12"/>'
  };
  const prodArt = p => `<svg viewBox="0 0 120 120" aria-hidden="true">${PART[p.art] || PART.bottle}</svg>`;

  /* ---------- Home ---------- */
  function courtOpen(c) { return c.status === 'AVAILABLE'; }
  function nextOpen(sportId) {
    const courts = (sportId ? IX.courtsBySport[sportId] : V.courts).filter(courtOpen);
    for (let i = 0; i < V.settings.bookingWindowDays; i++) {
      const d = addDays(today(), i);
      for (const h of hoursList()) {
        if (isPast(d, h)) continue;
        const c = courts.find(x => !cellOf(d, x.id, h));
        if (c) return { date: d, h, court: c.id, sport: c.sportId };
      }
    }
    return null;
  }
  const whenLabel = d => (d === today() ? 'Today' : d === addDays(today(), 1) ? 'Tomorrow' : fmtDate(d));
  const grabAttrs = n => `data-action="grab" data-sport="${n.sport}" data-date="${n.date}" data-court="${n.court}" data-h="${n.h}"`;
  function isOpenNow() { const h = fac().hour; return h >= V.settings.openHour && h < V.settings.closeHour; }

  function boardHTML() {
    const t = today(), h = fac().hour, open = isOpenNow();
    const courts = V.courts;
    const freeNow = c => open && courtOpen(c) && !cellOf(t, c.id, h);
    const totalFree = courts.filter(freeNow).length, pct = Math.round(totalFree / courts.length * 100);
    const rows = sportsList().map(s => {
      const list = IX.courtsBySport[s.id], free = list.filter(freeNow).length;
      return `<li><span class="b-name">${esc(s.name)}</span><span class="dots" aria-hidden="true">${list.map(c => `<span class="dot${freeNow(c) ? ' free' : ''}"></span>`).join('')}</span>
        <span class="b-count" aria-hidden="true">${open ? free + '/' + list.length : 'shut'}</span><span class="sr-only">${open ? free + ' of ' + list.length + ' open' : 'Closed'}</span></li>`;
    }).join('');
    return `<div class="board-top"><span class="live-dot${open ? '' : ' off'}"></span>
        <span>${open ? 'Live / ' + fmtHour(h) : 'Closed / opens ' + fmtHour(V.settings.openHour)}</span><span class="board-pct">${pct}<em>%</em></span></div>
      <div class="idx"><strong>${totalFree}<em>/${courts.length}</em></strong>
        <div class="idx-r"><div class="segs" role="img" aria-label="${totalFree} of ${courts.length} venues open">${courts.map(c => `<i class="${freeNow(c) ? 'on' : ''}"></i>`).join('')}</div>
          <p class="board-big">${open ? 'Solid blocks are courts, lanes, and fields free this hour.' : 'Booking stays open for the days ahead.'}</p></div></div>
      <ul>${rows}</ul>`;
  }
  function clockParts() {
    const n = new Date();
    return { time: n.toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' }), date: n.toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', weekday: 'long', month: 'long', day: 'numeric' }) };
  }
  function showcaseHTML() {
    const t = today(), h = fac().hour, open = isOpenNow(), list = sportsList();
    const titles = list.map((s, i) => `<h3 class="sc-title" data-i="${i}">${esc(s.name)}</h3>`).join('');
    const tags = list.map((s, i) => `<p data-i="${i}">${esc(s.tagline)}</p>`).join('');
    const specs = list.map((s, i) => {
      const courts = IX.courtsBySport[s.id], free = courts.filter(c => open && courtOpen(c) && !cellOf(t, c.id, h)).length;
      const tiles = [
        ['Open now', open ? `${free} of ${courts.length} free` : 'Opens ' + fmtHour(V.settings.openHour), open && free ? 'hot' : ''],
        ['Rate', 'From ' + peso(sportRate(s.id)) + ' / hour', ''], ['Venues', plural(courts.length, s.unit), ''],
        ['Size', s.size, ''], ['Surface', s.surface, ''], ['Team booking', 'Up to ' + s.maxPlayers + ' players', '']
      ];
      return `<dl class="specs" data-i="${i}">${tiles.map((x, k) => `<div class="spec" style="--k:${k}"><dt>${x[0]}</dt><dd class="${x[2]}">${esc(x[1])}</dd></div>`).join('')}</dl>`;
    }).join('');
    const arts = list.map((s, i) => `<svg viewBox="0 0 200 120" data-i="${i}" aria-hidden="true">${ART[s.id] || ART.basketball}</svg>`).join('');
    const rail = list.map((s, i) => `<button type="button" class="rail-btn" data-action="sc-jump" data-i="${i}">${esc(s.name)}<i></i></button>`).join('');
    return `<section class="showcase" id="showcase" style="--n:${list.length}" aria-label="Sports and facilities">
        <div class="sc-sticky"><div class="wrap">
          <div class="sc-grid">
            <div class="sc-left">
              <div class="sc-meta"><p class="hud"><span class="tick"></span>Facilities</p><span class="sc-count"><b id="scIdx">01</b> / ${pad(list.length)}</span></div>
              <div class="sc-names" aria-live="polite">${titles}</div>
              <div class="sc-tag">${tags}</div>
              <div class="specs-wrap">${specs}</div>
            </div>
            <div class="stage-wrap"><div class="stage" id="stage">
              <span class="stage-num" id="stageNum" aria-hidden="true">01</span>
              <div class="stage-art">${arts}</div>
              <div class="stage-scan" aria-hidden="true"></div>
              <div class="stage-foot" aria-hidden="true"><span id="stageName">Court map</span><span>Lights until ${fmtHour(V.settings.closeHour)}</span></div>
            </div></div>
          </div>
          <div class="sc-bottom">
            <nav class="sc-rail" aria-label="Jump to a sport">${rail}</nav>
            <div class="sc-cta"><div class="next-slot" id="nextSlot"></div>
              <button type="button" class="book-now magnetic" id="bookNow" data-action="sport" data-sport="${list[0].id}">
                <span class="bn-fill" aria-hidden="true"></span>
                <span class="bn-text"><span>Book now</span><span aria-hidden="true">Play hard</span></span>
                <span class="bn-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg></span>
              </button></div>
          </div>
        </div></div>
      </section>`;
  }
  function fuelHTML() {
    const pick = ['PROD-002', 'PROD-003', 'PROD-007', 'PROD-010'].map(id => IX.product[id]).filter(Boolean);
    if (!pick.length) return '';
    return `<section class="wrap sec" aria-labelledby="fuel-h">
      <div class="sec-head reveal"><div><p class="hud"><span class="tick"></span>Athlete shop</p><h2 id="fuel-h">Fuel up<br>before tip-off.</h2></div>
        <p>Drinks, snacks and court essentials, ready at the front desk. Add them to your reservation or order on their own.</p></div>
      <div class="fuel" id="fuelgrid">${pick.map(pcardHTML).join('')}</div>
      <div class="co-actions"><button type="button" class="btn" data-action="view" data-view="shop">Browse the shop</button></div>
    </section>`;
  }
  function renderHome() {
    const s = V.settings, pol = s.cancellationPolicy, c = clockParts(), n = nextOpen();
    const arrow = '<svg class="arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h15M13 6l6 6-6 6"/></svg>';
    const stats = [[V.courts.length, 'Venues'], [sportsList().length, 'Sports'], [s.closeHour - s.openHour, 'Hours daily'], [s.maxHoursPerBooking, 'Hour max booking']]
      .map(([v, l], i) => `<div class="hs" style="--i:${i}"><strong data-count="${v}">${v}</strong><span>${l}</span></div>`).join('');
    const cancelFact = pol.enabled ? (pol.refundEligible && pol.refundPercentage > 0 ? `Free up to ${pol.minimumHoursBeforeBooking} h before your slot` : 'Online, before your slot starts') : 'Through the front desk';
    return `
      <section class="hero wrap" aria-labelledby="hero-h">
        <div class="hero-in">
          <div>
            <p class="hud"><span class="tick"></span>${esc(s.facilityName)}</p>
            <h1 class="hero-title" id="hero-h" tabindex="-1">
              <span class="ln"><span style="--i:0">Play hard.</span></span>
              <span class="ln"><span style="--i:1">Move</span></span>
              <span class="ln"><span class="red" style="--i:2">forward.</span></span>
            </h1>
            <p class="lede">Reserve a court, lane, or field at Manggahan in under a minute. Watch live availability, pay a small deposit to lock it in, and show your code at the desk.</p>
            <div class="actions">
              <button type="button" class="btn btn-primary magnetic" data-action="view" data-view="${isAdmin() ? 'admin' : 'book'}">${isAdmin() ? 'Open front desk' : 'Book a slot'} ${arrow}</button>
              <button type="button" class="btn magnetic" data-action="sc-jump" data-i="0">Explore sports</button>
            </div>
          </div>
          <div class="widgets">
            <div class="widget w-clock" style="--i:0"><p class="hud">Local time</p><strong id="clock">${c.time}</strong><span id="clockDate">${c.date}</span></div>
            <div class="widget w-next" style="--i:1"><p class="hud">Next open slot</p>
              ${n ? `<strong>${esc(courtLabel(n.court))}</strong><span>${whenLabel(n.date)}, ${fmtRange(n.h, n.h + 1)}</span>
              <button type="button" class="btn btn-sm btn-primary" ${grabAttrs(n)}>Grab it</button>` : '<strong>Fully booked this week</strong>'}
            </div>
            <aside class="board widget" id="board" style="--i:2" aria-label="Current availability">${boardHTML()}</aside>
          </div>
        </div>
        <div class="hero-stats">${stats}</div>
      </section>
      ${showcaseHTML()}
      <section class="wrap sec" aria-labelledby="how-h">
        <div class="sec-head reveal">
          <div><p class="hud"><span class="tick"></span>How it works</p><h2 id="how-h">Four steps<br>to tip-off.</h2></div>
          <p>No calls and no queue at the desk. Your reservation code is all the staff need.</p>
        </div>
        <div class="steps">
          <div class="step reveal"><span class="step-num" aria-hidden="true">01</span><h3>Pick sport and date</h3><p>Choose from today and the next six days. Held and booked hours are marked, so you never guess.</p></div>
          <div class="step reveal"><span class="step-num" aria-hidden="true">02</span><h3>Lock in your hours</h3><p>Sign in and select up to ${s.maxHoursPerBooking} back-to-back hours. We hold the slot for ${s.reservationHoldMinutes} minutes while you pay.</p></div>
          <div class="step reveal"><span class="step-num" aria-hidden="true">03</span><h3>Pay the deposit</h3><p>Pay ${s.depositPercentage}% by GCash, Maya or QR Ph and upload the receipt, or pay cash at the desk.</p></div>
          <div class="step reveal"><span class="step-num" aria-hidden="true">04</span><h3>Show your code</h3><p>Staff verify the deposit and confirm your slot. Show your code and settle the balance before play.</p></div>
        </div>
        <div class="facts reveal">
          <span class="fact"><strong>Deposit</strong>${s.depositPercentage}% confirms your slot</span>
          <span class="fact"><strong>Pay with</strong>GCash, Maya, QR Ph or cash</span>
          <span class="fact"><strong>Discounts</strong>Students 10%, senior and PWD 20%</span>
          <span class="fact"><strong>Cancel</strong>${esc(cancelFact)}</span>
        </div>
      </section>
      ${fuelHTML()}
      <section class="wrap cta-wrap" aria-labelledby="cta-h">
        <div class="cta reveal">
          <div><p class="hud"><span class="tick"></span>Open daily, ${fmtHour(s.openHour)} to ${fmtHour(s.closeHour)}</p><h2 id="cta-h">Play hard. Move forward.</h2></div>
          <button type="button" class="btn btn-primary magnetic" data-action="view" data-view="${isAdmin() ? 'admin' : 'book'}">${isAdmin() ? 'Open front desk' : 'Book a slot'} ${arrow}</button>
        </div>
      </section>`;
  }

  /* ---------- Pinned showcase ---------- */
  let scIdx = -1;
  function scSetActive(i) {
    scIdx = i;
    const sec = document.getElementById('showcase');
    if (!sec) return;
    const s = sportsList()[i];
    sec.querySelectorAll('.sc-title').forEach(el => {
      const k = +el.dataset.i;
      el.classList.toggle('on', k === i); el.classList.toggle('before', k < i);
      el.setAttribute('aria-hidden', k === i ? 'false' : 'true');
    });
    sec.querySelectorAll('.sc-tag p, .specs, .stage-art svg, .rail-btn').forEach(el => el.classList.toggle('on', +el.dataset.i === i));
    $('#scIdx').textContent = pad(i + 1);
    $('#stageNum').textContent = pad(i + 1);
    $('#stageName').textContent = s.name + ' ' + s.unit + ' map';
    const bn = $('#bookNow');
    bn.dataset.sport = s.id;
    bn.setAttribute('aria-label', 'Book ' + s.name.toLowerCase());
    const n = nextOpen(s.id);
    $('#nextSlot').innerHTML = n
      ? `Next open ${s.unit}<strong>${whenLabel(n.date)}, ${fmtHour(n.h)}, ${esc(IX.court[n.court].name)}</strong><button type="button" class="btn btn-sm" ${grabAttrs(n)}>Grab this slot</button>`
      : '<strong>Fully booked this week</strong>';
  }
  function scUpdate() {
    const sec = document.getElementById('showcase');
    if (!sec) { delete document.documentElement.dataset.sport; return; }
    const list = sportsList(), r = sec.getBoundingClientRect();
    const total = Math.max(1, sec.offsetHeight - window.innerHeight);
    const prog = Math.min(1, Math.max(0, -r.top / total)), raw = prog * list.length;
    const i = Math.min(list.length - 1, Math.floor(raw));
    if (i !== scIdx) scSetActive(i);
    sec.querySelectorAll('.rail-btn i').forEach((el, k) => el.style.setProperty('--p', Math.min(1, Math.max(0, raw - k)).toFixed(3)));
    if (r.top < window.innerHeight * 0.5 && r.bottom > window.innerHeight * 0.5) document.documentElement.dataset.sport = list[i].id;
    else delete document.documentElement.dataset.sport;
  }
  function scJump(i) {
    const sec = document.getElementById('showcase');
    if (!sec) return;
    const total = sec.offsetHeight - window.innerHeight;
    window.scrollTo({ top: sec.getBoundingClientRect().top + window.scrollY + (i + 0.35) / sportsList().length * total, behavior: reduceMotion() ? 'auto' : 'smooth' });
  }
  let scTick = false;
  window.addEventListener('scroll', () => {
    $('#top').classList.toggle('solid', window.scrollY > 12);
    if (scTick) return;
    scTick = true;
    requestAnimationFrame(() => { scTick = false; if (S.view === 'home' && V) scUpdate(); });
  }, { passive: true });

  /* ---------- Micro-interactions ---------- */
  let lastMag = null;
  document.addEventListener('pointermove', e => {
    if (e.pointerType !== 'mouse') return;
    const mag = e.target.closest('.magnetic');
    if (lastMag && lastMag !== mag) lastMag.style.transform = '';
    if (mag && !reduceMotion()) {
      const r = mag.getBoundingClientRect();
      mag.style.transform = `translate(${((e.clientX - (r.left + r.width / 2)) * 0.18).toFixed(1)}px, ${((e.clientY - (r.top + r.height / 2)) * 0.25).toFixed(1)}px)`;
    }
    lastMag = mag;
  }, { passive: true });
  function confetti() {
    if (reduceMotion()) return;
    const box = document.createElement('div');
    box.className = 'confetti';
    box.setAttribute('aria-hidden', 'true');
    const colors = ['#FF2D00', '#0B0B0A', '#D8FF00', '#FFFFFF', '#FF2D00'];
    for (let i = 0; i < 40; i++) {
      const p = document.createElement('i'), ang = Math.random() * Math.PI * 2, dist = 140 + Math.random() * 240;
      p.style.setProperty('--x', Math.cos(ang) * dist + 'px');
      p.style.setProperty('--y', Math.sin(ang) * dist - 60 + 'px');
      p.style.setProperty('--r', (Math.random() * 900 - 450) + 'deg');
      p.style.background = colors[i % colors.length];
      p.style.animationDelay = (Math.random() * 0.12) + 's';
      box.appendChild(p);
    }
    $('#dlg').appendChild(box);
    setTimeout(() => box.remove(), 1800);
  }
  function runCountUp() {
    if (!S.countUp) return;
    S.countUp = false;
    if (reduceMotion()) return;
    document.querySelectorAll('[data-count]').forEach(el => {
      const target = Number(el.dataset.count), pre = el.dataset.pre || '', suf = el.dataset.suf || '';
      const fmt = v => pre + Math.round(v).toLocaleString('en-PH') + suf, t0 = performance.now();
      const step = now => { const p = Math.min(1, (now - t0) / 900); el.textContent = fmt(target * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(step); else el.textContent = fmt(target); };
      el.textContent = fmt(0);
      requestAnimationFrame(step);
    });
  }

  /* ---------- Booking grid ---------- */
  function dayStrip(selected, action) {
    const t = today();
    return '<div class="days" role="group" aria-label="Date">' + Array.from({ length: V.settings.bookingWindowDays }, (_, i) => {
      const d = addDays(t, i), dt = parseDate(d);
      return `<button type="button" class="day" data-action="${action}" data-date="${d}" aria-pressed="${d === selected}" aria-label="${esc(fmtDate(d))}">
        <span>${i === 0 ? 'Today' : dt.toLocaleDateString('en-PH', { weekday: 'short' })}</span><strong>${dt.getDate()}</strong><span>${dt.toLocaleDateString('en-PH', { month: 'short' })}</span></button>`;
    }).join('') + '</div>';
  }
  function countOpen(sportId, date) {
    let n = 0;
    (IX.courtsBySport[sportId] || []).filter(courtOpen).forEach(c => hoursList().forEach(h => { if (!isPast(date, h) && !cellOf(date, c.id, h)) n++; }));
    return n;
  }
  function firstOpenDate(sportId) {
    for (let i = 0; i < V.settings.bookingWindowDays; i++) { const d = addDays(today(), i); if (countOpen(sportId, d)) return d; }
    return null;
  }
  function ensureOpenDate() {
    if (S.date !== today() || countOpen(S.sport, S.date)) return;
    const d = firstOpenDate(S.sport);
    if (d && d !== S.date) { S.date = d; S.notice = 'No open ' + IX.sport[S.sport].name.toLowerCase() + ' hours left today, so this shows ' + fmtDate(d) + '.'; }
  }
  const clearSel = () => { S.sel = { court: null, hours: [] }; S.notice = ''; };
  const selCourt = () => (S.sel.court ? IX.court[S.sel.court] : null);

  function quote(court, hours, type) {
    const courtPrice = court.hourlyRate * hours, disc = Math.round(courtPrice * PLAYER_TYPES[type].discount / 100), total = courtPrice - disc;
    const pct = depositPct(court), deposit = Math.round(total * pct / 100);
    return { courtPrice, disc, total, pct, deposit, balance: total - deposit };
  }
  function priceHTML() {
    const c = selCourt();
    if (!c || !S.sel.hours.length) return '<p class="muted">The price appears once you pick a slot.</p>';
    const q = quote(c, S.sel.hours.length, S.form.type), t = PLAYER_TYPES[S.form.type];
    return `<div><span>${peso(c.hourlyRate)} × ${plural(S.sel.hours.length, 'hour')}</span><span>${peso(q.courtPrice)}</span></div>
      ${q.disc ? `<div><span>${t.label} discount (${t.discount}%)</span><span>−${peso(q.disc)}</span></div>` : ''}
      <div><span>Court total</span><span>${peso(q.total)}</span></div>
      <div><span>Balance at the desk</span><span>${peso(q.balance)}</span></div>
      <div class="total"><span>Deposit to confirm, ${q.pct}%</span><span>${peso(q.deposit)}</span></div>`;
  }
  const ferr = k => (S.errors[k] ? `<p class="ferr" id="err-${k}">${esc(S.errors[k])}</p>` : '');
  const inv = k => (S.errors[k] ? ` aria-invalid="true" aria-describedby="err-${k}"` : '');

  function renderBook() {
    if (!IX.sport[S.sport] || !(IX.courtsBySport[S.sport] || []).length) S.sport = sportsList()[0].id;
    if (S.date < today() || S.date > addDays(today(), V.settings.bookingWindowDays - 1)) { S.date = today(); clearSel(); }
    const s = IX.sport[S.sport], courts = IX.courtsBySport[S.sport], sel = S.sel;
    if (sel.court && (IX.court[sel.court].sportId !== S.sport || sel.hours.some(h => isPast(S.date, h) || cellOf(S.date, sel.court, h)))) clearSel();
    const has = !!(sel.court && sel.hours.length), narrow = isNarrow();
    const chips = sportsList().map(x => `<button type="button" class="chip" data-action="sport" data-sport="${x.id}" aria-pressed="${x.id === S.sport}">${esc(x.name)}</button>`).join('');
    let openCount = 0;
    const cellHTML = (c, h) => {
      const key = c.id + '|' + h, occ = cellOf(S.date, c.id, h);
      let st = 'free';
      if (!courtOpen(c)) st = 'closed';
      else if (isPast(S.date, h)) st = 'past';
      else if (occ) st = occ.mine ? 'mine' : occ.s;
      else if (sel.court === c.id && sel.hours.includes(h)) st = 'sel';
      if (st === 'free' || st === 'sel') openCount++;
      const label = { free: 'open', sel: 'selected', taken: 'booked', held: 'temporarily held', pend: 'pending payment', mine: 'your reservation', past: 'unavailable, time has passed', closed: c.status === 'MAINTENANCE' ? 'closed for maintenance' : 'unavailable' }[st];
      const cls = st === 'mine' ? 'taken mine' : st === 'closed' ? 'past closed' : st;
      const tag = { held: 'Hold', pend: 'Pay', mine: 'Yours' }[st];
      const text = narrow ? `<span>${fmtHour(h)}${st === 'sel' ? ' ✓' : ''}</span>${tag ? `<small>${tag}</small>` : ''}` : (st === 'sel' ? '✓' : tag ? `<small>${tag}</small>` : '');
      const dis = st !== 'free' && st !== 'sel';
      return `<button type="button" class="cell ${cls}${st === 'sel' && key === S.focusKey ? ' just' : ''}" data-action="slot" data-court="${c.id}" data-h="${h}" data-key="${key}"
        ${dis ? 'disabled' : `aria-pressed="${st === 'sel'}"`} aria-label="${esc(c.name)}, ${fmtRange(h, h + 1)}, ${label}" title="${esc(c.name)}, ${fmtRange(h, h + 1)}: ${label}">${text}</button>`;
    };
    let grid;
    const facName = c => `${esc(c.name)}${courtOpen(c) ? '' : `<small>${c.status === 'MAINTENANCE' ? 'Maintenance' : 'Unavailable'}</small>`}`;
    if (narrow) grid = courts.map(c => `<div class="fac-block"><h3>${facName(c)}</h3><div class="hour-grid">${hoursList().map(h => cellHTML(c, h)).join('')}</div></div>`).join('');
    else {
      let cells = '<div class="corner"></div>' + hoursList().map(h => `<div class="hd">${fmtHour(h)}</div>`).join('');
      courts.forEach(c => { cells += `<div class="fac">${facName(c)}</div>` + hoursList().map(h => cellHTML(c, h)).join(''); });
      grid = `<div class="scroll-x"><div class="slots" style="grid-template-columns:118px repeat(${hoursList().length},minmax(52px,1fr))">${cells}</div></div>`;
    }
    if (!openCount) {
      const next = firstOpenDate(S.sport);
      grid = `<div class="closed"><p>No open hours left for ${esc(s.name.toLowerCase())} on ${esc(fmtDate(S.date))}.</p>
        ${next ? `<button type="button" class="btn btn-primary" data-action="date" data-date="${next}">Show ${esc(fmtDate(next))}</button>` : '<p>Every slot this week is taken. Try another sport.</p>'}</div>`;
    }
    const c = selCourt(), start = has ? sel.hours[0] : 0, end = has ? sel.hours[sel.hours.length - 1] + 1 : 0;
    const selInfo = has
      ? `<strong>${esc(courtLabel(c.id))}</strong><p>${esc(fmtDate(S.date))}, ${fmtRange(start, end)} (${plural(sel.hours.length, 'hour')})</p>${btn('clear', 'Clear selection', 'btn-ghost')}`
      : `<strong>No slot picked yet</strong><p>Tap an open hour on the grid. Tap the hour before or after it to extend, up to ${V.settings.maxHoursPerBooking} hours.</p>`;
    let panel;
    if (isAdmin()) {
      panel = `<div class="sel-info">${selInfo}</div><p class="notice">Front desk accounts see availability here. Players book from their own accounts, so every reservation stays tied to the person who made it.</p>`;
    } else if (!me()) {
      panel = `<div class="sel-info">${selInfo}</div><div class="price" id="price" aria-live="polite">${priceHTML()}</div>
        <button type="button" class="btn btn-primary block" data-action="to-login">Sign in to reserve</button>
        <p class="hint center">Your selection is kept while you sign in.</p>`;
    } else {
      const f = S.form, u = me();
      panel = `<div class="sel-info">${selInfo}</div>
        <form id="bookForm" novalidate>
          <div class="field"><span class="label">Booking as</span><p class="as-user">${esc(u.firstName + ' ' + u.lastName)} <span class="muted">(${esc(u.username)})</span></p></div>
          <div class="field"><label for="f-phone">Mobile number</label>
            <input id="f-phone" name="phone" type="tel" inputmode="numeric" autocomplete="tel" placeholder="09XX XXX XXXX" value="${esc(f.phone)}"${inv('phone')}>${ferr('phone')}</div>
          <fieldset><legend>Player type</legend><div class="types">${Object.keys(PLAYER_TYPES).map(k => `<label><input type="radio" name="type" value="${k}" ${f.type === k ? 'checked' : ''}>${PLAYER_TYPES[k].label}</label>`).join('')}</div></fieldset>
          <div id="teamFields" ${f.type === 'TEAM' ? '' : 'hidden'}>
            <div class="field"><label for="f-team">Team or league name</label><input id="f-team" name="teamName" type="text" value="${esc(f.teamName)}"${inv('teamName')}>${ferr('teamName')}</div>
            <div class="field"><label for="f-head">Number of players</label><input id="f-head" name="headcount" type="number" min="2" max="${s.maxPlayers}" step="1" value="${esc(f.headcount)}"${inv('headcount')}>
              <p class="hint">${esc(s.name)}: 2 to ${s.maxPlayers} players per ${s.unit}.</p>${ferr('headcount')}</div>
          </div>
          <div class="price" id="price" aria-live="polite">${priceHTML()}</div>
          <button type="submit" class="btn btn-primary block"${S.holdBusy ? ' disabled aria-busy="true"' : ''}>${S.holdBusy ? '<span class="spin" aria-hidden="true"></span>Holding your slot' : 'Continue to review'}</button>
          <p class="hint center">We hold the slot for ${V.settings.reservationHoldMinutes} minutes while you pay the deposit.</p>
        </form>`;
    }
    return `
      <div class="page-head"><p class="hud"><span class="tick"></span>${isAdmin() ? 'Availability' : 'Reservation'}</p>
        <h1 class="page-title" tabindex="-1">${isAdmin() ? 'Court availability' : 'Book a slot'}</h1>
        <p>Choose a sport and date, then pick up to ${V.settings.maxHoursPerBooking} back-to-back hours on one ${esc(s.unit)}.</p></div>
      <div class="book"><div>
        <div class="chips" role="group" aria-label="Sport">${chips}</div>
        ${dayStrip(S.date, 'date')}
        <div class="grid-head"><h2>${esc(s.name)} on ${esc(fmtDate(S.date))}</h2><span class="muted">${plural(openCount, 'open hour')} · from ${peso(sportRate(s.id))} per hour</span></div>
        <div class="grid-card">${grid}
          <div class="legend" aria-hidden="true">
            <span><i class="sw free"></i>Open</span><span><i class="sw sel"></i>Your selection</span>
            <span><i class="sw held"></i>Temporarily held</span><span><i class="sw pend"></i>Pending payment</span>
            <span><i class="sw taken"></i>Booked</span><span><i class="sw past"></i>Time passed or closed</span>
          </div></div>
        <div role="status" aria-live="polite">${S.notice ? `<p class="notice">${esc(S.notice)}</p>` : ''}</div>
        ${S.errors.slot ? `<p class="notice err" id="err-slot" tabindex="-1">${esc(S.errors.slot)}</p>` : ''}
      </div>
      <aside class="panel" aria-labelledby="sum-h"><h2 id="sum-h">Your reservation</h2>${panel}</aside></div>
      ${has && !isAdmin() ? `<div class="bar-spacer"></div><div class="actionbar" id="actionbar">
        <div><strong>${esc(courtLabel(c.id))}</strong><p>${esc(fmtDate(S.date))}, ${fmtRange(start, end)}</p></div>
        <button type="button" class="btn btn-primary" data-action="to-form">${me() ? 'Enter details' : 'Sign in'}</button></div>` : ''}`;
  }
  function clickSlot(court, h) {
    const sel = S.sel, max = V.settings.maxHoursPerBooking;
    S.notice = '';
    if (sel.court !== court || !sel.hours.length) S.sel = { court, hours: [h] };
    else {
      const lo = sel.hours[0], hi = sel.hours[sel.hours.length - 1];
      if (sel.hours.includes(h)) {
        if (h === lo) sel.hours.shift(); else if (h === hi) sel.hours.pop(); else S.sel = { court, hours: [h] };
        if (!S.sel.hours.length) S.sel = { court: null, hours: [] };
      } else if (h === lo - 1 || h === hi + 1) {
        if (sel.hours.length >= max) S.notice = `Bookings are limited to ${max} hours. Remove an end hour or start a new selection.`;
        else { sel.hours.push(h); sel.hours.sort((a, b) => a - b); }
      } else S.sel = { court, hours: [h] };
    }
    delete S.errors.slot;
    S.focusKey = court + '|' + h;
    render();
  }
  async function reserve() {
    const f = S.form, s = IX.sport[S.sport], e = {};
    if (!S.sel.court || !S.sel.hours.length) e.slot = 'Pick at least one open hour on the grid.';
    if (!/^09\d{9}$/.test(normPhone(f.phone))) e.phone = 'Enter a PH mobile number, like 0917 123 4567 or +63 917 123 4567.';
    if (f.type === 'TEAM') {
      if (!f.teamName.trim()) e.teamName = 'Enter the team or league name.';
      const n = Number(f.headcount);
      if (!Number.isInteger(n) || n < 2 || n > s.maxPlayers) e.headcount = 'Enter a whole number from 2 to ' + s.maxPlayers + '.';
    }
    S.errors = e;
    if (Object.keys(e).length) { S.focusSel = e.slot ? '#err-slot' : '[name="' + ['phone', 'teamName', 'headcount'].find(k => e[k]) + '"]'; render(); return; }
    S.holdBusy = true; render();
    const out = await act('reservation.hold', { courtId: S.sel.court, date: S.date, hours: S.sel.hours, playerType: f.type, phone: f.phone, teamName: f.teamName, headcount: f.headcount });
    S.holdBusy = false;
    if (!out.ok) {
      const field = { phone: 'phone', team_name: 'teamName', headcount: 'headcount' }[out.error.code] || 'slot';
      S.errors = { [field]: out.error.message };
      if (['slot_taken', 'past', 'court_closed'].includes(out.error.code)) clearSel();
      S.focusSel = field === 'slot' ? '#err-slot' : '[name="' + field + '"]';
      render();
      return;
    }
    S.co = { id: out.data.reservationId, step: 'review' };
    S.drafts.res = blankDraft();
    clearSel();
    go('checkout');
  }

  /* ---------- Payment parts, shared by reservations and shop orders ---------- */
  function readImage(file, max, type) {
    return new Promise((resolve, reject) => {
      if (!file) return reject('read');
      if (!/^image\/(png|jpe?g|webp)$/i.test(file.type)) return reject('type');
      if (file.size > 10 * 1024 * 1024) return reject('size');
      const fr = new FileReader();
      fr.onerror = () => reject('read');
      fr.onload = () => {
        const img = new Image();
        img.onerror = () => reject('read');
        img.onload = () => {
          const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight)), c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
          const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
          try { resolve(c.toDataURL(type, 0.72)); } catch (e) { reject('read'); }
        };
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  }
  const PROOF_ERR = {
    type: 'That file is not a supported image. Upload a JPG, PNG or WebP screenshot.',
    size: 'That image is over 10 MB. Upload a smaller screenshot.',
    read: 'Payment proof could not be uploaded. Please try again with a JPG or PNG screenshot.'
  };
  function handleProof(el) {
    const d = S.drafts[el.dataset.proof], file = el.files && el.files[0];
    if (!d || !file) return;
    readImage(file, 480, 'image/jpeg').then(url => { d.proof = url; d.proofName = file.name; delete d.err.proof; S.focusSel = '#' + el.id; render(); },
      code => { d.err.proof = PROOF_ERR[code] || PROOF_ERR.read; S.focusSel = '#' + el.id; render(); });
  }
  function qrSVG(seed) {
    const n = 25, r = Core.util.rng(Core.util.hash('qr|' + seed));
    const reserved = (x, y) => (x < 8 && y < 8) || (x >= n - 8 && y < 8) || (x < 8 && y >= n - 8);
    const finder = (x, y) => `M${x} ${y}h7v7h-7zM${x + 1} ${y + 1}v5h5v-5zM${x + 2} ${y + 2}h3v3h-3z`;
    let d = finder(0, 0) + finder(n - 7, 0) + finder(0, n - 7);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (!reserved(x, y) && r() < 0.48) d += `M${x} ${y}h1v1h-1z`;
    return `<svg viewBox="-2 -2 ${n + 4} ${n + 4}" role="img" aria-label="Sample QR code, not a live payment code" shape-rendering="crispEdges"><path class="qr-ink" fill-rule="evenodd" d="${d}"/></svg>`;
  }
  const sampleProof = () => '<svg viewBox="0 0 90 120" aria-hidden="true"><rect class="sp-bg" width="90" height="120"/><rect class="sp-acc" x="10" y="12" width="70" height="14"/><rect class="sp-ink" x="10" y="36" width="50" height="5"/><rect class="sp-ink" x="10" y="48" width="64" height="5"/><rect class="sp-ink" x="10" y="60" width="40" height="5"/><rect class="sp-ink" x="10" y="80" width="70" height="10"/><text class="sp-t" x="45" y="108" text-anchor="middle">NO IMAGE</text></svg>';
  function validatePay(d) {
    const e = {};
    if (!d.method) e.method = 'Choose how you want to pay.';
    else if (d.method !== 'CASH') {
      const ref = String(d.ref || '').replace(/[\s-]/g, '').toUpperCase();
      if (!ref) e.ref = 'Enter the reference number from your receipt.';
      else if (!/^[A-Z0-9]{6,20}$/.test(ref)) e.ref = 'Reference numbers are 6 to 20 letters or digits. Check your receipt and try again.';
      if (!d.proof) e.proof = 'Upload a screenshot or photo of your payment receipt.';
    }
    return e;
  }
  function applyPayError(d, out) {
    const code = out.error.code || '';
    const k = /^ref/.test(code) ? 'ref' : /^proof/.test(code) ? 'proof' : code === 'method_required' ? 'method' : code === 'name' ? 'name' : code === 'phone' ? 'mobile' : 'form';
    d.err = { [k]: out.error.message };
    return k;
  }
  function methodTiles(ctx, d, kind) {
    const tile = id => { const m = METHOD[id], counter = m.kind === 'counter';
      return `<label class="mtile"><input type="radio" name="method-${ctx}" value="${id}"${d.method === id ? ' checked' : ''}${d.busy ? ' disabled' : ''}>
        <span class="m-mark" aria-hidden="true">${m.mark}</span><span><strong>${esc(counter && kind === 'order' ? 'Pay at the counter' : m.label)}</strong><small>${esc(counter && kind === 'order' ? 'Cash when you collect' : m.note)}</small></span></label>`; };
    return `<fieldset class="methods"${d.err.method ? ` aria-describedby="err-method-${ctx}"` : ''}><legend>Payment method</legend>
      <div class="m-group"><p>Pay online</p><div class="mtiles">${['GCASH', 'MAYA', 'QRPH'].map(tile).join('')}</div></div>
      <div class="m-group"><p>${kind === 'order' ? 'Pay at the counter' : 'Pay at the front desk'}</p><div class="mtiles one">${tile('CASH')}</div></div>
      ${d.err.method ? `<p class="ferr" id="err-method-${ctx}">${esc(d.err.method)}</p>` : ''}</fieldset>`;
  }
  function payDetailsHTML(ctx, d, amount, kind) {
    const m = METHOD[d.method];
    if (!m) return '<p class="hint flush">Choose a payment method to see how to pay.</p>';
    const due = `<div class="due"><span>${kind === 'order' ? 'Order total' : 'Due now'}</span><strong>${peso2(amount)}</strong></div>`;
    const submit = label => `<button type="submit" class="btn btn-primary block"${d.busy ? ' disabled aria-busy="true"' : ''}>${d.busy ? '<span class="spin" aria-hidden="true"></span>Submitting' : label}</button>`;
    const acc = V.settings.paymentAccounts;
    if (m.kind === 'counter') {
      if (kind === 'order') return `${due}<div class="cash-card"><p class="big">Pay ${peso2(amount)} when you collect</p><p>Your order waits at the front desk. Staff mark it paid when you hand over the cash.</p></div>${submit('Place order')}`;
      const mins = V.settings.cashPaymentMinutes;
      return `${due}<div class="cash-card"><p class="big">Pay ${peso2(amount)} at the front desk within ${mins} minutes</p>
        <p>Your slot will remain pending until the required deposit has been verified by the facility staff.</p>
        <p>If the deposit isn't paid by about ${fmtClock(Date.now() + mins * 60000)}, the slot is released for other players.</p></div>${submit('Reserve and pay at the desk')}`;
    }
    let how;
    if (m.kind === 'qr') {
      const q = acc.qrph;
      how = `<div class="qr-wrap"><div class="qr">${q.qrImage ? `<img src="${esc(q.qrImage)}" alt="QR Ph code for ${esc(q.merchantName)}">` : qrSVG(q.merchantName) + '<span class="qr-tag">Sample QR</span>'}</div>
          <ol class="paysteps"><li>Open your bank or e-wallet app and choose Scan QR.</li><li>Pay exactly <b>${peso2(amount)}</b> to ${esc(q.merchantName)}.</li><li>Screenshot the confirmation, then upload it below with the reference number.</li></ol></div>
        ${q.qrImage ? '' : placeholderNote('This is a sample code, not a live QR Ph merchant code. Staff upload the facility code in Front desk, Settings.')}`;
    } else {
      const a = acc[d.method.toLowerCase()], unset = /x/i.test(a.number);
      how = `<ol class="paysteps"><li>Open ${m.label} and send exactly <b>${peso2(amount)}</b> to:</li></ol>
        <dl class="acct"><div><dt>${m.label} number</dt><dd><span class="mono">${esc(a.number)}</span>${unset ? '' : btn('copy', 'Copy', 'btn-ghost', { ref: a.number.replace(/\s/g, '') })}</dd></div>
          <div><dt>Account name</dt><dd>${esc(a.name)}</dd></div></dl>
        ${unset ? placeholderNote(`No ${m.label} account is set up yet. Staff add the facility number in Front desk, Settings.`) : ''}
        <ol class="paysteps" start="2"><li>Screenshot the receipt, then upload it below with the reference number.</li></ol>`;
    }
    const off = d.busy ? ' disabled' : '';
    return `${due}${how}
      <div class="field"><label for="ref-${ctx}">Reference number</label>
        <input id="ref-${ctx}" name="ref" type="text" autocomplete="off" spellcheck="false" data-draft="${ctx}" value="${esc(d.ref)}"${off}${d.err.ref ? ` aria-invalid="true" aria-describedby="err-ref-${ctx}"` : ` aria-describedby="hint-ref-${ctx}"`}>
        <p class="hint" id="hint-ref-${ctx}">${esc(m.refHint)}</p>${d.err.ref ? `<p class="ferr" id="err-ref-${ctx}">${esc(d.err.ref)}</p>` : ''}</div>
      <div class="field"><span class="label" id="lbl-proof-${ctx}">Payment screenshot</span>
        <label class="drop${d.err.proof ? ' bad' : ''}" for="proof-${ctx}">
          ${d.proof ? `<img src="${esc(d.proof)}" alt="">` : '<span class="drop-ico" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 16V4M6 10l6-6 6 6M4 20h16"/></svg></span>'}
          <span><strong>${d.proof ? esc(d.proofName || 'Screenshot attached') : 'Upload payment screenshot'}</strong><small>${d.proof ? 'Choose another image to replace it' : 'JPG, PNG or WebP, up to 10 MB'}</small></span></label>
        <input class="sr-only" id="proof-${ctx}" type="file" accept="image/png,image/jpeg,image/webp" data-proof="${ctx}" aria-labelledby="lbl-proof-${ctx}"${off}${d.err.proof ? ` aria-invalid="true" aria-describedby="err-proof-${ctx}"` : ''}>
        ${d.err.proof ? `<p class="ferr" id="err-proof-${ctx}">${esc(d.err.proof)}</p>` : ''}</div>
      ${submit('Submit payment')}`;
  }
  const firstErrSel = (ctx, e) => (e.form ? '#err-form-' + ctx : e.name ? '#' + ctx + '-name' : e.mobile ? '#' + ctx + '-mobile' : e.method ? `[name="method-${ctx}"]` : e.ref ? '#ref-' + ctx : '#proof-' + ctx);

  /* ---------- Checkout ---------- */
  const coRes = () => (S.co ? IX.res[S.co.id] : null);
  function stepsBar(cur) {
    return `<ol class="stepsbar" aria-label="Booking progress">${['Slot', 'Review', 'Payment', 'Verification'].map((l, k) => {
      const n = k + 1, done = n < cur;
      return `<li${done ? ' class="done"' : ''}${n === cur ? ' aria-current="step"' : ''}><b aria-hidden="true">${done ? '✓' : n}</b><span>${done ? '<span class="sr-only">Done: </span>' : ''}${l}</span></li>`;
    }).join('')}</ol>`;
  }
  const dueNow = r => r.depositRequired + (r.addonTotal || 0);
  function summaryHTML(r) {
    const c = IX.court[r.courtId];
    return `<dl class="sum">
      <div><dt>Court</dt><dd>${esc(courtLabel(r.courtId))}</dd></div>
      <div><dt>Date</dt><dd>${esc(fmtLong(r.date))}</dd></div>
      <div><dt>Time</dt><dd>${fmtRange(r.start, r.end)}</dd></div>
      <div><dt>Booked by</dt><dd>${esc(r.teamName ? r.teamName + ' (' + r.customerName + ')' : r.customerName)}</dd></div>
      <div class="sub"><dt>Court price</dt><dd>${peso(c.hourlyRate)} × ${plural(r.hours, 'hour')} = ${peso(r.courtPrice)}</dd></div>
      ${r.discountAmount ? `<div class="neg sub"><dt>${esc(PLAYER_TYPES[r.playerType].label)} discount</dt><dd>−${peso(r.discountAmount)}</dd></div>` : ''}
      <div><dt>Required deposit (${r.depositPercentage}%)</dt><dd>${peso(r.depositRequired)}</dd></div>
      <div><dt>Remaining balance</dt><dd>${peso(r.remainingBalance)}</dd></div>
      <div><dt>Optional shop items</dt><dd>${r.addonTotal ? peso(r.addonTotal) : 'None'}</dd></div>
      <div class="key"><dt>Amount due now</dt><dd>${peso(dueNow(r))}</dd></div>
    </dl>`;
  }
  function dueCardHTML(r, step, canBack) {
    return `<section class="sheet" aria-labelledby="due-h"><h2 id="due-h">Amount due now</h2><div class="sheet-in">
      <dl class="sum"><div><dt>Deposit (${r.depositPercentage}%)</dt><dd>${peso(r.depositRequired)}</dd></div>
        ${r.addonTotal ? `<div><dt>Drinks and snacks</dt><dd>${peso(r.addonTotal)}</dd></div>` : ''}
        <div class="key"><dt>Due now</dt><dd>${peso(dueNow(r))}</dd></div></dl>
      <div class="sum-split"><div><span>Court total</span><strong>${peso(r.totalPrice)}</strong></div><div><span>Balance at desk</span><strong>${peso(r.remainingBalance)}</strong></div></div>
      ${step === 'review' ? btn('co-next', 'Continue to payment', 'btn-primary block') : canBack ? btn('co-back', 'Back to review', 'btn-ghost block') : ''}
    </div></section>`;
  }
  function addonsHTML(r) {
    const list = V.products.filter(p => p.addon && p.status === 'ACTIVE');
    return `<div class="addons">${list.map(p => {
      const line = (r.addonItems || []).find(l => l.productId === p.id), q = line ? line.qty : 0;
      return `<div class="addon${q ? ' on' : ''}${p.stock <= 0 ? ' is-out' : ''}">
        <div class="p-art">${prodArt(p)}</div>
        <div class="row"><h3>${esc(p.name)}</h3><strong class="p-price">${peso(p.price)}</strong></div>
        <div class="row">${p.stock <= 0 ? '<span class="stock out">Out of stock</span>' : `<span class="p-sub">${esc(p.description)}</span>`}
          <div class="qty sm" role="group" aria-label="${esc(p.name)}, quantity">
            <button type="button" data-action="addon" data-id="${p.id}" data-step="-1" aria-label="Remove one ${esc(p.name)}"${q && !S.addonBusy ? '' : ' disabled'}>−</button><output>${q}</output>
            <button type="button" data-action="addon" data-id="${p.id}" data-step="1" aria-label="Add one ${esc(p.name)}"${q < p.stock && !S.addonBusy ? '' : ' disabled'}>+</button></div></div>
      </div>`;
    }).join('')}</div>`;
  }
  const coHead = (title, sub) => `<div class="page-head"><p class="hud"><span class="tick"></span>Checkout</p><h1 class="page-title" tabindex="-1">${title}</h1>${sub ? `<p>${sub}</p>` : ''}</div>`;
  function renderCheckout() {
    if (!isPlayer()) return deniedHTML('Checkout is for player accounts.');
    const r = coRes();
    if (!r) return coHead('Nothing on hold') + `<div class="empty"><h2>No reservation is waiting for payment.</h2><p>Pick a slot to start one.</p>${btn('view', 'Find a court', 'btn-primary', { view: 'book' })}</div>`;
    if (r.status === 'EXPIRED' || r.status === 'CANCELLED') {
      return coHead('This slot is no longer held') + `<div class="banner wait"><div><h2>${r.status === 'EXPIRED' ? 'The hold ran out' : 'Reservation cancelled'}</h2>
        <p>This slot is no longer held for you. Please choose another time, or the same one if nobody has taken it yet.</p></div>${btn('rebook', 'Choose a time', 'btn-primary', { id: r.id })}</div>`;
    }
    if (S.co.step === 'done' || r.status !== 'PENDING_PAYMENT') return resultHTML(r);
    const left = msUntil(r.holdExpiresAt), pay = r.payment;
    const msg = r.paymentStatus === 'UNPAID'
      ? `Slot held for <strong data-until="${esc(r.holdExpiresAt)}">${mmss(left)}</strong>. Pay the deposit before the timer runs out or the slot goes back on the schedule.`
      : r.paymentStatus === 'PENDING' ? `Cash deposit due at the desk by <strong>${fmtClock(r.holdExpiresAt)}</strong>. You can pay online instead below.`
        : `${esc(pay && pay.note ? pay.note : 'Your last payment could not be verified.')} Resubmit within <strong data-until="${esc(r.holdExpiresAt)}">${mmss(left)}</strong> to keep the slot.`;
    const holdbar = `<div class="holdbar${left < 180000 ? ' urgent' : ''}"><p>${msg}</p>
      ${r.paymentStatus === 'UNPAID' ? btn('release', 'Release slot', 'btn-ghost', { id: r.id }) : btn('cancel', 'Cancel booking', 'btn-ghost', { id: r.id })}</div>
      <p class="sr-only" id="holdAnnounce" aria-live="polite"></p>`;
    if (S.co.step === 'review' && r.paymentStatus === 'UNPAID') {
      return coHead('Review reservation', 'Check the details, add drinks or snacks for the game, then pay the deposit.') + stepsBar(2) + holdbar +
        `<div class="co"><div>
          <section class="sheet" aria-labelledby="sum-h"><h2 id="sum-h">Reservation summary</h2><div class="sheet-in">${summaryHTML(r)}</div></section>
          <section class="sheet" aria-labelledby="add-h"><header><h2 id="add-h">Add drinks and snacks</h2><span class="hud">Optional</span></header>
            <div class="sheet-in"><p class="hint lead-hint">Paid with your deposit and waiting at the front desk. Skip this to book the court only.</p>${addonsHTML(r)}</div></section>
        </div><aside class="co-aside">${dueCardHTML(r, 'review')}</aside></div>`;
    }
    const d = S.drafts.res;
    return coHead('Pay the deposit', `${r.depositPercentage}% of the court total confirms your slot once staff verify it. The ${peso(r.remainingBalance)} balance is paid at the desk before play.`) +
      stepsBar(3) + holdbar +
      `<div class="co"><form id="payForm" class="sheet" novalidate aria-labelledby="pay-h"><h2 id="pay-h">Payment</h2><div class="sheet-in">
        ${d.err.form ? `<p class="notice err form-err" id="err-form-res" tabindex="-1">${esc(d.err.form)}</p>` : ''}
        ${methodTiles('res', d, 'res')}<div class="paybox">${payDetailsHTML('res', d, dueNow(r), 'res')}</div>
      </div></form><aside class="co-aside">${dueCardHTML(r, 'pay', r.paymentStatus === 'UNPAID')}</aside></div>`;
  }
  function resultHTML(r) {
    const p = r.payment || {}, m = METHOD[p.method];
    let mark, title, lead, next, step = 4;
    if (['CONFIRMED', 'CHECKED_IN', 'COMPLETED'].includes(r.status)) {
      mark = ['ok', '✓']; title = 'Reservation confirmed'; step = 5;
      lead = `Staff verified your deposit. Show code ${esc(r.id)} at the front desk.`;
      next = [`Pay the ${peso(r.remainingBalance)} balance at the front desk before play.`, 'Your pass and receipt are in My reservations.'];
    } else if (r.status === 'PENDING_PAYMENT' && r.paymentStatus === 'PENDING') {
      mark = ['wait', '₱']; title = 'Awaiting cash deposit';
      lead = `Pay ${peso2(p.amount)} at the front desk by ${fmtClock(r.holdExpiresAt)}. Your slot will remain pending until the required deposit has been verified by the facility staff.`;
      next = [`Give the desk your code ${esc(r.id)}.`, 'Staff record the cash and your reservation is confirmed.', `If the deposit isn't paid by ${fmtClock(r.holdExpiresAt)}, the slot is released.`];
    } else {
      mark = ['wait', '…']; title = 'Payment submitted';
      lead = `We're verifying your ${esc(m ? m.label : '')} payment of ${peso2(p.amount || 0)}. Your slot stays locked while staff check it.`;
      next = ['Staff match your reference number and screenshot, usually within 15 minutes during opening hours.', 'Once verified, your reservation is confirmed and you get a notification.', `Pay the ${peso(r.remainingBalance)} balance at the front desk before play.`];
    }
    return `<div class="result">${stepsBar(step)}
      <div class="result-mark ${mark[0]}" aria-hidden="true">${mark[1]}</div>
      <p class="hud"><span class="tick"></span>Reservation ${esc(r.id)}</p>
      <h1 class="page-title" tabindex="-1">${title}</h1><p class="lead">${lead}</p>
      <div class="statusgrid">
        <div><span>Reservation</span>${resBadge(r)}</div><div><span>Payment</span>${payBadge(r.paymentStatus)}</div>
        <div><span>Reservation ID</span><strong class="mono">${esc(r.id)}</strong></div><div><span>Court</span><strong>${esc(courtLabel(r.courtId))}</strong></div>
        <div><span>When</span><strong>${esc(fmtDate(r.date))}, ${fmtRange(r.start, r.end)}</strong></div>
        <div><span>${p.method === 'CASH' && p.status !== 'PAID' ? 'Due at desk' : 'Paid now'}</span><strong>${peso(p.amount || dueNow(r))}</strong></div>
        <div><span>Balance at desk</span><strong>${peso(r.remainingBalance)}</strong></div>
      </div>
      <h2 class="sub-h">What happens next</h2><ol class="next-list">${next.map(x => `<li>${x}</li>`).join('')}</ol>
      <div class="co-actions">${btn('view', 'Book another slot', '', { view: 'book' })}${btn('view', 'View my reservations', 'btn-primary', { view: 'mine' })}</div></div>`;
  }
  function openCheckout(id) {
    const r = IX.res[id];
    if (!r || r.status !== 'PENDING_PAYMENT') { toast('This reservation no longer needs payment.'); render(); return; }
    S.co = { id, step: r.paymentStatus === 'UNPAID' ? 'review' : 'pay' };
    S.drafts.res = blankDraft();
    go('checkout');
  }
  async function changeAddon(id, step) {
    const r = coRes();
    if (!r || S.addonBusy) return;
    const items = (r.addonItems || []).map(l => ({ productId: l.productId, qty: l.qty }));
    const line = items.find(l => l.productId === id);
    if (line) line.qty += step; else if (step > 0) items.push({ productId: id, qty: step });
    S.addonBusy = true;
    const out = await act('reservation.addons', { reservationId: r.id, items: items.filter(l => l.qty > 0) });
    S.addonBusy = false;
    if (!out.ok) toast(out.error.message);
    S.focusSel = `[data-action="addon"][data-id="${id}"][data-step="${step}"]:not(:disabled)`;
    render();
  }
  async function submitResPayment() {
    const r = coRes(), d = S.drafts.res;
    if (!r) return;
    d.err = validatePay(d);
    if (Object.keys(d.err).length) { S.focusSel = firstErrSel('res', d.err); render(); return; }
    d.busy = true; render();
    const out = await act('payment.submit', { reservationId: r.id, method: d.method, referenceNumber: d.ref, proof: d.method === 'CASH' ? null : { fileName: d.proofName, dataUrl: d.proof } });
    d.busy = false;
    if (!out.ok) { S.focusSel = firstErrSel('res', { [applyPayError(d, out)]: 1 }); render(); return; }
    S.co.step = 'done';
    render();
    window.scrollTo(0, 0);
    const h = $('#app h1'); if (h) h.focus({ preventScroll: true });
  }

  /* ---------- Dialog plumbing ---------- */
  function openDlg(html, cls) {
    const dlg = $('#dlg');
    dlg.className = cls || '';
    dlg.innerHTML = html;
    if (!dlg.open) { if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', ''); }
    const f = dlg.querySelector('[data-autofocus]') || dlg.querySelector('[data-action="close"]');
    if (f) f.focus();
  }
  function closeDlg() {
    const dlg = $('#dlg');
    if (!dlg.open) return;
    if (typeof dlg.close === 'function') dlg.close(); else dlg.removeAttribute('open');
    S.cx = null;
  }
  const isFramed = () => { try { return window.self !== window.top; } catch (e) { return true; } };
  function copyText(el, value) {
    const say = t => { el.textContent = t; };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(value).then(() => say('Copied'), () => say('Copy blocked'));
      else say('Copy blocked');
    } catch (e) { say('Copy blocked'); }
  }

  /* ---------- My reservations ---------- */
  const ended = r => r.date < today() || (r.date === today() && r.end <= fac().hour);
  const LIVE = ['PENDING_PAYMENT', 'PAYMENT_VERIFICATION', 'CONFIRMED', 'CHECKED_IN'];
  function refundHint(r) {
    const pol = V.settings.cancellationPolicy;
    if (!r.canCancel || !pol.refundEligible || !pol.refundPercentage || !r.payment || !['PAID', 'AWAITING_VERIFICATION'].includes(r.payment.status)) return '';
    return msUntil(r.refundDeadline) > 0 ? `Refund-eligible cancellation until ${fmtStamp(r.refundDeadline)}.` : 'Cancelling now is not refunded under the current cancellation policy.';
  }
  function reservationCard(r) {
    const dt = parseDate(r.date), p = r.payment, can = r.cancellation, acts = [btn('details', 'View', '', { id: r.id })];
    if (r.status === 'PENDING_PAYMENT') acts.push(btn('pay-open', r.paymentStatus === 'PENDING' ? 'Pay online instead' : r.paymentStatus === 'FAILED' ? 'Resubmit payment' : 'Complete payment', 'btn-primary', { id: r.id }));
    if (r.status === 'CONFIRMED' || r.status === 'CHECKED_IN') acts.push(btn('ticket', 'Show pass', '', { id: r.id }));
    if (p && ['PAID', 'REFUNDED', 'PARTIALLY_REFUNDED'].includes(p.status)) acts.push(btn('receipt', 'Receipt', 'btn-ghost', { id: r.id }));
    if (r.canCancel) acts.push(btn('cancel', 'Cancel booking', 'btn-ghost', { id: r.id }));
    let note = '';
    if (r.status === 'PENDING_PAYMENT' && r.paymentStatus === 'UNPAID') note = `Slot held for <strong data-until="${esc(r.holdExpiresAt)}">${mmss(msUntil(r.holdExpiresAt))}</strong>. Pay the ${peso(r.depositRequired)} deposit to keep it.`;
    else if (r.status === 'PENDING_PAYMENT' && r.paymentStatus === 'PENDING') note = `Pay ${peso(p.amount)} at the front desk by ${fmtClock(r.holdExpiresAt)}. The slot stays pending until staff verify the deposit.`;
    else if (r.status === 'PENDING_PAYMENT') note = `${esc(p && p.note ? p.note : 'Your payment needs attention.')} Resubmit within <strong data-until="${esc(r.holdExpiresAt)}">${mmss(msUntil(r.holdExpiresAt))}</strong> to keep the slot.`;
    else if (r.status === 'PAYMENT_VERIFICATION') note = `Staff are checking your ${esc(METHOD[p.method].label)} payment of ${peso(p.amount)}. You'll get a notification once it's confirmed.`;
    else if (r.status === 'CONFIRMED') note = `Deposit paid. Pay the ${peso(r.remainingBalance)} balance at the front desk before play. ${refundHint(r)}`;
    else if (r.status === 'EXPIRED') note = 'The hold ran out before payment, so the slot went back on the schedule.';
    else if (r.status === 'CANCELLED' && can) note = `Reason: ${esc(can.reasonText)}. ${can.refundStatus === 'NOT_ELIGIBLE' ? 'Not refunded under the cancellation policy.' : can.refundStatus === 'NOT_APPLICABLE' ? 'Nothing was paid, so there is nothing to refund.' : `Refund ${peso(can.refundAmount)}: ${esc(REFUND_LABEL[can.refundStatus].toLowerCase())}.`}`;
    return `<article class="bk${['CANCELLED', 'EXPIRED'].includes(r.status) ? ' dim' : ''}">
      <div class="bk-date"><span>${dt.toLocaleDateString('en-PH', { weekday: 'short' })}</span><strong>${dt.getDate()}</strong><span>${dt.toLocaleDateString('en-PH', { month: 'short' })}</span></div>
      <div class="bk-main">
        <div class="bk-badges">${resBadge(r)}${payBadge(r.paymentStatus)}${can ? refundBadge(can.refundStatus) : ''}</div>
        <h3>${esc(courtLabel(r.courtId))}</h3>
        <p>${fmtRange(r.start, r.end)} · ${esc(PLAYER_TYPES[r.playerType].label)} · Court ${peso(r.totalPrice)}${r.addonTotal ? ' · Snacks ' + peso(r.addonTotal) : ''}</p>
        <p>Code <span class="ref">${esc(r.id)}</span></p>
        ${note ? `<p class="bk-note">${note}</p>` : ''}
      </div>
      <div class="bk-actions">${acts.join('')}</div></article>`;
  }
  function renderMine() {
    if (!isPlayer()) return deniedHTML('My reservations is for player accounts.');
    const list = V.reservations.slice().sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);
    const upcoming = list.filter(r => LIVE.includes(r.status) && !ended(r));
    const rest = list.filter(r => !upcoming.includes(r)).reverse();
    const u = me();
    const head = `<div class="page-head head-row"><div><p class="hud"><span class="tick"></span>${esc(u.firstName + ' ' + u.lastName)}</p><h1 class="page-title" tabindex="-1">My reservations</h1>
      <p>A slot is confirmed once staff verify the deposit. Cancelled bookings stay here with their reason and refund status.</p></div>${btn('view', 'Profile', '', { view: 'profile' })}</div>`;
    const orders = V.orders.length ? `<h2 class="sub-h">Shop orders</h2><div class="orders">${V.orders.slice().reverse().map(o => orderCard(o, false)).join('')}</div>` : '';
    if (!list.length) return head + `<div class="empty"><h2>No reservations yet.</h2><p>Book your first court and start playing.</p>${btn('view', 'Find a court', 'btn-primary', { view: 'book' })}</div>` + orders;
    return head + '<h2 class="sub-h first">Upcoming</h2>' +
      (upcoming.length ? `<div class="bk-list">${upcoming.map(reservationCard).join('')}</div>` : `<div class="empty"><p>No upcoming reservations.</p>${btn('view', 'Find a court', 'btn-primary', { view: 'book' })}</div>`) +
      (rest.length ? `<h2 class="sub-h">Past and cancelled</h2><div class="bk-list">${rest.map(reservationCard).join('')}</div>` : '') + orders;
  }

  /* ---------- Reservation details ---------- */
  function row(k, v) { return `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`; }
  function detailsHTML(r) {
    const p = r.payment, c = r.cancellation, staff = isAdmin();
    const who = r.userId && IX.user ? IX.user[r.userId] : null;
    let body = row('Reservation ID', `<span class="mono">${esc(r.id)}</span>`) + row('Court', esc(courtLabel(r.courtId))) + row('Date', esc(fmtLong(r.date))) + row('Time', fmtRange(r.start, r.end));
    if (staff) body += row('Booked by', esc(r.customerName) + (who ? ` <span class="muted">(${esc(who.username)})</span>` : ' <span class="muted">(walk-in)</span>') + (r.customerPhone ? '<br>' + esc(r.customerPhone) : ''));
    body += row('Player type', esc(PLAYER_TYPES[r.playerType].label) + (r.teamName ? ', ' + esc(r.teamName) : '') + (r.headcount ? `, ${r.headcount} players` : ''));
    body += row('Original price', peso(r.courtPrice)) + (r.discountAmount ? row('Discount', '−' + peso(r.discountAmount)) : '') + row('Court total', peso(r.totalPrice));
    body += row(`Deposit (${r.depositPercentage}%)`, peso(r.depositRequired)) + row('Remaining balance', peso(r.remainingBalance));
    (r.addonItems || []).forEach(l => { body += row(`${l.qty} × ${l.name}`, peso(l.unitPrice * l.qty)); });
    body += row('Status', resBadge(r)) + row('Payment', payBadge(r.paymentStatus) + (p ? ` <span class="muted">${esc(METHOD[p.method].label)}${p.referenceNumber ? ', ref ' + esc(p.referenceNumber) : ''}</span>` : ''));
    if (r.checkInStatus === 'CHECKED_IN') body += row('Check-in', 'Checked in' + (r.checkedInAt ? ' ' + esc(fmtStamp(r.checkedInAt)) : ''));
    else if (r.status === 'COMPLETED') body += row('Check-in', 'Not checked in');
    if (c) {
      body += row('Cancelled', esc(fmtDayStamp(c.cancelledAt)) + ` <span class="muted">${esc(fmtClock(c.cancelledAt))}, by ${c.cancelledBy === 'ADMIN' ? 'the front desk' : 'the player'}</span>`);
      body += row('Reason', esc(c.reasonText)) + row('Amount paid', peso(c.amountPaid)) + row('Refund', refundBadge(c.refundStatus) + (c.refundAmount ? ' ' + peso(c.refundAmount) : ''));
      if (c.notes) body += row('Staff note', esc(c.notes));
    }
    return body;
  }
  function showDetails(id) {
    const r = IX.res[id];
    if (!r) return;
    const acts = [];
    if (!isAdmin() && (r.status === 'CONFIRMED' || r.status === 'CHECKED_IN')) acts.push(btn('ticket', 'Show pass', '', { id: r.id }));
    if (r.canCancel) acts.push(btn('cancel', 'Cancel booking', 'btn-ghost', { id: r.id }));
    openDlg(`<div class="t-top"><div class="t-tag"><span>Athletica Manggahan</span><span>${esc(r.id)}</span></div><h2 id="dlg-title">Reservation details</h2></div>
      <dl class="t-body">${detailsHTML(r)}</dl>
      <div class="t-actions">${acts.join('')}<button type="button" class="btn btn-primary" data-action="close">Close</button></div>`, 'details-dlg');
  }

  /* ---------- Pass and receipt ---------- */
  function showTicket(r) {
    const rr = Core.util.rng(Core.util.hash(r.id));
    let bars = '';
    for (let i = 0; i < 44; i++) bars += `<i style="width:${1 + Math.floor(rr() * 4)}px"></i><b style="width:${1 + Math.floor(rr() * 3)}px"></b>`;
    openDlg(`<div class="t-top"><div class="t-tag"><span>Athletica Manggahan</span><span>Admit ${r.playerType === 'TEAM' ? 'team' : 'one'}</span></div>
        <h2 id="dlg-title"><span class="t-check" aria-hidden="true">✓</span>Reservation confirmed</h2>
        <div class="t-ref-row"><span class="t-ref">${esc(r.id)}</span></div><p>Reservation ID. Show it at the front desk.</p>
        ${btn('copy', 'Copy code', '', { ref: r.id })}</div>
      <div class="perf" aria-hidden="true"></div>
      <dl class="t-body">${row('Venue', esc(courtLabel(r.courtId)))}${row('Date', esc(fmtDate(r.date)))}${row('Time', fmtRange(r.start, r.end))}${row('Booked by', esc(r.customerName))}
        ${row('Deposit paid', peso(r.depositRequired))}${r.addonTotal ? row('Drinks and snacks', peso(r.addonTotal)) : ''}${row('Remaining balance', r.status === 'CHECKED_IN' ? 'Settled' : peso(r.remainingBalance))}</dl>
      <div class="bc" aria-hidden="true">${bars}</div>
      <p class="t-note">${r.status === 'CHECKED_IN' ? 'Checked in. Enjoy the game.' : `Pay the ${peso(r.remainingBalance)} balance at the front desk before play.`}${PLAYER_TYPES[r.playerType].discount ? ' Bring a valid ID for your discount.' : ''}</p>
      <div class="t-actions">${btn('receipt', 'Receipt', 'btn-ghost', { id: r.id })}<button type="button" class="btn btn-primary" data-action="close">Done</button></div>`);
    const seen = 'athletica-celebrated';
    const done = (ls.get(seen) || '').split(',');
    if (!done.includes(r.id)) { ls.set(seen, done.concat(r.id).slice(-50).join(',')); confetti(); }
  }
  function receiptRows(r) {
    const p = r.payment || {}, rows = [['Reservation', r.id], ['Court', courtLabel(r.courtId)], ['Date', fmtLong(r.date)], ['Time', fmtRange(r.start, r.end)], ['Booked by', r.customerName],
      ['Court price', peso(IX.court[r.courtId].hourlyRate) + ' × ' + plural(r.hours, 'hour')]];
    if (r.discountAmount) rows.push([PLAYER_TYPES[r.playerType].label + ' discount', '−' + peso(r.discountAmount)]);
    rows.push(['Court total', peso(r.totalPrice)], [`Deposit paid (${r.depositPercentage}%)`, peso(r.depositRequired)]);
    (r.addonItems || []).forEach(l => rows.push([l.qty + ' × ' + l.name, peso(l.unitPrice * l.qty)]));
    rows.push(['Payment', (METHOD[p.method] ? METHOD[p.method].label : 'Front desk') + (p.referenceNumber ? ', ref ' + p.referenceNumber : '')]);
    if (p.verifiedAt) rows.push(['Verified', fmtStamp(p.verifiedAt)]);
    if (p.refundedAmount) rows.push(['Refunded', peso(p.refundedAmount)]);
    rows.push(['Balance at desk', r.checkInStatus === 'CHECKED_IN' ? 'Settled at check-in' : r.status === 'CANCELLED' ? 'None, cancelled' : peso(r.remainingBalance)]);
    return { rows, paid: p.amount || 0 };
  }
  const receiptText = r => { const x = receiptRows(r); return ['ATHLETICA MANGGAHAN', 'Manggahan Complex Sports & Recreation', 'Reservation receipt', ''].concat(x.rows.map(([k, v]) => (k + ':').padEnd(26) + v), ['', 'Paid: ' + peso(x.paid)]).join('\n'); };
  function showReceipt(id) {
    const r = IX.res[id];
    if (!r) return;
    const x = receiptRows(r);
    openDlg(`<div class="receipt"><div class="t-top"><div class="t-tag"><span>Athletica Manggahan</span><span>Receipt</span></div><h2 id="dlg-title">Reservation receipt</h2>
        <div class="t-ref-row"><span class="t-ref">${esc(r.id)}</span></div></div>
      <dl class="t-body">${x.rows.map(([k, v]) => row(k, esc(v))).join('')}</dl>
      <div class="r-total"><span>Paid</span><strong>${peso(x.paid)}</strong></div>
      <div class="t-actions">${btn('copy-receipt', 'Copy', 'btn-ghost', { id: r.id })}${isFramed() ? '' : btn('download-receipt', 'Download', 'btn-ghost', { id: r.id })}
        <button type="button" class="btn btn-primary" data-action="close">Done</button></div></div>`);
  }
  function downloadReceipt(id) {
    const r = IX.res[id];
    if (!r) return;
    try {
      const url = URL.createObjectURL(new Blob([receiptText(r)], { type: 'text/plain' })), a = document.createElement('a');
      a.href = url; a.download = r.id + '-receipt.txt';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { toast('Download blocked. Use Copy instead.'); }
  }

  /* ---------- Cancellation: reason → review → confirmed ---------- */
  async function openCancel(id) {
    const r = IX.res[id];
    if (!r) return;
    S.cx = { id, step: 'reason', quote: null, reasonId: '', otherText: '', err: {}, busy: true, fatal: '' };
    renderCx();
    const out = await act('reservation.cancelQuote', { reservationId: id });
    if (!S.cx || S.cx.id !== id) return;
    S.cx.busy = false;
    if (!out.ok) S.cx.fatal = out.error.message; else S.cx.quote = out.data;
    renderCx();
    render();
  }
  function refundSummary(q) {
    const tone = q.refundStatus === 'PENDING_REVIEW' ? 'ok' : q.refundStatus === 'NOT_ELIGIBLE' ? 'warn' : 'info';
    const head = q.refundStatus === 'PENDING_REVIEW' ? `Refund: ${peso(q.refundAmount)}, eligible for review` : q.refundStatus === 'NOT_ELIGIBLE' ? 'Refund: not eligible under the current cancellation policy' : 'Refund: nothing to refund';
    return `<div class="policy ${tone}"><strong>${head}</strong><p>${esc(q.explanation)}</p></div>`;
  }
  function renderCx() {
    const cx = S.cx;
    if (!cx) return;
    const r = IX.res[cx.id];
    const summary = `<div class="cx-sum"><strong>${esc(courtLabel(r.courtId))}</strong><span>${esc(fmtLong(r.date))}</span><span>${fmtRange(r.start, r.end)}</span><span class="mono">${esc(r.id)}</span></div>`;
    let html;
    if (cx.busy && !cx.quote && !cx.fatal) {
      html = `<div class="cx-in"><h2 id="dlg-title">Cancel reservation?</h2>${summary}<p class="cx-loading" role="status"><span class="spin" aria-hidden="true"></span>Checking the cancellation policy for this booking…</p>
        <div class="cx-actions"><button type="button" class="btn btn-ghost" data-action="close">Keep booking</button></div></div>`;
    } else if (cx.fatal) {
      html = `<div class="cx-in"><h2 id="dlg-title">This booking can’t be cancelled</h2>${summary}<p class="notice err">${esc(cx.fatal)}</p>
        <div class="cx-actions"><button type="button" class="btn btn-primary" data-action="close" data-autofocus>Close</button></div></div>`;
    } else if (cx.step === 'reason') {
      const q = cx.quote, other = cx.reasonId === Core.OTHER_REASON;
      html = `<form class="cx-in" id="cxForm" novalidate><h2 id="dlg-title">Cancel reservation?</h2>
        <p>Are you sure you want to cancel this booking?</p>${summary}
        <p class="hint">${isAdmin() ? 'You are cancelling on behalf of the facility.' : 'Your deposit or payment is handled under the facility’s cancellation policy:'}</p>
        ${refundSummary(q)}
        <div class="field"><label for="cx-reason">Reason for cancellation</label>
          <select id="cx-reason" name="reasonId" data-autofocus${cx.err.reason ? ' aria-invalid="true" aria-describedby="err-cx-reason"' : ''}>
            <option value="">Select a reason</option>${V.reasons.map(x => `<option value="${esc(x.id)}"${cx.reasonId === x.id ? ' selected' : ''}>${esc(x.label)}</option>`).join('')}</select>
          ${cx.err.reason ? `<p class="ferr" id="err-cx-reason">${esc(cx.err.reason)}</p>` : '<p class="hint">You don’t need to share medical or other private details.</p>'}</div>
        ${other ? `<div class="field"><label for="cx-other">Please specify</label>
          <textarea id="cx-other" name="otherText" rows="3" maxlength="200"${cx.err.other ? ' aria-invalid="true" aria-describedby="err-cx-other"' : ' aria-describedby="hint-cx-other"'}>${esc(cx.otherText)}</textarea>
          ${cx.err.other ? `<p class="ferr" id="err-cx-other">${esc(cx.err.other)}</p>` : '<p class="hint" id="hint-cx-other">A short sentence is enough. Up to 200 characters.</p>'}</div>` : ''}
        <div class="cx-actions"><button type="button" class="btn btn-ghost" data-action="close">Keep booking</button><button type="submit" class="btn btn-primary">Continue</button></div></form>`;
    } else if (cx.step === 'confirm') {
      const reason = V.reasons.find(x => x.id === cx.reasonId);
      html = `<div class="cx-in"><h2 id="dlg-title">Please confirm cancellation</h2>${summary}
        <dl class="t-body cx-dl">${row('Cancellation reason', esc(cx.reasonId === Core.OTHER_REASON ? cx.otherText : reason.label))}</dl>
        ${refundSummary(cx.quote)}
        <p class="cx-warn">Once cancelled, this court slot will become available to other users. This can’t be undone.</p>
        ${cx.err.form ? `<p class="notice err" id="err-cx-form" tabindex="-1">${esc(cx.err.form)}</p>` : ''}
        <div class="cx-actions"><button type="button" class="btn btn-ghost" data-action="close"${cx.busy ? ' disabled' : ''}>Keep reservation</button>
          <button type="button" class="btn btn-danger" data-action="cx-confirm" data-autofocus${cx.busy ? ' disabled aria-busy="true"' : ''}>${cx.busy ? '<span class="spin" aria-hidden="true"></span>Cancelling' : 'Yes, cancel booking'}</button></div></div>`;
    } else {
      const c = r.cancellation || {};
      const refund = c.refundStatus === 'PENDING_REVIEW' ? `${peso(c.refundAmount)}, pending review` : c.refundStatus === 'NOT_ELIGIBLE' ? 'Not eligible under the current cancellation policy.' : 'Nothing was paid, so there is nothing to refund.';
      html = `<div class="cx-in cx-done" role="status"><div class="result-mark ok" aria-hidden="true">✓</div><h2 id="dlg-title">Booking cancelled successfully</h2>
        <p>The reservation has been cancelled and the slot is open for other players.</p>
        <dl class="t-body cx-dl">${row('Reservation ID', `<span class="mono">${esc(r.id)}</span>`)}${row('Court', esc(courtLabel(r.courtId)))}${row('Date', esc(fmtLong(r.date)))}${row('Time', fmtRange(r.start, r.end))}
          ${row('Reason', esc(c.reasonText || ''))}${row('Deposit', peso(r.depositRequired))}${row('Refund status', refundBadge(c.refundStatus) + '<br><span class="muted">' + esc(refund) + '</span>')}</dl>
        <p class="hint">${isAdmin() ? 'The cancellation and its refund are in Front desk, Cancellations.' : 'You can view the cancellation details from your reservation history.'}</p>
        <div class="cx-actions">${isAdmin() ? '<button type="button" class="btn btn-primary" data-action="close" data-autofocus>Done</button>' : btn('cx-history', 'View reservation history', 'btn-primary', { autofocus: '1' })}</div></div>`;
    }
    openDlg(html, 'sheet-dlg');
  }
  function cxContinue() {
    const cx = S.cx, e = {};
    if (!cx.reasonId) e.reason = 'Choose a reason for cancelling.';
    if (cx.reasonId === Core.OTHER_REASON && cx.otherText.trim().length < 3) e.other = 'Tell us briefly why you are cancelling.';
    cx.err = e;
    renderCx();
    if (Object.keys(e).length) { const el = $(e.reason ? '#cx-reason' : '#cx-other'); if (el) el.focus(); return; }
    cx.step = 'confirm';
    renderCx();
  }
  async function cxConfirm() {
    const cx = S.cx;
    cx.busy = true; cx.err = {}; renderCx();
    const out = await act('reservation.cancel', { reservationId: cx.id, reasonId: cx.reasonId, otherText: cx.otherText });
    cx.busy = false;
    if (!out.ok) {
      if (['reason_required', 'other_required'].includes(out.error.code)) { cx.step = 'reason'; cx.err = { [out.error.code === 'reason_required' ? 'reason' : 'other']: out.error.message }; }
      else cx.err = { form: out.error.message };
      renderCx(); render();
      return;
    }
    cx.step = 'done';
    renderCx();
    render();
  }

  /* ---------- Athlete shop ---------- */
  function shopList() {
    const q = S.shopQ.trim().toLowerCase();
    let list = V.products.filter(p => p.status === 'ACTIVE' && (S.shopCat === 'all' || p.categoryId === S.shopCat) &&
      (!q || (p.name + ' ' + p.description + ' ' + IX.cat[p.categoryId].name).toLowerCase().includes(q)));
    if (S.shopSort === 'low') list = list.slice().sort((a, b) => a.price - b.price);
    else if (S.shopSort === 'high') list = list.slice().sort((a, b) => b.price - a.price);
    else list = list.slice().sort((a, b) => (a.stock > 0 ? 0 : 1) - (b.stock > 0 ? 0 : 1));
    return list;
  }
  function pcardHTML(p) {
    const inCart = cartQty(p.id), room = p.stock - inCart, q = room > 0 ? Math.max(1, Math.min(S.shopQty[p.id] || 1, room)) : 0;
    const busy = S.cartBusy === p.id;
    let buy;
    if (isAdmin()) buy = `<p class="p-incart">Stock ${p.stock}. Manage it in Front desk, Inventory.</p>`;
    else buy = `<div class="p-buy">
        <div class="qty sm" role="group" aria-label="${esc(p.name)}, quantity">
          <button type="button" data-action="qty" data-id="${p.id}" data-step="-1" aria-label="One fewer"${q > 1 ? '' : ' disabled'}>−</button><output>${q}</output>
          <button type="button" data-action="qty" data-id="${p.id}" data-step="1" aria-label="One more"${q < room ? '' : ' disabled'}>+</button></div>
        <button type="button" class="btn btn-sm btn-primary" data-action="add-cart" data-id="${p.id}"${room > 0 && !busy ? '' : ' disabled'}${busy ? ' aria-busy="true"' : ''}>${busy ? '<span class="spin" aria-hidden="true"></span>Adding' : p.stock <= 0 ? 'Sold out' : room <= 0 ? 'All in cart' : 'Add'}</button>
      </div>${inCart ? `<p class="p-incart">In cart: ${inCart}</p>` : ''}`;
    return `<article class="pcard${p.stock <= 0 ? ' is-out' : ''}">
      <div class="p-art">${prodArt(p)}<span class="p-cat">${esc(IX.cat[p.categoryId].name)}</span></div>
      <div class="p-body"><h3>${esc(p.name)}</h3><p class="p-sub">${esc(p.description)}</p>
        <div class="p-row"><strong class="p-price">${peso(p.price)}</strong>${stockBadge(p)}</div>${buy}</div></article>`;
  }
  function gridHTML() {
    const list = shopList();
    if (!list.length) return `<div class="empty span-all"><p>No products match “${esc(S.shopQ.trim())}”. Try another word or pick a different category.</p>${btn('shop-reset', 'Clear search')}</div>`;
    return list.map(pcardHTML).join('');
  }
  function minicartHTML() {
    const n = cartCount();
    let body;
    if (!me()) body = `<p class="hint flush">Sign in to order drinks and snacks for pickup at the front desk.</p>${btn('view', 'Sign in', 'btn-primary block', { view: 'login' })}`;
    else if (isAdmin()) body = '<p class="hint flush">Staff accounts don’t shop. Orders from players appear in Front desk, Shop orders.</p>';
    else if (!n) body = '<p class="hint flush">Your cart is empty. Grab a drink or snack before your game.</p>';
    else body = `<ul class="mc-lines">${cartLines().map(l => { const p = IX.product[l.productId]; return `<li><span>${l.qty} × ${esc(p.name)}</span><span>${peso(p.price * l.qty)}</span></li>`; }).join('')}</ul>
      <div class="mc-total"><span>Subtotal</span><strong>${peso(cartTotal())}</strong></div>${btn('view', 'Checkout', 'btn-primary block', { view: 'cart' })}`;
    return `<section class="sheet" aria-labelledby="mc-h"><h2 id="mc-h">Your cart</h2><div class="sheet-in">${body}</div></section>`;
  }
  function cartbarHTML() {
    const n = isPlayer() ? cartCount() : 0;
    return `<div class="cartbar" id="cartbar"${n ? '' : ' hidden'}><div><strong>${plural(n, 'item')}, ${peso(n ? cartTotal() : 0)}</strong><span>Collect at the front desk</span></div>
      ${btn('view', 'View cart', 'btn-primary', { view: 'cart' })}</div>`;
  }
  // Updates shop fragments in place so the page (and the home hero) doesn't replay its entrance.
  function refreshShop(focusSel) {
    const g = $('#pgrid'); if (g) g.innerHTML = gridHTML();
    const f = $('#fuelgrid'); if (f) f.innerHTML = ['PROD-002', 'PROD-003', 'PROD-007', 'PROD-010'].map(id => IX.product[id]).filter(Boolean).map(pcardHTML).join('');
    const mc = $('#minicart'); if (mc) mc.innerHTML = minicartHTML();
    const cb = $('#cartbar'); if (cb) cb.outerHTML = cartbarHTML();
    syncChrome(true);
    if (focusSel) { const el = document.querySelector(focusSel); if (el) el.focus({ preventScroll: true }); }
  }
  function renderShop() {
    const count = id => V.products.filter(p => p.status === 'ACTIVE' && (id === 'all' || p.categoryId === id)).length;
    const chips = [{ id: 'all', name: 'All' }].concat(V.categories).map(c => `<button type="button" class="chip" data-action="shop-cat" data-cat="${c.id}" aria-pressed="${S.shopCat === c.id}">${esc(c.name)}<b>${count(c.id)}</b></button>`).join('');
    return `<div class="page-head"><p class="hud"><span class="tick"></span>Athlete shop</p><h1 class="page-title" tabindex="-1">Fuel up</h1>
        <p>Drinks, snacks and court essentials. Order here and collect at the front desk, or add them to your next reservation.</p></div>
      <div class="shop"><div>
        <div class="shop-tools"><div class="chips" role="group" aria-label="Category">${chips}</div>
          <div class="shop-search"><label class="sr-only" for="shopQ">Search products</label><input id="shopQ" type="search" placeholder="Search drinks, snacks, gear" value="${esc(S.shopQ)}" autocomplete="off"></div>
          <label class="sortsel"><span>Sort</span><select id="shopSort">${[['featured', 'Featured'], ['low', 'Price: low to high'], ['high', 'Price: high to low']].map(([v, l]) => `<option value="${v}"${S.shopSort === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label></div>
        <div class="pgrid" id="pgrid">${gridHTML()}</div>
      </div><aside class="minicart" id="minicart">${minicartHTML()}</aside></div>
      <div class="shop-pad"></div>${cartbarHTML()}`;
  }
  function changeQty(id, step) {
    const p = IX.product[id], room = p.stock - cartQty(id);
    S.shopQty[id] = Math.max(1, Math.min((S.shopQty[id] || 1) + step, Math.max(1, room)));
    refreshShop(`[data-action="qty"][data-id="${id}"][data-step="${step}"]:not(:disabled)`);
  }
  async function addToCart(id) {
    if (!me()) { S.next = S.view; S.loginNotice = 'Sign in to add items to your cart.'; go('login'); return; }
    if (!isPlayer()) return;
    const p = IX.product[id], add = Math.min(S.shopQty[id] || 1, p.stock - cartQty(id));
    if (add <= 0) { toast(p.stock ? 'All ' + p.stock + ' in stock are already in your cart.' : p.name + ' is out of stock.'); return; }
    S.cartBusy = id; refreshShop();
    const out = await act('cart.set', { productId: id, qty: cartQty(id) + add });
    S.cartBusy = null;
    if (!out.ok) { toast(out.error.message); refreshShop(); return; }
    S.shopQty[id] = 1;
    refreshShop(`[data-action="add-cart"][data-id="${id}"]`);
    toast('Added ' + add + ' × ' + p.name + ' to your cart.');
  }
  async function setCartQty(id, qty, focus) {
    const out = await act('cart.set', { productId: id, qty });
    if (!out.ok) toast(out.error.message);
    S.focusSel = focus;
    render();
  }
  function orderCard(o, staff) {
    const items = o.items.map(l => l.qty + ' × ' + l.name).join(', '), p = o.payment, acts = [];
    if (staff) {
      if (o.status === 'PENDING_COUNTER_PAYMENT') acts.push(btn('pay-approve', 'Cash received', 'btn-primary', { id: p.id }));
      if (o.status === 'AWAITING_VERIFICATION') {
        acts.push(btn('proof-view', 'View proof', '', { id: p.id }), btn('pay-approve', 'Approve', 'btn-primary', { id: p.id }));
        acts.push(S.pending === 'rej:' + p.id ? btn('pay-reject', 'Confirm reject', 'btn-danger', { id: p.id }) + btn('keep', 'Keep', 'btn-ghost') : btn('pay-reject-ask', 'Reject', 'btn-ghost', { id: p.id }));
      }
      if (o.status === 'READY_FOR_PICKUP') acts.push(btn('order-collect', 'Mark collected', 'btn-primary', { id: o.id }));
    }
    const cancellable = staff ? ['PENDING_COUNTER_PAYMENT', 'AWAITING_VERIFICATION', 'PAYMENT_REJECTED'] : ['PENDING_COUNTER_PAYMENT', 'PAYMENT_REJECTED'];
    if (cancellable.includes(o.status)) acts.push(S.pending === 'ord:' + o.id ? btn('order-cancel', 'Confirm cancel', 'btn-danger', { id: o.id }) + btn('keep', 'Keep', 'btn-ghost') : btn('order-cancel-ask', 'Cancel order', 'btn-ghost', { id: o.id }));
    return `<article class="order${['CANCELLED', 'COLLECTED', 'PAYMENT_REJECTED'].includes(o.status) ? ' dim' : ''}">
      <div><h3><span class="mono">${esc(o.id)}</span>${ordBadge(o)}${['READY_FOR_PICKUP', 'COLLECTED'].includes(o.status) && p ? payBadge(p.status) : ''}</h3>
        <p>${esc(items)}</p>
        <p>${peso(o.total)} · ${esc(p ? (p.method === 'CASH' ? 'Pay at the counter' : METHOD[p.method].label) : '')} · ${esc(fmtStamp(o.createdAt))}${staff ? ' · ' + esc(o.contactName) + ', ' + esc(o.contactPhone) : ''}</p>
        ${p && p.note && ['PAYMENT_REJECTED', 'CANCELLED'].includes(o.status) ? `<p class="q-note">${esc(p.note)}</p>` : ''}</div>
      <div class="acts">${acts.join('')}</div></article>`;
  }
  function renderCart() {
    const head = `<div class="page-head"><p class="hud"><span class="tick"></span>Athlete shop</p><h1 class="page-title" tabindex="-1">Cart</h1>
      <p>Orders are collected at the front desk. Pay online now, or pay at the counter when you pick up.</p></div>`;
    if (!me()) return head + `<div class="empty"><h2>Sign in to shop.</h2><p>Your cart is saved to your account, so it follows you between devices.</p>${btn('view', 'Sign in', 'btn-primary', { view: 'login' })}</div>`;
    if (!isPlayer()) return deniedHTML('The cart is for player accounts.');
    const last = S.lastOrder && IX.order[S.lastOrder];
    const banner = last ? `<div class="banner${last.status === 'READY_FOR_PICKUP' ? '' : ' wait'}" role="status"><div><h2>Order ${esc(last.id)} placed</h2>
        <p>${last.status === 'PENDING_COUNTER_PAYMENT' ? `Pay ${peso(last.total)} at the counter when you collect.` : `We're verifying your ${esc(METHOD[last.payment.method].label)} payment of ${peso(last.total)}. Collect it once it shows Ready for pickup.`}</p></div>
        <div class="bk-badges">${ordBadge(last)}</div>${btn('view', 'See my orders', '', { view: 'mine' })}</div>` : '';
    if (!cartLines().length) return head + banner + `<div class="empty"><h2>Your cart is empty.</h2><p>Grab a drink or snack before your game.</p>${btn('view', 'Browse shop', 'btn-primary', { view: 'shop' })}</div>`;
    const d = S.drafts.cart;
    const lines = cartLines().map(l => {
      const p = IX.product[l.productId];
      return `<li class="line"><div class="p-art">${prodArt(p)}</div>
        <div><h3>${esc(p.name)}</h3><p class="unit">${peso(p.price)} × ${l.qty}</p>${l.qty > p.stock ? `<span class="stock low">Only ${p.stock} left</span>` : ''}</div>
        <strong class="sub">${peso(p.price * l.qty)}</strong>
        <div class="ctl"><div class="qty sm" role="group" aria-label="${esc(p.name)}, quantity">
          <button type="button" data-action="cart-qty" data-id="${p.id}" data-step="-1" aria-label="One fewer ${esc(p.name)}">−</button><output>${l.qty}</output>
          <button type="button" data-action="cart-qty" data-id="${p.id}" data-step="1" aria-label="One more ${esc(p.name)}"${l.qty >= p.stock ? ' disabled' : ''}>+</button></div>
          <button type="button" class="linkbtn" data-action="cart-remove" data-id="${p.id}">Remove<span class="sr-only"> ${esc(p.name)}</span></button></div></li>`;
    }).join('');
    const field = (name, label, type, auto, ph) => {
      const id = 'cart-' + name, err = d.err[name];
      return `<div class="field"><label for="${id}">${label}</label><input id="${id}" name="${name}" type="${type}" data-draft="cart" value="${esc(d[name])}" autocomplete="${auto}"${ph ? ` placeholder="${ph}"` : ''}${type === 'tel' ? ' inputmode="numeric"' : ''}${d.busy ? ' disabled' : ''}${err ? ` aria-invalid="true" aria-describedby="err-${id}"` : ''}>${err ? `<p class="ferr" id="err-${id}">${esc(err)}</p>` : ''}</div>`;
    };
    return head + banner + `<div class="cart">
      <div><ul class="lines" aria-label="Items in your cart">${lines}</ul>
        <div class="sum-split"><div><span>Items</span><strong>${cartCount()}</strong></div><div><span>Subtotal</span><strong>${peso(cartTotal())}</strong></div></div></div>
      <form id="orderForm" class="sheet" novalidate aria-labelledby="ck-h"><h2 id="ck-h">Checkout</h2><div class="sheet-in">
        ${d.err.form ? `<p class="notice err form-err" id="err-form-cart" tabindex="-1">${esc(d.err.form)}</p>` : ''}
        <div class="two-col">${field('name', 'Name for pickup', 'text', 'name')}${field('mobile', 'Mobile number', 'tel', 'tel', '09XX XXX XXXX')}</div>
        ${methodTiles('cart', d, 'order')}<div class="paybox">${payDetailsHTML('cart', d, cartTotal(), 'order')}</div>
      </div></form></div>`;
  }
  async function placeOrder() {
    const d = S.drafts.cart, e = validatePay(d);
    if (d.name.trim().length < 2) e.name = 'Enter the name for pickup.';
    if (!/^09\d{9}$/.test(normPhone(d.mobile))) e.mobile = 'Enter a PH mobile number, like 0917 123 4567.';
    d.err = e;
    if (Object.keys(e).length) { S.focusSel = firstErrSel('cart', e); render(); return; }
    d.busy = true; render();
    const out = await act('order.place', { method: d.method, referenceNumber: d.ref, proof: d.method === 'CASH' ? null : { fileName: d.proofName, dataUrl: d.proof }, contactName: d.name, contactPhone: d.mobile });
    d.busy = false;
    if (!out.ok) { S.focusSel = firstErrSel('cart', { [applyPayError(d, out)]: 1 }); render(); return; }
    S.lastOrder = out.data.orderId;
    S.drafts.cart = blankDraft();
    render();
    window.scrollTo(0, 0);
  }

  /* ---------- Sign in, profile, access ---------- */
  function deniedHTML(msg) {
    const u = me();
    return `<div class="page-head"><p class="hud"><span class="tick"></span>Access</p><h1 class="page-title" tabindex="-1">Not available</h1><p>${esc(msg)}</p></div>
      <div class="empty"><h2>${u ? `You're signed in as ${esc(u.username)} (${u.role === 'ADMIN' ? 'front desk' : 'player'}).` : 'You are not signed in.'}</h2>
        <p>${u ? 'Switch accounts to continue, or head back home.' : 'Sign in with the right account to continue.'}</p>
        ${u ? btn('logout', 'Sign out', '') + ' ' + btn('view', 'Go home', 'btn-primary', { view: 'home' }) : btn('view', 'Sign in', 'btn-primary', { view: 'login' })}</div>`;
  }
  function renderLogin() {
    const L = S.login, s = V.settings;
    if (me()) return `<div class="page-head"><p class="hud"><span class="tick"></span>Account</p><h1 class="page-title" tabindex="-1">You're signed in</h1><p>Signed in as ${esc(me().username)}.</p></div>
      <div class="empty">${btn('view', isAdmin() ? 'Open front desk' : 'My reservations', 'btn-primary', { view: isAdmin() ? 'admin' : 'mine' })} ${btn('logout', 'Sign out')}</div>`;
    return `<div class="auth">
      <form id="loginForm" class="sheet auth-form" novalidate aria-labelledby="login-h"><h2 id="login-h">Sign in</h2><div class="sheet-in">
        ${S.loginNotice ? `<p class="notice">${esc(S.loginNotice)}</p>` : ''}
        ${L.err ? `<p class="notice err" id="err-login" tabindex="-1" role="alert">${esc(L.err)}</p>` : ''}
        <div class="field"><label for="lg-user">Username</label><input id="lg-user" name="username" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" value="${esc(L.username)}"${L.err ? ' aria-describedby="err-login"' : ''}></div>
        <div class="field"><label for="lg-pass">Password</label><div class="pw"><input id="lg-pass" name="password" type="${L.show ? 'text' : 'password'}" autocomplete="current-password" value="${esc(L.password)}">
          <button type="button" class="linkbtn" data-action="pw-toggle" aria-pressed="${!!L.show}">${L.show ? 'Hide' : 'Show'}<span class="sr-only"> password</span></button></div></div>
        <button type="submit" class="btn btn-primary block"${L.busy ? ' disabled aria-busy="true"' : ''}>${L.busy ? '<span class="spin" aria-hidden="true"></span>Signing in' : 'Sign in'}</button>
        <div class="auth-links"><button type="button" class="linkbtn" data-action="to-reset">Forgot password?</button>
          <span>New here? <button type="button" class="linkbtn strong" data-action="auth-go" data-view="signup">Create an account</button></span></div>
      </div></form>
      <aside class="auth-side">
        <p class="hud"><span class="tick"></span>${esc(s.facilityName)}</p>
        <h1 class="page-title auth-title" tabindex="-1">${esc(s.brandName)}</h1>
        <p class="auth-slogan">${esc(s.slogan)}</p>
        <p class="muted">Players sign in to reserve courts, pay deposits, cancel bookings and order from the athlete shop. Front desk staff sign in to verify payments, check players in and review refunds.</p>
        <details class="demo-accts" open><summary>Demo accounts, development only</summary>
          <p class="hint">For testing this build. These accounts must not exist in production.</p>
          <dl>
            <div><dt>Player</dt><dd><span class="mono">athlete.demo</span> / <span class="mono">Athletica@123</span></dd><dd>${btn('demo-fill', 'Use this account', '', { u: 'athlete.demo', p: 'Athletica@123' })}</dd></div>
            <div><dt>Front desk</dt><dd><span class="mono">frontdesk.admin</span> / <span class="mono">FrontDesk@123</span></dd><dd>${btn('demo-fill', 'Use this account', '', { u: 'frontdesk.admin', p: 'FrontDesk@123' })}</dd></div>
          </dl></details>
      </aside></div>`;
  }
  function pwRules(id, pw, username) {
    const u = (username || '').toLowerCase();
    const rules = [[pw.length >= 8, 'At least 8 characters'], [/[A-Za-z]/.test(pw) && /\d/.test(pw), 'At least one letter and one number'],
      [!!pw && !(u.length >= 4 && pw.toLowerCase().includes(u)), 'Doesn’t contain your username']];
    return `<ul class="pw-rules" id="${id}">${rules.map(([ok, l]) => `<li class="${ok ? 'ok' : ''}"><span aria-hidden="true">${ok ? '✓' : '○'}</span>${l}<span class="sr-only">${ok ? ': met' : ': not met yet'}</span></li>`).join('')}</ul>`;
  }
  function authField(form, key, label, type, auto, opts) {
    const st = S[form], err = st.err[key], id = form + '-' + key, o = opts || {};
    const desc = [err ? 'err-' + id : '', o.hint ? 'hint-' + id : '', o.rules ? 'rules-' + id : ''].filter(Boolean).join(' ');
    const input = `<input id="${id}" name="${key}" type="${o.pw ? (st.show ? 'text' : 'password') : type}" autocomplete="${auto}" data-${form === 'signup' ? 'su' : 'rs'}="1" value="${esc(st[key])}"${o.extra || ''}${err ? ' aria-invalid="true"' : ''}${desc ? ` aria-describedby="${desc}"` : ''}${st.busy ? ' disabled' : ''}>`;
    return `<div class="field"><label for="${id}">${label}</label>${o.pw && o.toggle ? `<div class="pw">${input}<button type="button" class="linkbtn" data-action="pw-show" data-form="${form}" aria-pressed="${!!st.show}">${st.show ? 'Hide' : 'Show'}<span class="sr-only"> passwords</span></button></div>` : input}
      ${o.hint ? `<p class="hint" id="hint-${id}">${o.hint}</p>` : ''}${o.rules ? pwRules('rules-' + id, st[key], o.rules()) : ''}${err ? `<p class="ferr" id="err-${id}">${esc(err)}</p>` : ''}</div>`;
  }
  const signedInNote = () => `<div class="page-head"><p class="hud"><span class="tick"></span>Account</p><h1 class="page-title" tabindex="-1">You're signed in</h1><p>Signed in as ${esc(me().username)}. Sign out first to use another account.</p></div>
      <div class="empty">${btn('view', isAdmin() ? 'Open front desk' : 'My reservations', 'btn-primary', { view: isAdmin() ? 'admin' : 'mine' })} ${btn('logout', 'Sign out')}</div>`;
  function renderSignup() {
    if (me()) return signedInNote();
    const F = S.signup;
    return `<div class="auth">
      <form id="signupForm" class="sheet auth-form" novalidate aria-labelledby="su-h"><h2 id="su-h">Create a player account</h2><div class="sheet-in">
        ${F.err.form ? `<p class="notice err" id="err-signup-form" tabindex="-1" role="alert">${esc(F.err.form)}</p>` : ''}
        <div class="two-col">${authField('signup', 'firstName', 'First name', 'text', 'given-name')}${authField('signup', 'lastName', 'Last name', 'text', 'family-name')}</div>
        ${authField('signup', 'username', 'Username', 'text', 'username', { hint: '3 to 30 lowercase letters, numbers, dots, dashes or underscores. You sign in with this.', extra: ' autocapitalize="none" spellcheck="false"' })}
        ${authField('signup', 'email', 'Email', 'email', 'email', { hint: 'Password reset codes are sent here.' })}
        ${authField('signup', 'phone', 'Mobile number', 'tel', 'tel', { extra: ' inputmode="numeric" placeholder="09XX XXX XXXX"' })}
        ${authField('signup', 'password', 'Password', 'password', 'new-password', { pw: true, toggle: true, rules: () => S.signup.username })}
        ${authField('signup', 'confirmPassword', 'Confirm password', 'password', 'new-password', { pw: true })}
        <button type="submit" class="btn btn-primary block"${F.busy ? ' disabled aria-busy="true"' : ''}>${F.busy ? '<span class="spin" aria-hidden="true"></span>Creating account' : 'Create account'}</button>
        <div class="auth-links"><span>Already have an account? <button type="button" class="linkbtn strong" data-action="auth-go" data-view="login">Sign in</button></span></div>
      </div></form>
      <aside class="auth-side"><p class="hud"><span class="tick"></span>${esc(V.settings.facilityName)}</p>
        <h1 class="page-title auth-title" tabindex="-1">Join Athletica</h1><p class="auth-slogan">${esc(V.settings.slogan)}</p>
        <ul class="auth-perks"><li>Reserve courts, lanes and fields up to ${V.settings.bookingWindowDays} days ahead.</li><li>Track deposits, cancellations and refunds in one place.</li><li>Order drinks and snacks for pickup at the desk.</li></ul>
        <p class="hint">Player accounts only. Front desk accounts are set up by the facility.</p></aside></div>`;
  }
  function renderReset() {
    const R = S.reset;
    const side = `<aside class="auth-side"><p class="hud"><span class="tick"></span>Account security</p><h1 class="page-title auth-title" tabindex="-1">Reset password</h1>
      <ul class="auth-perks"><li>Codes expire after 15 minutes and work once.</li><li>After 5 wrong tries the code stops working.</li><li>Resetting signs your account out on every device.</li></ul></aside>`;
    if (R.step === 'request') {
      return `<div class="auth"><form id="resetRequestForm" class="sheet auth-form" novalidate aria-labelledby="rs-h"><h2 id="rs-h">Forgot your password?</h2><div class="sheet-in">
        <p class="lead-hint">Enter your username or the email on your account. We’ll send a 6-digit code to that email.</p>
        ${authField('reset', 'identifier', 'Username or email', 'text', 'username', { extra: ' autocapitalize="none" spellcheck="false"' })}
        <button type="submit" class="btn btn-primary block"${R.busy ? ' disabled aria-busy="true"' : ''}>${R.busy ? '<span class="spin" aria-hidden="true"></span>Sending' : 'Send code'}</button>
        <div class="auth-links"><button type="button" class="linkbtn" data-action="auth-go" data-view="login">Back to sign in</button></div>
      </div></form>${side}</div>`;
    }
    const mail = MODE === 'demo'
      ? (R.devMail ? `<div class="mailbox" aria-label="Demo mailbox"><p class="mb-tag">Demo mailbox · no real email is sent</p><dl><div><dt>To</dt><dd>${esc(R.devMail.to)}</dd></div><div><dt>Subject</dt><dd>${esc(R.devMail.subject)}</dd></div></dl><p>${esc(R.devMail.text)}</p></div>`
        : '<div class="mailbox"><p class="mb-tag">Demo mailbox · no real email is sent</p><p>Empty. Nothing is sent when no account matches.</p></div>')
      : '<p class="placeholder"><b>Dev</b><span>No email service is connected yet. The code is printed in the terminal running <code>node server.js</code>.</span></p>';
    const wait = Math.max(0, 30 - Math.floor((Date.now() - R.sentAt) / 1000));
    return `<div class="auth"><form id="resetForm" class="sheet auth-form" novalidate aria-labelledby="rs-h"><h2 id="rs-h">Enter your code</h2><div class="sheet-in">
        <p class="notice" role="status">${esc(R.message)}</p>${mail}
        ${R.err.form ? `<p class="notice err" id="err-reset-form" tabindex="-1" role="alert">${esc(R.err.form)}</p>` : ''}
        ${authField('reset', 'code', '6-digit code', 'text', 'one-time-code', { extra: ' inputmode="numeric" maxlength="7" spellcheck="false"' })}
        ${authField('reset', 'newPassword', 'New password', 'password', 'new-password', { pw: true, toggle: true, rules: () => S.reset.identifier.includes('@') ? '' : S.reset.identifier })}
        ${authField('reset', 'confirmPassword', 'Confirm new password', 'password', 'new-password', { pw: true })}
        <button type="submit" class="btn btn-primary block"${R.busy ? ' disabled aria-busy="true"' : ''}>${R.busy ? '<span class="spin" aria-hidden="true"></span>Saving' : 'Reset password'}</button>
        <div class="auth-links"><button type="button" class="linkbtn" data-action="reset-resend" data-resend-at="${R.sentAt + 30000}"${wait ? ' disabled' : ''}>${wait ? `Send a new code in ${wait}s` : 'Send a new code'}</button>
          <button type="button" class="linkbtn" data-action="reset-restart">Use a different account</button></div>
      </div></form>${side}</div>`;
  }
  async function signup() {
    const F = S.signup, e = {};
    ['firstName', 'lastName', 'username', 'email', 'phone', 'password'].forEach(k => { if (!String(F[k]).trim()) e[k] = { firstName: 'Enter your first name.', lastName: 'Enter your last name.', username: 'Choose a username.', email: 'Enter your email.', phone: 'Enter your mobile number.', password: 'Choose a password.' }[k]; });
    if (!e.password && F.password !== F.confirmPassword) e.confirmPassword = 'The passwords don’t match.';
    F.err = e;
    if (Object.keys(e).length) { S.focusSel = '#signup-' + Object.keys(e)[0]; render(); return; }
    F.busy = true; render();
    const out = await act('account.register', { firstName: F.firstName, lastName: F.lastName, username: F.username, email: F.email, phone: F.phone, password: F.password, confirmPassword: F.confirmPassword });
    F.busy = false;
    if (!out.ok) {
      F.err = out.error.fields || { form: out.error.message };
      if (F.err.password) { F.password = ''; F.confirmPassword = ''; }
      S.focusSel = out.error.fields ? '#signup-' + Object.keys(out.error.fields)[0] : '#err-signup-form';
      render(); return;
    }
    const name = me().firstName;
    S.signup = blankSignup();
    renderChrome();
    const next = S.next && S.next !== 'admin' ? S.next : 'book';
    S.next = null;
    go(next);
    toast('Welcome, ' + name + '. Your account is ready.');
  }
  async function requestReset(resend) {
    const R = S.reset;
    if (!R.identifier.trim()) { R.err = { identifier: 'Enter your username or email.' }; S.focusSel = '#reset-identifier'; render(); return; }
    R.busy = true; R.err = {}; render();
    const out = await act('account.requestReset', { identifier: R.identifier });
    R.busy = false;
    if (!out.ok) { R.err = out.error.fields || { form: out.error.message }; S.focusSel = '#reset-identifier'; render(); return; }
    Object.assign(R, { step: 'verify', message: out.data.message, devMail: out.devMail || null, sentAt: Date.now(), code: '', err: {} });
    S.focusSel = '#reset-code';
    render();
    if (resend) toast('A new code is on its way. Earlier codes no longer work.');
  }
  async function doReset() {
    const R = S.reset, e = {};
    if (!/^\d{6}$/.test(R.code.replace(/\s/g, ''))) e.code = 'Enter the 6-digit code from the email.';
    if (!R.newPassword) e.newPassword = 'Choose a new password.';
    else if (R.newPassword !== R.confirmPassword) e.confirmPassword = 'The passwords don’t match.';
    R.err = e;
    if (Object.keys(e).length) { S.focusSel = '#reset-' + Object.keys(e)[0]; render(); return; }
    R.busy = true; render();
    const out = await act('account.resetPassword', { identifier: R.identifier, code: R.code, newPassword: R.newPassword, confirmPassword: R.confirmPassword });
    R.busy = false;
    if (!out.ok) {
      R.err = out.error.fields || { form: out.error.message };
      if (out.error.code === 'too_many' || out.error.code === 'bad_code') R.code = '';
      S.focusSel = out.error.fields ? '#reset-' + Object.keys(out.error.fields)[0] : out.error.code === 'bad_code' ? '#reset-code' : '#err-reset-form';
      render(); return;
    }
    S.login = { username: out.data.username, password: '', err: '', busy: false };
    S.loginNotice = 'Password updated. Sign in with your new password.';
    S.reset = blankReset();
    renderChrome();
    S.nextFocus = '#lg-pass';
    go('login');
  }
  async function login() {
    const L = S.login;
    if (!L.username.trim() || !L.password) { L.err = 'Enter your username and password.'; S.focusSel = L.username.trim() ? '#lg-pass' : '#lg-user'; render(); return; }
    L.busy = true; L.err = ''; render();
    const out = await act('login', { username: L.username, password: L.password });
    L.busy = false;
    if (!out.ok) { L.err = out.error.message; L.password = ''; S.focusSel = '#lg-pass'; render(); return; }
    S.login = { username: '', password: '', err: '', busy: false };
    S.loginNotice = '';
    renderChrome();
    const next = S.next && !(S.next === 'admin' && !isAdmin()) ? S.next : isAdmin() ? 'admin' : S.sel.court ? 'book' : 'mine';
    S.next = null;
    go(next);
    toast('Signed in as ' + me().firstName + ' ' + me().lastName + '.');
  }
  async function logout() {
    closePanels();
    await act('logout');
    S.co = null; S.cx = null; S.pending = null; S.lastOrder = null; S.adminTab = 'schedule';
    renderChrome();
    go('home');
    toast('Signed out.');
  }
  function renderProfile() {
    if (!me()) return deniedHTML('Sign in to see your profile.');
    const u = me(), d = S.profile || (S.profile = { firstName: u.firstName, lastName: u.lastName, email: u.email, phone: u.phone }), e = S.profileErr;
    const f = (k, label, type, auto) => `<div class="field"><label for="pf-${k}">${label}</label><input id="pf-${k}" name="${k}" type="${type}" autocomplete="${auto}" value="${esc(d[k])}"${e[k] ? ` aria-invalid="true" aria-describedby="err-pf-${k}"` : ''}>${e[k] ? `<p class="ferr" id="err-pf-${k}">${esc(e[k])}</p>` : ''}</div>`;
    return `<div class="page-head"><p class="hud"><span class="tick"></span>Account</p><h1 class="page-title" tabindex="-1">Profile</h1><p>Your contact details are used for reservations and payment follow-ups.</p></div>
      <div class="setgrid">
        <form id="profileForm" class="sheet" novalidate aria-labelledby="pf-h"><h2 id="pf-h">Contact details</h2><div class="sheet-in">
          <div class="two-col">${f('firstName', 'First name', 'text', 'given-name')}${f('lastName', 'Last name', 'text', 'family-name')}</div>
          ${f('email', 'Email', 'email', 'email')}${f('phone', 'Mobile number', 'tel', 'tel')}
          <button type="submit" class="btn btn-primary"${S.profileBusy ? ' disabled aria-busy="true"' : ''}>${S.profileBusy ? '<span class="spin" aria-hidden="true"></span>Saving' : 'Save profile'}</button></div></form>
        <section class="sheet" aria-labelledby="ac-h"><h2 id="ac-h">Account</h2><div class="sheet-in">
          <dl class="sum"><div><dt>Username</dt><dd class="mono">${esc(u.username)}</dd></div><div><dt>Role</dt><dd>${u.role === 'ADMIN' ? 'Front desk' : 'Player'}</dd></div>
            <div><dt>Member since</dt><dd>${esc(fmtDayStamp(u.createdAt))}</dd></div></dl>
          ${btn('logout', 'Sign out', 'btn-ghost block')}</div></section>
      </div>`;
  }
  async function saveProfile(form) {
    const d = Object.fromEntries(new FormData(form).entries());
    S.profile = d; S.profileBusy = true; render();
    const out = await act('profile.update', d);
    S.profileBusy = false;
    if (!out.ok) { S.profileErr = out.error.fields || {}; S.focusSel = '#profileForm [aria-invalid="true"]'; if (!out.error.fields) toast(out.error.message); render(); return; }
    S.profileErr = {}; S.profile = null; S.form.phone = me().phone;
    renderChrome(); render(); toast('Profile saved.');
  }

  /* ---------- Front desk ---------- */
  const resOfPay = p => (p.reservationId ? IX.res[p.reservationId] : null);
  const ordOfPay = p => (p.orderId ? IX.order[p.orderId] : null);
  function payBucket(p) {
    const r = resOfPay(p), o = ordOfPay(p);
    if (p.status === 'AWAITING_VERIFICATION') return (r && ['CANCELLED', 'EXPIRED'].includes(r.status)) || (o && o.status === 'CANCELLED') ? '' : 'review';
    if (p.status === 'PENDING') return (r && r.status === 'PENDING_PAYMENT') || (o && o.status === 'PENDING_COUNTER_PAYMENT') ? 'cash' : '';
    return p.verifiedBy ? 'done' : '';
  }
  function deskCounts() {
    const pays = V.payments.filter(p => ['review', 'cash'].includes(payBucket(p))).length;
    const refunds = V.cancellations.filter(c => ['PENDING_REVIEW', 'APPROVED'].includes(c.refundStatus)).length;
    const orders = V.orders.filter(o => ['PENDING_COUNTER_PAYMENT', 'AWAITING_VERIFICATION', 'READY_FOR_PICKUP'].includes(o.status)).length;
    const low = V.products.filter(p => p.status === 'ACTIVE' && p.stock <= LOW).length;
    return { payments: pays, cancellations: refunds, orders, inventory: low };
  }
  const TABS = [['schedule', 'Schedule'], ['payments', 'Payments'], ['cancellations', 'Cancellations'], ['orders', 'Shop orders'], ['inventory', 'Inventory'],
    ['courts', 'Courts'], ['customers', 'Customers'], ['reports', 'Reports'], ['activity', 'Activity log'], ['settings', 'Settings']];
  function renderAdmin() {
    if (!isAdmin()) return deniedHTML(me() ? 'The front desk is for staff accounts. Player accounts can’t open it.' : 'Sign in with a front desk account to open the front desk.');
    const n = deskCounts();
    const bar = `<div class="atabs" role="group" aria-label="Front desk sections">${TABS.map(([id, l]) => `<button type="button" class="atab" data-action="admin-tab" data-tab="${id}" aria-pressed="${S.adminTab === id}">${l}${n[id] ? `<b>${n[id]}<span class="sr-only"> need attention</span></b>` : ''}</button>`).join('')}</div>`;
    const body = ({ schedule: scheduleTab, payments: paymentsTab, cancellations: cancellationsTab, orders: ordersTab, inventory: inventoryTab, courts: courtsTab,
      customers: customersTab, reports: reportsTab, activity: activityTab, settings: settingsTab }[S.adminTab] || scheduleTab)();
    return `<div class="page-head"><p class="hud"><span class="tick"></span>Staff console · ${esc(me().firstName + ' ' + me().lastName)}</p><h1 class="page-title" tabindex="-1">Front desk</h1>
      <p>Verify payments, check players in, review cancellations and refunds, and run the shop, courts and settings.</p></div>${bar}${body}`;
  }

  /* Schedule */
  function matchesQuery(r, q) {
    if (!q) return true;
    const hay = [r.id, r.customerName, r.teamName, r.customerPhone, courtLabel(r.courtId)].join(' ').toLowerCase();
    return q.toLowerCase().split(/\s+/).filter(Boolean).every(t => hay.includes(t));
  }
  function scheduleHTML() {
    const d = S.adminDate, all = V.reservations.filter(r => r.date === d).sort((a, b) => a.start - b.start || a.courtId.localeCompare(b.courtId));
    const list = all.filter(r => matchesQuery(r, S.q.trim()));
    if (!all.length) return '<div class="empty"><p>No reservations on this date yet.</p></div>';
    if (!list.length) return `<div class="empty"><p>No reservation matches “${esc(S.q.trim())}”. Check the code or name and try again.</p></div>`;
    const rows = list.map(r => {
      const acts = [btn('details', 'Details', 'btn-ghost', { id: r.id })];
      if (r.status === 'CONFIRMED' && r.date === today()) acts.push(btn('checkin', 'Check in', 'btn-primary', { id: r.id }));
      if (r.status === 'PAYMENT_VERIFICATION') acts.push(btn('admin-tab', 'Review payment', '', { tab: 'payments' }));
      if (r.status === 'PENDING_PAYMENT' && r.paymentStatus === 'PENDING' && r.payment) acts.push(btn('pay-approve', 'Cash received', 'btn-primary', { id: r.payment.id }));
      if (r.canCancel) acts.push(btn('cancel', 'Cancel', 'btn-ghost', { id: r.id }));
      return `<tr class="${['CANCELLED', 'EXPIRED'].includes(r.status) ? 'dim' : ''}">
        <td>${fmtRange(r.start, r.end)}</td><td>${esc(courtLabel(r.courtId))}</td>
        <td>${esc(r.teamName || r.customerName)}<span class="tag">${r.userId ? 'Online' : 'Walk-in'}</span><br><span class="muted">${esc(r.id)}${r.customerPhone ? ', ' + esc(r.customerPhone) : ''}</span></td>
        <td>${esc(PLAYER_TYPES[r.playerType].label)}${r.headcount ? '<br><span class="muted">' + plural(r.headcount, 'player') + '</span>' : ''}</td>
        <td>${peso(r.totalPrice)}</td>
        <td><div class="cell-badges">${resBadge(r)}${payBadge(r.paymentStatus)}</div></td>
        <td><div class="row-actions">${acts.join('')}</div></td></tr>`;
    }).join('');
    return `<div class="tbl"><table><thead><tr><th scope="col">Time</th><th scope="col">Venue</th><th scope="col">Booked by</th><th scope="col">Player type</th><th scope="col">Court fee</th><th scope="col">Status</th><th scope="col">Action</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }
  function scheduleTab() {
    const d = S.adminDate, s = V.settings;
    const active = V.reservations.filter(r => r.date === d && ['PENDING_PAYMENT', 'PAYMENT_VERIFICATION', 'CONFIRMED', 'CHECKED_IN', 'COMPLETED'].includes(r.status));
    const hours = active.reduce((n, r) => n + r.hours, 0), capacity = V.courts.filter(courtOpen).length * (s.closeHour - s.openHour);
    const revenue = active.reduce((n, r) => n + r.totalPrice, 0), util = capacity ? Math.round(hours / capacity * 100) : 0;
    const usage = V.courts.map(c => {
      const used = active.filter(r => r.courtId === c.id).reduce((n, r) => n + r.hours, 0), pct = Math.round(used / (s.closeHour - s.openHour) * 100);
      return `<li><div class="u-row"><span>${esc(courtLabel(c.id))}${courtOpen(c) ? '' : ' <span class="muted">(' + (c.status === 'MAINTENANCE' ? 'maintenance' : 'unavailable') + ')</span>'}</span><span>${pct}%</span></div>
        <div class="bar" role="img" aria-label="${pct}% booked"><i style="width:${pct}%"></i></div></li>`;
    }).join('');
    return `${dayStrip(d, 'adate')}
      <div class="stats">
        <div class="stat"><strong data-count="${active.length}">${active.length}</strong><span>Reservations</span></div>
        <div class="stat"><strong data-count="${hours}">${hours}</strong><span>of ${capacity} venue-hours booked</span></div>
        <div class="stat"><strong data-count="${util}" data-suf="%">${util}%</strong><span>Utilization</span></div>
        <div class="stat"><strong data-count="${revenue}" data-pre="₱">${peso(revenue)}</strong><span>Court revenue booked</span></div></div>
      <div class="admin">
        <section aria-labelledby="util-h"><h2 id="util-h">Venue usage</h2><ul class="util">${usage}</ul></section>
        <section aria-labelledby="sched-h"><div class="sched-head"><h2 id="sched-h">Schedule for ${esc(fmtDate(d))}</h2>
          <div class="search"><label class="sr-only" for="q">Find a reservation by code, name, or number</label><input id="q" type="search" placeholder="Code, name, or mobile" value="${esc(S.q)}" autocomplete="off"></div></div>
          <div id="sched">${scheduleHTML()}</div></section>
      </div>`;
  }

  /* Payments */
  function qItemHTML(p) {
    const r = resOfPay(p), o = ordOfPay(p), bk = payBucket(p), m = METHOD[p.method];
    const code = r ? r.id : o ? o.id : p.id;
    const what = r ? `${esc(courtLabel(r.courtId))} · ${esc(fmtDate(r.date))} · ${fmtRange(r.start, r.end)}` : o ? esc(o.items.map(l => l.qty + ' × ' + l.name).join(', ')) : '';
    const who = r ? (r.teamName || r.customerName) : o ? o.contactName : '';
    const proof = p.method === 'CASH' ? '<div class="q-proof cash" aria-hidden="true">₱</div>'
      : `<button type="button" class="q-proof" data-action="proof-view" data-id="${esc(p.id)}" aria-label="View payment proof for ${esc(code)}">${p.proof ? `<img src="${esc(p.proof)}" alt="">` : sampleProof()}</button>`;
    let acts;
    if (bk === 'review') {
      acts = btn('pay-approve', 'Approve', 'btn-primary', { id: p.id }) + (r ? btn('pay-reupload', 'Request re-upload', '', { id: p.id }) : '') +
        (S.pending === 'rej:' + p.id ? btn('pay-reject', 'Confirm reject', 'btn-danger', { id: p.id }) + btn('keep', 'Keep', 'btn-ghost') : btn('pay-reject-ask', 'Reject', 'btn-ghost', { id: p.id }));
    } else if (bk === 'cash') acts = btn('pay-approve', 'Cash received', 'btn-primary', { id: p.id });
    else acts = `<p class="hint flush">Reviewed ${esc(fmtStamp(p.verifiedAt))}${p.verifiedBy && IX.user[p.verifiedBy] ? ' by ' + esc(IX.user[p.verifiedBy].username) : ''}</p>`;
    return `<article class="q-item">${proof}<div>
        <div class="q-top"><span class="mono">${esc(code)}</span>${r ? resBadge(r) : o ? ordBadge(o) : ''}${payBadge(p.status)}</div>
        <h3>${peso2(p.amount)} · ${esc(p.method === 'CASH' ? 'Cash' : m.label)}</h3>
        <p>${p.referenceNumber ? `Ref <span class="mono">${esc(p.referenceNumber)}</span> · ` : ''}Submitted ${esc(fmtStamp(p.submittedAt))}</p>
        <p>${what}</p><p>${esc(who || 'Walk-in')}${r && r.customerPhone ? ' · ' + esc(r.customerPhone) : ''}<span class="tag">${r ? 'Reservation' : 'Shop order'}</span></p>
        ${p.note ? `<p class="q-note">${esc(p.note)}</p>` : ''}</div>
      <div class="q-actions">${acts}</div></article>`;
  }
  function paymentsTab() {
    const by = k => V.payments.filter(p => payBucket(p) === k), f = S.payFilter;
    const list = by(f).sort((a, b) => (f === 'done' ? (b.verifiedAt || '').localeCompare(a.verifiedAt || '') : (a.submittedAt || '').localeCompare(b.submittedAt || '')));
    const none = { review: ['No payments waiting for review.', 'New GCash, Maya and QR Ph submissions appear here with their screenshot and reference number, oldest first.'],
      cash: ['No cash deposits pending.', 'Reservations and orders paying at the counter wait here until staff record the cash.'], done: ['Nothing reviewed this week.', 'Approved and rejected payments are listed here for reference.'] }[f];
    return `<div class="subseg" role="group" aria-label="Filter payments">${[['review', 'Needs review'], ['cash', 'Cash at counter'], ['done', 'Reviewed']].map(([k, l]) => `<button type="button" data-action="pay-filter" data-filter="${k}" aria-pressed="${f === k}">${l} (${by(k).length})</button>`).join('')}</div>` +
      (list.length ? `<div class="queue">${list.slice(0, 60).map(qItemHTML).join('')}</div>` : `<div class="empty"><h2>${none[0]}</h2><p>${none[1]}</p></div>`);
  }
  function showProof(id) {
    const p = IX.pay[id];
    if (!p) return;
    const r = resOfPay(p), o = ordOfPay(p), code = r ? r.id : o ? o.id : p.id;
    openDlg(`<div class="proofview"><div class="t-top"><div class="t-tag"><span>Payment proof</span><span>${esc(METHOD[p.method].label)}</span></div><h2 id="dlg-title">${esc(code)}</h2></div>
      ${p.proof ? `<img src="${esc(p.proof)}" alt="Payment screenshot for ${esc(code)}">` : sampleProof()}
      <dl class="t-body">${row('Amount', peso2(p.amount))}${row('Reference', `<span class="mono">${esc(p.referenceNumber || 'None')}</span>`)}${row('Submitted', esc(fmtStamp(p.submittedAt)))}${p.proof ? '' : row('Image', 'Sample booking, no upload')}</dl>
      <div class="t-actions"><button type="button" class="btn btn-primary" data-action="close">Close</button></div></div>`);
  }

  /* Cancellations and refunds */
  function cancellationsTab() {
    const f = S.refundFilter, all = V.cancellations;
    const pick = { review: c => c.refundStatus === 'PENDING_REVIEW', approved: c => c.refundStatus === 'APPROVED', all: () => true }[f];
    const count = k => all.filter({ review: c => c.refundStatus === 'PENDING_REVIEW', approved: c => c.refundStatus === 'APPROVED', all: () => true }[k]).length;
    const list = all.filter(pick);
    const seg = `<div class="subseg" role="group" aria-label="Filter cancellations">${[['review', 'Refund review'], ['approved', 'Approved, not sent'], ['all', 'All cancellations']].map(([k, l]) => `<button type="button" data-action="refund-filter" data-filter="${k}" aria-pressed="${f === k}">${l} (${count(k)})</button>`).join('')}</div>`;
    if (!list.length) {
      const msg = { review: ['No refunds waiting for review.', 'When a player cancels a paid booking, it lands here with the reason and the refund the policy allows.'],
        approved: ['No approved refunds waiting to be sent.', 'Approved refunds stay here until staff confirm the money went back to the player.'], all: ['No cancellations yet.', 'Every cancelled reservation is kept here with its reason and refund history.'] }[f];
      return seg + `<div class="empty"><h2>${msg[0]}</h2><p>${msg[1]}</p></div>`;
    }
    const rows = list.map(c => {
      const r = IX.res[c.reservationId], u = c.userId ? IX.user[c.userId] : null;
      return `<tr><td><span class="mono">${esc(c.reservationId)}</span><br><span class="muted">${r ? esc(courtLabel(r.courtId)) + ', ' + esc(fmtDate(r.date)) + ', ' + fmtRange(r.start, r.end) : ''}</span></td>
        <td>${esc(u ? u.firstName + ' ' + u.lastName : r ? r.customerName : 'Walk-in')}${u ? `<br><span class="muted">${esc(u.username)}</span>` : ''}</td>
        <td>${esc(c.reasonText)}</td><td>${peso(c.amountPaid)}</td><td>${peso(c.refundAmount)}</td>
        <td><div class="cell-badges">${refundBadge(c.refundStatus)}</div></td>
        <td>${esc(fmtStamp(c.cancelledAt))}<br><span class="muted">by ${c.cancelledBy === 'ADMIN' ? 'front desk' : 'player'}</span></td>
        <td>${btn('refund-open', c.refundStatus === 'PENDING_REVIEW' ? 'Review' : c.refundStatus === 'APPROVED' ? 'Mark sent' : 'Open', c.refundStatus === 'PENDING_REVIEW' || c.refundStatus === 'APPROVED' ? 'btn-primary' : 'btn-ghost', { id: c.id })}</td></tr>`;
    }).join('');
    return seg + `<div class="tbl"><table class="cx-table"><thead><tr><th scope="col">Reservation</th><th scope="col">User</th><th scope="col">Reason</th><th scope="col">Paid</th><th scope="col">Refund</th><th scope="col">Status</th><th scope="col">Cancelled</th><th scope="col"><span class="sr-only">Action</span></th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }
  function showRefund(id) {
    const c = IX.can[id];
    if (!c) return;
    S.rx = S.rx && S.rx.id === id ? S.rx : { id, note: '', err: '', busy: false, confirm: false };
    const rx = S.rx, r = IX.res[c.reservationId], u = c.userId ? IX.user[c.userId] : null;
    const pol = c.policySnapshot || {};
    let body = row('Cancellation', `<span class="mono">${esc(c.id)}</span>`) + row('Reservation', `<span class="mono">${esc(c.reservationId)}</span>`);
    if (r) body += row('Court', esc(courtLabel(r.courtId))) + row('When', esc(fmtLong(r.date)) + ', ' + fmtRange(r.start, r.end));
    body += row('User', esc(u ? `${u.firstName} ${u.lastName} (${u.username})` : r ? r.customerName : 'Walk-in'));
    body += row('Reason', esc(c.reasonText)) + row('Cancelled', esc(fmtStamp(c.cancelledAt)) + ` by ${c.cancelledBy === 'ADMIN' ? 'the front desk' : 'the player'}, ${c.hoursBeforeStart} h before start`);
    body += row('Policy then', `${pol.refundEligible ? `${pol.refundPercentage}% refund if cancelled ${pol.minimumHoursBeforeBooking}+ h ahead` : 'No refunds'}`);
    body += row('Deposit', peso(c.depositAmount)) + row('Amount paid', peso(c.amountPaid)) + (r && r.payment ? row('Payment', payBadge(r.payment.status) + ` <span class="muted">${esc(METHOD[r.payment.method].label)}${r.payment.referenceNumber ? ', ref ' + esc(r.payment.referenceNumber) : ''}</span>`) : '');
    body += row('Refund', refundBadge(c.refundStatus) + ' ' + peso(c.refundAmount));
    if (c.reviewedAt) body += row('Reviewed', esc(fmtStamp(c.reviewedAt)) + (c.reviewedBy && IX.user[c.reviewedBy] ? ' by ' + esc(IX.user[c.reviewedBy].username) : ''));
    if (c.completedAt) body += row('Refund sent', esc(fmtStamp(c.completedAt)));
    if (c.notes) body += row('Staff note', esc(c.notes));
    let actions = '<button type="button" class="btn btn-primary" data-action="close">Close</button>';
    let extra = '';
    if (c.refundStatus === 'PENDING_REVIEW') {
      extra = `<div class="rx-in"><div class="field"><label for="rx-note">Note for the player</label><textarea id="rx-note" rows="2" maxlength="200" data-rx="note"${rx.err ? ' aria-invalid="true" aria-describedby="err-rx"' : ' aria-describedby="hint-rx"'}>${esc(rx.note)}</textarea>
        ${rx.err ? `<p class="ferr" id="err-rx">${esc(rx.err)}</p>` : '<p class="hint" id="hint-rx">Optional when approving. Required when denying, so the player knows why.</p>'}</div>
        ${r && r.payment && r.payment.status === 'AWAITING_VERIFICATION' ? '<p class="placeholder"><b>Check</b><span>This payment was never verified. Approving confirms the money arrived; denying marks it as not received.</span></p>' : ''}</div>`;
      actions = `<button type="button" class="btn btn-ghost" data-action="close">Close</button>${btn('refund-deny', 'Deny refund', 'btn-danger', { id: c.id })}${btn('refund-approve', 'Approve refund', 'btn-primary', { id: c.id })}`;
    } else if (c.refundStatus === 'APPROVED') {
      extra = `<div class="rx-in"><p class="placeholder"><b>Manual</b><span>Only mark the refund as sent after ${peso(c.refundAmount)} has actually gone back to the player, by cash at the desk or a transfer. No payment provider is connected to confirm it automatically.</span></p></div>`;
      actions = rx.confirm
        ? `<button type="button" class="btn btn-ghost" data-action="rx-unconfirm">Not yet</button>${btn('refund-complete', 'Yes, ' + peso(c.refundAmount) + ' was sent', 'btn-primary', { id: c.id })}`
        : `<button type="button" class="btn btn-ghost" data-action="close">Close</button>${btn('rx-confirm', 'Mark refund sent', 'btn-primary', { id: c.id })}`;
    }
    openDlg(`<div class="t-top"><div class="t-tag"><span>Cancellation record</span><span>${esc(REFUND_LABEL[c.refundStatus])}</span></div><h2 id="dlg-title">${esc(c.reservationId)}</h2></div>
      <dl class="t-body">${body}</dl>${extra}<div class="t-actions rx-actions">${actions}</div>`, 'details-dlg');
  }
  async function decideRefund(id, decision, trigger) {
    const rx = S.rx;
    if (decision === 'deny' && !rx.note.trim()) { rx.err = 'Add a short note explaining why the refund is denied.'; showRefund(id); const n = $('#rx-note'); if (n) n.focus(); return; }
    trigger.setAttribute('aria-busy', 'true'); trigger.disabled = true; trigger.innerHTML = '<span class="spin" aria-hidden="true"></span>Saving';
    const out = await act('refund.decide', { cancellationId: id, decision, note: rx.note });
    if (!out.ok) { rx.err = out.error.message; showRefund(id); return; }
    S.rx = null;
    closeDlg();
    render();
    toast({ approve: 'Refund approved. Send the money, then mark it sent.', deny: 'Refund denied. The player has been notified.', complete: 'Refund marked as sent.' }[decision]);
  }

  /* Shop orders */
  function ordersTab() {
    if (!V.orders.length) return '<div class="empty"><h2>No shop orders yet.</h2><p>Orders placed in the Athlete shop appear here for payment and pickup.</p></div>';
    const open = V.orders.filter(o => ['PENDING_COUNTER_PAYMENT', 'AWAITING_VERIFICATION', 'READY_FOR_PICKUP'].includes(o.status)), done = V.orders.filter(o => !open.includes(o));
    return `<h2 class="sub-h first">Open orders</h2>${open.length ? `<div class="orders">${open.map(o => orderCard(o, true)).join('')}</div>` : '<p class="hint">Nothing waiting for payment or pickup.</p>'}
      ${done.length ? `<h2 class="sub-h">Completed and cancelled</h2><div class="orders">${done.slice(0, 25).map(o => orderCard(o, true)).join('')}</div>` : ''}`;
  }

  /* Inventory */
  function inventoryTab() {
    const rp = V.reports, low = V.products.filter(p => p.stock > 0 && p.stock <= LOW).length, out = V.products.filter(p => p.stock <= 0).length;
    const rows = V.products.map(p => {
      const cls = p.stock <= 0 ? 'out' : p.stock <= LOW ? 'low' : '';
      return `<tr class="${cls}"><td><strong>${esc(p.name)}</strong><br><span class="muted">${esc(p.description)}${p.addon ? ' · offered as add-on' : ''}</span></td><td>${esc(IX.cat[p.categoryId].name)}</td>
        <td><form class="inline-form" data-price-form="${p.id}"><label class="sr-only" for="pr-${p.id}">Price of ${esc(p.name)}</label><input id="pr-${p.id}" name="price" type="number" min="1" step="1" inputmode="numeric" value="${p.price}"><button type="submit" class="btn btn-sm btn-ghost">Save<span class="sr-only"> price</span></button></form></td>
        <td><div class="qty sm" role="group" aria-label="${esc(p.name)}, stock"><button type="button" data-action="stock" data-id="${p.id}" data-step="-1" aria-label="Remove one from stock"${p.stock ? '' : ' disabled'}>−</button><output>${p.stock}</output><button type="button" data-action="stock" data-id="${p.id}" data-step="1" aria-label="Add one to stock">+</button></div>
          <button type="button" class="linkbtn" data-action="stock" data-id="${p.id}" data-step="10">+10<span class="sr-only"> ${esc(p.name)}</span></button></td>
        <td>${stockBadge(p)}</td>
        <td>${btn('product-toggle', p.status === 'ACTIVE' ? 'Hide' : 'Show', 'btn-ghost', { id: p.id })}${p.status === 'ACTIVE' ? '' : '<br><span class="muted">Hidden from shop</span>'}</td></tr>`;
    }).join('');
    return `<div class="stats stats-inv">
        <div class="stat"><strong>${peso(rp.shopSales)}</strong><span>Shop sales, paid</span></div>
        <div class="stat"><strong>${V.products.length}</strong><span>Products</span></div>
        <div class="stat"><strong>${low}</strong><span>Low stock</span></div>
        <div class="stat"><strong>${out}</strong><span>Out of stock</span></div></div>
      <div class="tbl"><table class="inv"><thead><tr><th scope="col">Product</th><th scope="col">Category</th><th scope="col">Price</th><th scope="col">Stock</th><th scope="col">Status</th><th scope="col">Shop</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  /* Courts */
  function courtsTab() {
    const upcoming = id => V.reservations.filter(r => r.courtId === id && r.date >= today() && ['PENDING_PAYMENT', 'PAYMENT_VERIFICATION', 'CONFIRMED'].includes(r.status)).length;
    const rows = V.courts.map(c => {
      const n = upcoming(c.id), e = S.courtErr[c.id];
      return `<tr><td><strong>${esc(c.name)}</strong><br><span class="muted">${esc(IX.sport[c.sportId].name)} · ${esc(c.location)}</span></td>
        <td colspan="4"><form class="court-form" data-court-form="${c.id}">
          <label><span>Status</span><select name="status">${['AVAILABLE', 'MAINTENANCE', 'UNAVAILABLE'].map(s => `<option value="${s}"${c.status === s ? ' selected' : ''}>${{ AVAILABLE: 'Available', MAINTENANCE: 'Maintenance', UNAVAILABLE: 'Unavailable' }[s]}</option>`).join('')}</select></label>
          <label><span>Rate per hour, ₱</span><input name="hourlyRate" type="number" min="50" step="10" inputmode="numeric" value="${c.hourlyRate}"></label>
          <label><span>Deposit %</span><input name="depositPercentage" type="number" min="0" max="100" step="5" inputmode="numeric" value="${c.depositPercentage == null ? '' : c.depositPercentage}" placeholder="Default ${V.settings.depositPercentage}"></label>
          <button type="submit" class="btn btn-sm">Save</button>
          ${e ? `<p class="ferr">${esc(e)}</p>` : ''}</form></td>
        <td>${n ? `${plural(n, 'upcoming booking')}${courtOpen(c) ? '' : '<br><span class="stock low">Still on the schedule</span>'}` : '<span class="muted">None</span>'}</td></tr>`;
    }).join('');
    return `<p class="hint lead-hint">Rates and deposits apply to new reservations. Setting a court to maintenance stops new bookings but keeps existing ones, so cancel those from the schedule if the court can’t be used.</p>
      <div class="tbl"><table class="courts"><thead><tr><th scope="col">Court</th><th scope="col" colspan="4">Status, rate and deposit</th><th scope="col">Upcoming</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  /* Customers */
  function customersTab() {
    const q = S.custQ.trim().toLowerCase();
    const list = V.customers.filter(c => !q || [c.name, c.username, c.email, c.phone].join(' ').toLowerCase().includes(q));
    const rows = list.map(c => `<tr><td><strong>${esc(c.name)}</strong><span class="tag">${c.type === 'ACCOUNT' ? 'Account' : 'Walk-in'}</span>${c.username ? `<br><span class="muted">${esc(c.username)}</span>` : ''}</td>
      <td>${esc(c.email || '—')}<br><span class="muted">${esc(c.phone || '')}</span></td><td>${c.reservations}</td><td>${c.cancellations}</td><td>${peso(c.paid)}</td><td>${c.lastVisit ? esc(fmtDate(c.lastVisit)) : '—'}</td></tr>`).join('');
    return `<div class="sched-head"><h2 class="sub-h first">${plural(list.length, 'customer')}</h2><div class="search"><label class="sr-only" for="custQ">Search customers</label><input id="custQ" type="search" placeholder="Name, username, email or mobile" value="${esc(S.custQ)}" autocomplete="off"></div></div>
      ${list.length ? `<div class="tbl"><table><thead><tr><th scope="col">Customer</th><th scope="col">Contact</th><th scope="col">Reservations</th><th scope="col">Cancelled</th><th scope="col">Deposits paid</th><th scope="col">Last visit</th></tr></thead><tbody>${rows}</tbody></table></div>`
        : `<div class="empty"><p>No customer matches “${esc(S.custQ.trim())}”.</p></div>`}`;
  }

  /* Reports: stat tiles for headlines, one-hue bar lists that double as tables */
  function barList(title, items, fmt, max) {
    const top = max || Math.max(1, ...items.map(i => i.value));
    return `<section class="sheet report" aria-labelledby="rp-${esc(title.replace(/\W+/g, '-'))}"><h2 id="rp-${esc(title.replace(/\W+/g, '-'))}">${esc(title)}</h2><div class="sheet-in">
      ${items.length ? `<ul class="util rbars">${items.map(i => `<li title="${esc(i.label)}: ${esc(fmt(i.value))}"><div class="u-row"><span>${esc(i.label)}</span><span>${esc(fmt(i.value))}</span></div>
        <div class="bar" aria-hidden="true"><i style="width:${Math.round(i.value / top * 100)}%"></i></div></li>`).join('')}</ul>` : '<p class="hint flush">No data yet.</p>'}</div></section>`;
  }
  function reportsTab() {
    const rp = V.reports, rf = rp.refunds;
    const status = Object.entries(rp.byStatus).map(([k, v]) => ({ label: RES_LABEL[k], value: v })).sort((a, b) => b.value - a.value);
    return `<p class="hint lead-hint">Bookings cover ${esc(fmtDate(rp.window.from))} to ${esc(fmtDate(rp.window.to))}. Money and no-shows cover the last 30 days.</p>
      <div class="stats">
        <div class="stat"><strong>${rp.utilization}%</strong><span>Utilization, next ${V.settings.bookingWindowDays} days</span></div>
        <div class="stat"><strong>${rp.bookedHours}</strong><span>of ${rp.capacityHours} venue-hours booked</span></div>
        <div class="stat"><strong>${peso(rp.depositsCollected30d)}</strong><span>Deposits collected</span></div>
        <div class="stat"><strong>${peso(rp.shopSales)}</strong><span>Shop and add-on sales</span></div></div>
      <div class="stats stats-2">
        <div class="stat"><strong>${rf.PENDING_REVIEW.count}</strong><span>Refunds to review, ${peso(rf.PENDING_REVIEW.amount)}</span></div>
        <div class="stat"><strong>${rf.APPROVED.count}</strong><span>Approved, not sent, ${peso(rf.APPROVED.amount)}</span></div>
        <div class="stat"><strong>${rf.COMPLETED.count}</strong><span>Refunds sent, ${peso(rf.COMPLETED.amount)}</span></div>
        <div class="stat"><strong>${rp.noShows30d}</strong><span>No-shows of ${rp.completed30d} finished bookings</span></div></div>
      <div class="setgrid reports">
        ${barList('Utilization by sport, next 7 days', rp.bySport.map(s => ({ label: s.label, value: s.capacity ? Math.round(s.hours / s.capacity * 100) : 0 })), v => v + '%', 100)}
        ${barList('Cancellations by reason', rp.reasons.map(r => ({ label: r.label, value: r.count })), v => plural(v, 'cancellation'))}
        ${barList('Reservations by status, next 7 days', status, v => String(v))}
      </div>`;
  }

  /* Activity log */
  const ACTION_LABEL = {
    LOGIN: 'Signed in', LOGOUT: 'Signed out', LOGIN_FAILED: 'Failed sign-in', UPDATE_PROFILE: 'Updated profile', CREATE_RESERVATION: 'Held a slot', RELEASE_HOLD: 'Released a hold',
    EXPIRE_HOLD: 'Hold expired', SUBMIT_PAYMENT: 'Submitted payment', VERIFY_PAYMENT: 'Verified payment', REJECT_PAYMENT: 'Rejected payment', REQUEST_REUPLOAD: 'Asked for new proof',
    CHECK_IN_USER: 'Checked in', CANCEL_RESERVATION: 'Cancelled reservation', APPROVE_REFUND: 'Approved refund', REJECT_REFUND: 'Denied refund', COMPLETE_REFUND: 'Refund sent',
    PLACE_ORDER: 'Placed order', CANCEL_ORDER: 'Cancelled order', COLLECT_ORDER: 'Order collected', UPDATE_SETTINGS: 'Changed settings', UPDATE_COURT: 'Changed court',
    UPDATE_STOCK: 'Changed stock', UPDATE_PRODUCT: 'Changed product', REGISTER: 'Created account', PASSWORD_RESET_REQUESTED: 'Asked for reset code', PASSWORD_RESET: 'Reset password'
  };
  function activityTab() {
    const actions = [...new Set(V.logs.map(l => l.action))].sort();
    const list = V.logs.filter(l => !S.logFilter || l.action === S.logFilter);
    const rows = list.slice(0, 150).map(l => {
      const u = l.userId && IX.user[l.userId];
      return `<tr><td>${esc(fmtStamp(l.timestamp))}</td><td>${u ? esc(u.username) + `<br><span class="muted">${u.role === 'ADMIN' ? 'Front desk' : 'Player'}</span>` : '<span class="muted">System</span>'}</td>
        <td><span class="mono">${esc(l.action)}</span><br><span class="muted">${esc(ACTION_LABEL[l.action] || '')}</span></td><td class="mono">${esc(l.targetId || '')}</td><td>${esc(l.details)}</td></tr>`;
    }).join('');
    return `<div class="sched-head"><h2 class="sub-h first">${plural(list.length, 'event')}</h2>
        <label class="sortsel"><span>Action</span><select id="logFilter"><option value="">All actions</option>${actions.map(a => `<option value="${a}"${S.logFilter === a ? ' selected' : ''}>${esc(ACTION_LABEL[a] || a)}</option>`).join('')}</select></label></div>
      ${list.length ? `<div class="tbl"><table class="logs"><thead><tr><th scope="col">When</th><th scope="col">Who</th><th scope="col">Action</th><th scope="col">Target</th><th scope="col">Details</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="empty"><p>No events for this filter.</p></div>'}`;
  }

  /* Settings */
  function settingsTab() {
    const s = V.settings, pol = s.cancellationPolicy, a = s.paymentAccounts, e = S.setErr, dr = S.setDraft || {};
    const v = (k, fallback) => (k in dr ? dr[k] : fallback);
    const fld = (k, label, type, val, hint, extra) => `<div class="field"><label for="set-${k}">${label}</label>
      <input id="set-${k}" name="${k}" type="${type}" value="${esc(v(k, val))}"${extra || ''}${e[k] ? ` aria-invalid="true" aria-describedby="err-set-${k}"` : hint ? ` aria-describedby="hint-set-${k}"` : ''}>
      ${hint ? `<p class="hint" id="hint-set-${k}">${hint}</p>` : ''}${e[k] ? `<p class="ferr" id="err-set-${k}">${esc(e[k])}</p>` : ''}</div>`;
    const num = (lo, hi) => ` inputmode="numeric" min="${lo}" max="${hi}" step="1"`;
    const check = (k, label, on, hint) => `<div class="field check"><label><input type="checkbox" name="${k}"${v(k, on) ? ' checked' : ''}> ${label}</label>${hint ? `<p class="hint">${hint}</p>` : ''}</div>`;
    const qr = 'qrImage' in dr ? dr.qrImage : a.qrph.qrImage;
    return `<form id="settingsForm" novalidate><div class="setgrid">
      <section class="sheet"><h2>Reservations</h2><div class="sheet-in">
        ${fld('depositPercentage', 'Default deposit percentage', 'number', s.depositPercentage, 'Share of the court total paid up front. Courts without their own deposit use this. Applies to new reservations.', num(0, 100))}
        ${fld('reservationHoldMinutes', 'Hold duration, minutes', 'number', s.reservationHoldMinutes, 'How long a slot stays held while a player pays online.', num(5, 60))}
        ${fld('cashPaymentMinutes', 'Cash payment deadline, minutes', 'number', s.cashPaymentMinutes, 'How long a cash reservation waits for the deposit at the desk.', num(10, 240))}
      </div></section>
      <section class="sheet"><h2>Cancellation policy</h2><div class="sheet-in">
        ${check('cancellationEnabled', 'Players can cancel online', pol.enabled, 'When off, players see “Contact the front desk”. Staff can always cancel.')}
        ${check('refundEligible', 'Refund deposits for early cancellations', pol.refundEligible)}
        ${fld('minimumHoursBeforeBooking', 'Refund cut-off, hours before the slot', 'number', pol.minimumHoursBeforeBooking, 'Cancelling later than this is not refunded.', num(0, 168))}
        ${fld('refundPercentage', 'Refund percentage', 'number', pol.refundPercentage, 'Share of the amount paid that is refunded, after staff review.', num(0, 100))}
      </div></section>
      ${['gcash', 'maya'].map(k => `<section class="sheet"><h2>${k === 'gcash' ? 'GCash' : 'Maya'}</h2><div class="sheet-in">
        ${fld(k + 'Number', (k === 'gcash' ? 'GCash' : 'Maya') + ' number', 'tel', a[k].number, 'Players send the deposit here. Keep the XX placeholder until the account is ready.', ' autocomplete="off"')}
        ${fld(k + 'Name', 'Account name', 'text', a[k].name, '', ' autocomplete="off"')}</div></section>`).join('')}
      <section class="sheet"><h2>QR Ph</h2><div class="sheet-in">
        ${fld('qrMerchantName', 'Merchant name', 'text', a.qrph.merchantName, 'Shown next to the QR code.', ' autocomplete="off"')}
        <div class="field"><span class="label" id="lbl-set-qr">Facility QR code</span>
          <div class="qr-set"><div class="qr">${qr ? `<img src="${esc(qr)}" alt="QR Ph code">` : qrSVG(a.qrph.merchantName) + '<span class="qr-tag">Sample</span>'}</div>
            <div class="qr-ctl"><label class="btn btn-sm" for="set-qr">Choose QR image</label><input class="sr-only" type="file" id="set-qr" accept="image/png,image/jpeg,image/webp" aria-labelledby="lbl-set-qr">
              ${qr ? btn('qr-clear', 'Remove', 'btn-ghost') : ''}<p class="hint">The new code is used once you save. Until one is set, players see a labelled sample.</p>${e.qr ? `<p class="ferr">${esc(e.qr)}</p>` : ''}</div></div></div>
      </div></section>
    </div>
    <p class="placeholder settings-note"><b>${MODE === 'demo' ? 'Demo' : 'Server'}</b><span>${MODE === 'demo' ? 'In demo mode these settings are saved in this browser.' : 'Saved to data/db.json.'} In production, wallet numbers and QR payloads belong in server configuration, not page source.</span></p>
    <div class="set-actions"><button type="submit" class="btn btn-primary"${S.setBusy ? ' disabled aria-busy="true"' : ''}>${S.setBusy ? '<span class="spin" aria-hidden="true"></span>Saving' : 'Save settings'}</button></div></form>`;
  }
  async function saveSettings(form) {
    const f = Object.fromEntries(new FormData(form).entries());
    f.cancellationEnabled = !!form.elements.cancellationEnabled.checked;
    f.refundEligible = !!form.elements.refundEligible.checked;
    if (S.setDraft && 'qrImage' in S.setDraft) f.qrImage = S.setDraft.qrImage;
    S.setDraft = Object.assign({}, S.setDraft, f); S.setBusy = true; render();
    const out = await act('settings.update', f);
    S.setBusy = false;
    if (!out.ok) { S.setErr = out.error.fields || { qr: out.error.message }; S.focusSel = '#settingsForm [aria-invalid="true"]'; render(); return; }
    S.setErr = {}; S.setDraft = null;
    render(); toast('Settings saved.');
  }
  function handleQrUpload(el) {
    const file = el.files && el.files[0];
    if (!file) return;
    readImage(file, 600, 'image/png').then(url => { S.setDraft = Object.assign({}, S.setDraft, captureSettings(), { qrImage: url }); delete S.setErr.qr; S.focusSel = '#set-qr'; render(); },
      code => { S.setErr = Object.assign({}, S.setErr, { qr: PROOF_ERR[code] || PROOF_ERR.read }); S.focusSel = '#set-qr'; render(); });
  }
  // Keep typed-but-unsaved settings when the form re-renders.
  function captureSettings() {
    const form = $('#settingsForm');
    if (!form) return {};
    const f = Object.fromEntries(new FormData(form).entries());
    f.cancellationEnabled = !!form.elements.cancellationEnabled.checked;
    f.refundEligible = !!form.elements.refundEligible.checked;
    return f;
  }

  /* ---------- Shell ---------- */
  const VIEWS = { home: renderHome, book: renderBook, checkout: renderCheckout, shop: renderShop, cart: renderCart, mine: renderMine, profile: renderProfile, login: renderLogin, signup: renderSignup, reset: renderReset, admin: renderAdmin };
  const TITLES = { home: '', book: 'Book a slot', checkout: 'Checkout', shop: 'Athlete shop', cart: 'Cart', mine: 'My reservations', profile: 'Profile', login: 'Sign in', signup: 'Create account', reset: 'Reset password', admin: 'Front desk' };
  let toastTimer = null, barObserver = null;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
  }
  function transition(update, kind) {
    const root = document.documentElement;
    if (!document.startViewTransition || reduceMotion()) { update(); return; }
    root.dataset.vt = kind;
    try {
      const vt = document.startViewTransition(update);
      const done = () => { if (root.dataset.vt === kind) delete root.dataset.vt; };
      // A skipped transition rejects ready() and finished(); both need a handler.
      vt.ready.catch(() => {});
      vt.finished.then(done, done);
    } catch (e) { delete root.dataset.vt; update(); }
  }
  function runWipe() { const w = $('.wipe'); w.classList.remove('run'); void w.offsetWidth; w.classList.add('run'); }
  $('.wipe').addEventListener('animationend', e => e.currentTarget.classList.remove('run'));
  function setHeader() {
    const top = $('#top');
    top.classList.toggle('solid', window.scrollY > 12);
    // On the desktop rail the header sits beside the page, so nothing needs clearing at the top.
    document.documentElement.style.setProperty('--hh', (isRail() ? 0 : top.offsetHeight) + 'px');
  }
  function moveInd() {
    const nav = $('#mainnav'), ind = nav.querySelector('.nav-ind'), cur = nav.querySelector('[aria-current="page"]');
    if (!ind) return;
    if (!cur || !cur.offsetWidth) { ind.style.opacity = '0'; return; }
    ind.style.opacity = '1';
    if (isRail()) { ind.style.width = '100%'; ind.style.height = cur.offsetHeight + 'px'; ind.style.transform = 'translateY(' + cur.offsetTop + 'px)'; }
    else { ind.style.height = '100%'; ind.style.width = cur.offsetWidth + 'px'; ind.style.transform = 'translateX(' + cur.offsetLeft + 'px)'; }
  }
  function render() {
    if (!V) return;
    if (S.view !== 'cart') S.lastOrder = null;
    const app = $('#app');
    const sc = app.dataset.view === S.view ? app.querySelector('.scroll-x') : null, left = sc ? sc.scrollLeft : 0;
    const html = (VIEWS[S.view] || renderHome)();
    app.innerHTML = S.view === 'home' ? html : '<div class="wrap page">' + html + '</div>';
    app.dataset.view = S.view;
    const sc2 = app.querySelector('.scroll-x');
    if (sc2 && left) sc2.scrollLeft = left;
    if (S.focusKey) { const el = app.querySelector('[data-key="' + S.focusKey + '"]'); if (el && !el.disabled) el.focus({ preventScroll: true }); S.focusKey = null; }
    if (S.focusSel) {
      const el = app.querySelector(S.focusSel);
      if (el) { el.focus({ preventScroll: S.focusSel !== 'h1' }); if (el.setSelectionRange && /^(text|search|tel|email)$/.test(el.type)) { const n = el.value.length; try { el.setSelectionRange(n, n); } catch (e) { /* not selectable */ } } }
      S.focusSel = null;
    }
    if (barObserver) { barObserver.disconnect(); barObserver = null; }
    const bar = app.querySelector('#actionbar'), panel = app.querySelector('.panel');
    if (bar && panel && 'IntersectionObserver' in window) { barObserver = new IntersectionObserver(en => { bar.hidden = en[0].isIntersecting; }, { threshold: 0.15 }); barObserver.observe(panel); }
    syncChrome();
    setHeader();
    moveInd();
    runCountUp();
    scIdx = -1;
    if (S.view === 'home') scUpdate(); else delete document.documentElement.dataset.sport;
    document.title = (TITLES[S.view] ? TITLES[S.view] + ' · ' : '') + 'Athletica Manggahan';
  }
  function go(view) {
    closeDlg(); closePanels();
    const vt = !!document.startViewTransition && !reduceMotion();
    transition(() => {
      if (vt) runWipe();
      S.view = VIEWS[view] ? view : 'home';
      S.pending = null;
      if (S.view === 'book') { S.notice = ''; ensureOpenDate(); if (S.pendingNotice) { S.notice = S.pendingNotice; S.pendingNotice = ''; } }
      if (S.view === 'admin' || S.view === 'home') S.countUp = true;
      if (S.view === 'profile') { S.profile = null; S.profileErr = {}; }
      S.focusSel = S.nextFocus || 'h1'; S.nextFocus = null;
      render();
      window.scrollTo(0, 0);
      try { history.replaceState(null, '', '#' + S.view); } catch (e) { /* sandboxed frame */ }
    }, 'page');
  }
  async function refresh(force) {
    const out = await api('session');
    if (!out.view) return;
    const was = me() ? me().id : null;
    setView(out.view);
    renderChrome();
    if ((me() ? me().id : null) !== was && !me() && ['mine', 'cart', 'checkout', 'profile', 'admin'].includes(S.view)) { S.view = 'login'; S.loginNotice = 'Your session ended. Sign in again to continue.'; }
    const busy = document.activeElement && document.activeElement.closest('form, #opts, #notif');
    if (!force && (busy || $('#dlg').open || S.drafts.res.busy || S.drafts.cart.busy)) { S.stale = true; syncChrome(); moveInd(); return; }
    S.stale = false;
    if (S.view === 'home') { const b = $('#board'); if (b) b.innerHTML = boardHTML(); syncChrome(); moveInd(); } else render();
  }
  async function busyRun(el, fn) {
    if (el.getAttribute('aria-busy') === 'true') return;
    el.setAttribute('aria-busy', 'true'); el.disabled = true;
    el.innerHTML = '<span class="spin" aria-hidden="true"></span>' + esc(el.textContent);
    await fn();
  }
  function staffAct(el, action, payload, okMsg) {
    return busyRun(el, async () => {
      const out = await act(action, payload);
      S.pending = null;
      render();
      toast(out.ok ? okMsg : out.error.message);
    });
  }
  function openNotification(n) {
    const t = n.targetId || '';
    if (isAdmin()) {
      if (n.type === 'CANCELLATION_REQUEST') { S.adminTab = 'cancellations'; S.refundFilter = 'review'; go('admin'); if (IX.can[t]) setTimeout(() => showRefund(t), 50); }
      else if (n.type === 'PAYMENT_SUBMITTED') { S.adminTab = 'payments'; S.payFilter = IX.pay[t] && IX.pay[t].status === 'PENDING' ? 'cash' : 'review'; go('admin'); }
      else if (n.type === 'ORDER_PLACED') { S.adminTab = 'orders'; go('admin'); }
      else go('admin');
      return;
    }
    go('mine');
    if (IX.res[t]) setTimeout(() => showDetails(t), 50);
  }

  /* ---------- Events ---------- */
  document.addEventListener('click', async e => {
    const openPanel = ['opts', 'notif'].find(id => !document.getElementById(id).hidden);
    if (openPanel && !e.target.closest('#opts, #notif, [data-action="options"], [data-action="notif"]')) togglePanel(openPanel, false);
    const t = e.target.closest('[data-action]');
    if (!t || !V) return;
    const d = t.dataset;
    switch (d.action) {
      case 'view': if (d.view === 'login') { S.next = null; S.loginNotice = ''; } go(d.view); break;
      case 'to-login': S.next = 'book'; S.loginNotice = 'Sign in to reserve this slot. Your selection is kept.'; go('login'); break;
      case 'sport':
        S.sport = d.sport; clearSel(); delete S.errors.slot;
        if (S.view !== 'book') go('book'); else transition(() => { ensureOpenDate(); render(); }, 'swap');
        break;
      case 'date': S.date = d.date; clearSel(); delete S.errors.slot; transition(render, 'swap'); break;
      case 'adate': S.adminDate = d.date; S.countUp = true; transition(render, 'swap'); break;
      case 'slot': clickSlot(d.court, Number(d.h)); break;
      case 'clear': clearSel(); render(); break;
      case 'to-form': {
        if (!me()) { S.next = 'book'; S.loginNotice = 'Sign in to reserve this slot. Your selection is kept.'; go('login'); break; }
        const panel = $('.panel');
        if (panel) panel.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' });
        const first = $('#f-phone') || $('#bookForm button[type=submit]');
        if (first) setTimeout(() => first.focus({ preventScroll: true }), reduceMotion() ? 0 : 350);
        break;
      }
      case 'grab':
        S.sport = d.sport; S.date = d.date; clearSel(); S.sel = { court: d.court, hours: [Number(d.h)] }; S.errors = {};
        S.pendingNotice = `We picked ${IX.court[d.court].name} at ${fmtHour(Number(d.h))} for you. ${me() ? 'Add your details to hold it' : 'Sign in to hold it'}, or tap a neighbouring hour to extend.`;
        go('book');
        break;
      case 'sc-jump': scJump(Number(d.i)); break;
      case 'copy': copyText(t, d.ref); break;
      case 'close': closeDlg(); S.rx = null; if (S.stale) refresh(true); break;
      case 'keep': S.pending = null; if (!$('#opts').hidden) togglePanel('opts', true); else render(); break;
      case 'options': togglePanel('opts'); break;
      case 'notif': togglePanel('notif'); break;
      case 'theme': applyTheme(d.mode, true); togglePanel('opts', true); { const f = $(`#opts [data-mode="${d.mode}"]`); if (f) f.focus(); } break;
      case 'logout': logout(); break;
      case 'reset-demo': S.pending = 'reset-demo'; togglePanel('opts', true); break;
      case 'reset-demo-confirm':
        ls.del(DEMO_DB); ls.del(DEMO_SESS); ls.del(DEMO_TOKEN); ls.del('athletica-celebrated');
        await startDemo(); S.pending = null; S.co = null; closePanels(); await refresh(true); renderChrome(); go('home'); toast('Demo data reset.');
        break;
      case 'notif-read-all': await act('notifications.read', {}); renderChrome(); togglePanel('notif', true); break;
      case 'notif-open': {
        const n = (V.notifications || []).find(x => x.id === d.id);
        closePanels();
        if (n && !n.read) { await act('notifications.read', { ids: [n.id] }); renderChrome(); }
        if (n) openNotification(n);
        break;
      }
      case 'demo-fill': S.login.username = d.u; S.login.password = d.p; S.login.err = ''; S.focusSel = '#loginForm button[type=submit]'; render(); break;
      case 'pw-toggle': S.login.show = !S.login.show; S.focusSel = '[data-action="pw-toggle"]'; render(); break;
      case 'pw-show': S[d.form].show = !S[d.form].show; S.focusSel = `[data-action="pw-show"][data-form="${d.form}"]`; render(); break;
      case 'to-reset': S.reset = blankReset(); S.reset.identifier = S.login.username; go('reset'); break;
      case 'reset-resend': requestReset(true); break;
      case 'auth-go': S.loginNotice = ''; go(d.view); break;
      case 'reset-restart': { const id = S.reset.identifier; S.reset = blankReset(); S.reset.identifier = id; S.focusSel = '#reset-identifier'; render(); break; }
      case 'details': showDetails(d.id); break;
      case 'ticket': { const r = IX.res[d.id]; if (r) showTicket(r); break; }
      case 'receipt': showReceipt(d.id); break;
      case 'copy-receipt': { const r = IX.res[d.id]; if (r) copyText(t, receiptText(r)); break; }
      case 'download-receipt': downloadReceipt(d.id); break;
      case 'cancel': openCancel(d.id); break;
      case 'cx-confirm': cxConfirm(); break;
      case 'cx-history': closeDlg(); if (S.view === 'mine') { render(); window.scrollTo(0, 0); } else go('mine'); break;
      case 'pay-open': openCheckout(d.id); break;
      case 'co-next': S.co.step = 'pay'; S.focusSel = 'h1'; render(); window.scrollTo(0, 0); break;
      case 'co-back': S.co.step = 'review'; S.focusSel = 'h1'; render(); window.scrollTo(0, 0); break;
      case 'release': {
        const r = IX.res[d.id];
        await busyRun(t, async () => { const out = await act('reservation.release', { reservationId: d.id }); if (!out.ok) toast(out.error.message); });
        if (r) { S.sport = r.sportId; S.date = r.date; }
        S.co = null; go('book'); toast('Slot released.');
        break;
      }
      case 'rebook': { const r = IX.res[d.id]; if (r) { S.sport = r.sportId; S.date = r.date; } S.co = null; go('book'); break; }
      case 'addon': changeAddon(d.id, Number(d.step)); break;
      case 'qty': changeQty(d.id, Number(d.step)); break;
      case 'add-cart': addToCart(d.id); break;
      case 'cart-qty': setCartQty(d.id, cartQty(d.id) + Number(d.step), `[data-action="cart-qty"][data-id="${d.id}"][data-step="${d.step}"]:not(:disabled)`); break;
      case 'cart-remove': await setCartQty(d.id, 0, 'h1'); toast('Removed from your cart.'); break;
      case 'shop-cat': S.shopCat = d.cat; S.focusSel = `[data-action="shop-cat"][data-cat="${d.cat}"]`; render(); break;
      case 'shop-reset': S.shopQ = ''; S.shopCat = 'all'; S.focusSel = '#shopQ'; render(); break;
      case 'order-cancel-ask': S.pending = 'ord:' + d.id; S.focusSel = '[data-action="order-cancel"]'; render(); break;
      case 'order-cancel': staffAct(t, 'order.cancel', { orderId: d.id }, 'Order cancelled.'); break;
      case 'order-collect': staffAct(t, 'order.collect', { orderId: d.id }, 'Order marked collected.'); break;
      case 'admin-tab': S.adminTab = d.tab; S.pending = null; S.setErr = {}; S.setDraft = null; S.courtErr = {}; S.countUp = true; S.focusSel = `[data-action="admin-tab"][data-tab="${d.tab}"]`; transition(render, 'swap'); break;
      case 'pay-filter': S.payFilter = d.filter; S.pending = null; S.focusSel = `[data-action="pay-filter"][data-filter="${d.filter}"]`; render(); break;
      case 'refund-filter': S.refundFilter = d.filter; S.focusSel = `[data-action="refund-filter"][data-filter="${d.filter}"]`; render(); break;
      case 'pay-approve': { const p = IX.pay[d.id]; staffAct(t, 'payment.review', { paymentId: d.id, decision: 'approve' }, p && p.orderId ? 'Order paid. Ready for pickup.' : 'Payment approved. Reservation confirmed.'); break; }
      case 'pay-reupload': staffAct(t, 'payment.review', { paymentId: d.id, decision: 'reupload' }, 'Asked the player for a clearer screenshot.'); break;
      case 'pay-reject-ask': S.pending = 'rej:' + d.id; S.focusSel = '[data-action="pay-reject"]'; render(); break;
      case 'pay-reject': staffAct(t, 'payment.review', { paymentId: d.id, decision: 'reject' }, 'Payment rejected. The player can resubmit.'); break;
      case 'proof-view': showProof(d.id); break;
      case 'checkin': staffAct(t, 'reservation.checkin', { reservationId: d.id }, 'Checked in. Collect the balance at the desk.'); break;
      case 'refund-open': S.rx = null; showRefund(d.id); break;
      case 'refund-approve': decideRefund(d.id, 'approve', t); break;
      case 'refund-deny': decideRefund(d.id, 'deny', t); break;
      case 'refund-complete': decideRefund(d.id, 'complete', t); break;
      case 'rx-confirm': S.rx.confirm = true; showRefund(S.rx.id); break;
      case 'rx-unconfirm': S.rx.confirm = false; showRefund(S.rx.id); break;
      case 'stock': staffAct(t, 'product.update', { productId: d.id, stockDelta: Number(d.step) }, 'Stock updated.').then(() => { S.focusSel = `[data-action="stock"][data-id="${d.id}"][data-step="${d.step}"]:not(:disabled)`; render(); }); break;
      case 'product-toggle': { const p = IX.product[d.id]; staffAct(t, 'product.update', { productId: d.id, status: p.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' }, p.status === 'ACTIVE' ? p.name + ' hidden from the shop.' : p.name + ' is back in the shop.'); break; }
      case 'qr-clear': S.setDraft = Object.assign({}, S.setDraft, captureSettings(), { qrImage: '' }); render(); toast('QR code will be removed when you save.'); break;
    }
  });
  document.addEventListener('input', e => {
    const el = e.target;
    if (el.id === 'q') { S.q = el.value; const box = $('#sched'); if (box) box.innerHTML = scheduleHTML(); return; }
    if (el.id === 'shopQ') { S.shopQ = el.value; const g = $('#pgrid'); if (g) g.innerHTML = gridHTML(); return; }
    if (el.id === 'custQ') { S.custQ = el.value; S.focusSel = '#custQ'; render(); return; }
    if (el.id === 'lg-user') { S.login.username = el.value; return; }
    if (el.id === 'lg-pass') { S.login.password = el.value; return; }
    if (el.dataset.su || el.dataset.rs) {
      const form = el.dataset.su ? 'signup' : 'reset', st = S[form];
      st[el.name] = el.value;
      if (st.err[el.name]) { delete st.err[el.name]; el.removeAttribute('aria-invalid'); const m = document.getElementById('err-' + el.id); if (m) m.remove(); }
      // Update the password checklist in place so focus and caret stay put.
      const pwKey = form === 'signup' ? 'password' : 'newPassword';
      if (el.name === pwKey || (form === 'signup' && el.name === 'username')) {
        const box = document.getElementById('rules-' + form + '-' + pwKey);
        const user = form === 'signup' ? st.username : (st.identifier.includes('@') ? '' : st.identifier);
        if (box) box.outerHTML = pwRules('rules-' + form + '-' + pwKey, st[pwKey], user);
      }
      return;
    }
    if (el.id === 'cx-other') { S.cx.otherText = el.value; return; }
    if (el.dataset.rx) { S.rx.note = el.value; return; }
    if (el.form && el.form.id === 'bookForm' && el.type !== 'radio' && el.name in S.form) {
      S.form[el.name] = el.value;
      if (S.errors[el.name]) { delete S.errors[el.name]; el.removeAttribute('aria-invalid'); el.removeAttribute('aria-describedby'); const m = document.getElementById('err-' + el.name); if (m) m.remove(); }
      return;
    }
    if (el.dataset.draft) {
      const d = S.drafts[el.dataset.draft];
      d[el.name] = el.value;
      if (d.err[el.name]) { delete d.err[el.name]; el.removeAttribute('aria-invalid'); const m = document.getElementById('err-' + el.id); if (m) m.remove(); }
    }
  });
  document.addEventListener('change', e => {
    const el = e.target;
    if (el.name === 'type' && el.form && el.form.id === 'bookForm') {
      S.form.type = el.value; $('#teamFields').hidden = el.value !== 'TEAM'; $('#price').innerHTML = priceHTML();
    } else if (el.name && el.name.indexOf('method-') === 0) {
      const ctx = el.name.slice(7), d = S.drafts[ctx];
      d.method = el.value; d.err = {};
      S.focusSel = `[name="method-${ctx}"][value="${el.value}"]`;
      render();
    } else if (el.id === 'shopSort') { S.shopSort = el.value; const g = $('#pgrid'); if (g) g.innerHTML = gridHTML(); }
    else if (el.id === 'logFilter') { S.logFilter = el.value; S.focusSel = '#logFilter'; render(); }
    else if (el.id === 'cx-reason') { S.cx.reasonId = el.value; S.cx.err = {}; renderCx(); const r = $('#cx-reason'); if (r) r.focus(); }
    else if (el.type === 'file' && el.dataset.proof) handleProof(el);
    else if (el.id === 'set-qr') handleQrUpload(el);
  });
  document.addEventListener('submit', async e => {
    const f = e.target, id = f.id;
    e.preventDefault();
    if (id === 'bookForm') reserve();
    else if (id === 'payForm') submitResPayment();
    else if (id === 'orderForm') placeOrder();
    else if (id === 'loginForm') login();
    else if (id === 'signupForm') signup();
    else if (id === 'resetRequestForm') requestReset(false);
    else if (id === 'resetForm') doReset();
    else if (id === 'profileForm') saveProfile(f);
    else if (id === 'settingsForm') saveSettings(f);
    else if (id === 'cxForm') cxContinue();
    else if (f.dataset.courtForm) {
      const fd = Object.fromEntries(new FormData(f).entries()), cid = f.dataset.courtForm;
      const b = f.querySelector('button[type=submit]');
      await busyRun(b, async () => {
        const out = await act('court.update', Object.assign({ courtId: cid }, fd));
        S.courtErr = out.ok ? {} : { [cid]: out.error.message };
        render(); toast(out.ok ? courtLabel(cid) + ' saved.' : out.error.message);
      });
    } else if (f.dataset.priceForm) {
      const pid = f.dataset.priceForm, price = f.elements.price.value, b = f.querySelector('button[type=submit]');
      staffAct(b, 'product.update', { productId: pid, price: Number(price) }, IX.product[pid].name + ' price saved.');
    }
  });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const open = ['opts', 'notif'].find(id => !document.getElementById(id).hidden);
    if (open) { togglePanel(open, false); const tr = document.querySelector(`[aria-controls="${open}"]`); if (tr) tr.focus(); }
  });
  $('#dlg').addEventListener('close', () => { S.cx = null; S.rx = null; if (S.stale) refresh(true); });
  $('#dlg').addEventListener('click', e => { if (e.target === e.currentTarget) closeDlg(); });
  if (mq) { const onMq = () => { if (V && S.view === 'book') render(); }; if (mq.addEventListener) mq.addEventListener('change', onMq); else if (mq.addListener) mq.addListener(onMq); }
  window.addEventListener('resize', () => { setHeader(); moveInd(); if (V && S.view === 'home') scUpdate(); });

  /* ---------- Timers ---------- */
  let lastAnnounce = '', expiring = false;
  setInterval(() => {
    const c = $('#clock');
    if (c) { const p = clockParts(); if (c.textContent !== p.time) c.textContent = p.time; const dd = $('#clockDate'); if (dd && dd.textContent !== p.date) dd.textContent = p.date; }
    document.querySelectorAll('[data-until]').forEach(el => { el.textContent = mmss(msUntil(el.dataset.until)); });
    const rs = document.querySelector('[data-resend-at]');
    if (rs && !S.reset.busy) { const w = Math.ceil((Number(rs.dataset.resendAt) - Date.now()) / 1000); const txt = w > 0 ? `Send a new code in ${w}s` : 'Send a new code'; if (rs.textContent !== txt) { rs.textContent = txt; rs.disabled = w > 0; } }
    if (!V) return;
    const r = S.view === 'checkout' ? coRes() : null;
    if (r && r.status === 'PENDING_PAYMENT' && r.holdExpiresAt) {
      const left = msUntil(r.holdExpiresAt), bar = $('.holdbar');
      if (bar) bar.classList.toggle('urgent', left < 180000);
      const msg = left <= 0 ? '' : left < 60000 ? 'Less than one minute left on your hold.' : left < 300000 ? 'Five minutes left on your hold.' : '';
      const an = $('#holdAnnounce');
      if (an && msg && msg !== lastAnnounce) { an.textContent = msg; lastAnnounce = msg; }
    }
    // When a hold runs out, ask the server: it expires the hold and frees the slot.
    const due = (V.reservations || []).some(x => x.status === 'PENDING_PAYMENT' && x.holdExpiresAt && msUntil(x.holdExpiresAt) <= 0);
    if (due && !expiring) {
      expiring = true;
      refresh(S.view === 'checkout').then(() => { expiring = false; if (S.view === 'checkout' && coRes() && coRes().status === 'EXPIRED') toast('Your hold expired, so the slot went back on the schedule.'); });
    }
  }, 1000);
  // Pick up changes made elsewhere (the front desk in another tab or device) without a reload.
  setInterval(async () => {
    if (!V || document.visibilityState !== 'visible' || MODE !== 'server') return;
    const out = await api('ping');
    if (out.ok && out.rev !== V.rev) refresh();
  }, 15000);
  setInterval(() => { if (V && document.visibilityState === 'visible' && S.view === 'home') { const b = $('#board'); if (b) b.innerHTML = boardHTML(); } }, 60000);
  window.addEventListener('storage', e => { if (MODE === 'demo' && e.key === DEMO_DB && demo) { demo.reload(); refresh(); } });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { setHeader(); moveInd(); });

  /* ---------- Boot ---------- */
  (async function boot() {
    try {
      MODE = await detectMode();
      if (MODE === 'demo') await startDemo();
      const out = await api('session');
      if (!out.view) throw new Error(out.error ? out.error.message : 'No data');
      setView(out.view);
      S.form.phone = me() ? me().phone : '';
      const want = location.hash.slice(1);
      if (VIEWS[want]) S.view = want;
      if (S.view === 'checkout' && !S.co) S.view = isPlayer() ? 'mine' : 'home';
      if (S.view === 'book') ensureOpenDate();
      renderChrome();
      render();
    } catch (e) {
      $('#app').innerHTML = '<div class="wrap page"><div class="empty"><h2>Athletica Manggahan couldn’t start.</h2><p>Reload the page. If it keeps happening, restart the server with <code>node server.js</code>.</p></div></div>';
    }
  })();
})();
