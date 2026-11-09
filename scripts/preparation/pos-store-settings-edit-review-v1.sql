-- Isolated additive upgrade after pos-store-settings-edit-outbox-v1.sql.
SET XACT_ABORT ON;
BEGIN TRANSACTION;

CREATE TABLE dbo.pos_store_settings_edit_reviews (
  operation_id uniqueidentifier NOT NULL PRIMARY KEY REFERENCES dbo.pos_store_settings_edit_receipts(operation_id),
  reviewer_id uniqueidentifier NOT NULL,
  decision nvarchar(16) COLLATE Latin1_General_100_BIN2 NOT NULL CHECK (decision = N'KEEP_CENTRAL'),
  reviewed_version int NOT NULL CHECK (reviewed_version >= 2),
  reviewed_values nvarchar(1024) NOT NULL CHECK (ISJSON(reviewed_values) = 1),
  decision_sha256 char(64) COLLATE Latin1_General_100_BIN2 NOT NULL
    CHECK (LEN(decision_sha256) = 64 AND decision_sha256 NOT LIKE '%[^0-9a-f]%'),
  decided_at datetime2(7) NOT NULL DEFAULT SYSUTCDATETIME()
);

EXEC(N'CREATE TRIGGER dbo.TR_pos_store_settings_edit_reviews_immutable ON dbo.pos_store_settings_edit_reviews
  INSTEAD OF UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 50000, ''Saved settings reviews are immutable.'', 1; END;');

COMMIT;
