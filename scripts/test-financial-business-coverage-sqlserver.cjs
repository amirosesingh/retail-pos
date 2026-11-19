// Isolated transport-capsule tests. No operator profile, cloud URL or real data.
const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const{readFileSync}=require('node:fs'),{resolve}=require('node:path');
const{createLocal}=require('./lib/shift-protocol-integration-fixture.cjs');
const{ChangeReader}=require('../electron/sync/change-reader.cjs');
async function main(){
 assert.deepEqual(process.argv.slice(2),['--run']);const local=await createLocal('A',{extraTables:['stock_delta_applied']}),{manager,registry,insert}=local;
 const terminal=randomUUID(),id=randomUUID(),table=registry.tables.find(t=>t.cloudTable==='sales');let sourceValid=true,passed=0;
 const source={identity:Object.freeze({branchId:'A',terminalId:terminal,databaseGuid:randomUUID(),projectOrigin:'https://fixture.test',backend:'https://fixture-pos.test',activation:'fixture-binding',profile:'fixture-profile'}),assertSource(){assert(sourceValid,'source changed');}};
 const reader=new ChangeReader(manager,registry,{financialOperations:{enabled:true,schema:async()=>{}},financialCoverageSource:source});
 const changes=[{key:{id},operation:'U',version:1}],rows=()=>reader.rows(table,changes,{branchId:'A'}),covered=()=>reader.acceptedFinancialBusinessChanges(table,changes,'A',terminal);
 const prepare=async()=>{const operations=[{table:'sales',rows:await rows(),changes:[],dependencyOrder:1}],batchId=randomUUID(),token=reader.prepareFinancialBusinessCoverage({operations,batchId,branchId:'A',terminalId:terminal});return{operations,batchId,token,branchId:'A',terminalId:terminal};};
 const acknowledge=value=>reader.acknowledgeFinancialBusinessRows({...value,acknowledgement:{ok:true,batch_id:value.batchId}});
 const test=async(name,run)=>{await run();passed++;console.log('PASS '+name);};
 try{
  await manager.pool.request().batch(readFileSync(resolve(__dirname,'preparation/026_shift_financial_operations.sql'),'utf8'));
  await insert('sales',{id,bill_number:'CAPSULE',store_id:'A',total_amount:'10.005',subtotal_amount:'10.005',payment_type:'cash',payments:'[]',created_at:'2026-11-04T01:02:03.1234567Z'});
  await test('unchanged exact physical row is covered only after matching captured batch acknowledgement',async()=>{assert.equal((await covered()).size,0);const value=await prepare();assert.equal((await covered()).size,0);await acknowledge(value);assert((await covered()).has(id));});
  await test('nonfinancial persisted changes and deletes remain uncovered',async()=>{await manager.pool.request().input('id',id).query("UPDATE sales SET cashier_name=N'new name' WHERE id=@id;");assert.equal((await covered()).size,0);assert.equal((await reader.acceptedFinancialBusinessChanges(table,[{key:{id},operation:'D'}],'A',terminal)).size,0);});
  await test('late submillisecond SQL timestamp edit cannot inherit a colliding TDS wire receipt',async()=>{const value=await prepare(),wire=JSON.stringify(value.operations[0].rows[0]);await manager.pool.request().input('id',id).query("UPDATE sales SET created_at='2026-11-04T01:02:03.1234568Z' WHERE id=@id;");assert.equal(JSON.stringify((await rows())[0]),wire);await acknowledge(value);assert.equal((await covered()).size,0);});
  await test('large and below-Number-precision SQL decimal edits remain uncovered after an old ACK',async()=>{await manager.pool.request().input('id',id).query('UPDATE sales SET total_amount=9007199254740993.000000000001 WHERE id=@id;');const value=await prepare(),wire=JSON.stringify(value.operations[0].rows[0]);await manager.pool.request().input('id',id).query('UPDATE sales SET total_amount=9007199254740993.000000000002 WHERE id=@id;');assert.equal(JSON.stringify((await rows())[0]),wire);await acknowledge(value);assert.equal((await covered()).size,0);});
  await test('fabricated token, changed payload, mismatched ACK and source change cannot create coverage',async()=>{const value=await prepare();await assert.rejects(acknowledge({...value,token:{}}),/exact captured batch/);await assert.rejects(acknowledge({...value,operations:[...value.operations,{table:'sales',rows:[]}]}),/exact captured batch/);await assert.rejects(reader.acknowledgeFinancialBusinessRows({...value,acknowledgement:{ok:true,batch_id:randomUUID()}}),/exact captured batch/);sourceValid=false;await assert.rejects(acknowledge(value),/source changed/);sourceValid=true;});
  await test('coverage receipts survive restart without touching pending journals or checkpoints',async()=>{const value=await prepare();await acknowledge(value);const before=(await manager.pool.request().query('SELECT count(*) journal_count FROM sync_change_journal;SELECT sum(change_tracking_version) checkpoint_total FROM sync_checkpoints;')).recordsets;await local.restart();const restarted=new ChangeReader(manager,registry,{financialOperations:{enabled:true,schema:async()=>{}},financialCoverageSource:source});assert((await restarted.acceptedFinancialBusinessChanges(table,changes,'A',terminal)).has(id));assert.deepEqual((await manager.pool.request().query('SELECT count(*) journal_count FROM sync_change_journal;SELECT sum(change_tracking_version) checkpoint_total FROM sync_checkpoints;')).recordsets,before);});
  await test('opt-in protected wire preserves SQL decimals, timestamp precision and nested numeric tokens',async()=>{
    await manager.pool.request().input('id',id).query("UPDATE sales SET total_amount=9007199254740993.010000000001,created_at='2026-11-04T01:02:03.1234567Z',payments=N'[{\"method\":\"cash\",\"amount\":9007199254740993.010000000001,\"extra\":9007199254740993}]' WHERE id=@id;");
    const legacy=(await rows())[0],protectedRow=(await reader.rows(table,changes,{branchId:'A',exactFinancial:true}))[0];
    assert.equal(typeof legacy.total_amount,'number');assert.equal(protectedRow.total_amount,'9007199254740993.010000000001');assert.match(protectedRow.created_at,/1234567/);
    const raw=JSON.stringify(require('../electron/sync/uuid-payload.cjs').normalizeSyncPayload(protectedRow));assert(raw.includes('"amount":9007199254740993.010000000001'));assert(raw.includes('"extra":9007199254740993'));assert(!raw.includes('rawJSON'));
    const operations=[{table:'sales',rows:[protectedRow],changes:[]}],batchId=randomUUID(),token=reader.prepareFinancialBusinessCoverage({operations,batchId,branchId:'A',terminalId:terminal});await acknowledge({operations,batchId,token,branchId:'A',terminalId:terminal});assert((await covered()).has(id));
  });
  await test('120-row accepted CT window uses bounded batched PK receipt lookups',async()=>{
    const ids=Array.from({length:120},()=>randomUUID());await manager.pool.request().input('ids',JSON.stringify(ids)).query("INSERT sales(id,bill_number,store_id,total_amount,subtotal_amount,payment_type,payments) SELECT CONVERT(uniqueidentifier,value),N'BATCH-COVERAGE',N'A',1,1,N'cash',N'[]' FROM OPENJSON(@ids);");
    const window=ids.map(id=>({key:{id},operation:'U'})),operations=[{table:'sales',rows:await reader.rows(table,window,{branchId:'A'}),changes:[]}],batchId=randomUUID(),token=reader.prepareFinancialBusinessCoverage({operations,batchId,branchId:'A',terminalId:terminal});
    const original=reader.financialCoverageReceipts.bind(reader);let lookups=0;reader.financialCoverageReceipts=(...args)=>{lookups++;return original(...args);};
    await acknowledge({operations,batchId,token,branchId:'A',terminalId:terminal});assert.equal(lookups,2);lookups=0;assert.equal((await reader.acceptedFinancialBusinessChanges(table,window,'A',terminal)).size,120);assert.equal(lookups,2);
  });
  const movement=randomUUID(),operation=randomUUID(),shift=randomUUID(),stock=registry.tables.find(t=>t.cloudTable==='stock_delta_applied');
  const stockChanges=[{key:{movement_id:movement},operation:'I',version:1}];
  await insert('stock_delta_applied',{movement_id:movement,product_id:randomUUID(),store_id:'A',delta:2,applied_at:'2026-11-18T00:00:00.1234567Z'});
  // Synthetic immutable event is a SQL-query fixture, not a forged Main proof
  // or a hosted acceptance adapter. No business writer consumes this event.
  await manager.pool.request().input('operation',operation).input('shift',shift).input('terminal',terminal).query(`
    INSERT dbo.pos_sync_shift_financial_events(branch_id,shift_id,terminal_id,sequence,operation_id,event_kind,action,predecessor_hash,payload_json,payload_hash,proof_json)
      VALUES(N'A',@shift,@terminal,1,@operation,'MUTATION','REFUND',REPLICATE('0',64),N'{}',REPLICATE('1',64),N'{}');`);
  await manager.pool.request().input('operation',operation).input('entity',JSON.stringify({movement_id:movement})).query(`
    INSERT dbo.sync_change_journal(entity_type,entity_id,operation,branch_id,entity_version,aggregate_id)
      VALUES(N'stock_delta_applied',@entity,N'insert',N'A',1,@operation);`);
  await test('pending financial movement ownership is branch, terminal and actual primary-key bound',async()=>{
    assert.equal(await reader.financialBusinessPending(stock,stockChanges,'A',terminal),true);
    assert.equal(await reader.financialBusinessPending(stock,stockChanges,'B',terminal),false);
    assert.equal(await reader.financialBusinessPending(stock,stockChanges,'A',randomUUID()),false);
    assert.equal(await reader.financialBusinessPending(stock,[{key:{movement_id:randomUUID()},operation:'I'}],'A',terminal),false);
    assert.equal(await reader.financialBusinessPending(stock,[{key:{id:movement},operation:'I'}],'A',terminal),false);
  });
  await test('pending movement is refused by the ordinary snapshot but captured by the protected financial route',async()=>{
    await assert.rejects(reader.rows(stock,stockChanges,{branchId:'A'}),error=>error.code==='EFINANCIAL_BUSINESS_PENDING');
    const rows=await reader.rows(stock,stockChanges,{branchId:'A',exactFinancial:true});assert.equal(rows.length,1);assert.equal(rows[0].movement_id,movement);assert.equal(Number(rows[0].delta),2);
    assert.equal((await reader.acceptedFinancialBusinessChanges(stock,stockChanges,'A',terminal)).size,0);
  });
  await test('an ambiguous business ACK retains movement journal and CT; only its exact accepted batch can create coverage',async()=>{
    const operations=[{table:'stock_delta_applied',rows:await reader.rows(stock,stockChanges,{branchId:'A',exactFinancial:true}),changes:[]}],batchId=randomUUID();
    const token=reader.prepareFinancialBusinessCoverage({operations,batchId,branchId:'A',terminalId:terminal}),value={operations,batchId,token,branchId:'A',terminalId:terminal};
    await assert.rejects(reader.acknowledgeFinancialBusinessRows({...value,acknowledgement:{ok:true,batch_id:randomUUID()}}),/exact captured batch/);
    assert.equal(await reader.financialBusinessPending(stock,stockChanges,'A',terminal),true);
    assert.equal((await reader.acceptedFinancialBusinessChanges(stock,stockChanges,'A',terminal)).size,0);
    await acknowledge(value);assert((await reader.acceptedFinancialBusinessChanges(stock,stockChanges,'A',terminal)).has(movement));
    // A local transport receipt alone does not acknowledge the durable group.
    assert.equal(await reader.financialBusinessPending(stock,stockChanges,'A',terminal),true);
    await reader.acknowledgeAggregate(operation);
    assert.equal(await reader.financialBusinessPending(stock,stockChanges,'A',terminal),false);
    await local.restart();const restarted=new ChangeReader(manager,registry,{financialOperations:{enabled:true,schema:async()=>{}},financialCoverageSource:source});
    assert((await restarted.acceptedFinancialBusinessChanges(stock,stockChanges,'A',terminal)).has(movement));
    assert.equal((await restarted.acceptedFinancialBusinessChanges(stock,[{key:{movement_id:movement},operation:'D'}],'A',terminal)).size,0);
  });
  await test('a serializable ordinary capture cannot absorb a concurrent pending financial update',async()=>{
    const original=reader.financialBusinessPending.bind(reader);let writer,started=false;
    reader.financialBusinessPending=async(...args)=>{
      if(args[4]&&!started){started=true;writer=manager.pool.request().input('operation',operation).input('entity',JSON.stringify({movement_id:movement})).input('movement',movement).query(`
        BEGIN TRANSACTION; UPDATE dbo.stock_delta_applied SET delta=3 WHERE movement_id=@movement;
        INSERT dbo.sync_change_journal(entity_type,entity_id,operation,branch_id,entity_version,aggregate_id)
          VALUES(N'stock_delta_applied',@entity,N'update',N'A',2,@operation); COMMIT;`);}
      return original(...args);
    };
    try{
      const rows=await reader.rows(stock,stockChanges,{branchId:'A'});assert.equal(Number(rows[0].delta),2);await writer;
      await assert.rejects(reader.rows(stock,stockChanges,{branchId:'A'}),error=>error.code==='EFINANCIAL_BUSINESS_PENDING');
      assert.equal((await reader.acceptedFinancialBusinessChanges(stock,stockChanges,'A',terminal)).size,0);
    }finally{reader.financialBusinessPending=original;await writer;}
  });
  console.log(passed+' actual isolated SQL Server financial row-capsule groups passed; transport ACK is a test adapter.');
 }finally{await local.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
