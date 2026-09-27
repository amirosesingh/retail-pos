-- Change Tracking can revisit a sale_item after its aggregate has already
-- been acknowledged. Validate that row's explicit branch exactly as the
-- aggregate RPC does; do not depend on a separately retained parent sale.
DO $migration$
DECLARE
  v_definition text;
  v_old text := $old$WHEN 'sale_items' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r WHERE NOT EXISTS(SELECT 1 FROM public."sales" p WHERE p."id"::text=r->>'sale_id' AND p.store_id::text=p_branch_id)) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF;$old$;
  v_new text := $new$WHEN 'sale_items' THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r WHERE r->>'branch_id' IS NULL OR r->>'branch_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF;$new$;
BEGIN
  SELECT pg_get_functiondef('public.pos_sync_push_batch(uuid,text,text,text,jsonb,jsonb)'::regprocedure)
    INTO v_definition;

  IF position(v_new IN v_definition) > 0 THEN
    RETURN;
  END IF;
  IF position(v_old IN v_definition) = 0 THEN
    RAISE EXCEPTION 'pos_sync_push_batch has an unexpected sale_items guard; migration stopped safely';
  END IF;

  EXECUTE replace(v_definition, v_old, v_new);
END
$migration$;

REVOKE ALL ON FUNCTION public.pos_sync_push_batch(uuid,text,text,text,jsonb,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pos_sync_push_batch(uuid,text,text,text,jsonb,jsonb)
  TO service_role;
