-- Automatic catalogue state follows net company stock on both receipt and depletion.
SET XACT_ABORT ON;
IF NOT EXISTS (SELECT 1 FROM dbo.pos_schema_migrations WHERE version=15)
BEGIN
 BEGIN TRY
  BEGIN TRANSACTION;
  EXEC sys.sp_executesql N'CREATE OR ALTER TRIGGER dbo.products_zero_stock_catalog_lifecycle ON dbo.products
AFTER INSERT, UPDATE AS
BEGIN
 SET NOCOUNT ON;
 IF TRIGGER_NESTLEVEL(OBJECT_ID(N''dbo.products_zero_stock_catalog_lifecycle''))>1 RETURN;
 IF NOT (UPDATE(stock_by_store) OR UPDATE(is_archived)) RETURN;
 IF COALESCE((SELECT LOWER(COALESCE(JSON_VALUE(CASE WHEN ISJSON(integration_settings)=1 THEN integration_settings ELSE N''{}'' END,''$.autoArchiveZeroStock''),N''true'')) FROM dbo.pos_settings WHERE id=1),N''true'')<>N''true'' RETURN;
 UPDATE p
SET is_archived=CASE WHEN s.quantity>0 THEN 0 ELSE 1 END,
    archived_at=CASE WHEN s.quantity>0 THEN NULL ELSE COALESCE(p.archived_at,SYSDATETIMEOFFSET()) END,
    updated_at=SYSDATETIMEOFFSET(), row_version=COALESCE(p.row_version,0)+1
FROM dbo.products p
JOIN inserted i ON i.id=p.id
CROSS APPLY (SELECT COALESCE(SUM(TRY_CONVERT(decimal(38,12),j.[value])),0) AS quantity
 FROM OPENJSON(CASE WHEN ISJSON(p.stock_by_store)=1 AND LEFT(LTRIM(p.stock_by_store),1)=N''{'' THEN p.stock_by_store ELSE N''{}'' END) j) s
WHERE p.deleted_at IS NULL AND ISJSON(p.stock_by_store)=1 AND LEFT(LTRIM(p.stock_by_store),1)=N''{''
 AND (p.is_archived<>CASE WHEN s.quantity>0 THEN 0 ELSE 1 END
      OR (s.quantity>0 AND p.archived_at IS NOT NULL));
END;';
  EXEC sys.sp_executesql N'CREATE OR ALTER TRIGGER dbo.pos_settings_zero_stock_catalog_backfill ON dbo.pos_settings
AFTER INSERT, UPDATE AS
BEGIN
 SET NOCOUNT ON;
 IF NOT UPDATE(integration_settings) RETURN;
 IF COALESCE((SELECT LOWER(COALESCE(JSON_VALUE(CASE WHEN ISJSON(integration_settings)=1 THEN integration_settings ELSE N''{}'' END,''$.autoArchiveZeroStock''),N''true'')) FROM inserted WHERE id=1),N''false'')<>N''true'' RETURN;
 IF EXISTS (SELECT 1 FROM deleted WHERE id=1 AND LOWER(COALESCE(JSON_VALUE(CASE WHEN ISJSON(integration_settings)=1 THEN integration_settings ELSE N''{}'' END,''$.autoArchiveZeroStock''),N''true''))=N''true'') RETURN;
 UPDATE p
SET is_archived=CASE WHEN s.quantity>0 THEN 0 ELSE 1 END,
    archived_at=CASE WHEN s.quantity>0 THEN NULL ELSE COALESCE(p.archived_at,SYSDATETIMEOFFSET()) END,
    updated_at=SYSDATETIMEOFFSET(), row_version=COALESCE(p.row_version,0)+1
FROM dbo.products p

CROSS APPLY (SELECT COALESCE(SUM(TRY_CONVERT(decimal(38,12),j.[value])),0) AS quantity
 FROM OPENJSON(CASE WHEN ISJSON(p.stock_by_store)=1 AND LEFT(LTRIM(p.stock_by_store),1)=N''{'' THEN p.stock_by_store ELSE N''{}'' END) j) s
WHERE p.deleted_at IS NULL AND ISJSON(p.stock_by_store)=1 AND LEFT(LTRIM(p.stock_by_store),1)=N''{''
 AND (p.is_archived<>CASE WHEN s.quantity>0 THEN 0 ELSE 1 END
      OR (s.quantity>0 AND p.archived_at IS NOT NULL));
END;';
  IF COALESCE((SELECT LOWER(COALESCE(JSON_VALUE(CASE WHEN ISJSON(integration_settings)=1 THEN integration_settings ELSE N'{}' END,'$.autoArchiveZeroStock'),N'true')) FROM dbo.pos_settings WHERE id=1),N'true')=N'true'
  BEGIN
   UPDATE p
SET is_archived=CASE WHEN s.quantity>0 THEN 0 ELSE 1 END,
    archived_at=CASE WHEN s.quantity>0 THEN NULL ELSE COALESCE(p.archived_at,SYSDATETIMEOFFSET()) END,
    updated_at=SYSDATETIMEOFFSET(), row_version=COALESCE(p.row_version,0)+1
FROM dbo.products p

CROSS APPLY (SELECT COALESCE(SUM(TRY_CONVERT(decimal(38,12),j.[value])),0) AS quantity
 FROM OPENJSON(CASE WHEN ISJSON(p.stock_by_store)=1 AND LEFT(LTRIM(p.stock_by_store),1)=N'{' THEN p.stock_by_store ELSE N'{}' END) j) s
WHERE p.deleted_at IS NULL AND ISJSON(p.stock_by_store)=1 AND LEFT(LTRIM(p.stock_by_store),1)=N'{'
 AND (p.is_archived<>CASE WHEN s.quantity>0 THEN 0 ELSE 1 END
      OR (s.quantity>0 AND p.archived_at IS NOT NULL));
  END;
  INSERT INTO dbo.pos_schema_migrations(version,name) VALUES(15,N'015_restore_stocked_products_automatically.sql');
  COMMIT TRANSACTION;
 END TRY
 BEGIN CATCH
  IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;
  THROW;
 END CATCH;
END;
