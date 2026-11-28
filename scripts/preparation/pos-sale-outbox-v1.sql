-- Isolated preparation for opted-in plain cash checkout evidence.
-- This file is outside the installer and the deployment migration chain.
IF @@TRANCOUNT <> 0 THROW 51041, 'Sale event preparation requires no caller transaction.', 1;
SET XACT_ABORT ON;
BEGIN TRY
  BEGIN TRANSACTION;
  IF OBJECT_ID(N'dbo.pos_sync_sale_outbox_v1') IS NOT NULL
    THROW 51041, 'Existing sale event storage requires review.', 1;

  CREATE TABLE dbo.pos_sync_sale_outbox_v1 (
    operation_id uniqueidentifier NOT NULL CONSTRAINT PK_pos_sync_sale_outbox_v1 PRIMARY KEY,
    branch_id nvarchar(128) NOT NULL,
    terminal_id nvarchar(128) NOT NULL,
    shift_id uniqueidentifier NOT NULL,
    sale_id uniqueidentifier NOT NULL CONSTRAINT UQ_pos_sync_sale_outbox_v1_sale UNIQUE,
    payload_json nvarchar(max) NOT NULL,
    payload_hash char(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
    captured_at datetimeoffset(7) NOT NULL CONSTRAINT DF_pos_sync_sale_outbox_v1_capture DEFAULT SYSDATETIMEOFFSET(),
    CONSTRAINT CK_pos_sync_sale_outbox_v1_scope CHECK (LEN(branch_id) > 0 AND LEN(terminal_id) > 0),
    CONSTRAINT CK_pos_sync_sale_outbox_v1_json CHECK (ISJSON(payload_json) = 1 AND DATALENGTH(payload_json) <= 1048576),
    CONSTRAINT CK_pos_sync_sale_outbox_v1_hash CHECK (payload_hash NOT LIKE '%[^0-9a-f]%')
  );

  EXEC(N'CREATE TRIGGER dbo.pos_sync_sale_outbox_v1_immutable ON dbo.pos_sync_sale_outbox_v1
    AFTER UPDATE, DELETE AS BEGIN
      SET NOCOUNT ON;
      IF EXISTS (SELECT 1 FROM deleted) THROW 51041, ''Saved sale event evidence is immutable.'', 1;
    END;');
  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
