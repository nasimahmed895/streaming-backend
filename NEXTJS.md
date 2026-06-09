# Next.js Integration — Production

## How it works

```
Browser (yourdomain.com)
  → POST /api/stream-session   (Next.js API route)
  → Next.js server → POST https://stream-server.com/session/mystream
  → stream server validates domain + issues IP-locked session token
  → token returned to browser
  → hls.js loads /stream/mystream/master.m3u8?session=TOKEN
  → stream server validates session + IP on every request
  → AES-128 decrypted segments play
```

---

## 1. Environment Variables

**Next.js `.env.local`:**
```env
# Server-side only — never exposed to browser
STREAM_SERVER_URL=https://your-stream-server.com
STREAM_ADMIN_KEY=your_admin_key

# Public — safe for browser
NEXT_PUBLIC_STREAM_SERVER_URL=https://your-stream-server.com
```

---

## 2. Next.js API Route — Session Proxy

`app/api/stream-session/route.js`

```js
import { NextResponse } from 'next/server';

export async function POST(request) {
  const { streamKey } = await request.json();

  if (!streamKey || !/^[a-zA-Z0-9_-]+$/.test(streamKey)) {
    return NextResponse.json({ error: 'Invalid stream key' }, { status: 400 });
  }

  // Forward real client IP to stream server so session is locked to viewer's IP
  const clientIp =
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    request.headers.get('x-real-ip') ||
    '127.0.0.1';

  const res = await fetch(
    `${process.env.STREAM_SERVER_URL}/session/${streamKey}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Referer': 'https://yourdomain.com',   // your actual domain
        'X-Forwarded-For': clientIp
      }
    }
  );

  if (!res.ok) {
    return NextResponse.json({ error: 'Failed to create session' }, { status: 502 });
  }

  const data = await res.json();
  return NextResponse.json({
    token: data.token,
    hlsUrl: data.hlsUrl,
    expiresAt: data.expiresAt
  });
}
```

---

## 3. Player Component

`components/StreamPlayer.jsx`

```jsx
'use client';

import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';

const STREAM_SERVER = process.env.NEXT_PUBLIC_STREAM_SERVER_URL;

export default function StreamPlayer({ streamKey }) {
  const videoRef = useRef(null);
  const hlsRef  = useRef(null);
  const [status, setStatus] = useState('idle'); // idle | loading | live | error

  useEffect(() => {
    if (!streamKey) return;
    let cancelled = false;

    async function init() {
      setStatus('loading');

      // Get IP-locked session from Next.js API (keeps stream server internal)
      const res = await fetch('/api/stream-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ streamKey })
      });

      if (!res.ok || cancelled) return setStatus('error');
      const { hlsUrl } = await res.json();

      const video = videoRef.current;
      if (!video || cancelled) return;

      const src = `${STREAM_SERVER}${hlsUrl}`;

      if (Hls.isSupported()) {
        const hls = new Hls({
          liveDurationInfinity: true,
          liveBackBufferLength: 30,
          maxBufferLength: 20
        });

        hls.loadSource(src);
        hls.attachMedia(video);

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          setStatus('live');
          video.play().catch(() => {});
        });

        hls.on(Hls.Events.ERROR, (_, data) => {
          if (data.fatal) setStatus('error');
        });

        hlsRef.current = hls;

      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        // Safari native HLS
        video.src = src;
        video.addEventListener('loadedmetadata', () => {
          setStatus('live');
          video.play();
        }, { once: true });
      }
    }

    init();

    return () => {
      cancelled = true;
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
  }, [streamKey]);

  return (
    <div style={{ position: 'relative', background: '#000', borderRadius: 8, overflow: 'hidden' }}>
      <video
        ref={videoRef}
        controls
        playsInline
        muted
        style={{ width: '100%', display: 'block', aspectRatio: '16/9' }}
      />
      {status === 'loading' && <Overlay text="Connecting..." />}
      {status === 'error'   && <Overlay text="Stream unavailable" />}
      {status === 'live'    && <LiveBadge />}
    </div>
  );
}

function Overlay({ text }) {
  return (
    <div style={{
      position: 'absolute', inset: 0, display: 'flex',
      alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.7)', color: '#fff', fontSize: 14
    }}>
      {text}
    </div>
  );
}

function LiveBadge() {
  return (
    <span style={{
      position: 'absolute', top: 10, left: 10,
      background: '#e53935', color: '#fff',
      padding: '3px 10px', borderRadius: 12, fontSize: 12, fontWeight: 600
    }}>
      LIVE
    </span>
  );
}
```

---

## 4. Use in a Page

`app/watch/[streamKey]/page.jsx`

```jsx
import StreamPlayer from '@/components/StreamPlayer';

export default function WatchPage({ params }) {
  return (
    <main style={{ maxWidth: 960, margin: '0 auto', padding: 24 }}>
      <StreamPlayer streamKey={params.streamKey} />
    </main>
  );
}
```

Visit: `https://yourdomain.com/watch/mystream`

---

## 5. Install hls.js

```bash
npm install hls.js
# or
pnpm add hls.js
```

---

## 6. Stream Server `.env` for Production

```env
NODE_ENV=production
PORT=3434
RTMP_PORT=1935
SERVER_URL=https://your-stream-server.com
ALLOWED_DOMAINS=yourdomain.com
SESSION_TTL_HOURS=4
ADMIN_KEY=strong_random_secret
CLEANUP_AFTER_MINUTES=30
```

---

## 7. Production Checklist

| Item | Detail |
|------|--------|
| `NODE_ENV=production` | Disables localhost bypass on stream server |
| `ALLOWED_DOMAINS` set | Only your domain can request sessions |
| `SERVER_URL` set | Key URI in m3u8 points to correct server |
| HTTPS on both servers | Required — HTTP Referer stripped on HTTPS pages |
| `ADMIN_KEY` set | Locks management API |
| Firewall | TCP `1935` for OBS · TCP `443` for HTTPS |

---

## 8. Security Summary

| Attack | Result |
|--------|--------|
| Copy HLS URL, open in VLC | 403 — no session |
| Steal session, different IP | 403 — IP mismatch |
| Embed on unauthorized domain | 403 — domain not whitelisted |
| Download .ts files | AES-128 encrypted — unplayable |
| Get .ts + key URL | Key needs valid session + correct IP |
