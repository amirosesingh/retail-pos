-- Shift closure proof v2: PostgreSQL revision triggers advance OLD+1, while a
-- disconnected till can accumulate several local revisions. Keep these clocks
-- separate and bind the proof to the exact requested snapshot instead.
-- This changes one service-only read/validation helper; no stored rows or global
-- row-version triggers are rewritten. Exact closing facts remain mandatory.
BEGIN;
-- SHIFT_CLOSURE_SYNC_PROOF_V2_BEGIN
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
       OR persisted.row_version IS NULL OR persisted.row_version<1
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
      'id',persisted.id,'store_id',persisted.store_id,'row_version',persisted.row_version,'requested_row_version',incoming.row_version));
  END LOOP;
  RETURN jsonb_build_object('shift_closure_ack_version',2,'shift_closures',confirmed);
END $fn$;
-- SHIFT_CLOSURE_SYNC_PROOF_V2_END
REVOKE ALL ON FUNCTION public.pos_sync_shift_closure_ack(jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pos_sync_shift_closure_ack(jsonb,text) TO service_role;
COMMIT;
