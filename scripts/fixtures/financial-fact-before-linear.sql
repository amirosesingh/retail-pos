-- Test-only exact previous implementation, renamed as an isolated parity oracle.
CREATE FUNCTION fin62_cloud_preparation.financial_fact_before_linear(item jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=pg_catalog AS $fact$
DECLARE parsed json;payments jsonb;entry jsonb;amount jsonb;method text;folded text;list jsonb:='[]'::jsonb;total numeric;refunded boolean;
BEGIN
 IF jsonb_typeof(item)<>'object' OR NOT(item?'totalAmount' AND item?'paymentType' AND item?'paymentsJson' AND item?'isRefunded') OR
  jsonb_typeof(item->'totalAmount') NOT IN('string','null') OR jsonb_typeof(item->'paymentType') NOT IN('string','null') OR
  jsonb_typeof(item->'paymentsJson') NOT IN('string','null') OR jsonb_typeof(item->'isRefunded') NOT IN('boolean','null') THEN RAISE EXCEPTION 'FIN62_FINANCIAL_FACT_UNVERIFIED'; END IF;
 total:=CASE WHEN item->'totalAmount'='null'::jsonb THEN NULL ELSE fin62_preparation.math_decimal_text(item->>'totalAmount') END;
 refunded:=coalesce((item->>'isRefunded')::boolean,false);
 IF item->'paymentsJson'='null'::jsonb THEN payments:='null'::jsonb;
 ELSE
  BEGIN parsed:=CASE WHEN item->>'paymentsJson'='' THEN 'null'::json ELSE (item->>'paymentsJson')::json END;EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'FIN62_FINANCIAL_FACT_UNVERIFIED';END;
  PERFORM fin62_preparation.math_unique_json(parsed);payments:=parsed::jsonb;
  IF jsonb_typeof(payments)='array' THEN
   FOR entry IN SELECT value FROM jsonb_array_elements(payments) LOOP
    IF jsonb_typeof(entry)<>'object' THEN RAISE EXCEPTION 'FIN62_FINANCIAL_FACT_UNVERIFIED';END IF;
    IF entry?'amount' AND entry->'amount'<>'null'::jsonb THEN
     IF jsonb_typeof(entry->'amount') NOT IN('number','string') THEN RAISE EXCEPTION 'FIN62_FINANCIAL_FACT_UNVERIFIED';END IF;
     amount:=to_jsonb(fin62_preparation.math_decimal_text(entry->>'amount'));entry:=jsonb_set(entry,'{amount}',amount);
    END IF;
    method:=entry->>'method';folded:=translate(method,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz');
    IF jsonb_typeof(entry->'method')='string' AND folded COLLATE "C" IN('cash','card','wallet','bank_transfer','transfer','qr','online','ewallet') THEN entry:=jsonb_set(entry,'{method}',to_jsonb(folded));END IF;
    list:=list||jsonb_build_array(entry);
   END LOOP;payments:=list;
  END IF;
 END IF;
 IF jsonb_typeof(payments) IS DISTINCT FROM 'array' OR payments='[]'::jsonb THEN payments:='null'::jsonb;END IF;
 method:=item->>'paymentType';folded:=translate(method,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz');
 IF folded COLLATE "C" IN('cash','card','wallet','bank_transfer','transfer','qr','online','ewallet') THEN method:=folded;END IF;
 RETURN jsonb_build_object('id',fin62_cloud_preparation.fact_identity(item->>'id'),
  'branchId',fin62_cloud_preparation.fact_identity(item->>'branchId'),'shiftId',fin62_cloud_preparation.fact_identity(item->>'shiftId'),
  'totalAmount',total,'discountAmount',CASE WHEN item->>'discountAmount' IS NULL THEN 0 ELSE fin62_preparation.math_decimal_text(item->>'discountAmount') END,'paymentType',method,'payments',payments,'isRefunded',refunded);
END $fact$;
