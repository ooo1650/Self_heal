// routes/imports.js
// Phase 11 — Bulk product import — §18.2
// Owner-only per §5 permission matrix.
//
// POST /api/products/import/start           — create import_job, return job_id
// POST /api/products/import/:jobId/chunk    — process a batch of rows
// POST /api/products/import/:jobId/complete — finalise job, send email
// GET  /api/products/import/:jobId          — poll job status + error_log
//
// Transaction model:
//   Each chunk is processed inside a SINGLE transaction for the DB writes.
//   Individual row validation errors do NOT roll back the chunk — they are
//   collected and appended to import_jobs.error_log.
//   If the DB connection itself fails mid-chunk, the whole chunk can be retried.
//
// All queries include WHERE tenant_id = $1.

const router         = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const db             = require('../db');
const tenantAuth     = require('../middleware/tenantAuth');
const authorizeRoles = require('../middleware/authorizeRoles');
const {
  sendImportCompleteEmail,
  sendImportPartialEmail,
} = require('../utils/mailer');

// ── Valid VAT categories (mirrors the DB enum) ────────────────────────────────
const VALID_VAT_CATEGORIES = ['TAXABLE_13', 'EXEMPT', 'ZERO_RATED', 'NON_TAXABLE'];

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/products/import/start
// Creates an import_job and returns its ID.
// The client calls /chunk one or more times, then /complete to finalise.
//
// Body: { total_rows }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/start', tenantAuth, authorizeRoles('owner', 'staff'), async (req, res) => {
  const { total_rows } = req.body;

  if (!total_rows || Number(total_rows) < 1) {
    return res.status(400).json({
      error:   'MISSING_FIELDS',
      required: ['total_rows (positive integer)'],
    });
  }

  try {
    const jobId = uuidv4();
    await db.query(
      `INSERT INTO import_jobs
         (id, tenant_id, staff_id, cashier_id, status, total_rows, imported_rows, failed_rows, error_log)
       VALUES ($1, $2, $3, $4, 'in_progress', $5, 0, 0, '[]'::jsonb)`,
      [jobId, req.tenantId,
       req.userRole !== 'cashier' ? req.staffId  : null,
       req.userRole === 'cashier' ? req.cashierId : null,
       Number(total_rows)]
    );

    return res.status(201).json({ import_job_id: jobId });
  } catch (err) {
    console.error('[imports/start]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/products/import/:jobId/chunk
// Processes a batch of product rows.
//
// Body: {
//   chunk_offset: number,   // row index of the first row in this chunk (for error reporting)
//   rows: [{
//     name, cost_price, mrp, sale_price?,
//     barcode?, unit_name?, vat_category?, custom_vat_rate?, attributes?
//   }]
// }
//
// Returns: { chunk_imported, chunk_errors: [{row_index, product_name, reason}] }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:jobId/chunk', tenantAuth, authorizeRoles('owner', 'staff'), async (req, res) => {
  const { jobId }                          = req.params;
  const { rows, chunk_offset = 0 }         = req.body;

  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'MISSING_FIELDS', required: ['rows (array)'] });
  }

  // ── Verify job belongs to this tenant and is still in_progress ────────────
  const { rows: jobRows } = await db.query(
    `SELECT id, status FROM import_jobs WHERE id = $1 AND tenant_id = $2`,
    [jobId, req.tenantId]
  );

  if (jobRows.length === 0) {
    return res.status(404).json({ error: 'JOB_NOT_FOUND' });
  }
  if (jobRows[0].status !== 'in_progress') {
    return res.status(409).json({
      error:   'JOB_NOT_IN_PROGRESS',
      status:  jobRows[0].status,
      message: 'This job has already been completed or failed',
    });
  }

  // ── Process rows — validate first, then write in one transaction ──────────
  // Validation errors are collected per row; they never abort the DB writes
  // for the rows that did pass validation.

  const validRows  = [];   // rows that passed validation, ready to INSERT
  const rowErrors  = [];   // per-row errors { row_index, product_name, reason }

  // ── Step 1: Validate every row before opening the transaction ─────────────
  for (let i = 0; i < rows.length; i++) {
    const row     = rows[i];
    const rowIdx  = Number(chunk_offset) + i;
    const rowName = row.name || `Row ${rowIdx}`;

    try {
      // Required fields
      if (!row.name || !row.name.trim()) {
        throw new Error('name is required');
      }
      if (row.cost_price == null) {
        throw new Error('cost_price is required');
      }
      if (row.mrp == null) {
        throw new Error('mrp is required');
      }

      const costPrice = Number(row.cost_price);
      const mrp       = Number(row.mrp);
      const salePrice = row.sale_price != null ? Number(row.sale_price) : mrp;

      if (!isFinite(costPrice) || costPrice < 0) {
        throw new Error(`cost_price must be a non-negative number, got "${row.cost_price}"`);
      }
      if (!isFinite(mrp) || mrp <= 0) {
        throw new Error(`mrp must be a positive number, got "${row.mrp}"`);
      }
      if (salePrice > mrp) {
        throw new Error(`Sale price exceeds MRP (sale_price ${salePrice} > mrp ${mrp})`);
      }

      // VAT category
      const vatCategory = row.vat_category || 'TAXABLE_13';
      if (!VALID_VAT_CATEGORIES.includes(vatCategory)) {
        throw new Error(
          `Invalid vat_category "${vatCategory}". ` +
          `Valid: ${VALID_VAT_CATEGORIES.join(', ')}`
        );
      }

      // custom_vat_rate
      const customVatRate = row.custom_vat_rate != null
        ? Number(row.custom_vat_rate)
        : null;
      if (customVatRate !== null && !isFinite(customVatRate)) {
        throw new Error(`custom_vat_rate must be a number, got "${row.custom_vat_rate}"`);
      }

      // Barcode — if provided, sale_price is required for the barcode row
      if (row.barcode && !row.barcode.toString().trim()) {
        throw new Error('barcode cannot be an empty string');
      }

      // Attributes must be an object if provided
      let attributes = {};
      if (row.attributes) {
        if (typeof row.attributes === 'string') {
          try { attributes = JSON.parse(row.attributes); }
          catch { throw new Error('attributes must be valid JSON'); }
        } else if (typeof row.attributes === 'object' && !Array.isArray(row.attributes)) {
          attributes = row.attributes;
        } else {
          throw new Error('attributes must be a JSON object');
        }
      }

      validRows.push({
        rowIdx,
        rowName:       row.name.trim(),
        costPrice,
        mrp,
        salePrice,
        vatCategory,
        customVatRate,
        attributes,
        barcode:       row.barcode ? row.barcode.toString().trim() : null,
        unitName:      row.unit_name ? row.unit_name.toString().trim() : 'piece',
      });

    } catch (err) {
      rowErrors.push({
        row_index:    rowIdx,
        product_name: rowName,
        reason:       err.message,
      });
    }
  }

  // ── Step 2: Write valid rows in a single transaction ──────────────────────
  let successCount = 0;
  const dbErrors   = [];   // errors from DB writes (e.g. duplicate barcode)

  if (validRows.length > 0) {
    const client = await db.connect();
    try {
      await client.query('BEGIN');

      for (const vr of validRows) {
        try {
          // INSERT product
          const productId = uuidv4();
          await client.query(
            `INSERT INTO products
               (id, tenant_id, name, base_cost_price, mrp,
                vat_category, custom_vat_rate, attributes, is_active)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)`,
            [
              productId, req.tenantId, vr.rowName,
              vr.costPrice, vr.mrp,
              vr.vatCategory, vr.customVatRate,
              JSON.stringify(vr.attributes),
            ]
          );

          // INSERT barcode if provided — duplicate is a row-level error, not a chunk failure
          if (vr.barcode) {
            try {
              await client.query(
                `INSERT INTO product_barcodes
                   (barcode, product_id, tenant_id, unit_name,
                    conversion_factor, sale_price, is_active)
                 VALUES ($1, $2, $3, $4, 1.000, $5, true)`,
                [vr.barcode, productId, req.tenantId, vr.unitName, vr.salePrice]
              );
            } catch (barcodeErr) {
              if (barcodeErr.code === '23505') {
                // Duplicate barcode — product was inserted, barcode skipped
                // Record as row error but do NOT roll back
                dbErrors.push({
                  row_index:    vr.rowIdx,
                  product_name: vr.rowName,
                  reason:       `Duplicate barcode "${vr.barcode}" — product created without barcode`,
                });
              } else {
                throw barcodeErr; // unexpected — re-throw to roll back chunk
              }
            }
          }

          successCount++;
        } catch (rowDbErr) {
          // Any non-barcode DB error on a single row — record and continue
          dbErrors.push({
            row_index:    vr.rowIdx,
            product_name: vr.rowName,
            reason:       rowDbErr.message,
          });
        }
      }

      await client.query('COMMIT');
    } catch (chunkErr) {
      // Whole-chunk DB failure (connection lost, etc.) — roll back, surface error
      await client.query('ROLLBACK').catch(() => {});
      client.release();
      console.error('[imports/chunk] Chunk-level DB error:', chunkErr.message);
      return res.status(500).json({
        error:   'CHUNK_FAILED',
        message: 'Database error — this chunk can be safely retried',
        detail:  process.env.NODE_ENV === 'development' ? chunkErr.message : undefined,
      });
    } finally {
      client.release();
    }
  }

  // ── Step 3: Merge all errors and update the job counters ──────────────────
  const allChunkErrors = [...rowErrors, ...dbErrors];
  const errorCount     = allChunkErrors.length;

  await db.query(
    `UPDATE import_jobs
     SET imported_rows = imported_rows + $1,
         failed_rows   = failed_rows   + $2,
         error_log     = error_log     || $3::jsonb
     WHERE id = $4 AND tenant_id = $5`,
    [
      successCount,
      errorCount,
      JSON.stringify(allChunkErrors),
      jobId,
      req.tenantId,
    ]
  );

  return res.json({
    chunk_imported: successCount,
    chunk_errors:   allChunkErrors,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/products/import/:jobId/complete
// Finalises the job, sets status and completed_at, fires email.
//
// Status logic:
//   'completed' — failed_rows = 0
//   'failed'    — imported_rows = 0
//   'partial'   — some imported, some failed
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:jobId/complete', tenantAuth, authorizeRoles('owner', 'staff'), async (req, res) => {
  // Fetch job
  const { rows: jobRows } = await db.query(
    `SELECT ij.*, t.owner_email
     FROM import_jobs ij
     JOIN tenants t ON t.id = ij.tenant_id
     WHERE ij.id = $1 AND ij.tenant_id = $2`,
    [req.params.jobId, req.tenantId]
  );

  if (jobRows.length === 0) {
    return res.status(404).json({ error: 'JOB_NOT_FOUND' });
  }

  const job = jobRows[0];

  if (job.status !== 'in_progress') {
    return res.status(409).json({
      error:   'JOB_ALREADY_COMPLETED',
      status:  job.status,
    });
  }

  // Derive final status
  const importedRows = Number(job.imported_rows);
  const failedRows   = Number(job.failed_rows);

  const finalStatus = failedRows === 0              ? 'completed'
                    : importedRows === 0            ? 'failed'
                    :                                 'partial';

  await db.query(
    `UPDATE import_jobs
     SET status = $1, completed_at = NOW()
     WHERE id = $2 AND tenant_id = $3`,
    [finalStatus, job.id, req.tenantId]
  );

  // Fire email — non-blocking, never fails the response
  if (finalStatus === 'completed') {
    sendImportCompleteEmail(job.owner_email, importedRows, failedRows).catch(() => {});
  } else {
    // 'partial' or 'failed'
    sendImportPartialEmail(job.owner_email, importedRows, failedRows, job.id).catch(() => {});
  }

  return res.json({
    status:        finalStatus,
    imported_rows: importedRows,
    failed_rows:   failedRows,
    error_log:     job.error_log,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/products/import/:jobId
// Returns full job row including error_log for UI progress polling.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:jobId', tenantAuth, authorizeRoles('owner', 'staff'), async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, status, total_rows, imported_rows, failed_rows,
              error_log, created_at, completed_at
       FROM import_jobs
       WHERE id = $1 AND tenant_id = $2`,
      [req.params.jobId, req.tenantId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'JOB_NOT_FOUND' });
    }

    return res.json({ job: rows[0] });
  } catch (err) {
    console.error('[imports/get]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

module.exports = router;
