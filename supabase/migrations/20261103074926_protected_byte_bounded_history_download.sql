-- STREAM46 preparation: pure projection equivalent to redactSyncDownload.
-- No visibility decisions are made by this helper. The page RPC must retain
-- the existing guarded history selector and service-only admission.
CREATE OR REPLACE FUNCTION public.pos_sync_history_project_v1(
  p_value jsonb, p_table text DEFAULT '', p_keep_commerce boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE STRICT SECURITY INVOKER
SET search_path = pg_catalog
AS $projection$
DECLARE
  v_row jsonb := p_value;
  v_context text := p_table;
  v_result jsonb := '{}'::jsonb;
  v_price jsonb;
  v_key text;
  v_child jsonb;
  v_number double precision;
BEGIN
  -- The former Worker parsed JSON numbers before serializing the response.
  -- JSON.stringify maps non-finite JavaScript numbers to null. Preserve that
  -- transport behavior for valid PostgreSQL numeric values beyond float8.
  IF pg_catalog.jsonb_typeof(p_value) = 'number' AND pg_catalog.abs((p_value::text)::numeric) > 1 THEN
    BEGIN
      v_number := (p_value::text)::double precision;
    EXCEPTION WHEN numeric_value_out_of_range THEN RETURN 'null'::jsonb;
    END;
  END IF;
  IF pg_catalog.jsonb_typeof(p_value) = 'array' THEN
    SELECT COALESCE(pg_catalog.jsonb_agg(public.pos_sync_history_project_v1(a.value,p_table,p_keep_commerce) ORDER BY a.ordinality),'[]'::jsonb)
      INTO v_result FROM pg_catalog.jsonb_array_elements(p_value) WITH ORDINALITY AS a(value,ordinality);
    RETURN v_result;
  END IF;
  IF pg_catalog.jsonb_typeof(p_value) <> 'object' THEN RETURN p_value; END IF;
  IF NOT p_keep_commerce
     AND (p_table = 'settings_scoped' OR v_row->>'table_name' = 'settings_scoped')
     AND pg_catalog.jsonb_typeof(v_row->'key') = 'string'
     AND pg_catalog.left(v_row->>'key',14) = 'product_price:'
     AND pg_catalog.jsonb_typeof(v_row->'value') IN ('object','array') THEN
    IF pg_catalog.jsonb_typeof(v_row->'value') = 'array' THEN
      SELECT COALESCE(pg_catalog.jsonb_object_agg((a.ordinality-1)::text,a.value),'{}'::jsonb)
        INTO v_price FROM pg_catalog.jsonb_array_elements(v_row->'value') WITH ORDINALITY AS a(value,ordinality);
    ELSE v_price := (v_row->'value') - 'ecom_price'; END IF;
    v_row := pg_catalog.jsonb_set(v_row,ARRAY['value'],v_price,false);
  END IF;
  IF pg_catalog.jsonb_typeof(v_row->'table_name') = 'string' THEN v_context := v_row->>'table_name'; END IF;
  FOR v_key,v_child IN SELECT e.key,e.value FROM pg_catalog.jsonb_each(v_row) AS e LOOP
    IF (v_context = 'terminal_tokens' AND v_key IN ('claim_secret_hash','claim_proof','claimed_proof_hash'))
       OR (NOT p_keep_commerce AND (v_key = 'ecommerceEnabled'
         OR (v_context = 'products' AND v_key IN ('ecom_price','ecom_visible','ecom_enabled','is_published')))) THEN
      CONTINUE;
    END IF;
    v_result := v_result || pg_catalog.jsonb_build_object(v_key,public.pos_sync_history_project_v1(v_child,v_context,p_keep_commerce));
  END LOOP;
  RETURN v_result;
END;
$projection$;
REVOKE ALL ON FUNCTION public.pos_sync_history_project_v1(jsonb,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pos_sync_history_project_v1(jsonb,text,boolean) TO service_role;

-- Pin both existing guarded selectors; an unsupported installer stays usable
-- through the legacy path, but cannot attest a protected streaming response.
DO $install_history_page$
DECLARE
  wrapper text := pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure('public.pos_sync_bootstrap(text,text,text,text,text,integer,integer)'));
  scoped text := pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure('public.pos_sync_bootstrap_scoped(text,text,text,text,text,integer,integer)'));
  normalized text;
  inspected text;
  wrapper_body text;
  scoped_body text;
  scoped_prefix text := $scoped$DECLARE v_rows jsonb:='[]'::jsonb; v_cursor text; v_me public.app_users%ROWTYPE;
