-- Prepared for the isolated fixture. Install as the database owner in one
-- transaction. The authoritative writer must verify scope and installation,
-- then claim, apply domain changes, append feed groups and record the result
-- in that same transaction. This file exposes no application API.
CREATE SCHEMA pos_sync_inbox_v1;
REVOKE ALL ON SCHEMA pos_sync_inbox_v1 FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE pos_sync_inbox_v1.operation_receipts (
  organization_id text COLLATE "C" NOT NULL,
  operation_id uuid NOT NULL,
  origin_installation_id uuid NOT NULL,
  payload_hash bytea NOT NULL CHECK (octet_length(payload_hash) = 32),
  disposition text NOT NULL DEFAULT 'PENDING',
  result jsonb,
  claim_xid xid8,
  PRIMARY KEY (organization_id, operation_id),
  CHECK (disposition IN ('PENDING', 'WAITING_DEPENDENCY', 'APPLIED', 'REVIEW_REQUIRED')),
  CHECK ((disposition = 'PENDING' AND result IS NULL) OR
         (disposition <> 'PENDING' AND jsonb_typeof(result) IS NOT DISTINCT FROM 'object')),
  CHECK (disposition NOT IN ('APPLIED', 'REVIEW_REQUIRED') OR claim_xid IS NULL)
);

ALTER TABLE pos_sync_inbox_v1.operation_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE pos_sync_inbox_v1.operation_receipts FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION pos_sync_inbox_v1.claim_operation(
  p_organization_id text,
  p_operation_id uuid,
  p_origin_installation_id uuid,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $claim_operation$
DECLARE
  v_receipt pos_sync_inbox_v1.operation_receipts%ROWTYPE;
  v_payload_hash bytea;
  v_xid xid8;
BEGIN
  IF p_organization_id IS NULL OR btrim(p_organization_id) = ''
     OR octet_length(p_organization_id) > 256
     OR p_operation_id IS NULL OR p_origin_installation_id IS NULL
     OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object'
     OR octet_length(p_payload::text) > 1048576 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'POS_INBOX_V1_INVALID_OPERATION';
  END IF;

  v_payload_hash := sha256(convert_to(p_payload::text, 'UTF8'));
  INSERT INTO pos_sync_inbox_v1.operation_receipts (
    organization_id, operation_id, origin_installation_id, payload_hash
  ) VALUES (p_organization_id, p_operation_id, p_origin_installation_id, v_payload_hash)
  ON CONFLICT (organization_id, operation_id) DO NOTHING;

  SELECT * INTO STRICT v_receipt
  FROM pos_sync_inbox_v1.operation_receipts AS receipt
  WHERE receipt.organization_id = p_organization_id AND receipt.operation_id = p_operation_id
  FOR UPDATE;

  IF v_receipt.origin_installation_id <> p_origin_installation_id
     OR v_receipt.payload_hash <> v_payload_hash THEN
    RETURN jsonb_build_object('status', 'INTEGRITY_CONFLICT');
  END IF;

  IF v_receipt.disposition IN ('APPLIED', 'REVIEW_REQUIRED') THEN
    RETURN jsonb_build_object('status', CASE WHEN v_receipt.disposition = 'APPLIED'
      THEN 'ALREADY_APPLIED' ELSE 'REVIEW_REQUIRED' END, 'result', v_receipt.result);
  END IF;

  v_xid := pg_current_xact_id();
  IF v_receipt.claim_xid = v_xid THEN
    RETURN jsonb_build_object('status', 'IN_PROGRESS');
  END IF;

  -- A waiting receipt stays bound to its original payload but can be retried.
  UPDATE pos_sync_inbox_v1.operation_receipts AS receipt SET claim_xid = v_xid
  WHERE receipt.organization_id = p_organization_id AND receipt.operation_id = p_operation_id;
  RETURN jsonb_build_object('status', 'PROCEED');
END;
$claim_operation$;

CREATE FUNCTION pos_sync_inbox_v1.record_disposition(
  p_organization_id text,
  p_operation_id uuid,
  p_disposition text,
  p_result jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $record_disposition$
BEGIN
  IF p_disposition IS NULL OR p_disposition NOT IN ('WAITING_DEPENDENCY', 'APPLIED', 'REVIEW_REQUIRED')
     OR jsonb_typeof(p_result) IS DISTINCT FROM 'object'
     OR octet_length(p_result::text) > 65536 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'POS_INBOX_V1_INVALID_DISPOSITION';
  END IF;

  UPDATE pos_sync_inbox_v1.operation_receipts AS receipt
  SET disposition = p_disposition, result = p_result, claim_xid = NULL
  WHERE receipt.organization_id = p_organization_id AND receipt.operation_id = p_operation_id
    AND receipt.disposition IN ('PENDING', 'WAITING_DEPENDENCY')
    AND receipt.claim_xid = pg_current_xact_id_if_assigned();
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'POS_INBOX_V1_CLAIM_REQUIRED';
  END IF;
END;
$record_disposition$;

REVOKE ALL ON FUNCTION pos_sync_inbox_v1.claim_operation(text, uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION pos_sync_inbox_v1.record_disposition(text, uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
