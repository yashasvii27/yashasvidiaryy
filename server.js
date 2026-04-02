/**
 * GlowUp Diary — Backend Server
 * Uses Supabase (Postgres) for permanent cloud storage.
 * Zero npm dependencies — pure Node.js built-ins only.
 */

const http   = require('http');
const https  = require('https');
const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

const PORT         = process.env.PORT || 3001;
const JWT_SECRET   = process.env.JWT_SECRET || 'glowup-change-me-' + crypto.randomBytes(8).toString('hex');
// Hardcoded fallbacks so it works even if env vars have issues
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '') || 'https://gmsznzdsueubimcqtagk.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'sb_secret_sdyBRto53MIoqWSVrV5gmg_R5wJdn9e';
const TOKEN_TTL    = 720 * 3600; // 30 days

console.log('Supabase URL:', SUPABASE_URL);

// ─── SUPABASE REST HELPER ─────────────────────────────────────────────────────
function sbRequest(method, endpoint, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : '';
    // Build full URL - handle both path and path?query formats
    const fullPath = '/rest/v1' + endpoint;
    const baseUrl = SUPABASE_URL.startsWith('http') ? SUPABASE_URL : 'https://' + SUPABASE_URL;
    const url = new URL(fullPath, baseUrl);
    const headers = {
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
      'Content-Type': 'application/json',
      ...extraHeaders,
    };
    if (bodyStr) headers['Content-Length'] = Buffer.byteLength(bodyStr);

    const req = https.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers,
    }, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try {
          const data = raw ? JSON.parse(raw) : null;
          if (res.statusCode >= 400) {
            const msg = (data && (data.message || data.error || data.hint)) || `HTTP ${res.statusCode}: ${raw.slice(0,200)}`;
            reject(new Error(msg));
          } else {
            resolve(data);
          }
        } catch(e) { reject(new Error('Parse error: ' + raw.slice(0,200))); }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

const sb = {
  select: (table, query = '') => sbRequest('GET', `/${table}` + (query ? '?' + query : '')),
  insert: (table, data) => sbRequest('POST', `/${table}`, data, { 'Prefer': 'return=representation' }),
  upsert: (table, data) => sbRequest('POST', `/${table}`, data, { 'Prefer': 'resolution=merge-duplicates,return=representation' }),
  update: (table, query, data) => sbRequest('PATCH', `/${table}` + (query ? '?' + query : ''), data, { 'Prefer': 'return=representation' }),
};

// ─── CRYPTO ──────────────────────────────────────────────────────────────────
function hashPassword(password, salt) {
  if (!salt) salt = crypto.randomBytes(32).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha256').toString('hex');
  return { hash, salt };
}
function verifyPassword(password, hash, salt) {
  try {
    const r = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha256').toString('hex');
    return crypto.timingSafeEqual(Buffer.from(r, 'hex'), Buffer.from(hash, 'hex'));
  } catch { return false; }
}
function uid() { return crypto.randomBytes(16).toString('hex'); }

