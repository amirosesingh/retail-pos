-- Acknowledgements are monotonic per recipient. A stale or offline snapshot
-- must never erase another recipient's clear; event contents remain immutable.
CREATE OR REPLACE FUNCTION public.sync_apply_activity_events(p_rows jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_temp AS $fn$
DECLARE v_count integer;
BEGIN
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
  );
  GET DIAGNOSTICS v_count=ROW_COUNT;
  RETURN v_count;
END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_activity_events(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sync_apply_activity_events(jsonb) TO service_role;
