SET NOCOUNT ON;
DECLARE @local_cursor bigint,@committed bigint,@installed_generation bigint,@installed_revision nvarchar(64),
 @installed_project nvarchar(400),@installed_terminal nvarchar(128),@watermarks nvarchar(max),@existing_branch nvarchar(128);
DECLARE @baseline_id uniqueidentifier=CONVERT(uniqueidentifier,@baseline),@first_cursor bigint=CONVERT(bigint,@source_cursor);

-- Parse and check the already verified package before locking the report head.
IF @revision IS NOT NULL
BEGIN
CREATE TABLE #StockDownloadOpenings(id uniqueidentifier NOT NULL PRIMARY KEY,product_id uniqueidentifier NOT NULL UNIQUE,
 quantity decimal(38,0) NOT NULL,product_name nvarchar(max) NOT NULL,sku nvarchar(max) NULL,barcode nvarchar(max) NULL,owner_store_id nvarchar(128) NULL);
INSERT #StockDownloadOpenings
 SELECT id,product_id,quantity,product_name,sku,barcode,owner_store_id
 FROM OPENJSON(@openings) WITH(id uniqueidentifier,product_id uniqueidentifier '$.productId',quantity decimal(38,0),
  product_name nvarchar(max) '$.productName',sku nvarchar(max),barcode nvarchar(max),owner_store_id nvarchar(128) '$.ownerStoreId');
CREATE TABLE #StockDownloadMovements(id uniqueidentifier NOT NULL PRIMARY KEY,operation_id uniqueidentifier NOT NULL,product_id uniqueidentifier NOT NULL,
 terminal_id nvarchar(128) NOT NULL,actor_id nvarchar(128) NULL,source_kind nvarchar(20) NOT NULL,
 quantity_delta decimal(38,0) NOT NULL,effective_at_raw nvarchar(28) NOT NULL,effective_ticks decimal(20,0) NOT NULL,
 recorded_at_raw nvarchar(28) NOT NULL,recorded_ticks decimal(20,0) NOT NULL,product_name nvarchar(max) NOT NULL,sku nvarchar(max) NULL,barcode nvarchar(max) NULL,
 clock_state nvarchar(16) NOT NULL,payload_hash char(64) NOT NULL,payload_json nvarchar(max) NOT NULL,
 ingested_cursor bigint NOT NULL UNIQUE,ingested_at datetimeoffset(7) NOT NULL,UNIQUE(operation_id,product_id));
INSERT #StockDownloadMovements
 SELECT id,operation_id,product_id,terminal_id,actor_id,source_kind,quantity_delta,effective_at_raw,effective_ticks,recorded_at_raw,
  recorded_ticks,product_name,sku,barcode,clock_state,payload_hash,payload_json,ingested_cursor,CONVERT(datetimeoffset(7),ingested_at,127)
 FROM OPENJSON(@movements) WITH(id uniqueidentifier,operation_id uniqueidentifier '$.operationId',product_id uniqueidentifier '$.productId',
  terminal_id nvarchar(128) '$.terminalId',actor_id nvarchar(128) '$.actorId',source_kind nvarchar(20) '$.kind',quantity_delta decimal(38,0) '$.delta',
  effective_at_raw nvarchar(28) '$.effectiveAt',effective_ticks decimal(20,0) '$.effectiveTicks',recorded_at_raw nvarchar(28) '$.recordedAt',
  recorded_ticks decimal(20,0) '$.recordedTicks',product_name nvarchar(max) '$.productName',sku nvarchar(max),barcode nvarchar(max),clock_state nvarchar(16) '$.clockState',
  payload_hash char(64) '$.payloadHash',payload_json nvarchar(max) '$.payloadJson',ingested_cursor bigint '$.ingestedCursor',ingested_at nvarchar(28) '$.ingestedAt');
