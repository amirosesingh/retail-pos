-- Isolated preparation. This is deliberately outside the native migrations.
SET XACT_ABORT ON;
BEGIN TRANSACTION;

CREATE TABLE dbo.pos_store_settings_edit_commands (
  operation_id uniqueidentifier NOT NULL PRIMARY KEY,
  branch_id nvarchar(128) COLLATE Latin1_General_100_BIN2 NOT NULL,
  terminal_id uniqueidentifier NOT NULL,
  command_json nvarchar(2048) NOT NULL CHECK (ISJSON(command_json) = 1),
  command_sha256 char(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
  created_at datetime2(7) NOT NULL DEFAULT SYSUTCDATETIME()
);

CREATE INDEX IX_pos_store_settings_edit_scope ON dbo.pos_store_settings_edit_commands (branch_id, terminal_id);

CREATE TABLE dbo.pos_store_settings_edit_receipts (
  operation_id uniqueidentifier NOT NULL PRIMARY KEY REFERENCES dbo.pos_store_settings_edit_commands(operation_id),
  disposition nvarchar(24) COLLATE Latin1_General_100_BIN2 NOT NULL CHECK (disposition IN (N'APPLIED', N'REVIEW_REQUIRED')),
  receipt_json nvarchar(2048) NOT NULL CHECK (ISJSON(receipt_json) = 1),
  recorded_at datetime2(7) NOT NULL DEFAULT SYSUTCDATETIME()
);

EXEC(N'CREATE TRIGGER dbo.TR_pos_store_settings_edit_commands_immutable ON dbo.pos_store_settings_edit_commands
  INSTEAD OF UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 50000, ''Saved settings commands are immutable.'', 1; END;');
EXEC(N'CREATE TRIGGER dbo.TR_pos_store_settings_edit_receipts_immutable ON dbo.pos_store_settings_edit_receipts
  INSTEAD OF UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 50000, ''Saved settings receipts are immutable.'', 1; END;');

COMMIT;
