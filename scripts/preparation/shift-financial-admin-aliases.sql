-- FIN62 PREPARATION ONLY / NOT FINAL / NO LIVE APPLICATION OR ACTIVATION.
-- Actual existing administrator writers remain unchanged. Service adapters bind
-- the fresh verified account UUID; they do not add any Native tender/void right.
BEGIN;
DO $pins$
DECLARE item record;
BEGIN
 FOR item IN SELECT * FROM(VALUES
 ('public.pos_admin_correct_sale(uuid,text,integer,jsonb,jsonb,text,text,text,text,uuid)','57781707788f764fb67b358017320644'),
 ('public.pos_admin_correct_tender(uuid,text,text)','d56ea4079c9cc8fc55e5120ac33de27f'),
 ('public.pos_admin_add_missed_bill(jsonb,text,text)','ef937f21c6abf19c8e1084fdd08a898e'),
 ('fin62_history_preparation.block_unintegrated_write()','26acda2fbdbeef6190afe185cee4c37d'),
 ('fin62_history_preparation.published_later_fact(text,text,uuid,uuid,jsonb,jsonb)','f3618e236f052fb87952a882178e1e3a')
 ) expected(signature,digest) LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure(item.signature) AND proowner='postgres'::regrole AND md5(replace(pg_get_functiondef(oid),chr(13)||chr(10),chr(10)))=item.digest) THEN RAISE EXCEPTION 'FIN62_ADMIN_SOURCE_UNEXPECTED: %',item.signature;END IF;
 END LOOP;
END $pins$;
CREATE SCHEMA fin62_admin_preparation;
REVOKE ALL ON SCHEMA fin62_admin_preparation FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE fin62_admin_preparation.context(pid integer NOT NULL,xid xid8 NOT NULL,branch_id text NOT NULL,shift_id uuid,sale_id uuid NOT NULL,author_id uuid NOT NULL,action text NOT NULL CHECK(action IN('SALE_CORRECTION','TENDER_CORRECTION')),PRIMARY KEY(pid,xid));
CREATE TABLE fin62_admin_preparation.receipts(
 operation_id uuid PRIMARY KEY,action text NOT NULL CHECK(action IN('SALE_CORRECTION','TENDER_CORRECTION','MISSED_BILL')),
 sale_id uuid NOT NULL,branch_id text NOT NULL,shift_id uuid,organization_id text,terminal_id text,author_id uuid NOT NULL,
 request_key uuid,request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),before_row jsonb,after_row jsonb NOT NULL,result jsonb NOT NULL,
 capture_xid xid8 NOT NULL,evidence_order bigint NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(action,request_key)
);
CREATE INDEX receipts_scope_sale ON fin62_admin_preparation.receipts(branch_id,shift_id,sale_id);
ALTER TABLE fin62_admin_preparation.context ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin62_admin_preparation.receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA fin62_admin_preparation FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON fin62_admin_preparation.receipts FOR EACH ROW EXECUTE FUNCTION fin62_history_preparation.immutable();
CREATE FUNCTION fin62_admin_preparation.authorize(p_author uuid,p_branch text,p_terminal text) RETURNS public.app_users LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE actor public.app_users%ROWTYPE;
BEGIN
 PERFORM fin62_live_preparation.authorize(p_author,p_branch,p_terminal,'SALE');
 SELECT * INTO actor FROM public.app_users WHERE id=p_author AND is_active IS TRUE FOR SHARE;
 IF NOT FOUND OR NOT coalesce(actor.role::text='admin' OR actor.role_slug='admin',false) OR nullif(actor.user_id,'') IS NULL THEN RAISE EXCEPTION 'FIN62_ADMIN_REQUIRED';END IF;
 -- Existing administrator correction routes restrict an assigned account even
 -- in a browser. A broader title never overrides its branch assignment here.
 IF nullif(actor.store_id,'') IS NOT NULL AND lower(actor.store_id)<>lower(p_branch) THEN RAISE EXCEPTION 'FIN62_ADMIN_BRANCH_DENIED';END IF;
 RETURN actor;
