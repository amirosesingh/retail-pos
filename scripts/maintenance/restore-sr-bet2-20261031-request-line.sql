-- TRF16: PREPARED MAINTENANCE ONLY. Apply only after exact-project/data approval.
-- Restore the owner-confirmed one-pair request line lost by the legacy nested-ID
-- collision. Never move the surviving child line or dispatch/receive any stock.
-- One bounded maintenance transaction. On any error the caller must ROLLBACK;
-- never retry within an aborted transaction. SET LOCAL changes expire on exit.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '10s';
DO $repair$
DECLARE
  repair_key constant text := 'TRF16:SR-BET2-WEB01-20261031-0001:restore-request-line:v1';
  request_ref constant text := 'SR-BET2-WEB01-20261031-0001';
  child_ref constant text := 'ST-STR1-WEB01-20261031-0001';
  audit_id uuid := md5(repair_key)::uuid;
  source_id text; destination_id text;
  request public.stock_transfers; child public.stock_transfers;
  original public.stock_transfer_items; restored public.stock_transfer_items;
  audit public.change_history;
  product_before jsonb; headers_before jsonb; child_before jsonb;
  activities_before jsonb; deltas_before jsonb; receipts_before jsonb;
  audit_value jsonb;
  audit_count integer; parent_count integer; inserted_audit_rows integer;
