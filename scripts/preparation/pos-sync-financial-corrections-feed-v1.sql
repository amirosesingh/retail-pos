-- Isolated preparation after the extended feed, stock and both correction writers.
-- Append inside the canonical writer transaction so a receipt and all its effects
-- cross the download boundary together. The receipt remains the upload result.
BEGIN;

CREATE FUNCTION pos_sync_feed_v1.financial_change(
  p_table text, p_key jsonb, p_row jsonb, p_version integer
) RETURNS jsonb LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = pg_catalog
RETURN jsonb_build_object('table_name',p_table,'entity_id',p_key::text,'row_data',p_row,
  'row_version',p_version::text,'tombstone',false);

CREATE FUNCTION pos_sync_feed_v1.publish_refund_correction()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
AS $publish$
DECLARE
  v_epoch uuid;
  v_changes jsonb;
  v_items jsonb;
  v_ledger jsonb;
  v_stock jsonb;
  v_seq bigint;
  v_row record;
BEGIN
  IF NEW.result->>'status' IS DISTINCT FROM 'APPLIED' THEN RETURN NULL; END IF;
  v_epoch := pos_sync_feed_v1.extended_scope_epoch('default',NEW.branch_id);
  IF v_epoch IS NULL THEN RETURN NULL; END IF;

  SELECT jsonb_agg(pos_sync_feed_v1.financial_change('sale_items',jsonb_build_object('id',effect.item_id),
      jsonb_build_object('id',effect.item_id,'sale_id',NEW.sale_id,'branch_id',NEW.branch_id,
        'product_id',effect.product_id,'row_version',effect.row_version,'refunded_qty',effect.refunded_qty),
      effect.row_version) ORDER BY effect.item_id),
    jsonb_agg(pos_sync_feed_v1.financial_change('stock_delta_applied',jsonb_build_object('movement_id',effect.movement_id),
      jsonb_build_object('movement_id',effect.movement_id,'item_id',effect.item_id,'product_id',effect.product_id,
        'store_id',NEW.branch_id,'delta',effect.delta,'applied_at',ledger.applied_at),1) ORDER BY effect.item_id)
  INTO v_items,v_ledger
  FROM jsonb_to_recordset(NEW.result->'effects') AS effect(item_id uuid,product_id uuid,movement_id uuid,
    branch_id text,delta integer,refunded_qty integer,row_version integer)
  JOIN public.stock_delta_applied AS ledger ON (ledger.movement_id,ledger.product_id,ledger.store_id,ledger.delta) =
    (effect.movement_id,effect.product_id,NEW.branch_id,effect.delta)
  JOIN public.sale_items AS line ON (line.id,line.sale_id,line.product_id,line.row_version,line.refunded_qty) =
    (effect.item_id,NEW.sale_id,effect.product_id,effect.row_version,effect.refunded_qty)
  WHERE effect.branch_id=NEW.branch_id AND coalesce(line.branch_id,NEW.branch_id)=NEW.branch_id;

  SELECT jsonb_agg(pos_sync_feed_v1.financial_change('products',jsonb_build_object('id',product.id),
    jsonb_build_object('product_id',product.id,'branch_balance',saved.balance,'row_version',product.row_version),
    product.row_version) ORDER BY product.id) INTO v_stock
  FROM jsonb_to_recordset(NEW.result->'stock') AS saved(product_id uuid,branch_id text,balance integer)
  JOIN public.products AS product ON product.id=saved.product_id
  WHERE saved.branch_id=NEW.branch_id AND product.owner_store_id=NEW.branch_id
    AND (product.stock_by_store->>NEW.branch_id)::integer=saved.balance AND product.row_version>0;

  SELECT jsonb_build_array(pos_sync_feed_v1.financial_change('sales',jsonb_build_object('id',sale.id),
    jsonb_build_object('id',sale.id,'store_id',sale.store_id,'row_version',sale.row_version,'is_refunded',sale.is_refunded),
    sale.row_version)) INTO v_changes
  FROM public.sales AS sale WHERE sale.id=NEW.sale_id AND sale.store_id=NEW.branch_id
    AND sale.row_version=(NEW.result->>'sale_row_version')::integer
    AND sale.is_refunded=(NEW.result->>'fully_refunded')::boolean;
  IF v_changes IS NULL OR v_items IS NULL OR v_ledger IS NULL OR v_stock IS NULL
     OR jsonb_array_length(v_items)<>jsonb_array_length(NEW.result->'effects')
     OR jsonb_array_length(v_stock)<>jsonb_array_length(NEW.result->'stock') THEN
    RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='POS_FINANCIAL_REFUND_PUBLICATION_UNVERIFIED';
  END IF;

  v_seq := pos_sync_feed_v1.append_extended_group('default',NEW.branch_id,v_epoch,NEW.operation_id,
    v_changes || v_items || v_ledger || v_stock,jsonb_build_object('financial',
      jsonb_build_object('kind','refund_v1','sale_id',NEW.sale_id)));
  FOR v_row IN SELECT * FROM jsonb_to_recordset(
    (SELECT jsonb_agg(value->'row_data') FROM jsonb_array_elements(v_stock))
  ) AS stock(product_id uuid,branch_balance integer,row_version integer)
  LOOP
    PERFORM pos_sync_feed_v1.cover_stock_revision('default',NEW.branch_id,v_epoch,v_seq,
      v_row.product_id,v_row.branch_balance,v_row.row_version);
  END LOOP;
  RETURN NULL;
