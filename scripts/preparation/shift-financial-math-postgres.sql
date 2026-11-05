-- FIN62 isolated canonical-v2 math preparation ONLY. No RPC, admission, author
-- verification, completeness claim, runtime wiring or business-table reads.
-- Approved NEW-action rule: exact decimals; final 2dp ties away from zero.
-- Native legacy-v1 evaluation remains explicitly unverified: SQL Server/JS
-- expression scales differ. Never recalculate accepted history through v2.
CREATE SCHEMA IF NOT EXISTS fin62_preparation;
CREATE OR REPLACE FUNCTION fin62_preparation.math_label_length(input text)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $fn$
 SELECT coalesce(sum(CASE WHEN ascii(character)>65535 THEN 2 ELSE 1 END),0)::integer FROM regexp_split_to_table(input,'') character;
$fn$;
CREATE OR REPLACE FUNCTION fin62_preparation.math_decimal_text(input text)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $fn$
DECLARE token text; exponent_text text; value numeric; coefficient text;
BEGIN
 token:=btrim(input,E' \t\n\r\f'||chr(11));
 IF token IS NULL OR length(token)>128 OR token !~ '^[+-]?([0-9]+(\.[0-9]*)?|\.[0-9]+)([eE][+-]?[0-9]+)?$' THEN RAISE EXCEPTION 'FIN62_NUMERIC_UNSUPPORTED'; END IF;
 exponent_text:=substring(token FROM '[eE]([+-]?[0-9]+)$');
 IF exponent_text IS NOT NULL AND abs(exponent_text::numeric)>38 THEN RAISE EXCEPTION 'FIN62_NUMERIC_UNSUPPORTED'; END IF;
 value:=trim_scale(token::numeric);
 coefficient:=ltrim(replace(abs(value)::text,'.',''),'0');
 IF scale(value)>38 OR length(coefficient)>76 THEN RAISE EXCEPTION 'FIN62_NUMERIC_UNSUPPORTED'; END IF;
 RETURN value;
END $fn$;
CREATE OR REPLACE FUNCTION fin62_preparation.math_unique_json(input json,depth integer DEFAULT 0)
RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,fin62_preparation AS $fn$
DECLARE child json;
BEGIN
 IF depth>64 THEN RAISE EXCEPTION 'FIN62_BASIS_LIMIT'; END IF;
 IF json_typeof(input)='object' THEN
  IF EXISTS(SELECT 1 FROM json_each(input) GROUP BY key COLLATE "C" HAVING count(*)>1) THEN RAISE EXCEPTION 'FIN62_DUPLICATE_JSON_KEY'; END IF;
  FOR child IN SELECT value FROM json_each(input) LOOP PERFORM math_unique_json(child,depth+1); END LOOP;
 ELSIF json_typeof(input)='array' THEN
  FOR child IN SELECT value FROM json_array_elements(input) LOOP PERFORM math_unique_json(child,depth+1); END LOOP;
 END IF;
