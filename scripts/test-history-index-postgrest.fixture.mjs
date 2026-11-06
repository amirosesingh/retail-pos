// Called only with an owned native fixture created by the SQL harness.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {resolve,join,sep} from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {createServer} from 'node:net';
import {createHmac,randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
const {normalizeIndex,normalizeRows}=createRequire(import.meta.url)('../electron/sync/history-index-protocol.cjs');
export async function verifyHistoryIndexPostgrest(db){
 const exe=process.env.POSTGREST_TEST_EXE;assert(exe);assert.equal(execFileSync(exe,['--version'],{encoding:'utf8',windowsHide:true,timeout:10000}).trim(),'PostgREST 16.5');
 const {port:pgPort,directory}=db.historyRest??{};assert(Number.isInteger(pgPort)&&pgPort>0&&resolve(directory).startsWith(resolve('.tmp/seven-shift-summary-tests')+sep));
 const port=await new Promise((yes,no)=>{const server=createServer();server.once('error',no);server.listen(0,'127.0.0.1',()=>{const p=server.address().port;server.close(()=>yes(p));});});
 const secret=randomBytes(48).toString('hex'),encode=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
 const token=role=>{const value=encode({alg:'HS256',typ:'JWT'})+'.'+encode({role,exp:Math.floor(Date.now()/1000)+600});return value+'.'+createHmac('sha256',secret).update(value).digest('base64url');};
 const config=join(directory,'history-index-postgrest.conf');
 writeFileSync(config,`db-uri = "postgresql://postgres@127.0.0.1:${pgPort}/postgres?sslmode=disable"\ndb-schemas = "public"\ndb-anon-role = "anon"\ndb-max-rows = 1000\ndb-pool = 1\ndb-channel-enabled = false\nserver-host = "127.0.0.1"\nserver-port = ${port}\njwt-secret = "${secret}"\nlog-level = "error"\n`);
 await db.exec('CREATE FUNCTION public.fixture_history_set_rows() RETURNS TABLE(n integer) LANGUAGE sql STABLE AS $$SELECT generate_series(1,2007)$$;REVOKE ALL ON FUNCTION public.fixture_history_set_rows() FROM PUBLIC;GRANT EXECUTE ON FUNCTION public.fixture_history_set_rows() TO service_role;');
 const env={...process.env};for(const key of Object.keys(env))if(/^PG|^PGRST_/i.test(key)||key==='DATABASE_URL')delete env[key];
 let child,log='',passed=0;
 const origin='http://127.0.0.1:'+port;
 const request=(name,body,role='service_role')=>fetch(origin+'/rpc/'+name,{method:'POST',headers:{'content-type':'application/json','accept-encoding':'identity',...(role?{authorization:'Bearer '+token(role)}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
 const terminal='bbbbbbbb-bbbb-4bbb-8bbb-000000000001';
 const scope={organizationId:'default',branchId:'A',terminalId:terminal,keepCommerce:false};
 const common={p_organization_id:'default',p_branch_id:'A',p_terminal_id:terminal,p_keep_commerce:false};
 const id=n=>'aaaaaaaa-aaaa-4aaa-8aaa-'+String(n).padStart(12,'0');
 try{
  child=spawn(exe,[config],{env,windowsHide:true,stdio:['ignore','ignore','pipe']});child.stderr.on('data',x=>log=(log+x).slice(-2000));
  let ready=false;for(let n=0;n<100;n++){assert.equal(child.exitCode,null,log);try{const r=await fetch(origin+'/',{signal:AbortSignal.timeout(500)});if(r.ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,50));}assert(ready,'Owned PostgREST readiness timed out');
  const capped=await request('fixture_history_set_rows',{});assert.equal(capped.status,200,await capped.clone().text());assert.equal((await capped.json()).length,1000);passed++;
  let after=null,upper=null,seen=[];for(let n=0;n<10;n++){
   const action=upper===null?'begin':'page';const response=await request('pos_sync_history_index_v1',{...common,p_action:action,p_after_id:after,p_upper_id:upper,p_limit:1000});assert.equal(response.status,200,await response.clone().text());
   assert.equal(response.headers.get('x-pos-history-reconcile-kind'),'index');
   const p=normalizeIndex(await response.json(),scope,{action,afterId:after,upperId:upper});seen.push(...p.ids);upper=p.upper_id;after=p.next_id;if(p.complete)break;
  }assert.equal(seen.length,2007);assert.equal(new Set(seen).size,2007);passed++;
  const finish=await request('pos_sync_history_index_v1',{...common,p_action:'finish',p_after_id:null,p_upper_id:upper,p_limit:1000});assert.equal(finish.status,200);assert.equal(normalizeIndex(await finish.json(),scope,{action:'finish',upperId:upper}).range_count,'2007');passed++;
  const response=await request('pos_sync_history_rows_v1',{...common,p_ids:[id(1),id(2)],p_max_bytes:2097152});assert.equal(response.status,200,await response.clone().text());
  const bytes=Buffer.from(await response.arrayBuffer());assert.equal(response.headers.get('content-encoding'),null);assert.equal(response.headers.get('x-pos-history-reconcile-version'),'1');assert.equal(response.headers.get('x-pos-history-reconcile-kind'),'rows');assert.equal(Number(response.headers.get('x-pos-history-reconcile-bytes')),bytes.length);assert.equal(response.headers.get('x-pos-history-reconcile-rows'),'2');
  const b=normalizeRows(JSON.parse(bytes.toString('utf8')),scope,[id(1),id(2)]);assert.equal(b.rows[0].revision,'9007199254740993');assert.match(b.rows[0].new_value_json,/9007199254740993/);assert(!b.rows[0].old_value_json.includes('PRIVATE'));assert(!b.rows[0].new_value_json.includes('ecom_price'));passed++;
  for(const [role,status] of [[null,401],['authenticated',403]]){const r=await request('pos_sync_history_rows_v1',{...common,p_ids:[id(1)]},role);assert.equal(r.status,status,await r.text());passed++;}
  const denied=await request('pos_sync_history_index_v1',{...common,p_branch_id:'B',p_action:'begin'});assert.equal(denied.status,400,await denied.text());passed++;
  const invalid=await request('pos_sync_history_rows_v1',{...common,p_ids:[id(1),id(1)]});assert.equal(invalid.status,400,await invalid.text());passed++;
  console.log('PASS '+passed+' actual PostgREST16.5 history-index/precision/privacy/denial groups');return passed;
 }finally{if(child&&child.exitCode===null){const closed=new Promise(r=>child.once('exit',r));child.kill();await closed;}}
}
