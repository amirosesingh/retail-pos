-- A location may be removed only when no business, operator, inventory, or
-- audit record still refers to it. Configuration and sync bookkeeping are
-- housekeeping rather than business history and are removed transactionally.
CREATE OR REPLACE FUNCTION public.delete_empty_store(
  p_store_id text,
  p_confirmation_name text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  target public.stores%ROWTYPE;
  blockers jsonb;
BEGIN
  SELECT * INTO target FROM public.stores WHERE id::text = p_store_id FOR UPDATE;
  IF target.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'That location no longer exists.');
  END IF;
  IF btrim(coalesce(p_confirmation_name, '')) <> target.name THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Type the exact location name to confirm deletion.');
  END IF;

  blockers := jsonb_build_object(
    'child locations', (SELECT count(*) FROM public.stores WHERE parent_id::text = p_store_id),
    'staff accounts',
      (SELECT count(*) FROM public.app_users WHERE store_id::text = p_store_id) +
      (SELECT count(*) FROM public.cashiers WHERE store_id::text = p_store_id),
    'sales', (SELECT count(*) FROM public.sales WHERE store_id::text = p_store_id OR branch_id::text = p_store_id),
    'sale items', (SELECT count(*) FROM public.sale_items WHERE branch_id::text = p_store_id),
    'payments', (SELECT count(*) FROM public.payment_transactions WHERE store_id::text = p_store_id),
    'bookings', (SELECT count(*) FROM public.bookings WHERE store_id::text = p_store_id),
    'held orders', (SELECT count(*) FROM public.held_orders WHERE store_id::text = p_store_id),
    'vouchers and coupons',
      (SELECT count(*) FROM public.issued_vouchers WHERE store_id::text = p_store_id) +
      (SELECT count(*) FROM public.coupon_events WHERE store_id::text = p_store_id),
    'shifts and cash counts',
      (SELECT count(*) FROM public.shifts WHERE store_id::text = p_store_id) +
      (SELECT count(*) FROM public.shift_sessions WHERE store_id::text = p_store_id) +
      (SELECT count(*) FROM public.shift_cash_counts WHERE store_id::text = p_store_id) +
      (SELECT count(*) FROM public.shift_close_events WHERE store_id::text = p_store_id) +
      (SELECT count(*) FROM public.shift_reconciliations WHERE store_id::text = p_store_id) +
      (SELECT count(*) FROM public.shift_variance_alerts WHERE store_id::text = p_store_id) +
      (SELECT count(*) FROM public.shift_notifications WHERE store_id::text = p_store_id),
    'drawer events', (SELECT count(*) FROM public.drawer_events WHERE store_id::text = p_store_id),
    'purchase orders', (SELECT count(*) FROM public.purchase_orders WHERE store_id::text = p_store_id),
    'stock transfers', (SELECT count(*) FROM public.stock_transfers WHERE from_store_id::text = p_store_id OR to_store_id::text = p_store_id),
    'inventory records',
      (SELECT count(*) FROM public.stock_adjustments WHERE store_id::text = p_store_id) +
      (SELECT count(*) FROM public.stock_count_drafts WHERE store_id::text = p_store_id) +
      (SELECT count(*) FROM public.stock_delta_applied WHERE store_id::text = p_store_id) +
      (SELECT count(*) FROM public.sku_audit WHERE store_id::text = p_store_id) +
      (SELECT count(*) FROM public.sku_number_leases WHERE store_id::text = p_store_id),
    'owned products', (SELECT count(*) FROM public.products WHERE owner_store_id::text = p_store_id),
    'units on hand', (SELECT count(*) FROM public.products WHERE coalesce((stock_by_store ->> p_store_id)::numeric, 0) <> 0),
    'audit and activity history',
      (SELECT count(*) FROM public.audit_logs WHERE store_id::text = p_store_id) +
      (SELECT count(*) FROM public.system_audit_logs WHERE store_id::text = p_store_id) +
      (SELECT count(*) FROM public.activity_events WHERE store_id::text = p_store_id OR branch_id::text = p_store_id) +
      (SELECT count(*) FROM public.item_activity_logs WHERE store_id::text = p_store_id) +
      (SELECT count(*) FROM public.offline_sync_audit_log WHERE store_id::text = p_store_id) +
      (SELECT count(*) FROM public.entity_status_history WHERE store_id::text = p_store_id OR branch_id::text = p_store_id),
    'member verification history', (SELECT count(*) FROM public.member_verifications WHERE store_id::text = p_store_id),
    'authorization and edit history',
      (SELECT count(*) FROM public.authorization_requests WHERE store_id::text = p_store_id) +
      (SELECT count(*) FROM public.authorization_log WHERE store_id::text = p_store_id) +
      (SELECT count(*) FROM public.record_edits WHERE store_id::text = p_store_id) +
      (SELECT count(*) FROM public.authorization_actions WHERE lower(scope_type) = 'branch' AND scope_id::text = p_store_id) +
      (SELECT count(*) FROM public.authorization_action_history WHERE lower(scope_type) = 'branch' AND scope_id::text = p_store_id) +
      (SELECT count(*) FROM public.change_history WHERE lower(scope_type) = 'branch' AND scope_id::text = p_store_id),
    'terminal commands', (SELECT count(*) FROM public.terminal_commands WHERE store_id::text = p_store_id),
    'user sessions', (SELECT count(*) FROM public.user_sessions WHERE branch_id::text = p_store_id),
    'active terminals', (SELECT count(*) FROM public.terminal_tokens WHERE location_id::text = p_store_id AND revoked_at IS NULL),
    'messages', (SELECT count(*) FROM public.whatsapp_queue WHERE store_id::text = p_store_id)
  );

  IF EXISTS (
    SELECT 1 FROM jsonb_each_text(blockers) item WHERE item.value::bigint > 0
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'This location still has connected records.', 'blockers', blockers);
  END IF;
  IF target.is_active IS DISTINCT FROM false
     AND (SELECT count(*) FROM public.stores WHERE is_active IS DISTINCT FROM false) <= 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'At least one active location must remain.');
  END IF;

  DELETE FROM public.pos_store_settings WHERE store_id::text = p_store_id;
  DELETE FROM public.settings_overrides WHERE lower(scope) = 'branch' AND scope_id::text = p_store_id;
  DELETE FROM public.settings_scoped WHERE lower(scope) = 'branch' AND scope_id::text = p_store_id;
  DELETE FROM public.branch_telemetry WHERE store_id::text = p_store_id OR branch_id::text = p_store_id;
  DELETE FROM public.sync_metadata WHERE store_id::text = p_store_id;
  DELETE FROM public.sync_idempotency_receipts WHERE branch_id::text = p_store_id;
  DELETE FROM public.sync_change_feed WHERE branch_id::text = p_store_id;
  DELETE FROM public.settings_overrides
   WHERE lower(scope) = 'terminal'
     AND scope_id::text IN (
       SELECT id::text FROM public.terminal_tokens WHERE location_id::text = p_store_id
     );
  DELETE FROM public.settings_scoped
   WHERE lower(scope) = 'terminal'
     AND scope_id::text IN (
       SELECT id::text FROM public.terminal_tokens WHERE location_id::text = p_store_id
     );
  DELETE FROM public.terminal_recovery_secrets
   WHERE terminal_token_id::text IN (
     SELECT id::text FROM public.terminal_tokens WHERE location_id::text = p_store_id
   );
  DELETE FROM public.terminal_tokens WHERE location_id::text = p_store_id;
  UPDATE public.products
     SET stock_by_store = stock_by_store - p_store_id,
         updated_at = now(),
         row_version = coalesce(row_version, 0) + 1
   WHERE stock_by_store ? p_store_id;
  DELETE FROM public.stores WHERE id = target.id;

  RETURN jsonb_build_object('ok', true, 'deletedId', p_store_id, 'deletedName', target.name);
END
$function$;

REVOKE ALL ON FUNCTION public.delete_empty_store(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_empty_store(text, text) TO service_role;

