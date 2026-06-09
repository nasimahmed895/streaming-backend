const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const STREAMS_DIR = path.join(__dirname, '..', 'streams');

// streamKey → { key (Buffer 16 bytes), iv (hex string) }
const keyStore = new Map();

function generateEncryptionKey(streamKey) {
  const key = crypto.randomBytes(16);
  const iv = crypto.randomBytes(16).toString('hex');

  const streamDir = path.join(STREAMS_DIR, streamKey);
  if (!fs.existsSync(streamDir)) fs.mkdirSync(streamDir, { recursive: true });

  const keyPath = path.join(streamDir, 'enc.key');
  fs.writeFileSync(keyPath, key);

  keyStore.set(streamKey, { key, iv, keyPath });
  logger.info(`Encryption key generated for stream: ${streamKey}`);
  return { key, iv, keyPath };
}

function getKey(streamKey) {
  return keyStore.get(streamKey) || null;
}

function createKeyInfoFile(streamKey, keyUri) {
  const entry = keyStore.get(streamKey);
  if (!entry) throw new Error(`No key for stream: ${streamKey}`);

  const keyInfoPath = path.join(STREAMS_DIR, streamKey, 'enc.keyinfo');
  // Format: KEY_URI \n KEY_FILE_PATH \n IV
  fs.writeFileSync(keyInfoPath, `${keyUri}\n${entry.keyPath}\n${entry.iv}`);
  return keyInfoPath;
}

function removeKey(streamKey) {
  const entry = keyStore.get(streamKey);
  if (entry) {
    try { fs.unlinkSync(entry.keyPath); } catch {}
    try {
      fs.unlinkSync(path.join(STREAMS_DIR, streamKey, 'enc.keyinfo'));
    } catch {}
  }
  keyStore.delete(streamKey);
}

module.exports = { generateEncryptionKey, getKey, createKeyInfoFile, removeKey };
