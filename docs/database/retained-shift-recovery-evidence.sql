-- PREPARED ONLY. Not an installer migration and not applied automatically.
-- Exact target/file approval is required before application to an existing PC.
-- This stores immutable comparison evidence, NOT uploads, signatures, receipts,
-- accepted acknowledgements or a cloud baseline. No existing business rows change.
-- No retention/expiry path: pending/review evidence must survive long offline gaps.
-- Integration must use the existing job engine; no second synchronization engine.
SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF OBJECT_ID(N'dbo.pos_shift_recovery_evidence') IS NOT NULL
  THROW 50000, 'Recovery evidence object already exists; stop for exact schema review.', 1;
CREATE TABLE dbo.pos_shift_recovery_evidence(
  capture_key char(64) COLLATE Latin1_General_100_BIN2 NOT NULL PRIMARY KEY,
  owner_tag varchar(32) NOT NULL,
  format_tag varchar(32) NOT NULL,
  codec_version int NOT NULL,
  database_guid uniqueidentifier NOT NULL,
  branch_id nvarchar(128) COLLATE Latin1_General_100_BIN2 NOT NULL,
  terminal_id nvarchar(128) COLLATE Latin1_General_100_BIN2 NOT NULL,
  backend_origin_hash char(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
  shift_id uniqueidentifier NOT NULL,
  job_id uniqueidentifier NOT NULL,
  local_sha256 char(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
  cloud_sha256 char(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
  local_graph_json nvarchar(max) NOT NULL,
  cloud_graph_json nvarchar(max) NOT NULL,
  classification varchar(64) NOT NULL,
  reason_code varchar(64) NOT NULL,
  captured_at datetimeoffset(7) NOT NULL,
  CONSTRAINT CK_shift_recovery_owner CHECK(owner_tag COLLATE Latin1_General_100_BIN2='retail.shift-recovery'
    AND format_tag COLLATE Latin1_General_100_BIN2='retained-graph-v1' AND codec_version=1),
  CONSTRAINT CK_shift_recovery_json CHECK(ISJSON(local_graph_json)=1 AND ISJSON(cloud_graph_json)=1
    AND DATALENGTH(local_graph_json)<=6291456 AND DATALENGTH(cloud_graph_json)<=6291456
    AND CONVERT(bigint,DATALENGTH(local_graph_json))+CONVERT(bigint,DATALENGTH(cloud_graph_json))<=12582912),
  CONSTRAINT CK_shift_recovery_hash CHECK(capture_key NOT LIKE '%[^0-9a-f]%' AND backend_origin_hash NOT LIKE '%[^0-9a-f]%'
    AND local_sha256 NOT LIKE '%[^0-9a-f]%' AND cloud_sha256 NOT LIKE '%[^0-9a-f]%'),
  CONSTRAINT CK_shift_recovery_kind CHECK(classification IN('exact','parent-summary-candidate','metadata-only-candidate',
    'legacy-local-closing-needs-review','competing-closings-needs-review','unverified-difference-needs-review'))
);
CREATE INDEX IX_shift_recovery_scope ON dbo.pos_shift_recovery_evidence(database_guid,branch_id,terminal_id,backend_origin_hash,capture_key);
EXEC sys.sp_addextendedproperty @name=N'RetailRecoveryOwner',@value=N'retail.shift-recovery',
 @level0type=N'SCHEMA',@level0name=N'dbo',@level1type=N'TABLE',@level1name=N'pos_shift_recovery_evidence';
EXEC(N'CREATE TRIGGER dbo.TR_pos_shift_recovery_evidence_immutable ON dbo.pos_shift_recovery_evidence
 INSTEAD OF UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 50000, ''Recovery evidence is append-only.'', 1; END;');
COMMIT;
-- Main captures each complete local before-image under the caller-owned serializable
-- transaction and trusted scope recheck. SHA256 checks are performed over the exact
-- UTF-8 raw JSON bytes by the lossless Main codec; numeric/time strings are retained.
-- The store exposes capture/list/load only. No decision or acknowledgement writer,
-- live schema application, pending-work cleanup or download checkpoint reset exists.
-- This first store does NOT yet persist a Change Tracking capture position. Its
-- caller-owned capture transaction must verify graph/pending-state freshness;
-- durable CT/job evidence and adoption remain separate integration work. A saved
-- comparison row alone must never satisfy an expired-history download guard.
