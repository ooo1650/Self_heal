// middleware/tenantAuth.js
// Verifies the Bearer JWT on every protected request.
//
// Token types:
//   Owner/staff JWT  — { tenant_id, staff_id, role, location_id? }
//   Cashier JWT      — { tenant_id, cashier_id, role: 'cashier', is_switched_session: true }
//
// Injects on every request:
//   req.tenantId          — always set
//   req.userRole          — 'owner' | 'staff' | 'cashier'
//   req.staffId           — staff.id for owner/staff tokens; null for cashier tokens
//   req.cashierId         — cashiers.id for cashier tokens; null for owner/staff tokens
//   req.actorId           — whichever of staffId/cashierId is non-null (convenience)
//   req.locationId        — active branch for this request; from token claim
//                           null for owners (they pass location via query/body per request)
//   req.isSwitchedSession — true only for cashier switch-in tokens
//   req.staffAccessTier   — 'owner' | 'manager' | 'staff' | null (cashier)
//                           Served from a 60-second in-process cache.
//
// Exported helpers (apply after tenantAuth in route chains):
//   requireBranchAccess   — 403 if manager/staff token has no access to req.locationId
//   requireOwner          — 403 if not owner tier
//   requireManagerOrAbove — 403 if staff tier

const jwt = require('jsonwebtoken');
const db  = require('../db');

// ── In-process cache for access_tier ─────────────────────────────────────────
// Keyed by staff_id. TTL: 60 seconds.
const tierCache  = new Map();
const TIER_TTL   = 60_000;

function getCachedTier(staffId) {
  const e = tierCache.get(staffId);
  if (!e) return null;
  if (Date.now() > e.expiresAt) { tierCache.delete(staffId); return null; }
  return e.tier;
}
function setCachedTier(staffId, tier) {
  tierCache.set(staffId, { tier, expiresAt: Date.now() + TIER_TTL });
}

// ── Main middleware ───────────────────────────────────────────────────────────
async function tenantAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];
  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  req.tenantId          = decoded.tenant_id;
  req.userRole          = decoded.role;
  req.isSwitchedSession = !!decoded.is_switched_session;
  req.locationId        = decoded.location_id ?? null;

  // ── Cashier token ───────────────────────────────────────────────────────────
  if (decoded.role === 'cashier') {
    req.cashierId       = decoded.cashier_id;
    req.staffId         = null;
    req.actorId         = decoded.cashier_id;
    req.staffAccessTier = null;
    return next();
  }

  // ── Owner / staff token ─────────────────────────────────────────────────────
  req.staffId   = decoded.staff_id;
  req.cashierId = null;
  req.actorId   = decoded.staff_id;

  // Owners always get full tier — no DB lookup needed
  if (decoded.role === 'owner') {
    req.staffAccessTier = 'owner';
    return next();
  }

  // Serve from cache if fresh
  const cached = getCachedTier(decoded.staff_id);
  if (cached !== null) {
    req.staffAccessTier = cached;
    return next();
  }

  // Fetch from DB and cache
  try {
    const { rows } = await db.query(
      'SELECT access_tier FROM staff WHERE id = $1 AND tenant_id = $2',
      [decoded.staff_id, decoded.tenant_id]
    );
    // Default to 'staff' (most restrictive) if row missing — safe fallback
    const tier = rows[0]?.access_tier ?? 'staff';
    setCachedTier(decoded.staff_id, tier);
    req.staffAccessTier = tier;
  } catch {
    // On transient DB error, fail safe with most restrictive tier
    req.staffAccessTier = 'staff';
  }

  next();
}

// ── requireBranchAccess ───────────────────────────────────────────────────────
// Apply after tenantAuth on any route that is branch-scoped.
// Owners bypass entirely. Managers/staff must have a row in staff_branch_access
// for (req.staffId, req.locationId).
//
// Usage:
//   router.get('/data', tenantAuth, requireBranchAccess, handler)
//   router.get('/data', tenantAuth, requireBranchAccess, authorizeRoles('owner','staff'), handler)
//
// Note: req.locationId must be set (from token claim or route param).
// If req.locationId is null and the user is not an owner, returns 403.
async function requireBranchAccess(req, res, next) {
  // Owners have unrestricted cross-branch access
  if (req.staffAccessTier === 'owner') return next();

  const locationId = req.locationId ?? req.params?.locationId ?? req.body?.location_id ?? req.query?.location_id;

  if (!locationId) {
    return res.status(403).json({ error: 'No branch context — set location_id in token or request.' });
  }

  try {
    const { rows } = await db.query(
      `SELECT 1 FROM staff_branch_access
       WHERE staff_id = $1 AND location_id = $2 AND tenant_id = $3
       LIMIT 1`,
      [req.staffId, locationId, req.tenantId]
    );
    if (rows.length === 0) {
      return res.status(403).json({ error: 'You do not have access to this branch.' });
    }
    // Stamp the resolved locationId so downstream handlers can use it
    req.locationId = locationId;
    next();
  } catch (err) {
    console.error('[requireBranchAccess]', err.message);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
}

// ── requireOwner ──────────────────────────────────────────────────────────────
// Hard blocks anyone who is not access_tier = 'owner'.
function requireOwner(req, res, next) {
  if (req.staffAccessTier === 'owner') return next();
  return res.status(403).json({ error: 'Owner access required.' });
}

// ── requireManagerOrAbove ─────────────────────────────────────────────────────
// Passes owner and manager tiers; blocks staff tier and cashiers.
function requireManagerOrAbove(req, res, next) {
  if (req.staffAccessTier === 'owner' || req.staffAccessTier === 'manager') return next();
  return res.status(403).json({ error: 'Manager or owner access required.' });
}

module.exports = tenantAuth;
module.exports.requireBranchAccess   = requireBranchAccess;
module.exports.requireOwner          = requireOwner;
module.exports.requireManagerOrAbove = requireManagerOrAbove;
