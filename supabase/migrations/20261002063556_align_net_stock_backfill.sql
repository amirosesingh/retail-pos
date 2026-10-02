-- Keep the setting-toggle backfill consistent with the row-level lifecycle:
-- stock means positive net company quantity, not one positive JSON entry.
CREATE OR REPLACE FUNCTION public.backfill_zero_stock_catalog_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF lower(COALESCE(NEW.integration_settings ->> 'autoArchiveZeroStock', 'true')) = 'true'
     AND lower(COALESCE(OLD.integration_settings ->> 'autoArchiveZeroStock', 'true')) <> 'true' THEN
    WITH stock_state AS (
      SELECT p.id,
             COALESCE(sum(e.value::numeric) FILTER (
               WHERE e.value ~ '^-?[0-9]+([.][0-9]+)?$'
             ), 0) > 0 AS has_stock
        FROM public.products p
        LEFT JOIN LATERAL jsonb_each_text(p.stock_by_store) e ON true
       WHERE jsonb_typeof(p.stock_by_store) = 'object'
       GROUP BY p.id
    )
    UPDATE public.products p
       SET is_archived = true,
           archived_at = COALESCE(p.archived_at, now())
      FROM stock_state
     WHERE p.id = stock_state.id
       AND NOT stock_state.has_stock
       AND (NOT COALESCE(p.is_archived, false) OR p.archived_at IS NULL);
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.backfill_zero_stock_catalog_lifecycle() FROM PUBLIC, anon, authenticated;
NOTIFY pgrst, 'reload schema';
