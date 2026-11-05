-- Separate immutable start evidence. No business data, keys or cursors are rewritten.
BEGIN TRY
 BEGIN TRANSACTION;
 IF OBJECT_ID(N'dbo.pos_sync_shift_intents',N'U') IS NULL OR OBJECT_ID(N'dbo.pos_sync_shift_author_keys',N'U') IS NULL
  THROW 51024,'Install existing shift author metadata before closing-start evidence.',1;
 IF OBJECT_ID(N'dbo.pos_sync_shift_closing_starts',N'U') IS NULL
  CREATE TABLE dbo.pos_sync_shift_closing_starts(
   shift_id uniqueidentifier NOT NULL,branch_id nvarchar(128) NOT NULL,event_id uniqueidentifier NOT NULL,proof_json nvarchar(max) NOT NULL,
   CONSTRAINT PK_pos_sync_shift_closing_starts PRIMARY KEY(shift_id),
   CONSTRAINT UQ_pos_sync_shift_closing_starts_event UNIQUE(event_id),
   CONSTRAINT CK_pos_sync_shift_closing_starts_json CHECK(ISJSON(proof_json)=1));
 IF OBJECT_ID(N'dbo.pos_sync_shift_intent_starts',N'U') IS NULL
  CREATE TABLE dbo.pos_sync_shift_intent_starts(
   intent_id uniqueidentifier NOT NULL,proof_json nvarchar(max) NOT NULL,
   CONSTRAINT PK_pos_sync_shift_intent_starts PRIMARY KEY(intent_id),
   CONSTRAINT CK_pos_sync_shift_intent_starts_json CHECK(ISJSON(proof_json)=1));
 DECLARE @Start24Columns TABLE(table_name sysname,column_name sysname,type_name sysname,max_length smallint);
 INSERT @Start24Columns VALUES
 (N'pos_sync_shift_closing_starts',N'shift_id',N'uniqueidentifier',16),(N'pos_sync_shift_closing_starts',N'branch_id',N'nvarchar',256),
 (N'pos_sync_shift_closing_starts',N'event_id',N'uniqueidentifier',16),(N'pos_sync_shift_closing_starts',N'proof_json',N'nvarchar',-1),
 (N'pos_sync_shift_intent_starts',N'intent_id',N'uniqueidentifier',16),(N'pos_sync_shift_intent_starts',N'proof_json',N'nvarchar',-1);
 IF EXISTS(SELECT 1 FROM @Start24Columns e LEFT JOIN sys.columns c ON c.object_id=OBJECT_ID(N'dbo.'+e.table_name) AND c.name=e.column_name
  WHERE c.column_id IS NULL OR TYPE_NAME(c.user_type_id)<>e.type_name OR c.max_length<>e.max_length OR c.is_nullable=1 OR c.is_identity=1 OR c.is_computed=1 OR c.default_object_id<>0)
  OR EXISTS(SELECT 1 FROM sys.columns c WHERE c.object_id IN(OBJECT_ID(N'dbo.pos_sync_shift_closing_starts'),OBJECT_ID(N'dbo.pos_sync_shift_intent_starts'))
   AND NOT EXISTS(SELECT 1 FROM @Start24Columns e WHERE OBJECT_ID(N'dbo.'+e.table_name)=c.object_id AND e.column_name=c.name))
  THROW 51024,'Unexpected closing-start metadata shape; no records were changed.',1;
 DECLARE @Start24Keys TABLE(table_name sysname,index_name sysname,column_name sysname,is_primary bit);
 INSERT @Start24Keys VALUES
 (N'pos_sync_shift_closing_starts',N'PK_pos_sync_shift_closing_starts',N'shift_id',1),
 (N'pos_sync_shift_closing_starts',N'UQ_pos_sync_shift_closing_starts_event',N'event_id',0),
 (N'pos_sync_shift_intent_starts',N'PK_pos_sync_shift_intent_starts',N'intent_id',1);
 IF EXISTS(SELECT 1 FROM @Start24Keys e LEFT JOIN sys.indexes i ON i.object_id=OBJECT_ID(N'dbo.'+e.table_name) AND i.name=e.index_name
   LEFT JOIN sys.index_columns ic ON ic.object_id=i.object_id AND ic.index_id=i.index_id AND ic.key_ordinal=1
   LEFT JOIN sys.columns c ON c.object_id=ic.object_id AND c.column_id=ic.column_id
   WHERE c.name IS NULL OR c.name<>e.column_name OR i.is_unique<>1 OR i.is_primary_key<>e.is_primary OR i.is_disabled=1 OR i.is_hypothetical=1 OR i.ignore_dup_key=1 OR i.has_filter=1 OR ic.is_descending_key=1
    OR (e.is_primary=1 AND i.type<>1) OR (e.is_primary=0 AND (i.is_unique_constraint<>1 OR i.type<>2)))
  OR EXISTS(SELECT 1 FROM sys.indexes i JOIN sys.index_columns ic ON ic.object_id=i.object_id AND ic.index_id=i.index_id
   WHERE EXISTS(SELECT 1 FROM @Start24Keys e WHERE OBJECT_ID(N'dbo.'+e.table_name)=i.object_id AND e.index_name=i.name) AND (ic.key_ordinal<>1 OR ic.is_included_column=1))
  OR EXISTS(SELECT 1 FROM sys.indexes i WHERE i.object_id IN(OBJECT_ID(N'dbo.pos_sync_shift_closing_starts'),OBJECT_ID(N'dbo.pos_sync_shift_intent_starts')) AND i.is_unique=1
   AND NOT EXISTS(SELECT 1 FROM @Start24Keys e WHERE OBJECT_ID(N'dbo.'+e.table_name)=i.object_id AND e.index_name=i.name))
  OR EXISTS(SELECT 1 FROM sys.foreign_keys WHERE parent_object_id IN(OBJECT_ID(N'dbo.pos_sync_shift_closing_starts'),OBJECT_ID(N'dbo.pos_sync_shift_intent_starts')))
  OR EXISTS(SELECT 1 FROM sys.triggers WHERE parent_id IN(OBJECT_ID(N'dbo.pos_sync_shift_closing_starts'),OBJECT_ID(N'dbo.pos_sync_shift_intent_starts')))
  THROW 51024,'Unexpected closing-start metadata indexes; no records were changed.',1;
 IF EXISTS(SELECT 1 FROM sys.check_constraints WHERE parent_object_id IN(OBJECT_ID(N'dbo.pos_sync_shift_closing_starts'),OBJECT_ID(N'dbo.pos_sync_shift_intent_starts'))
  AND (name NOT IN(N'CK_pos_sync_shift_closing_starts_json',N'CK_pos_sync_shift_intent_starts_json') OR is_disabled=1 OR is_not_trusted=1 OR
   LOWER(REPLACE(REPLACE(REPLACE(definition,N' ',N''),CHAR(13),N''),CHAR(10),N'')) COLLATE Latin1_General_100_BIN2<>N'(isjson([proof_json])=(1))' COLLATE Latin1_General_100_BIN2))
  OR (SELECT COUNT(*) FROM sys.check_constraints WHERE parent_object_id IN(OBJECT_ID(N'dbo.pos_sync_shift_closing_starts'),OBJECT_ID(N'dbo.pos_sync_shift_intent_starts')))<>2
  THROW 51024,'Unexpected closing-start metadata constraints; no records were changed.',1;
 COMMIT TRANSACTION;
END TRY
BEGIN CATCH
 IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;
 THROW;
END CATCH;
-- AUTH37_START_HISTORY_BEGIN
IF NOT EXISTS(SELECT 1 FROM dbo.pos_schema_migrations WHERE version=24)
 INSERT dbo.pos_schema_migrations(version,name) VALUES(24,N'shift_closing_start_proofs');
