-- Schema only. New or changed shift bindings must have a same-branch parent
-- when the transaction commits. Existing records are not scanned or rewritten.
CREATE OR REPLACE FUNCTION private.pos_sale_shift_parent_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  shift_ref text := NULLIF(btrim(NEW.shift_id::text), '');
BEGIN
  IF shift_ref IS NULL THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.id, NEW.shift_id, NEW.store_id) IS NOT DISTINCT FROM (OLD.id, OLD.shift_id, OLD.store_id) THEN
      RETURN NULL;
    END IF;
  END IF;

  -- A deferred event can refer to an earlier row version in this transaction.
  IF NOT EXISTS (
    SELECT 1 FROM public.sales AS sale
    WHERE sale.id = NEW.id AND sale.shift_id = NEW.shift_id
      AND sale.store_id IS NOT DISTINCT FROM NEW.store_id
  ) THEN
    RETURN NULL;
  END IF;

  IF shift_ref !~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' OR NEW.store_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'POS_SALE_SHIFT_PARENT_REQUIRED';
  END IF;
  PERFORM 1 FROM public.shifts AS parent
    WHERE parent.id = shift_ref::uuid AND parent.store_id = NEW.store_id
    FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'POS_SALE_SHIFT_PARENT_REQUIRED';
  END IF;
  RETURN NULL;
END
$fn$;

REVOKE ALL ON FUNCTION private.pos_sale_shift_parent_integrity() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS pos_sale_shift_parent_integrity ON public.sales;
CREATE CONSTRAINT TRIGGER pos_sale_shift_parent_integrity
AFTER INSERT OR UPDATE OF id, shift_id, store_id ON public.sales
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION private.pos_sale_shift_parent_integrity();
