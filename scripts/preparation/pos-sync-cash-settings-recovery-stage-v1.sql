-- Isolated local spool. Never included in the registry or Change Tracking.
CREATE TABLE dbo.pos_sync_cash_settings_recovery_pages_v1 (
  run_id uniqueidentifier NOT NULL,
  kind varchar(5) COLLATE Latin1_General_100_BIN2 NOT NULL CHECK (kind IN ('cash', 'stock')),
  after_ordinal bigint NOT NULL CHECK (after_ordinal >= 0),
  expires_at datetime2(7) NOT NULL,
  payload_json nvarchar(max) NOT NULL CHECK (ISJSON(payload_json) = 1 AND DATALENGTH(payload_json) <= 1576960),
  payload_sha256 char(64) COLLATE Latin1_General_100_BIN2 NOT NULL
    CHECK (payload_sha256 NOT LIKE '%[^0-9a-f]%'),
  PRIMARY KEY (run_id, kind, after_ordinal)
);
CREATE INDEX pos_sync_cash_settings_recovery_pages_expiry
  ON dbo.pos_sync_cash_settings_recovery_pages_v1 (expires_at);
