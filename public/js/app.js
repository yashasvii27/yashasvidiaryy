// ===== GLOWUP DIARY - FINAL =====

const DEF = {
  user:null, tasks:[], habits:[], habitLog:{}, weekPlan:{}, dietData:{},
  journals:[], moods:[], goals:[],
  xp:0, level:1, streak:0, longestStreak:0, lastActiveDate:null,
  pomSessions:0, theme:'pink', currentPage:'dashboard', _perfectDayEver:false,
  deletedTasks:{}, deletedHabits:{}
};

let S = {...DEF};

const QUOTES = [
  {t:"She believed she could, so she did.",a:"— R.S. Grey"},
  {t:"Glow differently. Not for them — for you.",a:"— Unknown"},
  {t:"Be the girl who decided to go for it.",a:"— Unknown"},
  {t:"Discipline is choosing what you want most over what you want now.",a:"— Unknown"},
  {t:"Your only limit is your mind.",a:"— Unknown"},
  {t:"Every day is a chance to be better than yesterday.",a:"— Unknown"},
  {t:"Soft life is earned through hard work.",a:"— Unknown"},
  {t:"You don't have to be perfect to be amazing.",a:"— Unknown"},
  {t:"The most powerful thing you can do is be yourself, unapologetically.",a:"— Unknown"},
  {t:"She is not perfect, but she is always growing.",a:"— Unknown"},
  {t:"Glow up is about growing up.",a:"— Unknown"},
  {t:"You are a priority, not an option.",a:"— Unknown"},
];

const LEVELS = [
  {l:1,title:"Seedling 🌱",min:0,max:100},{l:2,title:"Blooming 🌸",min:100,max:250},
  {l:3,title:"Glowing ✨",min:250,max:500},{l:4,title:"Thriving 💪",min:500,max:1000},
  {l:5,title:"That Girl 💅",min:1000,max:2000},{l:6,title:"Boss Energy 👑",min:2000,max:4000},
  {l:7,title:"Icon 💖",min:4000,max:8000},{l:8,title:"Goddess 🌟",min:8000,max:15000},
  {l:9,title:"Legend 🔥",min:15000,max:25000},{l:10,title:"Celestial ⭐",min:25000,max:Infinity},
];

const DEFAULT_TASKS = [
  {id:'dt1',text:'Drink 8 glasses of water 💧',category:'health',fixed:true},
  {id:'dt2',text:'Morning skincare routine 🧴',category:'personal',fixed:true},
  {id:'dt3',text:'Move your body 🧘‍♀️',category:'health',fixed:true},
  {id:'dt4',text:'Read for 20 minutes 📚',category:'study',fixed:true},
  {id:'dt5',text:'Write in your journal ✍️',category:'personal',fixed:true},
];

const DEFAULT_HABITS = [
  {id:'h1',name:'Wake up early ⏰',emoji:'⏰'},{id:'h2',name:'Drink water 💧',emoji:'💧'},
  {id:'h3',name:'Exercise 🏋️',emoji:'🏋️'},{id:'h4',name:'Read 📚',emoji:'📚'},
  {id:'h5',name:'Skincare 🧴',emoji:'🧴'},{id:'h6',name:'No social media 📵',emoji:'📵'},
  {id:'h7',name:'Journal ✍️',emoji:'✍️'},{id:'h8',name:'Sleep on time 🌙',emoji:'🌙'},
];

// ===== BACKEND API CONFIG =====
// Point this to your server. If serving frontend from the same server, use '/api'
// If running locally for testing: 'http://localhost:3001/api'
const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? `${window.location.protocol}//${window.location.hostname}:3001/api`
  : '/api';

// ===== STATE =====
let _token = null;
let _saveTimer = null;
let _saving = false;

function getToken() { return _token || localStorage.getItem('gd_token'); }
function setToken(t) { _token = t; if(t) localStorage.setItem('gd_token', t); else localStorage.removeItem('gd_token'); }

// ===== API HELPERS =====
// Retries on network failure (handles Render cold-start ~30-60s wake-up)
async function apiCall(method, path, body, retries = 4, delayMs = 4000) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  const tok = getToken();
  if (tok) opts.headers['Authorization'] = 'Bearer ' + tok;
  if (body) opts.body = JSON.stringify(body);

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(API_BASE + path, opts);
      const data = await res.json();
      if (!res.ok) throw Object.assign(new Error(data.error || 'Request failed'), { status: res.status, data });
      return data;
    } catch(e) {
      // Don't retry auth errors (401, 409 etc) or last attempt
      if (e.status && e.status < 500) throw e;
      if (attempt === retries) throw e;
      // Show wake-up message on first retry
      if (attempt === 0) showWakeUp(true);
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
}

function showWakeUp(show) {
  let el = document.getElementById('wakeup-banner');
  if (!el) {
    el = document.createElement('div');
    el.id = 'wakeup-banner';
    el.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:linear-gradient(90deg,#f472b6,#a78bfa);color:#fff;text-align:center;padding:10px 16px;font-size:13px;font-weight:600;letter-spacing:0.2px;box-shadow:0 2px 12px rgba(0,0,0,0.15)';
    el.innerHTML = '🌸 Server is waking up, please wait a moment...';
    document.body.appendChild(el);
  }
  el.style.display = show ? 'block' : 'none';
}

// ===== SAVE SYSTEM =====
// Every save() call:
// 1. Instantly writes to localStorage (never lost)
// 2. Schedules a server sync after 1s of inactivity
// 3. If server sync fails, retries every 5s until success

let _pendingSave = false;

function save() {
  // Always save to localStorage immediately — this is instant and never fails
  try {
    if (S.user) localStorage.setItem('gd_cache_' + S.user.uid, JSON.stringify(S));
  } catch(e) {}
  // Mark that we need to sync to server
  _pendingSave = true;
  // Debounce: wait 1s after last action before syncing
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => doServerSync(), 1000);
}

async function doServerSync() {
  if (!_pendingSave) return;
  if (!getToken() || !S.user) return;
  if (_saving) return; // already syncing, will retry
  _saving = true;
  try {
    const payload = JSON.parse(JSON.stringify(S));
    await apiCall('PUT', '/data', payload);
    _pendingSave = false; // success — clear pending flag
    console.log('✅ Saved to server');
  } catch(e) {
    console.warn('Save failed, will retry:', e.message);
    // Retry in 5 seconds
    setTimeout(() => doServerSync(), 5000);
  }
  _saving = false;
}

// Sync every 30s as a safety net even if debounce misses something
setInterval(() => { if (_pendingSave) doServerSync(); }, 30000);

async function cloudSave() {
  return doServerSync();
}

async function cloudLoad() {
  try {
    const { data } = await apiCall('GET', '/data');
    const currentUser = S.user; // always preserve current user
    if (data && Object.keys(data).length > 0) {
      S = { ...DEF, ...data };
    }
    // Always restore user from server response or keep current
    if (!S.user && currentUser) S.user = currentUser;
    if (!S.deletedTasks) S.deletedTasks = {};
    if (!S.deletedHabits) S.deletedHabits = {};
    if (!S.tasks) S.tasks = [];
    if (!S.habits) S.habits = [];
    if (!S.journals) S.journals = [];
    if (!S.moods) S.moods = [];
    if (!S.goals) S.goals = [];
    // Update local cache
    try { if(S.user) localStorage.setItem('gd_cache_' + S.user.uid, JSON.stringify(S)); } catch(e) {}
    _pendingSave = false; // fresh from server — nothing pending
    return true;
  } catch(e) {
    console.warn('cloudLoad failed, using cache:', e.message);
    return false;
  }
}

function loadFromCache(uid) {
  try {
    const c = localStorage.getItem('gd_cache_' + uid);
    if (c) { S = { ...DEF, ...JSON.parse(c) }; return true; }
  } catch(e) {}
  return false;
}

function setLoading(btnId, loading, label) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.disabled = loading;
  btn.textContent = loading ? '⏳ Please wait...' : label;
}

function showErr(id, msg) {
  const el = document.getElementById(id);
  if (el) { el.textContent = msg; el.style.display = msg ? 'block' : 'none'; }
}

// ===== LOADING SCREEN =====
function showLoadingScreen(msg) {
  let el = document.getElementById('gd-loading');
  if (!el) {
    el = document.createElement('div');
    el.id = 'gd-loading';
    el.style.cssText = 'position:fixed;inset:0;background:var(--bg,#fff0f8);display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:99998;gap:16px';
    el.innerHTML = `
      <div style="font-size:52px;animation:bou 1.5s infinite">🎀</div>
      <div style="font-family:Georgia,serif;font-size:26px;font-weight:700;background:linear-gradient(135deg,#f472b6,#a78bfa);-webkit-background-clip:text;-webkit-text-fill-color:transparent">GlowUp Diary</div>
      <div id="gd-loading-msg" style="font-size:13px;color:#a07090;margin-top:4px">Loading...</div>
      <div style="width:120px;height:4px;background:#fce7f3;border-radius:4px;overflow:hidden;margin-top:8px">
        <div style="height:100%;background:linear-gradient(90deg,#f472b6,#a78bfa);border-radius:4px;animation:loadbar 1.8s ease-in-out infinite"></div>
      </div>`;
    // inject keyframes once
    if (!document.getElementById('gd-loading-style')) {
      const s = document.createElement('style');
      s.id = 'gd-loading-style';
      s.textContent = '@keyframes loadbar{0%{width:0%;margin-left:0}50%{width:70%;margin-left:15%}100%{width:0%;margin-left:100%}}';
      document.head.appendChild(s);
    }
    document.body.appendChild(el);
  }
  el.style.display = 'flex';
  const m = document.getElementById('gd-loading-msg');
  if (m) m.textContent = msg || 'Loading...';
}

function hideLoadingScreen() {
  const el = document.getElementById('gd-loading');
  if (el) el.style.display = 'none';
  showWakeUp(false);
}

function ensureDefaults() {
  if (!S.tasks.length) S.tasks = DEFAULT_TASKS.map(t => ({ ...t, completedDate: null }));
  if (!S.habits.length) S.habits = [...DEFAULT_HABITS];
  if (!S.deletedTasks) S.deletedTasks = {};
  if (!S.deletedHabits) S.deletedHabits = {};
}

