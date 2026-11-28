-- Isolated preparation. Install after pos-sync-store-settings-edit-v1.sql.
-- The trusted HTTPS relay verifies the person JWT and the exact pilot project
-- and terminal before deriving p_person_id. Never forward a caller's claimed
-- identity. This gateway must stay uninstalled until the pilot is authorized.
CREATE FUNCTION public.pos_sync_apply_store_settings_edit_v1(
  p_organization_id text, p_branch_id text, p_terminal_id uuid, p_binding_proof text,
  p_installation_generation uuid, p_database_guid uuid, p_epoch uuid, p_person_id uuid,
  p_operation_id uuid, p_expected_version integer, p_patch jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $edit_gateway$
DECLARE
  v_claims text;
  v_legacy_claim text;
  v_sub text;
  v_role text;
  v_person_claims text;
  v_patch jsonb := p_patch;
  v_result jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' OR p_person_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'POS_SETTINGS_EDIT_GATEWAY_V1_FORBIDDEN';
  END IF;
  IF jsonb_typeof(p_patch) IS DISTINCT FROM 'object' OR octet_length(p_patch::text) > 1024
     OR p_patch = '{}'::jsonb OR p_patch - ARRAY['block_shift_close_on_hold', 'max_drawer_cash_limit'] <> '{}'::jsonb
     OR (p_patch ? 'block_shift_close_on_hold' AND jsonb_typeof(p_patch->'block_shift_close_on_hold') <> 'boolean')
     OR (p_patch ? 'max_drawer_cash_limit' AND (jsonb_typeof(p_patch->'max_drawer_cash_limit') <> 'string'
       OR (p_patch->>'max_drawer_cash_limit') !~ '^(0|[1-9][0-9]{0,25})(\.[0-9]{1,12})?$')) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'POS_SETTINGS_EDIT_GATEWAY_V1_INVALID_PATCH';
  END IF;
  IF p_patch ? 'max_drawer_cash_limit' THEN
    v_patch := jsonb_set(v_patch, '{max_drawer_cash_limit}', to_jsonb((p_patch->>'max_drawer_cash_limit')::numeric));
  END IF;

  -- Use only the proved person's subject and the ordinary authenticated role
  -- for canonical permission checks and attribution. A raised exception rolls
  -- back these local settings with the failed statement or subtransaction.
  v_claims := current_setting('request.jwt.claims', true);
  v_legacy_claim := current_setting('request.jwt.claim', true);
  v_sub := current_setting('request.jwt.claim.sub', true);
  v_role := current_setting('request.jwt.claim.role', true);
  v_person_claims := jsonb_build_object('sub', p_person_id, 'role', 'authenticated')::text;
  PERFORM set_config('request.jwt.claims', v_person_claims, true),
    set_config('request.jwt.claim', v_person_claims, true),
    set_config('request.jwt.claim.sub', p_person_id::text, true),
    set_config('request.jwt.claim.role', 'authenticated', true);

  v_result := pos_sync_feed_v1.apply_store_settings_edit(
    p_organization_id, p_branch_id, p_terminal_id, p_binding_proof, p_installation_generation,
    p_database_guid, p_epoch, p_person_id, p_operation_id, p_expected_version, v_patch);

  PERFORM set_config('request.jwt.claims', coalesce(v_claims, ''), true),
    set_config('request.jwt.claim', coalesce(v_legacy_claim, ''), true),
    set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true),
    set_config('request.jwt.claim.role', coalesce(v_role, ''), true);
  RETURN v_result;
END;
$edit_gateway$;

REVOKE ALL ON FUNCTION public.pos_sync_apply_store_settings_edit_v1(text, text, uuid, text, uuid, uuid, uuid, uuid, uuid, integer, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pos_sync_apply_store_settings_edit_v1(text, text, uuid, text, uuid, uuid, uuid, uuid, uuid, integer, jsonb)
  TO service_role;
