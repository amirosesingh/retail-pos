-- Seed a fresh tenant's shared defaults without replacing an existing identity.
INSERT INTO public.pos_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Keep the generated sync RPCs intact. Only widen their settings_scoped
-- allowlist to the same GLOBAL / pos_field:* namespace permitted by RLS.
-- Other GLOBAL and CLUSTER rows remain read-only on terminals.
DO $migration$
DECLARE
  routine record;
  definition text;
  section_start integer;
  section_end integer;
  section_text text;
  old_filter text := $filter$(lower(COALESCE(r->>'scope',''))='branch' AND r->>'scope_id'=p_branch_id) OR (lower(COALESCE(r->>'scope',''))='terminal' AND r->>'scope_id'=p_terminal_id)$filter$;
  new_filter text := $filter$(lower(COALESCE(r->>'scope',''))='global' AND r->>'scope_id'='' AND r->>'key' LIKE 'pos_field:%' AND auth.role()='service_role') OR (lower(COALESCE(r->>'scope',''))='branch' AND r->>'scope_id'=p_branch_id) OR (lower(COALESCE(r->>'scope',''))='terminal' AND r->>'scope_id'=p_terminal_id)$filter$;
  updated_count integer := 0;
BEGIN
  FOR routine IN
    SELECT p.oid, p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('pos_sync_push_batch', 'pos_sync_push_aggregate')
      AND pg_get_function_identity_arguments(p.oid) LIKE '%p_terminal_id%'
  LOOP
    definition := pg_get_functiondef(routine.oid);
    section_start := strpos(definition, 'WHEN ''settings_scoped'' THEN');
    IF section_start = 0 THEN
      RAISE EXCEPTION 'The % sync RPC has no settings_scoped case.', routine.proname;
    END IF;
    section_end := strpos(substr(definition, section_start), 'v_count:=public.sync_apply_settings_scoped');
    IF section_end = 0 THEN
      RAISE EXCEPTION 'The % settings_scoped case has changed.', routine.proname;
    END IF;
    section_text := substr(definition, section_start, section_end);
    IF strpos(section_text, new_filter) > 0 THEN
      updated_count := updated_count + 1;
      CONTINUE;
    END IF;
    IF strpos(section_text, old_filter) = 0 THEN
      RAISE EXCEPTION 'The % settings_scoped filter has changed.', routine.proname;
    END IF;
    definition := substr(definition, 1, section_start - 1)
      || replace(section_text, old_filter, new_filter)
      || substr(definition, section_start + section_end);
    EXECUTE definition;
    updated_count := updated_count + 1;
  END LOOP;
  IF updated_count <> 2 THEN
    RAISE EXCEPTION 'Expected both terminal-aware POS sync RPCs; found %.', updated_count;
  END IF;
END
$migration$;
