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
// Canonicalize UUID spelling only. Non-UUID till codes (including case and
// length) remain binary identities; SQL's ordinary padded equality is unsafe.
const tillKey=column=>`CONVERT(varbinary(256),CASE WHEN DATALENGTH(${column})=72 AND LOWER(${column}) COLLATE Latin1_General_100_BIN2=LOWER(CONVERT(nvarchar(36),TRY_CONVERT(uniqueidentifier,${column}))) COLLATE Latin1_General_100_BIN2 THEN LOWER(${column}) ELSE ${column} END)`;
const proofHash=column=>`LOWER(CONVERT(varchar(64),HASHBYTES('SHA2_256',CONVERT(varchar(max),${column} COLLATE Latin1_General_100_BIN2_UTF8)),2))`;
const digest=expression=>`LOWER(CONVERT(varchar(64),HASHBYTES('SHA2_256',${expression}),2))`;
const originalExists=`EXISTS(SELECT 1 FROM dbo.stock_history_source_cohorts s WITH(HOLDLOCK,NOWAIT)
 WHERE s.operation_id=m.operation_id AND ${binary('s.store_id')} AND ${tillKey('s.terminal_id')}=${tillKey('m.terminal_id')})`;
const knownKinds=[...contract.KINDS].filter(kind=>kind!=='general').map(kind=>`N'${kind}'`).join(',');
const sourceSummarySql=`/*stock-frontier:source-summary*/ WITH facts AS(SELECT s.*,
 ${tillKey('terminal_id')} till_key,
 ${digest("CONCAT(CONVERT(varchar(36),id),'|',CONVERT(varchar(36),operation_id),'|',CONVERT(varchar(30),source_sequence),'|',source_root,'|',COALESCE(predecessor_root,'!'),'|',payload_hash,'|',CASE WHEN proof_json IS NULL THEN '0' ELSE '1' END,'|',COALESCE(CONVERT(varchar(36),accepted_batch_id),'!'),'|',COALESCE(CONVERT(varchar(30),accepted_transaction_id),'!'),'|',COALESCE(CONVERT(varchar(40),SWITCHOFFSET(accepted_at,'+00:00'),127),'!'))")} row_hash
 FROM dbo.stock_history_source_cohorts s WITH(HOLDLOCK,NOWAIT) WHERE ${scope}),
 ordered AS(SELECT *,ROW_NUMBER()OVER(PARTITION BY database_guid,till_key ORDER BY source_sequence,id) ordinal,
 ROW_NUMBER()OVER(PARTITION BY database_guid,till_key ORDER BY source_sequence DESC,id DESC) last_ordinal,
 LAG(source_root)OVER(PARTITION BY database_guid,till_key ORDER BY source_sequence,id) previous FROM facts)
 SELECT TOP(${MAX_ROWS+1}) LOWER(CONVERT(nvarchar(36),database_guid)) database_id,CONVERT(nvarchar(128),till_key) terminal_id,
 CONVERT(nvarchar(30),COUNT_BIG(*)) row_count,CONVERT(nvarchar(30),COUNT_BIG(DISTINCT source_sequence)) unique_count,
 CONVERT(nvarchar(30),MIN(source_sequence)) min_sequence,CONVERT(nvarchar(30),MAX(source_sequence)) max_sequence,
 MAX(CASE WHEN last_ordinal=1 THEN source_root END) last_root,
 CONVERT(nvarchar(30),SUM(CONVERT(bigint,CASE WHEN accepted_batch_id IS NOT NULL THEN 1 ELSE 0 END))) accepted_count,
 CONVERT(nvarchar(30),SUM(CONVERT(bigint,CASE WHEN proof_json IS NULL THEN 1 ELSE 0 END))) unsigned_count,
 CONVERT(nvarchar(30),SUM(CONVERT(bigint,CASE WHEN source_sequence<>ordinal OR
  (predecessor_root IS NULL AND previous IS NOT NULL) OR (predecessor_root IS NOT NULL AND previous IS NULL) OR
  CONVERT(varbinary(64),predecessor_root)<>CONVERT(varbinary(64),previous) THEN 1 ELSE 0 END))) broken_count,
 ${digest("STRING_AGG(CONVERT(varchar(max),row_hash),'') WITHIN GROUP(ORDER BY source_sequence,id)")} evidence_hash
 FROM ordered GROUP BY database_guid,till_key ORDER BY database_guid,till_key;`;
