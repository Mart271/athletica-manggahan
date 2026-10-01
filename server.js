#!/usr/bin/env node
/* ATHLETICA MANGGAHAN — development server.
   Zero dependencies. Serves the app and a JSON API backed by data/db.json.
     node server.js              start on PORT (default 8123)
     node server.js --reset-db   rebuild data/db.json with fresh sample dates, then start
     node server.js --seed-only  rebuild data/db.json and exit */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const core = require('./core.js');

const ROOT = __dirname;
const DB_FILE = path.join(ROOT, 'data', 'db.json');
const PORT = Number(process.env.PORT) || 8123;
const SESSION_HOURS = 8;
const STATIC = { '/': 'index.html', '/index.html': 'index.html', '/styles.css': 'styles.css', '/app.js': 'app.js', '/core.js': 'core.js', '/logo.svg': 'logo.svg' };
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };

/* ---------- Passwords: scrypt with a per-user salt ---------- */
const hasher = {
  async hash(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    return 'scrypt$' + salt + '$' + crypto.scryptSync(password, salt, 64).toString('hex');
  },
  async verify(password, stored) {
    const [kind, salt, hex] = String(stored).split('$');
    if (kind !== 'scrypt' || !salt || !hex) return false;
    const a = crypto.scryptSync(password, salt, 64), b = Buffer.from(hex, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
};

/* ---------- JSON file store: in memory, written atomically ---------- */
let db = null;
const store = {
  load() { return db; },
  save(next) {
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
    fs.renameSync(tmp, DB_FILE);
  }
};
async function openDb(reset) {
  if (!reset && fs.existsSync(DB_FILE)) {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    return;
  }
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  db = await core.buildSeed(hasher, Date.now());
  store.save(db);
  console.log('Seeded', path.relative(ROOT, DB_FILE));
}

/* ---------- Sessions: opaque tokens in memory, expire after inactivity ---------- */
const sessionMap = new Map();
const sessions = {
  get(token) {
    const s = sessionMap.get(token);
    if (!s || s.expires < Date.now()) { sessionMap.delete(token); return null; }
    s.expires = Date.now() + SESSION_HOURS * 3600000;
    return s.userId;
  },
  set(token, userId) { sessionMap.set(token, { userId, expires: Date.now() + SESSION_HOURS * 3600000 }); },
  del(token) { sessionMap.delete(token); },
  dropUser(userId) { for (const [k, v] of sessionMap) if (v.userId === userId) sessionMap.delete(k); }
};

// No email service is connected. Reset codes are printed here, in the terminal running the server,
// and nowhere else. Replace this with a real email provider before launch.
function mailer(msg) {
  console.log(`
[dev email] ${new Date().toISOString()}
  To:      ${msg.to}
  Subject: ${msg.subject}
  ${msg.text}
`);
}

const service = core.createService({ store, hasher, sessions, mailer, random: () => crypto.randomBytes(24).toString('hex') });

// Requests are applied one at a time, so a check-then-write (like reserving a slot) can never interleave with another.
let queue = Promise.resolve();
function serial(fn) { const run = queue.then(fn, fn); queue = run.catch(() => {}); return run; }

/* ---------- HTTP ---------- */
function readCookie(req, name) {
  const m = (req.headers.cookie || '').split(/;\s*/).find(c => c.startsWith(name + '='));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : null;
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > 1024 * 1024) { reject(Object.assign(new Error('too large'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
let csp = '';
function buildCsp() {
  // Hash the one inline script (the theme bootstrap) so everything else can stay 'self' only.
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const hashes = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => `'sha256-${crypto.createHash('sha256').update(m[1]).digest('base64')}'`);
  csp = ["default-src 'self'", `script-src 'self' ${hashes.join(' ')}`, "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:",
    "font-src 'self' data:", "connect-src 'self'", "frame-ancestors 'none'", "base-uri 'none'", "form-action 'self'"].join('; ');
}
function send(res, status, body, headers) {
  res.writeHead(status, Object.assign({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'Content-Security-Policy': csp }, headers));
  res.end(body);
}
function sendJson(res, status, obj, token) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
  if (token) headers['Set-Cookie'] = `am_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_HOURS * 3600}`;
  else if (token === null) headers['Set-Cookie'] = 'am_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0';
  send(res, status, JSON.stringify(obj), headers);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) {
      const action = url.pathname.slice(5);
      if (!/^[a-zA-Z.]{2,40}$/.test(action)) return sendJson(res, 404, { ok: false, error: { message: 'Not found.' } });
      let payload = {};
      if (req.method === 'POST') {
        // JSON only: a cross-site form can't send this content type without a preflight.
        if (!/^application\/json\b/.test(req.headers['content-type'] || '')) return sendJson(res, 415, { ok: false, error: { message: 'Send JSON.' } });
        const raw = await readBody(req);
        try { payload = raw ? JSON.parse(raw) : {}; } catch (e) { return sendJson(res, 400, { ok: false, error: { message: 'That request could not be read.' } }); }
      } else if (req.method !== 'GET' || !['session', 'ping'].includes(action)) {
        return sendJson(res, 405, { ok: false, error: { message: 'Use POST for this action.' } });
      }
      const token = readCookie(req, 'am_session');
      const out = await serial(() => service.handle(action, payload, token));
      const { token: newToken, status, devMail, ...body } = out;
      return sendJson(res, out.ok ? 200 : status || 400, Object.assign(body, { mode: 'server' }), newToken);
    }
    const file = STATIC[url.pathname];
    if (!file || req.method !== 'GET') return send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
    const body = fs.readFileSync(path.join(ROOT, file));
    return send(res, 200, body, { 'Content-Type': TYPES[path.extname(file)], 'Cache-Control': 'no-cache' });
  } catch (e) {
    // Internal details go to the server log only.
    console.error(new Date().toISOString(), req.method, url.pathname, e);
    return sendJson(res, e.status === 413 ? 413 : 500, { ok: false, error: { message: e.status === 413 ? 'That upload is too large.' : 'Something went wrong on our side. Please try again.' } });
  }
});

(async () => {
  const reset = process.argv.includes('--reset-db') || process.argv.includes('--seed-only');
  await openDb(reset);
  if (process.argv.includes('--seed-only')) return;
  buildCsp();
  server.listen(PORT, () => console.log(`Athletica Manggahan on http://localhost:${PORT}  (database: ${path.relative(ROOT, DB_FILE)})`));
})();
