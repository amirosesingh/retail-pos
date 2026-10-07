-- One-time repair for an existing POS_Local database in SQL Server Management Studio.
-- Connect to the SQL Server instance hosting POS_Local, select POS_Local, close
-- the Electron POS first, and take a database backup before executing.
-- This script is idempotent. It preserves every non-NULL company name and
-- every valid JSON value; invalid scoped JSON is retained as a JSON string.
SET XACT_ABORT ON;
SET NOCOUNT ON;

IF DB_NAME() <> N'POS_Local'
  THROW 51020, 'Select the POS_Local database before running this repair.', 1;
IF OBJECT_ID(N'dbo.pos_schema_migrations', N'U') IS NULL
  THROW 51021, 'This is not a managed Retail POS local database.', 1;
IF OBJECT_ID(N'dbo.pos_settings', N'U') IS NULL
   OR COL_LENGTH(N'dbo.pos_settings', N'company_name') IS NULL
  THROW 51022, 'POS settings schema is incomplete; use the current full installer instead.', 1;
IF OBJECT_ID(N'dbo.settings_scoped', N'U') IS NULL
   OR COL_LENGTH(N'dbo.settings_scoped', N'value') IS NULL
  THROW 51023, 'Scoped settings schema is incomplete; use the current full installer instead.', 1;

BEGIN TRY
  BEGIN TRANSACTION;

  DECLARE @company_name_default sysname;
  DECLARE @drop_company_name_default_sql nvarchar(max);
  SELECT @company_name_default = dc.name
  FROM sys.default_constraints AS dc
  JOIN sys.columns AS c
    ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id
  WHERE dc.parent_object_id = OBJECT_ID(N'dbo.pos_settings')
    AND c.name = N'company_name';

  IF @company_name_default IS NOT NULL
  BEGIN
    SET @drop_company_name_default_sql =
      N'ALTER TABLE dbo.pos_settings DROP CONSTRAINT ' + QUOTENAME(@company_name_default);
    EXEC sys.sp_executesql @drop_company_name_default_sql;
  END;

  IF EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'dbo.pos_settings')
      AND name = N'company_name' AND is_nullable = 0
  ) ALTER TABLE dbo.pos_settings ALTER COLUMN company_name nvarchar(max) NULL;

  UPDATE dbo.settings_scoped
  SET [value] = N'"' + STRING_ESCAPE([value], 'json') + N'"'
  WHERE [value] IS NOT NULL
    AND (LTRIM(RTRIM([value])) = N'' OR ISJSON(N'[' + [value] + N']') <> 1);

  IF NOT EXISTS (SELECT 1 FROM dbo.pos_schema_migrations WHERE version = 6)
    INSERT INTO dbo.pos_schema_migrations(version, name, applied_at)
    VALUES (6, N'006_allow_missing_company_name', SYSDATETIMEOFFSET());
  IF NOT EXISTS (SELECT 1 FROM dbo.pos_schema_migrations WHERE version = 7)
    INSERT INTO dbo.pos_schema_migrations(version, name, applied_at)
    VALUES (7, N'007_repair_scoped_json_values', SYSDATETIMEOFFSET());
  IF NOT EXISTS (SELECT 1 FROM dbo.pos_schema_migrations WHERE version = 8)
    INSERT INTO dbo.pos_schema_migrations(version, name, applied_at)
    VALUES (8, N'008_repair_scoped_values_and_company_name', SYSDATETIMEOFFSET());

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;

SELECT DB_NAME() AS database_name,
       (SELECT is_nullable FROM sys.columns WHERE object_id = OBJECT_ID(N'dbo.pos_settings') AND name = N'company_name') AS company_name_nullable,
       (SELECT COUNT_BIG(*) FROM dbo.settings_scoped
        WHERE [value] IS NOT NULL
          AND (LTRIM(RTRIM([value])) = N'' OR ISJSON(N'[' + [value] + N']') <> 1)) AS invalid_scoped_json_rows;
SELECT version, name, applied_at
FROM dbo.pos_schema_migrations
WHERE version IN (6, 7, 8)
ORDER BY version;
