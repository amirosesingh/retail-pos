-- SHIFT63 PREPARATION ONLY. Apply only to the reviewed operator database after
-- exact target approval. NULL inherits global rules; missing global value = ON.
IF @@TRANCOUNT<>0
BEGIN
 RAISERROR('Run the shift-sharing upgrade outside an existing transaction.',16,1);
 RETURN;
END;
SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF OBJECT_ID(N'dbo.pos_store_settings',N'U') IS NULL OR COL_LENGTH(N'dbo.pos_store_settings',N'allow_multiple_shifts_per_terminal') IS NULL
 THROW 51000,'The expected POS operational rules table is missing.',1;
IF COL_LENGTH(N'dbo.pos_store_settings',N'allow_branch_shift_sharing') IS NULL
 ALTER TABLE dbo.pos_store_settings ADD allow_branch_shift_sharing bit NULL;
IF NOT EXISTS(SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.pos_store_settings') AND name=N'allow_branch_shift_sharing' AND system_type_id=104 AND is_nullable=1 AND default_object_id=0)
 THROW 51000,'The shift-sharing column has an unexpected definition.',1;
COMMIT;
