// Isolated loopback-only guarded feed protocol/CPU acceptance; no credentials or deployment.
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {spawn,execFileSync} from "node:child_process";
import {mkdtemp,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {createRequire} from "node:module";
import {build} from "esbuild";
const root=fileURLToPath(new URL("../",import.meta.url));
const workerd=createRequire(import.meta.url)("workerd").default;
const terminal="00000000-0000-4000-8000-000000000001",branch="00000000-0000-4000-8000-00000000000a",proof="a".repeat(64);
const body={terminalToken:terminal,deviceBindingProof:proof,sqlServerPull:{organizationId:"default",branchId:branch,cursor:0,limit:100}};
let payload="[]",legacyPayload="[]",mode="protected",rpcCalls=0,child,stderr="";
const temporary=await mkdtemp(join(tmpdir(),"pos-feed-wire-"));
const listen=server=>new Promise(done=>server.listen(0,"127.0.0.1",()=>done(server.address().port)));
const upstream=createServer((req,res)=>{
  if(req.url.startsWith("/rest/v1/terminal_tokens?")){res.end(JSON.stringify([{id:terminal,platform:"pc",status:"used",location_id:branch,is_claimed:true,revoked_at:null,claim_proof:proof,claimed_proof_hash:proof,management_sync_enabled:false}]));return;}
  if(req.url.startsWith("/rest/v1/stores?")){res.end(JSON.stringify([{id:branch}]));return;}
  if(req.url.startsWith("/rest/v1/rpc/pos_sync_feed_page_v1")){
    rpcCalls++;
    if(mode==="legacy"){res.writeHead(404,{"Content-Type":"application/json"});res.end(JSON.stringify({code:"PGRST202",message:"Could not find public.pos_sync_feed_page_v1"}));return;}
    if(mode==="error"){res.writeHead(503,{"Content-Type":"application/json"});res.end('{"code":"fixture-unavailable"}');return;}
    const bytes=Buffer.byteLength(payload),headers={"Content-Type":"application/json","X-POS-Feed-Projection":"1","X-POS-Feed-Bytes":String(bytes),"X-POS-Feed-Rows":String(JSON.parse(payload).length),"X-POS-Feed-Continue":payload==="[]"?"0":"1"};
    if(mode==="missing")delete headers["X-POS-Feed-Projection"];
    res.writeHead(200,headers);
    if(mode==="short"){res.end(payload.slice(0,-1));return;}
    if(mode==="late-extra"){res.write(payload);setTimeout(()=>res.end(" "),30);return;}
    res.end(payload);return;
  }
  if(req.url.startsWith("/rest/v1/rpc/pos_sync_pull")){res.writeHead(200,{"Content-Type":"application/json"});res.end(legacyPayload);return;}
  res.writeHead(500);res.end("Unexpected isolated upstream path");
});
const cpu=()=>process.platform==="win32"?Number(execFileSync("powershell.exe",["-NoProfile","-NonInteractive","-Command",`(Get-Process -Id ${child.pid} -ErrorAction Stop).TotalProcessorTime.TotalMilliseconds.ToString([Globalization.CultureInfo]::InvariantCulture)`],{encoding:"utf8",windowsHide:true,timeout:10000}).trim()):null;
try{
  const upstreamPort=await listen(upstream);
  const bundle=await build({stdin:{contents:`import{handleSyncRequest}from ${JSON.stringify(resolve(root,"src/lib/sync-endpoint.server.ts").replaceAll("\\","/"))};export default{fetch:r=>new URL(r.url).pathname==='/health'?new Response('ready'):handleSyncRequest(r)};`,resolveDir:root,loader:"ts"},bundle:true,write:false,format:"esm",platform:"browser",target:"es2022",logLevel:"silent",external:["node:*"],plugins:[{name:"isolated",setup(b){b.onResolve({filter:/external-supabase-config$/},()=>({path:"config",namespace:"fixture"}));b.onResolve({filter:/commerce-sync-readiness\.server$/},()=>({path:"ready",namespace:"fixture"}));b.onLoad({filter:/.*/,namespace:"fixture"},a=>({contents:a.path==="config"?`export const supabaseConfig=()=>({url:'http://127.0.0.1:${upstreamPort}',key:'isolated-public'});export const runtimeEnvValue=n=>n.includes('SERVICE')?'isolated-service':undefined;`:"export const commerceSyncIsolationReady=async()=>true;",loader:"js"}));}}]});
  await writeFile(join(temporary,"worker.mjs"),bundle.outputFiles[0].text);
  const probe=createServer(),port=await listen(probe);await new Promise(done=>probe.close(done));
  await writeFile(join(temporary,"config.capnp"),`using Workerd=import "/workerd.capnp";const config:Workerd.Config=(services=[(name="main",worker=(modules=[(name="worker.mjs",esModule=embed "worker.mjs")],compatibilityDate="2026-01-01",compatibilityFlags=["nodejs_compat"])),(name="internet",network=(allow=["local"]))],sockets=[(name="http",address="127.0.0.1:${port}",http=(),service="main")]);`);
  child=spawn(workerd,["serve","-I",resolve(root,"node_modules/workerd"),join(temporary,"config.capnp")],{windowsHide:true,stdio:["ignore","ignore","pipe"]});child.stderr.on("data",c=>stderr+=c);
  let ready=false;for(let i=0;i<100;i++){try{if((await fetch(`http://127.0.0.1:${port}/health`)).ok){ready=true;break;}}catch{}if(child.exitCode!==null)break;await new Promise(r=>setTimeout(r,50));}assert(ready,stderr);
  const request=(value=body)=>fetch(`http://127.0.0.1:${port}/api/v1/pos/sync`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(value),signal:AbortSignal.timeout(30000)});
  const results=[];
  const map=Object.fromEntries(Array.from({length:57899},(_,i)=>[`product-${String(i).padStart(8,"0")}`,"1.0000000000"]));
  const row=i=>({cursor:i+1,table_name:"pos_settings",entity_id:JSON.stringify({id:`fixture-${i}`}),operation:"upsert",row_version:1,tombstone:false,row_data:{id:`fixture-${i}`,settings:{stock_by_store:map,ecommerceEnabled:true,token:{table_name:"terminal_tokens",claim_proof:"never-download",status:"used"}}}});
  const source=Array.from({length:10},(_,i)=>row(i));
  const projected=JSON.parse(JSON.stringify(source[0]));delete projected.row_data.settings.ecommerceEnabled;delete projected.row_data.settings.token.claim_proof;
  payload=JSON.stringify([projected]);legacyPayload=JSON.stringify(source);
  assert(Buffer.byteLength(legacyPayload)<25*1024*1024);
  const perform=async(protectedPath,expectedRows)=>{const response=await request(),text=await response.text();assert.equal(response.status,200,text.slice(0,200));assert.equal(response.headers.get("X-POS-Feed-Projection"),protectedPath?"1":null);assert(!text.includes("never-download"));assert(!text.includes('"ecommerceEnabled"'));const rows=JSON.parse(text);assert.equal(rows.length,expectedRows);return Buffer.byteLength(text);};
  for(const [strategy,protectedPath,count,samples]of [["protected-wide-singleton",true,1,12]]){const before=cpu();const firstBytes=await perform(protectedPath,count);const after=cpu();const start=cpu();for(let i=0;i<samples;i++)await perform(protectedPath,count);const end=cpu();results.push({strategy,inputBytes:Buffer.byteLength(payload),outputBytes:firstBytes,coldFirstProcessCpuMs:before===null?null:after-before,warmSamples:samples,warmProcessCpuMeanMs:start===null?null:(end-start)/samples});}
  payload=JSON.stringify([{...projected,row_data:{safe:true}}]);
  for(const invalid of ["missing","short","late-extra"]){mode=invalid;const response=await request();assert.equal(response.status,502,invalid);assert.equal((await response.json()).code,"EFEED_PROTOCOL");}
  mode="error";let response=await request();assert.equal(response.status,503);assert.equal(response.headers.get("X-POS-Feed-Projection"),null);
  mode="protected";const calls=rpcCalls;response=await request({...body,sqlServerPull:{...body.sqlServerPull,branchId:"00000000-0000-4000-8000-00000000000b"}});assert.equal(response.status,403);assert.equal(rpcCalls,calls);
  mode="legacy";
  for(const count of [1,10]){legacyPayload=JSON.stringify(source.slice(0,count));const before=cpu(),bytes=await perform(false,count),after=cpu(),samples=count===10?3:8,start=cpu();for(let i=0;i<samples;i++)await perform(false,count);const end=cpu();results.push({strategy:`legacy-wide-${count}`,inputBytes:Buffer.byteLength(legacyPayload),outputBytes:bytes,coldFirstProcessCpuMs:before===null?null:after-before,warmSamples:samples,warmProcessCpuMeanMs:start===null?null:(end-start)/samples});}
  console.log(JSON.stringify({runtime:execFileSync(workerd,["--version"],{encoding:"utf8",windowsHide:true}).trim(),wire:{guardedEndpoint:true,privacy:true,shortBodyRejected:true,validJsonLateExtraRejected:true,missingCapabilityRejected:true,foreignBranchDeniedBeforeRpc:true,errorStatusPreserved:true,legacyMissingRpcFallback:true},measurement:"Isolated loopback workerd process CPU deltas include background/GC and first-request sampling overhead; NOT Cloudflare billed CPU, true cold-start or hosted 10ms acceptance",results}));
}finally{if(child&&child.exitCode===null){child.kill();await new Promise(done=>child.once("exit",done));}await new Promise(done=>upstream.close(done));await rm(temporary,{recursive:true,force:true});}
