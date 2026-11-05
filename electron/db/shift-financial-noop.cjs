// Local transaction evidence only. Never a cloud acknowledgement or a mutation.
const crypto=require('node:crypto');
const {normalizeFinancialAttestation,financialOperationMessage}=require('../security/financial-author-protocol.cjs');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const keys=['id','branchId','shiftId','totalAmount','paymentType','paymentsJson','discountAmount','isRefunded','rowVersion'];
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const json=v=>JSON.stringify(canonical(v));
const hash=v=>crypto.createHash('sha256').update(v,'utf8').digest('hex');
const fail=()=>{throw Object.assign(new Error('The saved financial no-op capture could not be verified.'),{code:'EFINANCIAL_SOURCE_UNVERIFIED',table:'shifts'});};
function validateNoopPayload(payload,scope){
 if(!payload||json(Object.keys(payload).sort())!==json(['version','kind','operationId','branchId','terminalId','shiftId','action','changes'].sort())||payload.version!==1||payload.kind!=='FINANCIAL_NOOP'||!['SALE','REFUND','TENDER','VOID'].includes(payload.action)||!UUID.test(payload.operationId)||payload.operationId!==scope.operationId||payload.branchId!==scope.branchId||payload.shiftId!==scope.shiftId||payload.terminalId!==scope.terminalId||!Array.isArray(payload.changes)||payload.changes.length<1||payload.changes.length>500)fail();
 const seen=new Set();
 for(const change of payload.changes){
  if(!change||json(Object.keys(change).sort())!==json(['after','before','saleId'])||!UUID.test(change.saleId)||seen.has(change.saleId))fail();seen.add(change.saleId);
  for(const row of[change.before,change.after]){
   if(!row||json(Object.keys(row).sort())!==json([...keys].sort())||row.id!==change.saleId||row.branchId!==scope.branchId||row.shiftId!==scope.shiftId)fail();
   for(const key of['totalAmount','paymentType','paymentsJson','discountAmount','rowVersion'])if(row[key]!==null&&typeof row[key]!=='string')fail();
   if(row.isRefunded!==null&&typeof row.isRefunded!=='boolean')fail();
  }
  const omit=row=>Object.fromEntries(Object.entries(row).filter(([key])=>key!=='rowVersion'));
  if(json(omit(change.before))!==json(omit(change.after)))fail();
 }
 return payload;
}
function verifyNoopCapture(row,scope,projectOrigin,publicKey){
 if(typeof row?.payload_json!=='string'||Buffer.byteLength(row.payload_json,'utf8')>6*1024*1024||hash(row.payload_json)!==row.payload_hash)fail();
 let payload,proof;try{payload=JSON.parse(row.payload_json);proof=normalizeFinancialAttestation(JSON.parse(row.proof_json));}catch{fail();}
 validateNoopPayload(payload,scope);
 if(proof.projectOrigin!==projectOrigin||proof.operationId!==scope.operationId||proof.branchId!==scope.branchId||proof.terminalId!==scope.terminalId||proof.action!==payload.action||proof.payloadHash!==row.payload_hash)fail();
 const{signature,...fields}=proof;
 if(!crypto.verify(null,Buffer.from(financialOperationMessage(fields)),publicKey,Buffer.from(signature,'base64url')))fail();
 return Object.freeze({kind:'NOOP',changes:new Map(payload.changes.map(change=>[change.saleId,change]))});
}
module.exports={validateNoopPayload,verifyNoopCapture};
