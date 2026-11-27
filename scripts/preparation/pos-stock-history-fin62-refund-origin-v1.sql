-- Optional STOCK401 proof for the existing full Register refund. Install after
-- the grouped refund stock source. The FIN62 event and business RPC stay intact.
BEGIN;

DO $dependencies$
BEGIN
 IF to_regclass('fin62_history_preparation.nodes') IS NULL
  OR to_regclass('fin62_history_preparation.publications') IS NULL
  OR to_regclass('fin62_history_preparation.business_receipts') IS NULL
  OR to_regclass('fin62_history_preparation.sale_steps') IS NULL
  OR to_regprocedure('private.stock_history_grouped_refund_source_refs(text,uuid,uuid,uuid,text,text,uuid,jsonb)') IS NULL
  OR to_regprocedure('fin62_history_preparation.row_fact(jsonb)') IS NULL
 THEN RAISE EXCEPTION 'STOCK_HISTORY_FIN62_REFUND_DEPENDENCY_REQUIRED'; END IF;
END $dependencies$;

CREATE FUNCTION private.stock_history_fin62_refund_source_refs(
 p_project text,p_operation uuid,p_author uuid,p_key uuid,p_branch text,p_terminal text,p_product uuid,p_refs jsonb
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $source$
DECLARE v_count bigint; v_claimed bigint; v_movements bigint; v_items bigint; v_batches bigint;
BEGIN
 IF jsonb_typeof(p_refs) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'STOCK_HISTORY_SOURCE_ORIGIN_UNPROVEN'; END IF;
 IF jsonb_array_length(p_refs) NOT BETWEEN 1 AND 100 OR EXISTS (
  SELECT FROM jsonb_array_elements(p_refs) AS input(ref)
  WHERE ref->>0 IS DISTINCT FROM 'stock_delta_applied' OR jsonb_typeof(ref->1) IS DISTINCT FROM 'string'
   OR jsonb_typeof(ref->2) IS DISTINCT FROM 'string' OR CASE WHEN jsonb_typeof(ref)='array' THEN jsonb_array_length(ref)<>3 ELSE true END
 ) THEN RAISE EXCEPTION 'STOCK_HISTORY_SOURCE_ORIGIN_UNPROVEN'; END IF;

 SELECT count(*),count(input.ref),count(DISTINCT source.movement_id),count(DISTINCT item->>'id'),count(DISTINCT receipt.batch_id)
 INTO v_count,v_claimed,v_movements,v_items,v_batches
 FROM fin62_history_preparation.nodes node
 JOIN fin62_history_preparation.sale_steps step ON step.operation_id=node.operation_id AND step.action='REFUND'
  AND ROW(step.organization_id,step.branch_id,step.terminal_id,step.shift_id,step.sequence)=
      ROW(node.organization_id,node.branch_id,node.terminal_id,node.shift_id,node.sequence)
 JOIN fin62_history_preparation.publications publication ON publication.sale_id=step.sale_id
  AND ROW(publication.organization_id,publication.branch_id,publication.terminal_id,publication.shift_id,publication.stream_sequence)=
      ROW(step.organization_id,step.branch_id,step.terminal_id,step.shift_id,step.sequence)
  AND publication.financial_fact=step.after_fact
 JOIN fin62_history_preparation.business_receipts receipt ON receipt.batch_id=publication.batch_id
  AND ROW(receipt.organization_id,receipt.branch_id,receipt.terminal_id)=
      ROW(publication.organization_id,publication.branch_id,publication.terminal_id)
  AND receipt.acknowledgement @> jsonb_build_object('ok',true,'batch_id',receipt.batch_id)
 CROSS JOIN LATERAL (
  SELECT DISTINCT 'refund:'||spelling AS request_key FROM (VALUES(step.sale_id::text),(upper(step.sale_id::text))) sale_key(spelling)
 ) route
 CROSS JOIN LATERAL jsonb_array_elements(receipt.operations) AS sale_part
 CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN sale_part->>'table'='sales' THEN sale_part->'rows' ELSE '[]'::jsonb END) AS sale
 CROSS JOIN LATERAL jsonb_array_elements(receipt.operations) AS item_part
 CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN item_part->>'table'='sale_items' THEN item_part->'rows' ELSE '[]'::jsonb END) AS item
 CROSS JOIN LATERAL jsonb_array_elements(receipt.operations) AS stock_part
 CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN stock_part->>'table'='stock_delta_applied' THEN stock_part->'rows' ELSE '[]'::jsonb END) AS stock
 JOIN private.stock_history_source_receipts source ON source.movement_id=(stock->>'movement_id')::uuid
  AND source.transaction_id=publication.capture_xid::text::bigint AND source.product_id=p_product AND source.store_id=p_branch
  AND source.quantity_delta>0
 JOIN private.stock_history_effect_sources link ON link.movement_id=source.movement_id
 JOIN private.stock_history_accepted_effects effect ON effect.id=link.effect_id AND effect.transaction_id=source.transaction_id
  AND effect.product_id=source.product_id AND effect.store_id=source.store_id AND effect.quantity_delta=source.quantity_delta
 LEFT JOIN LATERAL jsonb_array_elements(p_refs) AS input(ref) ON ref->>1=source.movement_id::text AND ref->>2=source.quantity_delta::text
 WHERE node.operation_id=p_operation AND node.node_kind='MUTATION' AND node.organization_id='default'
  AND node.branch_id=p_branch AND node.terminal_id=p_terminal
  AND node.proof @> jsonb_build_object('action','REFUND','operationId',p_operation,'projectOrigin',p_project,
   'authorId',p_author,'keyId',p_key,'branchId',p_branch,'terminalId',p_terminal,'payloadHash',node.payload_hash)
  AND node.payload_json::jsonb @> jsonb_build_object('action','REFUND','operationId',p_operation,'branchId',p_branch,'terminalId',p_terminal)
  AND jsonb_array_length(node.payload_json::jsonb->'changes')=1 AND node.payload_json::jsonb->'changes'->0->>'saleId'=step.sale_id::text
  AND step.before_fact IS NOT NULL AND step.before_fact->'isRefunded' IS DISTINCT FROM 'true'::jsonb
  AND step.after_fact->'isRefunded'='true'::jsonb
  AND pos_sync_refund_v1.native_id('{"refundId":'||to_jsonb(route.request_key)::text||'}')=p_operation
  AND sale->>'id'=step.sale_id::text AND sale->>'store_id'=p_branch
  AND fin62_history_preparation.row_fact(sale)=publication.financial_fact
  AND item->>'sale_id'=step.sale_id::text AND item->>'branch_id'=p_branch AND item->>'product_id'=p_product::text
  AND stock @> jsonb_build_object('movement_id',source.movement_id,'store_id',p_branch,'product_id',p_product,'delta',source.quantity_delta)
  AND CASE WHEN item->>'quantity'~'^[1-9][0-9]{0,9}$' THEN item->>'quantity'=item->>'refunded_qty'
       AND source.quantity_delta<=(item->>'quantity')::numeric ELSE false END
  AND source.movement_id IN (pos_sync_refund_v1.native_movement_id(route.request_key,item->>'id'),
   pos_sync_refund_v1.native_movement_id(route.request_key,upper(item->>'id')));

 IF v_batches<>1 OR v_count<>jsonb_array_length(p_refs) OR v_claimed<>v_count OR v_movements<>v_count OR v_items<>v_count
 THEN RAISE EXCEPTION 'STOCK_HISTORY_SOURCE_ORIGIN_UNPROVEN'; END IF;
 RETURN p_refs;
