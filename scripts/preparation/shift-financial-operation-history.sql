-- FIN62 PREPARATION ONLY / NOT FINAL / NO LIVE APPLICATION OR ACTIVATION.
-- HTTP MUST verify Ed25519 for author-bound actions; OBSERVE instead requires the existing verified native-device proof.
-- SQL independently checks real registered identity/current action flags. It
-- accepts no caller-supplied authorized flag. Metadata ACK is NOT a sale/shift
-- upload ACK. Applying this preparation rewrites no existing business rows; explicitly called business adapters retain the existing guarded writers.
CREATE SCHEMA fin62_history_preparation;
REVOKE ALL ON SCHEMA fin62_history_preparation FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE fin62_history_preparation.streams(
 organization_id text NOT NULL,branch_id text NOT NULL,terminal_id text NOT NULL,shift_id uuid NOT NULL,
 opening_origin jsonb NOT NULL,birth_basis_id uuid NOT NULL,
 sequence bigint NOT NULL CHECK(sequence>=0),operation_id uuid NOT NULL,payload_hash text NOT NULL,state jsonb NOT NULL CHECK(state='{}'::jsonb),
 PRIMARY KEY(organization_id,branch_id,terminal_id,shift_id)
);
CREATE TABLE fin62_history_preparation.stream_facts(
 organization_id text NOT NULL,branch_id text NOT NULL,terminal_id text NOT NULL,shift_id uuid NOT NULL,sale_id uuid NOT NULL,fact jsonb NOT NULL,
 PRIMARY KEY(organization_id,branch_id,terminal_id,shift_id,sale_id),
 FOREIGN KEY(organization_id,branch_id,terminal_id,shift_id) REFERENCES fin62_history_preparation.streams(organization_id,branch_id,terminal_id,shift_id)
);
ALTER TABLE fin62_history_preparation.stream_facts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON fin62_history_preparation.stream_facts FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION fin62_history_preparation.stream_state(p_org text,p_branch text,p_terminal text,p_shift uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT coalesce(jsonb_object_agg(sale_id::text,fact),'{}') FROM fin62_history_preparation.stream_facts WHERE organization_id=p_org AND branch_id=p_branch AND terminal_id=p_terminal AND shift_id=p_shift;
$$;CREATE TABLE fin62_history_preparation.nodes(
 operation_id uuid PRIMARY KEY,organization_id text NOT NULL,branch_id text NOT NULL,terminal_id text NOT NULL,shift_id uuid NOT NULL,
 sequence bigint NOT NULL CHECK(sequence>0),node_kind text NOT NULL CHECK(node_kind IN('MUTATION','CLOSE_BOUNDARY','OBSERVATION')),
 payload_json text NOT NULL,payload_hash text NOT NULL,proof jsonb NOT NULL,
 graph_json text,graph_author jsonb,basis_json text,graph_hash text,basis_hash text,
 observed_basis_id uuid REFERENCES fin62_cloud_preparation.bases(id),pending_from jsonb NOT NULL DEFAULT '{}'::jsonb,
 acknowledgement jsonb NOT NULL,UNIQUE(organization_id,branch_id,terminal_id,shift_id,sequence)
);
ALTER TABLE fin62_history_preparation.streams ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin62_history_preparation.nodes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA fin62_history_preparation FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION fin62_history_preparation.immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'FIN62_HISTORY_IMMUTABLE';END $$;
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON fin62_history_preparation.nodes FOR EACH ROW EXECUTE FUNCTION fin62_history_preparation.immutable();
CREATE FUNCTION fin62_history_preparation.canonical_json(value jsonb) RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
BEGIN
 IF jsonb_typeof(value)='object' THEN RETURN '{'||coalesce((SELECT string_agg(to_json(key)::text||':'||fin62_history_preparation.canonical_json(val),',' ORDER BY key COLLATE "C") FROM jsonb_each(value) x(key,val)),'')||'}';
 ELSIF jsonb_typeof(value)='array' THEN RETURN '['||coalesce((SELECT string_agg(fin62_history_preparation.canonical_json(val),',' ORDER BY n) FROM jsonb_array_elements(value) WITH ORDINALITY x(val,n)),'')||']';
 ELSE RETURN value::text;END IF;
END $$;
CREATE FUNCTION fin62_history_preparation.fact(value jsonb) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=pg_catalog AS $$
DECLARE result jsonb;
BEGIN
 IF jsonb_typeof(value)<>'object' OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(value) key) IS DISTINCT FROM
  ARRAY['branchId','discountAmount','id','isRefunded','paymentType','paymentsJson','rowVersion','shiftId','totalAmount']::text[] OR
  EXISTS(SELECT 1 FROM unnest(ARRAY['totalAmount','paymentType','paymentsJson','discountAmount','rowVersion']) field WHERE jsonb_typeof(value->field) NOT IN('string','null')) THEN RAISE EXCEPTION 'FIN62_OPERATION_FACT_INVALID';END IF;
 result:=fin62_cloud_preparation.financial_fact(value);
 RETURN result||jsonb_build_object('discountAmount',CASE WHEN value->'discountAmount'='null'::jsonb THEN 0 ELSE fin62_preparation.math_decimal_text(value->>'discountAmount') END);
END $$;
CREATE FUNCTION fin62_history_preparation.snapshot_fact(value jsonb) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=pg_catalog AS $$
DECLARE result jsonb;
BEGIN
 -- Reuse exact shape/numeric validation but do not parse excluded refund tenders.
 result:=fin62_history_preparation.fact(CASE WHEN value->'isRefunded'='true'::jsonb THEN value||jsonb_build_object('paymentType',NULL,'paymentsJson',NULL) ELSE value END);
 IF value->'isRefunded'='true'::jsonb THEN
  IF jsonb_typeof(value->'paymentType') NOT IN('string','null') OR jsonb_typeof(value->'paymentsJson') NOT IN('string','null') THEN RAISE EXCEPTION 'FIN62_OPERATION_FACT_INVALID';END IF;
  result:=result-'paymentType'-'payments';
 END IF;
 RETURN result;
END $$;
CREATE FUNCTION fin62_history_preparation.snapshot_canonical_fact(value jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog AS $$
 SELECT CASE WHEN value->'isRefunded'='true'::jsonb THEN value-'paymentType'-'payments' ELSE value END;
$$;
CREATE FUNCTION fin62_history_preparation.ensure_stream(p_org text,p_branch text,p_terminal text,p_shift uuid,p_origin jsonb) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE v_basis uuid;birth jsonb;genesis_id uuid;genesis_hash text;
BEGIN
 PERFORM fin62_rollout_preparation.assert_approved(p_org,p_branch,p_terminal);
 IF jsonb_typeof(p_origin) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'FIN62_HISTORY_ORIGIN_CONFLICT';END IF;
 IF p_origin?'serverBasisId' THEN
  IF (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(p_origin) key) IS DISTINCT FROM ARRAY['serverBasisHash','serverBasisId']::text[] THEN RAISE EXCEPTION 'FIN62_HISTORY_ORIGIN_CONFLICT';END IF;
  SELECT b.id,b.basis,b.basis_hash INTO v_basis,birth,genesis_hash FROM fin62_cloud_preparation.bases b WHERE b.id=(p_origin->>'serverBasisId')::uuid AND b.organization_id=p_org AND b.branch_id=p_branch AND b.terminal_id=p_terminal AND b.shift_id=p_shift;
  IF NOT FOUND OR genesis_hash IS DISTINCT FROM p_origin->>'serverBasisHash' THEN RAISE EXCEPTION 'FIN62_HISTORY_ORIGIN_CONFLICT';END IF;
  genesis_id:=v_basis;

 ELSE
  v_basis:=fin62_origin_preparation.resolve(p_org,p_branch,p_terminal,p_shift,p_origin);
  SELECT b.basis INTO STRICT birth FROM fin62_cloud_preparation.bases b WHERE b.id=v_basis;
  IF jsonb_array_length(birth->'inputs')<>0 THEN RAISE EXCEPTION 'FIN62_OPEN_BIRTH_NOT_EMPTY';END IF;
  genesis_id:=(p_origin->>'localAggregateId')::uuid;genesis_hash:=p_origin->>'rowHash';
 END IF;
 INSERT INTO fin62_history_preparation.protected_shifts VALUES(p_shift,p_branch) ON CONFLICT DO NOTHING;
  INSERT INTO fin62_history_preparation.streams VALUES(p_org,p_branch,p_terminal,p_shift,p_origin,v_basis,0,genesis_id,genesis_hash,'{}') ON CONFLICT DO NOTHING;
 IF FOUND THEN
  INSERT INTO fin62_history_preparation.stream_facts SELECT p_org,p_branch,p_terminal,p_shift,(item->>'id')::uuid,item FROM jsonb_array_elements(birth->'inputs') item;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM fin62_history_preparation.streams s WHERE s.organization_id=p_org AND s.branch_id=p_branch AND s.terminal_id=p_terminal AND s.shift_id=p_shift AND s.opening_origin=p_origin AND s.birth_basis_id=v_basis)
 THEN RAISE EXCEPTION 'FIN62_HISTORY_ORIGIN_CONFLICT';END IF;
END $$;
CREATE FUNCTION fin62_history_preparation.current_author(p_branch text,p_terminal text,p_proof jsonb,p_action text,p_operation uuid,p_hash text) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE v_key pos_sync_private.shift_author_keys%ROWTYPE;person public.app_users%ROWTYPE;flag text;
BEGIN
 IF jsonb_typeof(p_proof) IS DISTINCT FROM 'object' OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(p_proof) key) IS DISTINCT FROM
  (CASE WHEN p_action IN('ORIGINAL','RECOUNT') THEN ARRAY['action','algorithm','authorId','branchId','intentId','keyId','payloadHash','projectOrigin','shiftId','signature','subject','terminalId','version']::text[] ELSE ARRAY['action','algorithm','authorId','branchId','keyId','operationId','payloadHash','projectOrigin','signature','subject','terminalId','version']::text[] END) OR p_proof->'version' IS DISTINCT FROM '1'::jsonb OR p_proof->>'algorithm' IS DISTINCT FROM 'Ed25519' OR p_proof->>'terminalId' IS DISTINCT FROM p_terminal OR
  p_proof->>'branchId' IS DISTINCT FROM p_branch OR (CASE WHEN p_action IN('ORIGINAL','RECOUNT') THEN p_proof->>'intentId' ELSE p_proof->>'operationId' END) IS DISTINCT FROM p_operation::text OR p_proof->>'action' IS DISTINCT FROM p_action OR
  p_proof->>'payloadHash' IS DISTINCT FROM p_hash OR coalesce(p_proof->>'signature','')!~'^[A-Za-z0-9_-]{86}$'
 THEN RAISE EXCEPTION 'FIN62_HISTORY_AUTHOR_INVALID';END IF;
 SELECT * INTO v_key FROM pos_sync_private.shift_author_keys k WHERE k.key_id=(p_proof->>'keyId')::uuid FOR SHARE;
 IF NOT FOUND OR v_key.revoked_at IS NOT NULL OR v_key.terminal_id IS DISTINCT FROM p_terminal OR v_key.author_id::text IS DISTINCT FROM p_proof->>'authorId' OR
  v_key.project_origin IS DISTINCT FROM p_proof->>'projectOrigin' OR v_key.subject IS DISTINCT FROM p_proof->>'subject' THEN RAISE EXCEPTION 'FIN62_HISTORY_AUTHOR_REVOKED';END IF;
 SELECT * INTO person FROM public.app_users WHERE id=v_key.author_id FOR SHARE;
 IF NOT FOUND OR person.is_active IS DISTINCT FROM true OR person.user_id IS DISTINCT FROM v_key.subject OR (person.store_id IS NOT NULL AND person.store_id IS DISTINCT FROM p_branch)
 THEN RAISE EXCEPTION 'FIN62_HISTORY_AUTHOR_REVOKED';END IF;
 flag:=CASE p_action WHEN 'OPEN' THEN 'can_open_shift' WHEN 'SALE' THEN 'can_process_sale' WHEN 'REFUND' THEN 'can_process_refund' WHEN 'ORIGINAL' THEN 'can_shift_cash_count' WHEN 'RECOUNT' THEN 'can_shift_cash_recount' ELSE NULL END;
 IF flag IS NULL THEN RAISE EXCEPTION 'FIN62_HISTORY_UNSUPPORTED_ACTION';END IF;
 IF p_action IN('OPEN','SALE','REFUND') THEN
  IF NOT coalesce(person.permissions->flag='true'::jsonb,false) OR person.permissions->(CASE WHEN p_action='OPEN' THEN 'page:shifts' ELSE 'page:register' END)='false'::jsonb THEN RAISE EXCEPTION 'FIN62_HISTORY_PERMISSION_REVOKED';END IF;
 ELSE
  IF NOT(pos_sync_private.shift_author_flag(person.permissions,flag) OR (p_action='ORIGINAL' AND pos_sync_private.shift_author_flag(person.permissions,'can_close_shift'))) THEN RAISE EXCEPTION 'FIN62_HISTORY_PERMISSION_REVOKED';END IF;
 END IF;
