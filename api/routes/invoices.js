// routes/invoices.js
// Phase 5b — Checkout / invoice creation
//
// POST /api/invoices/checkout  — full sale flow   [owner, cashier]
//
// Flow (§8.2, §8.3):
//   1. Idempotency check  — return existing invoice immediately if key already used
//   2. Open shift check   — cashier must have an open shift (409 NO_OPEN_SHIFT)
//   3. BEGIN transaction
//   4. Per-item: fetch server-side price/MRP/VAT, check is_active, enforce MRP guardrail
//   5. enforceDiscountCeiling — check item discounts against staff max_item_discount_pct
//   6. Line-item math: gross → item discount → taxable base → VAT → final_row_total
//   7. Bill-level discount — owner only (403 for cashier)
//   8. nextInvoiceNumber() — creates sequence on first use
//   9. INSERT invoices + invoice_items
//  10. Per-item writeStockMovement movement_type='sale', quantity_delta = -qty_sold
//  11. COMMIT
//  12. Return full invoice with line items

const router         = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const db             = require('../db');
const tenantAuth     = require('../middleware/tenantAuth');
const authorizeRoles = require('../middleware/authorizeRoles');
const { resolveVatRate }      = require('../utils/vatResolver');
const { nextInvoiceNumber }   = require('../utils/invoiceNumber');
const { writeStockMovement }  = require('../services/stockLedger');
const { formatBsDate }        = require('../utils/bsDate');

