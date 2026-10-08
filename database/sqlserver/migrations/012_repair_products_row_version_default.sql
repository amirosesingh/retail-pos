SET NOCOUNT ON;
SET XACT_ABORT ON;

-- Older local installers created products.row_version with DEFAULT (0), while
-- the synchronized cloud contract starts every row at version 1. Replace only
-- the default constraint: existing product values and business data are not
-- rewritten.
IF OBJECT_ID(N'dbo.products', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.products', N'row_version') IS NOT NULL
BEGIN
  DECLARE @products_row_version_default sysname;
  DECLARE @products_row_version_definition nvarchar(max);

  SELECT
    @products_row_version_default = dc.name,
    @products_row_version_definition = dc.definition
  FROM sys.default_constraints dc
  JOIN sys.columns c
    ON c.object_id = dc.parent_object_id
   AND c.column_id = dc.parent_column_id
  WHERE dc.parent_object_id = OBJECT_ID(N'dbo.products')
    AND c.name = N'row_version';

  IF @products_row_version_default IS NOT NULL
     AND LOWER(
       REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
         @products_row_version_definition,
         N'(', N''), N')', N''), N' ', N''), NCHAR(9), N''), NCHAR(10), N''), NCHAR(13), N'')
     ) <> N'1'
  BEGIN
    DECLARE @drop_products_row_version_default nvarchar(max) =
      N'ALTER TABLE dbo.products DROP CONSTRAINT ' + QUOTENAME(@products_row_version_default) + N';';
    EXEC sys.sp_executesql @drop_products_row_version_default;
  END;

  IF NOT EXISTS (
    SELECT 1
    FROM sys.default_constraints dc
    JOIN sys.columns c
      ON c.object_id = dc.parent_object_id
     AND c.column_id = dc.parent_column_id
    WHERE dc.parent_object_id = OBJECT_ID(N'dbo.products')
      AND c.name = N'row_version'
  )
    ALTER TABLE dbo.products
      ADD CONSTRAINT DF_products_row_version DEFAULT (1) FOR row_version;
END;

IF NOT EXISTS (SELECT 1 FROM dbo.pos_schema_migrations WHERE version = 12)
  INSERT INTO dbo.pos_schema_migrations(version, name, applied_at)
  VALUES (12, N'012_repair_products_row_version_default', SYSDATETIMEOFFSET());
