BEGIN;

-- REVIEWED_HELD_SALE_GRAPH_BEGIN
DO $reviewed_hold_guard$
BEGIN
  IF to_regclass('private.completed_hold_tombstones') IS NULL
    OR to_regprocedure('public.pos_sync_validate_scope(text,text,text)') IS NULL
    OR to_regprocedure('public.pos_sync_history_project_v1(jsonb,text,boolean)') IS NULL
  THEN RAISE EXCEPTION 'HELD_SALE_REVIEW_DEPENDENCY'; END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid=to_regprocedure('public.pos_sync_held_sale_review_v1(text,text,text,uuid,text,text,uuid,boolean)')
      AND (md5(replace(p.prosrc,chr(13)||chr(10),chr(10)))<>'cefd61e150ab1556f10010740f0187f2'
        OR pg_get_userbyid(p.proowner)<>current_user OR NOT p.prosecdef OR p.provolatile<>'s'
        OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog','TimeZone=UTC']::text[]
        OR EXISTS(SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) acl
          WHERE acl.grantee NOT IN (p.proowner,(SELECT oid FROM pg_roles WHERE rolname='service_role'))))
  ) THEN RAISE EXCEPTION 'HELD_SALE_REVIEW_UNRECOGNIZED'; END IF;
END $reviewed_hold_guard$;

