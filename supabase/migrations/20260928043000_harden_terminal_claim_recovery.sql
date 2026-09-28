-- Bind every new terminal claim to a durable device proof and make a lost
-- claim response recoverable by that same device. The token remains one-time:
-- a different proof cannot reuse it, and revocation always wins.
CREATE OR REPLACE FUNCTION public.terminal_token_claim(
  p_token_id uuid,
  p_device text DEFAULT NULL::text,
  p_proof_hash text DEFAULT NULL::text,
  p_platform text DEFAULT NULL::text,
  p_os text DEFAULT NULL::text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  t public.terminal_tokens%ROWTYPE;
  claimed boolean;
BEGIN
  SELECT * INTO t FROM public.terminal_tokens WHERE id = p_token_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  IF t.status = 'revoked' OR t.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'TERMINAL_TOKEN_REVOKED';
  END IF;
  IF btrim(coalesce(t.location_id, '')) = '' THEN
    RAISE EXCEPTION 'TERMINAL_BRANCH_REQUIRED';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.stores s
    WHERE s.id = t.location_id
      AND (s.deleted_at IS NOT NULL OR s.archived_at IS NOT NULL OR s.is_active IS FALSE)
  ) THEN
    RAISE EXCEPTION 'TERMINAL_BRANCH_INACTIVE';
  END IF;
  IF nullif(btrim(coalesce(p_proof_hash, '')), '') IS NULL THEN
    RAISE EXCEPTION 'TERMINAL_DEVICE_PROOF_REQUIRED';
  END IF;

  IF t.status <> 'active' OR t.claimed_at IS NOT NULL THEN
    IF coalesce(t.claim_proof, t.claimed_proof_hash) = p_proof_hash THEN
      UPDATE public.terminal_tokens SET last_seen_at = now() WHERE id = p_token_id;
      RETURN true;
    END IF;
    RETURN false;
  END IF;

  IF t.expires_at IS NOT NULL AND t.expires_at < now() THEN
    RAISE EXCEPTION 'TERMINAL_TOKEN_EXPIRED';
  END IF;
  IF (t.platform = 'mobile' AND p_platform IS DISTINCT FROM 'android')
     OR (t.platform = 'pc' AND p_platform IS DISTINCT FROM 'electron') THEN
    RAISE EXCEPTION 'TERMINAL_PLATFORM_MISMATCH';
  END IF;

  UPDATE public.terminal_tokens
  SET status = 'used',
      claimed_by_device = left(coalesce(p_device, claimed_by_device), 120),
      claim_proof = p_proof_hash,
      claimed_proof_hash = p_proof_hash,
      claimed_platform = coalesce(nullif(btrim(coalesce(p_platform, '')), ''), claimed_platform),
      claimed_os = coalesce(nullif(btrim(coalesce(p_os, '')), ''), claimed_os),
      is_claimed = true,
      claimed_at = now(),
      activated_at = coalesce(activated_at, now()),
      last_seen_at = now()
  WHERE id = p_token_id AND status = 'active' AND claimed_at IS NULL
  RETURNING true INTO claimed;

  RETURN coalesce(claimed, false);
END;
$$;

REVOKE ALL ON FUNCTION public.terminal_token_claim(uuid, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.terminal_token_claim(uuid, text, text, text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.terminal_token_claim(uuid, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.terminal_token_claim(uuid, text, text, text, text) TO service_role;
