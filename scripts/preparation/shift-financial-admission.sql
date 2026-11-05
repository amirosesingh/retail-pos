-- FIN62 PREPARATION ONLY / NOT FINAL / DO NOT APPLY TO OPERATOR DATABASE.
-- Additive service-only composition of the ACTUAL unchanged author/start RPCs.
-- HTTP must verify BOTH signatures under their distinct domains using the same
-- already verified graph-author key before this call. PostgreSQL does NOT
-- verify Ed25519; service_role is the existing trusted HTTP-to-SQL boundary.
-- No native activation, baseline/operation issuer, migration registration or
-- historical rewrite is included. Stored-version evidence is NOT author proof.
CREATE SCHEMA fin62_action_preparation;
REVOKE ALL ON SCHEMA fin62_action_preparation FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE fin62_action_preparation.receipts(
 intent_id uuid PRIMARY KEY,organization_id text NOT NULL,branch_id text NOT NULL,terminal_id text NOT NULL,
 shift_id uuid NOT NULL,author_id uuid NOT NULL,key_id uuid NOT NULL,
 graph_payload_hash text NOT NULL CHECK(graph_payload_hash~'^[a-f0-9]{64}$'),
 basis_id uuid NOT NULL,basis_hash text NOT NULL CHECK(basis_hash~'^[a-f0-9]{64}$'),
 basis_json text NOT NULL,basis_proof jsonb NOT NULL,formula text NOT NULL CHECK(formula='canonical-exact-decimal-v2'),
 acknowledgement jsonb NOT NULL,accepted_at timestamptz NOT NULL DEFAULT statement_timestamp()
);
ALTER TABLE fin62_action_preparation.receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON fin62_action_preparation.receipts FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION fin62_action_preparation.immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'FIN62_ACTION_RECEIPT_IMMUTABLE';END $$;
REVOKE ALL ON FUNCTION fin62_action_preparation.immutable() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON fin62_action_preparation.receipts FOR EACH ROW EXECUTE FUNCTION fin62_action_preparation.immutable();
CREATE FUNCTION public.pos_sync_push_financial_shift_intent(
 p_batch_id uuid,p_organization_id text,p_branch_id text,p_terminal_id text,p_operations jsonb,p_shift_intent jsonb,
 p_shift_author jsonb,p_author_authority jsonb,p_closing_start jsonb,p_start_authority jsonb,p_financial_basis jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $function$
DECLARE raw_graph text;raw_basis text;proof jsonb;intent jsonb;basis jsonb;parent jsonb;expected jsonb;
 graph_hash text;basis_hash text;sid uuid;basis_id uuid;prior fin62_action_preparation.receipts%ROWTYPE;
 result jsonb;field text;amount numeric;parents integer;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'FIN62_SERVICE_REQUIRED';END IF;
 PERFORM public.pos_sync_validate_scope(p_organization_id,p_branch_id,p_terminal_id);
 IF jsonb_typeof(p_financial_basis) IS DISTINCT FROM 'object' OR
  (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(p_financial_basis) key) IS DISTINCT FROM ARRAY['basisJson','proof']::text[] OR
  jsonb_typeof(p_financial_basis->'basisJson') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'FIN62_PROOF_INVALID';END IF;
 raw_basis:=p_financial_basis->>'basisJson';proof:=p_financial_basis->'proof';raw_graph:=p_shift_intent->>'payloadJson';
 IF raw_graph IS NULL OR octet_length(raw_graph)>6*1024*1024 OR raw_basis IS NULL OR octet_length(raw_basis)>6*1024*1024 OR
  jsonb_typeof(proof) IS DISTINCT FROM 'object' OR octet_length(proof::text)>4096 OR
  (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(proof) key) IS DISTINCT FROM
   ARRAY['action','algorithm','authorId','basisHash','branchId','formula','graphPayloadHash','intentId','keyId','projectOrigin','serverBasisId','shiftId','signature','subject','terminalId','version']::text[] OR
  proof->'version' IS DISTINCT FROM '1'::jsonb OR proof->>'algorithm' IS DISTINCT FROM 'Ed25519' OR
  proof->>'formula' IS DISTINCT FROM 'canonical-exact-decimal-v2' OR coalesce(proof->>'signature','')!~'^[A-Za-z0-9_-]{86}$' OR
  coalesce(proof->>'basisHash','')!~'^[a-f0-9]{64}$' OR coalesce(proof->>'graphPayloadHash','')!~'^[a-f0-9]{64}$' OR
  coalesce(proof->>'serverBasisId','')!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
 THEN RAISE EXCEPTION 'FIN62_PROOF_INVALID';END IF;
 graph_hash:=encode(sha256(convert_to(raw_graph,'UTF8')),'hex');basis_hash:=encode(sha256(convert_to(raw_basis,'UTF8')),'hex');
 IF proof->>'graphPayloadHash' IS DISTINCT FROM graph_hash OR proof->>'basisHash' IS DISTINCT FROM basis_hash THEN RAISE EXCEPTION 'FIN62_PROOF_HASH_MISMATCH';END IF;
 intent:=raw_graph::jsonb;basis:=raw_basis::jsonb;sid:=(intent->>'shiftId')::uuid;basis_id:=(proof->>'serverBasisId')::uuid;
 IF sid IS NULL OR proof->>'shiftId' IS DISTINCT FROM sid::text OR proof->>'intentId' IS DISTINCT FROM p_batch_id::text OR
  proof->>'terminalId' IS DISTINCT FROM p_terminal_id OR proof->>'branchId' IS DISTINCT FROM p_branch_id OR
  proof->>'action' IS DISTINCT FROM intent->>'kind' OR coalesce(proof->>'action','') NOT IN('ORIGINAL','RECOUNT') OR
  basis->'prototypeVersion' IS DISTINCT FROM '2'::jsonb OR basis->>'formula' IS DISTINCT FROM 'canonical-exact-decimal-v2' OR
  basis->>'branchId' IS DISTINCT FROM p_branch_id OR basis->>'shiftId' IS DISTINCT FROM sid::text OR
  jsonb_typeof(basis->'versionReferences') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'FIN62_PROOF_CONTEXT_MISMATCH';END IF;
 FOREACH field IN ARRAY ARRAY['version','algorithm','keyId','projectOrigin','terminalId','authorId','subject','branchId','shiftId','intentId','action'] LOOP
  IF proof->field IS DISTINCT FROM p_shift_author->field THEN RAISE EXCEPTION 'FIN62_AUTHOR_BINDING_MISMATCH';END IF;
 END LOOP;
 IF p_shift_author->>'payloadHash' IS DISTINCT FROM graph_hash THEN RAISE EXCEPTION 'FIN62_AUTHOR_BINDING_MISMATCH';END IF;
 -- Exact same lock order as the actual immutable intent/author/start writers.
 PERFORM pg_advisory_xact_lock(hashtextextended('pos-sync-batch:'||p_batch_id::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('pos-sync-intent:'||p_batch_id::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('pos-sync-shift:'||sid::text,0));
 SELECT * INTO prior FROM fin62_action_preparation.receipts WHERE intent_id=p_batch_id;
 IF FOUND THEN
  IF ROW(prior.organization_id,prior.branch_id,prior.terminal_id,prior.shift_id,prior.author_id,prior.key_id,prior.graph_payload_hash,prior.basis_id,prior.basis_hash,prior.formula)
    IS DISTINCT FROM ROW(p_organization_id,p_branch_id,p_terminal_id,sid,(proof->>'authorId')::uuid,(proof->>'keyId')::uuid,graph_hash,basis_id,basis_hash,proof->>'formula') OR
   convert_to(prior.basis_json,'UTF8') IS DISTINCT FROM convert_to(raw_basis,'UTF8') OR prior.basis_proof IS DISTINCT FROM proof
  THEN RAISE EXCEPTION 'FIN62_ACTION_REPLAY_MISMATCH';END IF;
  -- Do NOT reprice accepted history after a refund or account revocation.
  -- The old RPC still verifies its exact author receipt and returns the fresh
  -- current-token/superseded acknowledgement rather than replaying old money.
 ELSE
  IF EXISTS(SELECT 1 FROM pos_sync_private.shift_intent_receipts WHERE intent_id=p_batch_id) THEN RAISE EXCEPTION 'FIN62_FINANCIAL_HISTORY_UNPROVEN';END IF;
  SELECT count(*) INTO parents FROM jsonb_array_elements(intent->'operations') op,LATERAL jsonb_array_elements(op->'rows') row_value WHERE op->>'table'='shifts';
  IF parents<>1 THEN RAISE EXCEPTION 'FIN62_PARENT_INVALID';END IF;
  SELECT row_value INTO parent FROM jsonb_array_elements(intent->'operations') op,LATERAL jsonb_array_elements(op->'rows') row_value WHERE op->>'table'='shifts';
  expected:='{}'::jsonb;
  FOREACH field IN ARRAY ARRAY['cash','card','digital'] LOOP
   IF jsonb_typeof(parent->('expected_'||field)) NOT IN('number','string') OR NOT parent?('expected_'||field) THEN RAISE EXCEPTION 'FIN62_EXPECTED_INVALID';END IF;
   amount:=fin62_preparation.math_decimal_text(parent->>('expected_'||field));
   IF round(amount,2) IS DISTINCT FROM amount THEN RAISE EXCEPTION 'FIN62_EXPECTED_FRACTIONAL';END IF;
   expected:=expected||jsonb_build_object(field,round(amount,2)::text);
  END LOOP;
  PERFORM public.prototype_fin62_verify_known_basis(p_organization_id,p_branch_id,p_terminal_id,basis_id,raw_basis,basis->'versionReferences',expected);
 END IF;
 IF p_closing_start IS NOT NULL THEN
  result:=public.pos_sync_push_started_shift_intent(p_batch_id,p_organization_id,p_branch_id,p_terminal_id,p_operations,p_shift_intent,p_shift_author,p_author_authority,p_closing_start,p_start_authority);
 ELSE
  IF p_start_authority IS NOT NULL THEN RAISE EXCEPTION 'FIN62_START_PROOF_REQUIRED';END IF;
  result:=public.pos_sync_push_author_shift_intent(p_batch_id,p_organization_id,p_branch_id,p_terminal_id,p_operations,p_shift_intent,p_shift_author,p_author_authority);
 END IF;
 IF prior.intent_id IS NULL THEN
  INSERT INTO fin62_action_preparation.receipts(intent_id,organization_id,branch_id,terminal_id,shift_id,author_id,key_id,graph_payload_hash,basis_id,basis_hash,basis_json,basis_proof,formula,acknowledgement)
  VALUES(p_batch_id,p_organization_id,p_branch_id,p_terminal_id,sid,(proof->>'authorId')::uuid,(proof->>'keyId')::uuid,graph_hash,basis_id,basis_hash,raw_basis,proof,proof->>'formula',result);
 END IF;
 RETURN result||jsonb_build_object('financial_basis_receipt',jsonb_build_object('ack_version',1,'intentId',p_batch_id,'graphPayloadHash',graph_hash,'basisHash',basis_hash,'serverBasisId',basis_id,'formula',proof->>'formula'));
END $function$;
REVOKE ALL ON FUNCTION public.pos_sync_push_financial_shift_intent(uuid,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pos_sync_push_financial_shift_intent(uuid,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) TO service_role;
