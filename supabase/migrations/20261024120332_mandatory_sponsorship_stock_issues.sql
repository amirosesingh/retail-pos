BEGIN;
CREATE TABLE IF NOT EXISTS public.sponsorship_issues (
 id uuid PRIMARY KEY,reference text NOT NULL UNIQUE,store_id text NOT NULL REFERENCES public.stores(id),store_name text NOT NULL,
 recipient_name text NOT NULL,recipient_contact text NOT NULL DEFAULT '',purpose text NOT NULL,
 lines jsonb NOT NULL,total_value numeric NOT NULL CHECK(total_value>=0),document_hash text NOT NULL,input_hash text NOT NULL,
 created_by text NOT NULL,created_by_name text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 status text NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','issued')),
 given_at timestamptz,given_by text,given_by_name text,received_by text,approved_by_name text,
 CHECK((status='issued')=(given_at IS NOT NULL))
);
ALTER TABLE public.sponsorship_issues ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sponsorship_issues FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.sponsorship_issues TO service_role;
CREATE INDEX IF NOT EXISTS sponsorship_issues_branch_created ON public.sponsorship_issues(store_id,created_at DESC,id);

CREATE OR REPLACE FUNCTION public.prepare_sponsorship(p_id uuid,p_store text,p_recipient text,p_contact text,p_purpose text,p_lines jsonb,p_actor text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE actor public.app_users%ROWTYPE; existing public.sponsorship_issues%ROWTYPE; product public.products%ROWTYPE;
 item jsonb; snapshot jsonb:='[]'; total numeric:=0; quantity integer; source_name text; digest text;
BEGIN
 SELECT * INTO actor FROM public.app_users WHERE user_id=p_actor AND is_active LIMIT 1;
 IF actor.id IS NULL OR (actor.role::text='admin' OR (actor.permissions->>'can_create_sponsorship'='true' AND COALESCE(actor.permissions->>'page:sponsorship','true')<>'false')) IS NOT TRUE THEN RAISE EXCEPTION 'Sponsorship creation permission is required'; END IF;
 IF actor.store_id IS NOT NULL AND actor.store_id<>p_store THEN RAISE EXCEPTION 'Sponsorship source is outside your branch'; END IF;
 SELECT name INTO source_name FROM public.stores WHERE id=p_store AND is_active AND archived_at IS NULL;
 IF source_name IS NULL THEN RAISE EXCEPTION 'Choose an active shop or warehouse'; END IF;
 IF p_recipient IS NULL OR p_contact IS NULL OR p_purpose IS NULL OR length(btrim(p_recipient)) NOT BETWEEN 2 AND 160 OR length(p_contact)>160 OR length(btrim(p_purpose)) NOT BETWEEN 3 AND 400
 OR jsonb_typeof(p_lines) IS DISTINCT FROM 'array' OR jsonb_array_length(p_lines) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid sponsorship details'; END IF;
 IF (SELECT count(DISTINCT value->>'productId') FROM jsonb_array_elements(p_lines))<>jsonb_array_length(p_lines) THEN RAISE EXCEPTION 'Choose each product once'; END IF;
 SELECT jsonb_agg(value ORDER BY value->>'productId') INTO p_lines FROM jsonb_array_elements(p_lines);
 digest:=md5(jsonb_build_object('store',p_store,'recipient',btrim(p_recipient),'contact',p_contact,'purpose',btrim(p_purpose),'lines',p_lines)::text);
 PERFORM pg_advisory_xact_lock(hashtextextended('sponsorship:'||p_id::text,0));
 SELECT * INTO existing FROM public.sponsorship_issues WHERE id=p_id;
 IF FOUND THEN
   IF existing.created_by<>p_actor OR existing.input_hash<>digest THEN RAISE EXCEPTION 'This sponsorship reference already contains different details'; END IF;
   RETURN to_jsonb(existing);
 END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_lines) ORDER BY value->>'productId' LOOP
   quantity:=(item->>'quantity')::integer;
   IF quantity IS NULL OR quantity NOT BETWEEN 1 AND 100000 THEN RAISE EXCEPTION 'Invalid sponsorship quantity'; END IF;
   SELECT * INTO product FROM public.products WHERE id=(item->>'productId')::uuid AND NOT is_archived;
   IF product.id IS NULL THEN RAISE EXCEPTION 'A selected product is unavailable'; END IF;
   IF product.owner_store_id IS NOT NULL AND product.owner_store_id<>p_store THEN RAISE EXCEPTION 'A selected product belongs to another private catalogue'; END IF;
   IF COALESCE((product.stock_by_store->>p_store)::integer,0)<quantity THEN RAISE EXCEPTION 'Not enough stock to request %',product.name; END IF;
   IF product.selling_price<0 OR product.cost_price<0 THEN RAISE EXCEPTION 'A selected product has invalid prices'; END IF;
   snapshot:=snapshot||jsonb_build_array(jsonb_build_object('product_id',product.id,'name',product.name,'sku',COALESCE(product.sku,''),'barcode',product.barcode,'quantity',quantity,'unit_value',product.selling_price,'unit_cost',product.cost_price));
   total:=total+round(product.selling_price*quantity,2);
 END LOOP;
 INSERT INTO public.sponsorship_issues(id,reference,store_id,store_name,recipient_name,recipient_contact,purpose,lines,total_value,document_hash,input_hash,created_by,created_by_name)
 VALUES(p_id,'SP-'||p_id::text,p_store,source_name,btrim(p_recipient),p_contact,btrim(p_purpose),snapshot,total,
 md5(jsonb_build_object('input',digest,'lines',snapshot,'value',total)::text),digest,p_actor,actor.full_name) RETURNING * INTO existing;
 RETURN to_jsonb(existing);
