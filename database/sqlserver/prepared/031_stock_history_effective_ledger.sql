-- STOCK401 PREPARED ONLY. No USE, configuration, business backfill or activation.
-- The caller supplies the reviewed database. A containing upgrade transaction
-- owns rollback; standalone execution owns exactly one balanced transaction.
SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
DECLARE @stockHistoryOwnsTransaction bit=CASE WHEN @@TRANCOUNT=0 THEN 1 ELSE 0 END;
IF @stockHistoryOwnsTransaction=1 BEGIN TRANSACTION;
BEGIN TRY
 IF OBJECT_ID(N'dbo.products',N'U') IS NULL OR OBJECT_ID(N'dbo.sync_change_journal',N'U') IS NULL
  THROW 51031,'Stock history requires the reviewed existing Retail business and sync schema.',1;
 DECLARE @stockHistoryPresent int=(SELECT COUNT(*) FROM sys.tables WHERE schema_id=SCHEMA_ID(N'dbo') AND name IN
  (N'stock_history_heads',N'stock_history_baselines',N'stock_history_openings',N'stock_history_movements'));
 IF @stockHistoryPresent NOT IN(0,4) THROW 51031,'STOCK_HISTORY_PARTIAL_SCHEMA: stop for schema review.',1;
 IF OBJECT_ID(N'dbo.pos_schema_migrations',N'U') IS NOT NULL
 BEGIN
  IF EXISTS(SELECT 1 FROM dbo.pos_schema_migrations WHERE version=31 AND name<>N'stock_history_effective_ledger')
   THROW 51031,'STOCK_HISTORY_UNKNOWN_MIGRATION: stop for schema review.',1;
  IF @stockHistoryPresent=0 AND EXISTS(SELECT 1 FROM dbo.pos_schema_migrations WHERE version=31)
   THROW 51031,'STOCK_HISTORY_REGISTERED_DATA_MISSING: do not recreate or reset historical evidence.',1;
 END;
 IF @stockHistoryPresent=0
 BEGIN
  CREATE TABLE dbo.stock_history_heads(
   store_id nvarchar(128) NOT NULL CONSTRAINT PK_stock_history_heads PRIMARY KEY,
   committed_cursor bigint NOT NULL CONSTRAINT DF_stock_history_heads_cursor DEFAULT 0,
   coverage_generation bigint NOT NULL CONSTRAINT DF_stock_history_heads_generation DEFAULT 0,
   coverage_state nvarchar(16) NOT NULL CONSTRAINT DF_stock_history_heads_state DEFAULT N'unverified',
   baseline_id uniqueidentifier NULL,coverage_from_ticks decimal(20,0) NULL,coverage_through_ticks decimal(20,0) NULL,
   terminal_watermarks nvarchar(max) NOT NULL CONSTRAINT DF_stock_history_heads_terminals DEFAULT N'{}',
   updated_at datetimeoffset(7) NOT NULL CONSTRAINT DF_stock_history_heads_updated DEFAULT SYSDATETIMEOFFSET(),
   local_committed_cursor bigint NOT NULL CONSTRAINT DF_stock_history_heads_local DEFAULT 0,
   CONSTRAINT CK_stock_history_heads_cursor CHECK(committed_cursor>=0 AND coverage_generation>=0 AND local_committed_cursor>=0),
   CONSTRAINT CK_stock_history_heads_state CHECK(coverage_state IN(N'unverified',N'complete',N'incomplete')),
   CONSTRAINT CK_stock_history_heads_json CHECK(ISJSON(terminal_watermarks)=1 AND LEFT(LTRIM(terminal_watermarks),1)=N'{'),
   CONSTRAINT CK_stock_history_heads_coverage CHECK(coverage_state<>N'complete' OR
    (baseline_id IS NOT NULL AND coverage_from_ticks IS NOT NULL AND coverage_through_ticks IS NOT NULL AND coverage_through_ticks>=coverage_from_ticks))
  );
  CREATE TABLE dbo.stock_history_baselines(
   id uniqueidentifier NOT NULL CONSTRAINT PK_stock_history_baselines PRIMARY KEY,
   store_id nvarchar(128) NOT NULL,cutoff_at_raw nvarchar(28) NOT NULL,cutoff_ticks decimal(20,0) NOT NULL,
   captured_at_raw nvarchar(28) NOT NULL,captured_ticks decimal(20,0) NOT NULL,source_cursor bigint NOT NULL,
   opening_kind nvarchar(20) NOT NULL,verification_state nvarchar(16) NOT NULL,
   expected_pairs int NOT NULL,terminal_watermarks nvarchar(max) NOT NULL,verified_by nvarchar(128) NULL,evidence_hash char(64) NOT NULL,
   CONSTRAINT UQ_stock_history_baseline_store UNIQUE(store_id,id),
   CONSTRAINT CK_stock_history_baseline_source CHECK(source_cursor>=0 AND expected_pairs BETWEEN 0 AND 1000000),
   CONSTRAINT CK_stock_history_baseline_kind CHECK(opening_kind IN(N'system_snapshot',N'physical_count')),
   CONSTRAINT CK_stock_history_baseline_verified CHECK(verification_state IN(N'unverified',N'verified') AND
    (verification_state<>N'verified' OR NULLIF(LTRIM(RTRIM(verified_by)),N'') IS NOT NULL)),
   CONSTRAINT CK_stock_history_baseline_json CHECK(ISJSON(terminal_watermarks)=1 AND LEFT(LTRIM(terminal_watermarks),1)=N'{'),
   CONSTRAINT CK_stock_history_baseline_hash CHECK(evidence_hash NOT LIKE '%[^0-9a-f]%' COLLATE Latin1_General_100_BIN2),
   CONSTRAINT CK_stock_history_baseline_clock CHECK(captured_ticks>=cutoff_ticks AND LEN(cutoff_at_raw)=28 AND LEN(captured_at_raw)=28
    AND RIGHT(cutoff_at_raw,1)=N'Z' AND RIGHT(captured_at_raw,1)=N'Z'
    AND TRY_CONVERT(datetimeoffset(7),cutoff_at_raw,127) IS NOT NULL AND TRY_CONVERT(datetimeoffset(7),captured_at_raw,127) IS NOT NULL
    AND cutoff_ticks=DATEDIFF_BIG(SECOND,CONVERT(datetimeoffset(7),'1970-01-01T00:00:00Z',127),CONVERT(datetimeoffset(7),cutoff_at_raw,127))*CONVERT(bigint,10000000)+DATEPART(NANOSECOND,CONVERT(datetimeoffset(7),cutoff_at_raw,127))/100
    AND captured_ticks=DATEDIFF_BIG(SECOND,CONVERT(datetimeoffset(7),'1970-01-01T00:00:00Z',127),CONVERT(datetimeoffset(7),captured_at_raw,127))*CONVERT(bigint,10000000)+DATEPART(NANOSECOND,CONVERT(datetimeoffset(7),captured_at_raw,127))/100)
  );
  CREATE TABLE dbo.stock_history_openings(
   id uniqueidentifier NOT NULL CONSTRAINT PK_stock_history_openings PRIMARY KEY,
   baseline_id uniqueidentifier NOT NULL,product_id uniqueidentifier NOT NULL,store_id nvarchar(128) NOT NULL,
   quantity decimal(38,0) NOT NULL,product_name nvarchar(max) NOT NULL,sku nvarchar(max) NULL,barcode nvarchar(max) NULL,owner_store_id nvarchar(128) NULL,
   CONSTRAINT FK_stock_history_opening_baseline FOREIGN KEY(store_id,baseline_id) REFERENCES dbo.stock_history_baselines(store_id,id),
   CONSTRAINT UQ_stock_history_opening_pair UNIQUE(baseline_id,product_id,store_id)
  );
  CREATE TABLE dbo.stock_history_movements(
   id uniqueidentifier NOT NULL CONSTRAINT PK_stock_history_movements PRIMARY KEY,
   operation_id uniqueidentifier NOT NULL,product_id uniqueidentifier NOT NULL,store_id nvarchar(128) NOT NULL,
   terminal_id nvarchar(128) NOT NULL,actor_id nvarchar(128) NULL,source_kind nvarchar(20) NOT NULL,
   quantity_delta decimal(38,0) NOT NULL,effective_at_raw nvarchar(28) NOT NULL,effective_ticks decimal(20,0) NOT NULL,
   recorded_at_raw nvarchar(28) NOT NULL,recorded_ticks decimal(20,0) NOT NULL,
   product_name nvarchar(max) NOT NULL,sku nvarchar(max) NULL,barcode nvarchar(max) NULL,
   clock_state nvarchar(16) NOT NULL,payload_hash char(64) NOT NULL,payload_json nvarchar(max) NOT NULL,
   author_proof_json nvarchar(max) NULL,
   upload_aggregate_id uniqueidentifier NULL,
   ingested_cursor bigint NULL,ingested_at datetimeoffset(7) NULL,local_cursor bigint NOT NULL,
   CONSTRAINT UQ_stock_history_movement_leg UNIQUE(operation_id,product_id,store_id),
   CONSTRAINT CK_stock_history_movement_delta CHECK(quantity_delta<>0),
   CONSTRAINT CK_stock_history_movement_cursor CHECK(local_cursor>0 AND (ingested_cursor IS NULL OR ingested_cursor>0)),
   CONSTRAINT CK_stock_history_movement_clockstate CHECK(clock_state IN(N'verified',N'unverified')),
   CONSTRAINT CK_stock_history_movement_hash CHECK(payload_hash NOT LIKE '%[^0-9a-f]%' COLLATE Latin1_General_100_BIN2),
   CONSTRAINT CK_stock_history_movement_json CHECK(ISJSON(payload_json)=1 AND LEFT(LTRIM(payload_json),1)=N'['),
   CONSTRAINT CK_stock_history_movement_clock CHECK(effective_ticks<=recorded_ticks AND LEN(effective_at_raw)=28 AND LEN(recorded_at_raw)=28
    AND RIGHT(effective_at_raw,1)=N'Z' AND RIGHT(recorded_at_raw,1)=N'Z'
    AND TRY_CONVERT(datetimeoffset(7),effective_at_raw,127) IS NOT NULL AND TRY_CONVERT(datetimeoffset(7),recorded_at_raw,127) IS NOT NULL
    AND effective_ticks=DATEDIFF_BIG(SECOND,CONVERT(datetimeoffset(7),'1970-01-01T00:00:00Z',127),CONVERT(datetimeoffset(7),effective_at_raw,127))*CONVERT(bigint,10000000)+DATEPART(NANOSECOND,CONVERT(datetimeoffset(7),effective_at_raw,127))/100
    AND recorded_ticks=DATEDIFF_BIG(SECOND,CONVERT(datetimeoffset(7),'1970-01-01T00:00:00Z',127),CONVERT(datetimeoffset(7),recorded_at_raw,127))*CONVERT(bigint,10000000)+DATEPART(NANOSECOND,CONVERT(datetimeoffset(7),recorded_at_raw,127))/100)
  );
  CREATE INDEX IX_stock_history_movements_cutoff ON dbo.stock_history_movements(store_id,effective_ticks,local_cursor,product_id);
  CREATE INDEX IX_stock_history_openings_page ON dbo.stock_history_openings(store_id,baseline_id,product_id);
 END;

 -- Exact physical shape is checked before recording readiness. In particular,
 -- nullable SQL metadata/cursor fields must not be mistaken for verified cloud
 -- acceptance. The runtime also validates these columns before using the feature.
 DECLARE @stockHistoryExpected table(table_name sysname,column_name sysname,type_name sysname,max_length smallint,precision tinyint,scale tinyint,is_nullable bit);
 INSERT @stockHistoryExpected VALUES
 (N'stock_history_heads',N'store_id',N'nvarchar',256,0,0,0),(N'stock_history_heads',N'committed_cursor',N'bigint',8,19,0,0),
 (N'stock_history_heads',N'coverage_generation',N'bigint',8,19,0,0),(N'stock_history_heads',N'coverage_state',N'nvarchar',32,0,0,0),
 (N'stock_history_heads',N'baseline_id',N'uniqueidentifier',16,0,0,1),(N'stock_history_heads',N'coverage_from_ticks',N'decimal',13,20,0,1),
 (N'stock_history_heads',N'coverage_through_ticks',N'decimal',13,20,0,1),(N'stock_history_heads',N'terminal_watermarks',N'nvarchar',-1,0,0,0),
 (N'stock_history_heads',N'updated_at',N'datetimeoffset',10,34,7,0),(N'stock_history_heads',N'local_committed_cursor',N'bigint',8,19,0,0),
 (N'stock_history_baselines',N'id',N'uniqueidentifier',16,0,0,0),(N'stock_history_baselines',N'store_id',N'nvarchar',256,0,0,0),
 (N'stock_history_baselines',N'cutoff_at_raw',N'nvarchar',56,0,0,0),(N'stock_history_baselines',N'cutoff_ticks',N'decimal',13,20,0,0),
 (N'stock_history_baselines',N'captured_at_raw',N'nvarchar',56,0,0,0),(N'stock_history_baselines',N'captured_ticks',N'decimal',13,20,0,0),
 (N'stock_history_baselines',N'source_cursor',N'bigint',8,19,0,0),(N'stock_history_baselines',N'opening_kind',N'nvarchar',40,0,0,0),
 (N'stock_history_baselines',N'verification_state',N'nvarchar',32,0,0,0),(N'stock_history_baselines',N'expected_pairs',N'int',4,10,0,0),
 (N'stock_history_baselines',N'terminal_watermarks',N'nvarchar',-1,0,0,0),(N'stock_history_baselines',N'verified_by',N'nvarchar',256,0,0,1),
 (N'stock_history_baselines',N'evidence_hash',N'char',64,0,0,0),
 (N'stock_history_openings',N'id',N'uniqueidentifier',16,0,0,0),(N'stock_history_openings',N'baseline_id',N'uniqueidentifier',16,0,0,0),
 (N'stock_history_openings',N'product_id',N'uniqueidentifier',16,0,0,0),(N'stock_history_openings',N'store_id',N'nvarchar',256,0,0,0),
 (N'stock_history_openings',N'quantity',N'decimal',17,38,0,0),(N'stock_history_openings',N'product_name',N'nvarchar',-1,0,0,0),
 (N'stock_history_openings',N'sku',N'nvarchar',-1,0,0,1),(N'stock_history_openings',N'barcode',N'nvarchar',-1,0,0,1),(N'stock_history_openings',N'owner_store_id',N'nvarchar',256,0,0,1),
 (N'stock_history_movements',N'id',N'uniqueidentifier',16,0,0,0),(N'stock_history_movements',N'operation_id',N'uniqueidentifier',16,0,0,0),
 (N'stock_history_movements',N'product_id',N'uniqueidentifier',16,0,0,0),(N'stock_history_movements',N'store_id',N'nvarchar',256,0,0,0),
 (N'stock_history_movements',N'terminal_id',N'nvarchar',256,0,0,0),(N'stock_history_movements',N'actor_id',N'nvarchar',256,0,0,1),
 (N'stock_history_movements',N'source_kind',N'nvarchar',40,0,0,0),(N'stock_history_movements',N'quantity_delta',N'decimal',17,38,0,0),
 (N'stock_history_movements',N'effective_at_raw',N'nvarchar',56,0,0,0),(N'stock_history_movements',N'effective_ticks',N'decimal',13,20,0,0),
 (N'stock_history_movements',N'recorded_at_raw',N'nvarchar',56,0,0,0),(N'stock_history_movements',N'recorded_ticks',N'decimal',13,20,0,0),
 (N'stock_history_movements',N'product_name',N'nvarchar',-1,0,0,0),(N'stock_history_movements',N'sku',N'nvarchar',-1,0,0,1),(N'stock_history_movements',N'barcode',N'nvarchar',-1,0,0,1),
 (N'stock_history_movements',N'clock_state',N'nvarchar',32,0,0,0),(N'stock_history_movements',N'payload_hash',N'char',64,0,0,0),
 (N'stock_history_movements',N'payload_json',N'nvarchar',-1,0,0,0),
 (N'stock_history_movements',N'author_proof_json',N'nvarchar',-1,0,0,1),
 (N'stock_history_movements',N'upload_aggregate_id',N'uniqueidentifier',16,0,0,1),
 (N'stock_history_movements',N'ingested_cursor',N'bigint',8,19,0,1),(N'stock_history_movements',N'ingested_at',N'datetimeoffset',10,34,7,1),
 (N'stock_history_movements',N'local_cursor',N'bigint',8,19,0,0);
 IF EXISTS(SELECT * FROM @stockHistoryExpected EXCEPT SELECT t.name,c.name,ty.name,c.max_length,c.precision,c.scale,c.is_nullable
  FROM sys.tables t JOIN sys.columns c ON c.object_id=t.object_id JOIN sys.types ty ON ty.user_type_id=c.user_type_id
  WHERE t.schema_id=SCHEMA_ID(N'dbo') AND t.name IN(N'stock_history_heads',N'stock_history_baselines',N'stock_history_openings',N'stock_history_movements'))
 OR EXISTS(SELECT t.name,c.name,ty.name,c.max_length,c.precision,c.scale,c.is_nullable
  FROM sys.tables t JOIN sys.columns c ON c.object_id=t.object_id JOIN sys.types ty ON ty.user_type_id=c.user_type_id
  WHERE t.schema_id=SCHEMA_ID(N'dbo') AND t.name IN(N'stock_history_heads',N'stock_history_baselines',N'stock_history_openings',N'stock_history_movements')
  EXCEPT SELECT * FROM @stockHistoryExpected)
  THROW 51031,'STOCK_HISTORY_UNKNOWN_SCHEMA: no existing shape was changed.',1;


 -- STOCK_HISTORY_OBJECT_GUARD_BEGIN
 IF @stockHistoryPresent=4
 BEGIN
  DECLARE @stockHistoryObjects table(table_name sysname,kind nvarchar(32),object_name sysname,object_hash varchar(64));
  INSERT @stockHistoryObjects VALUES
 (N'stock_history_heads',N'check',N'CK_stock_history_heads_cursor','F934C35EC7C5CE86F7749AB37F0793D194BBE6E0E9C3059C43710CE02220FD12'),
 (N'stock_history_heads',N'check',N'CK_stock_history_heads_state','79BECD9A613A25FF618047652105FAAD581F18375201B2B855C53FA04BA72C78'),
 (N'stock_history_heads',N'check',N'CK_stock_history_heads_json','D768D3E329A175891F6A09AF234E0D8357E273A121C4116B7A9F6D82DF475E8B'),
 (N'stock_history_heads',N'check',N'CK_stock_history_heads_coverage','B55DE85EB4CEA8E8D1428EA0A7BDDDB9AE1CF9B188DE6A5653FE0D06938D1943'),
 (N'stock_history_baselines',N'check',N'CK_stock_history_baseline_source','FD076904B3CA7BD23B30F0468AE697E3E1E02DEB8CAA0D4B98E451C57DE82F01'),
 (N'stock_history_baselines',N'check',N'CK_stock_history_baseline_kind','0028DC711C921F1B6DD46556223B0FCD4E6F739E35E421A6AC2160EA21B5555F'),
 (N'stock_history_baselines',N'check',N'CK_stock_history_baseline_verified','1E2666D648B9115E48D6215753DF9D2E2F71CC7F9BED68EC57AC658CE569E90C'),
 (N'stock_history_baselines',N'check',N'CK_stock_history_baseline_json','D768D3E329A175891F6A09AF234E0D8357E273A121C4116B7A9F6D82DF475E8B'),
 (N'stock_history_baselines',N'check',N'CK_stock_history_baseline_hash','5D1A87B1497A61444AC66E5AC63B444638A789E568734E6CBEFC5B42823DDAEE'),
 (N'stock_history_baselines',N'check',N'CK_stock_history_baseline_clock','7F15BF66019C84DAB13F4113133AE04E155759495EB71DE2917EB2C8635B1AC0'),
 (N'stock_history_movements',N'check',N'CK_stock_history_movement_delta','A4300ECBD009185EABA2783349F3BE7927B06AD7B5CED0BDD053BB9FBD106938'),
 (N'stock_history_movements',N'check',N'CK_stock_history_movement_cursor','467B40C90898510A134CFACEF39AC076FC8C59E3DC5EA92134812180562461E9'),
 (N'stock_history_movements',N'check',N'CK_stock_history_movement_clockstate','C1A9BBCB015E6B25349F86B8FA9F50C02BA82215650FF5536F977A5F7FE5ABA7'),
 (N'stock_history_movements',N'check',N'CK_stock_history_movement_hash','337C2581E626929434C2BF1F7C3EF6BD5ABC3D35A6CB87661793E0F476B1F7F0'),
 (N'stock_history_movements',N'check',N'CK_stock_history_movement_json','9BD349A9380970F2701E88E241DA03B87972E513439EF620C68E1960257307D0'),
 (N'stock_history_movements',N'check',N'CK_stock_history_movement_clock','517189FB97EEC905E34C36D29874B405FF649A9E0F00183BDD45407352172DA2'),
 (N'stock_history_heads',N'default',N'DF_stock_history_heads_cursor','80435AD34717DF8FC1B860E898C08379C46A83928D59205675F5C3CD83F6885F'),
 (N'stock_history_heads',N'default',N'DF_stock_history_heads_generation','80435AD34717DF8FC1B860E898C08379C46A83928D59205675F5C3CD83F6885F'),
 (N'stock_history_heads',N'default',N'DF_stock_history_heads_state','173038A3D62958A2F1A0EBBB67CF2D85B81829A5ADB7E72C5D985ECA0A06FA53'),
 (N'stock_history_heads',N'default',N'DF_stock_history_heads_terminals','978CFFA940D0E7CEE40E4E2CFC60EA7325F97317E135029F4566B2A5AC297D5C'),
 (N'stock_history_heads',N'default',N'DF_stock_history_heads_updated','096818D93FB628B7CA954230703AA88D426B4BFC9B9AC6A28D8DDA30F02FF0AB'),
 (N'stock_history_heads',N'default',N'DF_stock_history_heads_local','80435AD34717DF8FC1B860E898C08379C46A83928D59205675F5C3CD83F6885F'),
 (N'stock_history_baselines',N'index',N'PK_stock_history_baselines','0AAF6492B5C53742C2A13DB17CB820200785DDB56BAF95867AA08993135012A2'),
 (N'stock_history_baselines',N'index',N'UQ_stock_history_baseline_store','6BFD486DE4368ECF509C5ACBFEE922AABCF4C75766F1455B2A08CD2F87A88E21'),
 (N'stock_history_heads',N'index',N'PK_stock_history_heads','0AAF6492B5C53742C2A13DB17CB820200785DDB56BAF95867AA08993135012A2'),
 (N'stock_history_movements',N'index',N'PK_stock_history_movements','0AAF6492B5C53742C2A13DB17CB820200785DDB56BAF95867AA08993135012A2'),
 (N'stock_history_movements',N'index',N'UQ_stock_history_movement_leg','6BFD486DE4368ECF509C5ACBFEE922AABCF4C75766F1455B2A08CD2F87A88E21'),
 (N'stock_history_movements',N'index',N'IX_stock_history_movements_cutoff','DAC99F1FE23182A2427D42DB8BC4D62991006B71D94C93478DEE418D22FE242F'),
 (N'stock_history_openings',N'index',N'PK_stock_history_openings','0AAF6492B5C53742C2A13DB17CB820200785DDB56BAF95867AA08993135012A2'),
 (N'stock_history_openings',N'index',N'UQ_stock_history_opening_pair','6BFD486DE4368ECF509C5ACBFEE922AABCF4C75766F1455B2A08CD2F87A88E21'),
 (N'stock_history_openings',N'index',N'IX_stock_history_openings_page','DAC99F1FE23182A2427D42DB8BC4D62991006B71D94C93478DEE418D22FE242F'),
 (N'stock_history_baselines',N'index-column',N'PK_stock_history_baselines:id','818D834556138D72D4961745E1BBFC8C789FB54910F82087A838CD97D5E33E69'),
 (N'stock_history_baselines',N'index-column',N'UQ_stock_history_baseline_store:store_id','818D834556138D72D4961745E1BBFC8C789FB54910F82087A838CD97D5E33E69'),
 (N'stock_history_baselines',N'index-column',N'UQ_stock_history_baseline_store:id','49BE5E1D6EDE8D06D7892EC3331DC844B27A61A2205BFBB354DA5A1352EABE5B'),
 (N'stock_history_heads',N'index-column',N'PK_stock_history_heads:store_id','818D834556138D72D4961745E1BBFC8C789FB54910F82087A838CD97D5E33E69'),
 (N'stock_history_movements',N'index-column',N'PK_stock_history_movements:id','818D834556138D72D4961745E1BBFC8C789FB54910F82087A838CD97D5E33E69'),
 (N'stock_history_movements',N'index-column',N'UQ_stock_history_movement_leg:operation_id','818D834556138D72D4961745E1BBFC8C789FB54910F82087A838CD97D5E33E69'),
 (N'stock_history_movements',N'index-column',N'UQ_stock_history_movement_leg:product_id','49BE5E1D6EDE8D06D7892EC3331DC844B27A61A2205BFBB354DA5A1352EABE5B'),
 (N'stock_history_movements',N'index-column',N'UQ_stock_history_movement_leg:store_id','A0EC67ED48C5FF1C54F30DEE3EBB5A2F03AD3EFA3861DE197FFFC504A7B45368'),
 (N'stock_history_movements',N'index-column',N'IX_stock_history_movements_cutoff:store_id','818D834556138D72D4961745E1BBFC8C789FB54910F82087A838CD97D5E33E69'),
 (N'stock_history_movements',N'index-column',N'IX_stock_history_movements_cutoff:effective_ticks','49BE5E1D6EDE8D06D7892EC3331DC844B27A61A2205BFBB354DA5A1352EABE5B'),
 (N'stock_history_movements',N'index-column',N'IX_stock_history_movements_cutoff:local_cursor','A0EC67ED48C5FF1C54F30DEE3EBB5A2F03AD3EFA3861DE197FFFC504A7B45368'),
 (N'stock_history_movements',N'index-column',N'IX_stock_history_movements_cutoff:product_id','7A11A082E7E685BE23EE6650B664550076489EFDE1366D238CA2AFD0AC4B2C0F'),
 (N'stock_history_openings',N'index-column',N'PK_stock_history_openings:id','818D834556138D72D4961745E1BBFC8C789FB54910F82087A838CD97D5E33E69'),
 (N'stock_history_openings',N'index-column',N'UQ_stock_history_opening_pair:baseline_id','818D834556138D72D4961745E1BBFC8C789FB54910F82087A838CD97D5E33E69'),
 (N'stock_history_openings',N'index-column',N'UQ_stock_history_opening_pair:product_id','49BE5E1D6EDE8D06D7892EC3331DC844B27A61A2205BFBB354DA5A1352EABE5B'),
 (N'stock_history_openings',N'index-column',N'UQ_stock_history_opening_pair:store_id','A0EC67ED48C5FF1C54F30DEE3EBB5A2F03AD3EFA3861DE197FFFC504A7B45368'),
 (N'stock_history_openings',N'index-column',N'IX_stock_history_openings_page:store_id','818D834556138D72D4961745E1BBFC8C789FB54910F82087A838CD97D5E33E69'),
 (N'stock_history_openings',N'index-column',N'IX_stock_history_openings_page:baseline_id','49BE5E1D6EDE8D06D7892EC3331DC844B27A61A2205BFBB354DA5A1352EABE5B'),
 (N'stock_history_openings',N'index-column',N'IX_stock_history_openings_page:product_id','A0EC67ED48C5FF1C54F30DEE3EBB5A2F03AD3EFA3861DE197FFFC504A7B45368'),
 (N'stock_history_openings',N'foreign-key',N'FK_stock_history_opening_baseline','4ADEEC1B15BE249B1C4A37646E113214EE632F6205FFA8ED6355A7EE17D5DFE4'),
 (N'stock_history_openings',N'foreign-key-column',N'FK_stock_history_opening_baseline:baseline_id','C853D5347D4C6621BD8F27ED3A32FCC2050B9CC84D5E54224C7D89631854179D'),
 (N'stock_history_openings',N'foreign-key-column',N'FK_stock_history_opening_baseline:store_id','12FD9F2951C0B32A035D9036A822A9E0B8365713D9BD39F6D5706C02A9002E93'),
 (N'stock_history_movements',N'trigger',N'TR_stock_history_movement_immutable','5149A62203909C26E515B0B119B1FDBE4E320615D6CBE8DD4C75B2CFE7DF34E5'),
 (N'stock_history_baselines',N'trigger',N'TR_stock_history_baseline_immutable','E19611E543A0B34E839DA84AC3AB6FEA5C4F4D65DF18028F22F1C28B90011763'),
 (N'stock_history_openings',N'trigger',N'TR_stock_history_opening_immutable','C628DA9CB7B67D0D18342D6A8D37459DAAF141FAF00BB6D25C5A263C091147B4');
  DECLARE @stockHistoryActualObjects table(table_name sysname,kind nvarchar(32),object_name sysname,object_hash varchar(64));
  INSERT @stockHistoryActualObjects EXEC sys.sp_executesql N'
