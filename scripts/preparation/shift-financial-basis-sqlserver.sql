-- FIN62 isolated preparation ONLY: no migration, RPC, persistence or admission.
-- Parameters @branch nvarchar(128), @shift nvarchar(36). The caller must already
-- authorize this scope and hold a SERIALIZABLE transaction for the whole read.
-- Full private inputs include refunded rows; only the expected calculation
-- excludes them, matching OperationsRepository.shiftExpectedTotals exactly.
-- Numeric inputs/results are JSON strings. paymentsJson preserves raw JSON text.
-- expectedNativeRaw retains the existing native aggregate's 12 decimal places;
-- it is NOT the PostgreSQL rounded-to-2dp closing expectation or a wire contract.
IF @@TRANCOUNT=0 OR NOT EXISTS(
 SELECT 1 FROM sys.dm_exec_sessions WHERE session_id=@@SPID AND transaction_isolation_level=4)
BEGIN
 -- Reject without dooming unrelated caller work when XACT_ABORT is enabled.
 RAISERROR('Financial basis preparation requires a SERIALIZABLE caller transaction.',16,1);
 RETURN;
END;
DECLARE @opening decimal(38,12),@store nvarchar(450),@inputs nvarchar(max),@expected nvarchar(max);
SELECT @opening=COALESCE(sh.opening_float,0),@store=sh.store_id
 FROM dbo.shifts sh WHERE sh.id=TRY_CONVERT(uniqueidentifier,@shift) AND sh.store_id=@branch;
IF @store IS NULL BEGIN SELECT CAST(NULL AS nvarchar(max)) AS basis_json; RETURN; END;
SELECT @inputs=(SELECT LOWER(CONVERT(nvarchar(36),s.id)) AS id,s.store_id AS branchId,s.shift_id AS shiftId,
 CONVERT(nvarchar(80),s.total_amount) AS totalAmount,s.payment_type AS paymentType,s.payments AS paymentsJson,
 s.is_refunded AS isRefunded,CONVERT(nvarchar(30),s.row_version) AS rowVersion
 FROM dbo.sales s WHERE s.store_id=@store AND s.shift_id=CONVERT(nvarchar(36),TRY_CONVERT(uniqueidentifier,@shift))
 ORDER BY LOWER(CONVERT(nvarchar(36),s.id)) COLLATE Latin1_General_100_BIN2 FOR JSON PATH,INCLUDE_NULL_VALUES);
SET @inputs=COALESCE(NULLIF(@inputs,N''),N'[]');
WITH inputs AS (
 SELECT * FROM OPENJSON(@inputs) WITH(total_amount decimal(38,12) '$.totalAmount',payment_type nvarchar(max) '$.paymentType',
 payments nvarchar(max) '$.paymentsJson',is_refunded bit '$.isRefunded')
), parts AS (
 SELECT s.*,j.cash,j.card,j.digital,j.paid,
 CASE WHEN ISJSON(s.payments)=1 AND LEFT(LTRIM(s.payments),1)='['
   AND LEN(REPLACE(REPLACE(REPLACE(s.payments,' ',''),CHAR(10),''),CHAR(13),''))>2 THEN 1 ELSE 0 END split
 FROM inputs s OUTER APPLY(
  SELECT SUM(COALESCE(p.amount,0)) paid,
   SUM(CASE WHEN LOWER(COALESCE(p.method,''))='cash' THEN COALESCE(p.amount,0) ELSE 0 END) cash,
   SUM(CASE WHEN LOWER(COALESCE(p.method,''))='card' THEN COALESCE(p.amount,0) ELSE 0 END) card,
   SUM(CASE WHEN LOWER(COALESCE(p.method,'')) IN('wallet','bank_transfer','transfer','qr','online','ewallet') THEN COALESCE(p.amount,0) ELSE 0 END) digital
  FROM OPENJSON(CASE WHEN ISJSON(s.payments)=1 AND LEFT(LTRIM(s.payments),1)='['
   AND LEN(REPLACE(REPLACE(REPLACE(s.payments,' ',''),CHAR(10),''),CHAR(13),''))>2 THEN s.payments ELSE N'[]' END)
   WITH(method nvarchar(64) '$.method',amount decimal(38,12) '$.amount') p
 ) j WHERE COALESCE(s.is_refunded,0)=0
)
SELECT @expected=(SELECT
 CONVERT(nvarchar(80),CAST(@opening+COALESCE(SUM(CASE WHEN split=1 THEN CASE WHEN COALESCE(cash,0)>0 THEN COALESCE(cash,0)-CASE WHEN COALESCE(paid,0)>COALESCE(total_amount,0) THEN CASE WHEN paid-total_amount>cash THEN cash ELSE paid-total_amount END ELSE 0 END ELSE COALESCE(cash,0) END WHEN LOWER(COALESCE(payment_type,''))='cash' THEN COALESCE(total_amount,0) ELSE 0 END),0) AS decimal(38,12))) cash,
 CONVERT(nvarchar(80),CAST(COALESCE(SUM(CASE WHEN split=1 THEN COALESCE(card,0) WHEN LOWER(COALESCE(payment_type,''))='card' THEN COALESCE(total_amount,0) ELSE 0 END),0) AS decimal(38,12))) card,
 CONVERT(nvarchar(80),CAST(COALESCE(SUM(CASE WHEN split=1 THEN COALESCE(digital,0) WHEN LOWER(COALESCE(payment_type,'')) IN('wallet','bank_transfer','transfer','qr','online','ewallet') THEN COALESCE(total_amount,0) ELSE 0 END),0) AS decimal(38,12))) digital
 FROM parts FOR JSON PATH,WITHOUT_ARRAY_WRAPPER,INCLUDE_NULL_VALUES);
SELECT (SELECT 1 AS prototypeVersion,N'sqlserver-current-sales-net-refund-raw-v1' AS formula,12 AS numericScale,@store AS branchId,
 LOWER(CONVERT(nvarchar(36),TRY_CONVERT(uniqueidentifier,@shift))) AS shiftId,CONVERT(nvarchar(80),@opening) AS openingFloat,
 JSON_QUERY(@inputs) AS inputs,JSON_QUERY(@expected) AS expectedNativeRaw
 FOR JSON PATH,WITHOUT_ARRAY_WRAPPER,INCLUDE_NULL_VALUES) AS basis_json;
