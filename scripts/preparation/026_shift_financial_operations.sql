-- NOT FINAL / DO NOT EXECUTE ON AN OPERATOR DATABASE.
-- FIN62 isolated preparation only, never auto-discovered or registered.
-- Metadata only; no business records, migration receipts, queue, config or
-- historical backfill. Unknown existing objects abort; no overwrite/repair.
IF @@TRANCOUNT<>0 BEGIN RAISERROR('Financial ledger preparation requires no caller transaction.',16,1); RETURN; END;
SET XACT_ABORT ON;
BEGIN TRY
 BEGIN TRANSACTION;
 IF OBJECT_ID(N'dbo.pos_sync_shift_financial_origins') IS NOT NULL OR OBJECT_ID(N'dbo.pos_sync_shift_financial_heads') IS NOT NULL OR OBJECT_ID(N'dbo.pos_sync_shift_financial_events') IS NOT NULL OR OBJECT_ID(N'dbo.pos_sync_shift_financial_sale_lineage') IS NOT NULL OR OBJECT_ID(N'dbo.pos_sync_shift_financial_observations') IS NOT NULL OR OBJECT_ID(N'dbo.pos_sync_shift_financial_versions') IS NOT NULL OR OBJECT_ID(N'dbo.pos_sync_shift_financial_refreshes') IS NOT NULL OR OBJECT_ID(N'dbo.pos_sync_shift_financial_noops') IS NOT NULL
 THROW 51026,'Existing financial ledger objects require review; nothing changed.',1;
 CREATE TABLE dbo.pos_sync_shift_financial_origins(
  branch_id nvarchar(128) NOT NULL,shift_id uniqueidentifier NOT NULL,terminal_id nvarchar(128) NOT NULL,
  origin_kind varchar(16) NOT NULL,
  local_aggregate_id uniqueidentifier NULL,row_hash char(64) COLLATE Latin1_General_100_BIN2 NULL,
  opening_payload_json nvarchar(max) NULL,opening_payload_hash char(64) COLLATE Latin1_General_100_BIN2 NULL,proof_json nvarchar(max) NULL,
  server_basis_id uniqueidentifier NULL,server_basis_hash char(64) COLLATE Latin1_General_100_BIN2 NULL,server_basis_json nvarchar(max) NULL,
  local_snapshot_hash char(64) COLLATE Latin1_General_100_BIN2 NULL,ct_witness_json nvarchar(max) NULL,
  origin_version tinyint NOT NULL,created_at datetimeoffset(7) NOT NULL,
  CONSTRAINT PK_pos_sync_shift_financial_origins PRIMARY KEY(branch_id,shift_id,terminal_id),
  CONSTRAINT CK_pos_sync_shift_financial_origins_version CHECK((origin_kind='OPEN' AND origin_version=1) OR (origin_kind='CLOUD_BASIS' AND origin_version=2)),
  CONSTRAINT CK_pos_sync_shift_financial_origins_shape CHECK(
   (origin_kind='OPEN' AND local_aggregate_id IS NOT NULL AND row_hash IS NOT NULL AND opening_payload_json IS NOT NULL AND opening_payload_hash IS NOT NULL AND proof_json IS NOT NULL AND server_basis_id IS NULL AND server_basis_hash IS NULL AND server_basis_json IS NULL AND local_snapshot_hash IS NULL AND ct_witness_json IS NULL) OR
   (origin_kind='CLOUD_BASIS' AND local_aggregate_id IS NULL AND row_hash IS NULL AND opening_payload_json IS NULL AND opening_payload_hash IS NULL AND proof_json IS NULL AND server_basis_id IS NOT NULL AND server_basis_hash IS NOT NULL AND server_basis_json IS NOT NULL AND local_snapshot_hash IS NOT NULL AND ct_witness_json IS NOT NULL)),
  CONSTRAINT CK_pos_sync_shift_financial_origins_json CHECK((origin_kind='OPEN' AND ISJSON(opening_payload_json)=1 AND ISJSON(proof_json)=1) OR (origin_kind='CLOUD_BASIS' AND ISJSON(server_basis_json)=1 AND ISJSON(ct_witness_json)=1)),
  CONSTRAINT CK_pos_sync_shift_financial_origins_hash CHECK((row_hash IS NULL OR (DATALENGTH(row_hash)=64 AND row_hash NOT LIKE '%[^0-9a-f]%')) AND (opening_payload_hash IS NULL OR (DATALENGTH(opening_payload_hash)=64 AND opening_payload_hash NOT LIKE '%[^0-9a-f]%')) AND (server_basis_hash IS NULL OR (DATALENGTH(server_basis_hash)=64 AND server_basis_hash NOT LIKE '%[^0-9a-f]%')) AND (local_snapshot_hash IS NULL OR (DATALENGTH(local_snapshot_hash)=64 AND local_snapshot_hash NOT LIKE '%[^0-9a-f]%')))
 );
 CREATE TABLE dbo.pos_sync_shift_financial_heads(
  branch_id nvarchar(128) NOT NULL,shift_id uniqueidentifier NOT NULL,terminal_id nvarchar(128) NOT NULL,
  sequence bigint NOT NULL,operation_id uniqueidentifier NOT NULL,payload_hash char(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
  CONSTRAINT PK_pos_sync_shift_financial_heads PRIMARY KEY(branch_id,shift_id,terminal_id),
  CONSTRAINT CK_pos_sync_shift_financial_heads_sequence CHECK(sequence>=0),
  CONSTRAINT CK_pos_sync_shift_financial_heads_hash CHECK(DATALENGTH(payload_hash)=64 AND payload_hash NOT LIKE '%[^0-9a-f]%')
 );
 CREATE TABLE dbo.pos_sync_shift_financial_events(
  branch_id nvarchar(128) NOT NULL,shift_id uniqueidentifier NOT NULL,terminal_id nvarchar(128) NOT NULL,
  sequence bigint NOT NULL,operation_id uniqueidentifier NOT NULL,event_kind varchar(8) NOT NULL,action varchar(8) NOT NULL,
  predecessor_hash char(64) COLLATE Latin1_General_100_BIN2 NOT NULL,payload_json nvarchar(max) NOT NULL,
  payload_hash char(64) COLLATE Latin1_General_100_BIN2 NOT NULL,proof_json nvarchar(max) NOT NULL,
  CONSTRAINT PK_pos_sync_shift_financial_events PRIMARY KEY(branch_id,shift_id,terminal_id,sequence),
  CONSTRAINT UQ_pos_sync_shift_financial_events_operation UNIQUE(branch_id,shift_id,terminal_id,operation_id),
  CONSTRAINT CK_pos_sync_shift_financial_events_sequence CHECK(sequence>0),
  CONSTRAINT CK_pos_sync_shift_financial_events_kind CHECK((event_kind='MUTATION' AND action IN('SALE','REFUND','TENDER','VOID')) OR (event_kind='CLOSING' AND action IN('ORIGINAL','RECOUNT')) OR (event_kind='OBSERVE' AND action='OBSERVE')),
  CONSTRAINT CK_pos_sync_shift_financial_events_json CHECK(ISJSON(payload_json)=1 AND ISJSON(proof_json)=1),
  CONSTRAINT CK_pos_sync_shift_financial_events_hash CHECK(DATALENGTH(payload_hash)=64 AND payload_hash NOT LIKE '%[^0-9a-f]%' AND DATALENGTH(predecessor_hash)=64 AND predecessor_hash NOT LIKE '%[^0-9a-f]%')
 );
 CREATE TABLE dbo.pos_sync_shift_financial_sale_lineage(
  sale_id uniqueidentifier NOT NULL,branch_id nvarchar(128) NOT NULL,shift_id uniqueidentifier NOT NULL,terminal_id nvarchar(128) NOT NULL,
  CONSTRAINT PK_pos_sync_shift_financial_sale_lineage PRIMARY KEY(sale_id)
 );
 CREATE TABLE dbo.pos_sync_shift_financial_observations(
  branch_id nvarchar(128) NOT NULL,shift_id uniqueidentifier NOT NULL,terminal_id nvarchar(128) NOT NULL,sale_id uniqueidentifier NOT NULL,
  server_basis_id uniqueidentifier NOT NULL,fact_json nvarchar(max) NOT NULL,fact_hash char(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
  CONSTRAINT PK_pos_sync_shift_financial_observations PRIMARY KEY(branch_id,shift_id,terminal_id,sale_id),
  CONSTRAINT CK_pos_sync_shift_financial_observations_json CHECK(ISJSON(fact_json)=1),
  CONSTRAINT CK_pos_sync_shift_financial_observations_hash CHECK(DATALENGTH(fact_hash)=64 AND fact_hash NOT LIKE '%[^0-9a-f]%')
 );
 CREATE TABLE dbo.pos_sync_shift_financial_versions(
  branch_id nvarchar(128) NOT NULL,shift_id uniqueidentifier NOT NULL,terminal_id nvarchar(128) NOT NULL,sale_id uniqueidentifier NOT NULL,
  sequence bigint NOT NULL,version_side varchar(8) NOT NULL,source_id uniqueidentifier NOT NULL,fact_json nvarchar(max) NULL,fact_hash char(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
  CONSTRAINT PK_pos_sync_shift_financial_versions PRIMARY KEY(branch_id,shift_id,terminal_id,sale_id,sequence,version_side),
  CONSTRAINT CK_pos_sync_shift_financial_versions_kind CHECK(version_side IN('BEFORE','AFTER','OBSERVED') AND sequence>=0 AND (sequence>0 OR version_side='OBSERVED')),
  CONSTRAINT CK_pos_sync_shift_financial_versions_json CHECK(fact_json IS NULL OR ISJSON(fact_json)=1),
  CONSTRAINT CK_pos_sync_shift_financial_versions_hash CHECK(DATALENGTH(fact_hash)=64 AND fact_hash NOT LIKE '%[^0-9a-f]%')
 );
 CREATE INDEX IX_pos_sync_shift_financial_versions_sequence ON dbo.pos_sync_shift_financial_versions(branch_id,shift_id,terminal_id,sequence,sale_id,version_side);
 CREATE TABLE dbo.pos_sync_shift_financial_refreshes(
  branch_id nvarchar(128) NOT NULL,shift_id uniqueidentifier NOT NULL,terminal_id nvarchar(128) NOT NULL,operation_id uniqueidentifier NOT NULL,sequence bigint NOT NULL,
  server_basis_id uniqueidentifier NOT NULL,server_basis_hash char(64) COLLATE Latin1_General_100_BIN2 NOT NULL,server_basis_json nvarchar(max) NOT NULL,
  source_evidence_json nvarchar(max) NOT NULL,publication_json nvarchar(max) NOT NULL,computed_merged_hash char(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
  pending_from_hash char(64) COLLATE Latin1_General_100_BIN2 NOT NULL,pending_from_json nvarchar(max) NOT NULL,merged_facts_json nvarchar(max) NOT NULL,
  database_guid uniqueidentifier NOT NULL,ct_witness_json nvarchar(max) NOT NULL,created_at datetimeoffset(7) NOT NULL,
  CONSTRAINT PK_pos_sync_shift_financial_refreshes PRIMARY KEY(branch_id,shift_id,terminal_id,operation_id),
  CONSTRAINT UQ_pos_sync_shift_financial_refreshes_sequence UNIQUE(branch_id,shift_id,terminal_id,sequence),
  CONSTRAINT CK_pos_sync_shift_financial_refreshes_sequence CHECK(sequence>0),
  CONSTRAINT CK_pos_sync_shift_financial_refreshes_json CHECK(ISJSON(server_basis_json)=1 AND ISJSON(source_evidence_json)=1 AND ISJSON(publication_json)=1 AND ISJSON(pending_from_json)=1 AND ISJSON(merged_facts_json)=1 AND ISJSON(ct_witness_json)=1),
  CONSTRAINT CK_pos_sync_shift_financial_refreshes_hash CHECK(DATALENGTH(server_basis_hash)=64 AND server_basis_hash NOT LIKE '%[^0-9a-f]%' AND DATALENGTH(computed_merged_hash)=64 AND computed_merged_hash NOT LIKE '%[^0-9a-f]%' AND DATALENGTH(pending_from_hash)=64 AND pending_from_hash NOT LIKE '%[^0-9a-f]%')
 );
 CREATE TABLE dbo.pos_sync_shift_financial_noops(
  branch_id nvarchar(128) NOT NULL,shift_id uniqueidentifier NOT NULL,terminal_id nvarchar(128) NOT NULL,operation_id uniqueidentifier NOT NULL,
  payload_json nvarchar(max) NOT NULL,payload_hash char(64) COLLATE Latin1_General_100_BIN2 NOT NULL,proof_json nvarchar(max) NOT NULL,
  CONSTRAINT PK_pos_sync_shift_financial_noops PRIMARY KEY(branch_id,shift_id,terminal_id,operation_id),
  CONSTRAINT CK_pos_sync_shift_financial_noops_json CHECK(ISJSON(payload_json)=1 AND ISJSON(proof_json)=1),
  CONSTRAINT CK_pos_sync_shift_financial_noops_hash CHECK(DATALENGTH(payload_hash)=64 AND payload_hash NOT LIKE '%[^0-9a-f]%')
 );
 EXEC(N'CREATE TRIGGER dbo.pos_sync_shift_financial_noops_immutable ON dbo.pos_sync_shift_financial_noops AFTER UPDATE,DELETE AS BEGIN SET NOCOUNT ON; THROW 51026,''Financial no-op captures are immutable.'',1; END;');
 EXEC(N'CREATE TRIGGER dbo.pos_sync_shift_financial_versions_immutable ON dbo.pos_sync_shift_financial_versions AFTER UPDATE,DELETE AS BEGIN SET NOCOUNT ON; THROW 51026,''Financial versions are immutable.'',1; END;');
 EXEC(N'CREATE TRIGGER dbo.pos_sync_shift_financial_refreshes_immutable ON dbo.pos_sync_shift_financial_refreshes AFTER UPDATE,DELETE AS BEGIN SET NOCOUNT ON; THROW 51026,''Financial refreshes are immutable.'',1; END;');
 EXEC(N'CREATE TRIGGER dbo.pos_sync_shift_financial_observations_immutable ON dbo.pos_sync_shift_financial_observations AFTER UPDATE,DELETE AS BEGIN SET NOCOUNT ON; THROW 51026,''Financial observations are immutable.'',1; END;');
 EXEC(N'CREATE TRIGGER dbo.pos_sync_shift_financial_origins_immutable ON dbo.pos_sync_shift_financial_origins AFTER UPDATE,DELETE AS BEGIN SET NOCOUNT ON; THROW 51026,''Financial origins are immutable.'',1; END;');
 EXEC(N'CREATE TRIGGER dbo.pos_sync_shift_financial_events_immutable ON dbo.pos_sync_shift_financial_events AFTER UPDATE,DELETE AS BEGIN SET NOCOUNT ON; THROW 51026,''Financial events are immutable.'',1; END;');
 EXEC(N'CREATE TRIGGER dbo.pos_sync_shift_financial_sale_lineage_immutable ON dbo.pos_sync_shift_financial_sale_lineage AFTER UPDATE,DELETE AS BEGIN SET NOCOUNT ON; THROW 51026,''Financial sale lineage is immutable.'',1; END;');
 EXEC(N'CREATE TRIGGER dbo.pos_sync_shift_financial_heads_guard ON dbo.pos_sync_shift_financial_heads AFTER INSERT,UPDATE,DELETE AS BEGIN
 SET NOCOUNT ON;
 IF EXISTS(SELECT 1 FROM deleted d LEFT JOIN inserted i ON i.branch_id=d.branch_id AND i.shift_id=d.shift_id AND i.terminal_id=d.terminal_id WHERE i.shift_id IS NULL OR i.sequence<>d.sequence+1) THROW 51026,''Financial frontier cannot reset or skip.'',1;
 IF EXISTS(SELECT 1 FROM inserted i WHERE NOT EXISTS(SELECT 1 FROM dbo.pos_sync_shift_financial_origins o WHERE o.branch_id=i.branch_id AND o.shift_id=i.shift_id AND o.terminal_id=i.terminal_id) OR (i.sequence=0 AND NOT EXISTS(SELECT 1 FROM dbo.pos_sync_shift_financial_origins o WHERE o.branch_id=i.branch_id AND o.shift_id=i.shift_id AND o.terminal_id=i.terminal_id AND ((o.origin_kind=''OPEN'' AND o.local_aggregate_id=i.operation_id AND o.row_hash=i.payload_hash) OR (o.origin_kind=''CLOUD_BASIS'' AND o.server_basis_id=i.operation_id AND o.server_basis_hash=i.payload_hash)))) OR (i.sequence>0 AND NOT EXISTS(SELECT 1 FROM dbo.pos_sync_shift_financial_events e WHERE e.branch_id=i.branch_id AND e.shift_id=i.shift_id AND e.terminal_id=i.terminal_id AND e.sequence=i.sequence AND e.operation_id=i.operation_id AND e.payload_hash=i.payload_hash))) THROW 51026,''Financial frontier has no immutable evidence.'',1;
 END;');
 COMMIT;
END TRY
BEGIN CATCH
 IF @@TRANCOUNT>0 ROLLBACK;
 THROW;
END CATCH;