const movementSummarySql=`/*stock-frontier:movement-summary*/ WITH facts AS(SELECT m.*,${tillKey('m.terminal_id')} till_key,
 CASE WHEN ${originalExists} THEN 0 ELSE 1 END missing_source,
 ${digest("CONCAT(CONVERT(varchar(36),m.id),'|',CONVERT(varchar(36),m.operation_id),'|',CONVERT(varchar(36),m.product_id),'|',m.payload_hash,'|',CASE WHEN m.author_proof_json IS NULL THEN '0' ELSE '1' END,'|',COALESCE(CONVERT(varchar(30),m.ingested_cursor),'!'))")} row_hash
 FROM dbo.stock_history_movements m WITH(HOLDLOCK,NOWAIT) WHERE ${binary('m.store_id')})
 SELECT TOP(${MAX_ROWS+1}) CONVERT(nvarchar(128),till_key) terminal_id,CONVERT(nvarchar(30),COUNT_BIG(*)) row_count,
 CONVERT(nvarchar(30),SUM(CONVERT(bigint,CASE WHEN ingested_cursor IS NOT NULL THEN 1 ELSE 0 END))) accepted_count,
 CONVERT(nvarchar(30),SUM(CONVERT(bigint,CASE WHEN author_proof_json IS NULL THEN 1 ELSE 0 END))) unsigned_count,
 CONVERT(nvarchar(30),SUM(CONVERT(bigint,missing_source))) missing_source_count,
 CONVERT(nvarchar(30),SUM(CONVERT(bigint,CASE WHEN source_kind COLLATE Latin1_General_100_BIN2 NOT IN(${knownKinds}) OR
  DATALENGTH(source_kind)<>2*LEN(source_kind) THEN 1 ELSE 0 END))) unknown_kind_count,
 ${digest("STRING_AGG(CONVERT(varchar(max),row_hash),'') WITHIN GROUP(ORDER BY id)")} evidence_hash
 FROM facts GROUP BY till_key ORDER BY till_key;`;
const requestColumns=`CONVERT(nvarchar(30),DATALENGTH(proof_json)) proof_bytes`;
const sourceSql=`/*stock-frontier:sources*/ SELECT TOP(${MAX_ROWS+1})
 LOWER(CONVERT(nvarchar(36),id)) id,LOWER(CONVERT(nvarchar(36),operation_id)) operation_id,
 store_id,terminal_id,LOWER(CONVERT(nvarchar(36),database_guid)) database_guid,
 CONVERT(nvarchar(30),source_sequence) source_sequence,source_root,predecessor_root,payload_hash,
 ${requestColumns},CASE WHEN proof_json IS NULL THEN 1 ELSE 0 END unsigned,
 LOWER(CONVERT(nvarchar(36),accepted_batch_id)) accepted_batch_id,
 CONVERT(nvarchar(30),accepted_transaction_id) accepted_transaction_id,
 CASE WHEN accepted_at IS NULL THEN NULL ELSE CONVERT(nvarchar(40),SWITCHOFFSET(accepted_at,'+00:00'),127) END accepted_at
 FROM dbo.stock_history_source_cohorts WITH(HOLDLOCK,NOWAIT) WHERE ${scope} AND(accepted_batch_id IS NULL OR proof_json IS NULL)
 ORDER BY database_guid,CONVERT(varbinary(256),terminal_id),source_sequence;`;
