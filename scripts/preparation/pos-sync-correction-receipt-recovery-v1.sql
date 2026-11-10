-- Isolated preparation after extended feed and the correction publishers.
-- Preserve the complete mapped receipt image inside the correction transaction.
BEGIN;

CREATE TABLE pos_sync_feed_v1.correction_receipt_graphs (
  organization_id text COLLATE "C" NOT NULL,
  scope_id text COLLATE "C" NOT NULL,
  epoch uuid NOT NULL,
  seq bigint NOT NULL,
  operation_id uuid NOT NULL,
  payload_json text NOT NULL CHECK (octet_length(payload_json) <= 196608),
  payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
  PRIMARY KEY (organization_id,scope_id,epoch,seq),
  FOREIGN KEY (organization_id,scope_id,epoch,seq) REFERENCES pos_sync_feed_v1.extended_publications,
  CHECK (payload_sha256=encode(sha256(convert_to(payload_json,'UTF8')),'hex'))
);
ALTER TABLE pos_sync_feed_v1.correction_receipt_graphs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE pos_sync_feed_v1.correction_receipt_graphs FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER pos_sync_correction_receipt_graph_immutable BEFORE UPDATE OR DELETE ON pos_sync_feed_v1.correction_receipt_graphs
FOR EACH ROW EXECUTE FUNCTION fin62_history_preparation.immutable();

-- All mapped numeric values and structured JSON leave PostgreSQL as text.
-- The replica can preserve them without a JavaScript numeric conversion.
CREATE FUNCTION pos_sync_feed_v1.correction_receipt_row(p_row jsonb, p_fields text[], p_exact text[])
RETURNS jsonb LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog
RETURN (SELECT jsonb_object_agg(field,CASE WHEN field=ANY(p_exact) THEN to_jsonb(p_row->>field) ELSE p_row->field END)
  FROM unnest(p_fields) AS fields(field) WHERE p_row ?& p_fields);

CREATE FUNCTION pos_sync_feed_v1.capture_correction_receipt_graph()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog
AS $capture$
DECLARE
  v_sale_id uuid := (NEW.metadata->'financial'->>'sale_id')::uuid;
  v_sale jsonb;
  v_items jsonb;
  v_tenders jsonb;
  v_payload text;
