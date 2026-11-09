-- Isolated mixed projection. Install after pos-sync-grouped-gateway-v1.sql.
-- Keep accepted checkout rows at their original commit even if the live
-- feed retires those groups or a later workflow changes a receipt.
CREATE TABLE pos_sync_feed_v1.cash_publications (
  organization_id text COLLATE "C" NOT NULL,
  scope_id text COLLATE "C" NOT NULL,
  epoch uuid NOT NULL,
  seq bigint NOT NULL CHECK (seq > 0),
  operation_id uuid NOT NULL,
  changes jsonb NOT NULL CHECK (jsonb_typeof(changes) = 'array' AND jsonb_array_length(changes) = 4),
  acceptance jsonb NOT NULL,
  PRIMARY KEY (organization_id, scope_id, epoch, seq),
  UNIQUE (organization_id, operation_id),
  FOREIGN KEY (organization_id, scope_id, epoch)
    REFERENCES pos_sync_feed_v1.cash_settings_pilots (organization_id, scope_id, epoch)
);
ALTER TABLE pos_sync_feed_v1.cash_publications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE pos_sync_feed_v1.cash_publications FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION pos_sync_feed_v1.is_settings_projection(p_changes jsonb, p_branch text)
RETURNS boolean
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = pg_catalog
RETURN coalesce(jsonb_array_length(p_changes) = 1
  AND p_changes->0->>'table_name' = 'pos_store_settings'
  AND p_changes->0->>'tombstone' = 'false'
  AND (p_changes->0->>'entity_id')::jsonb = jsonb_build_object('store_id', p_branch)
  AND p_changes->0->'row_data'->>'store_id' = p_branch
  AND jsonb_typeof(p_changes->0->'row_version') = 'string'
  AND p_changes->0->'row_data'->'row_version' = p_changes->0->'row_version', false);

