-- Isolated preparation after the existing FIN62 administrator adapters.
-- Keep the existing authorization, shift fence and canonical tender writer.
CREATE SCHEMA pos_sync_tender_v1;
REVOKE ALL ON SCHEMA pos_sync_tender_v1 FROM PUBLIC, anon, authenticated, service_role;
CREATE TABLE pos_sync_tender_v1.receipts (
  operation_id uuid PRIMARY KEY,
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[a-f0-9]{64}$'),
  result jsonb NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE pos_sync_tender_v1.receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE pos_sync_tender_v1.receipts FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER tender_receipt_immutable BEFORE UPDATE OR DELETE ON pos_sync_tender_v1.receipts
FOR EACH ROW EXECUTE FUNCTION fin62_history_preparation.immutable();

CREATE FUNCTION public.pos_sync_correct_tender_v1(
  p_operation uuid, p_author uuid, p_sale uuid, p_branch text, p_method text, p_terminal text,
  p_sale_version integer, p_tender_versions jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $tender$
DECLARE
  v_shift uuid;
  v_sale public.sales%ROWTYPE;
  v_expected jsonb;
  v_tenders jsonb;
  v_before jsonb;
  v_after jsonb;
  v_digest text;
  v_prior pos_sync_tender_v1.receipts%ROWTYPE;
  v_result jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'POS_TENDER_V1_FORBIDDEN';
  END IF;
  IF p_operation IS NULL OR p_author IS NULL OR p_sale IS NULL OR p_branch IS NULL OR btrim(p_branch) = ''
     OR length(p_branch) > 128 OR p_method IS NULL OR p_method !~ '^[a-z][a-z0-9_]{0,63}$'
     OR p_sale_version IS NULL OR p_sale_version NOT BETWEEN 1 AND 2147483646
     OR jsonb_typeof(p_tender_versions) IS DISTINCT FROM 'array' OR jsonb_array_length(p_tender_versions) > 100
     OR octet_length(p_tender_versions::text) > 16384 OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(p_tender_versions) AS entry(value)
       WHERE jsonb_typeof(entry.value) IS DISTINCT FROM 'object'
         OR entry.value - ARRAY['id','row_version'] <> '{}'::jsonb
         OR coalesce(entry.value->>'id','') !~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
         OR jsonb_typeof(entry.value->'row_version') IS DISTINCT FROM 'number'
         OR entry.value->>'row_version' !~ '^[1-9][0-9]{0,9}$'
     ) THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'POS_TENDER_V1_INVALID'; END IF;

  PERFORM fin62_admin_preparation.authorize(p_author, p_branch, p_terminal);
  SELECT coalesce(jsonb_agg(value ORDER BY value->>'id'), '[]'::jsonb) INTO v_expected
  FROM jsonb_array_elements(p_tender_versions) AS entry(value);
  v_digest := encode(sha256(convert_to(jsonb_build_array(p_author, p_sale, p_branch, p_method, p_terminal,
    p_sale_version, v_expected)::text, 'UTF8')), 'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended('pos-sync-tender:' || p_operation::text, 0));
  SELECT * INTO v_prior FROM pos_sync_tender_v1.receipts WHERE operation_id = p_operation;
  IF FOUND THEN
    IF v_prior.request_sha256 <> v_digest THEN
      RETURN jsonb_build_object('status', 'INTEGRITY_CONFLICT');
    END IF;
    RETURN jsonb_build_object('status', 'ALREADY_APPLIED', 'result', v_prior.result);
  END IF;

  SELECT nullif(shift_id,'')::uuid INTO v_shift FROM public.sales WHERE id=p_sale AND store_id=p_branch;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'POS_TENDER_V1_FORBIDDEN'; END IF;
  IF v_shift IS NOT NULL THEN PERFORM pg_advisory_xact_lock(hashtextextended('pos-sync-shift:' || v_shift::text, 0)); END IF;
  SELECT * INTO v_sale FROM public.sales WHERE id=p_sale AND store_id=p_branch FOR UPDATE;
  IF NOT FOUND OR v_sale.shift_id IS DISTINCT FROM v_shift::text THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'POS_TENDER_V1_SCOPE_CHANGED';
  END IF;
  -- The canonical writer matches store identifiers case-insensitively. Include
  -- those rows in the lock and refuse a case-aliased ledger before calling it.
  PERFORM 1 FROM public.payment_transactions
    WHERE sale_id=p_sale AND lower(store_id)=lower(p_branch) AND source_type='sale' ORDER BY id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.payment_transactions
    WHERE sale_id=p_sale AND lower(store_id)=lower(p_branch) AND store_id<>p_branch AND source_type='sale')
  THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'POS_TENDER_V1_SCOPE_CHANGED'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',tender.id,'row_version',tender.row_version) ORDER BY tender.id), '[]'::jsonb),
    coalesce(jsonb_agg(to_jsonb(tender) - ARRAY['method','row_version','updated_at'] ORDER BY tender.id), '[]'::jsonb)
  INTO v_tenders, v_before FROM (
    SELECT * FROM public.payment_transactions
    WHERE sale_id=p_sale AND store_id=p_branch AND source_type='sale'
    ORDER BY id
  ) AS tender;
  IF v_sale.row_version IS DISTINCT FROM p_sale_version OR v_tenders <> v_expected OR v_sale.is_refunded THEN
    RETURN jsonb_build_object('status', 'REVIEW_REQUIRED', 'code', 'STALE_TENDER');
  END IF;

  PERFORM public.pos_live_financial_admin_correct_tender(p_author,p_sale,p_branch,p_method,p_terminal);
  SELECT * INTO STRICT v_sale FROM public.sales WHERE id=p_sale AND store_id=p_branch;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',tender.id,'row_version',tender.row_version,'method',tender.method)
      ORDER BY tender.id), '[]'::jsonb),
    coalesce(jsonb_agg(to_jsonb(tender) - ARRAY['method','row_version','updated_at'] ORDER BY tender.id), '[]'::jsonb)
  INTO v_tenders, v_after FROM public.payment_transactions AS tender
  WHERE tender.sale_id=p_sale AND tender.store_id=p_branch AND tender.source_type='sale';
  IF v_sale.row_version IS DISTINCT FROM p_sale_version + 1 OR v_sale.payment_type IS DISTINCT FROM p_method
     OR v_after <> v_before OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(v_expected) WITH ORDINALITY AS prior(value, ordinal)
       WHERE v_tenders->(prior.ordinal::int - 1)->>'method' IS DISTINCT FROM p_method
         OR (v_tenders->(prior.ordinal::int - 1)->>'row_version')::bigint
           IS DISTINCT FROM (prior.value->>'row_version')::bigint + 1
     ) THEN RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'POS_TENDER_V1_RESULT_UNVERIFIED'; END IF;

  v_result := jsonb_build_object('operation_id',p_operation,'scope_id',p_branch,'sale_id',p_sale,
    'sale_version',v_sale.row_version,'method',p_method,'tenders',v_tenders);
  INSERT INTO pos_sync_tender_v1.receipts(operation_id,request_sha256,result) VALUES(p_operation,v_digest,v_result);
  RETURN jsonb_build_object('status', 'APPLIED', 'result', v_result);
END;
$tender$;

REVOKE ALL ON FUNCTION public.pos_sync_correct_tender_v1(uuid,uuid,uuid,text,text,text,integer,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pos_sync_correct_tender_v1(uuid,uuid,uuid,text,text,text,integer,jsonb) TO service_role;
