'use strict';
// Runs only inside the caller's already-owned disposable LocalDB fixture.
const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const c=require('../electron/db/stock-history-contract.cjs'),{StockHistoryStore}=require('../electron/db/stock-history.cjs');
module.exports=async({pool,sql,pass})=>{
 const branch='Period-A',terminal='period-till',product=randomUUID(),zero=randomUUID(),baseline=randomUUID();
 const initial=9007199254740993n,start='2026-11-05T00:00:00.0000000Z',cutoff='2026-11-05T12:00:00.1234567Z',base='2026-11-04T00:00:00.0000000Z';
 const manager={pool,sql:()=>sql},scope={key:'period-fixture',branchId:branch,terminalId:terminal,actorId:randomUUID(),clockState:'verified'};
 const store=new StockHistoryStore(manager,{readContext:()=>scope,authorizeRead:async()=>({contextKey:'period-fixture',branchId:branch,canViewInventory:true,canExportReports:true})});
 let quantity=initial,cursor=0;
 await pool.request().input('product',product).input('zero',zero).input('stock',JSON.stringify({[branch]:String(initial)})).batch(`
  INSERT dbo.products(id,name,sku,barcode,stock_by_store) VALUES(@product,N'Original archived identity',N'0001',N'0000001',@stock),(@zero,N'Original zero identity',N'0002',N'0000002',N'{"Period-A":"0"}');`);
 async function movement(delta,effectiveAt){
  const operationId=randomUUID(),tx=new sql.Transaction(pool);await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  try{
   const next=quantity+delta,token=await store.begin(tx,[{kind:'update',table:'products',match:{id:product},values:{stock_by_store:{[branch]:String(next)}}}],{operationId,branchId:branch,terminalId:terminal,kind:'stock',effectiveAt});
   await new sql.Request(tx).input('product',product).input('stock',JSON.stringify({[branch]:String(next)})).query('UPDATE dbo.products SET stock_by_store=@stock WHERE id=@product;');
   assert.equal((await store.finish(tx,token)).captured,1);cursor++;
   await new sql.Request(tx).input('operation',operationId).input('cursor',cursor).input('branch',branch).query(`
    UPDATE dbo.stock_history_movements SET ingested_cursor=@cursor,ingested_at=SYSDATETIMEOFFSET() WHERE operation_id=@operation;
    UPDATE dbo.sync_change_journal SET acknowledged_at=SYSDATETIMEOFFSET() WHERE aggregate_id IN(SELECT upload_aggregate_id FROM dbo.stock_history_movements WHERE operation_id=@operation);
    UPDATE dbo.stock_history_heads SET committed_cursor=@cursor,coverage_generation=coverage_generation+1 WHERE store_id=@branch;`);
   await tx.commit();quantity=next;
  }catch(error){await tx.rollback().catch(()=>{});throw error;}
 }
 await movement(3n,c.utc(c.instant(start)-1n));await movement(2n,start);await movement(-1n,cutoff);await movement(-4n,c.utc(c.instant(cutoff)+1n));
 await pool.request().input('branch',branch).input('baseline',baseline).input('product',product).input('zero',zero).input('base',base).input('ticks',String(c.instant(base))).input('through',String(c.instant(cutoff)+1n)).input('initial',String(initial)).batch(`
  INSERT dbo.stock_history_baselines(id,store_id,cutoff_at_raw,cutoff_ticks,captured_at_raw,captured_ticks,source_cursor,opening_kind,verification_state,expected_pairs,terminal_watermarks,verified_by,evidence_hash)
   VALUES(@baseline,@branch,@base,CONVERT(decimal(20,0),@ticks),@base,CONVERT(decimal(20,0),@ticks),0,N'system_snapshot',N'verified',2,N'{"fixture":"isolated"}',N'fixture',REPLICATE('a',64));
  INSERT dbo.stock_history_openings(id,baseline_id,product_id,store_id,quantity,product_name,sku,barcode)
   VALUES(NEWID(),@baseline,@product,@branch,CONVERT(decimal(38,0),@initial),N'Original archived identity',N'0001',N'0000001'),(NEWID(),@baseline,@zero,@branch,0,N'Original zero identity',N'0002',N'0000002');
  UPDATE dbo.stock_history_heads SET baseline_id=@baseline,coverage_state=N'complete',coverage_from_ticks=CONVERT(decimal(20,0),@ticks),coverage_through_ticks=CONVERT(decimal(20,0),@through) WHERE store_id=@branch;`);
 const request={cutoff,timeZone:'UTC',periodStart:start},page=await store.readPage(request),row=page.rows.find(row=>row.productId===product);
 assert.equal(page.status,'complete');assert.equal(page.cutoff,cutoff);assert.deepEqual(page.period,{start,endExclusive:'2026-11-06T00:00:00.0000000Z',through:cutoff,fullDay:false});
 assert.equal(row.openingQuantity,String(initial+3n));assert.equal(row.inQuantity,'2');assert.equal(row.outQuantity,'1');assert.equal(row.quantity,String(initial+4n));
 assert.equal(BigInt(row.openingQuantity)+BigInt(row.inQuantity)-BigInt(row.outQuantity),BigInt(row.quantity));
 assert.equal(page.rows.find(row=>row.productId===zero).quantity,'0');
 const point=await store.readPage({cutoff,timeZone:'UTC'});assert.equal(point.rows.find(row=>row.productId===product).quantity,row.quantity);assert.equal(point.rows[0].openingQuantity,undefined);
 pass('one native snapshot explains exact selected-time stock using signed in/out, zero/archive identities and >2^53 strings; later100ns excluded');
 const first=await store.readPage({...request,limit:1});assert(first.next);const second=await store.readPage({...request,limit:1,after:first.next,sourceRevision:first.sourceRevision});assert.equal(second.next,null);
 await assert.rejects(store.readPage({...request,sourceRevision:point.sourceRevision}),{code:'ESTOCK_HISTORY_SOURCE_CHANGED'});
 await assert.rejects(store.readPage({...request,periodStart:'2026-11-05T01:00:00Z'}),{code:'ESTOCK_HISTORY_PERIOD_INVALID'});
 pass('native period paging binds the same exact interval/revision and refuses a point-read cursor or shifted day start');
 const later=randomUUID(),laterAt='2026-11-05T01:00:00.0000000Z';
 await pool.request().input('later',later).input('baseline',baseline).input('at',laterAt).input('ticks',String(c.instant(laterAt))).batch(`
  INSERT dbo.stock_history_baselines(id,store_id,cutoff_at_raw,cutoff_ticks,captured_at_raw,captured_ticks,source_cursor,opening_kind,verification_state,expected_pairs,terminal_watermarks,verified_by,evidence_hash)
   SELECT @later,store_id,@at,CONVERT(decimal(20,0),@ticks),@at,CONVERT(decimal(20,0),@ticks),2,opening_kind,verification_state,expected_pairs,terminal_watermarks,verified_by,evidence_hash FROM dbo.stock_history_baselines WHERE id=@baseline;
  INSERT dbo.stock_history_openings(id,baseline_id,product_id,store_id,quantity,product_name,sku,barcode)
   SELECT NEWID(),@later,product_id,store_id,quantity,product_name,sku,barcode FROM dbo.stock_history_openings WHERE baseline_id=@baseline;`);
 assert.equal((await store.readPage(request)).baselineAt,base);
 await movement(1n,c.utc(c.instant(cutoff)-1n));
 assert.equal((await store.readPage(request)).rows.find(row=>row.productId===product).quantity,String(initial+5n));
 await assert.rejects(store.readPage({...request,sourceRevision:page.sourceRevision}),{code:'ESTOCK_HISTORY_SOURCE_CHANGED'});
 pass('a newer intraday opening cannot replace the daily opening; late backdated accepted movement restates exact stock and invalidates old pages');
};
