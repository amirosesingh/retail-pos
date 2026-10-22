-- Global denials are materialized into the existing replicated permission matrix.
-- Requested per-user grants stay private so removing a denial restores prior intent.
CREATE SCHEMA IF NOT EXISTS private;
CREATE TABLE IF NOT EXISTS private.global_permission_policy (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  denied text[] NOT NULL DEFAULT '{}'
);
INSERT INTO private.global_permission_policy(singleton) VALUES (true) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS private.requested_staff_permissions (
  account_id uuid PRIMARY KEY REFERENCES public.app_users(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  permissions jsonb NOT NULL
);
INSERT INTO private.requested_staff_permissions(account_id, permissions)
SELECT id, coalesce(permissions, '{}'::jsonb) FROM public.app_users ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS private.global_permission_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor uuid NOT NULL, denied text[] NOT NULL, changed_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON private.global_permission_policy, private.requested_staff_permissions,
  private.global_permission_audit FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.enforce_global_permission_denials() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE requested jsonb; entry record; blocked text;
BEGIN
  SELECT permissions INTO requested FROM private.requested_staff_permissions WHERE account_id = NEW.id;
  IF requested IS NULL OR TG_OP = 'INSERT' THEN
    requested := coalesce(NEW.permissions, '{}'::jsonb);
  ELSE
    -- A normal profile save must not replace a masked grant with a permanent denial.
    FOR entry IN SELECT key, value FROM jsonb_each(coalesce(NEW.permissions, '{}'::jsonb)) LOOP
      IF entry.value IS DISTINCT FROM OLD.permissions->entry.key THEN
        requested := jsonb_set(requested, ARRAY[entry.key], entry.value, true);
      END IF;
    END LOOP;
    FOR blocked IN SELECT jsonb_object_keys(coalesce(OLD.permissions, '{}'::jsonb)) LOOP
      IF NOT coalesce(NEW.permissions, '{}'::jsonb) ? blocked THEN requested := requested - blocked; END IF;
    END LOOP;
  END IF;
  INSERT INTO private.requested_staff_permissions(account_id, permissions) VALUES (NEW.id, requested)
  ON CONFLICT(account_id) DO UPDATE SET permissions = EXCLUDED.permissions;
  NEW.permissions := requested;
  IF NEW.role <> 'admin' AND coalesce(NEW.role_slug, '') <> 'admin' THEN
    FOR blocked IN SELECT unnest(denied) FROM private.global_permission_policy WHERE singleton LOOP
      NEW.permissions := jsonb_set(NEW.permissions, ARRAY[blocked], 'false'::jsonb, true);
    END LOOP;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.enforce_global_permission_denials() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS zz_global_permission_denials ON public.app_users;
CREATE TRIGGER zz_global_permission_denials BEFORE INSERT OR UPDATE OF permissions, role, role_slug
ON public.app_users FOR EACH ROW EXECUTE FUNCTION private.enforce_global_permission_denials();

CREATE OR REPLACE FUNCTION public.global_permission_restrictions() RETURNS text[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.app_users WHERE auth_user_id = (SELECT auth.uid())
    AND is_active AND (role = 'admin' OR role_slug = 'admin')) THEN
    RAISE EXCEPTION 'Administrator access is required' USING ERRCODE = '42501';
  END IF;
  RETURN (SELECT denied FROM private.global_permission_policy WHERE singleton);
END $$;
CREATE OR REPLACE FUNCTION public.set_global_permission_restrictions(p_denied text[]) RETURNS text[]
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE normalized text[];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.app_users WHERE auth_user_id = (SELECT auth.uid())
    AND is_active AND (role = 'admin' OR role_slug = 'admin')) THEN
    RAISE EXCEPTION 'Administrator access is required' USING ERRCODE = '42501';
  END IF;
  IF p_denied IS NULL OR cardinality(p_denied) > 500 OR EXISTS (
    SELECT 1 FROM unnest(p_denied) k WHERE k IS NULL OR NOT ('["can_access_pos_settings","can_add_member","can_add_new_product","can_adjust_stock","can_apply_member_discount","can_approve_transfer","can_archive_product","can_bulk_edit_products","can_bypass_shift_lock","can_cancel_booking","can_close_drawer","can_close_shift","can_collect_booking","can_create_booking","can_create_transfer","can_customize_display","can_delete_line","can_discard_held_order","can_discount_bill","can_edit_member_points","can_edit_product_details","can_edit_product_price","can_edit_tenders","can_export_reports","can_give_discount","can_hold_cart","can_link_product_barcode","can_manage_bookings","can_manage_categories","can_manage_locations","can_manage_other_shifts","can_manage_promotions","can_manage_staff","can_manage_sync_backup","can_manage_terminals","can_merge_products","can_no_sale_open","can_open_drawer","can_open_shift","can_override_price","can_process_exchange","can_process_refund","can_process_sale","can_publish_product","can_receive_purchase_order","can_receive_transfer","can_redeem_points","can_reduce_qty","can_reopen_held_order","can_reprint_bill","can_restore_product","can_send_whatsapp_bill","can_shift_cash_count","can_shift_cash_recount","can_shift_closing_history_view","can_shift_counted_cash_view","can_shift_expected_cash_view","can_shift_financial_summary_view","can_shift_payment_breakdown_view","can_shift_report_reprint","can_shift_signin_history_view","can_shift_variance_approve","can_shift_variance_view","can_use_management_mobile","can_view_audit_trail","can_view_dashboard","can_view_drawer_balance","can_view_held_orders","can_view_inventory","can_view_cost_margin","can_view_member_history","can_view_sales_reports","can_void_cart","can_void_item","page:admin","page:alerts","page:all-shops","page:analytics","page:approvals","page:audit","page:bookings","page:coupons","page:dashboard","page:database","page:display","page:holds","page:inventory","page:locations","page:members","page:pos-general-booking","page:pos-racket-service","page:promotions","page:purchasing","page:receipts","page:receiving","page:register","page:reports","page:requests","page:settings","page:settings-mobile-terminals","page:shifts","page:staff","page:stock","page:suppliers","page:terminals","page:transfers","page:verifications"]'::jsonb ? k)
  ) THEN RAISE EXCEPTION 'Invalid restriction keys' USING ERRCODE = '22023'; END IF;
  SELECT coalesce(array_agg(DISTINCT k ORDER BY k), '{}') INTO normalized FROM unnest(p_denied) k;
  -- Serialize policy changes with account edits before changing the effective matrices.
  LOCK TABLE public.app_users IN SHARE ROW EXCLUSIVE MODE;
  UPDATE private.global_permission_policy SET denied = normalized WHERE singleton;
  UPDATE public.app_users a SET permissions = r.permissions, updated_at = now()
    FROM private.requested_staff_permissions r WHERE r.account_id = a.id
      AND a.role <> 'admin' AND coalesce(a.role_slug, '') <> 'admin';
  INSERT INTO private.global_permission_audit(actor, denied) VALUES ((SELECT auth.uid()), normalized);
  RETURN normalized;
END $$;
REVOKE ALL ON FUNCTION public.global_permission_restrictions(), public.set_global_permission_restrictions(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.global_permission_restrictions(), public.set_global_permission_restrictions(text[]) TO authenticated;
NOTIFY pgrst, 'reload schema';
