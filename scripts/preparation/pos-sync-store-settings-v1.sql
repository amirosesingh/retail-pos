-- Isolated pilot only. Install after pos-sync-feed-v1.sql on a disposable
-- database. An owner must provision an empty feed head and explicitly register
-- a store before its canonical settings writes enter this pilot projection.
-- This scope admits only settings upserts. The current feed stays active.
CREATE TABLE pos_sync_feed_v1.settings_pilots (
  organization_id text COLLATE "C" NOT NULL CHECK (organization_id = 'default'),
  scope_id text COLLATE "C" NOT NULL,
  epoch uuid NOT NULL,
  PRIMARY KEY (organization_id, scope_id),
  FOREIGN KEY (organization_id, scope_id)
    REFERENCES pos_sync_feed_v1.feed_heads (organization_id, scope_id)
);

ALTER TABLE pos_sync_feed_v1.settings_pilots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE pos_sync_feed_v1.settings_pilots FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION pos_sync_feed_v1.project_store_settings(p_row public.pos_store_settings)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog
AS $project$
DECLARE
  v_fields constant text[] := ARRAY[
    'store_id', 'block_shift_close_on_hold', 'require_daily_sales_for_shift_close',
    'require_counted_cash_on_close', 'require_opening_float_count', 'enable_blind_cash_count',
    'max_drawer_cash_limit', 'require_reason_for_payout', 'allow_multiple_shifts_per_terminal',
    'allow_branch_shift_sharing', 'enable_cashier_x_report', 'show_opening_float_at_close',
    'show_expected_totals_at_close', 'show_live_variance_at_close', 'show_itemized_tender_breakdown',
    'require_manager_pin_on_variance', 'variance_pin_threshold', 'max_cashier_discount_percent',
    'max_cart_discount_amount', 'allow_discount_stacking', 'require_reason_for_price_override',
    'prevent_below_cost_sale', 'allow_tax_exemption', 'prevent_negative_stock_sale',
    'require_receipt_for_refund', 'require_manager_pin_for_refund', 'max_refund_days_limit',
    'track_item_voids', 'auto_lock_timeout_seconds', 'require_manager_pin_for_cash_drawer_open',
    'enable_manager_pin_audit_log', 'require_pin_void_cart', 'require_pin_void_line',
    'require_pin_reduce_qty', 'require_pin_manual_discount', 'require_pin_price_override',
    'require_pin_stock_adjustment', 'require_pin_shift_close', 'require_pin_edit_tenders',
    'require_pin_terminal_reset', 'row_version', 'updated_by', 'updated_at',
    'allow_offline_approvals', 'offline_approval_requires_pin', 'online_only_void_cart',
    'online_only_void_line', 'online_only_reduce_qty', 'online_only_manual_discount',
    'online_only_price_override', 'online_only_stock_adjustment', 'online_only_shift_close',
    'online_only_edit_tenders', 'online_only_terminal_reset', 'online_only_refund', 'created_at',
    'idle_timeout_minutes'
  ];
  v_numeric_fields constant text[] := ARRAY[
    'max_drawer_cash_limit', 'variance_pin_threshold', 'max_cashier_discount_percent',
    'max_cart_discount_amount', 'max_refund_days_limit', 'auto_lock_timeout_seconds'
  ];
  v_raw jsonb := to_jsonb(p_row);
  v_row jsonb;