-- One STABLE read snapshot contains the authorization, completed hold or
-- cleanup marker, sale, and all children. No direct table grant is required.
CREATE OR REPLACE FUNCTION public.pos_sync_held_sale_review_v1(
  p_organization_id text,p_branch_id text,p_terminal_id text,p_actor_id uuid,
  p_ticket_id text,p_bill_no text,p_shift_id uuid,p_keep_commerce boolean
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog SET TimeZone='UTC' AS $held_sale_review$
DECLARE
  v_hold public.held_orders%ROWTYPE;
  v_marker private.completed_hold_tombstones%ROWTYPE;
  v_sale public.sales%ROWTYPE;
  v_sale_count integer;
  v_items jsonb;
  v_payments jsonb;
  v_graph text;
  v_proof text;
  v_response jsonb;
  v_tenders jsonb;
  v_max_bytes constant integer := 262144;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'HELD_SALE_REVIEW_FORBIDDEN' USING ERRCODE='42501'; END IF;
  IF p_organization_id IS DISTINCT FROM 'default' OR p_actor_id IS NULL OR p_shift_id IS NULL OR p_keep_commerce IS NULL
    OR p_branch_id IS NULL OR char_length(p_branch_id) NOT BETWEEN 1 AND 128
    OR p_bill_no IS NULL OR char_length(p_bill_no) NOT BETWEEN 1 AND 450 OR p_bill_no ~ '[[:cntrl:]]'
    OR p_ticket_id IS NULL OR char_length(p_ticket_id)>450
    OR p_ticket_id COLLATE "C" IS DISTINCT FROM ('D:'||p_branch_id||':'||p_bill_no) COLLATE "C"
  THEN RAISE EXCEPTION 'HELD_SALE_REVIEW_REQUEST' USING ERRCODE='22023'; END IF;
  PERFORM public.pos_sync_validate_scope(p_organization_id,p_branch_id,p_terminal_id);
  IF NOT EXISTS (SELECT 1 FROM public.terminal_tokens t WHERE t.id::text=p_terminal_id AND t.location_id=p_branch_id
    AND t.platform='pc' AND (t.is_claimed OR t.claimed_at IS NOT NULL) AND (t.claimed_platform IS NULL OR t.claimed_platform='electron'))
    OR NOT EXISTS (SELECT 1 FROM public.app_users u WHERE u.id=p_actor_id AND u.is_active
    AND (u.role::text='admin' OR u.role_slug='admin') AND (u.store_id IS NULL OR u.store_id=p_branch_id))
  THEN RAISE EXCEPTION 'HELD_SALE_REVIEW_FORBIDDEN' USING ERRCODE='42501'; END IF;

  v_response:=jsonb_build_object('ok',true,'version',1,'organizationId',p_organization_id,
    'branchId',p_branch_id,'terminalId',p_terminal_id,'actorId',p_actor_id,'ticketId',p_ticket_id,
    'billNo',p_bill_no,'shiftId',p_shift_id,'proof',NULL,'graphJson',NULL);

  IF EXISTS (SELECT 1 FROM public.held_orders h WHERE h.store_id=p_branch_id AND h.bill_no=p_bill_no
      AND h.id COLLATE "C"<>p_ticket_id COLLATE "C")
    OR EXISTS (SELECT 1 FROM private.completed_hold_tombstones t WHERE t.store_id=p_branch_id AND t.bill_no=p_bill_no
      AND t.held_id COLLATE "C"<>p_ticket_id COLLATE "C")
  THEN RAISE EXCEPTION 'HELD_SALE_REVIEW_CONFLICT' USING ERRCODE='23514'; END IF;

  SELECT * INTO v_hold FROM public.held_orders h WHERE h.id=p_ticket_id AND h.id COLLATE "C"=p_ticket_id COLLATE "C";
  SELECT * INTO v_marker FROM private.completed_hold_tombstones t WHERE t.held_id=p_ticket_id AND t.held_id COLLATE "C"=p_ticket_id COLLATE "C";
  IF v_hold.id IS NOT NULL THEN
    IF v_marker.held_id IS NOT NULL OR v_hold.status IS DISTINCT FROM 'completed'
      OR v_hold.store_id COLLATE "C" IS DISTINCT FROM p_branch_id COLLATE "C"
      OR v_hold.bill_no COLLATE "C" IS DISTINCT FROM p_bill_no COLLATE "C"
      OR lower(v_hold.shift_id::text) IS DISTINCT FROM p_shift_id::text
    THEN RAISE EXCEPTION 'HELD_SALE_REVIEW_CONFLICT' USING ERRCODE='23514'; END IF;
    v_proof:='completed_hold';
  ELSIF v_marker.held_id IS NOT NULL THEN
    IF v_marker.store_id COLLATE "C" IS DISTINCT FROM p_branch_id COLLATE "C"
      OR v_marker.bill_no COLLATE "C" IS DISTINCT FROM p_bill_no COLLATE "C"
    THEN RAISE EXCEPTION 'HELD_SALE_REVIEW_CONFLICT' USING ERRCODE='23514'; END IF;
    v_proof:='cleaned_hold';
  ELSE RETURN v_response;
  END IF;

  SELECT count(*) INTO v_sale_count FROM (SELECT 1 FROM public.sales s WHERE s.store_id=p_branch_id AND s.bill_number=p_bill_no LIMIT 2) matched;
  IF v_sale_count<>1 THEN RAISE EXCEPTION 'HELD_SALE_REVIEW_CONFLICT' USING ERRCODE='23514'; END IF;
  SELECT * INTO v_sale FROM public.sales s WHERE s.store_id=p_branch_id AND s.bill_number=p_bill_no;
  IF v_sale.store_id COLLATE "C" IS DISTINCT FROM p_branch_id COLLATE "C"
    OR v_sale.bill_number COLLATE "C" IS DISTINCT FROM p_bill_no COLLATE "C"
    OR lower(v_sale.shift_id::text) IS DISTINCT FROM p_shift_id::text
    OR (v_sale.branch_id IS NOT NULL AND v_sale.branch_id<>p_branch_id)
    OR (v_proof='cleaned_hold' AND v_marker.sale_id IS DISTINCT FROM v_sale.id)
    OR NOT EXISTS (SELECT 1 FROM public.shifts sh WHERE sh.id=p_shift_id AND sh.store_id=p_branch_id
      AND lower(sh.terminal_id::text)=lower(p_terminal_id))
  THEN RAISE EXCEPTION 'HELD_SALE_REVIEW_CONFLICT' USING ERRCODE='23514'; END IF;

  -- Corrected/refunded records can require additional financial evidence and
  -- are not eligible for this original-checkout recovery operation.
  IF v_sale.is_refunded IS DISTINCT FROM false OR v_sale.corrected_at IS NOT NULL THEN RETURN v_response; END IF;

  WITH rows AS MATERIALIZED (
    SELECT i.id,i.sale_id,i.product_id,i.product_name,i.variant_code,i.unit_price,i.quantity,i.discount_percent,
      i.discount_amount,i.is_return,i.created_at,i.tax_rate,i.is_foc,i.promo_id,i.coupon_code,i.coupon_discount,
      i.unit_cost,i.row_version,i.refunded_qty,i.branch_id,i.corrected_at
    FROM public.sale_items i WHERE i.sale_id=v_sale.id ORDER BY i.id LIMIT 257
  ), projected AS MATERIALIZED (
    SELECT id,public.pos_sync_history_project_v1(to_jsonb(rows),'sale_items',p_keep_commerce) body FROM rows
    WHERE (branch_id IS NULL OR branch_id=p_branch_id) AND corrected_at IS NULL AND COALESCE(refunded_qty,0)=0
  )
  SELECT CASE WHEN (SELECT count(*) FROM rows) BETWEEN 1 AND 256
      AND (SELECT count(*) FROM rows)=(SELECT count(*) FROM projected)
      AND (SELECT sum(octet_length(body::text)+2) FROM projected)<=v_max_bytes
    THEN (SELECT jsonb_agg(body ORDER BY id) FROM projected) END INTO v_items;
  IF v_items IS NULL THEN RETURN v_response; END IF;

  -- A still-present hold supplies the line-count and product/variant/quantity
  -- witness used by the completed-hold cleanup contract. A cleaned hold already
  -- passed that check before its immutable linkage was created.
  IF v_proof='completed_hold' THEN
    IF jsonb_typeof(v_hold.lines) IS DISTINCT FROM 'array' OR octet_length(v_hold.lines::text)>v_max_bytes THEN RETURN v_response; END IF;
    IF jsonb_array_length(v_hold.lines) NOT BETWEEN 1 AND jsonb_array_length(v_items)
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_hold.lines) line WHERE jsonb_typeof(line->'qty') IS DISTINCT FROM 'number')
      OR EXISTS (
        SELECT lower(NULLIF(line->>'productId','')),COALESCE(line->>'variantCode',''),sum((line->>'qty')::numeric)
        FROM jsonb_array_elements(v_hold.lines) line GROUP BY 1,2
        EXCEPT
        SELECT lower(item->>'product_id'),COALESCE(item->>'variant_code',''),sum((item->>'quantity')::numeric)
        FROM jsonb_array_elements(v_items) item GROUP BY 1,2
      ) THEN RETURN v_response; END IF;
  END IF;

  -- Checkout records gross cash handed over in paid_amount but ledger rows
  -- use the selected tender amounts in sales.payments (net of cash change).
  v_tenders:=COALESCE(NULLIF(v_sale.payments,'null'::jsonb),'[]'::jsonb);
  IF jsonb_typeof(v_tenders)<>'array' OR octet_length(v_tenders::text)>v_max_bytes THEN RETURN v_response; END IF;
  IF jsonb_array_length(v_tenders)>64 OR EXISTS(SELECT 1 FROM jsonb_array_elements(v_tenders) tender
    WHERE jsonb_typeof(tender->'amount') IS DISTINCT FROM 'number' OR jsonb_typeof(tender->'method') IS DISTINCT FROM 'string')
  THEN RETURN v_response; END IF;

  WITH rows AS MATERIALIZED (
    SELECT p.id,p.source_type,p.sale_id,p.booking_id,p.member_id,p.store_id,p.shift_id,p.terminal_id,p.amount,p.method,
      p.kind,p.reference,p.cashier_id,p.cashier_name,p.note,p.paid_at,p.created_at,p.updated_at,p.row_version,p.status,
      p.metadata,p.client_transaction_id,p.order_id,p.payment_method,p.transaction_reference
    FROM public.payment_transactions p WHERE p.sale_id=v_sale.id ORDER BY p.id LIMIT 65
  ), projected AS MATERIALIZED (
    SELECT id,amount,method,public.pos_sync_history_project_v1(to_jsonb(rows),'payment_transactions',p_keep_commerce) body FROM rows
    WHERE store_id=p_branch_id AND lower(shift_id::text)=p_shift_id::text AND booking_id IS NULL
      AND source_type='sale' AND kind IN ('payment','settlement') AND status='completed' AND amount>0
  )
  SELECT CASE WHEN (SELECT count(*) FROM rows)<=64 AND (SELECT count(*) FROM rows)=(SELECT count(*) FROM projected)
      AND COALESCE((SELECT sum(octet_length(body::text)+2) FROM projected),0)<=v_max_bytes
      AND ((EXISTS(SELECT 1 FROM projected) AND (SELECT sum(amount) FROM projected)>=v_sale.total_amount
          AND (jsonb_array_length(v_tenders)=0 OR ((SELECT count(*) FROM projected)=
            (SELECT count(*) FROM jsonb_array_elements(v_tenders) tender WHERE (tender->>'amount')::numeric<>0) AND NOT EXISTS (
            SELECT tender->>'method',(tender->>'amount')::numeric FROM jsonb_array_elements(v_tenders) tender WHERE (tender->>'amount')::numeric<>0
            EXCEPT ALL SELECT method,amount FROM projected
          ))))
        OR (NOT EXISTS(SELECT 1 FROM projected) AND v_sale.is_exchange IS TRUE AND v_sale.paid_amount=0 AND v_sale.total_amount=0
          AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v_tenders) tender WHERE (tender->>'amount')::numeric<>0)))
    THEN COALESCE((SELECT jsonb_agg(body ORDER BY id) FROM projected),'[]'::jsonb) END INTO v_payments;
  IF v_payments IS NULL THEN RETURN v_response; END IF;

  SELECT jsonb_build_object('sale',public.pos_sync_history_project_v1(to_jsonb(s),'sales',p_keep_commerce),
    'items',v_items,'payments',v_payments)::text INTO v_graph
  FROM (SELECT id,bill_number,member_id,store_id,cashier_name,subtotal_amount,total_amount,discount_amount,tax_amount,
    payment_type,points_earned,points_redeemed,is_exchange,original_bill_number,is_refunded,created_at,shift_id,paid_amount,
    change_amount,exchange_credit,exchanged_to_bill_number,coupon_code,coupon_promo_id,coupon_scope,coupon_discount,payments,
    client_transaction_id,cashier_id,created_by,updated_by,row_version,store_name_snapshot,store_address_snapshot,
    authorization_request_id,authorized_by,authorized_at,rounding_adjustment,rounding_label,branch_id,corrected_at
    FROM public.sales WHERE id=v_sale.id) s;
  IF v_graph IS NULL OR octet_length(v_graph)>v_max_bytes THEN RETURN v_response; END IF;
  RETURN v_response||jsonb_build_object('proof',v_proof,'graphJson',v_graph);
END $held_sale_review$;

REVOKE ALL ON FUNCTION public.pos_sync_held_sale_review_v1(text,text,text,uuid,text,text,uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.pos_sync_held_sale_review_v1(text,text,text,uuid,text,text,uuid,boolean) TO service_role;
-- REVIEWED_HELD_SALE_GRAPH_END

NOTIFY pgrst, 'reload schema';
COMMIT;
