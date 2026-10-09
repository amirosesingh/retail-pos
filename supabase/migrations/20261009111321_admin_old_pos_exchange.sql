-- Old-system receipts use the reserved OLDPOS: namespace; no synthetic historical sale is inserted.
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

    IF left(NEW.original_bill_number, 7) = 'OLDPOS:' THEN
      IF TG_OP = 'INSERT' OR NEW.original_bill_number IS DISTINCT FROM OLD.original_bill_number THEN
      IF (SELECT auth.uid()) IS NOT NULL AND NOT public.has_role((SELECT auth.uid()), 'admin'::public.app_role) THEN
        RAISE EXCEPTION 'Only an administrator can enter an old POS exchange' USING ERRCODE = '42501';
      END IF;
      IF (SELECT auth.uid()) IS NULL AND current_user NOT IN ('postgres', 'service_role') THEN
        RAISE EXCEPTION 'An authorized admin or terminal synchronization is required' USING ERRCODE = '42501';
      END IF;
      END IF;
      IF length(NEW.original_bill_number) <= 7 OR length(NEW.original_bill_number) > 107
         OR NEW.original_bill_number <> upper(NEW.original_bill_number)
         OR COALESCE(NEW.total_amount, -1) < 0 OR COALESCE(NEW.exchange_credit, 0) <= 0 THEN
        RAISE EXCEPTION 'Invalid old POS exchange: add an equal or higher-value replacement' USING ERRCODE = '23514';
      END IF;
    ELSE
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
NOTIFY pgrst, 'reload schema';
