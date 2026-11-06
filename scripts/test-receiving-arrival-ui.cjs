'use strict';
// Actual mounted React fields + the actual route finalize function, with only
// synthetic capability/receiving adapters. No POS profile or business database.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const ts = require('typescript'), { chromium } = require('@playwright/test');
async function main() {
  const root = process.cwd(), directory = path.join(root, '.tmp', 'receiving-arrival-ui');
  fs.mkdirSync(directory, { recursive: true });
  const source = fs.readFileSync(path.join(root, 'src/routes/purchasing.tsx'), 'utf8');
  const parsed = ts.createSourceFile('purchasing.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let finalize = '', subscribeArrivalContext = '';
  const visit = node => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'finalize') finalize = node.getText(parsed);
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'subscribeArrivalContext') subscribeArrivalContext = node.getText(parsed);
    ts.forEachChild(node, visit);
  };
  visit(parsed); assert(finalize, 'Actual route finalize function must exist.');
  const bindings = ['invoiceNo','supplier','lines','saving','finalizingRef','arrivalFields','setSaving','setFinalizeStage','yieldToUi',
    'draftSavePromiseRef','openDraftId','finalizeAttempt','invoiceNumberTaken','receivingBranchId','hub','reference','nextStockRef','state',
    'currentStore','buildInvoice','can','db','draftLineRemovals','stockAt','logger','recordActivity','invoiceDate','totals','toast','money',
    'putAwayTargets','setPending','defaultPutAwayId','showAsPosted','clearForm','setEntryOpen','reconcileAfterPost','scanRef','notifyError'];
  fs.writeFileSync(path.join(directory, 'finalize.ts'), `export async function run(scope){const{${bindings.join(',')}}=scope;${finalize};return finalize();}`);
  assert(subscribeArrivalContext, 'Actual database-state adapter must exist.');
  fs.writeFileSync(path.join(directory, 'adapter.ts'), `import{subscribeTerminalConfig,subscribeCloudKeys,subscribeDatabaseMode,databaseSubscribe,syncSubscribe}from'./fixture';
const localDb=()=>({database:{subscribe:databaseSubscribe},sync:{subscribe:syncSubscribe}});
${subscribeArrivalContext};export{subscribeArrivalContext};`);
  fs.writeFileSync(path.join(directory, 'index.html'), '<div id="root"></div><script type="module" src="/.tmp/receiving-arrival-ui/main.tsx"></script>');
  fs.writeFileSync(path.join(directory, 'fixture.ts'), `import{useSyncExternalStore}from'react';
export let model={scope:'branch-a',epoch:1,zone:'Asia/Brunei',entry:1,available:true,ok:true,fail:false,resumed:false,saving:false};
const listeners=new Set(),terminal=new Set(),cloud=new Set(),mode=new Set(),database=new Set(),sync=new Set();export const calls=[],errors=[],capCalls=[],pending=[],yieldPending=[];let defer=false,deferYield=false;
export const set=next=>{model={...model,...next};listeners.forEach(fn=>fn());};
export const watch=()=>useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn);},()=>model);
export const scope=()=>JSON.stringify([model.scope,model.epoch,model.zone]);
const sub=(set,fn)=>{set.add(fn);return()=>set.delete(fn);};
export const subscribeTerminalConfig=fn=>sub(terminal,fn),subscribeCloudKeys=fn=>sub(cloud,fn),subscribeDatabaseMode=fn=>sub(mode,fn);
export const databaseSubscribe=fn=>sub(database,fn),syncSubscribe=fn=>sub(sync,fn);
export const emitDatabase=value=>database.forEach(fn=>fn(value)),emitSync=value=>sync.forEach(fn=>fn(value));
export const changed=kind=>kind==='readiness'?emitDatabase({enabled:true,connected:false,tradingReady:false,state:'enabled_connecting'}):terminal.forEach(fn=>fn());
export const deferNext=()=>defer=true;export const resolve=()=>pending.shift()?.();
export const deferNextYield=()=>deferYield=true;export const resolveYield=()=>yieldPending.shift()?.();
export const yieldToUi=async()=>{if(deferYield){deferYield=false;await new Promise(resolve=>yieldPending.push(resolve));}};
export const readCapability=async()=>{capCalls.push([]);const result={ok:model.ok,available:model.available,reason:'CAPTURE_NOT_ENABLED'};if(defer){defer=false;return new Promise(resolve=>pending.push(()=>resolve(result)));}return result;};
export const committed=async(kind,args)=>{calls.push({kind,args:structuredClone(args)});if(model.fail)throw new Error('Synthetic save failure');};
`);
  fs.writeFileSync(path.join(directory, 'main.tsx'), `import React,{useRef}from'react';import{createRoot}from'react-dom/client';
import{ReceivingArrivalFields}from'@/platforms/web/components/pos/ReceivingArrivalFields';import{run}from'./finalize';import{subscribeArrivalContext}from'./adapter';import*as f from'./fixture';import'@/styles.css';
window.fixture=f;function App(){const m=f.watch(),arrival=useRef(null),attempt=useRef('same-retry-id'),finalizing=useRef(false);
const finalize=()=>run({invoiceNo:'INV-1',supplier:'Supplier',lines:[{productId:'p',qty:1,cost:2,name:'Item'}],saving:m.saving,
finalizingRef:finalizing,arrivalFields:arrival,setSaving:saving=>f.set({saving}),setFinalizeStage:()=>{},yieldToUi:f.yieldToUi,
draftSavePromiseRef:{current:null},openDraftId:m.resumed?'saved-draft-id':null,finalizeAttempt:attempt,invoiceNumberTaken:async()=>false,
receivingBranchId:m.scope,hub:{id:m.scope,name:'Fixture'},reference:'GRN',nextStockRef:async()=> 'GRN',state:{settings:{integrations:{}},products:[]},
currentStore:{id:m.scope,code:'FIX'},buildInvoice:(_status,id)=>({id,invoiceDate:'2026-11-02',entryDate:'2026-11-06T03:00:00Z',supplier:'Supplier',operator:'Receiver',lines:[]}),
can:()=>false,db:{commitReceivingInvoice:(...args)=>f.committed('new',args),updateReceivingInvoice:(...args)=>f.committed('resumed',args)},draftLineRemovals:[],
stockAt:()=>0,logger:{log:()=>{}},recordActivity:()=>{},invoiceDate:'2026-11-02',totals:{units:1,cost:2},toast:{error:message=>f.errors.push(message),success:()=>{}},money:String,
putAwayTargets:[],setPending:()=>{},defaultPutAwayId:'',showAsPosted:()=>{},clearForm:()=>f.set({entry:f.model.entry+1}),setEntryOpen:()=>{},
reconcileAfterPost:async()=>{},scanRef:{current:null},notifyError:error=>f.errors.push(error.message)});
return <main className="mx-auto max-w-3xl space-y-4 p-4"><h1>Receiving fixture</h1><ReceivingArrivalFields key={m.entry} ref={arrival} scopeKey={f.scope()} currentScopeKey={f.scope}
timeZone={m.zone} readCapability={f.readCapability} subscribeContext={subscribeArrivalContext} disabled={m.saving}/><button className="h-11 rounded border px-3" onClick={()=>void finalize()}>Finalize fixture</button></main>;}createRoot(document.getElementById('root')).render(<App/>);`);
  const { createServer } = await import('vite'), react = (await import('@vitejs/plugin-react')).default, tailwind = (await import('@tailwindcss/vite')).default;
  let server, browser, passed = 0;
  try {
    server = await createServer({ configFile: false, root, cacheDir: path.join(directory, '.vite'), plugins: [react(), tailwind()],
      resolve: { alias: [{ find: '@', replacement: path.join(root, 'src') }] },
      server: { host: '127.0.0.1', port: 0, fs: { allow: [root, fs.realpathSync(path.join(root, 'node_modules'))] } }, logLevel: 'error' });
    await server.listen(); const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
    browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-gpu'] });
    const fresh = async (width = 390, dark = false) => {
      const page = await browser.newPage({ viewport: { width, height: 840 }, colorScheme: dark ? 'dark' : 'light' });
      await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
      await page.goto(`${origin}/.tmp/receiving-arrival-ui/index.html`);
      if (dark) await page.evaluate(() => document.documentElement.classList.add('dark'));
      await page.getByRole('checkbox', { name: 'Use the actual goods arrival time' }).waitFor(); return page;
    };
    const check = page => page.getByRole('checkbox', { name: 'Use the actual goods arrival time' });
    const selectCustom = async page => { await check(page).check(); await page.getByLabel(/Actual arrival date and time/).fill('2026-11-06T09:02:03'); await page.getByLabel('Arrival-time reason').fill('Goods arrived before entry'); };
    const finalizeButton = page => page.getByRole('button', { name: 'Finalize fixture', exact: true });
    for (const width of [1440, 390]) for (const dark of [false, true]) {
      const page = await fresh(width, dark); await selectCustom(page);
      const geometry = await page.locator('main').evaluate(element => ({ overflow: element.scrollWidth > element.clientWidth + 1 }));
      assert.equal(geometry.overflow, false); await page.screenshot({ path: path.join(directory, `arrival-${width}-${dark ? 'dark' : 'light'}.png`), fullPage: true });
      const count = await page.evaluate(() => window.fixture.capCalls.length); await page.waitForTimeout(150);
      assert.equal(await page.evaluate(() => window.fixture.capCalls.length), count);
      passed++; console.log(`PASS mounted labels/layout/theme/no polling ${width}px ${dark ? 'dark' : 'light'}`); await page.close();
    }
    for (const resumed of [false, true]) {
      const page = await fresh(); await page.evaluate(value => window.fixture.set({ resumed: value, available: false }), resumed);
      await page.evaluate(() => window.fixture.changed('scope'));
      await page.getByRole('status').getByText(/currently unavailable/).waitFor(); assert(await check(page).isDisabled());
      const before = await page.evaluate(() => window.fixture.capCalls.length); await finalizeButton(page).click();
      await page.waitForFunction(() => window.fixture.calls.length === 1);
      const call = await page.evaluate(() => window.fixture.calls[0]); assert.equal(call.args.length, resumed ? 5 : 3);
      assert.equal(call.args[0].invoiceDate, '2026-11-02'); assert.equal(call.args[0].entryDate, '2026-11-06T03:00:00Z');
      assert.equal(await page.evaluate(() => window.fixture.capCalls.length), before + 1); // only successful entry reset reads again
      passed++; console.log(`PASS default unavailable capability does not block/alter ${resumed ? 'resumed' : 'new'} receiving`); await page.close();
    }
    for (const resumed of [false, true]) {
      const page = await fresh(); await page.evaluate(value => window.fixture.set({ resumed: value }), resumed);
      await check(page).check(); await finalizeButton(page).click();
      await page.getByRole('alert').waitFor(); assert.equal(await page.evaluate(() => window.fixture.calls.length), 0);
      await page.getByLabel(/Actual arrival date and time/).fill('2026-11-06T09:02:03'); await finalizeButton(page).click();
      await page.getByRole('alert').getByText(/reason/).waitFor(); assert.equal(await page.evaluate(() => window.fixture.calls.length), 0);
      await page.getByLabel('Arrival-time reason').fill('Goods arrived before entry');
      await page.evaluate(() => window.fixture.set({ fail: true })); await finalizeButton(page).click();
      await page.waitForFunction(() => window.fixture.calls.length === 1 && !window.fixture.model.saving);
      assert.equal(await page.getByLabel('Arrival-time reason').inputValue(), 'Goods arrived before entry'); assert(await check(page).isChecked());
      await page.evaluate(() => window.fixture.set({ fail: false })); await finalizeButton(page).click();
      await page.waitForFunction(() => window.fixture.calls.length === 2);
      const calls = await page.evaluate(() => window.fixture.calls); assert.equal(calls[0].args.length, resumed ? 6 : 4);
      assert.deepEqual(calls[0].args.at(-1), { effectiveAt: '2026-11-06T01:02:03.0000000Z', reason: 'Goods arrived before entry' });
      assert.deepEqual(calls[0].args, calls[1].args);
      passed++; console.log(`PASS required fields/custom metadata/failed-save preservation/exact retry ${resumed ? 'resumed' : 'new'}`); await page.close();
    }
    {
      const page = await fresh(); await page.getByRole('status').getByText(/Arrival time uses/).waitFor();
      const before = await page.evaluate(() => window.fixture.capCalls.length);
      await page.evaluate(() => window.fixture.deferNextYield()); await finalizeButton(page).click();
      await page.waitForFunction(() => window.fixture.yieldPending.length === 1);
      await page.evaluate(() => { window.fixture.emitDatabase({state:'enabled_connecting',enabled:true,connected:false,tradingReady:false}); window.fixture.resolveYield(); });
      await page.waitForFunction(() => window.fixture.calls.length === 1);
      assert.equal((await page.evaluate(() => window.fixture.calls[0])).args.length, 3);
      assert.equal(await page.evaluate(() => window.fixture.capCalls.length), before + 1); // only the next entry's initial read
      passed++; console.log('PASS default receiving has no optional-capability dependency during database readiness change'); await page.close();
    }
    {
      const page = await fresh(); await selectCustom(page);
      const before = await page.evaluate(() => window.fixture.capCalls.length);
      await page.evaluate(() => { window.fixture.emitSync({phase:'pulling',pending:42}); window.fixture.emitDatabase({enabled:true,connected:true,tradingReady:true,state:'enabled_ready'}); });
      assert.equal(await page.getByLabel('Arrival-time reason').inputValue(), 'Goods arrived before entry');
      await page.waitForTimeout(100); assert.equal(await page.evaluate(() => window.fixture.capCalls.length), before);
      await page.evaluate(() => window.fixture.deferNext()); await finalizeButton(page).click(); await page.waitForFunction(() => window.fixture.pending.length === 1);
      await page.evaluate(() => { window.fixture.emitDatabase({enabled:true,connected:true,tradingReady:false,state:'enabled_validating',get profile(){throw new Error('Do not inspect profile');}}); window.fixture.resolve(); });
      await page.waitForFunction(() => !window.fixture.model.saving);
      assert.equal(await page.evaluate(() => window.fixture.calls.length), 0);
      assert.equal(await page.getByLabel('Arrival-time reason').inputValue(), 'Goods arrived before entry'); assert(await check(page).isChecked());
      passed++; console.log('PASS real database-state validation interrupts stale capability; sync progress is unrelated'); await page.close();
    }
    {
      const page = await fresh(); await selectCustom(page);
      await page.evaluate(() => { window.fixture.set({ available: false }); window.fixture.changed('readiness'); });
      assert.equal(await page.getByLabel('Arrival-time reason').inputValue(), 'Goods arrived before entry');
      await finalizeButton(page).click(); await page.getByRole('alert').getByText(/not ready/).waitFor(); assert.equal(await page.evaluate(() => window.fixture.calls.length), 0);
      await check(page).uncheck(); await finalizeButton(page).click(); await page.waitForFunction(() => window.fixture.calls.length === 1);
      assert.equal((await page.evaluate(() => window.fixture.calls[0])).args.length, 3);
      passed++; console.log('PASS readiness loss holds custom selection; only explicit save-time choice omits it'); await page.close();
    }
    {
      const page = await fresh(); await selectCustom(page); await page.evaluate(() => { window.fixture.deferNext(); window.fixture.set({ available: true }); });
      await finalizeButton(page).click(); await page.waitForFunction(() => window.fixture.pending.length === 1);
      await page.evaluate(() => { window.fixture.set({ scope: 'branch-b', epoch: 2, available: false }); window.fixture.resolve(); });
      await page.waitForFunction(() => !window.fixture.model.saving); assert.equal(await page.evaluate(() => window.fixture.calls.length), 0);
      assert.equal(await page.getByLabel('Arrival-time reason').inputValue(), ''); assert(await check(page).isChecked());
      passed++; console.log('PASS stale readiness/session/branch response cannot save or retain old-scope arrival'); await page.close();
    }
    {
      const page = await fresh(); await selectCustom(page); await page.evaluate(() => window.fixture.set({ entry: 2, resumed: true }));
      await page.waitForFunction(() => !document.querySelector('input[type=checkbox]').checked);
      assert.equal(await page.getByLabel('Arrival-time reason').count(), 0);
      passed++; console.log('PASS switching invoice drops prior arrival choice without autosave-ID coupling'); await page.close();
    }
    {
      const page = await fresh(); await page.evaluate(() => window.fixture.set({ zone: 'America/New_York' }));
      await check(page).check(); await page.getByLabel(/Actual arrival date and time/).fill('2026-11-01T01:30'); await page.getByLabel('Arrival-time reason').fill('Repeated hour arrival');
      await finalizeButton(page).click(); await page.getByRole('alert').getByText(/occurs twice/).waitFor(); assert.equal(await page.evaluate(() => window.fixture.calls.length), 0);
      await page.getByLabel('Arrival UTC offset').selectOption('2026-11-01T06:30:00.0000000Z'); await finalizeButton(page).click();
      await page.waitForFunction(() => window.fixture.calls.length === 1);
      assert.equal((await page.evaluate(() => window.fixture.calls[0])).args.at(-1).effectiveAt, '2026-11-01T06:30:00.0000000Z');
      passed++; console.log('PASS repeated local arrival requires an explicit occurrence'); await page.close();
    }
    console.log(`PASS ${passed} actual mounted receiving-arrival groups`);
  } finally { await browser?.close(); await server?.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
