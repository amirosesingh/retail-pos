-- STOCK401 DRAFT. Preparation/isolated tests only; no baseline or activation.
-- Worker verifies the dedicated Ed25519 domain first. This service-only routine
-- independently rechecks registry/current grants, exact source deltas and unique
-- effect consumption. It never changes products, sales or permission grants.
BEGIN;
DO $guard$ BEGIN
 IF to_regclass('private.stock_history_effect_coverage') IS NULL OR to_regclass('pos_sync_private.shift_author_keys') IS NULL
  OR to_regprocedure('public.pos_sync_validate_scope(text,text,text)') IS NULL THEN RAISE EXCEPTION 'STOCK_HISTORY_AUTHOR_DEPENDENCY_REQUIRED';END IF;
 IF to_regclass('private.stock_history_claim_receipts') IS NOT NULL OR to_regprocedure('public.pos_stock_history_accept_claims(text,text,text,jsonb)') IS NOT NULL
  THEN RAISE EXCEPTION 'STOCK_HISTORY_AUTHOR_EXISTING_SCHEMA_REVIEW_REQUIRED';END IF;
END $guard$;
CREATE TABLE private.stock_history_claim_receipts(
 movement_id uuid PRIMARY KEY REFERENCES public.stock_history_movements(id),store_id text NOT NULL,terminal_id text NOT NULL,
 key_id uuid NOT NULL REFERENCES pos_sync_private.shift_author_keys(key_id),author_id uuid NOT NULL,
 payload_hash text NOT NULL,payload_json text NOT NULL,author_proof_json text NOT NULL,
 ingested_cursor bigint NOT NULL CHECK(ingested_cursor>0),accepted_at timestamptz NOT NULL,effect_ids uuid[] NOT NULL CHECK(cardinality(effect_ids)>0),
 UNIQUE(store_id,ingested_cursor)
);
ALTER TABLE private.stock_history_claim_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.stock_history_claim_receipts FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER stock_history_claim_receipt_immutable BEFORE UPDATE OR DELETE ON private.stock_history_claim_receipts
 FOR EACH ROW EXECUTE FUNCTION private.stock_history_immutable();

