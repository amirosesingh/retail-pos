// Exact generated artifact acceptance, owned disposable engines only.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),native=process.argv.slice(2).join(' ')==='--native';
assert(process.argv.length===2||native,'Only --native is accepted; never connection arguments');
const {createFullFinancialCloud}=require('./lib/financial-cloud-fixture.cjs');
const {renderCloudUpgrade,outputs}=require('./generate-shift-financial-upgrade.cjs');
const read=file=>readFile(new URL('../'+file,import.meta.url),'utf8');
for(const output of outputs())assert.equal(await read(output.file),output.text,'Generated artifact drift: '+output.file);
const artifact=renderCloudUpgrade().sql;
let nativeFactory;
if(native){
 const source=await read('scripts/test-seven-shift-summary-native.fixture.mjs'),anchor='exec:sql=>execute(sql),';
 assert.equal(source.split(anchor).length,2);
 const patched=source.replace(anchor,"exec:sql=>execute(sql),execStrict:sql=>{try{return command('psql',[...args,'-v','ON_ERROR_STOP=1'],{input:sql});}catch(error){if(typeof error.stderr==='string'&&error.stderr.includes('ERROR:'))throw new Error(error.stderr,{cause:error});throw error;}},");
 nativeFactory=(await import('data:text/javascript;base64,'+Buffer.from(patched+'\nexport {createNativeFixture};').toString('base64'))).createNativeFixture;
}
const snapshot=async db=>(await db.query(`SELECT jsonb_build_object(
 'shifts',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.shifts s),
 'products',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.products p),
 'originals',(SELECT jsonb_agg(jsonb_build_array(proname,pg_get_function_identity_arguments(p.oid),md5(pg_get_functiondef(p.oid)),proacl::text) ORDER BY proname) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND proname IN('pos_sale_commit','sale_refund','pos_admin_correct_sale','pos_admin_correct_tender','pos_admin_add_missed_bill'))) value`)).rows[0].value;
let passed=0;
for(const variant of['canonical','actual-target','late-failure','existing-metadata']){
 const base=native?await nativeFactory():new(await import('@electric-sql/pglite')).PGlite();
 let before,applied=false;
 const failed=artifact.replace('IF NOT fin62_live_preparation.installation_ready()','IF true OR NOT fin62_live_preparation.installation_ready()');
 assert.notEqual(failed,artifact);
 const chosen=variant==='late-failure'?failed:artifact;
 const adapter={
  query:(...args)=>base.query(...args),close:async()=>{},
  exec:async sql=>{
   if(sql!==chosen)return base.exec(sql);
   before=await snapshot(base);
   if(variant==='existing-metadata')await base.exec('CREATE SCHEMA fin62_preparation;CREATE TABLE fin62_preparation.owner_marker(value integer);INSERT INTO fin62_preparation.owner_marker VALUES(1);');
   // Real migration owner has no HTTP JWT. Strict psql must stop at the FIRST
   // error: a trailing COMMIT's 00000 is never installation evidence.
   if(native){await base.execStrict(sql);}
   else{await base.exec("SET test.auth_role='';");await base.exec(sql);await base.exec("SET test.auth_role='service_role';");}
   applied=true;
  },
 };
 try{
  const work=createFullFinancialCloud({db:adapter,actualSaleDefinition:variant==='actual-target',upgradeSql:chosen});
  if(variant==='late-failure'||variant==='existing-metadata'){
   await assert.rejects(work,new RegExp(variant==='late-failure'?'FIN62_FINAL_INSTALLATION_NOT_READY':'FIN62_EXISTING_METADATA_REQUIRES_REVIEW'));
   if(!native)await base.exec('ROLLBACK;');
   assert.equal(applied,false);assert.deepEqual(await snapshot(base),before);
   const schemas=(await base.query("SELECT nspname FROM pg_namespace WHERE nspname LIKE 'fin62%' ORDER BY 1")).rows.map(row=>row.nspname);
   assert.deepEqual(schemas,variant==='existing-metadata'?['fin62_preparation']:[]);
   if(variant==='existing-metadata')assert.equal((await base.query('SELECT value FROM fin62_preparation.owner_marker')).rows[0].value,1);
  }else{
   await work;assert.equal(applied,true);assert.deepEqual(await snapshot(base),before);
   await base.exec("SET test.auth_role='';");
   assert.equal((await base.query('SELECT fin62_live_preparation.installation_ready() ready')).rows[0].ready,true);
   assert.equal((await base.query('SELECT count(*)::int count FROM fin62_rollout_preparation.approvals')).rows[0].count,0);
   assert.equal((await base.query('SELECT count(*)::int count FROM fin62_history_preparation.protected_shifts')).rows[0].count,0);
   assert.equal((await base.query("SELECT has_function_privilege('authenticated','fin62_live_preparation.installation_ready()','EXECUTE') permitted")).rows[0].permitted,false);
  }
  passed++;console.log('PASS exact financial upgrade '+variant+'; existing business rows/original writer definitions preserved');
 }finally{await base.close();}
}
console.log(`PASS ${passed} exact ${native?'native PostgreSQL':'PGlite'} atomic upgrade groups; no live database or activation`);
