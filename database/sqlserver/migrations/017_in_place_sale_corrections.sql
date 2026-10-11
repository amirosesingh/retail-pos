-- Add a receipt marker for verified cloud corrections. No existing business rows changed.
IF COL_LENGTH(N'dbo.sales',N'corrected_at') IS NULL
 ALTER TABLE dbo.sales ADD corrected_at datetimeoffset(7) NULL;
IF COL_LENGTH(N'dbo.sale_items',N'corrected_at') IS NULL
 ALTER TABLE dbo.sale_items ADD corrected_at datetimeoffset(7) NULL;
