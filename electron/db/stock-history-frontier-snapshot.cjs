'use strict';
// PRIVATE Main observation only. This module cannot sign, acknowledge, publish
// coverage, alter a queue/checkpoint, or establish accepted source authority.
const {createHash}=require('node:crypto');
const {performance}=require('node:perf_hooks');
const {StockHistoryStore}=require('./stock-history.cjs');
const contract=require('./stock-history-contract.cjs');
const MAX_ROWS=2000,MAX_BYTES=8*1024*1024,MAX_MILLISECONDS=5000,REQUEST_MILLISECONDS=1000;
const INT64=9223372036854775807n,HEX=/^[a-f0-9]{64}$/;
const hash=value=>createHash('sha256').update(JSON.stringify(value),'utf8').digest('hex');
const unavailable=reason=>Object.freeze({available:false,reason});
function fail(code='ESTOCK_FRONTIER_INVALID'){throw Object.assign(new Error('The local stock frontier could not be verified.'),{code});}
function count(value){if(typeof value!=='string'||!/^(?:0|[1-9]\d{0,18})$/.test(value)||BigInt(value)>INT64)fail();return value;}
function nullableHash(value){if(value===null)return null;if(typeof value!=='string'||!HEX.test(value.toLowerCase()))fail();return value.toLowerCase();}
function exactText(value){if(typeof value!=='string'||Buffer.byteLength(value,'utf8')>8192)fail();return value;}
function nullableId(value){return value===null?null:contract.identifier(value,true);}
const canonicalColumn=column=>`CASE WHEN @canonical_uuid=1 THEN LOWER(${column}) ELSE ${column} END`;
const binary=column=>`CONVERT(varbinary(max),${canonicalColumn(column)})=CONVERT(varbinary(max),@branch)`;
const scope=`${binary('store_id')}`;
const proofHash=column=>`LOWER(CONVERT(varchar(64),HASHBYTES('SHA2_256',CONVERT(varchar(max),${column} COLLATE Latin1_General_100_BIN2_UTF8)),2))`;
const requestColumns=`CONVERT(nvarchar(30),DATALENGTH(proof_json)) proof_bytes`;
const sourceSql=`/*stock-frontier:sources*/ SELECT TOP(${MAX_ROWS+1})
 LOWER(CONVERT(nvarchar(36),id)) id,LOWER(CONVERT(nvarchar(36),operation_id)) operation_id,
 store_id,terminal_id,LOWER(CONVERT(nvarchar(36),database_guid)) database_guid,
 CONVERT(nvarchar(30),source_sequence) source_sequence,source_root,predecessor_root,payload_hash,
 ${requestColumns},CASE WHEN proof_json IS NULL THEN 1 ELSE 0 END unsigned,
 LOWER(CONVERT(nvarchar(36),accepted_batch_id)) accepted_batch_id,
 CONVERT(nvarchar(30),accepted_transaction_id) accepted_transaction_id,
 CASE WHEN accepted_at IS NULL THEN NULL ELSE CONVERT(nvarchar(40),SWITCHOFFSET(accepted_at,'+00:00'),127) END accepted_at
 FROM dbo.stock_history_source_cohorts WITH(HOLDLOCK,NOWAIT) WHERE ${scope}
 ORDER BY database_guid,CONVERT(varbinary(256),terminal_id),source_sequence;`;
const movementSql=`/*stock-frontier:movements*/ SELECT TOP(${MAX_ROWS+1})
 LOWER(CONVERT(nvarchar(36),id)) id,LOWER(CONVERT(nvarchar(36),operation_id)) operation_id,
 LOWER(CONVERT(nvarchar(36),product_id)) product_id,store_id,terminal_id,source_kind,payload_hash,
 CONVERT(nvarchar(30),DATALENGTH(author_proof_json)) proof_bytes,
 CASE WHEN author_proof_json IS NULL THEN 1 ELSE 0 END unsigned,
 CONVERT(nvarchar(30),ingested_cursor) ingested_cursor,
 LOWER(CONVERT(nvarchar(36),upload_aggregate_id)) upload_aggregate_id
 FROM dbo.stock_history_movements WITH(HOLDLOCK,NOWAIT) WHERE ${scope} ORDER BY id;`;
