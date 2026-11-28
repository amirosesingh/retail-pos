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
test('a disconnected system skips the cloud probe while verifying its pending local work', async () => {
  const result = await runShutdownSync({
    networkOnline: () => false,
    health: async () => assert.fail('offline close probed HTTPS'),
    pendingSummary: async () => ({ pending: 2 }),
    run: async () => assert.fail('offline close tried to sync'),
  });
  assert.deepEqual(result, { pending: 2, ok: true, offline: true, synchronized: false });
});

test('losing the connection during final upload leaves the verified queue available for next time', async () => {
  let online = true;
  const result = await runShutdownSync({
    networkOnline: () => online,
    health: async () => ({ online: true, ready: true }),
    pendingSummary: async () => ({ pending: 1 }),
    run: async () => { online = false; return { ok: false, code: 'ECONNRESET' }; },
  });
  assert.deepEqual(result, { pending: 1, ok: true, offline: true, synchronized: false });
});

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
function mainClose({
  signedIn = false,
  drain = async () => {},
  sync = async () => ({ ok: true }),
  localRead = async () => ({ recordset: [{ matches_profile: 1 }] }),
  lease = async work => work(),
  connectedDatabase = 'isolated_update_fixture',
  localRecoveryPending = false,
  startupDatabaseRestore = null,
  localEnabled = true,
} = {}) {
  const source = readFileSync(join(__dirname, '../electron/main.cjs'), 'utf8');
  const declarations = source.slice(source.indexOf('function flushRendererBeforeClose('), source.indexOf('\napp.on("second-instance"'));
  const calls = [], pendingShiftCloseSync = new Set(['saved-shift']);
  const profile = { database: 'isolated_update_fixture' };
  const queries = [];
  const pool = { request: () => ({
    input() { return this; },
    async query(sql) { calls.push('local-read'); queries.push(sql); return localRead(); },
  }) };
  const closeWriteBarrier = {
    active: new Set(),
    sealAndDrain: async () => { calls.push('drain'); await drain(); },
    reopen: () => calls.push('reopen'),
  };
  const handlers = runInNewContext(declarations + '\n({ prepareApplicationClose })', {
    adminSession: { hasPosAuthority: () => signedIn },
    closePreparation: null, closeWriteBarrier, pendingShiftCloseSync, startupDatabaseRestore,
    mainWindow: null, reportCloseProgress() {},
    isManagementDevice: () => false,
    databaseService: { snapshot: () => { calls.push('sql-state'); return { enabled: localEnabled && !localRecoveryPending, configured: true, tradingReady: localEnabled && !localRecoveryPending, localRecoveryPending }; } },
    databaseManager: { pool, profile: { ...profile, database: connectedDatabase }, isConnected: () => true },
    databaseConfig: { profile: () => profile },
    syncCoordinator: { withExclusive: lease },
    flushSyncBeforeShutdown: async () => { calls.push('sync'); return sync(); },
    SHUTDOWN_SYNC_TIMEOUT_MS: 1_000,
    settleWithin: async work => { try { return { ok: true, value: await work() }; } catch { return { ok: false }; } },
    diagnostics: { logConnection() {} },
  });
  return { ...handlers, calls, pendingShiftCloseSync, queries };
}