END $source$;
REVOKE ALL ON FUNCTION private.stock_history_fin62_refund_source_refs(text,uuid,uuid,uuid,text,text,uuid,jsonb)
 FROM PUBLIC,anon,authenticated,service_role;

DO $wire$
DECLARE claims oid:=to_regprocedure('public.pos_stock_history_accept_claims(text,text,text,jsonb)');
 definition text:=pg_get_functiondef(claims);
 anchor text:=$a$private.stock_history_grouped_refund_source_refs(p_project,operation,author,registered.key_id,p_branch,p_terminal,product,payload->16)$a$;
 replacement text:=$a$CASE WHEN EXISTS(SELECT FROM private.stock_history_grouped_refund_witnesses grouped WHERE grouped.operation_id=operation)
      THEN private.stock_history_grouped_refund_source_refs(p_project,operation,author,registered.key_id,p_branch,p_terminal,product,payload->16)
      ELSE private.stock_history_fin62_refund_source_refs(p_project,operation,author,registered.key_id,p_branch,p_terminal,product,payload->16) END$a$;
BEGIN
 IF definition IS NULL OR length(definition)-length(replace(definition,anchor,''))<>length(anchor)
  OR NOT EXISTS(SELECT FROM pg_proc WHERE oid=claims AND proowner=current_user::regrole AND prosecdef)
 THEN RAISE EXCEPTION 'STOCK_HISTORY_FIN62_REFUND_CLAIM_CONTRACT_UNVERIFIED'; END IF;
 EXECUTE replace(definition,anchor,replacement);
END $wire$;

COMMIT;