function refreshCurrentPage() {
  const fns = { dashboard:renderDash, tasks:renderTasks, habit:renderHabit, weekly:renderWeekly,
    streak:renderStreak, diet:renderDiet, mood:renderMood, journal:renderJournal,
    goals:renderGoals, focus:renderFocus, settings:renderSettings };
  try { if (fns[S.currentPage]) fns[S.currentPage](); } catch(e) {}
}

// ===== INIT =====
// Force save when user closes/leaves the app
window.addEventListener('beforeunload', () => {
  if (!getToken() || !S.user) return;
  clearTimeout(_saveTimer);
  // Use sendBeacon for reliable save on page close
  try {
    const payload = JSON.stringify(S);
    navigator.sendBeacon && navigator.sendBeacon(
      API_BASE + '/data-beacon',
      new Blob([payload], { type: 'application/json' })
    );
  } catch(e) {}
});

document.addEventListener('DOMContentLoaded', async function() {
  const token = getToken();
  if (!token) { showLogin(); return; }

  showLoadingScreen('Loading your diary ✨');

  // Decode uid from token (no verification needed here — server verifies)
  let cachedUid = null;
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    cachedUid = payload.uid;
  } catch(e) {}

  // STEP 1: Show cached data instantly so screen is never blank
  if (cachedUid && loadFromCache(cachedUid) && S.user) {
    ensureDefaults();
    hideLoadingScreen();
    showApp();
    // STEP 2: Sync from server in background (retries on wake-up)
    cloudLoad().then(ok => {
      if (ok) {
        ensureDefaults();
        updateSidebarUser();
        refreshCurrentPage();
      }
    }).catch(() => {
      toast('⚠️ Offline mode — data saved locally', '');
    });
    return;
  }

  // STEP 1b: No cache — must wait for server (first load on new device)
  showLoadingScreen('🌸 Connecting to server...');
  try {
    const user = await apiCall('GET', '/me');
    showLoadingScreen('Loading your data ✨');
    await cloudLoad();
    if (!S.user) S.user = { name: user.name, email: user.email, uid: user.uid, avatar: '🌸', joined: user.joined };
    ensureDefaults();
    hideLoadingScreen();
    showApp();
  } catch(e) {
    hideLoadingScreen();
    if (e.status === 401) {
      setToken(null); showLogin();
    } else {
      // Server completely unreachable even after retries
      // If we have ANY cached data, show it
      if (cachedUid && loadFromCache(cachedUid) && S.user) {
        ensureDefaults();
        showApp();
        toast('⚠️ Could not reach server — showing cached data', '');
      } else {
        // Nothing we can do — show login with error
        showLogin();
        setTimeout(() => showErr('l-err', '⚠️ Server unreachable. Try again in a moment.'), 100);
      }
    }
  }
});

function showLogin() {
  document.getElementById('login-pg').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
}

function showApp() {
  document.getElementById('login-pg').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  applyTheme(S.theme || 'pink');
  updateSidebarUser();
  checkStreak();
  go(S.currentPage || 'dashboard');
}

// ===== AUTH =====
async function login() {
  const e = (document.getElementById('l-email').value || '').trim();
  const p = (document.getElementById('l-pass').value || '');
  showErr('l-err', '');
  if (!e || !p) { showErr('l-err', 'Please fill in all fields 💖'); return; }
  setLoading('btn-login', true, "Let's Glow 🌸");
  try {
    const { token, user } = await apiCall('POST', '/login', { email: e, password: p });
    setToken(token);
    await cloudLoad();
    if (!S.user) S.user = { name: user.name, email: user.email, uid: user.uid, avatar: '🌸', joined: user.joined };
    if (!S.tasks.length) S.tasks = DEFAULT_TASKS.map(t => ({ ...t, completedDate: null }));
    if (!S.habits.length) S.habits = [...DEFAULT_HABITS];
    showApp();
  } catch(err) {
    setLoading('btn-login', false, "Let's Glow 🌸");
    showErr('l-err', err.message || 'Login failed. Check your connection.');
  }
}

async function signup() {
  const n = (document.getElementById('s-name').value || '').trim();
  const e = (document.getElementById('s-email').value || '').trim();
  const p = (document.getElementById('s-pass').value || '');
  const p2 = (document.getElementById('s-pass2').value || '');
  showErr('s-err', '');
  if (!n || !e || !p || !p2) { showErr('s-err', 'Please fill in all fields 💖'); return; }
  if (p !== p2) { showErr('s-err', 'Passwords do not match 🔐'); return; }
  if (p.length < 6) { showErr('s-err', 'Password must be at least 6 characters'); return; }
  setLoading('btn-signup', true, 'Start Glowing ✨');
  try {
    const { token, user } = await apiCall('POST', '/signup', { name: n, email: e, password: p });
    setToken(token);
    S = { ...DEF,
      user: { name: user.name, email: user.email, uid: user.uid, avatar: '🌸', joined: user.joined },
      tasks: DEFAULT_TASKS.map(t => ({ ...t, completedDate: null })),
      habits: [...DEFAULT_HABITS]
    };
    await cloudSave();
    toast('Welcome to GlowUp Diary! ✨', 'ok');
    showApp();
  } catch(err) {
    setLoading('btn-signup', false, 'Start Glowing ✨');
    showErr('s-err', err.message || 'Sign up failed. Check your connection.');
  }
}

async function logout() {
  if (!confirm('Log out?')) return;
  clearTimeout(_saveTimer);
  await cloudSave();
  const uid = S.user?.uid;
  setToken(null);
  if (uid) try { localStorage.removeItem('gd_cache_' + uid); } catch(e) {}
  S = { ...DEF };
  location.reload();
}

function switchTab(t) {
  document.getElementById('tab-l').classList.toggle('on', t === 'l');
  document.getElementById('tab-s').classList.toggle('on', t === 's');
  document.getElementById('f-l').style.display = t === 'l' ? 'block' : 'none';
  document.getElementById('f-s').style.display = t === 's' ? 'block' : 'none';
  showErr('l-err', ''); showErr('s-err', '');
}

// ===== THEME =====
function applyTheme(th){
  S.theme = th;
  const map = {pink:'',lavender:'lavender',beige:'beige',dark:'dark'};
  document.documentElement.setAttribute('data-theme', map[th]||'');
  document.querySelectorAll('.th-dot').forEach(d=>d.classList.toggle('on', d.dataset.th===th));
  save();
}

// ===== NAVIGATION =====
function go(page){
  S.currentPage = page;
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('on'));
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  const pg = document.getElementById('pg-'+page);
  if(pg) pg.classList.add('on');
  const nav = document.querySelector('[data-pg="'+page+'"]');
  if(nav) nav.classList.add('active');
  closeSidebar();
  const fns = {
    dashboard:renderDash, tasks:renderTasks, habit:renderHabit, weekly:renderWeekly,
    streak:renderStreak, diet:renderDiet, mood:renderMood, journal:renderJournal,
    goals:renderGoals, focus:renderFocus, settings:renderSettings
  };
  if(fns[page]) fns[page]();
  save();
}

// ===== SIDEBAR =====
function updateSidebarUser(){
  if(!S.user) return;
  document.getElementById('sb-name').textContent = S.user.name;
  document.getElementById('sb-av').textContent = S.user.avatar || '🌸';
  document.getElementById('sb-lvl').textContent = getLevel().title;
}
function toggleSidebar(){
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('sb-ov').style.display =
    document.getElementById('sidebar').classList.contains('open') ? 'block' : 'none';
}
function closeSidebar(){
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sb-ov').style.display = 'none';
}

// ===== STREAK =====
function checkStreak(){
  const today = todayStr();
  const yesterday = dStr(Date.now()-86400000);
  const hasToday = S.tasks.some(t=>t.completedDate===today) ||
    Object.keys(S.habitLog).some(k=>k.startsWith(today));
  if(hasToday && S.lastActiveDate !== today){
    if(S.lastActiveDate === yesterday) S.streak = (S.streak||0)+1;
    else S.streak = 1;
    S.longestStreak = Math.max(S.longestStreak, S.streak);
    S.lastActiveDate = today;
    S.xp += 15; updateLevel(); save();
  }
}

// ===== LEVEL =====
function getLevel(){ for(let i=LEVELS.length-1;i>=0;i--) if(S.xp>=LEVELS[i].min) return LEVELS[i]; return LEVELS[0]; }
function updateLevel(){ S.level = getLevel().l; }

// ===== DASHBOARD =====
// ===== QUOTE CAROUSEL =====
let _quoteIdx = new Date().getDate() % QUOTES.length;
function renderQuoteCarousel(){
  const q = QUOTES[_quoteIdx];
  const inner = document.getElementById('d-quote-inner');
  if(!inner) return;
  inner.style.opacity='0';
  setTimeout(()=>{
    const qtxt=document.getElementById('d-qtxt'); if(qtxt) qtxt.textContent=q.t;
    const qauth=document.getElementById('d-qauth'); if(qauth) qauth.textContent=q.a;
    inner.style.opacity='1';
  },200);
  const dots=document.getElementById('d-quote-dots');
  if(dots) dots.innerHTML=QUOTES.map((_,i)=>`<div style="width:${i===_quoteIdx?'16':'6'}px;height:6px;border-radius:3px;background:${i===_quoteIdx?'var(--p1)':'rgba(0,0,0,0.2)'};transition:all 0.3s"></div>`).join('');
}
function quoteNext(){ _quoteIdx=(_quoteIdx+1)%QUOTES.length; renderQuoteCarousel(); }
function quotePrev(){ _quoteIdx=(_quoteIdx-1+QUOTES.length)%QUOTES.length; renderQuoteCarousel(); }

