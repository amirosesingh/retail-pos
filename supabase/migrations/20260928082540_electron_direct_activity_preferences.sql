-- Electron reads activity directly from its operator-configured Supabase
-- project. Bulk dismissal therefore needs the same authenticated, self-scoped
-- contract as the existing single-event function; the client never supplies
-- another person's identity or an unrestricted branch.
CREATE OR REPLACE FUNCTION public.set_all_activity_events_cleared()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_user_id text;
  v_role public.app_role;
  v_store_id text;
  v_count integer;
BEGIN
  SELECT a.user_id, a.role, a.store_id
    INTO v_user_id, v_role, v_store_id
    FROM public.app_users a
   WHERE a.is_active
     AND (
       a.auth_user_id = (SELECT auth.uid())
       OR lower(a.email) = lower(coalesce((SELECT auth.jwt()) ->> 'email', ''))
     )
   LIMIT 1;

  IF v_user_id IS NULL OR NOT public.has_perm('can_view_audit_trail') THEN
    RAISE EXCEPTION 'A signed-in activity supervisor is required';
  END IF;

  UPDATE public.activity_events
     SET cleared_by = array(
       SELECT DISTINCT value FROM unnest(cleared_by || v_user_id) AS value
     )
   WHERE (v_role = 'admin'::public.app_role OR v_store_id IS NULL OR store_id = v_store_id)
     AND NOT (v_user_id = ANY(cleared_by));

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$fn$;

REVOKE ALL ON FUNCTION public.set_all_activity_events_cleared() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_all_activity_events_cleared() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_all_activity_events_cleared() TO service_role;
