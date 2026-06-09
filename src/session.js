const crypto = require('crypto');
const logger = require('./logger');

// token → { streamKey, ip, domain, expiresAt }
const sessionStore = new Map();

const SESSION_TTL_MS = parseInt(process.env.SESSION_TTL_HOURS || '4', 10) * 60 * 60 * 1000;

function normalizeIp(ip) {
  // Strip IPv6-mapped IPv4 prefix
  return ip ? ip.replace(/^::ffff:/, '') : null;
}

function createSession(streamKey, ip, domain) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const normalizedIp = normalizeIp(ip);

  sessionStore.set(token, { streamKey, ip: normalizedIp, domain, expiresAt });
  setTimeout(() => sessionStore.delete(token), SESSION_TTL_MS);

  logger.info(`Session created: stream=${streamKey} ip=${normalizedIp} domain=${domain}`);
  return { token, expiresAt };
}

function validateSession(token, streamKey, ip, domain) {
  const session = sessionStore.get(token);

  if (!session) return { valid: false, reason: 'Invalid session token' };

  if (Date.now() > session.expiresAt) {
    sessionStore.delete(token);
    return { valid: false, reason: 'Session expired' };
  }

  if (session.streamKey !== streamKey) {
    return { valid: false, reason: 'Session not valid for this stream' };
  }

  // IP check — strict: different IP = blocked
  const reqIp = normalizeIp(ip);
  if (session.ip !== reqIp) {
    logger.warn(`IP mismatch: session=${session.ip} request=${reqIp} stream=${streamKey}`);
    return { valid: false, reason: 'Access denied: IP mismatch' };
  }

  return { valid: true };
}

function revokeSession(token) {
  return sessionStore.delete(token);
}

module.exports = { createSession, validateSession, revokeSession };
