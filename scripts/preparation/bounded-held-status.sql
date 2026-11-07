-- A bounded, read-only proof. It neither completes a sale nor changes a ticket.
CREATE OR REPLACE FUNCTION public.pos_sync_held_status_v1(
 p_organization_id text,p_branch_id text,p_terminal_id text,p_tickets jsonb,
 p_keep_commerce boolean DEFAULT false,p_max_bytes integer DEFAULT 2097152
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $held_status$
DECLARE
 v_ticket jsonb; v_held public.held_orders%ROWTYPE; v_parents jsonb; v_parent jsonb;
 v_projected jsonb; v_identity jsonb; v_lines jsonb; v_line jsonb; v_clean jsonb; v_coupon jsonb;
 v_key text; v_value jsonb; v_record jsonb; v_records jsonb:='[]'::jsonb; v_result jsonb;
 v_invalid boolean; v_status text; v_proof text; v_version text; v_updated text;
BEGIN
 -- This validator admits Operations only. The outer relay separately verifies
 -- the existing device-binding proof; a Management replica is not a writer.
 PERFORM public.pos_sync_validate_scope(p_organization_id,p_branch_id,p_terminal_id);
 IF p_tickets IS NULL OR jsonb_typeof(p_tickets)<>'array' OR jsonb_array_length(p_tickets)<1 OR jsonb_array_length(p_tickets)>100
 OR p_keep_commerce IS NULL OR p_max_bytes IS NULL OR p_max_bytes<1024 OR p_max_bytes>2097152
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='HELD_STATUS_INVALID_ARGUMENT'; END IF;
 FOR v_ticket IN SELECT value FROM jsonb_array_elements(p_tickets) LOOP
  IF jsonb_typeof(v_ticket)<>'object' THEN RAISE EXCEPTION 'HELD_STATUS_INVALID_TICKET'; END IF;
  IF NOT(v_ticket ?& ARRAY['id','billNo','shiftId']) OR v_ticket-'id'-'billNo'-'shiftId'<>'{}'::jsonb
  OR jsonb_typeof(v_ticket->'id')<>'string' OR length(v_ticket->>'id') NOT BETWEEN 1 AND 450
  OR jsonb_typeof(v_ticket->'billNo') NOT IN ('string','null') OR length(v_ticket->>'billNo')>450
  OR jsonb_typeof(v_ticket->'shiftId') NOT IN ('string','null') OR length(v_ticket->>'shiftId')>450
  THEN RAISE EXCEPTION 'HELD_STATUS_INVALID_TICKET'; END IF;
 END LOOP;
 IF (SELECT count(DISTINCT (value->>'id') COLLATE "C") FROM jsonb_array_elements(p_tickets))<>jsonb_array_length(p_tickets)
 THEN RAISE EXCEPTION 'HELD_STATUS_DUPLICATE_TICKET'; END IF;
 FOR v_ticket IN SELECT value FROM jsonb_array_elements(p_tickets) LOOP
  v_parent:=NULL;v_identity:=NULL;v_version:=NULL;v_updated:=NULL;
  SELECT * INTO v_held FROM public.held_orders h
   WHERE h.id=v_ticket->>'id' AND h.id COLLATE "C"=(v_ticket->>'id') COLLATE "C"
    AND h.store_id COLLATE "C"=p_branch_id COLLATE "C";
  IF FOUND THEN
   IF v_held.status IS NULL OR v_held.status NOT IN ('completed','cancelled') THEN CONTINUE; END IF;
   IF v_held.row_version IS NULL OR v_held.row_version<1 OR v_held.updated_at IS NULL OR NOT isfinite(v_held.updated_at)
    OR v_held.updated_at<'0001-01-01Z'::timestamptz OR v_held.updated_at>'9999-12-31T23:59:59.999999Z'::timestamptz THEN CONTINUE; END IF;
   v_status:=v_held.status;v_proof:='held';v_version:=v_held.row_version::text;
   v_updated:=to_char(v_held.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US')||'0Z';
   -- Existing privacy projection first, then a narrow business-identity allowlist.
   -- Labels, names, notes, costs, reasons and unknown/nested private fields are
   -- not an opaque side channel around normal sync privacy.
   v_projected:=public.pos_sync_history_project_v1(jsonb_build_object(
    'id',v_held.id,'store_id',v_held.store_id,'bill_no',v_held.bill_no,'shift_id',v_held.shift_id,
    'total',v_held.total,'cart_discount',v_held.cart_discount,'cart_discount_type',v_held.cart_discount_type,
    'exchange_ref',v_held.exchange_ref,'member_id',v_held.member_id,'coupon',v_held.coupon,'lines',v_held.lines,
    'pending_request_id',v_held.pending_request_id,'approval_snapshot_hash',v_held.approval_snapshot_hash),'held_orders',p_keep_commerce);
   v_identity:='{}'::jsonb;v_invalid:=false;
   FOR v_key,v_value IN SELECT key,value FROM jsonb_each(v_projected) LOOP
    IF v_key IN ('coupon','lines') THEN CONTINUE; END IF;
    IF jsonb_typeof(v_value) NOT IN ('string','number','boolean','null') THEN v_invalid:=true;EXIT;END IF;
    v_identity:=v_identity||jsonb_build_object(v_key,v_value);
   END LOOP;
   IF v_invalid OR jsonb_typeof(v_projected->'lines') IS DISTINCT FROM 'array' THEN CONTINUE;END IF;
   v_lines:='[]'::jsonb;
   FOR v_line IN SELECT value FROM jsonb_array_elements(v_projected->'lines') LOOP
    IF jsonb_typeof(v_line)<>'object' THEN v_invalid:=true;EXIT;END IF;
    v_clean:='{}'::jsonb;
    FOR v_key,v_value IN SELECT key,value FROM jsonb_each(v_line) WHERE key=ANY(ARRAY[
     'saleItemId','productId','variantCode','price','originalPrice','priceOverridden','qty','taxRate','discount','discountType',
     'credit','foc','promoId','couponCode','couponDiscount','bookingId','bookingRef']) LOOP
     IF jsonb_typeof(v_value) NOT IN ('string','number','boolean','null') THEN v_invalid:=true;EXIT;END IF;
     v_clean:=v_clean||jsonb_build_object(v_key,v_value);
    END LOOP;
    IF v_invalid THEN EXIT;END IF;
    v_lines:=v_lines||jsonb_build_array(v_clean);
   END LOOP;
   IF v_invalid THEN CONTINUE;END IF;
   v_coupon:=v_projected->'coupon';
   IF jsonb_typeof(v_coupon)='object' THEN
    v_clean:='{}'::jsonb;
    FOR v_key,v_value IN SELECT key,value FROM jsonb_each(v_coupon) WHERE key=ANY(ARRAY['code','promoId','scope','discount','productId']) LOOP
     IF jsonb_typeof(v_value) NOT IN ('string','number','boolean','null') THEN v_invalid:=true;EXIT;END IF;
     v_clean:=v_clean||jsonb_build_object(v_key,v_value);
    END LOOP;
    v_coupon:=v_clean;
   ELSIF jsonb_typeof(v_coupon) IS DISTINCT FROM 'null' THEN v_invalid:=true;END IF;
   IF v_invalid THEN CONTINUE;END IF;
   v_identity:=v_identity||jsonb_build_object('lines',v_lines,'coupon',v_coupon);
   IF v_status='completed' THEN
    SELECT COALESCE(jsonb_agg(parent),'[]'::jsonb) INTO v_parents FROM (
     SELECT jsonb_build_object('kind','sale','id',s.id::text,'storeId',s.store_id,'billNo',s.bill_number,'shiftId',s.shift_id) parent
      FROM public.sales s WHERE s.store_id COLLATE "C"=p_branch_id COLLATE "C" AND NULLIF(v_held.bill_no,'') IS NOT NULL
      AND s.bill_number=v_held.bill_no AND s.bill_number COLLATE "C"=v_held.bill_no COLLATE "C"
     UNION ALL
     SELECT jsonb_build_object('kind','booking','id',b.id::text,'storeId',b.store_id,'billNo',NULL,'shiftId',b.shift_id)
      FROM public.bookings b WHERE b.id=CASE WHEN v_held.note ~ '^booking:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN right(v_held.note,36)::uuid ELSE NULL END
      AND b.store_id COLLATE "C"=p_branch_id COLLATE "C"
      AND v_held.note COLLATE "C"=('booking:'||b.id::text) COLLATE "C" AND b.shift_id IS NOT DISTINCT FROM v_held.shift_id
     LIMIT 2
    ) matched;
    IF jsonb_array_length(v_parents)<>1 THEN CONTINUE;END IF;v_parent:=v_parents->0;
   END IF;
  ELSE
   -- Absence never means cancelled or uploaded. A matching accepted parent is
   -- a different proof, whose original local receipt/CT checks remain in Main.
   IF NULLIF(v_ticket->>'billNo','') IS NULL THEN CONTINUE;END IF;
   SELECT COALESCE(jsonb_agg(parent),'[]'::jsonb) INTO v_parents FROM (
    SELECT jsonb_build_object('kind','sale','id',s.id::text,'storeId',s.store_id,'billNo',s.bill_number,'shiftId',s.shift_id) parent
     FROM public.sales s WHERE s.store_id COLLATE "C"=p_branch_id COLLATE "C"
     AND s.bill_number=v_ticket->>'billNo' AND s.bill_number COLLATE "C"=(v_ticket->>'billNo') COLLATE "C"
     AND (v_ticket->'shiftId'='null'::jsonb OR s.shift_id IS NOT DISTINCT FROM v_ticket->>'shiftId')
     LIMIT 2
   ) matched;
   IF jsonb_array_length(v_parents)<>1 THEN CONTINUE;END IF;
   v_parent:=v_parents->0;v_status:='completed';v_proof:='accepted_parent';
  END IF;
  v_record:=jsonb_build_object('id',v_ticket->>'id','status',v_status,'proofFrom',v_proof,
   'rowVersion',v_version,'updatedAt',v_updated,'identityJson',CASE WHEN v_identity IS NULL THEN NULL ELSE v_identity::text END,'parent',v_parent);
  v_records:=v_records||jsonb_build_array(v_record);
 END LOOP;
 v_result:=jsonb_build_object('ok',true,'heldStatusVersion',1,'organizationId',p_organization_id,'branchId',p_branch_id,'terminalId',p_terminal_id,'records',v_records);
 IF octet_length(v_result::text)>p_max_bytes THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='HELD_STATUS_TOO_LARGE';END IF;
 PERFORM set_config('response.headers',jsonb_build_array(
  jsonb_build_object('X-POS-Held-Status-Version','1'),
  jsonb_build_object('X-POS-Held-Status-Bytes',octet_length(v_result::text)::text),
  jsonb_build_object('X-POS-Held-Status-Rows',jsonb_array_length(v_records)::text))::text,true);
 RETURN v_result;
END;
$held_status$;
