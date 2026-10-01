-- Split catalogue operations that previously shared can_add_new_product.
-- Backfill preserves every existing user's behavior while future edits store
-- each decision independently.
UPDATE public.app_users
SET permissions = permissions || jsonb_build_object(
  'can_edit_product_details', COALESCE((permissions->>'can_add_new_product')::boolean, false),
  'can_link_product_barcode', COALESCE((permissions->>'can_add_new_product')::boolean, false),
  'can_archive_product', COALESCE((permissions->>'can_add_new_product')::boolean, false),
  'can_restore_product', COALESCE((permissions->>'can_add_new_product')::boolean, false),
  'can_publish_product', COALESCE((permissions->>'can_add_new_product')::boolean, false)
)
WHERE NOT permissions ? 'can_edit_product_details'
   OR NOT permissions ? 'can_link_product_barcode'
   OR NOT permissions ? 'can_archive_product'
   OR NOT permissions ? 'can_restore_product'
   OR NOT permissions ? 'can_publish_product';

CREATE OR REPLACE FUNCTION public.enforce_product_price_permissions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  lifecycle_enabled boolean := false;
  has_stock boolean := false;
  automatic_lifecycle_change boolean := false;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN RETURN NEW; END IF;

  IF TG_OP = 'INSERT' AND NOT public.has_perm('can_add_new_product') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED_PRODUCT';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF (COALESCE(NEW.selling_price, 0) <> COALESCE(OLD.selling_price, 0)
        OR COALESCE(NEW.cost_price, 0) <> COALESCE(OLD.cost_price, 0)
        OR COALESCE(NEW.ecom_price, -1) IS DISTINCT FROM COALESCE(OLD.ecom_price, -1))
       AND NOT public.has_perm('can_edit_product_price') THEN
      RAISE EXCEPTION 'PERMISSION_DENIED_PRICE';
    END IF;

    IF (NEW.name IS DISTINCT FROM OLD.name
        OR NEW.sku IS DISTINCT FROM OLD.sku
        OR NEW.barcode IS DISTINCT FROM OLD.barcode
        OR NEW.category IS DISTINCT FROM OLD.category
        OR NEW.sub_category IS DISTINCT FROM OLD.sub_category
        OR NEW.product_group IS DISTINCT FROM OLD.product_group
        OR NEW.brand IS DISTINCT FROM OLD.brand
        OR NEW.unit IS DISTINCT FROM OLD.unit
        OR NEW.packs IS DISTINCT FROM OLD.packs
        OR NEW.reorder_level IS DISTINCT FROM OLD.reorder_level
        OR NEW.tax_rate IS DISTINCT FROM OLD.tax_rate)
       AND NOT public.has_perm('can_edit_product_details') THEN
      RAISE EXCEPTION 'PERMISSION_DENIED_PRODUCT_DETAILS';
    END IF;

    IF (NEW.barcode_aliases IS DISTINCT FROM OLD.barcode_aliases
        OR NEW.barcode_variants IS DISTINCT FROM OLD.barcode_variants)
       AND NOT public.has_perm('can_link_product_barcode') THEN
      RAISE EXCEPTION 'PERMISSION_DENIED_PRODUCT_BARCODE';
    END IF;

    IF NEW.ecom_visible IS DISTINCT FROM OLD.ecom_visible
       AND NOT public.has_perm('can_publish_product') THEN
      RAISE EXCEPTION 'PERMISSION_DENIED_PRODUCT_PUBLISH';
    END IF;

    IF NEW.is_archived IS DISTINCT FROM OLD.is_archived THEN
      SELECT COALESCE((integration_settings ->> 'autoArchiveZeroStock')::boolean, false)
        INTO lifecycle_enabled
        FROM public.pos_settings
       WHERE id = 1;
      SELECT EXISTS (
        SELECT 1
          FROM jsonb_each_text(COALESCE(NEW.stock_by_store, '{}'::jsonb))
         WHERE value ~ '^-?[0-9]+([.][0-9]+)?$'
           AND value::numeric > 0
      ) INTO has_stock;
      automatic_lifecycle_change := lifecycle_enabled
        AND (NEW.stock_by_store IS DISTINCT FROM OLD.stock_by_store OR pg_trigger_depth() > 1)
        AND NEW.is_archived = NOT has_stock;

      IF NOT automatic_lifecycle_change THEN
        IF NEW.is_archived AND NOT public.has_perm('can_archive_product') THEN
          RAISE EXCEPTION 'PERMISSION_DENIED_PRODUCT_ARCHIVE';
        END IF;
        IF NOT NEW.is_archived AND NOT public.has_perm('can_restore_product') THEN
          RAISE EXCEPTION 'PERMISSION_DENIED_PRODUCT_RESTORE';
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.enforce_product_price_permissions() FROM PUBLIC;

DROP POLICY IF EXISTS "Staff can delete" ON public.products;
