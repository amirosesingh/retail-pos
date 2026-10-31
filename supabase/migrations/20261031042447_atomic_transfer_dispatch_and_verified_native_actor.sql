-- Preparation only: applying this migration requires separate exact-project approval.
-- Preserve the installed warehouse picker; add atomic request completion and a
-- service-only verified native actor, without changing JWT permission helpers.
DO $line_parent_constraint$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint k
   WHERE k.conrelid='public.stock_transfer_items'::regclass AND k.confrelid='public.stock_transfers'::regclass
     AND k.contype='f' AND k.convalidated AND NOT k.condeferrable
     AND k.conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=k.conrelid AND attname='transfer_id')]::smallint[]
     AND k.confkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=k.confrelid AND attname='id')]::smallint[]) THEN
   RAISE EXCEPTION 'Validated transfer line parent constraint required';
 END IF;
END $line_parent_constraint$;

-- Existing sync_idempotency_receipts belongs to table-upload batches, not
-- transfer RPC intent. Keep this minimal proof private and outside replication.
DO $receipt_shape$
DECLARE object_id oid := to_regclass('private.transfer_dispatch_receipts');
BEGIN
 IF object_id IS NOT NULL AND (
   NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=object_id AND relkind='r' AND relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user))
   OR obj_description(object_id,'pg_class') IS DISTINCT FROM 'Retail POS TRF15 dispatch intent v1'
   OR (SELECT count(*) FROM pg_attribute WHERE attrelid=object_id AND attnum>0 AND NOT attisdropped)<>6
   OR EXISTS(SELECT 1 FROM (VALUES('transfer_id','uuid'),('intent','jsonb'),('actor_id','uuid'),
     ('actor_name','text'),('dispatched_at','timestamp with time zone'),('created_at','timestamp with time zone')) expected(name,type)
     LEFT JOIN pg_attribute a ON a.attrelid=object_id AND a.attname=expected.name AND a.attnum>0 AND NOT a.attisdropped
     WHERE a.attname IS NULL OR NOT a.attnotnull OR format_type(a.atttypid,a.atttypmod)<>expected.type)
   OR NOT EXISTS(SELECT 1 FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum
      WHERE d.adrelid=object_id AND a.attname='created_at' AND pg_get_expr(d.adbin,d.adrelid)='now()')
   OR NOT EXISTS(SELECT 1 FROM pg_constraint k WHERE k.conrelid=object_id AND k.contype='p'
     AND k.conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=object_id AND attname='transfer_id')]::smallint[])
 ) THEN RAISE EXCEPTION 'Unrecognized existing dispatch proof table'; END IF;
END $receipt_shape$;
CREATE TABLE IF NOT EXISTS private.transfer_dispatch_receipts(
 transfer_id uuid PRIMARY KEY,
 intent jsonb NOT NULL,
 actor_id uuid NOT NULL,
 actor_name text NOT NULL,
 dispatched_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE private.transfer_dispatch_receipts IS 'Retail POS TRF15 dispatch intent v1';
ALTER TABLE private.transfer_dispatch_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.transfer_dispatch_receipts FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION private.transfer_dispatch_receipt_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $fn$
BEGIN RAISE EXCEPTION 'Dispatch receipts are append-only' USING ERRCODE='insufficient_privilege'; END $fn$;
REVOKE ALL ON FUNCTION private.transfer_dispatch_receipt_immutable() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS transfer_dispatch_receipt_immutable ON private.transfer_dispatch_receipts;
CREATE TRIGGER transfer_dispatch_receipt_immutable BEFORE UPDATE OR DELETE ON private.transfer_dispatch_receipts
 FOR EACH ROW EXECUTE FUNCTION private.transfer_dispatch_receipt_immutable();

CREATE OR REPLACE FUNCTION private.transfer_dispatch_intent(p_transfer_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
 SELECT jsonb_build_object('transfer_id',c.id,'kind',c.kind,'from_store_id',c.from_store_id,'to_store_id',c.to_store_id,
   'source_request_id',c.source_request_id,'approved_by',c.approved_by,'approved_at',c.approved_at,
   'dispatched_by',c.dispatched_by,'dispatched_at',c.dispatched_at,
   'lines',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',i.id,'product_id',i.product_id,'quantity',i.quantity,
     'quantity_approved',i.quantity_approved,'quantity_dispatched',i.quantity_dispatched) ORDER BY i.id)
     FROM public.stock_transfer_items i WHERE i.transfer_id=c.id),'[]'::jsonb),
   'request',CASE WHEN r.id IS NULL THEN NULL ELSE jsonb_build_object('id',r.id,'kind',r.kind,
     'from_store_id',r.from_store_id,'to_store_id',r.to_store_id,
     'lines',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',i.id,'product_id',i.product_id,'quantity',i.quantity,
       'quantity_approved',i.quantity_approved) ORDER BY i.id)
       FROM public.stock_transfer_items i WHERE i.transfer_id=r.id),'[]'::jsonb)) END)
 FROM public.stock_transfers c LEFT JOIN public.stock_transfers r ON r.id=c.source_request_id WHERE c.id=p_transfer_id
