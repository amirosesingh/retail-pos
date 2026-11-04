-- FIN62 PREPARATION ONLY / NOT FINAL / DO NOT APPLY TO OPERATOR DATABASE.
-- Read-only stored-version verification. NOT operator authorization, proof that a
-- device actually observed these versions, action admission or permission grant.
-- Requires the separate baseline/version/math preparation fixtures. No writes.
-- Private semantic comparison only. SQL/local row-version clocks are NOT a
-- financial identity. Invalid/ambiguous raw payments remain held, even refunded.
CREATE FUNCTION fin62_cloud_preparation.fact_identity(value text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog AS $$
 SELECT CASE WHEN value ~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' THEN lower(value) ELSE value END;
$$;
CREATE FUNCTION fin62_cloud_preparation.financial_fact(item jsonb) RETURNS jsonb
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
  BEGIN parsed:=(item->>'paymentsJson')::json;EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'FIN62_FINANCIAL_FACT_UNVERIFIED';END;
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
 method:=item->>'paymentType';folded:=translate(method,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz');
 IF folded COLLATE "C" IN('cash','card','wallet','bank_transfer','transfer','qr','online','ewallet') THEN method:=folded;END IF;
 RETURN jsonb_build_object('id',fin62_cloud_preparation.fact_identity(item->>'id'),
  'branchId',fin62_cloud_preparation.fact_identity(item->>'branchId'),'shiftId',fin62_cloud_preparation.fact_identity(item->>'shiftId'),
  'totalAmount',total,'paymentType',method,'payments',payments,'isRefunded',refunded);
END $fact$;
REVOKE ALL ON FUNCTION fin62_cloud_preparation.fact_identity(text),fin62_cloud_preparation.financial_fact(jsonb) FROM PUBLIC,anon,authenticated,service_role;

-- Actual MVCC visibility, never statement time, determines which transitions
-- were absent from the baseline snapshot. Timestamps remain diagnostics only.
CREATE FUNCTION fin62_cloud_preparation.version_reachable(p_basis uuid,p_sale uuid,p_receipt uuid,p_initial jsonb)
RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $lineage$
DECLARE base fin62_cloud_preparation.bases%ROWTYPE;target fin62_version_preparation.sales_versions%ROWTYPE;
BEGIN
 SELECT * INTO STRICT base FROM fin62_cloud_preparation.bases WHERE id=p_basis;
 SELECT * INTO target FROM fin62_version_preparation.sales_versions WHERE id=p_receipt AND sale_id=p_sale;
 IF NOT FOUND THEN RETURN false;END IF;
 -- For the same xid, private sequence values prove supported ordered helper
 -- calls. Arbitrary multi-mutating CTE/privileged SQL remains unverified.
 IF target.capture_xid=base.creator_xid THEN
  IF target.evidence_order<=base.evidence_order THEN RETURN false;END IF;
 ELSIF pg_visible_in_snapshot(target.capture_xid,base.snapshot_text::pg_snapshot) THEN RETURN false;END IF;
 IF (SELECT count(*) FROM fin62_version_preparation.sales_versions v WHERE v.sale_id=p_sale AND ((v.capture_xid=base.creator_xid AND v.evidence_order>base.evidence_order) OR
  (v.capture_xid<>base.creator_xid AND NOT pg_visible_in_snapshot(v.capture_xid,base.snapshot_text::pg_snapshot))))>512 THEN RAISE EXCEPTION 'FIN62_VERSION_LINEAGE_LIMIT';END IF;
 RETURN (WITH RECURSIVE edges AS MATERIALIZED(
  SELECT v.id,fin62_cloud_preparation.financial_fact(v.before_basis) before_fact,fin62_cloud_preparation.financial_fact(v.after_basis) after_fact
  FROM fin62_version_preparation.sales_versions v WHERE v.sale_id=p_sale AND ((v.capture_xid=base.creator_xid AND v.evidence_order>base.evidence_order) OR
   (v.capture_xid<>base.creator_xid AND NOT pg_visible_in_snapshot(v.capture_xid,base.snapshot_text::pg_snapshot)))
   AND (v.before_basis IS NULL OR (fin62_cloud_preparation.fact_identity(v.before_basis->>'branchId')=fin62_cloud_preparation.fact_identity(base.branch_id)
    AND fin62_cloud_preparation.fact_identity(v.before_basis->>'shiftId')=base.shift_id::text))
   AND (v.after_basis IS NULL OR (fin62_cloud_preparation.fact_identity(v.after_basis->>'branchId')=fin62_cloud_preparation.fact_identity(base.branch_id)
    AND fin62_cloud_preparation.fact_identity(v.after_basis->>'shiftId')=base.shift_id::text))
 ),reachable(fact) AS(
  SELECT coalesce(fin62_cloud_preparation.financial_fact(p_initial),'null'::jsonb)
  UNION
  SELECT coalesce(e.after_fact,'null'::jsonb) FROM reachable r JOIN edges e ON coalesce(e.before_fact,'null'::jsonb)=r.fact
 ) SELECT EXISTS(SELECT 1 FROM edges e JOIN reachable r ON coalesce(e.before_fact,'null'::jsonb)=r.fact WHERE e.id=p_receipt));
END $lineage$;
REVOKE ALL ON FUNCTION fin62_cloud_preparation.version_reachable(uuid,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.prototype_fin62_verify_known_basis(
 p_org text,p_branch text,p_terminal text,p_basis uuid,p_raw_basis text,p_refs jsonb,p_expected jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $function$
DECLARE saved fin62_cloud_preparation.bases%ROWTYPE; calculation jsonb; action_basis jsonb;
 item jsonb;old_item jsonb;ref jsonb;historical fin62_version_preparation.sales_versions%ROWTYPE;
 baseline_map jsonb;action_map jsonb;refs_map jsonb;selected jsonb;raw_version text;used_ids text[]:=ARRAY[]::text[];identifier text;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'FIN62_SERVICE_REQUIRED'; END IF;
 PERFORM public.pos_sync_validate_read_scope(p_org,p_branch,p_terminal);
 SELECT * INTO saved FROM fin62_cloud_preparation.bases WHERE id=p_basis AND organization_id=p_org AND branch_id=p_branch AND terminal_id=p_terminal;
 IF NOT FOUND THEN RAISE EXCEPTION 'FIN62_BASIS_SCOPE_MISMATCH'; END IF;
 IF jsonb_array_length(saved.basis->'inputs')>20000 OR octet_length(saved.basis::text)>6*1024*1024 THEN RAISE EXCEPTION 'FIN62_BASIS_LIMIT'; END IF;
 IF p_raw_basis IS NULL OR octet_length(p_raw_basis)>6*1024*1024 THEN RAISE EXCEPTION 'FIN62_BASIS_LIMIT';END IF;
 BEGIN
  PERFORM fin62_preparation.math_unique_json(p_raw_basis::json);
  SELECT value::text INTO raw_version FROM json_each(p_raw_basis::json) WHERE key='prototypeVersion';
  IF raw_version IS DISTINCT FROM '2' THEN RAISE EXCEPTION 'FIN62_INPUT_MATH_UNSUPPORTED';END IF;
  action_basis:=p_raw_basis::jsonb;
  IF jsonb_typeof(action_basis->'inputs') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'FIN62_INPUT_MATH_UNSUPPORTED';END IF;
 EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'FIN62_INPUT_MATH_UNSUPPORTED';END;
 -- Normalize UUID case before the strict math parser, preserving non-UUID labels.
 action_basis:=action_basis||jsonb_build_object(
  'branchId',CASE WHEN jsonb_typeof(action_basis->'branchId')='string' THEN to_jsonb(fin62_cloud_preparation.fact_identity(action_basis->>'branchId')) ELSE action_basis->'branchId' END,
  'shiftId',CASE WHEN jsonb_typeof(action_basis->'shiftId')='string' THEN to_jsonb(fin62_cloud_preparation.fact_identity(action_basis->>'shiftId')) ELSE action_basis->'shiftId' END,
  'inputs',(SELECT coalesce(jsonb_agg(value||jsonb_build_object(
   'id',CASE WHEN jsonb_typeof(value->'id')='string' THEN to_jsonb(fin62_cloud_preparation.fact_identity(value->>'id')) ELSE value->'id' END,
   'branchId',CASE WHEN jsonb_typeof(value->'branchId')='string' THEN to_jsonb(fin62_cloud_preparation.fact_identity(value->>'branchId')) ELSE value->'branchId' END,
   'shiftId',CASE WHEN jsonb_typeof(value->'shiftId')='string' THEN to_jsonb(fin62_cloud_preparation.fact_identity(value->>'shiftId')) ELSE value->'shiftId' END)),'[]'::jsonb) FROM jsonb_array_elements(action_basis->'inputs')));
 calculation:=fin62_preparation.validate_financial_math_text(action_basis::text);
 IF calculation->>'status' IS DISTINCT FROM 'computed' THEN RAISE EXCEPTION 'FIN62_INPUT_MATH_UNSUPPORTED'; END IF;
 IF action_basis->'prototypeVersion' IS DISTINCT FROM saved.basis->'prototypeVersion' OR action_basis->'formula' IS DISTINCT FROM saved.basis->'formula' OR
  fin62_cloud_preparation.fact_identity(action_basis->>'branchId') IS DISTINCT FROM fin62_cloud_preparation.fact_identity(saved.basis->>'branchId') OR fin62_cloud_preparation.fact_identity(action_basis->>'shiftId') IS DISTINCT FROM saved.basis->>'shiftId' OR
  (CASE WHEN action_basis->'openingFloat'='null'::jsonb THEN 0 ELSE fin62_preparation.math_decimal_text(action_basis->>'openingFloat') END) IS DISTINCT FROM (CASE WHEN saved.basis->'openingFloat'='null'::jsonb THEN 0 ELSE fin62_preparation.math_decimal_text(saved.basis->>'openingFloat') END)
 THEN RAISE EXCEPTION 'FIN62_BASIS_CONTEXT_MISMATCH'; END IF;
 IF calculation->'expected' IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'FIN62_EXPECTED_MISMATCH'; END IF;
 IF jsonb_typeof(p_refs) IS DISTINCT FROM 'array' OR jsonb_array_length(p_refs)>20000 OR octet_length(p_refs::text)>2*1024*1024 THEN RAISE EXCEPTION 'FIN62_RECEIPT_REFS_INVALID'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_refs) x GROUP BY x->>'saleId' HAVING count(*)>1) OR
  EXISTS(SELECT 1 FROM jsonb_array_elements(p_refs) x GROUP BY x->>'receiptId' HAVING count(*)>1)
 THEN RAISE EXCEPTION 'FIN62_RECEIPT_REFS_INVALID'; END IF;
 FOR ref IN SELECT value FROM jsonb_array_elements(p_refs) LOOP
  IF jsonb_typeof(ref)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(ref))<>3 OR NOT(ref?'saleId' AND ref?'receiptId' AND ref?'side') OR
   coalesce(ref->>'saleId','')!~*'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' OR
   coalesce(ref->>'receiptId','')!~*'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' OR
   coalesce(ref->>'side','') NOT IN('before','after','delete') THEN RAISE EXCEPTION 'FIN62_RECEIPT_REFS_INVALID'; END IF;
 END LOOP;
 SELECT coalesce(jsonb_agg(value||jsonb_build_object('saleId',fin62_cloud_preparation.fact_identity(value->>'saleId'),'receiptId',fin62_cloud_preparation.fact_identity(value->>'receiptId'))),'[]'::jsonb) INTO p_refs FROM jsonb_array_elements(p_refs);
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_refs) x GROUP BY x->>'saleId' HAVING count(*)>1) OR
  EXISTS(SELECT 1 FROM jsonb_array_elements(p_refs) x GROUP BY x->>'receiptId' HAVING count(*)>1) THEN RAISE EXCEPTION 'FIN62_RECEIPT_REFS_INVALID';END IF;
 SELECT coalesce(jsonb_object_agg(fin62_cloud_preparation.fact_identity(value->>'id'),value),'{}'::jsonb) INTO baseline_map FROM jsonb_array_elements(saved.basis->'inputs');
 SELECT coalesce(jsonb_object_agg(value->>'id',value),'{}'::jsonb) INTO action_map FROM jsonb_array_elements(action_basis->'inputs');
 SELECT coalesce(jsonb_object_agg(value->>'saleId',value),'{}'::jsonb) INTO refs_map FROM jsonb_array_elements(p_refs);
 -- Preserve EVERY baseline ID unless its exact prior state has an actual DELETE
 -- receipt. A caller-supplied subset never establishes baseline completeness.
 FOR old_item IN SELECT value FROM jsonb_array_elements(saved.basis->'inputs') LOOP
  identifier:=fin62_cloud_preparation.fact_identity(old_item->>'id');
  IF NOT(action_map?identifier) THEN
   ref:=refs_map->identifier;
   IF ref IS NULL OR ref->>'side' IS DISTINCT FROM 'delete' THEN RAISE EXCEPTION 'FIN62_BASELINE_ROW_OMITTED'; END IF;
   SELECT * INTO historical FROM fin62_version_preparation.sales_versions WHERE id=(ref->>'receiptId')::uuid AND sale_id=identifier::uuid;
   IF NOT FOUND OR historical.operation<>'DELETE' OR historical.after_basis IS NOT NULL OR NOT fin62_cloud_preparation.version_reachable(saved.id,identifier::uuid,historical.id,old_item)
   THEN RAISE EXCEPTION 'FIN62_STORED_VERSION_REQUIRED'; END IF;
   used_ids:=array_append(used_ids,ref->>'receiptId');
  END IF;
 END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements(action_basis->'inputs') LOOP
  identifier:=item->>'id';old_item:=baseline_map->identifier;
  IF fin62_cloud_preparation.financial_fact(old_item) IS NOT DISTINCT FROM fin62_cloud_preparation.financial_fact(item) THEN CONTINUE; END IF;
  ref:=refs_map->identifier;
  IF ref IS NULL OR coalesce(ref->>'side','') NOT IN('before','after') THEN RAISE EXCEPTION 'FIN62_STORED_VERSION_REQUIRED'; END IF;
  SELECT * INTO historical FROM fin62_version_preparation.sales_versions WHERE id=(ref->>'receiptId')::uuid AND sale_id=identifier::uuid;
  IF NOT FOUND OR NOT fin62_cloud_preparation.version_reachable(saved.id,identifier::uuid,historical.id,old_item) THEN RAISE EXCEPTION 'FIN62_STORED_VERSION_REQUIRED'; END IF;
  selected:=CASE WHEN ref->>'side'='before' THEN historical.before_basis ELSE historical.after_basis END;
  IF fin62_cloud_preparation.financial_fact(selected) IS DISTINCT FROM fin62_cloud_preparation.financial_fact(item) OR fin62_cloud_preparation.fact_identity(selected->>'branchId') IS DISTINCT FROM fin62_cloud_preparation.fact_identity(p_branch) OR fin62_cloud_preparation.fact_identity(selected->>'shiftId') IS DISTINCT FROM saved.shift_id::text
  THEN RAISE EXCEPTION 'FIN62_STORED_VERSION_REQUIRED'; END IF;
  used_ids:=array_append(used_ids,ref->>'receiptId');
 END LOOP;
 IF cardinality(used_ids)<>jsonb_array_length(p_refs) THEN RAISE EXCEPTION 'FIN62_UNUSED_RECEIPT_REF'; END IF;
 RETURN jsonb_build_object('status','verified-stored-basis','basisId',saved.id,'expected',calculation->'expected',
  'operatorAuthorized',false,'observedByDeviceProven',false,'admissionGranted',false);
END $function$;
REVOKE ALL ON FUNCTION public.prototype_fin62_verify_known_basis(text,text,text,uuid,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prototype_fin62_verify_known_basis(text,text,text,uuid,text,jsonb,jsonb) TO service_role;
