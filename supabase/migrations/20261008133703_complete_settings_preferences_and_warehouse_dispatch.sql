-- Global/cluster policy belongs to admins. Staff may override only a permitted branch.
CREATE OR REPLACE FUNCTION public.settings_admin_now()
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
  SELECT auth.uid() IS NOT NULL AND COALESCE((SELECT a.is_active AND a.role::text='admin' FROM public.current_app_user() a LIMIT 1),false)
$$;
REVOKE ALL ON FUNCTION public.settings_admin_now() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.settings_admin_now() TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.settings_scope_manageable(p_scope text, p_scope_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT auth.uid() IS NOT NULL AND CASE lower(COALESCE(p_scope,''))
    WHEN 'global' THEN public.settings_admin_now()
    WHEN 'cluster' THEN public.settings_admin_now() AND COALESCE(p_scope_id,'')<>''
    WHEN 'terminal' THEN public.settings_admin_now() AND public.settings_scope_visible(p_scope,p_scope_id)
    WHEN 'branch' THEN COALESCE(p_scope_id,'')<>'' AND (public.settings_admin_now() OR (
      COALESCE((SELECT a.is_active AND COALESCE((a.permissions->>'can_access_pos_settings')::boolean,false)
        FROM public.current_app_user() a LIMIT 1),false) AND public.store_visible(p_scope_id)))
    WHEN 'private' THEN p_scope_id=public.settings_private_key()
    ELSE false
  END
$$;
REVOKE ALL ON FUNCTION public.settings_scope_manageable(text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.settings_scope_manageable(text,text) TO authenticated,service_role;

ALTER POLICY "Settings managers can insert" ON public.pos_settings WITH CHECK (public.settings_admin_now());
ALTER POLICY "Settings managers can update" ON public.pos_settings USING (public.settings_admin_now()) WITH CHECK (public.settings_admin_now());
ALTER POLICY "Settings managers can delete" ON public.pos_settings USING (public.settings_admin_now());
ALTER POLICY settings_locks_insert ON public.settings_locks WITH CHECK (public.settings_admin_now());
ALTER POLICY settings_locks_update ON public.settings_locks USING (public.settings_admin_now()) WITH CHECK (public.settings_admin_now());
ALTER POLICY settings_locks_delete ON public.settings_locks USING (public.settings_admin_now());

ALTER POLICY settings_overrides_insert ON public.settings_overrides WITH CHECK (
  public.settings_scope_manageable(scope,scope_id) AND
  (public.settings_admin_now() OR NOT EXISTS(SELECT 1 FROM public.settings_locks l WHERE l.section=settings_overrides.section AND l.locked)));
ALTER POLICY settings_overrides_update ON public.settings_overrides USING (
  public.settings_scope_manageable(scope,scope_id) AND
  (public.settings_admin_now() OR NOT EXISTS(SELECT 1 FROM public.settings_locks l WHERE l.section=settings_overrides.section AND l.locked)))
WITH CHECK (
  public.settings_scope_manageable(scope,scope_id) AND
  (public.settings_admin_now() OR NOT EXISTS(SELECT 1 FROM public.settings_locks l WHERE l.section=settings_overrides.section AND l.locked)));
ALTER POLICY settings_overrides_delete ON public.settings_overrides USING (
  public.settings_scope_manageable(scope,scope_id) AND
  (public.settings_admin_now() OR NOT EXISTS(SELECT 1 FROM public.settings_locks l WHERE l.section=settings_overrides.section AND l.locked)));

ALTER POLICY settings_scoped_pos_fields_insert ON public.settings_scoped WITH CHECK (
  scope='GLOBAL' AND scope_id='' AND key LIKE 'pos_field:%' AND public.settings_admin_now());
ALTER POLICY settings_scoped_pos_fields_update ON public.settings_scoped USING (
  scope='GLOBAL' AND scope_id='' AND key LIKE 'pos_field:%' AND public.settings_admin_now()) WITH CHECK (
  scope='GLOBAL' AND scope_id='' AND key LIKE 'pos_field:%' AND public.settings_admin_now());
ALTER POLICY settings_scoped_pos_fields_delete ON public.settings_scoped USING (
  scope='GLOBAL' AND scope_id='' AND key LIKE 'pos_field:%' AND public.settings_admin_now());

-- Historical upgrades created an ALL policy. Remove it so it cannot bypass locks.
DROP POLICY IF EXISTS settings_overrides_write ON public.settings_overrides;

-- Personal appearance is the only independently editable private configuration.
CREATE POLICY settings_scoped_personal_insert ON public.settings_scoped FOR INSERT TO authenticated
WITH CHECK (scope='PRIVATE' AND scope_id=public.settings_private_key() AND key='personal_appearance'
  AND public.is_staff_now() AND (public.settings_admin_now() OR COALESCE((SELECT (a.permissions->>'can_customize_display')::boolean FROM public.current_app_user() a LIMIT 1),true)));
CREATE POLICY settings_scoped_personal_update ON public.settings_scoped FOR UPDATE TO authenticated
USING (scope='PRIVATE' AND scope_id=public.settings_private_key() AND key='personal_appearance' AND public.is_staff_now())
WITH CHECK (scope='PRIVATE' AND scope_id=public.settings_private_key() AND key='personal_appearance'
  AND public.is_staff_now() AND (public.settings_admin_now() OR COALESCE((SELECT (a.permissions->>'can_customize_display')::boolean FROM public.current_app_user() a LIMIT 1),true)));

-- A branch has one active shift. Serialize competing opens and keep all checks
-- inside the database transaction rather than depending on a disabled button.
CREATE OR REPLACE FUNCTION public.shift_open(p_id uuid,p_store_id text,p_opened_by_name text,
  p_opening_float numeric DEFAULT 0,p_terminal_id text DEFAULT NULL,p_terminal_name text DEFAULT NULL,
  p_opened_by_staff_id text DEFAULT NULL,p_opened_by_role text DEFAULT NULL,p_user_id uuid DEFAULT NULL)
RETURNS public.shifts LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_branch text:=COALESCE(NULLIF(btrim(p_store_id),''),public.user_store_id()); v_row public.shifts; v_actor record;
BEGIN
  SELECT * INTO v_actor FROM public.current_app_user() LIMIT 1;
  IF NOT public.is_staff_now() OR NOT public.has_perm('can_open_shift')
    OR (v_actor.role::text<>'admin' AND v_actor.permissions->>'can_open_shift'='false') THEN
    RAISE EXCEPTION 'You do not have permission to open a shift' USING ERRCODE='insufficient_privilege';
  END IF;
  IF COALESCE(v_branch,'')='' OR NOT public.store_visible(v_branch) THEN
    RAISE EXCEPTION 'SHIFT_BRANCH_FORBIDDEN' USING ERRCODE='insufficient_privilege';
  END IF;
  IF p_opening_float IS NULL OR p_opening_float<0 OR p_opening_float::text IN ('NaN','Infinity','-Infinity') THEN
    RAISE EXCEPTION 'Opening float must be a finite non-negative amount' USING ERRCODE='check_violation';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('shift_open:'||v_branch,0));
  SELECT * INTO v_row FROM public.shifts WHERE store_id=v_branch AND status='OPEN' AND closed_at IS NULL ORDER BY opened_at DESC LIMIT 1;
  IF FOUND THEN RETURN v_row; END IF;
  INSERT INTO public.shifts(id,store_id,terminal_id,terminal_name,opened_by_name,opened_by_staff_id,opened_by_role,opening_float,status,user_id)
  VALUES(COALESCE(p_id,gen_random_uuid()),v_branch,p_terminal_id,p_terminal_name,
    COALESCE(NULLIF(btrim(p_opened_by_name),''),'Cashier'),v_actor.user_id,v_actor.role,p_opening_float,'OPEN',auth.uid()) RETURNING * INTO v_row;
  RETURN v_row;
END $$;

-- Transfer creation is a document write only. Shelf picking and dispatch are
-- one protected transaction, including all products and their activity rows.
CREATE OR REPLACE FUNCTION private.stock_transfer_dispatch(p_transfer_id uuid,p_dispatched_by text DEFAULT NULL,p_lines jsonb DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE t public.stock_transfers; it record; bucket record; v_qty integer; v_left integer;
  v_before integer; v_take integer; v_stock jsonb; v_product public.products;
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'Only staff can dispatch a transfer'; END IF;
  SELECT * INTO t FROM public.stock_transfers WHERE id=p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TRANSFER_NOT_FOUND'; END IF;
  IF t.status<>'approved' THEN RAISE EXCEPTION 'Transfer % is % and cannot be dispatched',t.ref,t.status; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.stores WHERE id=t.from_store_id AND is_active AND archived_at IS NULL) THEN
    RAISE EXCEPTION 'The sending warehouse is inactive or unavailable';
  END IF;
  FOR it IN SELECT * FROM public.stock_transfer_items WHERE transfer_id=t.id ORDER BY product_id,id LOOP
    v_qty:=COALESCE((SELECT (l->>'qty')::int FROM jsonb_array_elements(COALESCE(p_lines,'[]'::jsonb)) l WHERE l->>'product_id'=it.product_id::text LIMIT 1),it.quantity_approved,it.quantity);
    v_qty:=GREATEST(LEAST(v_qty,COALESCE(it.quantity_approved,it.quantity)),0);
    UPDATE public.stock_transfer_items SET quantity_dispatched=v_qty WHERE id=it.id;
    CONTINUE WHEN v_qty<=0;
    SELECT * INTO v_product FROM public.products WHERE id=it.product_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Transfer product is unavailable'; END IF;
    v_stock:=COALESCE(v_product.stock_by_store,'{}'::jsonb); v_left:=v_qty;
    FOR bucket IN SELECT s.id FROM public.stores s
      WHERE s.is_active AND s.archived_at IS NULL AND
        (s.id=t.from_store_id OR (s.parent_id=t.from_store_id AND s.location_type='sub_warehouse'))
      ORDER BY (s.id=t.from_store_id),s.is_primary_sub DESC,s.code,s.id
    LOOP
      v_before:=GREATEST(COALESCE((v_stock->>bucket.id)::int,0),0);
      v_take:=LEAST(v_before,v_left);
      CONTINUE WHEN v_take<=0;
      v_stock:=jsonb_set(v_stock,ARRAY[bucket.id],to_jsonb(v_before-v_take),true);
      v_left:=v_left-v_take;
      INSERT INTO public.item_activity_logs(product_id,product_name,store_id,activity_type,reference,quantity_delta,stock_before,stock_after,unit_cost,staff_name,note)
      VALUES(it.product_id,v_product.name,bucket.id,'transfer_out',t.ref,-v_take,v_before,v_before-v_take,COALESCE(v_product.cost_price,0),COALESCE(p_dispatched_by,''),'Warehouse dispatch');
      EXIT WHEN v_left=0;
    END LOOP;
    IF v_left>0 THEN RAISE EXCEPTION 'Short by % of % at the sending warehouse',v_left,v_product.name USING ERRCODE='check_violation'; END IF;
    UPDATE public.products SET stock_by_store=v_stock,stock_quantity=GREATEST(stock_quantity-v_qty,0) WHERE id=it.product_id;
  END LOOP;
  UPDATE public.stock_transfers SET status='dispatched',dispatched_by=COALESCE(p_dispatched_by,dispatched_by),dispatched_at=now() WHERE id=t.id;
END $$;
REVOKE ALL ON FUNCTION private.stock_transfer_dispatch(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.stock_transfer_dispatch(uuid,text,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';

-- Match authenticated Realtime/REST reads to the server and local audience rules.
CREATE OR REPLACE FUNCTION public.activity_notification_visible(p_type text,p_store text,p_meta jsonb)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE a record; m jsonb:=COALESCE(p_meta,'{}'::jsonb); v_audience text;
  v_role_slug text; v_users jsonb; v_roles jsonb; v_targeted boolean; v_match boolean;
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  SELECT * INTO a FROM public.current_app_user() LIMIT 1;
  IF NOT FOUND OR NOT a.is_active THEN RETURN false; END IF;
  SELECT role_slug INTO v_role_slug FROM public.app_users WHERE id=a.id;
  v_audience:=lower(COALESCE(m->>'audience',''));
  v_users:=CASE WHEN jsonb_typeof(m->'audience_user_ids')='array' THEN m->'audience_user_ids' ELSE '[]'::jsonb END;
  v_roles:=CASE WHEN jsonb_typeof(m->'audience_roles')='array' THEN m->'audience_roles' ELSE '[]'::jsonb END;
  v_targeted:=v_audience<>'' OR jsonb_array_length(v_users)>0 OR jsonb_array_length(v_roles)>0 OR COALESCE(m->>'audience_terminal_id','')<>'';
  IF v_targeted THEN
    -- Terminal-only audiences are served by the paired relay/local SQL path;
    -- a normal Auth JWT does not prove which terminal it is running on.
    v_match:=EXISTS(SELECT 1 FROM jsonb_array_elements_text(v_users) u WHERE lower(u) IN (lower(a.user_id),lower(a.email)))
      OR (v_audience<>'configured_approvers' AND v_audience IN (lower(a.user_id),lower(a.email)))
      OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(v_roles) r WHERE lower(r) IN (lower(COALESCE(v_role_slug,a.role::text)),lower(a.role::text)));
    RETURN v_match AND (COALESCE(p_store,'')='' OR public.store_visible(p_store));
  END IF;
  IF p_type IN ('sale_complete','sale_refund','sale_void','shift_open','shift_close','shift_cash_variance','drawer_open','xreport_print') THEN
    RETURN a.role::text='admin';
  END IF;
  IF p_type IN ('stock_request_received','transfer_sent','transfer_received','po_finalised') THEN
    RETURN COALESCE(p_store,'')<>'' AND public.store_visible(p_store);
  END IF;
  RETURN (a.role::text='admin' OR COALESCE((a.permissions->>'can_view_audit_trail')::boolean,false))
    AND (a.role::text='admin' OR COALESCE(p_store,'')='' OR public.store_visible(p_store));
END $$;
REVOKE ALL ON FUNCTION public.activity_notification_visible(text,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.activity_notification_visible(text,text,jsonb) TO authenticated,service_role;
ALTER POLICY "Supervisors read activity events" ON public.activity_events
USING(public.activity_notification_visible(event_type,store_id,meta));
NOTIFY pgrst,'reload schema';

-- This private service-key RPC merges one key atomically so the two global
-- notification pages cannot overwrite each other's settings.
CREATE OR REPLACE FUNCTION public.save_global_shift_alerts(p_settings jsonb)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path=public,pg_temp AS $$
  INSERT INTO public.pos_settings(id,notification_settings) VALUES(1,jsonb_build_object('shiftAlerts',p_settings))
  ON CONFLICT(id) DO UPDATE SET notification_settings=jsonb_set(COALESCE(pos_settings.notification_settings,'{}'::jsonb),'{shiftAlerts}',p_settings,true)
$$;
REVOKE ALL ON FUNCTION public.save_global_shift_alerts(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_global_shift_alerts(jsonb) TO service_role;
CREATE OR REPLACE FUNCTION public.save_global_notification_rules(p_settings jsonb)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path=public,pg_temp AS $$
  INSERT INTO public.pos_settings(id,notification_settings) VALUES(1,p_settings)
  ON CONFLICT(id) DO UPDATE SET notification_settings=COALESCE(pos_settings.notification_settings,'{}'::jsonb)||p_settings
$$;
REVOKE ALL ON FUNCTION public.save_global_notification_rules(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_global_notification_rules(jsonb) TO service_role;
NOTIFY pgrst,'reload schema';

-- Renderers keep only recent bills. Compute closing summaries against all
-- stored bills in SQL instead of publishing a truncated screen snapshot.
CREATE OR REPLACE FUNCTION public.publish_complete_shift_summary(p_shift uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE sh public.shifts; v_store text; totals record; breakdown jsonb; v_expected numeric; v_summary text;
BEGIN
  SELECT * INTO sh FROM public.shifts WHERE id=p_shift;
  IF NOT FOUND OR sh.closed_at IS NULL THEN RAISE EXCEPTION 'Only a closed shift can publish its summary'; END IF;
  SELECT name INTO v_store FROM public.stores WHERE id=sh.store_id;
  SELECT COALESCE(sum(total_amount) FILTER(WHERE NOT is_refunded),0) total_sales,
    count(*) FILTER(WHERE NOT is_refunded) transactions,
    COALESCE(sum(discount_amount) FILTER(WHERE NOT is_refunded),0) discounts,
    COALESCE(sum(total_amount) FILTER(WHERE is_refunded),0) refunds
    INTO totals FROM public.sales WHERE shift_id=sh.id::text AND store_id=sh.store_id;
  SELECT COALESCE(jsonb_object_agg(method,amount),'{}'::jsonb) INTO breakdown FROM (
    SELECT lower(parts->>'method') method,sum((parts->>'amount')::numeric) amount
    FROM public.sales s CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(s.payments)='array' AND jsonb_array_length(s.payments)>0 THEN s.payments
      ELSE jsonb_build_array(jsonb_build_object('method',s.payment_type,'amount',s.total_amount)) END) parts
    WHERE s.shift_id=sh.id::text AND s.store_id=sh.store_id AND NOT s.is_refunded GROUP BY lower(parts->>'method')
  ) grouped;
  v_expected:=COALESCE(sh.expected_cash,sh.opening_float+COALESCE((breakdown->>'cash')::numeric,0));
  v_summary:=format('Shift closed — %s%sTotal sales: %s over %s bill(s)%sCash expected %s / counted %s',
    COALESCE(v_store,sh.store_id),E'\n',totals.total_sales,totals.transactions,E'\n',v_expected,COALESCE(sh.counted_cash,0));
  INSERT INTO public.shift_notifications(shift_id,store_id,store_name,terminal_name,closed_by,opened_at,closed_at,total_sales,transactions,discounts,refunds,expected_cash,counted_cash,payment_breakdown,summary,channels)
  VALUES(sh.id,sh.store_id,COALESCE(v_store,sh.store_id),COALESCE(sh.terminal_name,''),COALESCE(sh.closed_by_name,sh.opened_by_name,''),sh.opened_at,sh.closed_at,
    totals.total_sales,totals.transactions,totals.discounts,totals.refunds,v_expected,COALESCE(sh.counted_cash,0),breakdown,v_summary,ARRAY['in_app']::text[])
  ON CONFLICT(shift_id) DO UPDATE SET total_sales=EXCLUDED.total_sales,transactions=EXCLUDED.transactions,discounts=EXCLUDED.discounts,
    refunds=EXCLUDED.refunds,expected_cash=EXCLUDED.expected_cash,counted_cash=EXCLUDED.counted_cash,payment_breakdown=EXCLUDED.payment_breakdown,summary=EXCLUDED.summary;
END $$;
REVOKE ALL ON FUNCTION public.publish_complete_shift_summary(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.publish_complete_shift_summary(uuid) TO service_role;
ALTER POLICY "Variance viewers read shift summaries" ON public.shift_notifications USING(public.settings_admin_now());
NOTIFY pgrst,'reload schema';

-- The database advisor identified mutable search paths on these existing sync helpers.
ALTER FUNCTION public.sync_apply_issued_vouchers(jsonb) SET search_path=public,pg_temp;
ALTER FUNCTION public.sync_delete_issued_vouchers(jsonb,text) SET search_path=public,pg_temp;
ALTER FUNCTION public.sync_delete_issued_vouchers(jsonb,text,text) SET search_path=public,pg_temp;

-- Delegated branch settings permission cannot edit other shared configuration.
ALTER POLICY "Staff can add public flags" ON public.public_flags WITH CHECK(public.settings_admin_now());
ALTER POLICY "Staff can change public flags" ON public.public_flags USING(public.settings_admin_now()) WITH CHECK(public.settings_admin_now());
ALTER POLICY integration_settings_supervisor ON public.integration_settings USING(public.settings_admin_now()) WITH CHECK(public.settings_admin_now());
DROP POLICY IF EXISTS payment_types_staff_write ON public.payment_types;
DROP POLICY IF EXISTS payment_types_write ON public.payment_types;
DROP POLICY IF EXISTS payment_types_insert ON public.payment_types;
DROP POLICY IF EXISTS payment_types_update ON public.payment_types;
DROP POLICY IF EXISTS payment_types_delete ON public.payment_types;
CREATE POLICY payment_types_insert ON public.payment_types FOR INSERT TO authenticated WITH CHECK(public.settings_admin_now());
CREATE POLICY payment_types_update ON public.payment_types FOR UPDATE TO authenticated USING(public.settings_admin_now()) WITH CHECK(public.settings_admin_now());
CREATE POLICY payment_types_delete ON public.payment_types FOR DELETE TO authenticated USING(public.settings_admin_now());
NOTIFY pgrst,'reload schema';

-- Claim outbound summary delivery once, even if a close request is retried.
CREATE OR REPLACE FUNCTION public.claim_shift_summary_whatsapp(p_shift uuid)
RETURNS text LANGUAGE sql SECURITY INVOKER SET search_path=public,pg_temp AS $$
  UPDATE public.shift_notifications SET channels=array_append(channels,'whatsapp_claimed')
  WHERE shift_id=p_shift AND NOT channels @> ARRAY['whatsapp_claimed']::text[] RETURNING summary
$$;
REVOKE ALL ON FUNCTION public.claim_shift_summary_whatsapp(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_shift_summary_whatsapp(uuid) TO service_role;
NOTIFY pgrst,'reload schema';
