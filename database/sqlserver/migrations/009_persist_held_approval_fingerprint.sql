IF OBJECT_ID(N'dbo.held_orders', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.held_orders', N'approval_snapshot_hash') IS NULL
  ALTER TABLE dbo.held_orders ADD approval_snapshot_hash nvarchar(max) NULL;

IF NOT EXISTS (SELECT 1 FROM dbo.pos_schema_migrations WHERE version = 9)
  INSERT INTO dbo.pos_schema_migrations(version, name, applied_at)
  VALUES (9, N'009_persist_held_approval_fingerprint', SYSDATETIMEOFFSET());
