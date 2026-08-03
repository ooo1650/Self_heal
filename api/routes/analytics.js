// routes/analytics.js
// Phase 9a + 9b — Owner analytics and reporting — §14, §15.3
// All routes: tenantAuth + authorizeRoles('owner', 'staff')
// All queries: WHERE tenant_id = $1
//
// Phase 9a:
// GET /api/analytics/revenue             — period revenue + prior period comparison
// GET /api/analytics/product-roi         — §14 exact query, gross profit ranked
// GET /api/analytics/top-sellers         — by qty and by revenue
// GET /api/analytics/payment-split       — cash vs QR breakdown
// GET /api/analytics/returns-summary     — return value and rate %
// GET /api/analytics/cashier-performance — per-cashier KPIs
//
// Phase 9b:
// GET /api/analytics/stock-alerts        — negative stock + low stock from matview
// GET /api/analytics/slow-moving         — active products with zero sales in N days
// GET /api/analytics/expiry              — products expiring within N days
// GET /api/analytics/purchase-vs-sales   — GRN cost vs invoice revenue + inventory value
// GET /api/analytics/branches            — per-location revenue and gross profit
// GET /api/analytics/diagnostics         — system_logs tail
//
// Date params: ?start_date=YYYY-MM-DD &end_date=YYYY-MM-DD
// Default: current calendar month (1st → today) if omitted.

const router     = require('express').Router();
const db         = require('../db');
const tenantAuth = require('../middleware/tenantAuth');
const authorizeRoles = require('../middleware/authorizeRoles');

