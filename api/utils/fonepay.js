// utils/fonepay.js
// Fonepay HMAC signing helpers — Phase 8
//
// Fonepay Dynamic QR signing spec:
//   dataValidation = HMAC-SHA512(secret_key, `${amount},${prn},${merchantCode},${remarks1},${remarks2}`)
//   digest = hex
//
// Status check signing spec:
//   dataValidation = HMAC-SHA512(secret_key, `${prn},${merchantCode}`)
//   digest = hex
//
// These are pure functions with no I/O — fully unit-testable without any
// network calls or env variables (pass secrets in directly).

const crypto = require('crypto');

/**
 * Compute the dataValidation signature for a QR initiation request.
 *
 * @param {string} secretKey   - FONEPAY_SECRET_KEY
 * @param {object} params
 * @param {string} params.amount       - total_amount.toFixed(2)
 * @param {string} params.prn          - payment reference number (invoice_id)
 * @param {string} params.merchantCode - FONEPAY_MERCHANT_CODE
 * @param {string} params.remarks1     - invoice_id
 * @param {string} params.remarks2     - tenant subdomain or 'IMS'
 * @returns {string} HMAC-SHA512 hex digest
 */
function signQrRequest(secretKey, { amount, prn, merchantCode, remarks1, remarks2 }) {
  const message = `${amount},${prn},${merchantCode},${remarks1},${remarks2}`;
  return crypto
    .createHmac('sha512', secretKey)
    .update(message)
    .digest('hex');
}

/**
 * Compute the dataValidation signature for a QR status check request.
 *
 * @param {string} secretKey   - FONEPAY_SECRET_KEY
 * @param {object} params
 * @param {string} params.prn          - the qr_transaction_ref stored on the invoice
 * @param {string} params.merchantCode - FONEPAY_MERCHANT_CODE
 * @returns {string} HMAC-SHA512 hex digest
 */
function signStatusCheck(secretKey, { prn, merchantCode }) {
  const message = `${prn},${merchantCode}`;
  return crypto
    .createHmac('sha512', secretKey)
    .update(message)
    .digest('hex');
}

module.exports = { signQrRequest, signStatusCheck };
