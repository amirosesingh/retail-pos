-- Apply after the scoped booking RPCs and the terminal-bound aggregate writer.
-- Both existing sale paths retain their scope, financial and checkout guards.
BEGIN;

CREATE OR REPLACE FUNCTION public.booking_handover(
  _booking_id uuid, _amount numeric, _sale jsonb, _items jsonb,
  _payments jsonb, _movements jsonb, _member jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
AS $handover$
DECLARE
  booking public.bookings%ROWTYPE;
  receipt public.sales%ROWTYPE;
  payment public.booking_payments%ROWTYPE;
  settled record;
  sale_id uuid := nullif(_sale->>'id', '')::uuid;
  attempt text := nullif(_sale->>'client_transaction_id', '');
  method text := nullif(_sale->>'payment_type', '');
  replayed boolean;
BEGIN
  IF (SELECT auth.uid()) IS NULL OR public.is_staff_now() IS NOT TRUE OR
      public.has_perm('can_collect_booking') IS NOT TRUE THEN
    RAISE EXCEPTION 'PERMISSION_DENIED_COLLECT_BOOKING' USING ERRCODE = '42501';
  END IF;
  IF public.has_perm('can_process_sale') IS NOT TRUE THEN
    RAISE EXCEPTION 'PERMISSION_DENIED_SALE' USING ERRCODE = '42501';
  END IF;
  IF sale_id IS NULL OR attempt IS DISTINCT FROM sale_id::text OR method IS NULL OR
      nullif(_sale->>'bill_number', '') IS NULL OR _amount IS NULL OR
      _amount::text IN ('NaN', 'Infinity', '-Infinity') OR _amount < 0 OR
      coalesce((_sale->>'is_exchange')::boolean, false) OR coalesce((_sale->>'is_refunded')::boolean, false) OR
      nullif(_sale->>'original_bill_number', '') IS NOT NULL THEN
    RAISE EXCEPTION 'BOOKING_HANDOVER_INVALID' USING ERRCODE = '22023';
  END IF;

  SELECT b.* INTO booking FROM public.bookings b
   WHERE b.id = _booking_id AND b.store_id = _sale->>'store_id'
     AND public.store_visible(b.store_id) AND public.user_has_store_access(b.store_id)
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BOOKING_NOT_FOUND'; END IF;
  IF booking.status = 'cancelled' THEN RAISE EXCEPTION 'BOOKING_CANCELLED'; END IF;
  replayed := booking.status = 'collected';

  IF replayed THEN
    SELECT s.* INTO receipt FROM public.sales s WHERE s.id = sale_id AND s.client_transaction_id = attempt
      AND s.store_id = booking.store_id AND s.bill_number = booking.sale_receipt_no;
    IF NOT FOUND THEN RAISE EXCEPTION 'BOOKING_ALREADY_COLLECTED'; END IF;
  ELSE
    IF booking.status IS DISTINCT FROM 'active' OR booking.sale_receipt_no IS NOT NULL OR
        round((_sale->>'total_amount')::numeric, 2) IS DISTINCT FROM round(booking.total, 2) OR
        round((_sale->>'paid_amount')::numeric, 2) IS DISTINCT FROM round(booking.total, 2) OR
        nullif(_sale->>'member_id', '')::uuid IS DISTINCT FROM booking.member_id OR
        (_member IS NOT NULL AND nullif(_member->>'id', '')::uuid IS DISTINCT FROM booking.member_id) THEN
      RAISE EXCEPTION 'BOOKING_CHANGED';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended('pos-booking-sale:' || sale_id::text, 0));
    IF EXISTS (SELECT 1 FROM public.sales s WHERE s.id = sale_id OR s.client_transaction_id = attempt) THEN
      RAISE EXCEPTION 'BOOKING_CHANGED';
    END IF;
    SELECT * INTO STRICT settled FROM public.booking_collect(
      booking.id, round(_amount, 2), method, _sale->>'cashier_name', NULL, attempt, true
    );
    IF settled.duplicate THEN RAISE EXCEPTION 'BOOKING_CHANGED'; END IF;
    IF NOT settled.fully_paid OR settled.status IS DISTINCT FROM 'collected' THEN
      RAISE EXCEPTION 'BOOKING_BALANCE_DUE';
    END IF;
    PERFORM public.pos_sale_commit(
      _sale || jsonb_build_object('change_amount', settled.change_due), _items, _payments, _movements, _member, NULL
    );
    SELECT s.* INTO STRICT receipt FROM public.sales s WHERE s.id = sale_id AND s.client_transaction_id = attempt
      AND s.store_id = booking.store_id AND s.bill_number = _sale->>'bill_number';
    UPDATE public.bookings b SET sale_receipt_no = receipt.bill_number
      WHERE b.id = booking.id AND b.store_id = booking.store_id AND b.status = 'collected'
      RETURNING b.* INTO STRICT booking;
  END IF;

  SELECT p.* INTO payment FROM public.booking_payments p
    WHERE p.booking_id = booking.id AND p.client_payment_id = attempt AND p.status = 'settled' AND p.kind = 'payment';
  RETURN jsonb_build_object(
    'sale_id', receipt.id, 'sale_receipt_no', receipt.bill_number, 'sale_created_at', receipt.created_at,
    'closed_at', booking.closed_at, 'paid', booking.paid, 'change', receipt.change_amount, 'replayed', replayed,
    'payment', CASE WHEN payment.id IS NOT NULL THEN to_jsonb(payment) ELSE NULL END,
    'sale', CASE WHEN replayed THEN to_jsonb(receipt) || jsonb_build_object('sale_items',
      (SELECT coalesce(jsonb_agg(to_jsonb(i) ORDER BY i.id), '[]'::jsonb) FROM public.sale_items i WHERE i.sale_id = receipt.id))
      ELSE NULL END
  );
