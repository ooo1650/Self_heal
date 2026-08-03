// routes/products.js
// Phase 3 — Product catalog, barcode management, POS scan, MRP guardrail
//
// Permission matrix (§5):
//   owner  — full CRUD on products and barcodes
//   cashier — read-only (product list / single product) + scan endpoint
//
// Endpoints:
//   GET    /api/products              — list all active products for tenant
//   GET    /api/products/:id          — single product with its barcodes
//   POST   /api/products              — create product            [owner]
//   PUT    /api/products/:id          — update product            [owner]
//   PATCH  /api/products/:id/status   — activate / deactivate     [owner]
//
//   POST   /api/products/:id/barcodes         — add barcode variant    [owner]
//   PUT    /api/products/barcodes/:barcode     — update barcode variant [owner]
//   DELETE /api/products/barcodes/:barcode     — deactivate barcode     [owner]
//
//   POST   /api/pos/scan              — barcode scan (FOUND | UNREGISTERED) [owner, cashier]
//   POST   /api/pos/validate-cart     — MRP guardrail check on cart items   [owner, cashier]

const router         = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const db             = require('../db');
const tenantAuth     = require('../middleware/tenantAuth');
const authorizeRoles = require('../middleware/authorizeRoles');
const { resolveVatRate } = require('../utils/vatResolver');
const multer         = require('multer');
const path           = require('path');
const fs             = require('fs');

// Global product code sequence — single sequence shared across all tenants
// to prevent INT-XXXXX collisions in product_barcodes (global uniqueness constraint).
// Migration 005 creates the sequence; this helper ensures it exists at runtime
// via CREATE SEQUENCE IF NOT EXISTS so first-run is safe.
async function nextProductCode(client) {
  await client.query(
    `CREATE SEQUENCE IF NOT EXISTS "global_product_seq" START 1 INCREMENT 1 MINVALUE 1`
  );
  const { rows } = await client.query(`SELECT nextval('"global_product_seq"') AS seq`);
  const seq = String(rows[0].seq).padStart(5, '0');
  return `INT-${seq}`;
}

// ── Valid VAT category values (mirrors the DB enum) ───────────────────────────
const VALID_VAT_CATEGORIES = ['TAXABLE_13', 'EXEMPT', 'ZERO_RATED', 'NON_TAXABLE'];

