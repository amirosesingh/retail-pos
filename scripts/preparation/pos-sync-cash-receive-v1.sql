-- Isolated preparation. Call with the ordinary cash bridge's verified evidence
-- inside its write transaction. The returned rows contain only receipt facts.
CREATE FUNCTION pos_sync_cash_v1.receipt_row(
  p_table text, p_row jsonb, p_fields text[], p_decimals text[]
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $row$
  SELECT jsonb_build_object('table_name', p_table, 'entity_id', jsonb_build_object('id', p_row->'id')::text,
    'row_data', jsonb_object_agg(field, CASE WHEN field = ANY(p_decimals) OR field = 'row_version'
      THEN to_jsonb(p_row->>field) ELSE p_row->field END),
    'row_version', p_row->>'row_version', 'tombstone', false)
  FROM unnest(p_fields) AS fields(field)
  WHERE p_row ?& p_fields
  HAVING count(*) = cardinality(p_fields);
$row$;

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

CREATE FUNCTION pos_sync_cash_v1.project_receipt(p_branch text, p_evidence jsonb)
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

REVOKE ALL ON FUNCTION pos_sync_cash_v1.receipt_row(text, jsonb, text[], text[]),
  pos_sync_cash_v1.project_receipt(text, jsonb), pos_sync_cash_v1.assert_extended_tenders(public.sales,jsonb,uuid)
  FROM PUBLIC, anon, authenticated, service_role;
