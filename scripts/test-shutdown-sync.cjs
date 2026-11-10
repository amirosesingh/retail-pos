const test=require('node:test');
const assert=require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { runInNewContext } = require('node:vm');
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

test('signed-out normal exit preserves readable pending records without anonymous uploads or false ACKs', async () => {
  const result = await runShutdownSync({ signedOut:true, allowSignedOutExit:true,
    pendingSummary:async()=>({pending:3,failed:1}),
    health:async()=>assert.fail('login screen should not call the cloud'),
    run:async()=>assert.fail('login screen must not upload as a person') });
  assert.deepEqual(result,{pending:3,failed:1,ok:true,synchronized:false,authenticationRequired:true});
});
test('signed-out exit refuses an unreadable journal and does not bypass installer or shift synchronization', async () => {
  await assert.rejects(runShutdownSync({signedOut:true,allowSignedOutExit:true,
    pendingSummary:async()=>{throw new Error('Journal unavailable');}}),/Journal unavailable/);
  const result=await runShutdownSync({signedOut:true,allowSignedOutExit:false,
    health:async()=>({online:true,ready:false,code:'HTTP_403'}),
    pendingSummary:async()=>assert.fail('mandatory close cannot defer'),run:async()=>assert.fail('no authorization')});
  assert.equal(result.ok,false);assert.equal(result.code,'HTTP_403');
});

// Exercise the actual Main close preparation with disposable collaborators.
function mainClose({ signedIn = false, drain = async () => {}, sync = async () => ({ ok: true }) } = {}) {
  const source = readFileSync(join(__dirname, '../electron/main.cjs'), 'utf8');
  const declarations = source.slice(source.indexOf('function shouldInstallUpdateOnClose('), source.indexOf('\napp.on("second-instance"'));
  const calls = [], pendingShiftCloseSync = new Set(['saved-shift']);
  const closeWriteBarrier = {
    active: new Set(),
    sealAndDrain: async () => { calls.push('drain'); await drain(); },
    reopen: () => calls.push('reopen'),
  };
  const handlers = runInNewContext(declarations + '\n({ prepareApplicationClose, shouldInstallUpdateOnClose })', {
    adminSession: { hasPosAuthority: () => signedIn },
    closePreparation: null, closeWriteBarrier, pendingShiftCloseSync,
    mainWindow: null, reportCloseProgress() {},
    installUpdateAfterSync() {}, updater: { status: () => ({ status: 'ready' }) },
    isManagementDevice: () => false,
    databaseService: { snapshot: () => { calls.push('sql-state'); return { configured: true }; } },
    flushSyncBeforeShutdown: async () => { calls.push('sync'); return sync(); },
    SHUTDOWN_SYNC_TIMEOUT_MS: 1_000,
    settleWithin: async work => { try { return { ok: true, value: await work() }; } catch { return { ok: false }; } },
    diagnostics: { logConnection() {} },
  });
  return { ...handlers, calls, pendingShiftCloseSync };
}

test('login screen waits for accepted local writes then exits without requiring SQL, sync or a ready installer', async () => {
  let finishWrite, done = false;
  const f = mainClose({ drain: () => new Promise(resolve => { finishWrite = resolve; }) });
  assert.equal(f.shouldInstallUpdateOnClose(), false);
  const closing = f.prepareApplicationClose().then(result => { done = true; return result; });
  await Promise.resolve();
  assert.deepEqual(f.calls, ['drain']);
  assert.equal(done, false);
  finishWrite();
  const result = await closing;
  assert.equal(result.ok, true);
  assert.equal(result.synchronized, false);
  assert.deepEqual(f.calls, ['drain']);
  assert.deepEqual([...f.pendingShiftCloseSync], ['saved-shift']);
});

test('an unfinished local write still prevents quitting from login', async () => {
  const f = mainClose({ drain: async () => { throw new Error('unfinished'); } });
  const result = await f.prepareApplicationClose();
  assert.equal(result.ok, false);
  assert.equal(result.stage, 'local-writes');
  assert.deepEqual(f.calls, ['drain', 'reopen']);
});

test('signed-in quit and explicit update still require the final upload path', async () => {
  const signedIn = mainClose({ signedIn: true });
  assert.equal(signedIn.shouldInstallUpdateOnClose(), true);
  assert.equal((await signedIn.prepareApplicationClose()).ok, true);
  assert.deepEqual(signedIn.calls, ['drain', 'sql-state', 'sync']);
  assert.equal(signedIn.pendingShiftCloseSync.size, 0);

  const updating = mainClose({ sync: async () => ({ ok: false, error: 'Still pending' }) });
  assert.equal((await updating.prepareApplicationClose(true)).ok, false);
  assert.deepEqual(updating.calls, ['drain', 'sql-state', 'sync', 'reopen']);
  assert.equal(updating.pendingShiftCloseSync.size, 1);
});
