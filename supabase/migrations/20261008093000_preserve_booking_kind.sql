-- Standard pay-later bookings and racket jobs used to share a NOT NULL
-- job_status default. After a reload that made every standard booking look
-- like a racket job. Persist the kind explicitly and repair existing rows.
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS booking_kind text NOT NULL DEFAULT 'standard';

UPDATE public.bookings
SET booking_kind = 'racket'
WHERE booking_kind = 'standard'
  AND (
    NULLIF(btrim(COALESCE(racket_model, '')), '') IS NOT NULL
    OR NULLIF(btrim(COALESCE(string_type, '')), '') IS NOT NULL
    OR tension_main IS NOT NULL
    OR tension_cross IS NOT NULL
    OR NULLIF(btrim(COALESCE(grommet_notes, '')), '') IS NOT NULL
    OR NULLIF(btrim(COALESCE(job_notes, '')), '') IS NOT NULL
    OR dropped_off_at IS NOT NULL
    OR promised_at IS NOT NULL
    OR job_status_by IS NOT NULL
    OR job_status_at IS NOT NULL
    OR NULLIF(btrim(COALESCE(tag_id, '')), '') IS NOT NULL
    OR NULLIF(btrim(COALESCE(string_origin, '')), '') IS NOT NULL
    OR string_source_product_id IS NOT NULL
    OR grip_product_id IS NOT NULL
    OR NULLIF(btrim(COALESCE(technician, '')), '') IS NOT NULL
  );

ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_kind_chk;
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_kind_chk CHECK (booking_kind IN ('standard', 'racket'));

-- Keep the local SQL Server -> Supabase replay contract aware of the new
-- scalar column. It remains branch-scoped through sync_push_batch.
CREATE OR REPLACE FUNCTION public.sync_apply_bookings(p_rows jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
DECLARE v_count integer;
BEGIN
  INSERT INTO public.bookings
    (id,ref,store_id,shift_id,customer_name,customer_phone,member_id,service_type_id,service_name,service_fee,payment_timing,lines,subtotal,discount,tax,total,paid,due_date,note,cashier,status,booking_kind,sale_receipt_no,closed_at,racket_model,string_type,tension_main,tension_cross,tension_unit,grommet_notes,job_notes,dropped_off_at,promised_at,job_status,job_status_by,job_status_at,notify_whatsapp,created_at,updated_at,tag_id,intake_note,string_origin,string_source_product_id,grip_product_id,charges,technician,liability_accepted,incident_note,row_version,cancel_reason,cancelled_by,cancelled_at,cancelled_terminal,cancel_money_action,booking_ref)
  SELECT
    id,ref,store_id,shift_id,customer_name,customer_phone,member_id,service_type_id,service_name,service_fee,payment_timing,lines,subtotal,discount,tax,total,paid,due_date,note,cashier,status,booking_kind,sale_receipt_no,closed_at,racket_model,string_type,tension_main,tension_cross,tension_unit,grommet_notes,job_notes,dropped_off_at,promised_at,job_status,job_status_by,job_status_at,notify_whatsapp,created_at,updated_at,tag_id,intake_note,string_origin,string_source_product_id,grip_product_id,charges,technician,liability_accepted,incident_note,row_version,cancel_reason,cancelled_by,cancelled_at,cancelled_terminal,cancel_money_action,booking_ref
  FROM jsonb_populate_recordset(NULL::public.bookings, COALESCE(p_rows, '[]'::jsonb))
  ON CONFLICT (id) DO UPDATE SET
    ref=EXCLUDED.ref,store_id=EXCLUDED.store_id,shift_id=EXCLUDED.shift_id,customer_name=EXCLUDED.customer_name,customer_phone=EXCLUDED.customer_phone,member_id=EXCLUDED.member_id,service_type_id=EXCLUDED.service_type_id,service_name=EXCLUDED.service_name,service_fee=EXCLUDED.service_fee,payment_timing=EXCLUDED.payment_timing,lines=EXCLUDED.lines,subtotal=EXCLUDED.subtotal,discount=EXCLUDED.discount,tax=EXCLUDED.tax,total=EXCLUDED.total,paid=EXCLUDED.paid,due_date=EXCLUDED.due_date,note=EXCLUDED.note,cashier=EXCLUDED.cashier,status=EXCLUDED.status,booking_kind=EXCLUDED.booking_kind,sale_receipt_no=EXCLUDED.sale_receipt_no,closed_at=EXCLUDED.closed_at,racket_model=EXCLUDED.racket_model,string_type=EXCLUDED.string_type,tension_main=EXCLUDED.tension_main,tension_cross=EXCLUDED.tension_cross,tension_unit=EXCLUDED.tension_unit,grommet_notes=EXCLUDED.grommet_notes,job_notes=EXCLUDED.job_notes,dropped_off_at=EXCLUDED.dropped_off_at,promised_at=EXCLUDED.promised_at,job_status=EXCLUDED.job_status,job_status_by=EXCLUDED.job_status_by,job_status_at=EXCLUDED.job_status_at,notify_whatsapp=EXCLUDED.notify_whatsapp,created_at=EXCLUDED.created_at,updated_at=EXCLUDED.updated_at,tag_id=EXCLUDED.tag_id,intake_note=EXCLUDED.intake_note,string_origin=EXCLUDED.string_origin,string_source_product_id=EXCLUDED.string_source_product_id,grip_product_id=EXCLUDED.grip_product_id,charges=EXCLUDED.charges,technician=EXCLUDED.technician,liability_accepted=EXCLUDED.liability_accepted,incident_note=EXCLUDED.incident_note,row_version=EXCLUDED.row_version,cancel_reason=EXCLUDED.cancel_reason,cancelled_by=EXCLUDED.cancelled_by,cancelled_at=EXCLUDED.cancelled_at,cancelled_terminal=EXCLUDED.cancelled_terminal,cancel_money_action=EXCLUDED.cancel_money_action,booking_ref=EXCLUDED.booking_ref
  WHERE EXCLUDED.row_version > public.bookings.row_version;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$fn$;

REVOKE ALL ON FUNCTION public.sync_apply_bookings(jsonb) FROM PUBLIC;

NOTIFY pgrst, 'reload schema';