END $$;
CREATE FUNCTION fin62_admin_preparation.row_allowed(p_operation text,p_old jsonb,p_new jsonb) RETURNS boolean LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE scope fin62_admin_preparation.context%ROWTYPE;before_fact jsonb;after_fact jsonb;
BEGIN
 SELECT * INTO scope FROM fin62_admin_preparation.context WHERE pid=pg_backend_pid() AND xid=pg_current_xact_id();
 IF NOT FOUND OR p_operation<>'UPDATE' OR p_new->>'id' IS DISTINCT FROM scope.sale_id::text OR p_old->>'id' IS DISTINCT FROM scope.sale_id::text OR
  ROW(p_old->>'store_id',p_old->>'shift_id',p_new->>'store_id',p_new->>'shift_id') IS DISTINCT FROM ROW(scope.branch_id,scope.shift_id::text,scope.branch_id,scope.shift_id::text) THEN RETURN false;END IF;
 before_fact:=fin62_history_preparation.row_fact(p_old);after_fact:=fin62_history_preparation.row_fact(p_new);
 IF scope.action='SALE_CORRECTION' THEN RETURN (before_fact-ARRAY['totalAmount','discountAmount']) IS NOT DISTINCT FROM (after_fact-ARRAY['totalAmount','discountAmount']);END IF;
 IF scope.action='TENDER_CORRECTION' THEN RETURN (before_fact-ARRAY['paymentType','payments']) IS NOT DISTINCT FROM (after_fact-ARRAY['paymentType','payments']);END IF;
 RETURN false;
END $$;
DO $guard$
DECLARE definition text;needle text:=' IF fin62_history_preparation.live_row_allowed(TG_OP,CASE WHEN TG_OP=''INSERT'' THEN NULL ELSE to_jsonb(OLD) END,CASE WHEN TG_OP=''DELETE'' THEN NULL ELSE to_jsonb(NEW) END) THEN RETURN NEW;END IF;';
BEGIN
 definition:=pg_get_functiondef('fin62_history_preparation.block_unintegrated_write()'::regprocedure);
 IF (length(definition)-length(replace(definition,needle,'')))<>length(needle) THEN RAISE EXCEPTION 'FIN62_ADMIN_GUARD_SOURCE_UNEXPECTED';END IF;
 EXECUTE replace(definition,needle,' IF fin62_admin_preparation.row_allowed(TG_OP,CASE WHEN TG_OP=''INSERT'' THEN NULL ELSE to_jsonb(OLD) END,CASE WHEN TG_OP=''DELETE'' THEN NULL ELSE to_jsonb(NEW) END) THEN RETURN NEW;END IF;'||chr(10)||needle);
