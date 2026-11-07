-- Prepared for a separately approved, backed-up SQL Server database.
-- The caller supplies @expectedDatabaseGuid uniqueidentifier and @expectedDatabaseName sysname.
SET NOCOUNT ON;
IF @@TRANCOUNT<>0 OR (@@OPTIONS&2)<>0
BEGIN
  RAISERROR('Held-sale review requires a dedicated connection without an open or implicit transaction.',16,1);
  RETURN;
END;
IF DB_ID()<5 OR @expectedDatabaseGuid IS NULL OR
   @expectedDatabaseName IS NULL OR DB_NAME() COLLATE Latin1_General_100_BIN2<>@expectedDatabaseName OR
   NOT EXISTS(SELECT 1 FROM sys.database_recovery_status WHERE database_id=DB_ID() AND database_guid=@expectedDatabaseGuid)
  THROW 51029,'An exact managed Retail database is required.',1;
BEGIN TRY
  BEGIN TRANSACTION;
  DECLARE @lock int;
  EXEC @lock=sys.sp_getapplock @Resource=N'RetailExistingMetadataUpgrade',@LockMode=N'Exclusive',@LockOwner=N'Transaction',@LockTimeout=1000;
  IF @lock<0 THROW 51029,'Another database update is running.',1;
  IF OBJECT_ID(N'dbo.pos_schema_migrations',N'U') IS NULL OR
     OBJECT_ID(N'dbo.held_orders',N'U') IS NULL OR OBJECT_ID(N'dbo.sales',N'U') IS NULL OR
     OBJECT_ID(N'dbo.sale_items',N'U') IS NULL OR OBJECT_ID(N'dbo.payment_transactions',N'U') IS NULL OR
     NOT EXISTS(SELECT 1 FROM sys.database_recovery_status WHERE database_id=DB_ID() AND database_guid=@expectedDatabaseGuid)
    THROW 51029,'An exact managed Retail database is required.',1;
  IF NOT EXISTS(SELECT 1 FROM dbo.pos_schema_migrations WHERE version=24) OR
     EXISTS(SELECT 1 FROM dbo.pos_schema_migrations WHERE version>24) OR
     OBJECT_ID(N'dbo.pos_held_sale_review_decisions') IS NOT NULL OR
     OBJECT_ID(N'dbo.TR_pos_held_sale_review_decisions_immutable') IS NOT NULL
    THROW 51029,'The installed Retail schema or review metadata needs verification.',1;

  CREATE TABLE dbo.pos_held_sale_review_decisions (
    decision_id uniqueidentifier NOT NULL CONSTRAINT PK_pos_held_sale_review_decisions PRIMARY KEY,
    database_guid uniqueidentifier NOT NULL,
    branch_id nvarchar(128) NOT NULL,
    terminal_id uniqueidentifier NOT NULL,
    shift_id uniqueidentifier NOT NULL,
    ticket_id nvarchar(450) NOT NULL,
    sale_id uniqueidentifier NOT NULL,
    actor_id uniqueidentifier NOT NULL,
    source_hash char(64) NOT NULL,
    proof_kind varchar(16) NOT NULL,
    reason nvarchar(400) NOT NULL,
    local_before_json nvarchar(max) NOT NULL,
    cloud_graph_json nvarchar(max) NOT NULL,
    decided_at datetimeoffset(7) NOT NULL,
    CONSTRAINT CK_pos_held_sale_review_proof CHECK (proof_kind IN ('cleaned_hold','completed_hold')),
    CONSTRAINT CK_pos_held_sale_review_documents CHECK (
      ISJSON(local_before_json)=1 AND DATALENGTH(local_before_json) BETWEEN 2 AND 262144 AND
      ISJSON(cloud_graph_json)=1 AND DATALENGTH(cloud_graph_json) BETWEEN 2 AND 1048576 AND
      DATALENGTH(reason) BETWEEN 2 AND 800)
  );
  EXEC sys.sp_executesql N'CREATE TRIGGER dbo.TR_pos_held_sale_review_decisions_immutable
ON dbo.pos_held_sale_review_decisions INSTEAD OF UPDATE, DELETE
AS
BEGIN
 SET NOCOUNT ON;
 THROW 51029,''Held-sale review decisions are append-only.'',1;
END;';
  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
