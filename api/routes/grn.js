// routes/grn.js
// Phase 7 — Goods Received Notes
// Owner-only per §5 permission matrix.
//
// POST /api/grn       — create GRN, write stock, update PO status
// GET  /api/grn       — list GRNs with supplier and location
// GET  /api/grn/:id   — full GRN with items
//
// §11 Purchase Flow:
//   GRN save → grn_items rows → writeStockMovement('grn_intake', +received_qty)
//   If po_id set → update purchase_order_items.received_qty
//               → recompute purchase_orders.status
//
// po_id is nullable — GRN can be ad-hoc without a PO (§11 spec note).
// All queries include WHERE tenant_id = $1.

const router         = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const db             = require('../db');
const tenantAuth     = require('../middleware/tenantAuth');
const authorizeRoles = require('../middleware/authorizeRoles');
const { writeStockMovement } = require('../services/stockLedger');

// ─────────────────────────────────────────────────────────────────────────────
// Helper: recompute and UPDATE purchase_orders.status after a GRN is saved.
// Called inside an existing transaction.
//
// Logic:
//   fully_received     — every item's received_qty >= ordered_qty
//   partially_received — at least one item has received_qty > 0
//   pending            — no items have any received_qty
// ─────────────────────────────────────────────────────────────────────────────
async function recomputePoStatus(client, poId) {
  const { rows } = await client.query(
    `SELECT ordered_qty, received_qty FROM purchase_order_items WHERE po_id = $1`,
    [poId]
  );

  if (rows.length === 0) return; // empty PO — nothing to update

  const allReceived  = rows.every(r => Number(r.received_qty) >= Number(r.ordered_qty));
  const someReceived = rows.some(r  => Number(r.received_qty) > 0);

  const newStatus = allReceived  ? 'fully_received'
                  : someReceived ? 'partially_received'
                  :                'pending';

  await client.query(
    `UPDATE purchase_orders SET status = $1 WHERE id = $2`,
    [newStatus, poId]
  );
}

// ── POST /api/grn ─────────────────────────────────────────────────────────────
// Body: { po_id?, supplier_id, location_id, grn_number, received_date,
//          bill_reference?, notes?,
//          items: [{ product_id, received_qty, unit_cost }] }
router.post('/', tenantAuth, authorizeRoles('owner', 'staff'), async (req, res) => {
  const {
    po_id          = null,
    supplier_id,
    location_id,
    grn_number,
    received_date,
    bill_reference = null,
    notes          = null,
    items,
  } = req.body;

  if (!supplier_id || !location_id || !grn_number || !received_date ||
      !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({
      error:    'MISSING_FIELDS',
      required: ['supplier_id', 'location_id', 'grn_number', 'received_date', 'items'],
    });
  }

  for (const item of items) {
    if (!item.product_id || item.received_qty == null || item.unit_cost == null) {
      return res.status(400).json({
        error:   'INVALID_ITEM',
        message: 'Each item requires product_id, received_qty, and unit_cost',
        item,
      });
    }
    if (Number(item.received_qty) <= 0) {
      return res.status(400).json({
        error:   'INVALID_ITEM',
        message: 'received_qty must be positive',
        item,
      });
    }
  }

  // Confirm supplier belongs to this tenant
  const { rows: supRows } = await db.query(
    'SELECT id FROM suppliers WHERE id = $1 AND tenant_id = $2',
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

  // If po_id provided, confirm it belongs to this tenant
  if (po_id) {
    const { rows: poRows } = await db.query(
      'SELECT id FROM purchase_orders WHERE id = $1 AND tenant_id = $2',
      [po_id, req.tenantId]
    );
    if (poRows.length === 0) {
      return res.status(404).json({ error: 'PO_NOT_FOUND' });
    }
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // ── 1. Insert goods_received_notes row ───────────────────────────────
    const grnId = uuidv4();
    const { rows: grnRows } = await client.query(
      `INSERT INTO goods_received_notes
         (id, tenant_id, location_id, po_id, supplier_id, grn_number,
          received_date, bill_reference, notes, staff_id, cashier_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [grnId, req.tenantId, location_id, po_id, supplier_id,
       grn_number.trim(), received_date, bill_reference, notes,
       req.userRole !== 'cashier' ? req.staffId  : null,
       req.userRole === 'cashier' ? req.cashierId : null]
    );

    const savedItems = [];

    for (const item of items) {
      const receivedQty = Number(item.received_qty);
      const unitCost    = Number(item.unit_cost);

      // ── 2. Insert grn_items row ─────────────────────────────────────────
      const { rows: grnItemRows } = await client.query(
        `INSERT INTO grn_items (id, grn_id, product_id, received_qty, unit_cost)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [uuidv4(), grnId, item.product_id, receivedQty, unitCost]
      );
      savedItems.push(grnItemRows[0]);

      // ── 3. writeStockMovement — grn_intake (positive delta) ────────────
      await writeStockMovement(client, {
        tenant_id:               req.tenantId,
        location_id,
        product_id:              item.product_id,
        quantity_delta:          +receivedQty,
        movement_type:           'grn_intake',
        associated_reference_id: grnId,
        notes:                   `GRN intake — ${grn_number}`,
        staff_id:                req.userRole !== 'cashier' ? req.staffId  : null,
        cashier_id:              req.userRole === 'cashier' ? req.cashierId : null,
      });

      // ── 4. Update PO item received_qty if po_id is set ─────────────────
      // Over-receiving is allowed (not blocked) — informational only per spec.
      if (po_id) {
        await client.query(
          `UPDATE purchase_order_items
           SET received_qty = received_qty + $1
           WHERE po_id = $2 AND product_id = $3`,
          [receivedQty, po_id, item.product_id]
        );
      }
    }

    // ── 5. Recompute PO status if linked ──────────────────────────────────
    if (po_id) {
      await recomputePoStatus(client, po_id);
    }

    await client.query('COMMIT');

    // Fetch updated PO status to include in response
    let poStatus = null;
    if (po_id) {
      const { rows: poRows } = await db.query(
        'SELECT status FROM purchase_orders WHERE id = $1',
        [po_id]
      );
      poStatus = poRows[0]?.status;
    }

    return res.status(201).json({
      grn: {
        ...grnRows[0],
        items: savedItems,
      },
      ...(po_id && { po_status_updated_to: poStatus }),
    });

  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23503') {
      return res.status(422).json({ error: 'INVALID_REFERENCE', detail: err.detail });
    }
    console.error('[grn/create]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  } finally {
    client.release();
  }
});

