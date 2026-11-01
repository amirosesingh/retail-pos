-- SHIFT-28B preparation artifact. NOT approved for execution on the affected PC.
-- CAPTURE is read-only. STAGE inserts upload metadata only; it does NOT recover
-- the cloud shift, start synchronization, or establish a v2 acknowledgement.
-- Read docs/database/str1-original-closing-recovery.md before any use.
-- No sqlcmd variables, fixture mode, SESSION_CONTEXT bypass or dynamic SQL.
-- Read-only excerpt: take this file up to STAGE_ONLY_BEGIN, then append the
-- following fail-closed trailer and OWNED_TRANSACTION_CATCH_BEGIN tail.
-- Keep Mode=CAPTURE. The isolated harness
-- executes that exact derivation and rejects persistent DML/DDL in it.
-- CAPTURE_ONLY_TRAILER_BEGIN
-- IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
-- THROW 51028,N'SHIFT28B derived capture refuses non-CAPTURE mode',1;
-- CAPTURE_ONLY_TRAILER_END

-- REVIEWED INPUTS BEGIN: change only in a separately reviewed execution artifact.
DECLARE @Mode nvarchar(10)=N'CAPTURE';
DECLARE @ExpectedServer nvarchar(128)=N'DESKTOP-VIB2MIL\LCRPOS';
DECLARE @ExpectedDatabase sysname=N'POS_Local';
DECLARE @ExpectedDatabaseGuid uniqueidentifier=NULL;
DECLARE @ReviewedManifest nvarchar(max)=NULL;
DECLARE @ReviewedSha256 varchar(64)=NULL;
DECLARE @ApprovalReference nvarchar(80)=NULL;
DECLARE @TransportReference nvarchar(80)=NULL;
-- REVIEWED INPUTS END

-- References are human audit attestations, not technical authority or delivery
-- proof. The exact manifest, database identity and all integrity guards still run.
-- Pre-owned refusal must not honor an inherited XACT_ABORT ON and roll back
-- operator work. RAISERROR plus RETURN stops this batch without owning that work.
IF (@@OPTIONS & 2)=2
BEGIN
  RAISERROR(N'SHIFT28B refuses IMPLICIT_TRANSACTIONS ON',16,1);
  RETURN;
END;
IF @@TRANCOUNT<>0
BEGIN
  RAISERROR(N'SHIFT28B refuses an existing transaction',16,1);
  RETURN;
END;
IF @Mode NOT IN(N'CAPTURE',N'STAGE') OR @Mode IS NULL
  THROW 51028,N'SHIFT28B mode must be CAPTURE or STAGE',1;
IF NULLIF(LTRIM(RTRIM(@ExpectedServer)),N'') IS NULL
 OR NULLIF(LTRIM(RTRIM(@ExpectedDatabase)),N'') IS NULL
 OR CONVERT(nvarchar(128),SERVERPROPERTY(N'ServerName')) COLLATE Latin1_General_100_BIN2
     <>@ExpectedServer COLLATE Latin1_General_100_BIN2
 OR DB_NAME() COLLATE Latin1_General_100_BIN2<>@ExpectedDatabase COLLATE Latin1_General_100_BIN2
  THROW 51028,N'SHIFT28B exact server/database identity mismatch',1;
IF @Mode=N'STAGE' AND (@ExpectedDatabaseGuid IS NULL OR @ReviewedManifest IS NULL
 OR @ReviewedSha256 IS NULL OR LEN(@ReviewedSha256)<>64
 OR @ReviewedSha256 COLLATE Latin1_General_100_BIN2 LIKE '%[^0-9A-Fa-f]%'
 OR NULLIF(LTRIM(RTRIM(@ApprovalReference)),N'') IS NULL
 OR NULLIF(LTRIM(RTRIM(@TransportReference)),N'') IS NULL)
  THROW 51028,N'SHIFT28B staging requires a separately reviewed manifest, digest, database GUID and approval/transport references',1;

