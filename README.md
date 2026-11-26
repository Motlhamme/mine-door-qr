# Mine Door QR – Offline-First PWA + Backend

Works on **iOS and Android** handhelds. Fully offline-capable underground, syncs when back in coverage.

## Quick start

```bash
cd mine-door-qr
node server.js
# → http://0.0.0.0:3000
```

Open on phone (same network): `http://<server-ip>:3000`  
Then **Add to Home Screen** for full-screen PWA.

## Features

| Feature | Details |
|---------|---------|
| **Admin** | Create door with location → QR + printable sticker sheets |
| **Vent Officer** | Scan → “QR pasted” (offline-first) |
| **Shift Boss** | Scan → “Door closed” (offline-first) |
| **Vent Engineer** | Live dashboard, event feed, online users |
| **Mine Captain** | Assign shift bosses to doors |
| **Offline** | IndexedDB queue + automatic sync to `/api/events` |
| **Scanner** | Camera + flashlight/torch toggle + vibration feedback |
| **Stickers** | Multi-QR A4 printable sheet |

## API (same origin)

- `GET/POST /api/doors`
- `GET/PATCH /api/doors/:id`
- `GET/POST /api/events`  ← offline sync target
- `GET/POST /api/presence`
- `GET /api/stickers`
- `GET /api/health`

Data is stored in `data/store.json` (atomic writes). Easy to replace with SQLite/Postgres/Supabase later.

## Test flow

1. Admin → Create QR (enter location) → Download or go to **Sticker Sheet** and print
2. Vent Officer → Scan → Confirm Pasted
3. Shift Boss → Scan same QR → Confirm Closed
4. Vent Engineer → Dashboard
5. Airplane mode → scan still works → reconnect → events sync

## Production notes

- Serve over HTTPS (required for camera + service worker on most phones)
- Point `Offline.apiBase` at your real API if frontend is hosted separately
- Replace the JSON store in `server.js` with a real database when ready
