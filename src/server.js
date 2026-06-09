require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const { createRTMPServer } = require('./rtmp');
const apiRoutes = require('./api');
const { startCleanupJob } = require('./ffmpeg');
const { streamAuthMiddleware } = require('./auth');
const logger = require('./logger');

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

// CORS open for API — /streams CORS is handled per-token in streamAuthMiddleware
app.use('/api', cors());
app.use(express.json());

// Domain-lock: every /streams/* request must carry a valid token + correct Referer
app.use('/streams', streamAuthMiddleware);

// Serve HLS segments with correct MIME types + no-cache on playlists
app.use('/streams', express.static(path.join(__dirname, '..', 'streams'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.m3u8')) {
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
    } else if (filePath.endsWith('.ts')) {
      res.setHeader('Content-Type', 'video/MP2T');
      res.setHeader('Cache-Control', 'public, max-age=3600');
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

// Global error handler
app.use((err, req, res, next) => {
  logger.error(`Express error: ${err.message}`);
  res.status(500).json({ error: 'Internal server error' });
});

// Start HTTP server
app.listen(PORT, () => {
  logger.info(`HTTP server listening on http://localhost:${PORT}`);
  logger.info(`Player available at http://localhost:${PORT}/player`);
  logger.info(`API docs: GET /api/streams, GET /api/stream/:key`);
});

// Start RTMP server (port 1935)
const nms = createRTMPServer();
nms.run();
logger.info(`RTMP server listening on rtmp://localhost:1935/live/<streamKey>`);

// Start stale-stream cleanup
startCleanupJob();
logger.info('Cleanup job started (every 5 min)');

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received — shutting down');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received — shutting down');
  process.exit(0);
});
