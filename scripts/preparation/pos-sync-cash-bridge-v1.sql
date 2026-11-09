-- Isolated, owner-only composition of the prepared inbox/feed and the native
-- aggregate writer. The separate attested gateway supplies the verified
-- cashier for the mixed pilot. The private un-authored form is fixture-only.
CREATE SCHEMA pos_sync_cash_v1;
REVOKE ALL ON SCHEMA pos_sync_cash_v1 FROM PUBLIC, anon, authenticated, service_role;

-- The owner provisions one current source per terminal before any checkout.
-- Replacing or deleting this row waits for admitted checkouts to finish.
CREATE TABLE pos_sync_cash_v1.installation_enrollments (
  organization_id text COLLATE "C" NOT NULL,
  terminal_id uuid NOT NULL,
  branch_id text COLLATE "C" NOT NULL,
  installation_generation uuid NOT NULL,
  database_guid uuid NOT NULL,
  PRIMARY KEY (organization_id, terminal_id)
);

ALTER TABLE pos_sync_cash_v1.installation_enrollments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE pos_sync_cash_v1.installation_enrollments FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION pos_sync_cash_v1.apply_checkout(
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

REVOKE ALL ON FUNCTION pos_sync_cash_v1.apply_checkout(text, text, uuid, text, uuid, uuid, uuid, uuid, text, text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
