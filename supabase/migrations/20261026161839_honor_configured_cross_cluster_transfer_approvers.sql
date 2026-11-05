-- Cross-cluster release uses the existing configured approver list. Role title
-- alone must never override that list or the assigned transfer permission.
BEGIN;
CREATE OR REPLACE FUNCTION public.may_approve_cross_group_transfer()
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  u record;
  rule public.authorization_actions;
BEGIN
  SELECT * INTO u FROM public.current_app_user();
  IF u.id IS NULL OR NOT COALESCE(u.is_active, false)
     OR NOT public.has_perm('can_approve_transfer') THEN
    RETURN false;
  END IF;

  SELECT * INTO rule FROM public.authorization_actions
   WHERE action_key = 'cross_group_transfer_approval'
     AND scope_type = 'global' AND scope_id = '' LIMIT 1;

  -- Preserve permission-based behavior on older/unconfigured installations.
  -- Cross-cluster transfers still wait for an independent decision in the
  -- existing lifecycle trigger; this does not pre-approve a stock movement.
  IF rule.id IS NULL OR NOT rule.is_enabled THEN RETURN true; END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(COALESCE(rule.allowed_user_ids, ARRAY[]::text[])) AS allowed(value)
    WHERE lower(btrim(value)) IN (
      '!' || lower(COALESCE(u.user_id, '')), '!' || lower(u.id::text)
    )
  ) THEN RETURN false; END IF;

  RETURN EXISTS (
    SELECT 1 FROM unnest(COALESCE(rule.allowed_roles, ARRAY[]::text[])) AS allowed(value)
    WHERE lower(btrim(value)) IN (lower(u.role::text), lower(COALESCE((SELECT a.role_slug FROM public.app_users a WHERE a.id=u.id), '')))
  ) OR EXISTS (
    SELECT 1 FROM unnest(COALESCE(rule.allowed_user_ids, ARRAY[]::text[])) AS allowed(value)
    WHERE lower(btrim(value)) IN (lower(COALESCE(u.user_id, '')), lower(u.id::text))
      AND btrim(value) <> ''
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.may_approve_cross_group_transfer() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.may_approve_cross_group_transfer() TO authenticated, service_role;
COMMIT;
