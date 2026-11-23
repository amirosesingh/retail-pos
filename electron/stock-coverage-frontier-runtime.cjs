'use strict';
// Main-only observation factory. No IPC signer, scheduler, enrollment or ACK.
const{randomUUID,createHash}=require('node:crypto');
const{performance}=require('node:perf_hooks');
const contract=require('./db/stock-history-contract.cjs');
const bindingProtocol=require('./security/shift-author-protocol.cjs');
const{binding:terminalBinding}=require('./verified-activation.cjs');
const{scopeHash}=require('./shift-authority.cjs');
const{readStockHistoryFrontierSnapshot}=require('./db/stock-history-frontier-snapshot.cjs');
const{checkedLease,createStocktakeFence,stocktakeGapHash}=require('./stocktake-fence.cjs');
const fail=code=>contract.fail(code);
const observed=(state,reason=null)=>Object.freeze({state,...(reason?{reason}:{}),coverageProven:false});
const sameSnapshot=(a,b)=>a?.available===true&&b?.available===true&&JSON.stringify([a.databaseKey,a.sourceSequence,a.sourceRoot,a.sourceGeneration,a.gapHash,a.pending])===
 JSON.stringify([b.databaseKey,b.sourceSequence,b.sourceRoot,b.sourceGeneration,b.gapHash,b.pending]);