WITH objects AS(
 SELECT t.name table_name,N''check'' kind,c.name object_name,CONCAT(c.is_disabled,N''|'',c.is_not_trusted,N''|'',c.definition) definition
 FROM sys.tables t JOIN sys.check_constraints c ON c.parent_object_id=t.object_id
 WHERE t.schema_id=SCHEMA_ID(N''dbo'') AND t.name IN(N''stock_history_heads'',N''stock_history_baselines'',N''stock_history_openings'',N''stock_history_movements'')
 UNION ALL
 SELECT t.name,N''default'',c.name,c.definition FROM sys.tables t JOIN sys.default_constraints c ON c.parent_object_id=t.object_id
 WHERE t.schema_id=SCHEMA_ID(N''dbo'') AND t.name IN(N''stock_history_heads'',N''stock_history_baselines'',N''stock_history_openings'',N''stock_history_movements'')
 UNION ALL
 SELECT t.name,N''index'',i.name,CONCAT(i.is_unique,N''|'',i.is_primary_key,N''|'',i.type,N''|'',i.is_disabled,N''|'',COALESCE(i.filter_definition,N''''))
 FROM sys.tables t JOIN sys.indexes i ON i.object_id=t.object_id AND i.index_id>0
 WHERE t.schema_id=SCHEMA_ID(N''dbo'') AND t.name IN(N''stock_history_heads'',N''stock_history_baselines'',N''stock_history_openings'',N''stock_history_movements'')
 UNION ALL
 SELECT t.name,N''index-column'',CONCAT(i.name,N'':'',c.name),CONCAT(ic.key_ordinal,N''|'',ic.is_descending_key,N''|'',ic.is_included_column)
 FROM sys.tables t JOIN sys.indexes i ON i.object_id=t.object_id AND i.index_id>0
 JOIN sys.index_columns ic ON ic.object_id=i.object_id AND ic.index_id=i.index_id JOIN sys.columns c ON c.object_id=ic.object_id AND c.column_id=ic.column_id
 WHERE t.schema_id=SCHEMA_ID(N''dbo'') AND t.name IN(N''stock_history_heads'',N''stock_history_baselines'',N''stock_history_openings'',N''stock_history_movements'')
 UNION ALL
 SELECT t.name,N''foreign-key'',f.name,CONCAT(f.is_disabled,N''|'',f.is_not_trusted,N''|'',f.delete_referential_action,N''|'',f.update_referential_action)
 FROM sys.tables t JOIN sys.foreign_keys f ON f.parent_object_id=t.object_id
 WHERE t.schema_id=SCHEMA_ID(N''dbo'') AND t.name IN(N''stock_history_heads'',N''stock_history_baselines'',N''stock_history_openings'',N''stock_history_movements'')
 UNION ALL
 SELECT t.name,N''foreign-key-column'',CONCAT(f.name,N'':'',c.name),CONCAT(fc.constraint_column_id,N''|'',OBJECT_SCHEMA_NAME(fc.referenced_object_id),N''.'',OBJECT_NAME(fc.referenced_object_id),N''|'',r.name)
 FROM sys.tables t JOIN sys.foreign_keys f ON f.parent_object_id=t.object_id JOIN sys.foreign_key_columns fc ON fc.constraint_object_id=f.object_id
 JOIN sys.columns c ON c.object_id=fc.parent_object_id AND c.column_id=fc.parent_column_id JOIN sys.columns r ON r.object_id=fc.referenced_object_id AND r.column_id=fc.referenced_column_id
 WHERE t.schema_id=SCHEMA_ID(N''dbo'') AND t.name IN(N''stock_history_heads'',N''stock_history_baselines'',N''stock_history_openings'',N''stock_history_movements'')
 UNION ALL
 SELECT t.name,N''trigger'',tr.name,CONCAT(tr.is_disabled,N''|'',REPLACE(m.definition,CHAR(13)+CHAR(10),CHAR(10)))
 FROM sys.tables t JOIN sys.triggers tr ON tr.parent_id=t.object_id JOIN sys.sql_modules m ON m.object_id=tr.object_id
 WHERE t.schema_id=SCHEMA_ID(N''dbo'') AND t.name IN(N''stock_history_heads'',N''stock_history_baselines'',N''stock_history_openings'',N''stock_history_movements'')
)
SELECT table_name,kind,object_name,CONVERT(varchar(64),HASHBYTES(''SHA2_256'',CONVERT(nvarchar(max),definition)),2) object_hash
FROM objects';
  IF EXISTS(SELECT * FROM @stockHistoryObjects EXCEPT SELECT * FROM @stockHistoryActualObjects)
   OR EXISTS(SELECT * FROM @stockHistoryActualObjects EXCEPT SELECT * FROM @stockHistoryObjects)
   THROW 51031,'STOCK_HISTORY_UNKNOWN_OBJECT: no constraint or trigger was changed.',1;
 END;
 -- STOCK_HISTORY_OBJECT_GUARD_END

 -- Acceptance may fill arrival metadata once; the original physical claim is
 -- immutable. A hash alone is not used as an equality/authorization shortcut.
 EXEC(N'CREATE OR ALTER TRIGGER dbo.TR_stock_history_movement_immutable ON dbo.stock_history_movements AFTER UPDATE,DELETE AS
 BEGIN SET NOCOUNT ON;
  IF EXISTS(SELECT id FROM deleted EXCEPT SELECT id FROM inserted)
   OR EXISTS(SELECT id,operation_id,product_id,store_id,terminal_id,actor_id,source_kind,quantity_delta,effective_at_raw,effective_ticks,recorded_at_raw,recorded_ticks,product_name,sku,barcode,clock_state,payload_hash,payload_json,local_cursor,upload_aggregate_id FROM deleted
    EXCEPT SELECT id,operation_id,product_id,store_id,terminal_id,actor_id,source_kind,quantity_delta,effective_at_raw,effective_ticks,recorded_at_raw,recorded_ticks,product_name,sku,barcode,clock_state,payload_hash,payload_json,local_cursor,upload_aggregate_id FROM inserted)
   OR EXISTS(SELECT 1 FROM inserted i JOIN deleted d ON i.id=d.id WHERE
    (i.author_proof_json IS NULL AND d.author_proof_json IS NOT NULL) OR (i.author_proof_json IS NOT NULL AND d.author_proof_json IS NULL)
    OR DATALENGTH(i.author_proof_json)<>DATALENGTH(d.author_proof_json)
    OR CONVERT(varbinary(max),i.author_proof_json)<>CONVERT(varbinary(max),d.author_proof_json))
   OR EXISTS(SELECT 1 FROM inserted i JOIN deleted d ON i.id=d.id WHERE d.ingested_cursor IS NOT NULL OR i.ingested_cursor IS NULL OR i.ingested_at IS NULL)
   THROW 51031,''STOCK_HISTORY_IMMUTABLE'',1;
 END;');
 EXEC(N'CREATE OR ALTER TRIGGER dbo.TR_stock_history_baseline_immutable ON dbo.stock_history_baselines AFTER UPDATE,DELETE AS
 BEGIN SET NOCOUNT ON; THROW 51031,''STOCK_HISTORY_IMMUTABLE'',1; END;');
 EXEC(N'CREATE OR ALTER TRIGGER dbo.TR_stock_history_opening_immutable ON dbo.stock_history_openings AFTER UPDATE,DELETE AS
 BEGIN SET NOCOUNT ON; THROW 51031,''STOCK_HISTORY_IMMUTABLE'',1; END;');
 IF OBJECT_ID(N'dbo.pos_schema_migrations',N'U') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dbo.pos_schema_migrations WHERE version=31)
  INSERT dbo.pos_schema_migrations(version,name) VALUES(31,N'stock_history_effective_ledger');
 IF @stockHistoryOwnsTransaction=1 COMMIT TRANSACTION;
END TRY
BEGIN CATCH
 IF @stockHistoryOwnsTransaction=1 AND XACT_STATE()<>0 ROLLBACK TRANSACTION;
 THROW;
END CATCH;
