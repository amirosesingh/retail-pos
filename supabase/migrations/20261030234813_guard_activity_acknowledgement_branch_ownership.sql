-- Additive correction: acknowledgement unions must use the existing event's
-- owner at conflict time, not a branch label supplied in the uploaded snapshot.
-- Preparation only; no events, delivery rules or account grants are rewritten.
-- ACTIVITY_ACK_OWNERSHIP_BEGIN
CREATE OR REPLACE FUNCTION public.sync_apply_activity_events(p_rows jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_temp AS $fn$
DECLARE v_count integer; v_branch text := current_setting('pos.sync_branch',true);
BEGIN
  -- The verified native batch owns this context. Raw rows cannot select a
  -- branch, and management/unregistered/revoked terminals gain no new path.
  PERFORM public.pos_sync_validate_scope('default',v_branch,current_setting('pos.sync_terminal',true));
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r
    WHERE r->>'store_id' IS DISTINCT FROM v_branch) THEN
    RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN';
  END IF;
  INSERT INTO public.activity_events (
    id,event_type,severity,title,message,actor_id,actor_name,actor_role,
    terminal_id,terminal_name,store_id,entity_type,entity_id,amount,meta,
    whatsapp_status,whatsapp_error,client_event_id,created_at,
    previous_state,new_state,cleared_by,branch_id
  )
  SELECT id,event_type,severity,title,message,actor_id,actor_name,actor_role,
    terminal_id,terminal_name,store_id,entity_type,entity_id,amount,meta,
    whatsapp_status,whatsapp_error,client_event_id,created_at,
    previous_state,new_state,cleared_by,branch_id
  FROM jsonb_populate_recordset(NULL::public.activity_events,COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT (id) DO UPDATE SET cleared_by=ARRAY(
    SELECT DISTINCT value FROM unnest(COALESCE(public.activity_events.cleared_by,'{}'::text[]) ||
      COALESCE(EXCLUDED.cleared_by,'{}'::text[])) AS acknowledged(value)
  )
  -- ON CONFLICT locks and checks the actual row, including a concurrent insert.
  -- Unowned/global events keep their existing shared acknowledgement behavior;
  -- their immutable branch and contents are never assigned to the uploader.
  WHERE NULLIF(btrim(public.activity_events.store_id),'') IS NULL
     OR lower(btrim(public.activity_events.store_id))=lower(btrim(v_branch));
  GET DIAGNOSTICS v_count=ROW_COUNT;
  -- A filtered conflict is a refusal, not a successful partial acknowledgement.
  -- Raising here rolls back every row, trigger side effect and batch receipt.
  IF v_count <> jsonb_array_length(COALESCE(p_rows,'[]'::jsonb)) THEN
    RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN';
  END IF;
  RETURN v_count;
END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_activity_events(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sync_apply_activity_events(jsonb) TO service_role;
-- ACTIVITY_ACK_OWNERSHIP_END

NOTIFY pgrst, 'reload schema';
