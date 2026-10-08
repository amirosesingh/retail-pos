SET XACT_ABORT ON;
IF NOT EXISTS (SELECT 1 FROM dbo.pos_schema_migrations WHERE version=13)
BEGIN
  BEGIN TRANSACTION;
  IF EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.purchase_orders') AND name=N'UX_purchase_orders_po_number')
    DROP INDEX [UX_purchase_orders_po_number] ON dbo.purchase_orders;
  IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.purchase_orders') AND name=N'UQ_purchase_orders_0')
    CREATE UNIQUE INDEX [UQ_purchase_orders_0] ON dbo.purchase_orders([store_id],[po_number]) WHERE [store_id] IS NOT NULL;
  INSERT INTO dbo.pos_schema_migrations(version,name) VALUES(13,N'013_scope_purchase_invoice_numbers.sql');
  COMMIT TRANSACTION;
END;
