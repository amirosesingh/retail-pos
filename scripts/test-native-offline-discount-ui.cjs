// Real shared React/Radix dialog; synthetic verifier/IPC only, no app profile/database.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), { pathToFileURL } = require("node:url");
const { chromium } = require("@playwright/test");
(async () => {
  const root = process.cwd(), dir = path.join(root, ".tmp", "native-offline-discount-ui"); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "index.html"), '<div id="root"></div><script type="module" src="/.tmp/native-offline-discount-ui/main.tsx"></script>');
  fs.writeFileSync(path.join(dir, "mock.ts"), `
export const nativeApprovalCredentials=true;
export const useAuthOptional=()=>({user:{staffId:'fixture-cashier',name:'Fixture Cashier'}});
export const getPosCallerAuth=async()=>({});export const authorizeWithPin=async()=>({ok:false,error:'offline'});export const submitAuthorizationRequest=async()=>({ok:false,error:'offline'});
export const looksOffline=()=>true;export const parkGovernanceRow=async(table,row)=>{window.fixture.calls.park.push({table,row});return{parked:true};};
export const hasNativeOfflineDiscountCapability=()=>['operations','denied','defer'].includes(window.fixture.mode);
export const verifyLocalApprovalPin=async()=>{window.fixture.calls.legacy++;return{ok:true,staff:{username:'manager',full_name:'Fixture Manager',roleSlug:'manager',permissions:{can_give_discount:true}}};};
export const authorizeOfflineDiscount=async(value)=>{const{credential,...safe}=value;window.fixture.calls.native.push(safe);if(window.fixture.mode==='defer')return new Promise(resolve=>window.fixture.resolve=resolve);return window.fixture.mode==='denied'?{ok:false,error:'Native approval denied'}:{ok:true,auditId:value.requestId,authorizer:{id:'manager',name:'Fixture Manager',role:'manager'}};};
export const syncNow=async()=>({});export const notifyError=()=>{};
`);
  fs.writeFileSync(path.join(dir, "main.tsx"), `import React from'react';import{createRoot}from'react-dom/client';import{Toaster}from'sonner';import{AuthorizationDialog}from'@/platforms/web/components/pos/AuthorizationDialog';import'@/styles.css';
Object.defineProperty(navigator,'onLine',{get:()=>false,configurable:true});window.fixture={mode:new URLSearchParams(location.search).get('mode'),calls:{native:[],legacy:0,park:[]},outcomes:[]};
const discounts=[{index:-1,productId:'',name:'Bill',qty:1,price:0,type:'percent',value:20,base:20,requiresApproval:true}];
const prompt={actionKey:'discount_over_limit',mode:'pin',title:'Approve fixture discount',reason:'Review synthetic bill',requireReason:false,storeId:'a',terminalId:'display-only',binding:'fixture-binding',requestedAmount:20,requesterDirectLimit:10,allowedRoles:['manager','admin'],payload:{bill_no:'FIXTURE-1',discount_scope:'ticket',requested_discounts:JSON.stringify(discounts)},snapshot:{ticketId:'FIXTURE-1',billNo:'FIXTURE-1',storeId:'a',terminalId:'display-only',cashier:'Fixture Cashier',capturedAt:'2026-11-05T12:00:00Z',lines:[{sku:'S1',name:'Synthetic item',qty:1,unitPrice:20,discount:0,lineTotal:20}],subtotal:20,discount:4,tax:0,serviceCharge:0,total:16}};
const root=createRoot(document.getElementById('root'));window.fixture.render=p=>root.render(<><AuthorizationDialog prompt={p} onFinish={value=>window.fixture.outcomes.push(value)}/><Toaster/></>);window.fixture.render(prompt);window.fixture.prompt=prompt;
`);
  const { createServer } = await import("vite"), react = (await import("@vitejs/plugin-react")).default, tailwind = (await import("@tailwindcss/vite")).default;
  const { popupRuntimeAliases } = await import(pathToFileURL(path.join(root, "scripts/popup-runtime-aliases.mjs")).href);
  const mock = path.join(dir, "mock.ts"), aliases = ["@/platform-config/approval-token", "@/lib/pos-auth", "@/lib/pos-caller-auth", "@/lib/authorization-client", "@/lib/governance-offline", "@/core/local-db/local-staff", "@/lib/sync-engine", "@/lib/notify"].map(find => ({ find, replacement: mock }));
  let server, browser, groups = 0;
  try {
    server = await createServer({ configFile: false, root, cacheDir: path.join(dir, ".vite"), plugins: [react(), tailwind()], resolve: { alias: [...aliases, ...popupRuntimeAliases(), { find: "@", replacement: path.join(root, "src") }] }, server: { host: "127.0.0.1", port: 0, fs: { allow: [root, fs.realpathSync(path.join(root, "node_modules"))] } }, logLevel: "error" });
    await server.listen(); const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
    browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--disable-gpu"] });
    const open = async (mode, width = 1440) => {
      const page = await browser.newPage({ viewport: { width, height: 840 } }); await page.route("**/*", route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
      await page.goto(`${origin}/.tmp/native-offline-discount-ui/index.html?mode=${mode}`); await page.getByRole("button", { name: "Approval PIN", exact: true }).click(); return page;
    };
    const approve = async page => { await page.getByLabel("Authoriser ID", { exact: true }).fill("manager"); await page.getByLabel("Authorization PIN or soft token", { exact: true }).fill("246813"); await page.getByRole("button", { name: "Authorise", exact: true }).click(); };
    for (const mode of ["operations", "android", "management", "old-bridge"]) {
      const page = await open(mode); await approve(page); await page.waitForFunction(() => window.fixture.outcomes.length === 1);
      const result = await page.evaluate(() => window.fixture); assert.equal(result.calls.native.length, mode === "operations" ? 1 : 0); assert.equal(result.calls.legacy, mode === "operations" ? 0 : 1); assert.equal(result.calls.park.length, mode === "operations" ? 0 : 1);
      assert.equal(result.outcomes[0].authorizer.id, "manager"); groups++; console.log(`PASS shared dialog ${mode} selects only its compatible path`); await page.close();
    }
    const denied = await open("denied", 390); await approve(denied); await denied.getByText("Native approval denied", { exact: true }).waitFor(); await approve(denied);
    await denied.waitForFunction(() => window.fixture.calls.native.length === 2); const refusal = await denied.evaluate(() => window.fixture);
    assert.equal(refusal.calls.legacy, 0); assert.equal(refusal.calls.park.length, 0); assert.equal(refusal.outcomes.length, 0); assert.equal(refusal.calls.native[0].requestId, refusal.calls.native[1].requestId); groups++; console.log("PASS native refusal cannot fall back and retry keeps its stable identity");
    await denied.screenshot({ path: path.join(dir, "approval-denied-390.png"), fullPage: true }); await denied.close();
    const stale = await open("defer"); await approve(stale); await stale.waitForFunction(() => typeof window.fixture.resolve === "function"); await stale.evaluate(() => { window.fixture.render(null); });
    await stale.getByRole("dialog").waitFor({ state: "hidden" }); await stale.evaluate(() => window.fixture.resolve({ ok: true, authorizer: { id: "manager", name: "Fixture Manager", role: "manager" } }));
    await stale.waitForTimeout(50); assert.equal(await stale.evaluate(() => window.fixture.outcomes.length), 0); groups++; console.log("PASS stale prompt ignores completed native approval"); await stale.close();
    console.log(`PASS ${groups} actual shared approval dialog groups`);
  } finally { await browser?.close(); await server?.close(); }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });

