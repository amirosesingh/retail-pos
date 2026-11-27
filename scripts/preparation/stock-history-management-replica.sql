-- Separate, schema-only upgrade for an existing stock-history replica export.
-- Management access uses its verified device proof in the relay and the existing
-- read-only Management branch validator here. Operations remains branch-bound.
BEGIN;
DO $preflight$
BEGIN
  IF to_regprocedure('private.stock_history_replica_scope(text,text)') IS NULL
     OR to_regprocedure('public.pos_stock_history_replica_manifest(text,text)') IS NULL
     OR to_regprocedure('public.pos_stock_history_replica_page(text,text,uuid,integer)') IS NULL
     OR to_regprocedure('public.pos_sync_validate_read_scope(text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'STOCK_HISTORY_MANAGEMENT_REPLICA_PREREQUISITES';
  END IF;
END $preflight$;

CREATE OR REPLACE FUNCTION private.stock_history_replica_scope(p_branch text,p_terminal text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR p_branch IS NULL OR p_terminal IS NULL THEN
  RAISE EXCEPTION 'STOCK_HISTORY_REPLICA_SCOPE_DENIED' USING ERRCODE='42501';
 END IF;

 IF EXISTS(SELECT 1 FROM public.terminal_tokens d WHERE d.id::text=p_terminal AND d.location_id=p_branch
   AND d.platform='pc' AND d.status IN('active','used') AND d.revoked_at IS NULL
   AND (d.is_claimed OR d.claimed_at IS NOT NULL) AND NOT COALESCE(d.management_sync_enabled,false)) THEN
  PERFORM public.pos_sync_validate_scope('default',p_branch,p_terminal);
  RETURN;
 END IF;

 IF NOT EXISTS(SELECT 1 FROM public.terminal_tokens d WHERE d.id::text=p_terminal AND d.location_id IS NULL
   AND d.platform='pc' AND d.status IN('active','used') AND d.revoked_at IS NULL
   AND d.is_claimed AND d.management_sync_enabled AND d.management_sync_proof_hash ~ '^[a-f0-9]{64}$')
  OR NOT EXISTS(SELECT 1 FROM public.stores WHERE id=p_branch) THEN
  RAISE EXCEPTION 'STOCK_HISTORY_REPLICA_SCOPE_DENIED' USING ERRCODE='42501';
 END IF;
 PERFORM public.pos_sync_validate_read_scope('default',p_branch,p_terminal);
END $fn$;
REVOKE ALL ON FUNCTION private.stock_history_replica_scope(text,text) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