BEGIN PERFORM public.pos_sync_validate_read_scope(p_organization_id,p_branch_id,p_terminal_id); IF auth.role()<>'service_role' THEN SELECT * INTO v_me FROM public.app_users WHERE auth_user_id=auth.uid() AND is_active=true LIMIT 1;
 IF v_me.id IS NULL OR NOT (v_me.role='admin' OR COALESCE((v_me.permissions->>'can_manage_sync_backup')::boolean,false)) THEN RAISE EXCEPTION 'SYNC_FORBIDDEN'; END IF;
 IF NOT (v_me.role='admin' OR v_me.store_id IS NULL OR v_me.store_id=p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; END IF;
 CASE p_table$scoped$;
  wrapper_prefix text := $wrapper$DECLARE v_rows jsonb:='[]'::jsonb; v_cursor text; v_me public.app_users%ROWTYPE;
BEGIN
  IF p_table <> 'issued_vouchers' THEN
    RETURN public.pos_sync_bootstrap_scoped(p_organization_id,p_branch_id,p_terminal_id,p_table,p_after_cursor,p_history_days,p_limit);
  END IF;$wrapper$;
  expected text := $case$WHEN 'change_history' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object('id',x."id")::text cursor,x row_data FROM public."change_history" x WHERE (true) AND (p_after_cursor IS NULL OR x."id">((p_after_cursor::jsonb)->>'id')::uuid) ORDER BY x."id" LIMIT LEAST(GREATEST(p_limit,10),2000)) page;$case$;
  supported boolean := false;
  template text := $create$
CREATE OR REPLACE FUNCTION public.pos_sync_history_page_v1(
  p_organization_id text,p_branch_id text,p_terminal_id text,
  p_after_cursor text DEFAULT NULL,p_history_days integer DEFAULT 90,
  p_keep_commerce boolean DEFAULT false,p_max_bytes integer DEFAULT 2097152
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = pg_catalog
AS $page$
DECLARE
  v_raw jsonb;
  v_rows jsonb := '[]'::jsonb;
  v_row jsonb;
  v_projected jsonb;
  v_envelope jsonb;
  v_candidate jsonb;
  v_cursor text;
  v_last_id uuid;
  v_count integer := 0;
  v_total integer;
  v_bytes integer;
  v_hard constant integer := 5242880;
BEGIN
  -- Check before delegation: a minimum-100 legacy source must never allocate
  -- its raw page here. Any future source change requires explicit review.
  IF NOT __SUPPORTED__
     OR pg_catalog.md5(pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure('public.pos_sync_bootstrap(text,text,text,text,text,integer,integer)'))) IS DISTINCT FROM __WRAPPER_HASH__
     OR pg_catalog.md5(pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure('public.pos_sync_bootstrap_scoped(text,text,text,text,text,integer,integer)'))) IS DISTINCT FROM __SCOPED_HASH__ THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='POS_HISTORY_STREAM_UNSUPPORTED_SOURCE';
  END IF;
  IF p_max_bytes IS NULL OR p_max_bytes < 1024 OR p_max_bytes > 2097152 OR p_keep_commerce IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='POS_HISTORY_STREAM_INVALID_ARGUMENT';
  END IF;
  v_raw := public.pos_sync_bootstrap(p_organization_id,p_branch_id,p_terminal_id,'change_history',p_after_cursor,p_history_days,10);
  IF pg_catalog.jsonb_typeof(v_raw->'rows') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='POS_HISTORY_STREAM_INVALID_SOURCE';
  END IF;
  v_total := pg_catalog.jsonb_array_length(v_raw->'rows');
  IF v_total > 10 THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='POS_HISTORY_STREAM_INVALID_SOURCE'; END IF;
  FOR v_row IN SELECT a.value FROM pg_catalog.jsonb_array_elements(v_raw->'rows') AS a(value) LOOP
    v_last_id := (v_row->>'id')::uuid;
    IF v_last_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='POS_HISTORY_STREAM_INVALID_SOURCE'; END IF;
    v_projected := public.pos_sync_history_project_v1(v_row,'change_history',p_keep_commerce);
    v_cursor := CASE WHEN v_count+1=v_total THEN v_raw->>'cursor' ELSE pg_catalog.jsonb_build_object('id',v_last_id)::text END;
    v_candidate := pg_catalog.jsonb_build_object('rows',v_rows||pg_catalog.jsonb_build_array(v_projected),'cursor',v_cursor);
    v_bytes := pg_catalog.octet_length(v_candidate::text);
    IF v_bytes > p_max_bytes AND v_count > 0 THEN EXIT; END IF;
    IF v_bytes > v_hard THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='POS_HISTORY_STREAM_ROW_TOO_LARGE'; END IF;
    v_rows := v_rows||pg_catalog.jsonb_build_array(v_projected);
    v_count := v_count+1;
    v_envelope := v_candidate;
    IF v_bytes > p_max_bytes THEN EXIT; END IF;
  END LOOP;
  IF v_count=0 THEN v_envelope := pg_catalog.jsonb_build_object('rows','[]'::jsonb,'cursor',v_raw->>'cursor'); END IF;
  -- A prefix cut must resume from the last KEPT raw UUID, never the lookahead.
  IF v_count < v_total THEN
    v_envelope := pg_catalog.jsonb_set(v_envelope,ARRAY['cursor'],pg_catalog.to_jsonb(pg_catalog.jsonb_build_object('id',v_rows->(v_count-1)->>'id')::text));
  END IF;
  v_bytes := pg_catalog.octet_length(v_envelope::text);
  IF v_bytes > v_hard THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='POS_HISTORY_STREAM_ROW_TOO_LARGE'; END IF;
  PERFORM pg_catalog.set_config('response.headers',pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object('X-POS-History-Projection','1'),
    pg_catalog.jsonb_build_object('X-POS-History-Bytes',v_bytes::text),
    pg_catalog.jsonb_build_object('X-POS-History-Rows',v_count::text)
  )::text,true);
  RETURN v_envelope;
