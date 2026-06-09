require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const fs = require('fs');
const { createRTMPServer } = require('./rtmp');
const apiRoutes = require('./api');
const { startCleanupJob } = require('./ffmpeg');
const { streamAuthMiddleware } = require('./auth');
const { getKey } = require('./encryption');
const { createSession, validateSession } = require('./session');
const logger = require('./logger');

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);
const STREAMS_DIR = path.join(__dirname, '..', 'streams');

app.use('/api', cors());
app.use(express.json());

// ── Session creation — frontend calls this first ─────────────────────────────
// POST /session/:streamKey  → returns session token (IP-bound)
app.post('/session/:streamKey', streamAuthMiddleware, (req, res) => {
  const { streamKey } = req.params;
  const ip = req.ip;
  const domain = (req.headers['referer'] || req.headers['origin'] || '');

  const { token, expiresAt } = createSession(streamKey, ip, domain);
  logger.info(`Session issued: stream=${streamKey} ip=${ip}`);

  res.json({
    token,
    expiresAt: new Date(expiresAt).toISOString(),
    hlsUrl: `/stream/${streamKey}/master.m3u8?session=${token}`
  });
});

// ── Dynamic m3u8 serving — injects session check ─────────────────────────────
// All .m3u8 files served here (NOT via static), .ts served statically below
app.get('/stream/:streamKey/master.m3u8', (req, res) => {
  const { streamKey } = req.params;
  const session = req.query.session;
  const ip = req.ip;

  const result = validateSession(session, streamKey, ip, '');
  if (!result.valid) return res.status(403).json({ error: result.reason });

  const filePath = path.join(STREAMS_DIR, streamKey, 'master.m3u8');
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Stream not ready' });

  // Rewrite variant playlist paths to include session token
  let content = fs.readFileSync(filePath, 'utf8');
  content = content.replace(/(1080p|720p|480p)\/index\.m3u8/g,
    `/stream/${streamKey}/$1/index.m3u8?session=${session}`);

  res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
  res.setHeader('Cache-Control', 'no-cache, no-store');
  res.send(content);
});

app.get('/stream/:streamKey/:quality/index.m3u8', (req, res) => {
  const { streamKey, quality } = req.params;
  const session = req.query.session;
  const ip = req.ip;

  const result = validateSession(session, streamKey, ip, '');
  if (!result.valid) return res.status(403).json({ error: result.reason });

  const filePath = path.join(STREAMS_DIR, streamKey, quality, 'index.m3u8');
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Playlist not ready' });

  let content = fs.readFileSync(filePath, 'utf8');

  // Rewrite AES key URI — inject session token
  content = content.replace(
    /URI="([^"]+)"/g,
    `URI="/key/${streamKey}?session=${session}"`
  );

  // Rewrite relative segment filenames → absolute /streams/ path
  // so hls.js fetches from the correct static route
  content = content.replace(
    /^(segment\S+\.ts)$/mg,
    `/streams/${streamKey}/${quality}/$1`
  );

  res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
  res.setHeader('Cache-Control', 'no-cache, no-store');
  res.send(content);
});

// ── AES-128 key endpoint ──────────────────────────────────────────────────────
// hls.js requests the key here. Validates session + IP + domain.
app.get('/key/:streamKey', streamAuthMiddleware, (req, res) => {
  const { streamKey } = req.params;
  const session = req.query.session;
  const ip = req.ip;

  const result = validateSession(session, streamKey, ip, '');
  if (!result.valid) {
    logger.warn(`Key denied [${streamKey}]: ${result.reason} ip=${ip}`);
    return res.status(403).json({ error: result.reason });
  }

  const encKey = getKey(streamKey);
  if (!encKey) return res.status(404).json({ error: 'Encryption key not found' });

  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Cache-Control', 'no-store');
  res.send(encKey.key);
});

// ── Serve .ts segments (AES encrypted — safe to serve publicly) ───────────────
app.use('/streams', express.static(STREAMS_DIR, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.ts')) {
      res.setHeader('Content-Type', 'video/MP2T');
      res.setHeader('Cache-Control', 'public, max-age=3600');
    }
    // Block direct .m3u8 static access — must go through /stream/* routes
    if (filePath.endsWith('.m3u8')) {
      res.setHeader('Cache-Control', 'no-store');
    }
  }
}));

// Serve player HTML
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('/player', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'player.html'));
});

// REST API
app.use('/api', apiRoutes);

app.use((err, req, res, next) => {
  logger.error(`Express error: ${err.message}`);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  logger.info(`HTTP server listening on http://localhost:${PORT}`);
  logger.info(`Player: http://localhost:${PORT}/player`);
});

const nms = createRTMPServer();
nms.run();
logger.info(`RTMP server on rtmp://localhost:1935/live/<streamKey>`);

startCleanupJob();

process.on('SIGTERM', () => { logger.info('SIGTERM — shutting down'); process.exit(0); });
process.on('SIGINT',  () => { logger.info('SIGINT — shutting down');  process.exit(0); });
