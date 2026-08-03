// routes/pos.js
// Phase 14c — Cashier switch-in for POS session
//
// POST /api/pos/switch-cashier      — owner/staff swaps to a cashier's identity
// POST /api/pos/refresh-cashier-token — slide the 10-min cashier session
// POST /api/pos/switch-back          — PIN confirmation before returning to owner/staff session
//
// Cashiers are now a separate table (cashiers) with PIN-only auth.
// They are NOT in the staff table and do NOT have JWT login credentials.
// A cashier_token embeds { cashier_id, role:'cashier', is_switched_session:true }
// instead of staff_id.
//
// PIN lockout: 5 attempts → 15-min lockout (pin_locked_until).

const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const db     = require('../db');
const tenantAuth = require('../middleware/tenantAuth');

const PIN_MAX_ATTEMPTS  = 5;
const PIN_LOCKOUT_MINS  = 15;
const CASHIER_TOKEN_TTL = '10m';

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/pos/switch-cashier
// Called by an authenticated owner/staff token to switch into a cashier's PIN session.
//
// Body: { cashier_id, pin }
// Returns: { cashier_token, cashier_name, expires_in: 600 }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/switch-cashier', tenantAuth, async (req, res) => {
  const { cashier_id, pin } = req.body;

  if (!cashier_id || !pin) {
    return res.status(400).json({
      error:    'MISSING_FIELDS',
      required: ['cashier_id', 'pin'],
    });
  }

  // Fetch the cashier — must belong to this tenant and be active
  const { rows } = await db.query(
    `SELECT id, full_name, is_active,
            pin_hash, pin_attempts, pin_locked_until,
            max_item_discount_pct
     FROM cashiers
     WHERE id = $1 AND tenant_id = $2`,
    [cashier_id, req.tenantId]
  );

  if (rows.length === 0 || !rows[0].is_active) {
    return res.status(404).json({ error: 'CASHIER_NOT_FOUND' });
  }

  const cashier = rows[0];

  // ── Lockout check ─────────────────────────────────────────────────────────
  if (cashier.pin_locked_until && new Date() < new Date(cashier.pin_locked_until)) {
    const remainMs   = new Date(cashier.pin_locked_until) - new Date();
    const remainMins = Math.ceil(remainMs / 60000);
    return res.status(423).json({
      error:             'PIN_LOCKED',
      message:           `Too many wrong attempts. Try again in ${remainMins} minute${remainMins !== 1 ? 's' : ''}.`,
      locked_until:      cashier.pin_locked_until,
      remaining_minutes: remainMins,
    });
  }

  // ── PIN verification ──────────────────────────────────────────────────────
  const match = await bcrypt.compare(String(pin), cashier.pin_hash);

  if (!match) {
    const newAttempts = (cashier.pin_attempts || 0) + 1;
    const nowLocked   = newAttempts >= PIN_MAX_ATTEMPTS;
    const lockedUntil = nowLocked
      ? new Date(Date.now() + PIN_LOCKOUT_MINS * 60 * 1000).toISOString()
      : null;

    await db.query(
      `UPDATE cashiers
       SET pin_attempts    = $1,
           pin_locked_until = $2
       WHERE id = $3`,
      [newAttempts, lockedUntil, cashier.id]
    );

    if (nowLocked) {
      return res.status(423).json({
        error:             'PIN_LOCKED',
        message:           `Too many wrong PINs. Account locked for ${PIN_LOCKOUT_MINS} minutes.`,
        locked_until:      lockedUntil,
        remaining_minutes: PIN_LOCKOUT_MINS,
      });
    }

    return res.status(401).json({
      error:             'INVALID_PIN',
      attempts_remaining: PIN_MAX_ATTEMPTS - newAttempts,
    });
  }

  // ── PIN correct — reset attempts ──────────────────────────────────────────
  await db.query(
    'UPDATE cashiers SET pin_attempts = 0, pin_locked_until = NULL WHERE id = $1',
    [cashier.id]
  );

  // Reassign the owner/staff's open shift to this cashier (cashier_id column).
  // The shift currently has staff_id = req.staffId; move it to cashier_id so
  // that invoices and shift close created under the cashier_token reference
  // the correct actor column.
  await db.query(
    `UPDATE cash_shifts
     SET staff_id   = NULL,
         cashier_id = $1
     WHERE tenant_id = $2
       AND status    = 'open'
       AND staff_id  = $3`,
    [cashier.id, req.tenantId, req.staffId]
  );

  const payload = {
    tenant_id:           req.tenantId,
    cashier_id:          cashier.id,
    role:                'cashier',
    is_switched_session: true,
  };

  const cashier_token = jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: CASHIER_TOKEN_TTL,
  });

  return res.json({
    cashier_token,
    cashier_name:          cashier.full_name,
    cashier_id:            cashier.id,
    max_item_discount_pct: Number(cashier.max_item_discount_pct),
    expires_in:            600,   // seconds — client refreshes on activity
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/pos/refresh-cashier-token
// Slide the 10-minute cashier session on POS activity.
// Requires a valid is_switched_session cashier_token.
// Returns: { cashier_token, expires_in }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/refresh-cashier-token', tenantAuth, async (req, res) => {
  if (!req.isSwitchedSession) {
    return res.status(403).json({
      error:   'NOT_A_SWITCHED_SESSION',
      message: 'refresh-cashier-token requires an active cashier_token',
    });
  }

  const payload = {
    tenant_id:           req.tenantId,
    cashier_id:          req.cashierId,
    role:                'cashier',
    is_switched_session: true,
  };

  const cashier_token = jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: CASHIER_TOKEN_TTL,
  });

  return res.json({ cashier_token, expires_in: 600 });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/pos/switch-back
