-- SHIFT-14: acknowledge a closed shift only after its closing facts persisted.
-- Preparation only. Applying this migration changes routines, not business rows.
BEGIN;

-- SHIFT_CLOSURE_SYNC_HELPERS_BEGIN
CREATE OR REPLACE FUNCTION public.pos_sync_assert_shift_ownership(p_rows jsonb,p_branch_id text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
BEGIN
  IF NULLIF(btrim(p_branch_id),'') IS NULL OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) incoming
    WHERE NULLIF(btrim(incoming->>'store_id'),'') IS NULL
       OR lower(btrim(incoming->>'store_id'))<>lower(btrim(p_branch_id))
  ) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF;
  -- A globally unique id does not authorize moving an existing shift between shops.
  IF EXISTS (
    SELECT 1 FROM jsonb_populate_recordset(NULL::public.shifts,COALESCE(p_rows,'[]'::jsonb)) incoming
    JOIN public.shifts existing ON existing.id=incoming.id
    WHERE existing.store_id IS DISTINCT FROM p_branch_id
  ) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF;
END $fn$;

CREATE OR REPLACE FUNCTION public.pos_sync_shift_closure_ack(p_rows jsonb,p_branch_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE incoming public.shifts%ROWTYPE; persisted public.shifts%ROWTYPE; confirmed jsonb:='[]'::jsonb;
BEGIN
  -- Match the established request-boundary canonicalization, including replay.
  SELECT COALESCE(jsonb_agg(CASE WHEN NULLIF(btrim(row_value->>'store_id'),'') IS NULL
    OR lower(btrim(row_value->>'store_id'))=lower(btrim(p_branch_id))
    THEN row_value||jsonb_build_object('store_id',p_branch_id) ELSE row_value END),'[]'::jsonb)
  INTO p_rows FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) row_value;
  PERFORM public.pos_sync_assert_shift_ownership(p_rows,p_branch_id);
  FOR incoming IN
    SELECT * FROM jsonb_populate_recordset(NULL::public.shifts,COALESCE(p_rows,'[]'::jsonb)) candidate
    WHERE upper(COALESCE(candidate.status,''))='CLOSED'
       OR upper(COALESCE(candidate.state,''))='CLOSED' OR candidate.closed_at IS NOT NULL
  LOOP
    SELECT * INTO persisted FROM public.shifts WHERE id=incoming.id FOR SHARE;
    IF NOT FOUND OR persisted.store_id IS DISTINCT FROM p_branch_id
       OR incoming.status IS DISTINCT FROM 'CLOSED' OR incoming.state IS DISTINCT FROM 'CLOSED'
       OR incoming.closed_at IS NULL OR incoming.row_version IS NULL OR incoming.row_version<1
       OR persisted.status IS DISTINCT FROM 'CLOSED' OR persisted.state IS DISTINCT FROM 'CLOSED'
       OR persisted.row_version<incoming.row_version
       OR ROW(persisted.closed_at,persisted.closed_by_name,persisted.closed_by_staff_id,persisted.closed_by_role,
              persisted.counted_cash,persisted.counted_card,persisted.counted_digital,
              persisted.expected_cash,persisted.expected_card,persisted.expected_digital,
              persisted.closing_float,persisted.variance_cash,persisted.variance_card,persisted.variance_digital,
              persisted.variance_total,persisted.close_reason,persisted.closing_started_at,
              persisted.closing_started_by,persisted.final_counted_cash,persisted.variance_status)
          IS DISTINCT FROM
          ROW(incoming.closed_at,incoming.closed_by_name,incoming.closed_by_staff_id,incoming.closed_by_role,
              incoming.counted_cash,incoming.counted_card,incoming.counted_digital,
              incoming.expected_cash,incoming.expected_card,incoming.expected_digital,
              incoming.closing_float,incoming.variance_cash,incoming.variance_card,incoming.variance_digital,
              incoming.variance_total,incoming.close_reason,incoming.closing_started_at,
              incoming.closing_started_by,incoming.final_counted_cash,incoming.variance_status)
    THEN RAISE EXCEPTION 'SYNC_SHIFT_CLOSURE_CONFLICT'; END IF;
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(confirmed) previous WHERE previous->>'id'=incoming.id::text)
    THEN RAISE EXCEPTION 'SYNC_SHIFT_CLOSURE_DUPLICATE'; END IF;
    confirmed:=confirmed||jsonb_build_array(jsonb_build_object(
      'id',persisted.id,'store_id',persisted.store_id,'row_version',persisted.row_version));
  END LOOP;
  RETURN jsonb_build_object('shift_closure_ack_version',1,'shift_closures',confirmed);
END $fn$;

