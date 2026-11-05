-- A newer legacy replica may omit the owner that management repaired centrally.
-- Preserve existing ownership only for NULL/blank upload values. No row rewrite,
-- grant change, stock write or checkout routine change is performed here.
BEGIN;
DO $patch$
DECLARE definition text;
  old_assignment text := '"owner_store_id"=EXCLUDED."owner_store_id"';
  protected_assignment text := '"owner_store_id"=COALESCE(NULLIF(btrim(EXCLUDED."owner_store_id"),''''),public."products"."owner_store_id")';
BEGIN
  definition := pg_get_functiondef('public.sync_apply_products(jsonb)'::regprocedure);
  IF position(protected_assignment IN definition)>0 THEN RETURN; END IF;
  IF (length(definition)-length(replace(definition,old_assignment,'')))/length(old_assignment) <> 1
  THEN RAISE EXCEPTION 'Unexpected product sync owner assignment; inspect before applying'; END IF;
  EXECUTE replace(definition,old_assignment,protected_assignment);
END $patch$;
COMMIT;
