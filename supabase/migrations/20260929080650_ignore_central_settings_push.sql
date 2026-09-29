-- A terminal may cache centrally owned GLOBAL and CLUSTER settings. Older
-- local databases can report those downloaded rows as local SQL Server Change
-- Tracking changes. Ignore those read-only cache rows, but continue rejecting
-- malformed, cross-branch and cross-terminal setting writes.
DO $migration$
DECLARE
  routine_signature text;
  rows_variable text;
  definition text;
  old_guard text;
  new_guard text;
BEGIN
  FOR routine_signature, rows_variable IN
    SELECT * FROM (VALUES
      ('public.pos_sync_push_batch(uuid,text,text,text,text,jsonb,jsonb)', 'p_rows'),
      ('public.pos_sync_push_aggregate(uuid,text,text,text,jsonb)', 'v_rows')
    ) AS routines(signature, rows_name)
  LOOP
    IF to_regprocedure(routine_signature) IS NULL THEN
      RAISE EXCEPTION 'Required synchronization routine is missing: %', routine_signature;
    END IF;

    definition := pg_get_functiondef(to_regprocedure(routine_signature));
    old_guard := format(
      'IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(%1$s,''[]''::jsonb)) r WHERE NOT ((lower(COALESCE(r->>''scope'',''''))=''branch'' AND r->>''scope_id''=p_branch_id) OR (lower(COALESCE(r->>''scope'',''''))=''terminal'' AND r->>''scope_id''=p_terminal_id))) THEN RAISE EXCEPTION ''SYNC_SCOPE_FORBIDDEN''; END IF;',
      rows_variable
    );
    new_guard := format(
      'IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(%1$s,''[]''::jsonb)) r WHERE NOT (lower(COALESCE(r->>''scope'','''')) IN (''global'',''cluster'') OR (lower(COALESCE(r->>''scope'',''''))=''branch'' AND r->>''scope_id''=p_branch_id) OR (lower(COALESCE(r->>''scope'',''''))=''terminal'' AND r->>''scope_id''=p_terminal_id))) THEN RAISE EXCEPTION ''SYNC_SCOPE_FORBIDDEN''; END IF; SELECT COALESCE(jsonb_agg(r) FILTER (WHERE (lower(COALESCE(r->>''scope'',''''))=''branch'' AND r->>''scope_id''=p_branch_id) OR (lower(COALESCE(r->>''scope'',''''))=''terminal'' AND r->>''scope_id''=p_terminal_id)),''[]''::jsonb) INTO %1$s FROM jsonb_array_elements(COALESCE(%1$s,''[]''::jsonb)) r;',
      rows_variable
    );

    IF position(old_guard IN definition) = 0 THEN
      RAISE EXCEPTION 'Expected settings scope guard was not found in %', routine_signature;
    END IF;
    EXECUTE replace(definition, old_guard, new_guard);
  END LOOP;
END
$migration$;

REVOKE ALL ON FUNCTION public.pos_sync_push_batch(uuid,text,text,text,text,jsonb,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pos_sync_push_batch(uuid,text,text,text,text,jsonb,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.pos_sync_push_aggregate(uuid,text,text,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pos_sync_push_aggregate(uuid,text,text,text,jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';
