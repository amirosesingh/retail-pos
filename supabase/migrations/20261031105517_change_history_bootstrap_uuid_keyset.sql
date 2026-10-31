-- Performance only: seek the existing UUID primary key in the inspected audit
-- bootstrap case. Preserve its predicates, JSON cursor/rows, limits and grants.
-- Audit visibility and GLOBAL-history policy are deliberately not changed here.
DO $change_history_uuid_keyset$
DECLARE
  signature text := 'public.pos_sync_bootstrap_scoped(text,text,text,text,text,integer,integer)';
  function_id oid;
  definition text;
  original_metadata jsonb;
  current_metadata jsonb;
  marker text := 'WHEN ''change_history'' THEN';
  case_prefix text := 'WHEN ''change_history'' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),''[]''::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT jsonb_build_object(''id'',x."id")::text cursor,x row_data FROM public."change_history" x WHERE (true)  ';
  old_tail text := 'AND (p_after_cursor IS NULL OR jsonb_build_object(''id'',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object(''id'',x."id")::text LIMIT ';
  new_tail text := 'AND (p_after_cursor IS NULL OR x."id">((p_after_cursor::jsonb)->>''id'')::uuid) ORDER BY x."id" LIMIT ';
  case_suffix text;
  inspected_case text;
  start_at integer;
  case_length integer;
  id_attribute smallint;
BEGIN
  function_id := to_regprocedure(signature);
  IF function_id IS NULL THEN RAISE EXCEPTION 'Missing inspected audit bootstrap function'; END IF;
  SELECT attnum INTO id_attribute FROM pg_attribute
    WHERE attrelid=to_regclass('public.change_history') AND attname='id'
      AND NOT attisdropped AND attnotnull AND atttypid='uuid'::regtype;
  IF id_attribute IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
      JOIN pg_am am ON am.oid=c.relam
    WHERE i.indrelid=to_regclass('public.change_history') AND i.indisunique
      AND i.indisvalid AND i.indisready AND i.indnatts=1
      AND i.indkey::text=id_attribute::text AND i.indexprs IS NULL
      AND i.indpred IS NULL AND am.amname='btree'
  ) THEN RAISE EXCEPTION 'Unrecognized audit UUID index contract'; END IF;

  SELECT pg_get_functiondef(p.oid),to_jsonb(p)-'prosrc'
    INTO definition,original_metadata FROM pg_proc p WHERE p.oid=function_id;
  IF array_length(string_to_array(definition,marker),1)<>2 THEN
    RAISE EXCEPTION 'Missing or duplicate inspected audit bootstrap case';
  END IF;
  start_at := strpos(definition,marker);
  case_length := strpos(substring(definition FROM start_at),';');
  IF case_length=0 THEN RAISE EXCEPTION 'Incomplete inspected audit bootstrap case'; END IF;
  inspected_case := substring(definition FROM start_at FOR case_length);
  IF right(inspected_case,length('LEAST(GREATEST(p_limit,10),2000)) page;'))='LEAST(GREATEST(p_limit,10),2000)) page;' THEN
    case_suffix := 'LEAST(GREATEST(p_limit,10),2000)) page;';
  ELSIF right(inspected_case,length('LEAST(GREATEST(p_limit,100),2000)) page;'))='LEAST(GREATEST(p_limit,100),2000)) page;' THEN
    case_suffix := 'LEAST(GREATEST(p_limit,100),2000)) page;';
  ELSE RAISE EXCEPTION 'Unrecognized audit bootstrap page limit'; END IF;

  IF inspected_case=case_prefix||old_tail||case_suffix THEN
    definition := overlay(definition PLACING case_prefix||new_tail||case_suffix FROM start_at FOR case_length);
    EXECUTE definition;
  ELSIF inspected_case<>case_prefix||new_tail||case_suffix THEN
    RAISE EXCEPTION 'Unrecognized audit bootstrap read contract';
  END IF;
  SELECT to_jsonb(p)-'prosrc' INTO current_metadata FROM pg_proc p WHERE p.oid=function_id;
  IF current_metadata IS DISTINCT FROM original_metadata THEN
    RAISE EXCEPTION 'Audit bootstrap function metadata changed';
  END IF;
END $change_history_uuid_keyset$;
