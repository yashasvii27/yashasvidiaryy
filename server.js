/**
 * GlowUp Diary — Backend Server
 * Pure Node.js, zero external dependencies.
 * Uses built-in: http, crypto, fs, path
 *
 * Run: node server.js
 * Default port: 3001
 */

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
const DATA_FILE = path.join(__dirname, 'data', 'db.json');
const JWT_SECRET = process.env.JWT_SECRET || 'glowup-secret-change-in-production-' + Date.now();
const TOKEN_TTL_HOURS = 720; // 30 days

// ─── DATA STORE ──────────────────────────────────────────────────────────────
// db.json structure:
// {
//   users: { email: { name, email, passwordHash, passwordSalt, joined, uid } },
//   userData: { uid: { ...all user app data } }
// }

function ensureDataDir() {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ users: {}, userData: {} }, null, 2));
  }
}

function readDB() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    return { users: {}, userData: {} };
  }
}

function writeDB(db) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
    return true;
  } catch (e) {
    console.error('writeDB error:', e);
    return false;
  }
}

// ─── CRYPTO ──────────────────────────────────────────────────────────────────
function hashPassword(password, salt) {
  if (!salt) salt = crypto.randomBytes(32).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha256').toString('hex');
  return { hash, salt };
}

function verifyPassword(password, hash, salt) {
  const result = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha256').toString('hex');
  return crypto.timingSafeEqual(Buffer.from(result, 'hex'), Buffer.from(hash, 'hex'));
}

function generateUID() {
  return crypto.randomBytes(16).toString('hex');
}

// ─── JWT (hand-rolled, no library) ───────────────────────────────────────────
function b64url(str) {
  return Buffer.from(str).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function createToken(payload) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_HOURS * 3600;
  const body = b64url(JSON.stringify({ ...payload, exp, iat: Math.floor(Date.now() / 1000) }));
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(header + '.' + body).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  return `${header}.${body}.${sig}`;
}

function verifyToken(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, body, sig] = parts;
    const expectedSig = crypto.createHmac('sha256', JWT_SECRET).update(header + '.' + body).digest('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    if (sig !== expectedSig) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64').toString('utf8'));
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

// ─── HTTP HELPERS ─────────────────────────────────────────────────────────────
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 10 * 1024 * 1024) reject(new Error('Body too large')); });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function send(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  });
  res.end(body);
}

function getToken(req) {
  const auth = req.headers['authorization'] || '';
  return auth.startsWith('Bearer ') ? auth.slice(7) : null;
}

function requireAuth(req, res) {
  const token = getToken(req);
  if (!token) { send(res, 401, { error: 'No token provided' }); return null; }
  const payload = verifyToken(token);
  if (!payload) { send(res, 401, { error: 'Invalid or expired token' }); return null; }
  return payload;
}

// ─── STATIC FILE SERVING ──────────────────────────────────────────────────────
const STATIC_DIR = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

function serveStatic(req, res, urlPath) {
  let filePath = path.join(STATIC_DIR, urlPath === '/' ? 'index.html' : urlPath);
  // Security: prevent path traversal
  if (!filePath.startsWith(STATIC_DIR)) { send(res, 403, { error: 'Forbidden' }); return; }
  if (!fs.existsSync(filePath)) {
    // SPA fallback: serve index.html for non-API routes
    const indexPath = path.join(STATIC_DIR, 'index.html');
    if (fs.existsSync(indexPath)) {
      filePath = indexPath;
    } else {
      send(res, 404, { error: 'Not found' });
      return;
    }
  }
  const ext = path.extname(filePath);
  const mime = MIME[ext] || 'application/octet-stream';
  const content = fs.readFileSync(filePath);
  res.writeHead(200, { 'Content-Type': mime, 'Access-Control-Allow-Origin': '*' });
  res.end(content);
}

// ─── RATE LIMITING (simple in-memory) ────────────────────────────────────────
const rateLimitMap = new Map();
function rateLimit(ip, limit = 10, windowMs = 60000) {
  const now = Date.now();
  const key = ip;
  if (!rateLimitMap.has(key)) rateLimitMap.set(key, { count: 0, start: now });
  const entry = rateLimitMap.get(key);
  if (now - entry.start > windowMs) { entry.count = 0; entry.start = now; }
  entry.count++;
  return entry.count > limit;
}
// Clean rate limit map every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of rateLimitMap) { if (now - v.start > 60000) rateLimitMap.delete(k); }
}, 300000);

