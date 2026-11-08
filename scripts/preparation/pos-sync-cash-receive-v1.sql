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

CREATE FUNCTION pos_sync_cash_v1.project_receipt(p_branch text, p_evidence jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $receipt$
DECLARE
  v_changes jsonb;
BEGIN
  IF jsonb_typeof(p_evidence) IS DISTINCT FROM 'array' OR jsonb_array_length(p_evidence) <> 4
     OR p_evidence->0->>'type' IS DISTINCT FROM 'cash_sale'
     OR p_evidence->1->>'type' IS DISTINCT FROM 'sale_item'
     OR p_evidence->2->>'type' IS DISTINCT FROM 'cash_tender'
     OR p_evidence->3->>'type' IS DISTINCT FROM 'stock_delta' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'POS_CASH_V1_RECEIPT_EVIDENCE_INVALID';
  END IF;

  SELECT jsonb_build_array(
    pos_sync_cash_v1.receipt_row('sales', to_jsonb(sale) || jsonb_build_object('payments', jsonb_build_array(
      jsonb_build_object('id', tender.id, 'method', 'cash', 'amount', tender.amount::text))),
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
      ARRAY['id','source_type','sale_id','store_id','shift_id','terminal_id','amount','method','kind','note','paid_at',
        'created_at','updated_at','row_version','status','metadata'], ARRAY['amount']),
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
    AND sale.shift_id = tender.shift_id AND sale.payment_type = 'cash' AND tender.method = 'cash'
    AND tender.amount = sale.total_amount AND movement.quantity_delta = -item.quantity;
  IF NOT FOUND OR v_changes @> '[null]'::jsonb THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'POS_CASH_V1_RECEIPT_PROJECTION_UNAVAILABLE';
  END IF;
  RETURN v_changes;
END;
$receipt$;

REVOKE ALL ON FUNCTION pos_sync_cash_v1.receipt_row(text, jsonb, text[], text[]),
  pos_sync_cash_v1.project_receipt(text, jsonb) FROM PUBLIC, anon, authenticated, service_role;
