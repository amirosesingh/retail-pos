const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { stripTypeScriptTypes } = require('node:module');
const { WriteBarrier } = require('../electron/sync/write-barrier.cjs');
const { activityOnly, ACTIVITY_INTERVAL_MS } = require('../electron/sync/event-policy.cjs');
const { SyncCoordinator } = require('../electron/sync/coordinator.cjs');
const { PushWorker } = require('../electron/sync/push-worker.cjs');

test('preload close handshake works on login and reports a failed audit flush', async () => {
  const exposed={};const listeners={};const replies=[];
  const electron={contextBridge:{exposeInMainWorld:(name,value)=>{exposed[name]=value;}},
    ipcRenderer:{on:(name,fn)=>{listeners[name]=fn;},send:(name,result)=>replies.push({name,result}),invoke:async()=>({})}};
  new Function('require',readFileSync('electron/preload.cjs','utf8'))(name=>{
    assert.equal(name,'electron');return electron;
  });
  await listeners['sync:prepare-close']({},'login');
  assert.equal(replies[0].result.ok,true);
  const remove=exposed.pos.onBeforeClose(async()=>{throw new Error('Audit buffer pending');});
  await listeners['sync:prepare-close']({},'signed-in');
  assert.deepEqual(replies[1].result,{nonce:'signed-in',ok:false,error:'Audit buffer pending'});
  remove();await listeners['sync:prepare-close']({},'retry');
  assert.equal(replies[2].result.ok,true);
});

test('activity delay never delays a mixed business transaction', () => {
  assert.equal(ACTIVITY_INTERVAL_MS, 120000);
  assert.equal(activityOnly([{table:'audit_logs'},{entity_type:'activity_events'}]), true);
  assert.equal(activityOnly([{table:'audit_logs'},{table:'sales'}]), false);
  assert.equal(activityOnly([]), false);
});

test('closing drains accepted writes, refuses later writes and can reopen on failure', async () => {
  const barrier = new WriteBarrier();
  let release;
  const accepted = barrier.run(() => new Promise(resolve => { release=resolve; }));
  await Promise.resolve();
  let drained=false;
  const closing=barrier.sealAndDrain().then(() => { drained=true; });
  assert.equal((await barrier.run(() => assert.fail('late write executed'))).code,'EAPP_CLOSING');
  assert.equal(drained,false);
  release({ok:true}); await accepted; await closing;
  assert.equal(drained,true);
  barrier.reopen(); assert.equal(await barrier.run(() => 42),42);
});

test('final sync overrides activity deferral and rejects unacknowledged rows', async () => {
  let options;
  const coordinator=new SyncCoordinator({
    pushWorker:{run:async value => {options=value;return {pushed:1};},reader:{pendingSummary:async()=>({pending:1,failed:0})}},
    pullWorker:{run:async()=>({merged:0})},
  });
  const result=await coordinator.runFinal({branchId:'B1',includeActivity:false});
  assert.equal(options.includeActivity,true);assert.equal(result.ok,false);assert.equal(result.code,'ESYNC_PENDING');
});

test('final sync rejects settings waiting for authorization even with an empty journal', async () => {
  const coordinator=new SyncCoordinator({
    pushWorker:{run:async()=>({deferredTables:['pos_settings']}),reader:{pendingSummary:async()=>({pending:0,failed:0})}},
    pullWorker:{run:async()=>({})},
  });
  assert.equal((await coordinator.runFinal({branchId:'B1'})).code,'ESYNC_AUTH_PENDING');
});

test('acknowledged final uploads do not depend on a historical pull timeout', async () => {
  let pulled = 0;
  const coordinator = new SyncCoordinator({
    pushWorker: { run: async () => ({ pushed: 4 }), reader: {
      pendingSummary: async () => ({ pending: 0, failed: 0 }),
    } },
    pullWorker: { run: async () => {
      pulled++;
      throw Object.assign(new Error('statement timeout'), { code: '57014' });
    } },
  });
  assert.equal((await coordinator.runFinal({ branchId: 'B1' })).ok, true);
  assert.equal(pulled, 0);
  // Ordinary synchronization continues to download changes and report errors.
  assert.equal((await coordinator.runNow({ branchId: 'B1' })).code, '57014');
  assert.equal(pulled, 1);
});

test('final uploads still reject failed local records', async () => {
  const coordinator = new SyncCoordinator({
    pushWorker: { run: async () => ({ pushed: 4 }), reader: {
      pendingSummary: async () => ({ pending: 0, failed: 1 }),
    } },
    pullWorker: { run: async () => assert.fail('closing downloaded history') },
  });
  assert.equal((await coordinator.runFinal({ branchId: 'B1' })).code, 'ESYNC_PENDING');
});

