-- Additive, service-only reader. Apply only after reviewing the exact project.
DO $prerequisite$
DECLARE
  delegate oid := pg_catalog.to_regprocedure('public.pos_sync_feed_page_v2(text,text,text,bigint,boolean,integer)');
BEGIN
  IF current_user <> 'postgres' OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    WHERE p.oid=delegate AND pg_catalog.pg_get_userbyid(p.proowner)='postgres'
      AND pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid))='e6ae49744a5f40816170ff72d59db7f8'
      AND NOT pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE')
      AND NOT pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE')
      AND pg_catalog.has_function_privilege('service_role',p.oid,'EXECUTE')
  ) THEN RAISE EXCEPTION 'POS_FEED_BATCH_UNSUPPORTED_SOURCE'; END IF;
END;
$prerequisite$;
CREATE OR REPLACE FUNCTION public.pos_sync_feed_page_v3(
  p_organization_id text, p_branch_id text, p_terminal_id text, p_after_cursor bigint,
  p_keep_commerce boolean, p_max_bytes integer, p_limit integer
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
AS $feed$
DECLARE
  v_after bigint := p_after_cursor;
  v_cursor bigint;
  v_rows jsonb[] := ARRAY[]::jsonb[];
  v_result jsonb;
  v_chunk jsonb;
  v_row jsonb;
  v_continuation text;
  v_more boolean := true;
  v_seen integer;
  v_chunk_count integer;
  v_count integer := 0;
  v_bytes integer := 2;
  v_candidate_bytes integer;
  v_hard constant integer := 5242880;
BEGIN
  IF pg_catalog.md5(pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
    'public.pos_sync_feed_page_v2(text,text,text,bigint,boolean,integer)'))) IS DISTINCT FROM 'e6ae49744a5f40816170ff72d59db7f8'
  THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='POS_FEED_BATCH_UNSUPPORTED_SOURCE';
  END IF;
  IF p_after_cursor IS NULL OR p_after_cursor<0 OR p_keep_commerce IS NULL OR p_max_bytes IS NULL
    OR p_max_bytes NOT BETWEEN 1024 AND 2097152 OR p_limit IS NULL OR p_limit NOT BETWEEN 10 AND 50
  THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='POS_FEED_BATCH_INVALID_ARGUMENT';
  END IF;

  <<chunks>>
  WHILE v_more LOOP
    -- Keep the existing scoped v2 authorization, raw source bound and privacy
    -- projection. At most one of its ten-row chunks is kept alongside output.
    v_chunk := public.pos_sync_feed_page_v2(
      p_organization_id, p_branch_id, p_terminal_id, v_after, p_keep_commerce,
      GREATEST(1024, p_max_bytes - v_bytes + 2));
    IF pg_catalog.jsonb_typeof(v_chunk) IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='POS_FEED_BATCH_INVALID_SOURCE';
    END IF;
    v_chunk_count := pg_catalog.jsonb_array_length(v_chunk);
    SELECT h.value->>'X-POS-Feed-Continue' INTO STRICT v_continuation
    FROM pg_catalog.jsonb_array_elements(pg_catalog.current_setting('response.headers')::jsonb) h(value)
    WHERE h.value ? 'X-POS-Feed-Continue';
    IF v_continuation IS NULL OR v_continuation NOT IN ('0','1') OR v_chunk_count>10
      OR (v_chunk_count=0 AND v_continuation='1')
    THEN
      RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='POS_FEED_BATCH_INVALID_SOURCE';
    END IF;
    v_more := v_continuation='1';
    v_seen := 0;
    FOR v_row IN SELECT a.value FROM pg_catalog.jsonb_array_elements(v_chunk) a(value) LOOP
      v_seen := v_seen + 1;
      v_cursor := (v_row->>'cursor')::bigint;
      IF v_cursor IS NULL OR v_cursor<=v_after THEN
        RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='POS_FEED_BATCH_INVALID_SOURCE';
      END IF;
      -- jsonb::text renders a comma and space between entries. Recheck the
      -- canonical byte count below before sending its length attestation.
      v_candidate_bytes := v_bytes + pg_catalog.octet_length(v_row::text)
        + CASE WHEN v_count=0 THEN 0 ELSE 2 END;
      IF v_candidate_bytes>p_max_bytes AND v_count>0 THEN
        v_more := true;
        EXIT chunks;
      END IF;
      IF v_candidate_bytes>v_hard THEN
        RAISE EXCEPTION USING ERRCODE='54000', MESSAGE='POS_FEED_STREAM_ROW_TOO_LARGE';
      END IF;
      v_rows := pg_catalog.array_append(v_rows, v_row);
      v_count := v_count + 1;
      v_bytes := v_candidate_bytes;
      v_after := v_cursor;
      IF v_count=p_limit OR v_bytes>=p_max_bytes THEN
        v_more := v_more OR v_seen<v_chunk_count;
        EXIT chunks;
      END IF;
    END LOOP;
  END LOOP;

  v_result := pg_catalog.to_jsonb(v_rows);
  IF pg_catalog.octet_length(v_result::text)<>v_bytes THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='POS_FEED_BATCH_LENGTH_MISMATCH';
  END IF;
  PERFORM pg_catalog.set_config('response.headers', pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object('X-POS-Feed-Projection','1'),
    pg_catalog.jsonb_build_object('X-POS-Feed-Bytes',v_bytes::text),
    pg_catalog.jsonb_build_object('X-POS-Feed-Rows',v_count::text),
    pg_catalog.jsonb_build_object('X-POS-Feed-Continue',CASE WHEN v_more THEN '1' ELSE '0' END)
  )::text,true);
  RETURN v_result;
END;
$feed$;

REVOKE ALL ON FUNCTION public.pos_sync_feed_page_v3(text,text,text,bigint,boolean,integer,integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pos_sync_feed_page_v3(text,text,text,bigint,boolean,integer,integer)
  TO service_role;

NOTIFY pgrst, 'reload schema';
