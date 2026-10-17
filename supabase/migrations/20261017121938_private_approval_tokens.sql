-- Credential secrets stay outside the exposed schema and all POS sync tables.
CREATE SCHEMA IF NOT EXISTS pos_private;
REVOKE ALL ON SCHEMA pos_private FROM PUBLIC, anon, authenticated;
CREATE TABLE IF NOT EXISTS pos_private.approval_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES public.app_users(user_id) ON DELETE CASCADE,
  terminal_id uuid NOT NULL REFERENCES public.terminal_tokens(id) ON DELETE CASCADE,
  secret_ciphertext text NOT NULL,
  last_used_step bigint NOT NULL DEFAULT -1,
  UNIQUE (user_id, terminal_id)
);
ALTER TABLE pos_private.approval_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pos_private.approval_tokens FROM PUBLIC, anon, authenticated;
CREATE TABLE IF NOT EXISTS pos_private.approval_verifiers (
  terminal_id uuid PRIMARY KEY REFERENCES public.terminal_tokens(id) ON DELETE CASCADE,
  public_key text NOT NULL
);
ALTER TABLE pos_private.approval_verifiers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pos_private.approval_verifiers FROM PUBLIC, anon, authenticated;
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
        AND (a.store_id IS NULL OR lower(k.location_id::text)=lower(p_user_id));
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