// ─── ROUTES ───────────────────────────────────────────────────────────────────
async function handleAPI(req, res, urlPath) {
  const method = req.method;
  const ip = req.socket.remoteAddress || '';

  // ── POST /api/signup ──────────────────────────────────────────────────────
  if (method === 'POST' && urlPath === '/api/signup') {
    if (rateLimit(ip + ':signup', 5, 60000)) {
      return send(res, 429, { error: 'Too many attempts. Try again in a minute.' });
    }
    let body;
    try { body = await parseBody(req); } catch { return send(res, 400, { error: 'Invalid JSON' }); }

    const { name, email, password } = body;
    if (!name || !email || !password) return send(res, 400, { error: 'Name, email and password are required' });
    if (name.trim().length < 1) return send(res, 400, { error: 'Name cannot be empty' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return send(res, 400, { error: 'Invalid email address' });
    if (password.length < 6) return send(res, 400, { error: 'Password must be at least 6 characters' });

    const db = readDB();
    const emailKey = email.toLowerCase().trim();
    if (db.users[emailKey]) return send(res, 409, { error: 'An account with this email already exists' });

    const { hash, salt } = hashPassword(password);
    const uid = generateUID();
    const joined = new Date().toISOString();

    db.users[emailKey] = { name: name.trim(), email: emailKey, passwordHash: hash, passwordSalt: salt, joined, uid };
    db.userData[uid] = {}; // empty initial data — frontend will push its defaults
    writeDB(db);

    const token = createToken({ uid, email: emailKey, name: name.trim() });
    return send(res, 201, { token, user: { name: name.trim(), email: emailKey, uid, joined } });
  }

  // ── POST /api/login ───────────────────────────────────────────────────────
  if (method === 'POST' && urlPath === '/api/login') {
    if (rateLimit(ip + ':login', 10, 60000)) {
      return send(res, 429, { error: 'Too many login attempts. Try again in a minute.' });
    }
    let body;
    try { body = await parseBody(req); } catch { return send(res, 400, { error: 'Invalid JSON' }); }

    const { email, password } = body;
    if (!email || !password) return send(res, 400, { error: 'Email and password are required' });

    const db = readDB();
    const emailKey = email.toLowerCase().trim();
    const user = db.users[emailKey];

    if (!user) return send(res, 401, { error: 'No account found with this email' });
    let valid = false;
    try { valid = verifyPassword(password, user.passwordHash, user.passwordSalt); } catch { valid = false; }
    if (!valid) return send(res, 401, { error: 'Incorrect password' });

    const token = createToken({ uid: user.uid, email: emailKey, name: user.name });
    return send(res, 200, { token, user: { name: user.name, email: emailKey, uid: user.uid, joined: user.joined } });
  }

  // ── GET /api/me ───────────────────────────────────────────────────────────
  if (method === 'GET' && urlPath === '/api/me') {
    const auth = requireAuth(req, res); if (!auth) return;
    const db = readDB();
    const user = db.users[auth.email];
    if (!user) return send(res, 404, { error: 'User not found' });
    return send(res, 200, { name: user.name, email: user.email, uid: user.uid, joined: user.joined });
  }

  // ── GET /api/data ─────────────────────────────────────────────────────────
  if (method === 'GET' && urlPath === '/api/data') {
    const auth = requireAuth(req, res); if (!auth) return;
    const db = readDB();
    const data = db.userData[auth.uid] || {};
    return send(res, 200, { data });
  }

  // ── PUT /api/data ─────────────────────────────────────────────────────────
  // Full state replace (sent from client on save)
  if (method === 'PUT' && urlPath === '/api/data') {
    const auth = requireAuth(req, res); if (!auth) return;
    let body;
    try { body = await parseBody(req); } catch { return send(res, 400, { error: 'Invalid JSON' }); }

    // Strip sensitive fields just in case
    delete body.password; delete body.passwordHash; delete body.passwordSalt;

    const db = readDB();
    db.userData[auth.uid] = { ...body, _savedAt: Date.now() };
    writeDB(db);
    return send(res, 200, { ok: true });
  }

  // ── POST /api/change-password ─────────────────────────────────────────────
  if (method === 'POST' && urlPath === '/api/change-password') {
    const auth = requireAuth(req, res); if (!auth) return;
    let body;
    try { body = await parseBody(req); } catch { return send(res, 400, { error: 'Invalid JSON' }); }

    const { currentPassword, newPassword } = body;
    if (!currentPassword || !newPassword) return send(res, 400, { error: 'Both passwords required' });
    if (newPassword.length < 6) return send(res, 400, { error: 'New password must be at least 6 characters' });

    const db = readDB();
    const user = db.users[auth.email];
    if (!user) return send(res, 404, { error: 'User not found' });
    if (!verifyPassword(currentPassword, user.passwordHash, user.passwordSalt)) {
      return send(res, 401, { error: 'Current password is incorrect' });
    }
    const { hash, salt } = hashPassword(newPassword);
    user.passwordHash = hash;
    user.passwordSalt = salt;
    writeDB(db);
    return send(res, 200, { ok: true });
  }

  // 404
  return send(res, 404, { error: 'API route not found' });
}

// ─── MAIN SERVER ──────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const urlPath = req.url.split('?')[0];

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    });
    return res.end();
  }

  // API routes
  if (urlPath.startsWith('/api/')) {
    return handleAPI(req, res, urlPath).catch(err => {
      console.error('API error:', err);
      send(res, 500, { error: 'Internal server error' });
    });
  }

  // Static files
  serveStatic(req, res, urlPath);
});

ensureDataDir();
server.listen(PORT, () => {
  console.log(`\n🌸 GlowUp Diary Server running on http://localhost:${PORT}`);
  console.log(`📁 Serving frontend from: ${STATIC_DIR}`);
  console.log(`💾 Database: ${DATA_FILE}\n`);
});

// Graceful shutdown
process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
process.on('SIGINT', () => { server.close(() => process.exit(0)); });
