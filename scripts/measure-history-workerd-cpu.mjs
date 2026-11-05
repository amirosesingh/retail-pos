// Opt-in, loopback-only workerd comparison. No deployment, real keys or database.
// Measures isolated process CPU over batches, not Cloudflare billed request CPU.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { createHash } from "node:crypto";

const functional = process.argv[2] === "--functional";
assert.deepEqual(process.argv.slice(2), [functional ? "--functional" : "--run"]);
if (!functional) assert.equal(process.platform, "win32", "CPU sampler uses Windows process accounting.");
const root = fileURLToPath(new URL("../", import.meta.url));
const workerd = createRequire(import.meta.url)("workerd").default;
const terminal="00000000-0000-4000-8000-000000000001", branch="00000000-0000-4000-8000-00000000000a";
const proof="a".repeat(64), claim="b".repeat(64);
const requestBody={terminalToken:terminal,deviceBindingProof:proof,
  sqlServerBootstrap:{organizationId:"default",branchId:branch,table:"change_history",cursor:null,historyDays:90,limit:100}};
const temporary=await mkdtemp(join(tmpdir(),"pos-history-cpu-"));
let mode="protected", upstreamText="", legacyText="", lengthDelta=0, slowCancellation=false, cancelledUpstream=false, slowStarted=false, slowSent=0, lateExtra=false, child, stderr="";
const listen=server=>new Promise(resolve=>server.listen(0,"127.0.0.1",()=>resolve(server.address().port)));
const upstream=createServer((req,res)=>{
  let value;
  if(req.url.startsWith("/rest/v1/terminal_tokens?"))value=[{id:terminal,platform:"pc",status:"used",location_id:branch,
    is_claimed:true,revoked_at:null,claim_proof:proof,claimed_proof_hash:proof,management_sync_enabled:false,
    management_sync_proof_hash:createHash("sha256").update(claim).digest("hex")}];
  else if(req.url.startsWith("/rest/v1/stores?"))value=[{id:branch}];
  else if(req.url.startsWith("/rest/v1/rpc/pos_sync_history_page_v1")){
    if(mode==="legacy"){res.writeHead(404,{"Content-Type":"application/json"});res.end(JSON.stringify({code:"PGRST202",message:"Could not find the function public.pos_sync_history_page_v1 in the schema cache"}));return;}
    res.writeHead(200,{"Content-Type":"application/json","X-POS-History-Projection":"1","X-POS-History-Bytes":String(Buffer.byteLength(upstreamText)+lengthDelta),"X-POS-History-Rows":"1"});
    if(lateExtra){res.write(upstreamText);setTimeout(()=>res.end(" "),25);return;}
    if(slowCancellation){
      slowStarted=true;slowSent=0;
      const bytes=Buffer.from(upstreamText);let sent=0;
      const timer=setInterval(()=>{const end=Math.min(sent+64,bytes.length);res.write(bytes.subarray(sent,end));sent=end;slowSent=sent;if(sent===bytes.length){clearInterval(timer);res.end();}},10);
      res.once("close",()=>{clearInterval(timer);if(sent<bytes.length)cancelledUpstream=true;});
      return;
    }
    res.end(upstreamText);return;
  }else if(req.url.startsWith("/rest/v1/rpc/pos_sync_bootstrap")){res.writeHead(200,{"Content-Type":"application/json"});res.end(legacyText);return;}
  else{res.writeHead(500,{"Content-Type":"application/json"});res.end(JSON.stringify({error:"Unexpected isolated upstream path"}));return;}
  res.writeHead(200,{"Content-Type":"application/json"});res.end(JSON.stringify(value));
});
const cpuMs=pid=>{
  assert(Number.isSafeInteger(pid)&&pid>0);
  return Number(execFileSync("powershell.exe",["-NoProfile","-NonInteractive","-Command",`(Get-Process -Id ${pid} -ErrorAction Stop).TotalProcessorTime.TotalMilliseconds.ToString([Globalization.CultureInfo]::InvariantCulture)`],{encoding:"utf8",windowsHide:true,timeout:10000}).trim());
};
try{
  const upstreamPort=await listen(upstream);
  const configSource=`export const supabaseConfig=()=>({url:"http://127.0.0.1:${upstreamPort}",key:"isolated-public"}); export const runtimeEnvValue=(name)=>name.includes("SERVICE")?"isolated-service":undefined;`;
  const bundle=async useFixed=>build({stdin:{contents:`import {handleSyncRequest} from ${JSON.stringify(resolve(root,"src/lib/sync-endpoint.server.ts").replaceAll("\\","/"))}; export default {fetch(request){if(new URL(request.url).pathname==="/health")return new Response("ready");if(new URL(request.url).pathname==="/abort-upstream"){const controller=new AbortController();setTimeout(()=>controller.abort(),45);request=new Request(request,{signal:controller.signal});}return handleSyncRequest(request);}}`,resolveDir:root,sourcefile:"history-cpu-entry.ts",loader:"ts"},bundle:true,write:false,format:"esm",platform:"browser",target:"es2022",logLevel:"silent",external:["node:*"],plugins:[{name:"isolated-runtime-config",setup(b){b.onResolve({filter:/external-supabase-config$/},()=>({path:"config",namespace:"fixture"}));b.onResolve({filter:/commerce-sync-readiness\.server$/},()=>({path:"readiness",namespace:"fixture"}));b.onLoad({filter:/.*/,namespace:"fixture"},args=>({contents:args.path==="config"?configSource:"export const commerceSyncIsolationReady=async()=>true;",loader:"js"}));b.onLoad({filter:/protected-history-download\.server\.ts$/},async args=>({contents:useFixed?await readFile(args.path,"utf8"):execFileSync("git",["show","d4aed867:src/lib/protected-history-download.server.ts"],{cwd:root,encoding:"utf8",windowsHide:true}),loader:"ts"}));}}]});
  const standard=functional?null:await bundle(false),fixed=await bundle(true);
  const results=[];
  for(const dataset of ["small","wide","structured"])for(const scenario of functional?["native-bounded-buffer"]:["legacy","protected","native-bounded-buffer"]){
    mode=scenario;
    await writeFile(join(temporary,"worker.mjs"),(scenario==="native-bounded-buffer"?fixed:standard).outputFiles[0].text);
    const payloadBytes=dataset==="small"?1024:dataset==="wide"?1_649_340:0;
    const row={id:terminal,table_name:"products",old_value:{quantity:0},new_value:{quantity:1,note:"x".repeat(payloadBytes)}};
    if(dataset==="structured")row.new_value.records=Array.from({length:10_000},(_,i)=>({sku:`SKU-${i}`,barcode:`BARCODE-${i}`,quantity:i,unit_cost:12.34,note:"structured fixture item"}));
    upstreamText=JSON.stringify({rows:[row],cursor:null});
    legacyText=JSON.stringify({rows:[{...row,new_value:{...row.new_value,ecom_price:999,is_published:true}}],cursor:null});
    const portProbe=createServer();const port=await listen(portProbe);await new Promise(resolve=>portProbe.close(resolve));
    await writeFile(join(temporary,"config.capnp"),`using Workerd = import "/workerd.capnp"; const config :Workerd.Config = (services=[(name="main",worker=(modules=[(name="worker.mjs",esModule=embed "worker.mjs")],compatibilityDate="2026-01-01",compatibilityFlags=["nodejs_compat"])),(name="internet",network=(allow=["local"]))],sockets=[(name="http",address="127.0.0.1:${port}",http=(),service="main")]);`);
    stderr="";child=spawn(workerd,["serve","-I",resolve(root,"node_modules/workerd"),join(temporary,"config.capnp")],{windowsHide:true,stdio:["ignore","ignore","pipe"]});child.stderr.on("data",chunk=>{stderr+=chunk;});
    let ready=false;
    for(let attempt=0;attempt<100;attempt++){try{const r=await fetch(`http://127.0.0.1:${port}/health`);if(r.ok){ready=true;break;}}catch{}if(child.exitCode!==null)break;await new Promise(resolve=>setTimeout(resolve,50));}
    assert(ready,`Isolated workerd did not start: ${stderr.slice(0,1600)}`);
    const perform=async()=>{const response=await fetch(`http://127.0.0.1:${port}/api/public/sync`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(requestBody),signal:AbortSignal.timeout(10000)});const text=await response.text();assert.equal(response.status,200,text.slice(0,800)+stderr.slice(-1600));assert.deepEqual(JSON.parse(text),{rows:[row],cursor:null});};
    for(let i=0;i<(functional?0:5);i++)await perform();
    const repetitions=functional?1:50,cpuBefore=functional?0:cpuMs(child.pid),start=performance.now();
    for(let i=0;i<repetitions;i++)await perform();
    const wallMs=performance.now()-start,cpuTotalMs=functional?null:cpuMs(child.pid)-cpuBefore;
    results.push({scenario,dataset,responseBytes:Buffer.byteLength(upstreamText),requests:repetitions,processCpuTotalMs:cpuTotalMs,processCpuMeanMs:cpuTotalMs===null?null:cpuTotalMs/repetitions,wallMeanMs:wallMs/repetitions});
    const request=()=>fetch(`http://127.0.0.1:${port}/api/public/sync`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(requestBody),signal:AbortSignal.timeout(10000)});
    if(scenario==="protected"){
      lengthDelta=1;const short=await request();results.at(-1).baselineShortAccepted=short.status===200&&JSON.stringify(await short.json())===JSON.stringify({rows:[row],cursor:null});lengthDelta=0;
      lateExtra=true;const extra=await request();results.at(-1).baselineLateExcessAccepted=extra.status===200&&JSON.stringify(await extra.json())===JSON.stringify({rows:[row],cursor:null});lateExtra=false;
    }
    if(scenario==="native-bounded-buffer"){
      const rejectProtocol=async()=>{const response=await request();assert.equal(response.status,502);assert.equal((await response.json()).code,"EHISTORY_PROTOCOL");};
      for(const delta of [-1,1]){lengthDelta=delta;await rejectProtocol();lengthDelta=0;}
      if(dataset==="small"){
      slowCancellation=true;cancelledUpstream=false;slowStarted=false;slowSent=0;
      const abort=new AbortController();
      const cancelled=fetch(`http://127.0.0.1:${port}/api/public/sync`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(requestBody),signal:abort.signal});
      await new Promise(resolve=>setTimeout(resolve,45));abort.abort();await assert.rejects(cancelled);
      for(let attempt=0;attempt<100&&!cancelledUpstream;attempt++)await new Promise(resolve=>setTimeout(resolve,10));
      results.at(-1).clientDisconnectStoppedUpstream=cancelledUpstream||!slowStarted; slowCancellation=false;
      }
      slowCancellation=true;cancelledUpstream=false;slowStarted=false;slowSent=0;
      const cancelledResponse=await fetch(`http://127.0.0.1:${port}/abort-upstream`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(requestBody),signal:AbortSignal.timeout(10000)});
      assert.notEqual(cancelledResponse.status,200);await cancelledResponse.text();
      for(let attempt=0;attempt<100&&!cancelledUpstream;attempt++)await new Promise(resolve=>setTimeout(resolve,10));
      assert(slowStarted&&slowSent>0&&cancelledUpstream,"An explicit request abort signal must cancel an already streaming upstream before EOF.");slowCancellation=false;
      lateExtra=true;await rejectProtocol();lateExtra=false;
    }
    child.kill();await new Promise(resolve=>child.once("exit",resolve));child=null;
  }
  console.log(JSON.stringify({runtime:execFileSync(workerd,["--version"],{encoding:"utf8",windowsHide:true}).trim(),compatibilityDate:"2026-01-01",compatibilityFlags:["nodejs_compat"],measurement:functional?"Loopback-only actual workerd behavior; no CPU assertion":"Windows isolated workerd process TotalProcessorTime delta, warmed batches; includes process background/GC, not Cloudflare billed CPU, cold start or end-to-end hosted acceptance",nativeBoundaryChecks:{shortResponses:3,overlongResponses:3,lateExcess:3,explicitAbortPropagation:3},results},null,2));
}finally{
  if(child&&child.exitCode===null)child.kill();
  await new Promise(resolve=>upstream.close(resolve));
  assert(temporary.startsWith(join(tmpdir(),"pos-history-cpu-")));
  await rm(temporary,{recursive:true,force:true});
}
