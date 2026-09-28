-- Close anonymous table access. Public coupon/member/terminal flows use the
-- narrow SECURITY DEFINER routines granted above; visitors only need the
-- feature flags and live campaign rows themselves.
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM anon;
GRANT SELECT ON TABLE public.public_flags TO anon;
GRANT SELECT ON TABLE public.coupon_campaigns TO anon;

-- Remove legacy allow-all policies that bypass the staff and branch policies
-- installed earlier in this canonical schema.
DROP POLICY IF EXISTS "Public access" ON public.audit_logs;
DROP POLICY IF EXISTS "Public access" ON public.members;
DROP POLICY IF EXISTS "Public access" ON public.membership_tiers;
DROP POLICY IF EXISTS "Public access" ON public.pos_settings;
DROP POLICY IF EXISTS "Public access" ON public.products;
DROP POLICY IF EXISTS "Public access" ON public.promotions;
DROP POLICY IF EXISTS "Public access" ON public.purchase_order_items;
DROP POLICY IF EXISTS "Public access" ON public.purchase_orders;

-- Public voucher pages resolve one opaque token through voucher_by_token().
-- They must never be able to enumerate the voucher table.
DROP POLICY IF EXISTS "vouchers readable" ON public.issued_vouchers;
DROP POLICY IF EXISTS "campaigns readable" ON public.coupon_campaigns;
DROP POLICY IF EXISTS "payment_types_read" ON public.payment_types;
DROP POLICY IF EXISTS "product_barcodes_read" ON public.product_barcodes;
DROP POLICY IF EXISTS "settings_locks_read" ON public.settings_locks;
DROP POLICY IF EXISTS "settings_overrides_read" ON public.settings_overrides;

-- Signed-in staff still need read access to effective settings. Writes remain
-- governed by the supervisor/private-scope policies above.
CREATE POLICY "settings_locks_read" ON public.settings_locks
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "settings_overrides_read" ON public.settings_overrides
  FOR SELECT TO authenticated USING (true);
