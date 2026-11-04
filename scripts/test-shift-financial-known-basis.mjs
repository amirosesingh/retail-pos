// FIN62 disposable actual-writer fixtures only. Read-only stored-input provenance,
// not operator authority, device-observation proof or action admission.
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import Module from 'node:module';
import {dirname} from 'node:path';
const native=process.argv.slice(2).join(' ')==='--native';
assert(process.argv.length===2||native,'Only --native accepted; no external connection arguments.');
const require=createRequire(import.meta.url),read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');
const helperPath=require.resolve('./lib/shift-protocol-integration-fixture.cjs');
let{createCloud}=require(helperPath),nativeDb;
if(native){
 const source=await read('scripts/test-seven-shift-summary-native.fixture.mjs');
 const concurrent=String.raw`beginFinancialTransaction:async(sql)=>{
  const h=nativeSpawn(nativeJoin(bin,'psql.exe'),args,{env,windowsHide:true,stdio:['pipe','pipe','pipe']});let text='',errors='',ended=false;
  h.stdout.on('data',value=>{text+=value;});h.stderr.on('data',value=>{errors+=value;});
  const closed=new Promise(accept=>h.once('close',accept));
  h.stdin.write("BEGIN;SET LOCAL test.auth_role='service_role';"+sql+"\n\\echo FIN62_WRITE_READY\n");
  const limit=Date.now()+5000;
  while(!text.includes('FIN62_WRITE_READY')){if(Date.now()>limit){h.stdin.end('ROLLBACK;\n\\q\n');await closed;throw Error('Financial transaction timeout: '+errors);}await new Promise(resolve=>setTimeout(resolve,20));}
  if(errors.includes('ERROR:')){h.stdin.end('ROLLBACK;\n\\q\n');await closed;throw Error(errors);}
  return{commit:async()=>{if(ended)return;ended=true;h.stdin.end('COMMIT;\n\\q\n');await closed;if(errors.includes('ERROR:'))throw Error(errors);},rollback:async()=>{if(ended)return;ended=true;h.stdin.end('ROLLBACK;\n\\q\n');await closed;}};
 },`;
 const factory=await import('data:text/javascript;base64,'+Buffer.from(source.replace('close:async()=>{',concurrent+'\nclose:async()=>{')+'\nexport {createNativeFixture};').toString('base64'));
 nativeDb=await factory.createNativeFixture();globalThis.__fin62KnownNativeFixture=nativeDb;
 const fixtureSource=await read('scripts/lib/shift-protocol-integration-fixture.cjs'),anchor="const db = new PGlite(), schema = read('supabase/schema.sql');";assert(fixtureSource.includes(anchor));
 const compiled=new Module(helperPath);compiled.filename=helperPath;compiled.paths=Module._nodeModulePaths(dirname(helperPath));
 compiled._compile(fixtureSource.replace(anchor,"const db = globalThis.__fin62KnownNativeFixture, schema = read('supabase/schema.sql');"),helperPath);createCloud=compiled.exports.createCloud;
}

const terminal=randomUUID(),otherTerminal=randomUUID(),shift=randomUUID(),foreignShift=randomUUID(),sale=randomUUID();
let db;try{db=await createCloud('A',terminal);}catch(error){await nativeDb?.close();throw error;}finally{delete globalThis.__fin62KnownNativeFixture;}let passed=0;
const test=async(name,run)=>{await run();passed++;console.log('PASS '+name);};
const math=async basis=>(await db.query('SELECT fin62_preparation.validate_financial_math_text($1) value',[JSON.stringify(basis)])).rows[0].value.expected;
let original;
const validate=async(basis,refs=[],expected=null,scope={})=>(await db.query('SELECT public.prototype_fin62_verify_known_basis($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb) value',[
 'default',scope.branch??'A',scope.terminal??terminal,scope.baseline??original.basisId,typeof basis==='string'?basis:JSON.stringify(basis),JSON.stringify(refs),JSON.stringify(expected??await math(basis))])).rows[0].value;