const movementSql=`/*stock-frontier:movements*/ SELECT TOP(${MAX_ROWS+1})
 LOWER(CONVERT(nvarchar(36),id)) id,LOWER(CONVERT(nvarchar(36),operation_id)) operation_id,
 LOWER(CONVERT(nvarchar(36),product_id)) product_id,store_id,terminal_id,source_kind,payload_hash,
 CONVERT(nvarchar(30),DATALENGTH(author_proof_json)) proof_bytes,
 CASE WHEN author_proof_json IS NULL THEN 1 ELSE 0 END unsigned,
 CONVERT(nvarchar(30),ingested_cursor) ingested_cursor,
 LOWER(CONVERT(nvarchar(36),upload_aggregate_id)) upload_aggregate_id
 FROM dbo.stock_history_movements WITH(HOLDLOCK,NOWAIT) WHERE ${scope} AND(ingested_cursor IS NULL OR author_proof_json IS NULL) ORDER BY id;`;
const journalSql=`/*stock-frontier:journal*/ SELECT TOP(${MAX_ROWS+1})
 CONVERT(nvarchar(30),j.change_id) change_id,j.entity_type,j.entity_id,j.operation,j.branch_id,
 CONVERT(nvarchar(30),j.entity_version) entity_version,LOWER(CONVERT(nvarchar(36),j.aggregate_id)) aggregate_id,
 CASE WHEN j.last_error IS NULL THEN 0 ELSE 1 END failed,r.reference_table,
 LOWER(CONVERT(nvarchar(36),r.id)) reference_id,LOWER(CONVERT(nvarchar(36),r.operation_id)) reference_operation_id,
 r.store_id reference_store_id,r.terminal_id reference_terminal_id,
 LOWER(CONVERT(nvarchar(36),r.upload_aggregate_id)) reference_upload_aggregate_id,r.pending reference_pending
 FROM dbo.sync_change_journal j WITH(HOLDLOCK,NOWAIT)
 OUTER APPLY(
  SELECT N'stock_history_movements' reference_table,m.id,m.operation_id,m.store_id COLLATE Latin1_General_100_BIN2 store_id,m.terminal_id COLLATE Latin1_General_100_BIN2 terminal_id,m.upload_aggregate_id,
   CASE WHEN m.ingested_cursor IS NULL THEN 1 ELSE 0 END pending FROM dbo.stock_history_movements m WITH(HOLDLOCK,NOWAIT)
  WHERE CONVERT(varbinary(max),j.entity_type)=CONVERT(varbinary(max),N'stock_history_movements') AND
   m.id=TRY_CONVERT(uniqueidentifier,CASE WHEN ISJSON(j.entity_id)=1 THEN JSON_VALUE(j.entity_id,'$.id') END) AND ${binary('m.store_id')}
  UNION ALL
  SELECT N'stock_history_source_cohorts',s.id,s.operation_id,s.store_id COLLATE Latin1_General_100_BIN2,s.terminal_id COLLATE Latin1_General_100_BIN2,s.upload_aggregate_id,
   CASE WHEN s.accepted_batch_id IS NULL THEN 1 ELSE 0 END FROM dbo.stock_history_source_cohorts s WITH(HOLDLOCK,NOWAIT)
  WHERE CONVERT(varbinary(max),j.entity_type)=CONVERT(varbinary(max),N'stock_history_source_cohorts') AND
   s.id=TRY_CONVERT(uniqueidentifier,CASE WHEN ISJSON(j.entity_id)=1 THEN JSON_VALUE(j.entity_id,'$.id') END) AND ${binary('s.store_id')}
 ) r
 WHERE j.acknowledged_at IS NULL AND (${binary('j.branch_id')} OR CONVERT(varbinary(max),j.branch_id)=CONVERT(varbinary(max),N'global')) ORDER BY j.change_id;`;

