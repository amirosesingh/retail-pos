// Main-only exact hydration for history hints already present in a normal feed.
// No new feed is enabled here. History stays append-only and shares its page's
// transaction/checkpoint; ordinary tables retain their existing codec/apply path.
const {HistoryIndexStore}=require('./history-index-recovery.cjs');
const {MAX_ROWS,normalizeIndex,normalizeRows}=require('./history-index-protocol.cjs');
const {MAX_PAGE_BYTES}=require('./page-policy.cjs');
const {recordId}=require('./uuid-fields.cjs');
const {binding}=require('../verified-activation.cjs');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const fail=(code='EHISTORY_FEED_PROTOCOL')=>{throw Object.assign(new Error('The exact history feed page could not be verified. Its records and cursor remain pending.'),{code,table:'change_history'});};
function feedId(change){
 let key;try{if(typeof change.entity_id!=='string'||change.entity_id.length>128)fail();key=JSON.parse(change.entity_id);}catch{fail();}
 const id=recordId(key?.id);
 if(!key||Object.keys(key).length!==1||!Object.hasOwn(key,'id')||typeof id!=='string'||!UUID.test(id)||
  change.tombstone!==false||change.operation!=='insert'||!change.row_data||recordId(change.row_data.id)!==id)fail();
 return id;
}
async function prepareHistoryFeed({cloud,connectionManager,branchId,changes,store=null}){
 const entries=changes.filter(change=>change.table_name==='change_history');
 if(!entries.length)return Object.freeze({covers:()=>false,apply:async()=>0,assert:async()=>{}});
 if(entries.length>100)fail('EOVERSIZED');
 const covered=new WeakSet(entries),ids=[...new Set(entries.map(feedId))];
 const branch=recordId(String(branchId??'')),history=store??new HistoryIndexStore(connectionManager);
 function source(){
  const context=cloud.requestContext?.(false),terminalId=recordId(cloud.terminalId?.()),registered=binding(cloud.terminalStore?.read?.());
  if(!context||!/^[0-9a-f]{64}$/.test(context.fingerprint)||!context.pool||context.pool!==connectionManager.pool||
   typeof terminalId!=='string'||!UUID.test(terminalId)||!branch||branch.length>128||!registered||registered.mode==='operations'&&registered.branchId!==branch)
   fail('ESYNC_REQUEST_CONTEXT_CHANGED');
  return{pool:context.pool,fingerprint:context.fingerprint,terminalId};
 }
 const captured=source();
 const same=()=>{const current=source();if(current.pool!==captured.pool||current.fingerprint!==captured.fingerprint||current.terminalId!==captured.terminalId)fail('ESYNC_REQUEST_CONTEXT_CHANGED');};
 const databaseGuid=await history.guid();same();
 async function assert(tx=null){
  same();if(await history.guid(tx)!==databaseGuid)fail('EHISTORY_INDEX_SCOPE');same();
  if(entries.some((entry,index)=>feedId(entry)!==idsForEntries[index]))fail();
 }
 const idsForEntries=entries.map(feedId);
 const present=await history.present(ids);await assert();
 const missing=ids.filter(id=>!present.has(id)),rows=new Map();
 if(missing.length){
  // Begin attests the server-owned privacy mode. Do not take it from the feed
  // JSON/renderer or guess it from a cached account permission.
  const wire={organizationId:'default',branchId:branch,terminalId:captured.terminalId};
  const request={...wire,action:'begin'};
  const index=normalizeIndex(await cloud.historyIndex(request),wire,request);await assert();
  const expected={...wire,keepCommerce:index.keep_commerce};let bytes=0;
  for(let offset=0;offset<missing.length;offset+=MAX_ROWS){
   let remaining=missing.slice(offset,offset+MAX_ROWS);
   while(remaining.length){
    const result=normalizeRows(await cloud.historyMissingRows({...expected,ids:remaining}),expected,remaining);await assert();
    bytes+=Buffer.byteLength(JSON.stringify(result.rows),'utf8');if(bytes>MAX_PAGE_BYTES)fail('EOVERSIZED');
    for(const row of result.rows){if(rows.has(row.id))fail();rows.set(row.id,row);}
    remaining=[...result.remaining_ids];
   }
  }
 }
 return Object.freeze({
  covers:change=>covered.has(change),assert,
  async apply(tx){
   await assert(tx);
   const current=await history.present(ids,tx),pending=await history.pending(tx);let applied=0;
   for(const id of ids){
    if(pending.has(id))fail('ELOCAL_UPLOAD_PENDING');
    if(current.has(id))continue; // Membership only: never amend immutable history.
    const row=rows.get(id);if(!row)fail('ELOCAL_PENDING_UNVERIFIED');
    await history.insert(tx,row);current.add(id);applied++;
   }
   await assert(tx);return applied;
  },
 });
}
module.exports={prepareHistoryFeed};
