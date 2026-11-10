-- Prepare after the extended feed and canonical atomic dispatch contract.
-- The dispatch receipt is inserted after the stock, lines and request commit
-- effects are known. Its replay path never inserts another receipt.
BEGIN;

CREATE FUNCTION pos_sync_feed_v1.publish_transfer_dispatch()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC'
AS $publish$
DECLARE
  v_transfer public.stock_transfers;
  v_request public.stock_transfers;
  v_branch text;
  v_epoch uuid;
  v_lines jsonb;
  v_stock jsonb;
  v_logs jsonb;
  v_transfer_row jsonb;
  v_request_row jsonb;
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
  SELECT * INTO STRICT v_transfer FROM public.stock_transfers WHERE id=NEW.transfer_id;
  -- Use the same scope order as stock publication. A dispatch, including a
  -- zero-quantity dispatch, cannot cross a concurrent arm or seal unnoticed.
  PERFORM head.scope_id FROM pos_sync_feed_v1.feed_heads AS head
  WHERE head.organization_id='default' AND head.scope_id IN (v_transfer.from_store_id,v_transfer.to_store_id)
  ORDER BY head.scope_id FOR NO KEY UPDATE OF head;
  IF pos_sync_feed_v1.extended_scope_epoch('default',v_transfer.from_store_id) IS NULL AND
     pos_sync_feed_v1.extended_scope_epoch('default',v_transfer.to_store_id) IS NULL THEN RETURN NULL; END IF;
  IF v_transfer.from_store_id=v_transfer.to_store_id OR length(v_transfer.from_store_id) NOT BETWEEN 1 AND 128 OR
     length(v_transfer.to_store_id) NOT BETWEEN 1 AND 128 THEN RETURN NULL; END IF;
  IF v_transfer.kind<>'transfer' OR v_transfer.status<>'dispatched' OR
     v_transfer.dispatched_at::timestamptz IS DISTINCT FROM NEW.dispatched_at OR
     v_transfer.dispatched_by IS DISTINCT FROM NEW.actor_name OR
     NEW.intent->>'transfer_id' IS DISTINCT FROM v_transfer.id::text THEN
    RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='POS_TRANSFER_DISPATCH_RECEIPT_UNVERIFIED';
  END IF;
  IF v_transfer.source_request_id IS NOT NULL THEN
    SELECT * INTO STRICT v_request FROM public.stock_transfers WHERE id=v_transfer.source_request_id;
    IF v_request.kind<>'request' OR v_request.status<>'completed' OR
       (v_request.from_store_id,v_request.to_store_id) IS DISTINCT FROM
       (v_transfer.from_store_id,v_transfer.to_store_id) THEN
      RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='POS_TRANSFER_DISPATCH_REQUEST_UNVERIFIED';
    END IF;
  END IF;

  SELECT coalesce(jsonb_agg(pos_sync_feed_v1.correction_receipt_row(to_jsonb(line),v_line_fields,ARRAY['unit_cost'])
    ORDER BY line.transfer_id,line.id),'[]'::jsonb) INTO v_lines
  FROM public.stock_transfer_items AS line
  WHERE line.transfer_id IN (v_transfer.id,v_request.id);
  -- Leave unsupported batches on their established route. In particular a
  -- source store may dispatch stock on a product owned by another branch.
  SELECT coalesce(jsonb_agg(pos_sync_feed_v1.correction_receipt_row(to_jsonb(log),v_log_fields,ARRAY['unit_cost'])
    ORDER BY log.product_id,log.id),'[]'::jsonb) INTO v_logs
  FROM public.item_activity_logs AS log
  WHERE log.created_at=NEW.dispatched_at AND log.activity_type='transfer_out' AND log.reference=v_transfer.ref
    AND log.staff_name=NEW.actor_name AND log.note='Warehouse dispatch';
  IF jsonb_array_length(v_lines) NOT BETWEEN 1 AND 100 OR v_lines @> '[null]'::jsonb OR v_logs @> '[null]'::jsonb OR
     jsonb_array_length(v_logs)<>(SELECT count(*) FROM public.stock_transfer_items
       WHERE transfer_id=v_transfer.id AND quantity_dispatched>0) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_logs) AS log
    LEFT JOIN public.products AS product ON product.id=(log->>'product_id')::uuid
    LEFT JOIN public.stock_transfer_items AS line ON line.transfer_id=v_transfer.id AND line.product_id=product.id
    WHERE log->>'store_id' IS DISTINCT FROM v_transfer.from_store_id OR
      product.owner_store_id IS DISTINCT FROM v_transfer.from_store_id OR line.quantity_dispatched IS NULL OR
      (log->>'quantity_delta')::integer IS DISTINCT FROM -line.quantity_dispatched OR
      (log->>'stock_after')::integer IS DISTINCT FROM (product.stock_by_store->>v_transfer.from_store_id)::integer
  ) THEN RETURN NULL; END IF;
  IF jsonb_array_length(v_logs)<>(SELECT count(DISTINCT log->>'product_id') FROM jsonb_array_elements(v_logs) AS log)
  THEN RETURN NULL; END IF;
  v_transfer_row:=pos_sync_feed_v1.correction_receipt_row(to_jsonb(v_transfer),v_header_fields,ARRAY[]::text[]);
  IF v_request.id IS NOT NULL THEN
    v_request_row:=pos_sync_feed_v1.correction_receipt_row(to_jsonb(v_request),v_header_fields,ARRAY[]::text[]);
  END IF;
  IF v_transfer_row IS NULL OR (v_request.id IS NOT NULL AND v_request_row IS NULL) THEN RETURN NULL; END IF;
  v_metadata:=jsonb_build_object('financial',jsonb_build_object('kind','transfer_v1','transfer_id',v_transfer.id));

  FOR v_branch IN SELECT DISTINCT branch COLLATE "C" FROM (VALUES (v_transfer.from_store_id),(v_transfer.to_store_id)) AS side(branch)
    ORDER BY branch COLLATE "C"
  LOOP
    v_epoch:=pos_sync_feed_v1.extended_scope_epoch('default',v_branch);
    IF v_epoch IS NULL OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_lines) AS line
      WHERE line->>'product_id' IS NOT NULL AND NOT public.product_available_in_catalogue((line->>'product_id')::uuid,v_branch)
    ) THEN CONTINUE; END IF;
    v_stock:='[]'::jsonb;
    IF v_branch=v_transfer.from_store_id THEN
      SELECT coalesce(jsonb_agg(pos_sync_feed_v1.live_stock_row(product.id,product.stock_by_store,v_branch,product.row_version)
        ORDER BY product.id),'[]'::jsonb) INTO v_stock
      FROM public.products AS product
      JOIN public.stock_transfer_items AS line ON line.product_id=product.id
      WHERE line.transfer_id=v_transfer.id AND line.quantity_dispatched>0;
    END IF;
    v_graph:=jsonb_build_object('branch_id',v_branch,'transfer',v_transfer_row,
      'request',v_request_row,'lines',v_lines,'stock',v_stock,
      'logs',CASE WHEN v_branch=v_transfer.from_store_id THEN v_logs ELSE '[]'::jsonb END)::text;
    IF octet_length(v_graph)>196608 THEN CONTINUE; END IF;
    v_operation:=left(encode(sha256(convert_to(jsonb_build_array(
      'transfer-dispatch-v1',v_branch,v_epoch,v_transfer.id)::text,'UTF8')),'hex'),32)::uuid;
    v_changes:=jsonb_build_array(pos_sync_feed_v1.financial_change('stock_transfers',jsonb_build_object('id',v_transfer.id),
        jsonb_build_object('id',v_transfer.id,'store_id',v_branch,'row_version',v_transfer.row_version,
        'graph_json',v_graph,'graph_sha256',encode(sha256(convert_to(v_graph,'UTF8')),'hex')),v_transfer.row_version));
    IF octet_length((v_changes||jsonb_build_array(v_metadata))::text)>262144 THEN CONTINUE; END IF;
    v_seq:=pos_sync_feed_v1.append_extended_group('default',v_branch,v_epoch,v_operation,v_changes,v_metadata);
    FOR v_row IN SELECT value FROM jsonb_array_elements(v_stock)
    LOOP
      PERFORM pos_sync_feed_v1.cover_stock_revision('default',v_branch,v_epoch,v_seq,(v_row->>'product_id')::uuid,
        (v_row->>'branch_balance')::integer,(v_row->>'row_version')::integer);
    END LOOP;
  END LOOP;
  RETURN NULL;
END;
$publish$;

REVOKE ALL ON FUNCTION pos_sync_feed_v1.publish_transfer_dispatch() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER pos_sync_publish_transfer_dispatch AFTER INSERT ON private.transfer_dispatch_receipts
FOR EACH ROW EXECUTE FUNCTION pos_sync_feed_v1.publish_transfer_dispatch();

COMMIT;
