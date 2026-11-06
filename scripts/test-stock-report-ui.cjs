'use strict';
// Actual React/Radix presentation + real export helper. Only synthetic report
// transport/context; no profile, credential, database or external network.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url'),{chromium}=require('@playwright/test');
async function main(){
 const root=process.cwd(),directory=path.join(root,'.tmp','stock-report-ui');fs.mkdirSync(directory,{recursive:true});
 fs.writeFileSync(path.join(directory,'index.html'),'<div id="root"></div><script type="module" src="/.tmp/stock-report-ui/main.tsx"></script>');
 fs.writeFileSync(path.join(directory,'fixture.ts'),`import{useSyncExternalStore}from'react';
export let model={branch:'a',name:'Fixture A',open:true,mount:true,inventory:true,export:true,shifts:true,zone:'Asia/Brunei',epoch:1,kind:'complete'};
const listeners=new Set();export const calls=[],exports=[],pending=[],commits=[];let defer=false;
export const set=next=>{model={...model,...next};listeners.forEach(fn=>fn());};export const watch=()=>useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn);},()=>model);
export const useAuth=()=>{const m=watch();return{isAdmin:false,user:{staffId:'fixture-'+m.epoch},can:key=>key==='can_view_inventory'?m.inventory:key==='can_export_reports'?m.export:key==='can_shift_closing_history_view'?m.shifts:false};};
export const usePos=()=>{const m=watch();return{state:{shifts:[]},currentStore:{id:m.branch,name:m.name}};};
export const effectiveTimeZone=()=>watch().zone,sessionEpoch=()=>model.epoch,isCurrentEpoch=epoch=>epoch===model.epoch;
export const useAuthOptional=()=>null,usePosOptional=()=>null,usePersonalAppearance=()=>({profile:{tableViews:{}},editable:false,update:()=>{}});
export const useReportShifts=(_seed,branch,_from,_to,enabled)=>({shifts:enabled?[{id:'30000000-0000-4000-8000-000000000001',storeId:branch,status:'CLOSED',closedAt:'2026-11-05T13:00:00.1234567Z',cashier:'Fixture cashier'}]:[],loading:false,error:''});
const first='20000000-0000-4000-8000-000000000001',second='20000000-0000-4000-8000-000000000002';
function response(r){const cutoff=r.closedShiftId?'2026-11-05T13:00:00.1234567Z':r.cutoff;
 const base={status:model.kind,reasons:[],cutoff,timeZone:r.timeZone,branchId:r.branchId,baselineAt:'2026-11-01T00:00:00.0000000Z',readAt:'2099-01-01T00:00:00.0000000Z',sourceRevision:'source-'+r.branchId,pendingCount:'0',restatable:true,next:null};
 if(r.periodStart)base.period={start:r.periodStart,endExclusive:'2026-11-06T16:00:00.0000000Z',through:cutoff,fullDay:false};
 const row=(id,negative)=>({productId:id,locationId:r.branchId,name:r.branchId==='a'?'Fixture A product':'Fixture B product',sku:'00001',barcode:'0000001',quantity:negative?'-2':'9007199254740993',negative,
  ...(r.periodStart?{openingQuantity:negative?'1':'9007199254740991',inQuantity:negative?'0':'5',outQuantity:'3'}:{})});
 if(model.kind==='incomplete')return{...base,reasons:['NO_VERIFIED_OPENING'],rows:[]};
 const record={...base,rows:r.after?[row(second,true)]:[row(first,false)],next:r.after?null:first};
 if(model.kind==='provisional')return{...record,status:'incomplete',reasons:['WRITER_COVERAGE_PENDING'],coverage:{acceptedLedger:'complete',writers:'pending',balanceGrade:'recorded_provisional',timeGrade:'author_entered'}};
 if(model.kind==='ungraded')return{...record,status:'incomplete',reasons:['NO_VERIFIED_OPENING']};
 return record;
}
export const loadStockHistoryPage=async r=>{calls.push(r);if(model.kind==='error')throw new Error('Synthetic stock reader unavailable');const page=response(r);if(defer){defer=false;return new Promise(resolve=>pending.push(()=>resolve(page)));}return page;};
export const deferNext=()=>defer=true,resolve=()=>pending.shift()?.();
export const xlsx={utils:{book_new:()=>({sheets:[]}),aoa_to_sheet:rows=>rows,json_to_sheet:rows=>rows,book_append_sheet:(book,sheet,name)=>book.sheets.push({name,sheet})},writeFile:(book,name)=>exports.push({book,name})};
`);
 fs.writeFileSync(path.join(directory,'xlsx.ts'),`export{utils,writeFile};import{xlsx}from'./fixture';const{utils,writeFile}=xlsx;`);
 fs.writeFileSync(path.join(directory,'shell.tsx'),`export const AppShell=({children})=><main>{children}</main>;`);
 fs.writeFileSync(path.join(directory,'main.tsx'),`import React,{useLayoutEffect}from'react';import{createRoot}from'react-dom/client';import{StockHistoryDialog}from'@/platforms/web/components/pos/StockHistoryDialog';import{StockAtTimeReport}from'@/routes/reports.inventory';import*as f from'./fixture';import'@/styles.css';
window.fixture=f;function App(){const m=f.watch();useLayoutEffect(()=>{f.commits.push({branch:m.branch,epoch:m.epoch,inventory:m.inventory,export:m.export,text:document.getElementById('root')?.textContent+' '+document.querySelector('[role=dialog]')?.textContent});},[m]);return !m.mount?null:location.search==='?report'?<StockAtTimeReport/>:<StockHistoryDialog open={m.open} onOpenChange={open=>f.set({open})} branchId={m.branch} branchName={m.name}/>;}createRoot(document.getElementById('root')).render(<App/>);`);
 const{createServer}=await import('vite'),react=(await import('@vitejs/plugin-react')).default,tailwind=(await import('@tailwindcss/vite')).default;
 const{popupRuntimeAliases}=await import(pathToFileURL(path.join(root,'scripts/popup-runtime-aliases.mjs')).href);
 let server,browser,passed=0;
 try{
  const fixture=path.join(directory,'fixture.ts');server=await createServer({configFile:false,root,cacheDir:path.join(directory,'.vite'),plugins:[react(),tailwind()],resolve:{alias:[
   ...['pos-auth','pos-store','time-zone','use-report-shifts','session-epoch','stock-history-client','personal-appearance'].map(name=>({find:new RegExp('^@/lib/'+name+'$'),replacement:fixture})),
   {find:/^@\/platforms\/web\/components\/pos\/AppShell$/,replacement:path.join(directory,'shell.tsx')},{find:/^xlsx$/,replacement:path.join(directory,'xlsx.ts')},...popupRuntimeAliases(),{find:'@',replacement:path.join(root,'src')},
  ]},server:{host:'127.0.0.1',port:0,fs:{allow:[root,fs.realpathSync(path.join(root,'node_modules'))]}},logLevel:'error'});
  await server.listen();const origin='http://127.0.0.1:'+server.httpServer.address().port;browser=await chromium.launch({channel:'chrome',headless:true,args:['--disable-gpu']});
  const fresh=async(width=390,dark=false,report=false)=>{const page=await browser.newPage({viewport:{width,height:840},colorScheme:dark?'dark':'light'});
   await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());await page.goto(origin+'/.tmp/stock-report-ui/index.html'+(report?'?report':''));
   if(dark)await page.evaluate(()=>document.documentElement.classList.add('dark'));await page.getByRole(report?'heading':'dialog',{name:report?'Stock report':/Stock report/}).waitFor();return page;};
  const show=page=>page.getByRole('button',{name:'Show stock',exact:true}),explain=page=>page.getByRole('checkbox',{name:/Show inventory changes for this day/});
  for(const width of[1440,390])for(const dark of[false,true]){
   const page=await fresh(width,dark);assert.equal(await page.evaluate(()=>window.fixture.calls.length),0);
   await page.getByLabel('Stock report date and time').fill('2026-11-06T08:00');await explain(page).check();await show(page).click();
   await page.getByRole('columnheader',{name:/^Stock available/}).waitFor();await page.getByText('9007199254740993',{exact:true}).waitFor();
   for(const label of['Opening stock','Stock in','Stock out'])assert.equal(await page.getByRole('columnheader',{name:new RegExp('^'+label)}).count(),1);
   const cells=await page.locator('tbody tr').first().locator('td').evaluateAll(nodes=>nodes.map(node=>({label:node.getAttribute('data-label'),value:node.textContent})));
   assert.deepEqual(cells.map(cell=>cell.label),['Product','SKU / barcode','Opening stock','Stock in','Stock out','Stock available']);
   assert.deepEqual(cells.slice(2).map(cell=>cell.value),['9007199254740991','5','3','9007199254740993']);
   const request=await page.evaluate(()=>window.fixture.calls[0]);assert.equal(request.cutoff,'2026-11-06T00:00:00.0000000Z');assert.equal(request.periodStart,'2026-11-05T16:00:00.0000000Z');
   const before=await page.evaluate(()=>window.fixture.calls.length);await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>window.fixture.calls.length),before);
   await page.getByRole('button',{name:'Next products'}).click();await page.getByText('Negative stock',{exact:true}).waitFor();const next=await page.evaluate(()=>window.fixture.calls[1]);assert.equal(next.sourceRevision,'source-a');assert.equal(next.periodStart,request.periodStart);assert.equal(next.cutoff,request.cutoff);
   await page.getByRole('button',{name:'Export Excel'}).click();await page.waitForFunction(()=>window.fixture.exports.length===1);const saved=await page.evaluate(()=>window.fixture.exports[0]);
   assert.equal(saved.book.sheets[1].sheet.length,2);assert.equal(saved.book.sheets[1].sheet[0].Quantity,'9007199254740993');assert.equal(saved.book.sheets[1].sheet[0]['Opening stock'],'9007199254740991');
   const geometry=await page.getByRole('dialog').evaluate(element=>{const box=element.getBoundingClientRect();return{left:box.left,right:box.right,overflow:element.scrollWidth>element.clientWidth+1};});assert(geometry.left>=0&&geometry.right<=width+1&&!geometry.overflow,JSON.stringify(geometry));
   await page.screenshot({path:path.join(directory,'stock-report-'+width+'-'+(dark?'dark':'light')+'.png'),fullPage:true});passed++;console.log('PASS selected-time period strings/paging/export/theme/layout '+width+' '+(dark?'dark':'light'));await page.close();
  }
  for(const kind of['incomplete','ungraded','error']){
   const page=await fresh();await page.evaluate(kind=>window.fixture.set({kind}),kind);await show(page).click();
   if(kind==='error')await page.getByRole('alert').getByText('Synthetic stock reader unavailable').waitFor();else await page.getByText('Historical quantities are not yet verified',{exact:true}).waitFor();
   assert.equal(await page.getByRole('table').count(),0);assert(await page.getByRole('button',{name:'Export Excel'}).isDisabled());passed++;console.log('PASS '+kind+' cannot display estimated stock or export');await page.close();
  }
  for(const width of[1440,390]){
   const page=await fresh(width);await page.evaluate(()=>window.fixture.set({kind:'provisional'}));await show(page).click();
   await page.getByRole('alert').getByText('Provisional recorded stock',{exact:true}).waitFor();await page.getByText('9007199254740993',{exact:true}).waitFor();
   assert.equal(await page.getByText('Some terminals have not confirmed uploads; this recorded balance may change.',{exact:true}).count(),1);assert(await page.getByRole('button',{name:'Export Excel'}).isDisabled());
   assert.equal(await page.evaluate(()=>window.fixture.exports.length),0);passed++;console.log('PASS explicit provisional recorded stock visible with warning/no export '+width);await page.close();
  }
  for(const change of[{branch:'b',name:'Fixture B'},{epoch:2},{export:false}]){
   const page=await fresh();await show(page).click();await page.getByText('Fixture A product',{exact:true}).waitFor();await page.evaluate(change=>window.fixture.set(change),change);
   await page.waitForFunction(()=>window.fixture.commits.length>1);const commits=await page.evaluate(()=>window.fixture.commits.filter(m=>m.branch==='b'||m.epoch===2||m.export===false));
   assert(commits.length);assert(commits.every(commit=>!commit.text.includes('Fixture A product')),JSON.stringify(commits));assert.equal(await page.getByRole('table').count(),0);
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
  {
   const page=await fresh();await page.evaluate(()=>window.fixture.set({zone:'America/New_York'}));await page.getByLabel('Stock report date and time').fill('2026-11-01T01:30');await show(page).click();
   await page.getByRole('alert').getByText(/occurs twice/).waitFor();assert.equal(await page.evaluate(()=>window.fixture.calls.length),0);await page.getByRole('combobox',{name:'Stock cutoff UTC offset'}).click();await page.getByRole('option',{name:/UTC−05:00/}).click();await show(page).click();
   await page.getByText('9007199254740993',{exact:true}).waitFor();assert.equal((await page.evaluate(()=>window.fixture.calls[0])).cutoff,'2026-11-01T06:30:00.0000000Z');passed++;console.log('PASS repeated local selected time requires exact occurrence');await page.close();
  }
  for(const width of[1440,390]){
   const page=await fresh(width,false,true);assert.equal(await page.evaluate(()=>window.fixture.calls.length),0);await page.getByRole('button',{name:'Select date and time'}).click();await show(page).click();await page.getByText('9007199254740993',{exact:true}).waitFor();
   await page.evaluate(()=>window.fixture.set({inventory:false,epoch:2}));await page.getByRole('dialog').waitFor({state:'detached'});await page.getByText('Inventory permission is required to view this report.',{exact:true}).waitFor();
   passed++;console.log('PASS separate Stock report entry/current permission '+width);await page.close();
  }
  console.log('PASS '+passed+' actual mounted Stock report groups');
 }finally{await browser?.close();await server?.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
