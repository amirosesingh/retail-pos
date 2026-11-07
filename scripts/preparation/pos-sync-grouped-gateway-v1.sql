-- Isolated preparation. Install after the private feed and settings pilot.
-- Only the server role may execute these two fixed gateways. Registration is
-- rechecked in the same transaction as the authorized branch read.
CREATE FUNCTION pos_sync_feed_v1.assert_grouped_gateway_scope(
  p_organization_id text, p_branch_id text, p_terminal_id uuid, p_binding_proof text
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $scope$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' OR p_organization_id IS DISTINCT FROM 'default'
     OR p_terminal_id IS NULL OR p_binding_proof IS NULL OR p_binding_proof !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'POS_GROUPED_GATEWAY_V1_SCOPE_FORBIDDEN';
  END IF;
  PERFORM public.pos_sync_validate_scope(p_organization_id, p_branch_id, p_terminal_id::text);
  PERFORM 1 FROM public.terminal_tokens AS token
  WHERE token.id = p_terminal_id AND token.location_id = p_branch_id AND token.platform = 'pc'
    AND token.status IN ('active', 'used') AND token.revoked_at IS NULL
    AND (token.is_claimed OR token.claimed_at IS NOT NULL)
    AND (token.claimed_platform IS NULL OR token.claimed_platform = 'electron')
    AND lower(coalesce(nullif(token.claim_proof, ''), token.claimed_proof_hash)) = p_binding_proof
    AND EXISTS (SELECT 1 FROM public.stores AS store WHERE store.id = p_branch_id)
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'POS_GROUPED_GATEWAY_V1_SCOPE_FORBIDDEN';
  END IF;
END;
$scope$;
REVOKE ALL ON FUNCTION pos_sync_feed_v1.assert_grouped_gateway_scope(text, text, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.pos_sync_pull_grouped_v1(
  p_organization_id text, p_branch_id text, p_terminal_id uuid, p_binding_proof text,
  p_epoch uuid, p_after_seq text, p_upper_seq text, p_limit integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $pull$
DECLARE
  v_page jsonb;
BEGIN
  PERFORM pos_sync_feed_v1.assert_grouped_gateway_scope(p_organization_id, p_branch_id, p_terminal_id, p_binding_proof);
  IF NOT EXISTS (
    SELECT 1 FROM pos_sync_feed_v1.feed_heads AS head
    JOIN pos_sync_feed_v1.settings_pilots AS pilot USING (organization_id, scope_id, epoch)
    WHERE head.organization_id = p_organization_id AND head.scope_id = p_branch_id
  ) THEN RETURN jsonb_build_object('status', 'SCOPE_UNAVAILABLE'); END IF;

  v_page := pos_sync_feed_v1.pull_groups(p_organization_id, p_branch_id, p_epoch, p_after_seq, p_upper_seq, p_limit);
  IF v_page->>'status' = 'OK' AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_page->'groups') AS group_row(value)
    CROSS JOIN LATERAL (SELECT group_row.value->'changes'->0 AS value) AS change
    WHERE jsonb_array_length(group_row.value->'changes') <> 1
      OR change.value->>'table_name' IS DISTINCT FROM 'pos_store_settings'
      OR change.value->'tombstone' IS DISTINCT FROM 'false'::jsonb
      OR (change.value->>'entity_id')::jsonb IS DISTINCT FROM jsonb_build_object('store_id', p_branch_id)
      OR change.value->'row_data'->'store_id' IS DISTINCT FROM to_jsonb(p_branch_id)
      OR jsonb_typeof(change.value->'row_version') IS DISTINCT FROM 'string'
      OR change.value->'row_data'->'row_version' IS DISTINCT FROM change.value->'row_version'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'POS_GROUPED_GATEWAY_V1_PROJECTION_UNVERIFIED';
  END IF;
  RETURN v_page;
END;
$pull$;

CREATE FUNCTION public.pos_sync_snapshot_grouped_v1(
  p_organization_id text, p_branch_id text, p_terminal_id uuid, p_binding_proof text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $snapshot$
DECLARE
  v_head pos_sync_feed_v1.feed_heads%ROWTYPE;
  v_pin_id uuid;
  v_pin jsonb;
BEGIN
  PERFORM pos_sync_feed_v1.assert_grouped_gateway_scope(p_organization_id, p_branch_id, p_terminal_id, p_binding_proof);
  -- Hold the same head lock as publication and retirement. The export reads
  -- committed settings with MVCC while the head is held, without row locks.
  SELECT head.* INTO v_head FROM pos_sync_feed_v1.feed_heads AS head
  JOIN pos_sync_feed_v1.settings_pilots AS pilot USING (organization_id, scope_id, epoch)
  WHERE head.organization_id = p_organization_id AND head.scope_id = p_branch_id
  FOR NO KEY UPDATE OF head;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'SCOPE_UNAVAILABLE'); END IF;

  SELECT pin.pin_id INTO v_pin_id FROM pos_sync_feed_v1.snapshot_pins AS pin
  WHERE pin.organization_id = p_organization_id AND pin.scope_id = p_branch_id AND pin.epoch = v_head.epoch
    AND pin.protected_seq BETWEEN v_head.replay_floor AND v_head.head_seq
    AND pin.expires_at > clock_timestamp() + interval '2 minutes'
  ORDER BY pin.expires_at DESC, pin.pin_id LIMIT 1;
  IF NOT FOUND THEN
    v_pin := pos_sync_feed_v1.create_snapshot_pin(p_organization_id, p_branch_id, v_head.epoch, 300);
    IF v_pin->>'status' IS DISTINCT FROM 'OK' THEN RETURN v_pin; END IF;
    v_pin_id := (v_pin->>'pin_id')::uuid;
  END IF;
  RETURN pos_sync_feed_v1.export_store_settings_snapshot(p_organization_id, p_branch_id, v_head.epoch, v_pin_id);
END;
$snapshot$;

REVOKE ALL ON FUNCTION public.pos_sync_pull_grouped_v1(text, text, uuid, text, uuid, text, text, integer),
  public.pos_sync_snapshot_grouped_v1(text, text, uuid, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pos_sync_pull_grouped_v1(text, text, uuid, text, uuid, text, text, integer),
  public.pos_sync_snapshot_grouped_v1(text, text, uuid, text) TO service_role;
