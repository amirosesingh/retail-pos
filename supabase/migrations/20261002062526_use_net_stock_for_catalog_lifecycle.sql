-- Catalogue availability follows net company-wide stock. This also closes a
-- legacy edge where differently-cased copies of one branch key could hold +1
-- and -1: the aggregate is zero, so the product must not remain sellable.
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
  net_stock numeric := 0;
  old_net_stock numeric := 0;
BEGIN
  SELECT lower(COALESCE(integration_settings ->> 'autoArchiveZeroStock', 'true')) = 'true'
    INTO enabled FROM public.pos_settings WHERE id = 1;
  IF NOT enabled THEN RETURN NEW; END IF;
  IF jsonb_typeof(NEW.stock_by_store) IS DISTINCT FROM 'object' THEN
    RETURN NEW;
  END IF;
  SELECT COALESCE(sum(value::numeric), 0)
    INTO net_stock
    FROM jsonb_each_text(COALESCE(NEW.stock_by_store, '{}'::jsonb))
   WHERE value ~ '^-?[0-9]+([.][0-9]+)?$';
  has_stock := net_stock > 0;
  IF TG_OP = 'INSERT' AND NOT has_stock THEN
    NEW.is_archived := true;
    NEW.archived_at := COALESCE(NEW.archived_at, now());
  ELSIF TG_OP = 'INSERT' AND has_stock THEN
    NEW.is_archived := COALESCE(NEW.is_archived, false);
    NEW.archived_at := CASE
      WHEN NEW.is_archived THEN COALESCE(NEW.archived_at, now())
      ELSE NULL
    END;
  ELSE
    IF jsonb_typeof(OLD.stock_by_store) = 'object' THEN
      SELECT COALESCE(sum(value::numeric), 0)
        INTO old_net_stock
        FROM jsonb_each_text(OLD.stock_by_store)
       WHERE value ~ '^-?[0-9]+([.][0-9]+)?$';
      had_stock := old_net_stock > 0;
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

REVOKE ALL ON FUNCTION public.apply_zero_stock_catalog_lifecycle() FROM PUBLIC, anon, authenticated;

-- One-way, bounded repair: only active products whose numeric branch stock
-- adds up to zero or less are retired. Positive-stock and manually archived
-- rows are untouched.
WITH lifecycle_setting AS (
  SELECT lower(COALESCE(integration_settings ->> 'autoArchiveZeroStock', 'true')) = 'true'
           AS enabled
    FROM public.pos_settings
   WHERE id = 1
), net_stock AS (
  SELECT p.id,
         COALESCE(sum(e.value::numeric) FILTER (
           WHERE e.value ~ '^-?[0-9]+([.][0-9]+)?$'
         ), 0) AS quantity
    FROM public.products p
    LEFT JOIN LATERAL jsonb_each_text(
      CASE WHEN jsonb_typeof(p.stock_by_store) = 'object'
           THEN p.stock_by_store ELSE '{}'::jsonb END
    ) e ON true
   WHERE p.is_archived IS NOT TRUE
     AND jsonb_typeof(p.stock_by_store) = 'object'
   GROUP BY p.id
)
UPDATE public.products p
   SET is_archived = true,
       archived_at = COALESCE(p.archived_at, now())
  FROM net_stock s
 WHERE p.id = s.id
   AND COALESCE((SELECT enabled FROM lifecycle_setting), true)
   AND s.quantity <= 0
   AND p.is_archived IS NOT TRUE;

NOTIFY pgrst, 'reload schema';
