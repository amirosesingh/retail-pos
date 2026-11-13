-- Retail POS: existing Retail POS Beta upgrade. PREPARATION; exact-target approval required.
-- Supabase/PostgreSQL only. Never run in production or in SQL Server.
-- Current matching beta is a verified no-op; known prior beta uses the reviewed payload.
-- Run as one standalone SQL Editor transaction, not inside another migration wrapper.
-- No reset, fresh schema replay, user creation, pilot enrollment or business backfill.
-- Source SHA256 C242277F25C81A3AFE18C770EC8947CD17E7EABF534D342DBCAD5B3470FDB184
-- Adapted body SHA256 D8C9A995F765DB5EB8A69E764279FF8C53FEC8FE6D268E7DD5A7FE2499B39541
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
SET LOCAL search_path=public,pg_catalog;
DO $retail_beta_upgrade$
DECLARE current_fingerprint jsonb;
BEGIN
 SELECT catalogue.fingerprint INTO current_fingerprint FROM (SELECT jsonb_build_object('project_ref','irjkmhgrjgcaoixcixut','database_name',current_database(),'database_role',current_user,'system_identifier',(SELECT system_identifier::text FROM pg_catalog.pg_control_system()),'rls_tables',(SELECT jsonb_object_agg(schema_name,total) FROM (SELECT n.nspname schema_name,count(c.oid) total FROM pg_catalog.pg_namespace n LEFT JOIN pg_catalog.pg_class c ON c.relnamespace=n.oid AND c.relkind IN ('r','p') AND c.relrowsecurity WHERE n.nspname IN ('public','pos_sync_feed_v1') GROUP BY n.nspname) x),'functions',(SELECT jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'md5',md5(replace(pg_get_functiondef(p.oid),chr(13)||chr(10),chr(10))),'owner',pg_get_userbyid(p.proowner),'definer',p.prosecdef,'config',p.proconfig,'anon',has_function_privilege('anon',p.oid,'EXECUTE'),'authenticated',has_function_privilege('authenticated',p.oid,'EXECUTE'),'service_role',has_function_privilege('service_role',p.oid,'EXECUTE')) ORDER BY p.oid::regprocedure::text) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE (n.nspname='public' AND p.proname IN ('booking_handover','reserve_product_skus','received_product_catalogue_stores','pos_sync_push_aggregate')) OR (n.nspname='pos_sync_cash_v1' AND p.proname IN ('assert_extended_tenders','apply_checkout','project_receipt')) OR (n.nspname='pos_sync_feed_v1' AND p.proname IN ('publish_transfer_receipt','record_cash_publication')) OR (n.nspname='private' AND p.proname IN ('check_booking_handover_upload','stock_transfer_receive','stock_transfer_verify'))),'constraints',(SELECT jsonb_agg(jsonb_build_object('name',conname,'definition',pg_get_constraintdef(oid),'validated',convalidated) ORDER BY conname) FROM pg_catalog.pg_constraint WHERE conrelid=to_regclass('pos_sync_feed_v1.cash_publications')),'migrations',(SELECT jsonb_agg(jsonb_build_object('version',version,'name',name) ORDER BY version) FROM supabase_migrations.schema_migrations)) AS fingerprint) catalogue;
 IF current_fingerprint->>'database_name' IS DISTINCT FROM 'postgres' OR current_fingerprint->>'database_role' IS DISTINCT FROM 'postgres' OR current_fingerprint->>'system_identifier' IS DISTINCT FROM '7703759698107299042' THEN
  RAISE EXCEPTION 'RETAIL_POS_BETA_WRONG_CLUSTER';
 END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(1907170937,451);
 SELECT catalogue.fingerprint INTO current_fingerprint FROM (SELECT jsonb_build_object('project_ref','irjkmhgrjgcaoixcixut','database_name',current_database(),'database_role',current_user,'system_identifier',(SELECT system_identifier::text FROM pg_catalog.pg_control_system()),'rls_tables',(SELECT jsonb_object_agg(schema_name,total) FROM (SELECT n.nspname schema_name,count(c.oid) total FROM pg_catalog.pg_namespace n LEFT JOIN pg_catalog.pg_class c ON c.relnamespace=n.oid AND c.relkind IN ('r','p') AND c.relrowsecurity WHERE n.nspname IN ('public','pos_sync_feed_v1') GROUP BY n.nspname) x),'functions',(SELECT jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'md5',md5(replace(pg_get_functiondef(p.oid),chr(13)||chr(10),chr(10))),'owner',pg_get_userbyid(p.proowner),'definer',p.prosecdef,'config',p.proconfig,'anon',has_function_privilege('anon',p.oid,'EXECUTE'),'authenticated',has_function_privilege('authenticated',p.oid,'EXECUTE'),'service_role',has_function_privilege('service_role',p.oid,'EXECUTE')) ORDER BY p.oid::regprocedure::text) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE (n.nspname='public' AND p.proname IN ('booking_handover','reserve_product_skus','received_product_catalogue_stores','pos_sync_push_aggregate')) OR (n.nspname='pos_sync_cash_v1' AND p.proname IN ('assert_extended_tenders','apply_checkout','project_receipt')) OR (n.nspname='pos_sync_feed_v1' AND p.proname IN ('publish_transfer_receipt','record_cash_publication')) OR (n.nspname='private' AND p.proname IN ('check_booking_handover_upload','stock_transfer_receive','stock_transfer_verify'))),'constraints',(SELECT jsonb_agg(jsonb_build_object('name',conname,'definition',pg_get_constraintdef(oid),'validated',convalidated) ORDER BY conname) FROM pg_catalog.pg_constraint WHERE conrelid=to_regclass('pos_sync_feed_v1.cash_publications')),'migrations',(SELECT jsonb_agg(jsonb_build_object('version',version,'name',name) ORDER BY version) FROM supabase_migrations.schema_migrations)) AS fingerprint) catalogue;
 IF current_fingerprint=$retail_expected${"functions":[{"md5":"5d3de571c999da2f44b4cec08d0d2e41","anon":false,"owner":"postgres","config":["search_path=pg_catalog"],"definer":false,"signature":"booking_handover(uuid,numeric,jsonb,jsonb,jsonb,jsonb,jsonb)","service_role":false,"authenticated":true},{"md5":"1221b923eaac7da2408b967a92dbd536","anon":false,"owner":"postgres","config":["search_path=pg_catalog"],"definer":false,"signature":"pos_sync_cash_v1.apply_checkout(text,text,uuid,text,uuid,uuid,uuid,uuid,text,text,jsonb)","service_role":false,"authenticated":false},{"md5":"7c2716d73e4129b1dfc7eb9ddc65a794","anon":false,"owner":"postgres","config":["search_path=pg_catalog"],"definer":false,"signature":"pos_sync_cash_v1.assert_extended_tenders(sales,jsonb,uuid)","service_role":false,"authenticated":false},{"md5":"b43a4ebed7d1ba26b1efac43ff4173da","anon":false,"owner":"postgres","config":["search_path=pg_catalog"],"definer":false,"signature":"pos_sync_cash_v1.project_receipt(text,jsonb)","service_role":false,"authenticated":false},{"md5":"07da7186057d2cc7cee8979733afc9a3","anon":false,"owner":"postgres","config":["search_path=pg_catalog","TimeZone=UTC"],"definer":false,"signature":"pos_sync_feed_v1.publish_transfer_receipt(uuid,jsonb)","service_role":false,"authenticated":false},{"md5":"ce332bd3a7950fedae2f6afea49772fe","anon":false,"owner":"postgres","config":["search_path=pg_catalog"],"definer":false,"signature":"pos_sync_feed_v1.record_cash_publication(text,text,uuid,bigint,uuid,uuid,uuid,uuid,text)","service_role":false,"authenticated":false},{"md5":"f2cafa198ab7f6f8709ffe0caa3c4d46","anon":false,"owner":"postgres","config":["search_path=public, pg_temp"],"definer":true,"signature":"pos_sync_push_aggregate(uuid,text,text,text,jsonb)","service_role":true,"authenticated":false},{"md5":"e71200273c8182cad5cff66f4f5fb5fc","anon":false,"owner":"postgres","config":["search_path=pg_catalog"],"definer":false,"signature":"private.check_booking_handover_upload(text,jsonb,boolean)","service_role":false,"authenticated":false},{"md5":"f69fd94db446880e3b2fe7eab6d21b85","anon":false,"owner":"postgres","config":["search_path=public, pg_temp"],"definer":true,"signature":"private.stock_transfer_receive(uuid,text,boolean,jsonb)","service_role":true,"authenticated":false},{"md5":"fcb1b0af3af9dfd8f60a13ac113fc4c2","anon":false,"owner":"postgres","config":["search_path=public, pg_temp"],"definer":true,"signature":"private.stock_transfer_verify(uuid,text,jsonb,text)","service_role":true,"authenticated":false},{"md5":"0a0b2be15b96d195308db70392b0539e","anon":false,"owner":"postgres","config":["search_path=\"\""],"definer":true,"signature":"received_product_catalogue_stores(uuid)","service_role":true,"authenticated":false},{"md5":"70d1028d1c25a67bcfd0381decc067fb","anon":false,"owner":"postgres","config":["search_path=\"\""],"definer":true,"signature":"reserve_product_skus(integer,text,text,text,integer)","service_role":true,"authenticated":true}],"migrations":[{"name":"retail_pos_beta_schema_transport","version":"20261109075631"},{"name":"retail_pos_beta_canonical_schema","version":"20261109080027"},{"name":"retail_pos_beta_financial_and_grouped_pilot","version":"20261109080440"},{"name":"retail_pos_beta_guard_booking_scope","version":"20261109081038"},{"name":"retail_pos_beta_deferred_stock_guard","version":"20261109081624"},{"name":"retail_pos_beta_native_transfer_receipt","version":"20261109081629"},{"name":"retail_pos_beta_restore_transfer_approval_helper","version":"20261109082129"},{"name":"retail_pos_beta_refresh_initial_recovery_pin","version":"20261109083037"},{"name":"retail_pos_beta_sync_tenders_transfer_booking_upgrade","version":"20261110031005"}],"rls_tables":{"public":79,"pos_sync_feed_v1":18},"constraints":[{"name":"cash_publications_organization_id_operation_id_key","validated":true,"definition":"UNIQUE (organization_id, operation_id)"},{"name":"cash_publications_organization_id_scope_id_epoch_fkey","validated":true,"definition":"FOREIGN KEY (organization_id, scope_id, epoch) REFERENCES pos_sync_feed_v1.cash_settings_pilots(organization_id, scope_id, epoch)"},{"name":"cash_publications_pkey","validated":true,"definition":"PRIMARY KEY (organization_id, scope_id, epoch, seq)"},{"name":"cash_publications_seq_check","validated":true,"definition":"CHECK ((seq > 0))"},{"name":"cash_publications_tender_changes_check","validated":true,"definition":"CHECK (((jsonb_typeof(changes) = 'array'::text) AND ((jsonb_array_length(changes) >= 4) AND (jsonb_array_length(changes) <= 19))))"}],"project_ref":"irjkmhgrjgcaoixcixut","database_name":"postgres","database_role":"postgres","system_identifier":"7703759698107299042"}$retail_expected$::jsonb THEN
  RAISE NOTICE 'Retail POS Beta already matches this release; no upgrade was replayed.'; RETURN;
 END IF;
 IF current_fingerprint->'migrations' IS DISTINCT FROM $retail_prior_ledger$[{"name":"retail_pos_beta_schema_transport","version":"20261109075631"},{"name":"retail_pos_beta_canonical_schema","version":"20261109080027"},{"name":"retail_pos_beta_financial_and_grouped_pilot","version":"20261109080440"},{"name":"retail_pos_beta_guard_booking_scope","version":"20261109081038"},{"name":"retail_pos_beta_deferred_stock_guard","version":"20261109081624"},{"name":"retail_pos_beta_native_transfer_receipt","version":"20261109081629"},{"name":"retail_pos_beta_restore_transfer_approval_helper","version":"20261109082129"},{"name":"retail_pos_beta_refresh_initial_recovery_pin","version":"20261109083037"}]$retail_prior_ledger$::jsonb THEN
  RAISE EXCEPTION 'RETAIL_POS_BETA_UNRECOGNIZED_BASELINE';
 END IF;
 EXECUTE $retail_reviewed_payload$-- Upgrade the populated Retail POS Beta project (irjkmhgrjgcaoixcixut).
-- The exact cluster and the reviewed legacy writer bodies are required.
-- Apply once to beta only. Keep this file outside the production migration path.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $beta_upgrade_guard$
DECLARE
  expected record;
  live_oid regprocedure;
BEGIN
  IF current_user <> 'postgres' OR current_database() <> 'postgres' OR
     (SELECT system_identifier::text FROM pg_catalog.pg_control_system()) <> '7703759698107299042' THEN
    RAISE EXCEPTION 'RETAIL_POS_BETA_WRONG_CLUSTER';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(1907170937, 451);
  IF to_regclass('pos_beta_install_private.installer_chunk') IS NULL OR
     to_regprocedure('public.booking_handover(uuid,numeric,jsonb,jsonb,jsonb,jsonb,jsonb)') IS NOT NULL OR
     to_regprocedure('pos_sync_feed_v1.publish_transfer_receipt(uuid,jsonb)') IS NOT NULL OR
     to_regprocedure('pos_sync_cash_v1.assert_extended_tenders(public.sales,jsonb,uuid)') IS NOT NULL OR
     NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='pos_sync_feed_v1.cash_publications'::regclass
       AND conname='cash_publications_changes_check' AND convalidated
       AND pg_get_constraintdef(oid) = 'CHECK (((jsonb_typeof(changes) = ''array''::text) AND (jsonb_array_length(changes) = 4)))') THEN
    RAISE EXCEPTION 'RETAIL_POS_BETA_UNEXPECTED_UPGRADE_BASELINE';
  END IF;
  FOR expected IN SELECT * FROM (VALUES
    ('pos_sync_cash_v1.apply_checkout(text,text,uuid,text,uuid,uuid,uuid,uuid,text,text,jsonb)', 'c1ae63fac832663f0ddfd72e97061a34'),
    ('pos_sync_cash_v1.project_receipt(text,jsonb)', '31edf7d939a612ce65b2e2e471b65567'),
    ('pos_sync_feed_v1.record_cash_publication(text,text,uuid,bigint,uuid,uuid,uuid,uuid,text)', 'd162da297004812a6f691a05979a5d54')
  ) AS verified(signature, body_hash) LOOP
    live_oid := to_regprocedure(expected.signature);
    IF md5(replace(pg_get_functiondef(live_oid),chr(13)||chr(10),chr(10))) IS DISTINCT FROM expected.body_hash THEN
      RAISE EXCEPTION 'RETAIL_POS_BETA_WRITER_CHANGED: %', expected.signature;
    END IF;
  END LOOP;
END $beta_upgrade_guard$;

-- Source: scripts/preparation/pos-sync-cash-receive-v1.sql

CREATE FUNCTION pos_sync_cash_v1.assert_extended_tenders(
  p_sale public.sales, p_tenders jsonb, p_terminal uuid
) RETURNS void
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $tenders$
DECLARE
  v_entry jsonb;
  v_payment jsonb;
  v_tender public.payment_transactions%ROWTYPE;
  v_position integer;
  v_total numeric := 0;
  v_biggest numeric := 0;
  v_headline text;
  v_has_card boolean := false;
  v_amount numeric;
  v_reference text;
  v_ids uuid[] := ARRAY[]::uuid[];
  v_payment_ids uuid[] := ARRAY[]::uuid[];
  v_payment_id uuid;
