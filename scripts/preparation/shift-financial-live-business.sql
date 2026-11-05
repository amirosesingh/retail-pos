-- FIN62 PREPARATION ONLY. Not a registered migration or activation.
-- Service-only adapters consume the hosted relay's freshly verified app-user
-- UUID. They do not authenticate that UUID themselves or expose a JWT bypass.
-- Original sale INVOKER/RLS and refund routines are not replaced.
BEGIN;
DO $pins$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.pos_sale_commit(jsonb,jsonb,jsonb,jsonb,jsonb,text)'::regprocedure AND NOT prosecdef AND proowner='postgres'::regrole AND md5(replace(pg_get_functiondef(oid),E'\r\n',E'\n')) IN('670c036818c06e99f7963fb9d5d30905','0a8f6fc976060f01aaca6710cae7db02')) OR
  NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.sale_refund(uuid,jsonb,text,text,text)'::regprocedure AND prosecdef AND proowner='postgres'::regrole AND md5(replace(pg_get_functiondef(oid),E'\r\n',E'\n'))='2095254e1769d3c21f3df057a3117247') THEN RAISE EXCEPTION 'FIN62_LIVE_SOURCE_UNEXPECTED';END IF;
END $pins$;
CREATE SCHEMA fin62_live_preparation;
REVOKE ALL ON SCHEMA fin62_live_preparation FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE fin62_live_preparation.receipts(
 operation_id uuid PRIMARY KEY,action text NOT NULL CHECK(action IN('SALE','REFUND')),
 sale_id uuid NOT NULL,branch_id text NOT NULL,shift_id uuid,organization_id text,terminal_id text,author_id uuid NOT NULL,
 request_key text NOT NULL,request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 before_row jsonb,after_row jsonb NOT NULL,result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(action,sale_id,request_key)
);
ALTER TABLE fin62_live_preparation.receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON fin62_live_preparation.receipts FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON fin62_live_preparation.receipts FOR EACH ROW EXECUTE FUNCTION fin62_history_preparation.immutable();
CREATE INDEX receipts_scope_sale ON fin62_live_preparation.receipts(branch_id,shift_id,sale_id);
CREATE FUNCTION fin62_live_preparation.authorize(p_author uuid,p_branch text,p_terminal text,p_action text) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE a public.app_users%ROWTYPE;device public.terminal_tokens%ROWTYPE;admin boolean;supervisor boolean;permission text;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'FIN62_LIVE_SERVICE_REQUIRED';END IF;
 SELECT * INTO a FROM public.app_users WHERE id=p_author AND is_active IS TRUE FOR SHARE;
 IF NOT FOUND OR nullif(p_branch,'') IS NULL OR p_action NOT IN('SALE','REFUND') THEN RAISE EXCEPTION 'FIN62_LIVE_AUTHOR_INVALID';END IF;
 admin:=coalesce(a.role::text='admin' OR a.role_slug='admin',false);
 supervisor:=admin OR coalesce(a.role::text='manager' OR a.role_slug='supervisor',false);
 permission:=CASE WHEN p_action='SALE' THEN 'can_process_sale' ELSE 'can_process_refund' END;
 IF NOT admin AND a.permissions->permission IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'FIN62_LIVE_PERMISSION_DENIED';END IF;
 IF p_terminal IS NOT NULL THEN
  SELECT * INTO device FROM public.terminal_tokens WHERE id::text=p_terminal AND status IN('active','used') AND revoked_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FIN62_LIVE_BRANCH_DENIED';END IF;
  IF nullif(a.store_id,'') IS NOT NULL AND lower(a.store_id)<>lower(p_branch) THEN RAISE EXCEPTION 'FIN62_LIVE_BRANCH_DENIED';END IF;
  IF device.location_id IS NULL THEN
   -- Actual read admission proves the registered Management device capability;
   -- the separate fresh person/action/branch rules still govern this write.
   PERFORM public.pos_sync_validate_read_scope('default',p_branch,p_terminal);
   IF NOT pos_sync_private.shift_author_management_allowed(a.role::text,a.role_slug,a.permissions) OR (NOT supervisor AND a.store_id IS DISTINCT FROM p_branch) THEN RAISE EXCEPTION 'FIN62_LIVE_BRANCH_DENIED';END IF;
  ELSIF device.location_id IS DISTINCT FROM p_branch OR (nullif(a.store_id,'') IS NOT NULL AND lower(a.store_id)<>lower(p_branch)) THEN RAISE EXCEPTION 'FIN62_LIVE_BRANCH_DENIED';END IF;
 ELSIF NOT supervisor AND a.store_id IS DISTINCT FROM p_branch THEN RAISE EXCEPTION 'FIN62_LIVE_BRANCH_DENIED';END IF;
