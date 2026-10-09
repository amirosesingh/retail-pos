const test=require('node:test');
const assert=require('node:assert/strict');
const {finishShutdownSync}=require('../electron/sync/shutdown-sync.cjs');
test('closing retries a transient failure then completes only after ACK',async()=>{
  let calls=0;const states=[];
  const result=await finishShutdownSync({run:async()=>++calls<3?{ok:false,code:'ECONNRESET'}:{ok:true},progress:s=>states.push(s),sleep:async()=>{}});
  assert.equal(result.ok,true);assert.equal(calls,3);assert.ok(states.some(s=>s.message.includes('Retrying')));
});
test('closing never treats pending data or unavailable cloud as synchronized',async()=>{
  let calls=0;
  const result=await finishShutdownSync({run:async()=>{calls++;return {ok:false,code:'ESYNC_PENDING',pending:2};},sleep:async()=>{}});
  assert.equal(result.ok,false);assert.equal(result.pending,2);assert.equal(calls,3);
});
test('authorization and still-running timeout require intervention without duplicate retries',async()=>{
  for(const failure of [{ok:false,code:'HTTP_403'},{ok:false,timedOut:true}]) {
    let calls=0;
    const result=await finishShutdownSync({run:async()=>{calls++;return failure;},sleep:async()=>{}});
    assert.equal(calls,1);assert.equal(result.ok,false);
  }
});
