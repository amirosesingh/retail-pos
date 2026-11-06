-- PREPARED PROTOTYPE ONLY. Not an installer migration. No existing row changes.
-- Exact target/file approval is required before any operator database application.
SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF OBJECT_ID(N'dbo.pos_shift_recovery_evidence',N'U') IS NULL OR OBJECT_ID(N'dbo.pos_shift_recovery_adoptions') IS NOT NULL
 THROW 50000,'Reviewed adoption metadata requires exact schema review.',1;
CREATE TABLE dbo.pos_shift_recovery_adoptions(
 decision_id uniqueidentifier NOT NULL PRIMARY KEY,
 capture_key char(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
 database_guid uniqueidentifier NOT NULL,
 branch_id nvarchar(128) COLLATE Latin1_General_100_BIN2 NOT NULL,
 terminal_id nvarchar(128) COLLATE Latin1_General_100_BIN2 NOT NULL,
 backend_origin_hash char(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
 shift_id uniqueidentifier NOT NULL,
 decision_kind varchar(32) NOT NULL,
 reviewer_id uniqueidentifier NOT NULL,
 reviewer_subject nvarchar(200) NOT NULL,
 reason nvarchar(400) NOT NULL,
 local_before_hash char(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
 target_graph_hash char(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
 target_graph_token char(64) COLLATE Latin1_General_100_BIN2 NULL,
 target_graph_json nvarchar(max) NOT NULL,
 before_ct_version bigint NOT NULL,
 local_after_hash char(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
 receipt_recovery_id uniqueidentifier NULL,
 receipt_json nvarchar(max) NULL,
 decided_at datetimeoffset(7) NOT NULL,
 CONSTRAINT FK_reviewed_adoption_evidence FOREIGN KEY(capture_key) REFERENCES dbo.pos_shift_recovery_evidence(capture_key),
 CONSTRAINT CK_reviewed_adoption_json CHECK(ISJSON(target_graph_json)=1 AND DATALENGTH(target_graph_json)<=12582912 AND (receipt_json IS NULL OR ISJSON(receipt_json)=1)),
 CONSTRAINT CK_reviewed_adoption_mode CHECK(decision_kind IN('ADMIN_ACCEPTED_CLOUD','RECEIPT_NORMALIZATION') AND
  ((decision_kind='ADMIN_ACCEPTED_CLOUD' AND receipt_recovery_id IS NULL AND receipt_json IS NULL) OR
   (decision_kind='RECEIPT_NORMALIZATION' AND receipt_recovery_id IS NOT NULL AND receipt_json IS NOT NULL))),
 CONSTRAINT CK_reviewed_adoption_hash CHECK(local_before_hash NOT LIKE '%[^0-9a-f]%' AND target_graph_hash NOT LIKE '%[^0-9a-f]%' AND local_after_hash NOT LIKE '%[^0-9a-f]%')
);
CREATE UNIQUE INDEX UX_reviewed_adoption_identity ON dbo.pos_shift_recovery_adoptions(database_guid,branch_id,terminal_id,backend_origin_hash,shift_id,target_graph_hash,local_before_hash,decision_id);
EXEC sys.sp_addextendedproperty @name=N'RetailRecoveryOwner',@value=N'retail.reviewed-adoption.v1',
 @level0type=N'SCHEMA',@level0name=N'dbo',@level1type=N'TABLE',@level1name=N'pos_shift_recovery_adoptions';
EXEC(N'CREATE TRIGGER dbo.TR_reviewed_adoption_immutable ON dbo.pos_shift_recovery_adoptions
 INSTEAD OF UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 50000, ''Reviewed adoption decisions are append-only.'', 1; END;');
COMMIT;
-- Main must preserve a complete raw before-image and verify actual administrator
-- authority or a fresh private accepted-receipt witness before any projection write.
-- This table never acknowledges journals/intents or changes sync checkpoints.
