CREATE OR REPLACE FUNCTION public.guard_held_ticket_lifecycle()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE shift_state text;
BEGIN
  IF TG_OP='UPDATE' AND OLD.status IN ('completed','cancelled') THEN RETURN NULL; END IF;
  IF NEW.status='completed' AND NOT EXISTS(SELECT 1 FROM public.sales s WHERE s.store_id=NEW.store_id AND s.bill_number=NEW.bill_no)
    AND NOT EXISTS(SELECT 1 FROM public.bookings b WHERE NEW.note='booking:' || b.id::text AND b.store_id=NEW.store_id AND b.shift_id=NEW.shift_id) THEN
    RAISE EXCEPTION 'Only a completed payment may finish a draft bill.';
  END IF;
  IF NEW.bill_no IS NOT NULL AND EXISTS(SELECT 1 FROM public.sales s WHERE s.store_id=NEW.store_id AND s.bill_number=NEW.bill_no) THEN
    NEW.status := 'completed';
  END IF;
  IF NEW.status NOT IN ('completed','cancelled') AND NEW.shift_id IS NOT NULL THEN
    SELECT state INTO shift_state FROM public.shifts WHERE id::text=NEW.shift_id AND store_id=NEW.store_id FOR UPDATE;
    IF shift_state IS DISTINCT FROM 'ACTIVE' THEN RAISE EXCEPTION 'This shift is closing or closed. The draft cannot be changed.'; END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_held_ticket_lifecycle() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
