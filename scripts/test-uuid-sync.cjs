const test = require('node:test');
const assert = require('node:assert/strict');
const { CloudClient } = require('../electron/sync/cloud-client.cjs');
const { rowsForBranch } = require('../electron/sync/push-worker.cjs');
const { normalizeSyncPayload } = require('../electron/sync/uuid-payload.cjs');
const id = 'A1234567-1234-7234-8234-123456789ABC';
const branch = 'B1234567-1234-4234-8234-123456789ABC';

test('uploads and retries lowercase UUIDs, including JSON delete keys, without changing codes or proofs', async () => {
  const originalFetch = global.fetch;
  const bodies = [];
  global.fetch = async (_url, options) => { bodies.push(JSON.parse(options.body)); return Response.json({ok:true}); };
  try {
    const cloud = new CloudClient({configStore:{get:()=> 'https://pos.example.test'}, terminalStore:{read:()=>({tokenId:id})}});
    const batch = {batchId:id, branchId:branch, operations:[{table:'stock_adjustments', rows:[{id,product_id:id,store_id:branch,sku:id}], changes:[{operation:'delete',entity_id:JSON.stringify({id}),key:{id}}]}]};
    await cloud.pushAggregate(batch); await cloud.pushAggregate(batch);
    assert.deepEqual(bodies[0],bodies[1]);
    const sent=bodies[0].sqlServerAggregate;
    assert.equal(sent.batchId,id.toLowerCase());assert.equal(sent.branchId,branch.toLowerCase());
    assert.deepEqual(sent.operations[0].rows[0],{id:id.toLowerCase(),product_id:id.toLowerCase(),store_id:branch.toLowerCase(),sku:id});
    assert.equal(sent.operations[0].changes[0].entity_id,JSON.stringify({id:id.toLowerCase()}));
    assert.equal(bodies[0].terminalToken,id.toLowerCase());
    assert.equal(batch.operations[0].rows[0].id,id);
  } finally { global.fetch=originalFetch; }
});

test('pulls normalized UUID links and tombstones with the original cursor and row versions', async () => {
  const originalFetch=global.fetch;
  global.fetch=async()=>Response.json([
    {entity_id:JSON.stringify({id}),row_data:{id,store_id:branch,lines:[{productId:id}],stock_by_store:{[branch]:4}},row_version:7,cursor:10,tombstone:false},
    {entity_id:JSON.stringify({id}),row_data:null,row_version:8,cursor:11,tombstone:true},
  ]);
  try {
    const cloud=new CloudClient({configStore:{get:()=> 'https://pos.example.test'},terminalStore:{read:()=>({tokenId:id})}});
    const pulled=await cloud.pullBatch({branchId:branch,cursor:0,limit:100});
    assert.equal(pulled.cursor,11);assert.equal(pulled.count,2);
    assert.deepEqual(pulled.rows[0].row_data,{id:id.toLowerCase(),store_id:branch.toLowerCase(),lines:[{productId:id.toLowerCase()}],stock_by_store:{[branch.toLowerCase()]:4}});
    assert.equal(pulled.rows[0].row_version,7);assert.equal(pulled.tombstones[0].row_version,8);
    assert.equal(pulled.tombstones[0].entity_id,JSON.stringify({id:id.toLowerCase()}));
  } finally { global.fetch=originalFetch; }
});

test('UUID branch aliases canonicalize while differently cased branch codes are not rewritten', () => {
  const table={cloudTable:'stock_count_drafts',scope:'branch',direction:'bidirectional',columns:[{cloudColumn:'store_id'}]};
  assert.equal(rowsForBranch(table,[{store_id:branch}],branch.toLowerCase())[0].store_id,branch.toLowerCase());
  assert.equal(rowsForBranch(table,[{store_id:'LC1'}],'lc1')[0].store_id,'LC1');
  assert.deepEqual(normalizeSyncPayload({storeId:'LC1',token:id,password:id,code:id}),{storeId:'LC1',token:id,password:id,code:id});
});
