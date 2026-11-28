-- Install after the grouped dispatch and native warehouse receipt modules.
-- Only the canonical writers know which destination movements they inserted.
BEGIN;

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

COMMIT;
