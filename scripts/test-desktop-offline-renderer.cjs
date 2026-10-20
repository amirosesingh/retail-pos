// Isolated renderer regression: no real credentials, SQL writes or cloud calls.
const assert = require('node:assert/strict');
const { chromium } = require('@playwright/test');
const baseURL = process.env.POS_E2E_BASE_URL || 'http://127.0.0.1:8080';
if (new URL(baseURL).hostname !== '127.0.0.1') throw new Error('Use an isolated loopback server.');
(async () => {
 const browser = await chromium.launch({channel:'chrome', headless:true, args:['--no-sandbox','--disable-gpu']});
 try {
 for (const disconnected of [false, true]) {
 const context = await browser.newContext();
 await context.addInitScript(({ disconnected }) => {
 Object.defineProperty(navigator, 'onLine', { get: () => !disconnected });
 const noop = () => () => {};
 const cloud = {ok:true,configured:true,encrypted:true,url:'https://offline-test.invalid',key:'test-publishable-key'};
 const config = {tokenId:'11111111-1111-4111-8111-111111111111',locationId:'22222222-2222-4222-8222-222222222222',locationName:'Offline test',deviceUse:'operations',supabaseUrl:cloud.url,supabaseKey:cloud.key,backendUrl:'https://offline-test.invalid',activatedAt:'2026-01-01'};
 const db = {enabled:true,configured:true,connected:true,tradingReady:true,state:'enabled_ready'};
 window.pos = {
 database:{getState:async()=>db,subscribe:noop}, readTerminalConfig:async()=>({ok:true,config}),writeTerminalConfig:async()=>({ok:true}),
 bootstrapCloudCredentials:async()=>cloud,cloudKeyStatus:async()=>cloud,backendUrl:async()=>({ok:true,url:config.backendUrl}),
 readBranding:async()=>({ok:true,branding:{configured:true,company:'Offline fixture',terminal:'Test till'}}),
 reportReady:async()=>({ok:true}),readConfig:async()=>({}),getConfig:async()=>null,getSetting:async()=>null,
 appVersion:async()=> '1.4.76-beta.3',updateStatus:async()=>({status:'idle'}),onUpdateStatus:noop,
 status:async()=>db,onFatal:noop,onBeforeClose:noop,onCloudSetupRequired:noop,
 staff:async()=>({ok:true,rows:[]}), query:async()=>({ok:true,rows:[]}),
 sync:{getStatus:async()=>({connected:false,phase:'idle'}),subscribe:noop,auto:async()=>({ok:true})},
 telemetry:{presence:async()=>({ok:true})}
 };
 }, { disconnected });
 const page = await context.newPage(); const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 const pending=[];
 await page.route('**/*', async route=> {
 const r=route.request(), u=new URL(r.url());
 if(u.hostname!=='127.0.0.1' || ['fetch','xhr'].includes(r.resourceType())) {
   if(disconnected) return route.abort('internetdisconnected');
   // A connected LAN with a blackholed internet connection must not hold startup.
   return new Promise(resolve=>pending.push(()=>route.abort('internetdisconnected').catch(()=>{}).then(resolve)));
 }
 return route.continue();
 });
 await page.goto(baseURL,{waitUntil:'domcontentloaded'});
 const start=Date.now();
 await page.getByText('Terminal sign in', {exact:true}).waitFor({timeout:5000});
 const elapsedMs=Date.now()-start;
 assert.deepEqual(errors,[]);
 assert.equal(await page.getByText("This page didn't load", {exact:true}).count(),0);
 console.log(JSON.stringify({disconnected,signInVisible:true,elapsedMs,pageErrors:errors.length}));
 for(const release of pending)release();
 await context.close();
 }
 } finally {await browser.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1});
