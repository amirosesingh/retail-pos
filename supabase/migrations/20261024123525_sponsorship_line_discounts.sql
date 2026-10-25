BEGIN;
-- Discounts are part of the immutable, fully approved sponsorship document.
CREATE OR REPLACE FUNCTION public.prepare_sponsorship(p_id uuid,p_store text,p_recipient text,p_contact text,p_purpose text,p_lines jsonb,p_actor text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE actor public.app_users%ROWTYPE; existing public.sponsorship_issues%ROWTYPE; product public.products%ROWTYPE;
 item jsonb; snapshot jsonb:='[]'; total numeric:=0; quantity integer; source_name text; digest text; discount_type text; discount_value numeric; gross numeric; reduction numeric; net numeric;
BEGIN
 SELECT * INTO actor FROM public.app_users WHERE user_id=p_actor AND is_active LIMIT 1;
 IF actor.id IS NULL OR (actor.role::text='admin' OR (actor.permissions->>'can_create_sponsorship'='true' AND COALESCE(actor.permissions->>'page:sponsorship','true')<>'false')) IS NOT TRUE THEN RAISE EXCEPTION 'Sponsorship creation permission is required'; END IF;
 IF actor.store_id IS NOT NULL AND actor.store_id<>p_store THEN RAISE EXCEPTION 'Sponsorship source is outside your branch'; END IF;
 SELECT name INTO source_name FROM public.stores WHERE id=p_store AND is_active AND archived_at IS NULL;
 IF source_name IS NULL THEN RAISE EXCEPTION 'Choose an active shop or warehouse'; END IF;
 IF p_recipient IS NULL OR p_contact IS NULL OR p_purpose IS NULL OR length(btrim(p_recipient)) NOT BETWEEN 2 AND 160 OR length(p_contact)>160 OR length(btrim(p_purpose)) NOT BETWEEN 3 AND 400
 OR jsonb_typeof(p_lines) IS DISTINCT FROM 'array' OR jsonb_array_length(p_lines) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid sponsorship details'; END IF;
 IF (SELECT count(DISTINCT value->>'productId') FROM jsonb_array_elements(p_lines))<>jsonb_array_length(p_lines) THEN RAISE EXCEPTION 'Choose each product once'; END IF;
 -- Normalize zero discounts to the original wire format, retaining old retry hashes.
 SELECT jsonb_agg(jsonb_build_object('productId',value->>'productId','quantity',(value->>'quantity')::integer) ||
   CASE WHEN COALESCE((value->>'discount')::numeric,0)=0 THEN '{}'::jsonb ELSE jsonb_build_object('discountType',COALESCE(value->>'discountType','amount'),'discount',(value->>'discount')::numeric) END
   ORDER BY value->>'productId') INTO p_lines FROM jsonb_array_elements(p_lines);
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
   discount_type:=COALESCE(item->>'discountType','amount');discount_value:=COALESCE((item->>'discount')::numeric,0);
   IF discount_type NOT IN ('amount','percent') OR discount_value<0 OR discount_value::text IN ('NaN','Infinity','-Infinity') OR (discount_type='percent' AND discount_value>100) THEN RAISE EXCEPTION 'Invalid sponsorship discount'; END IF;
   gross:=round(product.selling_price*quantity,2);
   reduction:=round(CASE WHEN discount_type='percent' THEN gross*discount_value/100 ELSE discount_value END,2);
   IF reduction>gross THEN RAISE EXCEPTION 'Sponsorship discount cannot exceed the product line value'; END IF;
   net:=gross-reduction;
   snapshot:=snapshot||jsonb_build_array(jsonb_build_object('product_id',product.id,'name',product.name,'sku',COALESCE(product.sku,''),'barcode',product.barcode,'quantity',quantity,'unit_value',product.selling_price,'unit_cost',product.cost_price,'discount_type',discount_type,'discount',discount_value,'discount_amount',reduction,'line_value',net));
   total:=total+net;
 END LOOP;
 INSERT INTO public.sponsorship_issues(id,reference,store_id,store_name,recipient_name,recipient_contact,purpose,lines,total_value,document_hash,input_hash,created_by,created_by_name)
 VALUES(p_id,'SP-'||p_id::text,p_store,source_name,btrim(p_recipient),p_contact,btrim(p_purpose),snapshot,total,
 md5(jsonb_build_object('input',digest,'lines',snapshot,'value',total)::text),digest,p_actor,actor.full_name) RETURNING * INTO existing;
 RETURN to_jsonb(existing);
END $$;
REVOKE ALL ON FUNCTION public.prepare_sponsorship(uuid,text,text,text,text,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_sponsorship(uuid,text,text,text,text,jsonb,text) TO service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
