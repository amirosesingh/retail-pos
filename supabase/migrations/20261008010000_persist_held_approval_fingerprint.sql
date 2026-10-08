ALTER TABLE public.held_orders
  ADD COLUMN IF NOT EXISTS approval_snapshot_hash text;

CREATE OR REPLACE FUNCTION public.sync_apply_held_orders(p_rows jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN
  INSERT INTO public.held_orders
    (id,label,store_id,shift_id,held_by,total,lines,cart_discount,cart_discount_type,
     exchange_ref,member_id,member_name,coupon,note,cancelled_from,held_at,created_at,
     updated_at,row_version,status,pending_request_id,bill_no,approval_snapshot_hash)
  SELECT id,label,store_id,shift_id,held_by,total,lines,cart_discount,cart_discount_type,
     exchange_ref,member_id,member_name,coupon,note,cancelled_from,held_at,created_at,
     updated_at,row_version,status,pending_request_id,bill_no,approval_snapshot_hash
  FROM jsonb_populate_recordset(NULL::public.held_orders, COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT (id) DO UPDATE SET label=EXCLUDED.label,store_id=EXCLUDED.store_id,
    shift_id=EXCLUDED.shift_id,held_by=EXCLUDED.held_by,total=EXCLUDED.total,
    lines=EXCLUDED.lines,cart_discount=EXCLUDED.cart_discount,
    cart_discount_type=EXCLUDED.cart_discount_type,exchange_ref=EXCLUDED.exchange_ref,
    member_id=EXCLUDED.member_id,member_name=EXCLUDED.member_name,coupon=EXCLUDED.coupon,
    note=EXCLUDED.note,cancelled_from=EXCLUDED.cancelled_from,held_at=EXCLUDED.held_at,
    created_at=EXCLUDED.created_at,updated_at=EXCLUDED.updated_at,
    row_version=EXCLUDED.row_version,status=EXCLUDED.status,
    pending_request_id=EXCLUDED.pending_request_id,bill_no=EXCLUDED.bill_no,
    approval_snapshot_hash=EXCLUDED.approval_snapshot_hash
  WHERE EXCLUDED.row_version > public.held_orders.row_version;
  GET DIAGNOSTICS v_count=ROW_COUNT;
  RETURN v_count;
END $fn$;

REVOKE ALL ON FUNCTION public.sync_apply_held_orders(jsonb) FROM PUBLIC;
