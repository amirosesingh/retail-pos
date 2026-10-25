const {test}=require('node:test');
const assert=require('node:assert/strict');
const {LocalDataLifecycle}=require('../electron/jobs/lifecycle.cjs');
function setup({connected=true,validated=true,completed=true,active=null,hasStore=true}={}){
  const events=[];
  const request={input(name,value){events.push([name,value]);return this;},async query(sql){assert.match(sql,/WHERE id=@branch/);return{recordset:hasStore?[{id:'A'}]:[]};}};
  const lifecycle=new LocalDataLifecycle({
    databaseService:{snapshot:()=>({connected,tradingReady:validated}),markReady:state=>events.push(state),transition:state=>events.push(state)},
    jobRepository:{completed:async(type,branch)=>{assert.equal(type,'bootstrap_90');assert.equal(branch,'A');return completed?{}:null;},active:async()=>active},
    connectionManager:{pool:{request:()=>request}},registry:{tables:[]},syncCoordinator:{},
  });
  return{lifecycle,events};
}
test('validated completed branch cache opens before any cloud refresh can block',async()=>{
  const {lifecycle,events}=setup();
  let rejectResume;
  lifecycle.resume=()=>new Promise((_resolve,reject)=>{rejectResume=reject;});
  const pending=lifecycle.ensure({branchId:'A',historyDays:90});
  await new Promise(resolve=>setImmediate(resolve));
  assert.ok(events.some(event=>event.phase==='background_sync'&&event.syncReady===false));
  assert.ok(events.some(event=>Array.isArray(event)&&event[0]==='branch'&&event[1]==='A'));
  rejectResume(new Error('Central refresh unavailable'));
  await assert.rejects(pending,/Central refresh unavailable/);
});
test('fresh, disconnected, unvalidated, incomplete and wrong-branch caches cannot release startup',async()=>{
  for(const options of [{connected:false},{validated:false},{completed:false},{active:{status:'interrupted'}},{hasStore:false}]){
    assert.equal(await setup(options).lifecycle.cachedSnapshotReady('A',90),false);
  }
});
test('explicit rebuild never uses a completed-cache shortcut',async()=>{
  const {lifecycle,events}=setup();
  lifecycle.resume=async()=>{throw new Error('Stop after initial state');};
  await assert.rejects(lifecycle.ensure({branchId:'A',force:true}),/Stop after initial state/);
  assert.equal(events.includes('enabled_bootstrapping'),true);
  assert.equal(events.some(event=>event.phase==='background_sync'),false);
});
