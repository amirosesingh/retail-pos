-- STOCK401 Beta pilot prerequisite. Execute only on the separately reviewed
-- physical SQL database. Bind its exact GUID on the same session with
-- sp_set_session_context (key: pos_stock_history_merge_database_guid).
-- This creates a local intent store. It does not enable the merge pilot.
SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
DECLARE @mergeOwnsTransaction bit=CASE WHEN @@TRANCOUNT=0 THEN 1 ELSE 0 END;
IF @mergeOwnsTransaction=1 BEGIN TRANSACTION;
BEGIN TRY
 DECLARE @mergeTarget sql_variant=SESSION_CONTEXT(N'pos_stock_history_merge_database_guid');
 DECLARE @mergeDatabase uniqueidentifier=TRY_CONVERT(uniqueidentifier,CONVERT(nvarchar(128),@mergeTarget));
 IF @mergeDatabase IS NULL OR SQL_VARIANT_PROPERTY(@mergeTarget,N'BaseType')<>N'uniqueidentifier' OR NOT EXISTS(
  SELECT 1 FROM sys.database_recovery_status WHERE database_id=DB_ID() AND database_guid=@mergeDatabase)
  THROW 51031,'PRODUCT_MERGE_DATABASE_UNVERIFIED',1;
 IF OBJECT_ID(N'dbo.stock_history_heads',N'U') IS NULL
  OR OBJECT_ID(N'dbo.stock_history_stocktake_fences',N'U') IS NULL
  OR OBJECT_ID(N'dbo.local_operation_receipts',N'U') IS NULL
  OR CHANGE_TRACKING_MIN_VALID_VERSION(OBJECT_ID(N'dbo.products')) IS NULL
  THROW 51031,'PRODUCT_MERGE_SCHEMA_REQUIRED',1;
 IF OBJECT_ID(N'dbo.stock_history_product_merge_intents') IS NOT NULL
  THROW 51031,'PRODUCT_MERGE_EXISTING_SCHEMA_REVIEW_REQUIRED',1;

 CREATE TABLE dbo.stock_history_product_merge_intents(
  operation_id uniqueidentifier NOT NULL CONSTRAINT PK_stock_history_product_merge_intents PRIMARY KEY,
  branch_id nvarchar(128) COLLATE Latin1_General_100_BIN2 NOT NULL,
  master_id uniqueidentifier NOT NULL,
  intent_json nvarchar(max) NOT NULL,
  outcome_json nvarchar(max) NULL,
  CONSTRAINT CK_stock_history_product_merge_intent_json CHECK(
   ISJSON(intent_json,OBJECT)=1 AND (outcome_json IS NULL OR ISJSON(outcome_json,OBJECT)=1))
 );
 CREATE UNIQUE INDEX UX_stock_history_product_merge_pending_branch
  ON dbo.stock_history_product_merge_intents(branch_id) WHERE outcome_json IS NULL;

 IF @mergeOwnsTransaction=1 COMMIT;
END TRY
BEGIN CATCH
 IF @mergeOwnsTransaction=1 AND XACT_STATE()<>0 ROLLBACK;
 THROW;
END CATCH;
