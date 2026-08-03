-- Migration 011 — Demo Tenant Seed (all UUIDs hardcoded)
-- Tenant:   ebf41468-6df6-4b09-acbd-150846f3761d  (already exists)
-- Location: 26f1a6d1-767e-4a81-9bf4-c458559e3f29  (already exists)
-- Run each block individually on Aiven. All inserts use ON CONFLICT DO NOTHING.

-- ── A3. Demo Staff ────────────────────────────────────────────────────────────
-- Password: demo1234  (bcrypt cost 12)
INSERT INTO staff (
  id, tenant_id, location_id, full_name, email, password_hash,
  role, access_tier, is_active, must_change_password, max_item_discount_pct
) VALUES (
  '858ceba2-7a0c-436b-8898-3f872de2bbc9',
  'ebf41468-6df6-4b09-acbd-150846f3761d',
  '26f1a6d1-767e-4a81-9bf4-c458559e3f29',
  'Demo Staff',
  'demo@laxmikirana.com',
  '$2a$12$Zku/fTDltv4rUDoEah2yN.EAOFIIGhv4kw5mqwJgKCAPnZXrxJm1u',
  'staff', 'staff', true, false, 10.00
) ON CONFLICT (id) DO NOTHING;

-- Verify: SELECT id, email, access_tier FROM staff WHERE email='demo@laxmikirana.com';

-- ── A3b. Staff Branch Access ──────────────────────────────────────────────────
INSERT INTO staff_branch_access (staff_id, tenant_id, location_id)
VALUES (
  '858ceba2-7a0c-436b-8898-3f872de2bbc9',
  'ebf41468-6df6-4b09-acbd-150846f3761d',
  '26f1a6d1-767e-4a81-9bf4-c458559e3f29'
) ON CONFLICT (staff_id, location_id) DO NOTHING;

-- ── A4. Demo Cashier ──────────────────────────────────────────────────────────
-- PIN: 1234  (bcrypt cost 12)
INSERT INTO cashiers (
  id, tenant_id, location_id, full_name,
  pin_hash, is_active, max_item_discount_pct
) VALUES (
  '29635da4-faba-41bb-a600-ec67120f700e',
  'ebf41468-6df6-4b09-acbd-150846f3761d',
  '26f1a6d1-767e-4a81-9bf4-c458559e3f29',
  'Sita (Cashier)',
  '$2a$12$.beCvxed7KOlINI1uXlCqu6Ns6NLVUpQetI1VDXImRU1PRQL./iUi',
  true, 5.00
) ON CONFLICT (id) DO NOTHING;

-- Verify: SELECT full_name FROM cashiers WHERE tenant_id='ebf41468-6df6-4b09-acbd-150846f3761d';

-- ── A5. Suppliers ─────────────────────────────────────────────────────────────
INSERT INTO suppliers (id, tenant_id, supplier_name, contact_person, phone, address, is_active) VALUES
  (gen_random_uuid(),'ebf41468-6df6-4b09-acbd-150846f3761d','CG Foods Nepal',        'Anil Chaudhary','01-4412233','Balaju, Kathmandu',      true),
  (gen_random_uuid(),'ebf41468-6df6-4b09-acbd-150846f3761d','Unilever Nepal Pvt',    'Priya Thapa',   '01-4445566','Teku, Kathmandu',        true),
  (gen_random_uuid(),'ebf41468-6df6-4b09-acbd-150846f3761d','Shree Wholesale Pasal', 'Ram Bahadur',   '9851-112233','Asan, Kathmandu',       true),
  (gen_random_uuid(),'ebf41468-6df6-4b09-acbd-150846f3761d','Nepal Dairy Products',  'Sunita KC',     '01-4332211','Balaju, Kathmandu',      true)
ON CONFLICT DO NOTHING;

-- Verify: SELECT supplier_name FROM suppliers WHERE tenant_id='ebf41468-6df6-4b09-acbd-150846f3761d';

