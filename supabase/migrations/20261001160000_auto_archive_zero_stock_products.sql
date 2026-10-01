CREATE OR REPLACE FUNCTION public.apply_zero_stock_catalog_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  enabled boolean := false;
  had_stock boolean := false;
  has_stock boolean := false;
BEGIN
  SELECT COALESCE((integration_settings ->> 'autoArchiveZeroStock')::boolean, false)
    INTO enabled
    FROM public.pos_settings
   WHERE id = 1;

  IF NOT enabled THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1
      FROM jsonb_each_text(COALESCE(NEW.stock_by_store, '{}'::jsonb))
     WHERE value ~ '^-?[0-9]+([.][0-9]+)?$'
       AND value::numeric > 0
  ) INTO has_stock;

  IF TG_OP = 'INSERT' AND NOT has_stock THEN
    NEW.is_archived := true;
    NEW.archived_at := COALESCE(NEW.archived_at, now());
  ELSIF TG_OP = 'INSERT' AND has_stock THEN
    NEW.is_archived := false;
    NEW.archived_at := NULL;
  ELSE
    SELECT EXISTS (
      SELECT 1
        FROM jsonb_each_text(COALESCE(OLD.stock_by_store, '{}'::jsonb))
       WHERE value ~ '^-?[0-9]+([.][0-9]+)?$'
         AND value::numeric > 0
    ) INTO had_stock;
    IF had_stock AND NOT has_stock THEN
      NEW.is_archived := true;
      NEW.archived_at := COALESCE(NEW.archived_at, now());
    ELSIF NOT had_stock AND has_stock THEN
      NEW.is_archived := false;
      NEW.archived_at := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS products_zero_stock_catalog_lifecycle ON public.products;
CREATE TRIGGER products_zero_stock_catalog_lifecycle
BEFORE INSERT OR UPDATE OF stock_by_store ON public.products
FOR EACH ROW EXECUTE FUNCTION public.apply_zero_stock_catalog_lifecycle();

COMMENT ON FUNCTION public.apply_zero_stock_catalog_lifecycle() IS
  'When enabled in integration_settings, archive products at company-wide zero stock and restore them when replenished.';

REVOKE ALL ON FUNCTION public.apply_zero_stock_catalog_lifecycle() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.backfill_zero_stock_catalog_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE((NEW.integration_settings ->> 'autoArchiveZeroStock')::boolean, false)
     AND NOT COALESCE((OLD.integration_settings ->> 'autoArchiveZeroStock')::boolean, false) THEN
    UPDATE public.products
       SET is_archived = NOT EXISTS (
             SELECT 1
               FROM jsonb_each_text(COALESCE(products.stock_by_store, '{}'::jsonb))
              WHERE value ~ '^-?[0-9]+([.][0-9]+)?$'
                AND value::numeric > 0
           ),
           archived_at = CASE
             WHEN EXISTS (
               SELECT 1
                 FROM jsonb_each_text(COALESCE(products.stock_by_store, '{}'::jsonb))
                WHERE value ~ '^-?[0-9]+([.][0-9]+)?$'
                  AND value::numeric > 0
             ) THEN NULL
             ELSE COALESCE(products.archived_at, now())
           END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pos_settings_zero_stock_catalog_backfill ON public.pos_settings;
CREATE TRIGGER pos_settings_zero_stock_catalog_backfill
AFTER UPDATE OF integration_settings ON public.pos_settings
FOR EACH ROW EXECUTE FUNCTION public.backfill_zero_stock_catalog_lifecycle();

REVOKE ALL ON FUNCTION public.backfill_zero_stock_catalog_lifecycle() FROM PUBLIC, anon, authenticated;
