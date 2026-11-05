import {createRequire} from 'node:module';
import {describe,it,expect} from 'vitest';
const require=createRequire(import.meta.url);
const {calculateKnownTenderTotals,canonicalExactCents}=require('../../../electron/sync/shift-financial-math.cjs');
const shift='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222';
type Input={id:string;branchId:string;shiftId:string;totalAmount:string|null;paymentType:string|null;paymentsJson:string|null;isRefunded:boolean|null;rowVersion:string|null};
const row=(patch:Partial<Input>={}):Input=>({id,branchId:'A',shiftId:shift,totalAmount:'1',paymentType:'cash',paymentsJson:null,isRefunded:false,rowVersion:'1',...patch});
function basis(inputs:unknown[]=[],patch:Record<string,unknown>={}){return {prototypeVersion:2,formula:'canonical-exact-decimal-v2',branchId:'A',shiftId:shift,openingFloat:'0',inputs,...patch};}
const compute=(inputs:unknown[]=[],patch:Record<string,unknown>={})=>calculateKnownTenderTotals(JSON.stringify(basis(inputs,patch)));
const rejected=(body:unknown,code='EFINANCIAL_BASIS_INVALID')=>expect(()=>calculateKnownTenderTotals(typeof body==='string'?body:JSON.stringify(body))).toThrow(expect.objectContaining({code}));
describe('shared exact-decimal shift formula v2',()=>{
 it('starts with cash float only, including an explicit null opening',()=>{expect(compute([],{openingFloat:'12.34'}).expected).toEqual({cash:'12.34',card:'0.00',digital:'0.00'});expect(compute([],{openingFloat:null}).expected.cash).toBe('0.00');});
 it.each([['1.005','1.01'],['-1.005','-1.01'],['0.0049','0.00'],['-0.0049','0.00'],['-0.005','-0.01'],['999.995','1000.00'],[' +.5e+0001 ','5.00'],['1.','1.00']])('rounds final %s to %s without binary money', (amount,expected)=>{expect(compute([row({totalAmount:amount})]).expected.cash).toBe(expected);});
 it('rounds after exact addition instead of each sale',()=>{expect(compute([row({totalAmount:'0.004'}),row({id:shift,totalAmount:'0.004'})]).expected.cash).toBe('0.01');});
 it('preserves inputs beyond IEEE-754 integer precision and raw nested JSON numbers',()=>{
  expect(compute([row({totalAmount:'9007199254740993.005'})]).expected.cash).toBe('9007199254740993.01');
  expect(compute([row({totalAmount:'9007199254740993.005',paymentsJson:'[{"method":"cash","amount":9007199254740993.005}]'})]).expected.cash).toBe('9007199254740993.01');
 });
 it('caps change at positive cash while preserving other tenders',()=>{
  expect(compute([row({totalAmount:'80',paymentsJson:'[{"method":"cash","amount":100},{"method":"card","amount":20}]'})]).expected).toEqual({cash:'60.00',card:'20.00',digital:'0.00'});
  expect(compute([row({totalAmount:'1',paymentsJson:'[{"method":"cash","amount":2},{"method":"card","amount":5}]'})]).expected).toEqual({cash:'0.00',card:'5.00',digital:'0.00'});
 });
 it('does not cap negative cash and includes unknown-method amounts only in paid/change',()=>{
  expect(compute([row({totalAmount:'1',paymentsJson:'[{"method":"cash","amount":-2},{"method":"card","amount":5}]'})]).expected).toEqual({cash:'-2.00',card:'5.00',digital:'0.00'});
  expect(compute([row({totalAmount:'5',paymentsJson:'[{"method":"cash","amount":5},{"method":"points","amount":2}]'})]).expected.cash).toBe('3.00');
 });
 it.each(['wallet','bank_transfer','transfer','qr','online','ewallet'])('supports ASCII case-folded %s in single and split payments',method=>{
  expect(compute([row({paymentType:method.toUpperCase(),totalAmount:'2.55'})]).expected.digital).toBe('2.55');
  expect(compute([row({paymentsJson:JSON.stringify([{method:method.toUpperCase(),amount:'2.55'}])})]).expected.digital).toBe('2.55');
 });
 it.each([null,'','[]',' [\t] ', '{}','true','123','"scalar"'])('uses single tender for null/empty/nonarray JSON %s',paymentsJson=>{expect(compute([row({totalAmount:'2.55',paymentsJson})]).expected.cash).toBe('2.55');});
 it('ignores irrelevant header and absent/null split amounts',()=>{
  expect(compute([row({paymentType:' cash ',paymentsJson:'[{"method":"card","amount":null},{"method":null},{"method":"card","amount":"3.125"}]'})]).expected).toEqual({cash:'0.00',card:'3.13',digital:'0.00'});
 });
 it('retains refunded rows but does not interpret their excluded financial inputs',()=>{expect(compute([row({isRefunded:true,totalAmount:'bad',paymentsJson:'not-json',paymentType:' cash '})],{openingFloat:'1'}).expected.cash).toBe('1.00');});
 it('recomputes independently of caller-declared expected values',()=>{expect(compute([row()],{expected:{cash:'9999'},expectedNativeRaw:{cash:'8888'}}).expected.cash).toBe('1.00');});
 it('keeps stored original bytes unchanged when a later basis reflects a refund',()=>{
  const original=JSON.stringify(basis([row({totalAmount:'100'})],{openingFloat:'10'}));
  const originalResult=calculateKnownTenderTotals(original);expect(compute([row({totalAmount:'100',isRefunded:true})],{openingFloat:'10'}).expected.cash).toBe('10.00');
  expect(calculateKnownTenderTotals(original)).toEqual(originalResult);expect(originalResult.expected.cash).toBe('110.00');
 });
 it('rejects legacy versions, known method whitespace and unbounded decimals',()=>{
  rejected(basis([],{prototypeVersion:1}),'EFINANCIAL_BASIS_UNSUPPORTED');
  for(const amount of ['NaN','Infinity','1e39','1e-39','1'.repeat(77),'1e'+'0'.repeat(129)])rejected(basis([row({totalAmount:amount})]),'EFINANCIAL_BASIS_UNSUPPORTED');
  for(const method of ['cash ',' CASH','bank_transfer\t'])rejected(basis([row({paymentType:method})]),'EFINANCIAL_BASIS_UNSUPPORTED');
 });
 it('rejects malformed/duplicate payment JSON, nonobject entries and booleans',()=>{
  for(const paymentsJson of ['{','[{"method":"cash","amount":1,"amount":2}]'])rejected(basis([row({paymentsJson})]),'EFINANCIAL_BASIS_UNSUPPORTED');
  rejected(basis([row({paymentsJson:'[{"method":"cash","amount":true}]'})]));
  for(const paymentsJson of ['[null]','[1]','[[]]','[{"method":true}]'])rejected(basis([row({paymentsJson})]));
 });
 it('rejects scope/identity/refund/type omissions instead of silently dropping rows',()=>{
  for(const patch of [{id:'bad'},{id:id.toUpperCase()},{branchId:'B'},{shiftId:id},{isRefunded:1},{rowVersion:3},{paymentsJson:[]}]){
   // Uppercase test needs actual letter hex; numeric-only UUIDs are canonical already.
   if(patch.id===id)continue;
   rejected(basis([{...row(),...patch}]));
  }
  rejected(basis([row(),row()]));rejected(basis([row({id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'.toUpperCase()})]));
  const missing={...row()} as Record<string,unknown>;delete missing.rowVersion;rejected(basis([missing]));
  rejected(basis([row()],{openingFloat:1}));rejected(basis([],{shiftId:{toString:'x'}}));
 });
 it('rejects duplicate root keys and invalid JSON',()=>{rejected('{"prototypeVersion":2,"prototypeVersion":2}');rejected('{');});
 it('enforces byte and row bounds without truncation',()=>{
  rejected(' '.repeat(6*1024*1024+1),'EFINANCIAL_BASIS_TOO_LARGE');
  rejected(basis(Array.from({length:20001},(_,n)=>row({id:n.toString(16).padStart(8,'0')+'-2222-4222-8222-222222222222'}))),'EFINANCIAL_BASIS_TOO_LARGE');
 });
});

describe('strict exact-cent field comparison',()=>{
 it.each([['1.2300','1.23'],['-0.000','0.00'],[' +.5e1 ','5.00'],['9007199254740993.01','9007199254740993.01']])('canonicalizes %s exactly as %s without rounding',(raw,expected)=>{expect(canonicalExactCents(raw)).toBe(expected);});
 it('accepts only unrounded numeric tokens from the existing exact JSON parser',()=>{
  const {parseExactJson}=require('../../../electron/sync/shift-recovery-exact.cjs');
  expect(canonicalExactCents(parseExactJson('9007199254740993.01'))).toBe('9007199254740993.01');
 });
 it.each([null,undefined,1.23,true,'1.001','-1.005','1e-3','not money'])('rejects unverifiable or fractional-cent target %s',value=>{expect(()=>canonicalExactCents(value)).toThrow();});
});
describe('exact financial decimal semantic key',()=>{
 const {exactFinancialDecimalKey}=require('../../../electron/sync/shift-financial-math.cjs');
 it('normalizes equivalent decimals without rounding subcent differences',()=>{expect(exactFinancialDecimalKey('1')).toBe(exactFinancialDecimalKey('1.000000000000'));expect(exactFinancialDecimalKey('.5')).toBe(exactFinancialDecimalKey('5e-1'));expect(exactFinancialDecimalKey('1.001')).not.toBe(exactFinancialDecimalKey('1.002'));});
 it.each([null,undefined,1,true,'Infinity','1e39'])('rejects unsupported key input %s',value=>{expect(()=>exactFinancialDecimalKey(value)).toThrow();});
});
