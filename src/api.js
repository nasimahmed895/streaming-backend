const express = require('express');
const path = require('path');
const fs = require('fs');
const { startStream, stopStream, isStreamActive, getActiveStreams } = require('./ffmpeg');
const { generateToken, revokeToken, listTokens } = require('./auth');
const logger = require('./logger');

const router = express.Router();

// Admin key guard — set ADMIN_KEY in .env to protect token endpoints
function requireAdmin(req, res, next) {
  const adminKey = process.env.ADMIN_KEY;
  if (!adminKey) return next(); // no key set = open (dev mode)
  const provided = req.headers['x-admin-key'] || req.query.adminKey;
  if (provided !== adminKey) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// POST /api/start/:streamKey  — manually trigger FFmpeg (bypass RTMP event)
router.post('/start/:streamKey', (req, res) => {
  const { streamKey } = req.params;

  if (!/^[a-zA-Z0-9_-]+$/.test(streamKey)) {
    return res.status(400).json({ error: 'Invalid stream key. Alphanumeric, _ and - only.' });
  }

  if (isStreamActive(streamKey)) {
    return res.status(409).json({ error: 'Stream already active', streamKey });
  }

  const started = startStream(streamKey);
  if (!started) {
    return res.status(500).json({ error: 'Failed to start FFmpeg process' });
  }

  logger.info(`API: manually started stream ${streamKey}`);
  res.json({
    success: true,
    streamKey,
    hlsUrl: `/streams/${streamKey}/master.m3u8`,
    playerUrl: `/player?stream=${streamKey}`
  });
});

// POST /api/stop/:streamKey
router.post('/stop/:streamKey', (req, res) => {
  const { streamKey } = req.params;
  const stopped = stopStream(streamKey);

  if (!stopped) {
    return res.status(404).json({ error: 'Stream not found or not active' });
  }

  res.json({ success: true, streamKey });
});

// GET /api/stream/:streamKey  — stream status + URLs
router.get('/stream/:streamKey', (req, res) => {
  const { streamKey } = req.params;
  const active = isStreamActive(streamKey);
  const masterPath = path.join(__dirname, '..', 'streams', streamKey, 'master.m3u8');
  const hlsReady = fs.existsSync(masterPath);

  const qualities = [];
  ['1080p', '720p', '480p'].forEach(q => {
    const qPath = path.join(__dirname, '..', 'streams', streamKey, q, 'index.m3u8');
    if (fs.existsSync(qPath)) {
      qualities.push({ label: q, url: `/streams/${streamKey}/${q}/index.m3u8` });
    }
  });

  res.json({
    streamKey,
    active,
    hlsReady,
    hlsUrl: hlsReady ? `/streams/${streamKey}/master.m3u8` : null,
    playerUrl: `/player?stream=${streamKey}`,
    qualities
  });
});

// GET /api/streams  — all active streams
router.get('/streams', (req, res) => {
  res.json(getActiveStreams());
});

// GET /api/health
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    activeStreams: Object.keys(getActiveStreams()).length
  });
});

// ── Token management (admin only) ──────────────────────────────────────────

// POST /api/token/:streamKey  — generate a viewer token
router.post('/token/:streamKey', requireAdmin, (req, res) => {
  const { streamKey } = req.params;
  if (!/^[a-zA-Z0-9_-]+$/.test(streamKey)) {
    return res.status(400).json({ error: 'Invalid stream key' });
  }

  const { token, expiresAt } = generateToken(streamKey);
  const playerUrl = `/player?stream=${streamKey}&token=${token}`;
  const hlsUrl = `/streams/${streamKey}/master.m3u8?token=${token}`;

  logger.info(`Token generated for stream: ${streamKey}`);
  res.json({
    streamKey,
    token,
    expiresAt: new Date(expiresAt).toISOString(),
    playerUrl,
    hlsUrl
  });
});

// DELETE /api/token/:token  — revoke a token
router.delete('/token/:token', requireAdmin, (req, res) => {
  const revoked = revokeToken(req.params.token);
  res.json({ revoked });
});

// GET /api/tokens  — list all active tokens (masked)
router.get('/tokens', requireAdmin, (req, res) => {
  res.json(listTokens());
});

module.exports = router;
