-- Existing terminals retained the old single-key nvarchar(450) widths when
-- migration 013 introduced the branch-scoped composite invoice key.
SET XACT_ABORT ON;
IF NOT EXISTS (SELECT 1 FROM dbo.pos_schema_migrations WHERE version=14)
BEGIN
  BEGIN TRY
    BEGIN TRANSACTION;
    -- Hold the table lock through index recreation so concurrent writes cannot
    -- introduce an oversized value between this check and ALTER COLUMN.
    -- DATALENGTH includes trailing spaces and UTF-16 surrogate pairs.
    IF EXISTS (SELECT 1 FROM dbo.purchase_orders WITH (TABLOCKX, HOLDLOCK)
               WHERE DATALENGTH(po_number)>256 OR DATALENGTH(store_id)>256)
      THROW 51014, 'Purchase order identifiers exceed 128 UTF-16 code units. No identifiers were truncated. Review po_number and store_id before retrying the update.', 1;

    IF EXISTS (SELECT 1 FROM sys.columns
               WHERE object_id=OBJECT_ID(N'dbo.purchase_orders')
                 AND name IN (N'po_number',N'store_id') AND max_length<>256)
    BEGIN
      IF EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.purchase_orders') AND name=N'UQ_purchase_orders_0')
        DROP INDEX [UQ_purchase_orders_0] ON dbo.purchase_orders;
      IF EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.purchase_orders') AND name=N'IX_purchase_orders_store_id')
        DROP INDEX [IX_purchase_orders_store_id] ON dbo.purchase_orders;
      -- Do not restore the obsolete global invoice uniqueness rule from 012.
      IF EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.purchase_orders') AND name=N'UX_purchase_orders_po_number')
        DROP INDEX [UX_purchase_orders_po_number] ON dbo.purchase_orders;

      ALTER TABLE dbo.purchase_orders ALTER COLUMN po_number nvarchar(128) NOT NULL;
      ALTER TABLE dbo.purchase_orders ALTER COLUMN store_id nvarchar(128) NULL;

      CREATE UNIQUE INDEX [UQ_purchase_orders_0] ON dbo.purchase_orders([store_id],[po_number]) WHERE [store_id] IS NOT NULL;
      CREATE INDEX [IX_purchase_orders_store_id] ON dbo.purchase_orders([store_id]);
    END;
    INSERT INTO dbo.pos_schema_migrations(version,name) VALUES(14,N'014_repair_purchase_order_key_widths.sql');
    COMMIT TRANSACTION;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;
    THROW;
  END CATCH;
END;
