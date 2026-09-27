-- Legacy desktop audit entries could omit the top-level store_id even though
-- their sync journal was already branch scoped. Stamp only that missing value
-- from the authenticated sync request. Explicit cross-branch values remain
-- rejected, and the stamped row is what is persisted.
DO $migration$
DECLARE
  v_batch text;
  v_aggregate text;
  v_old_batch text := $old$WHEN 'audit_logs' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_audit_logs(p_rows)+public.sync_delete_audit_logs(p_changes,p_branch_id);$old$;
  v_new_batch text := $new$WHEN 'audit_logs' THEN SELECT COALESCE(jsonb_agg(CASE WHEN NULLIF(btrim(r->>'store_id'),'') IS NULL THEN r||jsonb_build_object('store_id',p_branch_id) ELSE r END),'[]'::jsonb) INTO p_rows FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r; IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r WHERE r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_audit_logs(p_rows)+public.sync_delete_audit_logs(p_changes,p_branch_id);$new$;
  v_old_aggregate text := $old$WHEN 'audit_logs' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_audit_logs(v_rows)+public.sync_delete_audit_logs(v_op->'changes',p_branch_id);$old$;
  v_new_aggregate text := $new$WHEN 'audit_logs' THEN SELECT COALESCE(jsonb_agg(CASE WHEN NULLIF(btrim(r->>'store_id'),'') IS NULL THEN r||jsonb_build_object('store_id',p_branch_id) ELSE r END),'[]'::jsonb) INTO v_rows FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r; IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_audit_logs(v_rows)+public.sync_delete_audit_logs(v_op->'changes',p_branch_id);$new$;
BEGIN
  SELECT pg_get_functiondef('public.pos_sync_push_batch(uuid,text,text,text,jsonb,jsonb)'::regprocedure)
    INTO v_batch;
  SELECT pg_get_functiondef('public.pos_sync_push_aggregate(uuid,text,text,jsonb)'::regprocedure)
    INTO v_aggregate;

  IF position(v_new_batch IN v_batch) = 0 THEN
    IF position(v_old_batch IN v_batch) = 0 THEN
      RAISE EXCEPTION 'pos_sync_push_batch has an unexpected audit_logs guard; migration stopped safely';
    END IF;
    EXECUTE replace(v_batch, v_old_batch, v_new_batch);
  END IF;

  IF position(v_new_aggregate IN v_aggregate) = 0 THEN
    IF position(v_old_aggregate IN v_aggregate) = 0 THEN
      RAISE EXCEPTION 'pos_sync_push_aggregate has an unexpected audit_logs guard; migration stopped safely';
    END IF;
    EXECUTE replace(v_aggregate, v_old_aggregate, v_new_aggregate);
  END IF;
END
$migration$;

REVOKE ALL ON FUNCTION public.pos_sync_push_batch(uuid,text,text,text,jsonb,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pos_sync_push_batch(uuid,text,text,text,jsonb,jsonb)
  TO service_role;
REVOKE ALL ON FUNCTION public.pos_sync_push_aggregate(uuid,text,text,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pos_sync_push_aggregate(uuid,text,text,jsonb)
  TO service_role;
