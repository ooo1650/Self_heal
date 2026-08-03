// routes/inventory.js
// Phase 4 — Stock ledger writes and balance queries
//
// POST /api/inventory/opening-stock        — set opening stock for a product  [owner]
// GET  /api/inventory                      — full stock balance list           [owner]
// GET  /api/inventory/:productId           — one product across all locations  [owner]
//
// All queries include WHERE tenant_id = $1.
// writeStockMovement is called inside a transaction so ledger + balance
// are always updated together.

const router         = require('express').Router();
const db             = require('../db');
const tenantAuth     = require('../middleware/tenantAuth');
const authorizeRoles = require('../middleware/authorizeRoles');
const { writeStockMovement } = require('../services/stockLedger');

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/inventory/opening-stock
// Records the initial stock quantity for a product at a location.
// Uses movement_type = 'opening_stock'.
// Calling this multiple times adds to stock — for corrections use
// manual_adjustment (also supported by writeStockMovement in later phases).
//
// Body: { product_id, location_id, quantity, notes? }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/opening-stock', tenantAuth, authorizeRoles('owner', 'staff'), async (req, res) => {
  const {
    product_id,
    location_id,
    quantity,
    notes = null,
  } = req.body;

  if (!product_id || !location_id || quantity == null) {
    return res.status(400).json({
      error:    'MISSING_FIELDS',
      required: ['product_id', 'location_id', 'quantity'],
    });
  }

  const qty = Number(quantity);
  if (!isFinite(qty) || qty <= 0) {
    return res.status(400).json({
      error:   'INVALID_QUANTITY',
      message: 'quantity must be a positive number',
    });
  }

  // Verify product belongs to this tenant before touching ledger
  const { rows: productRows } = await db.query(
    'SELECT id, name FROM products WHERE id = $1 AND tenant_id = $2',
    [product_id, req.tenantId]
  );
  if (productRows.length === 0) {
    return res.status(404).json({ error: 'PRODUCT_NOT_FOUND' });
  }

  // Verify location belongs to this tenant
  const { rows: locationRows } = await db.query(
    'SELECT id FROM locations WHERE id = $1 AND tenant_id = $2',
    [location_id, req.tenantId]
  );
  if (locationRows.length === 0) {
    return res.status(404).json({ error: 'LOCATION_NOT_FOUND' });
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const ledgerRow = await writeStockMovement(client, {
      tenant_id:    req.tenantId,
      location_id,
      product_id,
      quantity_delta: qty,           // positive — stock coming in
      movement_type:  'opening_stock',
      notes,
      staff_id:     req.userRole !== 'cashier' ? req.staffId  : null,
      cashier_id:   req.userRole === 'cashier' ? req.cashierId : null,
    });

    await client.query('COMMIT');

    return res.status(201).json({
      message:      'Opening stock recorded',
      product_name: productRows[0].name,
      ledger_id:    ledgerRow.id,
      quantity:     qty,
      location_id,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[inventory/opening-stock]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  } finally {
    client.release();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/inventory
// Returns stock_balance joined with product details for this tenant.
// Optional query params:
//   ?location_id=<uuid>  — filter to a single branch
//   ?low_stock=true      — only rows at or below low_stock_alert_qty
//
// Response: { inventory: [ { product_id, product_name, mrp, location_id,
//               location_name, stock_on_hand, low_stock_alert_qty,
//               is_low_stock, is_negative_stock, updated_at } ] }
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', tenantAuth, authorizeRoles('owner', 'staff'), async (req, res) => {
  const { location_id, low_stock } = req.query;

  try {
    const params = [req.tenantId];
    let   idx    = 2;

    let query = `
      SELECT
        sb.product_id,
        p.name                                          AS product_name,
        p.mrp,
        p.base_cost_price,
        p.low_stock_alert_qty,
        p.is_active                                     AS product_is_active,
        sb.location_id,
        l.location_name,
        l.location_code,
        sb.stock_on_hand,
        sb.stock_on_hand < 0                            AS is_negative_stock,
        sb.stock_on_hand <= p.low_stock_alert_qty       AS is_low_stock,
        sb.updated_at
      FROM stock_balance sb
      JOIN products  p ON p.id = sb.product_id
      JOIN locations l ON l.id = sb.location_id
      WHERE sb.tenant_id = $1
    `;

    if (location_id) {
      query += ` AND sb.location_id = $${idx++}`;
      params.push(location_id);
    }

    if (low_stock === 'true') {
      query += ` AND sb.stock_on_hand <= p.low_stock_alert_qty`;
    }

    query += ' ORDER BY p.name ASC, l.location_name ASC';

    const { rows } = await db.query(query, params);

    return res.json({ inventory: rows });
  } catch (err) {
    console.error('[inventory/list]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/inventory/:productId
// Returns stock_on_hand for a single product across every location
// that has a balance row for this tenant.
//
// Response: { product_id, product_name, locations: [ { location_id,
//               location_name, location_code, stock_on_hand,
//               is_negative_stock, is_low_stock, updated_at } ] }
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:productId', tenantAuth, authorizeRoles('owner', 'staff'), async (req, res) => {
  const { productId } = req.params;

  // Confirm product belongs to this tenant
  const { rows: productRows } = await db.query(
    `SELECT id, name, low_stock_alert_qty
     FROM products
     WHERE id = $1 AND tenant_id = $2`,
    [productId, req.tenantId]
  );

  if (productRows.length === 0) {
    return res.status(404).json({ error: 'PRODUCT_NOT_FOUND' });
  }

  const product = productRows[0];

  try {
    const { rows } = await db.query(
      `SELECT
         sb.location_id,
         l.location_name,
         l.location_code,
         sb.stock_on_hand,
         sb.stock_on_hand < 0                          AS is_negative_stock,
         sb.stock_on_hand <= p.low_stock_alert_qty     AS is_low_stock,
         sb.updated_at
       FROM stock_balance sb
       JOIN locations l ON l.id = sb.location_id
       JOIN products  p ON p.id = sb.product_id
       WHERE sb.product_id = $1
         AND sb.tenant_id  = $2
       ORDER BY l.location_name ASC`,
      [productId, req.tenantId]
    );

    return res.json({
      product_id:         product.id,
      product_name:       product.name,
      low_stock_alert_qty: product.low_stock_alert_qty,
      locations:          rows,
    });
  } catch (err) {
    console.error('[inventory/product]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/inventory/adjust
// Phase 15d — Batch manual stock adjustment (oversell resolution + corrections).
// Owner only.
//
// Body: [{ product_id, location_id, new_quantity, notes? }]
//
// For each item:
//   1. Fetch current stock_on_hand from stock_balance
//   2. Calculate delta = new_quantity - current_stock_on_hand
//   3. Skip rows where delta === 0
//   4. Call writeStockMovement(movement_type='manual_adjustment')
//
// Returns: [{ product_id, location_id, old_stock, new_stock, delta }]
// ─────────────────────────────────────────────────────────────────────────────
router.post('/adjust', tenantAuth, authorizeRoles('owner', 'staff'), async (req, res) => {
  const items = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({
      error:   'MISSING_FIELDS',
      message: 'Body must be a non-empty array of { product_id, location_id, new_quantity }',
    });
  }

  // Validate each row before opening a transaction
  for (const item of items) {
    if (!item.product_id || !item.location_id || item.new_quantity == null) {
      return res.status(400).json({
        error:   'INVALID_ITEM',
        message: 'Each item requires product_id, location_id, and new_quantity',
        item,
      });
    }
    const qty = Number(item.new_quantity);
    if (!isFinite(qty)) {
      return res.status(400).json({
        error:   'INVALID_QUANTITY',
        message: `new_quantity must be a finite number, got "${item.new_quantity}"`,
      });
    }
    // Verify product + location belong to this tenant
    const { rows: pRows } = await db.query(
      'SELECT id FROM products WHERE id = $1 AND tenant_id = $2',
      [item.product_id, req.tenantId]
    );
    if (pRows.length === 0) {
      return res.status(422).json({ error: 'PRODUCT_NOT_FOUND', product_id: item.product_id });
    }
    const { rows: lRows } = await db.query(
      'SELECT id FROM locations WHERE id = $1 AND tenant_id = $2',
      [item.location_id, req.tenantId]
    );
    if (lRows.length === 0) {
      return res.status(422).json({ error: 'LOCATION_NOT_FOUND', location_id: item.location_id });
    }
  }

  const client = await db.connect();
  const results = [];

  try {
    await client.query('BEGIN');

    for (const item of items) {
      const newQty = Number(item.new_quantity);

      // Fetch current stock — default 0 if no balance row exists yet
      const { rows: balRows } = await client.query(
        `SELECT COALESCE(stock_on_hand, 0) AS stock_on_hand
         FROM stock_balance
         WHERE product_id = $1 AND location_id = $2 AND tenant_id = $3`,
        [item.product_id, item.location_id, req.tenantId]
      );
      const oldStock = balRows.length > 0 ? Number(balRows[0].stock_on_hand) : 0;
      const delta    = parseFloat((newQty - oldStock).toFixed(3));

      // Skip if no change
      if (delta === 0) {
        results.push({ product_id: item.product_id, location_id: item.location_id,
                        old_stock: oldStock, new_stock: newQty, delta: 0, skipped: true });
        continue;
      }

      await writeStockMovement(client, {
        tenant_id:    req.tenantId,
        location_id:  item.location_id,
        product_id:   item.product_id,
        quantity_delta: delta,
        movement_type:  'manual_adjustment',
        notes:          item.notes ?? `Manual adjustment: ${oldStock} → ${newQty}`,
        staff_id:     req.userRole !== 'cashier' ? req.staffId  : null,
        cashier_id:   req.userRole === 'cashier' ? req.cashierId : null,
      });

      results.push({
        product_id:  item.product_id,
        location_id: item.location_id,
        old_stock:   oldStock,
        new_stock:   newQty,
        delta,
      });
    }

    await client.query('COMMIT');
    return res.json({ adjusted: results });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[inventory/adjust]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  } finally {
    client.release();
  }
});

module.exports = router;
