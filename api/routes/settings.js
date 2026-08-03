// routes/settings.js
// Phase 8b — Per-tenant configuration
//
// PUT /api/settings/payment-credentials  — store Fonepay creds (owner only)
// GET /api/settings/payment-credentials  — read back safe fields (owner only)
//
// Sensitive fields (password, secret_key) are encrypted with AES-256-GCM
// before storage and NEVER returned in any API response.
//
// All queries include WHERE tenant_id = $1.

const router     = require('express').Router();
const db         = require('../db');
const tenantAuth = require('../middleware/tenantAuth');
const authorizeRoles = require('../middleware/authorizeRoles');
const requireFullAccess = require('../middleware/requireFullAccess');
const { encrypt } = require('../utils/encryption');

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/settings/vat
// Access gate for the Settings → VAT page.
// Allowed for ALL authenticated staff (limited or full) and owners.
// The actual VAT data is served from /api/products.
// This endpoint exists solely so the frontend can confirm access on page load.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/vat', tenantAuth, authorizeRoles('owner', 'staff'), (req, res) => {
  return res.json({ vat_access: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/settings/business
// Access gate for the Settings → Business page.
// Blocked for limited staff (403). Full staff and owners pass through.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/business', tenantAuth, authorizeRoles('owner', 'staff'), requireFullAccess, (req, res) => {
  return res.json({ business_access: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/settings/features
// Access gate for the Settings → Features page.
// Blocked for limited staff (403). Full staff and owners pass through.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/features', tenantAuth, authorizeRoles('owner', 'staff'), requireFullAccess, (req, res) => {
  return res.json({ features_access: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/settings/payment
// Access gate for the Settings → Payment page.
// Blocked for limited staff (403). Full staff and owners pass through.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/payment', tenantAuth, authorizeRoles('owner', 'staff'), requireFullAccess, (req, res) => {
  return res.json({ payment_access: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/settings/payment-credentials
// Upserts Fonepay credentials for this tenant.
// Encrypts fonepay_password and fonepay_secret_key before writing.
// Sets fonepay_enabled = true on successful upsert.
//
// Body: { fonepay_merchant_code, fonepay_username,
//          fonepay_password, fonepay_secret_key }
// ─────────────────────────────────────────────────────────────────────────────
router.put('/payment-credentials', tenantAuth, authorizeRoles('owner'), async (req, res) => {
  const {
    fonepay_merchant_code,
    fonepay_username,
    fonepay_password,
    fonepay_secret_key,
  } = req.body;

  if (!fonepay_merchant_code || !fonepay_username ||
      !fonepay_password      || !fonepay_secret_key) {
    return res.status(400).json({
      error:    'MISSING_FIELDS',
      required: ['fonepay_merchant_code', 'fonepay_username',
                 'fonepay_password', 'fonepay_secret_key'],
    });
  }

  // Validate encryption key is available before attempting to store
  // (fail fast with a clear error rather than crashing mid-request)
  try {
    encrypt('__test__');
  } catch (keyErr) {
    console.error('[settings/payment-credentials] Encryption key error:', keyErr.message);
    return res.status(500).json({
      error:   'ENCRYPTION_NOT_CONFIGURED',
      message: 'CREDENTIAL_ENCRYPTION_KEY is missing from server .env',
    });
  }

  try {
    const encryptedPassword  = encrypt(fonepay_password);
    const encryptedSecretKey = encrypt(fonepay_secret_key);

    await db.query(
      `INSERT INTO tenant_payment_credentials
         (tenant_id, fonepay_merchant_code, fonepay_username,
          fonepay_password_encrypted, fonepay_secret_key_encrypted,
          fonepay_enabled, updated_at)
       VALUES ($1, $2, $3, $4, $5, true, NOW())
       ON CONFLICT (tenant_id) DO UPDATE SET
         fonepay_merchant_code      = EXCLUDED.fonepay_merchant_code,
         fonepay_username           = EXCLUDED.fonepay_username,
         fonepay_password_encrypted = EXCLUDED.fonepay_password_encrypted,
         fonepay_secret_key_encrypted = EXCLUDED.fonepay_secret_key_encrypted,
         fonepay_enabled            = true,
         updated_at                 = NOW()`,
      [
        req.tenantId,
        fonepay_merchant_code.trim(),
        fonepay_username.trim(),
        encryptedPassword,
        encryptedSecretKey,
      ]
    );

    // Return only safe fields — never echo back plaintext secrets
    return res.json({
      message:              'Payment credentials saved',
      fonepay_enabled:      true,
      fonepay_merchant_code: fonepay_merchant_code.trim(),
      fonepay_username:      fonepay_username.trim(),
    });
  } catch (err) {
    console.error('[settings/payment-credentials PUT]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/settings/payment-credentials
// Returns only safe fields — never decrypts or returns password/secret_key.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/payment-credentials', tenantAuth, authorizeRoles('owner', 'cashier'), async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT fonepay_enabled, fonepay_merchant_code, fonepay_username, updated_at
       FROM tenant_payment_credentials
       WHERE tenant_id = $1`,
      [req.tenantId]
    );

    if (rows.length === 0) {
      return res.json({
        fonepay_enabled:      false,
        fonepay_merchant_code: null,
        fonepay_username:      null,
        updated_at:            null,
      });
    }

    const row = rows[0];
    return res.json({
      fonepay_enabled:       row.fonepay_enabled,
      fonepay_merchant_code: row.fonepay_merchant_code,
      fonepay_username:      row.fonepay_username,
      updated_at:            row.updated_at,
    });
  } catch (err) {
    console.error('[settings/payment-credentials GET]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/settings/payment-credentials/verify
// Phase 14e / 15f — Initiate a ₨1 test payment to verify Fonepay credentials.
// Owner only.
//
// Flow:
//   1. Fetch tenant creds from tenant_payment_credentials (must be configured)
//   2. Create a minimal internal invoice row (no open shift required)
//   3. Call Fonepay thirdPartyDynamicQrDownload with amount=1.00
//   4. Store qr_transaction_ref + qr_expires_at on the invoice
//   5. Update verification_status = 'verifying'
//   6. Return { invoice_id, qr_data_url, qr_message, expires_at }
//
// Polling: frontend uses GET /api/payments/status/:invoiceId (existing endpoint)
// On payment confirmed (status='completed'), a separate PATCH endpoint below
// updates verification_status = 'verified'.
// ─────────────────────────────────────────────────────────────────────────────
const axios  = require('axios');
const QRCode = require('qrcode');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { decrypt }    = require('../utils/encryption');
const { signQrRequest } = require('../utils/fonepay');

const QR_EXPIRY_SECONDS = 300;

router.post('/payment-credentials/verify', tenantAuth, authorizeRoles('owner'), async (req, res) => {
  // ── Fetch tenant creds ────────────────────────────────────────────────────
  const { rows: credRows } = await db.query(
    `SELECT fonepay_merchant_code, fonepay_username,
            fonepay_password_encrypted, fonepay_secret_key_encrypted,
            fonepay_enabled
     FROM tenant_payment_credentials WHERE tenant_id = $1`,
    [req.tenantId]
  );

  if (credRows.length === 0 || !credRows[0].fonepay_enabled) {
    return res.status(422).json({
      error:   'PAYMENT_NOT_CONFIGURED',
      message: 'Save Fonepay credentials before starting verification.',
    });
  }

  const cred = credRows[0];
  let password, secretKey;
  try {
    password  = decrypt(cred.fonepay_password_encrypted);
    secretKey = decrypt(cred.fonepay_secret_key_encrypted);
  } catch {
    return res.status(500).json({ error: 'CREDENTIAL_DECRYPT_FAILED' });
  }

  // ── Fetch tenant's main branch for location_id ────────────────────────────
  const { rows: locRows } = await db.query(
    `SELECT id FROM locations WHERE tenant_id = $1 AND is_main_branch = true LIMIT 1`,
    [req.tenantId]
  );
  const locationId = locRows[0]?.id;
  if (!locationId) {
    return res.status(422).json({ error: 'NO_MAIN_BRANCH', message: 'No main branch found for this tenant.' });
  }

  // ── Create a ₨1 internal verification invoice (no shift required) ────────
  const invoiceId       = uuidv4();
  const idempotencyKey  = uuidv4();
  const invoiceNumber   = `VERIFY-${Date.now()}`;
  const AMOUNT          = '1.00';

  await db.query(
    `INSERT INTO invoices
       (id, tenant_id, location_id, cashier_id,
        invoice_number, subtotal_amount, tax_amount, total_amount,
        payment_method, payment_status, idempotency_key, is_return)
     VALUES ($1,$2,$3,$4,$5,1.00,0.00,1.00,'qr','pending',$6,false)`,
    [invoiceId, req.tenantId, locationId, req.staffId,
     invoiceNumber, idempotencyKey]
  );

  // ── Call Fonepay ──────────────────────────────────────────────────────────
  const baseUrl    = process.env.FONEPAY_DYNAMICQR_URL ?? 'https://dev-clientapi.fonepay.com/api/merchant';
  const merchantCode = cred.fonepay_merchant_code;
  const prn        = invoiceId;
  const remarks1   = invoiceId;
  const remarks2   = 'IMS-VERIFY';

  const dataValidation = signQrRequest(secretKey, {
    amount: AMOUNT, prn, merchantCode, remarks1, remarks2,
  });

  try {
    const { data } = await axios.post(
      `${baseUrl}/thirdPartyDynamicQrDownload`,
      { amount: AMOUNT, prn, merchantCode, remarks1, remarks2,
        username: cred.fonepay_username, password, dataValidation },
      { timeout: 10000 }
    );

    const qrMessage = data?.response?.qrMessage;
    if (!qrMessage) {
      return res.status(503).json({ error: 'GATEWAY_UNAVAILABLE', message: 'Fonepay returned unexpected format.' });
    }

    const qrDataUrl  = await QRCode.toDataURL(qrMessage);
    const expiresAt  = new Date(Date.now() + QR_EXPIRY_SECONDS * 1000);

    // Update invoice with QR ref
    await db.query(
      `UPDATE invoices SET qr_transaction_ref=$1, qr_expires_at=$2 WHERE id=$3`,
      [prn, expiresAt, invoiceId]
    );

    // Mark as verifying
    await db.query(
      `UPDATE tenant_payment_credentials SET verification_status='verifying' WHERE tenant_id=$1`,
      [req.tenantId]
    );

    return res.json({ invoice_id: invoiceId, qr_data_url: qrDataUrl,
                      qr_message: qrMessage, expires_at: expiresAt,
                      expires_in_seconds: QR_EXPIRY_SECONDS });

  } catch (err) {
    // Clean up the pending invoice
    await db.query('DELETE FROM invoices WHERE id=$1', [invoiceId]).catch(() => {});
    return res.status(503).json({
      error:   'GATEWAY_UNAVAILABLE',
      message: 'Fonepay is unreachable. Check credentials and try again.',
      detail:  process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  }
});

// ── PATCH /api/settings/payment-credentials/verified ─────────────────────────
// Called by the frontend after polling confirms payment_status='completed'.
// Marks the credentials as verified.
router.patch('/payment-credentials/verified', tenantAuth, authorizeRoles('owner'), async (req, res) => {
  const { invoice_id } = req.body;

  // Confirm the invoice belongs to this tenant and is completed
  const { rows } = await db.query(
    `SELECT id, payment_status FROM invoices WHERE id=$1 AND tenant_id=$2`,
    [invoice_id, req.tenantId]
  );

  if (rows.length === 0) return res.status(404).json({ error: 'INVOICE_NOT_FOUND' });
  if (rows[0].payment_status !== 'completed') {
    return res.status(422).json({ error: 'PAYMENT_NOT_COMPLETED', status: rows[0].payment_status });
  }

  await db.query(
    `UPDATE tenant_payment_credentials
     SET verification_status='verified', verified_at=NOW(), verification_invoice_id=$1
     WHERE tenant_id=$2`,
    [invoice_id, req.tenantId]
  );

  return res.json({ verified: true });
});

module.exports = router;