END $$;
CREATE TABLE fin62_history_preparation.sale_birth_claims(sale_id uuid PRIMARY KEY,organization_id text,branch_id text NOT NULL,terminal_id text,shift_id uuid,operation_id uuid NOT NULL);
ALTER TABLE fin62_history_preparation.sale_birth_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON fin62_history_preparation.sale_birth_claims FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON fin62_history_preparation.sale_birth_claims FOR EACH ROW EXECUTE FUNCTION fin62_history_preparation.immutable();CREATE TABLE fin62_history_preparation.sale_steps(
 operation_id uuid NOT NULL REFERENCES fin62_history_preparation.nodes(operation_id) DEFERRABLE INITIALLY DEFERRED,sale_id uuid NOT NULL,
 organization_id text NOT NULL,branch_id text NOT NULL,terminal_id text NOT NULL,shift_id uuid NOT NULL,sequence bigint NOT NULL,
 action text NOT NULL CHECK(action IN('SALE','REFUND')),before_fact jsonb,after_fact jsonb NOT NULL,raw_before jsonb,raw_after jsonb NOT NULL,PRIMARY KEY(operation_id,sale_id)
);
CREATE INDEX sale_steps_scope_sale ON fin62_history_preparation.sale_steps(organization_id,branch_id,shift_id,sale_id,terminal_id);
CREATE INDEX sale_steps_scope_sequence ON fin62_history_preparation.sale_steps(organization_id,branch_id,terminal_id,shift_id,sequence,sale_id);
ALTER TABLE fin62_history_preparation.sale_steps ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON fin62_history_preparation.sale_steps FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON fin62_history_preparation.sale_steps FOR EACH ROW EXECUTE FUNCTION fin62_history_preparation.immutable();CREATE FUNCTION public.pos_sync_register_financial_event(p_org text,p_branch text,p_terminal text,p_raw text,p_proof jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE event jsonb;digest text;sid uuid;op uuid;n bigint;head fin62_history_preparation.streams%ROWTYPE;prior fin62_history_preparation.nodes%ROWTYPE;
 change jsonb;current_value jsonb;before_value jsonb;after_value jsonb;before_fact jsonb;after_fact jsonb;identifier text;ack jsonb;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'FIN62_SERVICE_REQUIRED';END IF;
 PERFORM public.pos_sync_validate_scope(p_org,p_branch,p_terminal);
 IF p_raw IS NULL OR octet_length(p_raw)>6*1024*1024 THEN RAISE EXCEPTION 'FIN62_HISTORY_LIMIT';END IF;
 PERFORM fin62_preparation.math_unique_json(p_raw::json,48);event:=p_raw::jsonb;
 IF jsonb_typeof(event)<>'object' OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(event) key) IS DISTINCT FROM
  (CASE WHEN event->'version'='2'::jsonb THEN ARRAY['action','branchId','changes','cloudOrigin','operationId','predecessorHash','predecessorOperationId','sequence','shiftId','terminalId','version']::text[] ELSE ARRAY['action','branchId','changes','openingOrigin','operationId','predecessorHash','predecessorOperationId','sequence','shiftId','terminalId','version']::text[] END) OR event->'version' NOT IN('1'::jsonb,'2'::jsonb) OR
  event->>'branchId' IS DISTINCT FROM p_branch OR event->>'terminalId' IS DISTINCT FROM p_terminal OR jsonb_typeof(event->'sequence') IS DISTINCT FROM 'string' OR
  coalesce(event->>'sequence','')!~'^[1-9][0-9]{0,18}$' OR jsonb_typeof(event->'changes') IS DISTINCT FROM 'array' OR jsonb_array_length(event->'changes') NOT BETWEEN 1 AND 500
 THEN RAISE EXCEPTION 'FIN62_HISTORY_EVENT_INVALID';END IF;
 op:=(event->>'operationId')::uuid;sid:=(event->>'shiftId')::uuid;n:=(event->>'sequence')::bigint;
 IF op IS NULL OR sid IS NULL OR n::text IS DISTINCT FROM event->>'sequence' THEN RAISE EXCEPTION 'FIN62_HISTORY_EVENT_INVALID';END IF;
 digest:=encode(sha256(convert_to(p_raw,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended('fin62-history-node:'||op::text,0));
 SELECT * INTO prior FROM fin62_history_preparation.nodes WHERE operation_id=op;
 IF FOUND THEN
  IF prior.node_kind<>'MUTATION' OR ROW(prior.organization_id,prior.branch_id,prior.terminal_id,prior.shift_id,prior.sequence,prior.payload_hash) IS DISTINCT FROM ROW(p_org,p_branch,p_terminal,sid,n,digest) OR
   convert_to(prior.payload_json,'UTF8') IS DISTINCT FROM convert_to(p_raw,'UTF8') OR prior.proof IS DISTINCT FROM p_proof THEN RAISE EXCEPTION 'FIN62_HISTORY_REPLAY_MISMATCH';END IF;
  RETURN prior.acknowledgement; -- No new write, no permission revival.
 END IF;
 PERFORM fin62_history_preparation.current_author(p_branch,p_terminal,p_proof,event->>'action',op,digest);
 PERFORM fin62_history_preparation.ensure_stream(p_org,p_branch,p_terminal,sid,coalesce(event->'openingOrigin',event->'cloudOrigin'));
 SELECT * INTO STRICT head FROM fin62_history_preparation.streams s WHERE s.organization_id=p_org AND s.branch_id=p_branch AND s.terminal_id=p_terminal AND s.shift_id=sid FOR UPDATE;
 IF n<>head.sequence+1 OR event->>'predecessorOperationId' IS DISTINCT FROM head.operation_id::text OR event->>'predecessorHash' IS DISTINCT FROM head.payload_hash THEN RAISE EXCEPTION 'FIN62_HISTORY_GAP_OR_CONFLICT';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(event->'changes') x GROUP BY x->>'saleId' HAVING count(*)>1) THEN RAISE EXCEPTION 'FIN62_HISTORY_EVENT_INVALID';END IF;

 FOR change IN SELECT value FROM jsonb_array_elements(event->'changes') ORDER BY value->>'saleId' LOOP
  IF jsonb_typeof(change)<>'object' OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(change) key) IS DISTINCT FROM ARRAY['after','before','saleId']::text[] THEN RAISE EXCEPTION 'FIN62_HISTORY_EVENT_INVALID';END IF;
  identifier:=(change->>'saleId')::uuid::text;IF identifier IS NULL THEN RAISE EXCEPTION 'FIN62_HISTORY_EVENT_INVALID';END IF;
  before_value:=nullif(change->'before','null'::jsonb);after_value:=nullif(change->'after','null'::jsonb);
  SELECT fact INTO current_value FROM fin62_history_preparation.stream_facts WHERE organization_id=p_org AND branch_id=p_branch AND terminal_id=p_terminal AND shift_id=sid AND sale_id=identifier::uuid FOR UPDATE;
  before_fact:=fin62_history_preparation.fact(before_value);after_fact:=fin62_history_preparation.fact(after_value);
  IF before_fact IS DISTINCT FROM fin62_history_preparation.fact(current_value) OR after_fact IS NULL OR
   after_fact->>'id' IS DISTINCT FROM identifier OR after_fact->>'branchId' IS DISTINCT FROM fin62_cloud_preparation.fact_identity(p_branch) OR after_fact->>'shiftId' IS DISTINCT FROM sid::text
  THEN RAISE EXCEPTION 'FIN62_HISTORY_BEFORE_OR_SCOPE_MISMATCH';END IF;
  IF event->>'action'='SALE' THEN
   IF before_value IS NOT NULL OR coalesce((after_fact->>'isRefunded')::boolean,false) THEN RAISE EXCEPTION 'FIN62_HISTORY_FIELD_POLICY';END IF;   IF EXISTS(SELECT 1 FROM public.sales s WHERE s.id=identifier::uuid) THEN RAISE EXCEPTION 'FIN62_SALE_BIRTH_ALREADY_EXISTS';END IF;
   INSERT INTO fin62_history_preparation.sale_birth_claims VALUES(identifier::uuid,p_org,p_branch,p_terminal,sid,op) ON CONFLICT DO NOTHING;
   IF NOT FOUND THEN RAISE EXCEPTION 'FIN62_SALE_BIRTH_ALREADY_CLAIMED';END IF;
  ELSIF event->>'action'='REFUND' THEN
   IF before_fact IS NULL OR coalesce((before_fact->>'isRefunded')::boolean,false) OR after_fact->'isRefunded' IS DISTINCT FROM 'true'::jsonb OR (before_fact-'isRefunded') IS DISTINCT FROM (after_fact-'isRefunded') THEN RAISE EXCEPTION 'FIN62_HISTORY_FIELD_POLICY';END IF;
  ELSE RAISE EXCEPTION 'FIN62_HISTORY_UNSUPPORTED_ACTION';END IF;
  INSERT INTO fin62_history_preparation.sale_steps VALUES(op,identifier::uuid,p_org,p_branch,p_terminal,sid,n,event->>'action',before_fact,after_fact,before_value,after_value);
  INSERT INTO fin62_history_preparation.stream_facts VALUES(p_org,p_branch,p_terminal,sid,identifier::uuid,after_value)
  ON CONFLICT(organization_id,branch_id,terminal_id,shift_id,sale_id) DO UPDATE SET fact=EXCLUDED.fact WHERE fin62_history_preparation.stream_facts.fact IS DISTINCT FROM EXCLUDED.fact;
 END LOOP;

 ack:=jsonb_build_object('status','financial_metadata_recorded','operationId',op,'payloadHash',digest,'sequence',n::text,'businessUploaded',false,'shiftClosed',false);
 INSERT INTO fin62_history_preparation.nodes(operation_id,organization_id,branch_id,terminal_id,shift_id,sequence,node_kind,payload_json,payload_hash,proof,acknowledgement)
 VALUES(op,p_org,p_branch,p_terminal,sid,n,'MUTATION',p_raw,digest,p_proof,ack);
 UPDATE fin62_history_preparation.streams SET sequence=n,operation_id=op,payload_hash=digest WHERE organization_id=p_org AND branch_id=p_branch AND terminal_id=p_terminal AND shift_id=sid;
 RETURN ack;