DECLARE @Shift uniqueidentifier='1a349429-cea1-4f45-8d2b-36678d37ad27';
DECLARE @Branch nvarchar(128)=N'a611a328-2217-4d77-944a-5f6a637d123b';
DECLARE @Terminal nvarchar(128)=N'2a9be656-3830-4f1c-9ede-3e9c379f3d13';
DECLARE @Count uniqueidentifier='dd2b330a-bcfc-44f6-9949-8d912cdbca80';
DECLARE @Reconciliation uniqueidentifier='7a49fc63-da14-41c6-b7d7-c1ddda5871fa';
DECLARE @Opened datetimeoffset(7)='2026-10-31T02:22:18.1080000+00:00';
DECLARE @Closed datetimeoffset(7)='2026-10-31T13:08:56.8370000+00:00';
-- stableUuid({kind:'maintenance_shift_close_requeue_v1',branchId,terminalId,shiftId})
-- uses the existing repository's canonical SHA256/domain-separated UUID recipe.
DECLARE @Recovery uniqueidentifier='f69ae907-b21f-4d7e-8369-17ec6f707212';
DECLARE @OperationType nvarchar(40)=N'maintenance_shift_close_requeue';
DECLARE @DatabaseGuid uniqueidentifier;
SELECT @DatabaseGuid=database_guid FROM sys.database_recovery_status WHERE database_id=DB_ID();
IF @DatabaseGuid IS NULL OR (@ExpectedDatabaseGuid IS NOT NULL AND @DatabaseGuid<>@ExpectedDatabaseGuid)
  THROW 51028,N'SHIFT28B database GUID is unavailable or differs',1;
IF EXISTS(SELECT 1 FROM sys.triggers WHERE parent_id IN
 (OBJECT_ID(N'dbo.sync_change_journal'),OBJECT_ID(N'dbo.local_operation_receipts')) AND is_disabled=0)
  THROW 51028,N'SHIFT28B unreviewed metadata trigger; no staging allowed',1;

DECLARE @Parents nvarchar(max),@Counts nvarchar(max),@Reconciliations nvarchar(max),
 @Events nvarchar(max),@Notifications nvarchar(max),@Alerts nvarchar(max),
 @Journal nvarchar(max),@Receipts nvarchar(max),@Checkpoints nvarchar(max),
 @Manifest nvarchar(max),@Digest varchar(64),@ReceiptNote nvarchar(400),@ExistingNote nvarchar(400),
 @StagedMetadata nvarchar(max),@StagedDigest varchar(64),@ReceiptAt datetimeoffset(7);
DECLARE @ExistingReceipt bit=0;
DECLARE @Keys table(entity_type nvarchar(128) NOT NULL,id uniqueidentifier NOT NULL,
 entity_version bigint NOT NULL,PRIMARY KEY(entity_type,id));
DECLARE @LinkedJournal table(change_id bigint NOT NULL PRIMARY KEY,aggregate_id uniqueidentifier NULL);

