const { canonicalInstant, fail, identifier, instant } = require('./stock-history-contract.cjs');

function movementRequest(input) {
 const keys=new Set(['branchId','productId','cutoff','timeZone','sourceRevision','periodStart','closedShiftId','after','limit']);
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!keys.has(key))||
  typeof input.sourceRevision!=='string'||!input.sourceRevision.trim()||input.sourceRevision.length>512)fail();
 const limit=input.limit??50;
 if(!Number.isInteger(limit)||limit<1||limit>100)fail();
 let after=null;
 if(input.after!=null){
  if(typeof input.after!=='object'||Array.isArray(input.after)||Object.keys(input.after).length!==2||
   !Object.hasOwn(input.after,'effectiveAt')||!Object.hasOwn(input.after,'id'))fail();
  after={effectiveAt:canonicalInstant(input.after.effectiveAt),id:identifier(input.after.id,true)};
 }
 return {branchId:identifier(input.branchId),productId:identifier(input.productId,true),
  cutoff:canonicalInstant(input.cutoff),timeZone:input.timeZone,sourceRevision:input.sourceRevision,after,limit,
  ...(input.periodStart===undefined?{}:{periodStart:canonicalInstant(input.periodStart)}),
  ...(input.closedShiftId===undefined?{}:{closedShiftId:identifier(input.closedShiftId,true)})};
}

function movementPage(request,report) {
 return {branchId:request.branchId,productId:request.productId,cutoff:request.cutoff,timeZone:request.timeZone,
  sourceRevision:request.sourceRevision,...(request.periodStart?{periodStart:request.periodStart}:{}),
  ...(request.closedShiftId?{closedShiftId:request.closedShiftId}:{}),status:report.status==='unsupported'?'incomplete':report.status,
  reasons:report.reasons,baselineAt:report.baselineAt??null,rows:report.rows,next:report.next};
}

// The caller holds the existing verified baseline and head for this SQL
// read session. Never return original payloads, author proofs or actor IDs.
async function readVerifiedMovements(sqlRequest,request,baseline) {
 const result=await sqlRequest.input('movement_branch',request.branchId).input('movement_product',request.productId)
  .input('movement_baseline',baseline.baseline_id).input('movement_baseline_ticks',String(baseline.cutoff_ticks))
  .input('movement_cursor',String(baseline.committed_cursor)).input('movement_cutoff',String(instant(request.cutoff)))
  .input('movement_start',request.periodStart?String(instant(request.periodStart)):null)
  .input('movement_after',request.after?String(instant(request.after.effectiveAt)):null)
  .input('movement_after_id',request.after?.id??null).input('movement_take',request.limit+1).query(`
   IF NOT EXISTS(SELECT 1 FROM dbo.stock_history_openings o WITH(HOLDLOCK,NOWAIT)
    WHERE o.store_id=@movement_branch AND CONVERT(varbinary(max),o.store_id)=CONVERT(varbinary(max),@movement_branch)
     AND o.baseline_id=@movement_baseline AND o.product_id=@movement_product)
   BEGIN SELECT N'product' issue; RETURN; END;
   IF @movement_after_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dbo.stock_history_movements m WITH(HOLDLOCK,NOWAIT)
    WHERE m.id=@movement_after_id AND m.product_id=@movement_product AND m.store_id=@movement_branch
     AND CONVERT(varbinary(max),m.store_id)=CONVERT(varbinary(max),@movement_branch)
     AND m.effective_ticks=CONVERT(decimal(20,0),@movement_after)
     AND m.effective_ticks>CONVERT(decimal(20,0),@movement_baseline_ticks)
     AND (@movement_start IS NULL OR m.effective_ticks>=CONVERT(decimal(20,0),@movement_start))
     AND m.effective_ticks<=CONVERT(decimal(20,0),@movement_cutoff) AND m.ingested_cursor<=@movement_cursor)
   BEGIN SELECT N'cursor' issue; RETURN; END;
   SELECT TOP (@movement_take) LOWER(CONVERT(varchar(36),m.id)) id,m.effective_at_raw effectiveAt,
    m.recorded_at_raw recordedAt,m.source_kind kind,CONVERT(varchar(40),m.quantity_delta) delta
   FROM dbo.stock_history_movements m WITH(HOLDLOCK,NOWAIT)
   WHERE m.store_id=@movement_branch AND CONVERT(varbinary(max),m.store_id)=CONVERT(varbinary(max),@movement_branch)
    AND m.product_id=@movement_product AND m.effective_ticks>CONVERT(decimal(20,0),@movement_baseline_ticks)
    AND (@movement_start IS NULL OR m.effective_ticks>=CONVERT(decimal(20,0),@movement_start))
    AND m.effective_ticks<=CONVERT(decimal(20,0),@movement_cutoff) AND m.ingested_cursor<=@movement_cursor
    AND (@movement_after_id IS NULL OR m.effective_ticks>CONVERT(decimal(20,0),@movement_after)
     OR (m.effective_ticks=CONVERT(decimal(20,0),@movement_after) AND
      LOWER(CONVERT(varchar(36),m.id)) COLLATE Latin1_General_100_BIN2>CONVERT(varchar(36),@movement_after_id) COLLATE Latin1_General_100_BIN2))
   ORDER BY m.effective_ticks,LOWER(CONVERT(varchar(36),m.id)) COLLATE Latin1_General_100_BIN2;
  `);
 const records=result.recordset;
 if(!Array.isArray(records)||records.length>request.limit+1)fail();
 if(records[0]?.issue==='product')fail('PERMISSION_DENIED');
 if(records[0]?.issue==='cursor')fail('ESTOCK_HISTORY_MOVEMENT_CURSOR_INVALID');
 const rows=records.slice(0,request.limit).map(row=>({id:identifier(row.id,true),effectiveAt:canonicalInstant(row.effectiveAt),
  recordedAt:canonicalInstant(row.recordedAt),kind:row.kind,delta:row.delta}));
 const last=rows.at(-1);
 return {rows,next:records.length>request.limit?{effectiveAt:last.effectiveAt,id:last.id}:null};
}

module.exports={movementRequest,movementPage,readVerifiedMovements};
