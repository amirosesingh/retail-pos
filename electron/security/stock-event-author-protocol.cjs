// Dedicated stock evidence domain. No keys, enrollment, clocks or stock writes.
const {normalizeBinding}=require('./shift-author-protocol.cjs');
const ACTIONS=Object.freeze({
 SALE:Object.freeze({kind:'sale',permissions:Object.freeze(['can_process_sale'])}),
 REFUND:Object.freeze({kind:'refund',permissions:Object.freeze(['can_process_refund'])}),
 RECEIVE:Object.freeze({kind:'receiving',permissions:Object.freeze(['can_receive_purchase_order'])}),
 ADJUST:Object.freeze({kind:'stock',permissions:Object.freeze(['can_adjust_stock'])}),
 PRODUCT_CREATE:Object.freeze({kind:'product',permissions:Object.freeze(['can_add_new_product'])}),
 PRODUCT_MERGE:Object.freeze({kind:'product',permissions:Object.freeze(['can_merge_products'])}),
 TRANSFER_DISPATCH:Object.freeze({kind:'transfer',permissions:Object.freeze(['can_create_transfer'])}),
 TRANSFER_RECEIVE:Object.freeze({kind:'transfer',permissions:Object.freeze(['can_receive_transfer'])}),
 SPONSORSHIP_ISSUE:Object.freeze({kind:'sponsorship',permissions:Object.freeze(['can_issue_sponsorship'])}),
 MISSED_BILL:Object.freeze({kind:'missed_bill',permissions:Object.freeze([]),adminOnly:true}),
});
const FIELDS=['version','algorithm','keyId','projectOrigin','terminalId','authorId','subject','branchId','operationId','movementId','action','payloadHash'];
function invalid(){throw Object.assign(new Error('The original stock-event author could not be verified.'),{code:'ESTOCK_AUTHOR_INVALID'});}
function exact(value,keys){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key)))invalid();return value;}
function uuid(value){if(typeof value!=='string'||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value))invalid();return value.toLowerCase();}
function label(value,max){if(typeof value!=='string'||!value||value!==value.trim()||value.length>max||/[\u0000-\u001f\u007f]/u.test(value))invalid();return value;}
function unsignedStockEvent(input){
 const hasSource=!!input&&Object.hasOwn(input,'sourceManifestJson'),value=exact(input,hasSource?[...FIELDS,'sourceManifestJson']:FIELDS);
 if(value.version!==1||value.algorithm!=='Ed25519'||!Object.hasOwn(ACTIONS,value.action)||typeof value.payloadHash!=='string'||!/^[a-f0-9]{64}$/.test(value.payloadHash))invalid();
 if(hasSource&&(typeof value.sourceManifestJson!=='string'||!value.sourceManifestJson||new TextEncoder().encode(value.sourceManifestJson).length>16384))invalid();
 let binding;try{binding=normalizeBinding({projectOrigin:value.projectOrigin,terminalId:value.terminalId,authorId:value.authorId});}catch{invalid();}
 return{version:1,algorithm:'Ed25519',keyId:uuid(value.keyId),...binding,subject:label(value.subject,200),branchId:label(value.branchId,128),
  operationId:uuid(value.operationId),movementId:uuid(value.movementId),action:value.action,payloadHash:value.payloadHash,...(hasSource?{sourceManifestJson:value.sourceManifestJson}:{})};
}
function stockEventMessage(input){const v=unsignedStockEvent(input);return JSON.stringify(['retail-pos.stock-event.v1',v.algorithm,v.projectOrigin,v.terminalId,v.authorId,v.keyId,v.subject,v.branchId,v.operationId,v.movementId,v.action,v.payloadHash,...(v.sourceManifestJson==null?[]:[['source_manifest.v1',v.sourceManifestJson]])]);}
function normalizeStockEvent(input){
 const value=exact(input,[...FIELDS,...(input&&Object.hasOwn(input,'sourceManifestJson')?['sourceManifestJson']:[]),'signature']);
 if(typeof value.signature!=='string'||!/^[A-Za-z0-9_-]{86}$/.test(value.signature))invalid();
 let bytes;try{bytes=atob(value.signature.replace(/-/g,'+').replace(/_/g,'/'));}catch{invalid();}
 if(bytes.length!==64||btoa(bytes).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')!==value.signature)invalid();
 const{signature,...fields}=value;return{...unsignedStockEvent(fields),signature};
}
const COHORT_FIELDS=['version','algorithm','keyId','projectOrigin','terminalId','authorId','subject','branchId','operationId','sourceDatabaseId','sourceSequence','sourcePredecessorRoot','action','sourceRoot','sourceCount'];
function unsignedStockSourceCohort(input){
 const value=exact(input,COHORT_FIELDS);
 if(value.version!==1||value.algorithm!=='Ed25519'||!Object.hasOwn(ACTIONS,value.action)||['SALE','REFUND'].includes(value.action)||
  typeof value.sourceRoot!=='string'||!/^[a-f0-9]{64}$/.test(value.sourceRoot)||!Number.isInteger(value.sourceCount)||value.sourceCount<1||value.sourceCount>2000)invalid();
 if(typeof value.sourceSequence!=='string'||!/^[1-9]\d{0,18}$/.test(value.sourceSequence)||BigInt(value.sourceSequence)>9223372036854775807n||
  (value.sourceSequence==='1'?value.sourcePredecessorRoot!==null:typeof value.sourcePredecessorRoot!=='string'||!/^[a-f0-9]{64}$/.test(value.sourcePredecessorRoot)))invalid();
 let binding;try{binding=normalizeBinding({projectOrigin:value.projectOrigin,terminalId:value.terminalId,authorId:value.authorId});}catch{invalid();}
 const branch=label(value.branchId,128);
 return{version:1,algorithm:'Ed25519',keyId:uuid(value.keyId),...binding,subject:label(value.subject,200),
  branchId:/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(branch)?branch.toLowerCase():branch,
  operationId:uuid(value.operationId),sourceDatabaseId:uuid(value.sourceDatabaseId),sourceSequence:value.sourceSequence,sourcePredecessorRoot:value.sourcePredecessorRoot,
  action:value.action,sourceRoot:value.sourceRoot,sourceCount:value.sourceCount};
}
function stockSourceCohortMessage(input){
 const v=unsignedStockSourceCohort(input);
 // Same approved stock domain, explicit purpose. Neither an ordinary stock
 // movement nor a shift/financial proof can be replayed as a producer cohort.
 return JSON.stringify(['retail-pos.stock-event.v1','source_cohort.v1',v.algorithm,v.projectOrigin,v.terminalId,v.authorId,v.keyId,
  v.subject,v.branchId,v.operationId,v.sourceDatabaseId,v.sourceSequence,v.sourcePredecessorRoot,v.action,v.sourceRoot,v.sourceCount]);
}
function normalizeStockSourceCohortProof(input){
 const value=exact(input,[...COHORT_FIELDS,'signature']);
 if(typeof value.signature!=='string'||!/^[A-Za-z0-9_-]{86}$/.test(value.signature))invalid();
 let bytes;try{bytes=atob(value.signature.replace(/-/g,'+').replace(/_/g,'/'));}catch{invalid();}
 if(bytes.length!==64||btoa(bytes).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')!==value.signature)invalid();
 const{signature,...fields}=value;return{...unsignedStockSourceCohort(fields),signature};
}
const FRONTIER_FIELDS=['version','algorithm','keyId','projectOrigin','terminalId','authorId','subject','branchId','challengeId','frontierHash'];
function unsignedStockCoverageFrontier(input){
 const value=exact(input,FRONTIER_FIELDS);
 if(value.version!==1||value.algorithm!=='Ed25519'||typeof value.frontierHash!=='string'||!/^[a-f0-9]{64}$/.test(value.frontierHash))invalid();
 let binding;try{binding=normalizeBinding({projectOrigin:value.projectOrigin,terminalId:value.terminalId,authorId:value.authorId});}catch{invalid();}
 const branch=label(value.branchId,128);
 return{version:1,algorithm:'Ed25519',keyId:uuid(value.keyId),...binding,subject:label(value.subject,200),
  branchId:/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(branch)?branch.toLowerCase():branch,challengeId:uuid(value.challengeId),frontierHash:value.frontierHash};
}
function stockCoverageFrontierMessage(input){
 const v=unsignedStockCoverageFrontier(input);
 return JSON.stringify(['retail-pos.stock-event.v1','coverage_frontier.v1',v.algorithm,v.projectOrigin,v.terminalId,v.authorId,v.keyId,v.subject,v.branchId,v.challengeId,v.frontierHash]);
}
function normalizeStockCoverageFrontierProof(input){
 const value=exact(input,[...FRONTIER_FIELDS,'signature']);
 if(typeof value.signature!=='string'||!/^[A-Za-z0-9_-]{86}$/.test(value.signature))invalid();
 let bytes;try{bytes=atob(value.signature.replace(/-/g,'+').replace(/_/g,'/'));}catch{invalid();}
 if(bytes.length!==64||btoa(bytes).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')!==value.signature)invalid();
 const{signature,...fields}=value;return{...unsignedStockCoverageFrontier(fields),signature};
}
module.exports={ACTIONS,unsignedStockEvent,stockEventMessage,normalizeStockEvent,unsignedStockSourceCohort,stockSourceCohortMessage,normalizeStockSourceCohortProof,
 unsignedStockCoverageFrontier,stockCoverageFrontierMessage,normalizeStockCoverageFrontierProof};
