-- A BEFORE INSERT trigger also runs before ON CONFLICT selects an update.
-- Exchange synchronization replays the original bill to persist its exchange link.
CREATE OR REPLACE FUNCTION public.sales_block_closing_shift()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE s_state text;
BEGIN
  IF EXISTS (SELECT 1 FROM public.sales s WHERE s.id = NEW.id
             AND s.shift_id IS NOT DISTINCT FROM NEW.shift_id
             AND s.store_id IS NOT DISTINCT FROM NEW.store_id) THEN
    RETURN NEW;
  END IF;
  IF NEW.shift_id IS NULL OR NEW.shift_id = '' THEN RETURN NEW; END IF;
  BEGIN
    SELECT state INTO s_state FROM public.shifts WHERE id = NEW.shift_id::uuid;
  EXCEPTION WHEN invalid_text_representation THEN RETURN NEW; END;
  IF s_state IS NOT NULL AND s_state <> 'ACTIVE' THEN
    RAISE EXCEPTION 'This shift is being closed — no further transactions can be recorded against it.';
  END IF;
  RETURN NEW;
END $$;
