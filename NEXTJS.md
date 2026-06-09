# Next.js Integration — Production

## How it works

```
Browser → Next.js API route (generates token, keeps ADMIN_KEY secret)
                    ↓
         token returned to client
                    ↓
         hls.js fetches m3u8 from streaming server
         Referer: https://yourdomain.com  ✓ allowed
```

---

## 1. Environment Variables

**Next.js `.env.local`:**
```env
# Secret — server side only, never expose to browser
STREAM_SERVER_URL=https://your-stream-server.com
STREAM_ADMIN_KEY=change_this_secret

# Public — safe to expose
NEXT_PUBLIC_STREAM_SERVER_URL=https://your-stream-server.com
```

---

## 2. Next.js API Route — Token Generator

`app/api/stream-token/route.js`
```js
import { NextResponse } from 'next/server';

export async function POST(request) {
  const { streamKey } = await request.json();

  if (!streamKey || !/^[a-zA-Z0-9_-]+$/.test(streamKey)) {
    return NextResponse.json({ error: 'Invalid stream key' }, { status: 400 });
  }

  const res = await fetch(
    `${process.env.STREAM_SERVER_URL}/api/token/${streamKey}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-key': process.env.STREAM_ADMIN_KEY,
      },
      body: JSON.stringify({
        domain: 'yourdomain.com',
        ttlHours: 4,
      }),
    }
  );

  if (!res.ok) {
    return NextResponse.json({ error: 'Failed to generate token' }, { status: 500 });
  }

  const data = await res.json();
  return NextResponse.json({
    token: data.token,
    hlsUrl: `${process.env.NEXT_PUBLIC_STREAM_SERVER_URL}${data.hlsUrl}`,
    expiresAt: data.expiresAt,
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

export default function StreamPlayer({ streamKey }) {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const [status, setStatus] = useState('idle'); // idle | loading | live | error

  useEffect(() => {
    if (!streamKey) return;
    let cancelled = false;

    async function init() {
      setStatus('loading');

      // Fetch token from your Next.js API (ADMIN_KEY never leaves server)
      const res = await fetch('/api/stream-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ streamKey }),
      });

      if (!res.ok || cancelled) return setStatus('error');
      const { hlsUrl } = await res.json();

      const video = videoRef.current;
      if (!video || cancelled) return;

      if (Hls.isSupported()) {
        const hls = new Hls({
          liveDurationInfinity: true,
          liveBackBufferLength: 30,
        });

        hls.loadSource(hlsUrl);
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
        video.src = hlsUrl;
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
      {status === 'loading' && (
        <div style={overlayStyle}>Connecting...</div>
      )}
      {status === 'error' && (
        <div style={overlayStyle}>Stream unavailable</div>
      )}
      {status === 'live' && (
        <span style={badgeStyle}>● LIVE</span>
      )}
    </div>
  );
}

const overlayStyle = {
  position: 'absolute', inset: 0,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'rgba(0,0,0,0.7)', color: '#fff', fontSize: 14,
};

const badgeStyle = {
  position: 'absolute', top: 10, left: 10,
  background: '#e53935', color: '#fff',
  padding: '3px 10px', borderRadius: 12, fontSize: 12, fontWeight: 600,
};
```

---

## 4. Use in a Page

`app/watch/page.jsx`
```jsx
import StreamPlayer from '@/components/StreamPlayer';

export default function WatchPage() {
  return (
    <main style={{ maxWidth: 900, margin: '0 auto', padding: 24 }}>
      <h1>Live Stream</h1>
      <StreamPlayer streamKey="mystream" />
    </main>
  );
}
```

---

## 5. Install hls.js

```bash
npm install hls.js
```

---

## 6. Production Checklist

| Item | Detail |
|------|--------|
| `NODE_ENV=production` | Disables localhost bypass on stream server |
| `ADMIN_KEY` set | Locks token generation API |
| Stream server domain | Set `domain: 'yourdomain.com'` in token request |
| HTTPS on both servers | Required — `http://` Referer stripped by browsers on HTTPS pages |
| Firewall | TCP `1935` open for OBS · TCP `443` for HLS |

---

## 7. Token Flow Summary

```
1. Viewer opens /watch page
2. Browser → POST /api/stream-token  (Next.js server)
3. Next.js server → POST /api/token/mystream  (stream server, with ADMIN_KEY)
4. Stream server returns token bound to yourdomain.com
5. Next.js returns token to browser
6. hls.js fetches:
     GET /streams/mystream/master.m3u8?token=abc123
     Referer: https://yourdomain.com/watch   ← browser sends automatically
7. Stream server validates token + Referer domain → serves m3u8
8. Any other site copying the URL → Referer mismatch → 403
```
