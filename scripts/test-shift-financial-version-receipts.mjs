// Isolated PGlite with the actual captured-schema aggregate/sales writer fixture.
// No network/operator DB/profile. Version evidence is NOT author authorization.
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
if(process.argv.length!==2)throw Error('Disposable fixture accepts no connection arguments.');
const require=createRequire(import.meta.url),{createCloud}=require('./lib/shift-protocol-integration-fixture.cjs');
const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');
const branch='A',terminal=randomUUID(),shift=randomUUID(),sale=randomUUID();
const db=await createCloud(branch,terminal);let passed=0;
const test=async(name,run)=>{await run();passed++;console.log('PASS '+name);};
const versions=async()=>(await db.query('SELECT before_basis,after_basis,before_hash,after_hash,operation,provenance,observed_auth_uid,observed_context FROM fin62_version_preparation.sales_versions ORDER BY captured_at,id')).rows;
const count=async()=>(await db.query('SELECT count(*)::int n FROM fin62_version_preparation.sales_versions')).rows[0].n;
const push=(row,{id=randomUUID(),scope=branch,device=terminal,extra=[]}={})=>db.query('SELECT public.pos_sync_push_aggregate($1,$2,$3,$4,$5::jsonb) value',[id,'default',scope,device,JSON.stringify([{table:'sales',rows:[row],changes:[],dependencyOrder:1},...extra])]);
try{
 await db.exec("INSERT INTO stores VALUES('A','A'),('B','B');SET pos.shift_fn='on';");
 await db.query("INSERT INTO shifts(id,store_id,state,status,opening_float,row_version) VALUES($1,'A','ACTIVE','OPEN',20,1)",[shift]);await db.exec("SET pos.shift_fn=''");
 await db.query("INSERT INTO sales(id,bill_number,store_id,total_amount,subtotal_amount,payment_type,payments,shift_id,row_version) VALUES($1,'SYNTHETIC-ONLY','A',100,100,'cash','[]',$2,3)",[sale,shift]);
 const row=(await db.query('SELECT to_jsonb(s) value FROM sales s WHERE id=$1',[sale])).rows[0].value;
 await db.query('DELETE FROM sales WHERE id=$1',[sale]);
 const validatorBefore=(await db.query("SELECT pg_get_functiondef('public.pos_sync_validate_scope(text,text,text)'::regprocedure) value")).rows[0].value;
 const writerBefore=(await db.query("SELECT pg_get_functiondef('public.sync_apply_sales(jsonb)'::regprocedure) value")).rows[0].value;
 await db.exec(await read('scripts/preparation/shift-financial-version-receipts.sql'));
 let batch;
 await test('actual scope-validated aggregate stores sale and captures actual accepted SQL version',async()=>{
  batch=randomUUID();await push(row,{id:batch});const entries=await versions();assert.equal(entries.length,1);assert.equal(entries[0].operation,'INSERT');assert.equal(entries[0].before_basis,null);assert.equal(entries[0].after_basis.totalAmount,'100');assert.equal(entries[0].after_basis.rowVersion,'3');
  const raw=(await db.query('SELECT after_basis::text value FROM fin62_version_preparation.sales_versions')).rows[0].value;assert.equal(createHash('sha256').update(raw).digest('hex'),entries[0].after_hash);
 });
 await test('exact aggregate replay and stale equal-state SQL upserts add no false version',async()=>{
  await push(row,{id:batch});assert.equal(await count(),1);await push({...row,row_version:1});assert.equal(await count(),1);
 });
 await test('actual refund merge captures OLD and NEW without claiming verified operator',async()=>{
  await push({...row,is_refunded:true,row_version:4});const entry=(await versions()).find(x=>x.operation==='UPDATE');assert(entry);assert.equal(entry.before_basis.isRefunded,false);assert.equal(entry.after_basis.isRefunded,true);assert.equal(entry.before_basis.rowVersion,'3');assert.equal(entry.after_basis.rowVersion,'4');
  for(const item of await versions()){assert.equal(item.provenance,'stored_sql_version_only');assert.equal(item.observed_context.contextVerified,false);assert.equal(item.observed_auth_uid,null);}
 });
 await test('later stale unrefunded upload cannot erase refund or manufacture a version',async()=>{
  const before=await count();await push({...row,row_version:1,is_refunded:false});assert.equal(await count(),before);
  assert.equal((await db.query('SELECT is_refunded FROM sales WHERE id=$1',[sale])).rows[0].is_refunded,true);
 });
 await test('cross-branch terminal and forged row branch deny atomically',async()=>{
  const before=await count();await assert.rejects(push({...row,id:randomUUID(),store_id:'B'},{scope:'B'}),/SCOPE_FORBIDDEN/);await assert.rejects(push({...row,id:randomUUID(),store_id:'B'}),/BRANCH_FORBIDDEN/);assert.equal(await count(),before);
 });
 await test('later aggregate failure rolls back sale, version and idempotency receipt together',async()=>{
  const before=await count(),badId=randomUUID(),newSale=randomUUID();
  await assert.rejects(push({...row,id:newSale,bill_number:'ROLLBACK-ONLY'},{id:badId,extra:[{table:'not_a_registered_table',rows:[],changes:[],dependencyOrder:999}]}));
  assert.equal(await count(),before);assert.equal((await db.query('SELECT count(*)::int n FROM sales WHERE id=$1',[newSale])).rows[0].n,0);assert.equal((await db.query('SELECT count(*)::int n FROM sync_idempotency_receipts WHERE batch_id=$1',[badId])).rows[0].n,0);
 });
 await test('table-level actual correction and deletion are captured as version evidence only',async()=>{
  const before=await count();await db.query("UPDATE sales SET payment_type='card',payments='[{\"method\":\"card\",\"amount\":100}]',row_version=5 WHERE id=$1",[sale]);assert.equal(await count(),before+1);
  const item=(await versions()).find(x=>x.after_basis?.rowVersion==='5');assert.equal(item.after_basis.paymentType,'card');
  await db.query('DELETE FROM sales WHERE id=$1',[sale]);assert.equal(await count(),before+2);assert((await versions()).some(x=>x.operation==='DELETE'&&x.before_basis.rowVersion==='5'&&x.after_basis===null));
 });
 await test('context spoofing cannot upgrade provenance and a failed SQL transaction retains no receipt',async()=>{
  const before=await count();await db.exec("BEGIN;SET LOCAL pos.branch_id='forged';SET LOCAL pos.terminal_id='forged-terminal';");await db.query("INSERT INTO sales(id,bill_number,store_id,total_amount) VALUES($1,'CONTEXT-ONLY','A',1)",[randomUUID()]);
  const item=(await versions()).find(x=>x.observed_context.terminalSetting==='forged-terminal');assert(item);assert.equal(item.provenance,'stored_sql_version_only');assert.equal(item.observed_context.contextVerified,false);await db.exec('ROLLBACK');assert.equal(await count(),before);
 });
 await test('private version evidence is immutable and has no client or service direct access',async()=>{
  await assert.rejects(db.exec("UPDATE fin62_version_preparation.sales_versions SET provenance='stored_sql_version_only'"),/IMMUTABLE/);await assert.rejects(db.exec('DELETE FROM fin62_version_preparation.sales_versions'),/IMMUTABLE/);
  for(const role of ['anon','authenticated','service_role']){await db.exec('SET ROLE '+role);await assert.rejects(db.exec('SELECT * FROM fin62_version_preparation.sales_versions'),/permission denied/);await db.exec('RESET ROLE');}
 });
 await test('existing scope validator and sales writer definitions are unchanged',async()=>{
  assert.equal((await db.query("SELECT pg_get_functiondef('public.pos_sync_validate_scope(text,text,text)'::regprocedure) value")).rows[0].value,validatorBefore);
  assert.equal((await db.query("SELECT pg_get_functiondef('public.sync_apply_sales(jsonb)'::regprocedure) value")).rows[0].value,writerBefore);
 });
 console.log(passed+' isolated actual-writer financial VERSION groups passed. No author authorization, local history reconstruction, admission or deployment claim.');
}finally{await db.close();}
