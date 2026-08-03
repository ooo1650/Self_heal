// middleware/requirePasswordChange.js
// Phase 14b — Enforce must_change_password flag.
//
// Applied AFTER tenantAuth on ALL authenticated routes EXCEPT the three
// paths listed in BYPASS_PATHS. Fetches the flag fresh from DB on every
// request — does NOT trust the JWT claim, because the flag may be cleared
// or set mid-session without issuing a new token.
//
// Returns 403 { error: 'PASSWORD_CHANGE_REQUIRED' } if the flag is true.
// The frontend's Axios interceptor watches for this code and redirects
// to /change-password automatically.

const db = require('../db');

// Routes that must still work even when must_change_password = true.
// Exact prefix match — keep this list minimal.
const BYPASS_PATHS = [
  '/api/auth/change-password',
  '/api/auth/refresh',
  '/api/auth/logout',
  '/api/auth/select-branch',   // branch switching must work even if password change pending
  '/api/health',
];

async function requirePasswordChange(req, res, next) {
  // Only applies to authenticated staff/owner requests.
  // Cashier tokens (req.cashierId set, req.staffId null) don't have
  // must_change_password — they're PIN-only actors, skip this check.
  if (!req.staffId) return next();

  // Check bypass list — exact prefix match
  const path = req.path;
  for (const bypass of BYPASS_PATHS) {
    if (path === bypass || path.startsWith(bypass + '/')) return next();
  }
  // Also bypass the full URL path from app.js perspective
  const fullPath = req.originalUrl.split('?')[0];
  for (const bypass of BYPASS_PATHS) {
    if (fullPath === bypass || fullPath.startsWith(bypass + '/')) return next();
  }

  try {
    const { rows } = await db.query(
      'SELECT must_change_password FROM staff WHERE id = $1',
      [req.staffId]
    );
    if (rows.length > 0 && rows[0].must_change_password === true) {
      return res.status(403).json({
        error:   'PASSWORD_CHANGE_REQUIRED',
        message: 'You must change your password before continuing.',
      });
    }
    next();
  } catch (err) {
    console.error('[requirePasswordChange]', err.message);
    // On DB error, fail open (don't block the request) — let it proceed.
    next();
  }
}

module.exports = requirePasswordChange;
