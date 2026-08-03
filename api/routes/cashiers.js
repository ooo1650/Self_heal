// routes/cashiers.js
// Cashier management — PIN-only POS actors, separate from staff auth.
// Owner-only per §5 permission matrix.
//
// POST  /api/cashiers              — create cashier with PIN
// GET   /api/cashiers              — list all cashiers for tenant
// GET   /api/cashiers/:id          — single cashier
// PUT   /api/cashiers/:id          — update full_name, location_id, max_item_discount_pct
// PATCH /api/cashiers/:id/status   — activate / deactivate (soft delete)
// POST  /api/cashiers/:id/pin      — set or reset PIN
//
// GET   /api/cashiers/active-pinned — list active cashiers with a PIN set,
//         for the POS switch-in picker (any authenticated actor may call this)
//
// Notes:
//   - Cashiers have NO email, NO password, NO JWT login.
//   - Authentication is PIN-only, used only for POS switch-in from an
//     already-authenticated owner/staff session.
//   - Cashiers are NEVER hard-deleted to preserve audit trails.
//   - PIN hashing uses bcrypt cost factor 12.
//   - All queries include WHERE tenant_id = $1.

const router         = require('express').Router();
const bcrypt         = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const db             = require('../db');
const tenantAuth     = require('../middleware/tenantAuth');
const authorizeRoles = require('../middleware/authorizeRoles');

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/cashiers/active-pinned
// Must be registered BEFORE /:id to avoid Express matching 'active-pinned' as id.
// List active cashiers that have a PIN set, for the POS switch-in picker.
// Any authenticated actor (owner, staff, cashier) may call this.
// Returns: { cashiers: [{ id, full_name }] }
// ─────────────────────────────────────────────────────────────────────────────
router.get('/active-pinned', tenantAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, full_name
       FROM cashiers
       WHERE tenant_id = $1
         AND is_active = true
       ORDER BY full_name ASC`,
      [req.tenantId]
    );
    return res.json({ cashiers: rows });
  } catch (err) {
    console.error('[cashiers/active-pinned]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/cashiers
// Create a cashier with a PIN. Owner and all staff (full + limited) allowed.
//
// Body: { full_name, pin, location_id?, max_item_discount_pct? }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/', tenantAuth, authorizeRoles('owner', 'staff'), async (req, res) => {
  const {
    full_name,
    pin,
    location_id           = null,
    max_item_discount_pct = 10.00,
  } = req.body;

  if (!full_name || !full_name.trim()) {
    return res.status(400).json({ error: 'MISSING_FIELDS', required: ['full_name'] });
  }

  if (!pin || !/^\d{4}$/.test(String(pin))) {
    return res.status(400).json({
      error:   'INVALID_PIN',
      message: 'PIN must be exactly 4 numeric digits (0000–9999)',
    });
  }

  const discountCeiling = Number(max_item_discount_pct);
  if (!isFinite(discountCeiling) || discountCeiling < 0 || discountCeiling > 100) {
    return res.status(400).json({
      error:   'INVALID_DISCOUNT_CEILING',
      message: 'max_item_discount_pct must be between 0 and 100',
    });
  }

  if (location_id) {
    const { rows: locRows } = await db.query(
      'SELECT id FROM locations WHERE id = $1 AND tenant_id = $2',
      [location_id, req.tenantId]
    );
    if (locRows.length === 0) {
      return res.status(404).json({ error: 'LOCATION_NOT_FOUND' });
    }
  }

  try {
    const cashierId = uuidv4();
    const pinHash   = await bcrypt.hash(String(pin), 12);

    const { rows } = await db.query(
      `INSERT INTO cashiers
         (id, tenant_id, location_id, full_name, pin_hash,
          max_item_discount_pct, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, true)
       RETURNING id, tenant_id, location_id, full_name,
                 max_item_discount_pct, is_active, created_at`,
      [cashierId, req.tenantId, location_id, full_name.trim(), pinHash, discountCeiling]
    );

    return res.status(201).json({ cashier: rows[0] });
  } catch (err) {
    console.error('[cashiers/create]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/cashiers
// List all cashiers for this tenant. ?active=true|false to filter.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', tenantAuth, authorizeRoles('owner', 'staff'), async (req, res) => {
  const { active } = req.query;
  const params = [req.tenantId];
  let   filter = '';

  if (active === 'true')  filter = ' AND c.is_active = true';
  if (active === 'false') filter = ' AND c.is_active = false';

  try {
    const { rows } = await db.query(
      `SELECT c.id, c.full_name, c.max_item_discount_pct,
              c.is_active, c.created_at,
              c.location_id, l.location_name, l.location_code,
              (c.pin_hash IS NOT NULL) AS pin_set
       FROM cashiers c
       LEFT JOIN locations l ON l.id = c.location_id
       WHERE c.tenant_id = $1 ${filter}
       ORDER BY c.full_name ASC`,
      params
    );
    return res.json({ cashiers: rows });
  } catch (err) {
    console.error('[cashiers/list]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/cashiers/:id
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:id', tenantAuth, authorizeRoles('owner', 'staff'), async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT c.id, c.full_name, c.max_item_discount_pct,
              c.is_active, c.created_at,
              c.location_id, l.location_name, l.location_code,
              (c.pin_hash IS NOT NULL) AS pin_set
       FROM cashiers c
       LEFT JOIN locations l ON l.id = c.location_id
       WHERE c.id = $1 AND c.tenant_id = $2`,
      [req.params.id, req.tenantId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'CASHIER_NOT_FOUND' });
    return res.json({ cashier: rows[0] });
  } catch (err) {
    console.error('[cashiers/get]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/cashiers/:id
// Update full_name, location_id, or max_item_discount_pct.
// Body: any subset of { full_name, location_id, max_item_discount_pct }
// ─────────────────────────────────────────────────────────────────────────────
router.put('/:id', tenantAuth, authorizeRoles('owner', 'staff'), async (req, res) => {
  const { rows: existing } = await db.query(
    'SELECT id FROM cashiers WHERE id = $1 AND tenant_id = $2',
    [req.params.id, req.tenantId]
  );
  if (existing.length === 0) return res.status(404).json({ error: 'CASHIER_NOT_FOUND' });

  const { full_name, location_id, max_item_discount_pct } = req.body;

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
      return res.status(400).json({
        error:   'INVALID_DISCOUNT_CEILING',
        message: 'max_item_discount_pct must be between 0 and 100',
      });
    }
    fields.push(`max_item_discount_pct = $${idx++}`);
    values.push(ceiling);
  }

  if (fields.length === 0) {
    return res.status(400).json({ error: 'NO_FIELDS_TO_UPDATE' });
  }

  values.push(req.params.id, req.tenantId);
  try {
    const { rows } = await db.query(
      `UPDATE cashiers SET ${fields.join(', ')}
       WHERE id = $${idx} AND tenant_id = $${idx + 1}
       RETURNING id, full_name, max_item_discount_pct,
                 is_active, location_id, created_at,
                 (pin_hash IS NOT NULL) AS pin_set`,
      values
    );
    return res.json({ cashier: rows[0] });
  } catch (err) {
    console.error('[cashiers/update]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/cashiers/:id/status
// Activate or deactivate. Never hard-deletes (audit trail preservation).
// Body: { is_active: true | false }
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/:id/status', tenantAuth, authorizeRoles('owner', 'staff'), async (req, res) => {
  const { is_active } = req.body;

  if (typeof is_active !== 'boolean') {
    return res.status(400).json({
      error:    'MISSING_FIELDS',
      required: ['is_active (boolean)'],
    });
  }

  try {
    const { rows } = await db.query(
      `UPDATE cashiers SET is_active = $1
       WHERE id = $2 AND tenant_id = $3
       RETURNING id, full_name, is_active`,
      [is_active, req.params.id, req.tenantId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'CASHIER_NOT_FOUND' });
    return res.json(rows[0]);
  } catch (err) {
    console.error('[cashiers/status]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/cashiers/:id/pin
// Owner sets or resets a cashier's 4-digit PIN.
// Body: { pin }  — must be exactly 4 numeric digits.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:id/pin', tenantAuth, authorizeRoles('owner', 'staff'), async (req, res) => {
  const { pin } = req.body;

  if (!pin || !/^\d{4}$/.test(String(pin))) {
    return res.status(400).json({
      error:   'INVALID_PIN',
      message: 'PIN must be exactly 4 numeric digits (0000–9999)',
    });
  }

  const { rows } = await db.query(
    'SELECT id FROM cashiers WHERE id = $1 AND tenant_id = $2',
    [req.params.id, req.tenantId]
  );
  if (rows.length === 0) return res.status(404).json({ error: 'CASHIER_NOT_FOUND' });

  try {
    const pinHash = await bcrypt.hash(String(pin), 12);
    await db.query(
      `UPDATE cashiers
       SET pin_hash = $1, pin_attempts = 0, pin_locked_until = NULL
       WHERE id = $2 AND tenant_id = $3`,
      [pinHash, req.params.id, req.tenantId]
    );
    return res.json({ message: 'PIN set successfully' });
  } catch (err) {
    console.error('[cashiers/pin]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

module.exports = router;
