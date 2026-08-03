// routes/provider.js
// Phase 15h — Provider tool endpoint
//
// POST /api/provider/create-tenant
// Called only by the standalone tools/create-tenant.html provider tool.
// Protected by X-Provider-Secret header — NOT a user-facing route.
// No session/cookie/JWT required (plain fetch from a local HTML file).
//
// Creates: tenants row + main branch location + hashed owner staff account
//   with must_change_password = true.
//
// Body: { business_name, subdomain, owner_email, password,
//          pan_number?, address?, phone? }
// Header: X-Provider-Secret: <PROVIDER_SECRET from .env>

const router   = require('express').Router();
const bcrypt   = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const db       = require('../db');
const { sendWelcomeEmail } = require('../utils/mailer');

// ── Secret-check middleware (applied only to this router) ─────────────────────
function requireProviderSecret(req, res, next) {
  const secret = process.env.PROVIDER_SECRET;
  if (!secret) {
    // If PROVIDER_SECRET is not configured, reject all requests
    return res.status(503).json({
      error:   'PROVIDER_NOT_CONFIGURED',
      message: 'PROVIDER_SECRET env var is not set on this server.',
    });
  }
  const provided = req.headers['x-provider-secret'];
  if (!provided || provided !== secret) {
    return res.status(401).json({ error: 'INVALID_PROVIDER_SECRET' });
  }
  next();
}

// ── POST /api/provider/create-tenant ─────────────────────────────────────────
router.post('/create-tenant', requireProviderSecret, async (req, res) => {
  const {
    business_name,
    subdomain,
    owner_email,
    password,
    pan_number     = null,
    address        = null,
    phone          = null,
    location_name  = 'Main Branch',
    location_code  = 'MAIN',
  } = req.body;

  // ── Validation ────────────────────────────────────────────────────────────
  if (!business_name || !subdomain || !owner_email || !password) {
    return res.status(400).json({
      error:    'MISSING_FIELDS',
      required: ['business_name', 'subdomain', 'owner_email', 'password'],
    });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'PASSWORD_TOO_SHORT', min_length: 8 });
  }
  const subdomainClean = subdomain.toLowerCase().trim().replace(/[^a-z0-9-]/g, '');
  if (!subdomainClean) {
    return res.status(400).json({ error: 'INVALID_SUBDOMAIN' });
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // 1. Tenants row
    const tenantId = uuidv4();
    await client.query(
      `INSERT INTO tenants
         (id, business_name, subdomain, owner_email, pan_number, address, phone, config)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        tenantId,
        business_name.trim(),
        subdomainClean,
        owner_email.toLowerCase().trim(),
        pan_number,
        address,
        phone,
        JSON.stringify({
          business_type: 'RETAIL',
          features: { useBarcodes: true, sizeColorModifiers: true,
                      expiryTracking: false, binTracking: false },
        }),
      ]
    );

    // 2. Main branch location
    const locationId = uuidv4();
    await client.query(
      `INSERT INTO locations
         (id, tenant_id, location_name, location_code, is_main_branch)
       VALUES ($1, $2, $3, $4, true)`,
      [locationId, tenantId, location_name, location_code.toUpperCase().trim()]
    );

    // 3. Owner staff account — must_change_password = true (first login forced)
    const passwordHash = await bcrypt.hash(password, 12);
    const staffId      = uuidv4();
    await client.query(
      `INSERT INTO staff
         (id, tenant_id, location_id, full_name, email, password_hash, role,
          max_item_discount_pct, is_active, must_change_password)
       VALUES ($1, $2, $3, $4, $5, $6, 'owner', 100.00, true, true)`,
      [staffId, tenantId, locationId, business_name.trim(),
       owner_email.toLowerCase().trim(), passwordHash]
    );

    await client.query('COMMIT');

    // Fire welcome email — non-blocking
    sendWelcomeEmail(owner_email.toLowerCase().trim(), business_name.trim()).catch(() => {});

    return res.status(201).json({
      message:       'Tenant created successfully',
      tenant_id:     tenantId,
      subdomain:     subdomainClean,
      owner_email:   owner_email.toLowerCase().trim(),
      temp_password: password,           // returned ONCE so provider can copy it
      location_id:   locationId,
      staff_id:      staffId,
      login_url:     `${process.env.BASE_URL || 'http://localhost:3000'}/login`,
      note:          'must_change_password=true — owner must change password on first login',
    });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      const detail = err.detail || '';
      if (detail.includes('subdomain')) {
        return res.status(409).json({ error: 'SUBDOMAIN_TAKEN', subdomain: subdomainClean });
      }
      if (detail.includes('owner_email') || detail.includes('email')) {
        return res.status(409).json({ error: 'EMAIL_TAKEN', owner_email });
      }
      return res.status(409).json({ error: 'DUPLICATE_VALUE', detail });
    }
    console.error('[provider/create-tenant]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  } finally {
    client.release();
  }
});

module.exports = router;
