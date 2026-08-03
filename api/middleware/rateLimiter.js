// middleware/rateLimiter.js
// Rate limiting middleware using express-rate-limit (already in package.json).
//
// generalLimiter — applied to all /api/ routes in app.js (300 req/min, tenant-keyed)
// authLimiter    — stricter limit on login/refresh endpoints (20 req/15min per IP)
//
// NOTE: generalLimiter is defined here for completeness but the one in app.js
// (tenant-keyed, 300/min) is already applied. authLimiter is the new addition.

const rateLimit = require('express-rate-limit');

// General limiter — mirrors the one in app.js, exported for reference
const generalLimiter = rateLimit({
  windowMs: 60_000,       // 1 minute
  max: 300,               // 300 requests per window per tenant/IP
  keyGenerator: (req) => req.tenantId || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
});

// Auth limiter — strict, IP-keyed, covers brute-force login attempts
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 20,                    // 20 attempts per IP per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again later.' },
  // Skip successful requests — only count failures toward the limit
  skipSuccessfulRequests: true,
});

module.exports = { generalLimiter, authLimiter };
