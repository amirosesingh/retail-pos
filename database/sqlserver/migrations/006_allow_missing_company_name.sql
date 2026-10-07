-- Cloud company_name may be NULL until an administrator enters the business name.
-- Run in the configured POS_Local database, never in Supabase/PostgreSQL.
IF OBJECT_ID(N'dbo.pos_settings', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.pos_settings', N'company_name') IS NOT NULL
BEGIN
  DECLARE @company_name_default sysname;
  SELECT @company_name_default = dc.name
  FROM sys.default_constraints AS dc
  JOIN sys.columns AS c
    ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id
  WHERE dc.parent_object_id = OBJECT_ID(N'dbo.pos_settings')
    AND c.name = N'company_name';
  IF @company_name_default IS NOT NULL
    EXEC(N'ALTER TABLE dbo.pos_settings DROP CONSTRAINT ' + QUOTENAME(@company_name_default));

  IF EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'dbo.pos_settings')
      AND name = N'company_name' AND is_nullable = 0
  ) ALTER TABLE dbo.pos_settings ALTER COLUMN company_name nvarchar(max) NULL;
END;

-- Older local writes stored JSON scalar strings as bare nvarchar. Keep the
-- original text but encode it as a JSON string so change tracking can push it.
IF OBJECT_ID(N'dbo.settings_scoped', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.settings_scoped', N'value') IS NOT NULL
  UPDATE dbo.settings_scoped
  SET [value] = N'"' + STRING_ESCAPE([value], 'json') + N'"'
  WHERE [value] IS NOT NULL AND ISJSON(N'[' + [value] + N']') <> 1;

IF NOT EXISTS (SELECT 1 FROM dbo.pos_schema_migrations WHERE version = 6)
  INSERT INTO dbo.pos_schema_migrations(version, name, applied_at)
  VALUES (6, N'006_allow_missing_company_name', SYSDATETIMEOFFSET());
