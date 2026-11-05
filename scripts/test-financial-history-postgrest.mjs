// Owned PostgreSQL/PostgREST contract acceptance only. No operator URL/profile.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,readFile} from 'node:fs/promises';
import {join,resolve,sep,dirname} from 'node:path';
import {execFileSync,spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {createHmac,randomBytes,randomUUID,createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import Module from 'node:module';
assert.deepEqual(process.argv.slice(2),['--run']);
const bin=process.env.POSTGRES_TEST_BIN,postgrest=process.env.POSTGREST_TEST_EXE;
assert(bin&&postgrest,'Existing owned test binaries required; no database URL accepted');
const env={...process.env};for(const key of Object.keys(env))if(/^PG/i.test(key)||key==='DATABASE_URL')delete env[key];
const freePort=()=>new Promise((accept,reject)=>{const server=createServer();server.once('error',reject);server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>accept(port));});});
const base=resolve('.tmp/financial-history-postgrest');await mkdir(base,{recursive:true});
const directory=await mkdtemp(join(base,'owned-')),pgPort=await freePort(),httpPort=await freePort();
const command=(name,args,options={})=>execFileSync(join(bin,name+'.exe'),args,{env,encoding:'utf8',windowsHide:true,timeout:30000,...options});
const read=file=>readFile(new URL('../'+file,import.meta.url),'utf8');
const sleep=ms=>new Promise(accept=>setTimeout(accept,ms));
let started=false,worker,passed=0;
try{
 command('initdb',['-D',directory,'-A','trust','-U','postgres','--encoding=UTF8','--locale=C','--no-instructions']);
 command('pg_ctl',['-D',directory,'-l',join(directory,'fixture.log'),'-o',`-h 127.0.0.1 -p ${pgPort} -c max_connections=8 -c shared_buffers=32MB`,'-w','start'],{stdio:'ignore'});started=true;
 const execute=text=>command('psql',['-X','-q','-t','-A','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p',String(pgPort),'-U','postgres','-d','postgres'],{input:text});
 const quote=value=>value===null?'NULL':"'"+String(value).replaceAll("'","''")+"'";
 const db={exec:async text=>execute(text),query:async(text,params=[])=>{text=text.replace(/\$(\d+)/g,(_,n)=>quote(params[Number(n)-1])).trim().replace(/;$/,'');if(!/^(SELECT|WITH)\b/i.test(text)){execute(text);return{rows:[]};}return{rows:JSON.parse(execute(`SELECT coalesce(json_agg(r),'[]') FROM (${text}) r;`))};},close:async()=>{}};
 const require=createRequire(import.meta.url),helper=require.resolve('./lib/shift-protocol-integration-fixture.cjs'),source=await read('scripts/lib/shift-protocol-integration-fixture.cjs');
 const anchor="const db = new PGlite(), schema = read('supabase/schema.sql');";assert(source.includes(anchor));
 globalThis.__fin62PostgrestOwned=db;
 try{const fixture=new Module(helper);fixture.filename=helper;fixture.paths=Module._nodeModulePaths(dirname(helper));fixture._compile(source.replace(anchor,"const db = globalThis.__fin62PostgrestOwned, schema = read('supabase/schema.sql');"),helper);await fixture.exports.createCloud('A','fixture-terminal',{financialRolloutStub:false});}finally{delete globalThis.__fin62PostgrestOwned;}
 await db.exec("INSERT INTO stores VALUES('A','A'),('B','B'); ALTER TABLE terminal_tokens ADD management_sync_enabled boolean DEFAULT false;");
 for(const captured of JSON.parse(await read('scripts/fixtures/management-shift-read-validators.json'))){assert.equal(createHash('sha256').update(captured.definition).digest('hex'),captured.sha256);await db.exec(captured.definition);}
 for(const file of ['shift-financial-math-postgres.sql','shift-financial-cloud-receipts.sql','shift-financial-version-receipts.sql','shift-financial-known-basis.sql','shift-financial-opening-origin.sql','shift-financial-admission.sql','shift-financial-operation-history.sql'])await db.exec(await read('scripts/preparation/'+file));
 await db.exec("ALTER TABLE terminal_tokens ADD COLUMN IF NOT EXISTS platform text NOT NULL DEFAULT 'pc';");
 await db.exec("ALTER TABLE terminal_tokens ADD COLUMN IF NOT EXISTS claimed_at timestamptz;");
 await db.exec(await read('scripts/preparation/shift-financial-rollout-capability.sql'));
 await db.exec(`CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role',current_setting('test.auth_role',true)) $$;`);
 const shift=randomUUID();await db.exec("SET pos.shift_fn='on';");await db.query("INSERT INTO shifts(id,store_id,terminal_id,status,state,opening_float,row_version,opened_at) VALUES($1,'A','fixture-terminal','OPEN','ACTIVE',20,1,now())",[shift]);await db.exec("SET pos.shift_fn='';");
 const secret=randomBytes(48).toString('hex'),encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
 const unsigned=encode({alg:'HS256',typ:'JWT'})+'.'+encode({role:'service_role',exp:Math.floor(Date.now()/1000)+300});
 const token=unsigned+'.'+createHmac('sha256',secret).update(unsigned).digest('base64url');
 assert.equal(execFileSync(postgrest,['--version'],{encoding:'utf8',windowsHide:true}).trim(),'PostgREST 16.5');
 worker=spawn(postgrest,[],{windowsHide:true,stdio:'ignore',env:{...env,PGRST_DB_URI:`postgresql://postgres@127.0.0.1:${pgPort}/postgres?sslmode=disable`,PGRST_DB_SCHEMAS:'public',PGRST_DB_ANON_ROLE:'anon',PGRST_DB_POOL:'1',PGRST_DB_CHANNEL_ENABLED:'false',PGRST_DB_CONFIG:'false',PGRST_SERVER_HOST:'127.0.0.1',PGRST_SERVER_PORT:String(httpPort),PGRST_JWT_SECRET:secret,PGRST_LOG_LEVEL:'error'}});
 const url=`http://127.0.0.1:${httpPort}`;
 for(let n=0;n<80;n++){try{if((await fetch(url,{signal:AbortSignal.timeout(1000)})).status!==503)break;}catch{}await sleep(100);}
 const call=(name,args,authenticated=true)=>fetch(`${url}/rpc/${name}`,{method:'POST',headers:{'content-type':'application/json',...(authenticated?{authorization:`Bearer ${token}`}:{})},body:JSON.stringify(args),signal:AbortSignal.timeout(10000)});
 const scope={p_org:'default',p_branch:'A',p_terminal:'fixture-terminal'};
 const capability=async(extra={})=>{const response=await call('pos_sync_financial_capability',{...scope,p_shift:null,...extra});assert.equal(response.status,200,await response.clone().text());return response.json();};
 assert.equal((await capability()).mode,'disabled');passed++;console.log('PASS actual capability has no implicit activation');
 assert((await call('pos_sync_financial_capability',{...scope,p_shift:null},false)).status>=400);
 assert((await call('pos_sync_financial_capability',{...scope,p_branch:'B',p_shift:null})).status>=400);passed++;
 const rollout=randomUUID();await db.query("INSERT INTO fin62_rollout_preparation.approvals(organization_id,branch_id,terminal_id,revision,rollout_id,status) VALUES('default','A','fixture-terminal',1,$1,'approved')",[rollout]);
 assert.equal((await capability()).mode,'blocked');passed++;console.log('PASS approved metadata alone cannot enable an incomplete installation');
 // Isolated readiness stand-in tests capability decisions only; full writer
 // fingerprint readiness is exercised by the separate actual-writer fixture.
 await db.exec("CREATE FUNCTION public.pos_live_financial_ready() RETURNS jsonb LANGUAGE sql AS $$ SELECT '{\"ready\":true,\"version\":2}'::jsonb $$;");
 assert.equal((await capability()).mode,'required');passed++;
 await db.exec("INSERT INTO terminal_tokens(id,location_id,status,platform) VALUES('peer-b','B','used','pc'),('management',NULL,'used','pc'),('phone','A','used','mobile');INSERT INTO terminal_tokens(id,location_id,status,platform,is_claimed) VALUES('unused-code','A','active','pc',false);");
 assert.equal((await capability()).mode,'required');passed++;
 await db.exec("INSERT INTO terminal_tokens(id,location_id,status,platform) VALUES('peer-a','A','used','pc');");
 assert.equal((await capability()).mode,'blocked');
 await db.query("INSERT INTO fin62_rollout_preparation.approvals(organization_id,branch_id,terminal_id,revision,rollout_id,status) VALUES('default','A','peer-a',1,$1,'approved')",[rollout]);
 assert.equal((await capability()).mode,'required');passed++;
 await db.query("INSERT INTO fin62_rollout_preparation.approvals(organization_id,branch_id,terminal_id,revision,rollout_id,status) VALUES('default','A','peer-a',2,$1,'revoked')",[rollout]);
 assert.equal((await capability()).mode,'blocked');
 await db.query("INSERT INTO fin62_rollout_preparation.approvals(organization_id,branch_id,terminal_id,revision,rollout_id,status) VALUES('default','A','peer-a',3,$1,'approved')",[rollout]);
 assert.equal((await capability()).mode,'required');passed++;
 await assert.rejects(db.exec("UPDATE fin62_rollout_preparation.approvals SET status='revoked' WHERE terminal_id='peer-a';"),/immutable/i);passed++;
 assert.equal((await capability({p_shift:shift})).shiftMode,'legacy');
 assert.equal((await capability({p_shift:randomUUID()})).shiftMode,'unknown');
 await db.query("INSERT INTO fin62_history_preparation.protected_shifts(shift_id,branch_id) VALUES($1,'A')",[shift]);
 assert.equal((await capability({p_shift:shift})).shiftMode,'required');
 await db.query('DELETE FROM fin62_history_preparation.protected_shifts WHERE shift_id=$1',[shift]);passed++;
 const missingProtected=randomUUID();await db.query("INSERT INTO fin62_history_preparation.protected_shifts(shift_id,branch_id) VALUES($1,'A')",[missingProtected]);
 assert.equal((await capability({p_shift:missingProtected})).shiftMode,'required');
 await db.query('DELETE FROM fin62_history_preparation.protected_shifts WHERE shift_id=$1',[missingProtected]);passed++;
 await db.query("INSERT INTO fin62_rollout_preparation.approvals(organization_id,branch_id,terminal_id,revision,rollout_id,status) VALUES('default','A','fixture-terminal',2,$1,'revoked')",[rollout]);
 const revoked=await capability();assert.equal(revoked.mode,'blocked');assert.equal(revoked.revision,'2');passed++;
 assert.equal((await db.query("SELECT has_table_privilege('service_role','fin62_rollout_preparation.approvals','INSERT') permitted")).rows[0].permitted,false);passed++;
 const readArgs={...scope,p_shift:shift};
 const response=await call('pos_sync_read_financial_basis',readArgs);assert.equal(response.status,200,await response.clone().text());const basis=await response.json();
 assert.equal(typeof basis.basisJson,'string');assert.equal(createHash('sha256').update(basis.basisJson).digest('hex'),basis.basisHash);assert.equal(JSON.parse(basis.basisJson).inputs.length,0);passed++;console.log('PASS actual PostgREST exact baseline text/hash and named read parameters');
 assert.deepEqual(Object.keys(basis.sourceEvidence).sort(),['creatorXid','evidenceOrder','snapshot']);
 assert.match(basis.sourceEvidence.creatorXid,/^\d+$/);assert.match(basis.sourceEvidence.evidenceOrder,/^\d+$/);assert.equal(typeof basis.sourceEvidence.snapshot,'string');
 assert.deepEqual(basis.ownPublishedThrough,{});passed++;console.log('PASS actual PostgREST server-owned MVCC evidence and empty publication frontier');
 const cases=[
  ['pos_sync_register_financial_event',{...scope,p_raw:'{}',p_proof:{}}],
  ['pos_sync_register_financial_observation',{...scope,p_raw:'{}'}],
  ['pos_sync_register_financial_boundary',{...scope,p_raw_graph:'{}',p_graph_author:{},p_financial_basis:{}}],
  ['pos_sync_register_financial_open',{...scope,p_batch:randomUUID(),p_local_aggregate:randomUUID(),p_opening_json:'{}',p_row_hash:'a'.repeat(64),p_operations:[],p_opening_envelope:'{}',p_proof:{}}],
  ['pos_sync_push_financial_business_aggregate',{...scope,p_batch:randomUUID(),p_operations:[]}],
  ['pos_sync_push_financial_shift_intent',{p_batch_id:randomUUID(),p_organization_id:'default',p_branch_id:'A',p_terminal_id:'fixture-terminal',p_operations:null,p_shift_intent:{},p_shift_author:{},p_author_authority:{},p_closing_start:null,p_start_authority:null,p_financial_basis:{}}],
 ];
 for(const[name,args]of cases){const reply=await call(name,args),body=await reply.json();assert.notEqual(reply.status,404,JSON.stringify(body));assert.notEqual(body.code,'PGRST202');assert(!String(body.code??'').startsWith('PGRST'),JSON.stringify(body));passed++;console.log('PASS actual named PostgREST contract '+name);const denied=await call(name,args,false);assert(denied.status>=400);passed++;}
 assert((await call('pos_sync_read_financial_basis',{...readArgs,p_branch:'B'})).status>=400);passed++;
 const forbidden=await fetch(`${url}/rpc/pos_sync_register_financial_event`,{method:'GET',headers:{authorization:`Bearer ${token}`},signal:AbortSignal.timeout(10000)});assert(forbidden.status>=400);passed++;
 const written=await db.query('SELECT (SELECT count(*)::int FROM fin62_history_preparation.nodes) events,(SELECT count(*)::int FROM fin62_history_preparation.protected_shifts) activated,(SELECT count(*)::int FROM sales) sales');assert.deepEqual(written.rows[0],{events:0,activated:0,sales:0});passed++;
 console.log(`PASS ${passed} actual PostgreSQL/PostgREST financial API contract/access groups; no activation or business publication`);
}finally{
 if(worker&&worker.exitCode===null){worker.kill();await Promise.race([new Promise(accept=>worker.once('exit',accept)),sleep(3000)]);}
 if(started)command('pg_ctl',['-D',directory,'-m','fast','-w','stop'],{stdio:'ignore'});
 assert(resolve(directory).startsWith(base+sep));await rm(directory,{recursive:true});console.log('Cleaned owned financial PostgREST fixture '+directory.split(sep).at(-1));
}