const push=row=>db.query('SELECT pos_sync_push_aggregate($1,$2,$3,$4,$5::jsonb)',[randomUUID(),'default',row.store_id,terminal,JSON.stringify([{table:'sales',rows:[row],changes:[],dependencyOrder:1}])]);
const receipt=async(id,operation)=>(await db.query('SELECT id,after_basis,before_basis FROM fin62_version_preparation.sales_versions WHERE sale_id=$1 AND operation=$2 ORDER BY captured_at DESC,id DESC LIMIT 1',[id,operation])).rows[0];
const ref=(id,entry,side='after')=>({saleId:id,receiptId:entry.id,side});
try{
 await db.exec("ALTER TABLE terminal_tokens ADD management_sync_enabled boolean DEFAULT false;INSERT INTO stores VALUES('A','A'),('B','B');SET pos.shift_fn='on'");
 for(const[id,branch]of[[shift,'A'],[foreignShift,'B']])await db.query("INSERT INTO shifts(id,store_id,state,status,opening_float,row_version) VALUES($1,$2,'ACTIVE','OPEN',20,1)",[id,branch]);await db.exec("SET pos.shift_fn=''");
 await db.query("INSERT INTO terminal_tokens(id,location_id,status) VALUES($1,'B','active')",[otherTerminal]);
 const captures=JSON.parse(await read('scripts/fixtures/management-shift-read-validators.json'));
 for(const row of captures){assert.equal(createHash('sha256').update(row.definition).digest('hex'),row.sha256);await db.exec(row.definition);}
 for(const path of ['shift-financial-math-postgres.sql','shift-financial-cloud-receipts.sql','shift-financial-version-receipts.sql','shift-financial-known-basis.sql'])await db.exec(await read('scripts/preparation/'+path));
 await db.query("INSERT INTO sales(id,bill_number,store_id,total_amount,subtotal_amount,payment_type,payments,shift_id,row_version) VALUES($1,'SYNTHETIC','A',100,100,'cash','[]',$2,3)",[sale,shift]);
 const row=(await db.query('SELECT to_jsonb(s) value FROM sales s WHERE id=$1',[sale])).rows[0].value;
 original=(await db.query('SELECT prototype_fin62_create_basis($1,$2,$3,$4) value',['default','A',terminal,shift])).rows[0].value;
 await test('complete untouched server baseline verifies stored facts without granting an operation',async()=>{
  const result=await validate(original.basis);assert.equal(result.status,'verified-stored-basis');assert.equal(result.operatorAuthorized,false);assert.equal(result.observedByDeviceProven,false);assert.equal(result.admissionGranted,false);
 });
 let refunded;
 await test('scale, independent row clocks, known ASCII method case and UUID case do not change financial identity',async()=>{
  const basis=structuredClone(original.basis);basis.openingFloat='20.000000000000';basis.shiftId=basis.shiftId.toUpperCase();
  for(const input of basis.inputs){input.id=input.id.toUpperCase();input.shiftId=input.shiftId.toUpperCase();input.totalAmount='100.000000000000';input.paymentType='CASH';input.rowVersion='9007199254740993';input.isRefunded=null;input.paymentsJson='[ ]';}
  assert.equal((await validate(basis,[],{cash:'120.00',card:'0.00',digital:'0.00'})).status,'verified-stored-basis');
 });
 await test('genuinely different cents, payments and refund status are not metadata differences',async()=>{
  for(const patch of [{totalAmount:'100.01'},{paymentsJson:'[{"method":"cash","amount":99}]'},{isRefunded:true}]){const basis=structuredClone(original.basis);Object.assign(basis.inputs[0],patch);await assert.rejects(validate(basis),/STORED_VERSION_REQUIRED/);}
 });
 await test('original known point remains valid after an actual later refund',async()=>{await push({...row,row_version:4,is_refunded:true});refunded=await receipt(sale,'UPDATE');assert(refunded);assert.equal((await validate(original.basis)).expected.cash,'120.00');});
 await test('new recount can use the exact later stored refund version',async()=>{const basis=structuredClone(original.basis);basis.inputs[0]=refunded.after_basis;assert.equal((await validate(basis,[ref(sale,refunded)])).expected.cash,'20.00');});
 await test('receipt-backed numeric scale and row clocks compare semantically with normalized reference UUIDs',async()=>{
  const basis=structuredClone(original.basis);basis.inputs[0]={...refunded.after_basis,totalAmount:'100.000000000000',rowVersion:'999999'};
  const reference=ref(sale,refunded);reference.saleId=reference.saleId.toUpperCase();reference.receiptId=reference.receiptId.toUpperCase();
  assert.equal((await validate(basis,[reference])).status,'verified-stored-basis');
 });
 await test('private fact comparator normalizes only known method and UUID cases and validates payment JSON',async()=>{
  const fact=async value=>(await db.query('SELECT fin62_cloud_preparation.financial_fact($1::jsonb) value',[JSON.stringify(value)])).rows[0].value;
  const left={...original.basis.inputs[0],paymentsJson:'[{"method":"CARD","amount":"1.000"}]'},right={...left,paymentsJson:'[{"amount":1.0,"method":"card"}]',rowVersion:'999'};
  assert.deepEqual(await fact(left),await fact(right));
  assert.notDeepEqual(await fact({...left,paymentType:'UNKNOWN'}),await fact({...left,paymentType:'unknown'}));
  assert.notDeepEqual(await fact({...left,branchId:'A'}),await fact({...left,branchId:'a'}));
  for(const raw of ['bad','[{"method":"cash","amount":1,"amount":2}]'])await assert.rejects(fact({...left,isRefunded:true,paymentsJson:raw}));
 });
 await test('changed or forged input requires its exact receipt rather than guessed current state',async()=>{
  const changed=structuredClone(original.basis);changed.inputs[0].totalAmount='999';await assert.rejects(validate(changed),/STORED_VERSION_REQUIRED/);await assert.rejects(validate(changed,[ref(sale,refunded)]),/STORED_VERSION_REQUIRED/);
  const actual=structuredClone(original.basis);actual.inputs[0]=refunded.after_basis;await assert.rejects(validate(actual,[{saleId:sale,receiptId:randomUUID(),side:'after'}]),/STORED_VERSION_REQUIRED/);
 });
 await test('omitting baseline input without actual matching DELETE evidence is rejected',async()=>{const subset={...original.basis,inputs:[]};await assert.rejects(validate(subset),/BASELINE_ROW_OMITTED/);await assert.rejects(validate(subset,[ref(sale,refunded,'delete')]),/STORED_VERSION_REQUIRED/);});
 await test('duplicates, unused receipts and mismatched expected totals are rejected',async()=>{
  const basis=structuredClone(original.basis);basis.inputs[0]=refunded.after_basis;await assert.rejects(validate(basis,[ref(sale,refunded),ref(sale,refunded)]),/REFS_INVALID/);
  await assert.rejects(validate(original.basis,[ref(sale,refunded)]),/UNUSED_RECEIPT_REF/);await assert.rejects(validate(original.basis,[],{cash:'999.00',card:'0.00',digital:'0.00'}),/EXPECTED_MISMATCH/);
 });
 await test('scope, opening float, malformed raw JSON and duplicate row tampering are denied',async()=>{
  await assert.rejects(validate(original.basis,[],null,{branch:'B'}),/SCOPE_FORBIDDEN/);await assert.rejects(validate(original.basis,[],null,{branch:'B',terminal:otherTerminal}),/BASIS_SCOPE_MISMATCH/);
  await assert.rejects(validate({...original.basis,openingFloat:'999'}),/CONTEXT_MISMATCH/);
  await assert.rejects(validate({...original.basis,inputs:[...original.basis.inputs,...original.basis.inputs]},[],{cash:'220.00',card:'0.00',digital:'0.00'}),/MATH_UNSUPPORTED/);
  await assert.rejects(validate('{"prototypeVersion":2,"prototypeVersion":2}',[],{}),/MATH_UNSUPPORTED/);
 });
 await test('new stored sale needs exact actual version evidence while unseen later sale is not forced into old point',async()=>{
  const added=randomUUID();await push({...row,id:added,bill_number:'ADDED',total_amount:7,subtotal_amount:7,row_version:1});const entry=await receipt(added,'INSERT');
  assert.equal((await validate(original.basis)).expected.cash,'120.00');const basis={...original.basis,inputs:[...original.basis.inputs,entry.after_basis]};
  await assert.rejects(validate(basis),/STORED_VERSION_REQUIRED/);assert.equal((await validate(basis,[ref(added,entry)])).expected.cash,'127.00');
 });
 await test('actual deletion can remove its exact baseline state and retains unrelated later uploads',async()=>{
  const latest=(await db.query('SELECT prototype_fin62_create_basis($1,$2,$3,$4) value',['default','A',terminal,shift])).rows[0].value;
  await db.query('DELETE FROM sales WHERE id=$1',[sale]);const deletion=await receipt(sale,'DELETE');const basis={...latest.basis,inputs:latest.basis.inputs.filter(x=>x.id!==sale)};
  assert.equal((await validate(basis,[ref(sale,deletion,'delete')],null,{baseline:latest.basisId})).status,'verified-stored-basis');
 });
 await test('unsupported local-only historical states and cross-shift stored versions remain pending',async()=>{
  const unknown={...original.basis,inputs:[{...original.basis.inputs[0],id:randomUUID(),rowVersion:'99'}]};await assert.rejects(validate(unknown),/BASELINE_ROW_OMITTED/);
  const wrong=structuredClone(original.basis);wrong.inputs[0].shiftId=foreignShift;await assert.rejects(validate(wrong,[],{cash:'120.00',card:'0.00',digital:'0.00'}),/MATH_UNSUPPORTED/);
 });
 await test('multi-step actual refund then delete proves lineage from the original baseline',async()=>{
  const deletion=await receipt(sale,'DELETE');
  const result=await validate({...original.basis,inputs:[]},[ref(sale,deletion,'delete')]);assert.equal(result.expected.cash,'20.00');
 });
 await test('same transaction baseline then ordered write is supported without a global commit clock',async()=>{
  await db.exec('BEGIN');try{
   const base=(await db.query('SELECT prototype_fin62_create_basis($1,$2,$3,$4) value',['default','A',terminal,shift])).rows[0].value;
   const added=randomUUID();await push({...row,id:added,bill_number:'SAME-TX-NEW',total_amount:8,subtotal_amount:8,row_version:1});const proof=await receipt(added,'INSERT');
   const basis={...base.basis,inputs:[...base.basis.inputs,proof.after_basis]};assert.equal((await validate(basis,[ref(added,proof)],null,{baseline:base.basisId})).status,'verified-stored-basis');
   await db.exec('COMMIT');
  }catch(error){await db.exec('ROLLBACK');throw error;}
 });
 await test('same transaction earlier old state cannot be presented as a post-baseline delta',async()=>{
  await db.exec('BEGIN');try{
   const added=randomUUID(),item={...row,id:added,bill_number:'SAME-TX-OLD',total_amount:9,subtotal_amount:9,row_version:1};await push(item);const earlier=await receipt(added,'INSERT');
   await push({...item,is_refunded:true,row_version:2});
   const base=(await db.query('SELECT prototype_fin62_create_basis($1,$2,$3,$4) value',['default','A',terminal,shift])).rows[0].value;
   const basis={...base.basis,inputs:base.basis.inputs.map(x=>x.id===added?earlier.after_basis:x)};
   await assert.rejects(validate(basis,[ref(added,earlier)],null,{baseline:base.basisId}),/STORED_VERSION_REQUIRED/);
  }finally{await db.exec('ROLLBACK');}
 });
 if(native){
  const aggregateSQL=value=>`SELECT public.pos_sync_push_aggregate('${randomUUID()}','default','A','${terminal}','${JSON.stringify([{table:'sales',rows:[value],changes:[],dependencyOrder:1}]).replaceAll("'","''")}'::jsonb);`;
  const createBase=async()=>(await db.query('SELECT prototype_fin62_create_basis($1,$2,$3,$4) value',['default','A',terminal,shift])).rows[0].value;
  const added=randomUUID(),longRow={...row,id:added,bill_number:'LONG-INSERT',total_amount:13,subtotal_amount:13,row_version:1};
  await test('native long INSERT starts before baseline and commits later: MVCC admits it despite older timestamp',async()=>{
   const writer=await db.beginFinancialTransaction(aggregateSQL(longRow));let base;
   try{base=await createBase();assert(!base.basis.inputs.some(x=>x.id===added));await writer.commit();}finally{await writer.rollback();}
   const proof=await receipt(added,'INSERT');
   const evidence=(await db.query('SELECT v.captured_at<b.captured_at older,pg_visible_in_snapshot(v.capture_xid,b.snapshot_text::pg_snapshot) visible FROM fin62_version_preparation.sales_versions v CROSS JOIN fin62_cloud_preparation.bases b WHERE v.id=$1 AND b.id=$2',[proof.id,base.basisId])).rows[0];
   assert.deepEqual(evidence,{older:true,visible:false});
   assert.equal((await validate({...base.basis,inputs:[...base.basis.inputs,proof.after_basis]},[ref(added,proof)],null,{baseline:base.basisId})).status,'verified-stored-basis');
  });
  await test('native long refund starts before baseline and commits later: complete OLD to NEW lineage is accepted',async()=>{
   const writer=await db.beginFinancialTransaction(aggregateSQL({...longRow,row_version:2,is_refunded:true}));let base;
   try{base=await createBase();assert.equal(base.basis.inputs.find(x=>x.id===added).isRefunded,false);await writer.commit();}finally{await writer.rollback();}
   const proof=await receipt(added,'UPDATE');const basis={...base.basis,inputs:base.basis.inputs.map(x=>x.id===added?proof.after_basis:x)};
   assert.equal((await validate(basis,[ref(added,proof)],null,{baseline:base.basisId})).status,'verified-stored-basis');
   const latest=await createBase(),old=await receipt(added,'INSERT');const stale={...latest.basis,inputs:latest.basis.inputs.map(x=>x.id===added?old.after_basis:x)};
   await assert.rejects(validate(stale,[ref(added,old)],null,{baseline:latest.basisId}),/STORED_VERSION_REQUIRED/);
  });
 }

 await test('validator writes no records and client roles cannot call it',async()=>{
  const before=(await db.query('SELECT count(*)::int n FROM fin62_version_preparation.sales_versions')).rows[0].n;await validate(original.basis);
  assert.equal((await db.query('SELECT count(*)::int n FROM fin62_version_preparation.sales_versions')).rows[0].n,before);
  for(const role of ['anon','authenticated']){await db.exec('SET ROLE '+role);await assert.rejects(validate(original.basis,[],{cash:'120.00',card:'0.00',digital:'0.00'}),/permission denied/);await db.exec('RESET ROLE');}
 });
 console.log(passed+' isolated complete-baseline/stored-version groups passed. NOT author authorization, observed-device proof or successful admission.');
}finally{await db.close();}
