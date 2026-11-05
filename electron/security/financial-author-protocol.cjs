// FIN62 financial-operation domain. No key material, enrollment or IPC exposure.
// A valid signature identifies an author; it does not prove financial completeness.
const {normalizeBinding}=require('./shift-author-protocol.cjs');
const KEYS=['version','algorithm','keyId','projectOrigin','terminalId','authorId','subject','branchId','operationId','action','payloadHash'];
const ACTIONS=['OPEN','SALE','REFUND','TENDER','VOID'];
const invalid=()=>{throw Object.assign(new Error('The financial operation proof is invalid.'),{code:'EFINANCIAL_AUTHOR_INVALID'});};
const uuid=value=>{if(typeof value!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value))invalid();return value.toLowerCase();};
const label=(value,max)=>{if(typeof value!=='string'||!value||value.length>max||value!==value.trim()||/[\u0000-\u001f\u007f]/u.test(value))invalid();return value;};
function exact(input,keys){if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length!==keys.length||keys.some(key=>!Object.hasOwn(input,key)))invalid();return input;}
function unsigned(input){
 const value=exact(input,KEYS);
 if(value.version!==1||value.algorithm!=='Ed25519'||!ACTIONS.includes(value.action)||typeof value.payloadHash!=='string'||!/^[a-f0-9]{64}$/.test(value.payloadHash))invalid();
 let binding;try{binding=normalizeBinding({projectOrigin:value.projectOrigin,terminalId:value.terminalId,authorId:value.authorId});}catch{invalid();}
 return {version:1,algorithm:'Ed25519',keyId:uuid(value.keyId),...binding,subject:label(value.subject,200),branchId:label(value.branchId,128),operationId:uuid(value.operationId),action:value.action,payloadHash:value.payloadHash};
}
function financialOperationMessage(input){const v=unsigned(input);return JSON.stringify(['retail-pos.financial-operation.v1',v.algorithm,v.projectOrigin,v.terminalId,v.authorId,v.keyId,v.subject,v.branchId,v.operationId,v.action,v.payloadHash]);}
function normalizeFinancialAttestation(input){
 const value=exact(input,[...KEYS,'signature']);
 if(typeof value.signature!=='string'||!/^[A-Za-z0-9_-]{86}$/.test(value.signature))invalid();
 let bytes;try{bytes=atob(value.signature.replace(/-/g,'+').replace(/_/g,'/'));}catch{invalid();}
 if(bytes.length!==64||btoa(bytes).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')!==value.signature)invalid();
 const {signature,...fields}=value;return {...unsigned(fields),signature};
}
module.exports={financialOperationMessage,normalizeFinancialAttestation};