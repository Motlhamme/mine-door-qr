# Mine Door QR System – Data Models & API Contracts

## Core Entities

### Door
```ts
interface Door {
  id: string;                    // UUID
  location: string;              // Required, e.g. "Level 3 – 12A Return Airway"
  zone?: string;                 // Optional zone/area
  notes?: string;
  status: "created" | "pasted" | "closed";
  assignedShiftBossId?: string;
  createdBy: string;             // userId
  createdAt: string;             // ISO
  pastedAt?: string;
  pastedBy?: string;
  closedAt?: string;
  closedBy?: string;
  updatedAt: string;
}
```

### User
```ts
interface User {
  id: string;
  name: string;
  role: "admin" | "vent_officer" | "shift_boss" | "vent_engineer" | "mine_captain";
  lastSeen?: string;             // ISO – for online status
}
```

### Event (immutable audit + offline queue item)
```ts
interface Event {
  id: string;                    // Client-generated UUID (for idempotency)
  doorId: string;
  type: "pasted" | "closed" | "assigned" | "created";
  userId: string;
  userName: string;
  timestamp: string;             // ISO – when action happened on device
  synced: boolean;
  deviceId?: string;
  offline: boolean;              // true if recorded while offline
}
```

### Assignment (Mine Captain)
```ts
interface Assignment {
  doorId: string;
  shiftBossId: string;
  assignedBy: string;
  assignedAt: string;
}
```

---

## API Contracts (REST-style, easy to map to Supabase / Firebase / custom backend)

### Auth / Session
- `POST /auth/login` → `{ token, user }`
- Demo mode uses role selector + local user.

### Doors
- `GET  /doors`                    → Door[]
- `GET  /doors/:id`                → Door
- `POST /doors`                    → create Door (Admin)
  Body: `{ location, zone?, notes? }`
- `PATCH /doors/:id`               → update status / assignment

### Events (core offline path)
- `POST /events`                   → batch create (idempotent on event.id)
  Body: `Event[]` or single Event
- `GET  /events?doorId=&since=`    → Event[] (for Vent Engineer feed)

### Presence
- `POST /presence`                 → heartbeat `{ userId, lastSeen }`
- `GET  /presence`                 → online users

### Offline Sync Rules
1. Client always writes Event locally first (IndexedDB).
2. On reconnect / background sync → `POST /events` with all `synced: false`.
3. Server accepts event if `id` not seen before (or uses unique constraint).
4. Server updates Door status based on latest valid event.
5. Client marks events `synced: true` on 2xx response.
6. Conflicts: events are append-only. Door status uses last-write-wins ordered by `timestamp`.

---

## Offline Storage (Client)

- **IndexedDB** stores:
  - `doors` (local cache)
  - `events` (queue + history)
  - `users` / current session
- Service Worker caches app shell + static assets.
- Background Sync API (where supported) or periodic check on visibilitychange / online event.