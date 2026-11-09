-- Local proof of the scoped stock revision. Catalogue metadata keeps its
-- existing row version. This table is never published or Change Tracked.
CREATE TABLE dbo.pos_sync_grouped_stock_v1 (
  branch_id nvarchar(128) COLLATE Latin1_General_100_BIN2 NOT NULL,
  product_id uniqueidentifier NOT NULL,
  feed_epoch uniqueidentifier NOT NULL,
  product_version int NULL CHECK (product_version > 0),
  branch_balance int NULL,
  own_accepted_seq bigint NULL CHECK (own_accepted_seq > 0),
  CHECK ((product_version IS NULL AND branch_balance IS NULL AND own_accepted_seq IS NOT NULL) OR
         (product_version IS NOT NULL AND branch_balance IS NOT NULL)),
  PRIMARY KEY (branch_id, product_id)
);
