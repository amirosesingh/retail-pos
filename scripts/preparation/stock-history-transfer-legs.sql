-- Stock Report source preparation for the reviewed central warehouse writers.
-- Retain exact stock effects only. These records do not certify a physical
-- cutoff, publish a report movement, change stock, or acknowledge a journal.
BEGIN;

CREATE TABLE private.stock_history_transfer_legs (
 effect_id uuid PRIMARY KEY REFERENCES private.stock_history_accepted_effects(id),
 transfer_id uuid NOT NULL,
 line_id uuid NOT NULL,
 phase text NOT NULL CHECK(phase IN ('dispatch','verify')),
 actor_id uuid NOT NULL,
 source_store_id text NOT NULL,
 destination_store_id text NOT NULL,
 store_id text COLLATE "C" NOT NULL,
 line_product_id uuid NOT NULL,
 product_id uuid NOT NULL,
 observed_at timestamptz NOT NULL,
 transaction_id bigint NOT NULL,
 CHECK(source_store_id<>destination_store_id),
 UNIQUE(transfer_id,phase,line_id,store_id)
);
ALTER TABLE private.stock_history_transfer_legs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.stock_history_transfer_legs FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER stock_history_transfer_legs_immutable
 BEFORE UPDATE OR DELETE ON private.stock_history_transfer_legs
 FOR EACH ROW EXECUTE FUNCTION private.stock_history_immutable();

