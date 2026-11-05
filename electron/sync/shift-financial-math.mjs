// FIN62 exact-decimal v2 math only. No authority, persistence, IPC or runtime
// activation: completeness and operation authorization are separate checks.
import {parseExactJson,isExactNumber} from './shift-recovery-exact.mjs';
const FORMULA='canonical-exact-decimal-v2';
const MAX_BYTES=6*1024*1024, MAX_ROWS=20000, SCALE=38;
const CENT=10n**36n;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TENDERS=new Set(['cash','card','wallet','bank_transfer','transfer','qr','online','ewallet']);
const DIGITAL=new Set(['wallet','bank_transfer','transfer','qr','online','ewallet']);
const own=(object,key)=>Object.hasOwn(object,key);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&!isExactNumber(value);
const trim=value=>value.replace(/^[ \t\n\r\f\v]+|[ \t\n\r\f\v]+$/g,'');
function fail(code='EFINANCIAL_BASIS_INVALID'){
  throw Object.assign(new Error('The saved financial basis cannot be verified.'),{code});
}
function decimal(input,{payment=false}={}){
  if(input===null)return 0n;
  if(payment&&isExactNumber(input))input=input.raw;
  if(typeof input!=='string')fail();
  const token=trim(input);
  if(token.length>128)fail('EFINANCIAL_BASIS_UNSUPPORTED');
  const match=/^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(token);
  if(!match)fail('EFINANCIAL_BASIS_UNSUPPORTED');
  const exponent=BigInt(match[5]??'0');
  if(exponent>38n||exponent< -38n)fail('EFINANCIAL_BASIS_UNSUPPORTED');
  const fraction=match[3]??match[4]??'';
  let digits=((match[2]??'')+fraction).replace(/^0+/,'');
  if(!digits)return 0n;
  // Number below represents bounded digit positions, never a monetary value.
  let scale=fraction.length-Number(exponent);
  while(digits.endsWith('0')){digits=digits.slice(0,-1);scale--;}
  if(scale>SCALE||digits.length+Math.max(0,-scale)>76)fail('EFINANCIAL_BASIS_UNSUPPORTED');
  const value=BigInt(digits)*10n**BigInt(SCALE-scale);
  return match[1]==='-'?-value:value;
}
function method(value){
  if(value===null||value===undefined)return '';
  if(typeof value!=='string')fail();
  const normalized=value.replace(/[A-Z]/g,c=>String.fromCharCode(c.charCodeAt(0)+32));
  if(normalized!==trim(normalized)&&TENDERS.has(trim(normalized)))fail('EFINANCIAL_BASIS_UNSUPPORTED');
  return normalized;
}
function money(value){
  const negative=value<0n, absolute=negative?-value:value;
  let cents=absolute/CENT;
  if(absolute%CENT*2n>=CENT)cents++;
  const text=(negative&&cents!==0n?'-':'')+(cents/100n).toString()+'.'+(cents%100n).toString().padStart(2,'0');
  decimal(text); // Apply the same explicit numeric bound to the final aggregate.
  return text;
}
function payments(raw){
  if(raw===null||raw==='')return null;
  if(typeof raw!=='string')fail();
  try{return parseExactJson(raw,{maxBytes:MAX_BYTES,maxDepth:64});}
  catch{fail('EFINANCIAL_BASIS_UNSUPPORTED');}
}
// Strict equality helper for already-calculated financial fields. Unlike the
// aggregate evaluator, this never rounds a supplied fractional-cent target.
export function canonicalExactCents(value){
  if(value===null||value===undefined||typeof value==='number')fail();
  const amount=decimal(value,{payment:true});
  if(amount%CENT!==0n)fail('EFINANCIAL_BASIS_UNSUPPORTED');
  return money(amount);
}
// Semantic identity never rounds, including fractional-cent source amounts.
// Exact semantic key only: preserves subcent differences and rejects JS Number.
export function exactFinancialDecimalKey(value){
  if(value===null||value===undefined||typeof value==='number')fail();
  return decimal(value,{payment:true}).toString();
}
export function roundExactMoney(value){
  if(typeof value!=='string')fail();
  return money(decimal(value,{payment:true}));
}
export function calculateKnownTenderTotals(raw){
  if(typeof raw!=='string')fail();
  if(new TextEncoder().encode(raw).byteLength>MAX_BYTES)fail('EFINANCIAL_BASIS_TOO_LARGE');
  let basis;
  try{basis=parseExactJson(raw,{maxBytes:MAX_BYTES,maxDepth:64});}catch{fail();}
  if(!object(basis))fail();
  if(!isExactNumber(basis.prototypeVersion)||basis.prototypeVersion.raw!=='2'||basis.formula!==FORMULA)
    fail('EFINANCIAL_BASIS_UNSUPPORTED');
  if(typeof basis.branchId!=='string'||!basis.branchId||basis.branchId.length>128||(typeof basis.shiftId!=='string'||!UUID.test(basis.shiftId)))fail();
  if(!Array.isArray(basis.inputs))fail();
  if(basis.inputs.length>MAX_ROWS)fail('EFINANCIAL_BASIS_TOO_LARGE');
  if(!own(basis,'openingFloat'))fail();
  const opening=decimal(basis.openingFloat);
  const ids=new Set();let cash=0n,card=0n,digital=0n;
  for(const input of basis.inputs){
    if(!object(input)||(typeof input.id!=='string'||!UUID.test(input.id))||ids.has(input.id)||input.branchId!==basis.branchId||input.shiftId!==basis.shiftId)fail();
    ids.add(input.id);
    for(const key of ['totalAmount','paymentType','paymentsJson','rowVersion'])
      if(!own(input,key)||(input[key]!==null&&typeof input[key]!=='string'))fail();
    if(!own(input,'isRefunded')||(input.isRefunded!==null&&typeof input.isRefunded!=='boolean'))fail();
    if(input.isRefunded===true)continue; // Retain the row; ignore excluded tender data.
    const total=decimal(input.totalAmount),entries=payments(input.paymentsJson);
    if(Array.isArray(entries)&&entries.length){
      let paid=0n,saleCash=0n,saleCard=0n,saleDigital=0n;
      for(const entry of entries){
        if(!object(entry))fail();
        const amount=own(entry,'amount')?decimal(entry.amount,{payment:true}):0n;
        const tender=method(entry.method);
        paid+=amount;
        if(tender==='cash')saleCash+=amount;
        else if(tender==='card')saleCard+=amount;
        else if(DIGITAL.has(tender))saleDigital+=amount;
      }
      let netCash=saleCash;
      if(saleCash>0n&&paid>total){const change=paid-total;netCash=change>=saleCash?0n:saleCash-change;}
      cash+=netCash;card+=saleCard;digital+=saleDigital;
    }else{
      const tender=method(input.paymentType);
      if(tender==='cash')cash+=total;
      else if(tender==='card')card+=total;
      else if(DIGITAL.has(tender))digital+=total;
    }
  }
  return {status:'computed',formula:FORMULA,expected:{cash:money(opening+cash),card:money(card),digital:money(digital)}};
}
