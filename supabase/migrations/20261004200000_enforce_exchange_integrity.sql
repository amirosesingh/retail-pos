-- Serialize and enforce exchange lineage independently of the UI or client.
-- One original bill can fund exactly one exchange bill. Retries of that same
-- exchange remain valid, while refunded/missing/already-consumed originals fail.
CREATE UNIQUE INDEX IF NOT EXISTS sales_one_exchange_per_original_idx
  ON public.sales ((COALESCE(store_id, '')), original_bill_number)
  WHERE COALESCE(is_exchange, false) AND original_bill_number IS NOT NULL;

CREATE OR REPLACE FUNCTION public.enforce_sale_exchange_integrity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  original_refunded boolean;
  linked_bill text;
BEGIN
  IF COALESCE(NEW.is_exchange, false) THEN
    IF NULLIF(btrim(COALESCE(NEW.original_bill_number, '')), '') IS NULL THEN
      RAISE EXCEPTION 'EXCHANGE_ORIGINAL_REQUIRED: an exchange must name its original bill'
        USING ERRCODE = '23514';
    END IF;
    IF NEW.original_bill_number = NEW.bill_number THEN
      RAISE EXCEPTION 'EXCHANGE_SELF_REFERENCE: a bill cannot exchange itself'
        USING ERRCODE = '23514';
    END IF;

    SELECT COALESCE(source.is_refunded, false), source.exchanged_to_bill_number
      INTO original_refunded, linked_bill
      FROM public.sales AS source
     WHERE source.bill_number = NEW.original_bill_number
       AND COALESCE(source.store_id, '') = COALESCE(NEW.store_id, '')
     FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'EXCHANGE_ORIGINAL_MISSING: original bill was not found in this branch'
        USING ERRCODE = '23514';
    END IF;
    IF original_refunded THEN
      RAISE EXCEPTION 'EXCHANGE_ORIGINAL_REFUNDED: refunded bills cannot be exchanged'
        USING ERRCODE = '23514';
    END IF;
    IF linked_bill IS NOT NULL AND linked_bill <> NEW.bill_number THEN
      RAISE EXCEPTION 'EXCHANGE_ALREADY_USED: original bill was already exchanged to %', linked_bill
        USING ERRCODE = '23514';
    END IF;
  ELSIF NULLIF(btrim(COALESCE(NEW.original_bill_number, '')), '') IS NOT NULL THEN
    RAISE EXCEPTION 'EXCHANGE_FLAG_REQUIRED: original bill lineage requires is_exchange'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.exchanged_to_bill_number IS DISTINCT FROM OLD.exchanged_to_bill_number THEN
    IF OLD.exchanged_to_bill_number IS NOT NULL THEN
      RAISE EXCEPTION 'EXCHANGE_LINK_IMMUTABLE: an exchange link cannot be replaced'
        USING ERRCODE = '23514';
    END IF;
    IF NEW.exchanged_to_bill_number IS NOT NULL THEN
      PERFORM 1
        FROM public.sales AS destination
       WHERE destination.bill_number = NEW.exchanged_to_bill_number
         AND COALESCE(destination.store_id, '') = COALESCE(NEW.store_id, '')
         AND COALESCE(destination.is_exchange, false)
         AND destination.original_bill_number = NEW.bill_number;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'EXCHANGE_DESTINATION_INVALID: linked exchange bill does not match the original'
          USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NOT COALESCE(OLD.is_refunded, false)
     AND COALESCE(NEW.is_refunded, false)
     AND OLD.exchanged_to_bill_number IS NOT NULL THEN
    RAISE EXCEPTION 'EXCHANGE_ORIGINAL_ALREADY_USED: an exchanged bill cannot be refunded separately'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sales_exchange_integrity_trigger ON public.sales;
CREATE TRIGGER sales_exchange_integrity_trigger
BEFORE INSERT OR UPDATE OF is_exchange, original_bill_number, exchanged_to_bill_number, is_refunded, store_id, bill_number
ON public.sales
FOR EACH ROW
EXECUTE FUNCTION public.enforce_sale_exchange_integrity();

REVOKE ALL ON FUNCTION public.enforce_sale_exchange_integrity() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enforce_sale_exchange_integrity() TO authenticated, service_role;

