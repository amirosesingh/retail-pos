-- Run against beta with an owner connection. All fixtures and cleanup changes roll back.
BEGIN;
DO $$
DECLARE branch text; prefix text:='cleanup-test-'||gen_random_uuid()::text;
  sale uuid; sale_ids uuid[]:='{}'; idx integer; payload jsonb;
  before_sales integer; before_items integer; before_payments integer; before_feed bigint;
BEGIN
  SELECT id INTO branch FROM public.stores LIMIT 1;
  IF branch IS NULL THEN RAISE EXCEPTION 'A branch is required for the rollback test'; END IF;
  FOR idx IN 1..4 LOOP
    sale:=gen_random_uuid(); sale_ids:=array_append(sale_ids,sale);
    INSERT INTO public.sales(id,store_id,bill_number,total_amount,paid_amount)
      VALUES(sale,branch,prefix||idx,70,100);
    INSERT INTO public.sale_items(sale_id,product_name,quantity,unit_price)
      VALUES(sale,'Cleanup rollback fixture',1,70);
    IF idx<>2 THEN
      INSERT INTO public.payment_transactions(source_type,sale_id,store_id,amount,status)
      VALUES('sale',sale,branch,100,'completed');
    END IF;
    payload:='[{"productId":null,"qty":1}]'::jsonb;
    IF idx=3 THEN payload:=payload || '[{"productId":null,"qty":2}]'::jsonb; END IF;
    INSERT INTO public.held_orders(id,store_id,bill_no,status,lines,updated_at)
      VALUES(prefix||idx,branch,prefix||idx,'completed',payload,
        CASE WHEN idx=4 THEN now() ELSE now()-interval '25 hours' END);
  END LOOP;
  INSERT INTO public.held_orders(id,store_id,bill_no,status,lines,updated_at)
    VALUES(prefix||'draft',branch,prefix||'draft','draft','[{"qty":1}]',now()-interval '25 hours');
  SELECT count(*) INTO before_sales FROM public.sales WHERE id=ANY(sale_ids);
  SELECT count(*) INTO before_items FROM public.sale_items WHERE sale_id=ANY(sale_ids);
  SELECT count(*) INTO before_payments FROM public.payment_transactions WHERE sale_id=ANY(sale_ids);
  PERFORM private.cleanup_completed_holds();
  IF EXISTS(SELECT 1 FROM public.held_orders WHERE id=prefix||'1') THEN RAISE EXCEPTION 'Synced completed hold was not cleaned'; END IF;
  IF (SELECT count(*) FROM public.held_orders WHERE id IN(prefix||'2',prefix||'3',prefix||'4',prefix||'draft'))<>4 THEN
    RAISE EXCEPTION 'Cleanup removed an incomplete, recent or unpaid hold'; END IF;
  IF NOT EXISTS(SELECT 1 FROM private.completed_hold_tombstones WHERE held_id=prefix||'1') THEN
    RAISE EXCEPTION 'No replay protection marker'; END IF;
  SELECT count(*) INTO before_feed FROM public.sync_change_feed WHERE table_name='held_orders' AND entity_id=jsonb_build_object('id',prefix||'1')::text AND tombstone;
  INSERT INTO public.held_orders(id,store_id,bill_no,status,lines)
    VALUES(prefix||'1',branch,prefix||'1','draft','[{"qty":1}]');
  IF EXISTS(SELECT 1 FROM public.held_orders WHERE id=prefix||'1') THEN RAISE EXCEPTION 'Offline replay recreated the hold'; END IF;
  IF (SELECT count(*) FROM public.sync_change_feed WHERE table_name='held_orders' AND entity_id=jsonb_build_object('id',prefix||'1')::text AND tombstone)<=before_feed THEN
    RAISE EXCEPTION 'Replay did not renew the cleanup deletion'; END IF;
  IF (SELECT count(*) FROM public.sales WHERE id=ANY(sale_ids))<>before_sales
    OR (SELECT count(*) FROM public.sale_items WHERE sale_id=ANY(sale_ids))<>before_items
    OR (SELECT count(*) FROM public.payment_transactions WHERE sale_id=ANY(sale_ids))<>before_payments THEN
    RAISE EXCEPTION 'Cleanup changed the financial records'; END IF;
END $$;
SELECT 'PASS: synced hold removed; incomplete/recent/draft retained; sale/items/payments intact; replay blocked' AS result;
ROLLBACK;
