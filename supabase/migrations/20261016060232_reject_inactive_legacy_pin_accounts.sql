-- Legacy preparation is retained, with exactly the same account lock key.
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
    WHERE lower(a.user_id) = lower(trim(p_username)) OR lower(a.email) = lower(trim(p_username))
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
