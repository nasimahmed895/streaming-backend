const logger = require('./logger');

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

// Parse ALLOWED_DOMAINS from env: "yourdomain.com,app.yourdomain.com"
function getAllowedDomains() {
  const raw = process.env.ALLOWED_DOMAINS || '';
  return raw
    .split(',')
    .map(d => d.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*/, ''))
    .filter(Boolean);
}

function extractHost(req) {
  const referer = req.headers['referer'] || req.headers['origin'] || '';
  if (!referer) return null;
  try {
    return new URL(referer).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isDomainAllowed(host) {
  const allowed = getAllowedDomains();
  // If no domains configured → open (dev convenience)
  if (allowed.length === 0) return true;
  return allowed.some(d => host === d || host.endsWith('.' + d));
}

// Middleware: auto domain check on /streams/* — no token needed
function streamAuthMiddleware(req, res, next) {
  const host = extractHost(req);

  // Always allow localhost in non-production
  if (process.env.NODE_ENV !== 'production' && (!host || LOCAL_HOSTS.has(host))) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    return next();
  }

  if (!host) {
    logger.warn(`Stream blocked: no Referer/Origin | path=${req.path}`);
    return res.status(403).json({ error: 'Direct access not allowed' });
  }

  if (!isDomainAllowed(host)) {
    logger.warn(`Stream blocked: unauthorized domain=${host} | path=${req.path}`);
    return res.status(403).json({ error: `Domain not allowed: ${host}` });
  }

  // Set CORS to exact requesting domain
  const origin = req.headers['origin'] || `https://${host}`;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Vary', 'Origin');

  logger.debug(`Stream allowed: domain=${host} | path=${req.path}`);
  next();
}

// Admin key guard for management endpoints
function requireAdmin(req, res, next) {
  const adminKey = process.env.ADMIN_KEY;
  if (!adminKey) return next();
  const provided = req.headers['x-admin-key'] || req.query.adminKey;
  if (provided !== adminKey) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

module.exports = { streamAuthMiddleware, requireAdmin, isDomainAllowed, getAllowedDomains };
