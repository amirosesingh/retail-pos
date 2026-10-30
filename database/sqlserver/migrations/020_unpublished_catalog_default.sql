-- New operational products are unpublished until management chooses to publish.
IF OBJECT_ID(N'dbo.products',N'U') IS NOT NULL AND COL_LENGTH(N'dbo.products',N'ecom_visible') IS NOT NULL
BEGIN
 DECLARE @commerceDefault sysname;
 SELECT @commerceDefault=d.name FROM sys.default_constraints d JOIN sys.columns c ON c.object_id=d.parent_object_id AND c.column_id=d.parent_column_id WHERE d.parent_object_id=OBJECT_ID(N'dbo.products') AND c.name=N'ecom_visible';
 IF @commerceDefault IS NOT NULL
 BEGIN
  DECLARE @commerceDropSql nvarchar(max);
  SET @commerceDropSql=N'ALTER TABLE dbo.products DROP CONSTRAINT '+QUOTENAME(@commerceDefault);
  EXEC(@commerceDropSql);
 END;
 ALTER TABLE dbo.products ADD CONSTRAINT DF_products_ecom_visible DEFAULT (0) FOR ecom_visible;
END;
IF NOT EXISTS (SELECT 1 FROM dbo.pos_schema_migrations WHERE version=20)
 INSERT dbo.pos_schema_migrations(version,name) VALUES(20,N'unpublished_catalog_default');
