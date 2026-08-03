// routes/staff.js
// Phase 12 + Phase 16a — Staff account management
//
// POST   /api/staff                          — create staff (owner only)
// GET    /api/staff                          — list all staff for tenant
// GET    /api/staff/:id                      — single staff member
// PUT    /api/staff/:id                      — update name/tier/discount
// PATCH  /api/staff/:id/status              — activate / deactivate
// PUT    /api/staff/:id/password            — reset password (owner/manager)
// GET    /api/staff/:id/branches            — list assigned branches
// POST   /api/staff/:id/branches            — assign branch(es)
// DELETE /api/staff/:id/branches/:locationId — remove branch access
//
// Access tier rules (Phase 16a):
//   - POST (create): owner only
//   - GET (list/read): owner + all staff
//   - PUT/PATCH/password: owner + manager (requireFullAccess)
//   - branch assignment: owner only
//
// On creation: must_change_password = true → OTP flow on first login.

const router         = require('express').Router();
const bcrypt         = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const db             = require('../db');
const tenantAuth     = require('../middleware/tenantAuth');
const { requireOwner } = require('../middleware/tenantAuth');
const authorizeRoles = require('../middleware/authorizeRoles');
const requireFullAccess = require('../middleware/requireFullAccess');

const VALID_TIERS = ['manager', 'staff'];  // owner tier is set only at tenant registration

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/staff — owner only
// Body: { full_name, email, password, access_tier?, location_id?,
//         branch_ids[]?, max_item_discount_pct? }
// branch_ids: array of location UUIDs to assign immediately on creation.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/', tenantAuth, requireOwner, async (req, res) => {
  const {
    full_name,
    email,
    password,
    location_id           = null,
    max_item_discount_pct = 10.00,
    access_tier           = 'staff',
    branch_ids            = [],
  } = req.body;

  if (!full_name || !email || !password) {
    return res.status(400).json({
      error:    'MISSING_FIELDS',
      required: ['full_name', 'email', 'password'],
    });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'PASSWORD_TOO_SHORT', min_length: 8 });
  }
  if (!VALID_TIERS.includes(access_tier)) {
    return res.status(400).json({ error: 'INVALID_ACCESS_TIER', valid: VALID_TIERS });
  }
  const discountCeiling = Number(max_item_discount_pct);
  if (!isFinite(discountCeiling) || discountCeiling < 0 || discountCeiling > 100) {
    return res.status(400).json({ error: 'INVALID_DISCOUNT_CEILING' });
  }

  // Validate location_id (primary branch on staff row) belongs to tenant
  if (location_id) {
    const { rows } = await db.query(
      'SELECT id FROM locations WHERE id = $1 AND tenant_id = $2',
      [location_id, req.tenantId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'LOCATION_NOT_FOUND' });
  }

  // Validate all branch_ids belong to this tenant
  if (branch_ids.length > 0) {
    const { rows: locRows } = await db.query(
      'SELECT id FROM locations WHERE tenant_id = $1 AND id = ANY($2::uuid[])',
      [req.tenantId, branch_ids]
    );
    if (locRows.length !== branch_ids.length) {
      return res.status(404).json({ error: 'BRANCH_NOT_FOUND', message: 'One or more branch IDs are invalid.' });
    }
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const staffId      = uuidv4();
    const finalEmail   = email.toLowerCase().trim();
    const passwordHash = await bcrypt.hash(password, 12);

    const { rows } = await client.query(
      `INSERT INTO staff
         (id, tenant_id, location_id, full_name, email, password_hash,
          role, max_item_discount_pct, access_tier, is_active, must_change_password)
       VALUES ($1, $2, $3, $4, $5, $6, 'staff', $7, $8, true, true)
       RETURNING id, tenant_id, location_id, full_name, email,
                 role, access_tier, max_item_discount_pct, is_active, created_at`,
      [staffId, req.tenantId, location_id, full_name.trim(), finalEmail,
       passwordHash, discountCeiling, access_tier]
    );

    // Assign branches — merge location_id and branch_ids, deduplicate
    const allBranchIds = [...new Set([
      ...(location_id ? [location_id] : []),
      ...branch_ids,
    ])];

    for (const locId of allBranchIds) {
      await client.query(
        `INSERT INTO staff_branch_access (staff_id, tenant_id, location_id)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [staffId, req.tenantId, locId]
      );
    }

    await client.query('COMMIT');
    return res.status(201).json({ staff: rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      return res.status(409).json({ error: 'EMAIL_TAKEN', message: 'A staff account with this email already exists' });
    }
    console.error('[staff/create]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  } finally {
    client.release();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/staff — owner + all staff
// ?active=true|false  ?role=staff|owner
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', tenantAuth, authorizeRoles('owner', 'staff'), async (req, res) => {
  const { active, role } = req.query;
  const params = [req.tenantId];
  let   idx    = 2;
  let   filter = '';

  if (active === 'true')  filter += ' AND s.is_active = true';
  if (active === 'false') filter += ' AND s.is_active = false';
  if (role && ['owner', 'staff'].includes(role)) {
    filter += ` AND s.role = $${idx++}`;
    params.push(role);
  }

  try {
    const { rows } = await db.query(
      `SELECT s.id, s.full_name, s.email, s.role, s.access_tier,
              s.max_item_discount_pct, s.is_active, s.created_at,
              s.location_id, l.location_name, l.location_code
       FROM staff s
       LEFT JOIN locations l ON l.id = s.location_id
       WHERE s.tenant_id = $1 ${filter}
       ORDER BY s.role ASC, s.full_name ASC`,
      params
    );
    return res.json({ staff: rows });
  } catch (err) {
    console.error('[staff/list]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/staff/:id
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:id', tenantAuth, authorizeRoles('owner', 'staff'), async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT s.id, s.full_name, s.email, s.role, s.access_tier,
              s.max_item_discount_pct, s.is_active, s.created_at,
              s.location_id, l.location_name, l.location_code
       FROM staff s
       LEFT JOIN locations l ON l.id = s.location_id
       WHERE s.id = $1 AND s.tenant_id = $2`,
      [req.params.id, req.tenantId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'STAFF_NOT_FOUND' });
    return res.json({ staff: rows[0] });
  } catch (err) {
    console.error('[staff/get]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/staff/:id — owner + manager
// Body: any subset of { full_name, location_id, max_item_discount_pct, access_tier }
// ─────────────────────────────────────────────────────────────────────────────
router.put('/:id', tenantAuth, authorizeRoles('owner', 'staff'), requireFullAccess, async (req, res) => {
  const { rows: existing } = await db.query(
    'SELECT id, role FROM staff WHERE id = $1 AND tenant_id = $2',
    [req.params.id, req.tenantId]
  );
  if (existing.length === 0) return res.status(404).json({ error: 'STAFF_NOT_FOUND' });

  const { full_name, location_id, max_item_discount_pct, access_tier } = req.body;

  const fields = [];
  const values = [];
  let   idx    = 1;

  if (full_name != null) {
    fields.push(`full_name = $${idx++}`);
    values.push(full_name.trim());
  }
  if (location_id !== undefined) {
    if (location_id !== null) {
      const { rows: locRows } = await db.query(
        'SELECT id FROM locations WHERE id = $1 AND tenant_id = $2',
        [location_id, req.tenantId]
      );
      if (locRows.length === 0) return res.status(404).json({ error: 'LOCATION_NOT_FOUND' });
    }
    fields.push(`location_id = $${idx++}`);
    values.push(location_id);
  }
  if (max_item_discount_pct != null) {
    const ceiling = Number(max_item_discount_pct);
    if (!isFinite(ceiling) || ceiling < 0 || ceiling > 100) {
      return res.status(400).json({ error: 'INVALID_DISCOUNT_CEILING' });
    }
    fields.push(`max_item_discount_pct = $${idx++}`);
    values.push(ceiling);
  }
  if (access_tier != null && existing[0].role === 'staff') {
    if (!VALID_TIERS.includes(access_tier)) {
      return res.status(400).json({ error: 'INVALID_ACCESS_TIER', valid: VALID_TIERS });
    }
    fields.push(`access_tier = $${idx++}`);
    values.push(access_tier);
  }

  if (fields.length === 0) return res.status(400).json({ error: 'NO_FIELDS_TO_UPDATE' });

  values.push(req.params.id, req.tenantId);
  try {
    const { rows } = await db.query(
      `UPDATE staff SET ${fields.join(', ')}
       WHERE id = $${idx} AND tenant_id = $${idx + 1}
       RETURNING id, full_name, email, role, access_tier, max_item_discount_pct,
                 is_active, location_id, created_at`,
      values
    );
    return res.json({ staff: rows[0] });
  } catch (err) {
    console.error('[staff/update]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/staff/:id/status — owner + manager
// Body: { is_active: boolean }
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/:id/status', tenantAuth, authorizeRoles('owner', 'staff'), requireFullAccess, async (req, res) => {
  const { is_active } = req.body;
  if (typeof is_active !== 'boolean') {
    return res.status(400).json({ error: 'MISSING_FIELDS', required: ['is_active (boolean)'] });
  }
  if (req.params.id === req.staffId && !is_active) {
    return res.status(403).json({ error: 'CANNOT_DEACTIVATE_SELF' });
  }
  try {
    const { rows } = await db.query(
      `UPDATE staff SET is_active = $1
       WHERE id = $2 AND tenant_id = $3
       RETURNING id, full_name, email, role, is_active`,
      [is_active, req.params.id, req.tenantId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'STAFF_NOT_FOUND' });
    return res.json(rows[0]);
  } catch (err) {
    console.error('[staff/status]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/staff/:id/password — owner + manager
// Body: { new_password }
// ─────────────────────────────────────────────────────────────────────────────
router.put('/:id/password', tenantAuth, authorizeRoles('owner', 'staff'), requireFullAccess, async (req, res) => {
  const { new_password } = req.body;
  if (!new_password) return res.status(400).json({ error: 'MISSING_FIELDS', required: ['new_password'] });
  if (new_password.length < 8) return res.status(400).json({ error: 'PASSWORD_TOO_SHORT', min_length: 8 });

  const { rows: existing } = await db.query(
    'SELECT id FROM staff WHERE id = $1 AND tenant_id = $2',
    [req.params.id, req.tenantId]
  );
  if (existing.length === 0) return res.status(404).json({ error: 'STAFF_NOT_FOUND' });

  try {
    const passwordHash = await bcrypt.hash(new_password, 12);
    await db.query(
      `UPDATE staff SET password_hash = $1, must_change_password = true
       WHERE id = $2 AND tenant_id = $3`,
      [passwordHash, req.params.id, req.tenantId]
    );
    return res.json({ message: 'Password updated. Staff must change password on next login.' });
  } catch (err) {
    console.error('[staff/password]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/staff/:id/branches — list assigned branches
// Owner only.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:id/branches', tenantAuth, requireOwner, async (req, res) => {
  try {
    const { rows: staffRows } = await db.query(
      'SELECT id FROM staff WHERE id = $1 AND tenant_id = $2',
      [req.params.id, req.tenantId]
    );
    if (staffRows.length === 0) return res.status(404).json({ error: 'STAFF_NOT_FOUND' });

    const { rows } = await db.query(
      `SELECT l.id, l.location_name, l.location_code, l.is_main_branch,
              l.is_headquarters, sba.created_at AS assigned_at
       FROM staff_branch_access sba
       JOIN locations l ON l.id = sba.location_id
       WHERE sba.staff_id = $1 AND sba.tenant_id = $2
       ORDER BY l.is_headquarters DESC, l.location_name ASC`,
      [req.params.id, req.tenantId]
    );
    return res.json({ branches: rows });
  } catch (err) {
    console.error('[staff/branches/get]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/staff/:id/branches — assign branch(es)
// Owner only.
// Body: { branch_ids: UUID[] }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:id/branches', tenantAuth, requireOwner, async (req, res) => {
  const { branch_ids } = req.body;
  if (!Array.isArray(branch_ids) || branch_ids.length === 0) {
    return res.status(400).json({ error: 'MISSING_FIELDS', required: ['branch_ids (non-empty array)'] });
  }

  // Verify staff exists and belongs to tenant
  const { rows: staffRows } = await db.query(
    'SELECT id FROM staff WHERE id = $1 AND tenant_id = $2',
    [req.params.id, req.tenantId]
  );
  if (staffRows.length === 0) return res.status(404).json({ error: 'STAFF_NOT_FOUND' });

  // Verify all branch_ids belong to tenant
  const { rows: locRows } = await db.query(
    'SELECT id FROM locations WHERE tenant_id = $1 AND id = ANY($2::uuid[])',
    [req.tenantId, branch_ids]
  );
  if (locRows.length !== branch_ids.length) {
    return res.status(404).json({ error: 'BRANCH_NOT_FOUND' });
  }

  try {
    let assigned = 0;
    for (const locId of branch_ids) {
      const result = await db.query(
        `INSERT INTO staff_branch_access (staff_id, tenant_id, location_id)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [req.params.id, req.tenantId, locId]
      );
      assigned += result.rowCount;
    }
    return res.status(201).json({ assigned, total_requested: branch_ids.length });
  } catch (err) {
    console.error('[staff/branches/assign]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/staff/:id/branches/:locationId — remove branch access
// Owner only.
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/:id/branches/:locationId', tenantAuth, requireOwner, async (req, res) => {
  try {
    const { rowCount } = await db.query(
      `DELETE FROM staff_branch_access
       WHERE staff_id = $1 AND location_id = $2 AND tenant_id = $3`,
      [req.params.id, req.params.locationId, req.tenantId]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'BRANCH_ACCESS_NOT_FOUND' });
    return res.json({ message: 'Branch access removed.' });
  } catch (err) {
    console.error('[staff/branches/remove]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

module.exports = router;
