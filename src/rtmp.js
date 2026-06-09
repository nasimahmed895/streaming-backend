const NodeMediaServer = require('node-media-server');
const { startStream, stopStream } = require('./ffmpeg');
const logger = require('./logger');

const config = {
  rtmp: {
    port: parseInt(process.env.RTMP_PORT || '1935', 10),
    chunk_size: 60000,
    gop_cache: true,
    ping: 30,
    ping_timeout: 60
  },
  // NMS built-in HTTP is disabled — Express handles serving
  logType: 3
};

// Optional: validate stream keys against a secret
function isValidStreamKey(streamKey) {
  const secret = process.env.STREAM_SECRET;
  if (!secret) return true; // allow all if no secret set
  // Simple prefix-based auth: streamKey must start with secret_
  return streamKey.startsWith(`${secret}_`);
}

function createRTMPServer() {
  const nms = new NodeMediaServer(config);

  nms.on('prePublish', (id, StreamPath, args) => {
    const streamKey = StreamPath.split('/').pop();
    logger.info(`RTMP prePublish: key=${streamKey} session=${id}`);

    if (!isValidStreamKey(streamKey)) {
      logger.warn(`Rejected invalid stream key: ${streamKey}`);
      const session = nms.getSession(id);
      if (session) session.reject();
    }
  });

  nms.on('postPublish', (id, StreamPath, args) => {
    const streamKey = StreamPath.split('/').pop();
    logger.info(`RTMP stream live: ${streamKey}`);

    // 1s delay lets RTMP buffer stabilize before FFmpeg connects
    setTimeout(() => startStream(streamKey), 1000);
  });

  nms.on('donePublish', (id, StreamPath, args) => {
    const streamKey = StreamPath.split('/').pop();
    logger.info(`RTMP stream ended: ${streamKey}`);
    stopStream(streamKey);
  });

  nms.on('preConnect', (id, args) => {
    logger.debug(`RTMP client connecting: ${id}`);
  });

  nms.on('doneConnect', (id, args) => {
    logger.debug(`RTMP client disconnected: ${id}`);
  });

  return nms;
}

module.exports = { createRTMPServer };
