BEGIN;
-- Direct issue is a named-user policy, separate from ordinary page/action rights.
CREATE TABLE public.sponsorship_direct_issue_policy(id integer PRIMARY KEY CHECK(id=1),user_ids text[] NOT NULL DEFAULT '{}',row_version integer NOT NULL DEFAULT 0,updated_by text,updated_at timestamptz NOT NULL DEFAULT now());
INSERT INTO public.sponsorship_direct_issue_policy(id) VALUES(1);
ALTER TABLE public.sponsorship_direct_issue_policy ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sponsorship_direct_issue_policy FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.sponsorship_direct_issue_policy TO service_role;
ALTER TABLE public.sponsorship_issues ADD COLUMN authorization_mode text NOT NULL DEFAULT 'approval' CHECK(authorization_mode IN ('approval','direct'));
CREATE OR REPLACE FUNCTION public.save_sponsorship_direct_issuers(p_users text[],p_version integer,p_actor text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE policy public.sponsorship_direct_issue_policy%ROWTYPE;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.app_users WHERE user_id=p_actor AND is_active AND (role::text='admin' OR role_slug='admin')) THEN RAISE EXCEPTION 'Administrator access is required'; END IF;
 IF p_users IS NULL OR cardinality(p_users)>100 OR EXISTS(SELECT 1 FROM unnest(p_users) u WHERE NOT EXISTS(SELECT 1 FROM public.app_users a WHERE a.user_id=u AND a.is_active)) THEN RAISE EXCEPTION 'Select active staff accounts only'; END IF;
 SELECT * INTO policy FROM public.sponsorship_direct_issue_policy WHERE id=1 FOR UPDATE;
 IF p_version IS DISTINCT FROM policy.row_version THEN RAISE EXCEPTION 'The sponsorship direct issue policy changed; reload before saving'; END IF;
 UPDATE public.sponsorship_direct_issue_policy SET user_ids=ARRAY(SELECT DISTINCT u FROM unnest(p_users) u ORDER BY u),row_version=row_version+1,updated_by=p_actor,updated_at=now() WHERE id=1 RETURNING * INTO policy;
 RETURN to_jsonb(policy);
