const {randomUUID}=require('node:crypto');
const contract=require('./stock-history-contract.cjs');
const shape=require('./stock-history-schema.json');
const schemaObjects=require('./stock-history-schema-objects.json');
const {catalogSql,physicalObjects}=require('./stock-history-schema-check.cjs');
const CAPABILITIES=new WeakMap();
const CAPTURES=new WeakMap();
const readPageSql=require('node:fs').readFileSync(require('node:path').join(__dirname,'stock-history-page.sql'),'utf8');
const tableList=contract.TABLES.map(name=>`N'${name}'`).join(',');
const unavailable=(reason)=>Object.freeze({available:false,reason});
const columnKey=row=>JSON.stringify([row.table,row.column,row.type,Number(row.length),Number(row.precision),Number(row.scale),!!row.nullable]);
const expected=shape.columns.map(columnKey).sort();
const SOURCE_TABLES={item_activity_logs:{id:'id',delta:'quantity_delta'},stock_adjustments:{id:'id',delta:'delta'},stock_delta_applied:{id:'movement_id',delta:'delta'}};
function physicalShape(rows){return rows.map(columnKey).sort().join('\n')===expected.join('\n');}
function productsIn(operations){
  const ids=new Set(),refs=[];let unbounded=false;
  for(const op of operations??[]){
    if(SOURCE_TABLES[op.table]&&['insert','upsert'].includes(op.kind)){
      for(const row of op.rows??(op.values?[op.values]:[])){
        try{ids.add(contract.identifier(row.product_id,true));refs.push({table:op.table,id:contract.identifier(row[SOURCE_TABLES[op.table].id],true)});}catch{unbounded=true;}
      }
    }
    if(op.table!=='products')continue;
    const rows=op.rows??(op.values?[op.values]:[]);
    const stockWrite=['insert','upsert','delete'].includes(op.kind)||Object.hasOwn(op.values??{},'stock_by_store')||Object.hasOwn(op.values??{},'stock_quantity');
    if(!stockWrite)continue;
    const candidates=['insert','upsert'].includes(op.kind)?rows:[op.match??{}];
    for(const row of candidates){
      try{ids.add(contract.identifier(row.id,true));}catch{unbounded=true;}
    }
  }
  if(ids.size>2000)contract.fail('ESTOCK_HISTORY_OVERSIZED');
  return {ids:[...ids].sort(),unbounded,...(refs.length?{refs}: {})};
}
class StockHistoryStore{
 constructor(manager,{assertCurrent=()=>{},authorizeRead=null,readContext=null}={}){
  this.manager=manager;this.assertCurrent=assertCurrent;this.authorizeRead=authorizeRead;this.readContext=readContext;
 }
 request(tx){return new(this.manager.sql().Request)(tx);}
 invalidateCapability(){if(this.manager.pool)CAPABILITIES.delete(this.manager.pool);}
 async identity(tx){
  const row=(await this.request(tx).query(`SELECT CONVERT(nvarchar(36),database_guid) database_guid,
   CONCAT(COALESCE((SELECT MAX(version) FROM dbo.pos_schema_migrations),0),N':',
    COALESCE((SELECT CONVERT(nvarchar(40),MAX(modify_date),127) FROM sys.objects WHERE schema_id=SCHEMA_ID(N'dbo')
     AND (name IN(${tableList}) OR parent_object_id IN(SELECT object_id FROM sys.tables WHERE schema_id=SCHEMA_ID(N'dbo') AND name IN(${tableList})))),N'absent')) schema_generation
   FROM sys.database_recovery_status WHERE database_id=DB_ID();`)).recordset?.[0];
  if(!row?.database_guid)contract.fail('ESTOCK_HISTORY_DATABASE_UNVERIFIED');
  return `${contract.identifier(row.database_guid,true)}:${String(row.schema_generation)}`;
 }
 async capability(tx){
  const pool=this.manager.pool,identity=await this.identity(tx);this.assertCurrent();
  const prior=CAPABILITIES.get(pool);
  if(prior?.identity===identity)return prior.value;
  const result=await this.request(tx).query(`SELECT t.name [table],c.name [column],ty.name [type],
    c.max_length [length],c.precision [precision],c.scale [scale],c.is_nullable nullable
    FROM sys.tables t JOIN sys.columns c ON c.object_id=t.object_id JOIN sys.types ty ON ty.user_type_id=c.user_type_id
    WHERE t.schema_id=SCHEMA_ID(N'dbo') AND t.name IN(${tableList});`);
  this.assertCurrent();if(this.manager.pool!==pool)contract.fail('ESTOCK_HISTORY_CONTEXT_CHANGED');
  const rows=result.recordset??[],count=new Set(rows.map(row=>row.table)).size;
  let value=count===0?unavailable('SCHEMA_NOT_INSTALLED'):count!==4?unavailable('PARTIAL_SCHEMA'):
    !physicalShape(rows)?unavailable('UNKNOWN_SCHEMA'):null;
  if(value==null){const objects=(await this.request(tx).query(catalogSql)).recordset??[];
   value=physicalObjects(objects,schemaObjects)?Object.freeze({available:true,databaseKey:identity}):unavailable('UNKNOWN_SCHEMA');}
  this.assertCurrent();if(this.manager.pool!==pool)contract.fail('ESTOCK_HISTORY_CONTEXT_CHANGED');
  CAPABILITIES.set(pool,{identity,value});return value;
 }
 async snapshot(tx,ids){
  if(!ids.length)return[];
  const request=this.request(tx);ids.forEach((id,n)=>request.input('stock_product_'+n,id));
  return(await request.query(`SELECT id,name,sku,barcode,owner_store_id,stock_by_store
   FROM dbo.products WITH(UPDLOCK,HOLDLOCK) WHERE id IN(${ids.map((_,n)=>'@stock_product_'+n).join(',')}) ORDER BY id;`)).recordset??[];
 }
 async sources(tx,refs=[]){
  const result=[];
  for(const [table,columns]of Object.entries(SOURCE_TABLES)){
   const ids=[...new Set(refs.filter(ref=>ref.table===table).map(ref=>ref.id))].sort();if(!ids.length)continue;
   const request=this.request(tx);ids.forEach((id,n)=>request.input('source_'+n,id));
   const rows=(await request.query(`SELECT [${columns.id}] id,product_id,store_id,CONVERT(nvarchar(50),[${columns.delta}]) delta
     FROM dbo.[${table}] WITH(UPDLOCK,HOLDLOCK) WHERE [${columns.id}] IN(${ids.map((_,n)=>'@source_'+n).join(',')});`)).recordset??[];
   result.push(...rows.map(row=>({table,id:String(row.id).toLowerCase(),productId:String(row.product_id).toLowerCase(),branchId:row.store_id,delta:row.delta})));
  }
  return result;
 }
 async begin(tx,operations,input){
  const products=productsIn(operations);if(!products.ids.length&&!products.unbounded)return null;
  const capability=await this.capability(tx);if(!capability.available)return null;
  const observed=this.readContext?.(),source=observed?Object.freeze({...observed}):null;
  if(source&&(!source.key||source.branchId!==input.branchId||source.terminalId!==input.terminalId))contract.fail('ESTOCK_HISTORY_CONTEXT_CHANGED');
  const writerKnown=contract.KINDS.has(input.kind);
  const captureInput=Object.freeze({...input,kind:writerKnown?input.kind:'general',...(source?{actorId:source.actorId,clockState:source.clockState}:{})});
  contract.identifier(captureInput.operationId,true);contract.identifier(captureInput.branchId);contract.identifier(captureInput.terminalId);
  if(captureInput.effectiveAt)contract.instant(captureInput.effectiveAt);
  const before=await this.snapshot(tx,products.ids),beforeSources=await this.sources(tx,products.refs);this.assertCurrent();
  if(source&&this.readContext?.()?.key!==source.key)contract.fail('ESTOCK_HISTORY_CONTEXT_CHANGED');
  const token=Object.freeze({});CAPTURES.set(token,{tx,pool:this.manager.pool,databaseKey:capability.databaseKey,input:captureInput,products,before,beforeSources,source,writerKnown});
  return token;
 }
 async invalidateCoverage(tx,branch,reason){
  await this.ensureHead(tx,branch);
  await this.request(tx).input('history_branch',branch).input('history_reason',reason)
   .query(`UPDATE dbo.stock_history_heads SET coverage_state=N'incomplete',coverage_generation=coverage_generation+1,
    updated_at=SYSDATETIMEOFFSET() WHERE store_id=@history_branch;`);
 }
 async ensureHead(tx,branch){
  await this.request(tx).input('history_branch',branch).query(`IF NOT EXISTS(SELECT 1 FROM dbo.stock_history_heads WITH(UPDLOCK,HOLDLOCK) WHERE store_id=@history_branch)
   INSERT dbo.stock_history_heads(store_id) VALUES(@history_branch);`);
 }
 async finish(tx,token){
  if(token==null)return {captured:0,available:false};
  const saved=CAPTURES.get(token);
  if(!saved||saved.tx!==tx||saved.pool!==this.manager.pool)contract.fail('ESTOCK_HISTORY_CONTEXT_CHANGED');
  this.assertCurrent();
  if(saved.source&&this.readContext?.()?.key!==saved.source.key)contract.fail('ESTOCK_HISTORY_CONTEXT_CHANGED');
  const current=await this.identity(tx);if(current!==saved.databaseKey)contract.fail('ESTOCK_HISTORY_CONTEXT_CHANGED');
  const after=await this.snapshot(tx,saved.products.ids),seen=new Set(saved.beforeSources.map(row=>row.table+':'+row.id));
  const claims=(await this.sources(tx,saved.products.refs)).filter(row=>!seen.has(row.table+':'+row.id));
  const clock=(await this.request(tx).query("SELECT CONVERT(nvarchar(40),SYSUTCDATETIME(),127)+N'Z' recorded_at;")).recordset?.[0];
  // Default physical time is measured after the business effects, immediately
  // before durable evidence/commit, not an old invoice date or upload arrival.
  const context=contract.normalizeContext(saved.input,clock?.recorded_at);let rows;
  try{rows=contract.changes(context,saved.before,after,claims);}catch(error){
   if(error.code!=='ESTOCK_HISTORY_STOCK_INVALID'&&error.code!=='ESTOCK_HISTORY_INVALID')throw error;
   await this.invalidateCoverage(tx,context.branchId,'UNVERIFIED_STOCK_SHAPE');
   CAPTURES.delete(token);return {captured:0,available:true,incomplete:true};
  }
  for(const branch of [...new Set(rows.map(row=>row.store_id))].sort()){
   await this.ensureHead(tx,branch);
   await this.insertMovements(tx,branch,rows.filter(row=>row.store_id===branch));
  }
  if(saved.products.unbounded)await this.invalidateCoverage(tx,context.branchId,'UNBOUNDED_STOCK_WRITE');
  if(!saved.writerKnown)await this.invalidateCoverage(tx,context.branchId,'UNVERIFIED_STOCK_WRITER');
  this.assertCurrent();if(saved.source&&this.readContext?.()?.key!==saved.source.key)contract.fail('ESTOCK_HISTORY_CONTEXT_CHANGED');
  CAPTURES.delete(token);return {captured:rows.length,available:true,incomplete:saved.products.unbounded||!saved.writerKnown};
 }
 async insertMovements(tx,branch,rows){
  const payload=JSON.stringify(rows.map(row=>({...row,recorded_ticks:String(contract.instant(row.recorded_at_raw))})));
  if(Buffer.byteLength(payload,'utf8')>6*1024*1024)contract.fail('ESTOCK_HISTORY_OVERSIZED');
  await this.request(tx).input('history_rows',payload).input('history_branch',branch).query(`
   DECLARE @history_candidates table(id uniqueidentifier,operation_id uniqueidentifier,product_id uniqueidentifier,store_id nvarchar(128),terminal_id nvarchar(128),actor_id nvarchar(128),source_kind nvarchar(20),
    quantity_delta decimal(38,0),effective_at_raw nvarchar(28),effective_ticks decimal(20,0),recorded_at_raw nvarchar(28),recorded_ticks decimal(20,0),product_name nvarchar(max),sku nvarchar(max),barcode nvarchar(max),clock_state nvarchar(16),payload_hash char(64),payload_json nvarchar(max));
   INSERT @history_candidates SELECT * FROM OPENJSON(@history_rows) WITH(
    id uniqueidentifier,operation_id uniqueidentifier,product_id uniqueidentifier,store_id nvarchar(128),terminal_id nvarchar(128),actor_id nvarchar(128),source_kind nvarchar(20),
    quantity_delta decimal(38,0),effective_at_raw nvarchar(28),effective_ticks decimal(20,0),recorded_at_raw nvarchar(28),recorded_ticks decimal(20,0),product_name nvarchar(max),sku nvarchar(max),barcode nvarchar(max),clock_state nvarchar(16),payload_hash char(64),payload_json nvarchar(max));
   IF EXISTS(SELECT id FROM @history_candidates GROUP BY id HAVING COUNT(*)<>1) OR EXISTS(SELECT 1 FROM @history_candidates WHERE store_id<>@history_branch)
    THROW 51031,'STOCK_HISTORY_INVALID_BATCH',1;
   IF EXISTS(SELECT 1 FROM @history_candidates r JOIN dbo.stock_history_movements m WITH(UPDLOCK,HOLDLOCK) ON m.id=r.id
    WHERE m.payload_hash<>r.payload_hash OR DATALENGTH(m.payload_json)<>DATALENGTH(r.payload_json)
     OR CONVERT(varbinary(max),m.payload_json)<>CONVERT(varbinary(max),r.payload_json)) THROW 51031,'STOCK_HISTORY_REPLAY_CONFLICT',1;
   DELETE r FROM @history_candidates r WHERE EXISTS(SELECT 1 FROM dbo.stock_history_movements m WITH(UPDLOCK,HOLDLOCK) WHERE m.id=r.id);
   DECLARE @history_count bigint=(SELECT COUNT_BIG(*) FROM @history_candidates);
   DECLARE @history_position table([cursor] bigint);
   IF @history_count>0 BEGIN
   UPDATE dbo.stock_history_heads SET local_committed_cursor=local_committed_cursor+@history_count,updated_at=SYSDATETIMEOFFSET()
    OUTPUT inserted.local_committed_cursor INTO @history_position WHERE store_id=@history_branch;
   DECLARE @history_inserted table(id uniqueidentifier);
   INSERT dbo.stock_history_movements(id,operation_id,product_id,store_id,terminal_id,actor_id,source_kind,quantity_delta,effective_at_raw,effective_ticks,
    recorded_at_raw,recorded_ticks,product_name,sku,barcode,clock_state,payload_hash,payload_json,local_cursor)
    OUTPUT inserted.id INTO @history_inserted
    SELECT id,operation_id,product_id,store_id,terminal_id,actor_id,source_kind,quantity_delta,effective_at_raw,effective_ticks,recorded_at_raw,recorded_ticks,
     product_name,sku,barcode,clock_state,payload_hash,payload_json,(SELECT [cursor] FROM @history_position)-@history_count+ROW_NUMBER() OVER(ORDER BY id) FROM @history_candidates;
   INSERT dbo.sync_change_journal(entity_type,entity_id,operation,branch_id,entity_version,aggregate_id)
    SELECT N'stock_history_movements',CONCAT(N'{"id":"',CONVERT(nvarchar(36),r.id),N'"}'),N'insert',r.store_id,1,r.operation_id
    FROM @history_candidates r JOIN @history_inserted inserted ON inserted.id=r.id;
   UPDATE h SET coverage_state=N'incomplete',coverage_generation=coverage_generation+1 FROM dbo.stock_history_heads h
    JOIN dbo.stock_history_baselines b ON b.id=h.baseline_id AND b.store_id=h.store_id WHERE h.store_id=@history_branch
     AND EXISTS(SELECT 1 FROM @history_candidates r WHERE r.effective_ticks<=b.cutoff_ticks);
   END;
  `);
 }
 async readPage(input={}){
  if(typeof this.authorizeRead!=='function')contract.fail('PERMISSION_DENIED');
  const observedScope=await this.authorizeRead(input.export===true),scope=observedScope?Object.freeze({...observedScope}):null;
  if(!scope?.canViewInventory||typeof scope.contextKey!=='string'||!scope.contextKey||(input.export===true&&!scope.canExportReports))contract.fail('PERMISSION_DENIED');
  const branch=contract.identifier(scope.branchId),pool=this.manager.pool;
  const recheckRead=async()=>{
   const currentScope=await this.authorizeRead(input.export===true);this.assertCurrent();
   if(this.manager.pool!==pool||currentScope?.branchId!==scope.branchId||currentScope?.contextKey!==scope.contextKey||!currentScope.canViewInventory||
     (input.export===true&&!currentScope.canExportReports))contract.fail('ESTOCK_HISTORY_CONTEXT_CHANGED');
  };
  if(input.branchId!=null&&contract.identifier(input.branchId)!==branch)contract.fail('SYNC_BRANCH_FORBIDDEN');
  let cutoff=input.closedShiftId?null:contract.canonicalInstant(input.cutoff);
  const closedShift=input.closedShiftId?contract.identifier(input.closedShiftId,true):null;
  if(closedShift&&scope.canViewShiftHistory!==true)contract.fail('PERMISSION_DENIED');
  const zone=input.timeZone;if(typeof zone!=='string'||zone.length>100)contract.fail();
  try{new Intl.DateTimeFormat('en',{timeZone:zone}).format(0);}catch{contract.fail();}
  const limit=input.limit??100;if(!Number.isInteger(limit)||limit<1||limit>500)contract.fail();
  if(input.sourceRevision!=null&&(typeof input.sourceRevision!=='string'||input.sourceRevision.length>512))contract.fail();
  const after=input.after?contract.identifier(input.after,true):null;
  const sql=this.manager.sql(),tx=new sql.Transaction(pool);await tx.begin(sql.ISOLATION_LEVEL?.SERIALIZABLE);
  try{
   if(closedShift){
    const shift=(await this.request(tx).input('history_shift',closedShift).input('history_branch',branch).query(`
      SELECT CONVERT(nvarchar(40),SWITCHOFFSET(CONVERT(datetimeoffset(7),closed_at),'+00:00'),127) closed_at
      FROM dbo.shifts WITH(HOLDLOCK) WHERE id=CONVERT(uniqueidentifier,@history_shift) AND store_id=@history_branch
       AND closed_at IS NOT NULL AND LOWER(status) IN(N'closed',N'completed');`)).recordset?.[0];
    if(!shift?.closed_at)contract.fail('ESTOCK_HISTORY_SHIFT_UNAVAILABLE');cutoff=contract.canonicalInstant(shift.closed_at);
   }
   const cutoffTicks=String(contract.instant(cutoff));
   const cap=await this.capability(tx);
   if(!cap.available){await recheckRead();await tx.commit();return {status:'unavailable',reasons:[cap.reason],cutoff,timeZone:zone,branchId:branch,rows:[],next:null};}
   const request=this.request(tx).input('history_branch',branch).input('history_ticks',cutoffTicks).input('history_after',after).input('history_limit',limit+1);
   const meta=(await request.query(`SELECT b.id baseline_id,h.coverage_state,CONVERT(nvarchar(30),h.committed_cursor) committed_cursor,
     CONVERT(nvarchar(30),h.local_committed_cursor) local_committed_cursor,CONVERT(nvarchar(30),h.coverage_generation) coverage_generation,
     CONVERT(nvarchar(30),h.coverage_from_ticks) coverage_from_ticks,CONVERT(nvarchar(30),h.coverage_through_ticks) coverage_through_ticks,
     b.cutoff_at_raw,CONVERT(nvarchar(30),b.cutoff_ticks) cutoff_ticks,b.captured_at_raw,CONVERT(nvarchar(30),b.source_cursor) source_cursor,b.expected_pairs,b.verification_state,
     CONVERT(nvarchar(40),SYSUTCDATETIME(),127)+N'Z' read_at,
     (SELECT COUNT_BIG(*) FROM dbo.stock_history_movements m WHERE m.store_id=h.store_id AND m.ingested_cursor IS NULL) pending_count,
     (SELECT COUNT_BIG(*) FROM dbo.stock_history_movements m WHERE m.store_id=h.store_id AND m.ingested_cursor<=h.committed_cursor
      AND m.effective_ticks>b.cutoff_ticks AND m.effective_ticks<=CONVERT(decimal(20,0),@history_ticks) AND m.clock_state<>N'verified') uncertain_count,
     (SELECT COUNT_BIG(*) FROM dbo.stock_history_movements m WHERE m.store_id=h.store_id AND m.ingested_cursor<=h.committed_cursor
      AND m.ingested_cursor>b.source_cursor AND m.effective_ticks<=b.cutoff_ticks) baseline_changed_count,
     (SELECT COUNT_BIG(*) FROM dbo.stock_history_movements m WHERE m.store_id=h.store_id AND m.ingested_cursor<=h.committed_cursor
      AND m.effective_ticks<=CONVERT(decimal(20,0),@history_ticks)
      AND NOT EXISTS(SELECT 1 FROM dbo.stock_history_openings missing WHERE missing.baseline_id=b.id AND missing.store_id=h.store_id AND missing.product_id=m.product_id)) missing_opening_count,
     (SELECT COUNT_BIG(*) FROM dbo.stock_history_openings o WHERE o.store_id=h.store_id AND o.baseline_id=b.id) actual_pairs
     FROM dbo.stock_history_heads h WITH(HOLDLOCK)
     OUTER APPLY(SELECT TOP(1) prior.id FROM dbo.stock_history_baselines prior WITH(HOLDLOCK)
      WHERE prior.store_id=h.store_id AND prior.verification_state=N'verified'
       AND prior.cutoff_ticks<=CONVERT(decimal(20,0),@history_ticks)
      ORDER BY prior.cutoff_ticks DESC,prior.id DESC) eligible
     LEFT JOIN dbo.stock_history_baselines b ON b.id=COALESCE(eligible.id,h.baseline_id) AND b.store_id=h.store_id
     WHERE h.store_id=@history_branch;`)).recordset?.[0];
   const reasons=[];
   if(meta?.read_at&&contract.instant(cutoff)>contract.instant(meta.read_at))reasons.push('FUTURE_CUTOFF');
   if(!meta?.baseline_id||!meta.cutoff_at_raw)reasons.push('NO_VERIFIED_OPENING');
   else{
    if(meta.verification_state!=='verified'||String(meta.expected_pairs)!==String(meta.actual_pairs))reasons.push('UNVERIFIED_OPENING');
    if(contract.instant(cutoff)<contract.instant(meta.cutoff_at_raw))reasons.push('BEFORE_BASELINE');
    if(meta.coverage_state!=='complete'||meta.coverage_from_ticks==null||meta.coverage_through_ticks==null||
      BigInt(String(meta.coverage_from_ticks??0))>BigInt(String(meta.cutoff_ticks??0))||BigInt(String(meta.coverage_through_ticks??0))<BigInt(cutoffTicks))reasons.push('INCOMPLETE_MOVEMENTS');
    if(BigInt(String(meta.pending_count??0))>0n)reasons.push('PENDING_UPLOADS');
    if(BigInt(String(meta.uncertain_count??0))>0n)reasons.push('CLOCK_UNVERIFIED');
    if(BigInt(String(meta.baseline_changed_count??0))>0n)reasons.push('BASELINE_PREHISTORY_CHANGED');
    if(BigInt(String(meta.missing_opening_count??0))>0n)reasons.push('MISSING_OPENING');
   }
   const revision=meta?`${cap.databaseKey}:${branch}:${meta.committed_cursor}:${meta.local_committed_cursor}:${meta.coverage_generation}:${meta.baseline_id??''}`:null;
   if(input.sourceRevision!=null&&input.sourceRevision!==revision)contract.fail('ESTOCK_HISTORY_SOURCE_CHANGED');
   if(reasons.length){await recheckRead();await tx.commit();
    return{status:reasons.some(reason=>['BEFORE_BASELINE','FUTURE_CUTOFF'].includes(reason))?'unsupported':'incomplete',reasons,cutoff,timeZone:zone,branchId:branch,
     baselineAt:meta?.cutoff_at_raw??null,coverageThroughTicks:meta?.coverage_through_ticks==null?null:String(meta.coverage_through_ticks),
     pendingCount:String(meta?.pending_count??0),sourceRevision:revision,rows:[],next:null};}
   request.input('history_baseline',meta.baseline_id).input('history_cursor',String(meta.committed_cursor)).input('history_baseline_ticks',String(meta.cutoff_ticks)).input('history_page_size',limit);
   const result=await request.query(readPageSql),wire=result.recordset?.[0];
   if(!wire||typeof wire.rows_json!=='string'||Buffer.byteLength(wire.rows_json,'utf8')>245760)contract.fail('ESTOCK_HISTORY_OVERSIZED');
   const rows=JSON.parse(wire.rows_json);
   if(!Array.isArray(rows)||rows.length>limit)contract.fail();
   await recheckRead();
   await tx.commit();return{status:'complete',reasons:[],cutoff,timeZone:zone,branchId:branch,baselineAt:meta.cutoff_at_raw,
    readAt:contract.canonicalInstant(meta.read_at),sourceRevision:revision,pendingCount:'0',restatable:true,
    rows,next:wire.next_id?String(wire.next_id).toLowerCase():null};
  }catch(error){await Promise.resolve(tx.rollback()).catch(()=>{});throw error;}
 }
}
module.exports={StockHistoryStore,physicalShape,productsIn,newOperationId:randomUUID};
