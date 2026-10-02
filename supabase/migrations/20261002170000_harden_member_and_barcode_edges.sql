-- Email-only members store an empty phone. Keep uniqueness for real phone numbers only.
ALTER TABLE public.members DROP CONSTRAINT IF EXISTS members_phone_key;
CREATE UNIQUE INDEX IF NOT EXISTS members_phone_nonblank_uidx
  ON public.members (phone)
  WHERE nullif(btrim(phone), '') IS NOT NULL;

-- Customer portal users also use the authenticated role; they must never mutate
-- staff-managed barcode mappings.
DROP POLICY IF EXISTS product_barcodes_staff_access ON public.product_barcodes;
DROP POLICY IF EXISTS product_barcodes_write ON public.product_barcodes;
CREATE POLICY product_barcodes_write ON public.product_barcodes
  FOR ALL TO authenticated
  USING ((SELECT public.is_staff_now()))
  WITH CHECK ((SELECT public.is_staff_now()));
