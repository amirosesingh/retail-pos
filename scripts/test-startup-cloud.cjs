const {test}=require("node:test");
const assert=require("node:assert/strict");
const {readFileSync}=require("node:fs");
const {stripTypeScriptTypes}=require("node:module");
const {supabaseRequest}=require("../electron/supabase-http.cjs");
const config={url:"https://example.supabase.co",key:"public-test-key"};
const request=(path="/rest/v1/public_flags")=>({url:config.url+path,headers:{apikey:config.key}});

// Execute the actual TS module with its imports injected; no application build
// or downloaded dependencies are required for these focused behavior tests.
function load(file, dependencies, exports) {
  const source=stripTypeScriptTypes(readFileSync(file,"utf8"))
    .replace(/^import .*;\s*$/gm,"").replace(/\bexport /g,"");
  return new Function(...Object.keys(dependencies),`${source}\nreturn {${exports.join(",")}};`)(...Object.values(dependencies));
}

test("native Supabase HTTP preserves a real Auth 400 and strips unsafe headers",async()=>{
  const res=await supabaseRequest({...request("/auth/v1/token?grant_type=password"),method:"POST",body:'{"email":"test"}',headers:{apikey:config.key,authorization:"Bearer user-token",cookie:"must-not-forward",host:"attacker.invalid"}},config,async(url,init)=>{
    assert.equal(url,config.url+"/auth/v1/token?grant_type=password");
    assert.equal(init.redirect,"manual");assert.equal(init.headers.get("authorization"),"Bearer user-token");
    assert.equal(init.headers.has("cookie"),false);assert.equal(init.headers.has("host"),false);
    return new Response('{"code":"invalid_credentials"}',{status:400,headers:{"content-type":"application/json"}});
  });
  assert.equal(res.ok,true);assert.equal(res.status,400);assert.equal(JSON.parse(res.body).code,"invalid_credentials");
});

test("native transport rejects foreign destinations, changed keys and redirects",async()=>{
  let calls=0;const fetcher=async()=>{calls++;return new Response(null,{status:302,headers:{location:"https://attacker.invalid"}});};
  for(const input of [{...request(),url:"https://attacker.invalid/rest/v1/x"},{...request(),url:"http://example.supabase.co/rest/v1/x"},{...request(),url:config.url+"/storage/v1/x"},{...request(),headers:{apikey:"old-key"}},{...request(),url:"https://user:pass@example.supabase.co/rest/v1/x"}])assert.equal((await supabaseRequest(input,config,fetcher)).ok,false);
  assert.equal(calls,0);assert.equal((await supabaseRequest(request(),config,fetcher)).ok,false);assert.equal(calls,1);
});

test("native transport bounds request and response bodies",async()=>{
  let calls=0;
  const fetcher=async()=>{calls++;return new Response("x".repeat(6*1024*1024+1));};
  assert.equal((await supabaseRequest({...request(),method:"POST",body:"x".repeat(6*1024*1024+1)},config,fetcher)).ok,false);
  assert.equal(calls,0);assert.equal((await supabaseRequest(request(),config,fetcher)).ok,false);
});

test("renderer reconstructs HTTP errors and handles bodyless responses",async()=>{
  const {desktopSupabaseFetch}=load("src/lib/desktop-supabase-fetch.ts",{window:{pos:{supabaseRequest:async input=>input.method==="HEAD"?{ok:true,status:200,body:""}:{ok:true,status:400,body:'{"code":"invalid_credentials"}',headers:{"content-type":"application/json"}}}},fetchWithDeadline:()=>{throw Error("browser fetch must not run");}},["desktopSupabaseFetch"]);
  const response=await desktopSupabaseFetch(config.url+"/auth/v1/token",{method:"POST",body:"{}"});
  assert.equal(response.status,400);assert.equal((await response.json()).code,"invalid_credentials");
  assert.equal((await desktopSupabaseFetch(config.url+"/rest/v1/public_flags",{method:"HEAD"})).body,null);
});

