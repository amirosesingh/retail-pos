-- Internal trigger functions need owner access to protected shift rows; direct execution is revoked.
-- Retain terminal states so delayed draft synchronization cannot resurrect a bill.
CREATE OR REPLACE FUNCTION public.guard_held_ticket_lifecycle()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE shift_state text;
BEGIN
  IF TG_OP='UPDATE' AND OLD.status IN ('completed','cancelled') THEN RETURN NULL; END IF;
  IF NEW.status='completed' AND NOT EXISTS(SELECT 1 FROM public.sales s WHERE s.store_id=NEW.store_id AND s.bill_number=NEW.bill_no) THEN
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
DROP TRIGGER IF EXISTS held_orders_ab_lifecycle ON public.held_orders;
CREATE TRIGGER held_orders_ab_lifecycle BEFORE INSERT OR UPDATE ON public.held_orders
FOR EACH ROW EXECUTE FUNCTION public.guard_held_ticket_lifecycle();

CREATE OR REPLACE FUNCTION public.complete_held_ticket_on_sale()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM public.held_orders h WHERE h.store_id=NEW.store_id AND h.bill_no=NEW.bill_number AND h.status='cancelled') THEN
    RAISE EXCEPTION 'This draft bill was cancelled. Start a new bill.';
  END IF;
  UPDATE public.held_orders SET status='completed',updated_at=now()
  WHERE store_id=NEW.store_id AND bill_no=NEW.bill_number AND status NOT IN ('completed','cancelled');
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.complete_held_ticket_on_sale() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS sales_complete_held_ticket ON public.sales;
CREATE TRIGGER sales_complete_held_ticket AFTER INSERT ON public.sales
FOR EACH ROW EXECUTE FUNCTION public.complete_held_ticket_on_sale();

CREATE OR REPLACE FUNCTION public.guard_shift_unfinished_tickets()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF OLD.state='ACTIVE' AND (NEW.state IS DISTINCT FROM 'ACTIVE' OR NEW.closed_at IS NOT NULL) AND EXISTS(
    SELECT 1 FROM public.held_orders h WHERE h.store_id=NEW.store_id
      AND (h.shift_id=NEW.id::text OR h.shift_id IS NULL)
      AND h.status NOT IN ('completed','cancelled')
  ) THEN RAISE EXCEPTION 'Complete or cancel all draft and held bills before closing this shift.'; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_shift_unfinished_tickets() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS shifts_unfinished_tickets ON public.shifts;
CREATE TRIGGER shifts_unfinished_tickets BEFORE UPDATE ON public.shifts
FOR EACH ROW EXECUTE FUNCTION public.guard_shift_unfinished_tickets();
CREATE INDEX IF NOT EXISTS held_orders_shift_status_idx ON public.held_orders(store_id,shift_id,status);
NOTIFY pgrst, 'reload schema';
