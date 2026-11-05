-- Additive service-only feed response projection; no existing routine is replaced.
CREATE OR REPLACE FUNCTION public.pos_sync_feed_page_v1(
 p_organization_id text,p_branch_id text,p_terminal_id text,
 p_after_cursor bigint DEFAULT 0,p_keep_commerce boolean DEFAULT false,
 p_max_bytes integer DEFAULT 2097152
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path TO pg_catalog AS $function$
DECLARE
 v_raw jsonb; v_rows jsonb := '[]'::jsonb; v_row jsonb; v_projected jsonb; v_candidate jsonb;
 v_previous bigint := p_after_cursor; v_cursor bigint; v_raw_count integer; v_count integer := 0;
 v_bytes integer; v_more boolean; v_hard constant integer := 5242880;
BEGIN
 IF pg_catalog.md5(pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure('public.pos_sync_pull(text,text,text,bigint,integer)'))) IS DISTINCT FROM 'e3171846683edb5d58c7a5291526555a'
 OR pg_catalog.md5(pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure('public.pos_sync_history_project_v1(jsonb,text,boolean)'))) IS DISTINCT FROM '4633e04e150c350518938f2ba661fca1' THEN
  RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='POS_FEED_STREAM_UNSUPPORTED_SOURCE';
 END IF;
 IF p_after_cursor IS NULL OR p_keep_commerce IS NULL OR p_max_bytes IS NULL OR p_max_bytes<1024 OR p_max_bytes>2097152 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='POS_FEED_STREAM_INVALID_ARGUMENT';
 END IF;
 -- The existing delegate alone admits branch/terminal scope and returns its
 -- existing visible records. Its hard lower bound is ten, so request ten.
 SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(f) ORDER BY f.cursor),'[]'::jsonb)
 INTO v_raw FROM public.pos_sync_pull(p_organization_id,p_branch_id,p_terminal_id,p_after_cursor,10) f;
 v_raw_count:=pg_catalog.jsonb_array_length(v_raw);
 IF v_raw_count>10 THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='POS_FEED_STREAM_INVALID_SOURCE'; END IF;
 -- Validate every raw cursor before emitting any prefix; never advance over
 -- malformed source data. JSONB retains exact signed bigint values.
 FOR v_row IN SELECT a.value FROM pg_catalog.jsonb_array_elements(v_raw) a(value) LOOP
  v_cursor:=(v_row->>'cursor')::bigint;
  IF v_cursor IS NULL OR v_cursor<=v_previous THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='POS_FEED_STREAM_INVALID_SOURCE'; END IF;
  v_previous:=v_cursor;
 END LOOP;
 FOR v_row IN SELECT a.value FROM pg_catalog.jsonb_array_elements(v_raw) a(value) LOOP
  v_projected:=public.pos_sync_history_project_v1(v_row,'',p_keep_commerce);
  v_candidate:=v_rows||pg_catalog.jsonb_build_array(v_projected);
  v_bytes:=pg_catalog.octet_length(v_candidate::text);
  IF v_bytes>p_max_bytes AND v_count>0 THEN EXIT; END IF;
  IF v_bytes>v_hard THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='POS_FEED_STREAM_ROW_TOO_LARGE'; END IF;
  v_rows:=v_candidate; v_count:=v_count+1;
  IF v_bytes>p_max_bytes THEN EXIT; END IF;
 END LOOP;
 v_bytes:=pg_catalog.octet_length(v_rows::text);
 v_more:=v_count<v_raw_count OR v_raw_count=10;
 PERFORM pg_catalog.set_config('response.headers',pg_catalog.jsonb_build_array(
  pg_catalog.jsonb_build_object('X-POS-Feed-Projection','1'),
  pg_catalog.jsonb_build_object('X-POS-Feed-Bytes',v_bytes::text),
  pg_catalog.jsonb_build_object('X-POS-Feed-Rows',v_count::text),
  pg_catalog.jsonb_build_object('X-POS-Feed-Continue',CASE WHEN v_more THEN '1' ELSE '0' END)
 )::text,true);
 RETURN v_rows;
END;
$function$;
REVOKE ALL ON FUNCTION public.pos_sync_feed_page_v1(text,text,text,bigint,boolean,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pos_sync_feed_page_v1(text,text,text,bigint,boolean,integer) TO service_role;
