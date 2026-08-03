// routes/payments.js
// Phase 8b — Fonepay Dynamic QR — per-tenant credentials
//
// Credentials are now stored encrypted in tenant_payment_credentials.
// process.env.FONEPAY_* is no longer used for merchant credentials.
// Only FONEPAY_DYNAMICQR_URL remains in .env (same endpoint for all tenants).
//
// POST /api/payments/initiate          — initiate QR, store ref on invoice
// GET  /api/payments/status/:invoiceId — poll status, handle expiry
//
// Error taxonomy:
//   422 PAYMENT_NOT_CONFIGURED — fonepay_enabled=false or no row exists (setup issue)
//   503 GATEWAY_UNAVAILABLE    — credentials are set but Fonepay is unreachable (network issue)
//
// All queries include WHERE tenant_id = $1.

const router = require('express').Router();
const axios  = require('axios');
const QRCode = require('qrcode');

const db             = require('../db');
const tenantAuth     = require('../middleware/tenantAuth');
const authorizeRoles = require('../middleware/authorizeRoles');
const { signQrRequest, signStatusCheck } = require('../utils/fonepay');
const { decrypt }                        = require('../utils/encryption');

const QR_EXPIRY_SECONDS = 300; // 5 minutes — §12

// ─────────────────────────────────────────────────────────────────────────────
// Internal helper: fetch and decrypt this tenant's Fonepay credentials.
// Returns null if not configured or disabled.
// ─────────────────────────────────────────────────────────────────────────────
async function getTenantFonepayCredentials(tenantId) {
  const { rows } = await db.query(
    `SELECT fonepay_merchant_code, fonepay_username,
            fonepay_password_encrypted, fonepay_secret_key_encrypted,
            fonepay_enabled
     FROM tenant_payment_credentials
     WHERE tenant_id = $1`,
    [tenantId]
  );

  if (rows.length === 0 || !rows[0].fonepay_enabled) return null;

  const row = rows[0];
  return {
    merchantCode: row.fonepay_merchant_code,
    username:     row.fonepay_username,
    password:     decrypt(row.fonepay_password_encrypted),
    secretKey:    decrypt(row.fonepay_secret_key_encrypted),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/payments/initiate
// Body: { invoice_id }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/initiate', tenantAuth, authorizeRoles('owner', 'staff', 'cashier'), async (req, res) => {
  const { invoice_id } = req.body;

  if (!invoice_id) {
    return res.status(400).json({ error: 'MISSING_FIELDS', required: ['invoice_id'] });
  }

  // ── Fetch invoice ─────────────────────────────────────────────────────────
  const { rows: invRows } = await db.query(
    `SELECT i.id, i.total_amount, i.payment_method, i.payment_status,
            i.qr_transaction_ref, i.qr_expires_at,
            t.subdomain
     FROM invoices i
     JOIN tenants t ON i.tenant_id = t.id
     WHERE i.id = $1 AND i.tenant_id = $2`,
    [invoice_id, req.tenantId]
  );

  if (invRows.length === 0) {
    return res.status(404).json({ error: 'INVOICE_NOT_FOUND' });
  }

  const invoice = invRows[0];

  if (invoice.payment_method !== 'qr') {
    return res.status(422).json({
      error:   'NOT_A_QR_INVOICE',
      message: 'This invoice was created with payment_method=cash',
    });
  }

  if (invoice.payment_status === 'completed') {
    return res.status(409).json({ error: 'ALREADY_PAID',
      message: 'This invoice has already been paid' });
  }

  if (invoice.payment_status === 'expired') {
    return res.status(409).json({ error: 'QR_EXPIRED',
      message: 'This QR has expired — create a new invoice or switch to cash' });
  }

  // ── Fetch per-tenant credentials ──────────────────────────────────────────
  // 422 PAYMENT_NOT_CONFIGURED = setup problem, not a network problem
  let creds;
  try {
    creds = await getTenantFonepayCredentials(req.tenantId);
  } catch (credErr) {
    console.error('[payments/initiate] Credential fetch/decrypt error:', credErr.message);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }

  if (!creds) {
    return res.status(422).json({
      error:   'PAYMENT_NOT_CONFIGURED',
      message: 'QR payment is not configured for this account — go to Settings → Payment to add Fonepay credentials',
    });
  }

  const baseUrl = process.env.FONEPAY_DYNAMICQR_URL ||
                  'https://dev-clientapi.fonepay.com/api/merchant';

  const amount   = Number(invoice.total_amount).toFixed(2);
  const prn      = invoice_id;
  const remarks1 = invoice_id;
  const remarks2 = invoice.subdomain || 'IMS';

  const dataValidation = signQrRequest(creds.secretKey, {
    amount, prn, merchantCode: creds.merchantCode, remarks1, remarks2,
  });

  const payload = {
    amount,
    prn,
    merchantCode: creds.merchantCode,
    remarks1,
    remarks2,
    username:         creds.username,
    password:         creds.password,
    dataValidation,
  };

  try {
    const { data } = await axios.post(
      `${baseUrl}/thirdPartyDynamicQrDownload`,
      payload,
      { timeout: 10000 }
    );

    const qrMessage = data?.response?.qrMessage;
    if (!qrMessage) {
      console.error('[payments/initiate] Unexpected Fonepay response:', data);
      return res.status(503).json({
        error:   'GATEWAY_UNAVAILABLE',
        message: 'Fonepay returned an unexpected response format',
      });
    }

    // Generate base64 PNG data URL for direct rendering in POS UI
    const qrDataUrl = await QRCode.toDataURL(qrMessage);
    const expiresAt = new Date(Date.now() + QR_EXPIRY_SECONDS * 1000);

    await db.query(
      `UPDATE invoices
       SET qr_transaction_ref = $1,
           qr_expires_at      = $2,
           payment_status     = 'pending'
       WHERE id = $3 AND tenant_id = $4`,
      [prn, expiresAt, invoice_id, req.tenantId]
    );

    return res.json({
      qr_data_url:        qrDataUrl,
      qr_message:         qrMessage,
      expires_at:         expiresAt,
      expires_in_seconds: QR_EXPIRY_SECONDS,
    });

  } catch (err) {
    const isAxiosError = err.isAxiosError || err.response;
    console.error('[payments/initiate] Gateway error:', isAxiosError ? err.message : err);
    return res.status(503).json({
      error:   'GATEWAY_UNAVAILABLE',
      message: 'Fonepay is unreachable — ask customer to pay cash',
      detail:  process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/payments/status/:invoiceId
// ─────────────────────────────────────────────────────────────────────────────
router.get('/status/:invoiceId', tenantAuth, authorizeRoles('owner', 'staff', 'cashier'), async (req, res) => {
  const { invoiceId } = req.params;

  const { rows } = await db.query(
    `SELECT id, payment_status, qr_transaction_ref, qr_expires_at
     FROM invoices
     WHERE id = $1 AND tenant_id = $2`,
    [invoiceId, req.tenantId]
  );

  if (rows.length === 0) {
    return res.status(404).json({ error: 'INVOICE_NOT_FOUND' });
  }

  const invoice = rows[0];

  // ── 1. Expiry check ───────────────────────────────────────────────────────
  if (invoice.payment_status === 'pending' && invoice.qr_expires_at &&
      new Date() > new Date(invoice.qr_expires_at)) {
    await db.query(
      `UPDATE invoices SET payment_status = 'expired' WHERE id = $1 AND tenant_id = $2`,
      [invoiceId, req.tenantId]
    );
    return res.json({
      status: 'expired',
      message: 'QR expired — switch to cash or create a new invoice',
    });
  }

  // ── 2. Terminal states — no Fonepay call needed ───────────────────────────
  if (invoice.payment_status === 'completed' || invoice.payment_status === 'expired') {
    return res.json({ status: invoice.payment_status });
  }

  // ── 3. No ref yet — initiate hasn't been called ───────────────────────────
  if (!invoice.qr_transaction_ref) {
    return res.json({ status: invoice.payment_status });
  }

  // ── 4. Fetch creds + poll Fonepay ─────────────────────────────────────────
  let creds;
  try {
    creds = await getTenantFonepayCredentials(req.tenantId);
  } catch (credErr) {
    console.error('[payments/status] Credential fetch/decrypt error:', credErr.message);
    // Graceful degradation — don't surface decryption errors to the POS
    return res.json({ status: invoice.payment_status, gateway_reachable: false });
  }

  // If credentials removed/disabled after QR was issued, degrade gracefully
  if (!creds) {
    return res.json({ status: invoice.payment_status, gateway_reachable: false });
  }

  const baseUrl        = process.env.FONEPAY_DYNAMICQR_URL ||
                         'https://dev-clientapi.fonepay.com/api/merchant';
  const prn            = invoice.qr_transaction_ref;
  const dataValidation = signStatusCheck(creds.secretKey, {
    prn, merchantCode: creds.merchantCode,
  });

  try {
    const { data } = await axios.get(
      `${baseUrl}/thirdPartyDynamicQrStatus`,
      { params: { prn, merchantCode: creds.merchantCode, dataValidation }, timeout: 8000 }
    );

    if (data?.response?.paymentStatus === 'success') {
      await db.query(
        `UPDATE invoices SET payment_status = 'completed'
         WHERE id = $1 AND tenant_id = $2 AND payment_status != 'completed'`,
        [invoiceId, req.tenantId]
      );
      return res.json({ status: 'completed' });
    }

    return res.json({ status: invoice.payment_status });

  } catch (err) {
    console.warn('[payments/status] Fonepay poll failed (graceful):', err.message);
    return res.json({ status: invoice.payment_status, gateway_reachable: false });
  }
});

module.exports = router;
