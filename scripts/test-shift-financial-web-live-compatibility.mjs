// Isolated captured-source compatibility only; never reads operator configuration.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createFullFinancialCloud}=require('./lib/financial-cloud-fixture.cjs');
const {renderCloudUpgrade}=require('./generate-shift-financial-upgrade.cjs');
const native=process.argv.slice(2).join(' ')==='--native';
assert(process.argv.length===2||native,'Only --native accepted');
const fixture=JSON.parse(await readFile(new URL('./fixtures/fin62-web-live-definitions.json',import.meta.url),'utf8'));
assert(fixture.definitions.some(row=>row.definition.includes('\r\n')),'Actual raw CRLF must remain captured');
const delegates=JSON.parse(await readFile(new URL('./fixtures/fin62-writers-delegates-live-definitions.json',import.meta.url),'utf8'));
let groups=0;
for(const variant of ['canonical','actual','actual-crlf','tampered-permission','wrong-owner']){
 let db;
 if(native){let source=await readFile(new URL('./test-seven-shift-summary-native.fixture.mjs',import.meta.url),'utf8');const anchor='exec:sql=>execute(sql),';assert.equal(source.split(anchor).length,2);source=source.replace(anchor,"exec:sql=>execute(sql),execStrict:sql=>{try{return command('psql',[...args,'-v','ON_ERROR_STOP=1'],{input:sql});}catch(error){if(typeof error.stderr==='string'&&error.stderr.includes('ERROR:'))throw new Error(error.stderr,{cause:error});throw error;}},");const factory=await import('data:text/javascript;base64,'+Buffer.from(source+'\nexport {createNativeFixture};').toString('base64'));db=await factory.createNativeFixture();}
 else{const {PGlite}=require('@electric-sql/pglite');db=new PGlite();}
 const close=db.close.bind(db);db.close=async()=>{};
 try{
  let captured=variant==='canonical'?'':fixture.definitions.map(row=>row.definition+';').join('\n');
  if(variant==='actual-crlf')captured=captured.replaceAll('\r\n','\n').replaceAll('\n','\r\n');
  if(variant!=='canonical')captured+='\nSET check_function_bodies=off;\n'+delegates.definitions.map(row=>row.definition+';').join('\n')+'\nSET check_function_bodies=on;';
  if(variant==='tampered-permission')captured=captured.replace("IF NOT public.has_perm('can_close_shift') THEN","IF false THEN");
  if(variant==='wrong-owner')captured+='\nALTER FUNCTION public.shift_close_start(uuid,text,text) OWNER TO service_role;';
  const sql=renderCloudUpgrade().sql;
  const exec=db.exec.bind(db);let before;const attributes=async()=> (await db.query("SELECT proname,proowner,proacl::text,prosecdef,proconfig,proargdefaults::text FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN('pos_admin_correct_closed_shift','shift_cash_count_submit','shift_close_start','shift_variance_approve','shift_reconcile_now','shift_recount_submit') ORDER BY proname")).rows;db.exec=async text=>{if(text===sql){if(captured)await (native?db.execStrict(captured):exec(captured));before=await attributes();return native?db.execStrict(text):exec(text);}return exec(text);};
  if(variant.startsWith('tampered')||variant==='wrong-owner'){
   await assert.rejects(createFullFinancialCloud({db,upgradeSql:sql,actualSaleDefinition:true}),/FIN62_WEB_SOURCE_UNEXPECTED/);
   await exec('ROLLBACK');
   assert.equal((await db.query("SELECT count(*)::int n FROM pg_namespace WHERE nspname LIKE 'fin62%'")).rows[0].n,0,'Whole artifact rolls back');
  }else{
   await createFullFinancialCloud({db,upgradeSql:sql,actualSaleDefinition:true});
   assert.deepEqual(await attributes(),before,'Existing authority metadata unchanged');assert.equal((await db.query('SELECT fin62_live_preparation.installation_ready() ready')).rows[0].ready,true);
   assert.equal((await db.query('SELECT count(*)::int n FROM fin62_live_preparation.contract_pins')).rows[0].n,49);
   const definition=(await db.query("SELECT pg_get_functiondef('public.shift_close_start(uuid,text,text)'::regprocedure) definition")).rows[0].definition;
   if(variant.startsWith('actual'))assert(definition.includes('permission to close another terminal shift.'));
   for(const name of ['shift_close_start','shift_variance_approve']){
    const def=(await db.query('SELECT pg_get_functiondef(oid) definition FROM pg_proc WHERE pronamespace=\'public\'::regnamespace AND proname=$1',[name])).rows[0].definition;
    assert(def.includes('fin62_web_preparation.end_graph'),'CRLF alias must acquire AND release context');
   }
  }
  groups++;console.log('PASS '+variant);
 }finally{await close();}
}
console.log(`PASS ${groups} captured-source artifact groups`);