END $fn$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA fin62_history_preparation FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.pos_sync_register_financial_event(text,text,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pos_sync_register_financial_event(text,text,text,text,jsonb) TO service_role;

CREATE FUNCTION fin62_history_preparation.check_frontier(p_org text,p_branch text,p_terminal text,p_shift uuid,p_origin jsonb,p_raw_basis text)
RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$
DECLARE basis jsonb;frontier jsonb;head fin62_history_preparation.streams%ROWTYPE;computed jsonb;birth jsonb;item jsonb;
BEGIN
 PERFORM fin62_history_preparation.ensure_stream(p_org,p_branch,p_terminal,p_shift,p_origin);
 SELECT * INTO STRICT head FROM fin62_history_preparation.streams s WHERE s.organization_id=p_org AND s.branch_id=p_branch AND s.terminal_id=p_terminal AND s.shift_id=p_shift FOR UPDATE;
 computed:=fin62_preparation.validate_financial_math_text(p_raw_basis);
 IF computed->>'status' IS DISTINCT FROM 'computed' THEN RAISE EXCEPTION 'FIN62_HISTORY_BASIS_UNSUPPORTED';END IF;
 basis:=p_raw_basis::jsonb;frontier:=basis->'financialFrontier';
 IF basis->>'branchId' IS DISTINCT FROM p_branch OR basis->>'shiftId' IS DISTINCT FROM p_shift::text OR jsonb_typeof(frontier) IS DISTINCT FROM 'object' OR
  (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(frontier) key) IS DISTINCT FROM (CASE WHEN p_origin?'serverBasisId' THEN ARRAY['cloudOrigin','hash','operationId','reservedSequence','sequence']::text[] ELSE ARRAY['hash','openingOrigin','operationId','reservedSequence','sequence']::text[] END) OR
  coalesce(frontier->'openingOrigin',frontier->'cloudOrigin') IS DISTINCT FROM p_origin OR jsonb_typeof(frontier->'sequence') IS DISTINCT FROM 'string' OR jsonb_typeof(frontier->'reservedSequence') IS DISTINCT FROM 'string' OR
  frontier->>'sequence' IS DISTINCT FROM head.sequence::text OR frontier->>'reservedSequence' IS DISTINCT FROM (head.sequence+1)::text OR
  frontier->>'operationId' IS DISTINCT FROM head.operation_id::text OR frontier->>'hash' IS DISTINCT FROM head.payload_hash
 THEN RAISE EXCEPTION 'FIN62_HISTORY_FRONTIER_GAP_OR_CONFLICT';END IF;
 SELECT b.basis INTO STRICT birth FROM fin62_cloud_preparation.bases b WHERE b.id=head.birth_basis_id;
 IF (CASE WHEN basis->'openingFloat'='null'::jsonb THEN 0 ELSE fin62_preparation.math_decimal_text(basis->>'openingFloat') END)
  IS DISTINCT FROM (CASE WHEN birth->'openingFloat'='null'::jsonb THEN 0 ELSE fin62_preparation.math_decimal_text(birth->>'openingFloat') END)
 THEN RAISE EXCEPTION 'FIN62_HISTORY_OPENING_MISMATCH';END IF;
 IF jsonb_array_length(basis->'inputs')<>(SELECT count(*) FROM fin62_history_preparation.stream_facts f WHERE f.organization_id=p_org AND f.branch_id=p_branch AND f.terminal_id=p_terminal AND f.shift_id=p_shift) THEN RAISE EXCEPTION 'FIN62_HISTORY_SNAPSHOT_INCOMPLETE';END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(basis->'inputs') LOOP
  IF fin62_history_preparation.snapshot_fact(item) IS DISTINCT FROM fin62_history_preparation.snapshot_fact((SELECT f.fact FROM fin62_history_preparation.stream_facts f WHERE f.organization_id=p_org AND f.branch_id=p_branch AND f.terminal_id=p_terminal AND f.shift_id=p_shift AND f.sale_id=(item->>'id')::uuid)) THEN RAISE EXCEPTION 'FIN62_HISTORY_SNAPSHOT_INCOMPLETE';END IF;
 END LOOP;
 RETURN computed||jsonb_build_object('reservedSequence',(head.sequence+1)::text,'predecessorOperationId',head.operation_id,'predecessorHash',head.payload_hash);
END $fn$;
CREATE FUNCTION public.pos_sync_register_financial_boundary(p_org text,p_branch text,p_terminal text,p_raw_graph text,p_graph_author jsonb,p_financial_basis jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE graph jsonb;basis jsonb;proof jsonb;raw_basis text;graph_hash text;basis_hash text;sid uuid;op uuid;frontier jsonb;computed jsonb;
 parent jsonb;field text;value numeric;head fin62_history_preparation.streams%ROWTYPE;prior fin62_history_preparation.nodes%ROWTYPE;payload jsonb;payload_text text;digest text;ack jsonb;validation_graph jsonb;operation_part jsonb;submitted jsonb;total_rows integer:=0;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'FIN62_SERVICE_REQUIRED';END IF;
 PERFORM public.pos_sync_validate_scope(p_org,p_branch,p_terminal);
 IF p_raw_graph IS NULL OR octet_length(p_raw_graph)>6*1024*1024 OR jsonb_typeof(p_financial_basis) IS DISTINCT FROM 'object' OR
  (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(p_financial_basis) key) IS DISTINCT FROM ARRAY['basisJson','proof']::text[] OR jsonb_typeof(p_financial_basis->'basisJson') IS DISTINCT FROM 'string'
 THEN RAISE EXCEPTION 'FIN62_HISTORY_BOUNDARY_INVALID';END IF;
 PERFORM fin62_preparation.math_unique_json(p_raw_graph::json,48);graph:=p_raw_graph::jsonb;raw_basis:=p_financial_basis->>'basisJson';
 IF octet_length(raw_basis)>6*1024*1024 THEN RAISE EXCEPTION 'FIN62_HISTORY_LIMIT';END IF;
 PERFORM fin62_preparation.math_unique_json(raw_basis::json,48);basis:=raw_basis::jsonb;proof:=p_financial_basis->'proof';
 graph_hash:=encode(sha256(convert_to(p_raw_graph,'UTF8')),'hex');basis_hash:=encode(sha256(convert_to(raw_basis,'UTF8')),'hex');
 op:=(graph->>'intentId')::uuid;sid:=(graph->>'shiftId')::uuid;
 IF op IS NULL OR sid IS NULL OR graph->>'branchId' IS DISTINCT FROM p_branch OR graph->>'kind' NOT IN('ORIGINAL','RECOUNT') OR
  p_graph_author->>'shiftId' IS DISTINCT FROM sid::text OR proof->>'shiftId' IS DISTINCT FROM sid::text OR proof->>'graphPayloadHash' IS DISTINCT FROM graph_hash OR
  proof->>'basisHash' IS DISTINCT FROM basis_hash OR proof->>'formula' IS DISTINCT FROM 'canonical-exact-decimal-v2' OR
  (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(proof) key) IS DISTINCT FROM
  (CASE WHEN proof?'serverBasisId' THEN ARRAY['action','algorithm','authorId','basisHash','branchId','formula','graphPayloadHash','intentId','keyId','projectOrigin','serverBasisId','shiftId','signature','subject','terminalId','version']::text[] ELSE ARRAY['action','algorithm','authorId','basisHash','branchId','formula','graphPayloadHash','intentId','keyId','openingOrigin','projectOrigin','shiftId','signature','subject','terminalId','version']::text[] END) OR
  coalesce(proof->>'signature','')!~'^[A-Za-z0-9_-]{86}$'
 THEN RAISE EXCEPTION 'FIN62_HISTORY_BOUNDARY_INVALID';END IF;
 FOREACH field IN ARRAY ARRAY['version','algorithm','keyId','projectOrigin','terminalId','authorId','subject','branchId','shiftId','intentId','action'] LOOP
  IF proof->field IS DISTINCT FROM p_graph_author->field THEN RAISE EXCEPTION 'FIN62_HISTORY_AUTHOR_BINDING_MISMATCH';END IF;
 END LOOP;
 IF p_graph_author->>'payloadHash' IS DISTINCT FROM graph_hash THEN RAISE EXCEPTION 'FIN62_HISTORY_AUTHOR_BINDING_MISMATCH';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('fin62-history-node:'||op::text,0));
 SELECT * INTO prior FROM fin62_history_preparation.nodes WHERE operation_id=op;
 IF FOUND THEN
  IF prior.node_kind<>'CLOSE_BOUNDARY' OR ROW(prior.organization_id,prior.branch_id,prior.terminal_id,prior.shift_id,prior.graph_hash,prior.basis_hash) IS DISTINCT FROM ROW(p_org,p_branch,p_terminal,sid,graph_hash,basis_hash) OR
   convert_to(prior.graph_json,'UTF8') IS DISTINCT FROM convert_to(p_raw_graph,'UTF8') OR convert_to(prior.basis_json,'UTF8') IS DISTINCT FROM convert_to(raw_basis,'UTF8') OR prior.proof IS DISTINCT FROM proof OR prior.graph_author IS DISTINCT FROM p_graph_author
  THEN RAISE EXCEPTION 'FIN62_HISTORY_REPLAY_MISMATCH';END IF;
  RETURN prior.acknowledgement;
 END IF;
 PERFORM fin62_history_preparation.current_author(p_branch,p_terminal,p_graph_author,graph->>'kind',op,graph_hash);
 computed:=fin62_history_preparation.check_frontier(p_org,p_branch,p_terminal,sid,coalesce(proof->'openingOrigin',basis->'financialFrontier'->'cloudOrigin'),raw_basis);
 -- Existing actual graph validation checks links/count math/branch consistency,
 -- but metadata registration never invokes a shift mutation or graph receipt.
 -- Main freezes operations in registry dependency order, not validator order.
 -- Build only an ordered validation view; the original signed bytes/hash and
 -- complete optional variance activity remain immutable in the receipt.
 IF jsonb_typeof(graph->'operations') IS DISTINCT FROM 'array' OR jsonb_array_length(graph->'operations') NOT IN(6,7) OR
  (SELECT count(DISTINCT x.value->>'table') FROM jsonb_array_elements(graph->'operations') x)<>jsonb_array_length(graph->'operations') OR
  EXISTS(SELECT 1 FROM jsonb_array_elements(graph->'operations') x WHERE x->>'table' IS NULL OR x->>'table'<>ALL(ARRAY['shifts','shift_cash_counts','shift_reconciliations','shift_close_events','shift_notifications','shift_variance_alerts','activity_events']) OR coalesce((x->>'deletePhase')::boolean,false) OR jsonb_typeof(x->'rows') IS DISTINCT FROM 'array' OR coalesce(x->'changes','[]'::jsonb)<>'[]'::jsonb)
 THEN RAISE EXCEPTION 'FIN62_HISTORY_BOUNDARY_INVALID';END IF;
 FOREACH field IN ARRAY ARRAY['shifts','shift_cash_counts','shift_reconciliations','shift_close_events','shift_notifications','shift_variance_alerts'] LOOP
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(graph->'operations') x WHERE x->>'table'=field) THEN RAISE EXCEPTION 'FIN62_HISTORY_BOUNDARY_INVALID';END IF;
 END LOOP;
 FOR operation_part IN SELECT x.value FROM jsonb_array_elements(graph->'operations') x LOOP
  total_rows:=total_rows+jsonb_array_length(operation_part->'rows');
  IF total_rows>2000 OR (SELECT count(*)<>count(DISTINCT x.value->>'id') FROM jsonb_array_elements(operation_part->'rows') x) THEN RAISE EXCEPTION 'SYNC_SHIFT_GRAPH_DUPLICATE';END IF;
  FOR submitted IN SELECT x.value FROM jsonb_array_elements(operation_part->'rows') x LOOP
   IF lower(btrim(submitted->>'store_id')) IS DISTINCT FROM lower(btrim(p_branch)) OR (submitted?'branch_id' AND lower(btrim(submitted->>'branch_id')) IS DISTINCT FROM lower(btrim(p_branch))) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN';END IF;
   IF operation_part->>'table'='activity_events' AND (submitted->>'event_type' IS DISTINCT FROM 'shift_cash_variance' OR submitted->>'entity_type' IS DISTINCT FROM 'shift' OR (submitted->>'entity_id')::uuid IS DISTINCT FROM sid OR lower(btrim(submitted->>'branch_id')) IS DISTINCT FROM lower(btrim(p_branch))) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN';END IF;
  END LOOP;
 END LOOP;
 SELECT jsonb_agg(jsonb_build_object('table',name,'rows',(SELECT jsonb_agg(row_value||jsonb_build_object('store_id',p_branch,'id',(row_value->>'id')::uuid::text)||CASE WHEN name='shifts' THEN '{}'::jsonb ELSE jsonb_build_object('shift_id',(row_value->>'shift_id')::uuid::text) END) FROM jsonb_array_elements((SELECT x->'rows' FROM jsonb_array_elements(graph->'operations') x WHERE x->>'table'=name)) row_value)) ORDER BY ordinal)
 INTO validation_graph FROM unnest(ARRAY['shifts','shift_cash_counts','shift_reconciliations','shift_close_events','shift_notifications','shift_variance_alerts']) WITH ORDINALITY names(name,ordinal);
 -- Empty child arrays remain arrays rather than SQL NULL in this view.
 SELECT jsonb_agg(jsonb_set(x,'{rows}',coalesce(nullif(x->'rows','null'::jsonb),'[]'::jsonb)) ORDER BY ordinal) INTO validation_graph FROM jsonb_array_elements(validation_graph) WITH ORDINALITY parts(x,ordinal);
 PERFORM pos_sync_private.validate_graph(validation_graph,p_branch,sid,true);
 SELECT row_value INTO parent FROM jsonb_array_elements(graph->'operations') part,LATERAL jsonb_array_elements(part->'rows') row_value WHERE part->>'table'='shifts';
 FOREACH field IN ARRAY ARRAY['cash','card','digital'] LOOP
  IF NOT parent?('expected_'||field) OR jsonb_typeof(parent->('expected_'||field)) NOT IN('number','string') THEN RAISE EXCEPTION 'FIN62_HISTORY_EXPECTED_MISMATCH';END IF;
  value:=fin62_preparation.math_decimal_text(parent->>('expected_'||field));
  IF value IS DISTINCT FROM fin62_preparation.math_decimal_text(computed->'expected'->>field) THEN RAISE EXCEPTION 'FIN62_HISTORY_EXPECTED_MISMATCH';END IF;
 END LOOP;
 SELECT * INTO STRICT head FROM fin62_history_preparation.streams s WHERE s.organization_id=p_org AND s.branch_id=p_branch AND s.terminal_id=p_terminal AND s.shift_id=sid FOR UPDATE;
 IF proof?'serverBasisId' AND proof->>'serverBasisId' IS DISTINCT FROM head.birth_basis_id::text THEN RAISE EXCEPTION 'FIN62_HISTORY_ORIGIN_CONFLICT';END IF;
 payload:=jsonb_build_object(CASE WHEN head.opening_origin?'serverBasisId' THEN 'cloudOrigin' ELSE 'openingOrigin' END,head.opening_origin,'sequence',(head.sequence+1)::text,'predecessorOperationId',head.operation_id,'predecessorHash',head.payload_hash,
  'intentId',op,'graphPayloadHash',graph_hash,'basisHash',basis_hash);
 payload_text:=fin62_history_preparation.canonical_json(payload);digest:=encode(sha256(convert_to(payload_text,'UTF8')),'hex');
 ack:=jsonb_build_object('status','boundary_registered_not_shift_closed','operationId',op,'payloadHash',digest,'sequence',(head.sequence+1)::text,
  'graphPayloadHash',graph_hash,'basisHash',basis_hash,'businessUploaded',false,'shiftClosed',false);
 INSERT INTO fin62_history_preparation.nodes(operation_id,organization_id,branch_id,terminal_id,shift_id,sequence,node_kind,payload_json,payload_hash,proof,graph_json,graph_author,basis_json,graph_hash,basis_hash,acknowledgement)
 VALUES(op,p_org,p_branch,p_terminal,sid,head.sequence+1,'CLOSE_BOUNDARY',payload_text,digest,proof,p_raw_graph,p_graph_author,raw_basis,graph_hash,basis_hash,ack);
 UPDATE fin62_history_preparation.streams SET sequence=head.sequence+1,operation_id=op,payload_hash=digest WHERE organization_id=p_org AND branch_id=p_branch AND terminal_id=p_terminal AND shift_id=sid;
 RETURN ack;
