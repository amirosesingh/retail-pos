-- FIN62 PREPARATION ONLY / NOT FINAL / DO NOT DEPLOY OR EXECUTE ON OPERATOR DB.
-- Baseline foundation only. No financial-operation issuer or successful admission.
-- Raw versioned inputs only: no expected totals or final math are computed here.
-- This SQL preserves existing validators and grants. The hosting layer must first
-- verify device proof and authorized user read scope; SQL read scope alone does
-- not implement a Management user's authorized branch subset.
-- Shared order is ONLY helper execution order within one transaction; it is
-- never a global commit clock. Controlled ordered helper calls are required.
CREATE SCHEMA IF NOT EXISTS fin62_evidence_preparation;
REVOKE ALL ON SCHEMA fin62_evidence_preparation FROM PUBLIC,anon,authenticated,service_role;
CREATE SEQUENCE IF NOT EXISTS fin62_evidence_preparation.helper_order AS bigint;
REVOKE ALL ON SEQUENCE fin62_evidence_preparation.helper_order FROM PUBLIC,anon,authenticated,service_role;
CREATE SCHEMA fin62_cloud_preparation;
REVOKE ALL ON SCHEMA fin62_cloud_preparation FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE fin62_cloud_preparation.bases(
 id uuid PRIMARY KEY,organization_id text NOT NULL,branch_id text NOT NULL,
 terminal_id text NOT NULL,shift_id uuid NOT NULL,basis_version integer NOT NULL CHECK(basis_version=2),
 basis jsonb NOT NULL,basis_hash text NOT NULL CHECK(basis_hash ~ '^[a-f0-9]{64}$'),
 captured_at timestamptz NOT NULL,snapshot_text text NOT NULL,creator_xid xid8 NOT NULL,evidence_order bigint NOT NULL UNIQUE,
 CHECK(basis->>'branchId'=branch_id AND basis->>'shiftId'=shift_id::text)
);
ALTER TABLE fin62_cloud_preparation.bases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON fin62_cloud_preparation.bases FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION fin62_cloud_preparation.immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'FIN62_BASE_IMMUTABLE'; END $$;
REVOKE ALL ON FUNCTION fin62_cloud_preparation.immutable() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER bases_immutable BEFORE UPDATE OR DELETE ON fin62_cloud_preparation.bases FOR EACH ROW EXECUTE FUNCTION fin62_cloud_preparation.immutable();
CREATE FUNCTION public.prototype_fin62_create_basis(p_org text,p_branch text,p_terminal text,p_shift uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $function$
DECLARE result jsonb;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'FIN62_SERVICE_REQUIRED'; END IF;
 PERFORM public.pos_sync_validate_read_scope(p_org,p_branch,p_terminal);
 -- COMPLETE actual server rows from ONE statement snapshot; never a caller list.
 WITH scope AS MATERIALIZED (
  SELECT id,store_id,opening_float,row_version FROM public.shifts WHERE id=p_shift AND store_id=p_branch
 ), inputs AS MATERIALIZED (
  SELECT s.id,s.store_id,s.shift_id,s.total_amount,s.payment_type,s.payments,s.is_refunded,s.row_version
  FROM public.sales s JOIN scope sh ON s.shift_id=sh.id::text AND s.store_id=sh.store_id
 ), raw AS (
  SELECT jsonb_build_object('prototypeVersion',2,'formula','canonical-exact-decimal-v2','branchId',sh.store_id,'shiftId',sh.id,
   'openingFloat',sh.opening_float::text,'shiftVersion',sh.row_version::text,
   'inputs',coalesce((SELECT jsonb_agg(jsonb_build_object('id',i.id,'branchId',i.store_id,'shiftId',i.shift_id,
    'totalAmount',i.total_amount::text,'paymentType',i.payment_type,'paymentsJson',i.payments::text,
    'isRefunded',i.is_refunded,'rowVersion',i.row_version::text) ORDER BY i.id) FROM inputs i),'[]'::jsonb)) value
  FROM scope sh
 ), stored AS (
  INSERT INTO fin62_cloud_preparation.bases(id,organization_id,branch_id,terminal_id,shift_id,basis_version,basis,basis_hash,captured_at,snapshot_text,creator_xid,evidence_order)
  SELECT gen_random_uuid(),p_org,p_branch,p_terminal,p_shift,2,value,encode(sha256(convert_to(value::text,'UTF8')),'hex'),statement_timestamp(),pg_current_snapshot()::text,pg_current_xact_id(),nextval('fin62_evidence_preparation.helper_order') FROM raw
  RETURNING id,basis,basis_hash,captured_at
 ) SELECT jsonb_build_object('basisId',id,'basis',basis,'basisHash',basis_hash,'capturedAt',captured_at) INTO result FROM stored;
 IF result IS NULL THEN RAISE EXCEPTION 'FIN62_SHIFT_BRANCH_MISSING'; END IF;
 RETURN result;
END $function$;
REVOKE ALL ON FUNCTION public.prototype_fin62_create_basis(text,text,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prototype_fin62_create_basis(text,text,text,uuid) TO service_role;
-- Deliberately no writer accepting caller-provided authorized flags/actor labels.
-- Financial receipt issuance requires actual guarded sale/refund writer wiring.
CREATE FUNCTION public.prototype_fin62_admit(p_org text,p_branch text,p_terminal text,p_basis uuid,p_intent uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $function$
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'FIN62_SERVICE_REQUIRED'; END IF;
 PERFORM public.pos_sync_validate_read_scope(p_org,p_branch,p_terminal);
 IF NOT EXISTS(SELECT 1 FROM fin62_cloud_preparation.bases b WHERE b.id=p_basis AND b.organization_id=p_org AND b.branch_id=p_branch AND b.terminal_id=p_terminal)
 THEN RAISE EXCEPTION 'FIN62_BASIS_SCOPE_MISMATCH'; END IF;
 RAISE EXCEPTION 'FIN62_VERIFIED_FINANCIAL_RECEIPTS_REQUIRED';
END $function$;
REVOKE ALL ON FUNCTION public.prototype_fin62_admit(text,text,text,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prototype_fin62_admit(text,text,text,uuid,uuid) TO service_role;
