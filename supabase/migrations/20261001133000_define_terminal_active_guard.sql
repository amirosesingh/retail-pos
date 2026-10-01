CREATE OR REPLACE FUNCTION public.is_terminal_active()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.app_users a
    WHERE a.is_active
      AND (
        a.auth_user_id = (SELECT auth.uid())
        OR lower(a.email) = lower(coalesce((SELECT auth.jwt()) ->> 'email', ''))
      )
  )
$$;

REVOKE ALL ON FUNCTION public.is_terminal_active() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_terminal_active() TO authenticated, service_role;

-- Reconciliation rows contain expected and counted cash values. Keep the
-- underlying table private and expose only the permission-redacted RPC.
ALTER FUNCTION public.shift_reconciliation_view(uuid) SECURITY DEFINER;
DROP POLICY IF EXISTS "Permission holders read shift reconciliations"
  ON public.shift_reconciliations;
