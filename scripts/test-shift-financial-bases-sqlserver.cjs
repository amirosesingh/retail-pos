// Opt-in owned fixture only. Never accepts server/database/connection arguments.
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {readFileSync}=require('node:fs');
const {createLocal,createAuthorKeys}=require('./lib/shift-protocol-integration-fixture.cjs');
const {ShiftFinancialBases}=require('../electron/db/shift-financial-bases.cjs');
const {ShiftSyncJournal}=require('../electron/db/shift-sync-journal.cjs');
const {ShiftAuthorAuthority}=require('../electron/shift-authority.cjs');
async function main(){
 assert.deepEqual(process.argv.slice(2),['--run']);
 const branch='financial-fixture',local=await createLocal(branch),vault=createAuthorKeys();let passed=0;
 const {manager,repository}=local,sql=manager.sql(),terminal=randomUUID(),authorId=randomUUID();
 const test=async(name,fn)=>{await fn();passed++;console.log('PASS '+name);};
 const authority=new ShiftAuthorAuthority({keys:vault.keys,connectionManager:manager,session:{identity:()=>({source:'pos',authorId,canonicalSubject:'cashier',branchId:branch}),epoch:()=>1,hasPermission:()=>true},terminal:()=>({tokenId:terminal,deviceUse:'operations',branchId:branch}),project:()=> 'https://fixture.supabase.co',branch:()=>branch});
 const writer=new ShiftSyncJournal(repository),baseline=randomUUID();let baselineAvailable=true,resolverCalls=0;
 const store=new ShiftFinancialBases(manager,{enabled:true,resolveBaseline:async()=>{resolverCalls++;return baselineAvailable?{serverBasisId:baseline,versionReferences:[]}:null;}});
 const insert=async(tx,table,row)=>{const req=new sql.Request(tx);Object.entries(row).forEach(([k,v],i)=>req.input('v'+i,v));await req.query(`INSERT dbo.[${table}](${Object.keys(row).map(k=>'['+k+']').join(',')}) VALUES(${Object.keys(row).map((_,i)=>'@v'+i).join(',')});`);};
 const seed=async()=>{const shift=randomUUID();await local.insert('shifts',{id:shift,store_id:branch,status:'OPEN',state:'CASH_COUNT_REQUIRED',opening_float:20,opened_at:'2026-11-01T00:00:00Z',row_version:1});await local.insert('sales',{id:randomUUID(),store_id:branch,shift_id:shift,total_amount:100,payment_type:'cash',is_refunded:false,row_version:1});return shift;};
 const close=async({rollback=false,clone=false}={})=>{
  const shift=await seed(),count=randomUUID(),recon=randomUUID(),intent=randomUUID(),author=await authority.prepare(authority.capture('ORIGINAL'));
  const tx=new sql.Transaction(manager.pool);await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  try{
   const context=await writer.intents.context(tx,branch,shift),capture=await store.capture(tx,{branchId:branch,shiftId:shift,countId:count});assert.equal(capture.expected.cash,'120.00');
   const facts={counted_cash:120,counted_card:null,counted_digital:null,expected_cash:120,expected_card:0,expected_digital:0,variance_cash:0,variance_card:null,variance_digital:null,variance_total:0,variance_status:'NO_VARIANCE'};
   await insert(tx,'shift_cash_counts',{id:count,shift_id:shift,store_id:branch,kind:'ORIGINAL',counted_cash:120,counted_card:null,counted_digital:null,counted_by_name:'cashier',counted_by_staff_id:'cashier'});
   await insert(tx,'shift_reconciliations',{id:recon,count_id:count,shift_id:shift,store_id:branch,...facts});
   const req=new sql.Request(tx).input('shift',shift);for(const[k,v]of Object.entries(facts))req.input(k,v);
   await req.query(`UPDATE dbo.shifts SET status=N'CLOSED',state=N'CLOSED',closed_at='2026-11-01T12:00:00Z',final_counted_cash=120,${Object.keys(facts).map(k=>'['+k+']=@'+k).join(',')} WHERE id=@shift;`);
   const graph=await writer.snapshot(tx,branch,shift,[{table:'shift_cash_counts',rows:[{id:count}]},{table:'shift_reconciliations',rows:[{id:recon}]}]);
   const frozen=await writer.intents.freeze(tx,intent,'ORIGINAL',graph,context);
   await author.save(tx,author.sign({branchId:branch,shiftId:shift,intentId:intent,action:'ORIGINAL',payloadHash:frozen.payloadHash}));
   if(clone){await assert.rejects(store.save(tx,{...capture},{intentId:intent,graphPayloadHash:frozen.payloadHash,countId:count,author}),{code:'EFINANCIAL_CAPTURE_INVALID'});await tx.rollback();return;}
   const result=await store.save(tx,capture,{intentId:intent,graphPayloadHash:frozen.payloadHash,countId:count,author});
   const again=await store.save(tx,capture,{intentId:intent,graphPayloadHash:frozen.payloadHash,countId:count,author});assert.deepEqual(again,result);
   if(rollback){await tx.rollback();assert.equal((await manager.pool.request().input('id',intent).query('SELECT intent_id FROM dbo.pos_sync_shift_financial_bases WHERE intent_id=@id')).recordset.length,0);assert.equal((await manager.pool.request().input('id',count).query('SELECT id FROM dbo.shift_cash_counts WHERE id=@id')).recordset.length,0);await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);await assert.rejects(store.save(tx,capture,{intentId:intent,graphPayloadHash:frozen.payloadHash,countId:count,author}),{code:'EFINANCIAL_CAPTURE_INVALID'});await tx.rollback();return;}
   await tx.commit();return{intent,shift,count,result};
  }catch(error){await tx.rollback().catch(()=>{});throw error;}
 };
 const closeViaJournal=async(expected='120.00')=>{
  const shift=await seed(),count=randomUUID(),recon=randomUUID(),author=await authority.prepare(authority.capture('ORIGINAL'));
  const journal=new ShiftSyncJournal(repository,{authorRequired:true,financialBases:store});
  const observation=await journal.observe(branch,shift);
  const facts={counted_cash:'120.00',counted_card:null,counted_digital:null,expected_cash:expected,expected_card:'0.00',expected_digital:'0.00',variance_cash:'0.00',variance_card:null,variance_digital:null,variance_total:'0.00',variance_status:'NO_VARIANCE'};
  const ops=[{kind:'insert',table:'shift_cash_counts',rows:[{id:count,shift_id:shift,store_id:branch,kind:'ORIGINAL',counted_cash:'120.00',counted_card:null,counted_digital:null,counted_by_name:'cashier',counted_by_staff_id:'cashier'}]},
   {kind:'insert',table:'shift_reconciliations',rows:[{id:recon,count_id:count,shift_id:shift,store_id:branch,...facts}]},
   {kind:'update',table:'shifts',match:{id:shift},values:{store_id:branch,status:'CLOSED',state:'CLOSED',closed_at:'2026-11-01T12:00:00Z',final_counted_cash:'120.00',...facts}}];
  const run=()=>journal.apply('financial fixture',ops,{branchId:branch,observation,author});
  if(expected!=='120.00'){await assert.rejects(run(),{code:'ESHIFT_FINANCIAL_CONFLICT'});assert.equal((await manager.pool.request().input('id',count).query('SELECT id FROM dbo.shift_cash_counts WHERE id=@id;')).recordset.length,0);return;}
  await run();const row=(await manager.pool.request().input('shift',shift).query('SELECT intent_id FROM dbo.pos_sync_shift_intents WHERE shift_id=@shift;')).recordset[0];assert(row);const result=await store.get(String(row.intent_id).toLowerCase(),branch);assert.equal(result.status,'ready');assert(result.shiftFinancialBasis.basisJson);const intent=(await journal.intents.get(String(row.intent_id).toLowerCase(),branch));const parent=intent.operations.find(op=>op.table==='shifts').rows[0];assert.equal(require('../electron/sync/shift-financial-math.cjs').canonicalExactCents(parent.expected_cash),'120.00');assert.equal(typeof parent.expected_cash,'string');
 };
 try{
  await test('disabled class performs no SQL or baseline work',async()=>{const disabled=new ShiftFinancialBases(null);assert.equal(await disabled.capture(null,{}),null);assert.equal(await disabled.get('bad','bad'),null);assert.equal(await disabled.save(null,null),null);});
  await test('enabled missing schema fails closed without installation',async()=>{await assert.rejects(store.schema(null),{code:'EFINANCIAL_SCHEMA_PENDING'});});
  await manager.pool.request().batch(readFileSync(require.resolve('./preparation/025_shift_financial_bases.sql'),'utf8'));
  await test('optional journal captures and persists exact SQL decimal strings with original author',async()=>{await closeViaJournal();});
  await test('optional journal rejects stale exact draft before any financial writes',async()=>{await closeViaJournal('119.99');});
  let ready;
  await test('actual signed intent, basis and companion commit atomically and survive new reader',async()=>{ready=await close();assert.equal(ready.result.status,'ready');assert.deepEqual(await new ShiftFinancialBases(manager,{enabled:true}).get(ready.intent,branch),ready.result);});
  await test('missing baseline retains local closing and required pending marker without later re-sign',async()=>{baselineAvailable=false;const pending=await close();assert.equal(pending.result.status,'pending');baselineAvailable=true;const before=resolverCalls;assert.deepEqual(await store.get(pending.intent,branch),pending.result);assert.equal(resolverCalls,before);});
  await test('post-save rollback removes closing, intent and both metadata records; transaction reuse denied',async()=>{await close({rollback:true});});
  await test('caller-constructed capture rejected',async()=>{await close({clone:true});});
  await test('legacy intent without marker remains legacy',async()=>{assert.equal(await store.get(randomUUID(),branch),null);});
  await test('wrong branch fails closed',async()=>{await assert.rejects(store.get(ready.intent,'other'),{code:'EFINANCIAL_BASIS_TAMPERED'});});
  await test('historical receipt is not repriced against later parent totals',async()=>{await manager.pool.request().input('id',ready.shift).query('UPDATE dbo.shifts SET expected_cash=125 WHERE id=@id;');assert.deepEqual(await store.get(ready.intent,branch),ready.result);});
  await test('saved historical count divergence fails closed',async()=>{await manager.pool.request().input('id',ready.count).query('UPDATE dbo.shift_cash_counts SET counted_cash=121 WHERE id=@id;');await assert.rejects(store.get(ready.intent,branch),{code:'EFINANCIAL_BASIS_TAMPERED'});await manager.pool.request().input('id',ready.count).query('UPDATE dbo.shift_cash_counts SET counted_cash=120 WHERE id=@id;');});
  await test('companion signature tampering fails closed without replacing the original',async()=>{const before=(await manager.pool.request().input('id',ready.intent).query('SELECT proof_json FROM dbo.pos_sync_shift_financial_proofs WHERE intent_id=@id;')).recordset[0].proof_json;const proof=JSON.parse(before);proof.signature='A'.repeat(86);await manager.pool.request().batch('DISABLE TRIGGER dbo.pos_sync_shift_financial_proofs_immutable ON dbo.pos_sync_shift_financial_proofs;');await manager.pool.request().input('id',ready.intent).input('proof',JSON.stringify(proof)).query('UPDATE dbo.pos_sync_shift_financial_proofs SET proof_json=@proof WHERE intent_id=@id;');await manager.pool.request().batch('ENABLE TRIGGER dbo.pos_sync_shift_financial_proofs_immutable ON dbo.pos_sync_shift_financial_proofs;');await assert.rejects(store.get(ready.intent,branch));await manager.pool.request().batch('DISABLE TRIGGER dbo.pos_sync_shift_financial_proofs_immutable ON dbo.pos_sync_shift_financial_proofs;');await manager.pool.request().input('id',ready.intent).input('proof',before).query('UPDATE dbo.pos_sync_shift_financial_proofs SET proof_json=@proof WHERE intent_id=@id;');await manager.pool.request().batch('ENABLE TRIGGER dbo.pos_sync_shift_financial_proofs_immutable ON dbo.pos_sync_shift_financial_proofs;');assert.deepEqual(await store.get(ready.intent,branch),ready.result);});
  await test('immutable metadata prevents proof and basis rewrites',async()=>{for(const table of['pos_sync_shift_financial_bases','pos_sync_shift_financial_proofs'])await assert.rejects(manager.pool.request().input('id',ready.intent).query(`DELETE dbo.${table} WHERE intent_id=@id;`));});
  await test('missing proof retains required hold, never legacy downgrade',async()=>{await manager.pool.request().batch('DISABLE TRIGGER dbo.pos_sync_shift_financial_proofs_immutable ON dbo.pos_sync_shift_financial_proofs;');await manager.pool.request().input('id',ready.intent).query('DELETE dbo.pos_sync_shift_financial_proofs WHERE intent_id=@id;');await manager.pool.request().batch('ENABLE TRIGGER dbo.pos_sync_shift_financial_proofs_immutable ON dbo.pos_sync_shift_financial_proofs;');const got=await store.get(ready.intent,branch);assert.equal(got.financialRequired,true);assert.equal(got.status,'pending');});
  await test('unknown metadata shape rejected without repair',async()=>{await manager.pool.request().batch('ALTER TABLE dbo.pos_sync_shift_financial_proofs ADD unknown_fixture int NULL;');await assert.rejects(store.get(ready.intent,branch),{code:'EFINANCIAL_SCHEMA_INVALID'});});
  console.log(`PASS ${passed} owned LocalDB financial persistence groups`);
 }finally{vault.close();await local.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
