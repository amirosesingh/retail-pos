-- Accept mixed-case input but persist the same uppercase keys as SQL Server.
CREATE OR REPLACE FUNCTION public.pos_normalize_settings_scope()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
BEGIN
  NEW.scope := upper(btrim(NEW.scope));
  IF NEW.scope NOT IN ('GLOBAL', 'CLUSTER', 'BRANCH', 'TERMINAL') THEN
    RAISE EXCEPTION 'Invalid settings scope' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.pos_normalize_settings_scope() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS pos_normalize_settings_scope ON public.settings_scoped;
CREATE TRIGGER pos_normalize_settings_scope BEFORE INSERT OR UPDATE OF scope
ON public.settings_scoped FOR EACH ROW EXECUTE FUNCTION public.pos_normalize_settings_scope();
DROP TRIGGER IF EXISTS pos_normalize_settings_scope ON public.settings_overrides;
CREATE TRIGGER pos_normalize_settings_scope BEFORE INSERT OR UPDATE OF scope
ON public.settings_overrides FOR EACH ROW EXECUTE FUNCTION public.pos_normalize_settings_scope();
