-- Isolated additive preparation. Install after the immutable sale outbox.
IF @@TRANCOUNT <> 0 THROW 51041, 'Sale acceptance preparation requires no caller transaction.', 1;
SET XACT_ABORT ON;
BEGIN TRY
  BEGIN TRANSACTION;
  IF OBJECT_ID(N'dbo.pos_sync_sale_outbox_v1', N'U') IS NULL
     OR OBJECT_ID(N'dbo.pos_sync_sale_acceptance_v1') IS NOT NULL
    THROW 51041, 'Sale acceptance storage requires review.', 1;

  CREATE TABLE dbo.pos_sync_sale_acceptance_v1 (
    operation_id uniqueidentifier NOT NULL CONSTRAINT PK_pos_sync_sale_acceptance_v1 PRIMARY KEY,
    receipt_json nvarchar(max) NOT NULL,
    confirmed_at datetimeoffset(7) NOT NULL CONSTRAINT DF_pos_sync_sale_acceptance_v1_time DEFAULT SYSDATETIMEOFFSET(),
    CONSTRAINT FK_pos_sync_sale_acceptance_v1_outbox FOREIGN KEY (operation_id)
      REFERENCES dbo.pos_sync_sale_outbox_v1(operation_id),
    CONSTRAINT CK_pos_sync_sale_acceptance_v1_json CHECK (ISJSON(receipt_json) = 1 AND DATALENGTH(receipt_json) <= 8192)
  );

  EXEC(N'CREATE TRIGGER dbo.pos_sync_sale_acceptance_v1_immutable ON dbo.pos_sync_sale_acceptance_v1
    AFTER UPDATE, DELETE AS BEGIN
      SET NOCOUNT ON;
      IF EXISTS (SELECT 1 FROM deleted) THROW 51041, ''Saved sale acceptance is immutable.'', 1;
    END;');
  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
