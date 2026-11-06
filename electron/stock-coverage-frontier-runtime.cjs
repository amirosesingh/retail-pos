'use strict';
// Main-only observation factory. No IPC signer, scheduler, enrollment or ACK.
const{randomUUID,createHash}=require('node:crypto');
const{performance}=require('node:perf_hooks');
const contract=require('./db/stock-history-contract.cjs');
const bindingProtocol=require('./security/shift-author-protocol.cjs');
const{binding:terminalBinding}=require('./verified-activation.cjs');
const{scopeHash}=require('./shift-authority.cjs');
const{readStockHistoryFrontierSnapshot}=require('./db/stock-history-frontier-snapshot.cjs');
const fail=code=>contract.fail(code);
const observed=(state,reason=null)=>Object.freeze({state,...(reason?{reason}:{}),coverageProven:false});
const sameSnapshot=(a,b)=>a?.available===true&&b?.available===true&&JSON.stringify([a.databaseKey,a.sourceSequence,a.sourceRoot,a.sourceGeneration,a.gapHash,a.pending])===
 JSON.stringify([b.databaseKey,b.sourceSequence,b.sourceRoot,b.sourceGeneration,b.gapHash,b.pending]);
function createStockCoverageFrontierRuntime({manager,keys,session,terminal,branch,project,context=()=>null,cloud,
 readSnapshot=readStockHistoryFrontierSnapshot,now=()=>performance.now()}){
 let active=null,nextAt=0,lastKey=null,lastPool=null,last=observed('unavailable','NOT_OBSERVED'),pending=null;
 function capture(assertLease){
  if(typeof assertLease!=='function'||!session.hasPosAuthority?.())fail('ESTOCK_FRONTIER_AUTHOR_UNAVAILABLE');
  const person=session.identity(),device=terminalBinding(terminal()),branchId=contract.identifier(branch());
  if(!person||person.source!=='pos'||!person.authorId||!person.canonicalSubject||!device||device.platform!=='pc'||device.mode!=='operations'||
    device.branchId!==branchId||(person.branchId&&contract.identifier(person.branchId)!==branchId))fail('ESTOCK_FRONTIER_AUTHOR_UNAVAILABLE');
  const binding=Object.freeze(bindingProtocol.normalizeBinding({projectOrigin:project(),terminalId:device.id,authorId:person.authorId}));
  const epoch=session.epoch(),pool=manager.pool,key=JSON.stringify([binding,person.canonicalSubject,branchId,epoch,terminal(),project(),context()]);
  const assertCurrent=()=>{
   const current=session.identity(),lease=assertLease();
   if(lease===false||lease&&typeof lease.then==='function'||!session.hasPosAuthority?.()||!current||current.source!=='pos'||manager.pool!==pool||
    contract.identifier(branch())!==branchId||
    current.authorId!==binding.authorId||current.canonicalSubject!==person.canonicalSubject||session.epoch()!==epoch||
    (current.branchId&&contract.identifier(current.branchId)!==branchId)||
    JSON.stringify([binding,current.canonicalSubject,branchId,epoch,terminal(),project(),context()])!==key)fail('ESTOCK_HISTORY_CONTEXT_CHANGED');
  };
  assertCurrent();return{binding,branchId,key,pool,subject:person.canonicalSubject,assertCurrent,assertLease};
 }
 async function snapshot(capture){
  capture.assertCurrent();const result=await readSnapshot({manager,branchId:capture.branchId,terminalId:capture.binding.terminalId,assertCurrent:capture.assertCurrent,assertLease:capture.assertLease});
  capture.assertCurrent();return result;
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
 async function perform(capture){
  const before=await snapshot(capture);if(!before.available)return observed('unavailable',before.reason);
  const keyId=await originalKey(capture);
  if(pending&&pending.key===capture.key&&sameSnapshot(before,pending.snapshot))return submit(capture,pending);
  pending=null;const challengeId=randomUUID();
  const response=await cloud.requestStockFrontierChallenge({branchId:capture.branchId,terminalId:capture.binding.terminalId,challengeId,authorId:capture.binding.authorId,keyId});capture.assertCurrent();
  if(response?.ok!==true||response.version!==1||response.branchId!==capture.branchId||response.terminalId!==capture.binding.terminalId||response.challenge?.challengeId!==challengeId)fail('ESTOCK_FRONTIER_ACK_UNCONFIRMED');
  const challenge=response.challenge;
  if(contract.instant(challenge.expiresAt)<=contract.instant(challenge.issuedAt)||contract.instant(challenge.expiresAt)-contract.instant(challenge.issuedAt)>3000000000n)fail('ESTOCK_FRONTIER_ACK_UNCONFIRMED');
  const actual=await snapshot(capture);if(!actual.available)return observed('unavailable',actual.reason);
  const{stockCoverageFrontierJson}=require('./shared/stock-coverage-frontier.mjs');
  const frontierJson=stockCoverageFrontierJson({version:1,projectOrigin:capture.binding.projectOrigin,branchId:capture.branchId,terminalId:capture.binding.terminalId,authorId:capture.binding.authorId,
   databaseId:actual.databaseId,challengeId,nonce:challenge.nonce,cohortHash:challenge.cohortHash,writerRevision:'stock-history-source.v1',
   sourceSequence:actual.sourceSequence,sourceRoot:actual.sourceRoot,sourceGeneration:actual.sourceGeneration,gapHash:actual.gapHash,pending:actual.pending,observedAt:actual.observedAt});
  const proof=keys.signStockCoverageFrontier(capture.binding,{expectedKeyId:keyId,subject:capture.subject,branchId:capture.branchId,frontierJson});capture.assertCurrent();
  const current=await snapshot(capture);if(!sameSnapshot(actual,current))return observed('unconfirmed','LOCAL_SOURCE_CHANGED');
  pending=Object.freeze({key:capture.key,snapshot:actual,frontierJson,proofJson:JSON.stringify(proof),challengeId,frontierHash:createHash('sha256').update(frontierJson).digest('hex')});
  return submit(capture,pending);
 }
 async function submit(capture,saved){
  const result=await cloud.acceptStockFrontier({branchId:capture.branchId,terminalId:capture.binding.terminalId,frontierJson:saved.frontierJson,proofJson:saved.proofJson});capture.assertCurrent();
  const receipt=result?.receipt;
  if(result?.ok!==true||result.version!==1||result.branchId!==capture.branchId||result.terminalId!==capture.binding.terminalId||receipt?.challengeId!==saved.challengeId||
    receipt.frontierHash!==saved.frontierHash||!['accepted','unconfirmed'].includes(receipt.state)||receipt.observationGrade!=='author_claimed'||!Array.isArray(receipt.reasons)||
    receipt.reasons.length>8||receipt.reasons.some(reason=>typeof reason!=='string'||reason.length>80)||(receipt.state==='accepted'&&
      (receipt.reasons.length||Object.values(saved.snapshot.pending).some(value=>value!=='0'))))fail('ESTOCK_FRONTIER_ACK_UNCONFIRMED');
  contract.instant(receipt.acceptedAt);pending=null;return observed(receipt.state,receipt.reasons[0]??null);
 }
 function run({assertLease}={}){
  if(active)return active;
  let captured;try{captured=capture(assertLease);}catch(error){last=observed('unavailable',error.code??'ESTOCK_FRONTIER_AUTHOR_UNAVAILABLE');return Promise.resolve(last);}
  if(lastKey===captured.key&&lastPool===captured.pool&&now()<nextAt)return Promise.resolve(observed('deferred',last.reason));
  lastKey=captured.key;lastPool=captured.pool;
  active=perform(captured).then(result=>{last=result;nextAt=now()+(result.reason==='LOCAL_SOURCE_CHANGED'?5000:300000);return result;},error=>{
   if(['STOCK_FRONTIER_CHALLENGE_STALE','STOCK_FRONTIER_CHALLENGE_INVALID'].includes(error.code))pending=null;
   last=observed('unconfirmed',error.code??'ESTOCK_FRONTIER_UNAVAILABLE');nextAt=now()+30000;return last;
  }).finally(()=>{active=null;});return active;
 }
 return Object.freeze({run,status:()=>last});
}
module.exports={createStockCoverageFrontierRuntime};
