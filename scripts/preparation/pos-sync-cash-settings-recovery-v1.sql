-- Isolated paged recovery. Install after pos-sync-cash-settings-gateway-v1.
-- The feed head fences grouped commits while one SQL statement freezes the
-- complete archive index and the canonical branch-owned stock projection.
CREATE TABLE pos_sync_feed_v1.cash_settings_recovery_exports (
  organization_id text COLLATE "C" NOT NULL,
  scope_id text COLLATE "C" NOT NULL,
  pin_id uuid NOT NULL,
  terminal_id uuid NOT NULL,
  manifest jsonb NOT NULL,
  PRIMARY KEY (organization_id, scope_id, pin_id),
  UNIQUE (organization_id, scope_id, terminal_id),
  FOREIGN KEY (organization_id, scope_id, pin_id)
    REFERENCES pos_sync_feed_v1.snapshot_pins ON DELETE CASCADE
);

CREATE TABLE pos_sync_feed_v1.cash_settings_recovery_entries (
  organization_id text COLLATE "C" NOT NULL,
  scope_id text COLLATE "C" NOT NULL,
  pin_id uuid NOT NULL,
  kind text COLLATE "C" NOT NULL CHECK (kind IN ('cash', 'stock')),
  ordinal bigint NOT NULL CHECK (ordinal > 0),
  cash_seq bigint,
  cash_sha256 text,
  stock_row jsonb,
  PRIMARY KEY (organization_id, scope_id, pin_id, kind, ordinal),
  FOREIGN KEY (organization_id, scope_id, pin_id)
    REFERENCES pos_sync_feed_v1.cash_settings_recovery_exports ON DELETE CASCADE,
  CHECK ((kind = 'cash' AND cash_seq IS NOT NULL AND cash_sha256 IS NOT NULL AND stock_row IS NULL) OR
         (kind = 'stock' AND cash_seq IS NULL AND cash_sha256 IS NULL AND stock_row IS NOT NULL))
);

ALTER TABLE pos_sync_feed_v1.cash_settings_recovery_exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_sync_feed_v1.cash_settings_recovery_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE pos_sync_feed_v1.cash_settings_recovery_exports,
  pos_sync_feed_v1.cash_settings_recovery_entries FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION pos_sync_feed_v1.cash_recovery_row(p_row pos_sync_feed_v1.cash_publications)
RETURNS jsonb LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = pg_catalog
RETURN jsonb_build_object('seq', p_row.seq::text, 'operation_id', p_row.operation_id,
  'changes', p_row.changes, 'acceptance', p_row.acceptance);

