-- Large JSON settings and audit rows can make a nominal 100-row page tens of
-- megabytes. Device clients deliberately request smaller pages, so the RPCs
-- must not silently raise that request back to 100 rows.
DO $migration$
DECLARE
  signature regprocedure;
  definition text;
  updated text;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'public.pos_sync_pull(text,text,text,bigint,integer)'::regprocedure,
    'public.pos_sync_bootstrap(text,text,text,text,text,integer,integer)'::regprocedure
  ]
  LOOP
    SELECT pg_get_functiondef(signature) INTO definition;
    updated := replace(
      definition,
      'LEAST(GREATEST(p_limit,100),2000)',
      'LEAST(GREATEST(p_limit,10),2000)'
    );
    IF updated = definition THEN
      RAISE EXCEPTION 'Expected sync page clamp was not found in %', signature;
    END IF;
    EXECUTE updated;
  END LOOP;
END
$migration$;

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
    'staff accounts', (SELECT count(*) FROM public.app_users WHERE store_id::text = p_store_id),
    'sales', (SELECT count(*) FROM public.sales WHERE store_id::text = p_store_id OR branch_id::text = p_store_id),
    'sale items', (SELECT count(*) FROM public.sale_items WHERE branch_id::text = p_store_id),
    'payments', (SELECT count(*) FROM public.payment_transactions WHERE store_id::text = p_store_id),
    'bookings', (SELECT count(*) FROM public.bookings WHERE store_id::text = p_store_id),
    'held orders', (SELECT count(*) FROM public.held_orders WHERE store_id::text = p_store_id),
    'shifts', (SELECT count(*) FROM public.shifts WHERE store_id::text = p_store_id),
    'shift sessions', (SELECT count(*) FROM public.shift_sessions WHERE store_id::text = p_store_id),
    'drawer events', (SELECT count(*) FROM public.drawer_events WHERE store_id::text = p_store_id),
    'purchase orders', (SELECT count(*) FROM public.purchase_orders WHERE store_id::text = p_store_id),
    'stock transfers', (SELECT count(*) FROM public.stock_transfers WHERE from_store_id::text = p_store_id OR to_store_id::text = p_store_id),
    'stock adjustments', (SELECT count(*) FROM public.stock_adjustments WHERE store_id::text = p_store_id),
    'stock counts', (SELECT count(*) FROM public.stock_count_drafts WHERE store_id::text = p_store_id),
    'owned products', (SELECT count(*) FROM public.products WHERE owner_store_id::text = p_store_id),
    'units on hand', (SELECT count(*) FROM public.products WHERE coalesce((stock_by_store ->> p_store_id)::numeric, 0) <> 0),
    'audit history', (SELECT count(*) FROM public.audit_logs WHERE store_id::text = p_store_id),
    'activity history', (SELECT count(*) FROM public.activity_events WHERE store_id::text = p_store_id OR branch_id::text = p_store_id),
    'active terminals', (SELECT count(*) FROM public.terminal_tokens WHERE location_id::text = p_store_id AND revoked_at IS NULL)
  );

  IF EXISTS (
    SELECT 1 FROM jsonb_each_text(blockers) item WHERE item.value::bigint > 0
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'This location still has connected records.', 'blockers', blockers);
  END IF;
  IF (SELECT count(*) FROM public.stores WHERE is_active IS DISTINCT FROM false) <= 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'At least one active location must remain.');
  END IF;

  DELETE FROM public.pos_store_settings WHERE store_id::text = p_store_id;
  DELETE FROM public.settings_overrides WHERE lower(scope) = 'branch' AND scope_id::text = p_store_id;
  DELETE FROM public.settings_scoped WHERE lower(scope) = 'branch' AND scope_id::text = p_store_id;
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