END $$;
REVOKE ALL ON FUNCTION public.prepare_sponsorship(uuid,text,text,text,text,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_sponsorship(uuid,text,text,text,text,jsonb,text) TO service_role;

CREATE OR REPLACE FUNCTION public.issue_sponsorship(p_id uuid,p_actor text,p_received_by text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE actor public.app_users%ROWTYPE; approver public.app_users%ROWTYPE; document public.sponsorship_issues%ROWTYPE;
 approval public.authorization_requests%ROWTYPE; item jsonb; product public.products%ROWTYPE; quantity integer; before_stock integer; after_stock integer; movement uuid;
BEGIN
 SELECT * INTO actor FROM public.app_users WHERE user_id=p_actor AND is_active LIMIT 1;
 IF actor.id IS NULL OR (actor.role::text='admin' OR (actor.permissions->>'can_issue_sponsorship'='true' AND COALESCE(actor.permissions->>'page:sponsorship','true')<>'false')) IS NOT TRUE THEN RAISE EXCEPTION 'Sponsorship handover permission is required'; END IF;
 SELECT * INTO document FROM public.sponsorship_issues WHERE id=p_id FOR UPDATE;
 IF document.id IS NULL THEN RAISE EXCEPTION 'Sponsorship was not found'; END IF;
 IF actor.store_id IS NOT NULL AND actor.store_id<>document.store_id THEN RAISE EXCEPTION 'Sponsorship source is outside your branch'; END IF;
 IF document.status='issued' THEN RETURN to_jsonb(document); END IF;
 IF p_received_by IS NULL OR length(btrim(p_received_by)) NOT BETWEEN 2 AND 160 THEN RAISE EXCEPTION 'Record the person who received these products'; END IF;
 SELECT * INTO approval FROM public.authorization_requests WHERE id=p_id FOR UPDATE;
 IF approval.id IS NULL OR approval.action_key<>'sponsorship' OR approval.status<>'approved' OR approval.consumed_at IS NOT NULL
 OR approval.expires_at<=now() OR approval.requested_by<>document.created_by OR approval.store_id<>document.store_id
 OR approval.decided_by IS NULL OR approval.decided_by=approval.requested_by
 OR approval.payload->>'sponsorship_id' IS DISTINCT FROM p_id::text OR approval.payload->>'document_hash' IS DISTINCT FROM document.document_hash
 OR approval.requested_amount IS DISTINCT FROM document.total_value
 OR COALESCE(approval.approved_amount,approval.requested_amount) IS DISTINCT FROM document.total_value
 THEN RAISE EXCEPTION 'Every sponsorship requires a valid, separate full approval before handover'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.authorization_log WHERE request_id=p_id AND outcome='requested')
 OR NOT EXISTS(SELECT 1 FROM public.authorization_log WHERE request_id=p_id AND outcome='approved' AND authorized_by=approval.decided_by)
 THEN RAISE EXCEPTION 'Verified sponsorship approval audit is required'; END IF;
 SELECT * INTO approver FROM public.app_users WHERE user_id=approval.decided_by AND is_active LIMIT 1;
 IF approver.id IS NULL OR (approver.role::text='admin' OR (approver.permissions->>'can_approve_sponsorship'='true' AND COALESCE(approver.permissions->>'page:sponsorship','true')<>'false')) IS NOT TRUE THEN RAISE EXCEPTION 'The approving account no longer has sponsorship approval permission'; END IF;
 IF approver.permissions->>'approval_scope:configured'='true' AND
   ((approver.store_id IS NOT NULL AND approver.store_id<>document.store_id) OR
    (COALESCE(approver.permissions->>'approval_scope:all','false')<>'true' AND COALESCE(approver.permissions->>('approval_scope:branch:'||document.store_id),'false')<>'true'))
 THEN RAISE EXCEPTION 'The approving account is outside its saved approval branch scope'; END IF;
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
 UPDATE public.authorization_requests SET consumed_at=now(),updated_at=now() WHERE id=p_id;
 UPDATE public.sponsorship_issues SET status='issued',given_at=now(),given_by=p_actor,given_by_name=actor.full_name,received_by=btrim(p_received_by),approved_by_name=approval.decided_by_name WHERE id=p_id RETURNING * INTO document;
 INSERT INTO public.activity_events(event_type,severity,title,message,store_id,actor_id,actor_name,actor_role,entity_type,entity_id,amount,client_event_id)
 VALUES('sponsorship_issued','info','Sponsorship handed over',document.reference||' · '||document.recipient_name||' · Received by '||document.received_by,document.store_id,p_actor,actor.full_name,COALESCE(actor.role_slug,actor.role::text),'sponsorship',p_id::text,document.total_value,'sponsorship-issued:'||p_id::text) ON CONFLICT(client_event_id) DO NOTHING;
 RETURN to_jsonb(document);
END $$;
REVOKE ALL ON FUNCTION public.issue_sponsorship(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_sponsorship(uuid,text,text) TO service_role;
CREATE OR REPLACE FUNCTION public.guard_mandatory_sponsorship_rule()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.action_key='sponsorship' AND (NEW.mode<>'request' OR NOT NEW.is_enabled OR NOT NEW.require_reason OR NEW.threshold IS NOT NULL) THEN RAISE EXCEPTION 'Sponsorship always requires approval and a reason, without a bypass threshold'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_mandatory_sponsorship_rule() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS guard_mandatory_sponsorship_rule ON public.authorization_actions;
CREATE TRIGGER guard_mandatory_sponsorship_rule BEFORE INSERT OR UPDATE ON public.authorization_actions FOR EACH ROW EXECUTE FUNCTION public.guard_mandatory_sponsorship_rule();
-- Aggregate-only reporting; names and contacts stay behind sponsorship permission.
CREATE INDEX IF NOT EXISTS sponsorship_issues_branch_given ON public.sponsorship_issues(store_id,given_at) WHERE status='issued';
CREATE OR REPLACE FUNCTION public.sponsorship_daily_values(p_store text,p_from date,p_to date,p_zone text)
RETURNS TABLE(day text,value numeric) LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
 SELECT to_char(given_at AT TIME ZONE p_zone,'YYYY-MM-DD'),sum(total_value)
 FROM public.sponsorship_issues WHERE status='issued' AND store_id=p_store
 AND given_at >= (p_from::timestamp AT TIME ZONE p_zone) AND given_at < ((p_to+1)::timestamp AT TIME ZONE p_zone)
 GROUP BY 1 ORDER BY 1
$$;
REVOKE ALL ON FUNCTION public.sponsorship_daily_values(text,date,date,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sponsorship_daily_values(text,date,date,text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