IF (SELECT COUNT_BIG(*) FROM #StockDownloadOpenings)<>@expected_pairs
 OR (SELECT COUNT_BIG(*) FROM #StockDownloadMovements)<>CONVERT(bigint,@head_cursor)-@first_cursor
 OR EXISTS(SELECT 1 FROM #StockDownloadMovements WHERE ingested_cursor<=@first_cursor OR ingested_cursor>CONVERT(bigint,@head_cursor))
 THROW 51031,'STOCK_HISTORY_DOWNLOAD_COUNT_MISMATCH',1;
END;

SELECT @local_cursor=local_committed_cursor,@committed=committed_cursor,@watermarks=terminal_watermarks,@existing_branch=store_id,
 @installed_generation=TRY_CONVERT(bigint,JSON_VALUE(terminal_watermarks,'$.stockHistoryDownload.coverageGeneration')),
 @installed_revision=JSON_VALUE(terminal_watermarks,'$.stockHistoryDownload.revision'),
 @installed_project=JSON_VALUE(terminal_watermarks,'$.stockHistoryDownload.projectOrigin'),
 @installed_terminal=JSON_VALUE(terminal_watermarks,'$.stockHistoryDownload.terminalId')
FROM dbo.stock_history_heads WITH(UPDLOCK,HOLDLOCK) WHERE store_id=@branch;
IF (@existing_branch IS NOT NULL AND CONVERT(varbinary(max),@existing_branch)<>CONVERT(varbinary(max),@branch))
 OR (@installed_generation IS NOT NULL AND (CONVERT(varbinary(max),@installed_project)<>CONVERT(varbinary(max),@project)
  OR CONVERT(varbinary(max),@installed_terminal)<>CONVERT(varbinary(max),@terminal) OR @installed_project IS NULL OR @installed_terminal IS NULL))
 THROW 51031,'STOCK_HISTORY_DOWNLOAD_SCOPE_CHANGED',1;
IF @installed_generation>CONVERT(bigint,@generation)
 OR (@installed_generation=CONVERT(bigint,@generation) AND @revision IS NOT NULL AND COALESCE(@installed_revision,'')<>@revision)
 THROW 51031,'STOCK_HISTORY_DOWNLOAD_STALE',1;
IF @installed_generation=CONVERT(bigint,@generation) AND (@revision IS NULL OR @installed_revision=@revision)
 BEGIN SELECT N'unchanged' status; RETURN; END;

IF @revision IS NULL
BEGIN
 IF @existing_branch IS NULL INSERT dbo.stock_history_heads(store_id) VALUES(@branch);
 UPDATE dbo.stock_history_heads SET coverage_state=N'incomplete',coverage_generation=coverage_generation+1,
  terminal_watermarks=JSON_MODIFY(terminal_watermarks,'$.stockHistoryDownload',JSON_QUERY(@provenance)),updated_at=SYSDATETIMEOFFSET()
 WHERE store_id=@branch;
 SELECT N'withdrawn' status; RETURN;
END;

IF @committed>CONVERT(bigint,@head_cursor) THROW 51031,'STOCK_HISTORY_DOWNLOAD_STALE',1;
IF EXISTS(SELECT 1 FROM dbo.stock_history_baselines WHERE id=@baseline_id)
BEGIN
 IF EXISTS(SELECT CONVERT(varbinary(max),store_id),cutoff_at_raw,cutoff_ticks,captured_at_raw,captured_ticks,source_cursor,
  opening_kind,verification_state,expected_pairs,CONVERT(varbinary(max),terminal_watermarks),CONVERT(varbinary(max),verified_by),evidence_hash
  FROM dbo.stock_history_baselines WHERE id=@baseline_id
  EXCEPT SELECT CONVERT(varbinary(max),@branch),@cutoff_at,CONVERT(decimal(20,0),@cutoff_ticks),@captured_at,CONVERT(decimal(20,0),@captured_ticks),
   @first_cursor,@opening_kind,N'verified',@expected_pairs,CONVERT(varbinary(max),@baseline_watermarks),CONVERT(varbinary(max),@verified_by),@evidence_hash)
  THROW 51031,'STOCK_HISTORY_DOWNLOAD_BASELINE_CONFLICT',1;
END
ELSE INSERT dbo.stock_history_baselines(id,store_id,cutoff_at_raw,cutoff_ticks,captured_at_raw,captured_ticks,source_cursor,opening_kind,
 verification_state,expected_pairs,terminal_watermarks,verified_by,evidence_hash)
 VALUES(@baseline_id,@branch,@cutoff_at,@cutoff_ticks,@captured_at,@captured_ticks,@first_cursor,@opening_kind,N'verified',
  @expected_pairs,@baseline_watermarks,@verified_by,@evidence_hash);

IF EXISTS(SELECT 1 FROM #StockDownloadOpenings incoming JOIN dbo.stock_history_openings saved ON saved.id=incoming.id
 WHERE EXISTS(SELECT saved.baseline_id,CONVERT(varbinary(max),saved.store_id),saved.product_id,saved.quantity,
  CONVERT(varbinary(max),saved.product_name),CONVERT(varbinary(max),saved.sku),CONVERT(varbinary(max),saved.barcode),CONVERT(varbinary(max),saved.owner_store_id)
  EXCEPT SELECT @baseline_id,CONVERT(varbinary(max),@branch),incoming.product_id,incoming.quantity,
  CONVERT(varbinary(max),incoming.product_name),CONVERT(varbinary(max),incoming.sku),CONVERT(varbinary(max),incoming.barcode),CONVERT(varbinary(max),incoming.owner_store_id)))
 OR EXISTS(SELECT 1 FROM dbo.stock_history_openings saved WHERE saved.baseline_id=@baseline_id
  AND NOT EXISTS(SELECT 1 FROM #StockDownloadOpenings incoming WHERE incoming.id=saved.id))
 THROW 51031,'STOCK_HISTORY_DOWNLOAD_OPENING_CONFLICT',1;
INSERT dbo.stock_history_openings(id,baseline_id,product_id,store_id,quantity,product_name,sku,barcode,owner_store_id)
 SELECT id,@baseline_id,product_id,@branch,quantity,product_name,sku,barcode,owner_store_id FROM #StockDownloadOpenings incoming
 WHERE NOT EXISTS(SELECT 1 FROM dbo.stock_history_openings saved WHERE saved.id=incoming.id);

IF EXISTS(SELECT 1 FROM #StockDownloadMovements incoming JOIN dbo.stock_history_movements saved ON saved.id=incoming.id WHERE saved.ingested_cursor IS NULL)
 THROW 51031,'STOCK_HISTORY_DOWNLOAD_LOCAL_PENDING',1;
IF EXISTS(SELECT 1 FROM #StockDownloadMovements incoming JOIN dbo.stock_history_movements saved ON saved.id=incoming.id
 WHERE EXISTS(SELECT CONVERT(varbinary(max),saved.store_id),saved.operation_id,saved.product_id,
   CONVERT(varbinary(max),saved.terminal_id),CONVERT(varbinary(max),saved.actor_id),saved.source_kind,saved.quantity_delta,
   saved.effective_at_raw,saved.effective_ticks,saved.recorded_at_raw,saved.recorded_ticks,
   CONVERT(varbinary(max),saved.product_name),CONVERT(varbinary(max),saved.sku),CONVERT(varbinary(max),saved.barcode),
   saved.clock_state,CONVERT(varbinary(64),saved.payload_hash),CONVERT(varbinary(max),saved.payload_json),saved.ingested_cursor,saved.ingested_at
  EXCEPT SELECT CONVERT(varbinary(max),@branch),incoming.operation_id,incoming.product_id,
   CONVERT(varbinary(max),incoming.terminal_id),CONVERT(varbinary(max),incoming.actor_id),incoming.source_kind,incoming.quantity_delta,
   incoming.effective_at_raw,incoming.effective_ticks,incoming.recorded_at_raw,incoming.recorded_ticks,
   CONVERT(varbinary(max),incoming.product_name),CONVERT(varbinary(max),incoming.sku),CONVERT(varbinary(max),incoming.barcode),
   incoming.clock_state,CONVERT(varbinary(64),incoming.payload_hash),CONVERT(varbinary(max),incoming.payload_json),incoming.ingested_cursor,incoming.ingested_at))
 OR EXISTS(SELECT 1 FROM dbo.stock_history_movements saved WHERE saved.store_id=@branch AND saved.ingested_cursor>@first_cursor
  AND NOT EXISTS(SELECT 1 FROM #StockDownloadMovements incoming WHERE incoming.id=saved.id AND incoming.ingested_cursor=saved.ingested_cursor))
 THROW 51031,'STOCK_HISTORY_DOWNLOAD_MOVEMENT_CONFLICT',1;

DECLARE @inserted bigint=0;
INSERT dbo.stock_history_movements(id,operation_id,product_id,store_id,terminal_id,actor_id,source_kind,quantity_delta,
 effective_at_raw,effective_ticks,recorded_at_raw,recorded_ticks,product_name,sku,barcode,clock_state,payload_hash,payload_json,
 ingested_cursor,ingested_at,local_cursor)
 SELECT id,operation_id,product_id,@branch,terminal_id,actor_id,source_kind,quantity_delta,
  effective_at_raw,effective_ticks,recorded_at_raw,recorded_ticks,product_name,sku,barcode,clock_state,payload_hash,payload_json,
  ingested_cursor,ingested_at,COALESCE(@local_cursor,0)+ROW_NUMBER()OVER(ORDER BY ingested_cursor)
 FROM #StockDownloadMovements incoming WHERE NOT EXISTS(SELECT 1 FROM dbo.stock_history_movements saved WHERE saved.id=incoming.id);
SET @inserted=@@ROWCOUNT;
IF @existing_branch IS NULL INSERT dbo.stock_history_heads(store_id) VALUES(@branch);
UPDATE dbo.stock_history_heads SET baseline_id=@baseline_id,committed_cursor=@head_cursor,coverage_state=@coverage_state,
 coverage_from_ticks=@coverage_from,coverage_through_ticks=@coverage_through,local_committed_cursor=local_committed_cursor+@inserted,
 coverage_generation=coverage_generation+1,terminal_watermarks=JSON_MODIFY(terminal_watermarks,'$.stockHistoryDownload',JSON_QUERY(@provenance)),
 updated_at=SYSDATETIMEOFFSET() WHERE store_id=@branch;
DROP TABLE #StockDownloadOpenings,#StockDownloadMovements;
SELECT N'installed' status;