test('slow download pages shrink without skipping or immediately growing again', async () => {
  const { readPage } = require('../electron/sync/page-policy.cjs');
  const limits = [];
  const result = await readPage(async limit => {
    limits.push(limit);
    if (limit > 25) throw Object.assign(new Error('statement timeout'), { code: '57014' });
    return { count: 1, cursor: 9, rows: [], tombstones: [] };
  }, 100);
  assert.deepEqual(limits, [100, 50, 25]);
  assert.equal(result.nextLimit, 25);
  let attempts = 0;
  await assert.rejects(readPage(async () => {
    attempts++;
    throw Object.assign(new Error('permission denied'), { code: '42501', status: 403 });
  }), /permission denied/);
  assert.equal(attempts, 1);
});

test('urgent pass defers activity without advancing its checkpoint', async () => {
  const visited=[]; let journalOptions;
  const worker=new PushWorker({
    reader:{pendingAggregates:async(_b,_l,_e,options)=>{journalOptions=options;return [];},changedIds:async table=>{visited.push(table.cloudTable);return [];}},
    registry:{tables:['audit_logs','sales'].map(name=>({cloudTable:name,sqlServerTable:name,dependencyOrder:1,columns:[{primaryKey:true}]}))},
    cloud:{},checkpoints:{list:async()=>[],save:async()=>assert.fail('checkpoint advanced')},
  });
  await worker.run({branchId:'B1',includeActivity:false});
  assert.deepEqual(visited,['sales']);assert.equal(journalOptions.includeActivity,false);
  visited.length=0;
  await worker.run({branchId:'B1',includeActivity:true});
  assert.deepEqual(visited,['audit_logs','sales']);
});

function loadTs(file, name, dependencies={}) {
  const source=stripTypeScriptTypes(readFileSync(file,'utf8')).replace(/^import .*;\s*$/gm,'').replace(/\bexport /g,'');
  return new Function(...Object.keys(dependencies),`${source}\nreturn ${name};`)(...Object.values(dependencies));
}

test('private notifications follow branch changes, validate hints and stop on logout', async (t) => {
  t.mock.timers.enable({apis:['setTimeout']});
  const createSerialChannelReplacer=loadTs('src/lib/realtime-channel-replacer.ts','createSerialChannelReplacer');
  const createSyncWakeChannels=loadTs('src/lib/sync-wake-channels.ts','createSyncWakeChannels',{createSerialChannelReplacer});
  const channels=[];const removed=[];const hints=[];let reconnects=0;
  const client={channel(topic,options){
    const channel={topic,options,on(_type,_filter,fn){this.receive=fn;return this;},subscribe(fn){this.status=fn;return this;}};
    channels.push(channel);return channel;
  },async removeChannel(channel){removed.push(channel.topic);}};
  const wakes=createSyncWakeChannels(client,table=>hints.push(table),()=>reconnects++);
  await wakes.replace('A','T1',false);assert.equal(channels.length,0);
  await wakes.replace('A','T1',true);
  assert.deepEqual(channels.map(c=>c.topic),['pos-sync:default:global','pos-sync:default:branch:A','pos-sync:default:terminal:T1']);
  assert.ok(channels.every(c=>c.options.config.private===true));
  channels[1].receive({payload:{table:'sales'}});channels[1].receive({payload:{table:'invalid table'}});
  assert.deepEqual(hints,['sales']);
  for(const channel of channels)channel.status('SUBSCRIBED');
  assert.equal(reconnects,0);
  t.mock.timers.tick(249);assert.equal(reconnects,0);
  t.mock.timers.tick(1);assert.equal(reconnects,1);
  // Repeated status callbacks do not schedule another catch-up.
  channels[0].status('SUBSCRIBED');t.mock.timers.tick(250);assert.equal(reconnects,1);
  channels[0].status('CLOSED');channels[0].status('SUBSCRIBED');
  await wakes.replace('B','T2',true);assert.equal(removed.length,3);
  t.mock.timers.tick(250);assert.equal(reconnects,1);
  channels[1].receive({payload:{table:'products'}});assert.deepEqual(hints,['sales']);
  assert.equal(channels[4].topic,'pos-sync:default:branch:B');
  channels[4].receive({payload:{table:'products'}});assert.deepEqual(hints,['sales','products']);
  channels[4].status('SUBSCRIBED');
  await wakes.replace('B','T2',false);assert.equal(removed.length,6);
  t.mock.timers.tick(250);assert.equal(reconnects,1);
  channels[4].receive({payload:{table:'sales'}});assert.deepEqual(hints,['sales','products']);
});

test('fresh installer contains the exact additive private notification upgrade', () => {
  const upgrade=readFileSync('supabase/sql/trigger_sync_upgrade.sql','utf8').trim();
  const schema=readFileSync('supabase/schema.sql','utf8');
  const included=schema.split('-- BEGIN EVENT-DRIVEN SYNC UPGRADE')[1].split('-- END EVENT-DRIVEN SYNC UPGRADE')[0].trim();
  assert.equal(included.replaceAll('\r\n','\n'),upgrade.replaceAll('\r\n','\n'));
  assert.match(upgrade,/AS RESTRICTIVE FOR INSERT TO authenticated, anon/);
  assert.match(upgrade,/auth_user_id=auth.uid\(\) AND is_active=true/);
  assert.match(upgrade,/AFTER INSERT ON public.sync_change_feed/);
});
