-- A transfer line belongs to its original document. Older clients used
-- colliding request/fulfilment IDs; reject reassignment instead of stealing
-- the request's approval evidence. No existing rows or quantities are changed.
DO $collision_guard$
DECLARE existing_function oid := to_regprocedure('public.stock_transfer_items_preserve_parent()');
BEGIN
  IF existing_function IS NOT NULL AND
     obj_description(existing_function,'pg_proc') IS DISTINCT FROM 'Retail POS TRF16 immutable transfer line parent v1' THEN
    RAISE EXCEPTION 'Unexpected transfer line parent guard function already exists';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_trigger t
      WHERE t.tgrelid='public.stock_transfer_items'::regclass
        AND t.tgname='stock_transfer_items_00_parent_identity'
        AND (t.tgfoid IS DISTINCT FROM existing_function OR t.tgtype<>19
          OR t.tgattr::text IS DISTINCT FROM (SELECT a.attnum::text FROM pg_attribute a
            WHERE a.attrelid=t.tgrelid AND a.attname='transfer_id' AND NOT a.attisdropped))) THEN
    RAISE EXCEPTION 'Unexpected transfer line parent guard trigger already exists';
  END IF;
END $collision_guard$;

CREATE OR REPLACE FUNCTION public.stock_transfer_items_preserve_parent()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $fn$
BEGIN
  IF NEW.transfer_id IS DISTINCT FROM OLD.transfer_id THEN
    RAISE EXCEPTION 'TRANSFER_LINE_PARENT_IMMUTABLE' USING ERRCODE='check_violation';
  END IF;
  RETURN NEW;
END $fn$;
COMMENT ON FUNCTION public.stock_transfer_items_preserve_parent() IS 'Retail POS TRF16 immutable transfer line parent v1';
REVOKE ALL ON FUNCTION public.stock_transfer_items_preserve_parent() FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE TRIGGER stock_transfer_items_00_parent_identity
  BEFORE UPDATE OF transfer_id ON public.stock_transfer_items
  FOR EACH ROW EXECUTE FUNCTION public.stock_transfer_items_preserve_parent();
