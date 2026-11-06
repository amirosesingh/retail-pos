-- STOCK401 DRAFT preparation only. Exact-project approval is still required.
-- Accepted business evidence is not verified authorship, time or report coverage.
BEGIN;
DO $guard$ BEGIN
 IF to_regclass('private.stock_history_accepted_effects') IS NULL
  OR to_regprocedure('public.pos_sync_push_aggregate(uuid,text,text,text,jsonb)') IS NULL
  THEN RAISE EXCEPTION 'STOCK_HISTORY_SOURCE_DEPENDENCY_REQUIRED';END IF;
 IF to_regclass('private.stock_history_original_sources') IS NOT NULL
  OR to_regprocedure('public.pos_sync_push_stock_source_aggregate(uuid,text,text,text,jsonb,text,jsonb)') IS NOT NULL
  THEN RAISE EXCEPTION 'STOCK_HISTORY_SOURCE_EXISTING_SCHEMA_REVIEW_REQUIRED';END IF;
END $guard$;

CREATE TABLE private.stock_history_original_sources(
 batch_id uuid PRIMARY KEY,project_origin text NOT NULL,store_id text NOT NULL,terminal_id text NOT NULL,
 headers jsonb NOT NULL CHECK(jsonb_typeof(headers)='array' AND jsonb_array_length(headers) BETWEEN 1 AND 8
  AND octet_length(convert_to(headers::text,'UTF8'))<=65536),headers_hash text NOT NULL,
 operations jsonb NOT NULL CHECK(jsonb_typeof(operations)='array' AND octet_length(convert_to(operations::text,'UTF8'))<=6291456),
 accepted_sources jsonb NOT NULL CHECK(jsonb_typeof(accepted_sources)='object' AND octet_length(convert_to(accepted_sources::text,'UTF8'))<=6291456),
 operations_hash text NOT NULL,capture_xid bigint NOT NULL,effect_ids uuid[] NOT NULL CHECK(cardinality(effect_ids)>0),
 accepted_at timestamptz NOT NULL,verification_state text NOT NULL DEFAULT 'unverified' CHECK(verification_state='unverified'),
 CHECK(headers_hash=encode(sha256(convert_to(headers::text,'UTF8')),'hex')),CHECK(operations_hash=md5(operations::text))
);
ALTER TABLE private.stock_history_original_sources ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.stock_history_original_sources FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER stock_history_original_sources_immutable BEFORE UPDATE OR DELETE ON private.stock_history_original_sources
 FOR EACH ROW EXECUTE FUNCTION private.stock_history_immutable();

