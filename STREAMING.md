# Live Streaming Server

A production-style multi-stream live streaming backend built with **Node.js**, **FFmpeg**, and **HLS**.

OBS Studio pushes a live video feed via RTMP. The server automatically spawns an FFmpeg process per stream, transcodes to three quality levels (1080p / 720p / 480p), and serves adaptive HLS output to any browser using hls.js — no plugins required.

**Stack:** Node.js · node-media-server · FFmpeg · Express · HLS · hls.js  
**Ports:** HTTP `3434` · RTMP `1935`

```
OBS  ──RTMP──▶  node-media-server  ──▶  FFmpeg  ──▶  HLS segments
                                                           │
                                               Express serves *.m3u8 + *.ts
                                                           │
                                                     Browser (hls.js)
```

**Key features:**
- Multiple simultaneous streams (one FFmpeg process per stream key)
- Adaptive bitrate — hls.js auto-selects quality based on bandwidth
- Token-based access control — viewers need a signed URL to watch
- Auto-cleanup of stale stream directories
- REST API for stream management
- Winston logging to file + console

---

## Start Server
```bash
npm start
# HTTP → http://localhost:3434
# RTMP → rtmp://localhost:1935
```

---

## OBS Setup
| Field | Value |
|-------|-------|
| Service | Custom |
| Server | `rtmp://127.0.0.1:1935/live` |
| Stream Key | `mystream` (any name) |
| Encoder | x264, CBR |
| Bitrate | 6000 Kbps |
| Keyframe Interval | 2s |
| Preset | veryfast |

---

## Watch Stream
```
http://localhost:3434/player?stream=mystream
```
Or open `http://localhost:3434/player` → type stream key → Watch.

---

## Multiple Streams
Each OBS instance needs a **unique stream key**:

| OBS | Stream Key | Player URL |
|-----|-----------|------------|
| 1 | `stream1` | `/player?stream=stream1` |
| 2 | `stream2` | `/player?stream=stream2` |
| 3 | `stream3` | `/player?stream=stream3` |

All streams appear in sidebar automatically.

---

## API
```bash
# All active streams
GET /api/streams

# One stream status + HLS URL
GET /api/stream/:key

# Manual start/stop (without OBS)
POST /api/start/:key
POST /api/stop/:key

# Generate viewer token (returns signed player URL)
POST /api/token/:key

# List active tokens
GET /api/tokens

# Revoke a token
DELETE /api/token/:token
```

## Secure Viewer Links

Every `/streams/*` request requires `?token=`. Generate one:

```bash
curl -X POST http://localhost:3434/api/token/mystream
```

Send the returned `playerUrl` to the viewer. Tokens expire after 4 hours (set `TOKEN_TTL_HOURS` in `.env`).

To lock token generation itself, set `ADMIN_KEY=secret` in `.env` and pass header `x-admin-key: secret`.

---

## HLS URLs
```
master (ABR):  /streams/{key}/master.m3u8
1080p only:    /streams/{key}/1080p/index.m3u8
720p only:     /streams/{key}/720p/index.m3u8
480p only:     /streams/{key}/480p/index.m3u8
```

---

## Troubleshoot
| Problem | Fix |
|---------|-----|
| OBS can't connect | Check port 1935 open, server running |
| `hlsReady: false` | Wait 4–6s after OBS starts |
| Black player | Unmute video (browser autoplay policy) |
| Port in use | `lsof -ti :1935 :3434 \| xargs kill` |

---

## Logs
```bash
tail -f /tmp/streaming-server.log
tail -f logs/combined.log
```
