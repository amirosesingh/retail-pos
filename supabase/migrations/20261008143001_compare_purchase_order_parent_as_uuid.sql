-- SQL Server GUID strings may be uppercase. Compare purchase-order foreign
-- keys as UUIDs so a valid same-branch parent is not mistaken for a missing
-- parent. Keep every caller, terminal, branch and idempotency check intact.
DO $migration$
DECLARE
  v_function record;
  v_definition text;
  v_old constant text := $old$p."id"::text=r->>'po_id'$old$;
  v_new constant text := $new$p."id"=(r->>'po_id')::uuid$new$;
BEGIN
  FOR v_function IN
    SELECT p.oid FROM pg_catalog.pg_proc p
    WHERE p.pronamespace='public'::regnamespace
      AND p.proname IN ('pos_sync_push_batch','pos_sync_push_aggregate')
  LOOP
    v_definition := pg_catalog.pg_get_functiondef(v_function.oid);
    IF position(v_old IN v_definition)=0 AND position(v_new IN v_definition)=0 THEN
      RAISE EXCEPTION 'Expected purchase-order parent guard missing in %', v_function.oid::regprocedure;
    END IF;
    v_definition := replace(v_definition,v_old,v_new);
    -- The legacy ownership guard must also recognize an uppercase order id
    -- before checking that an existing order belongs to this branch.
    v_definition := replace(v_definition,
      $old$existing.id::text=r->>'id'$old$,
      $new$existing.id=(r->>'id')::uuid$new$);
    EXECUTE v_definition;
  END LOOP;
END
$migration$;

NOTIFY pgrst, 'reload schema';
