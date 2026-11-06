// Reuse the existing isolated mounted-shell fixture; alter only its synthetic
// bridge/test cases. Actual NativeBoot, AppShell and activity observer remain.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const root=process.cwd();let source=fs.readFileSync(path.join(root,'scripts/test-branch-switch-shell-ui.cjs'),'utf8');
const replace=(from,to)=>{if(source.split(from).length!==2)throw Error('Reviewed shell fixture boundary changed: '+from.slice(0,70));source=source.replace(from,to);};
source=source.replaceAll('branch-switch-shell-ui','history-startup-ui');
replace('  const { createServer } = await import("vite")',`
  const mainFile=path.join(dir,'main.tsx'),mockFile=path.join(dir,'mock.tsx');
  let main=fs.readFileSync(mainFile,'utf8');
  main="import {NativeBoot} from '@/platforms/windows/components/DatabaseBoot';\\n"+main;
  const mount="createRoot(document.getElementById('root')).render(<AppShell><Page/></AppShell>);";
  assert.equal(main.split(mount).length,2);
  main=main.replace(mount,\`window.fixture.databaseListeners=new Set();window.fixture.activityListeners=new Set();
window.fixture.databaseState={state:scenario==='history-first'||scenario==='history-restore'?'enabled_bootstrapping':'enabled_ready',enabled:true,configured:true,connected:true,tradingReady:true};
window.pos={database:{getState:async()=>window.fixture.databaseState,subscribe:fn=>{window.fixture.databaseListeners.add(fn);return()=>window.fixture.databaseListeners.delete(fn)},onStartupActivity:fn=>{window.fixture.activityListeners.add(fn);return()=>window.fixture.activityListeners.delete(fn)}},sync:{subscribe:()=>()=>{}}};
window.fixture.activity=value=>{for(const fn of window.fixture.activityListeners)fn(value)};
window.fixture.database=value=>{window.fixture.databaseState={...window.fixture.databaseState,...value};for(const fn of window.fixture.databaseListeners)fn(window.fixture.databaseState)};
createRoot(document.getElementById('root')).render(<NativeBoot><AppShell><Page/></AppShell></NativeBoot>);\`);
  main=main.replace('Synthetic protected details.</DialogDescription>','Synthetic protected details.</DialogDescription><input data-fixture-unsaved aria-label="Unsaved fixture note"/>');
  fs.writeFileSync(mainFile,main);
  let mock=fs.readFileSync(mockFile,'utf8');
  mock=mock.replace('return{pathname:s.pathname}','return options?.select?options.select({pathname:s.pathname}):{pathname:s.pathname}').replace('export const useLocation=()=>','export const useLocation=(options)=>');
  mock+='\\nexport const setStartupOnlineMode=noop;\\n';fs.writeFileSync(mockFile,mock);
  const { createServer } = await import("vite")`);
const begin='    for (const width of [1440, 390]) {',end='    assert.deepEqual(pageErrors, []); assert.deepEqual(remoteRequests, []);';
const a=source.indexOf(begin),b=source.indexOf(end,a);if(a<0||b<0)throw Error('Mounted fixture test boundaries changed');
source=source.slice(0,a)+`
    const {DatabaseService}=require(path.join(root,'electron/db/service.cjs'));
    const {ManagementReplica}=require(path.join(root,'electron/sync/management-replica.cjs'));
    const {SyncCoordinator}=require(path.join(root,'electron/sync/coordinator.cjs'));
    const activityEvents=[],databaseEvents=[];
    const service=new DatabaseService({secureConfig:{enabled:()=>true,profile:()=>({database:'owned-ui-fixture'})},manager:{pool:{},isConnected:()=>true},publish:value=>databaseEvents.push(value),publishStartupActivity:value=>activityEvents.push(value)});
    service.state='enabled_ready';service.validated=true;
    let pushes=0,pulls=0,historySteps=0;
    const coordinator=new SyncCoordinator({pushWorker:{run:async()=>{pushes++;return{}}},pullWorker:{run:async()=>{pulls++;return{}}}});
    const replica=new ManagementReplica({cloud:{managementBranches:async()=>({ok:true,branches:[{id:'A'},{id:'B'}]})},databaseService:service,connectionManager:{isConnected:()=>true},jobs:{active:async()=>null,completed:async()=>({status:'completed'})},coordinator,
      lifecycle:{bootstrapType:()=> 'bootstrap_7300',historyStep:async()=>{historySteps++;return{pending:true,status:'queued'}}}});
    for(const width of [1440,390]){
      const page=await open('normal',width);await expectPage(page,'A');await captureShell(page);
      await patch(page,{native:true,management:true});
      await page.getByRole('button',{name:'Open protected dialog',exact:true}).click();
      await page.getByLabel('Unsaved fixture note').fill('unsaved count stays');
      await page.evaluate(()=>{window.fixture.savedPage=document.querySelector('[data-protected-page]');window.fixture.savedInput=document.querySelector('[data-fixture-unsaved]');});
      for(let n=0;n<12;n++){
        const before=activityEvents.length;await replica.run({historyOnly:true});
        for(const event of activityEvents.slice(before))await page.evaluate(value=>window.fixture.activity(value),event);
      }
      await expectPage(page,'A');await assertShell(page);
      assert(await page.evaluate(()=>window.fixture.savedPage===document.querySelector('[data-protected-page]')&&window.fixture.savedInput===document.querySelector('[data-fixture-unsaved]')&&window.fixture.savedInput.value==='unsaved count stays'));
      assert.equal(await page.locator('[data-fixture-startup]').count(),0);assert.equal(databaseEvents.length,0);
      groups++;await page.keyboard.press('Escape');
      // Independent AppShell authority/profile gates still win over ready SQL.
      await patch(page,{profile:'new-profile',ready:false,settingsPending:true});
      await page.locator('[data-fixture-startup]').waitFor();assert.equal(await page.locator('[data-protected-page]').count(),0);
      groups++;await page.close();
      for(const scenario of ['history-first','history-restore']){
        const first=await open(scenario,width);await first.locator('[data-fixture-startup]').waitFor();
        for(const event of activityEvents.slice(-4))await first.evaluate(value=>window.fixture.activity(value),event);
        assert.equal(await first.locator('aside,[data-protected-page]').count(),0);
        await first.evaluate(()=>window.fixture.database({state:'enabled_ready'}));await expectPage(first,'A');groups++;await first.close();
      }
      const revoked=await open('normal',width);await expectPage(revoked,'A');await patch(revoked,{native:true,management:true,revoked:true});
      await revoked.locator('[data-fixture-revoked]').waitFor();assert.equal(await revoked.locator('[data-protected-page]').count(),0);groups++;await revoked.close();
    }
    assert.equal(pushes,0);assert.equal(pulls,0);assert.equal(historySteps,24);
`+source.slice(b);
replace('mounted React/Radix branch-switch groups','mounted NativeBoot/AppShell history-activity groups');
const fixture=new Module(__filename,module);fixture.filename=__filename;fixture.paths=module.paths;fixture._compile(source,__filename);
