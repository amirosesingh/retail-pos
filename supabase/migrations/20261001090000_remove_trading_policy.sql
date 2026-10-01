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

-- Preserve all upgrade data. These legacy fields are intentionally omitted
-- from the sync function above, so they are inert without being destroyed.
-- A fresh schema no longer creates them; upgraded databases may retain them
-- for audit/recovery until a separately approved archival migration exists.
DO $preserve_legacy$
DECLARE
  v_column_name text;
BEGIN
  FOREACH v_column_name IN ARRAY ARRAY[
    'review_max_voids', 'review_max_refunds', 'review_max_refund_value',
    'review_max_nosale', 'review_max_discount_pct', 'day_start_time',
    'day_end_time', 'max_shift_hours', 'shift_reminder_minutes'
  ] LOOP
    IF EXISTS (
      SELECT 1
        FROM information_schema.columns AS c
       WHERE c.table_schema = 'public'
         AND c.table_name = 'pos_settings'
         AND c.column_name = v_column_name
    ) THEN
      EXECUTE format(
        'COMMENT ON COLUMN public.pos_settings.%I IS %L',
        v_column_name,
        'Legacy trading-policy value retained for audit; ignored by the current POS runtime.'
      );
    END IF;
  END LOOP;
END
$preserve_legacy$;