// ─────────────────────────────────────────────────────────────────────────────
// Date range helper
// Returns { start, end } as ISO strings suitable for BETWEEN in SQL.
// end is extended to 23:59:59.999 of the end_date so the full day is included.
// Also computes the prior period of equal length for comparison.
// ─────────────────────────────────────────────────────────────────────────────
function parseDateRange(query) {
  const now   = new Date();
  // Default start = first day of current month
  const defaultStart = new Date(now.getFullYear(), now.getMonth(), 1);
  // Default end   = today end of day
  const defaultEnd   = new Date(now.getFullYear(), now.getMonth(), now.getDate(),
                                23, 59, 59, 999);

  const start = query.start_date ? new Date(query.start_date + 'T00:00:00.000Z')
                                 : defaultStart;
  const end   = query.end_date   ? new Date(query.end_date   + 'T23:59:59.999Z')
                                 : defaultEnd;

  // Prior period: same length, immediately before start
  const periodMs    = end.getTime() - start.getTime();
  const priorEnd    = new Date(start.getTime() - 1);             // 1ms before start
  const priorStart  = new Date(priorEnd.getTime() - periodMs);

  return {
    start:      start.toISOString(),
    end:        end.toISOString(),
    priorStart: priorStart.toISOString(),
    priorEnd:   priorEnd.toISOString(),
    periodMs,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/analytics/revenue
// Total revenue for the requested period + prior period of equal length.
// percent_change: ((current - prior) / prior) * 100
//   — null if prior period had zero revenue (avoids division by zero)
//
// Optional ?location_id to filter to a single branch.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/revenue', tenantAuth, authorizeRoles('owner', 'staff'), async (req, res) => {
  const { start, end, priorStart, priorEnd } = parseDateRange(req.query);
  const { location_id } = req.query;

  const params     = [req.tenantId, start, end];
  const priorParams = [req.tenantId, priorStart, priorEnd];
  let   locFilter  = '';

  if (location_id) {
    locFilter = ` AND i.location_id = $4`;
    params.push(location_id);
    priorParams.push(location_id);
  }

  try {
    const [curRows, priorRows] = await Promise.all([
      db.query(
        `SELECT
           COALESCE(SUM(i.total_amount), 0)        AS total_revenue,
           COALESCE(SUM(i.tax_amount),   0)        AS total_tax,
           COUNT(i.id)::int                        AS invoice_count,
           COALESCE(AVG(i.total_amount), 0)        AS avg_transaction_value
         FROM invoices i
         WHERE i.tenant_id  = $1
           AND i.is_return  = false
           AND i.payment_status = 'completed'
           AND i.created_at BETWEEN $2 AND $3
           ${locFilter}`,
        params
      ),
      db.query(
        `SELECT COALESCE(SUM(i.total_amount), 0) AS total_revenue
         FROM invoices i
         WHERE i.tenant_id  = $1
           AND i.is_return  = false
           AND i.payment_status = 'completed'
           AND i.created_at BETWEEN $2 AND $3
           ${locFilter}`,
        priorParams
      ),
    ]);

    const current    = Number(curRows.rows[0].total_revenue);
    const prior      = Number(priorRows.rows[0].total_revenue);
    const pctChange  = prior === 0
      ? null
      : parseFloat(((current - prior) / prior * 100).toFixed(2));

    return res.json({
      period:        { start, end },
      prior_period:  { start: priorStart, end: priorEnd },
      current:  {
        total_revenue:         parseFloat(Number(curRows.rows[0].total_revenue).toFixed(2)),
        total_tax:             parseFloat(Number(curRows.rows[0].total_tax).toFixed(2)),
        invoice_count:         curRows.rows[0].invoice_count,
        avg_transaction_value: parseFloat(Number(curRows.rows[0].avg_transaction_value).toFixed(2)),
      },
      prior: {
        total_revenue: parseFloat(prior.toFixed(2)),
      },
      percent_change: pctChange,
    });
  } catch (err) {
    console.error('[analytics/revenue]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/analytics/product-roi
// Exact query from §14.1.
// Returns gross_profit, margin_pct, units_sold, total_revenue, total_cogs
// per product, ordered by gross_profit DESC.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/product-roi', tenantAuth, authorizeRoles('owner', 'staff'), async (req, res) => {
  const { start, end } = parseDateRange(req.query);

  try {
    const { rows } = await db.query(
      `SELECT
         p.id                                                        AS product_id,
         p.name,
         SUM(ii.quantity_sold)                                       AS units_sold,
         SUM(ii.final_row_total)                                     AS total_revenue,
         SUM(ii.quantity_sold * p.base_cost_price)                   AS total_cogs,
         SUM(ii.final_row_total)
           - SUM(ii.quantity_sold * p.base_cost_price)               AS gross_profit,
         ROUND(
           (SUM(ii.final_row_total) - SUM(ii.quantity_sold * p.base_cost_price))
           / NULLIF(SUM(ii.final_row_total), 0) * 100
         , 2)                                                        AS margin_pct
       FROM invoice_items ii
       JOIN invoices  i ON ii.invoice_id  = i.id
       JOIN products  p ON ii.product_id  = p.id
       WHERE i.tenant_id   = $1
         AND i.is_return   = false
         AND i.payment_status = 'completed'
         AND i.created_at BETWEEN $2 AND $3
       GROUP BY p.id, p.name
       ORDER BY gross_profit DESC`,
      [req.tenantId, start, end]
    );

    return res.json({
      period:  { start, end },
      products: rows,
    });
  } catch (err) {
    console.error('[analytics/product-roi]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/analytics/top-sellers
// Two ranked lists: by quantity_sold and by revenue.
// ?limit=10 (default), max 100.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/top-sellers', tenantAuth, authorizeRoles('owner', 'staff'), async (req, res) => {
  const { start, end } = parseDateRange(req.query);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 10));

  try {
    // Single aggregation query — sort in JS to avoid two round-trips
    const { rows } = await db.query(
      `SELECT
         p.id           AS product_id,
         p.name,
         SUM(ii.quantity_sold)    AS total_qty,
         SUM(ii.final_row_total)  AS total_revenue
       FROM invoice_items ii
       JOIN invoices i ON ii.invoice_id = i.id
       JOIN products p ON ii.product_id = p.id
       WHERE i.tenant_id     = $1
         AND i.is_return     = false
         AND i.payment_status = 'completed'
         AND i.created_at BETWEEN $2 AND $3
       GROUP BY p.id, p.name`,
      [req.tenantId, start, end]
    );

    const byQty = [...rows]
      .sort((a, b) => Number(b.total_qty) - Number(a.total_qty))
      .slice(0, limit);

    const byRevenue = [...rows]
      .sort((a, b) => Number(b.total_revenue) - Number(a.total_revenue))
      .slice(0, limit);

    return res.json({
      period:        { start, end },
      by_quantity:   byQty,
      by_revenue:    byRevenue,
    });
  } catch (err) {
    console.error('[analytics/top-sellers]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/analytics/payment-split
// SUM and COUNT grouped by payment_method, sales invoices only (is_return=false).
// ─────────────────────────────────────────────────────────────────────────────
router.get('/payment-split', tenantAuth, authorizeRoles('owner', 'staff'), async (req, res) => {
  const { start, end } = parseDateRange(req.query);

  try {
    const { rows } = await db.query(
      `SELECT
         i.payment_method,
         COUNT(i.id)::int              AS invoice_count,
         COALESCE(SUM(i.total_amount), 0) AS total_amount
       FROM invoices i
       WHERE i.tenant_id      = $1
         AND i.is_return      = false
         AND i.payment_status = 'completed'
         AND i.created_at BETWEEN $2 AND $3
       GROUP BY i.payment_method`,
      [req.tenantId, start, end]
    );

    // Ensure both payment methods always appear (even with 0) for UI predictability
    const result = { cash: { invoice_count: 0, total_amount: 0 },
                     qr:   { invoice_count: 0, total_amount: 0 } };
    for (const row of rows) {
      result[row.payment_method] = {
        invoice_count: row.invoice_count,
        total_amount:  parseFloat(Number(row.total_amount).toFixed(2)),
      };
    }

    const grandTotal = parseFloat(
      (Number(result.cash.total_amount) + Number(result.qr.total_amount)).toFixed(2)
    );

    return res.json({
      period:      { start, end },
      cash:        result.cash,
      qr:          result.qr,
      grand_total: grandTotal,
    });
  } catch (err) {
    console.error('[analytics/payment-split]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/analytics/returns-summary
// total_sales   = SUM(total_amount) WHERE is_return=false
// total_returns = SUM(ABS(total_amount)) WHERE is_return=true
// return_rate_pct = total_returns / total_sales * 100
//   — null if total_sales = 0
// ─────────────────────────────────────────────────────────────────────────────
router.get('/returns-summary', tenantAuth, authorizeRoles('owner', 'staff'), async (req, res) => {
  const { start, end } = parseDateRange(req.query);

  try {
    const { rows } = await db.query(
      `SELECT
         COALESCE(SUM(CASE WHEN i.is_return = false
                       THEN i.total_amount ELSE 0 END), 0)           AS total_sales,
         COALESCE(SUM(CASE WHEN i.is_return = true
                       THEN ABS(i.total_amount) ELSE 0 END), 0)      AS total_returns,
         COUNT(CASE WHEN i.is_return = false THEN 1 END)::int        AS sales_count,
         COUNT(CASE WHEN i.is_return = true  THEN 1 END)::int        AS returns_count
       FROM invoices i
       WHERE i.tenant_id      = $1
         AND i.payment_status = 'completed'
         AND i.created_at BETWEEN $2 AND $3`,
      [req.tenantId, start, end]
    );

    const totalSales   = parseFloat(Number(rows[0].total_sales).toFixed(2));
    const totalReturns = parseFloat(Number(rows[0].total_returns).toFixed(2));
    const returnRate   = totalSales === 0
      ? null
      : parseFloat((totalReturns / totalSales * 100).toFixed(2));

    return res.json({
      period:           { start, end },
      total_sales:      totalSales,
      total_returns:    totalReturns,
      sales_count:      rows[0].sales_count,
      returns_count:    rows[0].returns_count,
      return_rate_pct:  returnRate,
    });
  } catch (err) {
    console.error('[analytics/returns-summary]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/analytics/cashier-performance
// Per cashier: invoice_count, total_revenue, avg_transaction_value,
//              return_count, return_rate_pct
// Optional ?location_id to filter to one branch.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/cashier-performance', tenantAuth, authorizeRoles('owner', 'staff'), async (req, res) => {
  const { start, end } = parseDateRange(req.query);
  const { location_id } = req.query;

  const params = [req.tenantId, start, end];
  let   locFilter = '';
  if (location_id) {
    locFilter = ` AND i.location_id = $4`;
    params.push(location_id);
  }

  try {
    const { rows } = await db.query(
      `SELECT
         COALESCE(s.id,   c.id)           AS actor_id,
         COALESCE(s.full_name, c.full_name) AS full_name,
         CASE WHEN s.id IS NOT NULL THEN s.role ELSE 'cashier' END AS role,
         l.location_name,
         COUNT(CASE WHEN i.is_return = false THEN 1 END)::int        AS invoice_count,
         COALESCE(SUM(CASE WHEN i.is_return = false
                       THEN i.total_amount ELSE 0 END), 0)           AS total_revenue,
         COALESCE(AVG(CASE WHEN i.is_return = false
                       THEN i.total_amount END), 0)                  AS avg_transaction_value,
         COUNT(CASE WHEN i.is_return = true THEN 1 END)::int         AS return_count,
         ROUND(
           COUNT(CASE WHEN i.is_return = true  THEN 1 END)::numeric
           / NULLIF(COUNT(CASE WHEN i.is_return = false THEN 1 END), 0) * 100
         , 2)                                                        AS return_rate_pct
       FROM invoices i
       LEFT JOIN staff     s ON i.staff_id   = s.id
       LEFT JOIN cashiers  c ON i.cashier_id = c.id
       JOIN locations l ON i.location_id = l.id
       WHERE i.tenant_id      = $1
         AND i.payment_status = 'completed'
         AND i.created_at BETWEEN $2 AND $3
         ${locFilter}
       GROUP BY s.id, s.full_name, s.role, c.id, c.full_name, l.location_name
       ORDER BY total_revenue DESC`,
      params
    );

    return res.json({
      period:    { start, end },
      cashiers:  rows.map(r => ({
        ...r,
        total_revenue:         parseFloat(Number(r.total_revenue).toFixed(2)),
        avg_transaction_value: parseFloat(Number(r.avg_transaction_value).toFixed(2)),
      })),
    });
  } catch (err) {
    console.error('[analytics/cashier-performance]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 9b routes
// ─────────────────────────────────────────────────────────────────────────────

// ── GET /api/analytics/stock-alerts ──────────────────────────────────────────
// Reads from stock_mv_analytics materialised view.
// Returns rows where is_negative_stock OR is_low_stock for this tenant.
//
// NOTE: The matview is refreshed hourly by a cron job (Phase 14).
// If data looks stale, run:  REFRESH MATERIALIZED VIEW CONCURRENTLY stock_mv_analytics;
// The response includes a note reminding callers that this is a snapshot.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/stock-alerts', tenantAuth, authorizeRoles('owner', 'staff'), async (req, res) => {
  const { location_id } = req.query;
  const params = [req.tenantId];
  let locFilter = '';
  if (location_id) {
    locFilter = ' AND sm.location_id = $2';
    params.push(location_id);
  }

  try {
    const { rows } = await db.query(
      `SELECT
         sm.product_id,
         sm.name                 AS product_name,
         sm.location_id,
         l.location_name,
         l.location_code,
         sm.stock_on_hand,
         sm.low_stock_alert_qty,
         sm.is_negative_stock,
         sm.is_low_stock
       FROM stock_mv_analytics sm
       JOIN locations l ON l.id = sm.location_id
       WHERE sm.tenant_id = $1
         AND (sm.is_negative_stock OR sm.is_low_stock)
         ${locFilter}
       ORDER BY sm.is_negative_stock DESC, sm.stock_on_hand ASC`,
      params
    );

    return res.json({
      alerts:       rows,
      alert_count:  rows.length,
      matview_note: 'Data is from stock_mv_analytics (refreshed hourly). ' +
                    'Run REFRESH MATERIALIZED VIEW CONCURRENTLY stock_mv_analytics for latest.',
    });
  } catch (err) {
    console.error('[analytics/stock-alerts]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ── GET /api/analytics/slow-moving ───────────────────────────────────────────
// Active products with zero completed sales in the last N days.
// ?days=60 (default)
//
// Uses a LEFT JOIN to find products with NO matching invoice_items rows
// in the lookback window. Also returns days_since_last_sale (null if never sold).
// ─────────────────────────────────────────────────────────────────────────────
router.get('/slow-moving', tenantAuth, authorizeRoles('owner', 'staff'), async (req, res) => {
  const days = Math.max(1, parseInt(req.query.days, 10) || 60);

  try {
    const { rows } = await db.query(
      `SELECT
         p.id                                AS product_id,
         p.name,
         p.mrp,
         p.low_stock_alert_qty,
         COALESCE(sb.stock_on_hand, 0)       AS stock_on_hand,
         -- Most recent sale date across all locations for this product
         MAX(i.created_at)                   AS last_sale_at,
         -- Days since last sale; null if never sold
         CASE
           WHEN MAX(i.created_at) IS NOT NULL
           THEN EXTRACT(DAY FROM NOW() - MAX(i.created_at))::int
           ELSE NULL
         END                                 AS days_since_last_sale
       FROM products p
       -- Aggregate stock across all locations for this tenant
       LEFT JOIN stock_balance sb
         ON sb.product_id = p.id AND sb.tenant_id = p.tenant_id
       -- Any sale of this product within the lookback window
       LEFT JOIN invoice_items ii ON ii.product_id = p.id
       LEFT JOIN invoices i
         ON i.id          = ii.invoice_id
         AND i.tenant_id  = $1
         AND i.is_return  = false
         AND i.payment_status = 'completed'
         AND i.created_at >= NOW() - ($2 || ' days')::interval
       WHERE p.tenant_id = $1
         AND p.is_active = true
       GROUP BY p.id, p.name, p.mrp, p.low_stock_alert_qty, sb.stock_on_hand
       -- Slow-moving = no sale in the lookback window
       HAVING MAX(i.created_at) IS NULL
       ORDER BY days_since_last_sale DESC NULLS FIRST, p.name ASC`,
      [req.tenantId, days]
    );

    return res.json({
      days_lookback:  days,
      slow_moving:    rows,
      product_count:  rows.length,
    });
  } catch (err) {
    console.error('[analytics/slow-moving]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ── GET /api/analytics/expiry ─────────────────────────────────────────────────
// Products with attributes->>'expiry_date' set and expiring within N days.
// ?days=30 (default). Negative days_until_expiry = already expired.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/expiry', tenantAuth, authorizeRoles('owner', 'staff'), async (req, res) => {
  const days = Math.max(1, parseInt(req.query.days, 10) || 30);

  try {
    const { rows } = await db.query(
      `SELECT
         p.id                                      AS product_id,
         p.name,
         p.attributes->>'expiry_date'              AS expiry_date,
         (p.attributes->>'expiry_date')::date      AS expiry_date_parsed,
         COALESCE(sb.stock_on_hand, 0)             AS stock_on_hand,
         -- Negative means already expired
         ((p.attributes->>'expiry_date')::date - CURRENT_DATE)::int
                                                   AS days_until_expiry
       FROM products p
       LEFT JOIN stock_balance sb
         ON sb.product_id = p.id AND sb.tenant_id = p.tenant_id
       WHERE p.tenant_id  = $1
         AND p.is_active  = true
         AND p.attributes->>'expiry_date' IS NOT NULL
         AND (p.attributes->>'expiry_date')::date
               <= CURRENT_DATE + ($2 || ' days')::interval
       ORDER BY (p.attributes->>'expiry_date')::date ASC`,
      [req.tenantId, days]
    );

    return res.json({
      days_window:    days,
      expiring:       rows,
      product_count:  rows.length,
    });
  } catch (err) {
    console.error('[analytics/expiry]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ── GET /api/analytics/purchase-vs-sales ──────────────────────────────────────
// Three figures:
//   total_purchases     — SUM(received_qty × unit_cost) from GRNs in date range
//   total_sales         — SUM(final_row_total) from non-return invoices in date range
//   current_inventory_value — SUM(stock_on_hand × base_cost_price) NOW (not date-bound)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/purchase-vs-sales', tenantAuth, authorizeRoles('owner', 'staff'), async (req, res) => {
  const { start, end } = parseDateRange(req.query);

  try {
    const [purchRow, salesRow, invValueRow] = await Promise.all([
      // GRN cost in period
      db.query(
        `SELECT COALESCE(SUM(gi.received_qty * gi.unit_cost), 0) AS total_purchases
         FROM grn_items gi
         JOIN goods_received_notes g ON gi.grn_id = g.id
         WHERE g.tenant_id  = $1
           AND g.received_date BETWEEN $2::date AND $3::date`,
        [req.tenantId, start, end]
      ),
      // Sales revenue in period
      db.query(
        `SELECT COALESCE(SUM(ii.final_row_total), 0) AS total_sales
         FROM invoice_items ii
         JOIN invoices i ON ii.invoice_id = i.id
         WHERE i.tenant_id      = $1
           AND i.is_return      = false
           AND i.payment_status = 'completed'
           AND i.created_at BETWEEN $2 AND $3`,
        [req.tenantId, start, end]
      ),
      // Current inventory value — point-in-time snapshot, not date-bounded
      db.query(
        `SELECT COALESCE(SUM(sb.stock_on_hand * p.base_cost_price), 0) AS inventory_value
         FROM stock_balance sb
         JOIN products p ON p.id = sb.product_id
         WHERE sb.tenant_id = $1
           AND p.is_active  = true`,
        [req.tenantId]
      ),
    ]);

    const totalPurchases      = parseFloat(Number(purchRow.rows[0].total_purchases).toFixed(2));
    const totalSales          = parseFloat(Number(salesRow.rows[0].total_sales).toFixed(2));
    const currentInvValue     = parseFloat(Number(invValueRow.rows[0].inventory_value).toFixed(2));
    const grossProfit         = parseFloat((totalSales - totalPurchases).toFixed(2));
    const grossMarginPct      = totalSales === 0
      ? null
      : parseFloat((grossProfit / totalSales * 100).toFixed(2));

    return res.json({
      period:                   { start, end },
      total_purchases:          totalPurchases,
      total_sales:              totalSales,
      gross_profit:             grossProfit,
      gross_margin_pct:         grossMarginPct,
      current_inventory_value:  currentInvValue,
    });
  } catch (err) {
    console.error('[analytics/purchase-vs-sales]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ── GET /api/analytics/branches ───────────────────────────────────────────────
// Per-location breakdown: transaction count, revenue, COGS, gross profit.
// Works correctly with a single location.
// Optional ?start_date / ?end_date — default current month.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/branches', tenantAuth, authorizeRoles('owner', 'staff'), async (req, res) => {
  const { start, end } = parseDateRange(req.query);

  try {
    const { rows } = await db.query(
      `SELECT
         l.id                                                        AS location_id,
         l.location_name,
         l.location_code,
         l.is_main_branch,
         COUNT(DISTINCT i.id)::int                                   AS transaction_count,
         COALESCE(SUM(
           CASE WHEN i.is_return = false THEN i.total_amount ELSE 0 END
         ), 0)                                                       AS total_revenue,
         COALESCE(SUM(
           CASE WHEN i.is_return = false
                THEN ii.quantity_sold * p.base_cost_price ELSE 0 END
         ), 0)                                                       AS total_cogs,
         COALESCE(SUM(
           CASE WHEN i.is_return = false THEN i.total_amount ELSE 0 END
         ), 0) -
         COALESCE(SUM(
           CASE WHEN i.is_return = false
                THEN ii.quantity_sold * p.base_cost_price ELSE 0 END
         ), 0)                                                       AS gross_profit
       FROM locations l
       LEFT JOIN invoices i
         ON i.location_id     = l.id
         AND i.tenant_id      = $1
         AND i.payment_status = 'completed'
         AND i.created_at BETWEEN $2 AND $3
       LEFT JOIN invoice_items ii ON ii.invoice_id = i.id
       LEFT JOIN products p       ON p.id = ii.product_id
       WHERE l.tenant_id = $1
       GROUP BY l.id, l.location_name, l.location_code, l.is_main_branch
       ORDER BY total_revenue DESC`,
      [req.tenantId, start, end]
    );

    return res.json({
      period:    { start, end },
      branches:  rows.map(r => ({
        ...r,
        total_revenue: parseFloat(Number(r.total_revenue).toFixed(2)),
        total_cogs:    parseFloat(Number(r.total_cogs).toFixed(2)),
        gross_profit:  parseFloat(Number(r.gross_profit).toFixed(2)),
      })),
    });
  } catch (err) {
    console.error('[analytics/branches]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ── GET /api/analytics/diagnostics ────────────────────────────────────────────
// Tail of system_logs for this tenant.
// ?log_level=info|warning|error  — optional filter
// ?limit=50 (default), max 500
// ─────────────────────────────────────────────────────────────────────────────
router.get('/diagnostics', tenantAuth, authorizeRoles('owner', 'staff'), async (req, res) => {
  const { log_level, location_id } = req.query;
  const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 50));

  const VALID_LEVELS = ['info', 'warning', 'error'];
  const params = [req.tenantId];
  let   idx    = 2;
  let   filter = '';

  if (log_level && VALID_LEVELS.includes(log_level)) {
    filter += ` AND sl.log_level = $${idx++}`;
    params.push(log_level);
  }
  if (location_id) {
    filter += ` AND sl.location_id = $${idx++}`;
    params.push(location_id);
  }

  try {
    const { rows } = await db.query(
      `SELECT
         sl.id,
         sl.log_level,
         sl.module_origin,
         sl.alert_message,
         sl.location_id,
         l.location_name,
         sl.created_at
       FROM system_logs sl
       LEFT JOIN locations l ON l.id = sl.location_id
       WHERE sl.tenant_id = $1 ${filter}
       ORDER BY sl.created_at DESC
       LIMIT ${limit}`,
      params
    );

    return res.json({
      logs:  rows,
      count: rows.length,
      limit,
    });
  } catch (err) {
    console.error('[analytics/diagnostics]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/analytics/revenue-chart
// Daily revenue breakdown for chart rendering.
// Returns [{date, revenue, invoice_count}] ordered by date ASC.
// Default: last 30 days.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/revenue-chart', tenantAuth, authorizeRoles('owner', 'staff'), async (req, res) => {
  const { start, end } = parseDateRange(req.query);
  try {
    const { rows } = await db.query(
      `SELECT
         DATE(i.created_at)                            AS date,
         COALESCE(SUM(i.total_amount), 0)              AS revenue,
         COUNT(i.id)::int                              AS invoice_count
       FROM invoices i
       WHERE i.tenant_id      = $1
         AND i.is_return      = false
         AND i.payment_status = 'completed'
         AND i.created_at BETWEEN $2 AND $3
       GROUP BY DATE(i.created_at)
       ORDER BY DATE(i.created_at) ASC`,
      [req.tenantId, start, end]
    );
    return res.json({ chart: rows, period: { start, end } });
  } catch (err) {
    console.error('[analytics/revenue-chart]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// GET /api/analytics/category-split
// Revenue split by VAT category for donut/pie chart.
router.get('/category-split', tenantAuth, authorizeRoles('owner', 'staff'), async (req, res) => {
  const { start, end } = parseDateRange(req.query);
  try {
    const { rows } = await db.query(
      `SELECT
         p.vat_category,
         COALESCE(SUM(ii.final_row_total), 0) AS revenue,
         SUM(ii.quantity_sold)::int            AS units_sold
       FROM invoice_items ii
       JOIN invoices i ON ii.invoice_id = i.id
       JOIN products p ON ii.product_id = p.id
       WHERE i.tenant_id      = $1
         AND i.is_return      = false
         AND i.payment_status = 'completed'
         AND i.created_at BETWEEN $2 AND $3
       GROUP BY p.vat_category
       ORDER BY revenue DESC`,
      [req.tenantId, start, end]
    );
    return res.json({ split: rows });
  } catch (err) {
    console.error('[analytics/category-split]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

module.exports = router;
