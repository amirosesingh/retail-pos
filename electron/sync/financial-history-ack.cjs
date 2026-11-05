// Metadata ACKs are deliberately distinct from business/shift acknowledgements.
const {createHash}=require('node:crypto');
const {parseExactJson,isExactNumber}=require('./shift-recovery-exact.cjs');
const {normalizeFinancialAttestation}=require('../security/financial-author-protocol.cjs');
const {prepareShiftFinancialBasis}=require('./shift-financial-ack.cjs');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HASH=/^[a-f0-9]{64}$/;
const MAX=6*1024*1024;
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const hash=v=>createHash('sha256').update(v,'utf8').digest('hex');
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const fail=(code='EFINANCIAL_HISTORY_INVALID')=>{throw Object.assign(new Error('Financial history remains pending because its exact receipt was not confirmed.'),{code,table:'shifts'});};
const parse=raw=>{if(typeof raw!=='string'||!raw||Buffer.byteLength(raw,'utf8')>MAX)fail();try{return parseExactJson(raw,{maxBytes:MAX,maxDepth:64});}catch{fail();}};
const origin=v=>exact(v,['localAggregateId','rowHash'])&&UUID.test(v.localAggregateId)&&HASH.test(v.rowHash);
const cloudOrigin=v=>exact(v,['serverBasisId','serverBasisHash'])&&UUID.test(v.serverBasisId)&&HASH.test(v.serverBasisHash);
const originField=v=>Object.hasOwn(v??{},'openingOrigin')?'openingOrigin':'cloudOrigin';
const validOrigin=v=>originField(v)==='openingOrigin'?origin(v.openingOrigin):cloudOrigin(v.cloudOrigin);
const sequence=v=>typeof v==='string'&&/^[1-9][0-9]{0,18}$/.test(v)&&BigInt(v)<=9223372036854775807n;
function prepareFinancialOpening(input,branchId,terminalId){
 if(!input)return null;const raw=input.openingJson,v=parse(raw);let proof;
 try{proof=normalizeFinancialAttestation(input.proof);}catch{fail();}
 if(!exact(v,['version','localAggregateId','branchId','terminalId','shiftId','rowHash','rowJson'])||!isExactNumber(v.version)||v.version.raw!=='1'||!UUID.test(v.localAggregateId)||!UUID.test(v.shiftId)||!HASH.test(v.rowHash)||typeof v.rowJson!=='string'||hash(v.rowJson)!==v.rowHash||v.branchId!==branchId||v.terminalId!==terminalId||proof.branchId!==branchId||proof.terminalId!==terminalId||proof.operationId!==v.localAggregateId||proof.action!=='OPEN'||proof.payloadHash!==hash(raw))fail();
 const row=parse(v.rowJson);if(row.id!==v.shiftId||row.store_id!==branchId||row.status!=='OPEN'||row.closed_at!=null||![null,undefined,'ACTIVE'].includes(row.state))fail();
 return Object.freeze({openingJson:raw,proof:Object.freeze(proof),operationId:v.localAggregateId,shiftId:v.shiftId,payloadHash:hash(raw),rowHash:v.rowHash});
}
function prepareFinancialHistory(input,branchId,terminalId){
 if(!input||!['MUTATION','CLOSING','OBSERVE'].includes(input.kind))fail();const payload=parse(input.payloadJson);
 if(input.branchId!==branchId||input.terminalId!==terminalId||!UUID.test(input.shiftId)||!UUID.test(input.operationId)||!sequence(input.sequence)||!HASH.test(input.payloadHash)||hash(input.payloadJson)!==input.payloadHash)fail();
 if(input.kind==='OBSERVE'){
  const field=originField(payload);
  if(Buffer.byteLength(input.payloadJson,'utf8')>16*1024||!exact(payload,['version','operationId','branchId','terminalId','shiftId',field,'sequence','predecessorOperationId','predecessorHash','action','observedBasis'])||!isExactNumber(payload.version)||payload.version.raw!==(field==='openingOrigin'?'1':'2')||!validOrigin(payload)||payload.branchId!==branchId||payload.terminalId!==terminalId||payload.shiftId!==input.shiftId||payload.operationId!==input.operationId||payload.sequence!==input.sequence||!UUID.test(payload.predecessorOperationId)||!HASH.test(payload.predecessorHash)||payload.action!=='OBSERVE'||!cloudOrigin(payload.observedBasis)||!HASH.test(input.computedMergedHash)||!HASH.test(input.pendingFromHash)||JSON.stringify(canonical(input.proof))!==JSON.stringify(canonical(payload.observedBasis)))fail();
  if(payload.sequence==='1'){const o=payload[field];if(payload.predecessorOperationId!==(o.localAggregateId??o.serverBasisId)||payload.predecessorHash!==(o.rowHash??o.serverBasisHash))fail();}
  return Object.freeze({...input,proof:Object.freeze({...payload.observedBasis})});
 }
 if(input.kind==='MUTATION'){
  let proof;try{proof=normalizeFinancialAttestation(input.proof);}catch{fail();}
  const field=originField(payload);
  if(!exact(payload,['version','operationId','branchId','terminalId','shiftId',field,'sequence','predecessorOperationId','predecessorHash','action','changes'])||!isExactNumber(payload.version)||payload.version.raw!==(field==='openingOrigin'?'1':'2')||!validOrigin(payload)||payload.branchId!==branchId||payload.terminalId!==terminalId||payload.shiftId!==input.shiftId||payload.operationId!==input.operationId||payload.sequence!==input.sequence||!UUID.test(payload.predecessorOperationId)||!HASH.test(payload.predecessorHash)||!['SALE','REFUND','TENDER','VOID'].includes(payload.action)||!Array.isArray(payload.changes)||!payload.changes.length||payload.changes.length>500||proof.branchId!==branchId||proof.terminalId!==terminalId||proof.operationId!==input.operationId||proof.payloadHash!==input.payloadHash||proof.action!==payload.action)fail();
  if(payload.sequence==='1'){const id=field==='openingOrigin'?payload.openingOrigin.localAggregateId:payload.cloudOrigin.serverBasisId,digest=field==='openingOrigin'?payload.openingOrigin.rowHash:payload.cloudOrigin.serverBasisHash;if(payload.predecessorOperationId!==id||payload.predecessorHash!==digest)fail();}
  return Object.freeze({...input,proof:Object.freeze(proof)});
 }
 const intent=input.intent,financial=prepareShiftFinancialBasis(intent,branchId);
 const field=originField(payload);
 if(!financial||!exact(payload,[field,'sequence','predecessorOperationId','predecessorHash','intentId','graphPayloadHash','basisHash'])||!validOrigin(payload)||payload.sequence!==input.sequence||payload.intentId!==input.operationId||!UUID.test(payload.predecessorOperationId)||!HASH.test(payload.predecessorHash)||payload.graphPayloadHash!==intent.payloadHash||payload.basisHash!==financial.proof.basisHash||intent.shiftId!==input.shiftId||financial.proof.terminalId!==terminalId||JSON.stringify(canonical(input.proof))!==JSON.stringify(canonical(financial.proof)))fail();
 const basis=parse(financial.basisJson),f=basis.financialFrontier;
 if(!exact(f,[field,'sequence','operationId','hash','reservedSequence'])||!validOrigin(f)||f.reservedSequence!==payload.sequence||!sequence(f.reservedSequence)||typeof f.sequence!=='string'||!/^(0|[1-9][0-9]{0,18})$/.test(f.sequence)||BigInt(f.reservedSequence)!==BigInt(f.sequence)+1n||f.operationId!==payload.predecessorOperationId||f.hash!==payload.predecessorHash||JSON.stringify(canonical(f[field]))!==JSON.stringify(canonical(payload[field])))fail();
 if(field==='cloudOrigin'&&financial.proof.serverBasisId!==f.cloudOrigin.serverBasisId)fail();
 if(financial.proof.openingOrigin&&(financial.proof.openingOrigin.localAggregateId!==f.openingOrigin?.localAggregateId||financial.proof.openingOrigin.rowHash!==f.openingOrigin?.rowHash))fail();
 return Object.freeze({...input,proof:financial.proof,intent});
}
function assertFinancialHistoryAcknowledgement(item,ack){
 const boundary=item.kind==='CLOSING',observation=item.kind==='OBSERVE',keys=['status','operationId','payloadHash','sequence','businessUploaded','shiftClosed',...(boundary?['graphPayloadHash','basisHash']:observation?['computedMergedHash','pendingFromHash']:[])];
 if(!exact(ack,keys)||ack.status!==(boundary?'boundary_registered_not_shift_closed':observation?'financial_metadata_observed':'financial_metadata_recorded')||ack.operationId!==item.operationId||ack.payloadHash!==item.payloadHash||ack.sequence!==item.sequence||ack.businessUploaded!==false||ack.shiftClosed!==false)fail('EFINANCIAL_HISTORY_UNCONFIRMED');
 if(observation&&(ack.computedMergedHash!==item.computedMergedHash||ack.pendingFromHash!==item.pendingFromHash))fail('EFINANCIAL_HISTORY_UNCONFIRMED');
 if(boundary){const payload=parse(item.payloadJson);if(ack.graphPayloadHash!==payload.graphPayloadHash||ack.basisHash!==payload.basisHash)fail('EFINANCIAL_HISTORY_UNCONFIRMED');}
 return ack;
}
module.exports={prepareFinancialOpening,prepareFinancialHistory,assertFinancialHistoryAcknowledgement};
