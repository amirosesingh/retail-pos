-- PREPARED ONLY: ROSEGILL / pos qhrufhtbeguxydenzfey / postgres.
-- One statement. The migration tool owns the transaction and ledger write.
-- No history row/backfill, grants/policy widening, local schema or cursor reset.
DO $automatic_history_index_upgrade$
DECLARE
 helpers constant jsonb := $helpers$[{"signature":"public.change_history_immutable()","definition_md5":"578cf538eeb44be63e0fe9fec2d98a89","owner":"postgres","acl":"{=X/postgres,postgres=X/postgres,service_role=X/postgres}","config":["search_path=public, pg_temp"],"definer":false,"strict":false,"volatility":"v"},{"signature":"public.pos_sync_history_project_v1(jsonb,text,boolean)","definition_md5":"4633e04e150c350518938f2ba661fca1","owner":"postgres","acl":"{postgres=X/postgres,service_role=X/postgres}","config":["search_path=pg_catalog"],"definer":false,"strict":true,"volatility":"i"},{"signature":"public.pos_sync_validate_read_scope(text,text,text)","definition_md5":"99b7c7e0758c07c45f1abeaec2f40526","owner":"postgres","acl":"{postgres=X/postgres,service_role=X/postgres}","config":["search_path=public, pg_temp"],"definer":true,"strict":false,"volatility":"v"},{"signature":"public.pos_sync_validate_scope(text,text,text)","definition_md5":"6e95ef6efb223c611d6f1bfcc76e6287","acl":"{postgres=X/postgres,service_role=X/postgres}","owner":"postgres","config":["search_path=public, pg_temp"],"strict":false,"definer":true,"volatility":"v"}]$helpers$;
 history_shape constant jsonb := $shape$[{"name":"id","type":"uuid","not_null":true},{"name":"organization_id","type":"text","not_null":true},{"name":"entity_type","type":"text","not_null":true},{"name":"entity_id","type":"text","not_null":true},{"name":"action","type":"text","not_null":true},{"name":"old_value","type":"jsonb","not_null":false},{"name":"new_value","type":"jsonb","not_null":false},{"name":"revision","type":"bigint","not_null":true},{"name":"scope_type","type":"text","not_null":true},{"name":"scope_id","type":"text","not_null":false},{"name":"changed_by","type":"text","not_null":false},{"name":"source_application","type":"text","not_null":true},{"name":"device_id","type":"text","not_null":false},{"name":"terminal_id","type":"text","not_null":false},{"name":"server_timestamp","type":"timestamp with time zone","not_null":true}]$shape$;
 index_ddl constant text := $index_definition$CREATE OR REPLACE FUNCTION public.pos_sync_history_index_v1(
 p_organization_id text,p_branch_id text,p_terminal_id text,p_action text,
 p_after_id uuid DEFAULT NULL,p_upper_id uuid DEFAULT NULL,p_limit integer DEFAULT 1000,
 p_keep_commerce boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $history_index$
DECLARE
 v_upper uuid:=p_upper_id; v_ids jsonb:='[]'::jsonb; v_next uuid; v_more boolean:=false;
 v_count text; v_result jsonb;
BEGIN
 PERFORM public.pos_sync_validate_read_scope(p_organization_id,p_branch_id,p_terminal_id);
 -- Runtime accepts only the same reviewed projection with LF/CRLF storage,
 -- and the captured-live/current-canonical immutable helper body forms.
 -- The migration's existing-source preflight below remains byte-exact.
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('public.pos_sync_history_project_v1(jsonb,text,boolean)')
  AND md5(replace(p.prosrc,chr(13)||chr(10),chr(10)))='a5be97695f3e105ebde271e2f017ddee'
  AND pg_get_userbyid(p.proowner)='postgres' AND p.prorettype='jsonb'::regtype AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql')
  AND NOT p.prosecdef AND p.proisstrict AND p.provolatile='i' AND p.proconfig=ARRAY['search_path=pg_catalog'])
 OR NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('public.change_history_immutable()')
  AND replace(p.prosrc,chr(13)||chr(10),chr(10)) IN (chr(10)||'BEGIN RAISE EXCEPTION ''change_history is append-only''; END ',' BEGIN RAISE EXCEPTION ''change_history is append-only''; END ')
  AND pg_get_userbyid(p.proowner)='postgres' AND p.prorettype='trigger'::regtype AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql')
  AND NOT p.prosecdef AND NOT p.proisstrict AND p.provolatile='v' AND p.proconfig=ARRAY['search_path=public, pg_temp'])
 OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.change_history'::regclass AND tgname='change_history_no_change' AND tgenabled='O'
  AND pg_get_triggerdef(oid)='CREATE TRIGGER change_history_no_change BEFORE DELETE OR UPDATE ON public.change_history FOR EACH ROW EXECUTE FUNCTION change_history_immutable()')
 THEN RAISE EXCEPTION 'HISTORY_INDEX_UNSUPPORTED_SOURCE'; END IF;
 IF p_action IS NULL OR p_action NOT IN ('begin','page','finish') OR p_limit IS NULL OR p_limit<1 OR p_limit>1000 OR p_keep_commerce IS NULL
 OR (p_action='begin' AND (p_after_id IS NOT NULL OR p_upper_id IS NOT NULL))
 OR (p_action='page' AND (p_upper_id IS NULL OR p_after_id>p_upper_id))
 OR (p_action='finish' AND p_after_id IS NOT NULL)
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='HISTORY_INDEX_INVALID_ARGUMENT'; END IF;
 IF p_action='begin' THEN SELECT h.id INTO v_upper FROM public.change_history h ORDER BY h.id DESC LIMIT 1; END IF;
 IF p_action='finish' THEN
  SELECT count(*)::text INTO v_count FROM public.change_history h WHERE v_upper IS NOT NULL AND h.id<=v_upper;
 ELSE
  WITH candidates AS MATERIALIZED (
   SELECT h.id FROM public.change_history h WHERE v_upper IS NOT NULL AND h.id<=v_upper AND (p_after_id IS NULL OR h.id>p_after_id)
   ORDER BY h.id LIMIT p_limit+1
  ), selected AS (SELECT id FROM candidates ORDER BY id LIMIT p_limit)
  SELECT COALESCE((SELECT jsonb_agg(id::text ORDER BY id) FROM selected),'[]'::jsonb),(SELECT count(*) FROM candidates)>p_limit
   INTO v_ids,v_more;
  IF v_more THEN v_next:=(v_ids->>-1)::uuid; END IF;
 END IF;
 v_result:=jsonb_build_object('protocol','history-index-v1','projection','history-project-v1:a5be97695f3e105ebde271e2f017ddee',
  'organization_id',p_organization_id,'branch_id',p_branch_id,'terminal_id',p_terminal_id,'keep_commerce',p_keep_commerce,
  'action',p_action,'upper_id',v_upper,'after_id',p_after_id,'ids',v_ids,'next_id',v_next,'complete',NOT v_more,'range_count',v_count);
 IF octet_length(v_result::text)>131072 THEN RAISE EXCEPTION 'HISTORY_INDEX_OVERSIZED'; END IF;
 PERFORM set_config('response.headers',jsonb_build_array(
  jsonb_build_object('X-POS-History-Reconcile-Version','1'),jsonb_build_object('X-POS-History-Reconcile-Kind','index'),
  jsonb_build_object('X-POS-History-Reconcile-Bytes',octet_length(v_result::text)::text),
  jsonb_build_object('X-POS-History-Reconcile-Rows',jsonb_array_length(v_ids)::text))::text,true);
 RETURN v_result;
