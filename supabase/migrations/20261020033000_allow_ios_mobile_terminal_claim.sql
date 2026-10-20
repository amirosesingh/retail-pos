-- iOS uses the same mobile token family as Android. Retain every existing
-- proof, branch, expiry and single-use guard; no public grants are changed.
BEGIN;
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
  IF ((t.platform = 'mobile' AND p_platform IN ('android', 'ios')) OR (t.platform = 'pc' AND p_platform = 'electron')) IS NOT TRUE THEN
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

COMMIT;
