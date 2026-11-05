"use strict";
// Actual AppShell, ShiftGuard, confirmed-presentation hook and shared Radix
// portals. Unrelated device/network services and shell ornaments are inert.
// Synthetic state only: no POS profile, database, credentials or remote traffic.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { pathToFileURL } = require("node:url"), { chromium } = require("@playwright/test");
assert.deepEqual(process.argv.slice(2), ["--run"]);
(async () => {
  const root = process.cwd(), dir = path.join(root, ".tmp", "branch-switch-shell-ui");
  fs.mkdirSync(dir, { recursive: true });
  const registration = fs.readFileSync(path.join(root, "src/core/activation/registration-status.ts"), "utf8");
  const decision = registration.slice(registration.indexOf("export function startupDecision("));
  assert(decision.startsWith("export function startupDecision(") && decision.trimEnd().endsWith("}"));
  fs.writeFileSync(path.join(dir, "index.html"), '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/.tmp/branch-switch-shell-ui/main.tsx"></script></body></html>');
  fs.writeFileSync(path.join(dir, "mock.tsx"), `
import React,{useState,useSyncExternalStore}from'react';
const noop=()=>undefined;
const read=()=>window.fixture.state;
const subscribe=fn=>{window.fixture.listeners.add(fn);return()=>window.fixture.listeners.delete(fn)};
function useStateSource(){return useSyncExternalStore(subscribe,read,read)}
const stores=[{id:'A',code:'A',name:'Shop A',active:true},{id:'B',code:'B',name:'Shop B',active:true}];
const settings={receipt:{companyName:'Synthetic Retail'},tax:{},integrations:{receiptPrinter:{},rounding:{}}};
const retryLoad=()=>{window.fixture.retries.data++;window.fixture.patch({ready:false,phase:'loading',error:''})};
const retrySettingsScope=()=>{window.fixture.retries.settings++;window.fixture.patch({settingsPending:true,error:''})};
export const usePos=()=>{const s=useStateSource();return{ready:s.ready,loadPhase:s.phase,locationLoadError:s.error,settingsScopeLoading:s.settingsPending,settingsScopeError:s.error,
retryLoad,retrySettingsScope,stores,currentStore:stores.find(x=>x.id===s.branch),setCurrentStore:id=>window.fixture.switch(id),state:{stores,settings,transfers:[]},
activeShift:s.shift,shiftChecked:s.shiftChecked,shiftReadError:null,openShift:async()=>{window.fixture.business.openShift++;return'local'}}};
export const useAuth=()=>{const s=useStateSource();return{ready:s.authReady,user:s.signedIn?{staffId:s.actor,name:'Fixture Operator',email:'fixture@example.invalid',role:'cashier',permissions:{can_view_sales_reports:s.permitted}}:null,
authUserId:s.signedIn?s.actor:null,terminalUser:null,isAdmin:false,canSwitchStores:!s.terminalStoreId,terminalStoreId:s.terminalStoreId,terminalStoreName:s.terminalStoreId?'Shop '+s.terminalStoreId:null,
can:flag=>flag==='can_view_sales_reports'?s.permitted:flag==='can_bypass_shift_lock'?s.bypass:flag==='can_open_shift'?s.mayOpen:true,logout:noop,lock:noop}};
export const sessionEpoch=()=>read().epoch;export const effectiveDatabaseMode=()=>read().mode;export const supabaseConfig=()=>({url:'https://'+read().profile+'.example.invalid'});
export const useLocation=()=>{const s=useStateSource();return{pathname:s.pathname}};
export const useNavigate=()=>()=>undefined;export const Link=({to,children,...props})=><a {...props} href={to} onClick={event=>event.preventDefault()}>{children}</a>;
export const useBranding=()=>({company:'Synthetic Retail',terminal:'Fixture terminal'});export const isDesktop=()=>read().native;
export const isNative=()=>false;export const isTerminalApp=()=>read().native;export const isManagementDevice=()=>read().management;
export const useRevocationCheck=()=>{const s=useStateSource();return{config:s.native&&s.registered?{tokenId:s.device,locationName:'Shop '+(s.terminalStoreId||s.branch)}:null,verified:s.verified,hydrating:false,revoked:s.revoked,reason:'Fixture revocation'}};
export const clearRevocation=noop;
export const useStartupGate=()=>{const s=useStateSource();return{registration:s.registered?'registered':'missing',verdict:s.verdict,cloudConfigured:true,loading:false,probing:false,refresh:()=>window.fixture.retries.startup++,offlineAvailable:false}};
${decision}
export const useLocalStartupReady=()=>false;export const hasFeature=()=>true;
export const isConnectionProfileHydrated=()=>read().profileHydrated;
export const hydrateConnectionProfile=()=>read().profileHydrated?Promise.resolve():new Promise(resolve=>window.fixture.profileResolvers.push(resolve));
export const usePersonalAppearance=()=>({key:'fixture',owner:'fixture',profile:{language:'en'}});export const usePersonalAppearanceSync=noop;export const useDisplayProfile=noop;export const setPersonalLanguage=noop;
export const useSettingsNav=()=>({cards:[]});export const useVisibility=()=>({visibleRoute:()=>true});
export const useSidebarCollapsed=()=>useState(false);
export const SidebarNav=({header,children})=><div data-fixture-sidebar="mounted">{header}<nav aria-label="Fixture sidebar">Reports</nav>{children}</div>;
export const BranchShiftBanner=()=>{const s=useStateSource();return<div data-fixture-shift-banner>Shift for {s.branch}</div>};
export const ShiftCloseDialog=()=> <div data-fixture-closing-dialog>Finish closing shift</div>;
export const PermissionDenied=()=> <div role="alert">Permission denied by current route guard</div>;export const permissionMessage=()=> 'Permission required';
export const TerminalLogin=()=> <div data-fixture-login>Sign in required</div>;
export const TerminalActivation=()=> <div data-fixture-activation>Terminal setup required</div>;
export const TerminalRevokedScreen=()=> <div data-fixture-revoked>Terminal revoked</div>;
export const ConnectDatabaseScreen=()=> <div data-fixture-connect>Configure database</div>;
export const OfflineStatus=()=> <div data-fixture-offline>Offline access unavailable</div>;
export const LocationBootGuard=()=> <div data-fixture-location>Set up location</div>;
export const TillLoader=({message,onRetry})=><div role="status" data-fixture-startup>{message||'Loading store data…'}{onRetry&&<button onClick={onRetry}>Retry startup</button>}</div>;
export const useNotificationDeliveryPump=noop;export const setSharedPrinterPrefs=noop;export const sessionIdleSeconds=()=>600;export const useAutoLock=noop;export const useUiScale=noop;
export const setPrintStore=noop;export const setPrintSettings=noop;export const setServiceTerms=noop;export const bookingRulesOf=()=>({serviceTerms:''});
export const hydrateBillSequence=async()=>{};export const setBranchId=noop;export const soleBranchId=()=>null;export const flushWhatsAppQueue=async()=>{};export const closeCustomerDisplay=noop;export const reportAppReady=noop;
export const localDb=()=>null;export const startSyncEngine=()=>noop;export const flushTicketDrafts=async()=>{};export const commitLabel=()=> 'Local SQL';export const notifyError=noop;
export const ApprovalTokenButton=()=>null;export const ConnectionStatusButton=()=>null;export const SystemAlertsButton=()=>null;export const ActivityBell=()=>null;export const NativeUpdateSlot=()=>null;
export const MobileStatusSheet=()=>null;export const LiveClock=()=>null;export const ThemeToggle=()=>null;export const DbConnectionModal=()=>null;export const CloudSetupGate=()=>null;
`);
  fs.writeFileSync(path.join(dir, "main.tsx"), `
import React,{useEffect,useState}from'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';
import{AppShell}from'@/platforms/web/components/pos/AppShell';import{Dialog,DialogTrigger,DialogContent,DialogTitle,DialogDescription}from'@/components/ui/dialog';
import{DropdownMenu,DropdownMenuTrigger,DropdownMenuContent,DropdownMenuItem}from'@/components/ui/dropdown-menu';import{usePos}from'@/lib/pos-store';import'@/styles.css';
const scenario=new URLSearchParams(location.search).get('scenario')||'normal';
window.fixture={listeners:new Set(),profileResolvers:[],retries:{data:0,settings:0,startup:0},business:{actions:0,openShift:0},mounts:[],unmounts:[],switches:[],documentToken:crypto.randomUUID(),
state:{branch:'A',pathname:'/reports/sales',ready:scenario!=='cold',settingsPending:scenario==='cold',phase:'ready',error:'',actor:'one',profile:'one',mode:'online',epoch:1,permitted:true,signedIn:true,authReady:true,
native:scenario==='native'||scenario==='profile'||scenario==='revoked'||scenario==='unregistered',terminalStoreId:scenario==='native'?'A':null,management:false,profileHydrated:scenario!=='profile',verified:true,revoked:scenario==='revoked',registered:scenario!=='unregistered',device:'fixture-device',verdict:'verified',shift:{id:'shiftA',state:'ACTIVE'},shiftChecked:true,bypass:true,mayOpen:true},
patch(value){flushSync(()=>{this.state={...this.state,...value};for(const fn of this.listeners)fn()})},
switch(branch){this.switches.push(branch);if(this.state.terminalStoreId&&branch!==this.state.terminalStoreId)return;this.patch({branch,ready:false,settingsPending:true,phase:'loading',error:''})},
complete(){this.patch({ready:true,settingsPending:false,phase:'ready',error:''})}};
function Page(){const{currentStore}=usePos();const branch=currentStore.id;const[open,setOpen]=useState(false);useEffect(()=>{window.fixture.mounts.push(branch);return()=>window.fixture.unmounts.push(branch)},[]);
return<AppShell><article data-protected-page={branch}><h1>Protected report {branch}</h1><button data-page-action onClick={()=>window.fixture.business.actions++}>Page action {branch}</button>
<Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><button>Open protected dialog</button></DialogTrigger><DialogContent data-protected-dialog={branch}><DialogTitle>Branch {branch} details</DialogTitle><DialogDescription>Synthetic protected details.</DialogDescription>
<DropdownMenu><DropdownMenuTrigger asChild><button>Open protected menu</button></DropdownMenuTrigger><DropdownMenuContent data-protected-menu={branch}><DropdownMenuItem data-portal-action onSelect={()=>window.fixture.business.actions++}>Protected menu action {branch}</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
</DialogContent></Dialog></article></AppShell>};
createRoot(document.getElementById('root')).render(<AppShell><Page/></AppShell>);
`);
  const names = [
    "@/lib/pos-store", "@/lib/pos-auth", "@tanstack/react-router", "@/lib/branding", "@/platform-config/platform", "@/lib/management-device", "@/lib/use-revocation-check", "@/core/activation/registration-status",
    "@/lib/use-local-startup", "@/platform-config/features", "@/lib/connection-profile", "@/lib/personal-appearance", "@/lib/display-profile", "@/lib/time-zone", "@/platforms/web/components/pos/settings/use-settings-nav", "@/lib/ui-visibility",
    "@/platforms/web/components/pos/SidebarNav", "@/platforms/web/components/pos/BranchShiftBanner", "@/platforms/web/components/pos/ShiftCloseDialog", "./BranchShiftBanner", "@/platforms/web/components/pos/PermissionGate",
    "@/platforms/web/components/pos/TerminalLogin", "@/platforms/web/components/pos/TerminalActivation", "@/platforms/web/components/pos/ConnectDatabaseScreen", "@/platforms/mobile/components/OfflineGate", "@/platforms/web/components/pos/LocationBootGuard", "@/components/shared/TillLoader",
    "@/lib/use-notification-delivery-pump", "@/lib/receipt-printer", "@/lib/auto-lock", "@/lib/use-ui-scale", "@/lib/pos-print", "@/core/types/pos-types", "@/lib/bill-number", "@/lib/activity-journal", "@/lib/active-branch", "@/lib/whatsapp", "@/lib/customer-display", "@/lib/app-health",
    "@/core/local-db/local-db", "@/lib/sync-engine", "@/lib/session-draft", "@/core/api/pos-db", "@/lib/notify", "@/platform-config/approval-token", "@/platforms/web/components/pos/StatusCluster", "@/platforms/web/components/pos/ActivityBell", "@/components/ui/native-update-orb",
    "@/platforms/web/components/pos/MobileStatusSheet", "@/platforms/web/components/pos/LiveClock", "@/platforms/web/components/pos/ThemeToggle", "@/platforms/windows/components/DbConnectionModal", "@/platforms/web/components/pos/CloudSetupGate",
    "./session-epoch", "@/core/local-db/db-mode", "./external-supabase-config",
  ];
  const { createServer } = await import("vite"), react = (await import("@vitejs/plugin-react")).default, tailwind = (await import("@tailwindcss/vite")).default;
  const { popupRuntimeAliases } = await import(pathToFileURL(path.join(root, "scripts/popup-runtime-aliases.mjs")).href);
  const aliases = names.map(find => ({ find, replacement: path.join(dir, "mock.tsx") }));
  let server, browser, groups = 0;
  const pageErrors = [], remoteRequests = [];
  try {
    server = await createServer({ configFile: false, root, envDir: false, cacheDir: path.join(dir, ".vite"), plugins: [react(), tailwind()],
      resolve: { alias: [...aliases, ...popupRuntimeAliases(), { find: "@", replacement: path.join(root, "src") }] },
      server: { host: "127.0.0.1", port: 0, fs: { allow: [root, fs.realpathSync(path.join(root, "node_modules"))] } }, logLevel: "error" });
    await server.listen(); const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
    browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--disable-gpu"] });
    const open = async (scenario = "normal", width = 1440) => {
      const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
      page.on("pageerror", error => pageErrors.push(error.message));
      await page.route("**/*", route => {
        if (route.request().url().startsWith(origin)) return route.continue();
        remoteRequests.push(route.request().url()); return route.abort();
      });
      await page.goto(`${origin}/.tmp/branch-switch-shell-ui/index.html?scenario=${scenario}`);
      await page.waitForFunction(() => Boolean(window.fixture)); return page;
    };
    const patch = (page, value) => page.evaluate(value => window.fixture.patch(value), value);
    const expectPage = async (page, branch) => { await page.locator(`[data-protected-page="${branch}"]`).waitFor(); assert.equal(await page.locator("[data-protected-page]").count(), 1); };
    const captureShell = page => page.evaluate(() => { window.fixture.shell = { aside: document.querySelector("aside"), headers: [...document.querySelectorAll(".pos-scaled header")], token: window.fixture.documentToken }; });
    const assertShell = async page => assert(await page.evaluate(() => {
      const saved = window.fixture.shell, current = [...document.querySelectorAll(".pos-scaled header")];
      return saved.aside === document.querySelector("aside") && current.length === saved.headers.length && current.every((node, i) => node === saved.headers[i]) && saved.token === window.fixture.documentToken && performance.getEntriesByType("navigation").length === 1;
    }), "sidebar/header DOM or document identity changed during branch refresh");
    const pending = async page => {
      await page.getByLabel("Selected branch loading", { exact: true }).waitFor();
      assert.equal(await page.locator("[data-protected-page],[data-protected-dialog],[data-protected-menu],[data-fixture-closing-dialog]").count(), 0);
      assert.equal(await page.getByRole("button", { name: /^(Open shift|Finish closing|Page action)/ }).count(), 0);
      await assertShell(page);
    };
    for (const width of [1440, 390]) {
      const page = await open("normal", width); await expectPage(page, "A"); await captureShell(page);
      await page.getByRole("button", { name: "Page action A", exact: true }).click();
      // Exercise the real shared Select and mobile Sheet from AppShell itself.
      if (width === 390) await page.getByRole("button", { name: "Open menu", exact: true }).click();
      await page.getByRole("combobox", { name: "Select store", exact: true }).click();
      await page.getByRole("option", { name: "B · Shop B", exact: true }).click();
      if (width === 390) { await page.keyboard.press("Escape"); await page.getByRole("dialog", { name: "Navigation", exact: true }).waitFor({ state: "hidden" }); }
      await pending(page);
      await patch(page, { ready: true }); await pending(page); // data proof alone is insufficient
      await patch(page, { error: "Scoped settings refused" });
      await page.getByRole("alert").filter({ hasText: "Could not update this branch view" }).waitFor();
      await page.getByRole("button", { name: "Try again", exact: true }).click();
      assert.equal(await page.evaluate(() => window.fixture.retries.settings), 1); await pending(page);
      await patch(page, { settingsPending: false, error: "" }); await expectPage(page, "B"); await assertShell(page);
      await page.getByRole("button", { name: "Open protected dialog", exact: true }).click();
      await page.getByRole("dialog", { name: "Branch B details", exact: true }).waitFor();
      await page.getByRole("button", { name: "Open protected menu", exact: true }).click();
      await page.getByRole("menuitem", { name: "Protected menu action B", exact: true }).waitFor();
      await page.evaluate(() => { window.fixture.oldActions = [...document.querySelectorAll("[data-page-action],[data-portal-action]")]; window.fixture.switch("A"); });
      await pending(page);
      await page.evaluate(() => window.fixture.oldActions.forEach(node => node.click()));
      assert.equal(await page.evaluate(() => window.fixture.business.actions), 1, "unmounted branch actions remained live");
      await patch(page, { settingsPending: false, phase: "failed", error: "Branch data read refused" });
      await pending(page); await page.getByRole("button", { name: "Try again", exact: true }).click();
      assert.equal(await page.evaluate(() => window.fixture.retries.data), 1); await pending(page);
      await patch(page, { ready: true, phase: "ready", error: "" }); await expectPage(page, "A"); await assertShell(page);
      await page.getByRole("button", { name: "Page action A", exact: true }).click();
      assert.equal(await page.evaluate(() => window.fixture.business.actions), 2, "portalled focus/pointer locks prevented recovered page use");
      assert(await page.evaluate(() => document.body.style.pointerEvents !== "none"));
      assert.deepEqual(await page.evaluate(() => window.fixture.mounts), ["A", "B", "A"]);
      assert.deepEqual(await page.evaluate(() => window.fixture.unmounts), ["A", "B"]);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: path.join(dir, `branch-recovered-${width}.png`), fullPage: true });
      groups++; console.log(`PASS ${width}px authorized branch Select, stable shell, two readiness proofs, both retry paths, old nested Radix portal removal and recovered actions`); await page.close();
    }
    const cold = await open("cold"); await cold.locator("[data-fixture-startup]").waitFor(); assert.equal(await cold.locator("aside,[data-protected-page]").count(), 0);
    await patch(cold, { ready: true }); assert.equal(await cold.locator("aside,[data-protected-page]").count(), 0);
    await patch(cold, { settingsPending: false }); await expectPage(cold, "A"); groups++; await cold.close();
    for (const [field, value] of [["actor", "two"], ["profile", "two"], ["mode", "local"], ["epoch", 2], ["permitted", false]]) {
      const page = await open(); await expectPage(page, "A");
      await patch(page, { [field]: value, ready: false, settingsPending: true });
      await page.locator("[data-fixture-startup]").waitFor(); assert.equal(await page.locator("aside,[data-protected-page]").count(), 0);
      if (field === "permitted") { await patch(page, { ready: true, settingsPending: false }); await page.getByRole("alert", { name: "" }).filter({ hasText: "Permission denied" }).waitFor(); assert.equal(await page.locator("[data-protected-page]").count(), 0); }
      groups++; await page.close();
    }
    const profile = await open("profile"); await profile.locator("[data-fixture-startup]").waitFor(); assert.equal(await profile.locator("aside,[data-protected-page]").count(), 0);
    await profile.evaluate(() => { window.fixture.patch({ profileHydrated: true }); window.fixture.profileResolvers.forEach(resolve => resolve()); });
    await expectPage(profile, "A"); groups++; await profile.close();
    const auth = await open(); await expectPage(auth, "A"); await patch(auth, { authReady: false }); await auth.locator("[data-fixture-startup]").waitFor(); assert.equal(await auth.locator("aside,[data-protected-page]").count(), 0);
    await patch(auth, { authReady: true, signedIn: false }); await auth.locator("[data-fixture-login]").waitFor(); assert.equal(await auth.locator("[data-protected-page]").count(), 0); groups++; await auth.close();
    const native = await open("native"); await expectPage(native, "A"); assert.equal(await native.getByRole("combobox", { name: "Select store", exact: true }).count(), 0);
    await native.evaluate(() => window.fixture.switch("B")); await expectPage(native, "A"); assert.equal(await native.evaluate(() => window.fixture.state.branch), "A");
    await patch(native, { bypass: false, shift: null, shiftChecked: true }); await native.getByRole("heading", { name: "Terminal locked", exact: true }).waitFor();
    assert(await native.locator("[data-protected-page]").evaluate(node => Boolean(node.closest("[inert]")))); assert.equal(await native.evaluate(() => window.fixture.business.openShift), 0); groups++; await native.close();
    for (const [scenario, marker] of [["revoked", "data-fixture-revoked"], ["unregistered", "data-fixture-activation"]]) {
      const page = await open(scenario); await page.locator(`[${marker}]`).waitFor(); assert.equal(await page.locator("aside,[data-protected-page]").count(), 0); groups++; await page.close();
    }
    assert.deepEqual(pageErrors, []); assert.deepEqual(remoteRequests, []);
    console.log(`PASS ${groups} mounted React/Radix branch-switch groups; zero browser exceptions, remote traffic or full-document reloads; no operator data touched.`);
  } finally { await browser?.close(); await server?.close(); }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
