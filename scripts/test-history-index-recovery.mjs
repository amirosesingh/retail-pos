// Captured schema/routine definitions + synthetic data only. No operator URL.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {createRequire} from 'node:module';
const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');
const capture=JSON.parse(await read('src/lib/__tests__/fixtures/history-index-live-metadata.json'));
const registry=JSON.parse(await read('database/sqlserver/schema-registry.json'));
const source=await read('supabase/migrations/20261106042139_automatic_history_index_recovery.sql');
const args=process.argv.slice(2);assert(args.every(x=>x==='--native'||x==='--postgrest'||/^--line-endings=(lf|crlf)$/.test(x)));
const native=args.includes('--native'),eol=args.find(x=>x.startsWith('--line-endings='))?.split('=')[1]??'lf';
assert(!args.includes('--postgrest')||native);
const migration=source.replaceAll('\r\n','\n').replaceAll('\n',eol==='crlf'?'\r\n':'\n');
let prelude=native?(await read('scripts/test-seven-shift-summary-native.fixture.mjs')).replaceAll('\r\n','\n'):'';
if(native){
 assert.equal(prelude.split('  return {\n').length,2);prelude=prelude.replace('  return {\n','  return { historyRest:{port,directory},\n');
 const holder="SELECT 1 FROM shifts WHERE id='${id}' FOR UPDATE;";assert.equal(prelude.split(holder).length,2);
 prelude=prelude.replace(holder,'LOCK TABLE public.change_history IN ROW EXCLUSIVE MODE;');
}
const nativeFactory=native?await import('data:text/javascript;base64,'+Buffer.from(prelude+'\nexport {createNativeFixture};').toString('base64')):null;
const db=native?await nativeFactory.createNativeFixture():new PGlite();
const require=createRequire(import.meta.url),{normalizeIndex,normalizeRows}=require('../electron/sync/history-index-protocol.cjs');
const literal=x=>"E'"+x.replaceAll('\\','\\\\').replaceAll("'","''").replaceAll('\r','\\r').replaceAll('\n','\\n')+"'";
const id=n=>'aaaaaaaa-aaaa-4aaa-8aaa-'+String(n).padStart(12,'0');
const terminal='bbbbbbbb-bbbb-4bbb-8bbb-000000000001',management='bbbbbbbb-bbbb-4bbb-8bbb-000000000002';
const scope={organizationId:'default',branchId:'A',terminalId:terminal,keepCommerce:false};
let passed=0;
const check=async(name,run)=>{await run();passed++;console.log('PASS '+name);};
const index=async(action='begin',after=null,upper=null,limit=1000,branch='A',term=terminal)=>
 (await db.query('SELECT public.pos_sync_history_index_v1($1,$2,$3,$4,$5,$6,$7,$8) v;',['default',branch,term,action,after,upper,limit,false])).rows[0].v;
const rows=async(ids,keep=false,bytes=2097152)=>
 (await db.query('SELECT public.pos_sync_history_rows_v1($1,$2,$3,$4::jsonb,$5,$6) v;',['default','A',terminal,JSON.stringify(ids),keep,bytes])).rows[0].v;
const state=async()=> (await db.query(`SELECT jsonb_build_object('history',(SELECT jsonb_build_object('count',count(*),'digest',md5(string_agg(md5(to_jsonb(h)::text),'' ORDER BY id))) FROM public.change_history h),
 'feed',(SELECT COALESCE(jsonb_agg(to_jsonb(f) ORDER BY cursor),'[]'::jsonb) FROM public.sync_change_feed f),
 'old',(SELECT jsonb_agg(jsonb_build_object('oid',p.oid,'name',p.proname,'body',md5(p.prosrc),'acl',p.proacl::text,'owner',p.proowner,'config',p.proconfig) ORDER BY p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('change_history_immutable','pos_sync_history_project_v1','pos_sync_pull','pos_sync_validate_read_scope','pos_sync_validate_scope')),
 'new',(SELECT COALESCE(jsonb_agg(jsonb_build_object('oid',p.oid,'name',p.proname,'body',md5(p.prosrc),'acl',p.proacl::text) ORDER BY p.proname),'[]'::jsonb) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('pos_sync_history_index_v1','pos_sync_history_rows_v1','pos_sync_history_feed_insert_v1')),
 'triggers',(SELECT jsonb_agg(jsonb_build_object('name',tgname,'enabled',tgenabled,'definition',pg_get_triggerdef(oid)) ORDER BY tgname) FROM pg_trigger WHERE tgrelid='public.change_history'::regclass AND NOT tgisinternal)) v;`)).rows[0].v;
