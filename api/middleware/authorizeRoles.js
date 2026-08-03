// middleware/authorizeRoles.js
// Usage: router.get('/route', tenantAuth, authorizeRoles('owner'), handler)
//        router.post('/route', tenantAuth, authorizeRoles('owner', 'cashier'), handler)
// Must be used AFTER tenantAuth — relies on req.userRole being set.

function authorizeRoles(...allowedRoles) {
  return function (req, res, next) {
    if (!req.userRole) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    if (!allowedRoles.includes(req.userRole)) {
      return res.status(403).json({
        error: 'Forbidden',
        required_roles: allowedRoles,
        your_role: req.userRole,
      });
    }
    next();
  };
}

module.exports = authorizeRoles;