test("web and storage calls retain browser transport; cancelled requests reject",async()=>{
  let browser=0,native=0;
  const deps={window:{pos:{supabaseRequest:async()=>{native++;return {ok:true,status:200,body:"[]"};}}},fetchWithDeadline:async()=>{browser++;return new Response("[]");}};
  const {desktopSupabaseFetch}=load("src/lib/desktop-supabase-fetch.ts",deps,["desktopSupabaseFetch"]);
  await desktopSupabaseFetch(config.url+"/storage/v1/object/x");assert.equal(browser,1);assert.equal(native,0);
  const controller=new AbortController();controller.abort();
  await assert.rejects(desktopSupabaseFetch(config.url+"/rest/v1/public_flags",{signal:controller.signal}));
  assert.equal(native,0);
});

test("public flags recover after SQL readiness failure and share concurrent forced reads",async()=>{
  let calls=0;let release;
  const {loadPublicFlags}=load("src/lib/public-flags.ts",{useEffect(){},useState(){},commitOps(){},relayOp(){},platformName:()=>"electron",routedQuery:async()=>{calls++;if(calls===1)throw Error("SQL Server setup or connection is not complete yet.");await new Promise(resolve=>release=resolve);return [{key:"member_domain_enabled",enabled:false}];}},["loadPublicFlags"]);
  assert.deepEqual(await loadPublicFlags(),{member:true,redeem:true});
  const first=loadPublicFlags();const second=loadPublicFlags(true);assert.equal(calls,2);release();
  assert.deepEqual(await first,{member:false,redeem:true});assert.deepEqual(await second,{member:false,redeem:true});
  await loadPublicFlags();assert.equal(calls,2);
});

function terminalFixture(error=null, savedProject=config.url) {
  let logins=0,provisions=0;
  const deps={window:{},supabaseConfig:()=>config,awaitProfileHydrated:async()=>{},supabaseExternal:{auth:{getSession:async()=>({data:{session:null}}),signInWithPassword:async()=>{logins++;await Promise.resolve();return {error};}}},getDeviceSecret:async()=>({email:"terminal",password:"test",projectUrl:savedProject}),setDeviceSecret:async()=>{},readTerminalConfig:()=>({tokenId:"paired-terminal"}),deviceProofHash:async()=>"proof",getTerminalAccount:async()=>{provisions++;return {ok:true,email:"terminal",password:"fresh"};},logger:{log(){}}};
  return {...load("src/lib/terminal-session.ts",deps,["ensureTerminalSession"]),counts:()=>({logins,provisions}),deps};
}

test("concurrent terminal checks perform one login",async()=>{
  const f=terminalFixture();assert.deepEqual(await Promise.all([f.ensureTerminalSession(),f.ensureTerminalSession(),f.ensureTerminalSession()]),[true,true,true]);
  assert.deepEqual(f.counts(),{logins:1,provisions:0});
});

test("outage does not rotate terminal credentials or trigger an immediate retry",async()=>{
  const f=terminalFixture({code:"unexpected_failure",message:"Service unavailable"});
  assert.equal(await f.ensureTerminalSession(),false);assert.equal(await f.ensureTerminalSession(),false);
  assert.deepEqual(f.counts(),{logins:1,provisions:0});
});

test("rejected terminal credentials rotate only once; foreign project credentials are refreshed first",async()=>{
  const rejected=terminalFixture({code:"invalid_credentials",message:"Invalid login credentials"});
  assert.equal(await rejected.ensureTerminalSession(),false);assert.deepEqual(rejected.counts(),{logins:2,provisions:1});
  const foreign=terminalFixture(null,"https://old.supabase.co");assert.equal(await foreign.ensureTerminalSession(),true);assert.deepEqual(foreign.counts(),{logins:1,provisions:1});
});

test("profile hydration failure does not escape background session check",async()=>{
  const f=terminalFixture();f.deps.awaitProfileHydrated=async()=>{throw Error("not ready");};
  const module=load("src/lib/terminal-session.ts",f.deps,["ensureTerminalSession"]);
  assert.equal(await module.ensureTerminalSession(),false);assert.deepEqual(f.counts(),{logins:0,provisions:0});
});
