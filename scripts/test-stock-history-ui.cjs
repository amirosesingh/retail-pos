"use strict";
// Actual React/Radix rendering with synthetic report transport only. No POS
// profile, database, real transaction, credential or external network access.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { pathToFileURL } = require("node:url"), { chromium } = require("@playwright/test");
async function main() {
  const root = process.cwd(), directory = path.join(root, ".tmp", "stock-history-ui"); fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "index.html"), '<div id="root"></div><script type="module" src="/.tmp/stock-history-ui/main.tsx"></script>');
  fs.writeFileSync(path.join(directory, "fixture.ts"), `import{useMemo,useSyncExternalStore}from'react';
export let model={branch:'a',name:'Fixture A',open:true,inventory:true,export:true,shifts:true,zone:'Asia/Brunei',epoch:1,kind:'complete',liveQuantity:7,inventoryReady:true,inventoryPhase:'ready'};
const listeners=new Set();export const calls=[],exports=[],pending=[];let defer=false;
export const set=(next)=>{model={...model,...next};listeners.forEach(fn=>fn());};export const watch=()=>useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn);},()=>model);
export const useAuth=()=>{const m=watch();return{isAdmin:false,can:key=>key==='can_view_inventory'?m.inventory:key==='can_export_reports'?m.export:key==='can_shift_closing_history_view'?m.shifts:false};};
const stores=[{id:'a',groupId:'cluster-a'},{id:'b',groupId:'cluster-b'}],settings={integrations:{}},transfers=[];
const createdAt='2026-10-01T00:00:00.000Z';
export const stockAt=(product,branch)=>product.stockByStore[branch]??0;
export const usePos=()=>{const m=watch(),products=useMemo(()=>[
 {id:'live-a',ownerStoreId:'a',name:'Current branch A stock',sku:'CUR-A',barcode:'101',createdAt,stockByStore:{a:m.liveQuantity}},
 {id:'live-a-zero',ownerStoreId:'a',name:'Zero stock item',sku:'CUR-Z',barcode:'103',createdAt,stockByStore:{a:0}},
 {id:'live-b',ownerStoreId:'b',name:'Current branch B stock',sku:'CUR-B',barcode:'102',createdAt,stockByStore:{b:51}},
 ],[m.liveQuantity]);return{ready:m.inventoryReady,loadPhase:m.inventoryPhase,state:{shifts:[],settings,stores,transfers,currentStoreId:m.branch,products},currentStore:{id:m.branch,name:m.name}};};export const effectiveTimeZone=()=>watch().zone;export const sessionEpoch=()=>model.epoch;
export const useAuthOptional=()=>null;export const usePosOptional=()=>null;export const usePersonalAppearance=()=>({profile:{tableViews:{}},editable:false,update:()=>{}});
export const isCurrentEpoch=value=>value===model.epoch;
export const useReportShifts=(_seed,branch,_from,_to,enabled)=>({shifts:enabled?[{id:'30000000-0000-4000-8000-000000000001',storeId:branch,status:'CLOSED',closedAt:'2026-11-05T13:00:00.1234567Z',cashier:'Fixture cashier'}]:[],loading:false,error:''});
const first='20000000-0000-4000-8000-000000000001',second='20000000-0000-4000-8000-000000000002';
const response=(r)=>{const base={status:model.kind,reasons:[],cutoff:r.closedShiftId?'2026-11-05T13:00:00.1234567Z':r.cutoff,timeZone:r.timeZone,branchId:r.branchId,baselineAt:'2026-11-01T00:00:00.0000000Z',readAt:'2099-01-01T00:00:00.0000000Z',sourceRevision:'source-'+r.branchId,pendingCount:'0',restatable:true,next:null};
 const row=(id,qty)=>({productId:id,locationId:r.branchId,name:r.branchId==='a'?'Fixture A product':'Fixture B product',sku:'00001',barcode:'0000001',quantity:qty,negative:qty.startsWith('-')});
 if(model.kind==='acceptance')return{...base,status:'complete',pendingCount:undefined,sourceRevision:'stock-history-acceptance.v1:fixture',rows:[row(first,'6')],
  coverageThroughTicks:'17944526456789010',coverage:{acceptedLedger:'complete',writers:'unknown',balanceGrade:'verified',timeGrade:'accepted'}};
 if(model.kind==='recorded'){
  const recordedThrough='2026-11-12T03:04:05.6789010Z';
  if(r.cutoff>recordedThrough)return{...base,status:'incomplete',reasons:['INCOMPLETE_MOVEMENTS'],recordedThrough,rows:[]};
  return{...base,status:'incomplete',reasons:['WRITER_COVERAGE_UNKNOWN'],rows:[row(first,r.cutoff<recordedThrough?'7':'6')],
   coverage:{acceptedLedger:'complete',writers:'unknown',balanceGrade:'recorded_provisional',timeGrade:'recorded'}};
 }
 if(model.kind!=='complete')return{...base,status:'incomplete',baselineAt:undefined,reasons:['NO_VERIFIED_OPENING'],rows:[]};
 return{...base,rows:r.after?[row(second,'-2')]:[row(first,'9007199254740993')],next:r.after?null:first};};
export const loadStockHistoryPage=async(r)=>{calls.push(r);const page=response(r);if(defer){defer=false;return new Promise(resolve=>pending.push(()=>resolve(page)));}return page;};
export const loadStockHistoryMovements=async({after,limit,...scope})=>{if(model.kind!=='acceptance')throw new Error('Movement details are outside this fixture');
 return{...scope,status:'complete',reasons:[],baselineAt:'2026-11-01T00:00:00.0000000Z',next:null,coverage:{acceptedLedger:'complete',writers:'unknown',balanceGrade:'verified',timeGrade:'accepted'},
 rows:[{id:first,effectiveAt:'2026-11-12T03:04:05.0000000Z',recordedAt:'2026-11-12T03:04:05.0000000Z',originalAt:'2026-11-11T03:04:05.0000000Z',kind:'sale',delta:'-1'}]};};
export const loadStockActivityPage=async({cursor,limit,...scope})=>({...scope,rows:[],next:null});
export const loadStockActivityBalances=async()=>null;
export const deferNext=()=>defer=true;export const resolve=()=>pending.shift()?.();export const xlsx={utils:{book_new:()=>({sheets:[]}),aoa_to_sheet:rows=>rows,json_to_sheet:rows=>rows,book_append_sheet:(book,sheet,name)=>book.sheets.push({name,sheet})},writeFile:(book,name)=>exports.push({book,name})};
`);
  fs.writeFileSync(path.join(directory, "xlsx.ts"), `export{utils,writeFile};import{xlsx}from'./fixture';const{utils,writeFile}=xlsx;`);
  fs.writeFileSync(path.join(directory, "shell.tsx"), `export const AppShell=({children})=><main>{children}</main>;`);
  fs.writeFileSync(path.join(directory, "main.tsx"), `import React from'react';import{createRoot}from'react-dom/client';import{StockReport}from'@/platforms/web/components/pos/StockReport';import*as f from'./fixture';import'@/styles.css';
window.fixture=f;function App(){const m=f.watch();return <main className="pos-page-container"><h1>Stock report</h1><p>Stock quantities for {m.name}.</p>{m.inventory?<StockReport branchId={m.branch} branchName={m.name} initialView={m.kind==='acceptance'?'history':'current'}/>:<p role="status">Inventory permission is required to view this report.</p>}</main>;}createRoot(document.getElementById('root')).render(<App/>);`);
  const { createServer } = await import("vite"), react = (await import("@vitejs/plugin-react")).default, tailwind = (await import("@tailwindcss/vite")).default;
  const { popupRuntimeAliases } = await import(pathToFileURL(path.join(root,"scripts/popup-runtime-aliases.mjs")).href);
  let server,browser,passed=0;
  try {
    const fixture=path.join(directory,"fixture.ts");
    server=await createServer({configFile:false,envFile:false,root,cacheDir:path.join(directory,".vite"),plugins:[react(),tailwind()],resolve:{alias:[
      ...["pos-auth","pos-store","time-zone","use-report-shifts","session-epoch","stock-history-client","stock-history-movements-client","stock-activity-client","personal-appearance"].map(name=>({find:new RegExp(`^@/lib/${name}$`),replacement:fixture})),
      {find:/^@\/platforms\/web\/components\/pos\/AppShell$/,replacement:path.join(directory,"shell.tsx")},
      {find:/^xlsx$/,replacement:path.join(directory,"xlsx.ts")},...popupRuntimeAliases(),{find:"@",replacement:path.join(root,"src")},
    ]},server:{host:"127.0.0.1",port:0,fs:{allow:[root,fs.realpathSync(path.join(root,"node_modules"))]}},logLevel:"error"});
    await server.listen();const origin=`http://127.0.0.1:${server.httpServer.address().port}`;
    browser=await chromium.launch({channel:"chrome",headless:true,args:["--disable-gpu"]});
    const fresh=async width=>{const page=await browser.newPage({viewport:{width,height:840}});await page.route("**/*",route=>route.request().url().startsWith(origin)?route.continue():route.abort());await page.goto(origin+"/.tmp/stock-history-ui/index.html");await page.getByRole("region",{name:"Stock report data"}).waitFor();return page;};
    for(const width of [1440,390]) {
      const page=await fresh(width);assert.equal(await page.evaluate(()=>window.fixture.calls.length),0);
      await page.getByRole("button",{name:"Show stock at selected time",exact:true}).click();await page.getByText("9007199254740993",{exact:true}).waitFor();
      assert.equal((await page.evaluate(()=>window.fixture.calls[0])).branchId,"a");
      await page.getByRole("button",{name:"Next products"}).click();await page.getByText("Negative stock",{exact:true}).waitFor();
      const next=await page.evaluate(()=>window.fixture.calls[1]);assert.equal(next.sourceRevision,"source-a");assert.equal(next.after,"20000000-0000-4000-8000-000000000001");
      await page.getByRole("button",{name:"Export Excel"}).click();await page.waitForFunction(()=>window.fixture.exports.length===1);
      const saved=await page.evaluate(()=>window.fixture.exports[0]);assert.equal(saved.book.sheets[1].sheet.length,2);assert.equal(saved.book.sheets[1].sheet[0].Quantity,"9007199254740993");
      assert.equal(saved.book.sheets[0].sheet.find(row=>row[0]==="Location ID")[1],"a");
      const bounds=await page.getByRole("region",{name:"Stock report data"}).evaluate(element=>{const b=element.getBoundingClientRect();return{left:b.left,right:b.right,overflow:element.scrollWidth>element.clientWidth+1};});
      assert(bounds.left>=0&&bounds.right<=width+1&&!bounds.overflow,JSON.stringify({width,...bounds}));
      await page.screenshot({path:path.join(directory,`stock-${width}.png`),fullPage:true});
      const before=await page.evaluate(()=>window.fixture.calls.length);await page.waitForTimeout(150);assert.equal(await page.evaluate(()=>window.fixture.calls.length),before);
      passed++;console.log(`PASS actual report/paging/negative/exactexport/layout/no-readloop ${width}px`);await page.close();
    }
    {
      const page=await fresh(390);await page.evaluate(()=>window.fixture.set({kind:"incomplete"}));await page.getByRole("button",{name:"Show stock at selected time",exact:true}).click();
      await page.getByRole("row",{name:/Current branch A stock/}).getByText("No recorded balance",{exact:true}).waitFor();
      assert(await page.getByRole("button",{name:"Export Excel"}).isDisabled());
      passed++;console.log("PASS incomplete opening never becomes zero stock or export");await page.close();
    }
    {
      const page=await fresh(390);await page.evaluate(()=>window.fixture.set({kind:"recorded"}));
      const time=page.getByLabel("Stock report date and time");
      await time.fill("2026-11-12T11:04:05");
      await page.getByRole("button",{name:"Show stock at selected time",exact:true}).click();
      await page.getByText("7",{exact:true}).waitFor();
      await time.fill("2026-11-12T11:04:06");
      await page.getByRole("button",{name:"Show stock at selected time",exact:true}).click();
      await page.getByRole("button",{name:"View latest recorded stock"}).click();
      await page.getByText("6",{exact:true}).waitFor();
      await page.getByText("Report coverage details",{exact:true}).click();
      await page.getByText(/Recorded cutoff: 2026-11-12T03:04:05.6789010Z/).waitFor();
      assert(await page.getByRole("button",{name:"Export Excel"}).isDisabled());
      assert.equal((await page.evaluate(()=>window.fixture.calls.at(-1))).cutoff,"2026-11-12T03:04:05.6789010Z");
      passed++;console.log("PASS same-day recorded sale and precise cutoff shortcut do not promote verified export");await page.close();
    }
    {
      const page=await fresh(390);await page.evaluate(()=>window.fixture.set({kind:"acceptance"}));
      await page.getByRole("combobox",{name:"Stock cutoff method"}).click();
      await page.getByRole("option",{name:"Selected date and time"}).click();
      await page.getByLabel("Stock report date and time").fill("2026-11-12T11:04:05");
      await page.getByRole("button",{name:"Generate Report",exact:true}).click();
      await page.getByText(/Pending till uploads are outside this report/).waitFor();
      await page.getByRole("button",{name:"View movements"}).click();
      const movement=page.getByRole("table",{name:"Verified stock movements"});
      await movement.getByRole("columnheader",{name:"Database stock ledger acceptance (UTC)"}).waitFor();
      await movement.getByRole("columnheader",{name:"Original transaction time (UTC)"}).waitFor();
      await movement.getByText("2026-11-12T03:04:05.0000000Z",{exact:true}).waitFor();
      await movement.getByText("2026-11-11T03:04:05.0000000Z",{exact:true}).waitFor();
      await page.getByRole("button",{name:"Close movements"}).click();
      assert(await page.getByRole("button",{name:"View movements"}).evaluate(element=>element===document.activeElement));
      passed++;console.log("PASS Stock History shows separate acceptance and original sale times, with movement focus restored");await page.close();
    }
    {
      const page=await fresh(390);await page.evaluate(()=>window.fixture.deferNext());await page.getByRole("button",{name:"Show stock at selected time",exact:true}).click();
      await page.evaluate(()=>window.fixture.set({branch:"b",name:"Fixture B",epoch:2}));await page.getByText("Stock quantities for Fixture B.",{exact:true}).waitFor();await page.evaluate(()=>window.fixture.resolve());
      assert.equal(await page.getByText("Fixture A product",{exact:true}).count(),0);await page.getByRole("table",{name:"Current inventory"}).waitFor();
      await page.getByRole("button",{name:"Show stock at selected time",exact:true}).click();await page.getByText("Fixture B product",{exact:true}).waitFor();
      passed++;console.log("PASS late response discarded after branch/session change");await page.close();
    }
    {
      const page=await fresh(1440);await page.getByRole("combobox",{name:"Stock cutoff method"}).click();await page.getByRole("option",{name:"After a closed shift"}).click();
      await page.getByRole("combobox",{name:"Closed shift stock cutoff"}).click();await page.getByRole("option",{name:/Fixture cashier/}).click();await page.getByRole("button",{name:"Show stock at selected time",exact:true}).click();
      await page.getByText("Report coverage details",{exact:true}).click();
      await page.getByText(/Exact cutoff: 2026-11-05T13:00:00.1234567Z/).waitFor();assert.equal((await page.evaluate(()=>window.fixture.calls[0])).closedShiftId,"30000000-0000-4000-8000-000000000001");
      passed++;console.log("PASS saved closed-shift source instant survives exact precision");await page.close();
    }
    {
      const page=await fresh(390);await page.evaluate(()=>window.fixture.set({zone:"America/New_York"}));await page.getByLabel("Stock report date and time").fill("2026-11-01T01:30");
      await page.getByRole("button",{name:"Show stock at selected time",exact:true}).click();await page.getByRole("alert").getByText(/occurs twice/).waitFor();assert.equal(await page.evaluate(()=>window.fixture.calls.length),0);
      await page.getByRole("combobox",{name:"Stock cutoff UTC offset"}).click();await page.getByRole("option",{name:/UTC−05:00/}).click();await page.getByRole("button",{name:"Show stock at selected time",exact:true}).click();
      await page.getByText("9007199254740993",{exact:true}).waitFor();assert.equal((await page.evaluate(()=>window.fixture.calls[0])).cutoff,"2026-11-01T06:30:00.0000000Z");
      passed++;console.log("PASS repeated DST hour requires explicit occurrence before request");await page.close();
    }
    {
      const page=await fresh(390);await page.evaluate(()=>window.fixture.set({export:false,shifts:false}));assert.equal(await page.getByRole("button",{name:"Export Excel"}).count(),0);
      await page.getByRole("combobox",{name:"Stock cutoff method"}).click();assert.equal(await page.getByRole("option",{name:"After a closed shift"}).count(),0);await page.keyboard.press("Escape");
      await page.evaluate(()=>window.fixture.set({inventory:false,epoch:2}));await page.getByRole("region",{name:"Stock report data"}).waitFor({state:"detached"});
      passed++;console.log("PASS independent export/shift visibility and inventory revocation");await page.close();
    }
    for(const width of [1440,390]) {
      const page=await browser.newPage({viewport:{width,height:840}});
      await page.route("**/*",route=>route.request().url().startsWith(origin)?route.continue():route.abort());
      await page.goto(origin+"/.tmp/stock-history-ui/index.html?report");
      await page.getByRole("heading",{name:"Stock report"}).waitFor();
      assert.equal(await page.evaluate(()=>window.fixture.calls.length),0);
      assert.equal(await page.getByRole("dialog").count(),0);await page.getByRole("table",{name:"Current inventory"}).waitFor();
      await page.getByRole("region",{name:"Stock report data"}).waitFor();await page.getByRole("button",{name:"Show stock at selected time",exact:true}).click();
      await page.getByText("9007199254740993",{exact:true}).waitFor();
      assert.equal((await page.evaluate(()=>window.fixture.calls[0])).branchId,"a");
      await page.evaluate(()=>window.fixture.set({inventory:false,epoch:2}));
      await page.getByRole("region",{name:"Stock report data"}).waitFor({state:"detached"});
      await page.getByText("Inventory permission is required to view this report.",{exact:true}).waitFor();
      assert.equal(await page.getByRole("table",{name:"Current inventory"}).count(),0);
      passed++;console.log(`PASS mounted report preserves inline scoped inventory and permission revocation ${width}px`);await page.close();
    }
    console.log(`PASS ${passed} actual stock-history UI groups`);
  } finally {await browser?.close();await server?.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
