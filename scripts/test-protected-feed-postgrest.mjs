// Opt-in actual PostgreSQL/PostgREST. Only starts a unique disposable cluster.
import assert from 'node:assert/strict';
import { mkdtemp,mkdir,rm } from 'node:fs/promises';
import { join,resolve,sep } from 'node:path';
import { execFileSync,spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createHmac,randomBytes } from 'node:crypto';
import { installFeedFixture } from './lib/feed-page-fixture.mjs';
assert.deepEqual(process.argv.slice(2),['--run']);
const bin=process.env.POSTGRES_TEST_BIN,postgrest=process.env.POSTGREST_TEST_EXE;
assert(bin&&postgrest,'Existing test binary paths required; no installation or live database URL accepted');
const env={...process.env};for(const k of Object.keys(env))if(/^PG/i.test(k)||k==='DATABASE_URL')delete env[k];
const freePort=()=>new Promise((accept,reject)=>{const s=createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>accept(p));});});
const base=resolve('.tmp/feed-postgrest-acceptance');await mkdir(base,{recursive:true});
const directory=await mkdtemp(join(base,'owned-')),pgPort=await freePort(),httpPort=await freePort();
const command=(name,args,options={})=>execFileSync(join(bin,name+'.exe'),args,{env,encoding:'utf8',windowsHide:true,timeout:30000,...options});
let started=false,worker,passed=0;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
try{
 command('initdb',['-D',directory,'-A','trust','-U','postgres','--encoding=UTF8','--locale=C','--no-instructions']);
 command('pg_ctl',['-D',directory,'-l',join(directory,'fixture.log'),'-o',`-h 127.0.0.1 -p ${pgPort} -c max_connections=8 -c shared_buffers=32MB`,'-w','start'],{stdio:'ignore'});started=true;
 const execute=text=>command('psql',['-X','-q','-t','-A','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p',String(pgPort),'-U','postgres','-d','postgres'],{input:text});
 const quote=v=>v===null?'NULL':"'"+String(v).replaceAll("'","''")+"'";
 const db={exec:async text=>execute(text),query:async(text,params=[])=>{text=text.replace(/\$(\d+)/g,(_,i)=>quote(params[Number(i)-1])).trim().replace(/;$/,'');return {rows:JSON.parse(execute(`SELECT coalesce(json_agg(r),'[]') FROM (${text}) r;`))};}};
 await installFeedFixture(db);
 const insert=(cursor,data,tombstone=false)=>db.exec(`INSERT INTO fixture_feed VALUES(${cursor},'A','change_history','fixture','U',1,${tombstone},${quote(JSON.stringify(data))}::jsonb);`);
 await insert('9007199254740993',{table_name:'terminal_tokens',new_value:{claim_proof:'secret',safe:'雪😀'}});
 await insert('9007199254740994',null,true);
 const secret=randomBytes(48).toString('hex'),encode=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
 const signed=encode({alg:'HS256',typ:'JWT'})+'.'+encode({role:'service_role',exp:Math.floor(Date.now()/1000)+300});
 const token=signed+'.'+createHmac('sha256',secret).update(signed).digest('base64url');
 assert.equal(execFileSync(postgrest,['--version'],{encoding:'utf8',windowsHide:true}).trim(),'PostgREST 16.5');
 worker=spawn(postgrest,[],{windowsHide:true,stdio:'ignore',env:{...env,PGRST_DB_URI:`postgresql://postgres@127.0.0.1:${pgPort}/postgres?sslmode=disable`,PGRST_DB_SCHEMAS:'public',PGRST_DB_ANON_ROLE:'anon',PGRST_DB_POOL:'1',PGRST_DB_CHANNEL_ENABLED:'false',PGRST_DB_CONFIG:'false',PGRST_SERVER_HOST:'127.0.0.1',PGRST_SERVER_PORT:String(httpPort),PGRST_JWT_SECRET:secret,PGRST_LOG_LEVEL:'error'}});
 const url=`http://127.0.0.1:${httpPort}`;
 for(let i=0;i<80;i++){try{if((await fetch(url,{signal:AbortSignal.timeout(1000)})).status!==503)break;}catch{}await sleep(100);}
 const call=(overrides={},auth=true)=>fetch(url+'/rpc/pos_sync_feed_page_v1',{method:'POST',headers:{'Content-Type':'application/json','Accept-Encoding':'identity',...(auth?{Authorization:'Bearer '+token}:{})},body:JSON.stringify({p_organization_id:'default',p_branch_id:'A',p_terminal_id:'terminal',p_after_cursor:'0',p_keep_commerce:false,p_max_bytes:2097152,...overrides}),signal:AbortSignal.timeout(15000)});
 const inspect=async response=>{assert.equal(response.status,200,await response.clone().text());const bytes=Buffer.from(await response.arrayBuffer());assert.equal(response.headers.get('x-pos-feed-projection'),'1');assert.equal(Number(response.headers.get('x-pos-feed-bytes')),bytes.length);const rows=JSON.parse(bytes);assert.equal(Number(response.headers.get('x-pos-feed-rows')),rows.length);return {rows,text:bytes.toString(),response};};
 const small=await inspect(await call());assert(small.text.includes('9007199254740993'));assert(!small.text.includes('secret'));assert.equal(small.rows[1].row_data,null);assert.equal(small.rows[1].tombstone,true);passed++;
 assert.equal((await call({},false)).status,401);assert.equal((await call({p_branch_id:'B'})).status,400);passed++;
 await db.exec('TRUNCATE fixture_feed');await insert('1',{wide:'雪'.repeat(400000)});await insert('2',{wide:'x'.repeat(1200000)});await insert('3',{small:true});
 const prefix=await inspect(await call());assert.equal(prefix.rows.length,1);assert.equal(prefix.response.headers.get('x-pos-feed-continue'),'1');const rest=await inspect(await call({p_after_cursor:'1'}));assert.equal(rest.rows.length,2);passed++;
 await db.exec('TRUNCATE fixture_feed');await insert('1',{wide:'x'.repeat(3*1024*1024)});const singleton=await inspect(await call());assert(singleton.text.length>2097152&&singleton.text.length<=5242880);passed++;
 await db.exec('TRUNCATE fixture_feed');await insert('1',{wide:'x'.repeat(5242880)});const denied=await call();assert.equal(denied.status,500);assert((await denied.text()).includes('POS_FEED_STREAM_ROW_TOO_LARGE'));passed++;
 console.log(`PASS ${passed} actual PostgreSQL/PostgREST16.5 feed wire/bigint/privacy/prefix/oversize/access groups`);
}finally{
 if(worker&&worker.exitCode===null){worker.kill();await Promise.race([new Promise(r=>worker.once('exit',r)),sleep(3000)]);}
 if(started)command('pg_ctl',['-D',directory,'-m','fast','-w','stop'],{stdio:'ignore'});
 assert(resolve(directory).startsWith(base+sep));await rm(directory,{recursive:true});console.log('Cleaned owned feed fixture '+directory.split(sep).at(-1));
}