END;
$handover$;

REVOKE ALL ON FUNCTION public.booking_handover(uuid,numeric,jsonb,jsonb,jsonb,jsonb,jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.booking_handover(uuid,numeric,jsonb,jsonb,jsonb,jsonb,jsonb) TO authenticated;

-- The normal native event stream already sends the complete local transaction.
-- Its dependency order puts bookings before payments, which is right for
-- creation and wrong for collecting an existing booking with one last tender.
CREATE OR REPLACE FUNCTION private.check_booking_handover_upload(
  p_branch text, p_operations jsonb, p_after boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
AS $upload$
DECLARE
  handover record;
  booking public.bookings%ROWTYPE;
  payment public.booking_payments%ROWTYPE;
  sale public.sales%ROWTYPE;
  payment_json jsonb;
  booking_order bigint;
  total numeric;
  tender numeric;
  paid numeric;
  version integer;
BEGIN
  WITH rows AS (
    SELECT op.value->>'table' AS name, op.ordinality, r.value
    FROM jsonb_array_elements(p_operations) WITH ORDINALITY op
    CROSS JOIN LATERAL jsonb_array_elements(coalesce(op.value->'rows','[]'::jsonb)) r
    WHERE op.value->>'table' IN ('bookings','sales')
  )
  SELECT b.value AS booking_row, s.value AS sale_row, b.ordinality AS booking_order INTO handover
  FROM rows b JOIN rows s ON s.name = 'sales' AND s.value->>'bill_number' = b.value->>'sale_receipt_no'
  WHERE b.name = 'bookings' AND b.value->>'status' = 'collected';
  IF NOT FOUND THEN RETURN p_operations; END IF;

  IF (SELECT count(*) FROM jsonb_array_elements(p_operations) op
      WHERE op->>'table' = 'bookings') <> 1 OR
     (SELECT count(*) FROM jsonb_array_elements(p_operations) op
      WHERE op->>'table' = 'sales') <> 1 OR
     jsonb_array_length(p_operations->(handover.booking_order::integer-1)->'rows') <> 1 OR
     NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_operations) op
       WHERE op->>'table' = 'sales' AND jsonb_array_length(op->'rows') = 1) OR
     (SELECT count(*) FROM jsonb_array_elements(p_operations) op
      WHERE op->>'table' = 'booking_payments') > 1 OR
     EXISTS (SELECT 1 FROM jsonb_array_elements(p_operations) op
       WHERE op->>'table' = 'booking_payments' AND
       (jsonb_array_length(op->'rows') <> 1 OR coalesce((op->>'deletePhase')::boolean,false))) OR
     handover.booking_row->>'store_id' IS DISTINCT FROM p_branch OR
     handover.sale_row->>'store_id' IS DISTINCT FROM p_branch OR
     handover.sale_row->>'id' IS DISTINCT FROM handover.sale_row->>'client_transaction_id' OR
     coalesce((handover.sale_row->>'is_refunded')::boolean, false) OR
     coalesce((handover.sale_row->>'is_exchange')::boolean, false) THEN
    RAISE EXCEPTION 'BOOKING_HANDOVER_UPLOAD_INVALID';
  END IF;

  SELECT op->'rows'->0 INTO payment_json FROM jsonb_array_elements(p_operations) op
    WHERE op->>'table' = 'booking_payments';
  IF payment_json IS NOT NULL AND (payment_json->>'booking_id' IS DISTINCT FROM handover.booking_row->>'id' OR
      payment_json->>'client_payment_id' IS DISTINCT FROM handover.sale_row->>'client_transaction_id' OR
      payment_json->>'method' IS DISTINCT FROM handover.sale_row->>'payment_type' OR
      payment_json->>'status' IS DISTINCT FROM 'settled' OR payment_json->>'kind' IS DISTINCT FROM 'payment' OR
      NOT coalesce((payment_json->>'amount')::numeric > 0, false)) THEN
    RAISE EXCEPTION 'BOOKING_HANDOVER_UPLOAD_INVALID';
  END IF;

  SELECT b.* INTO booking FROM public.bookings b
    WHERE b.id = (handover.booking_row->>'id')::uuid AND b.store_id = p_branch FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BOOKING_HANDOVER_UPLOAD_BOOKING_MISSING'; END IF;
  total := round(booking.total, 2);
  tender := coalesce(round((payment_json->>'amount')::numeric, 2), 0);
  paid := public.booking_net_paid(booking.id);
  version := (handover.booking_row->>'row_version')::integer;
  IF version IS NULL OR total IS NULL OR
     round((handover.booking_row->>'total')::numeric, 2) IS DISTINCT FROM total OR
     round((handover.booking_row->>'paid')::numeric, 2) IS DISTINCT FROM total OR
     round((handover.sale_row->>'total_amount')::numeric, 2) IS DISTINCT FROM total OR
     round((handover.sale_row->>'paid_amount')::numeric, 2) IS DISTINCT FROM total OR
     nullif(handover.sale_row->>'member_id', '')::uuid IS DISTINCT FROM booking.member_id THEN
    RAISE EXCEPTION 'BOOKING_HANDOVER_UPLOAD_CONFLICT';
  END IF;

  IF p_after THEN
    SELECT s.* INTO sale FROM public.sales s WHERE s.id = (handover.sale_row->>'id')::uuid
      AND s.store_id = p_branch AND s.client_transaction_id = handover.sale_row->>'client_transaction_id'
      AND s.bill_number = handover.booking_row->>'sale_receipt_no';
    IF NOT FOUND OR booking.status IS DISTINCT FROM 'collected' OR
       booking.sale_receipt_no IS DISTINCT FROM sale.bill_number OR booking.row_version IS DISTINCT FROM version OR
       round(booking.paid, 2) IS DISTINCT FROM total OR paid IS DISTINCT FROM total THEN
      RAISE EXCEPTION 'BOOKING_HANDOVER_UPLOAD_UNCONFIRMED';
    END IF;
    IF payment_json IS NOT NULL THEN
      SELECT p.* INTO payment FROM public.booking_payments p WHERE p.id = (payment_json->>'id')::uuid
        AND p.booking_id = booking.id AND p.client_payment_id = sale.client_transaction_id;
      IF NOT FOUND OR round(payment.amount, 2) IS DISTINCT FROM tender OR
        payment.status IS DISTINCT FROM 'settled' OR payment.kind IS DISTINCT FROM 'payment' THEN
        RAISE EXCEPTION 'BOOKING_HANDOVER_UPLOAD_UNCONFIRMED';
      END IF;
    END IF;
    RETURN p_operations;
  END IF;

  IF booking.status IS DISTINCT FROM 'active' OR booking.sale_receipt_no IS NOT NULL OR
     booking.row_version IS DISTINCT FROM version-1 OR paid + tender IS DISTINCT FROM total OR
     EXISTS (SELECT 1 FROM public.sales s WHERE s.id = (handover.sale_row->>'id')::uuid
       OR s.client_transaction_id = handover.sale_row->>'client_transaction_id') OR
     (payment_json IS NOT NULL AND EXISTS (SELECT 1 FROM public.booking_payments p
       WHERE p.id = (payment_json->>'id')::uuid OR
         (p.booking_id = booking.id AND p.client_payment_id = payment_json->>'client_payment_id'))) THEN
    RAISE EXCEPTION 'BOOKING_HANDOVER_UPLOAD_CONFLICT';
  END IF;
  IF payment_json IS NULL THEN RETURN p_operations; END IF;

  booking_order := handover.booking_order;
  RETURN (SELECT jsonb_agg(op.value ORDER BY
    CASE WHEN op.value->>'table' = 'booking_payments' THEN booking_order ELSE op.ordinality END,
    CASE WHEN op.value->>'table' = 'booking_payments' THEN 0 ELSE 1 END)
    FROM jsonb_array_elements(p_operations) WITH ORDINALITY op);
