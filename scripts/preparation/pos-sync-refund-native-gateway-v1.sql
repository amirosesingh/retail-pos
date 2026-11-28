-- Isolated preparation after the signed author registry, mixed feed,
-- grouped refund publication, and native refund writer.
CREATE FUNCTION public.pos_sync_refund_attested_v1(
  p_author uuid, p_branch text, p_terminal text, p_operation uuid, p_refund_key text, p_sale uuid,
  p_expected_sale_version integer, p_lines jsonb, p_reason text, p_approval_basis jsonb,
  p_binding_proof text, p_installation_generation uuid, p_database_guid uuid, p_epoch uuid,
  p_author_key_id uuid, p_author_subject text, p_project_origin text, p_items jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $native_refund$
DECLARE v_result jsonb; v_seq bigint;
BEGIN
  PERFORM pos_sync_feed_v1.assert_grouped_gateway_scope('default',p_branch,p_terminal::uuid,p_binding_proof);
  PERFORM 1 FROM pos_sync_cash_v1.installation_enrollments
  WHERE organization_id='default' AND branch_id=p_branch AND terminal_id=p_terminal::uuid
    AND installation_generation=p_installation_generation AND database_guid=p_database_guid
  FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='POS_REFUND_V1_SCOPE_FORBIDDEN'; END IF;
  PERFORM 1 FROM public.app_users AS person
  WHERE person.id=p_author AND person.user_id=p_author_subject AND person.is_active
    AND (person.store_id IS NULL OR person.store_id=p_branch)
    AND person.permissions->'page:register' IS DISTINCT FROM 'false'::jsonb
  FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='POS_REFUND_V1_AUTHOR_FORBIDDEN'; END IF;
  PERFORM 1 FROM pos_sync_private.shift_author_keys AS author
  WHERE author.key_id=p_author_key_id AND author.author_id=p_author
    AND author.subject=p_author_subject AND author.project_origin=p_project_origin
    AND author.terminal_id=p_terminal AND author.revoked_at IS NULL
  FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='POS_REFUND_V1_AUTHOR_FORBIDDEN'; END IF;

  IF pos_sync_feed_v1.extended_scope_epoch('default',p_branch) IS DISTINCT FROM p_epoch
    THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='POS_REFUND_V1_SCOPE_FORBIDDEN'; END IF;

  v_result := public.pos_sync_refund_v1(p_author,p_branch,p_terminal,p_operation,p_refund_key,p_sale,
    p_expected_sale_version,p_lines,p_reason,p_approval_basis);
  -- Match the publisher's lock order and reject a concurrent epoch change
  -- before a saved operation can be acknowledged by the originating till.
  PERFORM 1 FROM pos_sync_feed_v1.feed_heads h
  JOIN pos_sync_feed_v1.extended_pilots pilot USING(organization_id,scope_id,epoch)
  JOIN pos_sync_feed_v1.stock_pilots stock USING(organization_id,scope_id,epoch)
  WHERE h.organization_id='default' AND h.scope_id=p_branch AND h.epoch=p_epoch
  FOR SHARE OF h;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='POS_REFUND_V1_SCOPE_FORBIDDEN'; END IF;
  IF v_result->>'status' = 'APPLIED' THEN
    IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR (
      SELECT jsonb_agg(jsonb_build_object('item_id',effect->'item_id','product_id',effect->'product_id')
        ORDER BY effect->>'item_id')
      FROM jsonb_array_elements(v_result->'effects') AS effect
    ) IS DISTINCT FROM p_items THEN
      RAISE EXCEPTION USING ERRCODE='40001', MESSAGE='POS_REFUND_V1_STALE_COMMAND';
    END IF;
    SELECT publication.seq INTO STRICT v_seq FROM pos_sync_feed_v1.extended_publications AS publication
    WHERE (organization_id,scope_id,epoch,operation_id)=('default',p_branch,p_epoch,p_operation)
      AND metadata->'financial'->>'kind'='refund_v1'
      AND metadata->'financial'->>'sale_id'=p_sale::text;
    v_result := v_result || jsonb_build_object('feed_epoch',p_epoch,'feed_seq',v_seq::text);
  END IF;
  RETURN v_result;
END;
$native_refund$;
REVOKE ALL ON FUNCTION public.pos_sync_refund_attested_v1(
  uuid,text,text,uuid,text,uuid,integer,jsonb,text,jsonb,text,uuid,uuid,uuid,uuid,text,text,jsonb
) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.pos_sync_refund_attested_v1(
  uuid,text,text,uuid,text,uuid,integer,jsonb,text,jsonb,text,uuid,uuid,uuid,uuid,text,text,jsonb
) TO service_role;
