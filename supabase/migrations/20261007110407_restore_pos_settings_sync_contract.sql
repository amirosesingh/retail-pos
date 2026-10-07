-- Run in the POS Supabase (PostgreSQL) SQL editor, not in POS_Local SQL Server.
-- Restore required settings defaults without inventing a business name.
-- A missing company name remains NULL until an administrator supplies it.
BEGIN;

UPDATE public.pos_settings
SET ui_visibility = COALESCE(ui_visibility, '{"hidden": {}}'::jsonb),
    region_country = COALESCE(region_country, ''),
    time_zone = COALESCE(time_zone, ''),
    date_format = COALESCE(date_format, 'dd/MM/yyyy'),
    time_format = COALESCE(time_format, '24h'),
    booking_slip = COALESCE(booking_slip, '{}'::jsonb),
    updated_at = now()
WHERE ui_visibility IS NULL
   OR region_country IS NULL
   OR time_zone IS NULL
   OR date_format IS NULL
   OR time_format IS NULL
   OR booking_slip IS NULL;

ALTER TABLE public.pos_settings
  ALTER COLUMN company_name DROP DEFAULT,
  ALTER COLUMN company_name DROP NOT NULL,
  ALTER COLUMN ui_visibility SET DEFAULT '{"hidden": {}}'::jsonb,
  ALTER COLUMN ui_visibility SET NOT NULL,
  ALTER COLUMN region_country SET DEFAULT '',
  ALTER COLUMN region_country SET NOT NULL,
  ALTER COLUMN time_zone SET DEFAULT '',
  ALTER COLUMN time_zone SET NOT NULL,
  ALTER COLUMN date_format SET DEFAULT 'dd/MM/yyyy',
  ALTER COLUMN date_format SET NOT NULL,
  ALTER COLUMN time_format SET DEFAULT '24h',
  ALTER COLUMN time_format SET NOT NULL,
  ALTER COLUMN booking_slip SET DEFAULT '{}'::jsonb,
  ALTER COLUMN booking_slip SET NOT NULL;

COMMIT;
