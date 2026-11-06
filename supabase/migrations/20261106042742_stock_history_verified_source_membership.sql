-- STOCK401 DRAFT preparation only; no activation or exact-project application.
-- Verified membership alone is not an accepted stock effect or true clock.
BEGIN;
DO $guard$ BEGIN
 IF to_regclass('private.stock_history_original_sources') IS NULL
  OR to_regprocedure('public.pos_stock_history_accept_claims(text,text,text,jsonb)') IS NULL
  THEN RAISE EXCEPTION 'STOCK_HISTORY_SOURCE_DEPENDENCY_REQUIRED';END IF;
 IF to_regclass('private.stock_history_source_claim_verifications') IS NOT NULL
  THEN RAISE EXCEPTION 'STOCK_HISTORY_SOURCE_EXISTING_SCHEMA_REVIEW_REQUIRED';END IF;
END $guard$;
CREATE TABLE private.stock_history_source_claim_verifications(
 movement_id uuid PRIMARY KEY REFERENCES public.stock_history_movements(id),
 business_batch_id uuid NOT NULL REFERENCES private.stock_history_original_sources(batch_id),
 project_origin text NOT NULL,store_id text NOT NULL,terminal_id text NOT NULL,operation_id uuid NOT NULL,
 database_guid uuid NOT NULL,source_sequence bigint NOT NULL,source_root text NOT NULL,
 member_index integer NOT NULL,source_count integer NOT NULL,author_id uuid NOT NULL,key_id uuid NOT NULL,
 manifest_json text NOT NULL,envelope_json text NOT NULL,verified_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 time_grade text NOT NULL DEFAULT 'author_claimed' CHECK(time_grade='author_claimed'),
 CHECK(source_count BETWEEN 1 AND 2000 AND member_index>=0 AND member_index<source_count AND source_sequence>0),
 CHECK(source_root~'^[0-9a-f]{64}$' AND octet_length(convert_to(manifest_json,'UTF8'))<=16384 AND octet_length(convert_to(envelope_json,'UTF8'))<=65536),
 UNIQUE(project_origin,store_id,terminal_id,database_guid,source_sequence,member_index)
);
ALTER TABLE private.stock_history_source_claim_verifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.stock_history_source_claim_verifications FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER stock_history_source_claim_verifications_immutable BEFORE UPDATE OR DELETE ON private.stock_history_source_claim_verifications
 FOR EACH ROW EXECUTE FUNCTION private.stock_history_immutable();

