-- NOT FINAL / DO NOT EXECUTE ON AN OPERATOR DATABASE.
-- FIN62 isolated preparation only. Candidate future local version 025 requires
-- owner review/exact approval. NOT registered, auto-discovered or installed.
-- Creates metadata only; no business rows, queues, checkpoints, config, migration
-- receipts or historical backfill are changed. No activation is included.
-- basis_version=1 is the LOCAL STORAGE ENVELOPE, not the raw math version.
-- New raw basis JSON is canonical-exact-decimal-v2 / prototypeVersion=2.
-- A basis row is the durable financialRequired marker, including when no server
-- baseline exists yet. Companion proof is separate/append-only; never re-sign a
-- pending old action as a later cashier or regenerate it from current sales.
-- RAISERROR deliberately preserves an existing caller transaction even when
-- its XACT_ABORT is ON; THROW here could doom/rollback that unrelated work.
IF @@TRANCOUNT<>0
BEGIN
 RAISERROR('Financial basis preparation requires no caller transaction.',16,1);
 RETURN;
END;
SET XACT_ABORT ON;
BEGIN TRY
 BEGIN TRANSACTION;
 DECLARE @created bit=0;
 IF OBJECT_ID(N'dbo.pos_sync_shift_financial_bases') IS NOT NULL AND OBJECT_ID(N'dbo.pos_sync_shift_financial_bases',N'U') IS NULL
  THROW 51025,'Unexpected financial basis object; no upgrade applied.',1;
 IF OBJECT_ID(N'dbo.pos_sync_shift_financial_proofs') IS NOT NULL AND OBJECT_ID(N'dbo.pos_sync_shift_financial_proofs',N'U') IS NULL
  THROW 51025,'Unexpected financial proof object; no upgrade applied.',1;
 IF (CASE WHEN OBJECT_ID(N'dbo.pos_sync_shift_financial_bases',N'U') IS NULL THEN 0 ELSE 1 END) <>
    (CASE WHEN OBJECT_ID(N'dbo.pos_sync_shift_financial_proofs',N'U') IS NULL THEN 0 ELSE 1 END)
  THROW 51025,'Partial financial metadata requires explicit review; no upgrade applied.',1;
 IF OBJECT_ID(N'dbo.pos_sync_shift_financial_bases',N'U') IS NULL
 BEGIN
  SET @created=1;
  CREATE TABLE dbo.pos_sync_shift_financial_bases(
   intent_id uniqueidentifier NOT NULL,branch_id nvarchar(128) NOT NULL,
   shift_id uniqueidentifier NOT NULL,count_id uniqueidentifier NOT NULL,
   basis_version tinyint NOT NULL,graph_payload_hash char(64) COLLATE Latin1_General_100_BIN2 NOT NULL,basis_json nvarchar(max) NOT NULL,
   basis_hash char(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
   captured_at datetimeoffset(7) NOT NULL,
   CONSTRAINT PK_pos_sync_shift_financial_bases PRIMARY KEY(intent_id),
   CONSTRAINT CK_pos_sync_shift_financial_bases_version CHECK(basis_version=1),
   CONSTRAINT CK_pos_sync_shift_financial_bases_json CHECK(ISJSON(basis_json)=1),
   CONSTRAINT CK_pos_sync_shift_financial_bases_hash CHECK(DATALENGTH(basis_hash)=64 AND basis_hash NOT LIKE '%[^0-9a-f]%'),
   CONSTRAINT CK_pos_sync_shift_financial_bases_graph_hash CHECK(DATALENGTH(graph_payload_hash)=64 AND graph_payload_hash NOT LIKE '%[^0-9a-f]%')
  );
  CREATE INDEX IX_pos_sync_shift_financial_bases_scope ON dbo.pos_sync_shift_financial_bases(branch_id,shift_id,count_id);
  CREATE TABLE dbo.pos_sync_shift_financial_proofs(
   intent_id uniqueidentifier NOT NULL,proof_json nvarchar(max) NOT NULL,
   CONSTRAINT PK_pos_sync_shift_financial_proofs PRIMARY KEY(intent_id),
   CONSTRAINT CK_pos_sync_shift_financial_proofs_json CHECK(ISJSON(proof_json)=1));
 END;
 DECLARE @expected TABLE(name sysname,type_name sysname,max_length smallint,scale tinyint);
 INSERT @expected VALUES(N'intent_id',N'uniqueidentifier',16,0),(N'branch_id',N'nvarchar',256,0),
 (N'shift_id',N'uniqueidentifier',16,0),(N'count_id',N'uniqueidentifier',16,0),
 (N'basis_version',N'tinyint',1,0),(N'graph_payload_hash',N'char',64,0),(N'basis_json',N'nvarchar',-1,0),(N'basis_hash',N'char',64,0),(N'captured_at',N'datetimeoffset',10,7);
 IF (SELECT count(*) FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.pos_sync_shift_financial_bases'))<>9 OR EXISTS(
  SELECT 1 FROM @expected e LEFT JOIN sys.columns c ON c.object_id=OBJECT_ID(N'dbo.pos_sync_shift_financial_bases') AND c.name=e.name
  WHERE c.column_id IS NULL OR TYPE_NAME(c.user_type_id)<>e.type_name OR c.max_length<>e.max_length OR c.scale<>e.scale
   OR c.is_nullable<>0 OR c.is_identity<>0 OR c.is_computed<>0 OR c.default_object_id<>0
   OR (c.name IN(N'basis_hash',N'graph_payload_hash') AND c.collation_name<>N'Latin1_General_100_BIN2'))
  THROW 51025,'Unexpected financial basis columns; no upgrade applied.',1;
 -- Protect the exact allowed SQL literal before normalizing external formatting.
 -- A different literal retains its quotes and cannot match the sentinel below.
 DECLARE @checks TABLE(name sysname,normalized nvarchar(max));
 INSERT @checks VALUES(N'CK_pos_sync_shift_financial_bases_version',N'basis_version=1'),
 (N'CK_pos_sync_shift_financial_bases_json',N'isjsonbasis_json=1'),
 (N'CK_pos_sync_shift_financial_bases_hash',N'datalengthbasis_hash=64andnotbasis_hashlike__hex_literal__'),
 (N'CK_pos_sync_shift_financial_bases_graph_hash',N'datalengthgraph_payload_hash=64andnotgraph_payload_hashlike__hex_literal__');
 IF (SELECT count(*) FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID(N'dbo.pos_sync_shift_financial_bases'))<>4 OR EXISTS(
 SELECT 1 FROM @checks e LEFT JOIN sys.check_constraints c ON c.parent_object_id=OBJECT_ID(N'dbo.pos_sync_shift_financial_bases') AND c.name=e.name
 WHERE c.object_id IS NULL OR c.is_disabled<>0 OR c.is_not_trusted<>0 OR
  LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(c.definition COLLATE Latin1_General_100_BIN2,N'''%[^0-9a-f]%''',N'__hex_literal__'),N'(',N''),N')',N''),N'[basis_version]',N'basis_version'),N'[basis_json]',N'basis_json'),N'[basis_hash]',N'basis_hash'),N'[graph_payload_hash]',N'graph_payload_hash'),N' ',N''),CHAR(13)+CHAR(10),N'')) COLLATE Latin1_General_100_BIN2<>e.normalized COLLATE Latin1_General_100_BIN2)
  THROW 51025,'Unexpected financial basis checks; no upgrade applied.',1;
 IF (SELECT count(*) FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.pos_sync_shift_financial_bases') AND index_id>0)<>2 OR
 NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.pos_sync_shift_financial_bases') AND name=N'PK_pos_sync_shift_financial_bases' AND is_primary_key=1 AND is_unique=1 AND is_disabled=0 AND has_filter=0 AND ignore_dup_key=0 AND is_hypothetical=0 AND type=1) OR
 NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.pos_sync_shift_financial_bases') AND name=N'IX_pos_sync_shift_financial_bases_scope' AND is_unique=0 AND is_disabled=0 AND has_filter=0 AND ignore_dup_key=0 AND is_hypothetical=0 AND type=2)
  THROW 51025,'Unexpected financial basis indexes; no upgrade applied.',1;
 DECLARE @keys TABLE(index_name sysname,column_name sysname,ordinal int);
 INSERT @keys VALUES(N'PK_pos_sync_shift_financial_bases',N'intent_id',1),(N'IX_pos_sync_shift_financial_bases_scope',N'branch_id',1),
 (N'IX_pos_sync_shift_financial_bases_scope',N'shift_id',2),(N'IX_pos_sync_shift_financial_bases_scope',N'count_id',3);
 IF (SELECT count(*) FROM sys.index_columns WHERE object_id=OBJECT_ID(N'dbo.pos_sync_shift_financial_bases'))<>4 OR EXISTS(
 SELECT 1 FROM @keys e WHERE NOT EXISTS(SELECT 1 FROM sys.indexes i JOIN sys.index_columns ic ON ic.object_id=i.object_id AND ic.index_id=i.index_id
 JOIN sys.columns c ON c.object_id=ic.object_id AND c.column_id=ic.column_id WHERE i.object_id=OBJECT_ID(N'dbo.pos_sync_shift_financial_bases')
 AND i.name=e.index_name AND c.name=e.column_name AND ic.key_ordinal=e.ordinal AND ic.is_descending_key=0 AND ic.is_included_column=0)) OR
 EXISTS(SELECT 1 FROM sys.foreign_keys WHERE parent_object_id=OBJECT_ID(N'dbo.pos_sync_shift_financial_bases'))
  THROW 51025,'Unexpected financial basis key shape; no upgrade applied.',1;
 DECLARE @trigger nvarchar(max)=N'CREATE TRIGGER dbo.pos_sync_shift_financial_bases_immutable ON dbo.pos_sync_shift_financial_bases AFTER UPDATE,DELETE AS BEGIN SET NOCOUNT ON; THROW 51025,''Financial bases are immutable.'',1; END;';
 IF @created=1 AND OBJECT_ID(N'dbo.pos_sync_shift_financial_bases_immutable',N'TR') IS NULL EXEC sys.sp_executesql @trigger;
 IF (SELECT count(*) FROM sys.triggers WHERE parent_id=OBJECT_ID(N'dbo.pos_sync_shift_financial_bases'))<>1 OR
 NOT EXISTS(SELECT 1 FROM sys.triggers WHERE object_id=OBJECT_ID(N'dbo.pos_sync_shift_financial_bases_immutable') AND parent_id=OBJECT_ID(N'dbo.pos_sync_shift_financial_bases') AND is_disabled=0 AND is_instead_of_trigger=0) OR
 OBJECT_DEFINITION(OBJECT_ID(N'dbo.pos_sync_shift_financial_bases_immutable')) COLLATE Latin1_General_100_BIN2<>@trigger COLLATE Latin1_General_100_BIN2
  THROW 51025,'Unexpected financial basis immutability guard; no upgrade applied.',1;
 IF (SELECT count(*) FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.pos_sync_shift_financial_proofs'))<>2 OR
  NOT EXISTS(SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.pos_sync_shift_financial_proofs') AND name=N'intent_id' AND TYPE_NAME(user_type_id)=N'uniqueidentifier' AND max_length=16 AND is_nullable=0 AND is_identity=0 AND is_computed=0 AND default_object_id=0) OR
  NOT EXISTS(SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.pos_sync_shift_financial_proofs') AND name=N'proof_json' AND TYPE_NAME(user_type_id)=N'nvarchar' AND max_length=-1 AND is_nullable=0 AND is_identity=0 AND is_computed=0 AND default_object_id=0)
  THROW 51025,'Unexpected financial proof columns; no upgrade applied.',1;
 IF (SELECT count(*) FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID(N'dbo.pos_sync_shift_financial_proofs'))<>1 OR
  NOT EXISTS(SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID(N'dbo.pos_sync_shift_financial_proofs') AND name=N'CK_pos_sync_shift_financial_proofs_json' AND is_disabled=0 AND is_not_trusted=0 AND
   LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(definition,N' ',N''),N'[proof_json]',N'proof_json'),N'(',N''),N')',N''),CHAR(13)+CHAR(10),N'')) COLLATE Latin1_General_100_BIN2=N'isjsonproof_json=1') OR
  EXISTS(SELECT 1 FROM sys.foreign_keys WHERE parent_object_id=OBJECT_ID(N'dbo.pos_sync_shift_financial_proofs')) OR
  (SELECT count(*) FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.pos_sync_shift_financial_proofs') AND index_id>0)<>1 OR
  NOT EXISTS(SELECT 1 FROM sys.indexes i JOIN sys.index_columns ic ON ic.object_id=i.object_id AND ic.index_id=i.index_id JOIN sys.columns c ON c.object_id=ic.object_id AND c.column_id=ic.column_id
   WHERE i.object_id=OBJECT_ID(N'dbo.pos_sync_shift_financial_proofs') AND i.name=N'PK_pos_sync_shift_financial_proofs' AND i.is_primary_key=1 AND i.is_unique=1 AND i.type=1 AND i.is_disabled=0 AND i.has_filter=0 AND i.ignore_dup_key=0 AND i.is_hypothetical=0
   AND c.name=N'intent_id' AND ic.key_ordinal=1 AND ic.is_descending_key=0 AND ic.is_included_column=0) OR
  (SELECT count(*) FROM sys.index_columns WHERE object_id=OBJECT_ID(N'dbo.pos_sync_shift_financial_proofs'))<>1
  THROW 51025,'Unexpected financial proof checks or indexes; no upgrade applied.',1;
 DECLARE @proof_trigger nvarchar(max)=N'CREATE TRIGGER dbo.pos_sync_shift_financial_proofs_immutable ON dbo.pos_sync_shift_financial_proofs AFTER UPDATE,DELETE AS BEGIN SET NOCOUNT ON; THROW 51025,''Financial proofs are immutable.'',1; END;';
 IF @created=1 AND OBJECT_ID(N'dbo.pos_sync_shift_financial_proofs_immutable',N'TR') IS NULL EXEC sys.sp_executesql @proof_trigger;
 IF (SELECT count(*) FROM sys.triggers WHERE parent_id=OBJECT_ID(N'dbo.pos_sync_shift_financial_proofs'))<>1 OR
  NOT EXISTS(SELECT 1 FROM sys.triggers WHERE object_id=OBJECT_ID(N'dbo.pos_sync_shift_financial_proofs_immutable') AND parent_id=OBJECT_ID(N'dbo.pos_sync_shift_financial_proofs') AND is_disabled=0 AND is_instead_of_trigger=0) OR
  OBJECT_DEFINITION(OBJECT_ID(N'dbo.pos_sync_shift_financial_proofs_immutable')) COLLATE Latin1_General_100_BIN2<>@proof_trigger COLLATE Latin1_General_100_BIN2
  THROW 51025,'Unexpected financial proof immutability guard; no upgrade applied.',1;
 COMMIT TRANSACTION;
END TRY
BEGIN CATCH
 IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
 THROW;
END CATCH;
