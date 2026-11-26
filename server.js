/**
 * Mine Door QR – Backend
 * Zero external deps (Node built-ins only).
 * SQLite-like persistence via JSON file + atomic writes.
 * Ready to swap the store for real SQLite / Postgres / Supabase later.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'store.json');
const PUBLIC = __dirname; // serve frontend from same folder

// ---------- Simple JSON store ----------
function ensureDataDir() {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({
      doors: [],
      events: [],
      users: [],
      presence: {}
    }, null, 2));
  }
}

function load() {
  ensureDataDir();
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
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

// ---------- Helpers ----------
function send(res, status, body, extraHeaders = {}) {
  const json = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS',
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
    '.webmanifest': 'application/manifest+json'
  };
  return map[ext] || 'application/octet-stream';
}

// ---------- API handlers ----------
async function handleApi(req, res, pathname) {
  const method = req.method;
  const db = load();

  // CORS preflight
  if (method === 'OPTIONS') {
    return send(res, 204, '');
  }

  // GET /api/health
  if (pathname === '/api/health' && method === 'GET') {
    return send(res, 200, { ok: true, time: new Date().toISOString() });
  }

  // GET /api/doors
  if (pathname === '/api/doors' && method === 'GET') {
    return send(res, 200, db.doors);
  }

  // GET /api/doors/:id
  if (pathname.startsWith('/api/doors/') && method === 'GET') {
    const id = pathname.split('/')[3];
    const door = db.doors.find(d => d.id === id);
    if (!door) return send(res, 404, { error: 'Door not found' });
    return send(res, 200, door);
  }

  // POST /api/doors  (Admin create)
  if (pathname === '/api/doors' && method === 'POST') {
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
      createdBy: body.createdBy || 'unknown',
      createdAt: now,
      updatedAt: now
    };
    db.doors.push(door);
    // also log created event
    db.events.push({
      id: uuid(),
      doorId: door.id,
      type: 'created',
      userId: door.createdBy,
      userName: body.userName || 'Admin',
      timestamp: now,
      synced: true,
      offline: false
    });
    save(db);
    return send(res, 201, door);
  }

  // PATCH /api/doors/:id
  if (pathname.startsWith('/api/doors/') && method === 'PATCH') {
    const id = pathname.split('/')[3];
    const door = db.doors.find(d => d.id === id);
    if (!door) return send(res, 404, { error: 'Door not found' });
    const body = await parseBody(req);
    if (body.assignedShiftBossId !== undefined) door.assignedShiftBossId = body.assignedShiftBossId;
    if (body.status) door.status = body.status;
    door.updatedAt = new Date().toISOString();
    save(db);
    return send(res, 200, door);
  }

  // GET /api/events
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

  // POST /api/events  (batch or single – idempotent on event.id)
  if (pathname === '/api/events' && method === 'POST') {
    const body = await parseBody(req);
    const incoming = Array.isArray(body) ? body : [body];
    const accepted = [];

    for (const ev of incoming) {
      if (!ev.id || !ev.doorId || !ev.type) continue;
      // Idempotent: skip if already exists
      if (db.events.some(e => e.id === ev.id)) {
        accepted.push(ev);
        continue;
      }
      const event = {
        id: ev.id,
        doorId: ev.doorId,
        type: ev.type,
        userId: ev.userId || 'unknown',
        userName: ev.userName || 'Unknown',
        timestamp: ev.timestamp || new Date().toISOString(),
        synced: true,
        offline: !!ev.offline,
        deviceId: ev.deviceId || null
      };
      db.events.push(event);

      // Update door status based on event
      const door = db.doors.find(d => d.id === ev.doorId);
      if (door) {
        if (ev.type === 'pasted') {
          door.status = 'pasted';
          door.pastedAt = event.timestamp;
          door.pastedBy = event.userId;
        } else if (ev.type === 'closed') {
          door.status = 'closed';
          door.closedAt = event.timestamp;
          door.closedBy = event.userId;
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

  // POST /api/presence
  if (pathname === '/api/presence' && method === 'POST') {
    const body = await parseBody(req);
    if (body.userId) {
      db.presence[body.userId] = {
        name: body.name || 'User',
        role: body.role || '',
        lastSeen: new Date().toISOString()
      };
      save(db);
    }
    return send(res, 200, { ok: true });
  }

  // GET /api/presence
  if (pathname === '/api/presence' && method === 'GET') {
    const now = Date.now();
    const online = Object.entries(db.presence)
      .filter(([, v]) => now - new Date(v.lastSeen).getTime() < 5 * 60 * 1000) // 5 min
      .map(([id, v]) => ({ id, ...v }));
    return send(res, 200, online);
  }

  // GET /api/stickers?ids=id1,id2  → returns doors for sticker sheet
  if (pathname === '/api/stickers' && method === 'GET') {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const ids = (url.searchParams.get('ids') || '').split(',').filter(Boolean);
    const doors = ids.length
      ? db.doors.filter(d => ids.includes(d.id))
      : db.doors.filter(d => d.status === 'created' || d.status === 'pasted');
    return send(res, 200, doors);
  }

  send(res, 404, { error: 'Not found' });
}

// ---------- Static + API server ----------
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    let pathname = url.pathname;

    // API
    if (pathname.startsWith('/api/')) {
      return await handleApi(req, res, pathname);
    }

    // Static files
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
    // SPA fallback
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
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Mine Door QR server running at http://0.0.0.0:${PORT}`);
  console.log(`API base: http://0.0.0.0:${PORT}/api`);
});