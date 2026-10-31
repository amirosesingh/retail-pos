-- SHIFT-15: older deployed entry points validate the terminal but omit the
-- transaction-local branch consumed by the shift ownership postcondition.
-- Preserve each installed routine's other amendments, signature and privileges.
-- Preparation only; exact-project approval is required before live application.
DO $migration$
DECLARE
  routine text;
  signature regprocedure;
  definition text;
  updated text;
  validation constant text := 'PERFORM public.pos_sync_validate_scope(p_organization_id,p_branch_id,p_terminal_id);';
  context_statement constant text := 'PERFORM set_config(''pos.sync_branch'',p_branch_id,true);';
  qualified_context constant text := 'PERFORM pg_catalog.set_config(''pos.sync_branch'',p_branch_id,true);';
  validation_count integer;
  context_count integer;
  context_marker_count integer;
BEGIN
  FOREACH routine IN ARRAY ARRAY[
    'public.pos_sync_push_aggregate(uuid,text,text,text,jsonb)',
    'public.pos_sync_push_batch(uuid,text,text,text,text,jsonb,jsonb)'
  ] LOOP
    signature := to_regprocedure(routine);
    IF signature IS NULL THEN RAISE EXCEPTION 'Missing validated sync entry point: %',routine; END IF;
    definition := pg_get_functiondef(signature);
    validation_count := (length(definition)-length(replace(definition,validation,'')))/length(validation);
    IF validation_count<>1 THEN RAISE EXCEPTION 'Unexpected terminal-validation anchor in %',routine; END IF;

    context_count := (length(definition)-length(replace(definition,context_statement,'')))/length(context_statement)
      + (length(definition)-length(replace(definition,qualified_context,'')))/length(qualified_context);
    context_marker_count := (length(definition)-length(replace(definition,'pos.sync_branch','')))/length('pos.sync_branch');
    IF context_count=1 THEN
      -- Current generated installs already have the right context. Do not
      -- rewrite them or accept a setting that runs before validation.
      IF context_marker_count<>1 THEN RAISE EXCEPTION 'Unexpected existing branch-context logic in %',routine; END IF;
      IF position(CASE WHEN position(qualified_context in definition)>0 THEN qualified_context ELSE context_statement END in definition)
           < position(validation in definition)
      THEN RAISE EXCEPTION 'Branch context precedes terminal validation in %',routine; END IF;
      CONTINUE;
    END IF;
    IF context_count<>0 OR position('pos.sync_branch' in definition)>0 THEN
      RAISE EXCEPTION 'Unexpected existing branch-context logic in %',routine;
    END IF;

    updated := replace(definition,validation,validation||E'\n '||qualified_context);
    IF updated=definition THEN RAISE EXCEPTION 'Could not preserve validated branch context in %',routine; END IF;
    EXECUTE updated;
  END LOOP;
END $migration$;