// ─────────────────────────────────────────────────────────────────────────────
// Discount ceiling enforcement — §8.2 Step 0
// Accepts enriched cart items (must already have unit_sale_price and name set).
// actorType: 'staff' | 'cashier'
// actorId:   req.staffId | req.cashierId
// Throws a structured error object on violation — caller catches and sends 422.
// ─────────────────────────────────────────────────────────────────────────────
async function enforceDiscountCeiling(client, actorType, actorId, cartItems) {
  let ceiling;

  if (actorType === 'cashier') {
    const { rows } = await client.query(
      'SELECT max_item_discount_pct FROM cashiers WHERE id = $1',
      [actorId]
    );
    if (rows.length === 0) throw { status: 401, error: 'CASHIER_NOT_FOUND' };
    ceiling = Number(rows[0].max_item_discount_pct);
  } else {
    const { rows } = await client.query(
      'SELECT max_item_discount_pct FROM staff WHERE id = $1',
      [actorId]
    );
    if (rows.length === 0) throw { status: 401, error: 'STAFF_NOT_FOUND' };
    ceiling = Number(rows[0].max_item_discount_pct);
  }

  for (const item of cartItems) {
    const discountPct  = Number(item.item_discount_pct  || 0);
    const discountFlat = Number(item.item_discount_flat || 0);
    const grossRow     = Number(item.unit_sale_price) * Number(item.quantity_sold);

    // Percentage discount check
    if (discountPct > ceiling) {
      throw {
        status:        422,
        error:         'DISCOUNT_EXCEEDS_CEILING',
        product:       item.name,
        submitted_pct: discountPct,
        allowed_max_pct: ceiling,
      };
    }

    // Flat discount converted to % and compared against ceiling
    if (grossRow > 0 && (discountFlat / grossRow * 100) > ceiling) {
      throw {
        status:          422,
        error:           'DISCOUNT_EXCEEDS_CEILING',
        product:         item.name,
        submitted_flat:  discountFlat,
        allowed_max_pct: ceiling,
      };
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/invoices/checkout
// ─────────────────────────────────────────────────────────────────────────────
router.post('/checkout', tenantAuth, authorizeRoles('owner', 'staff', 'cashier'), async (req, res) => {
  const {
    idempotency_key,
    items,
    bill_discount_flat = 0,
    bill_discount_pct  = 0,
    payment_method,
    amount_tendered    = null,
    notes              = null,
  } = req.body;

  // ── Basic input validation ────────────────────────────────────────────────
  if (!idempotency_key || !Array.isArray(items) || items.length === 0 || !payment_method) {
    return res.status(400).json({
      error:    'MISSING_FIELDS',
      required: ['idempotency_key', 'items', 'payment_method'],
    });
  }

  if (!['cash', 'qr'].includes(payment_method)) {
    return res.status(400).json({
      error:   'INVALID_PAYMENT_METHOD',
      valid:   ['cash', 'qr'],
    });
  }

  if (payment_method === 'cash' && amount_tendered == null) {
    return res.status(400).json({
      error:   'MISSING_FIELDS',
      message: 'amount_tendered is required for cash payment',
    });
  }

  // ── §8.3 Idempotency check — outside transaction, read-only ──────────────
  // If this key was already committed, return the existing invoice immediately.
  // Do not error, do not re-process.
  const { rows: existing } = await db.query(
    `SELECT i.*, json_agg(ii ORDER BY ii.id) AS items
     FROM invoices i
     LEFT JOIN invoice_items ii ON ii.invoice_id = i.id
     WHERE i.idempotency_key = $1 AND i.tenant_id = $2
     GROUP BY i.id`,
    [idempotency_key, req.tenantId]
  );
  if (existing.length > 0) {
    return res.status(200).json({
      idempotent:  true,
      invoice:     existing[0],
    });
  }

  // ── Open shift check — actor must have an open shift ────────────────────
  // Both staff and cashier actors are required to have an open shift so
  // invoices are always linked to a shift (cash_shift_id NOT NULL in schema).
  const actorType = req.userRole === 'cashier' ? 'cashier' : 'staff';
  const actorId   = actorType === 'cashier' ? req.cashierId : req.staffId;

  const shiftActorCol = actorType === 'cashier' ? 'cashier_id' : 'staff_id';
  const { rows: shiftRows } = await db.query(
    `SELECT id, location_id FROM cash_shifts
     WHERE ${shiftActorCol} = $1 AND tenant_id = $2 AND status = 'open'
     ORDER BY opened_at DESC LIMIT 1`,
    [actorId, req.tenantId]
  );

  if (shiftRows.length === 0) {
    return res.status(409).json({
      error:   'NO_OPEN_SHIFT',
      message: 'Open a cash shift before processing sales',
    });
  }

  const openShift  = shiftRows[0];
  const locationId = openShift.location_id;

  // ── Fetch location_code for invoice number ────────────────────────────────
  const { rows: locRows } = await db.query(
    'SELECT location_code FROM locations WHERE id = $1 AND tenant_id = $2',
    [locationId, req.tenantId]
  );
  if (locRows.length === 0) {
    return res.status(404).json({ error: 'LOCATION_NOT_FOUND' });
  }
  const locationCode = locRows[0].location_code;

  // ── Bill-level discount role check — §8.2 / §5 ───────────────────────────
  // Reject before entering the transaction so we never open a tx needlessly.
  const hasBillDiscount = Number(bill_discount_flat) > 0 || Number(bill_discount_pct) > 0;
  if (hasBillDiscount && req.userRole !== 'owner') {
    return res.status(403).json({
      error:   'BILL_DISCOUNT_FORBIDDEN',
      message: 'Only owners may apply bill-level discounts',
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // BEGIN TRANSACTION
  // Everything from here to COMMIT is atomic.
  // ─────────────────────────────────────────────────────────────────────────
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // ── Step 1: Fetch each product server-side ────────────────────────────
    // Price is sourced from product_barcodes if a scanned_barcode is provided,
    // otherwise falls back to products.mrp as the sale price.
    // MRP and VAT always come from the products table (authoritative).
    const enrichedItems = [];

    for (const item of items) {
      const { product_id, scanned_barcode = null, quantity_sold,
              item_discount_flat = 0, item_discount_pct = 0 } = item;

      if (!product_id || quantity_sold == null || Number(quantity_sold) <= 0) {
        throw {
          status:  400,
          error:   'INVALID_ITEM',
          message: 'Each item requires product_id and a positive quantity_sold',
          item,
        };
      }

      // Fetch product + optional barcode in one query
      let productRow, unit_sale_price, conversion_factor;

      if (scanned_barcode) {
        const { rows: bcRows } = await client.query(
          `SELECT
             p.id, p.name, p.mrp, p.vat_category, p.custom_vat_rate,
             p.is_active  AS product_active,
             pb.sale_price,
             pb.conversion_factor,
             pb.is_active AS barcode_active,
             pb.barcode   AS scanned_barcode
           FROM product_barcodes pb
           JOIN products p ON pb.product_id = p.id
           WHERE pb.barcode    = $1
             AND pb.tenant_id  = $2`,
          [scanned_barcode, req.tenantId]
        );

        if (bcRows.length === 0) {
          throw { status: 422, error: 'BARCODE_NOT_FOUND', scanned_barcode, product_id };
        }

        const bc = bcRows[0];

        // §6.4 — deactivated barcode or product at checkout
        if (!bc.barcode_active || !bc.product_active) {
          throw {
            status:  422,
            error:   'PRODUCT_DEACTIVATED',
            product: bc.name,
            message: 'Product deactivated — remove from cart',
          };
        }

        unit_sale_price   = Number(bc.sale_price);
        conversion_factor = Number(bc.conversion_factor);
        productRow        = bc;
      } else {
        // No barcode — use product MRP as sale price, conversion_factor = 1
        const { rows: pRows } = await client.query(
          `SELECT id, name, mrp, vat_category, custom_vat_rate, is_active
           FROM products
           WHERE id = $1 AND tenant_id = $2`,
          [product_id, req.tenantId]
        );

        if (pRows.length === 0) {
          throw { status: 422, error: 'PRODUCT_NOT_FOUND', product_id };
        }

        // §6.4 — deactivated product at checkout
        if (!pRows[0].is_active) {
          throw {
            status:  422,
            error:   'PRODUCT_DEACTIVATED',
            product: pRows[0].name,
            message: 'Product deactivated — remove from cart',
          };
        }

        unit_sale_price   = Number(pRows[0].mrp);
        conversion_factor = 1;
        productRow        = { ...pRows[0], id: pRows[0].id };
      }

      // §6.6 — MRP guardrail (server-side, never trust client price)
      if (unit_sale_price > Number(productRow.mrp)) {
        throw {
          status:           422,
          error:            'PRICE_EXCEEDS_MRP',
          product:          productRow.name,
          attempted_price:  unit_sale_price,
          legal_maximum:    Number(productRow.mrp),
        };
      }

      enrichedItems.push({
        product_id:        productRow.id,          // always use server-resolved id
        scanned_barcode:   productRow.scanned_barcode || null,
        name:              productRow.name,
        mrp:               Number(productRow.mrp),
        vat_category:      productRow.vat_category,
        custom_vat_rate:   productRow.custom_vat_rate,
        unit_sale_price,
        conversion_factor,
        quantity_sold:     Number(quantity_sold),
        item_discount_flat: Number(item_discount_flat),
        item_discount_pct:  Number(item_discount_pct),
      });
    }

    // ── Step 2: Enforce discount ceiling — §8.2 Step 0 ───────────────────
    await enforceDiscountCeiling(client, actorType, actorId, enrichedItems);

    // ── Step 3: Line-item calculation — §8.2 Steps 1-4 ───────────────────
    let subtotalAmount = 0;
    let totalTaxAmount = 0;

    for (const item of enrichedItems) {
      const vatRate    = resolveVatRate(item);
      const grossRow   = item.unit_sale_price * item.quantity_sold;

      // Take the larger of flat or percentage item discount
      const itemDisc   = Math.max(
        item.item_discount_flat,
        grossRow * (item.item_discount_pct / 100)
      );

      const taxableBase = grossRow - itemDisc;
      const rowTax      = taxableBase * (vatRate / 100);

      item.tax_rate_pct    = vatRate;
      item.taxable_base    = taxableBase;
      item.row_tax         = rowTax;
      item.final_row_total = parseFloat((taxableBase + rowTax).toFixed(2));

      subtotalAmount += item.final_row_total;
      totalTaxAmount += parseFloat(rowTax.toFixed(2));
    }

    subtotalAmount = parseFloat(subtotalAmount.toFixed(2));
    totalTaxAmount = parseFloat(totalTaxAmount.toFixed(2));

    // ── Step 4: Bill-level discount — §8.2, owner only ───────────────────
    const billDiscFlat = Number(bill_discount_flat);
    const billDiscPct  = Number(bill_discount_pct);
    const billDiscount = parseFloat(
      Math.max(billDiscFlat, subtotalAmount * (billDiscPct / 100)).toFixed(2)
    );
    const totalAmount  = parseFloat((subtotalAmount - billDiscount).toFixed(2));

    if (totalAmount < 0) {
      throw {
        status:  422,
        error:   'DISCOUNT_EXCEEDS_TOTAL',
        message: 'Bill discount cannot exceed the invoice total',
      };
    }

    // Cash: validate tendered amount covers the total
    let changeReturned = null;
    if (payment_method === 'cash') {
      const tendered = Number(amount_tendered);
      if (tendered < totalAmount) {
        throw {
          status:          422,
          error:           'INSUFFICIENT_TENDER',
          total_amount:    totalAmount,
          amount_tendered: tendered,
          shortfall:       parseFloat((totalAmount - tendered).toFixed(2)),
        };
      }
      changeReturned = parseFloat((tendered - totalAmount).toFixed(2));
    }

    // ── Step 5: Generate invoice number — §8.1 ────────────────────────────
    const invoiceNumber = await nextInvoiceNumber(
      client, req.tenantId, locationId, locationCode
    );

    // ── Step 6: INSERT invoices row ───────────────────────────────────────
    const invoiceId     = uuidv4();
    const paymentStatus = payment_method === 'cash' ? 'completed' : 'pending';

    const { rows: invRows } = await client.query(
      `INSERT INTO invoices (
         id, tenant_id, location_id, staff_id, cashier_id, cash_shift_id,
         invoice_number, subtotal_amount, bill_discount_flat, bill_discount_pct,
         tax_amount, total_amount, amount_tendered, change_returned,
         payment_method, payment_status, idempotency_key, is_return, notes
       ) VALUES (
         $1,  $2,  $3,  $4,  $5,  $6,
         $7,  $8,  $9,  $10,
         $11, $12, $13, $14,
         $15, $16, $17, false, $18
       ) RETURNING *`,
      [
        invoiceId,
        req.tenantId,
        locationId,
        actorType === 'staff'   ? actorId : null,   // staff_id
        actorType === 'cashier' ? actorId : null,   // cashier_id
        openShift.id,
        invoiceNumber,
        subtotalAmount,
        billDiscFlat,
        billDiscPct,
        totalTaxAmount,
        totalAmount,
        payment_method === 'cash' ? Number(amount_tendered) : null,
        changeReturned,
        payment_method,
        paymentStatus,
        idempotency_key,
        notes,
      ]
    );

    const invoice = invRows[0];

    // ── Step 7: INSERT invoice_items + writeStockMovement per item ────────
    const savedItems = [];

    for (const item of enrichedItems) {
      // Actual stock deduction = quantity_sold × conversion_factor
      // (conversion_factor > 1 for carton barcodes — §6.5)
      const stockDelta = -(item.quantity_sold * item.conversion_factor);

      // INSERT invoice_items row
      const { rows: itemRows } = await client.query(
        `INSERT INTO invoice_items (
           invoice_id, product_id, scanned_barcode,
           quantity_sold, unit_sale_price,
           item_discount_flat, item_discount_pct,
           tax_rate_pct, final_row_total, item_modifiers
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [
          invoiceId,
          item.product_id,
          item.scanned_barcode,
          item.quantity_sold,
          item.unit_sale_price,
          item.item_discount_flat,
          item.item_discount_pct,
          item.tax_rate_pct,
          item.final_row_total,
          JSON.stringify({}),
        ]
      );

      savedItems.push({
        ...itemRows[0],
        product_name: item.name,
      });

      // Stock ledger deduction — §3.4, §8
      await writeStockMovement(client, {
        tenant_id:               req.tenantId,
        location_id:             locationId,
        product_id:              item.product_id,
        quantity_delta:          stockDelta,
        movement_type:           'sale',
        associated_reference_id: invoiceId,
        notes:                   `Sale — ${invoiceNumber}`,
        staff_id:                actorType === 'staff'   ? actorId : null,
        cashier_id:              actorType === 'cashier' ? actorId : null,
      });
    }

    // ── COMMIT ────────────────────────────────────────────────────────────
    await client.query('COMMIT');

    return res.status(201).json({
      invoice: {
        ...invoice,
        items: savedItems,
      },
    });

  } catch (err) {
    await client.query('ROLLBACK');

    // Structured business-logic errors thrown inside the try block
    if (err.status) {
      return res.status(err.status).json(
        Object.fromEntries(Object.entries(err).filter(([k]) => k !== 'status'))
      );
    }

    // Idempotency key unique constraint race — another request committed
    // the same key between our read check and the INSERT
    if (err.code === '23505' && err.constraint?.includes('idempotency')) {
      const { rows: race } = await db.query(
        `SELECT i.*, json_agg(ii ORDER BY ii.id) AS items
         FROM invoices i
         LEFT JOIN invoice_items ii ON ii.invoice_id = i.id
         WHERE i.idempotency_key = $1 AND i.tenant_id = $2
         GROUP BY i.id`,
        [idempotency_key, req.tenantId]
      );
      return res.status(200).json({ idempotent: true, invoice: race[0] });
    }

    console.error('[invoices/checkout]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  } finally {
    client.release();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/invoices
// List invoices for this tenant with optional filters and pagination.
//
// Query params:
//   invoice_number  — partial match (ILIKE)
//   date_from       — ISO date string, inclusive  e.g. 2026-06-01
//   date_to         — ISO date string, inclusive  e.g. 2026-06-30
//   is_return       — 'true' | 'false'
//   payment_method  — 'cash' | 'qr'
//   location_id     — UUID
//   page            — default 1
//   limit           — default 50, max 200
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', tenantAuth, authorizeRoles('owner', 'staff', 'cashier'), async (req, res) => {
  const {
    invoice_number,
    date_from,
    date_to,
    is_return,
    payment_method,
    location_id,
    page  = 1,
    limit = 50,
  } = req.query;

  const pageNum  = Math.max(1, parseInt(page,  10) || 1);
  const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
  const offset   = (pageNum - 1) * limitNum;

  // Cashier actors may only see invoices from their own shifts — §5
  // Owner/staff see all invoices for the tenant
  const params  = [req.tenantId];
  let   idx     = 2;
  let   filters = '';

  if (req.userRole === 'cashier') {
    filters += ` AND i.cashier_id = $${idx++}`;
    params.push(req.cashierId);
  }

  if (invoice_number) {
    filters += ` AND i.invoice_number ILIKE $${idx++}`;
    params.push(`%${invoice_number}%`);
  }

  if (date_from) {
    filters += ` AND i.created_at >= $${idx++}`;
    params.push(date_from);
  }

  if (date_to) {
    // Inclusive upper bound: extend to end of day
    filters += ` AND i.created_at < ($${idx++}::date + interval '1 day')`;
    params.push(date_to);
  }

  if (is_return === 'true')  { filters += ` AND i.is_return = true`;  }
  if (is_return === 'false') { filters += ` AND i.is_return = false`; }

  if (payment_method && ['cash', 'qr'].includes(payment_method)) {
    filters += ` AND i.payment_method = $${idx++}`;
    params.push(payment_method);
  }

  if (location_id) {
    filters += ` AND i.location_id = $${idx++}`;
    params.push(location_id);
  }

  try {
    // Total count for pagination metadata
    const { rows: countRows } = await db.query(
      `SELECT COUNT(*) AS total FROM invoices i WHERE i.tenant_id = $1 ${filters}`,
      params
    );
    const total = parseInt(countRows[0].total, 10);

    // Page of results — resolve actor name from whichever column is non-null
    const { rows } = await db.query(
      `SELECT
         i.id, i.invoice_number, i.created_at, i.total_amount, i.subtotal_amount,
         i.tax_amount, i.payment_method, i.payment_status, i.is_return,
         i.original_invoice_id, i.staff_id, i.cashier_id, i.location_id,
         COALESCE(s.full_name, c.full_name) AS cashier_name,
         l.location_name, l.location_code
       FROM invoices i
       LEFT JOIN staff     s ON i.staff_id   = s.id
       LEFT JOIN cashiers  c ON i.cashier_id = c.id
       JOIN locations l ON i.location_id = l.id
       WHERE i.tenant_id = $1 ${filters}
       ORDER BY i.created_at DESC
       LIMIT ${limitNum} OFFSET ${offset}`,
      params
    );

    return res.json({
      invoices:    rows,
      pagination: {
        total,
        page:       pageNum,
        limit:      limitNum,
        total_pages: Math.ceil(total / limitNum),
      },
    });
  } catch (err) {
    console.error('[invoices/list]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/invoices/:id
// Fetch a single invoice with all its line items.
// §16.3 receipt contract — includes tenant business details and BS date so the
// receipt printer (Phase 13b) only needs to call this one endpoint.
// Cashier can only view invoices from their own shifts.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:id', tenantAuth, authorizeRoles('owner', 'staff', 'cashier'), async (req, res) => {
  try {
    const { rows: invRows } = await db.query(
      `SELECT
         i.*,
         COALESCE(s.full_name, c.full_name) AS cashier_name,
         l.location_name,
         l.location_code,
         t.business_name    AS tenant_business_name,
         t.address          AS tenant_address,
         t.phone            AS tenant_phone,
         t.logo_url         AS tenant_logo_url,
         t.pan_number       AS tenant_pan_number
       FROM invoices i
       LEFT JOIN staff     s ON i.staff_id   = s.id
       LEFT JOIN cashiers  c ON i.cashier_id = c.id
       JOIN locations l ON i.location_id = l.id
       JOIN tenants   t ON i.tenant_id   = t.id
       WHERE i.id        = $1
         AND i.tenant_id = $2`,
      [req.params.id, req.tenantId]
    );

    if (invRows.length === 0) {
      return res.status(404).json({ error: 'INVOICE_NOT_FOUND' });
    }

    const invoice = invRows[0];

    // Cashier scope — §5: cashier actors see only their own invoices
    if (req.userRole === 'cashier' && invoice.cashier_id !== req.cashierId) {
      return res.status(403).json({ error: 'FORBIDDEN' });
    }

    // Fetch line items with product name and already returned quantities
    const { rows: itemRows } = await db.query(
      `SELECT ii.*, p.name AS product_name,
              COALESCE(
                (SELECT SUM(ret.quantity_sold)
                 FROM invoices cn
                 JOIN invoice_items ret ON ret.invoice_id = cn.id
                 WHERE cn.original_invoice_id = ii.invoice_id
                   AND cn.is_return = true
                   AND ret.product_id = ii.product_id
                ), 0
              ) AS already_returned
       FROM invoice_items ii
       JOIN products p ON ii.product_id = p.id
       WHERE ii.invoice_id = $1
       ORDER BY ii.id ASC`,
      [invoice.id]
    );

    return res.json({
      invoice: {
        ...invoice,
        // BS-formatted date for receipt printing — §8.1, §16
        formatted_date: formatBsDate(new Date(invoice.created_at)),
        items: itemRows,
      },
    });
  } catch (err) {
    console.error('[invoices/get]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/invoices/:id/return
// Generate a credit note (return) against an original invoice — §9.
//
// Rules:
//   - Original invoice must belong to this tenant and is_return = false
//   - Partial returns supported — returned_qty per item validated against
//     (original quantity_sold − already returned across prior credit notes)
//   - Credit note values use ORIGINAL invoice_item prices — never current prices
//   - subtotal_amount and total_amount stored as NEGATIVE values
//   - Stock restored: +returned_qty × conversion_factor via 'sale_return'
//   - cash_shift_id = current open shift if one exists, else null
//
// Body: { idempotency_key, items: [{ invoice_item_id, returned_qty }], notes? }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:id/return', tenantAuth, authorizeRoles('owner', 'staff', 'cashier'), async (req, res) => {
  const { idempotency_key, items, notes = null } = req.body;

  if (!idempotency_key || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({
      error:    'MISSING_FIELDS',
      required: ['idempotency_key', 'items'],
    });
  }

  // ── Idempotency fast-path — same pattern as checkout ─────────────────────
  const { rows: existing } = await db.query(
    `SELECT i.*, json_agg(ii ORDER BY ii.id) AS items
     FROM invoices i
     LEFT JOIN invoice_items ii ON ii.invoice_id = i.id
     WHERE i.idempotency_key = $1 AND i.tenant_id = $2
     GROUP BY i.id`,
    [idempotency_key, req.tenantId]
  );
  if (existing.length > 0) {
    return res.status(200).json({ idempotent: true, invoice: existing[0] });
  }

  // ── Fetch and validate original invoice ──────────────────────────────────
  const { rows: origRows } = await db.query(
    `SELECT i.*,
            l.location_code, l.id AS location_id_check
     FROM invoices i
     JOIN locations l ON i.location_id = l.id
     WHERE i.id = $1 AND i.tenant_id = $2`,
    [req.params.id, req.tenantId]
  );

  if (origRows.length === 0) {
    return res.status(404).json({ error: 'INVOICE_NOT_FOUND' });
  }

  const original = origRows[0];

  if (original.is_return) {
    return res.status(422).json({
      error:   'CANNOT_RETURN_CREDIT_NOTE',
      message: 'Credit notes cannot themselves be returned',
    });
  }

  // ── Fetch original line items ─────────────────────────────────────────────
  const origItemIds = items.map(i => i.invoice_item_id);

  const { rows: origItems } = await db.query(
    `SELECT ii.id, ii.product_id, ii.scanned_barcode, ii.quantity_sold,
            ii.unit_sale_price, ii.item_discount_flat, ii.item_discount_pct,
            ii.tax_rate_pct, ii.final_row_total,
            p.name AS product_name
     FROM invoice_items ii
     JOIN products p ON ii.product_id = p.id
     WHERE ii.invoice_id = $1
       AND ii.id = ANY($2)`,
    [original.id, origItemIds]
  );

  // Index for fast lookup
  const origItemMap = {};
  for (const oi of origItems) origItemMap[oi.id] = oi;

  // ── Already-returned qty per original invoice_item ───────────────────────
  // Sum returned_qty from ALL prior credit notes that reference the same
  // original invoice — across potentially multiple partial returns.
  const { rows: alreadyReturnedRows } = await db.query(
    `SELECT ii.id                        AS original_item_id,
            COALESCE(SUM(ret.quantity_sold), 0) AS already_returned
     FROM invoice_items ii
     LEFT JOIN invoices cn   ON cn.original_invoice_id = ii.invoice_id
                             AND cn.is_return = true
                             AND cn.tenant_id = $2
     LEFT JOIN invoice_items ret ON ret.invoice_id  = cn.id
                                 AND ret.product_id = ii.product_id
     WHERE ii.invoice_id = $1
       AND ii.id = ANY($3)
     GROUP BY ii.id`,
    [original.id, req.tenantId, origItemIds]
  );

  const alreadyReturnedMap = {};
  for (const r of alreadyReturnedRows) {
    alreadyReturnedMap[r.original_item_id] = Number(r.already_returned);
  }

  // ── Validate each requested return item ──────────────────────────────────
  for (const reqItem of items) {
    const { invoice_item_id, returned_qty } = reqItem;

    if (!invoice_item_id || returned_qty == null || Number(returned_qty) <= 0) {
      return res.status(400).json({
        error:   'INVALID_RETURN_ITEM',
        message: 'Each item requires invoice_item_id and a positive returned_qty',
      });
    }

    const origItem = origItemMap[invoice_item_id];
    if (!origItem) {
      return res.status(422).json({
        error:          'ITEM_NOT_ON_INVOICE',
        invoice_item_id,
        invoice_id:     original.id,
      });
    }

    const maxReturnable = Number(origItem.quantity_sold) - (alreadyReturnedMap[invoice_item_id] || 0);
    if (Number(returned_qty) > maxReturnable) {
      return res.status(422).json({
        error:            'RETURN_QTY_EXCEEDS_AVAILABLE',
        product:          origItem.product_name,
        invoice_item_id,
        requested:        Number(returned_qty),
        max_returnable:   maxReturnable,
        original_qty:     Number(origItem.quantity_sold),
        already_returned: alreadyReturnedMap[invoice_item_id] || 0,
      });
    }
  }

  // ── Get current open shift (nullable for credit notes) ───────────────────
  const actorType = req.userRole === 'cashier' ? 'cashier' : 'staff';
  const actorId   = actorType === 'cashier' ? req.cashierId : req.staffId;
  const shiftActorCol = actorType === 'cashier' ? 'cashier_id' : 'staff_id';

  const { rows: shiftRows } = await db.query(
    `SELECT id FROM cash_shifts
     WHERE ${shiftActorCol} = $1 AND tenant_id = $2 AND status = 'open'
     ORDER BY opened_at DESC LIMIT 1`,
    [actorId, req.tenantId]
  );
  const shiftId = shiftRows.length > 0 ? shiftRows[0].id : null;

  // ── BEGIN TRANSACTION ────────────────────────────────────────────────────
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // ── Calculate credit note totals using ORIGINAL prices ───────────────
    // Do NOT re-fetch current product prices — §9 requires original values.
    let cnSubtotal  = 0;
    let cnTaxAmount = 0;

    const returnLineItems = [];

    for (const reqItem of items) {
      const { invoice_item_id, returned_qty } = reqItem;
      const origItem  = origItemMap[invoice_item_id];
      const retQty    = Number(returned_qty);

      // Original per-unit values (from original invoice_item row)
      const origQty        = Number(origItem.quantity_sold);
      const unitPrice      = Number(origItem.unit_sale_price);
      const discFlat       = Number(origItem.item_discount_flat);
      const discPct        = Number(origItem.item_discount_pct);
      const taxRatePct     = Number(origItem.tax_rate_pct);

      // Pro-rate discounts proportionally to returned quantity
      const origGross      = unitPrice * origQty;
      const origItemDisc   = Math.max(discFlat, origGross * (discPct / 100));
      const discPerUnit    = origQty > 0 ? origItemDisc / origQty : 0;

      const retGross       = unitPrice * retQty;
      const retDisc        = parseFloat((discPerUnit * retQty).toFixed(2));
      const retTaxableBase = retGross - retDisc;
      const retTax         = parseFloat((retTaxableBase * (taxRatePct / 100)).toFixed(2));
      const retRowTotal    = parseFloat((retTaxableBase + retTax).toFixed(2));

      cnSubtotal  += retRowTotal;
      cnTaxAmount += retTax;

      returnLineItems.push({
        product_id:         origItem.product_id,
        scanned_barcode:    origItem.scanned_barcode,
        product_name:       origItem.product_name,
        quantity_sold:      retQty,
        unit_sale_price:    unitPrice,
        item_discount_flat: retDisc,
        item_discount_pct:  0,           // flat discount used; pct already applied
        tax_rate_pct:       taxRatePct,
        final_row_total:    retRowTotal,
      });
    }

    cnSubtotal  = parseFloat(cnSubtotal.toFixed(2));
    cnTaxAmount = parseFloat(cnTaxAmount.toFixed(2));

    // Credit note totals are NEGATIVE — §9 spec, append-only ledger
    const cnSubtotalNeg = parseFloat((-cnSubtotal).toFixed(2));
    const cnTaxNeg      = parseFloat((-cnTaxAmount).toFixed(2));
    const cnTotalNeg    = cnSubtotalNeg;    // no bill discount on returns

    // ── Generate credit note invoice number ──────────────────────────────
    const cnNumber = await nextInvoiceNumber(
      client,
      req.tenantId,
      original.location_id,
      original.location_code
    );

    // ── INSERT credit note invoices row ───────────────────────────────────
    const cnId = uuidv4();
    const { rows: cnRows } = await client.query(
      `INSERT INTO invoices (
         id, tenant_id, location_id, staff_id, cashier_id, cash_shift_id,
         invoice_number, subtotal_amount, bill_discount_flat, bill_discount_pct,
         tax_amount, total_amount, payment_method, payment_status,
         idempotency_key, is_return, original_invoice_id, notes
       ) VALUES (
         $1,  $2,  $3,  $4,  $5,  $6,
         $7,  $8,  0,   0,
         $9,  $10, $11, 'completed',
         $12, true, $13, $14
       ) RETURNING *`,
      [
        cnId,
        req.tenantId,
        original.location_id,
        actorType === 'staff'   ? actorId : null,   // staff_id
        actorType === 'cashier' ? actorId : null,   // cashier_id
        shiftId,
        cnNumber,
        cnSubtotalNeg,
        cnTaxNeg,
        cnTotalNeg,
        original.payment_method,
        idempotency_key,
        original.id,
        notes,
      ]
    );

    const cnInvoice = cnRows[0];
    const savedItems = [];

    // ── INSERT credit note line items + restore stock ─────────────────────
    for (const line of returnLineItems) {
      const { rows: lineRows } = await client.query(
        `INSERT INTO invoice_items (
           invoice_id, product_id, scanned_barcode,
           quantity_sold, unit_sale_price,
           item_discount_flat, item_discount_pct,
           tax_rate_pct, final_row_total, item_modifiers
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [
          cnId,
          line.product_id,
          line.scanned_barcode,
          line.quantity_sold,
          line.unit_sale_price,
          line.item_discount_flat,
          line.item_discount_pct,
          line.tax_rate_pct,
          line.final_row_total,
          JSON.stringify({}),
        ]
      );

      savedItems.push({ ...lineRows[0], product_name: line.product_name });

      // Fetch conversion_factor for this barcode (1 if no barcode)
      let conversionFactor = 1;
      if (line.scanned_barcode) {
        const { rows: bcRows } = await client.query(
          `SELECT conversion_factor FROM product_barcodes
           WHERE barcode = $1 AND tenant_id = $2`,
          [line.scanned_barcode, req.tenantId]
        );
        if (bcRows.length > 0) conversionFactor = Number(bcRows[0].conversion_factor);
      }

      // §9 — Stock restoration: positive delta = stock coming back in
      await writeStockMovement(client, {
        tenant_id:               req.tenantId,
        location_id:             original.location_id,
        product_id:              line.product_id,
        quantity_delta:          +(line.quantity_sold * conversionFactor),
        movement_type:           'sale_return',
        associated_reference_id: cnId,
        notes:                   `Return — ${cnNumber} (orig: ${original.invoice_number})`,
        staff_id:                actorType === 'staff'   ? actorId : null,
        cashier_id:              actorType === 'cashier' ? actorId : null,
      });
    }

    // ── COMMIT ────────────────────────────────────────────────────────────
    await client.query('COMMIT');

    return res.status(201).json({
      invoice: {
        ...cnInvoice,
        items: savedItems,
      },
    });

  } catch (err) {
    await client.query('ROLLBACK');

    if (err.status) {
      return res.status(err.status).json(
        Object.fromEntries(Object.entries(err).filter(([k]) => k !== 'status'))
      );
    }

    // Idempotency race — same as checkout
    if (err.code === '23505' && err.constraint?.includes('idempotency')) {
      const { rows: race } = await db.query(
        `SELECT i.*, json_agg(ii ORDER BY ii.id) AS items
         FROM invoices i
         LEFT JOIN invoice_items ii ON ii.invoice_id = i.id
         WHERE i.idempotency_key = $1 AND i.tenant_id = $2
         GROUP BY i.id`,
        [idempotency_key, req.tenantId]
      );
      return res.status(200).json({ idempotent: true, invoice: race[0] });
    }

    console.error('[invoices/return]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  } finally {
    client.release();
  }
});

module.exports = router;
