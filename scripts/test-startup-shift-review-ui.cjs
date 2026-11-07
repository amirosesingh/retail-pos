"use strict";
// Actual route, NativeBoot, Administrator review and Radix comparison dialog.
// Bridge/auth replies are synthetic; no configured POS profile or SQL is used.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { pathToFileURL } = require("node:url"), { chromium } = require("@playwright/test");
const { DatabaseService } = require("../electron/db/service.cjs");
assert.deepEqual(process.argv.slice(2), ["--run"]);
(async () => {
  const root = process.cwd(), dir = path.join(root, ".tmp", "startup-shift-review-ui");
  fs.mkdirSync(dir, { recursive: true });
  const service = new DatabaseService({ secureConfig: { enabled: () => true, profile: () => ({ database: "owned-ui-fixture" }) }, manager: { isConnected: () => true } });
  service.validated = true;
  const blocked = service.transition("enabled_bootstrapping", { code: "ELOCAL_PENDING_UNVERIFIED", error: "Retained local closings require review" });
  assert.equal(blocked.tradingReady, true);
  fs.writeFileSync(path.join(dir, "index.html"), '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/.tmp/startup-shift-review-ui/main.tsx"></script></body></html>');
  fs.writeFileSync(path.join(dir, "mock.tsx"), `
import React,{useSyncExternalStore}from'react';
const read=()=>window.fixture.state;
const subscribe=fn=>{window.fixture.listeners.add(fn);return()=>window.fixture.listeners.delete(fn)};
const useStateSource=()=>useSyncExternalStore(subscribe,read,read);
export const useAuth=()=>{const s=useStateSource();return{ready:s.authReady,user:s.role?{staffId:s.actor}:null,isAdmin:s.role==='admin',authUserId:s.role?s.actor:null,logout:async()=>window.fixture.patch({role:null})}};
export const isDesktop=()=>true;
export const createLoginView=()=>({chooseMode(){}});
export const ensureDesktopPosSession=async()=>{window.fixture.verifications++;return window.fixture.state.proof?{ok:true}:{ok:false,error:'Synthetic terminal identity rejected'}};
export const TerminalLogin=()=> <button onClick={()=>window.fixture.patch({role:'admin'})}>Fixture Administrator sign-in</button>;
export const useLocation=options=>{const s=useStateSource();return options?.select?options.select({pathname:s.pathname}):{pathname:s.pathname}};
const navigate=async({to})=>{window.fixture.navigations.push(to);window.fixture.patch({pathname:to})};
export const useNavigate=()=>navigate;
export const createFileRoute=()=>options=>options;
export const LocalDatabaseWizard=()=> <div>Fixture database settings</div>;
export const checkHealth=async()=>({cloud:true});export const cloudDiagnosis=()=>({issue:'none'});
export const setStartupOnlineMode=()=>{};export const LOCAL_DATABASE_SETTINGS_REQUEST='fixture-settings';export const ONLINE_STARTUP_OVERRIDE='fixture-online';
export const toast={dismiss(){}};
export const TillLoader=()=> <div data-trading-blocked>Trading remains blocked</div>;
`);
  fs.writeFileSync(path.join(dir, "main.tsx"), `
import React,{useSyncExternalStore}from'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';
import{NativeBoot}from'@/platforms/windows/components/DatabaseBoot';import{Route}from'@/routes/database-startup';import'@/styles.css';
const listeners=new Set(),databaseListeners=new Set();const db=${JSON.stringify(blocked)};
const scenario=new URLSearchParams(location.search).get('scenario')||'admin';
if(scenario==='schema')Object.assign(db,{tradingReady:false,state:'enabled_validating',detail:{status:'migration_required'}});
if(scenario==='migrating')Object.assign(db,{tradingReady:false,state:'enabled_validating',detail:{status:'applying_migration'}});
if(scenario==='disconnected')Object.assign(db,{connected:false,tradingReady:false});
window.fixture={listeners,databaseListeners,databaseState:db,navigations:[],verifications:0,reads:0,previews:0,approvals:0,adoptions:0,retries:0,documentToken:crypto.randomUUID(),
state:{role:scenario==='signed-out'?null:scenario==='cashier'?'staff':'admin',actor:'fixture-original-admin',proof:scenario!=='proof-denied',authReady:true,pathname:'/database-startup'},
patch(value){flushSync(()=>{this.state={...this.state,...value};for(const fn of listeners)fn()})},
database(value){Object.assign(this.databaseState,value);flushSync(()=>{for(const fn of databaseListeners)fn({...this.databaseState})})}};
const summary={status:'CLOSED',openedAt:'2026-10-31T08:00:00.0000000Z',closedAt:'2026-10-31T20:00:00.1234567Z',updatedAt:'2026-10-31T20:01:00.1234567Z',rowVersion:'5',countedCash:'123.45',countedCard:'0',countedDigital:'0',expectedCash:'123.45',expectedCard:'0',expectedDigital:'0'};
const cloudSummary={...summary,status:'OPEN',closedAt:null,updatedAt:'2026-10-31T08:00:01.1234560Z',rowVersion:'2'};
const readOnly=scenario==='readonly';
const shiftId='00000000-0000-4000-8000-000000000007';
window.sqlAdmin={adminStatus:async()=>({unlocked:window.fixture.state.role==='admin'&&window.fixture.state.proof,source:'pos',level:window.fixture.state.role})};
window.pos={database:{getState:async()=>({...window.fixture.databaseState}),retryStartup:async()=>{window.fixture.retries++;return{...window.fixture.databaseState}},subscribe:fn=>{databaseListeners.add(fn);return()=>databaseListeners.delete(fn)}},sync:{subscribe:()=>()=>{},legacyRecovery:{
list:async()=>{window.fixture.reads++;return{ok:true,available:true,...(readOnly?{readOnly:true}:{}),items:[{shiftId,status:'CLOSED',openedAt:summary.openedAt,closedAt:summary.closedAt}]}},
preview:async()=>{window.fixture.previews++;return{ok:true,shiftId,classification:'legacy-local-closing-needs-review',local:summary,cloud:cloudSummary,...(readOnly?{readOnly:true,captureKey:null,canApprove:false,canAcceptCloud:false}:{captureKey:'a'.repeat(64),canApprove:true})}},
approve:async()=>{window.fixture.approvals++;throw Error('This fixture must never approve recovery')},acceptCloud:async()=>{window.fixture.adoptions++;throw Error('This fixture must never adopt recovery')}
}}};
function App(){const s=useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>window.fixture.state);return<NativeBoot>{s.pathname==='/database-startup'?<Route.component/>:<div data-normal-trading>Normal trading page</div>}</NativeBoot>};
createRoot(document.getElementById('root')).render(<App/>);
`);
  const names = ["@tanstack/react-router", "@/lib/pos-auth", "@/lib/branding", "@/lib/login-view", "@/lib/desktop-pos-session", "@/platforms/web/components/pos/TerminalLogin", "@/platforms/windows/components/LocalDatabaseWizard", "@/core/activation/connection-health", "@/core/local-db/db-mode", "@/components/shared/TillLoader", "sonner"];
  const { createServer } = await import("vite"), react = (await import("@vitejs/plugin-react")).default, tailwind = (await import("@tailwindcss/vite")).default;
  const { popupRuntimeAliases } = await import(pathToFileURL(path.join(root, "scripts/popup-runtime-aliases.mjs")).href);
  let server, browser, groups = 0;
  const errors = [], remote = [];
  try {
    server = await createServer({ configFile: false, root, envDir: false, cacheDir: path.join(dir, ".vite"), plugins: [react(), tailwind()],
      resolve: { alias: [...names.map(find => ({ find, replacement: path.join(dir, "mock.tsx") })), ...popupRuntimeAliases(), { find: "@", replacement: path.join(root, "src") }] },
      server: { host: "127.0.0.1", port: 0, fs: { allow: [root, fs.realpathSync(path.join(root, "node_modules"))] } }, logLevel: "error" });
    await server.listen(); const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
    browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--disable-gpu"] });
    const open = async (scenario, width) => {
      const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
      page.on("pageerror", error => errors.push(error.message));
      await page.route("**/*", route => { if (route.request().url().startsWith(origin)) return route.continue(); remote.push(route.request().url()); return route.abort(); });
      await page.goto(`${origin}/.tmp/startup-shift-review-ui/index.html?scenario=${scenario}`);
      await page.waitForFunction(() => Boolean(window.fixture)); return page;
    };
    for (const width of [1440, 390]) {
      const page = await open("admin", width);
      await page.getByRole("button", { name: "Review saved closings", exact: true }).waitFor();
      assert.deepEqual(await page.evaluate(() => window.fixture.navigations), []);
      await page.getByRole("button", { name: "Retry local database", exact: true }).click();
      assert.equal(await page.evaluate(() => window.fixture.retries), 1);
      assert.deepEqual(await page.evaluate(() => window.fixture.navigations), []); groups++;
      await page.getByRole("button", { name: "Review saved closings", exact: true }).click();
      await page.getByRole("button", { name: /CLOSED · 00000000/ }).click();
      await page.getByLabel("Closing comparison", { exact: true }).waitFor();
      assert.equal(await page.locator('[data-normal-trading]').count(), 0);
      assert.equal(await page.getByRole("button", { name: "Save reviewed recovery", exact: true }).isDisabled(), true);
      assert.deepEqual(await page.evaluate(() => [window.fixture.approvals, window.fixture.adoptions]), [0, 0]); groups++;
      await page.evaluate(() => window.fixture.patch({ role: "staff", actor: "new-branch-cashier", proof: false }));
      await page.getByText("This signed-in account cannot approve saved shift recovery.", { exact: true }).waitFor();
      assert.equal(await page.getByLabel("Closing comparison", { exact: true }).count(), 0);
      assert.equal(await page.getByRole("button", { name: "Review saved closings", exact: true }).count(), 0); groups++;
      await page.evaluate(() => window.fixture.patch({ pathname: "/" }));
      await page.locator("[data-trading-blocked]").waitFor(); assert.equal(await page.locator("[data-normal-trading]").count(), 0); groups++;
      await page.close();
      const readOnly = await open("readonly", width);
      await readOnly.getByRole("heading", { name: "Saved local work needs review", exact: true }).waitFor();
      await readOnly.getByRole("button", { name: "Review saved closings", exact: true }).click();
      await readOnly.getByText(/Saving a recovery decision requires the approved recovery metadata upgrade/).waitFor();
      await readOnly.getByRole("button", { name: /CLOSED · 00000000/ }).click();
      const comparison = readOnly.getByLabel("Closing comparison", { exact: true });
      await comparison.getByRole("heading", { name: "Local SQL Server", exact: true }).waitFor();
      await comparison.getByRole("heading", { name: "Cloud", exact: true }).waitFor();
      await comparison.getByText("2026-10-31T20:00:00.1234567Z", { exact: true }).waitFor();
      await comparison.getByText("2026-10-31T08:00:01.1234560Z", { exact: true }).waitFor();
      assert.deepEqual(await comparison.locator("dt").filter({ hasText: /^Record version$/ }).locator("xpath=following-sibling::dd[1]").allTextContents(), ["5", "2"]);
      assert.equal(await readOnly.getByRole("button", { name: /Save reviewed recovery|Use reviewed cloud closing locally/ }).count(), 0);
      assert.deepEqual(await readOnly.evaluate(() => [window.fixture.reads, window.fixture.previews, window.fixture.approvals, window.fixture.adoptions]), [1, 1, 0, 0]);
      assert.deepEqual(await readOnly.evaluate(() => window.fixture.navigations), []); groups++; await readOnly.close();
      const signedOut = await open("signed-out", width);
      await signedOut.getByRole("button", { name: "Fixture Administrator sign-in", exact: true }).click();
      await signedOut.getByRole("button", { name: "Review saved closings", exact: true }).waitFor();
      await signedOut.evaluate(() => window.fixture.database({ state: "enabled_ready" }));
      await signedOut.locator("[data-normal-trading]").waitFor(); assert.deepEqual(await signedOut.evaluate(() => window.fixture.navigations), ["/"]); groups++; await signedOut.close();
      for (const scenario of ["schema", "migrating", "disconnected", "cashier", "proof-denied"]) {
        const held = await open(scenario, width);
        await held.getByRole("heading", { level: 1 }).waitFor();
        if (scenario === "cashier") await held.getByText("This signed-in account cannot approve saved shift recovery.", { exact: true }).waitFor();
        if (scenario === "proof-denied") await held.getByText("Synthetic terminal identity rejected", { exact: true }).waitFor();
        assert.equal(await held.getByRole("button", { name: "Review saved closings", exact: true }).count(), 0);
        assert.deepEqual(await held.evaluate(() => [window.fixture.reads, window.fixture.previews, window.fixture.approvals, window.fixture.adoptions]), [0, 0, 0, 0]);
        groups++; await held.close();
      }
    }
    assert.deepEqual(errors, []); assert.deepEqual(remote, []);
    console.log(`PASS ${groups} mounted startup shift review groups; actual schema-ready snapshot, preserved trading gate, no approvals/adoptions, SQL or remote traffic.`);
  } finally { await browser?.close(); await server?.close(); }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
