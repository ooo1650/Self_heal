// routes/suppliers.js
// Phase 7 — Supplier management
// Owner-only per §5 permission matrix.
//
// POST  /api/suppliers          — create supplier
// GET   /api/suppliers          — list suppliers (?active=true|false)
// GET   /api/suppliers/:id      — single supplier
// PUT   /api/suppliers/:id      — update supplier
// PATCH /api/suppliers/:id/status — activate / deactivate (soft delete)
//
// All queries include WHERE tenant_id = $1.

const router         = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const db             = require('../db');
const tenantAuth     = require('../middleware/tenantAuth');
const authorizeRoles = require('../middleware/authorizeRoles');

// ── POST /api/suppliers ───────────────────────────────────────────────────────
// Body: { supplier_name, pan_number?, contact_person?, phone?, email?, address? }
router.post('/', tenantAuth, authorizeRoles('owner', 'staff'), async (req, res) => {
  const {
    supplier_name,
    pan_number     = null,
    contact_person = null,
    phone          = null,
    email          = null,
    address        = null,
  } = req.body;

  if (!supplier_name) {
    return res.status(400).json({ error: 'MISSING_FIELDS', required: ['supplier_name'] });
  }

  try {
    const { rows } = await db.query(
      `INSERT INTO suppliers
         (id, tenant_id, supplier_name, pan_number, contact_person, phone, email, address, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)
       RETURNING *`,
      [uuidv4(), req.tenantId, supplier_name.trim(), pan_number, contact_person, phone, email, address]
    );
    return res.status(201).json({ supplier: rows[0] });
  } catch (err) {
    console.error('[suppliers/create]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ── GET /api/suppliers ────────────────────────────────────────────────────────
// Query params: ?active=true|false (default: all)
router.get('/', tenantAuth, authorizeRoles('owner', 'staff'), async (req, res) => {
  const { active } = req.query;
  const params = [req.tenantId];
  let filter = '';

  if (active === 'true')  filter = ' AND is_active = true';
  if (active === 'false') filter = ' AND is_active = false';

  try {
    const { rows } = await db.query(
      `SELECT * FROM suppliers WHERE tenant_id = $1 ${filter} ORDER BY supplier_name ASC`,
      params
    );
    return res.json({ suppliers: rows });
  } catch (err) {
    console.error('[suppliers/list]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ── GET /api/suppliers/:id ────────────────────────────────────────────────────
router.get('/:id', tenantAuth, authorizeRoles('owner', 'staff'), async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM suppliers WHERE id = $1 AND tenant_id = $2',
      [req.params.id, req.tenantId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'SUPPLIER_NOT_FOUND' });
    return res.json({ supplier: rows[0] });
  } catch (err) {
    console.error('[suppliers/get]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ── PUT /api/suppliers/:id ────────────────────────────────────────────────────
// Body: any subset of { supplier_name, pan_number, contact_person, phone, email, address }
router.put('/:id', tenantAuth, authorizeRoles('owner', 'staff'), async (req, res) => {
  const { supplier_name, pan_number, contact_person, phone, email, address } = req.body;

  const fields = [];
  const values = [];
  let   idx    = 1;

  if (supplier_name  != null) { fields.push(`supplier_name = $${idx++}`);  values.push(supplier_name.trim()); }
  if (pan_number     !== undefined) { fields.push(`pan_number = $${idx++}`);     values.push(pan_number); }
  if (contact_person !== undefined) { fields.push(`contact_person = $${idx++}`); values.push(contact_person); }
  if (phone          !== undefined) { fields.push(`phone = $${idx++}`);          values.push(phone); }
  if (email          !== undefined) { fields.push(`email = $${idx++}`);          values.push(email); }
  if (address        !== undefined) { fields.push(`address = $${idx++}`);        values.push(address); }

  if (fields.length === 0) {
    return res.status(400).json({ error: 'NO_FIELDS_TO_UPDATE' });
  }

  values.push(req.params.id, req.tenantId);
  try {
    const { rows } = await db.query(
      `UPDATE suppliers SET ${fields.join(', ')}
       WHERE id = $${idx} AND tenant_id = $${idx + 1}
       RETURNING *`,
      values
    );
    if (rows.length === 0) return res.status(404).json({ error: 'SUPPLIER_NOT_FOUND' });
    return res.json({ supplier: rows[0] });
  } catch (err) {
    console.error('[suppliers/update]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ── PATCH /api/suppliers/:id/status ──────────────────────────────────────────
// Body: { is_active: true | false }
router.patch('/:id/status', tenantAuth, authorizeRoles('owner', 'staff'), async (req, res) => {
  const { is_active } = req.body;
  if (typeof is_active !== 'boolean') {
    return res.status(400).json({ error: 'MISSING_FIELDS', required: ['is_active (boolean)'] });
  }
  try {
    const { rows } = await db.query(
      `UPDATE suppliers SET is_active = $1 WHERE id = $2 AND tenant_id = $3
       RETURNING id, supplier_name, is_active`,
      [is_active, req.params.id, req.tenantId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'SUPPLIER_NOT_FOUND' });
    return res.json(rows[0]);
  } catch (err) {
    console.error('[suppliers/status]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

module.exports = router;
