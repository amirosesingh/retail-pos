/*
  Repair databases created by an older installer that assigned 'unknown' as
  the terminal platform default. Existing non-null platform values are data
  and are intentionally preserved; only the default for future rows changes.
*/

SET XACT_ABORT ON;
GO

IF OBJECT_ID(N'dbo.terminal_tokens', N'U') IS NULL
  THROW 51000, 'Migration 001 must be applied before repairing terminal defaults.', 1;
GO

IF COL_LENGTH(N'dbo.terminal_tokens', N'platform') IS NULL
  THROW 51000, 'The terminal_tokens.platform column is missing.', 1;
GO

IF NOT EXISTS (
  SELECT 1
  FROM sys.default_constraints AS dc
  JOIN sys.columns AS c
    ON c.object_id = dc.parent_object_id
   AND c.column_id = dc.parent_column_id
  WHERE dc.parent_object_id = OBJECT_ID(N'dbo.terminal_tokens')
    AND c.name = N'platform'
    AND LOWER(REPLACE(REPLACE(REPLACE(dc.definition, N'(', N''), N')', N''), N' ', N''))
      IN (N'''pc''', N'n''pc''')
)
BEGIN
  DECLARE @terminal_platform_default sysname;
  DECLARE @terminal_platform_drop_sql nvarchar(max);
  SELECT @terminal_platform_default = dc.name
  FROM sys.default_constraints AS dc
  JOIN sys.columns AS c
    ON c.object_id = dc.parent_object_id
   AND c.column_id = dc.parent_column_id
  WHERE dc.parent_object_id = OBJECT_ID(N'dbo.terminal_tokens')
    AND c.name = N'platform';

  IF @terminal_platform_default IS NOT NULL
  BEGIN
    SET @terminal_platform_drop_sql =
      N'ALTER TABLE dbo.terminal_tokens DROP CONSTRAINT '
      + QUOTENAME(@terminal_platform_default)
      + N';';
    EXEC sys.sp_executesql @terminal_platform_drop_sql;
  END;

  ALTER TABLE dbo.terminal_tokens
    ADD CONSTRAINT DF_terminal_tokens_platform DEFAULT (N'pc') FOR platform;
END;
GO

IF OBJECT_ID(N'dbo.pos_schema_migrations', N'U') IS NULL
  CREATE TABLE dbo.pos_schema_migrations (
    version int NOT NULL PRIMARY KEY,
    name nvarchar(200) NOT NULL,
    applied_at datetimeoffset(7) NOT NULL DEFAULT SYSDATETIMEOFFSET()
  );
GO

IF NOT EXISTS (SELECT 1 FROM dbo.pos_schema_migrations WHERE version = 4)
  INSERT dbo.pos_schema_migrations(version, name)
  VALUES (4, N'repair_terminal_platform_default');
GO
