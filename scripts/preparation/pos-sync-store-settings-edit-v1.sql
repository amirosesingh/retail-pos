-- Isolated preparation. Install after the private inbox and settings publisher.
-- The owner supplies a verified person JWT context and invokes one settings
-- edit in its transaction. No public or application-role writer is installed.
CREATE TABLE pos_sync_feed_v1.settings_edit_enrollments (
  organization_id text COLLATE "C" NOT NULL CHECK (organization_id = 'default'),
  terminal_id uuid NOT NULL,
  branch_id text COLLATE "C" NOT NULL,
  installation_generation uuid NOT NULL,
  database_guid uuid NOT NULL,
  PRIMARY KEY (organization_id, terminal_id)
);

ALTER TABLE pos_sync_feed_v1.settings_edit_enrollments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE pos_sync_feed_v1.settings_edit_enrollments FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION pos_sync_feed_v1.apply_store_settings_edit(
  p_organization_id text, p_branch_id text, p_terminal_id uuid, p_binding_proof text,
  p_installation_generation uuid, p_database_guid uuid, p_epoch uuid, p_person_id uuid,
  p_operation_id uuid, p_expected_version integer, p_patch jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $edit$
DECLARE
  v_actor_count integer;
  v_context jsonb;
  v_claim jsonb;
  v_saved jsonb;
  v_seq bigint;
  v_result jsonb;
BEGIN
  IF p_organization_id IS DISTINCT FROM 'default' OR p_branch_id IS NULL OR p_branch_id = ''
     OR p_branch_id <> btrim(p_branch_id) OR octet_length(p_branch_id) > 256
     OR p_terminal_id IS NULL OR p_installation_generation IS NULL OR p_database_guid IS NULL
     OR p_epoch IS NULL OR p_binding_proof IS NULL OR p_binding_proof !~ '^[a-f0-9]{64}$'
     OR p_person_id IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' OR auth.uid() IS DISTINCT FROM p_person_id THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'POS_SETTINGS_EDIT_V1_SCOPE_FORBIDDEN';
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
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'POS_SETTINGS_EDIT_V1_SCOPE_FORBIDDEN';
  END IF;

  PERFORM 1 FROM pos_sync_feed_v1.settings_edit_enrollments AS enrollment
  WHERE enrollment.organization_id = p_organization_id AND enrollment.terminal_id = p_terminal_id
    AND enrollment.branch_id = p_branch_id AND enrollment.installation_generation = p_installation_generation
    AND enrollment.database_guid = p_database_guid
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'POS_SETTINGS_EDIT_V1_INSTALLATION_FORBIDDEN';
  END IF;

  PERFORM 1 FROM public.app_users AS actor
  WHERE actor.auth_user_id = p_person_id AND actor.is_active
    AND lower(btrim(actor.email)) NOT LIKE '%@pos.local'
    AND (actor.store_id IS NULL OR actor.store_id = p_branch_id)
  FOR SHARE;
  GET DIAGNOSTICS v_actor_count = ROW_COUNT;
  IF v_actor_count <> 1 OR NOT coalesce(public.is_supervisor_now() OR public.has_perm('can_access_pos_settings'), false)
     OR NOT coalesce(public.store_visible(p_branch_id), false) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'POS_SETTINGS_EDIT_V1_PERSON_FORBIDDEN';
  END IF;

  IF p_operation_id IS NULL OR p_expected_version IS NULL OR p_expected_version NOT BETWEEN 1 AND 2147483646
     OR jsonb_typeof(p_patch) IS DISTINCT FROM 'object' OR octet_length(p_patch::text) > 1024
     OR p_patch = '{}'::jsonb OR p_patch - ARRAY['block_shift_close_on_hold', 'max_drawer_cash_limit'] <> '{}'::jsonb
     OR (p_patch ? 'block_shift_close_on_hold' AND jsonb_typeof(p_patch->'block_shift_close_on_hold') <> 'boolean')
     OR (p_patch ? 'max_drawer_cash_limit' AND (jsonb_typeof(p_patch->'max_drawer_cash_limit') <> 'number'
       OR (p_patch->>'max_drawer_cash_limit') !~ '^(0|[1-9][0-9]{0,25})(\.[0-9]{1,12})?$')) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'POS_SETTINGS_EDIT_V1_INVALID_PATCH';
  END IF;

  -- The publisher locks this row after taking the canonical settings lock.
  -- Keep this precheck lock-free and require fresh publication after the save.
  PERFORM 1 FROM pos_sync_feed_v1.settings_pilots AS pilot
  WHERE pilot.organization_id = p_organization_id AND pilot.scope_id = p_branch_id AND pilot.epoch = p_epoch;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'POS_SETTINGS_EDIT_V1_SCOPE_FORBIDDEN';
  END IF;

  v_context := jsonb_build_object('scope_id', p_branch_id, 'epoch', p_epoch, 'operation_id', p_operation_id,
    'terminal_id', p_terminal_id, 'person_id', p_person_id, 'installation_generation', p_installation_generation,
    'database_guid', p_database_guid, 'expected_version', p_expected_version);
  v_claim := pos_sync_inbox_v1.claim_operation(p_organization_id, p_operation_id, p_installation_generation,
    v_context || jsonb_build_object('type', 'store_settings_edit_v1', 'patch', p_patch));
  IF v_claim->>'status' <> 'PROCEED' THEN RETURN v_claim; END IF;

  IF EXISTS (SELECT 1 FROM pos_sync_feed_v1.settings_pilots AS pilot WHERE pilot.organization_id = p_organization_id
    AND pilot.scope_id = p_branch_id AND pilot.last_publication_xid = pg_current_xact_id()) THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'POS_SETTINGS_EDIT_V1_TRANSACTION_ALREADY_PUBLISHED';
  END IF;
  BEGIN
    v_saved := public.pos_rules_save(p_branch_id, p_patch, p_expected_version);
  EXCEPTION WHEN SQLSTATE 'PT409' THEN
    IF SQLERRM NOT LIKE 'STALE_RULES:%' THEN RAISE; END IF;
    v_result := v_context || jsonb_build_object('code', 'STALE_RULES');
    PERFORM pos_sync_inbox_v1.record_disposition(p_organization_id, p_operation_id, 'REVIEW_REQUIRED', v_result);
    RETURN jsonb_build_object('status', 'REVIEW_REQUIRED', 'result', v_result);
  END;

  -- Seal this transaction's group to the command. The publisher will refuse
  -- to coalesce another change into a group that already has an operation ID.
  UPDATE pos_sync_feed_v1.feed_groups AS feed SET operation_id = p_operation_id
  FROM pos_sync_feed_v1.settings_pilots AS pilot
  WHERE pilot.organization_id = p_organization_id AND pilot.scope_id = p_branch_id AND pilot.epoch = p_epoch
    AND pilot.last_publication_xid = pg_current_xact_id()
    AND feed.organization_id = pilot.organization_id AND feed.scope_id = pilot.scope_id
    AND feed.epoch = pilot.epoch AND feed.seq = pilot.last_publication_seq AND feed.operation_id IS NULL
    AND jsonb_array_length(feed.changes) = 1
    AND feed.changes->0->>'table_name' = 'pos_store_settings'
    AND feed.changes->0->'row_data'->>'store_id' = p_branch_id
    AND feed.changes->0->'row_data'->>'updated_by' = p_person_id::text
    AND feed.changes->0->>'row_version' = (p_expected_version + 1)::text
    AND (NOT p_patch ? 'block_shift_close_on_hold'
      OR feed.changes->0->'row_data'->'block_shift_close_on_hold' = p_patch->'block_shift_close_on_hold')
    AND (NOT p_patch ? 'max_drawer_cash_limit'
      OR (feed.changes->0->'row_data'->>'max_drawer_cash_limit')::numeric = (p_patch->>'max_drawer_cash_limit')::numeric)
  RETURNING feed.seq INTO v_seq;
  IF NOT FOUND OR v_saved->>'store_id' IS DISTINCT FROM p_branch_id
     OR v_saved->>'row_version' IS DISTINCT FROM (p_expected_version + 1)::text
     OR v_saved->>'updated_by' IS DISTINCT FROM p_person_id::text THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'POS_SETTINGS_EDIT_V1_PUBLICATION_UNVERIFIED';
  END IF;

  v_result := v_context || jsonb_build_object('row_version', p_expected_version + 1, 'seq', v_seq::text);
  PERFORM pos_sync_inbox_v1.record_disposition(p_organization_id, p_operation_id, 'APPLIED', v_result);
  RETURN jsonb_build_object('status', 'APPLIED', 'result', v_result);
END;
$edit$;

REVOKE ALL ON FUNCTION pos_sync_feed_v1.apply_store_settings_edit(text, text, uuid, text, uuid, uuid, uuid, uuid, uuid, integer, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