BEGIN
  IF jsonb_typeof(p_tenders) IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_sale.payments) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_tenders) NOT BETWEEN 1 AND 16
     OR jsonb_array_length(p_tenders) <> jsonb_array_length(p_sale.payments) THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='POS_TENDER_INVALID';
  END IF;
  FOR v_entry,v_position IN SELECT value,ordinality::integer-1
    FROM jsonb_array_elements(p_tenders) WITH ORDINALITY
  LOOP
    v_payment := p_sale.payments->v_position;
    IF jsonb_typeof(v_entry) IS DISTINCT FROM 'object' OR jsonb_typeof(v_payment) IS DISTINCT FROM 'object'
       OR v_entry - ARRAY['id','source_type','sale_id','store_id','shift_id','terminal_id','amount','method','kind',
         'note','paid_at','created_at','updated_at','row_version','status','metadata','client_transaction_id',
         'reference','cashier_name'] <> '{}'::jsonb
       OR v_payment - ARRAY['id','method','amount','bankName','ref','reference','referenceNote','requiresReference','accountId'] <> '{}'::jsonb
       OR coalesce(v_payment->>'id','') !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
       OR coalesce(v_payment->>'amount','') !~ '^(0|[1-9][0-9]{0,6})(\.[0-9]{1,12})?$'
       OR NOT coalesce(v_payment->>'method' IN ('cash','card'),false)
       OR EXISTS (SELECT 1 FROM jsonb_each(v_payment - ARRAY['id','method','amount','requiresReference']) AS detail(key,value)
         WHERE jsonb_typeof(value) <> 'string' OR char_length(value #>> '{}') > 500 OR value #>> '{}' ~ '[[:cntrl:]]')
       OR (v_payment ? 'requiresReference' AND jsonb_typeof(v_payment->'requiresReference') <> 'boolean')
       OR (v_payment->'requiresReference' = 'true'::jsonb AND nullif(btrim(v_payment->>'reference'),'') IS NULL) THEN
      RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='POS_TENDER_INVALID';
    END IF;
    v_tender := jsonb_populate_record(NULL::public.payment_transactions, v_entry);
    v_payment_id := (v_payment->>'id')::uuid;
    v_amount := (v_payment->>'amount')::numeric;
    v_reference := btrim(coalesce(v_payment->>'reference', v_payment->>'ref', ''));
    IF v_tender.id IS NULL OR v_tender.id = ANY(v_ids) OR v_payment_id = ANY(v_payment_ids)
       OR v_amount <= 0 OR v_amount <> trunc(v_amount,2) OR v_tender.amount IS DISTINCT FROM v_amount
       OR v_tender.method IS DISTINCT FROM v_payment->>'method'
       OR ROW(v_tender.sale_id,v_tender.store_id,v_tender.shift_id,v_tender.terminal_id)
          IS DISTINCT FROM ROW(p_sale.id,p_sale.store_id,p_sale.shift_id,p_terminal::text)
       OR v_tender.source_type IS DISTINCT FROM 'sale' OR v_tender.kind IS DISTINCT FROM 'payment'
       OR v_tender.status IS DISTINCT FROM 'completed' OR v_tender.note IS DISTINCT FROM ''
       OR v_tender.row_version IS DISTINCT FROM 1 OR v_tender.paid_at IS NULL OR v_tender.created_at IS NULL OR v_tender.updated_at IS NULL
       OR v_tender.client_transaction_id IS DISTINCT FROM p_sale.client_transaction_id || ':pay:' || v_position::text
       OR v_tender.reference IS DISTINCT FROM coalesce(nullif(v_reference,''),p_sale.bill_number)
       OR char_length(v_tender.reference) > 500 OR v_tender.reference ~ '[[:cntrl:]]'
       OR char_length(v_tender.cashier_name) > 500 OR v_tender.cashier_name ~ '[[:cntrl:]]'
       OR jsonb_typeof(v_tender.metadata) IS DISTINCT FROM 'object'
       OR v_tender.metadata - ARRAY['bill','voucher_reference','reference_note','bank','captured_at','captured_by'] <> '{}'::jsonb
       OR EXISTS (SELECT 1 FROM jsonb_each(v_tender.metadata) AS detail(key,value)
         WHERE jsonb_typeof(value) <> 'string' OR char_length(value #>> '{}') > 500 OR value #>> '{}' ~ '[[:cntrl:]]')
       OR v_tender.metadata->>'bill' IS DISTINCT FROM p_sale.bill_number
       OR coalesce(v_tender.metadata->>'voucher_reference','') <> v_reference
       OR coalesce(v_tender.metadata->>'reference_note','') <> btrim(coalesce(v_payment->>'referenceNote',''))
       OR coalesce(v_tender.metadata->>'bank','') <> btrim(coalesce(v_payment->>'bankName','')) THEN
      RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='POS_TENDER_INVALID';
    END IF;
    v_ids := array_append(v_ids,v_tender.id);
    v_payment_ids := array_append(v_payment_ids,v_payment_id);
    v_total := v_total + v_amount;
    v_has_card := v_has_card OR v_tender.method = 'card';
    IF v_amount > v_biggest THEN
      v_biggest := v_amount;
      v_headline := v_tender.method;
    END IF;
  END LOOP;
  IF NOT v_has_card OR v_headline IS DISTINCT FROM p_sale.payment_type
     OR v_total IS DISTINCT FROM p_sale.paid_amount OR v_total IS DISTINCT FROM p_sale.total_amount THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='POS_TENDER_INVALID';
  END IF;
END;
$tenders$;

REVOKE ALL ON FUNCTION pos_sync_cash_v1.assert_extended_tenders(public.sales,jsonb,uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION pos_sync_cash_v1.project_receipt(p_branch text, p_evidence jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $receipt$
DECLARE
  v_changes jsonb;
  v_extra jsonb;
  v_extended boolean := jsonb_array_length(p_evidence) = 5;
  v_payment_fields constant text[] := ARRAY['id','source_type','sale_id','store_id','shift_id','terminal_id',
    'amount','method','kind','note','paid_at','created_at','updated_at','row_version','status','metadata'];
  v_extension_fields constant text[] := ARRAY['client_transaction_id','reference','cashier_name'];
BEGIN
  IF jsonb_typeof(p_evidence) IS DISTINCT FROM 'array' OR jsonb_array_length(p_evidence) NOT IN (4,5)
     OR p_evidence->0->>'type' IS DISTINCT FROM 'cash_sale'
     OR p_evidence->1->>'type' IS DISTINCT FROM 'sale_item'
     OR p_evidence->2->>'type' IS DISTINCT FROM 'cash_tender'
     OR p_evidence->3->>'type' IS DISTINCT FROM 'stock_delta'
     OR (v_extended AND (p_evidence->4->>'type' IS DISTINCT FROM 'card_or_split'
       OR jsonb_typeof(p_evidence->4->'ids') IS DISTINCT FROM 'array'
       OR jsonb_array_length(p_evidence->4->'ids') NOT BETWEEN 1 AND 16
       OR p_evidence->4->'ids'->>0 IS DISTINCT FROM p_evidence->2->'row'->>'id')) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'POS_CASH_V1_RECEIPT_EVIDENCE_INVALID';
  END IF;

  SELECT jsonb_build_array(
    pos_sync_cash_v1.receipt_row('sales', to_jsonb(sale) ||
      CASE WHEN v_extended THEN '{}'::jsonb ELSE jsonb_build_object('payments', jsonb_build_array(
        jsonb_build_object('id', tender.id, 'method', 'cash', 'amount', tender.amount::text))) END,
      ARRAY['id','bill_number','client_transaction_id','store_id','branch_id','shift_id','subtotal_amount','total_amount',
        'discount_amount','tax_amount','payment_type','payments','points_earned','points_redeemed','is_exchange','is_refunded',
        'created_at','paid_amount','change_amount','exchange_credit','coupon_discount','rounding_adjustment','row_version'],
      ARRAY['subtotal_amount','total_amount','discount_amount','tax_amount','points_earned','points_redeemed','paid_amount',
        'change_amount','exchange_credit','coupon_discount','rounding_adjustment']),
    pos_sync_cash_v1.receipt_row('sale_items', to_jsonb(item),
      ARRAY['id','sale_id','branch_id','product_id','product_name','quantity','unit_price','discount_percent','discount_amount',
        'tax_rate','is_return','is_foc','created_at','coupon_discount','unit_cost','row_version','refunded_qty'],
      ARRAY['unit_price','discount_percent','discount_amount','tax_rate','coupon_discount','unit_cost']),
    pos_sync_cash_v1.receipt_row('payment_transactions', to_jsonb(tender),
      v_payment_fields || CASE WHEN v_extended THEN v_extension_fields ELSE ARRAY[]::text[] END, ARRAY['amount']),
    pos_sync_cash_v1.receipt_row('item_activity_logs', to_jsonb(movement),
      ARRAY['id','product_id','store_id','terminal_id','activity_type','reference','quantity_delta','unit_cost','note',
        'created_at','row_version'], ARRAY['unit_cost'])
  ) INTO v_changes
  FROM public.sales AS sale
  JOIN public.sale_items AS item ON item.sale_id = sale.id AND item.branch_id = p_branch
  JOIN public.payment_transactions AS tender ON tender.sale_id = sale.id AND tender.store_id = p_branch
  JOIN public.item_activity_logs AS movement ON movement.product_id = item.product_id AND movement.store_id = p_branch
    AND movement.terminal_id = tender.terminal_id AND movement.reference = sale.bill_number
  WHERE sale.store_id = p_branch AND sale.branch_id = p_branch
    AND sale.id::text = p_evidence->0->'row'->>'id' AND item.id::text = p_evidence->1->'row'->>'id'
    AND tender.id::text = p_evidence->2->'row'->>'id' AND movement.id::text = p_evidence->3->'row'->>'movement_id'
    AND sale.shift_id = tender.shift_id AND (v_extended OR
      (sale.payment_type = 'cash' AND tender.method = 'cash' AND tender.amount = sale.total_amount))
    AND movement.quantity_delta = -item.quantity;
  IF NOT FOUND OR v_changes @> '[null]'::jsonb THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'POS_CASH_V1_RECEIPT_PROJECTION_UNAVAILABLE';
  END IF;
  IF v_extended THEN
    SELECT coalesce(jsonb_agg(pos_sync_cash_v1.receipt_row('payment_transactions', to_jsonb(tender),
      v_payment_fields || v_extension_fields, ARRAY['amount']) ORDER BY wanted.ordinality),'[]'::jsonb)
    INTO v_extra
    FROM jsonb_array_elements_text(p_evidence->4->'ids') WITH ORDINALITY AS wanted(id,ordinality)
    JOIN public.payment_transactions AS tender ON tender.id=wanted.id::uuid
      AND tender.sale_id=(p_evidence->0->'row'->>'id')::uuid AND tender.store_id=p_branch
    WHERE wanted.ordinality > 1;
    IF jsonb_array_length(v_extra) <> jsonb_array_length(p_evidence->4->'ids')-1 OR v_extra @> '[null]'::jsonb THEN
      RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='POS_CASH_V1_RECEIPT_PROJECTION_UNAVAILABLE';
    END IF;
    v_changes := v_changes || v_extra;
  END IF;
  RETURN v_changes;
END;
$receipt$;

-- Source: scripts/preparation/pos-sync-cash-bridge-v1.sql

CREATE OR REPLACE FUNCTION pos_sync_cash_v1.apply_checkout(
  p_organization_id text, p_branch_id text, p_terminal_id uuid, p_binding_proof text,
  p_installation_generation uuid, p_database_guid uuid, p_operation_id uuid, p_epoch uuid,
  p_checkout_json text, p_checkout_sha256 text, p_verified_author jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $checkout$
DECLARE
  v_installation_generation uuid;
  v_checkout_utf8 bytea;
  v_checkout_sha256 text;
  v_checkout jsonb;
  v_sale public.sales%ROWTYPE;
  v_item public.sale_items%ROWTYPE;
  v_tender public.payment_transactions%ROWTYPE;
  v_tenders jsonb;
  v_extended boolean;
  v_movement public.item_activity_logs%ROWTYPE;
  v_shift public.shifts%ROWTYPE;
  v_product public.products%ROWTYPE;
  v_stock integer;
  v_managed_shift boolean;
  v_claim jsonb;
  v_ack jsonb;
  v_operations jsonb;
  v_changes jsonb;
  v_seq text;
  v_result jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' OR p_organization_id IS DISTINCT FROM 'default'
     OR p_terminal_id IS NULL OR p_binding_proof IS NULL OR p_binding_proof !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'POS_CASH_V1_SCOPE_FORBIDDEN';
  END IF;
  PERFORM public.pos_sync_validate_scope(p_organization_id, p_branch_id, p_terminal_id::text);
  PERFORM 1 FROM public.terminal_tokens AS token
  WHERE token.id = p_terminal_id AND token.location_id = p_branch_id AND token.platform = 'pc'
    AND token.status IN ('active', 'used') AND token.revoked_at IS NULL
    AND (token.is_claimed OR token.claimed_at IS NOT NULL)
    AND (token.claimed_platform IS NULL OR token.claimed_platform = 'electron')
    AND lower(coalesce(nullif(token.claim_proof, ''), token.claimed_proof_hash)) = p_binding_proof
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'POS_CASH_V1_SCOPE_FORBIDDEN';
  END IF;

  SELECT enrollment.installation_generation INTO v_installation_generation
  FROM pos_sync_cash_v1.installation_enrollments AS enrollment
  WHERE enrollment.organization_id = p_organization_id AND enrollment.terminal_id = p_terminal_id
    AND enrollment.branch_id = p_branch_id AND enrollment.installation_generation = p_installation_generation
    AND enrollment.database_guid = p_database_guid
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'POS_CASH_V1_INSTALLATION_FORBIDDEN';
  END IF;

  v_checkout_utf8 := convert_to(p_checkout_json, 'UTF8');
  IF p_operation_id IS NULL OR p_epoch IS NULL OR v_checkout_utf8 IS NULL
     OR octet_length(v_checkout_utf8) > 524288
     OR p_checkout_sha256 IS NULL OR p_checkout_sha256 !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'POS_CASH_V1_INVALID_CHECKOUT';
  END IF;
  v_checkout_sha256 := encode(sha256(v_checkout_utf8), 'hex');
  IF v_checkout_sha256 <> p_checkout_sha256 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'POS_CASH_V1_CHECKOUT_DIGEST_MISMATCH';
  END IF;
  BEGIN
    v_checkout := p_checkout_json::jsonb;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'POS_CASH_V1_INVALID_CHECKOUT';
  END;
  v_extended := v_checkout ? 'tenders';
  IF jsonb_typeof(v_checkout) IS DISTINCT FROM 'object' OR octet_length(v_checkout::text) > 524288
     OR v_checkout - ARRAY['sale', 'item', 'tender', 'tenders', 'movement'] <> '{}'::jsonb
     OR jsonb_typeof(v_checkout->'sale') IS DISTINCT FROM 'object'
     OR jsonb_typeof(v_checkout->'item') IS DISTINCT FROM 'object'
     OR (NOT v_extended AND jsonb_typeof(v_checkout->'tender') IS DISTINCT FROM 'object')
     OR (v_extended AND (v_checkout ? 'tender' OR jsonb_typeof(v_checkout->'tenders') IS DISTINCT FROM 'array'
       OR p_verified_author IS NULL))
     OR jsonb_typeof(v_checkout->'movement') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'POS_CASH_V1_INVALID_CHECKOUT';
  END IF;
  IF (v_checkout->'sale') - ARRAY['id', 'bill_number', 'client_transaction_id', 'store_id', 'branch_id', 'shift_id',
       'subtotal_amount', 'total_amount', 'discount_amount', 'tax_amount', 'payment_type', 'payments',
       'points_earned', 'points_redeemed', 'is_exchange', 'is_refunded', 'created_at', 'paid_amount',
       'change_amount', 'exchange_credit', 'coupon_discount', 'rounding_adjustment', 'row_version'] <> '{}'::jsonb
     OR (v_checkout->'item') - ARRAY['id', 'sale_id', 'branch_id', 'product_id', 'product_name', 'quantity', 'unit_price',
       'discount_percent', 'discount_amount', 'tax_rate', 'is_return', 'is_foc', 'created_at', 'coupon_discount',
       'unit_cost', 'row_version', 'refunded_qty'] <> '{}'::jsonb
     OR (NOT v_extended AND (v_checkout->'tender') - ARRAY['id', 'source_type', 'sale_id', 'store_id', 'shift_id', 'terminal_id', 'amount',
       'method', 'kind', 'note', 'paid_at', 'created_at', 'updated_at', 'row_version', 'status', 'metadata'] <> '{}'::jsonb)
     OR (v_checkout->'movement') - ARRAY['id', 'product_id', 'store_id', 'terminal_id', 'activity_type', 'reference',
       'quantity_delta', 'unit_cost', 'note', 'created_at', 'row_version'] <> '{}'::jsonb THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'POS_CASH_V1_INVALID_CHECKOUT';
  END IF;
  v_sale := jsonb_populate_record(NULL::public.sales, v_checkout->'sale');
  v_item := jsonb_populate_record(NULL::public.sale_items, v_checkout->'item');
  v_tenders := CASE WHEN v_extended THEN v_checkout->'tenders' ELSE jsonb_build_array(v_checkout->'tender') END;
  v_tender := jsonb_populate_record(NULL::public.payment_transactions, v_tenders->0);
  v_movement := jsonb_populate_record(NULL::public.item_activity_logs, v_checkout->'movement');

  IF v_sale.id IS NULL OR v_item.id IS NULL OR v_tender.id IS NULL OR v_movement.id IS NULL
     OR ROW(v_sale.row_version, v_item.row_version, v_tender.row_version, v_movement.row_version)
        IS DISTINCT FROM ROW(1, 1, 1, 1)
     OR nullif(v_sale.bill_number, '') IS NULL OR nullif(v_sale.client_transaction_id, '') IS NULL
     OR v_sale.shift_id IS NULL OR v_sale.created_at IS NULL
     OR v_sale.store_id IS DISTINCT FROM p_branch_id OR v_sale.branch_id IS DISTINCT FROM p_branch_id
     OR (NOT v_extended AND v_sale.payment_type IS DISTINCT FROM 'cash') OR v_sale.is_exchange IS DISTINCT FROM false
     OR v_sale.is_refunded IS DISTINCT FROM false
     OR ROW(v_sale.discount_amount, v_sale.tax_amount, v_sale.coupon_discount, v_sale.rounding_adjustment,
            v_sale.points_earned, v_sale.points_redeemed, v_sale.exchange_credit, v_sale.change_amount)
        IS DISTINCT FROM ROW(0::numeric, 0::numeric, 0::numeric, 0::numeric, 0::numeric, 0::numeric, 0::numeric, 0::numeric)
     OR v_sale.total_amount IS NULL OR v_sale.total_amount <= 0 OR v_sale.total_amount > 1000000
     OR v_sale.subtotal_amount IS DISTINCT FROM v_sale.total_amount OR v_sale.paid_amount IS DISTINCT FROM v_sale.total_amount
     OR jsonb_typeof(v_sale.payments) IS DISTINCT FROM 'array'
     OR jsonb_typeof(v_sale.payments->0) IS DISTINCT FROM 'object'
     OR (NOT v_extended AND (v_sale.payments->0->>'id' IS DISTINCT FROM v_tender.id::text
       OR v_sale.payments->0->>'method' IS DISTINCT FROM 'cash'
       OR (v_sale.payments->0->>'amount')::numeric IS DISTINCT FROM v_sale.total_amount
       OR v_sale.payments->1 IS NOT NULL))
     OR v_item.sale_id IS DISTINCT FROM v_sale.id OR v_item.branch_id IS DISTINCT FROM p_branch_id
     OR v_item.product_id IS NULL OR v_item.quantity IS NULL OR v_item.quantity <= 0
     OR v_item.is_return IS DISTINCT FROM false OR v_item.is_foc IS DISTINCT FROM false
     OR v_item.refunded_qty IS DISTINCT FROM 0 OR v_item.created_at IS NULL
     OR ROW(v_item.discount_percent, v_item.discount_amount, v_item.tax_rate, v_item.coupon_discount)
        IS DISTINCT FROM ROW(0::numeric, 0::numeric, 0::numeric, 0::numeric)
     OR (v_item.unit_price * v_item.quantity) IS DISTINCT FROM v_sale.total_amount
     OR v_tender.sale_id IS DISTINCT FROM v_sale.id OR v_tender.store_id IS DISTINCT FROM p_branch_id
     OR v_tender.shift_id IS DISTINCT FROM v_sale.shift_id OR v_tender.terminal_id IS DISTINCT FROM p_terminal_id::text
     OR v_tender.source_type IS DISTINCT FROM 'sale' OR (NOT v_extended AND v_tender.method IS DISTINCT FROM 'cash')
     OR v_tender.kind IS DISTINCT FROM 'payment' OR v_tender.status IS DISTINCT FROM 'completed'
     OR v_tender.note IS DISTINCT FROM '' OR (NOT v_extended AND v_tender.metadata IS DISTINCT FROM '{}'::jsonb)
     OR v_tender.paid_at IS NULL OR v_tender.created_at IS NULL
     OR (NOT v_extended AND v_tender.amount IS DISTINCT FROM v_sale.total_amount)
     OR v_movement.product_id IS DISTINCT FROM v_item.product_id OR v_movement.store_id IS DISTINCT FROM p_branch_id
     OR v_movement.terminal_id IS DISTINCT FROM p_terminal_id::text OR v_movement.activity_type IS DISTINCT FROM 'sale'
     OR v_movement.reference IS DISTINCT FROM v_sale.bill_number OR v_movement.created_at IS NULL
     OR v_movement.note IS DISTINCT FROM ''
     OR v_movement.quantity_delta IS DISTINCT FROM -v_item.quantity THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'POS_CASH_V1_INVALID_CHECKOUT';
  END IF;
  IF NOT v_extended AND (v_sale.payments->0) - ARRAY['id', 'method', 'amount'] <> '{}'::jsonb THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'POS_CASH_V1_INVALID_CHECKOUT';
  END IF;

  IF v_extended THEN
    PERFORM pos_sync_cash_v1.assert_extended_tenders(v_sale, v_tenders, p_terminal_id);
  END IF;

  v_claim := pos_sync_inbox_v1.claim_operation(p_organization_id, p_operation_id, v_installation_generation,
    jsonb_build_object('scope_id', p_branch_id, 'terminal_id', p_terminal_id, 'database_guid', p_database_guid,
      'epoch', p_epoch, 'checkout_sha256', v_checkout_sha256) ||
      CASE WHEN p_verified_author IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('author', p_verified_author) END);
  IF v_claim->>'status' <> 'PROCEED' THEN RETURN v_claim; END IF;
  IF v_extended THEN
    IF pos_sync_feed_v1.extended_scope_epoch(p_organization_id,p_branch_id) IS DISTINCT FROM p_epoch THEN
      RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='POS_TENDER_SCOPE_FORBIDDEN';
    END IF;
  END IF;

  PERFORM pos_sync_cash_v1.lock_checkout_routes();
  SELECT shift.* INTO v_shift FROM public.shifts AS shift WHERE shift.id = v_sale.shift_id::uuid FOR SHARE;
  IF NOT FOUND THEN
    -- A waiting receipt binds its epoch even though it will not append a group.
    PERFORM 1 FROM pos_sync_feed_v1.feed_heads AS head
    WHERE head.organization_id = p_organization_id AND head.scope_id = p_branch_id AND head.epoch = p_epoch
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'POS_FEED_V1_SCOPE_OR_EPOCH_MISMATCH';
    END IF;
    v_result := jsonb_build_object('reason', 'SHIFT_MISSING');
    PERFORM pos_sync_inbox_v1.record_disposition(p_organization_id, p_operation_id, 'WAITING_DEPENDENCY', v_result);
    RETURN jsonb_build_object('status', 'WAITING_DEPENDENCY', 'result', v_result);
  END IF;
  IF v_shift.store_id IS DISTINCT FROM p_branch_id OR v_shift.terminal_id IS DISTINCT FROM p_terminal_id::text
     OR v_shift.status IS DISTINCT FROM 'OPEN' OR v_shift.state IS DISTINCT FROM 'ACTIVE' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'POS_CASH_V1_SHIFT_FORBIDDEN';
  END IF;
  -- Protected financial streams retain their signed writer and cannot use
  -- this ordinary-cash pilot. A deployed guard still runs in the delegate.
  IF to_regclass('fin62_history_preparation.streams') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM fin62_history_preparation.streams WHERE shift_id = $1)'
      INTO v_managed_shift USING v_shift.id;
    IF v_managed_shift THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'POS_CASH_V1_PROTECTED_SHIFT';
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM public.sales AS sale WHERE sale.id = v_sale.id OR sale.bill_number = v_sale.bill_number
             OR sale.client_transaction_id = v_sale.client_transaction_id)
     OR EXISTS (SELECT 1 FROM public.sale_items AS item WHERE item.id = v_item.id)
     OR EXISTS (SELECT 1 FROM jsonb_to_recordset(v_tenders) AS incoming(id uuid,client_transaction_id text)
       JOIN public.payment_transactions AS tender ON tender.id=incoming.id OR
         (incoming.client_transaction_id IS NOT NULL AND tender.client_transaction_id=incoming.client_transaction_id))
     OR EXISTS (SELECT 1 FROM public.item_activity_logs AS movement WHERE movement.id = v_movement.id)
     OR EXISTS (SELECT 1 FROM public.stock_delta_applied AS delta WHERE delta.movement_id = v_movement.id)
     OR EXISTS (SELECT 1 FROM public.sync_idempotency_receipts AS receipt WHERE receipt.batch_id = p_operation_id) THEN
    v_result := jsonb_build_object('reason', 'LEGACY_OR_CONFLICTING_IDENTITY');
    PERFORM pos_sync_inbox_v1.record_disposition(p_organization_id, p_operation_id, 'REVIEW_REQUIRED', v_result);
    RETURN jsonb_build_object('status', 'REVIEW_REQUIRED', 'result', v_result);
  END IF;

  SELECT product.* INTO v_product FROM public.products AS product WHERE product.id = v_item.product_id FOR NO KEY UPDATE;
  IF NOT FOUND OR v_product.owner_store_id IS DISTINCT FROM p_branch_id OR v_product.is_archived IS DISTINCT FROM false
     OR v_product.name IS DISTINCT FROM v_item.product_name OR v_product.selling_price IS DISTINCT FROM v_item.unit_price
     OR v_product.cost_price IS DISTINCT FROM v_item.unit_cost OR v_product.cost_price IS DISTINCT FROM v_movement.unit_cost THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'POS_CASH_V1_PRODUCT_FORBIDDEN';
  END IF;
  v_stock := (v_product.stock_by_store->>p_branch_id)::integer;
  IF v_stock IS NULL OR v_stock < v_item.quantity THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'POS_CASH_V1_STOCK_UNAVAILABLE';
  END IF;

  -- Use the current native atomic writer. Inventory comes only from the
  -- stable movement and existing stock delta receipt, never a products row.
  v_operations := jsonb_build_array(
    jsonb_build_object('table', 'sales', 'rows', jsonb_build_array((v_checkout->'sale') ||
      CASE WHEN p_verified_author IS NULL THEN '{}'::jsonb
        ELSE jsonb_build_object('cashier_id', p_verified_author->>'subject') END), 'changes', '[]'::jsonb),
    jsonb_build_object('table', 'sale_items', 'rows', jsonb_build_array(v_checkout->'item'), 'changes', '[]'::jsonb),
    jsonb_build_object('table', 'payment_transactions', 'rows', v_tenders, 'changes', '[]'::jsonb),
    jsonb_build_object('table', 'item_activity_logs', 'rows', jsonb_build_array(v_checkout->'movement'), 'changes', '[]'::jsonb)
  );
  v_ack := public.pos_sync_push_aggregate(p_operation_id, p_organization_id, p_branch_id, p_terminal_id::text, v_operations);
  IF v_ack->>'ok' IS DISTINCT FROM 'true' OR v_ack->>'batch_id' IS DISTINCT FROM p_operation_id::text
     OR coalesce(v_ack->>'replayed', 'false') <> 'false' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'POS_CASH_V1_WRITER_UNCONFIRMED';
  END IF;

  -- This scoped evidence projection uses persisted ordinary checkout facts,
  -- with just the owning branch's balance and the cash tender amount.
  SELECT jsonb_build_array(
    jsonb_build_object('type', 'cash_sale', 'row', jsonb_build_object('id', sale.id, 'store_id', sale.store_id,
      'shift_id', sale.shift_id, 'bill_number', sale.bill_number, 'total_amount', sale.total_amount::text)),
    jsonb_build_object('type', 'sale_item', 'row', jsonb_build_object('id', item.id, 'sale_id', item.sale_id,
      'product_id', item.product_id, 'quantity', item.quantity, 'unit_price', item.unit_price::text)),
    jsonb_build_object('type', 'cash_tender', 'row', jsonb_build_object('id', tender.id, 'sale_id', tender.sale_id,
      'store_id', tender.store_id, 'method', tender.method, 'amount', tender.amount::text)),
    jsonb_build_object('type', 'stock_delta', 'row', jsonb_build_object('movement_id', delta.movement_id,
      'product_id', delta.product_id, 'store_id', delta.store_id, 'delta', delta.delta,
      'branch_balance', (product.stock_by_store->>p_branch_id)::integer))
  ) INTO v_changes
  FROM public.sales AS sale
  JOIN public.sale_items AS item ON item.sale_id = sale.id AND item.id = v_item.id AND item.branch_id = p_branch_id
  JOIN public.payment_transactions AS tender ON tender.sale_id = sale.id AND tender.id = v_tender.id AND tender.store_id = p_branch_id
  JOIN public.item_activity_logs AS movement ON movement.id = v_movement.id AND movement.store_id = p_branch_id
  JOIN public.stock_delta_applied AS delta ON delta.movement_id = movement.id AND delta.store_id = p_branch_id
  JOIN public.products AS product ON product.id = delta.product_id AND product.owner_store_id = p_branch_id
  WHERE sale.id = v_sale.id AND sale.store_id = p_branch_id AND sale.shift_id = v_sale.shift_id
    AND sale.bill_number = v_sale.bill_number AND sale.total_amount = v_sale.total_amount
    AND (p_verified_author IS NULL OR sale.cashier_id = p_verified_author->>'subject')
    AND item.product_id = v_item.product_id AND item.quantity = v_item.quantity AND item.unit_price = v_item.unit_price
    AND tender.method = v_tender.method AND tender.amount = v_tender.amount AND tender.terminal_id = p_terminal_id::text
    AND movement.product_id = v_item.product_id AND movement.quantity_delta = v_movement.quantity_delta
    AND delta.product_id = v_item.product_id AND delta.delta = v_movement.quantity_delta
    AND (product.stock_by_store->>p_branch_id)::integer = v_stock + delta.delta;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'POS_CASH_V1_WRITER_UNCONFIRMED';
  END IF;

  IF v_extended THEN
    IF EXISTS (
      SELECT 1 FROM jsonb_populate_recordset(NULL::public.payment_transactions,v_tenders) AS incoming
      LEFT JOIN public.payment_transactions AS saved ON saved.id=incoming.id
      WHERE ROW(saved.source_type,saved.sale_id,saved.store_id,saved.shift_id,saved.terminal_id,saved.method,
          saved.kind,saved.status,saved.amount,saved.reference,saved.metadata,saved.client_transaction_id,saved.cashier_name)
        IS DISTINCT FROM ROW(incoming.source_type,incoming.sale_id,incoming.store_id,incoming.shift_id,incoming.terminal_id,
          incoming.method,incoming.kind,incoming.status,incoming.amount,incoming.reference,incoming.metadata,
          incoming.client_transaction_id,incoming.cashier_name)
    ) OR NOT EXISTS (SELECT 1 FROM public.sales WHERE id=v_sale.id AND payments=v_sale.payments AND payment_type=v_sale.payment_type)
    THEN RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='POS_CASH_V1_WRITER_UNCONFIRMED'; END IF;
    v_changes := v_changes || jsonb_build_array(jsonb_build_object('type','card_or_split','ids',
      (SELECT jsonb_agg(entry->'id' ORDER BY position)
       FROM jsonb_array_elements(v_tenders) WITH ORDINALITY AS tender(entry,position))));
  END IF;
  IF p_verified_author IS NOT NULL THEN
    v_changes := pos_sync_cash_v1.project_receipt(p_branch_id, v_changes);
  END IF;

  SELECT appended.seq INTO STRICT v_seq FROM pos_sync_feed_v1.append_groups(p_organization_id,
    jsonb_build_array(jsonb_build_object('scope_id', p_branch_id, 'epoch', p_epoch,
      'operation_id', p_operation_id, 'changes', v_changes))) AS appended;
  INSERT INTO pos_sync_cash_v1.checkout_route_owners (entity, identity, operation_id)
  SELECT entity, identity, p_operation_id FROM pos_sync_cash_v1.checkout_route_keys(v_operations)
  UNION ALL SELECT 'stock_delta_applied', v_movement.id::text, p_operation_id;
  v_result := jsonb_build_object('sale_id', v_sale.id, 'scope_id', p_branch_id, 'epoch', p_epoch, 'seq', v_seq,
    'operation_id', p_operation_id, 'terminal_id', p_terminal_id, 'installation_generation', v_installation_generation,
    'database_guid', p_database_guid, 'checkout_sha256', v_checkout_sha256);
  IF p_verified_author IS NOT NULL THEN
    v_result := v_result || jsonb_build_object('author_id', p_verified_author->>'author_id',
      'author_key_id', p_verified_author->>'author_key_id');
  END IF;
  PERFORM pos_sync_inbox_v1.record_disposition(p_organization_id, p_operation_id, 'APPLIED', v_result);
  RETURN jsonb_build_object('status', 'APPLIED', 'result', v_result);
END;
$checkout$;

-- Source: scripts/preparation/pos-sync-cash-settings-gateway-v1.sql

ALTER TABLE pos_sync_feed_v1.cash_publications ADD CONSTRAINT cash_publications_tender_changes_check
  CHECK (jsonb_typeof(changes) = 'array' AND jsonb_array_length(changes) BETWEEN 4 AND 19) NOT VALID;
ALTER TABLE pos_sync_feed_v1.cash_publications VALIDATE CONSTRAINT cash_publications_tender_changes_check;
ALTER TABLE pos_sync_feed_v1.cash_publications DROP CONSTRAINT cash_publications_changes_check;

CREATE OR REPLACE FUNCTION pos_sync_feed_v1.record_cash_publication(
  p_org text, p_branch text, p_epoch uuid, p_seq bigint, p_operation uuid,
  p_terminal uuid, p_generation uuid, p_database uuid, p_hash text
)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
AS $record$
DECLARE
  v_changes jsonb;
BEGIN
  IF p_terminal IS NULL OR p_generation IS NULL OR p_database IS NULL OR p_operation IS NULL
     OR p_hash IS NULL OR p_hash !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'POS_CASH_SETTINGS_V1_INVALID_ACCEPTANCE';
  END IF;
  SELECT feed.changes INTO v_changes FROM pos_sync_feed_v1.feed_groups AS feed
  JOIN pos_sync_feed_v1.cash_settings_pilots AS pilot USING (organization_id, scope_id, epoch)
  WHERE (feed.organization_id, feed.scope_id, feed.epoch, feed.seq, feed.operation_id) =
    (p_org, p_branch, p_epoch, p_seq, p_operation) AND feed.seq > pilot.armed_after
  FOR NO KEY UPDATE OF feed;
  IF NOT FOUND OR jsonb_array_length(v_changes) NOT BETWEEN 4 AND 19
     OR v_changes->0->>'table_name' IS DISTINCT FROM 'sales'
     OR v_changes->1->>'table_name' IS DISTINCT FROM 'sale_items'
     OR v_changes->2->>'table_name' IS DISTINCT FROM 'payment_transactions'
     OR v_changes->3->>'table_name' IS DISTINCT FROM 'item_activity_logs'
     OR v_changes->0->'row_data'->>'store_id' IS DISTINCT FROM p_branch
     OR v_changes->0->'row_data'->>'branch_id' IS DISTINCT FROM p_branch
     OR v_changes->1->'row_data'->>'branch_id' IS DISTINCT FROM p_branch
     OR v_changes->2->'row_data'->>'store_id' IS DISTINCT FROM p_branch
     OR v_changes->3->'row_data'->>'store_id' IS DISTINCT FROM p_branch
     OR v_changes->2->'row_data'->>'terminal_id' IS DISTINCT FROM p_terminal::text
     OR v_changes->3->'row_data'->>'terminal_id' IS DISTINCT FROM p_terminal::text
     OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(v_changes) WITH ORDINALITY AS entry(change,ordinality)
       WHERE ordinality > 4 AND (change->>'table_name' IS DISTINCT FROM 'payment_transactions'
         OR change->'row_data'->>'store_id' IS DISTINCT FROM p_branch
         OR change->'row_data'->>'sale_id' IS DISTINCT FROM v_changes->0->'row_data'->>'id'
         OR change->'row_data'->>'terminal_id' IS DISTINCT FROM p_terminal::text)
     ) THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'POS_CASH_SETTINGS_V1_PUBLICATION_UNVERIFIED';
  END IF;
  INSERT INTO pos_sync_feed_v1.cash_publications VALUES (
    p_org, p_branch, p_epoch, p_seq, p_operation, v_changes,
    jsonb_build_object('terminal_id', p_terminal, 'installation_generation', p_generation,
      'database_guid', p_database, 'checkout_sha256', p_hash));
END;
$record$;

-- Source: scripts/preparation/pos-booking-handover-v1.sql
-- Apply after the scoped booking RPCs and the terminal-bound aggregate writer.
-- Both existing sale paths retain their scope, financial and checkout guards.


CREATE OR REPLACE FUNCTION public.booking_handover(
  _booking_id uuid, _amount numeric, _sale jsonb, _items jsonb,
  _payments jsonb, _movements jsonb, _member jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
AS $handover$
DECLARE
  booking public.bookings%ROWTYPE;
  receipt public.sales%ROWTYPE;
  payment public.booking_payments%ROWTYPE;
  settled record;
  sale_id uuid := nullif(_sale->>'id', '')::uuid;
  attempt text := nullif(_sale->>'client_transaction_id', '');
  method text := nullif(_sale->>'payment_type', '');
  replayed boolean;
BEGIN
  IF (SELECT auth.uid()) IS NULL OR public.is_staff_now() IS NOT TRUE OR
      public.has_perm('can_collect_booking') IS NOT TRUE THEN
    RAISE EXCEPTION 'PERMISSION_DENIED_COLLECT_BOOKING' USING ERRCODE = '42501';
  END IF;
  IF public.has_perm('can_process_sale') IS NOT TRUE THEN
    RAISE EXCEPTION 'PERMISSION_DENIED_SALE' USING ERRCODE = '42501';
  END IF;
  IF sale_id IS NULL OR attempt IS DISTINCT FROM sale_id::text OR method IS NULL OR
      nullif(_sale->>'bill_number', '') IS NULL OR _amount IS NULL OR
      _amount::text IN ('NaN', 'Infinity', '-Infinity') OR _amount < 0 OR
      coalesce((_sale->>'is_exchange')::boolean, false) OR coalesce((_sale->>'is_refunded')::boolean, false) OR
      nullif(_sale->>'original_bill_number', '') IS NOT NULL THEN
    RAISE EXCEPTION 'BOOKING_HANDOVER_INVALID' USING ERRCODE = '22023';
  END IF;

  SELECT b.* INTO booking FROM public.bookings b
   WHERE b.id = _booking_id AND b.store_id = _sale->>'store_id'
     AND public.store_visible(b.store_id) AND public.user_has_store_access(b.store_id)
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BOOKING_NOT_FOUND'; END IF;
  IF booking.status = 'cancelled' THEN RAISE EXCEPTION 'BOOKING_CANCELLED'; END IF;
  replayed := booking.status = 'collected';

  IF replayed THEN
    SELECT s.* INTO receipt FROM public.sales s WHERE s.id = sale_id AND s.client_transaction_id = attempt
      AND s.store_id = booking.store_id AND s.bill_number = booking.sale_receipt_no;
    IF NOT FOUND THEN RAISE EXCEPTION 'BOOKING_ALREADY_COLLECTED'; END IF;
  ELSE
    IF booking.status IS DISTINCT FROM 'active' OR booking.sale_receipt_no IS NOT NULL OR
        round((_sale->>'total_amount')::numeric, 2) IS DISTINCT FROM round(booking.total, 2) OR
        round((_sale->>'paid_amount')::numeric, 2) IS DISTINCT FROM round(booking.total, 2) OR
        nullif(_sale->>'member_id', '')::uuid IS DISTINCT FROM booking.member_id OR
        (_member IS NOT NULL AND nullif(_member->>'id', '')::uuid IS DISTINCT FROM booking.member_id) THEN
      RAISE EXCEPTION 'BOOKING_CHANGED';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended('pos-booking-sale:' || sale_id::text, 0));
    IF EXISTS (SELECT 1 FROM public.sales s WHERE s.id = sale_id OR s.client_transaction_id = attempt) THEN
      RAISE EXCEPTION 'BOOKING_CHANGED';
    END IF;
    SELECT * INTO STRICT settled FROM public.booking_collect(
      booking.id, round(_amount, 2), method, _sale->>'cashier_name', NULL, attempt, true
    );
    IF settled.duplicate THEN RAISE EXCEPTION 'BOOKING_CHANGED'; END IF;
    IF NOT settled.fully_paid OR settled.status IS DISTINCT FROM 'collected' THEN
      RAISE EXCEPTION 'BOOKING_BALANCE_DUE';
    END IF;
    PERFORM public.pos_sale_commit(
      _sale || jsonb_build_object('change_amount', settled.change_due), _items, _payments, _movements, _member, NULL
    );
    SELECT s.* INTO STRICT receipt FROM public.sales s WHERE s.id = sale_id AND s.client_transaction_id = attempt
      AND s.store_id = booking.store_id AND s.bill_number = _sale->>'bill_number';
    UPDATE public.bookings b SET sale_receipt_no = receipt.bill_number
      WHERE b.id = booking.id AND b.store_id = booking.store_id AND b.status = 'collected'
      RETURNING b.* INTO STRICT booking;
  END IF;

  SELECT p.* INTO payment FROM public.booking_payments p
    WHERE p.booking_id = booking.id AND p.client_payment_id = attempt AND p.status = 'settled' AND p.kind = 'payment';
  RETURN jsonb_build_object(
    'sale_id', receipt.id, 'sale_receipt_no', receipt.bill_number, 'sale_created_at', receipt.created_at,
    'closed_at', booking.closed_at, 'paid', booking.paid, 'change', receipt.change_amount, 'replayed', replayed,
    'payment', CASE WHEN payment.id IS NOT NULL THEN to_jsonb(payment) ELSE NULL END,
    'sale', CASE WHEN replayed THEN to_jsonb(receipt) || jsonb_build_object('sale_items',
      (SELECT coalesce(jsonb_agg(to_jsonb(i) ORDER BY i.id), '[]'::jsonb) FROM public.sale_items i WHERE i.sale_id = receipt.id))
      ELSE NULL END
  );
END;
$handover$;

REVOKE ALL ON FUNCTION public.booking_handover(uuid,numeric,jsonb,jsonb,jsonb,jsonb,jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.booking_handover(uuid,numeric,jsonb,jsonb,jsonb,jsonb,jsonb) TO authenticated;

-- The normal native event stream already sends the complete local transaction.
-- Its dependency order puts bookings before payments, which is right for
-- creation and wrong for collecting an existing booking with one last tender.
CREATE OR REPLACE FUNCTION private.check_booking_handover_upload(
  p_branch text, p_operations jsonb, p_after boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
AS $upload$
DECLARE
  handover record;
  booking public.bookings%ROWTYPE;
  payment public.booking_payments%ROWTYPE;
  sale public.sales%ROWTYPE;
  payment_json jsonb;
  booking_order bigint;
  total numeric;
  tender numeric;
  paid numeric;
  version integer;
BEGIN
  WITH rows AS (
    SELECT op.value->>'table' AS name, op.ordinality, r.value
    FROM jsonb_array_elements(p_operations) WITH ORDINALITY op
    CROSS JOIN LATERAL jsonb_array_elements(coalesce(op.value->'rows','[]'::jsonb)) r
    WHERE op.value->>'table' IN ('bookings','sales')
  )
  SELECT b.value AS booking_row, s.value AS sale_row, b.ordinality AS booking_order INTO handover
  FROM rows b JOIN rows s ON s.name = 'sales' AND s.value->>'bill_number' = b.value->>'sale_receipt_no'
  WHERE b.name = 'bookings' AND b.value->>'status' = 'collected';
  IF NOT FOUND THEN RETURN p_operations; END IF;

  IF (SELECT count(*) FROM jsonb_array_elements(p_operations) op
      WHERE op->>'table' = 'bookings') <> 1 OR
     (SELECT count(*) FROM jsonb_array_elements(p_operations) op
      WHERE op->>'table' = 'sales') <> 1 OR
     jsonb_array_length(p_operations->(handover.booking_order::integer-1)->'rows') <> 1 OR
     NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_operations) op
       WHERE op->>'table' = 'sales' AND jsonb_array_length(op->'rows') = 1) OR
     (SELECT count(*) FROM jsonb_array_elements(p_operations) op
      WHERE op->>'table' = 'booking_payments') > 1 OR
     EXISTS (SELECT 1 FROM jsonb_array_elements(p_operations) op
       WHERE op->>'table' = 'booking_payments' AND
       (jsonb_array_length(op->'rows') <> 1 OR coalesce((op->>'deletePhase')::boolean,false))) OR
     handover.booking_row->>'store_id' IS DISTINCT FROM p_branch OR
     handover.sale_row->>'store_id' IS DISTINCT FROM p_branch OR
     handover.sale_row->>'id' IS DISTINCT FROM handover.sale_row->>'client_transaction_id' OR
     coalesce((handover.sale_row->>'is_refunded')::boolean, false) OR
     coalesce((handover.sale_row->>'is_exchange')::boolean, false) THEN
    RAISE EXCEPTION 'BOOKING_HANDOVER_UPLOAD_INVALID';
  END IF;

  SELECT op->'rows'->0 INTO payment_json FROM jsonb_array_elements(p_operations) op
    WHERE op->>'table' = 'booking_payments';
  IF payment_json IS NOT NULL AND (payment_json->>'booking_id' IS DISTINCT FROM handover.booking_row->>'id' OR
      payment_json->>'client_payment_id' IS DISTINCT FROM handover.sale_row->>'client_transaction_id' OR
      payment_json->>'method' IS DISTINCT FROM handover.sale_row->>'payment_type' OR
      payment_json->>'status' IS DISTINCT FROM 'settled' OR payment_json->>'kind' IS DISTINCT FROM 'payment' OR
      NOT coalesce((payment_json->>'amount')::numeric > 0, false)) THEN
    RAISE EXCEPTION 'BOOKING_HANDOVER_UPLOAD_INVALID';
  END IF;

  SELECT b.* INTO booking FROM public.bookings b
    WHERE b.id = (handover.booking_row->>'id')::uuid AND b.store_id = p_branch FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BOOKING_HANDOVER_UPLOAD_BOOKING_MISSING'; END IF;
  total := round(booking.total, 2);
  tender := coalesce(round((payment_json->>'amount')::numeric, 2), 0);
  paid := public.booking_net_paid(booking.id);
  version := (handover.booking_row->>'row_version')::integer;
  IF version IS NULL OR total IS NULL OR
     round((handover.booking_row->>'total')::numeric, 2) IS DISTINCT FROM total OR
     round((handover.booking_row->>'paid')::numeric, 2) IS DISTINCT FROM total OR
     round((handover.sale_row->>'total_amount')::numeric, 2) IS DISTINCT FROM total OR
     round((handover.sale_row->>'paid_amount')::numeric, 2) IS DISTINCT FROM total OR
     nullif(handover.sale_row->>'member_id', '')::uuid IS DISTINCT FROM booking.member_id THEN
    RAISE EXCEPTION 'BOOKING_HANDOVER_UPLOAD_CONFLICT';
  END IF;

  IF p_after THEN
    SELECT s.* INTO sale FROM public.sales s WHERE s.id = (handover.sale_row->>'id')::uuid
      AND s.store_id = p_branch AND s.client_transaction_id = handover.sale_row->>'client_transaction_id'
      AND s.bill_number = handover.booking_row->>'sale_receipt_no';
    IF NOT FOUND OR booking.status IS DISTINCT FROM 'collected' OR
       booking.sale_receipt_no IS DISTINCT FROM sale.bill_number OR booking.row_version IS DISTINCT FROM version OR
       round(booking.paid, 2) IS DISTINCT FROM total OR paid IS DISTINCT FROM total THEN
      RAISE EXCEPTION 'BOOKING_HANDOVER_UPLOAD_UNCONFIRMED';
    END IF;
    IF payment_json IS NOT NULL THEN
      SELECT p.* INTO payment FROM public.booking_payments p WHERE p.id = (payment_json->>'id')::uuid
        AND p.booking_id = booking.id AND p.client_payment_id = sale.client_transaction_id;
      IF NOT FOUND OR round(payment.amount, 2) IS DISTINCT FROM tender OR
        payment.status IS DISTINCT FROM 'settled' OR payment.kind IS DISTINCT FROM 'payment' THEN
        RAISE EXCEPTION 'BOOKING_HANDOVER_UPLOAD_UNCONFIRMED';
      END IF;
    END IF;
    RETURN p_operations;
  END IF;

  IF booking.status IS DISTINCT FROM 'active' OR booking.sale_receipt_no IS NOT NULL OR
     booking.row_version IS DISTINCT FROM version-1 OR paid + tender IS DISTINCT FROM total OR
     EXISTS (SELECT 1 FROM public.sales s WHERE s.id = (handover.sale_row->>'id')::uuid
       OR s.client_transaction_id = handover.sale_row->>'client_transaction_id') OR
     (payment_json IS NOT NULL AND EXISTS (SELECT 1 FROM public.booking_payments p
       WHERE p.id = (payment_json->>'id')::uuid OR
         (p.booking_id = booking.id AND p.client_payment_id = payment_json->>'client_payment_id'))) THEN
    RAISE EXCEPTION 'BOOKING_HANDOVER_UPLOAD_CONFLICT';
  END IF;
  IF payment_json IS NULL THEN RETURN p_operations; END IF;

  booking_order := handover.booking_order;
  RETURN (SELECT jsonb_agg(op.value ORDER BY
    CASE WHEN op.value->>'table' = 'booking_payments' THEN booking_order ELSE op.ordinality END,
    CASE WHEN op.value->>'table' = 'booking_payments' THEN 0 ELSE 1 END)
    FROM jsonb_array_elements(p_operations) WITH ORDINALITY op);
END;
$upload$;

REVOKE ALL ON FUNCTION private.check_booking_handover_upload(text,jsonb,boolean) FROM PUBLIC, anon, authenticated, service_role;

-- Keep the current route (including the cash owner and FIN62 checks), OID,
-- existing hash and duplicate semantics. Change only the new-write loop.
DO $install_handover_upload$
DECLARE
  target regprocedure := to_regprocedure('public.pos_sync_push_aggregate(uuid,text,text,text,jsonb)');
  definition text;
  begin_rows constant text := 'FOR v_op IN SELECT value FROM jsonb_array_elements(p_operations) LOOP';
  before_receipt constant text := 'INSERT INTO public.sync_idempotency_receipts(batch_id,organization_id,branch_id,table_name,payload_hash,applied_count)';
BEGIN
  SELECT replace(pg_get_functiondef(proc.oid), E'\r\n', E'\n') INTO definition
    FROM pg_proc proc WHERE proc.oid = target AND proc.prosecdef AND pg_get_userbyid(proc.proowner) = current_user;
  IF definition IS NULL OR has_function_privilege('anon', target, 'EXECUTE') OR
     has_function_privilege('authenticated', target, 'EXECUTE') OR
     NOT has_function_privilege('service_role', target, 'EXECUTE') OR
     strpos(definition, 'private.check_booking_handover_upload') <> 0 OR
     length(definition)-length(replace(definition,begin_rows,'')) <> length(begin_rows) OR
     length(definition)-length(replace(definition,before_receipt,'')) <> length(before_receipt) OR
     strpos(definition, 'pos_sync_validate_scope') = 0 OR
     strpos(definition, 'SYNC_IDEMPOTENCY_MISMATCH') = 0 OR
     strpos(definition, 'SYNC_IDEMPOTENCY_MISMATCH') > strpos(definition, begin_rows) OR
     strpos(definition, begin_rows) > strpos(definition, before_receipt) THEN
    RAISE EXCEPTION 'POS_BOOKING_HANDOVER_WRITER_SOURCE_UNEXPECTED';
  END IF;
  definition := replace(definition, begin_rows,
    'p_operations := private.check_booking_handover_upload(p_branch_id,p_operations,false);' || E'\n ' || begin_rows);
  EXECUTE replace(definition, before_receipt,
    'PERFORM private.check_booking_handover_upload(p_branch_id,p_operations,true);' || E'\n ' || before_receipt);
END;
$install_handover_upload$;

NOTIFY pgrst, 'reload schema';

-- Source: scripts/preparation/pos-sync-transfer-receipt-feed-v1.sql
-- Install after the grouped dispatch and native warehouse receipt modules.
-- Only the canonical writers know which destination movements they inserted.


CREATE OR REPLACE FUNCTION pos_sync_feed_v1.publish_transfer_receipt(p_transfer uuid,p_movements jsonb)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog SET timezone='UTC'
AS $publish$
DECLARE
  v_transfer public.stock_transfers;
  v_branch text;
  v_epoch uuid;
  v_lines jsonb;
  v_stock jsonb;
  v_logs jsonb;
  v_transfer_row jsonb;
  v_graph text;
  v_changes jsonb;
  v_metadata jsonb;
  v_operation uuid;
  v_seq bigint;
  v_row jsonb;
  v_header_fields constant text[]:=ARRAY['id','ref','kind','transfer_scope','from_store_id','from_store_name','from_group_id',
    'to_store_id','to_store_name','to_group_id','status','note','created_by','approved_by','approved_at','received_by',
    'received_at','rejected_reason','created_at','updated_at','row_version','verified_by','verified_at','posted_at',
    'discrepancy_reason','rejected_by','cancelled_reason','dispatched_by','dispatched_at','closed_at','fulfilment','source_request_id'];
  v_line_fields constant text[]:=ARRAY['id','transfer_id','product_id','barcode','sku','product_name','quantity','quantity_received',
    'unit_cost','created_at','row_version','quantity_approved','quantity_dispatched','quantity_verified'];
  v_log_fields constant text[]:=ARRAY['id','product_id','product_name','sku','barcode','store_id','terminal_id','activity_type','reference',
    'quantity_delta','stock_before','stock_after','unit_cost','staff_id','staff_name','role','note','created_at','row_version','item_id',
    'sale_id','transfer_id','quantity','created_by','notes'];
BEGIN
  SELECT * INTO STRICT v_transfer FROM public.stock_transfers WHERE id=p_transfer;
  IF v_transfer.kind<>'transfer' OR v_transfer.status NOT IN ('received','completed','completed_with_discrepancy')
    OR v_transfer.from_store_id=v_transfer.to_store_id OR v_transfer.received_at IS NULL
    OR length(v_transfer.from_store_id) NOT BETWEEN 1 AND 128 OR length(v_transfer.to_store_id) NOT BETWEEN 1 AND 128
    OR v_transfer.dispatched_at IS NULL OR v_transfer.dispatched_by IS NULL THEN RETURN; END IF;
  -- The deferred stock writer takes locks for these product owners as well.
  PERFORM head.scope_id FROM pos_sync_feed_v1.feed_heads AS head
  WHERE head.organization_id='default' AND head.scope_id IN (
    SELECT unnest(ARRAY[v_transfer.from_store_id,v_transfer.to_store_id])
    UNION SELECT product.owner_store_id FROM jsonb_array_elements(p_movements) AS movement
      JOIN public.item_activity_logs AS log ON log.id=(movement->>'log_id')::uuid
      JOIN public.products AS product ON product.id=log.product_id)
  ORDER BY head.scope_id FOR NO KEY UPDATE OF head;
  IF pos_sync_feed_v1.extended_scope_epoch('default',v_transfer.from_store_id) IS NULL AND
     pos_sync_feed_v1.extended_scope_epoch('default',v_transfer.to_store_id) IS NULL THEN RETURN; END IF;

  SELECT coalesce(jsonb_agg(pos_sync_feed_v1.correction_receipt_row(to_jsonb(line),v_line_fields,ARRAY['unit_cost'])
    ORDER BY line.id),'[]'::jsonb) INTO v_lines
  FROM (SELECT * FROM public.stock_transfer_items WHERE transfer_id=p_transfer ORDER BY id LIMIT 101) AS line;
  IF jsonb_array_length(v_lines) NOT BETWEEN 1 AND 100 OR v_lines @> '[null]'::jsonb OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_lines) AS line
    WHERE line->>'quantity_dispatched' IS NULL OR (line->>'quantity_dispatched')::integer < 0 OR
      (line->>'quantity_received')::integer NOT BETWEEN 0 AND (line->>'quantity_dispatched')::integer OR
      (line->>'quantity_dispatched')::integer>coalesce((line->>'quantity_approved')::integer,(line->>'quantity')::integer) OR
      (v_transfer.status='received' AND line->>'quantity_verified' IS NOT NULL) OR
      (v_transfer.status<>'received' AND line->>'quantity_verified' IS DISTINCT FROM line->>'quantity_received')
  ) THEN RETURN; END IF;
  SELECT coalesce(jsonb_agg(pos_sync_feed_v1.correction_receipt_row(to_jsonb(log),v_log_fields,ARRAY['unit_cost'])
    ORDER BY movement.ordinal),'[]'::jsonb) INTO v_logs
  FROM jsonb_array_elements(p_movements) WITH ORDINALITY AS movement(row,ordinal)
  JOIN public.item_activity_logs AS log ON log.id=(movement.row->>'log_id')::uuid
  JOIN public.stock_transfer_items AS line ON line.id=(movement.row->>'line_id')::uuid AND line.transfer_id=p_transfer
  WHERE log.store_id=v_transfer.to_store_id AND log.activity_type='transfer_in' AND log.reference=v_transfer.ref
    AND log.quantity_delta=line.quantity_verified AND log.quantity_delta>0 AND log.stock_after=log.stock_before+log.quantity_delta
    AND log.staff_name=coalesce(v_transfer.verified_by,'') AND log.created_at=v_transfer.posted_at
    AND (v_transfer.transfer_scope='INTER_GROUP' OR log.product_id=line.product_id);
  IF v_logs @> '[null]'::jsonb OR jsonb_array_length(v_logs)<>jsonb_array_length(p_movements) OR
    jsonb_array_length(v_logs)<>(SELECT count(*) FROM jsonb_array_elements(v_lines) AS line
      WHERE (line->>'quantity_verified')::integer>0) OR
    (v_transfer.status='received' AND (v_transfer.verified_at IS NOT NULL OR v_transfer.posted_at IS NOT NULL)) OR
    (v_transfer.status<>'received' AND (v_transfer.verified_at IS NULL OR v_transfer.posted_at IS DISTINCT FROM v_transfer.verified_at
      OR (v_transfer.status='completed_with_discrepancy') IS DISTINCT FROM EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_lines) AS line
        WHERE (line->>'quantity_verified')::integer<(line->>'quantity_dispatched')::integer))) THEN RETURN; END IF;

  v_transfer_row:=pos_sync_feed_v1.correction_receipt_row(to_jsonb(v_transfer),v_header_fields,ARRAY[]::text[]);
  IF v_transfer_row IS NULL THEN RETURN; END IF;
  v_metadata:=jsonb_build_object('financial',jsonb_build_object('kind','transfer_v1','transfer_id',p_transfer));
  FOR v_branch IN SELECT side.branch FROM (VALUES (v_transfer.from_store_id),(v_transfer.to_store_id)) AS side(branch)
    ORDER BY side.branch COLLATE "C"
  LOOP
    v_epoch:=pos_sync_feed_v1.extended_scope_epoch('default',v_branch);
    IF v_epoch IS NULL OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_lines) AS line
      WHERE line->>'product_id' IS NOT NULL AND NOT public.product_available_in_catalogue((line->>'product_id')::uuid,v_branch)
    ) OR (v_branch=v_transfer.to_store_id AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_logs) AS log
      WHERE NOT public.product_available_in_catalogue((log->>'product_id')::uuid,v_branch)
    )) THEN CONTINUE; END IF;
    v_stock:='[]'::jsonb;
    IF v_branch=v_transfer.to_store_id THEN
      -- Stock ownership and retirement remain on the existing projection.
      -- A shared product's other branch bucket still uses the legacy mirror.
      SELECT coalesce(jsonb_agg(pos_sync_feed_v1.live_stock_row(product.id,product.stock_by_store,v_branch,product.row_version)
        ORDER BY product.id),'[]'::jsonb) INTO v_stock
      FROM public.products AS product WHERE product.owner_store_id=v_branch
        AND product.id IN (SELECT (log->>'product_id')::uuid FROM jsonb_array_elements(v_logs) AS log);
      IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_stock) AS stock
        CROSS JOIN LATERAL (
          SELECT log.row FROM jsonb_array_elements(v_logs) WITH ORDINALITY AS log(row,ordinal)
          WHERE log.row->>'product_id'=stock->>'product_id' ORDER BY log.ordinal DESC LIMIT 1
        ) AS final
        WHERE final.row->'stock_after' IS DISTINCT FROM stock->'branch_balance'
      ) THEN CONTINUE; END IF;
    END IF;
    v_graph:=jsonb_build_object('branch_id',v_branch,'transfer',v_transfer_row,'request',NULL,'lines',v_lines,'stock',v_stock,
      'logs',CASE WHEN v_branch=v_transfer.to_store_id THEN v_logs ELSE '[]'::jsonb END,
      'movements',CASE WHEN v_branch=v_transfer.to_store_id THEN p_movements ELSE '[]'::jsonb END)::text;
    IF octet_length(v_graph)>196608 THEN CONTINUE; END IF;
    v_operation:=left(encode(sha256(convert_to(jsonb_build_array(
      'transfer-receipt-v1',v_branch,v_epoch,p_transfer,v_transfer.status)::text,'UTF8')),'hex'),32)::uuid;
    v_changes:=jsonb_build_array(pos_sync_feed_v1.financial_change('stock_transfers',jsonb_build_object('id',p_transfer),
        jsonb_build_object('id',p_transfer,'store_id',v_branch,'row_version',v_transfer.row_version,
        'graph_json',v_graph,'graph_sha256',encode(sha256(convert_to(v_graph,'UTF8')),'hex')),v_transfer.row_version));
    IF octet_length((v_changes||jsonb_build_array(v_metadata))::text)>262144 THEN CONTINUE; END IF;
    v_seq:=pos_sync_feed_v1.append_extended_group('default',v_branch,v_epoch,v_operation,v_changes,v_metadata);
    FOR v_row IN SELECT value FROM jsonb_array_elements(v_stock)
    LOOP
      PERFORM pos_sync_feed_v1.cover_stock_revision('default',v_branch,v_epoch,v_seq,(v_row->>'product_id')::uuid,
        (v_row->>'branch_balance')::integer,(v_row->>'row_version')::integer);
    END LOOP;
  END LOOP;
