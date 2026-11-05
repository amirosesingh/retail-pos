-- SHIFT-36 source preparation only. No business rows/history are rewritten.
-- DRAFT: this state/order contract is not administrator authorization. Do not
-- deploy or promote it until the separately reviewed historical-author boundary
-- is enforced; an exposed terminal transport proof is insufficient authority.
-- Expected amounts are presently checked for internal consistency only. The
-- separately reviewed receipt-derived expected-total policy is not implemented.
BEGIN;
DO $prerequisite$
DECLARE apply_definition text; proof_definition text;
BEGIN
 SELECT pg_get_functiondef(to_regprocedure('public.sync_apply_shifts(jsonb)')) INTO apply_definition;
 SELECT pg_get_functiondef(to_regprocedure('public.pos_sync_shift_closure_ack(jsonb,text)')) INTO proof_definition;
 IF apply_definition IS NULL OR proof_definition IS NULL OR position('public."shifts"."closed_at" IS NOT NULL' IN apply_definition)=0 OR
   position('Only a clean, otherwise identical opening' IN proof_definition)=0 OR position('requested_row_version' IN proof_definition)=0
 THEN RAISE EXCEPTION 'SHIFT36_REQUIRES_REVIEWED_SHIFT32_PREREQUISITE'; END IF;
 IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='pos_sync_private'
   AND format('%I.%I(%s)',n.nspname,p.proname,replace(oidvectortypes(p.proargtypes),' ',''))<>ALL(ARRAY[
    'pos_sync_private.receipt_immutable()','pos_sync_private.shift_graph(uuid)','pos_sync_private.graph_token(jsonb)',
    'pos_sync_private.download_projection(jsonb,text,boolean)','pos_sync_private.validate_graph(jsonb,text,uuid,boolean)',
    'pos_sync_private.validate_target(jsonb,jsonb)','pos_sync_private.canonical_facts(jsonb)','pos_sync_private.request_coverage(jsonb,jsonb)'])) OR
   EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='pos_sync_private' AND c.relkind IN ('r','p','v','m','S','f') AND c.relname<>'shift_intent_receipts')
 THEN RAISE EXCEPTION 'UNEXPECTED_SHIFT_CAUSAL_PRIVATE_SCHEMA'; END IF;
 IF to_regclass('pos_sync_private.shift_intent_receipts') IS NOT NULL AND
  (SELECT jsonb_object_agg(a.attname,jsonb_build_array(format_type(a.atttypid,a.atttypmod),a.attnotnull)) FROM pg_attribute a
   WHERE a.attrelid=to_regclass('pos_sync_private.shift_intent_receipts') AND a.attnum>0 AND NOT a.attisdropped)
   IS DISTINCT FROM '{"intent_id":["uuid",true],"branch_id":["text",true],"terminal_id":["text",true],"shift_id":["uuid",true],"payload_hash":["text",true],"base_token":["text",false],"predecessor_intent_id":["uuid",false],"predecessor_intent_hash":["text",false],"accepted_token":["text",true],"acknowledgement":["jsonb",true],"created_at":["timestamp with time zone",true]}'::jsonb
 THEN RAISE EXCEPTION 'UNEXPECTED_SHIFT_INTENT_RECEIPT_SHAPE'; END IF;
 IF to_regclass('pos_sync_private.shift_intent_receipts') IS NOT NULL AND (NOT EXISTS
  (SELECT 1 FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attname='intent_id'
   WHERE c.conrelid=to_regclass('pos_sync_private.shift_intent_receipts') AND c.contype='p' AND c.conkey=ARRAY[a.attnum]) OR EXISTS
  (SELECT 1 FROM pg_index i WHERE i.indrelid=to_regclass('pos_sync_private.shift_intent_receipts') AND i.indisunique AND NOT i.indisprimary))
 THEN RAISE EXCEPTION 'UNEXPECTED_SHIFT_INTENT_RECEIPT_INDEX'; END IF;
END $prerequisite$;
-- SHIFT_CAUSAL_HELPERS_BEGIN
CREATE SCHEMA IF NOT EXISTS pos_sync_private;
REVOKE ALL ON SCHEMA pos_sync_private FROM PUBLIC,anon,authenticated;
CREATE TABLE IF NOT EXISTS pos_sync_private.shift_intent_receipts (
 intent_id uuid PRIMARY KEY, branch_id text NOT NULL, terminal_id text NOT NULL, shift_id uuid NOT NULL,
 payload_hash text NOT NULL CHECK(payload_hash ~ '^[a-f0-9]{64}$'),
 base_token text, predecessor_intent_id uuid, predecessor_intent_hash text,
 accepted_token text NOT NULL CHECK(accepted_token ~ '^[a-f0-9]{64}$'),
 acknowledgement jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((predecessor_intent_id IS NULL)=(predecessor_intent_hash IS NULL)),
 CHECK (predecessor_intent_id IS DISTINCT FROM intent_id),
 CHECK (base_token IS NULL OR predecessor_intent_id IS NULL)
);
ALTER TABLE pos_sync_private.shift_intent_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE pos_sync_private.shift_intent_receipts FROM PUBLIC,anon,authenticated,service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA pos_sync_private REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA pos_sync_private REVOKE ALL ON TABLES FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION pos_sync_private.receipt_immutable() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
BEGIN RAISE EXCEPTION 'SYNC_SHIFT_INTENT_RECEIPT_IMMUTABLE'; END $fn$;
REVOKE ALL ON FUNCTION pos_sync_private.receipt_immutable() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS shift_intent_receipt_immutable ON pos_sync_private.shift_intent_receipts;
CREATE TRIGGER shift_intent_receipt_immutable BEFORE UPDATE OR DELETE ON pos_sync_private.shift_intent_receipts
 FOR EACH ROW EXECUTE FUNCTION pos_sync_private.receipt_immutable();

-- One SQL statement, hence one MVCC snapshot for parent and every child table.
-- UTC is function-local; never change database/operator timezone settings.
CREATE OR REPLACE FUNCTION pos_sync_private.shift_graph(p_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp SET timezone='UTC' AS $fn$
 SELECT jsonb_build_array(
  jsonb_build_object('table','shifts','rows',jsonb_build_array(to_jsonb(s))),
  jsonb_build_object('table','shift_cash_counts','rows',(SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.id),'[]'::jsonb) FROM (SELECT * FROM public.shift_cash_counts WHERE shift_id=s.id ORDER BY id LIMIT 2001) x)),
  jsonb_build_object('table','shift_reconciliations','rows',(SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.id),'[]'::jsonb) FROM (SELECT * FROM public.shift_reconciliations WHERE shift_id=s.id ORDER BY id LIMIT 2001) x)),
  jsonb_build_object('table','shift_close_events','rows',(SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.id),'[]'::jsonb) FROM (SELECT * FROM public.shift_close_events WHERE shift_id=s.id ORDER BY id LIMIT 2001) x)),
  jsonb_build_object('table','shift_notifications','rows',(SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.id),'[]'::jsonb) FROM (SELECT * FROM public.shift_notifications WHERE shift_id=s.id ORDER BY id LIMIT 2001) x)),
  jsonb_build_object('table','shift_variance_alerts','rows',(SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.id),'[]'::jsonb) FROM (SELECT * FROM public.shift_variance_alerts WHERE shift_id=s.id ORDER BY id LIMIT 2001) x)))
 FROM public.shifts s WHERE s.id=p_id
