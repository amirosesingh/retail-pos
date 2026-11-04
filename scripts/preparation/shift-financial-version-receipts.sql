-- FIN62 PREPARATION ONLY / NOT FINAL / DO NOT EXECUTE ON OPERATOR DATABASE.
-- Records actual committed sales row versions, NOT operator authorization.
-- No client-row/authorized-flag issuer. No existing writer/validator is replaced.
-- Observed auth/GUC context is diagnostic only and NEVER verified author proof.
-- Shared order is ONLY helper execution order within one transaction; it is
-- never a global commit clock. Controlled ordered helper calls are required.
CREATE SCHEMA IF NOT EXISTS fin62_evidence_preparation;
REVOKE ALL ON SCHEMA fin62_evidence_preparation FROM PUBLIC,anon,authenticated,service_role;
CREATE SEQUENCE IF NOT EXISTS fin62_evidence_preparation.helper_order AS bigint;
REVOKE ALL ON SEQUENCE fin62_evidence_preparation.helper_order FROM PUBLIC,anon,authenticated,service_role;
CREATE SCHEMA fin62_version_preparation;
REVOKE ALL ON SCHEMA fin62_version_preparation FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE fin62_version_preparation.sales_versions(
 id uuid PRIMARY KEY,sale_id uuid NOT NULL,operation text NOT NULL CHECK(operation IN('INSERT','UPDATE','DELETE')),
 before_basis jsonb,after_basis jsonb,before_hash text,after_hash text,
 observed_auth_uid uuid,observed_context jsonb NOT NULL,
 capture_xid xid8 NOT NULL,evidence_order bigint NOT NULL UNIQUE,provenance text NOT NULL CHECK(provenance='stored_sql_version_only'),captured_at timestamptz NOT NULL,
 CHECK((before_basis IS NULL)=(before_hash IS NULL)),CHECK((after_basis IS NULL)=(after_hash IS NULL)),
 CHECK(before_basis IS NOT NULL OR after_basis IS NOT NULL)
);
CREATE INDEX sales_versions_lookup ON fin62_version_preparation.sales_versions(sale_id,captured_at,id);
ALTER TABLE fin62_version_preparation.sales_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON fin62_version_preparation.sales_versions FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION fin62_version_preparation.basis(row_value jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('id',row_value->>'id','branchId',row_value->>'store_id','shiftId',row_value->>'shift_id',
 'totalAmount',row_value->>'total_amount','paymentType',row_value->>'payment_type','paymentsJson',(row_value->'payments')::text,
 'isRefunded',row_value->'is_refunded','rowVersion',row_value->>'row_version');
$$;
REVOKE ALL ON FUNCTION fin62_version_preparation.basis(jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION fin62_version_preparation.immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'FIN62_VERSION_IMMUTABLE'; END $$;
REVOKE ALL ON FUNCTION fin62_version_preparation.immutable() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER sales_versions_immutable BEFORE UPDATE OR DELETE ON fin62_version_preparation.sales_versions FOR EACH ROW EXECUTE FUNCTION fin62_version_preparation.immutable();
CREATE FUNCTION fin62_version_preparation.capture_sale() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $function$
DECLARE before_value jsonb;after_value jsonb;sid uuid;
BEGIN
 IF TG_OP<>'INSERT' THEN before_value:=fin62_version_preparation.basis(to_jsonb(OLD));sid:=OLD.id; END IF;
 IF TG_OP<>'DELETE' THEN after_value:=fin62_version_preparation.basis(to_jsonb(NEW));sid:=NEW.id; END IF;
 IF before_value IS NOT DISTINCT FROM after_value THEN RETURN NULL; END IF;
 INSERT INTO fin62_version_preparation.sales_versions(id,sale_id,operation,before_basis,after_basis,before_hash,after_hash,observed_auth_uid,observed_context,capture_xid,evidence_order,provenance,captured_at)
 VALUES(gen_random_uuid(),sid,TG_OP,before_value,after_value,
  CASE WHEN before_value IS NULL THEN NULL ELSE encode(sha256(convert_to(before_value::text,'UTF8')),'hex') END,
  CASE WHEN after_value IS NULL THEN NULL ELSE encode(sha256(convert_to(after_value::text,'UTF8')),'hex') END,
  auth.uid(),jsonb_build_object('databaseRole',session_user,'branchSetting',left(current_setting('pos.branch_id',true),256),
   'terminalSetting',left(current_setting('pos.terminal_id',true),256),'contextVerified',false),
  pg_current_xact_id(),nextval('fin62_evidence_preparation.helper_order'),'stored_sql_version_only',statement_timestamp());
 RETURN NULL;
END $function$;
REVOKE ALL ON FUNCTION fin62_version_preparation.capture_sale() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER prototype_fin62_capture_sale_version AFTER INSERT OR UPDATE OR DELETE ON public.sales FOR EACH ROW EXECUTE FUNCTION fin62_version_preparation.capture_sale();
-- A table trigger observes accepted SQL state across existing mutation aliases.
-- It does not authorize those aliases, attest historical local-only versions,
-- enroll keys, prove completeness or issue financial-operation/action receipts.
