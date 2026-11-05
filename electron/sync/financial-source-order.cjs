// PostgreSQL snapshot visibility for opaque, actual server-basis evidence only.
// Never interpret a global helper sequence or a wall clock as commit ordering.
const invalid=()=>{throw Object.assign(new Error('The financial source evidence is not ordered.'),{code:'EFINANCIAL_OBSERVATION_ORDER'});};
const integer=(raw,max)=>{if(typeof raw!=='string'||!/^(0|[1-9][0-9]{0,19})$/.test(raw))invalid();const value=BigInt(raw);if(value>max)invalid();return value;};
function normalizeFinancialSourceEvidence(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length!==3||!['creatorXid','snapshot','evidenceOrder'].every(key=>Object.hasOwn(input,key)))invalid();
 const creator=integer(input.creatorXid,18446744073709551615n),order=integer(input.evidenceOrder,9223372036854775807n);
 if(creator<1n||order<1n||typeof input.snapshot!=='string'||input.snapshot.length>1024*1024)invalid();
 const parts=input.snapshot.split(':');if(parts.length!==3)invalid();const min=integer(parts[0],18446744073709551615n),max=integer(parts[1],18446744073709551615n);if(min>max)invalid();
 const active=parts[2]===''?[]:parts[2].split(',');if(active.length>20000)invalid();let last=null;
 for(const text of active){const id=integer(text,18446744073709551615n);if(id<min||id>=max||last!==null&&id<=last)invalid();last=id;}
 return Object.freeze({creatorXid:input.creatorXid,snapshot:input.snapshot,evidenceOrder:input.evidenceOrder});
}
function assertFinancialSourceAfter(previous,next){
 const a=normalizeFinancialSourceEvidence(previous),b=normalizeFinancialSourceEvidence(next),old=BigInt(a.creatorXid);
 if(a.creatorXid===b.creatorXid){if(BigInt(b.evidenceOrder)<=BigInt(a.evidenceOrder))invalid();return true;}
 const [low,high,active]=b.snapshot.split(':');
 if(old<BigInt(low)||old<BigInt(high)&&!new Set(active?active.split(','):[]).has(a.creatorXid))return true;
 invalid();
}
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
function normalizePublishedThrough(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length>20000)invalid();const result={};
 for(const[id,sequence]of Object.entries(input)){if(!UUID.test(id)||typeof sequence!=='string'||!/^(0|[1-9][0-9]{0,18})$/.test(sequence)||BigInt(sequence)>9223372036854775807n)invalid();result[id]=sequence;}
 return Object.freeze(result);
}
module.exports={normalizeFinancialSourceEvidence,assertFinancialSourceAfter,normalizePublishedThrough};
