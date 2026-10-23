-- Additional restrictive policies: existing branch/row policies still apply.
DO $policy$
DECLARE item record; predicate text;
BEGIN
  FOR item IN SELECT key, value FROM jsonb_each('{"products":["can_process_sale","can_view_inventory","can_add_new_product","can_edit_product_details","can_adjust_stock","can_receive_purchase_order","can_create_transfer","can_receive_transfer","can_approve_transfer","can_view_sales_reports","can_view_dashboard"],"product_barcodes":["can_process_sale","can_view_inventory","can_add_new_product","can_edit_product_details","can_adjust_stock","can_receive_purchase_order","can_create_transfer","can_receive_transfer","can_approve_transfer","can_view_sales_reports","can_view_dashboard"],"product_categories":["can_process_sale","can_view_inventory","can_add_new_product","can_edit_product_details","can_adjust_stock","can_receive_purchase_order","can_create_transfer","can_receive_transfer","can_approve_transfer","can_view_sales_reports","can_view_dashboard"],"uom_units":["can_process_sale","can_view_inventory","can_add_new_product","can_edit_product_details","can_adjust_stock","can_receive_purchase_order","can_create_transfer","can_receive_transfer","can_approve_transfer","can_view_sales_reports","can_view_dashboard"],"sales":["can_process_sale","can_view_sales_reports","can_view_dashboard","can_reprint_bill","can_process_refund","can_process_exchange"],"sale_items":["can_process_sale","can_view_sales_reports","can_view_dashboard","can_reprint_bill","can_process_refund","can_process_exchange"],"payment_transactions":["can_process_sale","can_view_sales_reports","can_view_dashboard","can_reprint_bill","can_process_refund","can_process_exchange"],"bookings":["can_manage_bookings","can_create_booking","can_collect_booking","can_cancel_booking"],"booking_payments":["can_manage_bookings","can_create_booking","can_collect_booking","can_cancel_booking"],"stock_transfers":["can_create_transfer","can_receive_transfer","can_approve_transfer"],"stock_transfer_items":["can_create_transfer","can_receive_transfer","can_approve_transfer"],"purchase_orders":["can_receive_purchase_order"],"purchase_order_items":["can_receive_purchase_order"],"receivings":["can_receive_purchase_order"],"receiving_items":["can_receive_purchase_order"],"suppliers":["can_receive_purchase_order"],"members":["can_process_sale","can_add_member","can_edit_member_points","can_view_member_history"],"stock_adjustments":["can_adjust_stock"],"stock_count_drafts":["can_adjust_stock"],"stock_movements":["can_adjust_stock","can_view_inventory","can_create_transfer","can_receive_transfer","can_approve_transfer"],"expenses":["can_view_sales_reports"],"audit_logs":["can_view_audit_trail"],"item_activity_logs":["can_view_audit_trail"],"held_orders":["can_hold_cart","can_view_held_orders","can_reopen_held_order"],"terminal_commands":["can_manage_terminals"]}'::jsonb) LOOP
    IF to_regclass('public.' || item.key) IS NULL THEN CONTINUE; END IF;
    SELECT string_agg(format('public.has_perm(%L)', flag), ' OR ') INTO predicate
      FROM jsonb_array_elements_text(item.value) AS keys(flag);
    EXECUTE format('DROP POLICY IF EXISTS staff_feature_read ON public.%I', item.key);
    EXECUTE format('CREATE POLICY staff_feature_read ON public.%I AS RESTRICTIVE FOR SELECT TO authenticated USING (%s)', item.key, predicate);
  END LOOP;
END $policy$;
NOTIFY pgrst, 'reload schema';

-- PIN verifiers are only for trusted server/native verification, never renderer reads.
DO $columns$
DECLARE safe_columns text; secret record;
BEGIN
  REVOKE SELECT ON public.app_users FROM authenticated;
  FOR secret IN SELECT attname FROM pg_attribute WHERE attrelid='public.app_users'::regclass
    AND attnum > 0 AND NOT attisdropped AND attname IN ('pin_hash','offline_login_pin_hash') LOOP
    EXECUTE format('REVOKE SELECT (%I) ON public.app_users FROM authenticated', secret.attname);
  END LOOP;
  SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) INTO safe_columns
    FROM pg_attribute WHERE attrelid='public.app_users'::regclass AND attnum > 0 AND NOT attisdropped
      AND attname NOT IN ('pin_hash','offline_login_pin_hash');
  EXECUTE format('GRANT SELECT (%s) ON public.app_users TO authenticated', safe_columns);
END $columns$;
