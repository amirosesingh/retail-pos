BEGIN;
-- Automatic mode owns both archive and reactivation; manual mode leaves status alone.
CREATE OR REPLACE FUNCTION public.apply_zero_stock_catalog_lifecycle()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE enabled boolean; net_stock numeric;
BEGIN
  SELECT lower(COALESCE(integration_settings ->> 'autoArchiveZeroStock', 'true')) = 'true'
    INTO enabled FROM public.pos_settings WHERE id = 1;
  IF NOT COALESCE(enabled, true) OR NEW.deleted_at IS NOT NULL THEN RETURN NEW; END IF;
  IF jsonb_typeof(NEW.stock_by_store) IS DISTINCT FROM 'object' THEN RETURN NEW; END IF;
  SELECT COALESCE(sum(CASE WHEN value ~ '^-?[0-9]+([.][0-9]+)?$' THEN value::numeric ELSE 0 END), 0)
    INTO net_stock FROM jsonb_each_text(NEW.stock_by_store);
  NEW.is_archived := net_stock <= 0;
  NEW.archived_at := CASE WHEN NEW.is_archived THEN COALESCE(NEW.archived_at, now()) ELSE NULL END;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS products_zero_stock_catalog_lifecycle ON public.products;
CREATE TRIGGER products_zero_stock_catalog_lifecycle
BEFORE INSERT OR UPDATE OF stock_by_store, is_archived ON public.products
FOR EACH ROW EXECUTE FUNCTION public.apply_zero_stock_catalog_lifecycle();
REVOKE ALL ON FUNCTION public.apply_zero_stock_catalog_lifecycle() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.backfill_zero_stock_catalog_lifecycle()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF lower(COALESCE(NEW.integration_settings ->> 'autoArchiveZeroStock', 'true')) <> 'true' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF lower(COALESCE(OLD.integration_settings ->> 'autoArchiveZeroStock', 'true')) = 'true' THEN RETURN NEW; END IF;
  END IF;
  WITH stock_state AS (
  SELECT p.id, COALESCE(sum(CASE WHEN e.value ~ '^-?[0-9]+([.][0-9]+)?$' THEN e.value::numeric ELSE 0 END), 0) > 0 AS has_stock
  FROM public.products p
  LEFT JOIN LATERAL jsonb_each_text(CASE WHEN jsonb_typeof(p.stock_by_store) = 'object' THEN p.stock_by_store ELSE '{}'::jsonb END) e ON true
  WHERE jsonb_typeof(p.stock_by_store) = 'object' AND p.deleted_at IS NULL
  GROUP BY p.id
)
UPDATE public.products p
SET is_archived = NOT stock_state.has_stock,
    archived_at = CASE WHEN stock_state.has_stock THEN NULL ELSE COALESCE(p.archived_at, now()) END
FROM stock_state
WHERE p.id = stock_state.id
  AND COALESCE((SELECT lower(COALESCE(integration_settings ->> 'autoArchiveZeroStock', 'true')) = 'true' FROM public.pos_settings WHERE id = 1), true)
  AND (p.is_archived IS DISTINCT FROM NOT stock_state.has_stock
       OR (stock_state.has_stock AND p.archived_at IS NOT NULL));
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS pos_settings_zero_stock_catalog_backfill ON public.pos_settings;
CREATE TRIGGER pos_settings_zero_stock_catalog_backfill
AFTER INSERT OR UPDATE OF integration_settings ON public.pos_settings
FOR EACH ROW EXECUTE FUNCTION public.backfill_zero_stock_catalog_lifecycle();
REVOKE ALL ON FUNCTION public.backfill_zero_stock_catalog_lifecycle() FROM PUBLIC, anon, authenticated;

-- Reconcile products already present, including stocked products stuck in archive.
WITH stock_state AS (
  SELECT p.id, COALESCE(sum(CASE WHEN e.value ~ '^-?[0-9]+([.][0-9]+)?$' THEN e.value::numeric ELSE 0 END), 0) > 0 AS has_stock
  FROM public.products p
  LEFT JOIN LATERAL jsonb_each_text(CASE WHEN jsonb_typeof(p.stock_by_store) = 'object' THEN p.stock_by_store ELSE '{}'::jsonb END) e ON true
  WHERE jsonb_typeof(p.stock_by_store) = 'object' AND p.deleted_at IS NULL
  GROUP BY p.id
)
UPDATE public.products p
SET is_archived = NOT stock_state.has_stock,
    archived_at = CASE WHEN stock_state.has_stock THEN NULL ELSE COALESCE(p.archived_at, now()) END
FROM stock_state
WHERE p.id = stock_state.id
  AND COALESCE((SELECT lower(COALESCE(integration_settings ->> 'autoArchiveZeroStock', 'true')) = 'true' FROM public.pos_settings WHERE id = 1), true)
  AND (p.is_archived IS DISTINCT FROM NOT stock_state.has_stock
       OR (stock_state.has_stock AND p.archived_at IS NOT NULL));

COMMIT;
