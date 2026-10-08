-- Receiving goods and approving their release are separate duties. Earlier
-- installs already have the lifecycle function, so repair its authorization
-- expression in place without changing the rest of the transition contract.
DO $migration$
DECLARE
  v_definition text;
  v_rewritten text;
BEGIN
  SELECT pg_get_functiondef('public.stock_transfers_enforce_lifecycle()'::regprocedure)
    INTO v_definition;

  v_rewritten := replace(
    v_definition,
    E'\n    OR public.has_perm(''can_receive_transfer'')',
    ''
  );

  IF v_rewritten IS DISTINCT FROM v_definition THEN
    EXECUTE v_rewritten;
  END IF;

  SELECT pg_get_functiondef('public.stock_transfers_enforce_lifecycle()'::regprocedure)
    INTO v_definition;
  IF v_definition ILIKE '%can_receive_transfer%' THEN
    RAISE EXCEPTION 'Transfer approval authority repair did not take effect';
  END IF;
END
$migration$;

NOTIFY pgrst, 'reload schema';