function renderDash(){
  const h = new Date().getHours();
  const gs = h<12 ? `Good Morning, ${S.user.name}! ☀️`
           : h<17 ? `Good Afternoon, ${S.user.name}! 🌤️`
                  : `Good Evening, ${S.user.name}! 🌙`;
  document.getElementById('d-greet').textContent = gs;
  document.getElementById('d-date').textContent = new Date().toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
  renderQuoteCarousel();
  const today = todayStr();
  const weeklyToday = (S.weekPlan[today]||[]);
  const done = S.tasks.filter(t=>t.completedDate===today).length + weeklyToday.filter(t=>t.done).length;
  const total = S.tasks.length + weeklyToday.length;
  const pct = total ? Math.round(done/total*100) : 0;
  document.getElementById('d-streak').textContent = S.streak;
  document.getElementById('d-pct').textContent = pct+'%';
  document.getElementById('d-xp').textContent = S.xp;
  document.getElementById('d-pfill').style.width = pct+'%';
  document.getElementById('d-ptxt').textContent = `${done}/${total} tasks completed today`;
  const el = document.getElementById('d-tasks');
  el.innerHTML = '';
  if(S.tasks.length){
    el.innerHTML += '<div style="font-size:10px;font-weight:700;color:var(--tx3);margin:6px 0 4px;letter-spacing:1px">📌 DAILY</div>';
    S.tasks.slice(0,4).forEach(t=>{
      const isdone = t.completedDate===today;
      el.innerHTML += `<div class="task ${isdone?'done':''}" onclick="toggleTask('${t.id}')">
        <div class="tchk ${isdone?'on':''}"></div>
        <span class="task-txt">${t.text}</span>
        <span class="tcat ${t.category}">${t.category}</span>
      </div>`;
    });
  }
  if(weeklyToday.length){
    el.innerHTML += '<div style="font-size:10px;font-weight:700;color:var(--tx3);margin:10px 0 4px;letter-spacing:1px">🗓️ TODAY\'S PLAN</div>';
    weeklyToday.forEach((t,i)=>{
      el.innerHTML += `<div class="task ${t.done?'done':''}" onclick="toggleWTaskDash('${today}',${i})">
        <div class="tchk ${t.done?'on':''}"></div>
        <span class="task-txt">${t.text}</span>
        <span class="tcat" style="background:#dbeafe;color:#1d4ed8">planner</span>
      </div>`;
    });
  }
  if(!S.tasks.length && !weeklyToday.length) el.innerHTML='<p class="tc tm mt4">No tasks yet! Go add some ✨</p>';
}
function toggleWTaskDash(ds,idx){
  if(!S.weekPlan[ds]) return;
  S.weekPlan[ds][idx].done = !S.weekPlan[ds][idx].done;
  save(); renderDash();
}

// ===== TASKS =====
let taskViewMonth = null;
const TASK_MONTHS_2026 = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function getTaskMonthKey(){
  if(!taskViewMonth){ const n=new Date(); taskViewMonth={year:n.getFullYear(),month:n.getMonth()}; }
  return `${taskViewMonth.year}-${String(taskViewMonth.month+1).padStart(2,'0')}`;
}

function renderTaskMonthTabs(){
  const wrap = document.getElementById('task-month-tabs');
  if(!wrap) return;
  const key = getTaskMonthKey();
  wrap.innerHTML = TASK_MONTHS_2026.map((name,i)=>{
    const mk = `2026-${String(i+1).padStart(2,'0')}`;
    return `<button class="month-tab ${key===mk?'active':''}" onclick="setTaskMonth(2026,${i})">${name.slice(0,3)}</button>`;
  }).join('');
  setTimeout(()=>{
    const active=wrap.querySelector('.month-tab.active');
    if(active) active.scrollIntoView({behavior:'smooth',inline:'center',block:'nearest'});
  },50);
}

function setTaskMonth(year,month){
  taskViewMonth={year,month}; renderTasks();
}

function renderTasks(){
  if(!taskViewMonth){ const n=new Date(); taskViewMonth={year:n.getFullYear(),month:n.getMonth()}; }
  renderTaskMonthTabs();
  const mk = getTaskMonthKey();
  const deletedForMonth = (S.deletedTasks && S.deletedTasks[mk]) ? S.deletedTasks[mk] : [];
  const visibleTasks = S.tasks.filter(t=>
    (!t.monthKey || t.monthKey===mk) && !deletedForMonth.includes(t.id)
  );
  const today = todayStr();
  const done = visibleTasks.filter(t=>t.completedDate===today).length;
  const pct = visibleTasks.length ? Math.round(done/visibleTasks.length*100) : 0;
  document.getElementById('t-pct').textContent = pct+'%';
  document.getElementById('t-pfill').style.width = pct+'%';
  document.getElementById('t-cnt').textContent = `${done}/${visibleTasks.length} completed`;
  const el = document.getElementById('t-list');
  el.innerHTML = '';
  if(!visibleTasks.length){ el.innerHTML='<p class="tc tm mt4">No tasks for this month. Add your first! 💖</p>'; return; }
  // Build category map - include built-in + custom categories
  const builtinCatNames = {study:'📚 Study',health:'🧘‍♀️ Health',personal:'💖 Personal'};
  const cats = {};
  visibleTasks.forEach(t=>{
    const cat = t.category||'personal';
    if(!cats[cat]) cats[cat]=[];
    const d=t.completedDate===today;
    cats[cat].push({...t,done:d});
  });
  Object.entries(cats).forEach(([cat,items])=>{
    if(!items.length) return;
    const catLabel = builtinCatNames[cat] || ('🏷️ '+cat.charAt(0).toUpperCase()+cat.slice(1));
    el.innerHTML += `<div class="nav-sec">${catLabel}</div>`;
    items.forEach(t=>{
      el.innerHTML += `<div class="task ${t.done?'done':''}" id="task-${t.id}">
        <div class="tchk ${t.done?'on':''}" onclick="toggleTask('${t.id}')"></div>
        <span class="task-txt">${t.text}</span>
        <span class="tcat ${builtinCatNames[t.category]?t.category:''}" style="${!builtinCatNames[t.category]?'background:var(--pl);color:var(--p3)':''}">${t.category}</span>
        <div class="tact">
          <button class="btn btn-g btn-sm" onclick="event.stopPropagation();editTask('${t.id}')">✏️</button>
          <button class="btn btn-d btn-sm" onclick="event.stopPropagation();delTask('${t.id}')">🗑️</button>
        </div>
      </div>`;
    });
  });
}
function toggleTask(id){
  const t = S.tasks.find(x=>x.id===id); if(!t) return;
  const today = todayStr();
  if(t.completedDate===today){ t.completedDate=null; S.xp=Math.max(0,S.xp-10); }
  else{ t.completedDate=today; S.xp+=10; sound(); toast('Task done! +10 XP ✨','ok'); checkPerfectDay(); }
  checkStreak(); updateLevel(); save();
  renderPage(S.currentPage); updateSidebarUser();
}
function checkPerfectDay(){
  const today = todayStr();
  const mk = getTaskMonthKey();
  const deletedForMonth = (S.deletedTasks && S.deletedTasks[mk]) ? S.deletedTasks[mk] : [];
  const visibleTasks = S.tasks.filter(t=>
    (!t.monthKey || t.monthKey===mk) && !deletedForMonth.includes(t.id)
  );
  if(visibleTasks.length>0 && visibleTasks.every(t=>t.completedDate===today)){
    S._perfectDayEver=true; S.xp+=50; save();
    setTimeout(()=>{ confetti(); toast('🌸 Perfect Day! +50 XP bonus!','ok'); },400);
  }
}
function getCustomCategories(){
  const builtin = ['health','personal','study'];
  const custom = [...new Set(S.tasks.map(t=>t.category).filter(c=>!builtin.includes(c)))];
  return custom;
}
function addTask(txt,cat){
  if(!txt.trim()) return;
  // cat may be '__custom__', handle it
  const customCatInput = document.getElementById('at-cat-custom');
  const finalCat = (cat==='__custom__' && customCatInput && customCatInput.value.trim()) ? customCatInput.value.trim() : (cat==='__custom__' ? 'personal' : cat);
  const mk = getTaskMonthKey();
  S.tasks.push({id:'t'+Date.now(),text:txt.trim(),category:finalCat||'personal',fixed:false,completedDate:null,monthKey:mk});
  save(); renderTasks(); toast('Task added! ✅','ok');
}
function delTask(id){
  if(!confirm('Delete this task for this month only?')) return;
  const mk = getTaskMonthKey();
  if(!S.deletedTasks) S.deletedTasks={};
  if(!S.deletedTasks[mk]) S.deletedTasks[mk]=[];
  if(!S.deletedTasks[mk].includes(id)) S.deletedTasks[mk].push(id);
  save(); renderTasks();
}
function editTask(id){
  const t = S.tasks.find(x=>x.id===id); if(!t) return;
  openModal('m-edit-task');
  document.getElementById('et-txt').value = t.text;
  const sel=document.getElementById('et-cat');
  const customInput=document.getElementById('et-cat-custom');
  const builtin=['health','personal','study'];
  const isCustomCat = t.category && !builtin.includes(t.category);
  // Populate custom options that already exist in tasks
  const existingCustom = getCustomCategories();
  // Rebuild options
  sel.innerHTML=`<option value="personal" ${t.category==='personal'?'selected':''}>💖 Personal</option>
    <option value="study" ${t.category==='study'?'selected':''}>📚 Study</option>
    <option value="health" ${t.category==='health'?'selected':''}>🧘‍♀️ Health</option>`;
  existingCustom.forEach(c=>{
    sel.innerHTML+=`<option value="${c}" ${t.category===c?'selected':''}>${c.charAt(0).toUpperCase()+c.slice(1)}</option>`;
  });
  sel.innerHTML+=`<option value="__custom__">✏️ Create new category...</option>`;
  if(isCustomCat){ sel.value=t.category; customInput.style.display='none'; }
  else{ sel.value=t.category; customInput.style.display='none'; }
  sel.onchange=()=>{ customInput.style.display=sel.value==='__custom__'?'block':'none'; if(sel.value!=='__custom__') customInput.value=''; };
  document.getElementById('et-save').onclick = ()=>{
    t.text = document.getElementById('et-txt').value.trim()||t.text;
    const newCat = sel.value;
    if(newCat==='__custom__'){
      const cval=customInput.value.trim();
      if(cval) t.category=cval;
    } else { t.category=newCat; }
    save(); closeModal('m-edit-task'); renderTasks();
  };
}

function renderPage(p){ go(p); }