// ── GET /api/grn ──────────────────────────────────────────────────────────────
// Query params: ?po_id=<uuid>  ?supplier_id=<uuid>  ?location_id=<uuid>
router.get('/', tenantAuth, authorizeRoles('owner', 'staff'), async (req, res) => {
  const { po_id, supplier_id, location_id } = req.query;
  const params = [req.tenantId];
  let   idx    = 2;
  let   filter = '';

  if (po_id)       { filter += ` AND g.po_id       = $${idx++}`; params.push(po_id); }
  if (supplier_id) { filter += ` AND g.supplier_id = $${idx++}`; params.push(supplier_id); }
  if (location_id) { filter += ` AND g.location_id = $${idx++}`; params.push(location_id); }

  try {
    const { rows } = await db.query(
      `SELECT
         g.id, g.grn_number, g.received_date, g.bill_reference,
         g.po_id, g.created_at,
         s.supplier_name,
         l.location_name, l.location_code,
         COUNT(gi.id)::int AS item_count,
         COALESCE(SUM(gi.received_qty * gi.unit_cost), 0) AS total_grn_value
       FROM goods_received_notes g
       JOIN suppliers s ON g.supplier_id = s.id
       JOIN locations l ON g.location_id = l.id
       LEFT JOIN grn_items gi ON gi.grn_id = g.id
       WHERE g.tenant_id = $1 ${filter}
       GROUP BY g.id, s.supplier_name, l.location_name, l.location_code
       ORDER BY g.created_at DESC`,
      params
    );
    return res.json({ grns: rows });
  } catch (err) {
    console.error('[grn/list]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ── GET /api/grn/:id ──────────────────────────────────────────────────────────
router.get('/:id', tenantAuth, authorizeRoles('owner', 'staff'), async (req, res) => {
  try {
    const { rows: grnRows } = await db.query(
      `SELECT
         g.*,
         s.supplier_name, s.pan_number AS supplier_pan,
         l.location_name, l.location_code
       FROM goods_received_notes g
       JOIN suppliers s ON g.supplier_id = s.id
       JOIN locations l ON g.location_id = l.id
       WHERE g.id = $1 AND g.tenant_id = $2`,
      [req.params.id, req.tenantId]
    );
    if (grnRows.length === 0) return res.status(404).json({ error: 'GRN_NOT_FOUND' });

    const { rows: itemRows } = await db.query(
      `SELECT gi.*, p.name AS product_name, p.mrp
       FROM grn_items gi
       JOIN products p ON gi.product_id = p.id
       WHERE gi.grn_id = $1
       ORDER BY gi.id ASC`,
      [req.params.id]
    );

    return res.json({
      grn: {
        ...grnRows[0],
        items: itemRows,
      },
    });
  } catch (err) {
    console.error('[grn/get]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

module.exports = router;