$fn$;
REVOKE ALL ON FUNCTION private.transfer_dispatch_intent(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION private.native_transfer_dispatcher(p_transfer_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
 SELECT a.id FROM public.app_users a
 WHERE auth.role()='service_role'
   AND current_setting('pos.native_dispatch_transfer',true)=p_transfer_id::text
   AND a.user_id=current_setting('pos.native_dispatch_staff',true)
   AND a.is_active
   AND (a.role::text='admin' OR COALESCE(a.role_slug,'')='admin'
        OR (a.permissions->'can_create_transfer'='true'::jsonb
          AND EXISTS(SELECT 1 FROM unnest(ARRAY['requests','transfers','approvals','verifications']) page
            WHERE a.permissions->('page:'||page) IS DISTINCT FROM 'false'::jsonb)))
 LIMIT 1
$fn$;
REVOKE ALL ON FUNCTION private.native_transfer_dispatcher(uuid) FROM PUBLIC,anon,authenticated,service_role;

-- Copy rather than rewrite the existing picking transaction. Abort on an
-- unrecognized installed implementation; never silently replace later changes.
DO $preserve_picker$
DECLARE definition text;
 guard text := 'IF NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION ''Only staff can dispatch a transfer''; END IF;';
 replacement text := 'IF NOT public.is_staff(auth.uid()) AND private.native_transfer_dispatcher(p_transfer_id) IS NULL THEN RAISE EXCEPTION ''Only staff can dispatch a transfer''; END IF;';
BEGIN
 IF to_regprocedure('private.stock_transfer_dispatch_stock_only(uuid,text,jsonb)') IS NULL THEN
   SELECT pg_get_functiondef('private.stock_transfer_dispatch(uuid,text,jsonb)'::regprocedure) INTO definition;
   IF position(guard IN definition)=0
      OR position('Short by % of % at the sending warehouse' IN definition)=0
      OR position('quantity_dispatched=v_qty' IN definition)=0
      OR position('stock_quantity=GREATEST(stock_quantity-v_qty,0)' IN definition)=0 THEN
     RAISE EXCEPTION 'Expected installed warehouse dispatch implementation not found';
   END IF;
   definition := replace(definition,'FUNCTION private.stock_transfer_dispatch(', 'FUNCTION private.stock_transfer_dispatch_stock_only(');
   EXECUTE replace(definition,guard,replacement);
 ELSE
   SELECT pg_get_functiondef('private.stock_transfer_dispatch_stock_only(uuid,text,jsonb)'::regprocedure) INTO definition;
   IF position(replacement IN definition)=0 THEN RAISE EXCEPTION 'Unexpected preserved warehouse picker'; END IF;
 END IF;
END $preserve_picker$;
REVOKE ALL ON FUNCTION private.stock_transfer_dispatch_stock_only(uuid,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;

-- Validate the existing one-request/one-fulfilment document relationship. The
-- request retains original quantities; partial and zero sends close it as before.
CREATE OR REPLACE FUNCTION private.transfer_dispatch_request_valid(p_child uuid,p_request uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
 SELECT EXISTS(
   SELECT 1 FROM public.stock_transfers c JOIN public.stock_transfers r ON r.id=c.source_request_id
   WHERE c.id=p_child AND r.id=p_request AND c.id<>r.id
     AND c.kind='transfer' AND r.kind='request'
     AND c.from_store_id=r.from_store_id AND c.to_store_id=r.to_store_id
     AND NOT EXISTS(
       SELECT 1 FROM (SELECT i.product_id,SUM(i.quantity) quantity
         FROM public.stock_transfer_items i WHERE i.transfer_id=c.id GROUP BY i.product_id) ci
       LEFT JOIN (SELECT i.product_id,SUM(COALESCE(i.quantity_approved,i.quantity)) quantity
         FROM public.stock_transfer_items i WHERE i.transfer_id=r.id GROUP BY i.product_id) ri
         ON ri.product_id=ci.product_id
       WHERE ri.product_id IS NULL OR ci.quantity>ri.quantity OR ci.quantity<0)
     AND EXISTS(SELECT 1 FROM public.stock_transfer_items WHERE transfer_id=c.id)
     AND NOT EXISTS(SELECT 1 FROM public.stock_transfers other
       WHERE other.source_request_id=r.id AND other.id<>c.id AND other.dispatched_at IS NOT NULL
         AND other.status NOT IN('cancelled','rejected'))
 )
$fn$;
REVOKE ALL ON FUNCTION private.transfer_dispatch_request_valid(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

-- This exception is bound to a proven, already dispatched child in this exact
-- transaction. It does not allow arbitrary approved documents to complete.
CREATE OR REPLACE FUNCTION private.transfer_dispatch_completes_request(p_old public.stock_transfers,p_new public.stock_transfers)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE c public.stock_transfers; asked bigint; sent bigint; expected text;
BEGIN
 IF p_old.kind<>'request' OR p_new.kind<>'request' OR p_old.status<>'approved' OR p_new.status<>'completed'
    OR p_old.id IS DISTINCT FROM p_new.id
    OR current_setting('pos.dispatch_request',true) IS DISTINCT FROM p_old.id::text
    OR NULLIF(current_setting('pos.dispatch_child',true),'') IS NULL
    OR (to_jsonb(p_new)-ARRAY['status','closed_at','fulfilment','updated_at','row_version'])
       IS DISTINCT FROM (to_jsonb(p_old)-ARRAY['status','closed_at','fulfilment','updated_at','row_version']) THEN
   RETURN false;
 END IF;
 SELECT * INTO c FROM public.stock_transfers WHERE id::text=current_setting('pos.dispatch_child',true);
 IF NOT FOUND OR c.status NOT IN('dispatched','received','verified','completed','completed_with_discrepancy')
    OR c.dispatched_at IS NULL OR p_new.closed_at IS DISTINCT FROM c.dispatched_at
    OR NOT private.transfer_dispatch_request_valid(c.id,p_old.id)
    OR NOT ((public.has_perm('can_create_transfer') AND public.user_has_store_access(c.from_store_id))
            OR private.native_transfer_dispatcher(c.id) IS NOT NULL) THEN RETURN false; END IF;
 SELECT COALESCE(SUM(quantity),0) INTO asked FROM public.stock_transfer_items WHERE transfer_id=p_old.id;
 SELECT COALESCE(SUM(COALESCE(quantity_dispatched,0)),0) INTO sent FROM public.stock_transfer_items WHERE transfer_id=c.id;
 expected := CASE WHEN sent=0 THEN 'none' WHEN sent>=asked THEN 'full' ELSE 'partial' END;
 RETURN p_new.fulfilment IS NOT DISTINCT FROM expected;
END $fn$;
REVOKE ALL ON FUNCTION private.transfer_dispatch_completes_request(public.stock_transfers,public.stock_transfers) FROM PUBLIC,anon,authenticated,service_role;

DO $request_lifecycle$
DECLARE definition text; anchor text := '  IF OLD.status = NEW.status THEN RETURN NEW; END IF;';
 addition text := '
  IF private.transfer_dispatch_completes_request(OLD,NEW) THEN RETURN NEW; END IF;
';
BEGIN
 SELECT pg_get_functiondef('public.stock_transfers_enforce_lifecycle()'::regprocedure) INTO definition;
 IF position('private.transfer_dispatch_completes_request(OLD,NEW)' IN definition)=0 THEN
   IF position(anchor IN definition)=0 THEN
     anchor := '  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;';
   END IF;
   IF position(anchor IN definition)=0 THEN RAISE EXCEPTION 'Expected transfer lifecycle guard not found'; END IF;
   EXECUTE replace(definition,anchor,addition||anchor);
 END IF;
END $request_lifecycle$;

-- Attribute only this proven paperwork completion to the saved dispatcher.
-- It is not physical goods verification; verified_by remains untouched.
DO $request_history$
DECLARE definition text; anchor text := 'WHEN ''completed'' THEN NEW.verified_by';
 replacement text := 'WHEN ''completed'' THEN CASE WHEN TG_OP=''UPDATE'' AND NEW.kind=''request''
   AND private.transfer_dispatch_completes_request(OLD,NEW) THEN
     (SELECT child.dispatched_by FROM public.stock_transfers child
      WHERE child.id::text=current_setting(''pos.dispatch_child'',true))
   ELSE NEW.verified_by END';
BEGIN
 SELECT pg_get_functiondef('public.record_stock_transfer_status_history()'::regprocedure) INTO definition;
 IF position('private.transfer_dispatch_completes_request(OLD,NEW)' IN definition)=0 THEN
   IF position(anchor IN definition)=0 THEN RAISE EXCEPTION 'Expected transfer history attribution not found'; END IF;
   EXECUTE replace(definition,anchor,replacement);
 END IF;
END $request_history$;

CREATE OR REPLACE FUNCTION private.stock_transfer_dispatch_atomic_core(p_transfer_id uuid,p_dispatched_by text,p_lines jsonb,p_strict_lines boolean DEFAULT false)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE c public.stock_transfers; r public.stock_transfers; request_id uuid; actor text; actor_id uuid;
 receipt private.transfer_dispatch_receipts;
 replayed boolean; asked bigint; sent bigint; expected text;
 previous_request text := current_setting('pos.dispatch_request',true);
 previous_child text := current_setting('pos.dispatch_child',true);
BEGIN
 IF NOT public.is_staff(auth.uid()) AND private.native_transfer_dispatcher(p_transfer_id) IS NULL THEN
   RAISE EXCEPTION 'Active dispatch staff required' USING ERRCODE='insufficient_privilege';
 END IF;
 -- Parent first serializes competing fulfilments without locking every sibling.
 SELECT source_request_id INTO request_id FROM public.stock_transfers WHERE id=p_transfer_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'TRANSFER_NOT_FOUND_OR_UNAVAILABLE'; END IF;
 IF request_id IS NOT NULL THEN
   SELECT * INTO r FROM public.stock_transfers WHERE id=request_id FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'TRANSFER_REQUEST_INVALID' USING ERRCODE='check_violation'; END IF;
 END IF;
 SELECT * INTO c FROM public.stock_transfers WHERE id=p_transfer_id FOR UPDATE;
 IF NOT FOUND OR c.kind<>'transfer' OR c.source_request_id IS DISTINCT FROM request_id THEN
   RAISE EXCEPTION 'TRANSFER_REQUEST_INVALID' USING ERRCODE='check_violation';
 END IF;
 PERFORM i.id FROM public.stock_transfer_items i
   WHERE i.transfer_id=c.id OR i.transfer_id=request_id
   ORDER BY i.transfer_id,i.product_id,i.id FOR UPDATE;
 IF private.native_transfer_dispatcher(c.id) IS NOT NULL THEN
   IF current_setting('pos.native_dispatch_branch',true) IS DISTINCT FROM c.from_store_id THEN
     RAISE EXCEPTION 'You cannot dispatch transfers for this sending location' USING ERRCODE='insufficient_privilege';
   END IF;
 ELSIF NOT public.has_perm('can_create_transfer') OR NOT public.user_has_store_access(c.from_store_id) THEN
   RAISE EXCEPTION 'You cannot dispatch transfers for this sending location' USING ERRCODE='insufficient_privilege';
 END IF;
 IF request_id IS NOT NULL AND NOT private.transfer_dispatch_request_valid(c.id,r.id) THEN
   RAISE EXCEPTION 'TRANSFER_REQUEST_INVALID' USING ERRCODE='check_violation';
 END IF;
 IF p_strict_lines AND jsonb_typeof(p_lines)='array' THEN
   SELECT COALESCE(jsonb_agg(l||jsonb_build_object('product_id',lower(l->>'product_id'))),'[]'::jsonb)
    INTO p_lines FROM jsonb_array_elements(p_lines) l;
 END IF;
 IF EXISTS(SELECT 1 FROM public.stock_transfer_items WHERE transfer_id=c.id GROUP BY product_id HAVING COUNT(*)>1)
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_lines,'[]'::jsonb)) l GROUP BY l->>'product_id' HAVING COUNT(*)>1) THEN
   RAISE EXCEPTION 'TRANSFER_DISPATCH_CONFLICT' USING ERRCODE='check_violation';
 END IF;
 IF p_strict_lines AND (
   jsonb_typeof(p_lines) IS DISTINCT FROM 'array'
   OR jsonb_array_length(p_lines)<>(SELECT COUNT(*) FROM public.stock_transfer_items WHERE transfer_id=c.id)
   OR EXISTS(SELECT 1 FROM public.stock_transfer_items i WHERE i.transfer_id=c.id AND NOT EXISTS(
     SELECT 1 FROM jsonb_array_elements(p_lines) l WHERE l->>'product_id'=i.product_id::text
       AND jsonb_typeof(l->'qty')='number' AND (l->>'qty')::numeric=trunc((l->>'qty')::numeric)
       AND (l->>'qty')::numeric BETWEEN 0 AND COALESCE(i.quantity_approved,i.quantity)))
 ) THEN RAISE EXCEPTION 'TRANSFER_DISPATCH_CONFLICT' USING ERRCODE='check_violation'; END IF;
 SELECT * INTO receipt FROM private.transfer_dispatch_receipts WHERE transfer_id=c.id;
 replayed := c.dispatched_at IS NOT NULL;
 IF replayed THEN
   IF receipt.transfer_id IS NULL OR receipt.intent IS DISTINCT FROM private.transfer_dispatch_intent(c.id) THEN
     RAISE EXCEPTION 'TRANSFER_DISPATCH_CONFLICT' USING ERRCODE='check_violation';
   END IF;
   IF c.status NOT IN('dispatched','received','verified','completed','completed_with_discrepancy') OR EXISTS(
     SELECT 1 FROM public.stock_transfer_items i WHERE i.transfer_id=c.id
       AND i.quantity_dispatched IS DISTINCT FROM GREATEST(LEAST(COALESCE(
         (SELECT (l->>'qty')::int FROM jsonb_array_elements(COALESCE(p_lines,'[]'::jsonb)) l WHERE l->>'product_id'=i.product_id::text LIMIT 1),
         i.quantity_approved,i.quantity),COALESCE(i.quantity_approved,i.quantity)),0)) THEN
     RAISE EXCEPTION 'TRANSFER_DISPATCH_CONFLICT' USING ERRCODE='check_violation';
   END IF;
 ELSE
   IF receipt.transfer_id IS NOT NULL OR c.status<>'approved' THEN RAISE EXCEPTION 'TRANSFER_DISPATCH_CONFLICT' USING ERRCODE='check_violation'; END IF;
   IF request_id IS NOT NULL AND r.status<>'approved' THEN
     RAISE EXCEPTION 'TRANSFER_REQUEST_INVALID' USING ERRCODE='check_violation';
   END IF;
   SELECT a.id,COALESCE(NULLIF(btrim(a.full_name),''),a.user_id) INTO actor_id,actor FROM public.app_users a
    WHERE a.id=COALESCE(private.native_transfer_dispatcher(c.id),(SELECT u.id FROM public.current_app_user() u LIMIT 1));
   IF actor IS NULL THEN RAISE EXCEPTION 'Active dispatch staff required' USING ERRCODE='insufficient_privilege'; END IF;
   PERFORM private.stock_transfer_dispatch_stock_only(c.id,actor,p_lines);
   SELECT * INTO c FROM public.stock_transfers WHERE id=c.id;
 END IF;
 IF request_id IS NOT NULL THEN
   SELECT COALESCE(SUM(quantity),0) INTO asked FROM public.stock_transfer_items WHERE transfer_id=r.id;
   SELECT COALESCE(SUM(COALESCE(quantity_dispatched,0)),0) INTO sent FROM public.stock_transfer_items WHERE transfer_id=c.id;
   expected := CASE WHEN sent=0 THEN 'none' WHEN sent>=asked THEN 'full' ELSE 'partial' END;
   IF r.status='approved' THEN
     PERFORM set_config('pos.dispatch_request',r.id::text,true);
     PERFORM set_config('pos.dispatch_child',c.id::text,true);
     UPDATE public.stock_transfers SET status='completed',closed_at=c.dispatched_at,fulfilment=expected WHERE id=r.id;
     IF NOT FOUND THEN RAISE EXCEPTION 'TRANSFER_REQUEST_INVALID' USING ERRCODE='check_violation'; END IF;
     SELECT * INTO r FROM public.stock_transfers WHERE id=r.id;
     IF r.status<>'completed' OR r.fulfilment IS DISTINCT FROM expected THEN
       RAISE EXCEPTION 'TRANSFER_REQUEST_INVALID' USING ERRCODE='check_violation';
     END IF;
   ELSIF r.status<>'completed' OR r.fulfilment IS DISTINCT FROM expected THEN
     RAISE EXCEPTION 'TRANSFER_REQUEST_INVALID' USING ERRCODE='check_violation';
   END IF;
 END IF;
 IF NOT replayed THEN
   INSERT INTO private.transfer_dispatch_receipts(transfer_id,intent,actor_id,actor_name,dispatched_at)
    VALUES(c.id,private.transfer_dispatch_intent(c.id),actor_id,actor,c.dispatched_at::timestamptz);
 END IF;
 PERFORM set_config('pos.dispatch_request',COALESCE(previous_request,''),true);
 PERFORM set_config('pos.dispatch_child',COALESCE(previous_child,''),true);
 RETURN replayed;
EXCEPTION WHEN OTHERS THEN
 PERFORM set_config('pos.dispatch_request',COALESCE(previous_request,''),true);
 PERFORM set_config('pos.dispatch_child',COALESCE(previous_child,''),true);
 RAISE;
END $fn$;
REVOKE ALL ON FUNCTION private.stock_transfer_dispatch_atomic_core(uuid,text,jsonb,boolean) FROM PUBLIC,anon,authenticated,service_role;

-- Keep the old void contract and its existing public permission/scope wrapper.
CREATE OR REPLACE FUNCTION private.stock_transfer_dispatch(p_transfer_id uuid,p_dispatched_by text DEFAULT NULL,p_lines jsonb DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
BEGIN PERFORM private.stock_transfer_dispatch_atomic_core(p_transfer_id,p_dispatched_by,p_lines); END $fn$;

CREATE OR REPLACE FUNCTION private.transfer_dispatch_proof(p_transfer_id uuid,p_replayed boolean)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
 SELECT jsonb_build_object('version',1,'transfer_id',c.id,'from_store_id',c.from_store_id,'to_store_id',c.to_store_id,
   'status',c.status,'dispatched_at',c.dispatched_at::timestamptz,'dispatched_by',c.dispatched_by,'source_request_id',c.source_request_id,
   'request_closed',COALESCE(r.status='completed',false),'request_closed_at',r.closed_at::timestamptz,'fulfilment',c.fulfilment,'request_fulfilment',r.fulfilment,
   'replayed',p_replayed,'lines',COALESCE((SELECT jsonb_agg(jsonb_build_object('product_id',i.product_id,
     'qty',COALESCE(i.quantity_dispatched,0),'source_stock',COALESCE((p.stock_by_store->>c.from_store_id)::numeric,0)) ORDER BY i.id)
     FROM public.stock_transfer_items i LEFT JOIN public.products p ON p.id=i.product_id WHERE i.transfer_id=c.id),'[]'::jsonb))
 FROM public.stock_transfers c LEFT JOIN public.stock_transfers r ON r.id=c.source_request_id WHERE c.id=p_transfer_id
$fn$;
REVOKE ALL ON FUNCTION private.transfer_dispatch_proof(uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;

-- New clients require this proof-bearing contract rather than assuming that
-- an older void RPC also completed the linked request.
CREATE OR REPLACE FUNCTION public.stock_transfer_dispatch_atomic(p_transfer_id uuid,p_dispatched_by text DEFAULT NULL,p_lines jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE c public.stock_transfers; replayed boolean;
BEGIN
 SELECT * INTO c FROM public.stock_transfers WHERE id=p_transfer_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'TRANSFER_NOT_FOUND_OR_UNAVAILABLE'; END IF;
 IF NOT public.has_perm('can_create_transfer') OR NOT public.user_has_store_access(c.from_store_id) THEN
   RAISE EXCEPTION 'You cannot dispatch transfers for this sending location' USING ERRCODE='insufficient_privilege';
 END IF;
 replayed := private.stock_transfer_dispatch_atomic_core(p_transfer_id,p_dispatched_by,p_lines,true);
 RETURN private.transfer_dispatch_proof(p_transfer_id,replayed);
END $fn$;
REVOKE ALL ON FUNCTION public.stock_transfer_dispatch_atomic(uuid,text,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.stock_transfer_dispatch_atomic(uuid,text,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.stock_transfer_dispatch_atomic_for_staff(p_transfer_id uuid,p_staff_user_id text,p_bound_store_id text DEFAULT NULL,p_lines jsonb DEFAULT NULL,p_strict_lines boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE a public.app_users; c public.stock_transfers; actor text; replayed boolean;
 previous_staff text := current_setting('pos.native_dispatch_staff',true);
 previous_transfer text := current_setting('pos.native_dispatch_transfer',true);
 previous_branch text := current_setting('pos.native_dispatch_branch',true);
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN
   RAISE EXCEPTION 'Verified native staff session required' USING ERRCODE='insufficient_privilege';
 END IF;
 SELECT * INTO a FROM public.app_users WHERE user_id=p_staff_user_id FOR SHARE;
 IF a.id IS NULL OR NOT a.is_active THEN
   RAISE EXCEPTION 'Active transfer dispatch permission required' USING ERRCODE='insufficient_privilege';
 END IF;
 SELECT * INTO c FROM public.stock_transfers WHERE id=p_transfer_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'TRANSFER_NOT_FOUND_OR_UNAVAILABLE'; END IF;
 IF (NULLIF(p_bound_store_id,'') IS NOT NULL AND p_bound_store_id<>c.from_store_id)
    OR (a.store_id IS NOT NULL AND a.store_id<>c.from_store_id)
    OR (NULLIF(p_bound_store_id,'') IS NULL AND a.store_id IS NULL
      AND a.role::text NOT IN('admin','manager') AND COALESCE(a.role_slug,'') NOT IN('admin','supervisor')) THEN
   RAISE EXCEPTION 'You cannot dispatch transfers for this sending location' USING ERRCODE='insufficient_privilege';
 END IF;
 actor := COALESCE(NULLIF(btrim(a.full_name),''),a.user_id);
 PERFORM set_config('pos.native_dispatch_staff',a.user_id,true);
 PERFORM set_config('pos.native_dispatch_transfer',c.id::text,true);
 PERFORM set_config('pos.native_dispatch_branch',c.from_store_id,true);
 IF private.native_transfer_dispatcher(c.id) IS NULL THEN
   RAISE EXCEPTION 'Active transfer dispatch permission required' USING ERRCODE='insufficient_privilege';
 END IF;
 replayed := private.stock_transfer_dispatch_atomic_core(c.id,actor,p_lines,COALESCE(p_strict_lines,true));
 PERFORM set_config('pos.native_dispatch_staff',COALESCE(previous_staff,''),true);
 PERFORM set_config('pos.native_dispatch_transfer',COALESCE(previous_transfer,''),true);
 PERFORM set_config('pos.native_dispatch_branch',COALESCE(previous_branch,''),true);
 RETURN private.transfer_dispatch_proof(c.id,replayed);
EXCEPTION WHEN OTHERS THEN
 PERFORM set_config('pos.native_dispatch_staff',COALESCE(previous_staff,''),true);
 PERFORM set_config('pos.native_dispatch_transfer',COALESCE(previous_transfer,''),true);
 PERFORM set_config('pos.native_dispatch_branch',COALESCE(previous_branch,''),true);
 RAISE;
END $fn$;
REVOKE ALL ON FUNCTION public.stock_transfer_dispatch_atomic_for_staff(uuid,text,text,jsonb,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.stock_transfer_dispatch_atomic_for_staff(uuid,text,text,jsonb,boolean) TO service_role;

NOTIFY pgrst,'reload schema';