CREATE FUNCTION private.stock_history_original_member_effects(p_project text,p_branch text,p_terminal text,p_submitted jsonb,p_event jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE state jsonb:=p_submitted->'sourceState';payload jsonb:=(p_submitted->>'payloadJson')::jsonb;
 envelope jsonb;header jsonb;manifest jsonb;raw text;witness private.stock_history_original_sources%ROWTYPE;
 ref jsonb;part jsonb;source_row jsonb;document jsonb;effect private.stock_history_accepted_effects%ROWTYPE;
 effects uuid[]:=ARRAY[]::uuid[];ids uuid[];total numeric:=0;groups jsonb:='{}'::jsonb;expected numeric:=(payload->>8)::numeric;
 branch text:=payload->>4;product uuid:=(payload->>3)::uuid;action text:=p_event->>'action';docid text;reference text;source_table text;
BEGIN
 IF state->'verified' IS DISTINCT FROM 'true'::jsonb OR state->>'timeGrade' IS DISTINCT FROM 'author_claimed'
  THEN RAISE EXCEPTION 'STOCK_HISTORY_SOURCE_ORIGIN_UNPROVEN';END IF;
 envelope:=(p_submitted->>'sourceCohortJson')::jsonb;raw:=envelope->>'proofJson';header:=raw::jsonb;manifest:=(state->>'manifestJson')::jsonb;
 IF convert_to(envelope->'member'->>'manifestJson','UTF8') IS DISTINCT FROM convert_to(state->>'manifestJson','UTF8')
  OR state->>'sourceBatchId' IS DISTINCT FROM envelope->>'sourceBatchId' OR state->>'memberIndex' IS DISTINCT FROM envelope->'member'->>'index'
  OR envelope->'member'->>'root' IS DISTINCT FROM header->>'sourceRoot' OR envelope->'member'->>'count' IS DISTINCT FROM header->>'sourceCount'
  OR (state->>'memberIndex')::integer NOT BETWEEN 0 AND (header->>'sourceCount')::integer-1
  OR ROW(header->>'projectOrigin',header->>'branchId',header->>'terminalId',header->>'operationId',header->>'authorId',header->>'keyId',header->>'subject',header->>'action')
   IS DISTINCT FROM ROW(p_project,p_branch,p_terminal,payload->>2,payload->>6,p_event->>'keyId',p_event->>'subject',action)
  OR ROW(manifest->>'operationId',manifest->>'authorId',manifest->>'terminalId',manifest->>'branchId',manifest->>'productId',manifest->>'delta',manifest->>'effectiveAt',manifest->>'recordedAt',manifest->>'action')
   IS DISTINCT FROM ROW(payload->>2,payload->>6,p_terminal,p_branch,payload->>3,payload->>8,payload->>9,payload->>11,action)
  OR manifest->'sourceRefs' IS DISTINCT FROM payload->16 THEN RAISE EXCEPTION 'STOCK_HISTORY_SOURCE_ORIGIN_UNPROVEN';END IF;
 SELECT * INTO witness FROM private.stock_history_original_sources WHERE batch_id=(state->>'sourceBatchId')::uuid
  AND project_origin=p_project AND store_id=p_branch AND terminal_id=p_terminal
  AND headers @> jsonb_build_array(jsonb_build_object('proofJson',raw));
 IF NOT FOUND THEN RAISE EXCEPTION 'STOCK_HISTORY_SOURCE_ORIGIN_UNPROVEN';END IF;
 docid:=manifest->'document'->>'id';
 IF action='ADJUST' AND manifest->'document'->>'type'='stock_adjustments' THEN
  SELECT r INTO document FROM jsonb_array_elements(COALESCE(witness.accepted_sources->'stock_adjustments','[]'::jsonb)) r
   WHERE r->>'id'=docid AND r->>'product_id'=product::text AND r->>'store_id'=p_branch
    AND r->>'delta'~'^-?(0|[1-9][0-9]*)$' AND (r->>'delta')::numeric=expected;
  IF document IS NULL OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(manifest->'sourceRefs') r WHERE r->>0='stock_adjustments' AND r->>1=docid)
   THEN RAISE EXCEPTION 'STOCK_HISTORY_SOURCE_ORIGIN_UNPROVEN';END IF;
 ELSIF action='RECEIVE' AND manifest->'document'->>'type'='receivings' THEN
  SELECT r INTO document FROM jsonb_array_elements(COALESCE(witness.accepted_sources->'purchase_orders','[]'::jsonb)) r
   WHERE r->>'id'=docid AND r->>'store_id'=p_branch AND r->>'status'='posted';
  reference:=COALESCE(NULLIF(btrim(document->>'reference'),''),document->>'po_number');
  IF document IS NULL OR NULLIF(reference,'') IS NULL THEN RAISE EXCEPTION 'STOCK_HISTORY_SOURCE_ORIGIN_UNPROVEN';END IF;
 ELSIF action='PRODUCT_CREATE' AND manifest->'document'->>'type'='products' AND docid=product::text THEN
  IF manifest->'sourceRefs'<>'[]'::jsonb OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(witness.accepted_sources->'products','[]'::jsonb)) r
    WHERE r->>'id'=docid) THEN RAISE EXCEPTION 'STOCK_HISTORY_SOURCE_ORIGIN_UNPROVEN';END IF;
  SELECT array_agg(id ORDER BY id) INTO ids FROM private.stock_history_accepted_effects WHERE id=ANY(witness.effect_ids)
   AND transaction_id=witness.capture_xid AND product_id=product AND store_id=p_branch AND operation='INSERT' AND previous_quantity=0 AND quantity_delta=expected;
  IF cardinality(ids) IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'STOCK_HISTORY_SOURCE_ORIGIN_UNPROVEN';END IF;
  RETURN jsonb_build_object('effectIds',to_jsonb(ids),'quantity',expected::text);
 ELSE RAISE EXCEPTION 'STOCK_HISTORY_SOURCE_ORIGIN_UNPROVEN';END IF;
 IF jsonb_typeof(manifest->'sourceRefs') IS DISTINCT FROM 'array' OR jsonb_array_length(manifest->'sourceRefs') NOT BETWEEN 1 AND 2000
  THEN RAISE EXCEPTION 'STOCK_HISTORY_SOURCE_ORIGIN_UNPROVEN';END IF;
 FOR ref IN SELECT value FROM jsonb_array_elements(manifest->'sourceRefs') LOOP
  source_table:=ref->>0;
  IF jsonb_array_length(ref)<>3 OR ref->>2!~'^-?(0|[1-9][0-9]{0,37})$' THEN RAISE EXCEPTION 'STOCK_HISTORY_SOURCE_ORIGIN_UNPROVEN';END IF;
  SELECT r INTO source_row FROM jsonb_array_elements(COALESCE(witness.accepted_sources->source_table,'[]'::jsonb)) r
   WHERE (CASE WHEN source_table='stock_delta_applied' THEN r->>'movement_id' ELSE r->>'id' END)=ref->>1
    AND r->>'product_id'=product::text AND r->>'store_id'=p_branch
    AND (CASE WHEN source_table='item_activity_logs' THEN r->>'quantity_delta' ELSE r->>'delta' END)=ref->>2;
  IF source_row IS NULL THEN RAISE EXCEPTION 'STOCK_HISTORY_SOURCE_ORIGIN_UNPROVEN';END IF;
  IF action='RECEIVE' AND (source_table<>'item_activity_logs' OR source_row->>'activity_type'<>'receive' OR source_row->>'reference' IS DISTINCT FROM reference)
   THEN RAISE EXCEPTION 'STOCK_HISTORY_SOURCE_ORIGIN_UNPROVEN';END IF;
  groups:=jsonb_set(groups,ARRAY[source_table],to_jsonb(COALESCE((groups->>source_table)::numeric,0)+(ref->>2)::numeric));
  IF source_table IN('item_activity_logs','stock_delta_applied') THEN
   SELECT e.* INTO effect FROM private.stock_history_accepted_effects e JOIN private.stock_history_effect_sources link ON link.effect_id=e.id
    JOIN private.stock_history_source_receipts receipt ON receipt.movement_id=link.movement_id
    WHERE e.id=ANY(witness.effect_ids) AND e.transaction_id=witness.capture_xid AND receipt.transaction_id=witness.capture_xid
     AND receipt.movement_id=(ref->>1)::uuid AND receipt.product_id=product AND receipt.store_id=p_branch AND receipt.quantity_delta=(ref->>2)::numeric
     AND e.product_id=product AND e.store_id=p_branch AND e.quantity_delta=receipt.quantity_delta;
   IF NOT FOUND THEN RAISE EXCEPTION 'STOCK_HISTORY_SOURCE_ORIGIN_UNPROVEN';END IF;
   IF NOT effect.id=ANY(effects) THEN effects:=array_append(effects,effect.id);total:=total+effect.quantity_delta;END IF;
  ELSIF source_table<>'stock_adjustments' OR action<>'ADJUST' THEN RAISE EXCEPTION 'STOCK_HISTORY_SOURCE_ORIGIN_UNPROVEN';END IF;
 END LOOP;
 IF cardinality(effects)=0 AND action='ADJUST' THEN
  SELECT array_agg(id ORDER BY id) INTO ids FROM private.stock_history_accepted_effects WHERE id=ANY(witness.effect_ids)
   AND transaction_id=witness.capture_xid AND product_id=product AND store_id=p_branch AND quantity_delta=expected
   AND document->>'previous_stock'~'^-?(0|[1-9][0-9]*)$' AND document->>'updated_stock'~'^-?(0|[1-9][0-9]*)$'
   AND previous_quantity=(document->>'previous_stock')::numeric AND next_quantity=(document->>'updated_stock')::numeric;
  IF cardinality(ids) IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'STOCK_HISTORY_SOURCE_ORIGIN_UNPROVEN';END IF;
  effects:=ids;total:=expected;
 END IF;
 IF cardinality(effects)=0 OR total<>expected OR EXISTS(SELECT 1 FROM jsonb_each_text(groups) g WHERE g.value::numeric<>expected)
  THEN RAISE EXCEPTION 'STOCK_HISTORY_SOURCE_ORIGIN_UNPROVEN';END IF;
 RETURN jsonb_build_object('effectIds',to_jsonb(ARRAY(SELECT id FROM unnest(effects) id ORDER BY id)),'quantity',total::text);