-- ── A6. Products ──────────────────────────────────────────────────────────────
INSERT INTO products (id, tenant_id, name, base_cost_price, mrp, vat_category, is_active) VALUES
  ('c497fc33-6508-4202-b3e4-be70fb820a94','ebf41468-6df6-4b09-acbd-150846f3761d','Wai Wai Chicken Noodles (75g)',   13.00, 18.00,'TAXABLE_13',true),
  ('ad60626f-95c0-49c6-88be-ea484c5696fc','ebf41468-6df6-4b09-acbd-150846f3761d','Wai Wai Veg Masala Noodles (75g)',13.00, 18.00,'TAXABLE_13',true),
  ('c3acfa09-9dfd-4462-825c-bd8a8ed6a7a7','ebf41468-6df6-4b09-acbd-150846f3761d','Rara Chicken Noodles (75g)',       12.00, 16.00,'TAXABLE_13',true),
  ('522581b9-aff2-4a80-8039-455d472eb821','ebf41468-6df6-4b09-acbd-150846f3761d','Mayos Noodles (80g)',              11.00, 15.00,'TAXABLE_13',true),
  ('4daa3492-53e6-49fb-9be4-a24f12c5c11f','ebf41468-6df6-4b09-acbd-150846f3761d','Parle-G Biscuit (100g)',            9.00, 12.00,'TAXABLE_13',true),
  ('b1fabb4f-bd3a-4d3b-9bc8-5475f1b4c86c','ebf41468-6df6-4b09-acbd-150846f3761d','Monaco Biscuit (100g)',            16.00, 22.00,'TAXABLE_13',true),
  ('393faf35-77bc-49b0-98d4-751827dd74d7','ebf41468-6df6-4b09-acbd-150846f3761d','Lays Classic Salted (30g)',         20.00, 30.00,'TAXABLE_13',true),
  ('972da7f3-8fa2-4a86-91f8-f36d702bdaf2','ebf41468-6df6-4b09-acbd-150846f3761d','Uncle Chips Spicy Treat (30g)',     18.00, 25.00,'TAXABLE_13',true),
  ('38229547-384b-4efb-bd4c-e0641c33ad0a','ebf41468-6df6-4b09-acbd-150846f3761d','Coca-Cola (250ml)',                 45.00, 60.00,'TAXABLE_13',true),
  ('23aa731f-c2a9-4254-8a99-8b7173ee1a03','ebf41468-6df6-4b09-acbd-150846f3761d','Pepsi (250ml)',                     45.00, 60.00,'TAXABLE_13',true),
  ('b6bfb17b-e770-49f7-a80f-ea3068ceb7d2','ebf41468-6df6-4b09-acbd-150846f3761d','Real Mango Juice (200ml)',          28.00, 40.00,'TAXABLE_13',true),
  ('a9d8b2c6-def9-455e-aba0-546fd8d45b95','ebf41468-6df6-4b09-acbd-150846f3761d','Himalayan Mineral Water (1L)',      18.00, 25.00,'TAXABLE_13',true),
  ('fd9d1781-e353-426a-9484-c4df8e9fa732','ebf41468-6df6-4b09-acbd-150846f3761d','Goldstar Tea (250g)',              175.00,220.00,'TAXABLE_13',true),
  ('5475af4a-4b82-4801-bd14-117c75309074','ebf41468-6df6-4b09-acbd-150846f3761d','Basmati Rice (1kg)',                95.00,120.00,'ZERO_RATED', true),
  ('9da708d3-4c2d-4d3e-8955-6b56ae79add5','ebf41468-6df6-4b09-acbd-150846f3761d','Local White Rice (5kg)',           330.00,400.00,'ZERO_RATED', true),
  ('d1ff2a49-bb44-41e2-b3ca-7e97e76900e8','ebf41468-6df6-4b09-acbd-150846f3761d','Musuro Dal (1kg)',                 130.00,160.00,'ZERO_RATED', true),
  ('be08c741-d8a4-416c-a5ba-9f0bfab1c7c0','ebf41468-6df6-4b09-acbd-150846f3761d','Chana Dal (1kg)',                  110.00,140.00,'ZERO_RATED', true),
  ('fb65af42-7267-44f5-a77e-df1a99ba04d5','ebf41468-6df6-4b09-acbd-150846f3761d','Sugar (1kg)',                       72.00, 85.00,'ZERO_RATED', true),
  ('6641b43a-211a-4b4d-a821-a4db08feb47a','ebf41468-6df6-4b09-acbd-150846f3761d','Iodized Salt (1kg)',                18.00, 25.00,'ZERO_RATED', true),
  ('12ffcc0c-db29-46ae-b6e4-4ce17ea3925b','ebf41468-6df6-4b09-acbd-150846f3761d','Mustard Oil (1L)',                 180.00,220.00,'ZERO_RATED', true),
  ('48f5bcc5-f6e0-474c-a718-b5497689f803','ebf41468-6df6-4b09-acbd-150846f3761d','Sunflower Oil (1L)',               190.00,230.00,'ZERO_RATED', true),
  ('df191655-a90b-4355-8da4-bfdfa88b1972','ebf41468-6df6-4b09-acbd-150846f3761d','Lifebuoy Soap (100g)',              28.00, 38.00,'TAXABLE_13',true),
  ('3cd938bc-624a-4e25-965c-8b9a42f81437','ebf41468-6df6-4b09-acbd-150846f3761d','Lux Soap Rose (100g)',              38.00, 50.00,'TAXABLE_13',true),
  ('070422fd-3718-4f05-81c9-142abfa19498','ebf41468-6df6-4b09-acbd-150846f3761d','Sunsilk Shampoo Sachet (9ml)',       9.00, 12.00,'TAXABLE_13',true),
  ('4ca3fa4a-1d6a-4fde-bfea-7e3263d76426','ebf41468-6df6-4b09-acbd-150846f3761d','Pantene Shampoo Sachet (9ml)',      10.00, 14.00,'TAXABLE_13',true),
  ('33e38588-a95e-4d56-a278-6857d515f737','ebf41468-6df6-4b09-acbd-150846f3761d','Colgate Toothpaste (100g)',         68.00, 90.00,'TAXABLE_13',true),
  ('14429206-17f3-4251-b4dc-a279a720ada8','ebf41468-6df6-4b09-acbd-150846f3761d','Rin Detergent (500g)',              55.00, 75.00,'TAXABLE_13',true),
  ('a9762040-9d41-40a2-a4ec-ce9b6b4e9d96','ebf41468-6df6-4b09-acbd-150846f3761d','Vim Dishwash Bar (150g)',           25.00, 35.00,'TAXABLE_13',true),
  ('7e90cf5c-c69f-4be2-9edd-14dab6f9be77','ebf41468-6df6-4b09-acbd-150846f3761d','Safety Matches (10 boxes pack)',    18.00, 25.00,'TAXABLE_13',true),
  ('3f76ba54-ba5b-4d7b-9b4b-327e963ce878','ebf41468-6df6-4b09-acbd-150846f3761d','Ariel Detergent Powder (500g)',     80.00,110.00,'TAXABLE_13',true)