END;
$publish$;

CREATE FUNCTION pos_sync_feed_v1.publish_tender_correction()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
AS $publish$
DECLARE
  v_branch text := NEW.result->>'scope_id';
  v_sale uuid := (NEW.result->>'sale_id')::uuid;
  v_method text := NEW.result->>'method';
  v_epoch uuid;
  v_changes jsonb;
  v_tenders jsonb;
BEGIN
  v_epoch := pos_sync_feed_v1.extended_scope_epoch('default',v_branch);
  IF v_epoch IS NULL THEN RETURN NULL; END IF;
  SELECT jsonb_build_array(pos_sync_feed_v1.financial_change('sales',jsonb_build_object('id',sale.id),
    jsonb_build_object('id',sale.id,'store_id',sale.store_id,'row_version',sale.row_version,
      'payment_type',sale.payment_type,'payments_count',
      CASE WHEN jsonb_typeof(sale.payments)='array' THEN jsonb_array_length(sale.payments) END),sale.row_version))
  INTO v_changes FROM public.sales AS sale
  WHERE sale.id=v_sale AND sale.store_id=v_branch AND sale.payment_type=v_method
    AND sale.row_version=(NEW.result->>'sale_version')::integer AND sale.is_refunded=false
    AND CASE WHEN jsonb_typeof(sale.payments)='array' THEN jsonb_array_length(sale.payments)<=100
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(sale.payments) AS payment(value)
        WHERE jsonb_typeof(payment.value) IS DISTINCT FROM 'object'
          OR payment.value->>'method' IS DISTINCT FROM v_method)
      ELSE true END;

  SELECT coalesce(jsonb_agg(pos_sync_feed_v1.financial_change('payment_transactions',jsonb_build_object('id',tender.id),
    jsonb_build_object('id',tender.id,'sale_id',tender.sale_id,'store_id',tender.store_id,
      'row_version',tender.row_version,'method',tender.method,'updated_at',tender.updated_at),
    tender.row_version) ORDER BY tender.id),'[]'::jsonb)
  INTO v_tenders
  FROM public.payment_transactions AS tender
  JOIN jsonb_to_recordset(NEW.result->'tenders') AS saved(id uuid,row_version integer,method text)
    ON (tender.id,tender.row_version,tender.method)=(saved.id,saved.row_version,saved.method)
  WHERE tender.sale_id=v_sale AND tender.store_id=v_branch AND tender.source_type='sale' AND tender.method=v_method;
  IF v_changes IS NULL OR jsonb_array_length(v_tenders)<>jsonb_array_length(NEW.result->'tenders') THEN
    RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='POS_FINANCIAL_TENDER_PUBLICATION_UNVERIFIED';
  END IF;

  PERFORM pos_sync_feed_v1.append_extended_group('default',v_branch,v_epoch,NEW.operation_id,
    v_changes || v_tenders,jsonb_build_object('financial',jsonb_build_object('kind','tender_v1','sale_id',v_sale)));
  RETURN NULL;
