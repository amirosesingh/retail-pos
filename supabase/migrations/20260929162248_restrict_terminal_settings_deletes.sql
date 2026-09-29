-- Terminals may delete only their own branch- or terminal-scoped settings.
-- Global, cluster, another branch and another terminal remain read-only.
CREATE OR REPLACE FUNCTION public.sync_delete_settings_overrides(
  p_changes jsonb,
  p_branch_id text,
  p_terminal_id text
) RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN
  DELETE FROM public.settings_overrides x
  USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
  WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE')
    AND ((lower(x.scope)='branch' AND x.scope_id::text=p_branch_id)
      OR (lower(x.scope)='terminal' AND x.scope_id::text=p_terminal_id))
    AND x.scope::text=COALESCE(c->'key'->>'scope',(c->>'entityId')::jsonb->>'scope',(c->>'entity_id')::jsonb->>'scope')
    AND x.scope_id::text=COALESCE(c->'key'->>'scope_id',(c->>'entityId')::jsonb->>'scope_id',(c->>'entity_id')::jsonb->>'scope_id')
    AND x.section::text=COALESCE(c->'key'->>'section',(c->>'entityId')::jsonb->>'section',(c->>'entity_id')::jsonb->>'section');
  GET DIAGNOSTICS v_count=ROW_COUNT;
  RETURN v_count;
END
$fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_settings_scoped(
  p_changes jsonb,
  p_branch_id text,
  p_terminal_id text
) RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN
  DELETE FROM public.settings_scoped x
  USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
  WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE')
    AND ((lower(x.scope)='branch' AND x.scope_id::text=p_branch_id)
      OR (lower(x.scope)='terminal' AND x.scope_id::text=p_terminal_id))
    AND x.scope::text=COALESCE(c->'key'->>'scope',(c->>'entityId')::jsonb->>'scope',(c->>'entity_id')::jsonb->>'scope')
    AND x.scope_id::text=COALESCE(c->'key'->>'scope_id',(c->>'entityId')::jsonb->>'scope_id',(c->>'entity_id')::jsonb->>'scope_id')
    AND x.key::text=COALESCE(c->'key'->>'key',(c->>'entityId')::jsonb->>'key',(c->>'entity_id')::jsonb->>'key');
  GET DIAGNOSTICS v_count=ROW_COUNT;
  RETURN v_count;
END
$fn$;

REVOKE ALL ON FUNCTION public.sync_delete_settings_overrides(jsonb,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_delete_settings_scoped(jsonb,text,text) FROM PUBLIC, anon, authenticated;
