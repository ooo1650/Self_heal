// routes/shifts.js
// Phase 5a — Cash shift open, close, and reconciliation report
//
// POST /api/shifts/open       — open a new shift         [owner, cashier]
// POST /api/shifts/:id/close  — close shift, compute reconciliation [owner, cashier (own)]
// GET  /api/shifts/:id        — reconciliation report    [owner]
//
// Shift lifecycle — §10:
//   open  → cashier enters opening cash → status='open'
//   close → cashier enters closing cash → expected_cash and cash_difference computed
//           status set to 'closed' — no further edits allowed
//
// All queries include WHERE tenant_id = $1.

const router         = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const bcrypt         = require('bcryptjs');
const db             = require('../db');
const tenantAuth     = require('../middleware/tenantAuth');
const authorizeRoles = require('../middleware/authorizeRoles');
const { sendShiftVarianceEmail } = require('../utils/mailer');
// ─────────────────────────────────────────────────────────────────────────────
// POST /api/shifts/open
// Creates a new cash shift for the authenticated staff member.
// A staff member may only have one open shift at a time per location.
//
// Body: { location_id, opening_cash_balance }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/open', tenantAuth, authorizeRoles('owner', 'staff', 'cashier'), async (req, res) => {
  const { location_id, opening_cash_balance } = req.body;

  if (!location_id || opening_cash_balance == null) {
    return res.status(400).json({
      error:    'MISSING_FIELDS',
      required: ['location_id', 'opening_cash_balance'],
    });
  }

  const openingBalance = Number(opening_cash_balance);
  if (!isFinite(openingBalance) || openingBalance < 0) {
    return res.status(400).json({
      error:   'INVALID_OPENING_BALANCE',
      message: 'opening_cash_balance must be a non-negative number',
    });
  }

  // Confirm location belongs to this tenant
  const { rows: locRows } = await db.query(
    'SELECT id FROM locations WHERE id = $1 AND tenant_id = $2',
    [location_id, req.tenantId]
  );
  if (locRows.length === 0) {
    return res.status(404).json({ error: 'LOCATION_NOT_FOUND' });
  }

  // Determine actor type and column
  const actorType     = req.userRole === 'cashier' ? 'cashier' : 'staff';
  const actorId       = actorType === 'cashier' ? req.cashierId : req.staffId;
  const actorCol      = actorType === 'cashier' ? 'cashier_id' : 'staff_id';

  // Prevent opening a second shift while one is already open
  const { rows: openShift } = await db.query(
    `SELECT id FROM cash_shifts
     WHERE ${actorCol} = $1 AND tenant_id = $2 AND status = 'open'`,
    [actorId, req.tenantId]
  );
  if (openShift.length > 0) {
    return res.status(409).json({
      error:          'SHIFT_ALREADY_OPEN',
      open_shift_id:  openShift[0].id,
      message:        'Close the current shift before opening a new one',
    });
  }

  try {
    const shiftId = uuidv4();
    const { rows } = await db.query(
      `INSERT INTO cash_shifts
         (id, tenant_id, location_id, ${actorCol}, opening_cash_balance, status)
       VALUES ($1, $2, $3, $4, $5, 'open')
       RETURNING *`,
      [shiftId, req.tenantId, location_id, actorId, openingBalance]
    );

    return res.status(201).json({
      message: 'Shift opened',
      shift:   rows[0],
    });
  } catch (err) {
    console.error('[shifts/open]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/shifts/:id/close
// Closes a shift and computes the reconciliation figures — §10.
//
// expected_cash   = opening_cash_balance + SUM(cash sales) - SUM(cash returns)
// cash_difference = closing_cash_balance - expected_cash
//   positive = cashier has more cash than expected (over)
//   negative = cashier has less cash than expected (short)
//
// Rules:
//   - Cashier can only close their own shift
//   - Owner can close any shift belonging to the tenant
//   - Already-closed shifts are rejected
//
// Body: { closing_cash_balance }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:id/close', tenantAuth, authorizeRoles('owner', 'staff', 'cashier'), async (req, res) => {
  const { closing_cash_balance, pin } = req.body;

  if (closing_cash_balance == null) {
    return res.status(400).json({
      error:    'MISSING_FIELDS',
      required: ['closing_cash_balance'],
    });
  }

  const closingBalance = Number(closing_cash_balance);
  if (!isFinite(closingBalance) || closingBalance < 0) {
    return res.status(400).json({
      error:   'INVALID_CLOSING_BALANCE',
      message: 'closing_cash_balance must be a non-negative number',
    });
  }

  // Phase 14c — inline PIN gate for switched cashier sessions.
  // PIN is now validated against the cashiers table.
  if (req.isSwitchedSession) {
    if (!pin) {
      return res.status(400).json({
        error:   'PIN_REQUIRED',
        message: 'Cashier PIN is required to close a switched session shift',
      });
    }
    const { rows: pinRows } = await db.query(
      'SELECT pin_hash, pin_attempts, pin_locked_until FROM cashiers WHERE id=$1 AND tenant_id=$2',
      [req.cashierId, req.tenantId]
    );
    if (pinRows.length === 0) return res.status(401).json({ error: 'CASHIER_NOT_FOUND' });
    const cs = pinRows[0];
    if (cs.pin_locked_until && new Date() < new Date(cs.pin_locked_until)) {
      const rem = Math.ceil((new Date(cs.pin_locked_until) - new Date()) / 60000);
      return res.status(423).json({ error: 'PIN_LOCKED', remaining_minutes: rem });
    }
    const match = await bcrypt.compare(String(pin), cs.pin_hash);
    if (!match) {
      const na = (cs.pin_attempts || 0) + 1;
      const lu = na >= 5 ? new Date(Date.now() + 15 * 60000).toISOString() : null;
      await db.query('UPDATE cashiers SET pin_attempts=$1, pin_locked_until=$2 WHERE id=$3',
        [na, lu, req.cashierId]);
      if (lu) return res.status(423).json({ error: 'PIN_LOCKED', remaining_minutes: 15 });
      return res.status(401).json({ error: 'INVALID_PIN', attempts_remaining: 5 - na });
    }
    await db.query('UPDATE cashiers SET pin_attempts=0, pin_locked_until=NULL WHERE id=$1', [req.cashierId]);
  }

  // Fetch the shift — must belong to this tenant
  const { rows: shiftRows } = await db.query(
    `SELECT * FROM cash_shifts WHERE id = $1 AND tenant_id = $2`,
    [req.params.id, req.tenantId]
  );

  if (shiftRows.length === 0) {
    return res.status(404).json({ error: 'SHIFT_NOT_FOUND' });
  }

  const shift = shiftRows[0];

  if (shift.status === 'closed') {
    return res.status(409).json({
      error:   'SHIFT_ALREADY_CLOSED',
      message: 'This shift has already been closed and locked',
    });
  }

  // Cashier may only close their own shift — owner/staff can close any
  if (req.userRole === 'cashier' && shift.cashier_id !== req.cashierId) {
    return res.status(403).json({
      error:   'FORBIDDEN',
      message: 'Cashiers can only close their own shift',
    });
  }

  try {
    // §10 — Compute expected_cash:
    // opening + cash sales (non-return) − cash returns
    // Invoices table may have no rows yet (first shift) — COALESCE handles NULL
    const { rows: salesRows } = await db.query(
      `SELECT
         COALESCE(SUM(
           CASE WHEN payment_method = 'cash' AND is_return = false
                THEN total_amount ELSE 0 END
         ), 0) AS cash_sales,
         COALESCE(SUM(
           CASE WHEN payment_method = 'cash' AND is_return = true
                THEN ABS(total_amount) ELSE 0 END
         ), 0) AS cash_returns
       FROM invoices
       WHERE cash_shift_id = $1
         AND tenant_id     = $2
         AND payment_status = 'completed'`,
      [shift.id, req.tenantId]
    );

    const cashSales   = Number(salesRows[0].cash_sales);
    const cashReturns = Number(salesRows[0].cash_returns);
    const openingBal  = Number(shift.opening_cash_balance);

    const expectedCash    = openingBal + cashSales - cashReturns;
    const cashDifference  = closingBalance - expectedCash;

    const { rows: updated } = await db.query(
      `UPDATE cash_shifts
       SET closing_cash_balance = $1,
           expected_cash        = $2,
           cash_difference      = $3,
           closed_at            = NOW(),
           status               = 'closed'
       WHERE id = $4 AND tenant_id = $5
       RETURNING *`,
      [closingBalance, expectedCash, cashDifference, shift.id, req.tenantId]
    );

    const varianceFlag = Math.abs(cashDifference) > (expectedCash * 0.05);

    // Phase 10 — fire shift variance alert email when diff > 5% — non-blocking
    // Resolve actor name from whichever column is set on the shift row.
    if (varianceFlag) {
      const actorNameQuery = shift.cashier_id
        ? `SELECT t.owner_email, c.full_name AS cashier_name, l.location_name
           FROM tenants t
           JOIN cashiers  c ON c.id = $2
           JOIN locations l ON l.id = $3
           WHERE t.id = $1`
        : `SELECT t.owner_email, s.full_name AS cashier_name, l.location_name
           FROM tenants t
           JOIN staff     s ON s.id = $2
           JOIN locations l ON l.id = $3
           WHERE t.id = $1`;
      const actorIdForEmail = shift.cashier_id || shift.staff_id;

      db.query(actorNameQuery, [req.tenantId, actorIdForEmail, shift.location_id])
        .then(({ rows }) => {
          if (rows[0]) {
            sendShiftVarianceEmail(rows[0].owner_email, {
              cashier_name:         rows[0].cashier_name,
              location_name:        rows[0].location_name,
              opened_at:            shift.opened_at,
              closing_cash_balance: closingBalance,
              expected_cash:        expectedCash,
              cash_difference:      cashDifference,
            }).catch(() => {});
          }
        }).catch(() => {});
    }

    return res.json({
      message:          'Shift closed',
      shift:            updated[0],
      cash_sales:       cashSales,
      cash_returns:     cashReturns,
      expected_cash:    expectedCash,
      cash_difference:  cashDifference,
      variance_flag:    varianceFlag,
    });
  } catch (err) {
    console.error('[shifts/close]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/shifts/:id
// Full reconciliation report for a single shift — §10 reconciliation query.
// Owner only — cashiers do not have access to reconciliation reports (§5).
//
// Returns the shift summary including:
//   - cashier name, opened_at / closed_at
//   - total transactions, cash sales, QR sales, returns
//   - opening / closing / expected / difference balances
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:id', tenantAuth, authorizeRoles('owner', 'staff'), async (req, res) => {
  try {
    // §10 reconciliation query — dual JOIN for staff/cashier actor
    const { rows } = await db.query(
      `SELECT
         cs.id                                        AS shift_id,
         cs.opened_at,
         cs.closed_at,
         cs.status,
         cs.staff_id,
         cs.cashier_id,
         COALESCE(s.full_name, c.full_name)           AS cashier_name,
         l.location_name,
         l.location_code,
         cs.opening_cash_balance,
         cs.closing_cash_balance,
         cs.expected_cash,
         cs.cash_difference,
         COUNT(i.id)                                  AS total_transactions,
         COALESCE(SUM(
           CASE WHEN i.payment_method = 'cash' AND NOT i.is_return
                THEN i.total_amount ELSE 0 END
         ), 0)                                        AS cash_sales,
         COALESCE(SUM(
           CASE WHEN i.payment_method = 'qr' AND NOT i.is_return
                THEN i.total_amount ELSE 0 END
         ), 0)                                        AS qr_sales,
         COALESCE(SUM(
           CASE WHEN i.is_return
                THEN ABS(i.total_amount) ELSE 0 END
         ), 0)                                        AS total_returns
       FROM cash_shifts cs
       LEFT JOIN staff     s ON cs.staff_id   = s.id
       LEFT JOIN cashiers  c ON cs.cashier_id = c.id
       JOIN locations l ON cs.location_id = l.id
       LEFT JOIN invoices i ON i.cash_shift_id = cs.id
                            AND i.tenant_id    = cs.tenant_id
                            AND i.payment_status = 'completed'
       WHERE cs.id        = $1
         AND cs.tenant_id = $2
       GROUP BY cs.id, s.full_name, c.full_name, l.location_name, l.location_code`,
      [req.params.id, req.tenantId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'SHIFT_NOT_FOUND' });
    }

    const report = rows[0];

    // Variance flag — >5% difference triggers owner alert (§5 / email phase)
    report.variance_flag = report.expected_cash > 0 &&
      Math.abs(Number(report.cash_difference)) > (Number(report.expected_cash) * 0.05);

    return res.json({ shift: report });
  } catch (err) {
    console.error('[shifts/get]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/shifts
// List shifts for this tenant. Used by POS to check for an open shift.
// ?status=open|closed   ?cashier_id=<uuid>   ?limit=20
// Owner sees all; cashier sees only their own.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', tenantAuth, authorizeRoles('owner', 'staff', 'cashier'), async (req, res) => {
  const { status, cashier_id } = req.query;
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || 20, 10) || 20));
  // Cashier actors can only see their own shifts
  // For staff/owner: optional ?cashier_id or ?staff_id filter
  const params = [req.tenantId];
  let   idx    = 2;
  let   filter = '';

  if (req.userRole === 'cashier') {
    filter += ` AND cs.cashier_id = $${idx++}`;
    params.push(req.cashierId);
  } else if (cashier_id) {
    // owner filtering by a specific cashier UUID — could be staff_id or cashier_id
    filter += ` AND (cs.cashier_id = $${idx} OR cs.staff_id = $${idx})`;
    idx++;
    params.push(cashier_id);
  }

  if (status && ['open', 'closed'].includes(status)) {
    filter += ` AND cs.status = $${idx++}`;
    params.push(status);
  }

  try {
    const { rows } = await db.query(
      `SELECT cs.id, cs.staff_id, cs.cashier_id, cs.location_id, cs.status,
              cs.opening_cash_balance, cs.opened_at, cs.closed_at,
              COALESCE(s.full_name, c.full_name) AS cashier_name,
              l.location_name, l.location_code
       FROM cash_shifts cs
       LEFT JOIN staff     s ON cs.staff_id   = s.id
       LEFT JOIN cashiers  c ON cs.cashier_id = c.id
       JOIN locations l ON cs.location_id = l.id
       WHERE cs.tenant_id = $1 ${filter}
       ORDER BY cs.opened_at DESC
       LIMIT ${limit}`,
      params
    );
    return res.json({ shifts: rows });
  } catch (err) {
    console.error('[shifts/list]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

module.exports = router;
