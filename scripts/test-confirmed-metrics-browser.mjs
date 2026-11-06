// Synthetic mounted presentation acceptance. No application profile/backend/data.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { chromium } from "@playwright/test";
assert.deepEqual(process.argv.slice(2), ["--run"]);
const root = process.cwd(), fixture = resolve(root, ".tmp/confirmed-metrics-browser");
await mkdir(fixture, { recursive: true });
await writeFile(resolve(fixture, "context.ts"), `
const directory=[{id:'A',name:'Airport'}],products=[],empty=[];
const reportRows=Array.from({length:2},(_,n)=>({id:'sale'+n,storeId:'A',receiptNo:'R1',cashier:'Fixture',createdAt:new Date(Date.now()-n*7*86400000).toISOString(),subtotal:100,discount:10,tax:0,total:90,paid:90,change:0,method:'cash',lines:Array.from({length:10},(_,i)=>({productId:'p'+i,name:'Item '+i,qty:1,price:10,cost:3,discount:1,taxRate:0}))}));
export const money=(v:number)=>'B$'+v.toFixed(2);
export const useAuth=()=>({ready:window.fixture.auth,user:window.fixture.user,can:(flag:string)=>flag!=='can_view_cost_margin'||window.fixture.user?.permissions.cost!==false,canSwitchStores:true,terminalStoreId:null});
export const usePosOptional=()=>({ready:window.fixture.database,currentStore:{id:window.fixture.branch,name:'Airport'}});
export const usePos=()=>({...usePosOptional(),stores:directory,allStores:directory,state:{products,sales:empty,stores:directory,transfers:empty,settings:{integrations:{includeSponsorshipInDailySales:window.fixture.includeSponsor}}}});
export const useReportSales=(_seed,ids,from,to)=>{if(window.fixture.trackRequests){const key=JSON.stringify([ids,from,to]);if(window.fixture.lastRequestKey!==key){if(window.fixture.lastRequestKey)window.fixture.ready=false;window.fixture.lastRequestKey=key;window.fixture.readRequests.push(key);}}return{sales:reportRows,loading:!window.fixture.ready,error:window.fixture.reportError||''}};
export const useSponsorshipTotals=()=>({total:25,loading:!!window.fixture.sponsorLoading,error:window.fixture.sponsorError||'',rows:empty});
const boardData={storeDays:[{store_id:'A',sale_day:new Date().toISOString().slice(0,10),sale_month:new Date().toISOString().slice(0,7),revenue:100,cost:40,profit:60,bills:1,discount:20,foc_value:5,units:3}],itemDays:[],bills:[{store_id:'A',store_name:'Airport',created_at:new Date().toISOString(),total:100,discount_amount:40,coupon_discount:5}],storeNames:{A:'Airport'},liveStoreIds:['A'],hourlyRows:[]};
export const useQuery=()=>({data:boardData,isLoading:false,isFetching:false,isError:false,error:null,refetch:()=>{}});
export const PAGE_DATA_CACHE={};
export const localDb=()=>null,effectiveDatabaseMode=()=>'online';
export const loadHourlyTrading=()=>{throw new Error('Unexpected hourly backend fixture call')},hostedFunction=()=>{throw new Error('Unexpected hosted fixture call')},getPosCallerAuth=()=>{throw new Error('Unexpected credential fixture call')};
export const supabaseExternal=new Proxy({}, {get(){throw new Error('Unexpected backend request in fixture')}});
export const useDrawerEvents=()=>empty;
export const terminalRuntimePlatform=()=>'web';
export const HomeShortcuts=()=>null,CashierBillList=()=>null;
export const useViewedBranchShift=()=>({shift:null,checked:true,error:false});
export const useVisibility=()=>({visible:(key:string)=>(!window.fixture.showDashboard||['dashboard.revenueSummary','dashboard.tradingGraphs'].includes(key))&&!window.fixture.hidden?.includes(key),visibleRoute:()=>true});
export const SellingShortcuts=()=>null;
export const SalesReportWorkspace=()=>null,ReportReceiptLink=()=>null;
export const useSalesReportContext=()=>null;
export const useSalesReportFilters=()=>({from:new Date(Date.now()-29*86400000).toISOString().slice(0,10),to:new Date().toISOString().slice(0,10),storeId:'all',cashier:'all',q:''});
export const pageDataScope=(user:any)=>[window.fixture.epoch,window.fixture.backend,user?.staffId,user?.permissions];
export const AppShell=({children}:any)=>children;
export const Table=AppShell,TableBody=AppShell,TableRow=AppShell,TableCell=AppShell,TableHead=AppShell,TableHeader=AppShell;
export const createFileRoute=()=>options=>({options});export const Link=()=>null;
export const notifyError=()=>{throw new Error('Unexpected notification in fixture')};`);
await writeFile(resolve(fixture, "index.html"), '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/fixture.tsx"></script></body></html>');
await writeFile(resolve(fixture, "fixture.tsx"), `
import React,{useState}from'react';import{createRoot}from'react-dom/client';
import '${resolve(root, "src/styles.css").replaceAll("\\", "/")}';
import{ConfirmedMetricCards}from'@/platforms/web/components/pos/ConfirmedMetricCards';
import{StatCard}from'@/platforms/web/components/pos/report-kit';
import{InventorySummaryCards}from'@/platforms/web/components/pos/InventorySummaryCards';
import{Route as AnalyticsRoute}from'@/routes/reports.analytics';
import{TerminalWorkspaceHome}from'@/platforms/web/components/pos/TerminalWorkspaceHome';
import{BillsReport}from'@/routes/reports.sales';
import{Route as DashboardRoute}from'@/routes/dashboard';
import{Route as BoardRoute}from'@/routes/analytics';
const initial={auth:true,database:false,user:{staffId:'admin',permissions:{cost:true}},branch:'A',epoch:1,backend:'one',ready:false,value:9,profit:-3,range:'today',revision:0,auditScope:'audit-A',auditReady:false,error:''};
window.fixture={...initial};function Fixture(){const[,render]=useState(0);window.update=(patch)=>{Object.assign(window.fixture,patch);render(v=>v+1)};const f=window.fixture;
const witness=JSON.stringify({scope:f.auditScope,revision:f.revision,ready:f.auditReady,error:f.error});
return <main className="max-w-5xl space-y-4 p-4"><h1>Confirmed metric acceptance</h1>
<ConfirmedMetricCards label="Actual report cards" scope={f.range} ready={f.ready}>
<StatCard label="Bills" metricValue={f.value} value={String(f.value)}/>
<StatCard label="Profit" metricValue={f.user?.permissions.cost?f.profit:0} moneyValue value={'B$'+f.profit.toFixed(2)}/>
<StatCard label="Zero" metricValue={0} value="B$0.00"/></ConfirmedMetricCards>
<ConfirmedMetricCards label="Audit report cards" scope={f.range} ready={true} auditWitness={witness}>
<StatCard label="Events" metricValue={7} value="7"/></ConfirmedMetricCards>
<InventorySummaryCards ready={f.database} metrics={{products:1535,categories:41,lowStock:1245,negativeStock:0,outOfStock:0,units:2186.125,costValue:0,retailValue:0,potentialProfit:0}} showStockValue={false}/>
{f.showReport&&React.createElement(AnalyticsRoute.options.component)}
{f.showWorkspace&&<TerminalWorkspaceHome/>}{f.showBills&&<BillsReport/>}{f.showDashboard&&React.createElement(DashboardRoute.options.component)}{f.showBoard&&React.createElement(BoardRoute.options.component)}
</main>};createRoot(document.getElementById('root')).render(<Fixture/>);`);
let server, browser;
try {
  server = await createServer({ configFile: false, envDir: false, root: fixture,
    cacheDir: resolve(fixture, "vite-cache"), plugins: [tailwind(), react()],
    resolve: { alias: ["@/lib/pos-auth", "@/lib/pos-store", "@/lib/page-data-cache", "@/lib/notify", "@/components/ui/table", "./AppShell", "@/platforms/web/components/pos/AppShell", "@/lib/use-report-sales", "@tanstack/react-router", "@/lib/use-sponsorship-totals", "@/lib/use-viewed-branch-shift", "@/lib/ui-visibility", "./SellingShortcuts", "@/platforms/web/components/pos/SalesReportWorkspace", "@/platforms/web/components/pos/ReportReceiptLink", "@/lib/sales-report-context", "@/lib/drawer-events", "@/core/activation/terminal-platform", "@/platforms/web/components/pos/HomeShortcuts", "@/platforms/web/components/pos/CashierBillList", "@tanstack/react-query", "@/core/local-db/local-db", "@/core/local-db/db-mode", "@/integrations/supabase/external-client", "./trading-hours.functions", "./hosted-function-client", "./pos-caller-auth"].map(find => ({ find, replacement: resolve(fixture, "context.ts") })).concat([{ find: "@", replacement: resolve(root, "src") }]) },
    server: { host: "127.0.0.1", port: 0, fs: { allow: [resolve(root, "../.."), root, fixture] } },
  });
  await server.listen(); const url = server.resolvedUrls.local[0];
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "no-preference" });
  const errors = [], unexpected = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if(message.type()==="error"&&message.text().includes("same key"))errors.push(message.text()); });
  page.on("request", request => { if (!request.url().startsWith(url) && !request.url().startsWith("data:")) unexpected.push(request.url()); });
  await page.goto(url); await page.getByRole("heading", { name: "Confirmed metric acceptance" }).waitFor();
  const cards = page.getByRole("region", { name: "Actual report cards", exact: true });
  const audit = page.getByRole("region", { name: "Audit report cards", exact: true });
  const update = patch => page.evaluate(patch => window.update(patch), patch);
  assert.equal(await cards.count(), 0); assert.equal(await audit.count(), 0);
  await update({ database: true }); assert.equal(await cards.count(), 0, "database alone does not confirm report");
  const inventory = page.getByRole("region", { name: "Inventory metrics", exact: true });
  await inventory.waitFor();
  assert((await inventory.textContent()).includes("1,535")); assert((await inventory.textContent()).includes("2,186.125"), "first mounted value must be exact, never count from zero");
  await update({ ready: true }); await cards.waitFor();
  assert.equal(await cards.locator(".report-stat").count(), 2); assert((await cards.textContent()).includes("B$-3.00")); assert(!(await cards.textContent()).includes("Zero"));
  await update({ ready: false, value: 999 }); assert((await cards.textContent()).includes("9")); assert(!(await cards.textContent()).includes("999"), "same-scope refresh retains confirmed values");
  await update({ range: "yesterday" }); assert.equal(await cards.count(), 0);
  await update({ ready: true, value: 0 }); await cards.waitFor(); assert.equal(await cards.locator(".report-stat").count(), 1, "negative remains and zero does not leave empty slide");
  await update({ ready: false, user: { staffId: "admin", permissions: { cost: false } } }); assert.equal(await cards.count(), 0, "revocation must not retain old cost card");
  await update({ ready: true, value: 5 }); await cards.waitFor(); assert.equal(await cards.locator(".report-stat").count(), 1); assert(!(await cards.textContent()).includes("Profit"));
  await update({ auditReady: true, revision: 1 }); await audit.waitFor();
  await update({ auditReady: false, error: "Unavailable" }); assert.equal(await audit.count(), 1); assert(await page.getByRole("alert").isVisible());
  await update({ user: { staffId: "admin", permissions: { cost: true } }, error: "", auditReady: true }); assert.equal(await audit.count(), 0, "same-audit-scope permission change needs a new successful existing read");
  await update({ revision: 2 }); await audit.waitFor();
  for (const patch of [{ branch: "B", auditScope: "audit-B", auditReady: false }, { epoch: 2, auditScope: "audit-session-2" }, { backend: "two", auditScope: "audit-db-two" }, { auth: false, user: null }]) {
    await update({ ...patch, ready: false }); assert.equal(await cards.count(), 0); assert.equal(await audit.count(), 0);
  }
  await update({ auth: true, user: { staffId: "admin", permissions: { cost: true } }, branch: "A", epoch: 1, backend: "one", value: 9, profit: -3, range: "today", auditScope: "audit-A", error: "", database: true, ready: true, auditReady: true, revision: 3 }); await cards.waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  assert(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
  await page.emulateMedia({ reducedMotion: "reduce" }); await update({ value: 0 });
  assert.equal(await cards.locator(".report-stat").count(), 1);
  await page.screenshot({ path: resolve(fixture, "phone.png"), fullPage: true });
  await update({ showReport: true, ready: false });
  assert.equal(await page.locator("[data-trading-chart-card]").count(), 0);
  assert.equal(await page.getByRole("region", { name: "Business analytics totals", exact: true }).count(), 0);
  await update({ ready: true });
  const charts = page.locator("[data-trading-chart-card]"); await charts.first().waitFor();
  assert.equal(await charts.count(), 4, "actual Analytics report uses four bounded chart cards");
  assert((await charts.evaluateAll(nodes => nodes.every(node => node.getBoundingClientRect().height === 416))));
  const topItems = page.getByLabel("Top selling items chart", { exact: true });
  assert(await topItems.evaluate(node => node.scrollHeight > node.clientHeight));
  assert((await topItems.textContent()).includes("Item 9"), "last item remains in the actual chart");
  await update({ ready: false, reportError: "Unavailable" });
  await page.getByRole("button", { name: "Monthly", exact: true }).click();
  assert(await page.getByRole("heading", {name:"Monthly revenue",exact:true}).count(),"retained DATA must not freeze local controls after a failed refresh");
  // A valid horizontal SVG path has zero bounding-box height in Playwright.
  await page.locator(".recharts-line-curve").waitFor({ state: "attached" });
  assert.equal(await page.locator(".recharts-line-curve").getAttribute("stroke-linejoin"), "round");
  await page.getByRole("button", {name:"Units",exact:true}).click();
  assert((await topItems.textContent()).includes('2'), 'Units axis must use the retained actual quantities after failure');
  await page.getByRole("region", {name:"Business analytics graphs",exact:true}).evaluate(node=>node.scrollTo({left:0,behavior:"instant"}));
  await page.mouse.move(1,1);
  await page.screenshot({ path: resolve(fixture, "analytics-phone.png"), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: resolve(fixture, "analytics-desktop.png"), fullPage: true });
  await update({showReport:false,showWorkspace:true,ready:true,reportError:"",includeSponsor:false});
  const workspace=page.getByRole("region",{name:"Workspace overview",exact:true});await workspace.waitFor();
  assert((await workspace.textContent()).includes("Today's revenue"));
  await update({ready:false,reportError:"Offline"});
  assert((await workspace.textContent()).includes("Today's revenue"));assert((await workspace.textContent()).includes("Today's bills"));
  await update({hidden:["workspace.todayRevenue"]});assert(!(await workspace.textContent()).includes("Today's revenue"));
  await update({hidden:[],includeSponsor:true});assert(!(await workspace.textContent()).includes("Today's sales summary"),"new interpretation needs confirmation");
  await update({branch:"B"});assert(!(await workspace.textContent()).includes("Today's revenue"));
  await update({showWorkspace:false,showBills:true,branch:"A",ready:true,reportError:"",includeSponsor:true,sponsorLoading:true});
  const bills=page.getByRole("region",{name:"Sales report totals",exact:true});await bills.waitFor();
  assert((await bills.textContent()).includes("Completed bills"));assert((await bills.textContent()).includes("Total collected"));
  assert(!(await bills.textContent()).includes("Sales value with sponsorship"));
  await update({sponsorLoading:false,sponsorError:"Unavailable"});assert((await bills.textContent()).includes("Total collected"));
  await update({sponsorError:""});assert((await bills.textContent()).includes("Sales value with sponsorship"));
  await update({sponsorError:"Unavailable",reportError:"Offline"});assert((await bills.textContent()).includes("Sales value with sponsorship"));
  await page.emulateMedia({reducedMotion:"no-preference"});
  await update({showBills:false,showDashboard:true,includeSponsor:false,ready:true,reportError:'',trackRequests:true,lastRequestKey:null,readRequests:[],hidden:[]});
  const graphHeading=page.getByRole('heading',{name:'Trending graphs',exact:true});await graphHeading.waitFor();
  const collected=page.getByText('Sales collected today',{exact:true}),period=page.getByLabel('Trading graphs period',{exact:true}),grouping=page.getByLabel('Shop chart grouping',{exact:true}),kind=page.getByLabel('Shop comparison chart',{exact:true});
  await collected.waitFor();const originalKpi=await collected.elementHandle(),originalPeriod=await period.elementHandle(),originalHeading=await graphHeading.elementHandle();
  const requestCount=()=>page.evaluate(()=>window.fixture.readRequests.length);
  assert.equal(await requestCount(),1);
  await grouping.selectOption('monthly');await kind.selectOption('bar');assert.equal(await requestCount(),1,'presentation controls do not request another report');
  await period.selectOption('7');assert.equal(await requestCount(),2);assert(await collected.isVisible(),'Today KPI stays visible during graph-only request');
  assert(await originalKpi.evaluate(node=>node.isConnected));assert(await originalPeriod.evaluate(node=>node.isConnected));assert(await originalHeading.evaluate(node=>node.isConnected));
  assert.equal(await grouping.inputValue(),'monthly');assert.equal(await kind.inputValue(),'bar');
  await period.selectOption('30');assert.equal(await requestCount(),3);
  await page.waitForFunction(()=>[...document.querySelectorAll('[data-chart-phase]')].every(node=>node.getAttribute('data-chart-phase')==='waiting'));
  assert(await collected.isVisible());assert.equal(await page.getByRole('list',{name:'Gross margin by shop',exact:true}).count(),0,'pending graph range does not label old margin as current');await update({ready:true});
  assert(await page.locator('[data-chart-phase="enter"]').count(),"confirmed plots enter visually without interpolating values");
  assert(await page.evaluate(()=>document.getAnimations().some(animation=>animation.effect?.getKeyframes().some(frame=>String(frame.transform).includes('scaleY')))),"actual graph pixels animate");
  await page.waitForFunction(()=>[...document.querySelectorAll('[data-chart-phase]')].every(node=>node.getAttribute('data-chart-phase')==='ready'));
  assert.equal(await grouping.inputValue(),'monthly');assert.equal(await kind.inputValue(),'bar');assert.equal(await requestCount(),3);
  await update({user:{staffId:'cashier',permissions:{cost:false}},auth:false});
  assert.equal(await page.locator('[data-trading-chart-card]').count(),0,'sign-out drops protected graphs immediately');
  await update({showDashboard:false,showBoard:true,auth:true,user:{staffId:'admin',permissions:{cost:true}},ready:true,trackRequests:false});
  const giveaways=page.locator('[data-trading-chart-card]').filter({has:page.getByRole('heading',{name:'Where the money went',exact:true})});await giveaways.waitFor();
  await page.waitForFunction(()=>[...document.querySelectorAll('[data-chart-phase]')].every(node=>node.getAttribute('data-chart-phase')==='ready'));
  for(const dark of [false,true]){
    await page.evaluate(dark=>document.documentElement.classList.toggle('dark',dark),dark);
    const fills=await giveaways.locator('.recharts-bar').evaluateAll(nodes=>nodes.map(node=>getComputedStyle(node.querySelector('.recharts-rectangle')).fill));
    assert.equal(fills.length,5);assert.equal(new Set(fills).size,5,'actual Board giveaway measures use five distinct colors in either theme');
  }
  await update({user:{staffId:'admin',permissions:{cost:false}}});
  assert.equal(await giveaways.locator('.recharts-bar').count(),4,'cost denial removes the profit stack immediately');
  assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
  console.log("PASS mounted Chrome metric gates: database/report/audit confirmation, exact first values, zero/negative cards, refresh/error retention, date/branch/session/backend/permission invalidation, reduced motion and 390px layout.");
} finally { await browser?.close(); await server?.close(); }
