-- Isolated SQL Server preparation. The original receipt and journal remain the
-- operation and scheduling records; these columns retain its signed evidence.
SET XACT_ABORT ON;
BEGIN TRANSACTION;
ALTER TABLE dbo.local_operation_receipts ADD
  refund_branch_id nvarchar(128) NULL,
  refund_evidence_json nvarchar(max) NULL,
  refund_acceptance_json nvarchar(max) NULL;
EXEC(N'ALTER TABLE dbo.local_operation_receipts ADD CONSTRAINT CK_local_receipt_refund_evidence_v1 CHECK (
  (refund_branch_id IS NULL AND refund_evidence_json IS NULL AND refund_acceptance_json IS NULL)
  OR (refund_branch_id IS NOT NULL AND operation_type=N''refund'' AND refund_evidence_json IS NOT NULL
    AND ISJSON(refund_evidence_json)=1 AND (refund_acceptance_json IS NULL OR ISJSON(refund_acceptance_json)=1))
);
CREATE INDEX IX_local_receipt_refund_scope_v1 ON dbo.local_operation_receipts(refund_branch_id, operation_id)
WHERE refund_branch_id IS NOT NULL;');
COMMIT;