// ===== HABIT TRACKER =====
let viewMonth = null;
function renderHabit(){
  const now = new Date();
  if(!viewMonth) viewMonth = {year:now.getFullYear(), month:now.getMonth()};
  const year=viewMonth.year, month=viewMonth.month;
  const isCurrentMonth = year===now.getFullYear() && month===now.getMonth();
  const todayNum = isCurrentMonth ? now.getDate() : 0;
  const daysInMonth = new Date(year,month+1,0).getDate();
  const monthName = new Date(year,month,1).toLocaleDateString('en-US',{month:'long',year:'numeric'});
  const joinDate = S.user&&S.user.joined ? new Date(S.user.joined) : new Date();
  const canGoPrev = !(year===joinDate.getFullYear()&&month===joinDate.getMonth());
  const canGoNext = true; // allow navigation to future months
  const mk = `${year}-${String(month+1).padStart(2,'0')}`;
  const deletedForMonth = (S.deletedHabits && S.deletedHabits[mk]) ? S.deletedHabits[mk] : [];
  const visibleHabits = S.habits.filter(h=>
    (!h.monthKey || h.monthKey===mk) && !deletedForMonth.includes(h.id)
  );
  const wrap = document.getElementById('habit-wrap');
  if(!visibleHabits.length){
    wrap.innerHTML=`<div style="padding:16px 0">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
        <button class="btn btn-g btn-sm" onclick="habitPrevMonth()" ${canGoPrev?'':'disabled style="opacity:0.3"'}>← Prev</button>
        <span style="font-family:var(--fd);font-size:18px;font-weight:700;color:var(--p3)">${monthName}</span>
        <button class="btn btn-g btn-sm" onclick="habitNextMonth()" ${canGoNext?'':'disabled style="opacity:0.3"'}>Next →</button>
      </div>
      <p class="tc tm" style="padding:20px">No habits for this month. Add your first! 💪</p></div>`;
    return;
  }
  let html = `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:8px">
    <button class="btn btn-g" onclick="habitPrevMonth()" ${canGoPrev?'':'disabled style="opacity:0.3;cursor:not-allowed"'}>← Prev Month</button>
    <span style="font-family:var(--fd);font-size:20px;font-weight:700;color:var(--p3)">${monthName}</span>
    <button class="btn btn-g" onclick="habitNextMonth()" ${canGoNext?'':'disabled style="opacity:0.3;cursor:not-allowed"'}>Next Month →</button>
  </div>
  <div class="habit-wrap"><table class="htable">
    <tr><th class="hname-col">Habit</th>
    ${Array.from({length:daysInMonth},(_,i)=>{const d=i+1;const isT=isCurrentMonth&&d===todayNum;return`<th class="${isT?'col-today':''}" style="min-width:26px;font-size:9px">${d}</th>`;}).join('')}
    <th>%</th></tr>`;
  visibleHabits.forEach(h=>{
    let doneCount=0;
    html += `<tr><td class="hname">${h.emoji||'🌸'} ${h.name} <button class="btn btn-d btn-sm" style="padding:1px 5px;font-size:10px;margin-left:4px" onclick="delHabit('${h.id}')">🗑️</button></td>`;
    for(let d=1;d<=daysInMonth;d++){
      const key=`${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}_${h.id}`;
      const done=!!(S.habitLog[key]);
      const isFuture=isCurrentMonth&&d>todayNum;
      const isToday=isCurrentMonth&&d===todayNum;
      if(done) doneCount++;
      html += `<td class="${isToday?'col-today':''}"><div class="hcb ${done?'on':''} ${isFuture?'future':''} ${isToday&&!done?'today-col':''}" onclick="${!isFuture?`toggleHabit('${h.id}',${year},${month+1},${d})`:''}" ></div></td>`;
    }
    const pct=todayNum>0?Math.round(doneCount/todayNum*100):Math.round(doneCount/daysInMonth*100);
    html += `<td class="pct-cell">${pct}%</td></tr>
    <tr class="prow"><td></td>${Array.from({length:daysInMonth},(_,i)=>{const d=i+1;const key=`${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}_${h.id}`;const done=!!(S.habitLog[key]);return`<td style="padding:2px 3px"><div class="mini-bar"><div class="mini-bar-fill" style="width:${done?100:0}%"></div></div></td>`;}).join('')}<td></td></tr>`;
  });
  // Daily % row
  html += `<tr style="background:var(--pxl)"><td class="hname" style="font-weight:700;color:var(--p3)">Daily %</td>`;
  for(let d=1;d<=daysInMonth;d++){
    const isFuture=isCurrentMonth&&d>todayNum;
    if(isFuture){html+=`<td></td>`;continue;}
    const dateKey=`${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const done=visibleHabits.filter(h=>S.habitLog[`${dateKey}_${h.id}`]).length;
    const pct=visibleHabits.length?Math.round(done/visibleHabits.length*100):0;
    const isT=isCurrentMonth&&d===todayNum;
    html+=`<td class="pct-cell ${isT?'col-today':''}" style="font-size:9px">${pct}%</td>`;
  }
  html += `<td></td></tr></table></div>`;
  wrap.innerHTML = html;
}
function toggleHabit(hid,year,month,day){
  const key=`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}_${hid}`;
  if(S.habitLog[key]){ delete S.habitLog[key]; }
  else{ S.habitLog[key]=true; S.xp+=5; checkStreak(); updateLevel(); sound(); }
  save(); renderHabit(); updateSidebarUser();
}
function habitPrevMonth(){
  if(!viewMonth) viewMonth={year:new Date().getFullYear(),month:new Date().getMonth()};
  viewMonth.month--; if(viewMonth.month<0){viewMonth.month=11;viewMonth.year--;} renderHabit();
}
function habitNextMonth(){
  if(!viewMonth) viewMonth={year:new Date().getFullYear(),month:new Date().getMonth()};
  viewMonth.month++; if(viewMonth.month>11){viewMonth.month=0;viewMonth.year++;} renderHabit();
}
function addHabit(name,emoji){
  if(!name.trim()) return;
  if(!viewMonth){ const n=new Date(); viewMonth={year:n.getFullYear(),month:n.getMonth()}; }
  const mk = `${viewMonth.year}-${String(viewMonth.month+1).padStart(2,'0')}`;
  S.habits.push({id:'h'+Date.now(),name:name.trim(),emoji:emoji||'🌸',monthKey:mk});
  save(); renderHabit(); toast('Habit added! 💪','ok');
}
function delHabit(id){
  if(!confirm('Remove this habit for this month only?')) return;
  const mk = `${viewMonth.year}-${String(viewMonth.month+1).padStart(2,'0')}`;
  if(!S.deletedHabits) S.deletedHabits={};
  if(!S.deletedHabits[mk]) S.deletedHabits[mk]=[];
  if(!S.deletedHabits[mk].includes(id)) S.deletedHabits[mk].push(id);
  save(); renderHabit();
}

// ===== WEEKLY PLANNER =====
let weekOffset = 0;
function renderWeeklyMonthTabs(){
  const tabsEl = document.getElementById('wk-month-tabs'); if(!tabsEl) return;
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const now = new Date();
  // compute which month the current weekOffset week falls in
  const ref = new Date(now);
  const dow = ref.getDay();
  ref.setDate(ref.getDate()-(dow===0?6:dow-1)+(weekOffset*7));
  const activeMonth = ref.getMonth(); // 0-indexed
  tabsEl.innerHTML = months.map((name,i)=>{
    const isActive = (i===activeMonth && ref.getFullYear()===2026) || (now.getFullYear()===2026 && i===activeMonth && weekOffset===0 && ref.getFullYear()===2026);
    // Determine active: jump to first Mon of that month in 2026
    const short = name.substring(0,3);
    const isCurrentMonth = ref.getFullYear()===2026 && i===activeMonth;
    return `<button onclick="weekJumpToMonth2026(${i})" style="flex-shrink:0;padding:5px 14px;border-radius:20px;border:1.5px solid ${isCurrentMonth?'var(--p1)':'var(--cb)'};background:${isCurrentMonth?'var(--p1)':'var(--bg3)'};color:${isCurrentMonth?'#fff':'var(--tx2)'};font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap;transition:all 0.2s">${short} 2026</button>`;
  }).join('');
  setTimeout(()=>{const a=tabsEl.querySelector('[style*="var(--p1)"]');if(a)a.scrollIntoView({behavior:'smooth',inline:'center',block:'nearest'});},50);
}
function weekJumpToMonth2026(month){
  const now = new Date();
  const target = new Date(2026, month, 1);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  // find the Monday of the week containing the 1st of that month
  const dow = target.getDay();
  const monday = new Date(target);
  monday.setDate(target.getDate()-(dow===0?6:dow-1));
  const diff = Math.round((monday-today)/86400000);
  weekOffset = Math.round(diff/7);
  renderWeekly();
}

function renderWeekly(){
  const now = new Date();
  const dow = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate()-(dow===0?6:dow-1)+(weekOffset*7));
  monday.setHours(0,0,0,0);
  const dayShort = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const dayFull = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
  const el = document.getElementById('wk-grid');
  el.innerHTML = '';
  const sunday = new Date(monday); sunday.setDate(monday.getDate()+6);
  const weekLabel = `${monday.toLocaleDateString('en-US',{month:'short',day:'numeric'})} – ${sunday.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}`;
  document.getElementById('wk-label').textContent = weekLabel;
  renderWeeklyMonthTabs();
  const isCurrentWeek = weekOffset===0;
  document.getElementById('wk-today-btn').style.display = isCurrentWeek?'none':'inline-flex';
  const badges = {0:'📅 This Week','-1':'◀ Last Week',1:'Next Week ▶'};
  document.getElementById('wk-badge').textContent = badges[weekOffset]||(weekOffset<0?`${Math.abs(weekOffset)} Weeks Ago`:`${weekOffset} Weeks Ahead`);
  let totalT=0,totalD=0;
  for(let i=0;i<7;i++){const d=new Date(monday);d.setDate(monday.getDate()+i);const tasks=S.weekPlan[dStr(d.getTime())]||[];totalT+=tasks.length;totalD+=tasks.filter(t=>t.done).length;}
  const weekPct = totalT?Math.round(totalD/totalT*100):0;
  document.getElementById('wk-pct').textContent = weekPct+'%';
  document.getElementById('wk-pfill').style.width = weekPct+'%';
  document.getElementById('wk-stats').textContent = totalT?`${totalD}/${totalT} tasks completed`:'No tasks planned yet ✨';
  const todayDs = todayStr();
  const todayDate = new Date(now.getFullYear(),now.getMonth(),now.getDate());
  for(let i=0;i<7;i++){
    const d=new Date(monday); d.setDate(monday.getDate()+i);
    const ds=dStr(d.getTime());
    const isToday=ds===todayDs;
    const isPast=d<todayDate;
    const dayTasks=S.weekPlan[ds]||[];
    const done=dayTasks.filter(t=>t.done).length;
    const pct=dayTasks.length?Math.round(done/dayTasks.length*100):0;
    el.innerHTML+=`<div class="wday-card ${isToday?'wday-today':''} ${isPast&&!isToday?'wday-past':''}">
      <div class="wday-card-hdr ${isToday?'wday-card-hdr-today':''}">
        <div><div class="wday-card-name">${dayShort[i]}</div><div class="wday-card-date">${d.toLocaleDateString('en-US',{month:'short',day:'numeric'})}</div></div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:2px">
          <div class="wday-card-num ${isToday?'wday-card-num-today':''}">${d.getDate()}</div>
          ${isToday?'<div style="font-size:8px;background:rgba(255,255,255,0.3);color:#fff;padding:1px 5px;border-radius:8px;font-weight:700">TODAY</div>':''}
        </div>
      </div>
      ${dayTasks.length?`<div style="padding:8px 12px 0"><div style="display:flex;justify-content:space-between;font-size:10px;color:var(--tx2);margin-bottom:3px"><span>${done}/${dayTasks.length} done</span><span style="color:var(--p1);font-weight:700">${pct}%</span></div><div class="pw"><div class="pf" style="width:${pct}%"></div></div></div>`:''}
      <div class="wday-tasks" id="wtasks-${ds}">
        ${!dayTasks.length?'<div style="font-size:11px;color:var(--tx3);padding:8px 4px;text-align:center;font-style:italic">No tasks</div>':''}
        ${dayTasks.map((t,idx)=>`<div class="wday-task-item ${t.done?'wdone':''}" onclick="toggleWTask('${ds}',${idx})">
          <div class="wday-tchk ${t.done?'wday-tchk-on':''}">${t.done?'✓':''}</div>
          <span class="wday-task-txt">${t.text}</span>
          <button class="wday-del-btn" onclick="event.stopPropagation();delWTask('${ds}',${idx})">×</button>
        </div>`).join('')}
      </div>
      <div style="padding:8px 12px 12px"><button class="wday-add-btn" onclick="openAddWTask('${ds}','${dayFull[i]}')">+ Add task</button></div>
    </div>`;
  }
}
function weekNav(dir){ weekOffset+=dir; renderWeekly(); }
function weekGoToday(){ weekOffset=0; renderWeekly(); }
function openAddWTask(ds,dayName){
  document.getElementById('wt-day-label').textContent=dayName;
  document.getElementById('wt-input').value='';
  document.getElementById('wt-ds').value=ds;
  openModal('m-add-wtask');
  setTimeout(()=>document.getElementById('wt-input').focus(),100);
}
function saveWTask(){
  const ds=document.getElementById('wt-ds').value;
  const txt=document.getElementById('wt-input').value.trim();
  if(!txt){toast('Enter a task first! 💖','bad');return;}
  if(!S.weekPlan[ds]) S.weekPlan[ds]=[];
  S.weekPlan[ds].push({text:txt,done:false});
  save(); closeModal('m-add-wtask'); renderWeekly(); toast('Task added! ✅','ok');
}
function toggleWTask(ds,idx){
  if(!S.weekPlan[ds]) return;
  S.weekPlan[ds][idx].done=!S.weekPlan[ds][idx].done;
  if(S.weekPlan[ds][idx].done){S.xp+=5;updateLevel();}
  save(); renderWeekly(); updateSidebarUser();
}
function delWTask(ds,idx){
  if(!S.weekPlan[ds]) return;
  S.weekPlan[ds].splice(idx,1); save(); renderWeekly();
}

// ===== STREAK =====
function renderStreak(){
  document.getElementById('s-num').textContent=S.streak;
  document.getElementById('s-longest').textContent=S.longestStreak;
  document.getElementById('s-bonus').textContent=`+${Math.min(S.streak*5,100)} XP/day`;
  const el=document.getElementById('s-history');
  el.innerHTML='';
  const days=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  for(let i=6;i>=0;i--){
    const d=new Date(Date.now()-i*86400000);
    const ds=dStr(d.getTime());
    const hasAct=S.tasks.some(t=>t.completedDate===ds)||Object.keys(S.habitLog).some(k=>k.startsWith(ds));
    const lbl=i===0?'Today':days[d.getDay()];
    el.innerHTML+=`<div style="display:flex;flex-direction:column;align-items:center;gap:3px">
      <div style="width:34px;height:34px;border-radius:50%;background:${hasAct?'var(--g1)':'var(--pl)'};display:flex;align-items:center;justify-content:center;font-size:15px;box-shadow:${hasAct?'var(--sh2)':'none'}">${hasAct?'🔥':'○'}</div>
      <span style="font-size:9px;color:var(--tx3)">${lbl}</span>
    </div>`;
  }
}
function softReset(){ openModal('m-softreset'); }
function doSoftReset(){ S.streak=0; save(); closeModal('m-softreset'); renderStreak(); toast("It's okay! Let's glow again ✨",'ok'); }

// ===== DIET TRACKER =====
let dietOffset = 0;
function renderDiet(){
  const now=new Date();
  const target=new Date(now); target.setDate(now.getDate()+dietOffset); target.setHours(0,0,0,0);
  const ds=dStr(target.getTime());
  const isToday=dietOffset===0;
  const dayName=isToday?'Today':dietOffset===-1?'Yesterday':target.toLocaleDateString('en-US',{weekday:'long'});
  const fullDate=target.toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
  document.getElementById('diet-label').textContent=fullDate;
  document.getElementById('diet-day-name').textContent=dayName;
  document.getElementById('diet-day-full').textContent=fullDate;
  document.getElementById('diet-today-btn').style.display=isToday?'none':'inline-flex';
  renderDietMonthStrip(target,ds);
  renderDietMonthTabs(target);
  if(!S.dietData) S.dietData={};
  const day=S.dietData[ds]||{plan:[],eaten:[],note:''};
  const planned=day.plan.length;
  const matchedPlan=day.plan.filter(m=>m.eaten).length;
  const missed=Math.max(0,planned-matchedPlan);
  const pct=planned>0?Math.min(100,Math.round(matchedPlan/planned*100)):(day.eaten.length>0?100:0);
  document.getElementById('diet-planned-cnt').textContent=planned;
  document.getElementById('diet-eaten-cnt').textContent=matchedPlan;
  document.getElementById('diet-missed-cnt').textContent=missed;
  document.getElementById('diet-ring-pct').textContent=pct+'%';
  const C=207.3;
  const ring=document.getElementById('diet-ring');
  if(ring) ring.style.strokeDashoffset=C-(C*pct/100);
  // Plan list
  const planEl=document.getElementById('diet-plan-list');
  if(!day.plan.length){
    planEl.innerHTML='<div class="diet-empty">No meals planned yet.<br>Tap <strong>+ Add</strong> to plan your meals! 🥑</div>';
  } else {
    planEl.innerHTML='';
    const groups={};
    day.plan.forEach((m,i)=>{ if(!groups[m.time]) groups[m.time]=[]; groups[m.time].push({...m,idx:i}); });
    Object.entries(groups).forEach(([time,meals])=>{
      planEl.innerHTML+=`<div style="font-size:10px;font-weight:700;color:var(--tx3);margin:8px 0 4px">${time}</div>`;
      meals.forEach(m=>{
        const eaten=!!m.eaten;
        planEl.innerHTML+=`<div class="diet-meal-item ${eaten?'diet-meal-eaten':''}">
          ${m.image?`<img src="${m.image}" style="width:52px;height:52px;object-fit:cover;border-radius:8px;flex-shrink:0;margin-right:2px" onclick="viewMealPhoto('${m.image.replace(/'/g,'&#39;')}')" title="View photo"/>`:''}
          <div style="flex:1">
            <div class="diet-meal-food">${m.food}</div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:3px">
              ${m.protein?`<span class="diet-tag diet-tag-protein">💪 ${m.protein}g protein</span>`:''}
              ${m.cal?`<span class="diet-tag">🔥 ${m.cal} kcal</span>`:''}
            </div>
            ${eaten&&m.eatenNote?`<div style="font-size:10px;color:#059669;margin-top:3px;font-style:italic">✓ Marked at ${m.eatenNote}</div>`:''}
          </div>
          <div style="display:flex;gap:4px;align-items:center">
            <button class="${eaten?'btn-eaten-on':'btn-eaten-off'}" onclick="togglePlanEaten('${ds}',${m.idx})">${eaten?'✅':'○ Ate?'}</button>
            <button class="diet-meal-del" onclick="delPlanMeal('${ds}',${m.idx})">×</button>
          </div>
        </div>`;
      });
    });
    const tc=day.plan.reduce((a,m)=>a+(+m.cal||0),0);
    const tp=day.plan.reduce((a,m)=>a+(+m.protein||0),0);
    if(tc>0||tp>0) planEl.innerHTML+=`<div style="text-align:right;font-size:11px;color:var(--p1);font-weight:700;margin-top:8px;padding-top:8px;border-top:1px solid var(--cb)">${tp>0?`💪 ${tp}g protein &nbsp;`:''}${tc>0?`🔥 ~${tc} kcal`:''}</div>`;
  }
  // Eaten list
  const eatEl=document.getElementById('diet-eaten-list');
  if(!day.eaten.length){
    eatEl.innerHTML='<div class="diet-empty">Log extra/unplanned food here.<br>For planned meals, use <strong>○ Ate?</strong> on the left! 🍽️</div>';
  } else {
    eatEl.innerHTML='';
    const groups={};
    day.eaten.forEach((m,i)=>{ if(!groups[m.time]) groups[m.time]=[]; groups[m.time].push({...m,idx:i}); });
    Object.entries(groups).forEach(([time,meals])=>{
      eatEl.innerHTML+=`<div style="font-size:10px;font-weight:700;color:var(--tx3);margin:8px 0 4px">${time}</div>`;
      meals.forEach(m=>{
        eatEl.innerHTML+=`<div class="diet-meal-item" style="border-color:#6ee7b7;background:#f0fdf4">
          ${m.image?`<img src="${m.image}" style="width:52px;height:52px;object-fit:cover;border-radius:8px;flex-shrink:0;margin-right:2px" onclick="viewMealPhoto('${m.image.replace(/'/g,'&#39;')}')" title="View photo"/>`:''}
          <div style="flex:1">
            <div class="diet-meal-food">${m.food}</div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:3px">
              ${m.protein?`<span class="diet-tag diet-tag-protein">💪 ${m.protein}g protein</span>`:''}
              ${m.cal?`<span class="diet-tag">🔥 ${m.cal} kcal</span>`:''}
            </div>
            ${m.note?`<div style="font-size:10px;color:var(--tx2);font-style:italic;margin-top:2px">${m.note}</div>`:''}
          </div>
          <button class="diet-meal-del" onclick="delEatenMeal('${ds}',${m.idx})">×</button>
        </div>`;
      });
    });
    const tc=day.eaten.reduce((a,m)=>a+(+m.cal||0),0);
    const tp=day.eaten.reduce((a,m)=>a+(+m.protein||0),0);
    if(tc>0||tp>0) eatEl.innerHTML+=`<div style="text-align:right;font-size:11px;color:#059669;font-weight:700;margin-top:8px;padding-top:8px;border-top:1px solid #6ee7b7">${tp>0?`💪 ${tp}g protein &nbsp;`:''}${tc>0?`🔥 ~${tc} kcal`:''}</div>`;
  }
  // Match table
  const mtEl=document.getElementById('diet-match-table');
  if(!day.plan.length&&!day.eaten.length){
    mtEl.innerHTML='<p class="tm" style="font-size:12px;text-align:center;padding:12px">Add a plan and log meals to see comparison ✨</p>';
  } else {
    mtEl.innerHTML='';
    day.plan.forEach((m,i)=>{
      const matched=!!m.eaten;
      mtEl.innerHTML+=`<div class="diet-match-row ${matched?'matched':'missed'}">
        <span class="diet-match-icon">${matched?'✅':'❌'}</span>
        <div class="diet-match-txt">
          <div style="font-weight:700;font-size:13px">${m.food}</div>
          <div style="font-size:10px;opacity:0.7">${m.time}${m.protein?' • '+m.protein+'g protein':''}${m.cal?' • ~'+m.cal+' kcal':''}</div>
        </div>
        <span class="diet-match-badge">${matched?'Eaten':'Missed'}</span>
      </div>`;
    });
    if(day.eaten.length){
      mtEl.innerHTML+=`<div style="font-size:10px;font-weight:700;color:var(--tx3);margin:12px 0 6px">➕ Extra / Unplanned</div>`;
      day.eaten.forEach(m=>{
        mtEl.innerHTML+=`<div class="diet-match-row extra">
          <span class="diet-match-icon">🍽️</span>
          <div class="diet-match-txt">
            <div style="font-weight:700;font-size:13px">${m.food}</div>
            <div style="font-size:10px;opacity:0.7">${m.time}${m.protein?' • '+m.protein+'g protein':''}${m.cal?' • ~'+m.cal+' kcal':''}</div>
            ${m.note?`<div style="font-size:10px;font-style:italic;color:var(--tx2)">${m.note}</div>`:''}
          </div>
          <span class="diet-match-badge">Extra</span>
        </div>`;
      });
    }
  }
  const notesEl=document.getElementById('diet-notes');
  if(notesEl) notesEl.value=day.note||'';
}
function renderDietMonthStrip(targetDate,activeDs){
  const year=targetDate.getFullYear(),month=targetDate.getMonth();
  const daysInMonth=new Date(year,month+1,0).getDate();
  const todayDs=dStr(Date.now());
  document.getElementById('diet-month-title').textContent=`📅 ${targetDate.toLocaleDateString('en-US',{month:'long',year:'numeric'})} — Click a day to view`;
  const strip=document.getElementById('diet-cal-strip');
  strip.innerHTML='';
  if(!S.dietData) S.dietData={};
  for(let d=1;d<=daysInMonth;d++){
    const ds=`${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const day=S.dietData[ds];
    const isActive=ds===activeDs,isToday=ds===todayDs;
    let cls='diet-cal-cell no-plan';
    if(day&&(day.plan.length>0||day.eaten.length>0)){
      const pct=day.plan.length>0?Math.min(100,Math.round(day.plan.filter(m=>m.eaten).length/day.plan.length*100)):(day.eaten.length>0?100:0);
      if(pct===100) cls='diet-cal-cell pct-full';
      else if(pct>=80) cls='diet-cal-cell pct-high';
      else if(pct>=50) cls='diet-cal-cell pct-mid';
      else cls='diet-cal-cell pct-low';
    }
    if(isActive) cls+=' active';
    if(isToday) cls+=' today-cell';
    const todayDate=new Date(); todayDate.setHours(0,0,0,0);
    const cellDate=new Date(year,month,d);
    const diff=Math.round((cellDate-todayDate)/86400000);
    strip.innerHTML+=`<div class="${cls}" onclick="dietJumpTo(${diff})" title="${ds}">${d}</div>`;
  }
}
function togglePlanEaten(ds,idx){
  if(!S.dietData||!S.dietData[ds]) return;
  const item=S.dietData[ds].plan[idx];
  if(item.eaten){ delete item.eaten; delete item.eatenNote; }
  else{ item.eaten=true; item.eatenNote=new Date().toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'}); }
  save(); renderDiet();
}
function addPlanMeal(){
  const time=document.getElementById('pm-time').value;
  const food=document.getElementById('pm-food').value.trim();
  const cal=document.getElementById('pm-cal').value;
  const protein=document.getElementById('pm-protein').value;
  if(!food){ toast('Enter what you plan to eat! 🥗','bad'); return; }
  const imgEl=document.getElementById('pm-img-prev-img');
  const image = imgEl&&imgEl.src&&imgEl.src!==window.location.href ? imgEl.src : null;
  const ds=getDietDs();
  if(!S.dietData) S.dietData={};
  if(!S.dietData[ds]) S.dietData[ds]={plan:[],eaten:[],note:''};
  S.dietData[ds].plan.push({time,food,cal:cal||'',protein:protein||'',image});
  save(); closeModal('m-add-plan-meal');
  ['pm-food','pm-cal','pm-protein'].forEach(id=>document.getElementById(id).value='');
  clearMealImage('pm');
  renderDiet(); toast('Meal added to plan! 📋','ok');
}
function addEatenMeal(){
  const time=document.getElementById('em-time').value;
  const food=document.getElementById('em-food').value.trim();
  const cal=document.getElementById('em-cal').value;
  const protein=document.getElementById('em-protein').value;
  const note=document.getElementById('em-feel').value;
  if(!food){ toast('Enter what you ate! 🍽️','bad'); return; }
  const imgEl=document.getElementById('em-img-prev-img');
  const image = imgEl&&imgEl.src&&imgEl.src!==window.location.href ? imgEl.src : null;
  const ds=getDietDs();
  if(!S.dietData) S.dietData={};
  if(!S.dietData[ds]) S.dietData[ds]={plan:[],eaten:[],note:''};
  S.dietData[ds].eaten.push({time,food,cal:cal||'',protein:protein||'',note,image});
  save(); closeModal('m-add-eaten-meal');
  ['em-food','em-cal','em-protein'].forEach(id=>document.getElementById(id).value='');
  clearMealImage('em');
  renderDiet(); toast('Meal logged! ✅','ok');
}
function delPlanMeal(ds,idx){ if(!S.dietData||!S.dietData[ds]) return; S.dietData[ds].plan.splice(idx,1); save(); renderDiet(); }
function delEatenMeal(ds,idx){ if(!S.dietData||!S.dietData[ds]) return; S.dietData[ds].eaten.splice(idx,1); save(); renderDiet(); }
function saveDietNote(){ const ds=getDietDs(); if(!S.dietData) S.dietData={}; if(!S.dietData[ds]) S.dietData[ds]={plan:[],eaten:[],note:''}; S.dietData[ds].note=document.getElementById('diet-notes').value; save(); }
function dietNav(dir){ dietOffset+=dir; renderDiet(); }
function dietGoToday(){ dietOffset=0; renderDiet(); }
function dietJumpTo(diff){ dietOffset=diff; renderDiet(); }
function getDietDs(){ const d=new Date(); d.setDate(d.getDate()+dietOffset); return dStr(d.getTime()); }

// Meal image helpers
function previewMealImage(input, prefix){
  const file=input.files[0]; if(!file) return;
  const reader=new FileReader();
  reader.onload=e=>{
    document.getElementById(prefix+'-img-prev-img').src=e.target.result;
    document.getElementById(prefix+'-img-preview').style.display='block';
    document.getElementById(prefix+'-img-clear').style.display='inline';
  };
  reader.readAsDataURL(file);
}
function clearMealImage(prefix){
  const fileEl=document.getElementById(prefix+'-img-file');
  const prevEl=document.getElementById(prefix+'-img-preview');
  const clearEl=document.getElementById(prefix+'-img-clear');
  const imgEl=document.getElementById(prefix+'-img-prev-img');
  if(fileEl) fileEl.value='';
  if(prevEl) prevEl.style.display='none';
  if(clearEl) clearEl.style.display='none';
  if(imgEl) imgEl.src='';
}

// Diet month tabs — all 12 months of 2026
function renderDietMonthTabs(currentDate){
  const tabsEl=document.getElementById('diet-month-tabs'); if(!tabsEl) return;
  const monthNames=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const activeKey=`${currentDate.getFullYear()}-${String(currentDate.getMonth()+1).padStart(2,'0')}`;
  tabsEl.innerHTML=monthNames.map((name,i)=>{
    const key=`2026-${String(i+1).padStart(2,'0')}`;
    const isActive=key===activeKey;
    const hasDays=S.dietData&&Object.keys(S.dietData).some(k=>k.startsWith(key));
    return `<button onclick="dietJumpToMonth(2026,${i})" style="flex-shrink:0;padding:5px 12px;border-radius:20px;border:1.5px solid ${isActive?'var(--p1)':'var(--cb)'};background:${isActive?'var(--p1)':'var(--bg3)'};color:${isActive?'#fff':'var(--tx2)'};font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap;transition:all 0.2s">${hasDays?'📍 ':''}${name}</button>`;
  }).join('');
  setTimeout(()=>{
    const active=tabsEl.querySelector('[style*="var(--p1)"]');
    if(active) active.scrollIntoView({behavior:'smooth',inline:'center',block:'nearest'});
  },50);
}
function dietJumpToMonth(year, month){
  const now=new Date();
  const target=new Date(year, month, 1);
  // If it's current month, go to today
  if(year===now.getFullYear()&&month===now.getMonth()){ dietOffset=0; renderDiet(); return; }
  // Otherwise jump to 1st of that month
  const today=new Date(now.getFullYear(),now.getMonth(),now.getDate());
  const diff=Math.round((target-today)/86400000);
  dietOffset=diff; renderDiet();
}

// ===== MOOD =====
let _mood=null;
function renderMood(){
  document.getElementById('m-note-sec').style.display='none';
  const el=document.getElementById('m-history');
  el.innerHTML='';
  const recent=[...S.moods].reverse().slice(0,20);
  if(!recent.length){ el.innerHTML='<p class="tc tm mt4">No mood logs yet 💌</p>'; return; }
  recent.forEach((m,ri)=>{
    const realIdx=S.moods.length-1-ri;
    el.innerHTML+=`<div class="je">
      <div class="je-top">
        <span class="je-date">${new Date(m.date).toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</span>
        <div style="display:flex;align-items:center;gap:6px">
          <span style="font-size:18px">${m.emoji}</span>
          <button class="btn btn-g btn-sm" onclick="editMood(${realIdx})" style="padding:3px 8px;font-size:10px">✏️</button>
          <button class="btn btn-d btn-sm" onclick="deleteMood(${realIdx})" style="padding:3px 8px;font-size:10px">×</button>
        </div>
      </div>
      <div style="font-weight:600;font-size:12px;margin-bottom:4px;color:var(--p1)">${m.label}</div>
      <div class="je-text">${m.note||'<em style="color:var(--tx3)">No note</em>'}</div>
    </div>`;
  });
  renderMoodChart();
}
function renderMoodChart(){
  const el=document.getElementById('m-chart'); if(!el) return;
  const moodScore={'😊':4,'😍':5,'😌':4,'🥰':5,'😐':3,'😔':1,'😤':2,'😴':2,'🤩':5,'💪':4};
  const days=[];
  for(let i=6;i>=0;i--){
    const d=new Date(Date.now()-i*86400000);
    const ds=dStr(d.getTime());
    const dm=S.moods.filter(m=>dStr(new Date(m.date).getTime())===ds);
    const avg=dm.length?dm.reduce((a,m)=>a+(moodScore[m.emoji]||3),0)/dm.length:0;
    days.push({label:d.toLocaleDateString('en-US',{weekday:'short'}),avg});
  }
  el.innerHTML=days.map(d=>`<div class="mc-col">
    <div class="mc-bar" style="height:${d.avg?Math.round(d.avg/5*100):3}%;background:${d.avg>3.5?'var(--g1)':d.avg>2?'var(--g3)':'linear-gradient(135deg,#94a3b8,#64748b)'}"></div>
    <div class="mc-lbl">${d.label}</div>
  </div>`).join('');
}
function pickMood(emoji,label){
  _mood={emoji,label};
  document.getElementById('sel-em').textContent=emoji;
  document.getElementById('sel-lbl').textContent=label;
  document.getElementById('m-note-sec').style.display='block';
}
function saveMood(){
  if(!_mood){ toast('Pick a mood first! 💌','bad'); return; }
  const note=document.getElementById('m-note').value.trim();
  S.moods.push({..._mood,note,date:new Date().toISOString()});
  S.xp+=5; updateLevel(); save(); renderMood();
  document.getElementById('m-note').value='';
  document.getElementById('m-note-sec').style.display='none';
  document.querySelectorAll('.mdbtn').forEach(b=>{b.style.borderColor='var(--cb)';b.style.background='var(--bg3)';b.style.color='var(--tx2)';});
  _mood=null; toast('Mood logged! +5 XP 💌','ok');
}
function editMood(idx){
  const m=S.moods[idx]; if(!m) return;
  openModal('m-edit-mood');
  document.getElementById('edit-mood-emoji').value=m.emoji;
  document.getElementById('edit-mood-label').value=m.label;
  document.getElementById('edit-mood-note').value=m.note||'';
  document.getElementById('edit-mood-save').onclick=()=>{
    S.moods[idx].emoji=document.getElementById('edit-mood-emoji').value||m.emoji;
    S.moods[idx].label=document.getElementById('edit-mood-label').value||m.label;
    S.moods[idx].note=document.getElementById('edit-mood-note').value;
    save(); closeModal('m-edit-mood'); renderMood(); toast('Mood updated! 💌','ok');
  };
}
function deleteMood(idx){ if(!confirm('Delete this mood entry?')) return; S.moods.splice(idx,1); save(); renderMood(); }

// ===== JOURNAL =====
function renderJournal(){
  const q=document.getElementById('j-search')?.value?.toLowerCase()||'';
  const el=document.getElementById('j-list');
  el.innerHTML='';
  let entries=[...S.journals].reverse();
  if(q) entries=entries.filter(j=>j.title?.toLowerCase().includes(q)||j.text?.toLowerCase().includes(q)||j.tags?.some(t=>t.toLowerCase().includes(q)));
  if(!entries.length){ el.innerHTML='<p class="tc tm mt4">No journal entries yet ✍️</p>'; return; }
  entries.forEach(j=>{
    el.innerHTML+=`<div class="je" onclick="viewJournal('${j.id}')">
      <div class="je-top">
        <span class="je-date">${new Date(j.date).toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})}</span>
        <span style="font-size:15px">${j.mood||'📖'}</span>
      </div>
      ${j.tags&&j.tags.length?`<div class="je-tags">${j.tags.map(t=>`<span class="je-tag">${t}</span>`).join('')}</div>`:''}
      <div class="je-title">${j.title||'Untitled Entry'}</div>
      <div class="je-text">${j.text}</div>
    </div>`;
  });
}
function viewJournal(id){
  const j=S.journals.find(x=>x.id===id); if(!j) return;
  openModal('m-view-journal');
  document.getElementById('vj-title').textContent=j.title||'Untitled Entry';
  document.getElementById('vj-date').textContent=new Date(j.date).toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
  document.getElementById('vj-mood').textContent=j.mood||'📖';
  document.getElementById('vj-tags').innerHTML=j.tags?.map(t=>`<span class="badge badge-p">${t}</span>`).join('')||'';
  document.getElementById('vj-text').innerHTML=j.text.replace(/\n/g,'<br>');
  document.getElementById('vj-del').onclick=()=>{ if(!confirm('Delete this entry?')) return; S.journals=S.journals.filter(x=>x.id!==id); save(); closeModal('m-view-journal'); renderJournal(); };
}
function saveJournal(){
  const title=document.getElementById('nj-title').value.trim();
  const text=document.getElementById('nj-text').value.trim();
  const tags=document.getElementById('nj-tags').value.split(',').map(t=>t.trim()).filter(Boolean);
  const mood=document.getElementById('nj-mood').value;
  if(!text){ toast('Write something first! ✍️','bad'); return; }
  S.journals.push({id:'j'+Date.now(),title:title||'My Entry',text,tags,mood:mood||'📖',date:new Date().toISOString()});
  S.xp+=8; updateLevel(); save();
  closeModal('m-new-journal');
  ['nj-title','nj-text','nj-tags'].forEach(id=>document.getElementById(id).value='');
  toast('Journal saved! +8 XP ✍️','ok'); go('journal');
}
function exportJournal(){
  if(!S.journals.length){ toast('No journal entries to export!','bad'); return; }
  let html=`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>GlowUp Diary — Journal</title>
  <style>body{font-family:Georgia,serif;max-width:700px;margin:40px auto;padding:20px;color:#1a0a14;background:#fff5fb}
  h1{font-size:32px;color:#f472b6;margin-bottom:4px}.sub{color:#7a3a5a;margin-bottom:32px;font-size:14px}
  .entry{margin-bottom:28px;padding:20px;border:1px solid #fce7f3;border-radius:12px;background:#fff}
  .entry-date{font-size:12px;color:#c4a0b5}.entry-title{font-size:20px;font-weight:700;margin:6px 0}
  .entry-text{font-size:14px;line-height:1.8;color:#4a2535}
  .tag{display:inline-block;padding:2px 8px;background:#fce7f3;color:#db2777;border-radius:20px;font-size:11px;margin-right:4px;font-weight:700}
  </style></head><body><h1>🎀 GlowUp Diary — My Journal</h1>
  <p class="sub">${S.user?.name} • Exported ${new Date().toLocaleDateString()}</p>`;
  [...S.journals].reverse().forEach(j=>{
    html+=`<div class="entry"><div class="entry-date">${new Date(j.date).toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'})} ${j.mood||''}</div>
    <div class="entry-title">${j.title||'Untitled Entry'}</div>
    ${j.tags?.length?`<div style="margin:6px 0">${j.tags.map(t=>`<span class="tag">${t}</span>`).join('')}</div>`:''}
    <div class="entry-text">${j.text.replace(/\n/g,'<br>')}</div></div>`;
  });
  html+=`</body></html>`;
  const b=new Blob([html],{type:'text/html'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(b);
  a.download=`glowup-journal-${new Date().toISOString().split('T')[0]}.html`; a.click();
  toast('Journal exported! 📤','ok');
}

// ===== GOALS =====
function renderGoals(){
  const el=document.getElementById('g-board');
  el.innerHTML='';
  if(!S.goals.length){ el.innerHTML='<p class="tc tm mt4" style="grid-column:1/-1">Start your vision board! 🌷</p>'; return; }
  S.goals.forEach(g=>{
    const p=g.progress||0;
    const imgHtml = g.image
      ? `<div class="vimg" style="padding:0;overflow:hidden;height:140px"><img src="${g.image}" style="width:100%;height:140px;object-fit:cover;display:block"/></div>`
      : `<div class="vimg">${g.emoji||'🌷'}</div>`;
    el.innerHTML+=`<div class="vitem">
      ${imgHtml}
      <div class="vcont">
        <div class="vtitle">${g.title}</div>
        <div class="vdesc">${g.desc||''}</div>
        ${g.quote?`<div style="font-style:italic;font-size:10px;color:var(--p1);margin-top:5px">"${g.quote}"</div>`:''}
        <div style="margin-top:8px">
          <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--tx2);margin-bottom:3px"><span>Progress</span><span style="font-weight:700;color:var(--p1)">${p}%</span></div>
          <div class="pw"><div class="pf" style="width:${p}%"></div></div>
        </div>
        <div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap">
          <button class="btn btn-g btn-sm" onclick="updateGoal('${g.id}')">Update</button>
          <label class="btn btn-g btn-sm" style="cursor:pointer">📷 Change Image<input type="file" accept="image/*" style="display:none" onchange="changeGoalImage('${g.id}',this)"/></label>
          <button class="btn btn-d btn-sm" onclick="delGoal('${g.id}')">🗑️</button>
        </div>
      </div>
    </div>`;
  });
}
function previewGoalImage(input){
  const file=input.files[0]; if(!file) return;
  const reader=new FileReader();
  reader.onload=e=>{
    document.getElementById('ag-img-prev-img').src=e.target.result;
    document.getElementById('ag-img-preview').style.display='block';
    document.getElementById('ag-img-clear').style.display='inline';
  };
  reader.readAsDataURL(file);
}
function clearGoalImage(){
  document.getElementById('ag-img-file').value='';
  document.getElementById('ag-img-preview').style.display='none';
  document.getElementById('ag-img-clear').style.display='none';
  document.getElementById('ag-img-prev-img').src='';
}
function addGoalFromModal(){
  const ti=document.getElementById('ag-title').value;
  const de=document.getElementById('ag-desc').value;
  const qu=document.getElementById('ag-quote').value;
  const em=document.getElementById('ag-emoji').value;
  if(!ti.trim()){ toast('Enter a goal title! 🌷','bad'); return; }
  const imgEl=document.getElementById('ag-img-prev-img');
  const image = imgEl.src && imgEl.src!==window.location.href ? imgEl.src : null;
  S.goals.push({id:'g'+Date.now(),title:ti,desc:de,quote:qu,emoji:em||'🌷',progress:0,image});
  save(); renderGoals(); toast('Goal added! 🌸','ok');
  closeModal('m-add-goal');
  ['ag-title','ag-desc','ag-emoji','ag-quote'].forEach(i=>document.getElementById(i).value='');
  clearGoalImage();
}
function changeGoalImage(id,input){
  const file=input.files[0]; if(!file) return;
  const reader=new FileReader();
  reader.onload=e=>{ const g=S.goals.find(x=>x.id===id); if(!g) return; g.image=e.target.result; save(); renderGoals(); toast('Image updated! 📸','ok'); };
  reader.readAsDataURL(file);
}
function addGoal(ti,de,qu,em){
  if(!ti.trim()) return;
  S.goals.push({id:'g'+Date.now(),title:ti,desc:de,quote:qu,emoji:em||'🌷',progress:0});
  save(); renderGoals(); toast('Goal added! 🌸','ok');
}
function delGoal(id){ if(!confirm('Remove goal?')) return; S.goals=S.goals.filter(g=>g.id!==id); save(); renderGoals(); }
function updateGoal(id){
  const g=S.goals.find(x=>x.id===id); if(!g) return;
  const v=prompt(`Progress for "${g.title}" (0-100):`,g.progress);
  if(v===null) return;
  g.progress=Math.max(0,Math.min(100,+v||0)); save(); renderGoals();
  if(g.progress===100){ confetti(); toast('🎉 Goal complete!','ok'); }
}

// ===== FOCUS =====
let pomS=25*60,pomTotal=25*60,pomRun=false,pomBreak=false,pomTimer=null;
function renderFocus(){
  updateTimer();
  document.getElementById('pom-cnt').textContent=S.pomSessions;
}
function updateTimer(){
  const m=String(Math.floor(pomS/60)).padStart(2,'0'),s=String(pomS%60).padStart(2,'0');
  document.getElementById('t-text').textContent=`${m}:${s}`;
  const C=2*Math.PI*104;
  const ring=document.getElementById('t-ring-path');
  if(ring){ring.style.strokeDasharray=C;ring.style.strokeDashoffset=C*(1-pomS/pomTotal);}
}
function startPom(){
  if(pomRun) return; pomRun=true;
  document.getElementById('pom-start').disabled=true;
  document.getElementById('pom-pause').disabled=false;
  pomTimer=setInterval(()=>{
    if(pomS<=0){
      clearInterval(pomTimer); pomRun=false;
      if(!pomBreak){ S.pomSessions++; S.xp+=25; updateLevel(); save(); toast('Focus done! +25 XP 🎉 Take a break!','ok'); pomBreak=true; pomS=5*60; pomTotal=5*60; document.getElementById('pom-mode').textContent='☕ Break Time'; }
      else{ pomBreak=false; pomS=25*60; pomTotal=25*60; document.getElementById('pom-mode').textContent='🎯 Focus Time'; toast('Break over! Let\'s go! 💪','ok'); }
      document.getElementById('pom-cnt').textContent=S.pomSessions;
      document.getElementById('pom-start').disabled=false;
      document.getElementById('pom-pause').disabled=true;
      updateTimer(); return;
    }
    pomS--; updateTimer();
  },1000);
}
function pausePom(){ clearInterval(pomTimer); pomRun=false; document.getElementById('pom-start').disabled=false; document.getElementById('pom-pause').disabled=true; }
function resetPom(){ clearInterval(pomTimer); pomRun=false; pomBreak=false; pomS=25*60; pomTotal=25*60; document.getElementById('pom-mode').textContent='🎯 Focus Time'; document.getElementById('pom-start').disabled=false; document.getElementById('pom-pause').disabled=true; updateTimer(); }
function setPomMode(m){ clearInterval(pomTimer); pomRun=false; pomBreak=m===5; pomS=m*60; pomTotal=m*60; document.getElementById('pom-start').disabled=false; document.getElementById('pom-pause').disabled=true; updateTimer(); }

// ===== SETTINGS =====
function renderSettings(){
  if(!S.user) return;
  document.getElementById('st-name').value=S.user.name;
  document.getElementById('st-email').value=S.user.email;
  const avs=['🌸','🌺','🌷','💐','🌻','🦋','🌙','⭐','💎','👑','🌈','🎀','💖','✨','🍒','🦄','🌊','🔮'];
  const el=document.getElementById('st-avs'); el.innerHTML='';
  avs.forEach(a=>{
    const on=S.user.avatar===a;
    el.innerHTML+=`<div onclick="pickAv('${a}')" id="av-${CSS.escape(a)}" style="width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:22px;cursor:pointer;border:2px solid ${on?'var(--p1)':'var(--cb)'};background:${on?'var(--pl)':'var(--bg3)'};transition:var(--t)">${a}</div>`;
  });
}
function pickAv(a){
  S.user.avatar=a; save();
  document.querySelectorAll('[id^="av-"]').forEach(e=>{e.style.border='2px solid var(--cb)';e.style.background='var(--bg3)';});
  try{ const el=document.getElementById('av-'+CSS.escape(a)); if(el){el.style.border='2px solid var(--p1)';el.style.background='var(--pl)';} }catch(e){}
  document.getElementById('sb-av').textContent=a;
}
function saveSettings(){
  const n=document.getElementById('st-name').value.trim();
  if(!n){ toast('Name cannot be empty!','bad'); return; }
  S.user.name=n; save(); updateSidebarUser(); toast('Settings saved! ✨','ok');
}
function exportData(){
  const b=new Blob([JSON.stringify(S,null,2)],{type:'application/json'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(b);
  a.download='glowup-backup.json'; a.click(); toast('Data exported! 📤','ok');
}
function clearData(){
  if(!confirm('⚠️ Delete ALL data? This cannot be undone.')) return;
  localStorage.removeItem('gd2'); toast('Data cleared. Refreshing...','bad');
  setTimeout(()=>location.reload(),1200);
}

// ===== MODAL =====
function openModal(id){ document.getElementById(id).classList.add('on'); }
function closeModal(id){ document.getElementById(id).classList.remove('on'); }

// ===== TOAST =====
function toast(msg,type=''){
  const c=document.getElementById('toasts');
  const el=document.createElement('div');
  el.className=`toast ${type}`;
  const ico={ok:'💖',bad:'❌','':'✨'};
  el.innerHTML=`<span>${ico[type]||'✨'}</span><span>${msg}</span>`;
  c.appendChild(el); setTimeout(()=>el.remove(),3100);
}

// ===== CONFETTI =====
function confetti(){
  const c=document.getElementById('cc');
  const cols=['#f472b6','#a78bfa','#fbbf24','#34d399','#fb7185','#60a5fa'];
  for(let i=0;i<75;i++){
    const p=document.createElement('div'); p.className='cp';
    p.style.cssText=`left:${Math.random()*100}vw;background:${cols[Math.floor(Math.random()*cols.length)]};animation-duration:${1.5+Math.random()*2}s;animation-delay:${Math.random()*0.5}s;width:${6+Math.random()*7}px;height:${6+Math.random()*7}px;border-radius:${Math.random()>.5?'50%':'2px'}`;
    c.appendChild(p); setTimeout(()=>p.remove(),4000);
  }
}

// ===== SOUND =====
function sound(){
  try{
    const ctx=new(window.AudioContext||window.webkitAudioContext)();
    [523.25,659.25,783.99].forEach((f,i)=>{
      const o=ctx.createOscillator(),g=ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.frequency.value=f; o.type='sine';
      g.gain.setValueAtTime(0.08,ctx.currentTime+i*0.1);
      g.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+i*0.1+0.3);
      o.start(ctx.currentTime+i*0.1); o.stop(ctx.currentTime+i*0.1+0.3);
    });
  }catch(e){}
}

// ===== HELPERS =====
function viewMealPhoto(src){
  // Simple lightbox overlay
  const ov=document.createElement('div');
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:9999;display:flex;align-items:center;justify-content:center;cursor:pointer';
  ov.innerHTML=`<img src="${src}" style="max-width:90vw;max-height:88vh;border-radius:14px;box-shadow:0 8px 40px rgba(0,0,0,0.5)"/><div style="position:absolute;top:18px;right:22px;color:#fff;font-size:32px;font-weight:700;cursor:pointer;line-height:1">×</div>`;
  ov.onclick=()=>ov.remove();
  document.body.appendChild(ov);
}
function todayStr(){ return dStr(Date.now()); }
function dStr(ts){ const d=new Date(ts); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