BEGIN
  IF p_row.store_id IS NULL OR p_row.row_version IS NULL OR p_row.row_version < 1
     OR p_row.updated_at IS NULL
     OR p_row.updated_at NOT BETWEEN '0001-01-01T00:00:00Z'::timestamptz AND '9999-12-31T23:59:59.999999Z'::timestamptz
     OR p_row.created_at NOT BETWEEN '0001-01-01T00:00:00Z'::timestamptz AND '9999-12-31T23:59:59.999999Z'::timestamptz
     OR NOT v_raw ?& v_fields THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'POS_SETTINGS_V1_PROJECTION_UNAVAILABLE';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_each_text(v_raw) AS entry(key, value)
    WHERE entry.key = ANY(v_numeric_fields) AND (
      abs(entry.value::numeric) >= 1e26::numeric OR trunc(entry.value::numeric, 12) <> entry.value::numeric
    )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'POS_SETTINGS_V1_PROJECTION_UNAVAILABLE';
  END IF;

  SELECT jsonb_object_agg(entry.key,
    CASE WHEN entry.key = ANY(v_numeric_fields) AND entry.value <> 'null'::jsonb
      THEN to_jsonb(entry.value #>> '{}') ELSE entry.value END)
  INTO v_row
  FROM jsonb_each(v_raw) AS entry(key, value)
  WHERE entry.key = ANY(v_fields);

  v_row := v_row || jsonb_build_object(
    'row_version', p_row.row_version::text,
    'created_at', CASE WHEN p_row.created_at IS NOT NULL
      THEN to_char(p_row.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || '0Z' END,
    'updated_at', to_char(p_row.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || '0Z'
  );
  RETURN jsonb_build_object(
    'table_name', 'pos_store_settings',
    'entity_id', jsonb_build_object('store_id', p_row.store_id)::text,
    'row_data', v_row, 'row_version', p_row.row_version::text, 'tombstone', false
  );
END;
$project$;

REVOKE ALL ON FUNCTION pos_sync_feed_v1.project_store_settings(public.pos_store_settings)
  FROM PUBLIC, anon, authenticated, service_role;

-- Existing settings writers retain their original permissions. The trigger
-- needs owner rights only for the private publication, and takes scope from
-- the saved row. No application role can access the private projection.
CREATE FUNCTION pos_sync_feed_v1.publish_store_settings()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $publish$
DECLARE
  v_scope text;
  v_epoch uuid;
  v_change jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_scope := OLD.store_id;
  ELSE
    v_scope := NEW.store_id;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.store_id IS DISTINCT FROM NEW.store_id AND EXISTS (
    SELECT 1 FROM pos_sync_feed_v1.settings_pilots AS pilot
    WHERE pilot.organization_id = 'default' AND pilot.scope_id IN (OLD.store_id, NEW.store_id)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'POS_SETTINGS_V1_SCOPE_MOVE_UNSUPPORTED';
  END IF;

  SELECT pilot.epoch INTO v_epoch FROM pos_sync_feed_v1.settings_pilots AS pilot
  WHERE pilot.organization_id = 'default' AND pilot.scope_id = v_scope;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'POS_SETTINGS_V1_DELETE_UNSUPPORTED';
  END IF;
  v_change := pos_sync_feed_v1.project_store_settings(NEW);
  IF TG_OP = 'UPDATE' AND v_change = pos_sync_feed_v1.project_store_settings(OLD) THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.row_version <= OLD.row_version THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'POS_SETTINGS_V1_REVISION_NOT_ADVANCED';
  END IF;
  PERFORM pos_sync_feed_v1.append_groups('default', jsonb_build_array(jsonb_build_object(
    'scope_id', v_scope, 'epoch', v_epoch, 'changes', jsonb_build_array(v_change)
  )));
  RETURN NULL;
END;
$publish$;

REVOKE ALL ON FUNCTION pos_sync_feed_v1.publish_store_settings() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER pos_sync_v1_store_settings_pilot
AFTER INSERT OR UPDATE OR DELETE ON public.pos_store_settings
FOR EACH ROW EXECUTE FUNCTION pos_sync_feed_v1.publish_store_settings();

-- One bounded row and the head are read in one statement snapshot. The pin
-- fences retention while the authorized client verifies and installs it.
CREATE FUNCTION pos_sync_feed_v1.export_store_settings_snapshot(
  p_organization_id text, p_scope_id text, p_epoch uuid, p_pin_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog
AS $snapshot$
DECLARE
  v_head pos_sync_feed_v1.feed_heads%ROWTYPE;
  v_pin pos_sync_feed_v1.snapshot_pins%ROWTYPE;
  v_row public.pos_store_settings%ROWTYPE;
  v_manifest text;
BEGIN
  IF p_organization_id IS DISTINCT FROM 'default' OR p_scope_id IS NULL OR btrim(p_scope_id) = ''
     OR octet_length(p_scope_id) > 256 OR p_epoch IS NULL OR p_pin_id IS NULL THEN
    RETURN jsonb_build_object('status', 'INVALID_REQUEST');
  END IF;
  SELECT head.* INTO v_head FROM pos_sync_feed_v1.feed_heads AS head
  JOIN pos_sync_feed_v1.settings_pilots AS pilot USING (organization_id, scope_id, epoch)
  WHERE head.organization_id = p_organization_id AND head.scope_id = p_scope_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'SCOPE_UNAVAILABLE'); END IF;
  IF v_head.epoch <> p_epoch THEN
    RETURN jsonb_build_object('status', 'SNAPSHOT_REQUIRED', 'reason', 'EPOCH_MISMATCH');
  END IF;

  SELECT pin.* INTO v_pin FROM pos_sync_feed_v1.snapshot_pins AS pin
  WHERE pin.organization_id = p_organization_id AND pin.scope_id = p_scope_id
    AND pin.epoch = p_epoch AND pin.pin_id = p_pin_id AND pin.expires_at > statement_timestamp();
  IF NOT FOUND OR v_pin.protected_seq < v_head.replay_floor OR v_pin.protected_seq > v_head.head_seq THEN
    RETURN jsonb_build_object('status', 'SNAPSHOT_REQUIRED', 'reason', 'PIN_UNAVAILABLE');
  END IF;

  SELECT settings.* INTO v_row FROM public.pos_store_settings AS settings WHERE settings.store_id = p_scope_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'SCOPE_UNAVAILABLE'); END IF;
  v_manifest := jsonb_build_object('scope_id', p_scope_id, 'epoch', p_epoch, 'seq', v_head.head_seq::text,
    'changes', jsonb_build_array(pos_sync_feed_v1.project_store_settings(v_row)))::text;
  IF octet_length(v_manifest) > 65536 THEN
    RETURN jsonb_build_object('status', 'SCOPE_UNAVAILABLE');
  END IF;
  RETURN jsonb_build_object('status', 'OK', 'scope_id', p_scope_id, 'epoch', p_epoch, 'seq', v_head.head_seq::text,
    'pin_id', p_pin_id, 'expires_at', to_char(v_pin.expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || '0Z',
    'manifest_json', v_manifest, 'manifest_sha256', encode(sha256(convert_to(v_manifest, 'UTF8')), 'hex'));
END;
$snapshot$;

REVOKE ALL ON FUNCTION pos_sync_feed_v1.export_store_settings_snapshot(text, text, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
