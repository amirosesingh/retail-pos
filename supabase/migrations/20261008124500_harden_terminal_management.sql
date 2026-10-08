-- Use the explicit terminal-management permission everywhere the UI exposes
-- activation controls, including delegated custom roles.
DROP POLICY IF EXISTS "Supervisors can read tokens" ON public.terminal_tokens;
CREATE POLICY "Supervisors can read tokens"
  ON public.terminal_tokens FOR SELECT TO authenticated
  USING ((SELECT public.has_perm('can_manage_terminals')));

DROP POLICY IF EXISTS "Supervisors can issue tokens" ON public.terminal_tokens;
CREATE POLICY "Supervisors can issue tokens"
  ON public.terminal_tokens FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.has_perm('can_manage_terminals')));

DROP POLICY IF EXISTS "Supervisors can manage tokens" ON public.terminal_tokens;
CREATE POLICY "Supervisors can manage tokens"
  ON public.terminal_tokens FOR UPDATE TO authenticated
  USING ((SELECT public.has_perm('can_manage_terminals')))
  WITH CHECK ((SELECT public.has_perm('can_manage_terminals')));

DROP POLICY IF EXISTS "Supervisors can delete tokens" ON public.terminal_tokens;
CREATE POLICY "Supervisors can delete tokens"
  ON public.terminal_tokens FOR DELETE TO authenticated
  USING ((SELECT public.has_perm('can_manage_terminals')));

-- Reissuing used to insert the replacement and revoke the old token in two
-- client requests. Keep both changes in one transaction so a network failure
-- cannot leave two active registrations for one device.
CREATE OR REPLACE FUNCTION public.terminal_token_reissue(
  p_old_id uuid,
  p_new_id uuid,
  p_created_at timestamptz,
  p_expires_at timestamptz
) RETURNS public.terminal_tokens
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  old_token public.terminal_tokens%ROWTYPE;
  new_token public.terminal_tokens%ROWTYPE;
BEGIN
  IF NOT public.has_perm('can_manage_terminals') THEN
    RAISE EXCEPTION 'TERMINAL_MANAGEMENT_FORBIDDEN';
  END IF;
  SELECT * INTO old_token
    FROM public.terminal_tokens
   WHERE id = p_old_id
     AND status IN ('active', 'used')
     AND revoked_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TERMINAL_TOKEN_NOT_ACTIVE'; END IF;

  INSERT INTO public.terminal_tokens (
    id, location_id, location_name, device_name, platform, status,
    created_at, reissued_at, is_claimed, expires_at
  ) VALUES (
    p_new_id, old_token.location_id, old_token.location_name,
    old_token.device_name, old_token.platform, 'active', p_created_at,
    p_created_at, false, p_expires_at
  ) RETURNING * INTO new_token;

  UPDATE public.terminal_tokens
     SET status = 'revoked', revoked_at = p_created_at, replaced_by = p_new_id
   WHERE id = p_old_id;
  RETURN new_token;
END
$fn$;

REVOKE ALL ON FUNCTION public.terminal_token_reissue(uuid,uuid,timestamptz,timestamptz)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.terminal_token_reissue(uuid,uuid,timestamptz,timestamptz)
  TO authenticated, service_role;

-- The organization-wide voucher wrapper was installed after the general
-- byte-safe paging migration and accidentally restored the old 100-row floor.
-- Preserve callers' 10-row request so large voucher/settings/audit payloads do
-- not make an Electron bootstrap exceed its transport or SQL timeout.
DO $migration$
DECLARE
  signature regprocedure :=
    'public.pos_sync_bootstrap(text,text,text,text,text,integer,integer)'::regprocedure;
  definition text;
  updated text;
BEGIN
  SELECT pg_get_functiondef(signature) INTO definition;
  updated := replace(
    definition,
    'LEAST(GREATEST(p_limit,100),2000)',
    'LEAST(GREATEST(p_limit,10),2000)'
  );
  IF updated = definition THEN
    RAISE EXCEPTION 'Expected voucher bootstrap page clamp was not found in %', signature;
  END IF;
  EXECUTE updated;
END
$migration$;
