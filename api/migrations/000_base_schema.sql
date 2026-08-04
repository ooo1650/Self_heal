-- =============================================================================
-- IMS Platform — Base Schema (Fresh Install)
-- =============================================================================
-- Reflects the fully-migrated state after all 10 migrations (001-010).
-- Run this ONCE on a brand-new database. Do NOT run migrations 001-010 after.
--
-- Usage:
--   docker exec -i ims-postgres psql -U imsuser -d imsdb \
--     < api/migrations/000_base_schema.sql
-- =============================================================================

-- ── Enum types ────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE vat_category_enum AS ENUM (
    'TAXABLE_13', 'EXEMPT', 'ZERO_RATED', 'NON_TAXABLE'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Global internal-barcode sequence (migration 005) ─────────────────────────
CREATE SEQUENCE IF NOT EXISTS global_product_seq
  START 1 INCREMENT 1 MINVALUE 1;

-- =============================================================================
-- TENANCY, LOCATIONS & STAFF
-- =============================================================================

CREATE TABLE IF NOT EXISTS tenants (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_name VARCHAR(255) NOT NULL,
  subdomain     VARCHAR(100) UNIQUE NOT NULL,
  owner_email   VARCHAR(255) UNIQUE NOT NULL,
  pan_number    VARCHAR(20),
  address       TEXT,
  phone         VARCHAR(20),
  logo_url      TEXT,
  config        JSONB DEFAULT '{}'::jsonb NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS locations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  location_name   VARCHAR(255) NOT NULL,
  location_code   VARCHAR(20)  NOT NULL,
  is_main_branch  BOOLEAN DEFAULT false NOT NULL,
  is_headquarters BOOLEAN DEFAULT false NOT NULL,  -- migration 010
  address         TEXT,
  phone           VARCHAR(20),
  created_at      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Staff: email-login users (owner + staff roles). No cashiers here (migration 005).
CREATE TABLE IF NOT EXISTS staff (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  location_id           UUID REFERENCES locations(id) ON DELETE SET NULL,
  full_name             VARCHAR(255) NOT NULL,
  email                 VARCHAR(255) UNIQUE NOT NULL,     -- NOT NULL post-migration 005
  password_hash         TEXT NOT NULL,                    -- NOT NULL post-migration 005
  role                  VARCHAR(20)  NOT NULL CHECK (role IN ('owner', 'staff')),
  access_tier           VARCHAR(10)  NOT NULL DEFAULT 'staff'
                        CHECK (access_tier IN ('owner', 'manager', 'staff')),
  max_item_discount_pct NUMERIC(5,2) DEFAULT 10.00 NOT NULL,
  is_active             BOOLEAN DEFAULT true NOT NULL,
  must_change_password  BOOLEAN DEFAULT false NOT NULL,
  created_at            TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Cashiers: PIN-only POS actors, completely separate from staff (migration 005).
CREATE TABLE IF NOT EXISTS cashiers (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  location_id           UUID REFERENCES locations(id) ON DELETE SET NULL,
  full_name             VARCHAR(255) NOT NULL,
  pin_hash              TEXT NOT NULL,
  pin_attempts          INTEGER DEFAULT 0 NOT NULL,
  pin_locked_until      TIMESTAMPTZ,
  max_item_discount_pct NUMERIC(5,2) DEFAULT 10.00 NOT NULL,
  is_active             BOOLEAN DEFAULT true NOT NULL,
  created_at            TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cashiers_tenant ON cashiers (tenant_id);

-- Staff branch access (migration 010)
CREATE TABLE IF NOT EXISTS staff_branch_access (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id    UUID        NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  location_id UUID        NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (staff_id, location_id)
);

CREATE INDEX IF NOT EXISTS idx_staff_branch_access_tenant_loc
  ON staff_branch_access (tenant_id, location_id);

CREATE TABLE IF NOT EXISTS password_change_otps (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id   UUID REFERENCES staff(id) ON DELETE CASCADE NOT NULL,
  otp_code   VARCHAR(6) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used       BOOLEAN DEFAULT false NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- =============================================================================
-- PRODUCTS & BARCODES
-- =============================================================================

CREATE TABLE IF NOT EXISTS products (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  name                VARCHAR(255) NOT NULL,
  base_cost_price     NUMERIC(12,2) NOT NULL,
  mrp                 NUMERIC(12,2) NOT NULL,
  vat_category        vat_category_enum DEFAULT 'TAXABLE_13' NOT NULL,
  custom_vat_rate     NUMERIC(5,2),
  attributes          JSONB DEFAULT '{}'::jsonb NOT NULL,
  image_url           TEXT,
  low_stock_alert_qty NUMERIC(10,3) DEFAULT 10.000,
  is_active           BOOLEAN DEFAULT true NOT NULL,
  created_at          TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS product_barcodes (
  barcode           VARCHAR(100) PRIMARY KEY,
  product_id        UUID REFERENCES products(id) ON DELETE CASCADE NOT NULL,
  tenant_id         UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  unit_name         VARCHAR(50) NOT NULL,
  conversion_factor NUMERIC(10,3) DEFAULT 1.000 NOT NULL,
  sale_price        NUMERIC(12,2) NOT NULL,
  is_active         BOOLEAN DEFAULT true NOT NULL
);

-- =============================================================================
-- CASH SHIFTS  (defined before invoices — invoices FK references it)
-- =============================================================================

CREATE TABLE IF NOT EXISTS cash_shifts (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  location_id          UUID REFERENCES locations(id) ON DELETE CASCADE NOT NULL,
  -- Exactly one of staff_id / cashier_id is NOT NULL (migration 005)
  staff_id             UUID REFERENCES staff(id) ON DELETE CASCADE,
  cashier_id           UUID REFERENCES cashiers(id) ON DELETE CASCADE,
  opening_cash_balance NUMERIC(12,2) NOT NULL,
  closing_cash_balance NUMERIC(12,2),
  expected_cash        NUMERIC(12,2),
  cash_difference      NUMERIC(12,2),
  opened_at            TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
  closed_at            TIMESTAMPTZ,
  status               VARCHAR(20) DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  CONSTRAINT cash_shifts_actor_check CHECK (
    (staff_id IS NOT NULL AND cashier_id IS NULL) OR
    (staff_id IS NULL     AND cashier_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_shifts_cashier_id
  ON cash_shifts (cashier_id, opened_at DESC);

-- =============================================================================
-- INVOICES & LINE ITEMS
-- =============================================================================

CREATE TABLE IF NOT EXISTS invoices (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  location_id         UUID REFERENCES locations(id) ON DELETE CASCADE NOT NULL,
  -- Exactly one of staff_id / cashier_id is NOT NULL (migration 005)
  staff_id            UUID REFERENCES staff(id) ON DELETE SET NULL,
  cashier_id          UUID REFERENCES cashiers(id) ON DELETE SET NULL,
  cash_shift_id       UUID REFERENCES cash_shifts(id) ON DELETE SET NULL,
  invoice_number      VARCHAR(100) NOT NULL,
  subtotal_amount     NUMERIC(12,2) NOT NULL,
  bill_discount_flat  NUMERIC(12,2) DEFAULT 0.00,
  bill_discount_pct   NUMERIC(5,2)  DEFAULT 0.00,
  tax_amount          NUMERIC(12,2) DEFAULT 0.00,
  total_amount        NUMERIC(12,2) NOT NULL,
  amount_tendered     NUMERIC(12,2),
  change_returned     NUMERIC(12,2),
  payment_method      VARCHAR(20) NOT NULL CHECK (payment_method IN ('cash', 'qr')),
  payment_status      VARCHAR(30) DEFAULT 'completed',
  qr_transaction_ref  VARCHAR(255),
  qr_expires_at       TIMESTAMPTZ,
  idempotency_key     VARCHAR(255) UNIQUE NOT NULL,
  is_return           BOOLEAN DEFAULT false NOT NULL,
  original_invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
  notes               TEXT,
  created_at          TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT invoices_actor_check CHECK (
    (staff_id IS NOT NULL AND cashier_id IS NULL) OR
    (staff_id IS NULL     AND cashier_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_invoices_cashier_id
  ON invoices (cashier_id, created_at DESC);

CREATE TABLE IF NOT EXISTS invoice_items (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id         UUID REFERENCES invoices(id) ON DELETE CASCADE NOT NULL,
  product_id         UUID REFERENCES products(id) ON DELETE RESTRICT NOT NULL,
  scanned_barcode    VARCHAR(100) REFERENCES product_barcodes(barcode),
  quantity_sold      NUMERIC(10,3) NOT NULL,
  unit_sale_price    NUMERIC(12,2) NOT NULL,
  item_discount_flat NUMERIC(12,2) DEFAULT 0.00,
  item_discount_pct  NUMERIC(5,2)  DEFAULT 0.00,
  tax_rate_pct       NUMERIC(5,2)  DEFAULT 0.00,
  final_row_total    NUMERIC(12,2) NOT NULL,
  item_modifiers     JSONB DEFAULT '{}'::jsonb NOT NULL
);

-- =============================================================================
-- STOCK LEDGER, BALANCE & ANALYTICS MV
-- =============================================================================

CREATE TABLE IF NOT EXISTS stock_ledger (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  location_id             UUID REFERENCES locations(id) ON DELETE CASCADE NOT NULL,
  product_id              UUID REFERENCES products(id) ON DELETE CASCADE NOT NULL,
  quantity_delta          NUMERIC(10,3) NOT NULL,
  movement_type           VARCHAR(50) NOT NULL,
  associated_reference_id UUID,
  notes                   TEXT,
  -- Both nullable; one or neither set depending on who triggered the movement
  staff_id                UUID REFERENCES staff(id) ON DELETE SET NULL,
  cashier_id              UUID REFERENCES cashiers(id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS stock_balance (
  tenant_id     UUID NOT NULL,
  location_id   UUID NOT NULL,
  product_id    UUID NOT NULL,
  stock_on_hand NUMERIC(10,3) NOT NULL DEFAULT 0.000,
  updated_at    TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY (tenant_id, location_id, product_id)
);

CREATE MATERIALIZED VIEW IF NOT EXISTS stock_mv_analytics AS
SELECT
  p.tenant_id, sb.location_id, p.id AS product_id,
  p.name, p.mrp, p.base_cost_price, p.low_stock_alert_qty, p.attributes,
  sb.stock_on_hand,
  sb.stock_on_hand < 0                      AS is_negative_stock,
  sb.stock_on_hand <= p.low_stock_alert_qty AS is_low_stock
FROM products p
JOIN stock_balance sb ON p.id = sb.product_id;

CREATE UNIQUE INDEX IF NOT EXISTS stock_mv_analytics_pk
  ON stock_mv_analytics (tenant_id, location_id, product_id);

-- =============================================================================
-- SUPPLIERS, PURCHASE ORDERS & GRN
-- =============================================================================

CREATE TABLE IF NOT EXISTS suppliers (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  supplier_name  VARCHAR(255) NOT NULL,
  pan_number     VARCHAR(20),
  contact_person VARCHAR(255),
  phone          VARCHAR(20),
  email          VARCHAR(255),
  address        TEXT,
  is_active      BOOLEAN DEFAULT true NOT NULL,
  created_at     TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  location_id UUID REFERENCES locations(id) ON DELETE CASCADE NOT NULL,
  supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  po_number   VARCHAR(100) NOT NULL,
  status      VARCHAR(30) DEFAULT 'pending'
              CHECK (status IN ('pending','partially_received','fully_received','cancelled')),
  expected_date DATE,
  notes       TEXT,
  staff_id    UUID REFERENCES staff(id) ON DELETE SET NULL,
  cashier_id  UUID REFERENCES cashiers(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id        UUID REFERENCES purchase_orders(id) ON DELETE CASCADE NOT NULL,
  product_id   UUID REFERENCES products(id) ON DELETE CASCADE NOT NULL,
  ordered_qty  NUMERIC(10,3) NOT NULL,
  received_qty NUMERIC(10,3) DEFAULT 0.000,
  unit_cost    NUMERIC(12,2) NOT NULL
);

CREATE TABLE IF NOT EXISTS goods_received_notes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  location_id    UUID REFERENCES locations(id) ON DELETE CASCADE NOT NULL,
  po_id          UUID REFERENCES purchase_orders(id) ON DELETE SET NULL,
  supplier_id    UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  grn_number     VARCHAR(100) NOT NULL,
  received_date  DATE NOT NULL,
  bill_reference VARCHAR(100),
  notes          TEXT,
  staff_id       UUID REFERENCES staff(id) ON DELETE SET NULL,
  cashier_id     UUID REFERENCES cashiers(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS grn_items (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  grn_id       UUID REFERENCES goods_received_notes(id) ON DELETE CASCADE NOT NULL,
  product_id   UUID REFERENCES products(id) ON DELETE CASCADE NOT NULL,
  received_qty NUMERIC(10,3) NOT NULL,
  unit_cost    NUMERIC(12,2) NOT NULL
);

-- =============================================================================
-- INTER-BRANCH TRANSFERS
-- =============================================================================

CREATE TABLE IF NOT EXISTS inter_branch_transfers (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  from_location_id UUID REFERENCES locations(id) NOT NULL,
  to_location_id   UUID REFERENCES locations(id) NOT NULL,
  product_id       UUID REFERENCES products(id) NOT NULL,
  quantity         NUMERIC(10,3) NOT NULL,
  transfer_ref     VARCHAR(100),
  notes            TEXT,
  status           VARCHAR(20) DEFAULT 'completed',
  staff_id         UUID REFERENCES staff(id) ON DELETE SET NULL,
  cashier_id       UUID REFERENCES cashiers(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- =============================================================================
-- PAYMENTS — PER-TENANT FONEPAY CREDENTIALS
-- =============================================================================

CREATE TABLE IF NOT EXISTS tenant_payment_credentials (
  tenant_id                    UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  fonepay_merchant_code        VARCHAR(100),
  fonepay_username             VARCHAR(100),
  fonepay_password_encrypted   TEXT,
  fonepay_secret_key_encrypted TEXT,
  fonepay_enabled              BOOLEAN DEFAULT false,
  verification_status          VARCHAR(20) DEFAULT 'unverified'
                               CHECK (verification_status IN
                               ('unverified','verifying','verified','failed')),
  verified_at                  TIMESTAMPTZ,
  verification_invoice_id      UUID,
  updated_at                   TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- SYSTEM LOGS & IMPORT JOBS
-- =============================================================================

CREATE TABLE IF NOT EXISTS system_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  location_id   UUID REFERENCES locations(id) ON DELETE SET NULL,
  log_level     VARCHAR(20) NOT NULL CHECK (log_level IN ('info','warning','error')),
  module_origin VARCHAR(100) NOT NULL,
  alert_message TEXT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS import_jobs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  staff_id      UUID REFERENCES staff(id) ON DELETE SET NULL,
  cashier_id    UUID REFERENCES cashiers(id) ON DELETE SET NULL,
  status        VARCHAR(20) DEFAULT 'in_progress'
                CHECK (status IN ('in_progress','completed','partial','failed')),
  total_rows    INTEGER NOT NULL,
  imported_rows INTEGER DEFAULT 0,
  failed_rows   INTEGER DEFAULT 0,
  error_log     JSONB DEFAULT '[]'::jsonb NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
  completed_at  TIMESTAMPTZ
);

-- =============================================================================
-- PERFORMANCE INDEXES
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_products_tenant         ON products (tenant_id);
CREATE INDEX IF NOT EXISTS idx_product_barcodes_tenant ON product_barcodes (tenant_id);
CREATE INDEX IF NOT EXISTS idx_invoices_tenant         ON invoices (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice   ON invoice_items (invoice_id);
CREATE INDEX IF NOT EXISTS idx_stock_ledger_tenant     ON stock_ledger (tenant_id, product_id);
CREATE INDEX IF NOT EXISTS idx_stock_balance_tenant    ON stock_balance (tenant_id, location_id);
CREATE INDEX IF NOT EXISTS idx_cash_shifts_tenant      ON cash_shifts (tenant_id, location_id);
CREATE INDEX IF NOT EXISTS idx_staff_tenant            ON staff (tenant_id);
CREATE INDEX IF NOT EXISTS idx_suppliers_tenant        ON suppliers (tenant_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_tenant  ON purchase_orders (tenant_id);
CREATE INDEX IF NOT EXISTS idx_grn_tenant              ON goods_received_notes (tenant_id);

-- =============================================================================
-- ROW-LEVEL SECURITY (enabled; policies written when needed)
-- =============================================================================

ALTER TABLE tenants                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE locations                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE cashiers                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_branch_access        ENABLE ROW LEVEL SECURITY;
ALTER TABLE password_change_otps       ENABLE ROW LEVEL SECURITY;
ALTER TABLE products                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_barcodes           ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_items              ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_ledger               ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_balance              ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_orders            ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_order_items       ENABLE ROW LEVEL SECURITY;
ALTER TABLE goods_received_notes       ENABLE ROW LEVEL SECURITY;
ALTER TABLE grn_items                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_shifts                ENABLE ROW LEVEL SECURITY;
ALTER TABLE inter_branch_transfers     ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_payment_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_logs                ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_jobs                ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- DONE
-- =============================================================================
SELECT 'Schema created successfully' AS status,
       count(*) AS table_count
FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
