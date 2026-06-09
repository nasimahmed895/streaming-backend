const crypto = require('crypto');

// token → { streamKey, expiresAt, createdAt }
const tokenStore = new Map();

const TOKEN_TTL_MS = parseInt(process.env.TOKEN_TTL_HOURS || '4', 10) * 60 * 60 * 1000;

function generateToken(streamKey) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + TOKEN_TTL_MS;

  tokenStore.set(token, { streamKey, expiresAt, createdAt: Date.now() });

  // Auto-expire
  setTimeout(() => tokenStore.delete(token), TOKEN_TTL_MS);

  return { token, expiresAt };
}

function validateToken(token, streamKey) {
  const entry = tokenStore.get(token);
  if (!entry) return { valid: false, reason: 'Invalid token' };
  if (Date.now() > entry.expiresAt) {
    tokenStore.delete(token);
    return { valid: false, reason: 'Token expired' };
  }
  if (entry.streamKey !== streamKey) return { valid: false, reason: 'Token stream mismatch' };
  return { valid: true };
}

function revokeToken(token) {
  return tokenStore.delete(token);
}

function listTokens() {
  const result = [];
  tokenStore.forEach((val, token) => {
    result.push({
      token: token.slice(0, 8) + '...',
      streamKey: val.streamKey,
      expiresAt: new Date(val.expiresAt).toISOString(),
      createdAt: new Date(val.createdAt).toISOString()
    });
  });
  return result;
}

// Express middleware — validates ?token= on /streams/* routes
function streamAuthMiddleware(req, res, next) {
  // Extract streamKey from path: /streams/{streamKey}/...
  const parts = req.path.split('/').filter(Boolean);
  const streamKey = parts[0];

  if (!streamKey) return res.status(403).json({ error: 'Missing stream key in path' });

  const token = req.query.token;
  if (!token) return res.status(403).json({ error: 'Missing token. Request a token from the server admin.' });

  const result = validateToken(token, streamKey);
  if (!result.valid) return res.status(403).json({ error: result.reason });

  next();
}

module.exports = { generateToken, validateToken, revokeToken, listTokens, streamAuthMiddleware };
