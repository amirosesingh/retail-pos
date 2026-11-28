// Data representation only. A frontier is not a signature, accepted prefix,
// verified clock, permission, offline-writer disposition or complete report.
const FIELDS=['version','projectOrigin','branchId','terminalId','authorId','databaseId','challengeId','nonce','cohortHash','writerRevision',
 'sourceSequence','sourceRoot','sourceGeneration','gapHash','pending','observedAt'];
const COUNTS=['business','metadata','unsigned','unknown'],UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i,HEX=/^[a-f0-9]{64}$/;
const encoder=new TextEncoder();
function fail(){throw Object.assign(new Error('The stock coverage frontier could not be verified.'),{code:'ESTOCK_COVERAGE_FRONTIER_INVALID'});}
function exact(value,fields){
 if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value))||Reflect.ownKeys(value).length!==fields.length)fail();
 for(const field of fields){const descriptor=Object.getOwnPropertyDescriptor(value,field);if(!descriptor||!descriptor.enumerable||!Object.hasOwn(descriptor,'value'))fail();}return value;
}
function id(value,uuid=false){
 if(typeof value!=='string'||!value||value.length>128||value.trim()!==value||/[\u0000-\u001f\u007f]/u.test(value)||(uuid&&!UUID.test(value)))fail();
 for(let index=0;index<value.length;index++){const unit=value.charCodeAt(index);if(unit>=0xd800&&unit<=0xdbff){const next=value.charCodeAt(++index);if(!(next>=0xdc00&&next<=0xdfff))fail();}else if(unit>=0xdc00&&unit<=0xdfff)fail();}
 return UUID.test(value)?value.toLowerCase():value;
}
function count(value){if(typeof value!=='string'||!/^(0|[1-9]\d{0,18})$/.test(value)||BigInt(value)>9223372036854775807n)fail();return value;}
function hash(value){if(typeof value!=='string'||!HEX.test(value))fail();return value;}
function origin(value){
 if(typeof value!=='string'||value.length>2048||value.trim()!==value)fail();let url;try{url=new URL(value);}catch{fail();}
 if(url.protocol!=='https:'||!url.hostname||url.username||url.password||url.pathname!=='/'||url.search||url.hash)fail();return url.origin;
}
function instant(value){
 if(typeof value!=='string')fail();const p=/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,7}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
 if(!p||+p[1]<1||+p[4]>23||+p[5]>59||+p[6]>59)fail();
 const iso=`${p[1]}-${p[2]}-${p[3]}T${p[4]}:${p[5]}:${p[6]}.000Z`,ms=Date.parse(iso);if(!Number.isFinite(ms)||new Date(ms).toISOString()!==iso)fail();
 let offset=0n;if(p[8]!=='Z'){const hours=+p[8].slice(1,3),minutes=+p[8].slice(4);if(hours>14||minutes>59||(hours===14&&minutes!==0))fail();offset=BigInt(hours*60+minutes)*(p[8][0]==='-'?-1n:1n);}
 const ticks=BigInt(ms)*10000n-offset*600000000n+BigInt((p[7]??'').padEnd(7,'0'));let seconds=ticks/10000000n,fraction=ticks%10000000n;
 if(fraction<0n){seconds--;fraction+=10000000n;}const date=new Date(Number(seconds*1000n));if(!Number.isFinite(date.getTime())||date.getUTCFullYear()<1||date.getUTCFullYear()>9999)fail();
 return`${date.toISOString().slice(0,19)}.${String(fraction).padStart(7,'0')}Z`;
}
export function normalizeStockCoverageFrontier(input){
 const value=exact(input,FIELDS);if(value.version!==1||value.writerRevision!=='stock-history-source.v1')fail();
 if(typeof value.nonce!=='string'||! /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(value.nonce))fail();
 const sourceSequence=count(value.sourceSequence);if(sourceSequence==='0'?value.sourceRoot!==null:typeof value.sourceRoot!=='string'||!HEX.test(value.sourceRoot))fail();
 const pending=exact(value.pending,COUNTS),result=Object.freeze({version:1,projectOrigin:origin(value.projectOrigin),branchId:id(value.branchId),terminalId:id(value.terminalId),
  authorId:id(value.authorId,true),databaseId:id(value.databaseId,true),challengeId:id(value.challengeId,true),nonce:value.nonce,cohortHash:hash(value.cohortHash),writerRevision:value.writerRevision,
  sourceSequence,sourceRoot:value.sourceRoot,sourceGeneration:hash(value.sourceGeneration),gapHash:hash(value.gapHash),pending:Object.freeze(Object.fromEntries(COUNTS.map(key=>[key,count(pending[key])]))),observedAt:instant(value.observedAt)});
 if(encoder.encode(JSON.stringify(result)).length>8192)fail();return result;
}
export function stockCoverageFrontierJson(input){return JSON.stringify(normalizeStockCoverageFrontier(input));}