END;
$publish$;
REVOKE ALL ON FUNCTION pos_sync_feed_v1.publish_transfer_receipt(uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;

-- Adapt the two private implementations shared by the guarded web and native
-- entrypoints. Refuse unknown anchors so installation cannot replace a writer.
DO $install$
DECLARE
  v_definition text;
  v_anchor text;
  v_replacement text;
  v_stage text;
  v_signature text;
BEGIN
  FOR v_stage,v_signature IN VALUES ('receive','private.stock_transfer_receive(uuid,text,boolean,jsonb)'),
    ('verify','private.stock_transfer_verify(uuid,text,jsonb,text)')
  LOOP
    SELECT pg_get_functiondef(to_regprocedure(v_signature)) INTO v_definition;
    IF v_definition IS NULL THEN RAISE EXCEPTION 'Canonical warehouse writer is missing: %',v_stage; END IF;
    v_definition:=replace(v_definition,chr(13)||chr(10),chr(10));
    IF strpos(v_definition,'pos_sync_feed_v1.publish_transfer_receipt(t.id,')>0 THEN CONTINUE; END IF;
    IF v_stage='verify' THEN
      v_anchor:='  v_short boolean := false;';
      v_replacement:=v_anchor || E'\n  v_sync_log uuid;\n  v_sync_movements jsonb := ''[]''::jsonb;';
      IF length(v_definition)-length(replace(v_definition,v_anchor,''))<>length(v_anchor) THEN
        RAISE EXCEPTION 'Expected canonical verification declarations missing or ambiguous';
      END IF;
      v_definition:=replace(v_definition,v_anchor,v_replacement);
      v_anchor:='      FROM public.products p WHERE p.id = v_target;';
      v_replacement:=left(v_anchor,-1) || E' RETURNING id INTO v_sync_log;\n'
        || E'    v_sync_movements := v_sync_movements || jsonb_build_array(\n'
        || '      jsonb_build_object(''line_id'',it.id,''log_id'',v_sync_log));';
      IF length(v_definition)-length(replace(v_definition,v_anchor,''))<>length(v_anchor) THEN
        RAISE EXCEPTION 'Expected canonical verification movement insert missing or ambiguous';
      END IF;
      v_definition:=replace(v_definition,v_anchor,v_replacement);
    END IF;
    v_anchor:=E'   WHERE id = t.id;\nEND';
    v_replacement:=E'   WHERE id = t.id;\n  PERFORM pos_sync_feed_v1.publish_transfer_receipt(t.id,'
      || CASE WHEN v_stage='verify' THEN 'v_sync_movements' ELSE '''[]''::jsonb' END || E');\nEND';
    IF length(v_definition)-length(replace(v_definition,v_anchor,''))<>length(v_anchor) THEN
      RAISE EXCEPTION 'Expected canonical warehouse status update missing or ambiguous: %',v_stage;
    END IF;
    EXECUTE replace(v_definition,v_anchor,v_replacement);
  END LOOP;
END;
$install$;

DO $beta_upgrade_verify$
BEGIN
  IF (SELECT count(*) FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind IN ('r','p') AND relrowsecurity) <> 79 OR
     (SELECT count(*) FROM pg_class WHERE relnamespace='pos_sync_feed_v1'::regnamespace AND relkind IN ('r','p') AND relrowsecurity) <> 18 OR
     has_function_privilege('anon','public.booking_handover(uuid,numeric,jsonb,jsonb,jsonb,jsonb,jsonb)','execute') OR
     NOT has_function_privilege('authenticated','public.booking_handover(uuid,numeric,jsonb,jsonb,jsonb,jsonb,jsonb)','execute') OR
     has_function_privilege('service_role','public.booking_handover(uuid,numeric,jsonb,jsonb,jsonb,jsonb,jsonb)','execute') OR
     has_function_privilege('authenticated','pos_sync_feed_v1.publish_transfer_receipt(uuid,jsonb)','execute') OR
     has_function_privilege('service_role','pos_sync_feed_v1.publish_transfer_receipt(uuid,jsonb)','execute') OR
     has_function_privilege('authenticated','pos_sync_cash_v1.assert_extended_tenders(public.sales,jsonb,uuid)','execute') OR
     has_function_privilege('service_role','pos_sync_cash_v1.assert_extended_tenders(public.sales,jsonb,uuid)','execute') OR
     NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='pos_sync_feed_v1.cash_publications'::regclass
       AND conname='cash_publications_tender_changes_check' AND convalidated) THEN
    RAISE EXCEPTION 'RETAIL_POS_BETA_UPGRADE_VERIFICATION_FAILED';
  END IF;
END $beta_upgrade_verify$;
$retail_reviewed_payload$;
 INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES('20261110031005','retail_pos_beta_sync_tenders_transfer_booking_upgrade',ARRAY[$retail_ledger_source$-- Upgrade the populated Retail POS Beta project (irjkmhgrjgcaoixcixut).
-- The exact cluster and the reviewed legacy writer bodies are required.
-- Apply once to beta only. Keep this file outside the production migration path.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $beta_upgrade_guard$
DECLARE
  expected record;
  live_oid regprocedure;
BEGIN
  IF current_user <> 'postgres' OR current_database() <> 'postgres' OR
     (SELECT system_identifier::text FROM pg_catalog.pg_control_system()) <> '7703759698107299042' THEN
    RAISE EXCEPTION 'RETAIL_POS_BETA_WRONG_CLUSTER';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(1907170937, 451);
  IF to_regclass('pos_beta_install_private.installer_chunk') IS NULL OR
     to_regprocedure('public.booking_handover(uuid,numeric,jsonb,jsonb,jsonb,jsonb,jsonb)') IS NOT NULL OR
     to_regprocedure('pos_sync_feed_v1.publish_transfer_receipt(uuid,jsonb)') IS NOT NULL OR
     to_regprocedure('pos_sync_cash_v1.assert_extended_tenders(public.sales,jsonb,uuid)') IS NOT NULL OR
     NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='pos_sync_feed_v1.cash_publications'::regclass
       AND conname='cash_publications_changes_check' AND convalidated
       AND pg_get_constraintdef(oid) = 'CHECK (((jsonb_typeof(changes) = ''array''::text) AND (jsonb_array_length(changes) = 4)))') THEN
    RAISE EXCEPTION 'RETAIL_POS_BETA_UNEXPECTED_UPGRADE_BASELINE';
  END IF;
  FOR expected IN SELECT * FROM (VALUES
    ('pos_sync_cash_v1.apply_checkout(text,text,uuid,text,uuid,uuid,uuid,uuid,text,text,jsonb)', 'c1ae63fac832663f0ddfd72e97061a34'),
    ('pos_sync_cash_v1.project_receipt(text,jsonb)', '31edf7d939a612ce65b2e2e471b65567'),
    ('pos_sync_feed_v1.record_cash_publication(text,text,uuid,bigint,uuid,uuid,uuid,uuid,text)', 'd162da297004812a6f691a05979a5d54')
  ) AS verified(signature, body_hash) LOOP
    live_oid := to_regprocedure(expected.signature);
    IF md5(replace(pg_get_functiondef(live_oid),chr(13)||chr(10),chr(10))) IS DISTINCT FROM expected.body_hash THEN
      RAISE EXCEPTION 'RETAIL_POS_BETA_WRITER_CHANGED: %', expected.signature;
    END IF;
  END LOOP;
END $beta_upgrade_guard$;

-- Source: scripts/preparation/pos-sync-cash-receive-v1.sql

CREATE FUNCTION pos_sync_cash_v1.assert_extended_tenders(
  p_sale public.sales, p_tenders jsonb, p_terminal uuid
) RETURNS void
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $tenders$
DECLARE
  v_entry jsonb;
  v_payment jsonb;
  v_tender public.payment_transactions%ROWTYPE;
  v_position integer;
  v_total numeric := 0;
  v_biggest numeric := 0;
  v_headline text;
  v_has_card boolean := false;
  v_amount numeric;
  v_reference text;
  v_ids uuid[] := ARRAY[]::uuid[];
  v_payment_ids uuid[] := ARRAY[]::uuid[];
  v_payment_id uuid;
BEGIN
  IF jsonb_typeof(p_tenders) IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_sale.payments) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_tenders) NOT BETWEEN 1 AND 16
     OR jsonb_array_length(p_tenders) <> jsonb_array_length(p_sale.payments) THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='POS_TENDER_INVALID';
  END IF;
  FOR v_entry,v_position IN SELECT value,ordinality::integer-1
    FROM jsonb_array_elements(p_tenders) WITH ORDINALITY
  LOOP
    v_payment := p_sale.payments->v_position;
    IF jsonb_typeof(v_entry) IS DISTINCT FROM 'object' OR jsonb_typeof(v_payment) IS DISTINCT FROM 'object'
       OR v_entry - ARRAY['id','source_type','sale_id','store_id','shift_id','terminal_id','amount','method','kind',
         'note','paid_at','created_at','updated_at','row_version','status','metadata','client_transaction_id',
         'reference','cashier_name'] <> '{}'::jsonb
       OR v_payment - ARRAY['id','method','amount','bankName','ref','reference','referenceNote','requiresReference','accountId'] <> '{}'::jsonb
       OR coalesce(v_payment->>'id','') !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
       OR coalesce(v_payment->>'amount','') !~ '^(0|[1-9][0-9]{0,6})(\.[0-9]{1,12})?$'
       OR NOT coalesce(v_payment->>'method' IN ('cash','card'),false)
       OR EXISTS (SELECT 1 FROM jsonb_each(v_payment - ARRAY['id','method','amount','requiresReference']) AS detail(key,value)
         WHERE jsonb_typeof(value) <> 'string' OR char_length(value #>> '{}') > 500 OR value #>> '{}' ~ '[[:cntrl:]]')
       OR (v_payment ? 'requiresReference' AND jsonb_typeof(v_payment->'requiresReference') <> 'boolean')
       OR (v_payment->'requiresReference' = 'true'::jsonb AND nullif(btrim(v_payment->>'reference'),'') IS NULL) THEN
      RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='POS_TENDER_INVALID';
    END IF;
    v_tender := jsonb_populate_record(NULL::public.payment_transactions, v_entry);
    v_payment_id := (v_payment->>'id')::uuid;
    v_amount := (v_payment->>'amount')::numeric;
    v_reference := btrim(coalesce(v_payment->>'reference', v_payment->>'ref', ''));
    IF v_tender.id IS NULL OR v_tender.id = ANY(v_ids) OR v_payment_id = ANY(v_payment_ids)
       OR v_amount <= 0 OR v_amount <> trunc(v_amount,2) OR v_tender.amount IS DISTINCT FROM v_amount
       OR v_tender.method IS DISTINCT FROM v_payment->>'method'
       OR ROW(v_tender.sale_id,v_tender.store_id,v_tender.shift_id,v_tender.terminal_id)
          IS DISTINCT FROM ROW(p_sale.id,p_sale.store_id,p_sale.shift_id,p_terminal::text)
       OR v_tender.source_type IS DISTINCT FROM 'sale' OR v_tender.kind IS DISTINCT FROM 'payment'
       OR v_tender.status IS DISTINCT FROM 'completed' OR v_tender.note IS DISTINCT FROM ''
       OR v_tender.row_version IS DISTINCT FROM 1 OR v_tender.paid_at IS NULL OR v_tender.created_at IS NULL OR v_tender.updated_at IS NULL
       OR v_tender.client_transaction_id IS DISTINCT FROM p_sale.client_transaction_id || ':pay:' || v_position::text
       OR v_tender.reference IS DISTINCT FROM coalesce(nullif(v_reference,''),p_sale.bill_number)
       OR char_length(v_tender.reference) > 500 OR v_tender.reference ~ '[[:cntrl:]]'
       OR char_length(v_tender.cashier_name) > 500 OR v_tender.cashier_name ~ '[[:cntrl:]]'
       OR jsonb_typeof(v_tender.metadata) IS DISTINCT FROM 'object'
       OR v_tender.metadata - ARRAY['bill','voucher_reference','reference_note','bank','captured_at','captured_by'] <> '{}'::jsonb
       OR EXISTS (SELECT 1 FROM jsonb_each(v_tender.metadata) AS detail(key,value)
         WHERE jsonb_typeof(value) <> 'string' OR char_length(value #>> '{}') > 500 OR value #>> '{}' ~ '[[:cntrl:]]')
       OR v_tender.metadata->>'bill' IS DISTINCT FROM p_sale.bill_number
       OR coalesce(v_tender.metadata->>'voucher_reference','') <> v_reference
       OR coalesce(v_tender.metadata->>'reference_note','') <> btrim(coalesce(v_payment->>'referenceNote',''))
       OR coalesce(v_tender.metadata->>'bank','') <> btrim(coalesce(v_payment->>'bankName','')) THEN
      RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='POS_TENDER_INVALID';
    END IF;
    v_ids := array_append(v_ids,v_tender.id);
    v_payment_ids := array_append(v_payment_ids,v_payment_id);
    v_total := v_total + v_amount;
    v_has_card := v_has_card OR v_tender.method = 'card';
    IF v_amount > v_biggest THEN
      v_biggest := v_amount;
      v_headline := v_tender.method;
    END IF;
  END LOOP;
  IF NOT v_has_card OR v_headline IS DISTINCT FROM p_sale.payment_type
     OR v_total IS DISTINCT FROM p_sale.paid_amount OR v_total IS DISTINCT FROM p_sale.total_amount THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='POS_TENDER_INVALID';
  END IF;
END;
$tenders$;

REVOKE ALL ON FUNCTION pos_sync_cash_v1.assert_extended_tenders(public.sales,jsonb,uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION pos_sync_cash_v1.project_receipt(p_branch text, p_evidence jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $receipt$
DECLARE
  v_changes jsonb;
  v_extra jsonb;
  v_extended boolean := jsonb_array_length(p_evidence) = 5;
  v_payment_fields constant text[] := ARRAY['id','source_type','sale_id','store_id','shift_id','terminal_id',
    'amount','method','kind','note','paid_at','created_at','updated_at','row_version','status','metadata'];
  v_extension_fields constant text[] := ARRAY['client_transaction_id','reference','cashier_name'];
BEGIN
  IF jsonb_typeof(p_evidence) IS DISTINCT FROM 'array' OR jsonb_array_length(p_evidence) NOT IN (4,5)
     OR p_evidence->0->>'type' IS DISTINCT FROM 'cash_sale'
     OR p_evidence->1->>'type' IS DISTINCT FROM 'sale_item'
     OR p_evidence->2->>'type' IS DISTINCT FROM 'cash_tender'
     OR p_evidence->3->>'type' IS DISTINCT FROM 'stock_delta'
     OR (v_extended AND (p_evidence->4->>'type' IS DISTINCT FROM 'card_or_split'
       OR jsonb_typeof(p_evidence->4->'ids') IS DISTINCT FROM 'array'
       OR jsonb_array_length(p_evidence->4->'ids') NOT BETWEEN 1 AND 16
       OR p_evidence->4->'ids'->>0 IS DISTINCT FROM p_evidence->2->'row'->>'id')) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'POS_CASH_V1_RECEIPT_EVIDENCE_INVALID';
  END IF;

  SELECT jsonb_build_array(
    pos_sync_cash_v1.receipt_row('sales', to_jsonb(sale) ||
      CASE WHEN v_extended THEN '{}'::jsonb ELSE jsonb_build_object('payments', jsonb_build_array(
        jsonb_build_object('id', tender.id, 'method', 'cash', 'amount', tender.amount::text))) END,
      ARRAY['id','bill_number','client_transaction_id','store_id','branch_id','shift_id','subtotal_amount','total_amount',
        'discount_amount','tax_amount','payment_type','payments','points_earned','points_redeemed','is_exchange','is_refunded',
        'created_at','paid_amount','change_amount','exchange_credit','coupon_discount','rounding_adjustment','row_version'],
      ARRAY['subtotal_amount','total_amount','discount_amount','tax_amount','points_earned','points_redeemed','paid_amount',
        'change_amount','exchange_credit','coupon_discount','rounding_adjustment']),
    pos_sync_cash_v1.receipt_row('sale_items', to_jsonb(item),
      ARRAY['id','sale_id','branch_id','product_id','product_name','quantity','unit_price','discount_percent','discount_amount',
        'tax_rate','is_return','is_foc','created_at','coupon_discount','unit_cost','row_version','refunded_qty'],
      ARRAY['unit_price','discount_percent','discount_amount','tax_rate','coupon_discount','unit_cost']),
    pos_sync_cash_v1.receipt_row('payment_transactions', to_jsonb(tender),
      v_payment_fields || CASE WHEN v_extended THEN v_extension_fields ELSE ARRAY[]::text[] END, ARRAY['amount']),
    pos_sync_cash_v1.receipt_row('item_activity_logs', to_jsonb(movement),
      ARRAY['id','product_id','store_id','terminal_id','activity_type','reference','quantity_delta','unit_cost','note',
        'created_at','row_version'], ARRAY['unit_cost'])
  ) INTO v_changes
  FROM public.sales AS sale
  JOIN public.sale_items AS item ON item.sale_id = sale.id AND item.branch_id = p_branch
  JOIN public.payment_transactions AS tender ON tender.sale_id = sale.id AND tender.store_id = p_branch
  JOIN public.item_activity_logs AS movement ON movement.product_id = item.product_id AND movement.store_id = p_branch
    AND movement.terminal_id = tender.terminal_id AND movement.reference = sale.bill_number
  WHERE sale.store_id = p_branch AND sale.branch_id = p_branch
    AND sale.id::text = p_evidence->0->'row'->>'id' AND item.id::text = p_evidence->1->'row'->>'id'
    AND tender.id::text = p_evidence->2->'row'->>'id' AND movement.id::text = p_evidence->3->'row'->>'movement_id'
    AND sale.shift_id = tender.shift_id AND (v_extended OR
      (sale.payment_type = 'cash' AND tender.method = 'cash' AND tender.amount = sale.total_amount))
    AND movement.quantity_delta = -item.quantity;
  IF NOT FOUND OR v_changes @> '[null]'::jsonb THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'POS_CASH_V1_RECEIPT_PROJECTION_UNAVAILABLE';
  END IF;
  IF v_extended THEN
    SELECT coalesce(jsonb_agg(pos_sync_cash_v1.receipt_row('payment_transactions', to_jsonb(tender),
      v_payment_fields || v_extension_fields, ARRAY['amount']) ORDER BY wanted.ordinality),'[]'::jsonb)
    INTO v_extra
    FROM jsonb_array_elements_text(p_evidence->4->'ids') WITH ORDINALITY AS wanted(id,ordinality)
    JOIN public.payment_transactions AS tender ON tender.id=wanted.id::uuid
      AND tender.sale_id=(p_evidence->0->'row'->>'id')::uuid AND tender.store_id=p_branch
    WHERE wanted.ordinality > 1;
    IF jsonb_array_length(v_extra) <> jsonb_array_length(p_evidence->4->'ids')-1 OR v_extra @> '[null]'::jsonb THEN
      RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='POS_CASH_V1_RECEIPT_PROJECTION_UNAVAILABLE';
    END IF;
    v_changes := v_changes || v_extra;
  END IF;
  RETURN v_changes;
END;
$receipt$;

-- Source: scripts/preparation/pos-sync-cash-bridge-v1.sql

CREATE OR REPLACE FUNCTION pos_sync_cash_v1.apply_checkout(
  p_organization_id text, p_branch_id text, p_terminal_id uuid, p_binding_proof text,
  p_installation_generation uuid, p_database_guid uuid, p_operation_id uuid, p_epoch uuid,
  p_checkout_json text, p_checkout_sha256 text, p_verified_author jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $checkout$
DECLARE
  v_installation_generation uuid;
  v_checkout_utf8 bytea;
  v_checkout_sha256 text;
  v_checkout jsonb;
  v_sale public.sales%ROWTYPE;
  v_item public.sale_items%ROWTYPE;
  v_tender public.payment_transactions%ROWTYPE;
  v_tenders jsonb;
  v_extended boolean;
  v_movement public.item_activity_logs%ROWTYPE;
  v_shift public.shifts%ROWTYPE;
  v_product public.products%ROWTYPE;
  v_stock integer;
  v_managed_shift boolean;
  v_claim jsonb;
  v_ack jsonb;
  v_operations jsonb;
  v_changes jsonb;
  v_seq text;
  v_result jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' OR p_organization_id IS DISTINCT FROM 'default'
     OR p_terminal_id IS NULL OR p_binding_proof IS NULL OR p_binding_proof !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'POS_CASH_V1_SCOPE_FORBIDDEN';
  END IF;
  PERFORM public.pos_sync_validate_scope(p_organization_id, p_branch_id, p_terminal_id::text);
  PERFORM 1 FROM public.terminal_tokens AS token
  WHERE token.id = p_terminal_id AND token.location_id = p_branch_id AND token.platform = 'pc'
    AND token.status IN ('active', 'used') AND token.revoked_at IS NULL
    AND (token.is_claimed OR token.claimed_at IS NOT NULL)
    AND (token.claimed_platform IS NULL OR token.claimed_platform = 'electron')
    AND lower(coalesce(nullif(token.claim_proof, ''), token.claimed_proof_hash)) = p_binding_proof
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'POS_CASH_V1_SCOPE_FORBIDDEN';
  END IF;

  SELECT enrollment.installation_generation INTO v_installation_generation
  FROM pos_sync_cash_v1.installation_enrollments AS enrollment
  WHERE enrollment.organization_id = p_organization_id AND enrollment.terminal_id = p_terminal_id
    AND enrollment.branch_id = p_branch_id AND enrollment.installation_generation = p_installation_generation
    AND enrollment.database_guid = p_database_guid
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'POS_CASH_V1_INSTALLATION_FORBIDDEN';
  END IF;

  v_checkout_utf8 := convert_to(p_checkout_json, 'UTF8');
  IF p_operation_id IS NULL OR p_epoch IS NULL OR v_checkout_utf8 IS NULL
     OR octet_length(v_checkout_utf8) > 524288
     OR p_checkout_sha256 IS NULL OR p_checkout_sha256 !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'POS_CASH_V1_INVALID_CHECKOUT';
  END IF;
  v_checkout_sha256 := encode(sha256(v_checkout_utf8), 'hex');
  IF v_checkout_sha256 <> p_checkout_sha256 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'POS_CASH_V1_CHECKOUT_DIGEST_MISMATCH';
  END IF;
  BEGIN
    v_checkout := p_checkout_json::jsonb;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'POS_CASH_V1_INVALID_CHECKOUT';
  END;
  v_extended := v_checkout ? 'tenders';
  IF jsonb_typeof(v_checkout) IS DISTINCT FROM 'object' OR octet_length(v_checkout::text) > 524288
     OR v_checkout - ARRAY['sale', 'item', 'tender', 'tenders', 'movement'] <> '{}'::jsonb
     OR jsonb_typeof(v_checkout->'sale') IS DISTINCT FROM 'object'
     OR jsonb_typeof(v_checkout->'item') IS DISTINCT FROM 'object'
     OR (NOT v_extended AND jsonb_typeof(v_checkout->'tender') IS DISTINCT FROM 'object')
     OR (v_extended AND (v_checkout ? 'tender' OR jsonb_typeof(v_checkout->'tenders') IS DISTINCT FROM 'array'
       OR p_verified_author IS NULL))
     OR jsonb_typeof(v_checkout->'movement') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'POS_CASH_V1_INVALID_CHECKOUT';
  END IF;
  IF (v_checkout->'sale') - ARRAY['id', 'bill_number', 'client_transaction_id', 'store_id', 'branch_id', 'shift_id',
       'subtotal_amount', 'total_amount', 'discount_amount', 'tax_amount', 'payment_type', 'payments',
       'points_earned', 'points_redeemed', 'is_exchange', 'is_refunded', 'created_at', 'paid_amount',
       'change_amount', 'exchange_credit', 'coupon_discount', 'rounding_adjustment', 'row_version'] <> '{}'::jsonb
     OR (v_checkout->'item') - ARRAY['id', 'sale_id', 'branch_id', 'product_id', 'product_name', 'quantity', 'unit_price',
       'discount_percent', 'discount_amount', 'tax_rate', 'is_return', 'is_foc', 'created_at', 'coupon_discount',
       'unit_cost', 'row_version', 'refunded_qty'] <> '{}'::jsonb
     OR (NOT v_extended AND (v_checkout->'tender') - ARRAY['id', 'source_type', 'sale_id', 'store_id', 'shift_id', 'terminal_id', 'amount',
       'method', 'kind', 'note', 'paid_at', 'created_at', 'updated_at', 'row_version', 'status', 'metadata'] <> '{}'::jsonb)
     OR (v_checkout->'movement') - ARRAY['id', 'product_id', 'store_id', 'terminal_id', 'activity_type', 'reference',
       'quantity_delta', 'unit_cost', 'note', 'created_at', 'row_version'] <> '{}'::jsonb THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'POS_CASH_V1_INVALID_CHECKOUT';
  END IF;
  v_sale := jsonb_populate_record(NULL::public.sales, v_checkout->'sale');
  v_item := jsonb_populate_record(NULL::public.sale_items, v_checkout->'item');
  v_tenders := CASE WHEN v_extended THEN v_checkout->'tenders' ELSE jsonb_build_array(v_checkout->'tender') END;
  v_tender := jsonb_populate_record(NULL::public.payment_transactions, v_tenders->0);
  v_movement := jsonb_populate_record(NULL::public.item_activity_logs, v_checkout->'movement');

  IF v_sale.id IS NULL OR v_item.id IS NULL OR v_tender.id IS NULL OR v_movement.id IS NULL
     OR ROW(v_sale.row_version, v_item.row_version, v_tender.row_version, v_movement.row_version)
        IS DISTINCT FROM ROW(1, 1, 1, 1)
     OR nullif(v_sale.bill_number, '') IS NULL OR nullif(v_sale.client_transaction_id, '') IS NULL
     OR v_sale.shift_id IS NULL OR v_sale.created_at IS NULL
     OR v_sale.store_id IS DISTINCT FROM p_branch_id OR v_sale.branch_id IS DISTINCT FROM p_branch_id
     OR (NOT v_extended AND v_sale.payment_type IS DISTINCT FROM 'cash') OR v_sale.is_exchange IS DISTINCT FROM false
     OR v_sale.is_refunded IS DISTINCT FROM false
     OR ROW(v_sale.discount_amount, v_sale.tax_amount, v_sale.coupon_discount, v_sale.rounding_adjustment,
            v_sale.points_earned, v_sale.points_redeemed, v_sale.exchange_credit, v_sale.change_amount)
        IS DISTINCT FROM ROW(0::numeric, 0::numeric, 0::numeric, 0::numeric, 0::numeric, 0::numeric, 0::numeric, 0::numeric)
     OR v_sale.total_amount IS NULL OR v_sale.total_amount <= 0 OR v_sale.total_amount > 1000000
     OR v_sale.subtotal_amount IS DISTINCT FROM v_sale.total_amount OR v_sale.paid_amount IS DISTINCT FROM v_sale.total_amount
     OR jsonb_typeof(v_sale.payments) IS DISTINCT FROM 'array'
     OR jsonb_typeof(v_sale.payments->0) IS DISTINCT FROM 'object'
     OR (NOT v_extended AND (v_sale.payments->0->>'id' IS DISTINCT FROM v_tender.id::text
       OR v_sale.payments->0->>'method' IS DISTINCT FROM 'cash'
       OR (v_sale.payments->0->>'amount')::numeric IS DISTINCT FROM v_sale.total_amount
       OR v_sale.payments->1 IS NOT NULL))
     OR v_item.sale_id IS DISTINCT FROM v_sale.id OR v_item.branch_id IS DISTINCT FROM p_branch_id
     OR v_item.product_id IS NULL OR v_item.quantity IS NULL OR v_item.quantity <= 0
     OR v_item.is_return IS DISTINCT FROM false OR v_item.is_foc IS DISTINCT FROM false
     OR v_item.refunded_qty IS DISTINCT FROM 0 OR v_item.created_at IS NULL
     OR ROW(v_item.discount_percent, v_item.discount_amount, v_item.tax_rate, v_item.coupon_discount)
        IS DISTINCT FROM ROW(0::numeric, 0::numeric, 0::numeric, 0::numeric)
     OR (v_item.unit_price * v_item.quantity) IS DISTINCT FROM v_sale.total_amount
     OR v_tender.sale_id IS DISTINCT FROM v_sale.id OR v_tender.store_id IS DISTINCT FROM p_branch_id
     OR v_tender.shift_id IS DISTINCT FROM v_sale.shift_id OR v_tender.terminal_id IS DISTINCT FROM p_terminal_id::text
     OR v_tender.source_type IS DISTINCT FROM 'sale' OR (NOT v_extended AND v_tender.method IS DISTINCT FROM 'cash')
     OR v_tender.kind IS DISTINCT FROM 'payment' OR v_tender.status IS DISTINCT FROM 'completed'
     OR v_tender.note IS DISTINCT FROM '' OR (NOT v_extended AND v_tender.metadata IS DISTINCT FROM '{}'::jsonb)
     OR v_tender.paid_at IS NULL OR v_tender.created_at IS NULL
     OR (NOT v_extended AND v_tender.amount IS DISTINCT FROM v_sale.total_amount)
     OR v_movement.product_id IS DISTINCT FROM v_item.product_id OR v_movement.store_id IS DISTINCT FROM p_branch_id
     OR v_movement.terminal_id IS DISTINCT FROM p_terminal_id::text OR v_movement.activity_type IS DISTINCT FROM 'sale'
     OR v_movement.reference IS DISTINCT FROM v_sale.bill_number OR v_movement.created_at IS NULL
     OR v_movement.note IS DISTINCT FROM ''
     OR v_movement.quantity_delta IS DISTINCT FROM -v_item.quantity THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'POS_CASH_V1_INVALID_CHECKOUT';
  END IF;
  IF NOT v_extended AND (v_sale.payments->0) - ARRAY['id', 'method', 'amount'] <> '{}'::jsonb THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'POS_CASH_V1_INVALID_CHECKOUT';
  END IF;

  IF v_extended THEN
    PERFORM pos_sync_cash_v1.assert_extended_tenders(v_sale, v_tenders, p_terminal_id);
  END IF;

  v_claim := pos_sync_inbox_v1.claim_operation(p_organization_id, p_operation_id, v_installation_generation,
    jsonb_build_object('scope_id', p_branch_id, 'terminal_id', p_terminal_id, 'database_guid', p_database_guid,
      'epoch', p_epoch, 'checkout_sha256', v_checkout_sha256) ||
      CASE WHEN p_verified_author IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('author', p_verified_author) END);
  IF v_claim->>'status' <> 'PROCEED' THEN RETURN v_claim; END IF;
  IF v_extended THEN
    IF pos_sync_feed_v1.extended_scope_epoch(p_organization_id,p_branch_id) IS DISTINCT FROM p_epoch THEN
      RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='POS_TENDER_SCOPE_FORBIDDEN';
    END IF;
  END IF;

  PERFORM pos_sync_cash_v1.lock_checkout_routes();
  SELECT shift.* INTO v_shift FROM public.shifts AS shift WHERE shift.id = v_sale.shift_id::uuid FOR SHARE;
  IF NOT FOUND THEN
    -- A waiting receipt binds its epoch even though it will not append a group.
    PERFORM 1 FROM pos_sync_feed_v1.feed_heads AS head
    WHERE head.organization_id = p_organization_id AND head.scope_id = p_branch_id AND head.epoch = p_epoch
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'POS_FEED_V1_SCOPE_OR_EPOCH_MISMATCH';
    END IF;
    v_result := jsonb_build_object('reason', 'SHIFT_MISSING');
    PERFORM pos_sync_inbox_v1.record_disposition(p_organization_id, p_operation_id, 'WAITING_DEPENDENCY', v_result);
    RETURN jsonb_build_object('status', 'WAITING_DEPENDENCY', 'result', v_result);
  END IF;
  IF v_shift.store_id IS DISTINCT FROM p_branch_id OR v_shift.terminal_id IS DISTINCT FROM p_terminal_id::text
     OR v_shift.status IS DISTINCT FROM 'OPEN' OR v_shift.state IS DISTINCT FROM 'ACTIVE' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'POS_CASH_V1_SHIFT_FORBIDDEN';
  END IF;
  -- Protected financial streams retain their signed writer and cannot use
  -- this ordinary-cash pilot. A deployed guard still runs in the delegate.
  IF to_regclass('fin62_history_preparation.streams') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM fin62_history_preparation.streams WHERE shift_id = $1)'
      INTO v_managed_shift USING v_shift.id;
    IF v_managed_shift THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'POS_CASH_V1_PROTECTED_SHIFT';
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM public.sales AS sale WHERE sale.id = v_sale.id OR sale.bill_number = v_sale.bill_number
             OR sale.client_transaction_id = v_sale.client_transaction_id)
     OR EXISTS (SELECT 1 FROM public.sale_items AS item WHERE item.id = v_item.id)
     OR EXISTS (SELECT 1 FROM jsonb_to_recordset(v_tenders) AS incoming(id uuid,client_transaction_id text)
       JOIN public.payment_transactions AS tender ON tender.id=incoming.id OR
         (incoming.client_transaction_id IS NOT NULL AND tender.client_transaction_id=incoming.client_transaction_id))
     OR EXISTS (SELECT 1 FROM public.item_activity_logs AS movement WHERE movement.id = v_movement.id)
     OR EXISTS (SELECT 1 FROM public.stock_delta_applied AS delta WHERE delta.movement_id = v_movement.id)
     OR EXISTS (SELECT 1 FROM public.sync_idempotency_receipts AS receipt WHERE receipt.batch_id = p_operation_id) THEN
    v_result := jsonb_build_object('reason', 'LEGACY_OR_CONFLICTING_IDENTITY');
    PERFORM pos_sync_inbox_v1.record_disposition(p_organization_id, p_operation_id, 'REVIEW_REQUIRED', v_result);
    RETURN jsonb_build_object('status', 'REVIEW_REQUIRED', 'result', v_result);
  END IF;

  SELECT product.* INTO v_product FROM public.products AS product WHERE product.id = v_item.product_id FOR NO KEY UPDATE;
  IF NOT FOUND OR v_product.owner_store_id IS DISTINCT FROM p_branch_id OR v_product.is_archived IS DISTINCT FROM false
     OR v_product.name IS DISTINCT FROM v_item.product_name OR v_product.selling_price IS DISTINCT FROM v_item.unit_price
     OR v_product.cost_price IS DISTINCT FROM v_item.unit_cost OR v_product.cost_price IS DISTINCT FROM v_movement.unit_cost THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'POS_CASH_V1_PRODUCT_FORBIDDEN';
  END IF;
  v_stock := (v_product.stock_by_store->>p_branch_id)::integer;
  IF v_stock IS NULL OR v_stock < v_item.quantity THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'POS_CASH_V1_STOCK_UNAVAILABLE';
  END IF;

  -- Use the current native atomic writer. Inventory comes only from the
  -- stable movement and existing stock delta receipt, never a products row.
  v_operations := jsonb_build_array(
    jsonb_build_object('table', 'sales', 'rows', jsonb_build_array((v_checkout->'sale') ||
      CASE WHEN p_verified_author IS NULL THEN '{}'::jsonb
        ELSE jsonb_build_object('cashier_id', p_verified_author->>'subject') END), 'changes', '[]'::jsonb),
    jsonb_build_object('table', 'sale_items', 'rows', jsonb_build_array(v_checkout->'item'), 'changes', '[]'::jsonb),
    jsonb_build_object('table', 'payment_transactions', 'rows', v_tenders, 'changes', '[]'::jsonb),
    jsonb_build_object('table', 'item_activity_logs', 'rows', jsonb_build_array(v_checkout->'movement'), 'changes', '[]'::jsonb)
  );
  v_ack := public.pos_sync_push_aggregate(p_operation_id, p_organization_id, p_branch_id, p_terminal_id::text, v_operations);
  IF v_ack->>'ok' IS DISTINCT FROM 'true' OR v_ack->>'batch_id' IS DISTINCT FROM p_operation_id::text
     OR coalesce(v_ack->>'replayed', 'false') <> 'false' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'POS_CASH_V1_WRITER_UNCONFIRMED';
  END IF;

  -- This scoped evidence projection uses persisted ordinary checkout facts,
  -- with just the owning branch's balance and the cash tender amount.
  SELECT jsonb_build_array(
    jsonb_build_object('type', 'cash_sale', 'row', jsonb_build_object('id', sale.id, 'store_id', sale.store_id,
      'shift_id', sale.shift_id, 'bill_number', sale.bill_number, 'total_amount', sale.total_amount::text)),
    jsonb_build_object('type', 'sale_item', 'row', jsonb_build_object('id', item.id, 'sale_id', item.sale_id,
      'product_id', item.product_id, 'quantity', item.quantity, 'unit_price', item.unit_price::text)),
    jsonb_build_object('type', 'cash_tender', 'row', jsonb_build_object('id', tender.id, 'sale_id', tender.sale_id,
      'store_id', tender.store_id, 'method', tender.method, 'amount', tender.amount::text)),
    jsonb_build_object('type', 'stock_delta', 'row', jsonb_build_object('movement_id', delta.movement_id,
      'product_id', delta.product_id, 'store_id', delta.store_id, 'delta', delta.delta,
      'branch_balance', (product.stock_by_store->>p_branch_id)::integer))
  ) INTO v_changes
  FROM public.sales AS sale
  JOIN public.sale_items AS item ON item.sale_id = sale.id AND item.id = v_item.id AND item.branch_id = p_branch_id
  JOIN public.payment_transactions AS tender ON tender.sale_id = sale.id AND tender.id = v_tender.id AND tender.store_id = p_branch_id
  JOIN public.item_activity_logs AS movement ON movement.id = v_movement.id AND movement.store_id = p_branch_id
  JOIN public.stock_delta_applied AS delta ON delta.movement_id = movement.id AND delta.store_id = p_branch_id
  JOIN public.products AS product ON product.id = delta.product_id AND product.owner_store_id = p_branch_id
  WHERE sale.id = v_sale.id AND sale.store_id = p_branch_id AND sale.shift_id = v_sale.shift_id
    AND sale.bill_number = v_sale.bill_number AND sale.total_amount = v_sale.total_amount
    AND (p_verified_author IS NULL OR sale.cashier_id = p_verified_author->>'subject')
    AND item.product_id = v_item.product_id AND item.quantity = v_item.quantity AND item.unit_price = v_item.unit_price
    AND tender.method = v_tender.method AND tender.amount = v_tender.amount AND tender.terminal_id = p_terminal_id::text
    AND movement.product_id = v_item.product_id AND movement.quantity_delta = v_movement.quantity_delta
    AND delta.product_id = v_item.product_id AND delta.delta = v_movement.quantity_delta
    AND (product.stock_by_store->>p_branch_id)::integer = v_stock + delta.delta;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'POS_CASH_V1_WRITER_UNCONFIRMED';
  END IF;

  IF v_extended THEN
    IF EXISTS (
      SELECT 1 FROM jsonb_populate_recordset(NULL::public.payment_transactions,v_tenders) AS incoming
      LEFT JOIN public.payment_transactions AS saved ON saved.id=incoming.id
      WHERE ROW(saved.source_type,saved.sale_id,saved.store_id,saved.shift_id,saved.terminal_id,saved.method,
          saved.kind,saved.status,saved.amount,saved.reference,saved.metadata,saved.client_transaction_id,saved.cashier_name)
        IS DISTINCT FROM ROW(incoming.source_type,incoming.sale_id,incoming.store_id,incoming.shift_id,incoming.terminal_id,
          incoming.method,incoming.kind,incoming.status,incoming.amount,incoming.reference,incoming.metadata,
          incoming.client_transaction_id,incoming.cashier_name)
    ) OR NOT EXISTS (SELECT 1 FROM public.sales WHERE id=v_sale.id AND payments=v_sale.payments AND payment_type=v_sale.payment_type)
    THEN RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='POS_CASH_V1_WRITER_UNCONFIRMED'; END IF;
    v_changes := v_changes || jsonb_build_array(jsonb_build_object('type','card_or_split','ids',
      (SELECT jsonb_agg(entry->'id' ORDER BY position)
       FROM jsonb_array_elements(v_tenders) WITH ORDINALITY AS tender(entry,position))));
  END IF;
  IF p_verified_author IS NOT NULL THEN
    v_changes := pos_sync_cash_v1.project_receipt(p_branch_id, v_changes);
  END IF;

  SELECT appended.seq INTO STRICT v_seq FROM pos_sync_feed_v1.append_groups(p_organization_id,
    jsonb_build_array(jsonb_build_object('scope_id', p_branch_id, 'epoch', p_epoch,
      'operation_id', p_operation_id, 'changes', v_changes))) AS appended;
  INSERT INTO pos_sync_cash_v1.checkout_route_owners (entity, identity, operation_id)
  SELECT entity, identity, p_operation_id FROM pos_sync_cash_v1.checkout_route_keys(v_operations)
  UNION ALL SELECT 'stock_delta_applied', v_movement.id::text, p_operation_id;
  v_result := jsonb_build_object('sale_id', v_sale.id, 'scope_id', p_branch_id, 'epoch', p_epoch, 'seq', v_seq,
    'operation_id', p_operation_id, 'terminal_id', p_terminal_id, 'installation_generation', v_installation_generation,
    'database_guid', p_database_guid, 'checkout_sha256', v_checkout_sha256);
  IF p_verified_author IS NOT NULL THEN
    v_result := v_result || jsonb_build_object('author_id', p_verified_author->>'author_id',
      'author_key_id', p_verified_author->>'author_key_id');
  END IF;
  PERFORM pos_sync_inbox_v1.record_disposition(p_organization_id, p_operation_id, 'APPLIED', v_result);
  RETURN jsonb_build_object('status', 'APPLIED', 'result', v_result);
END;
$checkout$;

-- Source: scripts/preparation/pos-sync-cash-settings-gateway-v1.sql

ALTER TABLE pos_sync_feed_v1.cash_publications ADD CONSTRAINT cash_publications_tender_changes_check
  CHECK (jsonb_typeof(changes) = 'array' AND jsonb_array_length(changes) BETWEEN 4 AND 19) NOT VALID;
ALTER TABLE pos_sync_feed_v1.cash_publications VALIDATE CONSTRAINT cash_publications_tender_changes_check;
ALTER TABLE pos_sync_feed_v1.cash_publications DROP CONSTRAINT cash_publications_changes_check;

CREATE OR REPLACE FUNCTION pos_sync_feed_v1.record_cash_publication(
  p_org text, p_branch text, p_epoch uuid, p_seq bigint, p_operation uuid,
  p_terminal uuid, p_generation uuid, p_database uuid, p_hash text
)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
AS $record$
DECLARE
  v_changes jsonb;
BEGIN
  IF p_terminal IS NULL OR p_generation IS NULL OR p_database IS NULL OR p_operation IS NULL
     OR p_hash IS NULL OR p_hash !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'POS_CASH_SETTINGS_V1_INVALID_ACCEPTANCE';
  END IF;
  SELECT feed.changes INTO v_changes FROM pos_sync_feed_v1.feed_groups AS feed
  JOIN pos_sync_feed_v1.cash_settings_pilots AS pilot USING (organization_id, scope_id, epoch)
  WHERE (feed.organization_id, feed.scope_id, feed.epoch, feed.seq, feed.operation_id) =
    (p_org, p_branch, p_epoch, p_seq, p_operation) AND feed.seq > pilot.armed_after
  FOR NO KEY UPDATE OF feed;
  IF NOT FOUND OR jsonb_array_length(v_changes) NOT BETWEEN 4 AND 19
     OR v_changes->0->>'table_name' IS DISTINCT FROM 'sales'
     OR v_changes->1->>'table_name' IS DISTINCT FROM 'sale_items'
     OR v_changes->2->>'table_name' IS DISTINCT FROM 'payment_transactions'
     OR v_changes->3->>'table_name' IS DISTINCT FROM 'item_activity_logs'
     OR v_changes->0->'row_data'->>'store_id' IS DISTINCT FROM p_branch
     OR v_changes->0->'row_data'->>'branch_id' IS DISTINCT FROM p_branch
     OR v_changes->1->'row_data'->>'branch_id' IS DISTINCT FROM p_branch
     OR v_changes->2->'row_data'->>'store_id' IS DISTINCT FROM p_branch
     OR v_changes->3->'row_data'->>'store_id' IS DISTINCT FROM p_branch
     OR v_changes->2->'row_data'->>'terminal_id' IS DISTINCT FROM p_terminal::text
     OR v_changes->3->'row_data'->>'terminal_id' IS DISTINCT FROM p_terminal::text
     OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(v_changes) WITH ORDINALITY AS entry(change,ordinality)
       WHERE ordinality > 4 AND (change->>'table_name' IS DISTINCT FROM 'payment_transactions'
         OR change->'row_data'->>'store_id' IS DISTINCT FROM p_branch
         OR change->'row_data'->>'sale_id' IS DISTINCT FROM v_changes->0->'row_data'->>'id'
         OR change->'row_data'->>'terminal_id' IS DISTINCT FROM p_terminal::text)
     ) THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'POS_CASH_SETTINGS_V1_PUBLICATION_UNVERIFIED';
  END IF;
  INSERT INTO pos_sync_feed_v1.cash_publications VALUES (
    p_org, p_branch, p_epoch, p_seq, p_operation, v_changes,
    jsonb_build_object('terminal_id', p_terminal, 'installation_generation', p_generation,
      'database_guid', p_database, 'checkout_sha256', p_hash));
END;
$record$;

-- Source: scripts/preparation/pos-booking-handover-v1.sql
-- Apply after the scoped booking RPCs and the terminal-bound aggregate writer.
-- Both existing sale paths retain their scope, financial and checkout guards.


CREATE OR REPLACE FUNCTION public.booking_handover(
  _booking_id uuid, _amount numeric, _sale jsonb, _items jsonb,
  _payments jsonb, _movements jsonb, _member jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
AS $handover$
DECLARE
  booking public.bookings%ROWTYPE;
  receipt public.sales%ROWTYPE;
  payment public.booking_payments%ROWTYPE;
  settled record;
  sale_id uuid := nullif(_sale->>'id', '')::uuid;
  attempt text := nullif(_sale->>'client_transaction_id', '');
  method text := nullif(_sale->>'payment_type', '');
  replayed boolean;
BEGIN
  IF (SELECT auth.uid()) IS NULL OR public.is_staff_now() IS NOT TRUE OR
      public.has_perm('can_collect_booking') IS NOT TRUE THEN
    RAISE EXCEPTION 'PERMISSION_DENIED_COLLECT_BOOKING' USING ERRCODE = '42501';
  END IF;
  IF public.has_perm('can_process_sale') IS NOT TRUE THEN
    RAISE EXCEPTION 'PERMISSION_DENIED_SALE' USING ERRCODE = '42501';
  END IF;
  IF sale_id IS NULL OR attempt IS DISTINCT FROM sale_id::text OR method IS NULL OR
      nullif(_sale->>'bill_number', '') IS NULL OR _amount IS NULL OR
      _amount::text IN ('NaN', 'Infinity', '-Infinity') OR _amount < 0 OR
      coalesce((_sale->>'is_exchange')::boolean, false) OR coalesce((_sale->>'is_refunded')::boolean, false) OR
      nullif(_sale->>'original_bill_number', '') IS NOT NULL THEN
    RAISE EXCEPTION 'BOOKING_HANDOVER_INVALID' USING ERRCODE = '22023';
  END IF;

  SELECT b.* INTO booking FROM public.bookings b
   WHERE b.id = _booking_id AND b.store_id = _sale->>'store_id'
     AND public.store_visible(b.store_id) AND public.user_has_store_access(b.store_id)
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BOOKING_NOT_FOUND'; END IF;
  IF booking.status = 'cancelled' THEN RAISE EXCEPTION 'BOOKING_CANCELLED'; END IF;
  replayed := booking.status = 'collected';

  IF replayed THEN
    SELECT s.* INTO receipt FROM public.sales s WHERE s.id = sale_id AND s.client_transaction_id = attempt
      AND s.store_id = booking.store_id AND s.bill_number = booking.sale_receipt_no;
    IF NOT FOUND THEN RAISE EXCEPTION 'BOOKING_ALREADY_COLLECTED'; END IF;
  ELSE
    IF booking.status IS DISTINCT FROM 'active' OR booking.sale_receipt_no IS NOT NULL OR
        round((_sale->>'total_amount')::numeric, 2) IS DISTINCT FROM round(booking.total, 2) OR
        round((_sale->>'paid_amount')::numeric, 2) IS DISTINCT FROM round(booking.total, 2) OR
        nullif(_sale->>'member_id', '')::uuid IS DISTINCT FROM booking.member_id OR
        (_member IS NOT NULL AND nullif(_member->>'id', '')::uuid IS DISTINCT FROM booking.member_id) THEN
      RAISE EXCEPTION 'BOOKING_CHANGED';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended('pos-booking-sale:' || sale_id::text, 0));
    IF EXISTS (SELECT 1 FROM public.sales s WHERE s.id = sale_id OR s.client_transaction_id = attempt) THEN
      RAISE EXCEPTION 'BOOKING_CHANGED';
    END IF;
    SELECT * INTO STRICT settled FROM public.booking_collect(
      booking.id, round(_amount, 2), method, _sale->>'cashier_name', NULL, attempt, true
    );
    IF settled.duplicate THEN RAISE EXCEPTION 'BOOKING_CHANGED'; END IF;
    IF NOT settled.fully_paid OR settled.status IS DISTINCT FROM 'collected' THEN
      RAISE EXCEPTION 'BOOKING_BALANCE_DUE';
    END IF;
    PERFORM public.pos_sale_commit(
      _sale || jsonb_build_object('change_amount', settled.change_due), _items, _payments, _movements, _member, NULL
    );
    SELECT s.* INTO STRICT receipt FROM public.sales s WHERE s.id = sale_id AND s.client_transaction_id = attempt
      AND s.store_id = booking.store_id AND s.bill_number = _sale->>'bill_number';
    UPDATE public.bookings b SET sale_receipt_no = receipt.bill_number
      WHERE b.id = booking.id AND b.store_id = booking.store_id AND b.status = 'collected'
      RETURNING b.* INTO STRICT booking;
  END IF;

  SELECT p.* INTO payment FROM public.booking_payments p
    WHERE p.booking_id = booking.id AND p.client_payment_id = attempt AND p.status = 'settled' AND p.kind = 'payment';
  RETURN jsonb_build_object(
    'sale_id', receipt.id, 'sale_receipt_no', receipt.bill_number, 'sale_created_at', receipt.created_at,
    'closed_at', booking.closed_at, 'paid', booking.paid, 'change', receipt.change_amount, 'replayed', replayed,
    'payment', CASE WHEN payment.id IS NOT NULL THEN to_jsonb(payment) ELSE NULL END,
    'sale', CASE WHEN replayed THEN to_jsonb(receipt) || jsonb_build_object('sale_items',
      (SELECT coalesce(jsonb_agg(to_jsonb(i) ORDER BY i.id), '[]'::jsonb) FROM public.sale_items i WHERE i.sale_id = receipt.id))
      ELSE NULL END
  );
END;
$handover$;

REVOKE ALL ON FUNCTION public.booking_handover(uuid,numeric,jsonb,jsonb,jsonb,jsonb,jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.booking_handover(uuid,numeric,jsonb,jsonb,jsonb,jsonb,jsonb) TO authenticated;

-- The normal native event stream already sends the complete local transaction.
-- Its dependency order puts bookings before payments, which is right for
-- creation and wrong for collecting an existing booking with one last tender.
CREATE OR REPLACE FUNCTION private.check_booking_handover_upload(
  p_branch text, p_operations jsonb, p_after boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
AS $upload$
DECLARE
  handover record;
  booking public.bookings%ROWTYPE;
  payment public.booking_payments%ROWTYPE;
  sale public.sales%ROWTYPE;
  payment_json jsonb;
  booking_order bigint;
  total numeric;
  tender numeric;
  paid numeric;
  version integer;
BEGIN
  WITH rows AS (
    SELECT op.value->>'table' AS name, op.ordinality, r.value
    FROM jsonb_array_elements(p_operations) WITH ORDINALITY op
    CROSS JOIN LATERAL jsonb_array_elements(coalesce(op.value->'rows','[]'::jsonb)) r
    WHERE op.value->>'table' IN ('bookings','sales')
  )
  SELECT b.value AS booking_row, s.value AS sale_row, b.ordinality AS booking_order INTO handover
  FROM rows b JOIN rows s ON s.name = 'sales' AND s.value->>'bill_number' = b.value->>'sale_receipt_no'
  WHERE b.name = 'bookings' AND b.value->>'status' = 'collected';
  IF NOT FOUND THEN RETURN p_operations; END IF;

  IF (SELECT count(*) FROM jsonb_array_elements(p_operations) op
      WHERE op->>'table' = 'bookings') <> 1 OR
     (SELECT count(*) FROM jsonb_array_elements(p_operations) op
      WHERE op->>'table' = 'sales') <> 1 OR
     jsonb_array_length(p_operations->(handover.booking_order::integer-1)->'rows') <> 1 OR
     NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_operations) op
       WHERE op->>'table' = 'sales' AND jsonb_array_length(op->'rows') = 1) OR
     (SELECT count(*) FROM jsonb_array_elements(p_operations) op
      WHERE op->>'table' = 'booking_payments') > 1 OR
     EXISTS (SELECT 1 FROM jsonb_array_elements(p_operations) op
       WHERE op->>'table' = 'booking_payments' AND
       (jsonb_array_length(op->'rows') <> 1 OR coalesce((op->>'deletePhase')::boolean,false))) OR
     handover.booking_row->>'store_id' IS DISTINCT FROM p_branch OR
     handover.sale_row->>'store_id' IS DISTINCT FROM p_branch OR
     handover.sale_row->>'id' IS DISTINCT FROM handover.sale_row->>'client_transaction_id' OR
     coalesce((handover.sale_row->>'is_refunded')::boolean, false) OR
     coalesce((handover.sale_row->>'is_exchange')::boolean, false) THEN
    RAISE EXCEPTION 'BOOKING_HANDOVER_UPLOAD_INVALID';
  END IF;

  SELECT op->'rows'->0 INTO payment_json FROM jsonb_array_elements(p_operations) op
    WHERE op->>'table' = 'booking_payments';
  IF payment_json IS NOT NULL AND (payment_json->>'booking_id' IS DISTINCT FROM handover.booking_row->>'id' OR
      payment_json->>'client_payment_id' IS DISTINCT FROM handover.sale_row->>'client_transaction_id' OR
      payment_json->>'method' IS DISTINCT FROM handover.sale_row->>'payment_type' OR
      payment_json->>'status' IS DISTINCT FROM 'settled' OR payment_json->>'kind' IS DISTINCT FROM 'payment' OR
      NOT coalesce((payment_json->>'amount')::numeric > 0, false)) THEN
    RAISE EXCEPTION 'BOOKING_HANDOVER_UPLOAD_INVALID';
  END IF;

  SELECT b.* INTO booking FROM public.bookings b
    WHERE b.id = (handover.booking_row->>'id')::uuid AND b.store_id = p_branch FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BOOKING_HANDOVER_UPLOAD_BOOKING_MISSING'; END IF;
  total := round(booking.total, 2);
  tender := coalesce(round((payment_json->>'amount')::numeric, 2), 0);
  paid := public.booking_net_paid(booking.id);
  version := (handover.booking_row->>'row_version')::integer;
  IF version IS NULL OR total IS NULL OR
     round((handover.booking_row->>'total')::numeric, 2) IS DISTINCT FROM total OR
     round((handover.booking_row->>'paid')::numeric, 2) IS DISTINCT FROM total OR
     round((handover.sale_row->>'total_amount')::numeric, 2) IS DISTINCT FROM total OR
     round((handover.sale_row->>'paid_amount')::numeric, 2) IS DISTINCT FROM total OR
     nullif(handover.sale_row->>'member_id', '')::uuid IS DISTINCT FROM booking.member_id THEN
    RAISE EXCEPTION 'BOOKING_HANDOVER_UPLOAD_CONFLICT';
  END IF;

  IF p_after THEN
    SELECT s.* INTO sale FROM public.sales s WHERE s.id = (handover.sale_row->>'id')::uuid
      AND s.store_id = p_branch AND s.client_transaction_id = handover.sale_row->>'client_transaction_id'
      AND s.bill_number = handover.booking_row->>'sale_receipt_no';
    IF NOT FOUND OR booking.status IS DISTINCT FROM 'collected' OR
       booking.sale_receipt_no IS DISTINCT FROM sale.bill_number OR booking.row_version IS DISTINCT FROM version OR
       round(booking.paid, 2) IS DISTINCT FROM total OR paid IS DISTINCT FROM total THEN
      RAISE EXCEPTION 'BOOKING_HANDOVER_UPLOAD_UNCONFIRMED';
    END IF;
    IF payment_json IS NOT NULL THEN
      SELECT p.* INTO payment FROM public.booking_payments p WHERE p.id = (payment_json->>'id')::uuid
        AND p.booking_id = booking.id AND p.client_payment_id = sale.client_transaction_id;
      IF NOT FOUND OR round(payment.amount, 2) IS DISTINCT FROM tender OR
        payment.status IS DISTINCT FROM 'settled' OR payment.kind IS DISTINCT FROM 'payment' THEN
        RAISE EXCEPTION 'BOOKING_HANDOVER_UPLOAD_UNCONFIRMED';
      END IF;
    END IF;
    RETURN p_operations;
  END IF;

  IF booking.status IS DISTINCT FROM 'active' OR booking.sale_receipt_no IS NOT NULL OR
     booking.row_version IS DISTINCT FROM version-1 OR paid + tender IS DISTINCT FROM total OR
     EXISTS (SELECT 1 FROM public.sales s WHERE s.id = (handover.sale_row->>'id')::uuid
       OR s.client_transaction_id = handover.sale_row->>'client_transaction_id') OR
     (payment_json IS NOT NULL AND EXISTS (SELECT 1 FROM public.booking_payments p
       WHERE p.id = (payment_json->>'id')::uuid OR
         (p.booking_id = booking.id AND p.client_payment_id = payment_json->>'client_payment_id'))) THEN
    RAISE EXCEPTION 'BOOKING_HANDOVER_UPLOAD_CONFLICT';
  END IF;
  IF payment_json IS NULL THEN RETURN p_operations; END IF;

  booking_order := handover.booking_order;
  RETURN (SELECT jsonb_agg(op.value ORDER BY
    CASE WHEN op.value->>'table' = 'booking_payments' THEN booking_order ELSE op.ordinality END,
    CASE WHEN op.value->>'table' = 'booking_payments' THEN 0 ELSE 1 END)
    FROM jsonb_array_elements(p_operations) WITH ORDINALITY op);
END;
$upload$;

REVOKE ALL ON FUNCTION private.check_booking_handover_upload(text,jsonb,boolean) FROM PUBLIC, anon, authenticated, service_role;

-- Keep the current route (including the cash owner and FIN62 checks), OID,
-- existing hash and duplicate semantics. Change only the new-write loop.
DO $install_handover_upload$
DECLARE
  target regprocedure := to_regprocedure('public.pos_sync_push_aggregate(uuid,text,text,text,jsonb)');
  definition text;
  begin_rows constant text := 'FOR v_op IN SELECT value FROM jsonb_array_elements(p_operations) LOOP';
  before_receipt constant text := 'INSERT INTO public.sync_idempotency_receipts(batch_id,organization_id,branch_id,table_name,payload_hash,applied_count)';
BEGIN
  SELECT replace(pg_get_functiondef(proc.oid), E'\r\n', E'\n') INTO definition
    FROM pg_proc proc WHERE proc.oid = target AND proc.prosecdef AND pg_get_userbyid(proc.proowner) = current_user;
  IF definition IS NULL OR has_function_privilege('anon', target, 'EXECUTE') OR
     has_function_privilege('authenticated', target, 'EXECUTE') OR
     NOT has_function_privilege('service_role', target, 'EXECUTE') OR
     strpos(definition, 'private.check_booking_handover_upload') <> 0 OR
     length(definition)-length(replace(definition,begin_rows,'')) <> length(begin_rows) OR
     length(definition)-length(replace(definition,before_receipt,'')) <> length(before_receipt) OR
     strpos(definition, 'pos_sync_validate_scope') = 0 OR
     strpos(definition, 'SYNC_IDEMPOTENCY_MISMATCH') = 0 OR
     strpos(definition, 'SYNC_IDEMPOTENCY_MISMATCH') > strpos(definition, begin_rows) OR
     strpos(definition, begin_rows) > strpos(definition, before_receipt) THEN
    RAISE EXCEPTION 'POS_BOOKING_HANDOVER_WRITER_SOURCE_UNEXPECTED';
  END IF;
  definition := replace(definition, begin_rows,
    'p_operations := private.check_booking_handover_upload(p_branch_id,p_operations,false);' || E'\n ' || begin_rows);
  EXECUTE replace(definition, before_receipt,
    'PERFORM private.check_booking_handover_upload(p_branch_id,p_operations,true);' || E'\n ' || before_receipt);
END;
$install_handover_upload$;

NOTIFY pgrst, 'reload schema';

-- Source: scripts/preparation/pos-sync-transfer-receipt-feed-v1.sql
-- Install after the grouped dispatch and native warehouse receipt modules.
-- Only the canonical writers know which destination movements they inserted.


CREATE OR REPLACE FUNCTION pos_sync_feed_v1.publish_transfer_receipt(p_transfer uuid,p_movements jsonb)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog SET timezone='UTC'
AS $publish$
DECLARE
  v_transfer public.stock_transfers;
  v_branch text;
  v_epoch uuid;
  v_lines jsonb;
  v_stock jsonb;
  v_logs jsonb;
  v_transfer_row jsonb;
  v_graph text;
  v_changes jsonb;
  v_metadata jsonb;
  v_operation uuid;
  v_seq bigint;
  v_row jsonb;
  v_header_fields constant text[]:=ARRAY['id','ref','kind','transfer_scope','from_store_id','from_store_name','from_group_id',
    'to_store_id','to_store_name','to_group_id','status','note','created_by','approved_by','approved_at','received_by',
    'received_at','rejected_reason','created_at','updated_at','row_version','verified_by','verified_at','posted_at',
    'discrepancy_reason','rejected_by','cancelled_reason','dispatched_by','dispatched_at','closed_at','fulfilment','source_request_id'];
  v_line_fields constant text[]:=ARRAY['id','transfer_id','product_id','barcode','sku','product_name','quantity','quantity_received',
    'unit_cost','created_at','row_version','quantity_approved','quantity_dispatched','quantity_verified'];
  v_log_fields constant text[]:=ARRAY['id','product_id','product_name','sku','barcode','store_id','terminal_id','activity_type','reference',
    'quantity_delta','stock_before','stock_after','unit_cost','staff_id','staff_name','role','note','created_at','row_version','item_id',
    'sale_id','transfer_id','quantity','created_by','notes'];
BEGIN
  SELECT * INTO STRICT v_transfer FROM public.stock_transfers WHERE id=p_transfer;
  IF v_transfer.kind<>'transfer' OR v_transfer.status NOT IN ('received','completed','completed_with_discrepancy')
    OR v_transfer.from_store_id=v_transfer.to_store_id OR v_transfer.received_at IS NULL
    OR length(v_transfer.from_store_id) NOT BETWEEN 1 AND 128 OR length(v_transfer.to_store_id) NOT BETWEEN 1 AND 128
    OR v_transfer.dispatched_at IS NULL OR v_transfer.dispatched_by IS NULL THEN RETURN; END IF;
  -- The deferred stock writer takes locks for these product owners as well.
  PERFORM head.scope_id FROM pos_sync_feed_v1.feed_heads AS head
  WHERE head.organization_id='default' AND head.scope_id IN (
    SELECT unnest(ARRAY[v_transfer.from_store_id,v_transfer.to_store_id])
    UNION SELECT product.owner_store_id FROM jsonb_array_elements(p_movements) AS movement
      JOIN public.item_activity_logs AS log ON log.id=(movement->>'log_id')::uuid
      JOIN public.products AS product ON product.id=log.product_id)
  ORDER BY head.scope_id FOR NO KEY UPDATE OF head;
  IF pos_sync_feed_v1.extended_scope_epoch('default',v_transfer.from_store_id) IS NULL AND
     pos_sync_feed_v1.extended_scope_epoch('default',v_transfer.to_store_id) IS NULL THEN RETURN; END IF;

  SELECT coalesce(jsonb_agg(pos_sync_feed_v1.correction_receipt_row(to_jsonb(line),v_line_fields,ARRAY['unit_cost'])
    ORDER BY line.id),'[]'::jsonb) INTO v_lines
  FROM (SELECT * FROM public.stock_transfer_items WHERE transfer_id=p_transfer ORDER BY id LIMIT 101) AS line;
  IF jsonb_array_length(v_lines) NOT BETWEEN 1 AND 100 OR v_lines @> '[null]'::jsonb OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_lines) AS line
    WHERE line->>'quantity_dispatched' IS NULL OR (line->>'quantity_dispatched')::integer < 0 OR
      (line->>'quantity_received')::integer NOT BETWEEN 0 AND (line->>'quantity_dispatched')::integer OR
      (line->>'quantity_dispatched')::integer>coalesce((line->>'quantity_approved')::integer,(line->>'quantity')::integer) OR
      (v_transfer.status='received' AND line->>'quantity_verified' IS NOT NULL) OR
      (v_transfer.status<>'received' AND line->>'quantity_verified' IS DISTINCT FROM line->>'quantity_received')
  ) THEN RETURN; END IF;
  SELECT coalesce(jsonb_agg(pos_sync_feed_v1.correction_receipt_row(to_jsonb(log),v_log_fields,ARRAY['unit_cost'])
    ORDER BY movement.ordinal),'[]'::jsonb) INTO v_logs
  FROM jsonb_array_elements(p_movements) WITH ORDINALITY AS movement(row,ordinal)
  JOIN public.item_activity_logs AS log ON log.id=(movement.row->>'log_id')::uuid
  JOIN public.stock_transfer_items AS line ON line.id=(movement.row->>'line_id')::uuid AND line.transfer_id=p_transfer
  WHERE log.store_id=v_transfer.to_store_id AND log.activity_type='transfer_in' AND log.reference=v_transfer.ref
    AND log.quantity_delta=line.quantity_verified AND log.quantity_delta>0 AND log.stock_after=log.stock_before+log.quantity_delta
    AND log.staff_name=coalesce(v_transfer.verified_by,'') AND log.created_at=v_transfer.posted_at
    AND (v_transfer.transfer_scope='INTER_GROUP' OR log.product_id=line.product_id);
  IF v_logs @> '[null]'::jsonb OR jsonb_array_length(v_logs)<>jsonb_array_length(p_movements) OR
    jsonb_array_length(v_logs)<>(SELECT count(*) FROM jsonb_array_elements(v_lines) AS line
      WHERE (line->>'quantity_verified')::integer>0) OR
    (v_transfer.status='received' AND (v_transfer.verified_at IS NOT NULL OR v_transfer.posted_at IS NOT NULL)) OR
    (v_transfer.status<>'received' AND (v_transfer.verified_at IS NULL OR v_transfer.posted_at IS DISTINCT FROM v_transfer.verified_at
      OR (v_transfer.status='completed_with_discrepancy') IS DISTINCT FROM EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_lines) AS line
        WHERE (line->>'quantity_verified')::integer<(line->>'quantity_dispatched')::integer))) THEN RETURN; END IF;

  v_transfer_row:=pos_sync_feed_v1.correction_receipt_row(to_jsonb(v_transfer),v_header_fields,ARRAY[]::text[]);
  IF v_transfer_row IS NULL THEN RETURN; END IF;
  v_metadata:=jsonb_build_object('financial',jsonb_build_object('kind','transfer_v1','transfer_id',p_transfer));
  FOR v_branch IN SELECT side.branch FROM (VALUES (v_transfer.from_store_id),(v_transfer.to_store_id)) AS side(branch)
    ORDER BY side.branch COLLATE "C"
  LOOP
    v_epoch:=pos_sync_feed_v1.extended_scope_epoch('default',v_branch);
    IF v_epoch IS NULL OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_lines) AS line
      WHERE line->>'product_id' IS NOT NULL AND NOT public.product_available_in_catalogue((line->>'product_id')::uuid,v_branch)
    ) OR (v_branch=v_transfer.to_store_id AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_logs) AS log
      WHERE NOT public.product_available_in_catalogue((log->>'product_id')::uuid,v_branch)
    )) THEN CONTINUE; END IF;
    v_stock:='[]'::jsonb;
    IF v_branch=v_transfer.to_store_id THEN
      -- Stock ownership and retirement remain on the existing projection.
      -- A shared product's other branch bucket still uses the legacy mirror.
      SELECT coalesce(jsonb_agg(pos_sync_feed_v1.live_stock_row(product.id,product.stock_by_store,v_branch,product.row_version)
        ORDER BY product.id),'[]'::jsonb) INTO v_stock
      FROM public.products AS product WHERE product.owner_store_id=v_branch
        AND product.id IN (SELECT (log->>'product_id')::uuid FROM jsonb_array_elements(v_logs) AS log);
      IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_stock) AS stock
        CROSS JOIN LATERAL (
          SELECT log.row FROM jsonb_array_elements(v_logs) WITH ORDINALITY AS log(row,ordinal)
          WHERE log.row->>'product_id'=stock->>'product_id' ORDER BY log.ordinal DESC LIMIT 1
        ) AS final
        WHERE final.row->'stock_after' IS DISTINCT FROM stock->'branch_balance'
      ) THEN CONTINUE; END IF;
    END IF;
    v_graph:=jsonb_build_object('branch_id',v_branch,'transfer',v_transfer_row,'request',NULL,'lines',v_lines,'stock',v_stock,
      'logs',CASE WHEN v_branch=v_transfer.to_store_id THEN v_logs ELSE '[]'::jsonb END,
      'movements',CASE WHEN v_branch=v_transfer.to_store_id THEN p_movements ELSE '[]'::jsonb END)::text;
    IF octet_length(v_graph)>196608 THEN CONTINUE; END IF;
    v_operation:=left(encode(sha256(convert_to(jsonb_build_array(
      'transfer-receipt-v1',v_branch,v_epoch,p_transfer,v_transfer.status)::text,'UTF8')),'hex'),32)::uuid;
    v_changes:=jsonb_build_array(pos_sync_feed_v1.financial_change('stock_transfers',jsonb_build_object('id',p_transfer),
        jsonb_build_object('id',p_transfer,'store_id',v_branch,'row_version',v_transfer.row_version,
        'graph_json',v_graph,'graph_sha256',encode(sha256(convert_to(v_graph,'UTF8')),'hex')),v_transfer.row_version));
    IF octet_length((v_changes||jsonb_build_array(v_metadata))::text)>262144 THEN CONTINUE; END IF;
    v_seq:=pos_sync_feed_v1.append_extended_group('default',v_branch,v_epoch,v_operation,v_changes,v_metadata);
    FOR v_row IN SELECT value FROM jsonb_array_elements(v_stock)
    LOOP
      PERFORM pos_sync_feed_v1.cover_stock_revision('default',v_branch,v_epoch,v_seq,(v_row->>'product_id')::uuid,
        (v_row->>'branch_balance')::integer,(v_row->>'row_version')::integer);
    END LOOP;
  END LOOP;
END;
$publish$;
REVOKE ALL ON FUNCTION pos_sync_feed_v1.publish_transfer_receipt(uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;

-- Adapt the two private implementations shared by the guarded web and native
-- entrypoints. Refuse unknown anchors so installation cannot replace a writer.
DO $install$
DECLARE
  v_definition text;
  v_anchor text;
  v_replacement text;
  v_stage text;
  v_signature text;
BEGIN
  FOR v_stage,v_signature IN VALUES ('receive','private.stock_transfer_receive(uuid,text,boolean,jsonb)'),
    ('verify','private.stock_transfer_verify(uuid,text,jsonb,text)')
  LOOP
    SELECT pg_get_functiondef(to_regprocedure(v_signature)) INTO v_definition;
    IF v_definition IS NULL THEN RAISE EXCEPTION 'Canonical warehouse writer is missing: %',v_stage; END IF;
    v_definition:=replace(v_definition,chr(13)||chr(10),chr(10));
    IF strpos(v_definition,'pos_sync_feed_v1.publish_transfer_receipt(t.id,')>0 THEN CONTINUE; END IF;
    IF v_stage='verify' THEN
      v_anchor:='  v_short boolean := false;';
      v_replacement:=v_anchor || E'\n  v_sync_log uuid;\n  v_sync_movements jsonb := ''[]''::jsonb;';
      IF length(v_definition)-length(replace(v_definition,v_anchor,''))<>length(v_anchor) THEN
        RAISE EXCEPTION 'Expected canonical verification declarations missing or ambiguous';
      END IF;
      v_definition:=replace(v_definition,v_anchor,v_replacement);
      v_anchor:='      FROM public.products p WHERE p.id = v_target;';
      v_replacement:=left(v_anchor,-1) || E' RETURNING id INTO v_sync_log;\n'
        || E'    v_sync_movements := v_sync_movements || jsonb_build_array(\n'
        || '      jsonb_build_object(''line_id'',it.id,''log_id'',v_sync_log));';
      IF length(v_definition)-length(replace(v_definition,v_anchor,''))<>length(v_anchor) THEN
        RAISE EXCEPTION 'Expected canonical verification movement insert missing or ambiguous';
      END IF;
      v_definition:=replace(v_definition,v_anchor,v_replacement);
    END IF;
    v_anchor:=E'   WHERE id = t.id;\nEND';
    v_replacement:=E'   WHERE id = t.id;\n  PERFORM pos_sync_feed_v1.publish_transfer_receipt(t.id,'
      || CASE WHEN v_stage='verify' THEN 'v_sync_movements' ELSE '''[]''::jsonb' END || E');\nEND';
    IF length(v_definition)-length(replace(v_definition,v_anchor,''))<>length(v_anchor) THEN
      RAISE EXCEPTION 'Expected canonical warehouse status update missing or ambiguous: %',v_stage;
    END IF;
    EXECUTE replace(v_definition,v_anchor,v_replacement);
  END LOOP;
