-- Additive schema update only. Business records change only when an admin saves a correction.
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS corrected_at timestamptz;
ALTER TABLE public.sale_items ADD COLUMN IF NOT EXISTS corrected_at timestamptz;

CREATE OR REPLACE FUNCTION public.pos_admin_correct_sale(
  p_sale uuid,p_store text,p_expected_version integer,p_items jsonb,p_totals jsonb,
  p_reason text,p_actor_id text,p_actor_name text,p_terminal text,p_client_key uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE
  v public.sales%ROWTYPE; old_items jsonb; new_items jsonb; before_value jsonb;
  request_value jsonb := jsonb_build_object('sale',p_sale,'store',p_store,'version',p_expected_version,'items',p_items,'totals',p_totals,'reason',p_reason);
  prior public.record_edits%ROWTYPE; item jsonb; movement record; movement_id uuid;
  delta_map jsonb := '{}'::jsonb; subtotal numeric; discount numeric; tax numeric; total numeric;
BEGIN
  IF current_user NOT IN ('service_role','postgres') THEN RAISE EXCEPTION 'Administrator server authorization is required'; END IF;
  IF length(btrim(coalesce(p_reason,'')))<3 OR p_client_key IS NULL THEN RAISE EXCEPTION 'A reason and correction key are required'; END IF;
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Add valid correction items'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_client_key::text,0));
  SELECT * INTO v FROM public.sales WHERE id=p_sale AND store_id=p_store FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'This bill does not belong to the selected branch'; END IF;
  SELECT * INTO prior FROM public.record_edits WHERE id=p_client_key;
  IF FOUND THEN
    IF prior.record_id<>p_sale::text OR prior.after_value->'request' IS DISTINCT FROM request_value THEN RAISE EXCEPTION 'Correction retry differs from the saved correction'; END IF;
    RETURN jsonb_build_object('sale',to_jsonb(v),'items',(SELECT coalesce(jsonb_agg(to_jsonb(si) ORDER BY si.created_at,si.id),'[]'::jsonb) FROM public.sale_items si WHERE sale_id=p_sale));
  END IF;
  IF coalesce(v.row_version,0)<>p_expected_version THEN RAISE EXCEPTION 'This bill changed. Refresh it before correcting'; END IF;
  IF v.is_refunded OR v.is_exchange OR v.exchanged_to_bill_number IS NOT NULL THEN RAISE EXCEPTION 'Refunded or exchanged bills cannot be corrected in place'; END IF;
  PERFORM 1 FROM public.sale_items WHERE sale_id=p_sale FOR UPDATE;
  IF EXISTS(SELECT 1 FROM public.sale_items WHERE sale_id=p_sale AND coalesce(refunded_qty,0)>0) THEN RAISE EXCEPTION 'Partially refunded bills cannot be corrected in place'; END IF;
  old_items := (SELECT coalesce(jsonb_agg(to_jsonb(si)),'[]'::jsonb) FROM public.sale_items si WHERE sale_id=p_sale);
  before_value := jsonb_build_object('sale',to_jsonb(v),'items',old_items);
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) x WHERE (x->>'quantity')::integer<=0 OR (x->>'unit_price')::numeric<0
      OR (x->>'discount_percent')::numeric NOT BETWEEN 0 AND 100 OR (x->>'discount_amount')::numeric NOT BETWEEN 0 AND (x->>'unit_price')::numeric
      OR (x->>'is_return')::boolean OR (x->>'coupon_discount')::numeric<0) THEN RAISE EXCEPTION 'Invalid item quantity, price or discount'; END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(p_items))<>(SELECT count(DISTINCT x->>'id') FROM jsonb_array_elements(p_items) x) THEN RAISE EXCEPTION 'Duplicate item identities'; END IF;
  IF EXISTS(SELECT 1 FROM public.sale_items si JOIN jsonb_array_elements(p_items) x ON si.id=(x->>'id')::uuid WHERE si.sale_id<>p_sale) THEN RAISE EXCEPTION 'Item belongs to another bill'; END IF;
  subtotal := round((SELECT sum((x->>'unit_price')::numeric*(x->>'quantity')::numeric) FROM jsonb_array_elements(p_items) x),2);
  discount := (p_totals->>'discount_amount')::numeric; tax := (p_totals->>'tax_amount')::numeric; total := (p_totals->>'total_amount')::numeric;
  IF subtotal IS DISTINCT FROM (p_totals->>'subtotal_amount')::numeric OR discount NOT BETWEEN 0 AND subtotal OR tax<0 OR total<0
      OR total NOT IN (round(subtotal-discount,2),round(subtotal-discount+tax,2)) THEN RAISE EXCEPTION 'Correction totals do not match its items'; END IF;
  FOR movement IN
    SELECT product_id,sum(delta)::integer delta FROM (
      SELECT product_id,sum(quantity) delta FROM public.sale_items WHERE sale_id=p_sale GROUP BY product_id
      UNION ALL SELECT (x->>'product_id')::uuid,-sum((x->>'quantity')::integer) FROM jsonb_array_elements(p_items) x GROUP BY x->>'product_id'
    ) quantities WHERE product_id IS NOT NULL GROUP BY product_id HAVING sum(delta)<>0 ORDER BY product_id
  LOOP
    movement_id := md5(p_client_key::text || ':' || movement.product_id::text)::uuid;
    PERFORM public.stock_apply_delta(movement_id,movement.product_id,p_store,movement.delta);
    INSERT INTO public.item_activity_logs(id,product_id,store_id,activity_type,reference,quantity_delta,staff_name,note)
      VALUES(movement_id,movement.product_id,p_store,'adjustment',v.bill_number,movement.delta,p_actor_name,p_reason);
    delta_map := delta_map || jsonb_build_object(movement.product_id::text,movement.delta);
  END LOOP;
  FOR item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    INSERT INTO public.sale_items(id,sale_id,branch_id,product_id,product_name,variant_code,unit_price,unit_cost,quantity,discount_percent,discount_amount,tax_rate,is_return,is_foc,promo_id,coupon_code,coupon_discount)
    VALUES((item->>'id')::uuid,p_sale,p_store,(item->>'product_id')::uuid,item->>'product_name',item->>'variant_code',(item->>'unit_price')::numeric,(item->>'unit_cost')::numeric,
      (item->>'quantity')::integer,(item->>'discount_percent')::numeric,(item->>'discount_amount')::numeric,(item->>'tax_rate')::numeric,false,(item->>'is_foc')::boolean,item->>'promo_id',item->>'coupon_code',(item->>'coupon_discount')::numeric)
    ON CONFLICT(id) DO UPDATE SET product_id=EXCLUDED.product_id,product_name=EXCLUDED.product_name,variant_code=EXCLUDED.variant_code,unit_price=EXCLUDED.unit_price,unit_cost=EXCLUDED.unit_cost,
      quantity=EXCLUDED.quantity,discount_percent=EXCLUDED.discount_percent,discount_amount=EXCLUDED.discount_amount,tax_rate=EXCLUDED.tax_rate,is_foc=EXCLUDED.is_foc,promo_id=EXCLUDED.promo_id,
      coupon_code=EXCLUDED.coupon_code,coupon_discount=EXCLUDED.coupon_discount,corrected_at=now(),row_version=public.sale_items.row_version+1;
  END LOOP;
  DELETE FROM public.sale_items si WHERE sale_id=p_sale AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) x WHERE (x->>'id')::uuid=si.id);
  -- Preserve bill number, original date, shift, payment ledger and paid/change amounts.
  UPDATE public.sales SET subtotal_amount=subtotal,discount_amount=discount,tax_amount=tax,total_amount=total,
    rounding_adjustment=0,coupon_discount=(p_totals->>'coupon_discount')::numeric,corrected_at=now(),updated_by=p_actor_id,row_version=row_version+1 WHERE id=p_sale RETURNING * INTO v;
  new_items := (SELECT coalesce(jsonb_agg(to_jsonb(si) ORDER BY si.created_at,si.id),'[]'::jsonb) FROM public.sale_items si WHERE sale_id=p_sale);
  INSERT INTO public.record_edits(id,record_type,record_id,reference,store_id,terminal_id,action_key,edited_by,edited_by_name,authorized_by,authorized_by_name,mode_used,before_value,after_value,stock_deltas,note)
    VALUES(p_client_key,'sale',p_sale::text,v.bill_number,p_store,p_terminal,'SALE_CORRECTED',p_actor_id,p_actor_name,p_actor_id,p_actor_name,'admin',before_value,
      jsonb_build_object('sale',to_jsonb(v),'items',new_items,'request',request_value),delta_map,p_reason);
  RETURN jsonb_build_object('sale',to_jsonb(v),'items',new_items);
END $fn$;
REVOKE ALL ON FUNCTION public.pos_admin_correct_sale(uuid,text,integer,jsonb,jsonb,text,text,text,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pos_admin_correct_sale(uuid,text,integer,jsonb,jsonb,text,text,text,text,uuid) TO service_role;
NOTIFY pgrst,'reload schema';
