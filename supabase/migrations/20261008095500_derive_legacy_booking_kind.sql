-- Older tills do not send booking_kind. Derive it at the database boundary so
-- mixed-version branches still classify newly synchronized racket jobs safely.
CREATE OR REPLACE FUNCTION public.bookings_derive_kind()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.booking_kind IS DISTINCT FROM 'racket'
     AND (
       NULLIF(btrim(COALESCE(NEW.racket_model, '')), '') IS NOT NULL
       OR NULLIF(btrim(COALESCE(NEW.string_type, '')), '') IS NOT NULL
       OR NEW.tension_main IS NOT NULL OR NEW.tension_cross IS NOT NULL
       OR NULLIF(btrim(COALESCE(NEW.grommet_notes, '')), '') IS NOT NULL
       OR NULLIF(btrim(COALESCE(NEW.job_notes, '')), '') IS NOT NULL
       OR NEW.dropped_off_at IS NOT NULL OR NEW.promised_at IS NOT NULL
       OR NEW.job_status_by IS NOT NULL OR NEW.job_status_at IS NOT NULL
       OR NULLIF(btrim(COALESCE(NEW.tag_id, '')), '') IS NOT NULL
       OR NULLIF(btrim(COALESCE(NEW.string_origin, '')), '') IS NOT NULL
       OR NEW.string_source_product_id IS NOT NULL OR NEW.grip_product_id IS NOT NULL
       OR NULLIF(btrim(COALESCE(NEW.technician, '')), '') IS NOT NULL
     ) THEN
    NEW.booking_kind := 'racket';
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS bookings_derive_kind ON public.bookings;
CREATE TRIGGER bookings_derive_kind
BEFORE INSERT OR UPDATE ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.bookings_derive_kind();

NOTIFY pgrst, 'reload schema';