$fn$;
CREATE OR REPLACE FUNCTION pos_sync_private.canonical_facts(p_value jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE result jsonb;
BEGIN
 IF jsonb_typeof(p_value)='number' THEN RETURN to_jsonb(trim_scale((p_value#>>'{}')::numeric)); END IF;
 IF jsonb_typeof(p_value)='array' THEN SELECT COALESCE(jsonb_agg(pos_sync_private.canonical_facts(value) ORDER BY ordinal),'[]'::jsonb) INTO result FROM jsonb_array_elements(p_value) WITH ORDINALITY AS items(value,ordinal); RETURN result; END IF;
 IF jsonb_typeof(p_value)='object' THEN SELECT COALESCE(jsonb_object_agg(key,pos_sync_private.canonical_facts(value)),'{}'::jsonb) INTO result FROM jsonb_each(p_value); RETURN result; END IF;
 RETURN p_value;
END $fn$;
CREATE OR REPLACE FUNCTION pos_sync_private.graph_token(p_graph jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog AS $fn$
 SELECT CASE WHEN p_graph IS NULL THEN NULL ELSE encode(sha256(convert_to(pos_sync_private.canonical_facts(jsonb_build_object(
  'parent',(p_graph->0->'rows'->0)-ARRAY['row_version','updated_at','overdue','note']::text[],
  'counts',p_graph->1->'rows','reconciliations',p_graph->2->'rows','events',p_graph->3->'rows'))::text,'UTF8')),'hex') END
$fn$;
-- Mirror only the existing download policy when recognizing previously
-- observed history. Existing immutable rows are preserved, never rewritten
-- from a masked terminal projection. No generic secret-name rules are added.
CREATE OR REPLACE FUNCTION pos_sync_private.download_projection(p_value jsonb,p_table text,p_management boolean) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE context text:=p_table; result jsonb; k text; child jsonb;
BEGIN
 IF jsonb_typeof(p_value)='array' THEN
  SELECT COALESCE(jsonb_agg(pos_sync_private.download_projection(value,p_table,p_management) ORDER BY ordinal),'[]'::jsonb)
   INTO result FROM jsonb_array_elements(p_value) WITH ORDINALITY AS items(value,ordinal); RETURN result;
 ELSIF jsonb_typeof(p_value) IS DISTINCT FROM 'object' THEN RETURN p_value; END IF;
 IF jsonb_typeof(p_value->'table_name')='string' THEN context:=p_value->>'table_name'; END IF;
 IF NOT p_management AND (p_table='settings_scoped' OR p_value->>'table_name'='settings_scoped') AND p_value->>'key' LIKE 'product_price:%' AND jsonb_typeof(p_value->'value')='object'
 THEN p_value:=jsonb_set(p_value,'{value}',(p_value->'value')-'ecom_price'); END IF;
 result:='{}'::jsonb;
 FOR k,child IN SELECT key,value FROM jsonb_each(p_value) LOOP
  IF (context='terminal_tokens' AND k=ANY(ARRAY['claim_secret_hash','claim_proof','claimed_proof_hash'])) OR
   (NOT p_management AND ((context='products' AND k=ANY(ARRAY['ecom_price','ecom_visible','ecom_enabled','is_published'])) OR k='ecommerceEnabled')) THEN CONTINUE; END IF;
  result:=result||jsonb_build_object(k,pos_sync_private.download_projection(child,context,p_management));
 END LOOP;
 RETURN result;
END $fn$;

CREATE OR REPLACE FUNCTION pos_sync_private.validate_target(p_count jsonb,p_reconciliation jsonb) RETURNS void
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE cash public.shift_cash_counts%ROWTYPE; recon public.shift_reconciliations%ROWTYPE; vc numeric; vcard numeric; vd numeric; total numeric;
BEGIN
 cash:=jsonb_populate_record(NULL::public.shift_cash_counts,p_count); recon:=jsonb_populate_record(NULL::public.shift_reconciliations,p_reconciliation);
 IF cash.id IS NULL OR recon.id IS NULL OR recon.count_id IS DISTINCT FROM cash.id OR cash.counted_cash IS NULL OR cash.counted_cash<0 OR cash.counted_card<0 OR cash.counted_digital<0 OR
  recon.expected_cash IS NULL OR recon.expected_card IS NULL OR recon.expected_digital IS NULL OR EXISTS
  (SELECT 1 FROM unnest(ARRAY[cash.counted_cash,cash.counted_card,cash.counted_digital,recon.expected_cash,recon.expected_card,recon.expected_digital,
    recon.variance_cash,recon.variance_card,recon.variance_digital,recon.variance_total]) amount WHERE amount::text IN ('NaN','Infinity','-Infinity') OR round(amount,2) IS DISTINCT FROM amount)
 THEN RAISE EXCEPTION 'SYNC_SHIFT_TARGET_FACTS_INVALID'; END IF;
 vc:=round(cash.counted_cash-recon.expected_cash,2); vcard:=round(cash.counted_card-recon.expected_card,2); vd:=round(cash.counted_digital-recon.expected_digital,2);
 total:=round(vc+COALESCE(vcard,0)+COALESCE(vd,0),2);
 IF ROW(recon.counted_cash,recon.counted_card,recon.counted_digital,recon.variance_cash,recon.variance_card,recon.variance_digital,recon.variance_total,recon.variance_status)
  IS DISTINCT FROM ROW(cash.counted_cash,cash.counted_card,cash.counted_digital,vc,vcard,vd,total,CASE WHEN abs(total)<=0.005 THEN 'NO_VARIANCE' WHEN total>0 THEN 'OVER' ELSE 'SHORT' END)
 THEN RAISE EXCEPTION 'SYNC_SHIFT_TARGET_FACTS_INVALID'; END IF;
END $fn$;
CREATE OR REPLACE FUNCTION pos_sync_private.validate_graph(p_graph jsonb,p_branch text,p_id uuid,p_closed boolean DEFAULT false) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp SET timezone='UTC' AS $fn$
DECLARE part jsonb; r jsonb; parent public.shifts%ROWTYPE; recon public.shift_reconciliations%ROWTYPE; count_row public.shift_cash_counts%ROWTYPE; matches boolean:=false; total integer:=0; ordinal integer:=0;
BEGIN
 IF p_graph IS NULL OR jsonb_array_length(p_graph)<>6 OR jsonb_array_length(p_graph->0->'rows')<>1
 THEN RAISE EXCEPTION 'SYNC_SHIFT_GRAPH_MISSING'; END IF;
 parent:=jsonb_populate_record(NULL::public.shifts,p_graph->0->'rows'->0);
 IF parent.id IS DISTINCT FROM p_id OR parent.store_id IS DISTINCT FROM p_branch THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF;
 IF parent.final_counted_cash IS NOT NULL AND parent.counted_cash IS DISTINCT FROM parent.final_counted_cash
 THEN RAISE EXCEPTION 'SYNC_SHIFT_GRAPH_CONFLICT'; END IF;
 FOR part IN SELECT value FROM jsonb_array_elements(p_graph) LOOP
  ordinal:=ordinal+1;
  IF part->>'table' IS DISTINCT FROM (ARRAY['shifts','shift_cash_counts','shift_reconciliations','shift_close_events','shift_notifications','shift_variance_alerts'])[ordinal]
    OR jsonb_typeof(part->'rows') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'SYNC_SHIFT_GRAPH_CONFLICT'; END IF;
  total:=total+jsonb_array_length(part->'rows');
  IF (SELECT count(*)<>count(DISTINCT value->>'id') FROM jsonb_array_elements(part->'rows')) THEN RAISE EXCEPTION 'SYNC_SHIFT_GRAPH_DUPLICATE'; END IF;
  FOR r IN SELECT value FROM jsonb_array_elements(part->'rows') LOOP
   IF r->>'store_id' IS DISTINCT FROM p_branch OR (part->>'table'<>'shifts' AND r->>'shift_id' IS DISTINCT FROM p_id::text)
   THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF;
  END LOOP;
 END LOOP;
 IF total>2000 OR octet_length(convert_to(p_graph::text,'UTF8'))>6*1024*1024 THEN RAISE EXCEPTION 'SYNC_SHIFT_GRAPH_TOO_LARGE'; END IF;
 FOR recon IN SELECT * FROM jsonb_populate_recordset(NULL::public.shift_reconciliations,p_graph->2->'rows') LOOP
  IF recon.count_id IS NULL THEN
   IF EXISTS(SELECT 1 FROM public.shift_reconciliations historical WHERE historical.id=recon.id AND historical.shift_id=p_id AND historical.store_id=p_branch AND historical.count_id IS NULL)
   THEN CONTINUE; ELSE RAISE EXCEPTION 'SYNC_SHIFT_GRAPH_CONFLICT'; END IF;
  END IF;
  SELECT * INTO count_row FROM jsonb_populate_recordset(NULL::public.shift_cash_counts,p_graph->1->'rows') c WHERE c.id=recon.count_id;
  IF NOT FOUND OR ROW(count_row.counted_cash,count_row.counted_card,count_row.counted_digital) IS DISTINCT FROM ROW(recon.counted_cash,recon.counted_card,recon.counted_digital)
  THEN RAISE EXCEPTION 'SYNC_SHIFT_GRAPH_CONFLICT'; END IF;
  IF ROW(recon.counted_cash,recon.counted_card,recon.counted_digital,recon.expected_cash,recon.expected_card,recon.expected_digital,
      recon.variance_cash,recon.variance_card,recon.variance_digital,recon.variance_total,recon.variance_status)
   IS NOT DISTINCT FROM ROW(COALESCE(parent.final_counted_cash,parent.counted_cash),parent.counted_card,parent.counted_digital,
      parent.expected_cash,parent.expected_card,parent.expected_digital,parent.variance_cash,parent.variance_card,parent.variance_digital,parent.variance_total,parent.variance_status)
  THEN matches:=true; END IF;
 END LOOP;
 IF (p_closed OR parent.status='CLOSED' OR parent.state='CLOSED' OR parent.closed_at IS NOT NULL) AND
   (parent.status IS DISTINCT FROM 'CLOSED' OR parent.state IS DISTINCT FROM 'CLOSED' OR parent.closed_at IS NULL OR NOT matches)
 THEN RAISE EXCEPTION 'SYNC_SHIFT_GRAPH_CONFLICT'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_graph->5->'rows') a WHERE a->>'reconciliation_id' IS NOT NULL AND NOT EXISTS
   (SELECT 1 FROM jsonb_array_elements(p_graph->2->'rows') linked_recon WHERE linked_recon->>'id'=a->>'reconciliation_id')) THEN RAISE EXCEPTION 'SYNC_SHIFT_GRAPH_CONFLICT'; END IF;
END $fn$;

CREATE OR REPLACE FUNCTION public.pos_sync_shift_graph(p_organization_id text,p_branch_id text,p_terminal_id text,p_shift_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp SET timezone='UTC' AS $fn$
DECLARE graph jsonb;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SYNC_FORBIDDEN'; END IF;
 PERFORM public.pos_sync_validate_scope(p_organization_id,p_branch_id,p_terminal_id);
 graph:=pos_sync_private.shift_graph(p_shift_id);
 PERFORM pos_sync_private.validate_graph(graph,p_branch_id,p_shift_id,false);
 RETURN jsonb_build_object('ok',true,'shiftGraphVersion',1,'branchId',p_branch_id,'shiftId',p_shift_id,
  'graphToken',CASE WHEN graph->0->'rows'->0->>'status'='CLOSED' AND graph->0->'rows'->0->>'state'='CLOSED'
    THEN pos_sync_private.graph_token(graph) ELSE NULL END,'closedAtRaw',graph->0->'rows'->0->'closed_at','tables',graph);
END $fn$;

-- Compact proof of actual accepted business projections, not an inference from
-- the request hash. Only two database-generated clocks may be transformed.
CREATE OR REPLACE FUNCTION pos_sync_private.request_coverage(p_operations jsonb,p_graph jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public,pg_temp SET timezone='UTC' AS $fn$
DECLARE table_name text; requested jsonb; requested_rows jsonb; actual_rows jsonb; actual_index jsonb; actual jsonb;
 business_fields text[]; managed_fields text[]; matched jsonb; server_values jsonb; tables jsonb:='[]'; result jsonb; count integer:=0;
BEGIN
 FOREACH table_name IN ARRAY ARRAY['shifts','shift_cash_counts','shift_reconciliations','shift_close_events','shift_notifications','shift_variance_alerts'] LOOP
  SELECT value->'rows' INTO requested_rows FROM jsonb_array_elements(p_operations) WHERE value->>'table'=table_name;
  SELECT value->'rows' INTO actual_rows FROM jsonb_array_elements(p_graph) WHERE value->>'table'=table_name;
  SELECT COALESCE(jsonb_object_agg(value->>'id',value),'{}'::jsonb) INTO actual_index FROM jsonb_array_elements(actual_rows);
  SELECT COALESCE(array_agg(a.attname::text ORDER BY a.attname) FILTER(WHERE a.attname<>ALL(ARRAY['row_version','updated_at'])),'{}'),
    COALESCE(array_agg(a.attname::text ORDER BY a.attname) FILTER(WHERE a.attname=ANY(ARRAY['row_version','updated_at'])),'{}')
   INTO business_fields,managed_fields FROM pg_attribute a WHERE a.attrelid=to_regclass(format('public.%I',table_name)) AND a.attnum>0 AND NOT a.attisdropped;
  matched:='[]';
  FOR requested IN SELECT value FROM jsonb_array_elements(requested_rows) ORDER BY value->>'id' LOOP
   actual:=actual_index->(requested->>'id');
   IF actual IS NULL THEN CONTINUE; END IF;
   IF (requested-managed_fields) IS DISTINCT FROM (actual-managed_fields) AND
     (requested-managed_fields) IS DISTINCT FROM (pos_sync_private.download_projection(actual,table_name,false)-managed_fields) AND
     (requested-managed_fields) IS DISTINCT FROM (pos_sync_private.download_projection(actual,table_name,true)-managed_fields)
   THEN CONTINUE; END IF;
   SELECT COALESCE(jsonb_object_agg(name,actual->name),'{}'::jsonb) INTO server_values FROM unnest(managed_fields) name;
   matched:=matched||jsonb_build_array(jsonb_build_object('id',requested->>'id','serverValues',server_values)); count:=count+1;
  END LOOP;
  tables:=tables||jsonb_build_array(jsonb_build_object('table',table_name,'fields',to_jsonb(business_fields),'serverManagedFields',to_jsonb(managed_fields),'rows',matched));
 END LOOP;
 result:=jsonb_build_object('version',1,'mode','matched_request_rows','tables',tables);
 IF count>2000 OR octet_length(convert_to(result::text,'UTF8'))>512*1024 THEN RAISE EXCEPTION 'SYNC_SHIFT_COVERAGE_TOO_LARGE'; END IF;
 RETURN result;
END $fn$;

-- Common fresh/replay guard. Lock every affected parent before the caller can
-- write even its first child. Existing legacy OPEN->CLOSED remains supported.
CREATE OR REPLACE FUNCTION public.pos_sync_shift_preflight(p_operations jsonb,p_branch_id text) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp SET timezone='UTC' AS $fn$
DECLARE op jsonb; r jsonb; saved jsonb; owner public.shifts%ROWTYPE; ids uuid[]:='{}'; id uuid; candidate jsonb; allowed boolean; initial_child boolean;
 count_candidate public.shift_cash_counts%ROWTYPE; recon_candidate public.shift_reconciliations%ROWTYPE; summary_candidate public.shift_notifications%ROWTYPE;
BEGIN
 FOR op IN SELECT value FROM jsonb_array_elements(COALESCE(p_operations,'[]'::jsonb)) LOOP
  IF op->>'table'=ANY(ARRAY['shifts','shift_cash_counts','shift_reconciliations','shift_close_events','shift_notifications','shift_variance_alerts']) THEN
   FOR r IN SELECT value FROM jsonb_array_elements(COALESCE(op->'rows','[]'::jsonb)) LOOP
    IF r->>'store_id' IS NOT NULL AND lower(btrim(r->>'store_id'))<>lower(btrim(p_branch_id)) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF;
    id:=CASE WHEN op->>'table'='shifts' THEN (r->>'id')::uuid ELSE (r->>'shift_id')::uuid END;
    IF id IS NULL THEN RAISE EXCEPTION 'SYNC_SHIFT_GRAPH_CONFLICT'; END IF; ids:=array_append(ids,id);
    IF op->>'table'<>'shifts' THEN
     EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE id=$1',op->>'table') INTO saved USING (r->>'id')::uuid;
     IF saved IS NOT NULL AND (saved->>'shift_id' IS DISTINCT FROM id::text OR saved->>'store_id' IS DISTINCT FROM p_branch_id)
     THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF;
    END IF;
   END LOOP;
   FOR r IN SELECT value FROM jsonb_array_elements(COALESCE(op->'changes','[]'::jsonb)) WHERE upper(COALESCE(value->>'operation','')) IN ('D','DELETE') LOOP
    candidate:=COALESCE(r->'key',(r->>'entityId')::jsonb,(r->>'entity_id')::jsonb);
    IF op->>'table'='shifts' THEN id:=(candidate->>'id')::uuid;
    ELSE EXECUTE format('SELECT shift_id FROM public.%I WHERE id=$1',op->>'table') INTO id USING (candidate->>'id')::uuid; END IF;
    IF id IS NOT NULL THEN ids:=array_append(ids,id); END IF;
   END LOOP;
  END IF;
 END LOOP;
 FOR id IN SELECT DISTINCT value FROM unnest(ids) value ORDER BY value LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended('pos-sync-shift:'||id::text,0));
 END LOOP;
 FOR owner IN SELECT * FROM public.shifts WHERE shifts.id=ANY(ids) ORDER BY shifts.id FOR UPDATE NOWAIT LOOP
  IF owner.store_id IS DISTINCT FROM p_branch_id THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF;
  allowed:=auth.role()='service_role' AND current_setting('pos.sync_causal_shift',true)=owner.id::text;
  IF owner.status='CLOSED' OR owner.state='CLOSED' OR owner.closed_at IS NOT NULL THEN
   FOR op IN SELECT value FROM jsonb_array_elements(p_operations) LOOP
    IF op->>'table'='shifts' THEN
     FOR r IN SELECT value FROM jsonb_array_elements(COALESCE(op->'rows','[]'::jsonb)) WHERE value->>'id'=owner.id::text LOOP
      IF NOT COALESCE(allowed,false) THEN PERFORM public.pos_sync_shift_closure_ack(jsonb_build_array(r),p_branch_id); END IF;
     END LOOP;
    ELSIF op->>'table'=ANY(ARRAY['shift_cash_counts','shift_reconciliations','shift_close_events','shift_notifications','shift_variance_alerts']) THEN
     FOR r IN SELECT value FROM jsonb_array_elements(COALESCE(op->'rows','[]'::jsonb)) WHERE value->>'shift_id'=owner.id::text LOOP
      EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE id=$1',op->>'table') INTO saved USING (r->>'id')::uuid;
      IF saved IS NOT NULL THEN
       IF saved->>'store_id' IS DISTINCT FROM p_branch_id OR saved->>'shift_id' IS DISTINCT FROM owner.id::text THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF;
       IF op->>'table'=ANY(ARRAY['shift_cash_counts','shift_reconciliations','shift_close_events']) THEN
        EXECUTE format('SELECT to_jsonb(jsonb_populate_record(NULL::public.%I,$1))',op->>'table') INTO candidate USING r;
        IF candidate IS DISTINCT FROM saved THEN RAISE EXCEPTION 'SYNC_SHIFT_HISTORY_CONFLICT'; END IF;
       END IF;
      ELSIF NOT COALESCE(allowed,false) AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_operations) p CROSS JOIN LATERAL jsonb_array_elements(COALESCE(p->'rows','[]'::jsonb)) parent
        WHERE p->>'table'='shifts' AND parent->>'id'=owner.id::text AND parent->>'status'='CLOSED' AND parent->>'state'='CLOSED')
      THEN
       -- Legacy first-close table uploads may deliver the parent before its
       -- ORIGINAL graph. Permit only history consistent with that saved close;
       -- an unconditioned RECOUNT can never replace its effective facts.
       initial_child:=false;
       IF op->>'table'='shift_cash_counts' THEN
        count_candidate:=jsonb_populate_record(NULL::public.shift_cash_counts,r);
        initial_child:=count_candidate.kind='ORIGINAL' AND ROW(count_candidate.counted_cash,count_candidate.counted_card,count_candidate.counted_digital)
          IS NOT DISTINCT FROM ROW(COALESCE(owner.final_counted_cash,owner.counted_cash),owner.counted_card,owner.counted_digital);
       ELSIF op->>'table'='shift_reconciliations' THEN
        recon_candidate:=jsonb_populate_record(NULL::public.shift_reconciliations,r);
        initial_child:=EXISTS(SELECT 1 FROM public.shift_cash_counts c WHERE c.id=recon_candidate.count_id AND c.shift_id=owner.id AND c.store_id=p_branch_id AND c.kind='ORIGINAL'
          AND ROW(c.counted_cash,c.counted_card,c.counted_digital) IS NOT DISTINCT FROM ROW(recon_candidate.counted_cash,recon_candidate.counted_card,recon_candidate.counted_digital))
          AND ROW(recon_candidate.counted_cash,recon_candidate.counted_card,recon_candidate.counted_digital,recon_candidate.expected_cash,recon_candidate.expected_card,recon_candidate.expected_digital,
            recon_candidate.variance_cash,recon_candidate.variance_card,recon_candidate.variance_digital,recon_candidate.variance_total,recon_candidate.variance_status)
          IS NOT DISTINCT FROM ROW(COALESCE(owner.final_counted_cash,owner.counted_cash),owner.counted_card,owner.counted_digital,owner.expected_cash,owner.expected_card,owner.expected_digital,
            owner.variance_cash,owner.variance_card,owner.variance_digital,owner.variance_total,owner.variance_status);
       ELSIF op->>'table'='shift_close_events' THEN initial_child:=r->>'event'=ANY(ARRAY['closing_started','cash_count_submitted','reconciled','variance_approved']);
       ELSIF op->>'table'='shift_notifications' THEN
        summary_candidate:=jsonb_populate_record(NULL::public.shift_notifications,r);
        initial_child:=ROW(summary_candidate.opened_at,summary_candidate.closed_at,summary_candidate.counted_cash,summary_candidate.expected_cash)
          IS NOT DISTINCT FROM ROW(owner.opened_at,owner.closed_at,COALESCE(owner.final_counted_cash,owner.counted_cash),owner.expected_cash);
       ELSIF op->>'table'='shift_variance_alerts' THEN
        initial_child:=EXISTS(SELECT 1 FROM public.shift_reconciliations linked WHERE linked.id=(r->>'reconciliation_id')::uuid AND linked.shift_id=owner.id AND linked.store_id=p_branch_id
          AND ROW(linked.variance_total,linked.variance_status) IS NOT DISTINCT FROM ROW((r->>'variance_total')::numeric,r->>'variance_status'));
       END IF;
       IF NOT COALESCE(initial_child,false) THEN RAISE EXCEPTION 'SYNC_SHIFT_BASELINE_REQUIRED'; END IF;
      END IF;
     END LOOP;
    END IF;
    IF op->>'table'=ANY(ARRAY['shifts','shift_cash_counts','shift_reconciliations','shift_close_events']) THEN
     FOR r IN SELECT value FROM jsonb_array_elements(COALESCE(op->'changes','[]'::jsonb)) WHERE upper(COALESCE(value->>'operation','')) IN ('D','DELETE') LOOP
      candidate:=COALESCE(r->'key',(r->>'entityId')::jsonb,(r->>'entity_id')::jsonb);
      IF op->>'table'='shifts' THEN
       IF (candidate->>'id')::uuid=owner.id THEN RAISE EXCEPTION 'SYNC_SHIFT_HISTORY_CONFLICT'; END IF;
      ELSE
       EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE id=$1',op->>'table') INTO saved USING (candidate->>'id')::uuid;
       IF (saved->>'shift_id')::uuid=owner.id THEN RAISE EXCEPTION 'SYNC_SHIFT_HISTORY_CONFLICT'; END IF;
      END IF;
     END LOOP;
    END IF;
   END LOOP;
  END IF;
 END LOOP;
END $fn$;

-- Separate internal RPC avoids overload ambiguity; HTTP aggregate DTO is shared.
CREATE OR REPLACE FUNCTION public.pos_sync_push_shift_intent(p_batch_id uuid,p_organization_id text,p_branch_id text,p_terminal_id text,p_operations jsonb,p_shift_intent jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp SET timezone='UTC' AS $fn$
DECLARE raw text; payload jsonb; hash text; v_shift_id uuid; predecessor uuid; parent public.shifts%ROWTYPE; incoming public.shifts%ROWTYPE;
 receipt pos_sync_private.shift_intent_receipts%ROWTYPE; prior pos_sync_private.shift_intent_receipts%ROWTYPE;
 graph jsonb; token text; expected text; op jsonb; rows jsonb; normalized jsonb:='[]'; ack jsonb; proof jsonb; original_revision bigint; kind text; submitted jsonb; saved_history jsonb; typed_history jsonb; target_count jsonb; target_recon jsonb; canonical_operations jsonb:='[]'; requested_operations jsonb;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SYNC_FORBIDDEN'; END IF;
 PERFORM public.pos_sync_validate_scope(p_organization_id,p_branch_id,p_terminal_id);
 raw:=p_shift_intent->>'payloadJson';
 IF raw IS NULL OR octet_length(convert_to(raw,'UTF8'))>6*1024*1024 THEN RAISE EXCEPTION 'SYNC_SHIFT_INTENT_INVALID'; END IF;
 payload:=raw::jsonb; hash:=encode(sha256(convert_to(raw,'UTF8')),'hex');
 IF payload-'operations'-'branchId' IS DISTINCT FROM p_shift_intent-'payloadJson' OR lower(btrim(payload->>'branchId')) IS DISTINCT FROM lower(btrim(p_branch_id)) OR
   (p_operations IS NOT NULL AND payload->'operations' IS DISTINCT FROM p_operations) OR payload->>'version' IS DISTINCT FROM '1' OR (payload->>'intentId')::uuid IS DISTINCT FROM p_batch_id OR
   jsonb_typeof(payload->'operations') IS DISTINCT FROM 'array' OR jsonb_array_length(payload->'operations') NOT BETWEEN 6 AND 7
 THEN RAISE EXCEPTION 'SYNC_SHIFT_INTENT_INVALID'; END IF;
 p_operations:=payload->'operations';
 v_shift_id:=(payload->>'shiftId')::uuid; predecessor:=(payload->>'predecessorIntentId')::uuid; kind:=payload->>'kind';
 IF v_shift_id IS NULL OR kind NOT IN ('ORIGINAL','RECOUNT','VARIANCE') OR predecessor=p_batch_id OR
   (predecessor IS NULL)<>(payload->>'predecessorIntentHash' IS NULL) OR
   (predecessor IS NOT NULL AND payload->>'baseToken' IS NOT NULL) OR
   (payload->>'baseToken' IS NOT NULL AND payload->>'baseToken' !~ '^[a-f0-9]{64}$') OR
   (payload->>'predecessorIntentHash' IS NOT NULL AND payload->>'predecessorIntentHash' !~ '^[a-f0-9]{64}$')
 THEN RAISE EXCEPTION 'SYNC_SHIFT_INTENT_INVALID'; END IF;
 -- Match legacy order even when a legacy request reuses this batch UUID.
 PERFORM pg_advisory_xact_lock(hashtextextended('pos-sync-batch:'||p_batch_id::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('pos-sync-intent:'||p_batch_id::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('pos-sync-shift:'||v_shift_id::text,0));
 SELECT * INTO parent FROM public.shifts WHERE shifts.id=v_shift_id FOR UPDATE NOWAIT;
 IF FOUND AND parent.store_id IS DISTINCT FROM p_branch_id THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF;
 graph:=pos_sync_private.shift_graph(v_shift_id); token:=pos_sync_private.graph_token(graph);
 SELECT * INTO receipt FROM pos_sync_private.shift_intent_receipts WHERE intent_id=p_batch_id;
 IF FOUND THEN
  IF ROW(receipt.branch_id,receipt.terminal_id,receipt.shift_id,receipt.payload_hash) IS DISTINCT FROM ROW(p_branch_id,p_terminal_id,v_shift_id,hash)
  THEN RAISE EXCEPTION 'SYNC_SHIFT_INTENT_MISMATCH'; END IF;
  proof:=receipt.acknowledgement||jsonb_build_object('current_token',token,'superseded',token IS DISTINCT FROM receipt.accepted_token);
  RETURN jsonb_build_object('ok',true,'replayed',true,'batch_id',p_batch_id,'shift_closure_ack_version',3,'shift_closures',jsonb_build_array(proof));
 END IF;
 IF predecessor IS NOT NULL THEN
  SELECT * INTO prior FROM pos_sync_private.shift_intent_receipts WHERE intent_id=predecessor;
  IF NOT FOUND OR ROW(prior.branch_id,prior.terminal_id,prior.shift_id,prior.payload_hash) IS DISTINCT FROM ROW(p_branch_id,p_terminal_id,v_shift_id,payload->>'predecessorIntentHash')
  THEN RAISE EXCEPTION 'SYNC_SHIFT_PREDECESSOR_REQUIRED'; END IF;
  expected:=prior.accepted_token;
 ELSE expected:=payload->>'baseToken'; END IF;
 IF expected IS NOT NULL THEN
  IF token IS DISTINCT FROM expected THEN RAISE EXCEPTION 'SYNC_SHIFT_BASELINE_CONFLICT'; END IF;
 ELSIF parent.status='CLOSED' OR parent.state='CLOSED' OR parent.closed_at IS NOT NULL THEN RAISE EXCEPTION 'SYNC_SHIFT_BASELINE_REQUIRED'; END IF;
 -- Require one complete frozen graph, never a sender-enriched future graph.
 IF (SELECT count(DISTINCT value->>'table') FROM jsonb_array_elements(p_operations))<>jsonb_array_length(p_operations) OR
   EXISTS(SELECT 1 FROM jsonb_array_elements(p_operations) x WHERE x->>'table'<>ALL(ARRAY['shifts','shift_cash_counts','shift_reconciliations','shift_close_events','shift_notifications','shift_variance_alerts','activity_events']) OR COALESCE((x->>'deletePhase')::boolean,false))
 THEN RAISE EXCEPTION 'SYNC_SHIFT_INTENT_INVALID'; END IF;
 -- Match established SQL-equivalent identity aliases without rewriting the
 -- frozen bytes/hash or treating a different branch as an alias.
 FOR op IN SELECT value FROM jsonb_array_elements(p_operations) LOOP
  rows:='[]'::jsonb;
  FOR submitted IN SELECT value FROM jsonb_array_elements(op->'rows') LOOP
   IF lower(btrim(submitted->>'store_id')) IS DISTINCT FROM lower(btrim(p_branch_id)) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF;
   submitted:=submitted||jsonb_build_object('store_id',p_branch_id);
   IF submitted ? 'branch_id' THEN
    IF lower(btrim(submitted->>'branch_id')) IS DISTINCT FROM lower(btrim(p_branch_id)) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF;
    submitted:=submitted||jsonb_build_object('branch_id',p_branch_id);
   END IF;
   IF lower(btrim(submitted->>'terminal_id'))=lower(btrim(p_terminal_id)) THEN submitted:=submitted||jsonb_build_object('terminal_id',p_terminal_id); END IF;
   IF EXISTS(SELECT 1 FROM jsonb_object_keys(submitted) attribute WHERE NOT EXISTS
      (SELECT 1 FROM pg_attribute a WHERE a.attrelid=to_regclass(format('public.%I',op->>'table')) AND a.attnum>0 AND NOT a.attisdropped AND a.attname=attribute))
   THEN RAISE EXCEPTION 'SYNC_SHIFT_INTENT_COLUMN_UNSUPPORTED'; END IF;
   EXECUTE format('SELECT to_jsonb(jsonb_populate_record(NULL::public.%I,$1))',op->>'table') INTO typed_history USING submitted;
   rows:=rows||jsonb_build_array(typed_history);
  END LOOP;
  canonical_operations:=canonical_operations||jsonb_build_array(jsonb_set(op,'{rows}',rows));
 END LOOP;
 p_operations:=canonical_operations;
 requested_operations:=p_operations;
 SELECT jsonb_agg(jsonb_build_object('table',name,'rows',(SELECT value->'rows' FROM jsonb_array_elements(p_operations) WHERE value->>'table'=name)) ORDER BY ordinal)
 INTO graph FROM unnest(ARRAY['shifts','shift_cash_counts','shift_reconciliations','shift_close_events','shift_notifications','shift_variance_alerts']) WITH ORDINALITY AS names(name,ordinal);
 PERFORM pos_sync_private.validate_graph(graph,p_branch_id,v_shift_id,true);
 incoming:=jsonb_populate_record(NULL::public.shifts,graph->0->'rows'->0); original_revision:=incoming.row_version;
 IF original_revision IS NULL OR original_revision<1 THEN RAISE EXCEPTION 'SYNC_SHIFT_INTENT_INVALID'; END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(graph->1->'rows') c WHERE c->>'kind'='ORIGINAL')<>1
 THEN RAISE EXCEPTION 'SYNC_SHIFT_GRAPH_CONFLICT'; END IF;
 IF kind='ORIGINAL' AND EXISTS(SELECT 1 FROM jsonb_array_elements(graph->1->'rows') c WHERE c->>'kind'='RECOUNT' AND NOT EXISTS(SELECT 1 FROM public.shift_cash_counts saved WHERE saved.id=(c->>'id')::uuid))
 THEN RAISE EXCEPTION 'SYNC_SHIFT_GRAPH_CONFLICT'; END IF;
 IF kind='ORIGINAL' AND (parent.status='CLOSED' OR parent.state='CLOSED' OR parent.closed_at IS NOT NULL)
 THEN PERFORM public.pos_sync_shift_closure_ack(jsonb_build_array(to_jsonb(incoming)),p_branch_id); END IF;
 IF kind='ORIGINAL' THEN
  SELECT c INTO target_count FROM jsonb_array_elements(graph->1->'rows') c WHERE c->>'kind'='ORIGINAL' AND NOT EXISTS(SELECT 1 FROM public.shift_cash_counts saved WHERE saved.id=(c->>'id')::uuid);
  SELECT r INTO target_recon FROM jsonb_array_elements(graph->2->'rows') r WHERE r->>'count_id'=target_count->>'id' AND NOT EXISTS(SELECT 1 FROM public.shift_reconciliations saved WHERE saved.id=(r->>'id')::uuid) LIMIT 1;
  IF target_count IS NULL OR target_recon IS NULL OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(graph->3->'rows') e WHERE e->>'event'='cash_count_submitted' AND e->'detail'->>'count_id'=target_count->>'id' AND NOT EXISTS(SELECT 1 FROM public.shift_close_events saved WHERE saved.id=(e->>'id')::uuid)) OR
    NOT EXISTS(SELECT 1 FROM jsonb_array_elements(graph->3->'rows') e WHERE e->>'event'='reconciled' AND NOT EXISTS(SELECT 1 FROM public.shift_close_events saved WHERE saved.id=(e->>'id')::uuid))
  THEN RAISE EXCEPTION 'SYNC_SHIFT_GRAPH_CONFLICT'; END IF;
  PERFORM pos_sync_private.validate_target(target_count,target_recon);
 END IF;
 IF kind='RECOUNT' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(graph->1->'rows') c
  JOIN LATERAL jsonb_populate_recordset(NULL::public.shift_reconciliations,graph->2->'rows') proposed ON proposed.count_id=(c->>'id')::uuid
  WHERE c->>'kind'='RECOUNT' AND NOT EXISTS(SELECT 1 FROM public.shift_cash_counts saved WHERE saved.id=(c->>'id')::uuid)
   AND NOT EXISTS(SELECT 1 FROM public.shift_reconciliations saved WHERE saved.id=proposed.id)
   AND ROW(proposed.counted_cash,proposed.counted_card,proposed.counted_digital,proposed.expected_cash,proposed.expected_card,proposed.expected_digital,
      proposed.variance_cash,proposed.variance_card,proposed.variance_digital,proposed.variance_total,proposed.variance_status)
    IS NOT DISTINCT FROM ROW(COALESCE(incoming.final_counted_cash,incoming.counted_cash),incoming.counted_card,incoming.counted_digital,
      incoming.expected_cash,incoming.expected_card,incoming.expected_digital,incoming.variance_cash,incoming.variance_card,incoming.variance_digital,incoming.variance_total,incoming.variance_status)
   AND EXISTS(SELECT 1 FROM jsonb_array_elements(graph->3->'rows') e WHERE e->>'event'='recount_submitted' AND e->'detail'->>'count_id'=c->>'id'
     AND NOT EXISTS(SELECT 1 FROM public.shift_close_events saved WHERE saved.id=(e->>'id')::uuid)))
 THEN RAISE EXCEPTION 'SYNC_SHIFT_GRAPH_CONFLICT'; END IF;
 IF kind='RECOUNT' THEN
  IF (SELECT count(*) FROM jsonb_array_elements(graph->1->'rows') c WHERE c->>'kind'='RECOUNT' AND NOT EXISTS(SELECT 1 FROM public.shift_cash_counts saved WHERE saved.id=(c->>'id')::uuid))<>1
  THEN RAISE EXCEPTION 'SYNC_SHIFT_GRAPH_CONFLICT'; END IF;
  SELECT c INTO target_count FROM jsonb_array_elements(graph->1->'rows') c WHERE c->>'kind'='RECOUNT' AND NOT EXISTS(SELECT 1 FROM public.shift_cash_counts saved WHERE saved.id=(c->>'id')::uuid) LIMIT 1;
  SELECT r INTO target_recon FROM jsonb_array_elements(graph->2->'rows') r WHERE r->>'count_id'=target_count->>'id' AND NOT EXISTS(SELECT 1 FROM public.shift_reconciliations saved WHERE saved.id=(r->>'id')::uuid) LIMIT 1;
  PERFORM pos_sync_private.validate_target(target_count,target_recon);
 END IF;
 IF kind='VARIANCE' AND (NOT EXISTS(SELECT 1 FROM jsonb_array_elements(graph->3->'rows') e WHERE e->>'event'='variance_approved' AND NOT EXISTS(SELECT 1 FROM public.shift_close_events saved WHERE saved.id=(e->>'id')::uuid)) OR
   EXISTS(SELECT 1 FROM jsonb_array_elements(graph->1->'rows') c WHERE c->>'kind'='RECOUNT' AND NOT EXISTS(SELECT 1 FROM public.shift_cash_counts saved WHERE saved.id=(c->>'id')::uuid)))
 THEN RAISE EXCEPTION 'SYNC_SHIFT_GRAPH_CONFLICT'; END IF;
 IF kind='VARIANCE' AND (parent.id IS NULL OR parent.state<>ALL(ARRAY['VARIANCE_REVIEW_REQUIRED','RECONCILIATION']) OR
    ROW(incoming.counted_cash,incoming.counted_card,incoming.counted_digital,incoming.expected_cash,incoming.expected_card,incoming.expected_digital,
      incoming.closing_float,incoming.final_counted_cash,incoming.variance_cash,incoming.variance_card,incoming.variance_digital,incoming.variance_total,incoming.variance_status)
    IS DISTINCT FROM ROW(parent.counted_cash,parent.counted_card,parent.counted_digital,parent.expected_cash,parent.expected_card,parent.expected_digital,
      parent.closing_float,parent.final_counted_cash,parent.variance_cash,parent.variance_card,parent.variance_digital,parent.variance_total,parent.variance_status) OR
    EXISTS(SELECT 1 FROM jsonb_array_elements(graph->1->'rows') c WHERE NOT EXISTS(SELECT 1 FROM public.shift_cash_counts saved WHERE saved.id=(c->>'id')::uuid)) OR
    EXISTS(SELECT 1 FROM jsonb_array_elements(graph->2->'rows') r WHERE NOT EXISTS(SELECT 1 FROM public.shift_reconciliations saved WHERE saved.id=(r->>'id')::uuid)))
 THEN RAISE EXCEPTION 'SYNC_SHIFT_GRAPH_CONFLICT'; END IF;
 FOR op IN SELECT value FROM jsonb_array_elements(p_operations) LOOP
  IF jsonb_typeof(op->'rows') IS DISTINCT FROM 'array' OR jsonb_typeof(op->'changes') IS DISTINCT FROM 'array' OR
    EXISTS(SELECT 1 FROM jsonb_array_elements(op->'changes') c WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE')) THEN RAISE EXCEPTION 'SYNC_SHIFT_INTENT_INVALID'; END IF;
  IF op->>'table'='activity_events' AND EXISTS(SELECT 1 FROM jsonb_array_elements(op->'rows') e WHERE e->>'store_id' IS DISTINCT FROM p_branch_id OR e->>'branch_id' IS DISTINCT FROM p_branch_id OR e->>'entity_type' IS DISTINCT FROM 'shift' OR e->>'entity_id' IS DISTINCT FROM v_shift_id::text OR e->>'event_type' IS DISTINCT FROM 'shift_cash_variance')
  THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF;
  IF op->>'table'='shifts' AND parent.id IS NOT NULL THEN
   -- Assign the next actual SERVER revision under its parent lock. Do not use
   -- independent native counters to authorize a previously validated correction.
   rows:=jsonb_build_array((op->'rows'->0)||jsonb_build_object('row_version',parent.row_version+1,
    'id',parent.id,'store_id',parent.store_id,'terminal_id',parent.terminal_id,'terminal_name',parent.terminal_name,
    'opened_at',parent.opened_at,'opened_by_name',parent.opened_by_name,'opened_by_staff_id',parent.opened_by_staff_id,
    'opened_by_role',parent.opened_by_role,'opening_float',parent.opening_float,'created_at',parent.created_at,'user_id',parent.user_id,
    'note',parent.note,'overdue',parent.overdue)||
    CASE WHEN parent.closed_at IS NOT NULL THEN jsonb_build_object('closed_at',parent.closed_at,'closed_by_name',parent.closed_by_name,
      'closed_by_staff_id',parent.closed_by_staff_id,'closed_by_role',parent.closed_by_role,'closing_started_at',parent.closing_started_at,
      'closing_started_by',parent.closing_started_by,'close_reason',parent.close_reason) ELSE '{}'::jsonb END);
   op:=jsonb_set(op,'{rows}',rows);
  END IF;
  IF op->>'table'=ANY(ARRAY['shift_cash_counts','shift_reconciliations','shift_close_events','shift_notifications','shift_variance_alerts']) THEN
   rows:='[]'::jsonb;
   FOR submitted IN SELECT value FROM jsonb_array_elements(op->'rows') LOOP
    EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE id=$1',op->>'table') INTO saved_history USING (submitted->>'id')::uuid;
    IF saved_history IS NULL THEN
     IF op->>'table'='shift_variance_alerts' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(graph->2->'rows') linked WHERE linked->>'id'=submitted->>'reconciliation_id'
       AND ROW((linked->>'variance_total')::numeric,linked->>'variance_status') IS NOT DISTINCT FROM ROW((submitted->>'variance_total')::numeric,submitted->>'variance_status'))
     THEN RAISE EXCEPTION 'SYNC_SHIFT_GRAPH_CONFLICT'; END IF;
     rows:=rows||jsonb_build_array(submitted); CONTINUE;
    END IF;
    IF saved_history->>'store_id' IS DISTINCT FROM p_branch_id OR saved_history->>'shift_id' IS DISTINCT FROM v_shift_id::text
    THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF;
    IF op->>'table'='shift_variance_alerts' THEN
     IF saved_history->>'reconciliation_id' IS DISTINCT FROM submitted->>'reconciliation_id' THEN RAISE EXCEPTION 'SYNC_SHIFT_HISTORY_CONFLICT'; END IF;
     -- Delivery/acknowledgement belongs to its current cloud workflow. An
     -- observed stale copy is not a protected mutation target or a full match.
     CONTINUE;
    END IF;
    EXECUTE format('SELECT to_jsonb(jsonb_populate_record(NULL::public.%I,$1))',op->>'table') INTO typed_history USING submitted;
    IF typed_history IS DISTINCT FROM saved_history AND
       typed_history IS DISTINCT FROM pos_sync_private.download_projection(saved_history,op->>'table',false) AND
       typed_history IS DISTINCT FROM pos_sync_private.download_projection(saved_history,op->>'table',true)
    THEN RAISE EXCEPTION 'SYNC_SHIFT_HISTORY_CONFLICT'; END IF;
    -- Identity and money must match; only the authenticated existing view may
    -- differ by download masking. Preserve every authoritative hidden field.
   END LOOP;
   op:=jsonb_set(op,'{rows}',rows);
  END IF;
  normalized:=normalized||jsonb_build_array(op);
 END LOOP;
 PERFORM set_config('pos.sync_causal_shift',v_shift_id::text,true);
 -- The existing RPC preserves every unrelated policy, audit and receipt path.
 ack:=public.pos_sync_push_aggregate(p_batch_id,p_organization_id,p_branch_id,p_terminal_id,normalized);
 PERFORM set_config('pos.sync_causal_shift','',true);
 graph:=pos_sync_private.shift_graph(v_shift_id); PERFORM pos_sync_private.validate_graph(graph,p_branch_id,v_shift_id,true);
 token:=pos_sync_private.graph_token(graph); parent:=jsonb_populate_record(NULL::public.shifts,graph->0->'rows'->0);
 proof:=jsonb_build_object('id',v_shift_id,'store_id',p_branch_id,'row_version',parent.row_version,'requested_row_version',original_revision,
  'intent_id',p_batch_id,'intent_hash',hash,'accepted_token',token,'current_token',token,'superseded',false,'closed_at_raw',graph->0->'rows'->0->'closed_at',
  'coverage',pos_sync_private.request_coverage(requested_operations,graph));
 INSERT INTO pos_sync_private.shift_intent_receipts(intent_id,branch_id,terminal_id,shift_id,payload_hash,base_token,predecessor_intent_id,predecessor_intent_hash,accepted_token,acknowledgement)
 VALUES(p_batch_id,p_branch_id,p_terminal_id,v_shift_id,hash,payload->>'baseToken',predecessor,payload->>'predecessorIntentHash',token,proof);
 RETURN ack||jsonb_build_object('shift_closure_ack_version',3,'shift_closures',jsonb_build_array(proof));
END $fn$;
REVOKE ALL ON FUNCTION pos_sync_private.receipt_immutable(),pos_sync_private.shift_graph(uuid),pos_sync_private.graph_token(jsonb),
 pos_sync_private.download_projection(jsonb,text,boolean),pos_sync_private.validate_graph(jsonb,text,uuid,boolean),pos_sync_private.validate_target(jsonb,jsonb),pos_sync_private.canonical_facts(jsonb),pos_sync_private.request_coverage(jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.pos_sync_shift_graph(text,text,text,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.pos_sync_shift_preflight(jsonb,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.pos_sync_push_shift_intent(uuid,text,text,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pos_sync_shift_graph(text,text,text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.pos_sync_shift_preflight(jsonb,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.pos_sync_push_shift_intent(uuid,text,text,text,jsonb,jsonb) TO service_role;
-- SHIFT_CAUSAL_HELPERS_END

-- Patch only the two existing fresh/replay entry points, with exact anchors.
DO $patch$
DECLARE signature regprocedure; definition text; anchor text:=' SELECT payload_hash INTO v_prior FROM public.sync_idempotency_receipts WHERE batch_id=p_batch_id;'; addition text;
BEGIN
 FOREACH signature IN ARRAY ARRAY['public.pos_sync_push_batch(uuid,text,text,text,text,jsonb,jsonb)'::regprocedure,'public.pos_sync_push_aggregate(uuid,text,text,text,jsonb)'::regprocedure] LOOP
  definition:=pg_get_functiondef(signature);
  addition:=CASE WHEN signature='public.pos_sync_push_batch(uuid,text,text,text,text,jsonb,jsonb)'::regprocedure
   THEN E' PERFORM public.pos_sync_shift_preflight(jsonb_build_array(jsonb_build_object(\'table\',p_table,\'rows\',p_rows,\'changes\',p_changes)),p_branch_id);\n'
   ELSE E' PERFORM public.pos_sync_shift_preflight(p_operations,p_branch_id);\n' END;
  IF position(addition IN definition)=0 THEN
   IF (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'Unexpected sync preflight anchor'; END IF;
   EXECUTE replace(definition,anchor,addition||anchor);
  END IF;
 END LOOP;
END $patch$;
DO $direct_helper$
DECLARE definition text; anchor text:='INSERT INTO public."shifts" (';
 addition text:=E'PERFORM public.pos_sync_shift_preflight(jsonb_build_array(jsonb_build_object(\'table\',\'shifts\',\'rows\',p_rows,\'changes\',\'[]\'::jsonb)),current_setting(\'pos.sync_branch\',true));\n  ';
BEGIN
 SELECT pg_get_functiondef('public.sync_apply_shifts(jsonb)'::regprocedure) INTO definition;
 IF position(addition IN definition)=0 THEN
  IF (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'Unexpected direct shift apply anchor'; END IF;
  EXECUTE replace(definition,anchor,addition||anchor);
 END IF;
END $direct_helper$;
NOTIFY pgrst,'reload schema';
COMMIT;
