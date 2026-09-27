-- A completed Electron checkout sends the sale header and its items in one
-- aggregate. With an equal dependency order, sale_items can be visited before
-- sales. The old guard queried the already-committed sales table, so it
-- rejected a valid same-aggregate item before inserting its parent header.
--
-- sale_items carries its own non-null branch_id. The desktop push worker fills
-- that field only for legacy rows where it is absent; an explicit conflicting
-- branch remains rejected.
DO $migration$
DECLARE
  v_definition text;
  v_old text := $old$WHEN 'sale_items' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE NOT EXISTS(SELECT 1 FROM public."sales" p WHERE p."id"::text=r->>'sale_id' AND p.store_id::text=p_branch_id)) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF;$old$;
  v_new text := $new$WHEN 'sale_items' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) r WHERE r->>'branch_id' IS NULL OR r->>'branch_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF;$new$;
BEGIN
  SELECT pg_get_functiondef('public.pos_sync_push_aggregate(uuid,text,text,jsonb)'::regprocedure)
    INTO v_definition;

  IF position(v_new IN v_definition) > 0 THEN
    RETURN;
  END IF;
  IF position(v_old IN v_definition) = 0 THEN
    RAISE EXCEPTION 'pos_sync_push_aggregate has an unexpected sale_items guard; migration stopped safely';
  END IF;

  EXECUTE replace(v_definition, v_old, v_new);
END
$migration$;

REVOKE ALL ON FUNCTION public.pos_sync_push_aggregate(uuid,text,text,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pos_sync_push_aggregate(uuid,text,text,jsonb)
  TO service_role;
