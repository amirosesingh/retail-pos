-- Bounded read only. All parameters and admission are owned by StockHistoryStore.
DECLARE @history_rows table(position int IDENTITY(1,1),wire nvarchar(max));
DECLARE @history_id uniqueidentifier,@history_name nvarchar(max),@history_sku nvarchar(max),@history_barcode nvarchar(max),
 @history_quantity decimal(38,0),@history_wire nvarchar(max),@history_size bigint=0,@history_seen int=0,
 @history_last uniqueidentifier=NULL,@history_next uniqueidentifier=NULL;
DECLARE history_products CURSOR LOCAL FAST_FORWARD FOR
 SELECT TOP(@history_limit) o.product_id,o.product_name,o.sku,o.barcode,
  o.quantity+COALESCE((SELECT SUM(m.quantity_delta) FROM dbo.stock_history_movements m
   WHERE m.store_id=o.store_id AND CONVERT(varbinary(max),m.store_id)=CONVERT(varbinary(max),o.store_id) AND m.product_id=o.product_id
    AND m.effective_ticks>CONVERT(decimal(20,0),@history_baseline_ticks)
    AND m.effective_ticks<=CONVERT(decimal(20,0),@history_ticks)
    AND m.ingested_cursor<=CONVERT(bigint,@history_cursor)),0)
 FROM dbo.stock_history_openings o WHERE o.store_id=@history_branch
  AND CONVERT(varbinary(max),o.store_id)=CONVERT(varbinary(max),@history_branch) AND o.baseline_id=@history_baseline
  AND (@history_after IS NULL OR o.product_id>CONVERT(uniqueidentifier,@history_after)) ORDER BY o.product_id;
OPEN history_products;
FETCH NEXT FROM history_products INTO @history_id,@history_name,@history_sku,@history_barcode,@history_quantity;
WHILE @@FETCH_STATUS=0 BEGIN
 IF @history_seen>=@history_page_size BEGIN SET @history_next=@history_last;BREAK;END;
 SET @history_wire=(SELECT LOWER(CONVERT(nvarchar(36),@history_id)) productId,@history_branch locationId,
  @history_name [name],@history_sku sku,@history_barcode barcode,CONVERT(nvarchar(50),@history_quantity) quantity,
  CONVERT(bit,CASE WHEN @history_quantity<0 THEN 1 ELSE 0 END) negative
  FOR JSON PATH,INCLUDE_NULL_VALUES,WITHOUT_ARRAY_WRAPPER);
 -- UTF-8 uses at most three bytes per UTF-16 code unit. This conservative bound
 -- avoids requiring a database/default-collation change or UTF-8 SQL collation.
 IF @history_size+3*CONVERT(bigint,DATALENGTH(@history_wire))/2+1>245760 BEGIN
  IF @history_seen=0 THROW 51031,'STOCK_HISTORY_ROW_OVERSIZED',1;
  SET @history_next=@history_last;BREAK;
 END;
 INSERT @history_rows(wire) VALUES(@history_wire);
 SET @history_size=@history_size+3*CONVERT(bigint,DATALENGTH(@history_wire))/2+1;
 SET @history_seen=@history_seen+1;SET @history_last=@history_id;
 FETCH NEXT FROM history_products INTO @history_id,@history_name,@history_sku,@history_barcode,@history_quantity;
END;
CLOSE history_products;DEALLOCATE history_products;
SELECT N'['+COALESCE(STRING_AGG(CONVERT(nvarchar(max),wire),N',') WITHIN GROUP(ORDER BY position),N'')+N']' rows_json,
 LOWER(CONVERT(nvarchar(36),@history_next)) next_id FROM @history_rows;
