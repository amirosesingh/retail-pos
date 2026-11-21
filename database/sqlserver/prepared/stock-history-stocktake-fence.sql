-- Dedicated Retail POS Beta fixture prerequisite only. The caller supplies
-- the exact physical SQL database after review. No pause is armed by installation.
SET XACT_ABORT ON;
DECLARE @stocktakeOwnsTransaction bit=CASE WHEN @@TRANCOUNT=0 THEN 1 ELSE 0 END;
IF @stocktakeOwnsTransaction=1 BEGIN TRANSACTION;
BEGIN TRY
 IF OBJECT_ID(N'dbo.stock_history_heads',N'U') IS NULL OR OBJECT_ID(N'dbo.products',N'U') IS NULL
  THROW 51031,'STOCK_HISTORY_STOCKTAKE_SCHEMA_REQUIRED',1;
 IF OBJECT_ID(N'dbo.stock_history_stocktake_fences',N'U') IS NOT NULL
  OR OBJECT_ID(N'dbo.TR_stock_history_stocktake_products',N'TR') IS NOT NULL
  OR OBJECT_ID(N'dbo.pos_stock_history_arm_stocktake',N'P') IS NOT NULL
  OR OBJECT_ID(N'dbo.pos_stock_history_release_stocktake',N'P') IS NOT NULL
  THROW 51031,'STOCK_HISTORY_STOCKTAKE_EXISTING_SCHEMA_REVIEW_REQUIRED',1;

 CREATE TABLE dbo.stock_history_stocktake_fences(
  stocktake_id uniqueidentifier NOT NULL CONSTRAINT PK_stock_history_stocktake_fences PRIMARY KEY,
  project_origin nvarchar(255) COLLATE Latin1_General_100_BIN2 NOT NULL,
  branch_id nvarchar(128) COLLATE Latin1_General_100_BIN2 NOT NULL,
  terminal_id uniqueidentifier NOT NULL,database_id uniqueidentifier NOT NULL,
  generation uniqueidentifier NOT NULL CONSTRAINT UQ_stock_history_stocktake_generation UNIQUE,
  fenced_at datetime2(7) NOT NULL,expires_at datetime2(7) NOT NULL,released_at datetime2(7) NULL,
  CONSTRAINT CK_stock_history_stocktake_deadline CHECK(expires_at>fenced_at AND
    expires_at<=DATEADD(minute,10,fenced_at) AND (released_at IS NULL OR released_at>=fenced_at))
 );

 -- Share a transaction-owned latch with every affected product write. Armour is
 -- granted only after product work that entered before the pause has committed.
 EXEC(N'CREATE TRIGGER dbo.TR_stock_history_stocktake_products ON dbo.products AFTER INSERT,UPDATE,DELETE AS
 BEGIN
  SET NOCOUNT ON;
  IF NOT EXISTS(
    SELECT id,stock_quantity,CONVERT(varbinary(max),stock_by_store),CONVERT(varbinary(max),owner_store_id),
      CONVERT(varbinary(max),name),CONVERT(varbinary(max),sku),CONVERT(varbinary(max),barcode) FROM inserted
    EXCEPT SELECT id,stock_quantity,CONVERT(varbinary(max),stock_by_store),CONVERT(varbinary(max),owner_store_id),
      CONVERT(varbinary(max),name),CONVERT(varbinary(max),sku),CONVERT(varbinary(max),barcode) FROM deleted)
   AND NOT EXISTS(SELECT id FROM deleted EXCEPT SELECT id FROM inserted) RETURN;
  DECLARE @lock int,@now datetime2(7)=SYSUTCDATETIME();
  EXEC @lock=sys.sp_getapplock @Resource=N''retail:stock-history:stocktake'',@LockMode=N''Shared'',@LockOwner=N''Transaction'',@LockTimeout=2000;
  IF @lock<0 THROW 51031,''STOCK_HISTORY_STOCKTAKE_RETRY'',1;
  IF EXISTS(SELECT 1 FROM dbo.stock_history_stocktake_fences WHERE released_at IS NULL AND expires_at>@now)
   THROW 51031,''STOCK_HISTORY_STOCKTAKE_PAUSED'',1;
  -- A write that proceeds after expiry permanently ends the fence in its own
  -- transaction. A later clock rewind cannot resurrect its old generation.
  UPDATE dbo.stock_history_stocktake_fences SET released_at=CASE WHEN fenced_at>@now THEN fenced_at ELSE @now END
   WHERE released_at IS NULL AND expires_at<=@now;
 END');

 EXEC(N'CREATE PROCEDURE dbo.pos_stock_history_arm_stocktake
  @stocktake uniqueidentifier,@project nvarchar(255),@branch nvarchar(128),@terminal uniqueidentifier,
  @database uniqueidentifier,@expires datetime2(7)
 AS
 BEGIN
  SET NOCOUNT ON;
  IF @@TRANCOUNT=0 THROW 51031,''STOCK_HISTORY_STOCKTAKE_TRANSACTION_REQUIRED'',1;
  DECLARE @lock int,@now datetime2(7);
  EXEC @lock=sys.sp_getapplock @Resource=N''retail:stock-history:stocktake'',@LockMode=N''Exclusive'',@LockOwner=N''Transaction'',@LockTimeout=2000;
  IF @lock<0 THROW 51031,''STOCK_HISTORY_STOCKTAKE_RETRY'',1;
  SET @now=SYSUTCDATETIME();
  IF @stocktake IS NULL OR NULLIF(@project,N'''') IS NULL OR NULLIF(@branch,N'''') IS NULL OR @terminal IS NULL OR @expires IS NULL
   OR @expires<=@now OR @expires>DATEADD(minute,10,@now) OR NOT EXISTS(
     SELECT 1 FROM sys.database_recovery_status WHERE database_id=DB_ID() AND database_guid=@database)
   OR NOT EXISTS(SELECT 1 FROM sys.triggers WHERE object_id=OBJECT_ID(N''dbo.TR_stock_history_stocktake_products'')
     AND parent_id=OBJECT_ID(N''dbo.products'') AND is_disabled=0 AND is_not_for_replication=0)
  THROW 51031,''STOCK_HISTORY_STOCKTAKE_SCOPE_DENIED'',1;
  UPDATE dbo.stock_history_stocktake_fences SET released_at=CASE WHEN fenced_at>@now THEN fenced_at ELSE @now END
   WHERE released_at IS NULL AND expires_at<=@now;
  IF EXISTS(SELECT 1 FROM dbo.stock_history_stocktake_fences WHERE stocktake_id=@stocktake)
  BEGIN
   IF NOT EXISTS(SELECT 1 FROM dbo.stock_history_stocktake_fences WHERE stocktake_id=@stocktake AND released_at IS NULL
      AND project_origin=@project AND branch_id=@branch AND terminal_id=@terminal AND database_id=@database AND expires_at=@expires)
    THROW 51031,''STOCK_HISTORY_STOCKTAKE_SCOPE_DENIED'',1;
  END
  ELSE
  BEGIN
   IF EXISTS(SELECT 1 FROM dbo.stock_history_stocktake_fences WHERE released_at IS NULL)
    THROW 51031,''STOCK_HISTORY_STOCKTAKE_ALREADY_ACTIVE'',1;
   INSERT INTO dbo.stock_history_stocktake_fences VALUES(@stocktake,@project,@branch,@terminal,@database,NEWID(),@now,@expires,NULL);
  END;
 END');

 EXEC(N'CREATE PROCEDURE dbo.pos_stock_history_release_stocktake @stocktake uniqueidentifier,@generation uniqueidentifier,@database uniqueidentifier
 AS
 BEGIN
  SET NOCOUNT ON;
  IF @@TRANCOUNT=0 THROW 51031,''STOCK_HISTORY_STOCKTAKE_TRANSACTION_REQUIRED'',1;
  DECLARE @lock int,@now datetime2(7);
  EXEC @lock=sys.sp_getapplock @Resource=N''retail:stock-history:stocktake'',@LockMode=N''Exclusive'',@LockOwner=N''Transaction'',@LockTimeout=2000;
  IF @lock<0 THROW 51031,''STOCK_HISTORY_STOCKTAKE_RETRY'',1;
  SET @now=SYSUTCDATETIME();
  IF NOT EXISTS(SELECT 1 FROM sys.database_recovery_status WHERE database_id=DB_ID() AND database_guid=@database)
    OR NOT EXISTS(SELECT 1 FROM dbo.stock_history_stocktake_fences WHERE stocktake_id=@stocktake AND generation=@generation AND database_id=@database)
   THROW 51031,''STOCK_HISTORY_STOCKTAKE_SCOPE_DENIED'',1;
  UPDATE dbo.stock_history_stocktake_fences SET released_at=CASE WHEN fenced_at>@now THEN fenced_at ELSE @now END
   WHERE stocktake_id=@stocktake AND released_at IS NULL;
 END');

 IF @stocktakeOwnsTransaction=1 COMMIT TRANSACTION;
END TRY
BEGIN CATCH
 IF @stocktakeOwnsTransaction=1 AND XACT_STATE()<>0 ROLLBACK TRANSACTION;
 THROW;
END CATCH;
