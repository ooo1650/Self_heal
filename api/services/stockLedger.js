// services/stockLedger.js
// Reusable stock movement helper — §3.4
//
// writeStockMovement(client, params) must be called inside an existing
// transaction (BEGIN / COMMIT / ROLLBACK owned by the caller).
// It performs two writes atomically:
//   1. INSERT into stock_ledger  — immutable audit trail
//   2. UPSERT into stock_balance — live running total for POS queries
//
// Actor columns (migration 005):
//   stock_ledger.staff_id   — set when the actor is a staff/owner row
//   stock_ledger.cashier_id — set when the actor is a cashier row
//   Pass exactly one of staff_id / cashier_id (or neither, both default null).
//
// Valid movement_type values (mirrors the DB comment in §3.4):
//   opening_stock | grn_intake | sale | sale_return |
//   inter_branch_out | inter_branch_in | manual_adjustment | write_off

const VALID_MOVEMENT_TYPES = [
  'opening_stock',
  'grn_intake',
  'sale',
  'sale_return',
  'inter_branch_out',
  'inter_branch_in',
  'manual_adjustment',
  'write_off',
];

/**
 * Write a stock movement and keep stock_balance in sync.
 * Must be called with a pg client that already has an open transaction.
 *
 * @param {import('pg').PoolClient} client  - Connected pg client (in transaction)
 * @param {object}  params
 * @param {string}  params.tenant_id
 * @param {string}  params.location_id
 * @param {string}  params.product_id
 * @param {number}  params.quantity_delta        - Positive = stock in, Negative = stock out
 * @param {string}  params.movement_type         - One of VALID_MOVEMENT_TYPES
 * @param {string}  [params.associated_reference_id] - Invoice / PO / GRN / transfer UUID
 * @param {string}  [params.notes]
 * @param {string}  [params.staff_id]    - staff.id when actor is owner/staff
 * @param {string}  [params.cashier_id]  - cashiers.id when actor is a cashier
 * @returns {Promise<object>}  The inserted stock_ledger row
 */
async function writeStockMovement(client, {
  tenant_id,
  location_id,
  product_id,
  quantity_delta,
  movement_type,
  associated_reference_id = null,
  notes                   = null,
  staff_id                = null,
  cashier_id              = null,
}) {
  // ── Guard: movement_type must be a known value ─────────────────────────────
  if (!VALID_MOVEMENT_TYPES.includes(movement_type)) {
    throw new Error(
      `Invalid movement_type "${movement_type}". ` +
      `Valid values: ${VALID_MOVEMENT_TYPES.join(', ')}`
    );
  }

  // ── Guard: quantity_delta must be a finite number ──────────────────────────
  const delta = Number(quantity_delta);
  if (!isFinite(delta)) {
    throw new Error(`quantity_delta must be a finite number, got "${quantity_delta}"`);
  }

  // ── 1. Append to stock_ledger (immutable audit row) ───────────────────────
  const { rows } = await client.query(
    `INSERT INTO stock_ledger
       (tenant_id, location_id, product_id, quantity_delta, movement_type,
        associated_reference_id, notes, staff_id, cashier_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      tenant_id,
      location_id,
      product_id,
      delta,
      movement_type,
      associated_reference_id,
      notes,
      staff_id,
      cashier_id,
    ]
  );

  // ── 2. Upsert stock_balance (live running total) ───────────────────────────
  // ON CONFLICT: add the delta to the existing stock_on_hand.
  // This is safe inside a transaction — concurrent writes are serialised
  // by the row-level lock acquired on conflict.
  await client.query(
    `INSERT INTO stock_balance (tenant_id, location_id, product_id, stock_on_hand, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (tenant_id, location_id, product_id)
     DO UPDATE SET
       stock_on_hand = stock_balance.stock_on_hand + EXCLUDED.stock_on_hand,
       updated_at    = NOW()`,
    [tenant_id, location_id, product_id, delta]
  );

  return rows[0];
}

module.exports = { writeStockMovement, VALID_MOVEMENT_TYPES };
