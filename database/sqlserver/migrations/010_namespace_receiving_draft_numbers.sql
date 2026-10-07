SET NOCOUNT ON;
SET XACT_ABORT ON;

IF OBJECT_ID(N'dbo.purchase_orders', N'U') IS NOT NULL
BEGIN
  UPDATE dbo.purchase_orders
  SET po_number = CONCAT(
    N'__draft__:',
    CONVERT(nvarchar(36), id),
    N':',
    LEFT(COALESCE(po_number, N''), 400)
  )
  WHERE status = N'draft'
    AND po_number NOT LIKE N'__draft__:%';
END;

IF NOT EXISTS (SELECT 1 FROM dbo.pos_schema_migrations WHERE version = 10)
  INSERT INTO dbo.pos_schema_migrations(version, name, applied_at)
  VALUES (10, N'010_namespace_receiving_draft_numbers', SYSDATETIMEOFFSET());