END $guard$;
CREATE FUNCTION public.pos_live_financial_admin_correct_sale(p_author uuid,p_sale uuid,p_store text,p_expected_version integer,p_items jsonb,p_totals jsonb,p_reason text,p_terminal text,p_client_key uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor public.app_users%ROWTYPE;shift uuid;before_row jsonb;after_row jsonb;result jsonb;request_hash text;
BEGIN
 actor:=fin62_admin_preparation.authorize(p_author,p_store,p_terminal);
 SELECT nullif(shift_id,'')::uuid INTO shift FROM public.sales WHERE id=p_sale AND store_id=p_store;
 IF NOT FOUND THEN RAISE EXCEPTION 'This bill does not belong to the selected branch';END IF;
 IF shift IS NOT NULL THEN PERFORM pg_advisory_xact_lock(hashtextextended('pos-sync-shift:'||shift,0));END IF;
 SELECT to_jsonb(s) INTO STRICT before_row FROM public.sales s WHERE id=p_sale AND store_id=p_store FOR UPDATE;
 IF before_row->>'shift_id' IS DISTINCT FROM shift::text THEN RAISE EXCEPTION 'FIN62_ADMIN_SCOPE_CHANGED';END IF;
 -- Let the unchanged original validate and read back legacy/new exact retries.
 -- Never turn an old accepted edit into fabricated new publication evidence.
 IF EXISTS(SELECT 1 FROM public.record_edits WHERE id=p_client_key) THEN RETURN public.pos_admin_correct_sale(p_sale,p_store,p_expected_version,p_items,p_totals,p_reason,actor.user_id,coalesce(nullif(actor.full_name,''),actor.user_id),p_terminal,p_client_key);END IF;
 IF EXISTS(SELECT 1 FROM fin62_admin_preparation.receipts WHERE action='SALE_CORRECTION' AND request_key=p_client_key) THEN RAISE EXCEPTION 'FIN62_ADMIN_ORIGINAL_RECEIPT_MISSING';END IF;
 INSERT INTO fin62_admin_preparation.context VALUES(pg_backend_pid(),pg_current_xact_id(),p_store,shift,p_sale,p_author,'SALE_CORRECTION');
 result:=public.pos_admin_correct_sale(p_sale,p_store,p_expected_version,p_items,p_totals,p_reason,actor.user_id,coalesce(nullif(actor.full_name,''),actor.user_id),p_terminal,p_client_key);
 SELECT to_jsonb(s) INTO STRICT after_row FROM public.sales s WHERE id=p_sale AND store_id=p_store;
 request_hash:=encode(sha256(convert_to(jsonb_build_array(p_sale,p_store,p_expected_version,p_items,p_totals,p_reason)::text,'UTF8')),'hex');
 INSERT INTO fin62_admin_preparation.receipts VALUES(gen_random_uuid(),'SALE_CORRECTION',p_sale,p_store,shift,fin62_live_preparation.organization(p_store,shift),p_terminal,p_author,p_client_key,request_hash,before_row,after_row,result,pg_current_xact_id(),nextval('fin62_evidence_preparation.helper_order'),now());
 DELETE FROM fin62_admin_preparation.context WHERE pid=pg_backend_pid() AND xid=pg_current_xact_id();RETURN result;
END $$;
CREATE FUNCTION public.pos_live_financial_admin_correct_tender(p_author uuid,p_sale uuid,p_store text,p_method text,p_terminal text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor public.app_users%ROWTYPE;shift uuid;before_row jsonb;after_row jsonb;actual_branch text;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'FIN62_LIVE_SERVICE_REQUIRED';END IF;
 SELECT nullif(shift_id,'')::uuid,store_id INTO shift,actual_branch FROM public.sales WHERE id=p_sale AND lower(store_id)=lower(p_store);
 IF NOT FOUND THEN RAISE EXCEPTION 'The bill was not found in this branch. Synchronize and retry.';END IF;
 actor:=fin62_admin_preparation.authorize(p_author,actual_branch,p_terminal);
 IF shift IS NOT NULL THEN PERFORM pg_advisory_xact_lock(hashtextextended('pos-sync-shift:'||shift,0));END IF;
 SELECT to_jsonb(s) INTO STRICT before_row FROM public.sales s WHERE id=p_sale AND lower(store_id)=lower(p_store) FOR UPDATE;
 IF before_row->>'shift_id' IS DISTINCT FROM shift::text THEN RAISE EXCEPTION 'FIN62_ADMIN_SCOPE_CHANGED';END IF;
 INSERT INTO fin62_admin_preparation.context VALUES(pg_backend_pid(),pg_current_xact_id(),before_row->>'store_id',shift,p_sale,p_author,'TENDER_CORRECTION');
 PERFORM public.pos_admin_correct_tender(p_sale,p_store,p_method);
 SELECT to_jsonb(s) INTO STRICT after_row FROM public.sales s WHERE id=p_sale;
 INSERT INTO fin62_admin_preparation.receipts VALUES(gen_random_uuid(),'TENDER_CORRECTION',p_sale,before_row->>'store_id',shift,fin62_live_preparation.organization(before_row->>'store_id',shift),p_terminal,p_author,NULL,encode(sha256(convert_to(jsonb_build_array(p_sale,p_store,p_method)::text,'UTF8')),'hex'),before_row,after_row,'null',pg_current_xact_id(),nextval('fin62_evidence_preparation.helper_order'),now());
 DELETE FROM fin62_admin_preparation.context WHERE pid=pg_backend_pid() AND xid=pg_current_xact_id();
END $$;
CREATE FUNCTION public.pos_live_financial_admin_add_missed_bill(p_author uuid,p_entry jsonb,p_terminal text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor public.app_users%ROWTYPE;branch text:=btrim(p_entry->>'storeId');sale uuid:=(p_entry->>'clientKey')::uuid;result jsonb;after_row jsonb;operation uuid:=gen_random_uuid();previous_checkout_context text;
BEGIN
 actor:=fin62_admin_preparation.authorize(p_author,branch,p_terminal);
 PERFORM pg_advisory_xact_lock(hashtextextended('missed-bill:'||sale::text,0));
 IF EXISTS(SELECT 1 FROM public.missed_bill_entries WHERE id=sale) THEN RETURN public.pos_admin_add_missed_bill(p_entry,actor.user_id,p_terminal);END IF;
 IF EXISTS(SELECT 1 FROM public.sales WHERE id=sale) THEN RAISE EXCEPTION 'Historical entry identity is already recorded';END IF;
 INSERT INTO fin62_history_preparation.sale_birth_claims VALUES(sale,NULL,branch,p_terminal,NULL,operation);
 -- The original ALWAYS leaves sale/payment shift_id NULL. The optional old
 -- shift is attribution only and must never become a drawer posting.
 previous_checkout_context:=current_setting('pos.shift_checkout_context',true);
 PERFORM set_config('pos.shift_checkout_context',jsonb_build_object('branch',branch,'terminal',p_terminal,'mode','historical_admin')::text,true);
 BEGIN
  result:=public.pos_admin_add_missed_bill(p_entry,actor.user_id,p_terminal);
 EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('pos.shift_checkout_context',coalesce(previous_checkout_context,''),true);RAISE;
 END;
 PERFORM set_config('pos.shift_checkout_context',coalesce(previous_checkout_context,''),true);
 SELECT to_jsonb(s) INTO STRICT after_row FROM public.sales s WHERE id=sale AND store_id=branch;
 IF after_row->>'shift_id' IS NOT NULL THEN RAISE EXCEPTION 'FIN62_HISTORICAL_DRAWER_SCOPE_CHANGED';END IF;
 INSERT INTO fin62_admin_preparation.receipts VALUES(operation,'MISSED_BILL',sale,branch,NULL,NULL,p_terminal,p_author,sale,encode(sha256(convert_to(jsonb_build_array(p_entry,actor.user_id)::text,'UTF8')),'hex'),NULL,after_row,result,pg_current_xact_id(),nextval('fin62_evidence_preparation.helper_order'),now());RETURN result;
END $$;
CREATE FUNCTION fin62_admin_preparation.publication_edges(p_org text,p_branch text,p_shift uuid,p_sale uuid) RETURNS TABLE(before_fact jsonb,after_fact jsonb) LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT fin62_history_preparation.row_snapshot_fact(r.before_row),fin62_history_preparation.row_snapshot_fact(r.after_row) FROM fin62_admin_preparation.receipts r
 WHERE r.branch_id=p_branch AND r.shift_id=p_shift AND r.sale_id=p_sale AND (r.organization_id=p_org OR(r.organization_id IS NULL AND EXISTS(SELECT 1 FROM fin62_history_preparation.streams s WHERE s.organization_id=p_org AND s.branch_id=p_branch AND s.shift_id=p_shift)))
 AND fin62_history_preparation.row_snapshot_fact(r.before_row) IS DISTINCT FROM fin62_history_preparation.row_snapshot_fact(r.after_row);
$$;
CREATE FUNCTION fin62_admin_preparation.proves_publication(p_org text,p_branch text,p_shift uuid,p_sale uuid,p_before jsonb,p_after jsonb) RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE graph jsonb;published boolean;nodes integer;bytes bigint;receipt record;source_rows integer:=0;raw_bytes bigint:=0;edge record;
BEGIN
 -- Bound source work BEFORE canonical payment parsing, UNION de-duplication or
 -- graph aggregation. TOAST size is not a memory bound: highly compressible
 -- payment JSON must be measured in its serialized (expanded) representation.
 FOR receipt IN
  SELECT e.raw_before before_raw,e.raw_after after_raw FROM fin62_history_preparation.sale_steps e
   WHERE e.organization_id=p_org AND e.branch_id=p_branch AND e.shift_id=p_shift AND e.sale_id=p_sale
  UNION ALL SELECT r.before_row,r.after_row FROM fin62_live_preparation.receipts r
   WHERE r.branch_id=p_branch AND r.shift_id=p_shift AND r.sale_id=p_sale
  UNION ALL SELECT r.before_row,r.after_row FROM fin62_admin_preparation.receipts r
   WHERE r.branch_id=p_branch AND r.shift_id=p_shift AND r.sale_id=p_sale
  LIMIT 4097
 LOOP
  source_rows:=source_rows+1;
  IF source_rows>4096 THEN RAISE EXCEPTION 'FIN62_PUBLICATION_HISTORY_REVIEW_REQUIRED';END IF;
  raw_bytes:=raw_bytes
   +coalesce(octet_length(coalesce(receipt.before_raw->'paymentsJson',receipt.before_raw->'payments')::text),0)
   +coalesce(octet_length(coalesce(receipt.after_raw->'paymentsJson',receipt.after_raw->'payments')::text),0)
   +coalesce(octet_length(coalesce(receipt.before_raw->'paymentType',receipt.before_raw->'payment_type')::text),0)
   +coalesce(octet_length(coalesce(receipt.after_raw->'paymentType',receipt.after_raw->'payment_type')::text),0)
   +coalesce(octet_length(coalesce(receipt.before_raw->'totalAmount',receipt.before_raw->'total_amount')::text),0)
   +coalesce(octet_length(coalesce(receipt.after_raw->'totalAmount',receipt.after_raw->'total_amount')::text),0)
   +coalesce(octet_length(coalesce(receipt.before_raw->'discountAmount',receipt.before_raw->'discount_amount')::text),0)
   +coalesce(octet_length(coalesce(receipt.after_raw->'discountAmount',receipt.after_raw->'discount_amount')::text),0);
  IF raw_bytes>8388608 THEN RAISE EXCEPTION 'FIN62_PUBLICATION_HISTORY_REVIEW_REQUIRED';END IF;
 END LOOP;
 -- A bounded canonical pass precedes jsonb_agg; no graph exists on denial.
 nodes:=0;bytes:=2;
 FOR edge IN
 WITH native_edges AS(
  SELECT fin62_history_preparation.snapshot_canonical_fact(e.before_fact) before_fact,fin62_history_preparation.snapshot_canonical_fact(e.after_fact) after_fact FROM fin62_history_preparation.sale_steps e JOIN fin62_history_preparation.nodes n ON n.operation_id=e.operation_id AND n.node_kind='MUTATION' AND n.organization_id=e.organization_id AND n.branch_id=e.branch_id AND n.terminal_id=e.terminal_id AND n.shift_id=e.shift_id
  WHERE e.organization_id=p_org AND e.branch_id=p_branch AND e.shift_id=p_shift AND e.sale_id=p_sale AND(e.action='REFUND' OR(e.action='SALE' AND EXISTS(SELECT 1 FROM fin62_history_preparation.sale_birth_claims c WHERE c.sale_id=p_sale AND c.operation_id=e.operation_id AND c.organization_id=p_org AND c.branch_id=p_branch AND c.shift_id=p_shift)))
 ),edges AS(
  SELECT * FROM native_edges UNION SELECT fin62_history_preparation.snapshot_canonical_fact(w.before_fact),fin62_history_preparation.snapshot_canonical_fact(w.after_fact) FROM fin62_live_preparation.publication_edges(p_org,p_branch,p_shift,p_sale) w
  UNION SELECT * FROM fin62_admin_preparation.publication_edges(p_org,p_branch,p_shift,p_sale)
 ),bounded AS(SELECT * FROM edges WHERE before_fact IS DISTINCT FROM after_fact LIMIT 1025)
 SELECT before_fact,after_fact FROM bounded
 LOOP
  nodes:=nodes+1;
  bytes:=bytes+2+octet_length(jsonb_build_object('before',edge.before_fact,'after',edge.after_fact)::text);
  IF nodes>1024 OR bytes>8388608 THEN RAISE EXCEPTION 'FIN62_PUBLICATION_HISTORY_REVIEW_REQUIRED';END IF;
 END LOOP;
 WITH native_edges AS(
  SELECT fin62_history_preparation.snapshot_canonical_fact(e.before_fact) before_fact,fin62_history_preparation.snapshot_canonical_fact(e.after_fact) after_fact FROM fin62_history_preparation.sale_steps e JOIN fin62_history_preparation.nodes n ON n.operation_id=e.operation_id AND n.node_kind='MUTATION' AND n.organization_id=e.organization_id AND n.branch_id=e.branch_id AND n.terminal_id=e.terminal_id AND n.shift_id=e.shift_id
  WHERE e.organization_id=p_org AND e.branch_id=p_branch AND e.shift_id=p_shift AND e.sale_id=p_sale AND(e.action='REFUND' OR(e.action='SALE' AND EXISTS(SELECT 1 FROM fin62_history_preparation.sale_birth_claims c WHERE c.sale_id=p_sale AND c.operation_id=e.operation_id AND c.organization_id=p_org AND c.branch_id=p_branch AND c.shift_id=p_shift)))
 ),edges AS(
  SELECT * FROM native_edges UNION SELECT fin62_history_preparation.snapshot_canonical_fact(w.before_fact),fin62_history_preparation.snapshot_canonical_fact(w.after_fact) FROM fin62_live_preparation.publication_edges(p_org,p_branch,p_shift,p_sale) w
  UNION SELECT * FROM fin62_admin_preparation.publication_edges(p_org,p_branch,p_shift,p_sale)
 ) SELECT coalesce(jsonb_agg(jsonb_build_object('before',before_fact,'after',after_fact)),'[]') INTO graph FROM edges WHERE before_fact IS DISTINCT FROM after_fact;
 SELECT EXISTS(SELECT 1 FROM fin62_history_preparation.publications p WHERE p.organization_id=p_org AND p.branch_id=p_branch AND p.shift_id=p_shift AND p.sale_id=p_sale AND fin62_history_preparation.snapshot_canonical_fact(p.financial_fact) IS NOT DISTINCT FROM p_after)
 OR EXISTS(SELECT 1 FROM fin62_live_preparation.publication_edges(p_org,p_branch,p_shift,p_sale) w WHERE fin62_history_preparation.snapshot_canonical_fact(w.after_fact) IS NOT DISTINCT FROM p_after)
 OR EXISTS(SELECT 1 FROM fin62_admin_preparation.publication_edges(p_org,p_branch,p_shift,p_sale) a WHERE a.after_fact IS NOT DISTINCT FROM p_after) INTO published;
 IF NOT published THEN RETURN false;END IF;
 RETURN(WITH RECURSIVE edges AS(SELECT nullif(e->'before','null'::jsonb) before_fact,nullif(e->'after','null'::jsonb) after_fact FROM jsonb_array_elements(graph) e),reachable(fact) AS(
  SELECT p_before UNION SELECT e.after_fact FROM reachable r JOIN edges e ON e.before_fact IS NOT DISTINCT FROM r.fact
 ) SELECT EXISTS(SELECT 1 FROM reachable WHERE fact IS NOT DISTINCT FROM p_after));
END $$;
-- Guarded source-only extension, preserving the original function/grants. Pins
-- are intentionally finalized AFTER all modules by the reviewed final bundle.
DO $proof$
DECLARE definition text;needle text:=' IF native_proof THEN RETURN true;END IF;';
BEGIN
 definition:=pg_get_functiondef('fin62_history_preparation.published_later_fact(text,text,uuid,uuid,jsonb,jsonb)'::regprocedure);
 IF (length(definition)-length(replace(definition,needle,'')))<>length(needle) THEN RAISE EXCEPTION 'FIN62_ADMIN_PROOF_SOURCE_UNEXPECTED';END IF;
 EXECUTE replace(definition,needle,needle||chr(10)||' IF fin62_admin_preparation.proves_publication(p_org,p_branch,p_shift,p_sale,p_before,p_after) THEN RETURN true;END IF;');
END $proof$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA fin62_admin_preparation FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.pos_live_financial_admin_correct_sale(uuid,uuid,text,integer,jsonb,jsonb,text,text,uuid),public.pos_live_financial_admin_correct_tender(uuid,uuid,text,text,text),public.pos_live_financial_admin_add_missed_bill(uuid,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pos_live_financial_admin_correct_sale(uuid,uuid,text,integer,jsonb,jsonb,text,text,uuid),public.pos_live_financial_admin_correct_tender(uuid,uuid,text,text,text),public.pos_live_financial_admin_add_missed_bill(uuid,jsonb,text) TO service_role;
COMMIT;