CREATE FUNCTION private.stock_history_capture_transfer_legs(
 p_transfer uuid,p_line uuid,p_phase text,p_actor uuid,p_product uuid,
 p_before jsonb,p_after jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE transfer public.stock_transfers%ROWTYPE; line public.stock_transfer_items%ROWTYPE;
 scope text; before_text text; after_text text; delta numeric; bound_effect uuid; changed integer;
 stock_map jsonb;
 tx bigint:=txid_current();
BEGIN
 IF p_actor IS NULL OR jsonb_typeof(p_before) IS DISTINCT FROM 'object'
  OR jsonb_typeof(p_after) IS DISTINCT FROM 'object' THEN RETURN; END IF;
 stock_map:=p_before||p_after;
 IF (SELECT count(*) FROM (SELECT 1 FROM jsonb_object_keys(stock_map) LIMIT 2001) bounded)>2000
 THEN RETURN; END IF;
 SELECT * INTO transfer FROM public.stock_transfers WHERE id=p_transfer;
 SELECT * INTO line FROM public.stock_transfer_items WHERE id=p_line AND transfer_id=p_transfer;
 IF transfer.kind IS DISTINCT FROM 'transfer' OR transfer.from_store_id IS NULL OR transfer.to_store_id IS NULL
  OR transfer.from_store_id=transfer.to_store_id OR line.product_id IS NULL OR p_product IS NULL
  OR NOT EXISTS(SELECT 1 FROM public.app_users WHERE id=p_actor AND is_active) THEN RETURN; END IF;
 IF p_phase='dispatch' THEN
  IF transfer.status IS DISTINCT FROM 'approved' OR p_product IS DISTINCT FROM line.product_id THEN RETURN; END IF;
 ELSIF p_phase='verify' THEN
  IF transfer.status IS DISTINCT FROM 'received' THEN RETURN; END IF;
 ELSE RETURN;
 END IF;

 FOR scope IN SELECT jsonb_object_keys(stock_map) ORDER BY 1 LOOP
  IF p_before->scope IS NOT DISTINCT FROM p_after->scope THEN CONTINUE; END IF;
  before_text:=COALESCE(p_before->>scope,'0');
  after_text:=COALESCE(p_after->>scope,'0');
  IF before_text!~'^-?(0|[1-9][0-9]{0,37})$' OR after_text!~'^-?(0|[1-9][0-9]{0,37})$' THEN CONTINUE; END IF;
  delta:=after_text::numeric-before_text::numeric;
  IF p_phase='dispatch' AND (delta>=0 OR NOT EXISTS(
    SELECT 1 FROM public.stores WHERE id=scope AND is_active AND archived_at IS NULL
     AND (id=transfer.from_store_id OR (parent_id=transfer.from_store_id AND location_type='sub_warehouse'))))
   OR p_phase='verify' AND (scope<>transfer.to_store_id OR delta<=0 OR delta IS DISTINCT FROM line.quantity_verified)
  THEN CONTINUE; END IF;
  SELECT count(*),(array_agg(id))[1] INTO changed,bound_effect FROM (
   SELECT e.id FROM private.stock_history_accepted_effects e
   WHERE e.transaction_id=tx AND e.product_id=p_product AND e.store_id=scope
    AND e.operation='UPDATE' AND e.previous_quantity=before_text::numeric
    AND e.next_quantity=after_text::numeric AND e.quantity_delta=delta
   LIMIT 2
  ) exact_effect;
  IF changed=1 THEN
   INSERT INTO private.stock_history_transfer_legs(effect_id,transfer_id,line_id,phase,actor_id,
    source_store_id,destination_store_id,store_id,line_product_id,product_id,observed_at,transaction_id)
   VALUES(bound_effect,p_transfer,p_line,p_phase,p_actor,transfer.from_store_id,transfer.to_store_id,
    scope,line.product_id,p_product,clock_timestamp(),tx);
  END IF;
 END LOOP;
END $fn$;
REVOKE ALL ON FUNCTION private.stock_history_capture_transfer_legs(uuid,uuid,text,uuid,uuid,jsonb,jsonb)
 FROM PUBLIC,anon,authenticated,service_role;

-- Bind only the known protected writers. Both still do their original writes
-- and return their original result when optional report metadata is unavailable.
DO $bind$
DECLARE
 dispatch regprocedure:=to_regprocedure('private.stock_transfer_dispatch_stock_only(uuid,text,jsonb)');
 verify regprocedure:=to_regprocedure('private.stock_transfer_verify(uuid,text,jsonb,text)');
 expected record;
 definition text;
 dispatch_anchor text:=$a$UPDATE public.products SET stock_by_store=v_stock,stock_quantity=GREATEST(stock_quantity-v_qty,0) WHERE id=it.product_id;$a$;
 verify_anchor text:=$a$WHERE id = v_target;$a$;
 dispatch_capture text:=$capture$
    BEGIN
      PERFORM private.stock_history_capture_transfer_legs(t.id,it.id,'dispatch',
        COALESCE(private.native_transfer_dispatcher(t.id),(
          SELECT u.id FROM public.current_app_user() u JOIN public.app_users a ON a.id=u.id
          WHERE auth.role()='authenticated' AND a.auth_user_id=auth.uid() LIMIT 1)),
        it.product_id,COALESCE(v_product.stock_by_store,'{}'::jsonb),v_stock);
    EXCEPTION WHEN query_canceled OR assert_failure OR OTHERS THEN NULL;
    END;$capture$;
 verify_capture text:=$capture$
    BEGIN
      PERFORM private.stock_history_capture_transfer_legs(t.id,it.id,'verify',
        CASE WHEN auth.role()='service_role' AND private.native_transfer_receiver_allowed(t.id,'verify')
          THEN NULLIF(current_setting('pos.native_receiver_actor',true),'')::uuid
          WHEN auth.role()='authenticated' THEN (
            SELECT u.id FROM public.current_app_user() u JOIN public.app_users a ON a.id=u.id
            WHERE a.auth_user_id=auth.uid() LIMIT 1) END,
        v_target,jsonb_build_object(t.to_store_id,COALESCE(v_before,0)),
        jsonb_build_object(t.to_store_id,COALESCE(v_before,0)+v_qty));
    EXCEPTION WHEN query_canceled OR assert_failure OR OTHERS THEN NULL;
    END;$capture$;
BEGIN
 FOR expected IN SELECT * FROM (VALUES
  ('private.stock_transfer_dispatch_stock_only(uuid,text,jsonb)','dbde5b38aff8c3ba6b27328230879bfc',true,'v','search_path=public, pg_temp',false,false),
  ('private.stock_transfer_verify(uuid,text,jsonb,text)','0b4375c3191dfba0cbd62ccaf14aa2a8',true,'v','search_path=public, pg_temp',false,true),
  ('private.native_transfer_dispatcher(uuid)','6dac5e216bdac36b9affdc5f82198768',true,'s','search_path=""',false,false),
  ('private.native_transfer_receiver_allowed(uuid,text)','d41d8cd98f00b204e9800998ecf8427e',false,'s','search_path=pg_catalog',false,false),
  ('public.stock_transfer_receive_for_staff(uuid,text,text,text,jsonb,text)','0f385e5e13c9f831aa2d510d73949452',true,'v','search_path=pg_catalog',false,true),
  ('public.current_app_user()','bbcf7d9e515205a0b869483a42b1c450',true,'s','search_path=public, extensions, pg_temp',true,true)
 ) fingerprint(signature,body,definer,volatility,config,auth_exec,service_exec) LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=to_regprocedure(expected.signature)
   AND md5(replace(p.prosrc,chr(13)||chr(10),chr(10)))=expected.body
   AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=expected.definer
   AND p.provolatile::text=expected.volatility AND p.proconfig=ARRAY[expected.config]
   AND NOT has_function_privilege('anon',p.oid,'EXECUTE')
   AND has_function_privilege('authenticated',p.oid,'EXECUTE')=expected.auth_exec
   AND has_function_privilege('service_role',p.oid,'EXECUTE')=expected.service_exec)
  THEN RAISE EXCEPTION 'STOCK_HISTORY_TRANSFER_WRITER_UNREVIEWED: %',expected.signature; END IF;
 END LOOP;
 definition:=pg_get_functiondef(dispatch);
 IF length(definition)-length(replace(definition,dispatch_anchor,''))<>length(dispatch_anchor)
 THEN RAISE EXCEPTION 'STOCK_HISTORY_TRANSFER_DISPATCH_ANCHOR_UNREVIEWED'; END IF;
 EXECUTE replace(definition,dispatch_anchor,dispatch_anchor||dispatch_capture);
 definition:=pg_get_functiondef(verify);
 IF length(definition)-length(replace(definition,verify_anchor,''))<>length(verify_anchor)
 THEN RAISE EXCEPTION 'STOCK_HISTORY_TRANSFER_VERIFY_ANCHOR_UNREVIEWED'; END IF;
 EXECUTE replace(definition,verify_anchor,verify_anchor||verify_capture);
END $bind$;

COMMIT;
