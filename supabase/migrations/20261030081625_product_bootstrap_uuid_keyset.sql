-- Read-only performance correction for two UUID-keyed bootstrap cases only.
-- Preserve catalogue predicates, returned JSON cursors, grants and page limits.
-- The live minimum is 10; legacy fresh-install definitions may still use 100.
BEGIN;
DO $product_uuid_keyset$
DECLARE
  signature text := 'public.pos_sync_bootstrap_scoped(text,text,text,text,text,integer,integer)';
  definition text;
  original_definition text;
  table_name text;
  start_at integer;
  end_at integer;
  old_case text;
  new_case text;
  old_tail text := 'AND (p_after_cursor IS NULL OR jsonb_build_object(''id'',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object(''id'',x."id")::text LIMIT ';
  new_tail text := 'AND (p_after_cursor IS NULL OR x."id">((p_after_cursor::jsonb)->>''id'')::uuid) ORDER BY x."id" LIMIT ';
BEGIN
  SELECT pg_get_functiondef(signature::regprocedure) INTO definition;
  original_definition := definition;
  FOREACH table_name IN ARRAY ARRAY['products','product_barcodes'] LOOP
    start_at := strpos(definition, format('WHEN %L THEN',table_name));
    IF start_at = 0 THEN RAISE EXCEPTION 'Missing inspected bootstrap case: %',table_name; END IF;
    end_at := strpos(substring(definition FROM start_at),';');
    IF end_at = 0 THEN RAISE EXCEPTION 'Incomplete bootstrap case: %',table_name; END IF;
    old_case := substring(definition FROM start_at FOR end_at);
    IF strpos(old_case,format('FROM public."%s" x',table_name)) = 0
      OR strpos(old_case,'jsonb_build_object(''id'',x."id")::text cursor') = 0
      OR strpos(old_case,'public.product_available_in_catalogue(') = 0
      OR (strpos(old_case,'LIMIT LEAST(GREATEST(p_limit,100),2000)') = 0
          AND strpos(old_case,'LIMIT LEAST(GREATEST(p_limit,10),2000)') = 0)
    THEN RAISE EXCEPTION 'Unrecognized bootstrap read contract: %',table_name; END IF;
    IF strpos(old_case,old_tail)>0 THEN
      new_case := replace(old_case,old_tail,new_tail);
      definition := overlay(definition PLACING new_case FROM start_at FOR end_at);
    ELSIF strpos(old_case,new_tail)=0 THEN
      RAISE EXCEPTION 'Unrecognized bootstrap keyset contract: %',table_name;
    END IF;
  END LOOP;
  IF definition <> original_definition THEN EXECUTE definition; END IF;
END $product_uuid_keyset$;
NOTIFY pgrst, 'reload schema';
COMMIT;