CREATE FUNCTION private.stock_history_action_flag(p_role text,p_slug text,p_permissions jsonb,p_action text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path='' AS $fn$
 SELECT CASE WHEN COALESCE(p_role='admin' OR p_slug='admin',false) THEN true ELSE
  EXISTS(SELECT 1 FROM (VALUES
   ('SALE','can_process_sale',ARRAY['register']),('REFUND','can_process_refund',ARRAY['register']),
   ('RECEIVE','can_receive_purchase_order',ARRAY['purchasing','receiving','suppliers']),
   ('ADJUST','can_adjust_stock',ARRAY['stock']),('PRODUCT_CREATE','can_add_new_product',ARRAY['inventory']),
   ('PRODUCT_MERGE','can_merge_products',ARRAY['inventory']),
   ('TRANSFER_DISPATCH','can_create_transfer',ARRAY['requests','transfers','approvals','verifications']),
   ('TRANSFER_RECEIVE','can_receive_transfer',ARRAY['requests','transfers','approvals','verifications']),
   ('SPONSORSHIP_ISSUE','can_issue_sponsorship',ARRAY['sponsorship'])) allowed(action,flag,pages)
   WHERE allowed.action=p_action AND p_permissions->allowed.flag='true'::jsonb
    AND EXISTS(SELECT 1 FROM unnest(allowed.pages) page WHERE p_permissions->('page:'||page) IS DISTINCT FROM 'false'::jsonb)) END
$fn$;
REVOKE ALL ON FUNCTION private.stock_history_action_flag(text,text,jsonb,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.stock_history_sale_source_origin(p_project text,p_operation uuid,p_author uuid,p_branch text,p_terminal text,p_product uuid,p_effects uuid[])
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE matched integer;
BEGIN
 -- Only immutable accepted FIN62 SALE birth evidence is supported here. A
 -- generic delta receipt, current document, uploader name or version is not
 -- original action/author admission. Other workflows remain held until their
 -- own original source manifests/readbacks are implemented.
 IF to_regclass('fin62_history_preparation.nodes') IS NULL OR to_regclass('fin62_history_preparation.publications') IS NULL
  OR to_regclass('fin62_history_preparation.business_receipts') IS NULL OR to_regclass('fin62_history_preparation.sale_steps') IS NULL
  OR to_regclass('fin62_history_preparation.sale_birth_claims') IS NULL OR to_regprocedure('fin62_history_preparation.row_fact(jsonb)') IS NULL
  THEN RETURN false;END IF;
 EXECUTE $origin$
  SELECT count(DISTINCT effect.id)::integer
  FROM private.stock_history_accepted_effects effect
  JOIN private.stock_history_effect_sources link ON link.effect_id=effect.id
  JOIN private.stock_history_source_receipts source ON source.movement_id=link.movement_id
  JOIN fin62_history_preparation.publications publication ON publication.capture_xid::text::bigint=effect.transaction_id
   AND publication.branch_id=effect.store_id AND publication.terminal_id=$5
  JOIN fin62_history_preparation.business_receipts receipt ON receipt.batch_id=publication.batch_id
   AND ROW(receipt.organization_id,receipt.branch_id,receipt.terminal_id)=ROW(publication.organization_id,publication.branch_id,publication.terminal_id)
  JOIN fin62_history_preparation.nodes node ON node.operation_id=$2 AND node.node_kind='MUTATION' AND node.sequence=publication.stream_sequence
   AND ROW(node.organization_id,node.branch_id,node.terminal_id,node.shift_id)=ROW(publication.organization_id,publication.branch_id,publication.terminal_id,publication.shift_id)
   AND node.proof->>'action'='SALE' AND node.proof->>'authorId'=$3::text AND node.proof->>'projectOrigin'=$1
   AND node.proof->>'branchId'=$4 AND node.proof->>'terminalId'=$5 AND node.proof->>'operationId'=$2::text
   AND node.payload_json::jsonb->>'action'='SALE' AND node.payload_json::jsonb->>'operationId'=$2::text
  JOIN fin62_history_preparation.sale_steps step ON step.operation_id=node.operation_id AND step.sale_id=publication.sale_id
   AND step.action='SALE' AND step.before_fact IS NULL AND step.after_fact=publication.financial_fact
   AND ROW(step.organization_id,step.branch_id,step.terminal_id,step.shift_id,step.sequence)=ROW(node.organization_id,node.branch_id,node.terminal_id,node.shift_id,node.sequence)
  JOIN fin62_history_preparation.sale_birth_claims birth ON birth.sale_id=step.sale_id AND birth.operation_id=node.operation_id
   AND ROW(birth.organization_id,birth.branch_id,birth.terminal_id,birth.shift_id)=ROW(node.organization_id,node.branch_id,node.terminal_id,node.shift_id)
  CROSS JOIN LATERAL jsonb_array_elements(receipt.operations) activity_part
  CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN activity_part->>'table'='item_activity_logs' THEN activity_part->'rows' ELSE '[]'::jsonb END) activity
  CROSS JOIN LATERAL jsonb_array_elements(receipt.operations) item_part
  CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN item_part->>'table'='sale_items' THEN item_part->'rows' ELSE '[]'::jsonb END) item
  CROSS JOIN LATERAL jsonb_array_elements(receipt.operations) sale_part
  CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN sale_part->>'table'='sales' THEN sale_part->'rows' ELSE '[]'::jsonb END) sale
  WHERE effect.id=ANY($7) AND effect.product_id=$6 AND effect.store_id=$4
   AND source.transaction_id=effect.transaction_id AND source.product_id=effect.product_id AND source.store_id=effect.store_id
   AND source.quantity_delta=effect.quantity_delta AND activity->>'id'=source.movement_id::text
   AND activity->>'product_id'=effect.product_id::text AND activity->>'store_id'=effect.store_id
   AND activity->>'quantity_delta'~'^-?(0|[1-9][0-9]*)$' AND (activity->>'quantity_delta')::numeric=effect.quantity_delta
   AND sale->>'id'=publication.sale_id::text AND sale->>'store_id'=$4 AND activity->>'reference'=sale->>'bill_number'
   AND fin62_history_preparation.row_fact(sale)=publication.financial_fact
   AND item->>'sale_id'=publication.sale_id::text AND item->>'product_id'=effect.product_id::text
   AND item->>'quantity'~'^-?(0|[1-9][0-9]*)$' AND -(item->>'quantity')::numeric=source.quantity_delta
   AND activity->>'activity_type'=CASE WHEN item->'is_return'='true'::jsonb THEN 'return' ELSE 'sale' END
   AND left(activity->>'id',24)=left(item->>'id',24) AND substring(activity->>'id',25,1)='3' AND substring(item->>'id',25,1)='1'
   AND right(activity->>'id',11)=right(item->>'id',11)
   AND left(activity->>'id',24)=substring(publication.sale_id::text,1,14)||'4'||substring(publication.sale_id::text,16,4)||'a'||substring(publication.sale_id::text,21,4)
   AND EXISTS(SELECT 1 FROM jsonb_array_elements(node.payload_json::jsonb->'changes') change WHERE change->>'saleId'=publication.sale_id::text)
 $origin$ INTO matched USING p_project,p_operation,p_author,p_branch,p_terminal,p_product,p_effects;
 RETURN matched=cardinality(p_effects) AND matched>0;
