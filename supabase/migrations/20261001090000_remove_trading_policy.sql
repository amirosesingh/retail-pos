-- Trading policy is no longer configurable. Remove its cloud persistence and
-- teach the sync endpoint the reduced pos_settings shape before dropping the
-- old columns, so desktop clients cannot reintroduce retired values.
CREATE OR REPLACE FUNCTION public.sync_apply_pos_settings(p_rows jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_count integer;
BEGIN
  INSERT INTO public.pos_settings
    (id,tax_percentage,enable_tax,tax_mode,paper_size,header_text,footer_text,
     show_logo,show_points,show_barcode,show_tax_details,updated_at,company_name,
     tax_number,reg_number,phone,website,fonts,custom_lines,qr,ui_visibility,
     integration_settings,region_country,time_zone,date_format,time_format,
     booking_slip,notification_settings,row_version,logo_data_url,receipt_design,
     payment_details,whatsapp_settings,receipt_css)
  SELECT
     id,tax_percentage,enable_tax,tax_mode,paper_size,header_text,footer_text,
     show_logo,show_points,show_barcode,show_tax_details,updated_at,company_name,
     tax_number,reg_number,phone,website,fonts,custom_lines,qr,ui_visibility,
     integration_settings,region_country,time_zone,date_format,time_format,
     booking_slip,notification_settings,row_version,logo_data_url,receipt_design,
     payment_details,whatsapp_settings,receipt_css
  FROM jsonb_populate_recordset(NULL::public.pos_settings, COALESCE(p_rows, '[]'::jsonb))
  ON CONFLICT (id) DO UPDATE SET
    tax_percentage=EXCLUDED.tax_percentage,enable_tax=EXCLUDED.enable_tax,
    tax_mode=EXCLUDED.tax_mode,paper_size=EXCLUDED.paper_size,
    header_text=EXCLUDED.header_text,footer_text=EXCLUDED.footer_text,
    show_logo=EXCLUDED.show_logo,show_points=EXCLUDED.show_points,
    show_barcode=EXCLUDED.show_barcode,show_tax_details=EXCLUDED.show_tax_details,
    updated_at=EXCLUDED.updated_at,company_name=EXCLUDED.company_name,
    tax_number=EXCLUDED.tax_number,reg_number=EXCLUDED.reg_number,
    phone=EXCLUDED.phone,website=EXCLUDED.website,fonts=EXCLUDED.fonts,
    custom_lines=EXCLUDED.custom_lines,qr=EXCLUDED.qr,
    ui_visibility=EXCLUDED.ui_visibility,
    integration_settings=EXCLUDED.integration_settings,
    region_country=EXCLUDED.region_country,time_zone=EXCLUDED.time_zone,
    date_format=EXCLUDED.date_format,time_format=EXCLUDED.time_format,
    booking_slip=EXCLUDED.booking_slip,
    notification_settings=EXCLUDED.notification_settings,
    row_version=EXCLUDED.row_version,logo_data_url=EXCLUDED.logo_data_url,
    receipt_design=EXCLUDED.receipt_design,payment_details=EXCLUDED.payment_details,
    whatsapp_settings=EXCLUDED.whatsapp_settings,receipt_css=EXCLUDED.receipt_css
  WHERE EXCLUDED.row_version > public.pos_settings.row_version;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$fn$;

ALTER TABLE public.pos_settings
  DROP COLUMN IF EXISTS review_max_voids,
  DROP COLUMN IF EXISTS review_max_refunds,
  DROP COLUMN IF EXISTS review_max_refund_value,
  DROP COLUMN IF EXISTS review_max_nosale,
  DROP COLUMN IF EXISTS review_max_discount_pct,
  DROP COLUMN IF EXISTS day_start_time,
  DROP COLUMN IF EXISTS day_end_time,
  DROP COLUMN IF EXISTS max_shift_hours,
  DROP COLUMN IF EXISTS shift_reminder_minutes;
