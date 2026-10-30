-- Additive, service-only sign-in result contract. Existing PIN RPCs remain intact.
-- No credentials, permissions, transactions or stock records are rewritten.
BEGIN;

CREATE OR REPLACE FUNCTION public.verify_terminal_pin_result(p_user_id text, p_pin text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  account public.app_users%rowtype;
  terminal public.cashiers%rowtype;
  attempt_key text;
  state jsonb;
  terminal_hash text;
BEGIN
  IF p_user_id IS NULL OR btrim(p_user_id) = '' OR p_pin IS NULL
     OR length(p_pin) < 4 OR length(p_pin) > 32 THEN
    RETURN jsonb_build_object('status', 'invalid_input');
  END IF;
  SELECT * INTO account FROM public.app_users a
    WHERE lower(a.user_id) = lower(btrim(p_user_id))
       OR lower(a.login_username) = lower(btrim(p_user_id))
       OR lower(a.email) = lower(btrim(p_user_id))
    ORDER BY (lower(a.user_id) = lower(btrim(p_user_id))) DESC, a.id LIMIT 1;
  attempt_key := 'terminal-pin:' || lower(coalesce(account.user_id, btrim(p_user_id)));
  PERFORM pg_advisory_xact_lock(hashtextextended(attempt_key, 0));
  state := public.pin_throttle_status(attempt_key);
  IF coalesce((state->>'locked')::boolean, true) THEN
    RETURN jsonb_build_object('status', 'locked', 'locked_until', state->'locked_until');
  END IF;
  -- Unknown identifiers still consume the durable guessing budget. The hosted
  -- endpoint must not expose account existence from these private statuses.
  IF account.id IS NULL THEN
    state := public.pin_throttle_fail(attempt_key, 5, 900, 300);
    RETURN jsonb_build_object('status', 'invalid');
  END IF;
  IF account.is_active IS NOT TRUE THEN
    RETURN jsonb_build_object('status', 'account_inactive');
  END IF;
  -- Same independent sign-in credential source as the local SQL verifier.
  -- Never fall back to app_users.pin_hash, which belongs to action approval.
  IF account.email LIKE '%@%' AND lower(account.email) NOT LIKE '%@pos-internal.local'
     AND lower(account.email) NOT LIKE '%@pos.local' THEN
    terminal_hash := account.offline_login_pin_hash;
  ELSE
    SELECT * INTO terminal FROM public.cashiers c
      WHERE lower(c.username) = lower(account.user_id) AND c.is_active IS TRUE
      ORDER BY c.updated_at DESC, c.id DESC LIMIT 1;
    terminal_hash := terminal.pin_hash;
  END IF;
  -- pgcrypto's bf provisioner emits $2a$. Unsupported formats have not judged
  -- this PIN and must not consume the guessing budget as an incorrect match.
  IF coalesce(terminal_hash, '') !~ '^[$]2a[$][0-9]{2}[$][./A-Za-z0-9]{53}$' THEN
    RETURN jsonb_build_object('status', 'credential_unavailable');
  END IF;
  IF terminal_hash IS DISTINCT FROM extensions.crypt(p_pin, terminal_hash) THEN
    state := public.pin_throttle_fail(attempt_key, 5, 900, 300);
    RETURN jsonb_build_object('status', 'invalid');
  END IF;
  PERFORM public.pin_throttle_reset(attempt_key);
  UPDATE public.app_users SET last_login_at = now() WHERE id = account.id;
  IF terminal.id IS NOT NULL THEN
    UPDATE public.cashiers SET last_login_at = now() WHERE id = terminal.id;
  END IF;
  RETURN jsonb_build_object('status', 'verified', 'account', jsonb_build_object(
    'user_id', account.user_id, 'full_name', account.full_name, 'role', account.role,
    'store_id', account.store_id, 'email', account.email));
END;
$$;
REVOKE ALL ON FUNCTION public.verify_terminal_pin_result(text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_terminal_pin_result(text,text) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