// ─────────────────────────────────────────────────────────────────────────────
// PRODUCT ROUTES
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/products
// Returns all products for the tenant. Supports ?active=true/false filter.
// Both owner and cashier can list products (cashier needs this for POS lookups).
router.get('/', tenantAuth, authorizeRoles('owner', 'staff', 'cashier'), async (req, res) => {
  try {
    const { active } = req.query;

    let query = `
      SELECT p.id, p.name, p.base_cost_price, p.mrp, p.vat_category, p.custom_vat_rate,
             p.attributes, p.low_stock_alert_qty, p.is_active, p.created_at, p.image_url,
             COALESCE((
               SELECT SUM(sb.stock_on_hand)
               FROM stock_balance sb
               WHERE sb.product_id = p.id AND sb.tenant_id = p.tenant_id
             ), 0) AS total_stock,
             (
               SELECT json_agg(json_build_object(
                 'barcode', pb.barcode,
                 'unit_name', pb.unit_name,
                 'conversion_factor', pb.conversion_factor,
                 'sale_price', pb.sale_price,
                 'is_active', pb.is_active
               ))
               FROM product_barcodes pb
               WHERE pb.product_id = p.id AND pb.tenant_id = p.tenant_id
             ) AS barcodes
      FROM products p
      WHERE p.tenant_id = $1
    `;
    const params = [req.tenantId];

    // Optional active filter — defaults to returning all products
    if (active === 'true') {
      query += ' AND p.is_active = true';
    } else if (active === 'false') {
      query += ' AND p.is_active = false';
    }

    query += ' ORDER BY p.name ASC';

    const { rows } = await db.query(query, params);

    // Attach resolved VAT rate and primary barcode to each row
    const products = rows.map(p => {
      const barcodes = p.barcodes || [];
      const primaryBarcode = barcodes.find(b => b.is_active)?.barcode || (barcodes[0]?.barcode || null);
      return {
        ...p,
        resolved_vat_rate: resolveVatRate(p),
        barcodes,
        barcode: primaryBarcode,
      };
    });

    return res.json({ products });
  } catch (err) {
    console.error('[products/list]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// GET /api/products/:id
// Returns a single product with all its barcode variants.
router.get('/:id', tenantAuth, authorizeRoles('owner', 'staff', 'cashier'), async (req, res) => {
  try {
    const { rows: productRows } = await db.query(
      `SELECT id, name, base_cost_price, mrp, vat_category, custom_vat_rate,
              attributes, low_stock_alert_qty, is_active, created_at, image_url,
              COALESCE((
                SELECT SUM(sb.stock_on_hand)
                FROM stock_balance sb
                WHERE sb.product_id = products.id AND sb.tenant_id = products.tenant_id
              ), 0) AS total_stock
       FROM products
       WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, req.tenantId]
    );

    if (productRows.length === 0) {
      return res.status(404).json({ error: 'PRODUCT_NOT_FOUND' });
    }

    const product = productRows[0];

    const { rows: barcodeRows } = await db.query(
      `SELECT barcode, unit_name, conversion_factor, sale_price, is_active
       FROM product_barcodes
       WHERE product_id = $1 AND tenant_id = $2
       ORDER BY unit_name ASC`,
      [product.id, req.tenantId]
    );

    const primaryBarcode = barcodeRows.find(b => b.is_active)?.barcode || (barcodeRows[0]?.barcode || null);

    return res.json({
      ...product,
      resolved_vat_rate: resolveVatRate(product),
      barcodes: barcodeRows,
      barcode: primaryBarcode,
    });
  } catch (err) {
    console.error('[products/get]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// POST /api/products
// Create a new product. Barcodes are added automatically if provided, or generated if omitted.
// Owner only — §5 permission matrix.
//
// Body: { name, base_cost_price, mrp, vat_category, custom_vat_rate?,
//          attributes?, low_stock_alert_qty?, barcode?, sale_price?, unit_name? }
router.post('/', tenantAuth, authorizeRoles('owner', 'staff'), async (req, res) => {
  const {
    name,
    base_cost_price,
    mrp,
    vat_category     = 'TAXABLE_13',
    custom_vat_rate  = null,
    attributes       = {},
    low_stock_alert_qty = 10,
    barcode,
    sale_price,
    unit_name        = 'piece',
  } = req.body;

  if (!name || base_cost_price == null || mrp == null) {
    return res.status(400).json({
      error: 'MISSING_FIELDS',
      required: ['name', 'base_cost_price', 'mrp'],
    });
  }

  if (!VALID_VAT_CATEGORIES.includes(vat_category)) {
    return res.status(400).json({
      error: 'INVALID_VAT_CATEGORY',
      valid_values: VALID_VAT_CATEGORIES,
    });
  }

  if (Number(mrp) < Number(base_cost_price)) {
    return res.status(400).json({ error: 'MRP_BELOW_COST_PRICE' });
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    let finalBarcode = barcode ? barcode.trim() : null;

    if (finalBarcode) {
      // Check for barcode conflict globally
      const { rows: existingBc } = await client.query(
        'SELECT barcode FROM product_barcodes WHERE barcode = $1',
        [finalBarcode]
      );
      if (existingBc.length > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'BARCODE_ALREADY_EXISTS', barcode: finalBarcode });
      }
    } else {
      // Auto-generate internal barcode code (global sequence — no per-tenant collision)
      finalBarcode = await nextProductCode(client);
    }

    const productId = uuidv4();
    const { rows: prodRows } = await client.query(
      `INSERT INTO products
         (id, tenant_id, name, base_cost_price, mrp, vat_category, custom_vat_rate,
          attributes, low_stock_alert_qty, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true)
       RETURNING *`,
      [
        productId,
        req.tenantId,
        name.trim(),
        Number(base_cost_price),
        Number(mrp),
        vat_category,
        custom_vat_rate !== null ? Number(custom_vat_rate) : null,
        JSON.stringify(attributes),
        Number(low_stock_alert_qty),
      ]
    );

    const product = prodRows[0];

    const finalUnitName = unit_name ? unit_name.trim() : 'piece';
    const finalSalePrice = sale_price != null ? Number(sale_price) : Number(mrp);

    const { rows: bcRows } = await client.query(
      `INSERT INTO product_barcodes
         (barcode, product_id, tenant_id, unit_name, conversion_factor, sale_price, is_active)
       VALUES ($1, $2, $3, $4, 1.000, $5, true)
       RETURNING *`,
      [
        finalBarcode,
        productId,
        req.tenantId,
        finalUnitName,
        finalSalePrice,
      ]
    );

    await client.query('COMMIT');

    return res.status(201).json({
      ...product,
      resolved_vat_rate: resolveVatRate(product),
      barcode: finalBarcode,
      barcodes: [bcRows[0]],
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[products/create]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  } finally {
    client.release();
  }
});

// PUT /api/products/:id
// Update product fields. Owner only — §5.
//
// Body: any subset of { name, base_cost_price, mrp, vat_category,
//                        custom_vat_rate, attributes, low_stock_alert_qty }
router.put('/:id', tenantAuth, authorizeRoles('owner', 'staff'), async (req, res) => {
  // First confirm the product belongs to this tenant
  const { rows: existing } = await db.query(
    'SELECT id, mrp, base_cost_price FROM products WHERE id = $1 AND tenant_id = $2',
    [req.params.id, req.tenantId]
  );
  if (existing.length === 0) {
    return res.status(404).json({ error: 'PRODUCT_NOT_FOUND' });
  }

  const current = existing[0];

  const {
    name,
    base_cost_price,
    mrp,
    vat_category,
    custom_vat_rate,
    attributes,
    low_stock_alert_qty,
  } = req.body;

  // Validate VAT category if provided
  if (vat_category && !VALID_VAT_CATEGORIES.includes(vat_category)) {
    return res.status(400).json({
      error: 'INVALID_VAT_CATEGORY',
      valid_values: VALID_VAT_CATEGORIES,
    });
  }

  // MRP must not fall below cost price — use incoming or current values
  const effectiveMrp  = mrp  != null ? Number(mrp)  : Number(current.mrp);
  const effectiveCost = base_cost_price != null ? Number(base_cost_price) : Number(current.base_cost_price);
  if (effectiveMrp < effectiveCost) {
    return res.status(400).json({ error: 'MRP_BELOW_COST_PRICE' });
  }

  try {
    // Build dynamic SET clause — only update fields that were actually sent
    const fields  = [];
    const values  = [];
    let   idx     = 1;

    if (name              != null) { fields.push(`name = $${idx++}`);              values.push(name.trim()); }
    if (base_cost_price   != null) { fields.push(`base_cost_price = $${idx++}`);   values.push(Number(base_cost_price)); }
    if (mrp               != null) { fields.push(`mrp = $${idx++}`);               values.push(Number(mrp)); }
    if (vat_category      != null) { fields.push(`vat_category = $${idx++}`);      values.push(vat_category); }
    if (custom_vat_rate   !== undefined) {
      fields.push(`custom_vat_rate = $${idx++}`);
      values.push(custom_vat_rate !== null ? Number(custom_vat_rate) : null);
    }
    if (attributes        != null) { fields.push(`attributes = $${idx++}`);        values.push(JSON.stringify(attributes)); }
    if (low_stock_alert_qty != null) { fields.push(`low_stock_alert_qty = $${idx++}`); values.push(Number(low_stock_alert_qty)); }

    if (fields.length === 0) {
      return res.status(400).json({ error: 'NO_FIELDS_TO_UPDATE' });
    }

    values.push(req.params.id, req.tenantId);
    const { rows } = await db.query(
      `UPDATE products SET ${fields.join(', ')}
       WHERE id = $${idx} AND tenant_id = $${idx + 1}
       RETURNING *`,
      values
    );

    const product = rows[0];
    return res.json({
      ...product,
      resolved_vat_rate: resolveVatRate(product),
    });
  } catch (err) {
    console.error('[products/update]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// PATCH /api/products/:id/status
// Activate or deactivate a product (soft delete). Owner only — §5.
// §6.4 — deactivated product mid-shift: fresh scan returns UNREGISTERED;
//         server re-checks is_active at checkout before writing invoice.
//
// Body: { is_active: true | false }
router.patch('/:id/status', tenantAuth, authorizeRoles('owner', 'staff'), async (req, res) => {
  const { is_active } = req.body;

  if (typeof is_active !== 'boolean') {
    return res.status(400).json({ error: 'MISSING_FIELDS', required: ['is_active (boolean)'] });
  }

  try {
    const { rows } = await db.query(
      `UPDATE products SET is_active = $1
       WHERE id = $2 AND tenant_id = $3
       RETURNING id, name, is_active`,
      [is_active, req.params.id, req.tenantId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'PRODUCT_NOT_FOUND' });
    }

    return res.json(rows[0]);
  } catch (err) {
    console.error('[products/status]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// BARCODE MANAGEMENT ROUTES — owner only (§5)
// ─────────────────────────────────────────────────────────────────────────────

// POST /api/products/:id/barcodes
// Add a barcode variant to a product (loose unit, carton, etc.).
// §6.5 — conversion_factor drives stock ledger deduction:
//         quantity_delta = -(quantity_sold * conversion_factor)
//
// Body: { barcode, unit_name, conversion_factor, sale_price }
router.post('/:id/barcodes', tenantAuth, authorizeRoles('owner', 'staff'), async (req, res) => {
  const {
    barcode,
    unit_name,
    conversion_factor = 1.0,
    sale_price,
  } = req.body;

  if (!barcode || !unit_name || sale_price == null) {
    return res.status(400).json({
      error: 'MISSING_FIELDS',
      required: ['barcode', 'unit_name', 'sale_price'],
    });
  }

  // Confirm product belongs to this tenant before attaching barcode
  const { rows: productRows } = await db.query(
    'SELECT id, mrp FROM products WHERE id = $1 AND tenant_id = $2',
    [req.params.id, req.tenantId]
  );
  if (productRows.length === 0) {
    return res.status(404).json({ error: 'PRODUCT_NOT_FOUND' });
  }

  try {
    const { rows } = await db.query(
      `INSERT INTO product_barcodes
         (barcode, product_id, tenant_id, unit_name, conversion_factor, sale_price, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, true)
       RETURNING *`,
      [
        barcode.trim(),
        req.params.id,
        req.tenantId,
        unit_name.trim(),
        Number(conversion_factor),
        Number(sale_price),
      ]
    );
    return res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'BARCODE_ALREADY_EXISTS', barcode });
    }
    console.error('[barcodes/create]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// PUT /api/products/barcodes/:barcode
// Update a barcode variant's unit_name, conversion_factor, or sale_price.
// Owner only — §5.
//
// Body: any subset of { unit_name, conversion_factor, sale_price }
router.put('/barcodes/:barcode', tenantAuth, authorizeRoles('owner', 'staff'), async (req, res) => {
  // Confirm barcode belongs to this tenant before updating
  const { rows: existing } = await db.query(
    'SELECT barcode FROM product_barcodes WHERE barcode = $1 AND tenant_id = $2',
    [req.params.barcode, req.tenantId]
  );
  if (existing.length === 0) {
    return res.status(404).json({ error: 'BARCODE_NOT_FOUND' });
  }

  const { unit_name, conversion_factor, sale_price } = req.body;

  const fields = [];
  const values = [];
  let   idx    = 1;

  if (unit_name         != null) { fields.push(`unit_name = $${idx++}`);         values.push(unit_name.trim()); }
  if (conversion_factor != null) { fields.push(`conversion_factor = $${idx++}`); values.push(Number(conversion_factor)); }
  if (sale_price        != null) { fields.push(`sale_price = $${idx++}`);        values.push(Number(sale_price)); }

  if (fields.length === 0) {
    return res.status(400).json({ error: 'NO_FIELDS_TO_UPDATE' });
  }

  try {
    values.push(req.params.barcode, req.tenantId);
    const { rows } = await db.query(
      `UPDATE product_barcodes SET ${fields.join(', ')}
       WHERE barcode = $${idx} AND tenant_id = $${idx + 1}
       RETURNING *`,
      values
    );
    return res.json(rows[0]);
  } catch (err) {
    console.error('[barcodes/update]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// DELETE /api/products/barcodes/:barcode
// Soft-deactivates a barcode variant (is_active = false). Owner only — §5.
// Hard delete is not used — barcodes may still exist on historical invoice_items.
router.delete('/barcodes/:barcode', tenantAuth, authorizeRoles('owner', 'staff'), async (req, res) => {
  try {
    const { rows } = await db.query(
      `UPDATE product_barcodes SET is_active = false
       WHERE barcode = $1 AND tenant_id = $2
       RETURNING barcode, is_active`,
      [req.params.barcode, req.tenantId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'BARCODE_NOT_FOUND' });
    }

    return res.json({ message: 'Barcode deactivated', ...rows[0] });
  } catch (err) {
    console.error('[barcodes/delete]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POS ROUTES — owner + cashier
// ─────────────────────────────────────────────────────────────────────────────

// POST /api/pos/scan
// §6.3 — Barcode scan router. Returns FOUND or UNREGISTERED.
// §6.4 — Checks is_active on BOTH product_barcodes AND products.
//         A deactivated product or deactivated barcode both return UNREGISTERED.
//
// Body: { barcode }
// Returns:
//   FOUND       — { status: 'FOUND', product: { ...barcode + product fields, resolved_vat_rate } }
//   UNREGISTERED — { status: 'UNREGISTERED', barcode }
router.post('/scan', tenantAuth, authorizeRoles('owner', 'staff', 'cashier'), async (req, res) => {
  const { barcode } = req.body;

  if (!barcode) {
    return res.status(400).json({ error: 'MISSING_FIELDS', required: ['barcode'] });
  }

  try {
    const { rows } = await db.query(
      `SELECT
         pb.barcode,
         pb.unit_name,
         pb.conversion_factor,
         pb.sale_price,
         p.id          AS product_id,
         p.name,
         p.mrp,
         p.vat_category,
         p.custom_vat_rate,
         p.attributes
       FROM product_barcodes pb
       JOIN products p ON pb.product_id = p.id
       WHERE pb.tenant_id = $1
         AND pb.barcode   = $2
         AND pb.is_active = true
         AND p.is_active  = true`,
      [req.tenantId, barcode.trim()]
    );

    if (rows.length === 0) {
      return res.json({ status: 'UNREGISTERED', barcode });
    }

    const product = rows[0];
    return res.json({
      status: 'FOUND',
      product: {
        ...product,
        resolved_vat_rate: resolveVatRate(product),
      },
    });
  } catch (err) {
    console.error('[pos/scan]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// POST /api/pos/validate-cart
// §6.6 — MRP guardrail. Validates that no item in the cart has a unit_sale_price
//         exceeding its MRP. Called by the POS before checkout.
// §6.4 — Also re-checks is_active on each product to catch mid-shift deactivations.
//
// Body: { items: [{ product_id, name, unit_sale_price, mrp? }] }
//   mrp is optional — server re-fetches from DB to prevent client tampering.
//
// Returns 200 { valid: true } or 422 with the first violation found.
router.post('/validate-cart', tenantAuth, authorizeRoles('owner', 'staff', 'cashier'), async (req, res) => {
  const { items } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'MISSING_FIELDS', required: ['items (array)'] });
  }

  try {
    const productIds = [...new Set(items.map(i => i.product_id))];

    // Re-fetch authoritative MRP and is_active from the DB — never trust client values
    const { rows: dbProducts } = await db.query(
      `SELECT id, name, mrp, is_active
       FROM products
       WHERE id = ANY($1) AND tenant_id = $2`,
      [productIds, req.tenantId]
    );

    const productMap = {};
    for (const p of dbProducts) {
      productMap[p.id] = p;
    }

    for (const item of items) {
      const dbProduct = productMap[item.product_id];

      // Product not found or doesn't belong to this tenant
      if (!dbProduct) {
        return res.status(422).json({
          error: 'PRODUCT_NOT_FOUND',
          product_id: item.product_id,
        });
      }

      // §6.4 — mid-shift deactivation check
      if (!dbProduct.is_active) {
        return res.status(422).json({
          error: 'PRODUCT_DEACTIVATED',
          product: dbProduct.name,
          message: 'Product deactivated — remove from cart',
        });
      }

      // §6.6 — MRP guardrail
      if (Number(item.unit_sale_price) > Number(dbProduct.mrp)) {
        return res.status(422).json({
          error:            'PRICE_EXCEEDS_MRP',
          product:          dbProduct.name,
          attempted_price:  Number(item.unit_sale_price),
          legal_maximum:    Number(dbProduct.mrp),
        });
      }
    }

    return res.json({ valid: true });
  } catch (err) {
    console.error('[pos/validate-cart]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// Configure multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '../uploads/products'));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${req.params.id}-${Date.now()}${ext}`);
  }
});

// Configure multer file filter and limits
const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('INVALID_FILE_TYPE'));
    }
  }
});

