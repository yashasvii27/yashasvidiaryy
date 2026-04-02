/**
 * GlowUp Diary — Backend Server
 * Pure Node.js, zero npm dependencies.
 * Uses Turso (hosted SQLite) via HTTP API for permanent storage.
 *
 * Required environment variables on Render:
 *   TURSO_URL    — e.g. https://glowup-yashasvii27.turso.io
 *   TURSO_TOKEN  — your Turso auth token
 *   JWT_SECRET   — any long random string
 */

const http   = require('http');
const https  = require('https');
const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

const PORT        = process.env.PORT || 3001;
const JWT_SECRET  = process.env.JWT_SECRET || 'glowup-change-me-' + crypto.randomBytes(8).toString('hex');
const TURSO_URL   = (process.env.TURSO_URL || '').replace(/\/$/, '').replace('libsql://', 'https://');
const TURSO_TOKEN = process.env.TURSO_TOKEN || '';
const TOKEN_TTL   = 720 * 3600; // 30 days

if (!TURSO_URL || !TURSO_TOKEN) {
  console.warn('WARNING: TURSO_URL and TURSO_TOKEN not set. DB calls will fail.');
}

// ─── TURSO HTTP API ───────────────────────────────────────────────────────────
function tursoRequest(statements) {
  const body = JSON.stringify({
    requests: statements.map(s => ({
      type: 'execute',
      stmt: {
        sql: s.q,
        args: (s.params || []).map(v => {
          if (v === null || v === undefined) return { type: 'null' };
          if (typeof v === 'number') return { type: 'integer', value: String(v) };
          return { type: 'text', value: String(v) };
        }),
      },
    })).concat([{ type: 'close' }]),
  });

  return new Promise((resolve, reject) => {
    const url  = new URL('/v2/pipeline', TURSO_URL);
    const opts = {
      hostname: url.hostname,
      path:     url.pathname,
      method:   'POST',
      headers: {
        'Authorization':  'Bearer ' + TURSO_TOKEN,
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = https.request(opts, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(raw);
          for (const r of parsed.results || []) {
            if (r.type === 'error') return reject(new Error(r.error?.message || 'Turso error'));
          }
          resolve(parsed.results || []);
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function resultToRows(result) {
  if (!result || result.type !== 'ok') return [];
  const cols = (result.response?.result?.cols || []).map(c => c.name);
  const rows = result.response?.result?.rows || [];
  return rows.map(row => Object.fromEntries(cols.map((col, i) => [col, row[i]?.value ?? null])));
}

async function dbRun(sql, params = []) {
  const results = await tursoRequest([{ q: sql, params }]);
  return results[0];
}
async function dbGet(sql, params = []) {
  return resultToRows(await dbRun(sql, params))[0] || null;
}

// ─── SCHEMA ───────────────────────────────────────────────────────────────────
async function initDB() {
  try {
    await tursoRequest([
      { q: `CREATE TABLE IF NOT EXISTS users (
          uid           TEXT PRIMARY KEY,
          email         TEXT UNIQUE NOT NULL,
          name          TEXT NOT NULL,
          password_hash TEXT NOT NULL,
          password_salt TEXT NOT NULL,
          joined        TEXT NOT NULL
        )` },
      { q: `CREATE TABLE IF NOT EXISTS user_data (
          uid      TEXT PRIMARY KEY,
          data     TEXT NOT NULL DEFAULT '{}',
          saved_at INTEGER
        )` },
    ]);
    console.log('DB ready');
  } catch(e) {
    console.error('DB init error:', e.message);
  }
}

// ─── CRYPTO ──────────────────────────────────────────────────────────────────
function hashPassword(password, salt) {
  if (!salt) salt = crypto.randomBytes(32).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha256').toString('hex');
  return { hash, salt };
}
function verifyPassword(password, hash, salt) {
  try {
    const r = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha256').toString('hex');
    return crypto.timingSafeEqual(Buffer.from(r,'hex'), Buffer.from(hash,'hex'));
  } catch { return false; }
}
function generateUID() { return crypto.randomBytes(16).toString('hex'); }

// ─── JWT ─────────────────────────────────────────────────────────────────────
function b64url(s) {
  return Buffer.from(s).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
}
function createToken(payload) {
  const h = b64url(JSON.stringify({alg:'HS256',typ:'JWT'}));
  const b = b64url(JSON.stringify({...payload, exp:Math.floor(Date.now()/1000)+TOKEN_TTL, iat:Math.floor(Date.now()/1000)}));
  const s = crypto.createHmac('sha256',JWT_SECRET).update(h+'.'+b).digest('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
  return `${h}.${b}.${s}`;
}
function verifyToken(token) {
  try {
    const [h,b,s] = token.split('.');
    if(!h||!b||!s) return null;
    const exp = crypto.createHmac('sha256',JWT_SECRET).update(h+'.'+b).digest('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
    if(s!==exp) return null;
    const p = JSON.parse(Buffer.from(b,'base64').toString('utf8'));
    if(p.exp < Math.floor(Date.now()/1000)) return null;
    return p;
  } catch { return null; }
}

// ─── HTTP HELPERS ─────────────────────────────────────────────────────────────
function parseBody(req) {
  return new Promise((res,rej) => {
    let body='';
    req.on('data', c => { body+=c; if(body.length>20*1024*1024) rej(new Error('Too large')); });
    req.on('end', () => { try { res(body?JSON.parse(body):{}); } catch(e){rej(e);} });
    req.on('error', rej);
  });
}
function send(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type':'application/json',
    'Content-Length':Buffer.byteLength(body),
    'Access-Control-Allow-Origin':'*',
    'Access-Control-Allow-Methods':'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers':'Content-Type,Authorization',
  });
  res.end(body);
}
function requireAuth(req, res) {
  const auth = req.headers['authorization']||'';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if(!token){ send(res,401,{error:'No token'}); return null; }
  const p = verifyToken(token);
  if(!p){ send(res,401,{error:'Invalid or expired token — please log in again'}); return null; }
  return p;
}

// ─── RATE LIMIT ───────────────────────────────────────────────────────────────
const _rl = new Map();
function rateLimit(key, limit, ms) {
  const now=Date.now();
  if(!_rl.has(key)) _rl.set(key,{c:0,t:now});
  const e=_rl.get(key);
  if(now-e.t>ms){e.c=0;e.t=now;}
  return ++e.c > limit;
}

// ─── STATIC FILES ─────────────────────────────────────────────────────────────
const STATIC = path.join(__dirname,'public');
const MIME   = {'.html':'text/html; charset=utf-8','.css':'text/css','.js':'application/javascript','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.ico':'image/x-icon','.svg':'image/svg+xml'};
function serveStatic(req, res, urlPath) {
  let fp = path.join(STATIC, urlPath==='/'?'index.html':urlPath);
  if(!fp.startsWith(STATIC)){ send(res,403,{error:'Forbidden'}); return; }
  if(!fs.existsSync(fp)){ fp=path.join(STATIC,'index.html'); if(!fs.existsSync(fp)){ send(res,404,{error:'Not found'}); return; } }
  res.writeHead(200,{'Content-Type':MIME[path.extname(fp)]||'application/octet-stream','Access-Control-Allow-Origin':'*'});
  res.end(fs.readFileSync(fp));
}

// ─── API ──────────────────────────────────────────────────────────────────────
async function handleAPI(req, res, urlPath) {
  const m  = req.method;
  const ip = req.socket.remoteAddress||'';

  // POST /api/signup
  if (m==='POST' && urlPath==='/api/signup') {
    if(rateLimit(ip+':su',5,60000)) return send(res,429,{error:'Too many attempts. Wait a minute.'});
    let b; try{b=await parseBody(req);}catch{return send(res,400,{error:'Bad request'});}
    const {name,email,password}=b;
    if(!name?.trim()||!email?.trim()||!password) return send(res,400,{error:'Name, email and password are required'});
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return send(res,400,{error:'Invalid email address'});
    if(password.length<6) return send(res,400,{error:'Password must be at least 6 characters'});
    const key=email.toLowerCase().trim();
    const exists=await dbGet('SELECT uid FROM users WHERE email=?',[key]);
    if(exists) return send(res,409,{error:'An account with this email already exists'});
    const {hash,salt}=hashPassword(password);
    const uid=generateUID(), joined=new Date().toISOString();
    await dbRun('INSERT INTO users (uid,email,name,password_hash,password_salt,joined) VALUES (?,?,?,?,?,?)',[uid,key,name.trim(),hash,salt,joined]);
    await dbRun('INSERT INTO user_data (uid,data,saved_at) VALUES (?,?,?)',[uid,'{}',Date.now()]);
    console.log('Signup:',key);
    return send(res,201,{token:createToken({uid,email:key,name:name.trim()}),user:{name:name.trim(),email:key,uid,joined}});
  }

  // POST /api/login
  if (m==='POST' && urlPath==='/api/login') {
    if(rateLimit(ip+':li',10,60000)) return send(res,429,{error:'Too many login attempts. Wait a minute.'});
    let b; try{b=await parseBody(req);}catch{return send(res,400,{error:'Bad request'});}
    const {email,password}=b;
    if(!email||!password) return send(res,400,{error:'Email and password are required'});
    const key=email.toLowerCase().trim();
    const user=await dbGet('SELECT * FROM users WHERE email=?',[key]);
    if(!user) return send(res,401,{error:'No account found with this email'});
    if(!verifyPassword(password,user.password_hash,user.password_salt)) return send(res,401,{error:'Incorrect password'});
    console.log('Login:',key);
    return send(res,200,{token:createToken({uid:user.uid,email:key,name:user.name}),user:{name:user.name,email:key,uid:user.uid,joined:user.joined}});
  }

  // GET /api/me
  if (m==='GET' && urlPath==='/api/me') {
    const auth=requireAuth(req,res); if(!auth) return;
    const user=await dbGet('SELECT name,email,uid,joined FROM users WHERE uid=?',[auth.uid]);
    if(!user) return send(res,404,{error:'User not found'});
    return send(res,200,user);
  }

  // GET /api/data
  if (m==='GET' && urlPath==='/api/data') {
    const auth=requireAuth(req,res); if(!auth) return;
    const row=await dbGet('SELECT data FROM user_data WHERE uid=?',[auth.uid]);
    let data={}; try{data=row?JSON.parse(row.data):{};}catch{}
    return send(res,200,{data});
  }

  // PUT /api/data
  if (m==='PUT' && urlPath==='/api/data') {
    const auth=requireAuth(req,res); if(!auth) return;
    let b; try{b=await parseBody(req);}catch{return send(res,400,{error:'Bad request'});}
    delete b.password; delete b.passwordHash; delete b.passwordSalt;
    const json=JSON.stringify({...b,_savedAt:Date.now()});
    await dbRun(
      `INSERT INTO user_data (uid,data,saved_at) VALUES (?,?,?)
       ON CONFLICT(uid) DO UPDATE SET data=excluded.data, saved_at=excluded.saved_at`,
      [auth.uid,json,Date.now()]
    );
    return send(res,200,{ok:true});
  }

  // POST /api/data-beacon — called by sendBeacon on page close (no auth header support in beacon)
  // Falls through to PUT /api/data logic, but accepts text/plain content-type too
  if (m==='POST' && urlPath==='/api/data-beacon') {
    const auth=requireAuth(req,res); if(!auth) return;
    let b; try{b=await parseBody(req);}catch{return send(res,400,{error:'Bad request'});}
    delete b.password; delete b.passwordHash; delete b.passwordSalt;
    if(!b || !b.user) return send(res,400,{error:'No data'});
    const json=JSON.stringify({...b,_savedAt:Date.now()});
    await dbRun(
      `INSERT INTO user_data (uid,data,saved_at) VALUES (?,?,?)
       ON CONFLICT(uid) DO UPDATE SET data=excluded.data, saved_at=excluded.saved_at`,
      [auth.uid,json,Date.now()]
    );
    return send(res,200,{ok:true});
  }

  // POST /api/change-password
  if (m==='POST' && urlPath==='/api/change-password') {
    const auth=requireAuth(req,res); if(!auth) return;
    let b; try{b=await parseBody(req);}catch{return send(res,400,{error:'Bad request'});}
    const {currentPassword,newPassword}=b;
    if(!currentPassword||!newPassword) return send(res,400,{error:'Both passwords required'});
    if(newPassword.length<6) return send(res,400,{error:'New password must be at least 6 characters'});
    const user=await dbGet('SELECT * FROM users WHERE uid=?',[auth.uid]);
    if(!user) return send(res,404,{error:'User not found'});
    if(!verifyPassword(currentPassword,user.password_hash,user.password_salt)) return send(res,401,{error:'Current password is incorrect'});
    const {hash,salt}=hashPassword(newPassword);
    await dbRun('UPDATE users SET password_hash=?,password_salt=? WHERE uid=?',[hash,salt,auth.uid]);
    return send(res,200,{ok:true});
  }

  return send(res,404,{error:'Not found'});
}

// ─── SERVER ───────────────────────────────────────────────────────────────────
const server = http.createServer(async (req,res) => {
  const urlPath = req.url.split('?')[0];
  if(req.method==='OPTIONS'){
    res.writeHead(204,{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,PUT,DELETE,OPTIONS','Access-Control-Allow-Headers':'Content-Type,Authorization'});
    return res.end();
  }
  if(urlPath.startsWith('/api/')){
    return handleAPI(req,res,urlPath).catch(err=>{
      console.error('API error:',err.message);
      send(res,500,{error:'Internal server error'});
    });
  }
  serveStatic(req,res,urlPath);
});

initDB().then(()=>{
  server.listen(PORT,()=>{
    console.log(`\nGlowUp Diary Server running on port ${PORT}`);
    console.log(`Turso: ${TURSO_URL||'(not configured)'}`);
  });
});
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
process.on('SIGINT', ()=>server.close(()=>process.exit(0)));
