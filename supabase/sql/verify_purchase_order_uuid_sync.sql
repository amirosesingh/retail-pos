-- Regression test: same-branch uppercase UUIDs succeed in both sync RPCs.
-- Cross-branch parent access is still rejected. All test rows are rolled back.
BEGIN;
SET LOCAL request.jwt.claims = '{"role":"service_role"}';
DO $test$
DECLARE v_branch text; v_terminal text; v_order uuid:=gen_random_uuid(); v_other uuid:=gen_random_uuid(); v_line uuid:=gen_random_uuid(); v_rows jsonb; v_result jsonb; v_rejected boolean:=false;
BEGIN
 SELECT location_id,id::text INTO v_branch,v_terminal FROM public.terminal_tokens
 WHERE status IN ('active','used') AND revoked_at IS NULL AND location_id IS NOT NULL LIMIT 1;
 IF v_terminal IS NULL THEN RAISE EXCEPTION 'No active terminal available for rollback test'; END IF;
 INSERT INTO public.purchase_orders(id,po_number,store_id,status) VALUES(v_order,'sync-regression-'||v_order::text,v_branch,'draft');
 v_rows:=jsonb_build_array(jsonb_build_object('id',v_line,'po_id',upper(v_order::text),
 'cost_price',0,'selling_price',0,'quantity_received',0,'subtotal_cost',0,'created_at',now(),'updated_at',now(),'row_version',1));
 v_result:=public.pos_sync_push_batch(gen_random_uuid(),'default',v_branch,v_terminal,'purchase_order_items',v_rows,'[]'::jsonb);
 ASSERT (v_result->>'ok')::boolean, 'Uppercase same-branch UUID must succeed';
 ASSERT EXISTS(SELECT 1 FROM public.purchase_order_items WHERE id=v_line AND po_id=v_order), 'Child was not stored';
 -- Aggregate retries must recognize the same uppercase foreign key too.
 v_result:=public.pos_sync_push_aggregate(gen_random_uuid(),'default',v_branch,v_terminal,
 jsonb_build_array(jsonb_build_object('table','purchase_order_items','rows',v_rows,'changes','[]'::jsonb)));
 ASSERT (v_result->>'ok')::boolean, 'Aggregate uppercase UUID must succeed';
 INSERT INTO public.purchase_orders(id,po_number,store_id,status) VALUES(v_other,'sync-regression-'||v_other::text,'sync-regression-other-branch','draft');
 v_rows:=jsonb_set(v_rows,'{0,po_id}',to_jsonb(upper(v_other::text)));
 BEGIN
  PERFORM public.pos_sync_push_batch(gen_random_uuid(),'default',v_branch,v_terminal,'purchase_order_items',v_rows,'[]'::jsonb);
 EXCEPTION WHEN SQLSTATE 'P0001' THEN
  IF SQLERRM <> 'SYNC_BRANCH_FORBIDDEN' THEN RAISE; END IF;
  v_rejected:=true;
 END;
 ASSERT v_rejected, 'Cross-branch parent must remain forbidden';
END $test$;
ROLLBACK;