END;
$page$;
$create$;
BEGIN
  SELECT p.prosrc INTO wrapper_body FROM pg_catalog.pg_proc p
    WHERE p.oid=pg_catalog.to_regprocedure('public.pos_sync_bootstrap(text,text,text,text,text,integer,integer)');
  SELECT p.prosrc INTO scoped_body FROM pg_catalog.pg_proc p
    WHERE p.oid=pg_catalog.to_regprocedure('public.pos_sync_bootstrap_scoped(text,text,text,text,text,integer,integer)');
  normalized := pg_catalog.regexp_replace(COALESCE(scoped,''),'\s','','g');
  inspected := pg_catalog.substring(COALESCE(scoped,''), 'WHEN ''change_history'' THEN[^;]*;');
  supported := inspected IS NOT NULL
    AND pg_catalog.regexp_replace(inspected,'\s','','g')=pg_catalog.regexp_replace(expected,'\s','','g')
    AND pg_catalog.strpos(normalized,'jsonb_array_length(v_rows)>=LEAST(GREATEST(p_limit,10),2000)')>0
    AND pg_catalog.left(pg_catalog.regexp_replace(COALESCE(scoped_body,''),'\s','','g'),pg_catalog.length(pg_catalog.regexp_replace(scoped_prefix,'\s','','g')))
      = pg_catalog.regexp_replace(scoped_prefix,'\s','','g')
    AND pg_catalog.left(pg_catalog.regexp_replace(COALESCE(wrapper_body,''),'\s','','g'),pg_catalog.length(pg_catalog.regexp_replace(wrapper_prefix,'\s','','g')))
      = pg_catalog.regexp_replace(wrapper_prefix,'\s','','g');
  template := pg_catalog.replace(template,'__SUPPORTED__',supported::text);
  template := pg_catalog.replace(template,'__WRAPPER_HASH__',pg_catalog.quote_nullable(pg_catalog.md5(wrapper)));
  template := pg_catalog.replace(template,'__SCOPED_HASH__',pg_catalog.quote_nullable(pg_catalog.md5(scoped)));
  EXECUTE template;
END;
$install_history_page$;
REVOKE ALL ON FUNCTION public.pos_sync_history_page_v1(text,text,text,text,integer,boolean,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pos_sync_history_page_v1(text,text,text,text,integer,boolean,integer) TO service_role;
