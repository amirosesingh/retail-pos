-- Local proof of the scoped stock revision. Catalogue metadata keeps its
-- existing row version. This table is never published or Change Tracked.
CREATE TABLE dbo.pos_sync_grouped_stock_v1 (
  branch_id nvarchar(128) COLLATE Latin1_General_100_BIN2 NOT NULL,
  product_id uniqueidentifier NOT NULL,
  feed_epoch uniqueidentifier NOT NULL,
  product_version int NULL CHECK (product_version > 0),
  branch_balance int NULL,
  retired bit NOT NULL CONSTRAINT DF_pos_sync_grouped_stock_v1_retired DEFAULT (0),
  own_accepted_seq bigint NULL CHECK (own_accepted_seq > 0),
  CHECK ((retired=0 AND product_version IS NULL AND branch_balance IS NULL AND own_accepted_seq IS NOT NULL) OR
         (retired=0 AND product_version IS NOT NULL AND branch_balance IS NOT NULL) OR
         (retired=1 AND product_version IS NOT NULL AND branch_balance IS NULL)),
  PRIMARY KEY (branch_id, product_id)
);