END $fn$;
-- Source alias protection preparation. There is intentionally NO activation API
-- or privileged-context issuer until web and every native financial alias are
-- integrated. Owner-only fixtures may add protected scopes to prove bypass deny.
CREATE TABLE fin62_history_preparation.protected_shifts(shift_id uuid PRIMARY KEY,branch_id text NOT NULL);
ALTER TABLE fin62_history_preparation.protected_shifts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON fin62_history_preparation.protected_shifts FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION fin62_history_preparation.block_unintegrated_write() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE sid text;branch text;
BEGIN
 IF TG_OP='DELETE' THEN sid:=OLD.shift_id;branch:=OLD.store_id;ELSE sid:=NEW.shift_id;branch:=NEW.store_id;END IF;
 IF EXISTS(SELECT 1 FROM fin62_history_preparation.protected_shifts p WHERE p.shift_id::text=sid AND p.branch_id=branch) OR
  (TG_OP='UPDATE' AND EXISTS(SELECT 1 FROM fin62_history_preparation.protected_shifts p WHERE p.shift_id::text=OLD.shift_id AND p.branch_id=OLD.store_id))
 THEN RAISE EXCEPTION 'FIN62_FINANCIAL_ALIAS_NOT_INTEGRATED';END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;ELSE RETURN NEW;END IF;
