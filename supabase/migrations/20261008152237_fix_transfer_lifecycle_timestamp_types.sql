-- Legacy transfer lifecycle fields dispatched_at and closed_at are text.
-- Preserve the current trigger body, privileges and approval checks; correct
-- only the two defaults that previously mixed text with timestamptz.
DO $$
DECLARE v_definition text;
BEGIN
  v_definition := pg_get_functiondef('public.stock_transfers_enforce_lifecycle()'::regprocedure);
  v_definition := replace(v_definition,
    'COALESCE(NEW.dispatched_at, now())', 'COALESCE(NEW.dispatched_at, now()::text)');
  v_definition := replace(v_definition,
    'COALESCE(NEW.closed_at, now())', 'COALESCE(NEW.closed_at, now()::text)');
  EXECUTE v_definition;
END $$;
NOTIFY pgrst, 'reload schema';