CREATE FUNCTION public.pos_sync_begin_cash_settings_recovery_v1(
  p_organization_id text, p_branch_id text, p_terminal_id uuid, p_binding_proof text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $begin$
DECLARE
  v_head pos_sync_feed_v1.feed_heads%ROWTYPE;
  v_pin pos_sync_feed_v1.snapshot_pins%ROWTYPE;
  v_manifest jsonb;
  v_base jsonb;
  v_saved record;
  v_stats record;
  v_text text;
BEGIN
  PERFORM pos_sync_feed_v1.assert_grouped_gateway_scope(p_organization_id, p_branch_id, p_terminal_id, p_binding_proof);
  SELECT head.* INTO v_head
  FROM pos_sync_feed_v1.feed_heads AS head
  JOIN pos_sync_feed_v1.cash_settings_pilots AS pilot USING (organization_id, scope_id, epoch)
  WHERE head.organization_id = p_organization_id AND head.scope_id = p_branch_id
  FOR NO KEY UPDATE OF head;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'SCOPE_UNAVAILABLE'); END IF;

  -- One reusable export per enrolled reader bounds retries and disk usage.
  SELECT pin AS pin_row, export.manifest INTO v_saved
  FROM pos_sync_feed_v1.cash_settings_recovery_exports AS export
  JOIN pos_sync_feed_v1.snapshot_pins AS pin USING (organization_id, scope_id, pin_id)
  WHERE export.organization_id = p_organization_id AND export.scope_id = p_branch_id
    AND export.terminal_id = p_terminal_id AND pin.epoch = v_head.epoch
    AND pin.protected_seq BETWEEN v_head.replay_floor AND v_head.head_seq
    AND pin.expires_at > clock_timestamp() + interval '2 minutes';
  IF FOUND THEN
    v_pin := v_saved.pin_row;
    v_manifest := v_saved.manifest;
  ELSE
    DELETE FROM pos_sync_feed_v1.snapshot_pins AS pin
    USING pos_sync_feed_v1.cash_settings_recovery_exports AS export
    WHERE (pin.organization_id, pin.scope_id, pin.pin_id) = (export.organization_id, export.scope_id, export.pin_id)
      AND export.organization_id = p_organization_id AND export.scope_id = p_branch_id
      AND export.terminal_id = p_terminal_id;

    v_base := pos_sync_feed_v1.create_snapshot_pin(p_organization_id, p_branch_id, v_head.epoch, 1800);
    IF v_base->>'status' IS DISTINCT FROM 'OK' THEN RETURN v_base; END IF;
    SELECT pin.* INTO STRICT v_pin FROM pos_sync_feed_v1.snapshot_pins AS pin
    WHERE (pin.organization_id, pin.scope_id, pin.pin_id) =
      (p_organization_id, p_branch_id, (v_base->>'pin_id')::uuid);
    v_base := pos_sync_feed_v1.export_store_settings_snapshot(p_organization_id, p_branch_id, v_head.epoch, v_pin.pin_id);
    IF v_base->>'status' IS DISTINCT FROM 'OK' THEN
      DELETE FROM pos_sync_feed_v1.snapshot_pins AS pin WHERE (pin.organization_id, pin.scope_id, pin.pin_id) =
        (p_organization_id, p_branch_id, v_pin.pin_id);
      RETURN v_base;
    END IF;
    INSERT INTO pos_sync_feed_v1.cash_settings_recovery_exports
    VALUES (p_organization_id, p_branch_id, v_pin.pin_id, p_terminal_id, '{}'::jsonb);

    WITH stock AS MATERIALIZED (
      SELECT product.id, product.row_version,
        CASE
          WHEN jsonb_typeof(product.stock_by_store) IS DISTINCT FROM 'object' THEN NULL
          WHEN NOT product.stock_by_store ? p_branch_id THEN 0
          WHEN jsonb_typeof(product.stock_by_store->p_branch_id) = 'number'
            AND product.stock_by_store->>p_branch_id ~ '^-?(0|[1-9][0-9]{0,9})$'
          THEN CASE WHEN (product.stock_by_store->>p_branch_id)::bigint BETWEEN -2147483648 AND 2147483647
            THEN (product.stock_by_store->>p_branch_id)::integer END
        END AS balance
      FROM public.products AS product
      WHERE product.owner_store_id = p_branch_id
    ), cash AS MATERIALIZED (
      SELECT publication.seq, pos_sync_feed_v1.cash_recovery_row(publication) AS row,
        publication.changes->1->'row_data'->>'product_id' AS product_id,
        publication.changes->3->'row_data'->>'id' AS movement_id,
        publication.changes->3->'row_data'->>'quantity_delta' AS quantity_delta
      FROM pos_sync_feed_v1.cash_publications AS publication
      WHERE (publication.organization_id, publication.scope_id, publication.epoch) =
        (p_organization_id, p_branch_id, v_head.epoch)
        AND publication.seq <= v_pin.protected_seq
    ), frozen_cash AS (
      INSERT INTO pos_sync_feed_v1.cash_settings_recovery_entries
      SELECT p_organization_id, p_branch_id, v_pin.pin_id, 'cash', row_number() OVER (ORDER BY cash.seq),
        cash.seq, encode(sha256(convert_to(cash.row::text, 'UTF8')), 'hex'), NULL
      FROM cash
      JOIN stock ON stock.id = cash.product_id::uuid AND stock.balance IS NOT NULL AND stock.row_version > 0
      JOIN public.stock_delta_applied AS delta ON delta.movement_id = cash.movement_id::uuid
        AND delta.product_id = stock.id AND delta.store_id = p_branch_id AND delta.delta::text = cash.quantity_delta
      RETURNING 1
    ), frozen_stock AS (
      INSERT INTO pos_sync_feed_v1.cash_settings_recovery_entries
      SELECT p_organization_id, p_branch_id, v_pin.pin_id, 'stock', row_number() OVER (ORDER BY stock.id),
        NULL, NULL, jsonb_build_object('product_id', stock.id, 'branch_balance', stock.balance, 'row_version', stock.row_version)
      FROM stock WHERE stock.balance IS NOT NULL AND stock.row_version > 0
      RETURNING 1
    )
    SELECT (SELECT count(*) FROM cash) AS cash_expected, (SELECT count(*) FROM frozen_cash) AS cash_count,
      (SELECT count(*) FROM stock) AS stock_expected, (SELECT count(*) FROM frozen_stock) AS stock_count
    INTO STRICT v_stats;
    IF v_stats.cash_count <> v_stats.cash_expected OR v_stats.stock_count <> v_stats.stock_expected THEN
      RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'POS_CASH_RECOVERY_STOCK_UNVERIFIED';
    END IF;

    v_manifest := (v_base->>'manifest_json')::jsonb ||
      jsonb_build_object('cash_count', v_stats.cash_count::text, 'stock_count', v_stats.stock_count::text);
    UPDATE pos_sync_feed_v1.cash_settings_recovery_exports AS export SET manifest = v_manifest
    WHERE (export.organization_id, export.scope_id, export.pin_id) = (p_organization_id, p_branch_id, v_pin.pin_id);
  END IF;
  v_text := v_manifest::text;
  RETURN jsonb_build_object('status', 'OK', 'scope_id', p_branch_id, 'epoch', v_pin.epoch,
    'seq', v_pin.protected_seq::text, 'pin_id', v_pin.pin_id, 'expires_at', v_pin.expires_at,
    'manifest_json', v_text, 'manifest_sha256', encode(sha256(convert_to(v_text, 'UTF8')), 'hex'));
