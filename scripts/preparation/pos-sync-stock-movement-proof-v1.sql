-- Isolated preparation. Keep the deployed routine's identity, permissions,
-- authorization and normal stock arithmetic. Require exact replay evidence
-- before accepting an already-used movement ID.
DO $stock_movement$
DECLARE
  v_routine regprocedure := to_regprocedure('public.stock_apply_delta(uuid,uuid,text,integer)');
  v_definition text;
  v_before constant text := E'  IF NOT FOUND THEN\n    SELECT COALESCE((stock_by_store ->> _store_id)::int, 0) INTO _current';
  v_after constant text := $body$  IF NOT FOUND THEN
    PERFORM 1 FROM public.stock_delta_applied AS accepted
    WHERE accepted.movement_id = _movement_id AND accepted.product_id = _product_id
      AND accepted.store_id = _store_id AND accepted.delta = COALESCE(_delta, 0)
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'POS_STOCK_MOVEMENT_EVIDENCE_CONFLICT';
    END IF;
    SELECT COALESCE((stock_by_store ->> _store_id)::int, 0) INTO _current$body$;
BEGIN
  SELECT pg_get_functiondef(proc.oid) INTO v_definition FROM pg_proc AS proc
  WHERE proc.oid = v_routine AND proc.prosecdef AND pg_get_userbyid(proc.proowner) = current_user;
  IF v_definition IS NULL OR split_part(v_definition, v_before, 2) = ''
      OR split_part(v_definition, v_before, 3) <> ''
      OR position('POS_STOCK_MOVEMENT_EVIDENCE_CONFLICT' in v_definition) <> 0 THEN
    RAISE EXCEPTION 'Unexpected stock movement writer definition';
  END IF;
  EXECUTE replace(v_definition, v_before, v_after);
END;
$stock_movement$;