END;
$history_index$;$index_definition$;
 rows_ddl constant text := $rows_definition$CREATE OR REPLACE FUNCTION public.pos_sync_history_rows_v1(
 p_organization_id text,p_branch_id text,p_terminal_id text,p_ids jsonb,
 p_keep_commerce boolean DEFAULT false,p_max_bytes integer DEFAULT 2097152
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $history_rows$
DECLARE
 v_id text; v_raw public.change_history%ROWTYPE; v_projected jsonb; v_wire jsonb;
 v_rows jsonb:='[]'::jsonb; v_candidate jsonb; v_result jsonb; v_remaining jsonb; v_count integer:=0; v_bytes integer;
BEGIN
 PERFORM public.pos_sync_validate_read_scope(p_organization_id,p_branch_id,p_terminal_id);
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('public.pos_sync_history_project_v1(jsonb,text,boolean)')
  AND md5(replace(p.prosrc,chr(13)||chr(10),chr(10)))='a5be97695f3e105ebde271e2f017ddee'
  AND pg_get_userbyid(p.proowner)='postgres' AND p.prorettype='jsonb'::regtype AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql')
  AND NOT p.prosecdef AND p.proisstrict AND p.provolatile='i' AND p.proconfig=ARRAY['search_path=pg_catalog'])
 OR NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('public.change_history_immutable()')
  AND replace(p.prosrc,chr(13)||chr(10),chr(10)) IN (chr(10)||'BEGIN RAISE EXCEPTION ''change_history is append-only''; END ',' BEGIN RAISE EXCEPTION ''change_history is append-only''; END ')
  AND pg_get_userbyid(p.proowner)='postgres' AND p.prorettype='trigger'::regtype AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql')
  AND NOT p.prosecdef AND NOT p.proisstrict AND p.provolatile='v' AND p.proconfig=ARRAY['search_path=public, pg_temp'])
 OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.change_history'::regclass AND tgname='change_history_no_change' AND tgenabled='O'
  AND pg_get_triggerdef(oid)='CREATE TRIGGER change_history_no_change BEFORE DELETE OR UPDATE ON public.change_history FOR EACH ROW EXECUTE FUNCTION change_history_immutable()')
 THEN RAISE EXCEPTION 'HISTORY_INDEX_UNSUPPORTED_SOURCE'; END IF;
 IF p_ids IS NULL OR jsonb_typeof(p_ids)<>'array' OR jsonb_array_length(p_ids)<1 OR jsonb_array_length(p_ids)>10
 OR p_keep_commerce IS NULL OR p_max_bytes IS NULL OR p_max_bytes<1024 OR p_max_bytes>2097152
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='HISTORY_ROWS_INVALID_ARGUMENT'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_ids) x(value) WHERE jsonb_typeof(value)<>'string'
   OR (value#>>'{}')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
 OR (SELECT count(DISTINCT value) FROM jsonb_array_elements(p_ids))<>jsonb_array_length(p_ids)
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='HISTORY_ROWS_INVALID_IDS'; END IF;
 FOR v_id IN SELECT value FROM jsonb_array_elements_text(p_ids) LOOP
  SELECT * INTO v_raw FROM public.change_history WHERE id=v_id::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'HISTORY_INDEX_ROW_MISSING'; END IF;
  IF NOT isfinite(v_raw.server_timestamp) OR v_raw.server_timestamp<'0001-01-01T00:00:00Z'::timestamptz
   OR v_raw.server_timestamp>'9999-12-31T23:59:59.999999Z'::timestamptz
   THEN RAISE EXCEPTION 'HISTORY_ROWS_TIMESTAMP_UNSUPPORTED'; END IF;
  v_projected:=public.pos_sync_history_project_v1(to_jsonb(v_raw),'change_history',p_keep_commerce);
  v_wire:=(v_projected-'old_value'-'new_value'-'revision'-'server_timestamp')||jsonb_build_object(
   'old_value_json',CASE WHEN v_projected->'old_value'='null'::jsonb THEN NULL ELSE (v_projected->'old_value')::text END,
   'new_value_json',CASE WHEN v_projected->'new_value'='null'::jsonb THEN NULL ELSE (v_projected->'new_value')::text END,
   'revision',v_raw.revision::text,
   'server_timestamp',to_char(v_raw.server_timestamp AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US')||'0Z');
  SELECT COALESCE(jsonb_agg(value ORDER BY ordinality),'[]'::jsonb) INTO v_remaining
   FROM jsonb_array_elements(p_ids) WITH ORDINALITY x(value,ordinality) WHERE ordinality>v_count+1;
  v_candidate:=jsonb_build_object('protocol','history-rows-v1','projection','history-project-v1:a5be97695f3e105ebde271e2f017ddee',
   'organization_id',p_organization_id,'branch_id',p_branch_id,'terminal_id',p_terminal_id,'keep_commerce',p_keep_commerce,
   'requested_ids',p_ids,'rows',v_rows||jsonb_build_array(v_wire),'remaining_ids',v_remaining);
  v_bytes:=octet_length(v_candidate::text);
  IF v_bytes>p_max_bytes AND v_count>0 THEN EXIT; END IF;
  IF v_bytes>5242880 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='HISTORY_ROWS_SINGLE_ROW_TOO_LARGE'; END IF;
  v_result:=v_candidate;v_rows:=v_rows||jsonb_build_array(v_wire);v_count:=v_count+1;
  IF v_bytes>p_max_bytes THEN EXIT; END IF;
 END LOOP;
 IF v_result IS NULL THEN RAISE EXCEPTION 'HISTORY_ROWS_EMPTY'; END IF;
 PERFORM set_config('response.headers',jsonb_build_array(
  jsonb_build_object('X-POS-History-Reconcile-Version','1'),
  jsonb_build_object('X-POS-History-Reconcile-Kind','rows'),
  jsonb_build_object('X-POS-History-Reconcile-Bytes',octet_length(v_result::text)::text),
  jsonb_build_object('X-POS-History-Reconcile-Rows',v_count::text))::text,true);
 RETURN v_result;
END;
$history_rows$;$rows_definition$;
 feed_ddl constant text := $feed_definition$CREATE OR REPLACE FUNCTION public.pos_sync_history_feed_insert_v1()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $history_feed$
BEGIN
 -- INSERT only. Existing immutable UPDATE/DELETE guards remain untouched.
 INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 VALUES(NEW.organization_id,'global',NULL,'change_history',jsonb_build_object('id',NEW.id)::text,'insert',1,false);
 RETURN NULL;
END;
$history_feed$;$feed_definition$;
 entry jsonb; actual jsonb; signature text; ddl text; tag text; expected_body text; oid_value oid;
 installed integer; round integer;
 trigger_definition constant text := 'CREATE TRIGGER pos_history_feed_insert_v1 AFTER INSERT ON public.change_history FOR EACH ROW EXECUTE FUNCTION pos_sync_history_feed_insert_v1()';
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'HISTORY_INDEX_MIGRATION_OWNER'; END IF;
 PERFORM set_config('search_path','pg_catalog,public',true);
 PERFORM set_config('lock_timeout','3s',true);
 PERFORM set_config('statement_timeout','30s',true);
 LOCK TABLE public.change_history IN SHARE ROW EXCLUSIVE MODE NOWAIT;
 FOR round IN 1..2 LOOP
  FOR entry IN SELECT value FROM jsonb_array_elements(helpers) LOOP
   SELECT jsonb_build_object('owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text,'config',p.proconfig,
    'definer',p.prosecdef,'strict',p.proisstrict,'volatility',p.provolatile),
    md5(pg_get_functiondef(p.oid)) INTO actual,signature FROM pg_proc p WHERE p.oid=to_regprocedure(entry->>'signature');
   IF signature IS DISTINCT FROM entry->>'definition_md5' OR actual IS DISTINCT FROM entry-'signature'-'definition_md5'
    THEN RAISE EXCEPTION 'HISTORY_INDEX_SOURCE_CHANGED: %',entry->>'signature'; END IF;
  END LOOP;
  SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull) ORDER BY a.attnum)
   INTO actual FROM pg_attribute a WHERE a.attrelid='public.change_history'::regclass AND a.attnum>0 AND NOT a.attisdropped;
  IF actual IS DISTINCT FROM history_shape OR NOT EXISTS(SELECT 1 FROM pg_constraint c
   WHERE c.conrelid='public.change_history'::regclass AND c.contype='p' AND c.conkey=ARRAY[1]::smallint[])
   THEN RAISE EXCEPTION 'HISTORY_INDEX_SHAPE_CHANGED'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.change_history'::regclass AND tgname='change_history_no_change' AND tgenabled='O'
    AND pg_get_triggerdef(oid)='CREATE TRIGGER change_history_no_change BEFORE DELETE OR UPDATE ON public.change_history FOR EACH ROW EXECUTE FUNCTION change_history_immutable()')
   OR EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.change_history'::regclass AND NOT tgisinternal AND tgname NOT IN ('change_history_no_change','pos_history_feed_insert_v1'))
   THEN RAISE EXCEPTION 'HISTORY_INDEX_TRIGGER_CHANGED'; END IF;
  installed:=0;
  FOR signature,ddl,tag IN VALUES
   ('public.pos_sync_history_index_v1(text,text,text,text,uuid,uuid,integer,boolean)',index_ddl,'$history_index$'),
   ('public.pos_sync_history_rows_v1(text,text,text,jsonb,boolean,integer)',rows_ddl,'$history_rows$'),
   ('public.pos_sync_history_feed_insert_v1()',feed_ddl,'$history_feed$')
  LOOP
   -- Normalize only our NEW definitions, never an existing helper's pinned bytes.
   ddl:=replace(ddl,chr(13)||chr(10),chr(10));
   expected_body:=split_part(ddl,tag,2);oid_value:=to_regprocedure(signature);
   IF oid_value IS NOT NULL THEN
    SELECT jsonb_build_object('body',p.prosrc,'owner',pg_get_userbyid(p.proowner),'acl',
      (SELECT jsonb_agg(v::text ORDER BY v::text) FROM unnest(p.proacl)v),'config',p.proconfig,
      'definer',p.prosecdef,'strict',p.proisstrict,'volatility',p.provolatile,'kind',p.prokind,'parallel',p.proparallel,
      'leakproof',p.proleakproof,'returns_set',p.proretset,'support_absent',p.prosupport=0,'language',(SELECT lanname FROM pg_language WHERE oid=p.prolang),
      'result',pg_get_function_result(p.oid),'arguments',pg_get_function_arguments(p.oid),'cost',p.procost,'rows',p.prorows)
     INTO actual FROM pg_proc p WHERE p.oid=oid_value;
    IF actual IS DISTINCT FROM jsonb_build_object('body',expected_body,'owner','postgres','acl',jsonb_build_array('postgres=X/postgres','service_role=X/postgres'),
      'config',jsonb_build_array('search_path=pg_catalog, public'),'definer',signature='public.pos_sync_history_feed_insert_v1()','strict',false,'volatility','v',
      'kind','f','parallel','u','leakproof',false,'returns_set',false,'support_absent',true,'language','plpgsql',
      'result',CASE WHEN signature='public.pos_sync_history_feed_insert_v1()' THEN 'trigger' ELSE 'jsonb' END,
      'arguments',CASE signature WHEN 'public.pos_sync_history_feed_insert_v1()' THEN ''
       WHEN 'public.pos_sync_history_index_v1(text,text,text,text,uuid,uuid,integer,boolean)' THEN 'p_organization_id text, p_branch_id text, p_terminal_id text, p_action text, p_after_id uuid DEFAULT NULL::uuid, p_upper_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 1000, p_keep_commerce boolean DEFAULT false'
       ELSE 'p_organization_id text, p_branch_id text, p_terminal_id text, p_ids jsonb, p_keep_commerce boolean DEFAULT false, p_max_bytes integer DEFAULT 2097152' END,
      'cost',100,'rows',0)
     THEN RAISE EXCEPTION 'HISTORY_INDEX_INSTALLED_CHANGED: %',signature; END IF;
    installed:=installed+1;
   END IF;
  END LOOP;
  IF round=2 THEN
   IF installed<>3 THEN RAISE EXCEPTION 'HISTORY_INDEX_INSTALL_INCOMPLETE'; END IF;
   EXIT;
  END IF;
  IF installed=3 THEN
   IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.change_history'::regclass AND tgname='pos_history_feed_insert_v1'
    AND tgenabled='O' AND pg_get_triggerdef(oid)=trigger_definition) THEN RAISE EXCEPTION 'HISTORY_INDEX_REPLAY_TRIGGER_CHANGED'; END IF;
   RETURN;
  END IF;
  IF installed<>0 OR EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.change_history'::regclass AND tgname='pos_history_feed_insert_v1')
   THEN RAISE EXCEPTION 'HISTORY_INDEX_PARTIAL_INSTALL'; END IF;
  EXECUTE replace(index_ddl,chr(13)||chr(10),chr(10));
  EXECUTE replace(rows_ddl,chr(13)||chr(10),chr(10));
  EXECUTE replace(feed_ddl,chr(13)||chr(10),chr(10));
  REVOKE ALL ON FUNCTION public.pos_sync_history_index_v1(text,text,text,text,uuid,uuid,integer,boolean) FROM PUBLIC,anon,authenticated,service_role;
  REVOKE ALL ON FUNCTION public.pos_sync_history_rows_v1(text,text,text,jsonb,boolean,integer) FROM PUBLIC,anon,authenticated,service_role;
  REVOKE ALL ON FUNCTION public.pos_sync_history_feed_insert_v1() FROM PUBLIC,anon,authenticated,service_role;
  GRANT EXECUTE ON FUNCTION public.pos_sync_history_index_v1(text,text,text,text,uuid,uuid,integer,boolean) TO service_role;
  GRANT EXECUTE ON FUNCTION public.pos_sync_history_rows_v1(text,text,text,jsonb,boolean,integer) TO service_role;
  GRANT EXECUTE ON FUNCTION public.pos_sync_history_feed_insert_v1() TO service_role;
  CREATE TRIGGER pos_history_feed_insert_v1 AFTER INSERT ON public.change_history FOR EACH ROW EXECUTE FUNCTION public.pos_sync_history_feed_insert_v1();
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.change_history'::regclass AND tgname='pos_history_feed_insert_v1'
    AND tgenabled='O' AND pg_get_triggerdef(oid)=trigger_definition) THEN RAISE EXCEPTION 'HISTORY_INDEX_INSTALL_TRIGGER_CHANGED'; END IF;
 END LOOP;
END;
$automatic_history_index_upgrade$;