END;
$publish$;

REVOKE ALL ON FUNCTION pos_sync_feed_v1.financial_change(text,jsonb,jsonb,integer),
  pos_sync_feed_v1.publish_refund_correction(), pos_sync_feed_v1.publish_tender_correction()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER pos_sync_refund_correction_publish AFTER INSERT ON pos_sync_refund_v1.receipts
FOR EACH ROW EXECUTE FUNCTION pos_sync_feed_v1.publish_refund_correction();
CREATE TRIGGER pos_sync_tender_correction_publish AFTER INSERT ON pos_sync_tender_v1.receipts
FOR EACH ROW EXECUTE FUNCTION pos_sync_feed_v1.publish_tender_correction();

-- The existing browser/management action has a sale revision. Derive its
-- stable key on the server and lock it before selecting the tender revisions.
-- A lost response recovers the exact original basis from the saved receipt.
CREATE FUNCTION public.pos_sync_request_tender_v1(
  p_author uuid,p_sale uuid,p_branch text,p_method text,p_terminal text,p_sale_version integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $request$
DECLARE
  v_operation uuid;
  v_branch text;
  v_epoch uuid;
  v_prior jsonb;
  v_tenders jsonb;
  v_result jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='POS_TENDER_V1_FORBIDDEN';
  END IF;
  SELECT store_id INTO v_branch FROM public.sales WHERE id=p_sale AND lower(store_id)=lower(p_branch);
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='POS_TENDER_V1_FORBIDDEN';
  END IF;
  PERFORM fin62_admin_preparation.authorize(p_author,v_branch,p_terminal);
  v_epoch := pos_sync_feed_v1.extended_scope_epoch('default',v_branch);
  IF v_epoch IS NULL THEN RETURN jsonb_build_object('status','SCOPE_UNAVAILABLE'); END IF;
  IF p_sale_version IS NULL OR p_sale_version NOT BETWEEN 1 AND 2147483646 THEN
    RETURN jsonb_build_object('status','REVIEW_REQUIRED','code','STALE_TENDER');
  END IF;

  v_operation := left(encode(sha256(convert_to(jsonb_build_array(
    'tender-correction-v1',p_author,p_sale,v_branch,p_method,p_terminal,p_sale_version)::text,'UTF8')),'hex'),32)::uuid;
  PERFORM pg_advisory_xact_lock(hashtextextended('pos-sync-tender:'||v_operation::text,0));
  SELECT result INTO v_prior FROM pos_sync_tender_v1.receipts WHERE operation_id=v_operation;
  IF FOUND THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('id',saved.id,'row_version',saved.row_version-1) ORDER BY saved.id),'[]'::jsonb)
    INTO v_tenders FROM jsonb_to_recordset(v_prior->'tenders') AS saved(id uuid,row_version integer);
  ELSE
    SELECT coalesce(jsonb_agg(jsonb_build_object('id',tender.id,'row_version',tender.row_version) ORDER BY tender.id),'[]'::jsonb)
    INTO v_tenders FROM public.payment_transactions AS tender
    WHERE tender.sale_id=p_sale AND tender.store_id=v_branch AND tender.source_type='sale';
  END IF;

  v_result := public.pos_sync_correct_tender_v1(v_operation,p_author,p_sale,v_branch,p_method,p_terminal,p_sale_version,v_tenders);
  IF v_result->>'status' IN ('APPLIED','ALREADY_APPLIED') AND NOT EXISTS(
    SELECT 1 FROM pos_sync_feed_v1.extended_publications AS publication
    WHERE (publication.organization_id,publication.scope_id,publication.epoch,publication.operation_id)=
      ('default',v_branch,v_epoch,v_operation)
      AND publication.metadata=jsonb_build_object('financial',jsonb_build_object('kind','tender_v1','sale_id',p_sale))
  ) THEN
    RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='POS_FINANCIAL_TENDER_PUBLICATION_UNVERIFIED';
  END IF;
  RETURN v_result;
END;
$request$;

REVOKE ALL ON FUNCTION public.pos_sync_request_tender_v1(uuid,uuid,text,text,text,integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pos_sync_request_tender_v1(uuid,uuid,text,text,text,integer) TO service_role;

COMMIT;
