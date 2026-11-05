// FIN62 isolated baseline foundation only. No network/operator DB/config or admission success.
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
if(process.argv.length!==2)throw Error('Isolated fixture accepts no connection arguments.');
const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');
const captures=JSON.parse(await read('scripts/fixtures/management-shift-read-validators.json'));
for(const row of captures)assert.equal(createHash('sha256').update(row.definition).digest('hex'),row.sha256);
const db=new PGlite();let passed=0;
const a=randomUUID(),b=randomUUID(),m=randomUUID(),sa=randomUUID(),sb=randomUUID(),sale=randomUUID();
const call=async(branch,terminal,shift,org='default')=>(await db.query('SELECT public.prototype_fin62_create_basis($1,$2,$3,$4) value',[org,branch,terminal,shift])).rows[0].value;
const admit=(branch,terminal,id)=>db.query('SELECT public.prototype_fin62_admit($1,$2,$3,$4,$5)',['default',branch,terminal,id,randomUUID()]);
const test=async(name,run)=>{await run();passed++;console.log('PASS '+name);};
try{
 await db.exec(`CREATE ROLE service_role;CREATE ROLE authenticated;CREATE ROLE anon;CREATE SCHEMA auth;
 CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$SELECT current_setting('test.auth_role',true)$$;
 CREATE TABLE public.stores(id text PRIMARY KEY);
 CREATE TABLE public.terminal_tokens(id uuid PRIMARY KEY,location_id text,platform text,management_sync_enabled boolean,is_claimed boolean,status text,revoked_at timestamptz);
 CREATE TABLE public.shifts(id uuid PRIMARY KEY,store_id text,opening_float numeric,row_version bigint);
 CREATE TABLE public.sales(id uuid PRIMARY KEY,store_id text,shift_id text,total_amount numeric,payment_type text,payments jsonb,is_refunded boolean,row_version bigint);
 INSERT INTO stores VALUES('A'),('B');SET test.auth_role='service_role';`);
 for(const row of captures)await db.exec(row.definition);
 await db.query("INSERT INTO terminal_tokens VALUES($1,'A','pc',false,true,'active',NULL),($2,'B','pc',false,true,'active',NULL),($3,NULL,'pc',true,true,'active',NULL)",[a,b,m]);
 await db.query("INSERT INTO shifts VALUES($1,'A',20,1),($2,'B',500,1)",[sa,sb]);
 await db.query("INSERT INTO sales VALUES($1,'A',$2,100,'cash','[]',false,1)",[sale,sa]);
 await db.query("INSERT INTO sales VALUES($1,'A',$2,5,'card','[]',true,2),($3,'B',$4,900,'cash','[]',false,1)",[randomUUID(),sa,randomUUID(),sb]);
 await db.exec('ALTER TABLE sales ADD discount_amount numeric DEFAULT 0');
 await db.exec(await read('scripts/preparation/shift-financial-cloud-receipts.sql'));
 await db.exec(await read('scripts/preparation/shift-financial-math-postgres.sql'));
 let first;
 await test('service-only baseline includes complete actual same-branch inputs including refunded rows',async()=>{
  await db.exec('SET ROLE service_role');first=await call('A',a,sa);await db.exec('RESET ROLE');
  assert.equal(first.basis.prototypeVersion,2);assert.equal(first.basis.formula,'canonical-exact-decimal-v2');
  assert.equal(Object.hasOwn(first.basis,'expected'),false,'Baseline contains inputs only, no claimed computed totals');
  assert(first.basis.inputs.every(row=>Object.hasOwn(row,'isRefunded')&&!Object.hasOwn(row,'refunded')));
  assert.equal((await db.query('SELECT basis_version FROM fin62_cloud_preparation.bases WHERE id=$1',[first.basisId])).rows[0].basis_version,2);
  const math=(await db.query('SELECT fin62_preparation.validate_financial_math($1::jsonb) value',[JSON.stringify(first.basis)])).rows[0].value;
  assert.deepEqual(math.expected,{cash:'120.00',card:'0.00',digital:'0.00'});
  assert.equal(first.basis.inputs.length,2);assert(first.basis.inputs.every(row=>row.branchId==='A'&&row.shiftId===sa));assert.equal(first.basis.inputs.filter(row=>row.isRefunded).length,1);
  const raw=(await db.query('SELECT basis::text value FROM fin62_cloud_preparation.bases WHERE id=$1',[first.basisId])).rows[0].value;
  assert.equal(createHash('sha256').update(raw).digest('hex'),first.basisHash);
 });
 await test('normal terminal cannot change branch or bind a foreign shift',async()=>{await assert.rejects(call('B',a,sb),/SCOPE_FORBIDDEN/);await assert.rejects(call('A',a,sb),/SHIFT_BRANCH_MISSING/);});
 await test('captured Management capability reads requested valid branch but not foreign shift or unknown branch',async()=>{const own=await call('B',m,sb);assert.equal(own.basis.branchId,'B');await assert.rejects(call('A',m,sb),/SHIFT_BRANCH_MISSING/);await assert.rejects(call('missing',m,sb),/SCOPE_FORBIDDEN/);});
 await test('unknown organization and terminal are denied',async()=>{await assert.rejects(call('A',a,sa,'other'),/ORGANIZATION_FORBIDDEN/);await assert.rejects(call('A',randomUUID(),sa),/SCOPE_FORBIDDEN/);});
 await test('revoked Operations and disabled Management are denied',async()=>{await db.query('UPDATE terminal_tokens SET revoked_at=now() WHERE id=$1',[a]);await assert.rejects(call('A',a,sa),/SCOPE_FORBIDDEN/);await db.query('UPDATE terminal_tokens SET revoked_at=NULL WHERE id=$1',[a]);await db.query('UPDATE terminal_tokens SET management_sync_enabled=false WHERE id=$1',[m]);await assert.rejects(call('A',m,sa),/SCOPE_FORBIDDEN/);await db.query('UPDATE terminal_tokens SET management_sync_enabled=true WHERE id=$1',[m]);});
 await test('later refund preserves original receipt and new baseline has its own action point',async()=>{
  await db.query('UPDATE sales SET is_refunded=true,row_version=2 WHERE id=$1',[sale]);const next=await call('A',a,sa);assert.notEqual(next.basisId,first.basisId);assert.notEqual(next.basisHash,first.basisHash);
  const saved=(await db.query('SELECT basis FROM fin62_cloud_preparation.bases WHERE id=$1',[first.basisId])).rows[0].basis;assert.deepEqual(saved,first.basis);
  assert.equal(saved.inputs.find(row=>row.id===sale).isRefunded,false);assert.equal(next.basis.inputs.find(row=>row.id===sale).isRefunded,true);
 });
 await test('basis update and delete are rejected',async()=>{await assert.rejects(db.query('UPDATE fin62_cloud_preparation.bases SET basis_hash=$1 WHERE id=$2',['a'.repeat(64),first.basisId]),/IMMUTABLE/);await assert.rejects(db.query('DELETE FROM fin62_cloud_preparation.bases WHERE id=$1',[first.basisId]),/IMMUTABLE/);});
 await test('no synthetic authorized-operation issuer or successful admission exists',async()=>{await assert.rejects(admit('A',a,first.basisId),/VERIFIED_FINANCIAL_RECEIPTS_REQUIRED/);await assert.rejects(admit('B',b,first.basisId),/BASIS_SCOPE_MISMATCH/);assert.equal((await db.query("SELECT count(*)::int n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='fin62_cloud_preparation' AND p.proname LIKE '%operation%'")).rows[0].n,0);});
 await test('authenticated and anonymous cannot call wrappers, spoof service auth or access receipts',async()=>{for(const role of ['authenticated','anon']){await db.exec('SET ROLE '+role);await assert.rejects(call('A',a,sa),/permission denied/);await assert.rejects(db.query('SELECT * FROM fin62_cloud_preparation.bases'),/permission denied/);await db.exec('RESET ROLE');}});
 await test('service assertion is required even for an owner call',async()=>{await db.exec("SET test.auth_role='authenticated'");await assert.rejects(call('A',a,sa),/SERVICE_REQUIRED/);await db.exec("SET test.auth_role='service_role'");});
 await test('another valid Management terminal cannot reuse the originating terminal basis',async()=>{await assert.rejects(admit('A',m,first.basisId),/BASIS_SCOPE_MISMATCH/);});
 await test('failed admission transaction rolls back its new baseline receipt',async()=>{
  const before=(await db.query('SELECT count(*)::int n FROM fin62_cloud_preparation.bases')).rows[0].n;
  await db.exec('BEGIN');const pending=await call('A',a,sa);await assert.rejects(admit('A',a,pending.basisId),/VERIFIED_FINANCIAL_RECEIPTS_REQUIRED/);await db.exec('ROLLBACK');
  assert.equal((await db.query('SELECT count(*)::int n FROM fin62_cloud_preparation.bases')).rows[0].n,before);
 });
 await test('exact scalar and embedded payment precision is preserved without Number conversion',async()=>{
  await db.query(`INSERT INTO sales VALUES($1,'A',$2,9007199254740993.005,'card','[{"method":"card","amount":9007199254740993.005}]',false,9007199254740993)`,[randomUUID(),sa]);
  const exact=await call('A',a,sa),input=exact.basis.inputs.find(row=>row.totalAmount==='9007199254740993.005');assert(input);assert.equal(input.rowVersion,'9007199254740993');assert(input.paymentsJson.includes('9007199254740993.005'));
 });
 await test('service role has no direct receipt mutation or schema access',async()=>{await db.exec('SET ROLE service_role');await assert.rejects(db.query('SELECT * FROM fin62_cloud_preparation.bases'),/permission denied/);await db.exec('RESET ROLE');});
 console.log(passed+' isolated baseline foundation groups passed. Actual captured validator reused. Management USER subset/actor proof remains a hosting prerequisite, not certified here. No financial admission, writer integration or deployment claim.');
}finally{await db.close();}
