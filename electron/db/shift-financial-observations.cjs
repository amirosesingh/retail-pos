// Verified observation math only. Callers must obtain inputs from the opaque
// actual HTTP witness and indexed immutable local versions, never an IPC list.
const crypto=require('node:crypto');
const {parseExactJson}=require('../sync/shift-recovery-exact.cjs');
const {calculateKnownTenderTotals}=require('../sync/shift-financial-math.cjs');
const {financialFact}=require('./shift-financial-operations.cjs');
const {normalizePublishedThrough}=require('../sync/financial-source-order.cjs');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const FACT_KEYS=['id','branchId','shiftId','totalAmount','paymentType','paymentsJson','discountAmount','isRefunded','rowVersion'];
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const canonicalJson=v=>JSON.stringify(canonical(v));
const sha=v=>crypto.createHash('sha256').update(v,'utf8').digest('hex');
const fail=(code='EFINANCIAL_OBSERVATION_CONFLICT')=>{throw Object.assign(new Error('The complete financial observation needs synchronization or review. Saved work remains intact.'),{code,table:'shifts'});};

function rawFact(row,scope){
 if(row===null)return null;if(!row||typeof row!=='object'||Array.isArray(row)||Object.keys(row).length!==FACT_KEYS.length||FACT_KEYS.some(k=>!Object.hasOwn(row,k))||row.branchId!==scope.branchId||row.shiftId!==scope.shiftId||!UUID.test(row.id))fail();
 financialFact(row);return Object.freeze(Object.fromEntries(FACT_KEYS.map(k=>[k,row[k]])));
}
const same=(a,b)=>a===null||b===null?a===b:canonicalJson(financialFact(a))===canonicalJson(financialFact(b));
function mergeFinancialObservation({serverBasisJson,versions,ownPublishedThrough}){
 calculateKnownTenderTotals(serverBasisJson);const server=parseExactJson(serverBasisJson,{maxBytes:6*1024*1024,maxDepth:64}),scope={branchId:server.branchId,shiftId:server.shiftId};
 const published=normalizePublishedThrough(ownPublishedThrough),selected=new Map();for(const input of server.inputs){const row=rawFact(input,scope);if(selected.has(row.id))fail();selected.set(row.id,row);}
 if(!Array.isArray(versions)||versions.length>40000)fail('EFINANCIAL_OBSERVATION_TOO_LARGE');
 const groups=new Map(),seen=new Set();
 for(const version of versions){
  if(!version||!UUID.test(version.saleId)||!UUID.test(version.operationId)||typeof version.sequence!=='string'||!/^[1-9][0-9]{0,18}$/.test(version.sequence)||BigInt(version.sequence)>9223372036854775807n)fail();
  if(BigInt(version.sequence)<=BigInt(published[version.saleId]??'0'))continue;
  const key=version.saleId+':'+version.sequence;if(seen.has(key))fail();seen.add(key);
  const before=rawFact(version.before,scope),after=rawFact(version.after,scope);if(before===null&&after===null||before&&before.id!==version.saleId||after&&after.id!==version.saleId)fail();
  if(!groups.has(version.saleId))groups.set(version.saleId,[]);groups.get(version.saleId).push({...version,before,after});
 }
 const pendingFrom={};
 for(const[id,chain]of groups){
  chain.sort((a,b)=>BigInt(a.sequence)<BigInt(b.sequence)?-1:1);
  for(let n=1;n<chain.length;n++)if(!same(chain[n-1].after,chain[n].before))fail();
  const observed=selected.get(id)??null,states=[chain[0].before,...chain.map(step=>step.after)];let matched=-1;
  for(let n=0;n<states.length;n++)if(same(states[n],observed))matched=n;
  if(matched<0)fail();
  if(matched===states.length-1)continue; // Fully seen: keep exact authoritative S bytes.
  const final=chain.at(-1).after;if(final===null)selected.delete(id);else selected.set(id,final);
  pendingFrom[id]=chain[matched].sequence;
 }
 if(selected.size>20000)fail('EFINANCIAL_OBSERVATION_TOO_LARGE');
 const facts=[...selected.values()].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0),pending=Object.fromEntries(Object.keys(pendingFrom).sort().map(id=>[id,pendingFrom[id]]));
 return Object.freeze({facts:Object.freeze(facts),pendingFrom:Object.freeze(pending),computedMergedHash:sha(canonicalJson(facts)),pendingFromHash:sha(canonicalJson(pending)),semanticHash:sha(canonicalJson(facts.map(financialFact))),branchId:scope.branchId,shiftId:scope.shiftId});
}
module.exports={mergeFinancialObservation,normalizePublishedThrough,canonicalFinancialObservationJson:canonicalJson};

