// Opt-in disposable native PostgreSQL only; never reads a database URL/profile.
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

assert.deepEqual(process.argv.slice(2),['--run']);
const bin=process.env.POSTGRES_TEST_BIN;
assert(bin,'Provide isolated portable POSTGRES_TEST_BIN, never an existing database URL');
const root=fileURLToPath(new URL('../',import.meta.url));
const base=resolve(root,'.tmp/projection-performance');
await mkdir(base,{recursive:true});
const directory=await mkdtemp(join(base,'owned-'));
const port=await new Promise((resolvePort,reject)=>{const server=createServer();server.once('error',reject);server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(error=>error?reject(error):resolvePort(port));});});
const command=(name,args,options={})=>execFileSync(join(bin,name+'.exe'),args,{encoding:'utf8',windowsHide:true,timeout:30_000,maxBuffer:8*1024*1024,...options});
const query=text=>command('psql',['-X','-q','-t','-A','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-h','127.0.0.1','-p',String(port),'-U','postgres','-d','postgres'],{input:text,env:{...process.env,PGCLIENTENCODING:'UTF8'}}).trim();
const original=await readFile(new URL('../supabase/migrations/20261103074926_protected_byte_bounded_history_download.sql',import.meta.url),'utf8');
const correction=await readFile(new URL('../supabase/migrations/20261103091907_optimize_protected_history_projection.sql',import.meta.url),'utf8');
const helper=original.slice(0,original.indexOf('REVOKE ALL ON FUNCTION public.pos_sync_history_project_v1'));
let started=false;
try {
  command('initdb',['-D',directory,'-A','trust','-U','postgres','--encoding=UTF8','--locale=C','--no-instructions']);
  started=true;
  command('pg_ctl',['-D',directory,'-l',join(directory,'fixture.log'),'-o',`-h 127.0.0.1 -p ${port} -c max_connections=10 -c shared_buffers=32MB`,'-w','start'],{stdio:'ignore'});
  query(helper);
  query(`CREATE TABLE fixture(id integer,payload jsonb);
    WITH wide AS (SELECT jsonb_object_agg(lpad(n::text,5,'0'),CASE WHEN n<=3 THEN to_jsonb(n%2=0) ELSE to_jsonb('v'::text) END) value FROM generate_series(1,57899) n),
    image AS (SELECT jsonb_build_object('id','fixture','a',1,'b',2,'c',3,'d',4,'e',5,'f',6,'g',7,'stock_by_store',value) value FROM wide)
    INSERT INTO fixture SELECT 1,jsonb_build_object('id','fixture','table_name','products','old_value',value,'new_value',value) FROM image;
    INSERT INTO fixture SELECT 2,jsonb_build_object('table_name','products','items',jsonb_agg(jsonb_build_object('ecom_price',n,'price',n,'ecommerceEnabled',true))) FROM generate_series(1,10000) n;
    INSERT INTO fixture SELECT 3,jsonb_build_object('table_name','terminal_tokens','claim_proof','fixture-secret','nested',jsonb_build_object('claimed_proof_hash','fixture-secret','safe','雪😀'));`);
  const metadata=JSON.parse(query(`SELECT jsonb_build_object('old_bytes',octet_length((payload->'old_value')::text),'new_bytes',octet_length((payload->'new_value')::text),'wide_keys',(SELECT count(*) FROM jsonb_object_keys(payload->'old_value'->'stock_by_store'))) FROM fixture WHERE id=1;`));
  assert.equal(metadata.wide_keys,57899);
  const before=JSON.parse(query(`SELECT to_jsonb(p)-'prosrc'-'probin' FROM pg_proc p WHERE oid='public.pos_sync_history_project_v1(jsonb,text,boolean)'::regprocedure;`));
  const benchmark=`SET statement_timeout='8s'; SELECT octet_length(public.pos_sync_history_project_v1(payload,'change_history',false)::text) FROM fixture WHERE id=1;`;
  const oldStarted=performance.now();
  let oldError;
  try{query(benchmark);}catch(error){oldError=error;}
  assert(oldError,'The old helper must reproduce the structured-object timeout');
  assert.match(String(oldError.stderr),/57014|statement timeout/);
  const oldMs=Math.round(performance.now()-oldStarted);
  query(correction);
  const after=JSON.parse(query(`SELECT to_jsonb(p)-'prosrc'-'probin' FROM pg_proc p WHERE oid='public.pos_sync_history_project_v1(jsonb,text,boolean)'::regprocedure;`));
  assert.deepEqual(after,before,'Only the helper body may change; identity, ACL and attributes stay exact');
  const newStarted=performance.now();
  const optimized=JSON.parse(query(`SET statement_timeout='8s'; WITH started AS MATERIALIZED (SELECT clock_timestamp() at), projected AS MATERIALIZED (SELECT public.pos_sync_history_project_v1(payload,'change_history',false) value,started.at FROM fixture CROSS JOIN started WHERE id=1) SELECT jsonb_build_object('bytes',octet_length(value::text),'server_ms',EXTRACT(EPOCH FROM(clock_timestamp()-at))*1000) FROM projected;`));
  assert(optimized.bytes>1_500_000);
  const newMs=Math.round(performance.now()-newStarted);
  assert(newMs<8000,'Corrected structured projection must meet the unchanged 8-second budget');
  query(`SET statement_timeout='8s'; SELECT public.pos_sync_history_project_v1(payload,'change_history',false) FROM fixture WHERE id=2;`);
  assert.equal(query(`SELECT public.pos_sync_history_project_v1(payload,'change_history',false)#>>'{nested,safe}' FROM fixture WHERE id=3;`),'雪😀');
  assert.equal(query(`SELECT public.pos_sync_history_project_v1(payload,'change_history',false)#>>'{nested,claimed_proof_hash}' IS NULL FROM fixture WHERE id=3;`),'t');
  const again=JSON.parse(query(`SELECT to_jsonb(p) FROM pg_proc p WHERE oid='public.pos_sync_history_project_v1(jsonb,text,boolean)'::regprocedure;`));
  query(correction);
  const current=JSON.parse(query(`SELECT to_jsonb(p) FROM pg_proc p WHERE oid='public.pos_sync_history_project_v1(jsonb,text,boolean)'::regprocedure;`));
  assert.deepEqual(again,current);
  console.log(`PASS native PostgreSQL: old structured helper times out at ${oldMs}ms; optimized same payload ${newMs}ms wall / ${Math.round(optimized.server_ms)}ms server under unchanged8s; ${metadata.wide_keys} scalar keys / image; ${metadata.old_bytes}+${metadata.new_bytes} bytes; ACL/owner/attributes retained; structured array and nested privacy pass.`);
}finally{
  if(started){assert(resolve(directory).startsWith(base+sep));command('pg_ctl',['-D',directory,'-m','immediate','-w','stop'],{stdio:'ignore'});}
}
