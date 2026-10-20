-- Editable sign-in labels must never rename the business identity used by
-- permissions, sales attribution, terminal sessions or approval enrollments.
ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS login_username text;
CREATE UNIQUE INDEX IF NOT EXISTS app_users_login_username_lower_uidx
  ON public.app_users (lower(login_username)) WHERE login_username IS NOT NULL;

CREATE OR REPLACE FUNCTION public.guard_staff_login_identity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public, pg_temp AS $$
DECLARE alias_name text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff-login-identities', 0));
  NEW.login_username := nullif(lower(trim(NEW.login_username)), '');
  alias_name := coalesce(NEW.login_username, lower(NEW.user_id));
  IF NEW.login_username IS NOT NULL AND NEW.login_username <> lower(NEW.user_id)
     AND NEW.login_username !~ '^[a-z0-9._-]{2,40}$' THEN
    RAISE EXCEPTION 'STAFF_LOGIN_USERNAME_INVALID';
  END IF;
  IF EXISTS (SELECT 1 FROM public.app_users a WHERE a.id IS DISTINCT FROM NEW.id
    AND (lower(a.user_id) IN (alias_name, lower(NEW.user_id))
      OR lower(a.login_username) IN (alias_name, lower(NEW.user_id)))) THEN
    RAISE EXCEPTION 'That username is already in use' USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_staff_login_identity ON public.app_users;
