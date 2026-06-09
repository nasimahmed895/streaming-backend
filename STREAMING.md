# Live Streaming Server

Node.js + FFmpeg + HLS live streaming with AES-128 encryption and IP-locked sessions.

---

## Start

```bash
pnpm start

# ports stuck:
pnpm run kill && pnpm start
```

---

## OBS Setup

Settings → Stream:

| Field      | Value                        |
|------------|------------------------------|
| Service    | Custom                       |
| Server     | `rtmp://127.0.0.1:1935/live` |
| Stream Key | `mystream` (any name)        |

Settings → Output → Streaming:

| Field             | Value         |
|-------------------|---------------|
| Encoder           | x264, CBR     |
| Bitrate           | 6000 Kbps     |
| Keyframe Interval | 2s            |
| Preset            | veryfast      |

---

## Security (3 layers)

```
Layer 1 — Domain whitelist    Referer header checked on every request
Layer 2 — IP-bound session    Token locked to viewer's IP, expires in 4h
Layer 3 — AES-128 encryption  Every .ts segment encrypted, useless without key
```

**Attack results:**
| Attempt | Result |
|---------|--------|
| Copy URL, open in VLC | 403 — no session |
| Steal session, use from different IP | 403 — IP mismatch |
| Embed on unauthorized domain | 403 — domain not whitelisted |
| Download .ts files directly | Encrypted binary — unplayable |
| Get .ts + key URL | Key requires valid session + correct IP |

---

## How playback works

```
1. Browser (yourdomain.com) → POST /session/mystream
2. Server checks domain (whitelist) + issues IP-locked token
3. Browser loads /stream/mystream/master.m3u8?session=TOKEN
4. Server validates session → serves m3u8 with session in all URLs
5. hls.js requests AES key → /key/mystream?session=TOKEN
6. Server validates session + IP + domain → serves key
7. hls.js decrypts .ts segments → video plays
```

---

## Environment Variables (.env)

```env
# Server
PORT=3434
NODE_ENV=development         # production = strict, development = localhost bypass

# RTMP
RTMP_PORT=1935

# Domain whitelist — comma-separated, no https://
# Empty = allow all (dev only)
ALLOWED_DOMAINS=yourdomain.com,app.yourdomain.com,localhost

# Public URL of this server (used inside encrypted m3u8 key URI)
SERVER_URL=http://localhost:3434

# Session lifetime
SESSION_TTL_HOURS=4

# Admin key for management API (empty = open)
ADMIN_KEY=change_this_secret

# Cleanup stale stream dirs
CLEANUP_AFTER_MINUTES=30
```

**Production `.env` (minimal):**
```env
PORT=3434
NODE_ENV=production
RTMP_PORT=1935
ALLOWED_DOMAINS=yourdomain.com
SERVER_URL=https://your-stream-server.com
SESSION_TTL_HOURS=4
ADMIN_KEY=strong_random_secret
CLEANUP_AFTER_MINUTES=30
```

---

## API

```
POST /session/:streamKey       get IP-locked session token (frontend calls first)

GET  /stream/:key/master.m3u8?session=TOKEN    master playlist
GET  /stream/:key/:quality/index.m3u8?session=TOKEN   quality playlist
GET  /key/:streamKey?session=TOKEN             AES-128 decryption key

GET  /api/streams              all active streams + uptime
GET  /api/stream/:key          status + quality URLs
POST /api/start/:key           manually start FFmpeg (no OBS)
POST /api/stop/:key            stop stream
GET  /api/health               health + allowed domains
```

---

## Frontend (your website)

```javascript
// 1. Get session — server validates domain, issues IP-locked token
const { hlsUrl } = await fetch(`https://stream-server.com/session/mystream`, {
  method: 'POST'
}).then(r => r.json());

// 2. Play — hls.js handles everything automatically
const hls = new Hls();
hls.loadSource(`https://stream-server.com${hlsUrl}`);
hls.attachMedia(videoElement);
```

---

## Multiple Streams

Each OBS instance uses a unique stream key. Each gets its own AES key + session scope.

```
OBS 1 → stream key: stream1 → POST /session/stream1
OBS 2 → stream key: stream2 → POST /session/stream2
```

---

## HLS Quality URLs (via session only)

```
/stream/{key}/master.m3u8?session=TOKEN       ABR master
/stream/{key}/1080p/index.m3u8?session=TOKEN  1080p
/stream/{key}/720p/index.m3u8?session=TOKEN   720p
/stream/{key}/480p/index.m3u8?session=TOKEN   480p
```

---

## Troubleshoot

| Problem | Fix |
|---------|-----|
| `EADDRINUSE` on start | `pnpm run kill` then restart |
| OBS can't connect | Port 1935 open? Server running? |
| 403 on session | Domain not in `ALLOWED_DOMAINS` |
| 403 on key | IP changed since session issued |
| `hlsReady: false` | Wait 4–6s after OBS starts |
| Black screen | Click video to unmute |
| FFmpeg not found | `brew install ffmpeg` |

---

## Logs

```bash
tail -f logs/combined.log
tail -f logs/error.log
```