test('login screen waits for accepted local writes then exits without requiring SQL, sync or a ready installer', async () => {
  let finishWrite, done = false;
  const f = mainClose({ drain: () => new Promise(resolve => { finishWrite = resolve; }) });
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

test('signed-in quit keeps its final upload policy', async () => {
  const signedIn = mainClose({ signedIn: true });
  assert.equal((await signedIn.prepareApplicationClose()).ok, true);
  assert.deepEqual(signedIn.calls, ['drain', 'sql-state', 'sync']);
  assert.equal(signedIn.pendingShiftCloseSync.size, 0);

});

test('normal window close and system quit leave a downloaded update staged', () => {
  const source = readFileSync(join(__dirname, '../electron/main.cjs'), 'utf8');
  const windowClose = source.slice(source.indexOf('mainWindow.on("close"'), source.indexOf('mainWindow.on("closed"'));
  const systemQuit = source.slice(source.indexOf('app.on("before-quit"'), source.indexOf('app.on("window-all-closed"'));
  for (const handler of [windowClose, systemQuit]) {
    assert.match(handler, /prepareApplicationClose\(\)/);
    assert.doesNotMatch(handler, /installUpdateAfterSync|updater\.install/);
  }
});

test('an early close waits for native startup validation to release its connection', async () => {
  let finishValidation;
  const validation = new Promise(resolve => { finishValidation = resolve; });
  const fixture = mainClose({ startupDatabaseRestore: validation });
  let prepared = false;
  const closing = fixture.prepareApplicationClose().then(() => { prepared = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(prepared, false);
  finishValidation();
  await closing;
  assert.equal(prepared, true);
});

test('closing with saved work re-verifies the exact local database without reporting a cloud acknowledgement', async () => {
  const fixture = mainClose({ signedIn: true, sync: async () => assert.fail('deferred work should not send a second upload') });
  const result = await fixture.prepareApplicationClose(false, true);
  assert.equal(result.ok, true);
  assert.equal(result.synchronized, false);
  assert.deepEqual(fixture.calls, ['drain', 'sql-state', 'local-read']);
  assert.equal(fixture.pendingShiftCloseSync.size, 1);
  const changed = mainClose({ signedIn: true, connectedDatabase: 'changed-fixture' });
  assert.equal((await changed.prepareApplicationClose(false, true)).stage, 'local-storage');
  assert.equal(changed.pendingShiftCloseSync.size, 1);
});

test('repeated intentional early quits never count as failed launches or mark a build healthy', () => {
  let stored;
  const module = { exports: {} };
  const source = readFileSync(join(__dirname, '../electron/health.cjs'), 'utf8');
  runInNewContext(source, {
    module, console: { error() {}, warn() {} },
    require: name => {
      if (name === 'node:fs') return { readFileSync: () => stored, writeFileSync: (_path, value) => { stored = value; } };
      if (name === 'electron') return { app: { getPath: () => 'disposable-boot-profile', getVersion: () => 'fixture-beta' } };
      return require(name);
    },
  });
  const health = module.exports;
  assert.equal(health.beginBoot().failures, 0);
  assert.equal(health.beginBoot().failures, 1); // The first launch actually failed.
  const ended = health.markClosed();
  assert.equal(ended.pending, false);
  assert.equal(ended.lastGoodVersion, null);
  for (let attempt = 0; attempt < 3; attempt++) {
    const state = health.beginBoot();
    assert.equal(state.failures, 1);
    assert.equal(health.shouldEnterSafeMode(state), false);
    health.markClosed();
  }
  assert.equal(health.beginBoot().failures, 1);
  assert.equal(health.shouldEnterSafeMode(health.beginBoot()), true);
});

test('online recovery close keeps previous shift work held without querying or acknowledging old SQL', async () => {
  const f = mainClose({ signedIn: true, localRecoveryPending: true, sync: async () => assert.fail('Held SQL was synchronized') });
  const result = await f.prepareApplicationClose();
  assert.equal(result.ok, true);
  assert.equal(result.synchronized, false);
  assert.equal(result.localRecoveryPending, true);
  assert.deepEqual(f.calls, ['drain', 'sql-state']);
  assert.deepEqual([...f.pendingShiftCloseSync], ['saved-shift']);
  assert.equal(f.queries.length, 0);
});

test('closing a signed-in online-only session preserves the disabled SQL profile and leaves its stored work pending', async () => {
  const fixture = mainClose({ signedIn: true, localEnabled: false, sync: async () => assert.fail('disabled SQL was synchronized') });
  const result = await fixture.prepareApplicationClose();
  assert.equal(result.ok, true);
  assert.equal(result.synchronized, false);
  assert.deepEqual(fixture.calls, ['drain', 'sql-state']);
  assert.deepEqual([...fixture.pendingShiftCloseSync], ['saved-shift']);
});

test('online recovery update preserves the old hold without requiring its unavailable SQL', async () => {
  const f = mainClose({ localRecoveryPending: true, sync: async () => assert.fail('Held SQL was synchronized') });
  const result = await f.prepareApplicationClose(true);
  assert.equal(result.ok, true);
  assert.equal(result.synchronized, false);
  assert.equal(result.syncDeferred, true);
  assert.deepEqual([...f.pendingShiftCloseSync], ['saved-shift']);
  assert.equal(f.queries.length, 0);
});

test('install accepts durable offline data without an upload or a false ACK', async () => {
  const updating = mainClose({ sync: async () => assert.fail('Installer requested cloud sync') });
  const result = await updating.prepareApplicationClose(true);
  assert.equal(result.ok, true);
  assert.equal(result.locallySaved, true);
  assert.equal(result.synchronized, false);
  assert.equal(result.syncDeferred, true);
  assert.deepEqual(updating.calls, ['drain', 'sql-state', 'local-read']);
  assert.equal(updating.pendingShiftCloseSync.size, 1);
  assert.equal(updating.queries.length, 1);
  assert.ok(!/\b(?:UPDATE|DELETE|INSERT|TRUNCATE)\b/i.test(updating.queries[0]));
});

test('install waits for the active sync lease before verifying local storage', async () => {
  let finish;
  const held = new Promise(resolve => { finish = resolve; });
  const updating = mainClose({ lease: async work => { await held; return work(); } });
  let installed = false;
  const result = updating.prepareApplicationClose(true).then(value => { installed = true; return value; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(installed, false);
  assert.deepEqual(updating.calls, ['drain', 'sql-state']);
  finish();
  assert.equal((await result).ok, true);
});

test('install refuses unreadable or changed local databases and keeps the closing queued', async () => {
  for (const localRead of [async () => { throw new Error('Local storage unavailable'); },
    async () => ({ recordset: [{ matches_profile: 0 }] })]) {
    const updating = mainClose({ localRead });
    const result = await updating.prepareApplicationClose(true);
    assert.equal(result.ok, false);
    assert.equal(result.stage, 'local-storage');
    assert.equal(updating.pendingShiftCloseSync.size, 1);
    assert.ok(updating.calls.includes('reopen'));
  }
});

test('install refuses a pool for a different database from the saved profile', async () => {
  const updating = mainClose({ connectedDatabase: 'different_update_fixture' });
  const result = await updating.prepareApplicationClose(true);
  assert.equal(result.ok, false);
  assert.equal(result.stage, 'local-storage');
  assert.equal(updating.queries.length, 0);
  assert.equal(updating.pendingShiftCloseSync.size, 1);
});
