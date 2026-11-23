'use strict';
// Actual React/Radix presentation + real export helper. Only synthetic report
// transport/context; no profile, credential, database or external network.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url'),{chromium}=require('@playwright/test');
async function main(){
 const root=process.cwd(),directory=path.join(root,'.tmp','stock-report-ui');fs.mkdirSync(directory,{recursive:true});
 fs.writeFileSync(path.join(directory,'index.html'),'<div id="root"></div><script type="module" src="/.tmp/stock-report-ui/main.tsx"></script>');
 fs.writeFileSync(path.join(directory,'fixture.ts'),`import{useMemo,useSyncExternalStore}from'react';
export let model={branch:'a',name:'Fixture A',open:true,mount:true,inventory:true,export:true,shifts:true,zone:'Asia/Brunei',epoch:1,kind:'complete',liveQuantity:7,inventoryReady:true,inventoryPhase:'ready',movementKind:'complete',activity:false,pagedActivity:false};
const listeners=new Set();export const calls=[],movementCalls=[],activityCalls=[],exports=[],pending=[],commits=[];let defer=false,deferMovement=false,deferActivity=false;
export const set=next=>{model={...model,...next};listeners.forEach(fn=>fn());};export const watch=()=>useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn);},()=>model);
export const useAuth=()=>{const m=watch();return{isAdmin:false,user:{staffId:'fixture-'+m.epoch},can:key=>key==='can_view_inventory'?m.inventory:key==='can_export_reports'?m.export:key==='can_shift_closing_history_view'?m.shifts:false};};
const stores=[{id:'a',groupId:'cluster-a'},{id:'b',groupId:'cluster-b'}],settings={integrations:{}},transfers=[];
export const stockAt=(product,branch)=>product.stockByStore[branch]??0;
export const usePos=()=>{const m=watch(),products=useMemo(()=>[
 {id:'live-a',ownerStoreId:'a',name:'Current branch A stock',sku:'CUR-A',barcode:'101',stockByStore:{a:m.liveQuantity}},
 {id:'live-a-zero',ownerStoreId:'a',name:'Zero stock item',sku:'CUR-Z',barcode:'103',stockByStore:{a:0}},
 {id:'live-b',ownerStoreId:'b',name:'Current branch B stock',sku:'CUR-B',barcode:'102',stockByStore:{b:51}},
 ],[m.liveQuantity]);return{ready:m.inventoryReady,loadPhase:m.inventoryPhase,state:{shifts:[],settings,stores,transfers,currentStoreId:m.branch,products},currentStore:{id:m.branch,name:m.name}};};
export const effectiveTimeZone=()=>watch().zone,sessionEpoch=()=>model.epoch,isCurrentEpoch=epoch=>epoch===model.epoch;
export const useAuthOptional=()=>null,usePosOptional=()=>null,usePersonalAppearance=()=>({profile:{tableViews:{}},editable:false,update:()=>{}});
export const useReportShifts=(_seed,branch,_from,_to,enabled)=>({shifts:enabled?[{id:'30000000-0000-4000-8000-000000000001',storeId:branch,status:'CLOSED',closedAt:'2026-11-05T13:00:00.1234567Z',cashier:'Fixture cashier'}]:[],loading:false,error:''});
const first='20000000-0000-4000-8000-000000000001',second='20000000-0000-4000-8000-000000000002';
function response(r){const cutoff=r.closedShiftId?'2026-11-05T13:00:00.1234567Z':r.cutoff;
 const base={status:model.kind,reasons:[],cutoff,timeZone:r.timeZone,branchId:r.branchId,baselineAt:'2026-11-01T00:00:00.0000000Z',readAt:'2099-01-01T00:00:00.0000000Z',sourceRevision:'source-'+r.branchId,pendingCount:'0',restatable:true,next:null};
 if(r.periodStart)base.period={start:r.periodStart,endExclusive:'2026-11-06T16:00:00.0000000Z',through:cutoff,fullDay:false};
 const row=(id,negative)=>({productId:id,locationId:r.branchId,name:r.branchId==='a'?'Fixture A product':'Fixture B product',sku:'00001',barcode:'0000001',quantity:negative?'-2':'9007199254740993',negative,
  ...(r.periodStart?{openingQuantity:negative?'1':'9007199254740991',inQuantity:negative?'0':'5',outQuantity:'3'}:{})});
 if(model.kind==='incomplete')return{...base,baselineAt:undefined,reasons:['NO_VERIFIED_OPENING'],rows:[]};
 if(model.kind==='schema')return{...base,status:'unavailable',cutoff:r.cutoff,baselineAt:undefined,period:undefined,reasons:['SCHEMA_NOT_INSTALLED'],rows:[]};
 if(model.kind==='zero-pages')return{...base,status:'complete',rows:[
  {...row(r.after?second:first,false),name:r.after?'Historical zero stock':'Historical earlier balance',quantity:r.after?'0':'7'},
 ],next:r.after?null:first};
 const record={...base,rows:r.after?[row(second,true)]:[row(first,false)],next:r.after?null:first};
 if(model.kind==='provisional')return{...record,status:'incomplete',reasons:['WRITER_COVERAGE_PENDING'],coverage:{acceptedLedger:'complete',writers:'pending',balanceGrade:'recorded_provisional',timeGrade:'author_entered'}};
 if(model.kind==='ungraded')return{...record,status:'incomplete',reasons:['NO_VERIFIED_OPENING']};
 return record;
}
export const loadStockHistoryPage=async r=>{calls.push(r);if(model.kind==='error')throw new Error('Synthetic stock reader unavailable');const page=response(r);if(defer){defer=false;return new Promise(resolve=>pending.push(()=>resolve(page)));}return page;};
export const loadStockHistoryMovements=async r=>{
 movementCalls.push(r);
 const {after,limit,...scope}=r;
 const first='40000000-0000-4000-8000-000000000001',second='40000000-0000-4000-8000-000000000002';
 const page={...scope,status:model.movementKind,reasons:[],baselineAt:'2026-11-01T00:00:00.0000000Z',next:null,rows:[]};
 if(model.movementKind==='complete'){
  const row={id:after?second:first,effectiveAt:r.cutoff,recordedAt:'2099-01-01T00:00:00.0000000Z',kind:after?'sale':'receiving',delta:after?'-3':'9007199254740993'};
  page.rows=[row];page.next=after?null:{id:row.id,effectiveAt:row.effectiveAt};
 }else if(model.movementKind==='incomplete')page.reasons=['WRITER_COVERAGE_PENDING'];
 if(deferMovement){deferMovement=false;return new Promise(resolve=>pending.push(()=>resolve(page)));}return page;
};
export const deferNext=()=>defer=true,resolve=()=>pending.shift()?.();
export const deferNextMovement=()=>deferMovement=true;
export const deferNextActivity=()=>deferActivity=true;
const activities=[
 {id:'50000000-0000-4000-8000-000000000001',productId:first,productName:'Recorded test item',branchId:'a',occurredAt:'2026-11-05T02:00:00.0000000Z',kind:'receive',delta:7,before:0,after:7,reference:'RECEIVE-1'},
 {id:'50000000-0000-4000-8000-000000000002',productId:first,productName:'Recorded test item',branchId:'a',occurredAt:'2026-11-05T03:00:00.1234567Z',kind:'sale',delta:-1,before:null,after:null,reference:'SALE-1'},
 {id:'50000000-0000-4000-8000-000000000003',productId:second,productName:'Recorded zero item',branchId:'a',occurredAt:'2026-11-05T02:00:00.0000001Z',kind:'stock_adjustment',delta:-1,before:1,after:0,reference:'ADJUST-1'},
];
export const loadStockActivityPage=async request=>{
 activityCalls.push(request);
 const {cursor,limit,...scope}=request;
 const earlier=scope.side==='through-cutoff', extra=model.pagedActivity?Array.from({length:25},(_,index)=>({
  ...activities[0],id:'60000000-0000-4000-8000-'+String(index+1).padStart(12,'0'),reference:null,delta:0,before:null,after:null,
  occurredAt:'2026-11-05T02:00:'+String(index+1).padStart(2,'0')+'.0000000Z',kind:'stock_adjustment',
 })):[];
 const position=(a,b)=>a.occurredAt.localeCompare(b.occurredAt)||a.id.localeCompare(b.id);
 const all=model.activity?[...activities,...extra].filter(row=>row.branchId===request.branchId&&(!scope.productId||row.productId===scope.productId)&&
  (earlier?row.occurredAt<=scope.cutoff:row.occurredAt>scope.cutoff)&&(!cursor||(earlier?position(row,cursor)<0:position(row,cursor)>0)))
  .sort((a,b)=>earlier?position(b,a):position(a,b)):[];
 const rows=all.slice(0,limit),last=rows.at(-1),page={...scope,rows,next:all.length>limit?{occurredAt:last.occurredAt,id:last.id}:null};
 if(deferActivity){deferActivity=false;return new Promise(resolve=>pending.push(()=>resolve(page)));}
 return page;
};
export const xlsx={utils:{book_new:()=>({sheets:[]}),aoa_to_sheet:rows=>rows,json_to_sheet:rows=>rows,book_append_sheet:(book,sheet,name)=>book.sheets.push({name,sheet})},writeFile:(book,name)=>exports.push({book,name})};
`);
 fs.writeFileSync(path.join(directory,'xlsx.ts'),`export{utils,writeFile};import{xlsx}from'./fixture';const{utils,writeFile}=xlsx;`);
 fs.writeFileSync(path.join(directory,'shell.tsx'),`export const AppShell=({children})=><main>{children}</main>;`);
 fs.writeFileSync(path.join(directory,'main.tsx'),`import React,{useLayoutEffect}from'react';import{createRoot}from'react-dom/client';import{StockAtTimeReport}from'@/routes/reports.inventory';import*as f from'./fixture';import'@/styles.css';
window.fixture=f;function App(){const m=f.watch();useLayoutEffect(()=>{f.commits.push({branch:m.branch,epoch:m.epoch,inventory:m.inventory,export:m.export,text:document.getElementById('root')?.textContent});},[m]);return !m.mount?null:<StockAtTimeReport/>;}createRoot(document.getElementById('root')).render(<App/>);`);
 const{createServer}=await import('vite'),react=(await import('@vitejs/plugin-react')).default,tailwind=(await import('@tailwindcss/vite')).default;
 const{popupRuntimeAliases}=await import(pathToFileURL(path.join(root,'scripts/popup-runtime-aliases.mjs')).href);
 let server,browser,passed=0;
 try{
  const fixture=path.join(directory,'fixture.ts');server=await createServer({configFile:false,root,cacheDir:path.join(directory,'.vite'),plugins:[react(),tailwind()],resolve:{alias:[
   ...['pos-auth','pos-store','time-zone','use-report-shifts','session-epoch','stock-history-client','stock-history-movements-client','stock-activity-client','personal-appearance'].map(name=>({find:new RegExp('^@/lib/'+name+'$'),replacement:fixture})),
   {find:/^@\/platforms\/web\/components\/pos\/AppShell$/,replacement:path.join(directory,'shell.tsx')},{find:/^xlsx$/,replacement:path.join(directory,'xlsx.ts')},...popupRuntimeAliases(),{find:'@',replacement:path.join(root,'src')},
  ]},server:{host:'127.0.0.1',port:0,fs:{allow:[root,fs.realpathSync(path.join(root,'node_modules'))]}},logLevel:'error'});
  await server.listen();const origin='http://127.0.0.1:'+server.httpServer.address().port;browser=await chromium.launch({channel:'chrome',headless:true,args:['--disable-gpu']});
  const fresh=async(width=390,dark=false)=>{const page=await browser.newPage({viewport:{width,height:840},colorScheme:dark?'dark':'light'});
   await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());await page.goto(origin+'/.tmp/stock-report-ui/index.html',{waitUntil:'domcontentloaded',timeout:60000});
   if(dark)await page.evaluate(()=>document.documentElement.classList.add('dark'));await page.getByRole('region',{name:'Stock report data'}).waitFor();return page;};
  const show=page=>page.getByRole('button',{name:'Show stock at selected time',exact:true}),explain=page=>page.getByRole('switch',{name:/Show inventory changes for this day/});
  const details=page=>page.getByRole('button',{name:/View movements for Fixture A product/});
  for(const width of[1440,390])for(const dark of[false,true]){
   const page=await fresh(width,dark);assert.equal(await page.evaluate(()=>window.fixture.calls.length),0);
   await page.getByLabel('Stock report date and time').fill('2026-11-06T08:00');await explain(page).check();await show(page).click();
   await page.getByRole('columnheader',{name:/^Stock available/}).waitFor();await page.getByText('9007199254740993',{exact:true}).waitFor();
   for(const label of['Opening stock','Stock in','Stock out'])assert.equal(await page.getByRole('columnheader',{name:new RegExp('^'+label)}).count(),1);
   const cells=await page.locator('tbody tr').first().locator('td').evaluateAll(nodes=>nodes.map(node=>({label:node.getAttribute('data-label'),value:node.textContent})));
   assert.deepEqual(cells.map(cell=>cell.label),['Product','SKU / barcode','Opening stock','Stock in','Stock out','Stock available','Last recorded change','Balance status']);
   assert.deepEqual(cells.slice(2,6).map(cell=>cell.value),['9007199254740991','5','3','9007199254740993']);
   const request=await page.evaluate(()=>window.fixture.calls[0]);assert.equal(request.cutoff,'2026-11-06T00:00:00.0000000Z');assert.equal(request.periodStart,'2026-11-05T16:00:00.0000000Z');
   const before=await page.evaluate(()=>window.fixture.calls.length);await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>window.fixture.calls.length),before);
   await page.getByRole('button',{name:'Next products'}).click();await page.getByText('Negative stock',{exact:true}).waitFor();const next=await page.evaluate(()=>window.fixture.calls[1]);assert.equal(next.sourceRevision,'source-a');assert.equal(next.periodStart,request.periodStart);assert.equal(next.cutoff,request.cutoff);
   await page.getByRole('button',{name:'Export Excel'}).click();await page.waitForFunction(()=>window.fixture.exports.length===1);const saved=await page.evaluate(()=>window.fixture.exports[0]);
   assert.equal(saved.book.sheets[1].sheet.length,2);assert.equal(saved.book.sheets[1].sheet[0].Quantity,'9007199254740993');assert.equal(saved.book.sheets[1].sheet[0]['Opening stock'],'9007199254740991');
   const geometry=await page.getByRole('region',{name:'Stock report data'}).evaluate(element=>{const box=element.getBoundingClientRect();return{left:box.left,right:box.right,overflow:element.scrollWidth>element.clientWidth+1};});assert(geometry.left>=0&&geometry.right<=width+1&&!geometry.overflow,JSON.stringify(geometry));
   await page.screenshot({path:path.join(directory,'stock-report-'+width+'-'+(dark?'dark':'light')+'.png'),fullPage:true});passed++;console.log('PASS selected-time period strings/paging/export/theme/layout '+width+' '+(dark?'dark':'light'));await page.close();
  }
  for(const kind of['incomplete','ungraded','error']){
   const page=await fresh();await page.evaluate(kind=>window.fixture.set({kind}),kind);await show(page).click();
   if(kind==='error')await page.getByRole('alert').getByText('Synthetic stock reader unavailable').waitFor();else await page.getByText('Historical quantities are not yet verified',{exact:true}).waitFor();
   if(kind==='error')assert.equal(await page.getByRole('table').count(),0);else{
    const balances=page.getByRole('table',{name:'Stock at selected time'});
    await balances.getByRole('row',{name:/Current branch A stock/}).getByText('Unverified',{exact:true}).waitFor();
    assert.equal(await balances.getByText('9007199254740993',{exact:true}).count(),0);
   }
   assert(await page.getByRole('button',{name:'Export Excel'}).isDisabled());passed++;console.log('PASS '+kind+' cannot display unsupported stock or export');await page.close();
  }
  for(const width of[1440,390]){
   const page=await fresh(width);await page.evaluate(()=>window.fixture.set({kind:'provisional'}));await show(page).click();
   await page.getByRole('alert').getByText('Provisional recorded stock',{exact:true}).waitFor();await page.getByText('9007199254740993',{exact:true}).waitFor();
   assert.equal(await page.getByText('Some terminals have not confirmed uploads; this recorded balance may change.',{exact:true}).count(),1);assert(await page.getByRole('button',{name:'Export Excel'}).isDisabled());
   assert.equal(await details(page).count(),0);assert.equal(await page.evaluate(()=>window.fixture.movementCalls.length),0);
   assert.equal(await page.evaluate(()=>window.fixture.exports.length),0);passed++;console.log('PASS explicit provisional recorded stock visible with warning/no export '+width);await page.close();
  }
  for(const change of[{branch:'b',name:'Fixture B'},{epoch:2},{export:false}]){
   const page=await fresh();await show(page).click();await page.getByText('Fixture A product',{exact:true}).waitFor();await page.evaluate(change=>window.fixture.set(change),change);
   await page.waitForFunction(()=>window.fixture.commits.length>1);const commits=await page.evaluate(()=>window.fixture.commits.filter(m=>m.branch==='b'||m.epoch===2||m.export===false));
   assert(commits.length);assert(commits.every(commit=>!commit.text.includes('Fixture A product')),JSON.stringify(commits));assert.equal(await page.getByRole('table',{name:'Current inventory'}).count(),1);
   passed++;console.log('PASS prior protected rows hidden in first layout before passive effects '+JSON.stringify(change));await page.close();
  }
  {
   const page=await fresh();await page.evaluate(()=>window.fixture.deferNext());await show(page).click();assert(await show(page).isDisabled());
   await page.getByLabel('Stock report date and time').fill('2026-11-05T09:00');await page.evaluate(()=>window.fixture.resolve());assert.equal(await page.getByRole('table').count(),0);
   await show(page).click();await page.getByText('9007199254740993',{exact:true}).waitFor();assert.equal((await page.evaluate(()=>window.fixture.calls[1])).cutoff,'2026-11-05T01:00:00.0000000Z');
   passed++;console.log('PASS loading/late response cannot replace a newer selected exact time');await page.close();
  }
  {
   const page=await fresh();await show(page).click();await page.getByText('9007199254740993',{exact:true}).waitFor();await page.evaluate(()=>window.fixture.deferNext());
   await page.getByRole('button',{name:'Export Excel'}).click();await page.waitForFunction(()=>window.fixture.pending.length===1);await page.evaluate(()=>{window.fixture.set({export:false});window.fixture.resolve();});
   assert.equal(await page.getByRole('button',{name:'Export Excel'}).count(),0);await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>window.fixture.exports.length),0);
   passed++;console.log('PASS export permission revoked during await produces no workbook');await page.close();
  }
  for(const displayedTime of ['2026-03-08T02:30','2026-11-01T01:30']){
   const page=await fresh();await page.evaluate(()=>window.fixture.set({zone:'America/New_York'}));await page.getByLabel('Stock report date and time').fill(displayedTime);
   await page.getByRole('combobox',{name:'Stock cutoff method'}).click();await page.getByRole('option',{name:'After a closed shift'}).click();assert.equal(await explain(page).count(),0);
   await page.getByRole('combobox',{name:'Closed shift stock cutoff'}).click();await page.getByRole('option',{name:/Fixture cashier/}).click();await show(page).click();
   await page.getByText(/Exact cutoff: 2026-11-05T13:00:00.1234567Z/).waitFor();const request=await page.evaluate(()=>window.fixture.calls[0]);assert.equal(request.closedShiftId,'30000000-0000-4000-8000-000000000001');assert.equal(request.periodStart,undefined);assert.equal(request.cutoff,'1970-01-01T00:00:00.0000000Z');
   assert.equal(await page.getByRole('combobox',{name:'Stock cutoff UTC offset'}).count(),0);assert.equal(await page.getByRole('columnheader',{name:/^Opening stock/}).count(),0);passed++;console.log('PASS saved shift bypasses displayed DST gap/repetition '+displayedTime);await page.close();
  }
  for(const width of [1440,390]){
   const page=await fresh(width);await page.getByLabel('Stock report date and time').fill('2026-11-06T08:00');await explain(page).check();await show(page).click();
   assert.equal(await page.evaluate(()=>window.fixture.movementCalls.length),0);await details(page).click();
   const region=page.getByRole('region',{name:/Stock movements/}),heading=region.getByRole('heading',{name:/Stock movements/});
   await region.getByText('+9007199254740993',{exact:true}).waitFor();assert.equal(await heading.evaluate(element=>document.activeElement===element),true);
   const first=await page.evaluate(()=>window.fixture.movementCalls[0]);
   assert.equal(first.branchId,'a');assert.equal(first.productId,'20000000-0000-4000-8000-000000000001');assert.equal(first.sourceRevision,'source-a');
   assert.equal(first.cutoff,'2026-11-06T00:00:00.0000000Z');assert.equal(first.periodStart,'2026-11-05T16:00:00.0000000Z');assert.equal(first.after,null);
   await region.getByRole('button',{name:'Next movements'}).click();await region.getByText('-3',{exact:true}).waitFor();assert(await region.getByText('Page 2',{exact:true}).isVisible());
   assert.equal(await region.getByText('+9007199254740993',{exact:true}).count(),0);
   const next=await page.evaluate(()=>window.fixture.movementCalls[1]);assert.deepEqual(next,{...first,after:{id:'40000000-0000-4000-8000-000000000001',effectiveAt:first.cutoff}});
   await region.getByRole('button',{name:'First movement page'}).click();await region.getByText('+9007199254740993',{exact:true}).waitFor();
   await region.getByRole('button',{name:'Close movements'}).click();await region.waitFor({state:'detached'});assert(await details(page).evaluate(element=>document.activeElement===element));
   passed++;console.log('PASS accessible finite product movement paging and exact quantities '+width);await page.close();
  }
  {
   const page=await fresh();await page.getByLabel('Stock report date and time').fill('2026-11-06T08:00');
   await page.getByRole('combobox',{name:'Stock cutoff method'}).click();await page.getByRole('option',{name:'After a closed shift'}).click();
   await page.getByRole('combobox',{name:'Closed shift stock cutoff'}).click();await page.getByRole('option',{name:/Fixture cashier/}).click();await show(page).click();
   await details(page).click();await page.getByRole('region',{name:/Stock movements/}).getByText('2026-11-05T13:00:00.1234567Z',{exact:true}).waitFor();
   const request=await page.evaluate(()=>window.fixture.movementCalls[0]);assert.equal(request.cutoff,'2026-11-05T13:00:00.1234567Z');assert.equal(request.closedShiftId,'30000000-0000-4000-8000-000000000001');
   passed++;console.log('PASS movement details keep the exact saved shift cutoff and authority');await page.close();
  }
  {
   const page=await fresh();await show(page).click();await details(page).waitFor();await page.evaluate(()=>window.fixture.deferNextMovement());
   await details(page).click();await page.getByRole('status').getByText('Loading stock movements…').waitFor();
   const region=page.getByRole('region',{name:/Stock movements/});await region.getByRole('button',{name:'Close movements'}).click();
   await region.waitFor({state:'detached'});await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='View movements for Fixture A product');
   await page.evaluate(()=>window.fixture.resolve());assert.equal(await region.count(),0);
   passed++;console.log('PASS cancelling an in-flight movement read returns focus and ignores its response');await page.close();
  }
  {
   const page=await fresh();await show(page).click();await details(page).waitFor();await page.evaluate(()=>window.fixture.deferNextMovement());
   await details(page).click();await page.getByRole('status').getByText('Loading stock movements…').waitFor();
   await page.evaluate(()=>{window.fixture.set({branch:'b',name:'Fixture B',epoch:2});window.fixture.resolve();});
   assert.equal(await page.getByRole('region',{name:/Stock movements/}).count(),0);
   assert((await page.evaluate(()=>window.fixture.commits.filter(commit=>commit.branch==='b'))).every(commit=>!commit.text.includes('Stock movements')));
   passed++;console.log('PASS pending movement rows stay hidden on the first changed branch/session layout');await page.close();
  }
  {
   const page=await fresh();await show(page).click();await details(page).waitFor();await page.evaluate(()=>window.fixture.set({movementKind:'incomplete'}));
   await details(page).click();const region=page.getByRole('region',{name:/Stock movements/});await region.getByRole('alert').getByText(/Movement details are unavailable/).waitFor();
   assert.equal(await region.getByRole('table').count(),0);assert.equal(await region.getByRole('button',{name:'Next movements'}).count(),0);
   passed++;console.log('PASS an incomplete movement page exposes no rows or pagination');await page.close();
  }
  {
   const page=await fresh();await page.evaluate(()=>window.fixture.set({zone:'America/New_York'}));await page.getByLabel('Stock report date and time').fill('2026-11-01T01:30');await show(page).click();
   await page.getByRole('alert').getByText(/occurs twice/).waitFor();assert.equal(await page.evaluate(()=>window.fixture.calls.length),0);await page.getByRole('combobox',{name:'Stock cutoff UTC offset'}).click();await page.getByRole('option',{name:/UTC−05:00/}).click();await show(page).click();
   await page.getByText('9007199254740993',{exact:true}).waitFor();assert.equal((await page.evaluate(()=>window.fixture.calls[0])).cutoff,'2026-11-01T06:30:00.0000000Z');passed++;console.log('PASS repeated local selected time requires exact occurrence');await page.close();
  }
  for(const width of[1440,390]){
   const page=await fresh(width);
   assert.equal(await page.getByRole('dialog').count(),0);
   const current=page.getByRole('table',{name:'Current inventory'});
   await current.getByRole('row',{name:/Current branch A stock/}).getByText('7',{exact:true}).waitFor();
   await current.getByRole('row',{name:/Zero stock item/}).getByText('0',{exact:true}).waitFor();
   assert.equal(await page.getByText('Current branch B stock',{exact:true}).count(),0);
   assert.equal(await page.evaluate(()=>window.fixture.calls.length),0);
   const date=page.getByLabel('Stock report date and time');
   const now=await page.evaluate(()=>Date.now());
   assert(Math.abs(Date.parse((await date.inputValue())+'+08:00')-now)<60000);
   await page.evaluate(()=>window.fixture.set({liveQuantity:11,kind:'incomplete'}));
   await current.getByRole('row',{name:/Current branch A stock/}).getByText('11',{exact:true}).waitFor();
   await date.fill('2026-11-06T09:15:12');await date.press('Enter');
   await page.getByText('Historical quantities are not yet verified',{exact:true}).waitFor();
   assert.equal((await page.evaluate(()=>window.fixture.calls[0])).cutoff,'2026-11-06T01:15:12.0000000Z');
   assert.equal(await current.count(),0);
   await page.getByRole('button',{name:'Return to current stock'}).click();
   await current.getByText('11',{exact:true}).waitFor();
   assert.equal(await page.evaluate(()=>window.fixture.calls.length),1);
   await page.evaluate(()=>window.fixture.set({inventoryReady:false,inventoryPhase:'loading'}));
   await page.getByText('Loading current inventory…',{exact:true}).waitFor();
   assert.equal(await current.count(),0);
   await page.evaluate(()=>window.fixture.set({inventory:false,epoch:2}));
   await page.getByRole('region',{name:'Stock report data'}).waitFor({state:'detached'});
   await page.getByText('Inventory permission is required to view this report.',{exact:true}).waitFor();
   passed++;console.log('PASS in-page current stock, cutoff, missing opening, scope and permissions '+width);await page.close();
  }
  {
   const page=await fresh();await page.evaluate(()=>window.fixture.set({kind:'incomplete',activity:true}));
   const date=page.getByLabel('Stock report date and time');
   const balances=page.getByRole('table',{name:'Stock at selected time'}), before=page.getByRole('table',{name:'Activity at or before the cutoff'}), after=page.getByRole('table',{name:'Activity after the cutoff'});
   const target=balances.getByRole('row',{name:/Recorded test item/}), zero=balances.getByRole('row',{name:/Recorded zero item/});
   await date.fill('2026-11-05T10:30');await show(page).click();
   await target.getByText('7',{exact:true}).waitFor();await target.getByText('Provisional',{exact:true}).waitFor();
   await zero.getByText('0',{exact:true}).waitFor();
   await balances.getByRole('row',{name:/Current branch A stock/}).getByText('Unverified',{exact:true}).waitFor();
   await before.getByText('RECEIVE-1',{exact:true}).waitFor();await after.getByText('SALE-1',{exact:true}).waitFor();
   assert.equal(await after.locator('time').getAttribute('datetime'),'2026-11-05T03:00:00.1234567Z');
   await target.getByRole('button',{name:'Filter activity for Recorded test item'}).click();
   await before.getByText('RECEIVE-1',{exact:true}).waitFor();assert.equal(await before.getByText('ADJUST-1',{exact:true}).count(),0);
   assert((await page.evaluate(()=>window.fixture.activityCalls.slice(-2))).every(request=>request.productId==='20000000-0000-4000-8000-000000000001'));
   await page.getByRole('button',{name:'All products'}).click();await before.getByText('ADJUST-1',{exact:true}).waitFor();
   await date.fill('2026-11-05T11:15');await show(page).click();
   await target.getByText('6',{exact:true}).waitFor();await before.getByText('SALE-1',{exact:true}).waitFor();
   assert.equal(await after.count(),0);assert(await page.getByRole('button',{name:'Export Excel'}).isDisabled());
   await page.getByRole('switch',{name:'Zero stock only'}).check();await zero.getByText('0',{exact:true}).waitFor();assert.equal(await target.count(),0);
   const width=await page.getByRole('region',{name:'Stock report data'}).evaluate(element=>element.scrollWidth-element.clientWidth);assert(width<=1);
   passed++;console.log('PASS recorded activity carries the last balance through the inclusive cutoff and keeps later sales separate');await page.close();
  }
  {
   const page=await fresh();await page.evaluate(()=>window.fixture.set({kind:'schema',activity:true,pagedActivity:true}));
   await page.getByLabel('Stock report date and time').fill('2026-11-05T10:30');await explain(page).check();await show(page).click();
   await page.getByText(/needs the reviewed stock-history upgrade/).waitFor();
   const target=page.getByRole('table',{name:'Stock at selected time'}).getByRole('row',{name:/Recorded test item/});
   await target.getByText('Unverified',{exact:true}).waitFor();
   await target.getByRole('button',{name:'Filter activity for Recorded test item'}).click();
   const earlier=page.getByRole('region',{name:'Activity at or before the cutoff'});
   await earlier.getByRole('button',{name:'Earlier activity'}).click();await target.getByText('7',{exact:true}).waitFor();
   await earlier.getByRole('button',{name:'First activity page'}).click();await target.getByText('7',{exact:true}).waitFor();
   await page.getByRole('combobox',{name:'Stock cutoff method'}).click();await page.getByRole('option',{name:'After a closed shift'}).click();
   await page.getByRole('combobox',{name:'Closed shift stock cutoff'}).click();await page.getByRole('option',{name:/Fixture cashier/}).click();
   const requests=await page.evaluate(()=>window.fixture.activityCalls.length);await show(page).click();
   await page.getByText('The saved closing time could not be resolved.',{exact:true}).waitFor();
   assert.equal(await page.getByRole('region',{name:'Inventory activity'}).count(),0);
   assert.equal(await page.evaluate(()=>window.fixture.activityCalls.length),requests);
   passed++;console.log('PASS activity paging reaches an older anchor without a ledger schema and withholds unresolved shift cutoffs');await page.close();
  }
  {
   const page=await fresh();await page.evaluate(()=>{window.fixture.set({kind:'incomplete',activity:true});window.fixture.deferNextActivity();});
   await page.getByLabel('Stock report date and time').fill('2026-11-05T10:30');await show(page).click();
   await page.waitForFunction(()=>window.fixture.pending.length===1);
   await page.evaluate(()=>{window.fixture.set({branch:'b',name:'Fixture B',epoch:2});window.fixture.resolve();});
   await page.getByRole('table',{name:'Current inventory'}).getByText('Current branch B stock',{exact:true}).waitFor();
   assert.equal(await page.getByRole('region',{name:'Inventory activity'}).count(),0);
   assert((await page.evaluate(()=>window.fixture.commits.filter(commit=>commit.branch==='b'))).every(commit=>!commit.text.includes('Recorded test item')));
   passed++;console.log('PASS late inventory activity cannot cross the report location and account fence');await page.close();
  }
  {
   const page=await fresh();
   const zero=page.getByRole('switch',{name:'Zero stock only'});
   const current=page.getByRole('table',{name:'Current inventory'});
   await current.getByText('Current branch A stock',{exact:true}).waitFor();
   await zero.check();
   await current.getByText('Zero stock item',{exact:true}).waitFor();
   assert.equal(await current.getByText('Current branch A stock',{exact:true}).count(),0);
   assert.equal(await page.evaluate(()=>window.fixture.calls.length),0);
   await zero.uncheck();

   await page.evaluate(()=>window.fixture.set({kind:'zero-pages'}));
   await page.getByRole('combobox',{name:'Stock cutoff method'}).click();
   await page.getByRole('option',{name:'End of selected date'}).click();
   const date=page.getByLabel('Stock report date',{exact:true});
   await date.fill('2026-11-06');await show(page).click();
   await page.getByText('Historical earlier balance',{exact:true}).waitFor();
   assert.equal((await page.evaluate(()=>window.fixture.calls[0])).cutoff,'2026-11-06T15:59:59.9999999Z');

   await zero.check();
   await page.getByText('Historical zero stock',{exact:true}).waitFor();
   assert.equal(await page.getByText('Historical earlier balance',{exact:true}).count(),0);
   const scanned=await page.evaluate(()=>window.fixture.calls.slice(1));
   assert.equal(scanned.length,2);
   assert.equal(scanned[0].after,null);
   assert.equal(scanned[1].after,'20000000-0000-4000-8000-000000000001');
   assert(scanned.every(r=>r.cutoff===scanned[0].cutoff&&r.sourceRevision==='source-a'));
   assert(await page.getByRole('button',{name:'Export full report'}).isEnabled());

   await zero.uncheck();
   await page.getByText('Historical earlier balance',{exact:true}).waitFor();
   const requests=await page.evaluate(()=>window.fixture.calls.length);
   const today=await page.evaluate(()=>new Date(Date.now()+8*3600000).toISOString().slice(0,10));
   await date.fill(today);await show(page).click();
   await current.getByText('Current branch A stock',{exact:true}).waitFor();
   assert.equal(await page.evaluate(()=>window.fixture.calls.length),requests);
   passed++;console.log('PASS business-day balance and a zero-stock filter across verified historical pages');await page.close();
  }
  console.log('PASS '+passed+' actual mounted Stock report groups');
 }finally{await browser?.close();await server?.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