const journalSql=`/*stock-frontier:journal*/ SELECT TOP(${MAX_ROWS+1})
 CONVERT(nvarchar(30),change_id) change_id,entity_type,entity_id,operation,branch_id,
 CONVERT(nvarchar(30),entity_version) entity_version,LOWER(CONVERT(nvarchar(36),aggregate_id)) aggregate_id,
 CASE WHEN last_error IS NULL THEN 0 ELSE 1 END failed
 FROM dbo.sync_change_journal WITH(HOLDLOCK,NOWAIT)
 WHERE acknowledged_at IS NULL AND (${binary('branch_id')} OR CONVERT(varbinary(max),branch_id)=CONVERT(varbinary(max),N'global')) ORDER BY change_id;`;

/** One pinned connection, no session SETs. HOLDLOCK supplies serializable
 * semantics per data table even when the borrowed connection uses another
 * isolation level. NOWAIT makes this observer yield to contested business work.
 * Pending values count evidence objects, NOT the user-facing sync journal:
 * business=unACKed non-history journal rows; metadata=unaccepted cohorts plus
 * uningested movements plus orphan history journal rows; unsigned=NULL proofs;
 * unknown=distinct stable gap diagnostics. Zero never implies complete coverage. */
async function readStockHistoryFrontierSnapshot({manager,branchId,terminalId,assertCurrent,assertLease}={}){
 if(typeof assertCurrent!=='function'||typeof assertLease!=='function'||!manager?.pool||typeof manager.sql!=='function')fail();
 const branch=contract.identifier(branchId),terminal=contract.identifier(terminalId),pool=manager.pool,sql=manager.sql();
 if(/[\u0000-\u001f\u007f]/u.test(branch+terminal))fail();
 const started=performance.now();let connection,config,ownsTransaction=false,released=false,guardFailure=null;
 const guard=()=>{
  try{
   if(manager.pool!==pool)fail('ESTOCK_HISTORY_CONTEXT_CHANGED');
   for(const check of [assertCurrent,assertLease]){const value=check();if(value===false||value&&typeof value.then==='function')fail('ESTOCK_HISTORY_CONTEXT_CHANGED');}
  }catch(error){guardFailure=error;throw error;}
  if(performance.now()-started>MAX_MILLISECONDS)fail('ESTOCK_FRONTIER_TIMEOUT');
 };
 const parent={config:pool.config,connected:pool.connected??true,acquire(_request,callback){queueMicrotask(()=>callback(null,connection,config));},release(){}};
 const release=()=>{if(connection&&!released){released=true;pool.release(connection);}};
 const raw=async(text,parameters={})=>{
  const request=new sql.Request(parent,{requestTimeout:REQUEST_MILLISECONDS});
  for(const [name,value]of Object.entries(parameters))request.input(name,sql.NVarChar(128),value);
  if(Object.hasOwn(parameters,'branch'))request.input('canonical_uuid',sql.Bit,/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(branch));
  return request.query(text);
 };
 const query=async(text,parameters={})=>{guard();const result=await raw(text,parameters);guard();return result.recordset??[];};
 try{
  guard();
  let abandoned=false,timer;
  try{
   await Promise.race([
    new Promise((resolve,reject)=>pool.acquire(parent,(error,value,settings)=>{
     if(error)return reject(error);connection=value;config=settings;
     if(abandoned){release();return resolve();}resolve();
    })),
    new Promise((_,reject)=>{timer=setTimeout(()=>{abandoned=true;reject(Object.assign(new Error('Bounded pool wait'),{code:'ESTOCK_FRONTIER_BUSY'}));},REQUEST_MILLISECONDS);}),
   ]);
  }finally{clearTimeout(timer);}
  guard();
  // No FROM: this guard itself cannot start an implicit transaction.
  const initial=(await query('/*stock-frontier:session*/ SELECT CONVERT(nvarchar(20),@@TRANCOUNT) transaction_count,CONVERT(nvarchar(20),@@OPTIONS) session_options;'))[0];
  if(!initial||count(initial.transaction_count)!=='0'||(BigInt(count(initial.session_options))&2n)!==0n)return unavailable('FRONTIER_CALLER_TRANSACTION');
  ownsTransaction=true;await query('/*stock-frontier:begin*/ BEGIN TRANSACTION;');
  class BoundedRequest extends sql.Request{
   constructor(owner){super(owner,{requestTimeout:REQUEST_MILLISECONDS});}
   async query(text){guard();const result=await super.query(text);guard();
    if((result.recordset?.length??0)>10000||Buffer.byteLength(JSON.stringify(result.recordset??[]),'utf8')>MAX_BYTES)fail('ESTOCK_FRONTIER_BOUNDS');return result;}
  }
  const store=new StockHistoryStore({pool,sql:()=>({Request:BoundedRequest})},{assertCurrent:guard});
  const capability=await store.capability(parent);guard();
  if(!capability.available){await raw('ROLLBACK TRANSACTION;');ownsTransaction=false;guard();return unavailable(capability.reason);}
  const databaseKey=exactText(capability.databaseKey),databaseId=contract.identifier(databaseKey.slice(0,36),true);
  const heads=await query(`/*stock-frontier:head*/ SELECT TOP(2) h.store_id,h.coverage_state,
   LOWER(CONVERT(nvarchar(36),h.baseline_id)) baseline_id,CONVERT(nvarchar(30),h.coverage_generation) coverage_generation,
   b.verification_state baseline_state,b.evidence_hash baseline_hash
   FROM dbo.stock_history_heads h WITH(HOLDLOCK,NOWAIT)
   LEFT JOIN dbo.stock_history_baselines b WITH(HOLDLOCK,NOWAIT) ON b.id=h.baseline_id
    AND CONVERT(varbinary(max),${canonicalColumn('b.store_id')})=CONVERT(varbinary(max),${canonicalColumn('h.store_id')}) WHERE ${binary('h.store_id')};`,{branch});
  const sources=await query(sourceSql,{branch}),movements=await query(movementSql,{branch}),journal=await query(journalSql,{branch});
  if(heads.length>1||[sources,movements,journal].some(rows=>rows.length>MAX_ROWS))fail('ESTOCK_FRONTIER_BOUNDS');
  let bytes=Buffer.byteLength(JSON.stringify([heads,sources,movements,journal]),'utf8');
  for(const row of [...sources,...movements])bytes+=row.proof_bytes===null?0:Number(count(row.proof_bytes));
  if(!Number.isSafeInteger(bytes)||bytes>MAX_BYTES)fail('ESTOCK_FRONTIER_BOUNDS');
  const sourceProofs=await query(`/*stock-frontier:source-hashes*/ SELECT LOWER(CONVERT(nvarchar(36),id)) id,${proofHash('proof_json')} proof_hash
   FROM dbo.stock_history_source_cohorts WITH(HOLDLOCK,NOWAIT) WHERE ${scope} ORDER BY id;`,{branch});
  const movementProofs=await query(`/*stock-frontier:movement-hashes*/ SELECT LOWER(CONVERT(nvarchar(36),id)) id,${proofHash('author_proof_json')} proof_hash
   FROM dbo.stock_history_movements WITH(HOLDLOCK,NOWAIT) WHERE ${scope} ORDER BY id;`,{branch});
  if(sourceProofs.length!==sources.length||movementProofs.length!==movements.length)fail();
  const proofMap=rows=>{const map=new Map();for(const row of rows){const id=contract.identifier(row.id,true);if(map.has(id))fail();map.set(id,nullableHash(row.proof_hash));}return map;};
  const sourceHashes=proofMap(sourceProofs),movementHashes=proofMap(movementProofs),gaps=new Map();
  const gap=(code,evidence)=>{const value=[code,evidence];gaps.set(JSON.stringify(value),value);};
  const sourceFingerprints=[],movementFingerprints=[],journalFingerprints=[],streams=new Map(),sourceOperations=new Set(),movementIds=new Set();
  let business=0n,metadata=0n,unsigned=0n;
  if(heads.length!==1||heads[0].coverage_state!=='complete'||!heads[0].baseline_id||heads[0].baseline_state!=='verified')
   gap('LOCAL_COVERAGE_UNPROVEN',hash(heads));
  for(const row of sources){
   const id=contract.identifier(row.id,true),operation=contract.identifier(row.operation_id,true),database=contract.identifier(row.database_guid,true);
   const till=contract.identifier(row.terminal_id),sequence=count(row.source_sequence),root=nullableHash(row.source_root),previous=nullableHash(row.predecessor_root);
   if(contract.identifier(row.store_id)!==branch||!root||sequence==='0'||!sourceHashes.has(id))fail();
   const batch=nullableId(row.accepted_batch_id),transaction=row.accepted_transaction_id===null?null:count(row.accepted_transaction_id);
   const accepted=row.accepted_at===null?null:contract.canonicalInstant(row.accepted_at);
   const proof=sourceHashes.get(id);if((Number(row.unsigned)===1)!==(proof===null))fail();
   const fingerprint=[id,operation,database,till,sequence,root,previous,nullableHash(row.payload_hash),proof,batch,transaction,accepted];
   sourceFingerprints.push(fingerprint);sourceOperations.add(JSON.stringify([operation,till]));
   if(proof===null){unsigned++;gap('UNSIGNED_SOURCE',id);}
   if(batch===null){metadata++;if(till!==terminal)gap('OTHER_TERMINAL_PENDING_SOURCE',id);}
   if(database!==databaseId)gap('RETAINED_DATABASE_GENERATION',id);
   const streamKey=JSON.stringify([database,till]),stream=streams.get(streamKey)??[];stream.push({sequence,root,previous,id});streams.set(streamKey,stream);
  }
  for(const stream of streams.values()){
   stream.sort((left,right)=>BigInt(left.sequence)<BigInt(right.sequence)?-1:BigInt(left.sequence)>BigInt(right.sequence)?1:0);
   for(let index=0;index<stream.length;index++)if(BigInt(stream[index].sequence)!==BigInt(index)+1n||stream[index].previous!==(index?stream[index-1].root:null))gap('BROKEN_SOURCE_PREFIX',stream[index].id);
  }
  for(const row of movements){
   const id=contract.identifier(row.id,true),operation=contract.identifier(row.operation_id,true),product=contract.identifier(row.product_id,true),till=contract.identifier(row.terminal_id);
   const cursor=row.ingested_cursor===null?null:count(row.ingested_cursor),proof=movementHashes.get(id);
   if(contract.identifier(row.store_id)!==branch||!movementHashes.has(id)||movementIds.has(id)||(Number(row.unsigned)===1)!==(proof===null))fail();
   movementIds.add(id);movementFingerprints.push([id,operation,product,till,nullableHash(row.payload_hash),proof,cursor]);
   if(proof===null){unsigned++;gap('UNSIGNED_MOVEMENT',id);}
   if(cursor===null){metadata++;if(till!==terminal)gap('OTHER_TERMINAL_PENDING_MOVEMENT',id);}
   if(!sourceOperations.has(JSON.stringify([operation,till])))gap('UNPROVEN_ORIGINAL_SOURCE',id);
   if(!contract.KINDS.has(row.source_kind)||row.source_kind==='general')gap('UNKNOWN_STOCK_WRITER',id);
  }
  for(const row of journal){
   const id=count(row.change_id),entity=exactText(row.entity_type),entityId=exactText(row.entity_id),operation=exactText(row.operation),branchCode=exactText(row.branch_id);
   if(contract.identifier(branchCode)!==branch&&branchCode!=='global')fail();
   const version=count(row.entity_version),aggregate=nullableId(row.aggregate_id),failed=Number(row.failed)===1;
   const fingerprint=[id,entity,entityId,operation,branchCode,version,aggregate,failed];journalFingerprints.push(fingerprint);
   if(entity==='stock_history_movements'||entity==='stock_history_source_cohorts'){
    let referenced=null;try{referenced=contract.identifier(JSON.parse(entityId).id,true);}catch{/* Unknown journal shapes are held, never ignored. */}
    const exists=entity==='stock_history_movements'?movementIds.has(referenced):sources.some(source=>source.id===referenced);
    if(!exists){metadata++;gap('ORPHAN_HISTORY_JOURNAL',hash(fingerprint));}
    if(failed)gap('HISTORY_UPLOAD_FAILED',hash(fingerprint));
   }else business++;
  }
  for(const rows of [sourceFingerprints,movementFingerprints,journalFingerprints])rows.sort((a,b)=>JSON.stringify(a)<JSON.stringify(b)?-1:JSON.stringify(a)>JSON.stringify(b)?1:0);
  const current=streams.get(JSON.stringify([databaseId,terminal]))??[],last=current.at(-1);
  const clock=(await query("/*stock-frontier:clock*/ SELECT CONVERT(nvarchar(40),SYSUTCDATETIME(),127)+N'Z' observed_at;"))[0];
  const observedAt=contract.canonicalInstant(clock?.observed_at);
  if(await store.identity(parent)!==databaseKey)fail('ESTOCK_HISTORY_CONTEXT_CHANGED');guard();
  const diagnostics=[...gaps.values()].sort((a,b)=>JSON.stringify(a)<JSON.stringify(b)?-1:JSON.stringify(a)>JSON.stringify(b)?1:0);
  const result=Object.freeze({available:true,databaseId,databaseKey,branchId:branch,terminalId:terminal,observedAt,
   sourceSequence:last?.sequence??'0',sourceRoot:last?.root??null,
   sourceGeneration:hash(['stock-history.frontier-state.v1',databaseKey,branch,terminal,sourceFingerprints,movementFingerprints,journalFingerprints]),
   gapHash:hash(diagnostics),pending:Object.freeze({business:String(business),metadata:String(metadata),unsigned:String(unsigned),unknown:String(diagnostics.length)}),
   blockers:Object.freeze([...new Set(diagnostics.map(value=>value[0]))].sort()),coverageProven:false});
  await query('/*stock-frontier:commit*/ COMMIT TRANSACTION;');ownsTransaction=false;guard();return result;
 }catch(error){
  if(ownsTransaction){try{await raw('IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;');ownsTransaction=false;}catch{
   // Never return an uncertain open transaction to other business requests.
   connection.hasError=true;
   if(typeof connection.close==='function')await new Promise(resolve=>connection.close(()=>resolve()));
   ownsTransaction=false;
  }}
  if(guardFailure)throw guardFailure;
  if(error?.code==='ESTOCK_HISTORY_CONTEXT_CHANGED')throw error;
  const number=error?.number??error?.originalError?.info?.number;
  return unavailable(error?.code==='ESTOCK_FRONTIER_BOUNDS'?'FRONTIER_EVIDENCE_OVERSIZED':error?.code==='ESTOCK_FRONTIER_BUSY'||number===1222||number===1205?'FRONTIER_BUSY':'FRONTIER_READ_UNAVAILABLE');
 }finally{release();}
}
module.exports={readStockHistoryFrontierSnapshot};