CREATE OR REPLACE FUNCTION public.pos_sync_aggregate_shift_closure_ack(p_operations jsonb,p_branch_id text)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
  SELECT public.pos_sync_shift_closure_ack(COALESCE(jsonb_agg(
    CASE WHEN NULLIF(btrim(incoming->>'store_id'),'') IS NULL
           OR lower(btrim(incoming->>'store_id'))=lower(btrim(p_branch_id))
      THEN incoming||jsonb_build_object('store_id',p_branch_id) ELSE incoming END),'[]'::jsonb),p_branch_id)
  FROM jsonb_array_elements(COALESCE(p_operations,'[]'::jsonb)) operation
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(operation->'rows','[]'::jsonb)) incoming
  WHERE operation->>'table'='shifts'
$fn$;

REVOKE ALL ON FUNCTION public.pos_sync_assert_shift_ownership(jsonb,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.pos_sync_shift_closure_ack(jsonb,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.pos_sync_aggregate_shift_closure_ack(jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pos_sync_assert_shift_ownership(jsonb,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.pos_sync_shift_closure_ack(jsonb,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.pos_sync_aggregate_shift_closure_ack(jsonb,text) TO service_role;
-- SHIFT_CLOSURE_SYNC_HELPERS_END

-- Patch only the existing functions' closure checks/acknowledgements. Preserve
-- current scope validation, privacy, product ownership and other table behavior.
DO $migration$
DECLARE definition text; updated text; signature regprocedure; receipt_return text;
        acknowledgement text; routine text;
BEGIN
  signature:='public.sync_apply_shifts(jsonb)'::regprocedure;
  definition:=replace(pg_get_functiondef(signature),E'\r\n',E'\n');
  IF position('pos_sync_shift_closure_ack' in definition)=0 THEN
    updated:=replace(definition,E'\nBEGIN\n',E'\nBEGIN\n  PERFORM public.pos_sync_assert_shift_ownership(p_rows,current_setting(''pos.sync_branch'',true));\n');
    updated:=replace(updated,'RETURN v_count;',
      'PERFORM public.pos_sync_shift_closure_ack(p_rows,current_setting(''pos.sync_branch'',true)); RETURN v_count;');
    updated:=replace(updated,'WHERE EXCLUDED."row_version">public."shifts"."row_version"',
      'WHERE EXCLUDED."row_version">public."shifts"."row_version" AND EXCLUDED."store_id"=public."shifts"."store_id"');
    IF updated=definition OR position('pos_sync_assert_shift_ownership' in updated)=0
       OR position('pos_sync_shift_closure_ack' in updated)=0
       OR position('AND EXCLUDED."store_id"=public."shifts"."store_id"' in updated)=0
    THEN RAISE EXCEPTION 'Could not install shift closure postcondition'; END IF;
    EXECUTE updated;
  END IF;

  FOREACH routine IN ARRAY ARRAY['pos_sync_push_batch','pos_sync_push_aggregate'] LOOP
    signature:=CASE routine WHEN 'pos_sync_push_batch'
      THEN 'public.pos_sync_push_batch(uuid,text,text,text,text,jsonb,jsonb)'::regprocedure
      ELSE 'public.pos_sync_push_aggregate(uuid,text,text,text,jsonb)'::regprocedure END;
    definition:=replace(pg_get_functiondef(signature),E'\r\n',E'\n');
    CONTINUE WHEN position('shift_closure_ack' in definition)>0;
    acknowledgement:=CASE routine WHEN 'pos_sync_push_batch'
      THEN 'CASE WHEN p_table=''shifts'' THEN public.pos_sync_shift_closure_ack(p_rows,p_branch_id) ELSE ''{}''::jsonb END'
      ELSE 'public.pos_sync_aggregate_shift_closure_ack(p_operations,p_branch_id)' END;
    receipt_return:='RETURN jsonb_build_object(''ok'',true,''replayed'',true,''batch_id'',p_batch_id);';
    updated:=replace(definition,receipt_return,
      'RETURN jsonb_build_object(''ok'',true,''replayed'',true,''batch_id'',p_batch_id)||'||acknowledgement||';');
    IF updated=definition THEN RAISE EXCEPTION 'Could not guard replay acknowledgement in %',routine; END IF;
    definition:=updated;
    updated:=replace(definition,
      CASE routine WHEN 'pos_sync_push_batch' THEN 'RETURN jsonb_build_object(''ok'',true,''applied'',v_count,''batch_id'',p_batch_id);'
      ELSE 'RETURN jsonb_build_object(''ok'',true,''applied'',v_total,''batch_id'',p_batch_id);' END,
      CASE routine WHEN 'pos_sync_push_batch' THEN 'RETURN jsonb_build_object(''ok'',true,''applied'',v_count,''batch_id'',p_batch_id)||'
      ELSE 'RETURN jsonb_build_object(''ok'',true,''applied'',v_total,''batch_id'',p_batch_id)||' END||acknowledgement||';');
    IF updated=definition THEN RAISE EXCEPTION 'Could not guard new acknowledgement in %',routine; END IF;
    EXECUTE updated;
  END LOOP;
END $migration$;

COMMIT;