async function originalDefinitions(){
 for(const f of capture.functions){const m=f.definition.match(/AS (\$\w*\$)([\s\S]*?)\1/);assert(m);await db.exec(f.definition.replace(m[0],()=> 'AS '+literal(m[2])));const roles=['anon','authenticated','service_role'];if(!f.acl?.includes('{=X/'))roles.unshift('PUBLIC');await db.exec(`REVOKE ALL ON FUNCTION public.${f.signature} FROM ${roles.join(',')};GRANT EXECUTE ON FUNCTION public.${f.signature} TO service_role;`);}
}
async function uninstall(){await db.exec('DROP TRIGGER IF EXISTS pos_history_feed_insert_v1 ON public.change_history;DROP FUNCTION IF EXISTS public.pos_sync_history_index_v1(text,text,text,text,uuid,uuid,integer,boolean);DROP FUNCTION IF EXISTS public.pos_sync_history_rows_v1(text,text,text,jsonb,boolean,integer);DROP FUNCTION IF EXISTS public.pos_sync_history_feed_insert_v1();');await originalDefinitions();}
async function rejectMigration(name,mutate,pattern){await uninstall();await mutate();const before=await state();await assert.rejects(db.exec(migration),pattern);assert.deepEqual(await state(),before);await check(name,async()=>{});}
try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;
 CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$SELECT 'service_role'::text$$;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT NULL::uuid$$;`);
 const columns='id uuid,store_id text,branch_id text,scope text,scope_id text,scope_type text,key text,section text,booking_id uuid,po_id uuid,product_id uuid,foc_product_id uuid,transfer_id uuid,from_store_id text,to_store_id text,created_at timestamptz,terminal_id text,movement_id uuid,terminal_token_id text,slug text,group_id text,owner_store_id text,stock_by_store jsonb,organization_id text,entity_type text,entity_id text,auth_user_id uuid,is_active boolean,role text,permissions jsonb,platform text,location_id text,management_sync_enabled boolean,is_claimed boolean,status text,revoked_at timestamptz';
 for(const table of registry.tables)if(table.cloudTable!=='change_history'){
  const type=String(table.columns.find(c=>c.cloudColumn==='id')?.cloudType??'uuid').toLowerCase();assert(/^(uuid|text|integer|bigint)$/.test(type));
  let definition=columns.replace('id uuid,','id '+type+',');
  for(const primary of table.columns.filter(c=>c.primaryKey&&c.cloudColumn!=='id')){
   const pkType=String(primary.cloudType).toLowerCase();assert(/^(uuid|text|integer|bigint)$/.test(pkType));
   definition=definition.replace(new RegExp('\\b'+primary.cloudColumn+' (?:text|uuid)(?=,|$)'),primary.cloudColumn+' '+pkType);
  }
  await db.exec('CREATE TABLE public."'+table.cloudTable+'"('+definition+');');
 }
 await db.exec(`CREATE TABLE public.change_history(id uuid NOT NULL PRIMARY KEY,organization_id text NOT NULL,entity_type text NOT NULL,entity_id text NOT NULL,action text NOT NULL,old_value jsonb,new_value jsonb,revision bigint NOT NULL,scope_type text NOT NULL,scope_id text,changed_by text,source_application text NOT NULL,device_id text,terminal_id text,server_timestamp timestamptz NOT NULL);
 CREATE TABLE public.sync_change_feed(cursor bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,organization_id text NOT NULL,branch_id text NOT NULL,table_name text NOT NULL,entity_id text NOT NULL,operation text NOT NULL CHECK(operation IN('insert','update','delete')),row_version bigint NOT NULL DEFAULT 1,tombstone boolean NOT NULL DEFAULT false,changed_at timestamptz NOT NULL DEFAULT now(),terminal_id text);
 CREATE TABLE public.fixture_ledger(version int PRIMARY KEY);INSERT INTO public.fixture_ledger VALUES(1);
 INSERT INTO public.stores(id) VALUES('A'),('B');
 INSERT INTO public.terminal_tokens(id,platform,location_id,management_sync_enabled,is_claimed,status) VALUES('${terminal}','pc','A',false,true,'active'),('${management}','pc',NULL,true,true,'active');
 INSERT INTO public.change_history SELECT ('aaaaaaaa-aaaa-4aaa-8aaa-'||lpad(i::text,12,'0'))::uuid,'default','products',i::text,'insert',
 jsonb_build_object('table_name','terminal_tokens','claim_proof','PRIVATE','safe',1),
 jsonb_build_object('table_name','products','ecom_price',19.22,'exact',9007199254740993::numeric),
 CASE WHEN i=1 THEN 9007199254740993::bigint ELSE 1 END,'GLOBAL',NULL,NULL,'fixture',NULL,NULL,'2026-11-06T02:03:04.123456+08:00' FROM generate_series(1,2007) i;
 CREATE FUNCTION public.product_available_in_catalogue(product uuid,branch text) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT true$$;
 GRANT USAGE ON SCHEMA public,auth TO service_role;GRANT SELECT ON ALL TABLES IN SCHEMA public TO service_role;`);
 await originalDefinitions();await db.exec('CREATE TRIGGER change_history_no_change BEFORE UPDATE OR DELETE ON public.change_history FOR EACH ROW EXECUTE FUNCTION public.change_history_immutable();');
 const original=await state();
 await check('one tool-owned read-only migration installs two readers and preserves existing triggers and business state',async()=>{assert(!/^\s*(BEGIN|COMMIT)\s*;/mi.test(migration));await db.exec(migration);const after=await state();assert.deepEqual(after.history,original.history);assert.deepEqual(after.feed,original.feed);assert.deepEqual(after.old,original.old);assert.equal(after.new.length,2);assert.deepEqual(after.triggers,original.triggers);});
 await check('exact and alternate-line-ending replays preserve all routine identities and records',async()=>{const before=await state();await db.exec(migration);await db.exec(migration.replaceAll('\r\n','\n').replaceAll('\n',eol==='crlf'?'\n':'\r\n'));assert.deepEqual(await state(),before);});
 await check('bounded scalar index enumerates over1000 actual UUIDs exactly once',async()=>{let after=null,upper=null,seen=[];do{const action=upper===null?'begin':'page';const p=normalizeIndex(await index(action,after,upper),scope,{action,afterId:after,upperId:upper});upper=p.upper_id;seen.push(...p.ids);after=p.next_id;if(p.complete)break;}while(after);assert.equal(seen.length,2007);assert.equal(new Set(seen).size,2007);const finish=normalizeIndex(await index('finish',null,upper),scope,{action:'finish',upperId:upper});assert.equal(finish.range_count,String(seen.length));});
 await check('missing-row wire preserves exact revision/JSON/time and current privacy projection',async()=>{const b=normalizeRows(await rows([id(1),id(2)]),scope,[id(1),id(2)]);assert.equal(b.rows[0].revision,'9007199254740993');assert.match(b.rows[0].new_value_json,/9007199254740993/);assert.equal(b.rows[0].server_timestamp,'2026-11-05T18:03:04.1234560Z');assert(!b.rows[0].old_value_json.includes('PRIVATE'));assert(!b.rows[0].new_value_json.includes('ecom_price'));const keep=normalizeRows(await rows([id(1)],true),{...scope,keepCommerce:true},[id(1)]);assert(keep.rows[0].new_value_json.includes('ecom_price'));});
 await check('read calls preserve all history and feed rows',async()=>{const before=await state();await index();await rows([id(1)]);assert.deepEqual(await state(),before);});
  await check('only reviewed canonical/newline runtime forms work while live migration preflight stays byte-exact',async()=>{
   const before=await state();
   for(const f of capture.functions.filter(f=>['change_history_immutable()','pos_sync_history_project_v1(jsonb,text,boolean)'].includes(f.signature))){const match=f.definition.match(/AS (\$\w*\$)([\s\S]*?)\1/);const body=f.signature==='change_history_immutable()'?" BEGIN RAISE EXCEPTION 'change_history is append-only'; END ":match[2].replaceAll('\r\n','\n').replaceAll('\n','\r\n');await db.exec(f.definition.replace(match[0],()=> 'AS '+literal(body)));}
   await index();await rows([id(1)]);await assert.rejects(db.exec(migration),/HISTORY_INDEX_SOURCE_CHANGED/);await originalDefinitions();assert.deepEqual(await state(),before);
  });
  await check('fresh canonical component retires only the known generated history feed and replays without activating a replacement',async()=>{
   const before=await state(),{historyIndexCanonicalBlock}=require('./history-index-canonical.cjs');const schema=await read('supabase/schema.sql');
   const legacy=schema.match(/CREATE OR REPLACE FUNCTION public\.sync_feed_change_history\(\)[\s\S]*?\$trg\$;/)?.[0];assert(legacy);
   await db.exec('BEGIN');try{
    await uninstall();const f=capture.functions.find(f=>f.signature==='change_history_immutable()'),match=f.definition.match(/AS (\$\w*\$)([\s\S]*?)\1/);
    await db.exec(f.definition.replace(match[0],()=> 'AS '+literal(" BEGIN RAISE EXCEPTION 'change_history is append-only'; END ")));
    await db.exec(legacy+"REVOKE ALL ON FUNCTION public.sync_feed_change_history() FROM PUBLIC,anon,authenticated;CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public.change_history FOR EACH ROW EXECUTE FUNCTION public.sync_feed_change_history();");
    const block=historyIndexCanonicalBlock(source);
    for(const mutation of [
     'ALTER TABLE public.change_history DISABLE TRIGGER sync_feed_change;',
     'DROP TRIGGER sync_feed_change ON public.change_history;CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public.change_history FOR EACH ROW WHEN (true) EXECUTE FUNCTION public.sync_feed_change_history();',
     'ALTER FUNCTION public.sync_feed_change_history() SECURITY INVOKER;',
     legacy.replace('BEGIN INSERT','BEGIN /* unreviewed */ INSERT'),
    ]){await db.exec('SAVEPOINT unknown_canonical');await db.exec(mutation);await assert.rejects(db.exec(block),/HISTORY_INDEX_CANONICAL_TRIGGER/);await db.exec('ROLLBACK TO SAVEPOINT unknown_canonical');}
    await db.exec(block);await index();await rows([id(1)]);
    assert.deepEqual((await state()).triggers.map(t=>t.name),['change_history_no_change']);
    const feedBefore=(await db.query('SELECT count(*) c FROM public.sync_change_feed')).rows[0].c;
    await db.exec(`INSERT INTO public.change_history SELECT '${id(7777)}'::uuid,organization_id,entity_type,entity_id,action,old_value,new_value,revision,scope_type,scope_id,changed_by,source_application,device_id,terminal_id,server_timestamp FROM public.change_history WHERE id='${id(1)}';`);
    assert.equal((await db.query('SELECT count(*) c FROM public.sync_change_feed')).rows[0].c,Number(feedBefore));
    const installed=await state();await db.exec(block.replaceAll('\r\n','\n').replaceAll('\n','\r\n'));assert.deepEqual(await state(),installed);
   }finally{await db.exec('ROLLBACK');}assert.deepEqual(await state(),before);
  });
  await check('runtime rejects a changed immutable trigger even when its known helper still exists',async()=>{
   const before=await state();await db.exec('BEGIN');try{
    await db.exec("DROP TRIGGER change_history_no_change ON public.change_history;CREATE TRIGGER change_history_no_change AFTER INSERT ON public.change_history FOR EACH ROW EXECUTE FUNCTION public.change_history_immutable();");
    await db.exec('SAVEPOINT invalid_index');await assert.rejects(index(),/HISTORY_INDEX_UNSUPPORTED_SOURCE/);await db.exec('ROLLBACK TO SAVEPOINT invalid_index');
    await assert.rejects(rows([id(1)]),/HISTORY_INDEX_UNSUPPORTED_SOURCE/);
   }finally{await db.exec('ROLLBACK');}assert.deepEqual(await state(),before);
  });
  await check('unknown helper whitespace including SQL literal content is never normalized into an admitted body',async()=>{
   const before=await state(),f=capture.functions.find(f=>f.signature==='change_history_immutable()'),match=f.definition.match(/AS (\$\w*\$)([\s\S]*?)\1/);
   for(const body of [match[2].replace('append-only','append-only '),' '+match[2]]){
    await db.exec('BEGIN');try{
     await db.exec(f.definition.replace(match[0],()=> 'AS '+literal(body)));
     await db.exec('SAVEPOINT before_read');await assert.rejects(index(),/HISTORY_INDEX_UNSUPPORTED_SOURCE/);await db.exec('ROLLBACK TO SAVEPOINT before_read');
     await assert.rejects(db.exec(migration),/HISTORY_INDEX_SOURCE_CHANGED/);
    }finally{await db.exec('ROLLBACK');}
   }assert.deepEqual(await state(),before);
  });
  if(native)await check('busy history writers abort migration NOWAIT without any partial schema or data change',async()=>{
   await uninstall();const before=await state();await db.testContention(migration,id(1));assert.deepEqual(await state(),before);await db.exec(migration);
  });
  if(args.includes('--postgrest'))await check('actual protected PostgREST contract under max_rows1000',async()=>{const {verifyHistoryIndexPostgrest}=await import('./test-history-index-postgrest.fixture.mjs');await verifyHistoryIndexPostgrest(db);});
  await check('empty owned history has an explicit empty enumeration and zero range',async()=>{const before=await state();await db.exec('BEGIN');try{await db.exec('TRUNCATE public.change_history');const p=normalizeIndex(await index(),scope,{action:'begin'});assert.equal(p.upper_id,null);assert.deepEqual(p.ids,[]);assert.equal(p.complete,true);assert.equal(normalizeIndex(await index('finish'),scope,{action:'finish',upperId:null}).range_count,'0');}finally{await db.exec('ROLLBACK');}assert.deepEqual(await state(),before);});
 for(const role of ['anon','authenticated'])await check('no public '+role+' RPC execute access',async()=>{await db.exec('SET ROLE '+role);try{await assert.rejects(index(),/permission denied/);await assert.rejects(rows([id(1)]),/permission denied/);}finally{await db.exec('RESET ROLE');}});
 await check('actual existing scope validator denies another branch/unknown terminal',async()=>{await assert.rejects(index('begin',null,null,1000,'B'),/SYNC_TERMINAL_SCOPE_FORBIDDEN/);await assert.rejects(index('begin',null,null,1000,'A',id(99)),/SYNC_TERMINAL_SCOPE_FORBIDDEN/);});
 await check('actual Management read validator retains its existing branch admission',async()=>{assert.equal((await index('begin',null,null,1000,'B',management)).branch_id,'B');});
  await check('revoked normal registration is denied again for each index/row read',async()=>{await db.exec(`UPDATE public.terminal_tokens SET revoked_at=now() WHERE id='${terminal}';`);try{await assert.rejects(index(),/SYNC_TERMINAL_SCOPE_FORBIDDEN/);await assert.rejects(rows([id(1)]),/SYNC_TERMINAL_SCOPE_FORBIDDEN/);}finally{await db.exec(`UPDATE public.terminal_tokens SET revoked_at=NULL WHERE id='${terminal}';`);}});
 await check('invalid UUID lists, excessive limits and absent IDs fail without mutation',async()=>{const before=await state();await assert.rejects(rows([id(1),id(1)]),/HISTORY_ROWS_INVALID_IDS/);await assert.rejects(rows([id(1).toUpperCase()]),/HISTORY_ROWS_INVALID_IDS/);await assert.rejects(rows([id(9000)]),/HISTORY_INDEX_ROW_MISSING/);await assert.rejects(index('begin',null,null,1001),/HISTORY_INDEX_INVALID_ARGUMENT/);await assert.rejects(index('page',id(2),id(1)),/HISTORY_INDEX_INVALID_ARGUMENT/);assert.deepEqual(await state(),before);});
  await check('future INSERT emits no new history feed for old clients and immutable changes remain refused',async()=>{await db.exec(`INSERT INTO public.change_history SELECT '${id(3000)}'::uuid,organization_id,entity_type,entity_id,action,old_value,new_value,revision,scope_type,scope_id,changed_by,source_application,device_id,terminal_id,server_timestamp FROM public.change_history WHERE id='${id(1)}';`);assert.equal((await db.query('SELECT count(*) c FROM public.sync_change_feed')).rows[0].c,0);await assert.rejects(db.exec(`UPDATE public.change_history SET revision=2 WHERE id='${id(3000)}';`),/append.only|immutable/i);await assert.rejects(db.exec(`DELETE FROM public.change_history WHERE id='${id(3000)}';`),/append.only|immutable/i);assert.equal((await db.query('SELECT count(*) c FROM public.sync_change_feed')).rows[0].c,0);});
  await check('captured core pull still delivers ordinary rows while new history is available only through exact readers',async()=>{await db.exec(`INSERT INTO public.products(id) VALUES('${id(8998)}');INSERT INTO public.sync_change_feed(organization_id,branch_id,table_name,entity_id,operation) VALUES('default','A','products','{"id":"${id(8998)}"}','insert');`);const result=await db.query(`SELECT public.pos_sync_history_project_v1(to_jsonb(f),'',false) v FROM public.pos_sync_pull('default','A','${terminal}',0,10) f;`);assert.equal(result.rows.length,1);assert.equal(result.rows[0].v.table_name,'products');assert.equal(result.rows[0].v.row_data.id,id(8998));assert.equal(normalizeRows(await rows([id(3000)]),scope,[id(3000)]).rows[0].revision,'9007199254740993');});
  await check('byte-bound missing-row prefix retains the remaining IDs and permits one oversized safe row',async()=>{const before=await state();await db.exec('BEGIN');try{await db.exec(`INSERT INTO public.change_history SELECT ('aaaaaaaa-aaaa-4aaa-8aaa-'||lpad(i::text,12,'0'))::uuid,organization_id,entity_type,entity_id,action,NULL,jsonb_build_object('image',repeat('x',1200000)),revision,scope_type,scope_id,changed_by,source_application,device_id,terminal_id,server_timestamp FROM public.change_history CROSS JOIN generate_series(4000,4001) i WHERE id='${id(1)}';`);const b=normalizeRows(await rows([id(4000),id(4001)]),scope,[id(4000),id(4001)]);assert.equal(b.rows.length,1);assert.deepEqual(b.remaining_ids,[id(4001)]);const over=normalizeRows(await rows([id(4000)],false,1024),scope,[id(4000)]);assert(Buffer.byteLength(JSON.stringify(over))>1024);assert.equal(over.rows.length,1);}finally{await db.exec('ROLLBACK');}assert.deepEqual(await state(),before);});
  await check('hard oversized row and unsupported BC timestamp are refused without truncation',async()=>{const before=await state();await db.exec('BEGIN');try{await db.exec(`INSERT INTO public.change_history SELECT '${id(5000)}'::uuid,organization_id,entity_type,entity_id,action,NULL,jsonb_build_object('image',repeat('x',5242880)),revision,scope_type,scope_id,changed_by,source_application,device_id,terminal_id,server_timestamp FROM public.change_history WHERE id='${id(1)}';`);await assert.rejects(rows([id(5000)]),/HISTORY_ROWS_SINGLE_ROW_TOO_LARGE/);}finally{await db.exec('ROLLBACK');}await db.exec('BEGIN');try{await db.exec(`INSERT INTO public.change_history SELECT '${id(5001)}'::uuid,organization_id,entity_type,entity_id,action,NULL,NULL,revision,scope_type,scope_id,changed_by,source_application,device_id,terminal_id,'0001-01-01 BC'::timestamptz FROM public.change_history WHERE id='${id(1)}';`);await assert.rejects(rows([id(5001)]),/HISTORY_ROWS_TIMESTAMP_UNSUPPORTED/);}finally{await db.exec('ROLLBACK');}assert.deepEqual(await state(),before);});
 await rejectMigration('unknown projection helper aborts without overwrite',()=>db.exec('ALTER FUNCTION public.pos_sync_history_project_v1(jsonb,text,boolean) SECURITY DEFINER'),/HISTORY_INDEX_SOURCE_CHANGED/);
 await rejectMigration('disabled immutable guard aborts',()=>db.exec('ALTER TABLE public.change_history DISABLE TRIGGER change_history_no_change'),/HISTORY_INDEX_TRIGGER_CHANGED/);await db.exec('ALTER TABLE public.change_history ENABLE TRIGGER change_history_no_change');
 await rejectMigration('unknown table column aborts',()=>db.exec('ALTER TABLE public.change_history ADD COLUMN unexpected text'),/HISTORY_INDEX_SHAPE_CHANGED/);await db.exec('ALTER TABLE public.change_history DROP COLUMN unexpected');
  await uninstall();await db.exec(migration);
  await check('changed installed RPC grants cannot be silently overwritten on replay',async()=>{await db.exec('GRANT EXECUTE ON FUNCTION public.pos_sync_history_index_v1(text,text,text,text,uuid,uuid,integer,boolean) TO PUBLIC');const before=await state();await assert.rejects(db.exec(migration),/HISTORY_INDEX_INSTALLED_CHANGED/);assert.deepEqual(await state(),before);});
 await uninstall();const beforeLate=await state();const marker='IF round=2 THEN';assert.equal(migration.split(marker).length,2);await check('late DDL failure rolls both readers back and preserves immutable trigger',async()=>{await assert.rejects(db.exec(migration.replace(marker,"IF round=2 THEN RAISE EXCEPTION 'fixture late failure'; END IF; "+marker)),/fixture late failure/);assert.deepEqual(await state(),beforeLate);});
 await check('tool ledger failure rolls the complete migration transaction back',async()=>{const before=await state();await db.exec('BEGIN');await db.exec(migration);await assert.rejects(db.exec('INSERT INTO public.fixture_ledger VALUES(1)'),/duplicate key/);await db.exec('ROLLBACK');assert.deepEqual(await state(),before);});
 console.log('PASS '+passed+' isolated automatic history SQL groups ('+(native?'native':'PGlite')+', '+eol+')');
}catch(error){console.error(error.name+': '+error.message);if(error.internalQuery&&error.internalPosition)console.error(error.internalQuery.slice(Math.max(0,Number(error.internalPosition)-150),Number(error.internalPosition)+100));process.exitCode=1;}finally{await db.close();}