// Main-only coordinator: obtains its own opaque HTTP witness. There is no API
// accepting a caller's row list, author flag, timestamp or fabricated baseline.
const inFlight=new WeakMap();
class ShiftFinancialObservations{
 constructor(store,{financialBases=null}={}){this.store=store;this.financialBases=financialBases;}
 async observe(scope){
  if(this.store?.enabled!==true)return null;let map=inFlight.get(this.store.manager);if(!map){map=new Map();inFlight.set(this.store.manager,map);}const key=canonicalJson(scope);
  if(map.has(key))return map.get(key);
  const work=(async()=>{for(let attempt=0;attempt<3;attempt++){const witness=await this.store.prepareCloudBasis(scope);try{return await this.save(witness,scope);}catch(error){if(error.code!=='EFINANCIAL_OBSERVATION_ORDER'||attempt===2)throw error;}}})();map.set(key,work);
  try{return await work;}finally{if(map.get(key)===work)map.delete(key);}
 }
 async verifyOperation(tx,id,scope,source,cache){
  if(cache.has(id))return cache.get(id);const s=this.store;
  const events=(await s.query(tx,'SELECT event_kind,payload_json,payload_hash,proof_json,CONVERT(nvarchar(30),sequence) sequence FROM dbo.pos_sync_shift_financial_events WITH(HOLDLOCK) WHERE branch_id=@branch AND shift_id=@shift AND terminal_id=@terminal AND operation_id=@operation;',{branch:scope.branchId,shift:scope.shiftId,terminal:scope.terminalId,operation:id})).recordset??[];
  if(events.length===1&&events[0].event_kind==='MUTATION'){
   const row=events[0],raw=row.payload_json;let proof;try{proof=require('../security/financial-author-protocol.cjs').normalizeFinancialAttestation(JSON.parse(row.proof_json));}catch{fail('EFINANCIAL_SOURCE_UNVERIFIED');}
   require('../sync/financial-history-ack.cjs').prepareFinancialHistory({kind:'MUTATION',...scope,operationId:id,sequence:row.sequence,payloadJson:raw,payloadHash:row.payload_hash,proof},scope.branchId,scope.terminalId);
   if(proof.projectOrigin!==source.projectOrigin)fail();
   const keys=(await s.query(tx,'SELECT key_id,public_key FROM dbo.pos_sync_shift_author_keys WHERE project_origin=@project AND terminal_id=@terminal AND author_id=@author;',{project:proof.projectOrigin,terminal:scope.terminalId,author:proof.authorId})).recordset??[];
   if(keys.length!==1||String(keys[0].key_id).toLowerCase()!==proof.keyId)fail('EFINANCIAL_SOURCE_UNVERIFIED');
   const {signature,...fields}=proof,{normalizeEnrollment}=require('../security/shift-author-protocol.cjs');normalizeEnrollment({version:1,algorithm:'Ed25519',keyId:proof.keyId,projectOrigin:proof.projectOrigin,terminalId:proof.terminalId,authorId:proof.authorId,publicKey:keys[0].public_key});
   const publicKey=crypto.createPublicKey({key:Buffer.from(keys[0].public_key,'base64url'),format:'der',type:'spki'});
   if(!crypto.verify(null,Buffer.from(require('../security/financial-author-protocol.cjs').financialOperationMessage(fields)),publicKey,Buffer.from(signature,'base64url')))fail('EFINANCIAL_SOURCE_UNVERIFIED');const payload=parseExactJson(raw,{maxBytes:6*1024*1024,maxDepth:64}),changes=new Map();for(const change of payload.changes){if(changes.has(change.saleId))fail();changes.set(change.saleId,change);}const saved={kind:'MUTATION',changes};cache.set(id,saved);return saved;
  }
  if(events.length===1&&events[0].event_kind==='CLOSING'&&this.financialBases){const saved=await this.financialBases.get(id,scope.branchId,tx);if(saved?.financialRequired===true&&saved.shiftFinancialBasis?.proof?.terminalId===scope.terminalId){const value={kind:'CLOSING'};cache.set(id,value);return value;}}
  // A completed exact OPEN may still have its ordinary journal ACK in flight.
  const openings=(await s.query(tx,"SELECT opening_payload_json,opening_payload_hash,proof_json FROM dbo.pos_sync_shift_financial_origins WHERE branch_id=@branch AND shift_id=@shift AND terminal_id=@terminal AND origin_kind='OPEN' AND local_aggregate_id=@operation;",{branch:scope.branchId,shift:scope.shiftId,terminal:scope.terminalId,operation:id})).recordset??[];
  if(openings.length===1){const row=openings[0],proof=JSON.parse(row.proof_json);require('../sync/financial-history-ack.cjs').prepareFinancialOpening({openingJson:row.opening_payload_json,proof},scope.branchId,scope.terminalId);if(sha(row.opening_payload_json)!==row.opening_payload_hash||proof.projectOrigin!==source.projectOrigin)fail();const keys=(await s.query(tx,'SELECT key_id,public_key FROM dbo.pos_sync_shift_author_keys WHERE project_origin=@project AND terminal_id=@terminal AND author_id=@author;',{project:proof.projectOrigin,terminal:scope.terminalId,author:proof.authorId})).recordset??[];if(keys.length!==1||String(keys[0].key_id).toLowerCase()!==proof.keyId)fail('EFINANCIAL_SOURCE_UNVERIFIED');const {signature,...fields}=proof;require('../security/shift-author-protocol.cjs').normalizeEnrollment({version:1,algorithm:'Ed25519',keyId:proof.keyId,projectOrigin:proof.projectOrigin,terminalId:proof.terminalId,authorId:proof.authorId,publicKey:keys[0].public_key});if(!crypto.verify(null,Buffer.from(require('../security/financial-author-protocol.cjs').financialOperationMessage(fields)),crypto.createPublicKey({key:Buffer.from(keys[0].public_key,'base64url'),format:'der',type:'spki'}),Buffer.from(signature,'base64url')))fail();const value={kind:'OPEN'};cache.set(id,value);return value;}
  const noops=(await s.query(tx,'SELECT payload_json,payload_hash,proof_json FROM dbo.pos_sync_shift_financial_noops WITH(HOLDLOCK) WHERE branch_id=@branch AND shift_id=@shift AND terminal_id=@terminal AND operation_id=@operation;',{branch:scope.branchId,shift:scope.shiftId,terminal:scope.terminalId,operation:id})).recordset??[];
  if(noops.length===1){
   let proof;try{proof=require('../security/financial-author-protocol.cjs').normalizeFinancialAttestation(JSON.parse(noops[0].proof_json));}catch{fail('EFINANCIAL_SOURCE_UNVERIFIED');}
   const keys=(await s.query(tx,'SELECT key_id,public_key FROM dbo.pos_sync_shift_author_keys WHERE project_origin=@project AND terminal_id=@terminal AND author_id=@author;',{project:source.projectOrigin,terminal:scope.terminalId,author:proof.authorId})).recordset??[];
   if(keys.length!==1||String(keys[0].key_id).toLowerCase()!==proof.keyId)fail('EFINANCIAL_SOURCE_UNVERIFIED');
   require('../security/shift-author-protocol.cjs').normalizeEnrollment({version:1,algorithm:'Ed25519',keyId:proof.keyId,projectOrigin:proof.projectOrigin,terminalId:proof.terminalId,authorId:proof.authorId,publicKey:keys[0].public_key});
   const publicKey=crypto.createPublicKey({key:Buffer.from(keys[0].public_key,'base64url'),format:'der',type:'spki'});
   const value=require('./shift-financial-noop.cjs').verifyNoopCapture(noops[0],{...scope,operationId:id},source.projectOrigin,publicKey);cache.set(id,value);return value;
  }
  fail('EFINANCIAL_LOCAL_PENDING');
 }
 async safety(tx,scope,source,cache){
  const s=this.store;if((await s.query(tx,"SELECT CASE WHEN OBJECT_ID(N'dbo.pos_jobs',N'U') IS NOT NULL THEN 1 ELSE 0 END ready;")).recordset?.[0]?.ready!==1)fail('EFINANCIAL_CACHE_UNVERIFIED');
  if((await s.query(tx,"SELECT TOP(1) job_id FROM dbo.pos_jobs WITH(HOLDLOCK) WHERE (branch_id=@branch OR branch_id IS NULL) AND status<>N'completed' AND (job_type LIKE N'bootstrap[_]%' OR job_type LIKE N'%recovery%' OR job_type LIKE N'%restore%');",{branch:scope.branchId})).recordset?.length)fail('EFINANCIAL_CACHE_UNVERIFIED');
  const evidence=[];
  for(const table of['shifts','sales','sale_items','payment_transactions','shift_cash_counts','shift_reconciliations','shift_close_events','shift_notifications','shift_variance_alerts']){
   const predicate=table==='shifts'?'source.id=@shift AND source.store_id=@branch':table==='sales'?'TRY_CONVERT(uniqueidentifier,source.shift_id)=@shift AND source.store_id=@branch':['sale_items','payment_transactions'].includes(table)?'EXISTS(SELECT 1 FROM dbo.sales parent WHERE parent.id=source.sale_id AND parent.store_id=@branch AND TRY_CONVERT(uniqueidentifier,parent.shift_id)=@shift)':'source.shift_id=@shift AND source.store_id=@branch';
   const pending=(await s.query(tx,`SELECT DISTINCT TOP(20001) journal.aggregate_id,journal.entity_id FROM dbo.sync_change_journal journal WITH(HOLDLOCK) WHERE journal.branch_id IN(@branch,'global') AND journal.entity_type=@entity AND journal.acknowledged_at IS NULL AND (EXISTS(SELECT 1 FROM dbo.[${table}] source WITH(HOLDLOCK) WHERE source.id=TRY_CONVERT(uniqueidentifier,JSON_VALUE(CASE WHEN ISJSON(journal.entity_id)=1 THEN journal.entity_id ELSE N'{}' END,'$.id')) AND (${predicate})) OR NOT EXISTS(SELECT 1 FROM dbo.[${table}] known WHERE known.id=TRY_CONVERT(uniqueidentifier,JSON_VALUE(CASE WHEN ISJSON(journal.entity_id)=1 THEN journal.entity_id ELSE N'{}' END,'$.id'))));`,{branch:scope.branchId,shift:scope.shiftId,entity:table})).recordset??[];
   if(pending.length>20000)fail('EFINANCIAL_OBSERVATION_TOO_LARGE');for(const row of pending){const id=String(row.aggregate_id??'').toLowerCase();if(!UUID.test(id)){let entity;try{entity=JSON.parse(row.entity_id)?.id;}catch{/* Unknown journal identity is not a signed start. */}if(!await this.startCovers(tx,table,entity,scope,source,cache))fail('EFINANCIAL_LOCAL_PENDING');}else await this.verifyOperation(tx,id,scope,source,cache);}
   const bounds=(await s.query(tx,`SELECT CONVERT(nvarchar(30),(SELECT TOP(1) change_tracking_version FROM dbo.sync_checkpoints WITH(HOLDLOCK) WHERE branch_id=@branch AND entity_type=@entity AND direction='push' AND organization_id='default')) checkpoint_version,CONVERT(nvarchar(30),CHANGE_TRACKING_MIN_VALID_VERSION(OBJECT_ID(@object))) minimum_version,CONVERT(nvarchar(30),CHANGE_TRACKING_CURRENT_VERSION()) current_version;`,{branch:scope.branchId,entity:table,object:'dbo.'+table})).recordset?.[0];
   const valid=v=>typeof v==='string'&&/^(0|[1-9][0-9]{0,18})$/.test(v)&&BigInt(v)<=9223372036854775807n;
   if(!bounds||!['checkpoint_version','minimum_version','current_version'].every(k=>valid(bounds[k]))||BigInt(bounds.checkpoint_version)<BigInt(bounds.minimum_version)||BigInt(bounds.checkpoint_version)>BigInt(bounds.current_version))fail('EFINANCIAL_CT_UNVERIFIED');
   const changes=(await s.query(tx,`DECLARE @baseline bigint=CONVERT(bigint,@since); SELECT TOP(20001) CT.id,CT.SYS_CHANGE_OPERATION operation FROM CHANGETABLE(CHANGES dbo.[${table}],@baseline) CT LEFT JOIN dbo.[${table}] source WITH(HOLDLOCK) ON source.id=CT.id WHERE (CT.SYS_CHANGE_CONTEXT IS NULL OR CT.SYS_CHANGE_CONTEXT<>0x434C4F5544) AND (CT.SYS_CHANGE_OPERATION='D' OR source.id IS NULL OR (${predicate}));`,{branch:scope.branchId,shift:scope.shiftId,since:bounds.checkpoint_version})).recordset??[];
   if(changes.length>20000)fail('EFINANCIAL_OBSERVATION_TOO_LARGE');
   for(const change of changes){if(change.operation==='D')fail('EFINANCIAL_CT_UNVERIFIED');const journals=(await s.query(tx,"SELECT DISTINCT aggregate_id FROM dbo.sync_change_journal WITH(HOLDLOCK) WHERE entity_type=@entity AND TRY_CONVERT(uniqueidentifier,JSON_VALUE(CASE WHEN ISJSON(entity_id)=1 THEN entity_id ELSE N'{}' END,'$.id'))=@id AND branch_id IN(@branch,'global');",{entity:table,id:change.id,branch:scope.branchId})).recordset??[];if(!journals.length&&!await this.startCovers(tx,table,change.id,scope,source,cache))fail('EFINANCIAL_CT_UNVERIFIED');for(const j of journals){const id=String(j.aggregate_id??'').toLowerCase();if(!UUID.test(id)){if(!await this.startCovers(tx,table,change.id,scope,source,cache))fail('EFINANCIAL_CT_UNVERIFIED');}else await this.verifyOperation(tx,id,scope,source,cache);}}
   evidence.push({table,...bounds});
  }return evidence;
 }
 async verifiedStart(tx,scope,source,cache){
  if(cache.has('START'))return cache.get('START');const s=this.store;
  const rows=(await s.query(tx,'SELECT proof_json FROM dbo.pos_sync_shift_closing_starts WITH(HOLDLOCK) WHERE branch_id=@branch AND shift_id=@shift;',{branch:scope.branchId,shift:scope.shiftId})).recordset??[];
  if(!rows.length){cache.set('START',null);return null;}if(rows.length!==1)fail('EFINANCIAL_SOURCE_UNVERIFIED');
  const proof=require('./shift-closing-start.cjs').parse(rows[0].proof_json,scope.branchId,scope.shiftId);if(proof.projectOrigin!==source.projectOrigin||proof.terminalId!==scope.terminalId)fail('EFINANCIAL_SOURCE_UNVERIFIED');
  const keys=(await s.query(tx,'SELECT key_id,public_key FROM dbo.pos_sync_shift_author_keys WHERE project_origin=@project AND terminal_id=@terminal AND author_id=@author;',{project:source.projectOrigin,terminal:scope.terminalId,author:proof.authorId})).recordset??[];
  if(keys.length!==1||String(keys[0].key_id).toLowerCase()!==proof.keyId)fail('EFINANCIAL_SOURCE_UNVERIFIED');
  const{signature,...fields}=proof,protocol=require('../security/shift-author-protocol.cjs');protocol.normalizeEnrollment({version:1,algorithm:'Ed25519',keyId:proof.keyId,projectOrigin:proof.projectOrigin,terminalId:proof.terminalId,authorId:proof.authorId,publicKey:keys[0].public_key});
  if(!crypto.verify(null,Buffer.from(protocol.closingStartMessage(fields)),crypto.createPublicKey({key:Buffer.from(keys[0].public_key,'base64url'),format:'der',type:'spki'}),Buffer.from(signature,'base64url')))fail('EFINANCIAL_SOURCE_UNVERIFIED');
  const parent=(await s.query(tx,'SELECT * FROM dbo.shifts WITH(HOLDLOCK) WHERE id=@shift AND store_id=@branch;',{branch:scope.branchId,shift:scope.shiftId})).recordset??[],events=(await s.query(tx,'SELECT * FROM dbo.shift_close_events WITH(HOLDLOCK) WHERE id=@event AND shift_id=@shift AND store_id=@branch;',{event:proof.eventId,branch:scope.branchId,shift:scope.shiftId})).recordset??[];
  if(parent.length!==1||events.length!==1||parent[0].state!=='CASH_COUNT_REQUIRED'||parent[0].status!=='OPEN'||parent[0].closed_at!==null)fail('EFINANCIAL_SOURCE_UNVERIFIED');
  const registry=require('./schema-registry.cjs').loadRegistry(),{toCloudRow}=require('../sync/row-codec.cjs'),project=(name,row)=>JSON.parse(JSON.stringify(toCloudRow(registry.tables.find(table=>table.cloudTable===name),row)));
  const graph=new Map([['shifts',[project('shifts',parent[0])]],['shift_close_events',[project('shift_close_events',events[0])]]]);require('./shift-closing-start.cjs').assertGraph(proof,graph);
  const payload=JSON.parse(proof.payloadJson);if(payload.event?.event!=='closing_started'||payload.event.from_state!=='ACTIVE'||payload.event.to_state!=='CASH_COUNT_REQUIRED'||payload.event.actor_name!==proof.subject||payload.event.actor_staff_id!==proof.subject||payload.parent.closing_started_by!==proof.subject)fail('EFINANCIAL_SOURCE_UNVERIFIED');
  const value={proof,parent:graph.get('shifts')[0]};cache.set('START',value);return value;
 }
 async startCovers(tx,table,id,scope,source,cache){
  if(!['shifts','shift_close_events'].includes(table)||!UUID.test(String(id??'').toLowerCase()))return false;
  const start=await this.verifiedStart(tx,scope,source,cache);return Boolean(start&&(table==='shifts'?String(id).toLowerCase()===scope.shiftId:String(id).toLowerCase()===start.proof.eventId));
 }
 async versions(tx,scope,source,cache){
  const rows=(await this.store.query(tx,`SELECT TOP(80001) v.sale_id,CONVERT(nvarchar(30),v.sequence) sequence,v.version_side,v.source_id,v.fact_json,v.fact_hash FROM dbo.pos_sync_shift_financial_versions v WITH(HOLDLOCK)
    LEFT JOIN OPENJSON(@published) p ON TRY_CONVERT(uniqueidentifier,p.[key])=v.sale_id
    WHERE v.branch_id=@branch AND v.shift_id=@shift AND v.terminal_id=@terminal AND v.version_side IN('BEFORE','AFTER') AND v.sequence>COALESCE(TRY_CONVERT(bigint,p.[value]),0)
    ORDER BY v.sequence,v.sale_id,v.version_side;`,{branch:scope.branchId,shift:scope.shiftId,terminal:scope.terminalId,published:JSON.stringify(source.ownPublishedThrough)})).recordset??[];
  if(rows.length>80000)fail('EFINANCIAL_OBSERVATION_TOO_LARGE');const groups=new Map();
  for(const row of rows){const id=String(row.source_id).toLowerCase(),event=await this.verifyOperation(tx,id,scope,source,cache);const raw=row.fact_json??'null';const change=event?.changes?.get(String(row.sale_id).toLowerCase()),expected=row.version_side==='BEFORE'?change?.before:change?.after;if(!change||canonicalJson(expected)!==raw)fail('EFINANCIAL_SOURCE_UNVERIFIED');if(sha(raw)!==row.fact_hash)fail('EFINANCIAL_SOURCE_UNVERIFIED');const key=String(row.sale_id).toLowerCase()+':'+row.sequence;if(!groups.has(key))groups.set(key,{saleId:String(row.sale_id).toLowerCase(),sequence:row.sequence,operationId:id});const version=groups.get(key),side=row.version_side==='BEFORE'?'before':'after';if(Object.hasOwn(version,side)||version.operationId!==id)fail();version[side]=JSON.parse(raw);}
  for(const version of groups.values())if(!Object.hasOwn(version,'before')||!Object.hasOwn(version,'after'))fail('EFINANCIAL_SOURCE_UNVERIFIED');return[...groups.values()];
 }
 async verifyParent(tx,scope,remote,source,cache){
  const rows=(await this.store.query(tx,"SELECT LOWER(CONVERT(nvarchar(36),id)) id,store_id,status,state,terminal_id,CONVERT(nvarchar(40),opened_at,127) opened_at,CONVERT(nvarchar(40),closed_at,127) closed_at FROM dbo.shifts WITH(HOLDLOCK) WHERE id=@shift AND store_id=@branch;",{branch:scope.branchId,shift:scope.shiftId})).recordset??[];
  const {timestampKey}=require('./shift-financial-operations.cjs'),state=r=>r.state??(r.closed_at?'CLOSED':'ACTIVE');
  const sameParent=(a,b)=>a&&b&&a.id===scope.shiftId&&b.id===scope.shiftId&&a.store_id===scope.branchId&&b.store_id===scope.branchId&&a.status===b.status&&state(a)===state(b)&&String(a.terminal_id??'')===String(b.terminal_id??'')&&timestampKey(a.opened_at)===timestampKey(b.opened_at)&&timestampKey(a.closed_at)===timestampKey(b.closed_at);
  if(rows.length!==1)fail('EFINANCIAL_PARENT_CONFLICT');if(sameParent(rows[0],remote.parentSnapshot))return;
  const closings=(await this.store.query(tx,"SELECT TOP(1) i.intent_id,i.payload_json,i.payload_hash FROM dbo.pos_sync_shift_intents i JOIN dbo.pos_sync_shift_financial_events e ON e.operation_id=i.intent_id AND e.branch_id=i.branch_id AND e.shift_id=i.shift_id AND e.terminal_id=@terminal AND e.event_kind='CLOSING' WHERE i.branch_id=@branch AND i.shift_id=@shift ORDER BY e.sequence DESC;",{branch:scope.branchId,shift:scope.shiftId,terminal:scope.terminalId})).recordset??[];
  if(!closings.length){const start=await this.verifiedStart(tx,scope,source,cache);if(start&&['ACTIVE','CASH_COUNT_REQUIRED'].includes(state(remote.parentSnapshot))&&remote.parentSnapshot.status==='OPEN'&&sameParent({...rows[0],state:state(remote.parentSnapshot)},remote.parentSnapshot))return;fail('EFINANCIAL_PARENT_CONFLICT');}
  if(closings.length!==1||sha(closings[0].payload_json)!==closings[0].payload_hash)fail('EFINANCIAL_PARENT_CONFLICT');await this.verifyOperation(tx,String(closings[0].intent_id).toLowerCase(),scope,source,cache);
  const graph=parseExactJson(closings[0].payload_json,{maxBytes:6*1024*1024,maxDepth:64}),parents=graph.operations?.find(op=>op.table==='shifts')?.rows??[];
  if(parents.length!==1||!sameParent(rows[0],parents[0]))fail('EFINANCIAL_PARENT_CONFLICT');
 }
 async save(witness,scope){
  const s=this.store,sql=s.manager.sql(),tx=new sql.Transaction(s.manager.pool);await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  try{
   await s.schema(tx);const source=require('../sync/cloud-client.cjs').readVerifiedFinancialBasis(witness,{connectionManager:s.manager,...scope});
   const database=(await s.query(tx,'SELECT LOWER(CONVERT(nvarchar(36),database_guid)) database_guid FROM sys.database_recovery_status WHERE database_id=DB_ID();')).recordset??[];if(database.length!==1||database[0].database_guid!==source.databaseGuid)fail('EFINANCIAL_SNAPSHOT_UNVERIFIED');
   const head=await s.lockHead(tx,scope);if(!head)fail('EFINANCIAL_ORIGIN_MISSING');
   const previous=(await s.query(tx,'SELECT TOP(1) source_evidence_json,pending_from_json,computed_merged_hash FROM dbo.pos_sync_shift_financial_refreshes WITH(HOLDLOCK) WHERE branch_id=@branch AND shift_id=@shift AND terminal_id=@terminal ORDER BY sequence DESC;',{branch:scope.branchId,shift:scope.shiftId,terminal:scope.terminalId})).recordset??[];
   let previousEvidence=previous[0]?JSON.parse(previous[0].source_evidence_json):null;
   if(!previousEvidence&&head.cloudOrigin){const origin=(await s.query(tx,'SELECT ct_witness_json FROM dbo.pos_sync_shift_financial_origins WHERE branch_id=@branch AND shift_id=@shift AND terminal_id=@terminal;',{branch:scope.branchId,shift:scope.shiftId,terminal:scope.terminalId})).recordset?.[0];previousEvidence=JSON.parse(origin.ct_witness_json).sourceEvidence;if(!previousEvidence)fail('EFINANCIAL_SNAPSHOT_UNVERIFIED');}
   if(previousEvidence)require('../sync/financial-source-order.cjs').assertFinancialSourceAfter(previousEvidence,source.sourceEvidence);
   const verified=new Map(),ct=await this.safety(tx,scope,source,verified),versions=await this.versions(tx,scope,source,verified),merged=mergeFinancialObservation({serverBasisJson:source.basisJson,versions,ownPublishedThrough:source.ownPublishedThrough});
   const localRaw=(await s.query(tx,require('node:fs').readFileSync(require('node:path').join(__dirname,'shift-financial-basis.sql'),'utf8'),{branch:scope.branchId,shift:scope.shiftId})).recordset?.[0]?.basis_json;
   calculateKnownTenderTotals(localRaw);const local=parseExactJson(localRaw,{maxBytes:6*1024*1024,maxDepth:64}),remote=parseExactJson(source.basisJson,{maxBytes:6*1024*1024,maxDepth:64});
   await this.verifyParent(tx,scope,remote,source,verified);
   if(require('../sync/shift-financial-math.cjs').exactFinancialDecimalKey(local.openingFloat??'0')!==require('../sync/shift-financial-math.cjs').exactFinancialDecimalKey(remote.openingFloat??'0'))fail();
   const actual=local.inputs.map(financialFact).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);if(sha(canonicalJson(actual))!==merged.semanticHash)fail('EFINANCIAL_SNAPSHOT_CONFLICT');
   const current=await s.knownRows(tx,scope),currentFacts=[...current.values()].filter(row=>row!==null).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
   if(sha(canonicalJson(currentFacts.map(financialFact)))===merged.semanticHash&&canonicalJson(JSON.parse(previous[0]?.pending_from_json??'{}'))===canonicalJson(merged.pendingFrom)){await tx.commit();return{status:'unchanged'};}
   const operationId=crypto.randomUUID(),origin=head.cloudOrigin?{cloudOrigin:head.cloudOrigin}:{openingOrigin:head.openingOrigin},payload={version:head.cloudOrigin?2:1,operationId,...scope,...origin,sequence:head.sequence,predecessorOperationId:head.prior.operationId,predecessorHash:head.prior.hash,action:'OBSERVE',observedBasis:{serverBasisId:source.serverBasisId,serverBasisHash:source.serverBasisHash}},raw=canonicalJson(payload);if(Buffer.byteLength(raw,'utf8')>16*1024)fail('EFINANCIAL_OBSERVATION_TOO_LARGE');
   require('../sync/cloud-client.cjs').readVerifiedFinancialBasis(witness,{connectionManager:s.manager,...scope});
   await s.query(tx,`INSERT dbo.pos_sync_shift_financial_refreshes(branch_id,shift_id,terminal_id,operation_id,sequence,server_basis_id,server_basis_hash,server_basis_json,source_evidence_json,publication_json,computed_merged_hash,pending_from_hash,pending_from_json,merged_facts_json,database_guid,ct_witness_json,created_at)
    VALUES(@branch,@shift,@terminal,@operation,CONVERT(bigint,@sequence),@basis,@basisHash,@basisJson,@evidence,@published,@mergedHash,@pendingHash,@pending,@facts,@database,@ct,SYSDATETIMEOFFSET());`,{branch:scope.branchId,shift:scope.shiftId,terminal:scope.terminalId,operation:operationId,sequence:head.sequence,basis:source.serverBasisId,basisHash:source.serverBasisHash,basisJson:source.basisJson,evidence:JSON.stringify(source.sourceEvidence),published:JSON.stringify(source.ownPublishedThrough),mergedHash:merged.computedMergedHash,pendingHash:merged.pendingFromHash,pending:canonicalJson(merged.pendingFrom),facts:canonicalJson(merged.facts),database:source.databaseGuid,ct:canonicalJson(ct)});
   const next=new Map(merged.facts.map(row=>[row.id,row]));await s.appendVersions(tx,scope,[...new Set([...current.keys(),...next.keys()])].map(saleId=>({saleId,sequence:head.sequence,side:'OBSERVED',sourceId:operationId,fact:next.get(saleId)??null})));
   await s.query(tx,"INSERT dbo.pos_sync_shift_financial_events(branch_id,shift_id,terminal_id,sequence,operation_id,event_kind,action,predecessor_hash,payload_json,payload_hash,proof_json) VALUES(@branch,@shift,@terminal,CONVERT(bigint,@sequence),@operation,'OBSERVE','OBSERVE',@previous,@raw,@hash,@proof); UPDATE dbo.pos_sync_shift_financial_heads SET sequence=CONVERT(bigint,@sequence),operation_id=@operation,payload_hash=@hash WHERE branch_id=@branch AND shift_id=@shift AND terminal_id=@terminal AND sequence=CONVERT(bigint,@priorSequence) AND operation_id=@priorOperation AND payload_hash=@previous; IF @@ROWCOUNT<>1 THROW 51026,'Financial frontier changed.',1;",{branch:scope.branchId,shift:scope.shiftId,terminal:scope.terminalId,operation:operationId,sequence:head.sequence,priorSequence:head.prior.sequence,priorOperation:head.prior.operationId,previous:head.prior.hash,raw,hash:sha(raw),proof:JSON.stringify(payload.observedBasis)});
   require('../sync/cloud-client.cjs').readVerifiedFinancialBasis(witness,{connectionManager:s.manager,...scope});await tx.commit();return{status:'recorded',operationId,sequence:head.sequence,computedMergedHash:merged.computedMergedHash,pendingFromHash:merged.pendingFromHash};
  }catch(error){await tx.rollback().catch(()=>{});throw error;}
 }
}
module.exports.ShiftFinancialObservations=ShiftFinancialObservations;
