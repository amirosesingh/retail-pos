'use strict';
// Data validation only. Main must separately admit the real receiving action;
// the original SQL transaction supplies recordedAt and rejects future claims.
const contract=require('./db/stock-history-contract.cjs');
function normalizeStockArrival(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||![Object.prototype,null].includes(Object.getPrototypeOf(input))||
  Reflect.ownKeys(input).length!==2||!Object.hasOwn(input,'effectiveAt')||!Object.hasOwn(input,'reason'))contract.fail('ESTOCK_ARRIVAL_INVALID');
 for(const key of ['effectiveAt','reason']){
  const descriptor=Object.getOwnPropertyDescriptor(input,key);
  if(!descriptor||!descriptor.enumerable||!Object.hasOwn(descriptor,'value'))contract.fail('ESTOCK_ARRIVAL_INVALID');
 }
 if(typeof input.reason!=='string'||!input.reason||input.reason.trim()!==input.reason||input.reason.length>500||/[\u0000-\u001f\u007f]/u.test(input.reason))contract.fail('ESTOCK_ARRIVAL_INVALID');
 for(let i=0;i<input.reason.length;i++){
  const unit=input.reason.charCodeAt(i);
  if(unit>=0xd800&&unit<=0xdbff){const next=input.reason.charCodeAt(++i);if(!(next>=0xdc00&&next<=0xdfff))contract.fail('ESTOCK_ARRIVAL_INVALID');}
  else if(unit>=0xdc00&&unit<=0xdfff)contract.fail('ESTOCK_ARRIVAL_INVALID');
 }
 let effectiveAt;try{effectiveAt=contract.canonicalInstant(input.effectiveAt);}catch{contract.fail('ESTOCK_ARRIVAL_INVALID');}
 return Object.freeze({effectiveAt,reason:input.reason});
}
module.exports={normalizeStockArrival};
