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

const { runShutdownSync } = require('../electron/sync/shutdown-sync.cjs');
test('offline exit proves the journal is readable and preserves pending rows without an ACK', async () => {
  const result = await runShutdownSync({health:async()=>({online:false,ready:false,code:'EOFFLINE'}),
    pendingSummary:async()=>({pending:3,failed:1}),run:async()=>assert.fail('offline sync attempted')});
  assert.deepEqual(result,{ok:true,offline:true,synchronized:false,pending:3,failed:1});
});
test('online exit drains the final sync and refuses an unacknowledged result', async () => {
  let calls=0;
  const result = await runShutdownSync({health:async()=>({online:true,ready:true}),
    pendingSummary:async()=>assert.fail('offline path'),run:async()=>{calls++;return {ok:false,code:'ESYNC_PENDING',pending:2};}});
  assert.equal(calls,1);assert.equal(result.ok,false);assert.equal(result.pending,2);
});
test('bad cloud configuration and HTTP permission failures are not classified as offline', async () => {
  for(const code of ['EBACKEND','HTTP_401','HTTP_403','HTTP_500']) {
    const result=await runShutdownSync({health:async()=>({online:code!=='EBACKEND',ready:false,code}),
      pendingSummary:async()=>assert.fail('configuration cannot use offline exit'),run:async()=>assert.fail('sync should not run')});
    assert.equal(result.ok,false);assert.equal(result.code,code);
  }
});
test('offline close is refused if the local journal cannot be read', async () => {
  await assert.rejects(runShutdownSync({health:async()=>({online:false,ready:false,code:'EOFFLINE'}),
    pendingSummary:async()=>{throw new Error('Local DB unavailable');},run:async()=>{}}),/Local DB unavailable/);
});
