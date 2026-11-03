// Disposable PostgreSQL only. Captures contain DDL, never a database URL or rows.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
const require=createRequire(import.meta.url);
const read=name=>readFile(new URL('../'+name,import.meta.url),'utf8');
const migrationPath='supabase/migrations/20261103023417_management_closing_graph_read_scope.sql';
const migration=(await read(migrationPath)).replaceAll('\r\n','\n');
const crlfMigration=migration.replaceAll('\n','\r\n');
const schema=(await read('supabase/schema.sql')).replaceAll('\r\n','\n');
const captures=JSON.parse(await read('scripts/fixtures/management-shift-read-validators.json'));
assert(process.argv.length===2||process.argv.length===4&&process.argv[2]==='--captured-read-routines','Only an optional read-only routine capture is accepted.');
if(process.argv.length===4){
 const live=JSON.parse(await readFile(process.argv[3],'utf8'));
 const actual=live.find(row=>(row.proname??row.name)==='pos_sync_validate_read_scope');
 assert(actual,'The capture must contain the actual read validator');
 captures[captures.findIndex(row=>row.signature==='pos_sync_validate_read_scope(text,text,text)')]=actual;
}
for(const row of captures)assert.equal(createHash('sha256').update(row.definition).digest('hex'),row.sha256.toLowerCase());
const opsA='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',opsB='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',management='cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
const {createCloud}=require('./lib/shift-protocol-integration-fixture.cjs');
const db=await createCloud('a',opsA),graphSignature='public.pos_sync_shift_graph(text,text,text,uuid)';
const oldCall='PERFORM public.pos_sync_validate_scope(p_organization_id,p_branch_id,p_terminal_id);';
const newCall='PERFORM public.pos_sync_validate_read_scope(p_organization_id,p_branch_id,p_terminal_id);';
const graphTables=['shifts','shift_cash_counts','shift_reconciliations','shift_close_events','shift_notifications','shift_variance_alerts'];
let passed=0;
const check=async(name,work)=>{await work();passed++;console.log('PASS '+name);};
const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
const graph=(branch,terminal,id,organization='default')=>scalar('SELECT public.pos_sync_shift_graph($1,$2,$3,$4::uuid)',[organization,branch,terminal,id]);
const routine=async signature=>(await db.query("SELECT pg_get_functiondef(p.oid) definition,p.prosrc body,to_jsonb(p)-'prosrc' attributes FROM pg_proc p WHERE p.oid=$1::regprocedure",[signature])).rows[0];
const stored=async()=>Object.fromEntries(await Promise.all(graphTables.map(async table=>[table,(await db.query('SELECT to_jsonb(t) value FROM '+table+' t ORDER BY id')).rows.map(row=>row.value)])));
const rollbackFailure=async pattern=>{await assert.rejects(db.exec(migration),pattern);await db.exec('ROLLBACK');};
try{
 await db.exec("CREATE TYPE app_role AS ENUM('admin','manager','staff');ALTER TABLE app_users ALTER COLUMN role TYPE app_role USING role::app_role;ALTER TABLE terminal_tokens ALTER COLUMN id TYPE uuid USING id::uuid;ALTER TABLE terminal_tokens ADD management_sync_enabled boolean NOT NULL DEFAULT false;");
 for(const row of captures)await db.exec(row.definition);
 for(const name of ['pos_sync_validate_scope','pos_sync_validate_read_scope'])await db.exec(`REVOKE ALL ON FUNCTION public.${name}(text,text,text) FROM PUBLIC,anon,authenticated;GRANT EXECUTE ON FUNCTION public.${name}(text,text,text) TO service_role;`);
 await db.exec("INSERT INTO stores(id,name) VALUES('a','Synthetic A'),('b','Synthetic B');");
 await db.query("INSERT INTO terminal_tokens(id,location_id,status,revoked_at,platform,is_claimed,management_sync_enabled) VALUES($1,'b','active',NULL,'pc',true,false),($2,NULL,'active',NULL,'pc',true,true)",[opsB,management]);
 const shifts={a:randomUUID(),b:randomUUID()};
 for(const branch of ['a','b']){
  const count=randomUUID(),now='2026-11-03T00:00:00.123Z';
  await db.exec("SET pos.shift_fn='on'");
  await db.query("INSERT INTO shifts(id,store_id,terminal_id,opened_at,closed_at,status,state,row_version,opening_float,counted_cash,final_counted_cash,closing_float,expected_cash,expected_card,expected_digital,variance_cash,variance_total,variance_status) VALUES($1,$2,$3,$4,$4,'CLOSED','CLOSED',7,10,20,20,20,20,0,0,0,0,'NO_VARIANCE')",[shifts[branch],branch,branch==='a'?opsA:opsB,now]);
  await db.exec("SET pos.shift_fn=''");
  await db.query("INSERT INTO shift_cash_counts(id,shift_id,store_id,terminal_id,kind,counted_cash,created_at) VALUES($1,$2,$3,$4,'ORIGINAL',20,$5)",[count,shifts[branch],branch,branch==='a'?opsA:opsB,now]);
  await db.query("INSERT INTO shift_reconciliations(id,shift_id,store_id,count_id,counted_cash,expected_cash,expected_card,expected_digital,variance_cash,variance_total,variance_status,created_at) VALUES($1,$2,$3,$4,20,20,0,0,0,0,'NO_VARIANCE',$5)",[randomUUID(),shifts[branch],branch,count,now]);
  await db.query("INSERT INTO shift_close_events(id,shift_id,store_id,event,created_at) VALUES($1,$2,$3,'reconciled',$4)",[randomUUID(),shifts[branch],branch,now]);
 }
 const before=await routine(graphSignature),business=await stored();
 assert(before.body.startsWith('\n'),'Use the actual untrimmed function body, including its leading newline');
 assert.equal(createHash('sha256').update(before.body.replaceAll('\r\n','\n')).digest('hex'),
  'b5422272a66059b6a085ee0e421a1830d9f0e9b9276c40a2390bb590dde07a41',
  'The baseline graph body must match the actual post-rollout catalog capture');
 const writers=(await db.query("SELECT p.oid::regprocedure::text signature,pg_get_functiondef(p.oid) definition,to_jsonb(p) attributes FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND (p.proname LIKE 'sync_%' OR p.proname LIKE 'pos_sync_%') AND p.oid<>$1::regprocedure ORDER BY p.oid::regprocedure::text",[graphSignature])).rows;
 await check('captured read scope admits Management while the old closing graph rejects it',async()=>{
  await db.query('SELECT pos_sync_validate_read_scope($1,$2,$3)',['default','a',management]);
  await assert.rejects(graph('a',management,shifts.a),/TERMINAL_SCOPE_FORBIDDEN/);
 });
 await check('raw CRLF migration accepts the actual LF body and preserves exact metadata through repeat application',async()=>{
  await db.exec(crlfMigration);const upgraded=await routine(graphSignature);
  assert.equal(upgraded.body,before.body.replace(oldCall,newCall));assert.deepEqual(upgraded.attributes,before.attributes);assert.deepEqual(await stored(),business);
  await db.exec(crlfMigration);assert.deepEqual(await routine(graphSignature),upgraded);
  await db.exec(before.definition);assert.deepEqual(await routine(graphSignature),before);
 });
 await check('additive migration changes exactly one admission call and preserves metadata, data and all other sync routines',async()=>{
  await db.exec(migration);const after=await routine(graphSignature);
  assert.equal(after.body,before.body.replace(oldCall,newCall));assert.deepEqual(after.attributes,before.attributes);assert.deepEqual(await stored(),business);
  const afterWriters=(await db.query("SELECT p.oid::regprocedure::text signature,pg_get_functiondef(p.oid) definition,to_jsonb(p) attributes FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND (p.proname LIKE 'sync_%' OR p.proname LIKE 'pos_sync_%') AND p.oid<>$1::regprocedure ORDER BY p.oid::regprocedure::text",[graphSignature])).rows;
  assert.deepEqual(afterWriters,writers);
 });
 await check('claimed enabled Management reads complete correct-branch closing graphs without changing facts',async()=>{
  for(const branch of ['a','b']){const view=await graph(branch,management,shifts[branch]);assert.equal(view.shiftGraphVersion,1);assert.equal(view.tables.length,6);assert.match(view.graphToken,/^[a-f0-9]{64}$/);assert.equal(view.tables[0].rows[0].store_id,branch);assert.equal(view.tables[1].rows.length,1);assert.equal(view.tables[2].rows[0].count_id,view.tables[1].rows[0].id);}
  assert.deepEqual(await stored(),business);
 });
 await check('Operations terminals retain same-branch allow and opposite-branch denial',async()=>{
  assert.equal((await graph('a',opsA,shifts.a)).ok,true);assert.equal((await graph('b',opsB,shifts.b)).ok,true);
  await assert.rejects(graph('b',opsA,shifts.b),/TERMINAL_SCOPE_FORBIDDEN/);await assert.rejects(graph('a',opsB,shifts.a),/TERMINAL_SCOPE_FORBIDDEN/);
 });
 await check('Management graph branch validation still rejects a foreign shift, unknown branch, missing shift and organization',async()=>{
  await assert.rejects(graph('b',management,shifts.a),/BRANCH_FORBIDDEN/);await assert.rejects(graph('missing',management,shifts.a),/TERMINAL_SCOPE_FORBIDDEN/);
  await assert.rejects(graph('a',management,randomUUID()),/GRAPH_MISSING/);await assert.rejects(graph('a',management,shifts.a,'other'),/ORGANIZATION_FORBIDDEN/);
 });
 for(const [name,update]of [['unclaimed','is_claimed=false'],['disabled','management_sync_enabled=false'],['revoked','revoked_at=now()'],['revoked status',"status='revoked'"],['mobile',"platform='mobile'"]])await check(name+' Management devices cannot read a graph',async()=>{
  await db.query('UPDATE terminal_tokens SET '+update+' WHERE id=$1::uuid',[management]);
  await assert.rejects(graph('a',management,shifts.a),/TERMINAL_SCOPE_FORBIDDEN/);
  await db.query("UPDATE terminal_tokens SET is_claimed=true,management_sync_enabled=true,revoked_at=NULL,status='active',platform='pc' WHERE id=$1::uuid",[management]);
 });
 await check('existing write validator and aggregate upload remain denied to Management',async()=>{
  await assert.rejects(db.query('SELECT pos_sync_validate_scope($1,$2,$3)',['default','a',management]),/TERMINAL_SCOPE_FORBIDDEN/);
  await assert.rejects(db.query('SELECT pos_sync_push_aggregate($1::uuid,$2,$3,$4,$5::jsonb)',[randomUUID(),'default','a',management,'[]']),/TERMINAL_SCOPE_FORBIDDEN/);
  assert.deepEqual(await stored(),business);
 });
 await check('service-role check and execution grants remain unchanged',async()=>{
  await db.exec("SET test.auth_role='authenticated'");await assert.rejects(graph('a',opsA,shifts.a),/SYNC_FORBIDDEN/);await db.exec("SET test.auth_role='service_role'");
  for(const role of ['anon','authenticated']){assert.equal(await scalar('SELECT has_function_privilege($1,$2,\'EXECUTE\')',[role,graphSignature]),false);await db.exec('SET ROLE '+role);await assert.rejects(graph('a',opsA,shifts.a),/permission denied/);await db.exec('RESET ROLE');}
  assert.equal(await scalar("SELECT has_function_privilege('service_role',$1,'EXECUTE')",[graphSignature]),true);
 });
 await check('exact revised body is an idempotent no-op for raw LF and CRLF migrations',async()=>{const saved=await routine(graphSignature);for(const input of [migration,crlfMigration,migration]){await db.exec(input);assert.deepEqual(await routine(graphSignature),saved);assert.deepEqual(await stored(),business);}});
 const revised=await routine(graphSignature);
 for(const [name,mutate]of [['extra body logic',definition=>definition.replace('DECLARE graph jsonb;','DECLARE graph jsonb;\n-- unrecognized operator customization')],['mixed admission',definition=>definition.replace(newCall,newCall+'\n '+oldCall)],['missing admission',definition=>definition.replace(newCall,'NULL;')]])await check(name+' aborts without replacing the unknown routine',async()=>{
  await db.exec(mutate(revised.definition));const unknown=await routine(graphSignature);await rollbackFailure(/SHIFT_GRAPH_READ_UNRECOGNIZED_ROUTINE/);assert.deepEqual(await routine(graphSignature),unknown);assert.deepEqual(await stored(),business);await db.exec(revised.definition);
 });
 await check('missing read validator aborts without touching graph or write admission',async()=>{
  const validator=captures.find(row=>row.signature==='pos_sync_validate_read_scope(text,text,text)');await db.exec('DROP FUNCTION public.pos_sync_validate_read_scope(text,text,text)');
  const saved=await routine(graphSignature);await rollbackFailure(/REQUIRES_REVIEWED_PREREQUISITES/);assert.deepEqual(await routine(graphSignature),saved);await db.exec(validator.definition);
 });
 await check('canonical and repeated generator output retain the exact final read patch after all authority contracts',async()=>{
  const marker='-- SHIFT_GRAPH_READ_SCOPE_BEGIN',end='-- SHIFT_GRAPH_READ_SCOPE_END';
  assert.equal(schema.split(marker+'\n')[1]?.split('\n'+end)[0],migration.trim());
  const source=await read('scripts/generate-supabase-sync-contract.cjs');let generated=schema;
  const fs=require('node:fs'),schemaFile=fileURLToPath(new URL('../supabase/schema.sql',import.meta.url));
  for(let run=0;run<2;run++){
   const previous=generated;runInNewContext(source,{require:name=>name==='node:fs'?{...fs,readFileSync:(file,...args)=>file===schemaFile?generated:fs.readFileSync(file,...args),writeFileSync:(file,value)=>{assert.equal(file,schemaFile);generated=value;}}:require(name),__dirname:fileURLToPath(new URL('.',import.meta.url)),process:{argv:['node','generate-supabase-sync-contract.cjs']},console:{log(){}}});
   generated=generated.replaceAll('\r\n','\n');if(run===1)assert.equal(generated,previous);assert.equal(generated.split(marker).length,2);assert(generated.indexOf(marker)>generated.indexOf('-- SHIFT_CLOSING_START_CONTRACT_END'));assert(generated.indexOf(marker)>generated.indexOf('-- SHIFT_AUTHOR_CONTRACT_END'));assert.equal(generated.split(marker+'\n')[1]?.split('\n'+end)[0],migration.trim());
  }
 });
 console.log(`${passed} Management closing-graph SQL scenarios passed (${process.argv.length===4?'actual captured':'pinned captured'} validators).`);
}finally{await db.close();}
