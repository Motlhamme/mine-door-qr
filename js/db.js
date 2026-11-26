/**
 * IndexedDB wrapper for offline-first storage
 */
const DB_NAME = 'MineDoorQR';
const DB_VERSION = 1;

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('doors')) {
        const doors = db.createObjectStore('doors', { keyPath: 'id' });
        doors.createIndex('status', 'status', { unique: false });
        doors.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
      if (!db.objectStoreNames.contains('events')) {
        const events = db.createObjectStore('events', { keyPath: 'id' });
        events.createIndex('doorId', 'doorId', { unique: false });
        events.createIndex('synced', 'synced', { unique: false });
        events.createIndex('timestamp', 'timestamp', { unique: false });
      }
      if (!db.objectStoreNames.contains('session')) {
        db.createObjectStore('session', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('users')) {
        db.createObjectStore('users', { keyPath: 'id' });
      }
    };
  });
  return dbPromise;
}

async function idbGet(store, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGetAll(store, indexName, query) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const os = tx.objectStore(store);
    let req;
    if (indexName) {
      const idx = os.index(indexName);
      req = query !== undefined ? idx.getAll(query) : idx.getAll();
    } else {
      req = os.getAll();
    }
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(store, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).put(value);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbDelete(store, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function idbClear(store) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// Convenience helpers
const DB = {
  async getDoor(id) { return idbGet('doors', id); },
  async getAllDoors() { return idbGetAll('doors'); },
  async saveDoor(door) { return idbPut('doors', door); },
  async getEvents(doorId) {
    if (doorId) return idbGetAll('events', 'doorId', doorId);
    return idbGetAll('events');
  },
  async getUnsyncedEvents() {
    const all = await idbGetAll('events');
    return all.filter(e => !e.synced);
  },
  async saveEvent(event) { return idbPut('events', event); },
  async markEventSynced(id) {
    const ev = await idbGet('events', id);
    if (ev) {
      ev.synced = true;
      await idbPut('events', ev);
    }
  },
  async getSession() { return idbGet('session', 'current'); },
  async setSession(data) { return idbPut('session', { key: 'current', ...data }); },
  async clearSession() { return idbDelete('session', 'current'); }
};

// Simple UUID v4
function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

window.DB = DB;
window.uuid = uuid;