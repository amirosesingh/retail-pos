-- Prepared only: ROSEGILL / bjxgimekljzlnwejuawj / pos qhrufhtbeguxydenzfey / postgres.
-- Complete one missing count in the EXISTING authorized history-read contract.
-- No business-row DML, history-feed backfill, scope/policy or grant changes.
BEGIN;
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='15s';
SET LOCAL search_path=pg_catalog,public;
DO $complete_history_count$
DECLARE
 sources constant jsonb := $sources$[{"signature":"public.pos_sync_bootstrap_scoped(text,text,text,text,text,integer,integer)","body_md5":"89cc3af45418f4b6bed718f10923e0ca","metadata":{"acl":["postgres=X/postgres","service_role=X/postgres"],"cost":100,"kind":"f","rows":0,"owner":"postgres","config":["search_path=public"],"result":"jsonb","strict":false,"definer":true,"language":"plpgsql","parallel":"u","arguments":"p_organization_id text, p_branch_id text, p_terminal_id text, p_table text, p_after_cursor text DEFAULT NULL::text, p_history_days integer DEFAULT 90, p_limit integer DEFAULT 500","leakproof":false,"volatility":"v","returns_set":false,"support_absent":true}},{"signature":"public.pos_sync_counts(text,text,text,integer)","body_md5":"6547d32e1e59640659427bae27ed357f","metadata":{"acl":["postgres=X/postgres","service_role=X/postgres"],"cost":100,"kind":"f","rows":1000,"owner":"postgres","config":["search_path=public, pg_temp"],"result":"TABLE(table_name text, row_count bigint)","strict":false,"definer":true,"language":"plpgsql","parallel":"u","arguments":"p_organization_id text, p_branch_id text, p_terminal_id text, p_history_days integer DEFAULT 90","leakproof":false,"volatility":"v","returns_set":true,"support_absent":true}},{"signature":"public.pos_sync_counts_scoped(text,text,text,integer)","body_md5":"c08c4bf2f3eab6f053a4cc42fb31a2bc","metadata":{"acl":["postgres=X/postgres","service_role=X/postgres"],"cost":100,"kind":"f","rows":1000,"owner":"postgres","config":["search_path=public, pg_temp"],"result":"TABLE(table_name text, row_count bigint)","strict":false,"definer":true,"language":"plpgsql","parallel":"u","arguments":"p_organization_id text, p_branch_id text, p_terminal_id text, p_history_days integer DEFAULT 90","leakproof":false,"volatility":"v","returns_set":true,"support_absent":true}}]$sources$;
 old_hash constant text := '6547d32e1e59640659427bae27ed357f';
 new_hash constant text := 'f5a89946adfbd7611366a7cf3b860b8e';
 old_select constant text := $old$SELECT 'issued_vouchers'::text,count(*)::bigint FROM public.issued_vouchers;$old$;
 new_select constant text := $new$SELECT 'issued_vouchers'::text,count(*)::bigint FROM public.issued_vouchers
    UNION ALL
    SELECT 'change_history'::text,count(*)::bigint FROM public.change_history;$new$;
 history_case constant text := $history$WHEN 'change_history' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."change_history" x WHERE (true)  AND (p_after_cursor IS NULL OR x."id">((p_after_cursor::jsonb)->>'id')::uuid) ORDER BY x."id" LIMIT LEAST(GREATEST(p_limit,10),2000)) page;$history$;
 expected jsonb; actual jsonb; body text; definition text; original_body text;
 wrapper_body text; wrapper_oid oid; routine_oid oid; round integer; replay boolean;
