// Public companion domain only. No key material, enrollment, persistence or IPC.
// The signature binds a closing graph to an exact financial basis and receipt;
// it does not by itself prove the receipt, complete inputs or financial math.
const {normalizeBinding}=require('./shift-author-protocol.cjs');
const KEYS=['version','algorithm','keyId','projectOrigin','terminalId','authorId','subject','branchId','shiftId','intentId','action','graphPayloadHash','basisHash','serverBasisId','formula'];
const invalid=()=>{throw Object.assign(new Error('The shift financial proof is invalid.'),{code:'ESYNC_SHIFT_FINANCIAL_INVALID'});};
function exact(input,keys){if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length!==keys.length||keys.some(key=>!Object.hasOwn(input,key)))invalid();return input;}
function uuid(value){if(typeof value!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value))invalid();return value.toLowerCase();}
function label(value,max){if(typeof value!=='string'||!value||value.length>max||value!==value.trim()||/[\u0000-\u001f\u007f]/u.test(value))invalid();return value;}
function hash(value){if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))invalid();return value;}
function unsigned(input){
 const value=exact(input,KEYS);
 if(value.version!==1||value.algorithm!=='Ed25519'||!['ORIGINAL','RECOUNT'].includes(value.action)||value.formula!=='canonical-exact-decimal-v2')invalid();
 let binding;try{binding=normalizeBinding({projectOrigin:value.projectOrigin,terminalId:value.terminalId,authorId:value.authorId});}catch{invalid();}
 return {version:1,algorithm:'Ed25519',keyId:uuid(value.keyId),...binding,subject:label(value.subject,200),branchId:label(value.branchId,128),shiftId:uuid(value.shiftId),intentId:uuid(value.intentId),action:value.action,graphPayloadHash:hash(value.graphPayloadHash),basisHash:hash(value.basisHash),serverBasisId:uuid(value.serverBasisId),formula:value.formula};
}
function financialBasisMessage(input){
 const v=unsigned(input);
 return JSON.stringify(['retail-pos.shift-financial-basis.v1',v.algorithm,v.projectOrigin,v.terminalId,v.authorId,v.keyId,v.subject,v.branchId,v.shiftId,v.intentId,v.action,v.graphPayloadHash,v.basisHash,v.serverBasisId,v.formula]);
}
function normalizeFinancialBasisAttestation(input){
 const value=exact(input,[...KEYS,'signature']);
 if(typeof value.signature!=='string'||!/^[A-Za-z0-9_-]{86}$/.test(value.signature))invalid();
 let bytes;try{bytes=atob(value.signature.replace(/-/g,'+').replace(/_/g,'/'));}catch{invalid();}
 if(bytes.length!==64||btoa(bytes).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')!==value.signature)invalid();
 const {signature,...fields}=value;return {...unsigned(fields),signature};
}
// Distinct pending-origin variant: a future server must resolve this reference
// through the actual accepted OPEN receipt. Never synthesize a server basis ID.
const ORIGIN_KEYS=KEYS.filter(key=>key!=='serverBasisId').concat('openingOrigin');
function unsignedOpening(input){
 const value=exact(input,ORIGIN_KEYS);
 if(value.version!==1||value.algorithm!=='Ed25519'||!['ORIGINAL','RECOUNT'].includes(value.action)||value.formula!=='canonical-exact-decimal-v2')invalid();
 let binding;try{binding=normalizeBinding({projectOrigin:value.projectOrigin,terminalId:value.terminalId,authorId:value.authorId});}catch{invalid();}
 const origin=exact(value.openingOrigin,['localAggregateId','rowHash']);
 return {version:1,algorithm:'Ed25519',keyId:uuid(value.keyId),...binding,subject:label(value.subject,200),branchId:label(value.branchId,128),shiftId:uuid(value.shiftId),intentId:uuid(value.intentId),action:value.action,graphPayloadHash:hash(value.graphPayloadHash),basisHash:hash(value.basisHash),openingOrigin:Object.freeze({localAggregateId:uuid(origin.localAggregateId),rowHash:hash(origin.rowHash)}),formula:value.formula};
}
function openingFinancialBasisMessage(input){
 const v=unsignedOpening(input);
 return JSON.stringify(['retail-pos.shift-financial-basis.opening.v1',v.algorithm,v.projectOrigin,v.terminalId,v.authorId,v.keyId,v.subject,v.branchId,v.shiftId,v.intentId,v.action,v.graphPayloadHash,v.basisHash,v.openingOrigin.localAggregateId,v.openingOrigin.rowHash,v.formula]);
}
function normalizeOpeningFinancialBasisAttestation(input){
 const value=exact(input,[...ORIGIN_KEYS,'signature']);
 if(typeof value.signature!=='string'||!/^[A-Za-z0-9_-]{86}$/.test(value.signature))invalid();
 let bytes;try{bytes=atob(value.signature.replace(/-/g,'+').replace(/_/g,'/'));}catch{invalid();}
 if(bytes.length!==64||btoa(bytes).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')!==value.signature)invalid();
 const {signature,...fields}=value;return {...unsignedOpening(fields),signature};
}
module.exports={financialBasisMessage,normalizeFinancialBasisAttestation,openingFinancialBasisMessage,normalizeOpeningFinancialBasisAttestation};