/** One pinned connection, no session SETs. HOLDLOCK supplies serializable
 * semantics per data table even when the borrowed connection uses another
 * isolation level. NOWAIT makes this observer yield to contested business work.
 * Pending values count evidence objects, NOT the user-facing sync journal:
 * business=unACKed non-history or unverified history journal rows;
 * metadata=unaccepted cohorts plus uningested movements; unsigned=NULL proofs;
 * unknown=diagnostic evidence counts (aggregated per original stream). Finished
 * immutable rows are summarized/digested inside SQL without proof-body reads;
 * only pending/unsigned detail is materialized under the2000-row/byte bounds.
 * The verified031 immutable schema is required; summary counts or a highest
 * sequence alone never establish a linked source prefix or complete coverage. */
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
  const sourceSummaries=await query(sourceSummarySql,{branch}),movementSummaries=await query(movementSummarySql,{branch});
  const sources=await query(sourceSql,{branch}),movements=await query(movementSql,{branch}),journal=await query(journalSql,{branch});
  if(heads.length>1||[sourceSummaries,movementSummaries,sources,movements,journal].some(rows=>rows.length>MAX_ROWS))fail('ESTOCK_FRONTIER_BOUNDS');
  let bytes=Buffer.byteLength(JSON.stringify([heads,sourceSummaries,movementSummaries,sources,movements,journal]),'utf8');
  for(const row of [...sources,...movements])bytes+=row.proof_bytes===null?0:Number(count(row.proof_bytes));
  if(!Number.isSafeInteger(bytes)||bytes>MAX_BYTES)fail('ESTOCK_FRONTIER_BOUNDS');
  const sourceProofs=await query(`/*stock-frontier:source-hashes*/ SELECT LOWER(CONVERT(nvarchar(36),id)) id,${proofHash('proof_json')} proof_hash
   FROM dbo.stock_history_source_cohorts WITH(HOLDLOCK,NOWAIT) WHERE ${scope} AND(accepted_batch_id IS NULL OR proof_json IS NULL) ORDER BY id;`,{branch});
  const movementProofs=await query(`/*stock-frontier:movement-hashes*/ SELECT LOWER(CONVERT(nvarchar(36),id)) id,${proofHash('author_proof_json')} proof_hash
   FROM dbo.stock_history_movements WITH(HOLDLOCK,NOWAIT) WHERE ${scope} AND(ingested_cursor IS NULL OR author_proof_json IS NULL) ORDER BY id;`,{branch});
  if(sourceProofs.length!==sources.length||movementProofs.length!==movements.length)fail();
  const proofMap=rows=>{const map=new Map();for(const row of rows){const id=contract.identifier(row.id,true);if(map.has(id))fail();map.set(id,nullableHash(row.proof_hash));}return map;};
  const sourceHashes=proofMap(sourceProofs),movementHashes=proofMap(movementProofs),gaps=new Map();
  const gap=(code,evidence,weight=1n)=>{if(weight===0n)return;const value=[code,evidence,String(weight)];gaps.set(JSON.stringify(value),value);};
  const sourceFingerprints=[],movementFingerprints=[],journalFingerprints=[],streamFingerprints=[],movementSummaryFingerprints=[],streams=new Map();
  let business=0n,metadata=0n,unsigned=0n;
  if(heads.length!==1||heads[0].coverage_state!=='complete'||!heads[0].baseline_id||heads[0].baseline_state!=='verified')
   gap('LOCAL_COVERAGE_UNPROVEN',hash(heads));
  for(const row of sourceSummaries){
   const database=contract.identifier(row.database_id,true),till=contract.identifier(row.terminal_id),rows=count(row.row_count),unique=count(row.unique_count);
   const min=count(row.min_sequence),sequence=count(row.max_sequence),root=nullableHash(row.last_root),accepted=count(row.accepted_count),unproven=count(row.unsigned_count),broken=count(row.broken_count);
   if(rows==='0'||min==='0'||!root||BigInt(accepted)>BigInt(rows)||BigInt(unproven)>BigInt(rows)||BigInt(broken)>BigInt(rows))fail();
   const evidence=nullableHash(row.evidence_hash);if(!evidence)fail();
   const fingerprint=[database,till,rows,unique,min,sequence,root,accepted,unproven,broken,evidence],streamKey=JSON.stringify([database,till]);
   if(streams.has(streamKey))fail();streams.set(streamKey,{sequence,root});streamFingerprints.push(fingerprint);
   const pending=BigInt(rows)-BigInt(accepted);metadata+=pending;unsigned+=BigInt(unproven);
   gap('UNSIGNED_SOURCE',hash(fingerprint),BigInt(unproven));
   if(till!==terminal)gap('OTHER_TERMINAL_PENDING_SOURCE',hash(fingerprint),pending);
   if(database!==databaseId)gap('RETAINED_DATABASE_GENERATION',hash(fingerprint),BigInt(rows));
   const invalid=BigInt(broken)>0n?BigInt(broken):(min!=='1'||rows!==unique||rows!==sequence?1n:0n);
   gap('BROKEN_SOURCE_PREFIX',hash(fingerprint),invalid);
  }
  for(const row of movementSummaries){
   const till=contract.identifier(row.terminal_id),rows=count(row.row_count),accepted=count(row.accepted_count),unproven=count(row.unsigned_count),missing=count(row.missing_source_count),unknown=count(row.unknown_kind_count);
   const evidence=nullableHash(row.evidence_hash);if(rows==='0'||!evidence||[accepted,unproven,missing,unknown].some(value=>BigInt(value)>BigInt(rows)))fail();
   if(movementSummaryFingerprints.some(value=>value[0]===till))fail();
   const fingerprint=[till,rows,accepted,unproven,missing,unknown,evidence];movementSummaryFingerprints.push(fingerprint);
   const pending=BigInt(rows)-BigInt(accepted);metadata+=pending;unsigned+=BigInt(unproven);
   gap('UNSIGNED_MOVEMENT',hash(fingerprint),BigInt(unproven));
   if(till!==terminal)gap('OTHER_TERMINAL_PENDING_MOVEMENT',hash(fingerprint),pending);
   gap('UNPROVEN_ORIGINAL_SOURCE',hash(fingerprint),BigInt(missing));gap('UNKNOWN_STOCK_WRITER',hash(fingerprint),BigInt(unknown));
  }
  for(const row of sources){
   const id=contract.identifier(row.id,true),operation=contract.identifier(row.operation_id,true),database=contract.identifier(row.database_guid,true);
   const till=contract.identifier(row.terminal_id),sequence=count(row.source_sequence),root=nullableHash(row.source_root),previous=nullableHash(row.predecessor_root);
   if(contract.identifier(row.store_id)!==branch||!root||sequence==='0'||!sourceHashes.has(id))fail();
   const batch=nullableId(row.accepted_batch_id),transaction=row.accepted_transaction_id===null?null:count(row.accepted_transaction_id);
   const accepted=row.accepted_at===null?null:contract.canonicalInstant(row.accepted_at);
   const proof=sourceHashes.get(id);if((Number(row.unsigned)===1)!==(proof===null))fail();
   if(batch!==null&&proof!==null)fail();
   sourceFingerprints.push([id,operation,database,till,sequence,root,previous,nullableHash(row.payload_hash),proof,batch,transaction,accepted]);
  }
  for(const row of movements){
   const id=contract.identifier(row.id,true),operation=contract.identifier(row.operation_id,true),product=contract.identifier(row.product_id,true),till=contract.identifier(row.terminal_id);
   const cursor=row.ingested_cursor===null?null:count(row.ingested_cursor),proof=movementHashes.get(id);
   if(contract.identifier(row.store_id)!==branch||!movementHashes.has(id)||(Number(row.unsigned)===1)!==(proof===null)||(cursor!==null&&proof!==null))fail();
   movementFingerprints.push([id,operation,product,till,nullableHash(row.payload_hash),proof,cursor]);
  }
  for(const row of journal){
   const id=count(row.change_id),entity=exactText(row.entity_type),entityId=exactText(row.entity_id),operation=exactText(row.operation),branchCode=exactText(row.branch_id);
   if(contract.identifier(branchCode)!==branch&&branchCode!=='global')fail();
   const version=count(row.entity_version),aggregate=nullableId(row.aggregate_id),failed=Number(row.failed)===1;
   const fingerprint=[id,entity,entityId,operation,branchCode,version,aggregate,failed];journalFingerprints.push(fingerprint);
   if(entity==='stock_history_movements'||entity==='stock_history_source_cohorts'){
    // Existence is not acceptance. Every unACKed journal must either be the
    // exact still-pending row in its deterministic metadata namespace (already
    // counted by the summaries), or remain critical pending/unknown work.
    const reference=[row.reference_table,row.reference_id,row.reference_operation_id,row.reference_store_id,
     row.reference_terminal_id,row.reference_upload_aggregate_id,row.reference_pending];fingerprint.push(reference);
    let valid=false;
    try{
     // Also rejects duplicate/extra/escaped keys rather than letting JSON.parse
     // collapse an ambiguous entity identity into a supposedly trusted row.
     const match=/^\s*\{\s*"id"\s*:\s*"([0-9a-fA-F-]{36})"\s*\}\s*$/.exec(entityId);
     const referenced=match?contract.identifier(match[1],true):null,actualBranch=contract.identifier(row.reference_store_id);
     const actualOperation=contract.identifier(row.reference_operation_id,true),actualUpload=contract.identifier(row.reference_upload_aggregate_id,true);
     valid=referenced!==null&&row.reference_table===entity&&referenced===contract.identifier(row.reference_id,true)&&
      contract.identifier(branchCode)===branch&&actualBranch===branch&&contract.identifier(row.reference_terminal_id)===terminal&&
      aggregate===actualUpload&&actualUpload===contract.uploadAggregateId(actualOperation,actualBranch)&&operation==='insert'&&
      [0,1].includes(row.reference_pending);
    }catch{/* Unknown bindings are pending evidence, never silently skipped. */}
    if(!valid){business++;gap(row.reference_id?'HISTORY_JOURNAL_BINDING_UNVERIFIED':'ORPHAN_HISTORY_JOURNAL',hash(fingerprint));}
    else if(row.reference_pending!==1){business++;gap('ACKED_HISTORY_WITH_PENDING_JOURNAL',hash(fingerprint));}
    if(failed)gap('HISTORY_UPLOAD_FAILED',hash(fingerprint));
   }else business++;
  }
  for(const rows of [streamFingerprints,movementSummaryFingerprints,sourceFingerprints,movementFingerprints,journalFingerprints])rows.sort((a,b)=>JSON.stringify(a)<JSON.stringify(b)?-1:JSON.stringify(a)>JSON.stringify(b)?1:0);
  const last=streams.get(JSON.stringify([databaseId,terminal]));
  const clock=(await query("/*stock-frontier:clock*/ SELECT CONVERT(nvarchar(40),SYSUTCDATETIME(),127)+N'Z' observed_at;"))[0];
  const observedAt=contract.canonicalInstant(clock?.observed_at);
  if(await store.identity(parent)!==databaseKey)fail('ESTOCK_HISTORY_CONTEXT_CHANGED');guard();
  const diagnostics=[...gaps.values()].sort((a,b)=>JSON.stringify(a)<JSON.stringify(b)?-1:JSON.stringify(a)>JSON.stringify(b)?1:0);
  const result=Object.freeze({available:true,databaseId,databaseKey,branchId:branch,terminalId:terminal,observedAt,
   sourceSequence:last?.sequence??'0',sourceRoot:last?.root??null,
   sourceGeneration:hash(['stock-history.frontier-state.v1',databaseKey,branch,terminal,streamFingerprints,movementSummaryFingerprints,sourceFingerprints,movementFingerprints,journalFingerprints]),
   gapHash:hash(diagnostics),pending:Object.freeze({business:count(String(business)),metadata:count(String(metadata)),unsigned:count(String(unsigned)),unknown:count(String(diagnostics.reduce((total,value)=>total+BigInt(value[2]),0n)))}),
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
