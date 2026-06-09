const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const STREAMS_DIR = path.join(__dirname, '..', 'streams');
const CLEANUP_MINUTES = parseInt(process.env.CLEANUP_AFTER_MINUTES || '30', 10);

// streamKey → { process, startTime, outputDir, reconnectTimer }
const activeStreams = new Map();

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function buildFFmpegArgs(inputUrl, outputDir) {
  return [
    '-i', inputUrl,

    // Input settings for live stream
    '-fflags', 'nobuffer',
    '-flags', 'low_delay',
    '-analyzeduration', '1000000',
    '-probesize', '1000000',

    // Map video+audio for 3 output variants
    '-map', '0:v:0', '-map', '0:a:0',
    '-map', '0:v:0', '-map', '0:a:0',
    '-map', '0:v:0', '-map', '0:a:0',

    // --- 1080p ---
    '-c:v:0', 'libx264',
    '-b:v:0', '5000k', '-maxrate:v:0', '5350k', '-bufsize:v:0', '7500k',
    '-vf:v:0', 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2',
    '-preset:v:0', 'veryfast', '-tune:v:0', 'zerolatency',
    '-g:v:0', '48', '-keyint_min:v:0', '48', '-sc_threshold:v:0', '0',
    '-c:a:0', 'aac', '-b:a:0', '192k', '-ar:a:0', '48000', '-ac:a:0', '2',

    // --- 720p ---
    '-c:v:1', 'libx264',
    '-b:v:1', '2800k', '-maxrate:v:1', '2996k', '-bufsize:v:1', '4200k',
    '-vf:v:1', 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2',
    '-preset:v:1', 'veryfast', '-tune:v:1', 'zerolatency',
    '-g:v:1', '48', '-keyint_min:v:1', '48', '-sc_threshold:v:1', '0',
    '-c:a:1', 'aac', '-b:a:1', '128k', '-ar:a:1', '48000', '-ac:a:1', '2',

    // --- 480p ---
    '-c:v:2', 'libx264',
    '-b:v:2', '1400k', '-maxrate:v:2', '1498k', '-bufsize:v:2', '2100k',
    '-vf:v:2', 'scale=854:480:force_original_aspect_ratio=decrease,pad=854:480:(ow-iw)/2:(oh-ih)/2',
    '-preset:v:2', 'veryfast', '-tune:v:2', 'zerolatency',
    '-g:v:2', '48', '-keyint_min:v:2', '48', '-sc_threshold:v:2', '0',
    '-c:a:2', 'aac', '-b:a:2', '96k', '-ar:a:2', '48000', '-ac:a:2', '2',

    // HLS output
    '-var_stream_map', 'v:0,a:0,name:1080p v:1,a:1,name:720p v:2,a:2,name:480p',
    '-master_pl_name', 'master.m3u8',
    '-f', 'hls',
    '-hls_time', '4',
    '-hls_list_size', '10',
    '-hls_flags', 'delete_segments+append_list+independent_segments',
    '-hls_segment_type', 'mpegts',
    '-hls_segment_filename', `${outputDir}/%v/segment%05d.ts`,
    `${outputDir}/%v/index.m3u8`
  ];
}

function startStream(streamKey) {
  if (activeStreams.has(streamKey)) {
    logger.warn(`Stream already active: ${streamKey}`);
    return false;
  }

  const outputDir = path.join(STREAMS_DIR, streamKey);
  ensureDir(outputDir);
  ['1080p', '720p', '480p'].forEach(q => ensureDir(path.join(outputDir, q)));

  const rtmpUrl = `rtmp://127.0.0.1:1935/live/${streamKey}`;
  const args = buildFFmpegArgs(rtmpUrl, outputDir);

  logger.info(`FFmpeg starting for stream: ${streamKey}`);

  const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });

  proc.stdout.on('data', d => logger.debug(`[${streamKey}] stdout: ${d.toString().trim()}`));
  proc.stderr.on('data', d => logger.debug(`[${streamKey}] ${d.toString().trim()}`));

  proc.on('error', err => {
    logger.error(`FFmpeg spawn error [${streamKey}]: ${err.message}`);
    activeStreams.delete(streamKey);
  });

  proc.on('close', code => {
    logger.info(`FFmpeg exited [${streamKey}] code=${code}`);
    const stream = activeStreams.get(streamKey);
    if (stream) {
      clearTimeout(stream.reconnectTimer);
      activeStreams.delete(streamKey);
    }
  });

  activeStreams.set(streamKey, {
    process: proc,
    startTime: Date.now(),
    outputDir,
    reconnectTimer: null
  });

  return true;
}

function stopStream(streamKey) {
  const stream = activeStreams.get(streamKey);
  if (!stream) return false;

  clearTimeout(stream.reconnectTimer);
  stream.process.kill('SIGTERM');

  setTimeout(() => {
    const s = activeStreams.get(streamKey);
    if (s) {
      s.process.kill('SIGKILL');
      activeStreams.delete(streamKey);
    }
  }, 5000);

  activeStreams.delete(streamKey);
  logger.info(`Stream stopped: ${streamKey}`);
  return true;
}

function isStreamActive(streamKey) {
  return activeStreams.has(streamKey);
}

function getActiveStreams() {
  const result = {};
  activeStreams.forEach((val, key) => {
    result[key] = {
      startTime: val.startTime,
      uptime: Math.floor((Date.now() - val.startTime) / 1000),
      hlsUrl: `/streams/${key}/master.m3u8`
    };
  });
  return result;
}

function startCleanupJob() {
  setInterval(() => {
    if (!fs.existsSync(STREAMS_DIR)) return;

    try {
      fs.readdirSync(STREAMS_DIR).forEach(streamKey => {
        if (activeStreams.has(streamKey)) return;

        const dir = path.join(STREAMS_DIR, streamKey);
        const stat = fs.statSync(dir);
        const ageMin = (Date.now() - stat.mtimeMs) / 60000;

        if (ageMin > CLEANUP_MINUTES) {
          fs.rmSync(dir, { recursive: true, force: true });
          logger.info(`Cleaned stale stream dir: ${streamKey} (age: ${ageMin.toFixed(1)}m)`);
        }
      });
    } catch (err) {
      logger.error(`Cleanup error: ${err.message}`);
    }
  }, 5 * 60 * 1000);
}

module.exports = { startStream, stopStream, isStreamActive, getActiveStreams, startCleanupJob };
