-- Shared configuration may be edited by hosted Web or any activated till.
-- Normalize an incoming upsert's revision from its updated_at timestamp before
-- the generated sync_apply_* functions evaluate their row_version predicate.
-- This makes updated_at the cross-writer LWW clock and row_version the
-- deterministic tie-breaker.

CREATE OR REPLACE FUNCTION public.normalize_configuration_insert_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  current_version integer;
  current_updated_at timestamptz;
BEGIN
  CASE TG_TABLE_NAME
    WHEN 'pos_settings' THEN
      SELECT row_version, updated_at
        INTO current_version, current_updated_at
        FROM public.pos_settings
       WHERE id = NEW.id;
    WHEN 'pos_store_settings' THEN
      SELECT row_version, updated_at
        INTO current_version, current_updated_at
        FROM public.pos_store_settings
       WHERE store_id = NEW.store_id;
    WHEN 'settings_overrides' THEN
      SELECT row_version, updated_at
        INTO current_version, current_updated_at
        FROM public.settings_overrides
       WHERE scope = NEW.scope
         AND scope_id = NEW.scope_id
         AND section = NEW.section;
    WHEN 'settings_scoped' THEN
      SELECT row_version, updated_at
        INTO current_version, current_updated_at
        FROM public.settings_scoped
       WHERE scope = NEW.scope
         AND scope_id = NEW.scope_id
         AND key = NEW.key;
    ELSE
      RETURN NEW;
  END CASE;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF NEW.updated_at > current_updated_at
     AND COALESCE(NEW.row_version, 0) <= COALESCE(current_version, 0) THEN
    NEW.row_version := COALESCE(current_version, 0) + 1;
  ELSIF NEW.updated_at < current_updated_at
        AND COALESCE(NEW.row_version, 0) > COALESCE(current_version, 0) THEN
    NEW.row_version := current_version;
  END IF;

  RETURN NEW;
END
$fn$;

CREATE OR REPLACE FUNCTION public.reject_stale_integration_settings_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  current_updated_at timestamptz;
BEGIN
  SELECT updated_at
    INTO current_updated_at
    FROM public.integration_settings
   WHERE id = NEW.id;

  IF FOUND AND NEW.updated_at < current_updated_at THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS configuration_insert_version ON public.pos_settings;
CREATE TRIGGER configuration_insert_version
BEFORE INSERT ON public.pos_settings
FOR EACH ROW EXECUTE FUNCTION public.normalize_configuration_insert_version();

DROP TRIGGER IF EXISTS configuration_insert_version ON public.pos_store_settings;
CREATE TRIGGER configuration_insert_version
BEFORE INSERT ON public.pos_store_settings
FOR EACH ROW EXECUTE FUNCTION public.normalize_configuration_insert_version();

DROP TRIGGER IF EXISTS configuration_insert_version ON public.settings_overrides;
CREATE TRIGGER configuration_insert_version
BEFORE INSERT ON public.settings_overrides
FOR EACH ROW EXECUTE FUNCTION public.normalize_configuration_insert_version();

DROP TRIGGER IF EXISTS configuration_insert_version ON public.settings_scoped;
CREATE TRIGGER configuration_insert_version
BEFORE INSERT ON public.settings_scoped
FOR EACH ROW EXECUTE FUNCTION public.normalize_configuration_insert_version();

DROP TRIGGER IF EXISTS integration_settings_insert_freshness ON public.integration_settings;
CREATE TRIGGER integration_settings_insert_freshness
BEFORE INSERT ON public.integration_settings
FOR EACH ROW EXECUTE FUNCTION public.reject_stale_integration_settings_insert();

REVOKE ALL ON FUNCTION public.normalize_configuration_insert_version() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reject_stale_integration_settings_insert() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.normalize_configuration_insert_version() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reject_stale_integration_settings_insert() TO authenticated, service_role;