ON CONFLICT (id) DO NOTHING;

-- Verify: SELECT COUNT(*) FROM products WHERE tenant_id='ebf41468-6df6-4b09-acbd-150846f3761d';
-- Expected: 30

-- ── A7. Opening Stock ─────────────────────────────────────────────────────────
INSERT INTO stock_ledger (id, tenant_id, location_id, product_id, quantity_delta, movement_type, created_at) VALUES
  (gen_random_uuid(),'ebf41468-6df6-4b09-acbd-150846f3761d','26f1a6d1-767e-4a81-9bf4-c458559e3f29','c497fc33-6508-4202-b3e4-be70fb820a94', 144,'opening_stock',now()-interval '30 days'),
  (gen_random_uuid(),'ebf41468-6df6-4b09-acbd-150846f3761d','26f1a6d1-767e-4a81-9bf4-c458559e3f29','ad60626f-95c0-49c6-88be-ea484c5696fc', 120,'opening_stock',now()-interval '30 days'),
  (gen_random_uuid(),'ebf41468-6df6-4b09-acbd-150846f3761d','26f1a6d1-767e-4a81-9bf4-c458559e3f29','c3acfa09-9dfd-4462-825c-bd8a8ed6a7a7',  96,'opening_stock',now()-interval '30 days'),
  (gen_random_uuid(),'ebf41468-6df6-4b09-acbd-150846f3761d','26f1a6d1-767e-4a81-9bf4-c458559e3f29','522581b9-aff2-4a80-8039-455d472eb821',  72,'opening_stock',now()-interval '30 days'),
  (gen_random_uuid(),'ebf41468-6df6-4b09-acbd-150846f3761d','26f1a6d1-767e-4a81-9bf4-c458559e3f29','4daa3492-53e6-49fb-9be4-a24f12c5c11f', 200,'opening_stock',now()-interval '30 days'),
  (gen_random_uuid(),'ebf41468-6df6-4b09-acbd-150846f3761d','26f1a6d1-767e-4a81-9bf4-c458559e3f29','b1fabb4f-bd3a-4d3b-9bc8-5475f1b4c86c', 150,'opening_stock',now()-interval '30 days'),
  (gen_random_uuid(),'ebf41468-6df6-4b09-acbd-150846f3761d','26f1a6d1-767e-4a81-9bf4-c458559e3f29','393faf35-77bc-49b0-98d4-751827dd74d7', 120,'opening_stock',now()-interval '30 days'),
  (gen_random_uuid(),'ebf41468-6df6-4b09-acbd-150846f3761d','26f1a6d1-767e-4a81-9bf4-c458559e3f29','972da7f3-8fa2-4a86-91f8-f36d702bdaf2',  96,'opening_stock',now()-interval '30 days'),
  (gen_random_uuid(),'ebf41468-6df6-4b09-acbd-150846f3761d','26f1a6d1-767e-4a81-9bf4-c458559e3f29','38229547-384b-4efb-bd4c-e0641c33ad0a',  96,'opening_stock',now()-interval '30 days'),
  (gen_random_uuid(),'ebf41468-6df6-4b09-acbd-150846f3761d','26f1a6d1-767e-4a81-9bf4-c458559e3f29','23aa731f-c2a9-4254-8a99-8b7173ee1a03',  96,'opening_stock',now()-interval '30 days'),
  (gen_random_uuid(),'ebf41468-6df6-4b09-acbd-150846f3761d','26f1a6d1-767e-4a81-9bf4-c458559e3f29','b6bfb17b-e770-49f7-a80f-ea3068ceb7d2',  72,'opening_stock',now()-interval '30 days'),
  (gen_random_uuid(),'ebf41468-6df6-4b09-acbd-150846f3761d','26f1a6d1-767e-4a81-9bf4-c458559e3f29','a9d8b2c6-def9-455e-aba0-546fd8d45b95', 144,'opening_stock',now()-interval '30 days'),
  (gen_random_uuid(),'ebf41468-6df6-4b09-acbd-150846f3761d','26f1a6d1-767e-4a81-9bf4-c458559e3f29','fd9d1781-e353-426a-9484-c4df8e9fa732',  24,'opening_stock',now()-interval '30 days'),
  (gen_random_uuid(),'ebf41468-6df6-4b09-acbd-150846f3761d','26f1a6d1-767e-4a81-9bf4-c458559e3f29','5475af4a-4b82-4801-bd14-117c75309074',  40,'opening_stock',now()-interval '30 days'),
  (gen_random_uuid(),'ebf41468-6df6-4b09-acbd-150846f3761d','26f1a6d1-767e-4a81-9bf4-c458559e3f29','9da708d3-4c2d-4d3e-8955-6b56ae79add5',  30,'opening_stock',now()-interval '30 days'),
  (gen_random_uuid(),'ebf41468-6df6-4b09-acbd-150846f3761d','26f1a6d1-767e-4a81-9bf4-c458559e3f29','d1ff2a49-bb44-41e2-b3ca-7e97e76900e8',  50,'opening_stock',now()-interval '30 days'),
  (gen_random_uuid(),'ebf41468-6df6-4b09-acbd-150846f3761d','26f1a6d1-767e-4a81-9bf4-c458559e3f29','be08c741-d8a4-416c-a5ba-9f0bfab1c7c0',  40,'opening_stock',now()-interval '30 days'),
  (gen_random_uuid(),'ebf41468-6df6-4b09-acbd-150846f3761d','26f1a6d1-767e-4a81-9bf4-c458559e3f29','fb65af42-7267-44f5-a77e-df1a99ba04d5',  60,'opening_stock',now()-interval '30 days'),
  (gen_random_uuid(),'ebf41468-6df6-4b09-acbd-150846f3761d','26f1a6d1-767e-4a81-9bf4-c458559e3f29','6641b43a-211a-4b4d-a821-a4db08feb47a',  80,'opening_stock',now()-interval '30 days'),
  (gen_random_uuid(),'ebf41468-6df6-4b09-acbd-150846f3761d','26f1a6d1-767e-4a81-9bf4-c458559e3f29','12ffcc0c-db29-46ae-b6e4-4ce17ea3925b',  36,'opening_stock',now()-interval '30 days'),
  (gen_random_uuid(),'ebf41468-6df6-4b09-acbd-150846f3761d','26f1a6d1-767e-4a81-9bf4-c458559e3f29','48f5bcc5-f6e0-474c-a718-b5497689f803',  36,'opening_stock',now()-interval '30 days'),
  (gen_random_uuid(),'ebf41468-6df6-4b09-acbd-150846f3761d','26f1a6d1-767e-4a81-9bf4-c458559e3f29','df191655-a90b-4355-8da4-bfdfa88b1972',  72,'opening_stock',now()-interval '30 days'),
  (gen_random_uuid(),'ebf41468-6df6-4b09-acbd-150846f3761d','26f1a6d1-767e-4a81-9bf4-c458559e3f29','3cd938bc-624a-4e25-965c-8b9a42f81437',  60,'opening_stock',now()-interval '30 days'),
  (gen_random_uuid(),'ebf41468-6df6-4b09-acbd-150846f3761d','26f1a6d1-767e-4a81-9bf4-c458559e3f29','070422fd-3718-4f05-81c9-142abfa19498', 200,'opening_stock',now()-interval '30 days'),
  (gen_random_uuid(),'ebf41468-6df6-4b09-acbd-150846f3761d','26f1a6d1-767e-4a81-9bf4-c458559e3f29','4ca3fa4a-1d6a-4fde-bfea-7e3263d76426', 180,'opening_stock',now()-interval '30 days'),
  (gen_random_uuid(),'ebf41468-6df6-4b09-acbd-150846f3761d','26f1a6d1-767e-4a81-9bf4-c458559e3f29','33e38588-a95e-4d56-a278-6857d515f737',  48,'opening_stock',now()-interval '30 days'),
  (gen_random_uuid(),'ebf41468-6df6-4b09-acbd-150846f3761d','26f1a6d1-767e-4a81-9bf4-c458559e3f29','14429206-17f3-4251-b4dc-a279a720ada8',  60,'opening_stock',now()-interval '30 days'),
  (gen_random_uuid(),'ebf41468-6df6-4b09-acbd-150846f3761d','26f1a6d1-767e-4a81-9bf4-c458559e3f29','a9762040-9d41-40a2-a4ec-ce9b6b4e9d96',  48,'opening_stock',now()-interval '30 days'),
  (gen_random_uuid(),'ebf41468-6df6-4b09-acbd-150846f3761d','26f1a6d1-767e-4a81-9bf4-c458559e3f29','7e90cf5c-c69f-4be2-9edd-14dab6f9be77',  50,'opening_stock',now()-interval '30 days'),
  (gen_random_uuid(),'ebf41468-6df6-4b09-acbd-150846f3761d','26f1a6d1-767e-4a81-9bf4-c458559e3f29','3f76ba54-ba5b-4d7b-9b4b-327e963ce878',  40,'opening_stock',now()-interval '30 days');

