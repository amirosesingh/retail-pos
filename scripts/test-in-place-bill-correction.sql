-- Owner connection only. Synthetic fixture changes all roll back.
BEGIN;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
DO $$
DECLARE
 branch text; sid uuid:=gen_random_uuid(); product uuid:=gen_random_uuid(); line_id uuid:=gen_random_uuid();
 extra uuid:=gen_random_uuid(); attempt uuid:=gen_random_uuid(); bill text:='correction-test-'||sid;
 result jsonb; items jsonb; totals jsonb; original_version integer; current_version integer; stock integer; rejected boolean;
BEGIN
 SELECT id INTO branch FROM public.stores LIMIT 1;
 IF branch IS NULL THEN RAISE EXCEPTION 'A branch is required for the rollback test'; END IF;
 INSERT INTO public.products(id,barcode,name,selling_price,stock_by_store,stock_quantity)
 VALUES(product,bill,'Correction rollback fixture',10,jsonb_build_object(branch,99),99);
 INSERT INTO public.sales(id,store_id,bill_number,subtotal_amount,total_amount,paid_amount,payment_type,payments)
 VALUES(sid,branch,bill,10,10,10,'cash','[{"id":"original","method":"cash","amount":10}]');
 INSERT INTO public.sale_items(id,sale_id,branch_id,product_id,product_name,quantity,unit_price)
 VALUES(line_id,sid,branch,product,'Correction rollback fixture',1,10);
 INSERT INTO public.payment_transactions(source_type,sale_id,store_id,amount,method)
 VALUES('sale',sid,branch,10,'cash');
 SELECT row_version INTO original_version FROM public.sales WHERE id=sid;
 items:=jsonb_build_array(jsonb_build_object('id',line_id,'product_id',product,'product_name','Correction rollback fixture','variant_code',NULL,
 'unit_price',10,'unit_cost',0,'quantity',2,'discount_percent',10,'discount_amount',0,'tax_rate',0,'is_return',false,'is_foc',false,'promo_id',NULL,'coupon_code',NULL,'coupon_discount',0));
 totals:='{"subtotal_amount":20,"discount_amount":2,"tax_amount":0,"total_amount":18,"coupon_discount":0}';
 result:=public.pos_admin_correct_sale(sid,branch,original_version,items,totals,'Synthetic correction test','test-admin','Test admin',NULL,attempt);
 IF result->'sale'->>'bill_number'<>bill OR (result->'sale'->>'id')::uuid<>sid OR result->'sale'->>'corrected_at' IS NULL THEN RAISE EXCEPTION 'Correction lost receipt identity or marker'; END IF;
 IF (result->'sale'->>'paid_amount')::numeric<>10 OR result->'sale'->'payments' <> '[{"id":"original","method":"cash","amount":10}]'::jsonb THEN RAISE EXCEPTION 'Correction changed recorded payment'; END IF;
 IF (SELECT amount FROM public.payment_transactions WHERE sale_id=sid)<>10 THEN RAISE EXCEPTION 'Correction changed payment ledger'; END IF;
 IF (SELECT (stock_by_store->>branch)::integer FROM public.products WHERE id=product)<>98 THEN RAISE EXCEPTION 'Stock delta was not applied exactly once'; END IF;
 PERFORM public.pos_admin_correct_sale(sid,branch,original_version,items,totals,'Synthetic correction test','test-admin','Test admin',NULL,attempt);
 IF (SELECT count(*) FROM public.record_edits WHERE record_id=sid::text)<>1 OR (SELECT (stock_by_store->>branch)::integer FROM public.products WHERE id=product)<>98 THEN RAISE EXCEPTION 'Retry duplicated audit or stock'; END IF;
 rejected:=false;
 BEGIN
  PERFORM public.pos_admin_correct_sale(sid,branch,original_version,items,totals,'Different correction','test-admin','Test admin',NULL,attempt);
 EXCEPTION WHEN OTHERS THEN rejected:=true; END;
 IF NOT rejected THEN RAISE EXCEPTION 'Mismatched retry was accepted'; END IF;
 rejected:=false;
 BEGIN
  PERFORM public.pos_admin_correct_sale(sid,branch,original_version,items,totals,'Stale correction test','test-admin','Test admin',NULL,gen_random_uuid());
 EXCEPTION WHEN OTHERS THEN rejected:=true; END;
 IF NOT rejected THEN RAISE EXCEPTION 'Stale edit was accepted'; END IF;
 SELECT row_version INTO current_version FROM public.sales WHERE id=sid;
 -- Replace the product with a service line: restore only its two sold units.
 items:=jsonb_build_array(jsonb_build_object('id',extra,'product_id',NULL,'product_name','Added service','variant_code',NULL,
 'unit_price',5,'unit_cost',0,'quantity',1,'discount_percent',0,'discount_amount',0,'tax_rate',0,'is_return',false,'is_foc',false,'promo_id',NULL,'coupon_code',NULL,'coupon_discount',0));
 totals:='{"subtotal_amount":5,"discount_amount":0,"tax_amount":0,"total_amount":5,"coupon_discount":0}';
 PERFORM public.pos_admin_correct_sale(sid,branch,current_version,items,totals,'Replace synthetic item','test-admin','Test admin',NULL,gen_random_uuid());
 IF (SELECT count(*) FROM public.sale_items WHERE sale_id=sid)<>1 OR EXISTS(SELECT 1 FROM public.sale_items WHERE id=line_id) THEN RAISE EXCEPTION 'Removed item remains on bill'; END IF;
 IF (SELECT (stock_by_store->>branch)::integer FROM public.products WHERE id=product)<>100 THEN RAISE EXCEPTION 'Removed item stock was not restored'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.record_edits WHERE record_id=sid::text AND before_value->'items' @> jsonb_build_array(jsonb_build_object('id',line_id))) THEN RAISE EXCEPTION 'Original items missing from audit'; END IF;
 IF (SELECT count(*) FROM public.sales WHERE id=sid)<>1 OR (SELECT count(*) FROM public.payment_transactions WHERE sale_id=sid)<>1 THEN RAISE EXCEPTION 'Correction created another sale or payment'; END IF;
END $$;
ROLLBACK;
SELECT 'In-place correction, unchanged payments, retry, stale edit, stock and audit checks passed; fixtures rolled back' AS verification;
