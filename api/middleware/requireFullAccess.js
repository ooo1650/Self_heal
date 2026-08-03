// middleware/requireFullAccess.js
//
// Phase 16a compatibility shim.
// Previously this blocked 'limited' tier; now maps to the new 3-tier model:
//   - 'owner'   → passes
//   - 'manager' → passes (equivalent to old 'full')
//   - 'staff'   → 403   (equivalent to old 'limited')
//   - cashier   → 403
//
// Apply to:
//   Settings → Business, Payment, Features (blocked for staff tier)
//   Staff edit/status/password routes (staff tier read-only)
//
// For new routes use requireOwner / requireManagerOrAbove from tenantAuth.js instead.

function requireFullAccess(req, res, next) {
  const tier = req.staffAccessTier;
  if (tier === 'owner' || tier === 'manager') return next();
  return res.status(403).json({ error: "You don't have permission to do this." });
}

module.exports = requireFullAccess;