-- Verify: SELECT COUNT(*) FROM stock_ledger WHERE tenant_id='ebf41468-6df6-4b09-acbd-150846f3761d' AND movement_type='opening_stock';
-- Expected: 30

-- ── A8. Invoice 1 — 2 days ago ────────────────────────────────────────────────
INSERT INTO invoices (
  id, tenant_id, location_id, staff_id, cashier_id, cash_shift_id,
  invoice_number, subtotal_amount, bill_discount_flat, bill_discount_pct,
  tax_amount, total_amount, payment_method, payment_status, idempotency_key, is_return, created_at
) VALUES (
  'be5b10ce-4b7f-4255-b526-cdca5e176005',
  'ebf41468-6df6-4b09-acbd-150846f3761d',
  '26f1a6d1-767e-4a81-9bf4-c458559e3f29',
  '858ceba2-7a0c-436b-8898-3f872de2bbc9',
  null, null,
  'DEMO-0001', 103.00, 0, 0, 0, 103.00,
  'cash', 'completed', gen_random_uuid()::text, false, now()-interval '2 days'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO invoice_items (invoice_id, product_id, scanned_barcode, quantity_sold, unit_sale_price, item_discount_flat, item_discount_pct, tax_rate_pct, final_row_total, item_modifiers)
VALUES
  ('be5b10ce-4b7f-4255-b526-cdca5e176005','c497fc33-6508-4202-b3e4-be70fb820a94',null,3,18.00,0,0,13, 54.00,'{}'),
  ('be5b10ce-4b7f-4255-b526-cdca5e176005','4daa3492-53e6-49fb-9be4-a24f12c5c11f',null,2,12.00,0,0,13, 24.00,'{}'),
  ('be5b10ce-4b7f-4255-b526-cdca5e176005','6641b43a-211a-4b4d-a821-a4db08feb47a',null,1,25.00,0,0, 0, 25.00,'{}')
ON CONFLICT DO NOTHING;

INSERT INTO stock_ledger (id,tenant_id,location_id,product_id,quantity_delta,movement_type,created_at) VALUES
  (gen_random_uuid(),'ebf41468-6df6-4b09-acbd-150846f3761d','26f1a6d1-767e-4a81-9bf4-c458559e3f29','c497fc33-6508-4202-b3e4-be70fb820a94',-3,'sale',now()-interval '2 days'),
  (gen_random_uuid(),'ebf41468-6df6-4b09-acbd-150846f3761d','26f1a6d1-767e-4a81-9bf4-c458559e3f29','4daa3492-53e6-49fb-9be4-a24f12c5c11f',-2,'sale',now()-interval '2 days'),
  (gen_random_uuid(),'ebf41468-6df6-4b09-acbd-150846f3761d','26f1a6d1-767e-4a81-9bf4-c458559e3f29','6641b43a-211a-4b4d-a821-a4db08feb47a',-1,'sale',now()-interval '2 days');

-- ── A8. Invoice 2 — yesterday ─────────────────────────────────────────────────
INSERT INTO invoices (
  id, tenant_id, location_id, staff_id, cashier_id, cash_shift_id,
  invoice_number, subtotal_amount, bill_discount_flat, bill_discount_pct,
  tax_amount, total_amount, payment_method, payment_status, idempotency_key, is_return, created_at
) VALUES (
  '228f3ced-3e42-4198-8f50-ef91ff8633d7',
  'ebf41468-6df6-4b09-acbd-150846f3761d',
  '26f1a6d1-767e-4a81-9bf4-c458559e3f29',
  '858ceba2-7a0c-436b-8898-3f872de2bbc9',
  null, null,
  'DEMO-0002', 1025.00, 0, 0, 0, 1025.00,
  'cash', 'completed', gen_random_uuid()::text, false, now()-interval '1 day'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO invoice_items (invoice_id, product_id, scanned_barcode, quantity_sold, unit_sale_price, item_discount_flat, item_discount_pct, tax_rate_pct, final_row_total, item_modifiers)
VALUES
  ('228f3ced-3e42-4198-8f50-ef91ff8633d7','9da708d3-4c2d-4d3e-8955-6b56ae79add5',null,1,400.00,0,0,0,400.00,'{}'),
  ('228f3ced-3e42-4198-8f50-ef91ff8633d7','d1ff2a49-bb44-41e2-b3ca-7e97e76900e8',null,2,160.00,0,0,0,320.00,'{}'),
  ('228f3ced-3e42-4198-8f50-ef91ff8633d7','12ffcc0c-db29-46ae-b6e4-4ce17ea3925b',null,1,220.00,0,0,0,220.00,'{}'),
  ('228f3ced-3e42-4198-8f50-ef91ff8633d7','fb65af42-7267-44f5-a77e-df1a99ba04d5',null,1, 85.00,0,0,0, 85.00,'{}')
ON CONFLICT DO NOTHING;

INSERT INTO stock_ledger (id,tenant_id,location_id,product_id,quantity_delta,movement_type,created_at) VALUES
  (gen_random_uuid(),'ebf41468-6df6-4b09-acbd-150846f3761d','26f1a6d1-767e-4a81-9bf4-c458559e3f29','9da708d3-4c2d-4d3e-8955-6b56ae79add5',-1,'sale',now()-interval '1 day'),
  (gen_random_uuid(),'ebf41468-6df6-4b09-acbd-150846f3761d','26f1a6d1-767e-4a81-9bf4-c458559e3f29','d1ff2a49-bb44-41e2-b3ca-7e97e76900e8',-2,'sale',now()-interval '1 day'),
  (gen_random_uuid(),'ebf41468-6df6-4b09-acbd-150846f3761d','26f1a6d1-767e-4a81-9bf4-c458559e3f29','12ffcc0c-db29-46ae-b6e4-4ce17ea3925b',-1,'sale',now()-interval '1 day'),
  (gen_random_uuid(),'ebf41468-6df6-4b09-acbd-150846f3761d','26f1a6d1-767e-4a81-9bf4-c458559e3f29','fb65af42-7267-44f5-a77e-df1a99ba04d5',-1,'sale',now()-interval '1 day');

-- ── A8. Invoice 3 — today ─────────────────────────────────────────────────────
INSERT INTO invoices (
  id, tenant_id, location_id, staff_id, cashier_id, cash_shift_id,
  invoice_number, subtotal_amount, bill_discount_flat, bill_discount_pct,
  tax_amount, total_amount, payment_method, payment_status, idempotency_key, is_return, created_at
) VALUES (
  '247395a1-6311-466d-b247-c1b3baa4afd9',
  'ebf41468-6df6-4b09-acbd-150846f3761d',
  '26f1a6d1-767e-4a81-9bf4-c458559e3f29',
  '858ceba2-7a0c-436b-8898-3f872de2bbc9',
  null, null,
  'DEMO-0003', 304.00, 0, 0, 0, 304.00,
  'cash', 'completed', gen_random_uuid()::text, false, now()-interval '3 hours'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO invoice_items (invoice_id, product_id, scanned_barcode, quantity_sold, unit_sale_price, item_discount_flat, item_discount_pct, tax_rate_pct, final_row_total, item_modifiers)
VALUES
  ('247395a1-6311-466d-b247-c1b3baa4afd9','38229547-384b-4efb-bd4c-e0641c33ad0a',null,2,60.00,0,0,13,120.00,'{}'),
  ('247395a1-6311-466d-b247-c1b3baa4afd9','393faf35-77bc-49b0-98d4-751827dd74d7',null,2,30.00,0,0,13, 60.00,'{}'),
  ('247395a1-6311-466d-b247-c1b3baa4afd9','df191655-a90b-4355-8da4-bfdfa88b1972',null,2,38.00,0,0,13, 76.00,'{}'),
  ('247395a1-6311-466d-b247-c1b3baa4afd9','070422fd-3718-4f05-81c9-142abfa19498',null,4,12.00,0,0,13, 48.00,'{}')
ON CONFLICT DO NOTHING;

INSERT INTO stock_ledger (id,tenant_id,location_id,product_id,quantity_delta,movement_type,created_at) VALUES
  (gen_random_uuid(),'ebf41468-6df6-4b09-acbd-150846f3761d','26f1a6d1-767e-4a81-9bf4-c458559e3f29','38229547-384b-4efb-bd4c-e0641c33ad0a',-2,'sale',now()-interval '3 hours'),
  (gen_random_uuid(),'ebf41468-6df6-4b09-acbd-150846f3761d','26f1a6d1-767e-4a81-9bf4-c458559e3f29','393faf35-77bc-49b0-98d4-751827dd74d7',-2,'sale',now()-interval '3 hours'),
  (gen_random_uuid(),'ebf41468-6df6-4b09-acbd-150846f3761d','26f1a6d1-767e-4a81-9bf4-c458559e3f29','df191655-a90b-4355-8da4-bfdfa88b1972',-2,'sale',now()-interval '3 hours'),
  (gen_random_uuid(),'ebf41468-6df6-4b09-acbd-150846f3761d','26f1a6d1-767e-4a81-9bf4-c458559e3f29','070422fd-3718-4f05-81c9-142abfa19498',-4,'sale',now()-interval '3 hours');

-- Final verify:
-- SELECT invoice_number, total_amount FROM invoices WHERE tenant_id='ebf41468-6df6-4b09-acbd-150846f3761d' ORDER BY created_at;
-- SELECT COUNT(*) FROM products WHERE tenant_id='ebf41468-6df6-4b09-acbd-150846f3761d';
