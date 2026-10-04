-- Terminal sign-in and manager approval are separate credentials. Preserve
-- existing terminal accounts by copying their current hash once, then keep
-- future terminal changes in the legacy-compatible cashiers table only.
INSERT INTO public.cashiers
  (id, username, full_name, pin_hash, store_id, permissions, is_active, role_slug)
SELECT gen_random_uuid(), a.user_id, a.full_name, a.pin_hash, a.store_id,
       COALESCE(a.permissions, '{}'::jsonb), a.is_active, a.role_slug
  FROM public.app_users a
 WHERE a.email LIKE '%@pos-internal.local'
   AND COALESCE(a.pin_hash, '') <> ''
   AND NOT EXISTS (
     SELECT 1 FROM public.cashiers c WHERE lower(c.username)=lower(a.user_id)
   );

CREATE OR REPLACE FUNCTION public.staff_account_set_terminal_pin(p_user_id text, p_pin text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  account public.app_users%rowtype;
  v_pin_hash text;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_perm('can_manage_staff') THEN
    RAISE EXCEPTION 'Staff management permission is required';
  END IF;
  IF length(COALESCE(p_pin, '')) < 4 OR length(p_pin) > 32 THEN
    RAISE EXCEPTION 'TERMINAL_PIN_INVALID';
  END IF;
  SELECT * INTO account FROM public.app_users
   WHERE lower(user_id)=lower(trim(p_user_id)) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'STAFF_NOT_FOUND'; END IF;
  IF account.email NOT LIKE '%@pos-internal.local' THEN
    RAISE EXCEPTION 'TERMINAL_PIN_ACCOUNT_REQUIRED';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(lower(account.user_id)));
  v_pin_hash := extensions.crypt(p_pin, extensions.gen_salt('bf', 10));
  UPDATE public.cashiers
     SET full_name=account.full_name, pin_hash=v_pin_hash, store_id=account.store_id,
         permissions=COALESCE(account.permissions, '{}'::jsonb),
         is_active=account.is_active, role_slug=account.role_slug, updated_at=now()
   WHERE lower(username)=lower(account.user_id);
  IF NOT FOUND THEN
    INSERT INTO public.cashiers
      (id, username, full_name, pin_hash, store_id, permissions, is_active, role_slug)
    VALUES
      (gen_random_uuid(), account.user_id, account.full_name, v_pin_hash, account.store_id,
       COALESCE(account.permissions, '{}'::jsonb), account.is_active, account.role_slug);
  END IF;
END
$$;

REVOKE ALL ON FUNCTION public.staff_account_set_terminal_pin(text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.staff_account_set_terminal_pin(text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.verify_terminal_pin(p_user_id text, p_pin text)
RETURNS TABLE(user_id text, full_name text, role public.app_role, store_id text, email text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  account public.app_users%rowtype;
  terminal public.cashiers%rowtype;
BEGIN
  SELECT * INTO account FROM public.app_users a
   WHERE lower(a.user_id)=lower(trim(p_user_id)) AND a.is_active;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO terminal FROM public.cashiers c
   WHERE lower(c.username)=lower(account.user_id) AND c.is_active LIMIT 1;
  IF NOT FOUND OR COALESCE(terminal.pin_hash, '') = ''
     OR terminal.pin_hash <> extensions.crypt(p_pin, terminal.pin_hash) THEN RETURN; END IF;
  UPDATE public.app_users SET last_login_at=now() WHERE id=account.id;
  UPDATE public.cashiers SET last_login_at=now() WHERE id=terminal.id;
  RETURN QUERY SELECT account.user_id::text, account.full_name::text, account.role,
                      account.store_id::text, account.email::text;
END
$$;

REVOKE ALL ON FUNCTION public.verify_terminal_pin(text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_terminal_pin(text,text) TO service_role;