END;
$begin$;

CREATE FUNCTION public.pos_sync_page_cash_settings_recovery_v1(
  p_organization_id text, p_branch_id text, p_terminal_id uuid, p_binding_proof text,
  p_pin_id uuid, p_kind text, p_after text, p_limit integer
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $page$
DECLARE
  v_pin pos_sync_feed_v1.snapshot_pins%ROWTYPE;
  v_total bigint;
  v_saved record;
  v_after bigint;
  v_next bigint;
  v_entries jsonb := '[]'::jsonb;
  v_entry record;
  v_bytes integer := 2;
  v_text text;
BEGIN
  PERFORM pos_sync_feed_v1.assert_grouped_gateway_scope(p_organization_id, p_branch_id, p_terminal_id, p_binding_proof);
  IF p_pin_id IS NULL OR p_kind IS NULL OR p_kind NOT IN ('cash', 'stock')
     OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR p_after IS NULL
     OR p_after !~ '^(0|[1-9][0-9]{0,18})$' THEN
    RETURN jsonb_build_object('status', 'INVALID_CURSOR');
  END IF;
  IF p_after::numeric > 9223372036854775807 THEN RETURN jsonb_build_object('status', 'INVALID_CURSOR'); END IF;
  SELECT pin AS pin_row, (export.manifest->>(p_kind || '_count'))::bigint AS total INTO v_saved
  FROM pos_sync_feed_v1.cash_settings_recovery_exports AS export
  JOIN pos_sync_feed_v1.snapshot_pins AS pin USING (organization_id, scope_id, pin_id)
  JOIN pos_sync_feed_v1.feed_heads AS head USING (organization_id, scope_id, epoch)
  WHERE export.organization_id = p_organization_id AND export.scope_id = p_branch_id
    AND export.terminal_id = p_terminal_id AND export.pin_id = p_pin_id
    AND pin.protected_seq BETWEEN head.replay_floor AND head.head_seq
    AND pin.expires_at > clock_timestamp();
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'SNAPSHOT_REQUIRED', 'reason', 'PIN_UNAVAILABLE'); END IF;
  v_pin := v_saved.pin_row;
  v_total := v_saved.total;
  v_after := p_after::bigint;
  v_next := v_after;
  IF v_after > v_total THEN RETURN jsonb_build_object('status', 'INVALID_CURSOR'); END IF;

  FOR v_entry IN
    SELECT entry.ordinal, coalesce(entry.stock_row, pos_sync_feed_v1.cash_recovery_row(cash)) AS row, entry.cash_sha256
    FROM pos_sync_feed_v1.cash_settings_recovery_entries AS entry
    LEFT JOIN pos_sync_feed_v1.cash_publications AS cash
      ON (cash.organization_id, cash.scope_id, cash.epoch, cash.seq) =
        (entry.organization_id, entry.scope_id, v_pin.epoch, entry.cash_seq)
    WHERE (entry.organization_id, entry.scope_id, entry.pin_id, entry.kind) =
      (p_organization_id, p_branch_id, p_pin_id, p_kind)
      AND entry.ordinal > v_after
    ORDER BY entry.ordinal LIMIT p_limit
  LOOP
    IF v_entry.ordinal <> v_next + 1 OR v_entry.ordinal > v_total OR v_entry.row IS NULL OR
       (p_kind = 'cash' AND encode(sha256(convert_to(v_entry.row::text, 'UTF8')), 'hex') IS DISTINCT FROM v_entry.cash_sha256) THEN
      RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'POS_CASH_RECOVERY_ARCHIVE_UNVERIFIED';
    END IF;
    EXIT WHEN v_bytes + octet_length(v_entry.row::text) + 2 > 786432;
    v_bytes := v_bytes + octet_length(v_entry.row::text) + 2;
    v_entries := v_entries || jsonb_build_array(v_entry.row);
    v_next := v_entry.ordinal;
  END LOOP;
  IF v_next = v_after AND v_after < v_total THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'POS_CASH_RECOVERY_ARCHIVE_UNVERIFIED';
  END IF;
  v_text := jsonb_build_object('scope_id', p_branch_id, 'epoch', v_pin.epoch,
    'seq', v_pin.protected_seq::text, 'pin_id', p_pin_id, 'kind', p_kind,
    'after', p_after, 'next', v_next::text, 'total', v_total::text, 'rows', v_entries)::text;
  RETURN jsonb_build_object('status', 'OK', 'scope_id', p_branch_id, 'epoch', v_pin.epoch,
    'seq', v_pin.protected_seq::text, 'pin_id', p_pin_id, 'expires_at', v_pin.expires_at,
    'payload_json', v_text, 'payload_sha256', encode(sha256(convert_to(v_text, 'UTF8')), 'hex'));
END;
$page$;

REVOKE ALL ON FUNCTION pos_sync_feed_v1.cash_recovery_row(pos_sync_feed_v1.cash_publications)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.pos_sync_begin_cash_settings_recovery_v1(text,text,uuid,text),
  public.pos_sync_page_cash_settings_recovery_v1(text,text,uuid,text,uuid,text,text,integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pos_sync_begin_cash_settings_recovery_v1(text,text,uuid,text),
  public.pos_sync_page_cash_settings_recovery_v1(text,text,uuid,text,uuid,text,text,integer)
  TO service_role;
