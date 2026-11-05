-- SHIFT-36 local protocol metadata only. No domain row/checkpoint is rewritten.
BEGIN TRY
 BEGIN TRANSACTION;
 IF OBJECT_ID(N'dbo.pos_sync_shift_baselines',N'U') IS NULL
  CREATE TABLE dbo.pos_sync_shift_baselines(
   branch_id nvarchar(128) NOT NULL,shift_id uniqueidentifier NOT NULL,
   graph_token char(64) NOT NULL,closed_at_raw nvarchar(80) NOT NULL,graph_json nvarchar(max) NOT NULL,
   observation_generation uniqueidentifier NOT NULL,
   CONSTRAINT PK_pos_sync_shift_baselines PRIMARY KEY(branch_id,shift_id),
   CONSTRAINT CK_pos_sync_shift_baselines_json CHECK(ISJSON(graph_json)=1));
 IF OBJECT_ID(N'dbo.pos_sync_shift_intents',N'U') IS NULL
  CREATE TABLE dbo.pos_sync_shift_intents(
   intent_sequence bigint IDENTITY(1,1) NOT NULL,intent_id uniqueidentifier NOT NULL,
   branch_id nvarchar(128) NOT NULL,shift_id uniqueidentifier NOT NULL,intent_kind nvarchar(16) NOT NULL,
   baseline_generation uniqueidentifier NULL,base_token char(64) NULL,
   predecessor_intent_id uniqueidentifier NULL,predecessor_intent_hash char(64) NULL,
   payload_json nvarchar(max) NOT NULL,payload_hash char(64) NOT NULL,
   accepted_token char(64) NULL,current_token char(64) NULL,superseded bit NULL,acknowledged_at datetimeoffset(7) NULL,ack_coverage_json nvarchar(max) NULL,
   CONSTRAINT PK_pos_sync_shift_intents PRIMARY KEY(intent_id),
   CONSTRAINT UQ_pos_sync_shift_intents_sequence UNIQUE(intent_sequence),
   CONSTRAINT CK_pos_sync_shift_intents_json CHECK(ISJSON(payload_json)=1),
   CONSTRAINT CK_pos_sync_shift_intents_coverage CHECK(ack_coverage_json IS NULL OR ISJSON(ack_coverage_json)=1),
   CONSTRAINT CK_pos_sync_shift_intents_kind CHECK(intent_kind IN(N'ORIGINAL',N'RECOUNT',N'VARIANCE')),
   CONSTRAINT CK_pos_sync_shift_intents_predecessor CHECK(
    (predecessor_intent_id IS NULL AND predecessor_intent_hash IS NULL) OR
    (predecessor_intent_id IS NOT NULL AND predecessor_intent_hash IS NOT NULL AND base_token IS NULL AND predecessor_intent_id<>intent_id)));
 IF OBJECT_ID(N'dbo.pos_sync_shift_openings',N'U') IS NULL
  CREATE TABLE dbo.pos_sync_shift_openings(
   aggregate_id uniqueidentifier NOT NULL,shift_id uniqueidentifier NOT NULL,branch_id nvarchar(128) NOT NULL,
   row_json nvarchar(max) NOT NULL,row_hash char(64) NOT NULL,
   CONSTRAINT PK_pos_sync_shift_openings PRIMARY KEY(aggregate_id,shift_id),
   CONSTRAINT CK_pos_sync_shift_openings_json CHECK(ISJSON(row_json)=1));
 DECLARE @Shift36Columns TABLE(table_name sysname,column_name sysname,type_name sysname,max_length smallint,nullable bit,identity_column bit);
 INSERT @Shift36Columns VALUES
 (N'pos_sync_shift_baselines',N'branch_id',N'nvarchar',256,0,0),(N'pos_sync_shift_baselines',N'shift_id',N'uniqueidentifier',16,0,0),
 (N'pos_sync_shift_baselines',N'graph_token',N'char',64,0,0),(N'pos_sync_shift_baselines',N'closed_at_raw',N'nvarchar',160,0,0),
 (N'pos_sync_shift_baselines',N'graph_json',N'nvarchar',-1,0,0),(N'pos_sync_shift_baselines',N'observation_generation',N'uniqueidentifier',16,0,0),
 (N'pos_sync_shift_intents',N'intent_sequence',N'bigint',8,0,1),(N'pos_sync_shift_intents',N'intent_id',N'uniqueidentifier',16,0,0),
 (N'pos_sync_shift_intents',N'branch_id',N'nvarchar',256,0,0),(N'pos_sync_shift_intents',N'shift_id',N'uniqueidentifier',16,0,0),
 (N'pos_sync_shift_intents',N'intent_kind',N'nvarchar',32,0,0),(N'pos_sync_shift_intents',N'baseline_generation',N'uniqueidentifier',16,1,0),
 (N'pos_sync_shift_intents',N'base_token',N'char',64,1,0),(N'pos_sync_shift_intents',N'predecessor_intent_id',N'uniqueidentifier',16,1,0),
 (N'pos_sync_shift_intents',N'predecessor_intent_hash',N'char',64,1,0),(N'pos_sync_shift_intents',N'payload_json',N'nvarchar',-1,0,0),
 (N'pos_sync_shift_intents',N'payload_hash',N'char',64,0,0),(N'pos_sync_shift_intents',N'accepted_token',N'char',64,1,0),
 (N'pos_sync_shift_intents',N'current_token',N'char',64,1,0),(N'pos_sync_shift_intents',N'superseded',N'bit',1,1,0),
 (N'pos_sync_shift_intents',N'acknowledged_at',N'datetimeoffset',10,1,0),
 (N'pos_sync_shift_intents',N'ack_coverage_json',N'nvarchar',-1,1,0),
 (N'pos_sync_shift_openings',N'aggregate_id',N'uniqueidentifier',16,0,0),(N'pos_sync_shift_openings',N'shift_id',N'uniqueidentifier',16,0,0),
 (N'pos_sync_shift_openings',N'branch_id',N'nvarchar',256,0,0),(N'pos_sync_shift_openings',N'row_json',N'nvarchar',-1,0,0),
 (N'pos_sync_shift_openings',N'row_hash',N'char',64,0,0);
 IF EXISTS(SELECT 1 FROM @Shift36Columns e LEFT JOIN sys.columns c ON c.object_id=OBJECT_ID(N'dbo.'+e.table_name) AND c.name=e.column_name
   WHERE c.column_id IS NULL OR TYPE_NAME(c.user_type_id)<>e.type_name OR c.max_length<>e.max_length OR c.is_nullable<>e.nullable OR c.is_identity<>e.identity_column OR c.is_computed=1 OR c.default_object_id<>0)
   OR EXISTS(SELECT 1 FROM sys.columns c WHERE c.object_id IN(OBJECT_ID(N'dbo.pos_sync_shift_baselines'),OBJECT_ID(N'dbo.pos_sync_shift_intents'),OBJECT_ID(N'dbo.pos_sync_shift_openings'))
     AND NOT EXISTS(SELECT 1 FROM @Shift36Columns e WHERE OBJECT_ID(N'dbo.'+e.table_name)=c.object_id AND e.column_name=c.name))
  THROW 51022,'Unexpected closing protocol metadata; no domain records were changed.',1;
 IF NOT EXISTS(SELECT 1 FROM sys.key_constraints WHERE parent_object_id=OBJECT_ID(N'dbo.pos_sync_shift_baselines') AND name=N'PK_pos_sync_shift_baselines' AND type='PK')
   OR NOT EXISTS(SELECT 1 FROM sys.key_constraints WHERE parent_object_id=OBJECT_ID(N'dbo.pos_sync_shift_intents') AND name=N'PK_pos_sync_shift_intents' AND type='PK')
   OR NOT EXISTS(SELECT 1 FROM sys.key_constraints WHERE parent_object_id=OBJECT_ID(N'dbo.pos_sync_shift_intents') AND name=N'UQ_pos_sync_shift_intents_sequence' AND type='UQ')
   OR NOT EXISTS(SELECT 1 FROM sys.key_constraints WHERE parent_object_id=OBJECT_ID(N'dbo.pos_sync_shift_openings') AND name=N'PK_pos_sync_shift_openings' AND type='PK')
   OR (SELECT COUNT(*) FROM sys.check_constraints WHERE parent_object_id IN(OBJECT_ID(N'dbo.pos_sync_shift_baselines'),OBJECT_ID(N'dbo.pos_sync_shift_intents'),OBJECT_ID(N'dbo.pos_sync_shift_openings'))
     AND name IN(N'CK_pos_sync_shift_baselines_json',N'CK_pos_sync_shift_intents_json',N'CK_pos_sync_shift_intents_kind',N'CK_pos_sync_shift_intents_predecessor',N'CK_pos_sync_shift_openings_json',N'CK_pos_sync_shift_intents_coverage') AND is_disabled=0 AND is_not_trusted=0)<>6
  THROW 51022,'Unexpected closing protocol constraints; no domain records were changed.',1;
 IF NOT EXISTS(SELECT 1 FROM sys.identity_columns WHERE object_id=OBJECT_ID(N'dbo.pos_sync_shift_intents') AND name=N'intent_sequence'
   AND CONVERT(bigint,seed_value)=1 AND CONVERT(bigint,increment_value)=1
   AND (last_value IS NULL OR CONVERT(bigint,last_value)>=COALESCE((SELECT MAX(intent_sequence) FROM dbo.pos_sync_shift_intents),0)))
  THROW 51022,'Unexpected closing protocol identity; no domain records were changed.',1;
 DECLARE @Shift36Checks TABLE(table_name sysname,constraint_name sysname,expected nvarchar(max));
 INSERT @Shift36Checks VALUES
 (N'pos_sync_shift_baselines',N'CK_pos_sync_shift_baselines_json',N'(isjson([graph_json])=(1))'),
 (N'pos_sync_shift_intents',N'CK_pos_sync_shift_intents_json',N'(isjson([payload_json])=(1))'),
 (N'pos_sync_shift_intents',N'CK_pos_sync_shift_intents_coverage',N'([ack_coverage_json] IS NULL OR isjson([ack_coverage_json])=(1))'),
 (N'pos_sync_shift_intents',N'CK_pos_sync_shift_intents_kind',N'([intent_kind]=N''VARIANCE'' OR [intent_kind]=N''RECOUNT'' OR [intent_kind]=N''ORIGINAL'')'),
 (N'pos_sync_shift_intents',N'CK_pos_sync_shift_intents_predecessor',N'([predecessor_intent_id] IS NULL AND [predecessor_intent_hash] IS NULL OR [predecessor_intent_id] IS NOT NULL AND [predecessor_intent_hash] IS NOT NULL AND [base_token] IS NULL AND [predecessor_intent_id]<>[intent_id])'),
 (N'pos_sync_shift_openings',N'CK_pos_sync_shift_openings_json',N'(isjson([row_json])=(1))');
 IF EXISTS(SELECT 1 FROM @Shift36Checks e LEFT JOIN sys.check_constraints c ON c.parent_object_id=OBJECT_ID(N'dbo.'+e.table_name) AND c.name=e.constraint_name
   WHERE c.object_id IS NULL OR c.definition COLLATE Latin1_General_100_BIN2 <> e.expected COLLATE Latin1_General_100_BIN2)
   OR EXISTS(SELECT 1 FROM sys.check_constraints c WHERE c.parent_object_id IN(OBJECT_ID(N'dbo.pos_sync_shift_baselines'),OBJECT_ID(N'dbo.pos_sync_shift_intents'),OBJECT_ID(N'dbo.pos_sync_shift_openings'))
     AND NOT EXISTS(SELECT 1 FROM @Shift36Checks e WHERE OBJECT_ID(N'dbo.'+e.table_name)=c.parent_object_id AND e.constraint_name=c.name))
  THROW 51022,'Unexpected closing protocol CHECK expression; no domain records were changed.',1;
 IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.pos_sync_shift_intents') AND name=N'IX_pos_sync_shift_intents_tail')
  CREATE INDEX IX_pos_sync_shift_intents_tail ON dbo.pos_sync_shift_intents(branch_id,shift_id,intent_sequence DESC);
 DECLARE @Shift36Keys TABLE(table_name sysname,index_name sysname,column_name sysname,ordinal int,descending_key bit,unique_index bit);
 INSERT @Shift36Keys VALUES
 (N'pos_sync_shift_baselines',N'PK_pos_sync_shift_baselines',N'branch_id',1,0,1),
 (N'pos_sync_shift_baselines',N'PK_pos_sync_shift_baselines',N'shift_id',2,0,1),
 (N'pos_sync_shift_intents',N'PK_pos_sync_shift_intents',N'intent_id',1,0,1),
 (N'pos_sync_shift_intents',N'UQ_pos_sync_shift_intents_sequence',N'intent_sequence',1,0,1),
 (N'pos_sync_shift_intents',N'IX_pos_sync_shift_intents_tail',N'branch_id',1,0,0),
 (N'pos_sync_shift_intents',N'IX_pos_sync_shift_intents_tail',N'shift_id',2,0,0),
 (N'pos_sync_shift_intents',N'IX_pos_sync_shift_intents_tail',N'intent_sequence',3,1,0),
 (N'pos_sync_shift_openings',N'PK_pos_sync_shift_openings',N'aggregate_id',1,0,1),
 (N'pos_sync_shift_openings',N'PK_pos_sync_shift_openings',N'shift_id',2,0,1);
 IF EXISTS(SELECT 1 FROM @Shift36Keys e LEFT JOIN sys.indexes i ON i.object_id=OBJECT_ID(N'dbo.'+e.table_name) AND i.name=e.index_name
   LEFT JOIN sys.index_columns ic ON ic.object_id=i.object_id AND ic.index_id=i.index_id AND ic.key_ordinal=e.ordinal
   LEFT JOIN sys.columns c ON c.object_id=ic.object_id AND c.column_id=ic.column_id
   WHERE c.name IS NULL OR c.name<>e.column_name OR ic.is_descending_key<>e.descending_key OR i.is_unique<>e.unique_index
     OR i.is_disabled=1 OR i.is_hypothetical=1 OR i.ignore_dup_key=1 OR i.has_filter=1)
   OR EXISTS(SELECT 1 FROM sys.indexes i JOIN sys.index_columns ic ON ic.object_id=i.object_id AND ic.index_id=i.index_id
     WHERE EXISTS(SELECT 1 FROM @Shift36Keys e WHERE OBJECT_ID(N'dbo.'+e.table_name)=i.object_id AND e.index_name=i.name)
     AND (ic.is_included_column=1 OR NOT EXISTS(SELECT 1 FROM @Shift36Keys e WHERE OBJECT_ID(N'dbo.'+e.table_name)=i.object_id AND e.index_name=i.name AND e.ordinal=ic.key_ordinal)))
  THROW 51022,'Unexpected closing protocol index shape; no domain records were changed.',1;
 IF EXISTS(SELECT 1 FROM sys.indexes i WHERE i.object_id IN(OBJECT_ID(N'dbo.pos_sync_shift_baselines'),OBJECT_ID(N'dbo.pos_sync_shift_intents'),OBJECT_ID(N'dbo.pos_sync_shift_openings')) AND i.is_unique=1
   AND NOT EXISTS(SELECT 1 FROM @Shift36Keys e WHERE OBJECT_ID(N'dbo.'+e.table_name)=i.object_id AND e.index_name=i.name))
  THROW 51022,'Unexpected closing protocol uniqueness; no domain records were changed.',1;
 COMMIT TRANSACTION;
END TRY
BEGIN CATCH
 IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;
 THROW;
END CATCH;
-- SHIFT36_HISTORY_BEGIN: also embedded in the current additive installer.
IF NOT EXISTS(SELECT 1 FROM dbo.pos_schema_migrations WHERE version=22)
 INSERT dbo.pos_schema_migrations(version,name) VALUES(22,N'shift_causal_intents');
