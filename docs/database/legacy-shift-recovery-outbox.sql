-- PREPARED ONLY. Exact-target approval required. Not an installer migration.
-- Run AFTER reviewed retained-shift-recovery-evidence.sql. No business-row rewrite.
SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF OBJECT_ID(N'dbo.pos_shift_recovery_evidence',N'U') IS NULL
 OR OBJECT_ID(N'dbo.pos_sync_shift_legacy_recoveries') IS NOT NULL
 OR OBJECT_ID(N'dbo.pos_sync_shift_legacy_recovery_receipts') IS NOT NULL
 THROW 50000,'Legacy recovery metadata requires exact schema review before application.',1;
CREATE TABLE dbo.pos_sync_shift_legacy_recoveries(
 recovery_id uniqueidentifier NOT NULL PRIMARY KEY,
 capture_key char(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
 database_guid uniqueidentifier NOT NULL,
 branch_id nvarchar(128) COLLATE Latin1_General_100_BIN2 NOT NULL,
 terminal_id nvarchar(128) COLLATE Latin1_General_100_BIN2 NOT NULL,
 backend_origin_hash char(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
 shift_id uniqueidentifier NOT NULL,
 reviewer_id uniqueidentifier NOT NULL,
 key_id uniqueidentifier NOT NULL,
 payload_hash char(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
 payload_json nvarchar(max) NOT NULL,
 proof_json nvarchar(max) NOT NULL,
 created_at datetimeoffset(7) NOT NULL,
 CONSTRAINT FK_legacy_recovery_evidence FOREIGN KEY(capture_key) REFERENCES dbo.pos_shift_recovery_evidence(capture_key),
 CONSTRAINT CK_legacy_recovery_json CHECK(ISJSON(payload_json)=1 AND ISJSON(proof_json)=1
  AND DATALENGTH(payload_json)<=524288 AND DATALENGTH(proof_json)<=8192),
 CONSTRAINT CK_legacy_recovery_hash CHECK(payload_hash NOT LIKE '%[^0-9a-f]%' AND backend_origin_hash NOT LIKE '%[^0-9a-f]%')
);
CREATE INDEX IX_legacy_recovery_scope ON dbo.pos_sync_shift_legacy_recoveries(database_guid,branch_id,terminal_id,backend_origin_hash,recovery_id);
CREATE UNIQUE INDEX UX_legacy_recovery_shift_scope ON dbo.pos_sync_shift_legacy_recoveries(database_guid,branch_id,terminal_id,backend_origin_hash,shift_id);
CREATE TABLE dbo.pos_sync_shift_legacy_recovery_receipts(
 recovery_id uniqueidentifier NOT NULL PRIMARY KEY,
 receipt_json nvarchar(max) NOT NULL,
 receipt_sha256 char(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
 accepted_at datetimeoffset(7) NOT NULL,
 CONSTRAINT FK_legacy_recovery_receipt FOREIGN KEY(recovery_id) REFERENCES dbo.pos_sync_shift_legacy_recoveries(recovery_id),
 CONSTRAINT CK_legacy_recovery_receipt_json CHECK(ISJSON(receipt_json)=1 AND DATALENGTH(receipt_json)<=12582912),
 CONSTRAINT CK_legacy_recovery_receipt_hash CHECK(receipt_sha256 NOT LIKE '%[^0-9a-f]%')
);
EXEC sys.sp_addextendedproperty @name=N'RetailRecoveryOwner',@value=N'retail.legacy-recovery.v1',
 @level0type=N'SCHEMA',@level0name=N'dbo',@level1type=N'TABLE',@level1name=N'pos_sync_shift_legacy_recoveries';
EXEC sys.sp_addextendedproperty @name=N'RetailRecoveryOwner',@value=N'retail.legacy-recovery.v1',
 @level0type=N'SCHEMA',@level0name=N'dbo',@level1type=N'TABLE',@level1name=N'pos_sync_shift_legacy_recovery_receipts';
EXEC(N'CREATE TRIGGER dbo.TR_legacy_recovery_event_immutable ON dbo.pos_sync_shift_legacy_recoveries
 INSTEAD OF UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 50000, ''Legacy recovery events are append-only.'', 1; END;');
EXEC(N'CREATE TRIGGER dbo.TR_legacy_recovery_receipt_immutable ON dbo.pos_sync_shift_legacy_recovery_receipts
 INSTEAD OF UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 50000, ''Legacy recovery receipts are append-only.'', 1; END;');
COMMIT;
-- No expiry or cleanup is defined. Unacknowledged events remain pending regardless
-- of offline duration. A receipt records acceptance of that exact recovery only;
-- it does not authorize replacing later local work or advancing any checkpoint.
