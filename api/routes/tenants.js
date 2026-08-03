// routes/tenants.js
// Phase 13e + Phase 16a — Tenant self-management and branch management
// Owner only for all write operations.
//
// GET    /api/tenants/me              — fetch own tenant row
// PATCH  /api/tenants/me             — update business fields
// GET    /api/tenants/me/config       — fetch config JSONB
// PATCH  /api/tenants/me/config       — merge-update config JSONB
//
// GET    /api/locations               — list all branches
// POST   /api/locations               — create branch (owner only)
// PUT    /api/locations/:id           — update name/code/address/phone/is_headquarters (owner only)
// POST   /api/locations/:id/deactivate — soft deactivate (owner only, cannot deactivate headquarters)
// GET    /api/locations/:id/staff     — list staff assigned to this branch

const router     = require('express').Router();
const db         = require('../db');
const { v4: uuidv4 } = require('uuid');
const tenantAuth = require('../middleware/tenantAuth');
const { requireOwner } = require('../middleware/tenantAuth');
const authorizeRoles = require('../middleware/authorizeRoles');

// ── GET /api/tenants/me ───────────────────────────────────────────────────────
router.get('/me', tenantAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, business_name, subdomain, owner_email, pan_number,
              address, phone, logo_url, config, created_at
       FROM tenants WHERE id = $1`,
      [req.tenantId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'TENANT_NOT_FOUND' });
    return res.json({ tenant: rows[0] });
  } catch (err) {
    console.error('[tenants/me GET]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ── PATCH /api/tenants/me ─────────────────────────────────────────────────────
// Update mutable business details. Owner only.
// Body: any subset of { business_name, pan_number, address, phone, logo_url }
router.patch('/me', tenantAuth, authorizeRoles('owner'), async (req, res) => {
  const { business_name, pan_number, address, phone, logo_url } = req.body;

  const fields = [];
  const values = [];
  let   idx    = 1;

  if (business_name !== undefined) { fields.push(`business_name = $${idx++}`); values.push(business_name); }
  if (pan_number    !== undefined) { fields.push(`pan_number    = $${idx++}`); values.push(pan_number); }
  if (address       !== undefined) { fields.push(`address       = $${idx++}`); values.push(address); }
  if (phone         !== undefined) { fields.push(`phone         = $${idx++}`); values.push(phone); }
  if (logo_url      !== undefined) { fields.push(`logo_url      = $${idx++}`); values.push(logo_url); }

  if (fields.length === 0) return res.status(400).json({ error: 'NO_FIELDS_TO_UPDATE' });

  values.push(req.tenantId);
  try {
    const { rows } = await db.query(
      `UPDATE tenants SET ${fields.join(', ')}
       WHERE id = $${idx}
       RETURNING id, business_name, subdomain, owner_email, pan_number,
                 address, phone, logo_url, config`,
      values
    );
    return res.json({ tenant: rows[0] });
  } catch (err) {
    console.error('[tenants/me PATCH]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ── GET /api/tenants/me/config ────────────────────────────────────────────────
router.get('/me/config', tenantAuth, authorizeRoles('owner'), async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT config FROM tenants WHERE id = $1',
      [req.tenantId]
    );
    return res.json({ config: rows[0]?.config ?? {} });
  } catch (err) {
    console.error('[tenants/config GET]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ── PATCH /api/tenants/me/config ──────────────────────────────────────────────
// Merge-updates the config JSONB. Only the keys sent are updated;
// existing keys not in the body are preserved via jsonb_strip_nulls + ||.
// Body: { features?: { useBarcodes, expiryTracking, binTracking, ... },
//          business_type?: 'RETAIL' | ... }
router.patch('/me/config', tenantAuth, authorizeRoles('owner'), async (req, res) => {
  const update = req.body; // caller sends only the keys they want to change

  if (!update || typeof update !== 'object' || Array.isArray(update)) {
    return res.status(400).json({ error: 'INVALID_BODY', message: 'Send a JSON object of config keys to update' });
  }

  try {
    // Merge the incoming object into the existing config JSONB
    const { rows } = await db.query(
      `UPDATE tenants
       SET config = config || $1::jsonb
       WHERE id = $2
       RETURNING config`,
      [JSON.stringify(update), req.tenantId]
    );
    return res.json({ config: rows[0].config });
  } catch (err) {
    console.error('[tenants/config PATCH]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ── GET /api/locations ────────────────────────────────────────────────────────
// List all locations for this tenant. Any authenticated user can call this.
router.get('/locations', tenantAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT l.id, l.location_name, l.location_code, l.is_main_branch,
              l.is_headquarters, l.address, l.phone, l.created_at,
              (SELECT COUNT(*) FROM staff_branch_access sba WHERE sba.location_id = l.id AND sba.tenant_id = l.tenant_id) AS staff_count,
              (SELECT COUNT(*) FROM cashiers c WHERE c.location_id = l.id AND c.tenant_id = l.tenant_id AND c.is_active = true) AS cashier_count
       FROM locations l
       WHERE l.tenant_id = $1
       ORDER BY l.is_headquarters DESC, l.is_main_branch DESC, l.location_name ASC`,
      [req.tenantId]
    );
    return res.json({ locations: rows });
  } catch (err) {
    console.error('[locations/list]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ── POST /api/locations ───────────────────────────────────────────────────────
// Create a new branch. Owner only.
// Body: { location_name, location_code, address?, phone?, is_headquarters? }
router.post('/locations', tenantAuth, requireOwner, async (req, res) => {
  const {
    location_name,
    location_code,
    address        = null,
    phone          = null,
    is_headquarters = false,
  } = req.body;

  if (!location_name || !location_code) {
    return res.status(400).json({ error: 'MISSING_FIELDS', required: ['location_name', 'location_code'] });
  }

  // If setting as headquarters, clear existing headquarters flag first (only one allowed)
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    if (is_headquarters) {
      await client.query(
        'UPDATE locations SET is_headquarters = false WHERE tenant_id = $1',
        [req.tenantId]
      );
    }

    const { rows } = await client.query(
      `INSERT INTO locations
         (id, tenant_id, location_name, location_code, is_main_branch, is_headquarters, address, phone)
       VALUES ($1, $2, $3, $4, false, $5, $6, $7)
       RETURNING *`,
      [uuidv4(), req.tenantId, location_name.trim(), location_code.toUpperCase().trim(),
       !!is_headquarters, address, phone]
    );

    await client.query('COMMIT');
    return res.status(201).json({ location: rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') return res.status(409).json({ error: 'LOCATION_CODE_TAKEN', location_code });
    console.error('[locations/create]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  } finally {
    client.release();
  }
});

// ── PUT /api/locations/:id ────────────────────────────────────────────────────
// Update branch details. Owner only.
// Body: any subset of { location_name, location_code, address, phone, is_headquarters }
router.put('/locations/:id', tenantAuth, requireOwner, async (req, res) => {
  const { location_name, location_code, address, phone, is_headquarters } = req.body;

  const fields = [];
  const values = [];
  let   idx    = 1;

  if (location_name   !== undefined) { fields.push(`location_name    = $${idx++}`); values.push(location_name.trim()); }
  if (location_code   !== undefined) { fields.push(`location_code    = $${idx++}`); values.push(location_code.toUpperCase().trim()); }
  if (address         !== undefined) { fields.push(`address          = $${idx++}`); values.push(address); }
  if (phone           !== undefined) { fields.push(`phone            = $${idx++}`); values.push(phone); }
  if (is_headquarters !== undefined) { fields.push(`is_headquarters  = $${idx++}`); values.push(!!is_headquarters); }

  if (fields.length === 0) return res.status(400).json({ error: 'NO_FIELDS_TO_UPDATE' });

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // If setting as headquarters, clear existing one first
    if (is_headquarters) {
      await client.query(
        'UPDATE locations SET is_headquarters = false WHERE tenant_id = $1 AND id != $2',
        [req.tenantId, req.params.id]
      );
    }

    values.push(req.params.id, req.tenantId);
    const { rows } = await client.query(
      `UPDATE locations SET ${fields.join(', ')}
       WHERE id = $${idx} AND tenant_id = $${idx + 1}
       RETURNING *`,
      values
    );

    await client.query('COMMIT');
    if (rows.length === 0) return res.status(404).json({ error: 'LOCATION_NOT_FOUND' });
    return res.json({ location: rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') return res.status(409).json({ error: 'LOCATION_CODE_TAKEN', location_code });
    console.error('[locations/update]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  } finally {
    client.release();
  }
});

// ── POST /api/locations/:id/deactivate ────────────────────────────────────────
// Soft-deactivate a branch. Owner only.
// Cannot deactivate the headquarters or a branch that has open shifts.
router.post('/locations/:id/deactivate', tenantAuth, requireOwner, async (req, res) => {
  try {
    const { rows: locRows } = await db.query(
      'SELECT id, is_headquarters, is_main_branch FROM locations WHERE id = $1 AND tenant_id = $2',
      [req.params.id, req.tenantId]
    );
    if (locRows.length === 0) return res.status(404).json({ error: 'LOCATION_NOT_FOUND' });

    const loc = locRows[0];
    if (loc.is_headquarters) {
      return res.status(409).json({ error: 'CANNOT_DEACTIVATE_HQ', message: 'Cannot deactivate the headquarters branch.' });
    }
    if (loc.is_main_branch) {
      return res.status(409).json({ error: 'CANNOT_DEACTIVATE_MAIN', message: 'Cannot deactivate the main branch.' });
    }

    // Check for open shifts at this location
    const { rows: shiftRows } = await db.query(
      `SELECT id FROM cash_shifts WHERE location_id = $1 AND tenant_id = $2 AND status = 'open' LIMIT 1`,
      [req.params.id, req.tenantId]
    );
    if (shiftRows.length > 0) {
      return res.status(409).json({ error: 'OPEN_SHIFTS_EXIST', message: 'Close all open shifts before deactivating this branch.' });
    }

    // locations table uses is_active — add it if not present (safe with IF NOT EXISTS logic)
    await db.query(
      'UPDATE locations SET is_active = false WHERE id = $1 AND tenant_id = $2',
      [req.params.id, req.tenantId]
    );

    return res.json({ message: 'Branch deactivated successfully.' });
  } catch (err) {
    // If is_active column doesn't exist, return a clear error
    if (err.code === '42703') {
      return res.status(501).json({ error: 'NOT_IMPLEMENTED', message: 'Branch deactivation not yet supported in this schema version.' });
    }
    console.error('[locations/deactivate]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ── GET /api/locations/:id/staff ──────────────────────────────────────────────
// List staff assigned to this branch. Owner only.
router.get('/locations/:id/staff', tenantAuth, requireOwner, async (req, res) => {
  try {
    // Verify location belongs to tenant
    const { rows: locRows } = await db.query(
      'SELECT id FROM locations WHERE id = $1 AND tenant_id = $2',
      [req.params.id, req.tenantId]
    );
    if (locRows.length === 0) return res.status(404).json({ error: 'LOCATION_NOT_FOUND' });

    const { rows } = await db.query(
      `SELECT s.id, s.full_name, s.email, s.role, s.access_tier,
              s.is_active, s.max_item_discount_pct, sba.created_at AS assigned_at
       FROM staff_branch_access sba
       JOIN staff s ON s.id = sba.staff_id
       WHERE sba.location_id = $1 AND sba.tenant_id = $2
       ORDER BY s.access_tier ASC, s.full_name ASC`,
      [req.params.id, req.tenantId]
    );
    return res.json({ staff: rows });
  } catch (err) {
    console.error('[locations/staff]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

module.exports = router;
