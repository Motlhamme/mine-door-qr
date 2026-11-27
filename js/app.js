/**
 * Mine Door QR – Main Application
 * Offline-first PWA for iOS + Android handhelds
 */

const App = {
  user: null,
  currentView: 'home',
  scannerStream: null,
  scanLoopId: null,

  async init() {
    Offline.init();
    await this.loadSession();
    this.bindEvents();
    this.handleDeepLink();
    if (this.user) {
      this.showMain();
    } else {
      this.showLogin();
    }
  },

  async loadSession() {
    const session = await DB.getSession();
    if (session && session.user) {
      this.user = session.user;
      this.token = session.token || null;
      // Validate token with server if online
      if (this.token && navigator.onLine) {
        try {
          const res = await fetch('/api/me', { headers: { 'Authorization': 'Bearer ' + this.token } });
          if (res.ok) {
            this.user = await res.json();
          } else {
            this.user = null;
            this.token = null;
            await DB.clearSession();
          }
        } catch (_) {}
      }
    }
  },

  async saveSession() {
    await DB.setSession({ user: this.user, token: this.token });
  },

  async login() {
    const companyNo = (document.getElementById('input-company')?.value || '').trim();
    const password = document.getElementById('input-password')?.value || '';
    const errEl = document.getElementById('login-error');
    if (errEl) { errEl.classList.add('hidden'); errEl.textContent = ''; }

    if (!companyNo || !password) {
      if (errEl) { errEl.textContent = 'Enter company number and password'; errEl.classList.remove('hidden'); }
      return;
    }

    const btn = document.getElementById('btn-login');
    if (btn) { btn.disabled = true; btn.textContent = 'Signing in…'; }

    try {
      if (navigator.onLine) {
        const res = await fetch('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ companyNo, password })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Login failed');
        this.user = data.user;
        this.token = data.token;
        await this.saveSession();
        if (this.user.mustChangePassword) {
          this.showPasswordModal();
        } else {
          this.showMain();
          this.toast('Welcome, ' + this.user.name);
          Offline.sendPresence();
        }
      } else {
        // Offline fallback: only if previously logged in with same company number
        const session = await DB.getSession();
        if (session?.user?.companyNo?.toUpperCase() === companyNo.toUpperCase() && session.token) {
          this.user = session.user;
          this.token = session.token;
          this.showMain();
          this.toast('Offline mode – using saved session');
        } else {
          throw new Error('You must log in online at least once');
        }
      }
    } catch (e) {
      if (errEl) {
        errEl.textContent = e.message || 'Login failed';
        errEl.classList.remove('hidden');
      }
      this.toast(e.message || 'Login failed', 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Log In'; }
    }
  },

  authHeaders() {
    return this.token
      ? { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + this.token }
      : { 'Content-Type': 'application/json' };
  },

  showLogin() {
    document.getElementById('screen-login').classList.add('active');
    document.getElementById('screen-main').classList.remove('active');
  },

  showMain() {
    if (this.user?.mustChangePassword) {
      this.showPasswordModal();
      return;
    }
    document.getElementById('screen-login').classList.remove('active');
    document.getElementById('screen-main').classList.add('active');
    document.getElementById('modal-password')?.classList.add('hidden');
    this.updateHeader();
    this.applyRoleVisibility();
    this.navigate('home');

    const pending = sessionStorage.getItem('pendingDoor');
    if (pending) {
      sessionStorage.removeItem('pendingDoor');
      setTimeout(() => {
        this.navigate('scan');
        this.showDoorAction(pending);
      }, 300);
    }
  },

  showPasswordModal() {
    document.getElementById('screen-login')?.classList.remove('active');
    document.getElementById('screen-main')?.classList.remove('active');
    const modal = document.getElementById('modal-password');
    if (modal) modal.classList.remove('hidden');
    document.getElementById('new-password').value = '';
    document.getElementById('new-password2').value = '';
    document.getElementById('pw-error')?.classList.add('hidden');
  },

  async saveNewPassword() {
    const p1 = document.getElementById('new-password')?.value || '';
    const p2 = document.getElementById('new-password2')?.value || '';
    const err = document.getElementById('pw-error');
    if (p1.length < 4) {
      if (err) { err.textContent = 'Password must be at least 4 characters'; err.classList.remove('hidden'); }
      return;
    }
    if (p1 !== p2) {
      if (err) { err.textContent = 'Passwords do not match'; err.classList.remove('hidden'); }
      return;
    }
    try {
      const res = await fetch('/api/users/password', {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify({ newPassword: p1 })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      this.user.mustChangePassword = false;
      await this.saveSession();
      document.getElementById('modal-password')?.classList.add('hidden');
      this.showMain();
      this.toast('Password updated');
      Offline.sendPresence();
    } catch (e) {
      if (err) { err.textContent = e.message; err.classList.remove('hidden'); }
    }
  },


  updateHeader() {
    const badge = document.getElementById('user-badge');
    const navUser = document.getElementById('nav-user');
    if (this.user) {
      badge.textContent = this.user.name.split(' ')[0];
      navUser.innerHTML = `<strong>${this.user.name}</strong><br><small>${this.roleLabel(this.user.role)}</small>`;
    }
  },

  roleLabel(role) {
    const map = {
      admin: 'Admin',
      vent_officer: 'Ventilation Officer',
      shift_boss: 'Shift Boss',
      vent_engineer: 'Ventilation Engineer',
      mine_captain: 'Mine Captain'
    };
    return map[role] || role;
  },

  applyRoleVisibility() {
    document.querySelectorAll('.nav-item[class*="role-"]').forEach(el => {
      const roles = [...el.classList].filter(c => c.startsWith('role-')).map(c => c.replace('role-', ''));
      if (roles.length && !roles.includes(this.user.role)) {
        el.classList.add('hidden-role');
      } else {
        el.classList.remove('hidden-role');
      }
    });
  },

  bindEvents() {
    // Login
    const doLogin = () => this.login();
    document.getElementById('btn-login')?.addEventListener('click', doLogin);
    document.getElementById('input-password')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') doLogin();
    });
    document.getElementById('input-company')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') document.getElementById('input-password')?.focus();
    });

    // Menu
    document.getElementById('btn-menu').addEventListener('click', () => {
      document.getElementById('side-nav').classList.toggle('open');
    });
    document.getElementById('side-nav').addEventListener('click', (e) => {
      if (e.target.classList.contains('nav-item') && e.target.dataset.view) {
        this.navigate(e.target.dataset.view);
        document.getElementById('side-nav').classList.remove('open');
      }
    });
    document.getElementById('btn-logout').addEventListener('click', async () => {
      await DB.clearSession();
      this.user = null;
      this.token = null;
      this.stopScanner();
      this.showLogin();
      const c = document.getElementById('input-company');
      const p = document.getElementById('input-password');
      if (c) c.value = '';
      if (p) p.value = '';
    });

    // Create door
    document.getElementById('btn-create-door').addEventListener('click', () => this.createDoor());
    document.getElementById('btn-new-qr').addEventListener('click', () => {
      document.getElementById('create-result').classList.add('hidden');
      document.getElementById('create-location').value = '';
      document.getElementById('create-zone').value = '';
      document.getElementById('create-notes').value = '';
    });
    document.getElementById('btn-download-qr').addEventListener('click', () => this.downloadQR());
    document.getElementById('btn-print-qr').addEventListener('click', () => window.print());

    // Scan
    document.getElementById('btn-start-scan').addEventListener('click', () => this.startScanner());
    document.getElementById('btn-stop-scan').addEventListener('click', () => this.stopScanner());
    document.getElementById('btn-manual-scan').addEventListener('click', () => {
      const raw = document.getElementById('manual-door-id').value.trim();
      if (raw) this.openDoorFromCode(raw);
    });

    // Filter
    document.getElementById('filter-status').addEventListener('change', () => this.renderDoors());

    // Torch
    const torchBtn = document.getElementById('btn-torch');
    if (torchBtn) torchBtn.addEventListener('click', () => this.toggleTorch());

    // Stickers
    const selAll = document.getElementById('btn-select-all-stickers');
    if (selAll) selAll.addEventListener('click', () => {
      document.querySelectorAll('#sticker-select-list input[type=checkbox]').forEach(c => c.checked = true);
      this.renderStickerPreview();
    });
    const printBtn = document.getElementById('btn-print-stickers');
    if (printBtn) printBtn.addEventListener('click', () => this.printStickerSheet());

    document.getElementById('btn-save-password')?.addEventListener('click', () => this.saveNewPassword());
    document.getElementById('btn-create-user')?.addEventListener('click', () => this.createUser());
  },

  navigate(view) {
    this.currentView = view;
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    const viewEl = document.getElementById('view-' + view);
    if (viewEl) viewEl.classList.add('active');
    const navEl = document.querySelector(`.nav-item[data-view="${view}"]`);
    if (navEl) navEl.classList.add('active');

    const titles = {
      home: 'Home',
      create: 'Create QR',
      scan: 'Scan QR',
      doors: 'All Doors',
      dashboard: 'Dashboard',
      assign: 'Assign Doors',
      stickers: 'Sticker Sheet',
      users: 'Manage Users'
    };
    document.getElementById('header-title').textContent = titles[view] || 'Mine Door QR';

    this.refreshCurrentView();
  },

  refreshCurrentView() {
    switch (this.currentView) {
      case 'home': this.renderHome(); break;
      case 'doors': this.renderDoors(); break;
      case 'dashboard': this.renderDashboard(); break;
      case 'assign': this.renderAssign(); break;
      case 'stickers': this.renderStickers(); break;
      case 'users': this.renderUsers(); break;
    }
  },

  // ---------- Home ----------
  async renderHome() {
    document.getElementById('home-name').textContent = this.user.name;
    document.getElementById('home-role').textContent = this.roleLabel(this.user.role);

    const actions = document.getElementById('quick-actions');
    actions.innerHTML = '';
    const add = (label, view) => {
      const b = document.createElement('button');
      b.className = 'btn primary';
      b.textContent = label;
      b.onclick = () => this.navigate(view);
      actions.appendChild(b);
    };
    if (this.user.role === 'admin') {
      add('Create QR Code', 'create');
      add('Manage Users', 'users');
    }
    add('Scan QR', 'scan');
    add('View Doors', 'doors');
    if (['vent_engineer', 'mine_captain'].includes(this.user.role)) add('Dashboard', 'dashboard');
    if (this.user.role === 'mine_captain') add('Assign Doors', 'assign');

    const events = await DB.getEvents();
    events.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    const recent = events.slice(0, 8);
    const list = document.getElementById('home-recent');
    if (recent.length === 0) {
      list.innerHTML = '<p class="muted">No activity yet.</p>';
    } else {
      list.innerHTML = recent.map(e => this.eventHtml(e)).join('');
    }
  },

  eventHtml(e) {
    const offlineTag = e.offline ? ' <span class="badge" style="background:#ef4444">offline</span>' : '';
    const typeLabel = e.type === 'pasted' ? 'QR Pasted' : e.type === 'closed' ? 'Door Closed' : e.type;
    return `<div class="event-item ${e.offline ? 'offline-event' : ''}">
      <div><strong>${typeLabel}</strong>${offlineTag}</div>
      <div class="meta">${e.userName} · ${this.fmtTime(e.timestamp)}</div>
    </div>`;
  },

  // ---------- Create QR ----------
  async createDoor() {
    const location = document.getElementById('create-location').value.trim();
    if (!location) {
      this.toast('Location name is required', 'error');
      return;
    }
    const zone = document.getElementById('create-zone').value.trim();
    const notes = document.getElementById('create-notes').value.trim();

    let door;
    if (navigator.onLine) {
      try {
        const res = await fetch('/api/doors', {
          method: 'POST',
          headers: this.authHeaders(),
          body: JSON.stringify({
            location,
            zone: zone || null,
            notes: notes || null
          })
        });
        if (!res.ok) throw new Error('API error');
        door = await res.json();
        await DB.saveDoor(door);
      } catch (err) {
        console.warn('API create failed, falling back to local', err);
        door = null;
      }
    }

    if (!door) {
      door = {
        id: uuid(),
        location,
        zone: zone || null,
        notes: notes || null,
        status: 'created',
        createdBy: this.user.id,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      await DB.saveDoor(door);
      await Offline.recordEvent({
        doorId: door.id,
        type: 'created',
        userId: this.user.id,
        userName: this.user.name
      });
    }

    const data = window.location.protocol.startsWith('http')
      ? `${window.location.origin}${window.location.pathname}?door=${door.id}`
      : `minedoor://scan/${door.id}`;

    const canvas = document.getElementById('qr-canvas');
    // qrcodejs draws into a container; use a wrapper div approach
    const wrap = document.getElementById('qr-canvas-wrap');
    wrap.innerHTML = '';
    const holder = document.createElement('div');
    holder.id = 'qr-holder';
    wrap.appendChild(holder);
    new QRCode(holder, {
      text: data,
      width: 240,
      height: 240,
      colorDark: '#0f172a',
      colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.M
    });
    // keep a canvas reference for download via the generated img/canvas inside
    const genCanvas = holder.querySelector('canvas');
    if (genCanvas) {
      genCanvas.id = 'qr-canvas';
    }

    document.getElementById('create-location-display').textContent = location + (zone ? ` (${zone})` : '');
    document.getElementById('create-result').classList.remove('hidden');
    this.toast('QR code generated');
    this._lastQRData = data;
    this._lastDoor = door;
  },

  downloadQR() {
    const canvas = document.querySelector('#qr-canvas-wrap canvas') || document.getElementById('qr-canvas');
    const img = document.querySelector('#qr-canvas-wrap img');
    const link = document.createElement('a');
    link.download = `door-qr-${this._lastDoor?.id?.slice(0, 8) || 'code'}.png`;
    if (canvas) {
      link.href = canvas.toDataURL('image/png');
    } else if (img) {
      link.href = img.src;
    } else {
      this.toast('No QR to download', 'error');
      return;
    }
    link.click();
  },

  // ---------- Scanner ----------
  torchOn: false,
  torchTrack: null,

  async startScanner() {
    const container = document.getElementById('scanner-container');
    const video = document.getElementById('scanner-video');
    const statusEl = document.getElementById('scan-status');
    try {
      this.scannerStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false
      });
      video.srcObject = this.scannerStream;
      await video.play();
      container.classList.add('active');
      document.getElementById('btn-start-scan').classList.add('hidden');
      document.getElementById('btn-stop-scan').classList.remove('hidden');

      // Torch support
      const track = this.scannerStream.getVideoTracks()[0];
      this.torchTrack = track;
      const caps = track.getCapabilities ? track.getCapabilities() : {};
      if (caps.torch) {
        document.getElementById('btn-torch').classList.remove('hidden');
        this.torchOn = false;
      } else {
        document.getElementById('btn-torch').classList.add('hidden');
      }

      if (statusEl) {
        statusEl.textContent = 'Looking for QR…';
        statusEl.classList.remove('found');
      }
      this.scanLoop();
    } catch (err) {
      console.error(err);
      this.toast('Camera access denied or unavailable. Use manual entry.', 'error');
    }
  },

  async toggleTorch() {
    if (!this.torchTrack) return;
    try {
      this.torchOn = !this.torchOn;
      await this.torchTrack.applyConstraints({ advanced: [{ torch: this.torchOn }] });
      const btn = document.getElementById('btn-torch');
      btn.textContent = this.torchOn ? '🔦 On' : '🔦 Flash';
      btn.classList.toggle('primary', this.torchOn);
    } catch (err) {
      this.toast('Flashlight not supported on this device', 'error');
    }
  },

  stopScanner() {
    if (this.scanLoopId) {
      cancelAnimationFrame(this.scanLoopId);
      this.scanLoopId = null;
    }
    if (this.torchOn && this.torchTrack) {
      try { this.torchTrack.applyConstraints({ advanced: [{ torch: false }] }); } catch (_) {}
      this.torchOn = false;
    }
    if (this.scannerStream) {
      this.scannerStream.getTracks().forEach(t => t.stop());
      this.scannerStream = null;
    }
    this.torchTrack = null;
    const video = document.getElementById('scanner-video');
    if (video) video.srcObject = null;
    document.getElementById('scanner-container').classList.remove('active');
    document.getElementById('btn-start-scan').classList.remove('hidden');
    document.getElementById('btn-stop-scan').classList.add('hidden');
    document.getElementById('btn-torch').classList.add('hidden');
  },

  scanLoop() {
    const video = document.getElementById('scanner-video');
    const statusEl = document.getElementById('scan-status');
    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'attemptBoth' });
      if (code) {
        if (statusEl) {
          statusEl.textContent = 'QR found!';
          statusEl.classList.add('found');
        }
        // short vibration if available
        if (navigator.vibrate) navigator.vibrate(80);
        this.stopScanner();
        this.openDoorFromCode(code.data);
        return;
      }
    }
    this.scanLoopId = requestAnimationFrame(() => this.scanLoop());
  },

  openDoorFromCode(raw) {
    // Accept full URL, minedoor://scan/ID, or plain UUID
    let doorId = raw;
    try {
      if (raw.includes('door=')) {
        doorId = new URL(raw).searchParams.get('door') || raw;
      } else if (raw.includes('minedoor://')) {
        doorId = raw.split('/').pop();
      } else if (raw.includes('/scan/')) {
        doorId = raw.split('/scan/').pop().split('?')[0];
      }
    } catch (_) {}
    doorId = doorId.trim();
    this.showDoorAction(doorId);
  },

  async showDoorAction(doorId) {
    const result = document.getElementById('scan-result');
    result.classList.remove('hidden');
    result.innerHTML = '<p class="muted">Loading…</p>';

    let door = await DB.getDoor(doorId);
    if (!door) {
      // In a real system the door would already exist. For demo we allow creating a placeholder.
      result.innerHTML = `
        <h3>Door not found locally</h3>
        <p class="muted">ID: ${doorId.slice(0, 13)}…</p>
        <p>This QR has not been created on this device yet. Create it first as Admin, or sync from server.</p>
        <button class="btn secondary full" onclick="document.getElementById('scan-result').classList.add('hidden')">Close</button>
      `;
      return;
    }

    const canPaste = this.user.role === 'vent_officer' && door.status === 'created';
    const assignedToMe = !door.assignedShiftBossId || door.assignedShiftBossId === this.user.id;
    const canClose = this.user.role === 'shift_boss' && door.status === 'pasted' && assignedToMe;
    const notAssigned = this.user.role === 'shift_boss' && door.status === 'pasted' && !assignedToMe;
    const isReadOnly = !canPaste && !canClose;

    let actionHtml = '';
    if (canPaste) {
      actionHtml = `<button class="btn primary full" id="btn-confirm-paste">Confirm QR Pasted</button>`;
    } else if (canClose) {
      actionHtml = `<button class="btn primary full" id="btn-confirm-close">Confirm Door Closed</button>`;
    } else if (notAssigned) {
      actionHtml = `<p class="muted" style="color:var(--warning)">This door is not assigned to you. Only the assigned Shift Boss can close it.</p>`;
    } else {
      actionHtml = `<p class="muted">No action available for your role on this door right now.</p>`;
    }

    result.innerHTML = `
      <h3>${door.location}</h3>
      <p class="meta">${door.zone || ''} · Status: <span class="badge ${door.status}">${door.status}</span></p>
      ${door.notes ? `<p class="small">${door.notes}</p>` : ''}
      <div style="margin-top:16px">${actionHtml}</div>
      <button class="btn secondary full" style="margin-top:8px" onclick="document.getElementById('scan-result').classList.add('hidden')">Close</button>
    `;

    if (canPaste) {
      document.getElementById('btn-confirm-paste').onclick = () => this.confirmAction(door, 'pasted');
    }
    if (canClose) {
      document.getElementById('btn-confirm-close').onclick = () => this.confirmAction(door, 'closed');
    }
  },

  async confirmAction(door, type) {
    await Offline.recordEvent({
      doorId: door.id,
      type,
      userId: this.user.id,
      userName: this.user.name
    });
    const msg = type === 'pasted'
      ? `QR pasted – ${door.location} by ${this.user.name}`
      : `Door closed – ${door.location} by ${this.user.name}`;
    this.toast(msg, 'success');
    document.getElementById('scan-result').classList.add('hidden');
    this.refreshCurrentView();
  },

  // ---------- Doors list ----------
  async renderDoors() {
    const filter = document.getElementById('filter-status').value;
    let doors = await DB.getAllDoors();
    doors.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    if (filter !== 'all') doors = doors.filter(d => d.status === filter);

    const list = document.getElementById('doors-list');
    if (doors.length === 0) {
      list.innerHTML = '<p class="muted">No doors yet. Create one as Admin.</p>';
      return;
    }
    list.innerHTML = doors.map(d => `
      <div class="door-item status-${d.status}">
        <div class="loc">${d.location} <span class="badge ${d.status}">${d.status}</span></div>
        <div class="meta">
          ${d.zone ? d.zone + ' · ' : ''}
          Updated ${this.fmtTime(d.updatedAt)}
          ${d.assignedShiftBossId ? ' · Assigned' : ''}
        </div>
      </div>
    `).join('');
  },

  // ---------- Dashboard ----------
  async renderDashboard() {
    const doors = await DB.getAllDoors();
    const events = await DB.getEvents();
    events.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    // Summary
    const counts = { created: 0, pasted: 0, closed: 0 };
    doors.forEach(d => counts[d.status] = (counts[d.status] || 0) + 1);
    document.getElementById('status-summary').innerHTML = `
      <div class="summary-item"><div class="num">${counts.created}</div><div class="lbl">Created</div></div>
      <div class="summary-item"><div class="num">${counts.pasted}</div><div class="lbl">Pasted</div></div>
      <div class="summary-item"><div class="num">${counts.closed}</div><div class="lbl">Closed</div></div>
    `;

    // Online users from presence API + local
    const onlineEl = document.getElementById('online-users');
    let chips = '';
    try {
      if (navigator.onLine) {
        const res = await fetch('/api/presence');
        if (res.ok) {
          const users = await res.json();
          chips = users.map(u => `
            <div class="online-chip"><span class="dot"></span>${u.name} <small>(${u.role || ''})</small></div>
          `).join('');
        }
      }
    } catch (_) {}
    if (!chips) {
      const names = new Set([this.user.name]);
      events.slice(0, 20).forEach(e => names.add(e.userName));
      chips = [...names].map(n => `<div class="online-chip"><span class="dot"></span>${n}</div>`).join('');
    }
    onlineEl.innerHTML = chips || '<span class="muted">No users online</span>';

    // Feed
    const feed = document.getElementById('event-feed');
    if (events.length === 0) {
      feed.innerHTML = '<p class="muted">No events yet.</p>';
    } else {
      feed.innerHTML = events.slice(0, 30).map(e => this.eventHtml(e)).join('');
    }
  },

  // ---------- Assign ----------
  async renderAssign() {
    const doors = await DB.getAllDoors();
    const list = document.getElementById('assign-list');
    if (doors.length === 0) {
      list.innerHTML = '<p class="muted">No doors to assign.</p>';
      return;
    }
    let bosses = [];
    try {
      if (navigator.onLine) {
        const res = await fetch('/api/shift-bosses', { headers: this.authHeaders() });
        if (res.ok) bosses = await res.json();
      }
    } catch (_) {}
    if (bosses.length === 0) {
      bosses = [
        { id: 'sb1', name: 'Shift Boss A' },
        { id: 'sb2', name: 'Shift Boss B' },
        { id: 'sb3', name: 'Shift Boss C' }
      ];
    }
    list.innerHTML = doors.map(d => `
      <div class="door-item status-${d.status}">
        <div class="loc">${d.location} <span class="badge ${d.status}">${d.status}</span></div>
        <div class="assign-row">
          <select data-door="${d.id}">
            <option value="">— Unassigned —</option>
            ${bosses.map(b => `<option value="${b.id}" ${d.assignedShiftBossId === b.id ? 'selected' : ''}>${b.name}</option>`).join('')}
          </select>
          <button class="btn" data-assign="${d.id}">Save</button>
        </div>
      </div>
    `).join('');

    list.querySelectorAll('[data-assign]').forEach(btn => {
      btn.onclick = async () => {
        const doorId = btn.dataset.assign;
        const select = list.querySelector(`select[data-door="${doorId}"]`);
        const bossId = select.value || null;
        const door = await DB.getDoor(doorId);
        if (door) {
          door.assignedShiftBossId = bossId;
          door.updatedAt = new Date().toISOString();
          await DB.saveDoor(door);
          await Offline.recordEvent({
            doorId,
            type: 'assigned',
            userId: this.user.id,
            userName: this.user.name
          });
          this.toast('Assignment saved');
          this.renderAssign();
        }
      };
    });
  },

  // ---------- Deep link from QR ----------
  handleDeepLink() {
    const params = new URLSearchParams(window.location.search);
    const doorId = params.get('door');
    if (doorId) {
      // Clean URL
      history.replaceState(null, '', window.location.pathname);
      // If logged in, open the door action after short delay
      if (this.user) {
        setTimeout(() => {
          this.navigate('scan');
          this.showDoorAction(doorId);
        }, 400);
      } else {
        // Store pending door so after login we can open it
        sessionStorage.setItem('pendingDoor', doorId);
      }
    }
  },


  // ---------- Stickers ----------
  async renderStickers() {
    const doors = await DB.getAllDoors();
    doors.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const list = document.getElementById('sticker-select-list');
    if (!list) return;
    if (doors.length === 0) {
      list.innerHTML = '<p class="muted">No doors yet. Create some first.</p>';
      return;
    }
    list.innerHTML = doors.map(d => `
      <div class="door-item status-${d.status}">
        <label class="checkbox-row">
          <input type="checkbox" value="${d.id}" class="sticker-check" ${d.status === 'created' ? 'checked' : ''} />
          <div>
            <div class="loc">${d.location} <span class="badge ${d.status}">${d.status}</span></div>
            <div class="meta">${d.zone || ''} · ${this.fmtTime(d.updatedAt)}</div>
          </div>
        </label>
      </div>
    `).join('');
    list.querySelectorAll('.sticker-check').forEach(cb => {
      cb.addEventListener('change', () => this.renderStickerPreview());
    });
    this.renderStickerPreview();
  },

  async renderStickerPreview() {
    const checked = [...document.querySelectorAll('.sticker-check:checked')].map(c => c.value);
    const sheet = document.getElementById('sticker-sheet');
    if (!sheet) return;
    sheet.innerHTML = '';
    sheet.classList.add('preview');
    if (checked.length === 0) {
      sheet.innerHTML = '<p class="muted no-print">Select doors above to preview stickers.</p>';
      return;
    }
    for (const id of checked) {
      const door = await DB.getDoor(id);
      if (!door) continue;
      const data = window.location.protocol.startsWith('http')
        ? `${window.location.origin}${window.location.pathname}?door=${door.id}`
        : `minedoor://scan/${door.id}`;
      const card = document.createElement('div');
      card.className = 'sticker-card';
      card.innerHTML = `<div class="sticker-loc">${door.location}</div>`;
      const holder = document.createElement('div');
      card.appendChild(holder);
      const idEl = document.createElement('div');
      idEl.className = 'sticker-id';
      idEl.textContent = door.id.slice(0, 8);
      card.appendChild(idEl);
      sheet.appendChild(card);
      new QRCode(holder, {
        text: data,
        width: 130,
        height: 130,
        colorDark: '#0f172a',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.M
      });
    }
  },

  printStickerSheet() {
    const checked = document.querySelectorAll('.sticker-check:checked');
    if (checked.length === 0) {
      this.toast('Select at least one door', 'error');
      return;
    }
    // Ensure preview is rendered then print
    this.renderStickerPreview().then(() => {
      setTimeout(() => window.print(), 300);
    });
  },


  // ---------- Manage Users (Admin) ----------
  async renderUsers() {
    const list = document.getElementById('users-list');
    if (!list) return;
    try {
      const res = await fetch('/api/users', { headers: this.authHeaders() });
      if (!res.ok) throw new Error('Failed to load users');
      const users = await res.json();
      if (users.length === 0) {
        list.innerHTML = '<p class="muted">No users yet.</p>';
        return;
      }
      const roleLabel = r => this.roleLabel(r);
      list.innerHTML = users.map(u => `
        <div class="door-item ${u.active ? '' : 'status-created'}">
          <div class="loc">
            ${u.name}
            <span class="badge ${u.active ? 'closed' : 'inactive'}">${u.active ? 'active' : 'inactive'}</span>
          </div>
          <div class="meta">${u.companyNo} · ${roleLabel(u.role)}</div>
          <div class="user-actions">
            <button class="btn secondary" data-toggle-user="${u.id}" data-active="${u.active}">
              ${u.active ? 'Deactivate' : 'Activate'}
            </button>
            <button class="btn secondary" data-reset-pw="${u.id}">Reset Password</button>
          </div>
        </div>
      `).join('');

      list.querySelectorAll('[data-toggle-user]').forEach(btn => {
        btn.onclick = async () => {
          const id = btn.dataset.toggleUser;
          const currentlyActive = btn.dataset.active === 'true';
          const res = await fetch('/api/users/' + id, {
            method: 'PATCH',
            headers: this.authHeaders(),
            body: JSON.stringify({ active: !currentlyActive })
          });
          const data = await res.json();
          if (!res.ok) { this.toast(data.error || 'Failed', 'error'); return; }
          this.toast(currentlyActive ? 'User deactivated' : 'User activated');
          this.renderUsers();
        };
      });

      list.querySelectorAll('[data-reset-pw]').forEach(btn => {
        btn.onclick = async () => {
          const id = btn.dataset.resetPw;
          const temp = prompt('Enter temporary password for this user (min 4 chars):');
          if (!temp || temp.length < 4) { this.toast('Password too short', 'error'); return; }
          const res = await fetch('/api/users/' + id, {
            method: 'PATCH',
            headers: this.authHeaders(),
            body: JSON.stringify({ resetPassword: temp })
          });
          const data = await res.json();
          if (!res.ok) { this.toast(data.error || 'Failed', 'error'); return; }
          this.toast('Password reset – user must change it on next login');
        };
      });
    } catch (e) {
      list.innerHTML = `<p class="muted">${e.message}</p>`;
    }
  },

  async createUser() {
    const companyNo = (document.getElementById('user-company')?.value || '').trim();
    const name = (document.getElementById('user-name')?.value || '').trim();
    const role = document.getElementById('user-role')?.value;
    const password = (document.getElementById('user-password')?.value || '').trim();
    if (!companyNo || !name || !role || !password) {
      this.toast('All fields required', 'error');
      return;
    }
    if (password.length < 4) {
      this.toast('Password min 4 characters', 'error');
      return;
    }
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify({ companyNo, name, role, password })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      this.toast('User created: ' + data.companyNo);
      document.getElementById('user-company').value = '';
      document.getElementById('user-name').value = '';
      document.getElementById('user-password').value = '';
      this.renderUsers();
    } catch (e) {
      this.toast(e.message, 'error');
    }
  },

  // ---------- Utils ----------
  fmtTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const now = new Date();
    const diff = (now - d) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    return d.toLocaleString();
  },

  toast(msg, type = '') {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = 'toast ' + type;
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 3200);
  }
};

window.App = App;
document.addEventListener('DOMContentLoaded', () => App.init());

// Register service worker for offline + installability
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW registration failed', err));
}