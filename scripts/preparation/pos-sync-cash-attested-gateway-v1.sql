-- Isolated preparation after cash bridge/overlap/receipt projection, the
-- author registry, and the mixed feed archive. The verified HTTPS handler
-- checks the signature over the exact bytes before this service-only call.
CREATE FUNCTION public.pos_sync_cash_checkout_attested_v1(
  p_organization_id text, p_branch_id text, p_terminal_id uuid, p_binding_proof text,
  p_installation_generation uuid, p_database_guid uuid, p_operation_id uuid, p_epoch uuid,
  p_checkout_json text, p_checkout_sha256 text, p_author_key_id uuid, p_author_id uuid,
  p_author_subject text, p_project_origin text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $cash_gateway$
DECLARE
  v_outcome jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'POS_CASH_V1_SCOPE_FORBIDDEN';
  END IF;

  -- Lock the same current person and key used by the relay. A concurrent
  -- revocation must complete either before admission or after this checkout.
  PERFORM 1 FROM public.app_users AS person
  WHERE person.id = p_author_id AND person.user_id = p_author_subject AND person.is_active
    AND (person.store_id IS NULL OR person.store_id = p_branch_id)
    AND person.permissions->'can_process_sale' = 'true'::jsonb
    AND person.permissions->'page:register' IS DISTINCT FROM 'false'::jsonb
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'POS_CASH_V1_AUTHOR_FORBIDDEN';
  END IF;

  PERFORM 1 FROM pos_sync_private.shift_author_keys AS author
  WHERE author.key_id = p_author_key_id AND author.author_id = p_author_id
    AND author.subject = p_author_subject AND author.project_origin = p_project_origin
    AND author.terminal_id = p_terminal_id::text AND author.revoked_at IS NULL
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'POS_CASH_V1_AUTHOR_FORBIDDEN';
  END IF;

  v_outcome := pos_sync_cash_v1.apply_checkout(p_organization_id, p_branch_id, p_terminal_id, p_binding_proof,
    p_installation_generation, p_database_guid, p_operation_id, p_epoch, p_checkout_json, p_checkout_sha256,
    jsonb_build_object('author_id', p_author_id, 'author_key_id', p_author_key_id,
      'subject', p_author_subject, 'project_origin', p_project_origin));

  IF v_outcome->>'status' = 'APPLIED' THEN
    PERFORM pos_sync_feed_v1.record_cash_publication(p_organization_id, p_branch_id, p_epoch,
      (v_outcome->'result'->>'seq')::bigint, p_operation_id, p_terminal_id,
      p_installation_generation, p_database_guid, p_checkout_sha256);
  END IF;
  RETURN v_outcome;
END;
$cash_gateway$;

REVOKE ALL ON FUNCTION public.pos_sync_cash_checkout_attested_v1(text,text,uuid,text,uuid,uuid,uuid,uuid,text,text,uuid,uuid,text,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pos_sync_cash_checkout_attested_v1(text,text,uuid,text,uuid,uuid,uuid,uuid,text,text,uuid,uuid,text,text)
  TO service_role;