BEGIN
  IF coalesce(NEW.metadata->'financial'->>'kind','') NOT IN ('refund_v1','tender_v1') THEN RETURN NULL; END IF;
  -- A single statement reads the authorized receipt and its complete children
  -- from the writer's snapshot. A partial or oversized graph is unavailable.
  SELECT pos_sync_feed_v1.correction_receipt_row(to_jsonb(sale) || jsonb_build_object('payments',sale.payments::text),
      ARRAY['id','bill_number','member_id','store_id','cashier_name','subtotal_amount','total_amount','discount_amount',
        'tax_amount','payment_type','points_earned','points_redeemed','is_exchange','original_bill_number','is_refunded',
        'created_at','shift_id','paid_amount','change_amount','exchange_credit','exchanged_to_bill_number','coupon_code',
        'coupon_promo_id','coupon_scope','coupon_discount','payments','client_transaction_id','cashier_id','created_by',
        'updated_by','row_version','store_name_snapshot','store_address_snapshot','authorization_request_id','authorized_by',
        'authorized_at','rounding_adjustment','rounding_label','branch_id','corrected_at'],
      ARRAY['subtotal_amount','total_amount','discount_amount','tax_amount','points_earned','points_redeemed',
        'paid_amount','change_amount','exchange_credit','coupon_discount','rounding_adjustment']),
    items.rows,tenders.rows INTO v_sale,v_items,v_tenders
  FROM public.sales AS sale
  CROSS JOIN LATERAL (
    SELECT coalesce(jsonb_agg(pos_sync_feed_v1.correction_receipt_row(to_jsonb(item),
      ARRAY['id','sale_id','product_id','product_name','variant_code','unit_price','quantity','discount_percent',
        'discount_amount','is_return','created_at','tax_rate','is_foc','promo_id','coupon_code','coupon_discount',
        'unit_cost','row_version','refunded_qty','branch_id','corrected_at'],
      ARRAY['unit_price','discount_percent','discount_amount','tax_rate','coupon_discount','unit_cost'])
      ORDER BY item.id),'[]'::jsonb) AS rows,
      bool_and((item.branch_id IS NULL OR item.branch_id=NEW.scope_id) AND item.row_version>0) AS scoped
    FROM (SELECT * FROM public.sale_items WHERE sale_id=v_sale_id ORDER BY id LIMIT 101) AS item
  ) AS items
  CROSS JOIN LATERAL (
    SELECT coalesce(jsonb_agg(pos_sync_feed_v1.correction_receipt_row(
      to_jsonb(tender) || jsonb_build_object('metadata',tender.metadata::text),
      ARRAY['id','source_type','sale_id','booking_id','member_id','store_id','shift_id','terminal_id','amount','method',
        'kind','reference','cashier_id','cashier_name','note','paid_at','created_at','updated_at','row_version','status',
        'metadata','client_transaction_id','order_id','payment_method','transaction_reference'],ARRAY['amount'])
      ORDER BY tender.id),'[]'::jsonb) AS rows,
      bool_and(tender.store_id IS NOT DISTINCT FROM NEW.scope_id AND tender.source_type='sale'
        AND tender.booking_id IS NULL AND tender.row_version>0) AS scoped
    FROM (SELECT * FROM public.payment_transactions WHERE sale_id=v_sale_id ORDER BY id LIMIT 101) AS tender
  ) AS tenders
  WHERE sale.id=v_sale_id AND sale.store_id=NEW.scope_id AND (sale.branch_id IS NULL OR sale.branch_id=NEW.scope_id)
    AND sale.row_version=(NEW.changes->0->>'row_version')::integer
    AND items.scoped AND coalesce(tenders.scoped,true);
  IF v_sale IS NULL OR jsonb_array_length(v_items) NOT BETWEEN 1 AND 100 OR jsonb_array_length(v_tenders)>100
    OR v_items @> '[null]'::jsonb OR v_tenders @> '[null]'::jsonb THEN RETURN NULL; END IF;
  v_payload := jsonb_build_object('scope_id',NEW.scope_id,'epoch',NEW.epoch,'seq',NEW.seq::text,
    'operation_id',NEW.operation_id,'sale',v_sale,'items',v_items,'tenders',v_tenders)::text;
  IF octet_length(v_payload)>196608 THEN RETURN NULL; END IF;
  INSERT INTO pos_sync_feed_v1.correction_receipt_graphs
  VALUES(NEW.organization_id,NEW.scope_id,NEW.epoch,NEW.seq,NEW.operation_id,v_payload,
    encode(sha256(convert_to(v_payload,'UTF8')),'hex'));
  RETURN NULL;
END;
$capture$;

CREATE TRIGGER pos_sync_capture_correction_receipt_graph AFTER INSERT ON pos_sync_feed_v1.extended_publications
FOR EACH ROW EXECUTE FUNCTION pos_sync_feed_v1.capture_correction_receipt_graph();

CREATE OR REPLACE FUNCTION pos_sync_feed_v1.financial_parent_evidence(p_row pos_sync_feed_v1.extended_publications)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog
RETURN coalesce((SELECT jsonb_build_object('receipt_graph',jsonb_build_object(
    'payload_json',graph.payload_json,'payload_sha256',graph.payload_sha256))
  FROM pos_sync_feed_v1.correction_receipt_graphs AS graph
  WHERE (graph.organization_id,graph.scope_id,graph.epoch,graph.seq,graph.operation_id)
      =(p_row.organization_id,p_row.scope_id,p_row.epoch,p_row.seq,p_row.operation_id)),'{}'::jsonb);

REVOKE ALL ON FUNCTION pos_sync_feed_v1.correction_receipt_row(jsonb,text[],text[]),
  pos_sync_feed_v1.capture_correction_receipt_graph(),
  pos_sync_feed_v1.financial_parent_evidence(pos_sync_feed_v1.extended_publications)
  FROM PUBLIC,anon,authenticated,service_role;

COMMIT;