END;
$install$;

DO $beta_upgrade_verify$
BEGIN
  IF (SELECT count(*) FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind IN ('r','p') AND relrowsecurity) <> 79 OR
     (SELECT count(*) FROM pg_class WHERE relnamespace='pos_sync_feed_v1'::regnamespace AND relkind IN ('r','p') AND relrowsecurity) <> 18 OR
     has_function_privilege('anon','public.booking_handover(uuid,numeric,jsonb,jsonb,jsonb,jsonb,jsonb)','execute') OR
     NOT has_function_privilege('authenticated','public.booking_handover(uuid,numeric,jsonb,jsonb,jsonb,jsonb,jsonb)','execute') OR
     has_function_privilege('service_role','public.booking_handover(uuid,numeric,jsonb,jsonb,jsonb,jsonb,jsonb)','execute') OR
     has_function_privilege('authenticated','pos_sync_feed_v1.publish_transfer_receipt(uuid,jsonb)','execute') OR
     has_function_privilege('service_role','pos_sync_feed_v1.publish_transfer_receipt(uuid,jsonb)','execute') OR
     has_function_privilege('authenticated','pos_sync_cash_v1.assert_extended_tenders(public.sales,jsonb,uuid)','execute') OR
     has_function_privilege('service_role','pos_sync_cash_v1.assert_extended_tenders(public.sales,jsonb,uuid)','execute') OR
     NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='pos_sync_feed_v1.cash_publications'::regclass
       AND conname='cash_publications_tender_changes_check' AND convalidated) THEN
    RAISE EXCEPTION 'RETAIL_POS_BETA_UPGRADE_VERIFICATION_FAILED';
  END IF;
