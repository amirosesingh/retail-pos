-- Prepared for ROSEGILL pos/qhrufhtbeguxydenzfey, database postgres.
-- Exact-project approval required before live application. No business-row DML.
-- Preserve the existing owner only when a newer legacy upload omits/blanks it.
-- Explicit ownership, branch validators, stock, prices, grants and all other
-- routine behavior remain unchanged.
BEGIN;
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='15s';
SET LOCAL search_path=pg_catalog,public;
DO $guard$
DECLARE
 expected_metadata constant jsonb := $metadata${"acl":["postgres=X/postgres","service_role=X/postgres"],"cost":100,"kind":"f","rows":0,"owner":"postgres","config":["search_path=public, pg_temp"],"result":"integer","strict":false,"definer":false,"language":"plpgsql","parallel":"u","arguments":"p_rows jsonb","leakproof":false,"signature":"public.sync_apply_products(jsonb)","volatility":"v","returns_set":false,"support_absent":true}$metadata$;
 before_hash constant text := 'a2f6dc6db0f0b8c045faf7d5f0f309b0';
 after_hash constant text := 'a076aea59e1cc926542052040f20465e';
 old_assignment constant text := '"owner_store_id"=EXCLUDED."owner_store_id"';
 protected_assignment constant text := '"owner_store_id"=COALESCE(NULLIF(btrim(EXCLUDED."owner_store_id"),''''),public."products"."owner_store_id")';
 routine_oid oid; actual jsonb; body text; definition text; original_body text;
BEGIN
 routine_oid:=to_regprocedure('public.sync_apply_products(jsonb)');
 IF routine_oid IS NULL THEN RAISE EXCEPTION 'PRODUCT_OWNER_SYNC_ROUTINE_MISSING';END IF;
 SELECT jsonb_build_object('signature','public.sync_apply_products(jsonb)',
  'owner',pg_get_userbyid(p.proowner),'acl',(SELECT jsonb_agg(x::text ORDER BY x::text) FROM unnest(p.proacl)x),
  'config',to_jsonb(p.proconfig),'strict',p.proisstrict,'definer',p.prosecdef,'volatility',p.provolatile,
  'kind',p.prokind,'parallel',p.proparallel,'leakproof',p.proleakproof,'returns_set',p.proretset,
  'language',(SELECT lanname FROM pg_language WHERE oid=p.prolang),
  'arguments',pg_get_function_arguments(p.oid),'result',pg_get_function_result(p.oid),
  'cost',p.procost,'rows',p.prorows,'support_absent',p.prosupport=0),
  p.prosrc,pg_get_functiondef(p.oid) INTO actual,body,definition FROM pg_proc p WHERE p.oid=routine_oid;
 IF actual IS DISTINCT FROM expected_metadata THEN RAISE EXCEPTION 'PRODUCT_OWNER_SYNC_METADATA_CHANGED';END IF;
 -- Replaying only the exact reviewed corrected body is a no-op.
 IF md5(body)=after_hash THEN
  IF position(old_assignment IN body)>0 OR (length(body)-length(replace(body,protected_assignment,'')))/length(protected_assignment)<>1
   THEN RAISE EXCEPTION 'PRODUCT_OWNER_SYNC_CORRECTED_BODY_CHANGED';END IF;
  RETURN;
 END IF;
 IF md5(body)<>before_hash OR (length(body)-length(replace(body,old_assignment,'')))/length(old_assignment)<>1
  OR position(protected_assignment IN body)>0 THEN RAISE EXCEPTION 'PRODUCT_OWNER_SYNC_SOURCE_CHANGED';END IF;
 original_body:=body;
 -- This CREATE OR REPLACE is generated only from the pinned actual definition.
 -- It changes exactly one assignment and preserves the existing function OID.
 EXECUTE replace(definition,old_assignment,protected_assignment);
 SELECT jsonb_build_object('signature','public.sync_apply_products(jsonb)',
  'owner',pg_get_userbyid(p.proowner),'acl',(SELECT jsonb_agg(x::text ORDER BY x::text) FROM unnest(p.proacl)x),
  'config',to_jsonb(p.proconfig),'strict',p.proisstrict,'definer',p.prosecdef,'volatility',p.provolatile,
  'kind',p.prokind,'parallel',p.proparallel,'leakproof',p.proleakproof,'returns_set',p.proretset,
  'language',(SELECT lanname FROM pg_language WHERE oid=p.prolang),
  'arguments',pg_get_function_arguments(p.oid),'result',pg_get_function_result(p.oid),
  'cost',p.procost,'rows',p.prorows,'support_absent',p.prosupport=0),
  p.prosrc INTO actual,body FROM pg_proc p WHERE p.oid=to_regprocedure('public.sync_apply_products(jsonb)');
 IF to_regprocedure('public.sync_apply_products(jsonb)')::oid IS DISTINCT FROM routine_oid
  OR actual IS DISTINCT FROM expected_metadata OR md5(body)<>after_hash
  OR replace(body,protected_assignment,old_assignment) IS DISTINCT FROM original_body
  THEN RAISE EXCEPTION 'PRODUCT_OWNER_SYNC_UNEXPECTED_CHANGE';END IF;
END;
$guard$;
COMMIT;
