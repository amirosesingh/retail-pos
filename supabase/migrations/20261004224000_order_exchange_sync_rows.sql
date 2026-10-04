-- Apply exchange aggregates in two phases. Change tracking does not promise
-- that the replacement bill precedes the original bill whose link it fills.
CREATE OR REPLACE FUNCTION public.sync_apply_sales(p_rows jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path=public,pg_temp
AS $fn$
DECLARE
  v_count integer;
  v_link_count integer;
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
    "shift_id","paid_amount","change_amount","exchange_credit",NULL::text,
    "coupon_code","coupon_promo_id","coupon_scope","coupon_discount","payments",
    "client_transaction_id","cashier_id","created_by","updated_by","row_version",
    "store_name_snapshot","store_address_snapshot","authorization_request_id",
    "authorized_by","authorized_at","rounding_adjustment","rounding_label","branch_id"
  FROM jsonb_populate_recordset(NULL::public."sales", COALESCE(p_rows,'[]'::jsonb))
  ORDER BY COALESCE("is_exchange", false), "created_at", "id"
  ON CONFLICT ("id") DO UPDATE SET
    "is_refunded"=(public."sales"."is_refunded" OR EXCLUDED."is_refunded"),
    "row_version"=GREATEST(public."sales"."row_version",EXCLUDED."row_version");

  GET DIAGNOSTICS v_count=ROW_COUNT;

  UPDATE public."sales" AS target
     SET "exchanged_to_bill_number"=incoming."exchanged_to_bill_number"
    FROM jsonb_populate_recordset(NULL::public."sales", COALESCE(p_rows,'[]'::jsonb)) AS incoming
   WHERE target."id"=incoming."id"
     AND incoming."exchanged_to_bill_number" IS NOT NULL
     AND target."exchanged_to_bill_number" IS NULL;

  GET DIAGNOSTICS v_link_count=ROW_COUNT;
  PERFORM set_config('pos.refunding','off',true);
  RETURN v_count + v_link_count;
END
$fn$;

REVOKE ALL ON FUNCTION public.sync_apply_sales(jsonb) FROM PUBLIC;
