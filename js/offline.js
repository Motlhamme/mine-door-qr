/**
 * Offline queue + sync engine
 * Writes locally first (IndexedDB). When online, POSTs to /api/events.
 */

const Offline = {
  isOnline: navigator.onLine,
  syncInProgress: false,
  apiBase: '', // same origin

  init() {
    window.addEventListener('online', () => {
      this.isOnline = true;
      this.updateIndicator();
      this.sync();
      this.pullFromServer();
    });
    window.addEventListener('offline', () => {
      this.isOnline = false;
      this.updateIndicator();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        this.isOnline = navigator.onLine;
        this.updateIndicator();
        if (this.isOnline) {
          this.sync();
          this.pullFromServer();
        }
      }
    });
    this.updateIndicator();
    setInterval(() => {
      if (navigator.onLine) {
        this.sync();
        this.sendPresence();
      }
    }, 30000);
    if (navigator.onLine) {
      setTimeout(() => this.pullFromServer(), 800);
    }
  },

  updateIndicator() {
    const el = document.getElementById('online-indicator');
    if (!el) return;
    el.className = 'status-dot ' + (this.isOnline ? 'online' : 'offline');
    el.title = this.isOnline ? 'Online' : 'Offline – changes will sync later';
  },

  async recordEvent({ doorId, type, userId, userName, assignedShiftBossId }) {
    const event = {
      id: uuid(),
      doorId,
      type,
      userId,
      userName,
      timestamp: new Date().toISOString(),
      synced: false,
      offline: !this.isOnline,
      deviceId: localStorage.getItem('deviceId') || (localStorage.setItem('deviceId', uuid()), localStorage.getItem('deviceId')),
      assignedShiftBossId: assignedShiftBossId || undefined
    };

    await DB.saveEvent(event);

    const door = await DB.getDoor(doorId);
    if (door) {
      const now = event.timestamp;
      if (type === 'pasted') {
        door.status = 'pasted';
        door.pastedAt = now;
        door.pastedBy = userId;
      } else if (type === 'closed') {
        door.status = 'closed';
        door.closedAt = now;
        door.closedBy = userId;
      } else if (type === 'assigned' && assignedShiftBossId) {
        door.assignedShiftBossId = assignedShiftBossId;
      }
      door.updatedAt = now;
      await DB.saveDoor(door);
    }

    if (this.isOnline) await this.sync();
    return event;
  },

  async sync() {
    if (this.syncInProgress || !navigator.onLine) return;
    this.syncInProgress = true;
    try {
      const unsynced = await DB.getUnsyncedEvents();
      if (unsynced.length === 0) {
        this.syncInProgress = false;
        return;
      }
      unsynced.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

      const res = await fetch(this.apiBase + '/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(unsynced)
      });
      if (!res.ok) throw new Error('Server ' + res.status);

      for (const ev of unsynced) {
        await DB.markEventSynced(ev.id);
      }
      console.log('[Offline] Synced ' + unsynced.length + ' event(s)');
      if (window.App && window.App.refreshCurrentView) {
        window.App.refreshCurrentView();
      }
    } catch (err) {
      console.warn('[Offline] Sync failed, will retry later', err);
    } finally {
      this.syncInProgress = false;
    }
  },

  async pullFromServer() {
    if (!navigator.onLine) return;
    try {
      const [doorsRes, eventsRes] = await Promise.all([
        fetch(this.apiBase + '/api/doors'),
        fetch(this.apiBase + '/api/events')
      ]);
      if (!doorsRes.ok || !eventsRes.ok) return;
      const doors = await doorsRes.json();
      const events = await eventsRes.json();

      for (const d of doors) await DB.saveDoor(d);
      for (const e of events) {
        e.synced = true;
        await DB.saveEvent(e);
      }
      if (window.App && window.App.refreshCurrentView) {
        window.App.refreshCurrentView();
      }
    } catch (err) {
      console.warn('[Offline] Pull failed', err);
    }
  },

  async sendPresence() {
    if (!window.App || !window.App.user || !navigator.onLine) return;
    try {
      await fetch(this.apiBase + '/api/presence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: App.user.id,
          name: App.user.name,
          role: App.user.role
        })
      });
    } catch (_) {}
  }
};

window.Offline = Offline;