// Called with the cashier_token to confirm PIN before returning to owner/staff session.
// PIN validated against cashiers table.
//
// Body: { pin }
// Returns: 200 { confirmed: true } on success
// ─────────────────────────────────────────────────────────────────────────────
router.post('/switch-back', tenantAuth, async (req, res) => {
  if (!req.isSwitchedSession) {
    return res.status(403).json({
      error:   'NOT_A_SWITCHED_SESSION',
      message: 'switch-back must be called with a cashier_token, not the owner/staff token',
    });
  }

  const { pin } = req.body;
  if (!pin) {
    return res.status(400).json({ error: 'MISSING_FIELDS', required: ['pin'] });
  }

  const { rows } = await db.query(
    `SELECT pin_hash, pin_attempts, pin_locked_until
     FROM cashiers WHERE id = $1 AND tenant_id = $2`,
    [req.cashierId, req.tenantId]
  );

  if (rows.length === 0) return res.status(404).json({ error: 'CASHIER_NOT_FOUND' });
  const cashier = rows[0];

  // Lockout check
  if (cashier.pin_locked_until && new Date() < new Date(cashier.pin_locked_until)) {
    const remainMins = Math.ceil((new Date(cashier.pin_locked_until) - new Date()) / 60000);
    return res.status(423).json({
      error: 'PIN_LOCKED', remaining_minutes: remainMins,
    });
  }

  const match = await bcrypt.compare(String(pin), cashier.pin_hash);
  if (!match) {
    const newAttempts = (cashier.pin_attempts || 0) + 1;
    const nowLocked   = newAttempts >= PIN_MAX_ATTEMPTS;
    const lockedUntil = nowLocked
      ? new Date(Date.now() + PIN_LOCKOUT_MINS * 60 * 1000).toISOString()
      : null;
    await db.query(
      'UPDATE cashiers SET pin_attempts=$1, pin_locked_until=$2 WHERE id=$3',
      [newAttempts, lockedUntil, req.cashierId]
    );
    if (nowLocked) return res.status(423).json({ error: 'PIN_LOCKED', remaining_minutes: PIN_LOCKOUT_MINS });
    return res.status(401).json({ error: 'INVALID_PIN', attempts_remaining: PIN_MAX_ATTEMPTS - newAttempts });
  }

  await db.query(
    'UPDATE cashiers SET pin_attempts=0, pin_locked_until=NULL WHERE id=$1',
    [req.cashierId]
  );

  return res.json({ confirmed: true });
});

module.exports = router;
