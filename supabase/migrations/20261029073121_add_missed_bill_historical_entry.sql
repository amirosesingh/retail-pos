-- Historical, already-paid sales are entered through a dedicated admin service.
-- Do not attach them to today's drawer or bypass normal checkout/shift guards.
BEGIN;
CREATE TABLE IF NOT EXISTS public.missed_bill_entries (
  id uuid PRIMARY KEY,
  sale_id uuid NOT NULL UNIQUE REFERENCES public.sales(id),
  store_id text NOT NULL REFERENCES public.stores(id),
  original_reference text NOT NULL DEFAULT '',
  occurred_at timestamptz NOT NULL,
  original_cashier_id text NOT NULL,
  original_shift_id uuid REFERENCES public.shifts(id),
  stock_handling text NOT NULL CHECK(stock_handling IN ('deduct','already_corrected')),
  stock_reason text NOT NULL,
  reason text NOT NULL,
  actor_id text NOT NULL,
  terminal_id text,
  request_value jsonb NOT NULL,
  entered_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS missed_bill_original_reference_idx ON public.missed_bill_entries(store_id,lower(original_reference)) WHERE original_reference<>'';
ALTER TABLE public.missed_bill_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.missed_bill_entries FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON TABLE public.missed_bill_entries TO service_role;
COMMENT ON TABLE public.missed_bill_entries IS 'Append-only historical sale provenance; original shift is attribution only, never a current drawer posting.';

CREATE OR REPLACE FUNCTION public.pos_admin_add_missed_bill(p_entry jsonb,p_actor_id text,p_terminal text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE
  key uuid; target text; occurred timestamptz; original_shift uuid; original_ref text;
  actor public.app_users%ROWTYPE; cashier public.app_users%ROWTYPE; branch public.stores%ROWTYPE;
  prior public.missed_bill_entries%ROWTYPE; receipt text; request_value jsonb;
  item jsonb; tender jsonb; product public.products%ROWTYPE; position integer := 0;
  qty integer; price numeric; cost numeric; reduction numeric; line_tax numeric;
  subtotal numeric := 0; discount numeric := 0; tax numeric := 0; total numeric; received numeric := 0;
  payments jsonb := '[]'::jsonb; payment_method text; stock_mode text; prevent_negative boolean;
  movement_id uuid; delta_map jsonb := '{}'::jsonb; saved public.sales%ROWTYPE;
BEGIN
  IF current_user NOT IN ('service_role','postgres') THEN RAISE EXCEPTION 'Administrator server authorization required' USING ERRCODE='42501'; END IF;
  SELECT * INTO actor FROM public.app_users WHERE user_id=p_actor_id AND is_active FOR SHARE;
  IF NOT FOUND OR (actor.role::text<>'admin' AND COALESCE(actor.role_slug,'')<>'admin') THEN RAISE EXCEPTION 'Only an active administrator can add a missed bill' USING ERRCODE='42501'; END IF;
  key := (p_entry->>'clientKey')::uuid; target := btrim(p_entry->>'storeId'); occurred := (p_entry->>'occurredAt')::timestamptz;
  original_shift := NULLIF(p_entry->>'originalShiftId','')::uuid;
  original_ref := btrim(COALESCE(p_entry->>'originalReference','')); stock_mode := p_entry->>'stockHandling';
  IF key IS NULL OR NULLIF(target,'') IS NULL OR occurred IS NULL OR occurred>now()+interval '1 minute' THEN RAISE EXCEPTION 'A past sale date, branch and retry key are required'; END IF;
  IF length(original_ref)>128 OR length(btrim(COALESCE(p_entry->>'reason','')))<3 OR length(p_entry->>'reason')>500
    OR stock_mode NOT IN ('deduct','already_corrected') OR stock_mode IS NULL
    OR length(btrim(COALESCE(p_entry->>'stockReason','')))<3 OR length(p_entry->>'stockReason')>500 THEN RAISE EXCEPTION 'Enter the reason and required stock-handling choice'; END IF;
  IF NULLIF(actor.store_id,'') IS NOT NULL AND lower(actor.store_id)<>lower(target) THEN RAISE EXCEPTION 'Administrator account is assigned to another branch' USING ERRCODE='42501'; END IF;
  IF p_terminal IS NOT NULL THEN
    IF NOT EXISTS(SELECT 1 FROM public.terminal_tokens t WHERE t.id::text=p_terminal AND t.status IN ('active','used') AND t.revoked_at IS NULL
      AND (t.location_id IS NULL OR lower(t.location_id)=lower(target))) THEN RAISE EXCEPTION 'Terminal branch mismatch or inactive registration' USING ERRCODE='42501'; END IF;
  END IF;
  SELECT * INTO branch FROM public.stores WHERE id=target AND deleted_at IS NULL AND is_active FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Select an active branch'; END IF;
  request_value := jsonb_build_object('entry',p_entry,'actor',p_actor_id);
  PERFORM pg_advisory_xact_lock(hashtextextended('missed-bill:'||key::text,0));
  SELECT * INTO prior FROM public.missed_bill_entries WHERE id=key;
  IF FOUND THEN
    IF prior.request_value IS DISTINCT FROM request_value THEN RAISE EXCEPTION 'This retry key belongs to a different historical entry'; END IF;
    SELECT * INTO saved FROM public.sales WHERE id=prior.sale_id;
    RETURN jsonb_build_object('saleId',saved.id,'receiptNo',saved.bill_number,'sale',to_jsonb(saved),'items',
      (SELECT COALESCE(jsonb_agg(to_jsonb(si) ORDER BY si.id),'[]'::jsonb) FROM public.sale_items si WHERE si.sale_id=saved.id));
  END IF;
  SELECT * INTO cashier FROM public.app_users WHERE user_id=p_entry->>'cashierId' AND is_active
    AND (NULLIF(store_id,'') IS NULL OR lower(store_id)=lower(target)) FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Select an active cashier assigned to this branch or all branches'; END IF;
  IF original_shift IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.shifts WHERE id=original_shift AND store_id=target
    AND opened_at<=occurred AND (closed_at IS NULL OR closed_at>=occurred)) THEN RAISE EXCEPTION 'Original shift does not match the branch and sale time'; END IF;
  IF original_ref<>'' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('missed-reference:'||target||':'||lower(original_ref),0));
    IF EXISTS(SELECT 1 FROM public.sales WHERE store_id=target AND lower(bill_number)=lower(original_ref))
      OR EXISTS(SELECT 1 FROM public.missed_bill_entries WHERE store_id=target AND lower(original_reference)=lower(original_ref))
    THEN RAISE EXCEPTION 'A bill with this original reference is already recorded; review history before adding it'; END IF;
  END IF;
  IF jsonb_typeof(p_entry->'items') IS DISTINCT FROM 'array' OR jsonb_array_length(p_entry->'items') NOT BETWEEN 1 AND 500
    OR jsonb_typeof(p_entry->'payments') IS DISTINCT FROM 'array' OR jsonb_array_length(p_entry->'payments') NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'Add valid items and already-received payments'; END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(p_entry->'items'))<>(SELECT count(DISTINCT (value->>'productId')::uuid) FROM jsonb_array_elements(p_entry->'items')) THEN RAISE EXCEPTION 'Combine duplicate product lines'; END IF;
  -- Lock in product order for safe simultaneous stock adjustments.
  PERFORM 1 FROM public.products p JOIN jsonb_array_elements(p_entry->'items') x ON p.id=(x->>'productId')::uuid ORDER BY p.id FOR UPDATE OF p;
  SELECT COALESCE((SELECT prevent_negative_stock_sale FROM public.pos_store_settings WHERE store_id=target),
    (SELECT prevent_negative_stock_sale FROM public.pos_store_settings WHERE store_id=''),false) INTO prevent_negative;
  FOR item IN SELECT value FROM jsonb_array_elements(p_entry->'items') LOOP
    IF EXISTS(SELECT 1 FROM (VALUES ('quantity'),('unitPrice'),('unitCost'),('discountAmount'),('taxAmount')) f(name)
      WHERE jsonb_typeof(item->f.name) IS DISTINCT FROM 'number' OR (item->>f.name)!~'^[0-9]+([.][0-9]+)?$') THEN RAISE EXCEPTION 'Item quantities and amounts must be finite nonnegative numbers'; END IF;
    qty := (item->>'quantity')::integer; price := (item->>'unitPrice')::numeric; cost := (item->>'unitCost')::numeric;
    reduction := (item->>'discountAmount')::numeric; line_tax := (item->>'taxAmount')::numeric;
    IF qty NOT BETWEEN 1 AND 100000 OR qty::numeric<>(item->>'quantity')::numeric OR price>100000000 OR cost>100000000
      OR reduction>price*qty OR reduction>100000000 OR line_tax>100000000
      OR price<>round(price,2) OR cost<>round(cost,2) OR reduction<>round(reduction,2) OR line_tax<>round(line_tax,2)
      OR (price*qty-reduction=0 AND line_tax>0)
      THEN RAISE EXCEPTION 'Check historical quantities, prices, discount and tax'; END IF;
    SELECT * INTO product FROM public.products WHERE id=(item->>'productId')::uuid AND deleted_at IS NULL;
    IF NOT FOUND OR NOT public.product_available_in_catalogue(product.id,target) THEN RAISE EXCEPTION 'Product is not in this branch cluster catalogue'; END IF;
    IF stock_mode='deduct' AND prevent_negative AND COALESCE((product.stock_by_store->>target)::numeric,0)<qty THEN RAISE EXCEPTION 'Insufficient branch stock; negative stock prevention is enabled'; END IF;
    subtotal := subtotal+price*qty; discount := discount+reduction; tax := tax+line_tax;
  END LOOP;
  total := round(subtotal-discount+tax,2);
  IF total<=0 OR total>100000000 THEN RAISE EXCEPTION 'Historical bill total must be positive and within the supported limit'; END IF;
  FOR tender IN SELECT value FROM jsonb_array_elements(p_entry->'payments') LOOP
    IF tender->>'method' NOT IN ('cash','card','bank_transfer','wallet') OR tender->>'method' IS NULL OR jsonb_typeof(tender->'amount') IS DISTINCT FROM 'number'
      OR tender->>'amount'!~'^[0-9]+([.][0-9]+)?$' OR (tender->>'amount')::numeric<=0 OR (tender->>'amount')::numeric>100000000
      OR (tender->>'amount')::numeric<>round((tender->>'amount')::numeric,2) THEN RAISE EXCEPTION 'Enter valid already-received payments'; END IF;
    received := received+(tender->>'amount')::numeric;
    payments := payments||jsonb_build_array(jsonb_build_object('method',tender->>'method','amount',(tender->>'amount')::numeric));
  END LOOP;
  IF round(received,2)<>total THEN RAISE EXCEPTION 'Already-received payments must equal the historical bill total'; END IF;
  payment_method := CASE WHEN jsonb_array_length(payments)=1 THEN payments->0->>'method' ELSE 'split' END;
  receipt := 'MB-'||key::text;
  INSERT INTO public.sales(id,bill_number,store_id,cashier_id,cashier_name,subtotal_amount,discount_amount,tax_amount,total_amount,
    paid_amount,change_amount,payment_type,payments,created_at,shift_id,client_transaction_id,created_by,updated_by,store_name_snapshot,store_address_snapshot)
    VALUES(key,receipt,target,cashier.user_id,cashier.full_name,subtotal,discount,tax,total,total,0,payment_method,payments,occurred,NULL,
      'missed:'||key::text,p_actor_id,p_actor_id,branch.name,branch.address) RETURNING * INTO saved;
  FOR item IN SELECT value FROM jsonb_array_elements(p_entry->'items') LOOP
    position := position+1; qty := (item->>'quantity')::integer; price := (item->>'unitPrice')::numeric;
    reduction := (item->>'discountAmount')::numeric; line_tax := (item->>'taxAmount')::numeric;
    SELECT * INTO product FROM public.products WHERE id=(item->>'productId')::uuid;
    INSERT INTO public.sale_items(id,sale_id,branch_id,product_id,product_name,unit_price,unit_cost,quantity,discount_amount,tax_rate,created_at)
      VALUES(md5(key::text||':item:'||position)::uuid,key,target,product.id,product.name,price,(item->>'unitCost')::numeric,qty,reduction/qty,
        CASE WHEN price*qty-reduction>0 THEN line_tax/(price*qty-reduction) ELSE 0 END,occurred);
    IF stock_mode='deduct' THEN
      movement_id := md5(key::text||':stock:'||product.id::text)::uuid;
      PERFORM public.stock_apply_delta(movement_id,product.id,target,-qty);
      INSERT INTO public.item_activity_logs(id,product_id,store_id,activity_type,reference,quantity_delta,staff_name,note)
        VALUES(movement_id,product.id,target,'adjustment',receipt,-qty,actor.full_name,'Historical missed bill: '||(p_entry->>'stockReason'));
      delta_map := delta_map||jsonb_build_object(product.id::text,-qty);
    END IF;
  END LOOP;
  position := 0;
  FOR tender IN SELECT value FROM jsonb_array_elements(payments) LOOP
    position := position+1;
    INSERT INTO public.payment_transactions(id,source_type,sale_id,store_id,shift_id,terminal_id,amount,method,kind,reference,
      cashier_id,cashier_name,note,paid_at,created_at,status,client_transaction_id,metadata)
      VALUES(md5(key::text||':payment:'||position)::uuid,'sale',key,target,NULL,p_terminal,(tender->>'amount')::numeric,tender->>'method','payment',original_ref,
        cashier.user_id,cashier.full_name,'Historical payment already received; no drawer collection',occurred,occurred,'completed','missed:'||key::text||':'||position,
        jsonb_build_object('historicalEntry',true,'originalShiftId',original_shift,'enteredAt',now()));
  END LOOP;
  INSERT INTO public.missed_bill_entries(id,sale_id,store_id,original_reference,occurred_at,original_cashier_id,original_shift_id,
    stock_handling,stock_reason,reason,actor_id,terminal_id,request_value)
    VALUES(key,key,target,original_ref,occurred,cashier.user_id,original_shift,stock_mode,p_entry->>'stockReason',p_entry->>'reason',p_actor_id,p_terminal,request_value);
  INSERT INTO public.record_edits(id,record_type,record_id,reference,store_id,terminal_id,action_key,edited_by,edited_by_name,
    authorized_by,authorized_by_name,mode_used,before_value,after_value,stock_deltas,note)
    VALUES(key,'sale',key::text,receipt,target,p_terminal,'MISSED_BILL_ADDED',p_actor_id,actor.full_name,p_actor_id,actor.full_name,'admin','{}'::jsonb,
      jsonb_build_object('sale',to_jsonb(saved),'historicalEntry',p_entry,'enteredAt',now()),delta_map,p_entry->>'reason');
  RETURN jsonb_build_object('saleId',saved.id,'receiptNo',saved.bill_number,'sale',to_jsonb(saved),'items',
    (SELECT COALESCE(jsonb_agg(to_jsonb(si) ORDER BY si.id),'[]'::jsonb) FROM public.sale_items si WHERE si.sale_id=saved.id));
END $fn$;
REVOKE ALL ON FUNCTION public.pos_admin_add_missed_bill(jsonb,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pos_admin_add_missed_bill(jsonb,text,text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