// ─── JWT ─────────────────────────────────────────────────────────────────────
function b64u(s) { return Buffer.from(s).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,''); }
function createToken(p) {
  const h = b64u(JSON.stringify({alg:'HS256',typ:'JWT'}));
  const b = b64u(JSON.stringify({...p, exp: Math.floor(Date.now()/1000)+TOKEN_TTL, iat: Math.floor(Date.now()/1000)}));
  const s = crypto.createHmac('sha256',JWT_SECRET).update(h+'.'+b).digest('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
  return `${h}.${b}.${s}`;
}
function verifyToken(token) {
  try {
    const [h,b,s] = token.split('.');
    if (!h||!b||!s) return null;
    const exp = crypto.createHmac('sha256',JWT_SECRET).update(h+'.'+b).digest('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
    if (s !== exp) return null;
    const p = JSON.parse(Buffer.from(b,'base64').toString('utf8'));
    if (p.exp < Math.floor(Date.now()/1000)) return null;
    return p;
  } catch { return null; }
}

// ─── HTTP UTILS ───────────────────────────────────────────────────────────────
function parseBody(req) {
  return new Promise((res, rej) => {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 20*1024*1024) rej(new Error('Too large')); });
    req.on('end', () => { try { res(body ? JSON.parse(body) : {}); } catch(e) { rej(e); } });
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
function auth(req, res) {
  const t = (req.headers['authorization']||'').replace('Bearer ','');
  if (!t) { send(res,401,{error:'No token'}); return null; }
  const p = verifyToken(t);
  if (!p) { send(res,401,{error:'Session expired — please log in again'}); return null; }
  return p;
}
const _rl = new Map();
function rateLimit(key, limit, ms) {
  const now = Date.now();
  if (!_rl.has(key)) _rl.set(key,{c:0,t:now});
  const e = _rl.get(key);
  if (now-e.t > ms) { e.c=0; e.t=now; }
  return ++e.c > limit;
}

// ─── STATIC ───────────────────────────────────────────────────────────────────
const STATIC = path.join(__dirname,'public');
const MIME = {'.html':'text/html; charset=utf-8','.css':'text/css','.js':'application/javascript','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.ico':'image/x-icon'};
function serveStatic(req, res, p) {
  let fp = path.join(STATIC, p==='/'?'index.html':p);
  if (!fp.startsWith(STATIC)) { send(res,403,{error:'Forbidden'}); return; }
  if (!fs.existsSync(fp)) fp = path.join(STATIC,'index.html');
  if (!fs.existsSync(fp)) { send(res,404,{error:'Not found'}); return; }
  res.writeHead(200,{'Content-Type':MIME[path.extname(fp)]||'application/octet-stream','Access-Control-Allow-Origin':'*'});
  res.end(fs.readFileSync(fp));
}

// ─── API ──────────────────────────────────────────────────────────────────────
async function api(req, res, p) {
  const m = req.method;
  const ip = req.socket.remoteAddress||'';

  // SIGNUP
  if (m==='POST' && p==='/api/signup') {
    if (rateLimit(ip+':su',5,60000)) return send(res,429,{error:'Too many attempts. Wait a minute.'});
    let b; try{b=await parseBody(req);}catch{return send(res,400,{error:'Bad request'});}
    const {name,email,password} = b;
    if (!name?.trim()||!email?.trim()||!password) return send(res,400,{error:'Name, email and password required'});
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return send(res,400,{error:'Invalid email'});
    if (password.length<6) return send(res,400,{error:'Password must be at least 6 characters'});
    const ek = email.toLowerCase().trim();
    const exists = await sb.select('gd_users',`email=eq.${encodeURIComponent(ek)}&limit=1`);
    if (exists?.length>0) return send(res,409,{error:'An account with this email already exists'});
    const {hash,salt} = hashPassword(password);
    const id = uid(), joined = new Date().toISOString();
    await sb.insert('gd_users',{uid:id,email:ek,name:name.trim(),password_hash:hash,password_salt:salt,joined});
    await sb.insert('gd_user_data',{uid:id,data:'{}',saved_at:Date.now()});
    console.log('Signup:',ek);
    return send(res,201,{token:createToken({uid:id,email:ek,name:name.trim()}),user:{name:name.trim(),email:ek,uid:id,joined}});
  }

  // LOGIN
  if (m==='POST' && p==='/api/login') {
    if (rateLimit(ip+':li',10,60000)) return send(res,429,{error:'Too many attempts. Wait a minute.'});
    let b; try{b=await parseBody(req);}catch{return send(res,400,{error:'Bad request'});}
    const {email,password} = b;
    if (!email||!password) return send(res,400,{error:'Email and password required'});
    const ek = email.toLowerCase().trim();
    const rows = await sb.select('gd_users',`email=eq.${encodeURIComponent(ek)}&limit=1`);
    if (!rows?.length) return send(res,401,{error:'No account found with this email'});
    const u = rows[0];
    if (!verifyPassword(password,u.password_hash,u.password_salt)) return send(res,401,{error:'Incorrect password'});
    console.log('Login:',ek);
    return send(res,200,{token:createToken({uid:u.uid,email:ek,name:u.name}),user:{name:u.name,email:ek,uid:u.uid,joined:u.joined}});
  }

  // ME
  if (m==='GET' && p==='/api/me') {
    const a=auth(req,res); if(!a) return;
    const rows = await sb.select('gd_users',`uid=eq.${a.uid}&limit=1`);
    if (!rows?.length) return send(res,404,{error:'User not found'});
    const u=rows[0];
    return send(res,200,{name:u.name,email:u.email,uid:u.uid,joined:u.joined});
  }

  // GET DATA
  if (m==='GET' && p==='/api/data') {
    const a=auth(req,res); if(!a) return;
    const rows = await sb.select('gd_user_data',`uid=eq.${a.uid}&limit=1`);
    let data={};
    if (rows?.length) { try{data=JSON.parse(rows[0].data||'{}')}catch{} }
    return send(res,200,{data});
  }

  // SAVE DATA
  if (m==='PUT' && p==='/api/data') {
    const a=auth(req,res); if(!a) return;
    let b; try{b=await parseBody(req);}catch{return send(res,400,{error:'Bad request'});}
    delete b.password; delete b.passwordHash; delete b.passwordSalt;
    const json = JSON.stringify({...b,_savedAt:Date.now()});
    await sb.upsert('gd_user_data',{uid:a.uid,data:json,saved_at:Date.now()});
    return send(res,200,{ok:true});
  }

  // CHANGE PASSWORD
  if (m==='POST' && p==='/api/change-password') {
    const a=auth(req,res); if(!a) return;
    let b; try{b=await parseBody(req);}catch{return send(res,400,{error:'Bad request'});}
    const {currentPassword,newPassword}=b;
    if (!currentPassword||!newPassword) return send(res,400,{error:'Both passwords required'});
    if (newPassword.length<6) return send(res,400,{error:'Min 6 characters'});
    const rows=await sb.select('gd_users',`uid=eq.${a.uid}&limit=1`);
    if (!rows?.length) return send(res,404,{error:'User not found'});
    const u=rows[0];
    if (!verifyPassword(currentPassword,u.password_hash,u.password_salt)) return send(res,401,{error:'Current password incorrect'});
    const {hash,salt}=hashPassword(newPassword);
    await sb.update('gd_users',`uid=eq.${a.uid}`,{password_hash:hash,password_salt:salt});
    return send(res,200,{ok:true});
  }

  return send(res,404,{error:'Not found'});
}

// ─── SERVER ───────────────────────────────────────────────────────────────────
const server = http.createServer(async (req,res) => {
  const p = req.url.split('?')[0];
  if (req.method==='OPTIONS') {
    res.writeHead(204,{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,PUT,DELETE,OPTIONS','Access-Control-Allow-Headers':'Content-Type,Authorization'});
    return res.end();
  }
  if (p.startsWith('/api/')) {
    return api(req,res,p).catch(err => {
      console.error('API error:', err.message);
      send(res,500,{error:'Server error: '+err.message});
    });
  }
  serveStatic(req,res,p);
});

server.listen(PORT, () => {
  console.log(`\n🌸 GlowUp Diary on port ${PORT}`);
  console.log(`📦 Supabase: ${SUPABASE_URL}\n`);
});
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
process.on('SIGINT', ()=>server.close(()=>process.exit(0)));