END $$;
REVOKE ALL ON FUNCTION public.save_sponsorship_direct_issuers(text[],integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_sponsorship_direct_issuers(text[],integer,text) TO service_role;
CREATE OR REPLACE FUNCTION public.reserve_stock_document_number(p_prefix text,p_minimum bigint,p_store_id text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_store text; v_owner text; v_saved bigint; v_last bigint; v_next bigint;
BEGIN
 IF coalesce((SELECT auth.role()),'') <> 'service_role' THEN RAISE EXCEPTION 'STOCK_NUMBER_SERVICE_REQUIRED'; END IF;
 IF p_prefix IS NULL OR p_prefix !~ '^[A-Z0-9-]{1,200}$' OR p_minimum IS NULL OR
    p_minimum < 1 OR p_minimum >= 9007199254740991
 THEN RAISE EXCEPTION 'STOCK_NUMBER_REQUEST_INVALID'; END IF;
 SELECT id INTO v_store FROM public.stores WHERE id=p_store_id OR
   (p_store_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND lower(id)=lower(p_store_id))
 ORDER BY (id=p_store_id) DESC LIMIT 1;
 IF v_store IS NULL THEN RAISE EXCEPTION 'STOCK_NUMBER_REQUEST_INVALID'; END IF;
 INSERT INTO private.stock_document_counters(prefix,store_id,next_value)
 VALUES(p_prefix,v_store,p_minimum) ON CONFLICT(prefix) DO NOTHING;
 SELECT store_id,next_value INTO v_owner,v_saved FROM private.stock_document_counters WHERE prefix=p_prefix FOR UPDATE;
 IF v_owner IS DISTINCT FROM v_store THEN RAISE EXCEPTION 'STOCK_NUMBER_BRANCH_FORBIDDEN'; END IF;
 SELECT max(CASE WHEN substring(reference FROM length(p_prefix)+2) ~ '^[0-9]{1,16}$'
   THEN substring(reference FROM length(p_prefix)+2)::bigint ELSE 0 END) INTO v_last
 FROM (SELECT reference FROM public.stock_count_drafts UNION ALL SELECT reference FROM public.purchase_orders
       UNION ALL SELECT ref AS reference FROM public.stock_transfers UNION ALL SELECT reference FROM public.sponsorship_issues) documents
 WHERE reference LIKE p_prefix||'-%';
 v_next:=greatest(p_minimum,v_saved,coalesce(v_last,0)+1);
 IF v_next>=9007199254740991 THEN RAISE EXCEPTION 'STOCK_NUMBER_LIMIT'; END IF;
 UPDATE private.stock_document_counters SET next_value=v_next+1,updated_at=now() WHERE prefix=p_prefix;
 RETURN v_next;
END;
$function$;
REVOKE ALL ON FUNCTION public.reserve_stock_document_number(text,bigint,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_stock_document_number(text,bigint,text) TO service_role;

CREATE OR REPLACE FUNCTION public.prepare_numbered_sponsorship(p_id uuid,p_store text,p_recipient text,p_contact text,p_purpose text,p_lines jsonb,p_actor text,p_number_prefix text,p_start bigint,p_padding integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE document public.sponsorship_issues%ROWTYPE; sequence bigint; prepared jsonb;
BEGIN
 prepared:=public.prepare_sponsorship(p_id,p_store,p_recipient,p_contact,p_purpose,p_lines,p_actor);
 SELECT * INTO document FROM public.sponsorship_issues WHERE id=p_id FOR UPDATE;
 IF document.reference='SP-'||p_id::text AND document.status='requested' THEN
   IF p_padding IS NULL OR p_padding NOT BETWEEN 3 AND 6 THEN RAISE EXCEPTION 'Invalid sponsorship number length'; END IF;
   sequence:=public.reserve_stock_document_number(p_number_prefix,p_start,p_store);
   UPDATE public.sponsorship_issues SET reference=p_number_prefix||'-'||lpad(sequence::text,GREATEST(p_padding,length(sequence::text)),'0') WHERE id=p_id RETURNING * INTO document;
 END IF;
 RETURN to_jsonb(document);
END $$;
REVOKE ALL ON FUNCTION public.prepare_numbered_sponsorship(uuid,text,text,text,text,jsonb,text,text,bigint,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_numbered_sponsorship(uuid,text,text,text,text,jsonb,text,text,bigint,integer) TO service_role;

CREATE OR REPLACE FUNCTION public.issue_sponsorship(p_id uuid,p_actor text,p_received_by text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE actor public.app_users%ROWTYPE; approver public.app_users%ROWTYPE; document public.sponsorship_issues%ROWTYPE;
 approval public.authorization_requests%ROWTYPE; item jsonb; product public.products%ROWTYPE; quantity integer; before_stock integer; after_stock integer; movement uuid; direct boolean; permitted_users text[];
BEGIN
 SELECT * INTO actor FROM public.app_users WHERE user_id=p_actor AND is_active LIMIT 1 FOR SHARE;
 IF actor.id IS NULL OR (actor.role::text='admin' OR (actor.permissions->>'can_issue_sponsorship'='true' AND COALESCE(actor.permissions->>'page:sponsorship','true')<>'false')) IS NOT TRUE THEN RAISE EXCEPTION 'Sponsorship handover permission is required'; END IF;
 SELECT * INTO document FROM public.sponsorship_issues WHERE id=p_id FOR UPDATE;
 IF document.id IS NULL THEN RAISE EXCEPTION 'Sponsorship was not found'; END IF;
 IF actor.store_id IS NOT NULL AND actor.store_id<>document.store_id THEN RAISE EXCEPTION 'Sponsorship source is outside your branch'; END IF;
 IF document.status='issued' THEN RETURN to_jsonb(document); END IF;
 IF p_received_by IS NULL OR length(btrim(p_received_by)) NOT BETWEEN 2 AND 160 THEN RAISE EXCEPTION 'Record the person who received these products'; END IF;
 SELECT user_ids INTO permitted_users FROM public.sponsorship_direct_issue_policy WHERE id=1 FOR SHARE;
 direct:=actor.role::text='admin' OR actor.role_slug='admin' OR p_actor=ANY(COALESCE(permitted_users,'{}'::text[]));
 IF direct IS NOT TRUE THEN
 SELECT * INTO approval FROM public.authorization_requests WHERE id=p_id FOR UPDATE;
 IF approval.id IS NULL OR approval.action_key<>'sponsorship' OR approval.status<>'approved' OR approval.consumed_at IS NOT NULL
 OR approval.expires_at<=now() OR approval.requested_by<>document.created_by OR approval.store_id<>document.store_id
 OR approval.decided_by IS NULL OR approval.decided_by=approval.requested_by
 OR approval.payload->>'sponsorship_id' IS DISTINCT FROM p_id::text OR approval.payload->>'document_hash' IS DISTINCT FROM document.document_hash
 OR approval.requested_amount IS DISTINCT FROM document.total_value
 OR COALESCE(approval.approved_amount,approval.requested_amount) IS DISTINCT FROM document.total_value
 THEN RAISE EXCEPTION 'This sponsorship requires a valid, separate full approval before handover'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.authorization_log WHERE request_id=p_id AND outcome='requested')
 OR NOT EXISTS(SELECT 1 FROM public.authorization_log WHERE request_id=p_id AND outcome='approved' AND authorized_by=approval.decided_by)
 THEN RAISE EXCEPTION 'Verified sponsorship approval audit is required'; END IF;
 SELECT * INTO approver FROM public.app_users WHERE user_id=approval.decided_by AND is_active LIMIT 1;
 IF approver.id IS NULL OR (approver.role::text='admin' OR (approver.permissions->>'can_approve_sponsorship'='true' AND COALESCE(approver.permissions->>'page:sponsorship','true')<>'false')) IS NOT TRUE THEN RAISE EXCEPTION 'The approving account no longer has sponsorship approval permission'; END IF;
 IF approver.permissions->>'approval_scope:configured'='true' AND
   ((approver.store_id IS NOT NULL AND approver.store_id<>document.store_id) OR
    (COALESCE(approver.permissions->>'approval_scope:all','false')<>'true' AND COALESCE(approver.permissions->>('approval_scope:branch:'||document.store_id),'false')<>'true'))
 THEN RAISE EXCEPTION 'The approving account is outside its saved approval branch scope'; END IF;
 END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(document.lines) ORDER BY value->>'product_id' LOOP
   SELECT * INTO product FROM public.products WHERE id=(item->>'product_id')::uuid FOR UPDATE;
   quantity:=(item->>'quantity')::integer;
   IF product.id IS NULL OR product.is_archived THEN RAISE EXCEPTION 'A sponsorship product is unavailable'; END IF;
   before_stock:=COALESCE((product.stock_by_store->>document.store_id)::integer,0);
   IF before_stock<quantity THEN RAISE EXCEPTION 'Not enough stock to hand over %',product.name; END IF;
   movement:=md5('sponsorship:'||p_id::text||':'||product.id::text)::uuid;
   after_stock:=public.stock_apply_delta(movement,product.id,document.store_id,-quantity);
   INSERT INTO public.stock_adjustments(id,product_id,product_name,sku,barcode,store_id,reason,note,previous_stock,updated_stock,delta,cost_impact,staff_id,staff_name,role)
   VALUES(movement,product.id,product.name,product.sku,product.barcode,document.store_id,'sponsorship',document.reference||' · Recipient: '||document.recipient_name,before_stock,after_stock,-quantity,-quantity*(item->>'unit_cost')::numeric,p_actor,actor.full_name,COALESCE(actor.role_slug,actor.role::text));
   INSERT INTO public.item_activity_logs(id,product_id,product_name,sku,barcode,store_id,activity_type,reference,quantity_delta,stock_before,stock_after,unit_cost,staff_id,staff_name,role,note)
   VALUES(movement,product.id,product.name,product.sku,product.barcode,document.store_id,'adjustment',document.reference,-quantity,before_stock,after_stock,(item->>'unit_cost')::numeric,p_actor,actor.full_name,COALESCE(actor.role_slug,actor.role::text),'Sponsorship to '||document.recipient_name||' · Received by '||btrim(p_received_by));
 END LOOP;
 IF direct THEN
   UPDATE public.authorization_requests SET status='cancelled',decision_note='Completed directly by an authorized issuer',updated_at=now() WHERE id=p_id AND status='pending';
   IF FOUND THEN
     INSERT INTO public.authorization_log(action_key,mode_used,request_id,requested_by,authorized_by,authorizer_role,store_id,outcome,detail)
     VALUES('sponsorship','admin_auto',p_id,document.created_by,p_actor,COALESCE(actor.role_slug,actor.role::text),document.store_id,'cancelled',jsonb_build_object('reason','Sponsorship completed by a direct issuer'));
   END IF;
 END IF;
 UPDATE public.authorization_requests SET consumed_at=now(),updated_at=now() WHERE id=p_id;
 UPDATE public.sponsorship_issues SET status='issued',given_at=now(),given_by=p_actor,given_by_name=actor.full_name,received_by=btrim(p_received_by),authorization_mode=CASE WHEN direct THEN 'direct' ELSE 'approval' END,approved_by_name=CASE WHEN direct THEN actor.full_name||' (direct issue)' ELSE approval.decided_by_name END WHERE id=p_id RETURNING * INTO document;
 INSERT INTO public.activity_events(event_type,severity,title,message,store_id,actor_id,actor_name,actor_role,entity_type,entity_id,amount,client_event_id)
 VALUES('sponsorship_issued','info','Sponsorship handed over',document.reference||' · '||document.recipient_name||' · Received by '||document.received_by,document.store_id,p_actor,actor.full_name,COALESCE(actor.role_slug,actor.role::text),'sponsorship',p_id::text,document.total_value,'sponsorship-issued:'||p_id::text) ON CONFLICT(client_event_id) DO NOTHING;
 RETURN to_jsonb(document);
END $$;
REVOKE ALL ON FUNCTION public.issue_sponsorship(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_sponsorship(uuid,text,text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
