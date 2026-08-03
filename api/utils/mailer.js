// utils/mailer.js
// Phase 10 — Nodemailer + Gmail SMTP
// Build doc §5.1 — exact implementation from spec.
//
// sendMail({ to, subject, text, html }) — low-level send
//
// Named trigger functions (build doc §5.2):
//   sendWelcomeEmail(ownerEmail, businessName)
//   sendImportCompleteEmail(ownerEmail, importedRows, failedRows)
//   sendImportPartialEmail(ownerEmail, importedRows, failedRows, jobId)
//   sendLowStockDigestEmail(ownerEmail, products)
//   sendShiftVarianceEmail(ownerEmail, shiftData)
//
// All trigger functions fire-and-forget — they log errors but never throw,
// so a failed email never breaks the API response.
//
// Transport is lazy-evaluated so the server starts even if SMTP vars are
// missing (emails will fail gracefully with a console warning).

const nodemailer = require('nodemailer');

// ── Transporter ───────────────────────────────────────────────────────────────
// Built once, reused across all sends.
// secure: false + port 587 = STARTTLS (correct for Gmail App Password).
let _transporter = null;
function getTransporter() {
  if (_transporter) return _transporter;
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    return null; // Not configured — emails silently skipped
  }
  _transporter = nodemailer.createTransport({
    host:   process.env.SMTP_HOST,
    port:   Number(process.env.SMTP_PORT) || 587,
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
  return _transporter;
}

// ── Core send ─────────────────────────────────────────────────────────────────
/**
 * Send an email. Returns true on success, false if SMTP is not configured
 * or the send fails. Never throws — safe to fire-and-forget.
 *
 * @param {{ to: string, subject: string, text: string, html?: string }} opts
 * @returns {Promise<boolean>}
 */
async function sendMail({ to, subject, text, html }) {
  const transporter = getTransporter();
  if (!transporter) {
    console.warn(`[mailer] SMTP not configured — skipping email to ${to}: "${subject}"`);
    return false;
  }
  try {
    await transporter.sendMail({
      from:    process.env.EMAIL_FROM || process.env.SMTP_USER,
      to,
      subject,
      text,
      html: html || `<pre style="font-family:sans-serif">${text}</pre>`,
    });
    return true;
  } catch (err) {
    console.error(`[mailer] Failed to send "${subject}" to ${to}:`, err.message);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Trigger: New tenant registered
// Build doc §5.2 — fires from POST /api/auth/register on success
// ─────────────────────────────────────────────────────────────────────────────
async function sendWelcomeEmail(ownerEmail, businessName) {
  const subject = 'Welcome to IMS — your account is ready';
  const text = [
    `Hi,`,
    ``,
    `Your IMS account for ${businessName} has been created successfully.`,
    ``,
    `You can now log in and start adding products, opening shifts, and processing sales.`,
    ``,
    `Next steps:`,
    `  1. Add your products and barcodes`,
    `  2. Set opening stock`,
    `  3. Open a cash shift and start selling`,
    ``,
    `If you have any questions, reply to this email.`,
    ``,
    `— IMS Platform`,
  ].join('\n');

  return sendMail({ to: ownerEmail, subject, text });
}

// ─────────────────────────────────────────────────────────────────────────────
// Trigger: Bulk import completed (all rows succeeded)
// Build doc §5.2 — fires when import_job status → 'completed'
// ─────────────────────────────────────────────────────────────────────────────
async function sendImportCompleteEmail(ownerEmail, importedRows, failedRows = 0) {
  const subject = `Import complete — ${importedRows} products added, ${failedRows} failed`;
  const text = [
    `Your product import has finished.`,
    ``,
    `  Imported successfully : ${importedRows}`,
    `  Failed rows           : ${failedRows}`,
    ``,
    failedRows === 0
      ? `All rows imported cleanly. Your product catalog is up to date.`
      : `Some rows failed. Download the error report from the Import page to review and re-import.`,
    ``,
    `— IMS Platform`,
  ].join('\n');

  return sendMail({ to: ownerEmail, subject, text });
}

// ─────────────────────────────────────────────────────────────────────────────
// Trigger: Bulk import finished with errors (partial failure)
// Build doc §5.2 — fires when import_job status → 'partial'
// ─────────────────────────────────────────────────────────────────────────────
async function sendImportPartialEmail(ownerEmail, importedRows, failedRows, jobId) {
  const subject = 'Import finished with errors — action required';
  const text = [
    `Your product import has finished, but some rows could not be imported.`,
    ``,
    `  Imported successfully : ${importedRows}`,
    `  Failed rows           : ${failedRows}`,
    `  Job ID                : ${jobId}`,
    ``,
    `Action required:`,
    `  1. Go to Products → Import History`,
    `  2. Download the error report for job ${jobId}`,
    `  3. Correct the failed rows in your spreadsheet`,
    `  4. Re-import the corrected file as a new job`,
    ``,
    `— IMS Platform`,
  ].join('\n');

  return sendMail({ to: ownerEmail, subject, text });
}

// ─────────────────────────────────────────────────────────────────────────────
// Trigger: Low stock daily digest
// Build doc §5.2 — called from a daily cron job (Phase 14)
// products: [{ name, stock_on_hand, low_stock_alert_qty, location_name }]
// ─────────────────────────────────────────────────────────────────────────────
async function sendLowStockDigestEmail(ownerEmail, products) {
  if (!products || products.length === 0) return true; // Nothing to report

  const subject = `Stock alert — ${products.length} product${products.length === 1 ? '' : 's'} need attention`;

  const lines = products.map(p =>
    `  ${p.name.padEnd(30)} ${String(p.stock_on_hand).padStart(8)}  (alert: ${p.low_stock_alert_qty})  ${p.location_name || ''}`
  );

  const text = [
    `The following products are at or below their low-stock alert quantity:`,
    ``,
    `  Product                            On Hand    Alert Qty  Location`,
    `  ${'─'.repeat(70)}`,
    ...lines,
    ``,
    `Log in to IMS to review stock levels and raise purchase orders as needed.`,
    ``,
    `— IMS Platform`,
  ].join('\n');

  return sendMail({ to: ownerEmail, subject, text });
}

// ─────────────────────────────────────────────────────────────────────────────
// Trigger: Shift variance > 5%
// Build doc §5.2 — fires from POST /api/shifts/:id/close when variance_flag=true
// shiftData: { cashier_name, location_name, opened_at, closing_cash_balance,
//              expected_cash, cash_difference, invoice_number? }
// ─────────────────────────────────────────────────────────────────────────────
async function sendShiftVarianceEmail(ownerEmail, shiftData) {
  const {
    cashier_name,
    location_name,
    opened_at,
    closing_cash_balance,
    expected_cash,
    cash_difference,
  } = shiftData;

  const sign       = cash_difference >= 0 ? '+' : '';
  const direction  = cash_difference >= 0 ? 'OVER (excess cash)' : 'SHORT (missing cash)';
  const subject    = `Shift alert — cash difference detected`;

  const text = [
    `A cash shift has been closed with a variance above 5%.`,
    ``,
    `  Cashier         : ${cashier_name}`,
    `  Location        : ${location_name || 'N/A'}`,
    `  Shift opened    : ${new Date(opened_at).toLocaleString()}`,
    ``,
    `  Expected cash   : रू ${Number(expected_cash).toFixed(2)}`,
    `  Closing count   : रू ${Number(closing_cash_balance).toFixed(2)}`,
    `  Difference      : रू ${sign}${Number(cash_difference).toFixed(2)}  (${direction})`,
    ``,
    `Please review the shift reconciliation report in IMS.`,
    ``,
    `— IMS Platform`,
  ].join('\n');

  return sendMail({ to: ownerEmail, subject, text });
}

module.exports = {
  sendMail,
  sendWelcomeEmail,
  sendImportCompleteEmail,
  sendImportPartialEmail,
  sendLowStockDigestEmail,
  sendShiftVarianceEmail,
};
