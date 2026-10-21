-- Existing enrolled phones retain their device capability; user permissions
-- and approval rules remain authoritative. New registrations choose explicitly.
DO $capability$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='terminal_tokens' AND column_name='approval_token_enabled') THEN
  ALTER TABLE public.terminal_tokens ADD COLUMN approval_token_enabled boolean NOT NULL DEFAULT false;
  UPDATE public.terminal_tokens SET approval_token_enabled=true WHERE platform IN ('mobile','android','ios');
 END IF;
END $capability$;

CREATE OR REPLACE FUNCTION public.terminal_token_reissue_scoped(
 p_old_id uuid, p_new_id uuid, p_location_id text, p_location_name text,
 p_approval_token_enabled boolean, p_replica_hash text DEFAULT NULL
) RETURNS public.terminal_tokens LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE old_token public.terminal_tokens%ROWTYPE; new_token public.terminal_tokens%ROWTYPE;
 now_at timestamptz := clock_timestamp(); replica boolean;
BEGIN
 IF NOT public.has_perm('can_manage_terminals') THEN RAISE EXCEPTION 'TERMINAL_MANAGEMENT_FORBIDDEN'; END IF;
 SELECT * INTO old_token FROM public.terminal_tokens WHERE id=p_old_id
  AND status IN ('active','used','revoked') AND replaced_by IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'TERMINAL_ALREADY_REPLACED_OR_UNAVAILABLE'; END IF;
 IF p_location_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.stores WHERE id=p_location_id) THEN
  RAISE EXCEPTION 'TERMINAL_BRANCH_UNAVAILABLE';
 END IF;
 replica := p_location_id IS NULL AND old_token.platform IN ('pc','windows');
 IF replica AND coalesce(p_replica_hash,'') !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'INVALID_REPLICA_PROOF'; END IF;
 INSERT INTO public.terminal_tokens (
  id,location_id,location_name,device_name,platform,status,created_at,reissued_at,is_claimed,expires_at,
  management_sync_enabled,management_sync_proof_hash,approval_token_enabled
 ) VALUES (
  p_new_id,p_location_id,CASE WHEN p_location_id IS NULL THEN 'All branches — management' ELSE p_location_name END,
  old_token.device_name,old_token.platform,'active',now_at,now_at,false,now_at + interval '15 minutes',
  replica,CASE WHEN replica THEN p_replica_hash ELSE NULL END,
  coalesce(p_approval_token_enabled,false)
 ) RETURNING * INTO new_token;
 UPDATE public.terminal_tokens SET status='revoked',revoked_at=coalesce(revoked_at,now_at),replaced_by=p_new_id WHERE id=p_old_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'TERMINAL_REPLACEMENT_FORBIDDEN'; END IF;
 RETURN new_token;
END $fn$;
REVOKE ALL ON FUNCTION public.terminal_token_reissue_scoped(uuid,uuid,text,text,boolean,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.terminal_token_reissue_scoped(uuid,uuid,text,text,boolean,text) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.approval_token_state(
  p_op text, p_user_id text, p_terminal_id uuid DEFAULT NULL,
  p_secret text DEFAULT NULL, p_step bigint DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE answer jsonb;
BEGIN
  IF p_op = 'register_verifier' THEN
    IF p_terminal_id IS NULL OR length(coalesce(p_secret,'')) < 300 THEN RAISE EXCEPTION 'Invalid verifier enrollment'; END IF;
    INSERT INTO pos_private.approval_verifiers(terminal_id,public_key) VALUES(p_terminal_id,p_secret)
    ON CONFLICT (terminal_id) DO UPDATE SET public_key=EXCLUDED.public_key;
    answer := 'true'::jsonb;
  ELSIF p_op = 'get_verifier' THEN
    SELECT jsonb_build_object('public_key',v.public_key) INTO answer FROM pos_private.approval_verifiers v WHERE v.terminal_id=p_terminal_id;
  ELSIF p_op = 'enroll' THEN
    IF p_terminal_id IS NULL OR length(coalesce(p_secret,'')) < 40 THEN RAISE EXCEPTION 'Invalid enrollment'; END IF;
    INSERT INTO pos_private.approval_tokens(user_id,terminal_id,secret_ciphertext)
    VALUES(p_user_id,p_terminal_id,p_secret) ON CONFLICT (user_id,terminal_id) DO NOTHING;
    SELECT to_jsonb(t) INTO answer FROM pos_private.approval_tokens t WHERE t.user_id=p_user_id AND t.terminal_id=p_terminal_id;
  ELSIF p_op = 'permissions' THEN
    UPDATE public.app_users a SET permissions=(p_secret::jsonb - 'approval_pin_enabled' - 'approval_totp_enabled') ||
      CASE WHEN a.permissions ? 'approval_pin_enabled' THEN jsonb_build_object('approval_pin_enabled',a.permissions->'approval_pin_enabled') ELSE '{}'::jsonb END ||
      CASE WHEN a.permissions ? 'approval_totp_enabled' THEN jsonb_build_object('approval_totp_enabled',a.permissions->'approval_totp_enabled') ELSE '{}'::jsonb END
      WHERE a.user_id=p_user_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Staff account not found'; END IF;
    answer := 'true'::jsonb;
  ELSIF p_op = 'set_methods' THEN
    IF jsonb_typeof((p_secret::jsonb)->'pin') <> 'boolean' OR jsonb_typeof((p_secret::jsonb)->'totp') <> 'boolean' THEN RAISE EXCEPTION 'Invalid credential methods'; END IF;
    UPDATE public.app_users a SET permissions=coalesce(a.permissions,'{}'::jsonb) || jsonb_build_object(
      'approval_pin_enabled', (p_secret::jsonb)->'pin', 'approval_totp_enabled', (p_secret::jsonb)->'totp'
    ) WHERE a.user_id=p_user_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Staff account not found'; END IF;
    IF NOT ((p_secret::jsonb)->>'totp')::boolean THEN DELETE FROM pos_private.approval_tokens t WHERE t.user_id=p_user_id; END IF;
    answer := 'true'::jsonb;
  ELSIF p_op = 'read_branch' THEN
    SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO answer
      FROM pos_private.approval_tokens t JOIN public.app_users a ON a.user_id=t.user_id
      JOIN public.terminal_tokens k ON k.id=t.terminal_id
      WHERE a.is_active AND a.permissions->>'approval_totp_enabled'='true'
        AND (a.store_id IS NULL OR lower(a.store_id::text)=lower(p_user_id))
        AND k.revoked_at IS NULL AND k.status::text IN ('active','used')
        AND k.approval_token_enabled AND k.platform IN ('mobile','android','ios','pc','windows')
        AND (a.store_id IS NULL OR k.location_id IS NULL OR lower(k.location_id::text)=lower(p_user_id));
  ELSIF p_op = 'read' THEN
    SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO answer FROM pos_private.approval_tokens t WHERE t.user_id=p_user_id;
  ELSIF p_op = 'consume' THEN
    UPDATE pos_private.approval_tokens t SET last_used_step=p_step
      WHERE t.user_id=p_user_id AND t.terminal_id=p_terminal_id AND t.last_used_step<p_step;
    answer := to_jsonb(FOUND);
  ELSIF p_op = 'revoke' THEN
    DELETE FROM pos_private.approval_tokens t WHERE t.user_id=p_user_id;
    answer := 'true'::jsonb;
  ELSE RAISE EXCEPTION 'Unknown credential operation'; END IF;
  RETURN answer;
END $$;
REVOKE ALL ON FUNCTION public.approval_token_state(text,text,uuid,text,bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approval_token_state(text,text,uuid,text,bigint) TO service_role;
