-- Reassert nullable company_name for local databases that recorded an older
-- repair, and preserve bare-text scoped settings as valid JSON strings.
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
  BEGIN
    DECLARE @drop_company_name_default_sql nvarchar(max);
    SET @drop_company_name_default_sql =
      N'ALTER TABLE dbo.pos_settings DROP CONSTRAINT ' + QUOTENAME(@company_name_default);
    EXEC sys.sp_executesql @drop_company_name_default_sql;
  END;

  IF EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'dbo.pos_settings')
      AND name = N'company_name' AND is_nullable = 0
  ) ALTER TABLE dbo.pos_settings ALTER COLUMN company_name nvarchar(max) NULL;
END;

-- Wrapping value in [] alone was insufficient: an empty value becomes [].
-- Other malformed legacy strings are also handled at the Electron sync
-- boundary, without requiring a particular SQL Server compatibility level.
IF OBJECT_ID(N'dbo.settings_scoped', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.settings_scoped', N'value') IS NOT NULL
  UPDATE dbo.settings_scoped
  SET [value] = N'"' + STRING_ESCAPE([value], 'json') + N'"'
  WHERE [value] IS NOT NULL
    AND (LTRIM(RTRIM([value])) = N'' OR ISJSON(N'[' + [value] + N']') <> 1);

IF NOT EXISTS (SELECT 1 FROM dbo.pos_schema_migrations WHERE version = 8)
  INSERT INTO dbo.pos_schema_migrations(version, name, applied_at)
  VALUES (8, N'008_repair_scoped_values_and_company_name', SYSDATETIMEOFFSET());