-- Owner-only. Arm a fresh settings epoch before admitting any cash groups.
CREATE FUNCTION pos_sync_feed_v1.arm_cash_settings_scope(p_org text, p_branch text, p_epoch uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
AS $arm$
DECLARE
  v_head pos_sync_feed_v1.feed_heads%ROWTYPE;
BEGIN
  SELECT head.* INTO v_head FROM pos_sync_feed_v1.feed_heads AS head
  JOIN pos_sync_feed_v1.settings_pilots AS pilot USING (organization_id, scope_id, epoch)
  WHERE head.organization_id = p_org AND head.scope_id = p_branch AND head.epoch = p_epoch
  FOR NO KEY UPDATE OF head;
  IF NOT FOUND OR v_head.replay_floor <> 0 OR EXISTS (
    SELECT 1 FROM pos_sync_feed_v1.feed_groups AS feed
    WHERE (feed.organization_id, feed.scope_id, feed.epoch) = (p_org, p_branch, p_epoch)
      AND NOT pos_sync_feed_v1.is_settings_projection(feed.changes, p_branch)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'POS_CASH_SETTINGS_V1_BASELINE_UNVERIFIED';
  END IF;
  INSERT INTO pos_sync_feed_v1.cash_settings_pilots VALUES (p_org, p_branch, p_epoch, v_head.head_seq);
END;
$arm$;

-- Called only by the attested writer inside the sale/inbox/feed transaction.
CREATE FUNCTION pos_sync_feed_v1.record_cash_publication(
  p_org text, p_branch text, p_epoch uuid, p_seq bigint, p_operation uuid,
  p_terminal uuid, p_generation uuid, p_database uuid, p_hash text
)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
AS $record$
DECLARE
  v_changes jsonb;
BEGIN
  IF p_terminal IS NULL OR p_generation IS NULL OR p_database IS NULL OR p_operation IS NULL
     OR p_hash IS NULL OR p_hash !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'POS_CASH_SETTINGS_V1_INVALID_ACCEPTANCE';
  END IF;
  SELECT feed.changes INTO v_changes FROM pos_sync_feed_v1.feed_groups AS feed
  JOIN pos_sync_feed_v1.cash_settings_pilots AS pilot USING (organization_id, scope_id, epoch)
  WHERE (feed.organization_id, feed.scope_id, feed.epoch, feed.seq, feed.operation_id) =
    (p_org, p_branch, p_epoch, p_seq, p_operation) AND feed.seq > pilot.armed_after
  FOR NO KEY UPDATE OF feed;
  IF NOT FOUND OR jsonb_array_length(v_changes) <> 4
     OR v_changes->0->>'table_name' IS DISTINCT FROM 'sales'
     OR v_changes->1->>'table_name' IS DISTINCT FROM 'sale_items'
     OR v_changes->2->>'table_name' IS DISTINCT FROM 'payment_transactions'
     OR v_changes->3->>'table_name' IS DISTINCT FROM 'item_activity_logs'
     OR v_changes->0->'row_data'->>'store_id' IS DISTINCT FROM p_branch
     OR v_changes->0->'row_data'->>'branch_id' IS DISTINCT FROM p_branch
     OR v_changes->1->'row_data'->>'branch_id' IS DISTINCT FROM p_branch
     OR v_changes->2->'row_data'->>'store_id' IS DISTINCT FROM p_branch
     OR v_changes->3->'row_data'->>'store_id' IS DISTINCT FROM p_branch
     OR v_changes->2->'row_data'->>'terminal_id' IS DISTINCT FROM p_terminal::text
     OR v_changes->3->'row_data'->>'terminal_id' IS DISTINCT FROM p_terminal::text THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'POS_CASH_SETTINGS_V1_PUBLICATION_UNVERIFIED';
  END IF;
  INSERT INTO pos_sync_feed_v1.cash_publications VALUES (
    p_org, p_branch, p_epoch, p_seq, p_operation, v_changes,
    jsonb_build_object('terminal_id', p_terminal, 'installation_generation', p_generation,
      'database_guid', p_database, 'checkout_sha256', p_hash));
END;
$record$;

-- The writer can convert the private cash evidence to public receipt rows
-- within its transaction. At commit, any non-settings group must have the
-- matching durable archive. Otherwise it could later vanish in a snapshot.
CREATE FUNCTION pos_sync_feed_v1.assert_cash_settings_projection()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
AS $guard$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pos_sync_feed_v1.feed_groups AS feed
    JOIN pos_sync_feed_v1.cash_settings_pilots AS pilot USING (organization_id, scope_id, epoch)
    LEFT JOIN pos_sync_feed_v1.cash_publications AS cash USING (organization_id, scope_id, epoch, seq)
    WHERE (feed.organization_id, feed.scope_id, feed.epoch, feed.seq) =
      (NEW.organization_id, NEW.scope_id, NEW.epoch, NEW.seq)
      AND (CASE WHEN cash.operation_id IS NULL
           THEN NOT pos_sync_feed_v1.is_settings_projection(feed.changes, feed.scope_id)
           ELSE (cash.operation_id, cash.changes) IS DISTINCT FROM (feed.operation_id, feed.changes)
           END)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'POS_CASH_SETTINGS_V1_PUBLICATION_UNVERIFIED';
  END IF;
  RETURN NULL;
END;
$guard$;
CREATE CONSTRAINT TRIGGER pos_sync_cash_settings_projection
AFTER INSERT OR UPDATE ON pos_sync_feed_v1.feed_groups DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION pos_sync_feed_v1.assert_cash_settings_projection();

CREATE FUNCTION public.pos_sync_pull_cash_settings_v1(
  p_organization_id text, p_branch_id text, p_terminal_id uuid, p_binding_proof text,
  p_epoch uuid, p_after_seq text, p_upper_seq text, p_limit integer
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $pull$
DECLARE
  v_epoch uuid;
  v_page jsonb;
  v_groups jsonb;
BEGIN
  PERFORM pos_sync_feed_v1.assert_grouped_gateway_scope(p_organization_id, p_branch_id, p_terminal_id, p_binding_proof);
  SELECT head.epoch INTO v_epoch FROM pos_sync_feed_v1.feed_heads AS head
  JOIN pos_sync_feed_v1.cash_settings_pilots AS pilot USING (organization_id, scope_id, epoch)
  WHERE head.organization_id = p_organization_id AND head.scope_id = p_branch_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'SCOPE_UNAVAILABLE'); END IF;
  IF to_regclass('pos_sync_feed_v1.extended_pilots') IS NOT NULL THEN
    IF EXISTS(SELECT 1 FROM pos_sync_feed_v1.extended_pilots
      WHERE (organization_id,scope_id,epoch)=(p_organization_id,p_branch_id,v_epoch)) THEN
      RETURN jsonb_build_object('status','SCOPE_UNAVAILABLE');
    END IF;
  END IF;

  v_page := pos_sync_feed_v1.pull_groups(p_organization_id, p_branch_id, p_epoch, p_after_seq, p_upper_seq, p_limit);
  IF v_page->>'status' <> 'OK' THEN RETURN v_page; END IF;
  SELECT coalesce(jsonb_agg(
    CASE WHEN cash.operation_id IS NOT NULL THEN page.value || jsonb_build_object('acceptance', cash.acceptance)
         WHEN pos_sync_feed_v1.is_settings_projection(page.value->'changes', p_branch_id) THEN page.value
    END ORDER BY page.ordinal), '[]'::jsonb) INTO v_groups
  FROM jsonb_array_elements(v_page->'groups') WITH ORDINALITY AS page(value, ordinal)
  LEFT JOIN pos_sync_feed_v1.cash_publications AS cash
    ON cash.organization_id = p_organization_id AND cash.scope_id = p_branch_id AND cash.epoch = v_epoch
    AND cash.seq = (page.value->>'seq')::bigint AND cash.operation_id = (page.value->>'operation_id')::uuid
    AND cash.changes = page.value->'changes';
  IF v_groups @> '[null]'::jsonb THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'POS_CASH_SETTINGS_V1_PUBLICATION_UNVERIFIED';
  END IF;
  RETURN jsonb_set(v_page, '{groups}', v_groups);
END;
$pull$;

CREATE FUNCTION public.pos_sync_snapshot_cash_settings_v1(
  p_organization_id text, p_branch_id text, p_terminal_id uuid, p_binding_proof text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $snapshot$
DECLARE
  v_head pos_sync_feed_v1.feed_heads%ROWTYPE;
  v_pin jsonb;
  v_base jsonb;
  v_groups jsonb;
  v_manifest text;
BEGIN
  PERFORM pos_sync_feed_v1.assert_grouped_gateway_scope(p_organization_id, p_branch_id, p_terminal_id, p_binding_proof);
  SELECT head.* INTO v_head FROM pos_sync_feed_v1.feed_heads AS head
  JOIN pos_sync_feed_v1.cash_settings_pilots AS pilot USING (organization_id, scope_id, epoch)
  WHERE head.organization_id = p_organization_id AND head.scope_id = p_branch_id
  FOR NO KEY UPDATE OF head;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'SCOPE_UNAVAILABLE'); END IF;
  IF to_regclass('pos_sync_feed_v1.extended_pilots') IS NOT NULL THEN
    IF EXISTS(SELECT 1 FROM pos_sync_feed_v1.extended_pilots
      WHERE (organization_id,scope_id,epoch)=(p_organization_id,p_branch_id,v_head.epoch)) THEN
      RETURN jsonb_build_object('status','SCOPE_UNAVAILABLE');
    END IF;
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object('seq', seq::text, 'operation_id', operation_id,
    'changes', changes, 'acceptance', acceptance) ORDER BY seq), '[]'::jsonb)
  INTO v_groups FROM (
    SELECT seq, operation_id, changes, acceptance
    FROM pos_sync_feed_v1.cash_publications
    WHERE (organization_id, scope_id, epoch) = (p_organization_id, p_branch_id, v_head.epoch)
      AND seq <= v_head.head_seq
    ORDER BY seq LIMIT 101
  ) AS scoped;
  IF jsonb_array_length(v_groups) > 100 OR octet_length(v_groups::text) > 1572864 THEN
    RETURN jsonb_build_object('status', 'SNAPSHOT_REQUIRED', 'reason', 'GROUP_TOO_LARGE');
  END IF;
  SELECT jsonb_build_object('status', 'OK', 'pin_id', pin.pin_id) INTO v_pin
  FROM pos_sync_feed_v1.snapshot_pins AS pin
  WHERE (pin.organization_id, pin.scope_id, pin.epoch) = (p_organization_id, p_branch_id, v_head.epoch)
    AND pin.protected_seq BETWEEN v_head.replay_floor AND v_head.head_seq
    AND pin.expires_at > clock_timestamp() + interval '2 minutes'
  ORDER BY pin.expires_at DESC, pin.pin_id LIMIT 1;
  IF NOT FOUND THEN
    v_pin := pos_sync_feed_v1.create_snapshot_pin(p_organization_id, p_branch_id, v_head.epoch, 300);
  END IF;
  IF v_pin->>'status' IS DISTINCT FROM 'OK' THEN RETURN v_pin; END IF;
  v_base := pos_sync_feed_v1.export_store_settings_snapshot(p_organization_id, p_branch_id, v_head.epoch,
    (v_pin->>'pin_id')::uuid);
  IF v_base->>'status' IS DISTINCT FROM 'OK' THEN RETURN v_base; END IF;
  v_manifest := ((v_base->>'manifest_json')::jsonb || jsonb_build_object('cash_groups', v_groups))::text;
  IF octet_length(v_manifest) > 1835008 THEN
    RETURN jsonb_build_object('status', 'SNAPSHOT_REQUIRED', 'reason', 'GROUP_TOO_LARGE');
  END IF;
  v_base := v_base || jsonb_build_object('manifest_json', v_manifest,
    'manifest_sha256', encode(sha256(convert_to(v_manifest, 'UTF8')), 'hex'));
  IF octet_length(v_base::text) > 2097152 THEN
    RETURN jsonb_build_object('status', 'SNAPSHOT_REQUIRED', 'reason', 'GROUP_TOO_LARGE');
  END IF;
  RETURN v_base;
END;
$snapshot$;

REVOKE ALL ON FUNCTION pos_sync_feed_v1.is_settings_projection(jsonb,text),
  pos_sync_feed_v1.arm_cash_settings_scope(text,text,uuid),
  pos_sync_feed_v1.record_cash_publication(text,text,uuid,bigint,uuid,uuid,uuid,uuid,text),
  pos_sync_feed_v1.assert_cash_settings_projection() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.pos_sync_pull_cash_settings_v1(text,text,uuid,text,uuid,text,text,integer),
  public.pos_sync_snapshot_cash_settings_v1(text,text,uuid,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pos_sync_pull_cash_settings_v1(text,text,uuid,text,uuid,text,text,integer),
  public.pos_sync_snapshot_cash_settings_v1(text,text,uuid,text) TO service_role;