END $fn$;
REVOKE ALL ON FUNCTION private.stock_history_original_member_effects(text,text,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.stock_history_record_source_verification(p_submitted jsonb,p_project text,p_branch text,p_terminal text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE envelope jsonb:=(p_submitted->>'sourceCohortJson')::jsonb;proof jsonb:=(envelope->>'proofJson')::jsonb;
BEGIN
 INSERT INTO private.stock_history_source_claim_verifications(movement_id,business_batch_id,project_origin,store_id,terminal_id,operation_id,database_guid,
  source_sequence,source_root,member_index,source_count,author_id,key_id,manifest_json,envelope_json)
 VALUES((p_submitted->>'id')::uuid,(envelope->>'sourceBatchId')::uuid,p_project,p_branch,p_terminal,(proof->>'operationId')::uuid,(proof->>'sourceDatabaseId')::uuid,
  (proof->>'sourceSequence')::bigint,proof->>'sourceRoot',(envelope->'member'->>'index')::integer,(proof->>'sourceCount')::integer,
  (proof->>'authorId')::uuid,(proof->>'keyId')::uuid,envelope->'member'->>'manifestJson',p_submitted->>'sourceCohortJson');
END $fn$;
REVOKE ALL ON FUNCTION private.stock_history_record_source_verification(jsonb,text,text,text) FROM PUBLIC,anon,authenticated,service_role;

DO $upgrade$
DECLARE before pg_proc%ROWTYPE;after pg_proc%ROWTYPE;body text;definition text;
 a text:=$a$   matched:=private.stock_history_match_effect_candidates(product,p_branch,(payload->>8)::numeric,payload->16);$a$;
 b text:=$b$   IF proof->>'action'='SALE' THEN
    matched:=private.stock_history_match_effect_candidates(product,p_branch,(payload->>8)::numeric,payload->16);
   ELSE matched:=private.stock_history_original_member_effects(p_project,p_branch,p_terminal,submitted,proof);END IF;$b$;
 c text:=$c$   IF proof->>'action'<>'SALE' OR NOT private.stock_history_sale_source_origin(p_project,operation,author,p_branch,p_terminal,product,effects)$c$;
 d text:=$d$   IF proof->>'action'='SALE' AND NOT private.stock_history_sale_source_origin(p_project,operation,author,p_branch,p_terminal,product,effects)$d$;
 e text:=$e$   INSERT INTO private.stock_history_claim_receipts VALUES(sid,p_branch,p_terminal,registered.key_id,author,hash,raw,proof_raw,position,accepted,effects) RETURNING * INTO prior;$e$;
 f text:=$f$   INSERT INTO private.stock_history_claim_receipts VALUES(sid,p_branch,p_terminal,registered.key_id,author,hash,raw,proof_raw,position,accepted,effects) RETURNING * INTO prior;
   IF proof->>'action'<>'SALE' THEN PERFORM private.stock_history_record_source_verification(submitted,p_project,p_branch,p_terminal);END IF;$f$;
 g text:=$g$  IF FOUND THEN
   IF ROW(prior.store_id,prior.terminal_id,prior.key_id,prior.author_id,prior.payload_hash)$g$;
 h text:=$h$  IF FOUND THEN
   IF proof->>'action'<>'SALE' AND NOT EXISTS(SELECT 1 FROM private.stock_history_source_claim_verifications v WHERE v.movement_id=sid
    AND convert_to(v.envelope_json,'UTF8')=convert_to(submitted->>'sourceCohortJson','UTF8')) THEN RAISE EXCEPTION 'STOCK_HISTORY_REPLAY_CONFLICT';END IF;
   IF ROW(prior.store_id,prior.terminal_id,prior.key_id,prior.author_id,prior.payload_hash)$h$;
BEGIN
 SELECT * INTO before FROM pg_proc WHERE oid='public.pos_stock_history_accept_claims(text,text,text,jsonb)'::regprocedure;
 body:=replace(before.prosrc,E'\r\n',E'\n');
 IF md5(body)<>'45ecf1d144d6af868ee21fe34a973c71' OR NOT before.prosecdef OR before.provolatile<>'v' OR before.prokind<>'f'
  OR before.proisstrict OR before.proleakproof OR before.proparallel<>'u' OR before.prorettype<>'jsonb'::regtype
  OR before.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
  OR NOT has_function_privilege('service_role',before.oid,'EXECUTE')
  OR EXISTS(SELECT 1 FROM aclexplode(COALESCE(before.proacl,acldefault('f',before.proowner))) permission
    WHERE permission.grantee NOT IN(before.proowner,(SELECT oid FROM pg_roles WHERE rolname='service_role')) OR permission.privilege_type<>'EXECUTE')
  OR before.proargnames IS DISTINCT FROM ARRAY['p_project','p_branch','p_terminal','p_rows']::text[]
  THEN RAISE EXCEPTION 'STOCK_HISTORY_SOURCE_UNKNOWN_CLAIM_ROUTINE';END IF;
 IF length(body)-length(replace(body,a,''))<>length(a) OR length(body)-length(replace(body,c,''))<>length(c)
  OR length(body)-length(replace(body,e,''))<>length(e) OR length(body)-length(replace(body,g,''))<>length(g)
  THEN RAISE EXCEPTION 'STOCK_HISTORY_SOURCE_UNKNOWN_CLAIM_ROUTINE';END IF;
 body:=replace(replace(replace(replace(body,a,b),c,d),e,f),g,h);
 definition:=replace(pg_get_functiondef(before.oid),before.prosrc,body);EXECUTE definition;
 SELECT * INTO after FROM pg_proc WHERE oid=before.oid;
 IF after.prosrc IS DISTINCT FROM body OR ROW(after.proowner,after.proacl,after.proconfig,after.prosecdef,after.provolatile,after.proisstrict,after.proleakproof,after.proparallel)
  IS DISTINCT FROM ROW(before.proowner,before.proacl,before.proconfig,before.prosecdef,before.provolatile,before.proisstrict,before.proleakproof,before.proparallel)
  THEN RAISE EXCEPTION 'STOCK_HISTORY_SOURCE_ROUTINE_METADATA_CHANGED';END IF;
END $upgrade$;
COMMIT;