END $$;
CREATE TRIGGER prototype_fin62_financial_write_guard BEFORE INSERT OR UPDATE OR DELETE ON public.sales FOR EACH ROW EXECUTE FUNCTION fin62_history_preparation.block_unintegrated_write();
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA fin62_history_preparation FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.pos_sync_register_financial_boundary(text,text,text,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pos_sync_register_financial_boundary(text,text,text,text,jsonb,jsonb) TO service_role;
-- Actual guarded OPEN adapter. Proof crypto remains the existing HTTP service
-- admission precondition; SQL independently checks exact envelope/key/person.
CREATE TABLE fin62_history_preparation.open_author_receipts(
 local_aggregate_id uuid PRIMARY KEY,organization_id text NOT NULL,branch_id text NOT NULL,terminal_id text NOT NULL,
 envelope_json text NOT NULL,proof jsonb NOT NULL,acknowledgement jsonb NOT NULL
);
ALTER TABLE fin62_history_preparation.open_author_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON fin62_history_preparation.open_author_receipts FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON fin62_history_preparation.open_author_receipts FOR EACH ROW EXECUTE FUNCTION fin62_history_preparation.immutable();
CREATE FUNCTION public.pos_sync_register_financial_open(p_batch uuid,p_org text,p_branch text,p_terminal text,p_local_aggregate uuid,p_opening_json text,p_row_hash text,p_operations jsonb,p_opening_envelope text,p_proof jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE envelope jsonb;prior fin62_history_preparation.open_author_receipts%ROWTYPE;ack jsonb;digest text;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'FIN62_SERVICE_REQUIRED';END IF;
 PERFORM public.pos_sync_validate_scope(p_org,p_branch,p_terminal);
 IF p_opening_envelope IS NULL OR octet_length(p_opening_envelope)>6*1024*1024 THEN RAISE EXCEPTION 'FIN62_HISTORY_OPEN_INVALID';END IF;
 PERFORM fin62_preparation.math_unique_json(p_opening_envelope::json,48);envelope:=p_opening_envelope::jsonb;
 IF jsonb_typeof(envelope) IS DISTINCT FROM 'object' OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(envelope) key) IS DISTINCT FROM
  ARRAY['branchId','localAggregateId','rowHash','rowJson','shiftId','terminalId','version']::text[] OR envelope->'version' IS DISTINCT FROM '1'::jsonb OR
  envelope->>'branchId' IS DISTINCT FROM p_branch OR envelope->>'terminalId' IS DISTINCT FROM p_terminal OR envelope->>'localAggregateId' IS DISTINCT FROM p_local_aggregate::text OR
  envelope->>'rowHash' IS DISTINCT FROM p_row_hash OR convert_to(envelope->>'rowJson','UTF8') IS DISTINCT FROM convert_to(p_opening_json,'UTF8') OR
  envelope->>'shiftId' IS DISTINCT FROM (p_opening_json::jsonb)->>'id'
 THEN RAISE EXCEPTION 'FIN62_HISTORY_OPEN_INVALID';END IF;
 digest:=encode(sha256(convert_to(p_opening_envelope,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended('fin62-history-open:'||p_local_aggregate::text,0));
 SELECT * INTO prior FROM fin62_history_preparation.open_author_receipts WHERE local_aggregate_id=p_local_aggregate;
 IF FOUND THEN
  IF ROW(prior.organization_id,prior.branch_id,prior.terminal_id) IS DISTINCT FROM ROW(p_org,p_branch,p_terminal) OR
   convert_to(prior.envelope_json,'UTF8') IS DISTINCT FROM convert_to(p_opening_envelope,'UTF8') OR prior.proof IS DISTINCT FROM p_proof
  THEN RAISE EXCEPTION 'FIN62_HISTORY_REPLAY_MISMATCH';END IF;
  -- Underlying exact origin replay also compares batch/operations/raw row and
  -- cannot reopen an already closed shift or manufacture a new birth.
  PERFORM public.prototype_fin62_push_open_origin(p_batch,p_org,p_branch,p_terminal,p_local_aggregate,p_opening_json,p_row_hash,p_operations);
  RETURN prior.acknowledgement;
 END IF;
 PERFORM fin62_rollout_preparation.assert_approved(p_org,p_branch,p_terminal);
 PERFORM fin62_history_preparation.current_author(p_branch,p_terminal,p_proof,'OPEN',p_local_aggregate,digest);
 ack:=public.prototype_fin62_push_open_origin(p_batch,p_org,p_branch,p_terminal,p_local_aggregate,p_opening_json,p_row_hash,p_operations);
 INSERT INTO fin62_history_preparation.protected_shifts VALUES((envelope->>'shiftId')::uuid,p_branch) ON CONFLICT DO NOTHING;
 INSERT INTO fin62_history_preparation.open_author_receipts VALUES(p_local_aggregate,p_org,p_branch,p_terminal,p_opening_envelope,p_proof,ack);
 RETURN ack;
END $fn$;
REVOKE ALL ON FUNCTION public.pos_sync_register_financial_open(uuid,text,text,text,uuid,text,text,jsonb,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pos_sync_register_financial_open(uuid,text,text,text,uuid,text,text,jsonb,text,jsonb) TO service_role;
CREATE TABLE fin62_history_preparation.business_context(pid integer NOT NULL,xid xid8 NOT NULL,organization_id text NOT NULL,branch_id text NOT NULL,terminal_id text NOT NULL,PRIMARY KEY(pid,xid));
CREATE TABLE fin62_history_preparation.business_receipts(batch_id uuid PRIMARY KEY,organization_id text NOT NULL,branch_id text NOT NULL,terminal_id text NOT NULL,operations jsonb NOT NULL,acknowledgement jsonb NOT NULL);
ALTER TABLE fin62_history_preparation.business_context ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin62_history_preparation.business_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON fin62_history_preparation.business_context,fin62_history_preparation.business_receipts FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON fin62_history_preparation.business_receipts FOR EACH ROW EXECUTE FUNCTION fin62_history_preparation.immutable();
CREATE TABLE fin62_history_preparation.publications(
 batch_id uuid NOT NULL REFERENCES fin62_history_preparation.business_receipts(batch_id),sale_id uuid NOT NULL,
 organization_id text NOT NULL,branch_id text NOT NULL,terminal_id text NOT NULL,shift_id uuid NOT NULL,financial_fact jsonb NOT NULL,
 stream_sequence bigint NOT NULL,capture_xid xid8 NOT NULL,evidence_order bigint NOT NULL,
 PRIMARY KEY(batch_id,sale_id)
);
CREATE INDEX publications_scope_sale ON fin62_history_preparation.publications(organization_id,branch_id,shift_id,sale_id,terminal_id);
ALTER TABLE fin62_history_preparation.publications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON fin62_history_preparation.publications FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON fin62_history_preparation.publications FOR EACH ROW EXECUTE FUNCTION fin62_history_preparation.immutable();CREATE FUNCTION fin62_history_preparation.row_fact(p_row jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog AS $$
 SELECT fin62_history_preparation.fact(fin62_version_preparation.basis(p_row)||jsonb_build_object('discountAmount',p_row->>'discount_amount'));
$$;
CREATE FUNCTION fin62_history_preparation.row_snapshot_fact(p_row jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog AS $$
 SELECT fin62_history_preparation.snapshot_fact(fin62_version_preparation.basis(p_row)||jsonb_build_object('discountAmount',p_row->>'discount_amount'));
$$;CREATE TABLE fin62_history_preparation.live_context(pid integer NOT NULL,xid xid8 NOT NULL,branch_id text NOT NULL,shift_id uuid,sale_id uuid NOT NULL,author_id uuid NOT NULL,action text NOT NULL CHECK(action IN('SALE','REFUND')),PRIMARY KEY(pid,xid));
ALTER TABLE fin62_history_preparation.live_context ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON fin62_history_preparation.live_context FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION fin62_history_preparation.live_row_allowed(p_operation text,p_old jsonb,p_new jsonb) RETURNS boolean LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE scope fin62_history_preparation.live_context%ROWTYPE;before_fact jsonb;after_fact jsonb;
BEGIN
 SELECT * INTO scope FROM fin62_history_preparation.live_context WHERE pid=pg_backend_pid() AND xid=pg_current_xact_id();
 IF NOT FOUND OR p_operation='DELETE' OR p_new->>'store_id' IS DISTINCT FROM scope.branch_id THEN RETURN false;END IF;
 IF p_operation='INSERT' THEN
  RETURN scope.action='SALE' AND p_new->>'id'=scope.sale_id::text AND p_new->>'shift_id' IS NOT DISTINCT FROM scope.shift_id::text;
 END IF;
 IF ROW(p_old->>'store_id',p_old->>'shift_id') IS DISTINCT FROM ROW(p_new->>'store_id',p_new->>'shift_id') THEN RETURN false;END IF;
 before_fact:=fin62_history_preparation.row_fact(p_old);after_fact:=fin62_history_preparation.row_fact(p_new);
 IF scope.action='SALE' THEN RETURN before_fact IS NOT DISTINCT FROM after_fact;END IF;
 RETURN scope.action='REFUND' AND p_new->>'id'=scope.sale_id::text AND p_new->>'shift_id' IS NOT DISTINCT FROM scope.shift_id::text AND
  (before_fact-'isRefunded') IS NOT DISTINCT FROM (after_fact-'isRefunded') AND NOT(coalesce((before_fact->>'isRefunded')::boolean,false) AND NOT coalesce((after_fact->>'isRefunded')::boolean,false));
END $$;
REVOKE ALL ON FUNCTION fin62_history_preparation.live_row_allowed(text,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;CREATE OR REPLACE FUNCTION fin62_history_preparation.block_unintegrated_write() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE sid text;b text;protected boolean:=false;scope fin62_history_preparation.business_context%ROWTYPE;desired jsonb;
BEGIN
 IF TG_OP='DELETE' THEN sid:=OLD.shift_id;b:=OLD.store_id;ELSE sid:=NEW.shift_id;b:=NEW.store_id;END IF;
 SELECT EXISTS(SELECT 1 FROM fin62_history_preparation.protected_shifts p WHERE p.shift_id::text=sid AND p.branch_id=b) INTO protected;
 IF TG_OP='UPDATE' THEN protected:=protected OR EXISTS(SELECT 1 FROM fin62_history_preparation.protected_shifts p WHERE p.shift_id::text=OLD.shift_id AND p.branch_id=OLD.store_id);END IF;
 IF NOT protected THEN IF TG_OP='DELETE' THEN RETURN OLD;ELSE RETURN NEW;END IF;END IF;
 IF fin62_history_preparation.live_row_allowed(TG_OP,CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END,CASE WHEN TG_OP='DELETE' THEN NULL ELSE to_jsonb(NEW) END) THEN RETURN NEW;END IF;
 SELECT * INTO scope FROM fin62_history_preparation.business_context WHERE pid=pg_backend_pid() AND xid=pg_current_xact_id();
 IF NOT FOUND OR scope.branch_id IS DISTINCT FROM b OR TG_OP='DELETE' THEN RAISE EXCEPTION 'FIN62_FINANCIAL_ALIAS_NOT_INTEGRATED';END IF;
 SELECT s.fact INTO desired FROM fin62_history_preparation.stream_facts s WHERE s.organization_id=scope.organization_id AND s.branch_id=scope.branch_id AND s.terminal_id=scope.terminal_id AND s.shift_id::text=sid AND s.sale_id=NEW.id;
 IF desired IS NULL OR fin62_history_preparation.row_snapshot_fact(to_jsonb(NEW)) IS DISTINCT FROM fin62_history_preparation.snapshot_fact(desired) THEN RAISE EXCEPTION 'FIN62_FINANCIAL_PROJECTION_MISMATCH';END IF;
 IF TG_OP='UPDATE' AND ROW(OLD.shift_id,OLD.store_id) IS DISTINCT FROM ROW(NEW.shift_id,NEW.store_id) THEN RAISE EXCEPTION 'FIN62_FINANCIAL_SCOPE_IMMUTABLE';END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION public.pos_sync_push_financial_business_aggregate(p_batch uuid,p_org text,p_branch text,p_terminal text,p_operations jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE prior fin62_history_preparation.business_receipts%ROWTYPE;part jsonb;r jsonb;sid uuid;sale uuid;head fin62_history_preparation.streams%ROWTYPE;stored jsonb;cursor_fact jsonb;target jsonb;node record;change jsonb;ack jsonb;started boolean;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'FIN62_SERVICE_REQUIRED';END IF;
 PERFORM public.pos_sync_validate_scope(p_org,p_branch,p_terminal);
 IF p_batch IS NULL OR jsonb_typeof(p_operations) IS DISTINCT FROM 'array' OR octet_length(p_operations::text)>6*1024*1024 THEN RAISE EXCEPTION 'FIN62_BUSINESS_INVALID';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('fin62-business:'||p_batch::text,0));
 SELECT * INTO prior FROM fin62_history_preparation.business_receipts WHERE batch_id=p_batch;
 IF FOUND THEN
  IF ROW(prior.organization_id,prior.branch_id,prior.terminal_id) IS DISTINCT FROM ROW(p_org,p_branch,p_terminal) OR prior.operations IS DISTINCT FROM p_operations THEN RAISE EXCEPTION 'FIN62_HISTORY_REPLAY_MISMATCH';END IF;
  RETURN prior.acknowledgement;
 END IF;
  -- All protected business projections and graph publication use the same
 -- per-shift lock before reading a head or writing a sale (phantom prevention).
 FOR sid IN SELECT DISTINCT (row_value->>'shift_id')::uuid FROM jsonb_array_elements(p_operations) op_part,LATERAL jsonb_array_elements(op_part->'rows') row_value WHERE op_part->>'table'='sales' ORDER BY 1 LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended('pos-sync-shift:'||sid::text,0));
 END LOOP;
 FOR part IN SELECT value FROM jsonb_array_elements(p_operations) LOOP
  IF part->>'table' IN('shift_cash_counts','shift_reconciliations','shift_close_events','shift_notifications','shift_variance_alerts') THEN RAISE EXCEPTION 'FIN62_BUSINESS_SHIFT_GRAPH_FORBIDDEN';END IF;
  IF part->>'table'='shifts' AND EXISTS(SELECT 1 FROM jsonb_array_elements(part->'rows') row_value WHERE row_value->>'status' IS DISTINCT FROM 'OPEN' OR row_value->>'state' IS DISTINCT FROM 'ACTIVE' OR NOT EXISTS(SELECT 1 FROM public.shifts s WHERE s.id::text=row_value->>'id' AND s.store_id=p_branch AND s.status='OPEN' AND s.state='ACTIVE')) THEN RAISE EXCEPTION 'FIN62_BUSINESS_SHIFT_GRAPH_FORBIDDEN';END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(part->'changes','[]')) c WHERE c->>'op' IN('D','DELETE')) THEN RAISE EXCEPTION 'FIN62_BUSINESS_DELETE_UNSUPPORTED';END IF;
  IF part->>'table'='sales' THEN
   FOR r IN SELECT value FROM jsonb_array_elements(part->'rows') LOOP
    sid:=(r->>'shift_id')::uuid;sale:=(r->>'id')::uuid;
    SELECT * INTO head FROM fin62_history_preparation.streams s WHERE s.organization_id=p_org AND s.branch_id=p_branch AND s.terminal_id=p_terminal AND s.shift_id=sid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'FIN62_BUSINESS_HISTORY_REQUIRED';END IF;
    SELECT fin62_history_preparation.fact(f.fact) INTO target FROM fin62_history_preparation.stream_facts f WHERE f.organization_id=p_org AND f.branch_id=p_branch AND f.terminal_id=p_terminal AND f.shift_id=sid AND f.sale_id=sale;
    IF target IS NULL OR fin62_history_preparation.row_fact(r) IS DISTINCT FROM target THEN RAISE EXCEPTION 'FIN62_FINANCIAL_PROJECTION_MISMATCH';END IF;
    SELECT to_jsonb(s) INTO stored FROM public.sales s WHERE s.id=sale FOR UPDATE;
    IF stored IS NOT NULL AND ROW(stored->>'store_id',stored->>'shift_id') IS DISTINCT FROM ROW(p_branch,sid::text) THEN RAISE EXCEPTION 'FIN62_FINANCIAL_SCOPE_IMMUTABLE';END IF;
    cursor_fact:=fin62_history_preparation.row_fact(stored);started:=false;
    IF cursor_fact IS DISTINCT FROM target THEN
     FOR node IN SELECT n.* FROM fin62_history_preparation.nodes n WHERE n.organization_id=p_org AND n.branch_id=p_branch AND n.terminal_id=p_terminal AND n.shift_id=sid AND n.node_kind='MUTATION' ORDER BY n.sequence LOOP
      FOR change IN SELECT value FROM jsonb_array_elements(node.payload_json::jsonb->'changes') WHERE value->>'saleId'=sale::text LOOP
       IF NOT started AND fin62_history_preparation.fact(nullif(change->'before','null'::jsonb)) IS NOT DISTINCT FROM cursor_fact THEN started:=true;END IF;
       IF started THEN
        IF fin62_history_preparation.fact(nullif(change->'before','null'::jsonb)) IS DISTINCT FROM cursor_fact THEN RAISE EXCEPTION 'FIN62_BUSINESS_HISTORY_DIVERGED';END IF;
        PERFORM fin62_history_preparation.current_author(p_branch,p_terminal,node.proof,node.payload_json::jsonb->>'action',node.operation_id,node.payload_hash);
        cursor_fact:=fin62_history_preparation.fact(nullif(change->'after','null'::jsonb));
       END IF;
      END LOOP;
     END LOOP;
     IF NOT started OR cursor_fact IS DISTINCT FROM target THEN RAISE EXCEPTION 'FIN62_BUSINESS_HISTORY_DIVERGED';END IF;
    END IF;
   END LOOP;
  END IF;
 END LOOP;
 INSERT INTO fin62_history_preparation.business_context VALUES(pg_backend_pid(),pg_current_xact_id(),p_org,p_branch,p_terminal);
 ack:=public.pos_sync_push_aggregate(p_batch,p_org,p_branch,p_terminal,p_operations);
 -- Read back actual persisted values; stale/monotonic writer behaviour must
 -- never turn an apparently accepted projection into different public money.
 FOR part IN SELECT value FROM jsonb_array_elements(p_operations) WHERE value->>'table'='sales' LOOP
  FOR r IN SELECT value FROM jsonb_array_elements(part->'rows') LOOP
   SELECT to_jsonb(s) INTO stored FROM public.sales s WHERE s.id=(r->>'id')::uuid;
   IF fin62_history_preparation.row_fact(stored) IS DISTINCT FROM fin62_history_preparation.row_fact(r) THEN RAISE EXCEPTION 'FIN62_FINANCIAL_PROJECTION_MISMATCH';END IF;
  END LOOP;
 END LOOP;
 DELETE FROM fin62_history_preparation.business_context WHERE pid=pg_backend_pid() AND xid=pg_current_xact_id();
 INSERT INTO fin62_history_preparation.business_receipts VALUES(p_batch,p_org,p_branch,p_terminal,p_operations,ack); -- Immutable indexed facts come only from actual persisted business rows after
 -- successful writer/readback, never from a caller-issued authorized snapshot.
 INSERT INTO fin62_history_preparation.publications(batch_id,sale_id,organization_id,branch_id,terminal_id,shift_id,financial_fact,stream_sequence,capture_xid,evidence_order)
 SELECT p_batch,s.id,p_org,p_branch,p_terminal,s.shift_id::uuid,fin62_history_preparation.row_fact(to_jsonb(s)),h.sequence,pg_current_xact_id(),nextval('fin62_evidence_preparation.helper_order')
 FROM jsonb_array_elements(p_operations) source_part,LATERAL jsonb_array_elements(source_part->'rows') source_row
 JOIN public.sales s ON s.id=(source_row->>'id')::uuid
 JOIN fin62_history_preparation.streams h ON h.organization_id=p_org AND h.branch_id=p_branch AND h.terminal_id=p_terminal AND h.shift_id::text=s.shift_id
 WHERE source_part->>'table'='sales';
 RETURN ack;
END $fn$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA fin62_history_preparation FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.pos_sync_push_financial_business_aggregate(uuid,text,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pos_sync_push_financial_business_aggregate(uuid,text,text,text,jsonb) TO service_role;
CREATE TABLE fin62_history_preparation.graph_context(pid integer NOT NULL,xid xid8 NOT NULL,branch_id text NOT NULL,shift_id uuid NOT NULL,PRIMARY KEY(pid,xid));
ALTER TABLE fin62_history_preparation.graph_context ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON fin62_history_preparation.graph_context FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION fin62_history_preparation.guard_shift_graph() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM fin62_history_preparation.protected_shifts p WHERE p.shift_id=OLD.id AND p.branch_id=OLD.store_id) AND
  (to_jsonb(NEW)-ARRAY['updated_at','row_version']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['updated_at','row_version']) AND
  NOT EXISTS(SELECT 1 FROM fin62_history_preparation.graph_context c WHERE c.pid=pg_backend_pid() AND c.xid=pg_current_xact_id() AND c.branch_id=OLD.store_id AND c.shift_id=OLD.id)
 THEN RAISE EXCEPTION 'FIN62_SHIFT_ALIAS_NOT_INTEGRATED';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER prototype_fin62_shift_write_guard BEFORE UPDATE ON public.shifts FOR EACH ROW EXECUTE FUNCTION fin62_history_preparation.guard_shift_graph();
REVOKE ALL ON FUNCTION fin62_history_preparation.guard_shift_graph() FROM PUBLIC,anon,authenticated,service_role;
-- A public fact that differs from this terminal's known snapshot is admissible
-- only with an actual successful guarded business publication by another stream.
-- Supported later mutations are only immutable SALE births and false->true REFUND.
CREATE FUNCTION fin62_history_preparation.published_later_fact(p_org text,p_branch text,p_shift uuid,p_sale uuid,p_before jsonb,p_after jsonb) RETURNS boolean
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE native_proof boolean;live_proof boolean;web_edges jsonb:='[]';published boolean;
BEGIN
 SELECT EXISTS(
  SELECT 1 FROM fin62_history_preparation.publications publication
  JOIN fin62_history_preparation.business_receipts receipt ON receipt.batch_id=publication.batch_id
  JOIN fin62_history_preparation.sale_steps step ON step.organization_id=publication.organization_id AND step.branch_id=publication.branch_id AND step.shift_id=publication.shift_id AND step.sale_id=publication.sale_id AND step.terminal_id=publication.terminal_id
  JOIN fin62_history_preparation.nodes node ON node.operation_id=step.operation_id AND node.organization_id=step.organization_id AND node.branch_id=step.branch_id AND node.terminal_id=step.terminal_id AND node.shift_id=step.shift_id AND node.node_kind='MUTATION'
  WHERE publication.organization_id=p_org AND publication.branch_id=p_branch AND publication.shift_id=p_shift AND publication.sale_id=p_sale
   AND receipt.organization_id=p_org AND receipt.branch_id=p_branch AND receipt.terminal_id=publication.terminal_id
   AND fin62_history_preparation.snapshot_canonical_fact(publication.financial_fact) IS NOT DISTINCT FROM p_after AND fin62_history_preparation.snapshot_canonical_fact(step.before_fact) IS NOT DISTINCT FROM p_before AND fin62_history_preparation.snapshot_canonical_fact(step.after_fact) IS NOT DISTINCT FROM p_after
   AND ((p_before IS NULL AND step.action='SALE' AND EXISTS(SELECT 1 FROM fin62_history_preparation.sale_birth_claims claim WHERE claim.sale_id=p_sale AND claim.operation_id=node.operation_id AND claim.organization_id=p_org AND claim.branch_id=p_branch AND claim.shift_id=p_shift)) OR (p_before IS NOT NULL AND step.action='REFUND'))
 ) INTO native_proof;
 IF native_proof THEN RETURN true;END IF;
 IF to_regprocedure('fin62_live_preparation.proves_later_publication(text,text,uuid,uuid,jsonb,jsonb)') IS NOT NULL THEN
  EXECUTE 'SELECT fin62_live_preparation.proves_later_publication($1,$2,$3,$4,$5,$6)' INTO live_proof USING p_org,p_branch,p_shift,p_sale,p_before,p_after;
  IF live_proof THEN RETURN true;END IF;
 END IF;
 IF to_regprocedure('fin62_live_preparation.publication_edges(text,text,uuid,uuid)') IS NOT NULL THEN
  EXECUTE 'SELECT coalesce(jsonb_agg(jsonb_build_object(''before'',before_fact,''after'',after_fact)),''[]'') FROM fin62_live_preparation.publication_edges($1,$2,$3,$4)' INTO web_edges USING p_org,p_branch,p_shift,p_sale;
 END IF;
 -- A chain of metadata alone is never publication. Its final fact must exist
 -- in an actual guarded native/business or live success receipt.
 SELECT EXISTS(SELECT 1 FROM fin62_history_preparation.publications p WHERE p.organization_id=p_org AND p.branch_id=p_branch AND p.shift_id=p_shift AND p.sale_id=p_sale AND fin62_history_preparation.snapshot_canonical_fact(p.financial_fact) IS NOT DISTINCT FROM p_after)
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(web_edges) e WHERE fin62_history_preparation.snapshot_canonical_fact(nullif(e->'after','null'::jsonb)) IS NOT DISTINCT FROM p_after) INTO published;
 IF NOT published THEN RETURN false;END IF;
 RETURN(WITH native_edges AS(
  SELECT fin62_history_preparation.snapshot_canonical_fact(step.before_fact) before_fact,fin62_history_preparation.snapshot_canonical_fact(step.after_fact) after_fact
  FROM fin62_history_preparation.sale_steps step JOIN fin62_history_preparation.nodes node ON node.operation_id=step.operation_id AND node.organization_id=step.organization_id AND node.branch_id=step.branch_id AND node.terminal_id=step.terminal_id AND node.shift_id=step.shift_id AND node.node_kind='MUTATION'
  WHERE step.organization_id=p_org AND step.branch_id=p_branch AND step.shift_id=p_shift AND step.sale_id=p_sale AND
   (step.action='REFUND' OR (step.action='SALE' AND EXISTS(SELECT 1 FROM fin62_history_preparation.sale_birth_claims claim WHERE claim.sale_id=p_sale AND claim.operation_id=step.operation_id AND claim.organization_id=p_org AND claim.branch_id=p_branch AND claim.shift_id=p_shift)))
 ),edges AS(
  SELECT * FROM native_edges UNION
  SELECT fin62_history_preparation.snapshot_canonical_fact(nullif(e->'before','null'::jsonb)),fin62_history_preparation.snapshot_canonical_fact(nullif(e->'after','null'::jsonb)) FROM jsonb_array_elements(web_edges) e
 ) SELECT EXISTS(SELECT 1 FROM edges WHERE before_fact IS NOT DISTINCT FROM p_before AND after_fact IS NOT DISTINCT FROM p_after)
  OR EXISTS(SELECT 1 FROM edges first_edge JOIN edges second_edge ON first_edge.after_fact IS NOT DISTINCT FROM second_edge.before_fact WHERE first_edge.before_fact IS NOT DISTINCT FROM p_before AND second_edge.after_fact IS NOT DISTINCT FROM p_after));
END $$;
CREATE FUNCTION fin62_history_preparation.require_published_projection(p_org text,p_branch text,p_terminal text,p_shift uuid) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE head fin62_history_preparation.streams%ROWTYPE;row_value record;expected jsonb;actual jsonb;
BEGIN
 -- Caller holds pos-sync-shift advisory lock. All compatible business writers
 -- acquire that same lock before financial DML; legacy protected aliases deny.
 SELECT * INTO STRICT head FROM fin62_history_preparation.streams s WHERE s.organization_id=p_org AND s.branch_id=p_branch AND s.terminal_id=p_terminal AND s.shift_id=p_shift FOR UPDATE;
 FOR row_value IN SELECT s.id,to_jsonb(s) value FROM public.sales s WHERE s.store_id=p_branch AND s.shift_id=p_shift::text ORDER BY s.id FOR UPDATE LOOP
  SELECT fin62_history_preparation.snapshot_fact(f.fact) INTO expected FROM fin62_history_preparation.stream_facts f WHERE f.organization_id=p_org AND f.branch_id=p_branch AND f.terminal_id=p_terminal AND f.shift_id=p_shift AND f.sale_id=row_value.id;actual:=fin62_history_preparation.row_snapshot_fact(row_value.value);
  IF actual IS DISTINCT FROM expected AND NOT fin62_history_preparation.published_later_fact(p_org,p_branch,p_shift,row_value.id,expected,actual) THEN RAISE EXCEPTION 'FIN62_BUSINESS_PUBLICATION_REQUIRED';END IF;

 END LOOP;
 IF EXISTS(SELECT 1 FROM fin62_history_preparation.stream_facts f WHERE f.organization_id=p_org AND f.branch_id=p_branch AND f.terminal_id=p_terminal AND f.shift_id=p_shift AND NOT EXISTS(SELECT 1 FROM public.sales s WHERE s.id=f.sale_id AND s.store_id=p_branch AND s.shift_id=p_shift::text)) THEN RAISE EXCEPTION 'FIN62_BUSINESS_PUBLICATION_REQUIRED';END IF;END $$;
REVOKE ALL ON FUNCTION fin62_history_preparation.published_later_fact(text,text,uuid,uuid,jsonb,jsonb),fin62_history_preparation.require_published_projection(text,text,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
-- Prepared override depends on the earlier financial-admission foundation.
-- Legacy basis-only inputs retain their existing guarded implementation.
ALTER FUNCTION public.pos_sync_push_financial_shift_intent(uuid,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) RENAME TO prototype_fin62_legacy_financial_shift_intent;
REVOKE ALL ON FUNCTION public.prototype_fin62_legacy_financial_shift_intent(uuid,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.pos_sync_push_financial_shift_intent(p_batch_id uuid,p_organization_id text,p_branch_id text,p_terminal_id text,p_operations jsonb,p_shift_intent jsonb,p_shift_author jsonb,p_author_authority jsonb,p_closing_start jsonb,p_start_authority jsonb,p_financial_basis jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE raw_basis text;raw_graph text;proof jsonb;basis jsonb;graph jsonb;node fin62_history_preparation.nodes%ROWTYPE;prior fin62_action_preparation.receipts%ROWTYPE;basis_id uuid;result jsonb;ack_version integer;origin jsonb;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'FIN62_SERVICE_REQUIRED';END IF;
 raw_basis:=p_financial_basis->>'basisJson';basis:=raw_basis::jsonb;
 IF NOT basis?'financialFrontier' THEN RETURN public.prototype_fin62_legacy_financial_shift_intent(p_batch_id,p_organization_id,p_branch_id,p_terminal_id,p_operations,p_shift_intent,p_shift_author,p_author_authority,p_closing_start,p_start_authority,p_financial_basis);END IF;
 PERFORM public.pos_sync_validate_scope(p_organization_id,p_branch_id,p_terminal_id);
 raw_graph:=p_shift_intent->>'payloadJson';graph:=raw_graph::jsonb;proof:=p_financial_basis->'proof';
 IF p_batch_id IS NULL OR p_batch_id::text IS DISTINCT FROM graph->>'intentId' THEN RAISE EXCEPTION 'FIN62_HISTORY_REPLAY_MISMATCH';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('pos-sync-batch:'||p_batch_id::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('pos-sync-intent:'||p_batch_id::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('pos-sync-shift:'||(graph->>'shiftId'),0));
 SELECT * INTO node FROM fin62_history_preparation.nodes WHERE operation_id=p_batch_id;
 IF NOT FOUND OR node.node_kind IS DISTINCT FROM 'CLOSE_BOUNDARY' OR ROW(node.organization_id,node.branch_id,node.terminal_id,node.shift_id::text) IS DISTINCT FROM ROW(p_organization_id,p_branch_id,p_terminal_id,graph->>'shiftId') OR
  convert_to(node.graph_json,'UTF8') IS DISTINCT FROM convert_to(raw_graph,'UTF8') OR convert_to(node.basis_json,'UTF8') IS DISTINCT FROM convert_to(raw_basis,'UTF8') OR node.proof IS DISTINCT FROM proof OR node.graph_author IS DISTINCT FROM p_shift_author
 THEN RAISE EXCEPTION 'FIN62_REGISTERED_BOUNDARY_REQUIRED';END IF;
 origin:=coalesce(proof->'openingOrigin',basis->'financialFrontier'->'cloudOrigin');
 SELECT birth_basis_id INTO STRICT basis_id FROM fin62_history_preparation.streams WHERE organization_id=p_organization_id AND branch_id=p_branch_id AND terminal_id=p_terminal_id AND shift_id=node.shift_id AND opening_origin=origin;
 SELECT * INTO prior FROM fin62_action_preparation.receipts WHERE intent_id=p_batch_id;
 IF prior.intent_id IS NULL THEN
  IF EXISTS(SELECT 1 FROM pos_sync_private.shift_intent_receipts WHERE intent_id=p_batch_id) THEN RAISE EXCEPTION 'FIN62_FINANCIAL_HISTORY_UNPROVEN';END IF;
  PERFORM fin62_history_preparation.current_author(p_branch_id,p_terminal_id,p_shift_author,graph->>'kind',p_batch_id,node.graph_hash);
  PERFORM fin62_history_preparation.require_published_projection(p_organization_id,p_branch_id,p_terminal_id,node.shift_id);
 END IF;
 INSERT INTO fin62_history_preparation.graph_context VALUES(pg_backend_pid(),pg_current_xact_id(),p_branch_id,node.shift_id);
 -- Unchanged real author/start writers enforce current authority, actor, count,
 -- original/recount state and causal token. Metadata alone is never this ACK.
 IF p_closing_start IS NOT NULL THEN result:=public.pos_sync_push_started_shift_intent(p_batch_id,p_organization_id,p_branch_id,p_terminal_id,p_operations,p_shift_intent,p_shift_author,p_author_authority,p_closing_start,p_start_authority);
 ELSE
  IF p_start_authority IS NOT NULL THEN RAISE EXCEPTION 'FIN62_START_PROOF_REQUIRED';END IF;
  result:=public.pos_sync_push_author_shift_intent(p_batch_id,p_organization_id,p_branch_id,p_terminal_id,p_operations,p_shift_intent,p_shift_author,p_author_authority);
 END IF;
 DELETE FROM fin62_history_preparation.graph_context WHERE pid=pg_backend_pid() AND xid=pg_current_xact_id();
 IF prior.intent_id IS NULL THEN
  INSERT INTO fin62_action_preparation.receipts(intent_id,organization_id,branch_id,terminal_id,shift_id,author_id,key_id,graph_payload_hash,basis_id,basis_hash,basis_json,basis_proof,formula,acknowledgement)
  VALUES(p_batch_id,p_organization_id,p_branch_id,p_terminal_id,node.shift_id,(proof->>'authorId')::uuid,(proof->>'keyId')::uuid,node.graph_hash,basis_id,node.basis_hash,raw_basis,proof,proof->>'formula',result);
 END IF;
 ack_version:=CASE WHEN proof?'openingOrigin' THEN 2 ELSE 1 END;
 RETURN result||jsonb_build_object('financial_basis_receipt',jsonb_build_object('ack_version',ack_version,'intentId',p_batch_id,'graphPayloadHash',node.graph_hash,'basisHash',node.basis_hash,'serverBasisId',basis_id,'formula',proof->>'formula')||CASE WHEN ack_version=2 THEN jsonb_build_object('openingOrigin',origin) ELSE '{}'::jsonb END);
END $fn$;
REVOKE ALL ON FUNCTION public.pos_sync_push_financial_shift_intent(uuid,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pos_sync_push_financial_shift_intent(uuid,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) TO service_role;
CREATE FUNCTION public.pos_sync_read_financial_basis(p_org text,p_branch text,p_terminal text,p_shift uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_basis jsonb;evidence jsonb;published jsonb;
BEGIN
 v_basis:=public.prototype_fin62_create_basis(p_org,p_branch,p_terminal,p_shift);
 SELECT jsonb_build_object('creatorXid',b.creator_xid::text,'snapshot',b.snapshot_text,'evidenceOrder',b.evidence_order::text) INTO evidence FROM fin62_cloud_preparation.bases b WHERE b.id=(v_basis->>'basisId')::uuid;
  SELECT coalesce(jsonb_object_agg(sale_id::text,covered::text),'{}') INTO published FROM(
  SELECT p.sale_id,max(p.stream_sequence) covered FROM fin62_history_preparation.publications p JOIN fin62_cloud_preparation.bases b ON b.id=(v_basis->>'basisId')::uuid
  WHERE p.organization_id=p_org AND p.branch_id=p_branch AND p.terminal_id=p_terminal AND p.shift_id=p_shift
  AND CASE WHEN p.capture_xid=b.creator_xid THEN p.evidence_order<b.evidence_order ELSE pg_visible_in_snapshot(p.capture_xid,b.snapshot_text::pg_snapshot) END GROUP BY p.sale_id
 ) proof;
 RETURN v_basis||jsonb_build_object('parentSnapshot',v_basis->'basis'->'parentSnapshot','sourceEvidence',evidence,'ownPublishedThrough',published);
END $$;
REVOKE ALL ON FUNCTION public.pos_sync_read_financial_basis(text,text,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pos_sync_read_financial_basis(text,text,text,uuid) TO service_role;
CREATE FUNCTION fin62_history_preparation.visible_materialized_sequence(p_org text,p_branch text,p_terminal text,p_shift uuid,p_sale uuid,p_source uuid) RETURNS bigint LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT coalesce(max(p.stream_sequence),0) FROM fin62_history_preparation.publications p JOIN fin62_cloud_preparation.bases b ON b.id=p_source
 WHERE p.organization_id=p_org AND p.branch_id=p_branch AND p.terminal_id=p_terminal AND p.shift_id=p_shift AND p.sale_id=p_sale
 AND CASE WHEN p.capture_xid=b.creator_xid THEN p.evidence_order<b.evidence_order ELSE pg_visible_in_snapshot(p.capture_xid,b.snapshot_text::pg_snapshot) END;
$$;
REVOKE ALL ON FUNCTION fin62_history_preparation.visible_materialized_sequence(text,text,text,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
-- Verified-device read-metadata only. Source is a complete immutable actual SQL
-- basis; own deltas come only from previously accepted immutable signed events.
-- No writer is replayed and no current actor grant is invented by observation.
CREATE FUNCTION public.pos_sync_register_financial_observation(p_org text,p_branch text,p_terminal text,p_raw text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE body jsonb;op uuid;sid uuid;n bigint;digest text;origin jsonb;source fin62_cloud_preparation.bases%ROWTYPE;
 prior fin62_history_preparation.nodes%ROWTYPE;previous fin62_history_preparation.nodes%ROWTYPE;previous_basis fin62_cloud_preparation.bases%ROWTYPE;
 head fin62_history_preparation.streams%ROWTYPE;source_state jsonb;merged jsonb;pending jsonb:='{}';previous_pending jsonb:='{}';previous_sequence bigint:=0;
 overrides jsonb[]:=ARRAY[]::jsonb[];pending_entries jsonb[]:=ARRAY[]::jsonb[];identifier uuid;step record;first_step boolean;source_value jsonb;working jsonb;chosen bigint;earliest bigint;covered_sequence bigint;previous_raw jsonb;calc jsonb;ack jsonb;merged_array jsonb;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'FIN62_SERVICE_REQUIRED';END IF;
 PERFORM public.pos_sync_validate_scope(p_org,p_branch,p_terminal);
 IF p_raw IS NULL OR octet_length(p_raw)>16384 THEN RAISE EXCEPTION 'FIN62_OBSERVATION_LIMIT';END IF;
 PERFORM fin62_preparation.math_unique_json(p_raw::json,56);body:=p_raw::jsonb;
 IF jsonb_typeof(body) IS DISTINCT FROM 'object' OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(body) key) IS DISTINCT FROM
  (CASE WHEN body->'version'='2'::jsonb THEN ARRAY['action','branchId','cloudOrigin','observedBasis','operationId','predecessorHash','predecessorOperationId','sequence','shiftId','terminalId','version']::text[] ELSE ARRAY['action','branchId','observedBasis','openingOrigin','operationId','predecessorHash','predecessorOperationId','sequence','shiftId','terminalId','version']::text[] END) OR
  body->'version' NOT IN('1'::jsonb,'2'::jsonb) OR body->>'action' IS DISTINCT FROM 'OBSERVE' OR body->>'branchId' IS DISTINCT FROM p_branch OR body->>'terminalId' IS DISTINCT FROM p_terminal OR
  jsonb_typeof(body->'sequence') IS DISTINCT FROM 'string' OR coalesce(body->>'sequence','')!~'^[1-9][0-9]{0,18}$' OR jsonb_typeof(body->'observedBasis') IS DISTINCT FROM 'object' OR
  (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(body->'observedBasis') key) IS DISTINCT FROM ARRAY['serverBasisHash','serverBasisId']::text[]
 THEN RAISE EXCEPTION 'FIN62_OBSERVATION_INVALID';END IF;
 op:=(body->>'operationId')::uuid;sid:=(body->>'shiftId')::uuid;n:=(body->>'sequence')::bigint;digest:=encode(sha256(convert_to(p_raw,'UTF8')),'hex');
 IF op IS NULL OR sid IS NULL OR n::text IS DISTINCT FROM body->>'sequence' THEN RAISE EXCEPTION 'FIN62_OBSERVATION_INVALID';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('fin62-history-node:'||op::text,0));
 SELECT * INTO prior FROM fin62_history_preparation.nodes WHERE operation_id=op;
 IF FOUND THEN
  IF prior.node_kind IS DISTINCT FROM 'OBSERVATION' OR ROW(prior.organization_id,prior.branch_id,prior.terminal_id,prior.shift_id,prior.sequence,prior.payload_hash) IS DISTINCT FROM ROW(p_org,p_branch,p_terminal,sid,n,digest) OR convert_to(prior.payload_json,'UTF8') IS DISTINCT FROM convert_to(p_raw,'UTF8') THEN RAISE EXCEPTION 'FIN62_HISTORY_REPLAY_MISMATCH';END IF;
  RETURN prior.acknowledgement;
 END IF;
 origin:=coalesce(body->'openingOrigin',body->'cloudOrigin');
 PERFORM fin62_history_preparation.ensure_stream(p_org,p_branch,p_terminal,sid,origin);
 SELECT * INTO STRICT head FROM fin62_history_preparation.streams s WHERE s.organization_id=p_org AND s.branch_id=p_branch AND s.terminal_id=p_terminal AND s.shift_id=sid FOR UPDATE;
 IF n<>head.sequence+1 OR body->>'predecessorOperationId' IS DISTINCT FROM head.operation_id::text OR body->>'predecessorHash' IS DISTINCT FROM head.payload_hash THEN RAISE EXCEPTION 'FIN62_HISTORY_GAP_OR_CONFLICT';END IF;
 SELECT * INTO source FROM fin62_cloud_preparation.bases b WHERE b.id=(body->'observedBasis'->>'serverBasisId')::uuid AND b.organization_id=p_org AND b.branch_id=p_branch AND b.terminal_id=p_terminal AND b.shift_id=sid;
 IF NOT FOUND OR source.basis_hash IS DISTINCT FROM body->'observedBasis'->>'serverBasisHash' THEN RAISE EXCEPTION 'FIN62_OBSERVATION_SOURCE_UNPROVEN';END IF;
 SELECT * INTO previous FROM fin62_history_preparation.nodes node WHERE node.organization_id=p_org AND node.branch_id=p_branch AND node.terminal_id=p_terminal AND node.shift_id=sid AND node.node_kind='OBSERVATION' ORDER BY node.sequence DESC LIMIT 1;
 IF FOUND THEN previous_sequence:=previous.sequence;previous_pending:=previous.pending_from;SELECT * INTO STRICT previous_basis FROM fin62_cloud_preparation.bases WHERE id=previous.observed_basis_id;
 ELSE SELECT * INTO STRICT previous_basis FROM fin62_cloud_preparation.bases WHERE id=head.birth_basis_id;END IF;
 -- This is MVCC receipt visibility, never a wall-time or global sequence clock.
 IF source.creator_xid=previous_basis.creator_xid THEN
  IF source.evidence_order<=previous_basis.evidence_order THEN RAISE EXCEPTION 'FIN62_OBSERVATION_SOURCE_STALE';END IF;
 ELSIF NOT pg_visible_in_snapshot(previous_basis.creator_xid,source.snapshot_text::pg_snapshot) THEN RAISE EXCEPTION 'FIN62_OBSERVATION_SOURCE_STALE';END IF;
 IF (CASE WHEN source.basis->>'openingFloat' IS NULL THEN 0 ELSE fin62_preparation.math_decimal_text(source.basis->>'openingFloat') END) IS DISTINCT FROM
  (CASE WHEN previous_basis.basis->>'openingFloat' IS NULL THEN 0 ELSE fin62_preparation.math_decimal_text(previous_basis.basis->>'openingFloat') END) THEN RAISE EXCEPTION 'FIN62_OBSERVATION_OPENING_CHANGED';END IF;
 SELECT coalesce(jsonb_object_agg(item->>'id',item),'{}') INTO source_state FROM jsonb_array_elements(source.basis->'inputs') item;
 merged:=source_state;
 FOR identifier IN SELECT DISTINCT e.sale_id FROM fin62_history_preparation.sale_steps e WHERE e.organization_id=p_org AND e.branch_id=p_branch AND e.terminal_id=p_terminal AND e.shift_id=sid AND
  (e.sequence>previous_sequence OR (previous_pending?e.sale_id::text AND e.sequence>=(previous_pending->>e.sale_id::text)::bigint)) LOOP
  covered_sequence:=fin62_history_preparation.visible_materialized_sequence(p_org,p_branch,p_terminal,sid,identifier,source.id);
  source_value:=source_state->identifier::text;chosen:=NULL;first_step:=true;previous_raw:=NULL;
  FOR step IN SELECT e.* FROM fin62_history_preparation.sale_steps e WHERE e.organization_id=p_org AND e.branch_id=p_branch AND e.terminal_id=p_terminal AND e.shift_id=sid AND e.sale_id=identifier AND e.sequence>covered_sequence AND
   (e.sequence>previous_sequence OR (previous_pending?identifier::text AND e.sequence>=(previous_pending->>identifier::text)::bigint)) ORDER BY e.sequence LOOP
   IF first_step THEN
    IF fin62_history_preparation.snapshot_fact(source_value) IS NOT DISTINCT FROM fin62_history_preparation.snapshot_fact(step.raw_before) THEN chosen:=0;END IF;
    first_step:=false;
   ELSIF fin62_history_preparation.snapshot_fact(previous_raw) IS DISTINCT FROM fin62_history_preparation.snapshot_fact(step.raw_before) THEN RAISE EXCEPTION 'FIN62_OBSERVATION_OWN_CHAIN_DIVERGED';END IF;
   IF fin62_history_preparation.snapshot_fact(source_value) IS NOT DISTINCT FROM fin62_history_preparation.snapshot_fact(step.raw_after) THEN chosen:=step.sequence;END IF;
   previous_raw:=step.raw_after;
  END LOOP;
  IF first_step THEN CONTINUE;END IF;
  IF chosen IS NULL THEN RAISE EXCEPTION 'FIN62_OBSERVATION_MERGE_DIVERGED';END IF;
  working:=source_value;earliest:=NULL;
  FOR step IN SELECT e.* FROM fin62_history_preparation.sale_steps e WHERE e.organization_id=p_org AND e.branch_id=p_branch AND e.terminal_id=p_terminal AND e.shift_id=sid AND e.sale_id=identifier AND e.sequence>covered_sequence AND e.sequence>chosen AND
   (e.sequence>previous_sequence OR (previous_pending?identifier::text AND e.sequence>=(previous_pending->>identifier::text)::bigint)) ORDER BY e.sequence LOOP
   IF fin62_history_preparation.snapshot_fact(working) IS DISTINCT FROM fin62_history_preparation.snapshot_fact(step.raw_before) THEN RAISE EXCEPTION 'FIN62_OBSERVATION_OWN_CHAIN_DIVERGED';END IF;
   IF earliest IS NULL THEN earliest:=step.sequence;END IF;working:=step.raw_after;
  END LOOP;
  overrides:=array_append(overrides,jsonb_build_object('id',identifier,'fact',working));
  IF earliest IS NOT NULL THEN pending_entries:=array_append(pending_entries,jsonb_build_object('id',identifier,'sequence',earliest::text));END IF;
 END LOOP;
 -- Aggregate once after all indexed per-sale decisions, rather than repeatedly
 -- copying an expanding JSON object for every pending sale.
 WITH changed AS MATERIALIZED(SELECT item->>'id' id,item->'fact' fact FROM unnest(overrides) item),combined AS(
  SELECT base.key id,base.value fact FROM jsonb_each(source_state) base WHERE NOT EXISTS(SELECT 1 FROM changed WHERE changed.id=base.key)
  UNION ALL SELECT id,fact FROM changed WHERE fact<>'null'::jsonb
 ) SELECT coalesce(jsonb_object_agg(id,fact),'{}') INTO merged FROM combined;
 SELECT coalesce(jsonb_object_agg(item->>'id',item->'sequence'),'{}') INTO pending FROM unnest(pending_entries) item;
 IF octet_length(merged::text)>6*1024*1024 THEN RAISE EXCEPTION 'FIN62_OBSERVATION_LIMIT';END IF;
 SELECT fin62_preparation.validate_financial_math(source.basis||jsonb_build_object('inputs',coalesce(jsonb_agg(value ORDER BY key),'[]'))) INTO calc FROM jsonb_each(merged);
 IF calc->>'status' IS DISTINCT FROM 'computed' THEN RAISE EXCEPTION 'FIN62_OBSERVATION_MATH_UNSUPPORTED';END IF;
 SELECT coalesce(jsonb_agg(value ORDER BY key COLLATE "C"),'[]') INTO merged_array FROM jsonb_each(merged);
 ack:=jsonb_build_object('computedMergedHash',encode(sha256(convert_to(fin62_history_preparation.canonical_json(merged_array),'UTF8')),'hex'),'pendingFromHash',encode(sha256(convert_to(fin62_history_preparation.canonical_json(pending),'UTF8')),'hex'),
  'status','financial_metadata_observed','operationId',op,'payloadHash',digest,'sequence',n::text,'businessUploaded',false,'shiftClosed',false);
 INSERT INTO fin62_history_preparation.nodes(operation_id,organization_id,branch_id,terminal_id,shift_id,sequence,node_kind,payload_json,payload_hash,proof,observed_basis_id,pending_from,acknowledgement)
 VALUES(op,p_org,p_branch,p_terminal,sid,n,'OBSERVATION',p_raw,digest,'{}',source.id,pending,ack);
 INSERT INTO fin62_history_preparation.stream_facts SELECT p_org,p_branch,p_terminal,sid,entry.key::uuid,entry.value FROM jsonb_each(merged) entry WHERE NOT EXISTS(SELECT 1 FROM fin62_history_preparation.stream_facts current_fact WHERE current_fact.organization_id=p_org AND current_fact.branch_id=p_branch AND current_fact.terminal_id=p_terminal AND current_fact.shift_id=sid AND current_fact.sale_id=entry.key::uuid AND current_fact.fact IS NOT DISTINCT FROM entry.value)
 ON CONFLICT(organization_id,branch_id,terminal_id,shift_id,sale_id) DO UPDATE SET fact=EXCLUDED.fact WHERE fin62_history_preparation.stream_facts.fact IS DISTINCT FROM EXCLUDED.fact;
 DELETE FROM fin62_history_preparation.stream_facts f WHERE f.organization_id=p_org AND f.branch_id=p_branch AND f.terminal_id=p_terminal AND f.shift_id=sid AND NOT merged?f.sale_id::text;
 UPDATE fin62_history_preparation.streams SET sequence=n,operation_id=op,payload_hash=digest WHERE organization_id=p_org AND branch_id=p_branch AND terminal_id=p_terminal AND shift_id=sid;
 RETURN ack;
END $fn$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA fin62_history_preparation FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.pos_sync_register_financial_observation(text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pos_sync_register_financial_observation(text,text,text,text) TO service_role;