BEGIN TRY
  BEGIN TRANSACTION;
  -- Same deterministic receipt serializes two staging attempts. Per-read NOWAIT
  -- and HOLDLOCK avoid session-setting changes. Busy scans abort the whole batch.
  SELECT @ExistingReceipt=1,@ExistingNote=note,@ReceiptAt=committed_at FROM dbo.local_operation_receipts WITH(UPDLOCK,HOLDLOCK,NOWAIT)
    WHERE operation_id=@Recovery;
  IF @ExistingReceipt=1 AND (@ExistingNote IS NULL OR @ReceiptAt IS NULL)
    THROW 51028,N'SHIFT28B existing maintenance receipt is incomplete',1;
  SET @Parents=(SELECT * FROM dbo.shifts WITH(UPDLOCK,HOLDLOCK,NOWAIT)
    WHERE id=@Shift ORDER BY id FOR JSON PATH,INCLUDE_NULL_VALUES);
  IF NOT EXISTS(SELECT 1 FROM dbo.shifts WHERE id=@Shift AND store_id=@Branch
    AND terminal_id=@Terminal AND status=N'CLOSED' AND state=N'CLOSED'
    AND opened_at=@Opened AND closed_at=@Closed AND row_version=3)
    THROW 51028,N'SHIFT28B original closed parent/identity/timing/revision differs',1;
  SET @Counts=(SELECT * FROM dbo.shift_cash_counts WITH(UPDLOCK,HOLDLOCK,NOWAIT)
    WHERE shift_id=@Shift ORDER BY id FOR JSON PATH,INCLUDE_NULL_VALUES);
  SET @Reconciliations=(SELECT * FROM dbo.shift_reconciliations WITH(UPDLOCK,HOLDLOCK,NOWAIT)
    WHERE shift_id=@Shift ORDER BY id FOR JSON PATH,INCLUDE_NULL_VALUES);
  SET @Events=(SELECT * FROM dbo.shift_close_events WITH(UPDLOCK,HOLDLOCK,NOWAIT)
    WHERE shift_id=@Shift ORDER BY id FOR JSON PATH,INCLUDE_NULL_VALUES);
  SET @Notifications=(SELECT * FROM dbo.shift_notifications WITH(UPDLOCK,HOLDLOCK,NOWAIT)
    WHERE shift_id=@Shift ORDER BY id FOR JSON PATH,INCLUDE_NULL_VALUES);
  SET @Alerts=(SELECT * FROM dbo.shift_variance_alerts WITH(UPDLOCK,HOLDLOCK,NOWAIT)
    WHERE shift_id=@Shift ORDER BY id FOR JSON PATH,INCLUDE_NULL_VALUES);
  IF (SELECT COUNT(*) FROM OPENJSON(@Parents))<>1
    OR (SELECT COUNT(*) FROM OPENJSON(@Counts))<>1
    OR (SELECT COUNT(*) FROM OPENJSON(@Reconciliations))<>1
    OR (SELECT COUNT(*) FROM OPENJSON(@Events))<>3
    OR (SELECT COUNT(*) FROM OPENJSON(@Notifications))<>1
    OR (SELECT COUNT(*) FROM OPENJSON(@Alerts))<>1
    THROW 51028,N'SHIFT28B complete saved graph cardinality differs',1;
  IF NOT EXISTS(SELECT 1 FROM dbo.shift_cash_counts c JOIN dbo.shift_reconciliations r ON r.count_id=c.id
    JOIN dbo.shifts s ON s.id=c.shift_id AND r.shift_id=s.id
    WHERE s.id=@Shift AND c.id=@Count AND r.id=@Reconciliation AND c.kind=N'ORIGINAL'
      AND c.store_id=@Branch AND r.store_id=@Branch AND c.terminal_id=@Terminal
      AND c.created_at=@Closed AND r.created_at=@Closed
      AND EXISTS(SELECT c.counted_cash,c.counted_card,c.counted_digital INTERSECT
                 SELECT r.counted_cash,r.counted_card,r.counted_digital)
      AND EXISTS(SELECT s.counted_cash,s.closing_float,COALESCE(s.final_counted_cash,s.counted_cash),
                    s.counted_card,s.counted_digital,s.expected_cash,s.expected_card,s.expected_digital,
                    s.variance_cash,s.variance_card,s.variance_digital,s.variance_total,s.variance_status
                 INTERSECT SELECT r.counted_cash,r.counted_cash,r.counted_cash,
                    r.counted_card,r.counted_digital,r.expected_cash,r.expected_card,r.expected_digital,
                    r.variance_cash,r.variance_card,r.variance_digital,r.variance_total,r.variance_status))
    THROW 51028,N'SHIFT28B original count/reconciliation/parent financial links differ',1;
  IF EXISTS(SELECT 1 FROM dbo.shift_close_events WHERE shift_id=@Shift
       AND (store_id IS NULL OR store_id<>@Branch OR terminal_id IS NULL OR terminal_id<>@Terminal
         OR created_at IS NULL OR created_at<@Opened OR created_at>@Closed OR detail IS NULL OR ISJSON(detail)<>1))
    OR EXISTS(SELECT 1 FROM dbo.shift_notifications WHERE shift_id=@Shift
       AND (store_id IS NULL OR store_id<>@Branch OR opened_at IS NULL OR opened_at<>@Opened
         OR closed_at IS NULL OR closed_at<>@Closed OR created_at IS NULL OR created_at<>@Closed
         OR payment_breakdown IS NULL OR ISJSON(payment_breakdown)<>1 OR channels IS NULL OR ISJSON(channels)<>1))
    OR EXISTS(SELECT 1 FROM dbo.shift_variance_alerts WHERE shift_id=@Shift
       AND (store_id IS NULL OR store_id<>@Branch OR reconciliation_id IS NULL OR reconciliation_id<>@Reconciliation
         OR created_at IS NULL OR created_at<>@Closed))
    THROW 51028,N'SHIFT28B saved event/summary/alert ownership or timing differs',1;
  IF (SELECT COUNT(*) FROM dbo.shift_close_events WHERE shift_id=@Shift AND event=N'closing_started')<>1
    OR (SELECT COUNT(*) FROM dbo.shift_close_events WHERE shift_id=@Shift AND event=N'cash_count_submitted'
      AND TRY_CONVERT(uniqueidentifier,JSON_VALUE(detail,N'$.count_id'))=@Count AND created_at=@Closed)<>1
    OR (SELECT COUNT(*) FROM dbo.shift_close_events WHERE shift_id=@Shift AND event=N'reconciled'
      AND to_state=N'CLOSED' AND created_at=@Closed)<>1
    THROW 51028,N'SHIFT28B original closing event links differ',1;

  INSERT @Keys SELECT N'shifts',id,row_version FROM dbo.shifts WHERE id=@Shift
    UNION ALL SELECT N'shift_cash_counts',id,1 FROM dbo.shift_cash_counts WHERE shift_id=@Shift
    UNION ALL SELECT N'shift_reconciliations',id,1 FROM dbo.shift_reconciliations WHERE shift_id=@Shift
    UNION ALL SELECT N'shift_close_events',id,1 FROM dbo.shift_close_events WHERE shift_id=@Shift
    UNION ALL SELECT N'shift_notifications',id,1 FROM dbo.shift_notifications WHERE shift_id=@Shift
    UNION ALL SELECT N'shift_variance_alerts',id,1 FROM dbo.shift_variance_alerts WHERE shift_id=@Shift;
  IF EXISTS(SELECT 1 FROM @Keys WHERE entity_version<1 OR entity_version>9007199254740991)
    THROW 51028,N'SHIFT28B invalid exact graph version',1;

  -- Both legacy raw UUID and canonical JSON-key encodings are accounted for.
  -- A malformed/foreign encoding containing an exact graph ID is ambiguous.
  IF EXISTS(SELECT 1 FROM dbo.sync_change_journal j WITH(UPDLOCK,HOLDLOCK,NOWAIT)
    JOIN @Keys k ON CHARINDEX(LOWER(CONVERT(nvarchar(36),k.id)),LOWER(j.entity_id))>0
      OR k.id=COALESCE(TRY_CONVERT(uniqueidentifier,j.entity_id),TRY_CONVERT(uniqueidentifier,
        JSON_VALUE(CASE WHEN ISJSON(j.entity_id)=1 THEN j.entity_id ELSE N'{}' END,N'$.id')))
    WHERE (j.aggregate_id IS NULL OR j.aggregate_id<>@Recovery) AND (j.entity_type<>k.entity_type OR
      COALESCE(TRY_CONVERT(uniqueidentifier,j.entity_id),TRY_CONVERT(uniqueidentifier,
        JSON_VALUE(CASE WHEN ISJSON(j.entity_id)=1 THEN j.entity_id ELSE N'{}' END,N'$.id')))<>k.id
      OR COALESCE(TRY_CONVERT(uniqueidentifier,j.entity_id),TRY_CONVERT(uniqueidentifier,
        JSON_VALUE(CASE WHEN ISJSON(j.entity_id)=1 THEN j.entity_id ELSE N'{}' END,N'$.id'))) IS NULL
      OR NOT ((DATALENGTH(j.entity_id)=72 AND TRY_CONVERT(uniqueidentifier,j.entity_id)=k.id)
        OR (ISJSON(j.entity_id)=1
          AND (SELECT COUNT(*) FROM OPENJSON(CASE WHEN ISJSON(j.entity_id)=1 THEN j.entity_id ELSE N'{}' END))=1
          AND EXISTS(SELECT 1 FROM OPENJSON(CASE WHEN ISJSON(j.entity_id)=1 THEN j.entity_id ELSE N'{}' END) keypart
            WHERE keypart.[key]=N'id' AND keypart.[type]=1 AND DATALENGTH(keypart.[value])=72
              AND TRY_CONVERT(uniqueidentifier,keypart.[value])=k.id)))))
    THROW 51028,N'SHIFT28B ambiguous graph journal identity',1;
  INSERT @LinkedJournal SELECT j.change_id,j.aggregate_id
    FROM dbo.sync_change_journal j WITH(UPDLOCK,HOLDLOCK,NOWAIT)
    JOIN @Keys k ON j.entity_type=k.entity_type AND k.id=COALESCE(TRY_CONVERT(uniqueidentifier,j.entity_id),
      TRY_CONVERT(uniqueidentifier,JSON_VALUE(CASE WHEN ISJSON(j.entity_id)=1 THEN j.entity_id ELSE N'{}' END,N'$.id')))
    WHERE j.aggregate_id IS NULL OR j.aggregate_id<>@Recovery;
  INSERT @LinkedJournal SELECT j.change_id,j.aggregate_id
    FROM dbo.sync_change_journal j WITH(UPDLOCK,HOLDLOCK,NOWAIT)
    WHERE j.aggregate_id IN(SELECT aggregate_id FROM @LinkedJournal)
      AND NOT EXISTS(SELECT 1 FROM @LinkedJournal found WHERE found.change_id=j.change_id);
  IF (SELECT COUNT(*) FROM @LinkedJournal)>256
    THROW 51028,N'SHIFT28B linked journal exceeds reviewed bound',1;
  IF EXISTS(SELECT 1 FROM dbo.sync_change_journal j JOIN @LinkedJournal l ON l.change_id=j.change_id
    WHERE j.branch_id IS NULL OR j.branch_id<>@Branch OR j.aggregate_id IS NULL OR j.acknowledged_at IS NULL
      OR j.entity_version IS NULL OR j.entity_version<1 OR j.entity_version>9007199254740991
      OR j.operation IS NULL OR j.operation NOT IN(N'insert',N'update')
      OR NOT EXISTS(SELECT 1 FROM @Keys k WHERE k.entity_type=j.entity_type AND k.id=COALESCE(
        TRY_CONVERT(uniqueidentifier,j.entity_id),TRY_CONVERT(uniqueidentifier,
        JSON_VALUE(CASE WHEN ISJSON(j.entity_id)=1 THEN j.entity_id ELSE N'{}' END,N'$.id')))))
    THROW 51028,N'SHIFT28B pending, foreign, partial or shared aggregate needs separate review',1;
  IF (SELECT COUNT(*) FROM @LinkedJournal)<>1 OR NOT EXISTS(
    SELECT 1 FROM dbo.sync_change_journal j JOIN @LinkedJournal l ON l.change_id=j.change_id
    WHERE j.entity_type=N'shifts' AND j.entity_version=1)
    THROW 51028,N'SHIFT28B historical acknowledged opening baseline differs',1;
  SET @Journal=(SELECT j.* FROM dbo.sync_change_journal j JOIN @LinkedJournal l ON l.change_id=j.change_id
    ORDER BY j.change_id FOR JSON PATH,INCLUDE_NULL_VALUES);
  SET @Receipts=(SELECT * FROM dbo.local_operation_receipts WITH(UPDLOCK,HOLDLOCK,NOWAIT)
    WHERE operation_id IN(SELECT aggregate_id FROM @LinkedJournal)
    ORDER BY operation_id FOR JSON PATH,INCLUDE_NULL_VALUES);
  IF EXISTS(SELECT 1 FROM @LinkedJournal l WHERE NOT EXISTS(
    SELECT 1 FROM dbo.local_operation_receipts r WHERE r.operation_id=l.aggregate_id))
    THROW 51028,N'SHIFT28B linked historical aggregate has no saved receipt',1;
  SET @Checkpoints=(SELECT * FROM dbo.sync_checkpoints WITH(UPDLOCK,HOLDLOCK,NOWAIT)
    WHERE branch_id=@Branch AND entity_type IN(N'change_history',N'shifts',N'shift_cash_counts',
      N'shift_reconciliations',N'shift_close_events',N'shift_notifications',N'shift_variance_alerts')
    ORDER BY organization_id,entity_type,direction FOR JSON PATH,INCLUDE_NULL_VALUES);
  -- Recheck while the owned receipt/journal data locks are held. These locks
  -- prevent a later incompatible schema modification until this transaction ends.
  IF EXISTS(SELECT 1 FROM sys.triggers WHERE parent_id IN
    (OBJECT_ID(N'dbo.sync_change_journal'),OBJECT_ID(N'dbo.local_operation_receipts')) AND is_disabled=0)
    THROW 51028,N'SHIFT28B unreviewed metadata trigger; no staging allowed',1;
  -- Volatile CT-current/minimum/read times are deliberately NOT digest inputs.
  -- Relevant saved checkpoint or baseline acknowledgement changes DO invalidate it.
  SET @Manifest=(SELECT 1 AS manifest_version,N'SHIFT28B-original-STR1-20261031' AS purpose,
    @ExpectedServer AS server_name,@ExpectedDatabase AS database_name,@DatabaseGuid AS database_guid,
    @Branch AS branch_id,@Terminal AS terminal_id,@Shift AS shift_id,
    JSON_QUERY(@Parents) AS shifts,JSON_QUERY(@Counts) AS shift_cash_counts,
    JSON_QUERY(@Reconciliations) AS shift_reconciliations,JSON_QUERY(@Events) AS shift_close_events,
    JSON_QUERY(@Notifications) AS shift_notifications,JSON_QUERY(@Alerts) AS shift_variance_alerts,
    JSON_QUERY(@Journal) AS baseline_journal,JSON_QUERY(@Receipts) AS baseline_receipts,
    JSON_QUERY(@Checkpoints) AS saved_checkpoints FOR JSON PATH,WITHOUT_ARRAY_WRAPPER,INCLUDE_NULL_VALUES);
  IF DATALENGTH(@Manifest)>6*1024*1024 THROW 51028,N'SHIFT28B manifest exceeds reviewed size bound',1;
  SET @Digest=CONVERT(varchar(64),HASHBYTES('SHA2_256',CONVERT(varbinary(max),@Manifest)),2);
  IF @Mode=N'CAPTURE'
  BEGIN
    ROLLBACK TRANSACTION;
    SELECT N'CAPTURE ONLY / NOT STAGED / NOT RECOVERED' AS result,@DatabaseGuid AS database_guid,
      @Digest AS sha256_utf16le,@Manifest AS exact_manifest;
    RETURN;
  END;
  -- STAGE_ONLY_BEGIN: never submit this section for read-only inspection.
  IF @ReviewedSha256 COLLATE Latin1_General_100_BIN2<>@Digest COLLATE Latin1_General_100_BIN2
    OR HASHBYTES('SHA2_256',CONVERT(varbinary(max),@ReviewedManifest))<>HASHBYTES('SHA2_256',CONVERT(varbinary(max),@Manifest))
    OR CONVERT(varbinary(max),@ReviewedManifest)<>CONVERT(varbinary(max),@Manifest)
    THROW 51028,N'SHIFT28B reviewed complete manifest/digest differs; nothing staged',1;
  IF EXISTS(SELECT 1 FROM dbo.sync_change_journal j WITH(UPDLOCK,HOLDLOCK,NOWAIT)
    WHERE j.aggregate_id=@Recovery AND (j.branch_id IS NULL OR j.branch_id<>@Branch OR NOT EXISTS(
      SELECT 1 FROM @Keys k WHERE k.entity_type=j.entity_type
        AND j.entity_id=N'{"id":"'+CONVERT(nvarchar(36),k.id)+N'"}'
        AND j.entity_version=k.entity_version AND j.operation=CASE WHEN k.entity_type=N'shifts' THEN N'update' ELSE N'insert' END)))
    THROW 51028,N'SHIFT28B maintenance journal facts conflict',1;
  IF @ExistingNote IS NOT NULL
  BEGIN
    IF (SELECT COUNT(*) FROM dbo.sync_change_journal WHERE aggregate_id=@Recovery)<>8
      OR EXISTS(SELECT 1 FROM @Keys k WHERE (SELECT COUNT(*) FROM dbo.sync_change_journal j
        WHERE j.aggregate_id=@Recovery AND j.entity_type=k.entity_type
          AND j.entity_id=N'{"id":"'+CONVERT(nvarchar(36),k.id)+N'"}')<>1)
      THROW 51028,N'SHIFT28B existing maintenance journal is partial or duplicated',1;
    -- Bind every persisted journal field except the three named worker-owned
    -- acknowledgement/retry fields. Include receipt time to prevent silent drift.
    SET @StagedMetadata=(SELECT @ReceiptAt AS receipt_committed_at,JSON_QUERY((
      SELECT JSON_QUERY(JSON_MODIFY(JSON_MODIFY(JSON_MODIFY(
        (SELECT j.* FOR JSON PATH,WITHOUT_ARRAY_WRAPPER,INCLUDE_NULL_VALUES),
        '$.acknowledged_at',NULL),'$.retry_count',NULL),'$.last_error',NULL)) AS immutable_row
      FROM dbo.sync_change_journal j WHERE aggregate_id=@Recovery ORDER BY change_id
      FOR JSON PATH,INCLUDE_NULL_VALUES)) AS journal
      FOR JSON PATH,WITHOUT_ARRAY_WRAPPER,INCLUDE_NULL_VALUES);
    SET @StagedDigest=CONVERT(varchar(64),HASHBYTES('SHA2_256',CONVERT(varbinary(max),@StagedMetadata)),2);
    SET @ReceiptNote=CONCAT(N'SHIFT28B|manifest=',@Digest,N'|journal=',@StagedDigest,
      N'|approval=',@ApprovalReference,N'|transport=',@TransportReference);
    IF CONVERT(varbinary(max),@ExistingNote)<>CONVERT(varbinary(max),@ReceiptNote)
      OR NOT EXISTS(SELECT 1 FROM dbo.local_operation_receipts WHERE operation_id=@Recovery
        AND CONVERT(varbinary(max),operation_type)=CONVERT(varbinary(max),@OperationType)
        AND CONVERT(varbinary(max),entity_id)=CONVERT(varbinary(max),CONVERT(nvarchar(36),@Shift)))
      THROW 51028,N'SHIFT28B existing maintenance receipt conflicts',1;
    COMMIT TRANSACTION;
    SELECT N'ALREADY STAGED / NOT RECOVERED; VERIFY CLOUD READBACK' AS result,@Recovery AS operation_id,@Digest AS sha256_utf16le;
    RETURN;
  END;
  IF EXISTS(SELECT 1 FROM dbo.local_operation_receipts WHERE operation_id=@Recovery)
    OR EXISTS(SELECT 1 FROM dbo.sync_change_journal WHERE aggregate_id=@Recovery)
    THROW 51028,N'SHIFT28B orphan or partial maintenance metadata',1;
  INSERT dbo.sync_change_journal(entity_type,entity_id,operation,branch_id,entity_version,aggregate_id)
    SELECT entity_type,N'{"id":"'+CONVERT(nvarchar(36),id)+N'"}',
      CASE WHEN entity_type=N'shifts' THEN N'update' ELSE N'insert' END,@Branch,entity_version,@Recovery FROM @Keys;
  IF @@ROWCOUNT<>8 THROW 51028,N'SHIFT28B journal insert count differs',1;
  SET @ReceiptAt=SYSDATETIMEOFFSET();
  SET @StagedMetadata=(SELECT @ReceiptAt AS receipt_committed_at,JSON_QUERY((
    SELECT JSON_QUERY(JSON_MODIFY(JSON_MODIFY(JSON_MODIFY(
      (SELECT j.* FOR JSON PATH,WITHOUT_ARRAY_WRAPPER,INCLUDE_NULL_VALUES),
      '$.acknowledged_at',NULL),'$.retry_count',NULL),'$.last_error',NULL)) AS immutable_row
    FROM dbo.sync_change_journal j WHERE aggregate_id=@Recovery ORDER BY change_id
    FOR JSON PATH,INCLUDE_NULL_VALUES)) AS journal
    FOR JSON PATH,WITHOUT_ARRAY_WRAPPER,INCLUDE_NULL_VALUES);
  SET @StagedDigest=CONVERT(varchar(64),HASHBYTES('SHA2_256',CONVERT(varbinary(max),@StagedMetadata)),2);
  SET @ReceiptNote=CONCAT(N'SHIFT28B|manifest=',@Digest,N'|journal=',@StagedDigest,
    N'|approval=',@ApprovalReference,N'|transport=',@TransportReference);
  INSERT dbo.local_operation_receipts(operation_id,operation_type,entity_id,note,committed_at)
    VALUES(@Recovery,@OperationType,CONVERT(nvarchar(36),@Shift),@ReceiptNote,@ReceiptAt);
  IF @@ROWCOUNT<>1 THROW 51028,N'SHIFT28B maintenance receipt was not inserted',1;
  COMMIT TRANSACTION;
  SELECT N'STAGED ONLY / NOT RECOVERED; VERIFY V2 PROOF AND CLOUD READBACK' AS result,
    @Recovery AS operation_id,@Digest AS sha256_utf16le,8 AS staged_journal_rows;
-- OWNED_TRANSACTION_CATCH_BEGIN: shared tail for the read-only excerpt.
END TRY
BEGIN CATCH
  IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