END $$;
CREATE FUNCTION fin62_live_preparation.organization(p_branch text,p_shift uuid) RETURNS text LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT CASE WHEN count(DISTINCT organization_id)=1 THEN min(organization_id) ELSE NULL END FROM fin62_history_preparation.streams WHERE branch_id=p_branch AND shift_id=p_shift;
$$;
CREATE FUNCTION public.pos_live_financial_sale(p_author uuid,p_branch text,p_terminal text,p_sale jsonb,p_items jsonb,p_payments jsonb,p_movements jsonb,p_member jsonb,p_exchange_bill text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE sid uuid;shift uuid;op uuid:=gen_random_uuid();request text;digest text;before_row jsonb;after_row jsonb;result jsonb;prior fin62_live_preparation.receipts%ROWTYPE;org text;
BEGIN
 PERFORM fin62_live_preparation.authorize(p_author,p_branch,p_terminal,'SALE');
 sid:=(p_sale->>'id')::uuid;shift:=nullif(p_sale->>'shift_id','')::uuid;
 IF sid IS NULL OR p_sale->>'store_id' IS DISTINCT FROM p_branch THEN RAISE EXCEPTION 'FIN62_LIVE_SALE_SCOPE';END IF;
 IF coalesce(p_sale->>'original_bill_number','') LIKE 'OLDPOS:%' AND NOT EXISTS(SELECT 1 FROM public.app_users WHERE id=p_author AND (role::text='admin' OR role_slug='admin')) THEN RAISE EXCEPTION 'FIN62_LIVE_ADMIN_REQUIRED';END IF;
 request:=coalesce(nullif(p_sale->>'client_transaction_id',''),sid::text);
 digest:=encode(sha256(convert_to(jsonb_build_array(p_author,p_branch,p_terminal,p_sale,p_items,p_payments,p_movements,p_member,p_exchange_bill)::text,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended('fin62-live-sale:'||sid,0));
 IF shift IS NOT NULL THEN PERFORM pg_advisory_xact_lock(hashtextextended('pos-sync-shift:'||shift,0));PERFORM 1 FROM public.shifts WHERE id=shift AND store_id=p_branch FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'FIN62_LIVE_SHIFT_SCOPE';END IF;END IF;
 SELECT * INTO prior FROM fin62_live_preparation.receipts WHERE action='SALE' AND sale_id=sid AND request_key=request;
 IF FOUND THEN IF prior.request_hash<>digest THEN RAISE EXCEPTION 'FIN62_LIVE_REPLAY_MISMATCH';END IF;RETURN prior.result;END IF;
 SELECT to_jsonb(s) INTO before_row FROM public.sales s WHERE id=sid FOR UPDATE;
 IF before_row IS NOT NULL AND ROW(before_row->>'store_id',before_row->>'shift_id') IS DISTINCT FROM ROW(p_branch,shift::text) THEN RAISE EXCEPTION 'FIN62_LIVE_SALE_SCOPE';END IF;
 org:=fin62_live_preparation.organization(p_branch,shift);
 IF before_row IS NULL THEN
  INSERT INTO fin62_history_preparation.sale_birth_claims(sale_id,organization_id,branch_id,terminal_id,shift_id,operation_id) VALUES(sid,org,p_branch,p_terminal,shift,op);
 END IF;
 INSERT INTO fin62_history_preparation.live_context VALUES(pg_backend_pid(),pg_current_xact_id(),p_branch,shift,sid,p_author,'SALE');
 result:=public.pos_sale_commit(p_sale,p_items,p_payments,p_movements,p_member,p_exchange_bill);
 SELECT to_jsonb(s) INTO STRICT after_row FROM public.sales s WHERE id=sid AND store_id=p_branch;
 INSERT INTO fin62_live_preparation.receipts VALUES(op,'SALE',sid,p_branch,shift,org,p_terminal,p_author,request,digest,before_row,after_row,result,now());
 DELETE FROM fin62_history_preparation.live_context WHERE pid=pg_backend_pid() AND xid=pg_current_xact_id();
 RETURN result;
END $$;
CREATE FUNCTION public.pos_live_financial_refund(p_author uuid,p_branch text,p_terminal text,p_sale_id uuid,p_lines jsonb,p_client_refund_id text,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE shift uuid;op uuid:=gen_random_uuid();request text;digest text;before_row jsonb;after_row jsonb;result jsonb;prior fin62_live_preparation.receipts%ROWTYPE;
BEGIN
 PERFORM fin62_live_preparation.authorize(p_author,p_branch,p_terminal,'REFUND');
 request:=coalesce(nullif(btrim(p_client_refund_id),''),p_sale_id::text);
 digest:=encode(sha256(convert_to(jsonb_build_array(p_author,p_branch,p_terminal,p_sale_id,p_lines,p_client_refund_id,p_reason)::text,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended('fin62-live-sale:'||p_sale_id,0));
 SELECT nullif(shift_id,'')::uuid INTO shift FROM public.sales WHERE id=p_sale_id AND store_id=p_branch;
 IF NOT FOUND THEN RAISE EXCEPTION 'FIN62_LIVE_SALE_SCOPE';END IF;
 IF shift IS NOT NULL THEN PERFORM pg_advisory_xact_lock(hashtextextended('pos-sync-shift:'||shift,0));PERFORM 1 FROM public.shifts WHERE id=shift AND store_id=p_branch FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'FIN62_LIVE_SHIFT_SCOPE';END IF;END IF;
 SELECT * INTO prior FROM fin62_live_preparation.receipts WHERE action='REFUND' AND sale_id=p_sale_id AND request_key=request;
 IF FOUND THEN IF prior.request_hash<>digest THEN RAISE EXCEPTION 'FIN62_LIVE_REPLAY_MISMATCH';END IF;RETURN prior.result;END IF;
 SELECT to_jsonb(s) INTO STRICT before_row FROM public.sales s WHERE id=p_sale_id AND store_id=p_branch FOR UPDATE;
 IF before_row->>'shift_id' IS DISTINCT FROM shift::text THEN RAISE EXCEPTION 'FIN62_LIVE_SALE_SCOPE';END IF;
 INSERT INTO fin62_history_preparation.live_context VALUES(pg_backend_pid(),pg_current_xact_id(),p_branch,shift,p_sale_id,p_author,'REFUND');
 result:=public.sale_refund(p_sale_id,p_lines,p_client_refund_id,p_reason,p_branch);
 SELECT to_jsonb(s) INTO STRICT after_row FROM public.sales s WHERE id=p_sale_id AND store_id=p_branch;
 INSERT INTO fin62_live_preparation.receipts VALUES(op,'REFUND',p_sale_id,p_branch,shift,fin62_live_preparation.organization(p_branch,shift),p_terminal,p_author,request,digest,before_row,after_row,result,now());
 DELETE FROM fin62_history_preparation.live_context WHERE pid=pg_backend_pid() AND xid=pg_current_xact_id();
 RETURN result;
END $$;
CREATE FUNCTION fin62_live_preparation.publication_edges(p_org text,p_branch text,p_shift uuid,p_sale uuid) RETURNS TABLE(operation_id uuid,before_fact jsonb,after_fact jsonb)
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT r.operation_id,fin62_history_preparation.row_fact(r.before_row),fin62_history_preparation.row_fact(r.after_row)
 FROM fin62_live_preparation.receipts r WHERE r.branch_id=p_branch AND r.shift_id=p_shift AND r.sale_id=p_sale AND
 (r.organization_id=p_org OR (r.organization_id IS NULL AND EXISTS(SELECT 1 FROM fin62_history_preparation.streams s WHERE s.organization_id=p_org AND s.branch_id=p_branch AND s.shift_id=p_shift))) AND
 fin62_history_preparation.row_snapshot_fact(r.before_row) IS DISTINCT FROM fin62_history_preparation.row_snapshot_fact(r.after_row);
$$;
CREATE FUNCTION fin62_live_preparation.proves_later_publication(p_org text,p_branch text,p_shift uuid,p_sale uuid,p_before jsonb,p_after jsonb) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 WITH RECURSIVE raw_steps AS(
  SELECT r.operation_id,r.before_row,r.after_row FROM fin62_live_preparation.receipts r WHERE r.branch_id=p_branch AND r.shift_id=p_shift AND r.sale_id=p_sale AND
   (r.organization_id=p_org OR (r.organization_id IS NULL AND EXISTS(SELECT 1 FROM fin62_history_preparation.streams s WHERE s.organization_id=p_org AND s.branch_id=p_branch AND s.shift_id=p_shift)))
 ),steps AS MATERIALIZED(
  SELECT operation_id,fin62_history_preparation.row_snapshot_fact(before_row) before_fact,fin62_history_preparation.row_snapshot_fact(after_row) after_fact FROM raw_steps
  WHERE fin62_history_preparation.row_snapshot_fact(before_row) IS DISTINCT FROM fin62_history_preparation.row_snapshot_fact(after_row)
 ),chain AS(
  SELECT s.*,ARRAY[s.operation_id] seen FROM steps s WHERE s.before_fact IS NOT DISTINCT FROM p_before
  UNION ALL SELECT s.*,c.seen||s.operation_id FROM chain c JOIN steps s ON NOT s.operation_id=ANY(c.seen) AND cardinality(c.seen)<2 AND s.before_fact IS NOT DISTINCT FROM c.after_fact
 ) SELECT EXISTS(SELECT 1 FROM chain WHERE after_fact IS NOT DISTINCT FROM p_after);
$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA fin62_live_preparation FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.pos_live_financial_sale(uuid,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,text),public.pos_live_financial_refund(uuid,text,text,uuid,jsonb,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pos_live_financial_sale(uuid,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,text),public.pos_live_financial_refund(uuid,text,text,uuid,jsonb,text,text) TO service_role;
-- Presence of the transport module alone never activates financial writes.
CREATE FUNCTION public.pos_live_financial_ready() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'FIN62_LIVE_SERVICE_REQUIRED';END IF;
 RETURN jsonb_build_object('ready',false,'version',2);
END $$;
REVOKE ALL ON FUNCTION public.pos_live_financial_ready() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pos_live_financial_ready() TO service_role;
COMMIT;
