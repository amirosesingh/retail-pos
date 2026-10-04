-- Sales are immutable after checkout except for the two monotonic lifecycle
-- fields below. Electron exchange checkout updates the original bill and
-- inserts the replacement bill in one local aggregate; preserve that link
-- when the aggregate is replayed in the cloud.
CREATE OR REPLACE FUNCTION public.sync_apply_sales(p_rows jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path=public,pg_temp
AS $fn$
DECLARE
  v_count integer;
BEGIN
  PERFORM set_config('pos.refunding','on',true);

  INSERT INTO public."sales" (
    "id","bill_number","member_id","store_id","cashier_name","subtotal_amount",
    "total_amount","discount_amount","tax_amount","payment_type","points_earned",
    "points_redeemed","is_exchange","original_bill_number","is_refunded","created_at",
    "shift_id","paid_amount","change_amount","exchange_credit","exchanged_to_bill_number",
    "coupon_code","coupon_promo_id","coupon_scope","coupon_discount","payments",
    "client_transaction_id","cashier_id","created_by","updated_by","row_version",
    "store_name_snapshot","store_address_snapshot","authorization_request_id",
    "authorized_by","authorized_at","rounding_adjustment","rounding_label","branch_id"
  )
  SELECT
    "id","bill_number","member_id","store_id","cashier_name","subtotal_amount",
    "total_amount","discount_amount","tax_amount","payment_type","points_earned",
    "points_redeemed","is_exchange","original_bill_number","is_refunded","created_at",
    "shift_id","paid_amount","change_amount","exchange_credit","exchanged_to_bill_number",
    "coupon_code","coupon_promo_id","coupon_scope","coupon_discount","payments",
    "client_transaction_id","cashier_id","created_by","updated_by","row_version",
    "store_name_snapshot","store_address_snapshot","authorization_request_id",
    "authorized_by","authorized_at","rounding_adjustment","rounding_label","branch_id"
  FROM jsonb_populate_recordset(NULL::public."sales", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO UPDATE SET
    "is_refunded"=(public."sales"."is_refunded" OR EXCLUDED."is_refunded"),
    "exchanged_to_bill_number"=COALESCE(
      public."sales"."exchanged_to_bill_number",
      EXCLUDED."exchanged_to_bill_number"
    ),
    "row_version"=GREATEST(public."sales"."row_version",EXCLUDED."row_version");

  GET DIAGNOSTICS v_count=ROW_COUNT;
  PERFORM set_config('pos.refunding','off',true);
  RETURN v_count;
END
$fn$;

REVOKE ALL ON FUNCTION public.sync_apply_sales(jsonb) FROM PUBLIC;
