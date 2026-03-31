# 🌸 GlowUp Diary — Backend Setup Guide

Zero external dependencies. Pure Node.js. Works on any server, VPS, or Raspberry Pi.

---

## What's included

```
glowup-diary-server/
├── server.js          ← Backend server (auth + data storage)
├── package.json
├── data/
│   └── db.json        ← Auto-created: stores all users + data
└── public/            ← Frontend (served by the same server)
    ├── index.html
    ├── css/style.css
    ├── js/app.js
    └── pages/
```

---

## How it works

- **Auth**: Email + password signup/login. Passwords hashed with PBKDF2 (100,000 rounds). JWTs with 30-day expiry.
- **Storage**: All data saved in `data/db.json`. One file, no database software needed.
- **API**: REST endpoints at `/api/signup`, `/api/login`, `/api/data` (GET + PUT).
- **Frontend**: Served from `/public` by the same Node server.
- **Offline**: App works offline using cached data, syncs when reconnected.
- **1 email = 1 account**: Server enforces this automatically.

---

## Option 1 — Run Locally (test on your machine)

```bash
# Make sure Node.js is installed (v16+)
node --version

# Start the server
node server.js

# Open in browser
# http://localhost:3001
```

---

## Option 2 — Deploy to Railway (free, recommended for cloud)

1. Go to https://railway.app → Sign up free
2. Click **New Project** → **Deploy from GitHub**
3. Upload this folder to a GitHub repo, then connect it
4. Railway auto-detects Node.js and runs `node server.js`
5. Set environment variable: `JWT_SECRET=any-long-random-string`
6. Done! You get a URL like `https://glowup.up.railway.app`

---

## Option 3 — Deploy to Render (free)

1. Go to https://render.com → Sign up free
2. New **Web Service** → connect your GitHub repo
3. Build command: (leave empty)
4. Start command: `node server.js`
5. Add env var: `JWT_SECRET=your-secret`
6. Deploy → get URL like `https://glowup.onrender.com`

---

## Option 4 — Deploy to a VPS (DigitalOcean, Hetzner, etc.)

```bash
# On your server:
git clone <your-repo> glowup
cd glowup

# Run with PM2 to keep it alive
npm install -g pm2
pm2 start server.js --name glowup
pm2 startup
pm2 save

# Optional: use nginx as a reverse proxy on port 80/443
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Server port |
| `JWT_SECRET` | Auto-generated | Secret for signing JWTs — **set this in production!** |

---

## After Deploying

Open `public/js/app.js` and check the `API_BASE` line near the top:

```js
const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? `${window.location.protocol}//${window.location.hostname}:3001/api`
  : '/api';
```

If your frontend and backend are on the **same server** (recommended), this works automatically. If you separate them, change `'/api'` to your server URL.

---

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/signup` | No | Create account |
| POST | `/api/login` | No | Login, get token |
| GET | `/api/me` | Bearer | Get current user info |
| GET | `/api/data` | Bearer | Get all user data |
| PUT | `/api/data` | Bearer | Save all user data |
| POST | `/api/change-password` | Bearer | Change password |

---

## Data Backup

The entire database is in `data/db.json`. Back it up anytime:

```bash
cp data/db.json backup-$(date +%Y%m%d).json
```

---

## Features

✅ Email + password auth (no third-party services)
✅ 1 account per email — duplicate prevention built in
✅ Passwords hashed with PBKDF2 (industry standard)
✅ JWT tokens — 30-day sessions
✅ Works from phone + laptop + any device simultaneously
✅ Offline mode with local cache — syncs when back online
✅ All data: habits, tasks, journals, moods, goals, diet, streaks
✅ Rate limiting on login/signup to prevent abuse
✅ Zero npm dependencies — just Node.js
