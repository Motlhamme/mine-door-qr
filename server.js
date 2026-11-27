/**
 * Mine Door QR – Backend
 * Company-number login + role-based access
 * Zero external deps (Node built-ins only)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'store.json');
const PUBLIC = __dirname;
const TOKEN_SECRET = process.env.TOKEN_SECRET || 'mine-door-qr-dev-secret-change-in-prod';
const SESSIONS = new Map(); // token -> { userId, exp }

// ---------- Password hashing (scrypt) ----------
function hashPassword(password, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, hash) {
  const check = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(check, 'hex'), Buffer.from(hash, 'hex'));
}

function makeToken(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  SESSIONS.set(token, { userId, exp: Date.now() + 7 * 24 * 60 * 60 * 1000 }); // 7 days
  return token;
}

function getUserFromToken(req) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return null;
  const sess = SESSIONS.get(token);
  if (!sess || sess.exp < Date.now()) {
    if (sess) SESSIONS.delete(token);
    return null;
  }
  const db = load();
  return db.users.find(u => u.id === sess.userId) || null;
}

// ---------- Seed default users (company numbers) ----------
function seedUsers(db) {
  if (db.users && db.users.length > 0) return db;

  const defaults = [
    { companyNo: 'ADMIN001', name: 'System Admin', role: 'admin', password: 'admin123' },
    { companyNo: 'VE001', name: 'Ventilation Engineer', role: 'vent_engineer', password: 'vent123' },
    { companyNo: 'MC001', name: 'Mine Captain 1', role: 'mine_captain', password: 'captain123' },
    { companyNo: 'MC002', name: 'Mine Captain 2', role: 'mine_captain', password: 'captain123' },
    { companyNo: 'MC003', name: 'Mine Captain 3', role: 'mine_captain', password: 'captain123' },
    { companyNo: 'SB001', name: 'Shift Boss A', role: 'shift_boss', password: 'shift123' },
    { companyNo: 'SB002', name: 'Shift Boss B', role: 'shift_boss', password: 'shift123' },
    { companyNo: 'SB003', name: 'Shift Boss C', role: 'shift_boss', password: 'shift123' },
    { companyNo: 'VO001', name: 'Vent Officer 1', role: 'vent_officer', password: 'officer123' },
    { companyNo: 'VO002', name: 'Vent Officer 2', role: 'vent_officer', password: 'officer123' },
    { companyNo: 'VO003', name: 'Vent Officer 3', role: 'vent_officer', password: 'officer123' }
  ];

  db.users = defaults.map(u => {
    const { salt, hash } = hashPassword(u.password);
    return {
      id: crypto.randomUUID(),
      companyNo: u.companyNo.toUpperCase(),
      name: u.name,
      role: u.role,
      salt,
      passwordHash: hash,
      active: true,
      mustChangePassword: false,
      createdAt: new Date().toISOString()
    };
  });
  save(db);
  console.log('[Seed] Default users created. See DEMO_LOGINS.md for credentials.');
  return db;
}

// ---------- Store ----------
function ensureDataDir() {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({
      doors: [], events: [], users: [], presence: {}
    }, null, 2));
  }
}

function load() {
  ensureDataDir();
  let db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  if (!db.users) db.users = [];
  if (!db.doors) db.doors = [];
  if (!db.events) db.events = [];
  if (!db.presence) db.presence = {};
  return db;
}

function save(data) {
  ensureDataDir();
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}

function uuid() {
  return crypto.randomUUID();
}

function send(res, status, body, extraHeaders = {}) {
  const json = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    ...extraHeaders
  });
  res.end(json);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; if (data.length > 2e6) reject(new Error('Too large')); });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function mime(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.webmanifest': 'application/manifest+json',
    '.md': 'text/markdown'
  };
  return map[ext] || 'application/octet-stream';
}

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    companyNo: u.companyNo,
    name: u.name,
    role: u.role,
    active: u.active !== false,
    mustChangePassword: !!u.mustChangePassword
  };
}

// ---------- API ----------
async function handleApi(req, res, pathname) {
  const method = req.method;
  if (method === 'OPTIONS') return send(res, 204, '');

  let db = load();
  db = seedUsers(db);

  // ---- Auth (no token required) ----
  if (pathname === '/api/health' && method === 'GET') {
    return send(res, 200, { ok: true, time: new Date().toISOString() });
  }

  if (pathname === '/api/login' && method === 'POST') {
    const body = await parseBody(req);
    const companyNo = (body.companyNo || '').toString().trim().toUpperCase();
    const password = (body.password || '').toString();
    if (!companyNo || !password) {
      return send(res, 400, { error: 'Company number and password required' });
    }
    const user = db.users.find(u => u.companyNo === companyNo && u.active !== false);
    if (!user || !verifyPassword(password, user.salt, user.passwordHash)) {
      return send(res, 401, { error: 'Invalid company number or password' });
    }
    const token = makeToken(user.id);
    return send(res, 200, { token, user: publicUser(user) });
  }

  if (pathname === '/api/me' && method === 'GET') {
    const user = getUserFromToken(req);
    if (!user) return send(res, 401, { error: 'Not logged in' });
    return send(res, 200, publicUser(user));
  }

  // All routes below require login (except we still allow pull for offline demo –
  // for production you'd require auth on everything)
  const currentUser = getUserFromToken(req);

  // ---- Users management (Admin only) ----
  if (pathname === '/api/users' && method === 'GET') {
    if (!currentUser || currentUser.role !== 'admin') {
      return send(res, 403, { error: 'Admin only' });
    }
    return send(res, 200, db.users.map(publicUser));
  }

  if (pathname === '/api/users' && method === 'POST') {
    if (!currentUser || currentUser.role !== 'admin') {
      return send(res, 403, { error: 'Admin only' });
    }
    const body = await parseBody(req);
    const companyNo = (body.companyNo || '').toString().trim().toUpperCase();
    const name = (body.name || '').toString().trim();
    const role = body.role;
    const password = (body.password || '').toString();
    const validRoles = ['admin', 'vent_engineer', 'mine_captain', 'shift_boss', 'vent_officer'];
    if (!companyNo || !name || !role || !password) {
      return send(res, 400, { error: 'companyNo, name, role, password required' });
    }
    if (!validRoles.includes(role)) {
      return send(res, 400, { error: 'Invalid role' });
    }
    if (db.users.some(u => u.companyNo === companyNo)) {
      return send(res, 409, { error: 'Company number already exists' });
    }
    const { salt, hash } = hashPassword(password);
    const user = {
      id: uuid(),
      companyNo,
      name,
      role,
      salt,
      passwordHash: hash,
      active: true,
      mustChangePassword: true,
      createdAt: new Date().toISOString()
    };
    db.users.push(user);
    save(db);
    return send(res, 201, publicUser(user));
  }

  // Change password (own account or admin)
  if (pathname === '/api/users/password' && method === 'POST') {
    if (!currentUser) return send(res, 401, { error: 'Not logged in' });
    const body = await parseBody(req);
    const targetId = body.userId || currentUser.id;
    const newPassword = (body.newPassword || '').toString();
    if (newPassword.length < 4) {
      return send(res, 400, { error: 'Password must be at least 4 characters' });
    }
    if (targetId !== currentUser.id && currentUser.role !== 'admin') {
      return send(res, 403, { error: 'Can only change your own password' });
    }
    const user = db.users.find(u => u.id === targetId);
    if (!user) return send(res, 404, { error: 'User not found' });
    const { salt, hash } = hashPassword(newPassword);
    user.salt = salt;
    user.passwordHash = hash;
    user.mustChangePassword = false;
    save(db);
    return send(res, 200, { ok: true });
  }

  // ---- Doors ----
  if (pathname === '/api/doors' && method === 'GET') {
    return send(res, 200, db.doors);
  }

  if (pathname.startsWith('/api/doors/') && method === 'GET') {
    const id = pathname.split('/')[3];
    const door = db.doors.find(d => d.id === id);
    if (!door) return send(res, 404, { error: 'Door not found' });
    return send(res, 200, door);
  }

  if (pathname === '/api/doors' && method === 'POST') {
    if (!currentUser || currentUser.role !== 'admin') {
      return send(res, 403, { error: 'Admin only' });
    }
    const body = await parseBody(req);
    if (!body.location || !body.location.trim()) {
      return send(res, 400, { error: 'location is required' });
    }
    const now = new Date().toISOString();
    const door = {
      id: uuid(),
      location: body.location.trim(),
      zone: body.zone || null,
      notes: body.notes || null,
      status: 'created',
      assignedShiftBossId: null,
      createdBy: currentUser.id,
      createdAt: now,
      updatedAt: now
    };
    db.doors.push(door);
    db.events.push({
      id: uuid(),
      doorId: door.id,
      type: 'created',
      userId: currentUser.id,
      userName: currentUser.name,
      timestamp: now,
      synced: true,
      offline: false
    });
    save(db);
    return send(res, 201, door);
  }

  if (pathname.startsWith('/api/doors/') && method === 'PATCH') {
    if (!currentUser) return send(res, 401, { error: 'Not logged in' });
    const id = pathname.split('/')[3];
    const door = db.doors.find(d => d.id === id);
    if (!door) return send(res, 404, { error: 'Door not found' });
    const body = await parseBody(req);
    if (body.assignedShiftBossId !== undefined) {
      if (!['mine_captain', 'admin'].includes(currentUser.role)) {
        return send(res, 403, { error: 'Only Mine Captain or Admin can assign' });
      }
      door.assignedShiftBossId = body.assignedShiftBossId;
    }
    if (body.status) door.status = body.status;
    door.updatedAt = new Date().toISOString();
    save(db);
    return send(res, 200, door);
  }


  // PATCH /api/users/:id  (activate/deactivate, admin)
  if (pathname.startsWith('/api/users/') && method === 'PATCH') {
    if (!currentUser || currentUser.role !== 'admin') {
      return send(res, 403, { error: 'Admin only' });
    }
    const id = pathname.split('/')[3];
    if (!id || id === 'password') return send(res, 404, { error: 'Not found' });
    const user = db.users.find(u => u.id === id);
    if (!user) return send(res, 404, { error: 'User not found' });
    const body = await parseBody(req);
    if (typeof body.active === 'boolean') {
      if (user.id === currentUser.id && body.active === false) {
        return send(res, 400, { error: 'Cannot deactivate yourself' });
      }
      user.active = body.active;
    }
    if (body.resetPassword) {
      const { salt, hash } = hashPassword(String(body.resetPassword));
      user.salt = salt;
      user.passwordHash = hash;
      user.mustChangePassword = true;
    }
    save(db);
    return send(res, 200, publicUser(user));
  }

  // ---- Events ----
  if (pathname === '/api/events' && method === 'GET') {
    const url = new URL(req.url, `http://${req.headers.host}`);
    let events = db.events;
    const doorId = url.searchParams.get('doorId');
    const since = url.searchParams.get('since');
    if (doorId) events = events.filter(e => e.doorId === doorId);
    if (since) events = events.filter(e => e.timestamp >= since);
    events.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    return send(res, 200, events);
  }

  if (pathname === '/api/events' && method === 'POST') {
    if (!currentUser) return send(res, 401, { error: 'Not logged in' });
    const body = await parseBody(req);
    const incoming = Array.isArray(body) ? body : [body];
    const accepted = [];

    for (const ev of incoming) {
      if (!ev.id || !ev.doorId || !ev.type) continue;
      if (db.events.some(e => e.id === ev.id)) {
        accepted.push(ev);
        continue;
      }
      // Role checks for paste / close
      if (ev.type === 'pasted' && currentUser.role !== 'vent_officer' && currentUser.role !== 'admin') {
        continue;
      }
      if (ev.type === 'closed' && currentUser.role !== 'shift_boss' && currentUser.role !== 'admin') {
        continue;
      }
      // Shift bosses may only close doors assigned to them
      if (ev.type === 'closed' && currentUser.role === 'shift_boss') {
        const doorCheck = db.doors.find(d => d.id === ev.doorId);
        if (!doorCheck || doorCheck.assignedShiftBossId !== currentUser.id) {
          continue; // skip – not assigned to this boss
        }
      }
      const event = {
        id: ev.id,
        doorId: ev.doorId,
        type: ev.type,
        userId: currentUser.id,
        userName: currentUser.name,
        timestamp: ev.timestamp || new Date().toISOString(),
        synced: true,
        offline: !!ev.offline,
        deviceId: ev.deviceId || null,
        assignedShiftBossId: ev.assignedShiftBossId
      };
      db.events.push(event);

      const door = db.doors.find(d => d.id === ev.doorId);
      if (door) {
        if (ev.type === 'pasted') {
          door.status = 'pasted';
          door.pastedAt = event.timestamp;
          door.pastedBy = currentUser.id;
        } else if (ev.type === 'closed') {
          door.status = 'closed';
          door.closedAt = event.timestamp;
          door.closedBy = currentUser.id;
        } else if (ev.type === 'assigned' && ev.assignedShiftBossId) {
          door.assignedShiftBossId = ev.assignedShiftBossId;
        }
        door.updatedAt = event.timestamp;
      }
      accepted.push(event);
    }
    save(db);
    return send(res, 201, { accepted: accepted.length, events: accepted });
  }

  // ---- Presence ----
  if (pathname === '/api/presence' && method === 'POST') {
    if (!currentUser) return send(res, 401, { error: 'Not logged in' });
    db.presence[currentUser.id] = {
      name: currentUser.name,
      role: currentUser.role,
      companyNo: currentUser.companyNo,
      lastSeen: new Date().toISOString()
    };
    save(db);
    return send(res, 200, { ok: true });
  }

  if (pathname === '/api/presence' && method === 'GET') {
    const now = Date.now();
    const online = Object.entries(db.presence)
      .filter(([, v]) => now - new Date(v.lastSeen).getTime() < 5 * 60 * 1000)
      .map(([id, v]) => ({ id, ...v }));
    return send(res, 200, online);
  }

  if (pathname === '/api/stickers' && method === 'GET') {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const ids = (url.searchParams.get('ids') || '').split(',').filter(Boolean);
    const doors = ids.length
      ? db.doors.filter(d => ids.includes(d.id))
      : db.doors.filter(d => d.status === 'created' || d.status === 'pasted');
    return send(res, 200, doors);
  }

  // List shift bosses (for assignment UI)
  if (pathname === '/api/shift-bosses' && method === 'GET') {
    const bosses = db.users
      .filter(u => u.role === 'shift_boss' && u.active !== false)
      .map(publicUser);
    return send(res, 200, bosses);
  }

  send(res, 404, { error: 'Not found' });
}

// ---------- Server ----------
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    let pathname = url.pathname;

    if (pathname.startsWith('/api/')) {
      return await handleApi(req, res, pathname);
    }

    if (pathname === '/') pathname = '/index.html';
    const filePath = path.join(PUBLIC, pathname.replace(/\.\./g, ''));
    if (!filePath.startsWith(PUBLIC)) {
      res.writeHead(403); return res.end('Forbidden');
    }
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const data = fs.readFileSync(filePath);
      res.writeHead(200, { 'Content-Type': mime(filePath) });
      return res.end(data);
    }
    const index = path.join(PUBLIC, 'index.html');
    if (fs.existsSync(index)) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(fs.readFileSync(index));
    }
    res.writeHead(404); res.end('Not found');
  } catch (err) {
    console.error(err);
    send(res, 500, { error: err.message });
  }
});

ensureDataDir();
// Force re-seed if users empty
const initial = load();
seedUsers(initial);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Mine Door QR server running at http://0.0.0.0:${PORT}`);
  console.log(`API base: http://0.0.0.0:${PORT}/api`);
});
