import {createRequire} from 'node:module';
import {describe,it,expect} from 'vitest';
const require=createRequire(import.meta.url);
const {buildShiftFinancialDraft,formatShiftFinancialSummary,normalizeCountedInput}=require('../../../electron/db/shift-financial-draft.cjs');
describe('counted input IPC compatibility',()=>{
 it.each([[12,'12.00'],[0.29,'0.29'],['9007199254740993.01','9007199254740993.01'],[1.005,'1.01'],['1.005','1.01'],[0.30000000000000004,'0.30']])('normalizes only a new counted input %s',(input,expected)=>{expect(normalizeCountedInput(input)).toBe(expected);});
 it.each([90071992547409.91,70368744177664,Infinity,NaN,-0.001,-1])('rejects unsafe or negative numeric input %s',input=>{expect(()=>normalizeCountedInput(input)).toThrowError(expect.objectContaining({code:'EFINANCIAL_DRAFT_INVALID'}));});
});
const fixture=()=>({computed:{status:'computed',formula:'canonical-exact-decimal-v2',expected:{cash:'100.01',card:'20.00',digital:'3.00'}},counted:{cash:'100.00',card:'21.00',digital:'2.00'},openingFloat:'10.00'});
describe('pure exact new-action closing draft',()=>{
 it('computes exact cent variances and net cash with no binary rounding',()=>{expect(buildShiftFinancialDraft(fixture())).toMatchObject({expected_cash:'100.01',counted_cash:'100.00',variance_cash:'-0.01',variance_card:'1.00',variance_digital:'-1.00',variance_total:'-0.01',variance_status:'SHORT',net_cash_sales:'90.01'});});
 it('preserves uncounted nullable tenders and ignores them only in total variance',()=>{const f=fixture();Object.assign(f.counted,{card:null,digital:null});expect(buildShiftFinancialDraft(f)).toMatchObject({counted_card:null,counted_digital:null,variance_card:null,variance_digital:null,variance_total:'-0.01'});});
 it.each([['100.01','NO_VARIANCE','0.00'],['100.02','OVER','0.01'],['100.00','SHORT','-0.01']])('uses exact signed cents %s',(cash,status,total)=>{const f=fixture();Object.assign(f.counted,{cash,card:'20',digital:'3'});expect(buildShiftFinancialDraft(f)).toMatchObject({variance_status:status,variance_total:total});});
 it('preserves values beyond safe Number precision',()=>{const f=fixture();f.computed.expected.cash='9007199254740993.01';f.counted.cash='9007199254740993.02';Object.assign(f.counted,{card:'20',digital:'3'});expect(buildShiftFinancialDraft(f)).toMatchObject({expected_cash:'9007199254740993.01',variance_cash:'0.01',net_cash_sales:'9007199254740983.01'});});
 it.each([undefined,null,1,true,'NaN','Infinity','1.001','-0.01'])('rejects invalid counted cash %s',cash=>{const f=fixture();Object.assign(f.counted,{cash});expect(()=>buildShiftFinancialDraft(f)).toThrowError(expect.objectContaining({code:'EFINANCIAL_DRAFT_INVALID'}));});
 it('requires computed v2 and canonical expected values; does not calculate a basis',()=>{for(const patch of [{status:'unsupported'},{formula:'legacy'},{expected:{cash:'1',card:'2.00',digital:'3.00'}}]){const f=fixture();Object.assign(f.computed,patch);expect(()=>buildShiftFinancialDraft(f)).toThrow();}});
 it('rejects missing nullable fields rather than silently supplying zero',()=>{const f=fixture();delete (f.counted as Partial<typeof f.counted>).card;expect(()=>buildShiftFinancialDraft(f)).toThrow();});
 it('does not mutate inputs',()=>{const f=fixture(),before=JSON.stringify(f);expect(Object.isFrozen(buildShiftFinancialDraft(f))).toBe(true);expect(JSON.stringify(f)).toBe(before);});
});
describe('exact explicit closing summary',()=>{
 const input=()=>({draft:buildShiftFinancialDraft(fixture()),branchName:'Branch',actor:'Cashier',totalSales:'123.01',transactions:'7',discounts:'2.00',refunds:'1.00'});
 it('keeps summary and persisted monetary fields exact',()=>{expect(formatShiftFinancialSummary(input())).toMatchObject({total_sales:'123.01',transactions:'7',discounts:'2.00',refunds:'1.00',payment_breakdown:{cash:'90.01',card:'20.00',digital:'3.00'},summary:'Shift closed — Branch\nClosed by Cashier\nTotal sales: 123.01 over 7 bill(s)\nCash expected 100.01 / counted 100.00'});});
 it.each(['totalSales','transactions','discounts','refunds','draft','branchName','actor'])('rejects omitted %s rather than inventing a summary',field=>{const f=input();delete (f as Record<string,unknown>)[field];expect(()=>formatShiftFinancialSummary(f)).toThrow();});
 it.each([1,'1.0','-1','01',''])('rejects noncanonical transaction counts %s',transactions=>{expect(()=>formatShiftFinancialSummary({...input(),transactions})).toThrow();});
});

describe('new-action summary final rounding only',()=>{
 it.each([['1.005','1.01'],['-1.005','-1.01'],['9007199254740993.005','9007199254740993.01']])('rounds aggregate %s to %s exactly', (raw,rounded)=>{
  const draft=buildShiftFinancialDraft(fixture());expect(formatShiftFinancialSummary({draft,branchName:'A',actor:'person',transactions:'1',totalSales:raw,discounts:raw,refunds:raw})).toMatchObject({total_sales:rounded,discounts:rounded,refunds:rounded});
 });
 it('still rejects fractional-cent counted inputs',()=>{const f=fixture();f.counted.cash='1.005';expect(()=>buildShiftFinancialDraft(f)).toThrow();});
});

describe('subcent opening presentation',()=>{
 it('rounds opening presentation after full precision expected calculation',()=>{
  const f=fixture();f.openingFloat='1.005';f.computed.expected.cash='1.01';f.counted.cash='1.01';Object.assign(f.counted,{card:'20.00',digital:'3.00'});
  expect(buildShiftFinancialDraft(f)).toMatchObject({opening_float:'1.01',expected_cash:'1.01',net_cash_sales:'0.00',variance_total:'0.00'});
 });
 it('supports SQL 12dp opening strings without changing already-computed expected',()=>{
  const f=fixture();f.openingFloat='20.000000000510';expect(buildShiftFinancialDraft(f)).toMatchObject({opening_float:'20.00',expected_cash:'100.01',net_cash_sales:'80.01'});
 });
});