END $fn$;
CREATE OR REPLACE FUNCTION fin62_preparation.math_method(input text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $fn$
DECLARE method text; trimmed text;
BEGIN
 method:=translate(coalesce(input,''),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz');
 trimmed:=btrim(method,E' \t\n\r\f'||chr(11));
 IF method IS DISTINCT FROM trimmed AND trimmed COLLATE "C" IN('cash','card','wallet','bank_transfer','transfer','qr','online','ewallet') THEN RAISE EXCEPTION 'FIN62_METHOD_CONTEXT_REQUIRED'; END IF;
 RETURN method;
END $fn$;
CREATE OR REPLACE FUNCTION fin62_preparation.validate_financial_math(basis jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,fin62_preparation AS $fn$
DECLARE canonical boolean; opening numeric; cash_total numeric:=0;card_total numeric:=0;digital_total numeric:=0;
 input jsonb;identifier text; total numeric; paid numeric; cash numeric; card numeric; digital numeric;
 method text; raw text; parsed json; payment json; amount_value json; method_value json; amount numeric;
 split boolean; refunded boolean; net_cash numeric; expected jsonb; failure text;
BEGIN
 IF basis IS NULL OR jsonb_typeof(basis)<>'object' THEN RAISE EXCEPTION 'FIN62_BASIS_LIMIT'; END IF;
 IF jsonb_typeof(basis->'prototypeVersion') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'FIN62_LEGACY_CONTEXT_REQUIRED'; END IF;
 IF basis->>'prototypeVersion'='1' AND basis->>'formula'='sqlserver-current-sales-net-refund-raw-v1' THEN RAISE EXCEPTION 'FIN62_LEGACY_NATIVE_MATH_UNVERIFIED'; END IF;
 IF basis->>'prototypeVersion'='2' AND basis->>'formula'='canonical-exact-decimal-v2' THEN canonical:=true;
 ELSIF basis->>'prototypeVersion'='1' AND basis->>'formula'='current-sales-net-refund-v1' THEN canonical:=false;
 ELSE RAISE EXCEPTION 'FIN62_LEGACY_CONTEXT_REQUIRED'; END IF;
 IF jsonb_typeof(basis->'inputs') IS DISTINCT FROM 'array' OR jsonb_array_length(basis->'inputs')>20000 THEN RAISE EXCEPTION 'FIN62_BASIS_LIMIT'; END IF;
 IF jsonb_typeof(basis->'branchId') IS DISTINCT FROM 'string' OR nullif(basis->>'branchId','') IS NULL OR math_label_length(basis->>'branchId')>128 OR
  coalesce(basis->>'shiftId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RAISE EXCEPTION 'FIN62_INPUT_INVALID'; END IF;
 IF NOT basis?'openingFloat' OR jsonb_typeof(basis->'openingFloat') NOT IN('string','null') THEN RAISE EXCEPTION 'FIN62_INPUT_INVALID'; END IF;
 opening:=CASE WHEN basis->'openingFloat'='null'::jsonb THEN 0 ELSE math_decimal_text(basis->>'openingFloat') END;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(basis->'inputs') GROUP BY (value->>'id') COLLATE "C" HAVING count(*)>1) THEN RAISE EXCEPTION 'FIN62_INPUT_INVALID'; END IF;
 FOR input IN SELECT value FROM jsonb_array_elements(basis->'inputs') LOOP
  identifier:=input->>'id';
  IF jsonb_typeof(input)<>'object' OR jsonb_typeof(input->'branchId') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'shiftId') IS DISTINCT FROM 'string' OR
   identifier IS NULL OR identifier !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' OR
   input->>'branchId' IS DISTINCT FROM basis->>'branchId' OR input->>'shiftId' IS DISTINCT FROM basis->>'shiftId'
  THEN RAISE EXCEPTION 'FIN62_INPUT_INVALID'; END IF;
  IF NOT input?'totalAmount' OR NOT input?'paymentType' OR NOT input?'rowVersion' OR
   jsonb_typeof(input->'totalAmount') NOT IN('string','null') OR jsonb_typeof(input->'paymentType') NOT IN('string','null') OR
   jsonb_typeof(input->'rowVersion') NOT IN('string','null') THEN RAISE EXCEPTION 'FIN62_INPUT_INVALID'; END IF;
  IF canonical THEN
   IF NOT input?'paymentsJson' OR NOT input?'isRefunded' OR jsonb_typeof(input->'isRefunded') NOT IN('boolean','null') OR jsonb_typeof(input->'paymentsJson') NOT IN('string','null') THEN RAISE EXCEPTION 'FIN62_INPUT_INVALID'; END IF;
   refunded:=coalesce((input->>'isRefunded')::boolean,false);
   -- Retain all raw refunded inputs, without parsing payments the established
   -- formula excludes. This does not omit a row from the supplied snapshot.
   IF refunded THEN CONTINUE; END IF;
   raw:=input->>'paymentsJson';parsed:=NULL;
   IF raw IS NOT NULL AND raw<>'' THEN
    BEGIN parsed:=raw::json; EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'FIN62_PAYMENTS_UNVERIFIED'; END;
    PERFORM math_unique_json(parsed);
   END IF;
   split:=CASE WHEN json_typeof(parsed)='array' THEN json_array_length(parsed)>0 ELSE false END;
  ELSE
   IF NOT input?'payments' OR NOT input?'refunded' OR jsonb_typeof(input->'refunded') NOT IN('boolean','null') THEN RAISE EXCEPTION 'FIN62_INPUT_INVALID'; END IF;
   refunded:=coalesce((input->>'refunded')::boolean,false);IF refunded THEN CONTINUE;END IF;
   parsed:=(input->'payments')::json;
   split:=CASE WHEN json_typeof(parsed)='array' THEN json_array_length(parsed)>0 ELSE false END;
  END IF;
  total:=CASE WHEN input->'totalAmount'='null'::jsonb THEN NULL ELSE math_decimal_text(input->>'totalAmount') END;
  paid:=0;cash:=0;card:=0;digital:=0;
  IF split THEN
   FOR payment IN SELECT value FROM json_array_elements(parsed) LOOP
    IF canonical AND json_typeof(payment) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'FIN62_INPUT_INVALID'; END IF;
    amount_value:=NULL;method_value:=NULL;
    IF json_typeof(payment)='object' THEN
     SELECT value INTO amount_value FROM json_each(payment) WHERE key='amount' LIMIT 1;
     SELECT value INTO method_value FROM json_each(payment) WHERE key='method' LIMIT 1;
    END IF;
    amount:=0;
    IF amount_value IS NOT NULL AND json_typeof(amount_value)<>'null' THEN
     IF json_typeof(amount_value) NOT IN('number','string') THEN RAISE EXCEPTION 'FIN62_NUMERIC_UNSUPPORTED'; END IF;
     amount:=math_decimal_text(amount_value#>>'{}');
    END IF;
    IF canonical AND method_value IS NOT NULL AND json_typeof(method_value) NOT IN('string','null') THEN RAISE EXCEPTION 'FIN62_INPUT_INVALID'; END IF;
    method:=CASE WHEN canonical THEN math_method(method_value#>>'{}') ELSE lower(coalesce(method_value#>>'{}','')) END;paid:=paid+amount;
    IF method COLLATE "C"='cash' THEN cash:=cash+amount;
    ELSIF method COLLATE "C"='card' THEN card:=card+amount;
    ELSIF method COLLATE "C" IN('wallet','bank_transfer','transfer','qr','online','ewallet') THEN digital:=digital+amount; END IF;
   END LOOP;
   net_cash:=CASE WHEN cash>0 THEN greatest(0,cash-greatest(0,paid-coalesce(total,0))) ELSE cash END;
  ELSE
   method:=CASE WHEN canonical THEN math_method(input->>'paymentType') ELSE lower(coalesce(input->>'paymentType','')) END;
   net_cash:=CASE WHEN method COLLATE "C"='cash' THEN coalesce(total,0) ELSE 0 END;
   card:=CASE WHEN method COLLATE "C"='card' THEN coalesce(total,0) ELSE 0 END;
   digital:=CASE WHEN method COLLATE "C" IN('wallet','bank_transfer','transfer','qr','online','ewallet') THEN coalesce(total,0) ELSE 0 END;
  END IF;
  cash_total:=cash_total+net_cash;card_total:=card_total+card;digital_total:=digital_total+digital;
 END LOOP;
 expected:=jsonb_build_object('cash',round(opening+cash_total,2)::text,'card',round(card_total,2)::text,'digital',round(digital_total,2)::text);
 -- Validate output bounds, never silently truncate a large aggregate.
 PERFORM math_decimal_text(expected->>'cash');PERFORM math_decimal_text(expected->>'card');PERFORM math_decimal_text(expected->>'digital');
 RETURN jsonb_build_object('status','computed','expected',expected,'formula',basis->>'formula');
EXCEPTION WHEN OTHERS THEN
 GET STACKED DIAGNOSTICS failure=MESSAGE_TEXT;
 RETURN jsonb_build_object('status','unsupported','code',CASE WHEN failure ~ '^FIN62_[A-Z_]+$' THEN failure ELSE 'FIN62_MALFORMED_OR_UNSUPPORTED' END);
END $fn$;
-- Raw entry point: jsonb alone has already lost duplicate keys, exact version
-- spelling and original byte length. Future admission must not bypass this
-- layer merely because the internal arithmetic accepts parsed jsonb.
CREATE OR REPLACE FUNCTION fin62_preparation.validate_financial_math_text(raw_basis text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,fin62_preparation AS $fn$
DECLARE parsed json; version_value json; failure text;
BEGIN
 IF raw_basis IS NULL OR octet_length(raw_basis)>6*1024*1024 THEN RAISE EXCEPTION 'FIN62_BASIS_LIMIT'; END IF;
 parsed:=raw_basis::json;
 IF json_typeof(parsed)<>'object' THEN RAISE EXCEPTION 'FIN62_INPUT_INVALID'; END IF;
 PERFORM math_unique_json(parsed);
 SELECT value INTO version_value FROM json_each(parsed) WHERE key='prototypeVersion' LIMIT 1;
 IF json_typeof(version_value) IS DISTINCT FROM 'number' OR version_value::text NOT IN('1','2') THEN RAISE EXCEPTION 'FIN62_LEGACY_CONTEXT_REQUIRED'; END IF;
 RETURN validate_financial_math(parsed::jsonb);
EXCEPTION WHEN OTHERS THEN
 GET STACKED DIAGNOSTICS failure=MESSAGE_TEXT;
 RETURN jsonb_build_object('status','unsupported','code',CASE WHEN failure ~ '^FIN62_[A-Z_]+$' THEN failure ELSE 'FIN62_MALFORMED_OR_UNSUPPORTED' END);
END $fn$;
REVOKE ALL ON FUNCTION fin62_preparation.math_label_length(text),fin62_preparation.math_decimal_text(text),fin62_preparation.math_unique_json(json,integer),
 fin62_preparation.math_method(text),fin62_preparation.validate_financial_math(jsonb),fin62_preparation.validate_financial_math_text(text) FROM PUBLIC;
