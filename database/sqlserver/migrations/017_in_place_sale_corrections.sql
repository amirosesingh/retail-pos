-- Add a receipt marker for verified cloud corrections. No existing business rows changed.
IF COL_LENGTH(N'dbo.sales',N'corrected_at') IS NULL
 ALTER TABLE dbo.sales ADD corrected_at datetimeoffset(7) NULL;
IF COL_LENGTH(N'dbo.sale_items',N'corrected_at') IS NULL
 ALTER TABLE dbo.sale_items ADD corrected_at datetimeoffset(7) NULL;
GO
-- Record completion only after both required columns have been ensured.
IF NOT EXISTS (SELECT 1 FROM dbo.pos_schema_migrations WHERE version=17)
 INSERT dbo.pos_schema_migrations(version,name) VALUES(17,N'in_place_sale_corrections');
GO
