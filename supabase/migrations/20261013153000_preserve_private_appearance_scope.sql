-- Personal appearance already has owner-scoped policies; preserve that scope.
ALTER TABLE public.settings_scoped DROP CONSTRAINT IF EXISTS settings_scoped_scope_check;
ALTER TABLE public.settings_scoped ADD CONSTRAINT settings_scoped_scope_check
  CHECK (scope IN ('GLOBAL','CLUSTER','BRANCH','TERMINAL','PRIVATE'));

CREATE OR REPLACE FUNCTION public.pos_normalize_settings_scope()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
BEGIN
  NEW.scope := upper(btrim(NEW.scope));
  IF NEW.scope NOT IN ('GLOBAL','CLUSTER','BRANCH','TERMINAL')
     AND NOT (TG_TABLE_NAME = 'settings_scoped' AND NEW.scope = 'PRIVATE') THEN
    RAISE EXCEPTION 'Invalid settings scope' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.pos_normalize_settings_scope() FROM PUBLIC, anon, authenticated;
