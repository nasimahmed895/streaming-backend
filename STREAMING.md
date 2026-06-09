# Live Streaming Server

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
```

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