// POST /api/products/:id/image
// Upload/replace product image. Owner only — §5 permission matrix.
router.post('/:id/image', tenantAuth, authorizeRoles('owner', 'staff'), (req, res) => {
  db.query(
    'SELECT id, image_url FROM products WHERE id = $1 AND tenant_id = $2',
    [req.params.id, req.tenantId]
  ).then(({ rows }) => {
    if (rows.length === 0) {
      return res.status(404).json({ error: 'PRODUCT_NOT_FOUND' });
    }

    const currentProduct = rows[0];

    upload.single('image')(req, res, async (err) => {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ error: 'FILE_TOO_LARGE', message: 'File size exceeds 5MB limit.' });
        }
        if (err.message === 'INVALID_FILE_TYPE') {
          return res.status(400).json({ error: 'INVALID_FILE_TYPE', message: 'Only JPG, PNG, and WEBP images are allowed.' });
        }
        console.error('[products/image-upload]', err);
        return res.status(500).json({ error: 'UPLOAD_FAILED' });
      }

      if (!req.file) {
        return res.status(400).json({ error: 'MISSING_FILE', message: 'No image file uploaded.' });
      }

      try {
        const imagePath = `/uploads/products/${req.file.filename}`;

        // Update database
        const { rows: updatedRows } = await db.query(
          `UPDATE products 
           SET image_url = $1 
           WHERE id = $2 AND tenant_id = $3
           RETURNING image_url`,
          [imagePath, req.params.id, req.tenantId]
        );

        // Delete old image if exists
        if (currentProduct.image_url) {
          const oldFilePath = path.join(__dirname, '..', currentProduct.image_url);
          fs.unlink(oldFilePath, (unlinkErr) => {
            if (unlinkErr && unlinkErr.code !== 'ENOENT') {
              console.error('[products/image-delete-old-failed]', unlinkErr);
            }
          });
        }

        return res.json({ image_url: updatedRows[0].image_url });
      } catch (dbErr) {
        console.error('[products/image-db-update-failed]', dbErr);
        if (req.file) {
          fs.unlink(req.file.path, () => {});
        }
        return res.status(500).json({ error: 'INTERNAL_ERROR' });
      }
    });
  }).catch(err => {
    console.error('[products/image-upload-check-failed]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  });
});

// DELETE /api/products/:id/image
// Clear product image. Owner only — §5 permission matrix.
router.delete('/:id/image', tenantAuth, authorizeRoles('owner', 'staff'), async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT id, image_url FROM products WHERE id = $1 AND tenant_id = $2',
      [req.params.id, req.tenantId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'PRODUCT_NOT_FOUND' });
    }

    const product = rows[0];

    await db.query(
      'UPDATE products SET image_url = NULL WHERE id = $1 AND tenant_id = $2',
      [req.params.id, req.tenantId]
    );

    if (product.image_url) {
      const filePath = path.join(__dirname, '..', product.image_url);
      fs.unlink(filePath, (err) => {
        if (err && err.code !== 'ENOENT') {
          console.error('[products/image-delete-failed]', err);
        }
      });
    }

    return res.json({ message: 'Image deleted successfully' });
  } catch (err) {
    console.error('[products/image-delete]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

module.exports = router;
