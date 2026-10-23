-- Explicit device capability: NULL caused by a deleted branch must never grant all-branch access.
ALTER TABLE public.terminal_tokens ADD COLUMN IF NOT EXISTS management_sync_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE public.terminal_tokens ADD COLUMN IF NOT EXISTS management_sync_proof_hash text;
DO $constraint$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.terminal_tokens'::regclass AND conname='terminal_management_replica_scope') THEN
  ALTER TABLE public.terminal_tokens ADD CONSTRAINT terminal_management_replica_scope
   CHECK (NOT management_sync_enabled OR (platform='pc' AND location_id IS NULL AND management_sync_proof_hash IS NOT NULL AND management_sync_proof_hash ~ '^[a-f0-9]{64}$'));
 END IF;
END $constraint$;

CREATE OR REPLACE FUNCTION public.pos_sync_validate_read_scope(p_organization_id text,p_branch_id text,p_terminal_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
BEGIN
 IF auth.role()='service_role' AND p_organization_id='default'
 AND EXISTS(SELECT 1 FROM public.stores WHERE id=p_branch_id)
 AND EXISTS(SELECT 1 FROM public.terminal_tokens WHERE id::text=p_terminal_id
   AND platform='pc' AND location_id IS NULL AND management_sync_enabled
   AND is_claimed AND status IN ('active','used') AND revoked_at IS NULL) THEN RETURN; END IF;
 PERFORM public.pos_sync_validate_scope(p_organization_id,p_branch_id,p_terminal_id);
END $fn$;
REVOKE ALL ON FUNCTION public.pos_sync_validate_read_scope(text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pos_sync_validate_read_scope(text,text,text) TO service_role;

-- Keep the existing paging, filtering, retention, and write validators intact.
DO $migration$
DECLARE fn regprocedure; definition text;
BEGIN
 FOREACH fn IN ARRAY ARRAY[
 'public.pos_sync_pull(text,text,text,bigint,integer)'::regprocedure,
 'public.pos_sync_bootstrap(text,text,text,text,text,integer,integer)'::regprocedure,
 'public.pos_sync_bootstrap_scoped(text,text,text,text,text,integer,integer)'::regprocedure,
 'public.pos_sync_counts(text,text,text,integer)'::regprocedure,
 'public.pos_sync_counts_scoped(text,text,text,integer)'::regprocedure
 ] LOOP
  definition := pg_get_functiondef(fn);
  definition := replace(definition,'public.pos_sync_validate_scope(', 'public.pos_sync_validate_read_scope(');
  EXECUTE definition;
 END LOOP;
END $migration$;

CREATE OR REPLACE FUNCTION public.terminal_token_reissue(
 p_old_id uuid,p_new_id uuid,p_created_at timestamptz,p_expires_at timestamptz
) RETURNS public.terminal_tokens LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE old_token public.terminal_tokens%ROWTYPE; new_token public.terminal_tokens%ROWTYPE;
BEGIN
 IF NOT public.has_perm('can_manage_terminals') THEN RAISE EXCEPTION 'TERMINAL_MANAGEMENT_FORBIDDEN'; END IF;
 SELECT * INTO old_token FROM public.terminal_tokens WHERE id=p_old_id AND status IN ('active','used') AND revoked_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'TERMINAL_TOKEN_NOT_ACTIVE'; END IF;
 INSERT INTO public.terminal_tokens (
  id,location_id,location_name,device_name,platform,status,created_at,reissued_at,is_claimed,expires_at,management_sync_enabled,management_sync_proof_hash
 ) VALUES (
  p_new_id,old_token.location_id,old_token.location_name,old_token.device_name,old_token.platform,
  'active',p_created_at,p_created_at,false,p_expires_at,old_token.management_sync_enabled,old_token.management_sync_proof_hash
 ) RETURNING * INTO new_token;
 UPDATE public.terminal_tokens SET status='revoked',revoked_at=p_created_at,replaced_by=p_new_id WHERE id=p_old_id;
 RETURN new_token;
END $fn$;
