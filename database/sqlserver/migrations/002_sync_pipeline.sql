SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET NUMERIC_ROUNDABORT OFF;
SET XACT_ABORT ON;

IF OBJECT_ID(N'dbo.sync_change_journal', N'U') IS NULL
  THROW 51000, 'Migration 001 must be applied before the sync pipeline upgrade.', 1;

IF COL_LENGTH(N'dbo.sync_change_journal',N'aggregate_id') IS NULL
  ALTER TABLE dbo.sync_change_journal ADD aggregate_id uniqueidentifier NULL;
IF COL_LENGTH(N'dbo.sync_change_journal',N'acknowledged_at') IS NULL
  ALTER TABLE dbo.sync_change_journal ADD acknowledged_at datetimeoffset(7) NULL;
IF COL_LENGTH(N'dbo.sync_change_journal',N'retry_count') IS NULL
  ALTER TABLE dbo.sync_change_journal ADD retry_count int NOT NULL
    CONSTRAINT DF_sync_change_journal_retry_count DEFAULT 0;
IF COL_LENGTH(N'dbo.sync_change_journal',N'last_error') IS NULL
  ALTER TABLE dbo.sync_change_journal ADD last_error nvarchar(1000) NULL;

IF NOT EXISTS(
  SELECT 1 FROM sys.indexes
  WHERE object_id=OBJECT_ID(N'dbo.sync_change_journal')
    AND name=N'IX_sync_change_journal_pending'
)
  EXEC(N'CREATE INDEX IX_sync_change_journal_pending
    ON dbo.sync_change_journal(branch_id,acknowledged_at,aggregate_id,change_id)');

IF NOT EXISTS(SELECT 1 FROM dbo.pos_schema_migrations WHERE version=2)
  INSERT dbo.pos_schema_migrations(version,name)
  VALUES(2,N'sync_pipeline_jobs_bootstrap_retention');
