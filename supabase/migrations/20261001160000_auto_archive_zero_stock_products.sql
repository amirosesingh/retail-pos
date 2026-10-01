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
  SELECT lower(COALESCE(integration_settings ->> 'autoArchiveZeroStock', 'true')) = 'true'
    INTO enabled
    FROM public.pos_settings
   WHERE id = 1;

  IF NOT enabled THEN
    RETURN NEW;
  END IF;

  -- Treat malformed legacy stock payloads as unknown, not zero stock. This
  -- prevents a bad JSON shape from automatically archiving a product.
  IF jsonb_typeof(NEW.stock_by_store) IS DISTINCT FROM 'object' THEN
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
    IF jsonb_typeof(OLD.stock_by_store) = 'object' THEN
      SELECT EXISTS (
        SELECT 1
          FROM jsonb_each_text(OLD.stock_by_store)
         WHERE value ~ '^-?[0-9]+([.][0-9]+)?$'
           AND value::numeric > 0
      ) INTO had_stock;
    ELSE
      had_stock := true;
    END IF;
    IF NOT has_stock THEN
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
BEFORE INSERT OR UPDATE OF stock_by_store, is_archived ON public.products
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
  IF lower(COALESCE(NEW.integration_settings ->> 'autoArchiveZeroStock', 'true')) = 'true'
     AND lower(COALESCE(OLD.integration_settings ->> 'autoArchiveZeroStock', 'false')) <> 'true' THEN
    WITH stock_state AS (
      SELECT p.id,
             EXISTS (
               SELECT 1
                 FROM jsonb_each_text(p.stock_by_store)
                WHERE value ~ '^-?[0-9]+([.][0-9]+)?$'
                  AND value::numeric > 0
             ) AS has_stock
        FROM public.products p
       WHERE jsonb_typeof(p.stock_by_store) = 'object'
    )
    UPDATE public.products p
       SET is_archived = NOT stock_state.has_stock,
           archived_at = CASE
             WHEN stock_state.has_stock THEN NULL
             ELSE COALESCE(p.archived_at, now())
           END
      FROM stock_state
     WHERE p.id = stock_state.id
       AND (
         p.is_archived IS DISTINCT FROM NOT stock_state.has_stock
         OR (stock_state.has_stock AND p.archived_at IS NOT NULL)
         OR (NOT stock_state.has_stock AND p.archived_at IS NULL)
       );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pos_settings_zero_stock_catalog_backfill ON public.pos_settings;
CREATE TRIGGER pos_settings_zero_stock_catalog_backfill
AFTER UPDATE OF integration_settings ON public.pos_settings
FOR EACH ROW EXECUTE FUNCTION public.backfill_zero_stock_catalog_lifecycle();

REVOKE ALL ON FUNCTION public.backfill_zero_stock_catalog_lifecycle() FROM PUBLIC, anon, authenticated;

-- Reconcile products already present when this migration reaches an
-- installation whose lifecycle setting was enabled earlier. Future changes
-- are handled by the two triggers above.
WITH lifecycle AS (
  SELECT lower(COALESCE(integration_settings ->> 'autoArchiveZeroStock', 'true')) = 'true' AS enabled
    FROM public.pos_settings
   WHERE id = 1
), stock_state AS (
  SELECT p.id,
         EXISTS (
           SELECT 1
             FROM jsonb_each_text(COALESCE(p.stock_by_store, '{}'::jsonb))
            WHERE value ~ '^-?[0-9]+([.][0-9]+)?$'
              AND value::numeric > 0
         ) AS has_stock
    FROM public.products p
   WHERE jsonb_typeof(p.stock_by_store) = 'object'
)
UPDATE public.products p
   SET is_archived = NOT stock_state.has_stock,
       archived_at = CASE
         WHEN stock_state.has_stock THEN NULL
         ELSE COALESCE(p.archived_at, now())
       END
  FROM lifecycle, stock_state
 WHERE lifecycle.enabled
   AND p.id = stock_state.id
   AND (
     p.is_archived IS DISTINCT FROM NOT stock_state.has_stock
     OR (stock_state.has_stock AND p.archived_at IS NOT NULL)
     OR (NOT stock_state.has_stock AND p.archived_at IS NULL)
   );
