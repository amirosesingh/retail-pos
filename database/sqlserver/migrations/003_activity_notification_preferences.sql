/*
  Durable per-user notification clear/reopen state for existing POS_Local
  databases. Re-runnable, additive, and safe for databases created before the
  cleared_by column was introduced.
*/

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET NUMERIC_ROUNDABORT OFF;
SET XACT_ABORT ON;
GO

IF OBJECT_ID(N'dbo.activity_events', N'U') IS NULL
  THROW 51000, 'Migration 001 must be applied before notification preferences.', 1;
GO

IF COL_LENGTH(N'dbo.activity_events', N'cleared_by') IS NULL
  ALTER TABLE dbo.activity_events ADD cleared_by nvarchar(max) NULL;
GO

UPDATE dbo.activity_events
SET cleared_by = N'[]'
WHERE cleared_by IS NULL
   OR ISJSON(cleared_by) <> 1
   OR LEFT(LTRIM(cleared_by), 1) <> N'[';
GO

IF NOT EXISTS (
  SELECT 1
  FROM sys.default_constraints AS dc
  JOIN sys.columns AS c
    ON c.object_id = dc.parent_object_id
   AND c.column_id = dc.parent_column_id
  WHERE dc.parent_object_id = OBJECT_ID(N'dbo.activity_events')
    AND c.name = N'cleared_by'
)
  ALTER TABLE dbo.activity_events
    ADD CONSTRAINT DF_activity_events_cleared_by DEFAULT (N'[]') FOR cleared_by;
GO

IF EXISTS (
  SELECT 1
  FROM sys.columns
  WHERE object_id = OBJECT_ID(N'dbo.activity_events')
    AND name = N'cleared_by'
    AND is_nullable = 1
)
  ALTER TABLE dbo.activity_events ALTER COLUMN cleared_by nvarchar(max) NOT NULL;
GO

IF NOT EXISTS (
  SELECT 1
  FROM sys.check_constraints
  WHERE parent_object_id = OBJECT_ID(N'dbo.activity_events')
    AND name = N'CK_activity_events_cleared_by_json_array'
)
  ALTER TABLE dbo.activity_events WITH CHECK
    ADD CONSTRAINT CK_activity_events_cleared_by_json_array
    CHECK (ISJSON(cleared_by) = 1 AND LEFT(LTRIM(cleared_by), 1) = N'[');
GO

IF NOT EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE object_id = OBJECT_ID(N'dbo.activity_events')
    AND name = N'IX_activity_events_store_created'
)
  CREATE INDEX IX_activity_events_store_created
    ON dbo.activity_events(store_id, created_at DESC, id);
GO

IF OBJECT_ID(N'dbo.pos_schema_migrations', N'U') IS NULL
  CREATE TABLE dbo.pos_schema_migrations (
    version int NOT NULL PRIMARY KEY,
    name nvarchar(200) NOT NULL,
    applied_at datetimeoffset(7) NOT NULL DEFAULT SYSDATETIMEOFFSET()
  );
GO

IF NOT EXISTS (SELECT 1 FROM dbo.pos_schema_migrations WHERE version = 3)
  INSERT dbo.pos_schema_migrations(version, name)
  VALUES (3, N'activity_notification_preferences');
GO
