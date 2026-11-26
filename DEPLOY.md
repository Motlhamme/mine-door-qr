# Deploy Mine Door QR (free public URL)

## Option 1 – Render.com (recommended, free)

1. Create a free account at https://render.com
2. Push this project to a GitHub repository
3. In Render Dashboard → **New** → **Web Service**
4. Connect the GitHub repo
5. Settings:
   - **Runtime**: Node
   - **Build Command**: leave empty (no build needed)
   - **Start Command**: `node server.js`
   - **Instance type**: Free
6. Click **Create Web Service**
7. Wait 1–2 minutes → you get a URL like:
   `https://mine-door-qr-xxxx.onrender.com`
8. Open that URL on your phone

Note: Free tier spins down after ~15 min idle. First load after sleep can take 30–60 seconds.

## Option 2 – Temporary public URL from your PC (fastest test)

On your computer:

```bash
cd mine-door-qr
node server.js
```

In another terminal, install and run a tunnel:

```bash
# Cloudflare tunnel (no account needed for quick try)
npx cloudflared tunnel --url http://localhost:3000
```

It prints a public `https://....trycloudflare.com` link. Open that on your phone.

## Option 3 – Railway.app

1. https://railway.app → New Project → Deploy from GitHub
2. Start command: `node server.js`
3. Generate public domain in Settings
