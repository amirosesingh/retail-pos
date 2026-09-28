+-- Clearing is a per-user state transition: the immutable event remains in the
-- audit log while it moves from Active Notifications to History.
CREATE OR REPLACE FUNCTION public.pos_set_all_activity_events_cleared(
  p_user_id text,
  p_store_id text DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_count integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.app_users
    WHERE user_id = p_user_id
      AND is_active
  ) THEN
    RAISE EXCEPTION 'Active staff account required';
  END IF;

  UPDATE public.activity_events
     SET cleared_by = array(
       SELECT DISTINCT value
       FROM unnest(cleared_by || p_user_id) AS value
     )
   WHERE (p_store_id IS NULL OR store_id = p_store_id)
     AND NOT (p_user_id = ANY(cleared_by));

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.pos_set_all_activity_events_cleared(text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pos_set_all_activity_events_cleared(text,text)
  TO service_role;

-- Realtime is an acceleration path for authenticated supervisors. Registered
-- PIN-only terminals continue to reconcile through the protected API poll.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'activity_events'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.activity_events;
  END IF;
END $$;