function createStockCoverageFrontierRuntime({manager,keys,session,terminal,branch,project,context=()=>null,cloud,
 readSnapshot=readStockHistoryFrontierSnapshot,now=()=>performance.now(),expectedDatabaseGuid=null,stocktakeBackend=null}){
 let active=null,nextAt=0,lastKey=null,lastPool=null,last=observed('unavailable','NOT_OBSERVED'),pending=null;
 const fence=stocktakeBackend&&createStocktakeFence({manager,drain:stocktakeBackend.drain,readSnapshot});
 function capture(assertLease,forStocktake=false,trace){
  if(typeof assertLease!=='function'||!session.hasPosAuthority?.())fail('ESTOCK_FRONTIER_AUTHOR_UNAVAILABLE');
  const person=session.identity(),device=terminalBinding(terminal()),branchId=contract.identifier(branch());
  if(!person||person.source!=='pos'||!person.authorId||!person.canonicalSubject||!device||device.platform!=='pc'||device.mode!=='operations'||
    device.branchId!==branchId||(person.branchId&&contract.identifier(person.branchId)!==branchId))fail('ESTOCK_FRONTIER_AUTHOR_UNAVAILABLE');
  const binding=Object.freeze(bindingProtocol.normalizeBinding({projectOrigin:project(),terminalId:device.id,authorId:person.authorId}));
  const databaseId=forStocktake&&contract.identifier(expectedDatabaseGuid,true);
  if(forStocktake&&(person.level!=='admin'||!fence||!manager.pool||!context()||contract.identifier(device.id,true)!==binding.terminalId||
    /[\u0000-\u001f\u007f]/u.test(branchId)||binding.projectOrigin.length>255))
   fail('ESTOCK_STOCKTAKE_SCOPE');
  const epoch=session.epoch(),pool=manager.pool,terminalAtStart=terminal(),projectAtStart=project(),sourceAtStart=context();
  const key=JSON.stringify([binding,person.canonicalSubject,branchId,epoch,terminalAtStart,projectAtStart,sourceAtStart]);
  const terminalFingerprintAtStart=trace?JSON.stringify(terminalAtStart):null;
  const contextChanged=reason=>{trace?.('context',reason);fail('ESTOCK_HISTORY_CONTEXT_CHANGED');};
  const assertCurrent=()=>{
   const current=session.identity(),lease=assertLease();
   if(lease===false||lease&&typeof lease.then==='function')contextChanged('lease');
   if(!session.hasPosAuthority?.()||!current||current.source!=='pos')contextChanged('session');
   if(manager.pool!==pool)contextChanged('writer-pool');
   if(contract.identifier(branch())!==branchId)contextChanged('branch');
   if(current.authorId!==binding.authorId||current.canonicalSubject!==person.canonicalSubject)contextChanged('author');
   if(session.epoch()!==epoch)contextChanged('session-epoch');
   if(forStocktake&&current.level!=='admin')contextChanged('session');
   if(forStocktake&&!context())contextChanged('runtime-unavailable');
   if(current.branchId&&contract.identifier(current.branchId)!==branchId)contextChanged('branch');
   const currentTerminal=terminal(),currentProject=project(),currentSource=context();
   if(JSON.stringify([binding,current.canonicalSubject,branchId,epoch,currentTerminal,currentProject,currentSource])!==key){
    if(trace&&JSON.stringify(currentTerminal)!==terminalFingerprintAtStart)contextChanged('terminal-binding');
    if(currentProject!==projectAtStart)contextChanged('project-origin');
    contextChanged('source-fingerprint');
   }
  };
  assertCurrent();return{binding,branchId,key,pool,subject:person.canonicalSubject,assertCurrent,assertLease,databaseId,trace};
 }
 async function snapshot(capture){
  capture.assertCurrent();const result=await readSnapshot({manager,branchId:capture.branchId,terminalId:capture.binding.terminalId,assertCurrent:capture.assertCurrent,assertLease:capture.assertLease});
  capture.assertCurrent();
  if(expectedDatabaseGuid&&result.available&&result.databaseId!==expectedDatabaseGuid)
   return {available:false,reason:'DATABASE_SCOPE_CHANGED'};
  return result;
 }
 async function originalKey(capture){
  const sql=manager.sql(),request=new sql.Request(manager.pool,{requestTimeout:1000});
  const rows=(await request.input('frontier_scope',scopeHash(capture.binding)).query('SELECT project_origin,terminal_id,author_id,key_id,public_key FROM dbo.pos_sync_shift_author_keys WHERE scope_hash=@frontier_scope;')).recordset??[];
  capture.assertCurrent();if(rows.length!==1)fail('ESYNC_SHIFT_AUTHOR_ENROLLMENT_PENDING');
  const row=rows[0],keyId=contract.identifier(String(row.key_id),true);
  if(row.project_origin!==capture.binding.projectOrigin||row.terminal_id!==capture.binding.terminalId||contract.identifier(String(row.author_id),true)!==capture.binding.authorId)fail('ESYNC_SHIFT_AUTHOR_KEY_MISMATCH');
  const info=keys.prepare(capture.binding,{expectedKeyId:keyId});capture.assertCurrent();
  if(!info.enrolled||info.keyId!==keyId||info.publicKey!==row.public_key)fail('ESYNC_SHIFT_AUTHOR_ENROLLMENT_PENDING');return keyId;
 }
 async function requestChallenge(capture,keyId){
  const challengeId=randomUUID();
  const response=await cloud.requestStockFrontierChallenge({branchId:capture.branchId,terminalId:capture.binding.terminalId,challengeId,authorId:capture.binding.authorId,keyId});capture.assertCurrent();
  if(response?.ok!==true||response.version!==1||response.branchId!==capture.branchId||response.terminalId!==capture.binding.terminalId||response.challenge?.challengeId!==challengeId)fail('ESTOCK_FRONTIER_ACK_UNCONFIRMED');
  const challenge=response.challenge;
  if(contract.instant(challenge.expiresAt)<=contract.instant(challenge.issuedAt)||contract.instant(challenge.expiresAt)-contract.instant(challenge.issuedAt)>3000000000n)fail('ESTOCK_FRONTIER_ACK_UNCONFIRMED');
  return challenge;
 }
 function signSnapshot(capture,keyId,challenge,actual,gapHash=actual.gapHash){
  const{challengeId}=challenge;
  const{stockCoverageFrontierJson}=require('./shared/stock-coverage-frontier.mjs');
  const frontierJson=stockCoverageFrontierJson({version:1,projectOrigin:capture.binding.projectOrigin,branchId:capture.branchId,terminalId:capture.binding.terminalId,authorId:capture.binding.authorId,
   databaseId:actual.databaseId,challengeId,nonce:challenge.nonce,cohortHash:challenge.cohortHash,writerRevision:'stock-history-source.v1',
   sourceSequence:actual.sourceSequence,sourceRoot:actual.sourceRoot,sourceGeneration:actual.sourceGeneration,gapHash,pending:actual.pending,observedAt:actual.observedAt});
  const proof=keys.signStockCoverageFrontier(capture.binding,{expectedKeyId:keyId,subject:capture.subject,branchId:capture.branchId,frontierJson});
  capture.assertCurrent();
  return Object.freeze({key:capture.key,snapshot:actual,frontierJson,proofJson:JSON.stringify(proof),challengeId,frontierHash:createHash('sha256').update(frontierJson).digest('hex')});
 }
 async function perform(capture){
  if(fence&&expectedDatabaseGuid&&await fence.suppressNormalObservation({
   ...capture,databaseId:contract.identifier(expectedDatabaseGuid,true),
  }))return observed('deferred','STOCKTAKE_FENCE_ACTIVE');
  const before=await snapshot(capture);if(!before.available)return observed('unavailable',before.reason);
  const keyId=await originalKey(capture);
  if(pending&&pending.key===capture.key&&sameSnapshot(before,pending.snapshot))return submit(capture,pending);
  pending=null;
  const challenge=await requestChallenge(capture,keyId);
  const actual=await snapshot(capture);if(!actual.available)return observed('unavailable',actual.reason);
  const signed=signSnapshot(capture,keyId,challenge,actual);
  const current=await snapshot(capture);if(!sameSnapshot(actual,current))return observed('unconfirmed','LOCAL_SOURCE_CHANGED');
  pending=signed;
  return submit(capture,pending);
 }
 async function acceptProof(capture,saved){
  const result=await cloud.acceptStockFrontier({branchId:capture.branchId,terminalId:capture.binding.terminalId,frontierJson:saved.frontierJson,proofJson:saved.proofJson});capture.assertCurrent();
  const receipt=result?.receipt;
  if(result?.ok!==true||result.version!==1||result.branchId!==capture.branchId||result.terminalId!==capture.binding.terminalId||receipt?.challengeId!==saved.challengeId||
    receipt.frontierHash!==saved.frontierHash||!['accepted','unconfirmed'].includes(receipt.state)||receipt.observationGrade!=='author_claimed'||!Array.isArray(receipt.reasons)||
    receipt.reasons.length>8||receipt.reasons.some(reason=>typeof reason!=='string'||reason.length>80)||(receipt.state==='accepted'&&
      (receipt.reasons.length||Object.values(saved.snapshot.pending).some(value=>value!=='0'))))fail('ESTOCK_FRONTIER_ACK_UNCONFIRMED');
  contract.instant(receipt.acceptedAt);
  return receipt;
 }
 async function submit(capture,saved){
  const receipt=await acceptProof(capture,saved);
  pending=null;return observed(receipt.state,receipt.reasons[0]??null);
 }
 async function resolveStocktake(assertLease,stocktakeId,purpose){
  const captured=capture(assertLease,true);
  const request=Object.freeze({stocktakeId:contract.identifier(stocktakeId,true),projectOrigin:captured.binding.projectOrigin,
   branchId:captured.branchId,terminalId:captured.binding.terminalId,authorId:captured.binding.authorId,databaseId:captured.databaseId});
  const source=await stocktakeBackend.loadLease(request,purpose);
  captured.assertCurrent();
  return {captured,lease:checkedLease(captured,request.stocktakeId,purpose,source),request};
 }
 const stocktake=fence&&Object.freeze({
  async enroll({assertLease,trace}){
   if(typeof stocktakeBackend.enroll!=='function')fail('ESTOCK_STOCKTAKE_UNAVAILABLE');
   const captured=capture(assertLease,true,trace);
   trace?.('stage','snapshot-initial');
   const before=await fence.enrollmentSnapshot(captured);
   if(!before.available||before.databaseId!==captured.databaseId)fail('ESTOCK_STOCKTAKE_SCOPE');
   trace?.('stage','original-key');
   const keyId=await originalKey(captured);
   trace?.('stage','challenge');
   const challenge=await requestChallenge(captured,keyId);
   trace?.('stage','snapshot-after-challenge');
   const actual=await fence.enrollmentSnapshot(captured);
   if(!sameSnapshot(before,actual))fail('ESTOCK_STOCKTAKE_SOURCE_CHANGED');
   trace?.('stage','sign');
   const signed=signSnapshot(captured,keyId,challenge,actual);
   trace?.('stage','snapshot-after-sign');
   if(!sameSnapshot(actual,await fence.enrollmentSnapshot(captured)))fail('ESTOCK_STOCKTAKE_SOURCE_CHANGED');
   trace?.('stage','confirm-frontier');
   const receipt=await acceptProof(captured,signed);
   if(receipt.state!=='accepted')fail('ESTOCK_STOCKTAKE_SOURCE_CHANGED');
   trace?.('stage','enroll-relay');
   const result=await stocktakeBackend.enroll({branchId:captured.branchId,terminalId:captured.binding.terminalId,
    databaseId:actual.databaseId,challengeId:challenge.challengeId});
   captured.assertCurrent();
   if(result?.projectOrigin!==captured.binding.projectOrigin||result.branchId!==captured.branchId||
    result.terminalId!==captured.binding.terminalId||result.databaseId!==captured.databaseId||typeof result.cohortReady!=='boolean')
    fail('ESTOCK_STOCKTAKE_ENROLLMENT_UNCONFIRMED');
   return result;
  },
  async arm({assertLease,stocktakeId}){
   const{captured,lease}=await resolveStocktake(assertLease,stocktakeId,'arm');
   return fence.arm(captured,lease);
  },
  async prove({assertLease,stocktakeId,phase}){
   if(phase!=='arm'&&phase!=='confirm')fail('ESTOCK_STOCKTAKE_SCOPE');
   const{captured,lease}=await resolveStocktake(assertLease,stocktakeId,phase);
   const generation=await fence.drainBeforeProof(captured,lease);
   const keyId=await originalKey(captured),challenge=await requestChallenge(captured,keyId);
   if(contract.instant(challenge.issuedAt)<contract.instant(lease.issuedAt)||
    contract.instant(challenge.issuedAt)>=contract.instant(lease.expiresAt))fail('ESTOCK_STOCKTAKE_FENCE_CLOSED');
   const{claim,signed}=await fence.observe(captured,lease,generation,(actual,local)=>{
    const claim=Object.freeze({terminalId:captured.binding.terminalId,challengeId:challenge.challengeId,databaseId:captured.databaseId,
     fenceGeneration:local.generation,localFencedAt:local.fencedAt,localExpiresAt:local.expiresAt});
    return {claim,signed:signSnapshot(captured,keyId,challenge,actual,stocktakeGapHash(captured,lease,phase,claim))};
   });
   const receipt=await acceptProof(captured,signed),acceptedAt=contract.instant(receipt.acceptedAt);
   if(receipt.state!=='accepted'||acceptedAt<contract.instant(claim.localFencedAt)||acceptedAt>=contract.instant(lease.expiresAt))
    fail('ESTOCK_FRONTIER_ACK_UNCONFIRMED');
   return claim;
  },
  async release({assertLease,stocktakeId,fenceGeneration}){
   const{captured,lease,request}=await resolveStocktake(assertLease,stocktakeId,'release');
   try{return await fence.release(captured,lease,fenceGeneration,null);}
   catch(error){if(error?.code!=='ESTOCK_STOCKTAKE_RELEASE_UNCONFIRMED'||typeof stocktakeBackend.loadRelease!=='function')throw error;}
   const released=await stocktakeBackend.loadRelease(request);
   captured.assertCurrent();
   return fence.release(captured,lease,fenceGeneration,released);
  },
 });
 function run({assertLease}={}){
  if(active)return active;
  let captured;try{captured=capture(assertLease);}catch(error){last=observed('unavailable',error.code??'ESTOCK_FRONTIER_AUTHOR_UNAVAILABLE');return Promise.resolve(last);}
  if(lastKey===captured.key&&lastPool===captured.pool&&now()<nextAt)return Promise.resolve(observed('deferred',last.reason));
  active=perform(captured).then(result=>{
   if(result.reason==='STOCKTAKE_FENCE_ACTIVE')return result;
   lastKey=captured.key;lastPool=captured.pool;last=result;nextAt=now()+(result.reason==='LOCAL_SOURCE_CHANGED'?5000:300000);return result;
  },error=>{
   lastKey=captured.key;lastPool=captured.pool;
   if(['STOCK_FRONTIER_CHALLENGE_STALE','STOCK_FRONTIER_CHALLENGE_INVALID'].includes(error.code))pending=null;
   last=observed('unconfirmed',error.code??'ESTOCK_FRONTIER_UNAVAILABLE');nextAt=now()+30000;return last;
  }).finally(()=>{active=null;});return active;
 }
 return Object.freeze({run,status:()=>last,...(stocktake?{stocktake}:{})});
}
module.exports={createStockCoverageFrontierRuntime};
