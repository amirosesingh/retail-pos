-- Terminal reassignment and token rotation can leave cached BRANCH or TERMINAL
-- settings for the previous scope in SQL Server Change Tracking. Known but
-- unowned scopes are read-only cache entries: discard them. Unknown scope
-- types still fail closed with SYNC_SCOPE_FORBIDDEN.
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
      'IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(%1$s,''[]''::jsonb)) r WHERE NOT (lower(COALESCE(r->>''scope'','''')) IN (''global'',''cluster'') OR (lower(COALESCE(r->>''scope'',''''))=''branch'' AND r->>''scope_id''=p_branch_id) OR (lower(COALESCE(r->>''scope'',''''))=''terminal'' AND r->>''scope_id''=p_terminal_id))) THEN RAISE EXCEPTION ''SYNC_SCOPE_FORBIDDEN''; END IF; SELECT COALESCE(jsonb_agg(r) FILTER (WHERE (lower(COALESCE(r->>''scope'',''''))=''branch'' AND r->>''scope_id''=p_branch_id) OR (lower(COALESCE(r->>''scope'',''''))=''terminal'' AND r->>''scope_id''=p_terminal_id)),''[]''::jsonb) INTO %1$s FROM jsonb_array_elements(COALESCE(%1$s,''[]''::jsonb)) r;',
      rows_variable
    );
    new_guard := format(
      'IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(%1$s,''[]''::jsonb)) r WHERE lower(COALESCE(r->>''scope'','''')) NOT IN (''global'',''cluster'',''branch'',''terminal'')) THEN RAISE EXCEPTION ''SYNC_SCOPE_FORBIDDEN''; END IF; SELECT COALESCE(jsonb_agg(r) FILTER (WHERE (lower(COALESCE(r->>''scope'',''''))=''branch'' AND r->>''scope_id''=p_branch_id) OR (lower(COALESCE(r->>''scope'',''''))=''terminal'' AND r->>''scope_id''=p_terminal_id)),''[]''::jsonb) INTO %1$s FROM jsonb_array_elements(COALESCE(%1$s,''[]''::jsonb)) r;',
      rows_variable
    );
    IF position(old_guard IN definition) = 0 THEN
      RAISE EXCEPTION 'Expected central-cache guard was not found in %', routine_signature;
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
