-- Read-only history probe. An existing metadata receipt never proves that
-- refund business rows or stock effects were accepted.
CREATE OR REPLACE FUNCTION public.pos_sync_read_financial_event_receipt(
  p_org text,p_branch text,p_terminal text,p_project_origin text,p_raw text,p_proof jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $receipt$
DECLARE
  event jsonb;
  digest text;
  -- FIN62 is an optional, separately admitted preparation. Install this
  -- read-only routine without requiring or activating that preparation.
  prior record;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='FIN62_RECEIPT_SERVICE_REQUIRED';
  END IF;
  IF p_org IS NULL OR length(p_org) NOT BETWEEN 1 AND 128
    OR p_branch IS NULL OR length(p_branch) NOT BETWEEN 1 AND 128
    OR p_terminal IS NULL OR length(p_terminal) NOT BETWEEN 1 AND 128
    OR p_project_origin IS NULL OR p_project_origin !~ '^https://[^/?#@]+$'
    OR p_raw IS NULL OR octet_length(p_raw) NOT BETWEEN 2 AND 6291456
    OR jsonb_typeof(p_proof) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='FIN62_RECEIPT_INVALID';
  END IF;
  PERFORM public.pos_sync_validate_scope(p_org,p_branch,p_terminal);
  PERFORM fin62_preparation.math_unique_json(p_raw::json,48);
  event:=p_raw::jsonb;
  digest:=encode(sha256(convert_to(p_raw,'UTF8')),'hex');
  IF jsonb_typeof(event) IS DISTINCT FROM 'object'
    OR event->>'action' IS DISTINCT FROM 'REFUND'
    OR event->>'branchId' IS DISTINCT FROM p_branch
    OR event->>'terminalId' IS DISTINCT FROM p_terminal
    OR coalesce(event->>'operationId','') !~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
    OR coalesce(event->>'shiftId','') !~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
    OR coalesce(event->>'sequence','') !~ '^[1-9][0-9]{0,18}$'
    OR p_proof->>'projectOrigin' IS DISTINCT FROM p_project_origin
    OR p_proof->>'terminalId' IS DISTINCT FROM p_terminal
    OR p_proof->>'branchId' IS DISTINCT FROM p_branch
    OR p_proof->>'operationId' IS DISTINCT FROM event->>'operationId'
    OR p_proof->>'action' IS DISTINCT FROM 'REFUND'
    OR p_proof->>'payloadHash' IS DISTINCT FROM digest THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='FIN62_RECEIPT_INVALID';
  END IF;
  SELECT * INTO prior FROM fin62_history_preparation.nodes
  WHERE operation_id=(event->>'operationId')::uuid FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF prior.node_kind IS DISTINCT FROM 'MUTATION'
    OR ROW(prior.organization_id,prior.branch_id,prior.terminal_id,prior.shift_id::text,prior.sequence::text,prior.payload_hash)
      IS DISTINCT FROM ROW(p_org,p_branch,p_terminal,event->>'shiftId',event->>'sequence',digest)
    OR convert_to(prior.payload_json,'UTF8') IS DISTINCT FROM convert_to(p_raw,'UTF8')
    OR prior.proof IS DISTINCT FROM p_proof
    OR prior.proof->>'projectOrigin' IS DISTINCT FROM p_project_origin
    OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(prior.acknowledgement) key)
      IS DISTINCT FROM ARRAY['businessUploaded','operationId','payloadHash','sequence','shiftClosed','status']::text[]
    OR prior.acknowledgement IS DISTINCT FROM jsonb_build_object(
      'status','financial_metadata_recorded','operationId',event->>'operationId',
      'payloadHash',digest,'sequence',event->>'sequence','businessUploaded',false,'shiftClosed',false) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='FIN62_RECEIPT_REPLAY_MISMATCH';
  END IF;
  RETURN prior.acknowledgement;
END;
$receipt$;
REVOKE ALL ON FUNCTION public.pos_sync_read_financial_event_receipt(text,text,text,text,text,jsonb)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.pos_sync_read_financial_event_receipt(text,text,text,text,text,jsonb)
  TO service_role;
