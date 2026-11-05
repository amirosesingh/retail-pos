-- Preparation only. Apply to the separately approved project after fresh parity.
-- The shared UPDATE trigger must not prepare another table's NEW/OLD field.
-- Preserve function identity, owner, ACL, configuration, trusted refund exits,
-- refund-denial messages and both existing trigger attachments. No row rewrites.
BEGIN;
SET LOCAL lock_timeout = '3s';

DO $preflight$
DECLARE definition_hash text;
BEGIN
  SELECT md5(btrim(replace(p.prosrc,chr(13),''),E' \n\t'))
    INTO definition_hash
    FROM pg_catalog.pg_proc p
    WHERE p.oid=pg_catalog.to_regprocedure('public.guard_refund_fields()')
      AND p.prorettype='pg_catalog.trigger'::pg_catalog.regtype
      AND p.prosecdef
      AND p.proconfig=ARRAY['search_path=public, pg_temp']::text[];
  IF definition_hash IS NULL OR definition_hash NOT IN (
    '4a0d7834daa3959904fc9bc291bf72ce',
    '6516cdebc75f35c84b4878964913d554'
  ) THEN
    RAISE EXCEPTION 'REFUND_GUARD_SOURCE_REVIEW_REQUIRED';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_trigger t
      WHERE NOT t.tgisinternal AND t.tgfoid='public.guard_refund_fields()'::pg_catalog.regprocedure)<>2
    OR (SELECT count(*) FROM pg_catalog.pg_trigger t
      WHERE NOT t.tgisinternal AND t.tgenabled='O' AND t.tgtype=19
        AND t.tgfoid='public.guard_refund_fields()'::pg_catalog.regprocedure
        AND ((t.tgrelid=pg_catalog.to_regclass('public.sales') AND t.tgname='guard_sales_refunded')
          OR (t.tgrelid=pg_catalog.to_regclass('public.sale_items') AND t.tgname='guard_sale_items_refunded_qty')))<>2
  THEN RAISE EXCEPTION 'REFUND_GUARD_TRIGGER_REVIEW_REQUIRED'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute
      WHERE attrelid=pg_catalog.to_regclass('public.sales') AND attname='is_refunded'
        AND atttypid='pg_catalog.bool'::pg_catalog.regtype AND attnum>0 AND NOT attisdropped)
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute
      WHERE attrelid=pg_catalog.to_regclass('public.sale_items') AND attname='refunded_qty'
        AND atttypid='pg_catalog.int4'::pg_catalog.regtype AND attnum>0 AND NOT attisdropped)
  THEN RAISE EXCEPTION 'REFUND_GUARD_COLUMN_REVIEW_REQUIRED'; END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.guard_refund_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $guard$
BEGIN
  IF coalesce(current_setting('pos.refunding', true), '') = 'on' THEN
    RETURN NEW;
  END IF;
  IF auth.uid() IS NULL THEN
    RETURN NEW; -- trusted server paths (service role) do their own checks
  END IF;
  -- Prepare each record-field expression only for its own trigger table.
  IF TG_TABLE_NAME = 'sale_items' THEN
    IF NEW.refunded_qty IS DISTINCT FROM OLD.refunded_qty THEN
      RAISE EXCEPTION 'Refunded quantity can only be changed by processing a refund';
    END IF;
  END IF;
  IF TG_TABLE_NAME = 'sales' THEN
    IF coalesce(NEW.is_refunded, false) IS DISTINCT FROM coalesce(OLD.is_refunded, false) THEN
      RAISE EXCEPTION 'A bill can only be marked refunded by processing a refund';
    END IF;
  END IF;
  RETURN NEW;
END;
$guard$;
COMMIT;
