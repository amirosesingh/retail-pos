-- Keep pre-authentication APIs reachable without leaving privileged routines
-- in the Data API's exposed public schema. Public functions are invoker-only
-- wrappers; their tightly scoped implementations live in private.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.coupon_claim_impl(
  _slug text,
  _phone text,
  _full_name text DEFAULT NULL::text,
  _email text DEFAULT NULL::text
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  _c public.coupon_campaigns;
  _member uuid;
  _token text;
  _held integer;
BEGIN
  SELECT * INTO _c FROM public.coupon_campaigns WHERE slug = _slug FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CAMPAIGN_NOT_FOUND'; END IF;
  IF NOT _c.is_active THEN RAISE EXCEPTION 'CAMPAIGN_INACTIVE'; END IF;
  IF _c.starts_at IS NOT NULL AND pg_catalog.now() < _c.starts_at THEN RAISE EXCEPTION 'CAMPAIGN_NOT_STARTED'; END IF;
  IF _c.expires_at IS NOT NULL AND pg_catalog.now() > _c.expires_at THEN RAISE EXCEPTION 'CAMPAIGN_EXPIRED'; END IF;

  _member := public.member_join(_phone, _full_name, _email);

  SELECT pg_catalog.count(*) INTO _held FROM public.issued_vouchers
   WHERE campaign_id = _c.id AND member_id = _member;

  SELECT token_slug INTO _token FROM public.issued_vouchers
   WHERE campaign_id = _c.id AND member_id = _member AND status = 'ISSUED'
   ORDER BY issued_at DESC LIMIT 1;
  IF _token IS NOT NULL THEN RETURN _token; END IF;

  IF _c.max_per_member IS NOT NULL AND _held >= _c.max_per_member THEN
    PERFORM public.coupon_log('BLOCKED', _c, NULL, _member, _phone, NULL, NULL, NULL, NULL, NULL,
      'Per-member limit reached');
    RAISE EXCEPTION 'MEMBER_LIMIT_REACHED';
  END IF;

  IF _c.max_claims IS NOT NULL AND _c.claims_count >= _c.max_claims THEN
    PERFORM public.coupon_log('BLOCKED', _c, NULL, _member, _phone, NULL, NULL, NULL, NULL, NULL,
      'Campaign fully claimed');
    RAISE EXCEPTION 'CAMPAIGN_FULLY_CLAIMED';
  END IF;

  _token := public.voucher_token();
  INSERT INTO public.issued_vouchers (token_slug, campaign_id, member_id, issued_source)
  VALUES (_token, _c.id, _member, 'PUBLIC');

  UPDATE public.coupon_campaigns SET claims_count = claims_count + 1 WHERE id = _c.id;
  PERFORM public.coupon_log('CLAIMED', _c, _token, _member, _phone);
  RETURN _token;
END
$function$;

CREATE OR REPLACE FUNCTION private.terminal_token_claim_impl(
  p_token_id uuid,
  p_device text DEFAULT NULL::text,
  p_proof_hash text DEFAULT NULL::text,
  p_platform text DEFAULT NULL::text,
  p_os text DEFAULT NULL::text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  t public.terminal_tokens%ROWTYPE;
  claimed boolean;
BEGIN
  SELECT * INTO t FROM public.terminal_tokens WHERE id = p_token_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF t.status = 'revoked' OR t.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'TERMINAL_TOKEN_REVOKED'; END IF;
  IF pg_catalog.btrim(coalesce(t.location_id, '')) = '' THEN RAISE EXCEPTION 'TERMINAL_BRANCH_REQUIRED'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.stores s WHERE s.id = t.location_id
      AND (s.deleted_at IS NOT NULL OR s.archived_at IS NOT NULL OR s.is_active IS FALSE)
  ) THEN RAISE EXCEPTION 'TERMINAL_BRANCH_INACTIVE'; END IF;
  IF nullif(pg_catalog.btrim(coalesce(p_proof_hash, '')), '') IS NULL THEN
    RAISE EXCEPTION 'TERMINAL_DEVICE_PROOF_REQUIRED';
  END IF;
  IF nullif(pg_catalog.btrim(coalesce(t.claim_proof, '')), '') IS NOT NULL
     AND pg_catalog.lower(t.claim_proof) <> pg_catalog.lower(p_proof_hash) THEN
    RAISE EXCEPTION 'TERMINAL_DEVICE_PROOF_MISMATCH';
  END IF;
  IF t.status <> 'active' OR t.claimed_at IS NOT NULL THEN
    IF pg_catalog.lower(coalesce(t.claim_proof, t.claimed_proof_hash)) = pg_catalog.lower(p_proof_hash) THEN
      UPDATE public.terminal_tokens SET last_seen_at = pg_catalog.now() WHERE id = p_token_id;
      RETURN true;
    END IF;
    RETURN false;
  END IF;
  IF t.expires_at IS NOT NULL AND t.expires_at < pg_catalog.now() THEN RAISE EXCEPTION 'TERMINAL_TOKEN_EXPIRED'; END IF;
  IF ((t.platform = 'mobile' AND p_platform = 'android') OR (t.platform = 'pc' AND p_platform = 'electron')) IS NOT TRUE THEN
    RAISE EXCEPTION 'TERMINAL_PLATFORM_MISMATCH';
  END IF;
  UPDATE public.terminal_tokens
     SET status = 'used',
         claimed_by_device = pg_catalog.left(coalesce(p_device, claimed_by_device), 120),
         claim_proof = pg_catalog.lower(p_proof_hash),
         claimed_proof_hash = pg_catalog.lower(p_proof_hash),
         claimed_platform = coalesce(nullif(pg_catalog.btrim(coalesce(p_platform, '')), ''), claimed_platform),
         claimed_os = coalesce(nullif(pg_catalog.btrim(coalesce(p_os, '')), ''), claimed_os),
         is_claimed = true,
         claimed_at = pg_catalog.now(),
         activated_at = coalesce(activated_at, pg_catalog.now()),
         last_seen_at = pg_catalog.now()
   WHERE id = p_token_id AND status = 'active' AND claimed_at IS NULL
   RETURNING true INTO claimed;
  RETURN coalesce(claimed, false);
END
$function$;

CREATE OR REPLACE FUNCTION private.terminal_token_heartbeat_impl(
  p_token_id uuid,
  p_activate boolean DEFAULT false,
  p_version text DEFAULT NULL::text,
  p_synced boolean DEFAULT false,
  p_proof_hash text DEFAULT NULL::text
) RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path = ''
AS $function$
  UPDATE public.terminal_tokens
  SET last_seen_at = pg_catalog.now(),
      app_version = coalesce(nullif(pg_catalog.btrim(p_version), ''), app_version),
      last_sync_at = CASE WHEN p_synced THEN pg_catalog.now() ELSE last_sync_at END,
      activated_at = CASE WHEN p_activate THEN coalesce(activated_at, pg_catalog.now()) ELSE activated_at END
  WHERE id = p_token_id
    AND status IN ('active', 'used')
    AND nullif(pg_catalog.btrim(coalesce(p_proof_hash, '')), '') IS NOT NULL
    AND coalesce(claim_proof, claimed_proof_hash) = p_proof_hash
$function$;

CREATE OR REPLACE FUNCTION private.terminal_token_status_impl(p_token_id uuid)
RETURNS TABLE(status text, location_name text, location_id text, is_claimed boolean, expires_at timestamp with time zone)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT t.status,
         coalesce(t.location_name, ''),
         coalesce(t.location_id, ''),
         (t.claimed_at IS NOT NULL OR t.status = 'used'),
         t.expires_at
  FROM public.terminal_tokens t
  WHERE t.id = p_token_id
$function$;

CREATE OR REPLACE FUNCTION private.voucher_by_token_impl(_token text)
RETURNS TABLE(voucher jsonb, campaign jsonb, member_name text, member_code text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT pg_catalog.to_jsonb(v) - 'issued_by' - 'redeemed_by' - 'disabled_by',
         pg_catalog.to_jsonb(c),
         coalesce(m.full_name, ''),
         coalesce(m.member_code, '')
  FROM public.issued_vouchers v
  JOIN public.coupon_campaigns c ON c.id = v.campaign_id
  LEFT JOIN public.members m ON m.id = v.member_id
  WHERE v.token_slug = _token
  LIMIT 1
$function$;

REVOKE ALL ON FUNCTION private.coupon_claim_impl(text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.terminal_token_claim_impl(uuid,text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.terminal_token_heartbeat_impl(uuid,boolean,text,boolean,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.terminal_token_status_impl(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.voucher_by_token_impl(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.coupon_claim_impl(text,text,text,text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.terminal_token_claim_impl(uuid,text,text,text,text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.terminal_token_heartbeat_impl(uuid,boolean,text,boolean,text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.terminal_token_status_impl(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.voucher_by_token_impl(text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.coupon_claim(
  _slug text, _phone text, _full_name text DEFAULT NULL::text, _email text DEFAULT NULL::text
) RETURNS text LANGUAGE sql SECURITY INVOKER SET search_path = ''
AS $wrapper$ SELECT private.coupon_claim_impl(_slug, _phone, _full_name, _email) $wrapper$;

CREATE OR REPLACE FUNCTION public.terminal_token_claim(
  p_token_id uuid, p_device text DEFAULT NULL::text, p_proof_hash text DEFAULT NULL::text,
  p_platform text DEFAULT NULL::text, p_os text DEFAULT NULL::text
) RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path = ''
AS $wrapper$ SELECT private.terminal_token_claim_impl(p_token_id, p_device, p_proof_hash, p_platform, p_os) $wrapper$;

CREATE OR REPLACE FUNCTION public.terminal_token_heartbeat(
  p_token_id uuid, p_activate boolean DEFAULT false, p_version text DEFAULT NULL::text,
  p_synced boolean DEFAULT false, p_proof_hash text DEFAULT NULL::text
) RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path = ''
AS $wrapper$ SELECT private.terminal_token_heartbeat_impl(p_token_id, p_activate, p_version, p_synced, p_proof_hash) $wrapper$;

CREATE OR REPLACE FUNCTION public.terminal_token_status(p_token_id uuid)
RETURNS TABLE(status text, location_name text, location_id text, is_claimed boolean, expires_at timestamp with time zone)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $wrapper$ SELECT * FROM private.terminal_token_status_impl(p_token_id) $wrapper$;

CREATE OR REPLACE FUNCTION public.voucher_by_token(_token text)
RETURNS TABLE(voucher jsonb, campaign jsonb, member_name text, member_code text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $wrapper$ SELECT * FROM private.voucher_by_token_impl(_token) $wrapper$;

REVOKE ALL ON FUNCTION public.coupon_claim(text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.terminal_token_claim(uuid,text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.terminal_token_heartbeat(uuid,boolean,text,boolean,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.terminal_token_status(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.voucher_by_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.coupon_claim(text,text,text,text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.terminal_token_claim(uuid,text,text,text,text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.terminal_token_heartbeat(uuid,boolean,text,boolean,text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.terminal_token_status(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.voucher_by_token(text) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
