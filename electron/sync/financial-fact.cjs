// Shared exact financial snapshot comparison only. No database, activation or
// authorization dependencies; mutation OLD/NEW policy remains in its caller.
const {parseExactJson,isExactNumber}=require('./shift-recovery-exact.cjs');
const {exactFinancialDecimalKey}=require('./shift-financial-math.cjs');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const fail=(code='EFINANCIAL_OPERATION_INVALID')=>{throw Object.assign(new Error('The immutable financial operation could not be confirmed.'),{code,table:'shifts'});};
const KNOWN_METHODS=new Set(['cash','card','wallet','bank_transfer','transfer','qr','online','ewallet']);
const foldMethod=value=>{if(value===null)return null;if(typeof value!=='string')return value;const lower=value.replace(/[A-Z]/g,c=>String.fromCharCode(c.charCodeAt(0)+32));return KNOWN_METHODS.has(lower)?lower:value;};
function semanticJson(value){
 if(isExactNumber(value))return['number',exactFinancialDecimalKey(value)];
 if(value===null)return['null'];if(typeof value==='string')return['string',value];if(typeof value==='boolean')return['boolean',value];
 if(Array.isArray(value))return['array',value.map(semanticJson)];
 if(value&&typeof value==='object')return['object',Object.keys(value).sort().map(key=>[key,semanticJson(value[key])])];
 fail('EFINANCIAL_SOURCE_UNVERIFIED');
}
function financialFact(row){
 if(!row||typeof row!=='object'||Array.isArray(row)||typeof row.id!=='string'||typeof row.branchId!=='string'||typeof row.shiftId!=='string'||!UUID.test(row.id)||!UUID.test(row.shiftId))fail('EFINANCIAL_SOURCE_UNVERIFIED');
 for(const key of['totalAmount','paymentType','paymentsJson','discountAmount','rowVersion'])if(!Object.hasOwn(row,key)||(row[key]!==null&&typeof row[key]!=='string'))fail('EFINANCIAL_SOURCE_UNVERIFIED');
 if(!Object.hasOwn(row,'isRefunded')||(row.isRefunded!==null&&typeof row.isRefunded!=='boolean'))fail('EFINANCIAL_SOURCE_UNVERIFIED');
 const refunded=row.isRefunded===true;let payments=['single'];
 if(!refunded&&row.paymentsJson!==null&&row.paymentsJson!==''){
  let parsed;try{parsed=parseExactJson(row.paymentsJson,{maxBytes:6*1024*1024,maxDepth:64});}catch{fail('EFINANCIAL_SOURCE_UNVERIFIED');}
  if(Array.isArray(parsed)&&parsed.length){
   parsed=parsed.map(entry=>{
    if(!entry||typeof entry!=='object'||Array.isArray(entry)||isExactNumber(entry))fail('EFINANCIAL_SOURCE_UNVERIFIED');
    const result={...entry};if(Object.hasOwn(result,'amount')&&result.amount!==null){if(typeof result.amount!=='string'&&!isExactNumber(result.amount))fail('EFINANCIAL_SOURCE_UNVERIFIED');result.amount={financialExactAmount:exactFinancialDecimalKey(result.amount)};}
    if(typeof result.method==='string')result.method=foldMethod(result.method);return result;
   });payments=semanticJson(parsed);
  }
 }
 // This is financial snapshot equality only. The mutation OLD/NEW field policy
 // below remains raw/strict and must never use this excluded-tender projection.
 return{id:row.id,branchId:row.branchId,shiftId:row.shiftId,totalAmount:row.totalAmount===null?null:exactFinancialDecimalKey(row.totalAmount),discountAmount:row.discountAmount===null?null:exactFinancialDecimalKey(row.discountAmount),paymentType:refunded?['excluded']:foldMethod(row.paymentType),payments:refunded?['excluded']:payments,isRefunded:refunded};
}

module.exports={financialFact};