CREATE TRIGGER guard_staff_login_identity BEFORE INSERT OR UPDATE OF user_id,login_username
ON public.app_users FOR EACH ROW EXECUTE FUNCTION public.guard_staff_login_identity();
REVOKE ALL ON FUNCTION public.guard_staff_login_identity() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.staff_login_available(p_user_id text,p_login_username text,p_email text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO public,pg_temp AS $$
  SELECT NOT EXISTS (SELECT 1 FROM public.app_users a WHERE lower(a.user_id) <> lower(trim(p_user_id))
    AND (lower(a.user_id)=lower(trim(p_login_username))
      OR lower(a.login_username)=lower(trim(p_login_username))
      OR lower(a.email)=lower(trim(p_email))));
$$;
REVOKE ALL ON FUNCTION public.staff_login_available(text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.staff_login_available(text,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.staff_account_edit(
  p_user_id text,p_login_username text,p_full_name text,p_email text,p_role public.app_role,
  p_role_slug text,p_store_id text,p_is_active boolean,p_auth_user_id uuid,p_terminal_pin text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public,extensions,pg_temp AS $$
DECLARE previous public.app_users%rowtype;
BEGIN
  -- Serialize collision validation and the last-active-admin check.
  PERFORM pg_advisory_xact_lock(hashtextextended('staff-login-identities', 0));
  SELECT * INTO previous FROM public.app_users a WHERE a.user_id=lower(trim(p_user_id)) FOR UPDATE;
  IF previous.id IS NULL OR previous.auth_user_id IS DISTINCT FROM p_auth_user_id THEN
    RAISE EXCEPTION 'Staff authentication identity does not match';
  END IF;
  IF NOT public.staff_login_available(p_user_id,p_login_username,p_email) THEN
    RAISE EXCEPTION 'That username or email is already in use' USING ERRCODE='23505';
  END IF;
  IF previous.role='admin' AND previous.is_active AND (p_role<>'admin' OR NOT p_is_active)
     AND NOT EXISTS (SELECT 1 FROM public.app_users a WHERE a.id<>previous.id AND a.role='admin' AND a.is_active) THEN
    RAISE EXCEPTION 'The last active administrator cannot be disabled or demoted';
  END IF;
  PERFORM public.staff_account_upsert(previous.user_id,p_full_name,p_email,p_role,p_role_slug,
    p_store_id,p_is_active,'',previous.pin_length::smallint,previous.auth_user_id,NULL);
  UPDATE public.app_users SET login_username=nullif(lower(trim(p_login_username)),'') WHERE id=previous.id;
  IF coalesce(p_terminal_pin,'')<>'' THEN
    PERFORM public.staff_account_set_terminal_pin(previous.user_id,p_terminal_pin);
  END IF;
  DELETE FROM public.user_roles WHERE user_id=previous.auth_user_id;
  INSERT INTO public.user_roles(user_id,role) VALUES(previous.auth_user_id,p_role);
END $$;
REVOKE ALL ON FUNCTION public.staff_account_edit(text,text,text,text,public.app_role,text,text,boolean,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.staff_account_edit(text,text,text,text,public.app_role,text,text,boolean,uuid,text) TO service_role;


CREATE OR REPLACE FUNCTION public.verify_terminal_pin(p_user_id text, p_pin text)
RETURNS TABLE(user_id text, full_name text, role public.app_role, store_id text, email text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  account public.app_users%rowtype;
  terminal public.cashiers%rowtype;
  attempt_key text;
  state jsonb;
BEGIN
  SELECT * INTO account FROM public.app_users a
    WHERE lower(a.user_id) = lower(trim(p_user_id))
       OR lower(a.login_username) = lower(trim(p_user_id))
       OR lower(a.email) = lower(trim(p_user_id))
    ORDER BY (lower(a.user_id) = lower(trim(p_user_id))) DESC LIMIT 1;
  attempt_key := 'terminal-pin:' || lower(coalesce(account.user_id, trim(p_user_id)));
  PERFORM pg_advisory_xact_lock(hashtextextended(attempt_key, 0));
  state := public.pin_throttle_status(attempt_key);
  IF coalesce((state->>'locked')::boolean, true) THEN RETURN; END IF;
  IF account.id IS NOT NULL AND account.is_active IS TRUE THEN
    SELECT * INTO terminal FROM public.cashiers c
      WHERE lower(c.username) = lower(account.user_id) AND c.is_active LIMIT 1;
    IF coalesce(terminal.pin_hash, '') <> '' AND p_pin IS NOT NULL
       AND terminal.pin_hash = extensions.crypt(p_pin, terminal.pin_hash) THEN
      PERFORM public.pin_throttle_reset(attempt_key);
      UPDATE public.app_users SET last_login_at = now() WHERE id = account.id;
      UPDATE public.cashiers SET last_login_at = now() WHERE id = terminal.id;
      RETURN QUERY SELECT account.user_id::text, account.full_name::text, account.role,
        account.store_id::text, account.email::text;
      RETURN;
    END IF;
  END IF;
  PERFORM public.pin_throttle_fail(attempt_key, 5, 900, 300);
END
$$;
REVOKE ALL ON FUNCTION public.verify_terminal_pin(text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_terminal_pin(text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.verify_cashier_pin(p_username text, p_pin text)
RETURNS TABLE(id uuid, username text, full_name text, store_id text, permissions jsonb)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_row public.cashiers%rowtype;
  canonical text;
  attempt_key text;
  state jsonb;
BEGIN
  SELECT a.user_id INTO canonical FROM public.app_users a
    WHERE lower(a.user_id) = lower(trim(p_username)) OR lower(a.login_username) = lower(trim(p_username))
       OR lower(a.email) = lower(trim(p_username))
    ORDER BY (lower(a.user_id) = lower(trim(p_username))) DESC LIMIT 1;
  canonical := coalesce(canonical, trim(p_username));
  attempt_key := 'terminal-pin:' || lower(canonical);
  PERFORM pg_advisory_xact_lock(hashtextextended(attempt_key, 0));
  state := public.pin_throttle_status(attempt_key);
  IF coalesce((state->>'locked')::boolean, true) THEN RETURN; END IF;
  SELECT * INTO v_row FROM public.cashiers c
    WHERE lower(c.username) = lower(canonical) AND c.is_active
      AND NOT EXISTS (SELECT 1 FROM public.app_users a
        WHERE lower(a.user_id) = lower(canonical) AND a.is_active IS NOT TRUE)
    LIMIT 1;
  IF v_row.id IS NULL OR coalesce(v_row.pin_hash, '') = '' OR p_pin IS NULL
     OR v_row.pin_hash <> extensions.crypt(p_pin, v_row.pin_hash) THEN
    PERFORM public.pin_throttle_fail(attempt_key, 5, 900, 300);
    RETURN;
  END IF;
  PERFORM public.pin_throttle_reset(attempt_key);
  UPDATE public.cashiers SET last_login_at = now() WHERE public.cashiers.id = v_row.id;
  RETURN QUERY SELECT v_row.id, v_row.username, v_row.full_name,
    v_row.store_id, coalesce(v_row.permissions, '{}'::jsonb);
END
$$;
REVOKE ALL ON FUNCTION public.verify_cashier_pin(text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_cashier_pin(text,text) TO service_role;

NOTIFY pgrst, 'reload schema';