END $beta_upgrade_verify$;
COMMIT;
$retail_ledger_source$]::text[]);
 SELECT catalogue.fingerprint INTO current_fingerprint FROM (SELECT jsonb_build_object('project_ref','irjkmhgrjgcaoixcixut','database_name',current_database(),'database_role',current_user,'system_identifier',(SELECT system_identifier::text FROM pg_catalog.pg_control_system()),'rls_tables',(SELECT jsonb_object_agg(schema_name,total) FROM (SELECT n.nspname schema_name,count(c.oid) total FROM pg_catalog.pg_namespace n LEFT JOIN pg_catalog.pg_class c ON c.relnamespace=n.oid AND c.relkind IN ('r','p') AND c.relrowsecurity WHERE n.nspname IN ('public','pos_sync_feed_v1') GROUP BY n.nspname) x),'functions',(SELECT jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'md5',md5(replace(pg_get_functiondef(p.oid),chr(13)||chr(10),chr(10))),'owner',pg_get_userbyid(p.proowner),'definer',p.prosecdef,'config',p.proconfig,'anon',has_function_privilege('anon',p.oid,'EXECUTE'),'authenticated',has_function_privilege('authenticated',p.oid,'EXECUTE'),'service_role',has_function_privilege('service_role',p.oid,'EXECUTE')) ORDER BY p.oid::regprocedure::text) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE (n.nspname='public' AND p.proname IN ('booking_handover','reserve_product_skus','received_product_catalogue_stores','pos_sync_push_aggregate')) OR (n.nspname='pos_sync_cash_v1' AND p.proname IN ('assert_extended_tenders','apply_checkout','project_receipt')) OR (n.nspname='pos_sync_feed_v1' AND p.proname IN ('publish_transfer_receipt','record_cash_publication')) OR (n.nspname='private' AND p.proname IN ('check_booking_handover_upload','stock_transfer_receive','stock_transfer_verify'))),'constraints',(SELECT jsonb_agg(jsonb_build_object('name',conname,'definition',pg_get_constraintdef(oid),'validated',convalidated) ORDER BY conname) FROM pg_catalog.pg_constraint WHERE conrelid=to_regclass('pos_sync_feed_v1.cash_publications')),'migrations',(SELECT jsonb_agg(jsonb_build_object('version',version,'name',name) ORDER BY version) FROM supabase_migrations.schema_migrations)) AS fingerprint) catalogue;
 IF current_fingerprint IS DISTINCT FROM $retail_postflight${"functions":[{"md5":"5d3de571c999da2f44b4cec08d0d2e41","anon":false,"owner":"postgres","config":["search_path=pg_catalog"],"definer":false,"signature":"booking_handover(uuid,numeric,jsonb,jsonb,jsonb,jsonb,jsonb)","service_role":false,"authenticated":true},{"md5":"1221b923eaac7da2408b967a92dbd536","anon":false,"owner":"postgres","config":["search_path=pg_catalog"],"definer":false,"signature":"pos_sync_cash_v1.apply_checkout(text,text,uuid,text,uuid,uuid,uuid,uuid,text,text,jsonb)","service_role":false,"authenticated":false},{"md5":"7c2716d73e4129b1dfc7eb9ddc65a794","anon":false,"owner":"postgres","config":["search_path=pg_catalog"],"definer":false,"signature":"pos_sync_cash_v1.assert_extended_tenders(sales,jsonb,uuid)","service_role":false,"authenticated":false},{"md5":"b43a4ebed7d1ba26b1efac43ff4173da","anon":false,"owner":"postgres","config":["search_path=pg_catalog"],"definer":false,"signature":"pos_sync_cash_v1.project_receipt(text,jsonb)","service_role":false,"authenticated":false},{"md5":"07da7186057d2cc7cee8979733afc9a3","anon":false,"owner":"postgres","config":["search_path=pg_catalog","TimeZone=UTC"],"definer":false,"signature":"pos_sync_feed_v1.publish_transfer_receipt(uuid,jsonb)","service_role":false,"authenticated":false},{"md5":"ce332bd3a7950fedae2f6afea49772fe","anon":false,"owner":"postgres","config":["search_path=pg_catalog"],"definer":false,"signature":"pos_sync_feed_v1.record_cash_publication(text,text,uuid,bigint,uuid,uuid,uuid,uuid,text)","service_role":false,"authenticated":false},{"md5":"f2cafa198ab7f6f8709ffe0caa3c4d46","anon":false,"owner":"postgres","config":["search_path=public, pg_temp"],"definer":true,"signature":"pos_sync_push_aggregate(uuid,text,text,text,jsonb)","service_role":true,"authenticated":false},{"md5":"e71200273c8182cad5cff66f4f5fb5fc","anon":false,"owner":"postgres","config":["search_path=pg_catalog"],"definer":false,"signature":"private.check_booking_handover_upload(text,jsonb,boolean)","service_role":false,"authenticated":false},{"md5":"f69fd94db446880e3b2fe7eab6d21b85","anon":false,"owner":"postgres","config":["search_path=public, pg_temp"],"definer":true,"signature":"private.stock_transfer_receive(uuid,text,boolean,jsonb)","service_role":true,"authenticated":false},{"md5":"fcb1b0af3af9dfd8f60a13ac113fc4c2","anon":false,"owner":"postgres","config":["search_path=public, pg_temp"],"definer":true,"signature":"private.stock_transfer_verify(uuid,text,jsonb,text)","service_role":true,"authenticated":false},{"md5":"0a0b2be15b96d195308db70392b0539e","anon":false,"owner":"postgres","config":["search_path=\"\""],"definer":true,"signature":"received_product_catalogue_stores(uuid)","service_role":true,"authenticated":false},{"md5":"70d1028d1c25a67bcfd0381decc067fb","anon":false,"owner":"postgres","config":["search_path=\"\""],"definer":true,"signature":"reserve_product_skus(integer,text,text,text,integer)","service_role":true,"authenticated":true}],"migrations":[{"name":"retail_pos_beta_schema_transport","version":"20261109075631"},{"name":"retail_pos_beta_canonical_schema","version":"20261109080027"},{"name":"retail_pos_beta_financial_and_grouped_pilot","version":"20261109080440"},{"name":"retail_pos_beta_guard_booking_scope","version":"20261109081038"},{"name":"retail_pos_beta_deferred_stock_guard","version":"20261109081624"},{"name":"retail_pos_beta_native_transfer_receipt","version":"20261109081629"},{"name":"retail_pos_beta_restore_transfer_approval_helper","version":"20261109082129"},{"name":"retail_pos_beta_refresh_initial_recovery_pin","version":"20261109083037"},{"name":"retail_pos_beta_sync_tenders_transfer_booking_upgrade","version":"20261110031005"}],"rls_tables":{"public":79,"pos_sync_feed_v1":18},"constraints":[{"name":"cash_publications_organization_id_operation_id_key","validated":true,"definition":"UNIQUE (organization_id, operation_id)"},{"name":"cash_publications_organization_id_scope_id_epoch_fkey","validated":true,"definition":"FOREIGN KEY (organization_id, scope_id, epoch) REFERENCES pos_sync_feed_v1.cash_settings_pilots(organization_id, scope_id, epoch)"},{"name":"cash_publications_pkey","validated":true,"definition":"PRIMARY KEY (organization_id, scope_id, epoch, seq)"},{"name":"cash_publications_seq_check","validated":true,"definition":"CHECK ((seq > 0))"},{"name":"cash_publications_tender_changes_check","validated":true,"definition":"CHECK (((jsonb_typeof(changes) = 'array'::text) AND ((jsonb_array_length(changes) >= 4) AND (jsonb_array_length(changes) <= 19))))"}],"project_ref":"irjkmhgrjgcaoixcixut","database_name":"postgres","database_role":"postgres","system_identifier":"7703759698107299042"}$retail_postflight$::jsonb THEN
  RAISE EXCEPTION 'RETAIL_POS_BETA_POSTFLIGHT_MISMATCH';
 END IF;
END $retail_beta_upgrade$;
COMMIT;
SELECT 'irjkmhgrjgcaoixcixut' AS project_ref,'Verified current beta schema; no activation performed' AS result;
