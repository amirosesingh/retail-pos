-- AUTH-37 private references/signatures only. No business row or cursor rewrite.
BEGIN TRY
 BEGIN TRANSACTION;
 IF OBJECT_ID(N'dbo.pos_sync_shift_intents',N'U') IS NULL
  THROW 51023,'Closing intent metadata must be installed before author references.',1;
 IF OBJECT_ID(N'dbo.pos_sync_shift_author_keys',N'U') IS NULL
  CREATE TABLE dbo.pos_sync_shift_author_keys(
   scope_hash char(64) NOT NULL,project_origin nvarchar(2048) NOT NULL,terminal_id nvarchar(200) NOT NULL,
   author_id uniqueidentifier NOT NULL,key_id uniqueidentifier NOT NULL,public_key varchar(59) NOT NULL,
   CONSTRAINT PK_pos_sync_shift_author_keys PRIMARY KEY(scope_hash),
   CONSTRAINT UQ_pos_sync_shift_author_keys_id UNIQUE(key_id));
 IF OBJECT_ID(N'dbo.pos_sync_shift_authors',N'U') IS NULL
  CREATE TABLE dbo.pos_sync_shift_authors(
   intent_id uniqueidentifier NOT NULL,scope_hash char(64) NOT NULL,key_id uniqueidentifier NOT NULL,
   attestation_json nvarchar(max) NOT NULL,
   CONSTRAINT PK_pos_sync_shift_authors PRIMARY KEY(intent_id),
   CONSTRAINT CK_pos_sync_shift_authors_json CHECK(ISJSON(attestation_json)=1));
 DECLARE @Author23Columns TABLE(table_name sysname,column_name sysname,type_name sysname,max_length smallint);
 INSERT @Author23Columns VALUES
 (N'pos_sync_shift_author_keys',N'scope_hash',N'char',64),(N'pos_sync_shift_author_keys',N'project_origin',N'nvarchar',4096),
 (N'pos_sync_shift_author_keys',N'terminal_id',N'nvarchar',400),(N'pos_sync_shift_author_keys',N'author_id',N'uniqueidentifier',16),
 (N'pos_sync_shift_author_keys',N'key_id',N'uniqueidentifier',16),(N'pos_sync_shift_author_keys',N'public_key',N'varchar',59),
 (N'pos_sync_shift_authors',N'intent_id',N'uniqueidentifier',16),(N'pos_sync_shift_authors',N'scope_hash',N'char',64),
 (N'pos_sync_shift_authors',N'key_id',N'uniqueidentifier',16),(N'pos_sync_shift_authors',N'attestation_json',N'nvarchar',-1);
 IF EXISTS(SELECT 1 FROM @Author23Columns e LEFT JOIN sys.columns c ON c.object_id=OBJECT_ID(N'dbo.'+e.table_name) AND c.name=e.column_name
   WHERE c.column_id IS NULL OR TYPE_NAME(c.user_type_id)<>e.type_name OR c.max_length<>e.max_length OR c.is_nullable=1 OR c.is_identity=1 OR c.is_computed=1 OR c.default_object_id<>0)
   OR EXISTS(SELECT 1 FROM sys.columns c WHERE c.object_id IN(OBJECT_ID(N'dbo.pos_sync_shift_author_keys'),OBJECT_ID(N'dbo.pos_sync_shift_authors'))
     AND NOT EXISTS(SELECT 1 FROM @Author23Columns e WHERE OBJECT_ID(N'dbo.'+e.table_name)=c.object_id AND e.column_name=c.name))
  THROW 51023,'Unexpected author metadata shape; no records were changed.',1;
 IF NOT EXISTS(SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID(N'dbo.pos_sync_shift_authors') AND name=N'CK_pos_sync_shift_authors_json'
   AND LOWER(REPLACE(REPLACE(REPLACE(definition,N' ',N''),CHAR(13),N''),CHAR(10),N'')) COLLATE Latin1_General_100_BIN2=N'(isjson([attestation_json])=(1))' COLLATE Latin1_General_100_BIN2 AND is_disabled=0 AND is_not_trusted=0)
   OR EXISTS(SELECT 1 FROM sys.check_constraints WHERE parent_object_id IN(OBJECT_ID(N'dbo.pos_sync_shift_author_keys'),OBJECT_ID(N'dbo.pos_sync_shift_authors')) AND name<>N'CK_pos_sync_shift_authors_json')
  THROW 51023,'Unexpected author metadata constraints; no records were changed.',1;
 IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.pos_sync_shift_authors') AND name=N'IX_pos_sync_shift_authors_scope')
  CREATE INDEX IX_pos_sync_shift_authors_scope ON dbo.pos_sync_shift_authors(scope_hash,key_id);
 DECLARE @Author23Keys TABLE(table_name sysname,index_name sysname,column_name sysname,ordinal int,is_unique bit);
 INSERT @Author23Keys VALUES
 (N'pos_sync_shift_author_keys',N'PK_pos_sync_shift_author_keys',N'scope_hash',1,1),
 (N'pos_sync_shift_author_keys',N'UQ_pos_sync_shift_author_keys_id',N'key_id',1,1),
 (N'pos_sync_shift_authors',N'PK_pos_sync_shift_authors',N'intent_id',1,1),
 (N'pos_sync_shift_authors',N'IX_pos_sync_shift_authors_scope',N'scope_hash',1,0),
 (N'pos_sync_shift_authors',N'IX_pos_sync_shift_authors_scope',N'key_id',2,0);
 IF EXISTS(SELECT 1 FROM @Author23Keys e LEFT JOIN sys.indexes i ON i.object_id=OBJECT_ID(N'dbo.'+e.table_name) AND i.name=e.index_name
   LEFT JOIN sys.index_columns ic ON ic.object_id=i.object_id AND ic.index_id=i.index_id AND ic.key_ordinal=e.ordinal
   LEFT JOIN sys.columns c ON c.object_id=ic.object_id AND c.column_id=ic.column_id
   WHERE c.name IS NULL OR c.name<>e.column_name OR ic.is_descending_key=1 OR i.is_unique<>e.is_unique OR i.is_disabled=1 OR i.is_hypothetical=1 OR i.ignore_dup_key=1 OR i.has_filter=1
     OR (e.index_name LIKE N'PK[_]%' AND (i.is_primary_key<>1 OR i.type<>1))
     OR (e.index_name LIKE N'UQ[_]%' AND (i.is_unique_constraint<>1 OR i.type<>2))
     OR (e.index_name LIKE N'IX[_]%' AND (i.is_primary_key<>0 OR i.is_unique_constraint<>0 OR i.type<>2)))
   OR EXISTS(SELECT 1 FROM sys.indexes i JOIN sys.index_columns ic ON ic.object_id=i.object_id AND ic.index_id=i.index_id
     WHERE EXISTS(SELECT 1 FROM @Author23Keys e WHERE OBJECT_ID(N'dbo.'+e.table_name)=i.object_id AND e.index_name=i.name)
     AND (ic.is_included_column=1 OR NOT EXISTS(SELECT 1 FROM @Author23Keys e WHERE OBJECT_ID(N'dbo.'+e.table_name)=i.object_id AND e.index_name=i.name AND e.ordinal=ic.key_ordinal)))
   OR EXISTS(SELECT 1 FROM sys.indexes i WHERE i.object_id IN(OBJECT_ID(N'dbo.pos_sync_shift_author_keys'),OBJECT_ID(N'dbo.pos_sync_shift_authors')) AND i.is_unique=1
     AND NOT EXISTS(SELECT 1 FROM @Author23Keys e WHERE OBJECT_ID(N'dbo.'+e.table_name)=i.object_id AND e.index_name=i.name))
   OR EXISTS(SELECT 1 FROM sys.foreign_keys WHERE parent_object_id IN(OBJECT_ID(N'dbo.pos_sync_shift_author_keys'),OBJECT_ID(N'dbo.pos_sync_shift_authors')))
   OR EXISTS(SELECT 1 FROM sys.triggers WHERE parent_id IN(OBJECT_ID(N'dbo.pos_sync_shift_author_keys'),OBJECT_ID(N'dbo.pos_sync_shift_authors')))
  THROW 51023,'Unexpected author metadata index; no records were changed.',1;
 COMMIT TRANSACTION;
END TRY
BEGIN CATCH
 IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;
 THROW;
END CATCH;
-- AUTH37_HISTORY_BEGIN
IF NOT EXISTS(SELECT 1 FROM dbo.pos_schema_migrations WHERE version=23)
 INSERT dbo.pos_schema_migrations(version,name) VALUES(23,N'shift_author_attestations');