END $fn$;
REVOKE ALL ON FUNCTION private.stock_history_sale_source_origin(text,uuid,uuid,text,text,uuid,uuid[]) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.pos_stock_history_accept_claims(p_project text,p_branch text,p_terminal text,p_rows jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE submitted jsonb;raw text;proof_raw text;payload jsonb;proof jsonb;hash text;sid uuid;operation uuid;product uuid;author uuid;
 registered pos_sync_private.shift_author_keys%ROWTYPE;person public.app_users%ROWTYPE;prior private.stock_history_claim_receipts%ROWTYPE;
 matched jsonb;effects uuid[];effect uuid;position bigint;accepted timestamptz;receipts jsonb:='[]'::jsonb;kind text;branch_scope text;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SYNC_FORBIDDEN';END IF;
 IF p_project IS NULL OR p_branch IS NULL OR p_terminal IS NULL OR jsonb_typeof(p_rows) IS DISTINCT FROM 'array'
  THEN RAISE EXCEPTION 'STOCK_HISTORY_INVALID_BATCH';END IF;
 IF jsonb_array_length(p_rows) NOT BETWEEN 1 AND 8 OR octet_length(convert_to(p_rows::text,'UTF8'))>126976
  THEN RAISE EXCEPTION 'STOCK_HISTORY_OVERSIZED';END IF;
 PERFORM public.pos_sync_validate_scope('default',p_branch,p_terminal);
 IF NOT EXISTS(SELECT 1 FROM public.terminal_tokens WHERE id::text=p_terminal AND location_id=p_branch AND platform='pc'
  AND status IN('active','used') AND revoked_at IS NULL AND (is_claimed OR claimed_at IS NOT NULL))
  THEN RAISE EXCEPTION 'SYNC_TERMINAL_SCOPE_FORBIDDEN';END IF;
 -- Claim admission takes no business product lock. Existing business capture
 -- appends evidence without touching this report head or acquiring this lock.
 PERFORM pg_advisory_xact_lock(hashtextextended('stock-history-claims:'||p_branch,0));
 FOR submitted IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
  raw:=submitted->>'payloadJson';proof_raw:=submitted->>'authorProofJson';
  IF raw IS NULL OR proof_raw IS NULL OR octet_length(convert_to(raw,'UTF8'))>126976 OR octet_length(convert_to(proof_raw,'UTF8'))>16384
   THEN RAISE EXCEPTION 'STOCK_HISTORY_AUTHOR_REQUIRED';END IF;
  payload:=raw::jsonb;proof:=proof_raw::jsonb;
  IF jsonb_typeof(payload) IS DISTINCT FROM 'array' OR jsonb_array_length(payload)<>18 OR payload->>0<>'1'
   OR jsonb_typeof(payload->8) IS DISTINCT FROM 'string' OR payload->>8!~'^-?(0|[1-9][0-9]{0,37})$' OR (payload->>8)::numeric=0
   OR jsonb_typeof(payload->17) IS DISTINCT FROM 'string' OR payload->>17!~'^-?(0|[1-9][0-9]{0,37})$'
   OR ((payload->>17)::numeric<>0 AND (payload->>17)::numeric<>(payload->>8)::numeric)
   OR payload->>15 IS DISTINCT FROM 'unverified' THEN RAISE EXCEPTION 'STOCK_HISTORY_INVALID_CLAIM';END IF;
  sid:=(payload->>1)::uuid;operation:=(payload->>2)::uuid;product:=(payload->>3)::uuid;author:=(payload->>6)::uuid;
  hash:=encode(sha256(convert_to(raw,'UTF8')),'hex');
  kind:=CASE proof->>'action' WHEN 'SALE' THEN 'sale' WHEN 'REFUND' THEN 'refund' WHEN 'RECEIVE' THEN 'receiving' WHEN 'ADJUST' THEN 'stock'
   WHEN 'PRODUCT_CREATE' THEN 'product' WHEN 'PRODUCT_MERGE' THEN 'product' WHEN 'TRANSFER_DISPATCH' THEN 'transfer' WHEN 'TRANSFER_RECEIVE' THEN 'transfer'
   WHEN 'SPONSORSHIP_ISSUE' THEN 'sponsorship' WHEN 'MISSED_BILL' THEN 'missed_bill' ELSE NULL END;
  IF kind IS NULL OR payload->>7 IS DISTINCT FROM kind OR payload->>4 IS DISTINCT FROM p_branch OR payload->>5 IS DISTINCT FROM p_terminal
   OR submitted->>'id' IS DISTINCT FROM sid::text OR submitted->>'payloadHash' IS DISTINCT FROM hash
   OR proof->>'version' IS DISTINCT FROM '1' OR proof->>'algorithm' IS DISTINCT FROM 'Ed25519'
   OR proof->>'projectOrigin' IS DISTINCT FROM p_project OR proof->>'terminalId' IS DISTINCT FROM p_terminal OR proof->>'branchId' IS DISTINCT FROM p_branch
   OR proof->>'authorId' IS DISTINCT FROM author::text OR proof->>'operationId' IS DISTINCT FROM operation::text OR proof->>'movementId' IS DISTINCT FROM sid::text
   OR proof->>'payloadHash' IS DISTINCT FROM hash THEN RAISE EXCEPTION 'STOCK_HISTORY_AUTHOR_INVALID';END IF;
  IF private.stock_history_ticks(payload->>9)>(private.stock_history_ticks(payload->>11)) OR (payload->>10)::numeric<>private.stock_history_ticks(payload->>9)
   THEN RAISE EXCEPTION 'STOCK_HISTORY_INVALID_INSTANT';END IF;
  SELECT * INTO registered FROM pos_sync_private.shift_author_keys WHERE key_id=(proof->>'keyId')::uuid AND author_id=author
   AND terminal_id=p_terminal AND project_origin=p_project AND subject=proof->>'subject' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'STOCK_HISTORY_AUTHOR_INVALID';END IF;
  SELECT * INTO prior FROM private.stock_history_claim_receipts WHERE movement_id=sid;
  IF FOUND THEN
   IF ROW(prior.store_id,prior.terminal_id,prior.key_id,prior.author_id,prior.payload_hash) IS DISTINCT FROM ROW(p_branch,p_terminal,registered.key_id,author,hash)
    OR convert_to(prior.payload_json,'UTF8') IS DISTINCT FROM convert_to(raw,'UTF8') OR convert_to(prior.author_proof_json,'UTF8') IS DISTINCT FROM convert_to(proof_raw,'UTF8')
    THEN RAISE EXCEPTION 'STOCK_HISTORY_REPLAY_CONFLICT';END IF;
  ELSE
   IF submitted->'authorState'->'allowed' IS DISTINCT FROM 'true'::jsonb OR registered.revoked_at IS NOT NULL
    THEN RAISE EXCEPTION 'STOCK_HISTORY_AUTHOR_PERMISSION_REVOKED';END IF;
   SELECT * INTO person FROM public.app_users WHERE id=author FOR SHARE;
   branch_scope:=CASE WHEN person.store_id~*'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' THEN lower(person.store_id) ELSE person.store_id END;
   IF NOT FOUND OR person.is_active IS DISTINCT FROM true OR person.user_id IS DISTINCT FROM registered.subject
    OR (person.store_id IS NOT NULL AND branch_scope IS DISTINCT FROM p_branch)
    OR NOT private.stock_history_action_flag(person.role::text,person.role_slug,person.permissions,proof->>'action')
    THEN RAISE EXCEPTION 'STOCK_HISTORY_AUTHOR_PERMISSION_REVOKED';END IF;
   matched:=private.stock_history_match_effect_candidates(product,p_branch,(payload->>8)::numeric,payload->16);
   SELECT array_agg(value::uuid ORDER BY value::uuid) INTO effects FROM jsonb_array_elements_text(matched->'effectIds');
   IF cardinality(effects) IS NULL OR EXISTS(SELECT 1 FROM private.stock_history_effect_coverage WHERE effect_id=ANY(effects))
    THEN RAISE EXCEPTION 'STOCK_HISTORY_EFFECT_ALREADY_CONSUMED';END IF;
   IF proof->>'action'<>'SALE' OR NOT private.stock_history_sale_source_origin(p_project,operation,author,p_branch,p_terminal,product,effects)
    THEN RAISE EXCEPTION 'STOCK_HISTORY_SOURCE_ORIGIN_UNPROVEN';END IF;
   INSERT INTO public.stock_history_heads(store_id) VALUES(p_branch) ON CONFLICT(store_id) DO NOTHING;
   UPDATE public.stock_history_heads SET committed_cursor=committed_cursor+1,coverage_generation=coverage_generation+1,
    coverage_state='incomplete',updated_at=clock_timestamp() WHERE store_id=p_branch RETURNING committed_cursor INTO position;
   accepted:=clock_timestamp();
   INSERT INTO public.stock_history_movements(id,operation_id,product_id,store_id,terminal_id,actor_id,source_kind,quantity_delta,effective_at_raw,effective_ticks,
    recorded_at_raw,recorded_ticks,product_name,sku,barcode,clock_state,payload_hash,payload_json,ingested_cursor,ingested_at)
   VALUES(sid,operation,product,p_branch,p_terminal,author::text,kind,(payload->>8)::numeric,payload->>9,private.stock_history_ticks(payload->>9),
    payload->>11,private.stock_history_ticks(payload->>11),payload->>12,payload->>13,payload->>14,'unverified',hash,raw,position,accepted);
   FOREACH effect IN ARRAY effects LOOP INSERT INTO private.stock_history_effect_coverage(effect_id,movement_id) VALUES(effect,sid);END LOOP;
   INSERT INTO private.stock_history_claim_receipts VALUES(sid,p_branch,p_terminal,registered.key_id,author,hash,raw,proof_raw,position,accepted,effects) RETURNING * INTO prior;
  END IF;
  receipts:=receipts||jsonb_build_array(jsonb_build_object('id',sid,'payloadHash',prior.payload_hash,'ingestedCursor',prior.ingested_cursor::text,
   'acceptedAt',to_char(prior.accepted_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US')||'0Z','effectIds',to_jsonb(prior.effect_ids)));
 END LOOP;
 RETURN jsonb_build_object('ok',true,'version',1,'branchId',p_branch,'terminalId',p_terminal,'receipts',receipts);
END $fn$;
REVOKE ALL ON FUNCTION public.pos_stock_history_accept_claims(text,text,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.pos_stock_history_accept_claims(text,text,text,jsonb) TO service_role;
COMMIT;
