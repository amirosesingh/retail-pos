// Main-only assembly. A schema, renderer flag or selected branch cannot enable it.
const{ShiftFinancialOperations}=require('./shift-financial-operations.cjs');
const{ShiftFinancialBases}=require('./shift-financial-bases.cjs');
const{ShiftFinancialObservations}=require('./shift-financial-observations.cjs');
const{createShiftFinancialDraftProvider}=require('./shift-financial-draft-adapter.cjs');
const{ShiftSyncJournal}=require('./shift-sync-journal.cjs');
const{AggregateRepository}=require('./repositories/aggregates.cjs');
const{ReceiptRepository}=require('./repositories/receipts.cjs');
const{ChangeReader}=require('../sync/change-reader.cjs');
const{PushWorker}=require('../sync/push-worker.cjs');
const crypto=require('node:crypto');
const fail=(code='EFINANCIAL_CAPABILITY_UNVERIFIED')=>{throw Object.assign(new Error('Financial synchronization must be verified before this action. Saved work remains intact.'),{code,table:'shifts'});};
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const networkError=error=>['ETIMEDOUT','ECONNRESET','ECONNREFUSED','EHOSTUNREACH','ENETUNREACH','EAI_AGAIN','UND_ERR_CONNECT_TIMEOUT','UND_ERR_SOCKET','ENOTFOUND'].includes(error?.code??error?.cause?.code)||error?.name==='TypeError'&&error?.message==='fetch failed';
const temporaryUnavailable=error=>networkError(error)||[502,503,504].includes(Number(error?.status))&&!['EFINANCIAL_CAPABILITY_UNVERIFIED','EFINANCIAL_CAPABILITY_UNAVAILABLE'].includes(error?.code);
const missingCapability=error=>{
 const source=error?.code==='ESHIFT_PROTOCOL_UNAVAILABLE'?error.cause:error;
 return(source?.code==='PGRST202'&&source?.status===404&&/^Could not find the function (?:public\.)?pos_sync_financial_capability\b/i.test(source.message??''))||
  (source?.code==='42883'&&/^function (?:public\.)?pos_sync_financial_capability\(/i.test(source.message??''))||
  (source?.status===400&&source?.code==='HTTP_400'&&source?.message==='Nothing to do');
};
function validatePending(authority,value,kind){
 const protocol=kind==='operation'?require('../security/financial-author-protocol.cjs'):require('../security/shift-financial-protocol.cjs');
 const opening=kind==='basis'&&Object.hasOwn(value??{},'openingOrigin');
 const proof=kind==='operation'?protocol.normalizeFinancialAttestation(value):opening?protocol.normalizeOpeningFinancialBasisAttestation(value):protocol.normalizeFinancialBasisAttestation(value);
 const binding=authority.binding(proof.authorId);if(binding.projectOrigin!==proof.projectOrigin||binding.terminalId!==proof.terminalId)fail('ESYNC_SHIFT_AUTHOR_BINDING_MISMATCH');
 const key=authority.keys.prepare(binding,{expectedKeyId:proof.keyId});if(!key.enrolled)fail('ESYNC_SHIFT_AUTHOR_ENROLLMENT_PENDING');
 const{signature,...fields}=proof,message=kind==='operation'?protocol.financialOperationMessage(fields):opening?protocol.openingFinancialBasisMessage(fields):protocol.financialBasisMessage(fields);
 if(!crypto.verify(null,Buffer.from(message),crypto.createPublicKey({key:Buffer.from(key.publicKey,'base64url'),format:'der',type:'spki'}),Buffer.from(signature,'base64url')))fail('ESYNC_SHIFT_AUTHOR_INVALID');return proof;
}
class ShiftFinancialRuntime{
 constructor({manager,cloud,terminal,authority,vault,operationsRepository,registry,checkpoints,legacy,uploadCashCheckout=null,uploadGroupedRefund=null}){
  Object.assign(this,{manager,cloud,terminal,authority,vault,operationsRepository,registry,checkpoints,legacy,uploadCashCheckout,uploadGroupedRefund});this.contexts=new Map();this.pending=new Map();
 }
 isManagement(){const terminal=this.terminal()??{};return terminal.deviceUse==='management'||terminal.deviceType==='management';}
 async footprint(branchId,terminalId){
  // Missing tables are ordinary old installations, not permission to ignore an
  // existing protected origin. Dynamic SQL avoids binding absent old objects.
  const result=await this.manager.pool.request().input('branch',branchId).input('terminal',terminalId).query(`DECLARE @present bit=0;
   IF OBJECT_ID(N'dbo.pos_sync_shift_financial_origins',N'U') IS NOT NULL EXEC sys.sp_executesql N'SELECT @found=CASE WHEN EXISTS(SELECT 1 FROM dbo.pos_sync_shift_financial_origins WHERE branch_id=@b AND terminal_id=@t) THEN 1 ELSE 0 END;',N'@b nvarchar(128),@t nvarchar(128),@found bit OUTPUT',@b=@branch,@t=@terminal,@found=@present OUTPUT;
   IF OBJECT_ID(N'dbo.pos_sync_shift_financial_bases',N'U') IS NOT NULL AND @present=0 EXEC sys.sp_executesql N'SELECT @found=CASE WHEN EXISTS(SELECT 1 FROM dbo.pos_sync_shift_financial_bases WHERE branch_id=@b) THEN 1 ELSE 0 END;',N'@b nvarchar(128),@found bit OUTPUT',@b=@branch,@found=@present OUTPUT;
   SELECT @present required;`);return result.recordset?.[0]?.required===true||result.recordset?.[0]?.required===1;
 }
 async localOrigin(branchId,shiftId,terminalId){
  if(!uuid(shiftId))return false;
  const result=await this.manager.pool.request().input('branch',branchId).input('terminal',terminalId).input('shift',shiftId).query(`DECLARE @present bit=0;
   IF OBJECT_ID(N'dbo.pos_sync_shift_financial_origins',N'U') IS NOT NULL EXEC sys.sp_executesql N'SELECT @found=CASE WHEN EXISTS(SELECT 1 FROM dbo.pos_sync_shift_financial_origins WHERE branch_id=@b AND shift_id=@s AND terminal_id=@t) THEN 1 ELSE 0 END;',N'@b nvarchar(128),@s uniqueidentifier,@t nvarchar(128),@found bit OUTPUT',@b=@branch,@s=@shift,@t=@terminal,@found=@present OUTPUT;
   SELECT @present required;`);return result.recordset?.[0]?.required===true||result.recordset?.[0]?.required===1;
 }
 async legacyOpening(branchId,shiftId,terminalId){
  const rows=(await this.manager.pool.request().input('branch',branchId).input('shift',shiftId).query("SELECT o.aggregate_id,o.row_json,o.row_hash,r.operation_type,r.entity_id,r.note,s.terminal_id FROM dbo.pos_sync_shift_openings o JOIN dbo.local_operation_receipts r ON r.operation_id=o.aggregate_id JOIN dbo.shifts s ON s.id=o.shift_id AND s.store_id=o.branch_id WHERE o.branch_id=@branch AND o.shift_id=@shift;")).recordset??[];
  if(rows.length!==1)return false;const row=rows[0];let opened;try{opened=JSON.parse(row.row_json);}catch{return false;}
  return row.operation_type==='shift'&&/^[a-f0-9]{64}$/.test(row.note??'')&&uuid(String(row.entity_id??'').toLowerCase())&&String(row.entity_id).toLowerCase()===String(row.aggregate_id).toLowerCase()&&crypto.createHash('sha256').update(row.row_json,'utf8').digest('hex')===row.row_hash&&opened.id===shiftId&&opened.store_id===branchId&&opened.terminal_id===terminalId&&row.terminal_id===terminalId&&opened.status==='OPEN'&&['ACTIVE',null,undefined].includes(opened.state)&&opened.closed_at===null;
 }
 async capability(branchId,shiftId=null){
  const source=await this.cloud.financialCapabilityIdentity(branchId,shiftId),scope={organizationId:'default',branchId,shiftId,terminalId:source.identity.terminalId,projectOrigin:source.identity.projectOrigin};
  const key=JSON.stringify([source.identity,shiftId]);if(this.pending.has(key))return this.pending.get(key);
  const work=(async()=>{
   const cached=this.vault.read(source.identity,scope),terminalCached=shiftId===null?cached:this.vault.read(source.identity,{...scope,shiftId:null});let descriptor,online=false;
   try{const token=await this.cloud.readFinancialCapability({organizationId:'default',branchId,shiftId});const verified=require('../sync/cloud-client.cjs').readVerifiedFinancialCapability(token,{connectionManager:this.manager,...scope});source.assertSource();if(JSON.stringify(verified.binding)!==JSON.stringify(source.identity))fail();descriptor=this.vault.save(source.identity,scope,verified.descriptor);if(shiftId!==null)this.vault.save(source.identity,{...scope,shiftId:null},{...descriptor,shiftId:null,shiftMode:null});online=true;}
   catch(error){
    if(temporaryUnavailable(error)&&terminalCached?.mode==='blocked')fail('EFINANCIAL_CAPABILITY_BLOCKED');
    if(temporaryUnavailable(error)&&shiftId!==null&&terminalCached?.mode==='required'&&(!cached||cached.mode!=='required'||cached.rolloutId!==terminalCached.rolloutId||BigInt(cached.revision)<BigInt(terminalCached.revision))){
     if(!await this.localOrigin(branchId,shiftId,scope.terminalId))throw error;
     descriptor=Object.freeze({...terminalCached,shiftId,shiftMode:'required'});
    }else if(temporaryUnavailable(error)&&cached?.mode==='required')descriptor=cached;
    else if(networkError(error)&&cached)descriptor=cached;
    else if((networkError(error)||missingCapability(error))&&![cached,terminalCached].some(value=>value&&value.mode!=='disabled')&&!await this.footprint(branchId,scope.terminalId)){source.assertSource();return{source,scope,descriptor:null,online:false,legacyCompatibility:true};}
    else throw error;
   }
   source.assertSource();if(descriptor.mode==='blocked')fail('EFINANCIAL_CAPABILITY_BLOCKED');
   if(descriptor.mode==='disabled'&&await this.footprint(branchId,scope.terminalId))fail('EFINANCIAL_CAPABILITY_DOWNGRADE');
   return{source,scope,descriptor,online};
  })();this.pending.set(key,work);try{return await work;}finally{if(this.pending.get(key)===work)this.pending.delete(key);}
 }
 async contextForTerminal(branchId,preparedCapability=null){
  if(this.isManagement())return null;
  const cap=preparedCapability??await this.capability(branchId);if(cap.descriptor?.mode!=='required')return null;
  const key=JSON.stringify(cap.source.identity);let context=this.contexts.get(key);
  if(context){context.assertCurrent();return{...context,online:cap.online,preparedCapability:cap};}
  const assertCurrent=()=>cap.source.assertSource();
  const guarded=target=>new Proxy(target,{get(object,property){assertCurrent();const value=Reflect.get(object,property);return typeof value==='function'?function(...args){assertCurrent();const out=value.apply(object,args);if(out&&typeof out.then==='function')return out.then(result=>{assertCurrent();return result;});assertCurrent();return out;}:value;}});
  const operations=guarded(new ShiftFinancialOperations(this.manager,{enabled:true,cloud:this.cloud,terminalId:()=>cap.scope.terminalId,resolveAuthor:()=>this.authority.prepare(this.authority.captureFinancialContext())}));
  const bases=guarded(new ShiftFinancialBases(this.manager,{enabled:true,financialOperations:operations,resolveOpeningOrigin:async({transaction,branchId,shiftId})=>{const rows=(await operations.query(transaction,"SELECT local_aggregate_id,row_hash FROM dbo.pos_sync_shift_financial_origins WHERE branch_id=@branch AND shift_id=@shift AND terminal_id=@terminal AND origin_kind='OPEN';",{branch:branchId,shift:shiftId,terminal:cap.scope.terminalId})).recordset??[];if(rows.length>1)fail();return rows.length?{openingOrigin:{localAggregateId:String(rows[0].local_aggregate_id).toLowerCase(),rowHash:rows[0].row_hash},versionReferences:[]}:null;}}));
  const sql=this.manager.sql(),tx=new sql.Transaction(this.manager.pool);await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);try{await operations.schema(tx);await bases.schema(tx);cap.source.assertSource();await tx.commit();}catch(error){await tx.rollback().catch(()=>{});throw error;}
  const reader=guarded(new ChangeReader(this.manager,this.registry,{financialBases:bases,financialOperations:operations,financialCoverageSource:cap.source}));
  const journal=guarded(new ShiftSyncJournal(this.operationsRepository,{authorRequired:true,financialBases:bases,financialOperations:operations}));
  const push=guarded(new PushWorker({reader,cloud:this.cloud,checkpoints:this.checkpoints,registry:this.registry,validateAuthor:proof=>this.authority.validatePending(proof),validateClosingStart:proof=>this.authority.validatePendingClosingStart(proof),validateFinancialBasis:proof=>validatePending(this.authority,proof,'basis'),validateFinancialOperation:proof=>validatePending(this.authority,proof,'operation'),financialHistoryEnabled:true,uploadCashCheckout:this.uploadCashCheckout,uploadGroupedRefund:this.uploadGroupedRefund}));
  context={source:cap.source,scope:cap.scope,operations,bases,reader,journal,push,assertCurrent,knowledge:new Map(),observer:new ShiftFinancialObservations(operations,{financialBases:bases}),draftProvider:createShiftFinancialDraftProvider(bases,{enabled:true}),aggregate:guarded(new AggregateRepository(this.manager,this.operationsRepository,{financialOperations:operations})),receipts:guarded(new ReceiptRepository(this.manager,this.cloud,{financialOperations:operations}))};
  this.contexts.set(key,context);return{...context,online:cap.online,preparedCapability:cap};
 }
 async knowledgeMatches(context,branchId,shiftId){
  const sql=this.manager.sql(),tx=new sql.Transaction(this.manager.pool),scope={branchId,shiftId,terminalId:context.scope.terminalId};await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  try{
   await context.operations.schema(tx);await context.operations.lockHead(tx,scope);
   const bounds=(await context.operations.query(tx,"SELECT CONVERT(nvarchar(30),CHANGE_TRACKING_CURRENT_VERSION()) current_version,CONVERT(nvarchar(30),CHANGE_TRACKING_MIN_VALID_VERSION(OBJECT_ID(N'dbo.sales'))) minimum_version,CONVERT(nvarchar(30),CHANGE_TRACKING_MIN_VALID_VERSION(OBJECT_ID(N'dbo.shifts'))) shift_minimum;",{})).recordset?.[0];
   const valid=value=>typeof value==='string'&&/^(0|[1-9][0-9]{0,18})$/.test(value)&&BigInt(value)<=9223372036854775807n;if(!bounds||!Object.values(bounds).every(valid))fail('EFINANCIAL_CT_UNVERIFIED');
   const prior=context.knowledge.get(shiftId);let partial=false;
   if(prior&&BigInt(prior)>=BigInt(bounds.minimum_version)&&BigInt(prior)>=BigInt(bounds.shift_minimum)&&BigInt(prior)<=BigInt(bounds.current_version)){
    if(prior===bounds.current_version){await tx.commit();return true;}
    const changed=(await context.operations.query(tx,"DECLARE @baseline bigint=CONVERT(bigint,@since); SELECT TOP(501) LOWER(CONVERT(nvarchar(36),CT.id)) id,CT.SYS_CHANGE_OPERATION operation FROM CHANGETABLE(CHANGES dbo.sales,@baseline) CT LEFT JOIN dbo.sales source WITH(HOLDLOCK) ON source.id=CT.id WHERE CT.SYS_CHANGE_OPERATION='D' OR source.id IS NULL OR (source.store_id=@branch AND TRY_CONVERT(uniqueidentifier,source.shift_id)=@shift);",{branch:branchId,shift:shiftId,since:prior})).recordset??[];
    const parents=(await context.operations.query(tx,"DECLARE @baseline bigint=CONVERT(bigint,@since); SELECT CT.id FROM CHANGETABLE(CHANGES dbo.shifts,@baseline) CT WHERE CT.id=@shift;",{shift:shiftId,since:prior})).recordset??[];
    if(!parents.length&&changed.length<=500&&changed.every(row=>row.operation!=='D')){
     const ids=changed.map(row=>row.id).sort(),rows=ids.length?await context.operations.rows(tx,ids,scope):[],known=ids.length?await context.operations.knownRows(tx,scope,ids):new Map(),{financialFact}=require('./shift-financial-operations.cjs');
     if(rows.some((row,i)=>row===null||!known.has(ids[i])||JSON.stringify(financialFact(row))!==JSON.stringify(financialFact(known.get(ids[i]))))){await tx.rollback();return false;}partial=true;
    }
   }
   if(!partial){const raw=(await context.operations.query(tx,require('node:fs').readFileSync(require('node:path').join(__dirname,'shift-financial-basis.sql'),'utf8'),{branch:branchId,shift:shiftId})).recordset?.[0]?.basis_json;await context.operations.validateKnownSnapshot(tx,{branchId,shiftId,basisJson:raw});}
   context.assertCurrent();await tx.commit();context.knowledge.set(shiftId,bounds.current_version);return true;
  }catch(error){await tx.rollback().catch(()=>{});if(error.code==='EFINANCIAL_SOURCE_UNVERIFIED')return false;throw error;}
 }
 async shiftContext(branchId,shiftId,preparedContext=undefined,preparedCapability=null){
  if(this.isManagement())return null;
  if(!uuid(shiftId))fail();let cap=preparedCapability,context=preparedContext;
  if(context===undefined){cap=await this.capability(branchId,shiftId);context=await this.contextForTerminal(branchId,cap);}
  if(!context){cap??=await this.capability(branchId,shiftId);if(cap.legacyCompatibility===true)return null;if(cap.descriptor?.shiftMode==='required'||cap.descriptor?.mode==='blocked')fail('EFINANCIAL_CAPABILITY_BLOCKED');if(cap.descriptor?.shiftMode==='unknown'&&cap.descriptor.mode==='disabled'&&await this.legacyOpening(branchId,shiftId,cap.scope.terminalId))return null;if(cap.descriptor?.shiftMode!=='legacy')fail();return null;}
  const rows=(await this.manager.pool.request().input('branch',branchId).input('shift',shiftId).input('terminal',context.scope.terminalId).query('SELECT origin_kind FROM dbo.pos_sync_shift_financial_origins WHERE branch_id=@branch AND shift_id=@shift AND terminal_id=@terminal;')).recordset??[];
  if(rows.length>1)fail();
  let required=rows.length===1;
  if(!required){cap??=context.preparedCapability?.scope.shiftId===shiftId?context.preparedCapability:await this.capability(branchId,shiftId);if(cap.descriptor?.mode!=='required'||!['legacy','required'].includes(cap.descriptor.shiftMode))fail();required=true;}
  if(required&&!rows.length){const witness=await context.operations.prepareCloudBasis({branchId,shiftId,terminalId:context.scope.terminalId}),sql=this.manager.sql(),tx=new sql.Transaction(this.manager.pool);await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);try{await context.operations.seedCloudBasis(tx,witness,{branchId,shiftId,terminalId:context.scope.terminalId});await tx.commit();}catch(error){await tx.rollback().catch(()=>{});throw error;}}
  if(!await this.knowledgeMatches(context,branchId,shiftId)){
   if(!context.online)fail('EFINANCIAL_LOCAL_PENDING');
   await context.observer.observe({branchId,shiftId,terminalId:context.scope.terminalId});
   if(!await this.knowledgeMatches(context,branchId,shiftId))fail('EFINANCIAL_LOCAL_PENDING');
  }
  context.assertCurrent();return context;
 }
 async savedReplay({branchId,shiftId,kind,raw,actor,reason=null}){
  if(!['ORIGINAL','RECOUNT'].includes(kind)||!uuid(shiftId))fail();
  const money=value=>Math.round(Number(value??0)*100)/100,legacy={cash:Number(raw.cash),card:raw.card==null?null:Number(raw.card),digital:raw.digital==null?null:Number(raw.digital)};
  if(Object.values(legacy).some(value=>value!==null&&(!Number.isFinite(value)||value<0)))fail('EFINANCIAL_DRAFT_INVALID');
  const parent=(await this.manager.pool.request().input('shift',shiftId).input('branch',branchId).query('SELECT terminal_id,state,closed_at FROM dbo.shifts WHERE id=@shift AND store_id=@branch;')).recordset??[];
  if(parent.length!==1)fail('SYNC_BRANCH_FORBIDDEN');
  const normalize=require('./shift-financial-draft.cjs').normalizeCountedInput;let exact=null;
  try{exact={cash:normalize(raw.cash),card:raw.card==null?null:normalize(raw.card),digital:raw.digital==null?null:normalize(raw.digital)};}catch{/* A legacy accepted input is not repriced by a new parser. */}
  const spelling=value=>typeof value==='string'?value.replace(/\.00$/,'').replace(/(\.[0-9])0$/,'$1'):value;
  const key=amounts=>String(raw.clientKey??(kind==='ORIGINAL'?`${shiftId}:original`:`${shiftId}:recount:${spelling(amounts.cash)}:${spelling(amounts.card)??''}:${spelling(amounts.digital)??''}:${reason}`));
  const legacyKey=key(legacy),exactKey=exact?key(exact):legacyKey;
  const counts=(await this.manager.pool.request().input('branch',branchId).input('shift',shiftId).input('kind',kind).input('legacy',legacyKey).input('exact',exactKey).query("SELECT TOP(2) id,client_key FROM dbo.shift_cash_counts WHERE store_id=@branch AND shift_id=@shift AND (client_key IN(@legacy,@exact) OR (@kind='ORIGINAL' AND kind='ORIGINAL')); ")).recordset??[];
  if(!counts.length)return null;if(counts.length!==1)fail('EIDEMPOTENCY');
  const metadata=(await this.manager.pool.request().query("SELECT CASE WHEN OBJECT_ID(N'dbo.pos_sync_shift_financial_bases',N'U') IS NULL THEN 0 ELSE 1 END present;")).recordset?.[0]?.present;
  let exactSaved=false;if(metadata===1)exactSaved=(await this.manager.pool.request().input('branch',branchId).input('shift',shiftId).input('count',counts[0].id).query('SELECT intent_id FROM dbo.pos_sync_shift_financial_bases WHERE branch_id=@branch AND shift_id=@shift AND count_id=@count;')).recordset?.length===1;
  if(exactSaved&&!exact)fail('EIDEMPOTENCY');
  const history=exactSaved?new ShiftFinancialOperations(this.manager,{enabled:true,cloud:this.cloud,terminalId:()=>String(this.terminal()?.tokenId??'')}):null;
  const bases=exactSaved?new ShiftFinancialBases(this.manager,{enabled:true,financialOperations:history}):null,journal=exactSaved?new ShiftSyncJournal(this.operationsRepository,{authorRequired:true,financialBases:bases}):this.legacy.journal;
  const values=exactSaved?exact:legacy,intent={branchId,shiftId,clientKey:exactSaved?exactKey:legacyKey,actor,terminalId:String(raw.terminalId??parent[0].terminal_id??'').trim()||null,cash:exactSaved?values.cash:money(values.cash),card:values.card==null?null:exactSaved?values.card:money(values.card),digital:values.digital==null?null:exactSaved?values.digital:money(values.digital),...(kind==='RECOUNT'?{reason}:{})};
  if(kind==='ORIGINAL'&&String(parent[0].state??(parent[0].closed_at?'CLOSED':'ACTIVE'))==='ACTIVE')fail('EIDEMPOTENCY');
  const replay=kind==='ORIGINAL'?await journal.originalReplay(intent):await journal.recountReplay(intent);if(!replay)fail('EIDEMPOTENCY');
  return{ok:true,state:kind==='ORIGINAL'?replay.state:'CLOSED',replayed:true};
 }
 async forAggregate(aggregate){
  if(this.isManagement())return this.legacy.aggregate;
  if(!aggregate.operations.some(op=>['sales','shifts'].includes(op.table)))return this.legacy.aggregate;
  const openings=aggregate.operations.filter(op=>op.table==='shifts'&&['insert','upsert'].includes(op.kind)).flatMap(op=>op.rows??[]).filter(row=>row.status==='OPEN');
  const shifts=new Set();for(const op of aggregate.operations.filter(op=>op.table==='sales'))for(const row of op.rows??[op.values??op.match??{}]){const id=row.id??op.match?.id;if(!uuid(id))fail();const found=(await this.manager.pool.request().input('sale',id).input('branch',aggregate.branchId).query('SELECT shift_id FROM dbo.sales WHERE id=@sale AND store_id=@branch;')).recordset??[];const shiftId=found[0]?.shift_id??row.shift_id;if(shiftId)shifts.add(String(shiftId).toLowerCase());}
  const first=shifts.values().next().value??null,cap=await this.capability(aggregate.branchId,first),context=await this.contextForTerminal(aggregate.branchId,cap);
  if(context&&openings.some(row=>shifts.has(String(row.id).toLowerCase())))fail('EFINANCIAL_COMBINED_OPEN_UNSUPPORTED');
  for(const shiftId of shifts)await this.shiftContext(aggregate.branchId,shiftId,context,shiftId===first?cap:null);
  context?.assertCurrent();return context?.aggregate??this.legacy.aggregate;
 }
 async forRefund(branchId,saleId,requestCapture=null){
  if(this.isManagement())return{repository:this.legacy.receipts,author:null};
  const rows=(await this.manager.pool.request().input('sale',saleId).input('branch',branchId).query('SELECT shift_id FROM dbo.sales WHERE id=@sale AND store_id=@branch;')).recordset??[];
  if(rows.length!==1)fail('ERECEIPT');const shiftId=rows[0].shift_id?String(rows[0].shift_id).toLowerCase():null,cap=await this.capability(branchId,shiftId),context=await this.contextForTerminal(branchId,cap);if(shiftId)await this.shiftContext(branchId,shiftId,context,cap);
  if(!context)return{repository:this.legacy.receipts,author:null};
  if(shiftId===null){context.assertCurrent();return{repository:context.receipts,author:null,terminalId:context.scope.terminalId,expectedShiftId:null};}
  requestCapture?.assertCurrent();const capture=typeof requestCapture?.financialCapture==='function'?requestCapture.financialCapture('REFUND'):requestCapture??this.authority.captureFinancial('REFUND');
  const author=await this.authority.prepare(capture);context.assertCurrent();return{repository:context.receipts,author,terminalId:context.scope.terminalId,expectedShiftId:shiftId};
 }
 async runPush(options){const context=await this.contextForTerminal(options.branchId);return(context?.push??this.legacy.push).run(options);}
}
module.exports={ShiftFinancialRuntime,validatePendingFinancialProof:validatePending};
