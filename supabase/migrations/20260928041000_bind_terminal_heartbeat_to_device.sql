-- Heartbeats affect the administrator's online/offline verdict, so a leaked
-- token UUID alone must not be able to forge them. Preserve named-argument
-- compatibility for installed clients while adding the device proof.
DROP FUNCTION IF EXISTS public.terminal_token_heartbeat(uuid, boolean, text, boolean);

CREATE OR REPLACE FUNCTION public.terminal_token_heartbeat(
  p_token_id uuid,
  p_activate boolean DEFAULT false,
  p_version text DEFAULT NULL::text,
  p_synced boolean DEFAULT false,
  p_proof_hash text DEFAULT NULL::text
) RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  UPDATE public.terminal_tokens
  SET last_seen_at = now(),
      app_version = coalesce(nullif(btrim(p_version), ''), app_version),
      last_sync_at = CASE WHEN p_synced THEN now() ELSE last_sync_at END,
      activated_at = CASE WHEN p_activate THEN coalesce(activated_at, now()) ELSE activated_at END
  WHERE id = p_token_id
    AND status IN ('active', 'used')
    AND nullif(btrim(coalesce(p_proof_hash, '')), '') IS NOT NULL
    AND coalesce(claim_proof, claimed_proof_hash) = p_proof_hash
$$;

REVOKE ALL ON FUNCTION public.terminal_token_heartbeat(uuid, boolean, text, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.terminal_token_heartbeat(uuid, boolean, text, boolean, text) TO anon;
GRANT EXECUTE ON FUNCTION public.terminal_token_heartbeat(uuid, boolean, text, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.terminal_token_heartbeat(uuid, boolean, text, boolean, text) TO service_role;

DROP POLICY IF EXISTS "Terminals can stamp their heartbeat" ON public.terminal_tokens;
