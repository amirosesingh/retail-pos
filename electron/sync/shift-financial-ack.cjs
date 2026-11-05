// Optional FIN62 upload/receipt guard. Does not enable capabilities or mint
// proofs. Ordinary legacy intents retain their existing transport and ACK path.
const {createHash}=require('node:crypto');
const {recordId}=require('./uuid-fields.cjs');
const {normalizeAttestation}=require('../security/shift-author-protocol.cjs');
const {normalizeFinancialBasisAttestation,normalizeOpeningFinancialBasisAttestation}=require('../security/shift-financial-protocol.cjs');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const prepared=new WeakMap();
const MAX_BYTES=6*1024*1024;
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const hash=value=>createHash('sha256').update(value,'utf8').digest('hex');
function fail(code='ESHIFT_FINANCIAL_PROOF_INVALID'){
 throw Object.assign(new Error('The saved shift financial proof could not be confirmed. Its upload remains pending.'),{code,table:'shifts'});
}
function prepareShiftFinancialBasis(intent,branchId,author=intent?.shiftAuthor){
 const sidecar=intent?.shiftFinancialBasis;
 if(sidecar===undefined||sidecar===null){if(intent?.financialRequired===true)fail('ESHIFT_FINANCIAL_PROOF_REQUIRED');if(sidecar===undefined)return undefined;fail();}
 if(intent?.financialRequired===true&&!sidecar.proof)fail('ESHIFT_FINANCIAL_PROOF_REQUIRED');
 if(!exact(sidecar,['basisJson','proof'])||typeof sidecar.basisJson!=='string'||!sidecar.basisJson||Buffer.byteLength(sidecar.basisJson,'utf8')>MAX_BYTES||
   typeof intent?.payloadJson!=='string'||!intent.payloadJson||Buffer.byteLength(intent.payloadJson,'utf8')>MAX_BYTES||!['ORIGINAL','RECOUNT'].includes(intent.kind))fail();
 let proof,shiftAuthor;
 try{proof=sidecar.proof&&Object.hasOwn(sidecar.proof,'openingOrigin')?normalizeOpeningFinancialBasisAttestation(sidecar.proof):normalizeFinancialBasisAttestation(sidecar.proof);shiftAuthor=normalizeAttestation(author);}catch{fail();}
 const graphHash=hash(intent.payloadJson);
 if(intent.payloadHash!==graphHash||proof.graphPayloadHash!==graphHash||proof.basisHash!==hash(sidecar.basisJson)||
   recordId(proof.branchId)!==recordId(branchId)||recordId(proof.branchId)!==recordId(intent.branchId)||proof.shiftId!==recordId(intent.shiftId)||
   proof.intentId!==recordId(intent.intentId)||proof.action!==intent.kind||
   shiftAuthor.payloadHash!==graphHash||shiftAuthor.action!==intent.kind||
   ['projectOrigin','terminalId','authorId','keyId','subject','branchId','shiftId','intentId'].some(key=>proof[key]!==shiftAuthor[key]))fail();
 const result=Object.freeze({basisJson:sidecar.basisJson,proof:Object.freeze(proof)});
 prepared.set(result,{intentId:intent.intentId,shiftId:intent.shiftId,branchId:intent.branchId,kind:intent.kind,payloadJson:intent.payloadJson,payloadHash:graphHash});
 return result;
}
function assertShiftFinancialAcknowledgement(acknowledgement,intent,expectedSidecar){
 const sidecar=expectedSidecar===undefined?prepareShiftFinancialBasis(intent,intent?.branchId):expectedSidecar;
 if(sidecar===undefined)return undefined;
 const context=prepared.get(sidecar);
 if(!context||Object.keys(context).some(key=>intent?.[key]!==context[key]))fail();
 const receipt=acknowledgement?.financial_basis_receipt,proof=sidecar.proof;
 if(Object.hasOwn(proof,'openingOrigin')){
  if(!exact(receipt,['ack_version','intentId','graphPayloadHash','basisHash','serverBasisId','formula','openingOrigin'])||receipt.ack_version!==2||
    receipt.intentId!==proof.intentId||receipt.graphPayloadHash!==proof.graphPayloadHash||receipt.basisHash!==proof.basisHash||receipt.formula!==proof.formula||
    typeof receipt.serverBasisId!=='string'||!UUID.test(receipt.serverBasisId)||!exact(receipt.openingOrigin,['localAggregateId','rowHash'])||
    receipt.openingOrigin.localAggregateId!==proof.openingOrigin.localAggregateId||receipt.openingOrigin.rowHash!==proof.openingOrigin.rowHash)fail('ESHIFT_FINANCIAL_UNCONFIRMED');
 }else{
  if(!exact(receipt,['ack_version','intentId','graphPayloadHash','basisHash','serverBasisId','formula'])||receipt.ack_version!==1||
    receipt.intentId!==proof.intentId||receipt.graphPayloadHash!==proof.graphPayloadHash||receipt.basisHash!==proof.basisHash||
    receipt.serverBasisId!==proof.serverBasisId||receipt.formula!==proof.formula)fail('ESHIFT_FINANCIAL_UNCONFIRMED');
 }
 return receipt;
}
module.exports={prepareShiftFinancialBasis,assertShiftFinancialAcknowledgement};