CREATE FUNCTION private.stock_history_original_source_snapshot(p_operations jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE name text;fields text[];ids uuid[];key_name text;projection text;rows jsonb;result jsonb:='{}'::jsonb;
BEGIN
 -- Fixed source whitelist, one bounded ID query per table. Do not copy payment,
 -- customer, credential or unrelated catalogue columns into this private proof.
 FOR name IN SELECT DISTINCT o->>'table' FROM jsonb_array_elements(p_operations) o
  WHERE o->>'table' IN('products','item_activity_logs','stock_adjustments','stock_delta_applied','purchase_orders','stock_transfers','sponsorships','missed_bill_entries') ORDER BY 1 LOOP
  key_name:=CASE WHEN name='stock_delta_applied' THEN 'movement_id' ELSE 'id' END;
  SELECT array_agg(DISTINCT (r->>key_name)::uuid ORDER BY (r->>key_name)::uuid) INTO ids
   FROM jsonb_array_elements(p_operations) o CROSS JOIN LATERAL jsonb_array_elements(o->'rows') r WHERE o->>'table'=name;
  IF cardinality(ids) IS NULL THEN CONTINUE;END IF;
  IF cardinality(ids)>2000 OR to_regclass(format('public.%I',name)) IS NULL THEN RAISE EXCEPTION 'STOCK_HISTORY_SOURCE_READBACK_UNAVAILABLE';END IF;
  fields:=CASE name WHEN 'products' THEN ARRAY['id','owner_store_id']
   WHEN 'item_activity_logs' THEN ARRAY['id','product_id','store_id','quantity_delta','activity_type','reference','transfer_id','sale_id','item_id']
   WHEN 'stock_adjustments' THEN ARRAY['id','product_id','store_id','delta','previous_stock','updated_stock','reason','terminal_id']
   WHEN 'stock_delta_applied' THEN ARRAY['movement_id','product_id','store_id','delta']
   WHEN 'purchase_orders' THEN ARRAY['id','store_id','status','reference','po_number']
   WHEN 'stock_transfers' THEN ARRAY['id','from_store_id','to_store_id','status','transfer_number','dispatched_at','received_at']
   WHEN 'sponsorships' THEN ARRAY['id','store_id','status','reference']
   WHEN 'missed_bill_entries' THEN ARRAY['id','sale_id','store_id'] END;
  SELECT string_agg(format('%L,to_jsonb(s)->%L',field,field),',') INTO projection FROM unnest(fields) field;
  EXECUTE format('SELECT COALESCE(jsonb_agg(jsonb_build_object(%s) ORDER BY s.%I),''[]''::jsonb) FROM public.%I s WHERE s.%I=ANY($1)',
   projection,key_name,name,key_name) INTO rows USING ids;
  result:=jsonb_set(result,ARRAY[name],rows);
 END LOOP;
 IF octet_length(convert_to(result::text,'UTF8'))>6291456 THEN RAISE EXCEPTION 'STOCK_HISTORY_SOURCE_READBACK_OVERSIZED';END IF;
 RETURN result;
END $fn$;
REVOKE ALL ON FUNCTION private.stock_history_original_source_snapshot(jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.stock_history_original_source_receipts(p_source private.stock_history_original_sources) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path='' AS $fn$
 SELECT COALESCE(jsonb_agg(jsonb_build_object('proofHash',encode(sha256(convert_to(h->>'proofJson','UTF8')),'hex'),
  'batchId',p_source.batch_id,'transactionId',p_source.capture_xid::text,'state','unverified',
  'acceptedAt',to_char(p_source.accepted_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US')||'0Z')),'[]'::jsonb)
 FROM jsonb_array_elements(p_source.headers) h
$fn$;
REVOKE ALL ON FUNCTION private.stock_history_original_source_receipts(private.stock_history_original_sources) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.pos_sync_push_stock_source_aggregate(p_batch_id uuid,p_organization_id text,p_branch_id text,p_terminal_id text,
 p_operations jsonb,p_project text,p_cohorts jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE business jsonb;old_business boolean;candidate jsonb;headers jsonb:='[]'::jsonb;
 prior private.stock_history_original_sources%ROWTYPE;actual_effects uuid[];receipts jsonb:='[]'::jsonb;held boolean:=false;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SYNC_FORBIDDEN';END IF;
 -- Preserve the exact original business payload, batch identity and admission.
 -- A business error propagates normally. Only optional evidence is caught below.
 SELECT EXISTS(SELECT 1 FROM public.sync_idempotency_receipts WHERE batch_id=p_batch_id) INTO old_business;
 business:=public.pos_sync_push_aggregate(p_batch_id,p_organization_id,p_branch_id,p_terminal_id,p_operations);
 IF business->'ok' IS DISTINCT FROM 'true'::jsonb THEN RETURN business;END IF;
 BEGIN
  IF p_project IS NULL OR length(p_project)>2048 OR p_cohorts IS NULL OR jsonb_typeof(p_cohorts)<>'array'
   OR jsonb_array_length(p_cohorts) NOT BETWEEN 1 AND 8 OR octet_length(convert_to(p_cohorts::text,'UTF8'))>65536
   THEN RAISE EXCEPTION 'STOCK_HISTORY_SOURCE_INVALID';END IF;
  IF NOT EXISTS(SELECT 1 FROM public.terminal_tokens WHERE id::text=p_terminal_id AND location_id=p_branch_id AND platform='pc'
   AND status IN('active','used') AND revoked_at IS NULL AND (is_claimed OR claimed_at IS NOT NULL))
   THEN RAISE EXCEPTION 'STOCK_HISTORY_SOURCE_INVALID';END IF;
  -- Headers are bounded RAW claims. No registry/author/operation identity from
  -- them is trusted at this stage; outages cannot erase the actual accepted TX.
  FOR candidate IN SELECT value FROM jsonb_array_elements(p_cohorts) LOOP
   IF jsonb_typeof(candidate) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(candidate))<>1
    OR NOT candidate?'proofJson' OR jsonb_typeof(candidate->'proofJson') NOT IN('string','null')
    OR octet_length(convert_to(candidate->>'proofJson','UTF8'))>8192 THEN RAISE EXCEPTION 'STOCK_HISTORY_SOURCE_INVALID';END IF;
   headers:=headers||jsonb_build_array(jsonb_build_object('proofJson',candidate->'proofJson'));
  END LOOP;
  SELECT * INTO prior FROM private.stock_history_original_sources WHERE batch_id=p_batch_id;
  IF FOUND THEN
   IF ROW(prior.project_origin,prior.store_id,prior.terminal_id,prior.operations_hash)
    IS DISTINCT FROM ROW(p_project,p_branch_id,p_terminal_id,md5(p_operations::text))
    OR prior.operations IS DISTINCT FROM p_operations OR prior.headers IS DISTINCT FROM headers
    THEN RAISE EXCEPTION 'STOCK_HISTORY_SOURCE_REPLAY_CONFLICT';END IF;
  ELSE
   -- Never rebuild an original witness from current mutable documents on replay.
   IF old_business OR business->'replayed'='true'::jsonb THEN RAISE EXCEPTION 'STOCK_HISTORY_SOURCE_ORIGIN_UNPROVEN';END IF;
   SELECT COALESCE(array_agg(id ORDER BY id),ARRAY[]::uuid[]) INTO actual_effects FROM private.stock_history_accepted_effects
    WHERE transaction_id=txid_current() AND store_id=p_branch_id;
   IF cardinality(actual_effects)=0 THEN RAISE EXCEPTION 'STOCK_HISTORY_SOURCE_ORIGIN_UNPROVEN';END IF;
   INSERT INTO private.stock_history_original_sources(batch_id,project_origin,store_id,terminal_id,headers,headers_hash,
    operations,accepted_sources,operations_hash,capture_xid,effect_ids,accepted_at)
   VALUES(p_batch_id,p_project,p_branch_id,p_terminal_id,headers,encode(sha256(convert_to(headers::text,'UTF8')),'hex'),
    p_operations,private.stock_history_original_source_snapshot(p_operations),md5(p_operations::text),txid_current(),actual_effects,clock_timestamp()) RETURNING * INTO prior;
  END IF;
  receipts:=private.stock_history_original_source_receipts(prior);
 EXCEPTION WHEN query_canceled OR assert_failure OR OTHERS THEN
  -- This savepoint covers optional evidence only. Never issue a fake/partial
  -- evidence receipt or alter the accepted business/financial acknowledgement.
  receipts:='[]'::jsonb;held:=true;
 END;
 RETURN business||jsonb_build_object('stockSourceStatus',CASE WHEN held THEN 'held' ELSE 'captured_unverified' END,'stockSourceReceipts',receipts);
END $fn$;
REVOKE ALL ON FUNCTION public.pos_sync_push_stock_source_aggregate(uuid,text,text,text,jsonb,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.pos_sync_push_stock_source_aggregate(uuid,text,text,text,jsonb,text,jsonb) TO service_role;
COMMIT;
