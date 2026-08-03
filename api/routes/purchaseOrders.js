// routes/purchaseOrders.js
// Phase 7 — Purchase Order management
// Owner-only per §5 permission matrix.
//
// POST /api/purchase-orders           — create PO + items in one transaction
// GET  /api/purchase-orders           — list with supplier name, status, item count
// GET  /api/purchase-orders/:id       — full PO with items including received_qty
//
// All queries include WHERE tenant_id = $1.

const router         = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const db             = require('../db');
const tenantAuth     = require('../middleware/tenantAuth');
const authorizeRoles = require('../middleware/authorizeRoles');

// ── POST /api/purchase-orders ─────────────────────────────────────────────────
// Body: { supplier_id, location_id, po_number, expected_date?, notes?,
//          items: [{ product_id, ordered_qty, unit_cost }] }
router.post('/', tenantAuth, authorizeRoles('owner', 'staff'), async (req, res) => {
  const {
    supplier_id,
    location_id,
    po_number,
    expected_date = null,
    notes         = null,
    items,
  } = req.body;

  if (!supplier_id || !location_id || !po_number || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({
      error:    'MISSING_FIELDS',
      required: ['supplier_id', 'location_id', 'po_number', 'items'],
    });
  }

  // Validate all items have required fields before opening a transaction
  for (const item of items) {
    if (!item.product_id || item.ordered_qty == null || item.unit_cost == null) {
      return res.status(400).json({
        error:   'INVALID_ITEM',
        message: 'Each item requires product_id, ordered_qty, and unit_cost',
        item,
      });
    }
  }

  // Confirm supplier belongs to this tenant
  const { rows: supRows } = await db.query(
    'SELECT id FROM suppliers WHERE id = $1 AND tenant_id = $2 AND is_active = true',
    [supplier_id, req.tenantId]
  );
  if (supRows.length === 0) {
    return res.status(404).json({ error: 'SUPPLIER_NOT_FOUND' });
  }

  // Confirm location belongs to this tenant
  const { rows: locRows } = await db.query(
    'SELECT id FROM locations WHERE id = $1 AND tenant_id = $2',
    [location_id, req.tenantId]
  );
  if (locRows.length === 0) {
    return res.status(404).json({ error: 'LOCATION_NOT_FOUND' });
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const poId = uuidv4();
    const { rows: poRows } = await client.query(
      `INSERT INTO purchase_orders
         (id, tenant_id, location_id, supplier_id, po_number, status,
          expected_date, notes, staff_id, cashier_id)
       VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, $8, $9)
       RETURNING *`,
      [poId, req.tenantId, location_id, supplier_id, po_number.trim(),
       expected_date, notes,
       req.userRole !== 'cashier' ? req.staffId  : null,
       req.userRole === 'cashier' ? req.cashierId : null]
    );

    const savedItems = [];
    for (const item of items) {
      const { rows: itemRows } = await client.query(
        `INSERT INTO purchase_order_items
           (id, po_id, product_id, ordered_qty, received_qty, unit_cost)
         VALUES ($1, $2, $3, $4, 0.000, $5)
         RETURNING *`,
        [uuidv4(), poId, item.product_id, Number(item.ordered_qty), Number(item.unit_cost)]
      );
      savedItems.push(itemRows[0]);
    }

    await client.query('COMMIT');

    return res.status(201).json({
      purchase_order: {
        ...poRows[0],
        items: savedItems,
      },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23503') {
      return res.status(422).json({ error: 'INVALID_REFERENCE', detail: err.detail });
    }
    console.error('[purchase-orders/create]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  } finally {
    client.release();
  }
});

// ── GET /api/purchase-orders ──────────────────────────────────────────────────
// Query params: ?status=pending|partially_received|fully_received|cancelled
//               ?supplier_id=<uuid>
//               ?location_id=<uuid>
router.get('/', tenantAuth, authorizeRoles('owner', 'staff'), async (req, res) => {
  const { status, supplier_id, location_id } = req.query;
  const params = [req.tenantId];
  let   idx    = 2;
  let   filter = '';

  const VALID_STATUSES = ['pending', 'partially_received', 'fully_received', 'cancelled'];
  if (status && VALID_STATUSES.includes(status)) {
    filter += ` AND po.status = $${idx++}`;
    params.push(status);
  }
  if (supplier_id) { filter += ` AND po.supplier_id = $${idx++}`; params.push(supplier_id); }
  if (location_id) { filter += ` AND po.location_id = $${idx++}`; params.push(location_id); }

  try {
    const { rows } = await db.query(
      `SELECT
         po.id, po.po_number, po.status, po.expected_date, po.created_at,
         po.location_id, po.supplier_id,
         s.supplier_name,
         l.location_name, l.location_code,
         COUNT(poi.id)::int AS item_count,
         COALESCE(SUM(poi.ordered_qty * poi.unit_cost), 0) AS total_order_value
       FROM purchase_orders po
       JOIN suppliers  s   ON po.supplier_id  = s.id
       JOIN locations  l   ON po.location_id  = l.id
       LEFT JOIN purchase_order_items poi ON poi.po_id = po.id
       WHERE po.tenant_id = $1 ${filter}
       GROUP BY po.id, s.supplier_name, l.location_name, l.location_code
       ORDER BY po.created_at DESC`,
      params
    );
    return res.json({ purchase_orders: rows });
  } catch (err) {
    console.error('[purchase-orders/list]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ── GET /api/purchase-orders/:id ─────────────────────────────────────────────
// Returns full PO with all items including received_qty.
router.get('/:id', tenantAuth, authorizeRoles('owner', 'staff'), async (req, res) => {
  try {
    const { rows: poRows } = await db.query(
      `SELECT
         po.*,
         s.supplier_name, s.pan_number AS supplier_pan,
         s.contact_person, s.phone AS supplier_phone,
         l.location_name, l.location_code
       FROM purchase_orders po
       JOIN suppliers s ON po.supplier_id = s.id
       JOIN locations l ON po.location_id = l.id
       WHERE po.id = $1 AND po.tenant_id = $2`,
      [req.params.id, req.tenantId]
    );
    if (poRows.length === 0) return res.status(404).json({ error: 'PO_NOT_FOUND' });

    const { rows: itemRows } = await db.query(
      `SELECT poi.*, p.name AS product_name, p.mrp
       FROM purchase_order_items poi
       JOIN products p ON poi.product_id = p.id
       WHERE poi.po_id = $1
       ORDER BY poi.id ASC`,
      [req.params.id]
    );

    return res.json({
      purchase_order: {
        ...poRows[0],
        items: itemRows,
      },
    });
  } catch (err) {
    console.error('[purchase-orders/get]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

module.exports = router;
