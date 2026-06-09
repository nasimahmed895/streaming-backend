# Live Streaming Server — Process Guide

## 1. Start Server

```bash
pnpm start

# ports stuck? clear first:
pnpm run kill
pnpm start
```

HTTP `:3434` · RTMP input `:1935`

---

## 2. Connect OBS

Settings → Stream:

| Field | Value |
|-------|-------|
| Service | Custom |
| Server | `rtmp://127.0.0.1:1935/live` |
| Stream Key | `mystream` (any alphanumeric name) |

Settings → Output → Streaming:

| Field | Value |
|-------|-------|
| Encoder | x264, CBR |
| Bitrate | 6000 Kbps |
| Keyframe Interval | 2s |
| Preset | veryfast |

Click **Start Streaming** → HLS ready in ~4s.

---

## 3. Domain Whitelist (Access Control)

Edit `.env` — add every domain that is allowed to load streams:

```env
ALLOWED_DOMAINS=yourdomain.com,app.yourdomain.com,localhost
```

- Comma-separated, no `https://`
- Subdomains match automatically (`app.yourdomain.com` also matches `www.app.yourdomain.com`)
- `localhost` — add for local browser testing
- Empty = allow all (not safe for production)

Restart server after any change.

### How it works

Backend reads the `Referer` header on every HLS request automatically.

```
yourdomain.com  → Referer: https://yourdomain.com  →  ✓ serve
evilsite.com    → Referer: https://evilsite.com    →  ✗ 403
direct URL bar  → no Referer header                →  ✗ 403
```

No tokens, no frontend changes needed. Frontend uses plain HLS URL:

```javascript
hls.loadSource('https://your-server/streams/mystream/master.m3u8');
// Browser sends Referer automatically — backend handles the rest
```

### NODE_ENV behaviour

| | `development` | `production` |
|-|--------------|-------------|
| `localhost` referer | always allowed | must be in `ALLOWED_DOMAINS` |
| unlisted domain | blocked | blocked |
| no referer | allowed | blocked |

---

## 4. Multiple Streams

Each OBS instance uses a unique stream key:

| OBS | Stream Key | HLS URL |
|-----|-----------|---------|
| 1 | `stream1` | `/streams/stream1/master.m3u8` |
| 2 | `stream2` | `/streams/stream2/master.m3u8` |
| 3 | `stream3` | `/streams/stream3/master.m3u8` |

---

## 5. HLS URLs

```
master (ABR):  /streams/{key}/master.m3u8
1080p only:    /streams/{key}/1080p/index.m3u8
720p only:     /streams/{key}/720p/index.m3u8
480p only:     /streams/{key}/480p/index.m3u8
```

---

## 6. API

```
GET  /api/streams          all active streams + uptime
GET  /api/stream/:key      status, hlsReady, quality URLs
GET  /api/health           server health + allowedDomains list
POST /api/start/:key       manually start FFmpeg (no OBS)
POST /api/stop/:key        stop stream
GET  /api/domains          list whitelisted domains (admin key required)
```

---

## 7. Environment Variables

```env
PORT=3434
NODE_ENV=production          # development = localhost bypass enabled
RTMP_PORT=1935
ALLOWED_DOMAINS=yourdomain.com,app.yourdomain.com,localhost
ADMIN_KEY=change_this_secret
CLEANUP_AFTER_MINUTES=30
```

---

## 8. Troubleshoot

| Problem | Fix |
|---------|-----|
| `EADDRINUSE :1935 / :3434` | `pnpm run kill` then restart |
| OBS can't connect | Server running? Port 1935 open? |
| `hlsReady: false` | Wait 4–6s after OBS starts |
| 403 on m3u8 | Domain not in `ALLOWED_DOMAINS` |
| Black screen | Click video to unmute |
| FFmpeg not found | `brew install ffmpeg` |

---

## 9. Logs

```bash
tail -f logs/combined.log
tail -f logs/error.log
```