BEGIN
 wrapper_oid:=to_regprocedure('public.pos_sync_counts(text,text,text,integer)');
 IF wrapper_oid IS NULL THEN RAISE EXCEPTION 'HISTORY_COUNT_WRAPPER_MISSING';END IF;
 FOR round IN 1..2 LOOP
  FOR expected IN SELECT value FROM jsonb_array_elements(sources) LOOP
   routine_oid:=to_regprocedure(expected->>'signature');
   IF routine_oid IS NULL THEN RAISE EXCEPTION 'HISTORY_COUNT_SOURCE_MISSING: %',expected->>'signature';END IF;
   SELECT jsonb_build_object(
    'owner',pg_get_userbyid(p.proowner),'acl',(SELECT jsonb_agg(x::text ORDER BY x::text) FROM unnest(p.proacl)x),
    'config',to_jsonb(p.proconfig),'strict',p.proisstrict,'definer',p.prosecdef,'volatility',p.provolatile,
    'kind',p.prokind,'parallel',p.proparallel,'leakproof',p.proleakproof,'returns_set',p.proretset,
    'language',(SELECT lanname FROM pg_language WHERE oid=p.prolang),
    'arguments',pg_get_function_arguments(p.oid),'result',pg_get_function_result(p.oid),
    'cost',p.procost,'rows',p.prorows,'support_absent',p.prosupport=0),
    p.prosrc,pg_get_functiondef(p.oid) INTO actual,body,definition FROM pg_proc p WHERE p.oid=routine_oid;
   IF actual IS DISTINCT FROM expected->'metadata' THEN RAISE EXCEPTION 'HISTORY_COUNT_METADATA_CHANGED: %',expected->>'signature';END IF;
   IF routine_oid=wrapper_oid THEN
    IF (round=1 AND md5(body) NOT IN (old_hash,new_hash)) OR (round=2 AND md5(body)<>new_hash)
     THEN RAISE EXCEPTION 'HISTORY_COUNT_WRAPPER_CHANGED';END IF;
    wrapper_body:=body;
   ELSIF md5(body) IS DISTINCT FROM expected->>'body_md5' THEN
    RAISE EXCEPTION 'HISTORY_COUNT_SOURCE_CHANGED: %',expected->>'signature';
   END IF;
   IF expected->>'signature'='public.pos_sync_counts_scoped(text,text,text,integer)'
    AND (position('public.pos_sync_validate_read_scope(' IN body)=0 OR position('''change_history''' IN body)>0)
    THEN RAISE EXCEPTION 'HISTORY_COUNT_DELEGATE_CHANGED';END IF;
   IF expected->>'signature'='public.pos_sync_bootstrap_scoped(text,text,text,text,text,integer,integer)'
    AND ((length(body)-length(replace(body,history_case,'')))/length(history_case)<>1 OR position('public.pos_sync_validate_read_scope(' IN body)=0)
    THEN RAISE EXCEPTION 'HISTORY_COUNT_SELECTOR_CHANGED';END IF;
  END LOOP;
  IF to_regprocedure('public.pos_sync_counts(text,text,text,integer)')::oid IS DISTINCT FROM wrapper_oid
   THEN RAISE EXCEPTION 'HISTORY_COUNT_WRAPPER_IDENTITY_CHANGED';END IF;
  IF round=2 THEN EXIT;END IF;
  replay:=md5(wrapper_body)=new_hash;
  IF replay THEN
   IF (length(wrapper_body)-length(replace(wrapper_body,new_select,'')))/length(new_select)<>1
    THEN RAISE EXCEPTION 'HISTORY_COUNT_REPLAY_CHANGED';END IF;
   RETURN;
  END IF;
  IF (length(wrapper_body)-length(replace(wrapper_body,old_select,'')))/length(old_select)<>1 OR position('''change_history''' IN wrapper_body)>0
   THEN RAISE EXCEPTION 'HISTORY_COUNT_APPEND_CONTRACT_CHANGED';END IF;
  original_body:=wrapper_body;
  SELECT pg_get_functiondef(wrapper_oid) INTO definition;
  -- Replace only the pinned tail; all existing branches, vouchers and admission
  -- calls stay byte-identical. The history WHERE true scope already exists in
  -- authorized bootstrap; this does not resolve its separately held privacy review.
  EXECUTE replace(definition,old_select,new_select);
  SELECT p.prosrc INTO body FROM pg_proc p WHERE p.oid=wrapper_oid;
  IF md5(body)<>new_hash OR replace(body,new_select,old_select) IS DISTINCT FROM original_body
   THEN RAISE EXCEPTION 'HISTORY_COUNT_UNEXPECTED_CHANGE';END IF;
 END LOOP;
END;
$complete_history_count$;
COMMIT;