BEGIN
  IF current_user <> 'postgres' OR auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'TRF16 requires the database maintenance owner, not an app user';
  END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended(repair_key, 0)) THEN
    RAISE EXCEPTION 'TRF16 maintenance is busy; let operator work finish before retrying';
  END IF;
  -- Briefly exclude competing transfer writes, including new sibling/line phantoms.
  LOCK TABLE public.stock_transfers, public.stock_transfer_items IN SHARE ROW EXCLUSIVE MODE NOWAIT;
  IF (SELECT count(*) FROM public.stores WHERE code='STR1')<>1
     OR (SELECT count(*) FROM public.stores WHERE code='BET2')<>1 THEN
    RAISE EXCEPTION 'TRF16 branch-code identity changed';
  END IF;
  SELECT id INTO STRICT source_id FROM public.stores WHERE code='STR1'
    AND group_id='361-degree-sports' AND is_active AND archived_at IS NULL FOR SHARE NOWAIT;
  SELECT id INTO STRICT destination_id FROM public.stores WHERE code='BET2'
    AND group_id='361-degree-sports' AND is_active AND archived_at IS NULL FOR SHARE NOWAIT;
  IF source_id=destination_id OR
     (SELECT count(*) FROM public.stock_transfers WHERE ref=request_ref)<>1 OR
     (SELECT count(*) FROM public.stock_transfers WHERE ref=child_ref)<>1 THEN
    RAISE EXCEPTION 'TRF16 request/fulfilment identity is missing or ambiguous';
  END IF;
  SELECT * INTO STRICT request FROM public.stock_transfers WHERE ref=request_ref FOR UPDATE NOWAIT;
  SELECT * INTO STRICT child FROM public.stock_transfers WHERE ref=child_ref FOR UPDATE NOWAIT;
  IF request.id=child.id OR request.kind IS DISTINCT FROM 'request' OR child.kind IS DISTINCT FROM 'transfer'
     OR request.source_request_id IS NOT NULL OR child.source_request_id IS DISTINCT FROM request.id
     OR request.transfer_scope IS DISTINCT FROM 'INTRA_GROUP' OR child.transfer_scope IS DISTINCT FROM 'INTRA_GROUP'
     OR request.from_store_id IS DISTINCT FROM source_id OR child.from_store_id IS DISTINCT FROM source_id
     OR request.to_store_id IS DISTINCT FROM destination_id OR child.to_store_id IS DISTINCT FROM destination_id
     OR request.status IS DISTINCT FROM 'approved' OR child.status IS DISTINCT FROM 'approved'
     OR request.approved_by IS NULL OR child.approved_by IS DISTINCT FROM request.approved_by
     OR request.approved_at IS DISTINCT FROM '2026-10-31T03:36:02.185748Z'::timestamptz
     OR child.approved_at IS DISTINCT FROM '2026-10-31T03:36:01.064Z'::timestamptz
     OR request.created_at IS DISTINCT FROM '2026-10-31T03:34:55.852Z'::timestamptz
     OR child.created_at IS DISTINCT FROM '2026-10-31T03:36:01.064Z'::timestamptz
     OR request.row_version IS DISTINCT FROM 2 OR child.row_version IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'TRF16 captured approved request/fulfilment facts changed';
  END IF;
  IF request.dispatched_at IS NOT NULL OR child.dispatched_at IS NOT NULL
     OR request.dispatched_by IS NOT NULL OR child.dispatched_by IS NOT NULL
     OR request.received_at IS NOT NULL OR child.received_at IS NOT NULL
     OR request.received_by IS NOT NULL OR child.received_by IS NOT NULL
     OR request.verified_at IS NOT NULL OR child.verified_at IS NOT NULL
     OR request.verified_by IS NOT NULL OR child.verified_by IS NOT NULL
     OR request.posted_at IS NOT NULL OR child.posted_at IS NOT NULL
     OR request.closed_at IS NOT NULL OR child.closed_at IS NOT NULL
     OR request.fulfilment IS NOT NULL OR child.fulfilment IS NOT NULL
     OR request.rejected_by IS NOT NULL OR child.rejected_by IS NOT NULL
     OR request.rejected_reason IS NOT NULL OR child.rejected_reason IS NOT NULL
     OR request.cancelled_reason IS NOT NULL OR child.cancelled_reason IS NOT NULL
     OR request.discrepancy_reason IS NOT NULL OR child.discrepancy_reason IS NOT NULL
     OR (SELECT count(*) FROM public.stock_transfers WHERE source_request_id=request.id)<>1
     OR (SELECT count(*) FROM public.stock_transfer_items WHERE transfer_id=child.id)<>1 THEN
    RAISE EXCEPTION 'TRF16 workflow advanced or unexpected sibling/child lines exist';
  END IF;
  SELECT * INTO STRICT original FROM public.stock_transfer_items WHERE transfer_id=child.id FOR UPDATE NOWAIT;
  IF original.product_id IS NULL OR original.quantity IS DISTINCT FROM 1 OR original.quantity_approved IS NOT NULL
     OR original.quantity_received IS DISTINCT FROM 0 OR original.quantity_dispatched IS NOT NULL
     OR original.quantity_verified IS NOT NULL OR original.unit_cost IS DISTINCT FROM 49
     OR original.sku IS DISTINCT FROM 'SKU-000000178020'
     OR original.barcode IS DISTINCT FROM '6927050888645'
     OR original.product_name IS DISTINCT FROM 'W572511105-3-8 M''s Signature Basketbal Shoes'
     OR original.created_at IS DISTINCT FROM '2026-10-31T03:34:58.557726Z'::timestamptz
     OR original.row_version IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'TRF16 surviving original item snapshot changed';
  END IF;
  PERFORM 1 FROM public.products WHERE id=original.product_id FOR UPDATE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION 'TRF16 original product is missing'; END IF;
  -- Product data is an invariant, never a repair target. Exclude only update clocks.
  SELECT to_jsonb(p)-'row_version'-'updated_at' INTO product_before
    FROM public.products p WHERE p.id=original.product_id;
  SELECT jsonb_build_array(to_jsonb(request),to_jsonb(child)) INTO headers_before;
  child_before:=to_jsonb(original);
  SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]'::jsonb) INTO activities_before
    FROM public.item_activity_logs a
    WHERE a.reference IN (request_ref,child_ref,request.id::text,child.id::text);
  SELECT COALESCE(jsonb_agg(to_jsonb(d) ORDER BY d.movement_id),'[]'::jsonb) INTO deltas_before
    FROM public.stock_delta_applied d WHERE d.product_id=original.product_id;
  SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.transfer_id),'[]'::jsonb) INTO receipts_before
    FROM private.transfer_dispatch_receipts r WHERE r.transfer_id IN(request.id,child.id);
  IF activities_before<>'[]'::jsonb OR receipts_before<>'[]'::jsonb THEN
    RAISE EXCEPTION 'TRF16 unexpected stock movement or dispatch evidence exists';
  END IF;
  -- Indexed, deterministic audit identity avoids scanning the full audit history
  -- while transfer writes are paused. Any unrelated UUID collision fails closed.
  SELECT count(*) INTO audit_count FROM public.change_history h WHERE h.id=audit_id;
  SELECT count(*) INTO parent_count FROM public.stock_transfer_items WHERE transfer_id=request.id;
  IF audit_count=1 AND parent_count=1 THEN
    SELECT * INTO STRICT audit FROM public.change_history h WHERE h.id=audit_id;
    SELECT * INTO STRICT restored FROM public.stock_transfer_items WHERE transfer_id=request.id;
    IF audit.entity_type IS DISTINCT FROM 'stock_transfer_items' OR audit.entity_id IS DISTINCT FROM restored.id::text
       OR audit.action IS DISTINCT FROM 'insert' OR audit.old_value IS NOT NULL
       OR audit.source_application IS DISTINCT FROM 'maintenance' OR audit.changed_by IS DISTINCT FROM 'postgres'
       OR audit.scope_type IS DISTINCT FROM 'BRANCH' OR audit.scope_id IS DISTINCT FROM source_id
       OR audit.revision IS DISTINCT FROM restored.row_version
       OR audit.new_value->'_maintenance'->>'repair_key' IS DISTINCT FROM repair_key
       OR audit.new_value-'_maintenance'-'created_at' IS DISTINCT FROM to_jsonb(restored)-'created_at'
       OR (audit.new_value->>'created_at')::timestamptz IS DISTINCT FROM restored.created_at
       OR (audit.new_value->'_maintenance'->'original_child_line')-'created_at' IS DISTINCT FROM child_before-'created_at'
       OR (audit.new_value->'_maintenance'->'original_child_line'->>'created_at')::timestamptz IS DISTINCT FROM original.created_at
       OR audit.new_value->'_maintenance'->>'request_ref' IS DISTINCT FROM request_ref
       OR audit.new_value->'_maintenance'->>'child_ref' IS DISTINCT FROM child_ref
       OR restored.id=original.id OR restored.product_id IS DISTINCT FROM original.product_id
       OR restored.quantity IS DISTINCT FROM 1 OR restored.quantity_approved IS DISTINCT FROM 1
       OR restored.quantity_received IS DISTINCT FROM 0 OR restored.quantity_dispatched IS NOT NULL
       OR restored.quantity_verified IS NOT NULL OR restored.unit_cost IS DISTINCT FROM original.unit_cost
       OR restored.sku IS DISTINCT FROM original.sku OR restored.barcode IS DISTINCT FROM original.barcode
       OR restored.product_name IS DISTINCT FROM original.product_name
       OR restored.created_at IS DISTINCT FROM original.created_at THEN
      RAISE EXCEPTION 'TRF16 existing repair audit/line does not match the reviewed facts';
    END IF;
    RAISE NOTICE 'TRF16 matching audited request line already restored; no changes';
    RETURN;
  ELSIF audit_count<>0 OR parent_count<>0 THEN
    RAISE EXCEPTION 'TRF16 unexpected existing parent line or repair audit';
  END IF;
  INSERT INTO public.stock_transfer_items
    (id,transfer_id,product_id,barcode,sku,product_name,quantity,quantity_approved,
     quantity_received,quantity_dispatched,quantity_verified,unit_cost,created_at)
  VALUES(gen_random_uuid(),request.id,original.product_id,original.barcode,original.sku,
    original.product_name,1,1,0,NULL,NULL,original.unit_cost,original.created_at)
  RETURNING * INTO restored;
  audit_value:=to_jsonb(restored)||jsonb_build_object('_maintenance',jsonb_build_object(
      'repair_key',repair_key,'request_ref',request_ref,'child_ref',child_ref,
      'reason','Restore the owner-confirmed original one-pair request line lost by legacy nested-ID reparenting; no stock movement',
      'owner_confirmed_requested_quantity',1,'owner_confirmed_approved_quantity',1,
      'before_parent_lines',jsonb_build_array(),'original_child_line',child_before,
      'database_session_user',session_user));
  INSERT INTO public.change_history
    (id,entity_type,entity_id,action,old_value,new_value,revision,scope_type,scope_id,
     changed_by,source_application)
  VALUES(audit_id,'stock_transfer_items',restored.id::text,'insert',NULL,audit_value,
    restored.row_version,'BRANCH',source_id,current_user,'maintenance');
  GET DIAGNOSTICS inserted_audit_rows = ROW_COUNT;
  IF inserted_audit_rows IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'TRF16 audit insertion was not acknowledged; repair rolled back';
  END IF;
  SELECT * INTO audit FROM public.change_history WHERE id=audit_id;
  IF NOT FOUND OR audit.entity_type IS DISTINCT FROM 'stock_transfer_items'
     OR audit.entity_id IS DISTINCT FROM restored.id::text OR audit.action IS DISTINCT FROM 'insert'
     OR audit.old_value IS NOT NULL OR audit.new_value IS DISTINCT FROM audit_value
     OR audit.revision IS DISTINCT FROM restored.row_version
     OR audit.scope_type IS DISTINCT FROM 'BRANCH' OR audit.scope_id IS DISTINCT FROM source_id
     OR audit.changed_by IS DISTINCT FROM current_user OR audit.source_application IS DISTINCT FROM 'maintenance'
     OR audit.device_id IS NOT NULL OR audit.terminal_id IS NOT NULL OR audit.server_timestamp IS NULL THEN
    RAISE EXCEPTION 'TRF16 persisted audit does not match the repair; repair rolled back';
  END IF;
  IF (SELECT count(*) FROM public.stock_transfer_items WHERE transfer_id=request.id)<>1
     OR (SELECT to_jsonb(i) FROM public.stock_transfer_items i WHERE i.id=restored.id) IS DISTINCT FROM to_jsonb(restored)
     OR (SELECT to_jsonb(i) FROM public.stock_transfer_items i WHERE i.id=original.id) IS DISTINCT FROM child_before
     OR (SELECT jsonb_build_array(to_jsonb(r),to_jsonb(c)) FROM public.stock_transfers r,public.stock_transfers c WHERE r.id=request.id AND c.id=child.id) IS DISTINCT FROM headers_before
     OR (SELECT to_jsonb(p)-'row_version'-'updated_at' FROM public.products p WHERE p.id=original.product_id) IS DISTINCT FROM product_before
     OR (SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]'::jsonb) FROM public.item_activity_logs a WHERE a.reference IN(request_ref,child_ref,request.id::text,child.id::text)) IS DISTINCT FROM activities_before
     OR (SELECT COALESCE(jsonb_agg(to_jsonb(d) ORDER BY d.movement_id),'[]'::jsonb) FROM public.stock_delta_applied d WHERE d.product_id=original.product_id) IS DISTINCT FROM deltas_before
     OR (SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.transfer_id),'[]'::jsonb) FROM private.transfer_dispatch_receipts r WHERE r.transfer_id IN(request.id,child.id)) IS DISTINCT FROM receipts_before THEN
    RAISE EXCEPTION 'TRF16 repair invariant failed; statement rolled back';
  END IF;
  RAISE NOTICE 'TRF16 restored one audited request line; stock and child unchanged';
END $repair$;
COMMIT;
