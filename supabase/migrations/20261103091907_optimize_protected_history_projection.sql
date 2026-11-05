-- PROJ47: preserve the protected history projection with set-based aggregation.
-- Replaces only the reviewed service-only helper body; no rows or ACLs change.
DO $upgrade_projection$
DECLARE
  v_routine record;
  v_hash text;
BEGIN
  SELECT p.prosrc,p.prosecdef,p.proisstrict,p.provolatile,p.proconfig
  INTO v_routine FROM pg_catalog.pg_proc p
  WHERE p.oid=pg_catalog.to_regprocedure('public.pos_sync_history_project_v1(jsonb,text,boolean)');
  IF NOT FOUND OR v_routine.prosecdef OR NOT v_routine.proisstrict
    OR v_routine.provolatile<>'i' OR v_routine.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] THEN
    RAISE EXCEPTION 'HISTORY_PROJECTION_REQUIRES_REVIEWED_PREREQUISITE';
  END IF;
  v_hash:=pg_catalog.md5(pg_catalog.replace(v_routine.prosrc,E'\r\n',E'\n'));
  IF v_hash='a5be97695f3e105ebde271e2f017ddee' THEN RETURN; END IF;
  IF v_hash<>'e43c47701fcda3776828f3759361d386' THEN
    RAISE EXCEPTION 'HISTORY_PROJECTION_REQUIRES_REVIEWED_PREREQUISITE';
  END IF;
  EXECUTE $replacement$
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
  v_remove text[];
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
    IF NOT pg_catalog.jsonb_path_exists(p_value,'strict $[*] ? (@.type() == "object" || @.type() == "array" || (@.type() == "number" && (@ > 1e308 || @ < -1e308)))') THEN
      RETURN p_value;
    END IF;
    SELECT COALESCE(pg_catalog.jsonb_agg(CASE pg_catalog.jsonb_typeof(a.value)
      WHEN 'object' THEN public.pos_sync_history_project_v1(a.value,p_table,p_keep_commerce)
      WHEN 'array' THEN public.pos_sync_history_project_v1(a.value,p_table,p_keep_commerce)
      WHEN 'number' THEN CASE WHEN a.value>'1e308'::jsonb OR a.value<'-1e308'::jsonb
        THEN public.pos_sync_history_project_v1(a.value,p_table,p_keep_commerce) ELSE a.value END
      ELSE a.value END ORDER BY a.ordinality),'[]'::jsonb)
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
  v_remove:=CASE WHEN v_context='terminal_tokens' THEN ARRAY['claim_secret_hash','claim_proof','claimed_proof_hash']::text[] ELSE ARRAY[]::text[] END;
  IF NOT p_keep_commerce THEN
    v_remove:=v_remove||ARRAY['ecommerceEnabled']::text[];
    IF v_context='products' THEN v_remove:=v_remove||ARRAY['ecom_price','ecom_visible','ecom_enabled','is_published']::text[]; END IF;
  END IF;
  -- Reuse untouched maps, including their large enclosing images. Materialize
  -- projections once and aggregate only changed children, never every key.
  IF pg_catalog.jsonb_path_exists(v_row,'strict $.* ? (@.type() == "object" || @.type() == "array" || (@.type() == "number" && (@ > 1e308 || @ < -1e308)))') THEN
    WITH children AS MATERIALIZED (
      SELECT e.key,e.value FROM pg_catalog.jsonb_each(v_row) AS e
      WHERE NOT(e.key=ANY(v_remove)) AND CASE pg_catalog.jsonb_typeof(e.value)
        WHEN 'object' THEN true WHEN 'array' THEN true
        WHEN 'number' THEN e.value>'1e308'::jsonb OR e.value<'-1e308'::jsonb ELSE false END
    ), projected AS MATERIALIZED (
      SELECT key,value,public.pos_sync_history_project_v1(value,v_context,p_keep_commerce) AS next_value FROM children
    ) SELECT pg_catalog.jsonb_object_agg(key,next_value) INTO v_result FROM projected WHERE next_value IS DISTINCT FROM value;
    IF v_result IS NOT NULL THEN v_row:=v_row||v_result; END IF;
  END IF;
  IF NOT v_row ?| v_remove THEN RETURN v_row; END IF;
  v_result:=v_row-v_remove;
  RETURN v_result;
END;
$projection$;
$replacement$;
END;
$upgrade_projection$;