END;
$upload$;

REVOKE ALL ON FUNCTION private.check_booking_handover_upload(text,jsonb,boolean) FROM PUBLIC, anon, authenticated, service_role;

-- Keep the current route (including the cash owner and FIN62 checks), OID,
-- existing hash and duplicate semantics. Change only the new-write loop.
DO $install_handover_upload$
DECLARE
  target regprocedure := to_regprocedure('public.pos_sync_push_aggregate(uuid,text,text,text,jsonb)');
  definition text;
  begin_rows constant text := 'FOR v_op IN SELECT value FROM jsonb_array_elements(p_operations) LOOP';
  before_receipt constant text := 'INSERT INTO public.sync_idempotency_receipts(batch_id,organization_id,branch_id,table_name,payload_hash,applied_count)';
BEGIN
  SELECT replace(pg_get_functiondef(proc.oid), E'\r\n', E'\n') INTO definition
    FROM pg_proc proc WHERE proc.oid = target AND proc.prosecdef AND pg_get_userbyid(proc.proowner) = current_user;
  IF definition IS NULL OR has_function_privilege('anon', target, 'EXECUTE') OR
     has_function_privilege('authenticated', target, 'EXECUTE') OR
     NOT has_function_privilege('service_role', target, 'EXECUTE') OR
     strpos(definition, 'private.check_booking_handover_upload') <> 0 OR
     length(definition)-length(replace(definition,begin_rows,'')) <> length(begin_rows) OR
     length(definition)-length(replace(definition,before_receipt,'')) <> length(before_receipt) OR
     strpos(definition, 'pos_sync_validate_scope') = 0 OR
     strpos(definition, 'SYNC_IDEMPOTENCY_MISMATCH') = 0 OR
     strpos(definition, 'SYNC_IDEMPOTENCY_MISMATCH') > strpos(definition, begin_rows) OR
     strpos(definition, begin_rows) > strpos(definition, before_receipt) THEN
    RAISE EXCEPTION 'POS_BOOKING_HANDOVER_WRITER_SOURCE_UNEXPECTED';
  END IF;
  definition := replace(definition, begin_rows,
    'p_operations := private.check_booking_handover_upload(p_branch_id,p_operations,false);' || E'\n ' || begin_rows);
  EXECUTE replace(definition, before_receipt,
    'PERFORM private.check_booking_handover_upload(p_branch_id,p_operations,true);' || E'\n ' || before_receipt);
END;
$install_handover_upload$;

NOTIFY pgrst, 'reload schema';
COMMIT;
